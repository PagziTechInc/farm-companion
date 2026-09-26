import { encodeAbiParameters, decodeEventLog, decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, toEventSelector } from 'viem';
import integrations from '../knowledge/integrations.json' with { type: 'json' };
import reviewed from '../knowledge/reviewed-deployment.json' with { type: 'json' };
import rules from '../knowledge/rules.json' with { type: 'json' };
import { validateWeatherWeeks } from './weather.js';

const contract = integrations.contracts.weather;
const abi = parseAbi([...contract.read_signatures, 'event WeatherScheduled(uint256 indexed epoch, uint8 weather)']);
const event = toEventSelector('WeatherScheduled(uint256,uint8)');
const integer = value => Number.isSafeInteger(value) && value >= 0;

export function validateWeatherSchedule(value) {
  if (!value || !['ok', 'unavailable'].includes(value.status) || value.chain_id !== 4663 ||
      !integer(value.block_number) || !integer(value.block_timestamp) || !Number.isFinite(Date.parse(value.observed_at_utc))) throw Error('Invalid weather schedule observation.');
  validateWeatherWeeks(value.weeks);
  if (value.status === 'ok' && (value.genesis_timestamp !== rules.schedule.genesis_timestamp || !/^0x[\da-fA-F]{64}$/.test(value.commit_hash))) throw Error('Invalid weather schedule identity.');
  return value;
}

