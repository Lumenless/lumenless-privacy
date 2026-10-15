import ModerationQueue from './ModerationQueue';

// Per-request rendering lets Next.js attach the middleware CSP nonce to scripts.
export const dynamic = 'force-dynamic';
export default function BusinessTweetsPage() { return <ModerationQueue />; }
