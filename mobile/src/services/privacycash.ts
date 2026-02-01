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

// Backend API URL - configurable via EXPO_PUBLIC_LUMENLESS_WEB_URL env var
const PRIVACYCASH_API_BASE_URL = 
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_LUMENLESS_WEB_URL) || 
  'https://lumenless.com';

export type PrivacyCashBalances = {
  sol: number;
  usdc: number;
  usdt: number;
};

export type WithdrawResult = {
  success: boolean;
  tx?: string;
  error?: string;
  isPartial?: boolean; // True if not all requested amount could be withdrawn
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
 * Withdraw from PrivacyCash via the backend API.
 * 
 * The backend handles the entire withdraw operation:
 * 1. Derives encryption keys from the signed message
 * 2. Generates ZK proof
 * 3. Sends transaction to PrivacyCash relayer
 * 
 * @param token - Token to withdraw (SOL, USDC, USDT)
 * @param amount - Amount to withdraw (in human units, e.g. 0.1 SOL)
 * @param destinationAddress - Where to send the withdrawn funds
 * @param userPublicKey - User's wallet public key (base58)
 * @param signMessage - Function to sign the derivation message
 * @param _signTransaction - Not used for withdraw (relayer handles it)
 * @param _storage - Not used
 */
export async function withdrawFromPrivacyCash(
  token: TokenKind,
  amount: number,
  destinationAddress: string,
  userPublicKey: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
  _signTransaction: (tx: Uint8Array) => Promise<Uint8Array>,
  _storage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } | null
): Promise<WithdrawResult> {
  console.log('[PrivacyCash] withdraw: start', { token, amount, destination: destinationAddress.slice(0, 8) + '...' });

  if (amount <= 0) {
    return { success: false, error: 'Invalid amount' };
  }

  if (!destinationAddress || destinationAddress.length < 32) {
    return { success: false, error: 'Invalid destination address' };
  }

  try {
    // Step 1: Sign the derivation message
    const messageBytes = new TextEncoder().encode(DERIVATION_MESSAGE);
    console.log('[PrivacyCash] withdraw: requesting signature for derivation message...');
    const signature = await signMessage(messageBytes);
    console.log('[PrivacyCash] withdraw: derivation signature received');
    
    const sigBytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
    const signedMessageBase64 = Buffer.from(sigBytes).toString('base64');

    // Step 2: Call backend to execute the withdraw
    const withdrawUrl = `${PRIVACYCASH_API_BASE_URL}/api/privacycash/withdraw`;
    console.log('[PrivacyCash] withdraw: calling backend API...');

    // Convert amount to base units
    const isSpl = token === 'USDC' || token === 'USDT';
    const decimals = TOKEN_DECIMALS[token];
    const baseUnits = Math.floor(amount * Math.pow(10, decimals));

    const requestBody: Record<string, unknown> = {
      address: userPublicKey,
      signedMessageBase64,
      recipient: destinationAddress,
    };

    if (isSpl) {
      requestBody.mint = token === 'USDC' ? USDC_MINT : USDT_MINT;
      requestBody.amountBaseUnits = baseUnits;
    } else {
      requestBody.amountLamports = baseUnits;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout for ZK proof

    const res = await fetch(withdrawUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    console.log('[PrivacyCash] withdraw: response status', res.status);

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
      console.error('[PrivacyCash] withdraw: API error', res.status, errorData);
      return { 
        success: false, 
        error: errorData.error || `Withdraw failed: ${res.status}` 
      };
    }

    const data = await res.json() as { 
      tx?: string; 
      success?: boolean; 
      error?: string;
      isPartial?: boolean;
    };

    if (data.success && data.tx) {
      console.log('[PrivacyCash] withdraw: success!', data.tx);
      return { 
        success: true, 
        tx: data.tx,
        isPartial: data.isPartial,
      };
    }

    return { 
      success: false, 
      error: data.error || 'Withdraw failed' 
    };

  } catch (err) {
    console.error('[PrivacyCash] withdraw: error', err);
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, error: 'Withdraw request timed out. Please try again.' };
    }
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Withdraw failed' 
    };
  }
}

// Token mint addresses
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

