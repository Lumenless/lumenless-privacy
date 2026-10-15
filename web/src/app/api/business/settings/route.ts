import { NextRequest, NextResponse } from 'next/server';
import { ApiError, checkOrigin, db, failure, requireAdmin } from '@/lib/tweet-orders/server';
import { privateResponse } from '@/lib/business/session';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const session = await requireAdmin(request);
    const { data, error } = await db().from('business_x_accounts').select('paid_partnership').eq('x_user_id', session.account.id).maybeSingle();
    if (error) throw new ApiError('Could not load account settings.', 503);
    if (!data) throw new ApiError('Reconnect your X account to configure publishing.', 409);
    return privateResponse(NextResponse.json({ paidPartnership: data.paid_partnership }));
  } catch(error) { return privateResponse(failure(error)); }
}
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const session = await requireAdmin(request);
    const body = await request.json();
    if (typeof body.paidPartnership !== 'boolean') throw new ApiError('Choose whether to label paid partnerships.');
    const { data, error } = await db().from('business_x_accounts').update({ paid_partnership: body.paidPartnership, updated_at: new Date().toISOString() }).eq('x_user_id', session.account.id).select('paid_partnership').maybeSingle();
    if (error) throw new ApiError('Could not save account settings.', 503);
    if (!data) throw new ApiError('Reconnect your X account to configure publishing.', 409);
    return privateResponse(NextResponse.json({ paidPartnership: data.paid_partnership }));
  } catch(error) { return privateResponse(failure(error)); }
}
