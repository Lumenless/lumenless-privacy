const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
const resolve=Module._resolveFilename;Module._resolveFilename=function(r,...args){return resolve.call(this,r.startsWith('@/')?path.join(__dirname,'../src',r.slice(2)):r,...args)};
process.env.TELEGRAM_BOT_TOKEN='test-bot-secret';process.env.TELEGRAM_ADMIN_CHAT_ID='100';process.env.BUSINESS_APP_URL='https://business.lumenless.com';
require('../src/lib/security/rate-limit.ts').consumeLimit=async()=>null;
const {NextRequest}=require('next/server'),server=require('../src/lib/tweet-orders/server.ts'),telegram=require('../src/lib/business/telegram.ts'),route=require('../src/app/api/business/telegram/route.ts'),webhook=require('../src/app/api/business/telegram/webhook/route.ts');
function req(body,secret=telegram.telegramWebhookSecret()){return new NextRequest('https://business.lumenless.com/api/business/telegram/webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},body:JSON.stringify(body)});}
test('webhook rejects forgery before DB access and ignores groups or mismatched senders',async()=>{
 const old=server.db;server.db=()=>{throw Error('Must not query');};
 try{assert.equal((await webhook.POST(req({},'wrong'))).status,401);for(const message of [{chat:{type:'group',id:1},from:{id:1}},{chat:{type:'private',id:1},from:{id:2}}])assert.equal((await webhook.POST(req({message}))).status,200);}finally{server.db=old;}
});
test('link webhook hashes a one-use token and binds only verified private chat',async()=>{
 const oldDb=server.db,oldSend=telegram.sendTelegram;let calls=0,sends=0;
 server.db=()=>({rpc:async(name,args)=>{calls++;assert.equal(name,'connect_business_telegram');assert.equal(args.p_chat,'222');assert.equal(args.p_hash,server.hash('a'.repeat(43)));assert.equal(args.p_username,'example');return {data:calls===1?[{x_user_id:'777'}]:[]};}});telegram.sendTelegram=async(chat,text)=>{sends++;assert.equal(chat,'222');assert.ok(!text.includes('a'.repeat(43)));};
 const update={message:{chat:{type:'private',id:222},from:{id:222,username:'example'},text:'/start link_'+'a'.repeat(43)}};
 try{assert.equal((await webhook.POST(req(update))).status,200);assert.equal((await webhook.POST(req(update))).status,200);assert.equal(sends,1);}finally{server.db=oldDb;telegram.sendTelegram=oldSend;}
});
test('Telegram settings require X authorization and reject foreign origins',async()=>{
 const old=server.db;server.db=()=>{throw Error('Must not access DB');};
 try{assert.equal((await route.GET(new NextRequest('https://business.lumenless.com/api/business/telegram'))).status,401);const r=await route.POST(new NextRequest('https://business.lumenless.com/api/business/telegram',{method:'POST',headers:{origin:'https://evil.example'},body:'{"action":"connect"}'}));assert.equal(r.status,403);}finally{server.db=old;}
});
test('connection link belongs to session X account, stores hash only, and never accepts browser chat IDs',async()=>{
 const originals={db:server.db,admin:server.requireAdmin,ensure:telegram.ensureTelegramWebhook};let saved;
 server.requireAdmin=async()=>({account:{id:'777',username:'owner'}});telegram.ensureTelegramWebhook=async()=> 'lumenless_bot';server.db=()=>({from(table){assert.equal(table,'business_telegram');return {async upsert(row){saved=row;return {error:null};}};}});
 try{const r=await route.POST(new NextRequest('https://business.lumenless.com/api/business/telegram',{method:'POST',headers:{origin:'https://business.lumenless.com'},body:JSON.stringify({action:'connect',x_user_id:'other',chat_id:'attacker'})}));assert.equal(r.status,200);const data=await r.json(),token=new URL(data.url).searchParams.get('start').slice(5);assert.equal(token.length,43);assert.equal(saved.x_user_id,'777');assert.equal(saved.link_hash,server.hash(token));assert.ok(!('chat_id' in saved));assert.ok(Date.parse(saved.link_expires_at)>Date.now());assert.ok(!JSON.stringify(saved).includes(token));}finally{server.db=originals.db;server.requireAdmin=originals.admin;telegram.ensureTelegramWebhook=originals.ensure;}
});
function notifyFixture(chat='200'){
 const value={id:'order',target_x_user_id:'777',target_username:'owner',kind:'tweet',payment_signature:'paid',payment_asset:'SOL',payment_decimals:9,payment_symbol:'SOL',payment_amount:'0.001',payment_amount_atomic:'1000000',payment_recipient:'escrow',owner_notification_done:false,notification_sent_at:null};
 const selected=[];server.db=()=>({from(table){let patch;const chain={select(){return chain},eq(key,id){if(table==='business_telegram'){selected.push(id);assert.equal(id,'777');}return chain},update(v){patch=v;return chain},then(resolve){Object.assign(value,patch);resolve({error:null});},async maybeSingle(){return {data:chat?{chat_id:chat}:null}}};return chain;}});return {value,selected};
}
test('platform delivery succeeds despite owner failure, and retry does not resend platform alert',async()=>{
 const oldDb=server.db,oldSend=telegram.sendTelegram,{value,selected}=notifyFixture();const sent=[];let fail=true;
 telegram.sendTelegram=async(chat)=>{sent.push(chat);if(chat==='200'&&fail)throw Error('blocked');};
 try{await assert.rejects(server.notify(value),/Some Telegram/);assert.ok(value.notification_sent_at);assert.equal(value.owner_notification_done,false);fail=false;await server.notify(value);assert.deepEqual(sent,['100','200','200']);assert.equal(value.owner_notification_done,true);assert.deepEqual(selected,['777','777']);await server.notify(value);assert.equal(sent.length,3);}finally{server.db=oldDb;telegram.sendTelegram=oldSend;}
});
test('identical platform and owner chats receive one alert, and disconnected owners are skipped',async()=>{
 const oldDb=server.db,oldSend=telegram.sendTelegram;let sends=0;telegram.sendTelegram=async()=>{sends++;};
 try{let {value}=notifyFixture('100');await server.notify(value);assert.equal(sends,1);assert.equal(value.owner_notification_done,true);({value}=notifyFixture(null));await server.notify(value);assert.equal(sends,2);assert.equal(value.owner_notification_done,true);}finally{server.db=oldDb;telegram.sendTelegram=oldSend;}
});
test('webhook setup preserves other integrations and does not leak bot token on errors',async()=>{
 const old=global.fetch;let calls=[];
 global.fetch=async(url)=>{calls.push(url);return Response.json({ok:true,result:{url:'https://other.example/webhook'}});};
 try{await assert.rejects(telegram.ensureTelegramWebhook(),error=>error.status===503&&!error.message.includes('test-bot-secret'));assert.equal(calls.length,1);
 global.fetch=async()=>{throw Error('https://api.telegram.org/bottest-bot-secret');};await assert.rejects(telegram.sendTelegram('1','test'),error=>!error.message.includes('test-bot-secret'));}finally{global.fetch=old;}
});
test('owner delivery succeeds while platform is unavailable and is not duplicated on retry',async()=>{
 const oldDb=server.db,oldSend=telegram.sendTelegram,{value}=notifyFixture();const sent=[];let fail=true;telegram.sendTelegram=async(chat)=>{sent.push(chat);if(chat==='100'&&fail)throw Error('unavailable');};
 try{await assert.rejects(server.notify(value));assert.equal(value.owner_notification_done,true);assert.equal(value.notification_sent_at,null);fail=false;await server.notify(value);assert.deepEqual(sent,['100','200','100']);}finally{server.db=oldDb;telegram.sendTelegram=oldSend;}
});
test('an expired or consumed link cannot send a confirmation or change a recipient',async()=>{
 const oldDb=server.db,oldSend=telegram.sendTelegram;let sends=0;server.db=()=>({rpc:async()=>({data:[]})});telegram.sendTelegram=async()=>{sends++;};
 try{const response=await webhook.POST(req({message:{chat:{type:'private',id:222},from:{id:222},text:'/start link_'+'z'.repeat(43)}}));assert.equal(response.status,200);assert.equal(sends,0);}finally{server.db=oldDb;telegram.sendTelegram=oldSend;}
});
