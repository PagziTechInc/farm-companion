import { test, expect } from '@playwright/test';
import { decodeFunctionData, encodeFunctionResult, encodeEventTopics, encodeAbiParameters, parseAbi } from 'viem';
import { defaults, emptyPortfolio, rules, units, weight } from '../../src/model.js';
import integrations from '../../knowledge/integrations.json' with { type:'json' };
import reviewedWeather from '../../knowledge/snapshots/verified-contracts-2026-09-11/weather.json' with { type:'json' };
import launchWeather from '../../knowledge/launch-weather.json' with { type:'json' };
import { fulfillRpcBatch, rpcError, rpcResult } from '../fixtures.js';
import { openAddPlots, openForecastSettings } from './navigation.js';

const STORAGE = 'yield-farm-public-v2';
const RPC_PATTERN = 'https://robinhood-rpc.publicnode.com/**';
const BLOCK_NUMBER = launchWeather.block_number;
const BLOCK_TAG = `0x${BLOCK_NUMBER.toString(16)}`;
const genesis = rules.schedule.genesis_timestamp;

// These regressions exercise the optional custom-scenario controls. Automatic
// intake and zero-configuration forecasts are covered in automatic.spec.js.
test.beforeEach(async ({page}) => {
  await page.addInitScript(workspace => {
    localStorage.setItem('yield-farm-public-v2', JSON.stringify(workspace));
  }, {schema_version:2, simulationMode:'custom', portfolio:emptyPortfolio(),
      scenario:defaults(), forecastManual:[], forecastDefaultsVersion:2, days:90});
});


function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function setTestClock(page, timestampSeconds) {
  await page.addInitScript(epochMs => {
    const NativeDate = Date;
    class FixedDate extends NativeDate {
      constructor(...args) { args.length ? super(...args) : super(epochMs); }
      static now() { return epochMs; }
    }
    window.Date = FixedDate;
  }, timestampSeconds * 1000);
}

async function guardWallet(page) {
  await page.addInitScript(() => {
    window.__forecastWalletAccesses = 0;
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      get() {
        window.__forecastWalletAccesses += 1;
        throw new Error('The forecast defaults read must not access a wallet.');
      },
    });
  });
}

async function expectNoWalletAccess(page) {
  expect(await page.evaluate(() => window.__forecastWalletAccesses)).toBe(0);
}

async function addModelPlots(page, { count = 1, tier = '0' } = {}) {
  await openAddPlots(page);
  const form = page.locator('#quick-farm');
  await expect(form).toBeVisible();
  await form.locator('[name=count]').fill(String(count));
  await form.locator('[name=tier]').selectOption(String(tier));
  await form.getByRole('button', { name:'Add model plots', exact:true }).click();
  await expect(page.getByRole('heading', { name:'Your plots', exact:true })).toBeVisible();
}

async function openForecast(page) {
  await page.getByRole('tab', { name:'Yield forecast', exact:true }).click();
  await openForecastSettings(page);
  await openAdvanced(page);
  await expect(page.locator('#forecast-source')).not.toContainText('Checking');
}

async function openAdvanced(page) {
  const details=page.locator('#harvest-limits');
  if(await details.getAttribute('open')===null) await details.locator('summary').click();
}

async function saved(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE);
}

function hex(value) {
  return `0x${BigInt(value).toString(16)}`;
}

