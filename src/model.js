import rules from '../knowledge/rules.json' with { type: 'json' };
import { eventWindows, validateWeatherWeeks } from './weather.js';
import { validateWeatherSchedule } from './weather-schedule.js';
export { rules };
export const UNIT = 10n ** 18n;
export const DAY = 86400;
export const YEAR = 365 * DAY;
export const GENESIS = rules.schedule.genesis_timestamp;

export function units(value) {
  const s = String(value ?? '').trim();
  if (s.length > 90 || !/^\d+(\.\d{1,18})?$/.test(s)) throw new Error('Enter a nonnegative decimal with at most 18 places.');
  const [a, b = ''] = s.split('.');
  const result = BigInt(a) * UNIT + BigInt(b.padEnd(18, '0'));
  if (result >= 2n ** 256n) throw new Error('Amount exceeds the supported token range.');
  return result;
}
export function amount(value, precision = 2) {
  if (value === null || value === undefined) return '—';
  const n = BigInt(value), sign = n < 0n ? '−' : '', abs = n < 0n ? -n : n;
  return sign + (abs / UNIT).toLocaleString('en-US') + (precision ? '.' + (abs % UNIT).toString().padStart(18, '0').slice(0, precision) : '');
}
export function inputAmount(value) {
  if (value == null) return '';
  const v = BigInt(value);
  return `${v / UNIT}.${(v % UNIT).toString().padStart(18, '0')}`.replace(/\.?0+$/, '') || '0';
}
export const clone = value => structuredClone(value);
export const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
export function weight(tier, level) {
  return rules.plots.rarities[tier].multiplier_bps * rules.levels.entries[level - 1].multiplier_bps / 10000;
}
export const levelCost = level => units(rules.levels.entries[level - 1].incremental_upgrade_cost_crop);
export const allPlots = portfolio => portfolio.wallets.flatMap(w => w.plots.map(p => ({ ...p, wallet_id: w.id })));
export function emptyPortfolio() {
  return { schema_version: 1, is_template: false, is_demo: false, chain_id: 4663, expected_total_plots: 0,
    observed_at_utc: null, block_number: null, total_planted_farm_weight_bps: null,
    wallets: ['a'].map(id => ({ id: `wallet_${id}`, label: `Wallet ${id.toUpperCase()}`, address: null, expected_plot_count: 0, crop_balance_wei: '0', eth_balance_wei: null, plots: [] })) };
}
export function defaults() {
  return { carryCrop: '0', granaryCrop: '40000000', rewardStateBasis: 'assumption', start: rules.schedule.genesis_utc, externalWeight: '0', weatherBps: 10000, annualGrowthPct: '0',
    buyPrice: '', sellPrice: '', extraBudget: '', feeMode: 'unknown', claimFee: '', upgradeFee: '', plantFee: '', transferFee: '', buyFee: '', nftTransferFee: '',
    walletMode: 'keep', claimEveryDays: 7, downtimeHours: '0', nftBasis: '', nftTerminal: '',
    weatherPath: [], weatherWeeks: [], useKnownWeather: false, weatherEvents: [], externalWeightPath: [], allowTransfers: true, includeOpeningCrop: false };
}
export function demoPortfolio() {
  const p = emptyPortfolio(); p.is_demo = true; p.expected_total_plots = 22;
  p.wallets = ['a','b'].map(id => ({id:`wallet_${id}`,label:`Wallet ${id.toUpperCase()}`,address:null,expected_plot_count:11,crop_balance_wei:'0',eth_balance_wei:null,plots:[]}));
  let id = 1;
  [[6, 3, 1, 1], [5, 3, 3, 0]].forEach((counts, i) => {
    p.wallets[i].crop_balance_wei = '0'; p.wallets[i].eth_balance_wei = units('0.1').toString();
    p.wallets[i].plots = counts.flatMap((n, tier) => Array.from({ length: n }, () => ({ token_id: id++, rarity_tier: tier, level: 1, is_active: false, effective_weight_bps: 0, pending_crop_wei: '0', reveal_status: 'revealed', modifiers: [], evidence_source: 'fictional-demo' })));
  });
  return { portfolio: p, scenario: { ...defaults(), externalWeight: '3587', buyPrice: '0.000001', sellPrice: '0.000001', extraBudget: '0.1', feeMode: 'zero' } };
}
export function validatePortfolio(p, complete = true) {
  const errors = [];
  if (!p || p.schema_version !== 1 || p.chain_id !== 4663 || !Array.isArray(p.wallets) || p.wallets.length < 1 || p.wallets.length > 20) return ['Expected schema version 1, chain 4663 and 1–20 wallet records.'];
  if (p.weather_schedule != null) try { validateWeatherSchedule(p.weather_schedule); } catch (e) { errors.push(e.message); }
  if (!Number.isInteger(p.expected_total_plots) || p.expected_total_plots < 0 || p.expected_total_plots > 100) errors.push('Expected plot count must be 0–100.');
  for (const key of ['block_number', 'block_timestamp', 'total_planted_farm_weight_bps', 'effective_weather_multiplier_bps', 'genesis_timestamp', 'next_boundary_timestamp', 'current_epoch']) if (p[key] != null && (!Number.isSafeInteger(p[key]) || p[key] < 0)) errors.push(`${key} must be a nonnegative safe integer.`);
  for (const key of ['read_errors', 'read_warnings', 'metadata_errors', 'rule_conflicts']) if (p[key] != null && (!Array.isArray(p[key]) || p[key].some(v => typeof v !== 'string'))) errors.push(`${key} must be a list of messages.`);
  for (const key of ['is_demo', 'is_template','seed_bag_open','tiers_finalized','manifest_verified','nft_runtime_verified']) if (p[key] != null && typeof p[key] !== 'boolean') errors.push(`${key} must be boolean.`);
  for (const key of ['observed_at_utc','reward_observed_at_utc']) if(p[key]!=null&&(typeof p[key]!=='string'||!Number.isFinite(Date.parse(p[key])))) errors.push(`${key} must be a valid timestamp.`);
  const ids = new Set(), walletIds = new Set(), addresses = new Set();
  const integerAmount = v => typeof v === 'string' && v.length <= 78 && /^\d+$/.test(v) && BigInt(v) < 2n ** 256n;
  for (const key of ['carry_crop_wei','granary_crop_wei','emitted_crop_wei','emitted_base_crop_wei','paid_out_crop_wei','seed_bag_price_wei']) if(p[key]!=null&&!integerAmount(p[key])) errors.push(`${key} must be a base-unit integer string.`);
  if (complete && Array.isArray(p.rule_conflicts)) errors.push(...p.rule_conflicts);
  if (complete && Array.isArray(p.read_errors)) errors.push(...p.read_errors.map(error=>`Incomplete wallet read: ${error}`));
  for (const w of p.wallets) {
    if (!w || typeof w !== 'object') { errors.push('Each wallet must be an object.'); continue; }
    if (typeof w.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(w.id) || walletIds.has(w.id)) errors.push('Wallet IDs must be unique short identifiers.');
    if (typeof w.label !== 'string' || w.label.length > 120) errors.push('Wallet labels must be short text.');
    if (w.expected_plot_count != null && (!Number.isInteger(w.expected_plot_count) || w.expected_plot_count < 0 || w.expected_plot_count > 100)) errors.push('Expected wallet count must be 0–100.');
    walletIds.add(w.id);
    if (w.address != null && (typeof w.address !== 'string' || !/^0x[\da-fA-F]{40}$/.test(w.address) || addresses.has(w.address.toLowerCase()))) errors.push('Enter distinct valid public wallet addresses.');
    if (typeof w.address === 'string') addresses.add(w.address.toLowerCase());
    for (const key of ['crop_balance_wei', 'eth_balance_wei']) if (w[key] != null && !integerAmount(w[key])) errors.push(`${w.label}: ${key} must be a base-unit integer string.`);
    if (complete && w.crop_balance_wei == null) errors.push(`${w.label}: CROP balance is unknown.`);
    if (!Array.isArray(w.plots)) { errors.push('Each wallet needs a plots array.'); continue; }
    for (const plot of w.plots) {
      if (!plot || typeof plot !== 'object') { errors.push('Each plot must be an object.'); continue; }
      if (!Number.isInteger(plot.token_id) || plot.token_id < 1 || plot.token_id > 3333 || ids.has(plot.token_id)) errors.push('Plot IDs must be unique integers from 1 to 3333.');
      ids.add(plot.token_id);
      if (plot.owner_address != null && (typeof plot.owner_address !== 'string' || !/^0x[\da-fA-F]{40}$/.test(plot.owner_address))) errors.push(`Plot ${plot.token_id}: invalid recorded owner.`);
      if (typeof plot.owner_address === 'string' && typeof w.address === 'string' && plot.owner_address.toLowerCase() !== w.address.toLowerCase()) errors.push(`Plot ${plot.token_id}: recorded owner conflicts with its wallet.`);
      if (plot.rarity_tier != null && (!Number.isInteger(plot.rarity_tier) || plot.rarity_tier < 0 || plot.rarity_tier > 3)) errors.push(`Plot ${plot.token_id}: invalid rarity.`);
      if (plot.level != null && (!Number.isInteger(plot.level) || plot.level < 1 || plot.level > 5)) errors.push(`Plot ${plot.token_id}: invalid level.`);
      if (plot.pending_crop_wei != null && !integerAmount(plot.pending_crop_wei)) errors.push(`Plot ${plot.token_id}: pending amount must be an integer string.`);
      if (plot.is_active != null && typeof plot.is_active !== 'boolean') errors.push(`Plot ${plot.token_id}: activation must be boolean or unknown.`);
      if (plot.effective_weight_bps != null && (!Number.isInteger(plot.effective_weight_bps) || plot.effective_weight_bps < 0)) errors.push(`Plot ${plot.token_id}: invalid effective weight.`);
      if (!complete) continue;
      if (plot.rarity_tier == null || plot.level == null || plot.pending_crop_wei == null || typeof plot.is_active !== 'boolean' || plot.effective_weight_bps == null) errors.push(`Plot ${plot.token_id}: rarity, level, activation, weight and pending CROP are required.`);
      else if (plot.rarity_tier >= 0 && plot.rarity_tier <= 3 && plot.level >= 1 && plot.level <= 5 && plot.effective_weight_bps !== (plot.is_active ? weight(plot.rarity_tier, plot.level) : 0)) errors.push(`Plot ${plot.token_id}: effective weight differs from the ordinary rules; resolve modifiers or synchronization first.`);
      if (Array.isArray(plot.modifiers) && plot.modifiers.length) errors.push(`Plot ${plot.token_id}: temporary modifiers are not supported until their rules are verified.`);
    }
  }
  if (complete && !ids.size) errors.push('Add at least one plot to calculate a forecast.');
  if (ids.size > 100) errors.push('Use at most 100 plots per workspace.');
  return [...new Set(errors)];
}
export function validateScenario(s) {
  const errors = [];
  if (!s || !Number.isFinite(Date.parse(s.start))) return ['Choose a valid scenario start date.'];
  try { eventWindows(s.weatherEvents); } catch (e) { errors.push(e.message); }
  try { validateWeatherWeeks(s.weatherWeeks); } catch (e) { errors.push(e.message); }
  if (s.useKnownWeather != null && typeof s.useKnownWeather !== 'boolean') errors.push('Announced-weather selection must be boolean.');
  if (s.weatherEvents?.length && Array.isArray(s.weatherPath) && s.weatherPath.some(row => row && ![5000, 8000, 10000, 12000, 15000].includes(row.multiplier_bps))) errors.push('With events, weatherPath must contain ordinary weekly multipliers to avoid applying an event twice.');
  const blank = value => value == null || (typeof value === 'string' && value.trim() === '');
  // Outside weight is an optional ceiling/limit scenario. An omitted value is
  // the honest zero assumption; growth and downtime remain explicit inputs.
  for (const key of ['externalWeight', 'annualGrowthPct', 'downtimeHours']) {
    if (key === 'externalWeight' && blank(s[key])) continue;
    if (blank(s[key]) || !Number.isFinite(Number(s[key])) || Number(s[key]) < 0) errors.push(`${key} must be an explicit nonnegative assumption.`);
  }
  if (Number(s.externalWeight) > 1e9 || Number(s.annualGrowthPct) > 1000 || Number(s.downtimeHours) > 8760) errors.push('Scenario values exceed supported bounds.');
  if (![5000, 8000, 10000, 12000, 15000].includes(Number(s.weatherBps))) errors.push('Choose an ordinary weekly weather assumption.');
  for (const key of ['carryCrop', 'granaryCrop', 'buyPrice', 'sellPrice', 'extraBudget', 'claimFee', 'upgradeFee', 'plantFee', 'transferFee', 'buyFee', 'nftTransferFee', 'nftBasis', 'nftTerminal']) {
    if (s[key] != null && s[key] !== '') try { units(s[key]); } catch { errors.push(`${key} must be a nonnegative decimal.`); }
  }
  for(const key of ['carryCrop','granaryCrop']) if(s[key]===''||(s.rewardStateBasis==='observed'&&s[key]==null)) errors.push(`${key} must be an explicit nonnegative reward balance.`);
  if (s.rewardStateBasis != null && !['assumption', 'observed'].includes(s.rewardStateBasis)) errors.push('Choose an explicit reward-state basis.');
  if(s.rewardStateBasis==='observed') {
    const observed=Date.parse(s.rewardObservedAt),start=Date.parse(s.start);
    if(!Number.isFinite(observed)) errors.push('Observed reward state needs its UTC observation timestamp.');
    else if(!(observed<=GENESIS*1000&&start<=GENESIS*1000)&&Math.abs(start-observed)>60000) errors.push('Observed carry and Granary belong to their read timestamp. Refresh for this start, or label the balances as assumptions.');
  }
  if (!['unknown', 'zero', 'estimated'].includes(s.feeMode)) errors.push('Unknown fee mode.');
  if (!['keep', 'before', 'after'].includes(s.walletMode)) errors.push('Unknown wallet strategy.');
  for (const key of ['allowTransfers', 'includeOpeningCrop']) if (typeof s[key] !== 'boolean') errors.push(`${key} must be boolean.`);
  if (!Number.isInteger(Number(s.claimEveryDays)) || Number(s.claimEveryDays) < 1 || Number(s.claimEveryDays) > 365) errors.push('Claim cadence must be 1–365 days.');
  for (const [key, field] of [['weatherPath', 'multiplier_bps'], ['externalWeightPath', 'weight_bps']]) {
    if (!Array.isArray(s[key])) { errors.push(`${key} must be an array.`); continue; }
    let previous = -1;
    for (const row of s[key]) {
      if (!row || typeof row !== 'object') { errors.push(`${key}: invalid schedule row.`); continue; }
      if (!Number.isInteger(row.day) || row.day < 0 || row.day > 365 || row.day <= previous || !Number.isSafeInteger(row[field]) || row[field] < 0 || row[field] > 1e13 || (key === 'weatherPath' && row[field] > 20000)) errors.push(`${key}: use unique ascending integer days and valid nonnegative BPS.`);
      previous = row.day;
    }
  }
  return errors;
}
