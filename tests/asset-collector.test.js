import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAssetCollector } from '../src/asset-collector.js';
import { plotArtUrls } from '../src/plot-art.js';

const START = Date.parse('2026-09-13T12:00:00.000Z');
const NFT = '0x1234567890123456789012345678901234567890';
const MANIFEST = `0x${'a'.repeat(64)}`;
const BLOCK_HASH = `0x${'b'.repeat(64)}`;

function clockHarness(initial = START) {
  let value = initial;
  const sleeps = [];
  return {
    now: () => value,
    sleeps,
    advance: ms => { value += ms; },
    sleep: async ms => { sleeps.push(ms); value += ms; return true; }
  };
}

function revealState(now, { status = 'revealed', startingIndex = 1, manifestHash = MANIFEST, nftContract = NFT, totalSupply = 2 } = {}) {
  return {
    status,
    chain_id: 4663,
    block_number: Math.floor(now() / 1000),
    block_hash: BLOCK_HASH,
    block_timestamp: Math.floor(now() / 1000),
    observed_at_utc: new Date(now()).toISOString(),
    total_supply: status === 'sealed' ? 0 : totalSupply,
    starting_index: status === 'sealed' ? 0 : startingIndex,
    tiers_finalized: false,
    manifest_hash: manifestHash,
    nft_contract: nftContract,
    runtime_verified: true,
    manifest_verified: true
  };
}

function live(id, overrides = {}) {
  return { tokenId: id, revealed: true, tierFinalized: false, level: 1, weightBps: 0, ...overrides };
}

function metadata(id, { crop = `Crop-${id}`, image = null, animation = null } = {}) {
  const urls = plotArtUrls(id, 'production');
  return {
    name: `Plot ${id}`,
    description: 'Public display metadata',
    image: image ?? urls.image_url,
    animation_url: animation ?? urls.animation_url,
    attributes: [
      { trait_type: 'soil', value: `Soil-${id}` },
      { trait_type: 'crop', value: crop },
      { trait_type: 'scarecrow', value: `Scarecrow-${id}` },
      { trait_type: 'sky', value: `Sky-${id}` },
      { trait_type: 'fence', value: `Fence-${id}` },
      { trait_type: 'critter', value: `Critter-${id}` }
    ]
  };
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'farm-assets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function readJSON(path) { return JSON.parse(await readFile(path, 'utf8')); }

function requestId(url) { return Number(new URL(url).pathname.split('/').at(-1)); }

test('sealed polling makes no artwork requests; reveal starts a throttled resumable full-collection pass', async t => {
  const dataDir = await temporaryDirectory(t);
  const time = clockHarness();
  let reveal = revealState(time.now, { status: 'sealed' });
  let revealReads = 0;
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: new URL(url), options, at: time.now() });
    const parsed = new URL(url), id = requestId(url);
    return parsed.pathname.startsWith('/plot/') ? jsonResponse(live(id)) : jsonResponse(metadata(id));
  };
  const makeCollector = () => createAssetCollector({
    dataDir, readRevealState: async () => { revealReads++; return reveal; }, fetchImpl,
    now: time.now, sleep: time.sleep, targetCount: 2, heartbeatMs: 300000, pollMs: 30000
  });

  const first = makeCollector();
  const sealed = await first.runOnce();
  assert.equal(sealed.phase, 'waiting_for_reveal');
  assert.equal(calls.length, 0, 'the sealed collection is not probed through artwork URLs');
  const initialStatus = await readJSON(first.paths.status);
  assert.equal(initialStatus.phase, 'waiting_for_reveal');
  assert.equal(initialStatus.target_count, 2);
  assert.ok(initialStatus.last_checked_at_utc);
  assert.equal((await readJSON(first.paths.catalogue)).assets.length, 0);

  reveal = revealState(time.now, { status: 'revealed' });
  time.advance(30000);
  const collectedOne = await first.runOnce();
  assert.equal(collectedOne.phase, 'collecting');
  assert.deepEqual(calls.map(call => call.url.pathname), ['/plot/1', '/metadata/1']);
  assert.notEqual(calls[0].url.searchParams.get('fresh'), calls[1].url.searchParams.get('fresh'));
  assert.ok(time.sleeps.includes(500), 'requests are separated by at least 500 ms');
  for (const call of calls) {
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.cache, 'no-store');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.referrerPolicy, 'no-referrer');
  }
  let catalogue = await readJSON(first.paths.catalogue);
  assert.deepEqual(catalogue.assets.map(asset => asset.token_id), [1]);
  assert.equal(catalogue.assets[0].traits.find(trait => trait.name === 'crop').value, 'Crop-1');
  assert.equal(catalogue.assets[0].revealed, undefined, 'live counters are not copied to public output');
  assert.equal((await stat(first.paths.status)).mode & 0o777, 0o644);
  assert.equal((await stat(join(dataDir, 'public'))).mode & 0o777, 0o755);
  assert.equal((await stat(join(dataDir, 'private'))).mode & 0o777, 0o700);
  assert.equal((await stat(first.paths.state)).mode & 0o777, 0o600);
  assert.equal((await stat(join(first.paths.records, '1.json'))).mode & 0o777, 0o600);

  const restarted = makeCollector();
  const collectedTwo = await restarted.runOnce();
  assert.equal(collectedTwo.phase, 'complete');
  assert.deepEqual(calls.map(call => call.url.pathname), ['/plot/1', '/metadata/1', '/plot/2', '/metadata/2']);
  catalogue = await readJSON(restarted.paths.catalogue);
  assert.deepEqual(catalogue.assets.map(asset => asset.token_id), [1, 2]);
  assert.equal((await readJSON(restarted.paths.status)).collected_count, 2);
  time.advance(30000);
  await restarted.runOnce();
  assert.equal(revealReads, 3, 'a complete collection waits for the five-minute chain heartbeat');
  time.advance(270000);
  await restarted.runOnce();
  assert.equal(revealReads, 4, 'a complete collection refreshes chain identity at the five-minute heartbeat');
});

