import {test,expect,chromium} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {defaults,emptyPortfolio,weight} from '../../src/model.js';
import {openMainTab,openUtility,openWallets} from './navigation.js';

const key='yield-farm-public-v2';
function workspace(count=1) {
  const portfolio=emptyPortfolio();
  portfolio.wallets[0].plots=Array.from({length:count},(_,i)=>({token_id:i+1,rarity_tier:0,level:1,is_active:true,effective_weight_bps:weight(0,1),pending_crop_wei:'0',modifiers:[],reveal_status:'hypothetical'}));
  return {schema_version:2,portfolio,scenario:{...defaults(),externalWeight:'1000'},days:90};
}
function metadata(id) {
  const golden=id===331;
  return {name:`Plot #${String(id).padStart(4,'0')}`,description:'Rehearsal fixture',image:`https://api.rh.farm/rehearsal/image/${id}.png?r=1337`,animation_url:`https://api.rh.farm/rehearsal/animation/${id}.html`,attributes:['Soil','Crop','Scarecrow','Sky','Fence','Critter'].map((name,i)=>({trait_type:name,value:golden?'Golden':['Loam','Corn','Bear','Day','Gold','Chicken'][i]})).concat([{trait_type:'Level',value:5},{trait_type:'Planted',value:'No'},{trait_type:'Rarity Tier',value:'Golden Acre'}])};
}
function productionMetadata(id) {
  const golden=id===331;
  return {name:`Plot #${String(id).padStart(4,'0')}`,description:'Revealed production fixture',image:`https://api.rh.farm/image/${id}.png?s=1db`,attributes:['Soil','Crop','Scarecrow','Sky','Fence','Critter'].map((name,i)=>({trait_type:name,value:golden?'Golden':['Loam','Corn','Bear','Day','Gold','Chicken'][i]})).concat([{trait_type:'Status',value:'Revealed'}])};
}
function productionState(id) { return {tokenId:id,revealed:true,tierFinalized:true,level:1,tier:'Golden',weightBps:5000}; }
async function mockArt(context,{failure=false}={}) {
  const calls=[];
  await context.route('https://api.rh.farm/**',async route=>{
    const url=new URL(route.request().url());calls.push(url.pathname);
    if(url.pathname.includes('/animation/'))return route.fulfill({contentType:'text/html',body:'<html><body><p>Animated farm fixture</p><script>window.parentAccess=false;try{parent.document.body.dataset.remoteWrite="bad";window.parentAccess=true}catch{}</script></body></html>'});
    if(url.pathname.includes('/image/'))return route.fulfill({contentType:'image/png',body:await readFile('assets/site/corn.png')});
    if(failure)return route.fulfill({status:503,body:'Unavailable'});
    const id=Number(url.pathname.split('/').at(-1));
    if(url.pathname.startsWith('/plot/'))return route.fulfill({json:productionState(id)});
    if(url.pathname.startsWith('/metadata/'))return route.fulfill({json:productionMetadata(id)});
    return route.fulfill({json:metadata(id)});
  });
  return calls;
}
async function chooseRehearsal(dialog) { await dialog.getByLabel('Artwork source').selectOption('rehearsal'); }
async function open(page,state=workspace()) {
  await page.addInitScript(({key,state})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(state));},{key,state});
  await page.goto('/');
}
const saved=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
async function palette(page) {
  return page.evaluate(()=>{const host=document.querySelector('#app'),root=host.shadowRoot;return Object.fromEntries([['ground',host],['panel',root.querySelector('.plot-card')],['button',root.querySelector('.tabs button[aria-selected=true]')],['input',root.querySelector('[name=plotSearch]')]].map(([name,node])=>[name,getComputedStyle(node).backgroundColor]));});
}

