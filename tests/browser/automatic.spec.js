import { test, expect } from '@playwright/test';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, parseAbi } from 'viem';
import { defaults, emptyPortfolio, rules, UNIT, units, weight } from '../../src/model.js';
import integrations from '../../knowledge/integrations.json' with { type:'json' };
import commitment from '../../knowledge/snapshots/manifest-comparison-2026-09-07.json' with { type:'json' };
import manifest from '../../knowledge/snapshots/manifest-2026-09-07.json' with { type:'json' };
import reviewedNft from '../../knowledge/snapshots/verified-contracts-2026-09-11/nft.json' with { type:'json' };
import reviewedWeather from '../../knowledge/snapshots/verified-contracts-2026-09-11/weather.json' with { type:'json' };
import { fulfillRpcBatch, rpcError, rpcResult } from '../fixtures.js';
import { openDetails, openForecastSettings, openMainTab, openUtility } from './navigation.js';

const STORAGE = 'yield-farm-public-v2';
const RPC_PATTERN = 'https://robinhood-rpc.publicnode.com/**';
const A = '0x0000000000000000000000000000000000000001';
const NOW = new Date('2026-09-22T12:00:00Z');
const BLOCK_NUMBER = 64800000;
const BLOCK_TAG = `0x${BLOCK_NUMBER.toString(16)}`;
const GENESIS = rules.schedule.genesis_timestamp;
const TIER = manifest[1].tier;
const HASH = `0x${'a'.repeat(64)}`;
const ZERO = `0x${'0'.repeat(40)}`;

const readAbis = Object.fromEntries(Object.entries(integrations.contracts).filter(([, contract]) => Array.isArray(contract.read_signatures)).map(([key, contract]) => [key, parseAbi([
  ...contract.read_signatures,
  ...(key === 'nft' ? ['function tiersFinalized() view returns (bool)'] : []),
  ...(key === 'emissions' ? ['function desiredWeight(uint256 tokenId) view returns (uint256)'] : []),
])]));
const weatherAbi = parseAbi([...integrations.contracts.weather.read_signatures, 'event WeatherScheduled(uint256 indexed epoch, uint8 weather)']);
const addresses = Object.fromEntries(Object.entries(integrations.contracts).map(([key, contract]) => [key, contract.address.toLowerCase()]));
const runtime = { nft: reviewedNft.runtimeBytecode.onchainBytecode, weather: reviewedWeather.runtimeBytecode.onchainBytecode };
const hex = value => `0x${BigInt(value).toString(16)}`;

function modelPortfolio({ active = false } = {}) {
  const portfolio = emptyPortfolio();
  const plot = {
    token_id: 1,
    rarity_tier: TIER,
    level: 1,
    is_active: active,
    effective_weight_bps: active ? weight(TIER, 1) : 0,
    pending_crop_wei: '0',
    modifiers: [],
    reveal_status: 'hypothetical',
    evidence_source: 'manual-hypothesis',
  };
  portfolio.wallets[0].plots = [plot];
  portfolio.wallets[0].expected_plot_count = 1;
  portfolio.expected_total_plots = 1;
  return portfolio;
}

function automaticWorkspace() {
  return {
    schema_version: 2,
    simulationMode: 'automatic',
    forecastDefaultsVersion: 2,
    portfolio: modelPortfolio(),
    scenario: defaults(),
    days: 90,
    forecastManual: [],
    saved_at: NOW.toISOString(),
  };
}

function customWorkspace({ explicitMode = true } = {}) {
  const scenario = {
    ...defaults(),
    start: NOW.toISOString(),
    externalWeight: '1234',
    weatherBps: 15000,
    carryCrop: '12',
    granaryCrop: '34',
    buyPrice: '0.000001',
    sellPrice: '0.000002',
  };
  const value = {
    schema_version: 2,
    forecastDefaultsVersion: 2,
    portfolio: modelPortfolio(),
    scenario,
    days: 12,
    forecastManual: ['start', 'externalWeight', 'weatherBps', 'carryCrop', 'granaryCrop', 'buyPrice', 'sellPrice', 'useKnownWeather'],
    saved_at: NOW.toISOString(),
  };
  if (explicitMode) value.simulationMode = 'custom';
  return value;
}

