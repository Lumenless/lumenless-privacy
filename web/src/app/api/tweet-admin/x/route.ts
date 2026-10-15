import { createHash, createHmac, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin, env, failure, requireAdmin } from '@/lib/tweet-orders/server';
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request); requireAdmin(request);
    const state = randomBytes(32).toString('hex'); const verifier = randomBytes(32).toString('base64url');
    const redirect = `${env('APP_URL')}/api/tweet-admin/x/callback`;
    const url = `https://x.com/i/oauth2/authorize?${new URLSearchParams({ response_type: 'code', client_id: env('X_CLIENT_ID'), redirect_uri: redirect,
      scope: 'tweet.read tweet.write users.read media.write offline.access', state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })}`;
    const response = NextResponse.json({ url });
    const options = { httpOnly: true, sameSite: 'lax' as const, secure: new URL(env('APP_URL')).protocol === 'https:', maxAge: 600, path: '/api/tweet-admin/x/callback' };
    const seal = createHmac('sha256', env('TWEET_ADMIN_TOKEN')).update(`${state}:${verifier}`).digest('hex');
    response.cookies.set('tweet-x-state', `${state}.${seal}`, options); response.cookies.set('tweet-x-verifier', verifier, options);
    return response;
  } catch (error) { return failure(error); }
}
