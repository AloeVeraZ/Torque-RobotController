(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckRealTeleop=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Calibrate → Real run: the TeleOp for this robot, written from Setup and from what Calibrate measured, and put on the
  // robot. The chassis is on the sticks (which stick drives and which turns, spin buttons, a wheel lock on a swerve); each
  // mechanism in Setup is on buttons (ui/sim-chassis-teleop.js writes the Java). Nothing is typed by hand: the team picks
  // what each control does, and Torque sends the file whenever it changes while a robot is connected. The file and the
  // calibrated values can also be saved for the team's own code.
  //   o: {box, T (DeckChassisTeleop), chassis() -> teleopOf's input or null, map(), setMap(k, v), swerve(),
  //       mechs() -> [{id, label, device, kind: 'motor'|'crservo'|'servo', type, template, reversed, posA, posB}],
  //       store: {get() -> {pad, auto, mechs}, set(v)}, sent: {get() -> text, set(text)} (what was last sent, kept apart),
  //       send(t) -> Promise<text>, connected(), busy() -> a reason it cannot be sent now or '', visible(),
  //       saveFile(name, text) -> Promise<path|null>, copy(text), values() -> {java, json} or null, toSetup()}
  const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const sig=t=>{let h=5381;for(let i=0;i<t.length;i++)h=(h*33^t.charCodeAt(i))>>>0;return h.toString(36)+':'+t.length;};
  const KIND={motor:'Motor',crservo:'Continuous servo',servo:'Servo'};
  // The choices as kept: only what the lists allow.
  function clean(raw,T){const r=raw&&typeof raw==='object'?raw:{},mechs={};for(const [id,m] of Object.entries(r.mechs&&typeof r.mechs==='object'?r.mechs:{})){if(!m||typeof m!=='object')continue;const out={};
      if(Object.hasOwn(T.MODES,m.mode))out.mode=m.mode;for(const k of ['a','b'])if(m[k]==='none'||Object.hasOwn(T.BUTTONS,m[k]))out[k]=m[k];for(const k of ['power','posA','posB'])if(Number.isFinite(+m[k])&&m[k]!==''&&m[k]!==null)out[k]=+m[k];mechs[id]=out;}
    return {pad:r.pad==='gamepad2'?'gamepad2':'gamepad1',auto:r.auto!==false,mechs};}
  // The whole TeleOp from the choices: {tele: {file, opMode, source} | {error}, list (each mechanism with its choices), clashes, state}.
  function build(o){const T=o.T,state=clean(o.store.get(),T),chassis=o.chassis(),map=o.map(),swerve=!!o.swerve(),mechs=o.mechs()||[];
    const picked=T.mechMap(mechs,state.mechs,{pad:state.pad,map,swerve}),list=mechs.map(m=>({...m,...picked[m.id]})),clashes=T.clashes(list,{pad:state.pad,map,swerve});
    const tele=chassis?T.teleopOf({...chassis,map,className:T.FULL_NAME,opMode:T.FULL_OP_MODE,mechanisms:list,pad:state.pad}):{error:'This setup has no chassis Torque writes a TeleOp for yet.'};
    return {tele,list,clashes,state,map,swerve};}
  function create(o){const box=o.box,T=o.T;let sending=false,said='',savedNote='',timer=null,drawn='';
    const lastSent=()=>{try{return JSON.parse(o.sent.get()||'null')||{};}catch{return {};}};
    const keep=fn=>{const s=clean(o.store.get(),T);fn(s);o.store.set(s);};
    const status=b=>{const last=lastSent(),same=b.tele.source&&last.sig===sig(b.tele.source);
      if(sending)return 'Sending it to the robot and building it there…';if(said)return said;if(b.tele.error)return '';
      if(same)return `On the robot as “${T.FULL_OP_MODE}”${last.at?`, sent ${last.at}`:''}. Pick it in Drive.`;
      if(!o.connected())return b.state.auto?'No robot connected: plug in the Control Hub and it is sent by itself.':'No robot connected.';
      const why=o.busy();if(why)return `${why} It is sent when that is done${b.state.auto?'':' and you press Send'}.`;
      return last.sig?'Changed since it was last sent.':'Not on the robot yet.';};
    function render(){const b=build(o),m=b.map,pick=(k,label)=>`<div class="cal-field"><label for="rt-map-${k}">${label}</label><select id="rt-map-${k}" data-rt-map="${k}">${Object.entries(T.MAP[k]).map(([v,t])=>`<option value="${v}"${m[k]===v?' selected':''}>${esc(t)}</option>`).join('')}</select></div>`;
      const taken=new Map();for(const x of b.list)if(x.mode!=='off')for(const k of ['a','b'])if(x[k]&&x[k]!=='none')taken.set(x[k],x.label);
      const chassisHas=b.state.pad==='gamepad1'?T.chassisButtons(m,b.swerve):[];
      const btn=(x,k,label)=>`<div class="cal-field"><label for="rt-${k}-${esc(x.id)}">${esc(label)}</label><select id="rt-${k}-${esc(x.id)}" data-rt-btn="${esc(x.id)}" data-k="${k}">${k==='b'&&!['updown','positions'].includes(x.mode)?`<option value="none"${x[k]==='none'?' selected':''}>No button</option>`:''}${Object.entries(T.BUTTONS).filter(([v])=>!chassisHas.includes(v)).map(([v,t])=>`<option value="${v}"${x[k]===v?' selected':''}>${esc(t)}${taken.has(v)&&x[k]!==v?` (swaps with ${esc(taken.get(v))})`:''}</option>`).join('')}</select></div>`;
      const num=(x,k,label,min,max,step)=>`<div class="cal-field"><label for="rt-${k}-${esc(x.id)}">${esc(label)}</label><input id="rt-${k}-${esc(x.id)}" type="number" min="${min}" max="${max}" step="${step}" value="${x[k]}" data-rt-num="${esc(x.id)}" data-k="${k}"></div>`;
      const rows=b.list.map(x=>{const modes=T.modesFor(x.kind),uses=T.USES[x.mode]||[],servo=x.kind==='servo',unset=servo&&x.mode!=='off'&&x.posA===x.posB;
        return `<div class="rt-mech" data-rt-mech="${esc(x.id)}"><div class="rt-mech-head"><b>${esc(x.label)}</b><small>${esc(KIND[x.kind]||x.kind)} “${esc(x.device||'not named yet')}”</small></div>
          <div class="cal-fields"><div class="cal-field"><label for="rt-mode-${esc(x.id)}">What it does</label><select id="rt-mode-${esc(x.id)}" data-rt-mode="${esc(x.id)}">${modes.map(v=>`<option value="${v}"${x.mode===v?' selected':''}>${esc(T.MODES[v])}</option>`).join('')}</select></div>
          ${x.mode==='off'?'':`${btn(x,'a',uses[0])}${uses[1]!==null?btn(x,'b',uses[1]):''}${servo?num(x,'posA',x.mode==='flip'?'Position at the start (0 to 1)':'First position (0 to 1)',0,1,.01)+num(x,'posB',x.mode==='flip'?'The other position (0 to 1)':'Second position (0 to 1)',0,1,.01):num(x,'power','Power (0 to 1)',.05,1,.05)}`}</div>
          ${x.full?'<p class="cal-sense-note bad">No button is left for it on this controller: free one above, or put the mechanisms on a second controller.</p>':!x.device?'<p class="cal-sense-note bad">It has no name in the robot configuration yet: name it in Setup → Mechanisms.</p>':unset?'<p class="cal-note">Both positions are the same, so it will not move: type where it should go (0 to 1). Start near the middle and work outwards.</p>':''}</div>`;}).join('');
      const src=b.tele.source||'',values=o.values?.()||null,can=!b.tele.error&&!!src;
      const html=`<section class="cal-card rr-card rt-card"><h2>TeleOp for this robot</h2><p class="hint">Written from Setup and from what Calibrate measured: the chassis on the sticks, each mechanism on its buttons. Torque puts it on the robot, where it shows in Drive as “${esc(T.FULL_OP_MODE)}”.</p>
        <h3 class="cal-group-title">Chassis</h3><div class="cal-fields cal-drive-map">${pick('drive','Drive with')}${pick('turn','Turn with')}${pick('field','Forward means')}${pick('spin','Spin on the spot')}${b.swerve?pick('lock','Lock the wheels'):''}${pick('slow','Slow button')}${pick('reset','Set heading to 0')}</div>
        ${b.tele.error?`<p class="cal-sense-note bad">${esc(b.tele.error)}</p>`:''}
        <h3 class="cal-group-title">Mechanisms</h3>${b.list.length?`<div class="cal-fields"><div class="cal-field"><label for="rt-pad">Their buttons are on</label><select id="rt-pad" data-rt-pad><option value="gamepad1"${b.state.pad==='gamepad1'?' selected':''}>Controller 1, with the driving</option><option value="gamepad2"${b.state.pad==='gamepad2'?' selected':''}>Controller 2, a second driver</option></select></div></div>${rows}`:`<p class="hint">This setup has no mechanisms yet, so the TeleOp drives the chassis only. Add them in Setup → Mechanisms and they show up here with buttons.</p><div class="button-row"><button type="button" class="secondary" data-rt="setup">Open Setup → Mechanisms</button></div>`}
        ${b.clashes.length?`<p class="cal-sense-note bad">${b.clashes.map(c=>`${esc(c.name)} does two things (${esc(c.uses.join(', '))})`).join('; ')}. Pick another button for one of them.</p>`:''}
        <div class="button-row rt-send"><button type="button" class="primary" data-rt="send"${!can||sending?' disabled':''}>${sending?'Sending…':'Send to the robot'}</button><label class="rt-auto"><input type="checkbox" data-rt-auto${b.state.auto?' checked':''}> Send it by itself when it changes</label></div>
        <p class="hint" role="status" data-rt-status>${esc(status(b))}</p>
        <div class="button-row"><button type="button" class="secondary" data-rt="save"${can?'':' disabled'}>Save as a file…</button><button type="button" class="secondary" data-rt="copy"${can?'':' disabled'}>Copy</button><span class="hint" role="status" data-rt-saved>${esc(savedNote)}</span></div>
        ${src?`<details class="usb-facts"><summary>See the code</summary><pre class="cal-cam-code cal-chassis-code" data-rt-code>${esc(src)}</pre></details>`:''}</section>
        <section class="cal-card rr-card rt-card"><h2>Calibrated values</h2><p class="hint">Everything Calibrate measured on this robot’s chassis, for the team’s own code or another computer: as a Java class to copy into TeamCode, or as a JSON file of the raw numbers.</p>
        ${values?`<div class="button-row"><button type="button" class="secondary" data-rt="values-java">Save the Java class…</button><button type="button" class="secondary" data-rt="values-json">Save as JSON…</button><button type="button" class="secondary" data-rt="values-copy">Copy the class</button></div><details class="usb-facts"><summary>See the values</summary><pre class="cal-cam-code cal-chassis-code">${esc(values.java)}</pre></details>`:'<p class="hint">Nothing is measured yet: Calibrate → Mechanisms → Chassis measures it.</p>'}</section>`;
      // The same page again changes nothing: an open list or a field being typed in is left alone.
      if(html!==drawn){drawn=html;box.innerHTML=html;}auto(b);}
    // Sent by itself: when Real run is showing, a robot is connected, nothing else is using it, and what is on the robot
    // is not what is written now. It waits a moment, so a run of changes goes as one.
    function auto(b){clearTimeout(timer);if(!b.state.auto||sending||b.tele.error||!b.tele.source||b.clashes.length||!o.visible()||!o.connected()||o.busy())return;if(lastSent().sig===sig(b.tele.source))return;
      timer=setTimeout(()=>{const now=build(o);if(now.tele.source&&now.state.auto&&o.visible()&&o.connected()&&!o.busy()&&!now.clashes.length&&lastSent().sig!==sig(now.tele.source))void send(now);},1500);}
    function send(b){if(sending||b.tele.error||!b.tele.source)return Promise.resolve();sending=true;said='';render();const t=b.tele;
      return Promise.resolve().then(()=>o.send(t)).then(()=>{o.sent.set(JSON.stringify({sig:sig(t.source),at:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}));said='';},e=>{said=`It did not get there: ${e?.message||e}`;}).finally(()=>{sending=false;render();});}
    box.addEventListener('change',e=>{const t=e.target,d=t.dataset;said='';
      if(d.rtMap)return void o.setMap(d.rtMap,t.value);
      if('rtPad' in d){keep(s=>{s.pad=t.value==='gamepad2'?'gamepad2':'gamepad1';});return render();}
      if('rtAuto' in d){keep(s=>{s.auto=!!t.checked;});return render();}
      if(d.rtMode){keep(s=>{s.mechs[d.rtMode]={...s.mechs[d.rtMode],mode:t.value};delete s.mechs[d.rtMode].a;delete s.mechs[d.rtMode].b;});return render();}
      // A button another mechanism has: the two swap.
      if(d.rtBtn){const b=build(o),me=b.list.find(x=>x.id===d.rtBtn),other=t.value==='none'?null:b.list.find(x=>x.id!==d.rtBtn&&x.mode!=='off'&&(x.a===t.value||x.b===t.value)),mine=me?.[d.k];
        keep(s=>{for(const x of b.list)if(x.mode!=='off')s.mechs[x.id]={...s.mechs[x.id],mode:x.mode,a:x.a,b:x.b};s.mechs[d.rtBtn][d.k]=t.value;
          const ok=d.k==='a'?'b':'a';if(t.value!=='none'&&s.mechs[d.rtBtn][ok]===t.value)s.mechs[d.rtBtn][ok]=mine&&mine!=='none'?mine:'none';
          if(other){const k2=other.a===t.value?'a':'b';s.mechs[other.id][k2]=mine&&mine!=='none'?mine:undefined;if(s.mechs[other.id][k2]===undefined)delete s.mechs[other.id][k2];}});return render();}
      if(d.rtNum){const v=+t.value;if(!Number.isFinite(v))return;keep(s=>{s.mechs[d.rtNum]={...s.mechs[d.rtNum],[d.k]:d.k==='power'?Math.max(.05,Math.min(1,v)):Math.max(0,Math.min(1,v))};});return render();}});
    box.addEventListener('click',e=>{const a=e.target.closest('[data-rt]')?.dataset.rt;if(!a)return;const b=build(o),note=t=>{savedNote=t;const n=box.querySelector('[data-rt-saved]');if(n)n.textContent=t;drawn='';};
      const saved=name=>f=>note(f?`Saved to ${f}`:''),failed=x=>note(`It was not saved: ${x?.message||x}`);
      if(a==='setup')return void o.toSetup?.();
      if(a==='send'){said='';return void send(b);}
      if(a==='save'&&b.tele.source)return void Promise.resolve(o.saveFile(b.tele.file,b.tele.source)).then(saved(),failed);
      if(a==='copy'&&b.tele.source)return void Promise.resolve(o.copy(b.tele.source)).then(()=>note('Copied.'),()=>note('It could not be copied: open See the code and select it.'));
      const v=o.values?.();if(!v)return;
      if(a==='values-java')return void Promise.resolve(o.saveFile('TorqueCalibration.java',v.java)).then(saved(),failed);
      if(a==='values-json')return void Promise.resolve(o.saveFile(v.jsonName||'torque-calibration.json',v.json)).then(saved(),failed);
      if(a==='values-copy')return void Promise.resolve(o.copy(v.java)).then(()=>note('Copied.'),()=>note('It could not be copied.'));});
    return {refresh:render,build:()=>build(o)};}
  return {create,build,clean};});
