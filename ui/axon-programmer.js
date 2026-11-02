'use strict';
// Setup & Calibrate → Axon Programmer: programs Axon servos through Axon's own V2 programmer, laid out like the Axon Bridge app:
// status chips on top, then the servo and its mode, its settings beside what it reports, and one line saying what happens
// next above the Apply button. USB and every decision about what reaches a servo live in the main process
// (src/axon-programmer.cjs); this page draws what it reports and sends back what the student asked for.
// Simple shows exactly what Axon's software edits. Advanced adds only what was confirmed.
window.DeckAxon=(()=>{
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let root=null,api=null,shown=false,level='simple',snap=null,pending={},target=null,picked=null,result=null,ask=null,error='',formEpoch=0,formSig='',traceTimer=null,lastServoKey='',pointing='';
  const previews=new Map(),MODE={servo:'servo mode',cr:'continuous rotation'},cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
  // How a raw number reads to a person. Whole percents where the raw value lands on one, so 168 reads 66%.
  const pct=raw=>{const p=raw*100/255,whole=Math.round(p);return Math.round(whole*2.55)===raw?`${whole}%`:`${p.toFixed(1)}%`;};
  const FORMAT={plain:r=>String(r),pct,signedUs:r=>`${r>0?'+':''}${r} µs`,tenth:r=>`${(r*0.1).toFixed(1)} s`,olV1:r=>`${(r*0.102).toFixed(1)} s`,olV2:r=>`${(r*0.077).toFixed(1)} s`,angle:r=>`${r} (${Math.round(r*355/255)}°)`,level:r=>`Level ${r}`};
  const show=(f,v)=>v===undefined?'':f.kind==='switch'?(v?'On':'Off'):f.kind==='choice'?f.options[v]:f.kind==='text'?(v||'(empty)'):FORMAT[f.format](v);
  const axon=(action,data)=>api.axon(action,data);
  const $=id=>root.querySelector('#'+id);
  const busy=()=>!!snap?.busy,servo=()=>snap?.servo||{},settings=()=>snap?.settings||null,models=()=>snap?.models||[];
  const visible=f=>!f.advanced||level==='advanced';
  const modeNow=()=>servo().present&&servo().mode!=='unknown'?servo().mode:null;
  const wanted=()=>target||modeNow()||'servo';
  const switching=()=>!!modeNow()&&wanted()!==modeNow();
  const detected=()=>servo().model?.code||null;
  // The servo Torque is sure of, or the one picked. With nothing plugged in it is what the page previews and what Recover writes.
  const modelCode=()=>detected()||picked;
  const chosenModel=()=>modelCode()||models().find(m=>m.family===servo().family)?.code||'max1';
  const modelTitle=code=>models().find(m=>m.code===code)?.title||'servo';
  const unknownName=()=>{const s=servo();return s.present&&s.family!=='unknown'&&!s.model&&!s.name;};
  const changeList=()=>{const st=settings();return st&&!switching()?Object.entries(pending).map(([key,value])=>({field:st.schema.fields.find(f=>f.key===key),value})).filter(c=>c.field):[];};
  const rows=list=>`<dl class="axon-rows">${list.filter(Boolean).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  const setHtml=(id,html)=>{const box=$(id);if(!box||box.dataset.html===html)return;const focus=document.activeElement?.id;box.dataset.html=html;box.innerHTML=html;const again=focus&&document.getElementById(focus);if(again&&box.contains(again))again.focus();};
  const setFill=r=>r.style.setProperty('--fill',`${(+r.value-+r.min)/Math.max(1,+r.max-+r.min)*100}%`);

  // ---- the one line that says what is going on and what comes next
  function gate(){
    const p=snap?.programmer,s=servo(),b=snap?.busy,n=changeList().length;
    if(!api)return {tone:'warn',main:'Programming Axon servos needs the installed app',sub:''};
    if(!snap)return {tone:'wait',main:'Starting...',sub:''};
    if(b)return {tone:'busy',main:b.text,sub:b.kind==='flash'?'Keep the servo and programmer plugged in.':'',percent:b.percent};
    if(error)return {tone:'bad',main:error,sub:''};
    if(!snap.supported)return {tone:'warn',main:'This computer cannot reach the programmer',sub:'Programming Axon servos works on Windows for now.'};
    if(p.error)return {tone:'bad',main:'Torque could not reach USB',sub:`${p.error} Antivirus can block the small helper Torque uses for this. Restart Torque, and if this stays, tell your mentor.`};
    if(p.rivals.length)return {tone:'warn',main:`${p.rivals.join(' and ')} is open`,sub:'It talks to the same programmer, and two apps at once corrupt each other. Torque waits until it closes.',closeRivals:true};
    if(!p.ready){
      if(p.v1Seen)return {tone:'warn',main:'That is the old V1 programmer',sub:'Torque works only through the V2 programmer. Plug that one in instead.'};
      if(p.bootSeen)return {tone:'warn',main:'The programmer is in its own update mode',sub:'Unplug it and plug it back in.'};
      if(p.handshakeFailed)return {tone:'bad',main:'The programmer is not answering',sub:'Unplug it and plug it back in. Make sure the USB cable carries data, not just charge.'};
      return {tone:'wait',main:'Plug in the V2 programmer',sub:'Use a USB cable that carries data. USB-C powers the programmer and the servo, so no battery is needed.'};}
    if(!s.present)return {tone:'wait',main:'Plug a servo into the V2 programmer',sub:'Top row of pins on the left, grey signal wire on the right. If a V1 servo is in and this stays here, the programmer is not passing it along.'};
    if(s.family==='unknown')return {tone:'bad',main:'Torque does not know this servo',sub:`It answered ${s.firmware}, which neither Axon app knows. Nothing will be written.`};
    if(switching()){
      if(!modelCode())return {tone:'warn',main:'Pick which servo this is',sub:'Torque could not read its name, and it needs the right firmware. Pick it under 1 Servo.'};
      return {tone:'warn',main:`Ready to switch to ${MODE[wanted()]}`,sub:'Writes Axon\'s official firmware. It takes about a minute. Do not unplug anything.',ready:true,flash:true};}
    if(!s.editable)return {tone:'warn',main:'This servo can be switched, but its settings cannot be edited',sub:'Axon\'s V1 app has no settings layout for this variant either.'};
    if(!settings())return {tone:'busy',main:'Reading the servo...',sub:'If this does not clear, press Read. The details are under What happened.'};
    if(result&&!result.ok)return {tone:'bad',main:'It did not take',sub:result.message,ready:n>0};
    if(n)return {tone:'good',main:`Ready to write ${n} ${n===1?'change':'changes'} to the servo`,sub:'Torque reads it back after writing, and shows what the servo reports.',ready:true};
    if(result)return {tone:'good',main:'Confirmed',sub:result.message};
    return {tone:'good',main:`${s.model?s.model.title:'This servo'} is ready`,sub:'Change a setting or switch mode, then press Apply.'};
  }
  function renderBar(){
    const g=gate(),apply=$('axon-apply'),discard=$('axon-discard');
    setHtml('axon-banner',`<strong>${esc(g.main)}</strong>${g.sub?`<span>${esc(g.sub)}</span>`:''}${g.percent!==null&&g.percent!==undefined?`<progress id="axon-progress" max="100" value="${g.percent}" aria-label="Progress"></progress>`:''}${g.closeRivals?'<button id="axon-close-rivals" class="secondary" type="button" data-axon="close-rivals">Close it</button>':''}`);
    $('axon-banner').dataset.tone=g.tone;
    apply.disabled=!g.ready;apply.textContent=g.flash?'Switch mode':changeList().length?`Apply ${changeList().length} ${changeList().length===1?'change':'changes'}`:'Apply';
    discard.hidden=!(changeList().length||switching())||busy();
  }
  function renderChips(){
    const p=snap?.programmer,s=servo(),t=snap?.telemetry;
    const chip=(tone,text)=>`<span class="axon-chip" data-tone="${tone}"><i aria-hidden="true"></i>${esc(text)}</span>`;
    const one=!p?chip('wait','No V2 programmer'):p.rivals?.length?chip('warn','Paused for another app'):p.ready?chip('good','V2 programmer'):p.v1Seen?chip('warn','V1 programmer: not usable'):p.handshakeFailed?chip('bad','Programmer not answering'):chip('wait','No V2 programmer');
    const two=s.present&&s.family!=='unknown'?chip('good',`${s.family.toUpperCase()} servo · ${s.mode==='cr'?'CR mode':'servo mode'}`):s.present?chip('bad','Unknown servo'):chip('wait','No servo');
    const three=t?chip(t.powerAlarm||t.volts>9.1?'bad':t.powerOn?'good':'warn',`${t.volts.toFixed(1)} V · ${t.amps.toFixed(1)} A`):chip('wait','-- V');
    setHtml('axon-chips',one+two+three);
  }
  function renderCards(){
    const s=servo(),here=detected(),chosen=chosenModel();
    setHtml('axon-models',models().map(m=>{const off=busy()||(here&&m.code!==here)||(s.present&&m.family!==s.family);
      return `<button id="axon-model-${m.code}" type="button" class="axon-card" data-axon="model" data-code="${m.code}" aria-pressed="${chosen===m.code}"${off?' disabled':''}><strong>${esc(m.title)}</strong><span${here===m.code?' data-good':''}>${here===m.code?'Plugged in':`sold as ${esc(m.sold)}`}</span></button>`;}).join(''));
    const now=modeNow(),locked=busy()||(s.present&&s.family==='unknown')||(s.present&&!s.model&&!!s.name);
    const mode=(key,title,text)=>`<button id="axon-mode-${key}" type="button" class="axon-card" data-axon="mode" data-mode="${key}" aria-pressed="${wanted()===key}"${locked?' disabled':''}><strong>${title}${now===key?' <em>Now</em>':''}</strong><span>${text}</span></button>`;
    setHtml('axon-modes',mode('servo','Servo Mode','Moves to and holds a position')+mode('cr','CR Mode','Continuous rotation'));
  }

  // ---- settings. The rows are rebuilt only when what they show changes from outside, so polling never moves a control under a finger.
  function panel(){
    const st=settings(),s=servo(),code=chosenModel();
    if(st&&st.schema.mode===wanted())return {kind:'live',...st};
    if(switching())return {kind:'switch'};
    if(s.present&&!s.editable&&s.family!=='unknown')return {kind:'none',text:'This servo\'s settings cannot be edited, but its mode can be switched.'};
    const key=`${code}/${wanted()}`;if(shown&&!previews.has(key)&&api){previews.set(key,null);void axon('preview',{code,mode:wanted()}).then(p=>{previews.set(key,p);render();},()=>previews.delete(key));}
    const p=previews.get(key);return p?{kind:'preview',schema:p.schema,values:p.values,factory:p.values}:{kind:'none',text:''};
  }
  function fieldRow(f,p,edit){
    const id=`axon-f-${f.key}`,value=p.kind==='live'?(pending[f.key]??p.values[f.key]):p.values[f.key],off=edit?'':' disabled';let control;
    if(f.kind==='switch')control=`<label class="axon-toggle" for="${id}"><input id="${id}" type="checkbox" data-axon-key="${f.key}" aria-label="${esc(f.label)}"${value?' checked':''}${off}><span>${value?'On':'Off'}</span></label>`;
    else if(f.kind==='text')control=`<input id="${id}" class="axon-text" type="text" maxlength="12" spellcheck="false" data-axon-key="${f.key}" aria-label="${esc(f.label)}" value="${esc(value)}"${off}>`;
    else if(f.kind==='choice')control=`<div id="${id}" class="segmented axon-seg" role="group" aria-label="${esc(f.label)}" data-count="${f.options.length}">${f.options.map((t,i)=>`<button type="button" data-axon-seg="${f.key}" data-value="${i}" aria-pressed="${i===value}"${off}>${esc(t)}</button>`).join('')}</div>`;
    else control=`<button type="button" class="axon-nudge" data-axon-nudge="-1" data-for="${id}" aria-label="Lower ${esc(f.label)}"${off}>−</button><input id="${id}" class="num-slider axon-slider" type="range" min="${f.min}" max="${f.max}" step="1" value="${value}" data-axon-key="${f.key}" aria-label="${esc(f.label)}"${off}><button type="button" class="axon-nudge" data-axon-nudge="1" data-for="${id}" aria-label="Raise ${esc(f.label)}"${off}>+</button><output id="axon-v-${f.key}">${esc(show(f,value))}</output>`;
    const small=level==='advanced'&&p.factory&&f.key in p.factory?`Factory: ${show(f,p.factory[f.key])}`:f.short;
    return `<div class="axon-row" data-axon-field="${f.key}" data-kind="${f.kind}"><div class="axon-row-label"><label${f.kind==='choice'?'':` for="${id}"`}><i data-axon-mark${p.kind==='live'&&pending[f.key]!==undefined?'':' hidden'}></i>${esc(f.label)}</label><small>${esc(small)}</small></div><div class="axon-row-control">${control}</div></div>`;
  }
  function renderSettings(){
    const p=panel(),box=$('axon-settings'),s=servo(),edit=p.kind==='live'&&!busy();
    const title=p.schema?.title||(p.kind==='switch'?`Switch to ${MODE[wanted()]}`:'');$('axon-settings-title').textContent=title;
    const tag=$('axon-tag');tag.textContent=p.kind==='live'?'Live values from the servo':p.kind==='switch'?'':s.present?'Factory values, preview only':p.kind==='preview'?'Factory values: plug in a servo to edit':'';tag.toggleAttribute('data-good',p.kind==='live');
    const sig=JSON.stringify([p.kind,p.text,p.schema?.title,p.values,p.factory,level,formEpoch,busy(),wanted(),chosenModel()]);if(sig===formSig)return;formSig=sig;
    if(p.kind==='switch'){box.innerHTML=`<div class="axon-switch-note"><h4>Switch to ${esc(MODE[wanted()])}</h4><p>Press Switch mode and this ${esc(modelCode()?modelTitle(modelCode()):'servo')} gets Axon's official firmware for that mode. Its settings go back to Axon's factory values for that mode, and they load here once it restarts.</p></div>`;return;}
    if(p.kind==='none'){box.innerHTML=p.text?`<div class="axon-switch-note"><p>${esc(p.text)}</p></div>`:'';return;}
    const fields=p.schema.fields.filter(visible),column=right=>{const list=fields.filter(f=>(f.group==='Overload protection'||f.key==='name')===right);let last=null,html='';
      for(const f of list){if(f.group&&f.group!==last)html+=`<h4 class="axon-group"><span>${esc(f.group)}</span></h4>`;last=f.group;html+=fieldRow(f,p,edit);}return html;};
    box.innerHTML=`<div class="axon-column">${column(false)}</div><div class="axon-column">${column(true)}</div>`;
    for(const r of box.querySelectorAll('input[type=range]'))setFill(r);
  }
  function renderHint(){
    $('axon-hint').textContent=pointing||(level==='advanced'?'Advanced adds what Torque could confirm from Axon\'s firmware, and all that the servo and programmer report. Point at a setting to see what it does. A dot marks a change not applied yet.':'Simple shows exactly what Axon\'s own software edits. Point at a setting to see what it does. A dot marks a change not applied yet.');
  }

  // ---- what the servo and programmer report, and what happened
  function renderSide(){
    const p=snap?.programmer,t=snap?.telemetry,s=servo(),adv=level==='advanced',info=p?.info,hex=v=>`0x${Number(v).toString(16).toUpperCase().padStart(2,'0')}`,st=settings();
    const signal=t&&(t.inputValid&&t.inputPeriod?`${t.inputPulse} µs, ${Math.round(1e6/t.inputPeriod)} Hz`:'None');
    setHtml('axon-report',rows([
      ['Name',s.present?(s.name||(st?'(not reported)':'(not read yet)')):'-'],['Firmware',s.present?s.firmware||'-':'-'],['Made',s.made||'-'],['Mode',s.present&&s.mode!=='unknown'?cap(MODE[s.mode]):'-'],
      ['Link',s.family==='v1'?'V1 servo through V2 programmer':s.family==='v2'?'V2 servo through V2 programmer':'-']])+
      (s.family==='v1'?'<p class="axon-note">Axon says V1 servos do not work on the V2 programmer. Torque speaks to them anyway, but this is not proven on a real V1 servo yet.</p>':'')+
      `<h4 class="axon-side-title">V2 programmer</h4>`+rows([['Device',p?.ready?info?.product||'HID device':'-'],['Power',t?`${t.volts.toFixed(2)} V, ${t.amps.toFixed(2)} A`:'-'],['Servo pins',t?(t.powerAlarm?'Alarm: off':t.powerOn?'On':'Off'):'-'],['Pulse out',t?`${t.outputPulse} µs`:'-'],['Signal in',signal||'-'],
        ...(adv?[info&&['Maker',info.maker||'Not reported'],info&&['Serial number',info.serial||'Not reported'],info&&['USB IDs',`VID ${hex(info.vid)} PID ${hex(info.pid)}, version ${hex(info.version)}`],info&&['Report size',`${info.inLen} in, ${info.outLen} out`],t&&['Low return',t.lowReturn?'On':'Off'],t&&['Source byte',String(t.source)],t&&['Power byte',String(t.powerState)],p?.hello&&['Handshake reply',p.hello],t&&['Status report',t.raw]]:[])]));
    const idle=!busy()&&!!p?.ready,live=!!st&&!switching();
    const able={'axon-read':idle&&!!s.editable,'axon-defaults':idle&&live,'axon-open-file':!busy()&&live,'axon-save-file':!busy()&&live,'axon-recover-go':idle&&!s.present};
    for(const [id,on] of Object.entries(able))$(id).disabled=!on;$('axon-recover-go').hidden=!adv;
    setHtml('axon-result',result?.confirmed?.length?`<table class="axon-table"><thead><tr><th scope="col">Setting</th><th scope="col">You asked</th><th scope="col">Servo reports</th><th scope="col">Took</th></tr></thead><tbody>${result.confirmed.map(c=>`<tr><th scope="row">${esc(c.label)}</th><td>${esc(show(c.field,c.asked))}</td><td>${esc(show(c.field,c.now))}</td><td data-took="${c.took}">${c.took?'Yes':'No'}</td></tr>`).join('')}</tbody></table>`:result?`<p class="axon-result-line" data-ok="${!!result.ok}">${esc(result.message)}</p>`:'');
    setHtml('axon-log',(snap?.log||[]).length?`<ol class="axon-log">${snap.log.slice(-14).reverse().map(l=>`<li data-tone="${l.tone}">${esc(l.text)}</li>`).join('')}</ol>`:'<p class="hint">Nothing yet.</p>');
    $('axon-advanced').hidden=!adv;
    if(adv){const diff=st?.factory?st.schema.fields.filter(f=>f.key in st.factory&&st.factory[f.key]!==st.values[f.key]):[];
      setHtml('axon-more',(st?.factory?`<h4 class="axon-side-title">Different from Axon's factory values</h4>${diff.length?rows(diff.map(f=>[f.label,`${show(f,st.values[f.key])} (factory ${show(f,st.factory[f.key])})`])):'<p class="hint">Nothing: this servo is at its factory values.</p>'}`:'')+
        (s.present?`<h4 class="axon-side-title">Status bytes</h4>${rows([['Reply',`${hex(s.type)} ${hex(s.b6)} ${hex(s.b7)} ${hex(s.b8)}`],s.validLen&&['Settings bytes read',String(s.validLen)]])}`:'')+
        (s.unconfirmed?.length?`<h4 class="axon-side-title">Reported, never changed</h4>${s.unconfirmed.map(u=>`<p class="hint"><strong>${esc(u.name)}: ${u.value}.</strong> ${esc(u.why)}</p>`).join('')}`:'')+
        (s.raw?`<h4 class="axon-side-title">Every settings byte</h4><pre class="axon-bytes" tabindex="0">${esc(s.raw)}</pre>`:''));}
  }
  function syncAsk(){
    const box=$('axon-ask');if(!ask){if(box.open)box.close();box.dataset.for='';return;}
    const key=ask.text+ask.buttons.map(b=>b[0]).join();if(box.dataset.for===key&&box.open)return;box.dataset.for=key;
    box.innerHTML=`<h2 id="axon-ask-title">${esc(ask.title)}</h2><p>${esc(ask.text)}</p>${ask.more?`<p>${esc(ask.more)}</p>`:''}<div class="button-row">${ask.buttons.map(([label,act],i)=>`<button id="axon-ask-${i}" class="${i?'secondary':'primary'}" type="button" data-axon="${act}">${esc(label)}</button>`).join('')}</div>`;
    if(!box.open)box.showModal();
  }
  function render(){
    if(!root)return;
    // A new servo starts clean. A mode switch is the one change that announces itself: its answer and the servo's new state can arrive in either order, and it stays.
    if(snap&&servo().key!==lastServoKey){lastServoKey=servo().key;pending={};formEpoch++;target=null;if(!(result?.mode&&servo().present&&result.mode===servo().mode))result=null;if(servo().present)picked=null;ask=null;}
    const button=$('axon-level');button.textContent=level==='advanced'?'Back to Simple':'Show Advanced';button.setAttribute('aria-pressed',String(level==='advanced'));
    renderChips();renderCards();renderSettings();renderHint();renderSide();renderBar();syncAsk();
  }

  // ---- what the student does
  const run=async fn=>{error='';try{await fn();}catch(e){error=e.message;}render();};
  function closeAsk(){ask=null;}
  // One setting changed by a student: only its row, the banner and the Apply button move.
  function setValue(key,value){
    const st=settings();if(!st)return;const field=st.schema.fields.find(f=>f.key===key);if(!field)return;
    if(value===st.values[key])delete pending[key];else pending[key]=value;
    const row=root.querySelector(`[data-axon-field="${key}"]`);row.querySelector('[data-axon-mark]').hidden=pending[key]===undefined;
    const out=$(`axon-v-${key}`);if(out)out.textContent=show(field,value);
    result=null;error='';renderBar();renderSide();
  }
  async function startSwitch(extra={}){
    const code=extra.code||modelCode(),mode=extra.mode||wanted(),status=await axon('firmware-status',{code,mode});
    if(!status.have&&!status.chosen){ask={title:'Firmware needed',text:`This needs ${status.fileName} (${(status.size/1024).toFixed(1)} KB), Axon's official firmware for this mode. Torque does not ship it. It can download it once from Axon's own link, or you can pick the file if you already have it.`,buttons:[['Download from Axon','download'],['Choose a file','choose-firmware'],['Cancel','cancel-ask']],code,mode,extra};return;}
    const v1=models().find(m=>m.code===code)?.family==='v1';
    ask={title:extra.recovery?'Recover a servo':`Switch to ${MODE[mode]}`,text:extra.recovery?`Use this if a mode switch was interrupted and the servo no longer shows up. It writes ${modelTitle(code)} ${MODE[mode]} firmware, so check that the servo and mode picked are right. Torque still checks the hardware ID, but it cannot check the servo's name.`:`This writes Axon's ${MODE[mode]} firmware to the servo and resets its settings to Axon's factory values for that mode. Save a settings file first if you want to keep them.`,
      more:v1?'Axon does not support V1 servos on the V2 programmer. Every check still runs, but this exact path has not been proven on real hardware. If it is interrupted, the servo may need Recover.':'',buttons:[[extra.recovery?'Write the firmware':'Switch mode','flash'],['Cancel','cancel-ask']],code,mode,extra};
  }
  async function doFlash({code,mode,extra={}},allowUnknownName=false){
    closeAsk();render();
    try{result=await axon('flash',{code,mode,recovery:!!extra.recovery,allowUnknownName});}
    // An error's code does not cross into the page, only its words.
    catch(e){if(/name could not be read/.test(e.message)){ask={title:'Servo name unavailable',text:e.message,more:'Write the firmware anyway?',buttons:[['Write it anyway','flash-anyway'],['Cancel','cancel-ask']],code,mode,extra};return;}throw e;}
    if(result?.ok){target=null;pending={};formEpoch++;}
  }
  const actions={
    level:()=>{level=level==='advanced'?'simple':'advanced';if(level==='simple'){const st=settings();for(const key of Object.keys(pending))if(st?.schema.fields.find(f=>f.key===key)?.advanced)delete pending[key];}formEpoch++;syncTrace();},
    'close-rivals':()=>axon('close-rivals'),read:()=>axon('read'),
    model:b=>{picked=b.dataset.code;},
    mode:b=>{target=b.dataset.mode;ask=null;result=null;},
    apply:async()=>{if(switching())return startSwitch();const changes={...pending};if(!Object.keys(changes).length)return;result=await axon('write',{changes});if(result.ok){pending={};formEpoch++;}},
    discard:()=>{pending={};target=null;ask=null;result=null;formEpoch++;},
    defaults:()=>{ask={title:'Restore factory settings',text:'This resets every setting on this servo to Axon\'s factory values.',buttons:[['Restore factory settings','defaults-go'],['Cancel','cancel-ask']]};},
    'defaults-go':async()=>{closeAsk();render();const r=await axon('defaults');pending={};formEpoch++;result={ok:r.ok,changed:r.ok,message:r.ok?'Factory settings restored and read back.':'The servo refused the factory reset.'};},
    'open-file':async()=>{const r=await axon('open-settings');if(!r)return;const st=settings();pending={};for(const f of st.schema.fields.filter(visible))if(r.values[f.key]!==undefined&&r.values[f.key]!==st.values[f.key])pending[f.key]=r.values[f.key];result=null;formEpoch++;},
    'save-file':()=>axon('save-settings',{changes:pending}),
    'cancel-ask':()=>closeAsk(),
    download:async()=>{const a=ask;closeAsk();render();await axon('download',{code:a.code,mode:a.mode});await startSwitch({...a.extra,code:a.code,mode:a.mode});},
    'choose-firmware':async()=>{const a=ask,r=await axon('choose-firmware',{code:a.code,mode:a.mode});if(!r)return;closeAsk();await startSwitch({...a.extra,code:a.code,mode:a.mode});},
    flash:()=>doFlash(ask),'flash-anyway':()=>doFlash(ask,true),
    recover:()=>startSwitch({recovery:true,code:chosenModel(),mode:wanted()}),
  };
  function onClick(e){
    const seg=e.target.closest('[data-axon-seg]');
    if(seg&&!seg.disabled){for(const b of seg.parentElement.children)b.setAttribute('aria-pressed',String(b===seg));setValue(seg.dataset.axonSeg,Number(seg.dataset.value));return;}
    const nudge=e.target.closest('[data-axon-nudge]');
    if(nudge&&!nudge.disabled){const r=document.getElementById(nudge.dataset.for),v=Math.max(+r.min,Math.min(+r.max,+r.value+Number(nudge.dataset.axonNudge)));r.value=v;setFill(r);setValue(r.dataset.axonKey,v);return;}
    const b=e.target.closest('[data-axon]');if(!b||b.disabled)return;const act=actions[b.dataset.axon];if(act)void run(()=>act(b));
  }
  function onInput(e){
    const el=e.target;if(!el.matches('[data-axon-key]'))return;const key=el.dataset.axonKey;
    if(el.type==='range'){setFill(el);setValue(key,Number(el.value));}
    else if(el.type==='checkbox'){el.nextElementSibling.textContent=el.checked?'On':'Off';setValue(key,el.checked?1:0);}
    else setValue(key,el.value);
  }
  // Touch has no hover, so a tap or a keyboard focus shows the hint too.
  function onPoint(e){const row=e.target.closest?.('[data-axon-field]');const st=panel();if(row&&st.schema){const f=st.schema.fields.find(x=>x.key===row.dataset.axonField);pointing=f?.what||'';renderHint();}else if(pointing&&e.type==='pointerover'&&!e.target.closest?.('#axon-settings')){pointing='';renderHint();}}
  function syncTrace(){const on=shown&&level==='advanced'&&$('axon-usb')?.open;if(on&&!traceTimer){const tick=async()=>{try{const lines=await axon('trace');const pre=$('axon-usb-log');if(pre)pre.textContent=lines.slice(-120).join('\n');}catch{}};void tick();traceTimer=setInterval(tick,1000);}else if(!on&&traceTimer){clearInterval(traceTimer);traceTimer=null;}}
  function start(){if(!api){render();return;}void axon('start').then(s=>{snap=s;render();},e=>{error=e.message;render();});}
  function stop(){if(traceTimer){clearInterval(traceTimer);traceTimer=null;}if(api)void axon('stop').catch(()=>{});}

  const PAGE=`<div class="axon-tab">
    <div class="axon-top"><h2>Axon Programmer</h2><p class="hint">Needs Axon's V2 programmer (Programmer MK2), sold by Axon, goBILDA and ServoCity. Torque works through it and does not replace it. Keep it off the robot.</p><div id="axon-chips" class="axon-chips"></div><button id="axon-level" class="secondary" type="button" data-axon="level" aria-pressed="false">Show Advanced</button></div>
    <div class="axon-picks"><section aria-labelledby="axon-models-title"><h3 id="axon-models-title" class="axon-step-title"><span>1</span>Servo</h3><div id="axon-models" class="axon-cards"></div></section><section aria-labelledby="axon-modes-title"><h3 id="axon-modes-title" class="axon-step-title"><span>2</span>Mode</h3><div id="axon-modes" class="axon-cards"></div></section></div>
    <div class="axon-main">
      <section class="cal-card axon-settings" aria-labelledby="axon-settings-title"><div class="axon-settings-head"><h3 class="axon-step-title"><span>3</span>Settings<b aria-hidden="true">·</b><em id="axon-settings-title"></em></h3><span id="axon-tag"></span></div><div id="axon-settings" class="axon-settings-body"></div><p id="axon-hint" class="hint" aria-live="polite"></p></section>
      <div class="axon-side">
        <section class="cal-card" aria-labelledby="axon-report-title"><h3 id="axon-report-title" class="axon-side-title">Plugged-in servo</h3><div id="axon-report"></div></section>
        <div class="axon-actions"><button id="axon-read" class="secondary" type="button" data-axon="read">Read</button><button id="axon-defaults" class="secondary" type="button" data-axon="defaults">Defaults</button><button id="axon-open-file" class="secondary" type="button" data-axon="open-file">Open</button><button id="axon-save-file" class="secondary" type="button" data-axon="save-file">Save</button><button id="axon-recover-go" class="secondary" type="button" data-axon="recover" hidden>Recover</button></div>
        <section class="cal-card axon-happened" aria-labelledby="axon-log-title"><h3 id="axon-log-title" class="axon-side-title">What happened</h3><div id="axon-result"></div><div id="axon-log"></div></section>
        <div id="axon-advanced" class="axon-advanced" hidden>
          <section class="cal-card" aria-label="More the servo reports"><div id="axon-more"></div></section>
          <section class="cal-card" aria-labelledby="axon-limits-title"><h3 id="axon-limits-title" class="axon-side-title">What Advanced will not change</h3><p class="hint">Torque only offers a setting it could confirm from Axon's documents or firmware, and it never guesses at a write.</p><ul class="axon-limits"><li><strong>SysAmp and MinPower.</strong> Axon keeps them on a locked page and documents neither, so a safe value could not be confirmed. Reported, never written.</li><li><strong>Neutral on continuous rotation.</strong> That firmware never reads it, so it would do nothing.</li><li><strong>Left and Right Range on continuous rotation.</strong> The firmware reads them, but what they do there has not been tested on a real servo.</li><li><strong>The stop band on V1 continuous rotation.</strong> That firmware keeps its settings differently, and it could not be confirmed.</li><li><strong>Bytes with no known name.</strong> Read and written back unchanged.</li></ul></section>
          <details id="axon-usb" class="cal-card"><summary>USB log</summary><p class="hint">Every USB message to and from the programmer. Torque keeps it in its data folder as axon-usb.log, which is what to send if a servo misbehaves.</p><pre id="axon-usb-log" class="axon-bytes" tabindex="0"></pre></details>
        </div>
      </div>
    </div>
    <div class="axon-bar"><div id="axon-banner" class="axon-banner" role="status" data-tone="wait"></div><button id="axon-discard" class="secondary" type="button" data-axon="discard" hidden>Discard</button><button id="axon-apply" class="primary" type="button" data-axon="apply" disabled>Apply</button></div>
    <dialog id="axon-ask" aria-labelledby="axon-ask-title"></dialog>
  </div>`;

  return {
    install(box,deck){if(!box)return;root=box;api=deck&&typeof deck.axon==='function'?deck:null;box.innerHTML=PAGE;box.addEventListener('click',onClick);box.addEventListener('input',onInput);box.addEventListener('pointerover',onPoint);box.addEventListener('focusin',onPoint);box.addEventListener('toggle',syncTrace,true);
      $('axon-ask').addEventListener('cancel',()=>{ask=null;});
      if(api)api.onAxon(s=>{snap=s;if(shown)render();});
      render();},
    // Whether the tab is on screen. USB runs only while it shows.
    shown(on){if(!root||on===shown)return;shown=on;if(on)start();else stop();syncTrace();},
  };
})();
