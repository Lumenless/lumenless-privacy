import { BILLING_COLUMNS, DEFAULT_BILLING, type Billing } from '../tweet-orders/billing';
import { ApiError, db } from '../tweet-orders/server';
export function profileImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'pbs.twimg.com' && !url.username && !url.password && !url.port ? url.toString() : null; } catch { return null; }
}
export function normalizeUsername(value: string) {
  const username = value.replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(username)) throw new ApiError('Invalid X username.', 400);
  return username;
}
export async function storefront(value: string) {
  const username = normalizeUsername(value);
  const { data, error } = await db().from('business_x_accounts').select(`x_user_id,username,name,profile_image_url,payout_wallet,escrow_address,${BILLING_COLUMNS}`).eq('username', username).maybeSingle();
  if (error) throw new ApiError('Account directory is unavailable.', 503);
  if (data) return { ...data, payment_recipient: data.escrow_address || data.payment_recipient, profile_image_url: profileImageUrl(data.profile_image_url) } as { x_user_id: string; username: string; name: string; profile_image_url: string | null; payout_wallet: string | null; escrow_address: string | null } & Billing;
  if (username === 'lumenless') {
    const legacy = await db().from('tweet_x_credentials').select('id').eq('id', 1).maybeSingle();
    if (!legacy.error && legacy.data) return { ...DEFAULT_BILLING, x_user_id: null, username, name: 'Lumenless', profile_image_url: null, payout_wallet: null, escrow_address: null };
  }
  throw new ApiError('This X account has not connected to Lumenless Business yet.', 404);
}
