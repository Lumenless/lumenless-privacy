import { Connection, PublicKey } from '@solana/web3.js';
import { Utxo } from './models/utxo.js';
import { EncryptionService } from './utils/encryption.js';
export declare function localstorageKey(key: PublicKey): string;
/**
 * Fetch and decrypt all UTXOs for a user
 * @param signed The user's signature
 * @param connection Solana connection to fetch on-chain commitment accounts
 * @param setStatus A global state updator. Set live status message showing on webpage
 * @returns Array of decrypted UTXOs that belong to the user
 */
export declare function getUtxosSPL({ publicKey, connection, encryptionService, storage, abortSignal, offset, mintAddress }: {
    publicKey: PublicKey;
    connection: Connection;
    encryptionService: EncryptionService;
    storage: Storage;
    mintAddress: PublicKey | string;
    abortSignal?: AbortSignal;
    offset?: number;
}): Promise<Utxo[]>;
/**
 * Check if a UTXO has been spent
 * @param connection Solana connection
 * @param utxo The UTXO to check
 * @returns Promise<boolean> true if spent, false if unspent
 */
export declare function isUtxoSpent(connection: Connection, utxo: Utxo): Promise<boolean>;
export declare function getBalanceFromUtxosSPL(utxos: Utxo[]): {
    base_units: number;
    amount: number;
    /** @deprecated use base_units instead */
    lamports: number;
};
