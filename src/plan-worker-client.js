export function createPlanRunner(workerFactory,{timeoutMs=120000}={}) {
  let active=null,sequence=0,destroyed=false;
  function cancel(){if(active){const error=new Error('Plan calculation cancelled.');error.name='AbortError';active.finish(error);}}
  return {
    run(input){
      cancel();if(destroyed)return Promise.reject(new Error('The planner has closed.'));
      return new Promise((resolve,reject)=>{
        const id=++sequence;let handle,timer;
        const finish=(error,plan)=>{clearTimeout(timer);handle?.worker?.terminate();handle?.dispose?.();if(active?.id===id)active=null;error?reject(error):resolve(plan);};
        try {
          const created=workerFactory();handle=created.worker?created:{worker:created};
          active={id,finish};timer=setTimeout(()=>finish(new Error('This calculation exceeded two minutes. Try a shorter horizon or smaller model farm.')),timeoutMs);
          handle.worker.onmessage=({data})=>{if(data.id!==id)return;data.error?finish(new Error(data.error)):finish(null,data.plan);};
          handle.worker.onerror=()=>finish(new Error('The browser could not run the local planner. Reload the companion and try again.'));
          handle.worker.postMessage({id,mode:'guided',portfolio:input.portfolio,scenario:input.scenario,settings:input.settings,now:input.now});
        }catch(error){finish(error);}
      });
    },cancel,destroy(){destroyed=true;cancel();},
  };
}
