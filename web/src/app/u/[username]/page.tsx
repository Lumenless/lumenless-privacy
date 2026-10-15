import Checkout from '@/app/Checkout';
import { storefront } from '@/lib/business/accounts';
import { notFound } from 'next/navigation';
import { ApiError } from '@/lib/tweet-orders/server';
export const dynamic = 'force-dynamic';
export default async function AccountPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  try { const account = await storefront(username); return <Checkout username={account.username} />; }
  catch(error) { if (error instanceof ApiError && [400,404].includes(error.status)) notFound(); throw error; }
}
