import type { Metadata } from 'next';
import BusinessConnect from './BusinessConnect';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Lumenless Business — Earn from your X audience',
  description: 'Sell paid tweets and threads on your terms. Set your rates, receive upfront payments in escrow, and publish approved posts automatically.',
  robots: { index: false, follow: false },
};
export default function BusinessPage() { return <BusinessConnect />; }
