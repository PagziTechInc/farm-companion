import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { decodeFunctionData, encodeFunctionResult } from 'viem';
import { defaults, emptyPortfolio, rules, UNIT, weight } from '../../src/model.js';
import { EXECUTION_DEPLOYMENTS } from '../../src/execution.js';
import { fulfillRpcBatch, rpcError, rpcResult } from '../fixtures.js';
import { openForecastSettings, openMainTab, openUtility } from './navigation.js';

const A = '0x0000000000000000000000000000000000000001', B = '0x0000000000000000000000000000000000000002', FOREIGN = '0x0000000000000000000000000000000000000003';
const HASH = `0x${'a'.repeat(64)}`, BLOCK = `0x${'b'.repeat(64)}`, ZERO = `0x${'0'.repeat(40)}`;
const manifest=JSON.parse(await readFile('knowledge/snapshots/manifest-2026-09-07.json','utf8'));
const commitment=JSON.parse(await readFile('knowledge/snapshots/manifest-comparison-2026-09-07.json','utf8'));
const TIER=manifest[1].tier;
const NOW = new Date('2026-09-22T12:00:00Z'), STORAGE = 'yield-farm-public-v2';
const hex = value => `0x${BigInt(value).toString(16)}`;
const target = key => EXECUTION_DEPLOYMENTS[key].address;
const contracts = Object.fromEntries(await Promise.all(Object.keys(EXECUTION_DEPLOYMENTS).map(async key => [key, JSON.parse(await readFile(new URL(`../../knowledge/snapshots/${['activation','activation_previous'].includes(key) ? 'review-2026-09-26' : 'verified-contracts-2026-09-11'}/${key}.json`, import.meta.url), 'utf8'))])));

function workspace(withPlot = false) {
  const portfolio = emptyPortfolio(); portfolio.is_demo = false; portfolio.is_template = false;
  portfolio.observed_at_utc = NOW.toISOString(); portfolio.block_number = 100; portfolio.block_timestamp = NOW.getTime() / 1000;
  portfolio.wallets.forEach((wallet, i) => { wallet.address = i ? B : A; wallet.crop_balance_wei = '0'; wallet.eth_balance_wei = UNIT.toString(); });
  if (withPlot) portfolio.wallets[0].plots = [{ token_id: 1, owner_address: A, rarity_tier: 0, level: 1, is_active: true, effective_weight_bps: 10000,
    pending_crop_wei: (100n * UNIT).toString(), modifiers: null, observed_at_utc: NOW.toISOString(), block_number: 100, reveal_status: 'revealed' }];
  portfolio.expected_total_plots=withPlot?1:0; portfolio.wallets[0].expected_plot_count=withPlot?1:0;
  return { schema_version: 2, days:90, portfolio, scenario: defaults(), profile_seeded: true, autoRefresh: false, history: [] };
}

async function initialize(page, data = workspace(), { account = A, chain = 4663 } = {}) {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(({ data, account, chain, storage, hash }) => {
    if (location.hostname === '127.0.0.1' && !localStorage.getItem(storage)) localStorage.setItem(storage, JSON.stringify(data));
    window.__walletMock = { account, chain, reads: 0, requests: [] };
    const provider = { request: async ({ method, params }) => {
      const mock = window.__walletMock; mock.requests.push({ method, params });
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [mock.account];
      if (method === 'eth_chainId') return `0x${mock.chain.toString(16)}`;
      if (method === 'wallet_switchEthereumChain') { mock.chain = 4663; return null; }
      if (method === 'eth_sendTransaction') {
        const saved = JSON.parse(localStorage.getItem('yield-farm-public-approvals-v2'));
        if (saved.pending?.phase !== 'broadcast_unknown') throw new Error('Missing durable pre-broadcast lock');
        sessionStorage.setItem('mock-last-tx', JSON.stringify({ ...params[0], input: params[0].data, hash }));
        return hash;
      }
      throw new Error(`Unexpected wallet request: ${method}`);
    } };
    Object.defineProperty(window, 'ethereum', { configurable: true, get() { window.__walletMock.reads++; return provider; } });
  }, { data, account, chain, storage: STORAGE, hash: HASH });
}

