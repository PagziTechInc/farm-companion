import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionResult, parseAbi } from 'viem';
import { createReader as buildReader, fetchJSON } from '../src/reader.js';
import { emptyPortfolio, units, rules } from '../src/model.js';
import integrations from '../knowledge/integrations.json' with { type: 'json' };
import commitment from '../knowledge/snapshots/manifest-comparison-2026-09-07.json' with { type: 'json' };
import nftRuntime from '../knowledge/snapshots/verified-contracts-2026-09-11/nft.json' with { type: 'json' };
const A = '0x0000000000000000000000000000000000000001', B = '0x0000000000000000000000000000000000000002';
const fastReaderOptions = { spacingMs: 0, retryBaseMs: 0, retryMaxMs: 0, sleep: () => Promise.resolve() };
const createReader = (transport, manifestTiers = [], options = {}) => buildReader(transport, manifestTiers, { ...fastReaderOptions, ...options });
function mock({ wrongChain = false, failPending = false, changedManifest = false, failInventory = false, startingIndex = 1n, tiersFinalized = true,
  failTier = false, failFinalized = false, failDesired = false, chainTierB = 2, staleWeight = false, conflictingDesired = false, failMetadata = false, badRuntime = false, rateLimitPending = false, networkPending = false } = {}) {
  const calls = [];
  const extras = { nft: ['function rarityTier(uint256 tokenId) view returns (uint8)', 'function tiersFinalized() view returns (bool)'], emissions: ['function desiredWeight(uint256 tokenId) view returns (uint256)'] };
  const byAddress = Object.fromEntries(Object.entries(integrations.contracts).filter(([, c]) => c.read_signatures).map(([k, c]) => [c.address.toLowerCase(), { key: k, abi: parseAbi([...new Set([...c.read_signatures, ...(extras[k] ?? [])])]) }]));
  return { calls, transport: async (url, options) => {
    if (!options) { if (failMetadata) throw new Error('Fixture metadata outage'); return { attributes: url.endsWith('/1') ? [{ trait_type: 'Status', value: 'Unrevealed' }] : [{ trait_type: 'Crop', value: 'Corn' }] }; }
    const payload = JSON.parse(options.body), requests = Array.isArray(payload) ? payload : [payload];
    calls.push(...requests);
    const responses = requests.map(request => {
      const { method, params } = request;
      if (method === 'eth_chainId') return { jsonrpc: '2.0', id: request.id, result: wrongChain ? '0x1' : '0x1237' };
      if (method === 'eth_getBlockByNumber') return { jsonrpc: '2.0', id: request.id, result: { number: '0x2a', timestamp: '0x6ab07380' } };
      if (method === 'eth_getBalance') return { jsonrpc: '2.0', id: request.id, result: '0x0' };
      if (method === 'eth_getCode') return { jsonrpc: '2.0', id: request.id, result: badRuntime ? '0x1234' : nftRuntime.runtimeBytecode.onchainBytecode };
      const contract = byAddress[params[0].to.toLowerCase()], decoded = decodeFunctionData({ abi: contract.abi, data: params[0].data });
      const fn = decoded.functionName, args = decoded.args ?? [];
      if (fn === 'pending' && networkPending) throw Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' });
      if (fn === 'pending' && (failPending || rateLimitPending)) return { jsonrpc: '2.0', id: request.id, error: rateLimitPending ? { code: -32005, message: 'rate limited' } : { message: 'Fixture RPC failure' } };
      if ((fn === 'tokensOfOwner' && failInventory) || (fn === 'rarityTier' && failTier) || (fn === 'tiersFinalized' && failFinalized) || (fn === 'desiredWeight' && failDesired)) return { jsonrpc: '2.0', id: request.id, error: { message: 'Fixture RPC failure' } };
      const values = { totalWeight: 25000n, activation: integrations.contracts.activation.address, multiplierNow: 12000n, epochStart: 1789948800n, startingIndex, tiersFinalized,
        manifestHash: changedManifest ? '0x' + '0'.repeat(64) : commitment.on_chain_hash, currentEpoch: 0n, nextBoundary: 1790553600n,
        FEE: units('2500'), balanceOf: 0n, levelOf: 1, pending: units('100'), weightOf: 10000n, isActive: true, carryNow:units('123'),granaryNow:units('40000000'),emitted:0n,paidOut:0n,RATE_PER_WEIGHT_PER_WEEK:units('2000'),bagPrice:10n**15n,bagOpen:true };
      let result = values[fn];
      if (fn === 'rarityTier') result = args[0] === 2n ? chainTierB : 0;
      if (fn === 'weightOf') result = args[0] === 2n && !staleWeight ? 15000n : 10000n;
      if (fn === 'desiredWeight') result = args[0] === 2n ? (conflictingDesired ? 20000n : 15000n) : 10000n;
      if (fn === 'tokensOfOwner') result = args[0].toLowerCase() === A.toLowerCase() ? [1n] : [2n];
      if (fn === 'costToReach') result = units(rules.levels.entries[Number(args[0])-1].incremental_upgrade_cost_crop);
      return { jsonrpc: '2.0', id: request.id, result: encodeFunctionResult({ abi: contract.abi, functionName: fn, result }) };
    });
    return Array.isArray(payload) ? responses : responses[0];
  } };
}
function holdings() { const p = emptyPortfolio(); p.wallets=[p.wallets[0],{...structuredClone(p.wallets[0]),id:'wallet_b',label:'Wallet B'}]; p.wallets[0].address = A; p.wallets[1].address = B; return p; }
test('reader pins contract and balance calls to one block; never signs', async () => {
  const m = mock(), result = await createReader(m.transport, [0, 0, 2]).snapshot(holdings());
  assert.equal(result.block_number, 42);
  assert.equal(result.carry_crop_wei,units('123').toString()); assert.equal(result.granary_crop_wei,units('40000000').toString());
  assert.equal(result.seed_bag_open,true); assert.equal(result.expected_total_plots,2);
  assert.equal(result.wallets[0].plots[0].rarity_tier, 0);
  assert.equal(result.wallets[1].plots[0].rarity_tier, 2);
  assert.equal(result.tiers_finalized, true);
  assert.equal(result.wallets[1].plots[0].rarity_verified, true);
  assert.deepEqual(result.rule_conflicts, []);
  assert.equal(result.wallets[1].plots[0].pending_crop_wei, units('100').toString());
  for (const c of m.calls.filter(c => ['eth_call', 'eth_getBalance'].includes(c.method))) assert.equal(c.params[1], '0x2a');
  assert.ok(m.calls.every(c => !/send|sign/i.test(c.method)));
  await assert.rejects(createReader(m.transport).rpc('eth_sendTransaction', []), /read-only/);
});
test('wrong network and duplicate wallets reject before a portfolio can be shown', async () => {
  await assert.rejects(createReader(mock({ wrongChain: true }).transport).snapshot(holdings()), /Wrong RPC chain/);
  const p = holdings(); p.wallets[1].address = A;
  await assert.rejects(createReader(mock().transport).snapshot(p), /different/);
});
test('partial failures are unknown rather than zero', async () => {
  const r = await createReader(mock({ failPending: true }).transport, [0, 0, 2]).snapshot(holdings());
  assert.equal(r.wallets[0].plots[0].pending_crop_wei, null);
  assert.ok(r.read_errors.some(e => e.includes('pending')));
});
test('changed commitment disables cached rarity mapping', async () => {
  const r = await createReader(mock({ changedManifest: true }).transport, [0, 0, 2]).snapshot(holdings());
  assert.equal(r.manifest_verified, false); assert.equal(r.wallets[1].plots[0].rarity_tier, null);
});
test('failed inventory preserves old IDs but invalidates their live earning state', async () => {
  const p = holdings(); p.wallets[0].plots = [{ token_id: 17, pending_crop_wei: '123', is_active: true, effective_weight_bps: 10000 }];
  const r = await createReader(mock({ failInventory: true }).transport).snapshot(p);
  assert.equal(r.wallets[0].plots[0].token_id, 17); assert.equal(r.wallets[0].plots[0].pending_crop_wei, null);
  assert.equal(r.wallets[0].plots[0].rarity_verified, false);
  assert.equal(r.wallets[0].plots[0].level, null);
  assert.equal(r.wallets[0].plots[0].rarity_tier, null);
});
test('zero reveal offsets and unfinished tier assignment never create trusted rarity', async () => {
  for (const options of [{ startingIndex: 0n, tiersFinalized: false }, { tiersFinalized: false }, { failFinalized: true }]) {
    const r = await createReader(mock(options).transport, [0, 0, 2]).snapshot(holdings());
    for (const w of r.wallets) for (const p of w.plots) {
      assert.equal(p.rarity_tier, null); assert.equal(p.rarity_verified, false);
    }
    if (options.failFinalized) {
      assert.ok(r.read_errors.some(e => /finaliz/.test(e)));
      assert.equal(r.rarity_status, 'unavailable');
    } else {
      assert.equal(r.read_warnings.filter(e => /finaliz/.test(e)).length, 1);
      assert.equal(r.rarity_status, options.startingIndex === 0n ? 'unrevealed' : 'pending_finalization');
    }
  }
});
test('finalized chain and committed manifest rarity survive stale or unavailable art metadata', async () => {
  for (const failMetadata of [false, true]) {
    const r = await createReader(mock({ failMetadata }).transport, [0, 0, 2]).snapshot(holdings());
    assert.equal(r.wallets[0].plots[0].rarity_tier, 0);
    assert.equal(r.wallets[0].plots[0].reveal_status, 'revealed');
    assert.equal(r.wallets[0].plots[0].metadata_reveal_status, 'unknown');
    assert.equal(r.wallets[1].plots[0].rarity_tier, 2);
    assert.equal(r.metadata_errors.length, failMetadata ? 2 : 0);
    assert.equal(r.read_errors.some(error => /metadata/i.test(error)), false);
  }
});
test('finalized direct tier disagreements are blockers, never replaced by manifest guesses', async () => {
  const r = await createReader(mock({ chainTierB: 3 }).transport, [0, 0, 2]).snapshot(holdings());
  const p = r.wallets[1].plots[0];
  assert.equal(p.rarity_tier, null); assert.equal(p.chain_rarity_tier, 3); assert.equal(p.manifest_rarity_tier, 2);
  assert.ok(r.rule_conflicts.some(e => e.includes('finalized chain rarity differs')));
});
test('missing direct tier remains unknown even with finalized metadata and a matching manifest', async () => {
  const r = await createReader(mock({ failTier: true }).transport, [0, 0, 2]).snapshot(holdings());
  assert.equal(r.wallets[1].plots[0].rarity_tier, null);
  assert.equal(r.wallets[1].plots[0].chain_rarity_tier, null);
  assert.ok(r.read_errors.some(e => e.includes('chain rarity')));
});
test('stale and changed desired weights block advice while preserving both observed weights', async () => {
  const r = await createReader(mock({ staleWeight: true }).transport, [0, 0, 2]).snapshot(holdings());
  const p = r.wallets[1].plots[0];
  assert.equal(p.effective_weight_bps, 10000); assert.equal(p.desired_weight_bps, 15000);
  assert.equal(p.weight_synchronized, false);
  assert.ok(r.rule_conflicts.some(e => e.includes('synchronize and refresh')));
  const changed = await createReader(mock({ conflictingDesired: true }).transport, [0, 0, 2]).snapshot(holdings());
  assert.ok(changed.rule_conflicts.some(e => e.includes('ordinary level and rarity rules')));
});
test('failed desired-weight reads do not report synchronization as verified', async () => {
  const r = await createReader(mock({ failDesired: true }).transport, [0, 0, 2]).snapshot(holdings());
  assert.equal(r.wallets[1].plots[0].desired_weight_bps, null);
  assert.equal(r.wallets[1].plots[0].weight_synchronized, null);
  assert.ok(r.rule_conflicts.some(e => e.includes('synchronization could not be verified')));
});


