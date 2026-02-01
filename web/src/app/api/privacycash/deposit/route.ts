import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { readFile } from 'fs/promises';
import path from 'path';

/**
 * Deposit API for PrivacyCash.
 * 
 * The SDK's deposit() function does ZK proof generation, builds transaction, signs it,
 * and then sends it to the PrivacyCash relayer. On mobile, we can't run the SDK directly
 * (WASM/snarkjs issues), so we use a two-step approach:
 * 
 * Step 1 - POST /api/privacycash/deposit (this endpoint):
 *   Request: { address, signedMessageBase64, amountLamports, [mint, amountBaseUnits] }
 *   Response: { transaction: base64 } - unsigned transaction to sign on mobile
 * 
 * Step 2 - POST /api/privacycash/deposit/submit:
 *   Request: { signedTransaction: base64, address }
 *   Response: { tx: signature } - relays signed tx to PrivacyCash relayer
 * 
 * This allows mobile to:
 * 1. Get user signature for derivation message
 * 2. Call this API to build tx (backend does ZK proof)
 * 3. Sign the tx on mobile wallet
 * 4. Call submit API to relay to PrivacyCash
 */

const RELAYER_API_URL = 'https://indexer.privacycash.com';

function getBaseUrl(request: NextRequest): string {
  const host = request.headers.get('host') || request.headers.get('x-forwarded-host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  if (host) return `${proto === 'https' ? 'https' : 'http'}://${host}`;
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://lumenless.com';
}

/** In-memory storage for SDK (SDK requires full Storage interface). */
function makeMemoryStorage(): Storage {
  const data: Record<string, string> = {};
  return {
    getItem(k: string) {
      return data[k] ?? null;
    },
    setItem(k: string, v: string) {
      data[k] = v;
    },
    removeItem(k: string) {
      delete data[k];
    },
    clear() {
      Object.keys(data).forEach(k => delete data[k]);
    },
    key(index: number) {
      return Object.keys(data)[index] ?? null;
    },
    get length() {
      return Object.keys(data).length;
    },
  };
}

/** Load WASM from public dir (Node-friendly when fetch to same origin fails in serverless). */
async function loadWasmFromFs(): Promise<{ simd: ArrayBuffer; sisd: ArrayBuffer }> {
  const cwd = process.cwd();
  const publicDir = path.join(cwd, 'public');
  const [simd, sisd] = await Promise.all([
    readFile(path.join(publicDir, 'hasher_wasm_simd_bg.wasm')),
    readFile(path.join(publicDir, 'light_wasm_hasher_bg.wasm')),
  ]);
  return { simd: simd.buffer as ArrayBuffer, sisd: sisd.buffer as ArrayBuffer };
}

// Known token mints
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      address, 
      signedMessageBase64, 
      amountLamports,
      mint,
      amountBaseUnits,
      signedTransaction,
    } = body as { 
      address?: string; 
      signedMessageBase64?: string;
      amountLamports?: number;
      mint?: string;
      amountBaseUnits?: number;
      signedTransaction?: string;
    };

    // If signedTransaction is provided, this is a submit request
    if (signedTransaction) {
      return handleSubmit(signedTransaction, address);
    }

    // Otherwise, build the transaction
    return handleBuildTransaction(request, {
      address,
      signedMessageBase64,
      amountLamports,
      mint,
      amountBaseUnits,
    });

  } catch (err) {
    console.error('[Deposit API] Error:', err);
    const message = err instanceof Error ? err.message : 'Failed to process deposit request';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Handle transaction submission to PrivacyCash relayer
 */
async function handleSubmit(signedTransaction: string, address?: string): Promise<NextResponse> {
  if (!address) {
    return NextResponse.json({ error: 'Missing address for submit' }, { status: 400 });
  }

  console.log('[Deposit API] Submitting signed transaction for', address);

  try {
    const response = await fetch(`${RELAYER_API_URL}/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signedTransaction,
        senderAddress: address,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Deposit API] Relayer error:', response.status, errorText);
      return NextResponse.json({ 
        error: `Relayer error: ${response.status}`,
        details: errorText 
      }, { status: 502 });
    }

    const result = await response.json() as { signature: string; success: boolean };
    console.log('[Deposit API] Transaction submitted successfully:', result.signature);

    return NextResponse.json({ 
      tx: result.signature,
      success: true,
    });

  } catch (err) {
    console.error('[Deposit API] Submit error:', err);
    return NextResponse.json({ 
      error: err instanceof Error ? err.message : 'Failed to submit transaction' 
    }, { status: 500 });
  }
}

/**
 * Handle building the deposit transaction (ZK proof generation)
 */
async function handleBuildTransaction(
  request: NextRequest,
  params: {
    address?: string;
    signedMessageBase64?: string;
    amountLamports?: number;
    mint?: string;
    amountBaseUnits?: number;
  }
): Promise<NextResponse> {
  const { address, signedMessageBase64, amountLamports, mint, amountBaseUnits } = params;

  // Validate required fields
  if (!address || typeof address !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid address' }, { status: 400 });
  }
  if (!signedMessageBase64 || typeof signedMessageBase64 !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid signedMessageBase64' }, { status: 400 });
  }

  // For SOL deposits
  const isSplDeposit = mint && (mint === USDC_MINT || mint === USDT_MINT);
  
  if (!isSplDeposit && (!amountLamports || amountLamports <= 0)) {
    return NextResponse.json({ error: 'Missing or invalid amountLamports for SOL deposit' }, { status: 400 });
  }
  if (isSplDeposit && (!amountBaseUnits || amountBaseUnits <= 0)) {
    return NextResponse.json({ error: 'Missing or invalid amountBaseUnits for SPL deposit' }, { status: 400 });
  }

  // Parse signature
  let sigBytes: Uint8Array;
  try {
    const binary = Buffer.from(signedMessageBase64, 'base64');
    sigBytes = new Uint8Array(binary);
  } catch {
    return NextResponse.json({ error: 'Invalid signedMessageBase64' }, { status: 400 });
  }

  const baseUrl = getBaseUrl(request);
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

  console.log('[Deposit API] Building transaction for', address, isSplDeposit ? `SPL ${mint}` : 'SOL', 
    isSplDeposit ? amountBaseUnits : amountLamports);

  // Load SDK - deposit and depositSPL are exported from utils, not main module
  const sdk = await import('privacycash/utils');
  const { EncryptionService, deposit, depositSPL } = sdk;
  const hasherModule = await import('@lightprotocol/hasher.rs');
  const { WasmFactory } = hasherModule;

  // Load WASM
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let wasmModule: { create: () => any };
  try {
    wasmModule = await WasmFactory.loadModule({
      wasm: {
        simd: fetch(`${baseUrl}/hasher_wasm_simd_bg.wasm`),
        sisd: fetch(`${baseUrl}/light_wasm_hasher_bg.wasm`),
      },
    });
  } catch (fetchErr) {
    try {
      const fsWasm = await loadWasmFromFs();
      wasmModule = await WasmFactory.loadModule({
        wasm: {
          simd: new Response(fsWasm.simd),
          sisd: new Response(fsWasm.sisd),
        },
      });
    } catch (fsErr) {
      console.error('[Deposit API] WASM load failed:', fetchErr, fsErr);
      throw fetchErr;
    }
  }
  const lightWasm = wasmModule.create();

  // Derive encryption keys from user's signature
  const encryptionService = new EncryptionService();
  encryptionService.deriveEncryptionKeyFromSignature(sigBytes);

  const connection = new Connection(endpoint, 'confirmed');
  const publicKey = new PublicKey(address);
  const storage = makeMemoryStorage();

  // Transaction to be signed - we'll capture it from the SDK's transactionSigner callback
  let transactionToSign: VersionedTransaction | null = null;
  let captureError: Error | null = null;

  // The SDK's deposit function calls transactionSigner with the transaction to sign
  // We capture it and throw to stop the SDK from submitting (since it's unsigned)
  const transactionSigner = async (tx: VersionedTransaction): Promise<VersionedTransaction> => {
    transactionToSign = tx;
    // Throw a special error to stop the SDK from continuing
    // The SDK will try to submit after signing, but we want to return the unsigned tx
    throw new Error('__TRANSACTION_CAPTURED__');
  };

  try {
    if (isSplDeposit) {
      // SPL token deposit (USDC or USDT)
      await depositSPL({
        lightWasm,
        storage,
        keyBasePath: '/circuits/transaction2',
        publicKey,
        connection,
        base_units: amountBaseUnits!,
        amount: amountBaseUnits!,
        encryptionService,
        transactionSigner,
        mintAddress: mint!,
      });
    } else {
      // SOL deposit
      await deposit({
        lightWasm,
        storage,
        keyBasePath: '/circuits/transaction2',
        publicKey,
        connection,
        amount_in_lamports: amountLamports!,
        encryptionService,
        transactionSigner,
      });
    }
  } catch (err) {
    // Check if this is our expected capture error
    if (err instanceof Error && err.message === '__TRANSACTION_CAPTURED__') {
      // Expected - we captured the transaction
      console.log('[Deposit API] Transaction captured successfully');
    } else {
      // Unexpected error during deposit building
      captureError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (captureError) {
    console.error('[Deposit API] Error building transaction:', captureError);
    return NextResponse.json({ error: captureError.message }, { status: 500 });
  }

  // TypeScript needs explicit type assertion after control flow
  const capturedTx = transactionToSign as VersionedTransaction | null;
  if (!capturedTx) {
    return NextResponse.json({ error: 'Failed to build deposit transaction' }, { status: 500 });
  }

  // Serialize the transaction for the client to sign
  const serializedTx = Buffer.from(capturedTx.serialize()).toString('base64');

  console.log('[Deposit API] Transaction built successfully, returning to client for signing');

  return NextResponse.json({ 
    transaction: serializedTx,
    message: 'Sign this transaction and call again with signedTransaction parameter',
  });
}
