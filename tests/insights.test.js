import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {analyzeInsights} from '../src/insights.js';
import {analyzeFarm} from '../src/calculator.js';
import {defaults, emptyPortfolio, units, weight, GENESIS, YEAR, DAY} from '../src/model.js';
import {emissionBetween} from '../src/engine.js';

function plot(id, tier = 0, level = 1) {
  return {token_id: id, rarity_tier: tier, level, is_active: true,
    effective_weight_bps: weight(tier, level), pending_crop_wei: '0', modifiers: []};
}
function fixture() {
  const p = emptyPortfolio();
  p.wallets[0].plots = [plot(1)];
  return {p, s: {...defaults(), start: '2026-10-19T00:00:00Z', externalWeight: '0'}};
}
function close(actual, expected, tolerance = 100n) {
  assert.ok(actual - expected < tolerance && expected - actual < tolerance, `${actual} != ${expected}`);
}

test('balance goals keep liquid, pending and future earnings separate in each wallet', () => {
  const {p, s} = fixture();
  p.wallets[0].crop_balance_wei = units('1000').toString();
  p.wallets[0].plots[0].pending_crop_wei = units('1000').toString();
  p.wallets.push({...p.wallets[0], id: 'rich', crop_balance_wei: units('1000000').toString(), plots: [plot(2, 3)]});
  const result = analyzeInsights(p, s, {goalCrop: '5000', goalDays: 30});
  const [first, rich] = result.goals;
  assert.equal(first.current_total_crop_wei, units('2000'));
  assert.equal(first.shortfall_crop_wei, units('3000'));
  assert.equal(first.liquid_shortfall_crop_wei, units('4000'));
  assert.equal(first.ready_in_days, 11);
  assert.equal(first.ready_at_utc, '2026-10-30T00:00:00.000Z');
  assert.equal(first.claim_required, true);
  assert.equal(first.funding_status, 'accrue_then_claim');
  assert.equal(first.ending_total_crop_wei, first.current_total_crop_wei + first.earned_crop_wei);
  assert.equal(rich.ready_in_days, 0);
  assert.equal(rich.funding_status, 'ready');
  assert.equal(rich.claim_required, false);
});

test('a pending-funded goal requires a claim; a liquid-funded goal does not', () => {
  const {p, s} = fixture();
  p.wallets[0].plots[0].pending_crop_wei = units('5000').toString();
  let goal = analyzeInsights(p, s).goals[0];
  assert.equal(goal.ready_in_days, 0);
  assert.equal(goal.funding_status, 'claim_first');
  assert.equal(goal.claim_required, true);
  p.wallets[0].crop_balance_wei = units('5000').toString();
  goal = analyzeInsights(p, s).goals[0];
  assert.equal(goal.current_total_crop_wei, units('10000'));
  assert.equal(goal.funding_status, 'ready');
  assert.equal(goal.claim_required, false);
  assert.equal(analyzeInsights(p, s, {goalCrop: '0'}).goals[0].ready_in_days, 0);
});

test('an unaffordable goal is bounded by its chosen window without borrowing another wallet', () => {
  const {p, s} = fixture();
  p.wallets[0].plots[0].is_active = false;
  p.wallets[0].plots[0].effective_weight_bps = 0;
  p.wallets[0].plots[0].pending_crop_wei = units('100').toString();
  p.wallets.push({...p.wallets[0], id: 'growing', plots: [plot(2, 3, 5)]});
  const goal = analyzeInsights(p, s, {goalCrop: '101'}).goals[0];
  assert.equal(goal.ready_in_days, null);
  assert.equal(goal.ready_at_utc, null);
  assert.equal(goal.funding_status, 'beyond_horizon');
  assert.equal(goal.claim_required, false);
  assert.equal(goal.ending_total_crop_wei, units('100'));
  const {p: active} = fixture();
  assert.equal(analyzeInsights(active, s, {goalCrop: '5000', goalDays: 7}).goals[0].ready_in_days, null);
  assert.equal(analyzeInsights(active, s, {goalCrop: '5000', goalDays: 30}).goals[0].ready_in_days, 18);
});

