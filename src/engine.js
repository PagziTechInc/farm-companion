import { UNIT, DAY, YEAR, GENESIS, units, weight, levelCost, clone, rules, validatePortfolio, validateScenario } from './model.js';
import { eventWindows, eventMultiplier } from './weather.js';

const ceilDiv = (a, b) => (a + b - 1n) / b;
const price = (s, key) => s[key] === '' || s[key] == null ? null : units(s[key]);
const feesFor = s => Object.fromEntries(['claim', 'upgrade', 'plant', 'transfer', 'buy', 'nftTransfer'].map(k => [k, s.feeMode === 'zero' ? 0n : price(s, k + 'Fee')]));
const ownWeight = state => state.wallets.reduce((sum, w) => sum + w.plots.reduce((a, p) => a + (p.active ? weight(p.tier, p.level) : 0), 0), 0);
const NOMINAL_WEEK_SECONDS = 7 * 24 * 60 * 60;
const nominalWeeklyRate = units(rules.emissions.nominal_crop_per_weight_week);
const nonnegativeInteger = value => {
  if (typeof value === 'bigint') return value > 0n ? value : 0n;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? BigInt(number) : 0n;
};
const blank = value => value == null || (typeof value === 'string' && value.trim() === '');
const externalWeightBps = value => blank(value) ? 0 : Number(value) * 10000;

// The Almanac's nominal rate is an own-weight rate. Keep this helper shared by
// settlement, forecasts and diagnostics so every caller uses the same integer
// floor as the reviewed source model.
export function nominalCropForWeight(weightBps, seconds) {
  const weight = nonnegativeInteger(weightBps), duration = nonnegativeInteger(seconds);
  return nominalWeeklyRate * weight * duration / (10000n * BigInt(NOMINAL_WEEK_SECONDS));
}

export function nominalCropForSegment(weightBps, segment) {
  if (!segment || segment.seconds <= 0 || segment.multiplier_bps <= 0) return 0n;
  return nominalCropForWeight(weightBps, segment.seconds) * BigInt(Math.trunc(segment.multiplier_bps)) / 10000n;
}

export function nominalCropForRows(rows, weightBps) {
  return (rows ?? []).reduce((total, row) => total + (row.segments ?? []).reduce((sum, segment) => sum + nominalCropForSegment(weightBps, segment), 0n), 0n);
}

// Schedule is a ceiling, not the farm faucet. The reviewed source keeps unused
// base budget in carry and pays a nominal per-weight rate below that ceiling.
export function emissionBetween(start, end) {
  let total = 0n;
  rules.emissions.annual_budgets_crop.forEach((budget, i) => {
    const a = Math.max(start, GENESIS + i * YEAR), b = Math.min(end, GENESIS + (i + 1) * YEAR);
    if (b > a) total += units(budget) / BigInt(YEAR) * BigInt(Math.floor(b - a));
  });
  return total;
}
// Pure proportional allocation helpers. Call rewardProjection for actual rewards.
export function share(flow, ours, external) {
  const total = ours + external;
  return total === 0 ? 0n : flow * BigInt(ours) / BigInt(total);
}
export function marginalYield(flow, ours, external, delta) {
  return share(flow, ours + delta, external) - share(flow, ours, external);
}
export function soilMultiplier(timestamp) {
  for (const phase of rules.emissions.first_soil ?? []) {
    if (timestamp >= Date.parse(phase.start_utc) / 1000 && timestamp < Date.parse(phase.end_utc) / 1000) return phase.multiplier_bps;
  }
  return 10000;
}
function weatherAtStart(s, timestamp, windows = eventWindows(s.weatherEvents)) {
  const start = Math.floor(Date.parse(s.start) / 1000);
  let weather = Number(s.weatherBps);
  const elapsedDay = Math.floor((timestamp - start) / DAY);
  for (const row of s.weatherPath ?? []) if (row.day <= elapsedDay) weather = row.multiplier_bps;
  if (s.useKnownWeather && timestamp >= GENESIS) {
    const epoch = Math.floor((timestamp - GENESIS) / (7 * DAY));
    const known = (s.weatherWeeks ?? []).find(row => row.epoch === epoch);
    if (known) weather = known.multiplier_bps;
  }
  for (const window of windows) if (window.start <= timestamp && window.end > timestamp) weather = eventMultiplier(weather);
  return weather;
}
const inEmissionSchedule = timestamp => timestamp >= GENESIS && timestamp < GENESIS + 4 * YEAR;

