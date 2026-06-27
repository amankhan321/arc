import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ServerWallet } from "./walletTypes.js";
import { AgentWallet } from "./agentWallet.js";
import { MockWallet } from "./mockWallet.js";
import { buildAdapter, addressOf } from "./adapters.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const budget = Number(process.env.AGENT_BUDGET_USDC ?? "10");
const ownerKey = process.env.OWNER_PRIVATE_KEY?.trim();
const agentKey = process.env.AGENT_PRIVATE_KEY?.trim();
const forceMock = process.env.DEMO_MODE === "1";
const haveKeys = Boolean(ownerKey && agentKey);
const useMock = forceMock || !haveKeys;

let ownerAddress: string;
let agentAddress: string;
let wallet: ServerWallet;

if (useMock) {
  ownerAddress = ownerKey ? addressOf(ownerKey) : "0xOWNER0000000000000000000000000000000000";
  agentAddress = agentKey ? addressOf(agentKey) : "0xA6E70000000000000000000000000000000000aa";
  wallet = new MockWallet(budget);
} else {
  ownerAddress = addressOf(ownerKey!);
  agentAddress = addressOf(agentKey!);
  wallet = new AgentWallet({
    ownerAdapter: buildAdapter(ownerKey!),
    agentAdapter: buildAdapter(agentKey!),
    agentAddress,
    budgetUsdc: budget,
  });
}

const recipientDefault = (process.env.DEMO_RECIPIENT || ownerAddress).trim();

// ---- tiny SSE pub/sub for the live feed ----
type Client = { id: number; res: express.Response };
let clients: Client[] = [];
let nextId = 1;
function broadcast(event: Record<string, unknown>) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  clients.forEach((c) => c.res.write(data));
}
wallet.onSpendEvent((payload) => broadcast({ type: "wallet", payload }));

async function snapshot() {
  return {
    mock: useMock,
    owner: ownerAddress,
    agent: agentAddress,
    recipientDefault,
    budget,
    spent: wallet.totalSpent,
    remaining: wallet.remaining,
    status: await wallet.delegateStatus(),
    history: wallet.spendHistory,
  };
}

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "..", "public")));

app.get("/api/state", async (_req, res) => {
  res.json(await snapshot());
});

app.get("/api/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();
  const id = nextId++;
  clients.push({ id, res });
  res.write(`data: ${JSON.stringify({ type: "hello" })}\n\n`);
  req.on("close", () => {
    clients = clients.filter((c) => c.id !== id);
  });
});

app.post("/api/fund", async (req, res) => {
  try {
    const amount = Number(req.body?.amount ?? 0);
    await wallet.fund(amount);
    broadcast({ type: "fund", amount });
    res.json(await snapshot());
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/authorize", async (_req, res) => {
  try {
    await wallet.authorizeAgent();
    broadcast({ type: "authorize" });
    res.json(await snapshot());
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/revoke", async (_req, res) => {
  try {
    await wallet.revokeAgent();
    broadcast({ type: "revoke" });
    res.json(await snapshot());
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/spend", async (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    const recipient = String(req.body?.recipient || recipientDefault);
    const record = await wallet.spend(amount, recipient);
    broadcast({ type: "spend", record });
    res.json({ record, state: await snapshot() });
  } catch (e) {
    broadcast({ type: "blocked", message: (e as Error).message });
    res.status(400).json({ error: (e as Error).message });
  }
});

const port = Number(process.env.PORT ?? 5173);
app.listen(port, () => {
  console.log(`\n  AgentWallet dashboard → http://localhost:${port}`);
  console.log(`  Mode: ${useMock ? "MOCK (no on-chain calls)" : "LIVE (Arc Testnet)"}`);
  console.log(`  Owner ${ownerAddress}`);
  console.log(`  Agent ${agentAddress}`);
  console.log(`  Budget ${budget} USDC\n`);
});
