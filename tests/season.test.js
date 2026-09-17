import test from 'node:test';
import assert from 'node:assert/strict';
import { createReader } from '../src/reader.js';
import { readSeason, mintPreparation, seasonPhase, weatherName, validateSeason } from '../src/season.js';
import { seasonRPC } from './fixtures/season-rpc.js';

test('season reads need no wallet, pin every field and distinguish pre-Genesis weather', async () => {
  const fixture = seasonRPC(), season = await readSeason(createReader(fixture.transport).rpc);
  assert.equal(season.block_number, 42); assert.equal(season.minted_count, 0);
  assert.equal(weatherName(season.weather_enum), 'Sunny'); assert.equal(season.effective_multiplier_bps, 12000);
  assert.equal(seasonPhase(season), 'Before Genesis'); assert.equal(season.flood_active, false);
  assert.deepEqual(season.moon_starts, [1790553600]);
  assert.ok(fixture.calls.filter(c => c.method === 'eth_call').every(c => c.params[1] === '0x2a'));
});
test('failed season reads stay unknown and do not imply Fair or an empty schedule', async () => {
  const fixture = seasonRPC({ fail: ['currentEpoch', 'moonCount', 'multiplierNow', 'floodActive', 'totalSupply'] });
  const season = await readSeason(createReader(fixture.transport).rpc);
  assert.equal(weatherName(season.weather_enum), 'Unknown'); assert.equal(season.effective_multiplier_bps, null);
  assert.equal(season.moon_count, null); assert.equal(season.flood_active, null); assert.equal(season.minted_count, null);
  assert.equal(season.read_errors.length, 5);
});
test('wrong-chain season reads fail and imported malformed observations are rejected', async () => {
  await assert.rejects(readSeason(createReader(seasonRPC({ chain: '0x1' }).transport).rpc), /Wrong RPC chain/);
  const s = await readSeason(createReader(seasonRPC().transport).rpc);
  assert.throws(() => validateSeason({ ...s, block_number: '<img>' }), /Invalid season/);
  assert.throws(() => validateSeason({ ...s, moon_starts: ['<img>'] }), /Invalid moon/);
});
test('pre-mint preparation uses finite collection odds without assigning holdings', () => {
  const p = mintPreparation(22);
  assert.equal(p.planting_crop, 55000); assert.equal(p.mint_eth, '44000000000000000');
  assert.ok(Math.abs(p.expected_counts.reduce((a, n) => a + n) - 22) < 1e-10);
  assert.ok(Math.abs(p.probability_golden - 0.19716282632626814) < 1e-12);
  assert.ok(Math.abs(mintPreparation(1).probability_golden - 33 / 3333) < 1e-12);
});
