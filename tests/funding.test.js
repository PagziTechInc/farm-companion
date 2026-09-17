import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPortfolio, defaults, units } from '../src/model.js';
import { fundingAdvice, fundingDefaults, readEthQuote, PRICE_URL } from '../src/funding.js';

function fixture() {
  const p=emptyPortfolio();p.wallets=[p.wallets[0],{...structuredClone(p.wallets[0]),id:'wallet_b',label:'Wallet B'}];p.wallets.forEach(w=>w.expected_plot_count=11);const now=Date.parse('2026-09-07T12:00:00Z');p.observed_at_utc=new Date(now).toISOString();
  p.wallets.forEach(w=>{w.eth_balance_wei=units('0.05').toString();w.crop_balance_wei='0';});
  return {p,now,q:{eth_usd:'2500',observed_at_utc:p.observed_at_utc,url:PRICE_URL}};
}
test('USD target and mint coverage do not falsely establish planting readiness',()=>{
  const {p,now,q}=fixture(),r=fundingAdvice(p,fundingDefaults(),q,defaults(),now);
  assert.equal(r.all_targets_met,true);assert.equal(r.wallets[0].usd,125);
  assert.equal(r.wallets[0].mint_wei,units('0.022'));assert.equal(r.wallets[0].crop_gap_wei,units('27500'));
  assert.equal(r.wallets[0].after_reserve_wei,null);
  assert.ok(r.actions.some(a=>a.title.includes('reserve')));assert.ok(r.actions.some(a=>a.title.includes('CROP')));
  assert.equal(r.actions.filter(a=>a.kind==='action').length,0);
});
test('funding shortfalls and chosen reserves are evaluated independently per wallet',()=>{
  const {p,now,q}=fixture();p.wallets[1].eth_balance_wei=units('0.02').toString();
  const r=fundingAdvice(p,{targetUsd:'100',reserveEth:'0.04'},q,defaults(),now);
  assert.equal(r.wallets[1].target_met,false);assert.equal(r.all_targets_met,false);
  assert.ok(r.actions.some(a=>a.title.includes('Wallet B: mint funding')));
  assert.ok(r.actions.some(a=>a.title.includes('Wallet A: chosen fee reserve')));
});
test('stale balances and prices disable positive funding confirmations',()=>{
  const {p,now,q}=fixture();const r=fundingAdvice(p,fundingDefaults(),q,defaults(),now+16*60000);
  assert.equal(r.wallets[0].usd,null);assert.equal(r.wallets[0].target_met,null);
  assert.equal(r.all_targets_met,false);assert.equal(r.balances_fresh,false);
});
test('price adapter rejects the wrong asset and invalid amounts',async()=>{
  await assert.rejects(readEthQuote(async()=>({data:{base:'BTC',currency:'USD',amount:'100'}})),/unexpected/);
  await assert.rejects(readEthQuote(async()=>({data:{base:'ETH',currency:'USD',amount:'NaN'}})),/Invalid/);
});
