const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const test = require('node:test');
const assert = require('node:assert/strict');
// Transpile the actual TypeScript modules in memory; no duplicate implementation under test.
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const { PublicKey, Keypair } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require('@solana/spl-token');
process.env.X_TOKEN_ENCRYPTION_KEY = 'cd'.repeat(32);
const cryptoTokens = require('../src/lib/security/x-token-crypto.ts');
const model = require('../src/lib/tweet-orders/model.ts');
const payments = require('../src/lib/tweet-orders/payments.ts');
const server = require('../src/lib/tweet-orders/server.ts');
const jupiter = require('../src/lib/tweet-orders/jupiter.ts');
const { publish } = require('../src/lib/tweet-orders/x.ts');
const mint = { address: new PublicKey(model.LUMEN_MINT), decimals: 6, program: TOKEN_PROGRAM_ID };
const wallet = Keypair.generate().publicKey.toBase58();
const base = { id: '11111111-1111-4111-8111-111111111111', wallet, kind: 'tweet', tweets: [{text:'Hello',media:[]}], amount_tokens: 1000000, created_at: new Date().toISOString(), published_ids: [], x_media: {}, publish_attempt: null };
function proof(refund = false) {
  const sender = refund ? payments.TREASURY : wallet;
  const receiver = refund ? wallet : payments.TREASURY;
  const destination = getAssociatedTokenAddressSync(mint.address, new PublicKey(receiver)).toBase58();
  const amount = payments.atomicAmount(base.amount_tokens, mint.decimals).toString();
  return { blockTime: Math.floor(Date.now()/1000), meta: {err:null,preTokenBalances:[],postTokenBalances:[{accountIndex:1,mint:model.LUMEN_MINT,uiTokenAmount:{amount}}]},
    transaction: {message: {accountKeys:[{pubkey:new PublicKey(sender),signer:true},{pubkey:new PublicKey(destination),signer:false}], instructions:[
      {programId:TOKEN_PROGRAM_ID,parsed:{type:'transferChecked',info:{authority:sender,destination,mint:model.LUMEN_MINT,tokenAmount:{amount,decimals:6}}}},
      {programId:new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),parsed:payments.paymentMemo(base.id,refund)},
    ]}}};
}
test('single tweet and thread pricing is fixed, contacts are optional', () => {
  const draft = {wallet,kind:'tweet',tweets:[{text:'hello',media:[]}],acceptedTerms:true};
  assert.equal(model.price('tweet'),1000000); assert.equal(model.price('thread'),3000000);
  assert.equal(model.draftSchema.safeParse(draft).success,true);
  assert.equal(model.draftSchema.safeParse({...draft,kind:'thread'}).success,false);
  assert.equal(model.draftSchema.safeParse({...draft,kind:'thread',tweets:Array(6).fill(draft.tweets[0])}).success,false);
  assert.equal(model.draftSchema.safeParse({...draft,tweets:[{text:'',media:[]}]}).success,false);
  assert.equal(model.draftSchema.safeParse({...draft,acceptedTerms:false}).success,false);
  assert.equal(model.draftSchema.safeParse({...draft,email:'invalid'}).success,false);
});
test('mixed video and images, oversized files, and weighted overlength are rejected', () => {
  const draft = {wallet,kind:'tweet',acceptedTerms:true};
  const image = {name:'a.png',type:'image/png',size:100}; const video = {name:'a.mp4',type:'video/mp4',size:100};
  assert.equal(model.draftSchema.safeParse({...draft,tweets:[{text:'hi',media:[image,video]}]}).success,false);
  assert.equal(model.draftSchema.safeParse({...draft,tweets:[{text:'hi',media:[{...image,size:11*1024*1024}]}]}).success,false);
  assert.equal(model.draftSchema.safeParse({...draft,tweets:[{text:'界'.repeat(141),media:[]}]}).success,false);
});
test('valid exact payment and reverse-direction refund are accepted', () => {
  payments.assertTransfer(base,proof(),mint); payments.assertTransfer(base,proof(true),mint,true);
  assert.equal(payments.atomicAmount(3000000,9),3000000000000000n);
});
for (const [name, change] of [
  ['wrong mint', tx => tx.transaction.message.instructions[0].parsed.info.mint = wallet],
  ['underpayment', tx => tx.transaction.message.instructions[0].parsed.info.tokenAmount.amount = '999'],
  ['wrong treasury', tx => tx.transaction.message.instructions[0].parsed.info.destination = wallet],
  ['wrong payer', tx => tx.transaction.message.instructions[0].parsed.info.authority = payments.TREASURY],
  ['missing signer', tx => tx.transaction.message.accountKeys[0].signer = false],
  ['wrong order memo', tx => tx.transaction.message.instructions[1].parsed = payments.paymentMemo('different')],
  ['wrong token decimals', tx => tx.transaction.message.instructions[0].parsed.info.tokenAmount.decimals = 9],
  ['balance reversed by a later instruction', tx => tx.meta.postTokenBalances[0].uiTokenAmount.amount = '0'],
  ['failed transaction', tx => tx.meta.err = {InstructionError:[0,'error']}],
  ['old payment', tx => tx.blockTime -= 3600],
]) test(`rejects ${name}`, () => { const tx=proof(); change(tx); assert.throws(()=>payments.assertTransfer(base,tx,mint)); });
test('refund proof cannot be reused as a payment', () => { assert.throws(()=>payments.assertTransfer(base,proof(true),mint)); });
test('SOL decimal conversion is precise and bounded', () => {
  assert.equal(jupiter.solLamports('0.000000001'),1n); assert.equal(jupiter.solLamports('1.123456789'),1123456789n);
  for (const bad of ['0','-1','1e2','1.0000000001','101']) assert.throws(()=>jupiter.solLamports(bad));
});
function mockDb(row, credentials = null) {
  return () => ({from(table) {
    let patch, expected;
    const chain={select(){return chain},eq(key,value){if(key==='status')expected=value;return chain},update(value){patch=value;return chain},
      async maybeSingle(){if(table==='business_x_accounts')return {data:credentials?{...credentials,access_token:cryptoTokens.encryptToken(credentials.access_token,cryptoTokens.tokenContext('business_x_accounts',credentials.x_user_id,'access_token'))}:null};if(table==='tweet_x_credentials')return {data:{access_token:cryptoTokens.encryptToken('test-token',cryptoTokens.tokenContext('tweet_x_credentials',1,'access_token')),expires_at:new Date(Date.now()+3600000).toISOString()}};
        if(expected && row.status!==expected)return {data:null};if(patch)Object.assign(row,structuredClone(patch));return {data:structuredClone(row)};}};
    return chain;
  }});
}
function response(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
test('thread publisher persists each ID, replies in order, and cannot publish twice',async()=>{
  const row={...structuredClone(base),status:'approved',tweets:[{text:'first',media:[]},{text:'second',media:[]}]};
  const oldDb=server.db,oldFetch=global.fetch;server.db=mockDb(row); const bodies=[];
  global.fetch=async(url,init)=>{if(url.endsWith('/users/me'))return response({data:{id:'user',username:'lumenless'}});bodies.push(JSON.parse(init.body));return response({data:{id:String(bodies.length)}});};
  try {await publish(row.id);assert.equal(row.status,'published');assert.deepEqual(row.published_ids,['1','2']);assert.equal(bodies[1].reply.in_reply_to_tweet_id,'1');await assert.rejects(()=>publish(row.id));assert.equal(bodies.length,2);}
  finally {server.db=oldDb;global.fetch=oldFetch;}
});
test('ambiguous X result freezes publication instead of duplicating the post',async()=>{
  const row={...structuredClone(base),status:'approved'};const oldDb=server.db,oldFetch=global.fetch;server.db=mockDb(row);let writes=0;
  global.fetch=async(url)=>{if(url.endsWith('/users/me'))return response({data:{id:'user',username:'lumenless'}});writes++;throw new Error('timeout');};
  try {await assert.rejects(()=>publish(row.id));assert.equal(row.status,'publish_uncertain');assert.equal(row.publish_attempt,0);await assert.rejects(()=>publish(row.id));assert.equal(writes,1);}
  finally {server.db=oldDb;global.fetch=oldFetch;}
});
test('definitive X rejection is retained for explicit admin retry',async()=>{
  const row={...structuredClone(base),status:'approved'};const oldDb=server.db,oldFetch=global.fetch;server.db=mockDb(row);
  global.fetch=async(url)=>url.endsWith('/users/me')?response({data:{id:'user',username:'lumenless'}}):response({error:'bad'},400);
  try {await assert.rejects(()=>publish(row.id));assert.equal(row.status,'publish_failed');assert.equal(row.publish_attempt,null);}
  finally {server.db=oldDb;global.fetch=oldFetch;}
});
const { Connection, Transaction, TransactionInstruction } = require('@solana/web3.js');
for (const [name, status, height, allowed] of [
  ['in-flight payment', { confirmationStatus: 'confirmed', err: null }, 500, false],
  ['successful finalized payment', { confirmationStatus: 'finalized', err: null }, 500, false],
  ['missing payment before expiry', null, 50, false],
  ['missing payment after expiry', null, 500, true],
  ['finalized failed payment', { confirmationStatus: 'finalized', err: { error: true } }, 50, true],
]) test(`payment reset protects ${name}`, async () => {
  const row = { ...base, payment_signed_signature: 'test-signature', payment_last_valid_height: 100 };
  const originalDb=server.db,originalEnv=server.env;
  const originalStatuses=Connection.prototype.getSignatureStatuses;
  const web3 = require('@solana/web3.js'); const originalConnection = web3.Connection;
  web3.Connection = class extends Connection { constructor(...args) { super(...args); this.getBlockHeight = async () => height; } };
  server.env=()=> 'http://localhost:8899';
  let cleared=false;
  server.db=()=>({from(){return {update(){return this},eq(){return this},then(resolve){cleared=true;resolve({error:null})}}}});
  Connection.prototype.getSignatureStatuses=async()=>({value:[status]});
  try {if(allowed)await payments.guardPending(row);else await assert.rejects(()=>payments.guardPending(row));assert.equal(cleared,allowed);}
  finally {server.db=originalDb;server.env=originalEnv;Connection.prototype.getSignatureStatuses=originalStatuses;web3.Connection=originalConnection;}
});
test('server signature reservation allows the same refund and blocks a different refund', async () => {
  const signer=Keypair.generate();
  function signedTx(text){const tx=new Transaction({feePayer:signer.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58()});
    tx.add(new TransactionInstruction({programId:new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),keys:[],data:Buffer.from(text)}));tx.sign(signer);return tx;}
  const first=signedTx('first'), second=signedTx('second'); const row={...base,status:'refund_pending',refund_signed_signature:null};
  const originalDb=server.db,originalEnv=server.env,originalSend=Connection.prototype.sendRawTransaction;
  let broadcasts=0;
  server.env=()=> 'http://localhost:8899';
  server.db=()=>({from(){let patch;return {update(value){patch=value;return this},eq(){return this},is(){return this},select(){return this},async maybeSingle(){if(row.refund_signed_signature)return {data:null};Object.assign(row,patch);return {data:{id:row.id}};}}}});
  Connection.prototype.sendRawTransaction=async()=>{broadcasts++;return 'signature';};
  try {await payments.reserveAndBroadcast(row,first,true);await payments.reserveAndBroadcast(row,first,true);await assert.rejects(()=>payments.reserveAndBroadcast(row,second,true));assert.equal(broadcasts,2);}
  finally {server.db=originalDb;server.env=originalEnv;Connection.prototype.sendRawTransaction=originalSend;}
});
test('automatic checkout prefers sufficient LUMEN, including the exact price', () => {
  assert.deepEqual(payments.choosePayment(1000000n,1000000n,0n),{method:'LUMEN'});
  assert.deepEqual(payments.choosePayment(2000000n,1000000n,1000000000n),{method:'LUMEN'});
});
test('automatic checkout falls back to SOL for missing or insufficient LUMEN and reserves fees', () => {
  assert.deepEqual(payments.choosePayment(0n,1000000n,1000000000n),{method:'SOL',maxSol:'0.995000000'});
  assert.deepEqual(payments.choosePayment(999999n,1000000n,1000000000n),{method:'SOL',maxSol:'0.995000000'});
  assert.throws(()=>payments.choosePayment(0n,1000000n,5000000n));
  assert.deepEqual(payments.choosePayment(0n,1000000n,200000000000n),{method:'SOL',maxSol:'100.000000000'});
});