export type DepositResult = {
  success: boolean;
  tx?: string;
  error?: string;
};

/**
 * Deposit into PrivacyCash via the backend API.
 * 
 * Flow:
 * 1. Sign the derivation message to get encryption keys
 * 2. Call backend to build the deposit transaction (ZK proof generation)
 * 3. Sign the transaction on mobile
 * 4. Call backend again to submit to PrivacyCash relayer
 * 
 * @param token - Token to deposit (SOL, USDC, USDT)
 * @param amount - Amount to deposit (in human units, e.g. 0.1 SOL)
 * @param userPublicKey - User's wallet public key (base58)
 * @param signMessage - Function to sign a message
 * @param signTransaction - Function to sign a transaction (receives serialized tx, returns signed serialized tx)
 */
export async function depositToPrivacyCash(
  token: TokenKind,
  amount: number,
  userPublicKey: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
  signTransaction: (tx: Uint8Array) => Promise<Uint8Array>,
): Promise<DepositResult> {
  console.log('[PrivacyCash] deposit: start', { token, amount, address: userPublicKey.slice(0, 8) + '...' });

  if (amount <= 0) {
    return { success: false, error: 'Invalid amount' };
  }

  try {
    // Step 1: Sign the derivation message
    const messageBytes = new TextEncoder().encode(DERIVATION_MESSAGE);
    console.log('[PrivacyCash] deposit: requesting signature for derivation message...');
    const signature = await signMessage(messageBytes);
    console.log('[PrivacyCash] deposit: derivation signature received');
    
    const sigBytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
    const signedMessageBase64 = Buffer.from(sigBytes).toString('base64');

    // Step 2: Call backend to build the deposit transaction
    const buildUrl = `${PRIVACYCASH_API_BASE_URL}/api/privacycash/deposit`;
    console.log('[PrivacyCash] deposit: building transaction via backend...');

    // Convert amount to base units
    const isSpl = token === 'USDC' || token === 'USDT';
    const decimals = TOKEN_DECIMALS[token];
    const baseUnits = Math.floor(amount * Math.pow(10, decimals));

    const buildBody: Record<string, unknown> = {
      address: userPublicKey,
      signedMessageBase64,
    };

    if (isSpl) {
      buildBody.mint = token === 'USDC' ? USDC_MINT : USDT_MINT;
      buildBody.amountBaseUnits = baseUnits;
    } else {
      buildBody.amountLamports = baseUnits;
    }

    const buildRes = await fetch(buildUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody),
    });

    if (!buildRes.ok) {
      const errorText = await buildRes.text();
      console.error('[PrivacyCash] deposit: build error', buildRes.status, errorText);
      return { success: false, error: `Failed to build transaction: ${errorText}` };
    }

    const buildData = await buildRes.json() as { transaction?: string; error?: string };
    if (!buildData.transaction) {
      return { success: false, error: buildData.error || 'No transaction returned from backend' };
    }

    console.log('[PrivacyCash] deposit: transaction built, signing...');

    // Step 3: Sign the transaction on mobile
    const txBytes = Buffer.from(buildData.transaction, 'base64');
    const signedTxBytes = await signTransaction(new Uint8Array(txBytes));
    const signedTransaction = Buffer.from(signedTxBytes).toString('base64');

    console.log('[PrivacyCash] deposit: transaction signed, submitting to relayer...');

    // Step 4: Submit to PrivacyCash relayer via backend
    const submitRes = await fetch(buildUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signedTransaction,
        address: userPublicKey,
      }),
    });

    if (!submitRes.ok) {
      const errorText = await submitRes.text();
      console.error('[PrivacyCash] deposit: submit error', submitRes.status, errorText);
      return { success: false, error: `Failed to submit transaction: ${errorText}` };
    }

    const submitData = await submitRes.json() as { tx?: string; success?: boolean; error?: string };
    
    if (submitData.success && submitData.tx) {
      console.log('[PrivacyCash] deposit: success!', submitData.tx);
      return { success: true, tx: submitData.tx };
    }

    return { success: false, error: submitData.error || 'Unknown error during submission' };

  } catch (err) {
    console.error('[PrivacyCash] deposit: error', err);
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Deposit failed' 
    };
  }
}
