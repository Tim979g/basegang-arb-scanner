import {
  Contract,
  JsonRpcProvider,
  parseUnits,
  formatUnits
} from "ethers";

/* =========================================================
   ABIs
   ========================================================= */

const FACTORY_ABI = [
  "function factory() view returns (address)"
];

const BASIC_POOL_ABI = [
  "function getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256)"
];

const SLIPSTREAM_POOL_ABI = [
  "function tickSpacing() view returns (int24)"
];

const UNISWAP_V3_POOL_ABI = [
  "function fee() view returns (uint24)"
];

const TOKEN_ABI = [
  "function decimals() view returns (uint8)"
];

const SLIPSTREAM_QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,int24 tickSpacing,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"
];

const UNISWAP_V3_QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"
];

/* =========================================================
   BASE CONTRACT ADDRESSES
   ========================================================= */

const AERODROME_BASIC_FACTORY =
  "0x420DD381b31aEf6683db6B902084cB0FFECe40Da".toLowerCase();

const AERODROME_SLIPSTREAM_FACTORY =
  "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A".toLowerCase();

const AERODROME_SLIPSTREAM_QUOTER =
  "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0";

const UNISWAP_V3_FACTORY =
  "0x33128a8fC17869897dcE68Ed026d694621f6FDfD".toLowerCase();

const UNISWAP_V3_QUOTER =
  "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";

/* =========================================================
   HELPERS
   ========================================================= */

function errorMessage(error) {
  return (
    error?.shortMessage ??
    error?.reason ??
    error?.message ??
    String(error)
  );
}

function lower(value) {
  return String(value).toLowerCase();
}

function poolLabel(pool) {
  return `${pool.dex}:${pool.pairAddress}`;
}

/* =========================================================
   LIVE QUOTE VERIFIER
   ========================================================= */

export class LiveQuoteVerifier {
  constructor(rpcUrl) {
    this.provider = new JsonRpcProvider(
      rpcUrl,
      8453,
      { staticNetwork: true }
    );

    this.decimalsCache = new Map();
    this.poolTypeCache = new Map();

    this.slipstreamQuoter = new Contract(
      AERODROME_SLIPSTREAM_QUOTER,
      SLIPSTREAM_QUOTER_ABI,
      this.provider
    );

    this.uniswapV3Quoter = new Contract(
      UNISWAP_V3_QUOTER,
      UNISWAP_V3_QUOTER_ABI,
      this.provider
    );
  }

  /* ---------------------------------------------------------
     Token decimals
     --------------------------------------------------------- */

  async decimals(token) {
    const key = lower(token.address);

    if (this.decimalsCache.has(key)) {
      return this.decimalsCache.get(key);
    }

    const tokenContract = new Contract(
      token.address,
      TOKEN_ABI,
      this.provider
    );

    const decimals = Number(
      await tokenContract.decimals()
    );

    this.decimalsCache.set(key, decimals);

    return decimals;
  }

  /* ---------------------------------------------------------
     Pool classification

     Aerodrome Basic
     Aerodrome Slipstream
     Uniswap V3
     Unsupported
     --------------------------------------------------------- */

  async classifyPool(pool) {
    const key = lower(pool.pairAddress);

    if (this.poolTypeCache.has(key)) {
      return this.poolTypeCache.get(key);
    }

    let classification;

    try {
      const poolContract = new Contract(
        pool.pairAddress,
        FACTORY_ABI,
        this.provider
      );

      const factory = lower(
        await poolContract.factory({
          blockTag: "pending"
        })
      );

      if (
        pool.dex === "aerodrome" &&
        factory === AERODROME_BASIC_FACTORY
      ) {
        classification = {
          type: "aerodrome_basic",
          factory
        };
      } else if (
        pool.dex === "aerodrome" &&
        factory === AERODROME_SLIPSTREAM_FACTORY
      ) {
        classification = {
          type: "aerodrome_slipstream",
          factory
        };
      } else if (
        pool.dex === "uniswap" &&
        factory === UNISWAP_V3_FACTORY
      ) {
        classification = {
          type: "uniswap_v3",
          factory
        };
      } else {
        classification = {
          type: "unsupported",
          factory,
          reason:
            `Unrecognized ${pool.dex} factory ${factory}`
        };
      }
    } catch (error) {
      classification = {
        type: "unsupported",
        reason:
          `Pool classification failed: ${errorMessage(error)}`
      };
    }

    this.poolTypeCache.set(key, classification);

    /*
     * IMPORTANT:
     * This gives us a clean searchable line in GitHub Actions.
     */
    console.log(
      `[pool-type] ${poolLabel(pool)} -> ${classification.type}` +
      (classification.factory
        ? ` factory=${classification.factory}`
        : "") +
      (classification.reason
        ? ` reason="${classification.reason}"`
        : "")
    );

    return classification;
  }

  /* ---------------------------------------------------------
     Quote one pool
     --------------------------------------------------------- */

