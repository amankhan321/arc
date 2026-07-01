# Pay with USDC · Arc

A minimal, non-custodial **"Pay with USDC"** widget for **Arc Testnet**. Enter an amount and a recipient, send USDC wallet-to-wallet, and get a verifiable on-chain receipt. No backend, no custody, no build step — a single `index.html`.

Payments are Arc's core thesis (USDC is the native gas token), so this is deliberately on-thesis: clean UX for the chain's most fundamental action.

## What it does

- Connects an injected EVM wallet (MetaMask, OKX, Rabby…)
- Auto-switches to Arc Testnet, or adds the network if it's missing
- Reads your live USDC balance
- Validates the recipient address and amount before you can send
- Sends USDC via the native system contract, then shows a receipt (amount, from/to, tx hash → Arcscan, block, timestamp)
- Optional payment note

Everything runs client-side. Funds move directly wallet → wallet.

## Arc Testnet details it uses

| | |
|---|---|
| RPC | `https://rpc.testnet.arc.network` |
| Chain ID | `5042002` (`0x4cef52`) |
| Gas token | USDC (native) |
| USDC (ERC-20 interface) | `0x3600000000000000000000000000000000000000` |
| Explorer | `https://testnet.arcscan.app` |
| Faucet | `https://faucet.circle.com` (select Arc Testnet) |

> **Decimals note:** native USDC gas uses 18-decimal precision, but the USDC ERC-20 interface uses 6 decimals. This app reads `decimals()` off the contract rather than hardcoding, so it stays correct either way.

## Run it

Open `index.html` in a browser with a wallet extension installed, or deploy the folder to any static host (Vercel, GitHub Pages, Netlify). No install, no bundler.

Get testnet USDC from the [Circle faucet](https://faucet.circle.com) first, then connect and send.

## Roadmap

- On-chain payment notes via Arc's **Memo** (`0x5294E9927c3306DcBaDb03fe70b92e01cCede505`) batched through **Multicall3From** (`0x522fAf9A91c41c443c66765030741e4AaCe147D0`) so the note settles alongside the transfer while preserving the original sender.
- Shareable payment request links (`?to=…&amount=…`)
- QR code for the recipient / request

---

Built for the Arc ecosystem. Testnet only — tokens have no real-world value.
