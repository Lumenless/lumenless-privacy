import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import bs58 from 'bs58';
import { ApiError, db, hash } from './server';
import { mainnetRpc, mintInfo, TREASURY } from './payments';
import { orderTerms, orderAtomic } from './billing';
import { TweetOrder } from './model';
import { openEscrow } from '../business/escrow-keys';
import { verifyPublishedPosts } from './x';
const MEMO=new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export function settlementAmounts(amount:bigint,kind:'payout'|'refund'){const fee=kind==='refund'?BigInt(0):amount*BigInt(1000)/BigInt(10000);return {fee,recipient:amount-fee};}
export function requireSettlement(value:TweetOrder,kind:'payout'|'refund',now=Date.now()){
  if(!value.escrow_account_id||value.settled_at)throw new ApiError('This order has no available escrow balance.',409);
  if(kind==='refund'){if(value.status!=='refund_pending')throw new ApiError('This order is not awaiting a refund.',409);}
  else if(value.status!=='published'||!value.published_at||!Number.isFinite(Date.parse(value.published_at))||now<Date.parse(value.published_at)+86400000)throw new ApiError('Payout is available 24 hours after the whole order was successfully published.',409);
}
async function account(value:TweetOrder){const {data,error}=await db().from('business_x_accounts').select('x_user_id,payout_wallet,escrow_address,escrow_secret').eq('x_user_id',value.escrow_account_id!).single();if(error||!data?.payout_wallet||data.escrow_address!==orderTerms(value).recipient)throw new ApiError('Escrow account configuration does not match this order.',503);return data;}
export async function prepareSettlement(value:TweetOrder,kind:'payout'|'refund'){
  requireSettlement(value,kind);if(value.settlement_signature)throw new ApiError('A settlement is already signed. Verify it before preparing another.',409);
  if(kind==='payout')await verifyPublishedPosts(value);
  const owner=await account(value);const terms=orderTerms(value);const amount=orderAtomic(value);const split=settlementAmounts(amount,kind);
  const sourceOwner=new PublicKey(owner.escrow_address),payer=new PublicKey(owner.payout_wallet);if(payer.equals(sourceOwner))throw new ApiError('Receiving wallet cannot be the escrow wallet.');
  const destination=new PublicKey(kind==='refund'?value.wallet:owner.payout_wallet);const platform=new PublicKey(TREASURY);const connection=await mainnetRpc();const latest=await connection.getLatestBlockhash('finalized');const transaction=new Transaction({feePayer:payer,...latest});
  if(terms.asset==='SOL'){
    if(amount>BigInt(Number.MAX_SAFE_INTEGER))throw new ApiError('SOL amount is outside the supported range.');
    transaction.add(SystemProgram.transfer({fromPubkey:sourceOwner,toPubkey:destination,lamports:Number(split.recipient)}));if(split.fee>BigInt(0))transaction.add(SystemProgram.transfer({fromPubkey:sourceOwner,toPubkey:platform,lamports:Number(split.fee)}));
  }else{
    const mint=await mintInfo(terms.mint!);if(mint.decimals!==terms.decimals)throw new ApiError('Token decimals do not match this order.');const source=getAssociatedTokenAddressSync(mint.address,sourceOwner,false,mint.program);
    for(const [recipient,tokens] of [[destination,split.recipient],[platform,split.fee]] as const){if(tokens===BigInt(0))continue;const target=getAssociatedTokenAddressSync(mint.address,recipient,false,mint.program);transaction.add(createAssociatedTokenAccountIdempotentInstruction(payer,target,recipient,mint.address,mint.program),createTransferCheckedInstruction(source,mint.address,target,sourceOwner,tokens,mint.decimals,[],mint.program));}
  }
  transaction.add(new TransactionInstruction({programId:MEMO,keys:[{pubkey:sourceOwner,isSigner:true,isWritable:false}],data:Buffer.from(`lumenless:escrow:${kind}:${value.id}`)}));
  const messageHash=hash(transaction.serializeMessage().toString('base64'));
  const saved=await db().from('tweet_orders').update({settlement_kind:kind,settlement_message_hash:messageHash,settlement_last_valid_height:latest.lastValidBlockHeight,settlement_recipient:owner.payout_wallet}).eq('id',value.id).is('settlement_signature',null).is('settled_at',null).eq('status',value.status).select('id').maybeSingle();
  if(saved.error||!saved.data)throw new ApiError('Order changed. Refresh before preparing the settlement.',409);
  return {transaction:transaction.serialize({requireAllSignatures:false}).toString('base64'),feePayer:owner.payout_wallet,recipientAmount:split.recipient.toString(),platformFee:split.fee.toString()};
}
export async function broadcastSettlement(value:TweetOrder,raw:string){
  const kind=value.settlement_kind;if(!kind)throw new ApiError('Prepare the escrow transaction first.');requireSettlement(value,kind);
  if(value.settlement_signature){if(!value.settlement_raw)throw new ApiError('Settlement recovery is unavailable.',503);return {signature:await(await mainnetRpc()).sendRawTransaction(Buffer.from(value.settlement_raw,'base64'),{maxRetries:3})};}
  if(raw.length>10000)throw new ApiError('Settlement transaction is too large.');const transaction=Transaction.from(Buffer.from(raw,'base64'));
  if(hash(transaction.serializeMessage().toString('base64'))!==value.settlement_message_hash||transaction.feePayer?.toBase58()!==value.settlement_recipient||!transaction.signatures.some(s=>s.publicKey.toBase58()===value.settlement_recipient&&!!s.signature)||!transaction.verifySignatures(false))throw new ApiError('Settlement changed or the receiving wallet did not sign it.');
  const owner=await account(value);if(owner.payout_wallet!==value.settlement_recipient)throw new ApiError('Receiving wallet changed. Prepare a new transaction.',409);
  if(kind==='payout')await verifyPublishedPosts(value);
  const connection=await mainnetRpc();if(!value.settlement_last_valid_height||await connection.getBlockHeight('finalized')>value.settlement_last_valid_height)throw new ApiError('Settlement expired. Prepare it again.',409);
  transaction.partialSign(openEscrow(value.escrow_account_id!,owner.escrow_secret,owner.escrow_address));if(!transaction.verifySignatures()||!transaction.signature)throw new ApiError('Settlement signatures are incomplete.');
  const signature=bs58.encode(transaction.signature);const signed=transaction.serialize().toString('base64');
  const reserved=await db().from('tweet_orders').update({settlement_signature:signature,settlement_raw:signed}).eq('id',value.id).eq('settlement_message_hash',value.settlement_message_hash!).is('settlement_signature',null).is('settled_at',null).eq('status',value.status).select('id').maybeSingle();
  if(reserved.error||!reserved.data)throw new ApiError('A settlement is already pending. Refresh and verify it.',409);
  await connection.sendRawTransaction(transaction.serialize(),{maxRetries:3});return {signature};
}
export async function verifySettlement(value:TweetOrder){
  if(!value.settlement_signature||!value.settlement_kind)throw new ApiError('No settlement was submitted.');if(value.settled_at)return {ok:true};
  const connection=await mainnetRpc();const proof=await connection.getTransaction(value.settlement_signature,{commitment:'finalized',maxSupportedTransactionVersion:0});if(!proof)throw new ApiError('Settlement is not finalized yet. Retry shortly.',409);if(!proof.meta||proof.meta.err)throw new ApiError('Settlement failed on-chain. Reset it before retrying.',409);
  const saved=await db().from('tweet_orders').update({settled_at:new Date().toISOString(),...(value.settlement_kind==='refund'?{status:'refunded',refund_signature:value.settlement_signature}:{}),updated_at:new Date().toISOString()}).eq('id',value.id).eq('settlement_signature',value.settlement_signature).is('settled_at',null);
  if(saved.error)throw new ApiError('Could not confirm settlement. Retry verification.',503);return {ok:true};
}
export async function resetSettlement(value:TweetOrder){
  if(value.settled_at)throw new ApiError('This order is already settled.',409);
  if(value.settlement_signature){const c=await mainnetRpc();const status=(await c.getSignatureStatuses([value.settlement_signature],{searchTransactionHistory:true})).value[0];if(!(status?.confirmationStatus==='finalized'&&!!status.err))throw new ApiError(status ? 'Verify the pending settlement before resetting it.' : 'RPC cannot prove this settlement failed. Funds remain locked pending reconciliation; an expired blockhash alone does not prove it was never paid.',409);}
  const result=await db().from('tweet_orders').update({settlement_signature:null,settlement_raw:null,settlement_message_hash:null,settlement_kind:null,settlement_last_valid_height:null,settlement_recipient:null}).eq('id',value.id).is('settled_at',null).eq('settlement_message_hash',value.settlement_message_hash||'');if(result.error)throw new ApiError('Could not reset settlement.',503);
}
