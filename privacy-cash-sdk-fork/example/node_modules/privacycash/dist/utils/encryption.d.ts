import { Keypair } from '@solana/web3.js';
import { Utxo } from '../models/utxo.js';
/**
 * Represents a UTXO with minimal required fields
 */
export interface UtxoData {
    amount: string;
    blinding: string;
    index: number | string;
    [key: string]: any;
}
export interface EncryptionKey {
    v1: Uint8Array;
    v2: Uint8Array;
}
/**
 * Service for handling encryption and decryption of UTXO data
 */
export declare class EncryptionService {
    static readonly ENCRYPTION_VERSION_V2: Buffer<ArrayBuffer>;
    private encryptionKeyV1;
    private encryptionKeyV2;
    private utxoPrivateKeyV1;
    private utxoPrivateKeyV2;
    /**
   * Generate an encryption key from a signature
   * @param signature The user's signature
   * @returns The generated encryption key
   */
    deriveEncryptionKeyFromSignature(signature: Uint8Array): EncryptionKey;
    /**
     * Generate an encryption key from a wallet keypair (V2 format)
     * @param keypair The Solana keypair to derive the encryption key from
     * @returns The generated encryption key
     */
    deriveEncryptionKeyFromWallet(keypair: Keypair): EncryptionKey;
    /**
     * Encrypt data with the stored encryption key
     * @param data The data to encrypt
     * @returns The encrypted data as a Buffer
     * @throws Error if the encryption key has not been generated
     */
    encrypt(data: Buffer | string): Buffer;
    encryptDecryptedDoNotUse(data: Buffer | string): Buffer;
    /**
     * Decrypt data with the stored encryption key
     * @param encryptedData The encrypted data to decrypt
     * @returns The decrypted data as a Buffer
     * @throws Error if the encryption key has not been generated or if the wrong key is used
     */
    decrypt(encryptedData: Buffer): Buffer;
    /**
     * Decrypt data using the old V1 format (120-bit HMAC with SHA256)
     * @param encryptedData The encrypted data to decrypt
     * @param keypair Optional keypair to derive V1 key for backward compatibility
     * @returns The decrypted data as a Buffer
     */
    private decryptV1;
    private timingSafeEqual;
    /**
     * Decrypt data using the new V2 format (256-bit Keccak HMAC)
     * @param encryptedData The encrypted data to decrypt
     * @returns The decrypted data as a Buffer
     */
    private decryptV2;
    /**
     * Reset the encryption keys (mainly for testing purposes)
     */
    resetEncryptionKey(): void;
    /**
     * Encrypt a UTXO using a compact pipe-delimited format
     * Always uses V2 encryption format. The UTXO's version property is used only for key derivation.
     * @param utxo The UTXO to encrypt (includes version property)
     * @returns The encrypted UTXO data as a Buffer
     * @throws Error if the V2 encryption key has not been set
     */
    encryptUtxo(utxo: Utxo): Buffer;
    encryptUtxoDecryptedDoNotUse(utxo: Utxo): Buffer;
    getEncryptionKeyVersion(encryptedData: Buffer | string): 'v1' | 'v2';
    /**
     * Decrypt an encrypted UTXO and parse it to a Utxo instance
     * Automatically detects the UTXO version based on the encryption format
     * @param encryptedData The encrypted UTXO data
     * @param keypair The UTXO keypair to use for the decrypted UTXO
     * @param lightWasm Optional LightWasm instance. If not provided, a new one will be created
     * @param walletKeypair Optional wallet keypair for V1 backward compatibility
     * @returns Promise resolving to the decrypted Utxo instance
     * @throws Error if the encryption key has not been set or if decryption fails
     */
    decryptUtxo(encryptedData: Buffer | string, lightWasm?: any): Promise<Utxo>;
    getUtxoPrivateKeyWithVersion(version: 'v1' | 'v2'): string;
    deriveUtxoPrivateKey(encryptedData?: Buffer | string): string;
    hasUtxoPrivateKeyWithVersion(version: 'v1' | 'v2'): boolean;
    /**
     * Get the cached V1 UTXO private key
     * @returns A private key in hex format that can be used to create a UTXO keypair
     * @throws Error if V1 encryption key has not been set
     */
    getUtxoPrivateKeyV1(): string;
    /**
     * Get the cached V2 UTXO private key
     * @returns A private key in hex format that can be used to create a UTXO keypair
     * @throws Error if V2 encryption key has not been set
     */
    getUtxoPrivateKeyV2(): string;
}
export declare function serializeProofAndExtData(proof: any, extData: any, isSpl?: boolean): Buffer<ArrayBuffer>;
