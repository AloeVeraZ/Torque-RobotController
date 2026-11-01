'use strict';
// Calibrate → Axon: programs Axon servos through Axon's own V2 programmer, one guided step at a time. USB and every decision
// about what reaches a servo live in the main process (src/axon-programmer.cjs); this page says what it reports and sends
// back what the student asked for. Simple shows exactly what Axon's software edits. Advanced adds only what was confirmed.
window.DeckAxon=(()=>{
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let root=null,api=null,shown=false,view='entry',level='simple',snap=null,pending={},target=null,picked=null,result=null,ask=null,error='',formEpoch=0,formSig='',traceTimer=null,lastServoKey='',recover={code:'max2',mode:'servo'};
  const MODE={servo:'servo mode',cr:'continuous rotation'},cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
  // How a raw number reads to a person. Whole percents where the raw value lands on one, so 168 reads 66%.
  const pct=raw=>{const p=raw*100/255,whole=Math.round(p);return Math.round(whole*2.55)===raw?`${whole}%`:`${p.toFixed(1)}%`;};
  const FORMAT={plain:r=>String(r),pct,signedUs:r=>`${r>0?'+':''}${r} µs`,tenth:r=>`${(r*0.1).toFixed(1)} s`,olV1:r=>`${(r*0.102).toFixed(1)} s`,olV2:r=>`${(r*0.077).toFixed(1)} s`,angle:r=>`${r} (${Math.round(r*355/255)}°)`,level:r=>`Level ${r}`};
  const show=(f,v)=>v===undefined?'':f.kind==='switch'?(v?'On':'Off'):f.kind==='choice'?f.options[v]:f.kind==='text'?(v||'(empty)'):FORMAT[f.format](v);
  // Dropdown steps for a number. The servo's current value and the factory one are always in the list, so nothing moves by itself.
  function steps(f,current,factory){
    const list=new Set(),add=v=>{if(Number.isInteger(v)&&v>=f.min&&v<=f.max)list.add(v);};
    if(f.format==='pct')for(let p=0;p<=100;p++)add(Math.round(p*2.55));
    else{const step=f.step||(/^ol/.test(f.format)||f.format==='angle'?5:1);add(f.min);for(let v=Math.ceil(f.min/step)*step;v<=f.max;v+=step)add(v);add(f.max);}
    add(current);add(factory);return [...list].sort((a,b)=>a-b);
  }
  const axon=(action,data)=>api.axon(action,data);
  const busy=()=>!!snap?.busy;
  const visible=f=>!f.advanced||level==='advanced';
  const servo=()=>snap?.servo||{},settings=()=>snap?.settings||null;
  const modeNow=()=>servo().present&&servo().mode!=='unknown'?servo().mode:null;
  const wanted=()=>target||modeNow();
  const switching=()=>!!(modeNow()&&wanted()&&wanted()!==modeNow());
  const modelCode=()=>servo().model?.code||picked;
  const servoTitle=()=>{const s=servo();return s.model?`${s.model.title} (sold as ${s.model.sold})`:s.family==='v1'?'V1 servo':s.family==='v2'?'V2 servo':'Servo';};
  const changeList=()=>{const st=settings();return st?Object.entries(pending).map(([key,value])=>({field:st.schema.fields.find(f=>f.key===key),value})).filter(c=>c.field):[];};
  const line=(tone,main,sub)=>`<p class="axon-status" data-tone="${tone}" role="status"><i aria-hidden="true"></i><span><strong>${esc(main)}</strong>${sub?`<span>${esc(sub)}</span>`:''}</span></p>`;
  const rows=list=>`<dl class="axon-rows">${list.filter(Boolean).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  const setHtml=(id,html)=>{const box=root.querySelector('#'+id);if(!box||box.dataset.html===html)return;const focus=document.activeElement?.id;box.dataset.html=html;box.innerHTML=html;const again=focus&&document.getElementById(focus);if(again&&box.contains(again))again.focus();};

  // ---- what the programmer and the servo say
  function programmerLine(){
    const p=snap?.programmer;if(!snap)return ['wait','Starting...',''];
    if(!snap.supported)return ['warn','This computer cannot reach the programmer','Programming Axon servos works on Windows for now.'];
    if(p.error)return ['bad','Torque could not reach USB',`${p.error} Antivirus can block the small helper Torque uses for this. Restart Torque, and if this stays, tell your mentor.`];
    if(p.rivals.length)return ['warn',`${p.rivals.join(' and ')} is open`,'It talks to the same programmer, and two apps at once corrupt each other. Torque waits until it closes.'];
    if(p.ready)return ['good','V2 programmer connected',''];
    if(p.v1Seen)return ['warn','That is the old V1 programmer','Torque works only through the V2 programmer. Plug that one in instead.'];
    if(p.bootSeen)return ['warn','The programmer is in its own update mode','Unplug it and plug it back in.'];
    if(p.handshakeFailed)return ['bad','The programmer is not answering','Unplug it and plug it back in. Make sure the USB cable carries data, not just charge.'];
    return ['wait','Plug in the V2 programmer','Nothing can be read or changed until it shows up.'];
  }
  function servoLine(){
    const s=servo();if(!snap?.programmer.ready)return ['wait','Waiting for the programmer',''];
    if(!s.present)return ['wait','Plug in a servo','If a V1 servo is plugged in and this stays here, the programmer is not passing it along.'];
    if(s.family==='unknown')return ['bad','Torque does not know this servo',`It answered ${s.firmware}, which neither Axon app knows. Nothing will be written.`];
    if(!s.editable)return ['warn','This servo can be switched, but its settings cannot be edited','Axon\'s V1 app has no settings layout for this variant either.'];
    if(!settings())return ['wait','Reading the servo...','If this does not clear, press Read again. The details are under What happened.'];
    return ['good',`${servoTitle()} is plugged in`,`It is running ${MODE[s.mode]}, firmware ${s.firmware}.`];
  }
  function stepState(){
    const p=snap?.programmer,s=servo(),one=p?.ready?'done':'now',two=one!=='done'?'todo':settings()||(s.present&&!s.editable)?'done':'now',three=two==='done'?'now':'todo';
    const changing=switching()||changeList().length>0||busy();return {one,two,three,four:three==='now'&&changing?'now':result?'done':'todo',five:result?(result.ok?'done':'bad'):'todo'};
  }

  function renderStepOne(){
    const [tone,main,sub]=programmerLine(),rivals=snap?.programmer.rivals.length;
    setHtml('axon-s1-status',line(tone,main,sub)+(rivals?'<div class="button-row"><button id="axon-close-rivals" class="secondary" type="button" data-axon="close-rivals">Close it</button></div>':''));
  }
  function renderStepTwo(){
    const [tone,main,sub]=servoLine(),s=servo();
    const v1=s.family==='v1'?'<p class="cal-note">Axon says V1 servos do not work on the V2 programmer. Torque speaks to them anyway because both use the same commands, but this has not been proven on a real V1 servo yet. If something looks wrong, stop and tell your mentor.</p>':'';
    const pick=s.present&&s.family!=='unknown'&&!s.model&&!s.name?`<div class="cal-field axon-pick"><label for="axon-model">Which servo is this? <span>Torque could not read its name.</span></label><select id="axon-model" data-axon-pick><option value="">Choose...</option>${snap.models.filter(m=>m.family===s.family).map(m=>`<option value="${m.code}"${picked===m.code?' selected':''}>${esc(m.title)} (sold as ${esc(m.sold)})</option>`).join('')}</select></div>`:'';
    setHtml('axon-s2-status',line(tone,main,sub)+v1+pick+(s.editable?`<div class="button-row"><button id="axon-read" class="secondary" type="button" data-axon="read"${busy()?' disabled':''}>Read again</button></div>`:''));
  }
  function renderModes(){
    const s=servo(),now=modeNow(),can=s.present&&s.family!=='unknown',locked=!can||busy()||(!s.model&&!!s.name);
    const option=(key,title,text)=>`<button id="axon-mode-${key}" type="button" class="axon-mode" data-axon="mode" data-mode="${key}" aria-pressed="${wanted()===key}"${locked?' disabled':''}><strong>${title}${now===key?' <em>Now</em>':''}</strong><span>${text}</span></button>`;
    setHtml('axon-modes',`<div class="axon-mode-row" role="group" aria-label="Servo or continuous rotation">${option('servo','Servo mode','Moves to a position and holds it. For arms, claws and gates.')}${option('cr','Continuous rotation','Spins all the way round. The signal sets speed and direction, not a position. For intakes and wheels.')}</div>`+
      (switching()?`<p class="hint">Switching means writing Axon's official firmware for that mode onto the servo. It also puts the servo's settings back to Axon's factory values for that mode. The settings for that mode show here once the servo restarts.</p>`:'')+
      (!s.model&&s.name&&can?`<p class="hint">Torque has no firmware listed for a servo named ${esc(s.name)}, so it will not switch this one. Its settings can still be edited.</p>`:''));
  }
  // The form is rebuilt only when what it shows changes from outside, so polling never closes an open dropdown.
  function renderSettings(){
    const st=settings(),box=root.querySelector('#axon-settings');if(!box)return;
    const sig=JSON.stringify([st?.schema.title,st?.values,st?.factory,level,formEpoch,switching(),busy()]);if(sig===formSig)return;formSig=sig;
    if(!st||switching()){box.innerHTML=st?'':'<p class="hint">The servo\'s settings show here once it has been read.</p>';return;}
    const groups=[];for(const f of st.schema.fields.filter(visible)){const g=groups.find(x=>x.name===f.group);if(g)g.fields.push(f);else groups.push({name:f.group,fields:[f]});}
    const disabled=busy()?' disabled':'';
    const control=f=>{const id=`axon-f-${f.key}`,value=pending[f.key]??st.values[f.key];
      if(f.kind==='switch')return `<label class="axon-switch" for="${id}"><input id="${id}" type="checkbox" data-axon-key="${f.key}"${value?' checked':''}${disabled}><span>${value?'On':'Off'}</span></label>`;
      if(f.kind==='text')return `<input id="${id}" type="text" maxlength="12" spellcheck="false" data-axon-key="${f.key}" value="${esc(value)}"${disabled}>`;
      const opts=f.kind==='choice'?f.options.map((t,i)=>[i,t]):steps(f,value,st.factory?.[f.key]).map(v=>[v,show(f,v)]);
      return `<select id="${id}" data-axon-key="${f.key}"${disabled}>${opts.map(([v,t])=>`<option value="${v}"${v===value?' selected':''}>${esc(t)}</option>`).join('')}</select>`;};
    const facts=f=>level==='advanced'&&st.factory&&f.key in st.factory?`<small class="axon-factory">Factory value: ${esc(show(f,st.factory[f.key]))}${st.factory[f.key]!==st.values[f.key]?' (this servo differs)':''}</small>`:'';
    box.innerHTML=`<p class="hint">${esc(st.schema.title)}. ${level==='advanced'?'These are the servo\'s own settings, plus what Advanced adds.':'These are exactly the settings Axon\'s own software lets you edit.'} Nothing changes on the servo until you apply it.</p>`+
      groups.map(g=>`<h3 class="cal-group-title">${esc(g.name)}</h3>${st.schema.notes?.[g.name]?`<p class="hint">${esc(st.schema.notes[g.name])}</p>`:""}<div class="axon-fields">${g.fields.map(f=>`<div class="axon-field" data-axon-field="${f.key}"><div class="axon-field-control"><label for="axon-f-${f.key}">${esc(f.label)} <em data-axon-mark${pending[f.key]===undefined?' hidden':''}>Changed</em></label>${control(f)}</div><p class="hint">${esc(f.what)}${facts(f)}</p></div>`).join('')}</div>`).join('')+
      `<div class="button-row axon-file-row"><button id="axon-defaults" class="secondary" type="button" data-axon="defaults"${disabled}>Restore factory settings</button><button id="axon-open-file" class="secondary" type="button" data-axon="open-file"${disabled}>Open settings file</button><button id="axon-save-file" class="secondary" type="button" data-axon="save-file"${disabled}>Save settings file</button></div>`;
  }
  function renderConfirm(){
    if(!ask)return '';
    const buttons=ask.buttons.map(([label,act],i)=>`<button id="axon-ask-${i}" class="${i?'secondary':'primary'}" type="button" data-axon="${act}">${esc(label)}</button>`).join('');
    return `<div class="sim-send-confirm axon-confirm" role="alertdialog" aria-label="Confirm"><p>${esc(ask.text)}</p>${ask.more?`<p>${esc(ask.more)}</p>`:''}<div class="button-row">${buttons}</div></div>`;
  }
  function renderApply(){
    const b=snap?.busy,changes=changeList(),st=settings();let body;
    if(b)body=`${line('wait',b.text,b.kind==='flash'?'Keep the servo and programmer plugged in.':'')}${b.percent!==null&&b.percent!==undefined?`<progress id="axon-progress" max="100" value="${b.percent}" aria-label="Progress"></progress>`:''}`;
    else if(switching()){
      const can=!!modelCode();
      body=`<p class="hint">Writes Axon's ${esc(MODE[wanted()])} firmware to the servo. It takes about a minute. Do not unplug anything while it runs.</p>${ask?'':`<div class="button-row"><button id="axon-switch" class="primary" type="button" data-axon="switch"${can?'':' disabled'}>Switch to ${esc(MODE[wanted()])}</button><button id="axon-cancel-switch" class="secondary" type="button" data-axon="cancel-switch">Keep ${esc(MODE[modeNow()])}</button></div>${can?'':'<p class="hint">Say which servo this is, up in step 2, first.</p>'}`}`;
    }
    else if(changes.length)body=`<ul class="axon-changes">${changes.map(c=>`<li><strong>${esc(c.field.label)}</strong> ${esc(show(c.field,st.values[c.field.key]))} → ${esc(show(c.field,c.value))}</li>`).join('')}</ul>${ask?'':`<div class="button-row"><button id="axon-apply" class="primary" type="button" data-axon="apply">Apply ${changes.length} ${changes.length===1?'change':'changes'}</button><button id="axon-discard" class="secondary" type="button" data-axon="discard">Discard</button></div>`}`;
    else body='<p class="hint">Change a setting or pick the other mode, and what will happen shows here before anything is sent.</p>';
    setHtml('axon-apply-box',body+(ask?.extra?.recovery?'':renderConfirm())+(error?`<p class="axon-status" data-tone="bad" role="alert"><i aria-hidden="true"></i><span><strong>${esc(error)}</strong></span></p>`:''));
  }
  function renderResult(){
    if(!result){setHtml('axon-result','<p class="hint">Torque reads the servo back after every change and compares it with what you asked for. What it found shows here, so you never have to guess.</p>');return;}
    const table=result.confirmed?.length?`<table class="axon-table"><thead><tr><th scope="col">Setting</th><th scope="col">You asked for</th><th scope="col">Servo reports</th><th scope="col">Took</th></tr></thead><tbody>${result.confirmed.map(c=>`<tr><th scope="row">${esc(c.label)}</th><td>${esc(show(c.field,c.asked))}</td><td>${esc(show(c.field,c.now))}</td><td data-took="${c.took}">${c.took?'Yes':'No'}</td></tr>`).join('')}</tbody></table>`:'';
    const hint=result.ok?'':result.changed===false?'Nothing on the servo changed. Fix what it says above and try again.':result.confirmed?'Read the servo again and check its settings before using it.':'Check the servo\'s mode above. If it no longer shows up, use Recover in Advanced.';
    setHtml('axon-result',line(result.ok?'good':'bad',result.ok?'Confirmed':'It did not take',result.message)+table+(hint?`<p class="hint">${esc(hint)}</p>`:''));
  }
  function renderReports(){
    const p=snap?.programmer,t=snap?.telemetry,s=servo(),adv=level==='advanced',info=p?.info;
    const hex=v=>`0x${Number(v).toString(16).toUpperCase().padStart(2,'0')}`;
    setHtml('axon-prog',!p?.ready?'<p class="hint">Nothing connected yet.</p>':rows([
      ['Device',info?.product||'HID device'],['Maker',info?.maker||'Not reported'],['Serial number',info?.serial||'Not reported'],
      t&&['Input voltage',`${t.volts.toFixed(2)} V`],t&&['Current to the servo',`${t.amps.toFixed(2)} A`],t&&['Servo power',t.powerAlarm?'Alarm: off':t.powerOn?'On':'Off'],
      t&&['Pulse it is sending',`${t.outputPulse} µs`],t&&['Signal on its input',t.inputValid&&t.inputPeriod?`${t.inputPulse} µs every ${(t.inputPeriod/1000).toFixed(1)} ms (${Math.round(1e6/t.inputPeriod)} Hz)`:'None'],
      ...(adv?[info&&['USB IDs',`VID ${hex(info.vid)} PID ${hex(info.pid)}, version ${hex(info.version)}`],info&&['USB report size',`${info.inLen} in, ${info.outLen} out`],t&&['Low return',t.lowReturn?'On':'Off'],t&&['Signal source byte',String(t.source)],t&&['Power state byte',String(t.powerState)],p.hello&&['Handshake reply',p.hello],t&&['Last status report',t.raw]]:[])]));
    const st=settings(),diff=adv&&st?.factory?st.schema.fields.filter(f=>f.key in st.factory&&st.factory[f.key]!==st.values[f.key]):[];
    setHtml('axon-servo',!s.present?'<p class="hint">No servo yet.</p>':rows([
      ['Model',s.model?`${s.model.title} (sold as ${s.model.sold})`:s.family==='unknown'?'Not known':'Not recognised'],['Generation',s.family==='v1'?'V1, through the V2 programmer':s.family==='v2'?'V2':'Not known'],['Mode',s.mode==='unknown'?'Not known':cap(MODE[s.mode])],['Firmware',s.firmware||'Not known'],
      s.name!==null&&s.name!==undefined&&['Factory name',s.name||'(empty)'],s.made&&['Made on',s.made],st?.values.name!==undefined&&['Model name',st.values.name],
      ...(adv?[['Status bytes',`${hex(s.type)} ${hex(s.b6)} ${hex(s.b7)} ${hex(s.b8)}`],s.validLen&&['Settings bytes read',String(s.validLen)]]:[])])+
      (adv&&st?.factory?`<h3 class="cal-group-title">Different from Axon's factory values</h3>${diff.length?rows(diff.map(f=>[f.label,`${show(f,st.values[f.key])} (factory ${show(f,st.factory[f.key])})`])):'<p class="hint">Nothing: this servo is at its factory values.</p>'}`:'')+
      (adv&&s.unconfirmed?.length?`<h3 class="cal-group-title">Reported, never changed</h3>${s.unconfirmed.map(u=>`<p class="hint"><strong>${esc(u.name)}: ${u.value}.</strong> ${esc(u.why)}</p>`).join('')}`:'')+
      (adv&&s.raw?`<h3 class="cal-group-title">Every settings byte</h3><pre class="axon-bytes" tabindex="0">${esc(s.raw)}</pre>`:''));
    setHtml('axon-log',(snap?.log||[]).length?`<ol class="axon-log">${snap.log.slice(-14).reverse().map(l=>`<li data-tone="${l.tone}">${esc(l.text)}</li>`).join('')}</ol>`:'<p class="hint">Nothing yet.</p>');
    const tools=root.querySelector('#axon-advanced');if(tools)tools.hidden=!adv;
    if(adv){const ready=p?.ready&&!s.present&&!busy();setHtml('axon-recover',`<p class="hint">If a mode switch was interrupted and the servo stopped showing up, this writes the firmware again. Torque still checks the servo's hardware ID, but it cannot check its name, so pick the right model.</p><div class="axon-recover-row"><div class="cal-field"><label for="axon-recover-model">Servo</label><select id="axon-recover-model" data-axon-recover="code">${(snap?.models||[]).map(m=>`<option value="${m.code}"${recover.code===m.code?' selected':''}>${esc(m.title)} (sold as ${esc(m.sold)})</option>`).join('')}</select></div><div class="cal-field"><label for="axon-recover-mode">Mode</label><select id="axon-recover-mode" data-axon-recover="mode"><option value="servo"${recover.mode==='servo'?' selected':''}>Servo mode</option><option value="cr"${recover.mode==='cr'?' selected':''}>Continuous rotation</option></select></div></div>${ask?.extra?.recovery?renderConfirm():`<div class="button-row"><button id="axon-recover-go" class="secondary" type="button" data-axon="recover"${ready?'':' disabled'}>Recover</button></div>`}${ready?'':'<p class="hint">This works with the programmer plugged in and no servo showing.</p>'}${error&&!s.present?`<p class="axon-status" data-tone="bad" role="alert"><i aria-hidden="true"></i><span><strong>${esc(error)}</strong></span></p>`:''}`);}
  }
  function render(){
    if(!root)return;
    if(view!=='guide'){setHtml('axon-page',ENTRY);return;}
    if(root.querySelector('#axon-page').dataset.html!==GUIDE){setHtml('axon-page',GUIDE);formSig='';}
    if(servo().key!==lastServoKey){lastServoKey=servo().key;pending={};formEpoch++;target=null;picked=null;ask=null;}
    const state=stepState();for(const [key,id] of [['one','axon-s1'],['two','axon-s2'],['three','axon-s3'],['four','axon-s4'],['five','axon-s5']])root.querySelector('#'+id).dataset.state=state[key];
    const button=root.querySelector('#axon-level');button.textContent=level==='advanced'?'Back to Simple':'Show Advanced';button.setAttribute('aria-pressed',String(level==='advanced'));
    root.querySelector('#axon-level-note').textContent=level==='advanced'?'Advanced adds what Torque could confirm from Axon\'s firmware, and everything the servo and programmer report.':'Simple shows exactly the settings Axon\'s own software lets you edit.';
    renderStepOne();renderStepTwo();renderModes();renderSettings();renderApply();renderResult();renderReports();
  }

  // ---- what the student does
  const run=async fn=>{error='';try{await fn();}catch(e){error=e.message;}render();};
  function closeAsk(){ask=null;}
  async function startSwitch(extra={}){
    const code=extra.code||modelCode(),mode=extra.mode||wanted(),status=await axon('firmware-status',{code,mode});
    if(!status.have&&!status.chosen){ask={text:`This needs ${status.fileName} (${(status.size/1024).toFixed(1)} KB), Axon's official firmware for this mode. Torque does not ship it. It can download it once from Axon's own link, or you can pick the file if you already have it.`,buttons:[['Download from Axon','download'],['Choose a file','choose-firmware'],['Cancel','cancel-ask']],code,mode,extra};return;}
    const v1=snap.models.find(m=>m.code===code)?.family==='v1';
    ask={text:extra.recovery?`This writes ${MODE[mode]} firmware to the servo. If the wrong model is picked, the hardware check should stop it before anything is erased.`:`This writes Axon's ${MODE[mode]} firmware to the servo and resets its settings to Axon's factory values for that mode. Save a settings file first if you want to keep them.`,
      more:v1?'Axon does not support V1 servos on the V2 programmer. Every check still runs, but this exact path has not been proven on real hardware. If it is interrupted, the servo may need Recover.':'',buttons:[[extra.recovery?'Write the firmware':'Switch mode','flash'],['Cancel','cancel-ask']],code,mode,extra};
  }
  async function doFlash({code,mode,extra={}},allowUnknownName=false){
    closeAsk();render();if(extra.recovery)root.querySelector('#axon-s4')?.scrollIntoView({block:'center'});
    try{result=await axon('flash',{code,mode,recovery:!!extra.recovery,allowUnknownName});}
    catch(e){if(e.code==='NAME_UNKNOWN'){ask={text:e.message,more:'Write the firmware anyway?',buttons:[['Write it anyway','flash-anyway'],['Cancel','cancel-ask']],code,mode,extra};return;}throw e;}
    if(result?.ok){target=null;pending={};formEpoch++;}
  }
  const actions={
    open:()=>{view='guide';start();},back:()=>{view='entry';stop();},
    level:()=>{level=level==='advanced'?'simple':'advanced';if(level==='simple'){const st=settings();for(const key of Object.keys(pending))if(st?.schema.fields.find(f=>f.key===key)?.advanced)delete pending[key];formEpoch++;}syncTrace();},
    'close-rivals':()=>axon('close-rivals'),read:()=>axon('read'),
    mode:(b)=>{target=b.dataset.mode;ask=null;result=null;},'cancel-switch':()=>{target=null;ask=null;},
    apply:async()=>{const changes={...pending};result=await axon('write',{changes});if(result.ok){pending={};formEpoch++;}},
    discard:()=>{pending={};ask=null;formEpoch++;},
    defaults:()=>{ask={text:'This resets every setting on this servo to Axon\'s factory values.',buttons:[['Restore factory settings','defaults-go'],['Cancel','cancel-ask']]};},
    'defaults-go':async()=>{closeAsk();const r=await axon('defaults');pending={};formEpoch++;result={ok:r.ok,changed:r.ok,message:r.ok?'Factory settings restored and read back.':'The servo refused the factory reset.'};},
    'open-file':async()=>{const r=await axon('open-settings');if(!r)return;const st=settings();pending={};for(const f of st.schema.fields.filter(visible))if(r.values[f.key]!==undefined&&r.values[f.key]!==st.values[f.key])pending[f.key]=r.values[f.key];formEpoch++;},
    'save-file':()=>axon('save-settings',{changes:pending}),
    switch:()=>startSwitch(),'cancel-ask':()=>closeAsk(),
    download:async()=>{const a=ask;closeAsk();render();await axon('download',{code:a.code,mode:a.mode});await startSwitch({...a.extra,code:a.code,mode:a.mode});},
    'choose-firmware':async()=>{const a=ask,r=await axon('choose-firmware',{code:a.code,mode:a.mode});if(!r)return;closeAsk();await startSwitch({...a.extra,code:a.code,mode:a.mode});},
    flash:()=>doFlash(ask),'flash-anyway':()=>doFlash(ask,true),
    recover:()=>startSwitch({recovery:true,code:recover.code,mode:recover.mode}),
  };
  function onClick(e){const b=e.target.closest('[data-axon]');if(!b||b.disabled)return;const act=actions[b.dataset.axon];if(act)void run(()=>act(b));}
  function onChange(e){
    const el=e.target;
    if(el.matches('[data-axon-pick]')){picked=el.value||null;render();return;}
    if(el.matches('[data-axon-recover]')){recover[el.dataset.axonRecover]=el.value;return;}
    if(!el.matches('[data-axon-key]'))return;
    const key=el.dataset.axonKey,st=settings();if(!st)return;const field=st.schema.fields.find(f=>f.key===key);
    const value=field.kind==='switch'?(el.checked?1:0):field.kind==='text'?el.value:Number(el.value);
    if(value===st.values[key])delete pending[key];else pending[key]=value;
    const row=el.closest('[data-axon-field]');row.querySelector('[data-axon-mark]').hidden=pending[key]===undefined;if(field.kind==='switch')el.nextElementSibling.textContent=value?'On':'Off';
    result=null;ask=null;renderApply();renderResult();
  }
  function syncTrace(){const on=shown&&view==='guide'&&level==='advanced'&&root.querySelector('#axon-usb')?.open;if(on&&!traceTimer){const tick=async()=>{try{const lines=await axon('trace');const pre=root.querySelector('#axon-usb-log');if(pre)pre.textContent=lines.slice(-120).join('\n');}catch{}};void tick();traceTimer=setInterval(tick,1000);}else if(!on&&traceTimer){clearInterval(traceTimer);traceTimer=null;}}
  function start(){if(!api)return;void axon('start').then(s=>{snap=s;render();},e=>{error=e.message;render();});}
  function stop(){if(traceTimer){clearInterval(traceTimer);traceTimer=null;}if(api)void axon('stop').catch(()=>{});}

  const ENTRY=`<section class="cal-card axon-entry" aria-labelledby="axon-entry-title"><h2 id="axon-entry-title">Axon</h2><p class="hint">Axon servos keep settings that only a programmer can change, such as how far they travel, how hard they push, and whether they hold a position or spin all the way round.</p><div class="button-row"><button id="axon-open" class="primary" type="button" data-axon="open">Axon Programmer</button></div></section>`;
  const GUIDE=`<div class="axon-head"><button id="axon-back" class="secondary" type="button" data-axon="back">Back</button><h2>Axon Programmer</h2><div class="axon-level"><p id="axon-level-note" class="hint"></p><button id="axon-level" class="secondary" type="button" data-axon="level" aria-pressed="false">Show Advanced</button></div></div>
    <div class="cal-grid axon-grid"><div class="cal-flow">
      <section class="cal-card" aria-labelledby="axon-need-title"><h2 id="axon-need-title">What you need</h2><p class="hint">An Axon V2 programmer, which Axon calls the Programmer MK2. Axon, goBILDA and ServoCity sell it, and a team has to buy it: Torque does not replace it. Torque talks to your servo through it, with the same commands as Axon's own software.</p><p class="hint">It works on V1 MAX (sold as MAX+), V1 MINI (MINI+), V2 MAX (MAX MK2) and V2 MINI (MINI MK2). Axon no longer sells the V1 programmer, so this keeps the V1 servos your team already owns programmable.</p><p class="hint">Work on the bench, with the programmer off the robot.</p></section>
      <section class="cal-card cal-step axon-step" id="axon-s1" aria-labelledby="axon-s1-title"><span class="cal-num" aria-hidden="true">1</span><div class="cal-body"><h2 id="axon-s1-title">Plug in the programmer</h2><p class="hint">The programmer is the go-between: your computer talks to it over USB, and it talks to the servo. Its USB-C port powers both, so no battery is needed. Use a cable that carries data, not just charge.</p><div id="axon-s1-status"></div></div></section>
      <section class="cal-card cal-step axon-step" id="axon-s2" aria-labelledby="axon-s2-title"><span class="cal-num" aria-hidden="true">2</span><div class="cal-body"><h2 id="axon-s2-title">Read the servo</h2><p class="hint">Plug the servo into the top row of pins on the left side of the programmer, with the grey signal wire on the right. Torque turns on power to those pins and reads the servo by itself. Reading changes nothing.</p><div id="axon-s2-status"></div></div></section>
      <section class="cal-card cal-step axon-step" id="axon-s3" aria-labelledby="axon-s3-title"><span class="cal-num" aria-hidden="true">3</span><div class="cal-body"><h2 id="axon-s3-title">Choose its mode and settings</h2><p class="hint">Pick what the servo should do, then change any settings you need. The ones you leave alone stay exactly as they are.</p><div id="axon-modes"></div><div id="axon-settings"></div></div></section>
      <section class="cal-card cal-step axon-step" id="axon-s4" aria-labelledby="axon-s4-title"><span class="cal-num" aria-hidden="true">4</span><div class="cal-body"><h2 id="axon-s4-title">Apply the changes</h2><div id="axon-apply-box"></div></div></section>
      <section class="cal-card cal-step axon-step" id="axon-s5" aria-labelledby="axon-s5-title"><span class="cal-num" aria-hidden="true">5</span><div class="cal-body"><h2 id="axon-s5-title">Confirm it took</h2><div id="axon-result"></div></div></section>
    </div><div class="cal-side">
      <section class="cal-card" aria-labelledby="axon-prog-title"><h2 id="axon-prog-title">What the programmer reports</h2><div id="axon-prog"></div></section>
      <section class="cal-card" aria-labelledby="axon-servo-title"><h2 id="axon-servo-title">What the servo reports</h2><div id="axon-servo"></div></section>
      <section class="cal-card" aria-labelledby="axon-log-title"><h2 id="axon-log-title">What happened</h2><div id="axon-log"></div></section>
      <div id="axon-advanced" class="cal-flow" hidden>
        <section class="cal-card" aria-labelledby="axon-recover-title"><h2 id="axon-recover-title">Recover a servo</h2><div id="axon-recover"></div></section>
        <section class="cal-card" aria-labelledby="axon-limits-title"><h2 id="axon-limits-title">What Advanced will not change</h2><p class="hint">Torque only offers a setting it could confirm from Axon's documents or firmware, and it never guesses at a write. It leaves these alone:</p><ul class="axon-limits"><li><strong>SysAmp and MinPower.</strong> Axon keeps them on a locked page and documents neither, so what a safe value is could not be confirmed. They are reported and never written.</li><li><strong>Neutral on continuous rotation.</strong> Axon's continuous rotation firmware never reads it, so changing it would do nothing.</li><li><strong>Left and Right Range on continuous rotation.</strong> The firmware reads them, but what they do there has not been tested on a real servo.</li><li><strong>The stop band on V1 continuous rotation.</strong> That firmware keeps its settings differently, and it could not be confirmed.</li><li><strong>Bytes with no known name.</strong> They are read and written back unchanged.</li></ul></section>
        <details id="axon-usb" class="cal-card"><summary>USB log</summary><p class="hint">Every USB message to and from the programmer. Torque keeps it in its data folder as axon-usb.log, which is what to send if a servo misbehaves.</p><pre id="axon-usb-log" class="axon-bytes" tabindex="0"></pre></details>
      </div>
    </div></div>`;

  return {
    install(box,deck){if(!box)return;root=box;api=deck&&typeof deck.axon==='function'?deck:null;box.innerHTML='<div id="axon-page"></div>';box.addEventListener('click',onClick);box.addEventListener('change',onChange);box.addEventListener('toggle',syncTrace,true);
      if(api)api.onAxon(s=>{snap=s;if(view==='guide'&&shown)render();});render();if(!api)root.querySelector('#axon-open')?.setAttribute('disabled','');},
    // Whether the page is on screen. USB runs only while it shows and the guide is open.
    shown(on){if(!root||on===shown)return;shown=on;if(on&&view==='guide')start();else if(!on)stop();syncTrace();},
  };
})();
