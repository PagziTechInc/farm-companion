import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, emptyPortfolio, units, weight, validateScenario } from '../src/model.js';
import {
  activePlanDefaults, activePlanFingerprint, activePlanInput, actionIdentity,
  livePlanAction, planPortfolio, validateActivePlanSettings
} from '../src/active-plan.js';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const ADDRESS = `0x${'1'.padStart(40, '0')}`;

function makePlot(token_id, tier = 0, level = 1) {
  return {
    token_id, owner_address: ADDRESS, rarity_tier: tier, level, is_active: true,
    effective_weight_bps: weight(tier, level), pending_crop_wei: '0', modifiers: null
  };
}

function makeWorkspace({ mixed = false } = {}) {
  const portfolio = emptyPortfolio();
  const watched = portfolio.wallets[0];
  Object.assign(watched, {
    id: 'wallet_a', label: 'Wallet A', address: ADDRESS, expected_plot_count: 1,
    crop_balance_wei: units('100000').toString(), eth_balance_wei: units('1').toString(),
    plots: [makePlot(1)]
  });
  if (mixed) {
    portfolio.wallets.push({
      id: 'model_b', label: 'Model B', address: null, expected_plot_count: 2,
      crop_balance_wei: units('100000').toString(), eth_balance_wei: units('1').toString(),
      plots: [makePlot(2, 2), makePlot(3, 3)]
    });
  }
  portfolio.is_demo = false;
  portfolio.is_template = false;
  portfolio.expected_total_plots = mixed ? 3 : 1;
  portfolio.observed_at_utc = new Date(NOW).toISOString();
  portfolio.reward_observed_at_utc = new Date(NOW).toISOString();
  portfolio.block_number = 12345;
  portfolio.chain_id = 4663;
  portfolio.read_errors = [];
  portfolio.carry_crop_wei = units('12').toString();
  portfolio.granary_crop_wei = units('34').toString();
  portfolio.total_planted_farm_weight_bps = weight(0, 1);

  return {
    portfolio,
    scenario: {
      ...defaults(), start: '2026-09-21T00:00:00Z', externalWeight: '4000',
      annualGrowthPct: '0', downtimeHours: '0', weatherBps: 10000,
      weatherEvents: [], weatherPath: [], externalWeightPath: []
    },
    activePlan: { ...activePlanDefaults(), enabled: true, feeMode: 'zero', days: 30 }
  };
}

function makeReadyPlan(workspace, now = NOW) {
  const input = activePlanInput(workspace, now);
  assert.deepEqual(input.errors, []);
  return {
    ...input,
    status: 'ok',
    inputFingerprint: input.fingerprint,
    generated_at: new Date(now).toISOString(),
    selected: {
      status: 'ok', policy: 'efficiency', actions: [
        { day: 0, type: 'upgrade', wallet_id: 'wallet_a', plot_id: 1, to_level: 2 }
      ]
    }
  };
}

test('mixed model plots are excluded while the watched portfolio remains usable', () => {
  const workspace = makeWorkspace({ mixed: true });
  const before = structuredClone(workspace.portfolio);
  const selected = planPortfolio(workspace.portfolio);
  const input = activePlanInput(workspace, NOW);

  assert.equal(selected.scope, 'watched');
  assert.equal(selected.portfolio.wallets.length, 1);
  assert.equal(selected.portfolio.wallets[0].id, 'wallet_a');
  assert.equal(selected.portfolio.expected_total_plots, 1);
  assert.equal(selected.excludedModelPlots, 2);
  assert.equal(input.scope, 'watched');
  assert.deepEqual(input.errors, []);
  assert.deepEqual(workspace.portfolio, before);
});

test('active input rebases to fresh reserve observations without mutating the saved scenario', () => {
  const workspace = makeWorkspace();
  const before = structuredClone(workspace.scenario);
  const input = activePlanInput(workspace, NOW);

  assert.equal(input.scenario.start, new Date(NOW).toISOString());
  assert.equal(input.scenario.rewardStateBasis, 'observed');
  assert.equal(input.scenario.rewardObservedAt, workspace.portfolio.reward_observed_at_utc);
  assert.equal(units(input.scenario.carryCrop), BigInt(workspace.portfolio.carry_crop_wei));
  assert.equal(units(input.scenario.granaryCrop), BigInt(workspace.portfolio.granary_crop_wei));
  assert.deepEqual(validateScenario(input.scenario), []);
  assert.deepEqual(workspace.scenario, before);
});

test('watched freshness has a two-minute boundary and partial, missing-block, and wrong-chain reads are surfaced', () => {
  const workspace = makeWorkspace();
  workspace.portfolio.observed_at_utc = new Date(NOW - 120_000).toISOString();
  assert.equal(activePlanInput(workspace, NOW).errors.some(error => /Refresh watched wallets/.test(error)), false);

  workspace.portfolio.observed_at_utc = new Date(NOW - 120_001).toISOString();
  assert.equal(activePlanInput(workspace, NOW).errors.some(error => /Refresh watched wallets/.test(error)), true);

  workspace.portfolio.observed_at_utc = new Date(NOW).toISOString();
  workspace.portfolio.read_errors = ['Wallet A balance RPC failed.'];
  assert.ok(activePlanInput(workspace, NOW).errors.includes('Wallet A balance RPC failed.'));

  workspace.portfolio.read_errors = [];
  workspace.portfolio.block_number = null;
  assert.ok(activePlanInput(workspace, NOW).errors.some(error => /Refresh watched wallets/.test(error)));

  workspace.portfolio.block_number = 12345;
  workspace.portfolio.chain_id = 1;
  assert.ok(activePlanInput(workspace, NOW).errors.some(error => /Robinhood Chain/.test(error)));
});