// weatherOf() carries prior weather into unset weeks. Only a scheduling event
// establishes an announced future epoch; the latest write wins before cutoff.
export async function readWeatherSchedule(rpc, block) {
  const tag = block.number, blockNumber = Number(BigInt(tag)), blockTimestamp = Number(BigInt(block.timestamp));
  const base = { chain_id: 4663, block_number: blockNumber, block_timestamp: blockTimestamp,
    observed_at_utc: new Date().toISOString(), weeks: [] };
  try {
    if (blockNumber < contract.deployment_block) throw Error('Weather deployment is after this block.');
    const code = await rpc('eth_getCode', [contract.address, tag]);
    if (keccak256(code) !== reviewed.contracts.weather.runtime_keccak256) throw Error('Weather deployment differs from the reviewed source.');
    async function call(name, args = []) {
      const raw = await rpc('eth_call', [{to: contract.address, data: encodeFunctionData({abi, functionName: name, args})}, tag]);
      return decodeFunctionResult({abi, functionName: name, data: raw});
    }
    const [logs, genesis, commitment] = await Promise.all([
      rpc('eth_getLogs', [{address: contract.address, fromBlock: '0x' + contract.deployment_block.toString(16), toBlock: tag, topics: [event]}]).catch(() => null),
      call('epochStart', [0n]), call('commitHash'),
    ]);
    if (Number(genesis) !== rules.schedule.genesis_timestamp) throw Error('Weather Genesis differs from the Almanac.');
    if (logs !== null && (!Array.isArray(logs) || logs.length > 4096)) throw Error('Weather event history is unavailable or too large.');
    const scheduled = new Map();
    const ordered = (logs ?? []).map(log => {
      if (!log || log.address?.toLowerCase() !== contract.address || log.removed === true ||
          !/^0x[\da-fA-F]{64}$/.test(log.transactionHash)) throw Error('Invalid weather event identity.');
      const height = Number(BigInt(log.blockNumber)), index = Number(BigInt(log.logIndex));
      if (!integer(height) || height < contract.deployment_block || height > blockNumber || !integer(index)) throw Error('Weather event is outside the pinned history.');
      const decoded = decodeEventLog({abi, eventName: 'WeatherScheduled', topics: log.topics, data: log.data, strict: true});
      return {height, index, epoch: Number(decoded.args.epoch), weather: Number(decoded.args.weather), hash: log.transactionHash};
    }).sort((a,b) => a.height - b.height || a.index - b.index);
    for (const log of ordered) {
      const state = rules.weather.states.find(w => w.contract_enum === log.weather);
      if (!integer(log.epoch) || !state) throw Error('Invalid announced weather.');
      if (log.epoch > 208) continue; // Harvests end after the four-year schedule.
      scheduled.set(log.epoch, {epoch: log.epoch, multiplier_bps: state.multiplier_bps,
        announced: true, scheduled_block: log.height, transaction_hash: log.hash});
    }
    // Public providers may reject full event histories. The source-reviewed
    // oracle's slot 2 stores Weather + 1, so zero is provably unannounced.
    // Read the current 12-week season plus its history, always at the same block.
    if (logs === null) {
      const current = Math.max(0,Math.floor((blockTimestamp-Number(genesis))/604800));
      const end = Math.min(208,Math.floor(current/12)*12+11);
      for (let offset=0;offset<=end;offset+=20) {
        await Promise.all(Array.from({length:Math.min(20,end-offset+1)},async(_,i)=>{
          const epoch=offset+i;
          const slot=keccak256(encodeAbiParameters([{type:'uint256'},{type:'uint256'}],[BigInt(epoch),2n]));
          const raw=await rpc('eth_getStorageAt',[contract.address,slot,tag]);
          if(typeof raw!=='string'||!/^0x[0-9a-f]{64}$/i.test(raw))throw Error('Weather storage observation is invalid.');
          const encoded=BigInt(raw);
          if(encoded>5n)throw Error('Weather storage differs from the reviewed layout.');
          if(encoded)scheduled.set(epoch,{epoch,multiplier_bps:rules.weather.states.find(w=>w.contract_enum===Number(encoded)-1).multiplier_bps,announced:true,evidence:'pinned-storage'});
        }));
      }
    }
    const weeks = [...scheduled.values()].sort((a,b) => a.epoch - b.epoch);
    // After the write cutoff an unset epoch's inherited weather is fixed by the
    // reviewed contract. Keep that history distinct from a future announcement.
    const lastLocked = Math.min(208, Math.floor((blockTimestamp + 86400 - Number(genesis) - 1) / 604800));
    for (let epoch = 0; epoch <= lastLocked; epoch++) {
      if (scheduled.has(epoch)) continue;
      let multiplier = 10000;
      for (let back = 1; back <= 52 && back <= epoch; back++) {
        const previous = scheduled.get(epoch - back);
        if (previous) { multiplier = previous.multiplier_bps; break; }
      }
      weeks.push({epoch, multiplier_bps: multiplier, announced: false});
    }
    weeks.sort((a,b) => a.epoch - b.epoch);
    // Even before Genesis, the current getter can expose missing event history.
    // This check does not promote an unset future week to an announcement.
    const currentEpoch = Math.max(0, Math.min(208, Math.floor((blockTimestamp - Number(genesis)) / 604800)));
    if (!weeks.some(week => week.epoch === currentEpoch)) {
      let expected = 10000;
      for (let back = 0; back <= 52 && back <= currentEpoch; back++) {
        const previous = scheduled.get(currentEpoch - back);
        if (previous) { expected = previous.multiplier_bps; break; }
      }
      const current = Number(await call('weatherOf', [BigInt(currentEpoch)]));
      if (rules.weather.states.find(w => w.contract_enum === current)?.multiplier_bps !== expected) throw Error('Weather event history is incomplete.');
    }
    // Check inferred history as well: a successful but incomplete log response
    // must not turn inherited Sunny into an apparently verified Fair week.
    for (let offset = 0; offset < weeks.length; offset += 4) {
      await Promise.all(weeks.slice(offset, offset + 4).map(async week => {
        const value = Number(await call('weatherOf', [BigInt(week.epoch)]));
        if (rules.weather.states.find(w => w.contract_enum === value)?.multiplier_bps !== week.multiplier_bps) throw Error('Weather events and pinned getter disagree.');
      }));
    }
    return validateWeatherSchedule({...base, status: 'ok', genesis_timestamp: Number(genesis), commit_hash: commitment, weeks});
  } catch (error) {
    return {...base, status: 'unavailable', error: error.message};
  }
}
