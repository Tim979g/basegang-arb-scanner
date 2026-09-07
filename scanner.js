import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { estimateRoundTrip, findBestSpread } from "./lib/calculations.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await fs.readFile(path.join(root, "config.json"), "utf8"));
const outputPath = path.join(root, "docs", "data.json");

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchPools() {
  const url = `https://api.dexscreener.com/token-pairs/v1/${config.chain}/${config.baseToken.address}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Market-data request failed with HTTP ${response.status}`);
  const pairs = await response.json();
  const quote = config.quoteToken.address.toLowerCase();
  const base = config.baseToken.address.toLowerCase();

  return pairs
    .filter((pair) => pair.chainId === config.chain)
    .filter((pair) => pair.baseToken?.address?.toLowerCase() === base)
    .filter((pair) => pair.quoteToken?.address?.toLowerCase() === quote)
    .map((pair) => ({
      dex: pair.dexId,
      pairAddress: pair.pairAddress,
      url: pair.url,
      priceUsd: finiteNumber(pair.priceUsd),
      liquidityUsd: finiteNumber(pair.liquidity?.usd)
    }))
    .filter((pool) => pool.priceUsd > 0 && pool.liquidityUsd >= config.minimumPoolLiquidityUsd);
}

async function readData() {
  try {
    return JSON.parse(await fs.readFile(outputPath, "utf8"));
  } catch {
    return { generatedAt: null, config, history: [] };
  }
}

const timestamp = new Date().toISOString();
const data = await readData();

try {
  const pools = await fetchPools();
  const spread = findBestSpread(pools);
  const estimates = spread
    ? config.tradeSizesUsd.map((tradeSizeUsd) => estimateRoundTrip({
        tradeSizeUsd,
        buyPrice: spread.buy.priceUsd,
        sellPrice: spread.sell.priceUsd,
        buyLiquidityUsd: spread.buy.liquidityUsd,
        sellLiquidityUsd: spread.sell.liquidityUsd,
        flashLoanFeePercent: config.flashLoanFeePercent,
        dexFeePercentPerSwap: config.estimatedDexFeePercentPerSwap,
        estimatedGasUsd: config.estimatedGasUsd,
        safetyMarginPercent: config.safetyMarginPercent
      }))
    : [];

  const best = estimates.sort((a, b) => b.netProfitUsd - a.netProfitUsd)[0] ?? null;
  data.history.push({
    timestamp,
    status: spread ? "ok" : "insufficient_pools",
    poolsChecked: pools.length,
    buy: spread?.buy ?? null,
    sell: spread?.sell ?? null,
    estimates,
    best,
    opportunity: Boolean(best && best.netProfitUsd >= config.minimumEstimatedProfitUsd)
  });
} catch (error) {
  data.history.push({ timestamp, status: "error", message: error.message, opportunity: false });
}

data.generatedAt = timestamp;
data.config = config;
data.history = data.history.slice(-config.historyLimit);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(JSON.stringify(data.history.at(-1), null, 2));
