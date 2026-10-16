import { z } from 'zod';
const recoverySchema = z.object({id:z.string().uuid(),token:z.string().min(1).max(500),signature:z.string().max(100).optional(),raw:z.string().max(10000).optional(),swapComplete:z.boolean().optional()});
export type Recovery = z.infer<typeof recoverySchema>;
type Storage = Pick<globalThis.Storage,'getItem'|'setItem'>;
const key = (username:string) => `lumenless-tweet-orders:${username}`;
function parse(value:string|null):Recovery[]{
  if(!value)return [];
  try{const data=JSON.parse(value);return (Array.isArray(data)?data:[data]).flatMap(item=>{const result=recoverySchema.safeParse(item);return result.success?[result.data]:[];});}catch{return [];}
}
export function readOrderHistory(storage:Storage,username:string):Recovery[]{
  const values=[...parse(storage.getItem(key(username))),...parse(storage.getItem(`lumenless-tweet-order:${username}`)),...(username==='lumenless'?parse(storage.getItem('lumenless-tweet-order')):[])];
  const unique=new Map<string,Recovery>();
  for(const value of values)if(!unique.has(value.id))unique.set(value.id,value);
  return [...unique.values()];
}
export function saveOrderHistory(storage:Storage,username:string,value:Recovery):Recovery[]{
  const parsed=recoverySchema.parse(value);
  const values=readOrderHistory(storage,username);
  // Persist all previous orders before replacing the legacy current-order pointer.
  // Explicitly cleared signatures (after an on-chain failure reset) stay cleared.
  const next=[parsed,...values.filter(item=>item.id!==parsed.id)];
  storage.setItem(key(username),JSON.stringify(next));
  storage.setItem(`lumenless-tweet-order:${username}`,JSON.stringify(parsed));
  return next;
}
export function migrateOrderHistory(storage:Storage,username:string):Recovery[]{
  const values=readOrderHistory(storage,username);
  if(values.length)storage.setItem(key(username),JSON.stringify(values));
  return values;
}
