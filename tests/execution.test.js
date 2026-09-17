import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeFunctionData, encodeFunctionResult } from 'viem';
import { createExecutor, EXECUTION_DEPLOYMENTS, validatePendingRecord } from '../src/execution.js';
import { emptyPortfolio, UNIT, rules, weight } from '../src/model.js';

const A = '0x0000000000000000000000000000000000000001', B = '0x0000000000000000000000000000000000000002';
const HASH = `0x${'a'.repeat(64)}`, BLOCK_HASH = `0x${'b'.repeat(64)}`, ZERO = `0x${'0'.repeat(40)}`;
const deployment = key => EXECUTION_DEPLOYMENTS[key].address;
const fixtures = Object.fromEntries(Object.keys(EXECUTION_DEPLOYMENTS).map(key => [key, JSON.parse(readFileSync(new URL(`../knowledge/snapshots/verified-contracts-2026-09-11/${key}.json`, import.meta.url), 'utf8'))]));
const hex = value => `0x${BigInt(value).toString(16)}`;

test('forecast preview markers reject every transaction intent before public or wallet reads',async()=>{
  for(const marker of ['portfolio','plot'])for(const type of ['claim','plant','plant_bag','upgrade']){
    const c=setup();
    if(marker==='portfolio')c.portfolio.forecast_preview={mode:'manifest-preview'};
    else c.portfolio.wallets[0].plots[0].forecast_preview='planting';
    await assert.rejects(c.executor.prepare({...c.intent,type},c.portfolio),/Forecast previews cannot authorize/);
    assert.equal(c.reads.length,0);assert.equal(c.sent().length,0);
  }
});

