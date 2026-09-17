import { test, expect } from '@playwright/test';
import { defaults, emptyPortfolio, UNIT, weight } from '../../src/model.js';
import { NETWORK } from '../../src/reader.js';
import { RPC_ABORT, fulfillRpcBatch, rpcError, rpcResult } from '../fixtures.js';
import { openMainTab, openWallets } from './navigation.js';

const ADDRESS = '0x0000000000000000000000000000000000000001';
const NOW = new Date('2026-09-15T12:00:00Z');
const STORAGE = 'yield-farm-public-v2';
const RPC_PATTERN = `${NETWORK.rpc_url.replace(/\/$/, '')}/**`;

function priorWorkspace() {
  const portfolio = emptyPortfolio();
  portfolio.is_demo = false;
  portfolio.observed_at_utc = NOW.toISOString();
  portfolio.block_number = 100;
  portfolio.block_timestamp = NOW.getTime() / 1000;
  portfolio.wallets[0].address = ADDRESS;
  portfolio.wallets[0].crop_balance_wei = (123n * UNIT).toString();
  portfolio.wallets[0].eth_balance_wei = UNIT.toString();
  portfolio.wallets[0].plots = [{
    token_id: 1, owner_address: ADDRESS, rarity_tier: 0, level: 1, is_active: true,
    effective_weight_bps: weight(0, 1), pending_crop_wei: (7n * UNIT).toString(),
    modifiers: [], reveal_status: 'revealed', observed_at_utc: NOW.toISOString(), block_number: 100,
  }];
  portfolio.wallets[0].expected_plot_count = 1;
  portfolio.expected_total_plots = 1;
  return {
    schema_version: 2,
    portfolio,
    scenario: { ...defaults(), start: NOW.toISOString() },
    days: 90,
    activePlan: { enabled: false },
  };
}

async function seed(page, data = priorWorkspace()) {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(({ data, storage }) => {
    localStorage.setItem(storage, JSON.stringify(data));
  }, { data, storage: STORAGE });
}

async function installPartialRpc(page, { abortFirstChain = false } = {}) {
  const calls = [];
  let chainAttempts = 0;
  await page.route(RPC_PATTERN, route => fulfillRpcBatch(route, async request => {
    calls.push(request);
    if (abortFirstChain && request.method === 'eth_chainId' && chainAttempts++ === 0) {
      return RPC_ABORT;
    }
    if (request.method === 'eth_chainId') {
      return rpcResult(request, '0x1237');
    }
    if (request.method === 'eth_getBlockByNumber') {
      return rpcResult(request, { number: '0x64', timestamp: '0x68c6c400' });
    }
    return rpcError(request, 'Fixture read unavailable', -32602);
  }));
  return calls;
}

test('a partial wallet read keeps the exact saved snapshot and blocks active-plan review', async ({ page }) => {
  await seed(page);
  await installPartialRpc(page);
  await page.goto('/');
  const before = await page.evaluate(key => localStorage.getItem(key), STORAGE);

  await openWallets(page);
  await page.getByRole('button', { name: 'Refresh wallet data', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Some data could not be verified');
  await expect(page.getByRole('alert')).toContainText('Previous wallet snapshot kept');
  await expect(page.getByRole('alert')).toContainText('UTC');
  await expect(page.getByText('Farm refreshed', { exact: false })).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE)).toBe(before);

  await openMainTab(page, 'Upgrade planner');
  await expect(page.locator('#active-review')).toHaveCount(0);
});

test('a transient browser fetch failure retries through the website reader before reporting the later partial read', async ({ page }) => {
  await seed(page);
  const calls = await installPartialRpc(page, { abortFirstChain: true });
  await page.goto('/');
  await openWallets(page);
  await page.getByRole('button', { name: 'Refresh wallet data', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Some data could not be verified');
  expect(calls.filter(request => request.method === 'eth_chainId')).toHaveLength(2);
  expect(calls.some(request => request.method === 'eth_getBlockByNumber')).toBe(true);
});
