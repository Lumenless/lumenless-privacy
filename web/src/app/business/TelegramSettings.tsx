'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { jsonRequest } from '@/lib/tweet-orders/wallet';
type Connection={connected:boolean;username:string|null;connectedAt:string|null};
type Link={url:string;expiresAt:string};
export default function TelegramSettings(){
  const [connection,setConnection]=useState<Connection|null>(null),[link,setLink]=useState<Link|null>(null);
  const [busy,setBusy]=useState('Loading Telegram settings…'),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function refresh(){const result=await jsonRequest('/api/business/telegram',{cache:'no-store',signal:AbortSignal.timeout(15000)});setConnection(result);if(result.connected)setLink(null);}
  useEffect(()=>{let active=true;jsonRequest('/api/business/telegram',{cache:'no-store',signal:AbortSignal.timeout(15000)}).then(result=>{if(active)setConnection(result);}).catch(()=>{if(active)setError('Could not load Telegram settings. Try again.');}).finally(()=>{if(active)setBusy('');});return()=>{active=false;};},[]);
  async function run(label:string,task:()=>Promise<void>){setBusy(label);setError('');setNotice('');try{await task();}catch(error){setError(error instanceof Error?error.message:'Could not update Telegram. Please retry.');}finally{setBusy('');}}
  async function action(action:string){return jsonRequest('/api/business/telegram',{method:'POST',body:JSON.stringify({action}),signal:AbortSignal.timeout(30000)});}
  return <section className="mt-7 space-y-4 border-t border-border pt-6" aria-busy={!!busy}>
    <h3 className="font-medium">Telegram notifications</h3>
    <p className="text-sm leading-relaxed text-muted-foreground">Get new paid orders for this X account in your private chat with @lumenless_bot.</p>
    {!connection&&busy&&<div className="h-12 rounded-xl bg-muted" role="status"><span className="sr-only">Loading Telegram settings</span></div>}
    {connection?.connected?<><p className="break-words text-sm text-primary">Connected {connection.username?`to @${connection.username}`:'to your private Telegram chat'}</p><div className="flex flex-wrap gap-3"><Button variant="outline" disabled={!!busy} onClick={()=>run('Sending test notification…',async()=>{await action('test');setNotice('Test notification sent. Check Telegram.');})}>Send test</Button><Button variant="ghost" disabled={!!busy} onClick={()=>run('Disconnecting Telegram…',async()=>{await action('disconnect');setLink(null);await refresh();setNotice('Telegram notifications disconnected.');})}>Disconnect Telegram</Button></div></>:connection&&<Button variant="outline" disabled={!!busy} onClick={()=>run('Creating connection link…',async()=>{setLink(await action('connect'));})}>{link?'Create new link':'Connect Telegram'}</Button>}
    {link&&<div className="space-y-3 rounded-xl bg-muted p-4"><p className="text-sm">Open the bot and press Start. Then return here and check the connection. Keep this link private; it expires in 10 minutes.</p><a href={link.url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring">Open Telegram bot ↗</a><div><Button variant="outline" disabled={!!busy} onClick={()=>run('Checking Telegram connection…',async()=>{const result=await jsonRequest('/api/business/telegram',{cache:'no-store',signal:AbortSignal.timeout(15000)});setConnection(result);if(result.connected){setLink(null);setNotice('Telegram connected. New orders will arrive in your chat.');}else setNotice('Not connected yet. Press Start in Telegram, then check again.');})}>Check connection</Button></div></div>}
    {busy&&<p role="status" className="text-sm text-muted-foreground">{busy}</p>}{notice&&<p role="status" className="text-sm text-primary">{notice}</p>}{error&&<div className="space-y-3"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" disabled={!!busy} onClick={()=>run('Reloading Telegram settings…',refresh)}>Retry</Button></div>}
  </section>;
}