async function mockContracts(page) {
  const state = { mined:false, methods:[], replacementHash:null, cancelled:false, phase:0, allowance:0n, crop:5000n*UNIT, pending:0n, partial:false }; 
  await page.route('https://robinhood-rpc.publicnode.com/', route => fulfillRpcBatch(route, async request => {
    const { method, params } = request; state.methods.push(method);
    try {
      let result;
      if (method === 'eth_chainId') result = hex(4663);
      else if (method === 'eth_getBlockByNumber') result = { number: '0x64', hash: BLOCK, timestamp: hex(NOW.getTime() / 1000) };
      else if (method === 'eth_getBalance') result = hex(UNIT);
      else if (method === 'eth_gasPrice') result = '0xa';
      else if (method === 'eth_estimateGas') result = hex(50000);
      else if (method === 'eth_getTransactionCount') result = '0x0';
      else if (method === 'eth_getTransactionByHash') result = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mock-last-tx')));
      else if (method === 'eth_getTransactionReceipt') {const tx=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('mock-last-tx')));result=state.mined?{transactionHash:HASH,from:A,to:tx.to,status:'0x1',blockNumber:'0x64',blockHash:BLOCK,gasUsed:'0x5208',effectiveGasPrice:'0xa'}:null;}
      else if (method === 'eth_getCode') result = contracts[Object.keys(contracts).find(key => target(key) === params[0].toLowerCase())].runtimeBytecode.onchainBytecode;
      else if (method === 'eth_call') {
        const tx = params[0], key = Object.keys(contracts).find(key => target(key) === tx.to.toLowerCase()), abi = contracts[key].abi;
        const { functionName: name, args } = decodeFunctionData({ abi, data: tx.data });
        let output;
        if (name === 'activation' || name === 'transferHook') output = target('activation');
        else if (name === 'previous') output = target('activation_previous');
        else if (name === 'activationClearer') output = ZERO;
        else if (name === 'rarity') output = target('nft');
        else if (['crop', 'nft', 'emissions', 'levels', 'weather'].includes(name)) output = target(name);
        else if (name === 'treasury') output = '0x778aa5BD0b28829b7C27eb3957C2D33848125D85';
        else if (name === 'start' || name === 'epochStart') output = BigInt(rules.schedule.genesis_timestamp);
        else if (name === 'FEE') output = 2500n * UNIT;
        else if (name === 'BURN_BPS') output = 6000n;
        else if (name === 'decimals') output = 18;
        else if (name === 'paused' || name === 'floodActive' || name === 'moonActive') output = false;
        else if (name === 'levelOf') output = state.phase>=2?2:1;
        else if (name==='manifestHash') output=commitment.on_chain_hash;
        else if (name==='startingIndex') output=1n;
        else if (name==='multiplierNow') output=10000n;
        else if (name==='nextBoundary') output=BigInt(rules.schedule.genesis_timestamp+604800);
        else if (name==='carryNow'||name==='emitted'||name==='paidOut') output=0n;
        else if (name==='granaryNow') {if(state.partial)throw Error('Reserve read unavailable');output=40000000n*UNIT;}
        else if (name==='RATE_PER_WEIGHT_PER_WEEK') output=2000n*UNIT;
        else if (name==='bagPrice') output=UNIT/100n;
        else if (name==='bagOpen') output=true;
        else if (name === 'isActive' || name === 'tiersFinalized') output = true;
        else if (name === 'ownerOf') output = A;
        else if(name==='pending'||name==='claim') output=state.pending;
        else if(name==='balanceOf') output=args[0].toLowerCase()===A?state.crop:0n;
        else if(name==='allowance') output=state.allowance;
        else if(name==='approve'||name==='upgrade'||name==='plant') output=name==='approve'?true:undefined;
        else if (name === 'tokensOfOwner') output = args[0].toLowerCase() === A ? [1n] : [];
        else if(name==='rarityTier') output=TIER;
        else if(name==='currentEpoch'||name==='moonCount') output=0;
        else if(name==='totalWeight') output=100000000n;
        else if(name==='desiredWeight'||name==='weightOf') output=BigInt(weight(TIER,state.phase>=2?2:1));
        else if (name === 'costToReach') output = BigInt(rules.levels.entries[Number(args[0]) - 1].incremental_upgrade_cost_crop) * UNIT;
        else throw new Error(`Read not needed in this fixture: ${key}.${name}`);
        result = encodeFunctionResult({ abi, functionName: name, result: output });
      } else throw new Error(`Unexpected RPC method ${method}`);
      return rpcResult(request, result);
    } catch (error) { return rpcError(request, error); }
  }));
  await page.route('https://api.rh.farm/**', route => route.fulfill({ json: { name: 'Fixture plot', attributes: [] } }));
  await page.route('https://api.coinbase.com/**', route => route.fulfill({ json: { data: { base: 'ETH', currency: 'USD', amount: '2500' } } }));
  return state;
}

async function openActions(page) {
  await openUtility(page,'actions');
}


