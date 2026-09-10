import { JsonRpcProvider, Contract, parseUnits, formatUnits } from "ethers";

const RPC_URL = "https://mainnet.base.org";

const provider = new JsonRpcProvider(RPC_URL);

// Base tokens
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";

// Aerodrome Slipstream Quoter
const SLIPSTREAM_QUOTER =
  "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0";

const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,int24 tickSpacing,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"
];

async function main() {
  console.log("Testing Aerodrome Slipstream live quote...");
  console.log("Route: USDC -> WETH");

  const quoter = new Contract(
    SLIPSTREAM_QUOTER,
    QUOTER_ABI,
    provider
  );

  const amountIn = parseUnits("1", 6);

  // Common Slipstream tick spacing.
  // The live test will tell us whether this route exists at this spacing.
  const tickSpacing = 100;

  const params = {
    tokenIn: USDC,
    tokenOut: WETH,
    amountIn,
    tickSpacing,
    sqrtPriceLimitX96: 0
  };

  try {
    const result =
      await quoter.quoteExactInputSingle.staticCall(params);

    const amountOut = result[0];

    console.log(
      `1 USDC -> ${formatUnits(amountOut, 18)} WETH`
    );

    console.log(`Tick spacing: ${tickSpacing}`);

    if (amountOut > 0n) {
      console.log("SLIPSTREAM LIVE QUOTE: PASS");
    } else {
      console.log("SLIPSTREAM LIVE QUOTE: FAIL");
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      "SLIPSTREAM LIVE QUOTE: FAIL",
      error.shortMessage || error.message
    );

    process.exitCode = 1;
  }
}

main();
