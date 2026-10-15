import { NextRequest, NextResponse } from 'next/server';
import { ApiError, db, failure } from '@/lib/tweet-orders/server';
export const dynamic = 'force-dynamic';
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new ApiError('Enter a valid Order ID.', 400);
    // Public lookup deliberately excludes content, contact details, wallet and internal notes.
    const { data, error } = await db().from('tweet_orders').select('id,status,created_at,updated_at,published_ids,target_username').eq('id', id).maybeSingle();
    if (error) throw new ApiError('Could not check your order. Please try again.', 503);
    if (!data) throw new ApiError('Order not found. Check the ID and try again.', 404);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { const response = failure(error); response.headers.set('Cache-Control', 'private, no-store'); return response; }
}
