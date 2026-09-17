import { mount } from './public-ui.js';
import { mountApproval } from './approval-panel.js';
import corn from '../assets/site/corn.png';
if (location.origin === 'https://rh.farm' && window.top === window.self && !document.getElementById('yield-farm-companion-host')) {
  const host = document.createElement('div'); host.id = 'yield-farm-companion-host';
  Object.assign(host.style, { position: 'fixed', inset: '18px 14px 84px', height:'calc(100dvh - 102px)', maxWidth:'1320px', minHeight:'0', boxSizing:'border-box', margin:'0 auto', zIndex: '2147483646', display: 'none', overflow: 'hidden', overscrollBehavior:'contain', border:'2px solid #8c793c', borderRadius: '0', boxShadow: '0 0 0 5px #14200e, 0 20px 90px #000b', background: '#0f1a0f' });
  host.setAttribute('role', 'region'); host.setAttribute('aria-label', 'Farm Companion'); host.tabIndex = -1;
  const toggle = document.createElement('button'); toggle.id = 'yield-farm-companion-toggle';
  const launcher = open => {
    toggle.setAttribute('aria-label',open?'Close Farm Companion':'Open Farm Companion');
    toggle.innerHTML=`<img src="${corn}" alt="" style="width:29px;height:29px;image-rendering:pixelated"><span style="text-align:left;line-height:1.4">${open?'BACK TO THE FARM':'FARM COMPANION'}<small style="display:block;font-size:9px;letter-spacing:1.5px;opacity:.7">${open?'CLOSE JOURNAL ×':'OPEN FIELD JOURNAL'}</small></span>`;
  };
  launcher(false); toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', host.id);
  Object.assign(toggle.style, { position: 'fixed', right: '16px', bottom: '14px', display:'flex', alignItems:'center', gap:'10px', zIndex: '2147483647', background: '#ffd534', color: '#0f1a0f', border: '2px solid #f3df7a', borderRadius: '0', padding: '9px 13px', font: '700 11px system-ui', cursor: 'pointer', boxShadow: 'inset 0 -3px #d1a82c, 0 4px 0 #66501a, 0 5px 20px #0008' });
  document.body.append(host, toggle);
  const transport = (url, options = {}) => new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['rpc.mainnet.chain.robinhood.com', 'robinhood-rpc.publicnode.com', 'api.rh.farm', 'api.coinbase.com', 'farm.pagzi.tech'].includes(parsed.hostname)) return reject(new Error('Unapproved read origin.'));
    if(parsed.hostname==='farm.pagzi.tech'&&(parsed.pathname!=='/collection/status.json'||parsed.search||parsed.hash||parsed.username||parsed.password||(options.method??'GET')!=='GET'))return reject(new Error('Unapproved collection read.'));
    GM_xmlhttpRequest({ method: options.method ?? 'GET', url, headers: options.headers, data: options.body, anonymous: true, timeout: 20000,
      onload: r => { try {
        if (r.status < 200 || r.status >= 300) {
          const error=new Error(`HTTP ${r.status}`);error.httpStatus=r.status;
          error.retryAfter=typeof r.responseHeaders==='string'?r.responseHeaders.match(/^retry-after:\s*([^\r\n]+)/im)?.[1]??null:null;
          throw error;
        }
        resolve(JSON.parse(r.responseText));
      } catch (e) { reject(e); } },
      onerror: () => reject(new Error('Public read failed.')), ontimeout: () => reject(new Error('Public read timed out.')) });
  });
  let app;
  toggle.onclick = () => {
    const open = host.style.display === 'none'; host.style.display = open ? 'block' : 'none'; launcher(open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open && !app) app = mount(host, { compact: true, transport,
      planWorkerFactory:()=>{const url=URL.createObjectURL(new Blob([__WORKER_SOURCE__],{type:'text/javascript'}));try{return {worker:new Worker(url),dispose:()=>URL.revokeObjectURL(url)};}catch(error){URL.revokeObjectURL(url);throw error;}}, walletProvider: () => typeof unsafeWindow !== 'undefined' ? unsafeWindow.ethereum : window.ethereum, storage: { get: () => GM_getValue('public-workspace-v2', null), set: value => GM_setValue('public-workspace-v2', value) }, isVisible: () => host.style.display !== 'none',
      approvalWidget: (container, options) => mountApproval(container, { ...options,
        storage: { get: () => GM_getValue('public-approvals-v2', null), set: value => GM_setValue('public-approvals-v2', value) },
      }),
    });
    if(open&&app)app.visibilityChanged();
    (open ? host : toggle).focus({ preventScroll: true });
  };
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented && host.style.display !== 'none') toggle.click(); });
}
