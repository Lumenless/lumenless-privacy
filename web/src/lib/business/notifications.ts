import { ApiError, db, env } from '../tweet-orders/server';
import { TweetOrder } from '../tweet-orders/model';
import { orderTerms } from '../tweet-orders/billing';
import { sendTelegram } from './telegram';
export async function notifyOrder(value: TweetOrder) {
  if (value.notification_sent_at && value.owner_notification_done) return;
  if (!value.payment_signature) throw new ApiError('This order is unpaid.',409);
  const mainChat = env('TELEGRAM_ADMIN_CHAT_ID');
  const text = `New paid ${value.kind} for @${value.target_username || 'lumenless'}\nOrder: ${value.id}\n${orderTerms(value).amount} ${orderTerms(value).symbol}\n${env('BUSINESS_APP_URL')}/business/tweets`;
  const main = (async () => {
    if(value.notification_sent_at)return;
    await sendTelegram(mainChat,text);
    const {error}=await db().from('tweet_orders').update({notification_sent_at:new Date().toISOString()}).eq('id',value.id);
    if(error)throw new ApiError('Could not save notification status.',503);
  })();
  const owner = (async () => {
    if(value.owner_notification_done)return;
    let accountId=value.target_x_user_id;
    if(!accountId && (!value.target_username || value.target_username==='lumenless')){
      const {data,error}=await db().from('business_x_accounts').select('x_user_id').eq('username','lumenless').maybeSingle();
      if(error)throw new ApiError('Could not load notification recipient.',503);
      accountId=data?.x_user_id;
    }
    if(accountId){
      const {data,error}=await db().from('business_telegram').select('chat_id').eq('x_user_id',accountId).maybeSingle();
      if(error)throw new ApiError('Could not load notification recipient.',503);
      if(data?.chat_id){
        if(data.chat_id===mainChat)await main;
        else await sendTelegram(data.chat_id,text);
      }
    }
    const {error}=await db().from('tweet_orders').update({owner_notification_done:true}).eq('id',value.id);
    if(error)throw new ApiError('Could not save owner notification status.',503);
  })();
  // A blocked personal bot chat must not prevent delivery to the platform, or vice versa.
  const results=await Promise.allSettled([main,owner]);
  if(results.some(result=>result.status==='rejected'))throw new ApiError('Some Telegram notifications could not be delivered. Please retry.',502);
}
