import { art } from './artwork.js';
const DAY_MS = 86_400_000;
const WEI_PER_TOKEN = 10n ** 18n;

const DEFAULTS = Object.freeze({
  enabled: false,
  days: 90,
  funding: 'harvest',
  objective: 'crop',
  refreshSeconds: 60,
  feeMode: 'unknown',
  claimFee: '',
  upgradeFee: '',
  plantFee: '',
  transferFee: '',
  buyFee: '',
  nftTransferFee: '',
  buyPrice: '',
  sellPrice: '',
  extraBudget: '',
  extraSpent: '0',
  claimEveryDays: 1,
  allowTransfers: false,
  includeOpeningCrop: true,
  useObservedWeight: false
});

const FEE_FIELDS = Object.freeze([
  ['claimFee', 'Claim'],
  ['upgradeFee', 'Upgrade'],
  ['plantFee', 'Plant'],
  ['transferFee', 'CROP transfer'],
  ['buyFee', 'CROP buy'],
  ['nftTransferFee', 'NFT transfer']
]);

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function settingValue(settings, key) {
  const value = settings[key];
  return value == null ? DEFAULTS[key] ?? '' : value;
}

function checked(value) {
  return value === true || value === 'true' || value === 1 ? 'checked' : '';
}

function validInteger(value, fallback, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function formatWei(value, symbol, fractionDigits = 2) {
  let amount;
  try {
    if (typeof value === 'bigint') amount = value;
    else if (typeof value === 'string' && /^-?\d+$/.test(value)) amount = BigInt(value);
    else if (typeof value === 'number' && Number.isSafeInteger(value)) amount = BigInt(value);
    else return '—';
  } catch {
    return '—';
  }

  const negative = amount < 0n;
  if (negative) amount = -amount;
  const precision = BigInt(Math.max(0, Math.min(18, fractionDigits)));
  const decimalPlaces = Number(precision);
  const roundingUnit = 10n ** (18n - precision);
  let whole = amount / WEI_PER_TOKEN;
  let fraction = amount % WEI_PER_TOKEN / roundingUnit;
  const discarded = amount % roundingUnit;
  if (discarded * 2n >= roundingUnit) {
    if (precision === 0n) whole += 1n;
    else fraction += 1n;
  }
  const fractionLimit = 10n ** precision;
  if (fraction >= fractionLimit && precision > 0n) {
    whole += 1n;
    fraction = 0n;
  }

  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decimals = decimalPlaces
    ? fraction.toString().padStart(decimalPlaces, '0').replace(/0+$/, '')
    : '';
  const number = `${negative ? '−' : ''}${grouped}${decimals ? `.${decimals}` : ''}`;
  return `${number} ${symbol}`;
}

function asBigInt(value) {
  try {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
    if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  } catch {
    return null;
  }
  return null;
}

function difference(left, right, symbol, fractionDigits = 2) {
  const a = asBigInt(left);
  const b = asBigInt(right);
  return a == null || b == null ? '—' : formatWei(a - b, symbol, fractionDigits);
}

function formatUtc(value, options = {}) {
  if (value == null || value === '') return '';
  const parsed = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(parsed)) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: options.dateStyle ?? 'medium',
      timeStyle: options.timeStyle ?? 'short',
      timeZone: 'UTC'
    }).format(new Date(parsed)) + ' UTC';
  } catch {
    return new Date(parsed).toISOString();
  }
}

function words(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text ? text.replaceAll('_', ' ') : fallback;
}

function walletLabel(portfolio, walletId, fallback = '') {
  const wallets = Array.isArray(portfolio?.wallets) ? portfolio.wallets : [];
  const found = wallets.find(wallet => String(wallet?.id ?? '') === String(walletId ?? ''));
  return String(found?.label ?? fallback ?? (walletId == null ? '' : `Wallet ${walletId}`)).trim()
    || (walletId == null ? '—' : `Wallet ${walletId}`);
}

function scopeLabel(portfolio, plan) {
  if (plan?.scope === 'watched') return 'Watched wallet plan';
  if (plan?.scope === 'model') return 'Model plan';
  const wallets = Array.isArray(portfolio?.wallets) ? portfolio.wallets : [];
  const hasConfiguredAddress = wallets.some(wallet => typeof wallet?.address === 'string' && wallet.address.trim());
  return hasConfiguredAddress && !portfolio?.is_demo && !portfolio?.is_template
    ? 'Watched wallet plan'
    : 'Model plan';
}

function phaseLabel(runtime, settings) {
  const phase = String(runtime.phase ?? 'idle');
  if (phase === 'refreshing') return 'Refreshing holdings';
  if (phase === 'calculating') return 'Building plan';
  if (phase === 'error') return 'Needs attention';
  if (phase === 'paused' || !settings.enabled) return 'Paused';
  if (phase === 'ready') return 'Plan ready';
  if (runtime.stale) return 'Plan is stale';
  return settings.enabled ? 'Live plan on' : 'On demand';
}

function phaseClass(runtime, settings) {
  if (runtime.phase === 'error') return 'is-error';
  if (runtime.stale) return 'is-stale';
  if (runtime.phase === 'refreshing' || runtime.phase === 'calculating') return 'is-busy';
  if (settings.enabled) return 'is-live';
  return 'is-paused';
}

function isDecimalFilled(value) {
  return String(value ?? '').trim() !== '';
}

