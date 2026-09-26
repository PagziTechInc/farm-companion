import { encodeFunctionData, decodeFunctionResult, parseAbi, isAddress, keccak256 } from 'viem';
import integrations from '../knowledge/integrations.json' with { type: 'json' };
import commitment from '../knowledge/snapshots/manifest-comparison-2026-09-07.json' with { type: 'json' };
import reviewed from '../knowledge/reviewed-deployment.json' with { type: 'json' };
import { clone, rules, weight } from './model.js';
import { readWeatherSchedule } from './weather-schedule.js';

export const NETWORK = integrations.network;
// Verified deployment getters supplement the original public-client interface.
const sourceReads = {
  nft: ['function rarityTier(uint256 tokenId) view returns (uint8)', 'function tiersFinalized() view returns (bool)'],
  emissions: ['function desiredWeight(uint256 tokenId) view returns (uint256)'],
};
const abi = Object.fromEntries(Object.entries(integrations.contracts).filter(([, c]) => c.read_signatures).map(([k, c]) => [k, parseAbi([...new Set([...c.read_signatures, ...(sourceReads[k] ?? [])])])]));
const READ_METHODS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getBalance', 'eth_call', 'eth_getLogs', 'eth_getStorageAt', 'eth_getTransactionReceipt', 'eth_estimateGas', 'eth_gasPrice', 'eth_getCode', 'eth_getTransactionByHash', 'eth_getTransactionCount']);

const RPC_CONCURRENCY = 2;
const RPC_START_SPACING_MS = 100;
const RPC_MAX_ATTEMPTS = 3;
const RPC_RETRY_BASE_MS = 1000;
const RPC_RETRY_MAX_MS = 2000;
const RETRY_AFTER_MAX_MS = 10000;
const HEX_BYTES = /^0x(?:[\da-f]{2})+$/i;
const RETRYABLE_HTTP_STATUS = new Set([429, 502, 503, 504]);
const RETRYABLE_RPC_CODES = new Set([429, -32005]);
const NON_RETRYABLE_RPC_CODES = new Set([-32700, -32600, -32601, -32602, 3]);
const sleepDefault = ms => new Promise(resolve => setTimeout(resolve, ms));
const monotonicNow = () => typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

function retryAfterMilliseconds(value, now = Date.now()) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!text) return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(RETRY_AFTER_MAX_MS, Math.ceil(seconds * 1000));
  const date = Date.parse(text);
  if (!Number.isFinite(date)) return null;
  return Math.min(RETRY_AFTER_MAX_MS, Math.max(0, date - now));
}

function errorStatus(error) {
  const status = Number(error?.httpStatus ?? error?.status);
  return Number.isInteger(status) ? status : null;
}

function errorRpcCode(error) {
  const code = Number(error?.rpcCode ?? error?.rpc_code ?? error?.code);
  return Number.isInteger(code) ? code : null;
}

