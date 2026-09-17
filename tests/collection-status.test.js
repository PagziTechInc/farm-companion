import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCollectionStatus, readCollectionStatus, COLLECTION_STATUS_URL } from '../src/collection-status.js';
const status = { schema_version: 1, environment: 'production', target_count: 3333, collected_count: 0,
  phase: 'waiting_for_reveal', last_checked_at_utc: '2026-09-14T03:00:00Z' };
test('collection status is a bounded display record, never copied wallet data', async () => {
  const result = await readCollectionStatus(async (url, options) => {
    assert.equal(url, COLLECTION_STATUS_URL); assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
    return { ...status, wallets: ['untrusted'], script: 'untrusted', error: 'x'.repeat(1000) };
  });
  assert.equal(result.phase, 'waiting_for_reveal'); assert.equal(result.error.length, 400);
  assert.equal(result.wallets, undefined); assert.ok(Object.isFrozen(result));
});
test('invalid counts, source and incomplete success cannot report a collected collection', () => {
  for (const change of [{collected_count:3334},{collected_count:-1},{phase:'complete'},
    {environment:'rehearsal'},{last_checked_at_utc:'bad'},{target_count:100}]) assert.throws(()=>validateCollectionStatus({...status,...change}));
  assert.equal(validateCollectionStatus({...status,collected_count:3333,phase:'complete'}).phase,'complete');
});

test('mint progress is separate from reveal and only accepts a verified bounded chain observation', () => {
  const chain={chain_id:4663,runtime_verified:true,manifest_verified:true,status:'sealed',block_number:63958680,
    observed_at_utc:'2026-09-15T21:05:17Z',total_supply:2290};
  const observed=validateCollectionStatus({...status,chain_observation:chain});
  assert.equal(observed.minted_count,2290);
  assert.equal(observed.phase,'waiting_for_reveal');assert.equal(observed.collected_count,0);
  assert.equal(validateCollectionStatus({...status,chain_observation:{...chain,total_supply:3333}}).phase,'waiting_for_reveal');
  for(const change of [{chain_id:1},{runtime_verified:false},{manifest_verified:false},{status:'unavailable'},
    {block_number:null},{observed_at_utc:'bad'},{total_supply:3334},{total_supply:-1},{total_supply:'2290'}]) {
    assert.equal(validateCollectionStatus({...status,chain_observation:{...chain,...change}}).minted_count,null);
  }
  assert.equal(validateCollectionStatus(status).minted_count,null);
});
