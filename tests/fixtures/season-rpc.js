import { decodeFunctionData, encodeFunctionResult, parseAbi } from 'viem';
import integrations from '../../knowledge/integrations.json' with { type: 'json' };

export function seasonRPC({ fail = [], chain = '0x1237', epoch = 0n, count = 1n } = {}) {
  const calls = [];
  const respond = request => {
    calls.push(request);
    if (request.method === 'eth_chainId') return { result: chain };
    if (request.method === 'eth_getBlockByNumber') return { result: { number: '0x2a', timestamp: '0x6a9f0000' } };
    if (request.method !== 'eth_call') throw new Error('Unexpected method');
    const contract = Object.values(integrations.contracts).find(c => c.address.toLowerCase() === request.params[0].to.toLowerCase());
    const abi = parseAbi(contract.read_signatures), { functionName: fn, args } = decodeFunctionData({ abi, data: request.params[0].data });
    if (fail.includes(fn)) return { error: { message: 'Fixture failure' } };
    if (fn === 'weatherOf' && args[0] !== epoch) throw new Error('Future weather must not be read');
    const values = { currentEpoch: epoch, epochStart: 1789948800n, nextBoundary: 1789948800n, multiplierNow: 12000n,
      floodActive: false, moonActive: false, moonCount: count, moons: 1790553600n, weatherOf: 1, totalSupply: 0n, totalWeight: 0n,
      carryNow:0n,granaryNow:40000000n*10n**18n,emitted:0n,paidOut:0n,bagPrice:10n**15n,bagOpen:true,
      commitHash: '0x' + '4'.repeat(64) };
    return { result: encodeFunctionResult({ abi, functionName: fn, result: values[fn] }) };
  };
  const envelope = (request, response) => ({ jsonrpc: '2.0', id: request.id, ...response });
  const transport = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (Array.isArray(body)) return Promise.all(body.map(request => envelope(request, respond(request))));
    return envelope(body, respond(body));
  };
  return { calls, respond, transport };
}
