import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivePlanController } from '../src/active-plan-controller.js';
import { createPlanRunner } from '../src/plan-worker-client.js';
import { activePlanDefaults } from '../src/active-plan.js';
import { emptyPortfolio, defaults } from '../src/model.js';
const NOW=Date.parse('2026-09-22T12:00:00Z');
function setup(){
  let state={portfolio:emptyPortfolio(),scenario:{...defaults(),externalWeight:'1000'},activePlan:{...activePlanDefaults(),enabled:true,feeMode:'zero'}},actions={},visible=true,editing=false;
  const timers=new Map();let id=0,reads=0,runs=0,cancels=0,last;
  const runner={run:async input=>{runs++;return {status:'unavailable',generated_at:new Date(input.now).toISOString(),errors:['Add a plot'],stress:[],scenario:input.scenario};},cancel:()=>{cancels++;},destroy:()=>{}};
  const controller=createActivePlanController({getWorkspace:()=>state,refresh:async()=>{reads++;return true;},runner,actionState:()=>actions,isVisible:()=>visible,isEditing:()=>editing,now:()=>NOW,onChange:s=>{last=s;},timers:{set:fn=>{timers.set(++id,fn);return id;},clear:key=>timers.delete(key)}});
  return {controller,runner,timers,get state(){return state;},get reads(){return reads;},get runs(){return runs;},get cancels(){return cancels;},get last(){return last;},set actions(v){actions=v;},set visible(v){visible=v;},set editing(v){editing=v;},tick:async()=>{const [key,fn]=timers.entries().next().value;timers.delete(key);await fn();await new Promise(resolve=>setImmediate(resolve));}};
}
test('automatic planning pauses while hidden, editing or reviewing, and resumes without wallet access',async()=>{
  const f=setup();f.controller.sync();
  f.visible=false;await f.tick();assert.equal(f.runs,0);
  f.visible=true;f.editing=true;await f.tick();assert.equal(f.runs,0);
  f.editing=false;f.actions={hasDraft:true};await f.tick();assert.equal(f.runs,0);
  f.actions={};await f.tick();assert.equal(f.runs,1);assert.equal(f.reads,0);assert.equal(f.last.plan.scope,'model');
  f.state.activePlan.enabled=false;f.controller.pause();assert.equal(f.timers.size,0);
  f.controller.destroy();
});
test('changing inputs cancels stale asynchronous results and leaves no action authority',async()=>{
  const f=setup();let finish;
  f.runner.run=()=>new Promise(resolve=>{finish=resolve;});
  const work=f.controller.rebuild();await Promise.resolve();
  f.state.scenario.externalWeight='2000';f.controller.invalidate();
  finish({status:'ok',generated_at:new Date(NOW).toISOString()});await work;
  assert.equal(f.last.plan,null);assert.equal(f.last.stale,true);assert.ok(f.cancels>0);
  f.controller.destroy();
});
test('a review pauses monitoring without invalidating its own completed plan; pending submission invalidates it',async()=>{
  const f=setup();await f.controller.rebuild();
  f.actions={busy:true};f.controller.actionChanged();assert.equal(f.last.stale,false);
  f.actions={hasDraft:true};f.controller.actionChanged();assert.equal(f.last.stale,false);assert.equal(f.last.nextAction.status,'blocked');
  f.actions={hasPending:true};f.controller.actionChanged();assert.equal(f.last.stale,true);
  f.controller.destroy();
});
test('failed public refresh never runs the worker or keeps a prior actionable plan fresh',async()=>{
  const f=setup();f.state.portfolio.wallets[0].address='0x0000000000000000000000000000000000000001';
  let ran=false;
  const c=createActivePlanController({getWorkspace:()=>f.state,refresh:async()=>false,runner:{run:()=>{ran=true;},cancel(){},destroy(){}},now:()=>NOW,timers:{set(){},clear(){}}});
  await c.rebuild();assert.equal(ran,false);assert.equal(c.snapshot().phase,'error');assert.equal(c.snapshot().stale,true);c.destroy();
});
test('worker bridge carries BigInts, ignores wrong request IDs and frees its worker and blob',async()=>{
  let worker,disposed=0,terminated=0;
  const runner=createPlanRunner(()=>({worker:worker={postMessage(data){this.data=data;},terminate(){terminated++;}},dispose(){disposed++;}}));
  const work=runner.run({portfolio:{},scenario:{},settings:{},now:NOW});
  worker.onmessage({data:{id:99,plan:{status:'bad'}}});
  worker.onmessage({data:{id:worker.data.id,plan:{status:'ok',crop:5n}}});
  assert.deepEqual(await work,{status:'ok',crop:5n});assert.equal(disposed,1);assert.equal(terminated,1);runner.destroy();
});
test('worker cancellation and startup failures are recoverable and never return a stale result',async()=>{
  let worker;
  const runner=createPlanRunner(()=>worker={postMessage(){},terminate(){}});
  const work=runner.run({});runner.cancel();await assert.rejects(work,{name:'AbortError'});runner.destroy();
  await assert.rejects(runner.run({}),/closed/);
  const failed=createPlanRunner(()=>{throw Error('Worker blocked');});await assert.rejects(failed.run({}),/blocked/);failed.destroy();
});
