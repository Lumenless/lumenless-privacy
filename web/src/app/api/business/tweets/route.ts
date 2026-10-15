import { NextRequest, NextResponse } from 'next/server';
import { Transaction } from '@solana/web3.js';
import { ApiError, checkOrigin, db, failure, hash, notify, order, requireAdmin, withMedia } from '@/lib/tweet-orders/server';
import { buildTransfer, guardPending, reserveAndBroadcast, verifyTransfer } from '@/lib/tweet-orders/payments';
import { publish, reconcile } from '@/lib/tweet-orders/x';

import { prepareSettlement, broadcastSettlement, verifySettlement, resetSettlement } from '@/lib/tweet-orders/escrow';

export const runtime = 'nodejs';
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  try {
    const session = await requireAdmin(request);
    let query = db().from('tweet_orders').select('*').neq('status', 'awaiting_payment');
    query = session.account.username.toLowerCase() === 'lumenless' ? query.or(`target_x_user_id.eq.${session.account.id},and(target_x_user_id.is.null,target_username.eq.lumenless)`) : query.eq('target_x_user_id', session.account.id);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(100);
    if (error) throw new ApiError('Could not load moderation queue.', 503);
    return NextResponse.json({ orders: await Promise.all((data || []).map(withMedia)) });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request); await requireAdmin(request);
    const body = await request.json();
    if (typeof body.action !== 'string') throw new ApiError('Action is required.');
    if (typeof body.id !== 'string') throw new ApiError('Order ID is required.');
    const value = await order(body.id, request, true);
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : '';
    const client = db();
    if (body.action === 'escrow-prepare') {
      if (!['payout','refund'].includes(body.kind)) throw new ApiError('Choose payout or refund.');
      return NextResponse.json(await prepareSettlement(value,body.kind));
    } else if (body.action === 'escrow-broadcast') {
      if (typeof body.signedTransaction !== 'string') throw new ApiError('Signed transaction is required.');
      return NextResponse.json(await broadcastSettlement(value,body.signedTransaction));
    } else if (body.action === 'escrow-verify') { return NextResponse.json(await verifySettlement(value));
    } else if (body.action === 'escrow-reset') { await resetSettlement(value);
    } else if (['approve', 'reject', 'reject-refund'].includes(body.action)) {
      if (value.status !== 'pending_review') throw new ApiError('This order was already reviewed.', 409);
      if (body.action !== 'approve' && !note) throw new ApiError('Add a rejection reason.');
      const status = body.action === 'approve' ? 'approved' : body.action === 'reject' ? 'rejected' : 'refund_pending';
      const { data, error } = await client.from('tweet_orders').update({ status, ...(status === 'approved' ? { accepted_at: new Date().toISOString() } : {}), review_note: note || null, updated_at: new Date().toISOString() })
        .eq('id', value.id).eq('status', 'pending_review').select().maybeSingle();
      if (error || !data) throw new ApiError('Order changed. Refresh the queue.', 409);
      if (status === 'approved') await publish(value.id);
    } else if (body.action === 'publish') {
      if (value.status === 'publish_failed') {
        const result = await client.from('tweet_orders').update({ status: 'approved' }).eq('id', value.id).eq('status', 'publish_failed');
        if (result.error) throw new ApiError('Could not retry publication.', 503);
      }
      await publish(value.id);
    } else if (body.action === 'reconcile') {
      await reconcile(value, body.postId);
    } else if (body.action === 'recover') {
      if (value.status !== 'publishing' || Date.parse(value.updated_at) > Date.now() - 5 * 60_000)
        throw new ApiError('Wait five minutes before recovering a stalled publication.', 409);
      const result = await client.from('tweet_orders').update({ status: value.publish_attempt === null ? 'approved' : 'publish_uncertain', publish_error: 'Publisher stopped. Check progress before retrying.', updated_at: new Date().toISOString() })
        .eq('id', value.id).eq('status', 'publishing').eq('updated_at', value.updated_at);
      if (result.error) throw new ApiError('Could not recover publication.', 503);
    } else if (body.action === 'confirm-not-published') {
      if (value.status !== 'publish_uncertain' || body.confirm !== `I checked @${value.target_username || 'lumenless'} and this tweet was not published`)
        throw new ApiError('Confirm that the uncertain tweet does not exist on the target account.');
      const result = await client.from('tweet_orders').update({ status: 'approved', publish_attempt: null, publish_error: null, updated_at: new Date().toISOString() }).eq('id', value.id).eq('status', 'publish_uncertain');
      if (result.error) throw new ApiError('Could not reset publication.', 503);
    } else if (body.action === 'notify') {
      if (!value.payment_signature) throw new ApiError('This order is unpaid.');
      await notify(value);
    } else if (body.action.startsWith('refund-') && value.escrow_account_id) {
      throw new ApiError('Use the escrow refund controls for this order.');
    } else if (body.action === 'refund-reset') {
      if (value.status !== 'refund_pending') throw new ApiError('This order is not awaiting a refund.', 409);
      await guardPending(value, true);
    } else if (body.action === 'refund-prepare') {
      if (value.status !== 'refund_pending') throw new ApiError('This order is not awaiting a refund.', 409);
      await guardPending(value, true);
      const built = await buildTransfer(value, true);
      const result = await client.from('tweet_orders').update({ refund_message_hash: hash(built.messageHashInput.toString('base64')), refund_last_valid_height: built.lastValidBlockHeight }).eq('id', value.id).eq('status', 'refund_pending');
      if (result.error) throw new ApiError('Could not prepare refund.', 503);
      const { messageHashInput: _message, ...safe } = built; void _message;
      return NextResponse.json(safe);
    } else if (body.action === 'refund-broadcast') {
      if (value.status !== 'refund_pending' || typeof body.signedTransaction !== 'string' || body.signedTransaction.length > 4000)
        throw new ApiError('Invalid refund request.');
      const transaction = Transaction.from(Buffer.from(body.signedTransaction, 'base64'));
      if (!value.refund_message_hash || hash(transaction.serializeMessage().toString('base64')) !== value.refund_message_hash || !transaction.verifySignatures())
        throw new ApiError('Refund transaction changed. Prepare it again.');
      return NextResponse.json({ signature: await reserveAndBroadcast(value, transaction, true) });
    } else if (body.action === 'refund-verify') {
      if (value.status === 'refunded' && value.refund_signature === body.signature) return NextResponse.json({ ok: true });
      if (value.status !== 'refund_pending') throw new ApiError('Order is not awaiting a refund.', 409);
      await verifyTransfer(value, body.signature, true);
      const { data, error } = await client.from('tweet_orders').update({ status: 'refunded', refund_signature: body.signature, updated_at: new Date().toISOString() })
        .eq('id', value.id).eq('status', 'refund_pending').select().maybeSingle();
      if (error || !data) throw new ApiError('Could not confirm refund. Retry with the same signature.', 409);
    } else throw new ApiError('Unknown admin action.');
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error); }
}