test('a model-only active plan cannot become a live wallet intent', () => {
  const workspace = makeWorkspace();
  workspace.portfolio.wallets[0].address = null;
  const input = activePlanInput(workspace, NOW);
  const plan = {
    ...input, status: 'ok', inputFingerprint: input.fingerprint,
    generated_at: new Date(NOW).toISOString(),
    selected: { status: 'ok', actions: [{ day: 0, type: 'upgrade', wallet_id: 'wallet_a', plot_id: 1, to_level: 2 }] }
  };

  const next = livePlanAction(plan, workspace, { now: NOW });
  assert.equal(input.scope, 'model');
  assert.equal(next.status, 'simulation');
  assert.equal(next.type, null);
});

test('live action requires the same fingerprint, recent plan, and an unlocked approval journal', () => {
  const workspace = makeWorkspace();
  const plan = makeReadyPlan(workspace);
  assert.equal(livePlanAction(plan, workspace, { now: NOW }).status, 'ready_for_review');

  const changed = structuredClone(workspace);
  changed.activePlan.days += 1;
  assert.equal(livePlanAction(plan, changed, { now: NOW }).status, 'recalculate');
  assert.equal(livePlanAction(plan, workspace, { now: NOW, locked: true }).status, 'blocked');

  const atBoundary = { ...plan, generated_at: new Date(NOW - 120_000).toISOString() };
  assert.equal(livePlanAction(atBoundary, workspace, { now: NOW }).status, 'ready_for_review');
  const stale = { ...plan, generated_at: new Date(NOW - 120_001).toISOString() };
  assert.equal(livePlanAction(stale, workspace, { now: NOW }).status, 'refresh');

  const changedFarm = structuredClone(workspace);
  changedFarm.portfolio.wallets[0].crop_balance_wei = units('200000').toString();
  assert.equal(livePlanAction(plan, changedFarm, { now: NOW }).status, 'recalculate');
});

test('extra-investment spending remains in the saved lifetime cap across plan rebuilds', () => {
  const workspace = makeWorkspace();
  workspace.activePlan = {
    ...workspace.activePlan, funding: 'extra', buyPrice: '0.000001',
    extraBudget: '10', extraSpent: '3'
  };
  const before = structuredClone(workspace.activePlan);
  const first = activePlanInput(workspace, NOW);
  const second = activePlanInput(workspace, NOW + 30_000);

  assert.equal(units(first.scenario.extraBudget), units('7'));
  assert.equal(units(second.scenario.extraBudget), units('7'));
  assert.equal(workspace.activePlan.extraSpent, '3');
  assert.deepEqual(workspace.activePlan, before);

  const spentMore = structuredClone(workspace);
  spentMore.activePlan.extraSpent = '4';
  assert.equal(units(activePlanInput(spentMore, NOW).scenario.extraBudget), units('6'));
  assert.notEqual(activePlanFingerprint(spentMore), activePlanFingerprint(workspace));
});

test('action identity ignores forecast details but changes for a different wallet target or step', () => {
  const action = { type: 'upgrade', wallet_id: 'wallet_a', plot_id: 1, to_level: 2, day: 0, fee: '0.01' };
  assert.equal(actionIdentity(action), actionIdentity({ ...action, day: 7, fee: '9' }));
  assert.notEqual(actionIdentity(action), actionIdentity({ ...action, wallet_id: 'wallet_b' }));
  assert.notEqual(actionIdentity(action), actionIdentity({ ...action, to_level: 3 }));
  assert.equal(actionIdentity(null), '');
});

test('active settings reject out-of-range horizons, cadence, refresh intervals, and caps', () => {
  assert.equal(validateActivePlanSettings(null).enabled, false);
  for (const invalid of [
    { days: 0 }, { days: 366 }, { refreshSeconds: 29 }, { refreshSeconds: 901 },
    { claimEveryDays: 0 }, { claimEveryDays: 366 }, { objective: 'guaranteed' },
    { feeMode: 'unknown-but-free' }, { enabled: 1 },
    { extraBudget: '10', extraSpent: '11' },
    { sellPrice: (2n ** 256n).toString() }
  ]) {
    assert.throws(() => validateActivePlanSettings(invalid));
  }
});


test('advisory claim clocks are validated and participate in plan invalidation',async()=>{
  const {validateActivePlanClock,activePlanFingerprint}=await import('../src/active-plan.js');
  assert.deepEqual(validateActivePlanClock(),{});
  assert.throws(()=>validateActivePlanClock([]),/clock/);
  assert.throws(()=>validateActivePlanClock({wallet_a:'invalid'}),/clock/);
  assert.throws(()=>validateActivePlanClock(JSON.parse('{"__proto__":"2026-09-22T12:00:00Z"}')),/clock/);
  const workspace={portfolio:emptyPortfolio(),scenario:defaults(),activePlan:activePlanDefaults(),activePlanClock:{}};
  const before=activePlanFingerprint(workspace);workspace.activePlanClock.wallet_a='2026-09-22T12:00:00Z';
  assert.notEqual(before,activePlanFingerprint(workspace));
});
