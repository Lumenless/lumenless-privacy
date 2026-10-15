import { NextRequest, NextResponse } from 'next/server';
import { LUMEN_MINT } from '@/lib/tweet-orders/model';
import { TREASURY } from '@/lib/tweet-orders/payments';
import { storefront } from '@/lib/business/accounts';
import { failure } from '@/lib/tweet-orders/server';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const target = await storefront(request.nextUrl.searchParams.get('username') || 'lumenless');
    const required = ['NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SOLANA_MAINNET_RPC_URL','TELEGRAM_BOT_TOKEN','TELEGRAM_ADMIN_CHAT_ID','X_CLIENT_ID','X_CLIENT_SECRET','BUSINESS_APP_URL','BUSINESS_SESSION_SECRET','X_TOKEN_ENCRYPTION_KEY','ESCROW_ENCRYPTION_KEY'];
    const { tweet_price, thread_price, payment_asset, payment_mint, payment_symbol, payment_decimals, payment_recipient, ...account } = target;
    const billing = { tweet_price, thread_price, payment_asset, payment_mint, payment_symbol, payment_decimals, payment_recipient };
    return NextResponse.json({billing, ready: !!target.escrow_address && !!target.payout_wallet && required.every(name => !!process.env[name]), solEnabled: !!process.env.JUPITER_API_KEY, mint:LUMEN_MINT,treasury:TREASURY,account}, {headers:{'Cache-Control':'no-store'}});
  } catch(error) { return failure(error); }
}
