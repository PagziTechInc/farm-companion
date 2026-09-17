import { forecastDefaults } from './forecast-defaults.js';
import { forecastPlotTier } from './forecast-portfolio.js';
import { inputAmount, rules, units, weight } from './model.js';
import { validateSeason } from './season.js';

/**
 * Participation is used only to construct a shared-cap scenario. It never
 * changes the farm's own nominal rate.
 */
export const AUTOMATIC_PARTICIPATION_PCT = 30;

export const AUTOMATIC_GAS_BUDGETS = Object.freeze({
  claim: 200_000,
  upgrade: 250_000,
  plant: 350_000,
  transfer: 65_000,
  buy: 400_000,
  nftTransfer: 200_000,
});

const DEFAULT_GAS_PRICE_WEI = 100_000_000n;
const MIN_FEE_WEI = 1_000_000_000_000n; // 0.000001 ETH
const MAX_UINT256 = 2n ** 256n;
// A gas price above 0.001 ETH per gas is not a useful automatic estimate.
const MAX_SANE_GAS_PRICE_WEI = 1_000_000_000_000_000n;
const MAX_AGE_MS = 5 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 30 * 1000;
const WEIGHT_BPS = 10_000n;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isValidTier = tier => Number.isInteger(tier) && tier >= 0 && tier < rules.plots.rarities.length;
const first = (value, keys) => {
  if (!isObject(value)) return undefined;
  for (const key of keys) if (value[key] !== undefined && value[key] !== null) return value[key];
  return undefined;
};

function safeInteger(value) {
  try {
    if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
    if (typeof value === 'bigint') return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
    if (typeof value === 'string' && /^(?:0x[\da-f]+|\d+)$/i.test(value.trim())) {
      const result = BigInt(value.trim());
      return result >= 0n && result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null;
    }
  } catch {
    // Optional imported observations are advisory; malformed values fall back.
  }
  return null;
}

