import "dotenv/config";
import { AgentWallet } from "./agentWallet.js";
import { buildAdapter, addressOf } from "./adapters.js";

function need(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(
      `\nMissing ${name}. Copy .env.example to .env and fill it in.\n` +
        `(You need a funded OWNER_PRIVATE_KEY on Arc Testnet and a throwaway AGENT_PRIVATE_KEY.)\n`
    );
    process.exit(1);
  }
  return v.trim();
}

function hr(title: string) {
  console.log("\n" + "─".repeat(56));
  console.log("  " + title);
  console.log("─".repeat(56));
}

async function main() {
  const ownerKey = need("OWNER_PRIVATE_KEY");
  const agentKey = need("AGENT_PRIVATE_KEY");
  const budget = Number(process.env.AGENT_BUDGET_USDC ?? "10");
  const deposit = Number(process.env.DEMO_DEPOSIT_USDC ?? "0");

  const ownerAddr = addressOf(ownerKey);
  const agentAddr = addressOf(agentKey);
  const recipient = (process.env.DEMO_RECIPIENT || ownerAddr).trim();

  console.log("\n  AgentWallet — a debit card for your AI agent, on Arc Testnet");
  console.log(`  Owner : ${ownerAddr}`);
  console.log(`  Agent : ${agentAddr}`);
  console.log(`  Budget: ${budget} USDC (app-enforced cap)`);
  console.log(`  Pays  : ${recipient}`);

  const wallet = new AgentWallet({
    ownerAdapter: buildAdapter(ownerKey),
    agentAdapter: buildAdapter(agentKey),
    agentAddress: agentAddr,
    budgetUsdc: budget,
  });

  wallet.onSpendEvent((p) => console.log("    [event]", JSON.stringify(p)));

  if (deposit > 0) {
    hr(`1. Owner funds unified balance (${deposit} USDC)`);
    await wallet.fund(deposit);
    console.log("  ✓ deposited");
  } else {
    hr("1. Skipping deposit (DEMO_DEPOSIT_USDC=0 — assuming already funded)");
  }

  hr("2. Owner authorizes the agent as a delegate");
  await wallet.authorizeAgent();
  console.log("  ✓ addDelegate sent — waiting for Gateway to finalize…");
  await wallet.waitUntilReady();
  console.log("  ✓ delegate status: ready — the agent can now spend");

  hr("3. Agent spends autonomously, within its budget");
  const planned = [
    Math.min(1, budget),
    Math.min(2, budget),
  ].filter((a) => a > 0);

  for (const amt of planned) {
    const rec = await wallet.spend(amt, recipient);
    console.log(
      `  ✓ paid ${amt} USDC → ${recipient}  (remaining: ${wallet.remaining.toFixed(2)})`
    );
    if (rec.explorerUrl) console.log(`     ${rec.explorerUrl}`);
  }

  hr("4. Agent tries to exceed the cap — blocked before it hits the chain");
  try {
    await wallet.spend(budget + 1, recipient);
    console.log("  ✗ (unexpected) spend succeeded — cap not enforced!");
  } catch (e) {
    console.log(`  ✓ blocked: ${(e as Error).message}`);
  }

  hr("5. Owner revokes the agent's allowance");
  await wallet.revokeAgent();
  console.log("  ✓ removeDelegate sent — agent can no longer spend");

  hr("Summary");
  console.log(`  Total spent: ${wallet.totalSpent} / ${budget} USDC`);
  console.log(`  Payments:    ${wallet.spendHistory.length}`);
  console.log("\n  Done.\n");
}

main().catch((e) => {
  console.error("\nDemo failed:", e);
  process.exit(1);
});
