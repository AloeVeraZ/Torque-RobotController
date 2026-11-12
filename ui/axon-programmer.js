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
  // One state per programmer: the app runs a V1 and a V2 programmer side by side, and this page works on the one picked (cur).
  let snaps={},cur=null,lostAt=0;const seen={};
  const axon=(action,data)=>api.axon(action,action==='start'||action==='stop'?data:{...data,which:cur});
  const readyKeys=()=>Object.keys(snaps).filter(k=>snaps[k]?.programmer?.ready);
  // The picked programmer stays picked. With none picked, or the picked one gone, the first one plugged in; and a servo plugged into the
  // other programmer while this one has none brings that one up.
  function pickSnap(){
    const keys=Object.keys(snaps),ready=readyKeys();if(!cur||!snaps[cur])cur=keys[0]||null;
    // A programmer that drops off USB for a moment comes back: the page only moves to the other one after 3 seconds without it.
    if(ready.length&&!ready.includes(cur)){lostAt||=Date.now();if(!snaps[cur]||Date.now()-lostAt>3000)choose(ready[0]);}else lostAt=0;
    for(const k of keys){const has=!!snaps[k]?.servo?.family&&snaps[k].servo.family!=='none';if(has&&!seen[k]&&k!==cur&&!(snaps[cur]?.servo?.family&&snaps[cur].servo.family!=='none'))choose(k);seen[k]=has;}
    snap=cur?snaps[cur]:null;
  }
  // The model of the last V1 servo the V1 programmer read: a hint on the V2 programmer, never used without the student picking it.
  let lastV1Code=null;const lastV1=()=>{for(const k of Object.keys(snaps)){const m=snaps[k]?.servo?.model;if(m?.family==='v1'&&!snaps[k].servo.viaBoot)lastV1Code=m.code;}return lastV1Code;};
  // What the student picked belongs to one programmer's servo: it is put away when the page moves to the other programmer and brought
  // back when it returns, as long as the same servo is still there. A question on screen about the first programmer's servo goes too.
  const picks={};
  function choose(k){if(k===cur)return;stopDrive();if(cur)picks[cur]={picked,epoch:snaps[cur]?.servo?.epoch};cur=k;lastRun=null;snap=snaps[k];const was=picks[k];picked=was&&snap?.servo?.viaBoot&&was.epoch===snap.servo.epoch?was.picked:null;ask=null;}
  const $=id=>root.querySelector('#'+id);
  const R=globalThis.DeckAxonResponse;let view='settings';
  const busy=()=>!!snap?.busy,servo=()=>snap?.servo||{},settings=()=>snap?.settings||null,models=()=>snap?.models||[];
  const visible=f=>!f.advanced||level==='advanced';
  const modeNow=()=>servo().present&&servo().mode!=='unknown'?servo().mode:null;
  const viaBoot=()=>!!servo().viaBoot&&servo().present;
  const other=()=>servo().family==='v2'?{servo:'MK2 servo',here:'V1 programmer',home:'V2 programmer',models:'a MAX MK2 or a MINI MK2',big:'the MAX MK2 is the bigger one'}:{servo:'V1 servo',here:'V2 programmer',home:'V1 programmer',models:'a MAX+ or a MINI+',big:'the MAX+ is the bigger one'};
  const wanted=()=>target||modeNow()||'servo';
  // rewrite: the mode picked is the one the servo is already in. It is still a switch, but one the page warns about and confirms twice.
  let rewrite=false;
  const again=()=>rewrite&&!!target&&target===modeNow();
  const switching=()=>again()||(viaBoot()?!!target&&target!==modeNow():!!modeNow()&&wanted()!==modeNow());
  // A programmer that cannot tell which servo this is (one answering only through its bootloader) gets one more check before writing.
  const unverified=()=>viaBoot();
  // The mode a Test drives: the servo's own, or on a V1 servo through the V2 programmer the one picked when Torque cannot know it.
  const testMode=()=>viaBoot()?wanted():servo().mode;
  // carried: a servo whose name Torque read on its own programmer just before it showed up on this one (the service's carry()).
  // It is taken to be the same servo, but not locked in: the student can still pick the other model.
  // guessed: a V1 servo the V2 programmer measured as one model (what it drew while Torque turned it). Offered the same way.
  const guessed=()=>viaBoot()&&!!servo().guessed&&!!servo().model;
  const carried=()=>viaBoot()&&(!!servo().carried||!!servo().guessed)&&!!servo().model;
  const detected=()=>carried()?null:servo().model?.code||null;
  // The servo Torque is sure of, or the one picked, or the one carried over. With nothing plugged in it is what the page previews and what Recover writes.
  const modelCode=()=>detected()||picked||(carried()?servo().model.code:null);
  // A V1 servo on the V2 programmer whose mode Torque does not know, and that was not read on the V1 programmer first.
  const unidentified=()=>viaBoot()&&snap?.programmer?.kind==='v2'&&servo().family==='v1'&&!modeNow()&&!servo().carried;
  // Asked once for each servo found that way, and for a MK2 servo on the V1 programmer that nothing is known about.
  const askedFor={},lastEpoch={};
  const IDENTIFY_ASK=()=>({title:'Which V1 servo is this?',text:'The V2 programmer cannot read which V1 servo this is (MAX+ or MINI+) or which mode it is in. Torque can find out by moving the servo: a slow crawl and a short nudge one way, then the other, about three seconds in all, ending about where it began.',more:'The servo will move. If something is attached to it that must not move, pick the servo and its mode yourself instead.',buttons:[['Move it and identify','identify-go'],['Pick it myself','cancel-ask']],closable:true});
  function offerIdentify(){
    // Once for every servo plugged in that this programmer cannot identify (the service counts them: epoch), and only for the
    // programmer the page is showing: the other one's servo is asked about when the page moves to it.
    // A question about a servo goes when that servo does: pulled out while the pop-up is up, the pop-up closes with it.
    const s=servo();if(ask?.aboutServo&&(!s.present||ask.aboutServo!==`${cur}/${s.epoch}`)){ask=null;error='';}
    if(!s.present||!viaBoot()||ask||busy()||!shown)return;const key=`${cur}/${s.epoch}`;
    // Another servo than the one before on this programmer: nothing picked for the last one carries over (a mode picked by hand for one
    // servo used to stay and silence the question for every servo after it).
    if(lastEpoch[cur]!==undefined&&lastEpoch[cur]!==key){picked=null;target=null;rewrite=false;result=null;pending={};formEpoch++;error='';}lastEpoch[cur]=key;if(askedFor[cur]===key)return;
    if(unidentified()&&s.modeHow!=='unclear'&&!picked){askedFor[cur]=key;ask={...IDENTIFY_ASK(),aboutServo:key};}
    else if(s.family==='v2'&&!s.carried&&!picked){askedFor[cur]=key;ask={title:'Which MK2 servo is this?',text:'The V1 programmer cannot read which MK2 servo this is, and it cannot move the servo to find out. Pick it here: the MAX MK2 is the bigger one.',more:'Or close this and pick it under 1 Servo, or plug it into the V2 programmer, which reads its name.',buttons:[['MINI MK2','ask-pick','mini2'],['MAX MK2','ask-pick','max2']],choice:true,closable:true,aboutServo:key};}
  }
  const modeHow=()=>{const s=servo();return s.modeHow==='written'?'Torque wrote that mode. ':s.modeHow==='carried'?`Torque read that mode on the ${other().home}. `:'Torque nudged it slightly to tell its mode. ';};
  const chosenModel=()=>modelCode()||models().find(m=>m.family===servo().family)?.code||'max1';
  const modelTitle=code=>models().find(m=>m.code===code)?.title||'servo';
  const familyOf=code=>models().find(m=>m.code===code)?.family;
  const hasSoftware=family=>snap?.software?.[family]?.found===true;
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
    if(p.rivals.length)return {tone:'warn',main:`${p.rivals.map(r=>r==='Program Software'?"Axon's V1 software":r).join(' and ')} is open`,sub:'It talks to the same programmer, and two apps at once corrupt each other. Torque waits until it closes.',closeRivals:true};
    if(p.both)return {tone:'warn',main:'Unplug one of the two programmers',sub:'The V1 and the V2 programmer are both plugged in. Torque works with one at a time: keep the V1 programmer for MAX+ and MINI+ servos, the V2 programmer for MK2 servos.'};
    if(!p.ready){
      if(p.bootSeen)return {tone:'warn',main:'The programmer is in its own update mode',sub:'Unplug it and plug it back in.'};
      if(p.handshakeFailed)return {tone:'bad',main:'The programmer is not answering',sub:'Unplug it and plug it back in. Make sure the USB cable carries data, not just charge.'};
      return {tone:'wait',main:'Plug in an Axon programmer to continue',sub:'The V2 programmer (MK2) or the V1 one. '+'Use a USB cable that carries data. USB-C powers the programmer and the servo, so no battery is needed.'};}
    if(!s.present)return {tone:'wait',main:`Plug a servo into the ${p.kind==='v1'?'V1':'V2'} programmer`,sub:p.kind==='v1'?'Top row of pins, grey signal wire on the right. The V1 programmer reads V1 servos (MAX+, MINI+); a MK2 servo needs the V2 programmer.':`Top row of pins on the left, grey signal wire on the right. The V2 programmer only talks to MK2 servos: a V1 servo (MAX+, MINI+) never answers it, so plug that one into the V1 programmer.`};
    // A V1 servo on the V2 programmer that nothing is known about yet: the student picks it, or asks Torque to move it and find out.
    if(unidentified()&&!switching())return {tone:'warn',main:`${picked?modelTitle(picked):'A V1 servo'} is on the V2 programmer`,sub:`${s.modeHow==='unclear'?'Torque moved it but could not tell its mode. ':''}The V2 programmer cannot read which V1 servo this is or which mode it is in. Pick them under 1 Servo and 2 Mode, or press Identify and Torque works both out by moving the servo slightly. Its settings need the V1 programmer.`,identify:true};
    if(viaBoot()&&!switching()){const o=other(),code=modelCode(),mine=carried()&&code===s.model.code;return {tone:'good',main:`${code?modelTitle(code):`A ${o.servo}`} is on the ${o.here}${modeNow()?`, in ${MODE[modeNow()]}`:''}`,sub:`${mine&&guessed()?`Torque nudged it slightly and it drew ${s.guessed.amps.toFixed(2)} A, which is what a ${s.model.code==='mini1'?'MINI+':'MAX+'} draws. Its name cannot be read here. `:mine?`Torque read its name on the ${o.home} before it was moved here. `:code?`You picked ${modelTitle(code)}: Torque cannot read the model on the ${o.here}. To have Torque read it, plug the servo into the ${o.home} once, then move it back here. `:''}${modeNow()?(mine&&guessed()?'':modeHow()):p.kind==='v1'?'Torque cannot tell its mode here: the V1 programmer cannot move it. ':'Torque could not tell its mode: take anything off its horn, then unplug it and plug it back in. '}Its mode can be switched here; its settings${p.kind==='v1'?' and tests':''} need the ${o.home}.${mine?' If this is a different servo, pick it under 1 Servo.':code?'':` Pick whether it is ${o.models} before switching.${s.family==='v1'&&lastV1()?` The last V1 servo read on the V1 programmer was a ${modelTitle(lastV1())}.`:''}${readyKeys().length>1?` Or plug it into the ${o.home} first and then move it here: Torque reads its name there and carries it across.`:''}`}`};}
    if(s.family==='unknown')return {tone:'bad',main:'Torque does not know this servo',sub:`It answered ${s.firmware}, which neither Axon app knows. Nothing will be written.`};
    if(switching()){
      if(!modelCode())return {tone:'warn',main:'Pick which servo this is',sub:viaBoot()?`On the ${other().here} Torque cannot tell ${other().models.replace(' or a ',' from a ')}, and each needs its own firmware. Pick it under 1 Servo: ${other().big}.`:'Torque could not read its name, and it needs the right firmware. Pick it under 1 Servo.'};
      if(again())return {tone:'warn',main:`This is already in ${MODE[wanted()]}`,sub:`Press Switch mode only to write ${MODE[wanted()]} firmware again: it resets its settings to Axon's factory values. To leave it as it is, press Discard.`,ready:true,flash:true};
      return {tone:'warn',main:`Ready to switch to ${MODE[wanted()]}`,sub:'Writes Axon\'s official firmware. It takes about a minute. Do not unplug anything.',ready:true,flash:true};}
    if(!s.editable)return {tone:'warn',main:'This servo can be switched, but its settings cannot be edited',sub:'Axon\'s V1 app has no settings layout for this variant either.'};
    if(!settings())return {tone:'busy',main:'Reading the servo...',sub:'If this does not clear, press Read. The details are under What happened.'};
    if(result&&!result.ok)return {tone:'bad',main:'It did not take',sub:result.message,ready:n>0};
    if(n)return {tone:'good',main:`Ready to write ${n} ${n===1?'change':'changes'} to the servo`,sub:'Torque reads it back after writing, and shows what the servo reports.',ready:true};
    if(result)return {tone:'good',main:'Confirmed',sub:result.message};
    if(!s.model&&s.name)return {tone:'good',main:`A ${s.family.toUpperCase()} servo named "${s.name}" is ready`,sub:'Torque does not know this model, so it shows the name the servo gave and will not switch its mode. Its settings can be changed: change one, then press Apply.'};
    return {tone:'good',main:`${s.model?s.model.title:'This servo'} is ready`,sub:'Change a setting or switch mode, then press Apply.'};
  }
  function renderBar(){
    const g=gate(),apply=$('axon-apply'),discard=$('axon-discard');
    setHtml('axon-banner',`<strong>${esc(g.main)}</strong>${g.sub?`<span>${esc(g.sub)}</span>`:''}${g.percent!==null&&g.percent!==undefined?`<progress id="axon-progress" max="100" value="${g.percent}" aria-label="Progress"></progress>`:''}${g.closeRivals?'<button id="axon-close-rivals" class="secondary" type="button" data-axon="close-rivals">Close it</button>':''}${g.identify?'<button id="axon-identify" class="secondary" type="button" data-axon="identify">Identify</button>':''}`);
    $('axon-banner').dataset.tone=g.tone;
    apply.disabled=!g.ready;apply.textContent=g.flash?'Switch mode':changeList().length?`Apply ${changeList().length} ${changeList().length===1?'change':'changes'}`:'Apply';
    discard.hidden=!(changeList().length||switching())||busy();
  }
  function renderChips(){
    const p=snap?.programmer,s=servo(),t=snap?.telemetry;
    const chip=(tone,text)=>`<span class="axon-chip" data-tone="${tone}"><i aria-hidden="true"></i>${esc(text)}</span>`;
    const one=!p?chip('wait','No programmer'):p.rivals?.length?chip('warn','Paused for another app'):p.both?chip('warn','Two programmers'):p.ready?chip(p.browningOut?'warn':'good',`${p.kind==='v1'?'V1':'V2'} programmer`):p.handshakeFailed?chip('bad','Programmer not answering'):chip('wait','No programmer');
    const two=s.present&&s.family!=='unknown'?chip('good',`${s.family.toUpperCase()} servo · ${s.mode==='cr'?'CR mode':s.mode==='servo'?'servo mode':'mode unknown'}`):s.present?chip('bad','Unknown servo'):chip('wait','No servo');
    const three=p?.kind==='v1'?'':t?chip(t.powerAlarm||t.volts>9.1?'bad':t.powerOn?'good':'warn',`${t.volts.toFixed(1)} V · ${t.amps.toFixed(1)} A`):chip('wait','-- V');
    setHtml('axon-chips',one+two+three);
    const both=readyKeys().sort(),progs=$('axon-progs');progs.hidden=both.length<2;progs.dataset.count=both.length;
    setHtml('axon-progs',both.length<2?'':both.map(k=>{const x=snaps[k],sv=x.servo,name=sv?.model?.title||(sv?.family&&sv.family!=='none'?`${sv.family.toUpperCase()} servo`:'no servo');return `<button id="axon-prog-${k}" type="button" data-axon="prog" data-which="${k}" aria-pressed="${k===cur}"><strong>${x.programmer.kind.toUpperCase()} programmer</strong> · ${esc(name)}${x.busy?' · busy':''}</button>`;}).join(''));
  }
  function renderCards(){
    // A servo Torque cannot identify shows no model as picked until the student picks one: a default would look like a choice.
    const s=servo(),here=detected(),chosen=viaBoot()?modelCode():chosenModel(),moved=carried()?s.model.code:null;
    const prog=snap?.programmer?.ready?snap.programmer.kind:null;
    setHtml('axon-models',models().map(m=>{const off=busy()||(here&&m.code!==here)||(s.present&&m.family!==s.family)||(!!prog&&m.family!==prog&&!(s.present&&s.family===m.family));
      return `<button id="axon-model-${m.code}" type="button" class="axon-card" data-axon="model" data-code="${m.code}" aria-pressed="${chosen===m.code}"${off?' disabled':''}><strong>${esc(m.title)}</strong><span${here===m.code||moved===m.code?' data-good':''}>${here===m.code?'Plugged in':moved===m.code?(guessed()?'Looks like this one':`Read on the ${other().home}`):`sold as ${esc(m.sold)}`}</span></button>`;}).join(''));
    const now=modeNow(),locked=busy()||(s.present&&s.family==='unknown')||(s.present&&!s.model&&!!s.name);
    const mode=(key,title,text)=>`<button id="axon-mode-${key}" type="button" class="axon-card" data-axon="mode" data-mode="${key}" aria-pressed="${wanted()===key}"${locked?' disabled':''}><strong>${title}${now===key?' <em>Now</em>':''}</strong><span>${text}</span></button>`;
    setHtml('axon-modes',mode('servo','Servo Mode','Moves to and holds a position')+mode('cr','CR Mode','Continuous rotation'));
  }

  // ---- settings. The rows are rebuilt only when what they show changes from outside, so polling never moves a control under a finger.
  function panel(){
    const st=settings(),s=servo(),code=chosenModel();
    if(st&&st.schema.mode===wanted())return {kind:'live',...st};
    if(switching())return {kind:'switch'};
    // No settings, not even a preview, for a servo whose mode Torque does not know: which settings it has depends on the mode, and
    // showing one mode's would look like something to edit. They appear once the mode is known: read on the servo's own programmer,
    // found by Identify, or written here by a mode switch.
    if(viaBoot()&&!modeNow()){const o=other(),v2=snap?.programmer?.kind==='v2';return {kind:'none',text:`Torque does not know which mode this ${o.servo} is in, so there are no settings to show yet. ${modelCode()?'':`Pick which servo it is under 1 Servo, then `}${modelCode()?'P':'p'}ick a mode under 2 Mode and press Switch mode: that writes the mode, and Torque then knows it.${v2?' Or press Identify, and Torque finds the mode by moving the servo slightly.':''} Its settings can only be read and changed on the ${o.home}.`};}
    if(viaBoot()&&!modelCode()){const o=other();return {kind:'none',text:`Pick which ${o.servo} this is under 1 Servo: ${o.big}. On the ${o.here} Torque cannot tell them apart, and its settings can only be read and changed on the ${o.home}.`};}
    if(s.present&&!s.editable&&s.family!=='unknown'&&!viaBoot())return {kind:'none',text:'This servo\'s settings cannot be edited, but its mode can be switched.'};
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
  // ---- Test: the servo really moves. In servo mode it runs a list of moves through the V2 programmer's pulse, and the graph shows the
  // position sent and the current the programmer measured (both real) with the modelled position (no programmer reports where a servo
  // is). In continuous rotation a slider spins it. Nothing here is written to the servo's settings.
  const POSITIONS=Array.from({length:21},(_,i)=>i/20),HOLDS=[.5,1,1.5,2,3],MAX_MOVES=5;
  let plan={steps:[{position:.5,hold:1},{position:.6,hold:1}],load:R.DEFAULT_LOAD,tol:R.DEFAULT_TOLERANCE},driveTimer=null,driveWant=0,lastRun=null;
  // Only MK2 servos: the V1 programmer cannot drive a servo, so a V1 servo has settings and nothing else.
  const testOn=p=>!!p.schema&&snap?.programmer?.kind!=='v1'&&(p.schema.family==='v2'||viaBoot())&&(p.kind==='live'||p.kind==='preview');
  const canDrive=()=>!!snap?.programmer?.ready&&snap.programmer.kind==='v2'&&(servo().family==='v2'||viaBoot());
  // Degrees from centre per µs of pulse: V1 from its Servo Angle, MK2 about 360° over 500-2500 µs at full range (Axon's figure).
  const degPerUs=(p,v)=>p.schema.family==='v1'?(v.angle||128)*355/255/2000:((v.left||250)+(v.right||250))/2/255*360/2000;
  const posText=x=>x.toFixed(2);
  const testValues=p=>p.kind==='live'?{...p.values,...pending}:p.values;
  const noDrive=()=>snap?.programmer?.kind==='v1'?'the V1 programmer has no pulse output Torque can drive, so this needs the V2 programmer and a MK2 servo.':'plug a MK2 servo into the V2 programmer.';
  function servoTestHtml(){
    const pick=(id,list,value,text,label)=>`<select id="${id}" data-axon-plan aria-label="${esc(label)}">${list.map(v=>`<option value="${v}"${Math.abs(v-value)<1e-9?' selected':''}>${esc(text(v))}</option>`).join('')}</select>`;
    const rows=plan.steps.map((st,i)=>`<div class="axon-test-step"><span>${i?`Move ${i}`:'Start'}</span>${pick(`axon-test-pos-${i}`,POSITIONS,st.position,posText,i?`Move ${i} position`:'Start position')}${pick(`axon-test-hold-${i}`,HOLDS,st.hold,v=>`${v} s`,i?`Move ${i} hold`:'Start hold')}${i&&plan.steps.length>2?`<button type="button" class="axon-test-x" data-axon-test="remove" data-step="${i}" aria-label="Remove move ${i}">×</button>`:'<i></i>'}</div>`).join('');
    const sel=(key,label,options)=>`<div class="axon-test-pick"><label for="axon-test-${key}">${esc(label)}</label><select id="axon-test-${key}" data-axon-plan>${options.map(([v,t])=>`<option value="${v}"${v===plan[key]?' selected':''}>${esc(t)}</option>`).join('')}</select></div>`;
    return `<div class="axon-test"><div class="axon-test-controls"><div class="axon-test-steps"><div class="axon-test-step axon-test-headrow"><span></span><span>Position</span><span>Hold</span><i></i></div>${rows}</div>
      <button id="axon-test-add" type="button" class="secondary" data-axon-test="add">Add a move</button><div class="axon-test-pair">${sel('load','Load',R.LOADS.map((l,i)=>[i,l.title]))}${sel('tol','Tolerance',R.TOLERANCES.map(t=>[t,`± ${t}°`]))}</div>
      <div class="axon-test-pair"><button id="axon-test-go" type="button" class="primary" data-axon-test="go">Start test</button><button id="axon-test-halt" type="button" class="secondary" data-axon-test="halt">Stop <kbd>Space</kbd></button></div></div>
      <div class="axon-test-chart"><div class="axon-try-head"><strong id="axon-test-title"></strong><span class="axon-try-legend"><span><i data-key="target"></i>Position sent</span><span><i data-key="curve"></i>Servo (model)</span><span><i data-key="current"></i>Current (measured)</span></span></div><div id="axon-test-graph" class="axon-test-graph"></div><p id="axon-test-status" class="axon-test-status" aria-live="polite"></p><div id="axon-test-facts"></div></div></div>`;
  }
  function crTestHtml(){
    return `<div class="axon-drive"><div class="axon-drive-read"><div><span>Speed</span><strong id="axon-drive-speed-v">Stopped</strong></div><div><span>Pulse</span><strong id="axon-drive-us">1500 µs</strong></div><div><span>Power</span><strong id="axon-drive-power">--</strong></div></div>
      <input id="axon-drive-speed" class="num-slider axon-slider axon-drive-slider" type="range" min="-100" max="100" step="5" value="${Math.round(driveWant*100)}" aria-label="Speed and direction">
      <div class="axon-drive-ends"><span>Full speed one way</span><i aria-hidden="true"></i><span>Full speed the other way</span></div>
      <div class="button-row"><button id="axon-drive-stop" type="button" class="primary" data-axon-test="stop">Stop <kbd>Space</kbd></button></div>
      <p id="axon-drive-note" class="axon-test-status" aria-live="polite"></p><div id="axon-drive-graph" class="axon-drive-graph"></div></div>`;
  }
  const testHtml=p=>p.schema.mode==='cr'?crTestHtml():servoTestHtml();
  // The run to draw: the one going on or last finished, or a preview of the plan.
  function servoRun(p){
    const v=testValues(p),k=degPerUs(p,v),t=snap?.test?.kind==='servo'?snap.test:null;if(t)lastRun=t;const last=lastRun;
    const model=(targets,until)=>R.track({damping:v.damping,factory:p.factory?.damping??v.damping,pwm:v.pwm,band:R.bandOf(p.schema.family,v.sens),mass:R.LOADS[plan.load].mass,targets,until});
    if(last?.plan){const targets=last.plan.slice(0,last.marks.length).map((st,i)=>[last.marks[i]/1000,(st.us-1500)*k]),until=last.plan.reduce((a,st)=>a+st.hold,0),now=last.running?(last.samples.at(-1)?.[0]||0)/1000:until;
      const every=Math.max(1,Math.floor(last.samples.length/600));return {run:last,span:last.plan.map(st=>(st.us-1500)*k),targets,until,done:!last.running,model:model(targets,now),current:last.samples.filter((s,i)=>i%every===0).map(s=>[s[0]/1000,s[3]])};}
    let at=0;const targets=plan.steps.map(st=>{const row=[at,(st.position*2000-1000)*k];at+=st.hold;return row;});return {run:null,targets,until:at,done:true,preview:true,model:model(targets,at),current:[]};
  }
  function paintTest(){
    const p=panel();if(!testOn(p))return;
    if(p.schema.mode==='cr'){if($('axon-drive-graph'))paintDrive();return;}
    if(!$('axon-test-graph'))return;
    const r=servoRun(p),moves=R.measureMoves(r.model,r.targets,plan.tol),deg=v=>`${v.toFixed(1)}°`,running=!!r.run?.running;
    $('axon-test-graph').innerHTML=R.plotRun({targets:r.targets,until:r.until,model:r.model,current:r.current,tol:plan.tol,moves,done:r.done,span:r.span});
    $('axon-test-title').textContent=r.preview?'Preview: press Start test':running?`Running move ${Math.max(1,r.run.at)} of ${r.run.plan.length-1}`:r.run.ok?'Done':'Stopped';
    const go=$('axon-test-go');go.disabled=running||busy()||!canDrive()||testMode()!=='servo';go.textContent=running?'Testing...':'Start test';$('axon-test-halt').disabled=!running;
    for(const el of root.querySelectorAll('[data-axon-plan],[data-axon-test=remove]'))el.disabled=running;$('axon-test-add').disabled=running||plan.steps.length>MAX_MOVES;
    const status=$('axon-test-status');status.dataset.tone=r.run&&!running?(r.run.ok?'good':'warn'):'';
    status.textContent=!canDrive()?`To run it, ${noDrive()}`:running?`Moving to ${posText(r.run.plan[r.run.at]?.position??.5)}.${r.run.volts?` ${r.run.volts.toFixed(2)} V, ${r.run.amps.toFixed(2)} A.`:''}`:r.run?(r.run.ok?`You did it! ${r.run.message}`:r.run.message):'Positions are what a program sends, 0 to 1 with 0.50 the center. The servo moves to each and holds it there. From a laptop\'s USB, keep moves small: a big one can pull more current than the port gives.';
    const card=(k,v,note)=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd><small>${esc(note)}</small></div>`;
    $('axon-test-facts').innerHTML=r.done?`<dl class="axon-try-facts">${moves.slice(0,3).map(m=>card(`Move ${m.index}: ${deg(m.move)}`,m.overshoot?`+${deg(m.overshoot)} past`:'No overshoot',`${m.undershoot?`${deg(m.undershoot)} short coming back, `:''}${m.settle===null?`never inside ±${plan.tol}°`:`inside ±${plan.tol}° in ${m.settle.toFixed(2)} s`}`)).join('')}${r.run?card('Lowest voltage',`${r.run.minVolts.toFixed(2)} V`,'Measured. Under 4 V the USB port is struggling'):card('From the model','Preview','This servo\'s settings and the load')}</dl>`:'';
  }
  function paintDrive(){
    const t=snap?.test?.kind==='cr'?snap.test:null,able=canDrive()&&testMode()==='cr',slider=$('axon-drive-speed');slider.disabled=!able||busy()&&snap.busy.kind!=='drive';$('axon-drive-stop').disabled=!t?.running;setFill(slider);
    $('axon-drive-speed-v').textContent=t?.running&&Math.abs(t.speed)>.02?`${Math.round(Math.abs(t.speed)*100)}% ${t.speed>0?'one way':'the other way'}`:'Stopped';
    $('axon-drive-us').textContent=`${t?.running?t.us:1500} µs`;$('axon-drive-power').textContent=t?.volts?`${t.volts.toFixed(2)} V · ${t.amps.toFixed(2)} A`:'--';
    $('axon-drive-note').textContent=!able?`To spin it, ${noDrive()}`:t?.held?'The USB port could not keep up, so Torque is holding the speed back. A powered USB hub lets it go faster.':t?.message||'Move the slider to spin it. It speeds up gently. Space, Stop or leaving this page stops it.';
    const rows=t?.samples||[];if(rows.length<2){$('axon-drive-graph').innerHTML='';return;}const t1=rows.at(-1)[0],t0=Math.max(rows[0][0],t1-10000),W=600,H=90,amp=Math.max(1,...rows.map(r=>r[3]));
    $('axon-drive-graph').innerHTML=`<svg class="axon-try-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Current over the last 10 seconds"><text class="axon-try-tick" x="4" y="12">Current (measured), last 10 s</text><polyline class="axon-try-current" points="${rows.filter(r=>r[0]>=t0).map(r=>`${((r[0]-t0)/10000*W).toFixed(1)},${(H-4-r[3]/amp*(H-20)).toFixed(1)}`).join(' ')}"/><text class="axon-try-tick" x="${W-4}" y="12" text-anchor="end">${amp.toFixed(1)} A</text></svg>`;
  }
  function setDrive(speed){driveWant=speed;if(driveTimer)return;driveTimer=setTimeout(()=>{driveTimer=null;void axon('drive',{speed:driveWant}).catch(e=>{error=e.message;render();});},90);}
  function stopDrive(){driveWant=0;if(driveTimer){clearTimeout(driveTimer);driveTimer=null;}const s=$('axon-drive-speed');if(s){s.value=0;setFill(s);}if(api&&snap?.test?.kind==='cr'&&snap.test.running)void axon('drive',{speed:null}).catch(()=>{});}
  function testAct(b){
    const a=b.dataset.axonTest;
    if(a==='add'){const last=plan.steps.at(-1);plan.steps.push({position:Math.min(1,Math.max(0,Math.round((last.position+(last.position>=.5?-.1:.1))*20)/20)),hold:1});}
    else if(a==='remove')plan.steps.splice(+b.dataset.step,1);
    else if(a==='go'){lastRun=null;void run(()=>axon('test',{steps:plan.steps}));return;}
    else if(a==='stop'){stopDrive();return;}
    else if(a==='halt'){void axon('test-stop').catch(()=>{});return;}
    formSig='';renderSettings();
  }
  function planInput(el){
    const m=el.id.match(/^axon-test-(pos|hold)-(\d+)$/);if(m)plan.steps[+m[2]][m[1]==='pos'?'position':'hold']=Number(el.value);else plan[el.id.slice('axon-test-'.length)]=Number(el.value);
    paintTest();
  }
  function renderSettings(){
    const p=panel(),box=$('axon-settings'),s=servo(),edit=p.kind==='live'&&!busy()&&!(snap?.test?.running),graph=p.kind!=='switch'&&testOn(p),testing=graph&&view==='test';
    if(!testing||p.schema?.mode!=='cr')stopDrive();
    setHtml('axon-view',graph?`<div class="segmented axon-seg axon-view" role="group" aria-label="Settings or test" data-count="2"><button type="button" data-axon="view" data-view="settings" aria-pressed="${!testing}"${snap?.test?.running?' disabled':''}>Settings</button><button type="button" data-axon="view" data-view="test" aria-pressed="${testing}">Test</button></div>`:'');
    const title=testing?(p.schema.mode==='cr'?'Spin test':'Position test'):p.schema?.title||(p.kind==='switch'?`${again()?'Write':'Switch to'} ${MODE[wanted()]}${again()?' again':''}`:'');$('axon-settings-title').textContent=title;
    const tag=$('axon-tag');tag.textContent=testing?(viaBoot()?'Moves the servo. Its settings are not readable here, so the model uses factory values.':'Moves the servo. Nothing is written to its settings.'):viaBoot()?`Factory values: this ${other().servo}'s settings are only readable on the ${other().home}`:p.kind==='live'?'Live values from the servo':p.kind==='switch'?'':s.present?'Factory values, preview only':p.kind==='preview'?'Factory values: plug in a servo to edit':'';tag.toggleAttribute('data-good',p.kind==='live'&&!testing);
    const sig=JSON.stringify([p.kind,p.text,p.schema?.title,p.values,p.factory,level,formEpoch,testing?false:busy(),wanted(),chosenModel(),testing]);if(sig===formSig){if(testing)paintTest();return;}formSig=sig;box.dataset.level=level;box.toggleAttribute('data-testing',testing);
    if(testing){box.innerHTML=testHtml(p);for(const r of box.querySelectorAll('input[type=range]'))setFill(r);paintTest();return;}
    if(p.kind==='switch'){box.innerHTML=again()?`<div class="axon-switch-note"><h4>Write ${esc(MODE[wanted()])} again</h4><p>This servo is already in ${esc(MODE[wanted()])}. Press Switch mode only to write that firmware again: its settings go back to Axon's factory values. To leave it as it is, press Discard.</p></div>`:`<div class="axon-switch-note"><h4>Switch to ${esc(MODE[wanted()])}</h4><p>Press Switch mode and this ${esc(modelCode()?modelTitle(modelCode()):'servo')} gets Axon's official firmware for that mode. Its settings go back to Axon's factory values for that mode, and they load here once it restarts.</p></div>`;return;}
    if(p.kind==='none'){box.innerHTML=p.text?`<div class="axon-switch-note"><p>${esc(p.text)}</p></div>`:'';return;}
    const fields=p.schema.fields.filter(visible),first=fields[0]?.group,two=fields.some(f=>f.group!==first),half=Math.ceil(fields.length/2),onRight=(f,i)=>level==='simple'?two&&f.group!==first:i>=half,column=right=>{const list=fields.filter((f,i)=>onRight(f,i)===right);let last=null,html='';
      for(const f of list){if(f.group&&f.group!==last)html+=`<h4 class="axon-group"><span>${esc(level==='simple'&&f.group==='Response'?'Power and direction':f.group)}</span></h4>`;last=f.group;html+=fieldRow(f,p,edit);}return html;};
    box.innerHTML=`<div class="axon-column">${column(false)}</div><div class="axon-column">${column(true)}</div>`;
    for(const r of box.querySelectorAll('input[type=range]'))setFill(r);
  }
  function renderHint(){
    $('axon-hint').textContent=pointing||(view==='test'&&$('axon-test-graph')?'The position sent and the current are measured. No programmer can report where a servo is, so its curve is a model of how the firmware uses these settings, from the servo\'s own values and the load picked. Change Damping, PWM Power or Sensitivity in Settings and the model follows.':view==='test'&&$('axon-drive-graph')?(viaBoot()?'The speed is the pulse Torque sends: 1500 µs stops it. Torque takes V1 continuous rotation as full speed at 1000 and 2000 µs, which is not measured.':'The speed is the pulse Torque sends: 1500 µs stops it, and MK2 continuous rotation reaches full speed at 1050 and 1950 µs.'):level==='advanced'?'Advanced is every setting, and all that the servo and programmer report. Point at a setting to see what it does. A dot marks a change not applied yet.':'Simple is what every student needs: how far the servo turns, where its center is, how hard it pushes and which way it goes. Advanced has the rest. A dot marks a change not applied yet.');
  }

  // ---- what the servo and programmer report, and what happened
  function renderSide(){
    const p=snap?.programmer,t=snap?.telemetry,s=servo(),adv=level==='advanced',info=p?.info,hex=v=>`0x${Number(v).toString(16).toUpperCase().padStart(2,'0')}`,st=settings();
    const signal=t&&(t.inputValid&&t.inputPeriod?`${t.inputPulse} µs, ${Math.round(1e6/t.inputPeriod)} Hz`:'None');
    setHtml('axon-report',rows([
      ['Name',s.viaBoot&&s.guessed&&s.model?`Not readable here. Measured as a ${s.model.title}`:s.viaBoot&&s.carried&&s.name?`${s.name} (read on the ${other().home})`:s.viaBoot?`Not readable on the ${other().here}`:s.present?(s.name||(st?'(not reported)':'(not read yet)')):'-'],['Mode',s.present&&s.mode!=='unknown'?cap(MODE[s.mode])+(s.viaBoot?(s.modeHow==='written'?' (written by Torque)':s.modeHow==='carried'?` (read on the ${other().home})`:' (measured)'):''):s.viaBoot?`Not readable on the ${other().here}`:'-'],adv&&['Firmware',s.present?s.firmware||'-':'-'],adv&&['Made',s.made||'-'],
      adv&&['Link',s.family==='v1'||s.family==='v2'?`${s.family.toUpperCase()} servo through ${(p?.kind||'v2').toUpperCase()} programmer`:'-']])+
      (s.viaBoot?`<p class="axon-note">On the ${other().here} only the bootloader of a ${other().servo} answers: Torque can switch its mode${p?.kind==='v2'?' and test it':''}. To read or change its settings, use the ${other().home}.</p>`:s.family==='v1'&&p?.kind==='v2'?'<p class="axon-note">On the V2 programmer only the bootloader of a V1 servo answers: Torque can switch its mode and test it. To read or change its settings, use the V1 programmer.</p>':'')+
      (p?.kind==='v1'&&!adv?'':`<h4 class="axon-side-title">${p?.kind==='v1'?'V1':'V2'} programmer</h4>`)+rows([p?.kind!=='v1'&&['Power',t?`${t.volts.toFixed(2)} V, ${t.amps.toFixed(2)} A`:'-'],adv&&['Device',p?.ready?info?.product||'HID device':'-'],adv&&['Servo pins',t?(t.powerAlarm?'Alarm: off':t.powerOn?'On':'Off'):'-'],adv&&['Pulse out',t?`${t.outputPulse} µs`:'-'],adv&&['Signal in',signal||'-'],
        ...(adv?[info&&['Maker',info.maker||'Not reported'],info&&['Serial number',info.serial||'Not reported'],info&&['USB IDs',`VID ${hex(info.vid)} PID ${hex(info.pid)}, version ${hex(info.version)}`],info&&['Report size',`${info.inLen} in, ${info.outLen} out`],t&&['Low return',t.lowReturn?'On':'Off'],t&&['Source byte',String(t.source)],t&&['Power byte',String(t.powerState)],p?.hello&&['Handshake reply',p.hello],t&&['Status report',t.raw]]:[])]));
    const idle=!busy()&&!!p?.ready,live=!!st&&!switching();
    const able={'axon-read':idle&&!!s.editable,'axon-defaults':idle&&live,'axon-open-file':!busy()&&live,'axon-save-file':!busy()&&live,'axon-recover-go':idle&&!s.present};
    for(const [id,on] of Object.entries(able))$(id).disabled=!on;$('axon-recover-go').hidden=!adv;$('axon-open-file').hidden=!adv;$('axon-save-file').hidden=!adv;
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
    // closable: an X at the top right that only closes it. A button's third part is the servo it picks. choice: the buttons are equal answers, so none is drawn as the main one.
    box.toggleAttribute('data-choice',!!ask.choice);
    box.innerHTML=`${ask.closable?'<button id="axon-ask-x" class="axon-ask-x" type="button" data-axon="cancel-ask" aria-label="Close">\u00d7</button>':''}<h2 id="axon-ask-title">${esc(ask.title)}</h2><p>${esc(ask.text)}</p>${ask.more?`<p>${esc(ask.more)}</p>`:''}<div class="button-row">${ask.buttons.map(([label,act,code],i)=>`<button id="axon-ask-${i}" class="${i||ask.choice?'secondary':'primary'}" type="button" data-axon="${act}"${code?` data-code="${code}"`:''}>${esc(label)}</button>`).join('')}</div>`;
    if(!box.open)box.showModal();
  }
  function render(){
    if(!root)return;
    // A new servo starts clean. A mode switch is the one change that announces itself: its answer and the servo's new state can arrive in either order, and it stays.
    // A servo seen only through its bootloader can drop out for a moment between checks (or while the page shows the other programmer):
    // that is not a new servo, so what the student picked stays.
    if(snap&&servo().key!==lastServoKey&&!(lastServoKey.endsWith('/boot')&&!servo().present)){lastServoKey=servo().key;pending={};formEpoch++;target=null;rewrite=false;if(!(result?.mode&&servo().present&&result.mode===servo().mode))result=null;if(servo().present&&!(servo().viaBoot&&picked&&familyOf(picked)===servo().family))picked=null;ask=null;}
    const button=$('axon-level');button.textContent=level==='advanced'?'Back to Simple':'Show Advanced';button.setAttribute('aria-pressed',String(level==='advanced'));
    offerIdentify();renderChips();renderCards();renderSettings();renderHint();renderSide();renderBar();syncAsk();renderWait();
  }
  // No programmer to talk to: nothing to pick or change yet. Another app holding it keeps the page, for its Close button.
  function renderWait(){const p=snap?.programmer,waiting=!api||!snap||!snap.busy&&(!snap.supported||!!p?.error||!p?.ready&&!p?.rivals?.length);
    root.querySelector('.axon-tab').toggleAttribute('data-waiting',waiting);$('axon-wait').hidden=!waiting;if(!waiting)return;const g=gate();$('axon-wait-title').textContent=g.main;$('axon-wait-sub').textContent=g.sub||'';}

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
    if(!status.keys){const family=familyOf(code),theirs=hasSoftware(family);ask={title:'Import your key file',text:'Switching mode writes Axon\'s firmware, and Torque does not include the keys to it. Import your key file once and Torque switches modes here from then on.',more:theirs?`Axon's own program is on this computer too, and can switch it instead.${family==='v1'?' For V1 it needs Axon\'s older programmer.':''}`:'',buttons:[...(theirs?[['Open Axon\'s software','software-switch']]:[]),['Import key file','import-keys'],['Cancel','cancel-ask']],code,mode,extra};return;}
    // Axon's firmware file is fetched from Axon's own link by itself when the switch starts: the file is only asked for if that fails.
    const needsFile=!status.have&&!status.chosen,fileAsk={title:'Firmware needed',text:`Torque could not download ${status.fileName}, Axon's official firmware for this mode. Check the internet connection and try again, or pick the file if you already have it.`,buttons:[['Try again','download'],['Choose a file','choose-firmware'],['Cancel','cancel-ask']],code,mode,extra};
    if(again()&&!extra.recovery){ask={title:`Already in ${MODE[mode]}`,text:`This servo is currently in ${MODE[mode]}. Are you sure you want to write ${MODE[mode]} firmware to it again?`,more:`It resets its settings to Axon's factory values for ${MODE[mode]}. There is no need to do this unless the servo is misbehaving.`,buttons:[['Write it again','flash'],['Cancel','cancel-ask']],code,mode,extra,again:true,fileAsk:needsFile?fileAsk:null};return;}
    ask={title:extra.recovery?'Recover a servo':`Switch to ${MODE[mode]}`,text:viaBoot()&&!extra.recovery?`This writes Axon's ${MODE[mode]} firmware for a ${modelTitle(code)} to the ${other().servo} through the ${other().here}, and resets its settings to Axon's factory values. Torque checks it is a ${other().servo}, but cannot tell ${other().models.replace(' or a ',' from a ')} here: make sure it is a ${modelTitle(code)} (${models().find(m=>m.code===code)?.sold}).${modeNow()?'':` Torque cannot tell which mode it is in now either: if it is already in ${MODE[mode]}, there is no need to switch.`}`:extra.recovery?`Use this if a mode switch was interrupted and the servo no longer shows up. It writes ${modelTitle(code)} ${MODE[mode]} firmware, so check that the servo and mode picked are right. Torque still checks the hardware ID, but it cannot check the servo's name.`:`This writes Axon's ${MODE[mode]} firmware to the servo and resets its settings to Axon's factory values for that mode. Save a settings file first if you want to keep them.`,
      more:'',buttons:[[extra.recovery?'Write the firmware':'Switch mode','flash'],['Cancel','cancel-ask']],code,mode,extra,fileAsk:needsFile?fileAsk:null};
  }
  // Whether this programmer can tell the mode (the V2 programmer measures a V1 servo's; the V1 programmer cannot move a MK2 servo).
  const p2=()=>snap?.programmer?.kind==='v2';
  async function doFlash({code,mode,extra={},fileAsk=null,again:same=false,confirmed=null},allowUnknownName=false){
    closeAsk();render();
    try{result=await axon('flash',{code,mode,recovery:!!extra.recovery,allowUnknownName,again:!!same,confirmed});}
    // An error's code does not cross into the page, only its words.
    catch(e){if(/name could not be read/.test(e.message)){ask={title:'Servo name unavailable',text:e.message,more:'Write the firmware anyway?',buttons:[['Write it anyway','flash-anyway'],['Cancel','cancel-ask']],code,mode,extra,fileAsk};return;}if(fileAsk){ask={...fileAsk,more:e.message};return;}throw e;}
    if(result?.ok){target=null;rewrite=false;pending={};formEpoch++;}
  }
  const actions={
    level:()=>{level=level==='advanced'?'simple':'advanced';if(level==='simple'){const st=settings();for(const key of Object.keys(pending))if(st?.schema.fields.find(f=>f.key===key)?.advanced)delete pending[key];}formEpoch++;syncTrace();},
    'close-rivals':()=>axon('close-rivals'),read:()=>axon('read'),identify:()=>{ask={...IDENTIFY_ASK(),aboutServo:`${cur}/${servo().epoch}`};},
    // A servo pulled out before or during the movement is not an error to show: the page already says it is gone.
    'identify-go':async()=>{closeAsk();render();try{await axon('identify');}catch(e){if(servo().present&&viaBoot())throw e;}},
    model:b=>{picked=b.dataset.code;},
    prog:b=>{choose(b.dataset.which);formSig='';},
    view:b=>{view=b.dataset.view;formSig='';},
    mode:b=>{target=b.dataset.mode;rewrite=target===modeNow();ask=null;result=null;},
    apply:async()=>{if(switching())return startSwitch();const changes={...pending};if(!Object.keys(changes).length)return;result=await axon('write',{changes});if(result.ok){pending={};formEpoch++;}},
    discard:()=>{pending={};target=null;rewrite=false;ask=null;result=null;formEpoch++;},
    defaults:()=>{ask={title:'Restore factory settings',text:'This resets every setting on this servo to Axon\'s factory values.',buttons:[['Restore factory settings','defaults-go'],['Cancel','cancel-ask']]};},
    'defaults-go':async()=>{closeAsk();render();const r=await axon('defaults');pending={};formEpoch++;result={ok:r.ok,changed:r.ok,message:r.ok?'Factory settings restored and read back.':'The servo refused the factory reset.'};},
    'open-file':async()=>{const r=await axon('open-settings');if(!r)return;const st=settings();pending={};for(const f of st.schema.fields.filter(visible))if(r.values[f.key]!==undefined&&r.values[f.key]!==st.values[f.key])pending[f.key]=r.values[f.key];result=null;formEpoch++;},
    'save-file':()=>axon('save-settings',{changes:pending}),
    'cancel-ask':()=>closeAsk(),
    // A servo picked in the pop-up: the same as pressing its card under 1 Servo.
    'ask-pick':b=>{picked=b.dataset.code;closeAsk();},
    download:async()=>{const a=ask;closeAsk();render();await axon('download',{code:a.code,mode:a.mode});await startSwitch({...a.extra,code:a.code,mode:a.mode});},
    'software-switch':async()=>{const a=ask;await axon('software-open',{family:familyOf(a.code)});closeAsk();},
    'import-keys':async()=>{const a=ask,r=await axon('import-keys');if(!r)return;closeAsk();await startSwitch({...a.extra,code:a.code,mode:a.mode});},
    'choose-firmware':async()=>{const a=ask,r=await axon('choose-firmware',{code:a.code,mode:a.mode});if(!r)return;closeAsk();await startSwitch({...a.extra,code:a.code,mode:a.mode});},
    flash:()=>{const a=ask;if(unverified()&&!a.extra?.recovery){const o=other(),m=models().find(x=>x.code===a.code);ask={...a,title:'Check the servo first',text:`${guessed()&&a.code===servo().model.code?`Torque measured this servo as a ${modelTitle(a.code)} from the current it drew, which is not the same as reading its name. `:carried()&&a.code===servo().model.code?`Torque read a ${modelTitle(a.code)} on the ${o.home} just before this servo showed up here, and takes it to be the same one. `:''}Torque cannot verify which servo this is with the ${o.here}: it cannot read its name${p2()?'':' or its mode'}. Make sure the servo plugged in is a ${modelTitle(a.code)} (sold as ${m?.sold}), and that ${MODE[a.mode]} is what you want.`,more:`${o.big[0].toUpperCase()+o.big.slice(1)}. Writing the wrong model's firmware can make the servo misbehave. If you are not sure, plug it into the ${o.home}, where Torque reads its name and mode.`,buttons:[[`Yes, it is a ${modelTitle(a.code)}`,'flash-checked'],['Cancel','cancel-ask']],confirmed:a.code};return;}return doFlash(a);},
    'flash-checked':()=>{const a=ask;return doFlash({...a,code:a.confirmed});},'flash-anyway':()=>doFlash(ask,true),
    recover:()=>startSwitch({recovery:true,code:chosenModel(),mode:wanted()}),
  };
  function onClick(e){
    const t=e.target.closest('[data-axon-test]');if(t){if(!t.disabled)testAct(t);return;}
    const seg=e.target.closest('[data-axon-seg]');
    if(seg&&!seg.disabled){for(const b of seg.parentElement.children)b.setAttribute('aria-pressed',String(b===seg));setValue(seg.dataset.axonSeg,Number(seg.dataset.value));return;}
    const nudge=e.target.closest('[data-axon-nudge]');
    if(nudge&&!nudge.disabled){const r=document.getElementById(nudge.dataset.for),v=Math.max(+r.min,Math.min(+r.max,+r.value+Number(nudge.dataset.axonNudge)));r.value=v;setFill(r);setValue(r.dataset.axonKey,v);return;}
    const b=e.target.closest('[data-axon]');if(!b||b.disabled)return;const act=actions[b.dataset.axon];if(act)void run(()=>act(b));
  }
  function onInput(e){
    const el=e.target;if(el.matches('[data-axon-plan]')){planInput(el);return;}if(el.id==='axon-drive-speed'){setFill(el);setDrive(Number(el.value)/100);return;}
    if(!el.matches('[data-axon-key]'))return;const key=el.dataset.axonKey;
    if(el.type==='range'){setFill(el);setValue(key,Number(el.value));}
    else if(el.type==='checkbox'){el.nextElementSibling.textContent=el.checked?'On':'Off';setValue(key,el.checked?1:0);}
    else setValue(key,el.value);
  }
  // Touch has no hover, so a tap or a keyboard focus shows the hint too.
  function onPoint(e){const row=e.target.closest?.('[data-axon-field]');const st=panel();if(row&&st.schema){const f=st.schema.fields.find(x=>x.key===row.dataset.axonField);pointing=f?.what||'';renderHint();}else if(pointing&&e.type==='pointerover'&&!e.target.closest?.('#axon-settings')){pointing='';renderHint();}}
  function syncTrace(){const on=shown&&level==='advanced'&&$('axon-usb')?.open;if(on&&!traceTimer){const tick=async()=>{try{const lines=await axon('trace');const pre=$('axon-usb-log');if(pre)pre.textContent=lines.slice(-120).join('\n');}catch{}};void tick();traceTimer=setInterval(tick,1000);}else if(!on&&traceTimer){clearInterval(traceTimer);traceTimer=null;}}
  function start(){if(!api){render();return;}void axon('start').then(list=>{for(const s of [].concat(list))snaps[s.which]=s;pickSnap();render();},e=>{error=e.message;render();});}
  function stop(){stopDrive();if(traceTimer){clearInterval(traceTimer);traceTimer=null;}if(api)void axon('stop').catch(()=>{});}

  const PAGE=`<div class="axon-tab">
    <div class="axon-top"><h2>Axon Programmer</h2><div id="axon-progs" class="segmented axon-seg axon-progs" role="group" aria-label="Which programmer" hidden></div><div id="axon-chips" class="axon-chips"></div><button id="axon-level" class="secondary" type="button" data-axon="level" aria-pressed="false">Show Advanced</button></div>
    <div class="axon-picks"><section aria-labelledby="axon-models-title"><h3 id="axon-models-title" class="axon-step-title"><span>1</span>Servo</h3><div id="axon-models" class="axon-cards"></div></section><section aria-labelledby="axon-modes-title"><h3 id="axon-modes-title" class="axon-step-title"><span>2</span>Mode</h3><div id="axon-modes" class="axon-cards"></div></section></div>
    <div class="axon-main">
      <section class="cal-card axon-settings" aria-labelledby="axon-settings-title"><div class="axon-settings-head"><h3 class="axon-step-title"><span>3</span>Settings<b aria-hidden="true">·</b><em id="axon-settings-title"></em></h3><div id="axon-view"></div><span id="axon-tag"></span></div><div id="axon-settings" class="axon-settings-body"></div><p id="axon-hint" class="hint" aria-live="polite"></p></section>
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
    <div id="axon-wait" class="axon-wait" role="status" hidden><h2 id="axon-wait-title"></h2><p id="axon-wait-sub" class="hint"></p></div>
  </div>`;

  return {
    install(box,deck){if(!box)return;root=box;api=deck&&typeof deck.axon==='function'?deck:null;box.innerHTML=PAGE;box.addEventListener('click',onClick);box.addEventListener('input',onInput);box.addEventListener('pointerover',onPoint);box.addEventListener('focusin',onPoint);box.addEventListener('toggle',syncTrace,true);
      // Space stops a spinning servo or a running test from anywhere on the tab, except while typing.
      document.addEventListener('keydown',e=>{if(e.code!=='Space'||!shown||!$('axon-drive-speed')&&!snap?.test?.running||e.target.closest?.('input[type=text],textarea,select,[contenteditable]'))return;e.preventDefault();if(snap?.test?.kind==='servo'&&snap.test.running)void axon('test-stop').catch(()=>{});else stopDrive();render();},true);
      $('axon-ask').addEventListener('cancel',()=>{ask=null;});
      if(api)api.onAxon(s=>{snaps[s.which]=s;pickSnap();if(shown)render();});
      render();},
    // Whether the tab is on screen. USB runs only while it shows.
    shown(on){if(!root||on===shown)return;shown=on;if(on)start();else stop();syncTrace();},
  };
})();
