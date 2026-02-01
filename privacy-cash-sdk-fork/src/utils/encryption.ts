import { Keypair, PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import * as crypto from 'crypto';
import { Utxo } from '../models/utxo.js';
import { WasmFactory } from '@lightprotocol/hasher.rs';
import { Keypair as UtxoKeypair } from '../models/keypair.js';
import { keccak256 } from '@ethersproject/keccak256';
import { PROGRAM_ID, TRANSACT_IX_DISCRIMINATOR, TRANSACT_SPL_IX_DISCRIMINATOR } from './constants.js';
import BN from 'bn.js';

/**
 * Keypair for asymmetric encryption (used in pay links)
 * The public key can be safely shared; only the private key can decrypt
 */
export interface BoxKeypair {
  publicKey: Uint8Array;  // 32 bytes - safe to share
  secretKey: Uint8Array;  // 32 bytes - keep secret!
}


/**
 * Represents a UTXO with minimal required fields
 */
export interface UtxoData {
  amount: string;
  blinding: string;
  index: number | string;
  // Optional additional fields
  [key: string]: any;
}

export interface EncryptionKey {
  v1: Uint8Array;
  v2: Uint8Array;
}

/**
 * Service for handling encryption and decryption of UTXO data
 */
export class EncryptionService {// Version identifier for encryption scheme (8-byte version)
  public static readonly ENCRYPTION_VERSION_V2 = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02]); // Version 2

  private encryptionKeyV1: Uint8Array | null = null;
  private encryptionKeyV2: Uint8Array | null = null;
  private utxoPrivateKeyV1: string | null = null;
  private utxoPrivateKeyV2: string | null = null;

  /**
 * Generate an encryption key from a signature
 * @param signature The user's signature
 * @returns The generated encryption key
 */
  public deriveEncryptionKeyFromSignature(signature: Uint8Array): EncryptionKey {
    // Extract the first 31 bytes of the signature to create a deterministic key (legacy method)
    const encryptionKeyV1 = signature.slice(0, 31);

    // Store the V1 key in the service
    this.encryptionKeyV1 = encryptionKeyV1;

    // Precompute and cache the UTXO private key
    const hashedSeedV1 = crypto.createHash('sha256').update(encryptionKeyV1).digest();
    this.utxoPrivateKeyV1 = '0x' + hashedSeedV1.toString('hex');

    // Use Keccak256 to derive a full 32-byte encryption key from the signature
    const encryptionKeyV2 = Buffer.from(keccak256(signature).slice(2), 'hex');

    // Store the V2 key in the service
    this.encryptionKeyV2 = encryptionKeyV2;

    // Precompute and cache the UTXO private key
    const hashedSeedV2 = Buffer.from(keccak256(encryptionKeyV2).slice(2), 'hex');
    this.utxoPrivateKeyV2 = '0x' + hashedSeedV2.toString('hex');

    return {
      v1: this.encryptionKeyV1,
      v2: this.encryptionKeyV2
    };

  }

  /**
   * Generate an encryption key from a wallet keypair (V2 format)
   * @param keypair The Solana keypair to derive the encryption key from
   * @returns The generated encryption key
   */
  public deriveEncryptionKeyFromWallet(keypair: Keypair): EncryptionKey {
    // Sign a constant message with the keypair
    const message = Buffer.from('Privacy Money account sign in');
    const signature = nacl.sign.detached(message, keypair.secretKey);
    return this.deriveEncryptionKeyFromSignature(signature)
  }

  /**
   * Encrypt data with the stored encryption key
   * @param data The data to encrypt
   * @returns The encrypted data as a Buffer
   * @throws Error if the encryption key has not been generated
   */
  public encrypt(data: Buffer | string): Buffer {
    if (!this.encryptionKeyV2) {
      throw new Error('Encryption key not set. Call setEncryptionKey or deriveEncryptionKeyFromWallet first.');
    }

    // Convert string to Buffer if needed
    const dataBuffer = typeof data === 'string' ? Buffer.from(data) : data;

    // Generate a standard initialization vector (12 bytes for GCM)
    const iv = crypto.randomBytes(12);

    // Use the full 32-byte V2 encryption key for AES-256
    const key = Buffer.from(this.encryptionKeyV2);

    // Use AES-256-GCM for authenticated encryption
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encryptedData = Buffer.concat([
      cipher.update(dataBuffer),
      cipher.final()
    ]);

    // Get the authentication tag from GCM (16 bytes)
    const authTag = cipher.getAuthTag();

    // Version 2 format: [version(8)] + [IV(12)] + [authTag(16)] + [encryptedData]
    return Buffer.concat([
      EncryptionService.ENCRYPTION_VERSION_V2,
      iv,
      authTag,
      encryptedData
    ]);
  }

  // v1 encryption, only used for testing now
  public encryptDecryptedDoNotUse(data: Buffer | string): Buffer {
    if (!this.encryptionKeyV1) {
      throw new Error('Encryption key not set. Call setEncryptionKey or deriveEncryptionKeyFromWallet first.');
    }

    // Convert string to Buffer if needed
    const dataBuffer = typeof data === 'string' ? Buffer.from(data) : data;

    // Generate a standard initialization vector (16 bytes)
    const iv = crypto.randomBytes(16);

    // Create a key from our encryption key (using only first 16 bytes for AES-128)
    const key = Buffer.from(this.encryptionKeyV1).slice(0, 16);

    // Use a more compact encryption algorithm (aes-128-ctr)
    const cipher = crypto.createCipheriv('aes-128-ctr', key, iv);
    const encryptedData = Buffer.concat([
      cipher.update(dataBuffer),
      cipher.final()
    ]);

    // Create an authentication tag (HMAC) to verify decryption with correct key
    const hmacKey = Buffer.from(this.encryptionKeyV1).slice(16, 31);
    const hmac = crypto.createHmac('sha256', hmacKey);
    hmac.update(iv);
    hmac.update(encryptedData);
    const authTag = hmac.digest().slice(0, 16); // Use first 16 bytes of HMAC as auth tag

    // Combine IV, auth tag and encrypted data
    return Buffer.concat([iv, authTag, encryptedData]);
  }

  /**
   * Decrypt data with the stored encryption key
   * @param encryptedData The encrypted data to decrypt
   * @returns The decrypted data as a Buffer
   * @throws Error if the encryption key has not been generated or if the wrong key is used
   */
  public decrypt(encryptedData: Buffer): Buffer {
    // Check if this is the new version format (starts with 8-byte version identifier)
    if (encryptedData.length >= 8 && encryptedData.subarray(0, 8).equals(EncryptionService.ENCRYPTION_VERSION_V2)) {
      if (!this.encryptionKeyV2) {
        throw new Error('Encryption key not set. Call setEncryptionKey or deriveEncryptionKeyFromWallet first.');
      }
      return this.decryptV2(encryptedData);
    } else {
      // V1 format - need V1 key or keypair to derive it
      if (!this.encryptionKeyV1) {
        throw new Error('Encryption key not set. Call setEncryptionKey or deriveEncryptionKeyFromWallet first.');
      }
      return this.decryptV1(encryptedData);
    }
  }

  /**
   * Decrypt data using the old V1 format (120-bit HMAC with SHA256)
   * @param encryptedData The encrypted data to decrypt
   * @param keypair Optional keypair to derive V1 key for backward compatibility
   * @returns The decrypted data as a Buffer
   */
  private decryptV1(encryptedData: Buffer): Buffer {
    if (!this.encryptionKeyV1) {
      throw new Error('Encryption key not set. Call setEncryptionKey or deriveEncryptionKeyFromWallet first.');
    }

    // Extract the IV from the first 16 bytes
    const iv = encryptedData.slice(0, 16);
    // Extract the auth tag from the next 16 bytes
    const authTag = encryptedData.slice(16, 32);
    // The rest is the actual encrypted data
    const data = encryptedData.slice(32);

    // Verify the authentication tag
    const hmacKey = Buffer.from(this.encryptionKeyV1).slice(16, 31);
    const hmac = crypto.createHmac('sha256', hmacKey);
    hmac.update(iv);
    hmac.update(data);
    const calculatedTag = hmac.digest().slice(0, 16);

    // Compare tags - if they don't match, the key is wrong
    if (!this.timingSafeEqual(authTag, calculatedTag)) {
      throw new Error('Failed to decrypt data. Invalid encryption key or corrupted data.');
    }

    // Create a key from our encryption key (using only first 16 bytes for AES-128)
    const key = Buffer.from(this.encryptionKeyV1).slice(0, 16);

    // Use the same algorithm as in encrypt
    const decipher = crypto.createDecipheriv('aes-128-ctr', key, iv);

    try {
      return Buffer.concat([
        decipher.update(data),
        decipher.final()
      ]);
    } catch (error) {
      throw new Error('Failed to decrypt data. Invalid encryption key or corrupted data.');
    }
  }
  
  // Custom timingSafeEqual for browser compatibility
  private timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
      return false;
    }
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a[i] ^ b[i];
    }
    return diff === 0;
  }

  /**
   * Decrypt data using the new V2 format (256-bit Keccak HMAC)
   * @param encryptedData The encrypted data to decrypt
   * @returns The decrypted data as a Buffer
   */
  private decryptV2(encryptedData: Buffer): Buffer {
    if (!this.encryptionKeyV2) {
      throw new Error('encryptionKeyV2 not set. Call setEncryptionKey or deriveEncryptionKeyFromWallet first.');
    }

    // Skip 8-byte version identifier and extract components for GCM format
    const iv = encryptedData.slice(8, 20);           // bytes 8-19 (12 bytes for GCM)
    const authTag = encryptedData.slice(20, 36);     // bytes 20-35 (16 bytes for GCM)
    const data = encryptedData.slice(36);            // remaining bytes

    // Use the full 32-byte V2 encryption key for AES-256
    const key = Buffer.from(this.encryptionKeyV2!);

    // Use AES-256-GCM for authenticated decryption
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    try {
      return Buffer.concat([
        decipher.update(data),
        decipher.final()
      ]);
    } catch (error) {
      throw new Error('Failed to decrypt data. Invalid encryption key or corrupted data.');
    }
  }

  /**
   * Reset the encryption keys (mainly for testing purposes)
   */
  public resetEncryptionKey(): void {
    this.encryptionKeyV1 = null;
    this.encryptionKeyV2 = null;
    this.utxoPrivateKeyV1 = null;
    this.utxoPrivateKeyV2 = null;
  }

  /**
   * Encrypt a UTXO using a compact pipe-delimited format
   * Always uses V2 encryption format. The UTXO's version property is used only for key derivation.
   * @param utxo The UTXO to encrypt (includes version property)
   * @returns The encrypted UTXO data as a Buffer
   * @throws Error if the V2 encryption key has not been set
   */
  public encryptUtxo(utxo: Utxo): Buffer {
    if (!this.encryptionKeyV2) {
      throw new Error('Encryption key not set. Call setEncryptionKey or deriveEncryptionKeyFromWallet first.');
    }

    // Create a compact string representation using pipe delimiter
    // Version is stored in the UTXO model, not in the encrypted content
    const utxoString = `${utxo.amount.toString()}|${utxo.blinding.toString()}|${utxo.index}|${utxo.mintAddress}`;

    // Always use V2 encryption format (which adds version byte 0x02 at the beginning)
    return this.encrypt(utxoString);
  }

  /**
   * Generate a new asymmetric encryption keypair for pay links.
   * The public key can be safely shared in pay link URLs.
   * The secret key must be kept private and is used to decrypt incoming payments.
   * 
   * @returns A nacl.box keypair with publicKey (shareable) and secretKey (private)
   */
  public static generateBoxKeypair(): BoxKeypair {
    return nacl.box.keyPair();
  }

  /**
   * Derive a deterministic box keypair from the wallet's encryption key.
   * This ensures the same keypair is generated each time for the same wallet.
   * 
   * @returns A nacl.box keypair derived from the wallet
   */
  public deriveBoxKeypair(): BoxKeypair {
    if (!this.encryptionKeyV2) {
      throw new Error('Encryption key not set. Call deriveEncryptionKeyFromWallet first.');
    }
    // Use keccak256 of encryption key + "box" suffix as seed for box keypair
    // This is deterministic but separate from the UTXO private key derivation
    // Concatenate the key bytes with "box" bytes before hashing
    const dataToHash = Buffer.concat([Buffer.from(this.encryptionKeyV2), Buffer.from('box')]);
    const seed = Buffer.from(keccak256(dataToHash).slice(2), 'hex');
    return nacl.box.keyPair.fromSecretKey(seed);
  }

  /**
   * Get the public key for pay links (safe to share).
   * This is the PUBLIC part of the asymmetric encryption keypair.
   * 
   * @returns The 32-byte public key as hex string (safe to put in URLs)
   */
  public getPayLinkPublicKey(): string {
    const boxKeypair = this.deriveBoxKeypair();
    return Buffer.from(boxKeypair.publicKey).toString('hex');
  }

  /**
   * Encrypt a UTXO for a recipient using asymmetric encryption (nacl.box).
   * This is safe because it uses the recipient's PUBLIC key.
   * Only the recipient with the corresponding SECRET key can decrypt.
   * 
   * @param utxo The UTXO to encrypt
   * @param recipientPublicKey The recipient's box PUBLIC key (32 bytes) - safe to share!
   * @returns The encrypted UTXO data as a Buffer
   */
  public encryptUtxoForRecipient(utxo: Utxo, recipientPublicKey: Uint8Array | Buffer): Buffer {
    if (recipientPublicKey.length !== 32) {
      throw new Error('Recipient public key must be 32 bytes');
    }

    // Create a compact string representation
    const utxoString = `${utxo.amount.toString()}|${utxo.blinding.toString()}|${utxo.index}|${utxo.mintAddress}`;
    const message = Buffer.from(utxoString);

    // Generate ephemeral keypair for this encryption
    const ephemeralKeypair = nacl.box.keyPair();
    
    // Generate nonce
    const nonce = nacl.randomBytes(nacl.box.nonceLength);

    // Encrypt using nacl.box (asymmetric encryption)
    const encrypted = nacl.box(
      message,
      nonce,
      Uint8Array.from(recipientPublicKey),
      ephemeralKeypair.secretKey
    );

    if (!encrypted) {
      throw new Error('Encryption failed');
    }

    // Format: [version(8)] + [ephemeralPubkey(32)] + [nonce(24)] + [encryptedData]
    // Version 0x03 indicates asymmetric box encryption
    const VERSION_BOX = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03]);
    
    return Buffer.concat([
      VERSION_BOX,
      Buffer.from(ephemeralKeypair.publicKey),
      Buffer.from(nonce),
      Buffer.from(encrypted)
    ]);
  }

  /**
   * Decrypt a UTXO that was encrypted with asymmetric encryption (nacl.box).
   * Uses the wallet's derived box secret key.
   * 
   * @param encryptedData The encrypted UTXO data
   * @returns The decrypted UTXO string
   */
  public decryptBoxUtxo(encryptedData: Buffer | Uint8Array): string {
    const boxKeypair = this.deriveBoxKeypair();
    
    // Parse the encrypted data
    // Format: [version(8)] + [ephemeralPubkey(32)] + [nonce(24)] + [encryptedData]
    const ephemeralPubkey = encryptedData.slice(8, 40);
    const nonce = encryptedData.slice(40, 64);
    const ciphertext = encryptedData.slice(64);

    // Decrypt using nacl.box.open
    const decrypted = nacl.box.open(
      Uint8Array.from(ciphertext),
      Uint8Array.from(nonce),
      Uint8Array.from(ephemeralPubkey),
      boxKeypair.secretKey
    );

    if (!decrypted) {
      throw new Error('Decryption failed - invalid key or corrupted data');
    }

    return Buffer.from(decrypted).toString();
  }

  /**
   * Check if encrypted data uses box (asymmetric) encryption
   */
  public static isBoxEncrypted(encryptedData: Buffer | Uint8Array): boolean {
    if (encryptedData.length < 8) return false;
    // Version 0x03 indicates box encryption
    return encryptedData[7] === 0x03;
  }

  /**
   * Encrypt data with an external symmetric encryption key (V2 format)
   * WARNING: Only use this with keys that are safe to share (not derived from wallet secrets)
   * 
   * @param data The data to encrypt
   * @param encryptionKey The 32-byte encryption key to use
   * @returns The encrypted data as a Buffer
   */
  public encryptWithKey(data: Buffer | string, encryptionKey: Uint8Array | Buffer): Buffer {
    // Convert string to Buffer if needed
    const dataBuffer = typeof data === 'string' ? Buffer.from(data) : data;
    const keyBuffer = Buffer.from(encryptionKey);

    // Generate a standard initialization vector (12 bytes for GCM)
    const iv = crypto.randomBytes(12);

    // Use AES-256-GCM for authenticated encryption
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
    const encryptedData = Buffer.concat([
      cipher.update(dataBuffer),
      cipher.final()
    ]);

    // Get the authentication tag from GCM (16 bytes)
    const authTag = cipher.getAuthTag();

    // Version 2 format: [version(8)] + [IV(12)] + [authTag(16)] + [encryptedData]
    return Buffer.concat([
      EncryptionService.ENCRYPTION_VERSION_V2,
      iv,
      authTag,
      encryptedData
    ]);
  }

  /**
   * @deprecated Use getPayLinkPublicKey() instead - this returns the secret encryption key which is NOT safe to share!
   * Get the V2 encryption key
   * @returns The 32-byte V2 encryption key as Uint8Array
   */
  public getEncryptionKeyV2(): Uint8Array {
    if (!this.encryptionKeyV2) {
      throw new Error('Encryption key not set. Call setEncryptionKey or deriveEncryptionKeyFromWallet first.');
    }
    return this.encryptionKeyV2;
  }

  // Deprecated, only used for testing now
  public encryptUtxoDecryptedDoNotUse(utxo: Utxo): Buffer {
    if (!this.encryptionKeyV2) {
      throw new Error('Encryption key not set. Call setEncryptionKey or deriveEncryptionKeyFromWallet first.');
    }

    const utxoString = `${utxo.amount.toString()}|${utxo.blinding.toString()}|${utxo.index}|${utxo.mintAddress}`;

    return this.encryptDecryptedDoNotUse(utxoString);
  }

  public getEncryptionKeyVersion(encryptedData: Buffer | string): 'v1' | 'v2' {
    const buffer = typeof encryptedData === 'string' ? Buffer.from(encryptedData, 'hex') : encryptedData;

    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(EncryptionService.ENCRYPTION_VERSION_V2)) {
      // V2 encryption format → V2 UTXO
      return 'v2';
    } else {
      // V1 encryption format → UTXO
      return 'v1';
    }
  }

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
  public async decryptUtxo(
    encryptedData: Buffer | string,
    lightWasm?: any
  ): Promise<Utxo> {
    // Convert hex string to Buffer if needed
    const encryptedBuffer = typeof encryptedData === 'string'
      ? Buffer.from(encryptedData, 'hex')
      : encryptedData;

    let decryptedStr: string;
    let utxoVersion: 'v1' | 'v2';

    // Check if this is box-encrypted (asymmetric encryption from pay links)
    if (EncryptionService.isBoxEncrypted(encryptedBuffer)) {
      // Use asymmetric decryption for box-encrypted UTXOs
      decryptedStr = this.decryptBoxUtxo(encryptedBuffer);
      utxoVersion = 'v2'; // Box encryption always uses V2
    } else {
      // Use standard symmetric decryption
      // Detect UTXO version based on encryption format
      utxoVersion = this.getEncryptionKeyVersion(encryptedBuffer);

      // The decrypt() method already handles encryption format version detection (V1 vs V2)
      // It checks the first byte to determine whether to use decryptV1() or decryptV2()
      const decrypted = this.decrypt(encryptedBuffer);
      decryptedStr = decrypted.toString();
    }

    // Parse the pipe-delimited format: amount|blinding|index|mintAddress
    const parts = decryptedStr.split('|');

    if (parts.length !== 4) {
      throw new Error('Invalid UTXO format after decryption');
    }

    const [amount, blinding, index, mintAddress] = parts;

    if (!amount || !blinding || index === undefined || mintAddress === undefined) {
      throw new Error('Invalid UTXO format after decryption');
    }

    // Get or create a LightWasm instance
    const wasmInstance = lightWasm || await WasmFactory.getInstance();

    const privateKey = this.getUtxoPrivateKeyWithVersion(utxoVersion);

    // Create a Utxo instance with the detected version
    const utxo = new Utxo({
      lightWasm: wasmInstance,
      amount: amount,
      blinding: blinding,
      keypair: new UtxoKeypair(privateKey, wasmInstance),
      index: Number(index),
      mintAddress: mintAddress,
      version: utxoVersion
    });

    return utxo;
  }

  public getUtxoPrivateKeyWithVersion(version: 'v1' | 'v2'): string {
    if (version === 'v1') {
      return this.getUtxoPrivateKeyV1();
    }

    return this.getUtxoPrivateKeyV2();
  }

  public deriveUtxoPrivateKey(encryptedData?: Buffer | string): string {
    if (encryptedData && this.getEncryptionKeyVersion(encryptedData) === 'v2') {
      return this.getUtxoPrivateKeyWithVersion('v2');
    }

    return this.getUtxoPrivateKeyWithVersion('v1');
  }

  public hasUtxoPrivateKeyWithVersion(version: 'v1' | 'v2'): boolean {
    if (version === 'v1') {
      return !!this.utxoPrivateKeyV1;
    }

    return !!this.utxoPrivateKeyV2;
  }

  /**
   * Get the cached V1 UTXO private key
   * @returns A private key in hex format that can be used to create a UTXO keypair
   * @throws Error if V1 encryption key has not been set
   */
  public getUtxoPrivateKeyV1(): string {
    if (!this.utxoPrivateKeyV1) {
      throw new Error('Encryption key not set. Call setEncryptionKey or deriveEncryptionKeyFromWallet first.');
    }
    return this.utxoPrivateKeyV1;
  }

  /**
   * Get the cached V2 UTXO private key
   * @returns A private key in hex format that can be used to create a UTXO keypair
   * @throws Error if V2 encryption key has not been set
   */
  public getUtxoPrivateKeyV2(): string {
    if (!this.utxoPrivateKeyV2) {
      throw new Error('Encryption key not set. Call setEncryptionKey or deriveEncryptionKeyFromWallet first.');
    }
    return this.utxoPrivateKeyV2;
  }
}

