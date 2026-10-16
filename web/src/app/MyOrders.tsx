'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { TweetOrder } from '@/lib/tweet-orders/model';
import { displayAmount,orderTerms } from '@/lib/tweet-orders/billing';
import { Recovery } from '@/lib/tweet-orders/order-history';
import { jsonRequest } from '@/lib/tweet-orders/wallet';
export default function MyOrders({open,onClose,records,onResume,onNewOrder}:{open:boolean;onClose:()=>void;records:Recovery[];onResume:(value:Recovery)=>void;onNewOrder:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),returnFocus=useRef<HTMLElement|null>(null);
  const [limit,setLimit]=useState(5),[revision,setRevision]=useState(0);
  const [results,setResults]=useState<Record<string,{order?:TweetOrder;error?:string}>>({});
  useEffect(()=>{if(open){returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;dialog.current?.showModal();}else{dialog.current?.close();const target=returnFocus.current;if(target){if(target.isConnected&&!target.matches(':disabled'))target.focus();else document.getElementById('my-orders-trigger')?.focus();returnFocus.current=null;}}},[open]);
  useEffect(()=>{
    if(!open)return;
    let active=true;
    for(const value of records.slice(0,limit)){
      setResults(current=>({...current,[value.id]:{}}));
      jsonRequest(`/api/tweet-orders/${value.id}`,{cache:'no-store',headers:{'x-order-token':value.token},signal:AbortSignal.timeout(15000)}).then(order=>{if(active)setResults(current=>({...current,[value.id]:{order}}));}).catch(()=>{if(active)setResults(current=>({...current,[value.id]:{error:'Could not refresh this order. Retry or check its status by ID.'}}));});
    }
    return()=>{active=false;};
  },[open,records,limit,revision]);
  return <dialog ref={dialog} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}} aria-labelledby="my-orders-title" className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-border bg-background p-5 text-foreground shadow-xl backdrop:bg-black/40 sm:p-7">
    <div className="flex items-center justify-between gap-4"><h2 id="my-orders-title" className="text-2xl font-semibold">My orders</h2><Button variant="ghost" className="size-10" aria-label="Close my orders" onClick={onClose}>✕</Button></div>
    <p className="mt-2 text-sm text-muted-foreground">Orders saved in this browser. Looking up an order here won’t change your new post.</p>
    {records.length===0?<div className="my-6 rounded-xl bg-muted p-5"><p className="font-medium">No orders yet</p><p className="mt-2 text-sm text-muted-foreground">Your orders will appear here after you create them. Have an Order ID from another browser? Check it below.</p></div>:<div className="my-6 space-y-4">{records.slice(0,limit).map(value=>{const result=results[value.id],order=result?.order;return <article key={value.id} className="space-y-3 rounded-xl border border-border p-4">
      {order?<><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-medium">{order.kind==='thread'?'Thread':'Tweet'} · {displayAmount(orderTerms(order).amount)} {orderTerms(order).symbol}</h3><span className="text-sm capitalize text-primary">{order.status.replaceAll('_',' ')}</span></div><p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">{order.tweets[0]?.text||'Media post'}</p><p className="text-xs text-muted-foreground">For @{order.target_username||'lumenless'} · {new Date(order.created_at).toLocaleDateString()}</p>{order.review_note&&<p className="text-sm text-muted-foreground">{order.review_note}</p>}</>:result?.error?<p role="alert" className="text-sm text-destructive">{result.error}</p>:<div role="status" className="space-y-2"><span className="sr-only">Loading order</span><div className="h-4 w-2/3 rounded bg-muted"/><div className="h-12 rounded bg-muted"/></div>}
      <p className="break-all font-mono text-xs text-muted-foreground">{value.id}</p><div className="flex flex-wrap gap-3">{order?.status==='awaiting_payment'&&<Button onClick={()=>onResume(value)}>Continue payment</Button>}<Button asChild variant="outline" className="min-h-10"><a href={`/orders?id=${value.id}`} target="_blank" rel="noreferrer">Track order ↗</a></Button></div>
    </article>;})}</div>}
    <div className="flex flex-wrap gap-3">{records.length>limit&&<Button variant="outline" onClick={()=>setLimit(limit+5)}>Show older orders</Button>}{records.length>0&&<Button variant="outline" onClick={()=>setRevision(revision+1)}>Refresh orders</Button>}<Button onClick={onNewOrder}>Back to new post</Button><Button asChild variant="ghost" className="min-h-10"><a href="/orders" target="_blank" rel="noreferrer">Look up an Order ID ↗</a></Button></div>
  </dialog>;
}