function deterministicError(error) {
  if (NON_RETRYABLE_RPC_CODES.has(errorRpcCode(error))) return true;
  const message = String(error?.message ?? '').toLowerCase();
  return /(?:execution|contract|transaction)\s+revert|\breverted\b|invalid\s+opcode|panic\s*\(/i.test(message) ||
    /wrong\s+(?:rpc\s+)?chain|another\s+chain|unsupported\s+chain|invalid\s+chain/i.test(message);
}

function nonRetryableError(error) {
  const message = String(error?.message ?? '').toLowerCase();
  return error?.name === 'SyntaxError' || /invalid\s+(?:json|response)|unexpected\s+token|unsupported\s+method|only\s+read-only\s+rpc\s+methods/i.test(message);
}

function transientError(error) {
  if (!error || deterministicError(error) || nonRetryableError(error)) return false;
  if (RETRYABLE_HTTP_STATUS.has(errorStatus(error)) || RETRYABLE_RPC_CODES.has(errorRpcCode(error))) return true;
  const message = String(error?.message ?? '').toLowerCase(), name = String(error?.name ?? '').toLowerCase();
  return error.transient === true || error.rateLimited === true || error.rate_limit === true || error?.name === 'AbortError' || error?.name === 'TimeoutError' ||
    /failed\s+to\s+fetch|fetch\s+failed|load\s+failed|network\s*(?:error|failure)|networkerror|public[\s_-]*read[\s_-]*(?:failed|error)|timed\s*[-_ ]?out|timeout/i.test(`${message} ${name}`) ||
    /rate[\s_-]*limit|too\s+many\s+requests|throttl(?:e|ed|ing)|temporar(?:y|ily)\s+(?:unavailable|busy)|server\s+busy|overloaded|quota\s+(?:exceeded|depleted)|exceeded\s+quota|capacity\s+(?:exceeded|unavailable)/i.test(message) ||
    /rate.?limit/i.test(name);
}

function metadataFields(meta) {
  const attrs = Array.isArray(meta?.attributes) ? meta.attributes.filter(a => a && typeof a === 'object' && typeof a.trait_type === 'string' && a.trait_type.trim() && ['string', 'number', 'boolean'].includes(typeof a.value)) : [];
  const unwrapped = attrs.some(a => /^(crop|soil|rarity|tier)$/i.test(String(a.trait_type))) && !attrs.some(a => /unrevealed/i.test(String(a.value)));
  return { metadata_reveal_status: unwrapped ? 'revealed' : 'unknown', traits: Object.fromEntries(attrs.map(a => [String(a.trait_type), String(a.value)])) };
}

function retryDelay(error, attempt, { baseMs = RPC_RETRY_BASE_MS, maxMs = RPC_RETRY_MAX_MS, now = monotonicNow, wallNow = Date.now } = {}) {
  const fallback = Math.min(maxMs, baseMs * (2 ** Math.max(0, attempt - 1)));
  const currentWallNow = typeof wallNow === 'function' ? wallNow() : Number(wallNow);
  const retryAfter = error?.retryAfter == null ? null : retryAfterMilliseconds(error.retryAfter, Number.isFinite(currentWallNow) ? currentWallNow : Date.now());
  const requested = retryAfter ?? (Number.isFinite(error?.retryAfterMs) ? Number(error.retryAfterMs) : null);
  if (requested != null) return Math.min(RETRY_AFTER_MAX_MS, Math.max(fallback, requested));
  return fallback;
}

// Keep every RPC attempt behind one small queue. The queue is per reader so a
// second reader (for example a private panel) cannot consume this reader's
// concurrency budget, while all calls made by this reader share the same cap.
function createRpcQueue({ concurrency = RPC_CONCURRENCY, spacingMs = RPC_START_SPACING_MS, sleep = sleepDefault, now = monotonicNow } = {}) {
  const limit = Math.max(1, Math.min(RPC_CONCURRENCY, Number.isFinite(Number(concurrency)) ? Math.trunc(Number(concurrency)) : RPC_CONCURRENCY));
  const spacing = Math.max(0, Math.min(1000, Number.isFinite(Number(spacingMs)) ? Number(spacingMs) : RPC_START_SPACING_MS));
  const wait = typeof sleep === 'function' ? sleep : sleepDefault;
  const clock = typeof now === 'function' ? now : Date.now;
  const pending = [];
  let active = 0;
  let nextStartAt = 0;
  let cooldownUntil = 0;
  let startTail = Promise.resolve();

  function reserveStart() {
    const turn = startTail.then(async () => {
      while (true) {
        const before = clock();
        const target = Math.max(before, nextStartAt, cooldownUntil);
        const delay = target - before;
        if (delay <= 0) {
          nextStartAt = before + spacing;
          return;
        }
        await wait(delay);
        const after = clock();
        // A test-injected sleeper may resolve without advancing its injected
        // clock. Treat the requested delay as the logical start time once in
        // that case; real timers still enforce the production spacing.
        if (after <= before) {
          nextStartAt = Math.max(target, nextStartAt) + spacing;
          return;
        }
      }
    });
    startTail = turn.catch(() => {});
    return turn;
  }

  function pump() {
    while (active < limit && pending.length) {
      const job = pending.shift();
      active++;
      Promise.resolve()
        .then(reserveStart)
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => { active--; pump(); });
    }
  }

  const enqueue = task => new Promise((resolve, reject) => {
    pending.push({ task, resolve, reject });
    pump();
  });
  enqueue.cooldown = delay => {
    const bounded = Math.min(RETRY_AFTER_MAX_MS, Math.max(0, Number(delay) || 0));
    cooldownUntil = Math.max(cooldownUntil, clock() + bounded);
  };
  return enqueue;
}

