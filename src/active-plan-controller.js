import { activePlanInput, activePlanFingerprint, livePlanAction } from './active-plan.js';

// Lifecycle only: this controller can read and calculate, never access a wallet provider.
export function createActivePlanController({getWorkspace,refresh,runner,prepareWorkspace=()=>{},onChange=()=>{},actionState=()=>({}),isVisible=()=>true,isEditing=()=>false,now=Date.now,timers={set:(fn,ms)=>setTimeout(fn,ms),clear:id=>clearTimeout(id)}}) {
  let runtime={phase:'idle',plan:null,lastUpdated:null,nextRefreshAt:null,error:'',stale:false,nextAction:null,history:[]};
  let generation=0,timer=null,working=false,destroyed=false;
  const locked=()=>{const state=actionState();return !!(state.locked||state.busy||state.hasDraft||state.hasPending);};
  function snapshot(){return {...runtime,nextAction:livePlanAction(runtime.plan,getWorkspace(),{now:now(),locked:locked(),stale:runtime.stale})};}
  function emit(){if(!destroyed)onChange(snapshot());}
  function schedule(delay){
    timers.clear(timer);timer=null;runtime.nextRefreshAt=null;
    if(destroyed||!getWorkspace().activePlan.enabled)return;
    const wait=delay??getWorkspace().activePlan.refreshSeconds*1000;runtime.nextRefreshAt=new Date(now()+wait).toISOString();
    timer=timers.set(()=>{timer=null;if(!isVisible()||isEditing()||locked()||working){schedule();return;}void rebuild({manual:false});},wait);
  }
  async function rebuild({manual=true}={}) {
    if(destroyed||working)return null;
    if(locked()){runtime.error='Finish the current review or pending transaction before rebuilding.';emit();schedule();return null;}
    if(!manual&&(!isVisible()||isEditing())){schedule();return null;}
    const token=++generation;working=true;timers.clear(timer);runtime.nextRefreshAt=null;
    runtime.phase='refreshing';runtime.error='';runtime.stale=true;emit();
    try {
      const hasWatched=getWorkspace().portfolio.wallets.some(w=>w.address);
      if(hasWatched&&await refresh()===false)throw Error('Wallet refresh failed. The previous plan cannot authorize a step.');
      if(token!==generation||destroyed)return null;
      if(locked())throw Error('An action review started during the wallet read. Finish it before rebuilding.');
      prepareWorkspace();
      const input=activePlanInput(getWorkspace(),now());runtime.phase='calculating';emit();
      const base={generated_at:new Date(input.now).toISOString(),block_number:input.portfolio.block_number??null,settings:input.settings,scenario:input.scenario};
      const result=input.errors.length?{...base,status:'unavailable',errors:input.errors,stress:[]}:await runner.run(input);
      if(token!==generation||destroyed)return null;
      if(input.fingerprint!==activePlanFingerprint(getWorkspace()))throw Error('The farm changed during calculation. Rebuild the plan.');
      runtime.plan={...result,scope:input.scope,excludedModelPlots:input.excludedModelPlots,inputFingerprint:input.fingerprint,remainingBudgetEth:input.remainingBudgetEth};
      runtime.lastUpdated=new Date(now()).toISOString();runtime.phase='ready';runtime.stale=false;
      runtime.history=[...runtime.history,{at:runtime.lastUpdated,block_number:runtime.plan.block_number,status:result.status,policy:result.selected?.policy??null}].slice(-20);
      return runtime.plan;
    }catch(error){if(token===generation&&!destroyed&&error.name!=='AbortError'){runtime.error=error.message;runtime.phase='error';runtime.stale=true;}return null;}
    finally{if(token===generation){working=false;schedule();emit();}}
  }
  function invalidate(reason='Farm data changed. Rebuild the plan.'){
    generation++;runner.cancel();working=false;runtime.stale=true;runtime.phase='idle';runtime.error=reason;schedule();emit();
  }
  return {rebuild,snapshot,
    invalidate,
    sync({immediate=false}={}){schedule(immediate?50:undefined);emit();},
    pause(){generation++;runner.cancel();working=false;timers.clear(timer);runtime.nextRefreshAt=null;runtime.phase='paused';runtime.stale=true;emit();},
    actionChanged(){if(actionState().hasPending||(working&&locked())){generation++;runner.cancel();working=false;runtime.stale=true;}schedule();emit();},
    destroy(){destroyed=true;generation++;timers.clear(timer);runner.destroy();},
  };
}
