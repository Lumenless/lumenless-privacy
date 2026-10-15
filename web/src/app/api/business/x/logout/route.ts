import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin, failure } from '@/lib/tweet-orders/server';
import { FLOW_COOKIE, privateResponse, SESSION_COOKIE, sessionCookie } from '@/lib/business/session';
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request); const response = NextResponse.json({ ok: true });
    sessionCookie(response, SESSION_COOKIE, '', 0); sessionCookie(response, FLOW_COOKIE, '', 0); return privateResponse(response);
  } catch (error) { return privateResponse(failure(error)); }
}
