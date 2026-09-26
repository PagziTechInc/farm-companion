import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeFarm} from '../src/calculator.js';
import {defaults,emptyPortfolio,units,weight,GENESIS,YEAR,DAY,validatePortfolio,validateScenario} from '../src/model.js';
import {timeline,rewardProjection,rewardState,emissionBetween,settleReward,simulate,harvestRateAtStart,nominalCropForWeight} from '../src/engine.js';
function fixture(){const p=emptyPortfolio();p.wallets[0].plots=[plot(1)];p.wallets[0].eth_balance_wei=units('1').toString();return {p,s:{...defaults(),externalWeight:'0',feeMode:'zero'}};}
function plot(id,tier=0,level=1){return {token_id:id,rarity_tier:tier,level,is_active:true,effective_weight_bps:weight(tier,level),pending_crop_wei:'0',modifiers:[]};}
function close(actual,expected,tolerance=100n){assert.ok(actual-expected<tolerance&&expected-actual<tolerance,`${actual} != ${expected}`);}
test('public workspace has no owner addresses and supports one through twenty wallets',()=>{const p=emptyPortfolio();assert.equal(p.wallets.length,1);assert.equal(p.wallets[0].address,null);assert.equal(p.expected_total_plots,0);assert.deepEqual(validatePortfolio(p,false),[]);for(let i=1;i<20;i++)p.wallets.push({...p.wallets[0],id:`w${i}`,plots:[]});assert.deepEqual(validatePortfolio(p,false),[]);p.wallets.push({...p.wallets[0],id:'too_many'});assert.match(validatePortfolio(p,false).join(),/1–20/);});
test('nominal rate and exact First Soil intervals replace the former shared faucet',()=>{const {p,s}=fixture();let r=analyzeFarm(p,s,{days:28});assert.equal(r.status,'ok');close(r.portfolio.weekly_crop_wei,units('4000'));close(r.horizons.find(h=>h.days===28).earned_crop_wei,units('13000'));s.start='2026-10-19T00:00:00Z';r=analyzeFarm(p,s);close(r.portfolio.weekly_crop_wei,units('2000'));});
test('own nominal return stays flat for optional outside-weight scenarios below the ceiling',()=>{const {p,s}=fixture();const results=[0,1000,3000].map(value=>analyzeFarm(p,{...s,externalWeight:String(value)},{days:7}));for(const result of results){assert.equal(result.status,'ok');close(result.horizons.find(row=>row.days===7).earned_crop_wei,units('4000'),100n);assert.equal(result.harvest_limits.base_limited,false);}assert.equal(results[0].harvest_rate.nominal_weekly_crop_wei,units('4000'));assert.equal(nominalCropForWeight(10000,7*DAY),units('2000'));});
test('harvest rate exposes dated weather, First Soil and schedule boundaries',()=>{const {s}=fixture();s.useKnownWeather=true;s.weatherWeeks=[{epoch:0,multiplier_bps:12000}];s.weatherEvents=[{type:'moon',start:'2026-09-21T00:00:00Z'}];let rate=harvestRateAtStart(s,10000);assert.equal(rate.at_utc,'2026-09-21T00:00:00.000Z');assert.equal(rate.weather_multiplier_bps,20000);assert.equal(rate.first_soil_multiplier_bps,20000);assert.equal(rate.combined_multiplier_bps,40000);assert.equal(rate.nominal_weekly_crop_wei,units('8000'));s.weatherEvents=[];s.start='2026-09-28T00:00:00Z';rate=harvestRateAtStart(s,10000);assert.equal(rate.first_soil_multiplier_bps,15000);assert.equal(rate.nominal_weekly_crop_wei,units('3000'));s.start='2026-10-19T00:00:00Z';rate=harvestRateAtStart(s,10000);assert.equal(rate.first_soil_multiplier_bps,10000);assert.equal(rate.nominal_weekly_crop_wei,units('2000'));s.start=new Date((GENESIS+4*YEAR)*1000).toISOString();assert.equal(harvestRateAtStart(s,10000).nominal_weekly_crop_wei,0n);});
test('omitted, blank and null outside weight normalize to zero while invalid values still fail',()=>{const {s}=fixture();for(const value of [undefined,null,'',' ']){const scenario={...s,externalWeight:value};assert.deepEqual(validateScenario(scenario),[]);assert.equal(timeline(scenario,1)[0].external,0);}for(const value of ['-1','NaN','Infinity','1000000001'])assert.ok(validateScenario({...s,externalWeight:value}).some(message=>/externalWeight|bounds/.test(message)));});
test('First Soil boundaries split an intraday forecast',()=>{const {s}=fixture();s.start='2026-09-27T12:00:00Z';const r=rewardProjection(timeline(s,1),10000,rewardState(s));close(r.earned,units('2000')*7n/28n);s.start='2026-10-18T12:00:00Z';close(rewardProjection(timeline(s,1),10000,rewardState(s)).earned,units('2000')*5n/28n);});
test('empty Granary removes unfunded First Soil bonus, harsh weather replenishes it',()=>{const {p,s}=fixture();s.granaryCrop='0';close(analyzeFarm(p,s).portfolio.weekly_crop_wei,units('2000'));s.start='2026-10-19T00:00:00Z';s.weatherBps=5000;const low=rewardProjection(timeline(s,7),10000,rewardState(s));close(low.earned,units('1000'));close(low.granary,units('1000'));});
test('harvest limits identify a binding base ceiling and finite Granary bonus separately',()=>{const {p,s}=fixture();const low=analyzeFarm(p,{...s,externalWeight:'3000'},{days:7});assert.equal(low.harvest_limits.base_limited,false);const capped=analyzeFarm(p,{...s,externalWeight:'100000'},{days:7});assert.equal(capped.harvest_limits.base_limited,true);assert.ok(capped.harvest_limits.projected_crop_wei<capped.harvest_limits.nominal_crop_wei);const noGranary=analyzeFarm(p,{...s,externalWeight:'0',granaryCrop:'0'},{days:7});assert.equal(noGranary.harvest_limits.base_limited,false);assert.equal(noGranary.harvest_limits.bonus_limited,true);close(noGranary.harvest_limits.projected_crop_wei,units('2000'));p.wallets[0].plots[0].is_active=false;p.wallets[0].plots[0].effective_weight_bps=0;const idle=analyzeFarm(p,{...s,externalWeight:'100000',granaryCrop:'0'},{days:7});assert.equal(idle.harvest_limits.base_limited,false);assert.equal(idle.harvest_limits.bonus_limited,false);});
test('annual schedule is a ceiling and unused base accumulates as carry',()=>{const {s}=fixture(),rows=timeline(s,1);const idle=settleReward(rows[0],0,rewardState(s));assert.equal(idle.amount,0n);assert.equal(idle.carry,emissionBetween(GENESIS,GENESIS+DAY));assert.equal(idle.granary,units('40000000'));s.granaryCrop='0';s.start='2026-10-19T00:00:00Z';const capped=rewardProjection(timeline(s,1),100000000,rewardState(s));assert.equal(capped.earned,emissionBetween(GENESIS+28*DAY,GENESIS+29*DAY));s.carryCrop='100000';const carried=rewardProjection(timeline(s,1),100000000,rewardState(s));assert.equal(carried.earned,capped.earned+units('100000'));assert.equal(carried.carry,0n);});
test('weather cap applies before First Soil and can reach combined four times',()=>{const {s}=fixture();s.weatherBps=15000;s.weatherEvents=[{type:'moon',start:'2026-09-21T00:00:00Z'}];const r=rewardProjection(timeline(s,1),10000,rewardState(s));close(r.earned,units('2000')*4n/7n);});
test('no reward occurs before Genesis or after the four-year schedule, including carried budget',()=>{const {p,s}=fixture();s.start=new Date((GENESIS-DAY)*1000).toISOString();assert.equal(analyzeFarm(p,s).portfolio.daily_crop_wei,0n);s.start=new Date((GENESIS+4*YEAR)*1000).toISOString();s.carryCrop='999999999';assert.equal(analyzeFarm(p,s).horizons.find(h=>h.days===365).earned_crop_wei,0n);});
test('wallet upgrade timers use only that wallet active plots, liquid and pending once',()=>{const {p,s}=fixture();s.start='2026-10-19T00:00:00Z';p.wallets[0].crop_balance_wei=units('1000').toString();p.wallets[0].plots[0].pending_crop_wei=units('1000').toString();p.wallets.push({...p.wallets[0],id:'other',crop_balance_wei:units('1000000').toString(),plots:[plot(2,3)]});const r=analyzeFarm(p,s),one=r.upgrades.find(x=>x.plot_id===1);assert.equal(one.cost_crop_wei,units('5000'));assert.equal(one.liquid_shortfall_crop_wei,units('4000'));assert.equal(one.ready_in_days,11);assert.equal(one.claim_required,true);assert.equal(one.funding_status,'accrue_then_claim');assert.equal(r.horizons.find(h=>h.days===7).ending_crop_wei,r.portfolio.liquid_crop_wei+r.portfolio.pending_crop_wei+r.horizons[0].earned_crop_wei);});
test('pending-only readiness needs a claim while a liquid balance is immediately ready',()=>{const {p,s}=fixture();p.wallets[0].plots[0].pending_crop_wei=units('5000').toString();let r=analyzeFarm(p,s);assert.equal(r.upgrades[0].ready_in_days,0);assert.equal(r.upgrades[0].funding_status,'claim_first');p.wallets[0].crop_balance_wei=units('5000').toString();r=analyzeFarm(p,s);assert.equal(r.upgrades[0].funding_status,'ready');assert.equal(r.upgrades[0].claim_required,false);});
test('a cheaper common next step can rank above a late Golden Acre upgrade',()=>{const {p,s}=fixture();p.wallets[0].plots.push(plot(2,3,4));const r=analyzeFarm(p,s);assert.equal(r.best_upgrade.plot_id,1);assert.equal(r.upgrades.find(x=>x.plot_id===2).cost_crop_wei,units('50000'));assert.ok(r.upgrades.find(x=>x.plot_id===2).daily_gain_crop_wei>r.best_upgrade.daily_gain_crop_wei);});
test('dormant and max-level plots never get a spurious actionable upgrade date',()=>{const {p,s}=fixture();p.wallets[0].plots[0].is_active=false;p.wallets[0].plots[0].effective_weight_bps=0;p.wallets[0].plots.push(plot(2,0,5));const r=analyzeFarm(p,s);assert.equal(r.upgrades.length,1);assert.equal(r.upgrades[0].requires_planting,true);assert.equal(r.upgrades[0].ready_in_days,null);assert.equal(r.best_upgrade,null);});
test('manual partial collections and custom horizons work without inventing missing plots',()=>{const {p,s}=fixture();p.expected_total_plots=22;const before=structuredClone(p);const r=analyzeFarm(p,s,{days:60});assert.equal(r.status,'ok');assert.equal(r.horizons.find(h=>h.days===60).days,60);assert.deepEqual(p,before);assert.equal(analyzeFarm(p,s,{days:366}).status,'unavailable');});
test('100 heterogeneous plots remain bounded and support any number of configured wallets',()=>{const {p,s}=fixture();p.wallets[0].plots=Array.from({length:100},(_,i)=>plot(i+1,i%4,i%5+1));assert.equal(analyzeFarm(p,s).status,'ok');assert.equal(simulate(p,s,{days:7,policy:'hold'}).status,'ok');p.wallets[0].plots.push(plot(101));assert.match(analyzeFarm(p,s).errors.join(),/100 plots/);});
test('observed reward balances cannot be replayed at a different post-Genesis start',()=>{const {p,s}=fixture();s.rewardStateBasis='observed';s.rewardObservedAt='2026-10-01T00:00:00Z';s.start='2026-10-02T00:00:00Z';assert.match(analyzeFarm(p,s).errors.join(),/read timestamp/);s.start=s.rewardObservedAt;assert.equal(analyzeFarm(p,s).status,'ok');s.start='2026-09-21T00:00:00Z';s.rewardObservedAt='2026-09-11T00:00:00Z';assert.equal(analyzeFarm(p,s).status,'ok');});
test('first-use seed-bag quote is compared with CROP purchase value',()=>{const {p,s}=fixture();p.seed_bag_price_wei=units('0.001').toString();p.seed_bag_open=true;s.buyPrice='0.000001';const r=analyzeFarm(p,s);assert.equal(r.planting_options.quoted_crop_purchase_eth_wei,units('0.0025'));assert.equal(r.planting_options.cheaper_before_gas,'seed_bag');assert.match(r.planting_options.note,/first plantings only/);p.seed_bag_price_wei='bad';assert.equal(analyzeFarm(p,s).status,'unavailable');});
test('malformed records and blank reward assumptions return actionable errors without throwing',()=>{const {p,s}=fixture();for(const wallets of [null,{},[null],[{...p.wallets[0],plots:{}}]])assert.equal(analyzeFarm({...p,wallets},s).status,'unavailable');assert.equal(analyzeFarm(p,{...s,carryCrop:''}).status,'unavailable');assert.equal(simulate(p,{...s,granaryCrop:''}).status,'unavailable');const observed={...s,rewardStateBasis:'observed',rewardObservedAt:s.start};delete observed.carryCrop;assert.equal(analyzeFarm(p,observed).status,'unavailable');});
test('a partial RPC failure cannot silently become a complete wallet forecast',()=>{const {p,s}=fixture();p.read_errors=['Wallet enumeration failed'];assert.match(analyzeFarm(p,s).errors.join(),/Incomplete wallet read/);assert.equal(simulate(p,s,{policy:'hold'}).status,'unavailable');assert.deepEqual(validatePortfolio(p,false),[]);});
test('fundable advice measures return after the funding delay, not an immediate hypothetical upgrade',()=>{const {p,s}=fixture();s.start='2026-10-19T00:00:00Z';const early=analyzeFarm(p,s,{days:80});assert.equal(early.best_upgrade.plot_id,1);assert.equal(early.best_upgrade.ready_in_days,18);assert.ok(early.best_upgrade.net_crop_wei>0n);assert.ok(early.best_upgrade.funded_net_crop_wei<0n);assert.equal(early.next_fundable_upgrade,null);const longer=analyzeFarm(p,s,{days:100});assert.equal(longer.next_fundable_upgrade.plot_id,1);assert.ok(longer.next_fundable_upgrade.funded_net_crop_wei>0n);});
test('all dormant holdings preserve balances, produce zero yield, and keep unused release in carry',()=>{const {p,s}=fixture();p.wallets[0].crop_balance_wei=units('12').toString();p.wallets[0].plots[0].is_active=false;p.wallets[0].plots[0].effective_weight_bps=0;p.wallets[0].plots[0].pending_crop_wei=units('3').toString();const r=analyzeFarm(p,s,{days:7});assert.equal(r.portfolio.daily_crop_wei,0n);assert.equal(r.horizons.find(h=>h.days===7).ending_crop_wei,units('15'));assert.equal(r.ending_carry_crop_wei,emissionBetween(GENESIS,GENESIS+7*DAY));assert.equal(r.ending_granary_crop_wei,units('40000000'));assert.equal(r.next_fundable_upgrade,null);});

