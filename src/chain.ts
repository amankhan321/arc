import { defineChain } from "viem";

/**
 * Arc Testnet — Circle's stablecoin-native L1.
 * USDC is the native gas token (6 decimals), sub-second finality.
 * Chain ID and RPC are the public testnet values.
 */
export const ARC_RPC = process.env.ARC_RPC || "https://rpc.testnet.arc.network/";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 6 },
  rpcUrls: {
    default: { http: [ARC_RPC] },
  },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

/**
 * The chain identifier the App Kit / Unified Balance SDK uses for Arc Testnet.
 * (Matches the `Blockchain.Arc_Testnet` enum value.)
 */
export const ARC_CHAIN_ID = "Arc_Testnet" as const;
