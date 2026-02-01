import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey, Keypair, VersionedTransaction } from '@solana/web3.js';
import { readFile } from 'fs/promises';
import path from 'path';
import bs58 from 'bs58';

/**
 * Claim API - Direct deposit from Pay Link wallet into User's PrivacyCash balance.
 * 
 * This uses the forked @lumenless/privacycash SDK which supports depositing
 * to a recipient's PrivacyCash account using their UTXO pubkey and encryption key.
 * 
 * Flow:
 * 1. Pay Link provides: secretKey, amount
 * 2. User provides: signedMessageBase64 (to derive their UTXO pubkey + encryption key)
 * 3. Backend: derives user's keys, builds deposit tx, signs with Pay Link keypair, submits to relayer
 * 
 * Request body:
 * - userAddress: User's wallet public key (base58)
 * - signedMessageBase64: User's signature of "Privacy Money account sign in"
 * - payLinkSecretKey: Pay Link's secret key (base58)
 * - amountLamports: Amount to deposit in lamports (for SOL)
 * - mint?: Token mint address (for SPL tokens)
 * - amountBaseUnits?: Amount in base units (for SPL tokens)
 */

function getBaseUrl(request: NextRequest): string {
  const host = request.headers.get('host') || request.headers.get('x-forwarded-host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  if (host) return `${proto === 'https' ? 'https' : 'http'}://${host}`;
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://lumenless.com';
}

/** In-memory storage for SDK. */
function makeMemoryStorage(): Storage {
  const data: Record<string, string> = {};
  return {
    getItem(k: string) { return data[k] ?? null; },
    setItem(k: string, v: string) { data[k] = v; },
    removeItem(k: string) { delete data[k]; },
    clear() { Object.keys(data).forEach(k => delete data[k]); },
    key(index: number) { return Object.keys(data)[index] ?? null; },
    get length() { return Object.keys(data).length; },
  };
}

/** Load WASM from public dir. */
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
      userAddress, 
      signedMessageBase64, 
      payLinkSecretKey,
      amountLamports,
      mint,
      amountBaseUnits,
    } = body as { 
      userAddress?: string; 
      signedMessageBase64?: string;
      payLinkSecretKey?: string;
      amountLamports?: number;
      mint?: string;
      amountBaseUnits?: number;
    };

    // Validate required fields
    if (!userAddress || typeof userAddress !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid userAddress' }, { status: 400 });
    }
    if (!signedMessageBase64 || typeof signedMessageBase64 !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid signedMessageBase64' }, { status: 400 });
    }
    if (!payLinkSecretKey || typeof payLinkSecretKey !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid payLinkSecretKey' }, { status: 400 });
    }

    // Determine if SPL deposit
    const isSplDeposit = mint && (mint === USDC_MINT || mint === USDT_MINT);
    
    if (!isSplDeposit && (!amountLamports || amountLamports <= 0)) {
      return NextResponse.json({ error: 'Missing or invalid amountLamports' }, { status: 400 });
    }
    if (isSplDeposit && (!amountBaseUnits || amountBaseUnits <= 0)) {
      return NextResponse.json({ error: 'Missing or invalid amountBaseUnits' }, { status: 400 });
    }

    // Parse Pay Link keypair
    let payLinkKeypair: Keypair;
    try {
      const secretKeyBytes = bs58.decode(payLinkSecretKey);
      payLinkKeypair = Keypair.fromSecretKey(secretKeyBytes);
    } catch {
      return NextResponse.json({ error: 'Invalid payLinkSecretKey' }, { status: 400 });
    }

    // Parse user's signature
    let userSigBytes: Uint8Array;
    try {
      userSigBytes = new Uint8Array(Buffer.from(signedMessageBase64, 'base64'));
    } catch {
      return NextResponse.json({ error: 'Invalid signedMessageBase64' }, { status: 400 });
    }

    const baseUrl = getBaseUrl(request);
    const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

    console.log('[Claim API] Direct deposit from Pay Link', payLinkKeypair.publicKey.toBase58().slice(0, 8), 
      '→ User', userAddress.slice(0, 8),
      isSplDeposit ? `SPL ${mint} ${amountBaseUnits}` : `SOL ${amountLamports}`);

    // Load the forked SDK with recipientUtxoPubkey support
    // Using @lumenless/privacycash instead of privacycash
    const sdk = await import('@lumenless/privacycash/utils');
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
        console.error('[Claim API] WASM load failed:', fetchErr, fsErr);
        throw fetchErr;
      }
    }
    const lightWasm = wasmModule.create();

    // Step 1: Derive USER's UTXO pubkey and encryption key from their signature
    // This determines which PrivacyCash account receives the funds
    const userEncryptionService = new EncryptionService();
    userEncryptionService.deriveEncryptionKeyFromSignature(userSigBytes);
    
    // Get user's receiving keys
    const { UtxoKeypair } = await import('@lumenless/privacycash/utils');
    const userUtxoPrivateKey = userEncryptionService.getUtxoPrivateKeyV2();
    const userUtxoKeypair = new UtxoKeypair(userUtxoPrivateKey, lightWasm);
    const recipientUtxoPubkey = userUtxoKeypair.pubkey.toString();
    
    // Get user's encryption public key (for encrypting the UTXO data)
    const recipientEncryptionKeyHex = userEncryptionService.getPayLinkPublicKey();
    const recipientEncryptionKey = Buffer.from(recipientEncryptionKeyHex, 'hex');

    console.log('[Claim API] User UTXO pubkey:', recipientUtxoPubkey.slice(0, 16) + '...');
    console.log('[Claim API] User encryption key:', recipientEncryptionKeyHex.slice(0, 16) + '...');

    // Step 2: Create encryption service for Pay Link (just for the deposit process)
    // The Pay Link doesn't need to derive keys from a signature - we just need a dummy service
    // because the SDK requires one, but we're using recipientUtxoPubkey instead
    const payLinkEncryptionService = new EncryptionService();
    // Derive from the pay link's keypair secret
    payLinkEncryptionService.deriveEncryptionKeyFromWallet(payLinkKeypair);

    const connection = new Connection(endpoint, 'confirmed');
    const storage = makeMemoryStorage();

    // Transaction signer - signs with Pay Link keypair
    const transactionSigner = async (tx: VersionedTransaction): Promise<VersionedTransaction> => {
      tx.sign([payLinkKeypair]);
      return tx;
    };

    console.log('[Claim API] Executing direct deposit with recipient keys...');

    // SPL direct deposit not yet supported - need to add recipientUtxoPubkey to depositSPL
    if (isSplDeposit) {
      // For now, suppress unused variable warning
      void depositSPL;
      return NextResponse.json({ 
        error: 'Direct SPL claim not yet supported. Only SOL is supported for now.' 
      }, { status: 400 });
    }

    // SOL deposit to recipient
    const result = await deposit({
      lightWasm,
      storage,
      keyBasePath: '/circuits/transaction2',
      publicKey: new PublicKey(userAddress), // User's public key (for indexing)
      connection,
      amount_in_lamports: amountLamports!,
      encryptionService: payLinkEncryptionService,
      transactionSigner,
      signer: payLinkKeypair.publicKey, // Pay Link pays the fees
      recipientUtxoPubkey, // Deposit to user's UTXO
      recipientEncryptionKey, // Encrypt with user's key
    });

    console.log('[Claim API] Direct deposit successful:', result.tx);

    return NextResponse.json({
      tx: result.tx,
      success: true,
    });

  } catch (err) {
    console.error('[Claim API] Error:', err);
    // Include full stack trace if available
    if (err instanceof Error && err.stack) {
      console.error('[Claim API] Stack:', err.stack);
    }
    const message = err instanceof Error ? err.message : 'Failed to process claim request';
    return NextResponse.json({ 
      error: message,
      // Include stack in development for debugging
      ...(process.env.NODE_ENV === 'development' && err instanceof Error && err.stack 
        ? { stack: err.stack } 
        : {})
    }, { status: 500 });
  }
}
