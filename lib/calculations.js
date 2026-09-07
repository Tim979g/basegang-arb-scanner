export function estimateRoundTrip({
  tradeSizeUsd,
  buyPrice,
  sellPrice,
  buyLiquidityUsd,
  sellLiquidityUsd,
  flashLoanFeePercent,
  dexFeePercentPerSwap,
  estimatedGasUsd,
  safetyMarginPercent
}) {
  const positive = [tradeSizeUsd, buyPrice, sellPrice, buyLiquidityUsd, sellLiquidityUsd]
    .every((value) => Number.isFinite(value) && value > 0);

  if (!positive) throw new Error("Trade inputs and liquidity must be positive numbers");

  // Screening estimate only. Total USD liquidity is treated as roughly half per side.
  // This is deliberately conservative and is not an executable concentrated-liquidity quote.
  const buySideLiquidity = buyLiquidityUsd / 2;
  const buyImpact = tradeSizeUsd / (buySideLiquidity + tradeSizeUsd);
  const dexFee = dexFeePercentPerSwap / 100;
  const wethBought = (tradeSizeUsd * (1 - dexFee) * (1 - buyImpact)) / buyPrice;

  const nominalSaleUsd = wethBought * sellPrice;
  const sellSideLiquidity = sellLiquidityUsd / 2;
  const sellImpact = nominalSaleUsd / (sellSideLiquidity + nominalSaleUsd);
  const saleProceedsUsd = nominalSaleUsd * (1 - dexFee) * (1 - sellImpact);

  const flashLoanFeeUsd = tradeSizeUsd * (flashLoanFeePercent / 100);
  const safetyMarginUsd = tradeSizeUsd * (safetyMarginPercent / 100);
  const netProfitUsd = saleProceedsUsd - tradeSizeUsd - flashLoanFeeUsd - estimatedGasUsd - safetyMarginUsd;

  return {
    tradeSizeUsd,
    rawSpreadPercent: ((sellPrice / buyPrice) - 1) * 100,
    estimatedBuyImpactPercent: buyImpact * 100,
    estimatedSellImpactPercent: sellImpact * 100,
    saleProceedsUsd,
    flashLoanFeeUsd,
    estimatedGasUsd,
    safetyMarginUsd,
    netProfitUsd
  };
}

export function findBestSpread(pools) {
  if (!Array.isArray(pools) || pools.length < 2) return null;
  const sorted = [...pools].sort((a, b) => a.priceUsd - b.priceUsd);
  return { buy: sorted[0], sell: sorted[sorted.length - 1] };
}
