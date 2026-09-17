import { rules, UNIT, units, weight, levelCost, validatePortfolio, validateScenario } from './model.js';
import { timeline, rewardProjection, rewardState } from './engine.js';

const DAY = 86400;
const FRESH_MS = 15 * 60 * 1000;
const positive = value => value > 0n ? value : 0n;
const price = (scenario, key) => scenario[key] == null || scenario[key] === '' ? null : units(scenario[key]);
const iso = seconds => new Date(seconds * 1000).toISOString();
const descending = (a, b) => a > b ? -1 : a < b ? 1 : 0;

function fee(scenario, kind) {
  return scenario.feeMode === 'zero' ? 0n : scenario.feeMode === 'estimated' ? price(scenario, `${kind}Fee`) : null;
}

function evaluateOpportunity(plot, wallet, kind, target, cost, delta, ours, rows, setupDay, scenario) {
  let gain = 0n, breakEven = null;
  const before = rewardProjection(rows, ours, rewardState(scenario));
  const after = rewardProjection(rows, ours + delta, rewardState(scenario));
  for (let day = setupDay; day < rows.length; day++) {
    gain += after.daily[day].crop_wei - before.daily[day].crop_wei;
    if (breakEven == null && gain >= cost) breakEven = day + 1;
  }
  const steps = kind === 'plant' ? 1 : target - plot.level;
  const operationFee = fee(scenario, kind);
  const gas = operationFee == null ? null : operationFee * BigInt(steps);
  const buy = price(scenario, 'buyPrice'), sell = price(scenario, 'sellPrice');
  const buyFee = fee(scenario, 'buy');
  const net = gain - cost;
  const boughtCost = buy == null ? null : (cost * buy + UNIT - 1n) / UNIT;
  return {
    type: kind, wallet_id: wallet.id, wallet_label: wallet.label, plot_id: plot.token_id,
    rarity_tier: plot.rarity_tier, from_level: plot.level, to_level: target, steps,
    crop_cost_wei: cost, added_weight_bps: delta, marginal_crop_wei: gain,
    net_crop_wei: net, recovers_crop_cost: gain >= cost, crop_break_even_day: breakEven,
    crop_return_per_token_wei: gain * UNIT / cost,
    first_day_marginal_crop_wei: rows[setupDay] ? after.daily[setupDay].crop_wei - before.daily[setupDay].crop_wei : 0n,
    net_eth_existing_crop_wei: sell == null || gas == null ? null : net * sell / UNIT - gas,
    net_eth_purchased_crop_wei: sell == null || gas == null || boughtCost == null || buyFee == null ? null : gain * sell / UNIT - boughtCost - gas - buyFee,
    purchased_crop_break_even_exit_eth_per_crop_wei: boughtCost == null || gas == null || buyFee == null || gain === 0n ? null : ((boughtCost + gas + buyFee) * UNIT + gain - 1n) / gain,
    direct_fee_eth_wei: gas,
    requires_planting: kind === 'upgrade' && !plot.is_active,
    wallet_liquid_crop_wei: BigInt(wallet.crop_balance_wei),
    wallet_pending_crop_wei: wallet.plots.reduce((sum, p) => sum + BigInt(p.pending_crop_wei), 0n),
    wallet_liquid_shortfall_crop_wei: positive(cost - BigInt(wallet.crop_balance_wei)),
    basis: kind === 'plant' ? 'Current active portfolio; all other dormant plots remain dormant.' : 'All owned plots planted at their current levels; only this upgrade path changes weight.'
  };
}

