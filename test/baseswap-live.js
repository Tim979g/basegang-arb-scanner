import {
  Contract,
  JsonRpcProvider,
  parseUnits,
  formatUnits
} from "ethers";

const BASESWAP_ROUTER =
  "0x327Df1E6de05895d2ab08513aaDD9313Fe505d86";

const WETH =
  "0x4200000000000000000000000000000000000006";

const USDBC =
  "0xd9AAEC86B65D86f6A7B5B1b0c42FFA531710b6CA";

const ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)"
];

const RPC_URL =
  process.env.BASE_RPC_URL ??
  "https://mainnet.base.org";

const provider = new JsonRpcProvider(
  RPC_URL,
  8453,
  { staticNetwork: true }
);

const router = new Contract(
  BASESWAP_ROUTER,
  ROUTER_ABI,
  provider
);

console.log("Testing BaseSwap live quote...");
console.log("Route: USDbC -> WETH");

try {
  const amountIn = parseUnits("1", 6);

  const amounts = await router.getAmountsOut(
    amountIn,
    [USDBC, WETH],
    { blockTag: "pending" }
  );

  const wethOut = amounts[amounts.length - 1];

  if (wethOut <= 0n) {
    throw new Error("BaseSwap returned zero output");
  }

  console.log(
    `Input: 1 USDbC`
  );

  console.log(
    `Output: ${formatUnits(wethOut, 18)} WETH`
  );

  console.log(
    "BASESWAP LIVE QUOTE: PASS"
  );
} catch (error) {
  console.error(
    "BASESWAP LIVE QUOTE: FAIL"
  );

  console.error(
    error?.shortMessage ??
    error?.message ??
    error
  );

  process.exitCode = 1;
}