function missingPlanInputs(settings) {
  const missing = [];
  if (settings.feeMode === 'unknown') {
    const feeNames = FEE_FIELDS.map(([, label]) => label).join(', ');
    missing.push(`Operation fees are unknown. Enter estimates for ${feeNames}, or choose the explicitly labeled zero-fee scenario before building a plan.`);
  } else if (settings.feeMode === 'estimated') {
    const fields = FEE_FIELDS.filter(([key]) => !isDecimalFilled(settings[key])).map(([, label]) => label);
    if (fields.length) missing.push(`Missing ETH fee estimates: ${fields.join(', ')}.`);
  }
  if (settings.objective === 'eth') {
    if (!isDecimalFilled(settings.sellPrice)) missing.push('Operating ETH comparison needs a net CROP exit price.');
  }
  if (settings.funding === 'extra') {
    if (!isDecimalFilled(settings.buyPrice)) missing.push('Extra investment needs an all-in CROP buy price.');
    if (!isDecimalFilled(settings.extraBudget)) missing.push('Extra investment needs a total ETH cap.');
  }
  return missing;
}

function errorList(values) {
  const entries = Array.isArray(values) ? values : [];
  const clean = [...new Set(entries.filter(value => typeof value === 'string' && value.trim()))];
  if (!clean.length) return '';
  return `<ul class="active-plan-error-list">${clean.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`;
}

function field({ id, name, label, value, type = 'text', min, max, step, hint, inputmode = 'decimal', list, required = false, disabled = false }) {
  const attributes = [
    `id="${id}"`,
    `name="${name}"`,
    `type="${type}"`,
    `value="${escapeHtml(value)}"`,
    `autocomplete="off"`,
    `inputmode="${inputmode}"`
  ];
  if (min != null) attributes.push(`min="${escapeHtml(min)}"`);
  if (max != null) attributes.push(`max="${escapeHtml(max)}"`);
  if (step != null) attributes.push(`step="${escapeHtml(step)}"`);
  if (list) attributes.push(`list="${list}"`);
  if (required) attributes.push('required');
  if (disabled) attributes.push('disabled');
  return `<label class="active-plan-field" for="${id}"><span>${escapeHtml(label)}</span><input ${attributes.join(' ')}>${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</label>`;
}

function selectField({ id, name, label, value, options, hint }) {
  const choices = options.map(option => {
    const [optionValue, optionLabel] = option;
    return `<option value="${escapeHtml(optionValue)}"${String(value) === String(optionValue) ? ' selected' : ''}>${escapeHtml(optionLabel)}</option>`;
  }).join('');
  return `<label class="active-plan-field" for="${id}"><span>${escapeHtml(label)}</span><select id="${id}" name="${name}">${choices}</select>${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</label>`;
}

function checkField({ id, name, label, value, hint }) {
  return `<label class="active-plan-check" for="${id}"><input id="${id}" name="${name}" type="checkbox" value="true" ${checked(value)}><span><strong>${escapeHtml(label)}</strong>${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</span></label>`;
}

