import test from 'node:test';
import assert from 'node:assert/strict';
import { units, UNIT, GENESIS, YEAR, DAY, defaults, emptyPortfolio, demoPortfolio, weight, validatePortfolio, validateScenario, inputAmount } from '../src/model.js';
import { emissionBetween, marginalYield, simulate, compare, timeline } from '../src/engine.js';

function fixture() {
  const { portfolio, scenario } = demoPortfolio();
  for (const w of portfolio.wallets) for (const p of w.plots) { p.is_active = true; p.effective_weight_bps = weight(p.rarity_tier, p.level); }
  return { portfolio, scenario };
}
test('token conversion preserves individual wei and rejects invalid input', () => {
  assert.equal(units('2500.000000000000000001'), 2500n * UNIT + 1n);
  assert.equal(inputAmount(units('10.0001')), '10.0001');
  for (const v of ['-1', '1e3', 'NaN', '0.0000000000000000001', '', '1'.repeat(91)]) assert.throws(() => units(v));
});
test('missing data cannot become a portfolio forecast', () => {
  const p = emptyPortfolio();
  assert.ok(validatePortfolio(p).length);
  assert.equal(simulate(p, defaults()).status, 'unavailable');
});
test('duplicate IDs, invalid amounts and conflicting owners fail validation', () => {
  const { portfolio: p } = fixture(); p.wallets[1].plots[0].token_id = p.wallets[0].plots[0].token_id;
  assert.match(validatePortfolio(p).join(), /unique/);
  p.wallets[0].crop_balance_wei = 0;
  assert.match(validatePortfolio(p).join(), /integer string/);
});
test('effective modifiers and rule conflicts pause recommendations', () => {
  const { portfolio: p, scenario: s } = fixture(); p.wallets[0].plots[0].effective_weight_bps += 100;
  assert.match(simulate(p, s).errors.join(), /modifiers/);
  p.rule_conflicts = ['Changed plant fee'];
  assert.match(simulate(p, s).errors.join(), /Changed plant fee/);
});
test('emission integration handles Genesis and every year including final stop', () => {
  assert.equal(emissionBetween(GENESIS - DAY, GENESIS), 0n);
  assert.equal(emissionBetween(GENESIS, GENESIS + YEAR), units('380000000') / BigInt(YEAR) * BigInt(YEAR));
  assert.equal(emissionBetween(GENESIS + 2 * YEAR, GENESIS + 3 * YEAR), units('95000000') / BigInt(YEAR) * BigInt(YEAR));
  assert.equal(emissionBetween(GENESIS + 3 * YEAR, GENESIS + 4 * YEAR), units('95000000') / BigInt(YEAR) * BigInt(YEAR));
  assert.equal(emissionBetween(GENESIS + 4 * YEAR, GENESIS + 5 * YEAR), 0n);
  assert.equal(emissionBetween(GENESIS - DAY, GENESIS + 4 * YEAR + DAY), ['380000000','190000000','95000000','95000000'].reduce((n,v)=>n+units(v)/BigInt(YEAR)*BigInt(YEAR),0n));
});
test('marginal yield accounts for our other plots and 100% ownership', () => {
  const flow = units('1000000');
  assert.ok(marginalYield(flow, 220000, 35915000, 2500) < marginalYield(flow, 10000, 36125000, 2500));
  assert.equal(marginalYield(flow, 220000, 0, 2500), 0n);
  assert.equal(marginalYield(flow, 0, 0, 10000), flow);
});
test('baseline matches the independent common-plot worked example within wei rounding', () => {
  const { portfolio: p, scenario: s } = fixture();
  for (const w of p.wallets) for (const plot of w.plots) { plot.rarity_tier = 0; plot.effective_weight_bps = 10000; }
  s.externalWeight = '3591.5';
  const r = simulate(p, s, { days: 1, policy: 'baseline' });
  assert.equal(r.status, 'ok');
  const expected = units('2000') * 22n * 2n / 7n;
  assert.ok(expected - r.earned_crop_wei >= 0n && expected - r.earned_crop_wei < 22n);
});
test('claim cadence changes liquidity, not gross earnings or weight', () => {
  const { portfolio, scenario } = fixture();
  const daily = simulate(portfolio, { ...scenario, claimEveryDays: 1 }, { days: 30, policy: 'baseline' });
  const weekly = simulate(portfolio, { ...scenario, claimEveryDays: 7 }, { days: 30, policy: 'baseline' });
  assert.equal(daily.earned_crop_wei, weekly.earned_crop_wei);
  assert.ok(daily.actions.length > weekly.actions.length);
});
test('no yield or upgrades are produced before Genesis', () => {
  const { portfolio, scenario } = fixture(); scenario.start = new Date((GENESIS - 30 * DAY) * 1000).toISOString();
  const r = simulate(portfolio, scenario, { days: 30, funding: 'extra' });
  assert.equal(r.earned_crop_wei, 0n); assert.equal(r.actions.filter(a => a.type === 'upgrade').length, 0);
});
test('dormant plots are never scheduled for planting before Genesis', () => {
  const { portfolio, scenario } = demoPortfolio();
  scenario.start = new Date((GENESIS - 14 * DAY) * 1000).toISOString();
  const r = simulate(portfolio, scenario, { days: 30, policy: 'baseline' });
  assert.equal(r.actions.find(a => a.type === 'plant').day, 14);
  assert.equal(r.curve[0].earned_wei, '0');
  const before = simulate(portfolio, scenario, { days: 7, policy: 'baseline' });
  assert.equal(before.spent_crop_wei, 0n); assert.equal(before.actions.length, 0);
});
test('funding and complete paths conserve CROP and respect extra cap', () => {
  const { portfolio, scenario } = demoPortfolio();
  const r = simulate(portfolio, scenario, { days: 365, funding: 'extra' });
  assert.equal(r.status, 'ok');
  assert.ok(r.extra_investment_eth_wei <= units(scenario.extraBudget));
  assert.equal(r.ending_crop_wei, r.bought_crop_wei + r.net_crop_wei);
  const levels = new Map();
  for (const a of r.actions.filter(a => a.type === 'upgrade')) { assert.equal(a.to_level, (levels.get(a.plot_id) ?? 1) + 1); levels.set(a.plot_id, a.to_level); }
  assert.ok(r.wallets.every(w => w.liquid >= 0n && w.eth >= 0n));
  const openingEth = portfolio.wallets.reduce((sum, w) => sum + BigInt(w.eth_balance_wei), 0n);
  assert.equal(r.remaining_eth_wei, openingEth - r.purchase_cost_eth_wei - r.gas_eth_wei);
});
test('funding never spends pending tokens without recording a claim', () => {
  const { portfolio: p, scenario: s } = fixture();
  p.wallets[0].plots[0].pending_crop_wei = units('30000').toString();
  const r = simulate(p, s, { days: 365 });
  const upgrade = r.actions.findIndex(a => a.type === 'upgrade');
  assert.ok(upgrade >= 0);
  assert.ok(r.actions.slice(0, upgrade).some(a => a.type === 'claim'));
});
test('wallet transfers are explicit and can be disabled', () => {
  const { portfolio: p, scenario: s } = fixture();
  p.wallets[1].plots[0].pending_crop_wei = units('30000').toString();
  const yes = simulate(p, s, { days: 365 });
  const no = simulate(p, { ...s, allowTransfers: false }, { days: 365 });
  assert.ok(yes.actions.some(a => a.type === 'transfer_crop'));
  assert.ok(no.actions.every(a => a.type !== 'transfer_crop'));
});
test('consolidation before versus after planting has correct activation penalty', () => {
  const { portfolio: p, scenario: s } = demoPortfolio();
  const before = simulate(p, { ...s, walletMode: 'before' }, { days: 30, policy: 'baseline' });
  const after = simulate(p, { ...s, walletMode: 'after' }, { days: 30, policy: 'baseline' });
  assert.equal(before.spent_crop_wei, units('55000'));
  assert.equal(after.spent_crop_wei - before.spent_crop_wei, units('27500'));
  assert.equal(after.wallets[0].plots.length, 22); assert.equal(after.wallets[1].plots.length, 0);
  assert.equal(after.actions.filter(a => a.type === 'move_plot').length, 11);
  const active = fixture();
  assert.equal(simulate(active.portfolio, { ...active.scenario, walletMode: 'before' }).status, 'unavailable');
});
test('prefunded planting uses existing tokens without buying them a second time', () => {
  const { portfolio, scenario } = demoPortfolio();
  portfolio.wallets[0].crop_balance_wei = units('55000').toString();
  const r = simulate(portfolio, scenario, { days: 30, policy: 'baseline' });
  assert.equal(r.status, 'ok'); assert.equal(r.bought_crop_wei, 0n);
  assert.equal(r.planting_crop_wei, units('55000'));
  assert.ok(r.actions.some(a => a.type === 'transfer_crop' && a.for_planting));
  assert.equal(r.ending_crop_wei, r.earned_crop_wei);
  assert.equal(r.cash_recovery_eth_wei, 0n);
});
test('unknown gas is not silently free, insufficient ETH blocks actions', () => {
  const { portfolio: p, scenario: s } = demoPortfolio();
  assert.equal(simulate(p, { ...s, feeMode: 'unknown' }).status, 'unavailable');
  const paid = { ...s, feeMode: 'estimated', claimFee: '1', upgradeFee: '1', plantFee: '1', buyFee: '1', transferFee: '1', nftTransferFee: '1' };
  assert.match(simulate(p, paid).errors.join(), /lacks ETH/);
});
test('purchased tokens are capital, not profit; ETH fees are counted once', () => {
  const { portfolio: p, scenario: s } = demoPortfolio();
  const r = simulate(p, s, { days: 30, funding: 'extra', policy: 'baseline' });
  assert.equal(r.net_crop_wei, r.earned_crop_wei - units('55000'));
  assert.equal(r.operating_eth_wei, r.earned_crop_wei * units(s.sellPrice) / UNIT - units('0.055'));
  assert.equal(r.cash_recovery_eth_wei, -units('0.055'));
  assert.equal(r.total_eth_wei, null);
  assert.equal(r.wallets[0].eth, units('0.1') - units('0.0275'));
  assert.equal(r.wallets[1].eth, units('0.1') - units('0.0275'));
  assert.equal(r.remaining_eth_wei, units('0.145'));
  assert.equal(r.funding_ready, true);
});
test('purchase costs and operation fees consume the same per-wallet ETH balance', () => {
  const { portfolio, scenario } = demoPortfolio();
  const paid = { ...scenario, feeMode: 'estimated', claimFee: '0', upgradeFee: '0', plantFee: '0.001', buyFee: '0.001', transferFee: '0', nftTransferFee: '0' };
  const r = simulate(portfolio, paid, { days: 1, policy: 'baseline' });
  assert.equal(r.status, 'ok');
  assert.equal(r.purchase_cost_eth_wei, units('0.055'));
  assert.equal(r.gas_eth_wei, units('0.024'));
  assert.equal(r.remaining_eth_wei, units('0.121'));
  for (const wallet of r.wallets) assert.equal(wallet.eth, units('0.0605'));
  assert.equal(r.cash_recovery_eth_wei, -units('0.079'));
});
test('initial planting cannot borrow ETH from the other wallet or spend the same ETH on gas twice', () => {
  const { portfolio, scenario } = demoPortfolio();
  portfolio.wallets[0].eth_balance_wei = '0'; portfolio.wallets[1].eth_balance_wei = units('1').toString();
  const unfunded = simulate(portfolio, scenario, { days: 1, policy: 'baseline' });
  assert.equal(unfunded.status, 'unavailable'); assert.match(unfunded.errors.join(), /lacks ETH for the CROP purchase/);
  portfolio.wallets[0].eth_balance_wei = units('0.0275').toString();
  const paid = { ...scenario, feeMode: 'estimated', claimFee: '0', upgradeFee: '0', plantFee: '0.000000000000000001', buyFee: '0', transferFee: '0', nftTransferFee: '0' };
  const noGas = simulate(portfolio, paid, { days: 1, policy: 'baseline' });
  assert.equal(noGas.status, 'unavailable'); assert.match(noGas.errors.join(), /lacks ETH for plant costs/);
});
test('extra-investment cap does not create ETH for unfunded upgrade purchases', () => {
  const { portfolio, scenario } = fixture();
  portfolio.wallets.forEach(w => { w.eth_balance_wei = '0'; });
  scenario.extraBudget = '1';
  const r = simulate(portfolio, scenario, { days: 365, funding: 'extra' });
  assert.equal(r.status, 'ok');
  assert.equal(r.bought_crop_wei, 0n); assert.equal(r.extra_investment_eth_wei, 0n);
  assert.ok(r.actions.every(a => a.type !== 'buy'));
  assert.ok(r.actions.filter(a => a.type === 'upgrade').every(a => a.day > 0));
});
test('unknown wallet ETH cannot establish affordability for a priced purchase', () => {
  const { portfolio, scenario } = demoPortfolio();
  portfolio.wallets[0].eth_balance_wei = null;
  const r = simulate(portfolio, scenario, { days: 1, policy: 'baseline' });
  assert.equal(r.status, 'unavailable'); assert.match(r.errors.join(), /ETH balance is unknown/);
});
test('missing price leaves ETH unknown while CROP remains calculable', () => {
  const { portfolio, scenario } = demoPortfolio();
  const r = simulate(portfolio, { ...scenario, buyPrice: '', sellPrice: '' }, { days: 30 });
  assert.equal(r.status, 'ok'); assert.equal(r.operating_eth_wei, null); assert.equal(r.cash_recovery_eth_wei, null);
  assert.equal(typeof r.net_crop_wei, 'bigint');
  assert.equal(r.funding_ready, false);
  assert.equal(r.funding_status, 'conditional_unknown_purchase_price');
  assert.equal(r.remaining_eth_wei, null);
  assert.ok(r.wallets.every(w => !w.eth_costs_complete));
  assert.ok(r.blocked.some(message => message.includes('affordability')));
});
test('weather paths and external weight schedules affect only their future intervals', () => {
  const { portfolio, scenario } = fixture();
  const rows = timeline({ ...scenario, weatherPath: [{ day: 10, multiplier_bps: 5000 }], externalWeightPath: [{ day: 20, weight_bps: 60000000 }] }, 30);
  assert.equal(rows[9].flow, rows[10].flow * 2n + rows[9].flow % 2n);
  assert.equal(rows[19].external, 35870000); assert.equal(rows[20].external, 60000000);
  assert.ok(validateScenario({ ...scenario, weatherPath: [{ day: 10, multiplier_bps: 5000 }, { day: 9, multiplier_bps: 10000 }] }).length);
});
test('full comparison includes no-upgrade and never labels worse net CROP as best', () => {
  const { portfolio, scenario } = demoPortfolio();
  const r = compare(portfolio, scenario);
  assert.equal(r.length, 6);
  for (const row of r) { assert.equal(row.status, 'ok'); assert.ok(row.bestCrop.net_crop_wei >= row.baseline.net_crop_wei); }
  assert.ok(r[0].bestCrop.net_crop_wei >= r[0].baseline.net_crop_wei);
});
test('missing extra budget disables only that funding model', () => {
  const { portfolio, scenario } = demoPortfolio();
  const r = compare(portfolio, { ...scenario, extraBudget: '' }, [30]);
  assert.equal(r[0].status, 'ok'); assert.equal(r[1].status, 'unavailable');
});
test('true hold beats planting after the faucet ends while preserving the original baseline', () => {
  const { portfolio, scenario } = demoPortfolio();
  scenario.start = new Date((GENESIS + 4 * YEAR) * 1000).toISOString();
  const rows = compare(portfolio, scenario, [30]);
  for (const row of rows) {
    assert.equal(row.status, 'ok');
    assert.equal(row.baseline.policy, 'baseline');
    assert.equal(row.baseline.net_crop_wei, -units('55000'));
    assert.equal(row.bestCrop.policy, 'hold'); assert.equal(row.bestEth.policy, 'hold');
    assert.equal(row.hold.net_crop_wei, 0n); assert.equal(row.hold.operating_eth_wei, 0n);
    assert.equal(row.hold.spent_crop_wei, 0n); assert.equal(row.hold.bought_crop_wei, 0n);
    assert.equal(row.hold.gas_eth_wei, 0n); assert.deepEqual(row.hold.actions, []);
    assert.ok(row.hold.wallets.every(w => w.plots.every(p => !p.active)));
  }
});
test('hold can maximize ETH even when planting has positive net CROP', () => {
  const { portfolio, scenario } = demoPortfolio();
  scenario.sellPrice = '0.000000000001';
  const row = compare(portfolio, scenario, [30])[0];
  assert.ok(row.baseline.net_crop_wei > 0n);
  assert.ok(row.baseline.operating_eth_wei < 0n);
  assert.ok(row.bestCrop.net_crop_wei > 0n);
  assert.equal(row.bestEth.policy, 'hold');
  assert.equal(row.bestEth.purchase_cost_eth_wei, 0n);
});
test('hold keeps existing active plots accruing without claiming or changing wallet balances', () => {
  const { portfolio, scenario } = fixture();
  portfolio.wallets[0].crop_balance_wei = units('123').toString();
  portfolio.wallets[1].plots[0].pending_crop_wei = units('456').toString();
  const holding = simulate(portfolio, scenario, { days: 30, policy: 'hold' });
  const baseline = simulate(portfolio, scenario, { days: 30, policy: 'baseline' });
  assert.equal(holding.status, 'ok');
  assert.equal(holding.earned_crop_wei, baseline.earned_crop_wei);
  assert.equal(holding.pending_crop_wei, holding.earned_crop_wei + units('456'));
  assert.equal(holding.liquid_crop_wei, units('123'));
  assert.equal(holding.ending_crop_wei, holding.earned_crop_wei + units('579'));
  assert.equal(holding.remaining_eth_wei, units('0.2'));
  assert.deepEqual(holding.actions, []);
});
test('hold ignores proposed consolidation and its downtime because no plots move', () => {
  const { portfolio, scenario } = fixture();
  const keep = simulate(portfolio, scenario, { days: 7, policy: 'hold' });
  for (const walletMode of ['before', 'after']) {
    const holding = simulate(portfolio, { ...scenario, walletMode, downtimeHours: '168' }, { days: 7, policy: 'hold' });
    assert.equal(holding.status, 'ok');
    assert.equal(holding.earned_crop_wei, keep.earned_crop_wei);
    assert.deepEqual(holding.wallets.map(w => w.plots.map(p => p.id)), portfolio.wallets.map(w => w.plots.map(p => p.token_id)));
    assert.equal(holding.planting_crop_wei, 0n); assert.deepEqual(holding.actions, []);
  }
});
test('hold remains available when priced planting is unaffordable', () => {
  const { portfolio, scenario } = demoPortfolio();
  portfolio.wallets.forEach(w => { w.eth_balance_wei = '0'; });
  for (const row of compare(portfolio, scenario, [30])) {
    assert.equal(row.status, 'ok'); assert.equal(row.baseline.status, 'unavailable');
    assert.equal(row.bestCrop.policy, 'hold'); assert.equal(row.bestEth.policy, 'hold');
    assert.deepEqual(row.errors, []);
  }
});
test('hold requires no operation fee or purchase quote when it performs no transactions', () => {
  const { portfolio, scenario } = fixture();
  const holding = simulate(portfolio, { ...scenario, feeMode: 'unknown', buyPrice: '', extraBudget: '' }, { days: 30, policy: 'hold', funding: 'extra' });
  assert.equal(holding.status, 'ok'); assert.equal(holding.purchase_cost_eth_wei, 0n);
  assert.equal(holding.extra_investment_eth_wei, 0n); assert.equal(holding.gas_eth_wei, 0n);
  assert.deepEqual(holding.actions, []);
});
