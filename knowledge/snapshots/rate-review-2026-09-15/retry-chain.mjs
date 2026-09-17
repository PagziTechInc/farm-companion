import fs from 'node:fs/promises';
import {encodeFunctionData,decodeFunctionResult} from 'viem';
const p='.local-deploy/rate-review-2026-09-15/chain-review.json';const x=JSON.parse(await fs.readFile(p,'utf8'));
x.first_attempt_errors=Object.fromEntries(Object.entries(x.reads).filter(([k,v])=>v?.error));let id=10000;
for (const key of Object.keys(x.first_attempt_errors)){
 const [name,fn]=key.split('.');const {abi}=JSON.parse(await fs.readFile(`knowledge/snapshots/verified-contracts-2026-09-11/${name}.json`,'utf8'));
 const request={jsonrpc:'2.0',id:id++,method:'eth_call',params:[{to:x.contracts[name].address,data:encodeFunctionData({abi,functionName:fn})},x.block_tag]};
 await new Promise(r=>setTimeout(r,650));
 const response=await (await fetch(x.rpc_url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(20000)})).json();
 x.rpc_responses.push({request,response,retried_at:new Date().toISOString()});
 if(!response.error)x.reads[key]=decodeFunctionResult({abi,functionName:fn,data:response.result});
 console.log(key,JSON.stringify(x.reads[key],(_,v)=>typeof v==='bigint'?v.toString():v));
}
x.retries_completed_at=new Date().toISOString();await fs.writeFile(p,JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
