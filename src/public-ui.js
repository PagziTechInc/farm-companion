import css from './public-styles.css';
import companionCss from './companion-styles.css';
import themeCss from './themes.css';
import studioCss from './plot-studio.css';
import activePlanCss from './active-plan.css';
import workspaceCss from './workspace-styles.css';
import simpleCss from './simple-styles.css';
import { automaticForecast } from './automatic-forecast.js';
import { activePlanView, activePlanTeaser } from './active-plan-view.js';
import { activePlanDefaults, validateActivePlanSettings, validateActivePlanClock, actionIdentity, livePlanAction } from './active-plan.js';
import { createPlanRunner } from './plan-worker-client.js';
import { createActivePlanController } from './active-plan-controller.js';
import { themeForScene, themeForPlot } from './themes.js';
import { createPlotArtReader, validateSavedPlotArt } from './plot-art.js';
import { createPlotStudio } from './plot-studio.js';
import { art } from './artwork.js';
import { seasonArt, seasonLooks, weatherGlyphs } from './season-artwork.js';
import pixelFont from '../assets/press-start-2p.ttf';
import bodyFont from '../assets/site/ibm-plex-sans-latin.woff2';
import companionHero from '../assets/generated/companion-field-station.webp';
import { rules, emptyPortfolio, defaults, validatePortfolio, validateScenario, weight, units, amount, inputAmount, json, clone, allPlots } from './model.js';
import { analyzeFarm } from './calculator.js';
import { sampleRarityTiers } from './model-farm.js';
import { FORECAST_FIELDS, RESERVE_FIELDS, forecastDefaults, forecastManualFields, fullSupplyCompetition } from './forecast-defaults.js';
import { readCropReference } from './forecast-market.js';
import { analyzeInsights } from './insights.js';
import { prepareForecastPortfolio, forecastPlotTier } from './forecast-portfolio.js';
import { getFarmCalendar, buildFarmCalendarICS } from './farm-calendar.js';
import { readSeason, validateSeason, weatherName } from './season.js';
import { createReader, fetchJSON } from './reader.js';
import { readCollectionStatus, COLLECTION_CATALOG_URL } from './collection-status.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const PLOT_PAGE_SIZE = 23;
const fmt = (value, places = 2) => amount(value, places);
const dayText = days => days == null ? 'Beyond 365 days' : Number(days) === 0 ? 'Ready now' : Number(days) < 1 ? 'Within a day' : `~${Number(days).toFixed(Number(days) < 10 ? 1 : 0)} days`;
const dateText = value => value ? new Date(value).toLocaleString('en-CA', { timeZone:'UTC', dateStyle:'medium', timeStyle:'short' }) + ' UTC' : 'Not observed';
const options = (rows, value) => rows.map(([id, label]) => `<option value="${escape(id)}" ${String(id) === String(value) ? 'selected' : ''}>${escape(label)}</option>`).join('');
const walletName = (p, id) => p.wallets.find(w => w.id === id)?.label ?? id;
const crop = (value, places = 2) => `${fmt(value, places)} CROP`;
const compactCrop = value => value==null?'—':BigInt(value)>=1000000n*10n**18n?fmt(BigInt(value)/1000000n,2)+'M':BigInt(value)>=10000n*10n**18n?fmt(BigInt(value)/1000n,1)+'k':fmt(value,0);
const exactExport = value => value == null ? '' : BigInt(value)<0n ? '-'+inputAmount(-BigInt(value)) : inputAmount(value);
const field = (label, name, value = '', extra = '', help = '') => `<label>${escape(label)}<input name="${escape(name)}" value="${escape(value)}" ${extra}>${help ? `<small>${escape(help)}</small>` : ''}</label>`;
const select = (label, name, rows, value) => `<label>${escape(label)}<select name="${escape(name)}">${options(rows, value)}</select></label>`;
const hasPending = state => Boolean(state.pendingExecution);
const companionDefaults = () => ({ scene:'journal', goal_crop:'5000', goal_wallet_id:'', pinned_plot_id:null, theme_plot:null, artwork_enabled:false, artwork_environment:'production', assume_planted:false });
function companionPreferences(value={}) {
  const result=companionDefaults();
  if(value==null||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid companion preferences.');
  if(['journal','plot',...seasonLooks.map(s=>s.id)].includes(value.scene))result.scene=value.scene;
  if(value.theme_plot!=null)result.theme_plot=validateSavedPlotArt(value.theme_plot);
  if(result.scene==='plot'&&!result.theme_plot)result.scene='journal';
  result.artwork_enabled=value.artwork_enabled===true;
  if(value.artwork_environment!=null&&!['production','rehearsal'].includes(value.artwork_environment))throw Error('Invalid artwork source.');
  result.artwork_environment=value.artwork_environment??'production';
  if(value.assume_planted!=null&&typeof value.assume_planted!=='boolean')throw Error('Invalid planting preview setting.');
  result.assume_planted=value.assume_planted===true;
  if(value.goal_crop!=null){const target=units(value.goal_crop);if(target<=0n||target>=2n**256n)throw new Error('CROP goal must be a positive token amount.');result.goal_crop=inputAmount(target);}
  if(typeof value.goal_wallet_id==='string'&&value.goal_wallet_id.length<=120)result.goal_wallet_id=value.goal_wallet_id;
  if(Number.isInteger(value.pinned_plot_id)&&value.pinned_plot_id>=1&&value.pinned_plot_id<=3333)result.pinned_plot_id=value.pinned_plot_id;
  return result;
}

function isLegacyPreGenesisForecast(raw, scenario, manual) {
  const genesis=rules.schedule.genesis_timestamp*1000;
  // A saved chain observation is stronger than its file timestamp. Never
  // rewrite an observed post-Genesis farm, even if its number happens to
  // equal the old full-supply fallback.
  const observedDates=[raw.portfolio?.observed_at_utc,raw.portfolio?.reward_observed_at_utc,
    raw.season?.observed_at_utc,raw.scenario?.rewardObservedAt].filter(value=>value!=null&&value!=='');
  const observedBlocks=[raw.portfolio?.block_timestamp,raw.season?.block_timestamp].filter(value=>value!=null);
  if(observedDates.some(value=>{const at=Date.parse(value);return Number.isFinite(at)&&at>=genesis})||
     observedBlocks.some(value=>Number.isSafeInteger(value)&&value*1000>=genesis))return false;
  // Manual reserve timing must remain attached to the user's scenario.
  if(manual.some(key=>RESERVE_FIELDS.includes(key)))return false;
  const saved=raw.saved_at==null||raw.saved_at===''?null:Date.parse(String(raw.saved_at));
  if(raw.saved_at!=null&&raw.saved_at!=='')return Number.isFinite(saved)&&saved<genesis;
  const automaticStart=Date.parse(String(raw.scenario?.start??''));
  if(!Number.isFinite(automaticStart)||automaticStart>genesis)return false;
  const reward=raw.scenario?.rewardObservedAt;
  if(reward==null||reward==='')return true;
  const rewardAt=Date.parse(String(reward));
  return Number.isFinite(rewardAt)&&rewardAt<=genesis;
}

function migrateForecastDefaults(raw, scenario, automatic, manual) {
  if(raw.forecastDefaultsVersion===2||!Array.isArray(raw.forecastManual)||manual.includes('externalWeight')||
     (raw.scenario?.externalWeightPath?.length??0)>0)return scenario;
  const oldValue=Number(scenario.externalWeight),fullValue=Number(fullSupplyCompetition(raw.portfolio));
  if(!Number.isFinite(oldValue)||!Number.isFinite(fullValue)||oldValue!==fullValue)return scenario;
  if(!isLegacyPreGenesisForecast(raw,scenario,manual))return scenario;
  return {...scenario,externalWeight:automatic.externalWeight};
}

function glyph(kind) {
  const paths={
    plot:'<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
    sun:'<path d="M9 7h6v2h2v6h-2v2H9v-2H7V9h2zM11 1h2v3h-2zM11 20h2v3h-2zM1 11h3v2H1zM20 11h3v2h-3zM3 3h3v3H3zM18 3h3v3h-3zM3 18h3v3H3zM18 18h3v3h-3z"/>',
    wallet:'<path fill-rule="evenodd" d="M3 5h16v3h3v12H2V6h1zm1 5v8h16v-8zm10 2h4v4h-4zM5 5v2h12V5z"/>',
    crop:'<path d="M9 2h6v2h2v12h-2v3h-2v3h-2v-3H9v-3H7V4h2zM2 10h3v6h3v4H5v-3H2zM19 10h3v7h-3v3h-3v-4h3z"/>',
    basket:'<path d="M2 10h20v3h-2l-2 8H6l-2-8H2zm4-2 4-6h3L9 8zm9-6h3l4 6h-4zM8 14v4h2v-4zm6 0v4h2v-4z"/>',
    upgrade:'<path d="m12 2 10 10h-6v10H8V12H2z"/>',
    arrow:'<path d="M13 4h3v3h3v3h3v4h-3v3h-3v3h-3v-6H2v-4h11z"/>',
    list:'<path d="M2 3h4v4H2zM9 3h13v4H9zM2 10h4v4H2zM9 10h13v4H9zM2 17h4v4H2zM9 17h13v4H9z"/>',
    sprout:'<path d="M10 22V12H5V9H2V3h5v3h3v4h2V6h3V3h7v7h-3v3h-5v9z"/>',
    refresh:'<path d="M5 3h13v3h3v5h-7V8h4V6H6v3H3V6h2zM3 13h7v3H6v2h12v-3h3v3h-3v3H5v-3H3z"/>',
    puzzle:'<path d="M9 2h6v5h6v6h-5v5h5v4H2v-9h5V8H2V7h7z"/>'
  };
  return `<svg class="glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${paths[kind]??paths.sprout}</svg>`;
}

export function parsePublicWorkspace(text) {
  const raw = JSON.parse(text), portfolio = raw.portfolio ?? raw;
  const errors = validatePortfolio(portfolio, false);
  if (errors.length) throw new Error(errors.join(' '));
  const manual = forecastManualFields(raw.forecastManual,raw.scenario);
  if(raw.simulationMode!=null&&!['automatic','custom'].includes(raw.simulationMode))throw Error('Invalid simulation mode.');
  const hasCustomPath=['weatherPath','weatherEvents','externalWeightPath'].some(key=>raw.scenario?.[key]?.length);
  const oldAutomaticWeight=raw.forecastDefaultsVersion!==2&&Array.isArray(raw.forecastManual)&&
    Number(raw.scenario?.externalWeight)===Number(fullSupplyCompetition(portfolio))&&isLegacyPreGenesisForecast(raw,raw.scenario,manual);
  const hasCustomWeight=raw.scenario?.externalWeight!=null&&Number(raw.scenario.externalWeight)!==0&&!oldAutomaticWeight;
  const simulationMode=raw.simulationMode??(manual.length||hasCustomPath||hasCustomWeight?'custom':'automatic');
  const automatic = simulationMode==='automatic'?automaticForecast(portfolio):forecastDefaults(portfolio);
  let scenario = simulationMode==='automatic'?{...automatic.scenario}:{ ...automatic.scenario, ...(raw.scenario ?? {}), walletMode:'keep' };
  if(simulationMode==='custom')scenario = migrateForecastDefaults(raw,scenario,automatic.scenario,manual);
  if(simulationMode==='custom'&&raw.scenario?.weatherWeeks!=null){
    if(raw.scenario.weatherBasis==null)delete scenario.weatherBasis;
    if(raw.scenario.weatherObservedAt==null)delete scenario.weatherObservedAt;
  }
  if(simulationMode==='custom'&&raw.scenario?.useKnownWeather==null&&(manual.includes('weatherBps')||raw.scenario?.weatherPath?.length)){scenario.useKnownWeather=false;manual.push('useKnownWeather');}
  const structural = validateScenario(scenario);
  if (structural.length) throw new Error(structural.join(' '));
  const days = raw.days ?? 90;
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Forecast length must be 1–365 whole days.');
  // Preserve a prior unresolved action during an explicit legacy import. It cannot
  // be silently removed by resetting the calculator workspace.
  return { schema_version:2, simulationMode, forecastDefaultsVersion:2, portfolio, scenario, days, forecastManual:[...new Set(manual)], companion:companionPreferences(raw.companion), activePlan:validateActivePlanSettings(raw.activePlan), activePlanClock:validateActivePlanClock(raw.activePlanClock), season:raw.season?validateSeason(raw.season):null, pendingExecution:raw.pendingExecution ?? null, executionLog:raw.executionLog ?? [], saved_at:raw.saved_at ?? null };
}

function makeInitialState() {
  const portfolio=emptyPortfolio(),scenario=automaticForecast(portfolio).scenario;
  return { schema_version:2, simulationMode:'automatic', forecastDefaultsVersion:2, portfolio, scenario, days:90, forecastManual:[], companion:companionDefaults(), activePlan:activePlanDefaults(), activePlanClock:{}, season:null, pendingExecution:null, executionLog:[] };
}

function chart(horizons) {
  if (!horizons?.length) return '';
  const sorted = [...horizons].sort((a,b) => a.days-b.days), maxDays = sorted.at(-1).days;
  const top = sorted.reduce((max,row) => BigInt(row.earned_crop_wei) > max ? BigInt(row.earned_crop_wei) : max, 1n);
  const points = [[45,176], ...sorted.map(row => [45 + row.days / maxDays * 580, 176 - Number(BigInt(row.earned_crop_wei) * 14000n / top) / 100])];
  const path = points.map(([x,y],i) => `${i ? 'L':'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 665 220" role="img" aria-label="Projected CROP earnings across ${maxDays} days. Exact values are in the horizon table."><line class="gridline" x1="45" y1="36" x2="625" y2="36"/><line class="gridline" x1="45" y1="106" x2="625" y2="106"/><line class="gridline" x1="45" y1="176" x2="625" y2="176"/><path class="area" d="${path} L625,176 Z"/><path class="line" d="${path}"/>${sorted.map((row,i) => `<circle cx="${points[i+1][0]}" cy="${points[i+1][1]}" r="4"><title>${row.days} days: ${crop(row.earned_crop_wei)}</title></circle>`).join('')}<text x="45" y="205">Day 0</text><text x="625" y="205" text-anchor="end">Day ${maxDays}</text><text x="45" y="21">${fmt(top,0)} CROP</text></svg>`;
}

function distinctMessages(messages) {
  return [...new Set((Array.isArray(messages)?messages:[messages]).filter(value=>value!=null&&String(value).trim()!=='').map(value=>String(value)))];
}

function previousSnapshotStatus(portfolio) {
  const observed=portfolio?.observed_at_utc;
  return observed&&Number.isFinite(Date.parse(observed))
    ? `Previous wallet snapshot kept · last observed ${dateText(observed)}.`
    : 'Previous wallet snapshot kept.';
}

function unavailableAnalysis(errors) {
  return {status:'unavailable',errors:distinctMessages(errors),assumptions:[],wallets:[],horizons:[],upgrades:[],upgrade_paths:[],best_upgrade:null,next_fundable_upgrade:null,best_upgrade_path:null,next_fundable_path:null,advice:[]};
}

function download(filename, text, type='application/json') {
  const url = URL.createObjectURL(new Blob([text], {type})), a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mount(host, { storage = {get:()=>null,set:()=>{}}, transport=fetchJSON, compact=false, isVisible=()=>true, walletProvider=()=>globalThis.ethereum, approvalWidget, planWorkerFactory=()=>new Worker(new URL('./plan-worker.js',location.href)) }={}) {
  if(typeof FontFace!=='undefined'&&document.fonts) for(const [family,url] of [['Farm Pixel',pixelFont],['Farm Sans',bodyFont]]) {if(![...document.fonts].some(f=>f.family===family)){const font=new FontFace(family,`url(${url})`);document.fonts.add(font);font.load().catch(()=>{});}}
  const root = host.attachShadow({mode:'open'});
  root.innerHTML = `<style>${css}\n${companionCss}\n${themeCss}\n${studioCss}\n${activePlanCss}\n${workspaceCss}\n${simpleCss}</style><div class="shell ${compact ? 'compact':''}"><div class="app"><div id="view"></div><section id="action-workspace" class="action-workspace" hidden><div id="approval"></div></section></div></div><div id="modal"></div><div id="plot-studio"></div>`;
  const view = root.querySelector('#view'), reader=createReader(transport), artReader=createPlotArtReader(transport),rehearsalArtReader=createPlotArtReader(transport,{environment:'rehearsal'});
  view.addEventListener('click',event=>{const menu=view.querySelector('#tools-menu');if(menu?.open&&!menu.contains(event.target))menu.open=false;},{capture:true});
  const artwork=new Map(),artErrors=new Map(),artLoading=new Set(),failedImages=new Set();
  let displayedPlotIds=[],artGeneration=0,modalTrigger=null;
  let collectionStatus=null,collectionBusy=false,collectionRequested=false,collectionError='',collectionTimer=null;
  const currentArtReader=()=>state.companion.artwork_environment==='rehearsal'?rehearsalArtReader:artReader;
  let forecastRequested=false,forecastBusy=false,forecastGeneration=0,forecastRevision=0,calculationRevision=0,forecastPreset=null,forecastError='';
  const forecastEditing=new Set(),formDrafts=new Map(),openDetails=new Map(),scrollPositions=new Map();
  let automaticSeason=null,automaticMarket=null,automaticQueued=false,automaticInitialized=false,walletConnecting=false;
  const automaticMode=()=>state.simulationMode==='automatic';
  let upgradeView='next',desk=null,forecastView='harvest',forecastConfigCollapsed=false,lastApprovalInputs=null;
  let plotView='cards',visiblePlots=PLOT_PAGE_SIZE,plotSearch='',plotWallet='',plotStatus='',plotSort='id',seasonBusy=false,seasonError='',insights=null;
  let state=makeInitialState(), tab='farm', analysis=null, forecastBasis=null, busy=false, notice='', error='', errorDetails=[], refreshWarning=null, modal=null, destroyed=false, timer=null, storageBroken=false, storageWriteFailed=false, widget=null,controller=null,plannerMode='ranking',planDirty=false,planSettingsCollapsed=false,receiptRebuild=false,workspaceRevision=0;
  const pending=()=>hasPending(state)||Boolean(widget?.hasPending?.());
  try { const saved=storage.get(); if(saved) state=parsePublicWorkspace(saved); } catch(e) {error=`Saved data could not be loaded: ${e.message} Your original saved copy has not been overwritten.`;errorDetails=[];storageBroken=true;}
  let initialAutomaticRead=automaticMode()&&state.portfolio.wallets.some(w=>w.address)&&!state.activePlan.enabled;
  if(!automaticMode())upgradeView='routes';
  const studio=createPlotStudio(root.querySelector('#plot-studio'),{
    reader:artReader,rehearsalReader:rehearsalArtReader,
    isSelected:asset=>state.companion.scene==='plot'&&state.companion.theme_plot?.token_id===asset.token_id&&state.companion.theme_plot?.environment===asset.environment,
    onTheme:asset=>{state.companion.theme_plot=asset;state.companion.scene='plot';save(false);render();},
    onOpen:()=>{root.querySelector('.app').inert=true;},
    onClose:()=>{root.querySelector('.app').inert=false;view.querySelector('#open-plot-studio')?.focus();},
  });
  function reconcilePreferences(followTarget=false) {
    const c=state.companion,plot=allPlots(state.portfolio).find(p=>p.token_id===c.pinned_plot_id);
    const tier=plot?forecastPlotTier(state.portfolio,plot):null;
    if(c.pinned_plot_id!=null&&(!plot||!plot.is_active||plot.level==null||plot.level>=5||tier==null))c.pinned_plot_id=null;
    else if(plot&&followTarget){c.goal_wallet_id=plot.wallet_id;c.goal_crop=String(rules.levels.entries[plot.level].incremental_upgrade_cost_crop);}
    if(c.goal_wallet_id&&!state.portfolio.wallets.some(w=>w.id===c.goal_wallet_id))c.goal_wallet_id=state.portfolio.wallets.find(w=>w.plots.length)?.id??'';
    if(plotWallet&&!state.portfolio.wallets.some(w=>w.id===plotWallet))plotWallet='';
  }
  function resetView() {
    refreshWarning=null;automaticSeason=null;automaticMarket=null;automaticInitialized=false;initialAutomaticRead=automaticMode()&&state.portfolio.wallets.some(w=>w.address)&&!state.activePlan.enabled;
    desk=null;upgradeView=automaticMode()?'next':'routes';forecastView='harvest';forecastConfigCollapsed=false;formDrafts.clear();openDetails.clear();scrollPositions.clear();
    forecastGeneration++;forecastRequested=false;forecastBusy=false;forecastPreset=null;forecastError='';forecastBasis=null;forecastEditing.clear();
    plotSearch='';plotWallet='';plotStatus='';plotSort='id';visiblePlots=PLOT_PAGE_SIZE;plotView='cards';tab='farm';planDirty=false;planSettingsCollapsed=false;plannerMode='ranking';
    artGeneration++;artwork.clear();artErrors.clear();artLoading.clear();failedImages.clear();studio.close();
  }
  function hydratePlotArtwork() {
    if(destroyed||desk||!state.companion.artwork_enabled||tab!=='farm'||plotView!=='cards')return;
    for(const id of displayedPlotIds){
      if(artLoading.size>=3)break;
      if(artwork.has(id)||artErrors.has(id)||artLoading.has(id))continue;
      const generation=artGeneration;artLoading.add(id);
      currentArtReader().read(id).then(asset=>{if(generation===artGeneration)artwork.set(id,asset);})
        .catch(e=>{if(generation===artGeneration)artErrors.set(id,e.code==='ASSET_UNREVEALED'?'Waiting for reveal':e.message);})
        .finally(()=>{if(generation===artGeneration){artLoading.delete(id);if(!destroyed){updatePlotArtwork(id);hydratePlotArtwork();}}});
    }
  }
  function updateArtworkStatus() {
    const target=view.querySelector('#plot-art-status');if(!target)return;
    const hasErrors=state.companion.artwork_enabled&&displayedPlotIds.some(id=>artErrors.has(id)||failedImages.has(artwork.get(id)?.image_url));
    const waiting=hasErrors&&displayedPlotIds.some(id=>artErrors.get(id)==='Waiting for reveal');
    target.innerHTML=hasErrors?`<span class="plot-art-state">${waiting?'Waiting for revealed artwork.':'Some artwork is unavailable.'}</span><button id="retry-plot-art" class="quiet">Retry artwork</button>`:'';
    target.querySelector('button')?.addEventListener('click',()=>{
      artErrors.clear();failedImages.clear();artwork.clear();artReader.clear();rehearsalArtReader.clear();updateArtworkStatus();hydratePlotArtwork();
    });
  }
  function bindRemoteImage(image) {
    image.onerror=()=>{failedImages.add(image.src);image.onerror=null;image.src=art.hero;image.alt='Example farm illustration; plot image unavailable';const note=image.closest('.plot-picture')?.querySelector('.art-note');if(note)note.textContent='Art unavailable · example';updateArtworkStatus();};
  }
  function updatePlotArtwork(id) {
    if(!state.companion.artwork_enabled)return;
    const card=view.querySelector(`[data-art-card="${id}"]`),asset=artwork.get(id);
    if(card){
      if(asset&&!failedImages.has(asset.image_url)){
        const image=card.querySelector('.plot-picture img');bindRemoteImage(image);image.referrerPolicy='no-referrer';image.alt=`${asset.environment==='rehearsal'?'Rehearsal':'Production'} artwork for plot #${id}`;image.src=asset.image_url;
        card.querySelector('.art-note').textContent=`${asset.environment==='rehearsal'?'Rehearsal':'Production'} #${id}`;
      }else if(artErrors.has(id))card.querySelector('.art-note').textContent=artErrors.get(id)==='Waiting for reveal'?'Unrevealed · example':'Art unavailable · example';
    }
    updateArtworkStatus();
  }
  function setAutomaticInputs() {
    const preset=automaticForecast(state.portfolio,{season:automaticSeason,market:automaticMarket});
    state.scenario=preset.scenario;
    state.companion.assume_planted=true;
    state.activePlan={...state.activePlan,...preset.activePlanSettings};
    forecastPreset=preset;automaticInitialized=true;
  }
  function refreshAutomaticOnOpen() {
    if(!initialAutomaticRead||destroyed||forecastLocked()||!isVisible()||document.visibilityState==='hidden')return;
    initialAutomaticRead=false;void refresh();
  }
  function scheduleAutomaticEstimate() {
    if(initialAutomaticRead){queueMicrotask(refreshAutomaticOnOpen);return;}
    const run=controller?.snapshot();
    if(!automaticMode()||!allPlots(state.portfolio).length||analysis||automaticQueued||forecastLocked()||['refreshing','calculating'].includes(run?.phase))return;
    if(!automaticInitialized){setAutomaticInputs();save(false);}
    automaticQueued=true;
    queueMicrotask(()=>{automaticQueued=false;if(!destroyed&&automaticMode()&&!analysis&&!forecastLocked())calculate();});
  }
  function save(invalidate=true,{keepPlan=false}={}) {
    workspaceRevision++;reconcilePreferences();
    const action=actionState();
    if(invalidate&&automaticMode()&&!action.hasDraft&&!action.busy&&!action.locked)setAutomaticInputs();
    if(invalidate){calculationRevision++;analysis=null;insights=null;forecastBasis=null;if(!keepPlan)controller?.invalidate();} state.saved_at=new Date().toISOString();
    if(storageBroken) return;
    try {storage.set(json(state));storageWriteFailed=false;} catch(e) {storageWriteFailed=true;error=`Changes are in memory only. Export your farm to keep a copy. ${e.message}`;errorDetails=[];}
  }
  function ensureMutable() {
    if(busy) throw new Error('Wait for the current wallet read to finish.');
    if(pending()) throw new Error('This workspace contains an unresolved wallet action. Reconcile that action before replacing or editing its wallets.');
    if(storageBroken) throw new Error('Export or reset the damaged saved workspace before saving a new farm.');
  }
  function recount() {
    state.portfolio.expected_total_plots=allPlots(state.portfolio).length;
    for(const w of state.portfolio.wallets) w.expected_plot_count=w.plots.length;
  }
  function addWatchedWallet(address,label='') {
    if(!/^0x[0-9a-fA-F]{40}$/.test(address))throw Error('Enter a valid 0x public wallet address.');
    if(state.portfolio.wallets.some(w=>w.address?.toLowerCase()===address.toLowerCase()))throw Error('That wallet is already in this farm.');
    const blank=state.portfolio.wallets.find(w=>!w.address&&!w.plots.length);
    if(!blank&&state.portfolio.wallets.length>=20)throw Error('This workspace supports up to 20 wallets.');
    const wallet=blank??{id:`wallet_${Date.now()}`,plots:[]};
    Object.assign(wallet,{address:address.toLowerCase(),label:label||`Wallet ${state.portfolio.wallets.filter(w=>w.address).length+1}`,crop_balance_wei:null,eth_balance_wei:null,expected_plot_count:0});
    if(!blank)state.portfolio.wallets.push(wallet);checkState();save();
  }
  function checkState() {
    const errors=validatePortfolio(state.portfolio,false);
    if(errors.length) throw new Error(errors.join(' '));
  }
  function calculate() {
    if(busy)return;
    const rawPortfolio=clone(state.portfolio),scenario=clone(state.scenario),days=state.days,now=Date.now(),revision=calculationRevision,assumePlanted=state.companion.assume_planted===true;
    error=''; errorDetails=[]; notice=''; busy=true; render();
    // Yield a frame before the deterministic calculation; no network or model calls.
    timer=setTimeout(() => {
      try {
        if(!destroyed&&revision===calculationRevision){
          const prepared=prepareForecastPortfolio(rawPortfolio,{assumePlanted});
          forecastBasis=prepared;
          if(prepared.errors.length){
            analysis=unavailableAnalysis(prepared.errors);
            insights=null;
            errorDetails=prepared.errors.slice(1);
          } else {
            analysis=analyzeFarm(clone(prepared.portfolio),scenario,{days,now});
            updateInsights(prepared.portfolio);
            if(analysis.status==='ok')forecastConfigCollapsed=true;
          }
        }
      }
      catch(e) {analysis=unavailableAnalysis([e.message]);insights=null;forecastBasis=null;error=e.message;errorDetails=[];}
      busy=false;if(!destroyed)render();
    },20);
  }
  function updateInsights(portfolio=forecastBasis?.portfolio??state.portfolio) {
    insights=analysis?.status==='ok'?analyzeInsights(clone(portfolio),clone(state.scenario),{days:state.days,goalCrop:state.companion.goal_crop,goalDays:365}):null;
  }
  async function refreshSeason() {
    if(seasonBusy)return;
    seasonBusy=true;seasonError='';render();
    try {state.season=await readSeason(reader.rpc);save(false);}
    catch(e){seasonError=`Valley read failed: ${e.message}`;}
    finally {seasonBusy=false;if(!destroyed)render();}
  }
  function forecastLocked() {
    const action=actionState();
    return busy||storageBroken||storageWriteFailed||action.locked||action.busy||action.hasDraft;
  }
  function applyForecastDefaults(preset) {
    const protectedFields=new Set([...state.forecastManual,...forecastEditing]);
    // Reserve amounts and their timestamp are one observation, never a mixture.
    const keepReserves=RESERVE_FIELDS.some(key=>protectedFields.has(key));
    const form=view.querySelector('#assumptions');
    for(const key of FORECAST_FIELDS){
      if(protectedFields.has(key)||(keepReserves&&RESERVE_FIELDS.includes(key)))continue;
      state.scenario[key]=preset.scenario[key];
      const input=form?.elements.namedItem(key);
      if(input){if(input.type==='checkbox')input.checked=preset.scenario[key];else input.value=key==='start'?preset.scenario.start.slice(0,16):String(preset.scenario[key]);}
    }
    if(!keepReserves){
      state.scenario.rewardStateBasis=preset.scenario.rewardStateBasis;
      if(preset.scenario.rewardObservedAt)state.scenario.rewardObservedAt=preset.scenario.rewardObservedAt;
      else delete state.scenario.rewardObservedAt;
      if(form){
        if(state.scenario.rewardStateBasis==='observed')form.dataset.observed=JSON.stringify({at:state.scenario.rewardObservedAt,start:state.scenario.start.slice(0,16),carry:state.scenario.carryCrop,granary:state.scenario.granaryCrop});
        else delete form.dataset.observed;
      }
    }
    for(const key of ['weatherWeeks','weatherBasis','weatherObservedAt'])state.scenario[key]=clone(preset.scenario[key]);
    forecastPreset=preset;save();
  }
  async function refreshForecastDefaults({reset=false}={}) {
    if(forecastBusy||forecastLocked())return;
    forecastRequested=true;forecastBusy=true;forecastError='';
    const generation=++forecastGeneration,revision=forecastRevision;
    if(reset){
      state.forecastManual=[];forecastEditing.clear();formDrafts.delete('assumptions');
      const form=view.querySelector('#assumptions');if(form){delete form.dataset.dirty;delete form.dataset.observed;}
      state.scenario.weatherPath=[];state.scenario.weatherEvents=[];state.scenario.externalWeightPath=[];
    }
    applyForecastDefaults(forecastDefaults(state.portfolio));render();
    try {
      const season=await readSeason(reader.rpc);
      if(destroyed||generation!==forecastGeneration)return;
      const market=await readCropReference(reader.rpc,season.block_number);
      if(destroyed||generation!==forecastGeneration||forecastLocked())return;
      // A calculation submitted during the read keeps its reviewed inputs/results.
      if(desk||tab!=='forecast'||revision!==forecastRevision){forecastError='New chain data is ready. Use chain defaults to apply it.';return;}
      applyForecastDefaults(forecastDefaults(state.portfolio,{season,market}));
    } catch {
      if(generation===forecastGeneration)forecastError='Chain unavailable · scenario defaults are ready.';
    } finally {
      if(generation===forecastGeneration){forecastBusy=false;if(!destroyed)render();}
    }
  }
  function forecastSourceNote() {
    const preset=forecastPreset??forecastDefaults(state.portfolio),custom=new Set([...state.forecastManual,...forecastEditing]);
    const heading=forecastBusy?'Checking chain…':forecastError||(preset.basis==='chain'?`${preset.partial?'Partial chain read':'Chain defaults'} · block ${preset.block_number.toLocaleString()}`:'Scenario defaults · ready to calculate');
    const prices=custom.has('buyPrice')||custom.has('sellPrice')?'selected / reference inputs':preset.priceBasis;
    const keepReserves=RESERVE_FIELDS.some(key=>custom.has(key));
    const sourceText=(key,value)=>{
      if(keepReserves&&(key==='start'||key==='reserves'))return key==='start'?'Start: your selected reserve scenario is kept.':'Carry and Granary: your reserve inputs are kept together with their selected start.';
      if(key==='prices'&&(custom.has('buyPrice')||custom.has('sellPrice')))return 'Prices include your selected inputs. Available default: '+value;
      if(custom.has(key))return ({externalWeight:'Additional valley weight',weatherBps:'Unrevealed weather',useKnownWeather:'Known weeks',annualGrowthPct:'Yearly valley weight growth'}[key]??key)+': your selected input is kept.';
      return value;
    };
    return `<div id="forecast-source" class="forecast-source"><div class="row spread"><p class="small" role="status">${escape(heading)}<br><span class="muted">Prices: ${escape(prices)}${custom.size?' · selected fields kept':''}</span></p><button type="button" id="use-chain-defaults" class="quiet" ${forecastBusy||forecastLocked()?'disabled':''}>Use chain defaults</button></div><details><summary>Input sources & assumptions</summary><p>${preset.observed_at_utc?'Read '+escape(dateText(preset.observed_at_utc))+'. ':''}Chain reads use one block; user edits are kept. Use chain defaults to replace them.</p><ul>${Object.entries(preset.sources).map(([key,value])=>`<li>${escape(sourceText(key,value))}</li>`).join('')}</ul><p>Dates, weather and optional valley harvest limits remain editable. Temporary event boosts are not projected. Values are forecast references, not executable trade quotes.</p></details></div>`;
  }

  function forecastBasisNote() {
    const basis=forecastBasis;
    if(!basis||basis.errors?.length)return '';
    const pendingCount=Number(basis.pending_count??0),assumed=Number(basis.assumed_planted_count??0);
    if(!pendingCount&&!assumed)return '';
    const preview=basis.mode==='manifest-preview';
    const messages=[];
    if(preview)messages.push('<strong>Revealed-trait preview · on-chain rarity pending</strong>');
    if(assumed){
      const cost=fmt(basis.planting_cost_crop_wei??'0',0);
      messages.push(`<strong>Planting funded separately: ${escape(cost)} CROP · excluded from harvest</strong><span>${assumed} dormant ${assumed===1?'plot':'plots'} assumed planted · planting uses separate capital.</span>`);
    }
    return `<div class="forecast-basis" role="status">${messages.join('')}</div>`;
  }

  function tierPresentation(portfolio, plot) {
    const tier=forecastPlotTier(portfolio,plot);
    const pending=tier!=null&&(plot.rarity_tier==null||plot.rarity_verified===false||plot.tiers_finalized===false);
    const revealedPending=tier==null&&(plot.reveal_status==='revealed'||plot.metadata_reveal_status==='revealed')&&(plot.rarity_verified===false||plot.tiers_finalized===false||plot.rarity_status==='pending_finalization');
    const name=tier==null?(revealedPending?'Rarity pending':'Unrevealed'):rules.plots.rarities[tier]?.name??'Unknown';
    return {tier,pending,label:pending?`${name} · pending`:name};
  }

  function rawPlotFor(walletId, plotId) {
    return state.portfolio.wallets.find(wallet=>wallet.id===walletId)?.plots.find(plot=>plot.token_id===plotId)??null;
  }

  function rarityLabelForUpgrade(row) {
    const raw=rawPlotFor(row.wallet_id,row.plot_id);
    return raw?tierPresentation(state.portfolio,raw).label:rules.plots.rarities[row.rarity_tier]?.name??'Unknown';
  }

  function weightUnits(value) {
    const n=Number(value);
    return Number.isFinite(n)?(n/10000).toLocaleString('en-US',{maximumFractionDigits:4}):'—';
  }

  function multiplierText(value) {
    const n=Number(value);
    return Number.isFinite(n)?`${n/10000}×`:'—';
  }

  function harvestLimitsNotice(limits, days) {
    if(!limits||(!limits.base_limited&&!limits.bonus_limited))return '';
    const reasons=[limits.base_limited?'the annual release and carry ceiling':'',limits.bonus_limited?'the finite Granary':''].filter(Boolean);
    const nominal=limits.nominal_crop_wei==null?'':` Nominal at your weight for ${days} days is ${fmt(limits.nominal_crop_wei,0)} CROP; the finite projection is ${fmt(limits.projected_crop_wei,0)} CROP.`;
    return `<div class="notice harvest-limit-notice" role="status"><strong>Projected harvest is limited by ${escape(reasons.join(' and '))}.</strong><p>${nominal.trim()} The rate above is nominal; the selected term remains a finite scenario estimate.</p></div>`;
  }

  function harvestRateBlock(rate, limits, days) {
    if(!rate||rate.nominal_weekly_crop_wei==null&&rate.nominal_daily_crop_wei==null&&rate.nominal_hourly_crop_wei==null)return '';
    const perWeight=Number(rules.emissions.nominal_crop_per_weight_week);
    const rateFigure=value=>BigInt(value??0)>=1000n*10n**18n?compactCrop(value):fmt(value,2);
    const modifierFormula=`${multiplierText(rate.weather_multiplier_bps)} weather × ${multiplierText(rate.first_soil_multiplier_bps)} First Soil`;
    const formula=Number.isFinite(perWeight)
      ? `${perWeight.toLocaleString('en-US')} CROP/week × ${weightUnits(rate.active_weight_bps)} weight × ${modifierFormula}`
      : `nominal CROP/week × ${weightUnits(rate.active_weight_bps)} weight × ${modifierFormula}`;
    const factors=`Combined ${multiplierText(rate.combined_multiplier_bps)}`;
    const at=rate.at_utc?` · ${escape(dateText(rate.at_utc))}`:'';
    const active=Number(rate.active_weight_bps),zeroNominal=[rate.nominal_hourly_crop_wei,rate.nominal_daily_crop_wei,rate.nominal_weekly_crop_wei].every(value=>{try{return value!=null&&BigInt(value)===0n;}catch{return false;}});
    const start=Date.parse(String(rate.at_utc??'')),beforeGenesis=Number.isFinite(start)&&start<rules.schedule.genesis_timestamp*1000;
    const status=active<=0?'No active plot weight at this start.':zeroNominal&&beforeGenesis?'The growing season has not started at this forecast start; own rate is 0 until Genesis.':zeroNominal?'No emission is scheduled at this forecast start.' : '';
    return `<section class="harvest-rate" aria-label="Your harvest rate"><div class="harvest-rate-heading"><div><div class="eyebrow">Your harvest rate</div><h3>At forecast start · before harvest limits</h3><p class="harvest-rate-formula">Nominal formula: ${escape(formula)}</p>${status?`<p class="harvest-rate-status">${escape(status)}</p>`:''}</div><p class="harvest-rate-factors">${factors}${at}</p></div><div class="harvest-rate-values"><div><strong title="${fmt(rate.nominal_hourly_crop_wei,6)} CROP">${rateFigure(rate.nominal_hourly_crop_wei)}</strong><small>CROP / hour</small></div><div><strong title="${fmt(rate.nominal_daily_crop_wei,6)} CROP">${rateFigure(rate.nominal_daily_crop_wei)}</strong><small>CROP / day</small></div><div><strong title="${fmt(rate.nominal_weekly_crop_wei,6)} CROP">${rateFigure(rate.nominal_weekly_crop_wei)}</strong><small>CROP / week</small></div></div>${harvestLimitsNotice(limits,days)}</section>`;
  }
  async function refresh({fromPlan=false,afterReceipt=false}={}) {
    if(busy || !isVisible() || (!afterReceipt&&(widget?.getActionState?.().busy||widget?.getActionState?.().hasDraft||pending()))) return false;
    let success=false;
    const addresses=state.portfolio.wallets.filter(w=>w.address);
    if(!addresses.length) {error='Add a public wallet address to refresh its on-chain plots.';errorDetails=[];render();return false;}
    const previousPortfolio=clone(state.portfolio);
    busy=true;error='';errorDetails=[];notice='Reading public balances and plots at one chain block…';refreshWarning=null;render();
    try {
      const request={...clone(state.portfolio),wallets:clone(addresses),expected_total_plots:addresses.reduce((n,w)=>n+w.plots.length,0)};
      const observed=await reader.snapshot(request);
      const candidate={...observed,wallets:state.portfolio.wallets.map(w=>w.address ? observed.wallets.find(o=>o.id===w.id)??w:clone(w))};
      candidate.expected_total_plots=allPlots(candidate).length;
      candidate.wallets.forEach(w=>{w.expected_plot_count=w.plots.length;});
      const mergeErrors=validatePortfolio(candidate,false);
      if(mergeErrors.length)throw new Error(`The refreshed inventory conflicts with this farm. ${mergeErrors.join(' ')} Change or remove colliding model plot IDs, then refresh again. Your previous farm is unchanged.`);
      const readErrors=distinctMessages(observed.read_errors);
      if(readErrors.length){
        const [first,...rest]=readErrors;
        error=`Some data could not be verified: ${first}`;errorDetails=rest;
        refreshWarning={message:error,details:rest,observedAt:previousPortfolio.observed_at_utc};
        notice=previousSnapshotStatus(previousPortfolio);
        if(!fromPlan)controller?.invalidate();
      } else {
        let market=null;
        if(automaticMode()&&fromPlan){
          let deadline;
          try{market=await Promise.race([readCropReference(reader.rpc,candidate.block_number).catch(()=>null),new Promise(resolve=>{deadline=setTimeout(()=>resolve(null),2000);})]);}
          finally{clearTimeout(deadline);}
        }
        state.portfolio=candidate;automaticSeason=null;automaticMarket=market;reconcilePreferences(true);save(true,{keepPlan:fromPlan});success=true;
        refreshWarning=null;
        notice=`Farm refreshed · block ${observed.block_number?.toLocaleString() ?? 'unknown'}.`;
      }
    } catch(e) {
      error=`Wallet refresh failed: ${e.message}`;errorDetails=[];
      refreshWarning={message:error,details:[],observedAt:previousPortfolio.observed_at_utc};
      notice=previousSnapshotStatus(previousPortfolio);
      if(!fromPlan)controller?.invalidate();
    }
    busy=false;if(!destroyed)render();
    if(success&&automaticMode()&&!fromPlan&&!afterReceipt){
      const portfolio=state.portfolio,revision=workspaceRevision;
      // Optional market data can improve prices without holding up a wallet import.
      readCropReference(reader.rpc,portfolio.block_number).then(market=>{
        const action=actionState();
        if(destroyed||state.portfolio!==portfolio||!automaticMode())return;
        automaticMarket=market;
        if(workspaceRevision!==revision||action.locked||action.busy||action.hasDraft||controller.snapshot().plan)return;
        save();render();
      }).catch(()=>{});
    }
    return success;
  }
  function showError(fn) {return async event=>{
    event?.preventDefault();const before=clone(state),revision=workspaceRevision;
    const form=event?.type==='submit'&&event.target?.id?event.target:null;
    const draft=form?{id:form.id,observed:form.dataset.observed,values:[...form.elements].filter(el=>el.name).map(el=>({name:el.name,value:el.value,checked:el.checked}))}:null;
    try {error='';errorDetails=[];notice='';await fn(event);}catch(e){if(workspaceRevision===revision)state=before;if(draft)formDrafts.set(draft.id,draft);error=e.message;errorDetails=[];render();}
  };}
  function scenePicker() {
    const looks=[{id:'journal',name:'Field journal',image:companionHero},...seasonLooks];
    return `<div class="scene-picker" role="group" aria-label="Journal scenery">${looks.map(s=>`<button class="scene-option ${state.companion.scene===s.id?'selected':''}" data-scene="${s.id}" aria-pressed="${state.companion.scene===s.id}" aria-label="Scene: ${escape(s.name)}" title="${escape(s.name)} · companion theme"><img src="${s.image}" alt="" width="48" height="48"><span>${escape(s.name)}</span></button>`).join('')}</div><p class="scene-caption">${state.companion.scene==='plot'?`<span>Theme from ${state.companion.theme_plot.environment} plot #${state.companion.theme_plot.token_id}</span>`:'<span>Your theme, throughout the companion.</span>'}<button id="open-plot-studio" class="quiet">${glyph('plot')}Explore plot themes</button></p>`;
  }
  function collectionBoard() {
    const s=collectionStatus,stale=s&&Date.now()-Date.parse(s.last_checked_at_utc)>10*60000;
    const labels={waiting_for_reveal:'Waiting for reveal',waiting_for_assets:'Waiting for asset details',collecting:'Gathering revealed plots',complete:'Collection ready',unavailable:'Watcher needs a check'};
    const countText=s?.phase==='waiting_for_reveal'&&s.minted_count!=null
      ? `${s.minted_count.toLocaleString()} / 3,333 minted · awaiting reveal`
      : s ? `${s.collected_count.toLocaleString()} / 3,333 plots collected` : 'Check the collection watcher.';
    return `<section class="collection-watch panel" aria-label="Collection reveal watch"><div class="collection-watch-title">${glyph('sprout')}<div><div class="eyebrow">Reveal watch</div><h2>${stale?'Saved collection status':s?labels[s.phase]:'Collection watch'}</h2><p>${countText}</p></div></div><div class="collection-watch-actions"><button id="refresh-collection" ${collectionBusy?'disabled':''}>${glyph('refresh')}${collectionBusy?'Checking…':'Refresh status'}</button>${s?.collected_count?`<a class="button-link" href="${COLLECTION_CATALOG_URL}" target="_blank" rel="noopener noreferrer">Download collected plots</a>`:''}</div>${s?`<progress aria-label="Collected production plots" max="3333" value="${s.collected_count}"></progress><p class="collection-progress-caption">${s.collected_count.toLocaleString()} revealed assets collected</p><details class="disclosure"><summary>Last check · ${escape(dateText(s.last_checked_at_utc))}</summary><p>Runs on the companion server, even with your browser closed. Only revealed production metadata is collected. Wallet facts and upgrade advice still come from chain.</p>${s.error?`<p>${escape(s.error)}</p>`:''}</details>`:''}${collectionError?`<p class="rule-note" role="status">${escape(collectionError)}</p>`:''}</section>`;
  }
  function collectionVisible() {return document.visibilityState!=='hidden'&&isVisible()&&(desk==='valley'||(!desk&&tab==='farm'&&state.companion.artwork_enabled&&state.companion.artwork_environment==='production'));}
  function scheduleCollection() {
    clearTimeout(collectionTimer);if(destroyed)return;
    collectionTimer=setTimeout(()=>{if(collectionVisible())void refreshCollection();else scheduleCollection();},30000);
  }
  async function refreshCollection() {
    if(collectionBusy||destroyed)return;
    collectionRequested=true;collectionBusy=true;collectionError='';if(desk==='valley')render();
    try {
      const next=await readCollectionStatus(transport);if(destroyed)return;
      const gained=next.collected_count>(collectionStatus?.collected_count??0);collectionStatus=next;
      if(gained&&state.companion.artwork_environment==='production'){artErrors.clear();artReader.clear();hydratePlotArtwork();}
    } catch(e){collectionError=`Watcher unavailable. ${e.message}`;}
    finally {collectionBusy=false;if(!destroyed){if(desk==='valley')render();scheduleCollection();}}
  }
  function orchardBoard() {
    const o=rules.orchard;
    return `<section class="panel" aria-label="Orchard rewards"><div class="eyebrow">The Orchard</div><div class="row spread"><h2>Farm CROP. Earn a share of AAPL.</h2><a class="button-link" href="https://rh.farm/orchard/" target="_blank" rel="noopener noreferrer">View Orchard ↗</a></div><p>${escape(o.first_basket)} AAPL announced for Sep 28–Oct 5 UTC. Your share follows the CROP your plots produce that week.</p><details class="disclosure"><summary>How rewards count</summary><p>Buying CROP or claiming older harvest does not count. Production earned before selling a plot stays with your wallet. Claims open after weekly totals are verified, require ETH gas and no CROP approval. Future baskets are not guaranteed.</p><p>AAPL is a stock token. Official Orchard records establish rewards; these estimates do not include it.</p></details></section>`;
  }

  function valleyBoard() {
    const s=state.season,calendar=getFarmCalendar(),next=calendar.nextMilestone;
    const weather=s?weatherName(s.weather_enum):'Not checked',weatherIcon=weatherGlyphs[weather.toLowerCase()]??glyph('sun');
    const beforeGenesis=s?.genesis_timestamp!=null&&s.block_timestamp<s.genesis_timestamp;
    const hours=next?Math.ceil(next.countdown_ms/3600000):0,countdown=hours>=24?`${Math.floor(hours/24)}d ${hours%24}h`:hours?`${hours}h`:'Growing season';
    const old=s&&Date.now()-Date.parse(s.observed_at_utc)>15*60*1000;
    return `<section class="valley-board" aria-label="Around the valley"><div class="weather-desk"><div class="desk-header"><div><h2>Weather</h2></div><button id="refresh-season" class="quiet" ${seasonBusy?'disabled':''}>${glyph('refresh')}${seasonBusy?'Checking…':'Check the valley'}</button></div><div class="weather-reading"><div class="weather-icon">${weatherIcon}</div><div><span class="small muted">${s?beforeGenesis?'Oracle · before Genesis':old?'Saved oracle snapshot':'Oracle snapshot':'A public read. No wallet needed.'}</span><h3>${escape(weather)}</h3></div><strong>${s?.effective_multiplier_bps!=null?`${s.effective_multiplier_bps/10000}×`:'—'}<small>weather + events</small></strong></div><div class="valley-stats"><div><strong>${s?.minted_count??'—'}<small>/ ${rules.plots.rarities.reduce((n,r)=>n+r.count,0)}</small></strong><span>plots minted</span></div><div><strong>${s?.total_weight_bps!=null?(s.total_weight_bps/10000).toLocaleString():'—'}</strong><span>planted weight</span></div><div><strong>${s?.granary_crop_wei!=null?fmt(s.granary_crop_wei,0):'—'}</strong><span>CROP in Granary</span></div><div><strong>${s?.seed_bag_price_wei!=null?fmt(s.seed_bag_price_wei,5):'—'}</strong><span>ETH / seed bag · ${s?.seed_bag_open===true?'open':s?.seed_bag_open===false?'closed':'unknown'}</span></div></div>${seasonError?`<p class="notice error" role="alert">${escape(seasonError)}</p>`:''}${s?`<details class="desk-evidence"><summary>${old?'Saved':'Read'} ${escape(dateText(s.observed_at_utc))} · block ${s.block_number.toLocaleString()}</summary><p>Robinhood Chain 4663. This snapshot stays separate from your forecast assumptions. Weather scheduling can change before its cutoff.</p>${s.read_errors.length?`<p class="notice error">Partial read: ${s.read_errors.map(escape).join(' · ')}</p>`:''}</details>`:'<p class="small muted">Weather, mint progress and the latest seed-bag quote.</p>'}</div><div class="calendar-desk"><div class="calendar-top"><img src="${seasonArt.goose}" alt="" width="80" height="96"><div><div class="eyebrow">Mark your calendar</div><h2>${next?escape(next.label):'The growing season'}</h2><div class="calendar-countdown">${countdown}<span>${next?'to the published date':'Make every harvest count'}</span></div></div></div><ol class="milestone-track" aria-label="Published farm milestones">${calendar.milestones.map(m=>`<li class="${m.status}" title="${escape(dateText(m.at_utc))}"><i></i><strong>${new Date(m.at_utc).toLocaleDateString('en-CA',{timeZone:'UTC',month:'short',day:'numeric'})}</strong><span>${escape(m.label)}</span></li>`).join('')}</ol><div class="row spread"><span class="soil-stamp">${calendar.currentFirstSoil.multiplier==null?`${rules.emissions.first_soil[0].multiplier_bps/10000}× at Genesis`:`${calendar.currentFirstSoil.multiplier}× ${calendar.currentFirstSoil.label}`}</span><button id="download-calendar" class="quiet">Save calendar</button></div><p class="small muted">Published dates · chain completion needs a fresh read.</p></div></section>`;
  }
  function weatherLab() {
    if(insights?.status!=='ok')return '';
    const weatherCases=[...insights.weather].sort((a,b)=>a.multiplier_bps-b.multiplier_bps);
    const highest=insights.weather.reduce((n,w)=>w.earned_crop_wei>n?w.earned_crop_wei:n,1n);
    return `<section class="weather-lab panel"><div class="panel-header"><div><h2>Weather lab</h2><p>${state.days} days · compare weather scenarios.</p></div><img class="weather-mascot" src="${seasonArt.scarecrow}" alt="" width="70" height="74"></div><div class="weather-cases">${weatherCases.map(w=>`<button class="weather-case ${w.selected?'selected':''}" data-weather="${w.multiplier_bps}" aria-pressed="${w.selected}" aria-label="Use ${w.name} weather scenario"><span class="weather-case-icon">${weatherGlyphs[w.name.toLowerCase()]??glyph('sun')}</span><span class="weather-case-name">${escape(w.name)}<small>${w.multiplier_bps/10000}×</small></span><strong>${fmt(w.earned_crop_wei,0)}<small>CROP</small></strong><span class="weather-bar"><i style="width:${Number(w.earned_crop_wei*100n/highest)}%"></i></span><span class="weather-difference">${w.difference_crop_wei>0n?'+':''}${fmt(w.difference_crop_wei,0)} vs your forecast</span></button>`).join('')}</div><p class="rule-note">Tap a sky to recalculate. Scenarios, not weather predictions.</p></section>`;
  }
  function goalBoard() {
    if(insights?.status!=='ok')return '';
    const goal=insights.goals.find(g=>g.wallet_id===state.companion.goal_wallet_id)??insights.goals[0];
    if(!goal)return '';
    const progress=Number((goal.current_total_crop_wei>goal.target_crop_wei?goal.target_crop_wei:goal.current_total_crop_wei)*100n/goal.target_crop_wei);
    const ready=goal.ready_in_days===0?'Goal covered':goal.ready_in_days==null?'Beyond 365 days':`About ${goal.ready_in_days} ${goal.ready_in_days===1?'day':'days'}`;
    return `<section class="goal-board panel"><div class="goal-art"><img src="${seasonArt.store}" alt="Mabel’s illustrated general store" loading="lazy" width="200" height="160"><h2>Your CROP goal</h2></div><div class="goal-content"><form id="crop-goal" class="goal-form">${select('Goal wallet','goalWallet',insights.goals.map(g=>[g.wallet_id,g.label]),goal.wallet_id)}${field('Target total CROP','goalCrop',state.companion.goal_crop,'inputmode="decimal" required')}<button class="primary" ${busy?'disabled':''}>Track goal</button></form><div class="goal-presets">${rules.levels.entries.slice(1).map(l=>`<button type="button" class="quiet" data-goal-amount="${l.incremental_upgrade_cost_crop}">${Number(l.incremental_upgrade_cost_crop)/1000}k</button>`).join('')}<span>Upgrade costs</span></div><div class="goal-progresslabel"><strong>${ready}</strong><span>${progress}% of ${fmt(goal.target_crop_wei,0)} CROP</span></div><div class="funding-bar" role="progressbar" aria-label="CROP goal progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div><div class="goal-summary"><div><strong>${fmt(goal.liquid_crop_wei,0)}</strong><span>spendable now</span></div><div><strong>${fmt(goal.pending_crop_wei,0)}</strong><span>unclaimed</span></div><div><strong>${fmt(goal.shortfall_crop_wei,0)}</strong><span>left to earn</span></div></div><p class="rule-note">${goal.ready_at_utc?`Goal date: ${escape(dateText(goal.ready_at_utc))}. `:''}${goal.claim_required?'Claim required to spend the harvest. ':''}From your forecast start · this wallet only · no spending or upgrades assumed.</p></div></section>`;
  }
  function targetPicker() {
    const available=allPlots(state.portfolio).filter(p=>p.level!=null&&p.level<5&&p.is_active&&tierPresentation(state.portfolio,p).tier!=null);
    if(!available.length)return '';
    const pinned=analysis?.upgrades?.find(p=>p.plot_id===state.companion.pinned_plot_id);
    return `<section class="target-picker panel"><img src="${seasonArt.scarecrow}" alt="" width="64" height="68"><div><div class="eyebrow">Keep one plot in sight</div><h2>Upgrade target</h2><form id="upgrade-target" class="row">${select('Target plot','targetPlot',[['','Follow the best return'],...available.map(p=>[p.token_id,`#${p.token_id} · ${walletName(state.portfolio,p.wallet_id)} · level ${p.level}`])],state.companion.pinned_plot_id??'')}<button>Set target</button></form>${pinned?`<p class="rule-note">Plot #${pinned.plot_id} → level ${pinned.to_level}: ${crop(pinned.cost_crop_wei,0)} · ${escape(dayText(pinned.ready_in_days))} from forecast start.${pinned.claim_required?' Claim needed.':''} ${pinned.funded_net_crop_wei!=null&&pinned.funded_net_crop_wei<=0n?'This target does not repay its cost within your term.':''}</p>`:'<p class="rule-note">Pin a favorite while the planner keeps comparing every plot.</p>'}</div></section>`;
  }
  function metrics() {
    const p=state.portfolio,total=allPlots(p).length,active=allPlots(p).filter(x=>x.is_active).length;
    const liquid=analysis?.portfolio?.liquid_crop_wei??(p.wallets.every(w=>w.crop_balance_wei!=null)?p.wallets.reduce((n,w)=>n+BigInt(w.crop_balance_wei),0n):null);
    const pendingCrop=analysis?.portfolio?.pending_crop_wei??(allPlots(p).every(x=>x.pending_crop_wei!=null)?allPlots(p).reduce((n,x)=>n+BigInt(x.pending_crop_wei),0n):null);
    return `<div class="metrics">${[['plot','Your plots',total,`${active} planted`],['sun','Daily harvest',fmt(analysis?.portfolio?.daily_crop_wei),automaticMode()?'CROP · after planting':'CROP · forecast'],['crop','In your pocket',fmt(liquid,0),'Spendable CROP'],['basket','Ready to harvest',fmt(pendingCrop,0),'Unclaimed CROP']].map(([kind,label,value,note])=>`<div class="metric"><span class="metric-icon">${glyph(kind)}</span><div><label>${label}</label><strong>${value}</strong><small>${note}</small></div></div>`).join('')}</div>`;
  }
  function onboarding() {
    const hasPlots=allPlots(state.portfolio).length>0;
    const full=`<div class="grid intake-grid"><section class="panel wallet-intake" id="wallet-intake"><div class="panel-header"><div><h2>Watch a wallet</h2><p>Track balances and owned plots.</p></div><span class="panel-icon">${glyph('wallet')}</span></div><form id="add-wallet" class="stack"><div class="form-grid">${field('Wallet address','address','','placeholder="0x…" required autocomplete="off" spellcheck="false"')}${field('Label (optional)','label','','placeholder="My homestead" maxlength="120"')}</div><button class="primary" ${busy?'disabled':''}>Add & refresh wallet ${glyph('arrow')}</button><span class="small muted">No connection needed.</span></form></section><section class="panel model-intake"><div class="panel-header"><div><h2>${hasPlots?'Add model plots':'Build a model farm'}</h2><p>Try a different mix.</p></div><img class="intake-art" src="${art.levels[0]}" alt="Illustrated farm plot" width="80" height="80"></div><form id="quick-farm"><div class="form-grid">${select('Model wallet','modelWallet',[...state.portfolio.wallets.filter(w=>!w.address).map(w=>[w.id,w.plots.length?w.label:'New model wallet']),['new','Create another model wallet']],state.portfolio.wallets.find(w=>!w.address)?.id??'new')}${field('Plot count','count','1','type="number" min="1" max="100" required')}</div><div class="form-grid" style="margin-top:12px">${select('Rarity','tier',[['random','Random · collection mix'],...rules.plots.rarities.map(r=>[r.tier,r.name])],0)}${select('Level','level',rules.levels.entries.map(l=>[l.level,`${l.level} · ${l.name}`]),1)}</div><div class="row spread actions"><label class="checkbox-row"><input type="checkbox" name="active" checked>Already planted</label><button aria-label="Add model plots" ${busy?'disabled':''}>Add model plots +</button></div></form></section></div>`;
    if(!automaticMode())return full;
    const model=full.slice(full.indexOf('<section class="panel model-intake">'),full.lastIndexOf('</div>'));
    return `<div class="automatic-intake"><section class="panel wallet-intake" id="wallet-intake"><div class="panel-header"><div><h2>Bring your farm</h2><p>Your plots, harvest and next upgrades.</p></div><span class="panel-icon">${glyph('wallet')}</span></div><button id="connect-farm" class="primary connect-farm" ${busy||walletConnecting?'disabled':''}>${glyph('wallet')}Connect wallet</button><form id="add-wallet" class="address-intake">${field('Wallet address','address','','placeholder="0x…" required autocomplete="off" spellcheck="false"')}<button ${busy?'disabled':''}>Add wallet</button></form></section><details class="model-builder"><summary>Try a model farm</summary>${model}</details></div>`;

  }
  function wallets() {
    const visible=state.portfolio.wallets.filter(w=>w.address||w.plots.length);
    if(!visible.length)return '';
    return `<section class="stack"><div class="section-heading">${desk==='wallets'?'':'<h2>Your wallets</h2>'}<button id="refresh-wallets" class="quiet" ${busy||!visible.some(w=>w.address)?'disabled':''}>${glyph('refresh')}${busy?'Refreshing…':'Refresh wallet data'}</button></div><div class="grid wallet-grid">${visible.map(w=>{
      const a=analysis?.wallets?.find(row=>row.wallet_id===w.id);
      return `<article class="wallet-card"><div class="row spread"><div class="row"><span class="wallet-emblem">${glyph('wallet')}</span><div><h3>${escape(w.label)}</h3><div class="address">${w.address?escape(w.address):'Model wallet'}</div></div></div><span class="badge ${w.address?'':'gray'}">${w.address?(w.crop_balance_wei==null?'Awaiting refresh':'Watched'):'Model'}</span></div><div class="wallet-metrics"><div><strong>${w.plots.length}</strong><span>plots</span></div><div><strong>${fmt(w.crop_balance_wei,0)}</strong><span>CROP</span></div><div><strong>${fmt(a?.daily_crop_wei)}</strong><span>CROP / day</span></div><div><strong>${fmt(w.eth_balance_wei,5)}</strong><span>ETH</span></div></div><div class="actions wallet-tools">${!w.address?`<button class="quiet" data-edit-wallet="${escape(w.id)}">Edit model balances</button>`:''}<button class="quiet danger" data-remove-wallet="${escape(w.id)}" ${busy?'disabled':''}>Remove wallet</button></div></article>`;
    }).join('')}</div></section>`;
  }
  function plotsTable() {
    const inventory=allPlots(state.portfolio);if(!inventory.length)return '';
    const termPlot=p=>insights?.plots?.find(r=>r.plot_id===p.token_id&&r.wallet_id===p.wallet_id);
    const search=plotSearch.trim().toLowerCase().replace(/^#/,'');
    const plots=inventory.filter(p=>(!plotWallet||p.wallet_id===plotWallet)&&(!plotStatus||(plotStatus==='planted'?p.is_active===true:plotStatus==='dormant'?p.is_active===false:p.is_active==null))&&(!search||`${p.token_id} ${walletName(state.portfolio,p.wallet_id)} ${tierPresentation(state.portfolio,p).label}`.toLowerCase().includes(search)));
    const orderValue=p=>plotSort==='weight'?BigInt(p.effective_weight_bps??-1):plotSort==='pending'?BigInt(p.pending_crop_wei??-1):plotSort==='yield'?termPlot(p)?.daily_crop_wei??-1n:BigInt(p.token_id);
    plots.sort((a,b)=>{const left=orderValue(a),right=orderValue(b);return left===right?a.token_id-b.token_id:plotSort==='id'?(left<right?-1:1):(left>right?-1:1);});
    const visible=plots.slice(0,visiblePlots),remaining=plots.length-visible.length;
    displayedPlotIds=visible.map(p=>p.token_id);
    const controls=`<div class="inventory-toolbar"><div class="artwork-tools"><label class="checkbox-row"><input id="load-plot-artwork" type="checkbox" ${state.companion.artwork_enabled?'checked':''}>Load plot artwork</label><select id="artwork-source" aria-label="Plot artwork source">${options([['production','Production'],['rehearsal','Rehearsal']],state.companion.artwork_environment)}</select></div><form class="plot-tools" id="plot-filter">${field('Find plots','plotSearch',plotSearch,'placeholder="Plot ID, rarity or wallet" maxlength="120"')}<details class="plot-filter-options"><summary>Filters & sort</summary><div class="filter-options-body">${select('Filter wallet','plotWallet',[['','All wallets'],...state.portfolio.wallets.filter(w=>w.plots.length).map(w=>[w.id,w.label])],plotWallet)}${select('Plot state','plotStatus',[['','All states'],['planted','Planted'],['dormant','Dormant'],['unknown','Unknown']],plotStatus)}${select('Sort plots','plotSort',[['id','Plot ID'],['weight','Highest weight'],['pending','Most unclaimed'],['yield','Highest day-one yield']],plotSort)}</div></details><button class="quiet">Apply filters</button>${search||plotWallet||plotStatus?'<button type="button" id="clear-plot-filter" class="quiet">Clear filters</button>':''}</form></div><div class="plot-art-status" id="plot-art-status"></div><p class="rule-note">${plots.length} of ${inventory.length} plots${insights?.status==='ok'?` · day-one yield from ${escape(dateText(insights.start_utc))}`:''}</p>`;
    const table=`<div class="table-scroll"><table><thead><tr><th>Plot</th><th>Wallet</th><th>Rarity</th><th>Level</th><th>State</th><th>Weight</th><th>Unclaimed CROP</th><th>Day-one CROP</th><th></th></tr></thead><tbody>${visible.map(p=>{
      const w=state.portfolio.wallets.find(w=>w.id===p.wallet_id);
      return `<tr><td><button class="quiet" data-open-art="${p.token_id}" aria-label="View artwork for plot #${p.token_id}">#${p.token_id} ↗</button></td><td>${escape(w.label)}</td><td>${escape(tierPresentation(state.portfolio,p).label)}</td><td>${p.level??'—'}</td><td>${p.is_active===true?'Planted':p.is_active===false?'Dormant':'Unknown'}</td><td>${p.effective_weight_bps==null?'—':(p.effective_weight_bps/10000).toFixed(2)+'×'}</td><td class="number">${fmt(p.pending_crop_wei)}</td><td class="number">${fmt(termPlot(p)?.daily_crop_wei)}</td><td>${!w.address?`<button data-edit-plot="${p.token_id}">Edit</button>`:''}${p.is_active&&p.level<5&&tierPresentation(state.portfolio,p).tier!=null?`<button class="pin-plot" data-pin-plot="${p.token_id}" aria-label="Plan plot #${p.token_id}">Plan upgrade</button>`:''}</td></tr>`;
    }).join('')}</tbody></table></div>`;
    const moreButton=remaining?`<button id="more-plots" class="show-more" type="button">Show more plots (${remaining} left)</button>`:'';
    const moreTile=remaining?`<button id="more-plots" class="show-more plot-more-tile" type="button" aria-label="Show more plots (${remaining} left)"><span class="plot-more-plus" aria-hidden="true">+</span><span>Show more</span><small>${remaining} left</small></button>`:'';
    return `<section class="plot-collection"><div class="section-heading"><div><h2>Your plots</h2></div><div class="view-switch" role="group" aria-label="Plot display"><button data-plot-view="cards" aria-pressed="${plotView==='cards'}">${glyph('plot')}Cards</button><button data-plot-view="table" aria-pressed="${plotView==='table'}">${glyph('list')}List</button></div></div>${controls}${!plots.length?'<p class="empty">No plots match these filters.</p>':plotView==='table'?`${table}${moreButton}`:`<div class="plot-grid" data-scroll="plots">${visible.map(p=>{
      const w=state.portfolio.wallets.find(w=>w.id===p.wallet_id),presentation=tierPresentation(state.portfolio,p),tier=presentation.tier,level=p.level,known=tier!=null&&level!=null;
      const asset=state.companion.artwork_enabled?artwork.get(p.token_id):null;
      const picture=asset&&!failedImages.has(asset.image_url)?asset.image_url:known?(tier===3?art.rarities[3]:art.levels[level-1]):art.hero;
      const harvest=termPlot(p);
      return `<article data-art-card="${p.token_id}" class="plot-card tier-${tier??'unknown'} ${presentation.pending?'pending-rarity':''} ${state.companion.pinned_plot_id===p.token_id?'pinned':''}"><div class="plot-picture ${p.is_active===false?'dormant':''} ${known?'':'sealed'} ${presentation.pending?'pending-rarity':''}"><img src="${picture}" alt="${asset&&!failedImages.has(asset.image_url)?(asset.environment==='rehearsal'?'Rehearsal':'Production')+' artwork for plot #'+p.token_id:known?'Example '+escape(presentation.label)+' farm artwork':'Unrevealed farm illustration'}" ${asset?'data-remote-art referrerpolicy="no-referrer"':''} loading="lazy" width="320" height="320"><span class="plot-tag">${w.address?'#'+p.token_id:'MODEL #'+p.token_id}</span><span class="plot-level">${level==null?'SEALED':'LV '+level}</span><span class="art-note">${asset&&!failedImages.has(asset.image_url)?(asset.environment==='rehearsal'?'Rehearsal':'Production')+' #'+p.token_id:artErrors.has(p.token_id)?(artErrors.get(p.token_id)==='Waiting for reveal'?'Unrevealed · example':'Art unavailable · example'):'Example art'}</span><button class="plot-art-button" data-open-art="${p.token_id}" aria-label="View artwork for plot #${p.token_id}"><span>Explore this plot ↗</span></button></div><div class="plot-content"><div class="row spread"><h3>${escape(presentation.label)}</h3><span class="tiny-status ${p.is_active?'active':''}">${p.is_active===true?'Planted':p.is_active===false?'Dormant':'Unknown'}</span></div><p class="plot-wallet">${escape(w.label)}</p><div class="level-meter" aria-label="${level==null?'Level unknown':'Level '+level+' of 5'}">${[1,2,3,4,5].map(n=>`<i class="${level>=n?'filled':''}"></i>`).join('')}</div><div class="plot-numbers"><div><strong>${p.effective_weight_bps==null?'—':(p.effective_weight_bps/10000).toFixed(2)+'×'}</strong><small>weight</small></div><div><strong>${fmt(p.pending_crop_wei,0)}</strong><small>unclaimed CROP</small></div></div>${harvest?`<div class="plot-harvest"><strong>${fmt(harvest.daily_crop_wei)}<small>${automaticMode()&&p.is_active===false?'CROP · if planted':'CROP · day one'}</small></strong><span>${fmt(harvest.earned_crop_wei,0)} over ${state.days} days</span></div>`:''}<div class="actions">${!w.address?`<button class="quiet plot-edit" data-edit-plot="${p.token_id}">Edit</button>`:''}${p.is_active&&level<5&&known?`<button class="pin-plot quiet" data-pin-plot="${p.token_id}" aria-label="Plan plot #${p.token_id}">${state.companion.pinned_plot_id===p.token_id?'★ Target':'Plan upgrade'}</button>`:''}</div></div></article>`;
    }).join('')}${moreTile}</div>`}</section>`;
  }
  function farmPage() {
    const hasPlots=allPlots(state.portfolio).length>0;
    if(!hasPlots)return `<div class="welcome-layout">${hero()}<div class="welcome-intake"><div class="workspace-heading"><div><h2>Your farm starts here</h2><p>Connect once. See what grows.</p></div></div>${onboarding()}${wallets()}</div></div>`;
    return `<div class="farm-workspace"><div class="workspace-heading"><div class="row"><img class="workspace-mascot" src="${art.keeper}" alt="" width="48" height="48"><div><h1>My farm</h1><p>${allPlots(state.portfolio).length} plots · ${state.portfolio.wallets.filter(w=>w.address||w.plots.length).length} wallets</p></div></div><div class="actions"><button data-desk="wallets" class="quiet">Wallets</button><button data-desk="add" class="quiet" aria-label="Add wallets & model plots">+ Add plots</button>${automaticMode()?(state.portfolio.wallets.some(w=>w.address)?`<button id="refresh-wallets" class="quiet" ${busy?'disabled':''}>${busy?'Refreshing…':'Refresh'}</button>`:''):`<button id="farm-forecast" class="primary">Plan my harvest ${glyph('arrow')}</button>`}</div></div>${metrics()}${plotsTable()}<div class="workspace-bottom"><span class="small muted">${state.portfolio.observed_at_utc?'Updated '+escape(dateText(state.portfolio.observed_at_utc)):'Saved on this device'}</span><button id="open-active-plan" class="quiet">Open active plan ${glyph('arrow')}</button></div></div>`;
  }

  function assumptionsForm() {
    const s=state.scenario;
    return `<section class="panel"><div class="panel-header"><div><h2>Set the season</h2></div><span class="badge">${state.days} days ahead</span></div><form id="assumptions">${forecastSourceNote()}<div class="form-grid three">${field('Start date (UTC)','start',s.start.slice(0,16),'type="datetime-local" required')}${field('Forecast days','days',state.days,'type="number" min="1" max="365" required')}${select('Weekly weather','weatherBps',rules.weather.states.map(w=>[w.multiplier_bps,`${w.name} · ${w.multiplier_bps/10000}×`]),s.weatherBps)}</div><div class="season-controls"><div class="horizon-pills" aria-label="Forecast shortcuts">${[7,30,90,365].map(n=>`<button type="button" data-days="${n}" class="${n===state.days?'active':''}">${n===7?'1 week':n===30?'1 month':n===90?'3 months':'1 year'}</button>`).join('')}</div><div class="weather-stamp">${glyph('sun')}<span id="weather-caption">${escape(rules.weather.states.find(w=>w.multiplier_bps===Number(s.weatherBps))?.name??'Weather')} scenario</span></div></div>${weatherCalendar()}<div class="forecast-planting-option"><label class="checkbox-row"><input id="assume-planted" type="checkbox" name="assumePlanted" ${state.companion.assume_planted?'checked':''}>Assume all dormant plots are planted</label><p class="rule-note">Planning assumption only. Planting capital is shown separately and excluded from gross harvest.</p></div><details id="harvest-limits" class="disclosure advanced"><summary>Harvest limits</summary><p class="rule-note">Your weight sets the rate. These assumptions check the base ceiling and Granary.</p><div class="form-grid three">${field('Additional valley weight (optional)','externalWeight',s.externalWeight??'0','type="number" min="0" max="1000000000" step="any" placeholder="0"')}${field('Yearly valley weight growth (%)','annualGrowthPct',s.annualGrowthPct??'0','type="number" min="0" max="1000" step="any" placeholder="0"')}${field('Seed carry available (CROP)','carryCrop',s.carryCrop??'0','inputmode="decimal"')}${field('Granary available (CROP)','granaryCrop',s.granaryCrop??'40000000','inputmode="decimal"')}${field('CROP sale price in ETH (optional)','sellPrice',s.sellPrice,'inputmode="decimal" placeholder="Optional"')}${field('CROP buy price in ETH (optional)','buyPrice',s.buyPrice,'inputmode="decimal" placeholder="Optional"')}</div><div class="row actions"><span class="muted small">Optional valley weight scenarios:</span><button type="button" class="quiet" data-preset="full">Full collection at level 1</button><button type="button" class="quiet" id="use-observed" ${state.portfolio.total_planted_farm_weight_bps==null?'disabled':''}>Use observed valley weight</button></div><div class="actions"><button type="button" id="use-reward-state" ${state.portfolio.carry_crop_wei==null||state.portfolio.granary_crop_wei==null||!state.portfolio.reward_observed_at_utc?'disabled':''}>Use observed reward reserves</button></div><p id="reward-state-note" class="small">${s.rewardStateBasis==='observed'?'Reserves observed '+escape(dateText(s.rewardObservedAt)):'Opening reserves are scenario inputs.'}</p></details><div class="actions"><button class="primary" ${busy?'disabled':''}>${busy?'Counting the harvest…':'Calculate forecast'} ${glyph('arrow')}</button><span class="muted small">Current plots & levels. No reinvestment.</span></div></form></section>`;
  }
  function foundingBoost() {
    const s=state.scenario,g=rules.schedule.genesis_timestamp*1000,start=Date.parse(s.start);
    const first=(s.weatherWeeks??[]).find(w=>w.epoch===0);
    if(!s.useKnownWeather||!first||start>=g+7*86400000||start+state.days*86400000<=g)return '';
    const weather=rules.weather.states.find(w=>w.multiplier_bps===first.multiplier_bps);
    return `<p class="founding-boost" title="Nominal weather × First Soil; the base ceiling and available Granary still apply.">${glyph('sun')}<strong>×${(first.multiplier_bps*2/10000).toFixed(2)}</strong><span>Founding week · Sep 21–28<small>${escape(weather?.name??'Weather')} ×${first.multiplier_bps/10000} · First Soil ×2 · Granary-limited</small></span></p>`;
  }
  function weatherCalendar() {
    const s=state.scenario,weeks=s.weatherWeeks??[],announced=weeks.filter(w=>w.epoch<12&&w.announced!==false).length,g=rules.schedule.genesis_timestamp*1000;
    return `<div class="known-weather"><label class="checkbox-row"><input type="checkbox" name="useKnownWeather" ${s.useKnownWeather?'checked':''}>Use known weeks</label><p class="rule-note">Weekly weather fills the unrevealed weeks.</p><details class="weather-calendar"><summary>12 launch weeks · ${announced} announced</summary><div class="weather-week-grid">${Array.from({length:12},(_,epoch)=>{const row=weeks.find(w=>w.epoch===epoch),name=rules.weather.states.find(w=>w.multiplier_bps===row?.multiplier_bps)?.name;return `<div class="${row?'known':'sealed'}"><b>Week ${epoch+1}</b><span>${new Date(g+epoch*7*86400000).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}</span><strong>${name??'Unrevealed'}</strong></div>`;}).join('')}</div><p class="rule-note">${s.weatherBasis==='chain'?'Chain read':s.weatherBasis==='cached'?'Saved chain check':'Scenario weeks'}${s.weatherObservedAt?' · '+escape(dateText(s.weatherObservedAt)):''}. A commitment hides future outcomes; early scheduled values may change through their 24-hour cutoff.</p><p class="rule-note">First Soil: ×2 through Sep 28, then ×1.5 through Oct 19, 00:00 UTC. Bonus rewards use the available Granary.</p></details></div>`;
  }
  function outcomeErrors() {
    if(!analysis)return '';
    if(analysis.status==='ok')return '';
    const messages=distinctMessages(analysis.errors);
    if(!messages.length)return '<div class="notice error" role="alert"><strong>Complete these inputs to calculate.</strong></div>';
    const [first,...rest]=messages;
    return `<div class="notice error" role="alert"><strong>${escape(first)}</strong>${rest.length?`<details class="error-details"><summary>Show ${rest.length} more detail${rest.length===1?'':'s'}</summary><ul>${rest.map(e=>`<li>${escape(e)}</li>`).join('')}</ul></details>`:''}</div>`;
  }
  function forecastOutput() {
    if(!analysis||analysis.status!=='ok')return outcomeErrors()||`<div class="empty illustrated-empty"><img src="${art.keeper}" alt="The Keeper" width="100" height="100"><div><h3>Your next harvest</h3><p>Choose your settings, then calculate.</p></div></div>`;
    const selected=analysis.horizons.find(row=>row.days===state.days)??analysis.horizons.at(-1);
    return `<section class="panel harvest-panel"><div class="forecast-top"><div><div class="eyebrow">Your ${state.days}-day harvest</div><h2>Harvest without reinvesting</h2>${harvestRateBlock(analysis.harvest_rate,analysis.harvest_limits,state.days)}${foundingBoost()}<div class="forecast-value"><img src="${art.corn}" alt="" width="42" height="42">${fmt(selected?.earned_crop_wei,0)}<span>CROP</span></div><p class="muted">From ${escape(dateText(analysis.start_utc))}</p><p class="muted">${selected?.estimated_value_eth_wei!=null?`≈ ${fmt(selected.estimated_value_eth_wei,6)} ETH · scenario value, before costs`:'Add a sale-price assumption to estimate token value in ETH.'}</p></div>${chart(analysis.horizons)}</div><div class="harvest-terms">${analysis.horizons.filter(r=>[7,30,90,365].includes(r.days)).map(r=>`<div><span>${r.days} DAYS</span><strong title="${fmt(r.earned_crop_wei)} CROP">${compactCrop(r.earned_crop_wei)}</strong><small>CROP</small></div>`).join('')}</div><details class="disclosure harvest-ledger"><summary>Harvest ledger</summary><div class="table-scroll"><table><thead><tr><th>Forecast term</th><th>New CROP earned</th><th>Ending CROP + pending</th><th>New rewards’ value in ETH</th></tr></thead><tbody>${analysis.horizons.map(row=>`<tr ${row.days===state.days?'class="best"':''}><td>${row.days} days</td><td class="number">${fmt(row.earned_crop_wei)}</td><td class="number">${fmt(row.ending_crop_wei)}</td><td class="number">${fmt(row.estimated_value_eth_wei,6)}</td></tr>`).join('')}</tbody></table></div></details><div class="actions"><button id="export-csv">Export forecast CSV</button><button id="forecast-upgrades" class="primary">Find my best upgrade ${glyph('arrow')}</button></div></section>`;
  }
  function plantingComparison() {
    if(!analysis?.planting_options||!allPlots(state.portfolio).some(p=>!p.is_active))return '';
    const p=analysis.planting_options,bagOpen=p.seed_bag_open??state.portfolio.seed_bag_open;
    const dormant=allPlots(state.portfolio).filter(plot=>!plot.is_active);
    const eligibility=(key)=>dormant.filter(plot=>plot[key]===true).length;
    const unknown=dormant.some(plot=>plot.seed_bag_available==null||plot.sprouts_available==null);
    return `<section class="panel"><div class="panel-header"><div class="row"><img class="merchant" src="${art.mabel}" alt="Mabel" width="72" height="72"><div><div class="eyebrow">Mabel’s planting bench</div><h2>Choose your planting payment</h2></div></div></div><div class="grid"><div class="wallet-card"><h3>${crop(p.crop_cost_wei,0)}</h3><p class="muted">Any dormant plot · ${p.quoted_crop_purchase_eth_wei==null?'CROP price unavailable':`${fmt(p.quoted_crop_purchase_eth_wei,8)} ETH at your buy quote`}</p></div><div class="wallet-card"><h3>Seed bag · 0.001 ETH</h3><p class="muted">First planting only · ${eligibility('seed_bag_available')} eligible${unknown?' · refresh to verify all plots':''}</p><p class="muted">${bagOpen===false?'Bags closed':state.portfolio.seed_bags_left!=null?`${state.portfolio.seed_bags_left} funded bags left at last read`:'Funded stock needs a fresh read'}</p></div><div class="wallet-card"><h3>Sprouts · ${p.sprout_eth_wei==null?'quote needed':`${fmt(p.sprout_eth_wei,8)} ETH`}</h3><p class="muted">Replanting only · ${eligibility('sprouts_available')} eligible</p><a href="https://rh.farm/farm/" target="_blank" rel="noopener noreferrer">My plots ↗</a></div></div><p class="rule-note">Quotes exclude gas. Sprouts can reprice; each transaction gets a fresh review.</p></section>`;
  }
  function automaticTerms() {
    return `<div class="horizon-pills" aria-label="Forecast shortcuts">${[7,30,90,365].map(n=>`<button type="button" data-days="${n}" aria-pressed="${n===state.days}" class="${n===state.days?'active':''}" ${busy?'disabled':''}>${n===7?'1 week':n===30?'1 month':n===90?'3 months':'1 year'}</button>`).join('')}</div>`;
  }
  function automaticDetails() {
    const preset=forecastPreset??automaticForecast(state.portfolio);
    return `<details class="disclosure automatic-details"><summary>Estimate details</summary><p>Starts ${escape(dateText(state.scenario.start))}. Known weather, then Fair. Current levels; dormant plots assumed planted.</p><p>Your plot weight sets nominal CROP. The 30% participation estimate only checks shared funding limits; it does not reduce your nominal yield. Actual planted weight replaces it after Genesis when verified.</p><ul>${Object.values(preset.sources).map(value=>`<li>${escape(value)}</li>`).join('')}</ul><p>Planting capital and network fees are separate from gross harvest. Prices are estimates, not trade quotes.</p><button id="customize-forecast" class="quiet">Custom scenario</button></details>`;
  }
  function automaticForecastPage() {
    const ready=analysis?.status==='ok',rate=analysis?.harvest_rate;
    const selected=analysis?.horizons?.find(row=>row.days===state.days);
    if(!allPlots(state.portfolio).length)return `<div class="empty"><h2>Add your farm to see its harvest</h2><button data-desk="add" class="primary">Connect or add a wallet</button></div>${automaticDetails()}`;
    return `<div class="automatic-workspace"><div class="workspace-heading"><div><h1>Your harvest</h1><p>At current levels · ${state.companion.assume_planted?'after planting':'your planted plots'}</p></div>${automaticTerms()}</div>${ready?`<section class="panel automatic-harvest"><div class="automatic-harvest-main"><div><div class="eyebrow">${state.days}-day estimate</div><div class="forecast-value"><img src="${art.corn}" alt="" width="42" height="42">${fmt(selected?.earned_crop_wei,0)}<span>CROP</span></div><p>From ${escape(new Date(analysis.start_utc).toLocaleDateString('en-CA',{month:'short',day:'numeric',timeZone:'UTC'}))} · before reinvesting</p>${selected?.estimated_value_eth_wei!=null?`<p class="small muted">≈ ${fmt(selected.estimated_value_eth_wei,6)} ETH at estimated price · before costs</p>`:''}</div>${chart(analysis.horizons)}</div><div class="harvest-terms">${analysis.horizons.filter(r=>[7,30,90,365].includes(r.days)).map(r=>`<div><span>${r.days} DAYS</span><strong title="${fmt(r.earned_crop_wei)} CROP">${compactCrop(r.earned_crop_wei)}</strong><small>CROP</small></div>`).join('')}</div><div class="automatic-rate"><span>Your opening rate</span><strong>${fmt(rate?.nominal_daily_crop_wei)} CROP / day</strong><small>Before funding limits · weather and First Soil included</small></div>${harvestLimitsNotice(analysis.harvest_limits,state.days)}${forecastBasisNote()}<details class="disclosure harvest-ledger"><summary>Harvest ledger</summary><div class="table-scroll"><table><thead><tr><th>Days</th><th>New CROP earned</th><th>Ending CROP + pending</th><th>Estimated ETH</th></tr></thead><tbody>${analysis.horizons.map(r=>`<tr><td>${r.days}</td><td>${fmt(r.earned_crop_wei)}</td><td>${fmt(r.ending_crop_wei)}</td><td>${fmt(r.estimated_value_eth_wei,6)}</td></tr>`).join('')}</tbody></table></div><button id="export-csv" class="quiet">Export forecast CSV</button></details></section>`:outcomeErrors()||'<div class="empty" role="status">Preparing your harvest…</div>'}${automaticDetails()}${ready?`<details class="disclosure extra-calculators"><summary>More calculators</summary><div class="view-switch" role="group" aria-label="Forecast view">${[['harvest','Harvest'],['weather','Weather lab'],['goal','CROP goal'],['planting','Planting']].map(([id,label])=>`<button data-forecast-view="${id}" aria-pressed="${forecastView===id}">${label}</button>`).join('')}</div>${forecastView==='weather'?weatherLab():forecastView==='goal'?goalBoard():forecastView==='planting'?plantingComparison():''}</details>`:''}</div>`;
  }
  function automaticUpgradePage() {
    const routes=upgradeView==='routes';
    const rows=[...((routes?analysis.upgrade_paths:analysis.upgrades)??[])].sort((a,b)=>{
      const left=a.funded_net_crop_wei??-(2n**256n),right=b.funded_net_crop_wei??-(2n**256n);
      return left>right?-1:left<right?1:(a.ready_in_days??Infinity)-(b.ready_in_days??Infinity)||a.plot_id-b.plot_id;
    });
    const chosen=rows.find(row=>!row.requires_planting&&row.funded_net_crop_wei!=null&&row.funded_net_crop_wei>0n&&row.ready_in_days!=null)??null;
    const shortlist=rows.slice(0,8);
    const table=items=>`<div class="table-scroll"><table><thead><tr><th>Plot / wallet</th><th>Upgrade</th><th>Cost CROP</th><th>Ready in</th><th>Extra harvest</th></tr></thead><tbody>${items.map(r=>`<tr ${chosen?.plot_id===r.plot_id&&chosen?.to_level===r.to_level?'class="best"':''}><td><strong>#${r.plot_id}</strong><small>${escape(walletName(state.portfolio,r.wallet_id))} · ${escape(rarityLabelForUpgrade(r))}</small></td><td>${r.steps?.length>1?[r.from_level,...r.steps.map(step=>step.to_level)].join(' → '):`${r.from_level} → ${r.to_level}`}</td><td>${fmt(r.cost_crop_wei,0)}</td><td>${escape(dayText(r.ready_in_days))}${r.claim_required?'<small>Claim needed</small>':''}</td><td>${fmt(r.funded_net_crop_wei)}<small>CROP net of upgrade burns</small></td></tr>`).join('')}</tbody></table></div>`;
    return `<div class="automatic-workspace"><div class="workspace-heading"><div><h1>Your upgrade path</h1><p>${state.days} days · each wallet funds its own upgrades</p></div>${automaticTerms()}</div><div class="automatic-upgrades"><section class="next-move"><div class="next-art"><img src="${chosen?art.levels[chosen.to_level-1]:art.keeper}" alt="Example upgraded farm" width="240" height="240"><span>EXAMPLE ART</span></div><div class="next-copy"><div class="eyebrow">${chosen?'Best estimated move':'Keep harvesting'}</div><h2>${chosen?`Plot #${chosen.plot_id} → level ${chosen.to_level}`:'Wait for a better return'}</h2>${chosen?`<p>${escape(walletName(state.portfolio,chosen.wallet_id))}</p><div class="move-stats"><div><strong>${fmt(chosen.cost_crop_wei,0)}</strong><small>CROP to upgrade</small></div><div><strong>${escape(dayText(chosen.ready_in_days))}</strong><small>from forecast start</small></div><div><strong>${fmt(chosen.funded_net_crop_wei)}</strong><small>extra CROP after waiting & burns</small></div></div>${routeFunding(chosen)}`:'<p>No upgrade repays its CROP cost within this term.</p>'}<button id="open-guided-routes" class="primary">Build active plan ${glyph('arrow')}</button></div></section><section class="panel automatic-upgrade-list"><div class="panel-header"><h2>Compare upgrades</h2><div class="view-switch" role="group" aria-label="Upgrade comparison"><button data-upgrade-view="next" aria-pressed="${!routes}">Next level</button><button data-upgrade-view="routes" aria-pressed="${routes}">Full paths</button></div></div>${shortlist.length?table(shortlist):'<p>All plots are at the highest level.</p>'}${rows.length>8?`<details class="disclosure"><summary>All ${rows.length} options</summary>${table(rows)}</details>`:''}<p class="rule-note">Ranked by extra CROP after waiting and upgrade burns, before gas and planting capital. Each row is a separate alternative.</p><details class="disclosure"><summary>Upgrade details</summary><p>Paths wait to fund every step together. Active plans can upgrade in stages and revisit the same plot.</p><button id="export-upgrades" class="quiet">Export upgrade CSV</button>${levelTrail(chosen?.to_level??1)}</details></section></div>${forecastBasisNote()}${automaticDetails()}</div>`;
  }

  function forecastPage() {
    if(automaticMode())return automaticForecastPage();
    const ready=analysis?.status==='ok';
    const modes=[['harvest','Harvest'],['weather','Weather lab'],['goal','CROP goal'],...(allPlots(state.portfolio).some(p=>!p.is_active)?[['planting','Planting']]:[])];
    if(!modes.some(([id])=>id===forecastView))forecastView='harvest';
    return `<div class="forecast-workspace"><aside class="forecast-config" data-collapsed="${forecastConfigCollapsed}"><button type="button" id="toggle-forecast-config" class="forecast-config-toggle" aria-expanded="${!forecastConfigCollapsed}">${forecastConfigCollapsed?'Edit forecast':'Forecast settings'} <span>${state.days} days · ${state.scenario.useKnownWeather?'Known weeks':escape(rules.weather.states.find(w=>w.multiplier_bps===Number(state.scenario.weatherBps))?.name??'Weather')}</span></button><button id="automatic-forecast" class="quiet automatic-reset">Use automatic estimates</button>${assumptionsForm()}</aside><div class="forecast-results"><div class="view-switch workspace-modes" role="group" aria-label="Forecast view">${modes.map(([id,label])=>`<button data-forecast-view="${id}" aria-pressed="${forecastView===id}" ${!ready&&id!=='harvest'?'disabled':''}>${label}</button>`).join('')}</div><div class="result-content">${forecastBasisNote()}${forecastView==='weather'?weatherLab():forecastView==='goal'?goalBoard():forecastView==='planting'?plantingComparison():forecastOutput()}${modelNotes()}</div></div></div>`;
  }

  function upgradePage() {
    if(plannerMode==='active')return activePlanView({portfolio:state.portfolio,settings:state.activePlan,runtime:controller?.snapshot(),actionState:actionState(),settingsCollapsed:planSettingsCollapsed,simple:automaticMode()});
    if(!analysis||analysis.status!=='ok')return `<div class="upgrade-empty">${automaticMode()?'':targetPicker()}<section class="keeper-note"><img src="${art.keeper}" alt="The Keeper" width="90" height="90"><div><h2>Make your next upgrade count.</h2><p>${automaticMode()&&allPlots(state.portfolio).length?'Preparing your upgrade paths…':'Calculate a forecast to compare upgrades.'}</p><button id="planner-forecast" class="primary">${allPlots(state.portfolio).length?'Calculate my farm':'Add a farm first'} ${glyph('arrow')}</button></div></section>${outcomeErrors()}</div>`;
    if(automaticMode())return automaticUpgradePage();
    const routes=upgradeView==='routes',rows=(routes?analysis.upgrade_paths:analysis.upgrades)??[],best=routes?analysis.best_upgrade_path:analysis.best_upgrade,fundable=routes?analysis.next_fundable_path:analysis.next_fundable_upgrade,chosen=fundable??best;
    const wallet=chosen?analysis.wallets.find(w=>w.wallet_id===chosen.wallet_id):null;
    const available=wallet?(wallet.liquid_crop_wei+wallet.pending_crop_wei):0n,progress=chosen?Number((available>chosen.cost_crop_wei?chosen.cost_crop_wei:available)*100n/chosen.cost_crop_wei):0;
    return `<div class="upgrade-workspace"><aside class="upgrade-sidebar">${targetPicker()}<section class="next-move"><div class="next-art"><img src="${chosen?art.levels[chosen.to_level-1]:art.keeper}" alt="${chosen?'Next level example farm':'The Keeper'}" width="240" height="240">${chosen?'<span>EXAMPLE ART</span>':''}</div><div class="next-copy"><div class="eyebrow">Your next move / ${state.days} days</div><h2>${chosen?`Plot #${chosen.plot_id} → level ${chosen.to_level}`:'Keep the harvest coming.'}</h2><p>${chosen?`${escape(walletName(state.portfolio,chosen.wallet_id))} · ${rules.levels.entries[chosen.from_level-1].name} → ${rules.levels.entries[chosen.to_level-1].name}`:'No upgrade repays its CROP cost in this term.'}</p>${chosen?`<div class="move-stats"><div><strong>+${fmt(chosen.daily_gain_crop_wei)}</strong><small>extra CROP · first day</small></div><div><strong>${fmt(chosen.cost_crop_wei,0)}</strong><small>CROP · ${chosen.steps?.length??1} upgrade${(chosen.steps?.length??1)>1?'s':''}</small></div><div><strong>${escape(dayText(chosen.ready_in_days))}</strong><small>to fund · from forecast start</small></div></div><div class="funding-caption"><span>Wallet funding${chosen.claim_required?' · claim needed':''}</span><strong>${progress}%</strong></div><div class="funding-bar" role="progressbar" aria-label="Next upgrade funding" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div><p class="rule-note">${fundable?`${crop(fundable.funded_net_crop_wei)} extra after the funding wait`:'Best immediate-upgrade return; check funding and term'} · before network costs.</p>${routes?routeFunding(chosen):''}`:''}</div></section><details class="disclosure"><summary>Levels & costs</summary>${levelTrail(chosen?.to_level??1)}</details>${state.companion.pinned_plot_id?goalBoard():''}</aside><div class="upgrade-results">${forecastBasisNote()}<section class="panel"><div class="panel-header"><div><h2>Upgrade cost & waiting time</h2><p>Wallet funding from ${escape(dateText(analysis.start_utc))} · ${routes?'ranked by term net CROP':'ranked by return per CROP burned'}.</p></div><button id="planner-recalculate" ${busy?'disabled':''}>${glyph('refresh')}Recalculate</button></div><div class="view-switch upgrade-comparison" role="group" aria-label="Upgrade comparison"><button data-upgrade-view="routes" aria-pressed="${routes}">All upgrade routes</button><button data-upgrade-view="next" aria-pressed="${!routes}">Next level only</button></div>${rows.length?`<div class="table-scroll"><table><thead><tr><th>Priority / plot</th><th>${routes?'Route':'Next level'}</th><th>Cost CROP</th><th>Extra CROP/day</th><th>Time to afford</th><th>CROP payback</th><th>Net if funded now</th><th>Net after waiting</th></tr></thead><tbody>${rows.map((r,i)=>`<tr ${chosen?.plot_id===r.plot_id&&chosen?.to_level===r.to_level?'class="best"':''}><td><strong>${i+1}. Plot #${r.plot_id}</strong><small>${escape(walletName(state.portfolio,r.wallet_id))}</small></td><td>${r.steps?.length>1?[r.from_level,...r.steps.map(step=>step.to_level)].join(' → '):`${r.from_level} → ${r.to_level}`}<small>${escape(rarityLabelForUpgrade(r))}</small></td><td class="number">${fmt(r.cost_crop_wei,0)}</td><td class="number">+${fmt(r.daily_gain_crop_wei)}</td><td>${r.requires_planting?'Plant first':escape(dayText(r.ready_in_days))}<small>${r.claim_required?'Claim needed':r.liquid_shortfall_crop_wei>0n?`${fmt(r.liquid_shortfall_crop_wei,0)} CROP short`:'Funded'}</small></td><td>${escape(dayText(r.break_even_days))}<small>Before network costs</small></td><td class="number">${fmt(r.net_crop_wei)}</td><td class="number">${fmt(r.funded_net_crop_wei)}</td></tr>`).join('')}</tbody></table></div>`:'<p>Every plot has reached the end of its upgrade trail.</p>'}<div class="actions"><button id="open-guided-routes" class="primary">Build active plan ${glyph('arrow')}</button><button id="export-upgrades">Export upgrade CSV</button><button id="planner-assumptions">Edit assumptions</button></div></section>${modelNotes()}</div></div>`;
  }
  function routeFunding(route) {
    const short=route.buy_shortfall_after_claim_crop_wei;
    if(short==null||short<=0n)return '';
    return `<details class="route-purchase disclosure"><summary>Buy CROP to upgrade sooner</summary><p>${crop(short,0)} short after claiming. ${route.quoted_buy_capital_eth_wei==null?'Enter a CROP buy price in forecast assumptions.':`≈ ${fmt(route.quoted_buy_capital_eth_wei,8)} ETH at your scenario price.`}</p><p class="rule-note">Purchase principal only; fees and wallet ETH still apply. Set a purchase cap in Active plan to compare buying with waiting.</p></details>`;
  }
  function modelNotes() {
    return `<details class="disclosure"><summary>Calculation notes</summary><ul><li>Harvest forecasts keep current plot levels. Known weather uses dated weeks; unrevealed weeks, valley capacity and prices follow your assumptions.</li><li>Rows are separate alternatives against keeping your current levels. Routes sum every upgrade burn; their funding estimate waits to afford the entire route. Active plans can upgrade in stages and revisit the same plot. Pending CROP needs a claim.</li><li>Payback and funding use whole-day estimates. Token values exclude fees, capital costs and NFT resale.</li><li>First Soil, annual release ceilings, seed carry and finite Granary are included. Contract rounding can differ.</li></ul></details>`;
  }
  function about() {
    return `<section class="panel saved-farms"><h2>Field notes & saved farms</h2><div class="actions"><button id="export-workspace">Export farm JSON</button><button id="import-workspace">Import farm JSON</button><button id="reset-workspace" class="quiet danger">Reset this browser’s farm</button><input type="file" id="import-file" accept="application/json,.json" hidden></div><p class="small muted">Saved in this browser. Exports include wallet addresses and balances.</p>${!compact?'<div class="install-links"><h3>Take it to the game</h3><div class="actions"><a class="button-link" href="./farm-companion-chrome.zip" download>Get Chrome extension</a><a class="button-link" href="./yield-farm-companion.user.js">Tampermonkey script</a><a href="./INSTALL-CHROME.txt" target="_blank" rel="noopener">Install guide</a></div></div>':''}<details class="disclosure"><summary>Rules & source notes · Sep 26, 2026</summary><p><a href="https://rh.farm/almanac/" target="_blank" rel="noopener noreferrer">The Farmer’s Almanac ↗</a> is the gameplay reference. Plant: 2,500 CROP, a first-use 0.001 ETH seed bag, or an ETH sprouts quote for replanting. Upgrade burns: 5k / 10k / 20k / 50k. Transfers clear planting.</p><p>Planting V3 and its previous registry are runtime-checked. Tiers are finalized at the latest review. Weather now has a seal owner; unknown future weeks remain assumptions. Sprouts reprice; seed bags are fixed.</p></details><p class="small muted">Fan-made · artwork by <a href="https://rh.farm/" target="_blank" rel="noopener noreferrer">Yield Farm</a>.</p></section>`;
  }

  function levelTrail(selected=1) {
    return `<section class="level-trail"><div class="section-heading"><div><div class="eyebrow">From seedlings to windmills</div><h2>The upgrade trail</h2></div><span class="small muted">Example plot · five levels</span></div><div class="level-cards">${rules.levels.entries.map((l,i)=>`<div class="level-card ${l.level===selected?'selected':''}"><div class="level-card-image"><img src="${art.levels[i]}" alt="${escape(l.name)} example farm" loading="lazy" width="160" height="160"><span>LV ${l.level}</span></div><div class="level-card-info"><h3>${escape(l.name)}</h3><strong>×${l.multiplier_bps/10000}</strong><small>${l.level===1?'Plant to begin':Number(l.incremental_upgrade_cost_crop).toLocaleString()+' CROP'}</small></div></div>`).join('')}</div></section>`;
  }
  function hero() {
    const chosen=state.companion.scene==='plot'?state.companion.theme_plot:null;
    const selectedScene=chosen?{name:`${chosen.environment==='rehearsal'?'Rehearsal':'Production'} plot #${chosen.token_id}`,image:failedImages.has(chosen.image_url)?art.hero:chosen.image_url}:seasonLooks.find(s=>s.id===state.companion.scene),heroScene=selectedScene?.image??companionHero;
    const picture=`<img src="${heroScene}" ${chosen?'data-remote-art referrerpolicy="no-referrer"':''} alt="${chosen&&!failedImages.has(chosen.image_url)?(chosen.environment==='rehearsal'?'Rehearsal':'Production')+' plot #'+chosen.token_id:selectedScene?escape(selectedScene.name)+' example scenery':'The Keeper planning a harvest at a cozy farm desk'}" width="960" height="600">`;
    if(desk==='themes')return `<div class="theme-preview">${picture}<span>${chosen?(chosen.environment==='rehearsal'?'Rehearsal':'Production')+' #'+chosen.token_id:selectedScene?.name??'Field journal'}</span></div>`;
    return `<section class="hero"><div class="hero-art">${picture}</div><div class="hero-copy"><span class="eyebrow">Your Yield Farm sidekick</span><h1>Your farm.<br><em>Your game plan.</em></h1><p>Grow a farm. Plan your next move.</p>${!compact?'<a class="button-link" href="./farm-companion-chrome.zip" download>Get Chrome extension ↗</a>':''}</div></section>`;
  }
  function utilityPage() {
    const titles={themes:'Make it your farm',valley:'Around the valley',files:'Saved farms & tools',wallets:'Your wallets',add:'Grow your farm',actions:'Wallet actions'};
    return `<div class="tool-page"><div class="workspace-heading"><h1>${titles[desk]??'Farm tools'}</h1><button id="back-workspace" class="quiet">Back to ${tab==='farm'?'farm':tab==='forecast'?'forecast':'planner'}</button></div>${desk==='themes'?`<div class="theme-workspace">${hero()}<section class="panel">${scenePicker()}</section></div>`:desk==='valley'?`${orchardBoard()}${collectionBoard()}${valleyBoard()}`:desk==='files'?about():desk==='wallets'?`${wallets()}<div class="actions"><button data-desk="add" class="primary">Add wallets & model plots</button></div>`:desk==='add'?onboarding():''}</div>`;
  }

  function globalErrorNotice() {
    const renderError=(message,details,observedAt,showPrevious=false)=>{
      if(!message)return '';
      const uniqueDetails=distinctMessages(details).filter(detail=>detail!==message);
      const previous=!showPrevious?'':observedAt&&Number.isFinite(Date.parse(observedAt))
        ? `<p class="small">Previous wallet snapshot kept · last observed ${escape(dateText(observedAt))}.</p>`
        : '<p class="small">Previous wallet snapshot kept.</p>';
      return `<div class="notice error" role="alert">${escape(message)}${uniqueDetails.length?`<details class="error-details"><summary>Show ${uniqueDetails.length} more detail${uniqueDetails.length===1?'':'s'}</summary><ul>${uniqueDetails.map(detail=>`<li>${escape(detail)}</li>`).join('')}</ul></details>`:''}${previous}</div>`;
    };
    const notices=[];
    if(error){
      const isRefreshError=Boolean(refreshWarning&&error===refreshWarning.message);
      notices.push(renderError(error,errorDetails,isRefreshError?refreshWarning.observedAt:null,isRefreshError));
    }
    if(refreshWarning&&(!error||error!==refreshWarning.message))notices.push(renderError(refreshWarning.message,refreshWarning.details,refreshWarning.observedAt,true));
    return notices.join('');
  }

  function render() {
    if(destroyed)return;
    const oldPage=view.dataset.page,pageKey=desk??tab+':'+plannerMode;
    for(const form of view.querySelectorAll('form[data-dirty]'))formDrafts.set(form.id,{id:form.id,observed:form.dataset.observed,values:[...form.elements].filter(el=>el.name).map(el=>({name:el.name,value:el.value,checked:el.checked}))});
    const focused=root.activeElement,focusKey=focused?.closest('form')?.id&&focused.name?{form:focused.closest('form').id,name:focused.name,start:focused.selectionStart,end:focused.selectionEnd}:null;
    const detailKey=el=>el.id||el.querySelector(':scope > summary')?.textContent;
    const keepToolsOpen=oldPage===pageKey&&view.querySelector('#tools-menu')?.open;
    for(const el of view.querySelectorAll('details:not(#tools-menu)'))openDetails.set(oldPage+':'+detailKey(el),el.open);
    for(const el of view.querySelectorAll('[data-scroll]'))scrollPositions.set(oldPage+':'+el.dataset.scroll,el.scrollTop);
    view.dataset.page=pageKey;
    host.dataset.mode=state.simulationMode;
    host.dataset.theme=state.companion.scene==='plot'?themeForPlot(state.companion.theme_plot):themeForScene(state.companion.scene);
    const hasAction=actionState().hasPending||pending(),utilities=[['themes','Themes'],['valley','Valley'],['files','Saved farms'],['actions',hasAction?'Actions · pending':'Actions']];
    view.innerHTML=`<header class="topbar"><a class="brand" href="#" id="brand-home"><img src="${art.corn}" alt="" width="30" height="30"><span>FARM<br>COMPANION</span></a><span class="fan-tag">YIELD FARM SIDEKICK</span><div class="app-tools" role="group" aria-label="Companion tools"><details class="tools-menu" id="tools-menu"><summary>Tools</summary><div>${utilities.filter(([id])=>id!=='actions').map(([id,label])=>`<button class="quiet" id="tool-${id}" data-desk="${id}" aria-pressed="${desk===id}">${label}</button>`).join('')}</div></details><button class="quiet ${hasAction?'has-pending':''}" id="tool-actions" data-desk="actions" aria-pressed="${desk==='actions'}" aria-label="Farm actions · connect & approve">${hasAction?'Actions · pending':'Actions'}</button><a class="game-link" href="https://rh.farm/" target="_blank" rel="noopener noreferrer">Play ${glyph('arrow')}</a></div></header><nav class="tabs" aria-label="Farm tools" role="tablist">${[['farm','plot','My farm'],['forecast','sun','Yield forecast'],['upgrades','upgrade','Upgrade planner']].map(([id,kind,label])=>`<button role="tab" id="tab-${id}" aria-selected="${!desk&&tab===id}" data-tab="${id}" aria-label="${label}">${glyph(kind)}${label}</button>`).join('')}</nav><div class="app-alerts">${globalErrorNotice()}${notice?`<div class="notice good" role="status">${escape(notice)}</div>`:''}${state.portfolio.rule_conflicts?.length?`<details class="notice error" open><summary>Farm data needs a check</summary><ul>${state.portfolio.rule_conflicts.map(escape).map(e=>`<li>${e}</li>`).join('')}</ul></details>`:''}</div><main class="workspace" data-scroll="workspace" ${desk?'role="region" aria-label="'+desk+' tools"':'role="tabpanel" aria-labelledby="tab-'+tab+'"'} ${desk==='actions'?'hidden':''}>${desk?utilityPage():`${tab==='upgrades'?`<div class="view-switch active-plan-switch" role="group" aria-label="Planner mode"><button data-planner-mode="ranking" aria-pressed="${plannerMode==='ranking'}">Upgrade ranking</button><button data-planner-mode="active" aria-pressed="${plannerMode==='active'}">Active plan</button></div>`:''}${tab==='farm'?farmPage():tab==='forecast'?forecastPage():upgradePage()}`}</main>`;
    root.querySelector('#action-workspace').hidden=desk!=='actions';
    bind();
    for(const draft of formDrafts.values()){const form=view.querySelector(`#${draft.id}`);if(form){form.dataset.dirty='true';if(form.id==='active-plan-settings')planDirty=true;if(draft.observed)form.dataset.observed=draft.observed;for(const entry of draft.values){const el=form.elements.namedItem(entry.name);if(el){el.value=entry.value;el.checked=entry.checked;}}}}
    for(const el of view.querySelectorAll('details:not(#tools-menu)')){const key=pageKey+':'+detailKey(el);if(openDetails.has(key))el.open=openDetails.get(key);}
    view.querySelector('#tools-menu').open=Boolean(keepToolsOpen);
    for(const el of view.querySelectorAll('[data-scroll]'))el.scrollTop=scrollPositions.get(pageKey+':'+el.dataset.scroll)??0;
    if(focusKey&&oldPage===pageKey){const el=view.querySelector(`#${focusKey.form}`)?.elements.namedItem(focusKey.name);if(el){el.focus({preventScroll:true});if(focusKey.start!=null)el.setSelectionRange?.(focusKey.start,focusKey.end);}}
    renderModal();
    // Navigation must not rebuild the persistent transaction/recovery form.
    if(widget&&!widget.getActionState?.().busy){
      const inputs=json({portfolio:state.portfolio,pendingExecution:state.pendingExecution});
      if(inputs!==lastApprovalInputs){lastApprovalInputs=inputs;widget.refresh?.();}
    }
    hydratePlotArtwork();
    scheduleAutomaticEstimate();
    if(!collectionRequested&&collectionVisible())queueMicrotask(()=>{if(!destroyed&&!collectionBusy)void refreshCollection();});
    if(!automaticMode()&&!desk&&tab==='forecast'&&!forecastRequested&&!forecastLocked()){forecastRequested=true;queueMicrotask(()=>{if(!destroyed)void refreshForecastDefaults();});}
  }

  function bind() {
    const on=(selector,type,fn)=>view.querySelector(selector)?.addEventListener(type,showError(fn));
    view.querySelectorAll('form').forEach(form=>{
      form.addEventListener('input',()=>{form.dataset.dirty='true';if(form.id==='active-plan-settings')planDirty=true;});
      form.addEventListener('change',()=>{form.dataset.dirty='true';if(form.id==='active-plan-settings')planDirty=true;});
      form.addEventListener('submit',()=>{delete form.dataset.dirty;formDrafts.delete(form.id);});
    });
    const forecastForm=view.querySelector('#assumptions');
    for(const type of ['input','change'])forecastForm?.addEventListener(type,event=>{if(FORECAST_FIELDS.includes(event.target.name))forecastEditing.add(event.target.name);});
    on('#assume-planted','change',event=>{event.target.form?.requestSubmit?.();});
    on('#customize-forecast','click',()=>{ensurePlanMutable();state.simulationMode='custom';forecastRequested=true;tab='forecast';desk=null;forecastConfigCollapsed=false;save(false);render();});
    on('#automatic-forecast','click',()=>{ensurePlanMutable();state.simulationMode='automatic';state.forecastManual=[];forecastEditing.clear();formDrafts.delete('assumptions');save();render();});
    on('#use-chain-defaults','click',()=>refreshForecastDefaults({reset:true}));
    on('#refresh-collection','click',refreshCollection);
    on('#artwork-source','change',event=>{state.companion.artwork_environment=event.target.value;artGeneration++;artwork.clear();artErrors.clear();artLoading.clear();failedImages.clear();save(false);render();});
    view.querySelectorAll('[data-desk]').forEach(el=>el.addEventListener('click',()=>{desk=desk===el.dataset.desk?null:el.dataset.desk;if(desk==='actions'){openActions();return;}render();view.querySelector('main h1,main h2')?.setAttribute('tabindex','-1');view.querySelector('main h1,main h2')?.focus({preventScroll:true});}));
    view.querySelector('#tools-menu')?.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();event.currentTarget.open=false;event.currentTarget.querySelector('summary').focus();}});
    on('#back-workspace','click',()=>{desk=null;render();view.querySelector('#tab-'+tab)?.focus();});
    on('#toggle-forecast-config','click',()=>{forecastConfigCollapsed=!forecastConfigCollapsed;render();});
    on('#active-toggle-settings','click',()=>{planSettingsCollapsed=!planSettingsCollapsed;render();});
    view.querySelectorAll('[data-forecast-view]').forEach(el=>el.addEventListener('click',()=>{forecastView=el.dataset.forecastView;render();}));
    view.querySelectorAll('[data-upgrade-view]').forEach(el=>el.addEventListener('click',()=>{upgradeView=el.dataset.upgradeView;render();}));
    on('#open-guided-routes','click',()=>{plannerMode='active';render();});
    view.querySelectorAll('[data-planner-mode]').forEach(el=>el.addEventListener('click',()=>{plannerMode=el.dataset.plannerMode;render();}));
    on('#open-active-plan','click',()=>{desk=null;tab='upgrades';plannerMode='active';render();});
    on('#active-edit-assumptions','click',()=>{ensurePlanMutable();state.simulationMode='custom';forecastRequested=true;tab='forecast';forecastConfigCollapsed=false;save(false);render();});
    view.querySelectorAll('[data-active-plan-nav]').forEach(el=>el.addEventListener('click',()=>{if(el.dataset.activePlanNav==='farm'){tab='farm';render();}}));
    on('#active-refresh','click',()=>controller.rebuild());
    on('#active-plan-funding','change',event=>{
      const wrapper=view.querySelector('#active-plan-extra-fields');if(!wrapper)return;
      const extra=event.target.value==='extra';wrapper.hidden=!extra;
      wrapper.querySelectorAll('input').forEach(input=>{input.disabled=!extra;if(input.name==='extraBudget')input.required=extra;});
    });
    on('#active-plan-settings','submit',async event=>{
      ensurePlanMutable();const data=new FormData(event.target),next={...state.activePlan};
      for(const key of ['days','refreshSeconds','claimEveryDays'])if(data.has(key))next[key]=Number(data.get(key));
      for(const key of ['funding','objective','feeMode','claimFee','upgradeFee','plantFee','transferFee','buyFee','nftTransferFee','buyPrice','sellPrice','extraBudget','extraSpent'])if(data.has(key))next[key]=String(data.get(key));
      if(!automaticMode())for(const key of ['allowTransfers','includeOpeningCrop','useObservedWeight'])next[key]=data.has(key);
      state.activePlan=validateActivePlanSettings(next);if(automaticMode())state.days=next.days;planDirty=false;save();await controller.rebuild();
      if(controller.snapshot().plan&&!controller.snapshot().error){planSettingsCollapsed=true;const assumptions=view.querySelector('#active-plan-assumptions');if(assumptions)assumptions.open=false;render();}
    });
    on('#active-rebuild','click',async()=>{if(planDirty)throw Error('Save your plan settings before rebuilding.');await controller.rebuild();});
    on('#active-toggle','click',async()=>{
      if(state.activePlan.enabled){state.activePlan.enabled=false;save(false);controller.pause();return;}
      ensurePlanMutable();if(planDirty)throw Error('Save your plan settings before starting the live plan.');
      if(!state.portfolio.wallets.some(w=>w.address))throw Error('Add a watched wallet to start live reads. You can build model plans without them.');
      state.activePlan.enabled=true;save();await controller.rebuild();
    });
    on('#active-review','click',reviewActiveStep);
    on('#active-open-actions','click',openActions);
    on('#active-export','click',()=>download('farm-active-plan.json',json({exported_at:new Date().toISOString(),settings:state.activePlan,portfolio:state.portfolio,runtime:controller.snapshot()})));

    view.querySelectorAll('[data-scene]').forEach(el=>el.addEventListener('click',showError(()=>{state.companion.scene=el.dataset.scene;save(false);render();})));
    on('#open-plot-studio','click',event=>studio.open(state.companion.theme_plot?.token_id??331,event.currentTarget,state.companion.theme_plot?.environment??'production'));
    view.querySelectorAll('[data-open-art]').forEach(el=>el.addEventListener('click',()=>studio.open(Number(el.dataset.openArt),el,state.companion.artwork_environment)));
    view.querySelectorAll('[data-remote-art]').forEach(bindRemoteImage);updateArtworkStatus();
    on('#load-plot-artwork','change',event=>{state.companion.artwork_enabled=event.target.checked;save(false);render();});
    on('#refresh-season','click',refreshSeason);
    on('#download-calendar','click',()=>download('yield-farm-calendar.ics',buildFarmCalendarICS(),'text/calendar;charset=utf-8'));
    on('#plot-filter','submit',event=>{
      const filterDetails=event.target.querySelector('details');if(filterDetails)filterDetails.open=false;const data=new FormData(event.target);plotSearch=String(data.get('plotSearch')??'');plotWallet=String(data.get('plotWallet')??'');plotStatus=String(data.get('plotStatus')??'');plotSort=String(data.get('plotSort')??'id');visiblePlots=PLOT_PAGE_SIZE;render();
    });
    on('#clear-plot-filter','click',()=>{formDrafts.delete('plot-filter');delete view.querySelector('#plot-filter').dataset.dirty;plotSearch='';plotWallet='';plotStatus='';plotSort='id';visiblePlots=PLOT_PAGE_SIZE;render();});
    function pinTarget(id) {
      const plot=allPlots(state.portfolio).find(p=>p.token_id===id&&p.level<5&&p.is_active&&tierPresentation(state.portfolio,p).tier!=null);
      if(id!=null&&!plot)throw new Error('Choose a planted plot below level 5.');
      state.companion.pinned_plot_id=plot?.token_id??null;
      if(plot){state.companion.goal_wallet_id=plot.wallet_id;state.companion.goal_crop=String(rules.levels.entries[plot.level].incremental_upgrade_cost_crop);}
      save(false);updateInsights();tab='upgrades';plannerMode='ranking';render();
    }
    view.querySelectorAll('[data-pin-plot]').forEach(el=>el.addEventListener('click',showError(()=>pinTarget(Number(el.dataset.pinPlot)))));
    on('#upgrade-target','submit',event=>{const value=new FormData(event.target).get('targetPlot');pinTarget(value?Number(value):null);});
    on('#crop-goal','submit',event=>{
      const data=new FormData(event.target),next=companionPreferences({...state.companion,goal_crop:String(data.get('goalCrop')),goal_wallet_id:String(data.get('goalWallet'))});
      state.companion=next;save(false);updateInsights();render();
    });
    view.querySelectorAll('[data-goal-amount]').forEach(el=>el.addEventListener('click',()=>{view.querySelector('#crop-goal').dataset.dirty='true';view.querySelector('[name=goalCrop]').value=el.dataset.goalAmount;}));
    view.querySelectorAll('[data-weather]').forEach(el=>el.addEventListener('click',showError(()=>{
      if(busy)return;state.simulationMode='custom';forecastRevision++;state.forecastManual=[...new Set([...state.forecastManual,'weatherBps','useKnownWeather'])];state.scenario.weatherBps=Number(el.dataset.weather);state.scenario.weatherPath=[];state.scenario.useKnownWeather=false;
      const form=view.querySelector('#assumptions'),draft=formDrafts.get('assumptions');
      if(form){form.elements.namedItem('weatherBps').value=el.dataset.weather;form.elements.namedItem('useKnownWeather').checked=false;}
      if(draft)for(const entry of draft.values){if(entry.name==='weatherBps')entry.value=el.dataset.weather;if(entry.name==='useKnownWeather')entry.checked=false;}
      save();calculate();
    })));
    view.querySelectorAll('[data-tab]').forEach(el=>{
      el.addEventListener('click',()=>{desk=null;tab=el.dataset.tab;render();view.querySelector('#tab-'+tab)?.focus({preventScroll:true});});
      el.addEventListener('keydown',event=>{const ids=['farm','forecast','upgrades'],i=ids.indexOf(el.dataset.tab),next=event.key==='ArrowRight'?(i+1)%3:event.key==='ArrowLeft'?(i+2)%3:event.key==='Home'?0:event.key==='End'?2:null;if(next!=null){event.preventDefault();view.querySelector('#tab-'+ids[next])?.click();}});
    });
    on('#brand-home','click',()=>{desk=null;tab='farm';render();});
    on('#hero-start','click',()=>{view.querySelector('#wallet-intake')?.scrollIntoView({behavior:'smooth',block:'center'});view.querySelector('[name=address]')?.focus({preventScroll:true});});
    view.querySelectorAll('[data-plot-view]').forEach(el=>el.addEventListener('click',()=>{plotView=el.dataset.plotView;render();}));
    on('#more-plots','click',()=>{
      visiblePlots+=PLOT_PAGE_SIZE;render();
      const target=view.querySelector('#more-plots')??view.querySelector('.plot-grid .plot-card:last-child .plot-art-button, .table-scroll tbody tr:last-child button');
      target?.focus({preventScroll:true});
    });
    view.querySelectorAll('[data-days]').forEach(el=>el.addEventListener('click',()=>{if(automaticMode()){if(forecastLocked())return;state.days=Number(el.dataset.days);state.activePlan.days=state.days;save();calculate();return;}view.querySelector('#assumptions').dataset.dirty='true';view.querySelector('[name=days]').value=el.dataset.days;view.querySelectorAll('[data-days]').forEach(x=>x.classList.toggle('active',x===el));}));
    on('[name=weatherBps]','change',e=>{view.querySelector('#weather-caption').textContent=rules.weather.states.find(w=>w.multiplier_bps===Number(e.target.value)).name+' scenario';});
    on('#connect-farm','click',async()=>{
      ensurePlanMutable();if(walletConnecting)return;
      walletConnecting=true;render();
      try {
        const provider=walletProvider();
        if(!provider?.request)throw Error('Open this page in a wallet browser, or paste a public wallet address below.');
        const accounts=await provider.request({method:'eth_requestAccounts'});
        ensurePlanMutable();
        const address=Array.isArray(accounts)?accounts[0]:null;
        if(typeof address!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(address))throw Error('The wallet did not return a public account.');
        if(!state.portfolio.wallets.some(w=>w.address?.toLowerCase()===address.toLowerCase()))addWatchedWallet(address);
        desk=null;await refresh();
      }finally{walletConnecting=false;if(!destroyed)render();}
    });
    on('#add-wallet','submit',async event=>{
      ensureMutable();const data=new FormData(event.target),address=String(data.get('address')).trim();
      addWatchedWallet(address,String(data.get('label')??'').trim());desk=null;await refresh();
    });
    on('#quick-farm','change',event=>{if(['tier','level'].includes(event.target.name)){const form=event.currentTarget;const level=Number(form.elements.level.value);view.querySelector('.intake-art').src=art.levels[level-1];}});
    on('#quick-farm','submit',event=>{
      ensureMutable();const data=new FormData(event.target),count=Number(data.get('count')),tierChoice=String(data.get('tier')),level=Number(data.get('level')),active=data.has('active');
      if(!Number.isInteger(count)||count<1||count>100)throw new Error('Choose 1–100 model plots at a time.');
      if(allPlots(state.portfolio).length+count>100)throw new Error('This workspace supports up to 100 plots.');
      if(!Number.isInteger(level)||level<1||level>5||!['random','0','1','2','3'].includes(tierChoice))throw new Error('Choose a valid rarity and level.');
      const tiers=tierChoice==='random'?sampleRarityTiers(count):Array(count).fill(Number(tierChoice));
      let w=state.portfolio.wallets.find(w=>!w.address&&w.id===data.get('modelWallet'));if(!w){if(state.portfolio.wallets.length>=20)throw new Error('This workspace supports up to 20 wallets.');w={id:`model_${Date.now()}`,label:'Model wallet '+(state.portfolio.wallets.filter(w=>!w.address).length+1),address:null,crop_balance_wei:'0',eth_balance_wei:'0',plots:[],expected_plot_count:0};state.portfolio.wallets.push(w);}
      if(!w.plots.length&&w.label==='Wallet A')w.label='Model wallet';w.crop_balance_wei??='0';w.eth_balance_wei??='0';
      const ids=new Set(allPlots(state.portfolio).map(p=>p.token_id));let id=1;
      for(let i=0;i<count;i++){const tier=tiers[i];while(ids.has(id))id++;ids.add(id);w.plots.push({token_id:id,rarity_tier:tier,level,is_active:active,effective_weight_bps:active?weight(tier,level):0,pending_crop_wei:'0',reveal_status:'hypothetical',modifiers:[],evidence_source:'manual-hypothesis'});}
      recount();checkState();save();desk=null;notice=`${count} ${tierChoice==='random'?'random':rules.plots.rarities[Number(tierChoice)].name} ${count===1?'model plot':'model plots'} added.`;render();
    });
    on('#refresh-wallets','click',refresh);
    for(const id of ['#farm-forecast','#planner-assumptions','#planner-forecast'])on(id,'click',()=>{tab=allPlots(state.portfolio).length?'forecast':'farm';render();});
    on('#forecast-upgrades','click',()=>{tab='upgrades';render();});
    on('#planner-recalculate','click',calculate);
    view.querySelectorAll('[data-remove-wallet]').forEach(el=>el.addEventListener('click',showError(()=>{ensureMutable();modal={type:'remove-wallet',wallet:el.dataset.removeWallet};renderModal();})));
    view.querySelectorAll('[data-edit-wallet]').forEach(el=>el.addEventListener('click',showError(()=>{ensureMutable();modal={type:'wallet',wallet:el.dataset.editWallet};renderModal();})));
    view.querySelectorAll('[data-edit-plot]').forEach(el=>el.addEventListener('click',showError(()=>{ensureMutable();modal={type:'plot',plot:Number(el.dataset.editPlot)};renderModal();})));
    on('#assumptions','submit',event=>{
      if(busy)return;
      const data=new FormData(event.target),next={...state.scenario};
      state.companion.assume_planted=data.has('assumePlanted');
      for(const key of ['externalWeight','annualGrowthPct','carryCrop','granaryCrop','buyPrice','sellPrice'])next[key]=String(data.get(key)??'');
      next.externalWeight=next.externalWeight.trim()||'0';
      next.annualGrowthPct=next.annualGrowthPct.trim()||'0';
      next.start=new Date(String(data.get('start'))+'Z').toISOString();next.weatherBps=Number(data.get('weatherBps'));next.rewardStateBasis='assumption';next.weatherPath=[];next.weatherEvents=[];next.externalWeightPath=[];
      next.useKnownWeather=data.has('useKnownWeather');
      const observed=event.target.dataset.observed ? JSON.parse(event.target.dataset.observed) : state.scenario.rewardStateBasis==='observed' ? {at:state.scenario.rewardObservedAt,start:state.scenario.start.slice(0,16),carry:state.scenario.carryCrop,granary:state.scenario.granaryCrop}:null;
      if(observed&&observed.start===String(data.get('start'))&&observed.carry===next.carryCrop&&observed.granary===next.granaryCrop){
        next.rewardStateBasis='observed';next.rewardObservedAt=observed.at;
        // The form shows minutes; unchanged observed reserves retain their exact block second.
        next.start=new Date(Math.max(Date.parse(observed.at),rules.schedule.genesis_timestamp*1000)).toISOString();
      }
      const days=Number(data.get('days'));if(!Number.isInteger(days)||days<1||days>365)throw new Error('Choose a forecast of 1–365 whole days.');
      const errors=validateScenario(next);if(errors.length)throw new Error(errors.join(' '));
      forecastRevision++;state.forecastManual=[...new Set([...state.forecastManual,...forecastEditing])];forecastEditing.clear();
      state.scenario=next;state.days=days;save();calculate();
    });
    on('[data-preset="full"]','click',()=>{
      forecastEditing.add('externalWeight');view.querySelector('#assumptions').dataset.dirty='true';
      view.querySelector('[name=externalWeight]').value=fullSupplyCompetition(state.portfolio);
      notice='Valley weight scenario selected: remaining plots at level 1, excluding your plots at their base rarity weights. This is a scenario, not a live forecast.';
    });
    on('#use-observed','click',()=>{
      forecastEditing.add('externalWeight');view.querySelector('#assumptions').dataset.dirty='true';
      const own=allPlots(state.portfolio).filter(p=>state.portfolio.wallets.find(w=>w.id===p.wallet_id)?.address).reduce((n,p)=>n+(p.effective_weight_bps??0),0);
      view.querySelector('[name=externalWeight]').value=String(Math.max(0,state.portfolio.total_planted_farm_weight_bps-own)/10000);
    });
    on('#use-reward-state','click',()=>{
      RESERVE_FIELDS.forEach(key=>forecastEditing.add(key));view.querySelector('#assumptions').dataset.dirty='true';
      const p=state.portfolio,at=p.reward_observed_at_utc;
      if(p.carry_crop_wei==null||p.granary_crop_wei==null||!Number.isFinite(Date.parse(at)))throw new Error('Refresh a public wallet to read the carry and Granary at one chain block.');
      const start=new Date(Math.max(Date.parse(at),rules.schedule.genesis_timestamp*1000)).toISOString().slice(0,16),carry=inputAmount(p.carry_crop_wei),granary=inputAmount(p.granary_crop_wei);
      view.querySelector('[name=start]').value=start;view.querySelector('[name=carryCrop]').value=carry;view.querySelector('[name=granaryCrop]').value=granary;
      view.querySelector('#assumptions').dataset.observed=JSON.stringify({at,start,carry,granary});
      const note=view.querySelector('#reward-state-note');note.textContent=`Copied carry and Granary from ${dateText(at)}. Start date aligned to that observation (or Genesis, if it has not started).`;
    });
    on('#export-workspace','click',()=>download('farm-companion-workspace.json',json(state)));
    on('#import-workspace','click',()=>view.querySelector('#import-file').click());
    on('#import-file','change',async event=>{
      ensureMutable();const file=event.target.files?.[0];if(!file)return;if(file.size>5_000_000)throw new Error('Workspace exceeds the 5 MB import limit.');
      const next=parsePublicWorkspace(await file.text());next.activePlan.enabled=false;ensureMutable();state=next;resetView();analysis=null;save();notice='Farm imported. Ready for a fresh forecast.';render();
    });
    on('#reset-workspace','click',()=>{if(busy)throw new Error('Wait for the current read or calculation before resetting.');if(pending())throw new Error('Resolve the saved wallet action before resetting this workspace.');modal={type:'reset'};renderModal();});
    on('#export-csv','click',()=>{
      const rate=analysis.harvest_rate??{};
      const weightValue=rate.active_weight_bps==null?'':String(Number(rate.active_weight_bps)/10000);
      const basis=forecastBasis??{},assumePlanted=state.companion.assume_planted===true,plantingCost=basis.planting_cost_crop_wei??'0';
      const basisHeader=['forecast_mode','assume_planted','pending_count','assumed_planted_count','planting_cost_crop_wei','planting_cost_crop','planting_funding'];
      const basisRow=[basis.mode??'observed',assumePlanted,basis.pending_count??0,basis.assumed_planted_count??0,plantingCost,inputAmount(plantingCost),assumePlanted?'separate-capital':'none'];
      const rows=[['days','new_crop_earned','ending_crop','new_rewards_value_eth','active_weight','nominal_hourly_crop','nominal_daily_crop','nominal_weekly_crop','rate_at_utc','weather_multiplier_bps','first_soil_multiplier_bps','combined_multiplier_bps','nominal_crop','base_limited','bonus_limited','projected_crop',...basisHeader],...analysis.horizons.map(r=>[r.days,inputAmount(r.earned_crop_wei),inputAmount(r.ending_crop_wei),r.estimated_value_eth_wei==null?'':inputAmount(r.estimated_value_eth_wei),weightValue,rate.nominal_hourly_crop_wei==null?'':inputAmount(rate.nominal_hourly_crop_wei),rate.nominal_daily_crop_wei==null?'':inputAmount(rate.nominal_daily_crop_wei),rate.nominal_weekly_crop_wei==null?'':inputAmount(rate.nominal_weekly_crop_wei),rate.at_utc??'',rate.weather_multiplier_bps??'',rate.first_soil_multiplier_bps??'',rate.combined_multiplier_bps??'',r.nominal_crop_wei==null?'':inputAmount(r.nominal_crop_wei),r.base_limited===true,r.bonus_limited===true,inputAmount(r.earned_crop_wei),...basisRow])];
      download('farm-yield-forecast.csv',rows.map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv');
    });
    on('#export-upgrades','click',()=>{
      const basis=forecastBasis??{},assumePlanted=state.companion.assume_planted===true,plantingCost=basis.planting_cost_crop_wei??'0';
      const basisHeader=['forecast_mode','assume_planted','pending_count','assumed_planted_count','planting_cost_crop_wei','planting_cost_crop','planting_funding'];
      const basisRow=[basis.mode??'observed',assumePlanted,basis.pending_count??0,basis.assumed_planted_count??0,plantingCost,inputAmount(plantingCost),assumePlanted?'separate-capital':'none'];
      const rows=[['rank','plot_id','wallet','from_level','to_level','crop_cost','daily_gain_crop','days_to_afford','payback_days','horizon_net_crop',...basisHeader],...(upgradeView==='routes'?analysis.upgrade_paths:analysis.upgrades).map((r,i)=>[i+1,r.plot_id,walletName(state.portfolio,r.wallet_id),r.from_level,r.to_level,exactExport(r.cost_crop_wei),exactExport(r.daily_gain_crop_wei),r.ready_in_days??'',r.break_even_days??'',exactExport(r.net_crop_wei),...basisRow])];
      download('farm-upgrade-plan.csv',rows.map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv');
    });
  }
  function csvCell(value) {const s=String(value??'');return '"'+(/^[=+@\-]/.test(s)&&!/^\-?\d+(\.\d+)?$/.test(s)?"'":'')+s.replaceAll('"','""')+'"';}
  function renderModal() {
    const container=root.querySelector('#modal');if(!modal){container.innerHTML='';delete container.dataset.modalKey;return;}
    const modalKey=JSON.stringify(modal);if(container.dataset.modalKey===modalKey&&container.children.length)return;
    if(!container.children.length)modalTrigger=root.activeElement;
    container.dataset.modalKey=modalKey;
    let body='',title='';
    if(modal.type==='wallet'){
      const w=state.portfolio.wallets.find(w=>w.id===modal.wallet);title='Edit model wallet';
      body=`<div class="form-grid">${field('Wallet label','label',w.label,'maxlength="120" required')}${field('Liquid CROP','crop',inputAmount(w.crop_balance_wei??0),'inputmode="decimal" required')}${field('ETH balance','eth',inputAmount(w.eth_balance_wei??0),'inputmode="decimal" required')}</div><p class="muted">These are hypothetical balances for local calculations.</p>`;
    } else if(modal.type==='plot'){
      const p=allPlots(state.portfolio).find(p=>p.token_id===modal.plot);title=`Edit model plot #${p.token_id}`;
      body=`<div class="form-grid">${field('Plot ID','token_id',p.token_id,'type="number" min="1" max="3333" required')}${select('Model wallet','wallet_id',state.portfolio.wallets.filter(w=>!w.address).map(w=>[w.id,w.label]),p.wallet_id)}${select('Rarity','tier',rules.plots.rarities.map(r=>[r.tier,r.name]),p.rarity_tier)}${select('Level','level',rules.levels.entries.map(l=>[l.level,`${l.level} · ${l.name}`]),p.level)}${field('Pending CROP','pending',inputAmount(p.pending_crop_wei??0),'inputmode="decimal" required')}${select('Planting state','active',[['yes','Planted'],['no','Dormant']],p.is_active?'yes':'no')}</div><div class="actions"><button type="button" id="remove-plot" class="quiet danger">Remove plot</button></div>`;
    } else if(modal.type==='remove-wallet'){title='Remove this wallet?';body='<p>Its plots and balances will be removed from this browser’s farm. The wallet and NFTs on-chain are unaffected.</p>';}
    else {title='Reset your local farm?';body='<p>This removes saved plots and assumptions from this browser. Export your farm first if you want to keep it.</p>';}
    container.innerHTML=`<div class="dialog-backdrop"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><h2 id="dialog-title">${escape(title)}</h2><form id="modal-form">${body}<div id="modal-error" role="alert"></div><div class="actions"><button class="primary">${['reset','remove-wallet'].includes(modal.type)?'Confirm removal':'Save changes'}</button><button type="button" id="close-modal" class="quiet">Cancel</button></div></form></section></div>`;
    const close=()=>{modal=null;renderModal();if(modalTrigger?.isConnected)modalTrigger.focus();};container.querySelector('#close-modal').onclick=close;
    const focusables=()=>[...container.querySelectorAll('button,input,select')];focusables()[0]?.focus();
    container.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const list=focusables(),first=list[0],last=list.at(-1);if(event.shiftKey&&root.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&root.activeElement===last){event.preventDefault();first.focus();}}};
    container.querySelector('#remove-plot')?.addEventListener('click',showError(()=>{ensureMutable();for(const w of state.portfolio.wallets)w.plots=w.plots.filter(p=>p.token_id!==modal.plot);recount();save();close();render();}));
    container.querySelector('#modal-form').onsubmit=event=>{
      event.preventDefault();const backup=clone(state);
      try{
        if(modal.type!=='reset')ensureMutable();const data=new FormData(event.target);
        if(modal.type==='wallet'){
          const w=state.portfolio.wallets.find(w=>w.id===modal.wallet);w.label=String(data.get('label')).trim();w.crop_balance_wei=units(data.get('crop')).toString();w.eth_balance_wei=units(data.get('eth')).toString();
        } else if(modal.type==='plot'){
          const old=state.portfolio.wallets.find(w=>w.plots.some(p=>p.token_id===modal.plot)),p=old.plots.find(p=>p.token_id===modal.plot),target=state.portfolio.wallets.find(w=>w.id===data.get('wallet_id'));
          const followed=state.companion.pinned_plot_id===p.token_id;
          p.token_id=Number(data.get('token_id'));p.rarity_tier=Number(data.get('tier'));p.level=Number(data.get('level'));p.pending_crop_wei=units(data.get('pending')).toString();p.is_active=data.get('active')==='yes';p.effective_weight_bps=p.is_active?weight(p.rarity_tier,p.level):0;
          if(old!==target){old.plots=old.plots.filter(x=>x!==p);target.plots.push(p);}
          if(followed){state.companion.pinned_plot_id=p.token_id;reconcilePreferences(true);}
        } else if(modal.type==='remove-wallet'){state.portfolio.wallets=state.portfolio.wallets.filter(w=>w.id!==modal.wallet);if(!state.portfolio.wallets.length)state.portfolio=emptyPortfolio();}
        else {if(busy)throw new Error('Wait for the current read or calculation before resetting.');if(pending())throw new Error('Resolve the pending wallet action first.');state=makeInitialState();storageBroken=false;resetView();}
        recount();checkState();save();close();render();
      }catch(e){state=backup;container.querySelector('#modal-error').innerHTML=`<p class="notice error" style="margin-top:16px">${escape(e.message)}</p>`;}
    };
  }
  function actionState(){return {...(widget?.getActionState?.()??{}),locked:storageBroken||storageWriteFailed||pending()||Boolean(widget?.getActionState?.().locked)};}
  function ensurePlanMutable(){ensureMutable();const a=actionState();if(a.locked||a.busy||a.hasDraft)throw Error('Finish or discard the action review before changing the active plan.');}
  function openActions(){desk='actions';render();const pane=root.querySelector('#action-workspace');pane.scrollTop=0;const heading=pane.querySelector('.approval-review h3')??pane.querySelector('h3,h2');if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});heading.scrollIntoView({block:'start'});}}
  async function reviewActiveStep(){
    if(planDirty)throw Error('Save your plan settings before reviewing a step.');
    const shown=controller.snapshot().nextAction;if(shown?.status!=='ready_for_review')throw Error('Rebuild the plan before reviewing this step.');
    const identity=actionIdentity(shown);
    await controller.rebuild();
    const fresh=controller.snapshot(),next=fresh.nextAction;
    if(next?.status!=='ready_for_review'||actionIdentity(next)!==identity){notice='The next move changed after refreshing. Review the updated plan.';render();return;}
    if(!widget?.prepareIntent)throw Error('The approval panel is unavailable. Reload the companion.');
    const intent={type:next.type,wallet_id:next.wallet_id,...(next.type==='claim'?{plot_ids:next.plot_ids}:{plot_id:next.plot_id})};
    const result=await widget.prepareIntent(intent,{validate:()=>{
      if(storageBroken||storageWriteFailed)throw Error('Save or recover the workspace before approving a plan step.');
      const current=controller.snapshot();
      const checked=livePlanAction(current.plan,state,{stale:current.stale});
      if(planDirty||checked.status!=='ready_for_review'||actionIdentity(checked)!==identity)throw Error('The active plan changed or expired. Discard this review and rebuild.');
    }});
    openActions();if(!result.ok)throw Error(result.error??'The action could not be prepared.');
  }
  controller=createActivePlanController({getWorkspace:()=>state,refresh:()=>refresh({fromPlan:true}),runner:createPlanRunner(planWorkerFactory),
    prepareWorkspace:()=>{
      const clock=state.activePlanClock??{};state.activePlanClock=Object.fromEntries(state.portfolio.wallets.filter(w=>w.address).map(w=>[w.id,clock[w.id]??new Date().toISOString()]));save(false);
    },
    actionState,isVisible:()=>isVisible()&&document.visibilityState!=='hidden',
    isEditing:()=>busy||seasonBusy||(forecastBusy&&tab==='forecast')||Boolean(modal)||root.querySelector('.app').inert||Boolean(view.querySelector('form[data-dirty]'))||Boolean(root.activeElement?.matches('input,select,textarea')),
    onChange:()=>render(),
  });
  render();
  widget=approvalWidget?.(root.querySelector('#approval'),{getPortfolio:()=>state.portfolio,getState:()=>state,reader,storage,getProvider:walletProvider,
    onRefresh:async()=>{receiptRebuild=Boolean(controller.snapshot().plan);await refresh({afterReceipt:true});},
    onConfirmed:record=>{if(record.type==='claim'&&record.wallet_id){state.activePlanClock[record.wallet_id]=record.at;save();}},
    onStateChange:()=>{save();render();},
    onActivity:()=>{controller.actionChanged();if(receiptRebuild&&!actionState().busy&&!actionState().hasPending){receiptRebuild=false;queueMicrotask(()=>{if(!destroyed)void controller.rebuild();});}},
  });
  lastApprovalInputs=json({portfolio:state.portfolio,pendingExecution:state.pendingExecution});
  controller.sync({immediate:state.activePlan.enabled});
  return {root,refresh,getState:()=>clone(state),getPlan:()=>controller.snapshot(),visibilityChanged:()=>{controller.sync({immediate:true});refreshAutomaticOnOpen();if(collectionVisible()&&!collectionBusy)void refreshCollection();},destroy(){destroyed=true;clearTimeout(timer);clearTimeout(collectionTimer);controller.destroy();studio.destroy();widget?.destroy?.();root.replaceChildren();}};
}
