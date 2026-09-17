import test from 'node:test';
import assert from 'node:assert/strict';
import reviewed from '../knowledge/reviewed-deployment.json' with {type:'json'};
import {emptyPortfolio, defaults, units, weight, validatePortfolio} from '../src/model.js';
import {prepareForecastPortfolio, forecastPlotTier, isForecastPreview} from '../src/forecast-portfolio.js';
import {analyzeFarm} from '../src/calculator.js';
import {analyzeInsights} from '../src/insights.js';
import {activePlanInput, livePlanAction} from '../src/active-plan.js';

const ADDRESS='0x0000000000000000000000000000000000000001';
const AT='2026-09-15T22:36:53.000Z';
function fixture(count=26){
  const p=emptyPortfolio();
  Object.assign(p,{is_demo:false,expected_total_plots:count,block_number:64012808,observed_at_utc:AT,
    block_timestamp:Date.parse(AT)/1000,nft_runtime_verified:true,nft_contract_address:reviewed.contracts.nft.address,
    manifest_verified:true,starting_index:1827,tiers_finalized:false,read_errors:[],rule_conflicts:[],
    reward_observed_at_utc:AT,carry_crop_wei:'0',granary_crop_wei:units('40000000').toString()});
  Object.assign(p.wallets[0],{address:ADDRESS,crop_balance_wei:units('1000').toString(),eth_balance_wei:units('1').toString(),expected_plot_count:count});
  p.wallets[0].plots=Array.from({length:count},(_,i)=>({token_id:i+1,owner_address:ADDRESS,rarity_tier:null,
    chain_rarity_tier:0,manifest_rarity_tier:i%4,rarity_verified:false,tiers_finalized:false,level:1,is_active:false,
    effective_weight_bps:0,desired_weight_bps:0,weight_synchronized:true,pending_crop_wei:'0',modifiers:null,
    reveal_status:'revealed',block_number:p.block_number,observed_at_utc:AT}));
  return p;
}

test('26 pending plots calculate a manifest preview without inventing planting or modifying observed holdings',()=>{
  const raw=fixture(),before=structuredClone(raw),preview=prepareForecastPortfolio(raw);
  assert.deepEqual(preview.errors,[]);assert.equal(preview.mode,'manifest-preview');assert.equal(preview.pending_count,26);
  assert.equal(preview.assumed_planted_count,0);assert.equal(preview.planting_cost_crop_wei,'0');
  assert.deepEqual(raw,before);assert.equal(raw.wallets[0].plots[3].rarity_tier,null);
  assert.equal(preview.portfolio.wallets[0].plots[3].rarity_tier,3);
  assert.equal(preview.portfolio.wallets[0].plots[3].rarity_verified,false);
  assert.equal(preview.portfolio.tiers_finalized,false);
  assert.deepEqual(validatePortfolio(preview.portfolio),[]);
  const result=analyzeFarm(preview.portfolio,defaults());
  assert.equal(result.status,'ok');assert.equal(result.portfolio.weekly_crop_wei,0n);
});

test('planting scenario preserves budgets, accounts separately for 26 planting costs and feeds consistent insights',()=>{
  const raw=fixture(),preview=prepareForecastPortfolio(raw,{assumePlanted:true}),p=preview.portfolio;
  assert.deepEqual(preview.errors,[]);assert.equal(preview.assumed_planted_count,26);
  assert.equal(preview.planting_cost_crop_wei,units('65000').toString());
  assert.equal(p.forecast_preview.planting_funding,'separate-capital');
  assert.equal(p.wallets[0].crop_balance_wei,raw.wallets[0].crop_balance_wei);
  assert.ok(p.wallets[0].plots.every(plot=>plot.is_active));assert.ok(raw.wallets[0].plots.every(plot=>!plot.is_active));
  const s=defaults(),forecast=analyzeFarm(p,s),insights=analyzeInsights(p,s);
  assert.equal(forecast.status,'ok');assert.equal(insights.status,'ok');
  assert.ok(forecast.portfolio.weekly_crop_wei>0n);assert.ok(forecast.best_upgrade_path);
  assert.equal(forecast.portfolio.active_weight_bps,p.wallets[0].plots.reduce((n,plot)=>n+weight(plot.rarity_tier,plot.level),0));
});

