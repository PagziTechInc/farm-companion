// Artwork metadata is display-only. It never supplies holdings, rarity evidence,
// activation, level, weather, balances or any other calculator input.
const API_ORIGIN = 'https://api.rh.farm';
const MAX_TOKEN_ID = 3333;

const PRODUCTION_SOURCE = Object.freeze({
  environment: 'production',
  origin: API_ORIGIN,
  metadataPath: '/metadata/',
  livePath: '/plot/',
  imagePath: '/image/',
  animationPath: '/animation/',
  maxTokenId: MAX_TOKEN_ID
});

const REHEARSAL_SOURCE = Object.freeze({
  environment: 'rehearsal',
  origin: API_ORIGIN,
  metadataPath: '/rehearsal/',
  livePath: null,
  imagePath: '/rehearsal/image/',
  animationPath: '/rehearsal/animation/',
  maxTokenId: MAX_TOKEN_ID
});

export const PLOT_ART_SOURCES = Object.freeze({
  production: PRODUCTION_SOURCE,
  rehearsal: REHEARSAL_SOURCE
});

// Preserve the singular export for callers that need the normal source.
export const PLOT_ART_SOURCE = PRODUCTION_SOURCE;

const VISUAL_TRAIT_NAMES = Object.freeze(['soil', 'crop', 'scarecrow', 'sky', 'fence', 'critter']);
const PLACEHOLDER_TRAIT = /^(?:unrevealed|not\s+revealed|sealed|unknown|not\s+available|not\s+set|not\s+assigned|pending(?:\s+reveal)?|n\/?a)$/i;

function plotArtSource(environment = 'production') {
  const source = typeof environment === 'string' && Object.prototype.hasOwnProperty.call(PLOT_ART_SOURCES, environment)
    ? PLOT_ART_SOURCES[environment]
    : null;
  if (!source) throw new Error('Choose the production or rehearsal artwork source.');
  return source;
}

function plotArtError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function unrevealedError() {
  return plotArtError('ASSET_UNREVEALED', 'Waiting for reveal. Plot artwork is available after the plot is revealed.');
}

export function plotArtTokenId(value) {
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('Choose a plot number from 1 to 3,333.');
  if (typeof value === 'string' && !/^[1-9]\d{0,3}$/.test(value)) throw new Error('Choose a plot number from 1 to 3,333.');
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1 || id > MAX_TOKEN_ID) throw new Error('Choose a plot number from 1 to 3,333.');
  return id;
}

export function plotArtUrls(tokenId, environment = 'production') {
  const id = plotArtTokenId(tokenId), source = plotArtSource(environment);
  return Object.freeze({
    metadata_url: `${source.origin}${source.metadataPath}${id}`,
    live_url: source.livePath ? `${source.origin}${source.livePath}${id}` : null,
    image_url: `${source.origin}${source.imagePath}${id}.png`,
    animation_url: `${source.origin}${source.animationPath}${id}.html`
  });
}

export function safePlotArtUrl(value, tokenId, kind, environment = 'production') {
  const source = plotArtSource(environment), expected = plotArtUrls(tokenId, environment)[`${kind}_url`];
  if (!expected || typeof value !== 'string' || value.length > 256 || value !== value.trim()) return null;
  try {
    const url = new URL(value), canonical = new URL(expected);
    if (url.href !== value || url.origin !== source.origin || url.username || url.password || url.hash || url.pathname !== canonical.pathname) return null;
    // Production's published animation uses an exact image revision of the
    // form ?s=1db. The rehearsal endpoint has its own observed ?r=<digits> form.
    // Animation documents never accept a query string in either environment.
    if (kind === 'image') {
      const allowed = environment === 'production'
        ? /^(?:\?s=[1-5][pd]b)?$/
        : /^(?:\?r=\d{1,10})?$/;
      if (!allowed.test(url.search)) return null;
    } else if (url.search) return null;
    return url.href;
  } catch { return null; }
}

function displayText(value, limit, fallback = '') {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  if (typeof value === 'number' && !Number.isFinite(value)) return fallback;
  return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit);
}

export function plotArtThemeHint(visualTraits = {}) {
  // A cosmetic interpretation of visual traits, never an economic rarity map.
  const sky = displayText(visualTraits.sky, 120).toLowerCase();
  const soil = displayText(visualTraits.soil, 120).toLowerCase();
  const crop = displayText(visualTraits.crop, 120).toLowerCase();
  if (/golden/.test(sky) || (/golden/.test(soil) && /golden/.test(crop))) return 'golden';
  if (/winter|snow|frost|ice/.test(`${sky} ${soil}`)) return 'winter';
  if (/storm|rain|overcast|thunder/.test(sky)) return 'storm';
  if (/night|moon|dusk|festival/.test(sky)) return 'festival';
  if (/autumn|fall|harvest/.test(sky) || /pumpkin/.test(crop)) return 'autumn';
  return 'base';
}

