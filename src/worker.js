import { compare } from './engine.js';
import { buildGuidedPlan } from './planner.js';
self.onmessage = ({ data }) => {
  try { self.postMessage(data.mode === 'guided' ? {id:data.id,plan:buildGuidedPlan(data.portfolio,data.scenario,data.settings,data.now)} : { id: data.id, results: compare(data.portfolio, data.scenario) }); }
  catch (e) { self.postMessage({ id: data.id, error: e.message }); }
};