test('closed or unknown seed bag availability never recommends a native planting purchase',()=>{const {p,s}=fixture();p.seed_bag_price_wei=units('0.001').toString();s.buyPrice='0.000001';for(const open of [null,false]){p.seed_bag_open=open;assert.equal(analyzeFarm(p,s).planting_options.cheaper_before_gas,null);}p.seed_bag_open='false';assert.equal(analyzeFarm(p,s).status,'unavailable');delete p.seed_bag_open;p.observed_at_utc='invalid';assert.equal(analyzeFarm(p,s).status,'unavailable');});

test('cumulative routes rank whole-term net CROP and expose a profitable repeat path during the assumed Sunny founding period',()=>{
  const {p,s}=fixture();
  const plot=p.wallets[0].plots[0];plot.rarity_tier=3;plot.effective_weight_bps=weight(3,1);
  p.wallets[0].crop_balance_wei='0';p.wallets[0].eth_balance_wei=units('1').toString();
  Object.assign(s,{start:'2026-09-21T00:00:00Z',externalWeight:'0',weatherBps:12000,useKnownWeather:true,
    weatherWeeks:[{epoch:0,multiplier_bps:12000}],buyPrice:'0.000001'});
  const r=analyzeFarm(p,s,{days:60});
  assert.equal(r.status,'ok');
  assert.equal(timeline(s,1)[0].segments[0].multiplier_bps,24000);
  assert.deepEqual(r.upgrades.map(row=>[row.from_level,row.to_level]),[[1,2]]);
  const next=r.upgrade_paths.find(row=>row.to_level===2),route=r.upgrade_paths.find(row=>row.to_level===5);
  assert.equal(r.best_upgrade_path.to_level,5); // A longer route can win on total term net CROP.
  assert.deepEqual(r.upgrade_paths.map(row=>row.to_level),[5,4,3,2]);
  assert.equal(next.cost_crop_wei,units('5000'));
  assert.equal(route.cost_crop_wei,units('85000'));
  assert.deepEqual(route.steps.map(step=>[step.from_level,step.to_level,step.cost_crop_wei]),[
    [1,2,units('5000')],[2,3,units('10000')],[3,4,units('20000')],[4,5,units('50000')]
  ]);
  assert.ok(route.net_crop_wei>0n);
  assert.ok(route.net_crop_wei>next.net_crop_wei); // More total return, with a larger cumulative burn.
  assert.equal(route.buy_shortfall_after_claim_crop_wei,units('85000'));
  assert.equal(route.quoted_buy_price_eth_wei,units('0.000001'));
  assert.equal(route.quoted_buy_capital_eth_wei,units('0.085'));
  assert.match(route.buy_capital_basis,/scenario buy price/);
  const unpriced=analyzeFarm(p,{...s,buyPrice:''},{days:60}).upgrade_paths.find(row=>row.to_level===5);
  assert.equal(unpriced.buy_shortfall_after_claim_crop_wei,units('85000'));
  assert.equal(unpriced.quoted_buy_price_eth_wei,null);
  assert.equal(unpriced.quoted_buy_capital_eth_wei,null);
});

