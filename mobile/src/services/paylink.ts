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
  hidden?: boolean;
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

export async function getPayLinks(includeHidden = false): Promise<PayLink[]> {
  try {
    console.log('[PayLink] Fetching pay links from secure store...');
    const data = await SecureStore.getItemAsync(PAYLINKS_KEY);
    
    if (!data) {
      console.log('[PayLink] No pay links found in secure store');
      return [];
    }

    console.log('[PayLink] Found data in secure store, length:', data.length);
    const stored: StoredPayLink[] = JSON.parse(data);
    console.log('[PayLink] Parsed', stored.length, 'pay link(s)');
    
    const links = stored
      .map(({ secretKey, ...link }) => link)
      .filter(link => includeHidden || !link.hidden);
    
    console.log('[PayLink] Returning', links.length, 'pay link(s)' + (includeHidden ? ' (including hidden)' : ' (excluding hidden)'));
    return links;
  } catch (error: any) {
    console.error('[PayLink] Error getting pay links:', error?.message || error);
    console.error('[PayLink] Error stack:', error?.stack);
    return [];
  }
}

// Get count of hidden pay links
export async function getHiddenPayLinksCount(): Promise<number> {
  try {
    const data = await SecureStore.getItemAsync(PAYLINKS_KEY);
    if (!data) return 0;

    const stored: StoredPayLink[] = JSON.parse(data);
    return stored.filter(link => link.hidden).length;
  } catch (error) {
    console.error('Error getting hidden pay links count:', error);
    return 0;
  }
}

export async function createPayLink(label?: string): Promise<PayLink> {
  console.log('[PayLink] Creating new pay link with label:', label || '(none)');
  
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

  try {
    const data = await SecureStore.getItemAsync(PAYLINKS_KEY);
    const existing: StoredPayLink[] = data ? JSON.parse(data) : [];
    console.log('[PayLink] Existing pay links count:', existing.length);
    
    existing.push(newLink);
    
    const jsonData = JSON.stringify(existing);
    console.log('[PayLink] Saving', existing.length, 'pay link(s) to secure store, data length:', jsonData.length);
    
    await SecureStore.setItemAsync(PAYLINKS_KEY, jsonData);
    console.log('[PayLink] Successfully saved pay link to secure store');

    const { secretKey: _, ...payLink } = newLink;
    return payLink;
  } catch (error: any) {
    console.error('[PayLink] Error creating pay link:', error?.message || error);
    console.error('[PayLink] Error stack:', error?.stack);
    throw error;
  }
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
    console.log('[PayLink] Hiding pay link:', id);
    const data = await SecureStore.getItemAsync(PAYLINKS_KEY);
    if (!data) return false;

    const stored: StoredPayLink[] = JSON.parse(data);
    const updated = stored.map((link) => 
      link.id === id ? { ...link, hidden: true } : link
    );
    
    await SecureStore.setItemAsync(PAYLINKS_KEY, JSON.stringify(updated));
    console.log('[PayLink] Successfully hid pay link');
    return true;
  } catch (error) {
    console.error('[PayLink] Error hiding pay link:', error);
    return false;
  }
}

// Restore/unhide a pay link
export async function restorePayLink(id: string): Promise<boolean> {
  try {
    console.log('[PayLink] Restoring pay link:', id);
    const data = await SecureStore.getItemAsync(PAYLINKS_KEY);
    if (!data) return false;

    const stored: StoredPayLink[] = JSON.parse(data);
    const updated = stored.map((link) => 
      link.id === id ? { ...link, hidden: false } : link
    );
    
    await SecureStore.setItemAsync(PAYLINKS_KEY, JSON.stringify(updated));
    console.log('[PayLink] Successfully restored pay link');
    return true;
  } catch (error) {
    console.error('[PayLink] Error restoring pay link:', error);
    return false;
  }
}

export function getPayLinkUrl(publicKey: string): string {
  return `https://lumenless.com/pay/${publicKey}`;
}
