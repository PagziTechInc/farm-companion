import { encodeFunctionData, decodeFunctionData, decodeFunctionResult, keccak256, parseAbi } from 'viem';
import integrations from '../knowledge/integrations.json' with { type: 'json' };
import { rules, UNIT, validatePortfolio, weight } from './model.js';
import { isForecastPreview } from './forecast-portfolio.js';

// Source and runtime independently matched at block 60,592,342, September 11, 2026.
export const EXECUTION_DEPLOYMENTS = Object.freeze({
  "emissions": {
    "address": "0x8ed784b4772ae3fdefafaa746fe405eb0410cdf3",
    "hash": "0x010e25777f65ea0e83d2c39cee3b969951ffc86de0461ef23680ad01ddcea8b2"
  },
  "levels": {
    "address": "0x4804043472416241d2334ecb3684fa179791bf8c",
    "hash": "0x6b1005360575356eeaa099a08aeadbf9a0a525dcfc28e58d73e809920ad09eb4"
  },
  "nft": {
    "address": "0x481ba120a6632714d8c872d1f4b6b57c8769dc21",
    "hash": "0xa8bebed3f9ea474e01f95396bbb92b406005293d274b96ecd8ce646b4d17e493"
  },
  "weather": {
    "address": "0xd45919b30bdac5f810a18434b3aac9c2d7093c67",
    "hash": "0x715eeaafd15d174f204a6a71db458404e57b92b103c12f1af9a03538043118e1"
  },
  "crop": {
    "address": "0x6cfaf2f60f47182f0c9f5d199db92ab261a9d487",
    "hash": "0x1be44955cd2dae7359a6bd961da2ad9a8cb55041962d5b60fb2190488297e37d"
  },
  "activation": {
    "address": "0xc7455c9dc27b3b5ceecbb3941e50185f17625431",
    "hash": "0xbb1c60f4aa1cbf0814d8f0b3c5cab929e5d7d08fe57389f71eb9f75b54941a0a"
  }
});
Object.values(EXECUTION_DEPLOYMENTS).forEach(Object.freeze);
const ABI = parseAbi([
  'function ownerOf(uint256) view returns (address)', 'function activation() view returns (address)',
  'function crop() view returns (address)', 'function nft() view returns (address)', 'function emissions() view returns (address)',
  'function levels() view returns (address)', 'function weather() view returns (address)', 'function rarity() view returns (address)',
  'function treasury() view returns (address)', 'function transferHook() view returns (address)', 'function activationClearer() view returns (address)',
  'function start() view returns (uint256)', 'function epochStart(uint256) view returns (uint256)',
  'function paused() view returns (bool)', 'function FEE() view returns (uint256)', 'function BURN_BPS() view returns (uint256)',
  'function levelOf(uint256) view returns (uint8)', 'function costToReach(uint8) view returns (uint256)',
  'function tiersFinalized() view returns (bool)', 'function rarityTier(uint256) view returns (uint8)',
  'function desiredWeight(uint256) view returns (uint256)', 'function weightOf(uint256) view returns (uint256)',
  'function isActive(uint256) view returns (bool)', 'function pending(uint256) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)',
  'function decimals() view returns (uint8)', 'function approve(address,uint256) returns (bool)',
  'function plant(uint256)', 'function plantWithBag(uint256) payable', 'function upgrade(uint256)',
  'function bagPrice() view returns (uint256)', 'function bagOpen() view returns (bool)', 'function BAG_BURN() view returns (uint256)',
  'function claim(uint256) returns (uint256)', 'function claimMany(uint256[]) returns (uint256)',
]);
const CHAIN = 4663, CHAIN_HEX = '0x1237', ZERO = `0x${'0'.repeat(40)}`;
const clone = value => structuredClone(value);
const address = value => typeof value === 'string' && /^0x[\da-f]{40}$/i.test(value) && value.toLowerCase() !== ZERO;
const hash = value => typeof value === 'string' && /^0x[\da-f]{64}$/i.test(value);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const hex = value => `0x${BigInt(value).toString(16)}`;
const uint = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) && value.length <= 78 && BigInt(value) < 2n ** 256n;
const target = key => EXECUTION_DEPLOYMENTS[key].address;
const dataFor = (functionName, args) => encodeFunctionData({ abi: ABI, functionName, args });