test('cumulative route funding stays in its own wallet and quotes only the after-claim shortfall',()=>{
  const {p,s}=fixture();
  const w=p.wallets[0];w.crop_balance_wei=units('500').toString();w.plots[0].pending_crop_wei=units('1000').toString();
  Object.assign(s,{buyPrice:'0.000002'});
  const other={...w,id:'other',label:'Other wallet',crop_balance_wei:units('1000000').toString(),plots:[]};
  p.wallets.push(other);
  const rich=analyzeFarm(p,s,{days:90}).upgrade_paths.find(row=>row.wallet_id===w.id&&row.to_level===3);
  const poorer=structuredClone(p);poorer.wallets[1].crop_balance_wei='0';
  const isolated=analyzeFarm(poorer,s,{days:90}).upgrade_paths.find(row=>row.wallet_id===w.id&&row.to_level===3);
  assert.deepEqual(rich.steps.map(step=>step.cost_crop_wei),[units('5000'),units('10000')]);
  assert.equal(rich.cost_crop_wei,units('15000'));
  assert.equal(rich.liquid_shortfall_crop_wei,units('14500'));
  assert.equal(rich.buy_shortfall_after_claim_crop_wei,units('13500'));
  assert.equal(rich.quoted_buy_capital_eth_wei,units('0.027'));
  assert.equal(rich.claim_required,true);
  assert.equal(rich.ready_in_days,isolated.ready_in_days);
  assert.equal(rich.funded_net_crop_wei,isolated.funded_net_crop_wei);
});

test('dormant plots have cost references only and max-level plots have no route',()=>{
  const {p,s}=fixture();
  const dormant=plot(1,3,1);dormant.is_active=false;dormant.effective_weight_bps=0;
  p.wallets[0].plots=[dormant,plot(2,0,5)];
  const r=analyzeFarm(p,s,{days:90});
  assert.equal(r.upgrade_paths.length,4);
  assert.deepEqual(r.upgrade_paths.map(row=>row.to_level),[2,3,4,5]);
  assert.ok(r.upgrade_paths.every(row=>row.requires_planting&&row.funding_status==='plant_first'&&row.ready_in_days===null&&row.net_crop_wei===null&&row.funded_net_crop_wei===null));
  assert.ok(r.upgrade_paths.every(row=>row.buy_shortfall_after_claim_crop_wei===null&&row.quoted_buy_capital_eth_wei===null));
  assert.equal(r.upgrades.length,1);
  assert.equal(r.upgrades[0].plot_id,1);
  assert.equal(r.best_upgrade_path,null);
  assert.equal(r.next_fundable_path,null);
});
