// Drive the deployed AgentAllowance on Arc Testnet end to end with real USDC.
//   CONTRACT_ADDRESS=0x...        (from deploy)
//   OWNER_PRIVATE_KEY=0x...       (funded with testnet USDC)
//   AGENT_PRIVATE_KEY=0x...       (throwaway; needs a little USDC for gas)
//   DEMO_RECIPIENT=0x...          (optional; defaults to owner)
//   USDC_ADDRESS / ARC_RPC        (optional)
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createWalletClient, createPublicClient, http, defineChain, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AgentAllowance = JSON.parse(readFileSync(join(__dirname, "..", "artifacts", "AgentAllowance.json"), "utf8")).abi;

const ARC_RPC = process.env.ARC_RPC || "https://rpc.testnet.arc.network/";
const USDC = process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
const CONTRACT = process.env.CONTRACT_ADDRESS?.trim();

const usdcAbi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
];

const arcTestnet = defineChain({
  id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [ARC_RPC] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } }, testnet: true,
});

const need = (n) => { const v = process.env[n]?.trim(); if (!v) { console.error(`Missing ${n} in .env`); process.exit(1); } return v; };
const k = (n) => "0x" + need(n).replace(/^0x/, "");
const usdc6 = (n) => parseUnits(String(n), 6);
const fmt = (n) => formatUnits(n, 6);
const tx = (h) => `https://testnet.arcscan.app/tx/${h}`;

async function main() {
  if (!CONTRACT) { console.error("Set CONTRACT_ADDRESS in .env (from the deploy step)."); process.exit(1); }
  const owner = privateKeyToAccount(k("OWNER_PRIVATE_KEY"));
  const agent = privateKeyToAccount(k("AGENT_PRIVATE_KEY"));
  const recipient = (process.env.DEMO_RECIPIENT || owner.address).trim();

  const pub = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) });
  const w = (acct) => createWalletClient({ account: acct, chain: arcTestnet, transport: http(ARC_RPC) });
  const wait = (hash) => pub.waitForTransactionReceipt({ hash });
  const read = (fn, args = []) => pub.readContract({ address: CONTRACT, abi: AgentAllowance, functionName: fn, args });

  console.log(`\nAgentAllowance @ ${CONTRACT}`);
  console.log(`owner ${owner.address}\nagent ${agent.address}\npays  ${recipient}\n`);

  const CAP = usdc6(5);
  const DEPOSIT = usdc6(10);

  console.log("1. owner approves + deposits 10 USDC");
  await wait(await w(owner).writeContract({ address: USDC, abi: usdcAbi, functionName: "approve", args: [CONTRACT, DEPOSIT] }));
  let h = await w(owner).writeContract({ address: CONTRACT, abi: AgentAllowance, functionName: "deposit", args: [DEPOSIT] });
  console.log("   " + tx(h)); await wait(h);
  console.log(`   treasury = ${fmt(await read("treasury"))} USDC`);

  console.log("2. owner authorizes agent with a 5 USDC cap");
  h = await w(owner).writeContract({ address: CONTRACT, abi: AgentAllowance, functionName: "authorizeAgent", args: [agent.address, CAP] });
  console.log("   " + tx(h)); await wait(h);
  console.log(`   remaining = ${fmt(await read("remaining", [agent.address]))} USDC`);

  console.log("3. agent pays 2 USDC to recipient");
  h = await w(agent).writeContract({ address: CONTRACT, abi: AgentAllowance, functionName: "spend", args: [recipient, usdc6(2), "live test payment"] });
  console.log("   " + tx(h)); await wait(h);
  console.log(`   remaining = ${fmt(await read("remaining", [agent.address]))} USDC`);

  console.log("4. agent tries to overspend (10 > remaining) — should revert on-chain");
  try {
    const sim = await pub.simulateContract({ address: CONTRACT, abi: AgentAllowance, functionName: "spend", args: [recipient, usdc6(10), "over cap"], account: agent });
    await wait(await w(agent).writeContract(sim.request));
    console.log("   ✗ unexpected success");
  } catch (e) {
    console.log(`   ✓ reverted: ${e.shortMessage || e.message}`);
  }

  console.log("5. owner revokes agent");
  h = await w(owner).writeContract({ address: CONTRACT, abi: AgentAllowance, functionName: "revokeAgent", args: [agent.address] });
  console.log("   " + tx(h)); await wait(h);

  const [cap, spent] = await read("allowanceOf", [agent.address]);
  console.log(`\nDone. agent spent ${fmt(spent)} of ${fmt(cap)} USDC cap. All txs on Arcscan above.\n`);
}

main().catch((e) => { console.error("\nInteract failed:", e); process.exit(1); });
