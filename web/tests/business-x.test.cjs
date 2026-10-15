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
server.db = () => ({ from(table) { assert.equal(table, 'tweet_x_credentials'); return { async upsert(value) { saved=value; return {error:saveError}; } }; } });
const callback = require('../src/app/api/business/x/callback/route.ts');
const exporter = require('../src/app/api/business/x/export/route.ts');
const reader = require('../src/app/api/business/x/session/route.ts');
const logout = require('../src/app/api/business/x/logout/route.ts');
const origin = process.env.BUSINESS_APP_URL;
const credentials = { type:'credentials',expires:Date.now()+600000,account:{id:'123',name:'Example',username:'example'},accessToken:'user-access',refreshToken:'user-refresh',persisted:true,tokenExpiresAt:new Date(Date.now()+7200000).toISOString(),scope:sessions.SCOPES.join(' ') };
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
 const response=await reader.GET(req('session','GET',cookie(credentials)));const data=await response.json();
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
  const session=sessions.openSession(response.cookies.get(sessions.SESSION_COOKIE)?.value,'credentials');assert.equal(session.account.id,'999');assert.equal(saved.refresh_token,'account-refresh');assert.equal(saved.id,1);assert.equal(session.persisted,true);assert.equal(session.refreshToken,undefined);assert.equal(session.accessToken,undefined);
  assert.equal(response.cookies.get(sessions.FLOW_COOKIE).value,'');assert.ok(!response.headers.get('location').includes('account-refresh'));
 }finally{global.fetch=original;}
});
test('logout clears the host-only temporary cookies',async()=>{
 const response=await logout.POST(req('logout','POST',cookie(credentials)));assert.equal(response.cookies.get(sessions.SESSION_COOKIE).value,'');assert.equal(response.cookies.get(sessions.SESSION_COOKIE).maxAge,0);
});

test('wrong accounts and database failures cannot connect the publisher',async()=>{
 const original=global.fetch;const flow={type:'oauth',expires:Date.now()+600000,state:'valid',verifier:'v'};
 try{for(const username of ['other','lumenless']){
 saved=undefined;saveError=username==='lumenless'?{}:null;
 global.fetch=async url=>url.endsWith('/oauth2/token')?Response.json({access_token:'a',refresh_token:'r',token_type:'bearer',expires_in:7200,scope:sessions.SCOPES.join(' ')}):Response.json({data:{id:'999',username,name:'Name'}});
 const response=await callback.GET(new NextRequest(origin+'/api/business/x/callback?code=c&state=valid',{headers:{cookie:cookie(flow,sessions.FLOW_COOKIE)}}));
 assert.equal(new URL(response.headers.get('location')).searchParams.get('error'),username==='other'?'wrong_account':'save_failed');assert.equal(response.cookies.get(sessions.SESSION_COOKIE),undefined);if(username==='other')assert.equal(saved,undefined);
 }}finally{global.fetch=original;saveError=null;}
});
