import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionResult, parseAbi } from 'viem';
import integrations from '../knowledge/integrations.json' with { type: 'json' };
import { readCropReference } from '../src/forecast-market.js';

const contracts = integrations.contracts;
const poolAddress = contracts.pool.address;
const cropAddress = contracts.crop.address;
const wethAddress = contracts.wrapped_eth.address;
const poolAbi = parseAbi(contracts.pool.read_signatures);
const cropAbi = parseAbi(contracts.crop.read_signatures);
const wethAbi = parseAbi(contracts.wrapped_eth.read_signatures);
const Q96 = 1n << 96n;

function fixture(overrides = {}) {
  const state = {
    token0: wethAddress,
    token1: cropAddress,
    fee: 10000n,
    liquidity: 100n,
    sqrtPriceX96: 2n * Q96,
    unlocked: true,
    cropDecimals: 18n,
    wethDecimals: 18n,
    poolCode: '0x60006000',
    fail: null,
    ...overrides,
  };
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === 'eth_getCode') {
      if (params[0].toLowerCase() !== poolAddress.toLowerCase()) throw new Error('unexpected code target');
      return state.poolCode;
    }
    if (method !== 'eth_call') throw new Error(`unexpected RPC method: ${method}`);
    const [transaction] = params;
    const address = transaction.to.toLowerCase();
    const abi = address === poolAddress.toLowerCase()
      ? poolAbi
      : address === cropAddress.toLowerCase()
        ? cropAbi
        : address === wethAddress.toLowerCase()
          ? wethAbi
          : null;
    if (!abi) throw new Error('unexpected call target');
    const { functionName } = decodeFunctionData({ abi, data: transaction.data });
    if (state.fail === functionName) throw new Error('simulated public RPC read failure');
    let result;
    if (address === poolAddress.toLowerCase()) {
      if (functionName === 'token0') result = state.token0;
      else if (functionName === 'token1') result = state.token1;
      else if (functionName === 'fee') result = state.fee;
      else if (functionName === 'liquidity') result = state.liquidity;
      else if (functionName === 'slot0') result = [state.sqrtPriceX96, 0n, 0n, 1n, 1n, 0n, state.unlocked];
      else throw new Error(`unexpected pool view: ${functionName}`);
    } else if (functionName === 'decimals') {
      result = address === cropAddress.toLowerCase() ? state.cropDecimals : state.wethDecimals;
    } else {
      throw new Error(`unexpected token view: ${functionName}`);
    }
    return encodeFunctionResult({ abi, functionName, result });
  };
  return { rpc, calls, state };
}

function ceilDiv(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

test('reads the WETH/CROP orientation and applies the 1% pool fee with integer rounding', async () => {
  const { rpc } = fixture();
  const result = await readCropReference(rpc, 42);
  const spot = 250000000000000000n;

  assert.equal(result.status, 'ok');
  assert.equal(result.spot_price_wei, spot.toString());
  assert.equal(result.buy_price_wei, ceilDiv(spot * 1000000n, 990000n).toString());
  assert.equal(result.sell_price_wei, (spot * 990000n / 1000000n).toString());
  assert.equal(result.pool_address, poolAddress);
  assert.equal(result.fee_pips, 10000);
  assert.equal(result.block_number, 42);
});

test('handles the reversed CROP/WETH token ordering', async () => {
  const { rpc } = fixture({ token0: cropAddress, token1: wethAddress, fee: 0n });
  const result = await readCropReference(rpc, 43);

  assert.equal(result.status, 'ok');
  assert.equal(result.spot_price_wei, '4000000000000000000');
  assert.equal(result.buy_price_wei, result.spot_price_wei);
  assert.equal(result.sell_price_wei, result.spot_price_wei);
  assert.equal(result.fee_pips, 0);
});

test('does not use an initialized slot0 price when active liquidity is zero', async () => {
  const { rpc } = fixture({ liquidity: 0n });
  const result = await readCropReference(rpc, 44);

  assert.deepEqual(result, {
    status: 'unavailable',
    reason: 'pool_has_no_liquidity',
    pool_address: poolAddress,
    block_number: 44,
  });
});

test('rejects a missing pool deployment and a zero stored price', async () => {
  const missingCode = await readCropReference(fixture({ poolCode: '0x' }).rpc, 441);
  const zeroPrice = await readCropReference(fixture({ sqrtPriceX96: 0n }).rpc, 442);

  assert.equal(missingCode.reason, 'pool_code_missing');
  assert.equal(zeroPrice.reason, 'pool_price_unavailable');
});

test('rejects a pool whose token pair is not exactly CROP and WETH', async () => {
  const { rpc } = fixture({ token0: '0x0000000000000000000000000000000000000001' });
  const result = await readCropReference(rpc, 45);

  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'wrong_pair');
});

test('returns unavailable when any public RPC read fails', async () => {
  const { rpc } = fixture({ fail: 'slot0' });
  const result = await readCropReference(rpc, 46);

  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'rpc_read_failed');
  assert.equal(result.block_number, 46);
});

test('pins every pool and token read to the supplied block number', async () => {
  const { rpc, calls } = fixture();
  await readCropReference(rpc, 42);

  assert.ok(calls.length > 0);
  assert.ok(calls.every(call => {
    if (call.method === 'eth_getCode') return call.params[1] === '0x2a';
    if (call.method === 'eth_call') return call.params[1] === '0x2a';
    return false;
  }));
});

test('rejects locked pools, malformed fees, and non-18-decimal pairs', async () => {
  const locked = await readCropReference(fixture({ unlocked: false }).rpc, 47);
  const invalidFee = await readCropReference(fixture({ fee: 1000000n }).rpc, 48);
  const badDecimals = await readCropReference(fixture({ cropDecimals: 6n }).rpc, 49);

  assert.equal(locked.reason, 'pool_locked');
  assert.equal(invalidFee.reason, 'invalid_pool_fee');
  assert.equal(badDecimals.reason, 'unsupported_token_decimals');
});
