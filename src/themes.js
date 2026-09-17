// Companion palettes describe artwork only. They never establish economic
// rarity, ownership, weather, or yield and have no dependency on the engine.
export const THEME_IDS = Object.freeze([
  'journal', 'base', 'winter', 'festival', 'autumn', 'storm',
  'golden', 'dusk', 'overcast',
]);

const SCENE_IDS = new Set(THEME_IDS);
const normalize = value => typeof value === 'string'
  ? value.toLowerCase().trim().replace(/[\s_-]+/g, ' ') : '';

export function themeForScene(scene) {
  return SCENE_IDS.has(scene) ? scene : 'journal';
}

function visualTraits(metadata) {
  const traits = {};
  for (const [name, value] of Object.entries(metadata?.visual_traits || {})) {
    traits[normalize(name)] = normalize(value);
  }
  const rows = Array.isArray(metadata?.traits) ? metadata.traits
    : Array.isArray(metadata?.attributes) ? metadata.attributes : [];
  for (const trait of rows) {
    const name = normalize(trait?.name ?? trait?.trait_type);
    if (name && !(name in traits)) traits[name] = normalize(trait?.value);
  }
  return traits;
}

export function themeForPlot(metadata) {
  const traits = visualTraits(metadata);
  // A gold fence is a visual component shared by otherwise ordinary plots.
  // The luminous palette matches the full six-part Golden illustration.
  if (['soil', 'crop', 'scarecrow', 'sky', 'fence', 'critter'].every(key => traits[key] === 'golden')) return 'golden';
  const skin = traits.skin || traits['seasonal skin'] || traits.theme;
  const skins = { 'deep winter': 'winter', winter: 'winter',
    'festival night': 'festival', festival: 'festival',
    'autumn gold': 'autumn', autumn: 'autumn',
    'storm watch': 'storm', storm: 'storm' };
  if (Object.hasOwn(skins, skin)) return skins[skin];
  const skies = { snow: 'winter', snowy: 'winter', winter: 'winter',
    night: 'festival', 'festival night': 'festival',
    dusk: 'dusk', sunset: 'dusk', twilight: 'dusk',
    overcast: 'overcast', cloudy: 'overcast',
    storm: 'storm', stormy: 'storm', rain: 'storm', rainy: 'storm' };
  if (Object.hasOwn(skies, traits.sky)) return skies[traits.sky];
  if (traits.soil === 'clay') return 'autumn';
  if (traits.soil || traits.sky) return 'base';
  return SCENE_IDS.has(metadata?.theme_hint) ? metadata.theme_hint : 'base';
}

export function resolveTheme({ scene = 'journal', asset = null } = {}) {
  return scene === 'plot' ? themeForPlot(asset) : themeForScene(scene);
}
