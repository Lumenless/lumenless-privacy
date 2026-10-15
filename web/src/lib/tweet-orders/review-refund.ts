import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { ApiError, db } from './server';
import { TweetOrder } from './model';
import { refundAuthorizationMessage, RefundAuthorization, REVIEW_TIMEOUT_MS } from './refund-model';

export function assertRefundAuthorization(id: string, authorization: RefundAuthorization, now = Date.now()) {
  if (!Number.isSafeInteger(authorization.timestamp) || Math.abs(now - authorization.timestamp) > 5 * 60_000)
    throw new ApiError('Wallet authorization expired. Reconnect your wallet and sign again.', 401);
  let valid = false;
  try { valid = nacl.sign.detached.verify(Buffer.from(refundAuthorizationMessage(id, authorization)), bs58.decode(authorization.signature), new PublicKey(authorization.wallet).toBytes()); } catch { /* Invalid proof. */ }
  if (!valid) throw new ApiError('Invalid buyer wallet authorization.', 401);
}
export function reviewRefundDeadline(value: Pick<TweetOrder, 'escrow_account_id'|'payment_signature'|'paid_at'>) {
  const paid = value.paid_at ? Date.parse(value.paid_at) : NaN;
  return value.escrow_account_id && value.payment_signature && Number.isFinite(paid) ? new Date(paid + REVIEW_TIMEOUT_MS).toISOString() : null;
}
export function canRequestReviewRefund(value: Pick<TweetOrder,'escrow_account_id'|'payment_signature'|'paid_at'|'status'|'accepted_at'|'settled_at'|'settlement_signature'|'published_ids'>, now = Date.now()) {
  const deadline = reviewRefundDeadline(value);
  return !!deadline && now >= Date.parse(deadline) && value.status === 'pending_review' && !value.accepted_at && !value.settled_at && !value.settlement_signature && !value.published_ids?.length;
}
export function assertBuyerRefund(value: TweetOrder) {
  if (!value.escrow_account_id || value.refund_reason !== 'review_timeout' || !['refund_pending','refunded'].includes(value.status))
    throw new ApiError('This order has no buyer-requested timeout refund.', 409);
}
export async function claimReviewRefund(value: TweetOrder) {
  if (value.refund_reason === 'review_timeout') { assertBuyerRefund(value); return value; }
  if (!canRequestReviewRefund(value)) throw new ApiError('A refund is available only after 72 hours without an approval or rejection.', 409);
  // The database clock and conditional UPDATE arbitrate the race with moderation.
  const {data,error} = await db().rpc('claim_review_timeout_refund', {p_order_id:value.id,p_wallet:value.wallet});
  if (error) throw new ApiError('Could not request your refund. Please retry.', 503);
  if (!data?.[0]) throw new ApiError('The order changed or the 72-hour deadline has not passed. Refresh its status.', 409);
  return data[0] as TweetOrder;
}
