import test from 'node:test';
import assert from 'node:assert/strict';
import reviewed from '../knowledge/reviewed-deployment.json' with { type: 'json' };
import {
  AUTOMATIC_PARTICIPATION_PCT,
  automaticForecast,
  automaticPlanSettings,
} from '../src/automatic-forecast.js';
import { validateActivePlanSettings } from '../src/active-plan.js';
import { analyzeFarm } from '../src/calculator.js';
import { emptyPortfolio, rules, units, weight } from '../src/model.js';

const GENESIS = rules.schedule.genesis_timestamp;
const NOW = Date.parse('2026-09-22T12:00:00.000Z');
const ADDRESS = '0x1111111111111111111111111111111111111111';

function plot(token_id, tier = 0, { active = false, level = 1, ...extra } = {}) {
  return {
    token_id,
    owner_address: ADDRESS,
    rarity_tier: tier,
    level,
    is_active: active,
    effective_weight_bps: active ? weight(tier, level) : 0,
    pending_crop_wei: '0',
    modifiers: [],
    ...extra,
  };
}

function farm({ watched = true, plots = [plot(1)], snapshot = null } = {}) {
  const portfolio = emptyPortfolio();
  const wallet = portfolio.wallets[0];
  Object.assign(wallet, {
    address: watched ? ADDRESS : null,
    plots,
    expected_plot_count: plots.length,
    crop_balance_wei: units('100000').toString(),
  });
  portfolio.expected_total_plots = plots.length;
  if (snapshot) portfolio.snapshot = snapshot;
  return portfolio;
}

function snapshot(now = NOW, extra = {}) {
  return {
    schema_version: 1,
    chain_id: 4663,
    block_number: 64012808,
    block_timestamp: Math.floor(now / 1000),
    fetchedUTC: new Date(now).toISOString(),
    genesis_timestamp: GENESIS,
    carry_crop_wei: units('123').toString(),
    granary_crop_wei: units('456').toString(),
    total_weight_bps: 20000,
    moon_starts: [],
    read_errors: [],
    ...extra,
  };
}

test('automatic participation is a shared-cap assumption and does not dilute own earnings', () => {
  const portfolio = farm({ plots: [plot(1, 0, { active: true })] });
  const automatic = automaticForecast(portfolio, { now: NOW });
  assert.equal(AUTOMATIC_PARTICIPATION_PCT, 30);
  assert.equal(automatic.assumedParticipationPct, 30);
  assert.equal(automatic.scenario.assumePlanted, true);
  assert.equal(automatic.scenario.externalWeight, '1083.75');

  const withOutside = analyzeFarm(portfolio, automatic.scenario, { days: 7, now: NOW });
  const withoutOutside = analyzeFarm(portfolio, { ...automatic.scenario, externalWeight: '0' }, { days: 7, now: NOW });
  assert.equal(withOutside.status, 'ok');
  assert.equal(withOutside.harvest_rate.nominal_weekly_crop_wei, withoutOutside.harvest_rate.nominal_weekly_crop_wei);
});

test('a fresh nested snapshot supplies one pinned reserve pair, start, and weather observation', () => {
  const season = snapshot(NOW - 10_000, { total_weight_bps: 0 });
  const portfolio = farm({ snapshot: season });
  const result = automaticForecast(portfolio, { now: NOW });
  assert.equal(result.basis, 'chain');
  assert.equal(result.block_number, season.block_number);
  assert.equal(result.scenario.start, new Date(season.block_timestamp * 1000).toISOString());
  assert.equal(result.scenario.carryCrop, '123');
  assert.equal(result.scenario.granaryCrop, '456');
  assert.equal(result.scenario.rewardStateBasis, 'observed');
});