function setup(options = {}) {
  const portfolio = emptyPortfolio(); portfolio.wallets=[portfolio.wallets[0],{...structuredClone(portfolio.wallets[0]),id:'wallet_b',label:'Wallet B'}];
  portfolio.is_demo = false; portfolio.is_template = false;
  portfolio.wallets.forEach((wallet, i) => { wallet.address = i ? B : A; wallet.crop_balance_wei = (100000n * UNIT).toString(); wallet.eth_balance_wei = UNIT.toString(); });
  portfolio.wallets[0].plots = [1, 2].map(token_id => ({ token_id, owner_address: A, rarity_tier: 0, level: 1, is_active: false, effective_weight_bps: 0, pending_crop_wei: '0', modifiers: null }));
  const state = { time: (rules.schedule.genesis_timestamp + 1) * 1000, chain: 4663, walletChain: 4663, account: A, owners: { 1: A, 2: A }, level: 1, active: false,
    allowance: 0n, balance: 100000n * UNIT, native: UNIT, gas: 50000n, gasPrice: 10n, fee: 2500n * UNIT, nextCost: 5000n * UNIT, pendingCrop: 50n * UNIT,
    activation: deployment('activation'), tier: 0, finalized: true, desired: null, effective: null, paused: false, levelsPaused: false, nonce: 0n, codeChanged: null, linkChanged: null, simulationError: false,
    failSend: null, wrongReturnedHash: false, mined: false, reverted: false, missingReceiptThrows: false, reorg: false, transaction: null, ...options };
  const reads = [], walletCalls = [], persisted = [];
  let providerLookups = 0, persistFails = false;
  const rpc = async (method, params) => {
    reads.push({ method, params });
    if (method === 'eth_chainId') return hex(state.chain);
    if (method === 'eth_getBlockByNumber') return { number: '0x64', timestamp: hex(Math.floor(state.time / 1000)), hash: state.reorg && params[0] !== 'latest' ? HASH : BLOCK_HASH };
    if (method === 'eth_getCode') {
      const key = Object.keys(EXECUTION_DEPLOYMENTS).find(key => deployment(key) === params[0]);
      return state.codeChanged === key ? '0x6000' : fixtures[key].runtimeBytecode.onchainBytecode;
    }
    if (method === 'eth_getBalance') return hex(state.native);
    if (method === 'eth_getTransactionCount') return hex(state.nonce);
    if (method === 'eth_gasPrice') return hex(state.gasPrice);
    if (method === 'eth_estimateGas') return hex(state.gas);
    if (method === 'eth_getTransactionByHash') return state.transaction;
    if (method === 'eth_getTransactionReceipt') {
      if (!state.mined && state.missingReceiptThrows) throw new Error('RPC result missing.');
      return state.mined ? { transactionHash: state.transaction.hash, from: state.transaction.from, to: state.transaction.to, status: state.reverted ? '0x0' : '0x1', blockNumber: '0x64', blockHash: BLOCK_HASH, gasUsed: '0x5208', effectiveGasPrice: '0xa' } : null;
    }
    if (method !== 'eth_call') throw new Error(`Unexpected public RPC: ${method}`);
    const tx = params[0], key = Object.keys(EXECUTION_DEPLOYMENTS).find(key => deployment(key) === tx.to.toLowerCase()), abi = fixtures[key].abi;
    const { functionName: name, args } = decodeFunctionData({ abi, data: tx.data });
    let result;
    if (['plant', 'plantWithBag', 'upgrade', 'claim', 'claimMany', 'approve'].includes(name)) {
      if (state.simulationError) throw new Error('execution reverted');
      result = name === 'approve' ? true : name.startsWith('claim') ? state.pendingCrop : undefined;
    } else if (name === 'activation') result = state.activation;
    else if (name === 'transferHook') result = state.linkChanged === 'transferHook' ? B : deployment('activation');
    else if (name === 'activationClearer') result = ZERO;
    else if (name === 'rarity') result = deployment('nft');
    else if (['crop', 'nft', 'emissions', 'levels', 'weather'].includes(name)) result = state.linkChanged === `${key}.${name}` ? B : deployment(name);
    else if (name === 'treasury') result = '0x778aa5BD0b28829b7C27eb3957C2D33848125D85';
    else if (name === 'start' || name === 'epochStart') result = BigInt(rules.schedule.genesis_timestamp);
    else if (name === 'decimals') result = 18;
    else if (name === 'FEE') result = state.fee;
    else if (name === 'BURN_BPS') result = 6000n;
    else if (name === 'paused') result = key === 'levels' ? state.levelsPaused : state.paused;
    else if (name === 'bagPrice') result = state.bagPrice ?? 10n**15n;
    else if (name === 'bagOpen') result = state.bagOpen ?? true;
    else if (name === 'BAG_BURN') result = 1500n*UNIT;
    else if (name === 'balanceOf') result = state.balance;
    else if (name === 'ownerOf') result = state.owners[Number(args[0])] ?? B;
    else if (name === 'levelOf') result = state.level;
    else if (name === 'isActive') result = state.active;
    else if (name === 'tiersFinalized') result = state.finalized;
    else if (name === 'rarityTier') result = state.tier;
    else if (name === 'desiredWeight') result = state.desired ?? BigInt(state.active ? weight(state.tier, state.level) : 0);
    else if (name === 'weightOf') result = state.effective ?? BigInt(state.active ? weight(state.tier, state.level) : 0);
    else if (name === 'pending') result = state.pendingCrop;
    else if (name === 'costToReach') result = state.nextCost;
    else if (name === 'allowance') result = args[0].toLowerCase() === '0x778aa5bd0b28829b7c27eb3957c2d33848125d85' ? 10000n*UNIT : state.allowance;
    else throw new Error(`Unmocked ${key}.${name}`);
    return encodeFunctionResult({ abi, functionName: name, result });
  };
  const provider = { request: async ({ method, params }) => {
    walletCalls.push({ method, params });
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [state.account];
    if (method === 'eth_chainId') return hex(state.walletChain);
    if (method === 'wallet_switchEthereumChain') { state.walletChain = 4663; return null; }
    if (method !== 'eth_sendTransaction') throw new Error(`Unexpected wallet method ${method}`);
    assert.equal(persisted.at(-1)?.phase, 'broadcast_unknown', 'lock must persist before asking the wallet');
    if (state.failSend) throw state.failSend;
    state.transaction = { ...params[0], input: params[0].data, hash: HASH };
    return state.wrongReturnedHash ? 'invalid' : HASH;
  } };
  const makeExecutor = () => createExecutor({ rpc, getProvider: () => { providerLookups++; return provider; }, now: () => state.time,
    onPending: async record => { if (persistFails) throw new Error('Storage unavailable'); persisted.push(record); } });
  const executor = makeExecutor();
  const intent = { type: 'plant', wallet_id: portfolio.wallets[0].id, plot_id: 1 };
  return { state, portfolio, executor, intent, rpc, makeExecutor, reads, walletCalls, persisted, providerLookups: () => providerLookups, failPersistence: () => { persistFails = true; },
    connect: () => executor.connect([A, B]), sent: () => walletCalls.filter(call => call.method === 'eth_sendTransaction') };
}

