'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { jsonRequest } from '@/lib/tweet-orders/wallet';
type Status = { id: string; status: string; target_username: string; updated_at: string; published_ids: string[] };
const descriptions: Record<string, string> = {
  awaiting_payment: 'Payment has not been confirmed yet.', pending_review: 'Payment confirmed. Your order is waiting for review.',
  approved: 'Your order is approved and queued for publication.', publishing: 'Your posts are being published.',
  publish_failed: 'Publication needs attention from our team.', publish_uncertain: 'Our team is checking the publication result.',
  published: 'Your content has been published.', rejected: 'Your order was rejected without a refund.',
  refund_pending: 'Your order was rejected and a LUMEN refund is pending.', refunded: 'Your LUMEN refund has been confirmed.',
};
export default function OrderStatus() {
  const [id, setId] = useState(''); const [result, setResult] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function lookup(value: string) {
    setBusy(true); setError(''); setResult(null);
    try { const data = await jsonRequest(`/api/order-status/${encodeURIComponent(value.trim())}`, { cache: 'no-store' }); setResult(data); window.history.replaceState(null, '', `/orders?id=${encodeURIComponent(data.id)}`); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not check order.'); } finally { setBusy(false); }
  }
  useEffect(() => { const value = new URLSearchParams(window.location.search).get('id'); if (value) { setId(value); void lookup(value); } }, []);
  return <main className="mx-auto min-h-screen max-w-2xl px-6 py-12 text-foreground"><Link href="/" className="text-sm text-primary">← Lumenless</Link><h1 className="mt-8 text-3xl font-semibold">Check your order</h1><p className="mt-3 text-muted-foreground">Enter the Order ID you received after creating your order.</p>
    <form className="mt-8 space-y-4" onSubmit={event => { event.preventDefault(); void lookup(id); }}><label className="block text-sm font-medium" htmlFor="order-id">Order ID</label><input id="order-id" required value={id} onChange={event => setId(event.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} className="w-full rounded-xl border border-input bg-background px-4 py-3 font-mono text-sm focus-visible:outline-2 focus-visible:outline-primary" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /><Button disabled={busy} type="submit">{busy ? 'Checking…' : 'Check status'}</Button></form>
    {error && <p role="alert" className="mt-6 rounded-xl border border-destructive/30 p-4 text-destructive">{error}</p>}
    {result && <section aria-live="polite" className="mt-8 space-y-4 rounded-2xl border border-border p-6"><p className="text-xs font-medium uppercase tracking-widest text-primary">Order status</p><p className="text-sm text-muted-foreground">For @{result.target_username || 'lumenless'}</p><h2 className="text-2xl font-semibold capitalize">{result.status.replaceAll('_', ' ')}</h2><p className="text-muted-foreground">{descriptions[result.status] || 'Our team is processing your order.'}</p><p className="break-all font-mono text-xs text-muted-foreground">{result.id}</p><p className="text-xs text-muted-foreground">Updated {new Date(result.updated_at).toLocaleString()}</p>{result.published_ids.filter(post => /^\d+$/.test(post)).map((post, index) => <a key={post} href={`https://x.com/${result.target_username || 'lumenless'}/status/${post}`} target="_blank" rel="noreferrer" className="block text-primary underline">View tweet {index + 1} ↗</a>)}<Button variant="outline" disabled={busy} onClick={() => lookup(result.id)}>Refresh status</Button></section>}
  </main>;
}
