import { test, expect, chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { emptyPortfolio, defaults } from '../../src/model.js';
import { openUtility } from './navigation.js';

test('unpacked Chrome extension installs, keeps farm storage isolated, calculates and reaches the page wallet only on request', async () => {
  test.setTimeout(60000);
  const path = resolve('dist-extension');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
    viewport: { width: 1440, height: 1000 },
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    await context.route('https://robinhood-rpc.publicnode.com/**', route => route.abort());
    expect(JSON.parse(await readFile(`${path}/manifest.json`, 'utf8')).manifest_version).toBe(3);
    const page = await context.newPage();
    const external = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https:\/\//.test(request.url()) && !request.url().startsWith('https://rh.farm/')) external.push(request.url()); });
    await context.route('https://rh.farm/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Game fixture</title></head><body style="background:#0f1a0f"><p>Yield Farm fixture</p></body></html>' }));
    await page.addInitScript(() => {
      if (location.origin !== 'https://rh.farm') return;
      window.__providerCalls = [];
      window.ethereum = { request: async ({ method }) => {
        window.__providerCalls.push(method);
        if (window.__rejectWallet) { const error = new Error('User rejected the request.'); error.code = 4001; throw error; }
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['0x0000000000000000000000000000000000000001'];
        if (method === 'eth_chainId') return '0x1237';
        throw new Error('Unexpected provider method in installation test');
      } };
    });
    await page.goto('https://rh.farm/');
    await page.getByRole('button', { name: 'Open Farm Companion', exact: true }).click();
    const panel = page.frameLocator('iframe[title="Farm Companion"]');
    await expect(panel.getByRole('heading', { name: /Your farm\.\s*Your game plan\./ })).toBeVisible();
    const frame = page.frames().find(frame => frame.url() === `chrome-extension://${extensionId}/companion.html`);
    expect(frame).toBeTruthy();
    await panel.locator('img').evaluateAll(async nodes => { await Promise.all(nodes.map(image => image.decode())); });
    await panel.locator('.model-builder > summary').click();
    await panel.getByRole('button', { name: 'Add model plots', exact: true }).click();
    await panel.getByRole('tab', { name: 'Yield forecast', exact: true }).click();
    await expect(panel.locator('.automatic-harvest')).toBeVisible();
    await expect(panel.locator('.automatic-rate')).toContainText('CROP / day');
    await expect(panel.locator('#assumptions')).toHaveCount(0);
    await panel.getByRole('tab',{name:'Upgrade planner',exact:true}).click();
    await panel.getByRole('button',{name:'Active plan',exact:true}).click();
    await expect(panel.locator('#active-plan-fee-mode')).toHaveCount(0);
    await panel.getByRole('button',{name:'Build plan',exact:true}).click();
    await expect(panel.getByRole('heading',{name:'Selected policy and alternatives'})).toBeVisible();
    await expect(panel.locator('#active-review')).toHaveCount(0);
    expect(await page.evaluate(() => window.__providerCalls)).toEqual([]);
    expect(external).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('yield-farm-extension-v2'))).toBeNull();
    expect(await frame.evaluate(() => JSON.parse(localStorage.getItem('yield-farm-extension-v2')).portfolio.wallets[0].plots.length)).toBe(1);
    await page.reload();
    await page.getByRole('button', { name: 'Open Farm Companion', exact: true }).click();
    await expect(panel.getByRole('heading', { name: 'Your plots', exact: true })).toBeVisible();
    const currentFrame = page.frames().find(frame => frame.url().includes('/companion.html'));
    const portfolio = emptyPortfolio();
    portfolio.wallets[0].address = '0x0000000000000000000000000000000000000001';
    await currentFrame.evaluate(data => localStorage.setItem('yield-farm-extension-v2', JSON.stringify(data)), { schema_version: 2, portfolio, scenario: defaults(), days: 90 });
    await currentFrame.evaluate(() => location.reload());
    await openUtility(panel,'actions');
    await panel.getByRole('button', { name: 'Connect MetaMask', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__providerCalls)).toEqual(['eth_requestAccounts', 'eth_chainId']);
    await expect(panel.getByRole('region', { name: 'Optional wallet actions' })).toContainText('4663');
    await page.evaluate(() => { window.__rejectWallet = true; });
    const rejected = await currentFrame.evaluate(() => chrome.runtime.sendMessage({ type: 'farm-companion-wallet', request: { method: 'eth_requestAccounts' } }));
    expect(rejected).toMatchObject({ ok: false, error: { code: 4001 } });
    const unsupported = await currentFrame.evaluate(() => chrome.runtime.sendMessage({ type: 'farm-companion-wallet', request: { method: 'personal_sign', params: [] } }));
    expect(unsupported.ok).toBe(false);
    await panel.getByRole('tab', { name: 'My farm', exact: true }).click();
    await panel.getByRole('tab', { name: 'My farm', exact: true }).press('Escape');
    await expect(page.getByRole('button', { name: 'Open Farm Companion', exact: true })).toBeFocused();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
