import { createHash, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin, env, failure } from '@/lib/tweet-orders/server';
import { businessOrigin, callbackUrl, FLOW_COOKIE, privateResponse, SCOPES, sealSession, sessionCookie } from '@/lib/business/session';

export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    if (request.headers.get('origin') !== businessOrigin()) return privateResponse(NextResponse.json({ error: 'Use the configured business domain.' }, { status: 403 }));
    env('X_CLIENT_SECRET');
    const state = randomBytes(32).toString('hex'); const verifier = randomBytes(32).toString('base64url');
    const url = `https://x.com/i/oauth2/authorize?${new URLSearchParams({ response_type: 'code', client_id: env('X_CLIENT_ID'),
      redirect_uri: callbackUrl(), scope: SCOPES.join(' '), state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })}`;
    const response = NextResponse.json({ url });
    sessionCookie(response, FLOW_COOKIE, sealSession({ type: 'oauth', state, verifier, expires: Date.now() + 600_000 }), 600);
    return privateResponse(response);
  } catch (error) { return privateResponse(failure(error)); }
}