function timestampMs(value, { seconds = false } = {}) {
  try {
    if (typeof value === 'number' || typeof value === 'bigint') {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0) return null;
      return seconds ? number * 1000 : number > 100_000_000_000 ? number : number * 1000;
    }
    if (typeof value !== 'string' || !value.trim()) return null;
    const text = value.trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      const number = Number(text);
      if (!Number.isFinite(number) || number < 0) return null;
      return seconds ? number * 1000 : number > 100_000_000_000 ? number : number * 1000;
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

function isoTimestamp(value, { seconds = false } = {}) {
  const millis = timestampMs(value, { seconds });
  if (millis === null || !Number.isFinite(millis)) return null;
  try { return new Date(millis).toISOString(); } catch { return null; }
}

function validObservedWindow(season, now) {
  if (!season || !Number.isFinite(now)) return false;
  const blockTime = Number(season.block_timestamp) * 1000;
  const fetched = Date.parse(String(season.observed_at_utc ?? ''));
  if (!Number.isFinite(blockTime) || !Number.isFinite(fetched)) return false;
  const blockAge = now - blockTime;
  const fetchedAge = now - fetched;
  return blockAge >= -FUTURE_TOLERANCE_MS && blockAge <= MAX_AGE_MS &&
    fetchedAge >= -FUTURE_TOLERANCE_MS && fetchedAge <= MAX_AGE_MS;
}

/*
 * Reader snapshots are normally portfolio-shaped. The small alias set here
 * also accepts an imported { snapshot } object without making that object an
 * authority for actions. All values are copied into a season-shaped object;
 * no source object is ever changed.
 */
function seasonFromSnapshot(candidate, now, seen = new Set()) {
  if (!isObject(candidate) || seen.has(candidate)) return null;
  seen.add(candidate);

  for (const key of ['season', 'chainObservation', 'chain_observation', 'observation']) {
    const nested = seasonFromSnapshot(candidate[key], now, seen);
    if (nested) return nested;
  }

  const chain = safeInteger(first(candidate, ['chain_id', 'chainId']));
  const block = safeInteger(first(candidate, ['block_number', 'blockNumber']));
  const blockTimestamp = safeInteger(first(candidate, ['block_timestamp', 'blockTimestamp']));
  const genesis = safeInteger(first(candidate, ['genesis_timestamp', 'genesisTimestamp']));
  const fetchedValue = first(candidate, [
    'fetchedUTC', 'fetched_utc', 'fetched_at_utc', 'fetchedAtUTC', 'fetchedAt',
    'observed_at_utc', 'observedAtUTC', 'observedAt',
  ]);
  const fetched = isoTimestamp(fetchedValue);
  if (chain !== 4663 || block === null || blockTimestamp === null || genesis === null || !fetched) return null;
  if (genesis !== rules.schedule.genesis_timestamp) return null;

  const copied = {
    ...candidate,
    schema_version: 1,
    chain_id: chain,
    block_number: block,
    block_timestamp: blockTimestamp,
    genesis_timestamp: genesis,
    observed_at_utc: fetched,
    current_epoch: safeInteger(first(candidate, ['current_epoch', 'currentEpoch'])),
    epoch_start_timestamp: safeInteger(first(candidate, ['epoch_start_timestamp', 'epochStartTimestamp'])),
    next_boundary_timestamp: safeInteger(first(candidate, ['next_boundary_timestamp', 'nextBoundaryTimestamp'])),
    weather_enum: safeInteger(first(candidate, ['weather_enum', 'weatherEnum'])),
    effective_multiplier_bps: safeInteger(first(candidate, ['effective_multiplier_bps', 'effectiveMultiplierBps'])),
    minted_count: safeInteger(first(candidate, ['minted_count', 'mintedCount'])),
    total_weight_bps: safeInteger(first(candidate, ['total_weight_bps', 'totalWeightBps', 'total_planted_farm_weight_bps'])),
    moon_count: safeInteger(first(candidate, ['moon_count', 'moonCount'])),
    flood_active: first(candidate, ['flood_active', 'floodActive']),
    moon_active: first(candidate, ['moon_active', 'moonActive']),
    commit_hash: first(candidate, ['commit_hash', 'commitHash']),
    moon_starts: first(candidate, ['moon_starts', 'moonStarts']) ?? [],
    read_errors: first(candidate, ['read_errors', 'readErrors']) ?? [],
    carry_crop_wei: first(candidate, ['carry_crop_wei', 'carryCropWei']),
    granary_crop_wei: first(candidate, ['granary_crop_wei', 'granaryCropWei']),
    emitted_crop_wei: first(candidate, ['emitted_crop_wei', 'emittedCropWei']),
    paid_out_crop_wei: first(candidate, ['paid_out_crop_wei', 'paidOutCropWei']),
    seed_bag_price_wei: first(candidate, ['seed_bag_price_wei', 'seedBagPriceWei']),
    seed_bag_open: first(candidate, ['seed_bag_open', 'seedBagOpen']),
    weather_schedule: first(candidate, ['weather_schedule', 'weatherSchedule']) ?? null,
  };

  // A reserve pair must belong to the same observed block. Reader snapshots
  // expose reward_observed_at_utc for this purpose; when it is absent, the
  // snapshot's block identity is the common provenance.
  const rewardAt = first(candidate, ['reward_observed_at_utc', 'rewardObservedAtUTC', 'rewardObservedAt']);
  if (rewardAt !== undefined && rewardAt !== null) {
    const rewardMs = timestampMs(rewardAt);
    if (rewardMs === null || rewardMs !== blockTimestamp * 1000) {
      copied.carry_crop_wei = undefined;
      copied.granary_crop_wei = undefined;
    }
  }

  try {
    validateSeason(copied);
    if (!validObservedWindow(copied, now)) return null;
    return copied;
  } catch {
    return null;
  }
}

function snapshotSeason(portfolio, now) {
  if (!isObject(portfolio)) return null;
  const candidates = [
    portfolio.snapshot,
    portfolio.season,
    portfolio.chainObservation,
    portfolio.chain_observation,
    portfolio.observation,
    portfolio,
  ];
  const seen = new Set();
  for (const candidate of candidates) {
    const result = seasonFromSnapshot(candidate, now, seen);
    if (result) return result;
  }
  return null;
}

function safePortfolio(portfolio) {
  if (!isObject(portfolio)) return { wallets: [] };
  if (!Array.isArray(portfolio.wallets)) return { ...portfolio, wallets: [] };
  // forecastDefaults only inspects these two wallet fields in its observed
  // branch. Sanitizing them keeps malformed optional imports from throwing.
  return {
    ...portfolio,
    wallets: portfolio.wallets.map(wallet => isObject(wallet) ? {
      ...wallet,
      plots: Array.isArray(wallet.plots) ? wallet.plots : [],
    } : { address: null, plots: [] }),
  };
}

function safeTier(portfolio, plot) {
  try {
    const tier = forecastPlotTier(portfolio, plot);
    return isValidTier(tier) ? tier : null;
  } catch {
    return null;
  }
}

function plotsOf(portfolio) {
  if (!isObject(portfolio) || !Array.isArray(portfolio.wallets)) return [];
  return portfolio.wallets.flatMap(wallet => isObject(wallet) && Array.isArray(wallet.plots)
    ? wallet.plots.filter(isObject).map(plot => ({ wallet, plot })) : []);
}

function activeWeight(portfolio, plot) {
  if (plot?.is_active !== true) return 0n;
  // A live read can include synchronized modifiers or other source-level
  // details that a rarity/level recomputation cannot capture. Preserve that
  // observed effective weight, including a genuine observed zero.
  const observed = safeInteger(plot?.effective_weight_bps);
  if (observed !== null) return BigInt(observed);
  const tier = safeTier(portfolio, plot);
  const level = Number.isInteger(plot?.level) && plot.level >= 1 && plot.level <= 5 ? plot.level : null;
  if (tier !== null && level !== null) {
    try { return BigInt(weight(tier, level)); } catch { /* fall through to observed weight */ }
  }
  return 0n;
}

function ownBaseWeight(portfolio) {
  return plotsOf(portfolio).reduce((sum, { plot }) => {
    const tier = safeTier(portfolio, plot);
    return tier === null ? sum : sum + BigInt(rules.plots.rarities[tier].multiplier_bps);
  }, 0n);
}

function publishedLevelOneWeight() {
  return rules.plots.rarities.reduce((sum, rarity) =>
    sum + BigInt(rarity.count) * BigInt(rarity.multiplier_bps), 0n);
}

function formatFraction(numerator, denominator) {
  if (denominator <= 0n || numerator < 0n) return '0';
  const whole = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return whole.toString();
  // All current denominators terminate in at most four decimal places, but a
  // bounded decimal conversion also keeps this safe if published values grow.
  const scale = 10n ** 18n;
  const fraction = ((remainder * scale) / denominator).toString().padStart(18, '0').replace(/0+$/, '');
  return `${whole}.${fraction || '0'}`;
}

function modelOutsideWeight(portfolio) {
  const remaining = publishedLevelOneWeight() - ownBaseWeight(portfolio);
  const bounded = remaining > 0n ? remaining : 0n;
  return formatFraction(bounded * BigInt(AUTOMATIC_PARTICIPATION_PCT), 100n * WEIGHT_BPS);
}

function watchedOutsideWeight(portfolio, observed) {
  if (!observed || observed.block_timestamp * 1000 < rules.schedule.genesis_timestamp * 1000) return null;
  const total = safeInteger(observed.total_weight_bps);
  if (total === null) return null;
  const watched = plotsOf(portfolio).reduce((sum, { wallet, plot }) => {
    const address = typeof wallet?.address === 'string' ? wallet.address.trim() : '';
    return address ? sum + activeWeight(portfolio, plot) : sum;
  }, 0n);
  const outside = BigInt(total) - watched;
  return formatFraction(outside > 0n ? outside : 0n, WEIGHT_BPS);
}

function parseGasPriceWei(value) {
  try {
    let parsed = null;
    if (typeof value === 'bigint') parsed = value;
    else if (typeof value === 'number' && Number.isSafeInteger(value)) parsed = BigInt(value);
    else if (typeof value === 'string' && /^(?:0x[\da-f]+|\d+)$/i.test(value.trim())) parsed = BigInt(value.trim());
    if (parsed !== null && parsed > 0n && parsed < MAX_SANE_GAS_PRICE_WEI) return { value: parsed, supplied: true };
  } catch {
    // Fall back to the explicitly documented low default for optional RPC data.
  }
  return { value: DEFAULT_GAS_PRICE_WEI, supplied: false };
}

function feeEstimate(gasPriceWei, gasBudget) {
  const estimated = gasPriceWei * BigInt(gasBudget) * 2n;
  const bounded = estimated >= MAX_UINT256 ? null : estimated > MIN_FEE_WEI ? estimated : MIN_FEE_WEI;
  return bounded === null ? inputAmount(MIN_FEE_WEI) : inputAmount(bounded);
}

function safePrice(value) {
  try {
    if (value === null || value === undefined || value === '') return '';
    const parsed = units(value);
    return inputAmount(parsed);
  } catch {
    return '';
  }
}

/**
 * Return only settings that can be merged into a validated active-plan
 * settings object. Fees are planning estimates, never transaction quotes.
 */
export function automaticPlanSettings(scenario, options = {}) {
  const opts = isObject(options) ? options : {};
  const gas = parseGasPriceWei(opts.gasPriceWei).value;
  return {
    feeMode: 'estimated',
    claimFee: feeEstimate(gas, AUTOMATIC_GAS_BUDGETS.claim),
    upgradeFee: feeEstimate(gas, AUTOMATIC_GAS_BUDGETS.upgrade),
    plantFee: feeEstimate(gas, AUTOMATIC_GAS_BUDGETS.plant),
    transferFee: feeEstimate(gas, AUTOMATIC_GAS_BUDGETS.transfer),
    buyFee: feeEstimate(gas, AUTOMATIC_GAS_BUDGETS.buy),
    nftTransferFee: feeEstimate(gas, AUTOMATIC_GAS_BUDGETS.nftTransfer),
    buyPrice: safePrice(scenario?.buyPrice),
    sellPrice: safePrice(scenario?.sellPrice),
  };
}

function marketFromPortfolio(portfolio, observed) {
  if (!isObject(portfolio) || !observed) return null;
  const market = first(portfolio, ['market', 'market_reference', 'marketReference', 'pool_reference', 'poolReference']);
  if (!isObject(market) || market.block_number !== observed.block_number) return null;
  return market;
}

/**
 * Build automatic, read-only forecast inputs. Dormant planting is represented
 * by a scenario flag; the input portfolio is never prepared or modified.
 */
export function automaticForecast(portfolio, options = {}) {
  const opts = isObject(options) ? options : {};
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const explicitSeason = opts.season ?? null;
  const observedSeason = explicitSeason ?? snapshotSeason(portfolio, now);
  const observedForDefaults = explicitSeason ?? observedSeason;
  const market = opts.market ?? marketFromPortfolio(portfolio, observedSeason);
  let result;
  try {
    result = forecastDefaults(safePortfolio(portfolio), { season: observedForDefaults, market, now });
  } catch {
    // Keep optional malformed imports advisory and retain the same documented
    // post-Genesis zero-reserve fallback as forecastDefaults.
    result = forecastDefaults({ wallets: [] }, { season: null, market: null, now });
  }

  const scenario = {
    ...result.scenario,
    // Consumed by the caller when it creates an isolated planting preview.
    assumePlanted: true,
    annualGrowthPct: '0',
    externalWeightPath: [],
  };
  const actualOutside = watchedOutsideWeight(portfolio, observedSeason);
  const useActual = actualOutside !== null && result.basis === 'chain';
  scenario.externalWeight = useActual ? actualOutside : modelOutsideWeight(portfolio);

  const sources = {
    ...result.sources,
    externalWeight: useActual
      ? 'Observed outside planted weight at the fresh block is used for shared-cap checks; own nominal yield is unchanged.'
      : 'Assumed 30% of the remaining published level-1 collection weight for shared-cap checks; own nominal yield is unchanged.',
    planting: 'Dormant plots are assumed planted in this scenario; planting capital stays separate from harvest.',
    fees: 'Estimated fees use assumed gas budgets ×2; they are not actual gas costs or executable quotes.',
  };
  const gasInfo = parseGasPriceWei(opts.gasPriceWei);
  if (!gasInfo.supplied) sources.fees = 'Estimated fees use assumed gas budgets ×2 at a 0.1 gwei fallback; they are not actual gas costs or executable quotes.';

  return {
    ...result,
    scenario,
    sources,
    assumedParticipationPct: AUTOMATIC_PARTICIPATION_PCT,
    activePlanSettings: automaticPlanSettings(scenario, { gasPriceWei: opts.gasPriceWei }),
  };
}
