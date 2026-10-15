// Yarn Classic's exit code includes moderate/low findings; fail only high/critical.
const {spawnSync}=require('node:child_process');
const result=spawnSync('yarn',['audit','--json','--registry','https://registry.npmjs.org'],{encoding:'utf8',maxBuffer:20*1024*1024});
if(result.error){console.error('Yarn audit could not run.');process.exit(1);}
let summary;
try{for(const line of result.stdout.split('\n').filter(Boolean)){const item=JSON.parse(line);if(item.type==='auditSummary')summary=item.data;}}
catch{console.error('Invalid Yarn audit response.');process.exit(1);}
if(result.signal || !summary || !['high','critical'].every(key=>Number.isSafeInteger(summary.vulnerabilities?.[key]) && summary.vulnerabilities[key]>=0)){console.error('Yarn audit returned no valid vulnerability summary.');process.exit(1);}
console.log(JSON.stringify(summary.vulnerabilities));
process.exit(summary.vulnerabilities.high||summary.vulnerabilities.critical?1:0);