/** Independent alternatives, not a second optimizer. Never sum their gains or costs into a plan. */
export function strategyInsights(portfolio, scenario, { days = 90, now = Date.now(), selectedResult = null } = {}) {
  const errors = [...validatePortfolio(portfolio), ...validateScenario(scenario)];
  if (!Number.isInteger(days) || days < 1 || days > 365) errors.push('Choose a horizon of 1–365 whole days.');
  const next = guidedNextAction(portfolio, scenario, selectedResult, { now });
  if (errors.length) return { status: 'unavailable', errors: [...new Set(errors)], required_inputs: [...new Set(errors)], planting: [], upgrades: [], rare_first: null, early_entry: [], next_action: next };
  const rows = timeline(scenario, days), start = Math.floor(Date.parse(scenario.start) / 1000);
  const setupDay = Math.max(0, Math.ceil((rules.schedule.genesis_timestamp - start) / DAY));
  const plots = portfolio.wallets.flatMap(wallet => wallet.plots.map(plot => ({ wallet, plot })));
  const activeWeight = plots.reduce((sum, { plot }) => sum + plot.effective_weight_bps, 0);
  const plantedWeight = plots.reduce((sum, { plot }) => sum + weight(plot.rarity_tier, plot.level), 0);
  const planting = [], upgrades = [];
  for (const { wallet, plot } of plots) {
    if (!plot.is_active) planting.push(evaluateOpportunity(plot, wallet, 'plant', plot.level, units(rules.planting.cost_crop), weight(plot.rarity_tier, plot.level), activeWeight, rows, setupDay, scenario));
    let cost = 0n;
    for (let target = plot.level + 1; target <= rules.levels.entries.length; target++) {
      cost += levelCost(target);
      upgrades.push(evaluateOpportunity(plot, wallet, 'upgrade', target, cost, weight(plot.rarity_tier, target) - weight(plot.rarity_tier, plot.level), plantedWeight, rows, setupDay, scenario));
    }
  }
  const efficiency = (a, b) => descending(a.marginal_crop_wei * b.crop_cost_wei, b.marginal_crop_wei * a.crop_cost_wei) || a.plot_id - b.plot_id || a.to_level - b.to_level;
  planting.sort(efficiency); upgrades.sort(efficiency);
  const singleSteps = upgrades.filter(candidate => candidate.steps === 1);
  const rarest = [...singleSteps].sort((a, b) => b.rarity_tier - a.rarity_tier || efficiency(a, b))[0] ?? null;
  const mostEfficient = singleSteps[0] ?? null;
  const rareFirst = rarest ? {
    candidate: rarest, best_next_step: mostEfficient,
    matches_best_efficiency: efficiency(rarest, mostEfficient) === 0 || rarest.marginal_crop_wei * mostEfficient.crop_cost_wei === mostEfficient.marginal_crop_wei * rarest.crop_cost_wei,
    explanation: mostEfficient.net_crop_wei <= 0n
      ? 'Even the most efficient next step does not earn back its CROP burn within this horizon. Check longer horizons and ETH economics before spending.'
      : rarest.plot_id === mostEfficient.plot_id
        ? 'The rarest eligible plot also has the strongest next-step CROP return per token under these assumptions. Affordability and ETH costs still decide whether to act.'
        : 'A cheaper step on another plot can earn more per CROP than the next step on the rarest plot. Compare whole-portfolio gains before concentrating the upgrade budget.'
  } : null;
  const dormantWeight = plantedWeight - activeWeight;
  const current = rewardProjection(rows,activeWeight,rewardState(scenario)), planted = rewardProjection(rows,plantedWeight,rewardState(scenario));
  const earlyEntry = [1, 3, 7].map(delay => ({
    delay_days: delay,
    foregone_crop_wei: rows.slice(setupDay, setupDay + delay).reduce((sum, row) => sum + planted.daily[row.day].crop_wei - current.daily[row.day].crop_wei, 0n),
    modeled_delay_days: Math.max(0, Math.min(delay, days - setupDay))
  }));
  const required = [];
  if (scenario.feeMode === 'unknown') required.push('Set explicit operation fee estimates or a labeled zero-fee scenario to compare ETH returns.');
  if (scenario.feeMode === 'estimated') {
    for (const kind of ['plant', 'upgrade', 'buy']) if (fee(scenario, kind) == null) required.push(`Enter the ${kind} fee estimate for dependent ETH economics.`);
  }
  if (price(scenario, 'buyPrice') == null || price(scenario, 'sellPrice') == null) required.push('Enter all-in CROP buy and net exit prices for ETH economics.');
  return { status: 'ok', errors: [], days, required_inputs: required,
    active_weight_bps: activeWeight, all_planted_weight_bps: plantedWeight,
    planting_cost_crop_wei: BigInt(planting.length) * units(rules.planting.cost_crop),
    evaluation_start_utc: iso(start + setupDay * DAY), planting, upgrades, rare_first: rareFirst,
    early_entry: earlyEntry, next_action: next,
    assumptions: [
      'Each row is an independent alternative; gains cannot be added across rows.',
      'Upgrades are evaluated after all owned plots are planted at their current levels, with no other upgrades.',
      'Ranking uses whole-portfolio marginal CROP return per token under the nominal rate, schedule ceiling, carry and Granary.',
      'Break-even is cumulative extra CROP against the token burn on a daily grid; it excludes gas and NFT resale value.',
      'ETH diagnostics include direct action fees and one buy fee for a purchased path. Claim, transfer and future harvest fees require the strategy ledger.',
      'Delayed planting holds all other actions and forecast paths fixed; foregone CROP is an opportunity cost, not guaranteed realized profit.',
      'These diagnostics do not implement an aggressive rare-first simulation or prove a globally optimal strategy.'
    ] };
}

