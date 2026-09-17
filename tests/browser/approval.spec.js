import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { decodeFunctionData, encodeFunctionResult } from 'viem';
import { defaults, emptyPortfolio, rules, UNIT } from '../../src/model.js';
import { EXECUTION_DEPLOYMENTS } from '../../src/execution.js';
import { fulfillRpcBatch, rpcError, rpcResult } from '../fixtures.js';
import { openAddPlots, openMainTab, openUtility, openWallets } from './navigation.js';

const A = '0x0000000000000000000000000000000000000001', B = '0x0000000000000000000000000000000000000002', FOREIGN = '0x0000000000000000000000000000000000000003';
const HASH = `0x${'a'.repeat(64)}`, BLOCK = `0x${'b'.repeat(64)}`, ZERO = `0x${'0'.repeat(40)}`;
const NOW = new Date('2026-09-22T12:00:00Z'), STORAGE = 'yield-farm-public-v2';
const hex = value => `0x${BigInt(value).toString(16)}`;
const target = key => EXECUTION_DEPLOYMENTS[key].address;
const contracts = Object.fromEntries(await Promise.all(Object.keys(EXECUTION_DEPLOYMENTS).map(async key => [key, JSON.parse(await readFile(new URL(`../../knowledge/snapshots/verified-contracts-2026-09-11/${key}.json`, import.meta.url), 'utf8'))])));

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
  const state = { mined: false, methods: [], replacementHash: null, cancelled: false };
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
      else if (method === 'eth_getTransactionReceipt') result = state.mined ? { transactionHash: state.replacementHash ?? HASH, from: A, to: state.cancelled ? A : target('emissions'), status: '0x1', blockNumber: '0x64', blockHash: BLOCK, gasUsed: '0x5208', effectiveGasPrice: '0xa' } : null;
      else if (method === 'eth_getCode') result = contracts[Object.keys(contracts).find(key => target(key) === params[0].toLowerCase())].runtimeBytecode.onchainBytecode;
      else if (method === 'eth_call') {
        const tx = params[0], key = Object.keys(contracts).find(key => target(key) === tx.to.toLowerCase()), abi = contracts[key].abi;
        const { functionName: name, args } = decodeFunctionData({ abi, data: tx.data });
        let output;
        if (name === 'activation' || name === 'transferHook') output = target('activation');
        else if (name === 'activationClearer') output = ZERO;
        else if (name === 'rarity') output = target('nft');
        else if (['crop', 'nft', 'emissions', 'levels', 'weather'].includes(name)) output = target(name);
        else if (name === 'treasury') output = '0x778aa5BD0b28829b7C27eb3957C2D33848125D85';
        else if (name === 'start' || name === 'epochStart') output = BigInt(rules.schedule.genesis_timestamp);
        else if (name === 'FEE') output = 2500n * UNIT;
        else if (name === 'BURN_BPS') output = 6000n;
        else if (name === 'decimals') output = 18;
        else if (name === 'paused' || name === 'floodActive' || name === 'moonActive') output = false;
        else if (name === 'levelOf') output = 1;
        else if (name === 'isActive' || name === 'tiersFinalized') output = true;
        else if (name === 'ownerOf') output = A;
        else if (name === 'pending' || name === 'claim') output = state.mined ? 0n : 100n * UNIT;
        else if (name === 'balanceOf' || name === 'allowance') output = 0n;
        else if (name === 'tokensOfOwner') output = args[0].toLowerCase() === A ? [1n] : [];
        else if (name === 'rarityTier' || name === 'currentEpoch' || name === 'moonCount') output = 0;
        else if (name === 'desiredWeight' || name === 'weightOf' || name === 'totalWeight') output = 10000n;
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

test('public wallet connection is explicit and checks the watched account and chain',async({page})=>{
  await initialize(page,workspace(),{account:FOREIGN});await page.goto('/');await openActions(page);
  expect(await page.evaluate(()=>window.__walletMock.reads)).toBe(0);
  await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();
  await expect(page.getByRole('region',{name:'Optional wallet actions'})).toContainText('configured');
  await page.evaluate(address=>{window.__walletMock.account=address;window.__walletMock.chain=1;},A);
  await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();
  await expect(page.getByRole('button',{name:'Switch to Robinhood Chain'})).toBeVisible();
  expect(await page.evaluate(()=>window.__walletMock.requests.some(r=>r.method==='wallet_switchEthereumChain'))).toBe(false);
  await page.getByRole('button',{name:'Switch to Robinhood Chain'}).click();
  await expect(page.getByRole('region',{name:'Optional wallet actions'})).toContainText('chain 4663');
  expect(await page.evaluate(()=>window.__walletMock.requests.some(r=>r.method==='eth_sendTransaction'))).toBe(false);
});

test('claim review and explicit submission preserve a durable lock across reload with no follow-on transaction',async({page})=>{
  await initialize(page,workspace(true));const rpc=await mockContracts(page);await page.goto('/');await openActions(page);
  await page.getByRole('button',{name:'Prepare transaction',exact:true}).click();
  await page.getByText('Transaction data',{exact:true}).click();
  await expect(page.getByText(/Simulation passed at block/)).toBeVisible();
  expect(await page.evaluate(()=>window.__walletMock.reads)).toBe(0);
  await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();
  await page.getByRole('button',{name:'Request MetaMask approval',exact:true}).click();
  await expect(page.getByText('Awaiting confirmation',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Claim pending CROP',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__walletMock.requests.filter(r=>r.method==='eth_sendTransaction').length)).toBe(1);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('yield-farm-public-approvals-v2')).pending.hash)).toBe(HASH);
  await page.evaluate(()=>{window.__approvalRoot=document.querySelector('#app').shadowRoot.querySelector('#approval');});
  await openMainTab(page,'My farm');
  const actionsButton=page.getByRole('button',{name:'Farm actions · connect & approve',exact:true});
  await expect(actionsButton).toHaveClass(/has-pending/);
  await expect(actionsButton).toHaveAttribute('aria-pressed','false');
  expect(await page.evaluate(()=>window.__approvalRoot===document.querySelector('#app').shadowRoot.querySelector('#approval'))).toBe(true);
  await openWallets(page);
  await page.getByRole('button',{name:'Remove wallet',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('action');
  await openActions(page);
  await expect(page.getByText('Awaiting confirmation',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__approvalRoot===document.querySelector('#app').shadowRoot.querySelector('#approval'))).toBe(true);
  await page.reload();await openActions(page);
  expect(await page.evaluate(()=>window.__walletMock.reads)).toBe(0);
  await expect(page.getByRole('button',{name:'Prepare transaction',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Check transaction',exact:true}).click();
  await expect(page.getByText('The transaction is still pending. The lock remains.')).toBeVisible();
  rpc.mined=true;await page.getByRole('button',{name:'Check transaction',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('yield-farm-public-approvals-v2')).pending)).toBeNull();
  const journal=await page.evaluate(()=>JSON.parse(localStorage.getItem('yield-farm-public-approvals-v2')).journal);
  expect(journal.at(-1).status).toBe('confirmed');
  expect(await page.evaluate(()=>window.__walletMock.requests.some(r=>r.method==='eth_sendTransaction'))).toBe(false);
});

test('Tampermonkey public panel uses isolated storage and connects lazily through the page provider',async({page})=>{
  await page.route('https://rh.farm/**',route=>route.fulfill({contentType:'text/html',body:'<html><body><h1>Game fixture</h1></body></html>'}));
  await page.goto('https://rh.farm/');
  await page.evaluate(({data,address})=>{
    window.__providerReads=0;window.__providerRequests=[];
    const provider={request:async({method})=>{window.__providerRequests.push(method);if(method==='eth_requestAccounts')return[address];if(method==='eth_chainId')return'0x1237';throw Error('Unexpected provider method');}};
    window.unsafeWindow={};Object.defineProperty(window.unsafeWindow,'ethereum',{get(){window.__providerReads++;return provider;}});
    Object.defineProperty(window,'ethereum',{get(){throw Error('Use page provider adapter');}});
    const values={'public-workspace-v2':JSON.stringify(data)};
    window.GM_getValue=(key,fallback)=>values[key]??fallback;window.GM_setValue=(key,value)=>{values[key]=value;};
    window.GM_xmlhttpRequest=()=>{throw Error('No network expected until explicit refresh');};
  },{data:workspace(),address:A});
  await page.addScriptTag({content:await readFile('dist/yield-farm-companion.user.js','utf8')});
  await page.getByRole('button',{name:'Open Farm Companion',exact:true}).click();await openActions(page);
  expect(await page.evaluate(()=>window.__providerReads)).toBe(0);
  await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();
  await expect(page.getByRole('region',{name:'Optional wallet actions'})).toContainText(A);
  expect(await page.evaluate(()=>window.__providerRequests)).toEqual(['eth_requestAccounts','eth_chainId']);
});

test('userscript journal fits desktop and phone viewports and returns keyboard focus to its launcher',async({page})=>{
  await page.route('https://rh.farm/**',route=>route.fulfill({contentType:'text/html',body:'<html><meta name="viewport" content="width=device-width,initial-scale=1"><body><h1>Game fixture</h1><button>Game action</button></body></html>'}));
  await page.goto('https://rh.farm/');
  await page.evaluate(()=>{
    const values={};window.GM_getValue=(key,fallback)=>values[key]??fallback;window.GM_setValue=(key,value)=>{values[key]=value;};
    window.GM_xmlhttpRequest=()=>{throw Error('No automatic network reads');};
    window.unsafeWindow={};Object.defineProperty(window.unsafeWindow,'ethereum',{get(){throw Error('No automatic wallet access');}});
  });
  await page.addScriptTag({content:await readFile('dist/yield-farm-companion.user.js','utf8')});
  const host=page.locator('#yield-farm-companion-host');
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    const open=page.getByRole('button',{name:'Open Farm Companion',exact:true});
    await expect(open).toHaveAttribute('aria-expanded','false');
    await expect(open).toHaveAttribute('aria-controls','yield-farm-companion-host');
    await open.click();
    const panel=await host.boundingBox(),launcher=await page.getByRole('button',{name:'Close Farm Companion',exact:true}).boundingBox();
    expect(panel.y+panel.height).toBeLessThan(launcher.y);
    expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.x+panel.width).toBeLessThanOrEqual(viewport.width);
    expect(await host.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    const actions=page.getByRole('button',{name:'Farm actions · connect & approve',exact:true});
    if(!await page.getByRole('button',{name:'Connect MetaMask',exact:true}).isVisible())await actions.click();
    await expect(page.getByRole('button',{name:'Connect MetaMask',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');await expect(host).toBeHidden();
    await expect(page.getByRole('button',{name:'Open Farm Companion',exact:true})).toBeFocused();
  }
  await page.getByRole('button',{name:'Open Farm Companion',exact:true}).click();
  await openMainTab(page,'My farm');await openAddPlots(page);
  await page.getByRole('button',{name:'Add model plots',exact:true}).click();
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(host).toBeVisible();
  await page.keyboard.press('Escape');await expect(host).toBeHidden();
});
