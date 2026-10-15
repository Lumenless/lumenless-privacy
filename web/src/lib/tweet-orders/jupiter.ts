import { VersionedTransaction } from '@solana/web3.js';
import { TweetOrder } from './model';
import { mintInfo } from './payments';
import { ApiError, db, env, hash } from './server';

import { orderTerms, orderAtomic } from './billing';

const BASE = 'https://api.jup.ag/swap/v2';
export async function jupiter(path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, { ...init, headers: { 'x-api-key': env('JUPITER_API_KEY'), ...init.headers }, signal: AbortSignal.timeout(init.method === 'POST' ? 30_000 : 8000) });
  if (!response.ok) throw new ApiError(response.status === 429 ? 'Jupiter is busy. Retry shortly.' : 'Jupiter could not complete the swap. Retry or pay with the selected token.', response.status === 429 ? 429 : 502);
  return response.json();
}
export function solLamports(value: string) {
  if (!/^\d{1,5}(\.\d{1,9})?$/.test(value)) throw new ApiError('Enter a SOL limit with at most nine decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole) * BigInt(1_000_000_000) + BigInt(fraction.padEnd(9, '0'));
  if (result <= BigInt(0) || result > BigInt(100_000_000_000)) throw new ApiError('SOL limit must be greater than zero and at most 100 SOL.');
  return result;
}
export async function swapOrder(value: TweetOrder, maxSol: string) {
  const budget = solLamports(maxSol);
  const terms = orderTerms(value);
  if (terms.asset === 'SOL') throw new ApiError('Pay SOL directly for this order.');
  const mint = await mintInfo(terms.mint!);
  const required = orderAtomic(value);
  // V2 supports ExactIn only. Size the input conservatively; any surplus stays in the buyer's wallet.
  let input = budget < BigInt(10_000_000) ? budget : BigInt(10_000_000);
  for (let attempt = 0; attempt < 4; attempt++) {
    const quote = await jupiter(`/order?${new URLSearchParams({ inputMint: 'So11111111111111111111111111111111111111112',
      outputMint: terms.mint!, amount: input.toString(), taker: value.wallet, slippageBps: '50', maxSupportedTransactionVersion: '0' })}`);
    if (quote.inputMint !== 'So11111111111111111111111111111111111111112' || quote.outputMint !== terms.mint
      || quote.swapMode !== 'ExactIn' || quote.taker !== value.wallet || quote.inAmount !== input.toString()
      || quote.slippageBps !== 50 || !/^\d+$/.test(quote.otherAmountThreshold || ''))
      throw new ApiError('Jupiter returned an invalid quote.', 502);
    const minimum = BigInt(quote.otherAmountThreshold);
    if (minimum <= BigInt(0)) throw new ApiError('No liquid SOL/token route is available.', 409);
    if (minimum < required) {
      input = (input * required * BigInt(1005) + minimum * BigInt(1000) - BigInt(1)) / (minimum * BigInt(1000));
      if (input > budget) throw new ApiError('This SOL limit is too low for the order. Increase it or pay with the selected token.', 409);
      continue;
    }
    if (!Number.isFinite(Number(quote.priceImpact)) || Math.abs(Number(quote.priceImpact)) > 5)
      throw new ApiError('The swap price impact exceeds 5%. Pay with the selected token or retry later.', 409);
    if (!quote.transaction || !quote.requestId) throw new ApiError('Jupiter cannot build this swap. Check your SOL balance.', 409);
    const transaction = VersionedTransaction.deserialize(Buffer.from(quote.transaction, 'base64'));
    const { error } = await db().from('tweet_orders').update({ swap_request_id: quote.requestId, swap_message_hash: hash(Buffer.from(transaction.message.serialize()).toString('base64')) })
      .eq('id', value.id).eq('status', 'awaiting_payment');
    if (error) throw new ApiError('Could not save swap quote.', 503);
    return { transaction: quote.transaction, requestId: quote.requestId, inLamports: quote.inAmount,
      minOutputAtomic: quote.otherAmountThreshold, decimals: mint.decimals,
      networkFeeLamports: Number(quote.signatureFeeLamports || 0) + Number(quote.prioritizationFeeLamports || 0) + Number(quote.rentFeeLamports || 0) };
  }
  throw new ApiError('Unable to price this order within your SOL limit. Retry or pay with the selected token.', 409);
}
