import hero from '../assets/site/hero-plot.webp';
import keeper from '../assets/site/keeper.webp';
import almanac from '../assets/site/almanac-study.webp';
import mabel from '../assets/site/mabel.webp';
import corn from '../assets/site/corn.png';
import common from '../assets/site/common-showcase.webp';
import fertile from '../assets/site/fertile-showcase.webp';
import prize from '../assets/site/prize-showcase.webp';
import golden from '../assets/site/golden-showcase.webp';
import level1 from '../assets/site/level-1.webp';
import level2 from '../assets/site/level-2.webp';
import level3 from '../assets/site/level-3.webp';
import level4 from '../assets/site/level-4.webp';
import level5 from '../assets/site/level-5.webp';

// Public gallery examples, not a mapping from token IDs to owned plot artwork.
// Provenance and original checksums are recorded in assets/site/sources.json.
export const rarityArtwork = Object.freeze([common, fertile, prize, golden]);
export const levelArtwork = Object.freeze([level1, level2, level3, level4, level5]);

export const art = Object.freeze({ hero, keeper, almanac, mabel, corn, rarities: rarityArtwork, levels: levelArtwork });
export default art;

export function rarityShowcase(tier) {
  return Number.isInteger(tier) && tier >= 0 && tier < rarityArtwork.length ? rarityArtwork[tier] : null;
}

export function levelShowcase(level) {
  return Number.isInteger(level) && level >= 1 && level <= 5 ? levelArtwork[level - 1] : null;
}
