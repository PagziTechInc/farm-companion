import { parseAbi, encodeFunctionData, decodeFunctionResult } from 'viem';
import integrations from '../knowledge/integrations.json' with { type: 'json' };
import client from '../knowledge/snapshots/client-interface-2026-09-07.json' with { type: 'json' };
import { rules, units } from './model.js';
import { readWeatherSchedule, validateWeatherSchedule } from './weather-schedule.js';

const contracts = integrations.contracts;
const numericFields = ['block_number', 'block_timestamp', 'current_epoch', 'genesis_timestamp', 'epoch_start_timestamp', 'next_boundary_timestamp', 'weather_enum', 'effective_multiplier_bps', 'minted_count', 'total_weight_bps', 'moon_count'];
export function validateSeason(s) {
  if (!s || s.schema_version !== 1 || s.chain_id !== 4663 || typeof s.observed_at_utc !== 'string' || !Number.isFinite(Date.parse(s.observed_at_utc))) throw new Error('Invalid season observation.');
  for (const key of numericFields) if (s[key] != null && (!Number.isSafeInteger(s[key]) || s[key] < 0)) throw new Error(`Invalid season ${key}.`);
  if (s.block_number == null || s.block_timestamp == null) throw new Error('Season block identity is missing.');
  for (const key of ['block_timestamp', 'genesis_timestamp', 'epoch_start_timestamp', 'next_boundary_timestamp']) if (s[key] != null && s[key] > 8640000000000) throw new Error(`Invalid season ${key}.`);
  for (const key of ['flood_active', 'moon_active']) if (s[key] != null && typeof s[key] !== 'boolean') throw new Error(`Invalid season ${key}.`);
  if (s.commit_hash != null && !/^0x[\da-fA-F]{64}$/.test(s.commit_hash)) throw new Error('Invalid weather commitment.');
  for (const key of ['carry_crop_wei','granary_crop_wei','emitted_crop_wei','paid_out_crop_wei','seed_bag_price_wei']) if(s[key]!=null && (typeof s[key]!=='string'||!/^\d{1,78}$/.test(s[key])||BigInt(s[key])>=2n**256n)) throw new Error(`Invalid season ${key}.`);
  if(s.seed_bag_open!=null&&typeof s.seed_bag_open!=='boolean') throw new Error('Invalid seed bag availability.');
  if (!Array.isArray(s.moon_starts) || s.moon_starts.length > 52 || s.moon_starts.some(t => t != null && (!Number.isSafeInteger(t) || t < 0 || t > 8640000000000))) throw new Error('Invalid moon schedule.');
  if (!Array.isArray(s.read_errors) || s.read_errors.some(e => typeof e !== 'string')) throw new Error('Invalid season read errors.');
  if (s.weather_schedule != null) validateWeatherSchedule(s.weather_schedule);
  return s;
}
export function weatherName(value) { return client.client_constants.weather_enum_order[value] ?? 'Unknown'; }
export function seasonPhase(s) {
  if (s.genesis_timestamp == null) return 'Genesis unknown';
  return s.block_timestamp < s.genesis_timestamp ? 'Before Genesis' : 'Genesis reached';
}
export function mintPreparation(count = 22) {
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('Plan between 1 and 100 plots.');
  const total = rules.plots.rarities.reduce((a, r) => a + r.count, 0), golden = rules.plots.rarities.at(-1).count;
  let noGolden = 1;
  for (let i = 0; i < count; i++) noGolden *= (total - golden - i) / (total - i);
  return { planting_crop: count * Number(rules.planting.cost_crop), mint_eth: (BigInt(count) * units(rules.plots.mint_price_eth)).toString(),
    expected_counts: rules.plots.rarities.map(r => count * r.count / total), probability_golden: 1 - noGolden };
}

// Independent of wallet inventory. Every value, including scheduled moon starts,
// is read at one block; future weatherOf getters are never treated as reveals.
export async function readSeason(rpc) {
  const chain = Number(BigInt(await rpc('eth_chainId', [])));
  if (chain !== 4663) throw new Error(`Wrong RPC chain: ${chain}; expected 4663.`);
  const block = await rpc('eth_getBlockByNumber', ['latest', false]);
  if (!block.number || !block.timestamp) throw new Error('RPC block identity is incomplete.');
  const errors = [], tag = block.number;
  async function read(contract, name, args = []) {
    try {
      const abi = parseAbi(contracts[contract].read_signatures);
      const data = encodeFunctionData({ abi, functionName: name, args });
      const raw = await rpc('eth_call', [{ to: contracts[contract].address, data }, tag]);
      return decodeFunctionResult({ abi, functionName: name, data: raw });
    } catch (e) { errors.push(`${contract}.${name}: ${e.message}`); return null; }
  }
  const [epoch, genesis, boundary, multiplier, flood, moon, count, hash, minted, total, carry, granary, emitted, paidOut, bagPrice, bagOpen] = await Promise.all([
    read('weather', 'currentEpoch'), read('weather', 'epochStart', [0n]), read('weather', 'nextBoundary'),
    read('weather', 'multiplierNow'), read('weather', 'floodActive'), read('weather', 'moonActive'),
    read('weather', 'moonCount'), read('weather', 'commitHash'), read('nft', 'totalSupply'), read('emissions', 'totalWeight'),
    read('emissions','carryNow'),read('emissions','granaryNow'),read('emissions','emitted'),read('emissions','paidOut'),
    read('activation','bagPrice'),read('activation','bagOpen'),
  ]);
  const [weather, start] = epoch == null ? [null, null] : await Promise.all([read('weather', 'weatherOf', [epoch]), read('weather', 'epochStart', [epoch])]);
  if (count != null && count > 52n) errors.push('Moon schedule is limited to its first 52 entries.');
  const moons = [];
  for (let i = 0; i < Math.min(Number(count ?? 0), 52); i++) moons.push(await read('weather', 'moons', [BigInt(i)]));
  const number = v => v == null ? null : Number(v);
  const weatherSchedule = await readWeatherSchedule(rpc, block);
  return validateSeason({ schema_version: 1, chain_id: chain, observed_at_utc: new Date().toISOString(),
    block_number: Number(BigInt(tag)), block_timestamp: Number(BigInt(block.timestamp)),
    current_epoch: number(epoch), genesis_timestamp: number(genesis), epoch_start_timestamp: number(start),
    next_boundary_timestamp: number(boundary), weather_enum: number(weather), effective_multiplier_bps: number(multiplier),
    flood_active: flood, moon_active: moon, moon_count: number(count), moon_starts: moons.map(number), commit_hash: hash,
    carry_crop_wei:carry?.toString()??null,granary_crop_wei:granary?.toString()??null,emitted_crop_wei:emitted?.toString()??null,paid_out_crop_wei:paidOut?.toString()??null,seed_bag_price_wei:bagPrice?.toString()??null,seed_bag_open:bagOpen,
    minted_count: number(minted), total_weight_bps: number(total), read_errors: errors, weather_schedule: weatherSchedule });
}
