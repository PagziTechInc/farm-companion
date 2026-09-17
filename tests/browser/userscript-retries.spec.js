import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {openAddPlots} from './navigation.js';

test('Tampermonkey HTTP throttles reach the shared retry queue without accessing MetaMask',async({page})=>{
  await page.route('https://rh.farm/**',route=>route.fulfill({contentType:'text/html',body:'<html><body>Game fixture</body></html>'}));
  await page.goto('https://rh.farm/');
  await page.evaluate(()=>{
    window.__reads=[];window.__providerReads=0;const saved={};
    window.GM_getValue=(key,fallback)=>saved[key]??fallback;
    window.GM_setValue=(key,value)=>{saved[key]=value;};
    window.unsafeWindow={};Object.defineProperty(window.unsafeWindow,'ethereum',{get(){window.__providerReads++;throw Error('No wallet access for public reads');}});
    window.GM_xmlhttpRequest=options=>{
      const request=JSON.parse(options.data);window.__reads.push(request);
      if(request.method==='eth_chainId'){
        if(window.__reads.filter(r=>r.method==='eth_chainId').length===1){options.onload({status:429,responseHeaders:'Retry-After: 0\r\n',responseText:'Throttled'});return;}
        options.onload({status:200,responseText:JSON.stringify({jsonrpc:'2.0',id:request.id,result:'0x1237'})});return;
      }
      // Stop at a deterministic block error after proving that the HTTP throttle recovered.
      options.onload({status:200,responseText:JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32602,message:'Fixture block unavailable'}})});
    };
  });
  await page.addScriptTag({content:await readFile('dist/yield-farm-companion.user.js','utf8')});
  await page.getByRole('button',{name:'Open Farm Companion',exact:true}).click();
  await openAddPlots(page);
  await page.getByLabel('Wallet address',{exact:true}).fill('0x0000000000000000000000000000000000000001');
  await page.getByRole('button',{name:/^Add(?: & refresh)? wallet/}).click();
  await expect(page.getByRole('alert')).toContainText('Fixture block unavailable');
  const observed=await page.evaluate(()=>({reads:window.__reads,provider:window.__providerReads}));
  expect(observed.reads.map(r=>r.method)).toEqual(['eth_chainId','eth_chainId','eth_getBlockByNumber']);
  expect(observed.reads[0]).toEqual(observed.reads[1]);
  expect(observed.provider).toBe(0);
});
