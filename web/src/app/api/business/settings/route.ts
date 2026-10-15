import { NextRequest, NextResponse } from 'next/server';
import { ApiError, checkOrigin, db, failure, requireAdmin } from '@/lib/tweet-orders/server';
import { privateResponse } from '@/lib/business/session';
import { BILLING_COLUMNS } from '@/lib/tweet-orders/billing';
import { validatedPricing } from '@/lib/business/pricing';
import { createEscrow } from '@/lib/business/escrow-keys';
export const dynamic = 'force-dynamic';
const columns = `paid_partnership,payout_wallet,escrow_address,${BILLING_COLUMNS}`;
export async function GET(request: NextRequest) {
  try {
    const session = await requireAdmin(request);
    const { data, error } = await db().from('business_x_accounts').select(columns).eq('x_user_id', session.account.id).maybeSingle();
    if (error) throw new ApiError('Could not load account settings.', 503);
    if (!data) throw new ApiError('Reconnect your X account to configure publishing.', 409);
    return privateResponse(NextResponse.json({ paidPartnership:data.paid_partnership, billing:data }));
  } catch(error) { return privateResponse(failure(error)); }
}
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request); const session = await requireAdmin(request); const body = await request.json();
    if (typeof body.paidPartnership !== 'boolean') throw new ApiError('Choose whether to label paid partnerships.');
    const client = db(); let pricing = {};
    if (body.tweetPrice !== undefined) {
      pricing = await validatedPricing(body);
      const existing = await client.from('business_x_accounts').select('escrow_address').eq('x_user_id',session.account.id).single();
      if (existing.error) throw new ApiError('Could not load escrow.',503);
      let address = existing.data.escrow_address;
      if (!address) {
        const wallet = createEscrow(session.account.id);
        const created = await client.from('business_x_accounts').update({escrow_address:wallet.address,escrow_secret:wallet.secret,payment_recipient:wallet.address}).eq('x_user_id',session.account.id).is('escrow_address',null).select('escrow_address').maybeSingle();
        if (created.error) throw new ApiError('Could not initialize escrow.',503);
        if (created.data) address = created.data.escrow_address;
        else { const current = await client.from('business_x_accounts').select('escrow_address').eq('x_user_id',session.account.id).single(); address=current.data?.escrow_address; }
      }
      if (!address) throw new ApiError('Escrow is not available.',503);
      if (body.payoutWallet === address) throw new ApiError('Receiving wallet must be different from escrow.');
      pricing = {...pricing,payment_recipient:address};
    }
    const { data, error } = await client.from('business_x_accounts').update({ ...pricing, paid_partnership:body.paidPartnership, updated_at:new Date().toISOString() }).eq('x_user_id',session.account.id).select(columns).maybeSingle();
    if (error) throw new ApiError('Could not save account settings.',503);
    if (!data) throw new ApiError('Reconnect your X account to configure publishing.',409);
    return privateResponse(NextResponse.json({ paidPartnership:data.paid_partnership,billing:data }));
  } catch(error) { return privateResponse(failure(error)); }
}
