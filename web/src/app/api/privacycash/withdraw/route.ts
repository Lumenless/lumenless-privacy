import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { readFile } from 'fs/promises';
import path from 'path';

/**
 * Withdraw API for PrivacyCash.
 * 
 * Unlike deposit, withdraw doesn't require user to sign a transaction.
 * The SDK generates a ZK proof and sends the transaction to a relayer.
 * 
 * Request body:
 * - address: User's wallet public key (base58) - the signer
 * - signedMessageBase64: Base64 encoded signature of "Privacy Money account sign in"
 * - recipient: Destination wallet address (base58) - where funds go
 * - amountLamports: Amount to withdraw in lamports (for SOL)
 * - mint?: Token mint address (for SPL tokens - USDC or USDT)
 * - amountBaseUnits?: Amount in base units (for SPL tokens)
 * 
 * Response:
 * - tx: Transaction signature
 * - isPartial: Whether this was a partial withdrawal
 * - amount: Actual amount withdrawn
 * - fee: Fee charged
 */

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
      recipient,
      amountLamports,
      mint,
      amountBaseUnits,
    } = body as { 
      address?: string; 
      signedMessageBase64?: string;
      recipient?: string;
      amountLamports?: number;
      mint?: string;
      amountBaseUnits?: number;
    };

    // Validate required fields
    if (!address || typeof address !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid address' }, { status: 400 });
    }
    if (!signedMessageBase64 || typeof signedMessageBase64 !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid signedMessageBase64' }, { status: 400 });
    }
    if (!recipient || typeof recipient !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid recipient' }, { status: 400 });
    }

    // Validate recipient is a valid Solana address
    try {
      new PublicKey(recipient);
    } catch {
      return NextResponse.json({ error: 'Invalid recipient address' }, { status: 400 });
    }

    // Determine if this is an SPL withdraw
    const isSplWithdraw = mint && (mint === USDC_MINT || mint === USDT_MINT);
    
    if (!isSplWithdraw && (!amountLamports || amountLamports <= 0)) {
      return NextResponse.json({ error: 'Missing or invalid amountLamports for SOL withdraw' }, { status: 400 });
    }
    if (isSplWithdraw && (!amountBaseUnits || amountBaseUnits <= 0)) {
      return NextResponse.json({ error: 'Missing or invalid amountBaseUnits for SPL withdraw' }, { status: 400 });
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

    console.log('[Withdraw API] Starting withdraw for', address, '→', recipient, 
      isSplWithdraw ? `SPL ${mint} ${amountBaseUnits}` : `SOL ${amountLamports}`);

    // Load SDK
    const sdk = await import('privacycash/utils');
    const { EncryptionService, withdraw, withdrawSPL } = sdk;
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
        console.error('[Withdraw API] WASM load failed:', fetchErr, fsErr);
        throw fetchErr;
      }
    }
    const lightWasm = wasmModule.create();

    // Derive encryption keys from user's signature
    const encryptionService = new EncryptionService();
    encryptionService.deriveEncryptionKeyFromSignature(sigBytes);

    const connection = new Connection(endpoint, 'confirmed');
    const publicKey = new PublicKey(address);
    const recipientPubkey = new PublicKey(recipient);
    const storage = makeMemoryStorage();

    console.log('[Withdraw API] Executing withdraw...');

    if (isSplWithdraw) {
      // SPL token withdraw (USDC or USDT)
      const result = await withdrawSPL({
        lightWasm,
        storage,
        keyBasePath: '/circuits/transaction2',
        publicKey,
        connection,
        base_units: amountBaseUnits!,
        encryptionService,
        recipient: recipientPubkey,
        mintAddress: mint!,
      });

      console.log('[Withdraw API] SPL Withdraw successful:', result.tx);

      return NextResponse.json({
        tx: result.tx,
        isPartial: result.isPartial,
        recipient: result.recipient,
        amountBaseUnits: result.base_units,
        feeBaseUnits: result.fee_base_units,
        success: true,
      });

    } else {
      // SOL withdraw
      const result = await withdraw({
        lightWasm,
        storage,
        keyBasePath: '/circuits/transaction2',
        publicKey,
        connection,
        amount_in_lamports: amountLamports!,
        encryptionService,
        recipient: recipientPubkey,
      });

      console.log('[Withdraw API] SOL Withdraw successful:', result.tx);

      return NextResponse.json({
        tx: result.tx,
        isPartial: result.isPartial,
        recipient: result.recipient,
        amountLamports: result.amount_in_lamports,
        feeLamports: result.fee_in_lamports,
        success: true,
      });
    }

  } catch (err) {
    console.error('[Withdraw API] Error:', err);
    const message = err instanceof Error ? err.message : 'Failed to process withdraw request';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
