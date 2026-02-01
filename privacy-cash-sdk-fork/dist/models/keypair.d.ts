/**
 * Keypair module for ZK Cash
 *
 * Provides cryptographic keypair functionality for the ZK Cash system
 * Based on: https://github.com/tornadocash/tornado-nova
 */
import BN from 'bn.js';
import * as hasher from '@lightprotocol/hasher.rs';
/**
 * Simplified version of Keypair
 */
export declare class Keypair {
    privkey: BN;
    pubkey: BN;
    private lightWasm?;
    constructor(privkeyHex: string, lightWasm: hasher.LightWasm);
    /**
     * Create a keypair with only the public key (for output UTXOs where you don't have the private key).
     * This keypair cannot sign - it's only useful for creating commitments.
     *
     * @param pubkey The UTXO public key as a decimal string or BN
     * @returns A Keypair instance with only the pubkey set (privkey is set to 0)
     */
    static fromPubkeyOnly(pubkey: string | BN): Keypair;
    /**
    * Sign a message using keypair private key
    *
    * @param {string|number|BigNumber} commitment a hex string with commitment
    * @param {string|number|BigNumber} merklePath a hex string with merkle path
    * @returns {BigNumber} a hex string with signature
    */
    sign(commitment: string, merklePath: string): string;
    static generateNew(lightWasm: hasher.LightWasm): Promise<Keypair>;
}
