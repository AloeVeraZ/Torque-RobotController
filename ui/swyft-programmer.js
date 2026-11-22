'use strict';
// Calibrate → SWYFT Programmer: programs SWYFT servos through SWYFT's USB programmer and offers what SWYFT's own app
// offers, in the Axon Programmer tab's look. The port and every decision about what reaches a servo live in the main process
// (src/swyft-programmer.cjs); this page draws what it reports and sends back what the student asked for.
// The whole page always shows: with no programmer or servo it is a preview of SWYFT's defaults, greyed out, and the bar at
// the bottom says what to plug in. Simple is four tiles every student should know. Advanced is every setting as rows.
window.DeckSwyft=(()=>{
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let root=null,api=null,shown=false,level='simple',snap=null,pending={},result=null,ask=null,error='',formEpoch=0,formSig='',traceTimer=null,pointing='',lastPresent=false,repick=false;
  const MODEL_KEY='torque.swyft.model';
  let picked=null;try{picked=localStorage.getItem(MODEL_KEY);}catch{}
  const swyft=(action,data)=>api.swyft(action,data);
  const $=id=>root.querySelector('#'+id);
  const servo=()=>snap?.servo||{},live=()=>servo().settings||null,busy=()=>!!snap?.busy,models=()=>snap?.models||[];
  const model=()=>models().find(m=>m.id===picked)||null;

  // Every setting the page can show: SWYFT's numbers and switches, plus travel (one total in degrees, as SWYFT's app shows it).
  const GROUP={travel:'Travel and direction',reverse:'Travel and direction',minSignal:'Travel and direction',middleSignal:'Travel and direction',maxSignal:'Travel and direction',
    maxPower:'Power and protection',stall:'Power and protection',ramp:'Power and protection',deadZone:'Power and protection',p:'Response (PID)',i:'Response (PID)',d:'Response (PID)',integralSpeed:'Response (PID)'};
  const ORDER=['travel','reverse','minSignal','middleSignal','maxSignal','maxPower','stall','ramp','deadZone','p','i','d','integralSpeed'];
  // The line under each of Simple's rows. The whole explanation shows in the hint below when a row is pointed at.
  const SHORT={travel:'How far it turns',reverse:'Which way it turns',maxPower:'How hard it pushes',stall:'Off after 10 s stalled'};
  // Direction is a pick of two, as Axon's choice rows are.
  const OPTIONS={reverse:[[false,'Normal'],[true,'Reversed']]};
  function defs(){
    if(!snap)return [];const basics=new Set(snap.basics||[]),out=[];
    for(const key of ORDER){
      if(key==='travel'){out.push({key,kind:'travel',label:'Travel',what:'The total mechanical travel of the servo, 0–320°, split evenly between the left and right sides. SWYFT ships its servos at 270°. In continuous rotation it turns at full speed either way instead.',advanced:!basics.has(key)});continue;}
      const f=snap.fields.find(x=>x.key===key),w=snap.switches.find(x=>x.key===key);
      if(f)out.push({key,kind:'range',label:f.name,min:f.min,max:f.max,unit:f.unit,what:f.help,advanced:!basics.has(key)});
      else if(w)out.push({key,kind:'switch',label:w.name,what:w.help,advanced:!basics.has(key)});
    }
    return out;
  }
  // What a value reads like: in Advanced's rows, and on Simple's tiles.
  function show(key,v){
    if(v===undefined||v===null)return '';if(key==='travel')return typeof v==='string'?v:`${v}°`;
    if(typeof v==='boolean')return key==='reverse'?(v?'Reversed':'Normal'):v?'On':'Off';
    if(key==='maxPower')return `${v} (${Math.round(v/5)}%)`;if(key==='integralSpeed')return `${v} × 3 ms`;
    if(/Signal$/.test(key)||key==='deadZone')return `${v} µs`;return String(v);
  }
  // A value as the servo holds it now, and as the page will write it. With no servo, SWYFT's defaults are the preview.
  const liveValue=key=>{const s=servo();if(!live())return snap?.defaults?.[key];if(key==='degrees')return s.continuous?null:s.degrees;if(key==='continuous')return !!s.continuous;return live()[key];};
  const value=key=>key in pending?pending[key]:liveValue(key);
  const continuousNow=()=>!!value('continuous');
  const degreesNow=()=>value('degrees')??(liveValue('degrees')||270);
  const travelText=()=>continuousNow()?'Continuous':`${degreesNow()}°`;
  const changeList=()=>live()?Object.keys(pending):[];
  const setHtml=(id,html)=>{const box=$(id);if(!box||box.dataset.html===html)return;const focus=document.activeElement?.id;box.dataset.html=html;box.innerHTML=html;const again=focus&&document.getElementById(focus);if(again&&box.contains(again))again.focus();};
  const setFill=r=>r.style.setProperty('--fill',`${(+r.value-+r.min)/Math.max(1,+r.max-+r.min)*100}%`);
  const rows=list=>`<dl class="axon-rows">${list.filter(Boolean).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  const changed=key=>key==='travel'?('degrees' in pending||'continuous' in pending):key in pending;

  // ---- the one line that says what is going on and what comes next
  function gate(){
    const p=snap?.programmer,s=servo(),n=changeList().length;
    if(!api)return {tone:'warn',main:'Programming SWYFT servos needs the installed app',sub:'This is a preview of SWYFT\'s defaults.'};
    if(!snap)return {tone:'wait',main:'Starting...',sub:''};
    if(snap.busy)return {tone:'busy',main:snap.busy.text,sub:snap.busy.kind==='write'?'Keep the servo and programmer plugged in.':''};
    if(error)return {tone:'bad',main:error,sub:''};
    if(!snap.supported)return {tone:'warn',main:'This computer cannot reach the programmer',sub:'Programming SWYFT servos works on Windows for now. Everything here is a preview.'};
    if(p.error)return {tone:'bad',main:'Torque could not reach the programmer',sub:`${p.error} Antivirus can block the small helper Torque uses for this. Restart Torque, and if this stays, tell your mentor.`};
    if(p.rivals.length)return {tone:'warn',main:'SWYFT\'s own programmer app is open',sub:'It holds the same programmer, and two apps at once corrupt each other. Torque waits until it closes.',closeRivals:true};
    if(p.held)return {tone:'warn',main:`${p.port} is open in another program`,sub:'Close the program using the SWYFT programmer. Torque connects by itself once it is free.'};
    if(!p.ready)return {tone:'wait',main:'Plug in the SWYFT programmer to continue',sub:`Everything here is a preview of SWYFT's defaults until then.${p.others?.length?` ${p.others.map(o=>o.port).join(', ')} ${p.others.length===1?'is':'are'} plugged in, but ${p.others.length===1?'it is':'they are'} not a SWYFT programmer.`:''} If it is plugged in and this stays, it needs the Silicon Labs CP210x driver from SWYFT's download.`};
    if(p.silent)return {tone:'bad',main:'The programmer is not answering',sub:'Unplug it and plug it back in.'};
    if(!s.present)return {tone:'wait',main:'Plug a SWYFT servo into the programmer',sub:'Match the servo\'s gray wire to the programmer\'s white wire. Torque finds it by itself.'};
    if(repick&&n)return {tone:'warn',main:'Pick the servo that is plugged in',sub:'Under Servo: check the label on the servo. Then press Apply again. Nothing was written.',ready:true};
    if(result&&!result.ok)return {tone:'bad',main:'It did not take',sub:result.message,ready:n>0};
    if(n)return {tone:'good',main:`Ready to write ${n} ${n===1?'change':'changes'} to the servo`,sub:'Torque reads it back after writing, and shows what the servo reports.',ready:true};
    if(result)return {tone:'good',main:'Confirmed',sub:result.message};
    const m=model();return {tone:'good',main:`${m?`SWYFT ${m.name}`:'A SWYFT servo'} is ready`,sub:m?'Change a setting or switch mode, then press Apply.':'Pick which SWYFT servo it is under Servo: the programmer cannot tell them apart. Change a setting or switch mode, then press Apply.'};
  }
  function renderBar(){
    const g=gate(),n=changeList().length;
    setHtml('swyft-banner',`<strong>${esc(g.main)}</strong>${g.sub?`<span>${esc(g.sub)}</span>`:''}${g.closeRivals?'<button id="swyft-close-rivals" class="secondary" type="button" data-swyft="close-rivals">Close it</button>':''}`);
    $('swyft-banner').dataset.tone=g.tone;
    const apply=$('swyft-apply');apply.disabled=!g.ready||busy();apply.textContent=n?`Apply ${n} ${n===1?'change':'changes'}`:'Apply';
    $('swyft-discard').hidden=!n||busy();
  }
  function renderTop(){
    const p=snap?.programmer,s=servo();
    const chip=(tone,label)=>`<span class="axon-chip" data-tone="${tone}"><i aria-hidden="true"></i>${esc(label)}</span>`;
    const one=!p?chip('wait','No programmer'):p.rivals?.length?chip('warn','Paused for SWYFT\'s app'):p.held?chip('warn','Port in use'):p.ready?chip(p.silent?'bad':'good',`Programmer · ${p.port}`):chip('wait','No programmer');
    const two=s.present?chip('good',s.continuous?'Servo · continuous':`Servo · ${s.degrees}°`):chip('wait','No servo');
    setHtml('swyft-chips',one+two);
    for(const b of root.querySelectorAll('[data-swyft=level]'))b.setAttribute('aria-pressed',String(b.dataset.level===level));
  }
  function renderPicks(){
    const s=servo(),now=s.present?(s.continuous?'cr':'servo'):null,want=continuousNow()?'cr':'servo';
    setHtml('swyft-models',models().map(m=>`<button id="swyft-model-${m.id}" type="button" class="axon-card secondary" data-swyft="model" data-id="${m.id}" aria-pressed="${picked===m.id}"><strong>${esc(m.name)}</strong><span>${m.rpm} RPM, ${m.torque} kg·cm</span></button>`).join(''));
    const locked=busy()||!live();
    const mode=(key,title,line)=>`<button id="swyft-mode-${key}" type="button" class="axon-card secondary" data-swyft="mode" data-mode="${key}" aria-pressed="${want===key}"${locked?' disabled':''}><strong>${title}${now===key?' <em>Now</em>':''}</strong><span>${line}</span></button>`;
    setHtml('swyft-modes',mode('servo','Servo mode','Holds a position')+mode('cr','Continuous','Spins at full speed'));
  }

  // ---- settings. Rebuilt only when what they show changes from outside, so polling never moves a control under a finger.
  const mark=key=>`<i data-swyft-mark${changed(key)?'':' hidden'}></i>`;
  function slider(id,key,min,max,v,label,off){
    return `<button type="button" class="axon-nudge" data-swyft-nudge="-1" data-for="${id}" aria-label="Lower ${esc(label)}"${off}>−</button><input id="${id}" class="num-slider axon-slider" type="range" min="${min}" max="${max}" step="1" value="${v}" data-swyft-key="${key}" aria-label="${esc(label)}"${off}><button type="button" class="axon-nudge" data-swyft-nudge="1" data-for="${id}" aria-label="Raise ${esc(label)}"${off}>+</button>`;
  }
  function travelSlider(edit){
    const steps=snap.travelSteps||[],at=Math.max(0,steps.findIndex(v=>v>=degreesNow())),off=continuousNow()||!edit?' disabled':'';
    return slider('swyft-f-travel','travel',0,steps.length-1,at,'Travel',off);
  }
  function row(r,edit){
    const id=`swyft-f-${r.key}`,off=edit?'':' disabled';let control;
    if(r.kind==='travel')control=`${travelSlider(edit)}<output id="swyft-v-travel">${esc(travelText())}</output>`;
    else if(OPTIONS[r.key]){const v=!!value(r.key);control=`<div id="${id}" class="segmented axon-seg" role="group" aria-label="${esc(r.label)}" data-count="2">${OPTIONS[r.key].map(([val,name])=>`<button id="${id}-${val?'on':'off'}" type="button" data-swyft-seg="${r.key}" data-value="${val}" aria-pressed="${v===val}"${off}>${esc(name)}</button>`).join('')}</div>`;}
    else if(r.kind==='switch'){const v=!!value(r.key);control=`<label class="axon-toggle" for="${id}"><input id="${id}" type="checkbox" data-swyft-key="${r.key}" aria-label="${esc(r.label)}"${v?' checked':''}${off}><span>${v?'On':'Off'}</span></label>`;}
    else{const v=value(r.key)??r.min;control=`${slider(id,r.key,r.min,r.max,v,r.label,off)}<output id="swyft-v-${r.key}">${esc(show(r.key,v))}</output>`;}
    const d=snap.defaults,small=level==='simple'?SHORT[r.key]||'':`SWYFT default: ${r.key==='travel'?`${d.degrees}°`:show(r.key,d[r.key])}`;
    return `<div class="axon-row" data-swyft-field="${r.key}" data-kind="${r.kind==='switch'?'switch':'range'}"><div class="axon-row-label"><label${OPTIONS[r.key]?'':` for="${id}"`}>${mark(r.key)}${esc(r.key==='reverse'&&level==='simple'?'Direction':r.label)}</label><small>${esc(small)}</small></div><div class="axon-row-control">${control}</div></div>`;
  }
  function renderSettings(){
    const box=$('swyft-settings'),edit=!!live()&&!busy();
    const tag=$('swyft-tag');tag.textContent=live()?'Live from the servo':'Preview of SWYFT\'s defaults';tag.toggleAttribute('data-good',!!live());
    $('swyft-settings-title').textContent=level==='advanced'?'Every setting':'The basics';
    const sig=JSON.stringify([live(),servo().degrees,servo().continuous,level,formEpoch,busy(),!!snap]);if(sig===formSig)return;formSig=sig;box.dataset.level=level;
    if(!snap){box.innerHTML='';return;}
    const list=defs();
    const shown=list.filter(r=>!r.advanced||level==='advanced');
    const column=items=>{let last=null,html='';for(const r of items){if(GROUP[r.key]!==last)html+=`<h4 class="axon-group"><span>${esc(GROUP[r.key])}</span></h4>`;last=GROUP[r.key];html+=row(r,edit);}return html;};
    box.innerHTML=`<div class="axon-column">${column(shown.filter(r=>GROUP[r.key]==='Travel and direction'))}</div><div class="axon-column">${column(shown.filter(r=>GROUP[r.key]!=='Travel and direction'))}</div>`;
    for(const r of box.querySelectorAll('input[type=range]'))setFill(r);
  }
  function renderHint(){
    $('swyft-hint').textContent=pointing||(level==='advanced'?'Every setting SWYFT\'s own app offers. Point at one to see what it does. A dot marks a change not applied yet.':'The four settings every student should know. Advanced has SWYFT\'s signal and PID settings. A dot marks a change not applied yet.');
  }

  // ---- what the servo and programmer report, and what happened
  function renderSide(){
    const p=snap?.programmer,s=servo(),st=live(),adv=level==='advanced',m=model(),hex=v=>`0x${Number(v).toString(16).toUpperCase().padStart(4,'0')}`;
    setHtml('swyft-report',rows([
      ['Model',m?`SWYFT ${m.name}`:'Not picked'],['Mode',s.present?(s.continuous?'Continuous':'Servo mode'):'-'],['Travel',s.present?(s.continuous?'Continuous':`${s.degrees}°`):'-'],
      ['Direction',st?(st.reverse?'Reversed':'Normal'):'-'],['Max power',st?show('maxPower',st.maxPower):'-'],
      adv&&m&&['Specs',`${m.rpm} RPM, ${m.torque} kg·cm, ${m.grams} g, ${m.spline} spline`],adv&&st&&['Sides',`Left ${st.left}, right ${st.right}`],adv&&['Read at',s.readAt?new Date(s.readAt).toLocaleTimeString():'-']])+
      (adv?`<p class="axon-note">The programmer cannot tell SWYFT servos apart: no servo reports its model. The one picked only changes what is shown, never what is written.</p><h4 class="axon-side-title">Programmer</h4>${rows([['Port',p?.port||'-'],['Adapter',p?.name||'-'],p?.vid!=null&&['USB IDs',`VID ${hex(p.vid)} PID ${hex(p.pid)}`],p?.serial&&['Serial number',p.serial],['Other serial ports',(p?.others||[]).map(o=>o.port).join(', ')||'None'],['Link','115200 baud, 8N2, one wire']])}`:''));
    const idle=!busy()&&!!p?.ready;$('swyft-read').disabled=!idle;$('swyft-defaults').disabled=!idle||!st;
    setHtml('swyft-result',result?.confirmed?.length?`<table class="axon-table"><thead><tr><th scope="col">Setting</th><th scope="col">Asked</th><th scope="col">Servo has</th><th scope="col">Took</th></tr></thead><tbody>${result.confirmed.map(c=>`<tr><th scope="row">${esc(label(c.key))}</th><td>${esc(show(c.key,c.asked))}</td><td>${esc(show(c.key,c.now))}</td><td data-took="${c.took}">${c.took?'Yes':'No'}</td></tr>`).join('')}</tbody></table>`:result?`<p class="axon-result-line" data-ok="${!!result.ok}">${esc(result.message)}</p>`:'');
    setHtml('swyft-log',(snap?.log||[]).length?`<ol class="axon-log">${snap.log.slice(-8).reverse().map(l=>`<li data-tone="${l.tone}">${esc(l.text)}</li>`).join('')}</ol>`:'<p class="hint">Nothing yet.</p>');
    $('swyft-advanced').hidden=!adv;
    if(adv)setHtml('swyft-more',(st&&snap.defaults?(()=>{const diff=defs().filter(r=>r.key==='travel'?(s.continuous||s.degrees!==snap.defaults.degrees):st[r.key]!==snap.defaults[r.key]);
      return `<h4 class="axon-side-title">Different from SWYFT's defaults</h4>${diff.length?rows(diff.map(r=>[r.label,r.key==='travel'?`${s.continuous?'Continuous':`${s.degrees}°`} (default ${snap.defaults.degrees}°)`:`${show(r.key,st[r.key])} (default ${show(r.key,snap.defaults[r.key])})`])):'<p class="hint">Nothing: this servo has SWYFT\'s defaults.</p>'}`;})():'')+
      (s.raw?`<h4 class="axon-side-title">The servo's reply</h4><pre class="axon-bytes" tabindex="0">${esc(s.raw)}</pre>`:''));
  }
  const label=key=>key==='travel'?'Travel':defs().find(r=>r.key===key)?.label||key;
  function syncAsk(){
    const box=$('swyft-ask');if(!ask){if(box.open)box.close();box.dataset.for='';return;}
    const key=ask.text+ask.buttons.map(b=>b[0]).join();if(box.dataset.for===key&&box.open)return;box.dataset.for=key;
    box.innerHTML=`<h2 id="swyft-ask-title">${esc(ask.title)}</h2><p>${esc(ask.text)}</p>${ask.more?`<p>${esc(ask.more)}</p>`:''}<div class="button-row">${ask.buttons.map(([name,act,id],i)=>`<button id="swyft-ask-${i}" class="${i||ask.choice?'secondary':'primary'}" type="button" data-swyft="${act}"${id?` data-id="${id}"`:''}>${esc(name)}</button>`).join('')}</div>`;
    if(!box.open)box.showModal();
  }
  function render(){
    if(!root)return;
    // A servo plugged in or pulled out starts clean.
    const present=!!servo().present;if(present!==lastPresent){lastPresent=present;pending={};formEpoch++;if(!present)result=null;}
    renderTop();renderPicks();renderSettings();renderHint();renderSide();renderBar();syncAsk();renderIdle();
  }
  // No programmer to talk to (and no other program holding it): the page stays as a preview, out of reach, and the bar says what to plug in.
  function renderIdle(){const p=snap?.programmer,idle=!api||!snap||!snap.busy&&(!snap.supported||!!p?.error||!p?.ready&&!p?.rivals?.length&&!p?.held);
    root.querySelector('.swyft-tab').toggleAttribute('data-idle',idle);for(const el of root.querySelectorAll('.swyft-picks,.axon-main'))el.inert=idle;}

  // ---- what the student does
  const run=async fn=>{error='';try{await fn();}catch(e){error=e.message;}render();};
  // One setting changed: only its value, its dot, the banner and the Apply button move. A value back to what the servo holds is no change.
  function setValue(key,v){
    if(!live())return;if(v===liveValue(key))delete pending[key];else pending[key]=v;
    const field=key==='degrees'||key==='continuous'?'travel':key,box=root.querySelector(`[data-swyft-field="${field}"]`);
    if(box)box.querySelector('[data-swyft-mark]').hidden=!changed(field);
    const out=$(`swyft-v-${field}`);if(out)out.textContent=field==='travel'?travelText():show(key,v);
    result=null;error='';renderBar();renderSide();
  }
  function setTravel(index){const steps=snap.travelSteps;setValue('degrees',steps[Math.max(0,Math.min(steps.length-1,index))]);}
  // Servo mode or continuous rotation. Leaving continuous rotation brings back the travel shown (270°, SWYFT's shipping travel, if none).
  function setMode(cr){
    if(!live())return;if(cr){delete pending.degrees;setValue('continuous',true);}
    else{setValue('continuous',false);if(servo().continuous&&!('degrees' in pending))pending.degrees=270;}
    formEpoch++;
  }
  const actions={
    level:b=>{level=b.dataset.level;if(level==='simple'){const adv=new Set(defs().filter(r=>r.advanced).map(r=>r.key));for(const key of Object.keys(pending))if(adv.has(key))delete pending[key];}formEpoch++;syncTrace();},
    'close-rivals':()=>swyft('close-rivals'),
    read:async()=>{const r=await swyft('read');if(r?.ok){pending={};result=null;formEpoch++;}},
    model:b=>{picked=b.dataset.id;repick=false;try{localStorage.setItem(MODEL_KEY,picked);}catch{}},
    mode:b=>setMode(b.dataset.mode==='cr'),
    // Apply checks the servo first. The programmer cannot tell SWYFT servos apart, so the student confirms the one picked is
    // the one plugged in, every time: Yes writes, No writes nothing and sends them back to Servo.
    apply:()=>{if(!Object.keys(pending).length)return;repick=false;const m=model();
      if(!m){ask={title:'Which SWYFT servo is plugged in?',text:'Torque cannot tell SWYFT servos apart, so check the label on the servo and pick it.',buttons:[...models().map(x=>[x.name,'ask-model',x.id]),['Cancel','cancel-ask']],choice:true};return;}
      const n=Object.keys(pending).length;
      ask={title:`Is the servo plugged in a SWYFT ${m.name}?`,text:`Torque cannot tell which SWYFT servo is plugged in, so check the label on the servo before writing. ${n} ${n===1?'change goes':'changes go'} to it when you press Yes.`,more:`${m.name}: ${m.rpm} RPM, ${m.torque} kg·cm, ${m.grams} g.`,buttons:[[`Yes, it is a ${m.name}`,'apply-go'],['No','apply-no']]};},
    'ask-model':b=>{picked=b.dataset.id;try{localStorage.setItem(MODEL_KEY,picked);}catch{}ask=null;return actions.apply();},
    'apply-no':()=>{ask=null;repick=true;setTimeout(()=>$('swyft-models')?.querySelector('button')?.focus(),0);},
    'apply-go':async()=>{ask=null;render();const changes={...pending};result=await swyft('write',{changes});if(result.ok){pending={};formEpoch++;}},
    discard:()=>{pending={};result=null;ask=null;formEpoch++;},
    defaults:()=>{ask={title:'Load SWYFT\'s defaults',text:'This fills in the settings SWYFT recommends: 270° travel, reversed direction, max power 400, stall protection and ramp mode on, and SWYFT\'s PID values. Nothing is written until you press Apply.',more:'The settings that change get a dot, so you can check them first.',buttons:[['Load the defaults','defaults-go'],['Cancel','cancel-ask']]};},
    'defaults-go':()=>{ask=null;const d=snap.defaults;pending={};for(const key of Object.keys(d)){if(['left','right','degrees','continuous'].includes(key))continue;if(d[key]!==liveValue(key))pending[key]=d[key];}
      if(servo().continuous)pending.continuous=false;if(servo().continuous||servo().degrees!==d.degrees)pending.degrees=d.degrees;result=null;formEpoch++;},
    'cancel-ask':()=>{ask=null;},
  };
  function onClick(e){
    const seg=e.target.closest('[data-swyft-seg]');
    if(seg&&!seg.disabled){for(const b of seg.parentElement.children)b.setAttribute('aria-pressed',String(b===seg));setValue(seg.dataset.swyftSeg,seg.dataset.value==='true');return;}
    const nudge=e.target.closest('[data-swyft-nudge]');
    if(nudge&&!nudge.disabled){const r=document.getElementById(nudge.dataset.for),v=Math.max(+r.min,Math.min(+r.max,+r.value+Number(nudge.dataset.swyftNudge)));r.value=v;setFill(r);if(r.dataset.swyftKey==='travel')setTravel(v);else setValue(r.dataset.swyftKey,v);return;}
    const b=e.target.closest('[data-swyft]');if(!b||b.disabled)return;const act=actions[b.dataset.swyft];if(act)void run(()=>act(b));
  }
  function onInput(e){
    const el=e.target;if(!el.matches('[data-swyft-key]'))return;const key=el.dataset.swyftKey;
    if(el.type==='range'){setFill(el);if(key==='travel')setTravel(Number(el.value));else setValue(key,Number(el.value));}
    else if(el.type==='checkbox'){el.nextElementSibling.textContent=el.checked?'On':'Off';setValue(key,el.checked);}
  }
  // Touch has no hover, so a tap or a keyboard focus shows the hint too.
  function onPoint(e){const row=e.target.closest?.('[data-swyft-field]');if(row){pointing=defs().find(r=>r.key===row.dataset.swyftField)?.what||'';renderHint();}else if(pointing&&e.type==='pointerover'&&!e.target.closest?.('#swyft-settings')){pointing='';renderHint();}}
  function syncTrace(){const on=shown&&level==='advanced'&&$('swyft-usb')?.open;if(on&&!traceTimer){const tick=async()=>{try{const lines=await swyft('trace');const pre=$('swyft-usb-log');if(pre)pre.textContent=lines.slice(-120).join('\n');}catch{}};void tick();traceTimer=setInterval(tick,1000);}else if(!on&&traceTimer){clearInterval(traceTimer);traceTimer=null;}}
  function start(){if(!api){render();return;}void swyft('start').then(s=>{snap=s;render();},e=>{error=e.message;render();});}
  function stop(){if(traceTimer){clearInterval(traceTimer);traceTimer=null;}if(api)void swyft('stop').catch(()=>{});}

  const PAGE=`<div class="axon-tab swyft-tab">
    <div class="axon-top"><h2>SWYFT Programmer</h2><div id="swyft-chips" class="axon-chips"></div><div class="segmented swyft-level" role="group" aria-label="How much to show" data-count="2"><button id="swyft-level-simple" type="button" data-swyft="level" data-level="simple" aria-pressed="true">Simple</button><button id="swyft-level-advanced" type="button" data-swyft="level" data-level="advanced" aria-pressed="false">Advanced</button></div></div>
    <section class="swyft-picks" aria-label="Servo and mode"><div><h3 id="swyft-models-title" class="axon-step-title">Servo</h3><div id="swyft-models" class="swyft-choices" role="group" aria-labelledby="swyft-models-title"></div></div><div><h3 id="swyft-modes-title" class="axon-step-title">Mode</h3><div id="swyft-modes" class="swyft-choices" role="group" aria-labelledby="swyft-modes-title"></div></div></section>
    <div class="axon-main">
      <section class="axon-settings" aria-labelledby="swyft-settings-head"><div class="axon-settings-head"><h3 id="swyft-settings-head" class="axon-step-title">Settings <em id="swyft-settings-title"></em></h3><span id="swyft-tag"></span></div><div id="swyft-settings" class="axon-settings-body swyft-settings-body"></div><p id="swyft-hint" class="hint" aria-live="polite"></p></section>
      <div class="axon-side">
        <section aria-labelledby="swyft-report-title"><h3 id="swyft-report-title" class="axon-side-title">Servo</h3><div id="swyft-report"></div><div class="axon-actions swyft-actions"><button id="swyft-read" class="secondary" type="button" data-swyft="read">Read again</button><button id="swyft-defaults" class="secondary" type="button" data-swyft="defaults">SWYFT defaults</button></div></section>
        <section class="axon-happened" aria-labelledby="swyft-log-title"><h3 id="swyft-log-title" class="axon-side-title">What happened</h3><div id="swyft-result"></div><div id="swyft-log"></div></section>
        <div id="swyft-advanced" class="axon-advanced" hidden>
          <section aria-label="More the servo reports"><div id="swyft-more"></div></section>
          <details id="swyft-usb"><summary>Serial log</summary><p class="hint">Every frame to and from the programmer. Torque keeps it in its data folder as swyft-serial.log, which is what to send if a servo misbehaves.</p><pre id="swyft-usb-log" class="axon-bytes" tabindex="0"></pre></details>
        </div>
      </div>
    </div>
    <div class="axon-bar"><div id="swyft-banner" class="axon-banner notice" role="status" data-tone="wait"></div><button id="swyft-discard" class="secondary" type="button" data-swyft="discard" hidden>Discard</button><button id="swyft-apply" class="primary" type="button" data-swyft="apply" disabled>Apply</button></div>
    <dialog id="swyft-ask" aria-labelledby="swyft-ask-title"></dialog>
  </div>`;

  return {
    install(box,deck){if(!box)return;root=box;api=deck&&typeof deck.swyft==='function'?deck:null;box.innerHTML=PAGE;box.addEventListener('click',onClick);box.addEventListener('input',onInput);box.addEventListener('pointerover',onPoint);box.addEventListener('focusin',onPoint);box.addEventListener('toggle',syncTrace,true);
      $('swyft-ask').addEventListener('cancel',()=>{ask=null;});
      if(api)api.onSwyft(s=>{snap=s;if(shown)render();});
      render();},
    // Whether the tab is on screen. The port is open only while it shows.
    shown(on){if(!root||on===shown)return;shown=on;if(on)start();else stop();syncTrace();},
  };
})();
