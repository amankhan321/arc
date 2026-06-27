# AgentWallet

**A spending-capped USDC wallet for AI agents — built on [Arc Testnet](https://www.arc.io/) with Circle App Kit.**

> *"I gave my AI a debit card with a spending limit."*

Most demos on Arc are checkout buttons or bridge UIs. AgentWallet uses a more interesting primitive: **delegated spending**. A human deposits USDC into a Gateway unified balance, authorizes an *agent's* address as a delegate, and sets a budget. The agent can then autonomously pay for things — API calls, data, compute, other agents' services — but **only up to the cap**, and the human can revoke it instantly.

The on-chain delegation is Circle App Kit's Gateway primitive (`addDelegate` → `getDelegateStatus` → `spend` → `removeDelegate`). The **spending cap is the part this repo adds** — a guardrail the protocol doesn't enforce for you, checked *before* a spend is ever signed.

## Why this matters

"Give the agent money, but bounded money" is one of the real open problems in agentic systems. AgentWallet is a minimal, working answer on rails purpose-built for it:

- **Bounded autonomy** — the agent spends on its own, but can't exceed the budget you set.
- **Instant revocation** — `revokeAgent()` cuts off the delegate immediately.
- **Stablecoin-native** — USDC is Arc's native gas token, so fees are dollar-denominated and predictable.
- **Sub-second settlement** — payments finalize in under a second.

## How it works

```
 ┌────────┐  deposit + authorize(budget)   ┌─────────────┐
 │ Human  │ ─────────────────────────────► │ AgentWallet │
 │ owner  │ ◄───────────── revoke ──────── │   (cap layer)│
 └────────┘                                 └──────┬──────┘
                                                   │ spend() — checked vs budget
                                                   ▼
                                         ┌────────────────────┐
                                         │  AI agent (delegate)│ ──► pays a service
                                         └────────────────────┘
```

The `AgentWallet` class (`src/agentWallet.ts`) wraps App Kit's `unifiedBalance` and tracks total spent against the cap. Any `spend()` that would exceed the remaining budget is rejected locally and never reaches the chain.

## Quickstart

```bash
npm install
cp .env.example .env      # fill in the keys
npm run demo
```

You'll need:
- An `OWNER_PRIVATE_KEY` funded with testnet USDC (get it from the [Circle Faucet](https://faucet.circle.com/) — pick Arc Testnet → USDC).
- A throwaway `AGENT_PRIVATE_KEY` (any fresh key).
- A budget in `AGENT_BUDGET_USDC`.

> Use **test keys only**. Never put a real-funds key in `.env`.

## What the demo does

`npm run demo` walks the whole story end to end:

1. Owner funds the unified balance (optional — skip if already funded).
2. Owner authorizes the agent as a delegate, then waits for Gateway to finalize (`status: ready`).
3. Agent spends a couple of small amounts autonomously, within budget.
4. Agent **tries to exceed the cap** — blocked before it hits the chain.
5. Owner revokes the agent.

## Dashboard

A visual control panel for the whole flow — the agent's card with a depleting spend limit, owner controls (Add funds / Authorize / Revoke), an agent payment console, and a live ledger.

```bash
npm run dashboard
# → http://localhost:5173
```

**Demo mode is on by default** when no keys are set, so the dashboard is fully clickable without faucet USDC — every action runs against a simulated wallet (clearly labeled "Demo mode" in the UI), with the delegate finalizing after a few seconds and synthetic tx hashes in the ledger. Perfect for a walkthrough video.

To run it **live** against Arc Testnet, set `OWNER_PRIVATE_KEY` and `AGENT_PRIVATE_KEY` in `.env` (or set `DEMO_MODE=1` to force mock even with keys present). Keys live only on the server — the browser never sees them; it just calls the local API.

## Using the library directly

```ts
import { AgentWallet } from "./src/agentWallet.js";
import { buildAdapter, addressOf } from "./src/adapters.js";

const wallet = new AgentWallet({
  ownerAdapter: buildAdapter(OWNER_KEY),
  agentAdapter: buildAdapter(AGENT_KEY),
  agentAddress: addressOf(AGENT_KEY),
  budgetUsdc: 10,
});

await wallet.authorizeAgent();
await wallet.waitUntilReady();

await wallet.spend(1.5, "0xService…");   // ✓ within budget
await wallet.spend(100, "0xService…");   // ✗ throws: Budget exceeded

await wallet.revokeAgent();
```

## Tech

- [`@circle-fin/app-kit`](https://www.npmjs.com/package/@circle-fin/app-kit) — Gateway / Unified Balance (deposit, delegate, spend).
- [`@circle-fin/adapter-viem-v2`](https://www.npmjs.com/package/@circle-fin/adapter-viem-v2) — viem signer adapter.
- Arc Testnet — chain `5042002`, USDC-native gas, explorer at [testnet.arcscan.app](https://testnet.arcscan.app).

## Status & honest caveats

- The code **typechecks against the published App Kit type definitions** and the module graph loads cleanly. The library and demo are wired to the real SDK method shapes (verified, not guessed).
- It has **not yet been run against a live funded wallet** end to end — that's the next step and needs faucet USDC. When you run it, the one thing to sanity-check is the delegated-spend source semantics: this code signs the `spend` with the *agent's* adapter and pulls from the unified balance via the delegate relationship. If Gateway expects the source specified differently for a delegated spend, it's a one-line change in `AgentWallet.spend()`.
- The spending cap is **app-enforced**, tracked in memory per process. For production you'd persist the running total and/or push the cap on-chain.

## License

MIT