async function installSeasonRpc(page, {
  blockTimestamp = genesis,
  weatherEnum = 0n,
  effectiveMultiplierBps = 10000n,
  totalWeightBps = 0n,
  mintedCount = 0n,
  carryCrop = units('0'),
  granaryCrop = units('40000000'),
  bagPrice = units('0.001'),
  bagOpen = true,
  failedReads = [],
  holdBlock = false,
} = {}) {
  const calls = [], blockStarted = deferred(), releaseBlock = deferred();
  const failures = new Set(failedReads);
  const weatherAbi = parseAbi([...integrations.contracts.weather.read_signatures, 'event WeatherScheduled(uint256 indexed epoch, uint8 weather)']);
  const values = {
    currentEpoch:0n,
    epochStart:BigInt(genesis),
    nextBoundary:BigInt(genesis),
    multiplierNow:BigInt(effectiveMultiplierBps),
    floodActive:false,
    moonActive:false,
    moonCount:0n,
    commitHash:`0x${'a'.repeat(64)}`,
    totalSupply:BigInt(mintedCount),
    totalWeight:BigInt(totalWeightBps),
    carryNow:BigInt(carryCrop),
    granaryNow:BigInt(granaryCrop),
    emitted:0n,
    paidOut:0n,
    bagPrice:BigInt(bagPrice),
    bagOpen,
    weatherOf:BigInt(weatherEnum),
  };

  await page.route(RPC_PATTERN, route => fulfillRpcBatch(route, async request => {
    calls.push(request);
    let result;
    if (request.method === 'eth_chainId') result = '0x1237';
    else if (request.method === 'eth_getBlockByNumber') {
      blockStarted.resolve(request);
      if (holdBlock) await releaseBlock.promise;
      result = { number:BLOCK_TAG, timestamp:hex(blockTimestamp) };
    } else if (request.method === 'eth_getCode') {
      expect(request.params[1]).toBe(BLOCK_TAG);
      expect([integrations.contracts.weather.address,integrations.contracts.pool.address]).toContain(request.params[0]);
      result = request.params[0] === integrations.contracts.weather.address ? reviewedWeather.runtimeBytecode.onchainBytecode : '0x';
    } else if (request.method === 'eth_getLogs') {
      const filter = request.params[0];
      expect(filter.address).toBe(integrations.contracts.weather.address);
      expect(filter.toBlock).toBe(BLOCK_TAG);
      expect(filter.fromBlock).toBe(hex(integrations.contracts.weather.deployment_block));
      result = [{address:integrations.contracts.weather.address, blockNumber:hex(integrations.contracts.weather.deployment_block + 1),
        transactionHash:`0x${'1'.repeat(64)}`, logIndex:'0x0', removed:false,
        topics:encodeEventTopics({abi:weatherAbi,eventName:'WeatherScheduled',args:{epoch:0n}}),
        data:encodeAbiParameters([{type:'uint8'}],[Number(weatherEnum)])}];
    } else if (request.method === 'eth_call') {
      const [call, blockTag] = request.params;
      if (blockTag !== BLOCK_TAG) return rpcError(request, `Fixture only serves pinned block ${BLOCK_TAG}.`, -32602);
      const contract = Object.values(integrations.contracts).find(row => row.address?.toLowerCase() === call.to.toLowerCase());
      let functionName;
      try {
        if (!contract) throw new Error(`Unknown fixture contract ${call.to}`);
        const abi = parseAbi(contract.read_signatures);
        ({ functionName } = decodeFunctionData({ abi, data:call.data }));
        if (failures.has(functionName) || !Object.hasOwn(values, functionName)) throw new Error(`No fixture value for ${functionName}`);
        result = encodeFunctionResult({ abi, functionName, result:values[functionName] });
      } catch (error) {
        return rpcError(request, error, -32601);
      }
    } else {
      return rpcError(request, `No fixture response for ${request.method}`, -32601);
    }
    return rpcResult(request, result);
  }));

  return {
    calls,
    blockStarted:blockStarted.promise,
    release:() => releaseBlock.resolve(),
  };
}

function expectPinnedReads(calls) {
  expect(calls.some(call => call.method === 'eth_chainId')).toBe(true);
  expect(calls.some(call => call.method === 'eth_getBlockByNumber')).toBe(true);
  const reads = calls.filter(call => call.method === 'eth_call');
  expect(reads.length).toBeGreaterThanOrEqual(16);
  expect(reads.every(call => call.params[1] === BLOCK_TAG)).toBe(true);
  expect(calls.some(call => call.method === 'eth_getCode')).toBe(true);
  expect(calls.some(call => call.method === 'eth_getLogs')).toBe(true);
}

