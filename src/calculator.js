import { rules, DAY, UNIT, units, weight, levelCost, validatePortfolio, validateScenario } from './model.js';
import { timeline, rewardState, rewardProjection, harvestRateAtStart } from './engine.js';

const positive=n=>n>0n?n:0n;
const sum=items=>items.reduce((a,b)=>a+b,0n);
const ceilDiv=(a,b)=>(a+b-1n)/b;
const compareRatio=(a,b)=>{const left=a.marginal_crop_wei*b.cost_crop_wei,right=b.marginal_crop_wei*a.cost_crop_wei;return left>right?-1:left<right?1:a.plot_id-b.plot_id;};
/** Local deterministic analysis. Holdings stay fixed; each upgrade is an independent alternative. */
export function analyzeFarm(portfolio,scenario,{days=90,now=Date.now()}={}) {
  const errors=[...validatePortfolio(portfolio),...validateScenario(scenario)];
  if(!Number.isInteger(days)||days<1||days>365)errors.push('Choose a horizon of 1–365 whole days.');
  if(!Number.isFinite(now))errors.push('Current time is invalid.');
  let opening;
  if(!errors.length)try { opening=rewardState(scenario); }catch(error){errors.push(`Enter explicit carry and Granary balances: ${error.message}`);}
  if(errors.length)return {status:'unavailable',errors:[...new Set(errors)],assumptions:[],wallets:[],horizons:[],upgrades:[],upgrade_paths:[],best_upgrade_path:null,next_fundable_path:null,advice:[]};
  const plots=portfolio.wallets.flatMap(w=>w.plots.map(p=>({wallet:w,plot:p})));
  const start=Date.parse(scenario.start),rows=timeline(scenario,365);
  const ours=plots.reduce((n,{plot:p})=>n+(p.is_active?p.effective_weight_bps:0),0);
  const base=rewardProjection(rows,ours,opening),daily=base.daily.map(r=>r.crop_wei);
  const selectedDaily=base.daily.slice(0,days);
  const harvestRate=harvestRateAtStart(scenario,ours);
  const harvestLimits={base_limited:selectedDaily.some(row=>row.base_limited),bonus_limited:selectedDaily.some(row=>row.bonus_limited),
    nominal_crop_wei:sum(selectedDaily.map(row=>row.nominal_crop_wei??0n)),projected_crop_wei:sum(daily.slice(0,days))};
  const liquid=sum(portfolio.wallets.map(w=>BigInt(w.crop_balance_wei))),pending=sum(plots.map(({plot:p})=>BigInt(p.pending_crop_wei)));
  const period=n=>sum(daily.slice(0,n));
  const wallets=portfolio.wallets.map(w=>{
    const active=w.plots.reduce((n,p)=>n+(p.is_active?p.effective_weight_bps:0),0);
    const dailyCrop=base.daily.map(row=>ours?row.farm_crop_wei*BigInt(active)/BigInt(ours+rows[row.day].external):0n);
    return {wallet_id:w.id,label:w.label,active_weight_bps:active,daily_crop_wei:dailyCrop[0],weekly_crop_wei:sum(dailyCrop.slice(0,7)),liquid_crop_wei:BigInt(w.crop_balance_wei),pending_crop_wei:sum(w.plots.map(p=>BigInt(p.pending_crop_wei))),daily:dailyCrop};
  });
  const gains=new Map(),fundedGains=new Map(),upgrades=[],upgradePaths=[];
  const differencesFor=delta=>{
    if(!gains.has(delta)){
      const alternative=rewardProjection(rows,ours+delta,opening);
      gains.set(delta,alternative.daily.map((r,i)=>r.crop_wei-daily[i]));
    }
    return gains.get(delta);
  };
  const fundingFor=(w,cost)=>{
    const available=w.liquid_crop_wei+w.pending_crop_wei,short=positive(cost-available);
    let ready=available>=cost?0:null,future=0n;
    if(ready===null)for(let i=0;i<365;i++){future+=w.daily[i];if(future>=short){ready=i+1;break;}}
    return {available,ready,liquidShort:positive(cost-w.liquid_crop_wei),buyShort:positive(cost-available)};
  };
  const fundedGainFor=(delta,ready,dormant)=>{
    if(dormant||ready===null)return null;
    const key=`${delta}:${ready}`;
    if(!fundedGains.has(key)) {
      const atReady=ready===0?opening:{carry:base.daily[ready-1].carry,granary:base.daily[ready-1].granary};
      fundedGains.set(key,ready>=days?0n:rewardProjection(rows.slice(ready,days),ours+delta,atReady).earned-sum(daily.slice(ready,days)));
    }
    return fundedGains.get(key);
  };
  const cropPrice=scenario.buyPrice===''||scenario.buyPrice==null?null:units(scenario.buyPrice);
  const positiveBuyPrice=cropPrice!==null&&cropPrice>0n?cropPrice:null;
  for(const {wallet,plot} of plots){
    if(plot.level>=5)continue;
    const dormant=!plot.is_active,w=wallets.find(w=>w.wallet_id===wallet.id);
    let cumulativeCost=0n;const steps=[];
    for(let target=plot.level+1;target<=5;target++){
      const stepCost=levelCost(target);cumulativeCost+=stepCost;
      steps.push({from_level:target-1,to_level:target,cost_crop_wei:stepCost});
      const delta=weight(plot.rarity_tier,target)-weight(plot.rarity_tier,plot.level),differences=differencesFor(delta),gain=sum(differences.slice(0,days));
      let accumulated=0n,breakEven=null;
      for(let i=0;i<365;i++){accumulated+=differences[i];if(accumulated>=cumulativeCost){breakEven=i+1;break;}}
      const funding=fundingFor(w,cumulativeCost),fundedGain=fundedGainFor(delta,funding.ready,dormant);
      const quoteCapital=!dormant&&funding.buyShort>0n&&positiveBuyPrice!==null?ceilDiv(funding.buyShort*positiveBuyPrice,UNIT):null;
      const common={wallet_id:wallet.id,plot_id:plot.token_id,rarity_tier:plot.rarity_tier,from_level:plot.level,to_level:target,
        cost_crop_wei:cumulativeCost,added_weight_bps:delta,funded_marginal_crop_wei:fundedGain,funded_net_crop_wei:fundedGain===null?null:fundedGain-cumulativeCost,
        daily_gain_crop_wei:dormant?null:differences[0],marginal_crop_wei:dormant?0n:gain,net_crop_wei:dormant?null:gain-cumulativeCost,break_even_days:dormant?null:breakEven,
        ready_in_days:dormant?null:funding.ready,ready_at_utc:dormant||funding.ready===null?null:new Date(start+funding.ready*DAY*1000).toISOString(),
        liquid_shortfall_crop_wei:funding.liquidShort,pending_crop_wei:w.pending_crop_wei,claim_required:!dormant&&funding.liquidShort>0n&&(w.pending_crop_wei>0n||funding.ready!==null),
        funding_status:dormant?'plant_first':w.liquid_crop_wei>=cumulativeCost?'ready':funding.available>=cumulativeCost?'claim_first':funding.ready===null?'beyond_horizon':'accrue_then_claim',requires_planting:dormant,
        marginal_by_horizon:[7,30,90,365].map(n=>({days:n,marginal_crop_wei:dormant?null:sum(differences.slice(0,n))}))};
      const nextLevel=target===plot.level+1;
      if(nextLevel)upgrades.push({...common,from_level:plot.level,to_level:target,
        // Keep the legacy field names and one-step meanings unchanged.
        funded_marginal_crop_wei:fundedGain,funded_net_crop_wei:fundedGain===null?null:fundedGain-stepCost,
        marginal_crop_wei:dormant?0n:gain,net_crop_wei:dormant?null:gain-stepCost,
        break_even_days:dormant?null:(()=>{let total=0n;for(let i=0;i<365;i++){total+=differences[i];if(total>=stepCost)return i+1;}return null;})(),
        cost_crop_wei:stepCost,liquid_shortfall_crop_wei:positive(stepCost-w.liquid_crop_wei),
        claim_required:positive(stepCost-w.liquid_crop_wei)>0n&&(w.pending_crop_wei>0n||funding.ready!==null),
        funding_status:dormant?'plant_first':w.liquid_crop_wei>=stepCost?'ready':funding.available>=stepCost?'claim_first':funding.ready===null?'beyond_horizon':'accrue_then_claim'});
      upgradePaths.push({...common,steps:steps.map(step=>({...step})),buy_shortfall_after_claim_crop_wei:dormant?null:funding.buyShort,
        quoted_buy_price_eth_wei:!dormant&&funding.buyShort>0n?positiveBuyPrice:null,quoted_buy_capital_eth_wei:quoteCapital,
        buy_capital_basis:quoteCapital===null?null:'positive supplied scenario buy price; principal estimate only'});
    }
  }
  upgrades.sort((a,b)=>Number(a.requires_planting)-Number(b.requires_planting)||compareRatio(a,b));
  const eligible=upgrades.filter(r=>!r.requires_planting),best=eligible.find(r=>r.net_crop_wei>0n)??null;
  const fundable=[...eligible].filter(r=>r.funded_net_crop_wei!==null&&r.funded_net_crop_wei>0n&&r.ready_in_days!==null).sort((a,b)=>a.ready_in_days-b.ready_in_days||compareRatio(a,b))[0]??null;
  const ratioThenTarget=(a,b)=>compareRatio(a,b)||a.to_level-b.to_level;
  upgradePaths.sort((a,b)=>{
    const active=Number(a.requires_planting)-Number(b.requires_planting);
    if(active)return active;
    if(a.requires_planting)return a.plot_id-b.plot_id||a.to_level-b.to_level;
    return a.net_crop_wei>b.net_crop_wei?-1:a.net_crop_wei<b.net_crop_wei?1:ratioThenTarget(a,b);
  });
  const eligiblePaths=upgradePaths.filter(r=>!r.requires_planting),bestPath=eligiblePaths.find(r=>r.net_crop_wei>0n)??null;
  const fundablePath=[...eligiblePaths].filter(r=>r.funded_net_crop_wei!==null&&r.funded_net_crop_wei>0n&&r.ready_in_days!==null)
    .sort((a,b)=>a.funded_net_crop_wei>b.funded_net_crop_wei?-1:a.funded_net_crop_wei<b.funded_net_crop_wei?1:a.ready_in_days-b.ready_in_days||ratioThenTarget(a,b))[0]??null;
  const sell=scenario.sellPrice===''||scenario.sellPrice==null?null:units(scenario.sellPrice),horizons=[...new Set([7,30,90,365,days])].sort((a,b)=>a-b).map(n=>({days:n,earned_crop_wei:period(n),ending_crop_wei:liquid+pending+period(n),estimated_value_eth_wei:sell===null?null:period(n)*sell/UNIT,
    nominal_crop_wei:sum(base.daily.slice(0,n).map(row=>row.nominal_crop_wei??0n)),base_limited:base.daily.slice(0,n).some(row=>row.base_limited),bonus_limited:base.daily.slice(0,n).some(row=>row.bonus_limited)}));
  const bag=portfolio.seed_bag_price_wei==null?null:BigInt(portfolio.seed_bag_price_wei);
  const cropPlantCost=cropPrice===null?null:(units(rules.planting.cost_crop)*cropPrice+UNIT-1n)/UNIT;
  const plantingOptions={crop_cost_wei:units(rules.planting.cost_crop),quoted_crop_purchase_eth_wei:cropPlantCost,seed_bag_eth_wei:bag,seed_bag_open:portfolio.seed_bag_open??null,
    cheaper_before_gas:portfolio.seed_bag_open!==true||bag===null||bag<=0n||cropPlantCost===null?null:bag<cropPlantCost?'seed_bag':bag>cropPlantCost?'crop':'equal',
    note:'Seed bag is a mutable on-chain quote. The comparison excludes operation gas and does not assign an acquisition cost to CROP already owned. Re-read before acting.'};
  const advice=[];
  if(plantingOptions.cheaper_before_gas&&plantingOptions.cheaper_before_gas!=='equal')advice.push({priority:'opportunity',title:'Compare both planting payment methods',detail:`${plantingOptions.cheaper_before_gas==='seed_bag'?'The native ETH seed bag':'Buying the required CROP'} costs less before gas at these quotes. Check the current bag price and transaction costs before deciding.`});
  const dormantCount=plots.filter(({plot:p})=>!p.is_active).length;
  if(dormantCount)advice.push({priority:'action',title:`${dormantCount} dormant plot${dormantCount===1?'':'s'}`,detail:`Dormant plots earn zero. Activation costs ${rules.planting.cost_crop} CROP each; compare planting income with its cost before upgrading.`});
  if(best)advice.push({priority:'opportunity',title:`Compare plot #${best.plot_id} first`,detail:`Its next level has the strongest marginal CROP return per token among evaluated profitable next steps over ${days} days. Upgrade alternatives are independent, so rebuild the ranking after each change.`});
  else if(eligible.length)advice.push({priority:'hold',title:'No next upgrade repays its CROP cost in this term',detail:'Keep harvesting or compare a longer term before spending. More weight alone does not establish profit.'});
  if(pending>0n)advice.push({priority:'info',title:'Pending CROP needs a claim',detail:'The affordability timer includes existing pending rewards once. Claiming makes them spendable and does not increase your yield. Each wallet funds its own upgrades.'});
  if(scenario.feeMode==='unknown')advice.push({priority:'input',title:'Add network costs for profit decisions',detail:'CROP yield and funding timers work without a token price. ETH values remain estimates and need executable prices plus operation costs.'});
  if(portfolio.rule_conflicts?.length)advice.push({priority:'input',title:'Resolve chain conflicts',detail:portfolio.rule_conflicts.join(' ')});
  return {status:'ok',errors:[],generated_at:new Date(now).toISOString(),start_utc:scenario.start,days,
    portfolio:{active_weight_bps:ours,daily_crop_wei:daily[0],weekly_crop_wei:period(7),liquid_crop_wei:liquid,pending_crop_wei:pending},harvest_rate:harvestRate,harvest_limits:harvestLimits,wallets:wallets.map(({daily,...w})=>w),planting_options:plantingOptions,horizons,upgrades,best_upgrade:best,next_fundable_upgrade:fundable,
    upgrade_paths:upgradePaths,best_upgrade_path:bestPath,next_fundable_path:fundablePath,advice,
    curve:base.daily.filter((_,i)=>i%7===6||i===days-1).filter(r=>r.day<days).map(r=>({day:r.day+1,earned_crop_wei:period(r.day+1)})),
    ending_carry_crop_wei:base.daily[days-1].carry,ending_granary_crop_wei:base.daily[days-1].granary,
    assumptions:['Holdings stay fixed: forecasts do not automatically plant, upgrade, buy, sell or claim.',
      'Your own active weight sets the nominal rate: 2,000 CROP per weight unit per week, adjusted by the current weather and First Soil. Annual release, carry and finite Granary limits can reduce the selected projection.',
      `${scenario.rewardStateBasis==='observed'?'Observed':'Assumed'} opening carry and Granary apply at the selected start. Outside weight is an optional harvest-limit scenario; zero means no additional valley weight is assumed.`,
      'Upgrade ranking assumes an immediate upgrade and measures whole-portfolio marginal return. Next-fundable estimates subtract earnings lost while the same wallet waits to fund the single step or full route. Wallet funding is never pooled.',
      'Upgrade routes are independent all-steps-at-once alternatives; they do not credit harvest between route steps. The active plan models staged actions separately.',
      'Upgrade routes rank by total net CROP over the selected term; the best fundable route ranks by funded net CROP, then funding wait and marginal return per CROP.',
      'Quoted buy capital appears only for a positive CROP shortfall after the wallet liquidates its existing pending rewards and a positive supplied buy-price assumption. It is a principal estimate, not a live executable quote; operation fees remain separate.',
      'Funding and first break-even timers use whole-day estimates through 365 days; an absent date means not reached in that window. Funding timers check CROP only; operation fees and ETH availability need separate review.',
      'Displayed token value is forecast gross reward value, not realized profit. It excludes fees, capital and NFT resale.',
      'Integer arithmetic models source segment rules; daily settlement and share rounding can differ slightly from contract accumulators.']};
}
