import { createExecutor, validatePendingRecord } from './execution.js';
import { amount, json, clone } from './model.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const title = type => ({plant:'Plant with CROP',plant_bag:'Plant with an ETH seed bag',plant_sprouts:'Replant with ETH sprouts',upgrade:'Upgrade one level',claim:'Claim pending CROP',approve:'Approve exact CROP allowance'}[type] ?? type);

// Kept separate from forecasts: an estimate never creates spending authorization.
export function mountApproval(container,{getPortfolio,getState,reader,getProvider,storage,onRefresh=()=>{},onStateChange=()=>{},onActivity=()=>{},onConfirmed=()=>{}}) {
  let saved={pending:null,journal:[]}, error='', storageFailure='', draft=null, preparedPortfolio=null, draftValidator=null, busy=false;
  let manualType='claim', manualPlotId=null, pendingRevision=0;
  try {
    const raw=storage.get(); if(raw) {
      const parsed=JSON.parse(raw); saved.pending=validatePendingRecord(parsed.pending);
      if(!Array.isArray(parsed.journal)||parsed.journal.length>100) throw Error('Invalid action journal.');
      saved.journal=parsed.journal.filter(r=>r&&typeof r.type==='string'&&typeof r.status==='string'&&typeof r.at==='string'&&(r.hash==null||/^0x[\da-f]{64}$/i.test(r.hash)));
    }
  } catch(e) { error=`Action storage could not be loaded. Preserve its data before recovery: ${e.message}`; storageFailure=error; }
  function persist(next) {
    try {
      // A different tab must not silently erase an outstanding transaction.
      const external=storage.get();
      if(external) {
        const other=JSON.parse(external).pending;
        if(json(other??null)!==json(saved.pending??null)) throw Error('Action storage changed in another tab. Reload before proceeding.');
      }
      const pendingChanged=json(next.pending??null)!==json(saved.pending??null);
      storage.set(json(next));saved=next;
      if(pendingChanged) pendingRevision++;
    } catch(e) {
      storageFailure ||= `Action storage could not be updated. Preserve its data before recovery: ${e.message}`;
      error=storageFailure;
      throw Error(storageFailure);
    }
  }
  storageFailure ||= error;
  try {
    const imported=getState?.().pendingExecution;
    if(imported) {
      const pending=validatePendingRecord(imported);
      if(saved.pending && (saved.pending.from!==pending.from || saved.pending.nonce!==pending.nonce || saved.pending.to!==pending.to || saved.pending.data!==pending.data)) throw Error('This browser and imported workspace contain different outstanding actions. Preserve both journals and reconcile them separately.');
      if(!saved.pending && !error) persist({...saved,pending});
    }
  } catch(e) {error=`Imported action lock needs recovery: ${e.message}`;storageFailure=error;}
  const executor=createExecutor({rpc:reader.rpc,getProvider,onPending:record=>{
    if(storageFailure) throw Error(storageFailure);
    persist({...saved,pending:record});
  }});
  if(saved.pending) executor.resumePending(saved.pending);
  let observedPendingRevision=pendingRevision;
  function record(type,status,hash) {
    persist({...saved,journal:[...saved.journal,{at:new Date().toISOString(),type,status,hash:hash??null}].slice(-100)});
  }
  function getActionState() {
    const hasPending=!!executor.status().pending, hasDraft=!!draft;
    return {busy,hasDraft,hasPending,locked:busy||hasDraft||hasPending||!!storageFailure,journal:clone(saved.journal)};
  }
  function notifyActivity(type) {
    try { onActivity({type,...getActionState()}); } catch { /* Activity observers cannot interrupt wallet safety checks. */ }
  }
  const prepareBlock=()=>busy?'Another farm action is being checked.':draft?'Discard the current review before preparing another action.':executor.status().pending?'Reconcile the outstanding transaction before preparing another action.':storageFailure||'';
  async function checkPlan(validate) {
    if(typeof validate!=='function') return;
    if(await validate()===false) throw Error('The guided plan changed. Generate a fresh plan before preparing or submitting.');
  }
  async function run(fn) {
    if(busy) return {ok:false,error:'Another farm action is already being checked.'};
    const beforePendingRevision=pendingRevision;
    busy=true;error='';render();notifyActivity('busy');
    try { return {ok:true,result:await fn()}; }
    catch(e) {error=e?.message??String(e);return {ok:false,error};}
    finally {
      busy=false;render();notifyActivity('busy');
      if(pendingRevision!==beforePendingRevision) {observedPendingRevision=pendingRevision;notifyActivity('pending');}
    }
  }
  async function prepareIntent(intent,{validate}={}) {
    const blocked=prepareBlock();
    if(blocked) return {ok:false,error:blocked};
    const outcome=await run(async()=>{
      if(draft) throw Error('Discard the current review before preparing another action.');
      if(executor.status().pending) throw Error('Reconcile the outstanding transaction before preparing another action.');
      if(storageFailure) throw Error(storageFailure);
      await checkPlan(validate);
      const portfolio=clone(getPortfolio());
      if(portfolio.is_demo||portfolio.is_template) throw Error('Refresh a real public wallet before preparing an action.');
      const prepared=await executor.prepare(intent,portfolio);
      await checkPlan(validate);
      if(json(portfolio)!==json(getPortfolio())) throw Error('Holdings changed during preparation. Review a fresh transaction.');
      draft=clone(prepared);preparedPortfolio=json(portfolio);draftValidator=typeof validate==='function'?validate:null;
      return clone(draft);
    });
    return outcome.ok?{ok:true,draft:outcome.result}:{ok:false,error:outcome.error};
  }
  function render() {
    const portfolio=getPortfolio(), wallets=portfolio.wallets.filter(w=>w.address&&w.plots.length), status=executor.status(), pending=status.pending;
    const plotIds=wallets.flatMap(w=>w.plots.map(p=>p.token_id));
    const currentType=container.querySelector('[data-action-form] select[name="type"]')?.value;
    const currentPlot=container.querySelector('[data-action-form] select[name="plot"]')?.value;
    if(['claim','plant','plant_bag','plant_sprouts','upgrade'].includes(currentType)) manualType=currentType;
    if(currentPlot!=null&&plotIds.includes(Number(currentPlot))) manualPlotId=Number(currentPlot);
    if(!plotIds.includes(manualPlotId)) manualPlotId=plotIds[0]??null;
    container.innerHTML=`<style>
      .farm-approval{--action-pine:#101a0f;--action-gold:#ffd534;--action-cream:#f4edcc;--action-border:#4c5936;box-sizing:border-box;margin-top:20px;padding:24px;border:2px solid var(--action-border);border-radius:0;background:var(--action-pine);box-shadow:4px 4px 0 #080e07,inset 0 1px 0 #72804a;color:var(--action-cream);font:14px/1.5 system-ui,sans-serif}
      .farm-approval *{box-sizing:border-box}.farm-approval .approval-heading{display:flex;gap:14px;align-items:center;margin-bottom:16px}.farm-approval .approval-mark{display:grid;place-items:center;flex:none;width:42px;height:42px;border:2px solid var(--action-gold);box-shadow:3px 3px 0 #384225;color:var(--action-gold);font:bold 24px monospace;background:#263019}.farm-approval .approval-eyebrow{margin:0 0 5px;color:#c4d0a2;font-size:10px;font-weight:750;letter-spacing:.13em;text-transform:uppercase}.farm-approval h3{margin:0;font:400 18px/1.4 var(--font-display,monospace);color:var(--action-gold)}
      .farm-approval p{margin:12px 0}.farm-approval .approval-intro{color:#d1d8bc;font-size:13px}.farm-approval .approval-connection{margin:16px 0 6px;padding:10px 12px;background:#1a2515;border-left:3px solid #75884b}.farm-approval .approval-connection strong{display:block;margin-bottom:3px;color:#c9d89c;font-size:10px;font-weight:750;letter-spacing:.1em;text-transform:uppercase}.farm-approval select,.farm-approval input{width:100%;min-height:44px;padding:10px 12px;margin:7px 0 0;background:#0b140b;color:var(--action-cream);border:2px solid #506038;border-radius:0;font:14px/1.4 system-ui,sans-serif;box-shadow:inset 2px 2px 0 #070d06}
      .farm-approval label{display:block;color:#d6dec2;font-size:12px;font-weight:650}.farm-approval button{min-height:42px;cursor:pointer;padding:10px 15px;margin:12px 10px 4px 0;border-radius:0;border:2px solid #ffe669;background:var(--action-gold);box-shadow:3px 3px 0 #645015;color:#17200d;font:750 12px/1.4 system-ui,sans-serif;transition:transform .12s,box-shadow .12s}.farm-approval button:hover:not(:disabled){background:#ffe675;transform:translateY(-1px);box-shadow:3px 4px 0 #645015}.farm-approval button:active:not(:disabled){transform:translate(2px,2px);box-shadow:1px 1px 0 #645015}.farm-approval button:disabled{opacity:.45;cursor:default;box-shadow:none}.farm-approval button[data-connect],.farm-approval button[data-discard],.farm-approval button[data-export]{background:#26331c;color:var(--action-cream);border-color:#768551;box-shadow:3px 3px 0 #080e07}.farm-approval button[data-connect]:hover:not(:disabled),.farm-approval button[data-discard]:hover:not(:disabled),.farm-approval button[data-export]:hover:not(:disabled){background:#344626}.farm-approval :is(button,select,input,summary,a):focus-visible{outline:3px solid #fff2a4;outline-offset:4px}
      .farm-approval .approval-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:22px}.farm-approval .approval-review{margin-top:24px;padding-top:20px;border-top:2px solid var(--action-border)}.farm-approval .approval-review h3{font-size:15px}.farm-approval pre,.farm-approval .address{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.farm-approval pre{max-height:180px;overflow:auto;padding:12px;background:#0a1209;border:1px solid #465335;color:#c4d0a2}.farm-approval .error{padding:12px;border:1px solid #b97651;background:#342116;color:#ffd1ac}.farm-approval small{font-size:12px;color:#bac6a5}.farm-approval dl{margin:18px 0;background:#1a2515;padding:4px 14px;border:1px solid #425332}.farm-approval dl>div{display:flex;justify-content:space-between;gap:15px;padding:10px 0;border-bottom:1px solid #354529}.farm-approval dl>div:last-child{border:0}.farm-approval dt{font-size:12px;color:#c0cda9}.farm-approval dd{margin:0;overflow-wrap:anywhere;min-width:0;text-align:right;font-weight:750;font-variant-numeric:tabular-nums}.farm-approval .approval-important{padding:10px 12px;border-left:3px solid var(--action-gold);background:#282a14;font-size:13px}.farm-approval details{margin-top:18px;padding-top:12px;border-top:1px solid #3c4a30}.farm-approval summary{cursor:pointer;color:#c3d0a4;font-size:12px;font-weight:650}.farm-approval details p{font-size:12px;color:#bac6a5}.farm-approval a{color:var(--action-gold);text-underline-offset:3px}.farm-approval li{margin:10px 0;overflow-wrap:anywhere;font-size:12px}.farm-approval .approval-empty{padding:16px 0 2px;color:#bac6a5;font-size:13px}
      @media(max-width:600px){.farm-approval{padding:18px 14px}.farm-approval .approval-cols{grid-template-columns:1fr;gap:12px}.farm-approval h3{font-size:16px}.farm-approval dl>div{gap:10px}.farm-approval dt{max-width:58%}.farm-approval dd{font-size:13px}.farm-approval .approval-mark{width:36px;height:36px}.farm-approval button{max-width:100%}}@media(prefers-reduced-motion:reduce){.farm-approval button{transition:none}}
    </style>
    <section class="farm-approval" aria-label="Optional wallet actions"><div class="approval-heading"><span class="approval-mark" aria-hidden="true">↗</span><div><p class="approval-eyebrow">Your next move</p><h3>Farm actions</h3></div></div><p class="approval-intro">Choose an action, review the cost, then confirm in MetaMask.</p>
    <div class="approval-connection"><strong>${status.connected?'Wallet connected':'Connect to play'}</strong><span class="address">${status.connected?esc(status.account)+' · chain '+status.chain_id:'Choose your watched wallet in MetaMask.'}</span></div>
    ${error||storageFailure?`<p class="error" role="alert">${esc(error||storageFailure)}</p>`:''}
    <button type="button" data-connect ${busy||storageFailure?'disabled':''}>Connect MetaMask</button>${status.connected&&status.chain_id!==4663?'<button data-chain>Switch to Robinhood Chain</button>':''}
    ${wallets.length&&!portfolio.is_demo?`<form data-action-form><div class="approval-cols"><label>Action<select name="type"><option value="claim" ${manualType==='claim'?'selected':''}>Claim this wallet’s pending plots</option><option value="plant" ${manualType==='plant'?'selected':''}>Plant with 2,500 CROP</option><option value="plant_bag" ${manualType==='plant_bag'?'selected':''}>Plant with an ETH seed bag</option><option value="plant_sprouts" ${manualType==='plant_sprouts'?'selected':''}>Replant with ETH sprouts</option><option value="upgrade" ${manualType==='upgrade'?'selected':''}>Upgrade one level</option></select></label><label>Wallet and plot<select name="plot">${wallets.flatMap(w=>w.plots.map(p=>`<option value="${p.token_id}" ${p.token_id===manualPlotId?'selected':''}>${esc(w.label)} · #${p.token_id}</option>`)).join('')}</select></label></div><button type="submit" ${busy||draft||pending||storageFailure?'disabled':''}>Prepare transaction</button></form>`:'<p class="approval-empty">Add a wallet and refresh its plots to unlock farm actions.</p>'}
    ${draft?`<div class="approval-review"><p class="approval-eyebrow">Ready for your review</p><h3>${title(draft.type)}</h3><p class="address">From ${esc(draft.from)}<br>Contract ${esc(draft.to)}<br>Plots ${draft.plot_ids.map(id=>'#'+id).join(', ')}</p><dl><div><dt>CROP paid</dt><dd>${amount(draft.crop_cost_wei,4)}</dd></div><div><dt>ETH paid to the game</dt><dd>${amount(draft.value_wei??'0',8)}</dd></div>${draft.type==='approve'?`<div><dt>Exact CROP allowance</dt><dd>${amount(draft.approval_amount_wei,4)}</dd></div>`:''}<div><dt>Execution gas estimate</dt><dd>${amount(draft.network_cost_estimate_wei,10)} ETH</dd></div><div><dt>Execution gas ceiling</dt><dd>${amount(draft.network_cost_limit_wei,10)} ETH</dd></div></dl><p><small>Review expires ${esc(new Date(draft.expires_at).toISOString())}. Final network fees appear in MetaMask.</small></p>${draft.type==='approve'?'<p class="approval-important">This approves the exact CROP allowance. Planting or upgrading needs a separate review after confirmation.</p>':''}${draft.type==='plant_bag'?'<p class="approval-important">First planting only. Fixed 0.001 ETH seed bag.</p>':''}${draft.type==='plant_sprouts'?'<p class="approval-important">Fresh sprouts quote. A price change requires a new review; the contract refunds any excess if the price falls before mining.</p>':''}<details><summary>Transaction data</summary><p>Simulation passed at block ${draft.block_number}.</p><pre>${esc(draft.data)}</pre></details><button data-submit ${busy||pending||storageFailure?'disabled':''}>Request MetaMask approval</button><button data-discard ${busy?'disabled':''}>Discard review</button></div>`:''}
    ${pending?`<div class="approval-review"><p class="approval-eyebrow">Awaiting confirmation</p><h3>${title(pending.type)}</h3><p class="approval-important">Check the receipt to unlock your next action.</p>${pending.hash?`<p class="address">${esc(pending.hash)}</p>`:''}<form data-receipt>${!pending.hash?'<label>Hash from MetaMask activity<input name="hash" required></label>':''}<button type="submit" ${busy?'disabled':''}>Check transaction</button></form><details><summary>Speed-up or cancellation recovery</summary><form data-replacement><label>Replacement transaction hash<input name="hash" required></label><button type="submit" ${busy?'disabled':''}>Check replacement</button></form><p>The replacement must confirm on-chain with the same wallet nonce. A cancellation clears the lock without completing the game action.</p></details></div>`:''}
    ${saved.journal.length?`<details><summary>Action journal · ${saved.journal.length}</summary><ul>${saved.journal.slice(-10).reverse().map(r=>`<li>${esc(r.at)} · ${esc(title(r.type))} · ${esc(r.status)} ${r.hash?`<a href="https://robinhoodchain.blockscout.com/tx/${esc(r.hash)}" target="_blank" rel="noopener noreferrer">Receipt</a>`:''}</li>`).join('')}</ul><button data-export>Export action journal</button></details>`:''}<details><summary>Action settings & recovery</summary><p>Use one tab for actions. The website and plugin save separate journals. Mint and swap at <a href="https://rh.farm/" target="_blank" rel="noopener noreferrer">Yield Farm ↗</a>.</p></details></section>`;
    const on=(selector,event,fn)=>container.querySelector(selector)?.addEventListener(event,fn);
    on('[data-connect]','click',()=>run(()=>executor.connect(getPortfolio().wallets.map(w=>w.address).filter(Boolean))));
    on('[data-chain]','click',()=>run(()=>executor.switchChain()));
    on('[data-action-form]','submit',e=>{
      e.preventDefault();const form=new FormData(e.target),id=Number(form.get('plot')),type=form.get('type');
      manualType=type;manualPlotId=id;
      const portfolio=getPortfolio(),wallet=portfolio.wallets.find(w=>w.plots.some(p=>p.token_id===id));
      if(!wallet?.address||portfolio.is_demo) {error='Refresh a real public wallet before preparing an action.';render();return;}
      const intent={type,wallet_id:wallet.id,...(type==='claim'?{plot_ids:wallet.plots.filter(p=>p.pending_crop_wei!=null&&BigInt(p.pending_crop_wei)>0n).map(p=>p.token_id)}:{plot_id:id})};
      void prepareIntent(intent);
    });
    on('[data-discard]','click',()=>{draft=null;preparedPortfolio=null;draftValidator=null;render();notifyActivity('discard');});
    on('[data-submit]','click',()=>run(async()=>{
      if(storageFailure) throw Error(storageFailure);
      if(!draft) throw Error('Prepare and review an action before submitting.');
      const reviewed=draft, validator=draftValidator;
      try {
        if(preparedPortfolio!==json(getPortfolio())) throw Error('Holdings changed. Prepare a fresh transaction.');
        await checkPlan(validator);
        if(preparedPortfolio!==json(getPortfolio())) throw Error('Holdings changed. Prepare a fresh transaction.');
      } catch(e) {draft=null;preparedPortfolio=null;draftValidator=null;throw e;}
      draft=null;preparedPortfolio=null;draftValidator=null;
      try {const result=await executor.submit(reviewed.id);record(reviewed.type,'pending',result.hash);}
      catch(e){if(!storageFailure) try {record(reviewed.type,executor.status().pending?'unknown':'rejected',executor.status().pending?.hash);} catch {} throw e;}
    }));
    const settle=(replacement,e)=>{
      e.preventDefault();const hash=new FormData(e.target).get('hash')?.trim()||executor.status().pending?.hash;
      return run(async()=>{const old=executor.status().pending;const result=await (replacement?executor.replacementReceipt(hash):executor.receipt(hash));
        if(result.status==='pending') {error='The transaction is still pending. The lock remains.';return;}
        record(old.type,result.status,result.hash);draft=null;preparedPortfolio=null;draftValidator=null;
        const imported=getState?.().pendingExecution;
        if(imported && imported.from===old.from && imported.nonce===old.nonce && imported.to===old.to && imported.data===old.data) {getState().pendingExecution=null;onStateChange();}
        try {
          if(result.status==='confirmed') {
            const wallet=getPortfolio().wallets.find(candidate=>candidate.address&&candidate.address.toLowerCase()===old.from.toLowerCase());
            if(wallet) await onConfirmed({type:old.type,wallet_id:wallet.id,from:old.from,at:new Date().toISOString(),hash:result.hash??old.hash});
          }
        } finally { await onRefresh(); }
      });
    };
    on('[data-receipt]','submit',e=>settle(false,e));on('[data-replacement]','submit',e=>settle(true,e));
    on('[data-export]','click',()=>{const url=URL.createObjectURL(new Blob([json(saved)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='farm-actions.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  }
  render();return {refresh:()=>{
    if(busy) return;
    const beforePendingRevision=observedPendingRevision;
    try {
      const imported=getState?.().pendingExecution;
      if(imported&&!storageFailure) {
        const pending=validatePendingRecord(imported), existing=executor.status().pending;
        if(existing&&(existing.from!==pending.from||existing.nonce!==pending.nonce||existing.to!==pending.to||existing.data!==pending.data)) throw Error('The imported workspace and this browser have different outstanding actions. Preserve both journals and reconcile them separately.');
        if(!existing) {persist({...saved,pending});executor.resumePending(pending);}
      }
    } catch(e) {storageFailure=`Imported action lock needs recovery: ${e.message}`;}
    render();
    if(pendingRevision!==beforePendingRevision) {observedPendingRevision=pendingRevision;notifyActivity('pending');}
  },hasPending:()=>!!executor.status().pending,prepareIntent,getActionState,destroy:()=>container.replaceChildren()};
}
