import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeFunctionData, encodeFunctionResult } from 'viem';
import { emptyPortfolio, rules, UNIT } from '../src/model.js';
import { EXECUTION_DEPLOYMENTS } from '../src/execution.js';
import { mountApproval } from '../src/approval-panel.js';

const A='0x0000000000000000000000000000000000000001';
const HASH=`0x${'a'.repeat(64)}`, BLOCK=`0x${'b'.repeat(64)}`, ZERO=`0x${'0'.repeat(40)}`;
const hex=value=>`0x${BigInt(value).toString(16)}`;
const target=key=>EXECUTION_DEPLOYMENTS[key].address;
const contracts=Object.fromEntries(Object.keys(EXECUTION_DEPLOYMENTS).map(key=>[key,JSON.parse(readFileSync(new URL(`../knowledge/snapshots/verified-contracts-2026-09-11/${key}.json`,import.meta.url),'utf8'))]));

function fakeContainer() {
  let version=0, html='';
  const versions=[new Map()];
  const container={
    querySelector(selector) {
      const elements=versions[version];
      if(!elements.has(selector)) elements.set(selector,{value:undefined,handlers:{},addEventListener(event,handler){this.handlers[event]=handler;}});
      return elements.get(selector);
    },
    replaceChildren(){this.innerHTML='';},
    current(selector,event) { return versions[version]?.get(selector)?.handlers[event]; },
  };
  Object.defineProperty(container,'innerHTML',{get:()=>html,set:value=>{html=value;version++;versions[version]=new Map();}});
  return container;
}

function setup({storageValue=null,onActivity=()=>{},onConfirmed=()=>{},onRefresh=()=>{}}={}) {
  const portfolio=emptyPortfolio(); portfolio.is_demo=false; portfolio.is_template=false;
  portfolio.wallets[0].address=A; portfolio.wallets[0].crop_balance_wei='0'; portfolio.wallets[0].eth_balance_wei=UNIT.toString();
  portfolio.wallets[0].plots=[{token_id:1,owner_address:A,rarity_tier:0,level:1,is_active:true,effective_weight_bps:10000,pending_crop_wei:(10n*UNIT).toString(),modifiers:null}];
  portfolio.expected_total_plots=1; portfolio.wallets[0].expected_plot_count=1;
  const intent={type:'claim',wallet_id:portfolio.wallets[0].id,plot_ids:[1]};
  const storage={value:storageValue,get(){return this.value;},set(value){this.value=value;}};
  const reads=[],walletCalls=[],activities=[],confirmed=[];
  const state={transaction:null,submitted:0};
  let providerLookups=0;
  const rpc=async(method,params)=>{
    reads.push({method,params});
    if(method==='eth_chainId') return hex(4663);
    if(method==='eth_getBlockByNumber') return {number:'0x64',hash:BLOCK,timestamp:hex(Math.floor(Date.now()/1000))};
    if(method==='eth_getCode') {
      const key=Object.keys(EXECUTION_DEPLOYMENTS).find(name=>target(name)===params[0].toLowerCase());
      return contracts[key].runtimeBytecode.onchainBytecode;
    }
    if(method==='eth_getBalance') return hex(UNIT);
    if(method==='eth_getTransactionCount') return '0x0';
    if(method==='eth_gasPrice') return '0xa';
    if(method==='eth_estimateGas') return '0xc350';
    if(method==='eth_getTransactionByHash') return state.transaction;
    if(method==='eth_getTransactionReceipt') return state.submitted?{transactionHash:HASH,from:A,to:target('emissions'),status:'0x1',blockNumber:'0x64',blockHash:BLOCK,gasUsed:'0x5208',effectiveGasPrice:'0xa'}:null;
    if(method!=='eth_call') throw Error(`Unexpected RPC call ${method}`);
    const tx=params[0],key=Object.keys(EXECUTION_DEPLOYMENTS).find(name=>target(name)===tx.to.toLowerCase()),abi=contracts[key].abi;
    const {functionName:name}=decodeFunctionData({abi,data:tx.data});
    let result;
    if(name==='activation'||name==='transferHook') result=target('activation');
    else if(name==='activationClearer') result=ZERO;
    else if(name==='rarity') result=target('nft');
    else if(['crop','nft','emissions','levels','weather'].includes(name)) result=target(name);
    else if(name==='treasury') result='0x778aa5BD0b28829b7C27eb3957C2D33848125D85';
    else if(name==='start'||name==='epochStart') result=BigInt(rules.schedule.genesis_timestamp);
    else if(name==='FEE') result=2500n*UNIT;
    else if(name==='BURN_BPS') result=6000n;
    else if(name==='decimals') result=18;
    else if(name==='paused') result=false;
    else if(name==='levelOf') result=1;
    else if(name==='isActive'||name==='tiersFinalized') result=true;
    else if(name==='ownerOf') result=A;
    else if(name==='pending') result=10n*UNIT;
    else if(name==='balanceOf'||name==='allowance') result=0n;
    else if(name==='desiredWeight'||name==='weightOf'||name==='totalWeight') result=10000n;
    else if(name==='claim') result=10n*UNIT;
    else throw Error(`Unmocked ${key}.${name}`);
    return encodeFunctionResult({abi,functionName:name,result});
  };
  const provider={request:async({method,params})=>{
    walletCalls.push({method,params});
    if(method==='eth_requestAccounts'||method==='eth_accounts') return [A];
    if(method==='eth_chainId') return hex(4663);
    if(method!=='eth_sendTransaction') throw Error(`Unexpected wallet call ${method}`);
    const saved=JSON.parse(storage.value);
    assert.equal(saved.pending?.phase,'broadcast_unknown','the lock must persist before opening the wallet');
    state.submitted++;state.transaction={...params[0],input:params[0].data,hash:HASH};return HASH;
  }};
  const container=fakeContainer();
  const panel=mountApproval(container,{getPortfolio:()=>portfolio,getState:()=>({}),reader:{rpc},getProvider:async()=>{providerLookups++;return provider;},storage,
    onActivity:event=>{activities.push(event);onActivity(event);},onConfirmed:record=>{confirmed.push(record);return onConfirmed(record);},onRefresh});
  const click=async(selector,event='click',extra={})=>{
    const handler=container.current(selector,event);assert.equal(typeof handler,'function',`missing ${event} handler for ${selector}`);return handler(extra);
  };
  return {portfolio,intent,storage,reads,walletCalls,activities,confirmed,state,panel,click,providerLookups:()=>providerLookups};
}

