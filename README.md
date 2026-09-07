# Base Arbitrage Paper Scanner

A read-only, no-wallet screening tool for WETH/USDC liquidity-pool spreads on Base.

## Safety

- It does not request a seed phrase, private key, wallet connection, or funds.
- It does not submit transactions or take flash loans.
- Results are rough screening estimates, not guaranteed or executable profit.
- Never add wallet secrets to this repository or GitHub Actions.

## What it does

Every five minutes, GitHub Actions fetches public WETH/USDC pool data, finds the lowest and highest observed pool price, estimates a round trip at several trade sizes, subtracts configured DEX fees, approximate liquidity impact, Aave-style flash-loan fees, estimated gas, and a safety margin, then updates the phone-friendly dashboard.

This first test measures whether potentially interesting spreads appear often enough to justify a later on-chain quoter and block-simulation build.

## Important limitation

This version uses displayed market data and a conservative liquidity-impact approximation. Concentrated-liquidity pools cannot be modeled accurately from total USD liquidity alone. A positive signal must **not** be treated as permission to trade.

## Run locally

```bash
npm test
npm run scan
```

Open `docs/index.html` through a local web server to view the dashboard.
