import { createSolanaRpc, address, Address, getProgramDerivedAddress } from '@solana/kit';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import { getMetadataAccountDataSerializer } from '@metaplex-foundation/mpl-token-metadata';

// Type for RPC (return type of createSolanaRpc)
type SolanaRpc = ReturnType<typeof createSolanaRpc>;

/**
 * Metaplex Token Metadata Program ID
 */
export const TOKEN_METADATA_PROGRAM_ID = address('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

/**
 * Token metadata information
 */
export interface TokenMetadata {
  mint: string;
  symbol?: string;
  name?: string;
  uri?: string;
  image?: string; // Actual image URL fetched from off-chain JSON
}

/**
 * Off-chain metadata JSON structure (from URI)
 */
interface OffChainMetadata {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  animation_url?: string;
  external_url?: string;
  attributes?: Array<{ trait_type: string; value: string | number }>;
}

/**
 * Helper function to clean null bytes from strings
 */
function cleanStr(s: string): string {
  return s.replace(/\0/g, '').trim();
}

/**
 * Decodes account data from various RPC response formats to a Buffer
 */
function decodeAccountDataToBuffer(data: unknown): Buffer | null {
  if (!data) return null;

  // Most common: [base64String, 'base64']
  if (Array.isArray(data) && typeof data[0] === 'string') {
    return Buffer.from(data[0], 'base64');
  }

  // Sometimes: { data: [base64, 'base64'] }
  if (typeof data === 'object' && data !== null && 'data' in data && Array.isArray((data as { data: unknown }).data) && typeof (data as { data: string[] }).data[0] === 'string') {
    return Buffer.from((data as { data: string[] }).data[0], 'base64');
  }

  // Sometimes: base64 string directly
  if (typeof data === 'string') {
    return Buffer.from(data, 'base64');
  }

  return null;
}

/**
 * Fetch off-chain metadata JSON from URI and extract image
 * Handles various URI formats (IPFS, Arweave, HTTP)
 */
async function fetchOffChainMetadata(uri: string): Promise<OffChainMetadata | null> {
  if (!uri) return null;
  
  try {
    // Convert IPFS URIs to HTTP gateway URLs
    let fetchUrl = uri;
    if (uri.startsWith('ipfs://')) {
      fetchUrl = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
    } else if (uri.startsWith('ar://')) {
      fetchUrl = uri.replace('ar://', 'https://arweave.net/');
    }
    
    const response = await fetch(fetchUrl, {
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });
    
    if (!response.ok) {
      return null;
    }
    
    const json = await response.json();
    return json as OffChainMetadata;
  } catch (err) {
    // Silently fail for off-chain metadata - it's optional
    return null;
  }
}

/**
 * Batch fetch off-chain metadata for multiple URIs
 * Returns a map of URI -> image URL
 */
async function fetchOffChainMetadataBatch(
  uris: Array<{ mint: string; uri: string }>
): Promise<Map<string, string>> {
  const imageMap = new Map<string, string>();
  
  if (uris.length === 0) return imageMap;
  
  console.log(`[MetaplexService] Fetching off-chain metadata for ${uris.length} token(s)...`);
  
  // Fetch all URIs in parallel with timeout
  const results = await Promise.allSettled(
    uris.map(async ({ mint, uri }) => {
      const metadata = await fetchOffChainMetadata(uri);
      if (metadata?.image) {
        // Convert IPFS image URIs to HTTP
        let imageUrl = metadata.image;
        if (imageUrl.startsWith('ipfs://')) {
          imageUrl = imageUrl.replace('ipfs://', 'https://ipfs.io/ipfs/');
        } else if (imageUrl.startsWith('ar://')) {
          imageUrl = imageUrl.replace('ar://', 'https://arweave.net/');
        }
        return { mint, image: imageUrl };
      }
      return null;
    })
  );
  
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      imageMap.set(result.value.mint, result.value.image);
    }
  }
  
  console.log(`[MetaplexService] Fetched ${imageMap.size}/${uris.length} images`);
  return imageMap;
}

/**
 * Finds the metadata PDA for a given mint address
 */
export async function findMetadataPda(mint: Address): Promise<Address> {
  const metadataProgramBytes = bs58.decode(TOKEN_METADATA_PROGRAM_ID);
  const mintBytes = bs58.decode(mint);
  
  const [pda] = await getProgramDerivedAddress({
    programAddress: TOKEN_METADATA_PROGRAM_ID,
    seeds: [
      Buffer.from('metadata'),
      Buffer.from(metadataProgramBytes),
      Buffer.from(mintBytes),
    ],
  });

  return pda;
}

/**
 * Fetch token metadata from Metaplex for a single mint
 */
