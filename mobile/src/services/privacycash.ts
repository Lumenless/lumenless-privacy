/**
 * PrivacyCash balance and withdraw on mobile.
 * 
 * IMPORTANT: The Privacy Cash SDK cannot run directly in React Native because:
 * 1. It depends on `snarkjs`, `ffjavascript`, `fastfile` which require Node.js modules (fs, os, etc.)
 * 2. It uses `crypto.createCipheriv` / `createDecipheriv` which aren't available in React Native
 * 3. Even with polyfills, the crypto operations fail due to missing AES-GCM support
 * 
 * Therefore, balance is fetched from the web backend API which runs the SDK server-side.
 * The API endpoint is: POST /api/privacycash/balance
 * Request: { address: string, signedMessageBase64: string }
 * Response: { lamports: number, usdc: number, usdt: number }
 */

import { Buffer } from 'buffer';

const LAMPORTS_PER_SOL = 1e9;
const USDC_BASE_UNITS = 1e6;
const USDT_BASE_UNITS = 1e6;

export const DERIVATION_MESSAGE = 'Privacy Money account sign in';

// Backend API URL - this should point to your deployed web app
const PRIVACYCASH_API_BASE_URL = 'https://lumenless.com';

export type PrivacyCashBalances = {
  sol: number;
  usdc: number;
  usdt: number;
};

export type WithdrawResult = {
  success: boolean;
  tx?: string;
  error?: string;
};

export type TokenKind = 'SOL' | 'USDC' | 'USDT';

export const TOKEN_DECIMALS: Record<TokenKind, number> = {
  SOL: 9,
  USDC: 6,
  USDT: 6,
};

export const PRIVACYCASH_TOKEN_LABELS: Record<TokenKind, string> = {
  SOL: 'SOL',
  USDC: 'USDC',
  USDT: 'USDT',
};

/**
 * Fetch PrivacyCash balance via the web backend API.
 * The backend runs the Privacy Cash SDK and computes the balance server-side.
 */
export async function getPrivacyCashBalance(
  userPublicKey: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
  _storage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } | null
): Promise<PrivacyCashBalances> {
  console.log('[PrivacyCash] getBalance: start', { address: userPublicKey.slice(0, 8) + '...' });

  // Step 1: Sign the derivation message
  const messageBytes = new TextEncoder().encode(DERIVATION_MESSAGE);
  console.log('[PrivacyCash] getBalance: requesting signature...');
  const signature = await signMessage(messageBytes);
  console.log('[PrivacyCash] getBalance: signature received, length', signature?.length ?? 0);
  
  // Convert signature to base64 for API
  const sigBytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
  const signedMessageBase64 = Buffer.from(sigBytes).toString('base64');

  // Step 2: Call the backend API
  const url = `${PRIVACYCASH_API_BASE_URL}/api/privacycash/balance`;
  console.log('[PrivacyCash] getBalance: calling API', url);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: userPublicKey, signedMessageBase64 }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    console.log('[PrivacyCash] getBalance: response status', res.status);
    
    if (!res.ok) {
      const text = await res.text();
      console.error('[PrivacyCash] getBalance: API error', res.status, text);
      throw new Error(`Balance API error: ${res.status}`);
    }

    const data = await res.json();
    console.log('[PrivacyCash] getBalance: response data', data);

    const sol = (data.lamports ?? 0) / LAMPORTS_PER_SOL;
    const usdc = (data.usdc ?? 0) / USDC_BASE_UNITS;
    const usdt = (data.usdt ?? 0) / USDT_BASE_UNITS;

    console.log('[PrivacyCash] getBalance: done', { sol, usdc, usdt });
    return { sol, usdc, usdt };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Balance request timed out');
    }
    throw err;
  }
}

/**
 * Withdraw from PrivacyCash.
 * Currently not supported on mobile - use the web app.
 */
export async function withdrawFromPrivacyCash(
  token: TokenKind,
  amount: number,
  destinationAddress: string,
  _userPublicKey: string,
  _signMessage: (message: Uint8Array) => Promise<Uint8Array>,
  _signTransaction: (tx: Uint8Array) => Promise<Uint8Array>,
  _storage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } | null
): Promise<WithdrawResult> {
  if (amount <= 0) {
    return { success: false, error: 'Invalid amount' };
  }
  return {
    success: false,
    error: 'Withdraw on mobile is not yet available. Use the web app to withdraw.',
  };
}
