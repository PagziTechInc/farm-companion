import test from 'node:test';
import assert from 'node:assert/strict';
import { demoPortfolio, defaults, emptyPortfolio, units, weight, UNIT, rules } from '../src/model.js';
import { timeline, rewardState, rewardProjection, simulate } from '../src/engine.js';
import { strategyInsights, guidedNextAction } from '../src/guidance.js';

const NOW = Date.parse('2026-09-22T12:00:00Z');
function fixture() {
  const { portfolio, scenario } = demoPortfolio();
  portfolio.is_demo = false;
  portfolio.observed_at_utc = new Date(NOW).toISOString();
  portfolio.block_number = 100;
  portfolio.read_errors = [];
  portfolio.wallets.forEach((wallet, index) => {
    wallet.address = `0x${String(index + 1).padStart(40, '0')}`;
    wallet.crop_balance_wei = units('100000').toString();
  });
  scenario.start = new Date(NOW).toISOString();
  return { portfolio, scenario };
}
function activate(portfolio) {
  for (const wallet of portfolio.wallets) for (const plot of wallet.plots) {
    plot.is_active = true;
    plot.effective_weight_bps = weight(plot.rarity_tier, plot.level);
  }
}

test('incomplete pre-mint holdings remain unavailable and never invent rarity or investments', () => {
  const result = strategyInsights(emptyPortfolio(), defaults(), { now: NOW });
  assert.equal(result.status, 'unavailable');
  assert.match(result.required_inputs.join(' '), /Add at least one plot/);
  assert.deepEqual(result.upgrades, []);
  assert.equal(result.rare_first, null);
  assert.equal(result.next_action.type, null);
});

test('equal-level Golden Acre upgrade has strongest marginal return and does not mutate input', () => {
  const { portfolio, scenario } = fixture();
  const before = structuredClone({ portfolio, scenario });
  const result = strategyInsights(portfolio, scenario, { now: NOW });
  assert.equal(result.status, 'ok');
  assert.equal(result.upgrades.length, 88);
  assert.equal(result.rare_first.candidate.rarity_tier, 3);
  assert.equal(result.rare_first.matches_best_efficiency, true);
  assert.equal(result.upgrades[0].requires_planting, true);
  assert.deepEqual({ portfolio, scenario }, before);
});

test('cheaper common next step outranks a high-level Golden Acre: rarity alone is insufficient', () => {
  const { portfolio, scenario } = fixture();
  for (const wallet of portfolio.wallets) for (const plot of wallet.plots) if (plot.rarity_tier) plot.level = plot.rarity_tier === 3 ? 4 : 5;
  activate(portfolio);
  const result = strategyInsights(portfolio, scenario, { now: NOW });
  assert.equal(result.rare_first.candidate.rarity_tier, 3);
  assert.equal(result.rare_first.best_next_step.rarity_tier, 0);
  assert.equal(result.rare_first.matches_best_efficiency, false);
  assert.equal(result.rare_first.candidate.crop_cost_wei, units('50000'));
  assert.equal(result.rare_first.best_next_step.crop_cost_wei, units('5000'));
});

test('sole farmers can gain nominal yield by upgrading below the schedule ceiling', () => {
  const { portfolio, scenario } = fixture();
  activate(portfolio); scenario.externalWeight = '0';
  const result = strategyInsights(portfolio, scenario, { now: NOW });
  assert.ok(result.upgrades.every(candidate => candidate.marginal_crop_wei > 0n));
  assert.ok(result.upgrades.some(candidate => candidate.net_crop_wei > 0n));
  assert.ok(result.upgrades.some(candidate => candidate.crop_break_even_day !== null));
});

test('marginal gains and horizon break-even match independently accumulated daily differences', () => {
  const { portfolio, scenario } = fixture();
  const result = strategyInsights(portfolio, scenario, { now: NOW, days: 90 });
  const best = result.rare_first.candidate, rows = timeline(scenario, 90);
  const base=rewardProjection(rows,result.all_planted_weight_bps,rewardState(scenario)), upgraded=rewardProjection(rows,result.all_planted_weight_bps+best.added_weight_bps,rewardState(scenario));
  let gain = 0n, breakEven = null;
  for (const row of rows) {
    gain += upgraded.daily[row.day].crop_wei-base.daily[row.day].crop_wei;
    if (breakEven == null && gain >= best.crop_cost_wei) breakEven = row.day + 1;
  }
  assert.equal(best.marginal_crop_wei, gain);
  assert.equal(best.crop_break_even_day, breakEven);
  assert.equal(best.net_crop_wei, gain - best.crop_cost_wei);
});

test('delayed planting opportunity cost follows dated competition and weather paths', () => {
  const { portfolio, scenario } = fixture();
  scenario.weatherPath = [{ day: 1, multiplier_bps: 5000 }];
  scenario.externalWeightPath = [{ day: 2, weight_bps: 100000000 }];
  const result = strategyInsights(portfolio, scenario, { now: NOW, days: 30 });
  const rows = timeline(scenario, 30);
  const expected = rewardProjection(rows,result.all_planted_weight_bps,rewardState(scenario)).daily.slice(0,3).reduce((n,r)=>n+r.crop_wei,0n);
  assert.equal(result.early_entry[1].foregone_crop_wei, expected);
  assert.ok(result.early_entry[0].foregone_crop_wei < expected);
  activate(portfolio);
  assert.ok(strategyInsights(portfolio, scenario, { now: NOW }).early_entry.every(row => row.foregone_crop_wei === 0n));
});