async function installWallet(page) {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(account => {
    const mock = { account, providerReads: 0, requests: [] };
    const provider = { request: async ({ method, params }) => {
      mock.requests.push({ method, params });
      if (method === 'eth_requestAccounts') return [mock.account];
      if (method === 'eth_sendTransaction') throw new Error('Estimates must not submit transactions.');
      throw new Error(`Unexpected wallet request: ${method}`);
    } };
    window.__walletMock = mock;
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      get() { mock.providerReads++; return provider; },
    });
  }, A);
}

function readValue(key, name, args = []) {
  if (name === 'tokensOfOwner') return args[0].toLowerCase() === A ? [1n] : [];
  if (name === 'balanceOf') return 0n;
  if (name === 'ownerOf') return A;
  if (name === 'activation' || name === 'transferHook') return integrations.contracts.activation.address;
  if (name === 'activationClearer') return ZERO;
  if (name === 'rarity') return integrations.contracts.nft.address;
  if (name === 'crop') return integrations.contracts.crop.address;
  if (name === 'nft') return integrations.contracts.nft.address;
  if (name === 'emissions') return integrations.contracts.emissions.address;
  if (name === 'levels') return integrations.contracts.levels.address;
  if (name === 'weather') return integrations.contracts.weather.address;
  if (name === 'treasury') return integrations.contracts.treasury.address;
  if (name === 'start' || name === 'epochStart') return BigInt(GENESIS);
  if (name === 'currentEpoch') return 0n;
  if (name === 'nextBoundary') return BigInt(GENESIS + rules.weather.period_seconds);
  if (name === 'multiplierNow') return 12000n;
  if (name === 'weatherOf') return 1n;
  if (name === 'floodActive' || name === 'moonActive' || name === 'paused') return false;
  if (name === 'moonCount') return 0n;
  if (name === 'moons') return BigInt(GENESIS);
  if (name === 'commitHash') return HASH;
  if (name === 'manifestHash') return commitment.on_chain_hash;
  if (name === 'startingIndex') return 1n;
  if (name === 'tiersFinalized') return true;
  if (name === 'totalSupply') return 1n;
  if (name === 'rarityTier') return BigInt(TIER);
  if (name === 'levelOf') return 1n;
  if (name === 'isActive') return false;
  if (name === 'desiredWeight' || name === 'weightOf' || name === 'pending') return 0n;
  if (name === 'totalWeight') return 0n;
  if (name === 'carryNow' || name === 'emitted' || name === 'paidOut') return 0n;
  if (name === 'granaryNow') return 40_000_000n * UNIT;
  if (name === 'farmRatePerSec') return 0n;
  if (name === 'RATE_PER_WEIGHT_PER_WEEK') return 2_000n * UNIT;
  if (name === 'foundingWeekEnd') return BigInt(GENESIS + rules.weather.period_seconds);
  if (name === 'firstSoilEnd') return BigInt(GENESIS + 28 * 86400);
  if (name === 'FEE') return 2_500n * UNIT;
  if (name === 'BURN_BPS') return 6_000n;
  if (name === 'BAG_BURN') return 1_500n * UNIT;
  if (name === 'MAX_BAG_PRICE') return 10n ** 16n;
  if (name === 'bagPrice') return units('0.001');
  if (name === 'bagOpen') return true;
  if (name === 'decimals') return 18;
  if (name === 'allowance') return 0n;
  if (name === 'costToReach') return BigInt(rules.levels.entries[Number(args[0]) - 1].incremental_upgrade_cost_crop) * UNIT;
  if (name === 'token0') return integrations.contracts.wrapped_eth.address;
  if (name === 'token1') return integrations.contracts.crop.address;
  if (name === 'fee') return 3_000n;
  if (name === 'liquidity') return 1n;
  if (name === 'slot0') return [2n ** 96n, 0, 0, 0, 0, 0, true];
  throw new Error(`No fixture value for ${key}.${name}`);
}

