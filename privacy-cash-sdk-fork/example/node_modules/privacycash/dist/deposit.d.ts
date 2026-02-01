import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
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
};
export declare function deposit({ lightWasm, storage, keyBasePath, publicKey, connection, amount_in_lamports, encryptionService, transactionSigner, referrer, signer }: DepositParams): Promise<{
    tx: string;
}>;
export {};