test('only verified same-block manifest observations may fill pending rarity',()=>{
  for(const mutate of [p=>p.nft_runtime_verified=false,p=>p.manifest_verified=false,p=>p.starting_index=0,
    p=>p.nft_contract_address=ADDRESS,p=>p.wallets[0].plots[0].block_number++,p=>p.wallets[0].plots[0].observed_at_utc='2026-09-15T20:00:00Z',
    p=>p.wallets[0].plots[0].manifest_rarity_tier=null,p=>p.wallets[0].plots[0].reveal_status='unknown']){
    const p=fixture(1);mutate(p);const result=prepareForecastPortfolio(p);
    assert.equal(result.errors.length,1);assert.match(result.errors[0],/Refresh wallets/);
    assert.equal(result.portfolio.wallets[0].plots[0].rarity_tier,null);
    assert.equal(forecastPlotTier(p,p.wallets[0].plots[0]),null);
  }
});

test('real RPC failures, unknown observations and rule conflicts stay blocking',()=>{
  for(const mutate of [p=>p.read_errors.push('Wallet balance: HTTP 429'),p=>p.wallets[0].crop_balance_wei=null,
    p=>p.wallets[0].plots[0].level=null,p=>p.wallets[0].plots[0].pending_crop_wei=null,
    p=>p.wallets[0].plots[0].desired_weight_bps=null,p=>p.wallets[0].plots[0].weight_synchronized=false,
    p=>p.rule_conflicts.push('Changed activation deployment')]){
    const p=fixture(1);mutate(p);assert.ok(prepareForecastPortfolio(p).errors.length);
  }
  const p=fixture(1);p.read_errors=['Plot 1: rarity assignment is not confirmed finalized.'];
  assert.deepEqual(prepareForecastPortfolio(p).errors,[]);assert.equal(p.read_errors.length,1);
  p.read_errors.push('Plot 2: rarity assignment is not confirmed finalized.');
  assert.match(prepareForecastPortfolio(p).errors.join(),/Plot 2/);
});

test('artwork failures are nonblocking and confirmed or hypothetical farms retain their ordinary calculation',()=>{
  const p=fixture(1);p.metadata_errors=['Plot 1: HTTP 503'];
  assert.deepEqual(prepareForecastPortfolio(p).errors,[]);
  const model=emptyPortfolio();model.wallets[0].plots=[{token_id:1,rarity_tier:2,level:2,is_active:true,effective_weight_bps:weight(2,2),pending_crop_wei:'0'}];
  const preview=prepareForecastPortfolio(model);assert.deepEqual(preview.errors,[]);assert.equal(preview.mode,'observed');
  assert.equal(isForecastPreview(preview.portfolio),false);assert.deepEqual(preview.portfolio,model);
});

test('preview clones cannot become active-plan inputs or be previewed again as observations',()=>{
  const raw=fixture(1),preview=prepareForecastPortfolio(raw,{assumePlanted:true}).portfolio;
  const workspace={portfolio:preview,scenario:defaults(),activePlan:{feeMode:'zero'}};
  assert.ok(activePlanInput(workspace,Date.parse(AT)).errors.some(e=>/cannot authorize/.test(e)));
  assert.equal(livePlanAction(null,workspace).status,'blocked');
  assert.match(prepareForecastPortfolio(preview).errors.join(),/exported forecast preview/);
  delete preview.forecast_preview;
  assert.equal(isForecastPreview(preview),true);
  assert.equal(livePlanAction(null,workspace).status,'blocked');
  const rawInput=activePlanInput({...workspace,portfolio:raw},Date.parse(AT));
  assert.ok(rawInput.errors.some(e=>/On-chain rarity is still pending/.test(e)));
});