function settingsForm(settings, runtime, actionState, hasPlan, simple = false) {
  const days = validInteger(settings.days, DEFAULTS.days, 1, 365);
  const refreshSeconds = validInteger(settings.refreshSeconds, DEFAULTS.refreshSeconds, 30, 900);
  const claimEveryDays = validInteger(settings.claimEveryDays, DEFAULTS.claimEveryDays, 1, 365);
  const busy = ['refreshing', 'calculating'].includes(runtime.phase) || !!actionState.busy;
  const funding = ['harvest', 'extra'].includes(settings.funding) ? settings.funding : DEFAULTS.funding;
  const objective = ['crop', 'eth'].includes(settings.objective) ? settings.objective : DEFAULTS.objective;
  const feeMode = ['unknown', 'estimated', 'zero'].includes(settings.feeMode) ? settings.feeMode : DEFAULTS.feeMode;
  const refreshed = formatUtc(runtime.lastUpdated ?? runtime.plan?.generated_at);
  const nextRefresh = formatUtc(runtime.nextRefreshAt);
  const issue = runtime.error ? `<p class="active-plan-runtime-error" role="alert">${escapeHtml(runtime.error)}</p>` : '';
  const timing = `<div class="active-plan-timing">${refreshed ? `<span>Last updated <time>${escapeHtml(refreshed)}</time></span>` : '<span>Plan has not been refreshed yet.</span>'}${nextRefresh && settings.enabled ? `<span>Next refresh <time>${escapeHtml(nextRefresh)}</time></span>` : ''}</div>`;
  if (simple) {
    const extraFunding = funding === 'extra';
    const extraFields = `<div id="active-plan-extra-fields" class="active-plan-fields active-plan-simple-extra-fields"${extraFunding ? '' : ' hidden'}>
          ${field({ id: 'active-plan-extra-budget-eth', name: 'extraBudget', label: 'Extra investment cap · ETH', value: settings.extraBudget ?? '', hint: 'Required when extra funding is selected.', required: extraFunding, disabled: !extraFunding })}
          ${field({ id: 'active-plan-extra-spent-eth', name: 'extraSpent', label: 'Already used · ETH', value: settings.extraSpent ?? DEFAULTS.extraSpent, hint: 'Record manual purchases before rebuilding.', disabled: !extraFunding })}
        </div>`;
    const toggleLabel = settings.enabled ? 'Pause live plan' : 'Start live plan';
    const toggleState = settings.enabled ? 'true' : 'false';
    const exportDisabled = hasPlan ? '' : 'disabled';
    const rebuildDisabled = busy ? 'disabled' : '';
    const toggleDisabled = actionState.busy ? 'disabled' : '';
    return `<section class="active-plan-card active-plan-settings-card is-simple" aria-labelledby="active-plan-settings-title">
    <div class="active-plan-card-head"><h3 id="active-plan-settings-title">Plan settings</h3></div>
    ${issue}
    ${timing}
    <form id="active-plan-settings" class="active-plan-settings" aria-label="Active guided plan settings" data-simple="true">
      <div class="active-plan-main-fields">
        ${field({ id: 'active-plan-days', name: 'days', label: 'Investment horizon · days', value: days, type: 'number', min: 1, max: 365, step: 1, inputmode: 'numeric', list: 'active-plan-horizons' })}
        <datalist id="active-plan-horizons"><option value="30"></option><option value="90"></option><option value="365"></option></datalist>
        ${selectField({ id: 'active-plan-funding', name: 'funding', label: 'Funding model', value: funding, options: [['harvest', 'Harvest-funded'], ['extra', 'Extra investment allowed']] })}
        ${selectField({ id: 'active-plan-objective', name: 'objective', label: 'Rank by', value: objective, options: [['crop', 'Net CROP'], ['eth', 'Operating ETH']] })}
      </div>
      ${extraFields}
      <p class="active-plan-helper">Prices and fees estimated. Every action reviewed separately.</p>
      <div class="active-plan-controls" aria-label="Plan controls">
        <button class="active-plan-button active-plan-primary" type="submit" ${busy ? 'disabled' : ''}>Build plan</button>
        <button id="active-rebuild" class="active-plan-button" type="button" ${rebuildDisabled}>Refresh &amp; rebuild</button>
        <button id="active-toggle" class="active-plan-button active-plan-toggle" type="button" aria-pressed="${escapeHtml(toggleState)}" ${toggleDisabled}>${toggleLabel}</button>
      </div>
      <details id="active-plan-simple-details" class="active-plan-assumptions active-plan-simple-details">
        <summary>More settings</summary>
        <div class="active-plan-controls active-plan-secondary-controls" aria-label="Secondary plan controls">
          <button id="active-export" class="active-plan-button active-plan-secondary" type="button" ${exportDisabled}>Export active plan</button>
          <button id="active-edit-assumptions" class="active-plan-button active-plan-secondary" type="button">Edit forecast assumptions</button>
        </div>
      </details>
      <p class="active-plan-helper">Live monitoring is optional and never requests MetaMask until you review an action.</p>
    </form>
  </section>`;
  }
  const feeInputs = FEE_FIELDS.map(([name, label]) => field({
    id: `active-plan-${name}`,
    name,
    label: `${label} fee · ETH`,
    value: settings[name] ?? ''
  })).join('');
  const toggleLabel = settings.enabled ? 'Pause live plan' : 'Start live plan';
  const toggleState = settings.enabled ? 'true' : 'false';
  const exportDisabled = hasPlan ? '' : 'disabled';
  const rebuildDisabled = busy ? 'disabled' : '';
  const toggleDisabled = actionState.busy ? 'disabled' : '';
  return `<section class="active-plan-card active-plan-settings-card" aria-labelledby="active-plan-settings-title">
    <div class="active-plan-card-head"><h3 id="active-plan-settings-title">Plan settings</h3></div>
    ${issue}
    ${timing}
    <form id="active-plan-settings" class="active-plan-settings" aria-label="Active guided plan settings">
      <input id="active-plan-enabled" type="hidden" name="enabled" value="${escapeHtml(toggleState)}">
      <div class="active-plan-main-fields">
        ${field({ id: 'active-plan-days', name: 'days', label: 'Investment horizon · days', value: days, type: 'number', min: 1, max: 365, step: 1, inputmode: 'numeric', list: 'active-plan-horizons', hint: 'Common horizons: 30, 90 or 365 days.' })}
        <datalist id="active-plan-horizons"><option value="30"></option><option value="90"></option><option value="365"></option></datalist>
        ${selectField({ id: 'active-plan-funding', name: 'funding', label: 'Funding model', value: funding, options: [['harvest', 'Harvest-funded'], ['extra', 'Extra investment allowed']] })}
        ${selectField({ id: 'active-plan-objective', name: 'objective', label: 'Rank by', value: objective, options: [['crop', 'Net CROP'], ['eth', 'Operating ETH']] })}
      </div>
      <details id="active-plan-assumptions" class="active-plan-assumptions">
        <summary>Plan assumptions</summary>
        <p class="active-plan-helper">Each wallet keeps its own CROP and ETH balance. The plan rebases to current time and uses its current holdings.</p>
        <div class="active-plan-fields active-plan-fields-three">
          ${selectField({ id: 'active-plan-fee-mode', name: 'feeMode', label: 'Operation fee assumption', value: feeMode, options: [['unknown', 'Unknown · fees required to build'], ['estimated', 'Estimated fees'], ['zero', 'Explicit zero-fee scenario']] })}
          ${field({ id: 'active-plan-refresh-seconds', name: 'refreshSeconds', label: 'Live refresh interval · seconds', value: refreshSeconds, type: 'number', min: 30, max: 900, step: 1, inputmode: 'numeric' })}
          ${field({ id: 'active-plan-claim-days', name: 'claimEveryDays', label: 'Claim interval · days', value: claimEveryDays, type: 'number', min: 1, max: 365, step: 1, inputmode: 'numeric' })}
          ${feeInputs}
          ${field({ id: 'active-plan-buy-price', name: 'buyPrice', label: 'All-in CROP buy price · ETH per CROP', value: settings.buyPrice ?? '' })}
          ${field({ id: 'active-plan-sell-price', name: 'sellPrice', label: 'Net CROP exit price · ETH per CROP', value: settings.sellPrice ?? '' })}
          ${field({ id: 'active-plan-extra-budget', name: 'extraBudget', label: 'Total extra ETH cap', value: settings.extraBudget ?? '', hint: 'Remaining cap = total cap − amount already used. Wallet ETH balances still apply.' })}
          ${field({ id: 'active-plan-extra-spent', name: 'extraSpent', label: 'Already used from cap · ETH', value: settings.extraSpent ?? DEFAULTS.extraSpent, hint: 'Record manual purchases here before continuing. Wallet reads never reset this amount.' })}
        </div>
        <div class="active-plan-checks">
          ${checkField({ id: 'active-plan-allow-transfers', name: 'allowTransfers', label: 'Allow manual CROP transfers in the plan', value: settings.allowTransfers, hint: 'Transfers are proposed steps and require your separate action.' })}
          ${checkField({ id: 'active-plan-opening-crop', name: 'includeOpeningCrop', label: 'Use opening CROP already in wallet balances', value: settings.includeOpeningCrop })}
          ${checkField({ id: 'active-plan-observed-weight', name: 'useObservedWeight', label: 'Use observed valley weight', value: settings.useObservedWeight, hint: 'Copies the latest observed outside planted weight into the plan assumptions.' })}
        </div>
        <div class="active-plan-note"><strong>Live readings:</strong> enabled live plans use fresh carry and Granary reserves pinned to the wallet-read block. Model plans use the saved forecast reserve assumptions.</div>
        ${missingPlanInputs(settings).length ? `<div class="active-plan-required" role="note"><strong>Inputs needed</strong>${errorList(missingPlanInputs(settings))}</div>` : ''}
      </details>
      <div class="active-plan-controls" aria-label="Plan controls">
        <button class="active-plan-button active-plan-primary" type="submit" ${busy ? 'disabled' : ''}>Save &amp; build plan</button>
        <button id="active-rebuild" class="active-plan-button" type="button" ${rebuildDisabled}>Refresh &amp; rebuild</button>
        <button id="active-toggle" class="active-plan-button active-plan-toggle" type="button" aria-pressed="${escapeHtml(toggleState)}" ${toggleDisabled}>${toggleLabel}</button>
        <button id="active-export" class="active-plan-button active-plan-secondary" type="button" ${exportDisabled}>Export active plan</button>
        <button id="active-edit-assumptions" class="active-plan-button active-plan-secondary" type="button">Edit forecast assumptions</button>
      </div>
      <p class="active-plan-helper">Live monitoring reads while this companion is open and visible. It never requests MetaMask.</p>
    </form>
  </section>`;
}

