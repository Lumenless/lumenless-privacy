import { createSolanaRpc, address, Address, getProgramDerivedAddress } from '@solana/kit';
import { PublicKey, Connection } from '@solana/web3.js'; // Temporary - only for PDA derivation until kit has native support
import { useQuery } from '@tanstack/react-query';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import { getMetadataAccountDataSerializer } from '@metaplex-foundation/mpl-token-metadata';
import { getDomainKeySync, NameRegistryState, NAME_PROGRAM_ID, ROOT_DOMAIN_ACCOUNT, reverseLookup } from '@bonfida/spl-name-service';

import {
  getDomainRecord,
  getDomainsForAddress,
  Record as SnsRecord,
} from '@solana-name-service/sns-sdk-kit';

// Import Metaplex service for token metadata
import { findMetadataPda, fetchTokenMetadataBatch, fetchToken2022MetadataBatch } from './metaplex-service';

// Type for RPC (return type of createSolanaRpc)
type SolanaRpc = ReturnType<typeof createSolanaRpc>;

const TOKEN_PROGRAM_ID = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'); // token-2022
const SOL_DOMAIN_COLLECTION_ADDRESS = 'E5ZnBpH9DYcxRkumKdS4ayJ3Ftb6o3E8wSbXw4N92GWg';

/**
 * Helper function to chunk an array into smaller arrays
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Helper function to clean null bytes from strings
 */
