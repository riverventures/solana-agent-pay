/**
 * x402 Merchant Server — wraps Anthropic Claude API behind an x402 paywall
 * 
 * Uses PayAI facilitator for Solana USDC payment verification/settlement.
 * Network: solana-devnet (for testing)
 */

import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';

// Try to import x402-solana server; fall back to manual implementation
let X402PaymentHandler;
try {
  const mod = await import('x402-solana/server');
  X402PaymentHandler = mod.X402PaymentHandler;
  console.log('✅ Using x402-solana SDK server handler');
} catch (e) {
  console.log('⚠️  x402-solana/server import failed:', e.message);
  console.log('   Falling back to manual x402 implementation');
}

const app = express();
app.use(cors());
app.use(express.json());

// Config
const PORT = process.env.PORT || 3402;
const NETWORK = process.env.X402_NETWORK || 'solana-devnet';
const FACILITATOR_URL = 'https://facilitator.payai.network';
const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || '4acbTnyJu4yxZa861xPh1nQdawoMsaRnecqU5varwpQ5';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// USDC addresses
const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_ADDRESS = NETWORK === 'solana-devnet' ? USDC_DEVNET : USDC_MAINNET;

// Price: $0.01 USDC = 10000 atomic units (6 decimals)
const PRICE_ATOMIC = '10000';

// Anthropic client
const anthropic = new Anthropic();

// x402 handler (SDK or manual)
let x402;
if (X402PaymentHandler) {
  x402 = new X402PaymentHandler({
    network: NETWORK,
    treasuryAddress: TREASURY_ADDRESS,
    facilitatorUrl: FACILITATOR_URL,
  });
}

// === Manual x402 implementation (fallback) ===

function manualCreate402Response(resourceUrl) {
  return {
    status: 402,
    body: {
      x402Version: 1,
      error: 'X-PAYMENT header is required',
      accepts: [{
        scheme: 'exact',
        network: NETWORK,
        maxAmountRequired: PRICE_ATOMIC,
        asset: USDC_ADDRESS,
        payTo: TREASURY_ADDRESS,
        resource: resourceUrl,
        description: 'Claude AI chat request — $0.01 USDC',
        mimeType: 'application/json',
        outputSchema: null,
        maxTimeoutSeconds: 300,
        extra: {},
      }],
    },
  };
}

async function manualVerifyPayment(paymentHeader, paymentRequirements) {
  const paymentPayload = JSON.parse(Buffer.from(paymentHeader, 'base64').toString());
  const resp = await fetch(`${FACILITATOR_URL}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentPayload, paymentRequirements }),
  });
  return await resp.json();
}

async function manualSettlePayment(paymentHeader, paymentRequirements) {
  const paymentPayload = JSON.parse(Buffer.from(paymentHeader, 'base64').toString());
  const resp = await fetch(`${FACILITATOR_URL}/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentPayload, paymentRequirements }),
  });
  return await resp.json();
}

// === Routes ===

app.get('/health', (req, res) => {
  res.json({ status: 'ok', network: NETWORK, treasury: TREASURY_ADDRESS });
});

app.post('/v1/chat', async (req, res) => {
  const resourceUrl = `${BASE_URL}/v1/chat`;

  try {
    // Check for payment header (v1: X-PAYMENT, v2: PAYMENT-SIGNATURE)
    let paymentHeader;
    if (x402) {
      paymentHeader = x402.extractPayment(req.headers);
    } else {
      paymentHeader = req.headers['x-payment'] || req.headers['payment-signature'];
    }

    // Build payment requirements
    let paymentRequirements;
    if (x402) {
      paymentRequirements = await x402.createPaymentRequirements({
        amount: PRICE_ATOMIC,
        asset: { address: USDC_ADDRESS, decimals: 6 },
        description: 'Claude AI chat request — $0.01 USDC',
      }, resourceUrl);
    } else {
      paymentRequirements = manualCreate402Response(resourceUrl).body.accepts[0];
    }

    // No payment? Return 402
    if (!paymentHeader) {
      console.log('📋 No payment header — returning 402');
      if (x402) {
        const resp402 = x402.create402Response(paymentRequirements, resourceUrl);
        return res.status(resp402.status).json(resp402.body);
      } else {
        const resp402 = manualCreate402Response(resourceUrl);
        return res.status(resp402.status).json(resp402.body);
      }
    }

    console.log('💳 Payment header received, verifying...');

    // Verify payment
    let verified;
    if (x402) {
      verified = await x402.verifyPayment(paymentHeader, paymentRequirements);
    } else {
      verified = await manualVerifyPayment(paymentHeader, paymentRequirements);
    }

    if (!verified.isValid) {
      console.log('❌ Payment verification failed:', verified.invalidReason);
      return res.status(402).json({
        error: 'Payment verification failed',
        reason: verified.invalidReason,
      });
    }

    console.log('✅ Payment verified from:', verified.payer);

    // Call Anthropic
    const { prompt, model, max_tokens } = req.body;
    const message = await anthropic.messages.create({
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: max_tokens || 1024,
      messages: [{ role: 'user', content: prompt || 'Hello!' }],
    });

    console.log('🤖 Claude responded, settling payment...');

    // Settle payment
    let settlement;
    if (x402) {
      settlement = await x402.settlePayment(paymentHeader, paymentRequirements);
    } else {
      settlement = await manualSettlePayment(paymentHeader, paymentRequirements);
    }

    if (!settlement.success) {
      console.error('⚠️  Settlement failed:', settlement.errorReason);
      // Still return the response — payment was verified
    } else {
      console.log('💰 Payment settled! Tx:', settlement.transaction);
    }

    // Return response with payment receipt
    const paymentResponse = Buffer.from(JSON.stringify({
      success: settlement.success,
      transaction: settlement.transaction || '',
      network: NETWORK,
      payer: verified.payer,
    })).toString('base64');

    res.set('X-PAYMENT-RESPONSE', paymentResponse);
    res.json({
      content: message.content[0].text,
      model: message.model,
      usage: message.usage,
      payment: {
        settled: settlement.success,
        transaction: settlement.transaction || null,
        network: NETWORK,
      },
    });

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🏪 x402 Merchant Server running on port ${PORT}`);
  console.log(`   Network: ${NETWORK}`);
  console.log(`   Treasury: ${TREASURY_ADDRESS}`);
  console.log(`   USDC: ${USDC_ADDRESS}`);
  console.log(`   Price: $0.01 per request`);
  console.log(`   Facilitator: ${FACILITATOR_URL}`);
  console.log(`\n   POST ${BASE_URL}/v1/chat`);
  console.log(`   GET  ${BASE_URL}/health\n`);
});
