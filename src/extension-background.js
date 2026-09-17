import { isGameURL, validateExtensionSender, validateProviderRequest } from './extension-policy.js';

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'farm-companion-wallet') return;
  (async () => {
    validateExtensionSender(sender, chrome.runtime.id);
    const request = validateProviderRequest(message.request);
    const tab = await chrome.tabs.get(sender.tab.id);
    if (!isGameURL(tab.url)) throw new Error('Return to rh.farm before using wallet actions.');
    const replies = await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, frameIds: [0] }, world: 'MAIN', args: [request],
      func: async request => {
        try {
          if (location.origin !== 'https://rh.farm') throw new Error('Wallet actions require rh.farm.');
          const provider = window.ethereum;
          if (!provider?.request) throw new Error('Open rh.farm in a browser with MetaMask installed.');
          return { ok: true, result: await provider.request(request) };
        } catch (error) {
          return { ok: false, error: { message: String(error?.message ?? 'Wallet request failed.'), ...(typeof error?.code === 'number' ? { code: error.code } : {}) } };
        }
      },
    });
    return replies[0]?.result ?? { ok: false, error: { message: 'Wallet response interrupted. Check MetaMask activity.' } };
  })().then(respond, error => respond({ ok: false, error: { message: error.message } }));
  return true;
});

chrome.action.onClicked.addListener(async tab => {
  if (isGameURL(tab.url)) {
    try { await chrome.tabs.sendMessage(tab.id, { type: 'farm-companion-toggle' }, { frameId: 0 }); }
    catch { await chrome.tabs.reload(tab.id); }
  } else await chrome.tabs.create({ url: 'https://rh.farm/' });
});