  async poolQuote(pool, tokenIn, amountIn) {
    const tokenInAddress = lower(tokenIn.address);

    const tokenOut =
      lower(pool.base.address) === tokenInAddress
        ? pool.quote
        : pool.base;

    const classification =
      await this.classifyPool(pool);

    try {
      switch (classification.type) {
        /* ---------------- Aerodrome Basic ---------------- */

        case "aerodrome_basic": {
          const contract = new Contract(
            pool.pairAddress,
            BASIC_POOL_ABI,
            this.provider
          );

          return await contract.getAmountOut(
            amountIn,
            tokenIn.address,
            { blockTag: "pending" }
          );
        }

        /* ------------- Aerodrome Slipstream ------------- */

        case "aerodrome_slipstream": {
          const poolContract = new Contract(
            pool.pairAddress,
            SLIPSTREAM_POOL_ABI,
            this.provider
          );

          const tickSpacing =
            await poolContract.tickSpacing({
              blockTag: "pending"
            });

          const quote =
            await this.slipstreamQuoter
              .quoteExactInputSingle
              .staticCall(
                [
                  tokenIn.address,
                  tokenOut.address,
                  amountIn,
                  tickSpacing,
                  0
                ],
                { blockTag: "pending" }
              );

          return quote.amountOut;
        }

        /* ---------------- Uniswap V3 ---------------- */

        case "uniswap_v3": {
          const poolContract = new Contract(
            pool.pairAddress,
            UNISWAP_V3_POOL_ABI,
            this.provider
          );

          const fee =
            await poolContract.fee({
              blockTag: "pending"
            });

          const quote =
            await this.uniswapV3Quoter
              .quoteExactInputSingle
              .staticCall(
                [
                  tokenIn.address,
                  tokenOut.address,
                  amountIn,
                  fee,
                  0
                ],
                { blockTag: "pending" }
              );

          return quote.amountOut;
        }

        /* ---------------- Unsupported ---------------- */

        default:
          throw new Error(
            classification.reason ??
            `Unsupported live-quote pool ${poolLabel(pool)}`
          );
      }
    } catch (error) {
      throw new Error(
        `[${classification.type}] quote failed for ` +
        `${poolLabel(pool)} ` +
        `${tokenIn.address} -> ${tokenOut.address}: ` +
        errorMessage(error)
      );
    }
  }

  /* ---------------------------------------------------------
     Direct arbitrage verification
     --------------------------------------------------------- */

  async verifyDirect(
    item,
    tradeSizeUsd,
    costs
  ) {
    const supportedDexes = [
      item.buy.dex,
      item.sell.dex
    ].every(
      (dex) =>
        dex === "aerodrome" ||
        dex === "uniswap"
    );

    if (!supportedDexes) {
      return {
        status: "unsupported_dex"
      };
    }

    const stable =
      item.buy.base.stable
        ? item.buy.base
        : item.buy.quote;

    const asset =
      item.buy.base.stable
        ? item.buy.quote
        : item.buy.base;

    const sellContainsAsset =
      lower(item.sell.base.address) ===
        lower(asset.address) ||
      lower(item.sell.quote.address) ===
        lower(asset.address);

    if (
      !stable.stable ||
      !sellContainsAsset
    ) {
      return {
        status: "token_mismatch"
      };
    }

    try {
      const stableDecimals =
        await this.decimals(stable);

      const input = parseUnits(
        String(tradeSizeUsd),
        stableDecimals
      );

      const assetOut =
        await this.poolQuote(
          item.buy,
          stable,
          input
        );

      const stableOut =
        await this.poolQuote(
          item.sell,
          asset,
          assetOut
        );

      const finalAmountUsd = Number(
        formatUnits(
          stableOut,
          stableDecimals
        )
      );

      return buildResult(
        "verified",
        tradeSizeUsd,
        finalAmountUsd,
        costs
      );
    } catch (error) {
      return {
        status: "quote_failed",
        message: errorMessage(error)
      };
    }
  }

  /* ---------------------------------------------------------
     Triangular arbitrage verification
     --------------------------------------------------------- */

  async verifyTriangle(
    item,
    tradeSizeUsd,
    tokenBySymbol,
    costs
  ) {
    const supportedDexes =
      item.edges.every(
        (edge) =>
          edge.dex === "aerodrome" ||
          edge.dex === "uniswap"
      );

    if (!supportedDexes) {
      return {
        status: "unsupported_dex"
      };
    }

    try {
      const start =
        tokenBySymbol.get(item.route[0]);

      if (!start) {
        throw new Error(
          `Unknown starting token ${item.route[0]}`
        );
      }

      const startDecimals =
        await this.decimals(start);

      let amount = parseUnits(
        String(tradeSizeUsd),
        startDecimals
      );

      for (const edge of item.edges) {
        const tokenIn =
          tokenBySymbol.get(edge.from);

        if (!tokenIn) {
          throw new Error(
            `Unknown route token ${edge.from}`
          );
        }

        amount =
          await this.poolQuote(
            edge,
            tokenIn,
            amount
          );
      }

      const finalAmountUsd = Number(
        formatUnits(
          amount,
          startDecimals
        )
      );

      return buildResult(
        "verified",
        tradeSizeUsd,
        finalAmountUsd,
        costs
      );
    } catch (error) {
      return {
        status: "quote_failed",
        message: errorMessage(error)
      };
    }
  }
}

/* =========================================================
   RESULT / COST CALCULATION
   ========================================================= */

function buildResult(
  status,
  tradeSizeUsd,
  finalAmountUsd,
  costs
) {
  const flashLoanFeeUsd =
    tradeSizeUsd *
    costs.flashLoanFeePercent /
    100;

  const safetyMarginUsd =
    tradeSizeUsd *
    costs.safetyMarginPercent /
    100;

  const estimatedGasUsd =
    costs.estimatedGasUsd;

  const netProfitUsd =
    finalAmountUsd -
    tradeSizeUsd -
    flashLoanFeeUsd -
    estimatedGasUsd -
    safetyMarginUsd;

  return {
    status,
    tradeSizeUsd,
    finalAmountUsd,
    flashLoanFeeUsd,
    estimatedGasUsd,
    safetyMarginUsd,
    netProfitUsd
  };
}