test('publisher uses the target account token and refuses a mismatched X user ID',async()=>{
 const oldDb=server.db,oldFetch=global.fetch;
 try { for(const accountId of ['777','888']){
 const row={...structuredClone(base),status:'approved',target_x_user_id:'777',target_username:'heymike777'};
 server.db=mockDb(row,{x_user_id:'777',access_token:'mike-token',expires_at:new Date(Date.now()+3600000).toISOString()});let posts=0;
 global.fetch=async(url,init)=>{assert.equal(init.headers.Authorization,'Bearer mike-token');if(url.endsWith('/users/me'))return response({data:{id:accountId,username:'renamed_mike'}});posts++;return response({data:{id:'1234'}});};
 if(accountId==='777'){await publish(row.id);assert.equal(row.status,'published');assert.equal(row.published_url,'https://x.com/heymike777/status/1234');assert.equal(posts,1);}
 else{await assert.rejects(publish(row.id),/does not match/);assert.equal(row.status,'approved');assert.equal(posts,0);}
 }}finally{server.db=oldDb;global.fetch=oldFetch;}
});
test('wallet authorization signs the chosen target account',()=>{
 const a=model.draftSchema.parse({wallet,kind:'tweet',tweets:[{text:'Hello',media:[]}],acceptedTerms:true,targetUsername:'heymike777'});
 const b={...a,targetUsername:'lumenless'};assert.notEqual(model.signingMessage(a,1,'nonce'),model.signingMessage(b,1,'nonce'));
});
test('a disconnected target account never falls back to the lumenless credentials',async()=>{
 const oldDb=server.db,oldFetch=global.fetch;
 const row={...structuredClone(base),status:'approved',target_x_user_id:'777',target_username:'heymike777'};
 server.db=mockDb(row);global.fetch=async()=>{throw new Error('X must not be called with a different account token');};
 try{await assert.rejects(publish(row.id),/connection is unavailable/);assert.equal(row.status,'approved');assert.deepEqual(row.published_ids,[]);}
 finally{server.db=oldDb;global.fetch=oldFetch;}
});
test('Paid Partnership applies to every thread post and its snapshot survives setting changes',async()=>{
 const oldDb=server.db,oldFetch=global.fetch;
 try{for(const [setting,snapshot,expected] of [[true,null,true],[false,null,false],[false,true,true],[true,false,false]]){
 const row={...structuredClone(base),status:'approved',target_x_user_id:'777',target_username:'mike',paid_partnership:snapshot,tweets:[{text:'first',media:[]},{text:'second',media:[]}]};
 server.db=mockDb(row,{x_user_id:'777',access_token:'token',expires_at:new Date(Date.now()+3600000).toISOString(),paid_partnership:setting});const bodies=[];
 global.fetch=async(url,init)=>{if(url.endsWith('/users/me'))return response({data:{id:'777',username:'mike'}});bodies.push(JSON.parse(init.body));return response({data:{id:String(bodies.length)}});};
 await publish(row.id);assert.equal(row.paid_partnership,expected);assert.equal(bodies.length,2);for(const body of bodies)assert.equal(body.paid_partnership,expected);
 }}finally{server.db=oldDb;global.fetch=oldFetch;}
});
test('refresh decrypts only its account token and persists the rotated pair encrypted',async()=>{
 const crypto=require('../src/lib/security/x-token-crypto.ts');const ctx=f=>crypto.tokenContext('business_x_accounts','777',f);
 const credentials={x_user_id:'777',access_token:crypto.encryptToken('old-access',ctx('access_token')),refresh_token:crypto.encryptToken('old-refresh',ctx('refresh_token')),expires_at:'1970-01-01',lock_until:'1970-01-01'};
 const row={...structuredClone(base),status:'approved',target_x_user_id:'777',target_username:'mike'};const oldDb=server.db,oldFetch=global.fetch;
 const oldId=process.env.X_CLIENT_ID,oldSecret=process.env.X_CLIENT_SECRET;process.env.X_CLIENT_ID='test-id';process.env.X_CLIENT_SECRET='test-secret';
 server.db=()=>({from(table){let patch,expected;const chain={select(){return chain},eq(field,value){if(field==='status')expected=value;if(field==='x_user_id')assert.equal(value,'777');return chain},lt(){return chain},update(value){patch=value;return chain},async maybeSingle(){if(table==='business_x_accounts'){if(patch)Object.assign(credentials,patch);return {data:structuredClone(credentials)}}if(expected&&row.status!==expected)return {data:null};if(patch)Object.assign(row,structuredClone(patch));return {data:structuredClone(row)}}};return chain;}});
 global.fetch=async(url,init)=>{if(url.endsWith('/oauth2/token')){assert.equal(init.body.get('refresh_token'),'old-refresh');return response({access_token:'new-access',refresh_token:'new-refresh',expires_in:7200})}assert.equal(init.headers.Authorization,'Bearer new-access');return url.endsWith('/users/me')?response({data:{id:'777',username:'mike'}}):response({data:{id:'555'}});};
 try{await publish(row.id);assert.equal(row.status,'published');assert.ok(credentials.access_token.startsWith('xenc:v1:'));assert.equal(crypto.decryptToken(credentials.refresh_token,ctx('refresh_token')),'new-refresh');assert.equal(crypto.decryptToken(credentials.access_token,ctx('access_token')),'new-access');}finally{server.db=oldDb;global.fetch=oldFetch;if(oldId)process.env.X_CLIENT_ID=oldId;else delete process.env.X_CLIENT_ID;if(oldSecret)process.env.X_CLIENT_SECRET=oldSecret;else delete process.env.X_CLIENT_SECRET;}
});

test('X credit failures are actionable and stay retryable without an uncertain post',async()=>{
 const row={...structuredClone(base),status:'approved'};const oldDb=server.db,oldFetch=global.fetch;server.db=mockDb(row);
 global.fetch=async url=>url.endsWith('/users/me')?response({data:{id:'user',username:'lumenless'}}):response({type:'https://api.x.com/2/problems/credits-depleted'},402);
 try{await assert.rejects(publish(row.id),/Check the app’s API credits/);assert.equal(row.status,'publish_failed');assert.equal(row.publish_attempt,null);assert.deepEqual(row.published_ids,[]);}
 finally{server.db=oldDb;global.fetch=oldFetch;}
});
