'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { ArrowUpRight, Check, KeyRound, ShieldCheck } from 'lucide-react';
import PublishingSettings from './PublishingSettings';
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
      <section><p className="mb-5 text-sm font-medium uppercase tracking-widest text-primary">Connect once. Publish with confidence.</p>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-6xl">Your X account.<br /><span className="text-primary">Ready for business.</span></h1>
        <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">Connect your X account to receive paid post requests. Sign in to review orders and manage publishing.</p>
        <ol className="mt-10 space-y-6">{[['01', 'Authorize with X', 'Choose your account and approve publishing permissions on X.'], ['02', 'Connection saved', 'Your publishing connection is saved automatically.'], ['03', 'Start publishing', 'Your server refreshes access tokens and publishes approved posts.']].map(([number, title, text]) => <li key={number} className="flex gap-4"><span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border text-xs font-medium text-primary">{number}</span><div><h2 className="font-medium">{title}</h2><p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">{text}</p></div></li>)}</ol>
      </section>
      <section aria-busy={!!busy} className="rounded-2xl border border-border bg-card p-6 md:p-8">
        <div className="mb-6 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><KeyRound size={24} /></div>
        {session?.account ? <>
          <p className="mb-2 text-sm font-medium text-primary">ACCOUNT CONNECTED</p><h2 className="break-words text-2xl font-semibold">@{session.account.username}</h2><p className="mt-1 text-sm text-muted-foreground">{session.account.name}</p>
          <div role="status" className="my-6 flex gap-3 rounded-xl bg-muted p-4 text-sm leading-relaxed"><Check size={20} className="shrink-0 text-primary" /><p>Connection saved. Lumenless can now publish approved posts and renew access automatically.</p></div>
          <p className="text-xs leading-relaxed text-muted-foreground">Your publishing connection stays active after signing out.</p>
          <a href={`https://lumenless.com/u/@${session.account.username}`} target="_blank" rel="noreferrer" className="mt-5 block break-all text-sm text-primary underline">Open your order page ↗</a><p className="mt-2 break-all font-mono text-xs text-muted-foreground">lumenless.com/u/@{session.account.username}</p><a href="/business/tweets" className="mt-5 block rounded-xl bg-primary px-4 py-3 text-center font-medium text-primary-foreground">Open moderation queue</a><div className="mt-5 flex flex-wrap gap-3"><Button variant="outline" disabled={!!busy} onClick={() => run('Connecting X…', connect)}>Switch / reconnect account</Button><Button variant="ghost" disabled={!!busy} onClick={() => run('Closing session…', async () => { await jsonRequest('/api/business/x/logout', { method: 'POST' }); await refresh(); })}>Sign out</Button></div>
          <PublishingSettings key={session.account.id} />
        </> : <><h2 className="text-2xl font-semibold">Connect your X account</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Authorize directly on X. We never ask for your X password.</p>
          <Button className="mt-7 h-12 w-full" disabled={!session?.configured || !!busy} onClick={() => run('Opening X…', connect)}>{busy || 'Continue with X'}</Button>
          {!session ? <p role="status" className="mt-4 text-sm text-muted-foreground">Checking connection settings…</p> : !session.configured && <p role="status" className="mt-4 rounded-xl bg-muted p-4 text-sm text-muted-foreground">X authorization is being configured. This page will be ready once the app credentials are added.</p>}
          <div className="mt-7 border-t border-border pt-6"><h3 className="text-sm font-medium">You’ll grant permission to</h3><ul className="mt-3 space-y-2 text-sm text-muted-foreground"><li>Read your account profile and posts</li><li>Publish posts and upload media</li><li>Renew access without signing in again</li></ul></div>
        </>}
        {busy && <p role="status" aria-live="polite" className="mt-4 text-sm text-primary">{busy}</p>}{error && <p role="alert" className="mt-5 rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{error}</p>}
        <div className="mt-7 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><ShieldCheck size={16} className="mt-0.5 shrink-0" /><p>Tokens are stored in a private server database. They are never displayed or stored in browser local storage. Closing this session does not disconnect publishing.</p></div>
      </section>
    </main>
    <footer className="mx-auto max-w-6xl border-t border-border px-6 py-6 text-xs text-muted-foreground">Lumenless Business · X account connection</footer>
  </div>;
}
