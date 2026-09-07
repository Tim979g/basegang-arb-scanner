import test from "node:test";
import assert from "node:assert/strict";
import { estimateRoundTrip, findBestSpread } from "../lib/calculations.js";

test("findBestSpread picks the cheapest buy and highest sale", () => {
  const result = findBestSpread([
    { dex: "a", priceUsd: 2000 },
    { dex: "b", priceUsd: 2020 },
    { dex: "c", priceUsd: 2010 }
  ]);
  assert.equal(result.buy.dex, "a");
  assert.equal(result.sell.dex, "b");
});

test("round trip produces profit only when spread clears costs", () => {
  const result = estimateRoundTrip({
    tradeSizeUsd: 1000,
    buyPrice: 2000,
    sellPrice: 2040,
    buyLiquidityUsd: 10_000_000,
    sellLiquidityUsd: 10_000_000,
    flashLoanFeePercent: 0.05,
    dexFeePercentPerSwap: 0.3,
    estimatedGasUsd: 0.25,
    safetyMarginPercent: 0.1
  });
  assert.ok(result.netProfitUsd > 0);
});

test("invalid liquidity is rejected", () => {
  assert.throws(() => estimateRoundTrip({
    tradeSizeUsd: 1000,
    buyPrice: 2000,
    sellPrice: 2020,
    buyLiquidityUsd: 0,
    sellLiquidityUsd: 100000,
    flashLoanFeePercent: 0.05,
    dexFeePercentPerSwap: 0.3,
    estimatedGasUsd: 0.25,
    safetyMarginPercent: 0.1
  }));
});