export async function fetchJSON(url, options = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, credentials: 'omit' });
    if (!response.ok) {
      const retryAfter = response.headers?.get?.('retry-after') ?? null;
      const error = new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
      error.httpStatus = response.status;
      error.status = response.status;
      error.retryAfter = retryAfter;
      error.retryAfterMs = retryAfterMilliseconds(retryAfter);
      throw error;
    }
    return await response.json();
  } finally { clearTimeout(timer); }
}

export function createReader(transport = fetchJSON, manifestTiers = typeof __MANIFEST_TIERS__ !== 'undefined' ? __MANIFEST_TIERS__ : [], options = {}) {
  let id = 0;
  const sleep = typeof options?.sleep === 'function' ? options.sleep : sleepDefault;
  const now = typeof options?.now === 'function' ? options.now : monotonicNow;
  const wallNow = typeof options?.wallNow === 'function' ? options.wallNow : typeof options?.now === 'function' ? options.now : Date.now;
  const bounded = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(RETRY_AFTER_MAX_MS, Number(value))) : fallback;
  const retryBaseMs = bounded(options?.retryBaseMs ?? options?.backoffMs ?? options?.retryBackoffMs, RPC_RETRY_BASE_MS);
  const retryMaxMs = bounded(options?.retryMaxMs ?? options?.maxBackoffMs, RPC_RETRY_MAX_MS);
  const rpcQueue = createRpcQueue({
    concurrency: options?.concurrency ?? options?.rpcConcurrency,
    spacingMs: options?.spacingMs ?? options?.spacing ?? options?.startSpacingMs ?? options?.rpcSpacingMs ?? options?.rpcStartSpacingMs,
    sleep, now
  });
  const configuredBatchSize = Number(options?.batchSize);
  const batchSize = Number.isFinite(configuredBatchSize) ? Math.max(1, Math.min(20, Math.trunc(configuredBatchSize))) : 20;

  function rpcError(response) {
    const rpcError = response.error && typeof response.error === 'object' ? response.error : {};
    const error = new Error(typeof response.error === 'string' ? response.error : rpcError.message ?? 'RPC result missing.');
    const code = Number(rpcError.code);
    if (Number.isInteger(code)) { error.rpcCode = code; error.code = code; }
    const retryAfter = rpcError.retryAfter ?? rpcError.retry_after ?? rpcError.data?.retryAfter ?? rpcError.data?.retry_after ?? response.retryAfter ?? response.retry_after;
    if (retryAfter != null) {
      error.retryAfter = retryAfter;
      const retryAfterMs = rpcError.retryAfterMs ?? rpcError.retry_after_ms ?? rpcError.data?.retryAfterMs ?? rpcError.data?.retry_after_ms ?? response.retryAfterMs ?? response.retry_after_ms;
      error.retryAfterMs = Number.isFinite(Number(retryAfterMs)) ? Number(retryAfterMs) : retryAfterMilliseconds(retryAfter);
    }
    error.rpcError = response.error ?? null;
    return error;
  }

  function decodeBatchResponses(requests, body) {
    if (body == null || typeof body !== 'object') throw new Error('RPC response is missing.');
    const expected = new Map(requests.map(request => [request.id, request]));
    const responses = Array.isArray(body) ? body : [body];
    if (Array.isArray(body) !== (requests.length > 1) || responses.length !== requests.length) throw new Error('RPC batch response is malformed.');
    const seen = new Set(), outcomes = new Map();
    for (const response of responses) {
      if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('RPC batch response is malformed.');
      if (response.jsonrpc !== '2.0') throw new Error('RPC batch response is missing or has an invalid JSON-RPC version.');
      if (!Object.hasOwn(response, 'id')) throw new Error('RPC batch response is missing a request ID.');
      const id = response.id;
      if (!expected.has(id)) throw new Error('RPC batch response contains an unknown request ID.');
      if (seen.has(id)) throw new Error('RPC batch response contains a duplicate request ID.');
      seen.add(id);
      const hasError = Object.hasOwn(response, 'error') && response.error != null;
      const hasResult = Object.hasOwn(response, 'result');
      if (hasError && hasResult) throw new Error('RPC response contains both result and error.');
      if (!hasError && !hasResult) throw new Error('RPC response is missing result or error.');
      outcomes.set(id, hasError ? { error: rpcError(response) } : response.result == null ? { error: new Error('RPC result missing.') } : { value: response.result });
    }
    if (seen.size !== expected.size) throw new Error('RPC batch response is missing a request ID.');
    return outcomes;
  }

  async function sendBatch(requests) {
    const body = await transport(NETWORK.rpc_url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requests.length === 1 ? requests[0] : requests)
    });
    return decodeBatchResponses(requests, body);
  }

  const pendingBatches = [];
  let batchFlushScheduled = false;
  function flushBatches() {
    batchFlushScheduled = false;
    while (pendingBatches.length) {
      const group = pendingBatches.splice(0, batchSize);
      rpcQueue(() => sendBatch(group.map(entry => entry.request))).then(outcomes => {
        for (const entry of group) {
          const outcome = outcomes.get(entry.request.id);
          if (!outcome) entry.reject(new Error('RPC batch response is missing a request ID.'));
          else if (outcome.error) entry.reject(outcome.error);
          else entry.resolve(outcome.value);
        }
      }, error => {
        // A transport failure invalidates this HTTP batch. Each logical read
        // receives the same failure and may independently retry it.
        for (const entry of group) entry.reject(error);
      });
    }
  }
  function scheduleBatchFlush() {
    if (batchFlushScheduled) return;
    batchFlushScheduled = true;
    queueMicrotask(flushBatches);
  }
  function enqueueRead(request) {
    return new Promise((resolve, reject) => {
      pendingBatches.push({ request, resolve, reject });
      scheduleBatchFlush();
    });
  }

  async function rpc(method, params) {
    if (!READ_METHODS.has(method)) throw new Error('Only read-only RPC methods are allowed.');
    const requestId = ++id;
    let lastError;
    for (let attempt = 1; attempt <= RPC_MAX_ATTEMPTS; attempt++) {
      try {
        return await enqueueRead({ jsonrpc: '2.0', id: requestId, method, params });
      } catch (error) {
        lastError = error;
        if (!transientError(error)) throw error;
        const delay = retryDelay(error, attempt, { baseMs: retryBaseMs, maxMs: retryMaxMs, now, wallNow });
        rpcQueue.cooldown(delay);
        if (attempt === RPC_MAX_ATTEMPTS) throw error;
      }
    }
    throw lastError;
  }
  async function call(contract, functionName, args, block, address) {
    const data = encodeFunctionData({ abi: abi[contract], functionName, args });
    const result = await rpc('eth_call', [{ to: address ?? integrations.contracts[contract].address, data }, block]);
    return decodeFunctionResult({ abi: abi[contract], functionName, data: result });
  }
  async function snapshot(previous) {
    if (!Array.isArray(previous.wallets) || !previous.wallets.length || previous.wallets.length>20 || !previous.wallets.every(w => isAddress(w.address ?? ''))) throw new Error('Enter 1–20 public wallet addresses before refreshing.');
    if (new Set(previous.wallets.map(w=>w.address.toLowerCase())).size !== previous.wallets.length) throw new Error('Wallet addresses must be different.');
    const chain = Number(BigInt(await rpc('eth_chainId', [])));
    if (chain !== NETWORK.chain_id) throw new Error(`Wrong RPC chain: ${chain}; expected 4663.`);
    const block = await rpc('eth_getBlockByNumber', ['latest', false]);
    if (!block.number || !block.timestamp) throw new Error('RPC block identity is incomplete.');
    const tag = block.number, errors = [], metadataErrors = [], readWarnings = [];
    const safe = async (label, fn, bucket = errors) => { try { return await fn(); } catch (e) { bucket.push(`${label}: ${e?.message ?? String(e)}`); return null; } };
    const [total, activation, multiplier, genesis, startingIndex, hash, epoch, boundary, tiersFinalized, nftRuntime, carry, granary, emitted, paidOut, weeklyRate] = await Promise.all([
      ['farm weight', () => call('emissions', 'totalWeight', [], tag)], ['activation', () => call('emissions', 'activation', [], tag)],
      ['weather', () => call('weather', 'multiplierNow', [], tag)], ['genesis', () => call('weather', 'epochStart', [0n], tag)],
      ['reveal offset', () => call('nft', 'startingIndex', [], tag)], ['manifest commitment', () => call('nft', 'manifestHash', [], tag)],
      ['epoch', () => call('weather', 'currentEpoch', [], tag)], ['next boundary', () => call('weather', 'nextBoundary', [], tag)],
      ['tier finalization', () => call('nft', 'tiersFinalized', [], tag)],
      ['NFT runtime', () => rpc('eth_getCode', [integrations.contracts.nft.address, tag])],
      ['carried base budget', () => call('emissions','carryNow',[],tag)], ['Granary', () => call('emissions','granaryNow',[],tag)],
      ['base emitted', () => call('emissions','emitted',[],tag)], ['paid rewards', () => call('emissions','paidOut',[],tag)],
      ['weekly target rate', () => call('emissions','RATE_PER_WEIGHT_PER_WEEK',[],tag)],
    ].map(([label, fn]) => safe(label, fn)));
    const result = clone(previous), observed = new Date().toISOString();
    const metadataQueue = createRpcQueue({ concurrency: 2, spacingMs: 0, sleep, now }), metadataJobs = [];
    delete result.forecast_preview;
    result.weather_schedule = await readWeatherSchedule(rpc, block);
    result.is_demo = false; result.is_template = false; result.observed_at_utc = observed; result.block_number = Number(BigInt(tag));
    result.block_timestamp = Number(BigInt(block.timestamp)); result.chain_id = chain;
    result.total_planted_farm_weight_bps = total == null ? null : Number(total);
    result.effective_weather_multiplier_bps = multiplier == null ? null : Number(multiplier);
    result.genesis_timestamp = genesis == null ? null : Number(genesis);
    result.next_boundary_timestamp = boundary == null ? null : Number(boundary);
    result.current_epoch = epoch == null ? null : Number(epoch);
    result.starting_index = startingIndex == null ? null : Number(startingIndex);
    result.tiers_finalized = tiersFinalized; result.nft_contract_address=integrations.contracts.nft.address; result.emissions_contract_address=integrations.contracts.emissions.address;
    result.nft_runtime_verified = typeof nftRuntime === 'string' && HEX_BYTES.test(nftRuntime) && keccak256(nftRuntime).toLowerCase() === reviewed.contracts.nft.runtime_keccak256.toLowerCase();
    if (!result.nft_runtime_verified && nftRuntime != null) errors.push('NFT runtime differs from the source-reviewed deployment.');
    if (!result.nft_runtime_verified && nftRuntime == null && !errors.some(error => error.startsWith('NFT runtime:'))) errors.push('NFT runtime is unavailable.');
    result.carry_crop_wei=carry?.toString()??null; result.granary_crop_wei=granary?.toString()??null;
    result.emitted_crop_wei=emitted?.toString()??null; result.paid_out_crop_wei=paidOut?.toString()??null;
    result.reward_observed_at_utc=new Date(result.block_timestamp*1000).toISOString();
    result.manifest_verified = typeof hash === 'string' && hash.toLowerCase() === commitment.on_chain_hash.toLowerCase();
    if (hash != null && !result.manifest_verified) errors.push('Manifest commitment changed; cached rarity mapping is disabled.');
    const fee = activation ? await safe('plant fee', () => call('activation', 'FEE', [], tag, activation)) : null;
    result.rule_conflicts = [];
    if (weeklyRate != null && weeklyRate !== 2000n*10n**18n) result.rule_conflicts.push('Weekly target rate differs from the current Almanac rules.');
    const [bagPrice,bagOpen] = activation ? await Promise.all([safe('seed bag price',()=>call('activation','bagPrice',[],tag,activation)),safe('seed bag availability',()=>call('activation','bagOpen',[],tag,activation))]) : [null,null];
    result.seed_bag_price_wei=bagPrice?.toString()??null; result.seed_bag_open=bagOpen;
    const [sproutPrice, bagsLeft] = activation ? await Promise.all([
      safe('sprouts quote',()=>call('activation','sproutPrice',[],tag,activation),readWarnings),
      safe('funded seed bags',()=>call('activation','bagsLeft',[],tag,activation),readWarnings),
    ]) : [null,null];
    result.sprout_price_wei=sproutPrice?.toString()??null; result.seed_bags_left=bagsLeft==null?null:Number(bagsLeft);
    if (activation && activation.toLowerCase()!==integrations.contracts.activation.address) result.rule_conflicts.push('Planting registry changed; review its source before planning investments.');
    if (fee != null && fee !== 2500n * 10n ** 18n) result.rule_conflicts.push('Planting cost differs from cached rules.');
    if (genesis != null && Number(genesis) !== rules.schedule.genesis_timestamp) result.rule_conflicts.push('Genesis differs from cached rules.');
    const costs = await Promise.all([2, 3, 4, 5].map(level => safe(`level ${level} cost`, () => call('levels', 'costToReach', [level], tag))));
    costs.forEach((cost, i) => { if (cost != null && cost !== BigInt(rules.levels.entries[i + 1].incremental_upgrade_cost_crop) * 10n ** 18n) result.rule_conflicts.push(`Level ${i + 2} fee differs from cached rules.`); });
    // Deployed reveal reserves zero for unrevealed and maps a zero residue to one.
    const revealed = startingIndex != null && startingIndex > 0n && startingIndex < 3333n;
    const mappingReady = result.nft_runtime_verified === true && result.manifest_verified && revealed;
    if (tiersFinalized === true && !revealed) result.rule_conflicts.push('Finalized tiers reported without a valid revealed offset.');
    if (tiersFinalized === false) readWarnings.push('Rarity tiers are not finalized; rarity remains unknown until finalization.');
    let inventoryFailed = false;
    for (let wi = 0; wi < previous.wallets.length; wi++) {
      const old = previous.wallets[wi], w = result.wallets[wi];
      const [ids, crop, eth] = await Promise.all([
        safe(`${w.label} inventory`, () => call('nft', 'tokensOfOwner', [w.address], tag)),
        safe(`${w.label} CROP`, () => call('crop', 'balanceOf', [w.address], tag)),
        safe(`${w.label} ETH`, () => rpc('eth_getBalance', [w.address, tag]).then(BigInt)),
      ]);
      w.crop_balance_wei = crop?.toString() ?? null; w.eth_balance_wei = eth?.toString() ?? null;
      if (ids == null) {
        inventoryFailed = true;
        w.plots = old.plots.map(p => {
          const { forecast_preview: _forecastPreview, ...withoutPreview } = p;
          return { ...withoutPreview, owner_address: w.address, rarity_tier: null, chain_rarity_tier: null, manifest_rarity_tier: null, rarity_verified: false, rarity_status: 'unavailable', tiers_finalized: null,
          level: null, is_active: null, seed_bag_available:null, sprouts_available:null, effective_weight_bps: null, desired_weight_bps: null, weight_synchronized: null, pending_crop_wei: null,
          reveal_status: 'unknown', metadata_reveal_status: 'unknown', traits: {}, modifiers: null,
          block_number: null, observed_at_utc: null, evidence_source: null };
        });
        continue;
      }
      if (ids.length > 100) throw new Error('More than 100 plots in one wallet; this companion supports up to 100 total.');
      w.plots = [];
      // Gather ten plots at a time so their pinned reads fill twenty-request
      // batches while the separate metadata queue remains bounded.
      for (let offset = 0; offset < ids.length; offset += 10) {
        const group = await Promise.all(ids.slice(offset, offset + 10).map(async token => {
          const tokenId = Number(token), previousPlot = old.plots.find(p => p.token_id === tokenId) ?? {};
          const { forecast_preview: _forecastPreview, ...oldPlot } = previousPlot;
          const [level, pending, effectiveWeight, active, chainTier, desiredWeight, bagAvailable, sproutsAvailable] = await Promise.all([
            safe(`Plot ${token} level`, () => call('levels', 'levelOf', [token], tag)),
            safe(`Plot ${token} pending`, () => call('emissions', 'pending', [token], tag)),
            safe(`Plot ${token} weight`, () => call('emissions', 'weightOf', [token], tag)),
            activation ? safe(`Plot ${token} activation`, () => call('activation', 'isActive', [token], tag, activation)) : null,
            safe(`Plot ${token} chain rarity`, () => call('nft', 'rarityTier', [token], tag)),
            safe(`Plot ${token} desired weight`, () => call('emissions', 'desiredWeight', [token], tag)),
            activation ? safe(`Plot ${token} seed bag`,()=>call('activation','bagAvailable',[token],tag,activation),readWarnings) : null,
            activation ? safe(`Plot ${token} sprouts`,()=>call('activation','sproutsAvailable',[token],tag,activation),readWarnings) : null,
          ]);
          // __MANIFEST_TIERS__ is generated from the verified local raw manifest at build time.
          const mapped = mappingReady ? manifestTiers[(tokenId - 1 + Number(startingIndex)) % 3333] ?? null : null;
          const manifestTier = Number.isInteger(mapped) && mapped >= 0 && mapped <= 3 ? mapped : null;
          const observedTier = chainTier != null && Number.isInteger(Number(chainTier)) && Number(chainTier) >= 0 && Number(chainTier) <= 3 ? Number(chainTier) : null;
          const rarityVerified = tiersFinalized === true && manifestTier != null && observedTier === manifestTier;
          const tier = rarityVerified ? observedTier : null;
          if (mappingReady && manifestTier == null) errors.push(`Plot ${token}: cached manifest tier is unavailable.`);
          if (chainTier != null && observedTier == null) result.rule_conflicts.push(`Plot ${token}: chain rarity is outside the reviewed tier range.`);
          if (tiersFinalized === true && manifestTier != null && observedTier != null && observedTier !== manifestTier) result.rule_conflicts.push(`Plot ${token}: finalized chain rarity differs from the committed manifest row.`);
          const synchronized = effectiveWeight != null && desiredWeight != null ? effectiveWeight === desiredWeight : null;
          if (synchronized === false) result.rule_conflicts.push(`Plot ${token}: recorded weight differs from desired weight; synchronize and refresh before using the upgrade plan.`);
          if (desiredWeight == null) result.rule_conflicts.push(`Plot ${token}: desired weight is unavailable; synchronization could not be verified.`);
          if (rarityVerified && level != null && Number(level) >= 1 && Number(level) <= 5 && typeof active === 'boolean' && desiredWeight != null && desiredWeight !== BigInt(active ? weight(tier, Number(level)) : 0)) result.rule_conflicts.push(`Plot ${token}: desired weight differs from the ordinary level and rarity rules.`);
          const rarityStatus = rarityVerified ? 'verified' : tiersFinalized === false && revealed && mappingReady ? 'pending_finalization' : !revealed ? 'unrevealed' : 'unavailable';
          const plot = { ...oldPlot, token_id: tokenId, owner_address: w.address, rarity_tier: tier, level: level == null ? null : Number(level), is_active: active,
            chain_rarity_tier: observedTier, manifest_rarity_tier: manifestTier, rarity_verified: rarityVerified, tiers_finalized: tiersFinalized,
            rarity_status: rarityStatus, seed_bag_available:bagAvailable, sprouts_available:sproutsAvailable,
            effective_weight_bps: effectiveWeight == null ? null : Number(effectiveWeight), pending_crop_wei: pending?.toString() ?? null,
            desired_weight_bps: desiredWeight == null ? null : Number(desiredWeight), weight_synchronized: synchronized,
            reveal_status: revealed ? 'revealed' : 'unknown', metadata_reveal_status: 'unknown', traits: {}, modifiers: null,
            block_number: result.block_number, observed_at_utc: observed, evidence_source: 'pinned-rpc+unversioned-metadata' };
          metadataJobs.push({ label: `Plot ${token} metadata`, plot, promise: metadataQueue(() => transport(`${NETWORK.api_base_url}/metadata/${token}`)).then(meta => ({ meta }), error => ({ error })) });
          return plot;
        }));
        w.plots.push(...group);
      }
    }
    const metadataResults = await Promise.all(metadataJobs.map(job => job.promise));
    metadataResults.forEach((outcome, index) => {
      const job = metadataJobs[index];
      if (outcome.error) metadataErrors.push(`${job.label}: ${outcome.error?.message ?? String(outcome.error)}`);
      else Object.assign(job.plot, metadataFields(outcome.meta));
    });
    const ids = result.wallets.flatMap(w=>w.plots.map(p=>p.token_id));
    if(ids.length>100) throw new Error('This calculator supports up to 100 plots per workspace.');
    if(new Set(ids).size!==ids.length) throw new Error('RPC inventory contains a plot in multiple wallets. Refresh before using it.');
    result.expected_total_plots=ids.length;
    result.wallets.forEach(w=>{w.expected_plot_count=w.plots.length;});
    const validReveal = startingIndex != null && startingIndex >= 0n && startingIndex < 3333n;
    const revealUnavailable = startingIndex == null || !validReveal;
    const rarityUnavailable = inventoryFailed || tiersFinalized == null || !result.nft_runtime_verified || !result.manifest_verified || revealUnavailable;
    result.rarity_status = rarityUnavailable
      ? (!inventoryFailed && tiersFinalized != null && result.nft_runtime_verified && result.manifest_verified && startingIndex === 0n ? 'unrevealed' : 'unavailable')
      : startingIndex === 0n ? 'unrevealed' : tiersFinalized === false ? 'pending_finalization' : 'verified';
    result.metadata_errors = metadataErrors;
    result.read_warnings = readWarnings;
    result.read_errors = errors;
    return result;
  }
  async function receipt(hash) {
    if (!/^0x[\da-fA-F]{64}$/.test(hash)) throw new Error('Enter a transaction hash.');
    const chain = Number(BigInt(await rpc('eth_chainId', [])));
    if (chain !== 4663) throw new Error('Wrong RPC chain.');
    const r = await rpc('eth_getTransactionReceipt', [hash]);
    if (!r.gasUsed || !r.effectiveGasPrice) throw new Error('Receipt is missing fee data.');
    return { hash, from: r.from, execution_fee_wei: (BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice)).toString(), note: 'Execution fee from receipt; does not prove who ultimately paid or whether additional fees apply.', block_number: Number(BigInt(r.blockNumber)) };
  }
  return { snapshot, receipt, rpc };
}
