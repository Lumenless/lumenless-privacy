import type { Metadata } from 'next';
import BusinessConnect from './BusinessConnect';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Lumenless Business — Connect your X account',
  description: 'Authorize your X account and export your publishing credentials.',
  robots: { index: false, follow: false },
};
export default function BusinessPage() { return <BusinessConnect />; }