function isPlaceholderTrait(value) {
  return PLACEHOLDER_TRAIT.test(displayText(value, 120));
}

function isUnrevealedImage(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.origin === API_ORIGIN && url.pathname === '/image/unrevealed.png' && !url.search && !url.hash;
  } catch { return false; }
}

function normalizedTraits(raw, environment) {
  if (!Array.isArray(raw.attributes)) {
    if (environment === 'production') throw unrevealedError();
    throw new Error('The plot artwork traits are unavailable.');
  }
  if (raw.attributes.length > 64) throw new Error('The plot artwork traits are unavailable.');
  const traits = [], seen = new Set();
  for (const attribute of raw.attributes) {
    if (!attribute || typeof attribute !== 'object' || Array.isArray(attribute)) continue;
    const name = displayText(attribute.trait_type, 60), value = displayText(attribute.value, 120);
    const key = name.toLowerCase();
    if (!name || !value || seen.has(key)) continue;
    seen.add(key);
    traits.push(Object.freeze({ name, value }));
  }
  return traits;
}

export function normalizePlotArt(raw, tokenId, { now = Date.now(), environment = 'production' } = {}) {
  const source = plotArtSource(environment), id = plotArtTokenId(tokenId), urls = plotArtUrls(id, environment);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The plot artwork response is unavailable.');
  if (environment === 'production') {
    const status = displayText(raw.status, 120).toLowerCase();
    if (raw.revealed === false || PLACEHOLDER_TRAIT.test(status)) throw unrevealedError();
    if (isUnrevealedImage(raw.image)) throw unrevealedError();
  }
  const traits = normalizedTraits(raw, environment);
  if (environment === 'production') {
    const status = traits.find(trait => trait.name.toLowerCase() === 'status')?.value;
    if (status && PLACEHOLDER_TRAIT.test(status)) throw unrevealedError();
  }
  const visualTraits = {};
  for (const name of VISUAL_TRAIT_NAMES) {
    visualTraits[name] = traits.find(trait => trait.name.toLowerCase() === name)?.value || '';
  }
  if (environment === 'production' && VISUAL_TRAIT_NAMES.some(name => !visualTraits[name] || isPlaceholderTrait(visualTraits[name]))) {
    throw unrevealedError();
  }
  const image = safePlotArtUrl(raw.image, id, 'image', environment);
  const animation = raw.animation_url == null && environment === 'production'
    ? urls.animation_url
    : safePlotArtUrl(raw.animation_url, id, 'animation', environment);
  if (!image || !animation) throw new Error(`The plot artwork links did not match the ${environment} source.`);
  const fetched = new Date(now);
  if (!Number.isFinite(fetched.getTime())) throw new Error('The artwork observation time is invalid.');
  return Object.freeze({
    token_id: id,
    name: displayText(raw.name, 100, `Plot #${String(id).padStart(4, '0')}`),
    description: displayText(raw.description, 800),
    metadata_url: urls.metadata_url,
    image_url: image,
    animation_url: animation,
    environment: source.environment,
    traits: Object.freeze(traits),
    visual_traits: Object.freeze(visualTraits),
    theme_hint: plotArtThemeHint(visualTraits),
    fetched_at_utc: fetched.toISOString()
  });
}

// The live endpoint is checked only to gate unrevealed image paths. These
// bounded fields are display-only and never enter a forecast or ownership model.
export function validateProductionPlotState(raw, tokenId) {
  const id = plotArtTokenId(tokenId);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Number.isSafeInteger(raw.tokenId) || raw.tokenId !== id) {
    throw plotArtError('ASSET_STATE_INVALID', 'The live plot response did not match the requested plot.');
  }
  if (raw.revealed !== true) {
    if (raw.revealed === false) throw unrevealedError();
    throw plotArtError('ASSET_STATE_INVALID', 'The live plot reveal status is unavailable.');
  }
  const tier = displayText(raw.tier, 60) || null;
  const level = Number.isInteger(raw.level) && raw.level >= 1 && raw.level <= 5 ? raw.level : null;
  const weightBps = Number.isInteger(raw.weightBps) && raw.weightBps >= 0 && raw.weightBps <= 100000 ? raw.weightBps : null;
  return Object.freeze({
    token_id: id,
    revealed: true,
    tier_finalized: typeof raw.tierFinalized === 'boolean' ? raw.tierFinalized : null,
    level,
    tier,
    weight_bps: weightBps
  });
}

