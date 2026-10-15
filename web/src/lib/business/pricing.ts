import { PublicKey } from '@solana/web3.js';
import { LUMEN_MINT } from '../tweet-orders/model';
import { USDC_MINT, decimalAtomic, type Billing } from '../tweet-orders/billing';
import { mintInfo } from '../tweet-orders/payments';
import { ApiError } from '../tweet-orders/server';
export function receivingWallet(value: unknown) {
  try { if(typeof value!=='string')throw Error();const key=new PublicKey(value);if(!PublicKey.isOnCurve(key.toBytes()))throw Error();return key.toBase58(); } catch { throw new ApiError('Enter a valid receiving wallet controlled by a Solana wallet.'); }
}
export async function validatedPricing(body: Record<string, unknown>): Promise<Omit<Billing,'payment_recipient'> & {payout_wallet:string}> {
  const token=body.token;
  if(!['SOL','USDC','LUMEN','CUSTOM'].includes(String(token)))throw new ApiError('Choose a payment token.');
  const native=token==='SOL';let mint: string|null=null;let decimals=9;let symbol='SOL';
  if(!native){
    mint=token==='LUMEN'?LUMEN_MINT:token==='USDC'?USDC_MINT:typeof body.customMint==='string'?body.customMint:'';
    try { new PublicKey(mint); } catch { throw new ApiError('Enter a valid token mint address.'); }
    const info=await mintInfo(mint);decimals=info.decimals;
    symbol=token==='CUSTOM'?String(body.customSymbol||'TOKEN').toUpperCase():String(token);
    if(!/^[A-Z0-9_]{1,16}$/.test(symbol))throw new ApiError('Token symbol must contain 1–16 letters, digits or underscores.');
  }
  const tweet=typeof body.tweetPrice==='string'?body.tweetPrice.trim():'';const thread=typeof body.threadPrice==='string'?body.threadPrice.trim():'';
  try { for(const price of [tweet,thread]){const atomic=decimalAtomic(price,decimals);if(native&&atomic>BigInt(Number.MAX_SAFE_INTEGER))throw Error('SOL price is too large.');} } catch(error){throw new ApiError(error instanceof Error?error.message:'Invalid price.');}
  return {tweet_price:tweet,thread_price:thread,payment_asset:native?'SOL':'SPL',payment_mint:mint,payment_symbol:symbol,payment_decimals:decimals,payout_wallet:receivingWallet(body.payoutWallet)};
}
