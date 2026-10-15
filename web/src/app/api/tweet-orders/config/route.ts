import { NextResponse } from 'next/server';
import { LUMEN_MINT } from '@/lib/tweet-orders/model';
import { TREASURY } from '@/lib/tweet-orders/payments';
import { db } from '@/lib/tweet-orders/server';
export async function GET() {
  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SOLANA_MAINNET_RPC_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID', 'X_CLIENT_ID', 'X_CLIENT_SECRET', 'TWEET_ADMIN_TOKEN', 'APP_URL'];
  let connected = false;
  try { const { data, error } = await db().from('tweet_x_credentials').select('id').eq('id', 1).maybeSingle(); connected = !error && (!!data || !!process.env.X_REFRESH_TOKEN); } catch { /* setup not complete */ }
  return NextResponse.json({ ready: connected && required.every(name => !!process.env[name]), solEnabled: !!process.env.JUPITER_API_KEY, mint: LUMEN_MINT, treasury: TREASURY });
}
