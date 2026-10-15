import { createClient } from '@supabase/supabase-js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { MEDIA_BUCKET, TweetOrder } from './model';

export class ApiError extends Error { constructor(message: string, public status = 400, public retryAfter?: number) { super(message); } }
export function env(name: string) {
  const value = process.env[name];
  if (!value) throw new ApiError(`Service unavailable: ${name} is not configured.`, 503);
  return value;
}
export function db() {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function same(a: string, b: string) { return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b))); }
export function checkOrigin(request: NextRequest) {
  const url = new URL(request.url);
  // NextRequest normalizes loopback URLs to localhost; the actual Host preserves 127.0.0.1.
  const origin = `${url.protocol}//${request.headers.get('host') || url.host}`;
  if (request.headers.get('origin') !== origin) throw new ApiError('Invalid request origin.', 403);
}
export async function requireAdmin(request: NextRequest) {
  const { businessOrigin, openSession, SESSION_COOKIE } = await import('../business/session');
  const url = new URL(request.url);
  const origin = `${url.protocol}//${request.headers.get('host') || url.host}`;
  if (origin !== businessOrigin()) throw new ApiError('Use Lumenless Business to moderate orders.', 403);
  const session = openSession<import('../business/session').BusinessSession>(request.cookies.get(SESSION_COOKIE)?.value, 'credentials');
  if (!session?.moderation || !session.persisted || !/^\d+$/.test(session.account.id))
    throw new ApiError('Sign in to Lumenless Business with X.', 401);
  const { consumeLimit } = await import('../security/rate-limit');
  const limited = await consumeLimit(`account:${session.account.id}`, { name: request.method === 'GET' ? 'account-read' : 'account-write', limit: request.method === 'GET' ? 240 : 120, seconds: 60 });
  if (limited) throw new ApiError(limited.status === 429 ? 'Too many requests. Please retry shortly.' : 'Security service is temporarily unavailable.', limited.status, Number(limited.headers.get('Retry-After') || '10'));
  return session;
}
export function accountOwnsOrder(account: { id: string; username: string }, value: Pick<TweetOrder, 'target_x_user_id' | 'target_username'>) {
  return value.target_x_user_id === account.id || (!value.target_x_user_id && value.target_username === 'lumenless' && account.username.toLowerCase() === 'lumenless');
}
export async function order(id: string, request: NextRequest, admin = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError('Order not found.', 404);
  const adminSession = admin ? await requireAdmin(request) : null;
  const { data, error } = await db().from('tweet_orders').select('*').eq('id', id).maybeSingle();
  if (error) throw new ApiError('Could not load order.', 503);
  if (adminSession && data && !accountOwnsOrder(adminSession.account, data)) throw new ApiError('Order not found.', 404);
  if (!data || (!admin && !same(hash(request.headers.get('x-order-token') || ''), data.token_hash)))
    throw new ApiError('Order not found.', 404);
  return data as TweetOrder;
}
export async function withMedia(value: TweetOrder) {
  const { token_hash: _token, payment_message_hash: _payment, refund_message_hash: _refund, swap_message_hash: _swap, swap_request_id: _request, settlement_raw: _settlement, settlement_message_hash: _settlementMessage, ...safe } = value;
  void [_token, _payment, _refund, _swap, _request, _settlement, _settlementMessage];
  const tweets = await Promise.all(value.tweets.map(async tweet => ({ ...tweet, media: await Promise.all(tweet.media.map(async file => {
    const { data, error } = await db().storage.from(MEDIA_BUCKET).createSignedUrl(file.path, 600);
    if (error) throw new ApiError('Could not load media.', 503);
    return { ...file, url: data.signedUrl };
  })) })));
  return { ...safe, tweets };
}
export function failure(error: unknown) {
  if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status, headers: error.retryAfter ? { 'Retry-After': String(error.retryAfter), 'Cache-Control': 'no-store' } : undefined });
  return NextResponse.json({ error: 'The request failed. Please try again.' }, { status: 500 });
}
export async function notify(value: TweetOrder) {
  const { notifyOrder } = await import('../business/notifications');
  await notifyOrder(value);
}
