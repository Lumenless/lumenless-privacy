import { ApiError, db } from '../tweet-orders/server';
export function normalizeUsername(value: string) {
  const username = value.replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(username)) throw new ApiError('Invalid X username.', 400);
  return username;
}
export async function storefront(value: string) {
  const username = normalizeUsername(value);
  const { data, error } = await db().from('business_x_accounts').select('x_user_id,username,name').eq('username', username).maybeSingle();
  if (error) throw new ApiError('Account directory is unavailable.', 503);
  if (data) return data as { x_user_id: string; username: string; name: string };
  if (username === 'lumenless') {
    const legacy = await db().from('tweet_x_credentials').select('id').eq('id', 1).maybeSingle();
    if (!legacy.error && legacy.data) return { x_user_id: null, username, name: 'Lumenless' };
  }
  throw new ApiError('This X account has not connected to Lumenless Business yet.', 404);
}
