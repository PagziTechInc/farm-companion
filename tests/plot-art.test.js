import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlotArtReader, normalizePlotArt, plotArtThemeHint, plotArtTokenId, plotArtUrls, safePlotArtUrl, validateProductionPlotState, validateSavedPlotArt } from '../src/plot-art.js';

const rehearsalMetadata = (id = 331) => ({
  name: `Plot #${String(id).padStart(4, '0')}`,
  description: 'A dormant Golden farm on Golden.',
  image: `https://api.rh.farm/rehearsal/image/${id}.png?r=1337`,
  animation_url: `https://api.rh.farm/rehearsal/animation/${id}.html`,
  attributes: [
    ...['Soil', 'Crop', 'Scarecrow', 'Sky', 'Fence', 'Critter'].map(trait_type => ({ trait_type, value: 'Golden' })),
    { trait_type: 'Level', display_type: 'number', value: 1, max_value: 5 },
    { trait_type: 'Rarity Tier', value: 'Golden Acre' },
    { trait_type: 'Planted', value: 'No' }
  ]
});
const productionMetadata = (id = 331) => ({
  name: `Plot #${String(id).padStart(4, '0')}`,
  description: 'Revealed production artwork.',
  image: `https://api.rh.farm/image/${id}.png?s=1db`,
  attributes: [
    ...['Soil', 'Crop', 'Scarecrow', 'Sky', 'Fence', 'Critter'].map(trait_type => ({ trait_type, value: 'Golden' })),
    { trait_type: 'Status', value: 'Revealed' }
  ]
});
const productionState = (id = 331, overrides = {}) => ({
  tokenId: id, revealed: true, tierFinalized: true, level: 1, tier: 'Golden', weightBps: 5000, ...overrides
});
const tick = () => new Promise(resolve => setImmediate(resolve));

test('production artwork requires reveal, real visual traits and an exact token image', () => {
  const art = normalizePlotArt(productionMetadata(), 331, { now: Date.parse('2026-09-12T18:15:46Z') });
  assert.equal(art.name, 'Plot #0331');
  assert.equal(art.environment, 'production');
  assert.equal(art.image_url, 'https://api.rh.farm/image/331.png?s=1db');
  assert.equal(art.animation_url, 'https://api.rh.farm/animation/331.html');
  assert.equal(art.metadata_url, 'https://api.rh.farm/metadata/331');
  assert.equal(art.fetched_at_utc, '2026-09-12T18:15:46.000Z');
  assert.equal(art.visual_traits.sky, 'Golden');
  assert.equal(art.theme_hint, 'golden');
  const noFence = { ...productionMetadata(), attributes: productionMetadata().attributes.map(trait => trait.trait_type === 'Fence' ? { ...trait, value: 'None' } : trait) };
  assert.equal(normalizePlotArt(noFence, 331).visual_traits.fence, 'None');

  const unrevealed = { image: 'https://api.rh.farm/image/unrevealed.png', attributes: [{ trait_type: 'Status', value: 'Unrevealed' }] };
  for (const invalid of [
    unrevealed,
    { ...productionMetadata(), attributes: productionMetadata().attributes.slice(0, 5) },
    { ...productionMetadata(), attributes: productionMetadata().attributes.map(t => t.trait_type === 'Critter' ? { ...t, value: 'Unknown' } : t) }
  ]) assert.throws(() => normalizePlotArt(invalid, 331), error => error.code === 'ASSET_UNREVEALED');
  assert.throws(() => normalizePlotArt({ ...productionMetadata(), image: 'https://api.rh.farm/image/332.png' }, 331), /links did not match/);
  assert.throws(() => normalizePlotArt({ ...productionMetadata(), animation_url: 'https://evil.test/animation/331.html' }, 331), /links did not match/);
  assert.equal(normalizePlotArt({ ...productionMetadata(), animation_url: 'https://api.rh.farm/animation/331.html' }, 331).animation_url, 'https://api.rh.farm/animation/331.html');
});