function actionTitle(action) {
  if (!action) return 'Next action';
  const type = String(action.type ?? action.planned_type ?? '').toLowerCase();
  const plot = action.plot_id == null ? '' : ` · plot #${action.plot_id}`;
  if (type === 'plant') return `Plant${plot}`;
  if (type === 'upgrade') return `Upgrade${plot}`;
  if (type === 'claim') return action.plot_ids?.length ? `Claim ${action.plot_ids.length} plots` : 'Claim CROP';
  if (type === 'buy') return 'Buy CROP';
  if (type === 'transfer' || type === 'transfer_crop') return 'Transfer CROP';
  if (type === 'move_plot') return `Move plot${plot}`;
  return words(type, 'Next action');
}

function nextActionCard(action, portfolio, runtime, actionState, isModel) {
  const busy = ['refreshing', 'calculating'].includes(runtime.phase) || !!actionState.busy;
  const pending = !!actionState.hasPending;
  const hasDraft = !!actionState.hasDraft;
  const locked = !!actionState.locked;
  const reviewAllowed = action?.status === 'ready_for_review'
    && !runtime.stale
    && !busy
    && !locked
    && !pending
    && !hasDraft
    && !isModel;
  const status = action?.status ? words(action.status) : 'Plan not calculated';
  const statusClass = action?.status === 'ready_for_review' ? 'is-ready' : action?.status === 'blocked' ? 'is-error' : 'is-waiting';
  const dueAt = formatUtc(action?.due_at_utc, { dateStyle: 'medium', timeStyle: 'short' });
  const wallet = action?.wallet_id == null ? '' : walletLabel(portfolio, action.wallet_id, action.wallet_label);
  const plotIds = Array.isArray(action?.plot_ids) ? action.plot_ids.filter(id => id != null) : [];
  const plots = action?.plot_id != null ? `#${action.plot_id}` : plotIds.length ? plotIds.map(id => `#${id}`).join(', ') : '';
  const details = [
    wallet ? `<div><dt>Wallet</dt><dd>${escapeHtml(wallet)}</dd></div>` : '',
    plots ? `<div><dt>Plot${plotIds.length === 1 || action?.plot_id != null ? '' : 's'}</dt><dd>${escapeHtml(plots)}</dd></div>` : '',
    dueAt ? `<div><dt>Due</dt><dd><time>${escapeHtml(dueAt)}</time></dd></div>` : '',
    action?.crop_shortfall_wei != null ? `<div><dt>Additional liquid CROP needed</dt><dd>${escapeHtml(formatWei(action.crop_shortfall_wei, 'CROP'))}</dd></div>` : '',
    action?.crop_wei != null ? `<div><dt>Proposed CROP amount</dt><dd>${escapeHtml(formatWei(action.crop_wei, 'CROP'))}</dd></div>` : '',
    action?.to_wallet ? `<div><dt>Destination wallet</dt><dd>${escapeHtml(walletLabel(portfolio,action.to_wallet))}</dd></div>` : '',
    action?.crop_cost_wei != null ? `<div><dt>Estimated CROP cost</dt><dd>${escapeHtml(formatWei(action.crop_cost_wei, 'CROP'))}</dd></div>` : ''
  ].filter(Boolean).join('');
  const approval = pending
    ? '<button id="active-open-actions" class="active-plan-button active-plan-primary" type="button">Check pending action</button>'
    : hasDraft
      ? '<button id="active-open-actions" class="active-plan-button active-plan-primary" type="button">Continue action review</button>'
      : reviewAllowed
        ? '<button id="active-review" class="active-plan-button active-plan-primary" type="button">Review next action</button>'
        : '';
  const pendingNote = pending
    ? '<p class="active-plan-warning">A wallet action is pending. Check it before opening another review.</p>'
    : hasDraft
      ? '<p class="active-plan-warning">An action review is already open. Finish or discard it in the action panel.</p>'
      : '';
  const freshnessNote = runtime.stale
    ? '<p class="active-plan-warning">This plan is stale. Refresh and rebuild before reviewing an action.</p>'
    : '';
  const scope = scopeLabel(portfolio, runtime.plan);
  const excluded = Number.isInteger(Number(runtime.plan?.excludedModelPlots)) ? Number(runtime.plan.excludedModelPlots) : 0;
  const scopeNote = runtime.plan
    ? scope === 'Model plan'
      ? '<p class="active-plan-scope-note">Model plan · watch a wallet to review real actions.</p>'
      : `<p class="active-plan-scope-note">Watched wallet plan${excluded > 0 ? ` · ${excluded} model plot${excluded === 1 ? '' : 's'} excluded` : ''}. This step is checked against fresh holdings before review.</p>`
    : '<p class="active-plan-scope-note">Watched actions are checked against fresh holdings. Model plans cannot prepare wallet actions.</p>';
  const why = action?.why || 'Build a plan to compare the next step with the no-upgrade and hold baselines.';
  return `<section class="active-plan-card active-plan-next-card" aria-labelledby="active-plan-next-title">
    <div class="active-plan-card-head"><img class="active-plan-mascot" src="${art.keeper}" alt="" width="72" height="72"><div><p class="active-plan-eyebrow">One next action</p><h3 id="active-plan-next-title">${escapeHtml(actionTitle(action))}</h3></div><span class="active-plan-status ${statusClass}">${escapeHtml(status)}</span></div>
    ${scopeNote}
    ${isModel && action?.status === 'simulation' ? '' : `<p class="active-plan-next-why">${escapeHtml(why)}</p>`}
    ${details ? `<dl class="active-plan-next-details">${details}</dl>` : ''}
    ${pendingNote}
    ${freshnessNote}
    ${action?.required_inputs?.length ? errorList(action.required_inputs) : ''}
    ${approval}
    ${action?.status==='manual'?`<a class="active-plan-button" href="https://rh.farm/" target="_blank" rel="noopener noreferrer">Open Yield Farm ↗</a>${action.planned_type==='buy'?'<p class="active-plan-helper">Record any extra purchase under Already used from cap, then refresh.</p>':''}`:''}
    ${isModel ? '' : '<p class="active-plan-action-note">Each action needs review and MetaMask approval. Purchases and transfers stay manual.</p>'}
  </section>`;
}

