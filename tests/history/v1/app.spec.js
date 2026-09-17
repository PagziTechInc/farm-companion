import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { seasonRPC } from '../fixtures/season-rpc.js';
import { emptyPortfolio, defaults } from '../../src/model.js';

test.beforeEach(async ({ page }) => {
  const blank = JSON.stringify({portfolio:emptyPortfolio(),scenario:defaults(),profile_seeded:true});
  await page.addInitScript(value => { if (location.hostname === '127.0.0.1' && !localStorage.getItem('yield-farm-companion-v1')) localStorage.setItem('yield-farm-companion-v1', value); }, blank);
});

test('configured wallet profile loads into an untouched workspace without inventing plots', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(value => localStorage.setItem('yield-farm-companion-v1', value), JSON.stringify({portfolio:emptyPortfolio(),scenario:defaults()}));
  await page.reload();
  await expect(page.getByLabel('Public wallet address').first()).toHaveValue('0x1111111111111111111111111111111111111111');
  await expect(page.getByLabel('Public wallet address').nth(1)).toHaveValue('0x2222222222222222222222222222222222222222');
  await expect(page.getByRole('region',{name:'Actions needed'})).toContainText('0.049983 ETH');
  await expect(page.getByRole('region',{name:'Actions needed'})).toContainText('27,500');
  await page.screenshot({path:'artifacts/dashboard-funded.png',fullPage:true});
});

test('cyclic allocation and searchable research keep hypothetical IDs separate from holdings', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#allocation-result')).toContainText('18.78%');
  await page.getByLabel('Hypothetical token IDs', { exact: true }).fill('1, 2');
  await page.getByRole('button', { name: 'Evaluate offsets', exact: true }).click();
  await expect(page.locator('#allocation-result')).toContainText('3333 hash residues');
  await page.getByLabel('Apply verified zero → one reveal mapping').uncheck();
  await page.getByRole('button', { name: 'Evaluate offsets', exact: true }).click();
  await expect(page.locator('#allocation-result')).toContainText('3333 offsets');
  await page.getByRole('button', { name: 'Your plots', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your plots will appear here' })).toBeVisible();
  await page.getByRole('button', { name: 'Research answers', exact: true }).click();
  await expect(page.locator('[data-question]')).toHaveCount(10);
  await page.getByLabel('Search research answers', { exact: true }).fill('fertilizer');
  await expect(page.locator('[data-question]:visible')).toHaveCount(1);
  await expect(page.locator('[data-question]:visible')).toContainText('Not yet published');
  await page.screenshot({ path: 'artifacts/dashboard-research.png', fullPage: true });
});

test('weather planner runs in the shared engine and exports its assumptions', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await page.getByRole('button', { name: 'Strategy lab', exact: true }).click();
  await page.getByText('Weather event planner', { exact: true }).click();
  await page.getByLabel('Event start (UTC)', { exact: true }).fill('2026-09-21T12:00:00Z');
  await page.getByRole('button', { name: 'Add hypothetical event', exact: true }).click();
  expect(JSON.parse(await page.getByLabel('Planned events (JSON)', { exact: true }).inputValue())).toEqual([{ type:'flood', start:'2026-09-21T12:00:00Z' }]);
  await page.getByRole('button', { name: 'Compare strategies', exact: true }).click();
  await expect(page.getByRole('heading', { name:'Best among evaluated strategies' })).toBeVisible();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name:'Export results', exact:true }).click();
  const report = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(report.scenario.weatherEvents).toHaveLength(1);
  expect(report.results[0].bestCrop.assumptions.join(' ')).toContain('Granary exhaustion is not modeled');
});

