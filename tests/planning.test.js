import test from 'node:test';
import assert from 'node:assert/strict';
import { cyclicAllocation } from '../src/allocation.js';
import { eventWindows, eventMultiplier } from '../src/weather.js';
import { timeline, emissionBetween, simulate } from '../src/engine.js';
import { defaults, GENESIS, DAY, YEAR, demoPortfolio, validateScenario } from '../src/model.js';
import manifest from '../knowledge/snapshots/manifest-2026-09-07.json' with { type: 'json' };

test('cyclic allocation preserves correlations between token positions', () => {
  const adjacent = cyclicAllocation([1, 2], [0, 0, 3, 3]);
  const separated = cyclicAllocation([1, 3], [0, 0, 3, 3]);
  assert.equal(adjacent.probability_golden, 0.75); assert.equal(separated.probability_golden, 1);
  assert.deepEqual(adjacent.expected_counts, separated.expected_counts);
  assert.deepEqual(adjacent.golden_count_offsets, { 0: 1, 1: 2, 2: 1 });
  assert.throws(() => cyclicAllocation([1, 1], [0, 3]), /distinct/);
  assert.throws(() => cyclicAllocation([0], [0, 3]), /distinct/);
});
test('committed table exact offsets improve the contiguous 22-plot probability', () => {
  const a = cyclicAllocation(Array.from({length:22}, (_, i) => i + 1), manifest.map(r => r.tier));
  assert.equal(a.offset_count, 3333); assert.equal(a.golden_offsets, 626);
  assert.deepEqual(a.golden_count_offsets, { 0: 2707, 1: 526, 2: 100 });
  assert.equal(a.min_weight_bps, 222500); assert.equal(a.max_weight_bps, 265000);
});
test('deployed reveal excludes offset zero and gives offset one both corresponding hash residues', () => {
  const zeroOnly = [3, 0, 0, 0], oneOnly = [0, 3, 0, 0];
  assert.equal(cyclicAllocation([1], zeroOnly).probability_golden, 0.25);
  assert.equal(cyclicAllocation([1], zeroOnly, true).probability_golden, 0);
  const remapped = cyclicAllocation([1], oneOnly, true);
  assert.equal(remapped.probability_golden, 0.5);
  assert.equal(remapped.reachable_offsets, 3);
  assert.deepEqual(remapped.expected_counts, [0.5, 0, 0, 0.5]);
  assert.deepEqual(remapped.golden_count_offsets, {0:2, 1:2});
  assert.equal(cyclicAllocation([1], oneOnly).source_aware, false);
  assert.equal(cyclicAllocation([1], oneOnly).probability_golden, 0.25);
});
test('source-aware allocation accounts for the uniform 256-bit hash residue masses', () => {
  const space = 1n << 256n, base = space / 3n;
  // For 3 rows, residue zero has one extra hash; both zero and one map to row one.
  const mapped = cyclicAllocation([1], [0, 3, 0], true);
  assert.equal(mapped.probability_golden, Number(base * 2n + 1n) / Number(space));
  const all = cyclicAllocation([1, 2, 3], [0, 3, 0], true);
  assert.equal(all.probability_golden, 1);
  assert.deepEqual(all.expected_counts, [2, 0, 0, 1]);
});
test('Almanac single-event planning stacks and caps instead of overriding a harsh week', () => {
  assert.deepEqual([5000, 8000, 10000, 12000, 15000].map(eventMultiplier), [10000, 16000, 20000, 20000, 20000]);
});
test('event flow respects intraday starts, duration and the later return to ordinary weather', () => {
  const s = {...defaults(), externalWeight:'100', weatherBps:5000, weatherEvents:[{type:'flood', start:'2026-09-21T12:00:00Z'}]};
  const days = timeline(s, 3), half = emissionBetween(GENESIS, GENESIS + DAY / 2);
  assert.equal(days[0].flow, half + half * 2n);
  assert.equal(days[1].flow, half + half * 2n);
  assert.equal(days[2].flow, emissionBetween(GENESIS, GENESIS + DAY));
  const p = demoPortfolio();
  const r = simulate(p.portfolio, {...p.scenario, weatherEvents:s.weatherEvents}, {days:30, policy:'baseline'});
  assert.equal(r.status, 'ok');
});
test('event flow splits year boundaries and never earns before Genesis', () => {
  const iso = n => new Date(n * 1000).toISOString().replace('.000Z','Z');
  const s = {...defaults(), externalWeight:'100', start:iso(GENESIS - DAY), weatherBps:10000, weatherEvents:[{type:'moon', start:iso(GENESIS-DAY/2)}]};
  assert.equal(timeline(s, 2)[0].flow, 0n);
  s.start=iso(GENESIS+YEAR-DAY/2);s.weatherEvents=[{type:'flood',start:s.start}];
  assert.equal(timeline(s,1)[0].flow, emissionBetween(GENESIS+YEAR-DAY/2,GENESIS+YEAR+DAY/2)*2n);
});
test('same-kind overlaps, invalid dates and effective paths plus events are rejected', () => {
  assert.throws(() => eventWindows([{type:'moon',start:'2026-09-21T00:00:00Z'}, {type:'moon',start:'2026-09-22T00:00:00Z'}]), /Overlapping moon/);
  assert.throws(() => eventWindows([{type:'flood',start:'2026-09-21T00:00:00Z'}, {type:'flood',start:'2026-09-21T12:00:00Z'}]), /Overlapping flood/);
  assert.throws(() => eventWindows([{type:'moon',start:'2026-02-30T00:00:00Z'}]), /real UTC/);
  const s = {...defaults(), externalWeight:'100', weatherEvents:[{type:'flood',start:'2026-09-21T00:00:00Z'}],weatherPath:[{day:0,multiplier_bps:20000}]};
  assert.ok(validateScenario(s).some(e=>e.includes('avoid applying an event twice')));
  s.weatherPath=[null];assert.ok(validateScenario(s).some(e=>e.includes('invalid schedule')));
});
test('verified Flood plus Moon overlap doubles each effect, caps, and settles their exact edges', () => {
  const s = {...defaults(), externalWeight:'100', weatherBps:5000, weatherEvents:[
    {type:'moon',start:'2026-09-21T00:00:00Z'},
    {type:'flood',start:'2026-09-21T12:00:00Z'},
  ]};
  assert.equal(eventWindows(s.weatherEvents).length, 2);
  assert.deepEqual(validateScenario(s), []);
  const days = timeline(s, 3), half = emissionBetween(GENESIS, GENESIS + DAY / 2);
  assert.equal(days[0].flow, half * 2n + half * 4n);
  assert.equal(days[1].flow, half * 4n + half * 2n);
  assert.equal(days[2].flow, emissionBetween(GENESIS, GENESIS + DAY));
  s.weatherBps=15000;
  assert.equal(timeline(s, 1)[0].flow, half * 8n);
});
