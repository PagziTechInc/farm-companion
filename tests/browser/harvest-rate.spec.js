import { automaticForecast } from '../../src/automatic-forecast.js';
import { test, expect } from '@playwright/test';
import { defaults, emptyPortfolio, rules, weight } from '../../src/model.js';
import { FORECAST_FIELDS, fullSupplyCompetition } from '../../src/forecast-defaults.js';
import { openForecastSettings, openUtility } from './navigation.js';

const KEY='yield-farm-public-v2';
function workspace() {
  const portfolio=emptyPortfolio();
  portfolio.expected_total_plots=1;
  portfolio.wallets[0].plots=[{token_id:1,rarity_tier:0,level:1,is_active:true,
    effective_weight_bps:weight(0,1),pending_crop_wei:'0',modifiers:[],reveal_status:'hypothetical',evidence_source:'manual-hypothesis'}];
  return {schema_version:2,portfolio,scenario:{...defaults(),weatherBps:12000},days:7,
    forecastManual:[...FORECAST_FIELDS],saved_at:'2026-09-15T12:00:00Z'};
}
async function load(page,state) {
  await page.route('https://robinhood-rpc.publicnode.com/**',route=>route.abort());
  await page.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:KEY,value:state});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Your plots',exact:true})).toBeVisible();
}
async function forecast(page) {
  await page.getByRole('tab',{name:'Yield forecast',exact:true}).click();
  await openForecastSettings(page);
  await expect(page.locator('#forecast-source')).not.toContainText('Checking');
  await page.getByRole('button',{name:'Calculate forecast',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Harvest without reinvesting',exact:true})).toBeVisible();
}
async function limits(page) {
  await openForecastSettings(page);
  const details=page.locator('#harvest-limits');
  if(await details.getAttribute('open')===null)await details.locator('summary').click();
}
async function downloadText(page,selector) {
  const pending=page.waitForEvent('download');
  await page.locator(selector).click();
  const stream=await (await pending).createReadStream(),chunks=[];
  for await(const chunk of stream)chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

test('own rate works with no valley input and remains nominal when funding limits bind',async({page})=>{
  const state=workspace();delete state.scenario.externalWeight;
  await load(page,state);
  await page.getByRole('tab',{name:'Yield forecast',exact:true}).click();
  await expect(page.locator('#harvest-limits')).not.toHaveAttribute('open','');
  await forecast(page);
  const rate=page.getByRole('region',{name:'Your harvest rate',exact:true});
  await expect(rate).toContainText('4,800');
  await expect(rate.locator('.harvest-rate-formula')).toContainText('weather');
  await expect(rate.locator('.harvest-rate-formula')).toContainText('First Soil');
  await expect(page.locator('.harvest-limit-notice')).toHaveCount(0);
  await limits(page);
  await page.getByLabel('Additional valley weight (optional)',{exact:true}).fill('100000');
  await page.getByRole('button',{name:'Calculate forecast',exact:true}).click();
  await expect(rate).toContainText('4,800');
  await expect(rate.locator('.harvest-limit-notice')).toContainText('annual release and carry ceiling');
  await limits(page);
  await page.getByLabel('Additional valley weight (optional)',{exact:true}).fill('');
  await page.getByLabel('Granary available (CROP)',{exact:true}).fill('0');
  await page.getByRole('button',{name:'Calculate forecast',exact:true}).click();
  await expect(rate).toContainText('4,800');
  await expect(rate.locator('.harvest-limit-notice')).toContainText('finite Granary');
  await expect(rate.locator('.harvest-limit-notice')).not.toContainText('annual release and carry ceiling');
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).scenario.externalWeight,KEY)).toBe('0');
  const csv=await downloadText(page,'#export-csv');
  const rows=csv.trim().split('\r\n').map(line=>line.slice(1,-1).split('\",\"'));
  const headers=rows.shift(),records=rows.map(row=>Object.fromEntries(headers.map((key,i)=>[key,row[i]])));
  const first=records.find(row=>row.days==='7'),month=records.find(row=>row.days==='30');
  expect(first.nominal_weekly_crop).toBe('4800');
  expect(first.rate_at_utc).toBe('2026-09-21T00:00:00.000Z');
  expect(first.base_limited).toBe('false');expect(first.bonus_limited).toBe('true');
  expect(Number(first.projected_crop)).toBeCloseTo(2000,8);
  expect(Number(month.nominal_crop)).toBeGreaterThan(Number(first.nominal_crop));
  expect(Number(month.projected_crop)).toBeGreaterThan(Number(first.projected_crop));
});

for(const {name,change,migrates} of [
  {name:'automatic pre-launch default',change:()=>{},migrates:true},
  {name:'manual valley weight',change:s=>s.forecastManual=['externalWeight']},
  {name:'ambiguous legacy preferences',change:s=>delete s.forecastManual},
  {name:'a current defaults marker',change:s=>s.forecastDefaultsVersion=2},
  {name:'custom valley path',change:s=>s.scenario.externalWeightPath=[{day:0,weight_bps:123000}]},
  {name:'manual reserve timing',change:s=>s.forecastManual=['start']},
  {name:'an observation exactly at Genesis',change:s=>{s.saved_at=null;s.portfolio.observed_at_utc=rules.schedule.genesis_utc;}},
])test(`saved farms migrate only proven automatic defaults: ${name}`,async({page})=>{
  const state=workspace();state.forecastManual=[];
  state.scenario.externalWeight=fullSupplyCompetition(state.portfolio);change(state);
  await load(page,state);await openUtility(page,'files');
  const exported=JSON.parse(await downloadText(page,'#export-workspace'));
  expect(exported.forecastDefaultsVersion).toBe(2);
  expect(exported.scenario.externalWeight).toBe(migrates?automaticForecast(state.portfolio).scenario.externalWeight:state.scenario.externalWeight);
  expect(exported.portfolio).toEqual(state.portfolio);
});

test('workspace imports reject invalid supplied valley weight',async({page})=>{
  const state=workspace();await load(page,state);await openUtility(page,'files');
  const invalid=structuredClone(state);invalid.scenario.externalWeight='-1';
  await page.locator('#import-file').setInputFiles({name:'invalid-farm.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});
  await expect(page.getByText('externalWeight must be an explicit nonnegative assumption.',{exact:false})).toBeVisible();
  const exported=JSON.parse(await downloadText(page,'#export-workspace'));
  expect(exported.scenario.externalWeight).toBe('0');
});

test('large own-weight rates fit a phone viewport',async({page})=>{
  await page.setViewportSize({width:375,height:812});
  const state=workspace();state.portfolio.expected_total_plots=100;
  state.portfolio.wallets[0].plots=Array.from({length:100},(_,i)=>({...state.portfolio.wallets[0].plots[0],token_id:i+1,rarity_tier:3,level:5,effective_weight_bps:weight(3,5)}));
  await load(page,state);await forecast(page);
  const rate=page.getByRole('region',{name:'Your harvest rate',exact:true});
  await rate.scrollIntoViewIfNeeded();
  await page.screenshot({path:'.local-deploy/screenshots/rate-mobile-large.png'});
  expect(await rate.locator('.harvest-rate-values strong').evaluateAll(nodes=>nodes.every(node=>node.scrollWidth<=node.clientWidth+1))).toBe(true);
});
