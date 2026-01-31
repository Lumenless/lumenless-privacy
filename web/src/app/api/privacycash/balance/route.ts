import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { readFile } from 'fs/promises';
import path from 'path';

/**
 * Balance API uses the official Privacy Cash SDK (https://privacycash.mintlify.app/sdk/balance).
 * User signs "Privacy Money account sign in"; we derive the encryption key via
 * EncryptionService.deriveEncryptionKeyFromSignature(signature) and use getUtxos / getUtxosSPL
 * + getBalanceFromUtxos / getBalanceFromUtxosSPL. Mobile sends (address, signedMessageBase64);
 * we never receive or use the wallet's private key.
 */

function getBaseUrl(request: NextRequest): string {
  const host = request.headers.get('host') || request.headers.get('x-forwarded-host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  if (host) return `${proto === 'https' ? 'https' : 'http'}://${host}`;
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
}

/** In-memory storage for getUtxos (SDK requires getItem/setItem; we don't persist across requests). */
function makeMemoryStorage(): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } {
  const data: Record<string, string> = {};
  return {
    getItem(k: string) {
      return data[k] ?? null;
    },
    setItem(k: string, v: string) {
      data[k] = v;
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
  return { simd: simd.buffer, sisd: sisd.buffer };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, signedMessageBase64 } = body as { address?: string; signedMessageBase64?: string };

    if (!address || typeof address !== 'string' || !signedMessageBase64 || typeof signedMessageBase64 !== 'string') {
      return NextResponse.json({ error: 'Missing address or signedMessageBase64' }, { status: 400 });
    }

    let sigBytes: Uint8Array;
    try {
      const binary = Buffer.from(signedMessageBase64, 'base64');
      sigBytes = new Uint8Array(binary);
    } catch {
      return NextResponse.json({ error: 'Invalid signedMessageBase64' }, { status: 400 });
    }

    const baseUrl = getBaseUrl(request);
    const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

    const sdk = await import('privacycash/utils');
    const {
      EncryptionService,
      getUtxos,
      getBalanceFromUtxos,
      getUtxosSPL,
      getBalanceFromUtxosSPL,
    } = sdk;
    const hasherModule = await import('@lightprotocol/hasher.rs');
    const { WasmFactory } = hasherModule;

    let wasmModule: { create: () => unknown };
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
        console.error('[API] WASM load failed (fetch and fs):', fetchErr, fsErr);
        throw fetchErr;
      }
    }
    wasmModule.create();

    const encryptionService = new EncryptionService();
    encryptionService.deriveEncryptionKeyFromSignature(sigBytes);

    const connection = new Connection(endpoint, 'confirmed');
    const publicKey = new PublicKey(address);
    const storage = makeMemoryStorage();

    const [fetchedUtxos, usdcUtxos, usdtUtxos] = await Promise.all([
      getUtxos({ publicKey, connection, encryptionService, storage }),
      getUtxosSPL({
        publicKey,
        connection,
        encryptionService,
        storage,
        mintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      }),
      getUtxosSPL({
        publicKey,
        connection,
        encryptionService,
        storage,
        mintAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      }),
    ]);

    const solBalance = getBalanceFromUtxos(fetchedUtxos);
    const usdcBalance = getBalanceFromUtxosSPL(usdcUtxos);
    const usdtBalance = getBalanceFromUtxosSPL(usdtUtxos);

    const lamports = Number(solBalance.lamports ?? 0);
    const usdc = Number(usdcBalance.base_units ?? usdcBalance.amount ?? 0);
    const usdt = Number(usdtBalance.base_units ?? usdtBalance.amount ?? 0);

    return NextResponse.json({ lamports, usdc, usdt });
  } catch (err) {
    console.error('[API] privacycash/balance error:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch balance';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
