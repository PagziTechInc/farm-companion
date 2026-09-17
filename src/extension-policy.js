import deployment from '../knowledge/reviewed-deployment.json' with { type: 'json' };

const CHAIN_HEX = `0x${deployment.chain_id.toString(16)}`;
const targets = new Set(['crop', 'activation', 'levels', 'emissions'].map(key => deployment.contracts[key].address));
const hex = value => typeof value === 'string' && /^0x[\da-f]+$/i.test(value);
export function isGameURL(value) {
  try { return new URL(value).origin === 'https://rh.farm'; } catch { return false; }
}
export function validateExtensionSender(sender, extensionId) {
  if (sender?.id !== extensionId || sender.url !== `chrome-extension://${extensionId}/companion.html` || !Number.isInteger(sender.tab?.id) || sender.frameId < 1 || !Number.isInteger(sender.frameId) || !isGameURL(sender.tab.url)) throw new Error('Wallet requests must come from the Farm Companion panel on rh.farm.');
}
export function validateProviderRequest(request) {
  if (!request || typeof request !== 'object' || Object.keys(request).some(key => !['method', 'params'].includes(key))) throw new Error('Invalid wallet request.');
  const { method, params } = request;
  if (['eth_requestAccounts', 'eth_accounts', 'eth_chainId'].includes(method)) {
    if (params !== undefined && (!Array.isArray(params) || params.length)) throw new Error('Unexpected wallet parameters.');
    return { method };
  }
  if (method === 'wallet_switchEthereumChain' && Array.isArray(params) && params.length === 1 && params[0]?.chainId === CHAIN_HEX && Object.keys(params[0]).length === 1) return { method, params };
  if (method === 'eth_sendTransaction' && Array.isArray(params) && params.length === 1) {
    const tx = params[0], fields = ['from', 'to', 'data', 'value', 'chainId', 'nonce', 'gas', 'gasPrice'];
    if (!tx || typeof tx !== 'object' || Object.keys(tx).some(key => !fields.includes(key)) || !fields.every(key => key in tx) || !/^0x[\da-f]{40}$/i.test(tx.from) || !targets.has(tx.to?.toLowerCase()) || tx.chainId !== CHAIN_HEX || !/^0x(?:[\da-f]{2}){4,}$/i.test(tx.data) || !['value', 'nonce', 'gas', 'gasPrice'].every(key => hex(tx[key]))) throw new Error('Only reviewed Farm Companion transactions are supported.');
    return { method, params };
  }
  throw new Error('This wallet method is not supported by Farm Companion.');
}