test('every scene themes the whole interface and keeps calculations intact across tabs and reload',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await open(page);
  await page.getByRole('tab',{name:'Yield forecast',exact:true}).click();await page.getByRole('button',{name:'Calculate forecast',exact:true}).click();
  await expect(page.locator('.forecast-value')).toBeVisible();const harvest=await page.locator('.forecast-value').textContent(),before=await saved(page);
  await openMainTab(page,'My farm');const initial=await palette(page);
  for(const [name,id] of [['Original field','base'],['Deep Winter','winter'],['Festival Night','festival'],['Autumn Gold','autumn'],['Storm Watch','storm']]) {
    await openUtility(page,'themes');
    await page.getByRole('button',{name:`Scene: ${name}`,exact:true}).click();await expect(page.locator('#app')).toHaveAttribute('data-theme',id);
    await openMainTab(page,'My farm');
    const next=await palette(page);for(const part of Object.keys(initial))expect(next[part],`${id} ${part}`).not.toBe(initial[part]);
  }
  await openWallets(page);
  await page.getByRole('button',{name:'Edit model balances',exact:true}).click();
  const dialog=page.getByRole('dialog');expect(await dialog.evaluate(n=>getComputedStyle(n).backgroundColor)).not.toBe(initial.panel);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await openMainTab(page,'Yield forecast');await expect(page.locator('.forecast-value')).toHaveText(harvest);
  expect((await saved(page)).portfolio).toEqual(before.portfolio);expect((await saved(page)).scenario).toEqual(before.scenario);
  await page.reload();await expect(page.locator('#app')).toHaveAttribute('data-theme','storm');
  await openUtility(page,'themes');
  await page.getByRole('button',{name:'Scene: Field journal',exact:true}).click();
  await openMainTab(page,'My farm');expect(await palette(page)).toEqual(initial);
});

test('plot studio defaults to production, gates metadata behind reveal, and themes persistently without changing farm data',async({page})=>{
  const calls=await mockArt(page);await open(page);const before=await saved(page);expect(calls).toEqual([]);
  await openUtility(page,'themes');
  await page.getByRole('button',{name:'Explore plot themes',exact:true}).click();const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('heading',{name:'Plot #0331',exact:true})).toBeVisible();
  await expect(dialog.getByLabel('Artwork source')).toHaveValue('production');
  await expect(dialog.locator('#studio-image')).toHaveJSProperty('complete',true);
  expect(calls.filter(url=>url.startsWith('/plot/')||url.startsWith('/metadata/'))).toEqual(['/plot/331','/metadata/331']);
  expect(calls.some(url=>url.includes('/animation/'))).toBe(false);
  await dialog.getByRole('button',{name:'Use this plot’s theme',exact:true}).click();
  await expect(page.locator('#app')).toHaveAttribute('data-theme','golden');
  const after=await saved(page);expect(after.portfolio).toEqual(before.portfolio);expect(after.scenario).toEqual(before.scenario);expect(after.companion.theme_plot.token_id).toBe(331);expect(after.companion.theme_plot.environment).toBe('production');
  await dialog.getByRole('button',{name:'Close plot studio',exact:true}).click();await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-theme','golden');await openUtility(page,'themes');
  await expect(page.locator('.theme-preview img')).toHaveAttribute('src',/\/image\/331.png/);
  await openMainTab(page,'My farm');
  await expect(page.locator('.plot-card h3')).toHaveText('Common');
});