export async function fetchTokenMetadata(
  rpc: SolanaRpc,
  mint: string
): Promise<TokenMetadata | null> {
  try {
    const mintAddr = address(mint);
    const metadataPda = await findMetadataPda(mintAddr);
    
    const accountInfo = await rpc.getAccountInfo(metadataPda, { encoding: 'base64' }).send();
    
    if (!accountInfo.value) {
      return null;
    }
    
    const buf = decodeAccountDataToBuffer(accountInfo.value.data);
    if (!buf) {
      return null;
    }
    
    const serializer = getMetadataAccountDataSerializer();
    const bytes = new Uint8Array(buf);
    const metadataData = serializer.deserialize(bytes)[0];
    
    return {
      mint,
      symbol: cleanStr(metadataData.symbol) || undefined,
      name: cleanStr(metadataData.name) || undefined,
      uri: cleanStr(metadataData.uri) || undefined,
    };
  } catch (err) {
    console.error(`[MetaplexService] Error fetching metadata for ${mint}:`, err);
    return null;
  }
}

/**
 * Batch fetch token metadata from Metaplex for multiple mints
 * Also fetches off-chain metadata to get images
 * More efficient than fetching one by one
 */
export async function fetchTokenMetadataBatch(
  rpc: SolanaRpc,
  mints: string[],
  options?: { fetchImages?: boolean }
): Promise<Map<string, TokenMetadata>> {
  const results = new Map<string, TokenMetadata>();
  const fetchImages = options?.fetchImages !== false; // Default to true
  
  if (mints.length === 0) {
    return results;
  }
  
  console.log(`[MetaplexService] Fetching metadata for ${mints.length} mint(s)...`);
  
  try {
    // Get metadata PDAs for all mints
    const mintPdaPairs = await Promise.all(
      mints.map(async (mintStr) => {
        const pda = await findMetadataPda(address(mintStr));
        return { mint: mintStr, pda };
      })
    );
    
    // Batch fetch all metadata accounts
    const accounts = await rpc.getMultipleAccounts(
      mintPdaPairs.map(p => p.pda),
      { encoding: 'base64' }
    ).send();
    
    // Collect URIs for off-chain metadata fetch
    const urisToFetch: Array<{ mint: string; uri: string }> = [];
    
    // Parse each metadata account
    for (let i = 0; i < mintPdaPairs.length; i++) {
      const acc = accounts?.value?.[i];
      const mintStr = mintPdaPairs[i].mint;
      
      if (!acc) {
        continue;
      }
      
      const buf = decodeAccountDataToBuffer(acc.data);
      if (!buf) {
        continue;
      }
      
      try {
        const serializer = getMetadataAccountDataSerializer();
        const bytes = new Uint8Array(buf);
        const metadataData = serializer.deserialize(bytes)[0];
        
        const symbol = cleanStr(metadataData.symbol);
        const name = cleanStr(metadataData.name);
        const uri = cleanStr(metadataData.uri);
        
        console.log(`[MetaplexService] Found: ${mintStr} -> ${symbol} (${name})`);
        
        results.set(mintStr, {
          mint: mintStr,
          symbol: symbol || undefined,
          name: name || undefined,
          uri: uri || undefined,
        });
        
        // Collect URI for image fetch
        if (fetchImages && uri) {
          urisToFetch.push({ mint: mintStr, uri });
        }
      } catch (err) {
        console.log(`[MetaplexService] Could not parse metadata for ${mintStr}`);
      }
    }
    
    // Fetch off-chain metadata to get images
    if (fetchImages && urisToFetch.length > 0) {
      const imageMap = await fetchOffChainMetadataBatch(urisToFetch);
      
      // Update results with images
      for (const [mintStr, imageUrl] of imageMap) {
        const existing = results.get(mintStr);
        if (existing) {
          existing.image = imageUrl;
        }
      }
    }
  } catch (err) {
    console.error('[MetaplexService] Error in batch fetch:', err);
  }
  
  console.log(`[MetaplexService] Successfully fetched ${results.size}/${mints.length} metadata`);
  return results;
}

/**
 * MetaplexService class for working with token metadata
 */
export class MetaplexService {
  private rpc: SolanaRpc;

  constructor(rpcOrEndpoint: SolanaRpc | string) {
    if (typeof rpcOrEndpoint === 'string') {
      this.rpc = createSolanaRpc(rpcOrEndpoint);
    } else {
      this.rpc = rpcOrEndpoint;
    }
  }

  /**
   * Fetch metadata for a single token mint
   */
  async getTokenMetadata(mint: string): Promise<TokenMetadata | null> {
    return fetchTokenMetadata(this.rpc, mint);
  }

  /**
   * Batch fetch metadata for multiple token mints
   */
  async getTokenMetadataBatch(mints: string[]): Promise<Map<string, TokenMetadata>> {
    return fetchTokenMetadataBatch(this.rpc, mints);
  }

  /**
   * Get the metadata PDA for a mint
   */
  async getMetadataPda(mint: string): Promise<Address> {
    return findMetadataPda(address(mint));
  }
}