function cleanStr(s: string) {
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
 * V2 record result structure
 */
interface SingleRecordResult {
  retrievedRecord: unknown; // Type from SNS SDK
  deserializedContent?: string;
}

/**
 * Result of fetching a domain record (combines V1 and V2 data)
 */
export interface DomainRecordResult {
  /** The extracted address (from V2 or V1) */
  address: string | null;
  /** Whether the record is verified (V2 only) */
  isVerified: boolean | null;
  /** Whether we're still loading */
  isLoading: boolean;
  /** Any error that occurred */
  error: Error | null;
  /** Raw V2 record data */
  v2Data: SingleRecordResult | null;
  /** Raw V1 record data */
  v1Data: unknown | null; // RegistryState or NameRegistryState depending on package
  /** Which version had the data (v1, v2, or null) */
  source: 'v1' | 'v2' | null;
}

/**
 * Verification status from V2 record header
 */
export interface VerificationStatus {
  isVerified: boolean;
  hasRightOfAssociation: boolean;
  hasStalenessValidation: boolean;
}

/**
 * SNS Service Class
 * Handles fetching and managing Solana Name Service records
 * Uses @solana/kit RPC and @solana-name-service/sns-sdk-kit
 */
export class SNSService {
  private rpc: SolanaRpc;

  constructor(rpcOrEndpoint: SolanaRpc | string) {
    // Accept either RPC instance or endpoint string
    if (typeof rpcOrEndpoint === 'string') {
      this.rpc = createSolanaRpc(rpcOrEndpoint);
    } else {
      this.rpc = rpcOrEndpoint;
    }
  }

  /**
   * Fetches a domain record, trying both V1 and V2 formats
   * @param domain The domain name (without .sol suffix)
   * @param recordType The record type to fetch (e.g., Record.SOL)
   * @returns Promise with the combined result
   */
  async fetchDomainRecord(
    domain: string,
    recordType: typeof SnsRecord
  ): Promise<DomainRecordResult> {
    let v2Data: SingleRecordResult | null = null;
    const v1Data: unknown | null = null;
    let v2Error: Error | null = null;
    const v1Error: Error | null = null;

    // Try to get domain record using kit's getDomainRecord
    // Type assertion needed due to RPC type incompatibilities between packages
    try {
      // Type assertion needed due to RPC and Record type incompatibilities between packages
      const recordResult = await getDomainRecord({ rpc: this.rpc as unknown as Parameters<typeof getDomainRecord>[0]['rpc'], domain, record: recordType as unknown as Parameters<typeof getDomainRecord>[0]['record'] });
      // getDomainRecord returns the record data directly
      const recordContent = typeof recordResult === 'object' && recordResult !== null && 'content' in recordResult 
        ? (recordResult as { content?: string }).content 
        : undefined;
      v2Data = { retrievedRecord: recordResult, deserializedContent: recordContent };
    } catch (err) {
      v2Error = err instanceof Error ? err : new Error(String(err));
    }

    // Extract address from V2 or V1
    const addressStr = this.extractAddress(v2Data, v1Data);
    
    // Determine source first
    let source: 'v1' | 'v2' | null = null;
    if (addressStr) {
      if (v2Data && this.extractAddressFromV2(v2Data)) {
        source = 'v2';
      } else if (v1Data) {
        source = 'v1';
      }
    }
    
    // Determine verification status - only V2 records can be verified
    // V1 records return null (not applicable)
    const verificationStatus = source === 'v2' 
      ? this.getVerificationStatus(v2Data)
      : { isVerified: null, hasRightOfAssociation: false, hasStalenessValidation: false };

    // Combine errors (prefer V2 error if both failed, but V1 might have data)
    const error = v2Error && v1Error ? v2Error : null;

    return {
      address: addressStr,
      isVerified: verificationStatus.isVerified,
      isLoading: false,
      error,
      v2Data,
      v1Data,
      source,
    };
  }

  /**
   * Extracts the address from V2 or V1 record data
   */
  private extractAddress(v2Data: SingleRecordResult | null, v1Data: unknown | null): string | null {
    // Try V2 first
    const v2Address = this.extractAddressFromV2(v2Data);
    if (v2Address) {
      return v2Address;
    }

    // Fallback to V1
    if (v1Data && typeof v1Data === 'object' && v1Data !== null && 'data' in v1Data) {
      try {
        // V1 records store the address as bytes in the data field
        const v1Record = v1Data as { data: unknown };
        let addressBytes: Uint8Array | null = null;
        
        if (Array.isArray(v1Record.data)) {
          addressBytes = new Uint8Array(v1Record.data.slice(0, 32));
        } else if (v1Record.data instanceof Uint8Array) {
          addressBytes = v1Record.data.slice(0, 32);
        }
        
        if (!addressBytes) return null;
        
        // Convert bytes to base58 string, then to Address
        // V1 data is already in the correct format - convert to base58 first
        const base58String = bs58.encode(addressBytes);
        const addr = address(base58String);
        return addr;
      } catch (err) {
        console.error('Error extracting address from V1 record:', err);
      }
    }

    return null;
  }

  /**
   * Extracts address from V2 record data
   */
  private extractAddressFromV2(v2Data: SingleRecordResult | null): string | null {
    if (!v2Data) return null;

    try {
      // V2 records from getRecordV2 return SingleRecordResult with:
      // - retrievedRecord: SnsRecord
      // - deserializedContent?: string (when deserialize: true)
      
      // First check for deserializedContent (most direct)
      if (v2Data.deserializedContent && typeof v2Data.deserializedContent === 'string') {
        return v2Data.deserializedContent;
      }

      // Check if it's already a string (deserialized)
      if (typeof v2Data === 'string') {
        return v2Data;
      }

      // Check if it's an array with the first element being the address
      if (Array.isArray(v2Data) && v2Data.length > 0) {
        if (typeof v2Data[0] === 'string') {
          return v2Data[0];
        }
      }

      // Check if it has a retrievedRecord structure
      if (v2Data.retrievedRecord) {
        // Try to get content from the retrievedRecord
        try {
          const record = v2Data.retrievedRecord as unknown as { getContent?: () => string | string[] | undefined };
          const content = record.getContent?.();
          if (content && typeof content === 'string') {
            return content;
          }
          if (Array.isArray(content) && content.length > 0 && typeof content[0] === 'string') {
            return content[0];
          }
        } catch {
          // getContent() might not be available or might throw
        }
      }
    } catch (err) {
      console.error('Error extracting address from V2 record:', err);
    }

    return null;
  }

  /**
   * Gets verification status from V2 record header
   */
  private getVerificationStatus(v2Data: SingleRecordResult | null): VerificationStatus {
    if (!v2Data) {
      return {
        isVerified: false,
        hasRightOfAssociation: false,
        hasStalenessValidation: false,
      };
    }

    try {
      // Navigate to the header from retrievedRecord
      const record = v2Data.retrievedRecord as unknown as { header?: { isVerified?: boolean; rightOfAssociationValidation?: number; stalenessValidation?: number } } | null;
      const header = record?.header || null;

      if (!header) {
        return {
          isVerified: false,
          hasRightOfAssociation: false,
          hasStalenessValidation: false,
        };
      }

      // Check if validations are set to Validation.Solana (which is 1)
      // A record is verified only if both validations equal Validation.Solana
      const hasRightOfAssociation = 
        (header.rightOfAssociationValidation ?? 0) === 1; // Validation.Solana
      
      const hasStalenessValidation = 
        (header.stalenessValidation ?? 0) === 1; // Validation.Solana

      return {
        isVerified: hasRightOfAssociation && hasStalenessValidation,
        hasRightOfAssociation,
        hasStalenessValidation,
      };
    } catch (err) {
      console.error('Error getting verification status:', err);
      return {
        isVerified: false,
        hasRightOfAssociation: false,
        hasStalenessValidation: false,
      };
    }
  }

  /**
   * Fetches multiple records for a domain
   * @param domain The domain name (without .sol suffix)
   * @param recordTypes Array of record types to fetch
   * @returns Promise with results for each record type
   */
  async fetchDomainRecords(
    domain: string,
    recordTypes: (typeof SnsRecord)[]
  ): Promise<{ [key: string]: DomainRecordResult }> {
    const results: { [key: string]: DomainRecordResult } = {};

    await Promise.all(
      recordTypes.map(async (recordType) => {
        const result = await this.fetchDomainRecord(domain, recordType);
        results[String(recordType)] = result;
      })
    );

    return results;
  }


  /**
   * Fetches all wrapped SNS domains owned by a wallet using Metaplex metadata
   * When domains are wrapped, they become NFTs and ownership is tracked via token accounts
   * Uses getDomainsForAddress for unwrapped domains and Metaplex metadata for wrapped domains
   * @param ownerAddress The address of the wallet owner
   * @returns Promise<Array<{ domain: string; pubkey: Address }>> - Array of wrapped domains
   */
  async fetchWrappedDomains(ownerAddress: string | Address): Promise<Array<{ domain: string; pubkey: Address }>> {
    try {
      const ownerAddr = typeof ownerAddress === 'string' ? address(ownerAddress) : ownerAddress;
      const batchSize = 100;
      const includeToken2022 = true;

      console.log(`[fetchWrappedDomains] Starting fetch for owner: ${ownerAddr}`);

      // 1) Get token accounts by owner (parsed) for both Token and Token-2022 programs
      console.log(`[fetchWrappedDomains] Fetching token accounts for Token program...`);
      const calls = [
        this.rpc.getTokenAccountsByOwner(ownerAddr, { programId: TOKEN_PROGRAM_ID }, { encoding: 'jsonParsed' }).send(),
      ];
      if (includeToken2022) {
        console.log(`[fetchWrappedDomains] Fetching token accounts for Token-2022 program...`);
        calls.push(
          this.rpc.getTokenAccountsByOwner(ownerAddr, { programId: TOKEN_2022_PROGRAM_ID }, { encoding: 'jsonParsed' }).send()
        );
      }

      const res = await Promise.all(calls);
      const tokenAccounts = res.flatMap((r) => {
        const response = r as unknown as { value?: Array<{ account: { data: { parsed?: { info?: { mint?: string; tokenAmount?: { decimals?: number; amount?: string } } } } } }> };
        return response.value ?? [];
      });

      console.log(`[fetchWrappedDomains] Found ${tokenAccounts.length} total token accounts`);

      // 2) Pick NFT-ish mints (decimals=0, amount=1)
      const mints: Address[] = [];
      const seen = new Set<string>();
      let nftCandidatesCount = 0;
      let skippedNonNFT = 0;
      let skippedDuplicate = 0;

      for (const ta of tokenAccounts) {
        const info = ta?.account?.data?.parsed?.info;
        if (!info) {
          console.debug(`[fetchWrappedDomains] Skipping token account - no parsed info`);
          continue;
        }

        const tokenAmount = info.tokenAmount;
        const decimals = tokenAmount?.decimals ?? -1;
        const amount = tokenAmount?.amount ?? '0';
        const mintStr: string | undefined = info.mint;

        if (!mintStr) {
          console.debug(`[fetchWrappedDomains] Skipping token account - no mint address`);
          continue;
        }

        if (seen.has(mintStr)) {
          skippedDuplicate++;
          continue;
        }

        // Log details for potential NFTs
        if (decimals === 0 && amount === '1') {
          nftCandidatesCount++;
          console.log(`[fetchWrappedDomains] NFT candidate found: mint=${mintStr}, decimals=${decimals}, amount=${amount}`);
        } else {
          skippedNonNFT++;
          if (decimals === 0 || amount === '1') {
            console.debug(`[fetchWrappedDomains] Not an NFT: mint=${mintStr}, decimals=${decimals}, amount=${amount}`);
          }
        }

        if (decimals !== 0 || amount !== '1') continue;

        seen.add(mintStr);
        mints.push(address(mintStr));
      }

      console.log(`[fetchWrappedDomains] NFT candidates: ${nftCandidatesCount}, unique NFTs: ${mints.length}, skipped non-NFT: ${skippedNonNFT}, skipped duplicates: ${skippedDuplicate}`);
      console.log(`[fetchWrappedDomains] NFT candidates seen: ${JSON.stringify(mints)}`);

      if (mints.length === 0) {
        console.log(`[fetchWrappedDomains] No NFT mints found, returning empty array`);
        return [];
      }

      // 3) Get metadata PDAs for all mints
      console.log(`[fetchWrappedDomains] Deriving metadata PDAs for ${mints.length} mints...`);
      const pairs = await Promise.all(
        mints.map(async (mint) => {
          const mdPda = await findMetadataPda(mint);
          console.debug(`[fetchWrappedDomains] Mint ${mint} -> Metadata PDA ${mdPda}`);
          return { mint, mdPda };
        })
      );

      // 4) Batch fetch metadata accounts and filter for .sol domains
      const wrappedDomains: Array<{ domain: string; pubkey: Address }> = [];
      const batches = chunk(pairs, batchSize);
      console.log(`[fetchWrappedDomains] Processing ${batches.length} batch(es) of metadata accounts...`);

      for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        const batch = batches[batchIdx];
        console.log(`[fetchWrappedDomains] Fetching batch ${batchIdx + 1}/${batches.length} (${batch.length} accounts)...`);
        const accounts = await this.rpc.getMultipleAccounts(batch.map((p) => p.mdPda), { encoding: 'base64' }).send();

        for (let i = 0; i < batch.length; i++) {
          const acc = accounts?.value?.[i];
          const mint = batch[i].mint;
          const mdPda = batch[i].mdPda;

          if (!acc) {
            console.debug(`[fetchWrappedDomains] No metadata account found for mint ${mint} (PDA: ${mdPda})`);
            continue;
          }

          const buf = decodeAccountDataToBuffer(acc.data);
          if (!buf) {
            console.debug(`[fetchWrappedDomains] Could not decode metadata account data for mint ${mint} (PDA: ${mdPda})`);
            continue;
          }

          try {
            // Use Metaplex serializer to properly deserialize metadata
            const serializer = getMetadataAccountDataSerializer();
            
            // Convert Buffer to Uint8Array for the serializer
            // The account data from getMultipleAccounts is the raw account data (starts with discriminator/key byte)
            const bytes = new Uint8Array(buf);
            
            // Deserialize the metadata (serializer handles the structure starting from the key byte)
            const metadataData = serializer.deserialize(bytes)[0];
            const name = cleanStr(metadataData.name);
                        
            const collection = metadataData.collection.__option=='Some' ? metadataData.collection.value : undefined;
            console.log(`[fetchWrappedDomains] Mint ${mint}: metadata name="${name}", collection=${collection ? JSON.stringify(collection) : 'undefined'}`);
            
            if (!collection) {
              console.debug(`[fetchWrappedDomains] Mint ${mint}: collection is undefined, skipping`);
              continue;
            }
            
            console.log(`[fetchWrappedDomains] Mint ${mint}: collection address="${collection.key.toString()} verified=${collection.verified}"`);
            
            if (collection.key.toString() !== SOL_DOMAIN_COLLECTION_ADDRESS) {
              console.debug(`[fetchWrappedDomains] Mint ${mint}: collection "${collection.key.toString()}" does not match SOL domain collection "${SOL_DOMAIN_COLLECTION_ADDRESS}", skipping`);
              continue;
            }

            // Use the name as the domain (it doesn't have .sol suffix in metadata)
            const domainName = name;
            console.log(`[fetchWrappedDomains] ✓ Found wrapped domain: ${domainName}.sol (mint: ${mint})`);
            wrappedDomains.push({
              domain: domainName,
              pubkey: mint,
            });
          } catch (err) {
            console.error(`[fetchWrappedDomains] Error parsing metadata for mint ${mint}:`, err);
            if (err instanceof Error) {
              console.error(`[fetchWrappedDomains] Error details: ${err.message}`);
              if (err.stack) {
                console.error(`[fetchWrappedDomains] Stack: ${err.stack}`);
              }
            }
            continue;
          }
        }
      }

      console.log(`[fetchWrappedDomains] ✓ Found ${wrappedDomains.length} wrapped domains via Metaplex metadata`);
      if (wrappedDomains.length > 0) {
        console.log(`[fetchWrappedDomains] Domain list:`, wrappedDomains.map(d => d.domain));
      }

      return wrappedDomains;
    } catch (err) {
      console.error('[fetchWrappedDomains] Error fetching wrapped domains:', err);
      return [];
    }
  }

  /**
   * Fetches all unwrapped SNS domains owned by a wallet
   * @param ownerAddress The address of the wallet owner
   * @returns Promise<Array<{ domain: string; pubkey: Address }>> - Array of unwrapped domains
   */
  async fetchDomainsForOwner(ownerAddress: string | Address): Promise<Array<{ domain: string; pubkey: Address }>> {
    try {
      const ownerAddr = typeof ownerAddress === 'string' ? address(ownerAddress) : ownerAddress;
      
      // Use getDomainsForAddress from @solana-name-service/sns-sdk-kit
      // Type assertion needed due to RPC type incompatibilities between packages
      const results = await getDomainsForAddress({ 
        rpc: this.rpc as unknown as Parameters<typeof getDomainsForAddress>[0]['rpc'], 
        address: ownerAddr 
      });

      // Convert the result format to match our expected format
      return results.map(result => ({
        domain: result.domain,
        pubkey: result.domainAddress,
      }));
    } catch (err) {
      console.error('Error fetching domains for owner:', err);
      return [];
    }
  }

  /**
   * Gets the parent domain owner for a given domain
   * @param domain The domain name (e.g., "lumenless.sol" or "lumenless")
   * @param endpoint The Solana RPC endpoint (required for Connection)
   * @returns Promise with the parent domain owner PublicKey and domain key
   */
  async getParentDomainOwner(domain: string, endpoint: string): Promise<{
    parentDomainKey: PublicKey;
    parentDomainOwner: PublicKey;
    isRegistrar: boolean;
  }> {
    try {
      // Ensure domain has .sol suffix
      const parentDomainFull = domain.endsWith('.sol') ? domain : `${domain}.sol`;
      
      // Get the parent domain account key
      const { pubkey: parentDomainKey } = getDomainKeySync(parentDomainFull);
      
      // Create Connection to fetch account info
      const connection = new Connection(endpoint, 'confirmed');
      const parentDomainAccount = await connection.getAccountInfo(parentDomainKey);
      
      if (!parentDomainAccount) {
        throw new Error(`Parent domain ${parentDomainFull} not found`);
      }
      
      // Get the owner from the parent domain account
      const parentDomainState = NameRegistryState.deserialize(Buffer.from(parentDomainAccount.data));
      const parentDomainOwner = parentDomainState.owner;
      
      // Check if parent is owned by a registrar (program)
      const parentOwnerAccount = await connection.getAccountInfo(parentDomainOwner);
      const isRegistrar = parentOwnerAccount?.executable === true;
      
      return {
        parentDomainKey,
        parentDomainOwner,
        isRegistrar,
      };
    } catch (err) {
      console.error('Error getting parent domain owner:', err);
      throw err;
    }
  }

  /**
   * Checks if a subdomain is available for registration
   * @param subdomain The subdomain name (e.g., "mike")
   * @param parentDomain The parent domain name (e.g., "lumenless" or "lumenless.sol")
   * @param endpoint The Solana RPC endpoint (required for Connection)
   * @returns Promise with availability status and additional info
   */
  async isSubdomainAvailable(subdomain: string, parentDomain: string, endpoint: string): Promise<{
    available: boolean;
    subdomainKey: PublicKey;
    existingOwner?: PublicKey;
  }> {
    try {
      // Ensure parent domain has .sol suffix
      const parentDomainFull = parentDomain.endsWith('.sol') ? parentDomain : `${parentDomain}.sol`;
      
      // Construct full subdomain: subdomain.parent.sol
      const fullSubdomain = `${subdomain}.${parentDomainFull}`;
      
      // Get the subdomain account key
      const { pubkey: subdomainKey } = getDomainKeySync(fullSubdomain);
      
      // Create Connection to fetch account info
      const connection = new Connection(endpoint, 'confirmed');
      const subdomainAccount = await connection.getAccountInfo(subdomainKey);
      
      // If no account exists, subdomain is available
      if (!subdomainAccount) {
        return {
          available: true,
          subdomainKey,
        };
      }
      
      // Subdomain exists, get the owner
      const subdomainState = NameRegistryState.deserialize(Buffer.from(subdomainAccount.data));
      
      return {
        available: false,
        subdomainKey,
        existingOwner: subdomainState.owner,
      };
    } catch (err) {
      console.error('Error checking subdomain availability:', err);
      throw err;
    }
  }

  /**
   * Fetches ALL subdomains owned by a wallet across ALL parent domains
   * Uses getProgramAccounts to find all name accounts owned by wallet,
   * then filters for subdomains (those with non-ROOT parentName)
   * @param ownerAddress The wallet address
   * @param endpoint The Solana RPC endpoint
   * @returns Promise with array of all subdomains owned by the wallet
   */
  async fetchAllSubdomainsForOwner(
    ownerAddress: string,
    endpoint: string
  ): Promise<Array<{ domain: string; pubkey: string; parentDomain: string; isSubdomain: true }>> {
    try {
      const connection = new Connection(endpoint, 'confirmed');
      const ownerPubkey = new PublicKey(ownerAddress);
      
      console.log(`[SNS] Fetching ALL name accounts owned by: ${ownerAddress}`);
      
      // Use getProgramAccounts with memcmp filter to find ALL name accounts owned by wallet
      // Owner field is at offset 32 in NameRegistry account data
      const accounts = await connection.getProgramAccounts(NAME_PROGRAM_ID, {
        filters: [
          {
            memcmp: {
              offset: 32, // Owner field offset in NameRegistry
              bytes: ownerPubkey.toBase58(),
            },
          },
        ],
      });
      
      if (!accounts || accounts.length === 0) {
        console.log('[SNS] No name accounts found for wallet');
        return [];
      }
      
      console.log(`[SNS] Found ${accounts.length} total name accounts for wallet`);
      
      const subdomains: Array<{ domain: string; pubkey: string; parentDomain: string; isSubdomain: true }> = [];
      
      // Process each account to check if it's a subdomain
      for (const account of accounts) {
        try {
          // Deserialize the account data to get parentName
          const { registry } = await NameRegistryState.retrieve(connection, account.pubkey);
          
          // If parentName is NOT ROOT_DOMAIN_ACCOUNT, this is a subdomain
          if (!registry.parentName.equals(ROOT_DOMAIN_ACCOUNT)) {
            console.log(`[SNS] Found subdomain account: ${account.pubkey.toBase58()}, parent: ${registry.parentName.toBase58()}`);
            
            try {
              // Get subdomain name using reverse lookup with parent
              const subdomainName = await reverseLookup(connection, account.pubkey, registry.parentName);
              
              // Get parent domain name
              const parentDomainName = await reverseLookup(connection, registry.parentName);
              
              console.log(`[SNS] Resolved subdomain: ${subdomainName}.${parentDomainName}`);
              
              subdomains.push({
                domain: subdomainName,
                pubkey: account.pubkey.toBase58(),
                parentDomain: parentDomainName,
                isSubdomain: true,
              });
            } catch (lookupErr) {
              console.log(`[SNS] Could not resolve name for subdomain ${account.pubkey.toBase58()}:`, lookupErr);
            }
          }
        } catch (deserializeErr) {
          // Skip accounts that can't be deserialized
          console.log(`[SNS] Could not deserialize account ${account.pubkey.toBase58()}:`, deserializeErr);
        }
      }
      
      console.log(`[SNS] Total subdomains found: ${subdomains.length}`);
      return subdomains;
    } catch (err) {
      console.error('[SNS] Error fetching all subdomains for owner:', err);
      throw err;
    }
  }
}

