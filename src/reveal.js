import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi } from 'viem';
import integrations from '../knowledge/integrations.json' with { type: 'json' };
import reviewed from '../knowledge/reviewed-deployment.json' with { type: 'json' };
import commitment from '../knowledge/snapshots/manifest-comparison-2026-09-07.json' with { type: 'json' };

const nft = integrations.contracts.nft;
const abi = parseAbi(nft.read_signatures);
const hash = value => typeof value === 'string' && /^0x[\da-f]{64}$/i.test(value);

// Collection artwork readiness is independent of finalized economic rarity.
// Mint progress, a date or HTTP 200 must never substitute for a revealed offset.
export async function readRevealState(rpc, { now = Date.now() } = {}) {
  const result = { status: 'unavailable', chain_id: integrations.network.chain_id,
    nft_contract: nft.address, observed_at_utc: new Date(now).toISOString(),
    runtime_verified: false, manifest_verified: false };
  try {
    if (Number(BigInt(await rpc('eth_chainId', []))) !== result.chain_id) throw Error('Reveal RPC returned another chain.');
    const block = await rpc('eth_getBlockByNumber', ['latest', false]);
    const number = Number(BigInt(block.number)), timestamp = Number(BigInt(block.timestamp));
    if (!Number.isSafeInteger(number) || number <= 0 || !Number.isSafeInteger(timestamp) || timestamp <= 0 || !hash(block.hash)) throw Error('Reveal block identity is incomplete.');
    if (now - timestamp * 1000 > 300000 || now - timestamp * 1000 < -30000) throw Error('Reveal block is stale.');
    Object.assign(result, { block_number: number, block_timestamp: timestamp, block_hash: block.hash });
    const code = await rpc('eth_getCode', [nft.address, block.number]);
    if (keccak256(code) !== reviewed.contracts.nft.runtime_keccak256) throw Error('NFT deployment differs from the reviewed source.');
    result.runtime_verified = true;
    const call = async functionName => decodeFunctionResult({ abi, functionName,
      data: await rpc('eth_call', [{ to: nft.address, data: encodeFunctionData({ abi, functionName }) }, block.number]) });
    const [supply, index, manifest, finalized] = await Promise.all(['totalSupply', 'startingIndex', 'manifestHash', 'tiersFinalized'].map(call));
    if (supply < 0n || supply > 3333n || index < 0n || index >= 3333n) throw Error('Reveal counters are outside the reviewed collection.');
    Object.assign(result, { total_supply: Number(supply), starting_index: Number(index),
      manifest_hash: manifest, tiers_finalized: finalized });
    if (manifest.toLowerCase() !== commitment.on_chain_hash.toLowerCase()) throw Error('Collection manifest differs from the verified commitment.');
    result.manifest_verified = true;
    if (finalized && index === 0n) throw Error('Finalized tiers have no revealed offset.');
    result.status = index > 0n && supply > 0n ? 'revealed' : 'sealed';
    return result;
  } catch (error) { return { ...result, status: 'unavailable', error: error.message }; }
}
