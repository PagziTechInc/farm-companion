import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildGuidedPlan, planDefaults, validatePlanSettings } from '../src/planner.js';
import { compare } from '../src/engine.js';
import { analyzeFarm } from '../src/calculator.js';
import { createReader } from '../src/reader.js';
import { defaults, demoPortfolio, json, validatePortfolio, validateScenario, amount } from '../src/model.js';
import manifest from '../knowledge/snapshots/manifest-2026-09-07.json' with { type: 'json' };

const args = process.argv.slice(2), value = key => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : null; };
if (args.includes('--help') || !args.includes('--demo') && !value('--workspace')) {
  console.log('Usage: npm run analyze -- --workspace exported-workspace.json [--refresh] [--output report.json]\n       npm run analyze -- --demo [--output report.json]\n       npm run monitor -- --workspace exported-workspace.json --output latest.json [--interval 30]\nAll network operations are public reads. Forecasts use the workspace assumptions.');
  process.exit(args.includes('--help') ? 0 : 1);
}
const watch = args.includes('--watch'), interval = Number(value('--interval') ?? 30);
if (watch && (!Number.isFinite(interval) || interval < 30 || interval > 3600 || !value('--output') || args.includes('--demo'))) throw new Error('Monitoring requires a real workspace, an output path and an interval of 30–3600 seconds.');
let stopped = false;
process.on('SIGINT', () => { stopped = true; });
process.on('SIGTERM', () => { stopped = true; });
const reader = createReader(undefined, manifest.map(row => row.tier));
async function run() {
  const input = args.includes('--demo') ? demoPortfolio() : JSON.parse(await readFile(value('--workspace'), 'utf8'));
  if (!input.portfolio || !input.scenario) throw new Error('Use a workspace exported by the dashboard, containing portfolio and scenario.');
  const scenario = { ...defaults(), ...input.scenario };
  let portfolio = input.portfolio;
  const shapeErrors = validatePortfolio(portfolio, false); if (shapeErrors.length) throw new Error(shapeErrors.join(' '));
  if (watch || args.includes('--refresh')) {
    const watched=portfolio.wallets.filter(w=>w.address);
    if(!watched.length) throw new Error('A public refresh needs at least one watched wallet address.');
    const observed=await reader.snapshot({...portfolio,wallets:watched});
    portfolio={...observed,wallets:portfolio.wallets.map(w=>w.address?observed.wallets.find(o=>o.id===w.id):w)};
    portfolio.expected_total_plots=portfolio.wallets.reduce((count,w)=>count+w.plots.length,0);
  }
  const errors = [...validatePortfolio(portfolio), ...validateScenario(scenario)];
  const results = errors.length ? [{ status: 'unavailable', errors }] : compare(portfolio, scenario);
  const guided_plan = buildGuidedPlan(portfolio, scenario, validatePlanSettings(input.planSettings ?? planDefaults()));
  const analysis=analyzeFarm(portfolio,scenario,{days:input.days??90});
  const report = { analysis, guided_plan, schema_version: 2, generated_at: new Date().toISOString(), portfolio, scenario, results };
  const out = value('--output');
  if (out) { await mkdir(dirname(out), { recursive: true }); await writeFile(out + '.tmp', json(report) + '\n'); await rename(out + '.tmp', out); }
  if (!watch && !out) console.log(json(report));
  else {
    console.log(`${report.generated_at} · ${portfolio.is_demo ? 'FICTIONAL DEMO' : 'portfolio'} · ${out} · block ${portfolio.block_number ?? 'manual'}`);
    console.log(`Guided next step: ${guided_plan.insights?.next_action?.why ?? 'Complete the planning inputs.'}`);
    for (const r of results) console.log(r.status === 'ok' ? `${r.days}d ${r.funding}: best net CROP ${amount(r.bestCrop.net_crop_wei)}, operating ETH ${amount(r.bestEth?.operating_eth_wei, 6)}` : `Unavailable: ${r.errors.join('; ')}`);
  }
  return analysis.status!=='ok'&&results.every(r => r.status === 'unavailable') ? 2 : 0;
}
do {
  try { process.exitCode = await run(); } catch (e) { console.error(e.message); process.exitCode = 1; }
  if (watch && !stopped) await new Promise(resolve => {
    const done = () => { clearTimeout(timer); process.removeListener('SIGINT', done); process.removeListener('SIGTERM', done); resolve(); };
    const timer = setTimeout(done, interval * 1000);
    process.once('SIGINT', done); process.once('SIGTERM', done);
  });
} while (watch && !stopped);