test('rehearsal sample keeps its exact legacy paths, revisions and display labels', () => {
  const art = normalizePlotArt(rehearsalMetadata(), 331, { now: Date.parse('2026-09-12T18:15:46Z'), environment: 'rehearsal' });
  assert.equal(art.name, 'Plot #0331');
  assert.equal(art.environment, 'rehearsal');
  assert.equal(art.image_url, 'https://api.rh.farm/rehearsal/image/331.png?r=1337');
  assert.equal(art.animation_url, 'https://api.rh.farm/rehearsal/animation/331.html');
  assert.equal(art.metadata_url, 'https://api.rh.farm/rehearsal/331');
  assert.equal(art.fetched_at_utc, '2026-09-12T18:15:46.000Z');
  assert.equal(art.visual_traits.sky, 'Golden');
  assert.equal(art.theme_hint, 'golden');
  assert.deepEqual(art.traits.find(t => t.name === 'Level'), { name: 'Level', value: '1' });
  assert.throws(() => normalizePlotArt({ ...rehearsalMetadata(), animation_url: undefined }, 331, { environment: 'rehearsal' }), /artwork/);
});

test('asset data cannot become portfolio or calculator evidence', () => {
  const raw = { ...rehearsalMetadata(), owner: '0x123', rarity_tier: 3, level: 5, is_active: true, pending_crop_wei: '1000', effective_weight_bps: 50000, script: '<script>bad()</script>' };
  const before = structuredClone(raw), art = normalizePlotArt(raw, 331, { environment: 'rehearsal' });
  assert.deepEqual(raw, before);
  for (const field of ['owner', 'rarity_tier', 'level', 'is_active', 'pending_crop_wei', 'effective_weight_bps', 'script']) assert.equal(field in art, false);
  assert.throws(() => { art.token_id = 1; }, TypeError);
  assert.throws(() => { art.visual_traits.sky = 'Storm'; }, TypeError);
  assert.throws(() => { art.traits[0].value = 'Loam'; }, TypeError);
});

test('only canonical token numbers and explicit environments can reach a URL', () => {
  for (const value of [1, '331', 3333]) assert.equal(plotArtTokenId(value), Number(value));
  for (const value of [0, -1, 3334, 1.1, NaN, Infinity, null, true, [], {}, 1n, '', '0331', '1e3', ' 331', '331 ', '331/../../1', '331?x=1']) {
    assert.throws(() => plotArtUrls(value), /plot number/);
  }
  assert.deepEqual(plotArtUrls(331), {
    metadata_url: 'https://api.rh.farm/metadata/331', live_url: 'https://api.rh.farm/plot/331',
    image_url: 'https://api.rh.farm/image/331.png', animation_url: 'https://api.rh.farm/animation/331.html'
  });
  assert.deepEqual(plotArtUrls(331, 'rehearsal'), {
    metadata_url: 'https://api.rh.farm/rehearsal/331', live_url: null,
    image_url: 'https://api.rh.farm/rehearsal/image/331.png', animation_url: 'https://api.rh.farm/rehearsal/animation/331.html'
  });
  assert.throws(() => plotArtUrls(331, '__proto__'), /source/);
});

