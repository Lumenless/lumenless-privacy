// PayLink service - generates and securely stores payment link keypairs
// Uses tweetnacl for keypair generation (React Native–compatible; no Web Crypto).
// Uses bs58 for bytes → base58 string (Solana address format).
import * as SecureStore from 'expo-secure-store';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

const PAYLINKS_KEY = 'lumenless_paylinks';

export interface PayLink {
  id: string;
  publicKey: string;
  createdAt: number;
  label?: string;
}

interface StoredPayLink extends PayLink {
  secretKey: string; // Base58 encoded full keypair (64 bytes)
}

// Generate Ed25519 keypair. tweetnacl uses getRandomValues (RN polyfill).
// secretKey = 64 bytes (32 seed + 32 public), same as Solana.
function generateKeypair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
  const kp = nacl.sign.keyPair();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

export async function getPayLinks(): Promise<PayLink[]> {
  try {
    const data = await SecureStore.getItemAsync(PAYLINKS_KEY);
    if (!data) return [];

    const stored: StoredPayLink[] = JSON.parse(data);
    return stored.map(({ secretKey, ...link }) => link);
  } catch (error) {
    console.error('Error getting pay links:', error);
    return [];
  }
}

export async function createPayLink(label?: string): Promise<PayLink> {
  const { publicKey, secretKey } = generateKeypair();

  const publicKeyBase58 = bs58.encode(publicKey);
  const secretKeyBase58 = bs58.encode(secretKey);

  const newLink: StoredPayLink = {
    id: Date.now().toString(),
    publicKey: publicKeyBase58,
    secretKey: secretKeyBase58,
    createdAt: Date.now(),
    label,
  };

  const data = await SecureStore.getItemAsync(PAYLINKS_KEY);
  const existing: StoredPayLink[] = data ? JSON.parse(data) : [];
  existing.push(newLink);
  await SecureStore.setItemAsync(PAYLINKS_KEY, JSON.stringify(existing));

  const { secretKey: _, ...payLink } = newLink;
  return payLink;
}

export async function getPayLinkSecretKey(id: string): Promise<string | null> {
  try {
    const data = await SecureStore.getItemAsync(PAYLINKS_KEY);
    if (!data) return null;

    const stored: StoredPayLink[] = JSON.parse(data);
    const link = stored.find((l) => l.id === id);
    return link?.secretKey ?? null;
  } catch (error) {
    console.error('Error getting secret key:', error);
    return null;
  }
}

export async function deletePayLink(id: string): Promise<boolean> {
  try {
    const data = await SecureStore.getItemAsync(PAYLINKS_KEY);
    if (!data) return false;

    const stored: StoredPayLink[] = JSON.parse(data);
    const filtered = stored.filter((l) => l.id !== id);
    await SecureStore.setItemAsync(PAYLINKS_KEY, JSON.stringify(filtered));
    return true;
  } catch (error) {
    console.error('Error deleting pay link:', error);
    return false;
  }
}

export function getPayLinkUrl(publicKey: string): string {
  return `https://lumenless.com/pay/${publicKey}`;
}
