/**
 * ZK Proof Generation Utilities
 *
 * This file provides functions for generating zero-knowledge proofs for privacy-preserving
 * transactions on Solana. It handles both snarkjs and zkutil proof generation workflows.
 *
 * Inspired by: https://github.com/tornadocash/tornado-nova/blob/f9264eeffe48bf5e04e19d8086ee6ec58cdf0d9e/src/prover.js
 */
interface Proof {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
}
/**
 * Generates a ZK proof using snarkjs and formats it for use on-chain
 *
 * @param input The circuit inputs to generate a proof for
 * @param keyBasePath The base path for the circuit keys (.wasm and .zkey files)
 * @param options Optional proof generation options (e.g., singleThread for Deno/Bun)
 * @returns A proof object with formatted proof elements and public signals
 */
declare function prove(input: any, keyBasePath: string, options?: {
    singleThread?: boolean;
}): Promise<{
    proof: Proof;
    publicSignals: string[];
}>;
export declare function parseProofToBytesArray(proof: Proof, compressed?: boolean): {
    proofA: number[];
    proofB: number[][];
    proofC: number[];
};
export declare function parseToBytesArray(publicSignals: string[]): number[][];
export { prove, type Proof };
