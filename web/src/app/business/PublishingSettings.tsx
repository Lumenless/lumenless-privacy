'use client';
import { useEffect, useState } from 'react';
import { jsonRequest } from '@/lib/tweet-orders/wallet';
import { Button } from '@/components/ui/button';
export default function PublishingSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { jsonRequest('/api/business/settings', { cache: 'no-store' }).then(data => { setEnabled(data.paidPartnership); setSaved(data.paidPartnership); }).catch(err => setError(err instanceof Error ? err.message : 'Could not load settings.')); }, []);
  return <section className="mt-6 border-t border-border pt-6"><h3 className="font-medium">Publishing settings</h3><label className="mt-4 flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" checked={enabled === true} disabled={enabled === null || busy} onChange={event => setEnabled(event.target.checked)} className="mt-1 size-4 shrink-0 accent-primary" /><span><span className="font-medium">Paid Partnership</span><span className="mt-1 block text-muted-foreground">Add X’s Paid Partnership label to every post published through Lumenless, including each post in a thread.</span></span></label><p className="mt-3 text-xs text-muted-foreground">Changes apply when an order starts publishing. Existing posts and threads already in progress keep their original setting.</p><Button variant="outline" className="mt-4" disabled={busy || enabled === null || enabled === saved} onClick={async () => { setBusy(true); setError(''); try { const data = await jsonRequest('/api/business/settings', { method: 'POST', body: JSON.stringify({ paidPartnership: enabled }) }); setSaved(data.paidPartnership); } catch(err) { setError(err instanceof Error ? err.message : 'Could not save settings.'); } finally { setBusy(false); } }}>{busy ? 'Saving…' : enabled !== null && enabled === saved ? 'Settings saved' : 'Save settings'}</Button>{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}</section>;
}
