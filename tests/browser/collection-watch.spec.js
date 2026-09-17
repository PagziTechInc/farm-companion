import {test,expect} from '@playwright/test';
import {defaults,emptyPortfolio} from '../../src/model.js';
import {openUtility} from './navigation.js';

const STORAGE='yield-farm-public-v2';

async function openFarm(page) {
  const state={schema_version:2,portfolio:emptyPortfolio(),scenario:defaults(),days:90,companion:{scene:'journal',goal_crop:'5000',goal_wallet_id:'',pinned_plot_id:null,theme_plot:null,artwork_enabled:false,artwork_environment:'production'}};
  await page.addInitScript(({key,state})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(state));},{key:STORAGE,state});
  await page.goto('/');
}

test('Valley reveal watch refreshes collection progress and exposes its catalog without wallet reads',async({page})=>{
  const fixtures=[
    {schema_version:1,environment:'production',phase:'waiting_for_reveal',target_count:3333,collected_count:0,last_checked_at_utc:new Date().toISOString(),next_check_at_utc:new Date(Date.now()+60000).toISOString(),error:'',chain_observation:{chain_id:4663,runtime_verified:true,manifest_verified:true,status:'sealed',block_number:63958680,observed_at_utc:new Date().toISOString(),total_supply:2315}},
    {schema_version:1,environment:'production',phase:'collecting',target_count:3333,collected_count:17,last_checked_at_utc:new Date().toISOString(),next_check_at_utc:new Date(Date.now()+60000).toISOString(),error:''}
  ];
  let reads=0;const walletRequests=[];
  page.on('request',request=>{
    const url=request.url();
    if(/rpc\.mainnet\.chain\.robinhood\.com|api\.rh\.farm\/(?:plot|metadata)\//.test(url))walletRequests.push(url);
  });
  await page.route('https://farm.pagzi.tech/collection/status.json',async route=>{
    const index=Math.min(reads++,fixtures.length-1);
    await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','cache-control':'no-store'},body:JSON.stringify(fixtures[index])});
  });
  await openFarm(page);
  await openUtility(page,'valley');
  const watch=page.getByRole('region',{name:'Collection reveal watch',exact:true});
  await expect(watch.getByRole('heading',{name:'Waiting for reveal',exact:true})).toBeVisible();
  await expect(watch).toContainText('2,315 / 3,333 minted · awaiting reveal');
  await expect(watch).not.toContainText('0 / 3,333 plots collected');
  expect(reads).toBe(1);
  await watch.getByRole('button',{name:'Refresh status',exact:true}).click();
  await expect(watch.getByRole('heading',{name:'Gathering revealed plots',exact:true})).toBeVisible();
  await expect(watch).toContainText('17 / 3,333 plots collected');
  await expect(watch.getByRole('progressbar',{name:'Collected production plots',exact:true})).toHaveAttribute('value','17');
  const catalog=watch.getByRole('link',{name:'Download collected plots',exact:true});
  await expect(catalog).toHaveAttribute('href','https://farm.pagzi.tech/collection/plots.json');
  await expect(catalog).toHaveAttribute('target','_blank');
  expect(reads).toBe(2);
  expect(walletRequests).toEqual([]);
  await expect(page.getByRole('button',{name:'Check the valley',exact:true})).toBeVisible();
});
