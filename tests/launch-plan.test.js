import test from 'node:test';
import assert from 'node:assert/strict';
import { activePlanDefaults, activePlanInput } from '../src/active-plan.js';
import { simulate, timeline } from '../src/engine.js';
import { DAY, GENESIS, UNIT, defaults, emptyPortfolio, rules, units, weight } from '../src/model.js';

function goldenPlot(tokenId = 17) {
  return { token_id: tokenId, rarity_tier: 3, level: 1, is_active: true,
    effective_weight_bps: weight(3, 1), pending_crop_wei: '0', modifiers: [] };
}

function makePortfolio({ crop = '0', eth = '0.2', secondWallet = false } = {}) {
  const portfolio = emptyPortfolio(), a = portfolio.wallets[0];
  Object.assign(a, { id: 'wallet_a', label: 'Wallet A', expected_plot_count: 1,
    crop_balance_wei: units(crop).toString(), eth_balance_wei: units(eth).toString(), plots: [goldenPlot()] });
  portfolio.expected_total_plots = 1;
  if (secondWallet) portfolio.wallets.push({ id: 'wallet_b', label: 'Wallet B', address: null,
    expected_plot_count: 0, crop_balance_wei: '0', eth_balance_wei: units('0.2').toString(), plots: [] });
  return portfolio;
}

function makeScenario(externalWeight = '1000') {
  return { ...defaults(), start: new Date(GENESIS * 1000).toISOString(), externalWeight,
    weatherBps: 10000, useKnownWeather: true, weatherWeeks: [{ epoch: 0, multiplier_bps: 12000 }],
    buyPrice: '0.000001', sellPrice: '0.000002', extraBudget: '0.1', feeMode: 'zero',
    includeOpeningCrop: true, allowTransfers: false };
}

function makeWorkspace({ portfolio = makePortfolio(), scenario = makeScenario(), activePlan = {} } = {}) {
  return { portfolio, scenario,
    activePlan: { ...activePlanDefaults(), enabled: true, feeMode: 'zero', ...activePlan } };
}

test('active plan can repeat one plot through consecutive levels from its own opening CROP', () => {
  const workspace = makeWorkspace({ portfolio: makePortfolio({ crop: '85000' }),
    scenario: makeScenario('1000'),
    activePlan: { days: 90, funding: 'harvest', objective: 'crop', includeOpeningCrop: true } });
  const input = activePlanInput(workspace, GENESIS * 1000);
  assert.deepEqual(input.errors, []);
  assert.equal(input.scope, 'model');
  assert.equal(timeline(input.scenario, 1)[0].segments[0].multiplier_bps, 24000);

  const result = simulate(input.portfolio, input.scenario, { days: 90, funding: 'harvest',
    policy: 'efficiency', objective: 'crop' });
  const upgrades = result.actions.filter(action => action.type === 'upgrade');
  assert.equal(result.status, 'ok');
  assert.deepEqual(upgrades.map(({ day, wallet_id, plot_id, to_level }) => [day, wallet_id, plot_id, to_level]), [
    [0, 'wallet_a', 17, 2], [0, 'wallet_a', 17, 3], [0, 'wallet_a', 17, 4], [0, 'wallet_a', 17, 5]
  ]);
  assert.equal(result.spent_crop_wei, units('85000'));
  assert.equal(result.bought_crop_wei, 0n);
  assert.equal(result.extra_investment_eth_wei, 0n);
  assert.equal(result.wallets[0].plots[0].level, 5);
  assert.equal(result.ending_crop_wei, units('85000') + result.net_crop_wei);
});

test('a cheap quoted buy can beat waiting, with principal deducted from the ETH result', () => {
  const workspace = makeWorkspace({ portfolio: makePortfolio(), scenario: makeScenario('5000'), activePlan: {
    days: 30, funding: 'extra', objective: 'eth', buyPrice: '0.000001', sellPrice: '0.000002',
    extraBudget: '0.01', extraSpent: '0', includeOpeningCrop: false, claimEveryDays: 7
  } });
  const input = activePlanInput(workspace, GENESIS * 1000);
  assert.deepEqual(input.errors, []);
  const extra = simulate(input.portfolio, input.scenario, { days: 30, funding: 'extra',
    policy: 'efficiency', objective: 'eth', budgetFraction: 100 });
  const harvest = simulate(input.portfolio, input.scenario, { days: 30, funding: 'harvest',
    policy: 'efficiency', objective: 'eth' });
  const actions = extra.actions.filter(action => ['buy', 'upgrade'].includes(action.type));

  assert.equal(extra.status, 'ok');
  assert.deepEqual(actions.map(({ day, wallet_id, type, to_level, crop_wei }) =>
    [day, wallet_id, type, to_level ?? null, crop_wei]), [
    [0, 'wallet_a', 'buy', null, units('5000').toString()],
    [0, 'wallet_a', 'upgrade', 2, units('5000').toString()]
  ]);
  assert.equal(extra.bought_crop_wei, units('5000'));
  assert.equal(extra.spent_crop_wei, units('5000'));
  assert.equal(extra.extra_investment_eth_wei, units('0.005'));
  assert.equal(extra.purchase_cost_eth_wei, units('0.005'));
  assert.equal(extra.operating_eth_wei,
    (extra.net_crop_wei + extra.bought_crop_wei) * units(input.scenario.sellPrice) / UNIT - extra.purchase_cost_eth_wei - extra.gas_eth_wei);
  assert.equal(extra.cash_recovery_eth_wei, -extra.purchase_cost_eth_wei - extra.gas_eth_wei);
  assert.ok(extra.operating_eth_wei < (extra.net_crop_wei + extra.bought_crop_wei) * units(input.scenario.sellPrice) / UNIT);
  assert.ok(extra.operating_eth_wei > harvest.operating_eth_wei);
  assert.ok(extra.net_crop_wei > harvest.net_crop_wei);
  assert.equal(extra.remaining_eth_wei, units('0.2') - extra.purchase_cost_eth_wei - extra.gas_eth_wei);
  assert.ok(extra.extra_investment_eth_wei <= units(input.scenario.extraBudget));
  assert.equal(extra.wallets[0].eth, extra.remaining_eth_wei);
});

