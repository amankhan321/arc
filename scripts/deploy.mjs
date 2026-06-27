// Deploy AgentAllowance to Arc Testnet.
//   DEPLOYER_PRIVATE_KEY=0x...  (funded with testnet USDC for gas)
//   USDC_ADDRESS=0x3600...0000  (optional; defaults to Arc Testnet USDC)
//   ARC_RPC=https://rpc.testnet.arc.network/  (optional)
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createWalletClient, createPublicClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AgentAllowance = JSON.parse(readFileSync(join(__dirname, "..", "artifacts", "AgentAllowance.json"), "utf8"));

const ARC_RPC = process.env.ARC_RPC || "https://rpc.testnet.arc.network/";
const USDC = process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000";

const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [ARC_RPC] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
  testnet: true,
});

function key() {
  const k = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!k) { console.error("Set DEPLOYER_PRIVATE_KEY in .env (test key funded with Arc Testnet USDC)."); process.exit(1); }
  return "0x" + k.replace(/^0x/, "");
}

async function main() {
  const account = privateKeyToAccount(key());
  const pub = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) });
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(ARC_RPC) });

  console.log(`Deploying AgentAllowance to Arc Testnet`);
  console.log(`  deployer: ${account.address}`);
  console.log(`  usdc:     ${USDC}`);

  const hash = await wallet.deployContract({
    abi: AgentAllowance.abi,
    bytecode: AgentAllowance.bytecode,
    args: [USDC],
  });
  console.log(`  tx:       ${hash}`);
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  console.log(`\n✓ Deployed at ${rcpt.contractAddress}`);
  console.log(`  https://testnet.arcscan.app/address/${rcpt.contractAddress}`);
  console.log(`\nSet CONTRACT_ADDRESS=${rcpt.contractAddress} in .env to use the interact script.`);
}

main().catch((e) => { console.error("\nDeploy failed:", e); process.exit(1); });
