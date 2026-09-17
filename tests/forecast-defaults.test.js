import test from 'node:test';
import assert from 'node:assert/strict';
import { forecastDefaults, forecastManualFields, fullSupplyCompetition } from '../src/forecast-defaults.js';
import { emptyPortfolio, rules, units, validateScenario, weight } from '../src/model.js';
import launchWeather from '../knowledge/launch-weather.json' with { type: 'json' };

const GENESIS=rules.schedule.genesis_timestamp*1000, BEFORE=GENESIS-86400000, AFTER=GENESIS+86400000;
function farm(watched=false) {
  const p=emptyPortfolio(),w=p.wallets[0];
  if(watched)w.address='0x1111111111111111111111111111111111111111';
  w.plots=[{token_id:1,rarity_tier:3,level:5,is_active:true,effective_weight_bps:weight(3,5),pending_crop_wei:'0',modifiers:[]}];
  w.expected_plot_count=1;p.expected_total_plots=1;
  return p;
}
function observation(now=AFTER,extra={}) {
  return {schema_version:1,chain_id:4663,observed_at_utc:new Date(now).toISOString(),block_timestamp:now/1000,
    block_number:100,genesis_timestamp:GENESIS/1000,current_epoch:0,weather_enum:1,effective_multiplier_bps:20000,
    total_weight_bps:20000000,carry_crop_wei:units('123').toString(),granary_crop_wei:units('456').toString(),
    seed_bag_price_wei:units('0.001').toString(),moon_starts:[],read_errors:[],...extra};
}

test('offline launch defaults use an own-weight rate scenario and retain explicit full-supply helper',()=>{
  const p=farm();p.wallets[0].plots.push({token_id:2,rarity_tier:2,level:3,is_active:false,effective_weight_bps:0});
  const result=forecastDefaults(p,{now:BEFORE});
  assert.equal(fullSupplyCompetition(p),'3610');
  assert.equal(result.scenario.externalWeight,'0');
  assert.equal(result.sources.externalWeight,'Your weight determines the nominal rate. No additional valley weight assumed; ceilings and Granary still apply.');
  assert.equal(result.scenario.start,new Date(GENESIS).toISOString());
  assert.equal(result.scenario.carryCrop,'0');assert.equal(result.scenario.granaryCrop,'40000000');
  assert.equal(result.scenario.weatherBps,10000);assert.equal(result.scenario.annualGrowthPct,'0');
  assert.equal(result.scenario.useKnownWeather,true);
  assert.deepEqual(result.scenario.weatherWeeks.map(w=>[w.epoch,w.multiplier_bps]),[[0,12000]]);
  assert.equal(result.scenario.weatherBasis,'cached');
  assert.equal(result.scenario.weatherObservedAt,launchWeather.observed_at_utc);
  assert.equal(result.scenario.buyPrice,'0.0000004');assert.equal(result.scenario.sellPrice,'0.0000004');
  assert.match(result.sources.prices,/not a market price/);assert.deepEqual(validateScenario(result.scenario),[]);
});
test('post-launch offline defaults never restore the original Granary as a current balance',()=>{
  const result=forecastDefaults(farm(),{now:AFTER});
  assert.equal(result.scenario.granaryCrop,'0');assert.equal(result.scenario.carryCrop,'0');
  assert.equal(result.scenario.rewardStateBasis,'assumption');assert.deepEqual(validateScenario(result.scenario),[]);
});
test('pre-launch observed zero weight does not force a full-collection launch model',()=>{
  const result=forecastDefaults(farm(),{now:BEFORE,season:observation(BEFORE,{total_weight_bps:0})});
  assert.equal(result.basis,'chain');assert.equal(result.scenario.externalWeight,'0');
  assert.equal(result.scenario.start,new Date(GENESIS).toISOString());
  assert.equal(result.scenario.weatherBps,10000);
  assert.deepEqual(result.scenario.weatherWeeks.map(w=>[w.epoch,w.multiplier_bps]),[[0,12000]]);
  assert.equal(result.scenario.rewardStateBasis,'observed');assert.deepEqual(validateScenario(result.scenario),[]);
});
test('post-launch observed weight excludes only watched plots, not hypothetical models',()=>{
  const season=observation();
  assert.equal(forecastDefaults(farm(),{now:AFTER,season}).scenario.externalWeight,'2000');
  const watched=farm(true);
  const estimated=forecastDefaults(watched,{now:AFTER,season});
  assert.equal(estimated.scenario.externalWeight,'1994');assert.match(estimated.sources.externalWeight,/saved watched-farm weight estimate/);
  watched.block_number=100;
  assert.match(forecastDefaults(watched,{now:AFTER,season}).sources.externalWeight,/same block/);
});
test('current zero network weight and zero reserves remain genuine observed zeros after launch',()=>{
  const result=forecastDefaults(farm(),{now:AFTER,season:observation(AFTER,{total_weight_bps:0,carry_crop_wei:'0',granary_crop_wei:'0'})});
  assert.equal(result.scenario.externalWeight,'0');assert.equal(result.scenario.granaryCrop,'0');
  assert.equal(result.scenario.rewardStateBasis,'observed');
});
test('reserves use block time together and never mix a missing stock with another observed stock',()=>{
  const now=AFTER+15000,season=observation(AFTER);
  const result=forecastDefaults(farm(),{now,season});
  assert.equal(result.scenario.rewardObservedAt,new Date(AFTER).toISOString());
  assert.equal(result.scenario.start,new Date(AFTER).toISOString());
  assert.equal(result.scenario.carryCrop,'123');assert.equal(result.scenario.granaryCrop,'456');
  const partial=forecastDefaults(farm(),{now,season:{...season,granary_crop_wei:null,read_errors:['granary unavailable']}});
  assert.equal(partial.scenario.carryCrop,'0');assert.equal(partial.scenario.granaryCrop,'0');
  assert.equal(partial.scenario.rewardStateBasis,'assumption');assert.equal(partial.partial,true);
});
test('missing weather and weight retain honest ordinary and own-weight defaults',()=>{
  const result=forecastDefaults(farm(),{now:AFTER,season:observation(AFTER,{weather_enum:null,total_weight_bps:null})});
  assert.equal(result.scenario.weatherBps,10000);assert.equal(result.scenario.externalWeight,'0');
});
test('stale, malformed, future-dated and conflicting deployment observations use fallback inputs',()=>{
  for(const season of [observation(AFTER-301000),observation(AFTER+31000),observation(AFTER,{genesis_timestamp:1}),observation(AFTER,{chain_id:1}),{}]){
    const result=forecastDefaults(farm(),{now:AFTER,season});
    assert.equal(result.basis,'fallback');assert.equal(result.scenario.rewardStateBasis,'assumption');
    assert.equal(result.scenario.externalWeight,'0');assert.equal(result.scenario.weatherBps,10000);
  }
});
test('price references must be positive and belong to the same fresh block',()=>{
  const market={status:'ok',block_number:100,buy_price_wei:units('0.000002').toString(),sell_price_wei:units('0.000001').toString()};
  const result=forecastDefaults(farm(),{now:AFTER,season:observation(),market});
  assert.equal(result.scenario.buyPrice,'0.000002');assert.equal(result.scenario.sellPrice,'0.000001');
  assert.equal(result.priceBasis,'pool reference');
  for(const invalid of [{...market,block_number:99},{...market,sell_price_wei:'0'},{status:'unavailable'},null]){
    const fallback=forecastDefaults(farm(),{now:AFTER,season:observation(),market:invalid});
    assert.equal(fallback.scenario.buyPrice,'0.0000004');assert.equal(fallback.priceBasis,'planting-cost estimate');
  }
});
test('legacy custom fields are preserved and imported field preferences are bounded',()=>{
  assert.deepEqual(forecastManualFields(undefined,{externalWeight:'12',weatherBps:10000,buyPrice:''}),['externalWeight','weatherBps']);
  assert.deepEqual(forecastManualFields(['buyPrice','buyPrice']),['buyPrice']);
  assert.deepEqual(forecastManualFields(undefined,{weatherBps:8000,useKnownWeather:false}),['weatherBps','useKnownWeather']);
  assert.throws(()=>forecastManualFields(['untrustedField']));assert.throws(()=>forecastManualFields('all'));
});

