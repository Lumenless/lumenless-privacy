'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { ArrowUpRight, Check, Copy, Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { jsonRequest } from '@/lib/tweet-orders/wallet';

type Session = { configured: boolean; account: { id: string; username: string; name: string } | null; sessionExpiresAt: number | null; tokenExpiresAt: string | null };
const errors: Record<string, string> = {
  invalid_session: 'Your authorization session expired. Please connect X again.',
  access_denied: 'Authorization was cancelled. You can connect whenever you’re ready.',
  token_exchange_failed: 'X could not complete authorization. Check the app callback URL and try again.',
  missing_permissions: 'X did not grant the required permissions. Reconnect with publishing, media and offline access.',
  account_lookup_failed: 'We could not verify the connected X account. Please try again.',
  connection_failed: 'Could not connect X. Please try again.',
};
export default function BusinessConnect() {
  const [session, setSession] = useState<Session | null>(null);
  const [credentials, setCredentials] = useState('');
  const [visible, setVisible] = useState(false); const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  async function refresh() { setSession(await jsonRequest('/api/business/x/session', { cache: 'no-store' })); }
  useEffect(() => {
    refresh().catch(() => setError('Could not load your session. Reload this page.'));
    const code = new URLSearchParams(window.location.search).get('error');
    if (code) { setError(errors[code] || errors.connection_failed); window.history.replaceState(null, '', window.location.pathname); }
  }, []);
  useEffect(() => {
    if (!session?.sessionExpiresAt) return;
    const timer = setTimeout(() => { setCredentials(''); setVisible(false); setSession(current => current ? { ...current, account: null } : null); setError('Your temporary session expired. Connect X again to export credentials.'); }, Math.max(0, session.sessionExpiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session?.sessionExpiresAt]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2500); return () => clearTimeout(timer); }, [copied]);
  async function run(label: string, task: () => Promise<void>) {
    setError(''); setBusy(label); try { await task(); } catch (err) { setError(err instanceof Error ? err.message : 'Request failed. Try again.'); } finally { setBusy(''); }
  }
  async function exportCredentials() {
    const result = await jsonRequest('/api/business/x/export', { method: 'POST' });
    setCredentials(result.env); return result.env as string;
  }
  async function connect() {
    setCredentials(''); setVisible(false);
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
        <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">Connect your account to get the credentials your Lumenless publishing integration needs.</p>
        <ol className="mt-10 space-y-6">{[['01', 'Authorize with X', 'Choose your account and approve publishing permissions on X.'], ['02', 'Copy your credentials', 'Export an environment block for your Lumenless server.'], ['03', 'Start publishing', 'Your server refreshes access tokens and publishes approved posts.']].map(([number, title, text]) => <li key={number} className="flex gap-4"><span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border text-xs font-medium text-primary">{number}</span><div><h2 className="font-medium">{title}</h2><p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">{text}</p></div></li>)}</ol>
      </section>
      <section aria-busy={!!busy} className="rounded-2xl border border-border bg-card p-6 md:p-8">
        <div className="mb-6 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><KeyRound size={24} /></div>
        {session?.account ? <>
          <p className="mb-2 text-sm font-medium text-primary">ACCOUNT CONNECTED</p><h2 className="break-words text-2xl font-semibold">@{session.account.username}</h2><p className="mt-1 text-sm text-muted-foreground">{session.account.name}</p>
          <div className="my-6 rounded-xl bg-muted p-4 text-sm leading-relaxed text-muted-foreground">Copy these credentials into the server environment on lumenless.com. Use the same X app’s Client Secret there.</div>
          <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-medium">Environment variables</h3><Button variant="ghost" size="sm" disabled={!!busy} onClick={() => run('Loading credentials…', async () => { if (!visible && !credentials) await exportCredentials(); setVisible(!visible); })}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}{visible ? 'Hide' : 'Reveal'}</Button></div>
          <textarea aria-label="X environment credentials" readOnly spellCheck={false} autoComplete="off" rows={8} value={visible ? credentials : 'X_CLIENT_ID=••••••••\nX_ACCESS_TOKEN=••••••••\nX_REFRESH_TOKEN=••••••••\nX_TOKEN_EXPIRES_AT=••••••••'} className="w-full resize-none rounded-xl border border-input bg-muted p-4 font-mono text-xs leading-relaxed focus-visible:outline-2 focus-visible:outline-primary" />
          <Button className="mt-4 h-12 w-full" disabled={!!busy} onClick={() => run('Copying credentials…', async () => { const value = await exportCredentials(); await navigator.clipboard.writeText(value); setCopied(true); })}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Copied to clipboard' : 'Copy .env block'}</Button>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">This session lasts 15 minutes. Access tokens expire; the refresh token lets your server renew them. Copy credentials before closing the session.</p>
          <div className="mt-5 flex flex-wrap gap-3"><Button variant="outline" disabled={!!busy} onClick={() => run('Connecting X…', connect)}>Switch account</Button><Button variant="ghost" disabled={!!busy} onClick={() => run('Closing session…', async () => { await jsonRequest('/api/business/x/logout', { method: 'POST' }); setCredentials(''); setVisible(false); await refresh(); })}>Close session</Button></div>
        </> : <><h2 className="text-2xl font-semibold">Connect your X account</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Authorize directly on X. We never ask for your X password.</p>
          <Button className="mt-7 h-12 w-full" disabled={!session?.configured || !!busy} onClick={() => run('Opening X…', connect)}>{busy || 'Continue with X'}</Button>
          {!session ? <p role="status" className="mt-4 text-sm text-muted-foreground">Checking connection settings…</p> : !session.configured && <p role="status" className="mt-4 rounded-xl bg-muted p-4 text-sm text-muted-foreground">X authorization is being configured. This page will be ready once the app credentials are added.</p>}
          <div className="mt-7 border-t border-border pt-6"><h3 className="text-sm font-medium">You’ll grant permission to</h3><ul className="mt-3 space-y-2 text-sm text-muted-foreground"><li>Read your account profile and posts</li><li>Publish posts and upload media</li><li>Renew access without signing in again</li></ul></div>
        </>}
        {busy && <p role="status" aria-live="polite" className="mt-4 text-sm text-primary">{busy}</p>}{error && <p role="alert" className="mt-5 rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{error}</p>}
        <div className="mt-7 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><ShieldCheck size={16} className="mt-0.5 shrink-0" /><p>Credentials stay in an encrypted, temporary browser session. This version does not store them in a database or browser local storage.</p></div>
      </section>
    </main>
    <footer className="mx-auto max-w-6xl border-t border-border px-6 py-6 text-xs text-muted-foreground">Lumenless Business · X account connection</footer>
  </div>;
}