test('remote asset URLs reject foreign origins, tokens, queries and ambiguous paths', () => {
  const badProduction = [
    'http://api.rh.farm/image/331.png',
    'https://api.rh.farm.evil.test/image/331.png',
    'https://evil.test/image/331.png',
    'https://user:pass@api.rh.farm/image/331.png',
    'https://api.rh.farm:444/image/331.png',
    'https://api.rh.farm/image/332.png',
    'https://api.rh.farm/animation/331.html',
    'https://api.rh.farm/image/%33%33%31.png',
    'https://api.rh.farm/other/../image/331.png',
    'https://api.rh.farm/image/331.png#fragment',
    'https://api.rh.farm/image/331.png?s=6db',
    'https://api.rh.farm/image/331.png?s=1xb',
    'https://api.rh.farm/image/331.png?s=1db&s=2db',
    'https://api.rh.farm/image/331.png?r=1337',
    'https://api.rh.farm/image/331.png?fresh=1',
    'data:image/svg+xml,<svg onload="bad()"/>', 'javascript:bad()',
    ' https://api.rh.farm/image/331.png'
  ];
  for (const url of badProduction) assert.equal(safePlotArtUrl(url, 331, 'image'), null, url);
  const goodImage = 'https://api.rh.farm/image/331.png?s=1db';
  assert.equal(safePlotArtUrl(goodImage, 331, 'image'), goodImage);
  assert.equal(safePlotArtUrl(plotArtUrls(331).image_url, 331, 'image'), plotArtUrls(331).image_url);
  assert.equal(safePlotArtUrl('https://api.rh.farm/animation/331.html', 331, 'animation'), 'https://api.rh.farm/animation/331.html');
  assert.equal(safePlotArtUrl('https://api.rh.farm/animation/331.html?fresh=1', 331, 'animation'), null);

  const rehearsalImage = 'https://api.rh.farm/rehearsal/image/331.png?r=1337';
  assert.equal(safePlotArtUrl(rehearsalImage, 331, 'image', 'rehearsal'), rehearsalImage);
  assert.equal(safePlotArtUrl('https://api.rh.farm/rehearsal/image/331.png?s=1db', 331, 'image', 'rehearsal'), null);
  assert.equal(safePlotArtUrl(rehearsalMetadata().image, 331, 'image', 'rehearsal'), rehearsalMetadata().image);
  assert.equal(safePlotArtUrl(`${rehearsalMetadata().animation_url}?r=1337`, 331, 'animation', 'rehearsal'), null);
  assert.throws(() => normalizePlotArt({ ...rehearsalMetadata(), image: badProduction[0] }, 331, { environment: 'rehearsal' }), /links did not match/);
});

test('traits are bounded display strings; malformed rehearsal responses fail explicitly', () => {
  const raw = rehearsalMetadata();
  raw.attributes.push({ trait_type: 'Sky', value: 'Storm' }, { trait_type: 'Object', value: { url: 'evil' } }, null);
  raw.attributes.push({ trait_type: 'Note', value: '\u0000abc\n' + 'x'.repeat(200) });
  const art = normalizePlotArt(raw, 331, { environment: 'rehearsal' });
  assert.equal(art.traits.filter(t => t.name === 'Sky').length, 1);
  assert.equal(art.visual_traits.sky, 'Golden');
  assert.equal(art.traits.some(t => t.name === 'Object'), false);
  assert.equal(art.traits.find(t => t.name === 'Note').value.length, 120);
  assert.doesNotMatch(art.traits.find(t => t.name === 'Note').value, /[\u0000\n]/);
  for (const invalid of [null, [], 'html', {}, { ...rehearsalMetadata(), attributes: Array(65).fill({}) }, { ...rehearsalMetadata(), animation_url: undefined }]) {
    assert.throws(() => normalizePlotArt(invalid, 331, { environment: 'rehearsal' }), /artwork/);
  }
});

test('cosmetic palette inference uses visual traits only and leaves unknown art neutral', () => {
  assert.equal(plotArtThemeHint({ sky: 'Golden', rarity_tier: 0 }), 'golden');
  assert.equal(plotArtThemeHint({ sky: 'Snow', crop: 'Corn' }), 'winter');
  assert.equal(plotArtThemeHint({ sky: 'Overcast' }), 'storm');
  assert.equal(plotArtThemeHint({ sky: 'Night' }), 'festival');
  assert.equal(plotArtThemeHint({ sky: 'Day', crop: 'Pumpkin' }), 'autumn');
  assert.equal(plotArtThemeHint({ sky: 'Day', crop: 'Moon Beans', rarity_tier: 3 }), 'base');
  assert.equal(plotArtThemeHint({ rarity: 'Golden Acre' }), 'base');
  assert.equal(plotArtThemeHint({ sky: 'Unknown future sky' }), 'base');
});

