(function(root){
  'use strict';
  // Calibrate → Electronics → Live debug. Torque Debug (src/onbot/TorqueDebug.java) runs on the robot and streams every
  // motor encoder, servo, digital and analog input and I2C sensor in its configuration; this panel lays them out hub by
  // hub and port by port as Setup wired them (DeckWiring rows, matched by device name), reads them live, and drives the
  // outputs: motors and continuous servos hold-to-run (the slider springs back to 0 and the robot's watchdog stops them if
  // Deck goes quiet), servos to a commanded position. Values are raw hub units with what they mean beside them: a switch's
  // pressed state from its active-low wiring, an analog sensor's angle, a motor's RPM from its model's counts a turn.
  // A timeline plots any channel picked (click a value). The Mechanisms gates run one output briefly and see which inputs
  // answered, so "the intake changes the colour sensor" or "the slide trips its magnet switch" is measured.
  // simulation.js gives it a host, the app api and the project; it touches nothing else.
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const finite=Number.isFinite,fix=(v,d=2)=>finite(v)?(+v).toFixed(d):'—',H=()=>root.DeckHardware,W=()=>root.DeckWiring;
  const SPAN=10;// seconds of history the timeline keeps
  // What an analog sensor's volts mean: degrees for angle sensors (an Axon's feedback runs backwards), else none.
  function analogMeaning(md,v,max){if(!md||!finite(v))return '';const span=md.voltage||max||3.3;
    if(md.kind==='axonFeedback')return `${fix((1-v/span)*360,1)}°`;
    if(md.kind==='potentiometer'){/* REV: V = 445.5·(θ−270)/(θ²−270θ−36450), solved for θ (non-linear) */const a=v,b=-270*v-445.5,c=-36450*v+445.5*270;const d=b*b-4*a*c;if(!a||d<0)return '';return `${fix((-b-Math.sqrt(d))/(2*a),1)}° (REV curve)`;}
    if(md.degrees)return `${fix(v/span*md.degrees,1)}°`;return '';}
  function create({host,api,native,project,link,onChange=()=>{}}){
    let manifest=null,frame=null,frames=[],running=false,starting=false,plot=new Set(),edges={},seen={},pulse=null,lastPaint=0,paintQueued=false;
    const send=line=>native&&running?api.robotLink('debug-send',{line}).catch(()=>false):Promise.resolve(false);
    const listeners=new Set(),cameraListeners=new Set();
    host.innerHTML=`<div class="cal-debug-head"><div><h2 id="cal-debug-title">Live debug</h2><p class="hint">Every motor, servo and sensor on the robot, live. Motors and continuous servos run only while you hold their slider; the robot stops them by itself if Torque goes quiet. Put the robot on blocks first.</p></div>
      <div class="cal-debug-state"><i class="dot" data-debug-dot></i><span data-debug-status role="status">Not connected</span></div></div>
      <div class="button-row cal-debug-actions"><button type="button" class="secondary" data-debug-install>Put Torque Debug on the robot</button><button type="button" class="primary" data-debug-start>Start live debug</button><button type="button" class="danger" data-debug-stopall disabled>Stop all outputs</button></div>
      <div class="cal-debug-params" data-debug-params hidden></div>
      <p class="hint cal-debug-stats" data-debug-stats></p>
      <section class="cal-check" data-check hidden><h3 class="cal-group-title">Check every device</h3><p class="hint" data-check-note></p><div class="button-row"><button type="button" class="primary" data-check-all>Check all, one at a time</button><button type="button" class="secondary" data-check-stop disabled>Stop</button></div><div data-check-rows></div></section>
      <div data-debug-hubs class="cal-debug-hubs"></div>
      <div class="cal-debug-tools" data-debug-tools hidden><section><h3 class="cal-group-title">Timeline</h3><p class="hint">Click any reading to plot it; each line is scaled to its own range. Last ${SPAN} s.</p><canvas data-debug-chart height="160"></canvas><div data-debug-legend class="cal-debug-legend"></div></section></div>`;
    const q=s=>host.querySelector(s);
    const status=(text,kind='')=>{q('[data-debug-status]').textContent=text;q('[data-debug-dot]').className=`dot${kind?' '+kind:''}`;};
    // ---- the parameters, set before Torque Debug goes on the robot and kept for the device check
    const C=()=>root.DeckDebugCheck,PARAMS='torque-debug-params';
    let params=(()=>{try{return C().sanitize(JSON.parse(localStorage.getItem(PARAMS)||'null'));}catch{return C().sanitize(null);}})();
    function paramsPaint(){const c=C(),p=params,bad=c.problem(p),opts=(list,now,unit)=>list.map(v=>`<option value="${v}"${v===now?' selected':''}>${v}${unit}</option>`).join('');
      q('[data-debug-params]').innerHTML=`<h3>Before it goes on the robot</h3><p class="hint">Torque Debug uses every device in the robot’s active configuration, so what you set up in Configure is what it checks.</p>
        <div class="cal-fields"><div class="cal-field"><label for="cal-debug-motor">Motor speed</label><select id="cal-debug-motor" data-param="motor">${opts(c.motorChoices(p.over),p.motor,'%')}</select></div><div class="cal-field"><label for="cal-debug-servo-a">Servo angle 1</label><select id="cal-debug-servo-a" data-param="servoA">${opts(c.servoChoices(),p.servoA,'°')}</select></div><div class="cal-field"><label for="cal-debug-servo-b">Servo angle 2</label><select id="cal-debug-servo-b" data-param="servoB">${opts(c.servoChoices(),p.servoB,'°')}</select></div></div>
        <label class="check"><input type="checkbox" data-param="over"${p.over?' checked':''}> Allow motor speeds above 40%</label>${p.over?'<p class="cal-debug-warn">Not recommended. Check nothing can hit a hard stop, and keep the robot on blocks.</p>':''}
        <p class="hint"><b>Servos</b> move between the two angles, at least ${c.MIN_APART}° apart; continuous servos turn one way, then the other.</p><p class="hint"><b>Analog:</b> rotate it until Torque tells you to stop with a tone, then let go. You get 3 seconds.</p><p class="hint"><b>Digital:</b> press it and let go, twice. One that is already active is let go first.</p><p class="hint"><b>I2C:</b> nothing to do. Each bus shows whether its device is connected.</p>${bad?`<p class="cal-debug-bad" role="alert">${esc(bad)}</p>`:''}
        <div class="button-row"><button type="button" class="primary" data-debug-go${bad?' disabled':''}>Put it on the robot</button><button type="button" class="secondary" data-debug-cancel>Cancel</button></div>`;}
    // ---- the device check: every device the op mode found, one at a time
    const KINDS={motor:'Motor',crservo:'Continuous servo',servo:'Servo',digital:'Digital device',touch:'Touch sensor',analog:'Analog input',i2c:'I2C device'},checks=new Map();let checkRun=null;
    const devices=()=>{const m=manifest;if(!m)return [];return [...(m.motors||[]).map(name=>({kind:'motor',name})),...(m.crservos||[]).map(name=>({kind:'crservo',name})),...(m.servos||[]).map(name=>({kind:'servo',name})),...(m.digital||[]).map(name=>({kind:'digital',name})),...(m.touch||[]).map(name=>({kind:'touch',name})),...(m.analog||[]).map(a=>({kind:'analog',name:a.n}))];};
    function checkPaint(){const box=q('[data-check]'),list=devices();box.hidden=!list.length;if(!list.length)return;const p=params;
      q('[data-check-note]').textContent=`Put the robot on blocks. Motors run at ${p.motor}%; servos move between ${p.servoA}° and ${p.servoB}°. Change these with Put Torque Debug on the robot.`;
      q('[data-check-all]').disabled=!running||!!checkRun;q('[data-check-stop]').disabled=!checkRun;
      q('[data-check-rows]').innerHTML=list.map(d=>{const c=checks.get(d.name)||{state:'idle',text:'Not checked yet'};return `<div class="cal-check-row" data-check-row="${esc(d.name)}" data-state="${c.state}"><span class="cal-check-name"><code>${esc(d.name)}</code> <small>${KINDS[d.kind]}</small></span><p class="cal-check-text" role="status">${esc(c.text)}</p>${c.state==='ask'?'<button type="button" class="primary" data-check-answer="yes">Yes</button><button type="button" class="secondary" data-check-answer="no">No</button>':`<button type="button" class="secondary" data-check-one="${esc(d.name)}"${!running||checkRun?' disabled':''}>Check</button>`}</div>`;}).join('');}
    const checkSet=(name,state,text)=>{checks.set(name,{state,text});checkPaint();};
    const stopped=()=>!checkRun||checkRun.stop;
    const pause=async ms=>{for(const end=performance.now()+ms;performance.now()<end&&!stopped();)await new Promise(r=>setTimeout(r,Math.min(50,ms)));};
    async function holdOut(cmd,name,power,ms){const line=`${cmd}\t${name}\t${power.toFixed(3)}`;void send(line);const keep=setInterval(()=>void send(line),100);try{await pause(ms);}finally{clearInterval(keep);void send(`${cmd}\t${name}\t0`);}}
    const checkAsk=(name,question)=>new Promise(done=>{checkRun.answer=done;checkSet(name,'ask',question);});
    // An input's check: follows its readings until it is done, or 30 s pass with nothing done.
    const checkWatch=(name,key,start,step,prompt,finished)=>new Promise(done=>{let s=start;checkSet(name,'running',prompt(s));const began=performance.now();
      const finish=ok=>{off();clearInterval(t);done(ok);},off=listeners.add.call(listeners,fn)&&(()=>listeners.delete(fn)),t=setInterval(()=>{if(stopped())finish(null);else if(performance.now()-began>30000)finish(false);},100);
      function fn(_f,v){const next=step(s,v[key],performance.now());if(next===s)return;const was=prompt(s);s=next;if(prompt(s)!==was)checkSet(name,'running',prompt(s));if(finished(s))finish(true);}});
    async function checkOne({kind,name}){const c=C(),p=params,speed=p.motor/100,v=()=>values();
      if(kind==='motor'){const key=`m:${name}:pos`,before=v()[key];checkSet(name,'running',`Running forward at ${p.motor}%…`);await holdOut('M',name,speed,1000);if(stopped())return;const moved=Math.abs((v()[key]??0)-(before??0)),cut=v()[`m:${name}:cut`];await pause(300);checkSet(name,'running',`Running backward at ${p.motor}%…`);await holdOut('M',name,-speed,1000);if(stopped())return;
        if(cut)return checkSet(name,'fail','It drew too much current and was cut. Check nothing is jammed.');if(moved>=5)return checkSet(name,'pass',`It works: the encoder counted ${Math.round(moved)} ticks.`);
        const a=await checkAsk(name,'The encoder did not count. Did the motor turn?');if(a===null)return;return checkSet(name,a?'pass':'fail',a?'It turned, but no encoder is counting: check the encoder cable.':'It did not turn. Check its power cable and the port in Configure.');}
      if(kind==='crservo'){const dir=c.direction(p);checkSet(name,'running','Turning one way…');await holdOut('C',name,dir*speed,1000);if(stopped())return;await pause(300);checkSet(name,'running','Turning the other way…');await holdOut('C',name,-dir*speed,1000);if(stopped())return;
        const a=await checkAsk(name,'Did it turn one way, then the other?');if(a===null)return;return checkSet(name,a?'pass':'fail',a?'It works.':'It did not turn. Check its cable and the port in Configure.');}
      if(kind==='servo'){for(const [i,angle] of [p.servoA,p.servoB,p.servoA,p.servoB].entries()){if(stopped())break;checkSet(name,'running',`Moving to ${angle}° (${i+1} of 4)…`);void send(`S\t${name}\t${c.position(angle).toFixed(3)}`);await pause(1000);}void send(`E\t${name}\t0`);if(stopped())return;
        const a=await checkAsk(name,`Did it move between ${p.servoA}° and ${p.servoB}°?`);if(a===null)return;return checkSet(name,a?'pass':'fail',a?'It works.':'It did not move. Check its cable, its power and the port in Configure.');}
      if(kind==='digital'||kind==='touch'){const key=`d:${name}`,now=v()[key];if(now===undefined)return checkSet(name,'fail','No reading: it is not connected, or not in the configuration.');const md=rows().find(r=>r.name===name),low=kind==='touch'||H().SENSOR_MODELS[md?.model]?.activeLow;
        const ok=await checkWatch(name,key,c.digitalStart(now,!!low&&!now),(s,x)=>c.digitalStep(s,x),c.digitalPrompt,s=>s.done);if(ok===null)return;return checkSet(name,ok?'pass':'fail',ok?c.digitalPrompt({done:true}):'It did not change. Check its cable and the port in Configure.');}
      if(kind==='analog'){let last=null,told=false;const ok=await checkWatch(name,`a:${name}`,c.analogStart(),(s,x,t)=>{last=c.analogStep(s,x,t);if(last.stage==='stop'&&!told){told=true;c.chime();}return last;},c.analogPrompt,s=>s.stage==='done');if(ok===null)return;return checkSet(name,ok?'pass':'fail',ok?c.analogPrompt(last):'It did not change and settle. Check its cable and the port in Configure.');}
    }
    async function checkList(list){if(checkRun||!running)return;checkRun={stop:false};for(const d of list)if(!checks.has(d.name)||list.length===1||checks.get(d.name).state!=='pass')checks.delete(d.name);checkPaint();
      try{for(const d of list){if(stopped())break;await checkOne(d);}}finally{checkRun=null;checkPaint();}}
    function checkStop(){if(!checkRun)return;checkRun.stop=true;checkRun.answer?.(null);for(const [name,c] of checks)if(c.state==='running'||c.state==='ask')checks.set(name,{state:'idle',text:'Stopped'});void send('X');checkPaint();}
    q('[data-check-all]').onclick=()=>void checkList(devices());q('[data-check-stop]').onclick=checkStop;
    q('[data-check-rows]').addEventListener('click',e=>{const a=e.target.closest('[data-check-answer]');if(a){const done=checkRun?.answer;if(checkRun)checkRun.answer=null;done?.(a.dataset.checkAnswer==='yes');return;}const b=e.target.closest('[data-check-one]');if(b){const d=devices().find(x=>x.name===b.dataset.checkOne);if(d)void checkList([d]);}});
    // ---- layout: the wiring's ports, with the robot's devices on them
    function rows(){try{return W().state(project()).rows;}catch{return [];}}
    function layout(){
      const D=H(),m=manifest;if(!m){q('[data-debug-hubs]').innerHTML=native?'':'<p class="hint">Live debug needs the installed app and a robot.</p>';q('[data-debug-tools]').hidden=true;return;}
      const live={motor:m.motors||[],servo:m.servos||[],crservo:m.crservos||[],digital:[...(m.digital||[]),...(m.touch||[])],analog:(m.analog||[]).map(a=>a.n),i2c:(m.i2c||[]).map(d=>d.n)};
      const wiring=W().state(project()).wiring,read=project().calibration?.hub?.readout||[],byName=new Map(rows().filter(r=>r.name).map(r=>[r.name,r])),used=new Set();
      const types=root.DeckRobotConfig?.DEVICE_TYPES||{},typeName=tag=>Object.values(types).flat().find(([t])=>t===tag)?.[1]||'',tagOf=new Map(read.map(d=>[d.name,d.tag]));
      const familyOf=d=>d.bus!==undefined?'i2c':d.kind==='motor'?'motor':['servo','crservo'].includes(d.kind)?'servo':d.kind==='analog'?'analog':['digital','touch'].includes(d.kind)?'digital':null;
      const tile=(fam,name,port)=>{const row=byName.get(name)||null,label=esc(typeName(tagOf.get(name)));const id=`${fam}:${name}`;used.add(id);
        if(fam==='motor')return `<div class="cal-port" data-port="${esc(id)}"><div class="cal-port-head"><b>Motor ${port}</b><code>${esc(name)}</code></div><small>${label}</small>
          <input type="range" min="-1" max="1" step="0.01" value="0" data-hold="M" data-name="${esc(name)}" aria-label="Hold to run ${esc(name)}">
          <dl><dt>Ticks</dt><dd data-live="m:${esc(name)}:pos" data-plot-key="m:${esc(name)}:pos">—</dd><dt>Ticks/s</dt><dd data-live="m:${esc(name)}:vel" data-plot-key="m:${esc(name)}:vel">—</dd><dt>RPM</dt><dd data-live="m:${esc(name)}:rpm">—</dd><dt>Amps</dt><dd data-live="m:${esc(name)}:amps" data-plot-key="m:${esc(name)}:amps">—</dd></dl>
          <button type="button" class="text-button" data-reset="${esc(name)}">Zero encoder</button><span class="cal-port-flag" data-live="m:${esc(name)}:cut"></span></div>`;
        if(fam==='servo')return `<div class="cal-port" data-port="${esc(id)}"><div class="cal-port-head"><b>Servo ${port}</b><code>${esc(name)}</code></div><small>${label}</small>
          <input type="range" min="0" max="1" step="0.005" value="0.5" data-servo="${esc(name)}" aria-label="Commanded position of ${esc(name)}">
          <dl><dt>Commanded</dt><dd data-live="s:${esc(name)}" data-plot-key="s:${esc(name)}">—</dd></dl><label class="check"><input type="checkbox" data-enable="${esc(name)}"> Pulses on</label><label class="check"><input type="checkbox" data-latch="${esc(name)}"> Hold if Torque goes quiet</label></div>`;
        if(fam==='crservo')return `<div class="cal-port" data-port="${esc(id)}"><div class="cal-port-head"><b>Servo ${port}</b><code>${esc(name)}</code></div><small>${label||'Continuous servo'}</small>
          <input type="range" min="-1" max="1" step="0.01" value="0" data-hold="C" data-name="${esc(name)}" aria-label="Hold to run ${esc(name)}"><dl><dt>Power</dt><dd data-live="c:${esc(name)}" data-plot-key="c:${esc(name)}">—</dd></dl></div>`;
        if(fam==='digital'){const md=row&&D.SENSOR_MODELS[row.model];return `<div class="cal-port" data-port="${esc(id)}"><div class="cal-port-head"><b>Digital ${port}</b><code>${esc(name)}</code></div><small>${label}</small>
          <div class="cal-lamp" data-live="d:${esc(name)}" data-plot-key="d:${esc(name)}" data-active-low="${md?.activeLow?1:0}">—</div><small data-live="d:${esc(name)}:edges"></small></div>`;}
        return `<div class="cal-port" data-port="${esc(id)}"><div class="cal-port-head"><b>Analog ${port}</b><code>${esc(name)}</code></div><small>${label}</small>
          <meter min="0" max="${esc(m.analog.find(a=>a.n===name)?.max||3.3)}" data-live="a:${esc(name)}:bar"></meter><dl><dt>Volts</dt><dd data-live="a:${esc(name)}" data-plot-key="a:${esc(name)}">—</dd><dt>Means</dt><dd data-live="a:${esc(name)}:means">—</dd><dt>Seen</dt><dd data-live="a:${esc(name)}:seen">—</dd></dl></div>`;};
      // I2C devices set themselves up, so each bus only says whether what is configured on it is answering.
      const buses=(hub,on)=>{if(D.hubSpec(hub)?.i2c===0)return '';const row=b=>{const here=on.filter(d=>d.bus===b);return `<div class="cal-bus" data-bus="${esc(hub)}:${b}"><b>Bus ${b}</b>${here.map(d=>{used.add(`i2c:${d.name}`);return `<span class="cal-bus-device"><code>${esc(d.name)}</code>${live.i2c.includes(d.name)?`<span class="rs-pill" data-live="ib:${esc(d.name)}">Waiting…</span>`:'<span class="rs-pill">In the configuration; Torque Debug can\u2019t read this type</span>'}</span>`;}).join('')||'<span class="hint">Nothing configured</span>'}</div>`;};return `<div class="cal-port-group"><h4>I2C buses</h4><div class="cal-buses">${[0,1,2,3].map(row).join('')}</div></div>`;};
      const order=D.hubIds(wiring),hubs=[...new Set(['control',...read.filter(d=>d.hub).map(d=>d.hub)])].sort((x,y)=>(order.indexOf(x)+1||99)-(order.indexOf(y)+1||99));
      const cards=read.length?hubs.map(hub=>{const on=read.filter(d=>d.hub===hub),html=[['motor','Motors'],['servo','Servos'],['analog','Analog'],['digital','Digital']].map(([fam,title])=>{const cells=on.filter(d=>familyOf(d)===fam).sort((x,y)=>x.port-y.port).map(d=>{const f=fam==='servo'&&live.crservo.includes(d.name)?'crservo':fam;return live[f]?.includes(d.name)?tile(f,d.name,d.port):`<div class="cal-port missing"><div class="cal-port-head"><b>${title.replace(/s$/,'')} ${d.port}</b><code>${esc(d.name)}</code></div><small>In the robot’s configuration, but Torque Debug is not reading it. Check its cable, then restart live debug.</small></div>`;});return cells.length?`<div class="cal-port-group"><h4>${title}</h4><div class="cal-ports">${cells.join('')}</div></div>`:'';}).join('')+buses(hub,on.filter(d=>d.bus!==undefined));
        return `<section class="cal-hub"><h3>${esc(D.hubName(hub,wiring))}</h3>${html}</section>`;}):[];
      // What the robot reports that the read configuration did not list: read it again in Setup to place it on its port.
      const other=[...live.motor.map(n=>['motor',n]),...live.servo.map(n=>['servo',n]),...live.crservo.map(n=>['crservo',n]),...live.analog.map(n=>['analog',n]),...live.digital.map(n=>['digital',n])].filter(([f,n])=>!used.has(`${f}:${n}`));
      if(other.length)cards.push(`<section class="cal-hub"><h3>On the robot</h3><div class="cal-ports">${other.map(([f,n])=>tile(f,n,'')).join('')}</div></section>`);
      q('[data-debug-hubs]').innerHTML=`<p class="hint">Everything here comes from the robot’s active configuration. A port can be in the configuration with nothing plugged in: its motor won’t move and its sensor won’t change.</p>${cards.join('')}`;
      q('[data-debug-tools]').hidden=false;
      for(const k of plot)host.querySelector(`[data-plot-key="${CSS.escape(k)}"]`)?.classList.add('plotted');
      paint(true);}
    // ---- readings
    function values(f=frame){const m=manifest,out={};if(!m||!f)return out;
      (m.motors||[]).forEach((n,i)=>{const r=f.m?.[i];if(!r)return;out[`m:${n}:pos`]=r[0];out[`m:${n}:vel`]=r[1];out[`m:${n}:power`]=r[2];out[`m:${n}:amps`]=r[3];out[`m:${n}:cut`]=r[4];});
      (m.servos||[]).forEach((n,i)=>{const r=f.s?.[i];if(r){out[`s:${n}`]=r[0];out[`s:${n}:on`]=r[1];}});
      (m.crservos||[]).forEach((n,i)=>{out[`c:${n}`]=f.c?.[i];});
      (m.digital||[]).forEach((n,i)=>{out[`d:${n}`]=f.d?.[i];});(m.touch||[]).forEach((n,i)=>{out[`d:${n}`]=f.touch?.[i]?0:1;});// a pressed touch sensor reads like an active-low switch
      (m.analog||[]).forEach((a,i)=>{out[`a:${a.n}`]=f.a?.[i];});
      (m.i2c||[]).forEach((d,i)=>{const r=f.i?.[i];if(r?.v)for(const [k,v] of Object.entries(r.v))if(typeof v==='number')out[`i:${d.n}:${k}`]=v;});
      return out;}
    function paint(force){
      const now=performance.now();if(!force&&now-lastPaint<66){if(!paintQueued){paintQueued=true;requestAnimationFrame(()=>{paintQueued=false;paint(true);});}return;}lastPaint=now;
      const f=frame,m=manifest;if(!f||!m)return;const D=H(),byName=new Map(rows().map(r=>[r.name,r])),v=values(f);
      q('[data-debug-stats]').textContent=`Loop ${fix(f.loop,1)} ms · battery ${fix(f.v,2)} V · robot clock ${fix(f.t/1000,1)} s${f.q?` · step test on ${f.q.actuator}: target ${fix(f.q.target,1)}, error ${fix(f.q.error,1)}, power ${fix(f.q.out,2)}`:''}`;
      for(const el of host.querySelectorAll('[data-live]')){const key=el.dataset.live,[kind,name,field]=key.split(':');
        if(kind==='m'){const row=byName.get(name),cpr=D.MODELS[row?.model]?.cpr;
          if(field==='rpm')el.textContent=cpr&&finite(v[`m:${name}:vel`])?fix(v[`m:${name}:vel`]/cpr*60,0):'—';else if(field==='cut')el.textContent=v[`m:${name}:cut`]?'Cut: drew too much current. Move its slider to run it again.':'';
          else el.textContent=field==='pos'?(v[key]??'—'):fix(v[key],field==='amps'?2:0);}
        else if(kind==='s'||kind==='c')el.textContent=fix(v[key],3);
        else if(kind==='d'){if(field==='edges'){el.textContent=edges[name]?`${edges[name]} changes`:'';continue;}const raw=v[`d:${name}`],low=el.dataset.activeLow==='1';el.textContent=raw===undefined?'—':`${raw?'HIGH':'LOW'}${low?` · ${raw?'released':'pressed'}`:''}`;el.dataset.on=raw===undefined?'':String(low?!raw:!!raw);}
        else if(kind==='a'){const val=v[`a:${name}`],row=byName.get(name),md=row&&D.SENSOR_MODELS[row.model];
          if(field==='bar')el.value=finite(val)?val:0;else if(field==='means')el.textContent=analogMeaning(md,val,m.analog.find(a=>a.n===name)?.max)||'—';else if(field==='seen')el.textContent=seen[name]?`${fix(seen[name][0])}–${fix(seen[name][1])} V`:'—';else el.textContent=fix(val,3);}
        else if(kind==='ib'){const r=f.i?.[m.i2c.findIndex(d=>d.n===name)],on=!!r?.v;el.textContent=on?'Connected':'Not answering';el.className=`rs-pill ${on?'ok':'warn'}`;}}
      chart();}
    function chart(){
      const canvas=q('[data-debug-chart]');if(!canvas||!plot.size||canvas.closest('[hidden]'))return;const w=canvas.clientWidth||600;if(canvas.width!==w)canvas.width=w;const h=canvas.height,g=canvas.getContext('2d');g.clearRect(0,0,w,h);
      const css=getComputedStyle(host),colors=['--accent','--warning','--danger','--success','--text'].map(c=>css.getPropertyValue(c).trim()||'#4ea1ff');
      const end=frames.at(-1)?.t??0,keys=[...plot],legend=[];
      keys.forEach((key,k)=>{const pts=frames.filter(f=>f.t>=end-SPAN*1000).map(f=>[f.t,values(f)[key]]).filter(([,x])=>finite(x));if(!pts.length)return;
        let lo=Math.min(...pts.map(p=>p[1])),hi=Math.max(...pts.map(p=>p[1]));if(hi-lo<1e-9){hi+=.5;lo-=.5;}
        g.strokeStyle=colors[k%colors.length];g.lineWidth=1.5;g.beginPath();pts.forEach(([t,x],i)=>{const px=(t-(end-SPAN*1000))/(SPAN*1000)*w,py=h-4-(x-lo)/(hi-lo)*(h-8);i?g.lineTo(px,py):g.moveTo(px,py);});g.stroke();
        legend.push(`<span style="--c:${colors[k%colors.length]}"><i></i>${esc(key.replace(/^[a-z]:/,''))} ${fix(lo)}–${fix(hi)}</span>`);});
      q('[data-debug-legend]').innerHTML=legend.join('');}
    // ---- events from the robot link
    function event(e){
      if(e.camera){for(const fn of cameraListeners)fn(e.camera);return;}
      if(e.manifest){manifest=e.manifest;frames=[];edges={};seen={};checks.clear();status('Live: reading the robot','live');layout();checkPaint();onChange();return;}
      if(e.frame){const prev=values(frame);frame=e.frame;frames.push(frame);const cut=frame.t-(SPAN+2)*1000;while(frames.length&&frames[0].t<cut)frames.shift();
        const v=values(frame);for(const [k,x] of Object.entries(v)){if(k.startsWith('d:')&&prev[k]!==undefined&&prev[k]!==x)edges[k.slice(2)]=(edges[k.slice(2)]||0)+1;if(k.startsWith('a:')&&finite(x)){const n=k.slice(2),s=seen[n]||[x,x];seen[n]=[Math.min(s[0],x),Math.max(s[1],x)];}}
        if(pulse)pulse.frames.push(frame);for(const fn of listeners)fn(frame,v);paint(false);return;}
      if(e.ended||e.error){checkStop();running=false;starting=false;status(e.error?e.error:{stopped:'Stopped',ended:'Torque Debug stopped on the robot',lost:'Lost the robot connection',time:'Stopped after an hour'}[e.ended]||'Stopped',e.error?'error':'');buttons();checkPaint();onChange();}}
    if(native&&api.onRobotDebug)api.onRobotDebug(event);
    function buttons(){q('[data-debug-start]').textContent=running||starting?'Stop live debug':'Start live debug';q('[data-debug-stopall]').disabled=!running;q('[data-debug-install]').disabled=running||starting;}
    async function start(){
      if(!native)return status('Live debug needs the installed app.','error');if(running||starting)return stop();
      const {host:to,label}=link();starting=true;buttons();status(`Starting Torque Debug on ${label}…`);
      try{await api.robotLink('debug-start',{host:to});running=true;}catch(e){status(e.message,'error');}finally{starting=false;buttons();checkPaint();onChange();}}
    async function stop(){checkStop();for(const s of host.querySelectorAll('[data-hold]'))s.value=0;await api.robotLink('debug-stop').catch(()=>{});running=false;buttons();checkPaint();onChange();}
    q('[data-debug-start]').onclick=()=>void start();
    q('[data-debug-stopall]').onclick=()=>{checkStop();for(const s of host.querySelectorAll('[data-hold]'))s.value=0;for(const c of host.querySelectorAll('[data-enable]'))c.checked=false;void send('X');};
    async function install(){const {host:to,label}=link(),b=q('[data-debug-install]');b.disabled=true;status(`Putting Torque Debug on ${label} and building…`);
      try{const r=await api.robotLink('debug-install',{host:to});status(r?.built===false?`The robot could not build Torque Debug: ${r.errors?.[0]?.message||r.errors?.[0]||'see its OnBot Java page'}`:`${r?.opMode||'Torque Debug'} is on the robot. Start live debug.`,r?.built===false?'error':'');return r?.built!==false;}catch(e){status(e.message,'error');return false;}finally{b.disabled=false;buttons();}}
    q('[data-debug-install]').onclick=()=>{paramsPaint();q('[data-debug-params]').hidden=false;};
    q('[data-debug-params]').addEventListener('click',e=>{if(e.target.closest('[data-debug-cancel]'))q('[data-debug-params]').hidden=true;else if(e.target.closest('[data-debug-go]')){q('[data-debug-params]').hidden=true;checkPaint();void install();}});
    q('[data-debug-params]').addEventListener('change',e=>{const k=e.target.dataset.param;if(!k)return;params=C().sanitize({...params,[k]:k==='over'?e.target.checked:+e.target.value});try{localStorage.setItem(PARAMS,JSON.stringify(params));}catch{}paramsPaint();});
    // Hold-to-run: the slider sends while held and springs back to 0 when let go (pointer up, key up, focus lost).
    let held=null,sentAt=0;
    const holdSend=(el,force)=>{const now=performance.now();if(!force&&now-sentAt<40)return;sentAt=now;void send(`${el.dataset.hold}\t${el.dataset.name}\t${(+el.value).toFixed(3)}`);};
    const release=el=>{if(!el)return;el.value=0;void send(`${el.dataset.hold}\t${el.dataset.name}\t0`);if(held===el)held=null;};
    host.addEventListener('pointerdown',e=>{const el=e.target.closest?.('[data-hold]');if(el)held=el;});
    host.addEventListener('input',e=>{const el=e.target;if(el.dataset.hold){held=el;holdSend(el);}else if(el.dataset.servo){void send(`S\t${el.dataset.servo}\t${(+el.value).toFixed(3)}`);const c=host.querySelector(`[data-enable="${CSS.escape(el.dataset.servo)}"]`);if(c)c.checked=true;}});
    for(const type of ['pointerup','pointercancel'])document.addEventListener(type,()=>{if(held)release(held);});
    host.addEventListener('keyup',e=>{if(e.target.dataset?.hold)release(e.target);});
    host.addEventListener('focusout',e=>{if(e.target.dataset?.hold)release(e.target);});
    host.addEventListener('change',e=>{const el=e.target;if(el.dataset.enable)void send(`E\t${el.dataset.enable}\t${el.checked?1:0}`);else if(el.dataset.latch)void send(`L\t${el.dataset.latch}\t${el.checked?1:0}`);});
    // Holding a slider keeps sending, so a held slider never times out on the robot.
    setInterval(()=>{if(held&&running)holdSend(held,true);},150);
    host.addEventListener('click',e=>{const r=e.target.closest('[data-reset]');if(r){void send(`R\t${r.dataset.reset}`);return;}
      const p=e.target.closest('[data-plot-key]');if(p){const k=p.dataset.plotKey;if(plot.has(k))plot.delete(k);else if(plot.size<5)plot.add(k);p.classList.toggle('plotted',plot.has(k));chart();if(!plot.size)q('[data-debug-legend]').innerHTML='';}});
    // Half a second of quiet, the pulse (M, C: power; S: position), then 0.6 s after: every input that moved beyond three
    // times its noise, with when it first did and by how much. {changes:[{key, delta, at, text}], error}
    let pulsing=false;
    async function pulseWatch(kind,name,power,secs=.5){
      if(!running)return {changes:[],error:'Start live debug first.'};if(pulsing)return {changes:[],error:'A pulse is already running.'};pulsing=true;
      try{secs=Math.min(3,Math.max(.1,secs));pulse={frames:[]};const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(500);const began=frame?.t??0;
        const cmd=kind==='S'?`S\t${name}\t${Math.min(1,Math.max(0,power))}`:`${kind}\t${name}\t${Math.min(1,Math.max(-1,power))}`;const keep=setInterval(()=>void send(cmd),100);void send(cmd);await wait(secs*1000);clearInterval(keep);if(kind!=='S')void send(`${kind}\t${name}\t0`);await wait(600);
        const got=pulse.frames;pulse=null;return summary(got,began,`${kind}:${name}`);}
      finally{pulse=null;pulsing=false;}}
    function summary(list,began,self){
      const before=list.filter(f=>f.t<began),during=list.filter(f=>f.t>=began);if(!before.length||!during.length)return {changes:[],error:'Not enough readings: check the link.'};
      const series=k=>list.map(f=>[f.t,values(f)[k]]).filter(([,x])=>x!==undefined),keys=Object.keys(values(during[0])).filter(k=>!/:(power|cut|on)$/.test(k)&&!(self.startsWith('M:')&&k===`m:${self.slice(2)}:amps`)&&k!==`s:${self.slice(2)}`&&k!==`c:${self.slice(2)}`),changes=[];
      for(const k of keys){const s=series(k),pre=s.filter(([t])=>t<began).map(p=>p[1]),post=s.filter(([t])=>t>=began);if(!pre.length||!post.length)continue;
        const base=pre.reduce((a,b)=>a+b,0)/pre.length,noise=Math.max(...pre.map(x=>Math.abs(x-base)),k.startsWith('m:')&&k.endsWith(':pos')?2:k.startsWith('a:')?.02:k.startsWith('d:')?0:1e-3);
        const hit=post.find(([,x])=>Math.abs(x-base)>noise*3+1e-9);if(!hit)continue;const peak=post.reduce((a,[,x])=>Math.abs(x-base)>Math.abs(a-base)?x:a,base),at=(hit[0]-began)/1000;
        changes.push({key:k,delta:peak-base,at,noise,text:k.startsWith('d:')?`${k.slice(2)} switched ${base?'HIGH → LOW':'LOW → HIGH'} after ${fix(at,2)} s`:`${k.slice(2)} changed by ${fix(peak-base,k.endsWith(':pos')?0:3)} (first after ${fix(at,2)} s)`});}
      return {changes};}
    // Readings over a while (for captures and ramps): the values of every frame in the next ms milliseconds.
    function record(ms){return new Promise(resolve=>{const got=[],off=(listeners.add(fn),()=>listeners.delete(fn));function fn(f,v){got.push({t:f.t/1000,v});}setTimeout(()=>{off();resolve(got);},ms);});}
    return {event,layout,start,install,stop,send,pulse:pulseWatch,record,running:()=>running,latest:()=>({manifest,frame}),values:()=>values(frame),onCamera(fn){cameraListeners.add(fn);return ()=>cameraListeners.delete(fn);},listen(fn){listeners.add(fn);return ()=>listeners.delete(fn);}};
  }
  root.DeckLiveDebug={create,analogMeaning};
})(typeof globalThis==='object'?globalThis:this);
