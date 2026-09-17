import test from 'node:test';
import assert from 'node:assert/strict';
import deployment from '../knowledge/reviewed-deployment.json' with { type: 'json' };
import { isGameURL, validateExtensionSender, validateProviderRequest } from '../src/extension-policy.js';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const chainId = `0x${deployment.chain_id.toString(16)}`;
const wallet = '0x1111111111111111111111111111111111111111';
const sender = () => ({ id: extensionId, url: `chrome-extension://${extensionId}/companion.html`, frameId: 2, tab: { id: 7, url: 'https://rh.farm/almanac/' } });
const transaction = () => ({ from: wallet, to: deployment.contracts.activation.address, data: '0xaabbccdd', value: '0x0', chainId, nonce: '0x2', gas: '0x30d40', gasPrice: '0x1' });
const send = tx => ({ method: 'eth_sendTransaction', params: [tx] });

test('extension scope accepts the exact HTTPS game origin across paths', () => {
  for (const url of ['https://rh.farm/', 'https://rh.farm/almanac/?tab=rules#levels', 'https://rh.farm:443/']) assert.equal(isGameURL(url), true, url);
  for (const url of [undefined, null, '', '/almanac/', 'http://rh.farm/', 'https://rh.farm:444/', 'https://api.rh.farm/', 'https://rh.farm.attacker.test/', 'https://rh.farm@attacker.test/', 'javascript:alert(1)', 'chrome-extension://other/companion.html']) assert.equal(isGameURL(url), false, String(url));
});

test('only an embedded companion document in a game tab can request the wallet', () => {
  assert.doesNotThrow(() => validateExtensionSender(sender(), extensionId));
  const invalid = [
    null,
    {},
    { ...sender(), id: 'another-extension' },
    { ...sender(), url: 'https://rh.farm/' },
    { ...sender(), url: `chrome-extension://${extensionId}/background.js` },
    { ...sender(), url: `${sender().url}?request=sign` },
    { ...sender(), url: `${sender().url}#request` },
    { ...sender(), frameId: 0 },
    { ...sender(), frameId: -1 },
    { ...sender(), frameId: 1.5 },
    { ...sender(), frameId: '2' },
    { ...sender(), tab: undefined },
    { ...sender(), tab: { id: '7', url: 'https://rh.farm/' } },
    { ...sender(), tab: { id: 7, url: 'https://example.com/' } },
    { ...sender(), tab: { id: 7, url: 'http://rh.farm/' } },
  ];
  for (const value of invalid) assert.throws(() => validateExtensionSender(value, extensionId), /Farm Companion panel/, JSON.stringify(value));
});

test('account and chain inspection requests normalize empty parameters', () => {
  for (const method of ['eth_requestAccounts', 'eth_accounts', 'eth_chainId']) {
    assert.deepEqual(validateProviderRequest({ method }), { method });
    assert.deepEqual(validateProviderRequest({ method, params: [] }), { method });
    for (const params of [null, {}, [wallet], '[]']) assert.throws(() => validateProviderRequest({ method, params }));
  }
});

test('wallet bridge refuses signing, raw broadcast and permission expansion methods', () => {
  for (const method of ['personal_sign', 'eth_sign', 'eth_signTypedData_v4', 'eth_sendRawTransaction', 'wallet_requestPermissions', 'wallet_addEthereumChain', 'wallet_sendCalls', 'eth_call', 'eth_getBalance', '']) {
    assert.throws(() => validateProviderRequest({ method, params: [] }), /not supported/, method);
  }
  for (const request of [null, undefined, 'eth_accounts', [], { method: 'eth_accounts', origin: 'https://rh.farm' }, { method: 'eth_accounts', id: 1 }]) assert.throws(() => validateProviderRequest(request));
});

test('wallet chain switching can only select the configured Robinhood chain', () => {
  const request = { method: 'wallet_switchEthereumChain', params: [{ chainId }] };
  assert.deepEqual(validateProviderRequest(request), request);
  for (const params of [undefined, [], [{ chainId: '0x1' }], [{ chainId: deployment.chain_id }], [{ chainId, rpcUrls: ['https://example.com'] }], [{ chainId }, { chainId }], { chainId }]) {
    assert.throws(() => validateProviderRequest({ method: 'wallet_switchEthereumChain', params }));
  }
});

test('reviewed game destinations retain the executor transaction payload exactly', () => {
  for (const name of ['crop', 'activation', 'levels', 'emissions']) {
    const request = send({ ...transaction(), to: deployment.contracts[name].address });
    const before = structuredClone(request);
    assert.deepEqual(validateProviderRequest(request), before, name);
    assert.deepEqual(request, before, 'Validation must not rewrite the reviewed transaction.');
  }
});

test('wallet bridge refuses transactions to unreviewed contracts and other chains', () => {
  for (const to of [wallet, deployment.contracts.nft.address, deployment.contracts.weather.address, undefined, null, '', '0x1234', 1]) {
    assert.throws(() => validateProviderRequest(send({ ...transaction(), to })), String(to));
  }
  for (const otherChain of ['0x1', '0x1238', deployment.chain_id, undefined, null]) assert.throws(() => validateProviderRequest(send({ ...transaction(), chainId: otherChain })));
});

test('transaction messages cannot add a second action or omit executor fields', () => {
  for (const params of [[], [transaction(), transaction()], transaction(), null]) assert.throws(() => validateProviderRequest({ method: 'eth_sendTransaction', params }));
  for (const field of ['from', 'to', 'data', 'value', 'chainId', 'nonce', 'gas', 'gasPrice']) {
    const tx = transaction();
    delete tx[field];
    assert.throws(() => validateProviderRequest(send(tx)), `Missing ${field}`);
  }
  for (const field of ['maxFeePerGas', 'maxPriorityFeePerGas', 'accessList', 'authorizationList', 'type', 'unknown']) assert.throws(() => validateProviderRequest(send({ ...transaction(), [field]: '0x1' })), field);
});

test('transaction values, nonce and gas are unsigned hexadecimal quantities', () => {
  for (const field of ['value', 'nonce', 'gas', 'gasPrice']) {
    for (const value of ['-1', '-0x1', '0x', '1', '0xGG', '0x1.5', 1, null]) assert.throws(() => validateProviderRequest(send({ ...transaction(), [field]: value })), `${field}: ${value}`);
  }
  for (const from of ['', null, '0x1234', `${wallet}1`, '0xZZ11111111111111111111111111111111111111']) assert.throws(() => validateProviderRequest(send({ ...transaction(), from })));
});

test('transaction calldata needs a complete selector and whole bytes', () => {
  for (const data of [undefined, null, '', '0x', '0xaabbcc', '0xaabbccd', '0xaabbccdde', '0xaabbccdg', 'aabbccdd']) assert.throws(() => validateProviderRequest(send({ ...transaction(), data })), String(data));
  assert.doesNotThrow(() => validateProviderRequest(send({ ...transaction(), data: '0xaabbccdd00' })));
});
