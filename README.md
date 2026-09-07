# Base Arbitrage Paper Scanner

A read-only, no-wallet screening tool for multi-market and triangular liquidity-pool spreads on Base.

## Safety

- It does not request a seed phrase, private key, wallet connection, or funds.
- It does not submit transactions or take flash loans.
- Results are rough screening estimates, not guaranteed or executable profit.
- Never add wallet secrets to this repository or GitHub Actions.

## What it does

Every five minutes, GitHub Actions fetches public pool data for configured Base tokens and DEXs. It checks direct cross-pool spreads, temporary stablecoin routes, and three-swap triangular routes at $40, $100, $250, $500, and $1,000. It also counts qualifying pools created in the last seven days. Estimates subtract DEX fees, approximate liquidity impact, an assumed flash-loan fee, gas, and a safety margin before updating the phone-friendly dashboard.

The scanner tolerates one failed market-data request and records a warning instead of throwing away the whole scan. Its workflow also retries a rebased push if two runs finish close together.

## Important limitation

This version uses displayed market data and a conservative liquidity-impact approximation. Concentrated-liquidity pools and executable multi-hop quotes cannot be modeled accurately from total USD liquidity alone. A positive signal is a candidate for an on-chain quote and transaction simulation; it must **not** be treated as permission to trade.

## Run locally

```bash
npm test
npm run scan
```

Open `docs/index.html` through a local web server to view the dashboard.
