import test from 'node:test';
import assert from 'node:assert/strict';
import { demoPortfolio, defaults, emptyPortfolio, weight, units } from '../src/model.js';
import { simulate } from '../src/engine.js';
import { guidedNextAction } from '../src/guidance.js';
import { buildGuidedPlan, planDefaults, validatePlanSettings, validateExecutionLog } from '../src/planner.js';

const NOW = Date.parse('2026-09-22T12:00:00Z');
function fixture() {
  const { portfolio, scenario } = demoPortfolio();
  portfolio.is_demo = false;
  portfolio.observed_at_utc = new Date(NOW).toISOString();
  portfolio.block_number = 123;
  portfolio.read_errors = [];
  portfolio.wallets.forEach((wallet, index) => {
    wallet.address = `0x${String(index + 1).padStart(40, '0')}`;
    for (const plot of wallet.plots) {
      plot.is_active = true;
      plot.effective_weight_bps = weight(plot.rarity_tier, plot.level);
    }
  });
  scenario.externalWeight = '1000000000';
  return { portfolio, scenario, settings: { ...planDefaults(), enabled: true, days: 30 } };
}

test('guided planner preserves empty premint holdings and produces no transaction intent', () => {
  const portfolio = emptyPortfolio(), original = structuredClone(portfolio);
  const result = buildGuidedPlan(portfolio, defaults(), planDefaults(), NOW);
  assert.equal(result.status, 'unavailable');
  assert.match(result.errors.join(' '), /Add at least one plot/);
  assert.equal(result.insights.next_action.type, null);
  assert.deepEqual(result.stress, []);
  assert.equal(result.selected, undefined);
  assert.deepEqual(portfolio, original);
});

test('CROP planning remains available without valuation but ETH planning gives a useful missing-price reason', () => {
  const { portfolio, scenario, settings } = fixture();
  scenario.buyPrice = ''; scenario.sellPrice = '';
  const crop = buildGuidedPlan(portfolio, scenario, settings, NOW);
  assert.equal(crop.status, 'ok');
  assert.equal(crop.selected.operating_eth_wei, null);
  const eth = buildGuidedPlan(portfolio, scenario, { ...settings, objective: 'eth' }, NOW);
  assert.equal(eth.status, 'unavailable');
  assert.match(eth.errors.join(' '), /price|valuation/i);
  assert.equal(eth.insights.next_action.type, null);
});

test('plan rebases a historical scenario to current time without mutating forecasts or holdings', () => {
  const { portfolio, scenario, settings } = fixture();
  const before = structuredClone({ portfolio, scenario, settings });
  const result = buildGuidedPlan(portfolio, scenario, settings, NOW);
  assert.equal(result.generated_at, new Date(NOW).toISOString());
  assert.equal(result.scenario.start, result.generated_at);
  assert.equal(result.block_number, 123);
  assert.equal(result.insights.next_action.status, 'hold');
  assert.equal(result.selected.actions.length,0);
  assert.deepEqual({ portfolio, scenario, settings }, before);
  const later = buildGuidedPlan(portfolio, scenario, settings, NOW + 60000);
  assert.equal(Date.parse(later.generated_at) - Date.parse(result.generated_at), 60000);
});

test('future harvests cannot become a present approval action and stale inputs request refresh', () => {
  const { portfolio, scenario, settings } = fixture();
  const result = buildGuidedPlan(portfolio, scenario, settings, NOW);
  assert.equal(result.selected.policy, 'hold');
  const baseline=simulate(portfolio,result.scenario,{days:settings.days,policy:'baseline'});
  const next=guidedNextAction(portfolio,result.scenario,baseline,{now:NOW});
  assert.equal(next.status,'wait');assert.equal(next.planned_type,'claim');assert.equal(next.type,null);
  assert.ok(Date.parse(next.due_at_utc)>NOW);
  portfolio.observed_at_utc = new Date(NOW - 16 * 60000).toISOString();
  assert.equal(buildGuidedPlan(portfolio, scenario, settings, NOW).insights.next_action.status, 'refresh');
});

test('stress cases rerun the selected policy with an empty Granary, weather and exit-price changes', () => {
  const { portfolio, scenario, settings } = fixture();
  const result = buildGuidedPlan(portfolio, scenario, settings, NOW);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.stress.map(row => row.label), ['Granary starts empty', 'Locusts throughout', 'Exit CROP price halves']);
  assert.match(result.notes.join(' '), /rerun the selected policy/);
  assert.match(result.notes.join(' '), /not.*frozen transaction sequence/);
  assert.equal(result.stress[0].status, 'ok');
  const dry=simulate(portfolio,{...result.scenario,granaryCrop:'0',rewardStateBasis:'assumption'},
    {days:settings.days,funding:settings.funding,policy:result.selected.policy,objective:result.selected.objective,budgetFraction:result.selected.budget_fraction});
  assert.equal(result.stress[0].net_crop_wei,dry.net_crop_wei);
  assert.ok(result.stress[0].net_crop_wei < result.selected.net_crop_wei);
  assert.equal(result.stress[1].status, 'ok');
  assert.ok(result.stress[1].net_crop_wei < result.selected.net_crop_wei);
  assert.equal(result.stress[2].net_crop_wei, result.selected.net_crop_wei);
  assert.ok(result.stress[2].operating_eth_wei < result.selected.operating_eth_wei);
  assert.deepEqual(result.settings, settings);
});

test('extra-investment plan cannot infer a cap from the two wallet balances', () => {
  const { portfolio, scenario, settings } = fixture();
  scenario.extraBudget = '';
  portfolio.wallets.forEach(wallet => { wallet.eth_balance_wei = units('100').toString(); });
  const result = buildGuidedPlan(portfolio, scenario, { ...settings, funding: 'extra' }, NOW);
  assert.equal(result.status, 'unavailable');
  assert.match(result.errors.join(' '), /cap|budget/i);
  assert.equal(result.insights.next_action.type, null);
});

test('settings and imported execution journals reject malformed records', () => {
  assert.throws(() => validatePlanSettings({ ...planDefaults(), days: 366 }), /settings/);
  assert.throws(() => validatePlanSettings({ ...planDefaults(), objective: 'guaranteed_profit' }), /settings/);
  assert.throws(() => validateExecutionLog([{ status: 'confirmed', at: 'yesterday', type: 'upgrade', wallet_id: 'wallet_a' }]), /entry/);
  assert.throws(() => validateExecutionLog([{ status: 'confirmed', at: new Date(NOW).toISOString(), type: 'upgrade', wallet_id: 'wallet_a', hash: '0x1' }]), /hash/);
  const log = [{ status: 'rejected', at: new Date(NOW).toISOString(), type: 'upgrade', wallet_id: 'wallet_a' }];
  assert.equal(validateExecutionLog(log), log);
});