test('extra-investment caps and the paying wallet ETH balance constrain repeat-buy actions', () => {
  const capWorkspace = makeWorkspace({ portfolio: makePortfolio(), scenario: makeScenario('5000'), activePlan: {
    days: 30, funding: 'extra', objective: 'eth', buyPrice: '0.000001', sellPrice: '0.000002',
    extraBudget: '0.004', extraSpent: '0', includeOpeningCrop: false, claimEveryDays: 7
  } });
  const capInput = activePlanInput(capWorkspace, GENESIS * 1000);
  const capResult = simulate(capInput.portfolio, capInput.scenario, { days: 30, funding: 'extra',
    policy: 'efficiency', objective: 'eth', budgetFraction: 100 });
  assert.equal(capResult.status, 'ok');
  assert.ok(capResult.extra_investment_eth_wei <= units('0.004'));
  assert.ok(capResult.remaining_eth_wei >= 0n);
  assert.equal(capResult.remaining_eth_wei, units('0.2') - capResult.purchase_cost_eth_wei - capResult.gas_eth_wei);

  const walletWorkspace = makeWorkspace({ portfolio: makePortfolio({ eth: '0.002', secondWallet: true }),
    scenario: makeScenario('5000'), activePlan: {
      days: 30, funding: 'extra', objective: 'eth', buyPrice: '0.000001', sellPrice: '0.000002',
      extraBudget: '0.1', extraSpent: '0', includeOpeningCrop: false, claimEveryDays: 7, allowTransfers: false
    } });
  const walletInput = activePlanInput(walletWorkspace, GENESIS * 1000);
  const walletResult = simulate(walletInput.portfolio, walletInput.scenario, { days: 30, funding: 'extra',
    policy: 'efficiency', objective: 'eth', budgetFraction: 100 });
  assert.equal(walletResult.status, 'ok');
  assert.equal(walletResult.bought_crop_wei, 0n);
  assert.equal(walletResult.extra_investment_eth_wei, 0n);
  assert.ok(walletResult.actions.every(action => action.type !== 'buy' && action.type !== 'upgrade'));
  assert.deepEqual(walletResult.wallets.map(wallet => [wallet.id, wallet.eth]), [
    ['wallet_a', units('0.002')], ['wallet_b', units('0.2')]
  ]);
});

test('fresh watched weather replaces cached weeks and rebase still selects the absolute epoch', () => {
  const now = (GENESIS + 15 * DAY + 12 * 3600) * 1000;
  const observedAt = new Date(now).toISOString(), blockTimestamp = Math.floor(now / 1000);
  const portfolio = makePortfolio({ crop: '85000' });
  Object.assign(portfolio.wallets[0], { address: `0x${'1'.repeat(40)}` });
  portfolio.wallets[0].plots[0].owner_address = portfolio.wallets[0].address;
  portfolio.observed_at_utc = observedAt;
  portfolio.reward_observed_at_utc = observedAt;
  portfolio.block_number = 12345;
  portfolio.block_timestamp = blockTimestamp;
  portfolio.carry_crop_wei = '0';
  portfolio.granary_crop_wei = units('40000000').toString();
  portfolio.total_planted_farm_weight_bps = weight(3, 1);
  const observedWeeks = [
    { epoch: 0, multiplier_bps: 12000, announced: true },
    { epoch: 2, multiplier_bps: 8000, announced: true }
  ];
  portfolio.weather_schedule = { status: 'ok', chain_id: 4663, block_number: 12345, block_timestamp: blockTimestamp,
    observed_at_utc: observedAt, genesis_timestamp: rules.schedule.genesis_timestamp,
    commit_hash: `0x${'a'.repeat(64)}`, weeks: observedWeeks };
  const scenario = { ...makeScenario('1000'), start: '2026-09-21T00:00:00Z',
    weatherWeeks: [{ epoch: 0, multiplier_bps: 15000 }, { epoch: 2, multiplier_bps: 12000 }] };
  const workspace = makeWorkspace({ portfolio, scenario, activePlan: { days: 30, funding: 'harvest',
    objective: 'crop', feeMode: 'zero', useObservedWeight: false, includeOpeningCrop: true } });

  const input = activePlanInput(workspace, now);
  assert.deepEqual(input.errors, []);
  assert.equal(input.scope, 'watched');
  assert.equal(input.scenario.start, observedAt);
  assert.deepEqual(input.scenario.weatherWeeks, observedWeeks);
  assert.equal(input.scenario.weatherBasis, 'chain');
  assert.equal(input.scenario.weatherObservedAt, observedAt);
  assert.equal(Math.floor((Date.parse(input.scenario.start) / 1000 - GENESIS) / (7 * DAY)), 2);
  assert.equal(timeline(input.scenario, 1)[0].segments[0].multiplier_bps, 12000); // Epoch 2's 0.8× week × 1.5× First Soil.
});