test('one public wallet and three public wallets need no private two-wallet configuration', async()=>{
  const one=holdings();one.wallets=one.wallets.slice(0,1);
  const r=await createReader(mock().transport,[0,0,2]).snapshot(one);
  assert.equal(r.wallets.length,1);assert.equal(r.expected_total_plots,1);
  const duplicate=holdings();duplicate.wallets.push({...structuredClone(duplicate.wallets[0]),id:'wallet_c'});
  await assert.rejects(createReader(mock().transport).snapshot(duplicate),/different/);
});

test('fetchJSON preserves the read-only request contract and exposes bounded HTTP retry metadata', async () => {
  const previousFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, options) => {
    request = options;
    return { ok: false, status: 429, headers: { get: name => name.toLowerCase() === 'retry-after' ? '2' : null } };
  };
  try {
    let error;
    try { await fetchJSON('https://rpc.example.test/read'); } catch (caught) { error = caught; }
    assert.equal(error?.httpStatus, 429);
    assert.equal(error?.status, 429);
    assert.equal(error?.retryAfter, '2');
    assert.equal(error?.retryAfterMs, 2000);
    assert.equal(request.credentials, 'omit');
    assert.ok(request.signal);
  } finally { globalThis.fetch = previousFetch; }
});

test('HTTP and JSON-RPC rate limits retry with the same pinned arguments', async () => {
  const attempts = [], delays = [];
  let now = 0;
  const transport = async (_url, options) => {
    const request = JSON.parse(options.body);
    attempts.push(request);
    if (attempts.length === 1) {
      const error = new Error('HTTP 503');
      error.httpStatus = 503; error.retryAfterMs = 0;
      throw error;
    }
    if (attempts.length === 2) return { jsonrpc: '2.0', id: request.id, error: { code: 429, message: 'rate limited' } };
    return { jsonrpc: '2.0', id: request.id, result: '0x2a' };
  };
  const reader = createReader(transport, [], { spacingMs: 0, retryBaseMs: 1000, retryMaxMs: 2000, now: () => now, sleep: ms => { delays.push(ms); now += ms; return Promise.resolve(); } });
  assert.equal(await reader.rpc('eth_getBlockByNumber', ['0x2a', false]), '0x2a');
  assert.equal(attempts.length, 3);
  assert.deepEqual(attempts.map(request => request.method), ['eth_getBlockByNumber', 'eth_getBlockByNumber', 'eth_getBlockByNumber']);
  assert.deepEqual(attempts.map(request => request.params), [['0x2a', false], ['0x2a', false], ['0x2a', false]]);
  assert.deepEqual(delays, [1000, 2000]);
});

