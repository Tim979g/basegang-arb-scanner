function requirePositive(values) {
  if (!values.every((value) => Number.isFinite(value) && value > 0)) throw new Error("Trade inputs and liquidity must be positive numbers");
}

export function estimateRoundTrip({ tradeSizeUsd, buyPrice, sellPrice, buyLiquidityUsd, sellLiquidityUsd, flashLoanFeePercent, dexFeePercentPerSwap, estimatedGasUsd, safetyMarginPercent }) {
  requirePositive([tradeSizeUsd, buyPrice, sellPrice, buyLiquidityUsd, sellLiquidityUsd]);
  const fee = dexFeePercentPerSwap / 100;
  const buyImpact = tradeSizeUsd / (buyLiquidityUsd / 2 + tradeSizeUsd);
  const bought = tradeSizeUsd * (1 - fee) * (1 - buyImpact) / buyPrice;
  const nominalSale = bought * sellPrice;
  const sellImpact = nominalSale / (sellLiquidityUsd / 2 + nominalSale);
  const proceeds = nominalSale * (1 - fee) * (1 - sellImpact);
  const flashLoanFeeUsd = tradeSizeUsd * flashLoanFeePercent / 100;
  const safetyMarginUsd = tradeSizeUsd * safetyMarginPercent / 100;
  return { tradeSizeUsd, rawSpreadPercent: (sellPrice / buyPrice - 1) * 100, estimatedBuyImpactPercent: buyImpact * 100, estimatedSellImpactPercent: sellImpact * 100, saleProceedsUsd: proceeds, flashLoanFeeUsd, estimatedGasUsd, safetyMarginUsd, netProfitUsd: proceeds - tradeSizeUsd - flashLoanFeeUsd - estimatedGasUsd - safetyMarginUsd };
}

export function findBestSpread(pools) {
  if (!Array.isArray(pools) || pools.length < 2) return null;
  const sorted = [...pools].sort((a, b) => (a.assetPriceUsd ?? a.priceUsd) - (b.assetPriceUsd ?? b.priceUsd));
  return { buy: sorted[0], sell: sorted.at(-1) };
}

export function estimateTriangle({ tradeSizeUsd, edges, flashLoanFeePercent, dexFeePercentPerSwap, estimatedGasUsd, safetyMarginPercent }) {
  requirePositive([tradeSizeUsd, ...edges.flatMap((edge) => [edge.rate, edge.liquidityUsd])]);
  const fee = dexFeePercentPerSwap / 100;
  let amount = tradeSizeUsd;
  const impacts = [];
  for (const edge of edges) {
    const impact = tradeSizeUsd / (edge.liquidityUsd / 2 + tradeSizeUsd);
    impacts.push(impact * 100);
    amount *= edge.rate * (1 - fee) * (1 - impact);
  }
  const flashLoanFeeUsd = tradeSizeUsd * flashLoanFeePercent / 100;
  const safetyMarginUsd = tradeSizeUsd * safetyMarginPercent / 100;
  return { tradeSizeUsd, grossReturnPercent: (amount / tradeSizeUsd - 1) * 100, estimatedImpactPercentByHop: impacts, finalAmountUsd: amount, flashLoanFeeUsd, estimatedGasUsd, safetyMarginUsd, netProfitUsd: amount - tradeSizeUsd - flashLoanFeeUsd - estimatedGasUsd - safetyMarginUsd };
}