test('public season refresh works before mint without wallets and survives reload', async ({ page }) => {
  const fixture = seasonRPC({ count: 0n });
  await page.route('https://rpc.mainnet.chain.robinhood.com/rpc', route => route.fulfill({ json: fixture.respond(route.request().postDataJSON()) }));
  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Public season' });
  await expect(panel).toContainText('Bundled historical snapshot');
  await page.getByRole('button', { name: 'Refresh season', exact: true }).click();
  await expect(panel).toContainText('Saved public read');
  await expect(panel).toContainText('Block 42');
  await expect(panel).toContainText('Sunny');
  await expect(page.getByLabel('Public wallet address').first()).toHaveValue('');
  await panel.getByText('Prepare for 22 unminted plots', { exact: true }).click();
  await expect(panel).toContainText('0.044 ETH');
  await expect(panel).toContainText('19.7%');
  await page.reload(); await expect(panel).toContainText('Block 42');
  await page.route('https://rpc.mainnet.chain.robinhood.com/rpc', route => route.abort());
  await page.getByRole('button', { name: 'Refresh season', exact: true }).click();
  await expect(page.getByText(/Season refresh failed/)).toBeVisible();
  await expect(panel).toContainText('Block 42');
  await page.screenshot({ path: 'artifacts/dashboard-season.png', fullPage: true });
});

test('welcome, manual intake, reload and nondestructive demo', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Make every plot count.' })).toBeVisible();
  await page.getByLabel('Public wallet address').first().fill('0x0000000000000000000000000000000000000001');
  await page.getByRole('button', { name: 'Save wallet A' }).click();
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await expect(page.getByText('DEMO PORTFOLIO', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Your plots', exact: true }).click();
  await expect(page.locator('[data-plot-row]')).toHaveCount(22);
  await page.reload();
  await expect(page.getByText('DEMO PORTFOLIO', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Public wallet address').first()).toHaveValue('0x0000000000000000000000000000000000000001');
  await page.getByRole('button', { name: 'Your plots', exact: true }).click();
  await page.getByRole('button', { name: 'Add your first plot' }).click();
  await page.getByLabel('Token ID', { exact: true }).fill('99');
  await page.getByLabel('Rarity', { exact: true }).selectOption('3');
  await page.getByLabel('Activation', { exact: true }).selectOption('false');
  await page.getByLabel('Pending CROP', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Save plot', exact: true }).click();
  await expect(page.locator('[data-plot-row]')).toHaveCount(1);
  await expect(page.locator('[data-plot-row]')).toContainText('Golden Acre');
});
test('demo calculates all horizons, exports and compares wallet arrangements', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await page.getByRole('button', { name: 'Strategy lab', exact: true }).click();
  await page.getByRole('button', { name: 'Compare strategies', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Best among evaluated strategies' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your selected scenario' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'CROP', exact: true })).toHaveCount(6);
  await expect(page.getByText('365 days', { exact: true })).toHaveCount(2);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export ledger' }).click();
  const downloaded = await download;
  const ledger = JSON.parse(await readFile(await downloaded.path(), 'utf8'));
  expect(ledger.selected.actions.some(a => a.type === 'plant')).toBeTruthy();
  await page.getByRole('button', { name: 'Compare wallet arrangements' }).click();
  await expect(page.getByRole('dialog', { name: 'Wallet arrangement comparison' })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'artifacts/dashboard-strategy.png', fullPage: true });
});
test('invalid imports are rejected and cannot inject page content', async ({ page }) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Import', exact: true }).click();
  await (await chooser).setFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schema_version":99}') });
  await expect(page.getByText(/Import rejected; workspace unchanged/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Make every plot count.' })).toBeVisible();
});
test('mobile layout fits viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make every plot count.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'artifacts/dashboard-mobile.png', fullPage: true });
});
test('Tampermonkey bundle opens on game origin, computes and closes without wallet access', async ({ page }) => {
  await page.route('https://rh.farm/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body><h1>Game fixture</h1></body></html>' }));
  await page.goto('https://rh.farm/');
  await page.evaluate(() => {
    window.GM_getValue = () => null; window.GM_setValue = () => {};
    window.GM_xmlhttpRequest = () => { throw Error('Unexpected network access in offline demo'); };
    Object.defineProperty(window, 'ethereum', { get() { throw Error('Wallet provider must not be touched'); } });
  });
  await page.addScriptTag({ content: await readFile('dist/yield-farm-companion.user.js', 'utf8') });
  await page.getByRole('button', { name: 'Open Farm Companion', exact: true }).click();
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await page.getByRole('button', { name: 'Strategy lab', exact: true }).click();
  await page.getByRole('button', { name: 'Compare strategies', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Best among evaluated strategies' })).toBeVisible();
  await page.getByRole('button', { name: 'Close Farm Companion', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Best among evaluated strategies' })).not.toBeVisible();
});
