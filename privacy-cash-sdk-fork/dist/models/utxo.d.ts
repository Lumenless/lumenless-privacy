/**
 * UTXO (Unspent Transaction Output) module for ZK Cash
 *
 * Provides UTXO functionality for the ZK Cash system
 * Based on: https://github.com/tornadocash/tornado-nova
 */
import BN from 'bn.js';
import { Keypair } from './keypair.js';
import * as hasher from '@lightprotocol/hasher.rs';
/**
 * Simplified Utxo class inspired by Tornado Cash Nova
 * Based on: https://github.com/tornadocash/tornado-nova/blob/f9264eeffe48bf5e04e19d8086ee6ec58cdf0d9e/src/utxo.js
 */
export declare class Utxo {
    amount: BN;
    blinding: BN;
    keypair: Keypair;
    index: number;
    mintAddress: string;
    version: 'v1' | 'v2';
    private lightWasm;
    constructor({ lightWasm, amount, 
    /**
     * Tornado nova doesn't use solana eddsa with curve 25519 but their own "keypair"
     * which is:
     * - private key: random [31;u8]
     * - public key: PoseidonHash(privateKey)
     *
     * Generate a new keypair for each UTXO
     */
    keypair, blinding, // Use fixed value for consistency instead of randomBN()
    index, mintAddress, // Default to Solana native SOL mint address,
    version }: {
        lightWasm: hasher.LightWasm;
        amount?: BN | number | string;
        keypair?: Keypair;
        blinding?: BN | number | string;
        index?: number;
        mintAddress?: string;
        version?: 'v1' | 'v2';
    });
    getCommitment(): Promise<string>;
    getNullifier(): Promise<string>;
    /**
     * Log all the UTXO's public properties and derived values in JSON format
     * @returns Promise that resolves once all logging is complete
     */
    log(): Promise<void>;
}
