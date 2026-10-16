'use client';
import { useEffect, useRef, useState } from 'react';
import { jsonRequest } from '@/lib/tweet-orders/wallet';
import { Button } from '@/components/ui/button';
import { LUMEN_MINT } from '@/lib/tweet-orders/model';
import { USDC_MINT } from '@/lib/tweet-orders/billing';
const field='mt-2 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary';
export default function PublishingSettings({ username }: { username: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [setupOpen,setSetupOpen]=useState(false);const [ready,setReady]=useState(false);const [copied,setCopied]=useState(false);const [copyError,setCopyError]=useState('');
  const shareUrl=`https://www.lumenless.com/u/${username.toLowerCase()}`;
  useEffect(()=>{const node=dialog.current;if(!node)return;if(setupOpen&&!node.open)node.showModal();else if(!setupOpen&&node.open){node.close();trigger.current?.focus();}},[setupOpen]);
  const [enabled,setEnabled]=useState(true);const [loaded,setLoaded]=useState(false);
  const [token,setToken]=useState('LUMEN');const [tweet,setTweet]=useState('1000000');const [thread,setThread]=useState('3000000');
  const [mint,setMint]=useState('');const [symbol,setSymbol]=useState('TOKEN');const [wallet,setWallet]=useState('');const [escrow,setEscrow]=useState('');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [saved,setSaved]=useState(false);
  async function load(){setError('');try{const data=await jsonRequest('/api/business/settings',{cache:'no-store'});setEnabled(data.paidPartnership);const b=data.billing;if(b){setTweet(b.tweet_price);setThread(b.thread_price);setWallet(b.payout_wallet||'');setEscrow(b.escrow_address||'');setToken(b.payment_asset==='SOL'?'SOL':b.payment_mint===LUMEN_MINT?'LUMEN':b.payment_mint===USDC_MINT?'USDC':'CUSTOM');setMint(b.payment_mint||'');setSymbol(b.payment_symbol||'TOKEN');}const complete=!!b?.payout_wallet&&!!b?.escrow_address;setReady(complete);setSetupOpen(!complete);setLoaded(true);}catch(err){setError(err instanceof Error?err.message:'Could not load settings.');}}
  useEffect(()=>{void load();},[]);

  const form=<form onChange={()=>setSaved(false)} onSubmit={async event=>{event.preventDefault();setBusy(true);setError('');try{const data=await jsonRequest('/api/business/settings',{method:'POST',body:JSON.stringify({paidPartnership:enabled,token,tweetPrice:tweet,threadPrice:thread,customMint:mint,customSymbol:symbol,payoutWallet:wallet})});setEscrow(data.billing.escrow_address);setSaved(true);setReady(!!data.billing.payout_wallet&&!!data.billing.escrow_address);setSetupOpen(false);}catch(err){setError(err instanceof Error?err.message:'Could not save settings.');}finally{setBusy(false);}}} className="mt-4 space-y-4">
    <fieldset disabled={!loaded||busy} className="space-y-4"><label className="block text-sm">Payment token<select value={token} onChange={e=>setToken(e.target.value)} className={field}>{['LUMEN','SOL','USDC','CUSTOM'].map(v=><option key={v} value={v}>{v==='CUSTOM'?'Custom mint':v}</option>)}</select></label>
    {token==='CUSTOM'&&<><label className="block text-sm">Token mint<input required value={mint} onChange={e=>setMint(e.target.value.trim())} className={field} spellCheck={false}/></label><label className="block text-sm">Display symbol<input required maxLength={16} value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())} className={field}/></label></>}
    <div className="grid grid-cols-2 gap-3"><label className="block text-sm">One tweet<input required inputMode="decimal" value={tweet} onChange={e=>setTweet(e.target.value)} className={field}/></label><label className="block text-sm">Thread (2–5 tweets)<input required inputMode="decimal" value={thread} onChange={e=>setThread(e.target.value)} className={field}/></label></div>
    <label className="block text-sm">Your receiving wallet<input autoComplete="off" required value={wallet} onChange={e=>setWallet(e.target.value.trim())} className={field} spellCheck={false} placeholder="Solana wallet address"/></label><p className="text-xs leading-relaxed text-muted-foreground">Payments are held in your account’s escrow. You can claim 90% 24 hours after successful publication if every post still exists. Lumenless receives a 10% fee. Your receiving wallet signs claims and pays network fees.</p>
    {escrow&&<div className="rounded-xl bg-muted p-3"><p className="text-xs text-muted-foreground">Your escrow wallet</p><p className="mt-1 break-all font-mono text-xs">{escrow}</p></div>}
    <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} className="mt-1 size-4 shrink-0 accent-primary"/><span><span className="font-medium">Paid Partnership</span><span className="mt-1 block text-muted-foreground">Add X’s Paid Partnership label to every post, including each post in a thread.</span></span></label><p className="text-xs text-muted-foreground">Prices and token settings apply to new orders. Existing orders keep their payment terms.</p><Button type="submit" variant="outline">{busy?'Saving…':saved?'Settings saved':ready?'Save settings':'Save & start accepting orders'}</Button></fieldset>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </form>;
  return <section className="mt-6 space-y-5">
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <h3 className="font-medium">Share your order page</h3><p className="mt-1 text-sm text-muted-foreground">Send this link to clients or add it to your X bio.</p>
      <a href={shareUrl} target="_blank" rel="noreferrer" className="mt-3 block break-all text-sm font-medium text-primary underline underline-offset-4">{shareUrl}</a>
      <Button variant="outline" className="mt-3 min-h-10" onClick={async()=>{setCopyError('');try{await navigator.clipboard.writeText(shareUrl);setCopied(true);}catch{setCopyError('Could not copy. Select the link above to copy it manually.');}}}>{copied?'Copied!':'Copy link'}</Button>
      <p role="status" className="mt-2 text-xs text-muted-foreground">{!loaded?'Checking your setup…':ready?'Your page is ready to accept paid orders.':'Your link is ready. Complete setup before clients can pay.'}</p>
      {copyError&&<p role="alert" className="mt-2 text-sm text-destructive">{copyError}</p>}
    </div>
    {!loaded ? <div role="status" className="rounded-xl border border-border p-4 text-sm">{error?<><p role="alert">{error}</p><Button variant="outline" className="mt-3" onClick={()=>void load()}>Retry settings</Button></>:'Loading pricing & payouts…'}</div> : <>
      <div className={`rounded-xl border p-4 ${ready?'border-border':'border-primary/30 bg-primary/5'}`}>
        <p className="font-medium">{ready?'Pricing & payouts':'Finish setup to start earning'}</p>
        <p className="mt-1 text-sm text-muted-foreground">{ready?'Manage your rates, payment token and receiving wallet.':'Choose your payment token, set tweet and thread prices, and add the Solana wallet where you’ll receive earnings. New orders are paused until you save these settings.'}</p>
        <Button ref={trigger} variant={ready?'outline':'default'} className="mt-3 min-h-10" onClick={()=>{setSaved(false);setSetupOpen(true);}}>{ready?'Edit pricing & payouts':'Complete setup'}</Button>
        {saved&&<p role="status" className="mt-3 text-sm text-primary">Settings saved. You’re ready to receive paid orders.</p>}
      </div>
      <dialog ref={dialog} aria-labelledby="publishing-setup-title" onCancel={event=>{event.preventDefault();if(!busy)setSetupOpen(false);}} onClick={event=>{if(event.target===event.currentTarget&&!busy)setSetupOpen(false);}} className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-background p-5 text-foreground shadow-xl backdrop:bg-black/40 sm:p-7">
        <div className="flex items-start justify-between gap-4"><div><h2 id="publishing-setup-title" className="text-xl font-semibold">{ready?'Pricing & payouts':'Set up your paid posts'}</h2><p className="mt-2 text-sm text-muted-foreground">@{username} · Choose what clients pay and where you receive earnings.</p></div><button type="button" aria-label="Close setup" disabled={busy} onClick={()=>setSetupOpen(false)} className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-primary">×</button></div>
        {form}
      </dialog>
    </>}
  </section>;
}
