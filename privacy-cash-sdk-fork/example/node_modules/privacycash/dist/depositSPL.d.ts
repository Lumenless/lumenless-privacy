import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import * as hasher from '@lightprotocol/hasher.rs';
import { EncryptionService } from './utils/encryption.js';
type DepositParams = {
    mintAddress: PublicKey | string;
    publicKey: PublicKey;
    connection: Connection;
    base_units?: number;
    amount?: number;
    storage: Storage;
    encryptionService: EncryptionService;
    keyBasePath: string;
    lightWasm: hasher.LightWasm;
    referrer?: string;
    signer?: PublicKey;
    transactionSigner: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
};
export declare function depositSPL({ lightWasm, storage, keyBasePath, publicKey, connection, base_units, amount, encryptionService, transactionSigner, referrer, mintAddress, signer }: DepositParams): Promise<{
    tx: string;
}>;
export {};
