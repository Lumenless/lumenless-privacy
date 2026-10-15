'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import parseTweet from 'twitter-text/dist/parseTweet';
import { draftSchema, price, signingMessage, TweetOrder } from '@/lib/tweet-orders/model';
import { fromBase64, jsonRequest, toBase64, walletProvider, WalletProvider } from '@/lib/tweet-orders/wallet';
import { Button } from '@/components/ui/button';

type Post = { text: string; files: File[] };
type Recovery = { id: string; token: string; signature?: string; raw?: string; swapComplete?: boolean };
const field = 'w-full rounded-xl border border-input bg-background px-4 py-3 focus-visible:outline-2 focus-visible:outline-primary';
const storage = 'lumenless-tweet-order';
export default function Home() {
  const [kind, setKind] = useState<'tweet' | 'thread'>('tweet');
  const [posts, setPosts] = useState<Post[]>([{ text: '', files: [] }]);
  const [email, setEmail] = useState(''); const [telegram, setTelegram] = useState('');
  const [terms, setTerms] = useState(false);
  const [wallet, setWallet] = useState('');
  const providerRef = useRef<WalletProvider | null>(null);
  const focusReturn = useRef<HTMLElement | null>(null);
  const walletChoice = useRef<((provider: WalletProvider | null) => void) | null>(null);
  const [walletPicker, setWalletPicker] = useState(false);
  const [selectingWallet, setSelectingWallet] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (walletPicker) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [walletPicker]);
  const [saved, setSaved] = useState<Recovery | null>(null);
  const [order, setOrder] = useState<TweetOrder | null>(null);
  const [config, setConfig] = useState<{ ready: boolean; solEnabled: boolean } | null>(null);
  const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  useEffect(() => { if (!walletPicker && !busy && focusReturn.current) { const target = focusReturn.current; focusReturn.current = null; if (target.isConnected) target.focus(); } }, [walletPicker, busy]);
  const [quote, setQuote] = useState<{ transaction: string; inLamports: string; networkFeeLamports: number } | null>(null);
  function remember(value: Recovery) { setSaved(value); localStorage.setItem(storage, JSON.stringify(value)); }
  async function load(value: Recovery) {
    const result = await jsonRequest(`/api/tweet-orders/${value.id}`, { headers: { 'x-order-token': value.token } });
    setOrder(result); if (result.payment_signed_signature && !value.signature) remember({ ...value, signature: result.payment_signed_signature }); return result as TweetOrder;
  }
  useEffect(() => {
    jsonRequest('/api/tweet-orders/config').then(setConfig).catch(() => setError('Could not check payment availability. Reload this page.'));
    const previous = localStorage.getItem(storage);
    if (previous) { try { const value = JSON.parse(previous); setSaved(value); jsonRequest(`/api/tweet-orders/${value.id}`, { headers: { 'x-order-token': value.token } }).then(result => { setOrder(result); if (result.payment_signed_signature && !value.signature) { const recovered = { ...value, signature: result.payment_signed_signature }; setSaved(recovered); localStorage.setItem(storage, JSON.stringify(recovered)); } }).catch((err: Error) => setError(err.message)); } catch { localStorage.removeItem(storage); } }
  }, []);
  async function run(label: string, task: () => Promise<void>) {
    setBusy(label); setError(''); try { await task(); } catch (err) { if (!(err instanceof Error && err.message === 'Wallet connection cancelled.')) setError(err instanceof Error ? err.message : 'Something went wrong. Retry.'); } finally { setBusy(''); }
  }
  async function connect(): Promise<WalletProvider> {
    if (providerRef.current?.publicKey) return providerRef.current;
    focusReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selected = await new Promise<WalletProvider | null>(resolve => { walletChoice.current = resolve; setWalletPicker(true); });
    if (!selected) throw new Error('Wallet connection cancelled.');
    return selected;
  }
  function closeWalletPicker() { setWalletPicker(false); walletChoice.current?.(null); walletChoice.current = null; }
  async function selectWallet(name: string) {
    if (selectingWallet) return;
    setSelectingWallet(true);
    const resolve = walletChoice.current;
    try {
      const provider = walletProvider(name); const account = await provider.connect();
      providerRef.current = provider; setWallet(account.publicKey.toBase58()); setError('');
      setWalletPicker(false); resolve?.(provider); if (walletChoice.current === resolve) walletChoice.current = null;
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not connect wallet.'); } finally { setSelectingWallet(false); }
  }
  async function checkout(value: Recovery) {
    const provider = await connect(); const current = await load(value);
    if (provider.publicKey!.toBase58() !== current.wallet) throw new Error('Connect the wallet that created this order.');
    if (current.payment_signed_signature) throw new Error('Verify the existing payment before paying again.');
    setQuote(null); setBusy('Checking wallet balance…');
    const option = await action(value, { action: 'payment-options' });
    if (option.method === 'LUMEN') { await pay(value); return; }
    if (!config?.solEnabled) throw new Error('Not enough LUMEN. SOL checkout is currently unavailable. Add LUMEN to your wallet.');
    setBusy('Getting a SOL quote…'); setQuote(await action(value, { action: 'swap-quote', maxSol: option.maxSol }));
  }
  async function action(value: Recovery, body: Record<string, unknown>) {
    return jsonRequest(`/api/tweet-orders/${value.id}`, { method: 'POST', headers: { 'x-order-token': value.token }, body: JSON.stringify(body) });
  }
  async function create() {
    const provider = await connect();
    const parsed = draftSchema.safeParse({ wallet: provider.publicKey!.toBase58(), kind,
      tweets: posts.map(post => ({ text: post.text, media: post.files.map(file => ({ name: file.name, type: file.type, size: file.size })) })), email, telegram, acceptedTerms: terms });
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);
    const draft = parsed.data; const timestamp = Date.now(); const nonce = crypto.randomUUID();
    const signed = await provider.signMessage(new TextEncoder().encode(signingMessage(draft, timestamp, nonce)), 'utf8');
    const signature = bs58.encode(signed instanceof Uint8Array ? signed : signed.signature);
    const value = await jsonRequest('/api/tweet-orders', { method: 'POST', body: JSON.stringify({ draft, timestamp, nonce, signature }) });
    const recovery = { id: value.id, token: value.token }; remember(recovery);
    let index = 0;
    for (const post of posts) for (const file of post.files) {
      const response = await fetch(value.uploads[index++].url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!response.ok) throw new Error(`Could not upload ${file.name}. Discard the unpaid order and retry.`);
    }
    await load(recovery);
    await checkout(recovery);
  }
  async function pay(value: Recovery) {
    if (value.signature) throw new Error('Verify the saved payment before signing another transaction.');
    const provider = await connect(); const current = await load(value);
    if (provider.publicKey!.toBase58() !== current.wallet) throw new Error('Connect the wallet that created this order.');
    const prepared = await action(value, { action: 'prepare' });
    const signed = await provider.signTransaction(Transaction.from(fromBase64(prepared.transaction)));
    if (!signed.signature) throw new Error('Wallet returned no payment signature.');
    const pending = { ...value, signature: bs58.encode(signed.signature), raw: toBase64(signed.serialize()) }; remember(pending);
    await action(pending, { action: 'broadcast', signedTransaction: pending.raw });
    setBusy('Waiting for final confirmation…');
    for (let attempt = 0; attempt < 12; attempt++) {
      try { setOrder(await action(pending, { action: 'verify', signature: pending.signature })); return; }
      catch (err) { if (!(err instanceof Error) || !err.message.includes('not finalized')) throw err; await new Promise(resolve => setTimeout(resolve, 2500)); }
    }
    throw new Error('Payment sent. Use Verify payment in a moment; no second payment is needed.');
  }
  async function swap(value: Recovery) {
    if (!quote) return;
    const provider = await connect();
    if (provider.publicKey!.toBase58() !== order?.wallet) throw new Error('Connect the wallet that created the order.');
    const signed = await provider.signTransaction(VersionedTransaction.deserialize(fromBase64(quote.transaction)));
    await action(value, { action: 'swap-execute', signedTransaction: toBase64(signed.serialize()) });
    const swapped = { ...value, swapComplete: true }; remember(swapped); setQuote(null);
    setBusy('Sign the LUMEN payment…'); await pay(swapped);
  }
  const submitted = order && order.status !== 'awaiting_payment';
  function discard() { localStorage.removeItem(storage); setSaved(null); setOrder(null); setQuote(null); }
  return <div className="min-h-screen bg-background text-foreground">
    <header className="mx-auto flex max-w-6xl items-center justify-between border-b border-border px-6 py-6">
      <Link href="/" className="flex items-center gap-3 text-xl font-semibold"><Image src="/logo.svg" alt="" width={34} height={34} />lumenless</Link>
      <a href="https://x.com/lumenless" target="_blank" rel="noreferrer" className="flex min-h-10 items-center text-sm text-muted-foreground hover:text-primary">@lumenless ↗</a>
    </header>
    <main className="mx-auto max-w-6xl px-6 py-12 md:py-20">
      <div className="mb-12 max-w-3xl"><p className="mb-4 text-sm font-medium uppercase tracking-widest text-primary">Your voice. Our timeline.</p><h1 className="text-4xl font-semibold tracking-tight md:text-6xl">Put your next idea<br />on <span className="text-primary">@lumenless.</span></h1><p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">Write a tweet or a thread. Pay with LUMEN or SOL. We review it, then publish it to our X account.</p></div>
      <div className="grid items-start gap-8 lg:grid-cols-[1fr_360px]">
        <section className="rounded-2xl border border-border bg-card p-5 md:p-8" aria-label="Tweet composer" aria-busy={!!busy}>
          {submitted ? <div className="space-y-5"><p className="text-sm font-medium text-primary">ORDER RECEIVED</p><h2 className="text-2xl font-semibold capitalize">{order.status.replaceAll('_', ' ')}</h2><p className="text-muted-foreground">Your payment is confirmed. Your content is in our moderation workflow.</p>{order.review_note && <p className="rounded-xl bg-muted p-4">{order.review_note}</p>}{order.published_url && <a href={order.published_url} target="_blank" rel="noreferrer" className="text-primary underline">View your post on X ↗</a>}<p className="break-all text-sm text-muted-foreground">Order {order.id}</p><div className="flex flex-wrap gap-3"><Button disabled={!!busy} onClick={() => run('Refreshing…', async () => { await load(saved!); })}>Refresh status</Button><Button variant="outline" onClick={discard}>Create another order</Button></div></div> : <>
            <div className="mb-7 flex items-center justify-between"><h2 className="text-xl font-semibold">Create your post</h2><span className="text-sm text-muted-foreground">01 / Compose</span></div>
            <fieldset disabled={!!saved || !!busy} className="mb-6 grid grid-cols-2 gap-3"><legend className="sr-only">Post format</legend>{(['tweet', 'thread'] as const).map(value => <label key={value} className={`cursor-pointer rounded-xl border p-4 ${kind === value ? 'border-primary bg-primary/5' : 'border-border'}`}><input type="radio" name="kind" checked={kind === value} onChange={() => { setKind(value); setPosts(value === 'tweet' ? [posts[0]] : posts.length < 2 ? [...posts, { text: '', files: [] }] : posts); }} className="mr-2" /><span className="font-medium">{value === 'tweet' ? 'Single tweet' : 'Thread'}</span><p className="mt-1 text-sm text-muted-foreground">{price(value).toLocaleString('en-US')} LUMEN</p></label>)}</fieldset>
            {saved && order ? <div className="mb-6 space-y-4">{order.tweets.map((post, index) => <div key={index} className="rounded-xl border border-border p-4"><p className="mb-2 text-xs text-muted-foreground">Tweet {index + 1}</p><p className="whitespace-pre-wrap break-words">{post.text}</p>{post.media.map(file => <p key={file.path} className="mt-2 text-xs text-muted-foreground">Attachment: {file.name}</p>)}</div>)}</div> : <form onSubmit={event => { event.preventDefault(); run('Saving your content…', create); }}>
              <fieldset disabled={!!saved || !!busy} className="space-y-6">
                {posts.map((post, index) => <div key={index} className="space-y-3"><div className="flex items-center justify-between"><label htmlFor={`tweet-${index}`} className="text-sm font-medium">Tweet {index + 1}{kind === 'thread' ? ` of ${posts.length}` : ''}</label>{kind === 'thread' && posts.length > 2 && <Button variant="outline" type="button" aria-label={`Remove tweet ${index + 1}`} onClick={() => setPosts(posts.filter((_, i) => i !== index))}>Remove</Button>}</div><textarea id={`tweet-${index}`} value={post.text} maxLength={4000} rows={5} aria-invalid={!!post.text && !parseTweet(post.text).valid} className={`${field} resize-y`} placeholder="What should the timeline know?" onChange={event => setPosts(posts.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} />{post.text && !parseTweet(post.text).valid && <p className="text-sm text-destructive">Use at most 280 weighted characters.</p>}<MediaPreview files={post.files} /><div className="flex items-center justify-between"><label htmlFor={`media-${index}`} className="text-sm text-primary">Photos or video</label><span className="text-xs tabular-nums text-muted-foreground">{parseTweet(post.text).weightedLength}/280</span></div><input id={`media-${index}`} type="file" accept="image/jpeg,image/png,image/webp,video/mp4" multiple className="min-h-10 w-full text-sm" onChange={event => setPosts(posts.map((item, i) => i === index ? { ...item, files: Array.from(event.target.files || []) } : item))} /><p className="text-xs text-muted-foreground">Up to 4 images (10 MB each) or 1 MP4 video (50 MB).</p></div>)}
                {kind === 'thread' && posts.length < 5 && <Button type="button" variant="outline" onClick={() => setPosts([...posts, { text: '', files: [] }])}>+ Add tweet</Button>}
                <div className="border-t border-border pt-6"><h3 className="font-medium">How can we reach you?</h3><p className="mb-4 mt-1 text-sm text-muted-foreground">Both are optional. Leave a contact if we need to discuss changes.</p><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Email (optional)<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" className={`${field} mt-2`} /></label><label className="text-sm">Telegram (optional)<input autoComplete="off" spellCheck={false} value={telegram} onChange={event => setTelegram(event.target.value)} placeholder="@username" className={`${field} mt-2`} /></label></div></div>
                <label className="flex items-start gap-3 text-sm leading-relaxed text-muted-foreground"><input type="checkbox" checked={terms} onChange={event => setTerms(event.target.checked)} className="mt-1 size-4 shrink-0" />I own or have permission to publish this content. Publication requires approval. A rejected order may be refunded or declined without a refund; refunds are paid in LUMEN.</label>
              </fieldset>
              <Button type="submit" className="mt-6 h-12 w-full" disabled={!!saved || !!busy || !terms || !config?.ready}>{busy || 'Continue to payment'}</Button>
            </form>}
            {saved && <div className="mt-6 space-y-4 rounded-xl bg-muted p-4"><p className="font-medium">Content saved. Complete your payment.</p><p className="text-sm text-muted-foreground">Your order enters review after payment is confirmed.</p>{saved.signature ? <><p className="break-all text-xs">Payment: {saved.signature}</p><Button disabled={!!busy} onClick={() => run('Verifying payment…', async () => { setOrder(await action(saved, { action: 'verify', signature: saved.signature })); })}>Verify payment</Button><Button variant="outline" disabled={!!busy || !saved.raw} onClick={() => run('Resending the same transaction…', async () => { await action(saved, { action: 'broadcast', signedTransaction: saved.raw }); })}>Resend same transaction</Button><Button variant="outline" disabled={!!busy} onClick={() => run('Checking failed payment…', async () => { await action(saved, { action: 'reset-payment' }); remember({ id: saved.id, token: saved.token, swapComplete: saved.swapComplete }); await load({ id: saved.id, token: saved.token }); })}>Reset failed or expired payment</Button></> : <>{quote && <div className="space-y-2"><p className="text-sm">Not enough LUMEN. Pay with SOL instead.</p><p className="font-medium">{(Number(quote.inLamports) / 1e9).toFixed(9)} SOL <span className="font-normal text-muted-foreground">+ approximately {(quote.networkFeeLamports / 1e9).toFixed(6)} SOL fees</span></p><p className="text-xs text-muted-foreground">Approve the SOL swap, then the LUMEN payment in your wallet. Extra LUMEN stays in your wallet.</p></div>}<Button disabled={!!busy} onClick={() => run(quote ? 'Swapping SOL to LUMEN…' : 'Checking payment options…', () => quote ? swap(saved) : checkout(saved))}>{quote ? 'Confirm SOL payment' : 'Pay now'}</Button>{quote && <Button variant="outline" disabled={!!busy} onClick={() => run('Refreshing payment options…', () => checkout(saved))}>Refresh quote</Button>}</>}{!saved.signature && <button type="button" disabled={!!busy} className="block min-h-10 text-sm text-muted-foreground underline" onClick={discard}>Discard unpaid order and edit content</button>}</div>}
          </>}
          {error && <p role="alert" className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}{busy && <p role="status" className="mt-4 text-sm text-primary" aria-live="polite">{busy}</p>}
        </section>
        <aside className="space-y-6 lg:sticky lg:top-8"><section className="rounded-2xl border border-border p-6"><p className="text-sm text-muted-foreground">Your placement</p><div className="mt-4 flex items-center gap-3"><Image src="/logo.svg" alt="Lumenless" width={44} height={44} /><div><p className="font-semibold">Lumenless</p><p className="text-sm text-muted-foreground">@lumenless</p></div></div><p className="mt-5 whitespace-pre-wrap break-words text-sm leading-relaxed">{order?.tweets[0]?.text || posts[0].text || 'Your words will appear here. Make them count.'}</p><div className="mt-6 flex justify-between border-t border-border pt-5 text-sm"><span className="text-muted-foreground">{order?.kind || kind}</span><span className="font-semibold tabular-nums">{(order?.amount_tokens || price(kind)).toLocaleString('en-US')} LUMEN</span></div></section>
          <section className="rounded-2xl bg-muted p-6"><Button className="h-12 w-full" disabled={!!busy || !!submitted || !!saved?.signature} onClick={() => run('Connecting wallet…', async () => { await connect(); })}>{wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Connect Wallet'}</Button>{wallet && <button type="button" className="mt-2 min-h-10 w-full text-sm text-muted-foreground underline" disabled={!!busy || !!saved?.signature} onClick={() => { providerRef.current = null; setWallet(''); setQuote(null); run('Connecting wallet…', async () => { await connect(); }); }}>Change wallet</button>}<p className="mt-4 text-xs leading-relaxed text-muted-foreground">Pay with LUMEN automatically. If your balance is insufficient, we’ll offer a SOL quote.</p></section>
          {config === null ? <p className="text-sm text-muted-foreground">Checking payment availability…</p> : !config.ready && <p role="status" className="rounded-xl border border-border p-4 text-sm text-muted-foreground">Checkout opens once the payment, X and Telegram integrations are configured.</p>}
        </aside>
      </div>
    </main>
    <dialog ref={dialogRef} onCancel={event => { event.preventDefault(); closeWalletPicker(); }} onClick={event => { if (event.target === event.currentTarget) closeWalletPicker(); }} aria-labelledby="wallet-dialog-title" className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40">
      <div className="mb-5 flex items-center justify-between"><h2 id="wallet-dialog-title" className="text-xl font-semibold">Connect Wallet</h2><Button variant="ghost" aria-label="Close wallet selection" onClick={closeWalletPicker}>✕</Button></div>
      <p className="mb-5 text-sm text-muted-foreground">Choose your Solana wallet.</p><div className="space-y-3">{['Phantom', 'Solflare', 'Backpack'].map(name => <Button key={name} variant="outline" className="h-12 w-full justify-start" disabled={selectingWallet} onClick={() => selectWallet(name)}>{name}</Button>)}</div>
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    </dialog>
    <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 border-t border-border px-6 py-6 text-xs text-muted-foreground"><span>© {new Date().getFullYear()} Lumenless</span><div className="flex gap-6"><a href="/privacypolicy">Privacy</a><a href="/admin/tweets">Admin</a></div></footer>
  </div>;
}

function MediaPreview({ files }: { files: File[] }) {
  const [previews, setPreviews] = useState<Array<{ url: string; file: File }>>([]);
  useEffect(() => { const items = files.map(file => ({ file, url: URL.createObjectURL(file) })); setPreviews(items); return () => { items.forEach(item => URL.revokeObjectURL(item.url)); }; }, [files]);
  if (!previews.length) return null;
  return <div className="grid gap-3 sm:grid-cols-2">{previews.map((item, index) => item.file.type.startsWith('video/') ? <video key={index} src={item.url} controls preload="metadata" className="max-h-64 w-full rounded-xl" aria-label={item.file.name} /> : <Image unoptimized key={index} src={item.url} alt={item.file.name} width={640} height={400} className="max-h-64 w-full rounded-xl object-contain" />)}</div>;
}