test('journey duplicates are gone and a random model farm stays hypothetical while preserving observed valley weight', async ({ page }) => {
  const fixture = await installSeasonRpc(page, {
    blockTimestamp:genesis + 3625,
    weatherEnum:2n,
    effectiveMultiplierBps:10000n,
    totalWeightBps:100000000n,
    carryCrop:units('321'),
    granaryCrop:units('654'),
  });
  await setTestClock(page, genesis + 3640);
  await guardWallet(page);
  await page.addInitScript(() => {
    window.__forecastTestRandom = { calls:0 };
    const quantiles = [0.1, 0.8, 0.95, 0.999];
    Math.random = () => {
      const index = window.__forecastTestRandom.calls++;
      return quantiles[index] ?? 0.1;
    };
  });
  await page.goto('/');

  await expect(page.locator('.journey')).toHaveCount(0);
  for (const text of ['Gather your plots', 'Forecast the harvest', 'Find your next upgrade']) {
    await expect(page.getByText(text, { exact:true })).toHaveCount(0);
  }
  const tier = page.locator('#quick-farm [name=tier]');
  await expect(tier).toHaveValue('0');
  await page.evaluate(() => { window.__forecastTestRandom.calls = 0; });
  await addModelPlots(page, { count:100, tier:'random' });

  const portfolio = (await saved(page)).portfolio;
  expect(portfolio.wallets).toHaveLength(1);
  expect(portfolio.wallets[0].address).toBeNull();
  expect(portfolio.wallets[0].plots).toHaveLength(100);
  const plots = portfolio.wallets[0].plots;
  expect(new Set(plots.map(plot => plot.rarity_tier))).toEqual(new Set([0,1,2,3]));
  expect(new Set(plots.map(plot => plot.token_id)).size).toBe(100);
  expect(plots.every(plot => plot.token_id >= 1 && plot.token_id <= rules.plots.max_supply)).toBe(true);
  expect(plots.every(plot => plot.reveal_status === 'hypothetical')).toBe(true);
  expect(plots.every(plot => plot.evidence_source === 'manual-hypothesis')).toBe(true);
  expect(plots.every(plot => plot.effective_weight_bps === weight(plot.rarity_tier, plot.level))).toBe(true);
  expect(plots.every(plot => !Object.hasOwn(plot, 'address'))).toBe(true);

  await openForecast(page);
  await expect(page.getByLabel('Additional valley weight (optional)', { exact:true })).toHaveValue('10000');
  await expect(page.getByLabel('Start date (UTC)', { exact:true })).toHaveValue(new Date((genesis + 3625) * 1000).toISOString().slice(0,16));
  expectPinnedReads(fixture.calls);
  await expectNoWalletAccess(page);
  await page.getByRole('button', { name:'Calculate forecast', exact:true }).click();
  await expect(page.getByRole('heading', { name:'Harvest without reinvesting', exact:true })).toBeVisible();
  expect((await saved(page)).scenario.start).toBe(new Date((genesis + 3625) * 1000).toISOString());
});

test('RPC failure leaves a complete pre-Genesis fallback forecast ready without wallet access or typed assumptions', async ({ page }) => {
  const requests = [];
  await page.route(RPC_PATTERN, async route => {
    const body = route.request().postDataJSON();
    requests.push(...(Array.isArray(body) ? body : [body]));
    await route.abort();
  });
  await setTestClock(page, genesis - 3600);
  await guardWallet(page);
  await page.goto('/');
  await addModelPlots(page, { count:1, tier:'0' });
  await openForecast(page);

  const external = page.getByLabel('Additional valley weight (optional)', { exact:true });
  const start = page.getByLabel('Start date (UTC)', { exact:true });
  const weather = page.getByRole('combobox', { name:'Weekly weather', exact:true });
  await expect(external).toHaveValue('0');
  await expect(start).toHaveValue(new Date(genesis * 1000).toISOString().slice(0,16));
  await expect(weather).toHaveValue('10000');
  await expect(page.getByRole('checkbox', {name:'Use known weeks',exact:true})).toBeChecked();
  expect((await saved(page)).scenario.weatherWeeks.map(w=>[w.epoch,w.multiplier_bps])).toEqual([[0,12000]]);
  await openAdvanced(page);
  await expect(page.getByLabel('Yearly valley weight growth (%)', { exact:true })).toHaveValue('0');
  await expect(page.getByLabel('Seed carry available (CROP)', { exact:true })).toHaveValue('0');
  await expect(page.getByLabel('Granary available (CROP)', { exact:true })).toHaveValue('40000000');
  const buyPrice = page.getByLabel('CROP buy price in ETH (optional)', { exact:true });
  const sellPrice = page.getByLabel('CROP sale price in ETH (optional)', { exact:true });
  await expect(buyPrice).toHaveValue('0.0000004');
  await expect(sellPrice).toHaveValue('0.0000004');
  expect(requests.some(request => request.method === 'eth_chainId')).toBe(true);
  expect(await page.locator('#assumptions').evaluate(form => form.checkValidity())).toBe(true);

  await expect(page.locator('#forecast-source')).toContainText('Prices: planting-cost estimate');
  await page.getByText('Input sources & assumptions', { exact:true }).click();
  await expect(page.getByText(/A scenario reference, not a market price or executable buy\/sell quote\./)).toBeVisible();
  await page.getByRole('button', { name:'Calculate forecast', exact:true }).click();
  await expect(page.getByRole('heading', { name:'Harvest without reinvesting', exact:true })).toBeVisible();
  await expectNoWalletAccess(page);
});

