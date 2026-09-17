import test from 'node:test';
import assert from 'node:assert/strict';
import rules from '../knowledge/rules.json' with { type: 'json' };
import { sampleRarityTiers } from '../src/model-farm.js';

const rarities = rules.plots.rarities;
const total = rarities.reduce((sum, rarity) => sum + rarity.count, 0);
const tierCounts = new Map(rarities.map(({ tier, count }) => [tier, count]));

test('deterministic draw thresholds follow the published rarity counts and tier IDs', () => {
  let cumulative = 0;
  for (const rarity of rarities) {
    const midpoint = (cumulative + rarity.count / 2) / total;
    assert.deepEqual(sampleRarityTiers(1, () => midpoint), [rarity.tier]);
    cumulative += rarity.count;
  }

  assert.deepEqual(sampleRarityTiers(1, () => 0), [rarities[0].tier]);
  assert.deepEqual(sampleRarityTiers(1, () => 1 - Number.EPSILON), [rarities.at(-1).tier]);
});

test('every batch size from 1 through 100 returns valid tier IDs and draws once per plot', () => {
  for (let count = 1; count <= 100; count += 1) {
    let calls = 0;
    const sample = sampleRarityTiers(count, () => {
      calls += 1;
      return (calls * 0.6180339887498949) % 1;
    });

    assert.equal(sample.length, count);
    assert.equal(calls, count);
    assert.ok(sample.every(tier => tierCounts.has(tier)));

    const counts = new Map();
    for (const tier of sample) counts.set(tier, (counts.get(tier) ?? 0) + 1);
    for (const [tier, sampledCount] of counts) {
      assert.ok(sampledCount <= tierCounts.get(tier), `tier ${tier} exceeded its published count`);
    }
  }
});

test('the published Golden tier is exhausted before draws move to the preceding tier', () => {
  const count = 100;
  const sample = sampleRarityTiers(count, () => 1 - Number.EPSILON);
  const last = rarities.at(-1);
  const previous = rarities.at(-2);
  assert.equal(last.name, 'Golden Acre');
  const countByTier = new Map();
  for (const tier of sample) countByTier.set(tier, (countByTier.get(tier) ?? 0) + 1);

  assert.equal(countByTier.get(last.tier), Math.min(count, last.count));
  assert.equal(countByTier.get(previous.tier), Math.min(previous.count, Math.max(0, count - last.count)));
  assert.equal(sample.length, count);
  for (const tier of countByTier.keys()) assert.ok(tierCounts.has(tier));
});

test('the default RNG returns a valid published tier', () => {
  assert.ok(tierCounts.has(sampleRarityTiers(1)[0]));
});

test('invalid counts and RNGs are rejected without substituting random values', () => {
  for (const count of [0, -1, 101, 1.5, NaN, Infinity, '1', null, true]) {
    assert.throws(() => sampleRarityTiers(count), RangeError);
  }
  for (const random of [null, {}, 1]) {
    assert.throws(() => sampleRarityTiers(1, random), TypeError);
  }
  for (const value of [-Number.EPSILON, 1, NaN, Infinity, undefined, null, '0']) {
    assert.throws(() => sampleRarityTiers(1, () => value), RangeError);
  }

  let called = false;
  assert.throws(() => sampleRarityTiers(0, () => { called = true; return 0; }), RangeError);
  assert.equal(called, false);
});