test('goal dates wait through pre-Genesis days and never forecast earnings after year four', () => {
  const {p, s} = fixture();
  s.start = new Date((GENESIS - 2 * DAY) * 1000).toISOString();
  let result = analyzeInsights(p, s, {goalCrop: '100', days: 3});
  assert.equal(result.goals[0].ready_in_days, 3);
  assert.equal(result.goals[0].ready_at_utc, '2026-09-22T00:00:00.000Z');
  assert.equal(result.plots[0].daily_crop_wei, 0n);
  assert.ok(result.plots[0].average_daily_crop_wei > 0n);
  s.start = new Date((GENESIS + 4 * YEAR) * 1000).toISOString();
  s.carryCrop = '999999999';
  result = analyzeInsights(p, s, {goalCrop: '1'});
  assert.equal(result.goals[0].ready_in_days, null);
  assert.equal(result.baseline_earned_crop_wei, 0n);
  assert.ok(result.weather.every(row => row.earned_crop_wei === 0n));
});

test('weather alternatives consume finite Granary once and preserve nominal schedule ceilings', () => {
  const {p, s} = fixture();
  s.granaryCrop = '100';
  const result = analyzeInsights(p, s, {days: 30});
  const weather = Object.fromEntries(result.weather.map(row => [row.name, row]));
  assert.equal(weather.Sunny.earned_crop_wei - weather.Fair.earned_crop_wei, units('100'));
  assert.equal(weather.Rain.earned_crop_wei - weather.Fair.earned_crop_wei, units('100'));
  assert.equal(weather.Rain.ending_granary_crop_wei, 0n);
  assert.equal(weather.Fair.difference_crop_wei, 0n);
  assert.ok(weather.Locusts.ending_granary_crop_wei > units('100'));
  assert.ok(weather.Drought.earned_crop_wei < weather.Fair.earned_crop_wei);
  assert.equal(result.weather.length, 5);
  assert.equal(result.weather.filter(row => row.selected).length, 1);
});

test('whole-term weather cases replace weekly paths, retain events, and do not mutate inputs', () => {
  const {p, s} = fixture();
  s.start = '2026-09-21T00:00:00Z';
  s.weatherPath = [{day: 0, multiplier_bps: 5000}, {day: 3, multiplier_bps: 15000}];
  s.weatherEvents = [{type: 'moon', start: s.start}];
  s.externalWeightPath = [{day: 3, weight_bps: 100000000}];
  const before = structuredClone({p, s});
  const result = analyzeInsights(p, s, {days: 7});
  assert.ok(result.weather.every(row => !row.selected));
  const fair = result.weather.find(row => row.name === 'Fair');
  const comparison = analyzeFarm(p, {...s, weatherBps: 10000, weatherPath: []}, {days: 7});
  assert.equal(fair.earned_crop_wei, comparison.horizons.find(row => row.days === 7).earned_crop_wei);
  assert.equal(fair.ending_granary_crop_wei, comparison.ending_granary_crop_wei);
  assert.deepEqual({p, s}, before);
});

test('plot shares preserve heterogeneous weights, dormant pending and rounding conservation', () => {
  const {p, s} = fixture();
  p.wallets[0].plots.push(plot(2, 3, 3), {...plot(3), is_active: false, effective_weight_bps: 0, pending_crop_wei: units('120').toString()});
  s.externalWeight = '7777.125';
  s.carryCrop = '3000';
  const result = analyzeInsights(p, s, {days: 90});
  const [common, golden, dormant] = result.plots;
  close(golden.earned_crop_wei, common.earned_crop_wei * 3n, 300n);
  assert.equal(dormant.earned_crop_wei, 0n);
  assert.equal(dormant.pending_crop_wei, units('120'));
  assert.equal(common.average_daily_crop_wei, common.earned_crop_wei / 90n);
  const plotSum = result.plots.reduce((total, row) => total + row.earned_crop_wei, 0n);
  assert.equal(plotSum + result.plot_rounding_remainder_crop_wei, result.baseline_earned_crop_wei);
  assert.ok(result.plot_rounding_remainder_crop_wei >= 0n);
  assert.ok(result.plot_rounding_remainder_crop_wei < 3n * 90n);
  const publicResult = analyzeFarm(p, s, {days: 90});
  assert.equal(result.baseline_earned_crop_wei, publicResult.horizons.find(row => row.days === 90).earned_crop_wei);
});