/**
 * Helper to create RPC from endpoint string or use existing RPC
 */
function getRpc(rpcOrEndpoint: SolanaRpc | string | null): SolanaRpc | null {
  if (!rpcOrEndpoint) return null;
  if (typeof rpcOrEndpoint === 'string') {
    return createSolanaRpc(rpcOrEndpoint);
  }
  return rpcOrEndpoint;
}

/**
 * Helper to get endpoint string from RPC (for query keys)
 */
function getRpcEndpoint(rpc: SolanaRpc | null): string | undefined {
  if (!rpc) return undefined;
  // Try to extract endpoint from RPC - this may vary by implementation
  // Type assertion needed as RPC implementation details are not exposed in types
  const rpcWithUrl = rpc as SolanaRpc & { url?: string; endpoint?: string };
  return rpcWithUrl.url || rpcWithUrl.endpoint || undefined;
}

/**
 * React hook to fetch domain records using SNSService
 * Fetches both V1 and V2 records automatically
 * Now accepts RPC or endpoint string
 */
export function useDomainRecord(
  rpcOrEndpoint: SolanaRpc | string | null,
  domain: string | null,
  recordType: typeof SnsRecord,
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled !== false && !!rpcOrEndpoint && !!domain;

  return useQuery({
    queryKey: ['sns-record', getRpcEndpoint(getRpc(rpcOrEndpoint)), domain, recordType],
    queryFn: async () => {
      const rpc = getRpc(rpcOrEndpoint);
      if (!rpc || !domain) {
        throw new Error('RPC and domain are required');
      }
      const service = new SNSService(rpc);
      return service.fetchDomainRecord(domain, recordType);
    },
    enabled,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}


/**
 * React hook to fetch all wrapped SNS domains owned by a wallet
 * @param rpcOrEndpoint The Solana RPC or endpoint string
 * @param ownerAddress The address of the wallet owner
 * @param options Optional query options
 */
export function useWrappedDomains(
  rpcOrEndpoint: SolanaRpc | string | null,
  ownerAddress: string | Address | null,
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled !== false && !!rpcOrEndpoint && !!ownerAddress;

  return useQuery({
    queryKey: ['wrapped-domains', getRpcEndpoint(getRpc(rpcOrEndpoint)), typeof ownerAddress === 'string' ? ownerAddress : ownerAddress],
    queryFn: async () => {
      const rpc = getRpc(rpcOrEndpoint);
      if (!rpc || !ownerAddress) {
        throw new Error('RPC and owner address are required');
      }
      try {
        const service = new SNSService(rpc);
        return await service.fetchWrappedDomains(ownerAddress);
      } catch (err) {
        // If fetching wrapped domains fails, return empty array instead of throwing
        // This allows unwrapped domains to still be displayed
        console.warn('Failed to fetch wrapped domains, continuing with unwrapped domains only:', err);
        return [];
      }
    },
    enabled,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

/**
 * React hook to fetch all unwrapped SNS domains owned by a wallet
 * Replaces useDomainsForOwner from @bonfida/sns-react
 * @param rpcOrEndpoint The Solana RPC or endpoint string
 * @param ownerAddress The address of the wallet owner
 * @param options Optional query options
 */
export function useDomainsForOwner(
  rpcOrEndpoint: SolanaRpc | string | null,
  ownerAddress: string | Address | null,
  options?: { enabled?: boolean }
) {
  // Handle options.enabled flag
  const enabled = typeof options === 'object' && options !== null && 'enabled' in options
    ? options.enabled !== false
    : true;

  return useQuery({
    queryKey: ['domains-for-owner', getRpcEndpoint(getRpc(rpcOrEndpoint)), typeof ownerAddress === 'string' ? ownerAddress : ownerAddress],
    queryFn: async () => {
      const rpc = getRpc(rpcOrEndpoint);
      if (!rpc || !ownerAddress) {
        throw new Error('RPC and owner address are required');
      }
      const service = new SNSService(rpc);
      return await service.fetchDomainsForOwner(ownerAddress);
    },
    enabled: enabled && !!rpcOrEndpoint && !!ownerAddress,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

/**
 * React hook to fetch all subdomains owned by a wallet (across all parent domains)
 * @param endpoint The Solana RPC endpoint string
 * @param ownerAddress The address of the wallet owner
 * @param options Optional query options
 */
export function useSubdomainsForOwner(
  endpoint: string | null,
  ownerAddress: string | Address | null,
  options?: { enabled?: boolean }
) {
  console.log('useSubdomainsForOwner', ownerAddress, options);
  const enabled = options?.enabled !== false && !!endpoint && !!ownerAddress;
  // Address type is a branded string, so we can use it directly as string
  const ownerStr = ownerAddress ? String(ownerAddress) : '';

  return useQuery({
    queryKey: ['subdomains-for-owner', endpoint, ownerStr],
    queryFn: async () => {
      if (!endpoint || !ownerAddress) {
        throw new Error('Endpoint and owner address are required');
      }
      const service = new SNSService(endpoint);
      return await service.fetchAllSubdomainsForOwner(ownerStr, endpoint);
    },
    enabled,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

/**
 * Token balance information
 */
export interface TokenBalanceInfo {
  mint: string;
  amount: string;
  decimals: number;
  uiAmount: number;
  symbol?: string;
  name?: string;
  logoUri?: string;
}

/**
 * Vault balance information
 */
export interface VaultBalanceInfo {
  vaultAddress: string;
  solBalance: number;
  tokens: TokenBalanceInfo[];
  /** Total number of ATAs (including zero balance) */
  ataCount: number;
}

// Vault program ID (as Address for @solana/kit)
const VAULT_PROGRAM_ID = address('LUMPd26Acz4wqS8EBuoxPN2zhwCUF4npbkrqhLbM9AL');

/**
 * Get the vault PDA for a user using @solana/kit
 */
async function getVaultPDAKit(ownerAddress: Address): Promise<Address> {
  const ownerBytes = bs58.decode(ownerAddress);
  
  const [pda] = await getProgramDerivedAddress({
    programAddress: VAULT_PROGRAM_ID,
    seeds: [
      Buffer.from('vault'),
      Buffer.from(ownerBytes),
    ],
  });

  return pda;
}

/**
 * React hook to fetch all token balances from the user's vault PDA
 * Uses @solana/kit for all RPC calls
 * @param endpoint The Solana RPC endpoint string
 * @param ownerAddress The address of the wallet owner
 * @param options Optional query options
 */
export function useVaultBalance(
  endpoint: string | null,
  ownerAddress: string | Address | null,
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled !== false && !!endpoint && !!ownerAddress;
  const ownerStr = ownerAddress ? String(ownerAddress) : '';

  return useQuery({
    queryKey: ['vault-balance', endpoint, ownerStr],
    queryFn: async (): Promise<VaultBalanceInfo | null> => {
      if (!endpoint || !ownerAddress) {
        throw new Error('Endpoint and owner address are required');
      }
      
      const rpc = createSolanaRpc(endpoint);
      const ownerAddr = address(ownerStr);
      const vaultPDA = await getVaultPDAKit(ownerAddr);
      
      console.log(`[useVaultBalance] Fetching balance for vault: ${vaultPDA}`);
      
      // Check if vault exists using @solana/kit
      const vaultInfo = await rpc.getAccountInfo(vaultPDA, { encoding: 'base64' }).send();
      if (!vaultInfo.value) {
        console.log(`[useVaultBalance] Vault does not exist`);
        return null;
      }
      
      // Get SOL balance of vault (lamports to SOL)
      const solBalance = Number(vaultInfo.value.lamports) / 1e9;
      console.log(`[useVaultBalance] Vault SOL balance: ${solBalance}`);
      
      // Get all token accounts owned by the vault PDA using @solana/kit
      const tokenAccountsResponse = await rpc.getTokenAccountsByOwner(
        vaultPDA, 
        { programId: TOKEN_PROGRAM_ID }, 
        { encoding: 'jsonParsed' }
      ).send();
      
      const tokenAccounts = (tokenAccountsResponse as unknown as { 
        value?: Array<{ 
          account: { 
            data: { 
              parsed?: { 
                info?: { 
                  mint?: string; 
                  tokenAmount?: { 
                    decimals?: number; 
                    amount?: string;
                    uiAmount?: number;
                  } 
                } 
              } 
            } 
          } 
        }> 
      }).value ?? [];
      
      console.log(`[useVaultBalance] Found ${tokenAccounts.length} token accounts`);
      
      const tokens: TokenBalanceInfo[] = [];
      let ataCount = tokenAccounts.length; // Count all ATAs including zero balance
      
      // Initialize token metadata map with our known tokens
      const tokenList: Map<string, { symbol?: string; name?: string; logoURI?: string }> = new Map([
        ['So11111111111111111111111111111111111111112', { symbol: 'WSOL', name: 'Wrapped SOL', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png' }],
        ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', { symbol: 'USDC', name: 'USD Coin', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' }],
        ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', { symbol: 'USDT', name: 'Tether USD', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg' }],
        ['6Q5t5upWJwDocysAwR2zertE2EPxB3X1ek1HRoj4LUM', { symbol: 'LUMEN', name: 'LUMEN', logoURI: 'https://ipfs.io/ipfs/QmVbBhRm2aSf1HAQWYkdUWeuxRFw9hooR1vQYFBjSWBkuF' }],
        ['USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB', { symbol: 'USD1', name: 'World Liberty Financial USD', logoURI: 'https://raw.githubusercontent.com/worldliberty/usd1-metadata/refs/heads/main/logo.png' }],
      ]);
      
      // Collect all mints that need Metaplex metadata lookup
      const unknownMints: string[] = [];
      for (const ta of tokenAccounts) {
        const info = ta?.account?.data?.parsed?.info;
        if (!info?.mint) continue;
        if (!tokenList.has(info.mint)) {
          unknownMints.push(info.mint);
        }
      }
      
      // Fetch Metaplex metadata for unknown tokens
      if (unknownMints.length > 0) {
        console.log(`[useVaultBalance] Fetching Metaplex metadata for ${unknownMints.length} tokens...`);
        const metaplexMetadata = await fetchTokenMetadataBatch(rpc, unknownMints, { fetchImages: true });
        
        // Add fetched metadata to tokenList
        for (const [mintStr, metadata] of metaplexMetadata) {
          tokenList.set(mintStr, {
            symbol: metadata.symbol,
            name: metadata.name,
            logoURI: metadata.image,
          });
        }
      }
      
      // Now process all token accounts with enriched metadata
      for (const ta of tokenAccounts) {
        const info = ta?.account?.data?.parsed?.info;
        if (!info) continue;
        
        const mint = info.mint;
        const tokenAmount = info.tokenAmount;
        
        if (!mint || !tokenAmount) continue;
        
        // Get metadata from token list (now includes Metaplex data)
        const metadata = tokenList.get(mint);
        
        // Include all tokens (even zero balance) so we can show which ATAs exist
        tokens.push({
          mint,
          amount: tokenAmount.amount || '0',
          decimals: tokenAmount.decimals || 0,
          uiAmount: tokenAmount.uiAmount || 0,
          symbol: metadata?.symbol,
          name: metadata?.name,
          logoUri: metadata?.logoURI,
        });
        
        console.log(`[useVaultBalance] Token: ${metadata?.symbol || mint.slice(0, 8)}... Amount: ${tokenAmount.uiAmount}`);
      }
      
      // Also check Token-2022 program
      try {
        const token2022Response = await rpc.getTokenAccountsByOwner(
          vaultPDA, 
          { programId: TOKEN_2022_PROGRAM_ID }, 
          { encoding: 'jsonParsed' }
        ).send();
        
        const token2022Accounts = (token2022Response as unknown as { 
          value?: Array<{ 
            account: { 
              data: { 
                parsed?: { 
                  info?: { 
                    mint?: string; 
                    tokenAmount?: { 
                      decimals?: number; 
                      amount?: string;
                      uiAmount?: number;
                    } 
                  } 
                } 
              } 
            } 
          }> 
        }).value ?? [];
        
        console.log(`[useVaultBalance] Found ${token2022Accounts.length} Token-2022 accounts`);
        ataCount += token2022Accounts.length;
        
        // Collect unknown Token-2022 mints for metadata lookup
        const unknownToken2022Mints: string[] = [];
        for (const ta of token2022Accounts) {
          const info = ta?.account?.data?.parsed?.info;
          if (!info?.mint) continue;
          if (!tokenList.has(info.mint)) {
            unknownToken2022Mints.push(info.mint);
          }
        }

        // Fetch Token-2022 metadata from mint's metadata extension (not Metaplex)
        if (unknownToken2022Mints.length > 0) {
          console.log(`[useVaultBalance] Fetching Token-2022 metadata extension for ${unknownToken2022Mints.length} tokens...`);
          const token2022Metadata = await fetchToken2022MetadataBatch(rpc, unknownToken2022Mints, { fetchImages: true });

          // Add fetched metadata to tokenList
          for (const [mintStr, metadata] of token2022Metadata) {
            tokenList.set(mintStr, {
              symbol: metadata.symbol,
              name: metadata.name,
              logoURI: metadata.image,
            });
          }
        }
        
        // Process Token-2022 accounts with enriched metadata
        for (const ta of token2022Accounts) {
          const info = ta?.account?.data?.parsed?.info;
          if (!info) continue;
          
          const mint = info.mint;
          const tokenAmount = info.tokenAmount;
          
          if (!mint || !tokenAmount) continue;
          
          const metadata = tokenList.get(mint);
          
          // Include all tokens (even zero balance)
          tokens.push({
            mint,
            amount: tokenAmount.amount || '0',
            decimals: tokenAmount.decimals || 0,
            uiAmount: tokenAmount.uiAmount || 0,
            symbol: metadata?.symbol,
            name: metadata?.name,
            logoUri: metadata?.logoURI,
          });
        }
      } catch {
        console.log('[useVaultBalance] Token-2022 query failed, continuing');
      }
      
      return {
        vaultAddress: vaultPDA,
        solBalance,
        tokens,
        ataCount,
      };
    },
    enabled,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

/**
 * React hook to fetch all secured (vaulted) SNS domains for a user
 * These are domains that have been deposited into the user's vault PDA
 * @param endpoint The Solana RPC endpoint string
 * @param ownerAddress The address of the wallet owner
 * @param options Optional query options
 */
export function useSecuredDomains(
  endpoint: string | null,
  ownerAddress: string | Address | null,
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled !== false && !!endpoint && !!ownerAddress;
  const ownerStr = ownerAddress ? String(ownerAddress) : '';

  return useQuery({
    queryKey: ['secured-domains', endpoint, ownerStr],
    queryFn: async () => {
      if (!endpoint || !ownerAddress) {
        throw new Error('Endpoint and owner address are required');
      }
      
      // Import vault service dynamically to avoid circular dependencies
      const { fetchVaultNFTMints, fetchVaultUnwrappedDomains } = await import('./vault-service');
      const { Connection, PublicKey } = await import('@solana/web3.js');
      const { reverseLookup } = await import('@bonfida/spl-name-service');
      
      const connection = new Connection(endpoint, 'confirmed');
      const ownerPubkey = new PublicKey(ownerStr);
      
      // Import getVaultPDA to log the vault address
      const { getVaultPDA } = await import('./vault-service');
      const [vaultPDA] = getVaultPDA(ownerPubkey);
      console.log(`[useSecuredDomains] 🔐 Your Vault PDA Address: ${vaultPDA.toBase58()}`);
      
      const securedDomains: Array<{ domain: string; pubkey: string; mintAddress?: string; isWrapped: boolean; isSubdomain: boolean; parentDomain?: string }> = [];
      
      // SOL TLD parent: 58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx
      const SOL_TLD_PARENT = '58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx';
      
      // ========== 1. Fetch wrapped (NFT) domains from vault ==========
      const nftMints = await fetchVaultNFTMints(connection, ownerPubkey);
      console.log(`[useSecuredDomains] Found ${nftMints.length} NFTs in vault`);
      
      if (nftMints.length > 0) {
        // Process mints in batches
        const batchSize = 100;
        const batches = chunk(nftMints, batchSize);
        
        for (const batch of batches) {
          // Get metadata PDAs for all mints in this batch
          const pairs = await Promise.all(
            batch.map(async (mintStr) => {
              const mint = address(mintStr);
              const mdPda = await findMetadataPda(mint);
              return { mint: mintStr, mdPda };
            })
          );
          
          // Fetch metadata accounts
          const rpc = getRpc(endpoint);
          if (!rpc) continue;
          
          const accounts = await rpc.getMultipleAccounts(
            pairs.map(p => p.mdPda), 
            { encoding: 'base64' }
          ).send();
          
          for (let i = 0; i < pairs.length; i++) {
            const acc = accounts?.value?.[i];
            const mintStr = pairs[i].mint;
            
            if (!acc) continue;
            
            const buf = decodeAccountDataToBuffer(acc.data);
            if (!buf) continue;
            
            try {
              const serializer = getMetadataAccountDataSerializer();
              const bytes = new Uint8Array(buf);
              const metadataData = serializer.deserialize(bytes)[0];
              const name = cleanStr(metadataData.name);
              
              const collection = metadataData.collection.__option === 'Some' 
                ? metadataData.collection.value 
                : undefined;
              
              // Check if it's from the SOL domain collection
              if (!collection || collection.key.toString() !== SOL_DOMAIN_COLLECTION_ADDRESS) {
                console.log(`[useSecuredDomains] Skipping NFT ${mintStr} - not from SOL domain collection`);
                continue;
              }
              
              console.log(`[useSecuredDomains] ✓ Found secured wrapped domain: ${name}.sol (mint: ${mintStr})`);
              securedDomains.push({
                domain: name,
                pubkey: mintStr,
                mintAddress: mintStr,
                isWrapped: true,
                isSubdomain: false, // Wrapped domains from collection are TLDs
              });
            } catch (err) {
              console.error(`[useSecuredDomains] Error parsing metadata for mint ${mintStr}:`, err);
              continue;
            }
          }
        }
      }
      
      // ========== 2. Fetch unwrapped domains/subdomains from vault ==========
      const unwrappedDomains = await fetchVaultUnwrappedDomains(connection, ownerPubkey);
      console.log(`[useSecuredDomains] Found ${unwrappedDomains.length} unwrapped name accounts in vault`);
      
      // Helper function to retry an async operation up to 3 times
      const retryAsync = async <T>(
        fn: () => Promise<T>,
        maxRetries: number = 3,
        delayMs: number = 1000
      ): Promise<T | null> => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            return await fn();
          } catch (err) {
            console.warn(`[useSecuredDomains] Attempt ${attempt}/${maxRetries} failed:`, err);
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
            }
          }
        }
        return null;
      };
      
      for (const { nameAccount, parentName } of unwrappedDomains) {
        try {
          const nameAccountPubkey = new PublicKey(nameAccount);
          
          // Check if it's a subdomain (parent is not SOL TLD and not default)
          const isSubdomain = parentName !== SOL_TLD_PARENT && parentName !== PublicKey.default.toBase58();
          
          let domainName: string | null = null;
          let parentDomainName: string | undefined;
          
          if (isSubdomain) {
            // For subdomains:
            // 1. First check localStorage cache (fastest)
            // 2. Get the parent domain name via reverse lookup
            // 3. Try to derive the subdomain name from the cache or known subdomains
            
            // Check cache first
            const cachedName = typeof window !== 'undefined' 
              ? localStorage.getItem(`secured-domain-${nameAccount}`) 
              : null;
              
            if (cachedName) {
              domainName = cachedName;
              // Still need parent domain name for display
              const parentPubkey = new PublicKey(parentName);
              parentDomainName = await retryAsync(() => reverseLookup(connection, parentPubkey)) ?? undefined;
              console.log(`[useSecuredDomains] Found cached subdomain name: ${domainName}.${parentDomainName || 'unknown'}.sol`);
            } else {
              // Try to resolve parent domain name with retries
              const parentPubkey = new PublicKey(parentName);
              parentDomainName = await retryAsync(() => reverseLookup(connection, parentPubkey)) ?? undefined;
              
              if (!parentDomainName) {
                console.warn(`[useSecuredDomains] Could not resolve parent domain for subdomain ${nameAccount} after 3 retries - skipping`);
                continue;
              }
              
              console.log(`[useSecuredDomains] Parent domain resolved: ${parentDomainName}.sol`);
              
              // Try findSubdomains with retries (this can fail due to rate limiting)
              const { findSubdomains: findSubdomainsForParent } = await import('@bonfida/spl-name-service');
              const freshConnection = new Connection(endpoint, { commitment: 'confirmed', disableRetryOnRateLimit: false });
              
              const subdomainsOfParent = await retryAsync(
                () => findSubdomainsForParent(freshConnection, parentPubkey),
                3,
                1000 // Longer delay for rate-limited endpoints
              );
              
              if (subdomainsOfParent) {
                console.log(`[useSecuredDomains] findSubdomains returned ${subdomainsOfParent.length} subdomains`);
                
                // Look for our subdomain account in the list
                for (const subName of subdomainsOfParent) {
                  const { pubkey: derivedKey } = getDomainKeySync(`${subName}.${parentDomainName}`);
                  if (derivedKey.toBase58() === nameAccount) {
                    domainName = subName;
                    console.log(`[useSecuredDomains] ✓ Matched subdomain name: ${domainName}`);
                    break;
                  }
                }
              }
              
              // If still not found, skip this domain
              if (!domainName) {
                console.warn(`[useSecuredDomains] Could not resolve subdomain name for ${nameAccount} after 3 retries - skipping`);
                continue;
              }
            }
          } else {
            // Regular domain - reverse lookup with retries
            domainName = await retryAsync(() => reverseLookup(connection, nameAccountPubkey));
            
            if (!domainName) {
              console.warn(`[useSecuredDomains] Could not resolve domain name for ${nameAccount} after 3 retries - skipping`);
              continue;
            }
            
            console.log(`[useSecuredDomains] ✓ Found secured domain: ${domainName}.sol (nameAccount: ${nameAccount})`);
          }
          
          // Only add if we successfully resolved the domain name
          if (domainName) {
            securedDomains.push({
              domain: domainName,
              pubkey: nameAccount,
              isWrapped: false,
              isSubdomain,
              parentDomain: parentDomainName,
            });
          }
        } catch (err) {
          console.error(`[useSecuredDomains] Error processing name account ${nameAccount}:`, err);
          // Skip domains we can't process
          continue;
        }
      }
      
      console.log(`[useSecuredDomains] ✓ Found ${securedDomains.length} total secured SNS domains/subdomains`);
      return securedDomains;
    },
    enabled,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