test('preparation uses pinned public reads and exact separate allowance, without looking up a wallet provider', async () => {
  const c = setup(), draft = await c.executor.prepare(c.intent, c.portfolio);
  assert.equal(c.providerLookups(), 0); assert.equal(c.walletCalls.length, 0);
  assert.equal(draft.type, 'approve'); assert.equal(draft.crop_cost_wei, '0'); assert.equal(draft.approval_amount_wei, (2500n * UNIT).toString());
  const decoded = decodeFunctionData({ abi: fixtures.crop.abi, data: draft.data });
  assert.equal(decoded.functionName, 'approve'); assert.equal(decoded.args[0].toLowerCase(), deployment('activation')); assert.equal(decoded.args[1], 2500n * UNIT);
  assert.equal(draft.network_cost_limit_wei, '600000');
  assert.ok(c.reads.filter(read => ['eth_call', 'eth_getCode', 'eth_estimateGas', 'eth_getBalance'].includes(read.method)).every(read => read.params[1] === '0x64'));
});

test('approval requires explicit submission and a matching mined receipt before a separately reviewed plant', async () => {
  const c = setup(); await c.connect();
  const draft = await c.executor.prepare(c.intent, c.portfolio);
  draft.to = B; draft.data = '0x'; // Public display objects cannot edit the private transaction draft.
  await c.executor.submit(draft.id);
  assert.equal(c.sent().length, 1); assert.equal(c.sent()[0].params[0].to, deployment('crop'));
  await assert.rejects(c.executor.submit(draft.id), /outstanding/);
  await assert.rejects(c.executor.prepare(c.intent, c.portfolio), /outstanding/);
  assert.equal((await c.executor.receipt()).status, 'pending');
  c.state.mined = true;
  assert.equal((await c.executor.receipt()).status, 'confirmed');
  assert.equal(c.sent().length, 1, 'receipt never performs the next action');
  c.state.allowance = 2500n * UNIT; c.state.nonce = 1n;
  const plant = await c.executor.prepare(c.intent, c.portfolio);
  assert.equal(plant.type, 'plant'); assert.equal(plant.crop_cost_wei, (2500n * UNIT).toString());
  await c.executor.submit(plant.id); assert.equal(c.sent().length, 2);
});

test('wallet account, chain, unknown draft, expired draft and modified intent block submission', async () => {
  const c = setup();
  await assert.rejects(c.executor.submit('invented'), /Unknown draft/);
  await assert.rejects(c.executor.prepare({ ...c.intent, to: B }, c.portfolio), /unsupported fields/);
  let draft = await c.executor.prepare(c.intent, c.portfolio);
  await assert.rejects(c.executor.submit(draft.id), /Connect/);
  await c.connect(); draft = await c.executor.prepare(c.intent, c.portfolio); c.state.account = B;
  await assert.rejects(c.executor.submit(draft.id), /does not match/);
  c.state.account = A; c.state.walletChain = 1;
  draft = await c.executor.prepare(c.intent, c.portfolio); await assert.rejects(c.executor.submit(draft.id), /Switch MetaMask/);
  assert.equal(c.walletCalls.some(call => call.method === 'wallet_switchEthereumChain'), false);
  await c.executor.switchChain(); assert.equal(c.executor.status().chain_id, 4663);
  draft = await c.executor.prepare(c.intent, c.portfolio); c.state.time += 90_001;
  await assert.rejects(c.executor.submit(draft.id), /expired/); assert.equal(c.sent().length, 0);
});

