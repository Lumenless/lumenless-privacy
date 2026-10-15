const fs=require('node:fs'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const tokens=require('../src/lib/security/x-token-crypto.ts');const limits=require('../src/lib/security/rate-limit.ts');const {NextRequest}=require('next/server');
process.env.X_TOKEN_ENCRYPTION_KEY='cd'.repeat(32);
test('X token encryption is randomized, authenticated and bound to account and field',()=>{
 const context=tokens.tokenContext('business_x_accounts','777','access_token');const a=tokens.encryptToken('sensitive-token',context),b=tokens.encryptToken('sensitive-token',context);
 assert.notEqual(a,b);assert.ok(!a.includes('sensitive-token'));assert.equal(tokens.decryptToken(a,context),'sensitive-token');
 for(const wrong of [tokens.tokenContext('business_x_accounts','888','access_token'),tokens.tokenContext('business_x_accounts','777','refresh_token')])assert.throws(()=>tokens.decryptToken(a,wrong));
 const parts=a.split(':');const bytes=Buffer.from(parts[3],'base64url');bytes[bytes.length-1]^=1;parts[3]=bytes.toString('base64url');assert.throws(()=>tokens.decryptToken(parts.join(':'),context));
 const key=process.env.X_TOKEN_ENCRYPTION_KEY;process.env.X_TOKEN_ENCRYPTION_KEY='ef'.repeat(32);assert.throws(()=>tokens.decryptToken(a,context));delete process.env.X_TOKEN_ENCRYPTION_KEY;assert.throws(()=>tokens.encryptToken('token',context));process.env.X_TOKEN_ENCRYPTION_KEY=key;
});
test('rate limits do not trust spoofed forwarded IPs and cover auth, order creation and status',()=>{
 const req=new NextRequest('https://business.lumenless.com/api/business/x/start',{headers:{'x-forwarded-for':'spoofed','x-vercel-forwarded-for':'203.0.113.4'}});
 const original=process.env.VERCEL;process.env.VERCEL='1';assert.equal(limits.clientIdentity(req),'203.0.113.4');delete process.env.VERCEL;assert.equal(limits.clientIdentity(req),'local');if(original)process.env.VERCEL=original;
 assert.equal(limits.requestLimit('/api/business/x/start','POST').limit,10);assert.equal(limits.requestLimit('/api/order-status/uuid','GET').limit,60);assert.equal(limits.requestLimit('/api/tweet-orders','POST').limit,20);assert.equal(limits.requestLimit('/api/cron/tweet-orders','GET'),null);
});
test('distributed limits return 429 with Retry-After, hash identities, and fail closed',async()=>{
 const original=global.fetch;const policy={name:'test',limit:2,seconds:60};const previous={url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY};process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test-service';let allowed=true;
 global.fetch=async(url,init)=>{const body=JSON.parse(init.body);assert.match(body.p_key,/^[a-f0-9]{64}$/);assert.ok(!init.body.includes('203.0.113.4'));return Response.json({allowed,retryAfter:42});};
 try{assert.equal(await limits.consumeLimit('ip:203.0.113.4',policy),null);allowed=false;const denied=await limits.consumeLimit('ip:203.0.113.4',policy);assert.equal(denied.status,429);assert.equal(denied.headers.get('retry-after'),'42');global.fetch=async()=>{throw Error('down')};assert.equal((await limits.consumeLimit('ip:203.0.113.4',policy)).status,503);}finally{global.fetch=original;for(const [k,v]of [['NEXT_PUBLIC_SUPABASE_URL',previous.url],['SUPABASE_SERVICE_ROLE_KEY',previous.key]]){if(v)process.env[k]=v;else delete process.env[k];}}
});