function configuredAddresses(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 20 || !values.every(address) || new Set(values.map(v=>v.toLowerCase())).size !== values.length) throw new Error('Configure 1–20 distinct public wallet addresses.');
  return values.map(value => value.toLowerCase());
}

function normalizeIntent(intent, portfolio) {
  if(isForecastPreview(portfolio))throw new Error('Forecast previews cannot authorize transactions. Refresh the actual wallet holdings.');
  const errors = validatePortfolio(portfolio, false);
  if (errors.length) throw new Error(errors.join(' '));
  if (portfolio.is_demo !== false || portfolio.is_template === true) throw new Error('Execution requires your real holdings; demo/template transactions are disabled.');
  configuredAddresses(portfolio.wallets.map(w => w.address).filter(Boolean));
  if (!intent || !['plant', 'plant_bag', 'upgrade', 'claim'].includes(intent.type)) throw new Error('Only planting, one-level upgrades and claims are supported.');
  // Claims synchronize stale weights in the reviewed contract. Keep investment
  // recommendations blocked, while allowing a freshly verified claim to repair state.
  if (intent.type !== 'claim' && portfolio.rule_conflicts?.length) throw new Error('Resolve the portfolio rule conflicts before executing.');
  if (Object.keys(intent).some(key => !['type', 'wallet_id', 'plot_id', 'plot_ids'].includes(key))) throw new Error('Intent contains unsupported fields; arbitrary transaction targets are disabled.');
  const wallet = portfolio.wallets.find(w => w.id === intent.wallet_id);
  if (!wallet || !address(wallet.address)) throw new Error('Select a configured public wallet.');
  if (intent.plot_id != null && intent.plot_ids != null) throw new Error('Use one plot ID field.');
  const ids = intent.plot_ids ?? [intent.plot_id];
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => !Number.isInteger(id) || id < 1 || id > 3333) || new Set(ids).size !== ids.length) throw new Error('Select unique plot IDs from 1 to 3333.');
  if (intent.type !== 'claim' && ids.length !== 1) throw new Error('Plant and upgrade one plot per approval.');
  if (ids.some(id => !wallet.plots.some(plot => plot.token_id === id))) throw new Error('Every selected plot must be in the chosen wallet holdings.');
  return { type: intent.type, wallet_id: wallet.id, plot_ids: [...ids].sort((a, b) => a - b) };
}

/** Validate persisted locks. Importing a lock can never generate a transaction. */
export function validatePendingRecord(record) {
  if (record == null) return null;
  if (!record || typeof record !== 'object' || record.chain_id !== CHAIN || !address(record.from) || !address(record.to)
    || (record.hash != null && !hash(record.hash)) || !uint(record.nonce) || !uint(record.gas_limit) || !uint(record.gas_price_wei)
    || !Number.isSafeInteger(record.created_at) || record.created_at < 0 || !['pending', 'broadcast_unknown'].includes(record.phase) || (record.phase === 'pending' && !hash(record.hash))
    || !['approve', 'plant', 'plant_bag', 'upgrade', 'claim'].includes(record.type) || !['plant', 'plant_bag', 'upgrade', 'claim'].includes(record.requested_type)
    || typeof record.wallet_id !== 'string' || !/^[\w-]{1,64}$/.test(record.wallet_id)
    || !Array.isArray(record.plot_ids) || !record.plot_ids.length || record.plot_ids.length > 100
    || record.plot_ids.some(id => !Number.isInteger(id) || id < 1 || id > 3333) || new Set(record.plot_ids).size !== record.plot_ids.length) throw new Error('Invalid pending transaction record.');
  const expectedTarget = record.type === 'approve' ? target('crop') : ['plant','plant_bag'].includes(record.type) ? target('activation') : record.type === 'upgrade' ? target('levels') : target('emissions');
  if (record.type !== 'plant_bag' && record.value_wei != null && record.value_wei !== '0') throw new Error('Unexpected ETH value in pending action.');
  if (!same(record.to, expectedTarget)) throw new Error('Pending transaction target is not an approved game contract.');
  let decoded;
  try { decoded = decodeFunctionData({ abi: ABI, data: record.data }); } catch { throw new Error('Invalid pending transaction calldata.'); }
  const ids = record.plot_ids.map(BigInt);
  let expectedData;
  if (record.type === 'approve') {
    if (!['plant', 'upgrade'].includes(record.requested_type) || ids.length !== 1 || !uint(record.approval_amount_wei)) throw new Error('Invalid pending token approval.');
    const legalCosts = record.requested_type === 'plant' ? [rules.planting.cost_crop] : rules.levels.entries.slice(1).map(level => level.incremental_upgrade_cost_crop);
    if (!legalCosts.some(cost => BigInt(cost) * UNIT === BigInt(record.approval_amount_wei))) throw new Error('Only exact published CROP approvals can be restored.');
    expectedData = dataFor('approve', [target(record.requested_type === 'plant' ? 'activation' : 'levels'), BigInt(record.approval_amount_wei)]);
  } else {
    if (record.requested_type !== record.type || (record.type !== 'claim' && ids.length !== 1)) throw new Error('Pending action does not match its intent.');
    if (record.type === 'plant_bag' && (!uint(record.value_wei) || BigInt(record.value_wei) <= 0n || BigInt(record.value_wei) > 10n**16n)) throw new Error('Invalid pending seed-bag price.');
    if (record.type !== 'plant_bag' && record.value_wei != null && record.value_wei !== '0') throw new Error('Unexpected ETH value in pending action.');
    expectedData = dataFor(record.type === 'plant_bag' ? 'plantWithBag' : record.type === 'claim' && ids.length > 1 ? 'claimMany' : record.type, record.type === 'claim' && ids.length > 1 ? [ids] : ids);
  }
  if (!decoded || !same(record.data, expectedData)) throw new Error('Pending calldata does not match the recorded action.');
  return clone(record);
}