test('service shutdown retains the current sealed phase in its final heartbeat', async t => {
  const dataDir = await temporaryDirectory(t);
  const time = clockHarness();
  const controller = new AbortController();
  const collector = createAssetCollector({
    dataDir, readRevealState: async () => revealState(time.now, { status: 'sealed' }),
    fetchImpl: async () => { throw new Error('sealed collector must not fetch assets'); },
    now: time.now,
    sleep: async () => { controller.abort(); return false; }
  });
  const result = await collector.run({ signal: controller.signal });
  assert.equal(result.phase, 'waiting_for_reveal');
  assert.equal((await readJSON(collector.paths.status)).phase, 'waiting_for_reveal');
});

test('429 retry-after backs off globally while fair scanning continues with other plots', async t => {
  const dataDir = await temporaryDirectory(t);
  const time = clockHarness();
  const calls = [];
  let firstMetadata = true;
  const fetchImpl = async (url) => {
    const parsed = new URL(url), id = requestId(url);
    calls.push(parsed.pathname);
    if (parsed.pathname.startsWith('/metadata/') && id === 1 && firstMetadata) {
      firstMetadata = false;
      return jsonResponse({ error: 'rate limited' }, { status: 429, headers: { 'retry-after': '2' } });
    }
    return parsed.pathname.startsWith('/plot/') ? jsonResponse(live(id)) : jsonResponse(metadata(id));
  };
  const collector = createAssetCollector({
    dataDir, readRevealState: async () => revealState(time.now), fetchImpl,
    now: time.now, sleep: time.sleep, targetCount: 2, heartbeatMs: 10000, retryBaseMs: 1000
  });

  await collector.runOnce();
  assert.deepEqual(calls, ['/plot/1', '/metadata/1']);
  const failed = await readJSON(collector.paths.state);
  assert.equal(failed.attempts['1'].count, 1, 'a failed attempt is counted once');
  assert.equal(Date.parse(failed.attempts['1'].next_retry_at_utc) - time.now(), 2000, 'Retry-After starts when the remote failure arrives');
  assert.equal(collector.status.collected_count, 0);

  await collector.runOnce();
  assert.equal(calls.length, 2, 'Retry-After prevents an early follow-up request');
  time.advance(2500);
  await collector.runOnce();
  await collector.runOnce();
  assert.deepEqual(calls, ['/plot/1', '/metadata/1', '/plot/2', '/metadata/2', '/plot/1', '/metadata/1']);
  assert.deepEqual((await readJSON(collector.paths.catalogue)).assets.map(asset => asset.token_id), [1, 2]);
});

