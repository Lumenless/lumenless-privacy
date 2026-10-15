// Local deployment-gated migration. Never prints or writes token values to files.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
require('@next/env').loadEnvConfig(path.resolve(__dirname,'..'));
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
const {createClient}=require('@supabase/supabase-js');
const {encryptToken,decryptToken,tokenContext,encryptionKeyId}=require('../src/lib/security/x-token-crypto.ts');
const execute=process.argv.includes('--execute');
// Plaintext is allowed only in this local deployment-gated migration, never by the web application.
const read=(value,context)=>value.startsWith('xenc:')?decryptToken(value,context):value;
async function list(db,table){const result=[];for(let offset=0;;offset+=200){const {data,error}=await db.from(table).select('*').order(table==='business_x_accounts'?'x_user_id':'id').range(offset,offset+199);if(error)throw Error('Could not inspect credentials.');result.push(...data);if(data.length<200)return result;}}
async function main(){
 encryptionKeyId();
 if(execute){const r=await fetch('https://business.lumenless.com/api/business/x/session',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Production security checks failed.');const c=await r.json();if(c.tokenStorageVersion!==1||c.tokenEncryptionKeyId!==encryptionKeyId())throw Error('Production is not ready or uses a different encryption key.');}
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});let changed=0,inspected=0;
 for(const table of ['business_x_accounts','tweet_x_credentials']){const key=table==='business_x_accounts'?'x_user_id':'id';
 for(const row of await list(db,table)){
  inspected++;for(const field of ['access_token','refresh_token'])read(row[field],tokenContext(table,row[key],field));
  if(['access_token','refresh_token'].every(f=>row[f].startsWith('xenc:v1:')))continue;
  if(!execute){changed++;continue;}
  const lock=new Date(Date.now()+60000).toISOString();const acquired=await db.from(table).update({lock_until:lock}).eq(key,row[key]).lt('lock_until',new Date().toISOString()).select().maybeSingle();
  if(acquired.error||!acquired.data)throw Error('Credential is busy. Retry after its lock expires.');
  try{const patch={};for(const field of ['access_token','refresh_token'])patch[field]=encryptToken(read(acquired.data[field],tokenContext(table,row[key],field)),tokenContext(table,row[key],field));
   const saved=await db.from(table).update(patch).eq(key,row[key]).eq('lock_until',lock).select('access_token,refresh_token').maybeSingle();if(saved.error||!saved.data)throw Error('Credential changed during migration. Retry safely.');
   for(const f of ['access_token','refresh_token'])if(decryptToken(saved.data[f],tokenContext(table,row[key],f))!==read(acquired.data[f],tokenContext(table,row[key],f)))throw Error('Encryption verification failed.');changed++;
  }finally{await db.from(table).update({lock_until:'1970-01-01'}).eq(key,row[key]).eq('lock_until',lock);}
 }}
 if(execute)for(const table of ['business_x_accounts','tweet_x_credentials'])for(const row of await list(db,table))if(!['access_token','refresh_token'].every(f=>row[f].startsWith('xenc:v1:')))throw Error('Plaintext credentials remain.');
 console.log(JSON.stringify({execute,inspected,[execute?'encryptedAndVerified':'needEncryption']:changed}));
}
main().catch(e=>{console.error(e.message);process.exit(1)});
