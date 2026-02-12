import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { readFile, writeFile, access, mkdir } from 'fs/promises';
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

/**
 * Ensure circuit files are available on the filesystem.
 * The privacycash SDK (snarkjs) requires filesystem paths, not URLs.
 * On Vercel, we copy from public or download to /tmp.
 */
async function ensureCircuitFiles(baseUrl: string): Promise<string> {
  const startTime = Date.now();
  const tmpDir = '/tmp/circuits';
  const wasmPath = path.join(tmpDir, 'transaction2.wasm');
  const zkeyPath = path.join(tmpDir, 'transaction2.zkey');

  await mkdir(tmpDir, { recursive: true });

  // Check if files already exist and have reasonable size (avoid re-copying)
  try {
    const [wasmStat, zkeyStat] = await Promise.all([
      access(wasmPath).then(() => readFile(wasmPath, { flag: 'r' })).then(b => b.length),
      access(zkeyPath).then(() => readFile(zkeyPath, { flag: 'r' })).then(b => b.length),
    ]);
    // Circuit files should be >1MB each
    if (wasmStat > 1_000_000 && zkeyStat > 1_000_000) {
      console.log(`[Withdraw API] Circuit files already exist (${Date.now() - startTime}ms)`);
      return path.join(tmpDir, 'transaction2');
    }
  } catch {
    // Files don't exist yet
  }

  // First try to copy from node_modules (SDK includes circuit files)
  const cwd = process.cwd();
  const sdkCircuitsDir = path.join(cwd, 'node_modules', 'privacycash', 'circuit2');
  try {
    const [wasmData, zkeyData] = await Promise.all([
      readFile(path.join(sdkCircuitsDir, 'transaction2.wasm')),
      readFile(path.join(sdkCircuitsDir, 'transaction2.zkey')),
    ]);
    await Promise.all([
      writeFile(wasmPath, wasmData),
      writeFile(zkeyPath, zkeyData),
    ]);
    console.log(`[Withdraw API] Circuit files copied from SDK (${Date.now() - startTime}ms)`);
    return path.join(tmpDir, 'transaction2');
  } catch {
    /* SDK circuits not accessible, try public */
  }

  const publicCircuitsDir = path.join(cwd, 'public', 'circuits');
  try {
    const [wasmData, zkeyData] = await Promise.all([
      readFile(path.join(publicCircuitsDir, 'transaction2.wasm')),
      readFile(path.join(publicCircuitsDir, 'transaction2.zkey')),
    ]);
    await Promise.all([
      writeFile(wasmPath, wasmData),
      writeFile(zkeyPath, zkeyData),
    ]);
    console.log('[Withdraw API] Circuit files copied from public folder');
    return path.join(tmpDir, 'transaction2');
  } catch {
    /* public not accessible, try fetch */
  }

  const wasmUrl = `${baseUrl}/circuits/transaction2.wasm`;
  const zkeyUrl = `${baseUrl}/circuits/transaction2.zkey`;
  const [wasmRes, zkeyRes] = await Promise.all([fetch(wasmUrl), fetch(zkeyUrl)]);
  if (!wasmRes.ok || !zkeyRes.ok) {
    throw new Error(`Failed to download circuit files: wasm=${wasmRes.status}, zkey=${zkeyRes.status}`);
  }
  const [wasmBuffer, zkeyBuffer] = await Promise.all([
    wasmRes.arrayBuffer(),
    zkeyRes.arrayBuffer(),
  ]);
  await Promise.all([
    writeFile(wasmPath, Buffer.from(wasmBuffer)),
    writeFile(zkeyPath, Buffer.from(zkeyBuffer)),
  ]);
  console.log('[Withdraw API] Circuit files downloaded from URL');
  return path.join(tmpDir, 'transaction2');
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

    // Log signature details for debugging
    console.log('[Withdraw API] Signature length:', sigBytes.length);
    console.log('[Withdraw API] Signature first 8 bytes:', Array.from(sigBytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    
    // Ed25519 signatures should be exactly 64 bytes
    if (sigBytes.length !== 64) {
      console.warn('[Withdraw API] Warning: Signature length is', sigBytes.length, 'expected 64');
    }

    const baseUrl = getBaseUrl(request);
    const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

    const reqStartTime = Date.now();
    console.log('[Withdraw API] Starting withdraw for', address, '→', recipient, 
      isSplWithdraw ? `SPL ${mint} ${amountBaseUnits}` : `SOL ${amountLamports}`);

    // Load SDK
    console.log('[Withdraw API] Loading SDK...');
    const sdk = await import('privacycash/utils');
    const { EncryptionService, withdraw, withdrawSPL, setLogger } = sdk;
    
    // Enable SDK debug logging
    setLogger((level: string, message: string) => {
      console.log(`[PrivacyCash SDK ${level}] ${message}`);
    });
    console.log(`[Withdraw API] SDK loaded (${Date.now() - reqStartTime}ms)`);

    const hasherModule = await import('@lightprotocol/hasher.rs');
    const { WasmFactory } = hasherModule;
    console.log(`[Withdraw API] Hasher module loaded (${Date.now() - reqStartTime}ms)`);

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
    console.log(`[Withdraw API] WASM initialized (${Date.now() - reqStartTime}ms)`);

    // Derive encryption keys from user's signature
    const encryptionService = new EncryptionService();
    const keys = encryptionService.deriveEncryptionKeyFromSignature(sigBytes);
    
    // Log derived key fingerprints for debugging (first 8 bytes only for security)
    const keyV1Fingerprint = keys.v1 ? Buffer.from(keys.v1).slice(0, 8).toString('hex') : 'null';
    const keyV2Fingerprint = keys.v2 ? Buffer.from(keys.v2).slice(0, 8).toString('hex') : 'null';
    console.log('[Withdraw API] Derived key fingerprints - V1:', keyV1Fingerprint, 'V2:', keyV2Fingerprint);

    const connection = new Connection(endpoint, 'confirmed');
    const publicKey = new PublicKey(address);
    const recipientPubkey = new PublicKey(recipient);
    const storage = makeMemoryStorage();

    const circuitBasePath = await ensureCircuitFiles(baseUrl);
    console.log(`[Withdraw API] Circuit files ready (${Date.now() - reqStartTime}ms)`);

    // Pre-fetch UTXOs to log details for debugging
    const { getUtxos, getBalanceFromUtxos } = sdk;
    const utxos = await getUtxos({ publicKey, connection, encryptionService, storage });
    const balance = getBalanceFromUtxos(utxos);
    console.log(`[Withdraw API] Found ${utxos.length} UTXOs, balance: ${balance.lamports} lamports`);
    
    // Log UTXO details for debugging
    for (let i = 0; i < utxos.length; i++) {
      const utxo = utxos[i];
      const commitment = await utxo.getCommitment();
      const nullifier = await utxo.getNullifier();
      // Log keypair pubkey (first 20 chars) for debugging
      const pubkeyStr = utxo.keypair?.pubkey?.toString() || 'unknown';
      console.log(`[Withdraw API] UTXO ${i}: index=${utxo.index}, amount=${utxo.amount?.toString()}, version=${utxo.version}, pubkey=${pubkeyStr.substring(0, 20)}..., commitment=${commitment?.substring(0, 20)}..., nullifier=${nullifier?.substring(0, 20)}...`);
    }

    if (utxos.length === 0) {
      return NextResponse.json({
        error: 'No UTXOs found. You may not have any deposits, or the deposit may still be processing.'
      }, { status: 400 });
    }

    console.log('[Withdraw API] Executing withdraw - this may take 1-2 minutes...');

    // Timeout wrapper to prevent infinite hangs (4 min timeout for ZK proof)
    const withTimeout = <T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
      ]);
    };

    if (isSplWithdraw) {
      // SPL token withdraw (USDC or USDT)
      const result = await withTimeout(
        withdrawSPL({
          lightWasm,
          storage,
          keyBasePath: circuitBasePath,
          publicKey,
          connection,
          base_units: amountBaseUnits!,
          encryptionService,
          recipient: recipientPubkey,
          mintAddress: mint!,
          referrer: 'LUMthMRYXEvkekVVLkwMQr92huNK5x5jZGSQzpmCUjb',
        }),
        240_000,
        'Withdraw timed out after 4 minutes. The ZK proof generation may be stuck. Please try again.'
      );

      console.log(`[Withdraw API] SPL Withdraw successful in ${Date.now() - reqStartTime}ms:`, result.tx);

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
      const result = await withTimeout(
        withdraw({
          lightWasm,
          storage,
          keyBasePath: circuitBasePath,
          publicKey,
          connection,
          amount_in_lamports: amountLamports!,
          encryptionService,
          recipient: recipientPubkey,
          referrer: 'LUMthMRYXEvkekVVLkwMQr92huNK5x5jZGSQzpmCUjb',
        }),
        240_000,
        'Withdraw timed out after 4 minutes. The ZK proof generation may be stuck. Please try again.'
      );

      console.log(`[Withdraw API] SOL Withdraw successful in ${Date.now() - reqStartTime}ms:`, result.tx);

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
    
    // Log full error stack for debugging
    if (err instanceof Error && err.stack) {
      console.error('[Withdraw API] Stack trace:', err.stack);
    }
    
    let message = err instanceof Error ? err.message : 'Failed to process withdraw request';
    
    // Provide more helpful error messages for common errors
    if (message.includes('timed out')) {
      // Keep our custom timeout message as-is
    } else if (message.includes('ForceEqualIfEnabled') || message.includes('Assert Failed') || message.includes('assert failed')) {
      console.error('[Withdraw API] ZK proof failed - this indicates a commitment mismatch');
      message = 'ZK proof verification failed (commitment mismatch). This can happen if: ' +
        '(1) The deposit was made from a different wallet, ' +
        '(2) The deposit is still being processed, or ' +
        '(3) There is a temporary issue with the Privacy Cash network. ' +
        'Please try again in a few minutes.';
    } else if (message.includes('no balance')) {
      message = 'No private balance found. Please deposit funds first.';
    } else if (message.includes('Need at least 1 unspent UTXO')) {
      message = 'No UTXOs available. Your previous deposit may still be processing, or all funds have been withdrawn.';
    } else if (message.includes('Failed to fetch Merkle proof')) {
      message = 'Could not fetch the Merkle proof for your UTXO. The Privacy Cash indexer may be temporarily unavailable.';
    }
    
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
