import { NextRequest, NextResponse } from 'next/server';
import { ApiError, db, failure, hash, same } from '@/lib/tweet-orders/server';
import { sendTelegram, telegramWebhookSecret } from '@/lib/business/telegram';
export const runtime='nodejs';
export const maxDuration=30;
export async function POST(request:NextRequest){
  try{
    // Authenticate before parsing the body or touching the database. Never trust a chat ID from the browser.
    if(!same(request.headers.get('x-telegram-bot-api-secret-token')||'',telegramWebhookSecret()))throw new ApiError('Unauthorized.',401);
    const raw=await request.text();if(Buffer.byteLength(raw)>20000)throw new ApiError('Update is too large.',413);
    const update=JSON.parse(raw),message=update.message;
    if(!message||message.chat?.type!=='private'||message.from?.is_bot||!Number.isSafeInteger(message.chat?.id)||message.chat.id<=0||message.from?.id!==message.chat.id)return NextResponse.json({ok:true});
    const match=typeof message.text==='string'&&/^\/start(?:@\w+)? link_([A-Za-z0-9_-]{43})$/.exec(message.text.trim());
    if(!match)return NextResponse.json({ok:true});
    const username=typeof message.from.username==='string'&&/^\w{1,32}$/.test(message.from.username)?message.from.username:null;
    const {data,error}=await db().rpc('connect_business_telegram',{p_hash:hash(match[1]),p_chat:String(message.chat.id),p_username:username});
    if(error)throw new ApiError('Could not save Telegram connection.',503);
    if(data?.length){
      // Linking is committed even if the optional confirmation cannot be delivered.
      try{await sendTelegram(String(message.chat.id),'Telegram connected. You will receive new paid orders for your X account here. Return to Lumenless Business to check the connection.');}catch{/* Business can verify connection without a message. */}
    }
    return NextResponse.json({ok:true});
  }catch(error){return failure(error);}
}
