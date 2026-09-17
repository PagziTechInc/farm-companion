import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {defaults, emptyPortfolio, units, weight} from '../../src/model.js';
import { parseAbi, decodeFunctionData, encodeFunctionResult } from 'viem';
import integrations from '../../knowledge/integrations.json' with { type:'json' };
import { fulfillRpcBatch, rpcResult } from '../fixtures.js';
import { openForecastSettings, openForecastView, openPlotFilters, openUtility } from './navigation.js';

const STORAGE = 'yield-farm-public-v2';

function plot(id, tier = 0, level = 1, active = true, pending = '0') {
  return {token_id: id, rarity_tier: tier, level, is_active: active,
    effective_weight_bps: active ? weight(tier, level) : 0,
    pending_crop_wei: units(pending).toString(), modifiers: [], reveal_status: 'hypothetical'};
}

function workspace() {
  const portfolio = emptyPortfolio();
  portfolio.wallets[0] = {...portfolio.wallets[0], id: 'seedlings', label: 'Seedling wallet',
    crop_balance_wei: units('1000').toString(), plots: [plot(1, 0, 1, true, '1000')]};
  portfolio.wallets.push({...portfolio.wallets[0], id: 'north', label: 'North field',
    crop_balance_wei: units('1000000').toString(), plots: [plot(3, 3, 4, true, '4500')]});
  return {schema_version: 2, portfolio, days: 30,
    scenario: {...defaults(), start: '2026-10-19T00:00:00Z', externalWeight: '0'},
    companion: {scene: 'journal', goal_crop: '5000', goal_wallet_id: 'seedlings', pinned_plot_id: null}};
}

async function openFarm(page, state = workspace()) {
  await page.addInitScript(({key, initial}) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(initial));
  }, {key: STORAGE, initial: state});
  await page.goto('/');
}