test('studio can switch sources without treating the same token as the same saved theme',async({page})=>{
  const calls=await mockArt(page);await open(page);await openUtility(page,'themes');
  await page.getByRole('button',{name:'Explore plot themes',exact:true}).click();const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('button',{name:'Use this plot’s theme',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Use this plot’s theme',exact:true}).click();
  expect((await saved(page)).companion.theme_plot.environment).toBe('production');
  await chooseRehearsal(dialog);
  await expect(dialog.locator('#studio-art-note')).toHaveText('REHEARSAL #331');
  await expect(dialog.getByRole('button',{name:'Use this plot’s theme',exact:true})).toHaveAttribute('aria-pressed','false');
  expect(calls).toContain('/rehearsal/331');
  await dialog.getByRole('button',{name:'Use this plot’s theme',exact:true}).click();
  expect((await saved(page)).companion.theme_plot.environment).toBe('rehearsal');
});

test('unrevealed production plots wait for reveal without requesting metadata or showing sample art',async({page})=>{
  await mockArt(page);const requests=[];page.on('request',request=>{const url=new URL(request.url());if(url.origin==='https://api.rh.farm')requests.push(url.pathname);});
  await page.route(/https:\/\/api\.rh\.farm\/plot\/331\?fresh=/,route=>route.fulfill({json:{tokenId:331,revealed:false,level:1,tier:null}}));
  await open(page);await openUtility(page,'themes');await page.getByRole('button',{name:'Explore plot themes',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('status')).toContainText('Waiting for reveal.');
  await expect(dialog.locator('#studio-image')).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'Use this plot’s theme',exact:true})).toHaveCount(0);
  expect(requests).toContain('/plot/331');expect(requests).not.toContain('/metadata/331');
  expect(requests).not.toContain('/image/331.png');
});

test('animation is isolated, starts only on play and stops on pause or closing the studio',async({page})=>{
  const calls=await mockArt(page);await open(page);await openUtility(page,'themes');await page.getByRole('button',{name:'Explore plot themes',exact:true}).click();
  await page.getByRole('button',{name:'Play animation',exact:true}).click();
  const iframe=page.locator('.studio-stage iframe');await expect(iframe).toHaveAttribute('sandbox','allow-scripts');
  await expect(page.frameLocator('.studio-stage iframe').getByText('Animated farm fixture')).toBeVisible();
  expect(await page.evaluate(()=>document.body.dataset.remoteWrite)).toBeUndefined();
  expect(calls.filter(url=>url.includes('/animation/'))).toHaveLength(1);
  await page.getByRole('button',{name:'Pause animation',exact:true}).click();await expect(iframe).toHaveCount(0);
  await page.getByRole('button',{name:'Play animation',exact:true}).click();await expect(iframe).toHaveCount(1);
  await page.getByRole('button',{name:'Pause animation',exact:true}).press('Escape');await expect(iframe).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Explore plot themes',exact:true})).toBeFocused();
});

