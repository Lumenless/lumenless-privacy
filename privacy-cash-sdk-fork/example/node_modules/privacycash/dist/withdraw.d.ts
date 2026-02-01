import { Connection, PublicKey } from '@solana/web3.js';
import * as hasher from '@lightprotocol/hasher.rs';
import { EncryptionService } from './utils/encryption.js';
type WithdrawParams = {
    publicKey: PublicKey;
    connection: Connection;
    amount_in_lamports: number;
    keyBasePath: string;
    encryptionService: EncryptionService;
    lightWasm: hasher.LightWasm;
    recipient: PublicKey;
    storage: Storage;
    referrer?: string;
};
export declare function withdraw({ recipient, lightWasm, storage, publicKey, connection, amount_in_lamports, encryptionService, keyBasePath, referrer }: WithdrawParams): Promise<{
    isPartial: boolean;
    tx: string;
    recipient: string;
    amount_in_lamports: number;
    fee_in_lamports: number;
}>;
export {};
