const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '../src', request.slice(2)) : request, ...args); };
process.env.BUSINESS_SESSION_SECRET = 'ab'.repeat(32);
process.env.BUSINESS_APP_URL = 'http://127.0.0.1:3017';
process.env.X_CLIENT_ID = 'example-client-id';
process.env.X_CLIENT_SECRET = 'example-app-secret';
const { NextRequest } = require('next/server');
const sessions = require('../src/lib/business/session.ts');
const start = require('../src/app/api/business/x/start/route.ts');
const server = require('../src/lib/tweet-orders/server.ts');
let saved, saveError;
server.db = () => ({ from(table) { if(table === 'tweet_orders') return { update(value) { assert.equal(value.target_x_user_id,'999'); return { is(field,v) { assert.equal(field,'target_x_user_id'); assert.equal(v,null); return { async eq(field,v) { assert.equal(field,'target_username'); assert.equal(v,'lumenless'); return {error:null}; } }; } }; } }; assert.equal(table, 'business_x_accounts'); return { async upsert(value) { saved=value; return {error:saveError}; } }; } });
const callback = require('../src/app/api/business/x/callback/route.ts');
const exporter = require('../src/app/api/business/x/export/route.ts');
const reader = require('../src/app/api/business/x/session/route.ts');
const logout = require('../src/app/api/business/x/logout/route.ts');
const origin = process.env.BUSINESS_APP_URL;
const credentials = { type:'credentials',expires:Date.now()+600000,account:{id:'123',name:'Example',username:'example'},accessToken:'user-access',refreshToken:'user-refresh',persisted:true,moderation:true,tokenExpiresAt:new Date(Date.now()+7200000).toISOString(),scope:sessions.SCOPES.join(' ') };
function req(endpoint, method='POST', cookie='', requestOrigin=origin) {return new NextRequest(origin+'/api/business/x/'+endpoint,{method,headers:{host:new URL(origin).host,origin:requestOrigin,...(cookie?{cookie}:{})}});}
function cookie(value,name=sessions.SESSION_COOKIE){return name+'='+sessions.sealSession(value);}
test('encrypted cookies hide secrets, detect tampering, expire, and isolate purposes',()=>{
 const token=sessions.sealSession(credentials);assert.ok(!token.includes('user-refresh'));assert.deepEqual(sessions.openSession(token,'credentials'),credentials);
 const bytes=Buffer.from(token,'base64url');bytes[30]^=1;assert.equal(sessions.openSession(bytes.toString('base64url'),'credentials'),null);
 assert.equal(sessions.openSession(token,'oauth'),null);assert.equal(sessions.openSession(sessions.sealSession({...credentials,expires:Date.now()-1}),'credentials'),null);
 assert.notEqual(sessions.sealSession(credentials),token);assert.throws(()=>sessions.sealSession({...credentials,accessToken:'x'.repeat(5000)}));
});
test('OAuth starts with PKCE, encrypted state, required scopes and no client secret',async()=>{
 const response=await start.POST(req('start'));assert.equal(response.status,200);const data=await response.json();const url=new URL(data.url);
 assert.equal(url.origin,'https://x.com');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(!data.url.includes('example-app-secret'));
 const flow=sessions.openSession(response.cookies.get(sessions.FLOW_COOKIE).value,'oauth');assert.equal(flow.state,url.searchParams.get('state'));
 assert.equal(url.searchParams.get('redirect_uri'),origin+'/api/business/x/callback');assert.ok(url.searchParams.get('scope').includes('offline.access'));
 assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');
});
test('foreign-origin starts and exports are rejected',async()=>{
 assert.equal((await start.POST(req('start','POST','','https://evil.example'))).status,403);
 assert.equal((await exporter.POST(req('export','POST',cookie(credentials),'https://evil.example'))).status,410);
});
test('credentials cannot be exported without a valid session',async()=>{
 assert.equal((await exporter.POST(req('export'))).status,410);
 assert.equal((await exporter.POST(req('export','POST',cookie({...credentials,expires:Date.now()-1})))).status,410);
});
test('session endpoint reveals account details but no token or app secret',async()=>{
 const response=await reader.GET(req('session','GET',cookie({...credentials,account:{...credentials.account,username:'lumenless'}})));const data=await response.json();
 assert.equal(data.account.id,'123');assert.ok(!JSON.stringify(data).includes('user-refresh'));assert.ok(!JSON.stringify(data).includes('user-access'));assert.ok(!JSON.stringify(data).includes('example-app-secret'));
});
test('old credential cookies cannot export tokens',async()=>{const r=await exporter.POST(req('export','POST',cookie(credentials)));assert.equal(r.status,410);assert.ok(!(await r.text()).includes('user-refresh'));});
test('forged state and cancellation do not exchange tokens',async()=>{
 const original=global.fetch;global.fetch=async()=>{throw new Error('Network should not run');};
 try {
  const response=await callback.GET(new NextRequest(origin+'/api/business/x/callback?code=unused&state=forged'));assert.equal(new URL(response.headers.get('location')).searchParams.get('error'),'invalid_session');
  const flow={type:'oauth',expires:Date.now()+600000,state:'valid-state',verifier:'verifier'};
  const denied=await callback.GET(new NextRequest(origin+'/api/business/x/callback?error=access_denied&state=valid-state',{headers:{cookie:cookie(flow,sessions.FLOW_COOKIE)}}));assert.equal(new URL(denied.headers.get('location')).searchParams.get('error'),'access_denied');
 }finally{global.fetch=original;}
});
test('callback accepts the authenticated X account and binds returned credentials to its session',async()=>{
 const original=global.fetch;const flow={type:'oauth',expires:Date.now()+600000,state:'valid-state',verifier:'verifier'};
 global.fetch=async(url,init)=>{
  if(url.endsWith('/oauth2/token')){assert.equal(init.body.get('code_verifier'),'verifier');return Response.json({access_token:'account-access',refresh_token:'account-refresh',token_type:'bearer',expires_in:7200,scope:sessions.SCOPES.join(' ')});}
  return Response.json({data:{id:'999',username:'lumenless',name:'Any User'}});
 };
 try{const response=await callback.GET(new NextRequest(origin+'/api/business/x/callback?code=valid&state=valid-state',{headers:{cookie:cookie(flow,sessions.FLOW_COOKIE)}}));
  const session=sessions.openSession(response.cookies.get(sessions.SESSION_COOKIE)?.value,'credentials');assert.equal(session.account.id,'999');assert.equal(saved.refresh_token,'account-refresh');assert.equal(saved.x_user_id,'999');assert.equal(session.persisted,true);assert.equal(session.refreshToken,undefined);assert.equal(session.accessToken,undefined);
  assert.equal(response.cookies.get(sessions.FLOW_COOKIE).value,'');assert.ok(!response.headers.get('location').includes('account-refresh'));
 }finally{global.fetch=original;}
});
test('logout clears the host-only temporary cookies',async()=>{
 const response=await logout.POST(req('logout','POST',cookie(credentials)));assert.equal(response.cookies.get(sessions.SESSION_COOKIE).value,'');assert.equal(response.cookies.get(sessions.SESSION_COOKIE).maxAge,0);
});

