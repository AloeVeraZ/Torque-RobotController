(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckTeleopTab=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Calibrate → TeleOp: everything about driving the real robot, in one place.
  //   Driving      the controller, live (the keyboard too, when it is Controller 1: W A S D moves the left stick), beside
  //                a picture of the chassis doing what the TeleOp will do with that input: a swerve's pods turning the
  //                shortest way (or staying put and running their motors backwards), a mecanum's wheels strafing. It is
  //                the same arithmetic the robot runs (ui/sim-chassis-teleop.js: command, swerveDrive, wheelPowers).
  //                Each job is picked from a list or bound by moving the stick or pressing the button it should be on.
  //   Mechanisms   each one Setup has, on buttons nothing else uses.
  //   On the robot the TeleOp, sent whenever it changes while a robot is connected; saved or copied for the team's code.
  //   Calibration  everything Calibrate measured (chassis, mechanisms, cameras) as one class that builds in OnBot Java.
  //   o: {box, T (DeckChassisTeleop), art (DeckControllerArt), chassis() -> teleopOf's input or null, map(), setMap(k, v),
  //       swerve(), mechs() -> [{id, label, device, kind, type, template, reversed, posA, posB}],
  //       store: {get() -> {pad, auto, mechs}, set(v)}, sent: {get() -> text, set(text)} (what was last sent, kept apart),
  //       send(t) -> Promise, connected(), busy() -> why it cannot be sent now or '', visible(),
  //       onInput(fn) (the app's controller state as it changes), inputNow() -> Promise<state>, openController(),
  //       saveFile(name, text) -> Promise<path|null>, copy(text), values() -> {java, json, jsonName} or null,
  //       sendValues(java) -> Promise<text>, toSetup()}
  const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const sig=t=>{let h=5381;for(let i=0;i<t.length;i++)h=(h*33^t.charCodeAt(i))>>>0;return h.toString(36)+':'+t.length;};
  const KIND={motor:'Motor',crservo:'Continuous servo',servo:'Servo'};
  // The standard gamepad's buttons, by their FTC names, in the Gamepad API's order.
  const ORDER=['a','b','x','y','left_bumper','right_bumper','left_trigger','right_trigger','back','start','left_stick_button','right_stick_button','dpad_up','dpad_down','dpad_left','dpad_right'];
  const clamp1=v=>Number.isFinite(+v)?Math.max(-1,Math.min(1,+v)):0;
  // A controller reading as the drive arithmetic takes it: sticks (with a small dead zone), triggers, each button by name.
  function padOf(reading){const ax=i=>{const v=clamp1(reading?.axes?.[i]);return Math.abs(v)<.08?0:v;},bv=i=>{const b=reading?.buttons?.[i];return Math.max(0,clamp1(typeof b==='object'&&b?b.value:b));};
    const p={lx:ax(0),ly:ax(1),rx:ax(2),ry:ax(3),lt:bv(6),rt:bv(7)};ORDER.forEach((n,i)=>{p[n]=bv(i)>.5;});return p;}
  // The choices as kept: only what the lists allow.
  function clean(raw,T){const r=raw&&typeof raw==='object'?raw:{},mechs={};for(const [id,m] of Object.entries(r.mechs&&typeof r.mechs==='object'?r.mechs:{})){if(!m||typeof m!=='object')continue;const out={};
      if(Object.hasOwn(T.MODES,m.mode))out.mode=m.mode;for(const k of ['a','b'])if(m[k]==='none'||Object.hasOwn(T.BUTTONS,m[k]))out[k]=m[k];for(const k of ['power','posA','posB'])if(Number.isFinite(+m[k])&&m[k]!==''&&m[k]!==null)out[k]=+m[k];mechs[id]=out;}
    return {pad:r.pad==='gamepad2'?'gamepad2':'gamepad1',auto:r.auto!==false,mechs};}
  // The whole TeleOp from the choices: {tele: {file, opMode, source} | {error}, list (each mechanism with its choices), clashes, state}.
  function build(o){const T=o.T,state=clean(o.store.get(),T),chassis=o.chassis(),map=o.map(),swerve=!!o.swerve(),mechs=o.mechs()||[];
    const picked=T.mechMap(mechs,state.mechs,{pad:state.pad,map,swerve}),list=mechs.map(m=>({...m,...picked[m.id]})),clashes=T.clashes(list,{pad:state.pad,map,swerve});
    const tele=chassis?T.teleopOf({...chassis,map,className:T.FULL_NAME,opMode:T.FULL_OP_MODE,mechanisms:list,pad:state.pad}):{error:'This setup has no chassis Torque writes a TeleOp for yet.'};
    return {tele,list,clashes,state,map,swerve,chassis};}
  // ---- the chassis, from above: forward is up ----------------------------------------------------------------------------
  // Its wheels where they are on the robot. A swerve's pods turn (data-rt-pod) and every wheel has an arrow for its motor
  // (data-rt-arrow): the live loop moves them.
  const arrow=i=>`<g data-rt-arrow="${i}"><line x1="0" y1="0" x2="0" y2="0"/><path d=""/></g>`;
  function chassisArt(c){if(!c)return '';const W=220,pt=(x,y,k)=>[+(-y*k).toFixed(1),+(-x*k).toFixed(1)];
    if(c.kind==='swerve'){const pods=c.pods||[],far=Math.max(1,...pods.map(p=>Math.hypot(p.x,p.y))),k=62/far,pts=pods.map(p=>pt(p.x,p.y,k)),hull=[...pts].sort((a,b)=>Math.atan2(a[1],a[0])-Math.atan2(b[1],b[0]));
      return `<svg class="rt-chassis-art" viewBox="${-W/2} ${-W/2} ${W} ${W}" role="img" aria-label="The chassis from above: each pod and which way its motor runs"><polygon class="rt-body" points="${hull.map(p=>p.join(',')).join(' ')}"/><path class="rt-front" d="M-7 ${-W/2+16}L0 ${-W/2+5}L7 ${-W/2+16}Z"/><text class="rt-front-t" x="0" y="${-W/2+27}">front</text>
        ${pods.map((p,i)=>`<g transform="translate(${pts[i][0]} ${pts[i][1]})"><g data-rt-pod="${i}"><rect class="rt-wheel" x="-7" y="-15" width="14" height="30" rx="4"/><path class="rt-nose" d="M-4 -11L0 -16L4 -11"/>${arrow(i)}</g></g>`).join('')}<g data-rt-go><line x1="0" y1="0" x2="0" y2="0"/><circle r="3"/></g></svg>`;}
    const ms=c.motors||[],side=key=>/right/i.test(key)?1:-1,row=key=>/front/i.test(key)?-1:/back/i.test(key)?1:0,tank=c.kind==='tank';
    return `<svg class="rt-chassis-art" viewBox="${-W/2} ${-W/2} ${W} ${W}" role="img" aria-label="The chassis from above: each wheel and which way its motor runs"><rect class="rt-body" x="-42" y="-58" width="84" height="116" rx="8"/><path class="rt-front" d="M-7 ${-W/2+16}L0 ${-W/2+5}L7 ${-W/2+16}Z"/><text class="rt-front-t" x="0" y="${-W/2+27}">front</text>
      ${ms.map((m,i)=>{const x=side(m.key)*54,y=row(m.key)*42,lean=tank?0:side(m.key)*row(m.key)<0?1:-1;return `<g transform="translate(${x} ${y})"><rect class="rt-wheel" x="-9" y="-19" width="18" height="38" rx="4"/>${tank?'':`<path class="rt-roller" d="M-6 ${lean*-10}L6 ${lean*-2}M-6 ${lean*-2}L6 ${lean*6}M-6 ${lean*6}L6 ${lean*14}"/>`}${arrow(i)}</g>`;}).join('')}<g data-rt-go><line x1="0" y1="0" x2="0" y2="0"/><circle r="3"/></g></svg>`;}
  // A motor's arrow: up the wheel for forwards, down for backwards, as long as the power.
  function setArrow(g,power){if(!g)return;const len=Math.round(Math.max(-1,Math.min(1,power))*34),line=g.firstElementChild,head=g.lastElementChild,on=Math.abs(len)>2,s=Math.sign(len)||1;
    line.setAttribute('y2',String(-len));head.setAttribute('d',on?`M-5 ${-len}L5 ${-len}L0 ${-len-s*8}Z`:'');g.setAttribute('class',on?(len>0?'rt-fwd':'rt-rev'):'rt-idle');}
  function create(o){const box=o.box,T=o.T,dom=typeof box.querySelectorAll==='function'&&typeof requestAnimationFrame==='function';
    let sending=false,said='',savedNote='',valuesNote='',valuesSending=false,timer=null,drawn='',info=null,raf=0,lastT=0,binding=null,sim={key:'',angles:[],targets:[]},live=null;
    const lastSent=()=>{try{return JSON.parse(o.sent.get()||'null')||{};}catch{return {};}};
    const keep=fn=>{const s=clean(o.store.get(),T);fn(s);o.store.set(s);};
    const status=b=>{const last=lastSent(),same=b.tele.source&&last.sig===sig(b.tele.source);
      if(sending)return 'Sending it to the robot and building it there…';if(said)return said;if(b.tele.error)return '';
      if(same)return `On the robot as “${T.FULL_OP_MODE}”${last.at?`, sent ${last.at}`:''}. Pick it in Drive.`;
      if(!o.connected())return b.state.auto?'No robot connected: plug in the Control Hub and it is sent by itself.':'No robot connected.';
      const why=o.busy();if(why)return `${why} It is sent when that is done${b.state.auto?'':' and you press Send'}.`;
      return last.sig?'Changed since it was last sent.':'Not on the robot yet.';};
    // What a job on the chassis is bound by, said in the bind button's prompt.
    const ASK={drive:'Move the stick that should drive it…',turn:'Move the stick, or squeeze a trigger or press a bumper, that should turn it…',spin:'Press a bumper, squeeze a trigger or press D-pad left or right…',lock:'Press the button that should lock the wheels…',slow:'Press the button that should slow it…',reset:'Press the button that should set the heading to 0…'};
    function render(){const b=build(o),m=b.map,bind=(key,label)=>`<button type="button" class="secondary rt-bind" data-rt-bind="${esc(key)}" aria-pressed="${binding?.key===key}" title="Bind it by using the control on the controller">${binding?.key===key?'Cancel':esc(label||'Bind')}</button>`;
      const pick=(k,label,canBind=true)=>`<div class="cal-field rt-row"><label for="rt-map-${k}">${label}</label><div class="rt-pick"><select id="rt-map-${k}" data-rt-map="${k}">${Object.entries(T.MAP[k]).map(([v,t])=>`<option value="${v}"${m[k]===v?' selected':''}>${esc(t)}</option>`).join('')}</select>${canBind?bind('map:'+k):''}</div></div>`;
      const taken=new Map();for(const x of b.list)if(x.mode!=='off')for(const k of ['a','b'])if(x[k]&&x[k]!=='none')taken.set(x[k],x.label);
      const chassisHas=b.state.pad==='gamepad1'?T.chassisButtons(m,b.swerve):[];
      const btn=(x,k,label)=>`<div class="cal-field rt-row"><label for="rt-${k}-${esc(x.id)}">${esc(label)}</label><div class="rt-pick"><select id="rt-${k}-${esc(x.id)}" data-rt-btn="${esc(x.id)}" data-k="${k}">${k==='b'&&!['updown','positions'].includes(x.mode)?`<option value="none"${x[k]==='none'?' selected':''}>No button</option>`:''}${Object.entries(T.BUTTONS).filter(([v])=>!chassisHas.includes(v)).map(([v,t])=>`<option value="${v}"${x[k]===v?' selected':''}>${esc(t)}${taken.has(v)&&x[k]!==v?` (swaps with ${esc(taken.get(v))})`:''}</option>`).join('')}</select>${bind(`mech:${x.id}:${k}`)}</div></div>`;
      const num=(x,k,label,min,max,step)=>`<div class="cal-field"><label for="rt-${k}-${esc(x.id)}">${esc(label)}</label><input id="rt-${k}-${esc(x.id)}" type="number" min="${min}" max="${max}" step="${step}" value="${x[k]}" data-rt-num="${esc(x.id)}" data-k="${k}"></div>`;
      const rows=b.list.map(x=>{const modes=T.modesFor(x.kind),uses=T.USES[x.mode]||[],servo=x.kind==='servo',unset=servo&&x.mode!=='off'&&x.posA===x.posB;
        return `<div class="rt-mech" data-rt-mech="${esc(x.id)}" data-a="${esc(x.mode==='off'?'':x.a)}" data-b="${esc(x.mode==='off'?'':x.b)}"><div class="rt-mech-head"><b>${esc(x.label)}</b><small>${esc(KIND[x.kind]||x.kind)} “${esc(x.device||'not named yet')}”</small></div>
          <div class="cal-fields"><div class="cal-field"><label for="rt-mode-${esc(x.id)}">What it does</label><select id="rt-mode-${esc(x.id)}" data-rt-mode="${esc(x.id)}">${modes.map(v=>`<option value="${v}"${x.mode===v?' selected':''}>${esc(T.MODES[v])}</option>`).join('')}</select></div>
          ${x.mode==='off'?'':`${btn(x,'a',uses[0])}${uses[1]!==null?btn(x,'b',uses[1]):''}${servo?num(x,'posA',x.mode==='flip'?'Position at the start (0 to 1)':'First position (0 to 1)',0,1,.01)+num(x,'posB',x.mode==='flip'?'The other position (0 to 1)':'Second position (0 to 1)',0,1,.01):num(x,'power','Power (0 to 1)',.05,1,.05)}`}</div>
          ${x.full?'<p class="cal-sense-note bad">No button is left for it on this controller: free one above, or put the mechanisms on a second controller.</p>':!x.device?'<p class="cal-sense-note bad">It has no name in the robot configuration yet: name it in Setup → Mechanisms.</p>':unset?'<p class="cal-note">Both positions are the same, so it will not move: type where it should go (0 to 1). Start near the middle and work outwards.</p>':''}</div>`;}).join('');
      const src=b.tele.source||'',values=o.values?.()||null,can=!b.tele.error&&!!src,kind=b.chassis?.kind;
      const how=kind==='swerve'?'Push the drive stick and every pod turns to point that way, the shortest way round: when turning the pod is further than running its motor backwards, the pod stays and the motor reverses (stick back: pods forward, motors backwards; stick right: pods left, motors backwards).':kind==='mecanum'?'Forward and back drive it, left and right strafe it sideways, and anything between goes that way on the diagonal: each wheel gets its share, so it can move any way while turning.':kind==='tank'?'Forward and back drive both sides; turning runs one side against the other.':'';
      const padSvg=o.art?.render?o.art.render().replace(/id="/g,'id="rt-'):'';
      const html=`<section class="cal-card rt-card"><h2>Driving</h2><p class="hint">Move the sticks and watch what the chassis does: this is the arithmetic the TeleOp runs on the robot. ${esc(how)}</p>
        <div class="rt-live"><div class="rt-pad"><div class="rt-pad-art">${padSvg}</div><p class="hint" data-rt-padname></p><div class="button-row"><button type="button" class="secondary" data-rt="controller">Set up the controller…</button></div></div>
          <div class="rt-chassis">${chassisArt(b.chassis)}<p class="hint rt-readout" data-rt-readout></p>${m.field==='yes'?'<p class="hint">Shown with the robot facing away from you; on the field, forward stays away from the driver however it faces.</p>':''}</div></div>
        <p class="cal-note rt-binding" data-rt-binding role="status"${binding?'':' hidden'}>${esc(binding?.ask||'')}</p>
        <h3 class="cal-group-title">What the controller does</h3><div class="cal-fields rt-jobs">${pick('drive','Drive with')}${pick('turn','Turn with')}${pick('spin','Spin on the spot')}${b.swerve?pick('lock','Lock the wheels'):''}${pick('slow','Slow button')}${pick('reset','Set heading to 0')}${pick('field','Forward means',false)}</div>
        ${b.tele.error?`<p class="cal-sense-note bad">${esc(b.tele.error)}</p>`:''}</section>
        <section class="cal-card rt-card"><h2>Mechanisms</h2>${b.list.length?`<p class="hint">Each mechanism in Setup, on buttons nothing else uses. Press a button on the controller and the one it works lights up.</p><div class="cal-fields"><div class="cal-field"><label for="rt-pad">Their buttons are on</label><select id="rt-pad" data-rt-pad><option value="gamepad1"${b.state.pad==='gamepad1'?' selected':''}>Controller 1, with the driving</option><option value="gamepad2"${b.state.pad==='gamepad2'?' selected':''}>Controller 2, a second driver</option></select></div></div>${rows}`:`<p class="hint">This setup has no mechanisms yet, so the TeleOp drives the chassis only. Add them in Setup → Mechanisms and they show up here with buttons.</p><div class="button-row"><button type="button" class="secondary" data-rt="setup">Open Setup → Mechanisms</button></div>`}
        ${b.clashes.length?`<p class="cal-sense-note bad">${b.clashes.map(c=>`${esc(c.name)} does two things (${esc(c.uses.join(', '))})`).join('; ')}. Pick another button for one of them.</p>`:''}</section>
        <section class="cal-card rt-card"><h2>On the robot</h2><p class="hint">The TeleOp is written from Setup and from what Calibrate measured, and Torque puts it on the robot, where it shows in Drive as “${esc(T.FULL_OP_MODE)}”.</p>
        <div class="button-row rt-send"><button type="button" class="primary" data-rt="send"${!can||sending?' disabled':''}>${sending?'Sending…':'Send to the robot'}</button><label class="rt-auto"><input type="checkbox" data-rt-auto${b.state.auto?' checked':''}> Send it by itself when it changes</label></div>
        <p class="hint" role="status" data-rt-status>${esc(status(b))}</p>
        <div class="button-row"><button type="button" class="secondary" data-rt="save"${can?'':' disabled'}>Save as a file…</button><button type="button" class="secondary" data-rt="copy"${can?'':' disabled'}>Copy</button><span class="hint" role="status" data-rt-saved>${esc(savedNote)}</span></div>
        ${src?`<details class="usb-facts"><summary>See the code</summary><pre class="cal-cam-code cal-chassis-code" data-rt-code>${esc(src)}</pre></details>`:''}</section>
        <section class="cal-card rt-card"><h2>Calibration code</h2><p class="hint">Everything Calibrate measured on this robot (the chassis, the mechanisms, the cameras) as one class, TorqueCalibration, for the team’s own code. It builds in OnBot Java as it is: put it on the robot, or save the file. The raw numbers save as JSON too.</p>
        ${values?`<div class="button-row"><button type="button" class="primary" data-rt="values-send"${valuesSending?' disabled':''}>${valuesSending?'Sending…':'Put it on the robot (OnBot Java)'}</button><button type="button" class="secondary" data-rt="values-java">Save the Java class…</button><button type="button" class="secondary" data-rt="values-json">Save as JSON…</button><button type="button" class="secondary" data-rt="values-copy">Copy</button></div><p class="hint" role="status" data-rt-values>${esc(valuesNote)}</p><details class="usb-facts"><summary>See the code</summary><pre class="cal-cam-code cal-chassis-code" data-rt-values-code>${esc(values.java)}</pre></details>`:'<p class="hint">Nothing is measured yet: Calibrate → Mechanisms and Camera measure it.</p>'}</section>`;
      // The same page again changes nothing: an open list or a field being typed in is left alone.
      if(html!==drawn){drawn=html;box.innerHTML=html;live=null;}auto(b);if(dom)kick();}
    // Sent by itself: when the tab is showing, a robot is connected, nothing else is using it, and what is on the robot
    // is not what is written now. It waits a moment, so a run of changes goes as one.
    function auto(b){clearTimeout(timer);if(!b.state.auto||sending||b.tele.error||!b.tele.source||b.clashes.length||!o.visible()||!o.connected()||o.busy())return;if(lastSent().sig===sig(b.tele.source))return;
      timer=setTimeout(()=>{const now=build(o);if(now.tele.source&&now.state.auto&&o.visible()&&o.connected()&&!o.busy()&&!now.clashes.length&&lastSent().sig!==sig(now.tele.source))void send(now);},1500);}
    function send(b){if(sending||b.tele.error||!b.tele.source)return Promise.resolve();sending=true;said='';render();const t=b.tele;
      return Promise.resolve().then(()=>o.send(t)).then(()=>{o.sent.set(JSON.stringify({sig:sig(t.source),at:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}));said='';},e=>{said=`It did not get there: ${e?.message||e}`;}).finally(()=>{sending=false;render();});}
    // ---- picking: from a list, or by using the control -------------------------------------------------------------------
    // A job on the stick that drives moves the driving to the other stick.
    function pickMap(k,v){const m=o.map();if(k==='turn'&&(v==='left'||v==='right')&&m.drive===v)o.setMap('drive',v==='left'?'right':'left');if(k==='drive'&&m.turn===v)o.setMap('turn',v==='left'?'right':'left');o.setMap(k,v);}
    // A button another mechanism has: the two swap.
    function pickBtn(id,k,v){const b=build(o),me=b.list.find(x=>x.id===id),other=v==='none'?null:b.list.find(x=>x.id!==id&&x.mode!=='off'&&(x.a===v||x.b===v)),mine=me?.[k];if(!me)return;
      keep(s=>{for(const x of b.list)if(x.mode!=='off')s.mechs[x.id]={...s.mechs[x.id],mode:x.mode,a:x.a,b:x.b};s.mechs[id]={...s.mechs[id],[k]:v};
        const ok=k==='a'?'b':'a';if(v!=='none'&&s.mechs[id][ok]===v)s.mechs[id][ok]=mine&&mine!=='none'?mine:'none';
        if(other){const k2=other.a===v?'a':'b';if(mine&&mine!=='none')s.mechs[other.id][k2]=mine;else delete s.mechs[other.id][k2];}});}
    // Bound by using it: the first stick moved or button pressed that was not already held when Bind was pressed.
    function bindStep(pad){const bd=binding;if(!bd)return;const was=bd.base,far=(x,y)=>Math.hypot(x,y)>.6,fresh=n=>pad[n]&&!was[n],trig=n=>pad[n]>.6&&!(was[n]>.6);
      if(performance.now()-bd.at>10000){binding=null;drawn='';return render();}
      let got=null;const [kind,a1,a2]=bd.key.split(':');
      if(kind==='map'){const k=a1,L=far(pad.lx,pad.ly)&&!far(was.lx,was.ly),R=far(pad.rx,pad.ry)&&!far(was.rx,was.ry),bump=fresh('left_bumper')||fresh('right_bumper'),trg=trig('lt')||trig('rt'),dp=fresh('dpad_left')||fresh('dpad_right');
        if(k==='drive')got=L?'left':R?'right':null;
        else if(k==='turn')got=L?'left':R?'right':trg?'triggers':bump?'bumpers':null;
        else if(k==='spin')got=bump?'bumpers':trg?'triggers':dp?'dpad':null;
        else got=Object.keys(T.MAP[k]).find(v=>v!=='none'&&(/_trigger$/.test(v)?trig(v==='left_trigger'?'lt':'rt'):fresh(v)))||null;
        if(got){binding=null;drawn='';pickMap(k,got);return render();}return;}
      const state=clean(o.store.get(),T),chassisHas=state.pad==='gamepad1'?T.chassisButtons(o.map(),!!o.swerve()):[];
      got=Object.keys(T.BUTTONS).find(v=>!chassisHas.includes(v)&&(/_trigger$/.test(v)?trig(v==='left_trigger'?'lt':'rt'):fresh(v)))||null;
      if(got){binding=null;drawn='';pickBtn(a1,a2,got);return render();}}
    // ---- the live picture ----------------------------------------------------------------------------------------------
    function kick(){if(!raf&&dom&&o.visible())raf=requestAnimationFrame(frame);}
    function frame(t){raf=0;if(!o.visible())return;const dt=Math.max(.001,Math.min(.05,(t-lastT)/1000||.016));lastT=t;try{paint(dt);}catch{}raf=requestAnimationFrame(frame);}
    function paint(dt){const q=s=>box.querySelector(s);
      if(!live){const svg=q('.rt-pad-art svg');live={svg,travel:+(svg?.dataset.stickTravel||8),trigH:+(svg?.dataset.triggerHeight||34),trigB:+(svg?.dataset.triggerBottom||40),pods:[...box.querySelectorAll('[data-rt-pod]')],arrows:[...box.querySelectorAll('[data-rt-arrow]')],go:q('[data-rt-go]'),readout:q('[data-rt-readout]'),name:q('[data-rt-padname]'),mechs:[...box.querySelectorAll('[data-rt-mech]')],keys:[...box.querySelectorAll('.rt-pad-art [data-pad-button]')],c:build(o)};}
      const L=live,reading=info?.readings?.[0]||null,pad=padOf(reading),c=L.c,keyboard=info?.source1==='keyboard',has=!!info?.slots?.[0];
      if(L.name){const t=keyboard?'Controller 1 is the keyboard: W A S D is the left stick, the arrow keys the right.':has?`Controller 1: ${info.slots[0].id||'a gamepad'}.`:'No controller yet: press a button on one, or set the keyboard as Controller 1.';if(L.name.textContent!==t)L.name.textContent=t;}
      if(L.svg){q('#rt-stick-left-dot')?.setAttribute('transform',`translate(${pad.lx*L.travel} ${pad.ly*L.travel})`);q('#rt-stick-right-dot')?.setAttribute('transform',`translate(${pad.rx*L.travel} ${pad.ry*L.travel})`);
        for(const [side,v] of [['left',pad.lt],['right',pad.rt]]){const f=q(`#rt-trigger-${side}-fill`);if(f){const h=v*L.trigH;f.setAttribute('y',String(L.trigB-h));f.setAttribute('height',String(h));}}
        for(const node of L.keys){const n=ORDER[+node.dataset.padButton];node.classList.toggle('pressed',/_trigger$/.test(n||'')?pad[n==='left_trigger'?'lt':'rt']>.2:!!pad[n]);}}
      if(binding)bindStep(pad);
      if(!c.chassis)return;const cmd=T.command({...c.map,field:'no'},pad,{swerve:c.swerve});
      if(c.chassis.kind==='swerve'){const pods=c.chassis.pods||[],key=pods.map(p=>p.x+','+p.y).join(';');if(sim.key!==key)sim={key,angles:pods.map(()=>0),targets:pods.map(()=>0)};
        const r=T.swerveDrive(pods,sim.angles,sim.targets,cmd);r.forEach((x,i)=>{const rate=Math.max(90,+pods[i].top||400);sim.angles[i]+=Math.sign(x.error)*Math.min(Math.abs(x.error),rate*dt);L.pods[i]?.setAttribute('transform',`rotate(${(-sim.angles[i]).toFixed(1)})`);setArrow(L.arrows[i],x.power);});}
      else{const p=T.wheelPowers(c.chassis.motors||[],cmd,c.chassis.kind==='tank');p.forEach((v,i)=>setArrow(L.arrows[i],v));}
      if(L.go){const line=L.go.firstElementChild;line.setAttribute('x2',String(-cmd.left*38));line.setAttribute('y2',String(-cmd.forward*38));L.go.setAttribute('class',Math.hypot(cmd.forward,cmd.left)>.05||Math.abs(cmd.turn)>.05?'rt-go on':'rt-go');}
      if(L.readout){const way=Math.abs(cmd.turn)>.05?(cmd.turn>0?' · turning left':' · turning right'):'',t=`Forward ${cmd.forward.toFixed(2)} · left ${cmd.left.toFixed(2)}${way}${cmd.slow?' · slow':''}${cmd.lock?' · wheels locked':''}`;if(L.readout.textContent!==t)L.readout.textContent=t;}
      // The mechanism a pressed button works lights up (on this controller's buttons).
      if(c.state.pad==='gamepad1')for(const el of L.mechs){const on=(el.dataset.a&&(/_trigger$/.test(el.dataset.a)?pad[el.dataset.a==='left_trigger'?'lt':'rt']>.5:pad[el.dataset.a]))||(el.dataset.b&&el.dataset.b!=='none'&&(/_trigger$/.test(el.dataset.b)?pad[el.dataset.b==='left_trigger'?'lt':'rt']>.5:pad[el.dataset.b]));el.classList.toggle('rt-on',!!on);}}
    o.onInput?.(next=>{info=next;});if(dom)Promise.resolve(o.inputNow?.()).then(v=>{if(v&&!info)info=v;},()=>{});
    box.addEventListener('change',e=>{const t=e.target,d=t.dataset;said='';
      if(d.rtMap)return void pickMap(d.rtMap,t.value);
      if('rtPad' in d){keep(s=>{s.pad=t.value==='gamepad2'?'gamepad2':'gamepad1';});return render();}
      if('rtAuto' in d){keep(s=>{s.auto=!!t.checked;});return render();}
      if(d.rtMode){keep(s=>{s.mechs[d.rtMode]={...s.mechs[d.rtMode],mode:t.value};delete s.mechs[d.rtMode].a;delete s.mechs[d.rtMode].b;});return render();}
      if(d.rtBtn){pickBtn(d.rtBtn,d.k,t.value);return render();}
      if(d.rtNum){const v=+t.value;if(!Number.isFinite(v))return;keep(s=>{s.mechs[d.rtNum]={...s.mechs[d.rtNum],[d.k]:d.k==='power'?Math.max(.05,Math.min(1,v)):Math.max(0,Math.min(1,v))};});return render();}});
    box.addEventListener('click',e=>{const bindKey=e.target.closest?.('[data-rt-bind]')?.dataset.rtBind;
      if(bindKey){if(binding?.key===bindKey)binding=null;else{const [kind,a1,a2]=bindKey.split(':');binding={key:bindKey,at:typeof performance==='object'?performance.now():0,base:padOf(info?.readings?.[0]),ask:kind==='map'?ASK[a1]:`Press the button for it on the controller…`};}drawn='';return render();}
      const a=e.target.closest?.('[data-rt]')?.dataset.rt;if(!a)return;const b=build(o),note=t=>{savedNote=t;const n=box.querySelector('[data-rt-saved]');if(n)n.textContent=t;drawn='';},vnote=t=>{valuesNote=t;const n=box.querySelector('[data-rt-values]');if(n)n.textContent=t;drawn='';};
      const saved=say=>f=>say(f?`Saved to ${f}`:''),failed=say=>x=>say(`It was not saved: ${x?.message||x}`);
      if(a==='setup')return void o.toSetup?.();if(a==='controller')return void o.openController?.();
      if(a==='send'){said='';return void send(b);}
      if(a==='save'&&b.tele.source)return void Promise.resolve(o.saveFile(b.tele.file,b.tele.source)).then(saved(note),failed(note));
      if(a==='copy'&&b.tele.source)return void Promise.resolve(o.copy(b.tele.source)).then(()=>note('Copied.'),()=>note('It could not be copied: open See the code and select it.'));
      const v=o.values?.();if(!v)return;
      if(a==='values-send'){if(valuesSending)return;valuesSending=true;valuesNote='';drawn='';render();return void Promise.resolve().then(()=>o.sendValues(v.java)).then(t=>{valuesNote=t||'On the robot.';},x=>{valuesNote=`It did not get there: ${x?.message||x}`;}).finally(()=>{valuesSending=false;drawn='';render();});}
      if(a==='values-java')return void Promise.resolve(o.saveFile('TorqueCalibration.java',v.java)).then(saved(vnote),failed(vnote));
      if(a==='values-json')return void Promise.resolve(o.saveFile(v.jsonName||'torque-calibration.json',v.json)).then(saved(vnote),failed(vnote));
      if(a==='values-copy')return void Promise.resolve(o.copy(v.java)).then(()=>vnote('Copied.'),()=>vnote('It could not be copied.'));});
    return {refresh:render,build:()=>build(o)};}
  return {create,build,clean,padOf,chassisArt};});
