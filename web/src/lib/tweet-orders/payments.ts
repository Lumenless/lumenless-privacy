import { Connection, PublicKey, Transaction, TransactionInstruction, ParsedTransactionWithMeta, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync, getMint, getTransferFeeConfig, getExtensionTypes, ExtensionType, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { ApiError, db, env } from './server';
import { LUMEN_MINT, TweetOrder } from './model';

import { orderTerms, orderAtomic } from './billing';
export const TREASURY = 'LUMthMRYXEvkekVVLkwMQr92huNK5x5jZGSQzpmCUjb';
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export function rpc() { return new Connection(env('SOLANA_MAINNET_RPC_URL'), 'finalized'); }
export async function mainnetRpc() {
  const connection = rpc();
  if (await connection.getGenesisHash() !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new ApiError('The payment RPC must connect to Solana mainnet.', 503);
  return connection;
}
export async function mintInfo(mintAddress = LUMEN_MINT) {
  const connection = rpc();
  if (await connection.getGenesisHash() !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
    throw new ApiError('The payment RPC must connect to Solana mainnet.', 503);
  const address = new PublicKey(mintAddress);
  const account = await connection.getAccountInfo(address);
  if (!account || (!account.owner.equals(TOKEN_PROGRAM_ID) && !account.owner.equals(TOKEN_2022_PROGRAM_ID)))
    throw new ApiError('Token mint could not be verified.', 503);
  const mint = await getMint(connection, address, 'finalized', account.owner);
  if (mint.decimals > 18) throw new ApiError('Tokens with more than 18 decimals are not supported.');
  if (getExtensionTypes(mint.tlvData).some(type => ![ExtensionType.MetadataPointer, ExtensionType.TokenMetadata, ExtensionType.MintCloseAuthority].includes(type))) throw new ApiError('This token has unsupported transfer or balance extensions.');
  if (getTransferFeeConfig(mint)) throw new ApiError('Transfer-fee tokens are not supported.', 503);
  return { address, decimals: mint.decimals, program: account.owner };
}
export function atomicAmount(tokens: number, decimals: number) { return BigInt(tokens) * BigInt(10) ** BigInt(decimals); }
export function paymentMemo(id: string, refund = false) { return `lumenless:${refund ? 'refund' : 'order'}:${id}`; }
export function choosePayment(lumen: bigint, required: bigint, sol: bigint) {
  if (lumen >= required) return { method: 'DIRECT' as const };
  // Leave SOL for rent and the separate LUMEN payment; quote and wallet still enforce actual fees.
  const available = sol - BigInt(5_000_000);
  if (available <= BigInt(0)) throw new ApiError('Not enough payment tokens or SOL to pay for this order. Add funds to your wallet.');
  const budget = available > BigInt(100_000_000_000) ? BigInt(100_000_000_000) : available;
  return { method: 'SOL' as const, maxSol: `${budget / BigInt(1_000_000_000)}.${(budget % BigInt(1_000_000_000)).toString().padStart(9, '0')}` };
}
export async function paymentOptions(value: TweetOrder) {
  const terms = orderTerms(value);
  const owner = new PublicKey(value.wallet);
  const connection = await mainnetRpc();
  const nativeBalance = BigInt(await connection.getBalance(owner));
  if (terms.asset === 'SOL') { if (nativeBalance < orderAtomic(value) + BigInt(5000)) throw new ApiError('Not enough SOL for the payment and network fee.'); return { method: 'DIRECT' as const }; }
  const mint = await mintInfo(terms.mint!);
  const account = getAssociatedTokenAddressSync(mint.address, owner, false, mint.program);
  const accountInfo = await connection.getAccountInfo(account);
  const balance = accountInfo ? BigInt((await connection.getTokenAccountBalance(account)).value.amount) : BigInt(0);
  const sol = await connection.getBalance(owner);
  return choosePayment(balance, orderAtomic(value), BigInt(sol));
}
export async function buildTransfer(value: TweetOrder, refund = false) {
  const terms = orderTerms(value);
  const sender = new PublicKey(refund ? terms.recipient : value.wallet);
  const recipient = new PublicKey(refund ? value.wallet : terms.recipient);
  const amount = orderAtomic(value);
  const connection = await mainnetRpc();
  const latest = await connection.getLatestBlockhash('finalized');
  const memo = new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: sender, isSigner: true, isWritable: false }], data: Buffer.from(paymentMemo(value.id, refund)) });
  if (terms.asset === 'SOL') {
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new ApiError('SOL amount exceeds the supported transaction range.');
    const transaction = new Transaction({ feePayer: sender, ...latest }).add(SystemProgram.transfer({ fromPubkey: sender, toPubkey: recipient, lamports: Number(amount) }), memo);
    return { transaction:transaction.serialize({requireAllSignatures:false}).toString('base64'),messageHashInput:transaction.serializeMessage(),...latest,amount:amount.toString() };
  }
  const mint = await mintInfo(terms.mint!);
  if (mint.decimals !== terms.decimals) throw new ApiError('Token decimals no longer match the order.');
  const source = getAssociatedTokenAddressSync(mint.address, sender, false, mint.program);
  const destination = getAssociatedTokenAddressSync(mint.address, recipient, false, mint.program);

  const transaction = new Transaction({ feePayer: sender, ...latest }).add(
    createAssociatedTokenAccountIdempotentInstruction(sender, destination, recipient, mint.address, mint.program),
    createTransferCheckedInstruction(source, mint.address, destination, sender, amount, mint.decimals, [], mint.program),
    memo,
  );
  return { transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
    messageHashInput: transaction.serializeMessage(), ...latest, amount: amount.toString() };
}
export async function verifyTransfer(value: TweetOrder, signature: string, refund = false) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) throw new ApiError('Invalid transaction signature.');
  const transaction = await rpc().getParsedTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
  if (!transaction) throw new ApiError('Transaction is not finalized yet. Retry verification shortly.', 409);
  await mainnetRpc();
  const terms = orderTerms(value);
  if (terms.asset === 'SOL') assertNativeTransfer(value, transaction, refund);
  else assertTransfer(value, transaction, await mintInfo(terms.mint!), refund);
}
export function assertTransfer(value: TweetOrder, transaction: ParsedTransactionWithMeta, mint: { address: PublicKey; decimals: number; program: PublicKey }, refund = false) {
  if (!transaction.meta || transaction.meta.err) throw new ApiError('The transaction failed.');
  const terms = orderTerms(value);
  const sender = refund ? terms.recipient : value.wallet;
  const recipient = refund ? value.wallet : terms.recipient;
  const destination = getAssociatedTokenAddressSync(mint.address, new PublicKey(recipient), false, mint.program).toBase58();
  const expected = orderAtomic(value);
  if (mint.address.toBase58() !== terms.mint || mint.decimals !== terms.decimals) throw new ApiError('Order token does not match the transfer.');
  const message = transaction.transaction.message;
  if (!message.accountKeys.some(key => key.signer && key.pubkey.toBase58() === sender)) throw new ApiError('Payment wallet does not match this order.');
  const hasMemo = message.instructions.some(ix => ix.programId.equals(MEMO) && 'parsed' in ix && ix.parsed === paymentMemo(value.id, refund));
  const transfer = message.instructions.some(ix => {
    if (!ix.programId.equals(mint.program) || !('parsed' in ix)) return false;
    const parsed = ix.parsed;
    return parsed.type === 'transferChecked' && parsed.info.authority === sender && parsed.info.destination === destination
      && parsed.info.mint === terms.mint && parsed.info.tokenAmount.amount === expected.toString()
      && parsed.info.tokenAmount.decimals === mint.decimals;
  });
  const index = message.accountKeys.findIndex(key => key.pubkey.toBase58() === destination);
  const pre = transaction.meta.preTokenBalances?.find(balance => balance.accountIndex === index && balance.mint === terms.mint);
  const post = transaction.meta.postTokenBalances?.find(balance => balance.accountIndex === index && balance.mint === terms.mint);
  if (!hasMemo || !transfer || !post || BigInt(post.uiTokenAmount.amount) - BigInt(pre?.uiTokenAmount.amount || '0') !== expected)
    throw new ApiError('Transaction does not contain the exact token payment for this order.');
  if (!refund && transaction.blockTime && transaction.blockTime * 1000 < Date.parse(value.created_at) - 60_000)
    throw new ApiError('Payment predates this order.');
}
export function assertNativeTransfer(value: TweetOrder, transaction: ParsedTransactionWithMeta, refund = false) {
  const terms = orderTerms(value); const amount = orderAtomic(value);
  if (terms.asset !== 'SOL' || !transaction.meta || transaction.meta.err) throw new ApiError('The SOL transaction failed.');
  const sender = refund ? terms.recipient : value.wallet; const recipient = refund ? value.wallet : terms.recipient;
  const message = transaction.transaction.message;
  const destination = message.accountKeys.findIndex(key => key.pubkey.toBase58() === recipient);
  const transfer = message.instructions.some(ix => ix.programId.equals(SystemProgram.programId) && 'parsed' in ix && ix.parsed.type === 'transfer' && ix.parsed.info.source === sender && ix.parsed.info.destination === recipient && Number.isSafeInteger(ix.parsed.info.lamports) && BigInt(ix.parsed.info.lamports) === amount);
  const memo = message.instructions.some(ix => ix.programId.equals(MEMO) && 'parsed' in ix && ix.parsed === paymentMemo(value.id, refund));
  const pre = transaction.meta.preBalances[destination], post = transaction.meta.postBalances[destination];
  if (!message.accountKeys.some(key => key.signer && key.pubkey.toBase58() === sender) || !transfer || !memo || destination < 0 || !Number.isSafeInteger(pre) || !Number.isSafeInteger(post) || BigInt(post)-BigInt(pre) !== amount) throw new ApiError('Transaction does not contain the exact SOL payment for this order.');
  if (!refund && transaction.blockTime && transaction.blockTime*1000 < Date.parse(value.created_at)-60000) throw new ApiError('Payment predates this order.');
}
export async function guardPending(value: TweetOrder, refund = false) {
  const column = refund ? 'refund_signed_signature' : 'payment_signed_signature';
  const signature = value[column];
  if (!signature) return;
  const status = (await rpc().getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
  const height = refund ? value.refund_last_valid_height : value.payment_last_valid_height;
  const safelyFailed = status?.confirmationStatus === 'finalized' && !!status.err;
  const expired = !status && height && await rpc().getBlockHeight('finalized') > height;
  if (!safelyFailed && !expired) throw new ApiError(`A transaction is already signed for this order. Verify ${signature} before preparing another.`, 409);
  const { error } = await db().from('tweet_orders').update({ [column]: null }).eq('id', value.id).eq(column, signature);
  if (error) throw new ApiError('Could not clear failed transaction.', 503);
}
export async function reserveAndBroadcast(value: TweetOrder, transaction: Transaction, refund = false) {
  if (!transaction.signature || !transaction.verifySignatures()) throw new ApiError('Invalid transaction signature.');
  const column = refund ? 'refund_signed_signature' : 'payment_signed_signature';
  const signature = bs58.encode(transaction.signature);
  if (value[column] && value[column] !== signature) throw new ApiError('Another transaction is already signed. Verify it first.', 409);
  if (!value[column]) {
    const { data, error } = await db().from('tweet_orders').update({ [column]: signature }).eq('id', value.id)
      .eq('status', refund ? 'refund_pending' : 'awaiting_payment').is(column, null).select('id').maybeSingle();
    if (error || !data) throw new ApiError('Order changed. Refresh before retrying.', 409);
  }
  return rpc().sendRawTransaction(transaction.serialize(), { maxRetries: 3 });
}
