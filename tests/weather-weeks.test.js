import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, DAY, GENESIS, units, validateScenario } from '../src/model.js';
import { timeline, rewardProjection, rewardState, settleReward, emissionBetween } from '../src/engine.js';
import { validateWeatherWeeks } from '../src/weather.js';

const scenario = extra => ({ ...defaults(), start: new Date(GENESIS * 1000).toISOString(), externalWeight: '0',
  useKnownWeather: true, weatherWeeks: [{ epoch: 0, multiplier_bps: 12000 }], ...extra });
const close = (actual, expected) => assert.ok(actual >= expected - 100n && actual <= expected + 100n, `${actual} ≠ ${expected}`);

test('known Sunny is confined to launch week and First Soil is applied exactly once', () => {
  const s = scenario(), rows = timeline(s, 28);
  assert.deepEqual([...new Set(rows.slice(0, 7).flatMap(r => r.segments.map(s => s.multiplier_bps)))], [24000]);
  assert.deepEqual([...new Set(rows.slice(7).flatMap(r => r.segments.map(s => s.multiplier_bps)))], [15000]);
  close(rewardProjection(rows.slice(0, 7), 10000, rewardState(s)).earned, units('4800'));
  close(rewardProjection(rows, 10000, rewardState(s)).earned, units('13800'));
});

test('midday horizons split exactly at UTC weather and First Soil boundaries', () => {
  const rows = timeline(scenario({ start: '2026-09-27T12:00:00Z' }), 2);
  assert.deepEqual(rows[0].segments.map(s => [s.seconds, s.multiplier_bps]), [[DAY / 2, 24000], [DAY / 2, 15000]]);
  assert.deepEqual(rows[1].segments.map(s => [s.seconds, s.multiplier_bps]), [[DAY, 15000]]);
});

test('rebasing the start never shifts an absolute announced epoch', () => {
  const s = scenario({ start: '2026-09-28T00:00:00Z', weatherWeeks: [{ epoch: 0, multiplier_bps: 12000 }, { epoch: 2, multiplier_bps: 8000 }] });
  const rows = timeline(s, 15);
  assert.equal(rows[0].segments[0].multiplier_bps, 15000);
  assert.equal(rows[7].segments[0].multiplier_bps, 12000);
  assert.equal(rows[14].segments[0].multiplier_bps, 15000);
  assert.deepEqual(s.weatherWeeks.map(w => w.epoch), [0, 2]);
});

test('known weather cannot bypass the schedule ceiling or empty Granary', () => {
  const s = scenario({ granaryCrop: '0', carryCrop: '0' }), row = timeline(s, 1)[0];
  const total = settleReward(row, 100000000, rewardState(s));
  assert.equal(total.base, emissionBetween(GENESIS, GENESIS + DAY));
  assert.equal(total.amount, total.base);
  assert.equal(total.granary, 0n);
  const common = rewardProjection(timeline(s, 7), 10000, rewardState(s));
  close(common.earned, units('2000'));
});

test('disabling known weeks preserves an explicit whole-term weather experiment', () => {
  const s = scenario({ useKnownWeather: false, weatherBps: 5000 }), rows = timeline(s, 7);
  assert.ok(rows.every(row => row.segments.every(segment => segment.multiplier_bps === 10000)));
  close(rewardProjection(rows, 10000, rewardState(s)).earned, units('2000'));
});

test('announced weather requires unique supported epochs and ordinary weather factors', () => {
  for (const weeks of [[{ epoch: 0, multiplier_bps: 24000 }], [{ epoch: 209, multiplier_bps: 12000 }],
    [{ epoch: 0, multiplier_bps: 12000 }, { epoch: 0, multiplier_bps: 10000 }], [{ epoch: -1, multiplier_bps: 10000 }]]) {
    assert.throws(() => validateWeatherWeeks(weeks));
    assert.ok(validateScenario(scenario({ weatherWeeks: weeks })).length);
  }
  assert.deepEqual(validateScenario(scenario()), []);
});
