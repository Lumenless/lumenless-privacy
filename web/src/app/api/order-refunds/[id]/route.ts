import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, checkOrigin, db, failure } from '@/lib/tweet-orders/server';
import { assertBuyerRefund, assertRefundAuthorization, claimReviewRefund } from '@/lib/tweet-orders/review-refund';
import { prepareSettlement, broadcastSettlement, verifySettlement, resetSettlement } from '@/lib/tweet-orders/escrow';
import { consumeLimit } from '@/lib/security/rate-limit';
export const runtime = 'nodejs';
export const maxDuration = 60;
const schema = z.object({
  action:z.enum(['prepare','broadcast','verify','reset']), signedTransaction:z.string().max(10000).optional(),
  authorization:z.object({wallet:z.string().min(32).max(44),timestamp:z.number().int(),nonce:z.string().uuid(),signature:z.string().max(100)}),
});
const json = (value: unknown) => NextResponse.json(value,{headers:{'Cache-Control':'private, no-store'}});
export async function POST(request: NextRequest, context: {params:Promise<{id:string}>}) {
  try {
    checkOrigin(request); const {id} = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new ApiError('Enter a valid Order ID.');
    const raw = await request.text(); if (Buffer.byteLength(raw) > 15000) throw new ApiError('Refund request is too large.',413);
    const parsed = schema.safeParse(JSON.parse(raw)); if (!parsed.success) throw new ApiError('Invalid refund request. Reconnect your paying wallet.');
    const body = parsed.data; assertRefundAuthorization(id,body.authorization);
    const limited = await consumeLimit(`buyer-refund:${body.authorization.wallet}`,{name:'buyer-refund',limit:60,seconds:60}); if (limited) return limited;
    const {data,error} = await db().from('tweet_orders').select('*').eq('id',id).maybeSingle();
    if (error) throw new ApiError('Could not load your order.',503);
    if (!data || data.wallet !== body.authorization.wallet) throw new ApiError('Connect the wallet that paid for this order.',403);
    if (body.action === 'prepare') {
      const value = await claimReviewRefund(data);
      if (value.settled_at) return json({settled:true});
      if (value.settlement_signature) return json({pending:true,signature:value.settlement_signature});
      return json(await prepareSettlement(value,'refund'));
    }
    assertBuyerRefund(data);
    if (body.action === 'broadcast') {
      if (typeof body.signedTransaction !== 'string') throw new ApiError('Signed refund transaction is required.');
      return json(await broadcastSettlement(data,body.signedTransaction));
    }
    if (body.action === 'verify') return json(await verifySettlement(data));
    await resetSettlement(data); return json({ok:true});
  } catch(error) { const response=failure(error);response.headers.set('Cache-Control','private, no-store');return response; }
}
