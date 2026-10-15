import { NextRequest, NextResponse } from 'next/server';
import { BusinessSession, openSession, privateResponse, SESSION_COOKIE } from '@/lib/business/session';
export async function GET(request: NextRequest) {
  const session = openSession<BusinessSession>(request.cookies.get(SESSION_COOKIE)?.value, 'credentials');
  return privateResponse(NextResponse.json({ configured: !!process.env.X_CLIENT_ID && !!process.env.X_CLIENT_SECRET && !!process.env.BUSINESS_SESSION_SECRET && !!process.env.BUSINESS_APP_URL && !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    account: session?.persisted && session.moderation && session.account.username.toLowerCase() === 'lumenless' ? session.account : null, sessionExpiresAt: session?.expires || null, tokenExpiresAt: session?.tokenExpiresAt || null }));
}
