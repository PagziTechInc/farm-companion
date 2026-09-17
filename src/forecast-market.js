import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';
import integrations from '../knowledge/integrations.json' with { type: 'json' };

const contracts = integrations.contracts;
const poolAddress = contracts.pool.address;
const cropAddress = contracts.crop.address;
const wrappedEthAddress = contracts.wrapped_eth.address;
const poolAbi = parseAbi(contracts.pool.read_signatures);
const cropAbi = parseAbi(contracts.crop.read_signatures);
const wrappedEthAbi = parseAbi(contracts.wrapped_eth.read_signatures);
const Q192 = 1n << 192n;
const FEE_DENOMINATOR = 1_000_000n;
const TOKEN_SCALE = 10n ** 18n;

function blockIdentity(value) {
  try {
    if (!['number', 'string', 'bigint'].includes(typeof value)) return null;
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return null;
    if (typeof value === 'string' && !/^(?:0x[\da-f]+|\d+)$/i.test(value)) return null;
    const number = BigInt(value);
    if (number < 0n || number > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return { number: Number(number), tag: `0x${number.toString(16)}` };
  } catch {
    return null;
  }
}

function unavailable(reason, blockNumber) {
  return { status: 'unavailable', reason, pool_address: poolAddress, block_number: blockNumber };
}

async function readView(rpc, address, abi, functionName, blockTag) {
  const data = encodeFunctionData({ abi, functionName });
  const raw = await rpc('eth_call', [{ to: address, data }, blockTag]);
  return decodeFunctionResult({ abi, functionName, data: raw });
}

function validCode(code) {
  return typeof code === 'string' && /^0x(?:[\da-f]{2})+$/i.test(code);
}

function ceilDiv(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Read a V3 pool's fee-adjusted spot reference for one whole CROP.
 * The returned buy/sell figures account for only the pool fee; they do not
 * include price impact, slippage, routing, gas, or an executable-size quote.
 *
 * The pool address is published by the current official client configuration.
 * The wrapped ETH address is the corresponding WETH address recorded in
 * integrations.json from a pinned token0/token1 and ERC-20 metadata check.
 */
export async function readCropReference(rpc, blockNumber) {
  const block = blockIdentity(blockNumber);
  if (!block) return unavailable('invalid_block_number', null);
  if (typeof rpc !== 'function') return unavailable('invalid_rpc', block.number);

  const { number, tag } = block;
  try {
    const code = await rpc('eth_getCode', [poolAddress, tag]);
    if (!validCode(code)) return unavailable('pool_code_missing', number);

    const [token0Raw, token1Raw, feeRaw, liquidityRaw, slot0] = await Promise.all([
      readView(rpc, poolAddress, poolAbi, 'token0', tag),
      readView(rpc, poolAddress, poolAbi, 'token1', tag),
      readView(rpc, poolAddress, poolAbi, 'fee', tag),
      readView(rpc, poolAddress, poolAbi, 'liquidity', tag),
      readView(rpc, poolAddress, poolAbi, 'slot0', tag),
    ]);
    const token0 = String(token0Raw).toLowerCase();
    const token1 = String(token1Raw).toLowerCase();
    const crop = cropAddress.toLowerCase();
    const weth = wrappedEthAddress.toLowerCase();
    const cropIsToken0 = token0 === crop && token1 === weth;
    const cropIsToken1 = token1 === crop && token0 === weth;
    if (!cropIsToken0 && !cropIsToken1) return unavailable('wrong_pair', number);

    const [cropDecimals, wethDecimals] = await Promise.all([
      readView(rpc, cropAddress, cropAbi, 'decimals', tag),
      readView(rpc, wrappedEthAddress, wrappedEthAbi, 'decimals', tag),
    ]);
    if (Number(cropDecimals) !== 18 || Number(wethDecimals) !== 18) {
      return unavailable('unsupported_token_decimals', number);
    }

    const feePips = BigInt(feeRaw);
    if (feePips < 0n || feePips >= FEE_DENOMINATOR) return unavailable('invalid_pool_fee', number);
    if (slot0[6] !== true) return unavailable('pool_locked', number);
    if (BigInt(liquidityRaw) <= 0n) return unavailable('pool_has_no_liquidity', number);

    const sqrtPriceX96 = BigInt(slot0[0]);
    if (sqrtPriceX96 <= 0n) return unavailable('pool_price_unavailable', number);
    const sqrtSquared = sqrtPriceX96 * sqrtPriceX96;
    const spotPrice = cropIsToken0
      ? (sqrtSquared * TOKEN_SCALE) / Q192
      : (Q192 * TOKEN_SCALE) / sqrtSquared;
    if (spotPrice <= 0n) return unavailable('pool_price_rounds_to_zero', number);

    const afterFee = FEE_DENOMINATOR - feePips;
    const buyPrice = ceilDiv(spotPrice * FEE_DENOMINATOR, afterFee);
    const sellPrice = (spotPrice * afterFee) / FEE_DENOMINATOR;
    if (buyPrice <= 0n || sellPrice <= 0n) return unavailable('fee_adjusted_price_rounds_to_zero', number);

    return {
      status: 'ok',
      spot_price_wei: spotPrice.toString(),
      buy_price_wei: buyPrice.toString(),
      sell_price_wei: sellPrice.toString(),
      pool_address: poolAddress,
      fee_pips: Number(feePips),
      block_number: number,
    };
  } catch {
    return unavailable('rpc_read_failed', number);
  }
}
