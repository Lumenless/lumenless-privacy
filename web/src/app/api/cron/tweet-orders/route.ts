import { NextRequest, NextResponse } from 'next/server';
import { ApiError, db, env, failure, notify, same } from '@/lib/tweet-orders/server';
import { publish } from '@/lib/tweet-orders/x';

export const runtime = 'nodejs';
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  try {
    if (!same(request.headers.get('authorization') || '', `Bearer ${env('CRON_SECRET')}`)) throw new ApiError('Unauthorized.', 401);
    const client = db();
    await client.rpc('prune_api_rate_limits');
    const notifications = await client.from('tweet_orders').select('*').not('payment_signature', 'is', null).or('notification_sent_at.is.null,owner_notification_done.eq.false').limit(5);
    const publications = await client.from('tweet_orders').select('id').eq('status', 'approved').order('created_at').limit(1);
    if (notifications.error || publications.error) throw new ApiError('Queue unavailable.', 503);
    let notified = 0; let published = 0; let failed = 0;
    for (const value of notifications.data || []) { try { await notify(value); notified++; } catch { failed++; } }
    for (const value of publications.data || []) { try { await publish(value.id); published++; } catch { failed++; } }
    return NextResponse.json({ notified, processed: published, failed });
  } catch (error) { return failure(error); }
}
