import css from './styles.css';
import gaps from '../knowledge/unresolved.md';
import { rules, UNIT, units, amount, inputAmount, weight, clone, json, allPlots, emptyPortfolio, defaults, demoPortfolio, validatePortfolio, validateScenario } from './model.js';
import { createReader, fetchJSON } from './reader.js';
import { compare } from './engine.js';
import { buildGuidedPlan, planDefaults, validatePlanSettings, validateExecutionLog } from './planner.js';
import { createExecutor, validatePendingRecord } from './execution.js';
import { guidedPage } from './guided-view.js';
import { readSeason, validateSeason, weatherName, seasonPhase, mintPreparation } from './season.js';
import cachedSeason from '../knowledge/snapshots/season-2026-09-07.json' with { type: 'json' };
import { cyclicAllocation } from './allocation.js';
import { eventWindows } from './weather.js';
import questions from '../knowledge/questions.json' with { type: 'json' };
import sourceIndex from '../knowledge/sources.json' with { type: 'json' };
import { fundingDefaults, validateFunding, validateQuote, readEthQuote, fundingAdvice } from './funding.js';
import pixelFont from '../assets/press-start-2p.ttf';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const leaf = '<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 35V16M20 25C7 26 4 17 5 9c9 0 16 5 15 16ZM20 19C19 7 28 3 36 4c0 9-5 16-16 15Z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const field = (name, label, value, hint = '', type = 'text') => `<div class="field"><label for="f-${name}">${esc(label)}</label><input id="f-${name}" name="${name}" value="${esc(value)}" type="${type}" ${type === 'number' ? 'step="any" min="0"' : ''}><span class="hint">${esc(hint)}</span></div>`;
const tag = tier => tier == null ? '<span class="muted">Unrevealed / unknown</span>' : `<span class="tier"><i class="seed tier-${tier}"></i>${rules.plots.rarities[tier]?.name ?? 'Unknown'}</span>`;
const badgeAmount = (v, p = 0) => `<span class="${v == null ? '' : BigInt(v) >= 0n ? 'positive' : 'negative'}">${amount(v, p)}</span>`;
function download(name, value, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function parseWorkspace(text) {
  const parsed = JSON.parse(text);
  const portfolio = parsed.portfolio ?? parsed;
  const errors = validatePortfolio(portfolio, false);
  if (errors.length) throw new Error(errors.join(' '));
  if (portfolio.is_demo && parsed.pendingExecution) throw new Error('A demo workspace cannot carry a pending wallet transaction.');
  const scenario = { ...defaults(), ...(parsed.scenario ?? {}) };
  // Partial scenario inputs are permitted, but malformed/oversized schedules are not.
  const structural = validateScenario({ ...scenario, externalWeight: scenario.externalWeight || '0' }).filter(e => !e.includes('must be an explicit'));
  if (structural.length) throw new Error(structural.join(' '));
  if (parsed.history != null && (!Array.isArray(parsed.history) || parsed.history.some(h => !h || typeof h.at !== 'string' || !Number.isFinite(Date.parse(h.at)) || !Number.isSafeInteger(h.block) || h.block < 0 || h.pending_crop_wei != null && (typeof h.pending_crop_wei !== 'string' || !/^\d{1,78}$/.test(h.pending_crop_wei)) || h.weather_bps != null && (!Number.isSafeInteger(h.weather_bps) || h.weather_bps < 0)))) throw new Error('Observation history contains invalid records.');
  return { portfolio, scenario, planSettings:validatePlanSettings(parsed.planSettings ?? planDefaults()), pendingExecution:validatePendingRecord(parsed.pendingExecution), executionLog:validateExecutionLog(parsed.executionLog ?? []), funding:validateFunding(parsed.funding ?? fundingDefaults()), quote:parsed.quote ? validateQuote(parsed.quote) : null, profile_seeded:parsed.profile_seeded === true, season: parsed.season ? validateSeason(parsed.season) : null, autoRefresh: parsed.autoRefresh === true, history: Array.isArray(parsed.history) ? parsed.history.slice(-12) : [] };
}
export function mount(host, { storage, transport = fetchJSON, compact = false, isVisible = () => true, walletProvider = () => globalThis.ethereum } = {}) {
  if (typeof FontFace !== 'undefined' && ![...document.fonts].some(f => f.family.replaceAll('"', '') === 'Farm Pixel')) new FontFace('Farm Pixel', `url(${pixelFont})`).load().then(font => document.fonts.add(font)).catch(() => {});
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${css}</style><div class="${compact ? 'compact' : ''}" id="view"></div><div id="notices" aria-live="polite"></div>`;
  const view = root.querySelector('#view'), reader = createReader(transport);
  let state = { portfolio: emptyPortfolio(), scenario: defaults(), history: [], autoRefresh: false }, tab = 'overview', results = null, chosen = null, busy = false, refreshing = false, revision = 0, job = 0, noticeTimer, modal = null, actionLimit = 20;
  let storageError = null, demoBackup = null;
  let guidedPlan = null, draft = null, executionBusy = false;
  let priceRefreshing = false;
  let seasonRefreshing = false;
  let hypotheticalIds = Array.from({ length: 22 }, (_, i) => i + 1).join(', '), allocation = null, sourceAwareAllocation = true;
  try { const saved = storage.get(); if (saved) state = parseWorkspace(saved); } catch (e) { storageError = `Saved workspace could not be loaded: ${e.message}. The original saved value has not been overwritten.`; }
  const configured = typeof __INITIAL_WORKSPACE__ === 'undefined' ? null : __INITIAL_WORKSPACE__;
  if (!storageError && configured && !state.profile_seeded && !state.portfolio.is_demo && !allPlots(state.portfolio).length && state.portfolio.wallets.every(w => !w.address)) {
    state = parseWorkspace(json(configured)); state.profile_seeded = true;
    try { storage.set(json(state)); } catch (e) { storageError = e.message; }
  }
  state.funding ??= fundingDefaults(); state.quote ??= null;
  state.planSettings ??= planDefaults(); state.executionLog ??= []; state.pendingExecution ??= null;
  const executor = createExecutor({ rpc:reader.rpc, getProvider:walletProvider, onPending:async record => {
    if (state.portfolio.is_demo || storageError) throw new Error('Restore a writable real workspace before requesting wallet approval.');
    const next = {...state, pendingExecution:record};
    // A failed persistence write aborts the wallet request; never lose a possible broadcast lock.
    storage.set(json({...next,schema_version:1})); state = next;
  }});
  if (state.pendingExecution) executor.resumePending(state.pendingExecution);
  let worker;
  try {
    const url = URL.createObjectURL(new Blob([__WORKER_SOURCE__], { type: 'text/javascript' }));
    worker = new Worker(url); URL.revokeObjectURL(url);
    worker.onmessage = ({ data }) => { if (data.id !== job) return; busy = false; if (data.error) notify(data.error); else if (data.plan) guidedPlan = data.plan; else { results = data.results; chooseDefault(); } render(); };
    worker.onerror = () => { worker.terminate(); worker = null; busy = false; notify('Background calculation was unavailable. Try Compare again to run locally.'); render(); };
  } catch { worker = null; }
  function notify(message) {
    clearTimeout(noticeTimer); const node = document.createElement('div'); node.className = 'toast'; node.textContent = message;
    root.querySelector('#notices').replaceChildren(node); noticeTimer = setTimeout(() => node.remove(), 6500);
  }
  function save(invalidate = true) {
    if (invalidate) { revision++; job++; results = null; chosen = null; guidedPlan = null; draft = null; busy = false; }
    if (state.portfolio.is_demo) return;
    try { storage.set(json({ ...state, schema_version: 1 })); storageError = null; } catch (e) { storageError = `Changes are in memory only. Export a backup: ${e.message}`; notify(storageError); }
  }
  function canReplaceWorkspace() {
    if (executionBusy || executor.status().pending) { notify('Finish checking the outstanding wallet action before replacing this workspace.'); return false; }
    return true;
  }
  function journal(action,status,hash=null) {
    state.executionLog=[...(state.executionLog??[]),{at:new Date().toISOString(),type:action.type,wallet_id:action.wallet_id,status,hash}].slice(-100);
    save(false);
  }
  async function executionTask(action) {
    if(executionBusy) return;
    executionBusy=true; render();
    try { await action(); } catch(error) { notify(error.message); }
    finally { executionBusy=false; render(); }
  }
  function prepareAction(intent, guided = false) {
    return executionTask(async()=>{
      draft=null;
      if(refreshing || seasonRefreshing) throw new Error('Wait for the current public refresh to finish, then prepare again.');
      const at=revision;
      if(state.portfolio.is_demo) throw new Error('Demo transactions are disabled.');
      if(storageError) throw new Error('Restore a writable workspace before preparing an action.');
      if(guided && intent.type!=='claim') {
        const s=state.scenario;
        if(!s.buyPrice || !s.sellPrice || s.feeMode==='unknown' || !state.funding.reserveEth) throw new Error('Before a guided investment, enter CROP buy/exit prices, explicit action fees and a wallet fee reserve in Strategy lab and Overview.');
        const candidates=intent.type==='plant'?guidedPlan?.insights?.planting:guidedPlan?.insights?.upgrades?.filter(r=>r.steps===1);
        const candidate=candidates?.find(r=>r.plot_id===intent.plot_id&&r.wallet_id===intent.wallet_id);
        if(!candidate || candidate.net_eth_existing_crop_wei==null || candidate.net_eth_existing_crop_wei<=0n) throw new Error('This investment has no positive estimated marginal ETH return within the horizon. Adjust the horizon or assumptions before a guided review.');
      }
      const prepared=await executor.prepare(intent,clone(state.portfolio));
      if(at!==revision) throw new Error('Workspace changed during simulation. Refresh the plan and prepare a new review.');
      if(intent.type!=='claim' && state.funding.reserveEth && BigInt(prepared.native_balance_wei)-BigInt(prepared.network_cost_limit_wei)<units(state.funding.reserveEth)) throw new Error('This action would dip into your chosen ETH fee reserve. Adjust the reserve or fund the wallet first.');
      draft={...prepared,workspace_revision:at};
      notify('Contract checks and simulation passed. Review the transaction before requesting wallet approval.');
    });
  }
  function beginGuided() {
    if (busy || executionBusy) return;
    draft=null; busy=true; const id=++job; render();
    const data={id,mode:'guided',portfolio:clone(state.portfolio),scenario:clone(state.scenario),settings:clone(state.planSettings),now:Date.now()};
    if(worker) worker.postMessage(data);
    else setTimeout(()=>{if(id!==job)return;try{guidedPlan=buildGuidedPlan(data.portfolio,data.scenario,data.settings,data.now);}catch(error){notify(error.message);}busy=false;render();},50);
  }
  function chooseDefault() { chosen = results?.find(r => r.days === 90 && r.funding === 'harvest')?.bestCrop ?? results?.find(r => r.status === 'ok')?.bestCrop ?? null; actionLimit = 20; }
  function beginCompare() {
    const errors = [...validatePortfolio(state.portfolio), ...validateScenario(state.scenario), ...(state.portfolio.rule_conflicts ?? [])];
    if (errors.length) { notify(errors[0]); results = [{ status: 'unavailable', errors }]; render(); return; }
    busy = true; const id = ++job; render();
    if (worker) worker.postMessage({ id, portfolio: clone(state.portfolio), scenario: clone(state.scenario) });
    else setTimeout(() => {
      if (id !== job) return;
      try { results = compare(state.portfolio, state.scenario); chooseDefault(); } catch (e) { notify(e.message); }
      busy = false; render();
    }, 50);
  }
  async function refresh() {
    if (!state.portfolio.wallets.every(w => w.address)) return refreshSeason();
    if (refreshing || executionBusy) return false;
    let succeeded = false;
    refreshing = true; const at = revision; render();
    try {
      const snapshot = await reader.snapshot(state.portfolio);
      if (at !== revision) { notify('Workspace changed during refresh; the older read was discarded.'); return; }
      const oldWeather = state.portfolio.effective_weather_multiplier_bps;
      state.portfolio = snapshot; succeeded = !snapshot.read_errors.length;
      state.history = [...state.history, { at: snapshot.observed_at_utc, block: snapshot.block_number, pending_crop_wei: allPlots(snapshot).every(p => p.pending_crop_wei != null) ? allPlots(snapshot).reduce((a, p) => a + BigInt(p.pending_crop_wei), 0n).toString() : null, weather_bps: snapshot.effective_weather_multiplier_bps }].slice(-12);
      save();
      if (oldWeather != null && oldWeather !== snapshot.effective_weather_multiplier_bps && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Yield Farm weather changed', { body: `Observed multiplier: ${(snapshot.effective_weather_multiplier_bps ?? 0) / 10000}×. Open your companion for details.` });
      notify(snapshot.read_errors.length ? `Read block ${snapshot.block_number.toLocaleString()}; ${snapshot.read_errors.length} incomplete reads are listed under Evidence.` : `Both wallets refreshed at block ${snapshot.block_number.toLocaleString()}.`);
    } catch (e) { notify(`Refresh failed. Previous snapshot retained: ${e.message}`); }
    finally { refreshing = false; render(); }
    await refreshSeason();
    await refreshPrice();
    if (succeeded && state.planSettings.enabled) beginGuided();
    return succeeded;
  }
  async function refreshPrice() {
    if (priceRefreshing) return;
    priceRefreshing = true; const at = revision;
    try { const quote = await readEthQuote(transport); if (at === revision) { state.quote = quote; save(false); notify('ETH/USD funding valuation updated.'); } }
    catch (e) { notify(`Price read failed; previous quote retained: ${e.message}`); }
    finally { priceRefreshing = false; render(); }
  }
  function fundingPanel() {
    const report = fundingAdvice(state.portfolio, state.funding, state.quote, state.scenario);
    return `<section class="card funding-board" aria-label="Actions needed"><div class="card-head"><div><div class="eyebrow">Your next moves</div><h2>Actions needed</h2></div><span class="tag ${report.all_targets_met ? 'funded' : ''}">${report.all_targets_met ? 'Both USD targets met' : 'Review funding status'}</span></div><p class="muted">${state.portfolio.is_demo ? 'Fictional demo balances' : 'Native ETH on Robinhood Chain'} · target $${esc(state.funding.targetUsd)} per wallet. Tokens on other chains or other assets are not included.</p><div class="wallet-grid funding-wallets">${report.wallets.map(w => `<article class="funding-wallet"><div class="card-head"><h3>${esc(w.label)}</h3><span class="tag">${w.target_met == null ? 'Needs fresh data' : w.target_met ? 'Target met' : 'Below target'}</span></div><a class="wallet-address" href="https://robinhoodchain.blockscout.com/address/${esc(w.address ?? '')}" target="_blank" rel="noopener noreferrer">${esc(w.address ?? 'Address not set')}</a><div class="funding-total">${w.usd == null ? 'USD unknown' : '$' + w.usd.toFixed(2)}<small>${amount(w.eth_wei, 6)} ETH${w.fresh ? '' : ' · stale / unverified'}</small></div><dl><div><dt>Remaining mint plan · ${w.remaining_mints} plots</dt><dd>${amount(w.mint_wei, 3)} ETH</dd></div><div><dt>ETH after planned mint, before fees</dt><dd>${amount(w.after_mint_wei, 6)}</dd></div><div><dt>Liquid CROP</dt><dd>${amount(w.crop_wei, 0)}</dd></div><div><dt>Additional planting CROP needed</dt><dd>${amount(w.crop_gap_wei, 0)}</dd></div><div><dt>ETH after mint & chosen fee reserve</dt><dd>${amount(w.after_reserve_wei, 6)}</dd></div></dl></article>`).join('')}</div>${configured && !state.portfolio.is_demo && state.portfolio.wallets.some((w, i) => w.address?.toLowerCase() !== configured.portfolio.wallets[i].address.toLowerCase()) ? '<div class="banner info">Your configured two-wallet profile is available.<button class="btn small" id="load-configured">Load configured wallets</button></div>' : ''}<div class="action-list">${report.actions.map(a => `<article class="action-item"><span class="action-kind ${a.kind}">${a.kind === 'action' ? 'Action' : a.kind === 'later' ? 'Upcoming' : 'Check'}</span><div><h3>${esc(a.title)}</h3><p class="muted">${esc(a.detail)}</p></div></article>`).join('')}</div><details class="detail"><summary>Funding target, fee reserve & price source</summary><form id="funding-form"><div class="fields two">${field('targetUsd','Target funding per wallet · USD',state.funding.targetUsd)}${field('reserveEth','Keep for network fees per wallet · ETH',state.funding.reserveEth,'Your planning reserve, not an observed gas estimate. Blank = undecided.')}</div><div class="buttons"><button class="btn small" type="submit">Save funding preferences</button><button class="btn small" type="button" id="refresh-price">Refresh ETH/USD price</button><button class="btn small" type="button" data-tab="scenarios">Open Strategy lab</button></div></form><p class="muted" style="margin-top:12px">${state.quote ? `Coinbase ETH/USD spot: $${esc(state.quote.eth_usd)} · read ${esc(state.quote.observed_at_utc)}. Quotes expire for advice after 15 minutes.` : 'No ETH/USD quote recorded.'} USD valuation is indicative; your deposits and executable trade prices may differ. Balance block: ${esc(state.portfolio.block_number ?? 'unknown')} · ${esc(state.portfolio.observed_at_utc ?? 'not observed')}.</p></details></section>`;
  }
  async function refreshSeason() {
    if (seasonRefreshing || executionBusy) return;
    seasonRefreshing = true; const at = revision; render();
    try {
      const next = await readSeason(reader.rpc);
      if (at !== revision) return notify('Workspace changed during the season read; please refresh again.');
      const old = state.season?.effective_multiplier_bps;
      state.season = next; save(false);
      if (old != null && next.effective_multiplier_bps != null && old !== next.effective_multiplier_bps && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Yield Farm weather changed', { body: `Observed ${weatherName(next.weather_enum)} · ${next.effective_multiplier_bps / 10000}×.` });
      notify(`Season read at block ${next.block_number.toLocaleString()}${next.read_errors.length ? '; some fields are unavailable.' : '.'}`);
    } catch (e) { notify(`Season refresh failed. Previous observation retained: ${e.message}`); }
    finally { seasonRefreshing = false; render(); }
  }
  function seasonPanel() {
    const s = state.season ?? cachedSeason, preparation = mintPreparation(state.portfolio.expected_total_plots);
    const utc = t => t == null ? 'Unknown' : new Date(t * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
    const flag = v => v == null ? 'Unknown' : v ? 'Active' : 'Inactive';
    const age = Math.max(0, Math.floor((Date.now() - Date.parse(s.observed_at_utc)) / 60000));
    return `<section class="card season-card" aria-label="Public season"><div class="card-head"><div><h2>The season, before your plots</h2><p class="muted">Public contract state · no wallet address needed</p></div><button class="btn small" id="refresh-season" ${seasonRefreshing ? 'disabled' : ''}>${seasonRefreshing ? 'Reading season…' : 'Refresh season'}</button></div><div class="stats"><div class="stat"><div class="label">Oracle weather · epoch ${esc(s.current_epoch ?? 'unknown')}</div><div class="value">${esc(weatherName(s.weather_enum))}</div><div class="foot">Effective now: ${s.effective_multiplier_bps == null ? 'unknown' : esc(s.effective_multiplier_bps / 10000) + '×'}</div></div><div class="stat"><div class="label">Farm phase at block</div><h3>${esc(seasonPhase(s))}</h3><div class="foot">Genesis: ${esc(utc(s.genesis_timestamp))}</div></div><div class="stat"><div class="label">Minted across the farm</div><div class="value">${esc(s.minted_count ?? '—')}</div><div class="foot">Total planted weight: ${s.total_weight_bps == null ? 'unknown' : esc(s.total_weight_bps / 10000)}</div></div><div class="stat"><div class="label">Temporary events</div><h3>Flood: ${flag(s.flood_active)}</h3><div class="foot">Harvest Moon: ${flag(s.moon_active)}</div></div></div><p class="muted">${s.block_timestamp < s.genesis_timestamp ? 'The oracle already returns a weather value, but farming has not started. This observation does not guarantee the launch week or later weeks.' : 'This is a current oracle observation, not a forecast for the whole investment horizon.'} Next contract boundary: ${esc(utc(s.next_boundary_timestamp))}.</p><div class="banner" style="margin-top:16px">Verified source differs from the Almanac’s sealed-weather promise: the stored commitment is not enforced by scheduling, and future epochs can be overwritten before their cutoff. <button class="btn small" data-tab="research">Read contract findings</button></div><p class="muted" style="margin-top:10px">${state.season ? 'Saved public read' : 'Bundled historical snapshot'} · ${esc(s.observed_at_utc)} · ${age} min old${age > 2 ? ' · refresh for current state' : ''} · <a href="https://robinhoodchain.blockscout.com/block/${s.block_number}" target="_blank" rel="noopener noreferrer">Block ${s.block_number.toLocaleString()}</a></p>${errorsHTML(s.read_errors)}<details class="detail"><summary>Season evidence and scheduled moons</summary><p>Weather contract: ${esc('0xd45919b30bdac5f810a18434b3aac9c2d7093c67')}</p><p>Epoch start: ${esc(utc(s.epoch_start_timestamp))}. Block time: ${esc(utc(s.block_timestamp))}.</p><p>Moon schedule: ${s.moon_count == null ? 'unavailable' : s.moon_count === 0 ? 'No entries registered at this block.' : esc(s.moon_count) + ' registered entries; starts below.'}</p>${s.moon_starts.length ? `<ul>${s.moon_starts.map(t => `<li>${esc(utc(t))}</li>`).join('')}</ul>` : ''}<p>Weather commitment:</p><pre>${esc(s.commit_hash ?? 'Unknown')}</pre><p class="muted">The verified code stores the commitment hash but does not enforce it when scheduling weather. Future epochs can be overwritten until their scheduling cutoff. Future weather getters are not interpreted as announced rolls. Event flags and the effective multiplier are read separately. Verified event stacking multiplies weekly weather by 2 for each active Flood and Moon, capped at 2×.</p><button class="btn small" id="export-season">Export season evidence</button></details><details class="detail"><summary>Prepare for ${state.portfolio.expected_total_plots} unminted plots</summary><p>Published mint price: 0.002 ETH per plot → <strong>${inputAmount(preparation.mint_eth)} ETH</strong> for ${state.portfolio.expected_total_plots}, before network costs. This is the official site's price; legacy PRICE() and saleState() getters reverted during research, so it is not a verified contract quote.</p><p>Initial planting: <strong>${preparation.planting_crop.toLocaleString()} CROP</strong>. ETH needed for CROP depends on the launch quote and fees.</p><p class="muted">If our mint is a uniform sample without replacement from the full committed collection, the expected counts are ${rules.plots.rarities.map((r, i) => `${preparation.expected_counts[i].toFixed(2)} ${esc(r.name)}`).join(', ')}; chance of at least one Golden Acre is ${(preparation.probability_golden * 100).toFixed(1)}%. These are allocation assumptions, not assigned traits or confirmed odds for specific mint positions.</p><p class="muted">Keep real holdings empty until mint. Explore demo for hypothetical strategy comparisons; its traits, balances and prices are fictional.</p></details></section>`;
  }
  function allocationHTML() {
    const tiers = typeof __MANIFEST_TIERS__ === 'undefined' ? [] : __MANIFEST_TIERS__;
    if (!allocation) allocation = cyclicAllocation(hypotheticalIds.split(',').map(Number), tiers, sourceAwareAllocation);
    return `<section class="card"><div class="card-head"><h2>Cyclic allocation lab</h2><span class="tag">Hypothetical IDs</span></div><p class="muted">The Almanac uses one shared offset into the committed table. Test a contiguous mint or two separated batches without creating owned plots. Compare the Almanac uniform-offset assumption with the verified reveal implementation. The deployed code remaps zero to one; these probabilities remain conditional on a uniform block hash.</p><form id="allocation-form" style="margin-top:16px">${field('hypotheticalIds', 'Hypothetical token IDs', hypotheticalIds, 'Comma-separated distinct IDs; default 1–22 represents one contiguous group.')}<label class="check"><input type="checkbox" name="sourceAware" ${sourceAwareAllocation ? 'checked' : ''}> Apply verified zero → one reveal mapping</label><button class="btn small" type="submit">Evaluate offsets</button></form><div id="allocation-result">${allocationResult()}</div></section>`;
  }
  function allocationResult() {
    const a = allocation;
    return `<div class="stats" style="margin-top:18px"><div class="stat"><div class="label">At least one Golden Acre</div><div class="value">${(100 * a.probability_golden).toFixed(2)}%</div><div class="foot">${a.golden_offsets} of ${a.offset_count} ${a.source_aware ? 'hash residues' : 'offsets'}</div></div><div class="stat"><div class="label">Combined level-1 weight</div><h3>${a.min_weight_bps / 10000}–${a.max_weight_bps / 10000}×</h3><div class="foot">Range over the cached table</div></div></div><div class="table-wrap"><table><thead><tr><th>Golden Acres</th><th>Offsets</th><th>Probability</th></tr></thead><tbody>${Object.entries(a.golden_count_offsets).map(([n, count]) => `<tr><td>${n}</td><td>${count}</td><td>${(100 * count / a.offset_count).toFixed(2)}%</td></tr>`).join('')}</tbody></table></div><p class="muted" style="margin-top:12px">Expected counts: ${a.expected_counts.map((n, i) => `${n.toFixed(2)} ${rules.plots.rarities[i].name}`).join(', ')}. ${esc(a.assumption)} This uses the historically verified cached manifest.</p>`;
  }
  function researchPage() {
    return header('Answers, with their limits.', 'The Almanac controls gameplay planning. Supporting pages do not override it.') + `<section class="card">${field('questionSearch', 'Search research answers', '', 'Search fees, reveal, weather, vesting or another topic.')}<p class="muted">Reviewed ${questions.reviewed_on_utc}. All ten original questions have a documented answer or a specific remaining dependency.</p></section>` + questions.questions.map(q => `<section class="card research-answer" data-question style="margin-top:20px"><div class="card-head"><h2>${esc(q.id)} · ${esc(q.title)}</h2><span class="tag">${esc(q.status)}</span></div><p>${esc(q.answer)}</p><p class="muted" style="margin-top:12px">${esc(q.remaining)}</p><div class="buttons" style="margin-top:14px">${q.sources.map(id => sourceIndex.source_records.find(s => s.id === id)).filter(Boolean).map(s => `<a class="btn small" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>`).join('')}</div></section>`).join('');
  }
  const timer = setInterval(() => { if (state.autoRefresh && !seasonRefreshing && document.visibilityState === 'visible' && isVisible() && !busy && !executionBusy && !draft && !modal && !root.activeElement?.matches('input,select,textarea')) refresh(); }, 30000);
  function header(title, sub, extra = '') { return `<div class="page-head"><div><div class="eyebrow">Your farm, thoughtfully managed</div><h1>${title}</h1><p class="subtitle">${sub}</p></div>${extra}</div>`; }
  function errorsHTML(errors) { return errors?.length ? `<ul class="errors">${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''; }
  function summaryCards() {
    const plots = allPlots(state.portfolio), known = plots.filter(p => typeof p.is_active === 'boolean'), active = plots.filter(p => p.is_active).length;
    const weatherSnapshot = state.season ?? cachedSeason;
    const pending = plots.length && plots.every(p => p.pending_crop_wei != null) ? plots.reduce((a, p) => a + BigInt(p.pending_crop_wei), 0n) : null;
    return `<div class="stats"><div class="stat"><div class="label">Plots recorded <span>▦</span></div><div class="value">${plots.length}<span class="plot-count"> / ${state.portfolio.expected_total_plots}</span></div><div class="foot">Across two wallet ledgers</div></div><div class="stat"><div class="label">Planted <span>♧</span></div><div class="value">${active}</div><div class="foot">${plots.length - known.length} activation states unknown</div></div><div class="stat"><div class="label">Pending harvest <span>↗</span></div><div class="value">${amount(pending, 0)}</div><div class="foot">CROP · claim before spending</div></div><div class="stat"><div class="label">Observed weather <span>☀</span></div><div class="value">${weatherSnapshot.effective_multiplier_bps == null ? '—' : weatherSnapshot.effective_multiplier_bps / 10000 + '×'}</div><div class="foot">Season snapshot · not a forecast</div></div></div>`;
  }
  function walletsHTML() {
    return `<div class="wallet-grid">${state.portfolio.wallets.map((w, i) => `<form class="card" data-wallet="${i}"><div class="wallet-title"><div class="wallet-icon">▱</div><div><h3>${esc(w.label)}</h3><p class="muted">${w.plots.length} recorded · ${w.expected_plot_count ?? 11} initially expected</p></div></div>${field(`address-${i}`, 'Public wallet address', w.address, 'No connection or signature needed') }<div class="fields two">${field(`crop-${i}`, 'Liquid CROP', inputAmount(w.crop_balance_wei), 'Leave blank if unknown')}${field(`eth-${i}`, 'ETH available for purchases & fees', inputAmount(w.eth_balance_wei), 'Leave blank if unknown')}</div><button class="btn small" type="submit">Save wallet ${i === 0 ? 'A' : 'B'}</button></form>`).join('')}</div>`;
  }
  function chart(result, baseline) {
    if (!result) return `<div class="empty">${leaf}<h2>Give your plots a plan</h2><p>Compare harvest-funded upgrades and extra investment over 30, 90 and 365 days.</p><div class="buttons" style="justify-content:center"><button class="btn primary" data-tab="scenarios">Build a scenario</button><button class="btn" data-demo>Explore demo</button></div></div>`;
    const curves = [baseline?.curve ?? [], result.curve], values = curves.flat().map(p => Number(BigInt(p.net_crop_wei) / UNIT)), low = Math.min(0, ...values), high = Math.max(1, ...values), x = day => 48 + day / result.days * 630, y = value => 190 - (value - low) / (high - low) * 160;
    const path = points => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(Number(BigInt(p.net_crop_wei) / UNIT)).toFixed(1)}`).join(' ');
    return `<figure style="margin:0"><svg class="chart" viewBox="0 0 710 225" role="img" aria-label="Projected net CROP over ${result.days} days, selected strategy compared with no upgrades">${[0, .5, 1].map(f => `<line x1="48" x2="678" y1="${30 + 160 * f}" y2="${30 + 160 * f}" stroke="#e7ebdf"/><text x="0" y="${34 + 160 * f}" fill="#849178" font-size="10">${Math.round((high - (high - low) * f) / 1000)}k</text>`).join('')}<path d="${path(curves[0])}" fill="none" stroke="#b4beaa" stroke-width="2" stroke-dasharray="5 5"/><path d="${path(curves[1])}" fill="none" stroke="#3c794c" stroke-width="3"/><text x="48" y="218" fill="#849178" font-size="10">Day 1</text><text x="640" y="218" fill="#849178" font-size="10">Day ${result.days}</text></svg><figcaption class="legend"><span><i class="line-key"></i>Selected strategy</span><span><i class="line-key baseline"></i>No upgrades</span><span>Net CROP · assumptions apply</span></figcaption></figure>`;
  }
  function baselineFor(result) { return results?.find(r => r.days === result?.days && r.baseline?.status === 'ok')?.baseline; }
  function overview() {
    const observed = state.season?.observed_at_utc ?? state.portfolio.observed_at_utc;
    return header('Make every plot count.', 'A clear view of two wallets, the next harvest, and what is worth reinvesting.', `<span class="tag">22-plot plan</span>`) + fundingPanel() + summaryCards() + seasonPanel() + allocationHTML() + `<div class="grid"><section class="card"><div class="card-head"><h2>The long view</h2><span class="muted">${chosen ? `${chosen.days}-day scenario` : 'Your next season'}</span></div>${chart(chosen, baselineFor(chosen))}</section><section class="card"><div class="card-head"><h2>On the calendar</h2><span class="tag">UTC</span></div><div class="schedule"><div class="date-tile">SEP<b>15</b></div><div><h3>Mint opens</h3><p>17:00 UTC · published launch plan</p></div></div><div class="schedule"><div class="date-tile">SEP<b>18</b></div><div><h3>Reveal & pool</h3><p>Read the actual reveal before assigning rarity.</p></div></div><div class="schedule"><div class="date-tile">SEP<b>21</b></div><div><h3>Plant Season</h3><p>00:00 UTC · Sep 20, 8 p.m. Toronto</p></div></div><p class="muted" style="margin-top:14px">${state.portfolio.next_boundary_timestamp ? 'Observed next weather boundary: ' + esc(new Date(state.portfolio.next_boundary_timestamp * 1000).toLocaleString()) : 'Weather rolls Monday at 00:00 UTC.'}</p></section></div>${walletsHTML()}<section class="card"><div class="card-head"><h2>Keep an eye on the farm</h2><span class="muted">${observed ? 'Last read ' + esc(new Date(observed).toLocaleString()) : 'No live observation yet'}</span></div><label class="check"><input type="checkbox" id="auto-refresh" ${state.autoRefresh ? 'checked' : ''}>Refresh every 30 seconds while this dashboard is visible</label><div class="buttons"><button class="btn small" id="notifications">Enable weather notifications</button><button class="btn small" id="use-observed">Use observed competitors in scenario</button></div><p class="muted" style="margin-top:12px">Monitoring stops when the tab closes. Errors retain the previous snapshot; every observation carries its block and time.</p></section>`;
  }
  function plotsPage() {
    const plots = allPlots(state.portfolio);
    return header('Every plot, in one place.', 'Track individual rarity, level, activation and pending rewards.', `<button class="btn primary" id="add-plot">+ Add plot</button>`) + (plots.length ? `<section class="card"><div class="card-head"><h2>Your plots</h2><div class="buttons"><label class="sr-only" for="plot-filter">Filter plots</label><input id="plot-filter" placeholder="Find plot or wallet…" style="padding:7px;border:1px solid #d3ddce;border-radius:6px"></div></div><div class="table-wrap"><table><thead><tr><th>Plot</th><th>Wallet</th><th>Rarity</th><th>Level</th><th>State</th><th class="number">Weight</th><th class="number">Pending CROP</th><th></th></tr></thead><tbody>${plots.map(p => `<tr data-plot-row><td><strong>#${p.token_id}</strong><div class="muted">${esc(p.traits?.Crop ?? '')}</div></td><td>${esc(state.portfolio.wallets.find(w => w.id === p.wallet_id)?.label)}</td><td>${tag(p.rarity_tier)}</td><td>${p.level == null ? '—' : 'LV ' + p.level + ' · ' + rules.levels.entries[p.level - 1]?.name}</td><td><span class="tag">${p.is_active === true ? 'Planted' : p.is_active === false ? 'Dormant' : 'Unknown'}</span></td><td class="number">${p.effective_weight_bps == null ? '—' : (p.effective_weight_bps / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') + '×'}</td><td class="number">${amount(p.pending_crop_wei)}</td><td><button class="btn small" data-edit="${p.token_id}">Edit</button></td></tr>`).join('')}</tbody></table></div></section>` : `<section class="card empty">${leaf}<h2>Your plots will appear here</h2><p>Add the details you have, import a portfolio file, or save both public addresses and refresh. Unknown rarity stays unknown.</p><div class="buttons" style="justify-content:center"><button class="btn primary" id="add-first">Add your first plot</button><button class="btn" data-demo>Explore 22 demo plots</button></div></section>`);
  }
  function scenarioForm() {
    const s = state.scenario;
    return `<form id="scenario-form" class="card"><div class="card-head"><h2>Set the assumptions</h2><span class="tag">30 / 90 / 365 days</span></div><div class="fields">${field('start', 'Scenario start (UTC)', s.start, 'ISO timestamp, e.g. 2026-09-21T00:00:00Z')}${field('externalWeight', 'Other farmers’ planted weight', s.externalWeight, 'Excludes all of our own plots', 'number')}<div class="field"><label for="f-weatherBps">Future weekly weather assumption</label><select id="f-weatherBps" name="weatherBps">${[5000, 8000, 10000, 12000, 15000].map(v => `<option value="${v}" ${Number(s.weatherBps) === v ? 'selected' : ''}>${rules.weather.states.find(w => w.multiplier_bps === v).name} · ${v / 10000}×</option>`).join('')}</select><span class="hint">A scenario, not a sealed-weather forecast</span></div>${field('buyPrice', 'All-in buy price · ETH per CROP', s.buyPrice, 'Include trade fees & size-dependent slippage')}${field('sellPrice', 'Exit sell price · ETH per CROP', s.sellPrice, 'Net of sale fees & slippage; unknown = blank')}${field('extraBudget', 'Maximum extra investment · ETH', s.extraBudget, 'Excludes initial planting and wallet-paid action fees')}</div><details class="detail"><summary>Wallets, fees & reinvestment</summary><div class="fields"><div class="field"><label for="f-walletMode">Wallet arrangement</label><select id="f-walletMode" name="walletMode"><option value="keep" ${s.walletMode === 'keep' ? 'selected' : ''}>Keep 11 + 11</option><option value="before" ${s.walletMode === 'before' ? 'selected' : ''}>Consolidate B into A before planting</option><option value="after" ${s.walletMode === 'after' ? 'selected' : ''}>Consolidate B into A after planting</option></select></div><div class="field"><label for="f-feeMode">Wallet-paid action costs</label><select id="f-feeMode" name="feeMode"><option value="unknown" ${s.feeMode === 'unknown' ? 'selected' : ''}>Unknown — do not assume free</option><option value="zero" ${s.feeMode === 'zero' ? 'selected' : ''}>Assume zero wallet-paid gas</option><option value="estimated" ${s.feeMode === 'estimated' ? 'selected' : ''}>Use my all-in estimates below</option></select></div>${field('claimEveryDays', 'Routine claim cadence · days', s.claimEveryDays, 'Extra claims may fund an upgrade sooner', 'number')}${field('claimFee', 'Cost per claim batch · ETH', s.claimFee)}${field('upgradeFee', 'Cost per upgrade step · ETH', s.upgradeFee, 'Include any needed approval costs')}${field('plantFee', 'Cost per plant · ETH', s.plantFee, 'Network/approval costs, not the CROP fee')}${field('transferFee', 'Cost per CROP transfer · ETH', s.transferFee)}${field('buyFee', 'Cost per purchase · ETH', s.buyFee, 'Additional network cost, not quoted trade fees')}${field('nftTransferFee', 'Cost per NFT transfer · ETH', s.nftTransferFee)}${field('downtimeHours', 'Consolidation downtime · hours', s.downtimeHours, 'Conservatively pauses the entire portfolio', 'number')}</div><label class="check"><input name="allowTransfers" type="checkbox" ${s.allowTransfers ? 'checked' : ''}>Allow proposed CROP transfers between wallets</label><label class="check"><input name="includeOpeningCrop" type="checkbox" ${s.includeOpeningCrop ? 'checked' : ''}>Allow spending existing liquid CROP as well as claimed harvests</label></details><details class="detail"><summary>Weather event planner</summary><p class="muted">Almanac planning interpretation: multiply a single event by the week, capped at 2×. Locusts + event = 1×; Drought = 1.6×; Fair/Sunny/Rain = 2×. Enter hypothetical dates; no future event is inferred. Overlaps are rejected and Granary exhaustion is not simulated.</p><div class="fields two"><div class="field"><label for="weather-event-type">Event</label><select id="weather-event-type"><option value="flood">Flash Flood · 24 hours</option><option value="moon">Harvest Moon · 48 hours</option></select></div><div class="field"><label for="weather-event-start">Event start (UTC)</label><input id="weather-event-start" value="${esc(s.start)}" placeholder="2026-09-21T12:00:00Z"></div></div><button class="btn small" type="button" id="add-weather-event">Add hypothetical event</button><div class="field" style="margin-top:14px"><label for="weather-events">Planned events (JSON)</label><textarea id="weather-events" name="weatherEvents" rows="4">${esc(JSON.stringify(s.weatherEvents ?? [], null, 2))}</textarea><span class="hint">Clear to [] to remove all events. With events, weather paths must describe the underlying ordinary week.</span></div></details><details class="detail"><summary>Changing conditions & NFT valuation</summary><div class="fields">${field('annualGrowthPct', 'Other farmers’ yearly weight growth · %', s.annualGrowthPct, 'Applied in 30-day steps', 'number')}${field('nftBasis', 'Combined NFT starting basis · ETH', s.nftBasis, 'Optional, explicitly chosen accounting basis')}${field('nftTerminal', 'Combined NFT ending value · ETH', s.nftTerminal, 'Optional estimate, not upgrade cost')}</div><div class="fields two"><div class="field"><label for="weather-path">Weather path (optional JSON)</label><textarea id="weather-path" name="weatherPath">${esc(JSON.stringify(s.weatherPath))}</textarea><span class="hint">[{"day":30,"multiplier_bps":8000}] · explicit effective-multiplier assumptions</span></div><div class="field"><label for="external-path">Other farmers’ weight path (optional JSON)</label><textarea id="external-path" name="externalWeightPath">${esc(JSON.stringify(s.externalWeightPath))}</textarea><span class="hint">[{"day":30,"weight_bps":40000000}] · overrides growth after first entry</span></div></div></details><div class="buttons" style="margin-top:18px"><button class="btn primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Comparing strategies…' : 'Compare strategies'}</button><button class="btn" type="button" id="compare-wallets">Compare wallet arrangements</button><span class="muted">Local calculation · never submits a transaction</span></div></form>`;
  }
  function resultTable() {
    if (busy) return '<div class="progress" role="status"><span class="spinner"></span>Comparing full upgrade paths, funding routes and budget sizes…</div>';
    if (!results) return '';
    return `<section class="card actions" data-calculation><div class="card-head"><h2>Best among evaluated strategies</h2><button class="btn small" id="export-results">Export results</button></div><p class="muted" style="margin-bottom:12px">CROP and ETH winners may use different actions. ETH is incremental operating profit; NFT values are separate. Results use the selected assumptions, not live-price guarantees.</p><div class="table-wrap"><table><thead><tr><th>Horizon / funding</th><th class="number">No-upgrade net CROP</th><th class="number">Best net CROP</th><th class="number">Best operating ETH</th><th>Action plan</th></tr></thead><tbody>${results.map((r, i) => r.status !== 'ok' ? `<tr><td>${r.days ? r.days + ' days · ' + (r.funding === 'extra' ? 'Extra investment' : 'Harvest-funded') : 'Inputs needed'}</td><td colspan="4">${errorsHTML(r.errors)}</td></tr>` : `<tr><td><strong>${r.days} days</strong><div class="muted">${r.funding === 'extra' ? 'Extra investment allowed' : 'Harvest-funded'} · ${r.evaluated} candidates</div></td><td class="number">${r.baseline.status==='ok'?badgeAmount(r.baseline.net_crop_wei):errorsHTML(r.baseline.errors)}</td><td class="number">${badgeAmount(r.bestCrop.net_crop_wei)}</td><td class="number">${badgeAmount(r.bestEth?.operating_eth_wei, 6)}</td><td><div class="buttons"><button class="btn small ${chosen === r.bestCrop ? 'selected' : ''}" data-plan="${i}:crop">CROP</button><button class="btn small" data-plan="${i}:eth" ${r.bestEth ? '' : 'disabled'}>ETH</button></div></td></tr>`).join('')}</tbody></table></div></section>`;
  }
  function actionPlan() {
    if (!chosen) return '';
    const r = chosen;
    return `<section class="card actions" data-calculation><div class="card-head"><div><h2>Your selected scenario</h2><p class="muted">${r.days} days · ${esc(r.policy.replace('_', ' '))} · ${r.budget_fraction}% budget ceiling</p></div><button class="btn small" id="export-ledger">Export ledger</button></div><div class="stats"><div class="stat"><div class="label">Earned CROP</div><div class="value">${amount(r.earned_crop_wei, 0)}</div></div><div class="stat"><div class="label">Spent CROP</div><div class="value">${amount(r.spent_crop_wei, 0)}</div></div><div class="stat"><div class="label">Extra ETH used</div><div class="value">${amount(r.extra_investment_eth_wei, 4)}</div></div><div class="stat"><div class="label">Wallet-paid costs · ETH</div><div class="value">${amount(r.gas_eth_wei, 5)}</div></div></div>${chart(r, baselineFor(r))}<p class="muted" style="margin:15px 0">Estimated profit including supplied NFT basis and terminal value: <strong>${amount(r.total_eth_wei, 6)} ETH</strong>. Blank means valuation is incomplete. Cash recovery so far (no sales simulated): ${amount(r.cash_recovery_eth_wei, 6)} ETH. Ending liquid / pending CROP: ${amount(r.liquid_crop_wei, 0)} / ${amount(r.pending_crop_wei, 0)}. Initial planting purchases are separate from the extra-investment cap.</p>${errorsHTML(r.blocked)}<div class="table-wrap"><table><thead><tr><th>Day</th><th>Wallet</th><th>Proposed action</th><th>Plot / destination</th><th class="number">CROP</th></tr></thead><tbody>${r.actions.slice(0, actionLimit).map(a => `<tr><td>${a.day}</td><td>${esc(state.portfolio.wallets.find(w => w.id === a.wallet_id)?.label)}</td><td>${esc(a.type.replaceAll('_', ' '))}${a.to_level ? ' → LV ' + a.to_level : ''}</td><td>${a.plot_id ? '#' + a.plot_id : esc(a.to_wallet ?? '—')}</td><td class="number">${amount(a.crop_wei, 0)}</td></tr>`).join('')}</tbody></table></div>${r.actions.length > actionLimit ? `<button class="btn small" id="more-actions" style="margin-top:15px">Show more (${r.actions.length - actionLimit} remaining)</button>` : ''}<details class="detail"><summary>Assumptions and limits</summary><ul class="muted">${r.assumptions.map(a => `<li>${esc(a)}</li>`).join('')}</ul></details></section>`;
  }
  function scenariosPage() { return header('Invest with a horizon.', 'Compare what an upgrade adds to the whole portfolio, after its costs.') + scenarioForm() + resultTable() + actionPlan(); }
  function evidencePage() {
    const p = state.portfolio;
    return header('Know what a number means.', 'Published rules, verified observations and assumptions stay separate.') + `<section class="card"><div class="card-head"><h2>Current observation</h2><span class="tag">Read-only</span></div><p>Block: <strong>${p.block_number?.toLocaleString() ?? 'No snapshot'}</strong> · ${esc(p.observed_at_utc ?? 'No observation time')}</p><p class="muted">Manifest: ${p.manifest_verified === true ? 'Current chain commitment matches the cached table.' : 'Local historical table verified; current commitment not checked.'}</p>${errorsHTML(p.rule_conflicts)}${errorsHTML(p.read_errors)}<p class="muted" style="margin-top:12px">Successful getters do not prove complete contract behavior. API metadata is not pinned to the block; unverified rarity remains unknown.</p></section><div class="grid actions"><section class="card"><h2>Upgrade reference</h2><table><thead><tr><th>Level</th><th>Weight</th><th class="number">Step cost</th></tr></thead><tbody>${rules.levels.entries.map(l => `<tr><td>${l.level} · ${l.name}</td><td>${l.multiplier_bps / 10000}×</td><td class="number">${Number(l.incremental_upgrade_cost_crop).toLocaleString()} CROP</td></tr>`).join('')}</tbody></table><p class="muted" style="margin-top:15px">Planting: 2,500 CROP. All 22: 55,000 CROP. Each active plot moved to another wallet must be planted again.</p></section><section class="card"><h2>Inspect a paid transaction</h2><p class="muted" style="margin:12px 0">Optionally look up a receipt to inform your fee estimates. This performs a public read only.</p><form id="receipt-form">${field('receiptHash', 'Transaction hash', '', '0x followed by 64 hexadecimal characters')}<button class="btn" type="submit">Read receipt</button></form><div id="receipt-result"></div></section></div><section class="card"><h2>Rules that still need verification</h2><details class="detail"><summary>Open the local research notes</summary><pre>${esc(gaps)}</pre></details><div class="buttons"><a class="btn small" href="https://rh.farm/almanac/" target="_blank" rel="noopener noreferrer">Official Almanac</a><a class="btn small" href="https://rh.farm/security/" target="_blank" rel="noopener noreferrer">Published contracts</a></div></section><section class="card actions"><h2>Recent local observations</h2><div class="table-wrap"><table><thead><tr><th>Time</th><th>Block</th><th class="number">Pending CROP</th><th>Weather</th></tr></thead><tbody>${state.history.slice().reverse().map(h => `<tr><td>${esc(h.at)}</td><td>${h.block}</td><td class="number">${amount(h.pending_crop_wei)}</td><td>${h.weather_bps == null ? '—' : h.weather_bps / 10000 + '×'}</td></tr>`).join('')}</tbody></table></div></section>`;
  }
  function render() {
    state.funding ??= fundingDefaults(); state.quote ??= null; state.planSettings ??= planDefaults(); state.executionLog ??= [];
    const stale = state.portfolio.observed_at_utc && Date.now() - Date.parse(state.portfolio.observed_at_utc) > 90000;
    view.innerHTML = `<div class="shell"><aside class="rail"><div class="brand">${leaf}<div>Farm Companion<small>GROW WITH INTENTION</small></div></div><nav class="nav" aria-label="Main navigation">${[['overview', '◫', 'Overview'], ['plots', '▦', 'Your plots'], ['guided', '▷', 'Guided plan'], ['scenarios', '↗', 'Strategy lab'], ['evidence', '≡', 'Evidence'], ['research', '?', 'Research answers']].map(([id, icon, label]) => `<button data-tab="${id}" class="${tab === id ? 'active' : ''}" ${tab === id ? 'aria-current="page"' : ''}><span aria-hidden="true">${icon}</span><span>${label}</span></button>`).join('')}</nav><div class="rail-note"><strong>11 + 11</strong>Two wallets. One portfolio.<p style="margin-top:15px">Your wallet keeps control.<br>You approve every transaction.</p></div></aside><main class="main"><header class="topbar"><div class="status"><i class="dot"></i>Robinhood Chain · Public monitoring ${stale ? '· Snapshot stale' : ''}</div><div class="buttons"><a class="btn small" href="https://rh.farm/farm/" target="_blank" rel="noopener noreferrer">Open game</a><button class="btn small" id="import">Import</button><button class="btn small" id="export">Export</button><button class="btn primary small" id="refresh" ${refreshing ? 'disabled' : ''}>${refreshing || seasonRefreshing ? 'Reading chain…' : state.portfolio.wallets.every(w => w.address) ? 'Refresh wallets' : 'Refresh public state'}</button></div></header><div class="content">${state.portfolio.is_demo ? '<div class="banner"><span><strong>DEMO PORTFOLIO</strong> · Fictional plots, balances and prices. These are not your holdings.</span><button class="btn small" id="leave-demo">Leave demo</button></div>' : ''}${storageError ? `<div class="banner error">${esc(storageError)}</div>` : ''}${(state.portfolio.rule_conflicts ?? []).length ? '<div class="banner error">Live rules differ from the cache. Scenario recommendations are paused; see Evidence.</div>' : ''}${tab === 'overview' ? overview() : tab === 'plots' ? plotsPage() : tab === 'guided' ? guidedPage({state,plan:guidedPlan,draft,status:executor.status(),busy,executionBusy}) : tab === 'scenarios' ? scenariosPage() : tab === 'research' ? researchPage() : evidencePage()}<p class="footer-note">Local-first planning · Rules cached September 2026 · ${state.portfolio.is_demo ? 'Synthetic demonstration' : 'Transactions require your explicit wallet approval'}</p></div></main></div>`;
    bind(); if (modal) showPlotDialog(modal.id, true);
  }
  function bind() {
    view.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; modal = null; render(); });
    view.querySelectorAll('[data-demo]').forEach(b => b.onclick = loadDemo);
    const on = (selector, event, fn) => { const e = view.querySelector(selector); if (e) e.addEventListener(event, fn); };
    on('#guided-form','change',e=>{
      const data=new FormData(e.currentTarget);
      state.planSettings=validatePlanSettings({enabled:data.has('planEnabled'),days:Number(data.get('planDays')),funding:data.get('planFunding'),objective:data.get('planObjective')});
      if(state.planSettings.enabled) state.autoRefresh=true;
      save(); render();
    });
    on('#guided-form','submit',async e => {
      e.preventDefault(); if (executionBusy || executor.status().pending) return;
      const data = new FormData(e.target);
      state.planSettings = validatePlanSettings({enabled:data.has('planEnabled'),days:Number(data.get('planDays')),funding:data.get('planFunding'),objective:data.get('planObjective')});
      if (state.planSettings.enabled) state.autoRefresh = true;
      save();
      if (!state.portfolio.is_demo) await refresh();
      if (!busy) beginGuided();
    });
    on('#export-guided','click',()=>download('yield-farm-active-plan.json',json({portfolio:state.portfolio,plan:guidedPlan})));
    on('#connect-wallet','click',()=>executionTask(async()=>{await executor.connect(state.portfolio.wallets.map(w=>w.address)); notify('Wallet connected. No transaction requested.');}));
    on('#switch-wallet','click',()=>executionTask(()=>executor.switchChain()));
    on('#prepare-guided','click',()=>{
      const next=guidedPlan?.insights?.next_action;
      if (next?.status!=='ready_for_review') return;
      prepareAction({type:next.type,wallet_id:next.wallet_id,...(next.plot_ids?{plot_ids:next.plot_ids}:{plot_id:next.plot_id})},true);
    });
    on('#manual-action-form','submit',e=>{
      e.preventDefault(); const data=new FormData(e.target), id=Number(data.get('manualPlot'));
      const wallet=state.portfolio.wallets.find(w=>w.plots.some(p=>p.token_id===id));
      if(wallet) { const kind=data.get('manualType'); prepareAction(kind==='claim_all'?{type:'claim',wallet_id:wallet.id,plot_ids:wallet.plots.filter(p=>p.pending_crop_wei!=null&&BigInt(p.pending_crop_wei)>0n).map(p=>p.token_id)}:{type:kind,wallet_id:wallet.id,plot_id:id}); }
    });
    on('#discard-draft','click',()=>{draft=null;render();});
    on('#submit-action','click',()=>executionTask(async()=>{
      if (!draft) throw new Error('Prepare and review an action first.');
      const reviewed=draft; draft=null;
      if(reviewed.workspace_revision!==revision) throw new Error('Workspace changed. Prepare a fresh review.');
      try { const result=await executor.submit(reviewed.id); journal(reviewed,'pending',result.hash); notify('Transaction submitted. Check its receipt before preparing the next action.'); }
      catch(error) { journal(reviewed,executor.status().pending?'unknown':'rejected',executor.status().pending?.hash); throw error; }
    }));
    on('#replacement-form','submit',e=>{
      e.preventDefault(); const hash=new FormData(e.target).get('replacementHash')?.trim();
      executionTask(async()=>{
        const pending=executor.status().pending, receipt=await executor.replacementReceipt(hash);
        if(receipt.status==='pending') return notify('Replacement not yet confirmed. The transaction lock remains.');
        journal(pending,receipt.status,receipt.hash); guidedPlan=null; draft=null;
        notify(receipt.status==='replaced'?'Original action replaced or cancelled. Refresh and rebuild the plan.':`Replacement ${receipt.status}. Refresh before another action.`);
      }).then(()=>{if(!executor.status().pending) refresh();});
    });
    on('#pending-form','submit',e=>{
      e.preventDefault(); const hash=executor.status().pending?.hash||new FormData(e.target).get('pendingHash')?.trim();
      executionTask(async()=>{
        const pending=executor.status().pending, receipt=await executor.receipt(hash);
        if(receipt.status==='pending') return notify('Still awaiting a matching receipt. The transaction lock remains.');
        journal(pending,receipt.status,receipt.hash); guidedPlan=null; draft=null;
        notify(`Transaction ${receipt.status}. Refresh and rebuild the plan before another action.`);
      }).then(()=>{if(!executor.status().pending) refresh();});
    });
    on('#refresh', 'click', refresh);
    on('#refresh-price', 'click', refreshPrice);
    on('#load-configured', 'click', () => { if (!canReplaceWorkspace()) return; state = parseWorkspace(json(configured)); state.profile_seeded = true; save(); render(); });
    on('#funding-form', 'submit', e => { e.preventDefault(); try { const d = new FormData(e.target); state.funding = validateFunding({ targetUsd:d.get('targetUsd'), reserveEth:d.get('reserveEth').trim() }); save(); render(); } catch (error) { notify(error.message); } });
    on('#f-questionSearch', 'input', e => view.querySelectorAll('[data-question]').forEach(node => { node.hidden = !node.textContent.toLowerCase().includes(e.target.value.toLowerCase()); }));
    on('#allocation-form', 'submit', e => {
      e.preventDefault();
      try {
        const value = new FormData(e.target).get('hypotheticalIds');
        sourceAwareAllocation = new FormData(e.target).has('sourceAware');
        allocation = cyclicAllocation(value.split(',').map(v => Number(v.trim())), __MANIFEST_TIERS__, sourceAwareAllocation);
        hypotheticalIds = value; view.querySelector('#allocation-result').innerHTML = allocationResult();
      } catch (error) { notify(error.message); }
    });
    on('#add-weather-event', 'click', () => {
      try {
        const input = view.querySelector('[name=weatherEvents]');
        const next = [...JSON.parse(input.value), { type: view.querySelector('#weather-event-type').value, start: view.querySelector('#weather-event-start').value }];
        eventWindows(next); input.value = JSON.stringify(next, null, 2); input.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (error) { notify(error.message); }
    });
    on('#refresh-season', 'click', refreshSeason);
    on('#export-season', 'click', () => download('yield-farm-season.json', json(state.season ?? cachedSeason)));
    on('#export', 'click', () => download('yield-farm-workspace.json', json({ ...state, schema_version: 1 })));
    on('#import', 'click', () => {
      if (!canReplaceWorkspace()) return;
      const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
      input.onchange = async () => {
        const file = input.files[0]; if (!file) return;
        try { if (file.size > 5e6) throw new Error('Import limit is 5 MB.'); const imported = parseWorkspace(await file.text()); if (!canReplaceWorkspace()) return; if (imported.pendingExecution) executor.resumePending(imported.pendingExecution); if (imported.portfolio.is_demo) demoBackup = clone(state); state = imported; state.profile_seeded = true; save(); notify('Portfolio imported. Previous scenario results were cleared.'); render(); } catch (e) { notify(`Import rejected; workspace unchanged. ${e.message}`); }
      }; input.click();
    });
    on('#leave-demo', 'click', () => { if (!canReplaceWorkspace()) return; state = demoBackup ?? { portfolio: emptyPortfolio(), scenario: defaults(), history: [], autoRefresh: false }; demoBackup = null; save(); render(); });
    on('#auto-refresh', 'change', e => { state.autoRefresh = e.target.checked; save(false); });
    on('#notifications', 'click', async () => { if (typeof Notification === 'undefined') return notify('This browser does not support notifications here.'); const permission = await Notification.requestPermission(); notify(permission === 'granted' ? 'Weather notifications enabled while this page is running.' : 'Notifications remain off.'); });
    on('#use-observed', 'click', () => {
      const p = state.portfolio, plots = allPlots(p);
      if (p.total_planted_farm_weight_bps == null || plots.some(p => p.effective_weight_bps == null)) return notify('A complete public weight snapshot is needed first.');
      if (!p.genesis_timestamp || Date.now() < p.genesis_timestamp * 1000) return notify('Pre-Genesis weight is not a useful future competition forecast. Enter an explicit scenario assumption.');
      const external = p.total_planted_farm_weight_bps - plots.reduce((a, p) => a + p.effective_weight_bps, 0);
      if (external < 0) return notify('Inconsistent weight snapshot; refresh before using it.');
      state.scenario.externalWeight = String(external / 10000); save(); notify('Observed competitor weight copied as a scenario starting assumption.');
    });
    view.querySelectorAll('[data-wallet]').forEach(form => form.onsubmit = e => {
      e.preventDefault(); const i = Number(form.dataset.wallet), data = new FormData(form), next = clone(state.portfolio);
      try {
        next.wallets[i].address = data.get(`address-${i}`).trim() || null;
        for (const [field, key] of [['crop', 'crop_balance_wei'], ['eth', 'eth_balance_wei']]) { const v = data.get(`${field}-${i}`).trim(); next.wallets[i][key] = v ? units(v).toString() : null; }
        const errors = validatePortfolio(next, false); if (errors.length) throw new Error(errors.join(' '));
        next.observed_at_utc = null; state.portfolio = next; save(); notify('Wallet details saved locally.'); render();
      } catch (error) { notify(error.message); }
    });
    on('#add-plot', 'click', () => showPlotDialog(null)); on('#add-first', 'click', () => showPlotDialog(null));
    view.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => showPlotDialog(Number(b.dataset.edit)));
    on('#plot-filter', 'input', e => view.querySelectorAll('[data-plot-row]').forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(e.target.value.toLowerCase()); }));
    on('#scenario-form', 'input', () => { revision++; guidedPlan = null; draft = null; if (!results && !busy) return; results = null; chosen = null; job++; busy = false; view.querySelectorAll('[data-calculation],.progress').forEach(e => e.remove()); const button = view.querySelector('#scenario-form button[type=submit]'); button.disabled = false; button.textContent = 'Compare strategies'; });
    on('#scenario-form', 'submit', e => { e.preventDefault(); if (saveScenario(e.target)) beginCompare(); });
    on('#compare-wallets', 'click', () => { const form = view.querySelector('#scenario-form'); if (saveScenario(form)) compareWallets(); });
    view.querySelectorAll('[data-plan]').forEach(b => b.onclick = () => { const [index, metric] = b.dataset.plan.split(':'); chosen = results[Number(index)][metric === 'crop' ? 'bestCrop' : 'bestEth']; actionLimit = 20; render(); });
    on('#more-actions', 'click', () => { actionLimit += 50; render(); });
    on('#export-results', 'click', () => download('yield-farm-scenarios.json', json({ schema_version: 1, exported_at: new Date().toISOString(), portfolio: state.portfolio, scenario: state.scenario, results })));
    on('#export-ledger', 'click', () => download('yield-farm-action-ledger.json', json({ assumptions: state.scenario, selected: chosen })));
    on('#receipt-form', 'submit', async e => {
      e.preventDefault(); const out = view.querySelector('#receipt-result'); out.textContent = 'Reading receipt…';
      try { const r = await reader.receipt(new FormData(e.target).get('receiptHash').trim()); out.textContent = `${amount(r.execution_fee_wei, 10)} ETH execution fee, block ${r.block_number}. ${r.note}`; } catch (error) { out.textContent = error.message; }
    });
  }
  function saveScenario(form) {
    try {
      const data = new FormData(form), next = { ...state.scenario, ...Object.fromEntries(data) };
      next.weatherBps = Number(next.weatherBps); next.claimEveryDays = Number(next.claimEveryDays);
      next.weatherEvents = JSON.parse(next.weatherEvents); next.weatherPath = JSON.parse(next.weatherPath); next.externalWeightPath = JSON.parse(next.externalWeightPath);
      next.allowTransfers = data.has('allowTransfers'); next.includeOpeningCrop = data.has('includeOpeningCrop');
      const errors = validateScenario(next); if (errors.length) throw new Error(errors.join(' '));
      state.scenario = next; save(); return true;
    } catch (e) { notify(e.message); return false; }
  }
  function loadDemo() { if (!canReplaceWorkspace()) return; if (state.portfolio.is_demo) { tab = 'scenarios'; render(); return; } demoBackup = clone(state); state = { ...demoPortfolio(), history: [], autoRefresh: false }; save(); tab = 'overview'; render(); }
  function showPlotDialog(id, restoring = false) {
    if (restoring) return; // Any rerender closes dialogs; unsaved edits never overwrite a live refresh.
    modal = { id };
    const old = allPlots(state.portfolio).find(p => p.token_id === id), p = old ?? {};
    const overlay = document.createElement('div'); overlay.className = 'modal-backdrop';
    overlay.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="plot-dialog-title"><h2 id="plot-dialog-title">${id ? 'Edit plot #' + id : 'Add a plot'}</h2><form id="plot-form"><div class="fields two">${field('token_id', 'Token ID', p.token_id, 'Actual on-chain token ID', 'number')}<div class="field"><label for="plot-wallet">Wallet</label><select id="plot-wallet" name="wallet_id">${state.portfolio.wallets.map(w => `<option value="${esc(w.id)}" ${w.id === p.wallet_id ? 'selected' : ''}>${esc(w.label)}</option>`).join('')}</select></div><div class="field"><label for="plot-rarity">Rarity</label><select id="plot-rarity" name="rarity_tier"><option value="">Unknown / unrevealed</option>${rules.plots.rarities.map(t => `<option value="${t.tier}" ${p.rarity_tier === t.tier ? 'selected' : ''}>${t.name}</option>`).join('')}</select></div><div class="field"><label for="plot-level">Level</label><select id="plot-level" name="level">${rules.levels.entries.map(l => `<option value="${l.level}" ${(p.level ?? 1) === l.level ? 'selected' : ''}>${l.level} · ${l.name}</option>`).join('')}</select></div><div class="field"><label for="plot-active">Activation</label><select id="plot-active" name="is_active"><option value="unknown" ${p.is_active == null ? 'selected' : ''}>Unknown</option><option value="false" ${p.is_active === false ? 'selected' : ''}>Dormant</option><option value="true" ${p.is_active === true ? 'selected' : ''}>Planted</option></select></div>${field('pending', 'Pending CROP', inputAmount(p.pending_crop_wei), 'Unknown = blank')}${field('effective', 'Effective weight multiplier', p.effective_weight_bps == null ? '' : String(p.effective_weight_bps / 10000), 'Blank derives ordinary weight if rarity & activation are known')}${field('crop', 'Crop trait (optional)', p.traits?.Crop ?? '', 'Descriptive; no extra yield assumed')}</div><p class="muted" style="margin-bottom:15px">Manual values are scenario inputs until refreshed from public data.</p><div class="buttons"><button class="btn primary" type="submit">Save plot</button><button class="btn" type="button" id="cancel-plot">Cancel</button>${id ? '<button class="btn danger text" type="button" id="delete-plot">Remove record</button>' : ''}</div></form></section>`;
    view.append(overlay); const close = () => { overlay.remove(); modal = null; };
    overlay.querySelector('#cancel-plot').onclick = close;
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } if (e.key === 'Tab') { const list = [...overlay.querySelectorAll('input,select,button')], a = list[0], z = list.at(-1); if (e.shiftKey && root.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && root.activeElement === z) { e.preventDefault(); a.focus(); } } });
    overlay.querySelector('input').focus();
    if (id) overlay.querySelector('#delete-plot').onclick = () => { state.portfolio.wallets.forEach(w => { w.plots = w.plots.filter(p => p.token_id !== id); }); save(); close(); render(); };
    overlay.querySelector('form').onsubmit = e => {
      e.preventDefault(); const data = new FormData(e.target), next = clone(state.portfolio);
      try {
        const tier = data.get('rarity_tier') === '' ? null : Number(data.get('rarity_tier')), level = Number(data.get('level')), active = data.get('is_active') === 'unknown' ? null : data.get('is_active') === 'true';
        const effective = data.get('effective').trim();
        const plot = { ...p, token_id: Number(data.get('token_id')), rarity_tier: tier, level, is_active: active,
          effective_weight_bps: effective ? Math.round(Number(effective) * 10000) : active === false ? 0 : active && tier != null ? weight(tier, level) : null,
          pending_crop_wei: data.get('pending').trim() ? units(data.get('pending')).toString() : null,
          reveal_status: tier == null ? 'unknown' : 'revealed', traits: { ...p.traits, Crop: data.get('crop') }, modifiers: null, owner_address: null, observed_at_utc: null, block_number: null, evidence_source: 'manual' };
        next.wallets.forEach(w => { w.plots = w.plots.filter(p => p.token_id !== id); });
        next.wallets.find(w => w.id === data.get('wallet_id')).plots.push(plot);
        const errors = validatePortfolio(next, false); if (errors.length) throw new Error(errors.join(' '));
        next.observed_at_utc = null; state.portfolio = next; save(); close(); render();
      } catch (error) { notify(error.message); }
    };
  }
  function compareWallets() {
    const errors = validatePortfolio(state.portfolio); if (errors.length) return notify(errors[0]);
    // Wallet-cost comparison intentionally fixes no upgrades to isolate arrangement effects.
    import('./engine.js').then(({ simulate }) => {
      const rows = ['keep', 'before', 'after'].map(mode => ({ mode, result: simulate(state.portfolio, { ...state.scenario, walletMode: mode }, { days: 90, policy: 'baseline' }) }));
      const overlay = document.createElement('div'); overlay.className = 'modal-backdrop';
      overlay.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-label="Wallet arrangement comparison"><h2>Wallet arrangements · 90 days</h2><p class="muted">No upgrades in this comparison, so transfer, planting and routine-claim differences stay visible. Downtime is a conservative portfolio-wide assumption.</p><div class="table-wrap"><table><thead><tr><th>Arrangement</th><th class="number">Net CROP</th><th class="number">Operating ETH</th></tr></thead><tbody>${rows.map(({ mode, result: r }) => `<tr><td>${esc(mode === 'keep' ? 'Keep 11 + 11' : 'Consolidate ' + mode + ' planting')}</td>${r.status === 'ok' ? `<td class="number">${amount(r.net_crop_wei, 0)}</td><td class="number">${amount(r.operating_eth_wei, 6)}</td>` : `<td colspan="2">${errorsHTML(r.errors)}</td>`}</tr>`).join('')}</tbody></table></div><button class="btn" id="close-wallets" style="margin-top:20px">Close</button></section>`;
      view.append(overlay); overlay.querySelector('#close-wallets').onclick = () => overlay.remove();
    });
  }
  render();
  return { destroy() { clearInterval(timer); clearTimeout(noticeTimer); worker?.terminate(); root.replaceChildren(); }, root };
}
