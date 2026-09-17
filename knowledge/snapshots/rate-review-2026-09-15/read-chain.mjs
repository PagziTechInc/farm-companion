import fs from 'node:fs/promises';
import { keccak256, encodeFunctionData, decodeFunctionResult } from 'viem';
const base='.local-deploy/rate-review-2026-09-15';
const reviewed=JSON.parse(await fs.readFile('knowledge/reviewed-deployment.json','utf8'));
const rpc='https://rpc.mainnet.chain.robinhood.com/rpc';
const record={observed_at:new Date().toISOString(),rpc_url:rpc,reviewed_deployment:'knowledge/reviewed-deployment.json',contracts:{},reads:{},rpc_responses:[]};
let next=1;
async function send(method,params){const request={jsonrpc:'2.0',id:next++,method,params};const res=await fetch(rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(25000)});const body=await res.json();record.rpc_responses.push({request,response:body});if(body.error)throw new Error(JSON.stringify(body.error));return body.result;}
record.chain_id=parseInt(await send('eth_chainId',[]),16);
const block=await send('eth_getBlockByNumber',['latest',false]);record.block_number=parseInt(block.number,16);record.block_hash=block.hash;record.block_time=new Date(parseInt(block.timestamp,16)*1000).toISOString();record.block_tag=block.number;
const abi={};
await Promise.all(Object.entries(reviewed.contracts).map(async([name,data])=>{
 const source=JSON.parse(await fs.readFile(`knowledge/snapshots/verified-contracts-2026-09-11/${name}.json`,'utf8'));abi[name]=source.abi;
 const code=await send('eth_getCode',[data.address,block.number]);await fs.writeFile(`${base}/${name}.runtime.hex`,code+'\n');
 record.contracts[name]={address:data.address,runtime_keccak256:keccak256(code),reviewed_runtime_keccak256:data.runtime_keccak256,matches:keccak256(code)===data.runtime_keccak256,source_runtime_matches:code.toLowerCase()===source.runtimeBytecode.onchainBytecode.toLowerCase(),source_record:`knowledge/snapshots/verified-contracts-2026-09-11/${name}.json`};
}));
async function read(name,fn,args=[],suffix='') {const data=encodeFunctionData({abi:abi[name],functionName:fn,args});try{const result=await send('eth_call',[{to:reviewed.contracts[name].address,data},block.number]);record.reads[`${name}.${fn}${suffix}`]=decodeFunctionResult({abi:abi[name],functionName:fn,data:result});}catch(e){record.reads[`${name}.${fn}${suffix}`]={error:e.message};}}
const reads=[];
for (const name of ['emissions','nft','activation','weather','levels','crop']) {
 for(const fn of abi[name].filter(f=>f.type==='function'&&f.stateMutability==='view'&&!f.inputs.length&&f.name!=='renounceOwnership'))reads.push(()=>read(name,fn.name));
}
for(const n of [0,1,2,3])reads.push(()=>read('emissions','yearBudget',[BigInt(n)],'.'+n));
for(const n of [0,1,2,3])reads.push(()=>read('weather','weatherOf',[BigInt(n)],'.'+n));
for(const id of [1n,346n])for(const [name,fn] of [['nft','ownerOf'],['nft','rarityTier'],['nft','tokenURI'],['emissions','weightOf'],['emissions','desiredWeight'],['emissions','pending'],['activation','isActive'],['levels','levelOf']])reads.push(()=>read(name,fn,[id],'.'+id));
for(let i=0;i<reads.length;i+=6)await Promise.all(reads.slice(i,i+6).map(fn=>fn()));
await read('crop','balanceOf',[reviewed.contracts.emissions.address],'.emissions');
await read('emissions','baseRatePerSec',[BigInt(record.reads['emissions.start'])],'.genesis');
const end=await send('eth_getBlockByNumber',[block.number,false]);record.block_hash_rechecked=end.hash;record.block_stable=end.hash===block.hash;record.completed_at=new Date().toISOString();
await fs.writeFile(`${base}/chain-review.json`,JSON.stringify(record,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
const {rpc_responses,...brief}=record;console.log(JSON.stringify(brief,(_,v)=>typeof v==='bigint'?v.toString():v,2));
