import {
  createViemAdapterFromPrivateKey,
  type ViemAdapter,
} from "@circle-fin/adapter-viem-v2";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, ARC_RPC } from "./chain.js";

/** Normalise a key that may or may not have the 0x prefix. */
function normalizeKey(key: string): `0x${string}` {
  const k = key.trim().replace(/^0x/, "");
  return `0x${k}` as `0x${string}`;
}

/**
 * Build a Circle viem adapter from a private key, with both the public and
 * wallet clients pinned to Arc Testnet's RPC. We override the client factories
 * so every call goes through the Arc endpoint regardless of SDK defaults.
 */
export function buildAdapter(privateKey: string): ViemAdapter {
  const key = normalizeKey(privateKey);

  return createViemAdapterFromPrivateKey({
    privateKey: key,
    getPublicClient: () =>
      createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) }),
    getWalletClient: ({ account }) =>
      createWalletClient({
        account,
        chain: arcTestnet,
        transport: http(ARC_RPC),
      }),
  });
}

/** Resolve the public 0x address for a private key (used for logging/balances). */
export function addressOf(privateKey: string): `0x${string}` {
  return privateKeyToAccount(normalizeKey(privateKey)).address;
}
