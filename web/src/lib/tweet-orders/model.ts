import { z } from 'zod';
import parseTweet from 'twitter-text/dist/parseTweet';

export const LUMEN_MINT = '6Q5t5upWJwDocysAwR2zertE2EPxB3X1ek1HRoj4LUM';
export const MEDIA_BUCKET = 'tweet-order-media';
export const mediaSchema = z.object({
  name: z.string().min(1).max(160),
  type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']),
  size: z.number().int().positive().max(50 * 1024 * 1024),
}).superRefine((file, ctx) => {
  if (file.type.startsWith('image/') && file.size > 10 * 1024 * 1024)
    ctx.addIssue({ code: 'custom', message: 'Images must be under 10 MB.' });
});
export const draftSchema = z.object({
  targetUsername: z.string().regex(/^[a-z0-9_]{1,15}$/).optional(),
  wallet: z.string().min(32).max(44),
  kind: z.enum(['tweet', 'thread']),
  tweets: z.array(z.object({ text: z.string().trim().max(4000), media: z.array(mediaSchema).max(4) })
    .superRefine((tweet, ctx) => {
      if (tweet.text && !parseTweet(tweet.text).valid) ctx.addIssue({ code: 'custom', message: 'Tweet exceeds X’s weighted character limit or contains unsupported characters.' });
      if (!tweet.text && !tweet.media.length) ctx.addIssue({ code: 'custom', message: 'Add text or media to each tweet.' });
      if (tweet.media.some(file => file.type.startsWith('video/')) && tweet.media.length !== 1)
        ctx.addIssue({ code: 'custom', message: 'Use up to four images or one video per tweet.' });
    })).min(1).max(5),
  email: z.union([z.string().email().max(254), z.literal('')]).optional(),
  telegram: z.string().trim().max(100).optional(),
  acceptedTerms: z.literal(true),
}).superRefine((draft, ctx) => {
  if (draft.kind === 'tweet' && draft.tweets.length !== 1)
    ctx.addIssue({ code: 'custom', message: 'A single tweet must contain exactly one tweet.' });
  if (draft.kind === 'thread' && draft.tweets.length < 2)
    ctx.addIssue({ code: 'custom', message: 'A thread must contain two to five tweets.' });
});
export type Draft = z.infer<typeof draftSchema>;
export type TweetOrder = {
  id: string; paid_partnership?: boolean | null; target_x_user_id?: string | null; target_username?: string; wallet: string; kind: Draft['kind']; tweets: Array<{ text: string; media: Array<z.infer<typeof mediaSchema> & { path: string; url?: string }> }>;
  email: string | null; telegram: string | null; amount_tokens: number;
  status: 'awaiting_payment' | 'pending_review' | 'approved' | 'publishing' | 'publish_failed' | 'publish_uncertain' | 'published' | 'rejected' | 'refund_pending' | 'refunded';
  payment_signature: string | null; refund_signature: string | null;
  review_note: string | null; published_url: string | null; created_at: string;
  token_hash: string; notification_sent_at: string | null;
  published_ids: string[]; x_media: Record<string, { id: string; ready: boolean; expires: number }>;
  publish_attempt: number | null; publish_error: string | null; updated_at: string;
  payment_message_hash: string | null; refund_message_hash: string | null;
  swap_request_id: string | null; swap_message_hash: string | null;
  payment_signed_signature: string | null; refund_signed_signature: string | null;
  payment_last_valid_height: number | null; refund_last_valid_height: number | null;
};
export function price(kind: Draft['kind']) { return kind === 'thread' ? 3_000_000 : 1_000_000; }
export function signingMessage(payload: Draft, timestamp: number, nonce: string) {
  return `Lumenless tweet order\n${timestamp}\n${nonce}\n${JSON.stringify(payload)}`;
}
export const transitions: Record<TweetOrder['status'], TweetOrder['status'][]> = {
  awaiting_payment: ['pending_review'], pending_review: ['approved', 'rejected', 'refund_pending'],
  approved: ['publishing'], publishing: ['approved', 'publish_failed', 'publish_uncertain', 'published'], publish_failed: ['approved'], publish_uncertain: ['approved', 'published'],
  published: [], rejected: [], refund_pending: ['refunded'], refunded: [],
};
