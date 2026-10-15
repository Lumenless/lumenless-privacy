import { NextRequest, NextResponse } from 'next/server';

import { clientIdentity, consumeLimit, requestLimit } from '@/lib/security/rate-limit';

export async function middleware(request: NextRequest) {
  const policy = requestLimit(request.nextUrl.pathname, request.method);
  if (policy) { const limited = await consumeLimit(`ip:${clientIdentity(request)}`, policy); if (limited) return limited; }
  const host = (request.headers.get('host') || '').split(':')[0].toLowerCase();
  const path = request.nextUrl.pathname;
  const businessHost = host === 'business.lumenless.com';
  const businessPath = path === '/business' || path.startsWith('/business/') || path.startsWith('/api/business/');
  // Normalize @ handles before Next.js interprets an @ segment as a parallel-route slot.
  if (!businessHost && /^\/u\/(?:@|%40)/i.test(path)) {
    const target = request.nextUrl.clone(); target.pathname = path.replace(/^\/u\/(?:@|%40)/i, '/u/');
    return NextResponse.rewrite(target);
  }
  if (!businessHost && !businessPath) { const headers = new Headers(request.headers); headers.delete('Content-Security-Policy'); return NextResponse.next({ request: { headers } }); }
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const mediaOrigin = (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').origin; } catch { return ''; } })();
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: ${mediaOrigin}; media-src 'self' ${mediaOrigin}; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
  const headers = new Headers(request.headers); headers.set('Content-Security-Policy', csp);
  let response: NextResponse;
  if (businessHost && path === '/') {
    const target = request.nextUrl.clone(); target.pathname = '/business';
    response = NextResponse.rewrite(target, { request: { headers } });
  } else if (businessHost && !businessPath) {
    response = new NextResponse('Not found', { status: 404 });
  } else response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)'] };