/** An advisory intent only. Caller must refresh, simulate and request human approval before signing. */
export function guidedNextAction(portfolio, scenario, selectedResult = null, { now = Date.now() } = {}) {
  const response = (status, why, extra = {}) => ({ status, type: null, why, ...extra });
  if (!Number.isFinite(now)) return response('blocked', 'Current time is invalid.');
  const errors = validatePortfolio(portfolio);
  if (errors.length) return response('prepare', 'Refresh actual ownership and revealed plot details before choosing an investment.', { required_inputs: errors });
  if (now < rules.schedule.genesis_timestamp * 1000) return response('wait', 'Prepare planting balances and fee reserves. No modeled planting or upgrade is due before Genesis.', { due_at_utc: rules.schedule.genesis_utc });
  if (portfolio.is_demo || portfolio.is_template) return response('simulation', 'Demo and template plans cannot produce a live wallet action.');
  if (portfolio.wallets.some(wallet => !wallet.address)) return response('prepare', 'All configured public wallet addresses are required to guide a live action.');
  const observed = Date.parse(portfolio.observed_at_utc);
  if (!Number.isFinite(observed) || now - observed > FRESH_MS || observed - now > 60000 || portfolio.block_number == null || portfolio.read_errors?.length) return response('refresh', 'Refresh configured wallets successfully before reviewing a live action.');
  const scenarioErrors = validateScenario(scenario);
  if (scenarioErrors.length) return response('prepare', 'Complete the strategy assumptions first.', { required_inputs: scenarioErrors });
  const start = Date.parse(scenario.start);
  if (start > now) return response('wait', 'This is a future scenario. Its actions are not due yet.', { due_at_utc: scenario.start });
  if (now - start > FRESH_MS) return response('recalculate', 'Recalculate the active plan from the current time; historical scenario actions cannot be replayed.');
  if (!selectedResult || selectedResult.status !== 'ok' || !Array.isArray(selectedResult.actions)) return response('calculate', 'Choose a horizon and funding model, then evaluate the current plan.');
  if (scenario.walletMode !== 'keep' && selectedResult.policy !== 'hold') return response('manual', 'Review the separate wallet-consolidation plan and its replanting cost before any guided action.');
  for (const action of selectedResult.actions) {
    if (!Number.isInteger(action.day) || action.day < 0) return response('recalculate', 'The selected ledger contains an invalid action date.');
    const wallet = portfolio.wallets.find(w => w.id === action.wallet_id);
    if (!wallet) return response('recalculate', 'The selected plan refers to a wallet outside the current portfolio.');
    const plot = wallet.plots.find(p => p.token_id === action.plot_id);
    if (action.type === 'plant' && plot?.is_active) continue;
    if (action.type === 'upgrade' && plot && Number.isInteger(action.to_level) && plot.level >= action.to_level) continue;
    const due = action.due_at_utc==null ? start + action.day * DAY * 1000 : Date.parse(action.due_at_utc);
    if(!Number.isFinite(due))return response('recalculate','The selected ledger contains an invalid due time.');
    if (due > now) return response('wait', 'The next evaluated action depends on future accrual. Refresh and recalculate when it is due.', { due_at_utc: new Date(due).toISOString(), planned_type: action.type });
    const shared = { wallet_id: wallet.id, due_at_utc: new Date(due).toISOString(), source: 'selected_strategy', requires_human_approval: true };
    if (action.type === 'plant' || action.type === 'upgrade') {
      if (!plot) return response('recalculate', 'The selected plot is absent from its recorded wallet.');
      if (action.type === 'upgrade' && (!plot.is_active || action.to_level !== plot.level + 1)) return response('recalculate', 'The current activation or level differs from the next upgrade step.');
      const cost = action.type === 'plant' ? units(rules.planting.cost_crop) : levelCost(plot.level + 1);
      if (BigInt(wallet.crop_balance_wei) < cost) return response('fund', 'This wallet needs spendable CROP before the next investment. Pending rewards must be claimed first.', { ...shared, plot_id: plot.token_id, crop_shortfall_wei: cost - BigInt(wallet.crop_balance_wei) });
      return response('ready_for_review', action.type === 'plant' ? 'Activate this dormant plot so its weight can begin earning.' : 'This is the next affordable step in the selected evaluated strategy.', { ...shared, type: action.type, plot_id: plot.token_id, to_level: action.type === 'upgrade' ? plot.level + 1 : undefined, crop_cost_wei: cost });
    }
    if (action.type === 'claim') {
      const ids = wallet.plots.filter(p => BigInt(p.pending_crop_wei) > 0n).map(p => p.token_id);
      if (!ids.length) return response('recalculate', 'The planned claim has no currently observed pending rewards. Refresh and recalculate.');
      return response('ready_for_review', 'Collect this wallet’s observed pending CROP for the selected plan. Claiming alone does not increase yield.', { ...shared, type: 'claim', plot_ids: ids });
    }
    return response('manual', action.type === 'buy' ? 'Obtain a fresh all-in CROP quote and fund the indicated wallet, then refresh the plan.' : 'Complete the proposed transfer manually after reviewing its cost, then refresh the plan.', { ...shared, planned_type: action.type, crop_wei: action.crop_wei ?? null, to_wallet: action.to_wallet ?? null });
  }
  return response('hold', 'No further action is proposed by this evaluated strategy. Continue monitoring harvest, funding limits and quotes.');
}