function comparisonRows(plan) {
  const rows = [];
  if (plan?.selected && typeof plan.selected === 'object') {
    rows.push({ label: `Selected policy · ${words(plan.selected.policy, 'selected')}`, result: plan.selected, kind: 'selected' });
  }
  if (plan?.baseline && typeof plan.baseline === 'object') {
    rows.push({ label: 'No upgrades · current assumptions', result: plan.baseline, kind: 'baseline' });
  }
  if (plan?.hold && typeof plan.hold === 'object') {
    rows.push({ label: 'No actions · keep current farm', result: plan.hold, kind: 'hold' });
  }
  if (Array.isArray(plan?.stress)) {
    plan.stress.slice(0, 3).forEach((result, index) => {
      if (result && typeof result === 'object') rows.push({ label: words(result.label, `Stress case ${index + 1}`), result, kind: 'stress' });
    });
  }
  return rows;
}

function comparisonTable(plan) {
  const rows = comparisonRows(plan);
  if (!rows.length) return '';
  const selected = plan?.selected;
  const baseline = plan?.baseline;
  const hold = plan?.hold;
  const selectedSummary = selected ? `
    <dl class="active-plan-selected-summary" aria-label="Selected policy outcome">
      <div><dt>Net CROP</dt><dd>${escapeHtml(formatWei(selected.net_crop_wei, 'CROP'))}<small>${escapeHtml(difference(selected.net_crop_wei, baseline?.net_crop_wei, 'CROP'))} vs no upgrades · ${escapeHtml(difference(selected.net_crop_wei, hold?.net_crop_wei, 'CROP'))} vs hold</small></dd></div>
      <div><dt>Operating ETH</dt><dd>${escapeHtml(formatWei(selected.operating_eth_wei, 'ETH', 6))}<small>${escapeHtml(difference(selected.operating_eth_wei, baseline?.operating_eth_wei, 'ETH', 6))} vs no upgrades · ${escapeHtml(difference(selected.operating_eth_wei, hold?.operating_eth_wei, 'ETH', 6))} vs hold</small></dd></div>
    </dl>` : '';
  const htmlRows = rows.map(({ label, result, kind }) => {
    const status = result.status && result.status !== 'ok' ? `<small class="active-plan-row-status">${escapeHtml(words(result.status))}</small>` : '';
    const errors = result.status && result.status !== 'ok' ? errorList(result.errors) : '';
    return `<tr class="active-plan-row-${kind}"><td data-label="Case"><strong>${escapeHtml(label)}</strong>${status}${errors}</td><td class="active-plan-number" data-label="Net CROP">${escapeHtml(formatWei(result.net_crop_wei, 'CROP'))}</td><td class="active-plan-number" data-label="Operating ETH">${escapeHtml(formatWei(result.operating_eth_wei, 'ETH', 6))}</td></tr>`;
  }).join('');
  const metadata = [
    Number.isInteger(Number(plan.settings?.days)) && Number(plan.settings.days) > 0 ? `<span>${Number(plan.settings.days)} days</span>` : '',
    plan.block_number != null ? `<span>Read block ${escapeHtml(plan.block_number)}</span>` : ''
  ].filter(Boolean).join('');
  return `<section class="active-plan-card active-plan-comparison-card" aria-labelledby="active-plan-comparison-title">
    <div class="active-plan-card-head"><div><h3 id="active-plan-comparison-title">Selected policy and alternatives</h3>${metadata ? `<div class="active-plan-result-meta">${metadata}</div>` : ''}</div><div class="active-plan-comparison-badges">${selected ? `<span class="active-plan-policy">${escapeHtml(words(selected.policy, 'selected policy'))} · ${escapeHtml(words(selected.funding, 'funding'))} · ${escapeHtml(words(selected.objective, 'objective'))}</span>` : ''}<span class="active-plan-status ${plan.status === 'ok' ? 'is-live' : 'is-stale'}">${escapeHtml(words(plan.status, 'not calculated'))}</span></div></div>
    ${selectedSummary}
    <p class="active-plan-helper">Operating ETH is estimated from price and fee assumptions, not realized profit.</p>
    <details class="active-plan-comparison-details">
      <summary>Compare no upgrades, hold &amp; stress cases</summary>
      <p class="active-plan-helper">Stress cases rerun the selected policy. The winner is the best among evaluated policies and budget fractions, not a global optimum.</p>
      <div class="active-plan-table-wrap"><table class="active-plan-comparison"><thead><tr><th scope="col">Case</th><th scope="col">Net CROP</th><th scope="col">Operating ETH</th></tr></thead><tbody>${htmlRows}</tbody></table></div>
    </details>
  </section>`;
}