export function serializeProofAndExtData(proof: any, extData: any, isSpl: boolean = false) {
  // Create the ExtDataMinified object for the program call (only extAmount and fee)
  const extDataMinified = {
    extAmount: extData.extAmount,
    fee: extData.fee
  };

  // Use the appropriate discriminator based on whether this is SPL or native SOL
  const discriminator = isSpl ? TRANSACT_SPL_IX_DISCRIMINATOR : TRANSACT_IX_DISCRIMINATOR;

  // Use the same serialization approach as deposit script
  const instructionData = Buffer.concat([
    discriminator,
    // Serialize proof
    Buffer.from(proof.proofA),
    Buffer.from(proof.proofB),
    Buffer.from(proof.proofC),
    Buffer.from(proof.root),
    Buffer.from(proof.publicAmount),
    Buffer.from(proof.extDataHash),
    Buffer.from(proof.inputNullifiers[0]),
    Buffer.from(proof.inputNullifiers[1]),
    Buffer.from(proof.outputCommitments[0]),
    Buffer.from(proof.outputCommitments[1]),
    // Serialize ExtDataMinified (only extAmount and fee)
    Buffer.from(new BN(extDataMinified.extAmount).toTwos(64).toArray('le', 8)),
    Buffer.from(new BN(extDataMinified.fee).toArray('le', 8)),
    // Serialize encrypted outputs as separate parameters
    Buffer.from(new BN(extData.encryptedOutput1.length).toArray('le', 4)),
    extData.encryptedOutput1,
    Buffer.from(new BN(extData.encryptedOutput2.length).toArray('le', 4)),
    extData.encryptedOutput2,
  ]);

  return instructionData;
}