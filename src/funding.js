import { rules, units, UNIT } from './model.js';

export const PRICE_URL = 'https://api.coinbase.com/v2/prices/ETH-USD/spot';
export const fundingDefaults = () => ({ targetUsd: '100', reserveEth: '' });
export function validateFunding(f) {
  if (!f || !Number.isFinite(Number(f.targetUsd)) || Number(f.targetUsd) <= 0 || Number(f.targetUsd) > 1e9) throw new Error('Funding target must be a positive USD amount.');
  if (f.reserveEth !== '') units(f.reserveEth);
  return f;
}
export function validateQuote(q) {
  if (!q || typeof q.eth_usd !== 'string' || !/^\d+(\.\d+)?$/.test(q.eth_usd) || Number(q.eth_usd) <= 0 || Number(q.eth_usd) > 1e6 || !Number.isFinite(Date.parse(q.observed_at_utc)) || q.url !== PRICE_URL) throw new Error('Invalid ETH/USD price observation.');
  return q;
}
export async function readEthQuote(transport) {
  const result = await transport(PRICE_URL);
  if (result.data?.base !== 'ETH' || result.data?.currency !== 'USD') throw new Error('Price feed returned an unexpected currency pair.');
  return validateQuote({ eth_usd: result.data.amount, observed_at_utc: new Date().toISOString(), url: PRICE_URL });
}
export function fundingAdvice(portfolio, config, quote, scenario, now = Date.now()) {
  validateFunding(config); if (quote) validateQuote(quote);
  const fresh = stamp => Number.isFinite(Date.parse(stamp)) && now - Date.parse(stamp) >= -300000 && now - Date.parse(stamp) < 15 * 60000;
  const current = fresh(portfolio.observed_at_utc), priced = quote && fresh(quote.observed_at_utc);
  const price = priced ? Number(quote.eth_usd) : null, target = Number(config.targetUsd);
  const reserve = config.reserveEth === '' ? null : units(config.reserveEth);
  const actions = [];
  if (!current) actions.push({ kind: 'check', title: 'Refresh wallet balances', detail: 'Funding advice needs a wallet observation less than 15 minutes old. Refresh before moving funds.' });
  if (!priced) actions.push({ kind: 'check', title: 'Refresh the ETH/USD price', detail: 'USD funding checks are unavailable until a fresh price is read. Balances below are native ETH on Robinhood Chain only.' });
  const wallets = portfolio.wallets.map(w => {
    const eth = w.eth_balance_wei == null ? null : BigInt(w.eth_balance_wei), crop = w.crop_balance_wei == null ? null : BigInt(w.crop_balance_wei);
    const remainingMints = Math.max(0, (w.expected_plot_count ?? w.plots.length) - w.plots.length);
    const mint = BigInt(remainingMints) * units(rules.plots.mint_price_eth);
    const dormant = w.plots.filter(p => p.is_active === false).length;
    const cropNeeded = BigInt(remainingMints + dormant) * units(rules.planting.cost_crop);
    const cropGap = crop == null ? null : cropNeeded > crop ? cropNeeded - crop : 0n;
    const usd = eth == null || price == null ? null : Number(eth) / Number(UNIT) * price;
    const available = eth == null || reserve == null ? null : eth - mint - reserve;
    if (eth == null) actions.push({kind:'check',title:`${w.label}: balance unavailable`,detail:'Refresh this wallet; an unavailable balance is not zero.'});
    else if (current) {
      if (usd != null && usd < target) actions.push({kind:'action',title:`${w.label}: below your USD target`,detail:`About $${(target-usd).toFixed(2)} below the $${target} target at this price. Review a top-up on Robinhood Chain, allowing for transfer fees.`});
      if (eth < mint) actions.push({kind:'action',title:`${w.label}: mint funding shortfall`,detail:`Needs ${Number(mint-eth)/1e18} more ETH for the remaining planned mint, before network fees.`});
      else if (available != null && available < 0n) actions.push({kind:'action',title:`${w.label}: chosen fee reserve is not covered`,detail:'Reduce the planned spend or fund the reserve before committing to the mint.'});
    }
    return { id:w.id, label:w.label, address:w.address, eth_wei:eth, crop_wei:crop, usd, target_met:current && usd != null ? usd >= target : null,
      remaining_mints:remainingMints, mint_wei:mint, crop_needed_wei:cropNeeded, crop_gap_wei:cropGap, after_mint_wei:eth == null ? null : eth-mint,
      after_reserve_wei:available, fresh:current };
  });
  if (reserve == null) actions.push({kind:'check',title:'Set an ETH reserve for network fees',detail:'Each wallet must retain ETH for minting, CROP purchases and later game actions. Enter your chosen reserve below; no fee estimate has been invented.'});
  const needCrop = wallets.some(w => w.crop_gap_wei == null || w.crop_gap_wei > 0n);
  if (needCrop) actions.push({kind:now < Date.parse(rules.schedule.genesis_utc) ? 'later' : 'action',title:'Price the CROP needed for planting',detail:'CROP planting needs 2,500 CROP per dormant plot; the ETH seed-bag alternative has a separately refreshed price. Buy only against an executable quote when the official pool is available. A $100 ETH balance alone does not establish full planting funding.'});
  if (wallets.some(w=>w.remaining_mints)) actions.push({kind:'later',title:'Mint only through the official launch page',detail:'Published mint opening: September 15, 17:00 UTC. Budget 0.002 ETH per remaining plot before fees; actual sale availability and limits must be checked on the official page.'});
  if (portfolio.wallets.some(w=>w.plots.some(p=>p.rarity_tier == null))) actions.push({kind:'check',title:'Wait for revealed plot traits',detail:'Refresh after reveal before ranking upgrades. Unknown rarity cannot support plot-specific advice.'});
  if (!scenario.buyPrice || !scenario.sellPrice || !scenario.extraBudget || scenario.feeMode === 'unknown') actions.push({kind:'check',title:'Complete the investment assumptions',detail:'Before upgrade advice, enter CROP buy/sell quotes, an extra-investment cap if desired, and fee assumptions in Strategy lab. Your funding target is not automatically an investment budget.'});
  return { wallets, actions, price_usd:price, quote_fresh:!!priced, balances_fresh:current, all_targets_met:wallets.every(w=>w.target_met === true) };
}
