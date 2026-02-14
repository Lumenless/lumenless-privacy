/**
 * Lumen ID (SBT) minting via Solana Mobile wallet.
 * Fetches unsigned transaction from backend, user signs and we send it.
 */

import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { base64AddressToBase58 } from './transfer';
import { SOLANA_RPC_URL } from '../constants/solana';

const LUMEN_ID_API_BASE_URL =
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_LUMENLESS_WEB_URL) ||
  'https://lumenless.com';

/** 0.02 SOL mint fee + ~0.0021 rent for ATA + ~0.00005 fee buffer (lamports). */
const MIN_LAMPORTS_TO_MINT = 20_000_000 + 2_100_000 + 50_000;

export type MintLumenIdResult = {
  success: boolean;
  signature?: string;
  error?: string;
};

export type LumenIdBalanceCheck = {
  sufficient: boolean;
  balanceSol: string;
  requiredSol: string;
  errorMessage?: string;
};

/**
 * Check if the wallet has enough SOL to mint Lumen ID (0.02 + rent + fees).
 * Call this after getting the user address and before calling mintLumenId.
 */
export async function checkLumenIdMintBalance(userAddressBase58: string): Promise<LumenIdBalanceCheck> {
  const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
  const pubkey = new PublicKey(userAddressBase58);
  const balance = await connection.getBalance(pubkey);
  const balanceSol = (balance / 1e9).toFixed(4);
  const requiredSol = (MIN_LAMPORTS_TO_MINT / 1e9).toFixed(4);
  const sufficient = balance >= MIN_LAMPORTS_TO_MINT;
  return {
    sufficient,
    balanceSol,
    requiredSol,
    errorMessage: sufficient
      ? undefined
      : `Insufficient SOL balance. You need at least ${requiredSol} SOL. Your balance: ${balanceSol} SOL.`,
  };
}

/**
 * Run the full Lumen ID mint flow: authorize wallet, fetch tx from backend, sign, send.
 * Call this from within a Solana Mobile transact() callback or pass a runner.
 */
export async function mintLumenId(
  userAddressBase58: string,
  signTransaction: (tx: Uint8Array) => Promise<Uint8Array>
): Promise<MintLumenIdResult> {
  try {
    const res = await fetch(`${LUMEN_ID_API_BASE_URL}/api/lumen-id/mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: userAddressBase58 }),
    });

    if (!res.ok) {
      const errText = await res.text();
      let errMsg = `Request failed: ${res.status}`;
      try {
        const data = JSON.parse(errText);
        if (data.error) errMsg = data.error;
      } catch {
        if (errText) errMsg = errText.slice(0, 200);
      }
      if (res.status === 405) {
        errMsg = 'Mint service is not available. Please update the app or try again later.';
      } else if (res.status === 503) {
        errMsg = 'Mint is not set up yet. Please try again later.';
      }
      return { success: false, error: errMsg };
    }

    const data = (await res.json()) as { transaction?: string; error?: string };
    if (!data.transaction) {
      return { success: false, error: data.error || 'No transaction returned' };
    }

    const txBytes = Buffer.from(data.transaction, 'base64');
    const signedBytes = await signTransaction(new Uint8Array(txBytes));

    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    const signedTx = VersionedTransaction.deserialize(signedBytes);
    const signature = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    );

    return { success: true, signature };
  } catch (err) {
    console.error('[Lumen ID] mint error:', err);
    const raw = err instanceof Error ? err.message : String(err ?? 'Mint failed');
    return {
      success: false,
      error: raw,
    };
  }
}

export { LUMEN_ID_API_BASE_URL };
