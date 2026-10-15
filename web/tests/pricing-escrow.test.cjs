const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
const resolve=Module._resolveFilename;Module._resolveFilename=function(r,...args){return resolve.call(this,r.startsWith('@/')?path.join(__dirname,'../src',r.slice(2)):r,...args)};
const {Keypair,PublicKey,Transaction,SystemProgram}=require('@solana/web3.js');
const billing=require('../src/lib/tweet-orders/billing.ts'),payments=require('../src/lib/tweet-orders/payments.ts'),keys=require('../src/lib/business/escrow-keys.ts'),escrow=require('../src/lib/tweet-orders/escrow.ts'),server=require('../src/lib/tweet-orders/server.ts'),x=require('../src/lib/tweet-orders/x.ts');
process.env.ESCROW_ENCRYPTION_KEY='ab'.repeat(32);
test('prices use exact atomic amounts and reject rounding, exponents and overflow',()=>{
 assert.equal(billing.decimalAtomic('0.123456789',9),123456789n);assert.equal(billing.decimalAtomic('12.345678',6),12345678n);
 for(const v of ['0','-1','1e3','0.0000001','01','1,000','9999999999999999999'])assert.throws(()=>billing.decimalAtomic(v,6));
 const a=billing.termsFor({...billing.DEFAULT_BILLING,tweet_price:'1.25',thread_price:'2.5'},'thread');assert.equal(a.amount,'2.5');
});
test('escrow secrets are randomized and bound to the X account and public address',()=>{
 const a=keys.createEscrow('777'),b=keys.createEscrow('777');assert.notEqual(a.address,b.address);assert.equal(keys.openEscrow('777',a.secret,a.address).publicKey.toBase58(),a.address);assert.throws(()=>keys.openEscrow('888',a.secret,a.address));assert.throws(()=>keys.openEscrow('777',a.secret,b.address));
});
test('payout is 90/10 with deterministic rounding; refunds return the full amount',()=>{
 assert.deepEqual(escrow.settlementAmounts(1000000n,'payout'),{fee:100000n,recipient:900000n});assert.deepEqual(escrow.settlementAmounts(101n,'payout'),{fee:10n,recipient:91n});assert.deepEqual(escrow.settlementAmounts(101n,'refund'),{fee:0n,recipient:101n});
});
test('withdrawal requires publication, the full 24 hours and an unsettled order',()=>{
 const now=Date.now(),row={escrow_account_id:'777',status:'published',published_at:new Date(now-86400000).toISOString()};escrow.requireSettlement(row,'payout',now);
 for(const change of [{status:'approved'},{status:'rejected'},{published_at:new Date(now-86399999).toISOString()},{settled_at:new Date().toISOString()},{published_at:null}])assert.throws(()=>escrow.requireSettlement({...row,...change},'payout',now));
 assert.throws(()=>escrow.requireSettlement(row,'refund'));escrow.requireSettlement({...row,status:'refund_pending'},'refund');
});
function nativeProof(){const from=Keypair.generate().publicKey,to=Keypair.generate().publicKey;const row={id:'order',wallet:from.toBase58(),created_at:new Date().toISOString(),payment_asset:'SOL',payment_mint:null,payment_decimals:9,payment_symbol:'SOL',payment_recipient:to.toBase58(),payment_amount:'0.1',payment_amount_atomic:'100000000'};
 const proof={blockTime:Math.floor(Date.now()/1000),meta:{err:null,preBalances:[200005000,0],postBalances:[100000000,100000000]},transaction:{message:{accountKeys:[{pubkey:from,signer:true},{pubkey:to,signer:false}],instructions:[{programId:SystemProgram.programId,parsed:{type:'transfer',info:{source:from.toBase58(),destination:to.toBase58(),lamports:100000000}}},{programId:new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),parsed:payments.paymentMemo(row.id)}]}}};return {row,proof};}
