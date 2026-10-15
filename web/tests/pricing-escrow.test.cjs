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
 const tampered=Transaction.from(Buffer.from(prepared.transaction,'base64'));tampered.instructions[0].data[4]^=1;tampered.partialSign(owner);await assert.rejects(escrow.broadcastSettlement(row,tampered.serialize({requireAllSignatures:false}).toString('base64')),/changed the prepared/);assert.equal(sends,0);
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
 try{assert.equal((await inspect()).status,200);row.payment_message_hash='different';const rejected=await inspect();assert.equal(rejected.status,400);assert.match((await rejected.json()).error,/changed the prepared/);assert.equal(writes,0);}finally{server.order=oldOrder;server.db=oldDb;}
});
test('the captured Phantom guards preserve the exact payment and reject financial changes',()=>{
 const {Message,TransactionInstruction,ComputeBudgetProgram}=require('@solana/web3.js');const {assertPreparedMessage}=require('../src/lib/tweet-orders/prepared-message.ts');
 const fixture='AQAEBtb7zrSIqPEURJ+2NTxIM+NXIaA2/uppSi71L0Bf0HW/B/M03l/DucozHxd87u9gxzkI25DHKVhZkNnOQt1l2KEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMGRm/lIRcy/+ytunLDm+e8jOW7xfcSayxDmzpAAAAABN+teWL/sd2SXQqftebQDOYZW6i7OpH9B++YYMXpe7gFSlNamSkhBk0k6HFg2jh8fDW13bySu4HkH6hAQQVEjVBnjFNwkjYhVF0uwIEtIjs3Q9rxFBGQIZ5wFnERC5FHBgMABQJADQMAAwAJA9i4BQAAAAAABAEBDQYEAQAAAAAAAAAAAAACAgABDAIAAABAQg8AAAAAAAUBADRsdW1lbmxlc3M6b3JkZXI6NDEwNDdmZTYtYTk4MS00ZDlmLThmMDYtMWMxMTAzN2Q4MDNjBAEAGgYEAwAArFIBAAAAAAQDAAABAAAAAAAAAAAA';
 const expected='8a9dc2e3fc0068b72cb3c4e5e20ab27acf5c000968e421bb2677f451ba10a795';const fresh=()=>Transaction.populate(Message.from(Buffer.from(fixture,'base64')));
 assertPreparedMessage(fresh(),expected);
 const mutations=[t=>t.instructions[3].data[4]^=1,t=>t.instructions[3].keys[1].pubkey=Keypair.generate().publicKey,t=>t.instructions[4].data[0]^=1,t=>t.feePayer=Keypair.generate().publicKey,t=>t.recentBlockhash=Keypair.generate().publicKey.toBase58(),t=>t.add(SystemProgram.transfer({fromPubkey:t.feePayer,toPubkey:Keypair.generate().publicKey,lamports:1})),t=>t.instructions[2].data[0]=0,t=>t.instructions[2].keys[0].pubkey=Keypair.generate().publicKey,t=>t.instructions[1]=ComputeBudgetProgram.setComputeUnitPrice({microLamports:10000000}),t=>t.add(t.instructions[0])];
 for(const change of mutations){const tx=fresh();change(tx);assert.throws(()=>assertPreparedMessage(tx,expected));}
 const extra=fresh();extra.add(new TransactionInstruction({programId:Keypair.generate().publicKey,keys:[],data:Buffer.from([6])}));assert.throws(()=>assertPreparedMessage(extra,expected));
});