test('mismatched live IDs and placeholder or foreign-source metadata never enter the catalogue', async t => {
  const dataDir = await temporaryDirectory(t);
  const time = clockHarness();
  const calls = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url), id = requestId(url);
    calls.push(parsed.pathname);
    if (parsed.pathname.startsWith('/plot/1')) return jsonResponse(live(2));
    if (parsed.pathname.startsWith('/metadata/2')) return jsonResponse(metadata(2, { image: 'https://elsewhere.example/image/2.png' }));
    return parsed.pathname.startsWith('/plot/') ? jsonResponse(live(id)) : jsonResponse(metadata(id));
  };
  const collector = createAssetCollector({
    dataDir, readRevealState: async () => revealState(time.now), fetchImpl,
    now: time.now, sleep: time.sleep, targetCount: 2, heartbeatMs: 10000, retryBaseMs: 1000
  });

  await collector.runOnce();
  assert.deepEqual(calls, ['/plot/1'], 'metadata is not fetched when live state names another token');
  assert.equal((await readJSON(collector.paths.catalogue)).assets.length, 0);
  assert.match((await readJSON(collector.paths.status)).error, /requested plot/i);

  time.advance(1000);
  await collector.runOnce();
  assert.deepEqual(calls, ['/plot/1', '/plot/2', '/metadata/2']);
  assert.equal((await readJSON(collector.paths.catalogue)).assets.length, 0);
  assert.match((await readJSON(collector.paths.status)).error, /links did not match/i);
});

test('oversized remote JSON is rejected before it can be persisted', async t => {
  const dataDir = await temporaryDirectory(t);
  const time = clockHarness();
  let calls = 0;
  const fetchImpl = async url => {
    calls++;
    if (new URL(url).pathname.startsWith('/plot/')) return jsonResponse(live(1));
    return jsonResponse(metadata(1), { headers: { 'content-length': String(256 * 1024 + 1) } });
  };
  const collector = createAssetCollector({
    dataDir, readRevealState: async () => revealState(time.now), fetchImpl,
    now: time.now, sleep: time.sleep, targetCount: 1
  });
  await collector.runOnce();
  assert.equal(calls, 2);
  assert.equal((await readJSON(collector.paths.catalogue)).assets.length, 0);
  assert.match((await readJSON(collector.paths.status)).error, /256 KB/);
});

test('changed reveal identity archives private evidence and clears the previous public catalogue', async t => {
  const dataDir = await temporaryDirectory(t);
  const time = clockHarness();
  let offset = 1;
  const fetchImpl = async url => {
    const parsed = new URL(url), id = requestId(url);
    return parsed.pathname.startsWith('/plot/') ? jsonResponse(live(id)) : jsonResponse(metadata(id, { crop: `Offset-${offset}` }));
  };
  const collector = createAssetCollector({
    dataDir, readRevealState: async () => revealState(time.now, { startingIndex: offset }), fetchImpl,
    now: time.now, sleep: time.sleep, targetCount: 3, heartbeatMs: 300000, pollMs: 30000, catalogueEvery: 1
  });
  await collector.runOnce();
  await collector.runOnce();
  assert.deepEqual((await readJSON(collector.paths.catalogue)).assets.map(asset => asset.token_id), [1, 2]);

  offset = 2;
  time.advance(30000);
  await collector.runOnce();
  const catalogue = await readJSON(collector.paths.catalogue);
  assert.deepEqual(catalogue.assets.map(asset => asset.token_id), [1]);
  assert.equal(catalogue.assets[0].traits.find(trait => trait.name === 'crop').value, 'Offset-2');
  const archives = await readdir(collector.paths.archive);
  assert.equal(archives.length, 1);
  assert.deepEqual((await readJSON(join(collector.paths.archive, archives[0], 'state.json'))).identity.starting_index, 1);
});