export function validateSavedPlotArt(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value) || !Object.prototype.hasOwnProperty.call(PLOT_ART_SOURCES, value.environment)) throw new Error('The saved plot artwork source is invalid.');
  const environment = value.environment, urls = plotArtUrls(value.token_id, environment);
  if (value.metadata_url !== urls.metadata_url || !Array.isArray(value.traits) || value.traits.length > 64) throw new Error('The saved plot artwork details are invalid.');
  if (typeof value.fetched_at_utc !== 'string') throw new Error('The saved artwork observation time is invalid.');
  const at = new Date(value.fetched_at_utc);
  if (!Number.isFinite(at.getTime()) || at.toISOString() !== value.fetched_at_utc) throw new Error('The saved artwork observation time is invalid.');
  const attributes = value.traits.map(trait => {
    if (!trait || typeof trait !== 'object' || Array.isArray(trait) || typeof trait.name !== 'string' || !trait.name.trim() || trait.name.length > 60 || typeof trait.value !== 'string' || !trait.value.trim() || trait.value.length > 120) throw new Error('The saved plot artwork traits are invalid.');
    return { trait_type: trait.name, value: trait.value };
  });
  // Recompute visual traits and palette; imported hints and economic-looking
  // fields never gain authority merely because they appeared in a saved farm.
  return normalizePlotArt({
    name: value.name, description: value.description,
    image: value.image_url, animation_url: value.animation_url, attributes
  }, value.token_id, { now: at.getTime(), environment });
}

function boundedOption(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid artwork ${name}.`);
  return value;
}

export function createPlotArtReader(transport, { environment = 'production', cacheLimit = 100, ttlMs = 300000, concurrency = 3, maxPending = 24, now = Date.now } = {}) {
  const source = plotArtSource(environment);
  if (typeof transport !== 'function' || typeof now !== 'function') throw new Error('An artwork transport and clock are required.');
  boundedOption(cacheLimit, 1, 100, 'cache limit');
  boundedOption(ttlMs, 1, 3600000, 'cache lifetime');
  boundedOption(concurrency, 1, 6, 'concurrency');
  boundedOption(maxPending, concurrency, 100, 'queue limit');
  const cache = new Map(), pending = new Map(), queue = [];
  let active = 0, generation = 0;
  const timestamp = () => {
    const value = now();
    if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) throw new Error('The artwork observation time is invalid.');
    return value;
  };
  const requestOptions = Object.freeze({
    method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store'
  });
  function peek(tokenId) {
    const id = plotArtTokenId(tokenId), entry = cache.get(id);
    if (!entry) return null;
    const at = timestamp();
    if (at - entry.at >= ttlMs || at < entry.at) { cache.delete(id); return null; }
    return entry.art;
  }
  function pump() {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      active++;
      const finish = () => { active--; pending.delete(job.id); pump(); };
      Promise.resolve().then(async () => {
        const urls = plotArtUrls(job.id, environment);
        let raw;
        if (environment === 'production') {
          // Use one nonce for the live-state gate and metadata request. Live
          // counters only establish the reveal state; they are not returned as
          // artwork or used as calculator evidence.
          const fresh = encodeURIComponent(timestamp());
          const live = await transport(`${urls.live_url}?fresh=${fresh}`, requestOptions);
          validateProductionPlotState(live, job.id);
          raw = await transport(`${urls.metadata_url}?fresh=${fresh}`, requestOptions);
        } else raw = await transport(urls.metadata_url, requestOptions);
        const at = timestamp(), art = normalizePlotArt(raw, job.id, { now: at, environment });
        if (job.generation === generation) {
          cache.delete(job.id);
          cache.set(job.id, { at, art });
          while (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
        }
        return art;
      }).then(art => { finish(); job.resolve(art); }).catch(error => { finish(); job.reject(error); });
    }
  }
  function read(tokenId, { force = false } = {}) {
    const id = plotArtTokenId(tokenId), cached = !force && peek(id);
    if (cached) {
      const entry = cache.get(id);
      cache.delete(id); cache.set(id, entry);
      return Promise.resolve(cached);
    }
    if (pending.has(id)) return pending.get(id);
    if (pending.size >= maxPending) return Promise.reject(new Error('Artwork is still loading. Try this plot again shortly.'));
    let resolve, reject;
    const result = new Promise((success, failure) => { resolve = success; reject = failure; });
    pending.set(id, result);
    queue.push({ id, generation, resolve, reject });
    pump();
    return result;
  }
  return Object.freeze({
    read, peek,
    environment: source.environment,
    source,
    clear() { cache.clear(); generation++; },
    get size() { return cache.size; },
    get pendingCount() { return pending.size; }
  });
}
