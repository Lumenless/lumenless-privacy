// Token metadata fetching service
// Uses Metaplex SDK to fetch metadata from on-chain Metaplex Token Metadata program

import { Connection, PublicKey } from '@solana/web3.js';
import { Metaplex } from '@metaplex-foundation/js';
import { SOLANA_RPC_URL } from '../constants/solana';

// Cache for token metadata
const tokenMetadataCache: Map<string, { symbol?: string; name?: string; logoURI?: string }> = new Map();

// Well-known tokens (fallback for common tokens)
const WELL_KNOWN_TOKENS: Record<string, { symbol: string; name: string; logoURI?: string }> = {
  'So11111111111111111111111111111111111111112': {
    symbol: 'SOL',
    name: 'Solana',
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
  },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': {
    symbol: 'USDC',
    name: 'USD Coin',
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
  },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': {
    symbol: 'USDT',
    name: 'Tether',
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png',
  },
};

// Create a shared Metaplex instance
let metaplexInstance: Metaplex | null = null;

function getMetaplexInstance(): Metaplex {
  if (!metaplexInstance) {
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    metaplexInstance = Metaplex.make(connection);
  }
  return metaplexInstance;
}

// List of IPFS gateways to try as fallbacks
// Order: Try Pinata first (works well on Android), then dweb.link, then Cloudflare, then ipfs.io
const IPFS_GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://dweb.link/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://ipfs.io/ipfs/',
];

// Convert IPFS URI to HTTP URL using a gateway
function ipfsToHttp(uri: string, gatewayIndex: number = 0): string {
  if (uri.startsWith('ipfs://')) {
    const hash = uri.replace('ipfs://', '');
    return IPFS_GATEWAYS[gatewayIndex] + hash;
  }
  // If already HTTP, try to convert to different gateway if it's IPFS
  for (const gateway of IPFS_GATEWAYS) {
    if (uri.startsWith(gateway)) {
      const hash = uri.replace(gateway, '');
      return IPFS_GATEWAYS[gatewayIndex] + hash;
    }
  }
  return uri;
}

// Ensure an IPFS URL uses a working gateway (prefer Pinata for Android compatibility)
function ensureWorkingGateway(url: string): string {
  if (!url || (!url.includes('/ipfs/') && !url.startsWith('ipfs://'))) {
    return url; // Not an IPFS URL
  }
  
  // Extract IPFS hash
  let hash: string | null = null;
  if (url.startsWith('ipfs://')) {
    hash = url.replace('ipfs://', '');
  } else {
    const match = url.match(/\/ipfs\/([^\/\?]+)/);
    if (match && match[1]) {
      hash = match[1];
    }
  }
  
  if (hash) {
    // Use Pinata gateway (index 0) as it works better on Android devices
    return IPFS_GATEWAYS[0] + hash;
  }
  
  return url; // Return original if we can't parse
}