const review=require('../src/lib/tweet-orders/review-refund.ts'),refundModel=require('../src/lib/tweet-orders/refund-model.ts');
test('timeout requires confirmed escrow payment, full 72 hours and no moderation or settlement',()=>{
 const now=Date.now(),row={escrow_account_id:'777',payment_signature:'paid',paid_at:new Date(now-refundModel.REVIEW_TIMEOUT_MS).toISOString(),status:'pending_review',published_ids:[]};
 assert.equal(review.canRequestReviewRefund(row,now-1),false);assert.equal(review.canRequestReviewRefund(row,now),true);
 for(const patch of [{paid_at:null},{payment_signature:null},{escrow_account_id:null},{paid_at:'invalid'},{accepted_at:'accepted'},{published_ids:['post']},{settled_at:'settled'},{settlement_signature:'signed'},...['awaiting_payment','approved','published','publish_failed','rejected','refund_pending','refunded'].map(status=>({status}))])assert.equal(review.canRequestReviewRefund({...row,...patch},now),false,JSON.stringify(patch));
});
test('refund authorization binds order, wallet, nonce and time and expires after five minutes',()=>{
 const nacl=require('tweetnacl'),bs58=require('bs58').default,buyer=Keypair.generate(),id='order',now=Date.now(),proof={wallet:buyer.publicKey.toBase58(),timestamp:now,nonce:'nonce'};
 proof.signature=bs58.encode(nacl.sign.detached(Buffer.from(refundModel.refundAuthorizationMessage(id,proof)),buyer.secretKey));review.assertRefundAuthorization(id,proof,now);
 for(const [order,p,when] of [['other',proof,now],[id,{...proof,nonce:'other'},now],[id,{...proof,wallet:Keypair.generate().publicKey.toBase58()},now],[id,proof,now+300001],[id,proof,now-300001]])assert.throws(()=>review.assertRefundAuthorization(order,p,when));
});
test('concurrent moderation decision prevents a refund claim',async()=>{
 const original=server.db;let calls=0;server.db=()=>({rpc:async(name,args)=>{calls++;assert.equal(name,'claim_review_timeout_refund');assert.equal(args.p_wallet,'buyer');return {data:[]};}});
 try{await assert.rejects(review.claimReviewRefund({id:'order',wallet:'buyer',status:'pending_review',paid_at:new Date(Date.now()-refundModel.REVIEW_TIMEOUT_MS-1000).toISOString(),payment_signature:'paid',escrow_account_id:'777',published_ids:[]}),error=>error.status===409);assert.equal(calls,1);}finally{server.db=original;}
});
test('timeout refund checks recorded deadline and uses buyer as fee payer',()=>{
 const now=Date.now(),row={escrow_account_id:'777',status:'refund_pending',refund_reason:'review_timeout',paid_at:new Date(now-refundModel.REVIEW_TIMEOUT_MS).toISOString(),refund_requested_at:new Date(now).toISOString(),wallet:Keypair.generate().publicKey.toBase58()};
 escrow.requireSettlement(row,'refund',now);assert.equal(escrow.settlementPayer(row,'refund',{payout_wallet:'owner'}),row.wallet);assert.equal(escrow.settlementPayer({...row,refund_reason:null},'refund',{payout_wallet:'owner'}),'owner');
 for(const patch of [{refund_requested_at:'invalid'},{refund_requested_at:null},{refund_requested_at:new Date(now-1).toISOString()},{refund_requested_at:new Date(now+1).toISOString()},{paid_at:new Date(now-refundModel.REVIEW_TIMEOUT_MS+1).toISOString()}])assert.throws(()=>escrow.requireSettlement({...row,...patch},'refund',now));
});
test('refund endpoint rejects foreign origins, forged proofs and the wrong buyer before settlement',async()=>{
 const {NextRequest}=require('next/server'),nacl=require('tweetnacl'),bs58=require('bs58').default;
 require('../src/lib/security/rate-limit.ts').consumeLimit=async()=>null;
 const route=require('../src/app/api/order-refunds/[id]/route.ts'),id='41047fe6-a981-4d9f-8f06-1c11037d803c',buyer=Keypair.generate(),authorization={wallet:buyer.publicKey.toBase58(),timestamp:Date.now(),nonce:require('node:crypto').randomUUID()};authorization.signature=bs58.encode(nacl.sign.detached(Buffer.from(refundModel.refundAuthorizationMessage(id,authorization)),buyer.secretKey));
 const original=server.db;let reads=0;server.db=()=>({from(){reads++;return {select(){return this},eq(){return this},async maybeSingle(){return {data:{wallet:'different-buyer'}}}}}});
 const request=(origin,auth)=>route.POST(new NextRequest('http://localhost/api/order-refunds/'+id,{method:'POST',headers:{origin},body:JSON.stringify({action:'prepare',authorization:auth})}),{params:Promise.resolve({id})});
 try{assert.equal((await request('https://evil.example',authorization)).status,403);assert.equal((await request('http://localhost',{...authorization,signature:'forged'})).status,401);assert.equal(reads,0);const response=await request('http://localhost',authorization);assert.equal(response.status,403);assert.equal(reads,1);assert.equal(response.headers.get('cache-control'),'private, no-store');}finally{server.db=original;}
});
test('timeout refund transfers 100% to buyer, requires buyer signature and reserves before broadcast',async()=>{
 const buyer=Keypair.generate(),created=keys.createEscrow('777'),now=Date.now(),account={x_user_id:'777',payout_wallet:null,escrow_address:created.address,escrow_secret:created.secret};
 const row={id:'refund-order',wallet:buyer.publicKey.toBase58(),escrow_account_id:'777',status:'refund_pending',refund_reason:'review_timeout',paid_at:new Date(now-refundModel.REVIEW_TIMEOUT_MS-1000).toISOString(),refund_requested_at:new Date(now).toISOString(),payment_asset:'SOL',payment_mint:null,payment_symbol:'SOL',payment_decimals:9,payment_recipient:created.address,payment_amount:'0.001',payment_amount_atomic:'1000000'};
 const original={db:server.db,rpc:payments.mainnetRpc};let sends=0;
 payments.mainnetRpc=async()=>({getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:200}),getBlockHeight:async()=>100,sendRawTransaction:async()=>{assert.ok(row.settlement_signature);sends++;return row.settlement_signature;}});
 server.db=()=>({from(){let patch;const chain={select(){return chain},eq(){return chain},is(){return chain},update(value){patch=value;return chain},async single(){return {data:account}},async maybeSingle(){Object.assign(row,patch);return {data:{id:row.id}}}};return chain;}});
 try{const prepared=await escrow.prepareSettlement(row,'refund');assert.equal(prepared.platformFee,'0');assert.equal(prepared.recipientAmount,'1000000');assert.equal(prepared.feePayer,row.wallet);
 const tx=Transaction.from(Buffer.from(prepared.transaction,'base64'));assert.equal(tx.instructions.length,2);const transfer=SystemProgram.programId.equals(tx.instructions[0].programId);assert.equal(transfer,true);assert.equal(tx.instructions[0].keys[1].pubkey.toBase58(),row.wallet);assert.equal(tx.instructions[0].data.readBigUInt64LE(4),1000000n);
 await assert.rejects(escrow.broadcastSettlement(row,prepared.transaction),/did not sign/);assert.equal(sends,0);
 tx.partialSign(buyer);await escrow.broadcastSettlement(row,tx.serialize({requireAllSignatures:false}).toString('base64'));assert.equal(sends,1);await escrow.broadcastSettlement(row,'');assert.equal(sends,2);assert.ok(row.settlement_raw);
 }finally{server.db=original.db;payments.mainnetRpc=original.rpc;}
});
test('buyer can resume a reserved refund without preparing or sending a second transfer',async()=>{
 const {NextRequest}=require('next/server'),nacl=require('tweetnacl'),bs58=require('bs58').default,route=require('../src/app/api/order-refunds/[id]/route.ts'),id='41047fe6-a981-4d9f-8f06-1c11037d803c',buyer=Keypair.generate();
 const authorization={wallet:buyer.publicKey.toBase58(),timestamp:Date.now(),nonce:require('node:crypto').randomUUID()};authorization.signature=bs58.encode(nacl.sign.detached(Buffer.from(refundModel.refundAuthorizationMessage(id,authorization)),buyer.secretKey));
 const original=server.db;let reads=0;const row={wallet:authorization.wallet,escrow_account_id:'777',refund_reason:'review_timeout',status:'refund_pending',settlement_signature:'existing-signature',settlement_raw:'private-raw'};
 server.db=()=>({from(){reads++;return {select(){return this},eq(){return this},async maybeSingle(){return {data:row}}}}});
 try{const response=await route.POST(new NextRequest('http://localhost/api/order-refunds/'+id,{method:'POST',headers:{origin:'http://localhost'},body:JSON.stringify({action:'prepare',authorization})}),{params:Promise.resolve({id})});assert.equal(response.status,200);assert.deepEqual(await response.json(),{pending:true,signature:'existing-signature'});assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(reads,1);}finally{server.db=original;}
});
