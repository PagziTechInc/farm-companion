import { mount } from './public-ui.js';
import { mountApproval } from './approval-panel.js';

const storage = key => ({ get: () => localStorage.getItem(key), set: value => localStorage.setItem(key, value) });
const provider = {
  async request(request) {
    const reply = await chrome.runtime.sendMessage({ type: 'farm-companion-wallet', request });
    if (!reply?.ok) {
      const error = new Error(reply?.error?.message ?? 'Wallet connection interrupted. Check MetaMask before trying again.');
      if (reply?.error?.code != null) error.code = reply.error.code;
      throw error;
    }
    return reply.result;
  },
};

let panelVisible=false;
const app=mount(document.getElementById('app'), {
  isVisible:()=>panelVisible,
  compact: true,
  storage: storage('yield-farm-extension-v2'),
  walletProvider: () => provider,
  approvalWidget: (host, options) => mountApproval(host, { ...options, storage: storage('yield-farm-extension-approvals-v2') }),
});
// Intersection crosses the iframe boundary, including the launcher's hidden state.
new IntersectionObserver(entries=>{const visible=entries[0].isIntersecting;if(visible!==panelVisible){panelVisible=visible;app.visibilityChanged();}}).observe(document.body);
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !event.defaultPrevented) parent.postMessage({ type: 'farm-companion-close' }, 'https://rh.farm');
});