test('stale post-Genesis snapshots cannot restore old reserves', () => {
  const old = snapshot(NOW - 5 * 60 * 1000 - 1, { carry_crop_wei: units('999').toString(), granary_crop_wei: units('999').toString() });
  const result = automaticForecast(farm({ snapshot: old }), { now: NOW });
  assert.equal(result.basis, 'fallback');
  assert.equal(result.scenario.start, new Date(NOW).toISOString());
  assert.equal(result.scenario.carryCrop, '0');
  assert.equal(result.scenario.granaryCrop, '0');
});

test('missing rarity stays unknown while committed pending manifest tiers can size the model outside weight', () => {
  const pending = plot(1, null, {
    owner_address: ADDRESS,
    rarity_tier: null,
    manifest_rarity_tier: 3,
    rarity_verified: false,
    tiers_finalized: false,
    reveal_status: 'revealed',
    block_number: 64012808,
    observed_at_utc: new Date(NOW).toISOString(),
  });
  const portfolio = farm({ plots: [pending] });
  Object.assign(portfolio, {
    chain_id: 4663,
    block_number: 64012808,
    observed_at_utc: new Date(NOW).toISOString(),
    nft_runtime_verified: true,
    nft_contract_address: reviewed.contracts.nft.address,
    manifest_verified: true,
    starting_index: 1827,
    tiers_finalized: false,
  });
  const before = structuredClone(portfolio);
  const result = automaticForecast(portfolio, { now: NOW });
  assert.equal(result.scenario.externalWeight, '1083.45');
  assert.deepEqual(portfolio, before);

  pending.manifest_rarity_tier = null;
  const unknown = automaticForecast(portfolio, { now: NOW });
  assert.equal(unknown.scenario.externalWeight, '1084.05');
});

test('model-only wallets never subtract from an observed network total', () => {
  const modelOnly = farm({ watched: false, plots: [plot(1, 3, { active: true })], snapshot: snapshot(NOW, { total_weight_bps: 20000 }) });
  const result = automaticForecast(modelOnly, { now: NOW });
  assert.equal(result.basis, 'chain');
  assert.equal(result.scenario.externalWeight, '2');
});

test('automatic plan settings estimate positive fees and contain no budget or action intent', () => {
  const scenario = { buyPrice: '0.000002', sellPrice: '0.000001' };
  const settings = automaticPlanSettings(scenario);
  assert.deepEqual(settings, {
    feeMode: 'estimated',
    claimFee: '0.00004',
    upgradeFee: '0.00005',
    plantFee: '0.00007',
    transferFee: '0.000013',
    buyFee: '0.00008',
    nftTransferFee: '0.00004',
    buyPrice: '0.000002',
    sellPrice: '0.000001',
  });
  for (const key of ['extraBudget', 'funding', 'enabled', 'claimClock', 'gasPriceWei']) assert.equal(key in settings, false);
  assert.deepEqual(validateActivePlanSettings(settings).feeMode, 'estimated');
  assert.ok(Object.entries(settings).filter(([key]) => key.endsWith('Fee')).every(([, value]) => Number(value) >= 0.000001));

  const tiny = automaticPlanSettings(scenario, { gasPriceWei: 1 });
  assert.equal(tiny.claimFee, '0.000001');
  assert.deepEqual(automaticPlanSettings(scenario, { gasPriceWei: 'bad-rpc-value' }), settings);
  assert.deepEqual(automaticPlanSettings(scenario, { gasPriceWei: 2n ** 256n }), settings);
});

test('automatic forecast carries the fee patch and leaves preview markers in the source portfolio', () => {
  const portfolio = farm({ plots: [plot(1, 1, { forecast_preview: 'manifest-rarity' })] });
  const before = structuredClone(portfolio);
  const result = automaticForecast(portfolio, { now: NOW, gasPriceWei: 100_000_000n });
  assert.equal(result.activePlanSettings.feeMode, 'estimated');
  assert.deepEqual(portfolio, before);
  assert.match(result.sources.fees, /assumed/);
  assert.match(result.sources.fees, /not actual gas costs or executable quotes/);
});
