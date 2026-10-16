'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { TweetOrder } from '@/lib/tweet-orders/model';
import { WALLET_NAMES, fromBase64, jsonRequest, toBase64, walletProvider } from '@/lib/tweet-orders/wallet';
import { Button } from '@/components/ui/button';
const field = 'rounded-xl border border-input bg-background px-4 py-3 focus-visible:outline-2 focus-visible:outline-primary';
import { orderTerms, displayAmount } from '@/lib/tweet-orders/billing';
type Refund = { signature: string; raw: string };
async function api(body?: Record<string, unknown>) { return jsonRequest('/api/business/tweets', { cache: 'no-store', ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) }); }
function EscrowClaimButton({ publishedAt, busy, onClaim }: { publishedAt: string | null | undefined; busy: boolean; onClaim: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const availableAt = publishedAt ? Date.parse(publishedAt) + 86_400_000 : NaN;
  const remaining = availableAt - now;
  useEffect(() => {
    if (!Number.isFinite(availableAt) || availableAt <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [availableAt]);
  const minutes = Math.max(0, Math.ceil(remaining / 60_000));
  const label = !Number.isFinite(availableAt) ? 'Claim unavailable' : remaining > 0 ? `Claim in ${Math.floor(minutes / 60)}h ${minutes % 60}m` : 'Claim';
  return <Button disabled={busy || !Number.isFinite(availableAt) || remaining > 0} onClick={onClaim}>{label}</Button>;
}
export default function BusinessTweets() {
  const [username, setUsername] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<TweetOrder[]>([]); const [filter, setFilter] = useState('all');
  const [notes, setNotes] = useState<Record<string, string>>({}); const [postIds, setPostIds] = useState<Record<string, string>>({});
  const [refunds, setRefunds] = useState<Record<string, Refund>>({}); const [wallet, setWallet] = useState('Phantom');
  const [error, setError] = useState(''); const [busy, setBusy] = useState('');
  useEffect(() => { try { setRefunds(JSON.parse(localStorage.getItem('lumenless-refunds') || '{}')); } catch { /* no recovery */ } }, []);
  function remember(id: string, refund: Refund) { const updated = { ...refunds, [id]: refund }; setRefunds(updated); localStorage.setItem('lumenless-refunds', JSON.stringify(updated)); }
  const refresh = useCallback(async () => { const session = await jsonRequest('/api/business/x/session', { cache: 'no-store' }); if (!session.account) throw new Error('Sign in to Business with X.'); setUsername(session.account.username); const result = await api(); setOrders(result.orders); setAuthenticated(true);
    setRefunds(current => { const recovered = { ...current }; for (const value of result.orders) if (value.refund_signed_signature && !recovered[value.id]) recovered[value.id] = { signature: value.refund_signed_signature, raw: '' }; localStorage.setItem('lumenless-refunds', JSON.stringify(recovered)); return recovered; }); }, []);
  useEffect(() => { refresh().catch(err => setError(err instanceof Error ? err.message : 'Sign in to Business.')).finally(() => setLoading(false)); }, [refresh]);

  async function run(label: string, task: () => Promise<void>) { setBusy(label); setError(''); try { await task(); } catch (err) { setError(err instanceof Error ? err.message : 'Action failed.'); } finally { setBusy(''); } }
  async function act(value: TweetOrder, action: string, extra = {}) {
    try { await api({ id: value.id, action, note: notes[value.id] || '', ...extra }); }
    catch (error) { try { await refresh(); } catch { /* Preserve the original action error. */ } throw error; }
    await refresh();
  }
  async function settle(value: TweetOrder, kind: 'payout' | 'refund') {
    const built = await api({ id:value.id, action:'escrow-prepare', kind });
    const provider = walletProvider(wallet); const account = await provider.connect();
    if (account.publicKey.toBase58() !== built.feePayer) throw new Error('Connect the receiving wallet configured in Business. It signs the transaction and pays network fees.');
    const signed = await provider.signTransaction(Transaction.from(fromBase64(built.transaction)));
    try { await api({id:value.id,action:'escrow-broadcast',signedTransaction:toBase64(signed.serialize({requireAllSignatures:false}))}); }
    finally { await refresh(); }
    for(let attempt=0;attempt<12;attempt++) { try { await api({id:value.id,action:'escrow-verify'}); await refresh(); return; } catch(error) { if(!(error instanceof Error)||!error.message.includes('not finalized'))throw error; await new Promise(resolve=>setTimeout(resolve,2500)); } }
    throw new Error('Settlement submitted. Verify it shortly.');
  }
  async function refund(value: TweetOrder) {
    const provider = walletProvider(wallet); const account = await provider.connect();
    if (account.publicKey.toBase58() !== orderTerms(value).recipient) throw new Error('Connect the receiving wallet for this order to sign the refund.');
    const built = await api({ id: value.id, action: 'refund-prepare' });
    const signed = await provider.signTransaction(Transaction.from(fromBase64(built.transaction)));
    if (!signed.signature) throw new Error('Refund was not signed.');
    const recovery = { signature: bs58.encode(signed.signature), raw: toBase64(signed.serialize()) }; remember(value.id, recovery);
    await api({ id: value.id, action: 'refund-broadcast', signedTransaction: recovery.raw });
    for (let attempt = 0; attempt < 12; attempt++) {
      try { await act(value, 'refund-verify', { signature: recovery.signature }); return; }
      catch (err) { if (!(err instanceof Error) || !err.message.includes('not finalized')) throw err; await new Promise(resolve => setTimeout(resolve, 2500)); }
    }
    throw new Error('Refund sent. Verify the saved signature shortly.');
  }
  return <main className="mx-auto min-h-screen max-w-6xl px-6 py-10 text-foreground">
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4"><div><Link href="/" className="text-sm text-primary">← Lumenless</Link><h1 className="mt-3 text-3xl font-semibold">Moderation queue</h1><p className="mt-2 text-sm text-muted-foreground">Approve to publish automatically to @{username}.</p></div>{authenticated && <Button variant="outline" onClick={() => { run('Signing out…', async () => { await jsonRequest('/api/business/x/logout', { method: 'POST' }); window.location.assign('/business'); }); }}>Sign out</Button>}</div>
    {loading ? <p role="status" className="rounded-2xl border border-border p-6 text-muted-foreground">Loading your moderation queue…</p> : !authenticated ? <div className="rounded-2xl border border-border p-6"><p>Sign in with X to review your paid orders.</p><Link href="/business" className="mt-4 inline-block text-primary underline">Continue with X</Link></div> : <>
      <div className="mb-6 flex flex-wrap items-center gap-3"><label className="text-sm">Status <select className={`${field} ml-2`} value={filter} onChange={event => setFilter(event.target.value)}>{['all', 'pending_review', 'approved', 'publishing', 'publish_failed', 'publish_uncertain', 'refund_pending', 'published', 'rejected', 'refunded'].map(status => <option key={status}>{status}</option>)}</select></label><Button variant="outline" disabled={!!busy} onClick={() => run('Refreshing…', refresh)}>Refresh</Button><label className="text-sm">Signing wallet <select className={`${field} ml-2`} value={wallet} onChange={event => setWallet(event.target.value)}>{WALLET_NAMES.map(name => <option key={name}>{name}</option>)}</select></label></div>
      <p className="mb-6 text-xs text-muted-foreground">Showing the newest 100 paid orders. Escrow settlements require your receiving wallet signature. Legacy refunds require the original treasury wallet.</p>
      {!orders.filter(value => filter === 'all' || value.status === filter).length && <div className="rounded-2xl border border-border p-10 text-center text-muted-foreground">No orders in this queue. Refresh after a new payment.</div>}
      <div className="space-y-6">{orders.filter(value => filter === 'all' || value.status === filter).map(value => <article key={value.id} className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-5 flex flex-wrap justify-between gap-3"><div><p className="text-lg font-semibold capitalize">{value.kind} · {displayAmount(orderTerms(value).amount)} {orderTerms(value).symbol}</p><p className="mt-1 text-sm text-primary">{value.status.replaceAll('_', ' ')}</p><p className="mt-1 break-all text-xs text-muted-foreground">{value.id} · {new Date(value.created_at).toLocaleString()}</p></div>{value.payment_signature && <a className="text-sm text-primary underline" target="_blank" rel="noreferrer" href={`https://solscan.io/tx/${value.payment_signature}`}>Payment ↗</a>}</div>
        <div className="space-y-4">{value.tweets.map((tweet, index) => <div key={index} className="rounded-xl bg-muted p-4"><p className="mb-2 text-xs text-muted-foreground">Tweet {index + 1}</p><p className="whitespace-pre-wrap break-words">{tweet.text}</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{tweet.media.map(file => file.type.startsWith('video/') ? <video key={file.path} src={file.url} controls preload="metadata" className="max-h-80 w-full rounded-lg" aria-label={file.name} /> : <a key={file.path} href={file.url} target="_blank" rel="noreferrer"><Image unoptimized src={file.url!} width={640} height={400} alt={file.name} className="max-h-80 w-full rounded-lg object-contain" /></a>)}</div></div>)}</div>
        <div className="my-4 space-y-1 text-sm"><p className="break-all">Wallet: {value.wallet}</p><p>Email: {value.email || 'Not provided'}</p><p>Telegram: {value.telegram || 'Not provided'}</p>{value.review_note && <p>Review note: {value.review_note}</p>}{value.publish_error && <p role="status" className="text-destructive">{value.publish_error}</p>}{value.published_ids.length > 0 && <div className="flex flex-wrap gap-3">{value.published_ids.map((id, index) => <a key={id} target="_blank" rel="noreferrer" className="text-primary underline" href={`https://x.com/${value.target_username || username}/status/${id}`}>Published tweet {index + 1} ↗</a>)}</div>}</div>
        {value.status === 'pending_review' && <><label className="block text-sm">Review note / rejection reason<textarea rows={2} maxLength={2000} className={`${field} mt-2 w-full`} value={notes[value.id] || ''} onChange={event => setNotes({ ...notes, [value.id]: event.target.value })} /></label><div className="mt-4 flex flex-wrap gap-3"><Button disabled={!!busy} onClick={() => run('Approving and publishing…', () => act(value, 'approve'))}>Approve & publish</Button><Button variant="outline" disabled={!!busy} onClick={() => run('Rejecting with refund…', () => act(value, 'reject-refund'))}>Reject with refund</Button><Button variant="destructive" disabled={!!busy} onClick={() => run('Rejecting without refund…', () => act(value, 'reject'))}>Reject without refund</Button></div></>}
        {['approved', 'publish_failed'].includes(value.status) && <Button disabled={!!busy} onClick={() => run('Publishing…', () => act(value, 'publish'))}>Continue publication</Button>}
        {value.status === 'publishing' && <Button variant="outline" disabled={!!busy} onClick={() => run('Recovering publisher…', () => act(value, 'recover'))}>Recover stalled publication</Button>}
        {value.status === 'publish_uncertain' && <div className="space-y-3 rounded-xl border border-border p-4"><p className="text-sm">Check @{value.target_username || username} for tweet {value.published_ids.length + 1}. Attach its post ID if it exists.</p><label className="block text-sm">Published post ID<input className={`${field} mt-2 w-full`} value={postIds[value.id] || ''} onChange={event => setPostIds({ ...postIds, [value.id]: event.target.value })} inputMode="numeric" /></label><Button disabled={!!busy || !postIds[value.id]} onClick={() => run('Reconciling publication…', () => act(value, 'reconcile', { postId: postIds[value.id] }))}>Attach published post</Button><Button variant="outline" disabled={!!busy} onClick={() => { if (window.confirm(`Have you checked @${value.target_username || username} and confirmed this tweet was not published? A retry could create a duplicate if it exists.`)) run('Resetting publication…', () => act(value, 'confirm-not-published', { confirm: `I checked @${value.target_username || username} and this tweet was not published` })); }}>I checked: tweet was not published</Button></div>}
        {!value.escrow_account_id && value.status === 'refund_pending' && <div className="mt-4 flex flex-wrap gap-3">{refunds[value.id] ? <><p className="w-full break-all text-xs">Saved refund: {refunds[value.id].signature}</p><Button disabled={!!busy} onClick={() => run('Verifying refund…', () => act(value, 'refund-verify', { signature: refunds[value.id].signature }))}>Verify refund</Button><Button variant="outline" disabled={!!busy || !refunds[value.id].raw} onClick={() => run('Resending same refund…', async () => { await api({ id: value.id, action: 'refund-broadcast', signedTransaction: refunds[value.id].raw }); })}>Resend same refund</Button><Button variant="outline" disabled={!!busy} onClick={() => run('Checking failed refund…', async () => { await api({ id: value.id, action: 'refund-reset' }); const updated = { ...refunds }; delete updated[value.id]; setRefunds(updated); localStorage.setItem('lumenless-refunds', JSON.stringify(updated)); await refresh(); })}>Reset failed settlement refund</Button></> : <Button disabled={!!busy} onClick={() => run('Signing refund…', () => refund(value))}>Sign token refund</Button>}</div>}
        {value.escrow_account_id && <div className="mt-5 space-y-3 rounded-xl border border-border p-4"><p className="text-sm font-medium">Escrow</p>{value.settled_at ? <p className="text-sm text-primary">{value.settlement_kind === 'refund' ? 'Refund confirmed' : 'Payout confirmed: 90% to you, 10% platform fee'}</p> : value.settlement_signature ? <><p className="break-all text-xs text-muted-foreground">Pending settlement: {value.settlement_signature}</p><div className="flex flex-wrap gap-3"><Button disabled={!!busy} onClick={()=>run('Verifying escrow…',async()=>{await api({id:value.id,action:'escrow-verify'});await refresh();})}>Verify settlement</Button><Button variant="outline" disabled={!!busy} onClick={()=>run('Resending settlement…',async()=>{await api({id:value.id,action:'escrow-broadcast',signedTransaction:''});await refresh();})}>Resend same transaction</Button><Button variant="outline" disabled={!!busy} onClick={()=>run('Checking settlement…',async()=>{await api({id:value.id,action:'escrow-reset'});await refresh();})}>Reset failed settlement</Button></div></> : value.status === 'published' ? <><p className="text-xs text-muted-foreground">{value.published_at ? `Available after ${new Date(Date.parse(value.published_at)+86400000).toLocaleString()}. Every post must still exist on X.` : 'Publication timestamp is unavailable.'}</p><EscrowClaimButton publishedAt={value.published_at} busy={!!busy} onClaim={()=>run('Verifying posts and preparing payout…',()=>settle(value,'payout'))} /></> : value.status === 'refund_pending' && value.refund_reason === 'review_timeout' ? <p className="text-sm text-muted-foreground">The buyer requested a refund after 72 hours without a decision. They can complete it from the order status page.</p> : value.status === 'refund_pending' ? <Button disabled={!!busy} onClick={()=>run('Preparing escrow refund…',()=>settle(value,'refund'))}>Sign escrow refund</Button> : value.status === 'rejected' ? <p className="text-sm text-muted-foreground">Funds stay locked in escrow pending manual resolution.</p> : <p className="text-xs text-muted-foreground">Funds are held until publication and the 24-hour waiting period.</p>}</div>}
        {(!value.notification_sent_at || value.owner_notification_done === false) && <Button variant="outline" className="mt-4" disabled={!!busy} onClick={() => run('Sending Telegram notification…', () => act(value, 'notify'))}>Retry Telegram notification</Button>}
      </article>)}</div>
    </>}
    {busy && <p role="status" aria-live="polite" className="sticky bottom-4 mt-6 rounded-xl border border-border bg-background p-4 text-primary">{busy}</p>}{error && <div role="alert" className="mt-6 rounded-xl border border-destructive/30 p-4 text-destructive">{error}{authenticated && <Button variant="outline" className="ml-4" disabled={!!busy} onClick={() => run('Refreshing…', refresh)}>Refresh queue</Button>}</div>}
  </main>;
}
