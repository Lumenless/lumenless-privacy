/**
 * Utility functions for ZK Cash
 *
 * Provides common utility functions for the ZK Cash system
 * Based on: https://github.com/tornadocash/tornado-nova
 */
import BN from 'bn.js';
import { Utxo } from '../models/utxo.js';
import { PublicKey } from '@solana/web3.js';
/**
 * Calculate deposit fee based on deposit amount and fee rate
 * @param depositAmount Amount being deposited in lamports
 * @returns Fee amount in lamports
 */
export declare function calculateDepositFee(depositAmount: number): Promise<number>;
/**
 * Calculate withdrawal fee based on withdrawal amount and fee rate
 * @param withdrawalAmount Amount being withdrawn in lamports
 * @returns Fee amount in lamports
 */
export declare function calculateWithdrawalFee(withdrawalAmount: number): Promise<number>;
/**
 * Mock encryption function - in real implementation this would be proper encryption
 * For testing, we just return a fixed prefix to ensure consistent extDataHash
 * @param value Value to encrypt
 * @returns Encrypted string representation
 */
export declare function mockEncrypt(value: Utxo): string;
/**
 * Calculates the hash of ext data using Borsh serialization
 * @param extData External data object containing recipient, amount, encrypted outputs, fee, fee recipient, and mint address
 * @returns The hash as a Uint8Array (32 bytes)
 */
export declare function getExtDataHash(extData: {
    recipient: string | PublicKey;
    extAmount: string | number | BN;
    encryptedOutput1?: string | Uint8Array;
    encryptedOutput2?: string | Uint8Array;
    fee: string | number | BN;
    feeRecipient: string | PublicKey;
    mintAddress: string | PublicKey;
}): Uint8Array;
export declare function fetchMerkleProof(commitment: string, tokenName?: string): Promise<{
    pathElements: string[];
    pathIndices: number[];
}>;
export declare function findNullifierPDAs(proof: any): {
    nullifier0PDA: PublicKey;
    nullifier1PDA: PublicKey;
};
export declare function queryRemoteTreeState(tokenName?: string): Promise<{
    root: string;
    nextIndex: number;
}>;
export declare function getProgramAccounts(): {
    treeAccount: PublicKey;
    treeTokenAccount: PublicKey;
    globalConfigAccount: PublicKey;
};
export declare function findCrossCheckNullifierPDAs(proof: any): {
    nullifier2PDA: PublicKey;
    nullifier3PDA: PublicKey;
};
export declare function getMintAddressField(mint: PublicKey): string;
