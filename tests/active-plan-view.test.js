import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const viewBundle = await build({
  entryPoints: ['src/active-plan-view.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  loader: { '.webp': 'dataurl', '.png': 'dataurl' },
  write: false,
  logLevel: 'silent'
});
const { activePlanView } = await import(`data:text/javascript;base64,${Buffer.from(viewBundle.outputFiles[0].text).toString('base64')}`);

const ADDRESS = '0x1111111111111111111111111111111111111111';

function portfolio() {
  return {
    is_demo: false,
    is_template: false,
    wallets: [{
      id: 'wallet_a',
      label: 'Wallet A',
      address: ADDRESS,
      plots: [{ token_id: 1 }]
    }]
  };
}

function settings(extra = {}) {
  return {
    enabled: false,
    days: 30,
    funding: 'harvest',
    objective: 'crop',
    refreshSeconds: 60,
    feeMode: 'estimated',
    claimFee: '0.01',
    upgradeFee: '0.01',
    plantFee: '0.01',
    transferFee: '0.01',
    buyFee: '0.01',
    nftTransferFee: '0.01',
    buyPrice: '0.000001',
    sellPrice: '0.000001',
    extraBudget: '',
    extraSpent: '0',
    claimEveryDays: 1,
    allowTransfers: true,
    includeOpeningCrop: false,
    useObservedWeight: true,
    ...extra
  };
}

function render(extra = {}) {
  return activePlanView({
    portfolio: portfolio(),
    settings: settings(),
    runtime: {},
    actionState: {},
    ...extra
  });
}

test('simple mode keeps the core plan form and moves assumptions out of the primary form', () => {
  const html = render({ simple: true });

  assert.match(html, /<form id="active-plan-settings"[^>]*data-simple="true"/);
  assert.match(html, /name="days"/);
  assert.match(html, /name="funding"/);
  assert.match(html, /name="objective"/);
  assert.match(html, />Build plan<\/button>/);
  assert.match(html, />Refresh &amp; rebuild<\/button>/);
  assert.match(html, />Start live plan<\/button>/);
  assert.match(html, /id="active-export" class="active-plan-button active-plan-secondary"/);
  assert.match(html, /id="active-plan-simple-details"/);
  assert.match(html, /Prices and fees estimated\. Every action reviewed separately\./);
  assert.match(html, /id="active-plan-extra-fields"[^>]* hidden/);
  assert.match(html, /id="active-plan-extra-budget-eth"[^>]*disabled/);
  assert.match(html, /id="active-plan-extra-spent-eth"[^>]*disabled/);

  for (const name of [
    'enabled', 'refreshSeconds', 'claimEveryDays', 'feeMode', 'claimFee',
    'upgradeFee', 'plantFee', 'transferFee', 'buyFee', 'nftTransferFee',
    'buyPrice', 'sellPrice', 'allowTransfers',
    'includeOpeningCrop', 'useObservedWeight'
  ]) {
    assert.doesNotMatch(html, new RegExp(`name="${name}"`));
  }
  assert.doesNotMatch(html, /type="checkbox"/);
  assert.doesNotMatch(html, /Operation fee|fee estimate|CROP buy price/i);
});

test('simple mode requires and preserves an explicit extra investment cap only for extra funding', () => {
  const harvest = render({ simple: true });
  assert.match(harvest, /name="extraBudget"/);

  const extra = render({
    simple: true,
    settings: settings({ funding: 'extra', extraBudget: '1.25' })
  });
  assert.match(extra, /id="active-plan-extra-fields"(?![^>]* hidden)/);
  assert.match(extra, /id="active-plan-extra-budget-eth"[^>]*value="1\.25"[^>]*required/);
  assert.doesNotMatch(extra, /id="active-plan-extra-budget-eth"[^>]*disabled/);
  assert.match(extra, /id="active-plan-extra-spent-eth"[^>]*name="extraSpent"/);
  assert.match(extra, /Extra investment cap · ETH/);
  assert.match(extra, /Already used · ETH/);
});

test('omitting simple mode preserves the full settings form', () => {
  const implicit = render();
  const explicit = render({ simple: false });

  assert.equal(implicit, explicit);
  assert.match(implicit, /id="active-plan-assumptions"/);
  assert.match(implicit, /name="feeMode"/);
  assert.match(implicit, /name="allowTransfers"/);
  assert.match(implicit, />Save &amp; build plan<\/button>/);
});

test('simple mode keeps next-action safety blockers and individual review controls', () => {
  const nextAction = {
    status: 'ready_for_review',
    type: 'upgrade',
    wallet_id: 'wallet_a',
    plot_id: 1,
    to_level: 2,
    why: 'This step improves the watched farm.',
    required_inputs: ['Refresh holdings before review.']
  };
  const base = {
    simple: true,
    runtime: { phase: 'ready', plan: { scope: 'watched' }, nextAction },
    actionState: {}
  };
  const ready = render(base);

  assert.match(ready, /id="active-review"/);
  assert.match(ready, /Refresh holdings before review\./);
  assert.match(ready, /Each action needs review and MetaMask approval/);

  for (const actionState of [
    { locked: true },
    { hasPending: true },
    { hasDraft: true },
    { busy: true }
  ]) {
    const blocked = render({ ...base, actionState });
    assert.doesNotMatch(blocked, /id="active-review"/);
    assert.match(blocked, /Each action needs review and MetaMask approval/);
  }

  const stale = render({ ...base, runtime: { ...base.runtime, stale: true } });
  assert.doesNotMatch(stale, /id="active-review"/);
  assert.match(stale, /Refresh and rebuild before reviewing an action\./);
});