test('any authenticated X account is saved separately, and database failure does not connect',async()=>{
 const original=global.fetch;const flow={type:'oauth',expires:Date.now()+600000,state:'valid',verifier:'v'};
 try{for(const fail of [false,true]){
 saved=undefined;saveError=fail?{}:null;
 global.fetch=async url=>url.endsWith('/oauth2/token')?Response.json({access_token:'a',refresh_token:'r',token_type:'bearer',expires_in:7200,scope:sessions.SCOPES.join(' ')}):Response.json({data:{id:'777',username:'heymike777',name:'Mike'}});
 const response=await callback.GET(new NextRequest(origin+'/api/business/x/callback?code=c&state=valid',{headers:{cookie:cookie(flow,sessions.FLOW_COOKIE)}}));
 if(fail){assert.equal(new URL(response.headers.get('location')).searchParams.get('error'),'save_failed');assert.equal(response.cookies.get(sessions.SESSION_COOKIE),undefined);}
 else{assert.equal(saved.x_user_id,'777');assert.equal(saved.username,'heymike777');assert.equal(sessions.openSession(response.cookies.get(sessions.SESSION_COOKIE).value,'credentials').account.id,'777');}
 }}finally{global.fetch=original;saveError=null;}
});
test('moderation requires a current privileged X session on the Business origin',async()=>{
 const adminReq=(value,url=origin)=>new NextRequest(url+'/api/business/tweets',{headers:{host:new URL(url).host,authorization:'Bearer old-admin-token',...(value?{cookie:cookie(value)}:{})}});
 await assert.rejects(server.requireAdmin(adminReq()),e=>e.status===401);
 assert.equal((await server.requireAdmin(adminReq({...credentials,account:{...credentials.account,username:'other'}}))).account.username,'other');
 await assert.rejects(server.requireAdmin(adminReq({...credentials,account:{...credentials.account,username:'lumenless'},moderation:undefined})),e=>e.status===401);
 const admin={...credentials,account:{...credentials.account,username:'lumenless'}};
 await assert.rejects(server.requireAdmin(adminReq({...admin,expires:Date.now()-1})),e=>e.status===401);
 await assert.rejects(server.requireAdmin(adminReq(admin,'https://lumenless.com')),e=>e.status===403);
 await server.requireAdmin(adminReq(admin));
});
test('legacy admin endpoints cannot authorize with a bearer token',async()=>{
 const legacy=require('../src/app/api/tweet-admin/route.ts');assert.equal((await legacy.GET()).status,410);assert.equal((await legacy.POST()).status,410);
});
test('moderation actions reject missing sessions and cross-origin requests before database access',async()=>{
 const queue=require('../src/app/api/business/tweets/route.ts');
 assert.equal((await queue.GET(req('tweets','GET'))).status,401);
 const admin={...credentials,account:{...credentials.account,username:'lumenless'}};
 assert.equal((await queue.POST(req('tweets','POST',cookie(admin),'https://evil.example'))).status,403);
 assert.equal((await queue.POST(req('tweets'))).status,401);
});
test('public order lookup selects only safe status fields and handles invalid/missing IDs',async()=>{
 const route=require('../src/app/api/order-status/[id]/route.ts');const original=server.db;
 const id='96074246-44a9-4718-8a61-8e1c8f5d61ae';let missing=false;
 server.db=()=>({from(table){assert.equal(table,'tweet_orders');return {select(fields){assert.equal(fields,'id,status,created_at,updated_at,published_ids,target_username');return {eq(column,value){assert.equal(column,'id');assert.equal(value,id);return {async maybeSingle(){return {data:missing?null:{id,status:'pending_review',published_ids:[]},error:null}}}}}}}}});
 try {
 const response=await route.GET(req('status','GET'),{params:Promise.resolve({id})});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.deepEqual(Object.keys(await response.json()).sort(),['id','published_ids','status']);
 assert.equal((await route.GET(req('status','GET'),{params:Promise.resolve({id:'invalid'})})).status,400);
 missing=true;assert.equal((await route.GET(req('status','GET'),{params:Promise.resolve({id})})).status,404);
 }finally{server.db=original;}
});
test('order ownership uses immutable X IDs and restricts legacy orders to lumenless',()=>{
 const row={target_x_user_id:'777',target_username:'heymike777'};
 assert.equal(server.accountOwnsOrder({id:'777',username:'renamed_mike'},row),true);
 assert.equal(server.accountOwnsOrder({id:'888',username:'heymike777'},row),false);
 assert.equal(server.accountOwnsOrder({id:'888',username:'lumenless'},row),false);
 assert.equal(server.accountOwnsOrder({id:'777',username:'mike'},{target_x_user_id:null,target_username:'lumenless'}),false);
 assert.equal(server.accountOwnsOrder({id:'123',username:'lumenless'},{target_x_user_id:null,target_username:'lumenless'}),true);
});
test('moderation queue filters by the signed-in X user ID',async()=>{
 const original=server.db;const queue=require('../src/app/api/business/tweets/route.ts');let accountFilter;
 server.db=()=>({from(){const chain={select(){return chain},neq(){return chain},eq(field,value){assert.equal(field,'target_x_user_id');accountFilter=value;return chain},order(){return chain},async limit(){return {data:[]}}};return chain;}});
 try{const response=await queue.GET(req('tweets','GET',cookie({...credentials,account:{id:'777',username:'heymike777',name:'Mike'}})));assert.equal(response.status,200);assert.equal(accountFilter,'777');assert.deepEqual((await response.json()).orders,[]);}finally{server.db=original;}
});

test('public storefront @ handles rewrite to the dynamic username route',()=>{
 const {middleware}=require('../src/middleware.ts');
 for(const handle of ['@lumenless','%40heymike777']){
 const response=middleware(new NextRequest('https://lumenless.com/u/'+handle,{headers:{host:'lumenless.com'}}));
 assert.equal(new URL(response.headers.get('x-middleware-rewrite')).pathname,handle.includes('lumenless')?'/u/lumenless':'/u/heymike777');
 }
});
