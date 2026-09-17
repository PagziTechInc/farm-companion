import winter from '../assets/site/season-winter.webp';
import festival from '../assets/site/season-festival.webp';
import autumn from '../assets/site/season-autumn.webp';
import storm from '../assets/site/season-storm.webp';
import base from '../assets/site/season-base.webp';
import store from '../assets/site/season-store.webp';
import overcast from '../assets/site/season-overcast.webp';
import dusk from '../assets/site/season-dusk.webp';
import goose from '../assets/site/goose.png';
import scarecrow from '../assets/site/season-scarecrow.webp';
import fertilizer from '../assets/site/season-fertilizer.webp';
import tarp from '../assets/site/season-tarp.webp';

// Original official artwork. Provenance: assets/site/expansion-sources.json.
// These are illustrations and cosmetic previews, never an owned token image
// or evidence that a skin changes earnings or is currently available to buy.
export const seasonArt = Object.freeze({ winter, festival, autumn, storm, base, store, overcast, dusk, goose, scarecrow, fertilizer, tarp });
export const seasonLooks = Object.freeze([
  Object.freeze({ id: 'base', name: 'Original field', image: base }),
  Object.freeze({ id: 'winter', name: 'Deep Winter', image: winter }),
  Object.freeze({ id: 'festival', name: 'Festival Night', image: festival }),
  Object.freeze({ id: 'autumn', name: 'Autumn Gold', image: autumn }),
  Object.freeze({ id: 'storm', name: 'Storm Watch', image: storm }),
]);