// Return the instantaneous start-of-forecast rate extrapolated over hour/day/
// week. It carries the current dated weather and First Soil multipliers, while
// the finite schedule and Granary limits remain in the period projection.
export function harvestRateAtStart(s, activeWeightBps) {
  const at = Math.floor(Date.parse(s.start) / 1000), windows = eventWindows(s.weatherEvents);
  const weather = weatherAtStart(s, at, windows), firstSoil = soilMultiplier(at);
  const combined = Math.floor(weather * firstSoil / 10000);
  const active = inEmissionSchedule(at);
  const own = Number(activeWeightBps), ownWeightBps = Number.isSafeInteger(own) && own > 0 ? own : 0;
  const base = seconds => active ? nominalCropForWeight(ownWeightBps, seconds) : 0n;
  const adjusted = seconds => base(seconds) * BigInt(combined) / 10000n;
  return { at_utc: new Date(at * 1000).toISOString(), active_weight_bps: ownWeightBps,
    nominal_weekly_crop_wei: adjusted(NOMINAL_WEEK_SECONDS), nominal_daily_crop_wei: adjusted(86400), nominal_hourly_crop_wei: adjusted(3600),
    weather_multiplier_bps: weather, first_soil_multiplier_bps: firstSoil, combined_multiplier_bps: combined };
}
export function rewardState(s) {
  return { carry: units(s.carryCrop ?? '0'), granary: units(s.granaryCrop ?? rules.emissions.initial_granary_crop) };
}
export function timeline(s, days) {
  const start = Math.floor(Date.parse(s.start) / 1000), windows = eventWindows(s.weatherEvents);
  const weeks = s.useKnownWeather ? s.weatherWeeks ?? [] : [];
  const announced = new Map(weeks.map(w => [w.epoch, w.multiplier_bps]));
  let m = Number(s.weatherBps), explicitExternal = null;
  const fixed = [GENESIS, ...Array.from({length:4},(_,i)=>GENESIS+(i+1)*YEAR), ...(rules.emissions.first_soil ?? []).flatMap(p=>[Date.parse(p.start_utc)/1000,Date.parse(p.end_utc)/1000]), ...weeks.flatMap(w=>[GENESIS+w.epoch*7*DAY,GENESIS+(w.epoch+1)*7*DAY]), ...windows.flatMap(w=>[w.start,w.end])];
  return Array.from({ length: days }, (_, d) => {
    const wx = (s.weatherPath ?? []).find(x => x.day === d); if (wx) m = wx.multiplier_bps;
    const ext = (s.externalWeightPath ?? []).find(x => x.day === d); if (ext) explicitExternal = ext.weight_bps;
    const external = explicitExternal ?? Math.round(externalWeightBps(s.externalWeight) * Math.pow(1 + Number(s.annualGrowthPct ?? 0) / 100, Math.floor(d / 30) * 30 / 365));
    const a = start+d*DAY, b=a+DAY, points=[a,...fixed.filter(t=>t>a&&t<b),b].sort((x,y)=>x-y), segments=[];
    for(let i=1;i<points.length;i++) {
      const from=points[i-1],to=points[i]; if(to<=from||from<GENESIS||from>=GENESIS+4*YEAR)continue;
      let weather=announced.get(Math.floor((from-GENESIS)/(7*DAY)))??m; for(const w of windows)if(w.start<=from&&w.end>from)weather=eventMultiplier(weather);
      segments.push({start:from,end:to,seconds:to-from,schedule:emissionBetween(from,to),multiplier_bps:weather*soilMultiplier(from)/10000});
    }
    // flow is the multiplier-adjusted ceiling only; actual rewards require weight,
    // carry and Granary. Kept as a diagnostic for existing exported consumers.
    return {day:d,external,segments,flow:segments.reduce((n,r)=>n+r.schedule*BigInt(r.multiplier_bps)/10000n,0n)};
  });
}
export function settleReward(row, totalWeight, opening) {
  let {carry,granary}=opening, amount=0n, base=0n, nominal=0n, baseLimited=false, bonusLimited=false;
  for(const segment of row.segments) {
    carry+=segment.schedule;
    const segmentNominal=nominalCropForWeight(totalWeight, segment.seconds);
    nominal+=segmentNominal;
    const available=carry;
    const earnedBase=segmentNominal<available?segmentNominal:available;
    if (segmentNominal > available) baseLimited=true;
    carry-=earnedBase; base+=earnedBase;
    const target=earnedBase*BigInt(segment.multiplier_bps)/10000n;
    if(target>=earnedBase){const requested=target-earnedBase; if (requested > granary) bonusLimited=true; const extra=requested<granary?requested:granary;amount+=earnedBase+extra;granary-=extra;}
    else{amount+=target;granary+=earnedBase-target;}
  }
  return {amount,base,carry,granary,nominal_crop_wei:nominal,base_limited:baseLimited,bonus_limited:bonusLimited};
}
export function rewardProjection(rows, ours, opening) {
  let state={...opening}, earned=0n, nominal=0n, baseLimited=false, bonusLimited=false;const daily=[];
  for(const row of rows){
    const settled=settleReward(row,ours+row.external,state);state={carry:settled.carry,granary:settled.granary};
    const crop=share(settled.amount,ours,row.external), rowNominal=nominalCropForRows([row],ours);
    // A zero-weight portfolio has no own harvest to limit, even when an
    // optional outside scenario settles the rest of the valley.
    const rowBaseLimited=ours>0&&settled.base_limited, rowBonusLimited=ours>0&&settled.bonus_limited;
    earned+=crop; nominal+=rowNominal; baseLimited ||= rowBaseLimited; bonusLimited ||= rowBonusLimited;
    daily.push({day:row.day,crop_wei:crop,farm_crop_wei:settled.amount,carry:state.carry,granary:state.granary,
      nominal_crop_wei:rowNominal,base_limited:rowBaseLimited,bonus_limited:rowBonusLimited});
  }
  return {earned,daily,nominal_crop_wei:nominal,projected_crop_wei:earned,base_limited:baseLimited,bonus_limited:bonusLimited,...state};
}
function init(portfolio, s, days, funding, budgetFraction, policy) {
  const holding = policy === 'hold';
  const fees = feesFor(holding ? { ...s, feeMode: 'zero' } : s), buyPrice = price(s, 'buyPrice');
  if (Object.values(fees).some(v => v === null)) throw new Error('Enter all six estimated action costs or explicitly select zero wallet-paid gas.');
  if (Object.values(fees).some(v => v > 0n) && portfolio.wallets.some(w => w.eth_balance_wei == null)) throw new Error('ETH balances are required to check wallet-paid fee funding.');
  if (!holding && funding === 'extra' && (!buyPrice || price(s, 'extraBudget') == null)) throw new Error('Extra investment requires a positive all-in buy price and a budget cap.');
  let claimClock = null;
  if (s.claimClock != null) {
    if (typeof s.claimClock !== 'object' || Array.isArray(s.claimClock)) throw new Error('Claim clocks must map wallet IDs to UTC timestamps.');
    claimClock = {};
    for (const w of portfolio.wallets) {
      const at = Object.hasOwn(s.claimClock, w.id) ? s.claimClock[w.id] : s.start;
      if (typeof at !== 'string' || !at.endsWith('Z') || !Number.isFinite(Date.parse(at))) throw new Error(`Claim clock for ${w.id} must be a valid UTC timestamp.`);
      claimClock[w.id] = Math.floor(Date.parse(at) / 1000);
    }
  }
  const start = Math.floor(Date.parse(s.start) / 1000);
  return { reward: rewardState(s), day: 0, days, fees, buyPrice, sellPrice: price(s, 'sellPrice'), funding, budgetFraction,
    budget: !holding && funding === 'extra' ? price(s, 'extraBudget') * BigInt(budgetFraction) / 100n : 0n,
    wallets: portfolio.wallets.map(w => ({ id: w.id, label: w.label, liquid: BigInt(w.crop_balance_wei), opening: BigInt(w.crop_balance_wei), eth: BigInt(w.eth_balance_wei ?? '0'), eth_balance_known: w.eth_balance_wei != null, eth_costs_complete: true, plots: w.plots.map(p => ({ id: p.token_id, tier: p.rarity_tier, level: p.level, active: p.is_active, pending: BigInt(p.pending_crop_wei) })) })),
    start, claimClock, claimEveryDays: Number(s.claimEveryDays),
    earned: 0n, spent: 0n, plantSpent: 0n, bought: 0n, initialBought: 0n, invested: 0n, purchaseCost: 0n, gas: 0n, actions: [], curve: [], blocked: [], allowTransfers: s.allowTransfers, includeOpeningCrop: s.includeOpeningCrop,
    originalEth: portfolio.wallets.reduce((sum, w) => sum + BigInt(w.eth_balance_wei ?? '0'), 0n),
    originalOpening: portfolio.wallets.reduce((a, w) => a + BigInt(w.crop_balance_wei) + w.plots.reduce((b, p) => b + BigInt(p.pending_crop_wei), 0n), 0n) };
}
function charge(state, w, kind, count = 1) {
  const fee = state.fees[kind] * BigInt(count);
  if (w.eth < fee) throw new Error(`${w.label} lacks ETH for ${kind} costs.`);
  w.eth -= fee; state.gas += fee;
}
function log(state, type, wallet, data = {}) {
  const action = { day: state.day, type, wallet_id: wallet.id, ...data };
  if (state.claimClock) action.due_at_utc = new Date((state.start + state.day * DAY) * 1000).toISOString();
  state.actions.push(action);
}
function claim(state, w) {
  const total = w.plots.reduce((a, p) => a + p.pending, 0n);
  if (!total) return;
  charge(state, w, 'claim');
  w.liquid += total; w.plots.forEach(p => { p.pending = 0n; });
  if (state.claimClock) state.claimClock[w.id] = state.start + state.day * DAY;
  log(state, 'claim', w, { crop_wei: total.toString() });
}
function scheduledClaim(state, w, at) {
  if (!state.claimClock || at < state.claimClock[w.id] + state.claimEveryDays * DAY) return;
  if (!w.plots.some(p => p.pending > 0n)) return;
  // charge() checks affordability before mutating state, so a fee failure leaves
  // the simulated balance and pending rewards intact for the rest of this path.
  try { claim(state, w); } catch (e) { if (!state.blocked.includes(e.message)) state.blocked.push(e.message); }
}
function purchase(state, w, amount, initial = false) {
  if (!amount) return;
  charge(state, w, 'buy');
  const cost = state.buyPrice == null ? null : ceilDiv(amount * state.buyPrice, UNIT);
  if (!initial && (cost === null || cost > state.budget)) throw new Error('Extra investment cap cannot fund this purchase.');
  if (cost != null) {
    if (cost > 0n && !w.eth_balance_known) throw new Error(`${w.label} ETH balance is unknown; CROP purchase affordability cannot be checked.`);
    if (w.eth < cost) throw new Error(`${w.label} lacks ETH for the CROP purchase after its buy fee; fund this wallet or reduce the investment.`);
    w.eth -= cost;
  } else {
    w.eth_costs_complete = false;
    const note = 'Initial planting purchases are unpriced; ETH affordability and remaining ETH are conditional until a buy quote is supplied.';
    if (!state.blocked.includes(note)) state.blocked.push(note);
  }
  if (!initial) { state.budget -= cost; state.invested += cost; }
  else state.initialBought += amount;
  state.purchaseCost = cost == null || state.purchaseCost == null ? null : state.purchaseCost + cost;
  state.bought += amount; w.liquid += amount;
  log(state, 'buy', w, { crop_wei: amount.toString(), eth_wei: cost?.toString() ?? null, initial_planting: initial });
}
function moveNFTs(state) {
  const [target, source] = state.wallets;
  if(state.wallets.length !== 2) throw new Error('Consolidation comparison requires exactly two wallets.');
  for (const p of source.plots) {
    charge(state, source, 'nftTransfer'); p.active = false;
    log(state, 'move_plot', source, { plot_id: p.id, to_wallet: target.id, requires_planting: true });
    target.plots.push(p);
  }
  source.plots = [];
}
function plantDormant(state) {
  for (const w of state.wallets) {
    const dormant = w.plots.filter(p => !p.active);
    if (!dormant.length) continue;
    const needed = BigInt(dormant.length) * units(rules.planting.cost_crop);
    if (state.allowTransfers && w.liquid < needed) for (const other of state.wallets.filter(x => x !== w)) {
      const reserve = BigInt(other.plots.filter(p => !p.active).length) * units(rules.planting.cost_crop);
      const spare = other.liquid - reserve;
      const moved = spare < needed - w.liquid ? spare : needed - w.liquid;
      if (moved <= 0n) continue;
      charge(state, other, 'transfer'); other.liquid -= moved; w.liquid += moved;
      if (other.opening > other.liquid) other.opening = other.liquid;
      log(state, 'transfer_crop', other, { to_wallet: w.id, crop_wei: moved.toString(), for_planting: true });
    }
    if (w.liquid < needed) purchase(state, w, needed - w.liquid, true);
    for (const p of dormant) {
      charge(state, w, 'plant'); p.active = true;
      w.liquid -= units(rules.planting.cost_crop); state.spent += units(rules.planting.cost_crop); state.plantSpent += units(rules.planting.cost_crop);
      if (w.opening > w.liquid) w.opening = w.liquid;
      log(state, 'plant', w, { plot_id: p.id, crop_wei: units(rules.planting.cost_crop).toString() });
    }
  }
}
function fund(state, index, needed) {
  const w = state.wallets[index];
  const available = wallet => wallet.liquid - (state.includeOpeningCrop ? 0n : wallet.opening);
  if (available(w) < needed) claim(state, w);
  if (available(w) < needed && state.allowTransfers) {
    for (const other of state.wallets.filter(x => x !== w)) {
      if (available(w) >= needed) break;
      if (available(other) < needed - available(w)) claim(state, other);
      const usable = available(other);
      const transfer = usable < needed - available(w) ? usable : needed - available(w);
      if (transfer <= 0n) continue;
      charge(state, other, 'transfer'); other.liquid -= transfer; w.liquid += transfer;
      log(state, 'transfer_crop', other, { to_wallet: w.id, crop_wei: transfer.toString() });
    }
  }
  if (available(w) < needed && state.funding === 'extra') purchase(state, w, needed - available(w));
  if (available(w) < needed) throw new Error('Insufficient claimed harvest funding.');
}
function applyPath(state, walletIndex, plotIndex, target) {
  const w = state.wallets[walletIndex], p = w.plots[plotIndex];
  let cost = 0n;
  for (let level = p.level + 1; level <= target; level++) cost += levelCost(level);
  fund(state, walletIndex, cost);
  for (let level = p.level + 1; level <= target; level++) {
    charge(state, w, 'upgrade'); const step = levelCost(level);
    w.liquid -= step; state.spent += step; p.level = level;
    log(state, 'upgrade', w, { plot_id: p.id, to_level: level, crop_wei: step.toString() });
  }
}
function pickAction(state, rows, policy, objective) {
  const ours = ownWeight(state), tail = rows.slice(state.day), candidates = [], gains = new Map();
  const baseline = rewardProjection(tail, ours, state.reward).earned;
  for (let wi = 0; wi < state.wallets.length; wi++) {
    const w = state.wallets[wi];
    for (let pi = 0; pi < w.plots.length; pi++) {
      const p = w.plots[pi]; if (!p.active) continue;
      let cost = 0n;
      for (let target = p.level + 1; target <= 5; target++) {
        cost += levelCost(target);
        const delta = weight(p.tier, target) - weight(p.tier, p.level);
        if(!gains.has(delta)) gains.set(delta,rewardProjection(tail,ours+delta,state.reward).earned-baseline);
        const gain=gains.get(delta);
        const net = gain - cost;
        if (objective === 'crop' && net <= 0n) continue;
        // Cheap feasibility prefilter; exact wallet/fee routing is checked on a cloned state below.
        const harvest = state.wallets.reduce((a, v) => a + v.liquid - (state.includeOpeningCrop ? 0n : v.opening) + v.plots.reduce((b, x) => b + x.pending, 0n), 0n);
        const capacity = harvest + (state.buyPrice ? state.budget * UNIT / state.buyPrice : 0n);
        if (cost > capacity) continue;
        let score = net;
        if (objective === 'eth' && state.sellPrice != null) {
          const cheapest = state.buyPrice != null && state.buyPrice < state.sellPrice ? state.buyPrice : state.sellPrice;
          score = (gain * state.sellPrice - cost * cheapest) / UNIT - state.fees.upgrade * BigInt(target - p.level);
        }
        if (score > 0n) candidates.push({ wi, pi, target, cost, gain, score, ratio: score * UNIT / cost });
      }
    }
  }
  candidates.sort((a, b) => {
    const av = policy === 'efficiency' ? a.ratio : a.score, bv = policy === 'efficiency' ? b.ratio : b.score;
    return av > bv ? -1 : av < bv ? 1 : a.wi - b.wi || a.pi - b.pi || a.target - b.target;
  });
  for (const c of candidates) {
    const trial = clone(state);
    try { applyPath(trial, c.wi, c.pi, c.target); } catch { continue; }
    if (objective === 'eth' && state.sellPrice != null) {
      if (trial.purchaseCost == null || state.purchaseCost == null) continue;
      const gain = (c.gain - c.cost + trial.bought - state.bought) * state.sellPrice / UNIT;
      if (gain - (trial.purchaseCost - state.purchaseCost) - (trial.gas - state.gas) <= 0n) continue;
    }
    return trial;
  }
  return null;
}
export function simulate(portfolio, s, { days = 90, funding = 'harvest', policy = 'efficiency', objective = 'crop', budgetFraction = 100 } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 365) return { status: 'unavailable', errors: ['Supported horizons are 1–365 whole days.'] };
  const errors = [...validatePortfolio(portfolio), ...validateScenario(s)];
  if (errors.length) return { status: 'unavailable', errors };
  let state;
  try {
    state = init(portfolio, s, days, funding, budgetFraction, policy);
    if (policy !== 'hold' && s.walletMode !== 'keep' && state.wallets.length !== 2) throw new Error('Consolidation comparison requires exactly two wallets.');
    const activeMoved = state.wallets[1]?.plots.some(p => p.active);
    if (policy !== 'hold' && s.walletMode === 'before' && activeMoved) throw new Error('Before-plant consolidation is incompatible with already active plots in wallet B.');
  } catch (e) { return { status: 'unavailable', errors: [e.message] }; }
  const rows = timeline(s, days), start = Math.floor(Date.parse(s.start) / 1000);
  const setupDay = Math.max(0, Math.ceil((GENESIS - start) / DAY));
  for (let d = 0; d < days; d++) {
    state.day = d;
    if (policy !== 'hold' && state.claimClock) {
      for (const w of state.wallets) scheduledClaim(state, w, start + d * DAY);
    }
    if (d === setupDay && policy !== 'hold') {
      try {
        if (s.walletMode === 'before') moveNFTs(state);
        plantDormant(state);
        if (s.walletMode === 'after') { moveNFTs(state); plantDormant(state); }
      } catch (e) { return { status: 'unavailable', errors: [e.message] }; }
    }
    if (policy !== 'baseline' && policy !== 'hold' && start + d * DAY >= GENESIS) {
      for (let action = 0; action < portfolio.wallets.reduce((n,w)=>n+w.plots.length,0)*4; action++) {
        const next = pickAction(state, rows, policy, objective); if (!next) break;
        state = next;
      }
    }
    const ours = ownWeight(state);
    const unavailableSeconds = policy !== 'hold' && s.walletMode !== 'keep' && d >= setupDay ? Math.max(0, Math.min(DAY, Number(s.downtimeHours) * 3600 - (d - setupDay) * DAY)) : 0;
    // Conservative portfolio-wide downtime assumption, explicitly shown in the UI.
    const settled = settleReward(rows[d], ours + rows[d].external, state.reward);
    state.reward={carry:settled.carry,granary:settled.granary};
    const flow = settled.amount * BigInt(Math.round(DAY - unavailableSeconds)) / BigInt(DAY);
    for (const w of state.wallets) for (const p of w.plots) {
      const earned = p.active && ours + rows[d].external > 0 ? flow * BigInt(weight(p.tier, p.level)) / BigInt(ours + rows[d].external) : 0n;
      p.pending += earned; state.earned += earned;
    }
    state.day = d + 1;
    if (policy !== 'hold' && state.claimClock) {
      for (const w of state.wallets) scheduledClaim(state, w, start + state.day * DAY);
    } else if (policy !== 'hold' && ((d + 1) % Number(s.claimEveryDays) === 0 || d === days - 1)) {
      for (const w of state.wallets) {
        const trial = clone(state); const tw = trial.wallets.find(x => x.id === w.id);
        try { claim(trial, tw); state = trial; } catch (e) { if (!state.blocked.includes(e.message)) state.blocked.push(e.message); }
      }
    }
    if (d % 7 === 0 || d === days - 1) state.curve.push({ day: d + 1, earned_wei: state.earned.toString(), net_crop_wei: (state.earned - state.spent).toString() });
  }
  const net = state.earned - state.spent;
  const end = state.wallets.reduce((a, w) => a + w.liquid + w.plots.reduce((b, p) => b + p.pending, 0n), 0n);
  if (end !== state.originalOpening + state.bought + net) throw new Error('CROP ledger failed conservation.');
  const remainingEth = state.wallets.reduce((sum, w) => sum + w.eth, 0n);
  if (state.purchaseCost != null && remainingEth !== state.originalEth - state.purchaseCost - state.gas) throw new Error('ETH ledger failed conservation.');
  const sell = state.sellPrice;
  const operating = sell == null || state.purchaseCost == null ? null : (net + state.bought) * sell / UNIT - state.purchaseCost - state.gas;
  const nftBasis = price(s, 'nftBasis'), nftTerminal = price(s, 'nftTerminal');
  return { status: 'ok', days, funding, policy, objective, budget_fraction: budgetFraction, net_crop_wei: net, earned_crop_wei: state.earned, spent_crop_wei: state.spent,
    bought_crop_wei: state.bought, planting_crop_wei: state.plantSpent, initial_planting_purchases_crop_wei: state.initialBought, extra_investment_eth_wei: state.invested, gas_eth_wei: state.gas,
    ending_crop_wei: end, operating_eth_wei: operating, purchase_cost_eth_wei: state.purchaseCost,
    funding_ready: state.purchaseCost != null, funding_status: state.purchaseCost == null ? 'conditional_unknown_purchase_price' : 'covered_by_input_balances',
    remaining_eth_wei: state.purchaseCost == null || state.wallets.some(w => !w.eth_balance_known) ? null : remainingEth,
    liquid_crop_wei: state.wallets.reduce((a, w) => a + w.liquid, 0n), pending_crop_wei: state.wallets.reduce((a, w) => a + w.plots.reduce((b, p) => b + p.pending, 0n), 0n),
    cash_recovery_eth_wei: state.purchaseCost == null ? null : -state.purchaseCost - state.gas,
    total_eth_wei: operating != null && nftBasis != null && nftTerminal != null ? operating + nftTerminal - nftBasis : null,
    ending_carry_crop_wei:state.reward.carry, ending_granary_crop_wei:state.reward.granary, actions: state.actions, wallets: state.wallets, curve: state.curve, blocked: state.blocked,
    assumptions: [policy === 'hold' ? 'Hold preserves current holdings and activation; no planting, upgrades, claims, purchases or transfers occur.' : 'Daily decision grid; full affordable upgrade paths evaluated.', 'Best among tested policies and budget fractions, not a global optimum.', 'Your active weight determines the nominal rate; outside weight is an optional scenario for annual-ceiling and finite-Granary limits.', 'Nominal 2,000 CROP per weight per week is capped by released schedule plus carry. Weather cap is 2× before First Soil, with bonuses limited to remaining Granary.', '365-day years, First Soil boundaries, carry and Granary depletion are modeled; daily rounding does not reproduce every contract accumulator floor.', 'No NFT resale premium, supply benefit or raffle winnings inferred.', policy === 'hold' ? 'Rewards remain pending. No transaction fees are incurred in the hold scenario; future claim costs are not paid or inferred.' : s.feeMode === 'zero' ? 'Explicit zero wallet-paid gas assumption.' : 'User-supplied all-in action fee estimates.', 'Quoted CROP purchases and fees debit the wallet that pays; the extra-investment cap does not create additional ETH.', ...(state.purchaseCost == null ? ['Unpriced initial planting is a conditional CROP forecast, not confirmation that current ETH funds the plan. Wallet ETH excludes unknown purchase costs.'] : []), ...(state.claimClock ? ['Claims follow saved wallet cadence anchors, checked on the daily grid. Funding claims reset that wallet’s simulated cadence. Future due times may be rounded to the next grid boundary; no early terminal claim is forced.'] : []), 'Operating ETH excludes existing NFT basis and opening token price changes; prices include trade fees/slippage.'] };
}
export function compare(portfolio, s, horizons = [30, 90, 365]) {
  const results = [];
  for (const days of horizons) {
    const baseline = simulate(portfolio, s, { days, policy: 'baseline' });
    const hold = simulate(portfolio, s, { days, policy: 'hold' });
    for (const funding of ['harvest', 'extra']) {
      const candidates = [baseline, hold];
      if (baseline.status === 'ok') for (const objective of ['crop', 'eth']) {
        if (objective === 'eth' && !s.sellPrice) continue;
        for (const policy of ['efficiency', 'net_gain']) for (const fraction of funding === 'extra' ? [25, 50, 100] : [100]) {
          candidates.push(simulate(portfolio, s, { days, funding, policy, objective, budgetFraction: fraction }));
        }
      }
      const missingExtra = funding === 'extra' && (!s.buyPrice || !s.extraBudget || units(s.buyPrice) === 0n);
      if (missingExtra) { results.push({ days, funding, status: 'unavailable', errors: ['Enter a positive buy price and an explicit extra-investment cap.'], baseline, hold }); continue; }
      const good = candidates.filter(r => r.status === 'ok');
      // Equal returns do not justify extra fees or unnecessary transactions.
      const best = key => good.filter(r => r[key] != null).reduce((a, b) =>
        !a || b[key] > a[key] || (b[key] === a[key] && (b.gas_eth_wei < a.gas_eth_wei ||
          (b.gas_eth_wei === a.gas_eth_wei && b.actions.length < a.actions.length))) ? b : a, null);
      results.push({ days, funding, status: good.length ? 'ok' : 'unavailable', errors: good.length ? [] : [...new Set([...(baseline.errors ?? []), ...(hold.errors ?? [])])], baseline, hold, bestCrop: best('net_crop_wei'), bestEth: best('operating_eth_wei'), evaluated: good.length });
    }
  }
  return results;
}
