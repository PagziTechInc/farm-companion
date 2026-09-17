import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { decodeFunctionData, encodeFunctionResult } from 'viem';
import { defaults, emptyPortfolio, rules, UNIT } from '../../src/model.js';
import { EXECUTION_DEPLOYMENTS } from '../../src/execution.js';

const A = '0x0000000000000000000000000000000000000001', B = '0x0000000000000000000000000000000000000002', FOREIGN = '0x0000000000000000000000000000000000000003';
const HASH = `0x${'a'.repeat(64)}`, BLOCK = `0x${'b'.repeat(64)}`, ZERO = `0x${'0'.repeat(40)}`;
const NOW = new Date('2026-09-22T12:00:00Z'), STORAGE = 'yield-farm-companion-v1';
const hex = value => `0x${BigInt(value).toString(16)}`;
const target = key => EXECUTION_DEPLOYMENTS[key].address;
const contracts = Object.fromEntries(await Promise.all(Object.keys(EXECUTION_DEPLOYMENTS).map(async key => [key, JSON.parse(await readFile(new URL(`../../knowledge/snapshots/verified-contracts/${key}.json`, import.meta.url), 'utf8'))])));

function workspace(withPlot = false) {
  const portfolio = emptyPortfolio(); portfolio.is_demo = false; portfolio.is_template = false;
  portfolio.observed_at_utc = NOW.toISOString(); portfolio.block_number = 100; portfolio.block_timestamp = NOW.getTime() / 1000;
  portfolio.wallets.forEach((wallet, i) => { wallet.address = i ? B : A; wallet.crop_balance_wei = '0'; wallet.eth_balance_wei = UNIT.toString(); });
  if (withPlot) portfolio.wallets[0].plots = [{ token_id: 1, owner_address: A, rarity_tier: 0, level: 1, is_active: true, effective_weight_bps: 10000,
    pending_crop_wei: (100n * UNIT).toString(), modifiers: null, observed_at_utc: NOW.toISOString(), block_number: 100, reveal_status: 'revealed' }];
  return { schema_version: 1, portfolio, scenario: defaults(), profile_seeded: true, autoRefresh: false, history: [] };
}

async function initialize(page, data = workspace(), { account = A, chain = 4663 } = {}) {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(({ data, account, chain, storage, hash }) => {
    if (location.hostname === '127.0.0.1' && !localStorage.getItem(storage)) localStorage.setItem(storage, JSON.stringify(data));
    window.__walletMock = { account, chain, reads: 0, requests: [] };
    const provider = { request: async ({ method, params }) => {
      const mock = window.__walletMock; mock.requests.push({ method, params });
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [mock.account];
      if (method === 'eth_chainId') return `0x${mock.chain.toString(16)}`;
      if (method === 'wallet_switchEthereumChain') { mock.chain = 4663; return null; }
      if (method === 'eth_sendTransaction') {
        const saved = JSON.parse(localStorage.getItem(storage));
        if (saved.pendingExecution?.phase !== 'broadcast_unknown') throw new Error('Missing durable pre-broadcast lock');
        sessionStorage.setItem('mock-last-tx', JSON.stringify({ ...params[0], input: params[0].data, hash }));
        return hash;
      }
      throw new Error(`Unexpected wallet request: ${method}`);
    } };
    Object.defineProperty(window, 'ethereum', { configurable: true, get() { window.__walletMock.reads++; return provider; } });
  }, { data, account, chain, storage: STORAGE, hash: HASH });
}

