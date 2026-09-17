import {test, expect} from '@playwright/test';
import {emptyPortfolio, defaults, units, weight} from '../../src/model.js';
import {openAddPlots, openForecastSettings, openForecastView, openPlotFilters, openUtility, openWallets} from './navigation.js';

const STORAGE='yield-farm-public-v2';
function workspace() {
  const portfolio=emptyPortfolio();
  const plot=id=>({token_id:id,rarity_tier:0,level:1,is_active:true,effective_weight_bps:weight(0,1),pending_crop_wei:units('1000').toString(),modifiers:[],reveal_status:'hypothetical'});
  portfolio.wallets[0]={...portfolio.wallets[0],id:'alpha',label:'Alpha',crop_balance_wei:units('1000').toString(),expected_plot_count:1,plots:[plot(1)]};
  portfolio.wallets.push({...portfolio.wallets[0],id:'beta',label:'Beta',crop_balance_wei:units('12000').toString(),plots:[plot(2)]});
  portfolio.expected_total_plots=2;
  return {schema_version:2,portfolio,scenario:{...defaults(),start:'2026-10-19T00:00:00Z',externalWeight:'0'},days:30,companion:{scene:'journal',goal_crop:'5000',goal_wallet_id:'alpha',pinned_plot_id:null}};
}
async function openFarm(page) {
  await page.addInitScript(({key,state})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(state));},{key:STORAGE,state:workspace()});
  await page.goto('/');
}
async function saved(page) {return page.evaluate(key=>JSON.parse(localStorage.getItem(key)),STORAGE);}
async function forecast(page) {
  await page.getByRole('tab',{name:'Yield forecast',exact:true}).click();
  await openForecastSettings(page);
  await page.getByRole('button',{name:'Calculate forecast',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Harvest without reinvesting',exact:true})).toBeVisible();
}
async function farm(page) {await page.getByRole('tab',{name:'My farm',exact:true}).click();}
async function editPlot(page,id) {
  await page.locator('.plot-card').filter({has:page.getByRole('button',{name:`Plan plot #${id}`,exact:true})}).getByRole('button',{name:'Edit',exact:true}).click();
}
async function notes(page) {await openUtility(page,'files');}

test('a pinned model target follows renumbering, wallet moves and its new upgrade cost',async({page})=>{
  await openFarm(page);await forecast(page);await farm(page);
  await page.getByRole('button',{name:'Plan plot #1',exact:true}).click();await farm(page);await editPlot(page,1);
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Plot ID',{exact:true}).fill('331');
  await dialog.getByRole('combobox',{name:'Model wallet',exact:true}).selectOption('beta');
  await dialog.getByRole('combobox',{name:'Level',exact:true}).selectOption('2');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  expect((await saved(page)).companion).toMatchObject({pinned_plot_id:331,goal_wallet_id:'beta',goal_crop:'10000'});
  await forecast(page);await page.getByRole('tab',{name:'Upgrade planner',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Target plot',exact:true})).toHaveValue('331');
  await expect(page.getByRole('combobox',{name:'Goal wallet',exact:true})).toHaveValue('beta');
  await expect(page.getByLabel('Target total CROP',{exact:true})).toHaveValue('10000');
});

test('removing a pinned plot clears the target before its ID can be reused',async({page})=>{
  await openFarm(page);await forecast(page);await farm(page);
  await page.getByRole('button',{name:'Plan plot #1',exact:true}).click();await farm(page);await editPlot(page,1);
  await page.getByRole('dialog').getByRole('button',{name:'Remove plot',exact:true}).click();
  expect((await saved(page)).companion.pinned_plot_id).toBeNull();
  await forecast(page);await page.getByRole('tab',{name:'Upgrade planner',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Target plot',exact:true})).toHaveValue('');
});

test('importing a different farm clears inventory filters so its plots are visible',async({page})=>{
  await openFarm(page);
  await page.getByLabel('Find plots',{exact:true}).fill('331');
  await openPlotFilters(page);
  await page.getByRole('combobox',{name:'Filter wallet',exact:true}).selectOption('alpha');
  await page.getByRole('combobox',{name:'Plot state',exact:true}).selectOption('dormant');
  await page.getByRole('button',{name:'Apply filters',exact:true}).click();
  await expect(page.locator('.plot-card')).toHaveCount(0);
  await notes(page);
  await page.locator('#import-file').setInputFiles({name:'farm.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(workspace()))});
  await expect(page.getByRole('status')).toContainText('Farm imported');
  await page.getByRole('tab',{name:'My farm',exact:true}).click();
  await expect(page.locator('.plot-card')).toHaveCount(2);
  await openPlotFilters(page);
  await expect(page.getByLabel('Find plots',{exact:true})).toHaveValue('');
  await expect(page.getByRole('combobox',{name:'Filter wallet',exact:true})).toHaveValue('');
  await expect(page.getByRole('combobox',{name:'Plot state',exact:true})).toHaveValue('');
});

test('resetting a filtered farm gives a newly added farm a clear inventory view',async({page})=>{
  await openFarm(page);
  await page.getByLabel('Find plots',{exact:true}).fill('no match');
  await page.getByRole('button',{name:'Apply filters',exact:true}).click();await notes(page);
  await page.getByRole('button',{name:'Reset this browser’s farm',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Confirm removal',exact:true}).click();
  await openAddPlots(page);
  await page.getByRole('button',{name:'Add model plots',exact:true}).click();
  await expect(page.locator('.plot-card')).toHaveCount(1);
  await expect(page.getByLabel('Find plots',{exact:true})).toHaveValue('');
  const state=await saved(page);expect(state.portfolio.wallets.flatMap(w=>w.plots)).toHaveLength(1);
  expect(state.companion.pinned_plot_id).toBeNull();
});

test('model dialogs trap focus and return it to the launch button when cancelled',async({page})=>{
  await openFarm(page);await openWallets(page);const launch=page.getByRole('button',{name:'Edit model balances',exact:true}).first();
  await launch.click();const dialog=page.getByRole('dialog');
  await expect(dialog.getByLabel('Wallet label',{exact:true})).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
  await page.keyboard.press('Tab');await expect(dialog.getByLabel('Wallet label',{exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(launch).toBeFocused();
  await page.keyboard.press('Enter');await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(launch).toBeFocused();
});

test('invalid CROP goals and imports preserve valid holdings, goals and the harvest',async({page})=>{
  await openFarm(page);await forecast(page);
  const before=await saved(page),harvest=await page.locator('.forecast-value').textContent();
  await openForecastView(page,'goal');
  await page.getByLabel('Target total CROP',{exact:true}).fill('0');
  await page.getByRole('button',{name:'Track goal',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('CROP goal must be a positive token amount');
  expect(await saved(page)).toEqual(before);
  const target=page.getByLabel('Target total CROP',{exact:true});
  await expect(target).toHaveValue('0');
  await target.fill('5000');await page.getByRole('button',{name:'Track goal',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const recovered=await saved(page);
  expect(recovered.portfolio).toEqual(before.portfolio);expect(recovered.scenario).toEqual(before.scenario);
  expect(recovered.companion).toEqual(before.companion);expect(recovered.companion.goal_crop).toBe('5000');
  const recoveryBaseline=await saved(page);
  await openForecastView(page,'harvest');
  await expect(page.locator('.forecast-value')).toHaveText(harvest);
  await notes(page);
  await page.locator('#import-file').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{not json')});
  await expect(page.getByRole('alert')).toContainText(/JSON|property name/);expect(await saved(page)).toEqual(recoveryBaseline);
  await page.getByRole('tab',{name:'Yield forecast',exact:true}).click();
  await openForecastView(page,'harvest');
  await expect(page.locator('.forecast-value')).toHaveText(harvest);
});

test('a finishing valley read preserves an open model edit and its keyboard focus',async({page})=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route('https://robinhood-rpc.publicnode.com/**',async route=>{await gate;await route.abort();});
  await openFarm(page);
  const requested=page.waitForRequest(request=>request.url().startsWith('https://robinhood-rpc.publicnode.com/'));
  await openUtility(page,'valley');
  await page.getByRole('button',{name:'Check the valley',exact:true}).click();await requested;
  await page.getByRole('tab',{name:'My farm',exact:true}).click();
  await openWallets(page);
  await page.getByRole('button',{name:'Edit model balances',exact:true}).first().click();
  const dialog=page.getByRole('dialog'),balance=dialog.getByLabel('Liquid CROP',{exact:true});
  await balance.fill('7654');release();
  await expect(balance).toHaveValue('7654');await expect(balance).toBeFocused();
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  expect((await saved(page)).portfolio.wallets[0].crop_balance_wei).toBe(units('7654').toString());
  await openUtility(page,'valley');
  await expect(page.getByRole('region',{name:'Around the valley',exact:true}).getByRole('alert')).toContainText('Valley read failed');
});

test('gallery artwork completion preserves a filter being typed before submission',async({page})=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  await page.route('https://api.rh.farm/plot/**',async route=>{await gate;await route.abort();});
  await page.route('https://farm.pagzi.tech/collection/status.json',route=>route.fulfill({json:{
    schema_version:1,environment:'production',phase:'waiting_for_reveal',target_count:3333,collected_count:0,
    last_checked_at_utc:new Date().toISOString()
  }}));
  await openFarm(page);
  const requested=page.waitForRequest(request=>/^https:\/\/api\.rh\.farm\/plot\/\d+\?fresh=\d+$/.test(request.url()));
  await page.getByLabel('Load plot artwork',{exact:true}).check();await requested;
  const search=page.getByLabel('Find plots',{exact:true});await search.fill('331');release();
  await expect(page.getByText('Some artwork is unavailable.',{exact:true})).toBeVisible();
  await expect(search).toHaveValue('331');await expect(search).toBeFocused();
  await page.getByRole('button',{name:'Apply filters',exact:true}).click();
  await expect(page.locator('.plot-card')).toHaveCount(0);
});
