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
export declare function getUtxos({ publicKey, connection, encryptionService, storage, abortSignal, offset }: {
    publicKey: PublicKey;
    connection: Connection;
    encryptionService: EncryptionService;
    storage: Storage;
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
export declare function getBalanceFromUtxos(utxos: Utxo[]): {
    lamports: number;
};