test('live production state requires the exact revealed token and returns bounded cosmetic fields only', () => {
  assert.deepEqual(validateProductionPlotState(productionState(331), 331), {
    token_id: 331, revealed: true, tier_finalized: true, level: 1, tier: 'Golden', weight_bps: 5000
  });
  const bounded = validateProductionPlotState(productionState(331, { level: 99, tier: 'x'.repeat(100), tierFinalized: 'yes', weightBps: 100001 }), 331);
  assert.deepEqual(bounded, { token_id: 331, revealed: true, tier_finalized: null, level: null, tier: 'x'.repeat(60), weight_bps: null });
  assert.throws(() => validateProductionPlotState(productionState(332), 331), error => error.code === 'ASSET_STATE_INVALID');
  assert.throws(() => validateProductionPlotState(productionState(331, { revealed: false }), 331), error => error.code === 'ASSET_UNREVEALED');
  assert.throws(() => validateProductionPlotState({ ...productionState(), revealed: 'true' }, 331), error => error.code === 'ASSET_STATE_INVALID');
  assert.throws(() => { bounded.level = 1; }, TypeError);
});

test('saved artwork accepts one explicit source and recomputes cosmetic hints', () => {
  for (const art of [
    normalizePlotArt(rehearsalMetadata(), 331, { now: 1789236946000, environment: 'rehearsal' }),
    normalizePlotArt(productionMetadata(), 331, { now: 1789236946000 })
  ]) {
    assert.deepEqual(validateSavedPlotArt(JSON.parse(JSON.stringify(art))), art);
    assert.equal(validateSavedPlotArt(null), null);
    const imported = { ...art, visual_traits: { sky: 'Storm' }, theme_hint: 'storm', rarity_tier: 0 };
    const checked = validateSavedPlotArt(imported);
    assert.equal(checked.visual_traits.sky, 'Golden');
    assert.equal(checked.theme_hint, 'golden');
    assert.equal('rarity_tier' in checked, false);
    for (const bad of [
      { ...art, environment: art.environment === 'production' ? 'rehearsal' : 'production' },
      { ...art, token_id: 332 },
      { ...art, metadata_url: 'https://evil.test/331' },
      { ...art, image_url: 'data:image/png;base64,AAAA' },
      { ...art, animation_url: `https://api.rh.farm/${art.environment === 'production' ? 'animation' : 'rehearsal/animation'}/332.html` },
      { ...art, fetched_at_utc: 'not a date' },
      { ...art, fetched_at_utc: 1789236946000 },
      { ...art, traits: [{ name: 'Sky', value: {} }] }
    ]) assert.throws(() => validateSavedPlotArt(bad));
  }
});

test('default production reader gates metadata behind one same-nonce live reveal check', async () => {
  let clock = 1000; const calls = [];
  const reader = createPlotArtReader(async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/plot/')) return productionState(331);
    return productionMetadata(331);
  }, { now: () => clock, ttlMs: 100 });
  assert.equal(reader.environment, 'production');
  assert.equal(reader.source.environment, 'production');
  const a = reader.read(331), b = reader.read('331');
  assert.equal(a, b);
  assert.equal(await a, await b);
  await reader.read(331);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /^https:\/\/api\.rh\.farm\/plot\/331\?fresh=1000$/);
  assert.match(calls[1].url, /^https:\/\/api\.rh\.farm\/metadata\/331\?fresh=1000$/);
  assert.deepEqual(calls.map(call => call.options.method), ['GET', 'GET']);
  assert.deepEqual(calls.map(call => call.options.credentials), ['omit', 'omit']);
  assert.deepEqual(calls.map(call => call.options.redirect), ['error', 'error']);
  assert.deepEqual(calls.map(call => call.options.cache), ['no-store', 'no-store']);
  assert.equal(reader.pendingCount, 0);
  clock = 1099; assert.ok(reader.peek(331));
  clock = 1100; assert.equal(reader.peek(331), null);
  await reader.read(331);
  await reader.read(331, { force: true });
  assert.equal(calls.length, 6);
});

test('unrevealed production state stops before NFT metadata and remains retryable', async () => {
  const calls = [];
  const reader = createPlotArtReader(async url => {
    calls.push(url);
    return { tokenId: 331, revealed: false, level: 1, tier: null };
  }, { now: () => 2468 });
  await assert.rejects(reader.read(331), error => error.code === 'ASSET_UNREVEALED');
  assert.deepEqual(calls, ['https://api.rh.farm/plot/331?fresh=2468']);
  assert.equal(reader.peek(331), null);
  assert.equal(reader.pendingCount, 0);
});

