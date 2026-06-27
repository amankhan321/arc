// Local EVM test suite for AgentAllowance using ganache (in-process) + viem.
// Proves the on-chain spending cap and access control before testnet deploy.
import ganache from "ganache";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createWalletClient, createPublicClient, custom, parseUnits, defineChain,
  encodeFunctionData, decodeErrorResult,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const art = (n) => JSON.parse(readFileSync(join(__dirname, "..", "artifacts", n + ".json"), "utf8"));
const AgentAllowance = art("AgentAllowance");
const MockUSDC = art("MockUSDC");

// Well-known local dev keys (Hardhat/Anvil defaults) — local sim only.
const KEYS = {
  owner: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  agent: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  recipient: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  stranger: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
};
const acct = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, privateKeyToAccount(v)]));
const localChain = defineChain({ id: 1337, name: "ganache", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [] } } });
const USDC = (n) => parseUnits(String(n), 6);

let passed = 0;
const fails = [];
function ok(name, cond) {
  if (cond) { passed++; console.log("  \u2713", name); }
  else { fails.push(name); console.log("  \u2717", name); }
}

async function main() {
  const provider = ganache.provider({
    logging: { quiet: true },
    miner: { instamine: "eager" },
    chain: { chainId: 1337 },
    wallet: { accounts: Object.values(KEYS).map((secretKey) => ({ secretKey, balance: "0x" + (10n ** 21n).toString(16) })) },
  });
  const transport = custom(provider);
  const pub = createPublicClient({ chain: localChain, transport });
  const wallet = (account) => createWalletClient({ account, chain: localChain, transport });

  async function send(account, params) {
    const hash = await wallet(account).writeContract(params);
    return pub.waitForTransactionReceipt({ hash });
  }
  const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });

  // Assert a call reverts with a specific custom error, recovered from raw revert data.
  async function expectRevert(name, callParams, errName) {
    const data = encodeFunctionData({ abi: callParams.abi, functionName: callParams.functionName, args: callParams.args });
    try {
      await provider.request({ method: "eth_call", params: [{ from: callParams.account.address, to: callParams.address, data }, "latest"] });
      fails.push(name); console.log("  \u2717", name, "(expected revert, got success)");
    } catch (e) {
      let decoded = null;
      try { decoded = decodeErrorResult({ abi: callParams.abi, data: e.data }).errorName; } catch {}
      if (!errName || decoded === errName) { passed++; console.log("  \u2713", name, `(${decoded || "revert"})`); }
      else { fails.push(name); console.log("  \u2717", name, `(got ${decoded || e.message})`); }
    }
  }

  console.log("\nDeploying MockUSDC + AgentAllowance on local EVM…\n");
  let hash = await wallet(acct.owner).deployContract({ abi: MockUSDC.abi, bytecode: MockUSDC.bytecode });
  const usdcAddr = (await pub.waitForTransactionReceipt({ hash })).contractAddress;
  hash = await wallet(acct.owner).deployContract({ abi: AgentAllowance.abi, bytecode: AgentAllowance.bytecode, args: [usdcAddr] });
  const alAddr = (await pub.waitForTransactionReceipt({ hash })).contractAddress;
  const ALLOW = (fn, args, account = acct.agent) => ({ address: alAddr, abi: AgentAllowance.abi, functionName: fn, args, account });

  console.log("Tests:\n");

  ok("owner is deployer", (await read(alAddr, AgentAllowance.abi, "owner")).toLowerCase() === acct.owner.address.toLowerCase());
  ok("usdc wired", (await read(alAddr, AgentAllowance.abi, "usdc")).toLowerCase() === usdcAddr.toLowerCase());

  await send(acct.owner, { address: usdcAddr, abi: MockUSDC.abi, functionName: "mint", args: [acct.owner.address, USDC(1000)] });
  await send(acct.owner, { address: usdcAddr, abi: MockUSDC.abi, functionName: "approve", args: [alAddr, USDC(100)] });
  await send(acct.owner, ALLOW("deposit", [USDC(100)], acct.owner));
  ok("deposit funds treasury (100)", (await read(alAddr, AgentAllowance.abi, "treasury")) === USDC(100));

  // access control
  await expectRevert("stranger cannot authorize", ALLOW("authorizeAgent", [acct.agent.address, USDC(10)], acct.stranger), "NotOwner");
  await expectRevert("stranger cannot deposit", ALLOW("deposit", [USDC(1)], acct.stranger), "NotOwner");
  await expectRevert("unauthorized agent cannot spend", ALLOW("spend", [acct.recipient.address, USDC(1), "x"]), "NotActiveAgent");

  // authorize cap=10
  await send(acct.owner, ALLOW("authorizeAgent", [acct.agent.address, USDC(10)], acct.owner));
  {
    const [cap, spent, active] = await read(alAddr, AgentAllowance.abi, "allowanceOf", [acct.agent.address]);
    ok("authorize sets cap/active", cap === USDC(10) && spent === 0n && active === true);
    ok("remaining = 10", (await read(alAddr, AgentAllowance.abi, "remaining", [acct.agent.address])) === USDC(10));
  }

  // spend within cap
  await send(acct.agent, ALLOW("spend", [acct.recipient.address, USDC(4), "invoice #1"]));
  ok("recipient received 4 USDC", (await read(usdcAddr, MockUSDC.abi, "balanceOf", [acct.recipient.address])) === USDC(4));
  ok("treasury now 96", (await read(alAddr, AgentAllowance.abi, "treasury")) === USDC(96));
  ok("remaining = 6", (await read(alAddr, AgentAllowance.abi, "remaining", [acct.agent.address])) === USDC(6));

  await send(acct.agent, ALLOW("spend", [acct.recipient.address, USDC(6), "invoice #2"]));
  ok("remaining = 0 at cap", (await read(alAddr, AgentAllowance.abi, "remaining", [acct.agent.address])) === 0n);

  // cap enforced + no funds move on rejected spend
  const recipBefore = await read(usdcAddr, MockUSDC.abi, "balanceOf", [acct.recipient.address]);
  const treasBefore = await read(alAddr, AgentAllowance.abi, "treasury");
  await expectRevert("spend over cap reverts", ALLOW("spend", [acct.recipient.address, USDC(1), "over"]), "CapExceeded");
  ok("rejected over-cap spend moved no funds",
    (await read(usdcAddr, MockUSDC.abi, "balanceOf", [acct.recipient.address])) === recipBefore &&
    (await read(alAddr, AgentAllowance.abi, "treasury")) === treasBefore);

  // raise cap, preserve spent
  await send(acct.owner, ALLOW("authorizeAgent", [acct.agent.address, USDC(15)], acct.owner));
  {
    const [cap, spent] = await read(alAddr, AgentAllowance.abi, "allowanceOf", [acct.agent.address]);
    ok("raise cap to 15, spent preserved (10)", cap === USDC(15) && spent === USDC(10));
    ok("remaining = 5 after raise", (await read(alAddr, AgentAllowance.abi, "remaining", [acct.agent.address])) === USDC(5));
  }
  await send(acct.agent, ALLOW("spend", [acct.recipient.address, USDC(5), "invoice #3"]));
  ok("recipient total 15", (await read(usdcAddr, MockUSDC.abi, "balanceOf", [acct.recipient.address])) === USDC(15));

  // treasury shortfall (cap allows, funds don't)
  await send(acct.owner, ALLOW("authorizeAgent", [acct.agent.address, USDC(1000)], acct.owner));
  // remaining cap is 985 but treasury is only 85; spend 90 → under cap, over treasury
  await expectRevert("spend beyond treasury reverts", ALLOW("spend", [acct.recipient.address, USDC(90), "too much"]), "InsufficientTreasury");

  // revoke
  await send(acct.owner, ALLOW("revokeAgent", [acct.agent.address], acct.owner));
  ok("revoked agent remaining = 0", (await read(alAddr, AgentAllowance.abi, "remaining", [acct.agent.address])) === 0n);
  await expectRevert("revoked agent cannot spend", ALLOW("spend", [acct.recipient.address, USDC(1), "after revoke"]), "NotActiveAgent");

  // withdraw
  const treasuryBefore = await read(alAddr, AgentAllowance.abi, "treasury");
  const ownerBefore = await read(usdcAddr, MockUSDC.abi, "balanceOf", [acct.owner.address]);
  await send(acct.owner, ALLOW("withdraw", [treasuryBefore], acct.owner));
  ok("withdraw empties treasury", (await read(alAddr, AgentAllowance.abi, "treasury")) === 0n);
  ok("withdraw returns funds to owner", (await read(usdcAddr, MockUSDC.abi, "balanceOf", [acct.owner.address])) === ownerBefore + treasuryBefore);
  await expectRevert("stranger cannot withdraw", ALLOW("withdraw", [USDC(1)], acct.stranger), "NotOwner");

  // zero-amount guard
  await send(acct.owner, ALLOW("authorizeAgent", [acct.agent.address, USDC(10)], acct.owner));
  await expectRevert("zero-amount spend reverts", ALLOW("spend", [acct.recipient.address, 0n, "zero"]), "ZeroAmount");

  console.log(`\n${passed} passed, ${fails.length} failed`);
  if (fails.length) { console.log("FAILED:", fails.join(", ")); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