test('raw HTTP-date Retry-After is measured at retry time and remains bounded', async () => {
  let attempts = 0, now = 0;
  const delays = [], retryAt = new Date(5000).toUTCString();
  const reader = createReader(async (_url, options) => {
    attempts++;
    const request = JSON.parse(options.body);
    return attempts === 1 ? { jsonrpc: '2.0', id: request.id, error: { code: 429, message: 'rate limited', retryAfter: retryAt } } : { jsonrpc: '2.0', id: request.id, result: '0x0' };
  }, [], { spacingMs: 0, retryBaseMs: 100, retryMaxMs: 200, now: () => now, sleep: ms => { delays.push(ms); now += ms; return Promise.resolve(); } });
  assert.equal(await reader.rpc('eth_getBalance', [A, '0x2a']), '0x0');
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [5000]);
});

test('browser fetch failures and abort timeouts recover within the retry bound', async () => {
  for (const failure of [Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' }), Object.assign(new Error('request timed out'), { name: 'AbortError' })]) {
    let attempts = 0;
    const reader = createReader(async (_url, options) => {
      attempts++;
      if (attempts === 1) throw failure;
      const request = JSON.parse(options.body);
      return { jsonrpc: '2.0', id: request.id, result: '0x0' };
    }, [], { spacingMs: 0, retryBaseMs: 0, retryMaxMs: 0, sleep: () => Promise.resolve() });
    assert.equal(await reader.rpc('eth_getBalance', [A, '0x2a']), '0x0');
    assert.equal(attempts, 2);
  }
});

test('exhausted rate limits stay unknown inside a snapshot after three attempts', async () => {
  const m = mock({ rateLimitPending: true }), delays = [];
  let now = 0;
  const result = await createReader(m.transport, [0, 0, 2], { spacingMs: 0, retryBaseMs: 1000, retryMaxMs: 2000, now: () => now, sleep: ms => { delays.push(ms); now += ms; return Promise.resolve(); } }).snapshot(holdings());
  assert.equal(result.wallets[0].plots[0].pending_crop_wei, null);
  assert.equal(result.wallets[1].plots[0].pending_crop_wei, null);
  assert.ok(result.read_errors.filter(error => error.includes('pending')).length >= 2);
  assert.ok(m.calls.filter(call => call.method === 'eth_call').length >= 6);
  assert.ok(delays.includes(1000));
});

test('exhausted browser network failures stay unknown without inventing balances', async () => {
  const m = mock({ networkPending: true });
  const result = await createReader(m.transport, [0, 0, 2], { spacingMs: 0, retryBaseMs: 0, retryMaxMs: 0, sleep: () => Promise.resolve() }).snapshot(holdings());
  assert.equal(result.wallets[0].plots[0].pending_crop_wei, null);
  assert.equal(result.wallets[1].plots[0].pending_crop_wei, null);
  assert.ok(result.read_errors.filter(error => error.includes('pending')).length >= 2);
  assert.ok(m.calls.filter(call => call.method === 'eth_call').length >= 6);
});

test('deterministic contract reverts are not retried', async () => {
  let attempts = 0;
  const reader = createReader(async (_url, options) => {
    attempts++;
    const request = JSON.parse(options.body);
    return { jsonrpc: '2.0', id: request.id, error: { code: 3, message: 'execution reverted: tiers are not finalized' } };
  }, [], { spacingMs: 0, sleep: () => Promise.resolve() });
  await assert.rejects(reader.rpc('eth_call', [{ to: A, data: '0x' }, '0x2a']), /execution reverted/);
  assert.equal(attempts, 1);
});

test('deterministic JSON-RPC protocol errors and invalid JSON are not retried', async () => {
  for (const [code, message] of [[-32700, 'parse error'], [-32601, 'method not found'], [-32602, 'invalid params']]) {
    let attempts = 0;
    const reader = createReader(async (_url, options) => {
      attempts++;
      const request = JSON.parse(options.body);
      return { jsonrpc: '2.0', id: request.id, error: { code, message } };
    }, [], { spacingMs: 0, sleep: () => Promise.resolve() });
    await assert.rejects(reader.rpc('eth_call', [{ to: A, data: '0x' }, '0x2a']), new RegExp(message));
    assert.equal(attempts, 1);
  }
  let attempts = 0;
  const reader = createReader(async () => { attempts++; throw new SyntaxError('Unexpected token < in JSON'); }, [], { spacingMs: 0, sleep: () => Promise.resolve() });
  await assert.rejects(reader.rpc('eth_getBalance', [A, '0x2a']), /Unexpected token/);
  assert.equal(attempts, 1);
});

test('per-reader RPC queue never exceeds two in-flight reads', async () => {
  let active = 0, maximum = 0;
  const reader = createReader(async (_url, options) => {
    active++; maximum = Math.max(maximum, active);
    const request = JSON.parse(options.body);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return { jsonrpc: '2.0', id: request.id, result: request.method === 'eth_getBalance' ? '0x0' : '0x1' };
  }, [], { batchSize: 1, spacingMs: 0 });
  await Promise.all(Array.from({ length: 12 }, (_, index) => reader.rpc('eth_getBalance', [A, `0x${(index + 1).toString(16)}`])));
  assert.equal(maximum, 2);
});

test('a transient transport failure cools down queued starts shared by the reader', async () => {
  let active = 0, maximum = 0, now = 0;
  const starts = [], delays = [], seen = new Map();
  const sleep = ms => { delays.push(ms); now += ms; return Promise.resolve(); };
  const reader = createReader(async (_url, options) => {
    active++; maximum = Math.max(maximum, active);
    const request = JSON.parse(options.body), count = (seen.get(request.id) ?? 0) + 1;
    seen.set(request.id, count); starts.push({ id: request.id, at: now });
    active--;
    if (request.id === 1 && count === 1) {
      const error = new Error('HTTP 429');
      error.httpStatus = 429;
      throw error;
    }
    return { jsonrpc: '2.0', id: request.id, result: '0x0' };
  }, [], { batchSize: 1, concurrency: 2, spacingMs: 0, retryBaseMs: 1000, retryMaxMs: 2000, sleep, now: () => now });
  await Promise.all(Array.from({ length: 5 }, () => reader.rpc('eth_getBalance', [A, '0x2a'])));
  assert.equal(maximum, 1);
  assert.ok(starts.some(start => start.at >= 1000));
  assert.ok(delays.some(delay => delay >= 1000));
});

test('read batches contain at most twenty requests and resolve out of order', async () => {
  const batches = [];
  const reader = createReader(async (_url, options) => {
    const payload = JSON.parse(options.body), requests = Array.isArray(payload) ? payload : [payload];
    batches.push(requests);
    const responses = requests.slice().reverse().map(request => ({ jsonrpc: '2.0', id: request.id, result: request.params[1] }));
    return Array.isArray(payload) ? responses : responses[0];
  }, [], { batchSize: 20, spacingMs: 0 });
  const tags = Array.from({ length: 25 }, (_, index) => `0x${(index + 1).toString(16)}`);
  const results = await Promise.all(tags.map(tag => reader.rpc('eth_getBalance', [A, tag])));
  assert.equal(batches.length, 2);
  assert.deepEqual(batches.map(batch => batch.length), [20, 5]);
  assert.deepEqual(results, tags);
  assert.ok(batches.flat().every(request => request.method === 'eth_getBalance' && request.params[0] === A));
  assert.equal(new Set(batches.flat().map(request => request.id)).size, 25);
});

test('a transient item in a batch retries alone with its original ID and params', async () => {
  const batches = [], attempts = new Map();
  const reader = createReader(async (_url, options) => {
    const payload = JSON.parse(options.body), requests = Array.isArray(payload) ? payload : [payload];
    batches.push(requests);
    const responses = requests.slice().reverse().map(request => {
      const seen = (attempts.get(request.id) ?? 0) + 1;
      attempts.set(request.id, seen);
      return request.params[1] === '0x2' && seen === 1
        ? { jsonrpc: '2.0', id: request.id, error: { code: -32005, message: 'rate limited' } }
        : { jsonrpc: '2.0', id: request.id, result: request.params[1] };
    });
    return Array.isArray(payload) ? responses : responses[0];
  }, [], { batchSize: 20, spacingMs: 0, retryBaseMs: 0, retryMaxMs: 0 });
  const results = await Promise.all(['0x1', '0x2', '0x3'].map(tag => reader.rpc('eth_getBalance', [A, tag])));
  assert.deepEqual(results, ['0x1', '0x2', '0x3']);
  assert.deepEqual(batches.map(batch => batch.length), [3, 1]);
  assert.equal(batches[1][0].id, batches[0].find(request => request.params[1] === '0x2').id);
  assert.deepEqual(batches[1][0].params, [A, '0x2']);
  assert.deepEqual([...attempts.values()].sort((a, b) => a - b), [1, 1, 2]);
});

test('malformed batch envelopes reject every member without replaying it', async () => {
  for (const mode of ['missing', 'duplicate', 'unknown']) {
    let calls = 0;
    const reader = createReader(async (_url, options) => {
      calls++;
      const requests = JSON.parse(options.body), first = requests[0];
      if (mode === 'missing') return [{ jsonrpc: '2.0', id: first.id, result: '0x0' }];
      if (mode === 'duplicate') return requests.map(request => ({ jsonrpc: '2.0', id: first.id, result: '0x0' }));
      return [{ jsonrpc: '2.0', id: first.id, result: '0x0' }, { jsonrpc: '2.0', id: 999, result: '0x0' }];
    }, [], { batchSize: 20, spacingMs: 0 });
    const results = await Promise.allSettled([reader.rpc('eth_getBalance', [A, '0x1']), reader.rpc('eth_getBalance', [A, '0x2'])]);
    assert.equal(calls, 1);
    assert.ok(results.every(result => result.status === 'rejected' && /RPC batch response/.test(result.reason.message)));
  }
});

test('pending finalization is a warning and does not erase economic reads', async () => {
  const result = await createReader(mock({ tiersFinalized: false }).transport, [0, 0, 2], { spacingMs: 0, sleep: () => Promise.resolve() }).snapshot(holdings());
  assert.equal(result.rarity_status, 'pending_finalization');
  assert.equal(result.read_warnings.filter(error => /finalized/.test(error)).length, 1);
  assert.equal(result.read_errors.some(error => /rarity assignment is not confirmed finalized/.test(error)), false);
  assert.equal(result.wallets[0].plots[0].rarity_tier, null);
  assert.equal(result.wallets[0].plots[0].rarity_verified, false);
  assert.equal(result.wallets[0].plots[0].pending_crop_wei, units('100').toString());
});

test('an unreviewed NFT runtime disables manifest mapping', async () => {
  const result = await createReader(mock({ badRuntime: true }).transport, [0, 0, 2], { spacingMs: 0, sleep: () => Promise.resolve() }).snapshot(holdings());
  assert.equal(result.nft_runtime_verified, false);
  assert.equal(result.wallets[1].plots[0].manifest_rarity_tier, null);
  assert.equal(result.wallets[1].plots[0].rarity_tier, null);
  assert.ok(result.read_errors.some(error => /NFT runtime/.test(error)));
});

test('a successful actual refresh clears imported forecast preview markers', async () => {
  const previous = holdings();
  previous.forecast_preview = { mode: 'manifest-preview' };
  previous.wallets[0].plots = [{ token_id: 1, forecast_preview: 'manifest-rarity', rarity_tier: 0 }];
  const result = await createReader(mock().transport, [0, 0, 2], { spacingMs: 0, sleep: () => Promise.resolve() }).snapshot(previous);
  assert.equal(Object.hasOwn(result, 'forecast_preview'), false);
  assert.equal(Object.hasOwn(result.wallets[0].plots[0], 'forecast_preview'), false);
});
