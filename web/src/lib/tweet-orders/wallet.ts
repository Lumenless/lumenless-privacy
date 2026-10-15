'use client';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { getWallets } from '@wallet-standard/app';
import { StandardWalletAdapter } from '@solana/wallet-standard-wallet-adapter';
import { isWalletAdapterCompatibleStandardWallet } from '@solana/wallet-adapter-base';
export const WALLET_NAMES = ['Phantom', 'Solflare', 'Backpack', 'Jupiter'] as const;
export type WalletProvider = {
  publicKey?: PublicKey;
  connect(): Promise<{ publicKey: PublicKey }>;
  signMessage(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array } | Uint8Array>;
  signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>;
};
export function walletProvider(name: string): WalletProvider {
  if (name === 'Jupiter') {
    const wallet = getWallets().get().find(wallet => wallet.name === 'Jupiter' && isWalletAdapterCompatibleStandardWallet(wallet));
    if (!wallet || !isWalletAdapterCompatibleStandardWallet(wallet)) throw new Error('Install Jupiter Wallet or open this page in its browser.');
    const adapter = new StandardWalletAdapter({ wallet });
    return {
      get publicKey() { return adapter.publicKey || undefined; },
      async connect() {
        await adapter.connect();
        if (!adapter.publicKey) throw new Error('Jupiter Wallet did not return an account.');
        return { publicKey: adapter.publicKey };
      },
      async signMessage(message) {
        if (!adapter.signMessage) throw new Error('Jupiter Wallet does not support message signing.');
        return adapter.signMessage(message);
      },
      async signTransaction(transaction) {
        if (!adapter.signTransaction) throw new Error('Jupiter Wallet does not support transaction signing.');
        return adapter.signTransaction(transaction);
      },
    };
  }
  const browser = window as unknown as { phantom?: { solana?: WalletProvider }; solflare?: WalletProvider; backpack?: WalletProvider };
  const provider = name === 'Solflare' ? browser.solflare : name === 'Backpack' ? browser.backpack : browser.phantom?.solana;
  if (!provider) throw new Error(`Open this page in ${name}'s browser or install its wallet extension.`);
  return provider;
}
export function fromBase64(value: string) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
export function toBase64(value: Uint8Array) { return btoa(Array.from(value, byte => String.fromCharCode(byte)).join('')); }
export async function jsonRequest(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed. Please retry.');
  return result;
}

// A late message signature must never resume order creation after the UI timed out.
// This wraps message authorization only; payment transactions keep their recovery flow.
export async function authorizeOrderMessage(provider: WalletProvider, message: Uint8Array, timeoutMs = 60_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      provider.signMessage(message, 'utf8'),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Wallet message signing timed out. Open your wallet extension and reject the pending request before trying again. No payment was initiated.')), timeoutMs); }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
