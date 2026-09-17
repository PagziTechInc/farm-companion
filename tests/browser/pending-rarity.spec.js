import {test, expect} from '@playwright/test';
import {defaults, emptyPortfolio, units} from '../../src/model.js';
import {FORECAST_FIELDS} from '../../src/forecast-defaults.js';
import manifestRows from '../../knowledge/snapshots/manifest-2026-09-07.json' with {type: 'json'};
import reviewed from '../../knowledge/reviewed-deployment.json' with {type: 'json'};
import {openForecastSettings} from './navigation.js';

const STORAGE='yield-farm-public-v2';
const OBSERVED_AT='2026-09-15T22:41:01.000Z';
const BLOCK=64015171;
const STARTING_INDEX=1827;
const NFT=reviewed.contracts.nft.address;
const ADDRESSES=['0x1111111111111111111111111111111111111111','0x2222222222222222222222222222222222222222'];

function pendingPlot(tokenId, address) {
  const manifestTier=manifestRows[(tokenId-1+STARTING_INDEX)%manifestRows.length].tier;
  return {
    token_id:tokenId, owner_address:address, rarity_tier:null, level:1, is_active:false,
    chain_rarity_tier:0, manifest_rarity_tier:manifestTier, rarity_verified:false,
    tiers_finalized:false, rarity_status:'pending_finalization', effective_weight_bps:0,
    desired_weight_bps:0, weight_synchronized:true, pending_crop_wei:'0',
    reveal_status:'revealed', metadata_reveal_status:'revealed', traits:{'Rarity Tier':'Pending'},
    modifiers:null, block_number:BLOCK, observed_at_utc:OBSERVED_AT,
    evidence_source:'pinned-rpc+unversioned-metadata'
  };
}

function pendingWorkspace({runtime=true, manifest=true, repetitiveErrors=false}={}) {
  const portfolio=emptyPortfolio();
  portfolio.wallets=ADDRESSES.map((address,index)=>({
    id:`wallet_${index?'b':'a'}`, label:`Wallet ${index?'B':'A'}`, address,
    expected_plot_count:index?14:12, crop_balance_wei:'0', eth_balance_wei:units('0.1').toString(),
    plots:Array.from({length:index?14:12},(_,offset)=>pendingPlot(index?offset+13:offset+1,address))
  }));
  Object.assign(portfolio,{
    expected_total_plots:26, observed_at_utc:OBSERVED_AT, block_number:BLOCK,
    block_timestamp:Date.parse(OBSERVED_AT)/1000, chain_id:4663,
    total_planted_farm_weight_bps:0, effective_weather_multiplier_bps:10000,
    starting_index:STARTING_INDEX, tiers_finalized:false, manifest_verified:manifest,
    nft_runtime_verified:runtime, nft_contract_address:NFT,
    carry_crop_wei:'0', granary_crop_wei:units('40000000').toString(),
    reward_observed_at_utc:OBSERVED_AT, read_errors:repetitiveErrors?Array.from({length:26},(_,i)=>`Plot ${i+1}: rarity assignment is not confirmed finalized.`):[],
    read_warnings:['Rarity tiers are not finalized; rarity remains unknown until finalization.'], metadata_errors:[], rule_conflicts:[]
  });
  return {schema_version:2, portfolio, scenario:{...defaults(), start:'2026-09-21T00:00:00Z', weatherBps:10000}, days:30,
    forecastManual:[...FORECAST_FIELDS], companion:{scene:'journal',goal_crop:'5000',goal_wallet_id:'',pinned_plot_id:null,assume_planted:false}};
}

async function load(page, state) {
  await page.route('https://robinhood-rpc.publicnode.com/**', route=>route.abort());
  await page.addInitScript(({key, value})=>localStorage.setItem(key, JSON.stringify(value)), {key:STORAGE, value:state});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Your plots',exact:true})).toBeVisible();
}

