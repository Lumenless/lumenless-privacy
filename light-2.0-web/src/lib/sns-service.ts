import { Connection, PublicKey } from '@solana/web3.js';
import { Record, NameRegistryState } from '@bonfida/spl-name-service';
import { getRecordV2, getRecord } from '@bonfida/spl-name-service';
import { useQuery } from '@tanstack/react-query';
import type { Record as SnsRecord } from '@bonfida/sns-records';

/**
 * V2 record result structure (matches SingleRecordResult from getRecordV2)
 */
interface SingleRecordResult {
  retrievedRecord: SnsRecord;
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
  v1Data: NameRegistryState | null;
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
 */
export class SNSService {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Fetches a domain record, trying both V1 and V2 formats
   * @param domain The domain name (without .sol suffix)
   * @param recordType The record type to fetch (e.g., Record.SOL)
   * @returns Promise with the combined result
   */
  async fetchDomainRecord(
    domain: string,
    recordType: Record
  ): Promise<DomainRecordResult> {
    let v2Data: SingleRecordResult | null = null;
    let v1Data: NameRegistryState | null = null;
    let v2Error: Error | null = null;
    let v1Error: Error | null = null;

    // Try V2 first (newer format) - deserialize it
    try {
      v2Data = await getRecordV2(this.connection, domain, recordType, { deserialize: true });
    } catch (err) {
      v2Error = err instanceof Error ? err : new Error(String(err));
    }

    // Try V1 as fallback (older format) - don't deserialize, we'll extract manually
    try {
      const v1Result = await getRecord(this.connection, domain, recordType, false);
      v1Data = v1Result || null;
    } catch (err) {
      v1Error = err instanceof Error ? err : new Error(String(err));
    }

    // Extract address from V2 or V1
    const address = this.extractAddress(v2Data, v1Data);
    
    // Determine source first
    let source: 'v1' | 'v2' | null = null;
    if (address) {
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
      address,
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
  private extractAddress(v2Data: SingleRecordResult | null, v1Data: NameRegistryState | null): string | null {
    // Try V2 first
    const v2Address = this.extractAddressFromV2(v2Data);
    if (v2Address) {
      return v2Address;
    }

    // Fallback to V1
    if (v1Data?.data) {
      try {
        // V1 records store the PublicKey as bytes in the data field
        const pubkeyBytes = v1Data.data.slice(0, 32);
        const pubkey = new PublicKey(pubkeyBytes);
        return pubkey.toBase58();
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
      // Note: retrievedRecord is an SnsRecord, which has getContent() method
      if (v2Data.retrievedRecord) {
        // Try to get content from the retrievedRecord
        try {
          const content = v2Data.retrievedRecord.getContent();
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
      const header = v2Data.retrievedRecord?.header || null;

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
        header.rightOfAssociationValidation === 1; // Validation.Solana
      
      const hasStalenessValidation = 
        header.stalenessValidation === 1; // Validation.Solana

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
    recordTypes: Record[]
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
}

/**
 * React hook to fetch domain records using SNSService
 * Fetches both V1 and V2 records automatically
 */
export function useDomainRecord(
  connection: Connection | null,
  domain: string | null,
  recordType: Record,
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled !== false && !!connection && !!domain;

  return useQuery({
    queryKey: ['sns-record', connection?.rpcEndpoint, domain, recordType],
    queryFn: async () => {
      if (!connection || !domain) {
        throw new Error('Connection and domain are required');
      }
      const service = new SNSService(connection);
      return service.fetchDomainRecord(domain, recordType);
    },
    enabled,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

