import { NextRequest, NextResponse } from 'next/server';
import { ApiError, checkOrigin, failure } from '@/lib/tweet-orders/server';
import { BusinessSession, envExport, openSession, privateResponse, SESSION_COOKIE } from '@/lib/business/session';
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const session = openSession<BusinessSession>(request.cookies.get(SESSION_COOKIE)?.value, 'credentials');
    if (!session) throw new ApiError('Your session expired. Connect X again.', 401);
    return privateResponse(NextResponse.json({ env: envExport(session) }));
  } catch (error) { return privateResponse(failure(error)); }
}
