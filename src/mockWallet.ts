import type { ServerWallet, SpendRecord } from "./walletTypes.js";

/**
 * A fake AgentWallet that mimics the real on-chain flow timing so the
 * dashboard is fully demoable without faucet USDC. Clearly labeled in the UI.
 *
 * - authorizeAgent(): status none → pending → (after a short delay) ready
 * - spend(): enforces the same budget cap, returns a synthetic tx hash
 * - revokeAgent(): status → none
 */
export class MockWallet implements ServerWallet {
  private spent = 0;
  private status: "none" | "pending" | "ready" = "none";
  private readyAt = 0;
  private readonly history: SpendRecord[] = [];
  private handlers: ((p: unknown) => void)[] = [];

  constructor(private readonly budgetUsdc: number, private readonly finalizeMs = 4000) {}

  get remaining() {
    return Math.max(0, this.budgetUsdc - this.spent);
  }
  get totalSpent() {
    return this.spent;
  }
  get spendHistory(): readonly SpendRecord[] {
    return this.history;
  }

  async fund(_amountUsdc: number): Promise<void> {
    await wait(400);
  }

  async authorizeAgent(): Promise<void> {
    await wait(400);
    this.status = "pending";
    this.readyAt = Date.now() + this.finalizeMs;
  }

  async revokeAgent(): Promise<void> {
    await wait(300);
    this.status = "none";
    this.readyAt = 0;
  }

  async delegateStatus(): Promise<string> {
    if (this.status === "pending" && Date.now() >= this.readyAt) {
      this.status = "ready";
    }
    return this.status;
  }

  async spend(amountUsdc: number, recipient: string): Promise<SpendRecord> {
    if ((await this.delegateStatus()) !== "ready") {
      throw new Error("Agent is not authorized yet (delegate not ready).");
    }
    if (amountUsdc <= 0) throw new Error("Spend amount must be positive.");
    if (amountUsdc > this.remaining) {
      throw new Error(
        `Budget exceeded: tried to spend ${amountUsdc} USDC but only ${this.remaining.toFixed(
          2
        )} USDC remains (cap ${this.budgetUsdc}, already spent ${this.spent}).`
      );
    }
    await wait(600);
    this.spent += amountUsdc;
    const txHash =
      "0x" +
      Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
    const record: SpendRecord = {
      amount: amountUsdc,
      recipient,
      txHash,
      explorerUrl: `https://testnet.arcscan.app/tx/${txHash}`,
      at: new Date().toISOString(),
    };
    this.history.push(record);
    this.handlers.forEach((h) => h({ action: "gateway.spend.succeeded", record }));
    return record;
  }

  onSpendEvent(handler: (payload: unknown) => void): void {
    this.handlers.push(handler);
  }
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