test('changed contract bytecode, deployment links, fees, ownership and pre-Genesis spend are blocked', async () => {
  const cases = [
    [{ chain: 1 }, /not Robinhood Chain/], [{ codeChanged: 'crop' }, /runtime differs/], [{ activation: B }, /deployment changed/],
    [{ linkChanged: 'activation.emissions' }, /contract link changed/], [{ fee: 1n }, /Live costs/], [{ owners: { 1: B } }, /no longer owned/],
    [{ time: (rules.schedule.genesis_timestamp - 1) * 1000 }, /Almanac opens/], [{ balance: 0n }, /more whole CROP/], [{ native: 1n }, /lacks native ETH/],
    [{ simulationError: true }, /execution reverted/], [{ reorg: true }, /reorganized/],
  ];
  for (const [options, pattern] of cases) { const c = setup(options); await assert.rejects(c.executor.prepare(c.intent, c.portfolio), pattern); assert.equal(c.sent().length, 0); }
  const c = setup(); c.portfolio.is_demo = true; await assert.rejects(c.executor.prepare(c.intent, c.portfolio), /demo/);
});

test('revalidation prevents a changed allowance, nonce, balance, level or increased gas price from spending', async () => {
  for (const change of [state => { state.allowance = 1n; }, state => { state.nonce++; }, state => { state.balance++; }, state => { state.level = 2; }, state => { state.gasPrice++; }]) {
    const c = setup(); await c.connect(); const draft = await c.executor.prepare(c.intent, c.portfolio); change(c.state);
    await assert.rejects(c.executor.submit(draft.id), /changed|increased/); assert.equal(c.sent().length, 0);
  }
});

test('one-step upgrades use incremental fee and the reviewed levels spender', async () => {
  const c = setup(); const draft = await c.executor.prepare({ ...c.intent, type: 'upgrade' }, c.portfolio);
  assert.equal(draft.type, 'approve'); assert.equal(draft.next_level, 2); assert.equal(draft.approval_amount_wei, (5000n * UNIT).toString());
  assert.equal(decodeFunctionData({ abi: fixtures.crop.abi, data: draft.data }).args[0].toLowerCase(), deployment('levels'));
  c.state.allowance = 10000n * UNIT;
  assert.equal((await c.executor.prepare({ ...c.intent, type: 'upgrade' }, c.portfolio)).type, 'upgrade');
  c.state.nextCost = 1n; await assert.rejects(c.executor.prepare({ ...c.intent, type: 'upgrade' }, c.portfolio), /upgrade cost/);
  c.state.levelsPaused = true; await assert.rejects(c.executor.prepare({ ...c.intent, type: 'upgrade' }, c.portfolio), /currently paused/);
});

test('investment requires finalized, matching rarity and synchronized ordinary weight', async () => {
  for (const [options, pattern] of [[{ finalized: false }, /not finalized/], [{ tier: 3 }, /rarity is unknown or changed/], [{ desired: 1n }, /weight needs synchronization/], [{ effective: 1n }, /weight needs synchronization/]]) {
    const c = setup(options); await assert.rejects(c.executor.prepare(c.intent, c.portfolio), pattern); assert.equal(c.sent().length, 0);
  }
  const c = setup(); c.portfolio.wallets[0].plots[0].rarity_tier = null;
  await assert.rejects(c.executor.prepare(c.intent, c.portfolio), /rarity is unknown/);
});

test('claim batch needs no allowance, tolerates new accrual and rejects wrong-wallet IDs or paused claims', async () => {
  const c = setup({ balance: 0n }); await c.connect();
  const intent = { type: 'claim', wallet_id: c.intent.wallet_id, plot_ids: [2, 1] }, draft = await c.executor.prepare(intent, c.portfolio);
  assert.equal(draft.type, 'claim'); assert.equal(draft.approval_amount_wei, '0');
  assert.equal(decodeFunctionData({ abi: fixtures.emissions.abi, data: draft.data }).functionName, 'claimMany');
  c.state.pendingCrop++; await c.executor.submit(draft.id); assert.equal(c.sent().length, 1);
  const paused = setup({ paused: true }); await assert.rejects(paused.executor.prepare(intent, paused.portfolio), /currently paused/);
  const absent = setup(); await assert.rejects(absent.executor.prepare({ ...intent, plot_ids: [1, 3] }, absent.portfolio), /Every selected plot/);
  const empty = setup({ pendingCrop: 0n }); await assert.rejects(empty.executor.prepare(intent, empty.portfolio), /no claimable/);
});