test('zero pre-Genesis chain weight keeps zero outside weight, ordinary weather, observed reserves and one pinned block', async ({ page }, testInfo) => {
  const fixture = await installSeasonRpc(page, {
    blockTimestamp:genesis - 3600,
    weatherEnum:1n,
    effectiveMultiplierBps:20000n,
    totalWeightBps:0n,
    mintedCount:7n,
    carryCrop:units('12345.678'),
    granaryCrop:units('987654.321'),
  });
  await setTestClock(page, genesis - 3585);
  await page.goto('/');
  await addModelPlots(page, { count:1, tier:'0' });
  await openForecast(page);

  await expect(page.getByLabel('Additional valley weight (optional)', { exact:true })).toHaveValue('0');
  await expect(page.getByRole('combobox', { name:'Weekly weather', exact:true })).toHaveValue('10000');
  await expect(page.getByRole('checkbox', {name:'Use known weeks',exact:true})).toBeChecked();
  await page.locator('.weather-calendar > summary').click();
  await expect(page.locator('.weather-week-grid > div')).toHaveCount(12);
  await expect(page.locator('.weather-week-grid > .known')).toHaveCount(1);
  await expect(page.locator('.weather-week-grid > .known')).toContainText('Week 1');
  await expect(page.locator('.weather-week-grid > .known')).toContainText('Sunny');
  await expect(page.locator('.weather-week-grid > .sealed > strong')).toHaveText(Array(11).fill('Unrevealed'));
  await expect(page.getByLabel('Start date (UTC)', { exact:true })).toHaveValue(new Date(genesis * 1000).toISOString().slice(0,16));
  await openAdvanced(page);
  await expect(page.getByLabel('Seed carry available (CROP)', { exact:true })).toHaveValue('12345.678');
  await expect(page.getByLabel('Granary available (CROP)', { exact:true })).toHaveValue('987654.321');
  expectPinnedReads(fixture.calls);
  await expect(page.locator('#forecast-source')).toContainText(`block ${BLOCK_NUMBER.toLocaleString('en-US')}`);

  await page.getByRole('button', { name:'Calculate forecast', exact:true }).click();
  await expect(page.getByRole('heading', { name:'Harvest without reinvesting', exact:true })).toBeVisible();
  const scenario = (await saved(page)).scenario;
  expect(scenario.start).toBe(new Date(genesis * 1000).toISOString());
  expect(scenario.externalWeight).toBe('0');
  expect(scenario.weatherBps).toBe(10000);
  expect(scenario.useKnownWeather).toBe(true);
  expect(scenario.weatherWeeks.map(w=>[w.epoch,w.multiplier_bps])).toEqual([[0,12000]]);
  expect(scenario.weatherBasis).toBe('chain');
  expect(scenario.weatherWeeks[0].scheduled_block).toBe(integrations.contracts.weather.deployment_block + 1);
  expect(scenario.weatherWeeks[0].transaction_hash).toBe(`0x${'1'.repeat(64)}`);
  expect(scenario.weatherObservedAt).toBe(new Date((genesis - 3585) * 1000).toISOString());
  expect(scenario.carryCrop).toBe('12345.678');
  expect(scenario.granaryCrop).toBe('987654.321');
  await expect(page.locator('.founding-boost > strong')).toHaveText('×2.40');
  await expect(page.locator('.founding-boost')).toHaveAttribute('title',/Nominal weather × First Soil/);
  await page.locator('.weather-calendar').scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath('known-weather-and-founding-week.png'),fullPage:true});
});

