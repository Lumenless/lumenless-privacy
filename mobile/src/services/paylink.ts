// PayLink service - generates and securely stores payment link keypairs
import * as SecureStore from 'expo-secure-store';
import { getBase58Encoder } from '@solana/kit';

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

// Generate Ed25519 keypair with extractable keys
async function generateExtractableKeypair(): Promise<{ publicKey: Uint8Array; secretKey: Uint8Array }> {
  const keypair = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true, // extractable
    ['sign', 'verify']
  );

  // Export keys
  const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keypair.privateKey);
  const publicKeyBuffer = await crypto.subtle.exportKey('raw', keypair.publicKey);

  // PKCS8 format has a header, the actual key is at the end
  // Ed25519 private key is 32 bytes, public key is 32 bytes
  const privateKeyFull = new Uint8Array(privateKeyBuffer);
  const privateKey = privateKeyFull.slice(-32); // Last 32 bytes
  const publicKey = new Uint8Array(publicKeyBuffer);

  // Solana keypair format: 64 bytes (32 private + 32 public)
  const secretKey = new Uint8Array(64);
  secretKey.set(privateKey, 0);
  secretKey.set(publicKey, 32);

  return { publicKey, secretKey };
}

// Get all pay links (without secret keys)
export async function getPayLinks(): Promise<PayLink[]> {
  try {
    const data = await SecureStore.getItemAsync(PAYLINKS_KEY);
    if (!data) return [];
    
    const stored: StoredPayLink[] = JSON.parse(data);
    // Return without secret keys
    return stored.map(({ secretKey, ...link }) => link);
  } catch (error) {
    console.error('Error getting pay links:', error);
    return [];
  }
}

// Create a new pay link
export async function createPayLink(label?: string): Promise<PayLink> {
  const base58Encoder = getBase58Encoder();
  
  // Generate keypair
  const { publicKey, secretKey } = await generateExtractableKeypair();
  
  // Encode to base58
  const publicKeyBase58 = base58Encoder.encode(publicKey);
  const secretKeyBase58 = base58Encoder.encode(secretKey);
  
  const newLink: StoredPayLink = {
    id: Date.now().toString(),
    publicKey: publicKeyBase58,
    secretKey: secretKeyBase58,
    createdAt: Date.now(),
    label,
  };

  // Get existing links
  const data = await SecureStore.getItemAsync(PAYLINKS_KEY);
  const existing: StoredPayLink[] = data ? JSON.parse(data) : [];
  
  // Add new link
  existing.push(newLink);
  
  // Save to secure storage
  await SecureStore.setItemAsync(PAYLINKS_KEY, JSON.stringify(existing));
  
  // Return without secret key
  const { secretKey: _, ...payLink } = newLink;
  return payLink;
}

// Get secret key for a specific pay link (for withdrawing)
export async function getPayLinkSecretKey(id: string): Promise<string | null> {
  try {
    const data = await SecureStore.getItemAsync(PAYLINKS_KEY);
    if (!data) return null;
    
    const stored: StoredPayLink[] = JSON.parse(data);
    const link = stored.find(l => l.id === id);
    
    return link?.secretKey || null;
  } catch (error) {
    console.error('Error getting secret key:', error);
    return null;
  }
}

// Delete a pay link
export async function deletePayLink(id: string): Promise<boolean> {
  try {
    const data = await SecureStore.getItemAsync(PAYLINKS_KEY);
    if (!data) return false;
    
    const stored: StoredPayLink[] = JSON.parse(data);
    const filtered = stored.filter(l => l.id !== id);
    
    await SecureStore.setItemAsync(PAYLINKS_KEY, JSON.stringify(filtered));
    return true;
  } catch (error) {
    console.error('Error deleting pay link:', error);
    return false;
  }
}

// Generate the shareable URL
export function getPayLinkUrl(publicKey: string): string {
  return `https://lumenless.com/pay/${publicKey}`;
}