test('claims can synchronize a cached weight conflict while investments and changed live contracts stay blocked', async () => {
  const c = setup({ active: true, effective: 0n });
  c.portfolio.wallets[0].plots.forEach(plot => { plot.is_active = true; plot.effective_weight_bps = 0; });
  c.portfolio.rule_conflicts = ['Plot 1 effective weight needs synchronization.'];
  const claim = { ...c.intent, type: 'claim' };
  assert.equal((await c.executor.prepare(claim, c.portfolio)).type, 'claim');
  await assert.rejects(c.executor.prepare({ ...c.intent, type: 'upgrade' }, c.portfolio), /rule conflicts/);
  await assert.rejects(c.executor.prepare(c.intent, c.portfolio), /rule conflicts/);
  c.state.codeChanged = 'emissions';
  await assert.rejects(c.executor.prepare(claim, c.portfolio), /runtime differs/);
  c.state.codeChanged = null; c.state.fee = 1n;
  await assert.rejects(c.executor.prepare(claim, c.portfolio), /Live costs/);
});

test('user rejection permits a new review, while ambiguous wallet errors persist a lock across reload', async () => {
  const c = setup({ failSend: Object.assign(new Error('Rejected'), { code: 4001 }) }); await c.connect();
  let draft = await c.executor.prepare(c.intent, c.portfolio); await assert.rejects(c.executor.submit(draft.id), /Rejected/);
  assert.equal(c.executor.status().pending, null);
  draft = await c.executor.prepare(c.intent, c.portfolio); c.state.failSend = new Error('Disconnected during send');
  await assert.rejects(c.executor.submit(draft.id), /Disconnected/);
  const saved = c.persisted.at(-1); assert.equal(saved.phase, 'broadcast_unknown');
  const restored = c.makeExecutor(); restored.resumePending(saved);
  await assert.rejects(restored.prepare(c.intent, c.portfolio), /outstanding/);
  assert.equal(c.providerLookups(), 1, 'restoring a lock does not touch the wallet');
  c.state.failSend = null;
  c.state.transaction = { hash: HASH, from: saved.from, to: saved.to, input: saved.data, nonce: hex(saved.nonce), value: '0x0' };
  c.state.mined = true;
  assert.equal((await restored.receipt(HASH)).status, 'confirmed'); assert.equal(restored.status().pending, null);
});

test('receipts must match the pending hash, exact action and canonical block, including after reload', async () => {
  const c = setup({ allowance: 2500n * UNIT }); await c.connect();
  const draft = await c.executor.prepare(c.intent, c.portfolio); await c.executor.submit(draft.id);
  const restored = c.makeExecutor(); restored.resumePending(c.executor.status().pending);
  await assert.rejects(restored.receipt(BLOCK_HASH), /outstanding transaction hash/);
  c.state.missingReceiptThrows = true; assert.equal((await restored.receipt()).status, 'pending');
  c.state.mined = true; const original = c.state.transaction.input; c.state.transaction.input = '0x';
  await assert.rejects(restored.receipt(), /does not match/); assert.ok(restored.status().pending);
  c.state.transaction.input = original; c.state.reorg = true;
  await assert.rejects(restored.receipt(), /canonical/); assert.ok(restored.status().pending);
  c.state.reorg = false; c.state.reverted = true;
  assert.equal((await restored.receipt()).status, 'reverted'); assert.equal(restored.status().pending, null);
});

test('malformed persisted approvals, foreign targets and storage failure cannot produce a transaction', async () => {
  const c = setup(); await c.connect(); const draft = await c.executor.prepare(c.intent, c.portfolio); await c.executor.submit(draft.id);
  const saved = c.executor.status().pending;
  assert.deepEqual(validatePendingRecord(saved), saved);
  for (const mutation of [{ to: B }, { nonce: '-1' }, { data: '0x' }, { approval_amount_wei: (2n ** 256n - 1n).toString() }, { plot_ids: [1, 1] }, { chain_id: 1 }]) {
    assert.throws(() => validatePendingRecord({ ...saved, ...mutation }));
  }
  const broken = setup(); await broken.connect(); const next = await broken.executor.prepare(broken.intent, broken.portfolio); broken.failPersistence();
  await assert.rejects(broken.executor.submit(next.id), /Storage unavailable/); assert.equal(broken.sent().length, 0);
});

