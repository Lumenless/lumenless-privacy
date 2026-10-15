import { NextRequest, NextResponse } from 'next/server';
export type Limit = { name: string; limit: number; seconds: number };
export function requestLimit(path: string, method: string): Limit | null {
  if (path.startsWith('/api/cron/')) return null; // These endpoints require CRON_SECRET before doing work.
  if (path === '/api/business/x/start') return { name: 'oauth-start', limit: 10, seconds: 600 };
  if (path === '/api/business/x/callback') return { name: 'oauth-callback', limit: 20, seconds: 600 };
  if (path === '/api/tweet-orders' && method === 'POST') return { name: 'create-order', limit: 20, seconds: 600 };
  if (path.startsWith('/api/order-status/')) return { name: 'order-status', limit: 60, seconds: 60 };
  if (path.startsWith('/api/business/')) return { name: method === 'GET' ? 'business-read' : 'business-write', limit: method === 'GET' ? 120 : 60, seconds: 60 };
  if (path.startsWith('/api/tweet-orders/')) return { name: 'checkout', limit: 180, seconds: 60 };
  if (path.startsWith('/api/privacycash/')) return { name: 'privacy-api', limit: 30, seconds: 60 };
  if (path.startsWith('/api/')) return { name: 'api', limit: 60, seconds: 60 };
  return null;
}
export function clientIdentity(request: NextRequest) {
  // On Vercel this platform header is overwritten by the trusted edge, unlike arbitrary client headers.
  if (process.env.VERCEL === '1') return request.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim() || 'unknown';
  // Local tests/development are intentionally a shared bucket; never trust arbitrary X-Forwarded-For.
  return 'local';
}
export async function consumeLimit(subject: string, policy: Limit): Promise<NextResponse | null> {
  const secret = process.env.X_TOKEN_ENCRYPTION_KEY;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL; const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const unavailable = () => NextResponse.json({ error: 'Security service is temporarily unavailable. Please retry.' }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '10' } });
  if (!secret || !base || !serviceKey) return unavailable();
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${policy.name}:${subject}`));
    const bucket = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const response = await fetch(`${base}/rest/v1/rpc/consume_api_rate_limit`, { method: 'POST', signal: AbortSignal.timeout(3000), headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_key: bucket, p_limit: policy.limit, p_seconds: policy.seconds }) });
    if (!response.ok) return unavailable();
    const result = await response.json();
    if (typeof result.allowed !== 'boolean' || !Number.isFinite(result.retryAfter)) return unavailable();
    return result.allowed ? null : NextResponse.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil(result.retryAfter))), 'Cache-Control': 'no-store' } });
  } catch { return unavailable(); }
}