test('a late chain response preserves a farmer-edited valley weight, start and reserve group', async ({ page }) => {
  const fixture = await installSeasonRpc(page, {
    blockTimestamp:genesis - 3600,
    weatherEnum:1n,
    effectiveMultiplierBps:20000n,
    totalWeightBps:0n,
    carryCrop:units('987654'),
    granaryCrop:units('12345678'),
    holdBlock:true,
  });
  await setTestClock(page, genesis - 3585);
  await page.goto('/');
  await addModelPlots(page, { count:1, tier:'0' });
  await page.getByRole('tab', { name:'Yield forecast', exact:true }).click();
  await fixture.blockStarted;
  await expect(page.locator('#forecast-source')).toContainText('Checking');
  await openAdvanced(page);
  await page.getByLabel('Additional valley weight (optional)', { exact:true }).fill('71.25');
  await page.getByLabel('Start date (UTC)', { exact:true }).fill('2026-09-22T03:45');
  await page.getByLabel('Seed carry available (CROP)', { exact:true }).fill('12345.67');
  await page.getByLabel('Granary available (CROP)', { exact:true }).fill('7654321.09');
  fixture.release();
  await expect(page.locator('#forecast-source')).not.toContainText('Checking');

  await expect(page.getByLabel('Additional valley weight (optional)', { exact:true })).toHaveValue('71.25');
  await expect(page.getByLabel('Start date (UTC)', { exact:true })).toHaveValue('2026-09-22T03:45');
  await expect(page.getByLabel('Seed carry available (CROP)', { exact:true })).toHaveValue('12345.67');
  await expect(page.getByLabel('Granary available (CROP)', { exact:true })).toHaveValue('7654321.09');
  await page.getByRole('button', { name:'Calculate forecast', exact:true }).click();
  await expect(page.getByRole('heading', { name:'Harvest without reinvesting', exact:true })).toBeVisible();
  const scenario = (await saved(page)).scenario;
  expect(scenario.externalWeight).toBe('71.25');
  expect(scenario.start).toBe('2026-09-22T03:45:00.000Z');
  expect(scenario.carryCrop).toBe('12345.67');
  expect(scenario.granaryCrop).toBe('7654321.09');
});

test('calculation locks chain defaults and duplicate form submission until its timer completes', async ({ page }) => {
  await installSeasonRpc(page, {
    blockTimestamp:genesis - 3600,
    weatherEnum:2n,
    effectiveMultiplierBps:20000n,
    totalWeightBps:0n,
    carryCrop:units('22.5'),
    granaryCrop:units('333.75'),
  });
  await setTestClock(page, genesis - 3585);
  await page.goto('/');
  await addModelPlots(page, { count:1, tier:'0' });
  await openForecast(page);
  await openAdvanced(page);
  await page.getByLabel('Additional valley weight (optional)', { exact:true }).fill('71.25');
  await page.getByLabel('Start date (UTC)', { exact:true }).fill('2026-09-22T03:45');
  await page.getByRole('combobox', { name:'Weekly weather', exact:true }).selectOption('15000');
  await page.getByLabel('Yearly valley weight growth (%)', { exact:true }).fill('2.5');
  await page.getByLabel('Seed carry available (CROP)', { exact:true }).fill('12345.67');
  await page.getByLabel('Granary available (CROP)', { exact:true }).fill('7654321.09');
  await page.getByLabel('CROP buy price in ETH (optional)', { exact:true }).fill('0.0000009');
  await page.getByLabel('CROP sale price in ETH (optional)', { exact:true }).fill('0.0000008');

  const race = await page.locator('#assumptions').evaluate(form => {
    const root = form.getRootNode();
    const originalSetTimeout = window.setTimeout;
    window.__forecastCalculationTimers = 0;
    window.setTimeout = function(callback, delay, ...args) {
      if (Number(delay) === 20) window.__forecastCalculationTimers += 1;
      return originalSetTimeout.call(window, callback, delay, ...args);
    };
    const submit = target => target.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));

    submit(form);
    const reset = [...root.querySelectorAll('button')].find(button => button.textContent.trim() === 'Use chain defaults');
    if (!reset) throw new Error('Use chain defaults button was not rendered during calculation.');
    const resetDisabled = reset.disabled;
    reset.click();
    const secondForm = root.querySelector('#assumptions');
    if (!secondForm) throw new Error('Forecast form was not rendered after the first submission.');
    submit(secondForm);
    const scenario = JSON.parse(localStorage.getItem('yield-farm-public-v2')).scenario;
    return { resetDisabled, timers:window.__forecastCalculationTimers, scenario };
  });

  expect(race.resetDisabled).toBe(true);
  expect(race.timers).toBe(1);
  expect(race.scenario).toMatchObject({
    externalWeight:'71.25',
    start:'2026-09-22T03:45:00.000Z',
    weatherBps:15000,
    annualGrowthPct:'2.5',
    carryCrop:'12345.67',
    granaryCrop:'7654321.09',
    buyPrice:'0.0000009',
    sellPrice:'0.0000008',
  });
  await expect(page.getByRole('heading', { name:'Harvest without reinvesting', exact:true })).toBeVisible();
  expect((await saved(page)).scenario).toMatchObject(race.scenario);
});

