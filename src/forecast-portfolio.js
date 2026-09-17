import reviewed from '../knowledge/reviewed-deployment.json' with { type: 'json' };
import { clone, rules, units, validatePortfolio, weight } from './model.js';

const tierValid = tier => Number.isInteger(tier) && tier >= 0 && tier <= 3;
const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

// A saved observation can support a labeled scenario, never a transaction draft.
function manifestPreviewReady(portfolio, plot) {
  return portfolio.chain_id === reviewed.chain_id && portfolio.nft_runtime_verified === true &&
    sameAddress(portfolio.nft_contract_address, reviewed.contracts.nft.address) &&
    portfolio.manifest_verified === true && portfolio.tiers_finalized === false &&
    Number.isInteger(portfolio.starting_index) && portfolio.starting_index > 0 && portfolio.starting_index < 3333 &&
    Number.isSafeInteger(portfolio.block_number) && portfolio.block_number > 0 &&
    typeof portfolio.observed_at_utc === 'string' && Number.isFinite(Date.parse(portfolio.observed_at_utc)) &&
    plot.block_number === portfolio.block_number && plot.observed_at_utc === portfolio.observed_at_utc &&
    plot.reveal_status === 'revealed' && plot.tiers_finalized === false &&
    plot.rarity_verified === false && tierValid(plot.manifest_rarity_tier) &&
    portfolio.wallets.some(wallet => sameAddress(wallet.address, plot.owner_address) &&
      wallet.plots.some(owned => owned.token_id === plot.token_id));
}

export function forecastPlotTier(portfolio, plot) {
  const watched = portfolio.wallets.some(wallet => wallet.address && wallet.plots.some(owned => owned.token_id === plot.token_id));
  if ((!watched || portfolio.tiers_finalized !== false) && plot.rarity_verified !== false && plot.tiers_finalized !== false && tierValid(plot.rarity_tier)) return plot.rarity_tier;
  return manifestPreviewReady(portfolio, plot) ? plot.manifest_rarity_tier : null;
}

export function isForecastPreview(portfolio) {
  return portfolio?.forecast_preview != null || (Array.isArray(portfolio?.wallets) && portfolio.wallets.some(wallet =>
    Array.isArray(wallet?.plots) && wallet.plots.some(plot => plot?.forecast_preview != null)));
}

export function prepareForecastPortfolio(raw, { assumePlanted = false } = {}) {
  const portfolio = clone(raw), errors = validatePortfolio(portfolio, false);
  const result = { portfolio, mode: 'observed', pending_count: 0, assumed_planted_count: 0,
    planting_cost_crop_wei: '0', errors };
  if (typeof assumePlanted !== 'boolean') errors.push('The planting preview must be enabled or disabled.');
  if (isForecastPreview(raw)) errors.push('Refresh wallets before calculating from an exported forecast preview.');
  if (errors.length) return result;
  const previewed = new Set();
  for (const wallet of portfolio.wallets) for (const plot of wallet.plots) {
    const pending = !!wallet.address && (plot.tiers_finalized === false || plot.rarity_verified === false || portfolio.tiers_finalized === false);
    if (pending) {
      result.pending_count++;
      if (!manifestPreviewReady(portfolio, plot)) {
        errors.push('Refresh wallets to preview revealed traits. On-chain rarity is still pending.');
        continue;
      }
      // Require every economic observation before changing only the scenario's tier/weight.
      if (!Number.isInteger(plot.level) || plot.level < 1 || plot.level > 5 ||
          typeof plot.is_active !== 'boolean' || !Number.isInteger(plot.effective_weight_bps) ||
          plot.pending_crop_wei == null || plot.desired_weight_bps == null || plot.weight_synchronized !== true) {
        errors.push('Some plot details are unavailable. Refresh wallets to finish the forecast.');
        continue;
      }
      plot.rarity_tier = plot.manifest_rarity_tier;
      plot.effective_weight_bps = plot.is_active ? weight(plot.rarity_tier, plot.level) : 0;
      plot.forecast_preview = 'manifest-rarity';
      previewed.add(plot.token_id);
      result.mode = 'manifest-preview';
    }
    if (assumePlanted && plot.is_active === false && tierValid(plot.rarity_tier) &&
        Number.isInteger(plot.level) && plot.level >= 1 && plot.level <= 5) {
      plot.is_active = true;
      plot.effective_weight_bps = weight(plot.rarity_tier, plot.level);
      plot.forecast_preview = pending ? 'manifest-rarity-and-planting' : 'planting';
      result.assumed_planted_count++;
    }
  }
  result.planting_cost_crop_wei = (BigInt(result.assumed_planted_count) * units(rules.planting.cost_crop)).toString();
  if (previewed.size) {
    // Only the obsolete, exact per-plot finalization message can be superseded.
    portfolio.read_errors = (portfolio.read_errors ?? []).filter(message => {
      const match = /^Plot (\d+): rarity assignment is not confirmed finalized\.$/.exec(message);
      return !match || !previewed.has(Number(match[1]));
    });
  }
  if (previewed.size || result.assumed_planted_count) portfolio.forecast_preview = {
    mode: result.mode, pending_count: result.pending_count, assumed_planted_count: result.assumed_planted_count,
    planting_cost_crop_wei: result.planting_cost_crop_wei, planting_funding: 'separate-capital',
    observed_at_utc: raw.observed_at_utc ?? null, block_number: raw.block_number ?? null
  };
  if (!errors.length) errors.push(...validatePortfolio(portfolio));
  result.errors = [...new Set(errors)];
  return result;
}
