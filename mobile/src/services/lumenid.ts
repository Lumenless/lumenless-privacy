/**
 * Lumen ID (SBT) minting via Solana Mobile wallet.
 * Fetches unsigned transaction from backend, user signs and we send it.
 */

import { Connection, VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { base64AddressToBase58 } from './transfer';
import { SOLANA_RPC_URL } from '../constants/solana';

const LUMEN_ID_API_BASE_URL =
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_LUMENLESS_WEB_URL) ||
  'https://lumenless.com';

export type MintLumenIdResult = {
  success: boolean;
  signature?: string;
  error?: string;
};

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
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Mint failed',
    };
  }
}

export { LUMEN_ID_API_BASE_URL };
