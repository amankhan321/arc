import type { SpendRecord } from "./agentWallet.js";

/** The surface the dashboard server needs — implemented by both the real
 *  AgentWallet (on-chain via App Kit) and the MockWallet (for demos). */
export interface ServerWallet {
  readonly remaining: number;
  readonly totalSpent: number;
  readonly spendHistory: readonly SpendRecord[];
  fund(amountUsdc: number): Promise<void>;
  authorizeAgent(): Promise<void>;
  revokeAgent(): Promise<void>;
  delegateStatus(): Promise<string>;
  spend(amountUsdc: number, recipient: string): Promise<SpendRecord>;
  onSpendEvent(handler: (payload: unknown) => void): void;
}

export type { SpendRecord };