async function mockContracts(page) {
  const state = { mined: false, methods: [], replacementHash: null, cancelled: false };
  await page.route('https://rpc.mainnet.chain.robinhood.com/rpc', async route => {
    const { id, method, params } = route.request().postDataJSON(); state.methods.push(method);
    try {
      let result;
      if (method === 'eth_chainId') result = hex(4663);
      else if (method === 'eth_getBlockByNumber') result = { number: '0x64', hash: BLOCK, timestamp: hex(NOW.getTime() / 1000) };
      else if (method === 'eth_getBalance') result = hex(UNIT);
      else if (method === 'eth_gasPrice') result = '0xa';
      else if (method === 'eth_estimateGas') result = hex(50000);
      else if (method === 'eth_getTransactionCount') result = '0x0';
      else if (method === 'eth_getTransactionByHash') result = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mock-last-tx')));
      else if (method === 'eth_getTransactionReceipt') result = state.mined ? { transactionHash: state.replacementHash ?? HASH, from: A, to: state.cancelled ? A : target('emissions'), status: '0x1', blockNumber: '0x64', blockHash: BLOCK, gasUsed: '0x5208', effectiveGasPrice: '0xa' } : null;
      else if (method === 'eth_getCode') result = contracts[Object.keys(contracts).find(key => target(key) === params[0].toLowerCase())].runtimeBytecode.onchainBytecode;
      else if (method === 'eth_call') {
        const tx = params[0], key = Object.keys(contracts).find(key => target(key) === tx.to.toLowerCase()), abi = contracts[key].abi;
        const { functionName: name, args } = decodeFunctionData({ abi, data: tx.data });
        let output;
        if (name === 'activation' || name === 'transferHook') output = target('activation');
        else if (name === 'activationClearer') output = ZERO;
        else if (name === 'rarity') output = target('nft');
        else if (['crop', 'nft', 'emissions', 'levels', 'weather'].includes(name)) output = target(name);
        else if (name === 'treasury') output = '0x778aa5BD0b28829b7C27eb3957C2D33848125D85';
        else if (name === 'start' || name === 'epochStart') output = BigInt(rules.schedule.genesis_timestamp);
        else if (name === 'FEE') output = 2500n * UNIT;
        else if (name === 'BURN_BPS') output = 6000n;
        else if (name === 'decimals') output = 18;
        else if (name === 'paused' || name === 'floodActive' || name === 'moonActive') output = false;
        else if (name === 'levelOf') output = 1;
        else if (name === 'isActive' || name === 'tiersFinalized') output = true;
        else if (name === 'ownerOf') output = A;
        else if (name === 'pending' || name === 'claim') output = state.mined ? 0n : 100n * UNIT;
        else if (name === 'balanceOf' || name === 'allowance') output = 0n;
        else if (name === 'tokensOfOwner') output = args[0].toLowerCase() === A ? [1n] : [];
        else if (name === 'rarityTier' || name === 'currentEpoch' || name === 'moonCount') output = 0;
        else if (name === 'desiredWeight' || name === 'weightOf' || name === 'totalWeight') output = 10000n;
        else if (name === 'costToReach') output = BigInt(rules.levels.entries[Number(args[0]) - 1].incremental_upgrade_cost_crop) * UNIT;
        else throw new Error(`Read not needed in this fixture: ${key}.${name}`);
        result = encodeFunctionResult({ abi, functionName: name, result: output });
      } else throw new Error(`Unexpected RPC method ${method}`);
      await route.fulfill({ json: { jsonrpc: '2.0', id, result } });
    } catch (error) { await route.fulfill({ json: { jsonrpc: '2.0', id, error: { code: -32603, message: error.message } } }); }
  });
  await page.route('https://api.rh.farm/**', route => route.fulfill({ json: { name: 'Fixture plot', attributes: [] } }));
  await page.route('https://api.coinbase.com/**', route => route.fulfill({ json: { data: { base: 'ETH', currency: 'USD', amount: '2500' } } }));
  return state;
}

