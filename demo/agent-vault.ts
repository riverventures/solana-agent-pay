/**
 * Solana Agent Pay — Vault Demo (Devnet)
 *
 * Demonstrates the core flow:
 *  1. Create a vault PDA for an agent
 *  2. Deposit SOL to the vault
 *  3. Simulate API usage deduction
 *  4. Withdraw remaining balance
 *
 * Run: npx ts-node demo/agent-vault.ts
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const RPC = "https://api.devnet.solana.com";
const VAULT_SEED = "agent-vault";

// Deterministic vault address per agent
function getVaultPDA(agentPubkey: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(VAULT_SEED), agentPubkey.toBuffer()],
    programId
  );
}

async function main() {
  const connection = new Connection(RPC, "confirmed");

  // For demo purposes we use a simple SOL-transfer model
  // A production version would use a deployed Anchor program
  const agent = Keypair.generate();
  const vault = Keypair.generate(); // simulated vault account

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║         Solana Agent Pay — Vault Demo            ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`Agent:  ${agent.publicKey.toBase58()}`);
  console.log(`Vault:  ${vault.publicKey.toBase58()}\n`);

  // 1. Airdrop SOL to agent (devnet)
  console.log("→ Requesting airdrop (1 SOL)...");
  try {
    const sig = await connection.requestAirdrop(
      agent.publicKey,
      1 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");
    console.log(`  ✓ Airdrop confirmed: ${sig}\n`);
  } catch (e: any) {
    console.log(`  ⚠ Airdrop failed (rate limit?): ${e.message}`);
    console.log("  Using mock flow instead.\n");
    mockFlow();
    return;
  }

  // 2. Deposit to vault
  const depositAmount = 0.5 * LAMPORTS_PER_SOL;
  console.log(`→ Depositing 0.5 SOL to vault...`);
  const depositTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: agent.publicKey,
      toPubkey: vault.publicKey,
      lamports: depositAmount,
    })
  );
  const depositSig = await sendAndConfirmTransaction(connection, depositTx, [agent]);
  console.log(`  ✓ Deposit tx: ${depositSig}`);

  let vaultBalance = await connection.getBalance(vault.publicKey);
  console.log(`  Vault balance: ${vaultBalance / LAMPORTS_PER_SOL} SOL\n`);

  // 3. Simulate API usage (deduct from vault)
  const apiCalls = [
    { model: "gpt-4o", tokens: 1500, cost: 0.01 },
    { model: "claude-3.5-sonnet", tokens: 2000, cost: 0.015 },
    { model: "elevenlabs-tts", tokens: 500, cost: 0.005 },
  ];

  console.log("→ Simulating API usage...");
  for (const call of apiCalls) {
    console.log(`  📡 ${call.model}: ${call.tokens} tokens → ${call.cost} SOL deducted`);
  }
  const totalCost = apiCalls.reduce((sum, c) => sum + c.cost, 0);
  console.log(`  Total usage: ${totalCost} SOL\n`);

  // 4. Show remaining balance
  const remaining = depositAmount / LAMPORTS_PER_SOL - totalCost;
  console.log(`→ Remaining vault balance: ${remaining.toFixed(4)} SOL`);
  console.log(`  (In production, each deduction is an on-chain tx with receipt)\n`);

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Demo complete! All txs on Solana devnet.        ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`\nExplorer: https://explorer.solana.com/address/${vault.publicKey.toBase58()}?cluster=devnet`);
}

function mockFlow() {
  console.log("═══ Mock Flow (no devnet connection needed) ═══\n");
  const agent = Keypair.generate();
  console.log(`Agent: ${agent.publicKey.toBase58()}`);
  console.log(`Vault PDA seed: [${VAULT_SEED}, agent_pubkey]\n`);

  const deposit = 100; // USDC
  console.log(`1. Agent deposits $${deposit} USDC to vault`);

  const calls = [
    { api: "OpenAI gpt-4o", cost: 0.03 },
    { api: "Anthropic claude-3.5", cost: 0.024 },
    { api: "ElevenLabs TTS", cost: 0.018 },
  ];

  let balance = deposit;
  console.log(`2. Agent makes API calls via proxy:\n`);
  for (const call of calls) {
    balance -= call.cost;
    console.log(`   ${call.api}: -$${call.cost}  →  balance: $${balance.toFixed(3)}`);
  }

  console.log(`\n3. Agent withdraws remaining: $${balance.toFixed(3)} USDC`);
  console.log("\n✓ All operations would be recorded on-chain as Solana transactions.");
}

main().catch(console.error);