test('concurrent submit calls produce at most one wallet transaction', async () => {
  const c = setup(); await c.connect(); const draft = await c.executor.prepare(c.intent, c.portfolio);
  const results = await Promise.allSettled([c.executor.submit(draft.id), c.executor.submit(draft.id)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(c.sent().length, 1);
});

test('explicit replacement reconciliation proves nonce consumption and distinguishes cancellation from a speed-up', async () => {
  for (const cancel of [false, true]) {
    const c = setup(); await c.connect(); const draft = await c.executor.prepare(c.intent, c.portfolio); await c.executor.submit(draft.id);
    const replacementHash = `0x${'c'.repeat(64)}`;
    c.state.transaction = { ...c.state.transaction, hash: replacementHash, ...(cancel ? { to: A, input: '0x', data: '0x' } : {}) };
    await assert.rejects(c.executor.receipt(replacementHash), /outstanding transaction hash/);
    assert.equal((await c.executor.replacementReceipt(replacementHash)).status, 'pending'); assert.ok(c.executor.status().pending);
    c.state.mined = true; c.state.transaction.nonce = '0x1';
    await assert.rejects(c.executor.replacementReceipt(replacementHash), /does not match/); assert.ok(c.executor.status().pending);
    c.state.transaction.nonce = '0x0';
    const result = await c.executor.replacementReceipt(replacementHash);
    assert.equal(result.status, cancel ? 'replaced' : 'confirmed'); assert.equal(result.replacement_status, cancel ? 'confirmed' : null);
    assert.equal(c.executor.status().pending, null); assert.equal(c.sent().length, 1);
  }
});

test('seed bags require a separate exact-value review, no CROP allowance, and matching ETH receipt', async () => {
  const c=setup(); c.portfolio.wallets=c.portfolio.wallets.slice(0,1);
  await c.executor.connect([A]);
  const draft=await c.executor.prepare({...c.intent,type:'plant_bag'},c.portfolio);
  assert.equal(draft.type,'plant_bag'); assert.equal(draft.value_wei,(10n**15n).toString());
  assert.equal(draft.crop_cost_wei,'0'); assert.equal(draft.approval_amount_wei,'0');
  assert.equal(decodeFunctionData({abi:fixtures.activation.abi,data:draft.data}).functionName,'plantWithBag');
  await c.executor.submit(draft.id);
  assert.equal(BigInt(c.sent()[0].params[0].value),10n**15n);
  const pending=c.executor.status().pending;assert.deepEqual(validatePendingRecord(pending),pending);
  const restored=c.makeExecutor();restored.resumePending(pending);c.state.mined=true;
  c.state.transaction.value='0x0';await assert.rejects(restored.receipt(),/does not match/);
  c.state.transaction.value=hex(10n**15n);assert.equal((await restored.receipt()).status,'confirmed');
  assert.equal(c.sent().length,1);
});

test('seed bags stop on repricing, closure, inadequate ETH or invalid persisted value',async()=>{
  const c=setup();await c.connect();const draft=await c.executor.prepare({...c.intent,type:'plant_bag'},c.portfolio);
  c.state.bagPrice=2n*10n**15n;await assert.rejects(c.executor.submit(draft.id),/changed/);assert.equal(c.sent().length,0);
  for(const options of [{bagOpen:false},{bagPrice:0n},{bagPrice:2n*10n**16n},{native:10n**15n}]) {
    const x=setup(options);await assert.rejects(x.executor.prepare({...x.intent,type:'plant_bag'},x.portfolio));assert.equal(x.sent().length,0);
  }
  c.state.bagPrice=10n**15n;const next=await c.executor.prepare({...c.intent,type:'plant_bag'},c.portfolio);await c.executor.submit(next.id);
  for(const value_wei of ['0','-1',(2n*10n**16n).toString()]) assert.throws(()=>validatePendingRecord({...c.executor.status().pending,value_wei}));
});

test('configured accounts can contain one or many public wallets but never duplicate addresses',async()=>{
  const c=setup();await c.executor.connect([A]);assert.equal(c.executor.status().account,A);
  await c.executor.connect([A,B,'0x0000000000000000000000000000000000000003']);
  await assert.rejects(c.executor.connect([A,A]),/distinct|duplicate/);
});
