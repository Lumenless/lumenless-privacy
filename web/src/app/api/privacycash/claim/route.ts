import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey, Keypair, VersionedTransaction } from '@solana/web3.js';
import { readFile, writeFile, access, mkdir } from 'fs/promises';
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

/** 
 * Ensure circuit files are available on the filesystem.
 * snarkjs requires filesystem paths, not URLs.
 * On Vercel, we download them to /tmp if not already there.
 */
async function ensureCircuitFiles(baseUrl: string): Promise<string> {
  const startTime = Date.now();
  const tmpDir = '/tmp/circuits';
  const wasmPath = path.join(tmpDir, 'transaction2.wasm');
  const zkeyPath = path.join(tmpDir, 'transaction2.zkey');
  
  // Check if files already exist (cached from previous invocation)
  try {
    await access(wasmPath);
    await access(zkeyPath);
    console.log('[Claim API] Circuit files found in /tmp (cached)');
    return path.join(tmpDir, 'transaction2');
  } catch {
    // Files don't exist, need to download
    console.log('[Claim API] Circuit files not in cache, will download...');
  }
  
  // Create tmp directory
  await mkdir(tmpDir, { recursive: true });
  
  // First, try to read from public folder (works in local dev)
  const cwd = process.cwd();
  const publicCircuitsDir = path.join(cwd, 'public', 'circuits');
  
  try {
    console.log('[Claim API] Trying to read from public folder:', publicCircuitsDir);
    const [wasmData, zkeyData] = await Promise.all([
      readFile(path.join(publicCircuitsDir, 'transaction2.wasm')),
      readFile(path.join(publicCircuitsDir, 'transaction2.zkey')),
    ]);
    
    console.log('[Claim API] Read from public folder, writing to /tmp...');
    await Promise.all([
      writeFile(wasmPath, wasmData),
      writeFile(zkeyPath, zkeyData),
    ]);
    
    console.log(`[Claim API] Circuit files copied from public folder (${Date.now() - startTime}ms)`);
    return path.join(tmpDir, 'transaction2');
  } catch (fsErr) {
    console.log('[Claim API] Public folder not accessible:', fsErr instanceof Error ? fsErr.message : fsErr);
  }
  
  // Download from URL
  const wasmUrl = `${baseUrl}/circuits/transaction2.wasm`;
  const zkeyUrl = `${baseUrl}/circuits/transaction2.zkey`;
  
  console.log('[Claim API] Fetching circuits from URL...');
  console.log('[Claim API] WASM URL:', wasmUrl);
  console.log('[Claim API] ZKEY URL:', zkeyUrl);
  
  const fetchStart = Date.now();
  const [wasmRes, zkeyRes] = await Promise.all([
    fetch(wasmUrl),
    fetch(zkeyUrl),
  ]);
  console.log(`[Claim API] Fetch response received (${Date.now() - fetchStart}ms)`);
  
  if (!wasmRes.ok || !zkeyRes.ok) {
    throw new Error(`Failed to download circuit files: wasm=${wasmRes.status}, zkey=${zkeyRes.status}`);
  }
  
  console.log('[Claim API] Reading response buffers...');
  const bufferStart = Date.now();
  const [wasmBuffer, zkeyBuffer] = await Promise.all([
    wasmRes.arrayBuffer(),
    zkeyRes.arrayBuffer(),
  ]);
  console.log(`[Claim API] Buffers read (${Date.now() - bufferStart}ms) - wasm: ${wasmBuffer.byteLength}, zkey: ${zkeyBuffer.byteLength}`);
  
  console.log('[Claim API] Writing to /tmp...');
  const writeStart = Date.now();
  await Promise.all([
    writeFile(wasmPath, Buffer.from(wasmBuffer)),
    writeFile(zkeyPath, Buffer.from(zkeyBuffer)),
  ]);
  console.log(`[Claim API] Files written to /tmp (${Date.now() - writeStart}ms)`);
  
  console.log(`[Claim API] Circuit files ready (total: ${Date.now() - startTime}ms)`);
  return path.join(tmpDir, 'transaction2');
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

    console.log('[Claim API] Step 1: Loading SDK...');
    // Load the forked SDK with recipientUtxoPubkey support
    const sdk = await import('@lumenless/privacycash/utils');
    const { EncryptionService, deposit, depositSPL, UtxoKeypair } = sdk;
    const hasherModule = await import('@lightprotocol/hasher.rs');
    const { WasmFactory } = hasherModule;
    console.log('[Claim API] Step 1: SDK loaded');

    console.log('[Claim API] Step 2: Loading WASM...');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let wasmModule: { create: () => any };
    try {
      wasmModule = await WasmFactory.loadModule({
        wasm: {
          simd: fetch(`${baseUrl}/hasher_wasm_simd_bg.wasm`),
          sisd: fetch(`${baseUrl}/light_wasm_hasher_bg.wasm`),
        },
      });
      console.log('[Claim API] Step 2: WASM loaded via fetch');
    } catch (fetchErr) {
      console.log('[Claim API] Step 2: Fetch failed, trying filesystem...', fetchErr);
      try {
        const fsWasm = await loadWasmFromFs();
        wasmModule = await WasmFactory.loadModule({
          wasm: {
            simd: new Response(fsWasm.simd),
            sisd: new Response(fsWasm.sisd),
          },
        });
        console.log('[Claim API] Step 2: WASM loaded via filesystem');
      } catch (fsErr) {
        console.error('[Claim API] WASM load failed:', fetchErr, fsErr);
        throw new Error(`WASM load failed: ${fetchErr instanceof Error ? fetchErr.message : 'Unknown'}`);
      }
    }
    const lightWasm = wasmModule.create();
    console.log('[Claim API] Step 2: WASM instance created');

    console.log('[Claim API] Step 3: Deriving user encryption keys...');
    // Derive USER's UTXO pubkey and encryption key from their signature
    const userEncryptionService = new EncryptionService();
    userEncryptionService.deriveEncryptionKeyFromSignature(userSigBytes);
    console.log('[Claim API] Step 3: User encryption keys derived');
    
    console.log('[Claim API] Step 4: Creating UTXO keypair for recipient...');
    // Get user's receiving keys
    const userUtxoPrivateKey = userEncryptionService.getUtxoPrivateKeyV2();
    const userUtxoKeypair = new UtxoKeypair(userUtxoPrivateKey, lightWasm);
    const recipientUtxoPubkey = userUtxoKeypair.pubkey.toString();
    
    // Get user's encryption public key (for encrypting the UTXO data)
    const recipientEncryptionKeyHex = userEncryptionService.getPayLinkPublicKey();
    const recipientEncryptionKey = Buffer.from(recipientEncryptionKeyHex, 'hex');

    console.log('[Claim API] Step 4: User UTXO pubkey:', recipientUtxoPubkey.slice(0, 16) + '...');
    console.log('[Claim API] Step 4: User encryption key:', recipientEncryptionKeyHex.slice(0, 16) + '...');

    console.log('[Claim API] Step 5: Creating Pay Link encryption service...');
    // Create encryption service for Pay Link
    const payLinkEncryptionService = new EncryptionService();
    payLinkEncryptionService.deriveEncryptionKeyFromWallet(payLinkKeypair);
    console.log('[Claim API] Step 5: Pay Link encryption service created');

    const connection = new Connection(endpoint, 'confirmed');
    const storage = makeMemoryStorage();

    // Transaction signer - signs with Pay Link keypair
    const transactionSigner = async (tx: VersionedTransaction): Promise<VersionedTransaction> => {
      console.log('[Claim API] Signing transaction with Pay Link keypair...');
      tx.sign([payLinkKeypair]);
      return tx;
    };

    console.log('[Claim API] Step 6: Executing direct deposit with recipient keys...');

    // SPL direct deposit not yet supported - need to add recipientUtxoPubkey to depositSPL
    if (isSplDeposit) {
      void depositSPL;
      return NextResponse.json({ 
        error: 'Direct SPL claim not yet supported. Only SOL is supported for now.' 
      }, { status: 400 });
    }

    // Ensure circuit files are available on filesystem (snarkjs needs file paths, not URLs)
    console.log('[Claim API] Step 7: Ensuring circuit files...');
    const circuitBasePath = await ensureCircuitFiles(baseUrl);
    console.log('[Claim API] Step 7: Circuit base path:', circuitBasePath);
    
    // SOL deposit to recipient
    console.log('[Claim API] Step 8: Starting deposit (this includes ZK proof generation, may take 30-60s)...');
    const depositStart = Date.now();
    const result = await deposit({
      lightWasm,
      storage,
      keyBasePath: circuitBasePath,
      publicKey: new PublicKey(userAddress),
      connection,
      amount_in_lamports: amountLamports!,
      encryptionService: payLinkEncryptionService,
      transactionSigner,
      signer: payLinkKeypair.publicKey,
      recipientUtxoPubkey,
      recipientEncryptionKey,
    });

    console.log(`[Claim API] Direct deposit successful (${Date.now() - depositStart}ms):`, result.tx);

    return NextResponse.json({
      tx: result.tx,
      success: true,
    });

  } catch (err) {
    console.error('[Claim API] Error:', err);
    if (err instanceof Error && err.stack) {
      console.error('[Claim API] Stack:', err.stack);
    }
    const message = err instanceof Error ? err.message : 'Failed to process claim request';
    return NextResponse.json({ 
      error: message,
      ...(process.env.NODE_ENV === 'development' && err instanceof Error && err.stack 
        ? { stack: err.stack } 
        : {})
    }, { status: 500 });
  }
}
