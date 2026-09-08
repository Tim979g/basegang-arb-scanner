import { Contract, JsonRpcProvider, parseUnits, formatUnits } from "ethers";

const POOL_ABI = ["function getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256)"];
const TOKEN_ABI = ["function decimals() view returns (uint8)"];

export class LiveQuoteVerifier {
  constructor(rpcUrl) {
    this.provider = new JsonRpcProvider(rpcUrl, 8453, { staticNetwork: true });
    this.decimalsCache = new Map();
  }

  async decimals(token) {
    const key = token.address.toLowerCase();
    if (!this.decimalsCache.has(key)) {
      const value = Number(await new Contract(token.address, TOKEN_ABI, this.provider).decimals());
      this.decimalsCache.set(key, value);
    }
    return this.decimalsCache.get(key);
  }

  async poolQuote(pool, tokenIn, amountIn) {
    return new Contract(pool.pairAddress, POOL_ABI, this.provider).getAmountOut(amountIn, tokenIn.address, { blockTag: "pending" });
  }

  async verifyDirect(item, tradeSizeUsd, costs) {
    if (item.buy.dex !== "aerodrome" || item.sell.dex !== "aerodrome") return { status: "unsupported_dex" };
    const stable = item.buy.base.stable ? item.buy.base : item.buy.quote;
    const asset = item.buy.base.stable ? item.buy.quote : item.buy.base;
    if (!stable.stable || item.sell.base.address.toLowerCase() !== asset.address.toLowerCase() && item.sell.quote.address.toLowerCase() !== asset.address.toLowerCase()) return { status: "token_mismatch" };
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
    if (!item.edges.every((edge) => edge.dex === "aerodrome")) return { status: "unsupported_dex" };
    try {
      const start = tokenBySymbol.get(item.route[0]);
      const startDecimals = await this.decimals(start);
      let amount = parseUnits(String(tradeSizeUsd), startDecimals);
      for (const edge of item.edges) amount = await this.poolQuote(edge, tokenBySymbol.get(edge.from), amount);
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
  return { status, tradeSizeUsd, finalAmountUsd, flashLoanFeeUsd, estimatedGasUsd: costs.estimatedGasUsd, safetyMarginUsd, netProfitUsd: finalAmountUsd - tradeSizeUsd - flashLoanFeeUsd - costs.estimatedGasUsd - safetyMarginUsd };
}
