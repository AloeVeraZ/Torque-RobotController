(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckTeleopTab=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Calibrate → TeleOp: everything about driving the real robot. A list on the left, one thing at a time on the right,
  // as Mechanisms and Camera are laid out.
  //   Driving       the controller, live (the keyboard too, when it is Controller 1: W A S D moves the left stick), beside
  //                 a picture of the chassis doing what the TeleOp will do with that input: a swerve's pods turning the
  //                 shortest way (or staying put and running their motors backwards), a mecanum's wheels strafing. It is
  //                 the same arithmetic the robot runs (ui/sim-chassis-teleop.js: command, swerveDrive, wheelPowers).
  //                 Each job is picked from a list or bound by moving the stick or pressing the button it should be on.
  //   A mechanism   each one Setup has: what it does, on which button, trigger or stick, with a meter showing what the
  //                 controller is telling it right now (mechStep, the same steps as its Java).
  //   Send to robot the TeleOp, sent whenever it changes while a robot is connected; saved or copied for the team's code.
  //   Calibration   everything Calibrate measured (chassis, mechanisms, cameras) as one class that builds in OnBot Java.
  //   o: {box, T (DeckChassisTeleop), art (DeckControllerArt), chassis() -> teleopOf's input or null, map(), setMap(k, v),
  //       swerve(), mechs() -> [{id, label, device, kind, type, template, states, reversed, posA, posB}],
  //       store: {get() -> {pad, auto, mechs}, set(v)}, sent: {get() -> text, set(text)} (what was last sent, kept apart),
  //       send(t) -> Promise, connected(), busy() -> why it cannot be sent now or '', visible(),
  //       onInput(fn) (the app's controller state as it changes), inputNow() -> Promise<state>, openController(),
  //       saveFile(name, text) -> Promise<path|null>, copy(text), values() -> {java, json, jsonName} or null,
  //       sendValues(java) -> Promise<text>, toSetup()}
  const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const sig=t=>{let h=5381;for(let i=0;i<t.length;i++)h=(h*33^t.charCodeAt(i))>>>0;return h.toString(36)+':'+t.length;};
  const KIND={motor:'Motor',crservo:'Continuous servo',servo:'Servo'},BADGE={motor:'MOT',crservo:'CRS',servo:'SRV'};
  // The standard gamepad's buttons, by their FTC names, in the Gamepad API's order.
  const ORDER=['a','b','x','y','left_bumper','right_bumper','left_trigger','right_trigger','back','start','left_stick_button','right_stick_button','dpad_up','dpad_down','dpad_left','dpad_right'];
  const clamp1=v=>Number.isFinite(+v)?Math.max(-1,Math.min(1,+v)):0;
  // A controller reading as the drive arithmetic takes it: sticks (with a small dead zone), triggers, each button by name.
  function padOf(reading){const ax=i=>{const v=clamp1(reading?.axes?.[i]);return Math.abs(v)<.08?0:v;},bv=i=>{const b=reading?.buttons?.[i];return Math.max(0,clamp1(typeof b==='object'&&b?b.value:b));};
    const p={lx:ax(0),ly:ax(1),rx:ax(2),ry:ax(3),lt:bv(6),rt:bv(7)};ORDER.forEach((n,i)=>{p[n]=bv(i)>.5;});return p;}
  // Whether a control (a button, a trigger, a stick's axis, both triggers) is in use on a reading.
  const active=(pad,c)=>!c||c==='none'?false:c==='triggers'?pad.lt>.3||pad.rt>.3:c==='left_trigger'?pad.lt>.3:c==='right_trigger'?pad.rt>.3:c==='left_stick_x'?Math.abs(pad.lx)>.3:c==='left_stick_y'?Math.abs(pad.ly)>.3:c==='right_stick_x'?Math.abs(pad.rx)>.3:c==='right_stick_y'?Math.abs(pad.ry)>.3:!!pad[c];
  // The choices as kept: only what the lists allow.
  // The name the TeleOp shows under in Drive: one line, no quotes or backslashes, 60 characters at most ('' is Torque's own).
  const cleanName=t=>String(t??'').replace(/[\r\n\t"\\]+/g,' ').replace(/\s+/g,' ').trim().slice(0,60);
  function clean(raw,T){const r=raw&&typeof raw==='object'?raw:{},mechs={};for(const [id,m] of Object.entries(r.mechs&&typeof r.mechs==='object'?r.mechs:{})){if(!m||typeof m!=='object')continue;const out={};
      if(Object.hasOwn(T.MODES,m.mode))out.mode=m.mode;for(const k of ['a','b','c'])if(m[k]==='none'||Object.hasOwn(T.BUTTONS,m[k])||k==='a'&&Object.hasOwn(T.AXES,m[k]))out[k]=m[k];for(const k of ['power','posA','posB','posC'])if(Number.isFinite(+m[k])&&m[k]!==''&&m[k]!==null)out[k]=+m[k];mechs[id]=out;}
    const name=cleanName(r.name);return {pad:r.pad==='gamepad2'?'gamepad2':'gamepad1',auto:r.auto!==false,mechs,...(name?{name}:{})};}
  // The whole TeleOp from the choices: {tele: {file, opMode, source} | {error}, list (each mechanism with its choices), clashes, state}.
  function build(o){const T=o.T,kept=o.store.get(),state=clean(kept,T),chassis=o.chassis(),map=o.map(),swerve=!!o.swerve(),mechs=o.mechs()||[];
    // Until the team picks a controller for the mechanisms, they share the driving's while they all fit on it; when they do
    // not, they start on a second one (a driver and an operator, as most teams with that much on the robot run it).
    if(kept?.pad!=='gamepad1'&&kept?.pad!=='gamepad2'&&Object.values(T.mechMap(mechs,state.mechs,{pad:'gamepad1',map,swerve})).some(x=>x.full))state.pad='gamepad2';
    const picked=T.mechMap(mechs,state.mechs,{pad:state.pad,map,swerve}),list=mechs.map(m=>({...m,...picked[m.id]})),clashes=T.clashes(list,{pad:state.pad,map,swerve});
    const tele=chassis?T.teleopOf({...chassis,map,className:T.FULL_NAME,opMode:state.name||T.FULL_OP_MODE,mechanisms:list,pad:state.pad}):{error:'This setup has no chassis Torque writes a TeleOp for yet.'};
    return {tele,list,clashes,state,map,swerve,chassis};}
  // A bind button's key: 'map:<job>' for the chassis, 'mech:<id>:<a|b|c>' for a mechanism (its id has colons of its own).
  const keyOf=key=>{const j=key.lastIndexOf(':');return key.startsWith('map:')?['map',key.slice(4),'']:['mech',key.slice(5,j),key.slice(j+1)];};
  // What a mechanism does, in a line: for its tile in the list.
  function says(T,x){if(x.mode==='off')return x.full?'No control left for it':'Not in this TeleOp';const n=c=>T.BUTTONS[c]||T.AXES[c]||c,u=T.usesOf(x.mode,x.states),low=t=>String(t||'').toLowerCase();
    return {hold:`Runs while ${n(x.a)} is held`,toggle:`${n(x.a)} switches it on and off`,updown:`${u[0]}: ${n(x.a)} · ${low(u[1])}: ${n(x.b)}`,axis:`Follows ${low(n(x.a))}`,positions:`${n(x.a)}, ${n(x.b)}${x.c&&x.c!=='none'?`, ${n(x.c)}`:''}: a position each`,flip:`${n(x.a)} flips it`,momentary:`${String(u[0]||'Over while held').replace(/ while held$/,'')} while ${n(x.a)} is held`,follow:`Follows ${low(n(x.a))}`}[x.mode]||'';}
  // ---- the chassis, from above: forward is up ----------------------------------------------------------------------------
  // Its wheels where they are on the robot. A swerve's pods turn (data-rt-pod) and every wheel has an arrow for its motor
  // (data-rt-arrow): the live loop moves them.
  const arrow=i=>`<g data-rt-arrow="${i}"><line x1="0" y1="0" x2="0" y2="0"/><path d=""/></g>`;
  function chassisArt(c){if(!c)return '';const W=220,pt=(x,y,k)=>[+(-y*k).toFixed(1),+(-x*k).toFixed(1)],open=label=>`<svg class="rt-chassis-art" viewBox="${-W/2} ${-W/2} ${W} ${W}" role="img" aria-label="${label}">`,front=`<path class="rt-front" d="M-7 ${-W/2+16}L0 ${-W/2+5}L7 ${-W/2+16}Z"/><text class="rt-front-t" x="0" y="${-W/2+27}">front</text>`,go='<g data-rt-go><line x1="0" y1="0" x2="0" y2="0"/><circle r="3"/></g></svg>';
    if(c.kind==='swerve'){const pods=c.pods||[],far=Math.max(1,...pods.map(p=>Math.hypot(p.x,p.y))),k=62/far,pts=pods.map(p=>pt(p.x,p.y,k)),hull=[...pts].sort((a,b)=>Math.atan2(a[1],a[0])-Math.atan2(b[1],b[0]));
      return `${open('The chassis from above: each pod and which way its motor runs')}<polygon class="rt-body" points="${hull.map(p=>p.join(',')).join(' ')}"/>${front}
        ${pods.map((p,i)=>`<g transform="translate(${pts[i][0]} ${pts[i][1]})"><g data-rt-pod="${i}"><rect class="rt-wheel" x="-7" y="-15" width="14" height="30" rx="4"/><path class="rt-nose" d="M-4 -11L0 -16L4 -11"/>${arrow(i)}</g></g>`).join('')}${go}`;}
    const ms=c.motors||[],side=key=>/right/i.test(key)?1:-1,row=key=>/front/i.test(key)?-1:/back/i.test(key)?1:0,wheel='<rect class="rt-wheel" x="-9" y="-19" width="18" height="38" rx="4"/>';
    // A kiwi's three wheels sit across their corners: each arrow runs round the robot, counterclockwise for positive power.
    if(c.kind==='kiwi'){const at=key=>/front/i.test(key)&&!/left|right/i.test(key)?0:/left/i.test(key)?120:240;
      return `${open('The chassis from above: each wheel and which way its motor runs')}<polygon class="rt-body" points="${[0,120,240].map(a=>pt(Math.cos(a*Math.PI/180),Math.sin(a*Math.PI/180),50).join(',')).join(' ')}"/>${front}
        ${ms.map((m,i)=>{const a=at(m.key),[x,y]=pt(Math.cos(a*Math.PI/180),Math.sin(a*Math.PI/180),58);return `<g transform="translate(${x} ${y}) rotate(${-90-a})">${wheel}${arrow(i)}</g>`;}).join('')}${go}`;}
    const tank=c.kind==='tank',x45=c.kind==='xdrive';
    return `${open('The chassis from above: each wheel and which way its motor runs')}<rect class="rt-body" x="-42" y="-58" width="84" height="116" rx="8"/>${front}
      ${ms.map((m,i)=>{const x=side(m.key)*54,y=row(m.key)*42,lean=side(m.key)*row(m.key)<0?1:-1;return `<g transform="translate(${x} ${y})${x45?` rotate(${-45*lean})`:''}">${wheel}${tank||x45?'':`<path class="rt-roller" d="M-6 ${lean*-10}L6 ${lean*-2}M-6 ${lean*-2}L6 ${lean*6}M-6 ${lean*6}L6 ${lean*14}"/>`}${arrow(i)}</g>`;}).join('')}${go}`;}
  // A motor's arrow: up the wheel for forwards, down for backwards, as long as the power.
  function setArrow(g,power){if(!g)return;const len=Math.round(Math.max(-1,Math.min(1,power))*34),line=g.firstElementChild,head=g.lastElementChild,on=Math.abs(len)>2,s=Math.sign(len)||1;
    line.setAttribute('y2',String(-len));head.setAttribute('d',on?`M-5 ${-len}L5 ${-len}L0 ${-len-s*8}Z`:'');g.setAttribute('class',on?(len>0?'rt-fwd':'rt-rev'):'rt-idle');}
  const HOW={swerve:'Each pod turns the shortest way to where the stick points: past a quarter turn it stays, and its motor runs backwards instead.',
    mecanum:'Forward and back drive it, left and right strafe it, anything between goes on the diagonal, and it can turn at the same time.',xdrive:'Its four wheels sit at 45°, so it goes any way like a mecanum, turning at the same time.',
    butterfly:'On its mecanum wheels it goes any way, turning at the same time.',kiwi:'Three omni wheels, each across its corner: between them they push it any way and turn it.',tank:'Forward and back drive both sides; turning runs one side against the other. It cannot go sideways.'};
  function create(o){const box=o.box,T=o.T,dom=typeof box.querySelectorAll==='function'&&typeof requestAnimationFrame==='function';
    let sending=false,said='',savedNote='',valuesNote='',valuesSending=false,timer=null,drawn='',info=null,raf=0,lastT=0,binding=null,sim={key:'',angles:[],targets:[]},live=null,view='drive',shown='',mechSt={id:'',st:{}};
    const lastSent=()=>{try{return JSON.parse(o.sent.get()||'null')||{};}catch{return {};}};
    // What is kept has a controller for the mechanisms only once the team picked one.
    const keep=fn=>{const raw=o.store.get(),s=clean(raw,T);if(raw?.pad!=='gamepad1'&&raw?.pad!=='gamepad2')delete s.pad;fn(s);o.store.set(s);};
    const status=b=>{const last=lastSent(),same=b.tele.source&&last.sig===sig(b.tele.source);
      if(sending)return 'Sending it to the robot and building it there…';if(said)return said;if(b.tele.error)return '';
      if(same)return `On the robot as “${b.tele.opMode||T.FULL_OP_MODE}”${last.at?`, sent ${last.at}`:''}. Pick it in Drive.`;
      if(!o.connected())return b.state.auto?'No robot connected: plug in the Control Hub and it is sent by itself.':'No robot connected.';
      const why=o.busy();if(why)return `${why} It is sent when that is done${b.state.auto?'':' and you press Send'}.`;
      return last.sig?'Changed since it was last sent.':'Not on the robot yet.';};
    const sentShort=b=>{const last=lastSent();return sending?'Sending…':b.tele.error?'Not ready':b.tele.source&&last.sig===sig(b.tele.source)?'On the robot':!o.connected()?'No robot connected':last.sig?'Changed since it was sent':'Not sent yet';};
    // What a job on the chassis is bound by, said in the bind button's prompt.
    const ASK={drive:'Move the stick that should drive it…',turn:'Move the stick, or squeeze a trigger or press a bumper, that should turn it…',spin:'Press a bumper, squeeze a trigger or press D-pad left or right…',lock:'Press the button that should lock the wheels…',slow:'Press the button that should slow it…',reset:'Press the button that should set the heading to 0…'};
    function render(){const b=build(o),m=b.map,bind=key=>`<button type="button" class="secondary rt-bind" data-rt-bind="${esc(key)}" aria-pressed="${binding?.key===key}" title="Bind it by using the control on the controller">${binding?.key===key?'Cancel':'Bind'}</button>`;
      if(view.startsWith('mech:')&&!b.list.some(x=>'mech:'+x.id===view))view='drive';
      const pick=(k,label,canBind=true)=>`<div class="cal-field rt-row"><label for="rt-map-${k}">${label}</label><div class="rt-pick"><select id="rt-map-${k}" data-rt-map="${k}">${Object.entries(T.MAP[k]).map(([v,t])=>`<option value="${v}"${m[k]===v?' selected':''}>${esc(t)}</option>`).join('')}</select>${canBind?bind('map:'+k):''}</div></div>`;
      const onPad1=b.state.pad==='gamepad1',chassisHas=onPad1?T.chassisParts(m,b.swerve):[],owner=new Map();
      for(const x of b.list)if(x.mode!=='off')for(const k of ['a','b','c'])for(const part of T.partsOf(x[k]))owner.set(part,x);
      const padSvg=o.art?.render?o.art.render().replace(/id="/g,'id="rt-'):'',padBox=`<div class="rt-pad"><div class="rt-pad-art">${padSvg}</div><p class="hint" data-rt-padname></p><div class="button-row"><button type="button" class="secondary" data-rt="controller">Set up the controller…</button></div></div>`;
      const bindNote=`<p class="cal-note rt-binding" data-rt-binding role="status"${binding?'':' hidden'}>${esc(binding?.ask||'')}</p>`;
      const clashNote=b.clashes.length?`<p class="cal-sense-note bad">${b.clashes.map(c=>`${esc(c.name)} does two things (${esc(c.uses.join(', '))})`).join('; ')}. Pick another control for one of them.</p>`:'';
      // ---- the list ----
      const tile=(key,badge,title,sub,more='')=>`<button type="button" class="sim-tile cal-elec-tile" data-rt-view="${esc(key)}" aria-pressed="${view===key}"${more}><span class="cal-elec-badge" aria-hidden="true">${badge}</span><span class="sim-tile-text"><b>${esc(title)}</b><small>${esc(sub)}</small></span></button>`;
      const kindName=b.chassis?{swerve:'Swerve',mecanum:'Mecanum',xdrive:'X-drive',butterfly:'Butterfly',kiwi:'Kiwi',tank:'Tank'}[b.chassis.kind]||'Chassis':'Chassis';
      const rail=`<div class="cal-elec-listhead"><b>TeleOp</b></div><h3>Drive</h3><div class="sim-garage-rail">${tile('drive','DRV','Driving',`${kindName} · ${T.MAP.drive[m.drive].toLowerCase()} drives`)}</div>
        <h3>Mechanisms</h3><div class="sim-garage-rail">${b.list.length?b.list.map(x=>tile('mech:'+x.id,BADGE[x.kind]||'MEC',x.label,says(T,x),` data-rt-tile data-a="${esc(x.mode==='off'?'':x.a)}" data-b="${esc(x.mode==='off'?'':x.b)}" data-c="${esc(x.mode==='off'?'':x.c)}"`)).join(''):tile('nomech','+','None in Setup yet','Add them in Setup → Mechanisms')}</div>
        <h3>Robot</h3><div class="sim-garage-rail">${tile('send','SEND','Send to robot',sentShort(b))}${tile('code','JAVA','Calibration code','TorqueCalibration.java')}</div>`;
      // ---- the pane: one thing at a time ----
      let pane='';const src=b.tele.source||'',can=!b.tele.error&&!!src,kind=b.chassis?.kind;
      if(view==='drive')pane=`<section class="cal-card rt-card"><h2>Driving</h2><p class="hint">Move the sticks: the picture does what the TeleOp will do on the robot. ${esc(HOW[kind]||'')}</p>
        <div class="rt-live">${padBox}<div class="rt-chassis">${chassisArt(b.chassis)}<p class="hint rt-readout" data-rt-readout></p>${m.field==='yes'&&kind!=='tank'?'<p class="hint">Shown with the robot facing away from you; on the field, forward stays away from the driver however it faces.</p>':''}</div></div>${bindNote}
        <h3 class="cal-group-title">What the controller does</h3><div class="cal-fields rt-jobs">${pick('drive','Drive with')}${pick('turn','Turn with')}${pick('spin','Spin on the spot')}${b.swerve?pick('lock','Lock the wheels'):''}${pick('slow','Slow button')}${pick('reset','Set heading to 0')}${kind==='tank'?'':pick('field','Forward means',false)}</div>
        ${b.tele.error?`<p class="cal-sense-note bad">${esc(b.tele.error)}</p>`:''}${clashNote}</section>`;
      else if(view==='nomech')pane=`<section class="cal-card rt-card"><h2>Mechanisms</h2><p class="hint">This setup has no mechanisms yet, so the TeleOp drives the chassis only. Add them in Setup → Mechanisms (an intake, a claw, a lift, a turret…) and each shows up here, on the buttons, triggers or stick its kind is usually driven with.</p><div class="button-row"><button type="button" class="secondary" data-rt="setup">Open Setup → Mechanisms</button></div></section>`;
      else if(view.startsWith('mech:')){const x=b.list.find(q=>'mech:'+q.id===view),modes=T.modesFor(x.kind),uses=T.usesOf(x.mode,x.states),servo=x.kind==='servo',analog=x.mode==='axis'||x.mode==='follow',unset=servo&&x.mode!=='off'&&x.posA===x.posB;
        const taken=c=>{if(T.partsOf(c).some(p=>chassisHas.includes(p)))return 'chassis';const other=T.partsOf(c).map(p=>owner.get(p)).find(q=>q&&q.id!==x.id);return other||null;};
        const ctl=(k,label,from)=>`<div class="cal-field rt-row"><label for="rt-${k}">${esc(label)}</label><div class="rt-pick"><select id="rt-${k}" data-rt-btn="${esc(x.id)}" data-k="${k}">${k!=='a'&&!(k==='b'&&['updown','positions'].includes(x.mode))?`<option value="none"${x[k]==='none'?' selected':''}>No button</option>`:''}${Object.entries(from).filter(([v])=>taken(v)!=='chassis').map(([v,t])=>{const other=taken(v);return `<option value="${v}"${x[k]===v?' selected':''}>${esc(t)}${other&&x[k]!==v?` (${esc(other.label)} has it)`:''}</option>`;}).join('')}</select>${bind(`mech:${x.id}:${k}`)}</div></div>`;
        const num=(k,label,min,max,step)=>`<div class="cal-field"><label for="rt-${k}">${esc(label)}</label><input id="rt-${k}" type="number" min="${min}" max="${max}" step="${step}" value="${x[k]}" data-rt-num="${esc(x.id)}" data-k="${k}"></div>`;
        const st=(x.states||[]).map(t=>t?t[0].toUpperCase()+t.slice(1):t),three=x.mode==='positions'&&uses[2]!==null,posName=i=>st[i]?`${st[i]} (0 to 1)`:['First position (0 to 1)','Second position (0 to 1)','Third position (0 to 1)'][i];
        const fields=x.mode==='off'?'':analog?`${ctl('a','Follows',T.AXES)}${servo?num('posA',x.mode==='follow'?'At rest (0 to 1)':posName(0),0,1,.01)+num('posB',x.mode==='follow'?'All the way (0 to 1)':posName(1),0,1,.01):num('power','Power at full (0 to 1)',.05,1,.05)}`
          :`${ctl('a',uses[0],T.BUTTONS)}${uses[1]!==null?ctl('b',uses[1],T.BUTTONS):''}${three?ctl('c',uses[2],T.BUTTONS):''}${servo?num('posA',x.mode==='momentary'?'When let go (0 to 1)':posName(0),0,1,.01)+num('posB',x.mode==='momentary'?'While held (0 to 1)':posName(1),0,1,.01)+(three?num('posC',posName(2),0,1,.01):''):num('power','Power (0 to 1)',.05,1,.05)}`;
        const meter=x.mode==='off'?'':servo?`<div class="rt-meter rt-meter-servo" data-rt-meter><div class="rt-track"><i data-rt-dot></i></div><p class="hint" data-rt-meter-say>Not moved yet</p></div>`:`<div class="rt-meter" data-rt-meter><div class="rt-track rt-track-mid"><i data-rt-bar></i></div><p class="hint" data-rt-meter-say>Stopped</p></div>`;
        pane=`<section class="cal-card rt-card"><h2>${esc(x.label)}</h2><p class="hint">${esc(KIND[x.kind]||x.kind)} “${esc(x.device||'not named yet')}” in the robot configuration. Use its control on the controller and the meter shows what the TeleOp will tell it.</p>
          <div class="rt-live">${padBox}<div class="rt-chassis rt-mech-live"><h3 class="cal-group-title">Right now</h3>${meter||'<p class="hint">It is not in this TeleOp.</p>'}${onPad1?'':'<p class="hint">Its controls are on Controller 2. Until a second controller is connected, Controller 1 stands in for it on this page.</p>'}</div></div>${bindNote}
          <div class="cal-fields"><div class="cal-field"><label for="rt-mode">What it does</label><select id="rt-mode" data-rt-mode="${esc(x.id)}">${modes.map(v=>`<option value="${v}"${x.mode===v?' selected':''}>${esc(T.MODES[v])}</option>`).join('')}</select></div>${fields}
          <div class="cal-field"><label for="rt-pad">All the mechanisms are on</label><select id="rt-pad" data-rt-pad><option value="gamepad1"${onPad1?' selected':''}>Controller 1, with the driving</option><option value="gamepad2"${onPad1?'':' selected'}>Controller 2, a second driver</option></select></div></div>
          ${x.full?'<p class="cal-sense-note bad">No control is left for it on this controller: free one on another mechanism, or put the mechanisms on a second controller.</p>':!x.device?'<p class="cal-sense-note bad">It has no name in the robot configuration yet: name it in Setup → Mechanisms.</p>':unset?'<p class="cal-note">Its positions are the same, so it will not move: type where it should go (0 to 1). Start near the middle and work outwards.</p>':''}${clashNote}</section>`;}
      else if(view==='send')pane=`<section class="cal-card rt-card"><h2>Send to robot</h2><p class="hint">The TeleOp is written from Setup and from what Calibrate measured, and Torque puts it on the robot, where it shows in Drive under the name you give it.</p>
        ${b.tele.error?`<p class="cal-sense-note bad">${esc(b.tele.error)}</p>`:''}${clashNote}
        <div class="button-row rt-send"><button type="button" class="primary" data-rt="send"${!can||sending?' disabled':''}>${sending?'Sending…':'Send to robot'}</button><label class="rt-auto"><input type="checkbox" data-rt-auto${b.state.auto?' checked':''}> Send it by itself when it changes</label></div>
        <p class="hint at-named">Shows in Drive as “${esc(b.tele.opMode||b.state.name||T.FULL_OP_MODE)}”. <button type="button" class="text-button" data-rt="rename"${can?'':' disabled'}>Rename…</button></p>
        <p class="hint" role="status" data-rt-status>${esc(status(b))}</p>
        <div class="button-row"><button type="button" class="secondary" data-rt="save"${can?'':' disabled'}>Save as a file…</button><button type="button" class="secondary" data-rt="copy"${can?'':' disabled'}>Copy</button><span class="hint" role="status" data-rt-saved>${esc(savedNote)}</span></div>
        ${src?`<details class="usb-facts"><summary>See the code</summary><pre class="cal-cam-code cal-chassis-code" data-rt-code>${esc(src)}</pre></details>`:''}</section>
        <dialog class="at-name" aria-labelledby="rt-name-title"><form method="dialog"><h2 id="rt-name-title">Name the TeleOp</h2><p class="hint">This is the name it shows under in Drive, in the TeleOp list.</p><div class="cal-field"><label for="rt-name-input">Name</label><input id="rt-name-input" type="text" maxlength="60" autocomplete="off" spellcheck="false"></div><div class="button-row"><button type="submit" value="go" class="primary" data-rt-go>Send to robot</button><button type="submit" value="no" class="secondary">Cancel</button></div></form></dialog>`;
      else{const values=o.values?.()||null;pane=`<section class="cal-card rt-card"><h2>Calibration code</h2><p class="hint">Everything Calibrate measured on this robot (the chassis, the mechanisms, the cameras) as one class, TorqueCalibration, for the team’s own code. It builds in OnBot Java as it is: put it on the robot, or save the file. The raw numbers save as JSON too.</p>
        ${values?`<div class="button-row"><button type="button" class="primary" data-rt="values-send"${valuesSending?' disabled':''}>${valuesSending?'Sending…':'Put it on the robot (OnBot Java)'}</button><button type="button" class="secondary" data-rt="values-java">Save the Java class…</button><button type="button" class="secondary" data-rt="values-json">Save as JSON…</button><button type="button" class="secondary" data-rt="values-copy">Copy</button></div><p class="hint" role="status" data-rt-values>${esc(valuesNote)}</p><details class="usb-facts" open><summary>See the code</summary><pre class="cal-cam-code cal-chassis-code" data-rt-values-code>${esc(values.java)}</pre></details>`:'<p class="hint">Nothing is measured yet: Calibrate → Mechanisms and Camera measure it.</p>'}</section>`;}
      const html=`<div class="cal-elec2 rt2"><aside class="sim-garage cal-elec-list" aria-label="TeleOp: driving, each mechanism, and sending it">${rail}</aside><div class="rt-pane">${pane}</div></div>`;
      // The same page again changes nothing: an open list or a field being typed in is left alone.
      if(html!==drawn&&!box.querySelector?.('dialog[open]')){const same=shown===view,at=dom&&same?[box.querySelector('.rt-pane')?.scrollTop||0,box.querySelector('.cal-elec-list')?.scrollTop||0]:null,focus=dom&&same?document.activeElement?.id:'';
        drawn=html;shown=view;box.innerHTML=html;live=null;
        // Where the page was scrolled to, and the field in use, stay as they were through a redraw.
        if(at){const pn=box.querySelector('.rt-pane'),ls=box.querySelector('.cal-elec-list');if(pn)pn.scrollTop=at[0];if(ls)ls.scrollTop=at[1];if(focus&&/^rt-/.test(focus))box.querySelector('#'+focus)?.focus?.();}}
      auto(b);if(dom)kick();}
    // Sent by itself: when the tab is showing, a robot is connected, nothing else is using it, and what is on the robot
    // is not what is written now. It waits a moment, so a run of changes goes as one.
    function auto(b){clearTimeout(timer);if(!b.state.auto||sending||b.tele.error||!b.tele.source||b.clashes.length||!o.visible()||!o.connected()||o.busy())return;if(lastSent().sig===sig(b.tele.source))return;
      timer=setTimeout(()=>{const now=build(o);if(now.tele.source&&now.state.auto&&o.visible()&&o.connected()&&!o.busy()&&!now.clashes.length&&lastSent().sig!==sig(now.tele.source))void send(now);},1500);}
    // Send to robot asks for the name first, in a pop-up, as Autonomous does; Rename only keeps it. Sent by itself, it goes under the name it has.
    function ask(sendAfter){const d=box.querySelector('dialog.at-name');if(!d)return;const b=build(o),input=d.querySelector('input'),go=d.querySelector('[data-rt-go]');input.value=b.state.name||T.FULL_OP_MODE;go.textContent=sendAfter?'Send to robot':'Save the name';d.returnValue='';
      d.onclose=()=>{if(d.returnValue!=='go')return render();const next=cleanName(input.value);keep(st=>{if(next&&next!==T.FULL_OP_MODE)st.name=next;else delete st.name;});said='';drawn='';if(!sendAfter)return render();void send(build(o));};
      if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','');input.focus();input.select?.();}
    function send(b){if(sending||b.tele.error||!b.tele.source)return Promise.resolve();sending=true;said='';render();const t=b.tele;
      return Promise.resolve().then(()=>o.send(t)).then(()=>{o.sent.set(JSON.stringify({sig:sig(t.source),at:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}));said='';},e=>{said=`It did not get there: ${e?.message||e}`;}).finally(()=>{sending=false;render();});}
    // ---- picking: from a list, or by using the control -------------------------------------------------------------------
    // A job on the stick that drives moves the driving to the other stick.
    function pickMap(k,v){const m=o.map();if(k==='turn'&&(v==='left'||v==='right')&&m.drive===v)o.setMap('drive',v==='left'?'right':'left');if(k==='drive'&&m.turn===v)o.setMap('turn',v==='left'?'right':'left');o.setMap(k,v);}
    // A control another mechanism has: two plain buttons swap; anything else, the other one takes what is left.
    function pickBtn(id,k,v){const b=build(o),me=b.list.find(x=>x.id===id);if(!me)return;const mine=me[k],parts=T.partsOf(v),plain=c=>Object.hasOwn(T.BUTTONS,c);
      keep(s=>{for(const x of b.list)if(x.mode!=='off')s.mechs[x.id]={...s.mechs[x.id],mode:x.mode,a:x.a,b:x.b,c:x.c};s.mechs[id]={...s.mechs[id],[k]:v};
        for(const ok of ['a','b','c'])if(ok!==k&&v!=='none'&&T.partsOf(s.mechs[id][ok]).some(p=>parts.includes(p)))s.mechs[id][ok]=plain(mine)&&plain(v)&&ok!=='a'?mine:'none';
        for(const x of b.list){if(x.id===id||x.mode==='off')continue;for(const k2 of ['a','b','c'])if(T.partsOf(x[k2]).some(p=>parts.includes(p))){if(plain(v)&&plain(mine)&&x[k2]===v)s.mechs[x.id][k2]=mine;else delete s.mechs[x.id][k2];}}});}
    // Bound by using it: the first stick moved or button pressed that was not already held when Bind was pressed.
    function bindStep(pad,slot=0){const bd=binding;if(!bd)return;const was=bd.base[slot],far=(x,y)=>Math.hypot(x,y)>.6,fresh=n=>pad[n]&&!was[n],trig=n=>pad[n]>.6&&!(was[n]>.6);
      if(performance.now()-bd.at>10000){binding=null;drawn='';return render();}
      let got=null;const [kind,a1,a2]=keyOf(bd.key);
      if(kind==='map'){const k=a1,L=far(pad.lx,pad.ly)&&!far(was.lx,was.ly),R=far(pad.rx,pad.ry)&&!far(was.rx,was.ry),bump=fresh('left_bumper')||fresh('right_bumper'),trg=trig('lt')||trig('rt'),dp=fresh('dpad_left')||fresh('dpad_right');
        if(k==='drive')got=L?'left':R?'right':null;
        else if(k==='turn')got=L?'left':R?'right':trg?'triggers':bump?'bumpers':null;
        else if(k==='spin')got=bump?'bumpers':trg?'triggers':dp?'dpad':null;
        else got=Object.keys(T.MAP[k]).find(v=>v!=='none'&&(/_trigger$/.test(v)?trig(v==='left_trigger'?'lt':'rt'):fresh(v)))||null;
        if(got){binding=null;drawn='';pickMap(k,got);return render();}return;}
      const state=clean(o.store.get(),T),chassisHas=state.pad==='gamepad1'?T.chassisParts(o.map(),!!o.swerve()):[],free=c=>!T.partsOf(c).some(p=>chassisHas.includes(p)),me=build(o).list.find(x=>x.id===a1),analog=me&&(me.mode==='axis'||me.mode==='follow')&&a2==='a';
      if(analog){const big=(v,w)=>Math.abs(v)>.6&&Math.abs(v)>=Math.abs(w),moved=(v,o2)=>Math.abs(v)>.6&&!(Math.abs(o2)>.6);
        got=[['left_stick_y',moved(pad.ly,was.ly)&&big(pad.ly,pad.lx)],['left_stick_x',moved(pad.lx,was.lx)&&big(pad.lx,pad.ly)],['right_stick_y',moved(pad.ry,was.ry)&&big(pad.ry,pad.rx)],['right_stick_x',moved(pad.rx,was.rx)&&big(pad.rx,pad.ry)],['right_trigger',trig('rt')],['left_trigger',trig('lt')]].find(([c,on])=>on&&free(c))?.[0]||null;}
      else got=Object.keys(T.BUTTONS).find(v=>free(v)&&(/_trigger$/.test(v)?trig(v==='left_trigger'?'lt':'rt'):fresh(v)))||null;
      if(got){binding=null;drawn='';pickBtn(a1,a2,got);return render();}}
    // ---- the live picture ----------------------------------------------------------------------------------------------
    function kick(){if(!raf&&dom&&o.visible())raf=requestAnimationFrame(frame);}
    function frame(t){raf=0;if(!o.visible())return;const dt=Math.max(.001,Math.min(.05,(t-lastT)/1000||.016));lastT=t;try{paint(dt);}catch{}raf=requestAnimationFrame(frame);}
    function paint(dt){const q=s=>box.querySelector(s);
      if(!live){const svg=q('.rt-pad-art svg');live={svg,travel:+(svg?.dataset.stickTravel||8),trigH:+(svg?.dataset.triggerHeight||34),trigB:+(svg?.dataset.triggerBottom||40),pods:[...box.querySelectorAll('[data-rt-pod]')],arrows:[...box.querySelectorAll('[data-rt-arrow]')],go:q('[data-rt-go]'),readout:q('[data-rt-readout]'),name:q('[data-rt-padname]'),tiles:[...box.querySelectorAll('[data-rt-tile]')],keys:[...box.querySelectorAll('.rt-pad-art [data-pad-button]')],bar:q('[data-rt-bar]'),dot:q('[data-rt-dot]'),meterSay:q('[data-rt-meter-say]'),c:build(o)};}
      const L=live,c=L.c,pad=padOf(info?.readings?.[0]||null),pad2=padOf(info?.readings?.[1]||null),mpad=c.state.pad==='gamepad2'&&info?.slots?.[1]?pad2:pad,keyboard=info?.source1==='keyboard',has=!!info?.slots?.[0];
      if(L.name){const t=keyboard?'Controller 1 is the keyboard: W A S D is the left stick, the arrow keys the right.':has?`Controller 1: ${info.slots[0].id||'a gamepad'}.`:'No controller yet: press a button on one, or set the keyboard as Controller 1.';if(L.name.textContent!==t)L.name.textContent=t;}
      if(L.svg){q('#rt-stick-left-dot')?.setAttribute('transform',`translate(${pad.lx*L.travel} ${pad.ly*L.travel})`);q('#rt-stick-right-dot')?.setAttribute('transform',`translate(${pad.rx*L.travel} ${pad.ry*L.travel})`);
        for(const [side,v] of [['left',pad.lt],['right',pad.rt]]){const f=q(`#rt-trigger-${side}-fill`);if(f){const h=v*L.trigH;f.setAttribute('y',String(L.trigB-h));f.setAttribute('height',String(h));}}
        for(const node of L.keys){const n=ORDER[+node.dataset.padButton];node.classList.toggle('pressed',/_trigger$/.test(n||'')?pad[n==='left_trigger'?'lt':'rt']>.2:!!pad[n]);}}
      if(binding)bindStep(binding.key.startsWith('map:')?pad:mpad,binding.key.startsWith('map:')?0:mpad===pad2?1:0);
      // The mechanism a control works lights up in the list.
      for(const el of L.tiles)el.classList.toggle('rt-on',['a','b','c'].some(k=>active(mpad,el.dataset[k])));
      if(view.startsWith('mech:')){const x=c.list.find(m=>'mech:'+m.id===view);if(!x||x.mode==='off')return;const key=[x.id,x.mode,x.a,x.b,x.c].join('|');/* A button still held from binding it is not a press. */if(mechSt.id!==key)mechSt={id:key,st:{was:true}};const r=T.mechStep(x,mechSt.st,mpad);
        if(x.kind==='servo'){const pos=r.position,names=(x.states||[]).map(t=>t?t[0].toUpperCase()+t.slice(1):t);if(L.dot){L.dot.style.left=`${(pos??x.posA)*100}%`;L.dot.classList.toggle('rt-unset',pos===null);}
          const t=pos===null?'Not moved yet: it stays where it is until its control is used.':`At ${pos.toFixed(2)}${r.at!==null&&names[r.at]?` · ${names[r.at].toLowerCase()}`:''}`;if(L.meterSay&&L.meterSay.textContent!==t)L.meterSay.textContent=t;}
        else{const p=r.power;if(L.bar){L.bar.style.left=p<0?`${50+p*50}%`:'50%';L.bar.style.width=`${Math.abs(p)*50}%`;L.bar.className=p<0?'rt-rev':'rt-fwd';}
          const t=Math.abs(p)<.005?'Stopped':`Running ${p>0?'forwards':'backwards'} at ${Math.round(Math.abs(p)*100)}%`;if(L.meterSay&&L.meterSay.textContent!==t)L.meterSay.textContent=t;}return;}
      if(view!=='drive'||!c.chassis)return;const cmd=T.command({...c.map,field:'no'},pad,{swerve:c.swerve});
      if(c.chassis.kind==='swerve'){const pods=c.chassis.pods||[],key=pods.map(p=>p.x+','+p.y).join(';');if(sim.key!==key)sim={key,angles:pods.map(()=>0),targets:pods.map(()=>0)};
        const r=T.swerveDrive(pods,sim.angles,sim.targets,cmd);r.forEach((x,i)=>{const rate=Math.max(90,+pods[i].top||400);sim.angles[i]+=Math.sign(x.error)*Math.min(Math.abs(x.error),rate*dt);L.pods[i]?.setAttribute('transform',`rotate(${(-sim.angles[i]).toFixed(1)})`);setArrow(L.arrows[i],x.power);});}
      else{const p=T.wheelPowers(c.chassis.motors||[],cmd,c.chassis.kind);p.forEach((v,i)=>setArrow(L.arrows[i],v));}
      if(L.go){const line=L.go.firstElementChild;line.setAttribute('x2',String(-cmd.left*38));line.setAttribute('y2',String(-cmd.forward*38));L.go.setAttribute('class',Math.hypot(cmd.forward,cmd.left)>.05||Math.abs(cmd.turn)>.05?'rt-go on':'rt-go');}
      if(L.readout){const way=Math.abs(cmd.turn)>.05?(cmd.turn>0?' · turning left':' · turning right'):'',t=`Forward ${cmd.forward.toFixed(2)} · left ${cmd.left.toFixed(2)}${way}${cmd.slow?' · slow':''}${cmd.lock?' · wheels locked':''}`;if(L.readout.textContent!==t)L.readout.textContent=t;}}
    o.onInput?.(next=>{info=next;});if(dom)Promise.resolve(o.inputNow?.()).then(v=>{if(v&&!info)info=v;},()=>{});
    box.addEventListener('change',e=>{const t=e.target,d=t.dataset;said='';
      if(d.rtMap)return void pickMap(d.rtMap,t.value);
      if('rtPad' in d){keep(s=>{s.pad=t.value==='gamepad2'?'gamepad2':'gamepad1';});return render();}
      if('rtAuto' in d){keep(s=>{s.auto=!!t.checked;});return render();}
      if(d.rtMode){keep(s=>{s.mechs[d.rtMode]={...s.mechs[d.rtMode],mode:t.value};for(const k of ['a','b','c'])delete s.mechs[d.rtMode][k];});return render();}
      if(d.rtBtn){pickBtn(d.rtBtn,d.k,t.value);return render();}
      if(d.rtNum){const v=+t.value;if(!Number.isFinite(v))return;keep(s=>{s.mechs[d.rtNum]={...s.mechs[d.rtNum],[d.k]:d.k==='power'?Math.max(.05,Math.min(1,v)):Math.max(0,Math.min(1,v))};});return render();}});
    box.addEventListener('click',e=>{const to=e.target.closest?.('[data-rt-view]')?.dataset.rtView;if(to){view=to;binding=null;return render();}
      const bindKey=e.target.closest?.('[data-rt-bind]')?.dataset.rtBind;
      if(bindKey){if(binding?.key===bindKey)binding=null;else{const [kind,a1,a2]=keyOf(bindKey),me=kind==='mech'?build(o).list.find(x=>x.id===a1):null,analog=me&&(me.mode==='axis'||me.mode==='follow')&&a2==='a';binding={key:bindKey,at:typeof performance==='object'?performance.now():0,base:[padOf(info?.readings?.[0]),padOf(info?.readings?.[1])],ask:kind==='map'?ASK[a1]:analog?'Move the stick, or squeeze the trigger, it should follow…':'Press the button for it on the controller…'};}drawn='';return render();}
      const a=e.target.closest?.('[data-rt]')?.dataset.rt;if(!a)return;const b=build(o),note=t=>{savedNote=t;const n=box.querySelector('[data-rt-saved]');if(n)n.textContent=t;drawn='';},vnote=t=>{valuesNote=t;const n=box.querySelector('[data-rt-values]');if(n)n.textContent=t;drawn='';};
      const saved=say=>f=>say(f?`Saved to ${f}`:''),failed=say=>x=>say(`It was not saved: ${x?.message||x}`);
      if(a==='setup')return void o.toSetup?.();if(a==='controller')return void o.openController?.();
      if(a==='send'||a==='rename')return ask(a==='send');
      if(a==='save'&&b.tele.source)return void Promise.resolve(o.saveFile(b.tele.file,b.tele.source)).then(saved(note),failed(note));
      if(a==='copy'&&b.tele.source)return void Promise.resolve(o.copy(b.tele.source)).then(()=>note('Copied.'),()=>note('It could not be copied: open See the code and select it.'));
      const v=o.values?.();if(!v)return;
      if(a==='values-send'){if(valuesSending)return;valuesSending=true;valuesNote='';drawn='';render();return void Promise.resolve().then(()=>o.sendValues(v.java)).then(t=>{valuesNote=t||'On the robot.';},x=>{valuesNote=`It did not get there: ${x?.message||x}`;}).finally(()=>{valuesSending=false;drawn='';render();});}
      if(a==='values-java')return void Promise.resolve(o.saveFile('TorqueCalibration.java',v.java)).then(saved(vnote),failed(vnote));
      if(a==='values-json')return void Promise.resolve(o.saveFile(v.jsonName||'torque-calibration.json',v.json)).then(saved(vnote),failed(vnote));
      if(a==='values-copy')return void Promise.resolve(o.copy(v.java)).then(()=>vnote('Copied.'),()=>vnote('It could not be copied.'));});
    return {refresh:render,build:()=>build(o),show:v=>{view=v;render();}};}
  return {create,build,clean,padOf,chassisArt,says};});