async function calculate(page, {expectSuccess=true}={}) {
  await page.getByRole('tab',{name:'Yield forecast',exact:true}).click();
  await openForecastSettings(page);
  await page.getByRole('button',{name:'Calculate forecast',exact:true}).click();
  if(expectSuccess)await expect(page.getByRole('heading',{name:'Harvest without reinvesting',exact:true})).toBeVisible();
}

async function downloadText(page, name) {
  const pending=page.waitForEvent('download');
  await page.getByRole('button',{name,exact:true}).click();
  const stream=await (await pending).createReadStream(),chunks=[];
  for await(const chunk of stream)chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

test('26 pending plots use a manifest preview without changing raw holdings, then opt into planting', async ({page}) => {
  await load(page, pendingWorkspace());
  const prizeCards=page.locator('.plot-card').filter({hasText:/Prize Plot · pending/});
  await expect(prizeCards.first()).toBeVisible();
  await expect(page.locator('.plot-card').filter({hasText:'Unrevealed'})).toHaveCount(0);

  await calculate(page);
  await expect(page.locator('.forecast-basis')).toContainText('Revealed-trait preview · on-chain rarity pending');
  expect((await page.locator('.forecast-value').textContent()).trim()).toBe('0CROP');
  const before=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)), STORAGE);
  expect(before.portfolio.wallets.flatMap(wallet=>wallet.plots).every(plot=>plot.rarity_tier===null&&plot.is_active===false&&plot.effective_weight_bps===0)).toBe(true);

  await openForecastSettings(page);
  await page.locator('#assume-planted').check();
  await expect(page.locator('.forecast-basis')).toContainText('Planting funded separately: 65,000 CROP · excluded from harvest');
  await expect(page.locator('.forecast-basis')).toContainText('26 dormant plots assumed planted');
  expect((await page.locator('.forecast-value').textContent()).trim()).not.toBe('0CROP');
  const csv=await downloadText(page,'Export forecast CSV');
  expect(csv.split('\r\n')[0]).toContain('forecast_mode');
  expect(csv).toContain('manifest-preview');
  expect(csv).toContain('true');
  expect(csv).toContain('26');
  expect(csv).toContain('65000');
  expect(csv).toContain('separate-capital');
  const after=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)), STORAGE);
  expect(after.companion.assume_planted).toBe(true);
  expect(after.portfolio.wallets.flatMap(wallet=>wallet.plots).every(plot=>plot.rarity_tier===null&&plot.is_active===false&&plot.effective_weight_bps===0)).toBe(true);

  await page.getByRole('tab',{name:'Upgrade planner',exact:true}).click();
  await expect(page.locator('.forecast-basis')).toContainText('Revealed-trait preview · on-chain rarity pending');
  await expect(page.getByRole('heading',{name:'Upgrade cost & waiting time',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Build active plan',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Active plan',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Save & build plan',exact:true}).click();
  // Forecast and plan reads share the bounded network-failure cooldown.
  await expect(page.locator('.active-plan-runtime-error')).toContainText('previous plan cannot authorize',{timeout:15000});
  await expect(page.locator('#active-review')).toHaveCount(0);
});

test('unverified pending rarity stays blocked with one concise calculation error', async ({page}) => {
  await load(page, pendingWorkspace({runtime:false, manifest:false, repetitiveErrors:true}));
  await expect(page.locator('.plot-card').filter({hasText:/Prize Plot · pending/})).toHaveCount(0);
  await expect(page.locator('.plot-card').filter({hasText:'Rarity pending'}).first()).toBeVisible();
  await calculate(page,{expectSuccess:false});
  const alert=page.getByRole('alert').filter({hasText:'Refresh wallets to preview revealed traits'}).last();
  await expect(alert).toBeVisible();
  await expect(alert.locator('details')).toHaveCount(0);
  expect((await alert.textContent()).length).toBeLessThan(5000);
  await expect(page.locator('.forecast-value')).toHaveCount(0);
});
