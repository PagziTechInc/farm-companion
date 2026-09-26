import { test, expect } from '@playwright/test';
import { emptyPortfolio, defaults, units, rules, weight } from '../../src/model.js';
import { encodeFunctionData, encodeFunctionResult, parseAbi } from 'viem';
import { fulfillRpcBatch, rpcError, rpcResult } from '../fixtures.js';
import { openAddPlots, openForecastSettings, openHarvestLedger, openMainTab, openUtility, openWallets } from './navigation.js';

test.beforeEach(async ({page}) => {
  await page.route('https://robinhood-rpc.publicnode.com/**', route => route.abort());
});

async function manualFarm(page, {count='2', tier='3', modelWallet}={}) {
  await openAddPlots(page);
  if(modelWallet) await page.locator('#quick-farm [name=modelWallet]').selectOption(modelWallet);
  await page.getByLabel('Plot count',{exact:true}).fill(count);
  await page.locator('#quick-farm [name=tier]').selectOption(tier);
  await page.getByRole('button',{name:'Add model plots',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your plots',exact:true})).toBeVisible();
}
async function openHarvestLimits(page) {
  const details=page.locator('#harvest-limits');
  if(await details.getAttribute('open')===null) await details.locator('summary').click();
  await expect(details).toBeVisible();
}

async function forecast(page, days='90', {clearPrices=false}={}) {
  await page.getByRole('tab',{name:'Yield forecast',exact:true}).click();
  await openForecastSettings(page);
  await openHarvestLimits(page);
  await page.getByLabel('Additional valley weight (optional)',{exact:false}).fill('1000');
  await page.getByLabel('Forecast days',{exact:true}).fill(days);
  if(clearPrices){
    await openHarvestLimits(page);
    await page.getByLabel('CROP sale price in ETH (optional)',{exact:true}).fill('');
    await page.getByLabel('CROP buy price in ETH (optional)',{exact:true}).fill('');
  }
  await page.getByRole('button',{name:'Calculate forecast',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Harvest without reinvesting',exact:true})).toBeVisible();
}

test('public landing is empty and never requests a wallet or external service',async({page})=>{
  const external=[];page.on('request',request=>{if(!request.url().startsWith(`http://127.0.0.1:${process.env.FARM_PORT??4173}`))external.push(request.url());});
  await page.addInitScript(()=>{Object.defineProperty(window,'ethereum',{get(){throw new Error('Unexpected wallet provider access');}});});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:/Your farm\.\s*Your game plan\./})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Bring your farm'})).toBeVisible();
  await expect(page.getByText('0xFCCa03',{exact:false})).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(3);
  const images=page.locator('img');
  expect(await images.count()).toBeGreaterThanOrEqual(3);
  await images.evaluateAll(async nodes=>{await Promise.all(nodes.map(image=>image.decode()));});
  expect(await images.evaluateAll(nodes=>nodes.every(image=>image.complete&&image.naturalWidth>0&&(image.src.startsWith('data:image/')||new URL(image.src).origin===location.origin)))).toBe(true);
  await page.evaluate(()=>document.fonts.ready);
  expect(external).toEqual([]);
});

test('model plots produce all horizons, unknown ETH valuation and upgrade funding timers',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await manualFarm(page);await forecast(page,'45',{clearPrices:true});
  await openHarvestLedger(page);
  for(const term of ['7 days','30 days','45 days','90 days','365 days'])await expect(page.getByRole('cell',{name:term,exact:true})).toBeVisible();
  await expect(page.getByText('Add a sale-price assumption to estimate token value in ETH.')).toBeVisible();
  await page.getByRole('tab',{name:'Upgrade planner',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Upgrade cost & waiting time'})).toBeVisible();
  await expect(page.getByText('Before network costs').first()).toBeVisible();
  expect(errors).toEqual([]);
  await page.reload();await expect(page.getByRole('heading',{name:'Your plots',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('yield-farm-public-v2')).portfolio.wallets[0].plots.length)).toBe(2);
});

test('upgrade planner defaults to cumulative routes, can show next steps, and opens the active plan',async({page})=>{
  const portfolio=emptyPortfolio(),wallet=portfolio.wallets[0];
  portfolio.expected_total_plots=1;portfolio.total_planted_farm_weight_bps=weight(3,1);
  Object.assign(wallet,{crop_balance_wei:units('0').toString(),eth_balance_wei:units('1').toString(),expected_plot_count:1});
  wallet.plots=[{token_id:1,rarity_tier:3,level:1,is_active:true,effective_weight_bps:weight(3,1),pending_crop_wei:'0',modifiers:[],reveal_status:'hypothetical',evidence_source:'manual-hypothesis'}];
  await page.addInitScript(state=>localStorage.setItem('yield-farm-public-v2',JSON.stringify(state)),{schema_version:2,portfolio,scenario:{...defaults(),externalWeight:'0',buyPrice:'0.000001'},days:90});
  await page.goto('/');await page.getByRole('tab',{name:'Yield forecast',exact:true}).click();await openForecastSettings(page);
  await openHarvestLimits(page);
  await page.getByLabel('Additional valley weight (optional)',{exact:false}).fill('0');
  await page.getByLabel('Forecast days',{exact:true}).fill('90');
  await openHarvestLimits(page);
  await page.getByLabel('CROP buy price in ETH (optional)',{exact:true}).fill('0.000001');
  await page.getByRole('button',{name:'Calculate forecast',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Harvest without reinvesting',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Upgrade planner',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Upgrade cost & waiting time'})).toBeVisible();
  const comparison=page.getByRole('group',{name:'Upgrade comparison',exact:true}),rows=page.locator('.upgrade-results table tbody tr');
  await expect(comparison.getByRole('button',{name:'All upgrade routes',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('columnheader',{name:'Route',exact:true})).toBeVisible();
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({hasText:'1 → 2 → 3 → 4 → 5'})).toHaveCount(1);
  await expect(page.locator('.route-purchase')).toContainText('ETH at your scenario price');
  await comparison.getByRole('button',{name:'Next level only',exact:true}).click();
  await expect(page.getByRole('columnheader',{name:'Next level',exact:true})).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('td').nth(1)).toContainText('1 → 2');
  await comparison.getByRole('button',{name:'All upgrade routes',exact:true}).click();
  await expect(rows.filter({hasText:'1 → 2 → 3 → 4 → 5'})).toHaveCount(1);
  await page.getByRole('button',{name:'Build active plan',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Active plan',exact:true})).toBeVisible();
});

test('wallet and plot edits validate duplicates without corrupting the saved farm',async({page})=>{
  await page.goto('/');await manualFarm(page);
  await openWallets(page);
  await page.getByRole('button',{name:'Edit model balances'}).click();
  await page.getByLabel('Liquid CROP',{exact:true}).fill('15000');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await openMainTab(page,'My farm');
  await page.getByRole('button',{name:'Edit',exact:true}).nth(1).click();
  await page.getByLabel('Plot ID',{exact:true}).fill('1');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.getByRole('dialog').getByText('Plot IDs must be unique integers from 1 to 3333.')).toBeVisible();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('yield-farm-public-v2')));
  expect(stored.portfolio.wallets[0].plots.map(p=>p.token_id)).toEqual([1,2]);
  expect(stored.portfolio.wallets[0].crop_balance_wei).toBe('15000000000000000000000');
});

test('public RPC failure stays visible and preserves user-entered wallet',async({page})=>{
  await page.route('https://robinhood-rpc.publicnode.com/**',route=>route.abort());
  await page.goto('/');
  await page.getByLabel('Wallet address',{exact:true}).fill('0x1111111111111111111111111111111111111111');
  await page.getByRole('button',{name:/^Add(?: & refresh)? wallet/}).click();
  await expect(page.getByRole('alert')).toContainText('Wallet refresh failed');
  await expect(page.getByText('0x1111111111111111111111111111111111111111',{exact:true})).toBeVisible();
});

test('CSV export includes custom horizon and farm JSON can round trip',async({page})=>{
  await page.goto('/');await manualFarm(page);await forecast(page,'60');
  await openHarvestLedger(page);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export forecast CSV'}).click();
  expect((await download).suggestedFilename()).toBe('farm-yield-forecast.csv');
  await openUtility(page,'files');
  const exported=page.waitForEvent('download');await page.getByRole('button',{name:'Export farm JSON'}).click();
  const workspace=await exported,path=await workspace.path();
  await page.getByRole('button',{name:'Reset this browser’s farm'}).click();
  await page.getByRole('button',{name:'Confirm removal'}).click();
  await openUtility(page,'files');
  await page.locator('#import-file').setInputFiles(path);
  await expect(page.getByRole('status')).toContainText('Farm imported');
  await page.getByRole('tab',{name:'My farm',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your plots',exact:true})).toBeVisible();
});

test('mobile layout keeps calculator and wallet forms inside viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await manualFarm(page,{count:'1',tier:'0'});await forecast(page,'30');
  const width=await page.evaluate(()=>document.documentElement.scrollWidth);expect(width).toBeLessThanOrEqual(391);
  await expect(page.getByRole('tab',{name:'Upgrade planner'})).toBeVisible();
});

test('compact workbench fits the viewport and scrolls the plot gallery at desktop and phone sizes',async({page})=>{
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
    await page.setViewportSize(viewport);await page.goto('/');
    await page.evaluate(()=>localStorage.removeItem('yield-farm-public-v2'));await page.reload();
    await manualFarm(page,{count:'23',tier:'2'});
    await expect(page.locator('.plot-card')).toHaveCount(23);
    await expect(page.locator('.plot-more-tile')).toHaveCount(0);
    await manualFarm(page,{count:'1',tier:'2'});
    await expect(page.locator('.plot-grid > .plot-card')).toHaveCount(23);
    await expect(page.locator('.plot-grid > .plot-more-tile')).toHaveCount(1);
    await expect(page.locator('.plot-grid > *')).toHaveCount(24);
    await expect(page.locator('.plot-grid > *').nth(23)).toHaveClass(/plot-more-tile/);
    await page.getByRole('button',{name:'Show more plots (1 left)',exact:true}).click();
    await expect(page.locator('.plot-card')).toHaveCount(24);
    await expect(page.locator('.plot-more-tile')).toHaveCount(0);
    const tabs=page.getByRole('tablist',{name:'Farm tools',exact:true});
    const tools=page.getByRole('group',{name:'Companion tools',exact:true});
    await expect(tabs.getByRole('tab')).toHaveCount(3);await expect(tabs).toBeVisible();
    await expect(tools.locator('#tools-menu > summary')).toBeVisible();
    await expect(tools.getByRole('button',{name:'Farm actions · connect & approve',exact:true})).toBeVisible();
    const sizes=await page.evaluate(()=>{
      const app=document.querySelector('#app'),root=app.shadowRoot,grid=root.querySelector('.plot-grid');
      return {documentHeight:document.scrollingElement.scrollHeight,viewportHeight:innerHeight,appHeight:app.getBoundingClientRect().height,
        galleryOverflows:grid.scrollHeight>grid.clientHeight,galleryOverflow:getComputedStyle(grid).overflowY};
    });
    expect(sizes.documentHeight,JSON.stringify(viewport)).toBeLessThanOrEqual(viewport.height);
    expect(sizes.appHeight,JSON.stringify(viewport)).toBeLessThanOrEqual(viewport.height+1);
    expect(sizes.galleryOverflows,JSON.stringify(viewport)).toBe(true);
    expect(sizes.galleryOverflow,JSON.stringify(viewport)).toMatch(/auto|scroll/);
  }
});

test('forecast form edits and open assumptions survive a utility-panel round trip',async({page})=>{
  await page.goto('/');
  await page.getByRole('tab',{name:'Yield forecast',exact:true}).click();await openForecastSettings(page);
  await openHarvestLimits(page);
  await page.getByLabel('Additional valley weight (optional)',{exact:true}).fill('2345');
  await openHarvestLimits(page);
  await page.getByLabel('CROP buy price in ETH (optional)',{exact:true}).fill('0.0000009');
  await openUtility(page,'themes');
  await openMainTab(page,'Yield forecast');await openForecastSettings(page);
  await expect(page.getByLabel('Additional valley weight (optional)',{exact:true})).toHaveValue('2345');
  await expect(page.getByLabel('CROP buy price in ETH (optional)',{exact:true})).toHaveValue('0.0000009');
  await expect(page.locator('#assumptions details.advanced')).toHaveAttribute('open','');
});

test('multiple model wallets preserve separate balances and plot assignments',async({page})=>{
  await page.goto('/');await manualFarm(page,{count:'1',tier:'0'});
  await manualFarm(page,{count:'1',tier:'3',modelWallet:'new'});
  const wallets=await page.evaluate(()=>JSON.parse(localStorage.getItem('yield-farm-public-v2')).portfolio.wallets);
  expect(wallets).toHaveLength(2);expect(wallets.map(w=>w.plots.length)).toEqual([1,1]);
  await forecast(page);await page.getByRole('tab',{name:'Upgrade planner'}).click();
  await expect(page.getByRole('heading',{name:'Upgrade cost & waiting time'})).toBeVisible();
});

test('observed reserves align the forecast date and seed bag quote stays distinct',async({page})=>{
  const p=emptyPortfolio();p.expected_total_plots=1;
  p.wallets[0].plots=[{token_id:1,rarity_tier:0,level:1,is_active:false,effective_weight_bps:0,pending_crop_wei:'0',modifiers:[]}];
  p.reward_observed_at_utc='2026-09-22T12:34:25Z';p.observed_at_utc=p.reward_observed_at_utc;p.carry_crop_wei=units('123456').toString();p.granary_crop_wei=units('987654').toString();p.seed_bag_price_wei=units('0.001').toString();p.seed_bag_open=false;
  await page.addInitScript(state=>localStorage.setItem('yield-farm-public-v2',JSON.stringify(state)),{portfolio:p,scenario:{...defaults(),externalWeight:'1000',buyPrice:'0.000001'},days:30});
  await page.goto('/');await page.getByRole('tab',{name:'Yield forecast'}).click();
  await openForecastSettings(page);
  await openHarvestLimits(page);
  await page.getByRole('button',{name:'Use observed reward reserves'}).click();
  await expect(page.getByLabel('Start date (UTC)',{exact:true})).toHaveValue('2026-09-22T12:34');
  await page.getByRole('button',{name:'Calculate forecast'}).click();
  await page.locator('[data-forecast-view="planting"]').click();
  await expect(page.getByRole('heading',{name:'Choose your planting payment'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Seed bag · 0.001 ETH',exact:true})).toBeVisible();
  await expect(page.getByText('Bags closed',{exact:true})).toBeVisible();
  const s=await page.evaluate(()=>JSON.parse(localStorage.getItem('yield-farm-public-v2')).scenario);
  expect(s.rewardStateBasis).toBe('observed');expect(s.carryCrop).toBe('123456');expect(s.granaryCrop).toBe('987654');expect(s.rewardObservedAt).toBe(p.reward_observed_at_utc);
  expect(s.start).toBe('2026-09-22T12:34:25.000Z');
});

test('a live inventory collision never corrupts the saved model farm',async({page})=>{
  const abi=parseAbi(['function tokensOfOwner(address) view returns (uint256[])']),address='0x1111111111111111111111111111111111111111';
  const data=encodeFunctionData({abi,functionName:'tokensOfOwner',args:[address]});
  await page.route('https://robinhood-rpc.publicnode.com/', route => fulfillRpcBatch(route, async request => {
    let result;
    if(request.method==='eth_chainId')result='0x1237';
    else if(request.method==='eth_getBlockByNumber')result={number:'0x64',timestamp:'0x6aba7f00'};
    else if(request.method==='eth_getBalance')result='0x0';
    else if(request.method==='eth_call'&&request.params[0].data===data)result=encodeFunctionResult({abi,functionName:'tokensOfOwner',result:[1n]});
    else return rpcError(request, 'Unused fixture read');
    return rpcResult(request, result);
  }));
  await page.route('https://api.rh.farm/**',route=>route.fulfill({json:{attributes:[]}}));
  await page.goto('/');await manualFarm(page,{count:'1',tier:'0'});
  await openAddPlots(page);
  await page.getByLabel('Wallet address',{exact:true}).fill(address);
  await page.getByRole('button',{name:/^Add(?: & refresh)? wallet/}).click();
  await expect(page.getByRole('alert')).toContainText('refreshed inventory conflicts');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('yield-farm-public-v2')).portfolio);
  expect(saved.wallets.flatMap(w=>w.plots).map(p=>p.token_id)).toEqual([1]);
  expect(saved.wallets.find(w=>w.address===address).plots).toEqual([]);
  await page.reload();await expect(page.getByRole('heading',{name:'Your plots',exact:true})).toBeVisible();
  await expect(page.getByText('Saved data could not be loaded',{exact:false})).toHaveCount(0);
});

test('full-supply valley weight excludes owned base rarity, preserving the effect of owned upgrades',async({page})=>{
  await page.goto('/');await manualFarm(page,{count:'1',tier:'0'});
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByRole('dialog').locator('[name=level]').selectOption('5');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByRole('tab',{name:'Yield forecast',exact:true}).click();
  await openForecastSettings(page);
  await openHarvestLimits(page);
  await page.getByRole('button',{name:'Full collection at level 1',exact:true}).click();
  await expect(page.getByLabel('Additional valley weight (optional)',{exact:false})).toHaveValue('3612.5');
});


test('plot cards show farm artwork and switch to a complete inventory list without changing holdings',async({page})=>{
  await page.goto('/');await manualFarm(page,{count:'100',tier:'2'});
  await expect(page.locator('.plot-card')).toHaveCount(23);
  await expect(page.locator('.plot-grid > *')).toHaveCount(24);
  await expect(page.locator('.plot-grid > *').last()).toHaveClass(/plot-more-tile/);
  const farmBefore=await page.evaluate(()=>localStorage.getItem('yield-farm-public-v2'));
  const firstCard=page.locator('.plot-card').first();
  await expect(firstCard).toContainText('MODEL #1');
  await expect(firstCard).toContainText('LV 1');
  await firstCard.locator('img').evaluate(image=>image.decode());
  expect(await firstCard.locator('img').evaluate(image=>image.naturalWidth)).toBeGreaterThan(0);
  const controls=page.getByRole('group',{name:'Plot display'});
  await controls.getByRole('button',{name:'List',exact:true}).click();
  await expect(controls.getByRole('button',{name:'List',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(24);
  await page.getByRole('button',{name:'Show more plots (77 left)',exact:true}).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(47);
  await controls.getByRole('button',{name:'Cards',exact:true}).click();
  await expect(page.locator('.plot-card')).toHaveCount(46);
  for(const count of [69,92,100]){
    await page.locator('.plot-more-tile').click();
    await expect(page.locator('.plot-card')).toHaveCount(count);
    await expect(page.locator('.plot-more-tile')).toHaveCount(count===100?0:1);
  }
  await controls.getByRole('button',{name:'List',exact:true}).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(101);
  const lastPlot=page.getByRole('table').getByRole('row').last();
  await expect(lastPlot.getByRole('button',{name:'View artwork for plot #100',exact:true})).toHaveText('#100 ↗');
  await controls.getByRole('button',{name:'Cards',exact:true}).click();
  await expect(page.locator('.plot-card')).toHaveCount(100);
  await expect(controls.getByRole('button',{name:'Cards',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>localStorage.getItem('yield-farm-public-v2'))).toBe(farmBefore);
});

test('forecast term buttons carry the chosen forecast into the upgrade planner',async({page})=>{
  await page.goto('/');await manualFarm(page,{count:'1',tier:'0'});
  await page.getByRole('tab',{name:'Yield forecast',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Yield forecast',exact:true})).toHaveAttribute('aria-selected','true');
  await openForecastSettings(page);
  await page.getByRole('button',{name:'1 month',exact:true}).click();
  await expect(page.getByLabel('Forecast days',{exact:true})).toHaveValue('30');
  await openHarvestLimits(page);
  await page.getByLabel('Additional valley weight (optional)',{exact:true}).fill('1000');
  await page.getByRole('button',{name:'Calculate forecast',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Harvest without reinvesting',exact:true})).toBeVisible();
  await openHarvestLedger(page);
  await expect(page.getByRole('row').filter({has:page.getByRole('cell',{name:'30 days',exact:true})})).toHaveClass('best');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('yield-farm-public-v2')).days)).toBe(30);
  await page.getByRole('button',{name:'Find my best upgrade',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Upgrade planner',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('heading',{name:'Upgrade cost & waiting time',exact:true})).toBeVisible();
});
