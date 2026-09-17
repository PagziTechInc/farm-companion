import corn from '../assets/site/corn.png';

// The page only hosts a launcher; calculations, journal and wallet review live
// behind the extension-origin iframe's same-origin boundary.
if (location.origin === 'https://rh.farm' && window.top === window.self && !document.getElementById('yield-farm-companion-host')) {
  const host = document.createElement('div');
  host.id = 'yield-farm-companion-host';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{all:initial}button{position:fixed;right:16px;bottom:14px;display:flex;align-items:center;gap:10px;z-index:2147483647;background:#ffd534;color:#0f1a0f;border:2px solid #f3df7a;padding:9px 13px;font:700 11px system-ui;cursor:pointer;box-shadow:inset 0 -3px #d1a82c,0 4px #66501a,0 5px 20px #0008}button:focus-visible{outline:3px solid #fff;outline-offset:4px}button img{width:29px;height:29px;image-rendering:pixelated}button span{text-align:left;line-height:1.4}small{display:block;font-size:9px;letter-spacing:1.5px;opacity:.7}iframe{position:fixed;inset:18px 14px 84px;width:calc(100% - 28px);height:calc(100% - 102px);max-width:1320px;box-sizing:border-box;margin:0 auto;z-index:2147483646;border:2px solid #8c793c;background:#0f1a0f;box-shadow:0 0 0 5px #14200e,0 20px 90px #000b}iframe[hidden]{display:none}
  </style><button type="button" aria-label="Open Farm Companion" aria-expanded="false" aria-controls="farm-journal"><img src="${corn}" alt=""><span>FARM COMPANION<small>OPEN FIELD JOURNAL</small></span></button>`;
  document.body.append(host);
  const button = root.querySelector('button');
  let frame, open = false;
  function toggle() {
    open = !open;
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'farm-journal';
      frame.title = 'Farm Companion';
      frame.src = chrome.runtime.getURL('companion.html');
      root.prepend(frame);
    }
    frame.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close Farm Companion' : 'Open Farm Companion');
    button.querySelector('span').innerHTML = open ? 'BACK TO THE FARM<small>CLOSE JOURNAL ×</small>' : 'FARM COMPANION<small>OPEN FIELD JOURNAL</small>';
    (open ? frame : button).focus({ preventScroll: true });
  }
  button.addEventListener('click', toggle);
  const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;
  window.addEventListener('message', event => {
    if (open && event.source === frame?.contentWindow && event.origin === extensionOrigin && event.data?.type === 'farm-companion-close') toggle();
  });
  window.addEventListener('keydown', event => { if (open && event.key === 'Escape' && !event.defaultPrevented) toggle(); });
  chrome.runtime.onMessage.addListener(message => { if (message?.type === 'farm-companion-toggle') toggle(); });
}
