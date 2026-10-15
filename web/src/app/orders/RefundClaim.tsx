'use client';
import { useEffect, useRef, useState } from 'react';
import { Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { Button } from '@/components/ui/button';
import { WALLET_NAMES, walletProvider, WalletProvider, authorizeOrderMessage, fromBase64, toBase64, jsonRequest } from '@/lib/tweet-orders/wallet';
import { refundAuthorizationMessage, RefundAuthorization } from '@/lib/tweet-orders/refund-model';
import { displayAmount } from '@/lib/tweet-orders/billing';
type Prepared = {transaction:string;feePayer:string;refundAmount:string;refundSymbol:string};
export default function RefundClaim({id,claimable,pending,deadline,onRefresh}:{id:string;claimable:boolean;pending:boolean;deadline:string|null;onRefresh:()=>Promise<void>}) {
  const [busy,setBusy] = useState(''); const [error,setError] = useState(''); const [picker,setPicker] = useState(false);
  const [prepared,setPrepared] = useState<Prepared|null>(null);const [signature,setSignature] = useState('');const [uncertain,setUncertain]=useState(false);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const proof=useRef<RefundAuthorization|null>(null),provider=useRef<WalletProvider|null>(null),dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),attempt=useRef(0);
  useEffect(()=>{if(picker){dialog.current?.showModal();}else{dialog.current?.close();trigger.current?.focus();}},[picker]);
  function closePicker(){attempt.current++;setPicker(false);setBusy('');}
  async function api(action:string,extra={}) {
    if(!proof.current)throw new Error('Reconnect your paying wallet to continue.');
    return jsonRequest(`/api/order-refunds/${id}`,{method:'POST',body:JSON.stringify({action,authorization:proof.current,...extra}),signal:AbortSignal.timeout(25_000)});
  }
  async function run(label:string,task:()=>Promise<void>) {setBusy(label);setError('');try{await task();}catch(error){setError(error instanceof Error?error.message:'Could not process your refund.');}finally{setBusy('');}}
  async function selectWallet(name:string) {
    const generation=++attempt.current;
    await run(`Connecting ${name}…`,async()=>{
      const selected=walletProvider(name);let timer:ReturnType<typeof setTimeout>|undefined;let account;try{account=await Promise.race([selected.connect(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Wallet connection timed out. Unlock your extension and try again.')),45_000);})]);}finally{if(timer)clearTimeout(timer);}if(!alive.current||generation!==attempt.current)return;
      setPicker(false);setBusy('Sign the refund request in your wallet (no payment)…');
      const authorization={wallet:account.publicKey.toBase58(),timestamp:Date.now(),nonce:crypto.randomUUID()};
      const signed=await authorizeOrderMessage(selected,new TextEncoder().encode(refundAuthorizationMessage(id,authorization)));if(!alive.current||generation!==attempt.current)return;
      proof.current={...authorization,signature:bs58.encode(signed instanceof Uint8Array?signed:signed.signature)};provider.current=selected;
      setBusy('Checking the 72-hour deadline and preparing your refund…');const result=await api('prepare');
      setUncertain(false);setPrepared(null);setSignature(result.signature||'');
      if(!result.settled&&!result.pending){if(result.feePayer!==authorization.wallet)throw new Error('Refund signer does not match your paying wallet.');setPrepared(result);}
      await onRefresh();
    });
  }
  async function verify(){await api('verify');setPrepared(null);setUncertain(false);await onRefresh();}
  async function claim(){
    if(!prepared||!provider.current)throw new Error('Reconnect your paying wallet to prepare the refund.');
    if(provider.current.publicKey?.toBase58()!==prepared.feePayer)throw new Error('Your wallet account changed. Reconnect the original paying wallet.');
    setBusy('Review and sign the refund transaction in your wallet…');
    const signed=await provider.current.signTransaction(Transaction.from(fromBase64(prepared.transaction)));
    if(!alive.current)return;
    const raw=toBase64(signed.serialize({requireAllSignatures:false}));setPrepared(null);setUncertain(true);setBusy('Submitting your refund…');
    const result=await api('broadcast',{signedTransaction:raw});setSignature(result.signature);setUncertain(false);setBusy('Waiting for final confirmation…');
    for(let i=0;i<12&&alive.current;i++){try{await verify();return;}catch(error){if(!(error instanceof Error)||!error.message.includes('not finalized'))throw error;await new Promise(resolve=>setTimeout(resolve,2500));}}
    throw new Error('Refund submitted. Verify it shortly; do not sign another transaction.');
  }
  return <div className="space-y-4 border-t border-border pt-5" aria-busy={!!busy}>
    <h3 className="font-medium">Refund after 72 hours</h3>
    <p className="text-sm leading-relaxed text-muted-foreground">If the publisher makes no approval or rejection within 72 hours of payment confirmation, the paying wallet can claim a full refund. No platform fee. Your wallet pays network fees and any token-account rent.</p>
    {deadline&&!claimable&&!pending&&<p className="text-sm text-muted-foreground">Available after {new Date(deadline).toLocaleString()}. Refresh the order status after that time.</p>}
    {!prepared&&!signature&&!uncertain&&<Button ref={trigger} disabled={!!busy||(!claimable&&!pending)} onClick={()=>{setError('');setPicker(true);}}>{pending?'Connect wallet to continue refund':'Connect wallet to request refund'}</Button>}
    {prepared&&<div className="space-y-3 rounded-xl bg-muted p-4"><p className="font-medium">You receive {displayAmount(prepared.refundAmount)} {prepared.refundSymbol}</p><p className="text-xs text-muted-foreground">To your original paying wallet <span className="font-mono" title={prepared.feePayer}>{prepared.feePayer.slice(0,6)}…{prepared.feePayer.slice(-4)}</span>. Platform fee: 0. Review network fees in your wallet before signing.</p><Button disabled={!!busy} onClick={()=>run('Preparing refund signature…',claim)}>Sign & claim refund</Button><Button variant="ghost" disabled={!!busy} onClick={()=>setPicker(true)}>Reconnect wallet</Button></div>}
    {signature&&<div className="space-y-3"><a href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noreferrer" className="text-sm text-primary underline">View refund transaction ↗</a><div className="flex flex-wrap gap-3"><Button disabled={!!busy} onClick={()=>run('Checking refund…',verify)}>Verify refund</Button><Button variant="outline" disabled={!!busy} onClick={()=>run('Resending the same refund…',async()=>{await api('broadcast',{signedTransaction:''});await verify();})}>Resend same transaction</Button><Button variant="outline" disabled={!!busy} onClick={()=>run('Checking failed refund…',async()=>{await api('reset');setSignature('');proof.current=null;await onRefresh();})}>Reset failed refund</Button></div><Button variant="ghost" disabled={!!busy} onClick={()=>setPicker(true)}>Reconnect wallet</Button></div>}
    {uncertain&&<><p className="text-sm text-muted-foreground">The submission result is unknown. Reconnect to recover the existing refund before signing another transaction.</p><Button disabled={!!busy} onClick={()=>setPicker(true)}>Reconnect to recover refund</Button></>}
    {busy&&<p role="status" className="text-sm text-primary">{busy}</p>}{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    <dialog ref={dialog} onCancel={event=>{event.preventDefault();closePicker();}} onClick={event=>{if(event.target===event.currentTarget)closePicker();}} aria-labelledby="refund-wallet-title" className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40"><div className="mb-5 flex items-center justify-between gap-3"><h2 id="refund-wallet-title" className="text-xl font-semibold">Connect paying wallet</h2><Button variant="ghost" onClick={closePicker} aria-label="Close wallet selection">✕</Button></div><p className="mb-5 text-sm text-muted-foreground">Choose the wallet you used to pay for this order.</p><div className="space-y-3">{WALLET_NAMES.map(name=><Button key={name} variant="outline" className="h-12 w-full justify-start" disabled={!!busy} onClick={()=>selectWallet(name)}>{name}</Button>)}</div>{busy&&<p role="status" className="mt-4 text-sm text-primary">{busy}</p>}{error&&<p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}</dialog>
  </div>;
}
