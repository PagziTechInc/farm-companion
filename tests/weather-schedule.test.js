import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionResult, encodeEventTopics, encodeAbiParameters, parseAbi, toHex, toEventSelector } from 'viem';
import { readWeatherSchedule, validateWeatherSchedule } from '../src/weather-schedule.js';
import { GENESIS } from '../src/model.js';
import integrations from '../knowledge/integrations.json' with { type: 'json' };
import reviewedWeather from '../knowledge/snapshots/verified-contracts-2026-09-11/weather.json' with { type: 'json' };
import launch from '../knowledge/launch-weather.json' with { type: 'json' };

const contract = integrations.contracts.weather, DAY = 86400, WEEK = 7 * DAY;
const abi = parseAbi([...contract.read_signatures, 'event WeatherScheduled(uint256 indexed epoch, uint8 weather)']);
const event = toEventSelector('WeatherScheduled(uint256,uint8)');
function log(epoch, weather, { height = contract.deployment_block + 1, index = 0 } = {}) {
  return { address: contract.address, transactionHash: '0x' + '1'.repeat(64), blockNumber: toHex(height),
    logIndex: toHex(index), removed: false,
    topics: encodeEventTopics({ abi, eventName: 'WeatherScheduled', args: { epoch: BigInt(epoch) } }),
    data: encodeAbiParameters([{ type: 'uint8' }], [weather]) };
}
function fixture({ timestamp = GENESIS - 2 * DAY, logs = [log(0, 1)], actual = new Map([[0, 1]]),
  code = reviewedWeather.runtimeBytecode.onchainBytecode, genesis = GENESIS, failure = null } = {}) {
  const calls = [], block = { number: toHex(launch.block_number), timestamp: toHex(timestamp) };
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (failure === method) throw Error('Fixture RPC unavailable');
    if (method === 'eth_getCode') return code;
    if (method === 'eth_getLogs') return logs;
    assert.equal(method, 'eth_call');
    const call = decodeFunctionData({ abi, data: params[0].data });
    if (failure === call.functionName) throw Error('Fixture getter unavailable');
    let result;
    if (call.functionName === 'epochStart') result = BigInt(genesis) + call.args[0] * BigInt(WEEK);
    else if (call.functionName === 'commitHash') result = launch.commit_hash;
    else if (call.functionName === 'weatherOf') {
      const epoch = Number(call.args[0]); result = 0;
      for (let back = 0; back <= 52 && back <= epoch; back++) {
        if (actual.has(epoch - back)) { result = actual.get(epoch - back); break; }
      }
    } else throw Error('Unexpected fixture getter');
    return encodeFunctionResult({ abi, functionName: call.functionName, result });
  };
  return { calls, block, read: () => readWeatherSchedule(rpc, block) };
}

test('a reviewed runtime and pinned event establish only the explicitly announced future week', async () => {
  const f = fixture(), result = await f.read();
  assert.equal(result.status, 'ok');
  assert.equal(result.block_number, launch.block_number);
  assert.equal(result.commit_hash, launch.commit_hash);
  assert.deepEqual(result.weeks.map(w => [w.epoch, w.multiplier_bps, w.announced]), [[0, 12000, true]]);
  assert.equal(validateWeatherSchedule(result), result);
  const request = f.calls.find(c => c.method === 'eth_getLogs').params[0];
  assert.deepEqual(request, { address: contract.address, fromBlock: toHex(contract.deployment_block), toBlock: f.block.number, topics: [event] });
  assert.ok(f.calls.filter(c => ['eth_call', 'eth_getCode'].includes(c.method)).every(c => c.params[1] === f.block.number));
});

test('the latest replacement wins by block and log order, independent of response order', async () => {
  const f = fixture({ logs: [log(0, 2, { index: 7 }), log(1, 3), log(0, 1), log(0, 0, { height: contract.deployment_block, index: 99 })], actual: new Map([[0, 2], [1, 3]]) });
  assert.deepEqual((await f.read()).weeks.map(w => [w.epoch, w.multiplier_bps]), [[0, 15000], [1, 8000]]);
});

test('unset weather becomes settled history only strictly after its write cutoff', async () => {
  const exact = await fixture({ timestamp: GENESIS + WEEK - DAY }).read();
  const after = await fixture({ timestamp: GENESIS + WEEK - DAY + 1 }).read();
  assert.deepEqual(exact.weeks.map(w => w.epoch), [0]);
  assert.deepEqual(after.weeks.map(w => [w.epoch, w.multiplier_bps, w.announced]), [[0, 12000, true], [1, 12000, false]]);
  const beforeFirst = await fixture({ timestamp: GENESIS - DAY, logs: [], actual: new Map() }).read();
  assert.deepEqual(beforeFirst.weeks, []);
});

test('settled inheritance stops 52 epochs after the last explicit schedule', async () => {
  const result = await fixture({ timestamp: GENESIS + 53 * WEEK }).read();
  assert.equal(result.status, 'ok');
  assert.equal(result.weeks.find(w => w.epoch === 52).multiplier_bps, 12000);
  assert.equal(result.weeks.find(w => w.epoch === 53).multiplier_bps, 10000);
  assert.equal(result.weeks.find(w => w.epoch === 53).announced, false);
});

test('announced and inherited getter disagreements reject the entire schedule', async () => {
  for (const options of [{ actual: new Map([[0, 2]]) }, { logs: [] }, { timestamp: GENESIS + WEEK, logs: [] }]) {
    const result = await fixture(options).read();
    assert.equal(result.status, 'unavailable');
    assert.match(result.error, /disagree|incomplete/);
    assert.deepEqual(result.weeks, []);
  }
});

test('partial RPC failure never becomes a successful empty schedule', async () => {
  for (const failure of ['eth_getLogs', 'epochStart', 'commitHash', 'weatherOf']) {
    const result = await fixture({ failure }).read();
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.weeks, []);
  }
});

test('changed runtime and conflicting Genesis cannot supply forecast weather', async () => {
  const changed = fixture({ code: '0x6000' });
  assert.match((await changed.read()).error, /reviewed source/);
  assert.equal(changed.calls.length, 1);
  assert.match((await fixture({ genesis: GENESIS + DAY }).read()).error, /Genesis differs/);
});

test('removed, foreign and out-of-range logs cannot enter the pinned schedule', async () => {
  for (const invalid of [{ ...log(0, 1), removed: true }, { ...log(0, 1), address: '0x' + '2'.repeat(40) },
    log(0, 1, { height: launch.block_number + 1 }), { ...log(0, 1), topics: ['0x' + '0'.repeat(64)] }]) {
    assert.equal((await fixture({ logs: [invalid] }).read()).status, 'unavailable');
  }
});