function actionDescription(action, portfolio) {
  const type = String(action?.type ?? '').toLowerCase();
  const plot = action?.plot_id == null ? '' : `plot #${action.plot_id}`;
  if (type === 'plant') return `Plant ${plot}`;
  if (type === 'upgrade') return `Upgrade ${plot}${action.to_level == null ? '' : ` to level ${action.to_level}`}`;
  if (type === 'claim') return 'Claim this wallet’s pending CROP';
  if (type === 'buy') return action.initial_planting ? 'Buy CROP for initial planting' : 'Buy CROP';
  if (type === 'transfer_crop') return `Transfer CROP to ${walletLabel(portfolio, action.to_wallet)}`;
  if (type === 'move_plot') return `Move ${plot}; activation resets`;
  return words(type, 'Planned step');
}

function actionAmount(action) {
  const type = String(action?.type ?? '').toLowerCase();
  if (type === 'buy') {
    const crop = formatWei(action.crop_wei, 'CROP');
    const eth = action.eth_wei == null ? 'ETH quote missing' : formatWei(action.eth_wei, 'ETH', 6);
    return `${crop} · ${eth}`;
  }
  if (['plant', 'upgrade', 'claim', 'transfer_crop'].includes(type)) return formatWei(action.crop_wei, 'CROP');
  return '—';
}

function actionDate(plan, action) {
  const day = action?.day;
  const start = Date.parse(String(plan?.scenario?.start ?? plan?.generated_at ?? ''));
  const offset = Number(day);
  const due = Date.parse(String(action?.due_at_utc ?? ''));
  const timestamp = Number.isFinite(due) ? due : Number.isFinite(start) && Number.isInteger(offset) && offset >= 0 ? start + offset * DAY_MS : NaN;
  if (!Number.isFinite(timestamp)) return `Day ${Number.isInteger(offset) ? offset + 1 : '—'}`;
  const date = new Date(timestamp);
  let formatted = '';
  try {
    formatted = new Intl.DateTimeFormat(undefined, {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
    }).format(date);
  } catch {
    formatted = date.toISOString().slice(0, 10);
  }
  return `Day ${Number.isInteger(offset) && offset >= 0 ? offset + 1 : '—'} · ${formatted} UTC`;
}

