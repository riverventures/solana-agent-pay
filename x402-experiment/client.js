/**
 * x402 Buyer Client — pays for Claude API requests via x402/Solana
 * 
 * Loads a Solana keypair, makes a request to the merchant server,
 * handles 402 by constructing a USDC transfer transaction, signs it,
 * and resubmits with the X-PAYMENT header.
 */

import { Connection, Keypair, Transaction, PublicKey } from '@solana/web3.js';
import { createTransferInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import fs from 'fs';

// Config
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3402';
const KEYPAIR_PATH = process.env.KEYPAIR_PATH || `${process.env.HOME}/.config/solana/sterling.json`;
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

// Load keypair
const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf8'));
const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
console.log(`🔑 Wallet: ${keypair.publicKey.toBase58()}`);

// Prompt from CLI args
const prompt = process.argv[2] || 'What is x402 protocol? Explain in 2 sentences.';
console.log(`📝 Prompt: "${prompt}"\n`);

const connection = new Connection(RPC_URL, 'confirmed');

// Try using x402-solana client SDK first
let useSDK = false;
let createX402Client;
try {
  const mod = await import('x402-solana/client');
  createX402Client = mod.createX402Client;
  useSDK = true;
  console.log('✅ Using x402-solana SDK client');
} catch (e) {
  console.log('⚠️  x402-solana/client import failed:', e.message);
  console.log('   Using manual x402 implementation\n');
}

async function manualFlow() {
  // Step 1: Make initial request (expect 402)
  console.log('📡 Step 1: Requesting without payment...');
  const initialResp = await fetch(`${SERVER_URL}/v1/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });

  if (initialResp.status !== 402) {
    console.log(`Unexpected status: ${initialResp.status}`);
    console.log(await initialResp.text());
    return;
  }

  const paymentRequired = await initialResp.json();
  console.log('💰 Got 402 Payment Required');
  console.log('   Accepts:', JSON.stringify(paymentRequired.accepts?.[0] || paymentRequired, null, 2).slice(0, 300));

  // Extract payment requirements
  const req402 = paymentRequired.accepts?.[0] || paymentRequired;
  const {
    network,
    maxAmountRequired,
    asset: assetAddress,
    payTo,
    resource,
    maxTimeoutSeconds,
  } = req402;

  console.log(`\n   Network: ${network}`);
  console.log(`   Amount: ${maxAmountRequired} atomic units`);
  console.log(`   Asset: ${assetAddress}`);
  console.log(`   Pay to: ${payTo}`);

  // Step 2: Build USDC transfer transaction
  console.log('\n📡 Step 2: Building payment transaction...');

  const mint = new PublicKey(assetAddress);
  const payToKey = new PublicKey(payTo);
  const amount = BigInt(maxAmountRequired);

  // Get associated token accounts
  const senderATA = await getAssociatedTokenAddress(mint, keypair.publicKey);
  const receiverATA = await getAssociatedTokenAddress(mint, payToKey);

  console.log(`   Sender ATA: ${senderATA.toBase58()}`);
  console.log(`   Receiver ATA: ${receiverATA.toBase58()}`);

  // Check sender balance
  try {
    const balance = await connection.getTokenAccountBalance(senderATA);
    console.log(`   Sender USDC balance: ${balance.value.uiAmountString}`);
    if (BigInt(balance.value.amount) < amount) {
      console.error(`❌ Insufficient USDC balance! Need ${maxAmountRequired}, have ${balance.value.amount}`);
      console.log('\n   To get devnet USDC, you need to:');
      console.log('   1. Get devnet SOL: solana airdrop 2 --url devnet');
      console.log('   2. Get devnet USDC from a faucet or mint test tokens');
      return;
    }
  } catch (e) {
    console.error('❌ Could not fetch token account (may not exist):', e.message);
    console.log('   You may need to create an ATA and get devnet USDC first.');
    return;
  }

  // Check if receiver ATA exists
  let receiverATAExists = true;
  try {
    await connection.getTokenAccountBalance(receiverATA);
  } catch (e) {
    receiverATAExists = false;
    console.log('   ⚠️  Receiver ATA does not exist — may need to create it');
    // The facilitator might handle this, or we might need createAssociatedTokenAccountInstruction
  }

  // Build transaction
  const tx = new Transaction();

  // If receiver ATA doesn't exist, create it
  if (!receiverATAExists) {
    const { createAssociatedTokenAccountInstruction } = await import('@solana/spl-token');
    tx.add(
      createAssociatedTokenAccountInstruction(
        keypair.publicKey, // payer
        receiverATA,       // ATA to create
        payToKey,          // owner
        mint               // token mint
      )
    );
  }

  tx.add(
    createTransferInstruction(
      senderATA,   // source
      receiverATA, // destination
      keypair.publicKey, // owner/authority
      amount,
    )
  );

  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = keypair.publicKey;

  // Sign transaction
  tx.sign(keypair);

  // Serialize as base64 (partially signed — the facilitator may co-sign or just verify)
  const serializedTx = tx.serialize().toString('base64');
  console.log(`   Transaction built and signed (${serializedTx.length} chars)`);

  // Step 3: Build x402 payment payload
  const paymentPayload = {
    x402Version: 1,
    scheme: 'exact',
    network: network,
    payload: {
      transaction: serializedTx,
    },
  };

  const xPaymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
  console.log(`\n📡 Step 3: Resubmitting with X-PAYMENT header...`);

  const paidResp = await fetch(`${SERVER_URL}/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT': xPaymentHeader,
    },
    body: JSON.stringify({ prompt }),
  });

  console.log(`   Response status: ${paidResp.status}`);

  if (paidResp.status === 200) {
    const result = await paidResp.json();
    console.log('\n✅ SUCCESS!\n');
    console.log('🤖 Claude says:', result.content);
    console.log('\n📊 Usage:', result.usage);
    console.log('💰 Payment:', result.payment);

    // Check X-PAYMENT-RESPONSE header
    const paymentResponse = paidResp.headers.get('x-payment-response');
    if (paymentResponse) {
      const decoded = JSON.parse(Buffer.from(paymentResponse, 'base64').toString());
      console.log('📄 Payment receipt:', decoded);
    }
  } else {
    console.log('❌ Payment failed:');
    console.log(await paidResp.text());
  }
}

async function sdkFlow() {
  // The SDK client is designed for browser wallets, but we can adapt it
  // by providing a compatible wallet interface
  const client = createX402Client({
    wallet: {
      address: keypair.publicKey.toBase58(),
      signTransaction: async (tx) => {
        tx.sign(keypair);
        return tx;
      },
    },
    network: 'solana-devnet',
    amount: BigInt(10_000_000), // max 10 USDC safety limit
  });

  console.log('📡 Making paid request via SDK...');
  const response = await client.fetch(`${SERVER_URL}/v1/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });

  if (response.ok) {
    const result = await response.json();
    console.log('\n✅ SUCCESS!\n');
    console.log('🤖 Claude says:', result.content);
    console.log('\n📊 Usage:', result.usage);
    console.log('💰 Payment:', result.payment);
  } else {
    console.log(`❌ Failed with status ${response.status}`);
    console.log(await response.text());
  }
}

// Run
try {
  if (useSDK) {
    await sdkFlow();
  } else {
    await manualFlow();
  }
} catch (err) {
  console.error('Error:', err);
}
