import type { Metadata } from 'next';
import BusinessConnect from './BusinessConnect';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Lumenless Business — Connect your X account',
  description: 'Connect @lumenless and save your publishing connection automatically.',
  robots: { index: false, follow: false },
};
export default function BusinessPage() { return <BusinessConnect />; }