test('restart recovers an orphaned record only when its persisted chain identity matches', async t => {
  const dataDir = await temporaryDirectory(t);
  const time = clockHarness();
  const calls = [];
  const fetchImpl = async url => {
    calls.push(new URL(url).pathname);
    const id = requestId(url);
    return new URL(url).pathname.startsWith('/plot/') ? jsonResponse(live(id)) : jsonResponse(metadata(id));
  };
  const makeCollector = () => createAssetCollector({
    dataDir, readRevealState: async () => revealState(time.now), fetchImpl,
    now: time.now, sleep: time.sleep, targetCount: 2
  });
  const first = makeCollector();
  await first.runOnce();
  const state = await readJSON(first.paths.state);
  const collectedAt = new Date(time.now()).toISOString();
  const orphan = {
    schema_version: 1,
    token_id: 2,
    identity_key: state.identity.key,
    collected_at_utc: collectedAt,
    chain_observation: revealState(time.now),
    live_state: live(2),
    metadata: metadata(2)
  };
  await writeFile(join(first.paths.records, '2.json'), `${JSON.stringify(orphan)}\n`, { mode: 0o600 });

  const resumed = makeCollector();
  const result = await resumed.runOnce();
  assert.equal(result.phase, 'complete');
  assert.deepEqual(calls, ['/plot/1', '/metadata/1'], 'a valid saved plot is not downloaded again');
  assert.deepEqual((await readJSON(resumed.paths.catalogue)).assets.map(asset => asset.token_id), [1, 2]);
  assert.ok((await readJSON(resumed.paths.state)).records['2']);

  const before = await readFile(resumed.paths.catalogue, 'utf8');
  const uncommitted = await readJSON(resumed.paths.state);
  delete uncommitted.records['2'];
  await writeFile(resumed.paths.state, `${JSON.stringify(uncommitted)}\n`, { mode: 0o600 });
  const foreign = { ...orphan, identity_key: `${state.identity.key}:foreign` };
  await writeFile(join(resumed.paths.records, '2.json'), `${JSON.stringify(foreign)}\n`, { mode: 0o600 });
  const damaged = makeCollector();
  const stopped = await damaged.runOnce();
  assert.equal(stopped.phase, 'unavailable');
  assert.match(stopped.error, /does not match the active reveal identity/i);
  assert.equal(await readFile(damaged.paths.catalogue, 'utf8'), before);
});

test('corrupt private evidence fails visibly and leaves the prior public catalogue untouched', async t => {
  const dataDir = await temporaryDirectory(t);
  const time = clockHarness();
  const fetchImpl = async url => {
    const parsed = new URL(url), id = requestId(url);
    return parsed.pathname.startsWith('/plot/') ? jsonResponse(live(id)) : jsonResponse(metadata(id));
  };
  const first = createAssetCollector({
    dataDir, readRevealState: async () => revealState(time.now), fetchImpl,
    now: time.now, sleep: time.sleep, targetCount: 1
  });
  await first.runOnce();
  const before = await readFile(first.paths.catalogue, 'utf8');
  await writeFile(join(dataDir, 'private', 'active', 'records', '1.json'), '{ broken', { mode: 0o600 });
  const second = createAssetCollector({
    dataDir, readRevealState: async () => { throw new Error('must not proceed with damaged local state'); }, fetchImpl,
    now: time.now, sleep: time.sleep, targetCount: 1
  });
  const result = await second.runOnce();
  assert.equal(result.phase, 'unavailable');
  assert.match(result.error, /collector JSON is invalid|persisted plot 1 evidence/i);
  assert.equal(await readFile(second.paths.catalogue, 'utf8'), before);
  assert.equal((await readJSON(second.paths.status)).phase, 'unavailable');
});

test('collector CLI starts when its ESM entry point is invoked through the runtime symlink', async t => {
  const directory = await temporaryDirectory(t);
  const entry = fileURLToPath(new URL('../tools/collect-assets.mjs', import.meta.url));
  const linkedEntry = join(directory, 'collector.mjs');
  await symlink(entry, linkedEntry);
  const result = spawnSync(process.execPath, [linkedEntry, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--data-dir PATH \[--once\]/);
});