test('a held chain response released after calculation keeps the result and submitted scenario', async ({ page }) => {
  const fixture = await installSeasonRpc(page, {
    blockTimestamp:genesis - 3600,
    weatherEnum:1n,
    effectiveMultiplierBps:20000n,
    totalWeightBps:0n,
    carryCrop:units('987654'),
    granaryCrop:units('12345678'),
    holdBlock:true,
  });
  await setTestClock(page, genesis - 3585);
  await page.goto('/');
  await addModelPlots(page, { count:1, tier:'0' });
  await page.getByRole('tab', { name:'Yield forecast', exact:true }).click();
  await fixture.blockStarted;
  await expect(page.locator('#forecast-source')).toContainText('Checking');
  await openAdvanced(page);
  await page.getByLabel('Additional valley weight (optional)', { exact:true }).fill('91.5');
  await page.getByLabel('Start date (UTC)', { exact:true }).fill('2026-09-22T05:15');
  await page.getByRole('combobox', { name:'Weekly weather', exact:true }).selectOption('15000');
  await page.getByLabel('Yearly valley weight growth (%)', { exact:true }).fill('1.25');
  await page.getByLabel('Seed carry available (CROP)', { exact:true }).fill('23456.78');
  await page.getByLabel('Granary available (CROP)', { exact:true }).fill('8765432.1');
  await page.getByRole('button', { name:'Calculate forecast', exact:true }).click();
  await expect(page.getByRole('heading', { name:'Harvest without reinvesting', exact:true })).toBeVisible();
  const submitted = (await saved(page)).scenario;
  expect(submitted).toMatchObject({
    externalWeight:'91.5',
    start:'2026-09-22T05:15:00.000Z',
    weatherBps:15000,
    annualGrowthPct:'1.25',
    carryCrop:'23456.78',
    granaryCrop:'8765432.1',
  });

  fixture.release();
  await expect(page.locator('#forecast-source')).not.toContainText('Checking');
  await expect(page.getByRole('heading', { name:'Harvest without reinvesting', exact:true })).toBeVisible();
  expect((await saved(page)).scenario).toMatchObject(submitted);
});

