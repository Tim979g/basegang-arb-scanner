import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { estimateRoundTrip, estimateTriangle, findBestSpread } from "./lib/calculations.js";
import { LiveQuoteVerifier } from "./lib/liveQuotes.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await fs.readFile(path.join(root, "config.json"), "utf8"));
const outputPath = path.join(root, "docs", "data.json");
const tokenByAddress = new Map(config.tokens.map((token) => [token.address.toLowerCase(), token]));
const tokenBySymbol = new Map(config.tokens.map((token) => [token.symbol, token]));
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

async function fetchTokenPairs(token) {
  const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/${config.chain}/${token.address}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${token.symbol} request failed: HTTP ${response.status}`);
  return response.json();
}

async function fetchPools() {
  const results = await Promise.allSettled(config.tokens.map(fetchTokenPairs));
  const warnings = results.filter((r) => r.status === "rejected").map((r) => r.reason.message);
  const unique = new Map();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const pair of result.value) {
      const baseAddress = pair.baseToken?.address?.toLowerCase();
      const quoteAddress = pair.quoteToken?.address?.toLowerCase();
      if (pair.chainId !== config.chain || !tokenByAddress.has(baseAddress) || !tokenByAddress.has(quoteAddress)) continue;
      const liquidityUsd = number(pair.liquidity?.usd);
      const rate = number(pair.priceNative);
      if (!(liquidityUsd > 0 && rate > 0)) continue;
      unique.set(pair.pairAddress.toLowerCase(), { dex: pair.dexId, pairAddress: pair.pairAddress, url: pair.url, base: tokenByAddress.get(baseAddress), quote: tokenByAddress.get(quoteAddress), rate, basePriceUsd: number(pair.priceUsd), liquidityUsd, pairCreatedAt: number(pair.pairCreatedAt) });
    }
  }
  return { pools: [...unique.values()], warnings };
}

function directMarkets(pools) {
  const markets = new Map();
  for (const pool of pools) {
    const stable = pool.base.stable ? pool.base : pool.quote.stable ? pool.quote : null;
    const asset = stable === pool.base ? pool.quote : pool.base;
    if (!stable || asset.stable || !(pool.basePriceUsd > 0)) continue;
    const assetPriceUsd = pool.base === asset ? pool.basePriceUsd : pool.basePriceUsd / pool.rate;
    const key = `${asset.symbol}/${stable.symbol}`;
    if (!markets.has(key)) markets.set(key, []);
    markets.get(key).push({ ...pool, asset: asset.symbol, stable: stable.symbol, assetPriceUsd });
  }
  return markets;
}

function bestDirectedEdges(pools) {
  const edges = new Map();
  for (const pool of pools) {
    for (const direction of [{ from: pool.base.symbol, to: pool.quote.symbol, rate: pool.rate }, { from: pool.quote.symbol, to: pool.base.symbol, rate: 1 / pool.rate }]) {
      const key = `${direction.from}>${direction.to}`;
      const candidate = { ...direction, dex: pool.dex, pairAddress: pool.pairAddress, url: pool.url, liquidityUsd: pool.liquidityUsd };
      if (!edges.has(key) || candidate.rate > edges.get(key).rate) edges.set(key, candidate);
    }
  }
  return edges;
}

function triangleCandidates(pools) {
  const edges = bestDirectedEdges(pools);
  const routes = [];
  for (const start of config.tokens.filter((token) => token.stable)) for (const middle of config.tokens.filter((token) => token.symbol !== start.symbol)) for (const end of config.tokens.filter((token) => token.symbol !== start.symbol && token.symbol !== middle.symbol)) {
    const routeEdges = [edges.get(`${start.symbol}>${middle.symbol}`), edges.get(`${middle.symbol}>${end.symbol}`), edges.get(`${end.symbol}>${start.symbol}`)];
    if (routeEdges.every(Boolean) && new Set(routeEdges.map((edge) => edge.pairAddress)).size === 3) routes.push({ route: [start.symbol, middle.symbol, end.symbol, start.symbol], edges: routeEdges });
  }
  return routes;
}

async function readData() {
  try { return JSON.parse(await fs.readFile(outputPath, "utf8")); } catch { return { generatedAt: null, config, history: [] }; }
}

const timestamp = new Date().toISOString();
const data = await readData();
try {
  const { pools, warnings } = await fetchPools();
  const eligible = pools.filter((pool) => pool.liquidityUsd >= config.minimumPoolLiquidityUsd);
  const direct = [];
  for (const [market, marketPools] of directMarkets(eligible)) {
    const spread = findBestSpread(marketPools);
    if (!spread || spread.buy.pairAddress === spread.sell.pairAddress) continue;
    const estimates = config.tradeSizesUsd.map((tradeSizeUsd) => estimateRoundTrip({ tradeSizeUsd, buyPrice: spread.buy.assetPriceUsd, sellPrice: spread.sell.assetPriceUsd, buyLiquidityUsd: spread.buy.liquidityUsd, sellLiquidityUsd: spread.sell.liquidityUsd, flashLoanFeePercent: config.flashLoanFeePercent, dexFeePercentPerSwap: config.estimatedDexFeePercentPerSwap, estimatedGasUsd: config.estimatedGasUsd, safetyMarginPercent: config.safetyMarginPercent }));
    direct.push({ market, buy: spread.buy, sell: spread.sell, estimates, best: estimates.sort((a,b) => b.netProfitUsd-a.netProfitUsd)[0] });
  }
  direct.sort((a,b) => b.best.netProfitUsd-a.best.netProfitUsd);
  const triangles = triangleCandidates(eligible).map((candidate) => {
    const estimates = config.tradeSizesUsd.map((tradeSizeUsd) => estimateTriangle({ tradeSizeUsd, edges: candidate.edges, flashLoanFeePercent: config.flashLoanFeePercent, dexFeePercentPerSwap: config.estimatedDexFeePercentPerSwap, estimatedGasUsd: config.estimatedGasUsd, safetyMarginPercent: config.safetyMarginPercent }));
    return { ...candidate, estimates, best: estimates.sort((a,b) => b.netProfitUsd-a.netProfitUsd)[0] };
  }).sort((a,b) => b.best.netProfitUsd-a.best.netProfitUsd);
  const cutoff = Date.now() - config.newPoolMaxAgeHours * 3600000;
  const newPools = pools.filter((pool) => pool.liquidityUsd >= config.minimumNewPoolLiquidityUsd && pool.pairCreatedAt >= cutoff);
  const candidates = [...direct.map((item) => ({ type: "direct", route: item.market, ...item.best })), ...triangles.map((item) => ({ type: "triangle", route: item.route.join(" → "), ...item.best }))];
  const best = candidates.sort((a,b) => b.netProfitUsd-a.netProfitUsd)[0] ?? null;
  const verifier = new LiveQuoteVerifier(config.rpcUrl);
  const costs = { flashLoanFeePercent: config.flashLoanFeePercent, estimatedGasUsd: config.estimatedGasUsd, safetyMarginPercent: config.safetyMarginPercent };
  const liveQuotes = [];
  for (const item of direct.filter((candidate) => candidate.best.netProfitUsd >= -0.5).slice(0, 3)) {
    for (const estimate of item.estimates.filter((candidate) => candidate.netProfitUsd >= -0.5)) {
      const quote = await verifier.verifyDirect(item, estimate.tradeSizeUsd, costs);
      liveQuotes.push({ type: "direct", route: item.market, screeningNetProfitUsd: estimate.netProfitUsd, ...quote });
    }
  }
  for (const item of triangles.filter((candidate) => candidate.best.netProfitUsd >= -0.5).slice(0, 3)) {
    for (const estimate of item.estimates.filter((candidate) => candidate.netProfitUsd >= -0.5)) {
      const quote = await verifier.verifyTriangle(item, estimate.tradeSizeUsd, tokenBySymbol, costs);
      liveQuotes.push({ type: "triangle", route: item.route.join(" → "), screeningNetProfitUsd: estimate.netProfitUsd, ...quote });
    }
  }
  const verified = liveQuotes.filter((quote) => quote.status === "verified").sort((a,b) => b.netProfitUsd-a.netProfitUsd);
  const bestVerified = verified[0] ?? null;
  data.history.push({ timestamp, status: eligible.length ? "ok" : "insufficient_pools", poolsChecked: pools.length, eligiblePools: eligible.length, marketsChecked: direct.length, triangularRoutesChecked: triangles.length, newPoolsFound: newPools.length, warnings, direct: direct.slice(0,10), triangles: triangles.slice(0,10), liveQuotes, best, bestVerified, screeningOpportunity: Boolean(best && best.netProfitUsd >= config.minimumEstimatedProfitUsd), opportunity: Boolean(bestVerified && bestVerified.netProfitUsd >= config.minimumEstimatedProfitUsd) });
} catch (error) {
  data.history.push({ timestamp, status: "error", message: error.message, opportunity: false });
}
data.generatedAt = timestamp;
data.config = config;
data.history = data.history.slice(-config.historyLimit);
await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(JSON.stringify(data.history.at(-1), null, 2));
