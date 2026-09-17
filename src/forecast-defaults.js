import { allPlots, defaults, inputAmount, rules, units } from './model.js';
import { validateSeason } from './season.js';
import launchWeather from '../knowledge/launch-weather.json' with { type: 'json' };

export const FORECAST_FIELDS = ['start', 'externalWeight', 'weatherBps', 'annualGrowthPct', 'carryCrop', 'granaryCrop', 'buyPrice', 'sellPrice', 'useKnownWeather'];
export const RESERVE_FIELDS = ['start', 'carryCrop', 'granaryCrop'];
const MAX_AGE_MS = 5 * 60 * 1000;
const isAmount = value => typeof value === 'string' && /^\d{1,78}$/.test(value) && BigInt(value) < 2n ** 256n;
export const NOMINAL_RATE_SOURCE = 'Your weight determines the nominal rate. No additional valley weight assumed; ceilings and Granary still apply.';

export function fullSupplyCompetition(portfolio) {
  const total = rules.plots.rarities.reduce((n, rarity) => n + rarity.count * rarity.multiplier_bps, 0);
  const ownBase = allPlots(portfolio).reduce((n, plot) => n + (rules.plots.rarities[plot.rarity_tier]?.multiplier_bps ?? 0), 0);
  return String(Math.max(0, total - ownBase) / 10000);
}

export function forecastManualFields(value, legacyScenario) {
  if (value == null) return FORECAST_FIELDS.filter(key => legacyScenario?.[key] != null && legacyScenario[key] !== '');
  if (!Array.isArray(value) || value.length > FORECAST_FIELDS.length || value.some(key => !FORECAST_FIELDS.includes(key))) throw Error('Invalid saved forecast field preferences.');
  return [...new Set(value)];
}

// Observations initialize scenarios; none of these defaults establish a future price,
// future participation, an executable quote, or authority for a wallet action.
export function forecastDefaults(portfolio, { season = null, market = null, now = Date.now() } = {}) {
  const genesis = rules.schedule.genesis_timestamp * 1000;
  const beforeGenesis = now < genesis;
  const scenario = { ...defaults(), allowTransfers: false, useKnownWeather: true,
    weatherWeeks: launchWeather.weeks.map(w => ({...w})), weatherBasis: 'cached', weatherObservedAt: launchWeather.observed_at_utc,
    start: new Date(Math.max(now, genesis)).toISOString(),
    externalWeight: '0',
    carryCrop: rules.emissions.initial_carry_crop,
    granaryCrop: beforeGenesis ? rules.emissions.initial_granary_crop : '0' };
  const sources = {
    start: 'Current time, or Genesis before farming opens.',
    externalWeight: NOMINAL_RATE_SOURCE,
    weatherBps: 'Fair is the assumption for weeks not yet known.',
    useKnownWeather: `Week 1 Sunny from the saved ${launchWeather.observed_at_utc.slice(0,10)} chain check. Future weeks use your weather assumption.`,
    annualGrowthPct: '0% growth: participation stays at the selected weight.',
    reserves: beforeGenesis ? 'Published opening carry and Granary.' : 'Conservative fallback: no opening carry or Granary bonus reserve.',
  };
  let observed = null;
  try {
    validateSeason(season);
    const age = now - season.block_timestamp * 1000;
    const receivedAge = now - Date.parse(season.observed_at_utc);
    if (age >= -30000 && age <= MAX_AGE_MS && receivedAge >= -30000 && receivedAge <= MAX_AGE_MS && season.genesis_timestamp === rules.schedule.genesis_timestamp) observed = season;
  } catch { /* Unavailable or malformed observations keep explicit scenario defaults. */ }
  if (observed) {
    if (isAmount(observed.carry_crop_wei) && isAmount(observed.granary_crop_wei)) {
      scenario.carryCrop = inputAmount(observed.carry_crop_wei);
      scenario.granaryCrop = inputAmount(observed.granary_crop_wei);
      scenario.rewardObservedAt = new Date(observed.block_timestamp * 1000).toISOString();
      scenario.start = new Date(Math.max(observed.block_timestamp * 1000, genesis)).toISOString();
      scenario.rewardStateBasis = 'observed';
      sources.start = 'Aligned to the reserve observation, or Genesis before farming opens.';
      sources.reserves = `Carry and Granary read together at block ${observed.block_number.toLocaleString('en-US')}.`;
    }
    const schedule = observed.weather_schedule;
    if (schedule?.status === 'ok' && schedule.block_number === observed.block_number && schedule.block_timestamp === observed.block_timestamp) {
      scenario.weatherWeeks = schedule.weeks.map(w => ({...w}));
      scenario.weatherBasis = 'chain'; scenario.weatherObservedAt = schedule.observed_at_utc;
      sources.useKnownWeather = `${schedule.weeks.length} known weeks from scheduling events and settled history at block ${observed.block_number.toLocaleString('en-US')}. Early scheduled weeks can change until their 24-hour cutoff.`;
    }
    if (observed.block_timestamp * 1000 >= genesis && observed.total_weight_bps != null) {
      const watched = portfolio.wallets.filter(wallet => wallet.address);
      const own = watched.flatMap(wallet => wallet.plots).reduce((sum, plot) => sum + (plot.effective_weight_bps ?? 0), 0);
      scenario.externalWeight = String(Math.max(0, observed.total_weight_bps - own) / 10000);
      const sameBlock = portfolio.block_number === observed.block_number && !portfolio.read_errors?.length && !portfolio.rule_conflicts?.length;
      sources.externalWeight = `Observed network weight${own ? sameBlock ? ' minus your watched farm at the same block' : ' minus your saved watched-farm weight estimate' : ''} is an optional harvest-limit scenario. Your nominal rate still uses your own weight; future participation stays constant.`;
    }
  }
  // Planting parity is a transparent fallback scenario, not a market-price claim.
  const bag = observed && isAmount(observed.seed_bag_price_wei) && BigInt(observed.seed_bag_price_wei) > 0n
    ? BigInt(observed.seed_bag_price_wei) : units(rules.planting.seed_bag.opening_price_eth);
  const parity = bag / BigInt(rules.planting.cost_crop);
  scenario.buyPrice = scenario.sellPrice = inputAmount(parity > 0n ? parity : units(rules.planting.seed_bag.opening_price_eth) / BigInt(rules.planting.cost_crop));
  sources.prices = 'Planting-cost estimate: seed-bag ETH divided by 2,500 CROP. A scenario reference, not a market price or executable buy/sell quote.';
  let priceBasis = 'planting-cost estimate';
  if (observed && market?.status === 'ok' && market.block_number === observed.block_number &&
      isAmount(market.buy_price_wei) && isAmount(market.sell_price_wei) && BigInt(market.buy_price_wei) > 0n && BigInt(market.sell_price_wei) > 0n) {
    scenario.buyPrice = inputAmount(market.buy_price_wei);
    scenario.sellPrice = inputAmount(market.sell_price_wei);
    sources.prices = 'Active-pool spot reference adjusted for its swap fee. Excludes trade-size impact and gas; future prices are unknown.';
    priceBasis = 'pool reference';
  }
  return { scenario, sources, priceBasis, basis: observed ? 'chain' : 'fallback',
    block_number: observed?.block_number ?? null, observed_at_utc: observed?.observed_at_utc ?? null,
    partial: Boolean(observed?.read_errors?.length), marketUnavailable: market?.status === 'unavailable' };
}
