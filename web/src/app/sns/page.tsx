import { redirect } from 'next/navigation';
// The legacy SNS client used NEXT_PUBLIC private keys. Keep it out of browser builds.
export default function SnsPage() { redirect('/'); }
