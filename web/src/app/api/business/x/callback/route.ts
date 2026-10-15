import { NextRequest, NextResponse } from 'next/server';
import { env, same } from '@/lib/tweet-orders/server';
import { BusinessFlow, callbackUrl, FLOW_COOKIE, landingUrl, openSession, privateResponse, SCOPES, sealSession, SESSION_COOKIE, SESSION_TTL, sessionCookie } from '@/lib/business/session';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  const redirect = new URL(landingUrl());
  try {
    const flow = openSession<BusinessFlow>(request.cookies.get(FLOW_COOKIE)?.value, 'oauth');
    const state = request.nextUrl.searchParams.get('state') || '';
    if (!flow || !same(state, flow.state)) throw new Error('invalid_session');
    if (request.nextUrl.searchParams.has('error')) throw new Error('access_denied');
    const code = request.nextUrl.searchParams.get('code');
    if (!code) throw new Error('invalid_session');
    const tokenResponse = await fetch('https://api.x.com/2/oauth2/token', { method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${encodeURIComponent(env('X_CLIENT_ID'))}:${encodeURIComponent(env('X_CLIENT_SECRET'))}`).toString('base64')}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: flow.verifier, redirect_uri: callbackUrl() }) });
    if (!tokenResponse.ok) throw new Error('token_exchange_failed');
    const tokens = await tokenResponse.json();
    if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string'
      || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 || tokens.token_type?.toLowerCase() !== 'bearer'
      || typeof tokens.scope !== 'string' || SCOPES.some(scope => !tokens.scope.split(' ').includes(scope))) throw new Error('missing_permissions');
    const userResponse = await fetch('https://api.x.com/2/users/me', { signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!userResponse.ok) throw new Error('account_lookup_failed');
    const { data } = await userResponse.json();
    if (!/^\d+$/.test(data?.id) || typeof data.username !== 'string' || typeof data.name !== 'string') throw new Error('account_lookup_failed');
    const response = NextResponse.redirect(redirect);
    sessionCookie(response, SESSION_COOKIE, sealSession({ type: 'credentials', expires: Date.now() + SESSION_TTL * 1000,
      account: { id: data.id, username: data.username, name: data.name }, accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token, tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(), scope: tokens.scope }), SESSION_TTL);
    sessionCookie(response, FLOW_COOKIE, '', 0);
    return privateResponse(response);
  } catch (error) {
    const allowed = ['invalid_session', 'access_denied', 'token_exchange_failed', 'missing_permissions', 'account_lookup_failed'];
    redirect.searchParams.set('error', error instanceof Error && allowed.includes(error.message) ? error.message : 'connection_failed');
    const response = NextResponse.redirect(redirect); sessionCookie(response, FLOW_COOKIE, '', 0);
    return privateResponse(response);
  }
}