test('premint guided plan keeps wallets separate and touches MetaMask only after explicit connection', async ({ page }) => {
  await initialize(page, workspace(), { account: FOREIGN }); await page.goto('/');
  await page.getByRole('button', { name: 'Guided plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Prepare the launch', exact: true })).toBeVisible();
  await expect(page.getByText(/55,000 CROP for initial planting/)).toBeVisible();
  await expect(page.getByText('Wallet not connected', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__walletMock.reads)).toBe(0);
  await page.getByRole('button', { name: 'Connect MetaMask', exact: true }).click();
  await expect(page.getByText(/Select one of your two configured wallets/)).toBeVisible();
  await page.evaluate(({ account }) => { window.__walletMock.account = account; window.__walletMock.chain = 1; }, { account: A });
  await page.getByRole('button', { name: 'Connect MetaMask', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch to Robinhood Chain', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__walletMock.requests.some(r => r.method === 'wallet_switchEthereumChain'))).toBe(false);
  await page.getByRole('button', { name: 'Switch to Robinhood Chain', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Human approval' })).toContainText('chain 4663');
  expect(await page.evaluate(() => window.__walletMock.requests.some(r => r.method === 'eth_sendTransaction'))).toBe(false);
});

test('fictional guided plan shows baseline, three stress cases and rare-plot tradeoffs without enabling transactions', async ({ page }) => {
  await initialize(page); await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await page.getByRole('button', { name: 'Guided plan', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh & rebuild plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Returns and stress cases', exact: true })).toBeVisible();
  for (const label of ['No upgrades · current assumptions', 'Competition doubles', 'Locusts throughout', 'Exit CROP price halves']) await expect(page.getByRole('cell', { name: label, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Where the next CROP works hardest', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare & simulate next action', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__walletMock.reads)).toBe(0);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export active plan', exact: true }).click();
  const report = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(report.portfolio.is_demo).toBe(true); expect(report.plan.stress).toHaveLength(3); expect(report.plan.scenario.start).toBe(NOW.toISOString());
  await page.screenshot({ path: 'artifacts/dashboard-guided-plan.png', fullPage: true });
});

test('manual claim requires review and one wallet approval, persists its lock across reload, and settles without follow-on sends', async ({ page }) => {
  await initialize(page, workspace(true)); const rpc = await mockContracts(page); await page.goto('/');
  await page.getByRole('button', { name: 'Guided plan', exact: true }).click();
  await page.getByText('Review a specific action', { exact: true }).click();
  await page.getByRole('button', { name: 'Prepare manual action', exact: true }).click();
  await expect(page.getByText('Simulation passed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request MetaMask approval', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__walletMock.reads)).toBe(0);
  expect(rpc.methods).toContain('eth_estimateGas');
  await page.getByRole('button', { name: 'Connect MetaMask', exact: true }).click();
  await page.getByRole('button', { name: 'Request MetaMask approval', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Outstanding claim · pending', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__walletMock.requests.filter(r => r.method === 'eth_sendTransaction').length)).toBe(1);
  expect(await page.evaluate(storage => JSON.parse(localStorage.getItem(storage)).pendingExecution.hash, STORAGE)).toBe(HASH);
  await page.reload(); await page.getByRole('button', { name: 'Guided plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Outstanding claim · pending', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__walletMock.reads)).toBe(0);
  await page.getByText('Review a specific action', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Prepare manual action', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Check transaction', exact: true }).click();
  await expect(page.getByText(/Still awaiting a matching receipt/)).toBeVisible();
  rpc.mined = true; await page.getByRole('button', { name: 'Check transaction', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'confirmed', exact: true })).toBeVisible();
  expect(await page.evaluate(storage => JSON.parse(localStorage.getItem(storage)).pendingExecution, STORAGE)).toBeNull();
  expect(await page.evaluate(() => window.__walletMock.requests.some(r => r.method === 'eth_sendTransaction'))).toBe(false);
});

test('Tampermonkey guided plan connects lazily through its explicit page-provider adapter', async ({ page }) => {
  await page.route('https://rh.farm/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body><h1>Game fixture</h1></body></html>' }));
  await page.goto('https://rh.farm/');
  await page.evaluate(({ data, account }) => {
    window.__providerReads = 0; window.__providerRequests = [];
    const provider = { request: async ({ method }) => { window.__providerRequests.push(method); if (method === 'eth_requestAccounts') return [account]; if (method === 'eth_chainId') return '0x1237'; throw new Error('Unexpected provider call'); } };
    window.unsafeWindow = {};
    Object.defineProperty(window.unsafeWindow, 'ethereum', { get() { window.__providerReads++; return provider; } });
    Object.defineProperty(window, 'ethereum', { get() { throw new Error('Use the configured userscript provider adapter'); } });
    let saved = JSON.stringify(data);
    window.GM_getValue = () => saved; window.GM_setValue = (_, value) => { saved = value; };
    window.GM_xmlhttpRequest = () => { throw new Error('No network expected without explicit refresh'); };
  }, { data: workspace(), account: A });
  await page.addScriptTag({ content: await readFile('dist/yield-farm-companion.user.js', 'utf8') });
  await page.getByRole('button', { name: 'Open Farm Companion', exact: true }).click();
  await page.getByRole('button', { name: 'Guided plan', exact: true }).click();
  expect(await page.evaluate(() => window.__providerReads)).toBe(0);
  await page.getByRole('button', { name: 'Connect MetaMask', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Human approval' })).toContainText(A);
  expect(await page.evaluate(() => window.__providerRequests)).toEqual(['eth_requestAccounts', 'eth_chainId']);
});

test('a mined MetaMask cancellation clears the pending lock and journals replaced rather than completed', async ({ page }) => {
  await initialize(page, workspace(true)); const rpc = await mockContracts(page); await page.goto('/');
  await page.getByRole('button', { name: 'Guided plan', exact: true }).click();
  await page.getByRole('button', { name: 'Connect MetaMask', exact: true }).click();
  await page.getByText('Review a specific action', { exact: true }).click();
  await page.getByRole('button', { name: 'Prepare manual action', exact: true }).click();
  await expect(page.getByText('Simulation passed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Request MetaMask approval', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Outstanding claim · pending', exact: true })).toBeVisible();
  const replacementHash = `0x${'c'.repeat(64)}`;
  await page.evaluate(({ hash, address }) => {
    const old = JSON.parse(sessionStorage.getItem('mock-last-tx'));
    sessionStorage.setItem('mock-last-tx', JSON.stringify({ ...old, hash, to: address, input: '0x', data: '0x' }));
  }, { hash: replacementHash, address: A });
  rpc.mined = true; rpc.cancelled = true; rpc.replacementHash = replacementHash;
  await page.getByText('MetaMask speed-up or cancellation', { exact: true }).click();
  await page.getByLabel('Replacement transaction hash', { exact: true }).fill(replacementHash);
  await page.getByRole('button', { name: 'Check replacement', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'replaced', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'confirmed', exact: true })).toHaveCount(0);
  expect(await page.evaluate(storage => JSON.parse(localStorage.getItem(storage)).pendingExecution, STORAGE)).toBeNull();
  expect(await page.evaluate(() => window.__walletMock.requests.filter(r => r.method === 'eth_sendTransaction').length)).toBe(1);
});
