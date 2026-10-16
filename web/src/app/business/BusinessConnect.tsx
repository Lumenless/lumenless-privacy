'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { ArrowUpRight, Check, KeyRound } from 'lucide-react';
import PublishingSettings from './PublishingSettings';
import TelegramSettings from './TelegramSettings';
import { Button } from '@/components/ui/button';
import { jsonRequest } from '@/lib/tweet-orders/wallet';

type Session = { configured: boolean; account: { id: string; username: string; name: string } | null; sessionExpiresAt: number | null; tokenExpiresAt: string | null };
const errors: Record<string, string> = {
  invalid_session: 'Your authorization session expired. Please connect X again.',
  access_denied: 'Authorization was cancelled. You can connect whenever you’re ready.',
  token_exchange_failed: 'X could not complete authorization. Check the app callback URL and try again.',
  missing_permissions: 'X did not grant the required permissions. Reconnect with publishing, media and offline access.',
  account_lookup_failed: 'We could not verify the connected X account. Please try again.',
  save_failed: 'Could not save the connection. Please try connecting again.',
  connection_failed: 'Could not connect X. Please try again.',
};
export default function BusinessConnect() {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  async function refresh() { setSession(await jsonRequest('/api/business/x/session', { cache: 'no-store' })); }
  useEffect(() => {
    refresh().catch(() => setError('Could not load your session. Reload this page.'));
    const code = new URLSearchParams(window.location.search).get('error');
    if (code) { setError(errors[code] || errors.connection_failed); window.history.replaceState(null, '', window.location.pathname); }
  }, []);
  useEffect(() => {
    if (!session?.sessionExpiresAt) return;
    const timer = setTimeout(() => { setSession(current => current ? { ...current, account: null } : null); setError('Your temporary session expired. Your publishing connection remains saved.'); }, Math.max(0, session.sessionExpiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session?.sessionExpiresAt]);
  async function run(label: string, task: () => Promise<void>) {
    setError(''); setBusy(label); try { await task(); } catch (err) { setError(err instanceof Error ? err.message : 'Request failed. Try again.'); } finally { setBusy(''); }
  }
  async function connect() {
    const result = await jsonRequest('/api/business/x/start', { method: 'POST' }); window.location.assign(result.url);
  }
  return <div className="min-h-screen bg-background text-foreground">
    <header className="mx-auto flex max-w-6xl items-center justify-between border-b border-border px-6 py-6">
      <a href="https://business.lumenless.com" className="flex items-center gap-3 text-xl font-semibold"><Image src="/logo.svg" alt="" width={34} height={34} />lumenless <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">Business</span></a>
      <a href="https://lumenless.com" className="flex min-h-10 items-center gap-2 text-sm text-muted-foreground">Lumenless <ArrowUpRight size={16} /></a>
    </header>
    <main className="mx-auto grid max-w-6xl items-start gap-12 px-6 py-14 md:py-24 lg:grid-cols-[1fr_460px] lg:gap-20">
      <section><p className="mb-5 text-sm font-medium uppercase tracking-widest text-primary">Paid posts. Payment upfront.</p>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-6xl">Your X audience.<br /><span className="text-primary">Your next income stream.</span></h1>
        <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">Earn from paid tweets and threads on your terms. Clients pay before you publish, so you don’t have to chase payment after your post goes live.</p>
        <ol className="mt-10 space-y-6">{[['01', 'Set your terms', 'Choose your prices for tweets and threads, your payment token, and the wallet where you receive earnings.'], ['02', 'Share your order page', 'Clients submit their content and pay upfront. Funds are held in your account’s escrow while you review the request.'], ['03', 'Approve, publish, earn', 'You decide what goes live. Approved posts publish automatically. After 24 hours, claim your payout if the posts are still live.']].map(([number, title, text]) => <li key={number} className="flex gap-4"><span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border text-xs font-medium text-primary">{number}</span><div><h2 className="font-medium">{title}</h2><p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">{text}</p></div></li>)}</ol>
        <div className="mt-10 rounded-2xl border border-border bg-card p-5"><p className="font-medium">90% for you. 10% for Lumenless.</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Payments and publishing in one place. Claim earnings with your receiving wallet after the 24-hour escrow period. Your wallet signs the payout and pays network fees.</p></div>
      </section>
      <section aria-busy={!!busy} className="rounded-2xl border border-border bg-card p-6 md:p-8">
        <div className="mb-6 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><KeyRound size={24} /></div>
        {session?.account ? <>
          <p className="mb-2 text-sm font-medium text-primary">YOUR CREATOR DASHBOARD</p><h2 className="break-words text-2xl font-semibold">@{session.account.username}</h2><p className="mt-1 text-sm text-muted-foreground">{session.account.name}</p>
          <div role="status" className="my-6 flex gap-3 rounded-xl bg-muted p-4 text-sm leading-relaxed"><Check size={20} className="shrink-0 text-primary" /><p>Your X account is connected. Complete your payment setup, then share your personal order link with clients.</p></div>
          <p className="text-xs leading-relaxed text-muted-foreground">Review every request before it reaches your audience.</p>
          <PublishingSettings key={session.account.id} username={session.account.username} /><a href="/business/tweets" className="mt-5 block rounded-xl bg-primary px-4 py-3 text-center font-medium text-primary-foreground">Review paid orders</a><div className="mt-5 flex flex-wrap gap-3"><Button variant="outline" disabled={!!busy} onClick={() => run('Connecting X…', connect)}>Switch / reconnect account</Button><Button variant="ghost" disabled={!!busy} onClick={() => run('Closing session…', async () => { await jsonRequest('/api/business/x/logout', { method: 'POST' }); await refresh(); })}>Sign out</Button></div>
          <TelegramSettings key={`telegram:${session.account.id}`} />
        </> : <><h2 className="text-2xl font-semibold">Start earning with X</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Connect your account, set your rates, and create your page for paid post requests.</p>
          <Button className="mt-7 h-12 w-full" disabled={!session?.configured || !!busy} onClick={() => run('Opening X…', connect)}>{busy || 'Connect X & set your rates'}</Button>
          {!session ? <p role="status" className="mt-4 text-sm text-muted-foreground">Checking connection settings…</p> : !session.configured && <p role="status" className="mt-4 rounded-xl bg-muted p-4 text-sm text-muted-foreground">X authorization is being configured. This page will be ready once the app credentials are added.</p>}
          <div className="mt-7 border-t border-border pt-6"><h3 className="text-sm font-medium">You stay in control</h3><ul className="mt-3 space-y-2 text-sm text-muted-foreground"><li>You approve or reject every request</li><li>Only approved content gets published</li><li>Clients fund escrow before publication</li></ul></div>
        </>}
        {busy && <p role="status" aria-live="polite" className="mt-4 text-sm text-primary">{busy}</p>}{error && <p role="alert" className="mt-5 rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{error}</p>}
      </section>
    </main>
    <footer className="mx-auto max-w-6xl border-t border-border px-6 py-6 text-xs text-muted-foreground">Lumenless Business · Earn from your X audience</footer>
  </div>;
}
