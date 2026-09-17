import {DAY, rules, units, validatePortfolio, validateScenario} from './model.js';
import {rewardProjection, rewardState, share, timeline} from './engine.js';

const sum = values => values.reduce((total, value) => total + value, 0n);
const positive = value => value > 0n ? value : 0n;

// Project the farm only once, then allocate the same settled payout to each
// wallet/plot. Reserves are never replayed separately for each owned plot.
function dailyShare(projection, rows, trackedWeight, selectedWeight) {
  return projection.daily.map((row, index) => share(
    row.farm_crop_wei, selectedWeight, trackedWeight + rows[index].external - selectedWeight,
  ));
}

function walletGoal(wallet, daily, target, goalDays, start) {
  const liquid = BigInt(wallet.crop_balance_wei);
  const pending = sum(wallet.plots.map(plot => BigInt(plot.pending_crop_wei)));
  const current = liquid + pending;
  let accumulated = current, ready = current >= target ? 0 : null;
  for (let day = 0; day < goalDays; day++) {
    accumulated += daily[day];
    if (ready === null && accumulated >= target) ready = day + 1;
  }
  return {
    wallet_id: wallet.id, label: wallet.label,
    liquid_crop_wei: liquid, pending_crop_wei: pending, current_total_crop_wei: current,
    target_crop_wei: target, shortfall_crop_wei: positive(target - current),
    liquid_shortfall_crop_wei: positive(target - liquid),
    ready_in_days: ready,
    ready_at_utc: ready === null ? null : new Date(start + ready * DAY * 1000).toISOString(),
    claim_required: ready !== null && liquid < target,
    funding_status: liquid >= target ? 'ready' : current >= target ? 'claim_first' : ready === null ? 'beyond_horizon' : 'accrue_then_claim',
    earned_crop_wei: accumulated - current, ending_total_crop_wei: accumulated,
  };
}

/**
 * Fixed-holdings companion tools. goalCrop is a desired TOTAL wallet balance,
 * not additional income; each wallet is evaluated independently. Weather rows
 * replace weekly weather for the whole selected term, retaining scenario events.
 * Monetary results stay BigInt. This function performs no reads or transactions.
 */
export function analyzeInsights(portfolio, scenario, {days = 90, goalCrop = '5000', goalDays = 365} = {}) {
  const errors = [...validatePortfolio(portfolio), ...validateScenario(scenario)];
  if (!Number.isInteger(days) || days < 1 || days > 365) errors.push('Choose a harvest term of 1–365 whole days.');
  if (!Number.isInteger(goalDays) || goalDays < 1 || goalDays > 365) errors.push('Choose a goal window of 1–365 whole days.');
  let target, opening;
  try { target = units(goalCrop); } catch { errors.push('Enter a nonnegative total CROP goal with at most 18 decimal places.'); }
  if (!errors.length) try { opening = rewardState(scenario); } catch { errors.push('Enter explicit carry and Granary balances.'); }
  if (errors.length) return {status: 'unavailable', errors: [...new Set(errors)], goals: [], weather: [], plots: [], assumptions: []};

  const start = Date.parse(scenario.start);
  const owned = portfolio.wallets.flatMap(wallet => wallet.plots.map(plot => ({wallet, plot})));
  const trackedWeight = owned.reduce((total, {plot}) => total + (plot.is_active ? plot.effective_weight_bps : 0), 0);
  const rows = timeline(scenario, Math.max(days, goalDays));
  const baseline = rewardProjection(rows, trackedWeight, opening);
  const earned = sum(baseline.daily.slice(0, days).map(row => row.crop_wei));
  const goals = portfolio.wallets.map(wallet => {
    const weight = wallet.plots.reduce((total, plot) => total + (plot.is_active ? plot.effective_weight_bps : 0), 0);
    return walletGoal(wallet, dailyShare(baseline, rows, trackedWeight, weight), target, goalDays, start);
  });
  const plots = owned.map(({wallet, plot}) => {
    const weight = plot.is_active ? plot.effective_weight_bps : 0;
    const daily = dailyShare(baseline, rows, trackedWeight, weight).slice(0, days);
    const earned = sum(daily);
    return {
      wallet_id: wallet.id, label: wallet.label, plot_id: plot.token_id,
      rarity_tier: plot.rarity_tier, level: plot.level, is_active: plot.is_active, weight_bps: weight,
      pending_crop_wei: BigInt(plot.pending_crop_wei), daily_crop_wei: daily[0],
      average_daily_crop_wei: earned / BigInt(days), earned_crop_wei: earned,
    };
  });
  const weather = rules.weather.states.map(state => {
    const alternative = {...scenario, weatherBps: state.multiplier_bps, weatherPath: [], useKnownWeather: false};
    const projection = rewardProjection(timeline(alternative, days), trackedWeight, opening);
    return {
      name: state.name, multiplier_bps: state.multiplier_bps,
      earned_crop_wei: projection.earned, difference_crop_wei: projection.earned - earned,
      ending_carry_crop_wei: projection.carry, ending_granary_crop_wei: projection.granary,
      selected: !scenario.useKnownWeather && !scenario.weatherPath.length && Number(scenario.weatherBps) === state.multiplier_bps,
    };
  });
  return {
    status: 'ok', errors: [], start_utc: scenario.start, days, goal_days: goalDays, goal_crop_wei: target,
    goals, weather, plots, baseline_earned_crop_wei: earned,
    plot_rounding_remainder_crop_wei: earned - sum(plots.map(plot => plot.earned_crop_wei)),
    ending_carry_crop_wei: baseline.daily[days - 1].carry,
    ending_granary_crop_wei: baseline.daily[days - 1].granary,
    assumptions: [
      'Goal means total CROP: current liquid plus pending once, plus future passive harvest. Wallets never pool balances.',
      `Goal dates use whole days from the selected start, through ${goalDays} days. Claims make harvest spendable; fees and ETH funding need separate review.`,
      'Weather cards are alternative whole-term assumptions, not forecasts of future weather. They replace weekly weather but retain the same event assumptions, outside weight and opening carry/Granary.',
      'Plots remain at their entered planting state and level. No spending, transfers or additional reserve deposits are assumed.',
      'Plot shares use integer token units. Their sum can be a few base units below the portfolio total due to daily share rounding; contract accumulator timing may also differ.',
    ],
  };
}