function planWorkspace(model=false){
  const data=workspace(!model);data.scenario={...defaults(),start:NOW.toISOString(),externalWeight:'1000',feeMode:'zero'};
  data.activePlan={enabled:false,days:90,funding:'harvest',objective:'crop',feeMode:'zero',useObservedWeight:false,extraSpent:'0'};
  if(model){data.portfolio=emptyPortfolio();const w=data.portfolio.wallets[0];w.crop_balance_wei=(5000n*UNIT).toString();w.eth_balance_wei=UNIT.toString();w.plots=[{token_id:1,rarity_tier:3,level:1,is_active:true,effective_weight_bps:weight(3,1),pending_crop_wei:'0',modifiers:[]}];w.expected_plot_count=1;data.portfolio.expected_total_plots=1;}
  return data;
}
async function openPlan(page){await page.getByRole('button',{name:'Open active plan',exact:true}).click();}
test('active model plan uses the local worker, keeps forecast inputs and exports without wallet access',async({page})=>{
  await initialize(page,planWorkspace(true));const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await openPlan(page);
  await page.getByRole('button',{name:'Save & build plan',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Selected policy and alternatives'})).toBeVisible();
  await expect(page.locator('#active-review')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__walletMock.reads)).toBe(0);
  const before=planWorkspace(true).scenario;
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).scenario,STORAGE)).toEqual(before);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export active plan',exact:true}).click();expect((await download).suggestedFilename()).toBe('farm-active-plan.json');
  await page.getByRole('button',{name:'Start live plan',exact:true}).click();await expect(page.getByRole('alert')).toContainText('watched wallet');
  expect(errors).toEqual([]);
});
test('dirty plan settings survive planner and utility navigation and block refresh until saved',async({page})=>{
  await initialize(page,planWorkspace(true));await page.goto('/');await openPlan(page);
  await page.getByRole('button',{name:'Save & build plan',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Selected policy and alternatives'})).toBeVisible();
  const days=page.locator('#active-plan-days');await days.fill('45');
  await page.locator('[data-planner-mode="ranking"]').click();
  await page.locator('[data-planner-mode="active"]').click();
  await openUtility(page,'themes');await openMainTab(page,'Upgrade planner');
  await expect(page.locator('#active-plan-days')).toHaveValue('45');
  await page.getByRole('button',{name:'Refresh & rebuild',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Save your plan settings before rebuilding.');
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).activePlan.days,STORAGE)).toBe(90);
  await page.getByRole('button',{name:'Save & build plan',exact:true}).click();
  await expect.poll(()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)).activePlan.days,STORAGE)).toBe(45);
});
test('active watched plan refreshes public state and prepares only the reviewed next step',async({page})=>{
  test.setTimeout(60000);
  const data=planWorkspace();await initialize(page,data);const rpc=await mockContracts(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await openPlan(page);await page.getByRole('button',{name:'Save & build plan',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Selected policy and alternatives'})).toBeVisible();
  await expect(page.locator('#active-review')).toBeVisible();
  expect(await page.evaluate(()=>window.__walletMock.reads)).toBe(0);
  await page.locator('#active-review').click();
  await expect(page.locator('.approval-review h3')).toHaveText('Approve exact CROP allowance');
  expect(await page.evaluate(()=>window.__walletMock.reads)).toBe(0);
  await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();
  await page.getByRole('button',{name:'Request MetaMask approval',exact:true}).click();
  await expect(page.getByText('Awaiting confirmation',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__walletMock.requests.filter(r=>r.method==='eth_sendTransaction').length)).toBe(1);
  rpc.mined=true;rpc.allowance=5000n*UNIT;
  await page.getByRole('button',{name:'Check transaction',exact:true}).click();
  await expect(page.getByText('Awaiting confirmation',{exact:true})).toHaveCount(0);
  await openMainTab(page,'Upgrade planner');
  await expect(page.locator('#active-review')).toBeVisible();
  expect(await page.evaluate(()=>window.__walletMock.requests.filter(r=>r.method==='eth_sendTransaction').length)).toBe(1);
  await page.locator('#active-review').click();await expect(page.locator('.approval-review h3')).toHaveText('Upgrade one level');
  await page.getByRole('button',{name:'Request MetaMask approval',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__walletMock.requests.filter(r=>r.method==='eth_sendTransaction').length)).toBe(2);
  rpc.phase=2;rpc.crop=0n;rpc.allowance=0n;
  await page.getByRole('button',{name:'Check transaction',exact:true}).click();
  await expect(page.getByText('Awaiting confirmation',{exact:true})).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>window.__walletMock.requests.filter(r=>r.method==='eth_sendTransaction').length)).toBe(2);
  expect(errors).toEqual([]);
});
test('live plan can pause and partial public reads block any action',async({page})=>{
  await initialize(page,planWorkspace());const rpc=await mockContracts(page);await page.goto('/');await openPlan(page);
  await page.getByRole('button',{name:'Start live plan',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Selected policy and alternatives'})).toBeVisible();
  await page.getByRole('button',{name:'Pause live plan',exact:true}).click();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).activePlan.enabled,STORAGE)).toBe(false);
  await expect(page.locator('#active-review')).toHaveCount(0);
  rpc.partial=true;await page.getByRole('button',{name:'Refresh & rebuild',exact:true}).click();
  await expect(page.locator('.active-plan-runtime-error')).toContainText('refresh failed');
  await expect(page.locator('#active-review')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__walletMock.reads)).toBe(0);
});

