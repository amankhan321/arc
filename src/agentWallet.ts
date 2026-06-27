import { AppKit } from "@circle-fin/app-kit";
import type { ViemAdapter } from "@circle-fin/adapter-viem-v2";
import { ARC_CHAIN_ID } from "./chain.js";

export interface AgentWalletConfig {
  /** The human owner's adapter — funds the balance and manages the delegate. */
  ownerAdapter: ViemAdapter;
  /** The agent's adapter — signs spends once authorized. */
  agentAdapter: ViemAdapter;
  /** The agent's wallet address (the delegate). */
  agentAddress: string;
  /** Total USDC the agent is allowed to spend, ever. Enforced app-side. */
  budgetUsdc: number;
}

export interface SpendRecord {
  amount: number;
  recipient: string;
  txHash: string;
  explorerUrl?: string;
  at: string;
}

/**
 * AgentWallet — gives an AI agent its own USDC spending allowance on Arc.
 *
 * The owner funds a Gateway unified balance and authorizes the agent's address
 * as a delegate. The agent can then autonomously `spend()` USDC — but every
 * spend is checked against a budget cap this class enforces *before* the call
 * ever reaches the chain. The owner can revoke instantly.
 *
 * The on-chain delegation (addDelegate / getDelegateStatus / spend / removeDelegate)
 * is Circle App Kit's Gateway primitive. The spending *cap* is the value this
 * wrapper adds: a guardrail the protocol doesn't enforce for you.
 */
export class AgentWallet {
  private readonly kit: AppKit;
  private readonly cfg: AgentWalletConfig;
  private spent = 0;
  private readonly history: SpendRecord[] = [];

  constructor(cfg: AgentWalletConfig) {
    this.cfg = cfg;
    this.kit = new AppKit();
  }

  /** How much of the budget remains. */
  get remaining(): number {
    return Math.max(0, this.cfg.budgetUsdc - this.spent);
  }

  get totalSpent(): number {
    return this.spent;
  }

  get spendHistory(): readonly SpendRecord[] {
    return this.history;
  }

  /** Owner deposits USDC into their unified balance on Arc. */
  async fund(amountUsdc: number): Promise<void> {
    await this.kit.unifiedBalance.deposit({
      from: { adapter: this.cfg.ownerAdapter, chain: ARC_CHAIN_ID },
      amount: String(amountUsdc),
      token: "USDC",
    });
  }

  /** Owner authorizes the agent as a delegate (grants the allowance). */
  async authorizeAgent(): Promise<void> {
    await this.kit.unifiedBalance.addDelegate({
      from: { adapter: this.cfg.ownerAdapter, chain: ARC_CHAIN_ID },
      delegateAddress: this.cfg.agentAddress,
    });
  }

  /** Owner revokes the agent's spending rights, immediately. */
  async revokeAgent(): Promise<void> {
    await this.kit.unifiedBalance.removeDelegate({
      from: { adapter: this.cfg.ownerAdapter, chain: ARC_CHAIN_ID },
      delegateAddress: this.cfg.agentAddress,
    });
  }

  /** Delegate finality status: 'none' | 'pending' | 'ready'. */
  async delegateStatus(): Promise<string> {
    return this.kit.unifiedBalance.getDelegateStatus({
      from: { adapter: this.cfg.ownerAdapter, chain: ARC_CHAIN_ID },
      delegateAddress: this.cfg.agentAddress,
    });
  }

  /** Poll until the delegation is finalized (status === 'ready') or it times out. */
  async waitUntilReady(opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const intervalMs = opts.intervalMs ?? 3_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.delegateStatus();
      if (status === "ready") return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Delegate did not reach 'ready' within ${timeoutMs}ms`);
  }

  /** Aggregated USDC unified balance for an address (defaults to the owner). */
  async balanceOf(address?: string): Promise<unknown> {
    return this.kit.unifiedBalance.getBalances({
      token: "USDC",
      sources: { address: address ?? this.cfg.agentAddress },
    });
  }

  /**
   * The agent spends USDC to a recipient — but only if it stays within budget.
   *
   * The cap is checked here, before anything touches the chain. A spend that
   * would exceed the remaining budget is rejected outright and never signed.
   */
  async spend(amountUsdc: number, recipient: string): Promise<SpendRecord> {
    if (amountUsdc <= 0) {
      throw new Error("Spend amount must be positive.");
    }
    if (amountUsdc > this.remaining) {
      throw new Error(
        `Budget exceeded: tried to spend ${amountUsdc} USDC but only ${this.remaining.toFixed(
          2
        )} USDC remains (cap ${this.cfg.budgetUsdc}, already spent ${this.spent}).`
      );
    }

    const result = await this.kit.unifiedBalance.spend({
      from: {
        adapter: this.cfg.agentAdapter,
        allocations: [{ amount: String(amountUsdc), chain: ARC_CHAIN_ID }],
      },
      to: {
        adapter: this.cfg.agentAdapter,
        chain: ARC_CHAIN_ID,
        recipientAddress: recipient,
      },
      amount: String(amountUsdc),
      token: "USDC",
    });

    this.spent += amountUsdc;
    const record: SpendRecord = {
      amount: amountUsdc,
      recipient,
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      at: new Date().toISOString(),
    };
    this.history.push(record);
    return record;
  }

  /** Subscribe to live Gateway spend lifecycle events (for activity feeds/UIs). */
  onSpendEvent(handler: (payload: unknown) => void): void {
    this.kit.unifiedBalance.on("gateway.spend.succeeded", handler);
    this.kit.unifiedBalance.on("gateway.spend.started", handler);
  }
}