test('existing versus purchased CROP economics count capital and direct fees exactly once', () => {
  const { portfolio, scenario } = fixture();
  Object.assign(scenario, { buyPrice: '0.000002', sellPrice: '0.000001', feeMode: 'estimated', upgradeFee: '0.00001', buyFee: '0.00002' });
  const candidate = strategyInsights(portfolio, scenario, { now: NOW }).rare_first.candidate;
  assert.equal(candidate.net_eth_existing_crop_wei, candidate.net_crop_wei * units(scenario.sellPrice) / UNIT - units(scenario.upgradeFee));
  assert.equal(candidate.net_eth_purchased_crop_wei, candidate.marginal_crop_wei * units(scenario.sellPrice) / UNIT - candidate.crop_cost_wei * units(scenario.buyPrice) / UNIT - units(scenario.upgradeFee) - units(scenario.buyFee));
  assert.ok(candidate.net_eth_purchased_crop_wei < candidate.net_eth_existing_crop_wei);
  scenario.feeMode = 'unknown';
  const unknown = strategyInsights(portfolio, scenario, { now: NOW });
  assert.equal(unknown.rare_first.candidate.net_eth_existing_crop_wei, null);
  assert.ok(unknown.required_inputs.length);
});

test('guided next action uses actual engine action schema and requires liquid CROP', () => {
  const { portfolio, scenario } = fixture();
  const result = simulate(portfolio, scenario, { policy: 'baseline', days: 30 });
  const next = guidedNextAction(portfolio, scenario, result, { now: NOW });
  assert.equal(next.status, 'ready_for_review');
  assert.equal(next.type, 'plant');
  assert.equal(next.wallet_id, 'wallet_a');
  assert.equal(next.plot_id, 1);
  assert.equal(next.crop_cost_wei, units('2500'));
  assert.equal(next.requires_human_approval, true);
  portfolio.wallets[0].crop_balance_wei = '0';
  portfolio.wallets[0].plots[0].pending_crop_wei = units('10000').toString();
  const blocked = guidedNextAction(portfolio, scenario, result, { now: NOW });
  assert.equal(blocked.status, 'fund');
  assert.equal(blocked.type, null);
});

test('claim intent only contains owned plots with currently pending CROP', () => {
  const { portfolio, scenario } = fixture();
  portfolio.wallets[0].plots[1].pending_crop_wei = units('5').toString();
  portfolio.wallets[1].plots[0].pending_crop_wei = units('999').toString();
  const selected = { status: 'ok', actions: [{ day: 0, type: 'claim', wallet_id: 'wallet_a' }] };
  const next = guidedNextAction(portfolio, scenario, selected, { now: NOW });
  assert.equal(next.type, 'claim');
  assert.deepEqual(next.plot_ids, [2]);
  portfolio.wallets[0].plots[1].pending_crop_wei = '0';
  assert.equal(guidedNextAction(portfolio, scenario, selected, { now: NOW }).status, 'recalculate');
});

test('guided actions cannot replay historical scenarios, stale observations, or future accrual', () => {
  const { portfolio, scenario } = fixture();
  const selected = { status: 'ok', actions: [{ day: 1, type: 'plant', wallet_id: 'wallet_a', plot_id: 1 }] };
  assert.equal(guidedNextAction(portfolio, scenario, selected, { now: NOW }).status, 'wait');
  scenario.start = new Date(NOW - 60 * 60 * 1000).toISOString();
  assert.equal(guidedNextAction(portfolio, scenario, selected, { now: NOW }).status, 'recalculate');
  scenario.start = new Date(NOW).toISOString();
  portfolio.observed_at_utc = new Date(NOW - 16 * 60 * 1000).toISOString();
  assert.equal(guidedNextAction(portfolio, scenario, selected, { now: NOW }).status, 'refresh');
});

test('guided plan never skips purchases/transfers to trigger an unfunded investment', () => {
  const { portfolio, scenario } = fixture();
  const selected = { status: 'ok', actions: [
    { day: 0, type: 'buy', wallet_id: 'wallet_a', crop_wei: units('2500').toString() },
    { day: 0, type: 'plant', wallet_id: 'wallet_a', plot_id: 1 }
  ] };
  const next = guidedNextAction(portfolio, scenario, selected, { now: NOW });
  assert.equal(next.status, 'manual');
  assert.equal(next.type, null);
  assert.equal(next.planned_type, 'buy');
});

test('guided upgrades are one step at a time and completed actions are skipped from state', () => {
  const { portfolio, scenario } = fixture(); activate(portfolio);
  const selected = { status: 'ok', actions: [
    { day: 0, type: 'plant', wallet_id: 'wallet_a', plot_id: 1 },
    { day: 0, type: 'upgrade', wallet_id: 'wallet_a', plot_id: 1, to_level: 2 }
  ] };
  assert.equal(guidedNextAction(portfolio, scenario, selected, { now: NOW }).type, 'upgrade');
  selected.actions[1].to_level = 3;
  assert.equal(guidedNextAction(portfolio, scenario, selected, { now: NOW }).status, 'recalculate');
});

test('no pre-Genesis investment, demo execution, or outside-portfolio wallet intent', () => {
  const { portfolio, scenario } = fixture();
  assert.equal(guidedNextAction(portfolio, scenario, null, { now: rules.schedule.genesis_timestamp * 1000 - 1 }).status, 'wait');
  portfolio.is_demo = true;
  assert.equal(guidedNextAction(portfolio, scenario, null, { now: NOW }).status, 'simulation');
  portfolio.is_demo = false;
  const selected = { status: 'ok', actions: [{ day: 0, type: 'claim', wallet_id: 'stranger' }] };
  assert.equal(guidedNextAction(portfolio, scenario, selected, { now: NOW }).status, 'recalculate');
});