test('Tampermonkey builds model plans through its bundled worker without reading the game API or provider',async({page})=>{
  await page.clock.setFixedTime(NOW);
  await page.route('https://rh.farm/**',route=>route.fulfill({contentType:'text/html',body:'<html><body>Game fixture</body></html>'}));
  await page.goto('https://rh.farm/');
  await page.evaluate(data=>{
    const values={'public-workspace-v2':JSON.stringify(data)};
    window.GM_getValue=(key,fallback)=>values[key]??fallback;window.GM_setValue=(key,value)=>values[key]=value;
    window.GM_xmlhttpRequest=()=>{throw Error('No reads for model planning');};
    window.unsafeWindow={};Object.defineProperty(window.unsafeWindow,'ethereum',{get(){throw Error('No wallet access for model planning');}});
  },planWorkspace(true));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addScriptTag({content:await readFile('dist/yield-farm-companion.user.js','utf8')});
  await page.getByRole('button',{name:'Open Farm Companion',exact:true}).click();await openPlan(page);
  await page.getByRole('button',{name:'Save & build plan',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Selected policy and alternatives'})).toBeVisible();
  await expect(page.locator('#active-review')).toHaveCount(0);expect(errors).toEqual([]);
});

test('a guided claim advances the saved wallet cadence only after a confirmed receipt and replans without submitting the next step',async({page})=>{
  const data=planWorkspace(),walletId=data.portfolio.wallets[0].id;
  data.activePlanClock={[walletId]:new Date(NOW.getTime()-7*86400000).toISOString()};
  await initialize(page,data);const rpc=await mockContracts(page);rpc.crop=0n;rpc.pending=5000n*UNIT;
  await page.goto('/');await openPlan(page);await page.getByRole('button',{name:'Save & build plan',exact:true}).click();
  await expect(page.locator('#active-review')).toBeVisible();await page.locator('#active-review').click();
  await expect(page.locator('.approval-review h3')).toHaveText('Claim pending CROP');
  await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();await page.getByRole('button',{name:'Request MetaMask approval',exact:true}).click();
  await expect(page.getByText('Awaiting confirmation',{exact:true})).toBeVisible();
  expect(await page.evaluate(({key,id})=>JSON.parse(localStorage.getItem(key)).activePlanClock[id],{key:STORAGE,id:walletId})).toBe(data.activePlanClock[walletId]);
  rpc.mined=true;rpc.pending=0n;rpc.crop=5000n*UNIT;
  await page.getByRole('button',{name:'Check transaction',exact:true}).click();
  await expect.poll(()=>page.evaluate(({key,id})=>JSON.parse(localStorage.getItem(key)).activePlanClock[id],{key:STORAGE,id:walletId})).toBe(NOW.toISOString());
  await openMainTab(page,'Upgrade planner');
  await expect(page.locator('#active-review')).toBeVisible();
  expect(await page.evaluate(()=>window.__walletMock.requests.filter(r=>r.method==='eth_sendTransaction').length)).toBe(1);
});
test('changing forecast economics invalidates an already prepared guided review before submission',async({page})=>{
  await initialize(page,planWorkspace());await mockContracts(page);await page.goto('/');await openPlan(page);
  await page.getByRole('button',{name:'Save & build plan',exact:true}).click();await expect(page.locator('#active-review')).toBeVisible();await page.locator('#active-review').click();
  await expect(page.locator('.approval-review h3')).toHaveText('Approve exact CROP allowance');
  await openMainTab(page,'Yield forecast');await openForecastSettings(page);await page.getByText('Harvest limits',{exact:true}).click();await page.getByLabel('Additional valley weight (optional)',{exact:false}).fill('2000');
  await page.getByRole('button',{name:'Calculate forecast',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Harvest without reinvesting'})).toBeVisible();
  await openUtility(page,'actions');
  await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();await page.getByRole('button',{name:'Request MetaMask approval',exact:true}).click();
  await expect(page.locator('.farm-approval [role=alert]')).toContainText('changed or expired');
  expect(await page.evaluate(()=>window.__walletMock.requests.some(r=>r.method==='eth_sendTransaction'))).toBe(false);
});