function ledgerDetails(plan, portfolio) {
  const selected = object(plan?.selected);
  const actions = Array.isArray(selected.actions) ? selected.actions.filter(action => action && typeof action === 'object') : [];
  const shownActions = actions.slice(0, 12);
  const ledgerRows = shownActions.map(action => `<tr>
    <td data-label="Day · date">${escapeHtml(actionDate(plan, action))}</td>
    <td data-label="Wallet">${escapeHtml(walletLabel(portfolio, action.wallet_id, action.wallet_label))}</td>
    <td data-label="Step">${escapeHtml(actionDescription(action, portfolio))}</td>
    <td data-label="CROP / ETH">${escapeHtml(actionAmount(action))}</td>
  </tr>`).join('');
  const ledger = actions.length
    ? `<div class="active-plan-table-wrap"><table class="active-plan-ledger"><thead><tr><th scope="col">Day · date</th><th scope="col">Wallet</th><th scope="col">Step</th><th scope="col">Amount</th></tr></thead><tbody>${ledgerRows}</tbody></table></div>${actions.length > 12 ? `<p class="active-plan-helper">Showing the first 12 of ${actions.length} planned steps. Export the plan for the full ledger.</p>` : ''}`
    : '<p class="active-plan-helper">This policy has no planned transactions. Holding the current farm remains a valid result.</p>';

  const metrics = [
    ['Earned CROP', formatWei(selected.earned_crop_wei, 'CROP')],
    ['Spent CROP', formatWei(selected.spent_crop_wei, 'CROP')],
    ['Bought CROP', formatWei(selected.bought_crop_wei, 'CROP')],
    ['Initial planting purchases', formatWei(selected.initial_planting_purchases_crop_wei, 'CROP')],
    ['Extra ETH cap used', formatWei(selected.extra_investment_eth_wei, 'ETH', 6)],
    ['CROP purchase cost', formatWei(selected.purchase_cost_eth_wei, 'ETH', 6)],
    ['Estimated operation fees', formatWei(selected.gas_eth_wei, 'ETH', 6)],
    ['Ending liquid CROP', formatWei(selected.liquid_crop_wei, 'CROP')],
    ['Ending pending CROP', formatWei(selected.pending_crop_wei, 'CROP')],
    ['Ending total CROP', formatWei(selected.ending_crop_wei, 'CROP')],
    ['Remaining wallet ETH', formatWei(selected.remaining_eth_wei, 'ETH', 6)]
  ];
  const metricHtml = metrics.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
  const assumptions = Array.isArray(selected.assumptions) ? errorList(selected.assumptions) : '';
  return `<details class="active-plan-ledger-details">
    <summary>Action ledger, costs &amp; CROP flows</summary>
    <h4>Upcoming steps</h4>
    ${ledger}
    <div class="active-plan-calculation-note"><strong>Planting route:</strong> this plan models planting with CROP. ETH seed-bag planting remains available in Farm actions.</div>
    <h4>Capital, fees and CROP flows</h4>
    <dl class="active-plan-ledger-metrics">${metricHtml}</dl>
    ${assumptions ? `<h4>Calculation notes</h4>${assumptions}` : ''}
  </details>`;
}

function rareFirstNote(insights) {
  const rare = object(insights?.rare_first);
  if (!rare.explanation) return '';
  const candidate = object(rare.candidate);
  const best = object(rare.best_next_step);
  const candidateLine = Number.isFinite(Number(candidate.plot_id))
    ? `Rarest next step: plot #${candidate.plot_id} to level ${candidate.to_level ?? '—'}.`
    : '';
  const bestLine = Number.isFinite(Number(best.plot_id))
    ? `Highest next-step CROP efficiency: plot #${best.plot_id} to level ${best.to_level ?? '—'}.`
    : '';
  return `<aside class="active-plan-rare-note"><strong>Rarity is a diagnostic, not the ranking.</strong><p>${escapeHtml(rare.explanation)}</p>${candidateLine || bestLine ? `<small>${escapeHtml([candidateLine, bestLine].filter(Boolean).join(' '))}</small>` : ''}</aside>`;
}

function planResults(plan, portfolio, runtime) {
  if (!plan) {
    return `<section class="active-plan-card active-plan-empty-result" aria-labelledby="active-plan-result-title">
      <p class="active-plan-eyebrow">Plan result</p><h3 id="active-plan-result-title">Ready when your farm is set up</h3>
      <p>Build a plan to see the selected result and next action.</p>
    </section>`;
  }
  const planSettings = { ...DEFAULTS, ...object(plan.settings) };
  const planErrors = Array.isArray(plan.errors) ? plan.errors : [];
  const requiredInputs = [
    ...(Array.isArray(plan.insights?.required_inputs) ? plan.insights.required_inputs : []),
    ...missingPlanInputs(planSettings)
  ];
  const help = errorList(planErrors);
  const required = errorList(requiredInputs);
  const resultStatus = plan.status && plan.status !== 'ok'
    ? `<div class="active-plan-required" role="status"><strong>Plan unavailable</strong>${errorList([...planErrors, ...requiredInputs]) || help || '<p>Complete the required assumptions and rebuild the plan.</p>'}</div>`
    : '';
  const requiredStatus = plan.status === 'ok' && required
    ? `<div class="active-plan-required" role="note"><strong>Required assumptions</strong>${required}</div>`
    : '';
  const comparisons = comparisonTable(plan);
  const ledger = plan.selected ? ledgerDetails(plan, portfolio) : '';
  const rare = rareFirstNote(plan.insights);
  const fallbackHeading = comparisons ? '' : `<div class="active-plan-card active-plan-result-heading"><div><h3>${plan.status === 'ok' ? 'Plan ready' : 'Review the plan inputs'}</h3></div><span class="active-plan-status ${plan.status === 'ok' ? 'is-live' : 'is-stale'}">${escapeHtml(words(plan.status, 'not calculated'))}</span></div>`;
  const basis = `<details class="active-plan-method-details"><summary>Assumptions &amp; model limits</summary><p class="active-plan-helper">Future results depend on the selected weather, valley weight, price and fee assumptions. Annual release ceilings, carry and the finite Granary can limit the nominal rate.</p></details>`;
  const rarity = rare ? `<details class="active-plan-method-details"><summary>Why rarity may not rank first</summary>${rare}</details>` : '';
  return `<section class="active-plan-results" aria-label="Active plan results">
    ${fallbackHeading}${resultStatus}${requiredStatus}
    ${comparisons}
    ${ledger}
    ${rarity}${basis}
  </section>`;
}

