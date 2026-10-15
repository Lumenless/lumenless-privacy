import { createClient } from '@supabase/supabase-js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { MEDIA_BUCKET, TweetOrder } from './model';

export class ApiError extends Error { constructor(message: string, public status = 400) { super(message); } }
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
  if (!session?.moderation || !session.persisted || session.account.username.toLowerCase() !== 'lumenless')
    throw new ApiError('Sign in to Business with @lumenless.', 401);
}
export async function order(id: string, request: NextRequest, admin = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError('Order not found.', 404);
  if (admin) await requireAdmin(request);
  const { data, error } = await db().from('tweet_orders').select('*').eq('id', id).maybeSingle();
  if (error) throw new ApiError('Could not load order.', 503);
  if (!data || (!admin && !same(hash(request.headers.get('x-order-token') || ''), data.token_hash)))
    throw new ApiError('Order not found.', 404);
  return data as TweetOrder;
}
export async function withMedia(value: TweetOrder) {
  const { token_hash: _token, payment_message_hash: _payment, refund_message_hash: _refund, swap_message_hash: _swap, swap_request_id: _request, ...safe } = value;
  void [_token, _payment, _refund, _swap, _request];
  const tweets = await Promise.all(value.tweets.map(async tweet => ({ ...tweet, media: await Promise.all(tweet.media.map(async file => {
    const { data, error } = await db().storage.from(MEDIA_BUCKET).createSignedUrl(file.path, 600);
    if (error) throw new ApiError('Could not load media.', 503);
    return { ...file, url: data.signedUrl };
  })) })));
  return { ...safe, tweets };
}
export function failure(error: unknown) {
  if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: 'The request failed. Please try again.' }, { status: 500 });
}
export async function notify(value: TweetOrder) {
  if (value.notification_sent_at) return;
  const token = env('TELEGRAM_BOT_TOKEN');
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ chat_id: env('TELEGRAM_ADMIN_CHAT_ID'), text:
      `New paid ${value.kind} for @lumenless\nOrder: ${value.id}\n${value.amount_tokens.toLocaleString('en-US')} LUMEN\n${env('BUSINESS_APP_URL')}/business/tweets`,
      link_preview_options: { is_disabled: true } }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new ApiError('Telegram notification could not be delivered.', 502);
  const { error } = await db().from('tweet_orders').update({ notification_sent_at: new Date().toISOString() }).eq('id', value.id);
  if (error) throw new ApiError('Could not save notification status.', 503);
}
