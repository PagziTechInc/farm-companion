import { mkdir, readFile, rename, rm, stat, chmod, readdir, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import * as plotArt from './plot-art.js';

const SCHEMA_VERSION = 1;
const EXPECTED_CHAIN_ID = 4663;
const DEFAULT_TARGET_COUNT = 3333;
const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_REQUEST_INTERVAL_MS = 500;
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_RETRY_BASE_MS = 30000;
const DEFAULT_RETRY_MAX_MS = 60 * 60 * 1000;
const DEFAULT_POLL_MS = 30000;
const DEFAULT_HEARTBEAT_MS = 5 * 60 * 1000;
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const ADDRESS = /^0x[\da-f]{40}$/i;
const HASH = /^0x[\da-f]{64}$/i;

function iso(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Collector clock returned an invalid time.');
  return date.toISOString();
}

function parseIso(value, label) {
  if (typeof value !== 'string' || !ISO_UTC.test(value) || new Date(value).toISOString() !== value) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function plainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function cleanError(error) {
  const message = typeof error?.message === 'string' ? error.message : String(error ?? 'Unknown collector error.');
  return message.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300) || 'Unknown collector error.';
}

function errorWithStatus(message, status = null, retryAfterMs = null) {
  const error = new Error(message);
  error.httpStatus = status;
  error.retryAfterMs = retryAfterMs;
  return error;
}

function assertInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} is invalid.`);
  return value;
}

function assertObservation(observation, { targetCount, expectedChainId, allowUnavailable = false } = {}) {
  if (!plainObject(observation)) throw new Error('Reveal observation is unavailable.');
  if (!['sealed', 'revealed', ...(allowUnavailable ? ['unavailable'] : [])].includes(observation.status)) {
    throw new Error('Reveal observation status is invalid.');
  }
  const candidate = {
    chain_id: observation.chain_id,
    block_number: observation.block_number,
    block_hash: observation.block_hash,
    block_timestamp: observation.block_timestamp,
    observed_at_utc: observation.observed_at_utc,
    total_supply: observation.total_supply,
    starting_index: observation.starting_index,
    tiers_finalized: observation.tiers_finalized,
    manifest_hash: observation.manifest_hash,
    nft_contract: observation.nft_contract,
    runtime_verified: observation.runtime_verified,
    manifest_verified: observation.manifest_verified
  };
  const hasIdentityEvidence = Number.isSafeInteger(candidate.chain_id)
    && (typeof candidate.nft_contract === 'string' && ADDRESS.test(candidate.nft_contract))
    && (typeof candidate.manifest_hash === 'string' && HASH.test(candidate.manifest_hash))
    && Number.isSafeInteger(candidate.starting_index)
    && candidate.starting_index >= 0 && candidate.starting_index < DEFAULT_TARGET_COUNT;
  if (observation.status === 'unavailable') return { observation, candidate, hasIdentityEvidence };

  if (candidate.chain_id !== expectedChainId) throw new Error('Reveal RPC returned another chain.');
  assertInteger(candidate.block_number, 1, Number.MAX_SAFE_INTEGER, 'Reveal block number');
  if (typeof candidate.block_hash !== 'string' || !HASH.test(candidate.block_hash)) throw new Error('Reveal block hash is invalid.');
  assertInteger(candidate.block_timestamp, 1, Number.MAX_SAFE_INTEGER, 'Reveal block timestamp');
  parseIso(candidate.observed_at_utc, 'Reveal observation time');
  assertInteger(candidate.total_supply, 0, DEFAULT_TARGET_COUNT, 'Collection supply');
  assertInteger(candidate.starting_index, 0, DEFAULT_TARGET_COUNT - 1, 'Reveal offset');
  if (typeof candidate.nft_contract !== 'string' || !ADDRESS.test(candidate.nft_contract)) throw new Error('NFT contract address is invalid.');
  if (typeof candidate.manifest_hash !== 'string' || !HASH.test(candidate.manifest_hash)) throw new Error('Manifest hash is invalid.');
  if (typeof candidate.tiers_finalized !== 'boolean') throw new Error('Tier finalization status is invalid.');
  if (candidate.runtime_verified !== true || candidate.manifest_verified !== true) throw new Error('NFT runtime and manifest must be verified before artwork collection.');
  if (observation.status === 'sealed' && candidate.starting_index !== 0) throw new Error('Sealed reveal offset is invalid.');
  if (observation.status === 'revealed' && (candidate.starting_index === 0 || candidate.total_supply === 0)) throw new Error('The revealed collection identity is incomplete.');
  return { observation, candidate, hasIdentityEvidence: true };
}

function identityFor(candidate) {
  const core = {
    chain_id: candidate.chain_id,
    nft_contract: candidate.nft_contract.toLowerCase(),
    manifest_hash: candidate.manifest_hash.toLowerCase(),
    starting_index: candidate.starting_index
  };
  const key = `${core.chain_id}:${core.nft_contract}:${core.manifest_hash}:${core.starting_index}`;
  return Object.freeze({ ...core, key });
}

function validIdentity(value) {
  if (!plainObject(value)) return false;
  return Number.isSafeInteger(value.chain_id)
    && typeof value.nft_contract === 'string' && ADDRESS.test(value.nft_contract)
    && typeof value.manifest_hash === 'string' && HASH.test(value.manifest_hash)
    && Number.isSafeInteger(value.starting_index) && value.starting_index > 0 && value.starting_index < DEFAULT_TARGET_COUNT
    && typeof value.key === 'string'
    && value.key === `${value.chain_id}:${value.nft_contract.toLowerCase()}:${value.manifest_hash.toLowerCase()}:${value.starting_index}`;
}

function identityMatches(a, b) {
  return Boolean(a && b && a.key === b.key);
}

function emptyState(targetCount) {
  return {
    schema_version: SCHEMA_VERSION,
    target_count: targetCount,
    identity: null,
    cursor: 0,
    records: {},
    attempts: {},
    not_before_utc: null,
    updated_at_utc: null
  };
}

function retryDelay(attemptCount, baseMs, maxMs) {
  const exponent = Math.min(30, Math.max(0, attemptCount - 1));
  return Math.min(maxMs, baseMs * (2 ** exponent));
}

function retryAfterMs(value, nowMs) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const maxDelay = Math.max(0, 8.64e15 - nowMs);
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(maxDelay, Math.ceil(seconds * 1000));
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, Math.min(maxDelay, date - nowMs));
}

function addFresh(url, stamp) {
  const parsed = new URL(url);
  parsed.searchParams.set('fresh', String(stamp));
  return parsed.href;
}

async function abortableSleep(ms, signal) {
  if (signal?.aborted || ms <= 0) return !signal?.aborted;
  return new Promise(resolve => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      resolve(!signal?.aborted);
    }
    function aborted() { done(); }
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

async function atomicJsonWrite(filePath, value, mode) {
  await mkdir(dirname(filePath), { recursive: true, mode: mode === 0o600 ? 0o700 : 0o755 });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', mode);
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.chmod(mode);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, filePath);
    await chmod(filePath, mode);
    const directory = await open(dirname(filePath), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function readJson(filePath, maxBytes = 64 * 1024 * 1024) {
  const info = await stat(filePath);
  if (!info.isFile() || info.size > maxBytes) throw new Error('Persisted collector file exceeds its safe size limit.');
  try { return JSON.parse(await readFile(filePath, 'utf8')); }
  catch (error) { throw new Error(`Persisted collector JSON is invalid: ${cleanError(error)}`); }
}

function statusObservation(observation) {
  if (!plainObject(observation)) return null;
  const allowed = [
    'status', 'chain_id', 'block_number', 'block_hash', 'block_timestamp', 'observed_at_utc',
    'total_supply', 'starting_index', 'tiers_finalized', 'manifest_hash', 'nft_contract',
    'runtime_verified', 'manifest_verified', 'error'
  ];
  const result = {};
  for (const key of allowed) if (Object.hasOwn(observation, key)) {
    result[key] = key === 'error' && observation[key] != null ? cleanError(observation[key]) : observation[key];
  }
  return result;
}

function publicAsset(value, id) {
  if (!plainObject(value) || value.token_id !== id || value.environment !== 'production'
      || typeof value.metadata_url !== 'string' || !Array.isArray(value.traits)) {
    throw new Error(`Normalized plot ${id} is invalid.`);
  }
  // Keep the output intentionally display-only; live counters stay in private records.
  return {
    token_id: value.token_id,
    name: value.name,
    description: value.description,
    metadata_url: value.metadata_url,
    image_url: value.image_url,
    animation_url: value.animation_url,
    environment: 'production',
    traits: value.traits.map(trait => ({ name: trait.name, value: trait.value })),
    visual_traits: { ...value.visual_traits },
    theme_hint: value.theme_hint,
    fetched_at_utc: value.fetched_at_utc
  };
}

export function createAssetCollector({
  dataDir,
  readRevealState,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = abortableSleep,
  plotArtUrls = plotArt.plotArtUrls,
  validateProductionPlotState = plotArt.validateProductionPlotState,
  normalizePlotArt = plotArt.normalizePlotArt,
  targetCount = DEFAULT_TARGET_COUNT,
  expectedChainId = EXPECTED_CHAIN_ID,
  pollMs = DEFAULT_POLL_MS,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  requestIntervalMs = DEFAULT_REQUEST_INTERVAL_MS,
  requestTimeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = MAX_RESPONSE_BYTES,
  retryBaseMs = DEFAULT_RETRY_BASE_MS,
  retryMaxMs = DEFAULT_RETRY_MAX_MS,
  catalogueEvery = 10
} = {}) {
  if (typeof dataDir !== 'string' || !dataDir.trim()) throw new Error('A collector data directory is required.');
  if (typeof readRevealState !== 'function' || typeof fetchImpl !== 'function' || typeof now !== 'function' || typeof sleep !== 'function') {
    throw new Error('Collector read, fetch and clock dependencies are required.');
  }
  assertInteger(targetCount, 1, DEFAULT_TARGET_COUNT, 'Collector target count');
  assertInteger(expectedChainId, 1, Number.MAX_SAFE_INTEGER, 'Expected chain ID');
  for (const [value, min, max, label] of [
    [pollMs, 1, 24 * 60 * 60 * 1000, 'poll interval'], [heartbeatMs, 1, 24 * 60 * 60 * 1000, 'heartbeat interval'],
    [requestIntervalMs, 500, 60 * 60 * 1000, 'request interval'], [requestTimeoutMs, 1, 10 * 60 * 1000, 'request timeout'],
    [maxResponseBytes, 1, MAX_RESPONSE_BYTES, 'response limit'], [retryBaseMs, 1, 24 * 60 * 60 * 1000, 'retry base'],
    [retryMaxMs, 1, 7 * 24 * 60 * 60 * 1000, 'retry maximum'], [catalogueEvery, 1, 1000, 'catalogue publish batch']
  ]) assertInteger(value, min, max, label);

  const root = dataDir;
  const publicDir = join(root, 'public');
  const privateDir = join(root, 'private');
  const activeDir = join(privateDir, 'active');
  const archiveDir = join(privateDir, 'archive');
  const statePath = join(activeDir, 'state.json');
  const recordsDir = join(activeDir, 'records');
  const statusPath = join(publicDir, 'status.json');
  const cataloguePath = join(publicDir, 'plots.json');

  let initialized = false;
  let fatalError = null;
  let state = null;
  let assets = new Map();
  let reveal = null;
  let lastRevealCheckMs = 0;
  let lastRequestMs = null;
  let lastFreshMs = 0;
  let lastError = null;

  const clock = () => {
    const value = now();
    if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) throw new Error('Collector clock returned an invalid time.');
    return value;
  };
  const currentIso = () => iso(clock());
  const statusValue = (phase, { error = lastError, nextCheckMs = null, observation = reveal } = {}) => {
    const checked = currentIso();
    const result = {
      schema_version: SCHEMA_VERSION,
      environment: 'production',
      target_count: targetCount,
      collected_count: assets.size,
      phase,
      last_checked_at_utc: checked,
      next_check_at_utc: nextCheckMs == null ? checked : iso(nextCheckMs),
      observed_at_utc: typeof observation?.observed_at_utc === 'string' ? observation.observed_at_utc : null,
      chain_observation: statusObservation(observation)
    };
    if (error) result.error = cleanError(error);
    return result;
  };
  const writeStatus = async (phase, options = {}) => {
    const status = statusValue(phase, options);
    await atomicJsonWrite(statusPath, status, 0o644);
    return status;
  };
  const phaseForProgress = () => assets.size >= targetCount ? 'complete' : assets.size ? 'collecting' : 'waiting_for_assets';
  const currentPhase = () => fatalError ? 'unavailable'
    : reveal?.status === 'sealed' ? 'waiting_for_reveal'
      : reveal?.status === 'revealed' ? phaseForProgress() : 'unavailable';
  const catalogValue = () => ({
    schema_version: SCHEMA_VERSION,
    environment: 'production',
    assets: [...assets.entries()].sort((a, b) => a[0] - b[0]).map(([id, value]) => publicAsset(value, id)),
    updated_at_utc: currentIso()
  });
  const writeCatalogue = async () => atomicJsonWrite(cataloguePath, catalogValue(), 0o644);

  function identityFromState(value) {
    if (value === null) return null;
    if (!validIdentity(value)) throw new Error('Persisted reveal identity is invalid.');
    return Object.freeze({ ...value });
  }

  function validateStateShape(value) {
    if (!plainObject(value) || value.schema_version !== SCHEMA_VERSION || value.target_count !== targetCount
        || !Number.isSafeInteger(value.cursor) || value.cursor < 0 || value.cursor > targetCount
        || !plainObject(value.records) || !plainObject(value.attempts)) throw new Error('Persisted collector state is invalid.');
    const identity = identityFromState(value.identity);
    if (!identity && Object.keys(value.records).length) throw new Error('Persisted records have no verified reveal identity.');
    if (value.not_before_utc !== null) parseIso(value.not_before_utc, 'Persisted service retry time');
    parseIso(value.updated_at_utc, 'Persisted collector update time');
    for (const [rawId, stamp] of Object.entries(value.records)) {
      const id = Number(rawId);
      if (!/^[1-9]\d{0,3}$/.test(rawId) || id > targetCount || !plainObject(stamp)) throw new Error('Persisted collector record index is invalid.');
      parseIso(stamp.collected_at_utc, `Persisted plot ${id} timestamp`);
    }
    for (const [rawId, attempt] of Object.entries(value.attempts)) {
      const id = Number(rawId);
      if (!/^[1-9]\d{0,3}$/.test(rawId) || id > targetCount || !plainObject(attempt)
          || !Number.isSafeInteger(attempt.count) || attempt.count < 1) throw new Error('Persisted collector retry state is invalid.');
      parseIso(attempt.last_attempt_at_utc, `Persisted plot ${id} attempt time`);
      if (attempt.next_retry_at_utc !== null) parseIso(attempt.next_retry_at_utc, `Persisted plot ${id} retry time`);
      if (attempt.last_error != null && typeof attempt.last_error !== 'string') throw new Error('Persisted collector error is invalid.');
      if (attempt.http_status !== null && (!Number.isInteger(attempt.http_status) || attempt.http_status < 100 || attempt.http_status > 599)) {
        throw new Error('Persisted collector HTTP status is invalid.');
      }
    }
    return { ...value, identity };
  }

  async function readRecord(id, collectedAt, identity) {
    const recordPath = join(recordsDir, `${id}.json`);
    const record = await readJson(recordPath, 2 * maxResponseBytes + 32 * 1024);
    if (!plainObject(record) || record.schema_version !== SCHEMA_VERSION || record.token_id !== id
        || record.identity_key !== identity.key || record.collected_at_utc !== collectedAt
        || !plainObject(record.live_state) || !plainObject(record.metadata) || !plainObject(record.chain_observation)) {
      throw new Error(`Persisted plot ${id} evidence is invalid.`);
    }
    const chain = assertObservation(record.chain_observation, { targetCount, expectedChainId });
    if (chain.observation.status !== 'revealed' || !identityMatches(identity, identityFor(chain.candidate))) {
      throw new Error(`Persisted plot ${id} chain evidence does not match the active reveal identity.`);
    }
    validateProductionPlotState(record.live_state, id);
    const normalized = normalizePlotArt(record.metadata, id, { environment: 'production', now: Date.parse(collectedAt) });
    return publicAsset(normalized, id);
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;
    await mkdir(publicDir, { recursive: true, mode: 0o755 });
    await chmod(publicDir, 0o755);
    await mkdir(privateDir, { recursive: true, mode: 0o700 });
    await chmod(privateDir, 0o700);
    await mkdir(activeDir, { recursive: true, mode: 0o700 });
    await chmod(activeDir, 0o700);
    await mkdir(recordsDir, { recursive: true, mode: 0o700 });
    await chmod(recordsDir, 0o700);
    await mkdir(archiveDir, { recursive: true, mode: 0o700 });
    await chmod(archiveDir, 0o700);

    // A fresh heartbeat makes container health observable before its first RPC.
    await writeStatus('unavailable', { error: null, nextCheckMs: clock(), observation: null });
    try {
      const hasState = await stat(statePath).then(() => true, () => false);
      if (!hasState) {
        const oldCatalog = await stat(cataloguePath).then(() => readJson(cataloguePath, 16 * 1024 * 1024), () => null);
        const orphanRecords = await readdir(recordsDir).catch(() => []);
        if ((plainObject(oldCatalog) && Array.isArray(oldCatalog.assets) && oldCatalog.assets.length)
            || orphanRecords.length) {
          throw new Error('Private collector state is missing while public or private assets remain; preserving the existing catalogue.');
        }
        state = emptyState(targetCount);
        await persistState();
        if (!oldCatalog) await writeCatalogue();
      } else {
        state = validateStateShape(await readJson(statePath));
        await chmod(statePath, 0o600);
        const entries = Object.entries(state.records);
        for (const [rawId, stamp] of entries) {
          const id = Number(rawId);
          assets.set(id, await readRecord(id, stamp.collected_at_utc, state.identity));
          await chmod(join(recordsDir, `${id}.json`), 0o600);
        }
        if (state.identity) {
          // Recover a durable record written just before a crash interrupted
          // the state-index rename. Any identity mismatch fails closed.
          let recovered = false;
          for (const name of await readdir(recordsDir)) {
            const match = /^([1-9]\d{0,3})\.json$/.exec(name);
            if (!match) continue;
            const id = Number(match[1]), key = String(id);
            if (id > targetCount || Object.hasOwn(state.records, key)) continue;
            const orphanPath = join(recordsDir, name);
            const orphan = await readJson(orphanPath, 2 * maxResponseBytes + 32 * 1024);
            if (!plainObject(orphan) || orphan.token_id !== id || orphan.identity_key !== state.identity.key) {
              throw new Error(`Orphaned plot ${id} evidence does not match the active reveal identity; preserving the existing catalogue.`);
            }
            const collectedAt = parseIso(orphan.collected_at_utc, `Persisted plot ${id} timestamp`);
            assets.set(id, await readRecord(id, collectedAt, state.identity));
            state.records[key] = { collected_at_utc: collectedAt };
            delete state.attempts[key];
            await chmod(orphanPath, 0o600);
            recovered = true;
          }
          if (recovered) await persistState();
        }
        if (!state.identity) {
          const oldCatalog = await stat(cataloguePath).then(() => readJson(cataloguePath, 16 * 1024 * 1024), () => null);
          const orphanRecords = await readdir(recordsDir).catch(() => []);
          if ((plainObject(oldCatalog) && Array.isArray(oldCatalog.assets) && oldCatalog.assets.length)
              || orphanRecords.length) {
            throw new Error('Private collector state has no reveal identity while public or private assets remain; preserving the existing catalogue.');
          }
        }
      }
    } catch (error) {
      fatalError = cleanError(error);
      await writeStatus('unavailable', { error: fatalError, nextCheckMs: clock(), observation: null });
    }
  }

  async function persistState() {
    if (!state) return;
    state.updated_at_utc = currentIso();
    await atomicJsonWrite(statePath, state, 0o600);
    await chmod(activeDir, 0o700);
    await chmod(recordsDir, 0o700);
  }

  async function archiveActive(reason) {
    const exists = await stat(activeDir).then(() => true, () => false);
    if (!exists) return;
    await mkdir(archiveDir, { recursive: true, mode: 0o700 });
    const stamp = currentIso().replace(/[:.]/g, '-');
    const key = state?.identity?.key?.replace(/[^a-z0-9-]/gi, '').slice(0, 80) || 'unbound';
    let destination = join(archiveDir, `${key}-${stamp}-${reason}`);
    for (let suffix = 1; await stat(destination).then(() => true, () => false); suffix++) destination = join(archiveDir, `${key}-${stamp}-${reason}-${suffix}`);
    await rename(activeDir, destination);
    await chmod(destination, 0o700);
    const privateHandle = await open(privateDir, 'r');
    try { await privateHandle.sync(); } finally { await privateHandle.close(); }
    state = emptyState(targetCount);
    assets = new Map();
    await mkdir(activeDir, { recursive: true, mode: 0o700 });
    await mkdir(recordsDir, { recursive: true, mode: 0o700 });
    await persistState();
    await writeCatalogue();
  }

  async function activate(identity) {
    if (state.identity && !identityMatches(state.identity, identity)) {
      await archiveActive('identity-change');
      lastError = null;
    }
    if (!state.identity) {
      state.identity = identity;
      await persistState();
      // Reveal identity changes invalidate the active public catalogue.
      await writeCatalogue();
    } else {
      // Rebuild the active catalogue only from verified private evidence.
      await writeCatalogue();
    }
  }

  async function maybeInvalidateForCandidate(candidate) {
    if (!state?.identity || !candidate) return false;
    const changedChain = Number.isSafeInteger(candidate.chain_id) && candidate.chain_id !== state.identity.chain_id;
    const changedNft = typeof candidate.nft_contract === 'string' && ADDRESS.test(candidate.nft_contract)
      && candidate.nft_contract.toLowerCase() !== state.identity.nft_contract;
    const changedManifest = typeof candidate.manifest_hash === 'string' && HASH.test(candidate.manifest_hash)
      && candidate.manifest_hash.toLowerCase() !== state.identity.manifest_hash;
    const changedOffset = Number.isSafeInteger(candidate.starting_index) && candidate.starting_index >= 0
      && candidate.starting_index < DEFAULT_TARGET_COUNT && candidate.starting_index !== state.identity.starting_index;
    if (!changedChain && !changedNft && !changedManifest && !changedOffset) return false;
    await archiveActive(candidate.starting_index === 0 ? 'reveal-reset' : 'identity-change');
    lastError = null;
    return true;
  }

  function nextRetryTime(attempt) {
    return attempt?.next_retry_at_utc ? Date.parse(attempt.next_retry_at_utc) : 0;
  }

  function findNextId(nowMs) {
    const notBefore = state.not_before_utc == null ? 0 : Date.parse(state.not_before_utc);
    if (notBefore > nowMs) return { id: null, nextMs: notBefore };
    for (let offset = 1; offset <= targetCount; offset++) {
      const id = ((state.cursor + offset - 1) % targetCount) + 1;
      if (Object.hasOwn(state.records, String(id))) continue;
      const retryAt = nextRetryTime(state.attempts[String(id)]);
      if (retryAt <= nowMs) return { id, nextMs: nowMs };
    }
    let earliest = Infinity;
    for (let id = 1; id <= targetCount; id++) {
      if (Object.hasOwn(state.records, String(id))) continue;
      const retryAt = nextRetryTime(state.attempts[String(id)]);
      if (retryAt < earliest) earliest = retryAt;
    }
    return { id: null, nextMs: Number.isFinite(earliest) ? Math.max(earliest, notBefore) : null };
  }

  async function boundedJson(url, signal) {
    const controller = new AbortController();
    let abortedFromParent = false;
    const abortFromParent = () => { abortedFromParent = true; controller.abort(signal.reason); };
    if (signal?.aborted) abortFromParent();
    else signal?.addEventListener('abort', abortFromParent, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Artwork request timed out.')), requestTimeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal
      });
      if (!response || typeof response.ok !== 'boolean') throw new Error('Artwork endpoint returned an invalid response.');
      if (!response.ok) {
        const delay = retryAfterMs(response.headers?.get?.('retry-after'), clock());
        throw errorWithStatus(`Artwork endpoint returned HTTP ${response.status}.`, response.status, delay);
      }
      const lengthHeader = response.headers?.get?.('content-length');
      if (lengthHeader != null) {
        if (!/^\d+$/.test(lengthHeader) || Number(lengthHeader) > maxResponseBytes) throw errorWithStatus('Artwork response exceeded the 256 KB safety limit.');
      }
      const contentType = response.headers?.get?.('content-type') ?? '';
      if (contentType && !/^application\/(?:[\w.+-]*\+)?json(?:\s*;|$)/i.test(contentType)) {
        throw errorWithStatus('Artwork endpoint did not return JSON.');
      }
      if (!response.body || typeof response.body.getReader !== 'function') throw errorWithStatus('Artwork endpoint returned an empty body.');
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxResponseBytes) {
            controller.abort(new Error('Artwork response exceeded the 256 KB safety limit.'));
            throw errorWithStatus('Artwork response exceeded the 256 KB safety limit.');
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock?.(); }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw errorWithStatus('Artwork response was not valid UTF-8.'); }
      try { return JSON.parse(text); }
      catch { throw errorWithStatus('Artwork endpoint returned invalid JSON.'); }
    } catch (error) {
      if (abortedFromParent || signal?.aborted) throw error;
      if (controller.signal.aborted && !error?.httpStatus) {
        const timeout = errorWithStatus('Artwork request timed out.');
        timeout.transient = true;
        throw timeout;
      }
      if (!error?.httpStatus && (error?.name === 'TypeError' || error?.name === 'AbortError')) error.transient = true;
      throw error;
    } finally {
      clearTimeout(timer);
      if (!controller.signal.aborted) controller.abort();
      signal?.removeEventListener('abort', abortFromParent);
    }
  }

  async function request(url, signal) {
    const nowMs = clock();
    if (lastRequestMs != null) {
      const wait = Math.max(0, requestIntervalMs - (nowMs - lastRequestMs));
      if (wait > 0 && !(await sleep(wait, signal))) throw Object.assign(new Error('Collector stopping.'), { collectorAborted: true });
    }
    if (signal?.aborted) throw Object.assign(new Error('Collector stopping.'), { collectorAborted: true });
    const at = clock();
    lastRequestMs = at;
    lastFreshMs = Math.max(Math.trunc(at), lastFreshMs + 1);
    return boundedJson(addFresh(url, lastFreshMs), signal);
  }

  async function recordFailure(id, error, startedAtMs) {
    const key = String(id), previous = state.attempts[key];
    const count = previous?.count ?? 1;
    const baseDelay = retryDelay(count, retryBaseMs, retryMaxMs);
    const requestedDelay = Number.isFinite(error?.retryAfterMs) ? error.retryAfterMs : null;
    const delay = requestedDelay ?? baseDelay;
    const retryAt = clock() + delay;
    state.attempts[key] = {
      count,
      last_attempt_at_utc: iso(startedAtMs),
      next_retry_at_utc: iso(retryAt),
      last_error: cleanError(error),
      http_status: Number.isInteger(error?.httpStatus) ? error.httpStatus : null
    };
    if ((error?.httpStatus === 429 || (error?.httpStatus >= 500 && error?.httpStatus <= 599) || error?.transient === true) && delay > 0) {
      const prior = state.not_before_utc ? Date.parse(state.not_before_utc) : 0;
      state.not_before_utc = iso(Math.max(prior, retryAt));
    }
    await persistState();
    lastError = cleanError(error);
    await writeStatus(phaseForProgress(), { error: lastError, nextCheckMs: retryAt, observation: reveal });
  }

  async function collectOne(id, signal) {
    const key = String(id), startedAtMs = clock();
    const attempt = state.attempts[key];
    const count = (attempt?.count ?? 0) + 1;
    state.cursor = id;
    state.attempts[key] = {
      count,
      last_attempt_at_utc: iso(startedAtMs),
      next_retry_at_utc: null,
      last_error: null,
      http_status: null
    };
    await persistState();
    await writeStatus(phaseForProgress(), { error: lastError, nextCheckMs: clock(), observation: reveal });
    try {
      const urls = plotArtUrls(id, 'production');
      if (!plainObject(urls) || typeof urls.live_url !== 'string' || typeof urls.metadata_url !== 'string') {
        throw new Error('Production live and metadata endpoints are unavailable.');
      }
      const live = await request(urls.live_url, signal);
      validateProductionPlotState(live, id);
      if (signal?.aborted) return { aborted: true };
      const metadata = await request(urls.metadata_url, signal);
      if (signal?.aborted) return { aborted: true };
      const fetchedAt = iso(clock());
      const normalized = normalizePlotArt(metadata, id, { environment: 'production', now: Date.parse(fetchedAt) });
      if (!plainObject(normalized) || normalized.token_id !== id || normalized.environment !== 'production') {
        throw new Error('Artwork metadata did not normalize to the requested production plot.');
      }
      const identity = state.identity;
      if (!identity) throw new Error('A verified reveal identity is required before saving artwork.');
      const record = {
        schema_version: SCHEMA_VERSION,
        token_id: id,
        identity_key: identity.key,
        collected_at_utc: fetchedAt,
        chain_observation: statusObservation(reveal),
        live_state: live,
        metadata
      };
      await atomicJsonWrite(join(recordsDir, `${id}.json`), record, 0o600);
      assets.set(id, publicAsset(normalized, id));
      state.records[key] = { collected_at_utc: fetchedAt };
      delete state.attempts[key];
      if (state.not_before_utc && Date.parse(state.not_before_utc) <= clock()) state.not_before_utc = null;
      await persistState();
      if (assets.size === 1 || assets.size % catalogueEvery === 0 || assets.size >= targetCount) {
        await writeCatalogue();
      }
      lastError = null;
      await writeStatus(phaseForProgress(), { error: null, nextCheckMs: clock(), observation: reveal });
      return { collected: true };
    } catch (error) {
      if (error?.collectorAborted || signal?.aborted) return { aborted: true };
      await recordFailure(id, error, startedAtMs);
      return { error: cleanError(error) };
    }
  }

  async function checkReveal() {
    const checkedAt = clock();
    lastRevealCheckMs = checkedAt;
    try {
      const observation = await readRevealState();
      const parsed = assertObservation(observation, { targetCount, expectedChainId, allowUnavailable: true });
      reveal = statusObservation(observation);
      if (observation.status === 'unavailable') {
        await maybeInvalidateForCandidate(parsed.candidate);
        lastError = cleanError(observation.error || 'Verified reveal state is unavailable.');
        await writeStatus('unavailable', { error: lastError, nextCheckMs: clock() + pollMs, observation: reveal });
        return { ready: false, delayMs: pollMs };
      }
      if (observation.status === 'sealed') {
        if (state.identity) await archiveActive('reveal-reset');
        lastError = null;
        reveal = statusObservation(observation);
        await writeCatalogue();
        await writeStatus('waiting_for_reveal', { error: null, nextCheckMs: clock() + pollMs, observation: reveal });
        return { ready: false, delayMs: pollMs };
      }
      const identity = identityFor(parsed.candidate);
      await activate(identity);
      reveal = statusObservation(observation);
      lastError = null;
      await writeStatus(phaseForProgress(), { error: null, nextCheckMs: clock(), observation: reveal });
      return { ready: true, delayMs: 0 };
    } catch (error) {
      lastError = cleanError(error);
      reveal = null;
      await writeStatus('unavailable', { error: lastError, nextCheckMs: clock() + pollMs, observation: null });
      return { ready: false, delayMs: pollMs };
    }
  }

  async function runOnce({ signal } = {}) {
    await initialize();
    if (fatalError) {
      lastError = fatalError;
      await writeStatus('unavailable', { error: fatalError, nextCheckMs: clock() + pollMs, observation: reveal });
      return { phase: 'unavailable', work_done: false, delay_ms: pollMs, error: fatalError };
    }
    if (signal?.aborted) return { phase: 'unavailable', work_done: false, delay_ms: 0 };

    const currentMs = clock();
    const revealCheckInterval = reveal?.status === 'revealed' && assets.size >= targetCount ? heartbeatMs : pollMs;
    if (!reveal || currentMs - lastRevealCheckMs >= revealCheckInterval) {
      const result = await checkReveal();
      if (!result.ready) return { phase: reveal?.status === 'sealed' ? 'waiting_for_reveal' : 'unavailable', work_done: true, delay_ms: result.delayMs };
    }
    if (!reveal || reveal.status !== 'revealed') {
      const phase = reveal?.status === 'sealed' ? 'waiting_for_reveal' : 'unavailable';
      await writeStatus(phase, { error: phase === 'unavailable' ? lastError : null, nextCheckMs: clock() + pollMs, observation: reveal });
      return { phase, work_done: false, delay_ms: pollMs };
    }

    const selected = findNextId(clock());
    if (selected.id == null) {
      if (assets.size >= targetCount) {
        const refreshDelay = Math.max(1, Math.min(pollMs, heartbeatMs - (clock() - lastRevealCheckMs)));
        await writeStatus('complete', { error: null, nextCheckMs: clock() + refreshDelay, observation: reveal });
        return { phase: 'complete', work_done: false, delay_ms: refreshDelay };
      }
      const nextMs = selected.nextMs ?? (clock() + pollMs);
      const delay = Math.max(1, Math.min(pollMs, nextMs - clock()));
      await writeStatus(phaseForProgress(), { error: lastError, nextCheckMs: clock() + delay, observation: reveal });
      return { phase: phaseForProgress(), work_done: false, delay_ms: delay };
    }

    const result = await collectOne(selected.id, signal);
    const phase = phaseForProgress();
    return { phase, work_done: Boolean(result.collected || result.error), delay_ms: 0, error: result.error };
  }

  async function run({ signal } = {}) {
    while (!signal?.aborted) {
      const result = await runOnce({ signal });
      if (signal?.aborted) break;
      const delay = Math.min(pollMs, Math.max(0, Number(result.delay_ms) || 0));
      if (delay > 0) await sleep(delay, signal);
    }
    if (initialized) {
      const phase = currentPhase();
      await writeStatus(phase, { error: phase === 'unavailable' ? (fatalError ?? lastError) : null, nextCheckMs: clock(), observation: reveal });
    }
    return { stopped: true, phase: currentPhase() };
  }

  return Object.freeze({
    initialize,
    runOnce,
    run,
    get paths() { return Object.freeze({ status: statusPath, catalogue: cataloguePath, state: statePath, records: recordsDir, archive: archiveDir }); },
    get status() { return Object.freeze({ phase: currentPhase(), collected_count: assets.size, error: fatalError ?? lastError }); }
  });
}

export const ASSET_COLLECTOR_DEFAULTS = Object.freeze({
  target_count: DEFAULT_TARGET_COUNT,
  poll_ms: DEFAULT_POLL_MS,
  heartbeat_ms: DEFAULT_HEARTBEAT_MS,
  request_interval_ms: DEFAULT_REQUEST_INTERVAL_MS,
  request_timeout_ms: DEFAULT_TIMEOUT_MS,
  max_response_bytes: MAX_RESPONSE_BYTES,
  retry_base_ms: DEFAULT_RETRY_BASE_MS,
  retry_max_ms: DEFAULT_RETRY_MAX_MS
});
