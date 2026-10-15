import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { ApiError, env } from '../tweet-orders/server';

export const FLOW_COOKIE = 'business-x-flow';
export const SESSION_COOKIE = 'business-x-session';
export const SESSION_TTL = 8 * 60 * 60;
export const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'];
export type BusinessSession = {
  type: 'credentials'; expires: number;
  account: { id: string; username: string; name: string };
  tokenExpiresAt: string; persisted: true; moderation: true;
};
export type BusinessFlow = { type: 'oauth'; expires: number; state: string; verifier: string };

export function businessOrigin() {
  const url = new URL(env('BUSINESS_APP_URL'));
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password)
    throw new ApiError('BUSINESS_APP_URL must be an origin without a path.', 503);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new ApiError('Business OAuth requires HTTPS.', 503);
  return url.origin;
}
export function landingUrl() {
  const origin = businessOrigin();
  return `${origin}${new URL(origin).hostname === 'business.lumenless.com' ? '/' : '/business'}`;
}
export function callbackUrl() { return `${businessOrigin()}/api/business/x/callback`; }
function encryptionKey() {
  const secret = env('BUSINESS_SESSION_SECRET');
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new ApiError('Business session encryption is not configured.', 503);
  return Buffer.from(secret, 'hex');
}
export function sealSession(value: BusinessSession | BusinessFlow) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from('lumenless-business-v1'));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const token = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  if (token.length > 3700) throw new ApiError('The X credentials are too large for this temporary session.', 502);
  return token;
}
export function openSession<T extends BusinessSession | BusinessFlow>(token: string | undefined, type: T['type']): T | null {
  if (!token || token.length > 3700) return null;
  try {
    const raw = Buffer.from(token, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28)); decipher.setAAD(Buffer.from('lumenless-business-v1'));
    const value = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
    if (value.type !== type || !Number.isFinite(value.expires) || value.expires <= Date.now()) return null;
    return value as T;
  } catch { return null; }
}
export function sessionCookie(response: NextResponse, name: string, value: string, maxAge: number) {
  response.cookies.set(name, value, { httpOnly: true, secure: businessOrigin().startsWith('https:'), sameSite: 'lax', path: '/', maxAge });
}
export function privateResponse(response: NextResponse) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