async function mockAutomaticRpc(page) {
  const calls = [];
  await page.route(RPC_PATTERN, route => fulfillRpcBatch(route, async request => {
    calls.push(request);
    try {
      let result;
      if (request.method === 'eth_chainId') result = '0x1237';
      else if (request.method === 'eth_getBlockByNumber') result = { number: BLOCK_TAG, hash: `0x${'b'.repeat(64)}`, timestamp: hex(NOW.getTime() / 1000) };
      else if (request.method === 'eth_getBalance') result = hex(UNIT);
      else if (request.method === 'eth_getCode') {
        const key = Object.entries(addresses).find(([, address]) => address === request.params[0].toLowerCase())?.[0];
        result = runtime[key] ?? '0x00';
      } else if (request.method === 'eth_getLogs') {
        result = [{
          address: integrations.contracts.weather.address,
          blockNumber: hex(integrations.contracts.weather.deployment_block + 1),
          transactionHash: `0x${'1'.repeat(64)}`,
          logIndex: '0x0',
          removed: false,
          topics: encodeEventTopics({ abi: weatherAbi, eventName: 'WeatherScheduled', args: { epoch: 0n } }),
          data: encodeAbiParameters([{ type: 'uint8' }], [1]),
        }];
      } else if (request.method === 'eth_call') {
        const [call, block] = request.params;
        if (block !== BLOCK_TAG) throw new Error(`Expected pinned block ${BLOCK_TAG}.`);
        const entry = Object.entries(addresses).find(([, address]) => address === call.to.toLowerCase());
        if (!entry) throw new Error(`Unknown fixture contract ${call.to}`);
        const [key] = entry;
        const abi = readAbis[key];
        const { functionName, args } = decodeFunctionData({ abi, data: call.data });
        result = encodeFunctionResult({ abi, functionName, result: readValue(key, functionName, args) });
      } else {
        throw new Error(`Unexpected RPC method ${request.method}`);
      }
      return rpcResult(request, result);
    } catch (error) {
      return rpcError(request, error, -32601);
    }
  }));
  await page.route('https://api.rh.farm/**', route => route.fulfill({ json: { name: 'Fixture plot', attributes: [] } }));
  return { calls };
}

async function saved(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE);
}

test('automatic empty landing stays offline until a wallet or model is chosen', async ({ page }) => {
  const rpcRequests = [];
  await page.route(RPC_PATTERN, route => route.abort());
  await page.addInitScript(() => {
    window.__walletMock = { reads: 0 };
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      get() { window.__walletMock.reads++; throw new Error('Wallet access is opt-in.'); },
    });
  });
  page.on('request', request => { if (request.url().startsWith('https://robinhood-rpc.publicnode.com/')) rpcRequests.push(request); });
  await page.goto('/');

  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'automatic');
  await expect(page.getByRole('heading', { name: 'Bring your farm', exact: true })).toBeVisible();
  await expect(page.locator('#connect-farm')).toBeVisible();
  await expect(page.locator('#quick-farm')).toBeHidden();
  expect(await page.evaluate(() => window.__walletMock.reads)).toBe(0);
  expect(rpcRequests).toHaveLength(0);
});