test('high competition applies schedule plus carry once across all plot shares', () => {
  const {p, s} = fixture();
  p.wallets[0].plots.push(plot(2, 3));
  s.externalWeight = '10000';
  s.carryCrop = '1234';
  s.granaryCrop = '0';
  const result = analyzeInsights(p, s, {days: 1});
  const start = Date.parse(s.start) / 1000;
  const released = emissionBetween(start, start + DAY) + units('1234');
  assert.equal(result.baseline_earned_crop_wei, released * 30000n / 100030000n);
  assert.equal(result.ending_carry_crop_wei, 0n);
  assert.equal(result.plots[0].earned_crop_wei, released * 10000n / 100030000n);
  assert.equal(result.plots[1].earned_crop_wei, released * 20000n / 100030000n);
});

test('intraday First Soil boundaries reach both weather and plot calculations', () => {
  const {p, s} = fixture();
  s.start = '2026-09-27T12:00:00Z';
  const result = analyzeInsights(p, s, {days: 1});
  close(result.plots[0].earned_crop_wei, units('500'));
  close(result.weather.find(row => row.name === 'Rain').earned_crop_wei, units('750'));
});

test('unknown data, conflicts and stale reserve observations remain unavailable', () => {
  const {p, s} = fixture();
  const cases = [
    [{...p, read_errors: ['Inventory read failed']}, s, /Incomplete wallet read/],
    [{...p, rule_conflicts: ['Unsynchronized weight']}, s, /Unsynchronized/],
    [{...p, wallets: [{...p.wallets[0], crop_balance_wei: null}]}, s, /balance is unknown/],
    [{...p, wallets: [{...p.wallets[0], plots: [{...plot(1), pending_crop_wei: null}]}]}, s, /pending CROP/],
    [{...p, wallets: [{...p.wallets[0], plots: [{...plot(1), modifiers: ['fertilizer']}]}]}, s, /modifiers/],
    [p, {...s, rewardStateBasis: 'observed', rewardObservedAt: '2026-10-18T00:00:00Z'}, /read timestamp/],
    [p, {...s, granaryCrop: ''}, /granaryCrop/],
  ];
  for (const [portfolio, scenario, message] of cases) {
    const result = analyzeInsights(portfolio, scenario);
    assert.equal(result.status, 'unavailable');
    assert.match(result.errors.join(' '), message);
    assert.deepEqual(result.plots, []);
    assert.deepEqual(result.weather, []);
    assert.deepEqual(result.goals, []);
  }
});

test('invalid targets, bounds and malformed records return errors without partial estimates', () => {
  const {p, s} = fixture();
  for (const options of [{goalCrop: ''}, {goalCrop: '-1'}, {goalCrop: '1e6'}, {goalCrop: '0.1234567890123456789'}, {days: 0}, {days: 366}, {goalDays: 1.5}, {goalDays: 366}]) {
    assert.equal(analyzeInsights(p, s, options).status, 'unavailable');
  }
  for (const wallets of [null, {}, [null], [{...p.wallets[0], plots: {}}]]) {
    assert.equal(analyzeInsights({...p, wallets}, s).status, 'unavailable');
  }
  assert.equal(analyzeInsights(null, null).status, 'unavailable');
});

test('100 heterogeneous plots across 20 wallets complete without replaying rewards per plot', t => {
  const {p, s} = fixture();
  p.wallets = Array.from({length: 20}, (_, wallet) => ({...p.wallets[0], id: `wallet-${wallet}`,
    plots: Array.from({length: 5}, (_, index) => plot(wallet * 5 + index + 1, (wallet + index) % 4, index + 1))}));
  const start = performance.now();
  const result = analyzeInsights(p, s, {days: 365});
  const elapsed = performance.now() - start;
  assert.equal(result.status, 'ok');
  assert.equal(result.plots.length, 100);
  assert.equal(result.goals.length, 20);
  assert.equal(result.weather.length, 5);
  assert.ok(elapsed < 5000, `100-plot analysis exceeded 5 seconds: ${elapsed} ms`);
  t.diagnostic(`100 plots, 20 wallets, 365 days, five weather cases: ${elapsed.toFixed(1)} ms`);
});