test('native SOL verification enforces amount, destination, memo, signer and balance delta',()=>{
 const {row,proof}=nativeProof();payments.assertNativeTransfer(row,proof);
 for(const change of [p=>p.transaction.message.instructions[0].parsed.info.lamports--,p=>p.transaction.message.instructions[0].parsed.info.destination=row.wallet,p=>p.transaction.message.accountKeys[0].signer=false,p=>p.meta.postBalances[1]--,p=>p.transaction.message.instructions[1].parsed='wrong']){const copy=structuredClone(proof);copy.transaction.message.accountKeys=proof.transaction.message.accountKeys.map(key=>({...key}));copy.transaction.message.instructions=proof.transaction.message.instructions.map(i=>({...i,parsed:structuredClone(i.parsed)}));change(copy);assert.throws(()=>payments.assertNativeTransfer(row,copy));}
});
test('escrow signs only the prepared transaction, checks posts again and reserves before broadcast',async()=>{
 const owner=Keypair.generate(),buyer=Keypair.generate(),created=keys.createEscrow('777');const account={x_user_id:'777',payout_wallet:owner.publicKey.toBase58(),escrow_address:created.address,escrow_secret:created.secret};
 const row={id:'order',wallet:buyer.publicKey.toBase58(),escrow_account_id:'777',target_x_user_id:'777',status:'published',published_at:new Date(Date.now()-86400001).toISOString(),payment_asset:'SOL',payment_mint:null,payment_symbol:'SOL',payment_decimals:9,payment_recipient:created.address,payment_amount:'0.1',payment_amount_atomic:'100000000'};
 const original={db:server.db,rpc:payments.mainnetRpc,verify:x.verifyPublishedPosts};let checks=0,sends=0,postsExist=true;
 x.verifyPublishedPosts=async()=>{checks++;if(!postsExist)throw Error('Post deleted');};
 payments.mainnetRpc=async()=>({getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:200}),getBlockHeight:async()=>100,sendRawTransaction:async()=>{assert.ok(row.settlement_signature);sends++;return row.settlement_signature;}});
 server.db=()=>({from(table){let patch,expectedHash,needsUnsigned=false;const chain={select(){return chain},eq(k,v){if(k==='settlement_message_hash')expectedHash=v;return chain},is(k){if(k==='settlement_signature')needsUnsigned=true;return chain},update(v){patch=v;return chain},async single(){return {data:account}},async maybeSingle(){if(expectedHash&&expectedHash!==row.settlement_message_hash||needsUnsigned&&row.settlement_signature)return {data:null};if(patch)Object.assign(row,patch);return {data:{id:row.id}}}};return chain;}});
 try{const prepared=await escrow.prepareSettlement(row,'payout');assert.equal(checks,1);const transaction=Transaction.from(Buffer.from(prepared.transaction,'base64'));transaction.partialSign(owner);const raw=transaction.serialize({requireAllSignatures:false}).toString('base64');
 const tampered=Transaction.from(Buffer.from(prepared.transaction,'base64'));tampered.instructions[0].data[4]^=1;tampered.partialSign(owner);await assert.rejects(escrow.broadcastSettlement(row,tampered.serialize({requireAllSignatures:false}).toString('base64')),/Settlement changed/);assert.equal(sends,0);
 postsExist=false;await assert.rejects(escrow.broadcastSettlement(row,raw),/Post deleted/);assert.equal(sends,0);assert.equal(row.settlement_signature,undefined);
 postsExist=true;await escrow.broadcastSettlement(row,raw);assert.equal(sends,1);assert.ok(row.settlement_raw);assert.equal(checks,3);
 }finally{server.db=original.db;payments.mainnetRpc=original.rpc;x.verifyPublishedPosts=original.verify;}
});

test('missing or successful settlement history cannot unlock a second payout',async()=>{
 const original=payments.mainnetRpc;let status=null;
 payments.mainnetRpc=async()=>({getSignatureStatuses:async()=>({value:[status]}),getBlockHeight:async()=>99999});
 try{const row={settlement_signature:'signed',settlement_last_valid_height:1};await assert.rejects(escrow.resetSettlement(row),/cannot prove/);status={confirmationStatus:'finalized',err:null};await assert.rejects(escrow.resetSettlement(row),/Verify the pending/);}finally{payments.mainnetRpc=original;}
});

test('RPC errors fail promptly without rate-limit retries or endpoint secrets',async()=>{
 const oldFetch=global.fetch,oldRpc=process.env.SOLANA_MAINNET_RPC_URL;let calls=0;
 process.env.SOLANA_MAINNET_RPC_URL='https://example.invalid/private-key';
 global.fetch=async(_url,init)=>{calls++;assert.ok(init.signal instanceof AbortSignal);return new Response('limited',{status:429});};
 try{await assert.rejects(payments.mainnetRpc(),error=>error.status===503&&!error.message.includes('private-key'));assert.equal(calls,1);
 global.fetch=async()=>{throw Error('network error https://example.invalid/private-key');};await assert.rejects(payments.mainnetRpc(),error=>error.status===503&&!error.message.includes('private-key'));
 }finally{global.fetch=oldFetch;if(oldRpc===undefined)delete process.env.SOLANA_MAINNET_RPC_URL;else process.env.SOLANA_MAINNET_RPC_URL=oldRpc;}
});
test('recovered payment inspection validates signatures without database writes or broadcast',async()=>{
 const {NextRequest}=require('next/server');const route=require('../src/app/api/tweet-orders/[id]/route.ts');const signer=Keypair.generate();
 const tx=new Transaction({feePayer:signer.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58()}).add(SystemProgram.transfer({fromPubkey:signer.publicKey,toPubkey:Keypair.generate().publicKey,lamports:1000000}));tx.sign(signer);
 const row={status:'awaiting_payment',payment_message_hash:server.hash(tx.serializeMessage().toString('base64'))};const oldOrder=server.order,oldDb=server.db;let writes=0;
 server.order=async()=>row;server.db=()=>{writes++;throw Error('Inspection must not write');};
 const inspect=async()=>route.POST(new NextRequest('http://localhost/api/tweet-orders/test',{method:'POST',headers:{origin:'http://localhost'},body:JSON.stringify({action:'inspect-payment',signedTransaction:tx.serialize().toString('base64')})}),{params:Promise.resolve({id:'test'})});
 try{assert.equal((await inspect()).status,200);row.payment_message_hash='different';const rejected=await inspect();assert.equal(rejected.status,200);const diagnostic=await rejected.json();assert.equal(diagnostic.ok,false);assert.match(diagnostic.error,/changed the prepared/);assert.equal(diagnostic.diagnostic.message,tx.serializeMessage().toString('base64'));assert.equal(diagnostic.diagnostic.signaturesValid,true);assert.equal(writes,0);}finally{server.order=oldOrder;server.db=oldDb;}
});