test('connect requests only the account, keeps a dormant raw snapshot, and calculates automatic harvest and upgrades', async ({ page }) => {
  await installWallet(page);
  const rpc = await mockAutomaticRpc(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Your plots', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.plot-card .tiny-status')).toHaveText('Dormant');
  await openMainTab(page, 'Yield forecast');
  await expect(page.locator('.automatic-harvest')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.automatic-harvest .forecast-value')).toContainText('CROP');
  await expect(page.locator('#assumptions')).toHaveCount(0);
  await expect(page.locator('#add-wallet [name=label]')).toHaveCount(0);
  await expect(page.locator('.automatic-details')).toContainText('30% participation estimate');

  await openMainTab(page, 'Upgrade planner');
  await expect(page.locator('.automatic-upgrades')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Compare upgrades', exact: true })).toBeVisible();
  await expect(page.locator('#assumptions')).toHaveCount(0);

  const state = await saved(page);
  const plot = state.portfolio.wallets[0].plots[0];
  expect(state.portfolio.block_number).toBe(BLOCK_NUMBER);
  expect(plot).toMatchObject({ is_active: false, effective_weight_bps: 0 });
  expect(plot.forecast_preview).toBeUndefined();
  expect(state.portfolio.forecast_preview).toBeUndefined();
  expect(await page.evaluate(() => window.__walletMock.requests.map(request => request.method))).toEqual(['eth_requestAccounts']);
  expect(await page.evaluate(() => window.__walletMock.providerReads)).toBe(1);
  expect(rpc.calls.some(request => request.method === 'eth_sendTransaction')).toBe(false);
  expect(rpc.calls.some(request => request.method === 'eth_accounts')).toBe(false);
  const pinned = rpc.calls.filter(request => request.method === 'eth_call');
  expect(pinned.length).toBeGreaterThan(10);
  expect(pinned.every(request => request.params[1] === BLOCK_TAG)).toBe(true);
});

test('automatic horizon shortcuts recalculate, and custom forecast can be restored without a wallet action', async ({ page }) => {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: STORAGE, value: automaticWorkspace() });
  await page.goto('/');
  await openMainTab(page, 'Yield forecast');
  await expect(page.locator('.automatic-harvest')).toBeVisible({ timeout: 30_000 });
  const before = await page.locator('.automatic-harvest .forecast-value').innerText();
  await page.getByRole('button', { name: '1 month', exact: true }).click();
  await expect(page.locator('.automatic-harvest .eyebrow')).toContainText('30-day estimate');
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)).days, STORAGE)).toBe(30);
  expect(await page.locator('.automatic-harvest .forecast-value').innerText()).not.toBe(before);

  await openDetails(page, 'details.automatic-details');
  await page.locator('#customize-forecast').click();
  await expect(page.locator('#assumptions')).toBeVisible();
  await expect(page.locator('#automatic-forecast')).toBeVisible();
  await openDetails(page, '#harvest-limits');
  await page.locator('#assumptions [name=externalWeight]').fill('4321');
  await page.locator('#assumptions [name=days]').fill('14');
  await page.getByRole('button', { name: 'Calculate forecast', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Harvest without reinvesting', exact: true })).toBeVisible();
  expect((await saved(page)).simulationMode).toBe('custom');
  expect((await saved(page)).scenario.externalWeight).toBe('4321');
  expect((await saved(page)).days).toBe(14);

  await openForecastSettings(page);
  await page.locator('#automatic-forecast').click();
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'automatic');
  await expect(page.locator('#assumptions')).toHaveCount(0);
  expect((await saved(page)).simulationMode).toBe('automatic');
  expect(await page.evaluate(() => window.__walletMock?.requests ?? [])).toEqual([]);
});

test('imported manual settings are preserved and a legacy scenario without a mode is inferred as custom', async ({ page }) => {
  await page.route(RPC_PATTERN, route => route.abort());
  await page.goto('/');
  await openUtility(page, 'files');
  const legacy = customWorkspace({ explicitMode: false });
  delete legacy.forecastManual;
  await page.locator('#import-file').setInputFiles({ name: 'legacy-custom.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
  await expect(page.getByText('Farm imported. Ready for a fresh forecast.', { exact: true })).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'custom');
  await openMainTab(page, 'Yield forecast');
  await openForecastSettings(page);
  await expect(page.locator('#assumptions [name=externalWeight]')).toHaveValue('1234');
  await expect(page.locator('#assumptions [name=weatherBps]')).toHaveValue('15000');
  await expect(page.locator('#assumptions [name=days]')).toHaveValue('12');
  expect((await saved(page)).simulationMode).toBe('custom');
  expect((await saved(page)).scenario.externalWeight).toBe('1234');
  expect((await saved(page)).scenario.buyPrice).toBe('0.000001');
});

test('automatic imports regenerate expired economics without rewriting dormant holdings', async ({page}) => {
  await page.clock.setFixedTime(NOW);
  const value=automaticWorkspace();
  value.scenario={...value.scenario,start:'2026-09-21T00:00:00.000Z',rewardObservedAt:'2026-09-21T00:00:00.000Z',rewardStateBasis:'observed',carryCrop:'123456',granaryCrop:'40000000',externalWeight:'99999',buyPrice:'0.9',sellPrice:'0.9'};
  await page.goto('/');await openUtility(page,'files');
  await page.locator('#import-file').setInputFiles({name:'old-automatic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  await openMainTab(page,'Yield forecast');await expect(page.locator('.automatic-harvest')).toBeVisible();
  const state=await saved(page);
  expect(state.scenario.start).toBe(NOW.toISOString());
  expect(state.scenario.carryCrop).toBe('0');expect(state.scenario.granaryCrop).toBe('0');
  expect(state.scenario.rewardStateBasis).toBe('assumption');
  expect(state.scenario.buyPrice).not.toBe('0.9');
  expect(state.scenario.externalWeight).not.toBe('99999');
  expect(state.portfolio).toEqual(value.portfolio);
});