test('guided preparation uses the shared review, revalidates before submission, and confirms before refresh',async()=>{
  const order=[],c=setup({onConfirmed:()=>order.push('confirmed'),onRefresh:()=>order.push('refresh')});
  let checks=0,planCurrent=true;
  const prepared=await c.panel.prepareIntent(c.intent,{validate(){checks++;if(!planCurrent)throw Error('Plan context changed.');}});
  assert.equal(prepared.ok,true);assert.equal(prepared.draft.type,'claim');assert.equal(checks,2);
  assert.equal(c.providerLookups(),0);assert.equal(c.state.submitted,0);
  assert.deepEqual(c.panel.getActionState(),{busy:false,hasDraft:true,hasPending:false,locked:true,journal:[]});
  assert.ok(c.activities.some(event=>event.type==='busy'&&event.busy));
  assert.ok(c.activities.some(event=>event.type==='busy'&&!event.busy));
  assert.equal((await c.panel.prepareIntent(c.intent)).ok,false,'an existing review blocks a second preparation');

  planCurrent=false;
  const rejected=await c.click('[data-submit]');
  assert.equal(rejected.ok,false);assert.match(rejected.error,/Plan context changed/);assert.equal(checks,3);
  assert.equal(c.providerLookups(),0);assert.equal(c.state.submitted,0);assert.equal(c.panel.getActionState().hasDraft,false);

  const fresh=await c.panel.prepareIntent(c.intent);assert.equal(fresh.ok,true);
  assert.equal(c.providerLookups(),0);assert.equal(c.state.submitted,0);
  await c.click('[data-connect]');assert.equal(c.providerLookups(),1);
  await c.click('[data-submit]');assert.equal(c.state.submitted,1);
  assert.equal(c.panel.getActionState().hasPending,true);assert.equal(c.panel.getActionState().locked,true);
  assert.equal((await c.panel.prepareIntent(c.intent)).ok,false,'a pending transaction blocks another preparation');

  const previous=globalThis.FormData;
  globalThis.FormData=class {get(){return null;}};
  try { await c.click('[data-receipt]','submit',{preventDefault(){},target:{}}); }
  finally { globalThis.FormData=previous; }
  assert.equal(c.panel.getActionState().hasPending,false);assert.equal(c.panel.getActionState().locked,false);
  assert.equal(c.confirmed.length,1);
  assert.deepEqual(Object.keys(c.confirmed[0]).sort(),['at','from','hash','type','wallet_id']);
  assert.equal(c.confirmed[0].type,'claim');assert.equal(c.confirmed[0].wallet_id,c.portfolio.wallets[0].id);assert.equal(c.confirmed[0].from,A);assert.equal(c.confirmed[0].hash,HASH);
  assert.doesNotThrow(()=>new Date(c.confirmed[0].at).toISOString());assert.deepEqual(order,['confirmed','refresh']);
  const journal=JSON.parse(c.storage.value).journal;assert.equal(journal.at(-1).status,'confirmed');
  assert.equal(c.walletCalls.filter(call=>call.method==='eth_sendTransaction').length,1);
  assert.ok(c.activities.some(event=>event.type==='pending'&&event.hasPending));
  assert.ok(c.activities.some(event=>event.type==='pending'&&!event.hasPending));
});

test('busy state and corrupt action storage reject guided preparation without public or wallet reads',async()=>{
  const corrupt=setup({storageValue:'{' });
  assert.equal(corrupt.panel.getActionState().locked,true);
  const blocked=await corrupt.panel.prepareIntent(corrupt.intent);
  assert.equal(blocked.ok,false);assert.match(blocked.error,/could not be loaded/);assert.equal(corrupt.reads.length,0);assert.equal(corrupt.providerLookups(),0);

  const c=setup();let enter,release;
  const entered=new Promise(resolve=>{enter=resolve;}),wait=new Promise(resolve=>{release=resolve;});
  const inFlight=c.panel.prepareIntent(c.intent,{async validate(){enter();await wait;throw Error('stale guided plan');}});
  await entered;assert.equal(c.panel.getActionState().busy,true);assert.equal(c.panel.getActionState().locked,true);
  const second=await c.panel.prepareIntent(c.intent);assert.equal(second.ok,false);assert.match(second.error,/being checked/);
  release();const failed=await inFlight;assert.equal(failed.ok,false);assert.match(failed.error,/stale guided plan/);
  assert.equal(c.panel.getActionState().busy,false);assert.equal(c.panel.getActionState().hasDraft,false);assert.equal(c.reads.length,0);assert.equal(c.providerLookups(),0);
});