function holdingsSetup(portfolio) {
  const wallets = Array.isArray(portfolio?.wallets) ? portfolio.wallets : [];
  const plotCount = wallets.reduce((sum, wallet) => sum + (Array.isArray(wallet?.plots) ? wallet.plots.length : 0), 0);
  if (!wallets.length) {
    return `<section class="active-plan-card active-plan-setup" aria-labelledby="active-plan-setup-title">
      <p class="active-plan-eyebrow">Start with your farm</p><h3 id="active-plan-setup-title">Add holdings to build a useful plan</h3>
      <p>Add a public wallet or a labeled model farm in My farm. Refresh wallets before action reviews.</p>
      <div class="active-plan-controls"><button id="active-add-wallet" class="active-plan-button active-plan-primary" type="button" data-active-plan-nav="farm">Open My farm</button><button id="active-refresh" class="active-plan-button" type="button" data-active-plan-nav="refresh">Refresh holdings</button></div>
    </section>`;
  }
  if (!plotCount) {
    return `<section class="active-plan-card active-plan-setup" aria-labelledby="active-plan-setup-title">
      <p class="active-plan-eyebrow">Holdings needed</p><h3 id="active-plan-setup-title">Refresh to read plots</h3>
      <p>Refresh wallet holdings to read owned plots and revealed traits.</p>
      <div class="active-plan-controls"><button id="active-refresh" class="active-plan-button active-plan-primary" type="button" data-active-plan-nav="refresh">Refresh holdings</button><button id="active-add-wallet" class="active-plan-button" type="button" data-active-plan-nav="farm">Open My farm</button></div>
    </section>`;
  }
  return '';
}

export function activePlanView({ portfolio = null, settings = {}, runtime = {}, actionState = {}, now = Date.now(), settingsCollapsed = false, simple = false } = {}) {
  const farm = object(portfolio);
  const planSettings = { ...DEFAULTS, ...object(settings) };
  const state = object(runtime);
  const action = object(actionState);
  const plan = state.plan && typeof state.plan === 'object' ? object(state.plan) : null;
  const wallets = Array.isArray(farm.wallets) ? farm.wallets.filter(wallet => wallet && typeof wallet === 'object') : [];
  const hasWatchedWallet = wallets.some(wallet => typeof wallet.address === 'string' && wallet.address.trim());
  const modelPlan = typeof plan?.scope === 'string'
    ? plan.scope === 'model'
    : !hasWatchedWallet;
  const nextAction = state.nextAction && typeof state.nextAction === 'object'
    ? state.nextAction
    : plan?.insights?.next_action && typeof plan.insights.next_action === 'object'
      ? plan.insights.next_action
      : null;

  return `<div class="active-plan">
    <header class="active-plan-heading">
      <h2>Active plan</h2>
      <span class="active-plan-status ${phaseClass(state, planSettings)}">${escapeHtml(phaseLabel(state, planSettings))}</span>
    </header>
    <div class="active-plan-workspace">
      <div class="active-plan-settings-column" data-collapsed="${settingsCollapsed}">
        <button id="active-toggle-settings" class="active-plan-settings-toggle" aria-expanded="${!settingsCollapsed}" aria-controls="active-plan-configuration">${settingsCollapsed ? 'Edit plan settings' : 'Hide plan settings'}<span>${escapeHtml(planSettings.days)} days · ${planSettings.funding === 'extra' ? 'Extra investment' : 'Harvest-funded'}</span></button>
        <div id="active-plan-configuration">
          ${settingsForm(planSettings, state, action, !!plan, simple)}
          ${holdingsSetup(farm)}
        </div>
      </div>
      <div class="active-plan-outcome-column">
        ${nextActionCard(nextAction, farm, state, action, modelPlan)}
        ${planResults(plan, farm, state)}
      </div>
    </div>
  </div>`;
}

export function activePlanTeaser({ settings = {}, runtime = {}, actionState = {} } = {}) {
  const planSettings = { ...DEFAULTS, ...object(settings) };
  const state = object(runtime);
  const action = object(actionState);
  const next = state.nextAction && typeof state.nextAction === 'object'
    ? state.nextAction
    : state.plan?.insights?.next_action && typeof state.plan.insights.next_action === 'object'
      ? state.plan.insights.next_action
      : null;
  const title = action.hasPending ? 'A wallet action is pending'
    : next?.why ? String(next.why)
      : state.plan?.status === 'ok' ? 'Your plan is ready to review'
        : 'Compare a guided plan for this farm';
  const detail = state.stale ? 'Refresh and rebuild before reviewing.'
    : state.error ? String(state.error)
      : planSettings.enabled ? `Live plan · ${planSettings.days} days · ${planSettings.refreshSeconds}s refresh`
        : `Paused · ${planSettings.days} day${Number(planSettings.days) === 1 ? '' : 's'}`;
  return `<aside class="active-plan-teaser" aria-label="Active guided plan">
    <div class="active-plan-teaser-copy"><p class="active-plan-eyebrow">Guided plan · ${planSettings.enabled ? 'Live' : 'Paused'}</p><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div>
    <button id="open-active-plan" class="active-plan-button active-plan-primary" type="button">Open active plan</button>
  </aside>`;
}
