import { createHmac } from 'node:crypto';
import { ApiError, env } from '../tweet-orders/server';
import { businessOrigin } from './session';
export function telegramWebhookSecret() {
  return createHmac('sha256',env('TELEGRAM_BOT_TOKEN')).update('lumenless:telegram-webhook:v1').digest('hex');
}
export async function telegramCall(method: 'sendMessage'|'getMe'|'getWebhookInfo'|'setWebhook', body: Record<string,unknown> = {}) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/${method}`, {
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000),cache:'no-store',
    });
    const result = await response.json();
    if(!response.ok||!result.ok) throw new Error('Telegram rejected request');
    return result.result;
  } catch { throw new ApiError('Telegram is unavailable. Please retry; if you blocked the bot, unblock it first.',502); }
}
export async function ensureTelegramWebhook() {
  const origin = businessOrigin();
  if(!origin.startsWith('https://'))throw new ApiError('Connect Telegram from the production Business website.',503);
  const url = `${origin}/api/business/telegram/webhook`;
  const current = await telegramCall('getWebhookInfo');
  if(current.url && current.url !== url)throw new ApiError('The bot has a different webhook configured. Contact Lumenless support.',503);
  // Refresh the secret even for our URL, so bot-token rotation is recoverable.
  await telegramCall('setWebhook',{url,secret_token:telegramWebhookSecret(),allowed_updates:['message'],drop_pending_updates:false});
  const bot=await telegramCall('getMe');
  if(typeof bot.username!=='string'||!/^\w{5,32}$/.test(bot.username))throw new ApiError('Telegram bot configuration is invalid.',503);
  return bot.username as string;
}
export async function sendTelegram(chatId: string,text: string) {
  await telegramCall('sendMessage',{chat_id:chatId,text,link_preview_options:{is_disabled:true}});
}
