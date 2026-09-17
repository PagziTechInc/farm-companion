import { allPlots, clone, defaults, units, inputAmount, json, validateScenario } from './model.js';
import { guidedNextAction } from './guidance.js';
import { isForecastPreview } from './forecast-portfolio.js';

export const activePlanDefaults = () => ({enabled:false,days:90,funding:'harvest',objective:'crop',refreshSeconds:60,
  feeMode:'unknown',claimFee:'',upgradeFee:'',plantFee:'',transferFee:'',buyFee:'',nftTransferFee:'',
  buyPrice:'',sellPrice:'',extraBudget:'',extraSpent:'0',claimEveryDays:1,allowTransfers:false,includeOpeningCrop:true,useObservedWeight:false});
const amounts=['claimFee','upgradeFee','plantFee','transferFee','buyFee','nftTransferFee','buyPrice','sellPrice','extraBudget','extraSpent'];
const flags=['enabled','allowTransfers','includeOpeningCrop','useObservedWeight'];

export function validateActivePlanSettings(raw) {
  if(raw==null)return activePlanDefaults();
  if(typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid active-plan settings.');
  const result=activePlanDefaults();
  for(const key of flags){if(raw[key]!=null&&typeof raw[key]!=='boolean')throw Error(`Invalid active-plan ${key}.`);if(raw[key]!=null)result[key]=raw[key];}
  for(const [key,min,max] of [['days',1,365],['refreshSeconds',30,900],['claimEveryDays',1,365]]){
    if(raw[key]!=null){if(!Number.isInteger(raw[key])||raw[key]<min||raw[key]>max)throw Error(`Active-plan ${key} must be ${min}–${max}.`);result[key]=raw[key];}
  }
  for(const [key,allowed] of [['funding',['harvest','extra']],['objective',['crop','eth']],['feeMode',['unknown','estimated','zero']]]){
    if(raw[key]!=null){if(!allowed.includes(raw[key]))throw Error(`Invalid active-plan ${key}.`);result[key]=raw[key];}
  }
  for(const key of amounts)if(raw[key]!=null){
    if(raw[key]===''){result[key]=key==='extraSpent'?'0':'';continue;}
    if(typeof raw[key]!=='string'&&typeof raw[key]!=='number')throw Error(`Invalid active-plan ${key}.`);
    const amount=units(raw[key]);if(amount>=2n**256n)throw Error(`Active-plan ${key} exceeds supported bounds.`);result[key]=inputAmount(amount);
  }
  if(result.extraBudget!==''&&units(result.extraSpent)>units(result.extraBudget))throw Error('Already-used investment cannot exceed the total extra-investment cap.');
  return result;
}

// Advisory cadence anchors only; a timestamp never authorizes a claim.
export function validateActivePlanClock(raw={}) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length>20)throw Error('Invalid active-plan claim clock.');
  return Object.fromEntries(Object.entries(raw).map(([key,value])=>{
    if(!key||key.length>120||['__proto__','constructor','prototype'].includes(key)||typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw Error('Invalid active-plan claim clock entry.');
    return [key,new Date(value).toISOString()];
  }));
}

export function planPortfolio(portfolio) {
  const copy=clone(portfolio),watched=copy.wallets.filter(w=>w.address);
  const excluded=watched.length?copy.wallets.filter(w=>!w.address).reduce((n,w)=>n+w.plots.length,0):0;
  if(watched.length)copy.wallets=watched;
  copy.expected_total_plots=allPlots(copy).length;copy.wallets.forEach(w=>{w.expected_plot_count=w.plots.length;});
  if(!watched.length)copy.is_demo=true;
  return {portfolio:copy,scope:watched.length?'watched':'model',excludedModelPlots:excluded};
}