// Exact inline pixel weather glyphs from the official homepage weather row.
export const weatherGlyphs = Object.freeze({
  "locusts": "<svg width=\"24\" height=\"24\" viewBox=\"0 0 8 8\" shape-rendering=\"crispEdges\" aria-hidden=\"true\" class=\"shrink-0\"><rect x=\"1\" y=\"1\" width=\"2\" height=\"1\" fill=\"#3f6212\"></rect><rect x=\"4\" y=\"0\" width=\"2\" height=\"1\" fill=\"#3f6212\"></rect><rect x=\"6\" y=\"2\" width=\"2\" height=\"1\" fill=\"#3f6212\"></rect><rect x=\"2\" y=\"3\" width=\"2\" height=\"1\" fill=\"#3f6212\"></rect><rect x=\"5\" y=\"4\" width=\"2\" height=\"1\" fill=\"#3f6212\"></rect><rect x=\"0\" y=\"4\" width=\"1\" height=\"1\" fill=\"#3f6212\"></rect><rect x=\"3\" y=\"5\" width=\"2\" height=\"1\" fill=\"#3f6212\"></rect><rect x=\"3\" y=\"1\" width=\"1\" height=\"1\" fill=\"#a3e635\"></rect><rect x=\"6\" y=\"0\" width=\"1\" height=\"1\" fill=\"#a3e635\"></rect><rect x=\"1\" y=\"3\" width=\"1\" height=\"1\" fill=\"#a3e635\"></rect><rect x=\"4\" y=\"4\" width=\"1\" height=\"1\" fill=\"#a3e635\"></rect><rect x=\"2\" y=\"5\" width=\"1\" height=\"1\" fill=\"#a3e635\"></rect><rect x=\"7\" y=\"4\" width=\"1\" height=\"1\" fill=\"#a3e635\"></rect><rect x=\"0\" y=\"7\" width=\"8\" height=\"1\" fill=\"#65a30d\"></rect><rect x=\"2\" y=\"6\" width=\"1\" height=\"1\" fill=\"#65a30d\"></rect><rect x=\"5\" y=\"6\" width=\"1\" height=\"1\" fill=\"#65a30d\"></rect></svg>",
  "drought": "<svg width=\"24\" height=\"24\" viewBox=\"0 0 8 8\" shape-rendering=\"crispEdges\" aria-hidden=\"true\" class=\"shrink-0\"><rect x=\"3\" y=\"0\" width=\"2\" height=\"2\" fill=\"#fde047\"></rect><rect x=\"2\" y=\"1\" width=\"1\" height=\"1\" fill=\"#fde047\"></rect><rect x=\"5\" y=\"1\" width=\"1\" height=\"1\" fill=\"#fde047\"></rect><rect x=\"0\" y=\"4\" width=\"8\" height=\"4\" fill=\"#d97706\"></rect><rect x=\"2\" y=\"4\" width=\"1\" height=\"1\" fill=\"#7c2d12\"></rect><rect x=\"3\" y=\"5\" width=\"1\" height=\"1\" fill=\"#7c2d12\"></rect><rect x=\"2\" y=\"6\" width=\"1\" height=\"1\" fill=\"#7c2d12\"></rect><rect x=\"3\" y=\"7\" width=\"1\" height=\"1\" fill=\"#7c2d12\"></rect><rect x=\"5\" y=\"4\" width=\"1\" height=\"1\" fill=\"#7c2d12\"></rect><rect x=\"6\" y=\"5\" width=\"1\" height=\"1\" fill=\"#7c2d12\"></rect><rect x=\"5\" y=\"6\" width=\"1\" height=\"1\" fill=\"#7c2d12\"></rect><rect x=\"6\" y=\"7\" width=\"1\" height=\"1\" fill=\"#7c2d12\"></rect><rect x=\"0\" y=\"6\" width=\"1\" height=\"1\" fill=\"#7c2d12\"></rect><rect x=\"1\" y=\"7\" width=\"1\" height=\"1\" fill=\"#7c2d12\"></rect></svg>",
  "fair": "<svg width=\"24\" height=\"24\" viewBox=\"0 0 8 8\" shape-rendering=\"crispEdges\" aria-hidden=\"true\" class=\"shrink-0\"><rect x=\"1\" y=\"0\" width=\"2\" height=\"2\" fill=\"#fde047\"></rect><rect x=\"0\" y=\"1\" width=\"1\" height=\"1\" fill=\"#fde047\"></rect><rect x=\"3\" y=\"1\" width=\"1\" height=\"1\" fill=\"#fde047\"></rect><rect x=\"1\" y=\"3\" width=\"1\" height=\"1\" fill=\"#fde047\"></rect><rect x=\"3\" y=\"4\" width=\"4\" height=\"1\" fill=\"#cbd5e1\"></rect><rect x=\"2\" y=\"5\" width=\"6\" height=\"2\" fill=\"#cbd5e1\"></rect><rect x=\"2\" y=\"7\" width=\"6\" height=\"1\" fill=\"#94a3b8\"></rect></svg>",
  "sunny": "<svg width=\"24\" height=\"24\" viewBox=\"0 0 8 8\" shape-rendering=\"crispEdges\" aria-hidden=\"true\" class=\"shrink-0\"><rect x=\"3\" y=\"3\" width=\"2\" height=\"2\" fill=\"#fbbf24\"></rect><rect x=\"3\" y=\"0\" width=\"2\" height=\"1\" fill=\"#fde047\"></rect><rect x=\"3\" y=\"7\" width=\"2\" height=\"1\" fill=\"#fde047\"></rect><rect x=\"0\" y=\"3\" width=\"1\" height=\"2\" fill=\"#fde047\"></rect><rect x=\"7\" y=\"3\" width=\"1\" height=\"2\" fill=\"#fde047\"></rect><rect x=\"1\" y=\"1\" width=\"1\" height=\"1\" fill=\"#fde047\"></rect><rect x=\"6\" y=\"1\" width=\"1\" height=\"1\" fill=\"#fde047\"></rect><rect x=\"1\" y=\"6\" width=\"1\" height=\"1\" fill=\"#fde047\"></rect><rect x=\"6\" y=\"6\" width=\"1\" height=\"1\" fill=\"#fde047\"></rect></svg>",
  "rain": "<svg width=\"24\" height=\"24\" viewBox=\"0 0 8 8\" shape-rendering=\"crispEdges\" aria-hidden=\"true\" class=\"shrink-0\"><rect x=\"1\" y=\"1\" width=\"6\" height=\"2\" fill=\"#cbd5e1\"></rect><rect x=\"0\" y=\"2\" width=\"8\" height=\"2\" fill=\"#cbd5e1\"></rect><rect x=\"1\" y=\"5\" width=\"1\" height=\"1\" fill=\"#7dd3fc\"></rect><rect x=\"3\" y=\"6\" width=\"1\" height=\"1\" fill=\"#7dd3fc\"></rect><rect x=\"5\" y=\"5\" width=\"1\" height=\"1\" fill=\"#7dd3fc\"></rect><rect x=\"2\" y=\"7\" width=\"1\" height=\"1\" fill=\"#7dd3fc\"></rect><rect x=\"6\" y=\"7\" width=\"1\" height=\"1\" fill=\"#7dd3fc\"></rect><rect x=\"4\" y=\"4\" width=\"1\" height=\"1\" fill=\"#7dd3fc\"></rect></svg>"
});
