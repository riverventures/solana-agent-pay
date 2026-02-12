# ⚡ Solana Agent Pay

**Pay for AI APIs with USDC on Solana.**

The missing payment layer for autonomous AI agents. Deposit USDC → Agent Pay proxies API calls to OpenAI, Anthropic, ElevenLabs → Per-call metered billing → Real-time on-chain balance tracking.

> "Stripe for the Agent Economy" — but on Solana.

## The Problem

AI agents can't pay for their own compute:
- Every LLM provider requires credit cards
- Agents operate 24/7 but can't hold bank accounts  
- No crypto payment rails exist for API billing

## The Solution

1. **Deposit** — Agent sends USDC to its vault (PDA on Solana)
2. **Proxy** — Agent makes API calls through Agent Pay's endpoint
3. **Auto-deduct** — Usage is metered and deducted from balance in real-time

### Why Solana?

| Feature | Solana | Ethereum |
|---------|--------|----------|
| Tx Fee | $0.0002 | $0.50–$5.00 |
| Finality | <1s | ~15s |
| Per-call billing | ✓ Economical | ✗ Gas too high |
| Transfer hooks | Token-2022 | Requires approve() |

## Quick Start

```bash
# Run the demo (Solana devnet)
npm install
npm run demo

# Serve the landing page locally
npm run dev
```

## Architecture

```
AI Agent → Agent Pay Proxy → OpenAI / Anthropic / etc.
    ↕              ↕
USDC Vault    Metering Engine → On-Chain Receipts
  (PDA)
```

## Demo

The `demo/` directory contains a TypeScript script that demonstrates:
- Creating agent vault accounts on Solana devnet
- Depositing SOL to the vault
- Simulating API usage with per-call deductions
- Balance tracking and withdrawal

## Live Demo

🌐 [solana-agent-pay.vercel.app](https://solana-agent-pay.vercel.app)

## License

MIT

---

Built for [Superteam Earn](https://earn.superteam.fun) — Open Innovation Track
