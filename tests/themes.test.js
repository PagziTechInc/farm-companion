import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme, themeForPlot, themeForScene } from '../src/themes.js';

test('a fully Golden visual composition receives a Golden palette; a gold fence does not', () => {
  const visual_traits = Object.fromEntries(['soil','crop','scarecrow','sky','fence','critter'].map(key => [key, 'Golden']));
  assert.equal(themeForPlot({ visual_traits }), 'golden');
  assert.equal(themeForPlot({ visual_traits: { soil: 'Loam', sky: 'Day', fence: 'Gold' } }), 'base');
  assert.equal(themeForPlot({ attributes: [{ trait_type: 'Rarity', value: 'Golden Acre' }] }), 'base');
});

test('plot themes follow visual sky and soil while explicit scene selection remains independent', () => {
  const asset = { visual_traits: { soil: 'Clay', sky: 'Dusk' } };
  assert.equal(resolveTheme({ scene: 'plot', asset }), 'dusk');
  assert.equal(resolveTheme({ scene: 'winter', asset }), 'winter');
  assert.equal(themeForPlot({ visual_traits: { soil: 'Clay', sky: 'Day' } }), 'autumn');
  assert.equal(themeForPlot({ visual_traits: { soil: 'Loam', sky: 'Overcast' } }), 'overcast');
});

test('raw and normalized visual metadata resolve consistently without mutation', () => {
  const raw = { attributes: [{ trait_type: 'Sky', value: 'Night' }, { trait_type: 'Soil', value: 'Loam' }] };
  const before = JSON.stringify(raw);
  assert.equal(themeForPlot(raw), 'festival');
  assert.equal(themeForPlot({ traits: [{ name: 'Skin', value: 'Deep Winter' }] }), 'winter');
  assert.equal(JSON.stringify(raw), before);
});

test('missing and malformed saved preferences use a safe local palette', () => {
  assert.equal(resolveTheme(), 'journal');
  assert.equal(themeForScene('url(https://example.invalid/theme)'), 'journal');
  assert.equal(themeForPlot(null), 'base');
  assert.equal(themeForPlot({ traits: {}, attributes: 'Storm' }), 'base');
  assert.equal(themeForPlot({ theme_hint: 'storm' }), 'storm');
  assert.equal(themeForPlot({ theme_hint: '__proto__' }), 'base');
  assert.equal(themeForPlot({ visual_traits: { skin: 'constructor', sky: '__proto__' } }), 'base');
});
