import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPortfolio, defaults, units, weight } from '../src/model.js';
import { simulate, compare } from '../src/engine.js';
const NOW=Date.parse('2026-10-01T12:00:00Z'),DAY=86400000;
function fixture(level=5){
  const portfolio=emptyPortfolio(),wallet=portfolio.wallets[0];
  wallet.crop_balance_wei='0';wallet.eth_balance_wei=units('10').toString();wallet.expected_plot_count=1;
  wallet.plots=[{token_id:1,rarity_tier:0,level,is_active:true,effective_weight_bps:weight(0,level),pending_crop_wei:units('100').toString(),modifiers:[]}];
  portfolio.expected_total_plots=1;
  const scenario={...defaults(),start:new Date(NOW).toISOString(),externalWeight:'4000',feeMode:'zero',claimEveryDays:7,claimClock:{[wallet.id]:new Date(NOW).toISOString()}};
  return {portfolio,scenario,id:wallet.id};
}
test('refreshing the scenario does not restart an overdue wallet claim interval',()=>{
  const {portfolio,scenario,id}=fixture();
  const before=structuredClone({portfolio,scenario});
  const initial=simulate(portfolio,scenario,{days:8,policy:'baseline'});
  assert.equal(initial.status,'ok');assert.equal(initial.actions[0].day,7);assert.equal(initial.actions[0].due_at_utc,new Date(NOW+7*DAY).toISOString());
  const rebased=simulate(portfolio,{...scenario,start:new Date(NOW+7*DAY).toISOString()},{days:1,policy:'baseline'});
  assert.equal(rebased.actions[0].type,'claim');assert.equal(rebased.actions[0].wallet_id,id);assert.equal(rebased.actions[0].day,0);
  assert.equal(rebased.actions[0].due_at_utc,new Date(NOW+7*DAY).toISOString());assert.deepEqual({portfolio,scenario},before);
});
test('a confirmed-claim anchor prevents immediate repeat claims and clock mode does not force early terminal claims',()=>{
  const {portfolio,scenario}=fixture();
  const result=simulate(portfolio,scenario,{days:3,policy:'baseline'});
  assert.equal(result.status,'ok');assert.equal(result.actions.length,0);assert.equal(result.gas_eth_wei,0n);
  const legacy={...scenario};delete legacy.claimClock;
  const old=simulate(portfolio,legacy,{days:3,policy:'baseline'});
  assert.equal(old.actions.at(-1).day,3);assert.equal(old.actions.at(-1).type,'claim');
});
test('funding claims reset the simulated wallet clock and do not create a second scheduled claim on that day',()=>{
  const {portfolio,scenario,id}=fixture(1);portfolio.wallets[0].plots[0].pending_crop_wei=units('5000').toString();
  scenario.includeOpeningCrop=true;scenario.externalWeight='1000';scenario.claimClock[id]=new Date(NOW-7*DAY).toISOString();
  const result=simulate(portfolio,scenario,{days:90,policy:'efficiency'});
  assert.equal(result.status,'ok');assert.equal(result.actions.filter(a=>a.type==='claim'&&a.day===0).length,1);
  assert.ok(result.actions.some(a=>a.type==='upgrade'&&a.day===0));
  assert.equal(result.actions.find(a=>a.type==='claim'&&a.day>0).day,7);
});
test('an unaffordable overdue claim leaves wallet balances and pending rewards intact',()=>{
  const {portfolio,scenario,id}=fixture();portfolio.wallets[0].eth_balance_wei='0';
  Object.assign(scenario,{feeMode:'estimated',claimFee:'0.01',upgradeFee:'0',plantFee:'0',buyFee:'0',transferFee:'0',nftTransferFee:'0'});
  scenario.claimClock[id]=new Date(NOW-7*DAY).toISOString();
  const result=simulate(portfolio,scenario,{days:1,policy:'baseline'});
  assert.equal(result.status,'ok');assert.equal(result.actions.length,0);assert.equal(result.gas_eth_wei,0n);
  assert.match(result.blocked.join(' '),/lacks ETH/);assert.equal(result.ending_crop_wei,units('100')+result.earned_crop_wei);
});
test('equal CROP returns choose holding instead of fee-bearing or unnecessary no-upgrade claims',()=>{
  const {portfolio,scenario}=fixture();delete scenario.claimClock;
  for(const mode of ['zero','estimated']){
    Object.assign(scenario,{feeMode:mode,claimFee:'0.01',upgradeFee:'0',plantFee:'0',buyFee:'0',transferFee:'0',nftTransferFee:'0'});
    const result=compare(portfolio,scenario,[30])[0];
    assert.equal(result.status,'ok');assert.equal(result.baseline.net_crop_wei,result.hold.net_crop_wei);
    assert.ok(result.baseline.actions.length>0);assert.equal(result.bestCrop.policy,'hold');assert.equal(result.bestCrop.actions.length,0);
  }
});
test('malformed claim clocks fail the calculation before producing a ledger',()=>{
  const {portfolio,scenario,id}=fixture();
  for(const clock of [[],{[id]:'not a timestamp'}]){
    const result=simulate(portfolio,{...scenario,claimClock:clock},{days:1,policy:'baseline'});
    assert.equal(result.status,'unavailable');assert.match(result.errors.join(' '),/clock/i);assert.equal(result.actions,undefined);
  }
});
