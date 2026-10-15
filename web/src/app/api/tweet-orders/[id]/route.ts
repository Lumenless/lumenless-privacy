import { NextRequest, NextResponse } from 'next/server';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import { ApiError, checkOrigin, db, failure, hash, notify, order, withMedia } from '@/lib/tweet-orders/server';
import { buildTransfer, guardPending, paymentOptions, reserveAndBroadcast, verifyTransfer } from '@/lib/tweet-orders/payments';
import { validateMedia } from '@/lib/tweet-orders/media';
import { jupiter, swapOrder } from '@/lib/tweet-orders/jupiter';

export const runtime = 'nodejs';
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  try { return NextResponse.json(await withMedia(await order((await context.params).id, request))); }
  catch (error) { return failure(error); }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    checkOrigin(request);
    const value = await order((await context.params).id, request);
    const body = await request.json();
    if (body.action === 'verify' && typeof body.signature === 'string') {
      if (value.payment_signature === body.signature) return NextResponse.json(await withMedia(value));
      if (value.status !== 'awaiting_payment') throw new ApiError('This order was already paid.', 409);
      await verifyTransfer(value, body.signature);
      await validateMedia(value);
      const { data, error } = await db().from('tweet_orders').update({ status: 'pending_review', payment_signature: body.signature, updated_at: new Date().toISOString() })
        .eq('id', value.id).eq('status', 'awaiting_payment').select().maybeSingle();
      if (error || !data) throw new ApiError('Could not confirm order. Retry with the same signature.', 409);
      try { await notify(data); } catch { /* Durable pending notification remains visible to admin and cron. */ }
      return NextResponse.json(await withMedia(data));
    }
    if (value.status !== 'awaiting_payment') throw new ApiError('This order is already paid.', 409);
    if (body.action === 'payment-options') return NextResponse.json(await paymentOptions(value));
    if (body.action === 'reset-payment') { await guardPending(value); return NextResponse.json({ ok: true }); }
    if (body.action === 'prepare') {
      await guardPending(value);
      await validateMedia(value);
      const built = await buildTransfer(value);
      const { error } = await db().from('tweet_orders').update({ payment_message_hash: hash(built.messageHashInput.toString('base64')), payment_last_valid_height: built.lastValidBlockHeight }).eq('id', value.id);
      if (error) throw new ApiError('Could not prepare payment.', 503);
      const { messageHashInput: _message, ...result } = built; void _message;
      return NextResponse.json(result);
    }
    if (body.action === 'broadcast' && typeof body.signedTransaction === 'string' && body.signedTransaction.length <= 4000) {
      const transaction = Transaction.from(Buffer.from(body.signedTransaction, 'base64'));
      if (!value.payment_message_hash || hash(transaction.serializeMessage().toString('base64')) !== value.payment_message_hash || !transaction.verifySignatures())
        throw new ApiError('Payment transaction was changed. Prepare payment again.');
      const signature = await reserveAndBroadcast(value, transaction);
      return NextResponse.json({ signature });
    }
    if (body.action === 'swap-quote' && typeof body.maxSol === 'string') {
      await validateMedia(value);
      return NextResponse.json(await swapOrder(value, body.maxSol));
    }
    if (body.action === 'swap-execute' && typeof body.signedTransaction === 'string' && body.signedTransaction.length <= 4000) {
      const transaction = VersionedTransaction.deserialize(Buffer.from(body.signedTransaction, 'base64'));
      if (!value.swap_request_id || hash(Buffer.from(transaction.message.serialize()).toString('base64')) !== value.swap_message_hash)
        throw new ApiError('Swap quote changed or expired. Get a new quote.');
      const result = await jupiter('/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedTransaction: body.signedTransaction, requestId: value.swap_request_id }) });
      if (result.status !== 'Success') throw new ApiError('Swap was not confirmed. Check your wallet before trying again.', 409);
      return NextResponse.json({ signature: result.signature });
    }
    throw new ApiError('Unknown action.');
  } catch (error) { return failure(error); }
}