// Fetch logo URI from metadata URI (usually points to JSON with logo)
async function fetchLogoFromURI(uri: string): Promise<string | undefined> {
  // Determine if this is an IPFS URI
  const isIpfs = uri.startsWith('ipfs://') || uri.includes('/ipfs/');
  
  // Try multiple gateways if IPFS
  const gatewaysToTry = isIpfs ? IPFS_GATEWAYS.length : 1;
  
  for (let i = 0; i < gatewaysToTry; i++) {
    try {
      let fetchUri = isIpfs ? ipfsToHttp(uri, i) : uri;
      
      console.log(`[TokenMetadata] Fetching logo from URI (gateway ${i + 1}/${gatewaysToTry}): ${fetchUri}`);
      
      // Try fetch with timeout
      let response: Response;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        response = await fetch(fetchUri, {
          method: 'GET',
          headers: { 
            'Accept': 'application/json',
          },
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
      } catch (fetchError: any) {
        if (fetchError.name === 'AbortError') {
          console.warn(`[TokenMetadata] Logo fetch timeout for URI: ${fetchUri}`);
        } else {
          console.warn(`[TokenMetadata] Fetch error for URI ${fetchUri}:`, fetchError?.message || fetchError);
        }
        continue; // Try next gateway
      }
      
      if (!response.ok) {
        console.warn(`[TokenMetadata] Failed to fetch logo URI: ${response.status} ${response.statusText} for ${fetchUri}`);
        // If 403 and we have more gateways, try next one
        if (response.status === 403 && i < gatewaysToTry - 1) {
          continue;
        }
        // Try to read response text for more details
        try {
          const errorText = await response.text();
          console.warn(`[TokenMetadata] Error response body: ${errorText.substring(0, 200)}`);
        } catch (e) {
          // Ignore
        }
        continue; // Try next gateway
      }
      
      const json = await response.json();
      console.log(`[TokenMetadata] Successfully fetched JSON from ${fetchUri}, keys:`, Object.keys(json));
      
      const logo = json.image || json.logoURI || json.logo;
      
      if (logo) {
        // Ensure logo URL uses a working gateway
        const logoUrl = ensureWorkingGateway(logo);
        if (logoUrl !== logo) {
          console.log(`[TokenMetadata] Converted logo URL from ${logo} to ${logoUrl}`);
        }
        console.log(`[TokenMetadata] Found logo: ${logoUrl}`);
        return logoUrl;
      }
      
      console.warn(`[TokenMetadata] No logo found in JSON from URI: ${fetchUri}. Available keys:`, Object.keys(json));
      return undefined;
    } catch (error: any) {
      console.warn(`[TokenMetadata] Error fetching logo from URI ${uri} (gateway ${i + 1}):`, error?.message || error);
      // Continue to next gateway if available
      if (i < gatewaysToTry - 1) {
        continue;
      }
    }
  }
  
  console.error(`[TokenMetadata] All gateways failed for URI: ${uri}`);
  return undefined;
}

// Get token metadata for a mint address from on-chain using Metaplex SDK
async function getTokenMetadataOnChain(mint: string): Promise<{ symbol?: string; name?: string; logoURI?: string } | null> {
  try {
    const metaplex = getMetaplexInstance();
    const mintPubkey = new PublicKey(mint);
    
    // Use Metaplex SDK to find metadata account
    // This works for both NFTs and fungible tokens with metadata
    try {
      const metadataAccount = await metaplex.nfts().findByMint({ mintAddress: mintPubkey });
      
      if (!metadataAccount) {
        console.log(`[TokenMetadata] No metadata account found for mint ${mint}`);
        return null;
      }
      
      console.log(`[TokenMetadata] Found metadata for ${mint}: name="${metadataAccount.name}", symbol="${metadataAccount.symbol}", uri="${metadataAccount.uri}"`);
      
      // Fetch logo from URI
      let logoURI = undefined;
      if (metadataAccount.uri) {
        console.log(`[TokenMetadata] Fetching logo for ${mint} from URI: ${metadataAccount.uri}`);
        logoURI = await fetchLogoFromURI(metadataAccount.uri);
        if (logoURI) {
          console.log(`[TokenMetadata] Successfully fetched logo for ${mint}: ${logoURI}`);
        } else {
          console.warn(`[TokenMetadata] Failed to fetch logo for ${mint} from URI: ${metadataAccount.uri}`);
        }
      } else {
        console.log(`[TokenMetadata] No URI found for ${mint}, cannot fetch logo`);
      }
      
      return {
        symbol: metadataAccount.symbol || undefined,
        name: metadataAccount.name || undefined,
        logoURI,
      };
    } catch (findError: any) {
      // If findByMint fails, try using the metadata PDA directly
      if (findError?.message?.includes('AccountNotFound') || findError?.message?.includes('not found')) {
        console.log(`[TokenMetadata] No metadata account found for mint ${mint}`);
        return null;
      }
      throw findError;
    }
  } catch (error: any) {
    // Metaplex SDK throws if metadata doesn't exist, which is expected for some tokens
    if (error?.message?.includes('AccountNotFound') || error?.message?.includes('not found')) {
      console.log(`[TokenMetadata] No metadata account found for mint ${mint}`);
      return null;
    }
    console.error(`[TokenMetadata] Error fetching on-chain metadata for ${mint}:`, error?.message || error);
    return null;
  }
}

// Get token metadata for a mint address
export async function getTokenMetadata(mint: string): Promise<{ symbol?: string; name?: string; logoURI?: string }> {
  // Check cache first
  if (tokenMetadataCache.has(mint)) {
    const cached = tokenMetadataCache.get(mint)!;
    // Ensure cached logoURI uses working gateway
    if (cached.logoURI) {
      const convertedLogo = ensureWorkingGateway(cached.logoURI);
      if (convertedLogo !== cached.logoURI) {
        cached.logoURI = convertedLogo;
        tokenMetadataCache.set(mint, cached);
        console.log(`[TokenMetadata] Converted cached logoURI for ${mint}: ${cached.logoURI} -> ${convertedLogo}`);
      }
    }
    return cached;
  }

  // Check well-known tokens
  if (WELL_KNOWN_TOKENS[mint]) {
    const metadata = WELL_KNOWN_TOKENS[mint];
    tokenMetadataCache.set(mint, metadata);
    return metadata;
  }

  // Fetch from on-chain using Metaplex SDK
  const onChainMetadata = await getTokenMetadataOnChain(mint);
  if (onChainMetadata) {
    // Ensure logoURI uses working gateway before caching
    if (onChainMetadata.logoURI) {
      onChainMetadata.logoURI = ensureWorkingGateway(onChainMetadata.logoURI);
    }
    tokenMetadataCache.set(mint, onChainMetadata);
    return onChainMetadata;
  }

  // No metadata found - return empty
  const empty = {};
  tokenMetadataCache.set(mint, empty);
  return empty;
}

// Batch get token metadata for multiple mints
export async function getTokenMetadataBatch(mints: string[]): Promise<Map<string, { symbol?: string; name?: string; logoURI?: string }>> {
  const results = new Map<string, { symbol?: string; name?: string; logoURI?: string }>();

  // Check cache and well-known tokens first
  for (const mint of mints) {
    if (tokenMetadataCache.has(mint)) {
      const cached = tokenMetadataCache.get(mint)!;
      // Ensure cached logoURI uses working gateway
      if (cached.logoURI) {
        const convertedLogo = ensureWorkingGateway(cached.logoURI);
        if (convertedLogo !== cached.logoURI) {
          cached.logoURI = convertedLogo;
          tokenMetadataCache.set(mint, cached);
        }
      }
      results.set(mint, cached);
    } else if (WELL_KNOWN_TOKENS[mint]) {
      const metadata = WELL_KNOWN_TOKENS[mint];
      tokenMetadataCache.set(mint, metadata);
      results.set(mint, metadata);
    }
  }

  // Fetch remaining tokens from on-chain
  const remainingMints = mints.filter(m => !results.has(m));
  if (remainingMints.length > 0) {
    // Fetch in parallel (but limit concurrency)
    const batchSize = 5;
    for (let i = 0; i < remainingMints.length; i += batchSize) {
      const batch = remainingMints.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (mint) => {
          try {
            const metadata = await getTokenMetadataOnChain(mint);
            if (metadata) {
              // Ensure logoURI uses working gateway before caching
              if (metadata.logoURI) {
                metadata.logoURI = ensureWorkingGateway(metadata.logoURI);
              }
              tokenMetadataCache.set(mint, metadata);
              results.set(mint, metadata);
            } else {
              // Not found - cache empty result
              const empty = {};
              tokenMetadataCache.set(mint, empty);
              results.set(mint, empty);
            }
          } catch (error) {
            // Error - cache empty result
            const empty = {};
            tokenMetadataCache.set(mint, empty);
            results.set(mint, empty);
          }
        })
      );
    }
  }

  return results;
}