test('Use chain defaults explicitly replaces custom valley weight, timing, weather and reserve assumptions', async ({ page }) => {
  const fixture = await installSeasonRpc(page, {
    blockTimestamp:genesis - 3600,
    weatherEnum:2n,
    effectiveMultiplierBps:20000n,
    totalWeightBps:0n,
    carryCrop:units('22.5'),
    granaryCrop:units('333.75'),
  });
  await setTestClock(page, genesis - 3585);
  await page.goto('/');
  await openForecast(page);
  expectPinnedReads(fixture.calls);
  await openAdvanced(page);

  await page.getByLabel('Additional valley weight (optional)', { exact:true }).fill('12');
  await page.getByLabel('Start date (UTC)', { exact:true }).fill('2026-09-22T12:30');
  await page.getByRole('combobox', { name:'Weekly weather', exact:true }).selectOption('10000');
  await page.getByRole('checkbox', {name:'Use known weeks',exact:true}).uncheck();
  await page.getByLabel('Yearly valley weight growth (%)', { exact:true }).fill('9');
  await page.getByLabel('Seed carry available (CROP)', { exact:true }).fill('8');
  await page.getByLabel('Granary available (CROP)', { exact:true }).fill('7');
  await page.getByLabel('CROP buy price in ETH (optional)', { exact:true }).fill('0.000001');
  await page.getByLabel('CROP sale price in ETH (optional)', { exact:true }).fill('0.000002');
  await page.getByRole('button', { name:'Use chain defaults', exact:true }).click();
  await expect(page.locator('#forecast-source')).not.toContainText('Checking');

  await expect(page.getByLabel('Additional valley weight (optional)', { exact:true })).toHaveValue('0');
  await expect(page.getByLabel('Start date (UTC)', { exact:true })).toHaveValue(new Date(genesis * 1000).toISOString().slice(0,16));
  await expect(page.getByRole('combobox', { name:'Weekly weather', exact:true })).toHaveValue('10000');
  await expect(page.getByRole('checkbox', {name:'Use known weeks',exact:true})).toBeChecked();
  expect((await saved(page)).scenario.weatherWeeks.map(w=>[w.epoch,w.multiplier_bps])).toEqual([[0,15000]]);
  await expect(page.getByLabel('Yearly valley weight growth (%)', { exact:true })).toHaveValue('0');
  await expect(page.getByLabel('Seed carry available (CROP)', { exact:true })).toHaveValue('22.5');
  await expect(page.getByLabel('Granary available (CROP)', { exact:true })).toHaveValue('333.75');
});

test('partial chain fields fall back independently while available weather and reserves still apply', async ({ page }) => {
  await installSeasonRpc(page, {
    blockTimestamp:genesis - 3600,
    weatherEnum:2n,
    effectiveMultiplierBps:10000n,
    totalWeightBps:99999999n,
    carryCrop:units('87654'),
    granaryCrop:units('54321'),
    failedReads:['totalWeight','carryNow','bagPrice'],
  });
  await setTestClock(page, genesis - 3585);
  await page.goto('/');
  await addModelPlots(page, { count:1, tier:'0' });
  await openForecast(page);

  await expect(page.getByLabel('Additional valley weight (optional)', { exact:true })).toHaveValue('0');
  await expect(page.getByLabel('Start date (UTC)', { exact:true })).toHaveValue(new Date(genesis * 1000).toISOString().slice(0,16));
  await expect(page.getByRole('combobox', { name:'Weekly weather', exact:true })).toHaveValue('10000');
  expect((await saved(page)).scenario.weatherWeeks.map(w=>[w.epoch,w.multiplier_bps])).toEqual([[0,15000]]);
  await openAdvanced(page);
  await expect(page.getByLabel('Seed carry available (CROP)', { exact:true })).toHaveValue('0');
  await expect(page.getByLabel('Granary available (CROP)', { exact:true })).toHaveValue('40000000');
  await expect(page.getByLabel('CROP buy price in ETH (optional)', { exact:true })).toHaveValue('0.0000004');
  await expect(page.getByLabel('CROP sale price in ETH (optional)', { exact:true })).toHaveValue('0.0000004');
});

test('a legacy explicit weather scenario stays a whole-term assumption until known weeks are selected', async ({ page }) => {
  await installSeasonRpc(page, {blockTimestamp:genesis - 3600, weatherEnum:1n});
  await setTestClock(page, genesis - 3585);
  const scenario = {...defaults(), externalWeight:'42', weatherBps:8000, start:new Date(genesis * 1000).toISOString()};
  delete scenario.useKnownWeather;
  delete scenario.weatherWeeks;
  await page.addInitScript(data => localStorage.setItem('yield-farm-public-v2',JSON.stringify(data)), {
    schema_version:2, portfolio:emptyPortfolio(), scenario, days:30,
  });
  await page.goto('/');
  await openForecast(page);
  await expect(page.getByRole('combobox', {name:'Weekly weather',exact:true})).toHaveValue('8000');
  await expect(page.getByRole('checkbox', {name:'Use known weeks',exact:true})).not.toBeChecked();
  expect((await saved(page)).scenario.useKnownWeather).toBe(false);
  await page.getByRole('button', {name:'Use chain defaults',exact:true}).click();
  await expect(page.getByRole('checkbox', {name:'Use known weeks',exact:true})).toBeChecked();
  await expect(page.getByRole('combobox', {name:'Weekly weather',exact:true})).toHaveValue('10000');
});
