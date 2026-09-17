const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

// Artwork is an independent viewer. It has no portfolio, account or transaction access.
export function createPlotStudio(container, { reader, rehearsalReader, onTheme=()=>{}, isSelected=()=>false, onOpen=()=>{}, onClose=()=>{} }) {
  const readers = { production: reader, rehearsal: rehearsalReader };
  let current=null, request=0, trigger=null, destroyed=false, frameObserver=null;
  const focusables=()=>[...container.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled)')];
  const sourceName=environment=>environment==='production'?'Production':'Rehearsal';
  function close() {
    request++;current=null;frameObserver?.disconnect();frameObserver=null;container.replaceChildren();onClose();
    if(trigger?.isConnected)trigger.focus();
  }
  function render(focus=true) {
    if(!current||destroyed)return;
    frameObserver?.disconnect();frameObserver=null;
    const {id,environment,asset,loading,error,waitingForReveal,playing}=current;
    const label=sourceName(environment),active=container.getRootNode().activeElement,activeId=container.contains(active)?active.id:null;
    const draft=container.querySelector('[name=token]')?.value,wasToken=active?.name==='token';
    const selected=asset?Boolean(isSelected(asset)):false;
    const sourceOptions=`<option value="production" ${environment==='production'?'selected':''}>Production</option><option value="rehearsal" ${environment==='rehearsal'?'selected':''} ${readers.rehearsal?'':'disabled'}>Rehearsal</option>`;
    container.innerHTML=`<div class="dialog-backdrop"><section class="dialog plot-studio" role="dialog" aria-modal="true" aria-labelledby="studio-title"><div class="row spread"><div><div class="eyebrow">The plot studio · ${label.toLowerCase()}</div><h2 id="studio-title">Plot #${id}</h2></div><button class="quiet" id="studio-close" aria-label="Close plot studio">✕</button></div><form id="studio-jump" class="studio-nav"><button type="button" id="studio-previous" aria-label="Previous plot" ${id<=1?'disabled':''}>←</button><label>Plot number<input name="token" type="number" min="1" max="3333" step="1" required value="${id}"></label><button>View plot</button><button type="button" id="studio-next" aria-label="Next plot" ${id>=3333?'disabled':''}>→</button></form><div class="studio-source"><label for="studio-source">Artwork source</label><select id="studio-source" aria-label="Artwork source">${sourceOptions}</select></div>${loading?'<p class="notice" role="status">Opening the farm gate…</p>':''}${waitingForReveal?'<p class="notice" role="status">Waiting for reveal. Production art will appear after this plot is revealed. <button class="quiet" id="studio-retry">Check again</button></p>':''}${error?`<div class="notice error" role="alert">${escape(error)} <button class="quiet" id="studio-retry">Retry artwork</button></div>`:''}${asset?`<div class="studio-grid"><div><div class="studio-stage">${playing?`<iframe title="Animated ${label.toLowerCase()} plot #${id}" src="${escape(asset.animation_url)}" sandbox="allow-scripts" referrerpolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; clipboard-read 'none'; clipboard-write 'none'"></iframe>`:`<img id="studio-image" src="${escape(asset.image_url)}" alt="${label} artwork for plot #${id}" width="560" height="560" referrerpolicy="no-referrer">`}<span class="art-note" id="studio-art-note">${label.toUpperCase()} #${id}</span></div><div class="actions studio-playback"><button type="button" id="studio-play">${playing?'Pause animation':'Play animation'}</button></div><p id="studio-image-note" class="small muted">${playing?'Playing the game’s isolated scene. Pause to stop it.':'Press play to bring this plot to life.'}</p></div><div class="studio-details"><h3>${escape(asset.name)}</h3><dl class="studio-traits">${asset.traits.map(t=>`<div><dt>${escape(t.name)}</dt><dd>${escape(t.value)}</dd></div>`).join('')}</dl><button class="primary" id="studio-theme" aria-pressed="${selected}">${selected?'✓ Your companion theme':'Use this plot’s theme'}</button><p class="rule-note">${environment==='production'?'Production art and traits are display only. Live status and artwork do not change farm calculations.':'Rehearsal art and traits are examples. Your farm’s holdings and calculations stay the same.'}</p><button class="quiet" id="studio-refresh-art">Refresh artwork</button><a class="small" href="${escape(asset.metadata_url)}" target="_blank" rel="noopener noreferrer">Asset details ↗</a></div></div>`:''}</section></div>`;
    const frame=container.querySelector('.studio-stage iframe'),stage=container.querySelector('.studio-stage');
    if(frame){
      // The official scene clips its footer in narrow viewports. Keep its own
      // viewport square at 560px and scale the whole isolated document to fit.
      Object.assign(frame.style,{position:'absolute',width:'560px',height:'560px',transformOrigin:'0 0'});
      const fit=width=>{frame.style.transform=`scale(${width/560})`;};fit(stage.clientWidth);
      frameObserver=new ResizeObserver(entries=>fit(entries[0].contentRect.width));frameObserver.observe(stage);
    }
    container.querySelector('#studio-close').onclick=close;
    container.querySelector('#studio-previous').onclick=()=>load(id-1,false,environment);
    container.querySelector('#studio-next').onclick=()=>load(id+1,false,environment);
    container.querySelector('#studio-jump').onsubmit=event=>{event.preventDefault();load(Number(new FormData(event.target).get('token')),false,environment);};
    container.querySelector('#studio-source').onchange=event=>{
      const next=event.currentTarget.value;
      if(next!==environment)void load(id,false,next,false);
    };
    container.querySelector('#studio-retry')?.addEventListener('click',()=>load(id,true,environment));
    container.querySelector('#studio-refresh-art')?.addEventListener('click',()=>load(id,true,environment));
    container.querySelector('#studio-play')?.addEventListener('click',()=>{current.playing=!current.playing;render(false);container.querySelector('#studio-play').focus();});
    container.querySelector('#studio-theme')?.addEventListener('click',()=>{
      onTheme(asset);const button=container.querySelector('#studio-theme');button.textContent='✓ Your companion theme';button.setAttribute('aria-pressed','true');
    });
    container.querySelector('#studio-image')?.addEventListener('error',event=>{
      event.target.hidden=true;
      container.querySelector('#studio-image-note').textContent=`${label} image unavailable. Refresh the artwork or open its animation.`;
      container.querySelector('#studio-art-note').textContent=`${label.toUpperCase()} IMAGE UNAVAILABLE`;
    },{once:true});
    if(!focus&&draft!=null)container.querySelector('[name=token]').value=draft;
    if(focus)container.querySelector('#studio-close').focus();
    else if(wasToken)container.querySelector('[name=token]').focus();
    else if(activeId)container.querySelector(`#${activeId}`)?.focus();
  }
  async function load(id,force=false,environment=current?.environment??'production',focus=true) {
    if(!Number.isInteger(id)||id<1||id>3333)return;
    if(environment!=='production'&&environment!=='rehearsal')return;
    const sequence=++request;current={id,environment,asset:null,loading:true,error:'',waitingForReveal:false,playing:false};render(focus);
    const selectedReader=readers[environment];
    try {
      if(!selectedReader)throw new Error(`${sourceName(environment)} artwork is unavailable.`);
      const asset=await selectedReader.read(id,{force});if(sequence!==request||destroyed)return;
      if(asset.environment!==environment)throw new Error('Artwork source did not match the selected environment.');
      current.asset=asset;
    } catch(error) {
      if(sequence!==request||destroyed)return;
      if(error?.code==='ASSET_UNREVEALED')current.waitingForReveal=true;
      else current.error=`Artwork could not be loaded. ${error.message}`;
    }
    current.loading=false;render(false);
  }
  container.addEventListener('keydown',event=>{
    if(!current)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
    else if(event.key==='Tab'){
      const list=focusables(),active=container.getRootNode().activeElement;
      if(event.shiftKey&&active===list[0]){event.preventDefault();list.at(-1)?.focus();}
      else if(!event.shiftKey&&active===list.at(-1)){event.preventDefault();list[0]?.focus();}
    }
  });
  return {
    open(id=331,element,environment='production') { trigger=element;onOpen();void load(id,false,environment); },
    close,
    destroy(){destroyed=true;close();},
  };
}
