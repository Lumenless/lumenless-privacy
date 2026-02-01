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
 * Token-2022 Program ID
 */
export const TOKEN_2022_PROGRAM_ID = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

// Token-2022 Extension Types
const EXTENSION_TYPE_TOKEN_METADATA = 19;

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
  } catch {
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
      } catch {
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

// ============================================================================
// Token-2022 Metadata Extension Support
// ============================================================================

/**
 * Parse a length-prefixed string from Token-2022 metadata extension
 * Format: 4 bytes (little-endian u32 length) + string bytes
 */
function readLengthPrefixedString(data: Buffer, offset: number): { value: string; newOffset: number } {
  if (offset + 4 > data.length) {
    return { value: '', newOffset: offset };
  }
  
  const length = data.readUInt32LE(offset);
  const stringStart = offset + 4;
  const stringEnd = stringStart + length;
  
  if (stringEnd > data.length) {
    return { value: '', newOffset: offset };
  }
  
  const value = data.slice(stringStart, stringEnd).toString('utf8');
  return { value: cleanStr(value), newOffset: stringEnd };
}

/**
 * Parse Token-2022 metadata extension from mint account data
 * Returns the metadata if found, null otherwise
 */
function parseToken2022MetadataExtension(mintData: Buffer, mintAddress?: string): { symbol?: string; name?: string; uri?: string } | null {
  // Token-2022 mint account base size is 82 bytes
  // Extensions start after the base mint data
  // Format: accountType (1) + mint data (82 minimum)
  
  const MINT_SIZE = 82;
  const log = (msg: string) => console.log(`[Token2022Parse] ${mintAddress?.slice(0, 8) || 'unknown'}... ${msg}`);
  
  log(`Data length: ${mintData.length} bytes`);
  
  if (mintData.length <= MINT_SIZE) {
    log('No extensions (data too short)');
    return null;
  }
  
  // Token-2022 uses TLV encoding for extensions
  // Each extension: type (2 bytes, u16) + length (2 bytes, u16) + data
  // BUT there's also an account type byte and extension pointer area
  
  // The extension area starts at offset 165 (82 mint + 83 padding/header area)
  // Let's try scanning from different offsets
  const possibleOffsets = [82, 165, 166];
  
  for (const startOffset of possibleOffsets) {
    let offset = startOffset;
    log(`Trying scan from offset ${startOffset}`);
    
    let extensionCount = 0;
    while (offset + 4 <= mintData.length && extensionCount < 20) {
      const extensionType = mintData.readUInt16LE(offset);
      const extensionLength = mintData.readUInt16LE(offset + 2);
      
      log(`  Offset ${offset}: type=${extensionType}, length=${extensionLength}`);
      
      if (extensionType === 0 && extensionLength === 0) {
        break;
      }
      
      // Sanity check
      if (extensionLength > mintData.length - offset - 4) {
        log(`  Invalid extension length, breaking`);
        break;
      }
      
      if (extensionType === EXTENSION_TYPE_TOKEN_METADATA) {
        log(`  Found TokenMetadata extension at offset ${offset}!`);
        const extDataStart = offset + 4;
        const extData = mintData.slice(extDataStart, extDataStart + extensionLength);
        
        log(`  Extension data length: ${extData.length}`);
        
        if (extData.length < 64) {
          log(`  Not enough data for metadata header`);
          return null;
        }
        
        // TokenMetadata layout:
        // - update_authority: Pubkey (32 bytes)
        // - mint: Pubkey (32 bytes)
        // - name: String (length-prefixed)
        // - symbol: String (length-prefixed)
        // - uri: String (length-prefixed)
        
        let parseOffset = 64; // Skip update_authority + mint
        
        const nameResult = readLengthPrefixedString(extData, parseOffset);
        log(`  name: "${nameResult.value}" (offset ${parseOffset} -> ${nameResult.newOffset})`);
        parseOffset = nameResult.newOffset;
        
        const symbolResult = readLengthPrefixedString(extData, parseOffset);
        log(`  symbol: "${symbolResult.value}" (offset ${parseOffset} -> ${symbolResult.newOffset})`);
        parseOffset = symbolResult.newOffset;
        
        const uriResult = readLengthPrefixedString(extData, parseOffset);
        log(`  uri: "${uriResult.value}" (offset ${parseOffset} -> ${uriResult.newOffset})`);
        
        return {
          name: nameResult.value || undefined,
          symbol: symbolResult.value || undefined,
          uri: uriResult.value || undefined,
        };
      }
      
      // Move to next extension
      offset += 4 + extensionLength;
      extensionCount++;
    }
  }
  
  log('TokenMetadata extension not found');
  return null;
}

/**
 * Fetch Token-2022 metadata from mint accounts using the metadata extension
 * This is different from Metaplex - the metadata is stored directly in the mint account
 */
export async function fetchToken2022MetadataBatch(
  rpc: SolanaRpc,
  mints: string[],
  options?: { fetchImages?: boolean }
): Promise<Map<string, TokenMetadata>> {
  const results = new Map<string, TokenMetadata>();
  const fetchImages = options?.fetchImages !== false;
  
  if (mints.length === 0) {
    return results;
  }
  
  console.log(`[Token2022Service] Fetching metadata for ${mints.length} Token-2022 mint(s):`, mints);
  
  try {
    // Fetch all mint accounts
    const mintAddresses = mints.map(m => address(m));
    const accounts = await rpc.getMultipleAccounts(mintAddresses, { encoding: 'base64' }).send();
    
    console.log(`[Token2022Service] Got ${accounts?.value?.length || 0} accounts from RPC`);
    
    // Collect URIs for off-chain metadata fetch
    const urisToFetch: Array<{ mint: string; uri: string }> = [];
    
    for (let i = 0; i < mints.length; i++) {
      const mintStr = mints[i];
      const acc = accounts?.value?.[i];
      
      console.log(`[Token2022Service] Processing ${mintStr}...`);
      
      if (!acc) {
        console.log(`[Token2022Service] ${mintStr}: No account data returned`);
        continue;
      }
      
      console.log(`[Token2022Service] ${mintStr}: owner=${acc.owner}, dataLen=${Array.isArray(acc.data) ? acc.data[0]?.length : 'unknown'}`);
      
      // Verify this is a Token-2022 account
      if (acc.owner !== TOKEN_2022_PROGRAM_ID) {
        console.log(`[Token2022Service] ${mintStr}: Not a Token-2022 mint (owner: ${acc.owner}), skipping`);
        continue;
      }
      
      const buf = decodeAccountDataToBuffer(acc.data);
      if (!buf) {
        console.log(`[Token2022Service] ${mintStr}: Failed to decode account data`);
        continue;
      }
      
      console.log(`[Token2022Service] ${mintStr}: Decoded buffer length: ${buf.length}`);
      
      // Parse the metadata extension
      const metadata = parseToken2022MetadataExtension(buf, mintStr);
      
      if (metadata) {
        console.log(`[Token2022Service] ✓ Found: ${mintStr} -> ${metadata.symbol} (${metadata.name}), uri: ${metadata.uri?.slice(0, 50)}...`);
        
        results.set(mintStr, {
          mint: mintStr,
          symbol: metadata.symbol,
          name: metadata.name,
          uri: metadata.uri,
        });
        
        // Collect URI for image fetch
        if (fetchImages && metadata.uri) {
          urisToFetch.push({ mint: mintStr, uri: metadata.uri });
        }
      } else {
        console.log(`[Token2022Service] ✗ No metadata extension found for ${mintStr}`);
      }
    }
    
    // Fetch off-chain metadata to get images
    if (fetchImages && urisToFetch.length > 0) {
      console.log(`[Token2022Service] Fetching off-chain metadata for ${urisToFetch.length} URIs...`);
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
    console.error('[Token2022Service] Error in batch fetch:', err);
  }
  
  console.log(`[Token2022Service] Successfully fetched ${results.size}/${mints.length} metadata`);
  return results;
}
