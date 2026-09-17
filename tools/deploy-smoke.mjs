import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defaults, emptyPortfolio, UNIT, weight } from '../src/model.js';

const [origin, release, output] = process.argv.slice(2);
assert.equal(origin, 'https://farm.pagzi.tech');
assert.match(release, /^\d{8}T\d{6}Z-[a-f0-9]{12}$/);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const errors = [], external = [], workers = [];
  const page = await context.newPage();
  // Deployment checks the fallback path deterministically; live chain reads are
  // independent of application availability and never a release requirement.
  await page.route('https://robinhood-rpc.publicnode.com/**', route => route.abort());
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && ![origin, 'https://robinhood-rpc.publicnode.com'].includes(new URL(request.url()).origin)) external.push(request.url());
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'ethereum', { get() { throw new Error('Deployment smoke must not access a wallet'); } });
  });
  await page.goto(origin, { waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => window.isSecureContext), true);
  await expect(page.getByRole('heading', { name: 'Bring your farm' })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(3);
  assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), 'Desktop workspace must fit viewport');
  await expect(page.locator(`script[src="/releases/${release}/app.js"]`)).toHaveCount(1);
  await page.locator('img').evaluateAll(async images => { await Promise.all(images.map(image => image.decode())); });
  if (output) {
    await mkdir(resolve(output), { recursive: true });
    await page.screenshot({ path: resolve(output, `${release}-desktop.png`), fullPage: true });
  }

  // An isolated browser owns only this explicitly hypothetical farm.
  const portfolio = emptyPortfolio(), wallet = portfolio.wallets[0];
  wallet.crop_balance_wei = (5000n * UNIT).toString();
  wallet.eth_balance_wei = UNIT.toString();
  wallet.plots = [{ token_id: 1, rarity_tier: 3, level: 1, is_active: true,
    effective_weight_bps: weight(3, 1), pending_crop_wei: '0', modifiers: [] }];
  wallet.expected_plot_count = 1; portfolio.expected_total_plots = 1;
  const now = new Date('2026-09-22T12:00:00Z');
  await page.clock.setFixedTime(now);
  await page.evaluate(data => localStorage.setItem('yield-farm-public-v2', JSON.stringify(data)), {
    schema_version: 2, days: 90, portfolio, profile_seeded: true, autoRefresh: false, history: [],
    scenario: { ...defaults(), start: now.toISOString(), externalWeight: '1000', feeMode: 'zero' },
    activePlan: { enabled: false, days: 90, funding: 'harvest', objective: 'crop', feeMode: 'zero', useObservedWeight: false, extraSpent: '0' },
  });
  await page.reload();
  await page.getByRole('tab', { name: 'Yield forecast', exact: true }).click();
  await page.getByRole('button', { name: 'Calculate forecast', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Harvest without reinvesting', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'My farm', exact: true }).click();
  await page.getByRole('button', { name: 'Open active plan', exact: true }).click();
  await page.getByRole('button', { name: 'Save & build plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Selected policy and alternatives' })).toBeVisible({ timeout: 60000 });
  assert.ok(workers.includes(`${origin}/releases/${release}/plan-worker.js`), 'Planner must use its matching immutable worker');
  await expect(page.locator('#active-review')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 391), 'Mobile page must fit viewport');
  assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), 'Mobile workspace must fit viewport');
  await expect(page.getByRole('button', { name: /Edit plan settings/ })).toBeVisible();
  if (output) await page.screenshot({ path: resolve(output, `${release}-mobile-plan.png`), fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(`Live browser verified: HTTPS, empty intake, artwork, forecast, release-scoped worker, active plan, mobile layout (${release})`);
} finally {
  await browser.close();
}
