import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';
import { ApiError, db, env, failure, same } from '@/lib/tweet-orders/server';
export async function GET(request: NextRequest) {
  try {
    const [state, seal] = (request.cookies.get('tweet-x-state')?.value || '').split('.'); const verifier = request.cookies.get('tweet-x-verifier')?.value;
    const code = request.nextUrl.searchParams.get('code');
    if (!state || !seal || !verifier || !code || !same(state, request.nextUrl.searchParams.get('state') || '')
      || !same(seal, createHmac('sha256', env('TWEET_ADMIN_TOKEN')).update(`${state}:${verifier}`).digest('hex'))) throw new ApiError('X authorization session expired.', 401);
    const response = await fetch('https://api.x.com/2/oauth2/token', { method: 'POST', signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${encodeURIComponent(env('X_CLIENT_ID'))}:${encodeURIComponent(env('X_CLIENT_SECRET'))}`).toString('base64')}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: `${env('APP_URL')}/api/tweet-admin/x/callback` }) });
    if (!response.ok) throw new ApiError('Could not authorize X.', 502);
    const credentials = await response.json();
    const accountResponse = await fetch('https://api.x.com/2/users/me', { headers: { Authorization: `Bearer ${credentials.access_token}` }, signal: AbortSignal.timeout(10_000) });
    const account = await accountResponse.json();
    if (!accountResponse.ok || account.data?.username?.toLowerCase() !== 'lumenless') throw new ApiError('Authorize the @lumenless account.', 400);
    if (!credentials.access_token || !credentials.refresh_token || !credentials.expires_in) throw new ApiError('X did not grant offline access.', 502);
    const { error } = await db().from('tweet_x_credentials').upsert({ id: 1, access_token: credentials.access_token,
      refresh_token: credentials.refresh_token, expires_at: new Date(Date.now() + credentials.expires_in * 1000).toISOString(), lock_until: '1970-01-01' });
    if (error) throw new ApiError('Could not save X connection.', 503);
    const result = NextResponse.redirect(`${env('APP_URL')}/admin/tweets`);
    result.cookies.delete('tweet-x-state'); result.cookies.delete('tweet-x-verifier'); return result;
  } catch (error) { return failure(error); }
}
