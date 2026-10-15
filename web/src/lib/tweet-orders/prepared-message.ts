import { createHash } from 'node:crypto';
import { Transaction } from '@solana/web3.js';
import { ApiError } from './server';
const COMPUTE = 'ComputeBudget111111111111111111111111111111';
const LIGHTHOUSE = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';
const digest = (transaction: Transaction) => createHash('sha256').update(transaction.serializeMessage().toString('base64')).digest('hex');

/** Preserve wallet guards on-chain, but compare the exact original payment underneath them. */
export function assertPreparedMessage(transaction: Transaction, expectedHash: string | null | undefined) {
  if (!expectedHash) throw new ApiError('Prepare this payment again before signing.');
  if (digest(transaction) === expectedHash) return;
  let units = 1_400_000; let price = BigInt(0); const seen = new Set<number>();
  const core = transaction.instructions.filter(instruction => ![COMPUTE, LIGHTHOUSE].includes(instruction.programId.toBase58()));
  const accounts = new Set(core.flatMap(instruction => instruction.keys.map(key => key.pubkey.toBase58())));
  for (const instruction of transaction.instructions) {
    const program = instruction.programId.toBase58(); const data = instruction.data;
    if (program === COMPUTE) {
      const kind = data[0];
      if (instruction.keys.length || seen.has(kind)) throw new ApiError('Unsupported wallet network-fee instructions.');
      seen.add(kind);
      if (kind === 2 && data.length === 5) { units = data.readUInt32LE(1); if (!units || units > 1_400_000) throw new ApiError('Unsupported wallet compute limit.'); }
      else if (kind === 3 && data.length === 9) price = data.readBigUInt64LE(1);
      else throw new ApiError('Unsupported wallet network-fee instructions.');
    } else if (program === LIGHTHOUSE) {
      // Opcode 6 is AssertAccountInfoMulti, a read-only assertion (never MemoryWrite/Close).
      // https://github.com/Jac0xb/lighthouse/blob/main/programs/lighthouse/src/instruction.rs
      if (data.length < 3 || data.length > 256 || data[0] !== 6 || data[1] > 4 || instruction.keys.length !== 1 || !accounts.has(instruction.keys[0].pubkey.toBase58()))
        throw new ApiError('Unsupported wallet safety instruction.');
    }
  }
  // At most 0.0001 SOL in wallet-added priority fees, paid by the original fee payer.
  if ((BigInt(units) * price + BigInt(999_999)) / BigInt(1_000_000) > BigInt(100_000))
    throw new ApiError('Wallet priority fee exceeds 0.0001 SOL. Lower it in your wallet and sign again.');
  const original = new Transaction({feePayer:transaction.feePayer,recentBlockhash:transaction.recentBlockhash}).add(...core);
  if (digest(original) !== expectedHash) throw new ApiError('The wallet changed the prepared payment message. This transaction was not broadcast.');
}
