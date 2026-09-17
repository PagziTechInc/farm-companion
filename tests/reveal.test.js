import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionResult, parseAbi, toHex } from 'viem';
import { readRevealState } from '../src/reveal.js';
import integrations from '../knowledge/integrations.json' with { type: 'json' };
import runtime from '../knowledge/snapshots/verified-contracts-2026-09-11/nft.json' with { type: 'json' };
import commitment from '../knowledge/snapshots/manifest-comparison-2026-09-07.json' with { type: 'json' };
const abi = parseAbi(integrations.contracts.nft.read_signatures), now = Date.parse('2026-09-18T19:00:00Z');
function fixture(overrides = {}) {
  const calls = [], values = { totalSupply: 3333n, startingIndex: 0n, manifestHash: commitment.on_chain_hash, tiersFinalized: false, ...overrides };
  const block = { number: toHex(64000000), timestamp: toHex(now / 1000), hash: '0x' + '1'.repeat(64), ...overrides.block };
  return { calls, block, rpc: async (method, params) => {
    calls.push({ method, params });
    if (method === 'eth_chainId') return overrides.chain ?? toHex(4663);
    if (method === 'eth_getBlockByNumber') return block;
    if (method === 'eth_getCode') return overrides.code ?? runtime.runtimeBytecode.onchainBytecode;
    const { functionName } = decodeFunctionData({ abi, data: params[0].data });
    return encodeFunctionResult({ abi, functionName, result: values[functionName] });
  } };
}
test('sellout and dates do not establish reveal; all reads use one reviewed block', async () => {
  const f = fixture(), result = await readRevealState(f.rpc, { now });
  assert.equal(result.status, 'sealed'); assert.equal(result.total_supply, 3333);
  assert.equal(result.runtime_verified, true); assert.equal(result.manifest_verified, true);
  for (const call of f.calls.filter(c => ['eth_call','eth_getCode'].includes(c.method))) assert.equal(call.params[1], f.block.number);
});
test('positive offset permits collecting revealed art before economic tiers finalize', async () => {
  const f = fixture({ startingIndex: 101n, totalSupply: 100n });
  const result = await readRevealState(f.rpc, { now });
  assert.equal(result.status, 'revealed'); assert.equal(result.tiers_finalized, false);
  assert.equal(result.starting_index, 101);
});
test('wrong chain, changed runtime/manifest, stale block and impossible reveal fail closed', async () => {
  for (const change of [{ chain: '0x1' }, { code: '0x1234' }, { manifestHash: '0x'+'2'.repeat(64) },
    { block: { timestamp: toHex(now/1000 - 301) } }, { block: { hash: null } },
    { startingIndex: 3333n }, { totalSupply: 3334n }, { tiersFinalized: true }]) {
    const result = await readRevealState(fixture(change).rpc, { now });
    assert.equal(result.status, 'unavailable'); assert.ok(result.error);
  }
});
