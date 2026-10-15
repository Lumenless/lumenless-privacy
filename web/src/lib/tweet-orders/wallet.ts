'use client';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
export type WalletProvider = {
  publicKey?: PublicKey;
  connect(): Promise<{ publicKey: PublicKey }>;
  signMessage(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array } | Uint8Array>;
  signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>;
};
export function walletProvider(name: string): WalletProvider {
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
