import { LUMEN_MINT, type TweetOrder } from './model';
export const DEFAULT_RECIPIENT = 'LUMthMRYXEvkekVVLkwMQr92huNK5x5jZGSQzpmCUjb';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export type Billing = { tweet_price: string; thread_price: string; payment_asset: 'SOL' | 'SPL'; payment_mint: string | null; payment_symbol: string; payment_decimals: number; payment_recipient: string };
export type PaymentTerms = { asset: 'SOL' | 'SPL'; mint: string | null; symbol: string; decimals: number; recipient: string; amount: string };
export const DEFAULT_BILLING: Billing = { tweet_price:'1000000', thread_price:'3000000', payment_asset:'SPL', payment_mint:LUMEN_MINT, payment_symbol:'LUMEN', payment_decimals:6, payment_recipient:DEFAULT_RECIPIENT };
export const BILLING_COLUMNS = 'tweet_price,thread_price,payment_asset,payment_mint,payment_symbol,payment_decimals,payment_recipient';
export function decimalAtomic(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18 || !/^(0|[1-9]\d{0,18})(\.\d{1,18})?$/.test(value)) throw new Error('Enter a positive decimal price without commas or exponent notation.');
  const [whole, fraction=''] = value.split('.');
  if (fraction.length > decimals) throw new Error(`This token supports at most ${decimals} decimal places.`);
  const atomic = BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (atomic <= BigInt(0) || atomic > BigInt(18446744073709551615)) throw new Error('Price is outside the supported token amount range.');
  return atomic;
}
export function termsFor(billing: Billing, kind: 'tweet' | 'thread'): PaymentTerms {
  return { asset: billing.payment_asset, mint: billing.payment_mint, symbol: billing.payment_symbol, decimals: billing.payment_decimals, recipient: billing.payment_recipient, amount: kind === 'thread' ? billing.thread_price : billing.tweet_price };
}
export function orderTerms(value: TweetOrder): PaymentTerms {
  return value.payment_asset ? { asset:value.payment_asset, mint:value.payment_mint ?? null, symbol:value.payment_symbol!, decimals:value.payment_decimals!, recipient:value.payment_recipient!, amount:value.payment_amount! } : termsFor(DEFAULT_BILLING, value.kind);
}
export function orderAtomic(value: TweetOrder) {
  if (!value.payment_asset) return BigInt(value.amount_tokens) * BigInt(1000000);
  const terms = orderTerms(value); const expected = decimalAtomic(terms.amount, terms.decimals);
  if (value.payment_amount_atomic !== expected.toString()) throw new Error('Order payment terms are inconsistent.');
  return expected;
}
export function displayAmount(value: string) { const [whole,fraction] = value.split('.'); return BigInt(whole).toLocaleString('en-US') + (fraction ? '.' + fraction : ''); }