// A public plan uses a fresh stock observation; the ordinary forecast remains unchanged.
export function activePlanInput(workspace,now=Date.now()) {
  if(!Number.isFinite(now))throw Error('Current planning time is invalid.');
  const settings=validateActivePlanSettings(workspace.activePlan),selected=planPortfolio(workspace.portfolio);
  const p=selected.portfolio,s={...defaults(),...clone(workspace.scenario),...Object.fromEntries(amounts.filter(k=>k!=='extraSpent').map(k=>[k,settings[k]])),
    start:new Date(now).toISOString(),feeMode:settings.feeMode,claimEveryDays:settings.claimEveryDays,
    allowTransfers:settings.allowTransfers,includeOpeningCrop:settings.includeOpeningCrop,walletMode:'keep'};
  const errors=[];
  if(isForecastPreview(p))errors.push('Forecast previews cannot authorize actions. Refresh the actual wallets to build an active plan.');
  if(selected.scope==='watched')s.claimClock=validateActivePlanClock(workspace.activePlanClock??{});
  if(settings.extraBudget!=='')s.extraBudget=inputAmount(units(settings.extraBudget)-units(settings.extraSpent));
  if(selected.scope==='watched'){
    if(p.tiers_finalized===false||allPlots(p).some(plot=>plot.tiers_finalized===false||plot.rarity_verified===false))errors.push('On-chain rarity is still pending. Forecast previews are available; the active plan needs finalized tiers.');
    if(!Number.isFinite(Date.parse(p.observed_at_utc))||now-Date.parse(p.observed_at_utc)>120000||Date.parse(p.observed_at_utc)>now+60000||p.block_number==null)errors.push('Refresh watched wallets before building the active plan.');
    if(p.chain_id!==4663)errors.push('A verified Robinhood Chain observation is required.');
    if(s.useKnownWeather && p.weather_schedule?.status==='ok' && p.weather_schedule.block_number===p.block_number && p.weather_schedule.block_timestamp===p.block_timestamp){
      s.weatherWeeks=clone(p.weather_schedule.weeks);s.weatherBasis='chain';s.weatherObservedAt=p.weather_schedule.observed_at_utc;
    }
    if(p.read_errors?.length)errors.push(...p.read_errors);
    const at=p.reward_observed_at_utc;
    if(p.carry_crop_wei==null||p.granary_crop_wei==null||!Number.isFinite(Date.parse(at)))errors.push('Refresh both carry and Granary at the wallet observation block.');
    else {s.carryCrop=inputAmount(p.carry_crop_wei);s.granaryCrop=inputAmount(p.granary_crop_wei);s.rewardStateBasis='observed';s.rewardObservedAt=at;}
    if(settings.useObservedWeight){
      const ours=allPlots(p).reduce((n,plot)=>n+(plot.effective_weight_bps??0),0);
      if(!Number.isSafeInteger(p.total_planted_farm_weight_bps)||p.total_planted_farm_weight_bps<ours)errors.push('Valley weight for the harvest-limit check is unavailable or inconsistent with these wallets.');
      else {s.externalWeight=String((p.total_planted_farm_weight_bps-ours)/10000);s.externalWeightPath=[];}
    }
  }else if(settings.useObservedWeight)errors.push('Observed harvest limits require a refreshed public wallet. Use forecast assumptions for a model farm.');
  if(settings.feeMode==='unknown')errors.push('Choose estimated action fees or explicitly select the zero-fee scenario.');
  if(settings.feeMode==='estimated')for(const name of ['claim','upgrade','plant','transfer','buy','nftTransfer'])if(settings[`${name}Fee`]==='')errors.push(`Enter the ${name} fee estimate in ETH.`);
  if(settings.objective==='eth'&&(!settings.sellPrice||units(settings.sellPrice)===0n))errors.push('Enter a positive net CROP exit price to compare ETH returns.');
  if(settings.funding==='extra'&&(!settings.extraBudget||!settings.buyPrice||units(settings.buyPrice)===0n))errors.push('Extra investment needs an explicit total ETH cap and positive all-in CROP buy price.');
  errors.push(...validateScenario(s));
  return {...selected,scenario:s,settings,now,errors:[...new Set(errors)],remainingBudgetEth:s.extraBudget,
    fingerprint:activePlanFingerprint(workspace)};
}

export const activePlanFingerprint=workspace=>json({portfolio:planPortfolio(workspace.portfolio).portfolio,scenario:workspace.scenario,claimClock:validateActivePlanClock(workspace.activePlanClock??{}),settings:validateActivePlanSettings(workspace.activePlan)});
export const actionIdentity=action=>action?json({type:action.type,wallet_id:action.wallet_id,plot_id:action.plot_id,plot_ids:action.plot_ids,to_level:action.to_level}):'';

export function livePlanAction(plan,workspace,{now=Date.now(),locked=false,stale=false}={}) {
  const blocked=why=>({status:'blocked',type:null,why});
  if(isForecastPreview(workspace.portfolio))return blocked('Forecast previews cannot authorize actions. Refresh the actual wallets.');
  if(locked)return blocked('Finish or discard the current review, or check its pending receipt.');
  if(!plan)return {status:'calculate',type:null,why:'Build the plan to compare the next move.'};
  if(stale||plan.inputFingerprint!==activePlanFingerprint(workspace))return {status:'recalculate',type:null,why:'Farm data or plan assumptions changed. Rebuild before reviewing a step.'};
  if(plan.scope==='model')return {status:'simulation',type:null,why:'This is a model plan. Watch and refresh a real wallet to review an action.'};
  if(plan.status!=='ok')return {status:'prepare',type:null,why:'Complete the missing inputs before choosing an action.',required_inputs:plan.errors??[]};
  if(now-Date.parse(plan.generated_at)>120000)return {status:'refresh',type:null,why:'The plan is more than two minutes old. Refresh and rebuild before review.'};
  const p=planPortfolio(workspace.portfolio).portfolio;
  return guidedNextAction(p,plan.scenario,plan.selected,{now});
}
