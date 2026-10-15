import { redirect } from 'next/navigation';
import { env } from '@/lib/tweet-orders/server';
export default function RetiredAdmin() { redirect(`${env('BUSINESS_APP_URL')}/business/tweets`); }
