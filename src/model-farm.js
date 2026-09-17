import { rules } from './model.js';

const MAX_BATCH_SIZE = 100;

function rarityPool() {
  const rarities = rules?.plots?.rarities;
  if (!Array.isArray(rarities) || rarities.length === 0) {
    throw new Error('Published plot rarity data is unavailable.');
  }

  const pool = rarities.map(({ tier, count }) => {
    if (!Number.isSafeInteger(tier) || tier < 0 || !Number.isSafeInteger(count) || count < 1) {
      throw new Error('Published plot rarity data is invalid.');
    }
    return { tier, remaining: count };
  });

  const total = pool.reduce((sum, rarity) => sum + rarity.remaining, 0);
  if (!Number.isSafeInteger(total) || total !== rules.plots.max_supply || new Set(pool.map(({ tier }) => tier)).size !== pool.length) {
    throw new Error('Published plot rarity counts do not match the supply.');
  }

  return { pool, total };
}

export function sampleRarityTiers(count, random = Math.random) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH_SIZE) {
    throw new RangeError('count must be an integer from 1 to 100.');
  }
  if (typeof random !== 'function') {
    throw new TypeError('random must be a function.');
  }

  const { pool, total } = rarityPool();
  const sampled = new Array(count);
  let remainingTotal = total;

  for (let index = 0; index < count; index += 1) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError('random must return a finite number in [0, 1).');
    }

    let position = Math.floor(value * remainingTotal);
    let selected = false;
    for (const rarity of pool) {
      if (position < rarity.remaining) {
        sampled[index] = rarity.tier;
        rarity.remaining -= 1;
        remainingTotal -= 1;
        selected = true;
        break;
      }
      position -= rarity.remaining;
    }

    if (!selected) {
      throw new Error('Could not select a published plot rarity.');
    }
  }

  return sampled;
}
