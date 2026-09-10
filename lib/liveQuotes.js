import { Contract, JsonRpcProvider, parseUnits, formatUnits } from "ethers";

const FACTORY_ABI = ["function factory() view returns (address)"];
const BASIC_POOL_ABI = ["function getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256)"];
const SLIPSTREAM_POOL_ABI = ["function tickSpacing() view returns (int24)"];
const TOKEN_ABI = ["function decimals() view returns (uint8)"];
const UNISWAP_V3_POOL_ABI = ["function fee() view returns (uint24)"];

const SLIPSTREAM_QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,int24 tickSpacing,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"
];

const UNISWAP_V3_QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"
];

const AERODROME_BASIC_FACTORY = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da".toLowerCase();
const AERODROME_SLIPSTREAM_FACTORY = "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A".toLowerCase();
const AERODROME_SLIPSTREAM_QUOTER = "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0";
const UNISWAP_V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD".toLowerCase();
const UNISWAP_V3_QUOTER = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";

export class LiveQuoteVerifier {
  constructor(rpcUrl) {
    this.provider = new JsonRpcProvider(rpcUrl, 8453, { staticNetwork: true });
    this.decimalsCache = new Map();
    this.poolTypeCache = new Map();
  }

  async decimals(token) {
    const key = token.address.toLowerCase();
    if (!this.decimalsCache.has(key)) {
      const value = Number(await new Contract(token.address, TOKEN_ABI, this.provider).decimals());
      this.decimalsCache.set(key, value);
    }
    return this.decimalsCache.get(key);
  }

  async classifyPool(pool) {
    const key = pool.pairAddress.toLowerCase();
    if (this.poolTypeCache.has(key)) return this.poolTypeCache.get(key);

    let classification;
    try {
      const factory = String(
        await new Contract(pool.pairAddress, FACTORY_ABI, this.provider).factory({ blockTag: "pending" })
      ).toLowerCase();

      if (pool.dex === "aerodrome" && factory === AERODROME_BASIC_FACTORY) {
        classification = { type: "aerodrome_basic", factory };
      } else if (pool.dex === "aerodrome" && factory === AERODROME_SLIPSTREAM_FACTORY) {
        classification = { type: "aerodrome_slipstream", factory };
      } else if (pool.dex === "uniswap" && factory === UNISWAP_V3_FACTORY) {
        classification = { type: "uniswap_v3", factory };
      } else {
        classification = {
          type: "unsupported",
          factory,
          reason: `Unrecognized ${pool.dex} factory ${factory}`
        };
      }
    } catch (error) {
      classification = {
        type: "unsupported",
        reason: `Pool classification failed: ${error.shortMessage ?? error.message}`
      };
    }

    this.poolTypeCache.set(key, classification);
    return classification;
  }

  async poolQuote(pool, tokenIn, amountIn) {
    const tokenOut =
      pool.base.address.toLowerCase() === tokenIn.address.toLowerCase()
        ? pool.quote
        : pool.base;

    const classification = await this.classifyPool(pool);

    if (classification.type === "aerodrome_basic") {
      return new Contract(pool.pairAddress, BASIC_POOL_ABI, this.provider).getAmountOut(
        amountIn,
        tokenIn.address,
        { blockTag: "pending" }
      );
    }

    if (classification.type === "aerodrome_slipstream") {
      const tickSpacing = await new Contract(
        pool.pairAddress,
        SLIPSTREAM_POOL_ABI,
        this.provider
      ).tickSpacing({ blockTag: "pending" });

      const quote = await new Contract(
        AERODROME_SLIPSTREAM_QUOTER,
        SLIPSTREAM_QUOTER_ABI,
        this.provider
      ).quoteExactInputSingle.staticCall(
        [tokenIn.address, tokenOut.address, amountIn, tickSpacing, 0],
        { blockTag: "pending" }
      );

      return quote.amountOut;
    }

    if (classification.type === "uniswap_v3") {
      const fee = await new Contract(
        pool.pairAddress,
        UNISWAP_V3_POOL_ABI,
        this.provider
      ).fee({ blockTag: "pending" });

      const quote = await new Contract(
        UNISWAP_V3_QUOTER,
        UNISWAP_V3_QUOTER_ABI,
        this.provider
      ).quoteExactInputSingle.staticCall(
        [tokenIn.address, tokenOut.address, amountIn, fee, 0],
        { blockTag: "pending" }
      );

      return quote.amountOut;
    }

    throw new Error(classification.reason ?? `Unsupported live-quote pool: ${pool.pairAddress}`);
  }

  async verifyDirect(item, tradeSizeUsd, costs) {
    if (![item.buy.dex, item.sell.dex].every((dex) => dex === "aerodrome" || dex === "uniswap")) {
      return { status: "unsupported_dex" };
    }

    const stable = item.buy.base.stable ? item.buy.base : item.buy.quote;
    const asset = item.buy.base.stable ? item.buy.quote : item.buy.base;

    if (
      !stable.stable ||
      (item.sell.base.address.toLowerCase() !== asset.address.toLowerCase() &&
        item.sell.quote.address.toLowerCase() !== asset.address.toLowerCase())
    ) {
      return { status: "token_mismatch" };
    }

    try {
      const stableDecimals = await this.decimals(stable);
      const input = parseUnits(String(tradeSizeUsd), stableDecimals);
      const assetOut = await this.poolQuote(item.buy, stable, input);
      const stableOut = await this.poolQuote(item.sell, asset, assetOut);
      const finalAmountUsd = Number(formatUnits(stableOut, stableDecimals));
      return result("verified", tradeSizeUsd, finalAmountUsd, costs);
    } catch (error) {
      return { status: "quote_failed", message: error.shortMessage ?? error.message };
    }
  }

  async verifyTriangle(item, tradeSizeUsd, tokenBySymbol, costs) {
    if (!item.edges.every((edge) => edge.dex === "aerodrome" || edge.dex === "uniswap")) {
      return { status: "unsupported_dex" };
    }

    try {
      const start = tokenBySymbol.get(item.route[0]);
      const startDecimals = await this.decimals(start);
      let amount = parseUnits(String(tradeSizeUsd), startDecimals);

      for (const edge of item.edges) {
        amount = await this.poolQuote(edge, tokenBySymbol.get(edge.from), amount);
      }

      const finalAmountUsd = Number(formatUnits(amount, startDecimals));
      return result("verified", tradeSizeUsd, finalAmountUsd, costs);
    } catch (error) {
      return { status: "quote_failed", message: error.shortMessage ?? error.message };
    }
  }
}

function result(status, tradeSizeUsd, finalAmountUsd, costs) {
  const flashLoanFeeUsd = tradeSizeUsd * costs.flashLoanFeePercent / 100;
  const safetyMarginUsd = tradeSizeUsd * costs.safetyMarginPercent / 100;

  return {
    status,
    tradeSizeUsd,
    finalAmountUsd,
    flashLoanFeeUsd,
    estimatedGasUsd: costs.estimatedGasUsd,
    safetyMarginUsd,
    netProfitUsd:
      finalAmountUsd -
      tradeSizeUsd -
      flashLoanFeeUsd -
      costs.estimatedGasUsd -
      safetyMarginUsd
  };
}