test('rehearsal reader coalesces requests, caches briefly and forces explicit refresh', async () => {
  let clock = 1000, calls = 0;
  const reader = createPlotArtReader(async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.rh.farm/rehearsal/331');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'GET');
    return rehearsalMetadata();
  }, { environment: 'rehearsal', now: () => clock, ttlMs: 100 });
  assert.equal(reader.environment, 'rehearsal');
  const a = reader.read(331), b = reader.read('331');
  assert.equal(a, b);
  assert.equal(await a, await b);
  await reader.read(331);
  assert.equal(calls, 1);
  assert.equal(reader.pendingCount, 0);
  clock = 1099; assert.ok(reader.peek(331));
  clock = 1100; assert.equal(reader.peek(331), null);
  await reader.read(331);
  await reader.read(331, { force: true });
  assert.equal(calls, 3);
});

test('reader bounds cached plots and evicts the least recently read image', async () => {
  const reader = createPlotArtReader(async url => rehearsalMetadata(Number(url.split('/').at(-1))), { environment: 'rehearsal', cacheLimit: 2 });
  await reader.read(1); await reader.read(2); await reader.read(1); await reader.read(3);
  assert.equal(reader.size, 2);
  assert.ok(reader.peek(1));
  assert.equal(reader.peek(2), null);
  assert.ok(reader.peek(3));
});

test('reader bounds concurrent traffic and its pending queue', async () => {
  const waiting = [], seen = [];
  const reader = createPlotArtReader(url => new Promise(resolve => {
    const id = Number(url.split('/').at(-1)); seen.push(id);
    waiting.push(() => resolve(rehearsalMetadata(id)));
  }), { environment: 'rehearsal', concurrency: 2, maxPending: 3 });
  const a = reader.read(1), b = reader.read(2), c = reader.read(3);
  await assert.rejects(reader.read(4), /still loading/);
  await tick();
  assert.deepEqual(seen, [1, 2]);
  waiting.shift()(); await a; await tick();
  assert.deepEqual(seen, [1, 2, 3]);
  waiting.shift()(); waiting.shift()();
  await Promise.all([b, c]);
  assert.equal(reader.pendingCount, 0);
});

test('failed reads can be retried and invalid tokens never contact the transport', async () => {
  let calls = 0;
  const reader = createPlotArtReader(async () => {
    if (++calls === 1) throw new Error('HTTP 503');
    return rehearsalMetadata();
  }, { environment: 'rehearsal' });
  assert.throws(() => reader.read('331?redirect=1'), /plot number/);
  assert.equal(calls, 0);
  await assert.rejects(reader.read(331), /503/);
  assert.equal(reader.pendingCount, 0);
  assert.equal(reader.peek(331), null);
  assert.ok(await reader.read(331));
  assert.equal(calls, 2);
});

test('clearing a cache prevents an older in-flight read from repopulating it', async () => {
  let resolve;
  const reader = createPlotArtReader(() => new Promise(done => { resolve = done; }), { environment: 'rehearsal' });
  const old = reader.read(331);
  await tick(); reader.clear(); resolve(rehearsalMetadata());
  assert.equal((await old).token_id, 331);
  assert.equal(reader.size, 0);
  assert.equal(reader.peek(331), null);
});

test('cache clocks, environments and limits cannot silently create unsafe caches', async () => {
  for (const options of [{ cacheLimit: 101 }, { cacheLimit: 0 }, { ttlMs: Infinity }, { concurrency: 0 }, { maxPending: 101 }, { now: 1 }, { environment: '__proto__' }]) {
    assert.throws(() => createPlotArtReader(async () => rehearsalMetadata(), options));
  }
  let at = 1000;
  const reader = createPlotArtReader(async () => rehearsalMetadata(), { environment: 'rehearsal', now: () => at });
  await reader.read(331);
  at = 999;
  assert.equal(reader.peek(331), null);
  assert.throws(() => normalizePlotArt(rehearsalMetadata(), 331, { now: NaN, environment: 'rehearsal' }), /observation time/);
});
