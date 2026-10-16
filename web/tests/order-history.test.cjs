const fs=require('node:fs'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
const {readOrderHistory,saveOrderHistory,migrateOrderHistory}=require('../src/lib/tweet-orders/order-history.ts');
function storage(){const map=new Map();return {getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value),map};}
const one={id:'41047fe6-a981-4d9f-8f06-1c11037d803c',token:'first-order-token',signature:'signed',raw:'signed-transaction'};
const two={id:'65dc5617-81c7-4433-b6e8-357b5371ec65',token:'second-order-token'};
test('migrates both legacy keys without losing signed recovery or older orders',()=>{
 const s=storage();s.setItem('lumenless-tweet-order',JSON.stringify(one));s.setItem('lumenless-tweet-order:lumenless',JSON.stringify(two));
 assert.deepEqual(migrateOrderHistory(s,'lumenless'),[two,one]);assert.deepEqual(JSON.parse(s.getItem('lumenless-tweet-orders:lumenless')),[two,one]);
 const three={id:'96074246-44a9-4718-8a61-8e1c8f5d61ae',token:'third-token'};assert.deepEqual(saveOrderHistory(s,'lumenless',three),[three,two,one]);assert.deepEqual(readOrderHistory(s,'lumenless'),[three,two,one]);
});
test('saving new orders preserves every existing order and updates the same ID without duplicates',()=>{
 const s=storage();saveOrderHistory(s,'heymike777',one);saveOrderHistory(s,'heymike777',two);const paid={...two,signature:'payment',raw:'full-transaction'};
 assert.deepEqual(saveOrderHistory(s,'heymike777',paid),[paid,one]);assert.deepEqual(readOrderHistory(s,'heymike777'),[paid,one]);
});
test('a proven failed-payment reset does not resurrect stale signatures from legacy storage',()=>{
 const s=storage();saveOrderHistory(s,'lumenless',one);s.setItem('lumenless-tweet-order',JSON.stringify(one));const reset={id:one.id,token:one.token};saveOrderHistory(s,'lumenless',reset);
 assert.deepEqual(readOrderHistory(s,'lumenless'),[reset]);
});
test('account histories stay separate and invalid data is ignored without deleting valid records',()=>{
 const s=storage();saveOrderHistory(s,'lumenless',one);assert.deepEqual(readOrderHistory(s,'heymike777'),[]);s.setItem('lumenless-tweet-orders:heymike777',JSON.stringify([two,{id:'invalid',token:'bad'},{...one,token:''}]));s.setItem('lumenless-tweet-order:heymike777','malformed');assert.deepEqual(readOrderHistory(s,'heymike777'),[two]);
});
test('storage failures are surfaced before replacing the legacy payment recovery pointer',()=>{
 const s=storage();s.setItem('lumenless-tweet-order:lumenless',JSON.stringify(one));s.setItem=()=>{throw Error('Quota exceeded');};assert.throws(()=>saveOrderHistory(s,'lumenless',two),/Quota/);assert.deepEqual(JSON.parse(s.getItem('lumenless-tweet-order:lumenless')),one);
});
