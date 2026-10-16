const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
const resolve=Module._resolveFilename;Module._resolveFilename=function(request,...args){return resolve.call(this,request.startsWith('@/')?path.join(__dirname,'../src',request.slice(2)):request,...args);};
const {canRejectWithoutRefund}=require('../src/lib/business/moderation-policy.ts');
const server=require('../src/lib/tweet-orders/server.ts');
const route=require('../src/app/api/business/tweets/route.ts');
const {NextRequest}=require('next/server');
test('only immutable personal X IDs can reject without refund',()=>{
 for(const id of ['1644933348274446336','1635207257339179010'])assert.equal(canRejectWithoutRefund(id),true);
 for(const id of [null,undefined,'','lumenless','heymike777','999'])assert.equal(canRejectWithoutRefund(id),false);
});
test('API enforces refund requirement even if another account uses the lumenless username',async()=>{
 const old={requireAdmin:server.requireAdmin,order:server.order,db:server.db};let id='999',reads=0,writes=[];
 server.requireAdmin=async()=>({account:{id,username:'lumenless'}});
 server.order=async()=>{reads++;return{id:'example',status:'pending_review'};};
 server.db=()=>({from(){return{update(value){writes.push(value);return{eq(){return this;},select(){return this;},async maybeSingle(){return{data:{id:'example'},error:null};}};}};}});
 async function request(action){return route.POST(new NextRequest('https://business.lumenless.com/api/business/tweets',{method:'POST',headers:{host:'business.lumenless.com',origin:'https://business.lumenless.com','content-type':'application/json'},body:JSON.stringify({id:'example',action,note:'Test reason'})}));}
 try{
  assert.equal((await request('reject')).status,403);assert.equal(reads,0);assert.equal(writes.length,0);
  assert.equal((await request('reject-refund')).status,200);assert.equal(writes.at(-1).status,'refund_pending');
  for(id of ['1644933348274446336','1635207257339179010']){assert.equal((await request('reject')).status,200);assert.equal(writes.at(-1).status,'rejected');}
 }finally{Object.assign(server,old);}
});
