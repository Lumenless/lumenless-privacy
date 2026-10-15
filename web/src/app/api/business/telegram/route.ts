import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ApiError, checkOrigin, db, failure, hash, requireAdmin } from '@/lib/tweet-orders/server';
import { privateResponse } from '@/lib/business/session';
import { consumeLimit } from '@/lib/security/rate-limit';
import { ensureTelegramWebhook, sendTelegram } from '@/lib/business/telegram';
export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
  try{
    const session=await requireAdmin(request);
    const {data,error}=await db().from('business_telegram').select('chat_id,telegram_username,connected_at').eq('x_user_id',session.account.id).maybeSingle();
    if(error)throw new ApiError('Could not load Telegram settings. Please retry.',503);
    return privateResponse(NextResponse.json({connected:!!data?.chat_id,username:data?.telegram_username||null,connectedAt:data?.connected_at||null}));
  }catch(error){return privateResponse(failure(error));}
}
export async function POST(request:NextRequest){
  try{
    checkOrigin(request);const session=await requireAdmin(request);const body=await request.json();const client=db();
    if(['connect','test'].includes(body.action)){const limited=await consumeLimit(`telegram:${session.account.id}`,{name:`telegram-${body.action}`,limit:body.action==='connect'?6:3,seconds:body.action==='connect'?600:60});if(limited)return privateResponse(limited);}
    if(body.action==='connect'){
      const bot=await ensureTelegramWebhook();
      const token=randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+10*60_000).toISOString();
      // Upsert only the challenge fields; keep the active recipient until linking succeeds.
      const {error}=await client.from('business_telegram').upsert({x_user_id:session.account.id,link_hash:hash(token),link_expires_at:expiresAt},{onConflict:'x_user_id'});
      if(error)throw new ApiError('Could not create a Telegram connection. Please retry.',503);
      return privateResponse(NextResponse.json({url:`https://t.me/${bot}?start=link_${token}`,expiresAt}));
    }
    if(body.action==='disconnect'){
      const {error}=await client.from('business_telegram').delete().eq('x_user_id',session.account.id);
      if(error)throw new ApiError('Could not disconnect Telegram. Please retry.',503);
      return privateResponse(NextResponse.json({ok:true}));
    }
    if(body.action==='test'){
      const {data,error}=await client.from('business_telegram').select('chat_id').eq('x_user_id',session.account.id).maybeSingle();
      if(error)throw new ApiError('Could not load Telegram settings.',503);
      if(!data?.chat_id)throw new ApiError('Connect Telegram first.',409);
      await sendTelegram(data.chat_id,`Telegram notifications are active for @${session.account.username}. New paid orders will appear here.\nhttps://business.lumenless.com/business/tweets`);
      return privateResponse(NextResponse.json({ok:true}));
    }
    throw new ApiError('Choose a Telegram action.');
  }catch(error){return privateResponse(failure(error));}
}
