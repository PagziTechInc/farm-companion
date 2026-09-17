import { compare, simulate } from './engine.js';
import { clone, units, inputAmount, validatePortfolio, validateScenario } from './model.js';
import { strategyInsights } from './guidance.js';

export const planDefaults = () => ({ enabled:false, days:90, funding:'harvest', objective:'crop' });
export function validatePlanSettings(s) {
  if (!s || typeof s.enabled !== 'boolean' || (!Number.isInteger(s.days) || s.days < 1 || s.days > 365) || !['harvest','extra'].includes(s.funding) || !['crop','eth'].includes(s.objective)) throw new Error('Invalid guided-plan settings.');
  return s;
}
export function buildGuidedPlan(portfolio, scenario, settings, now = Date.now()) {
  validatePlanSettings(settings);
  const s = { ...clone(scenario), start:new Date(now).toISOString() };
  const errors = [...validatePortfolio(portfolio), ...validateScenario(s)];
  const base = {generated_at:new Date(now).toISOString(),block_number:portfolio?.block_number??null,settings:clone(settings),scenario:s};
  if (errors.length) return {...base,status:'unavailable',errors,insights:strategyInsights(portfolio,s,{days:settings.days,now}),stress:[]};
  const comparison = compare(portfolio,s,[settings.days]).find(r=>r.funding===settings.funding);
  const selected = settings.objective==='eth' ? comparison?.bestEth : comparison?.bestCrop;
  if (!selected || comparison.status!=='ok') return {...base,status:'unavailable',errors:comparison?.errors?.length ? comparison.errors : ['Supply an exit CROP price to rank ETH returns.'],insights:strategyInsights(portfolio,s,{days:settings.days,now}),stress:[]};
  const variants=[['Granary starts empty',{granaryCrop:'0',rewardStateBasis:'assumption'}],
    ['Locusts throughout',{weatherBps:5000,weatherPath:[],weatherEvents:[],useKnownWeather:false}],
    ['Exit CROP price halves',{sellPrice:s.sellPrice ? inputAmount(units(s.sellPrice)/2n) : ''}]];
  const stress=variants.map(([label,change])=>{
    const r=simulate(portfolio,{...s,...change},{days:settings.days,funding:settings.funding,policy:selected.policy,objective:selected.objective,budgetFraction:selected.budget_fraction});
    return {label,status:r.status,net_crop_wei:r.net_crop_wei??null,operating_eth_wei:r.operating_eth_wei??null,errors:r.errors??[]};
  });
  return {...base,status:'ok',selected,baseline:comparison.baseline,hold:comparison.hold,insights:strategyInsights(portfolio,s,{days:settings.days,now,selectedResult:selected}),stress,
    notes:['Guided planning restarts from the current time and freshly read holdings.', 'Your weight sets the nominal rate; the annual base ceiling and available Granary can limit payouts.', 'Stress cases rerun the selected policy; they are not predictions or a frozen transaction sequence.', 'Contract simulation and your wallet approval are required separately for every action.']};
}

export function validateExecutionLog(records) {
  if (!Array.isArray(records) || records.length>100) throw new Error('Invalid execution journal.');
  for(const r of records) {
    if (!r || !['pending','confirmed','reverted','unknown','rejected','replaced'].includes(r.status) || typeof r.at!=='string' || !Number.isFinite(Date.parse(r.at)) || typeof r.type!=='string' || r.type.length>30 || typeof r.wallet_id!=='string' || r.wallet_id.length>64) throw new Error('Invalid execution journal entry.');
    if(r.hash!=null&&!/^0x[\da-fA-F]{64}$/.test(r.hash)) throw new Error('Invalid journal transaction hash.');
  }
  return records;
}