/** Public reads until explicit connect/submit. No provider lookup at construction. */
export function createExecutor({ rpc, getProvider, now = Date.now, onPending = () => {} }) {
  if (typeof rpc !== 'function' || typeof getProvider !== 'function') throw new Error('Executor requires public RPC and a lazy wallet provider.');
  let provider, configured = [], draft = null, pending = null, busy = false;
  const state = { connected: false, account: null, chain_id: null, phase: 'idle', last_receipt: null };
  const status = () => clone({ ...state, pending });
  const unlocked = () => { if (busy || pending) throw new Error('Finish or reconcile the outstanding transaction before preparing another action.'); };
  async function persistPending(value) { await onPending(clone(value)); pending = value; }
  async function connect(values) {
    const allowed = configuredAddresses(values);
    provider ??= await getProvider();
    if (!provider || typeof provider.request !== 'function') throw new Error('No injected wallet found. Open this page in a browser with MetaMask.');
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    const chain = Number(BigInt(await provider.request({ method: 'eth_chainId' })));
    if (!Array.isArray(accounts) || !address(accounts[0]) || !allowed.includes(accounts[0].toLowerCase())) throw new Error('Select one of your configured wallets in MetaMask, then connect again.');
    configured = allowed;
    Object.assign(state, { connected: true, account: accounts[0].toLowerCase(), chain_id: chain });
    return status();
  }
  async function switchChain() {
    if (!provider || !state.connected) throw new Error('Connect your configured MetaMask wallet first.');
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
    state.chain_id = Number(BigInt(await provider.request({ method: 'eth_chainId' })));
    if (state.chain_id !== CHAIN) throw new Error('MetaMask did not switch to Robinhood Chain.');
    return status();
  }
  async function walletCheck(from) {
    if (!provider || !state.connected) throw new Error('Connect the selected configured wallet before submitting.');
    const [accounts, chainHex] = await Promise.all([provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' })]);
    const chain = Number(BigInt(chainHex));
    state.account = accounts?.[0]?.toLowerCase() ?? null; state.chain_id = chain;
    if (chain !== CHAIN) throw new Error('Switch MetaMask to Robinhood Chain (4663), then prepare again.');
    if (!configured.includes(from) || !same(accounts?.[0], from)) throw new Error('The active MetaMask account does not match this action wallet.');
  }
  async function build(intent, portfolio) {
    const normalized = normalizeIntent(intent, portfolio), wallet = portfolio.wallets.find(w => w.id === normalized.wallet_id), from = wallet.address.toLowerCase();
    if (Number(BigInt(await rpc('eth_chainId', []))) !== CHAIN) throw new Error('Public RPC is not Robinhood Chain (4663).');
    const block = await rpc('eth_getBlockByNumber', ['latest', false]);
    if (!hash(block?.hash) || !/^0x[\da-f]+$/i.test(block.number ?? '') || !/^0x[\da-f]+$/i.test(block.timestamp ?? '')) throw new Error('RPC block identity is incomplete.');
    const tag = block.number, timestamp = Number(BigInt(block.timestamp));
    if (!Number.isSafeInteger(timestamp) || Math.abs(now() / 1000 - timestamp) > 120) throw new Error('RPC block is stale; execution requires a current chain observation.');
    const read = async (key, functionName, args = []) => {
      const data = await rpc('eth_call', [{ to: target(key), data: dataFor(functionName, args) }, tag]);
      return decodeFunctionResult({ abi: ABI, functionName, data });
    };
    const activation = await read('emissions', 'activation');
    if (!same(activation, target('activation'))) throw new Error('Activation deployment changed; review its source before any approval.');
    await Promise.all(Object.entries(EXECUTION_DEPLOYMENTS).map(async ([key, expected]) => {
      const code = await rpc('eth_getCode', [expected.address, tag]);
      if (typeof code !== 'string' || !/^0x(?:[\da-f]{2})+$/i.test(code) || keccak256(code) !== expected.hash) throw new Error(`${key} runtime differs from the source-reviewed deployment.`);
    }));
    const links = [['activation', 'crop', 'crop'], ['activation', 'nft', 'nft'], ['activation', 'emissions', 'emissions'],
      ['levels', 'crop', 'crop'], ['levels', 'nft', 'nft'], ['levels', 'emissions', 'emissions'],
      ['emissions', 'crop', 'crop'], ['emissions', 'nft', 'nft'], ['emissions', 'levels', 'levels'], ['emissions', 'weather', 'weather'],
      ['emissions', 'rarity', 'nft'], ['nft', 'transferHook', 'activation']];
    await Promise.all(links.map(async ([key, name, expected]) => { if (!same(await read(key, name), target(expected))) throw new Error(`${key}.${name} contract link changed.`); }));
    const [treasury, clearer, start, epochStart, decimals, fee, burn, paused, levelsPaused, balance, nativeBalance, nonceHex] = await Promise.all([
      read('activation', 'treasury'), read('nft', 'activationClearer'), read('emissions', 'start'), read('weather', 'epochStart', [0n]), read('crop', 'decimals'),
      read('activation', 'FEE'), read('activation', 'BURN_BPS'), read('emissions', 'paused'), read('levels', 'paused'),
      read('crop', 'balanceOf', [from]), rpc('eth_getBalance', [from, tag]).then(BigInt), rpc('eth_getTransactionCount', [from, 'pending']),
    ]);
    if (!same(treasury, integrations.contracts.treasury.address) || !same(clearer, ZERO)) throw new Error('NFT or planting configuration changed; refresh the source review.');
    if (start !== BigInt(rules.schedule.genesis_timestamp) || epochStart !== start || Number(decimals) !== 18 || fee !== BigInt(rules.planting.cost_crop) * UNIT || burn !== BigInt(rules.planting.burn_bps)) throw new Error('Live costs or Genesis differ from the cached Almanac rules.');
    if (normalized.type !== 'claim' && timestamp < Number(start)) throw new Error('The Almanac opens planting at Genesis. This companion waits until then, although the contract allows earlier calls.');
    if (normalized.type === 'claim' && paused) throw new Error('Harvest claims are currently paused.');
    if (normalized.type === 'upgrade' && levelsPaused) throw new Error('Upgrades are currently paused.');
    if (normalized.type !== 'claim' && !(await read('nft', 'tiersFinalized'))) throw new Error('Rarity tiers are not finalized. Wait for on-chain tier finalization before investing through this companion.');
    const plots = await Promise.all(normalized.plot_ids.map(async id => {
      const [owner, level, active, pendingCrop] = await Promise.all([read('nft', 'ownerOf', [BigInt(id)]), read('levels', 'levelOf', [BigInt(id)]), read('activation', 'isActive', [BigInt(id)]), read('emissions', 'pending', [BigInt(id)])]);
      if (!same(owner, from)) throw new Error(`Plot ${id} is no longer owned by the selected wallet.`);
      if (Number(level) < 1 || Number(level) > 5) throw new Error(`Plot ${id} has an unsupported level.`);
      const cached = wallet.plots.find(plot => plot.token_id === id);
      if ((cached.level != null && cached.level !== Number(level)) || (cached.is_active != null && cached.is_active !== active)) throw new Error(`Plot ${id} changed since the wallet snapshot; refresh and review the plan.`);
      let tier = null, effectiveWeight = null;
      if (normalized.type !== 'claim') {
        const [currentTier, desired, effective] = await Promise.all([read('nft', 'rarityTier', [BigInt(id)]), read('emissions', 'desiredWeight', [BigInt(id)]), read('emissions', 'weightOf', [BigInt(id)])]);
        tier = Number(currentTier); effectiveWeight = effective.toString();
        if (!Number.isInteger(cached.rarity_tier) || cached.rarity_tier !== tier || tier < 0 || tier > 3) throw new Error(`Plot ${id} rarity is unknown or changed; refresh the wallet and review its ranking.`);
        const expected = BigInt(active ? weight(tier, Number(level)) : 0);
        if (desired !== expected || effective !== desired || (cached.effective_weight_bps != null && BigInt(cached.effective_weight_bps) !== effective)) throw new Error(`Plot ${id} weight needs synchronization or differs from the planning rules; resolve this before investment.`);
      }
      return { id, owner: owner.toLowerCase(), level: Number(level), active, tier, effective_weight: effectiveWeight, pending: pendingCrop };
    }));
    let cost = 0n, nativeCost = 0n, allowance = null, type = normalized.type, to = target('emissions'), args = normalized.plot_ids.map(BigInt), functionName = type;
    if (type === 'claim') {
      if (plots.reduce((sum, plot) => sum + plot.pending, 0n) <= 0n) throw new Error('These plots have no claimable CROP at the checked block.');
      if (args.length > 1) { functionName = 'claimMany'; args = [args]; }
    } else if (type === 'plant_bag') {
      if (plots[0].active) throw new Error('This plot is already planted.');
      const [bagOpen, bagPrice, bagBurn, treasuryBalance, treasuryAllowance] = await Promise.all([
        read('activation','bagOpen'), read('activation','bagPrice'), read('activation','BAG_BURN'),
        read('crop','balanceOf',[treasury]), read('crop','allowance',[treasury,target('activation')])
      ]);
      if (!bagOpen || bagPrice <= 0n || bagPrice > 10n**16n) throw new Error('Seed bags are closed or their price is outside the reviewed limit.');
      if (bagBurn !== 1500n*UNIT || treasuryBalance < bagBurn || treasuryAllowance < bagBurn) throw new Error('The treasury cannot fund this seed bag burn at the checked block.');
      nativeCost = bagPrice; to = target('activation'); functionName = 'plantWithBag';
    } else {
      if (type === 'plant' && plots[0].active) throw new Error('This plot is already planted.');
      if (type === 'upgrade' && plots[0].level >= 5) throw new Error('This plot is already at maximum level.');
      cost = type === 'plant' ? fee : await read('levels', 'costToReach', [plots[0].level + 1]);
      if (type === 'upgrade' && cost !== BigInt(rules.levels.entries[plots[0].level].incremental_upgrade_cost_crop) * UNIT) throw new Error('Live upgrade cost differs from the Almanac.');
      if (balance < cost) throw new Error(`The selected wallet needs ${(cost - balance) / UNIT} more whole CROP plus any fractional shortfall. Claim or acquire funds, refresh, then prepare again.`);
      to = target(type === 'plant' ? 'activation' : 'levels');
      allowance = await read('crop', 'allowance', [from, to]);
      if (allowance < cost) { args = [to, cost]; to = target('crop'); type = functionName = 'approve'; }
    }
    const data = dataFor(functionName, args), tx = { from, to, data, value: hex(nativeCost) };
    const simulation = await rpc('eth_call', [tx, tag]);
    const simulated = decodeFunctionResult({ abi: ABI, functionName, data: simulation });
    if (type === 'approve' && simulated !== true) throw new Error('Token approval simulation did not return success.');
    const [gasHex, priceHex] = await Promise.all([rpc('eth_estimateGas', [tx, tag]), rpc('eth_gasPrice', [])]);
    const gas = BigInt(gasHex), gasPrice = BigInt(priceHex), gasLimit = (gas * 120n + 99n) / 100n;
    if (gas <= 0n || gasPrice < 0n || gasLimit >= 2n ** 64n) throw new Error('RPC gas estimate is invalid.');
    if (nativeBalance < nativeCost + gasLimit * gasPrice) throw new Error('The selected wallet lacks native ETH for the quoted gas limit.');
    const checked = await rpc('eth_getBlockByNumber', [tag, false]);
    if (!same(checked?.hash, block.hash)) throw new Error('The prepared block was reorganized; prepare a fresh action.');
    const view = { type, requested_type: normalized.type, wallet_id: wallet.id, plot_ids: normalized.plot_ids, from, to, data, value: nativeCost.toString(), value_wei: nativeCost.toString(), chain_id: CHAIN,
      crop_cost_wei: type === 'approve' ? '0' : cost.toString(), intended_crop_cost_wei: cost.toString(), approval_amount_wei: type === 'approve' ? cost.toString() : '0',
      gas_estimate: gas.toString(), gas_limit: gasLimit.toString(), gas_price_wei: gasPrice.toString(), network_cost_estimate_wei: (gas * gasPrice).toString(), network_cost_limit_wei: (gasLimit * gasPrice).toString(),
      cost_type: 'RPC execution gas estimate; wallet confirmation determines final fees', native_balance_wei: nativeBalance.toString(), nonce: BigInt(nonceHex).toString(), block_number: Number(BigInt(tag)), block_hash: block.hash,
      pending_crop_wei: plots.reduce((sum, plot) => sum + plot.pending, 0n).toString(), next_level: normalized.type === 'upgrade' ? plots[0].level + 1 : null,
      notes: ['One transaction per explicit MetaMask approval. No automated follow-on action.', 'An inclusion receipt is not a guarantee against later chain reorganization.', ...(type === 'approve' ? ['Exact CROP allowance only; no CROP is spent by approval. The intended action is simulated after this approval is confirmed and you prepare again.'] : []), ...(normalized.type === 'upgrade' && !plots[0].active ? ['This plot is dormant; an upgrade earns nothing until planting.'] : [])] };
    const fingerprint = JSON.stringify({ type, to, data, value:nativeCost.toString(), balance: balance.toString(), allowance: allowance?.toString(), nonce: view.nonce, plots: plots.map(({ pending: ignored, ...plot }) => plot) });
    return { view, fingerprint, intent: normalized, portfolio: clone(portfolio) };
  }
  async function prepare(intent, portfolio) {
    unlocked(); busy = true; draft = null; state.phase = 'preparing';
    try {
      const built = await build(intent, portfolio);
      const id = globalThis.crypto.randomUUID(), expires_at = now() + 90_000;
      draft = { ...built, view: { ...built.view, id, expires_at } }; state.phase = 'ready';
      return clone(draft.view);
    } catch (error) { state.phase = 'idle'; throw error; } finally { busy = false; }
  }
  async function submit(id) {
    unlocked();
    if (!draft || typeof id !== 'string' || id !== draft.view.id) throw new Error('Unknown draft. Prepare the action in this session first.');
    const reviewed = draft; draft = null; busy = true; state.phase = 'checking';
    try {
      if (now() > reviewed.view.expires_at) throw new Error('Draft expired. Prepare and review a fresh action.');
      await walletCheck(reviewed.view.from);
      const fresh = await build(reviewed.intent, reviewed.portfolio), old = reviewed.view;
      if (fresh.fingerprint !== reviewed.fingerprint || BigInt(fresh.view.pending_crop_wei) < BigInt(old.pending_crop_wei)) throw new Error('Action state changed. Prepare a fresh action and review the differences.');
      if (BigInt(fresh.view.gas_estimate) > BigInt(old.gas_limit) || BigInt(fresh.view.gas_price_wei) > BigInt(old.gas_price_wei)) throw new Error('Network fee estimate increased. Prepare and review the new fee.');
      if (BigInt(fresh.view.native_balance_wei) < BigInt(old.network_cost_limit_wei) + BigInt(old.value_wei ?? '0')) throw new Error('The selected wallet no longer covers the reviewed gas limit.');
      if (now() > old.expires_at) throw new Error('Draft expired during revalidation. Prepare again.');
      await walletCheck(old.from);
      const record = { type: old.type, requested_type: old.requested_type, wallet_id: old.wallet_id, plot_ids: old.plot_ids, from: old.from, to: old.to, data: old.data, value_wei:old.value_wei,
        chain_id: CHAIN, nonce: old.nonce, gas_limit: old.gas_limit, gas_price_wei: old.gas_price_wei, approval_amount_wei: old.approval_amount_wei,
        created_at: now(), hash: null, phase: 'broadcast_unknown' };
      // Persist BEFORE opening the wallet: closing a tab must not erase a possibly broadcast operation.
      await persistPending(record); state.phase = 'awaiting_wallet';
      let transactionHash;
      try {
        transactionHash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: old.from, to: old.to, data: old.data, value: hex(old.value_wei ?? '0'), chainId: CHAIN_HEX, nonce: hex(old.nonce), gas: hex(old.gas_limit), gasPrice: hex(old.gas_price_wei) }] });
      } catch (error) {
        if (Number(error?.code) === 4001) { await persistPending(null); state.phase = 'rejected'; }
        else state.phase = 'broadcast_unknown';
        throw error;
      }
      if (!hash(transactionHash)) { state.phase = 'broadcast_unknown'; throw new Error('Wallet returned no valid transaction hash. Check MetaMask activity before any retry.'); }
      pending = { ...record, hash: transactionHash, phase: 'pending' };
      await onPending(clone(pending)); state.phase = 'pending';
      return clone(pending);
    } catch (error) { if (!pending && state.phase !== 'rejected') state.phase = 'idle'; throw error; } finally { busy = false; }
  }
  function resumePending(record) {
    unlocked(); const validated = validatePendingRecord(record);
    if (validated) { pending = validated; state.phase = pending.phase; draft = null; }
    return status();
  }
  async function reconcile(transactionHash, allowReplacement = false) {
    if (!pending) throw new Error('There is no outstanding companion transaction to reconcile.');
    if (!hash(transactionHash) || (!allowReplacement && pending.hash && !same(transactionHash, pending.hash))) throw new Error('Use the outstanding transaction hash. For an unknown broadcast, copy its hash from MetaMask activity.');
    if (Number(BigInt(await rpc('eth_chainId', []))) !== CHAIN) throw new Error('Public RPC is not Robinhood Chain.');
    const current = clone(pending);
    let transaction, result;
    try {
      [transaction, result] = await Promise.all([rpc('eth_getTransactionByHash', [transactionHash]), rpc('eth_getTransactionReceipt', [transactionHash])]);
    } catch (error) {
      if (error?.message === 'RPC result missing.') return { status: 'pending', hash: transactionHash, note: 'Not yet available from this RPC; the transaction lock remains.' };
      throw error;
    }
    if (transaction == null || result == null) return { status: 'pending', hash: transactionHash };
    const sameAction = same(transaction.to, current.to) && same(transaction.input ?? transaction.data, current.data) && BigInt(transaction.value) === BigInt(current.value_wei ?? '0');
    const receiptToMatches = result.to == null && transaction.to == null || same(result.to, transaction.to);
    if (!same(transaction.hash, transactionHash) || !same(transaction.from, current.from) || BigInt(transaction.nonce) !== BigInt(current.nonce)
      || (!allowReplacement && !sameAction) || !same(result.transactionHash, transactionHash) || !same(result.from, current.from)
      || !receiptToMatches || !['0x0', '0x1'].includes(result.status)) throw new Error('Transaction evidence does not match the outstanding action; the lock remains.');
    const block = await rpc('eth_getBlockByNumber', [result.blockNumber, false]);
    if (!hash(result.blockHash) || !same(block?.hash, result.blockHash)) throw new Error('Receipt is not in the current canonical chain; wait and check again.');
    const minedStatus = result.status === '0x1' ? 'confirmed' : 'reverted';
    const settled = { status: sameAction ? minedStatus : 'replaced', replacement_status: sameAction ? null : minedStatus, original_hash: current.hash, hash: transactionHash, type: current.type, requested_type: current.requested_type,
      from: current.from, to: current.to, plot_ids: current.plot_ids, block_number: Number(BigInt(result.blockNumber)),
      execution_fee_wei: result.gasUsed != null && result.effectiveGasPrice != null ? (BigInt(result.gasUsed) * BigInt(result.effectiveGasPrice)).toString() : null,
      note: `${sameAction ? 'The reviewed action was included' : 'A different transaction consumed the same wallet nonce; the reviewed action was not performed'} in the observed canonical block; future reorganization remains possible. Receipt execution fee does not prove sponsorship or all additional costs.` };
    if (!pending || pending.nonce !== current.nonce || pending.from !== current.from) throw new Error('Pending action changed while checking its receipt.');
    await persistPending(null); state.last_receipt = settled; state.phase = settled.status; draft = null;
    return clone(settled);
  }
  const receipt = (transactionHash = pending?.hash) => reconcile(transactionHash);
  const replacementReceipt = transactionHash => reconcile(transactionHash, true);
  return { connect, switchChain, prepare, submit, receipt, replacementReceipt, resumePending, status };
}