async function forecast(page) {
  await page.getByRole('tab', {name: 'Yield forecast', exact: true}).click();
  await openForecastSettings(page);
  await page.getByRole('button', {name: 'Calculate forecast', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Harvest without reinvesting', exact: true})).toBeVisible();
}

async function saved(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE);
}

test('weather lab recalculates the harvest while preserving plots and opening reserves', async ({page}) => {
  await openFarm(page);
  await forecast(page);
  const initialHarvest = await page.locator('.forecast-value').textContent();
  await openForecastView(page, 'weather');
  await openForecastSettings(page);
  const before = await saved(page);
  await expect(page.getByRole('heading', {name: 'Weather lab', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: /^Use .* weather scenario$/})).toHaveCount(5);
  await page.getByRole('button', {name: 'Use Rain weather scenario', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Use Rain weather scenario', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', {name: 'Weekly weather', exact: true})).toHaveValue('15000');
  await openForecastView(page, 'harvest');
  await expect(page.locator('.forecast-value')).not.toHaveText(initialHarvest);
  const after = await saved(page);
  expect(after.scenario.weatherBps).toBe(15000);
  expect(after.portfolio).toEqual(before.portfolio);
  expect(after.scenario.carryCrop).toBe(before.scenario.carryCrop);
  expect(after.scenario.granaryCrop).toBe(before.scenario.granaryCrop);
  expect(after.scenario.start).toBe(before.scenario.start);
  await openForecastView(page, 'weather');
  await page.getByRole('button', {name: 'Use Fair weather scenario', exact: true}).click();
  await openForecastView(page, 'harvest');
  await expect(page.locator('.forecast-value')).toHaveText(initialHarvest);
});

test('goal board isolates wallets, counts pending once and restores the selected goal', async ({page}) => {
  await openFarm(page);
  await forecast(page);
  await openForecastView(page, 'goal');
  const board = page.locator('.goal-board');
  await expect(board.getByText('About 11 days', {exact: true})).toBeVisible();
  await expect(board.getByRole('progressbar', {name: 'CROP goal progress'})).toHaveAttribute('aria-valuenow', '40');
  await expect(board).toContainText('Claim required to spend the harvest.');

  await page.getByRole('combobox', {name: 'Goal wallet', exact: true}).selectOption('north');
  await page.getByRole('button', {name: 'Track goal', exact: true}).click();
  await expect(board.getByText('Goal covered', {exact: true})).toBeVisible();
  await expect(board).not.toContainText('Claim required to spend the harvest.');

  await page.getByRole('combobox', {name: 'Goal wallet', exact: true}).selectOption('seedlings');
  await page.getByLabel('Target total CROP', {exact: true}).fill('2000');
  await page.getByRole('button', {name: 'Track goal', exact: true}).click();
  await expect(board.getByText('Goal covered', {exact: true})).toBeVisible();
  await expect(board).toContainText('Claim required to spend the harvest.');
  const stored = await saved(page);
  expect(stored.companion.goal_crop).toBe('2000');
  expect(stored.companion.goal_wallet_id).toBe('seedlings');
  expect(stored.portfolio.wallets[0].crop_balance_wei).toBe(units('1000').toString());
  expect(stored.portfolio.wallets[0].plots[0].pending_crop_wei).toBe(units('1000').toString());

  await page.reload();
  await forecast(page);
  await openForecastView(page, 'goal');
  await expect(page.getByRole('combobox', {name: 'Goal wallet', exact: true})).toHaveValue('seedlings');
  await expect(page.getByLabel('Target total CROP', {exact: true})).toHaveValue('2000');
  await expect(board).toContainText('Claim required to spend the harvest.');
});

test('inventory filters preserve holdings and a pinned plot sets its own wallet upgrade goal', async ({page}) => {
  const initial = workspace();
  initial.portfolio.wallets[0].plots.push(plot(2, 1, 1, false, '20'));
  await openFarm(page, initial);
  await forecast(page);
  await page.getByRole('tab', {name: 'My farm', exact: true}).click();
  await expect(page.locator('.plot-card')).toHaveCount(3);
  const before = (await saved(page)).portfolio;
  await openPlotFilters(page);
  await page.getByRole('combobox', {name: 'Sort plots', exact: true}).selectOption({label: 'Highest weight'});
  await page.getByRole('button', {name: 'Apply filters', exact: true}).click();
  await expect(page.locator('.plot-card').first()).toContainText('MODEL #3');
  await expect(page.locator('.plot-card').first()).toContainText('CROP · day one');
  await page.getByLabel('Find plots', {exact: true}).fill('3');
  await openPlotFilters(page);
  await page.getByRole('combobox', {name: 'Filter wallet', exact: true}).selectOption('north');
  await page.getByRole('combobox', {name: 'Plot state', exact: true}).selectOption({label: 'Planted'});
  await page.getByRole('button', {name: 'Apply filters', exact: true}).click();
  await expect(page.locator('.plot-card')).toHaveCount(1);
  await expect(page.getByRole('button', {name: 'Plan plot #3', exact: true})).toBeVisible();
  expect((await saved(page)).portfolio).toEqual(before);
  await page.getByRole('button', {name: 'Clear filters', exact: true}).click();
  await expect(page.locator('.plot-card')).toHaveCount(3);
  await page.getByRole('button', {name: 'Plan plot #3', exact: true}).click();
  await expect(page.getByRole('tab', {name: 'Upgrade planner', exact: true})).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', {name: 'Upgrade target', exact: true})).toBeVisible();
  await expect(page.getByRole('combobox', {name: 'Target plot', exact: true})).toHaveValue('3');
  await expect(page.getByRole('combobox', {name: 'Goal wallet', exact: true})).toHaveValue('north');
  await expect(page.getByLabel('Target total CROP', {exact: true})).toHaveValue('50000');
  const result = await saved(page);
  expect(result.companion.pinned_plot_id).toBe(3);
  expect(result.portfolio).toEqual(before);
});

test('the calendar download contains all five published UTC milestones', async ({page}) => {
  await page.goto('/');
  await openUtility(page, 'valley');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Save calendar', exact: true}).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.ics$/);
  const content = (await readFile(await download.path(), 'utf8')).replace(/\r\n /g, '');
  expect(content).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0');
  expect(content.match(/BEGIN:VEVENT/g)).toHaveLength(5);
  expect(content.match(/DTSTART:\d{8}T\d{6}Z/g)).toEqual([
    'DTSTART:20260915T170000Z', 'DTSTART:20260918T180000Z', 'DTSTART:20260921T000000Z',
    'DTSTART:20260928T000000Z', 'DTSTART:20261019T000000Z',
  ]);
  expect(content.match(/STATUS:TENTATIVE/g)).toHaveLength(5);
  expect(content).toContain('URL:https://rh.farm/almanac/');
  expect(content).toContain('Dates do not confirm mint');
});

test('seasonal scenery changes locally, persists and leaves economic calculations unchanged', async ({page}) => {
  await page.route('https://robinhood-rpc.publicnode.com/**', route => route.abort());
  const external = [];
  page.on('request', request => {
    if (!request.url().startsWith(`http://127.0.0.1:${process.env.FARM_PORT??4173}`)) external.push(request.url());
  });
  await openFarm(page);
  await forecast(page);
  await expect(page.locator('#forecast-source')).not.toContainText('Checking chain');
  external.length = 0;
  const harvest = await page.locator('.forecast-value').textContent();
  const before = await saved(page);
  await page.getByRole('tab', {name: 'My farm', exact: true}).click();
  await openUtility(page, 'themes');
  const picker = page.getByRole('group', {name: 'Journal scenery', exact: true});
  await picker.getByRole('button', {name: 'Scene: Deep Winter', exact: true}).click();
  await expect(picker.getByRole('button', {name: 'Scene: Deep Winter', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await picker.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  expect(await picker.locator('img').evaluateAll(images => images.every(image => image.naturalWidth > 0 && image.src.startsWith('data:image/')))).toBe(true);
  const after = await saved(page);
  expect(after.companion.scene).toBe('winter');
  expect(after.portfolio).toEqual(before.portfolio);
  expect(after.scenario).toEqual(before.scenario);
  await forecast(page);
  await expect(page.locator('.forecast-value')).toHaveText(harvest);
  await page.reload();
  await openUtility(page, 'themes');
  await expect(page.getByRole('button', {name: 'Scene: Deep Winter', exact: true})).toHaveAttribute('aria-pressed', 'true');
  expect(external).toEqual([]);
});

test('a failed valley check keeps oracle weather unknown and leaves the scenario untouched', async ({page}) => {
  await page.route('https://robinhood-rpc.publicnode.com/**', route => route.abort());
  await openFarm(page);
  const before = (await saved(page)).scenario;
  await openUtility(page, 'valley');
  const valley = page.getByRole('region', {name: 'Around the valley', exact: true});
  await expect(valley.getByRole('heading', {name: 'Not checked', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Check the valley', exact: true}).click();
  await expect(valley.getByRole('alert')).toBeVisible();
  await expect(valley.getByRole('heading', {name: 'Not checked', exact: true})).toBeVisible();
  const after = await saved(page);
  expect(after.season ?? null).toBeNull();
  expect(after.scenario).toEqual(before);
});

test('valley reads share one block and remain separate from wallet ownership and forecast assumptions', async ({page}) => {
  const calls=[],genesis=1789948800n;
  const values={currentEpoch:0n,epochStart:genesis,nextBoundary:genesis,multiplierNow:12000n,floodActive:false,moonActive:false,moonCount:0n,commitHash:`0x${'a'.repeat(64)}`,totalSupply:7n,totalWeight:0n,carryNow:0n,granaryNow:units('40000000'),emitted:0n,paidOut:0n,bagPrice:units('0.001'),bagOpen:true,weatherOf:1};
  await page.route('https://robinhood-rpc.publicnode.com/**', route => fulfillRpcBatch(route, async request => {
    calls.push(request);
    let result;
    if(request.method==='eth_chainId')result='0x1237';
    else if(request.method==='eth_getBlockByNumber')result={number:'0x64',timestamp:`0x${(genesis-172800n).toString(16)}`};
    else {
      expect(request.method).toBe('eth_call');expect(request.params[1]).toBe('0x64');
      const contract=Object.values(integrations.contracts).find(c=>c.address?.toLowerCase()===request.params[0].to.toLowerCase());
      const abi=parseAbi(contract.read_signatures),{functionName}=decodeFunctionData({abi,data:request.params[0].data});
      expect(Object.hasOwn(values,functionName)).toBe(true);
      result=encodeFunctionResult({abi,functionName,result:values[functionName]});
    }
    return rpcResult(request, result);
  }));
  await openFarm(page);const before=await saved(page);
  await openUtility(page, 'valley');
  await page.getByRole('button',{name:'Check the valley',exact:true}).click();
  const valley=page.getByRole('region',{name:'Around the valley',exact:true});
  await expect(valley.getByRole('heading',{name:'Sunny',exact:true})).toBeVisible();
  await expect(valley).toContainText('Oracle · before Genesis');
  await expect(valley).toContainText('40,000,000');
  const after=await saved(page);
  expect(after.season).toMatchObject({block_number:100,weather_enum:1,minted_count:7,read_errors:[]});
  expect(after.portfolio).toEqual(before.portfolio);expect(after.scenario).toEqual(before.scenario);
  const count=calls.length;await page.reload();
  await openUtility(page, 'valley');
  await expect(valley.getByRole('heading',{name:'Sunny',exact:true})).toBeVisible();
  expect(calls.length).toBe(count);
});