test('inventory artwork loads only visible IDs and never imports rehearsal economic traits',async({page})=>{
  const calls=await mockArt(page);await open(page,workspace(24));const before=await saved(page);
  await page.getByLabel('Plot artwork source').selectOption('rehearsal');
  await page.getByRole('checkbox',{name:'Load plot artwork',exact:true}).check();
  await expect(page.locator('.plot-card')).toHaveCount(23);
  await expect(page.locator('.plot-card .art-note').filter({hasText:/Rehearsal #/})).toHaveCount(23);
  expect(calls.filter(url=>/^\/rehearsal\/\d+$/.test(url))).toHaveLength(23);expect(calls).not.toContain('/rehearsal/24');
  await page.getByRole('button',{name:'Show more plots (1 left)',exact:true}).click();
  await expect(page.locator('.plot-card')).toHaveCount(24);
  await expect(page.locator('.plot-card .art-note').filter({hasText:/Rehearsal #/})).toHaveCount(24);
  expect((await saved(page)).portfolio).toEqual(before.portfolio);
  await page.getByRole('button',{name:'View artwork for plot #24',exact:true}).click();await expect(page.getByRole('heading',{name:'Plot #0024',exact:true})).toBeVisible();
  expect(calls.filter(url=>url==='/rehearsal/24')).toHaveLength(1);
});

test('artwork failures preserve holdings and expose retry without an automatic request loop',async({page})=>{
  const calls=await mockArt(page,{failure:true});await open(page);const before=await saved(page);
  await page.getByRole('checkbox',{name:'Load plot artwork',exact:true}).check();await expect(page.getByText('Some artwork is unavailable.',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Yield forecast',exact:true}).click();await page.getByRole('tab',{name:'My farm',exact:true}).click();expect(calls).toHaveLength(1);
  await page.getByRole('button',{name:'Retry artwork',exact:true}).click();await expect.poll(()=>calls.length).toBe(2);
  await openUtility(page,'themes');
  await page.getByRole('button',{name:'Explore plot themes',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Artwork could not be loaded');
  await expect(page.getByRole('button',{name:'Use this plot’s theme',exact:true})).toHaveCount(0);
  expect((await saved(page)).portfolio).toEqual(before.portfolio);
});

test('phone studio remains within the viewport and validates collection boundaries',async({page})=>{
  await page.setViewportSize({width:390,height:844});await mockArt(page);await open(page);
  await openUtility(page,'themes');
  await page.getByRole('button',{name:'Explore plot themes',exact:true}).click();await expect(page.getByRole('button',{name:'Play animation',exact:true})).toBeVisible();
  await page.getByRole('spinbutton',{name:'Plot number',exact:true}).fill('3333');await page.getByRole('button',{name:'View plot',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Plot #3333',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Next plot',exact:true})).toBeDisabled();
  expect(await page.getByRole('dialog').evaluate(n=>n.scrollWidth>n.clientWidth)).toBe(false);
  const box=await page.getByRole('dialog').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
  await page.getByRole('button',{name:'Play animation',exact:true}).click();
  const preview=page.frameLocator('.studio-stage iframe');await expect(preview.getByText('Animated farm fixture')).toBeVisible();
  expect(await preview.locator('body').evaluate(()=>innerWidth)).toBe(560);
  const stage=await page.locator('.studio-stage').boundingBox(),frame=await page.locator('.studio-stage iframe').boundingBox();
  expect(frame.width).toBeLessThanOrEqual(stage.width);expect(frame.x+frame.width).toBeLessThanOrEqual(390);
});

test('an unavailable image has a truthful fallback and can be retried without changing the farm',async({page})=>{
  await mockArt(page);let imageFails=true;
  await page.route('https://api.rh.farm/image/**',route=>imageFails?route.fulfill({status:503,body:'Unavailable'}):route.fulfill({contentType:'image/png',path:'assets/site/corn.png'}));
  await open(page);const before=await saved(page);
  await page.getByRole('checkbox',{name:'Load plot artwork',exact:true}).check();
  await expect(page.locator('.plot-card .art-note')).toHaveText('Art unavailable · example');
  await expect(page.getByRole('button',{name:'Retry artwork',exact:true})).toBeVisible();
  imageFails=false;await page.getByRole('button',{name:'Retry artwork',exact:true}).click();
  await expect(page.locator('.plot-card .art-note')).toHaveText('Production #1');
  await expect(page.locator('.plot-card img')).toHaveAttribute('src',/\/image\/1.png/);
  imageFails=true;await openUtility(page,'themes');await page.getByRole('button',{name:'Explore plot themes',exact:true}).click();
  await expect(page.locator('#studio-art-note')).toHaveText('PRODUCTION IMAGE UNAVAILABLE');
  await expect(page.getByRole('button',{name:'Close plot studio',exact:true})).toBeFocused();
  imageFails=false;await page.getByRole('button',{name:'Refresh artwork',exact:true}).click();
  await expect(page.locator('#studio-art-note')).toHaveText('PRODUCTION #331');
  expect((await saved(page)).portfolio).toEqual(before.portfolio);
});

test('studio metadata completion preserves its keyboard focus and unsubmitted plot number',async({page})=>{
  await mockArt(page);let release;const gate=new Promise(resolve=>{release=resolve;});
  await page.route(/https:\/\/api\.rh\.farm\/metadata\/331\?fresh=/,async route=>{await gate;await route.fulfill({json:productionMetadata(331)});});
  await open(page);await openUtility(page,'themes');await page.getByRole('button',{name:'Explore plot themes',exact:true}).click();
  const input=page.getByRole('spinbutton',{name:'Plot number',exact:true});await input.fill('332');release();
  await expect(page.getByRole('button',{name:'Use this plot’s theme',exact:true})).toBeVisible();
  await expect(input).toHaveValue('332');await expect(input).toBeFocused();
  await page.getByRole('button',{name:'View plot',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Plot #0332',exact:true})).toBeVisible();
});

test('native extension themes its frame and loads rehearsal animation under its shipped CSP',async()=>{
  const path=resolve('dist-extension');const context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,args:[`--disable-extensions-except=${path}`,`--load-extension=${path}`],viewport:{width:1440,height:1000}});
  try {
    await mockArt(context);await context.route('https://rh.farm/**',r=>r.fulfill({contentType:'text/html',body:'<html><body>Game fixture</body></html>'}));
    const page=await context.newPage();await page.goto('https://rh.farm/');await page.getByRole('button',{name:'Open Farm Companion',exact:true}).click();
    const panel=page.frameLocator('iframe[title="Farm Companion"]');
    await openUtility(panel,'themes');
    await panel.getByRole('button',{name:'Scene: Deep Winter',exact:true}).click();await expect(panel.locator('#app')).toHaveAttribute('data-theme','winter');
    await panel.getByRole('button',{name:'Explore plot themes',exact:true}).click();await panel.getByRole('button',{name:'Use this plot’s theme',exact:true}).click();
    await expect(panel.locator('#app')).toHaveAttribute('data-theme','golden');
    await panel.getByRole('button',{name:'Play animation',exact:true}).click();await expect(panel.frameLocator('.studio-stage iframe').getByText('Animated farm fixture')).toBeVisible();
    await panel.getByRole('button',{name:'Pause animation',exact:true}).press('Escape');
    await expect(panel.getByRole('heading',{name:'Make it your farm',exact:true})).toBeVisible();
    await expect(panel.getByRole('button',{name:'Explore plot themes',exact:true})).toBeFocused();
  }finally{await context.close();}
});

test('userscript theme and plot studio use the isolated GM workspace and no wallet provider',async({page})=>{
  await mockArt(page);await page.route('https://rh.farm/**',r=>r.fulfill({contentType:'text/html',body:'<html><body>Game fixture</body></html>'}));await page.goto('https://rh.farm/');
  await page.evaluate(raw=>{
    window.__farmValues={};window.GM_getValue=(key,fallback)=>window.__farmValues[key]??fallback;window.GM_setValue=(key,value)=>{window.__farmValues[key]=value;};
    window.GM_xmlhttpRequest=options=>{const url=new URL(options.url),id=Number(url.pathname.split('/').at(-1)),value=url.pathname.startsWith('/plot/')?{tokenId:id,revealed:true,tierFinalized:true,level:1,tier:'Golden',weightBps:5000}:raw;options.onload({status:200,responseText:JSON.stringify(value)});};
    window.unsafeWindow={};Object.defineProperty(window.unsafeWindow,'ethereum',{get(){throw Error('Artwork must not access a wallet');}});
  },productionMetadata(331));
  await page.addScriptTag({content:await readFile('dist/yield-farm-companion.user.js','utf8')});await page.getByRole('button',{name:'Open Farm Companion',exact:true}).click();
  await openUtility(page,'themes');
  await page.getByRole('button',{name:'Scene: Storm Watch',exact:true}).click();const host=page.locator('#yield-farm-companion-host');await expect(host).toHaveAttribute('data-theme','storm');
  await page.getByRole('button',{name:'Explore plot themes',exact:true}).click();await page.getByRole('button',{name:'Use this plot’s theme',exact:true}).click();await expect(host).toHaveAttribute('data-theme','golden');
  expect(await page.evaluate(()=>JSON.parse(window.__farmValues['public-workspace-v2']).portfolio.wallets[0].plots)).toEqual([]);
  expect(await page.evaluate(()=>localStorage.getItem('yield-farm-public-v2'))).toBeNull();
});
