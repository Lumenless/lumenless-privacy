import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import BN from 'bn.js';
import * as hasher from '@lightprotocol/hasher.rs';
import { EncryptionService } from './utils/encryption.js';
type DepositParams = {
    publicKey: PublicKey;
    connection: Connection;
    amount_in_lamports: number;
    storage: Storage;
    encryptionService: EncryptionService;
    keyBasePath: string;
    lightWasm: hasher.LightWasm;
    referrer?: string;
    signer?: PublicKey;
    transactionSigner: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
    /**
     * Optional: The recipient's UTXO public key (as a decimal string or BN).
     * When provided, creates a deposit that the recipient can spend.
     *
     * The recipient obtains their pubkey via `getReceivingPubkey()`.
     *
     * When set:
     * - Output UTXOs use the recipient's pubkey (they can spend with their private key)
     * - Existing UTXOs are NOT consolidated (fresh deposit only)
     * - Returns payment link data (blinding, amount, index) to share with recipient
     */
    recipientUtxoPubkey?: string | BN;
    /**
     * Optional: The recipient's EncryptionService instance.
     * When provided along with recipientUtxoPubkey, the UTXOs will be encrypted
     * using the recipient's symmetric encryption key so they can see the balance.
     *
     * The recipient creates this via EncryptionService.deriveEncryptionKeyFromSignature().
     */
    recipientEncryptionService?: EncryptionService;
};
/**
 * Data returned when creating a payment link deposit.
 * Share this with the recipient so they can claim the funds.
 * The recipient uses this along with their own UTXO private key to withdraw.
 */
export type PaymentLinkData = {
    /** The blinding factor used in the UTXO commitment */
    blinding: string;
    /** Amount in lamports */
    amount: number;
    /** Index of the UTXO in the Merkle tree */
    index: number;
    /** Mint address (for SOL this is the system program) */
    mintAddress: string;
};
export declare function deposit({ lightWasm, storage, keyBasePath, publicKey, connection, amount_in_lamports, encryptionService, transactionSigner, referrer, signer, recipientUtxoPubkey, recipientEncryptionService }: DepositParams): Promise<{
    tx: string;
    paymentLink?: PaymentLinkData;
}>;
export {};