function schedule(now=BEFORE,extra={}) {
  return {status:'ok',chain_id:4663,block_number:100,block_timestamp:now/1000,
    observed_at_utc:new Date(now).toISOString(),genesis_timestamp:GENESIS/1000,
    commit_hash:launchWeather.commit_hash,weeks:[{epoch:0,multiplier_bps:15000},{epoch:1,multiplier_bps:5000}],...extra};
}

test('fresh matching weather replaces the entire dated cache without changing the unknown-week assumption',()=>{
  const weather=schedule(),result=forecastDefaults(farm(),{now:BEFORE,season:observation(BEFORE,{weather_schedule:weather})});
  assert.equal(result.scenario.weatherBps,10000);
  assert.equal(result.scenario.useKnownWeather,true);
  assert.equal(result.scenario.weatherBasis,'chain');
  assert.equal(result.scenario.weatherObservedAt,weather.observed_at_utc);
  assert.deepEqual(result.scenario.weatherWeeks,weather.weeks);
  assert.notEqual(result.scenario.weatherWeeks,weather.weeks);
  const empty=forecastDefaults(farm(),{now:BEFORE,season:observation(BEFORE,{weather_schedule:schedule(BEFORE,{weeks:[]})})});
  assert.deepEqual(empty.scenario.weatherWeeks,[]);
  assert.equal(empty.scenario.weatherBasis,'chain');
});

test('unavailable or differently pinned schedules retain explicitly dated fallback weather',()=>{
  for(const weather of [schedule(BEFORE,{block_number:99}),schedule(BEFORE,{block_timestamp:BEFORE/1000-1}),
    schedule(BEFORE,{status:'unavailable',weeks:[],error:'RPC failed'})]){
    const result=forecastDefaults(farm(),{now:BEFORE,season:observation(BEFORE,{weather_schedule:weather})});
    assert.equal(result.scenario.weatherBasis,'cached');
    assert.equal(result.scenario.weatherBps,10000);
    assert.deepEqual(result.scenario.weatherWeeks,launchWeather.weeks);
    assert.equal(result.scenario.weatherObservedAt,launchWeather.observed_at_utc);
  }
});
