(function(root){
  'use strict';
  // Calibrate → Debug → Live debug. Torque Debug (src/onbot/TorqueDebug.java) runs on the robot and streams every
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
  // An analog port reading under this has nothing driving it: the empty ports of a real Control Hub read 0 to 0.001 V.
  const ANALOG_EMPTY=.02;
  // What a bus says while Torque Debug is not running, when nothing can be asked.
  const I2C_IDLE='Start live debug to check';
  // What a reading from an I2C device is called. Which ones a device has, the robot says: docs/I2C-DEVICES.md lists them. Distances come in the units their driver works in.
  const I2C_LABELS={yaw:'Yaw °',pitch:'Pitch °',roll:'Roll °',wx:'Turn X °/s',wy:'Turn Y °/s',wz:'Turn Z °/s',gx:'Accel X',gy:'Accel Y',gz:'Accel Z',r:'Red',g:'Green',b:'Blue',a:'Brightness',d:'Distance cm',x:'X',y:'Y',h:'Heading °',ex:'Encoder X',ey:'Encoder Y',vx:'Speed X',vy:'Speed Y',vh:'Turn °/s',ax:'Accel X',ay:'Accel Y',ah:'Accel turn',status:'Status',rate:'Updates a second',dir:'Direction °',angle:'Angle °',strength:'Strength',signal:'Signal',light:'Light',blocks:'Objects seen',arrows:'Arrows seen',id:'First: ID',w:'First: width',t:'First: height',error:'Read failed'};
  const I2C_UNITS={pinpoint:{x:'X mm',y:'Y mm',vx:'Speed X mm/s',vy:'Speed Y mm/s'},otos:{x:'X in',y:'Y in',vx:'Speed X in/s',vy:'Speed Y in/s',ax:'Accel X in/s²',ay:'Accel Y in/s²',ah:'Accel turn °/s²'}};
  const i2cLabel=(kind,key)=>I2C_UNITS[kind]?.[key]||I2C_LABELS[key]||(/^e\d$/.test(key)?`Encoder ${key[1]}`:/^s\d$/.test(key)?`Encoder ${key[1]} speed`:key);
  // Who usually answers at an I2C address, from the FTC SDK's own drivers.
  const I2C_USUAL={0x10:'a Modern Robotics gyro',0x12:'a Modern Robotics compass',0x14:'a Modern Robotics range sensor',0x17:'a SparkFun OTOS',0x1c:'a Modern Robotics IR seeker',0x1e:'a Modern Robotics color sensor',0x23:'a SparkFun LED stick',0x28:'an external IMU',0x29:'a REV 2m or AndyMark TOF distance sensor, or an Adafruit color sensor',0x30:'an OctoQuad',0x31:'a goBILDA Pinpoint',0x32:'a navX or HuskyLens',0x39:'a REV Color Sensor V2 or AndyMark color sensor',0x52:'a REV Color Sensor V3',0x70:'a MaxBotix sonar'};
  // Whether a configured I2C device answered the hub (1, 0, -1 not asked yet, undefined the robot cannot say): [words, pill level].
  const i2cState=on=>on===1?['Connected','ok']:on===0?['Not answering: check its cable','warn']:on===-1?['Checking…','']:['In the configuration',''];
  // What answers on a bus that the configuration does not have. The hub's own IMU sits on its bus 0 whether it is configured or not.
  const strayI2c=(found,known,bus)=>(found||[]).filter(a=>!known.includes(a)&&!(bus===0&&a===0x28));
  const strayI2cWords=list=>list.map(a=>`Something answers at 0x${a.toString(16).padStart(2,'0')}, not in the configuration${I2C_USUAL[a]?`: often ${I2C_USUAL[a]}`:''}.`).join(' ');
  const strayAnalog=(volts,known)=>(volts||[]).map((v,port)=>[port,v]).filter(([port,v])=>!known.includes(port)&&finite(v)&&v>ANALOG_EMPTY);
  const strayAnalogWords=list=>list.map(([port,v])=>`Something on analog port ${port} reads ${fix(v)} V, not in the configuration.`).join(' ');
  // What an analog sensor's volts mean: degrees for angle sensors (an Axon's feedback runs backwards), else none.
  function analogMeaning(md,v,max){if(!md||!finite(v))return '';const span=md.voltage||max||3.3;
    if(md.kind==='axonFeedback')return `${fix((1-v/span)*360,1)}°`;
    if(md.kind==='potentiometer'){/* REV: V = 445.5·(θ−270)/(θ²−270θ−36450), solved for θ (non-linear) */const a=v,b=-270*v-445.5,c=-36450*v+445.5*270;const d=b*b-4*a*c;if(!a||d<0)return '';return `${fix((-b-Math.sqrt(d))/(2*a),1)}° (REV curve)`;}
    if(md.degrees)return `${fix(v/span*md.degrees,1)}°`;return '';}
  function create({host,api,native,project,link,onChange=()=>{}}){
    // flowing: from the robot's first line until it ends, readings are on their way.
    let flowing=false;
    let manifest=null,frame=null,frames=[],running=false,starting=false,plot=new Set(),edges={},seen={},pulse=null,lastPaint=0,paintQueued=false;
    // auto: Calibrate → Camera started this run by itself. Anything but the camera's own settings means someone is working with the outputs, so from then on it is theirs and nothing takes it away.
    let auto=false;
    const send=line=>{if(!native||!running)return Promise.resolve(false);if(auto&&!/^[VDKW]\t/.test(line)){auto=false;void api.robotLink('debug-claim').catch(()=>{});}return api.robotLink('debug-send',{line}).catch(()=>false);};
    const listeners=new Set(),cameraListeners=new Set(),endListeners=new Set();
    host.innerHTML=`<div class="cal-debug-head"><div><h2 id="cal-debug-title">Live debug</h2><p class="hint">Every motor, servo and sensor on the robot, live. Put the robot on blocks first. Anything that spins runs only while you hold its slider, and the robot stops it by itself if Torque goes quiet.</p></div>
      <div class="cal-debug-state"><i class="dot" data-debug-dot></i><span data-debug-status role="status">Not connected</span></div></div>
      <div class="button-row cal-debug-actions"><button type="button" class="secondary" data-debug-install>Put Torque Debug on the robot</button><button type="button" class="primary" data-debug-start>Start live debug</button></div>
      <p class="hint cal-debug-stats" data-debug-stats></p>
      <div class="cal-debug-run" data-check hidden><div class="cal-run-battery" data-port="power:battery"><span>Battery</span><b><span data-live="bat:v">—</span> V</b><meter min="8" max="14" low="11.5" optimum="13" data-live="bat:v:bar"></meter></div><button type="button" class="secondary" data-check-all>Check all, one at a time</button><button type="button" class="cal-debug-stop" data-debug-stopall disabled>STOP<small>or press Space</small></button></div>
      <div data-debug-hubs class="cal-debug-hubs" data-idle></div>
      <div class="cal-debug-tools" data-debug-tools hidden><section><h3 class="cal-group-title">Timeline</h3><p class="hint">Click any reading to plot it; each line is scaled to its own range. Last ${SPAN} s.</p><canvas data-debug-chart height="160"></canvas><div data-debug-legend class="cal-debug-legend"></div></section></div>`;
    const q=s=>host.querySelector(s);
    let said={text:'Not connected',kind:''};
    const status=(text,kind='')=>{said={text,kind};q('[data-debug-status]').textContent=text;q('[data-debug-dot]').className=`dot${kind?' '+kind:''}`;};
    // ---- what each device is checked with, set on its own box and kept by its name
    const C=()=>root.DeckDebugCheck,SETTINGS='torque-debug-devices';
    let settings=(()=>{try{const s=JSON.parse(localStorage.getItem(SETTINGS)||'null');return s&&typeof s==='object'?s:{};}catch{return {};}})();
    const settingsOf=(kind,name)=>C().deviceParams(kind,Object.hasOwn(settings,name)?settings[name]:null);
    function setSetting(kind,name,change){settings={...settings,[name]:C().deviceParams(kind,{...(Object.hasOwn(settings,name)?settings[name]:null),...change})};try{localStorage.setItem(SETTINGS,JSON.stringify(settings));}catch{}}
    const options=(list,now,unit)=>list.map(v=>`<option value="${v}"${v===now?' selected':''}>${v}${unit}</option>`).join('');
    function setHtml(kind,name){const c=C(),p=settingsOf(kind,name),n=esc(name),on=`data-set-kind="${kind}" data-set-name="${n}"`;
      if(kind==='motor'||kind==='crservo')return `<label class="cal-port-set">Check at<select data-set="speed" ${on}>${options(c.speeds(),p.speed,'%')}</select></label>${p.speed>c.SAFE_SPEED?'<p class="cal-debug-warn">Not recommended. Check nothing can hit a hard stop.</p>':''}`;
      if(kind==='servo'){const list=c.servoChoices(p.range),bad=c.problem(p);return `<div class="cal-port-set"><span>Check from</span><select data-set="a" aria-label="${n}: first angle" ${on}>${options(list,p.a,'°')}</select><span>to</span><select data-set="b" aria-label="${n}: second angle" ${on}>${options(list,p.b,'°')}</select></div>${bad?`<p class="cal-debug-bad" role="alert">${esc(bad)}</p>`:''}`;}
      return '';}
    const checkHtml=(kind,name)=>`<div class="cal-port-check" data-check-row="${esc(name)}" data-state="idle"><div data-set-box="${esc(name)}">${setHtml(kind,name)}</div><p class="cal-check-text" role="status" data-check-text></p><div class="cal-port-go" data-check-act></div></div>`;
    // ---- the device check: every device the op mode found, one at a time, each saying how it went on its own box
    const checks=new Map();let checkRun=null;
    const devices=()=>{const m=manifest;if(!m)return [];return [...(m.motors||[]).map(name=>({kind:'motor',name})),...(m.crservos||[]).map(name=>({kind:'crservo',name})),...(m.servos||[]).map(name=>({kind:'servo',name})),...(m.digital||[]).map(name=>({kind:'digital',name})),...(m.touch||[]).map(name=>({kind:'touch',name})),...(m.analog||[]).map(a=>({kind:'analog',name:a.n}))];};
    function checkPaint(){const list=devices();q('[data-check]').hidden=!manifest;q('[data-check-all]').disabled=!running||!!checkRun;
      for(const d of list){const row=host.querySelector(`[data-check-row="${CSS.escape(d.name)}"]`);if(!row)continue;const c=checks.get(d.name)||{state:'idle',text:''},act=row.querySelector('[data-check-act]'),bad=d.kind==='servo'&&C().problem(settingsOf('servo',d.name));row.dataset.state=c.state;row.closest('.cal-port').dataset.checkState=c.state;row.querySelector('[data-check-text]').textContent=c.text;
        const html=c.state==='ask'?'<button type="button" class="primary" data-check-answer="yes">Yes</button><button type="button" class="secondary" data-check-answer="no">No</button>':`<button type="button" class="secondary" data-check-one="${esc(d.name)}"${!running||checkRun||bad?' disabled':''}>Check</button>`;if(act.dataset.drawn!==html){act.dataset.drawn=html;act.innerHTML=html;}}}
    const checkSet=(name,state,text)=>{checks.set(name,{state,text});checkPaint();};
    const stopped=()=>!checkRun||checkRun.stop;
    const pause=async ms=>{for(const end=performance.now()+ms;performance.now()<end&&!stopped();)await new Promise(r=>setTimeout(r,Math.min(50,ms)));};
    async function holdOut(cmd,name,power,ms){const line=`${cmd}\t${name}\t${power.toFixed(3)}`;void send(line);const keep=setInterval(()=>void send(line),100);try{await pause(ms);}finally{clearInterval(keep);void send(`${cmd}\t${name}\t0`);}}
    const checkAsk=(name,question)=>new Promise(done=>{checkRun.answer=done;checkSet(name,'ask',question);});
    // An input's check: follows its readings until it is done, or 30 s pass with nothing done.
    const checkWatch=(name,key,start,step,prompt,finished)=>new Promise(done=>{let s=start;checkSet(name,'running',prompt(s));const began=performance.now();
      const finish=ok=>{off();clearInterval(t);done(ok);},off=listeners.add.call(listeners,fn)&&(()=>listeners.delete(fn)),t=setInterval(()=>{if(stopped())finish(null);else if(performance.now()-began>30000)finish(false);},100);
      function fn(_f,v){const next=step(s,v[key],performance.now());if(next===s)return;const was=prompt(s);s=next;if(prompt(s)!==was)checkSet(name,'running',prompt(s));if(finished(s))finish(true);}});
    async function checkOne({kind,name}){const c=C(),p=settingsOf(kind,name),speed=p.speed/100,v=()=>values();
      if(kind==='motor'){const key=`m:${name}:pos`,before=v()[key];checkSet(name,'running',`Running forward at ${p.speed}%…`);await holdOut('M',name,speed,1000);if(stopped())return;const moved=Math.abs((v()[key]??0)-(before??0)),cut=v()[`m:${name}:cut`];await pause(300);checkSet(name,'running',`Running backward at ${p.speed}%…`);await holdOut('M',name,-speed,1000);if(stopped())return;
        if(cut)return checkSet(name,'fail','It drew too much current and was cut. Check nothing is jammed.');if(moved>=5)return checkSet(name,'pass',`It works: the encoder counted ${Math.round(moved)} ticks.`);
        const a=await checkAsk(name,'The encoder did not count. Did the motor turn?');if(a===null)return;return checkSet(name,a?'pass':'fail',a?'It turned, but no encoder is counting: check the encoder cable.':'It did not turn. Check its power cable and the port in Configure.');}
      if(kind==='crservo'){checkSet(name,'running','Turning one way…');await holdOut('C',name,speed,1000);if(stopped())return;await pause(300);checkSet(name,'running','Turning the other way…');await holdOut('C',name,-speed,1000);if(stopped())return;
        const a=await checkAsk(name,'Did it turn one way, then the other?');if(a===null)return;return checkSet(name,a?'pass':'fail',a?'It works.':'It did not turn. Check its cable and the port in Configure.');}
      if(kind==='servo'){for(const [i,angle] of [p.a,p.b,p.a,p.b].entries()){if(stopped())break;checkSet(name,'running',`Moving to ${angle}° (${i+1} of 4)…`);void send(`S\t${name}\t${c.position(angle,p.range).toFixed(3)}`);await pause(1000);}void send(`E\t${name}\t0`);if(stopped())return;
        const a=await checkAsk(name,`Did it move between ${p.a}° and ${p.b}°?`);if(a===null)return;return checkSet(name,a?'pass':'fail',a?'It works.':'It did not move. Check its cable, its power and the port in Configure.');}
      if(kind==='digital'||kind==='touch'){const key=`d:${name}`,now=v()[key];if(now===undefined)return checkSet(name,'fail','No reading: it is not connected, or not in the configuration.');const md=rows().find(r=>r.name===name),low=kind==='touch'||H().SENSOR_MODELS[md?.model]?.activeLow;
        const ok=await checkWatch(name,key,c.digitalStart(now,!!low&&!now),(s,x)=>c.digitalStep(s,x),c.digitalPrompt,s=>s.done);if(ok===null)return;return checkSet(name,ok?'pass':'fail',ok?c.digitalPrompt({done:true}):'It did not change. Check its cable and the port in Configure.');}
      if(kind==='analog'){let last=null;const ok=await checkWatch(name,`a:${name}`,c.analogStart(),(s,x,t)=>{last=c.analogStep(s,x,t);return last;},c.analogPrompt,s=>s.stage==='done');if(ok===null)return;return checkSet(name,ok?'pass':'fail',ok?c.analogPrompt(last):'It did not change and settle. Check its cable and the port in Configure.');}
    }
    async function checkList(list){if(checkRun||!running)return;checkRun={stop:false};for(const d of list)if(!checks.has(d.name)||list.length===1||checks.get(d.name).state!=='pass')checks.delete(d.name);checkPaint();
      try{for(const d of list){if(stopped())break;await checkOne(d);}}finally{checkRun=null;checkPaint();}}
    function checkStop(){if(!checkRun)return;checkRun.stop=true;checkRun.answer?.(null);for(const [name,c] of checks)if(c.state==='running'||c.state==='ask')checks.set(name,{state:'idle',text:'Stopped'});void send('X');checkPaint();}
    q('[data-check-all]').onclick=()=>void checkList(devices());
    q('[data-debug-hubs]').addEventListener('click',e=>{const a=e.target.closest('[data-check-answer]');if(a){const done=checkRun?.answer;if(checkRun)checkRun.answer=null;done?.(a.dataset.checkAnswer==='yes');return;}const b=e.target.closest('[data-check-one]');if(b){const d=devices().find(x=>x.name===b.dataset.checkOne);if(d)void checkList([d]);}});
    // ---- layout: the wiring's ports, with the robot's devices on them
    function rows(){try{return W().state(project()).rows;}catch{return [];}}
    function layout(){
      const D=H(),m=manifest;if(!m){q('[data-debug-hubs]').innerHTML=native?'':'<p class="hint">Live debug needs the installed app and a robot.</p>';q('[data-debug-tools]').hidden=true;return;}
      const live={motor:m.motors||[],servo:m.servos||[],crservo:m.crservos||[],digital:[...(m.digital||[]),...(m.touch||[])],analog:(m.analog||[]).map(a=>a.n),light:(m.lights||[]).map(l=>l.n),i2c:(m.i2c||[]).map(d=>d.n)};
      const wiring=W().state(project()).wiring,read=project().calibration?.hub?.readout||[],byName=new Map(rows().filter(r=>r.name).map(r=>[r.name,r])),used=new Set();
      const types=root.DeckRobotConfig?.DEVICE_TYPES||{},typeName=tag=>Object.values(types).flat().find(([t])=>t===tag)?.[1]||'',tagOf=new Map(read.map(d=>[d.name,d.tag]));
      const familyOf=d=>d.bus!==undefined?'i2c':d.kind==='motor'?'motor':['servo','crservo'].includes(d.kind)||d.tag==='RevBlinkinLedDriver'?'servo':d.kind==='analog'?'analog':['digital','touch'].includes(d.kind)||d.tag==='Led'?'digital':null;
      // A box: its port and name, then what fits the device. Anything that spins has a slider, a positional servo a dial that turns, a light a switch, and a sensor what it reads. Each is checked and set up from its own box.
      const WORDS={motor:'Motor',servo:'Servo',crservo:'Continuous servo',digital:'Digital device',analog:'Analog input',light:'Light'};
      const stat=(label,key,extra='')=>`<div><dt>${label}</dt><dd data-live="${esc(key)}"${extra?'':` data-plot-key="${esc(key)}"`}>—</dd></div>`;
      const spin=(cmd,n)=>`<div class="cal-spin"><input type="range" min="-1" max="1" step="0.01" value="0" data-hold="${cmd}" data-name="${n}" aria-label="Hold to run ${n}: left is reverse, right is forward"><div class="cal-spin-scale"><span>Reverse</span><output data-live="sp:${n}:${cmd}">0%</output><span>Forward</span></div></div>`;
      const tile=(fam,name,port)=>{const row=byName.get(name)||null,n=esc(name),id=`${fam}:${name}`;used.add(id);
        const head=`<div class="cal-port-head">${port===''?'':`<span class="cal-port-num">${esc(port)}</span>`}<span class="cal-port-who"><b>${n}</b><small>${esc(typeName(tagOf.get(name))||WORDS[fam])}</small></span></div>`,box=(html,check=fam)=>`<div class="cal-port" data-port="${esc(id)}" data-check-state="idle">${head}${html}${check?checkHtml(check,name):''}</div>`;
        if(fam==='motor')return box(`${spin('M',n)}<dl class="cal-stats">${stat('Ticks',`m:${name}:pos`)}${stat('Ticks/s',`m:${name}:vel`)}${stat('RPM',`m:${name}:rpm`,1)}${stat('Amps',`m:${name}:amps`)}</dl><span class="cal-port-flag" data-live="m:${n}:cut"></span><button type="button" class="text-button cal-port-zero" data-reset="${n}">Zero encoder</button>`);
        if(fam==='crservo')return box(`${spin('C',n)}<dl class="cal-stats">${stat('Power',`c:${name}`)}</dl>`);
        if(fam==='servo'){const p=settingsOf('servo',name);return box(`${dialHtml(name,p)}<div class="cal-port-set cal-port-goto"><label>Go to<input type="number" min="0" max="${p.range}" step="1" data-slider="off" data-servo-deg="${n}" aria-label="${n}: go to this angle"></label><label>Range<select data-set="range" data-set-kind="servo" data-set-name="${n}">${options(C().SERVO_RANGES,p.range,'°')}</select></label></div><label class="check"><input type="checkbox" data-enable="${n}"> Holding</label><label class="check"><input type="checkbox" data-latch="${n}"> Keep holding if Torque goes quiet</label>`);}
        if(fam==='light')return box(`<button type="button" class="cal-switch" role="switch" aria-checked="false" aria-label="${n}" data-light="${n}" data-live="l:${n}"><span class="cal-switch-track"><i></i></span><span data-switch-word>Off</span></button>`,null);
        if(fam==='digital'){const md=row&&D.SENSOR_MODELS[row.model];return box(`<div class="cal-lamp" data-live="d:${n}" data-plot-key="d:${n}" data-active-low="${md?.activeLow||(m.touch||[]).includes(name)?1:0}">—</div><small data-live="d:${n}:edges"></small>`);}
        return box(`<span class="rs-pill warn" data-live="a:${n}:plug" hidden></span><meter min="0" max="${esc(m.analog.find(a=>a.n===name)?.max||3.3)}" data-live="a:${n}:bar"></meter><dl class="cal-stats">${stat('Volts',`a:${name}`)}${stat('Range seen',`a:${name}:seen`,1)}<div><dt>Full range</dt><dd>0–${fix(m.analog.find(a=>a.n===name)?.max||3.3)} V</dd></div>${row&&D.SENSOR_MODELS[row.model]?stat('Means',`a:${name}:means`,1):''}</dl>`);};
      // I2C devices set themselves up, so each bus only says whether what is configured on it answers the hub, and what else does.
      const onBus=(name,label)=>{const seen=(m.i2c||[]).find(x=>x.n===name);return `<div class="cal-bus-device"><span class="cal-port-who"><b>${esc(name)}</b>${label?`<small>${esc(label)}</small>`:''}</span>${seen?`<span class="rs-pill" data-live="ib:${esc(name)}">${flowing?'Checking…':I2C_IDLE}</span><dl class="cal-stats" data-live="il:${esc(name)}" hidden></dl>${live.light.includes(name)?`<button type="button" class="cal-switch" role="switch" aria-checked="false" aria-label="${esc(name)}" data-light="${esc(name)}" data-live="l:${esc(name)}"><span class="cal-switch-track"><i></i></span><span data-switch-word>Off</span></button>`:''}`:'<span class="rs-pill">In the configuration</span>'}</div>`;};
      const hubAt=hub=>hub==='control'?173:wiring.hubs[hub]?.address,buses=(hub,on)=>{if(D.hubSpec(hub)?.i2c===0)return '';const row=b=>{const here=on.filter(d=>d.bus===b);return `<div class="cal-port cal-bus" data-bus="${esc(hub)}:${b}"><div class="cal-port-head"><span class="cal-port-num">${b}</span><span class="cal-port-who"><b>Bus ${b}</b>${here.length?'':'<small>Nothing configured</small>'}</span></div>${here.map(d=>{used.add(`i2c:${d.name}`);return onBus(d.name,typeName(d.tag));}).join('')}<span class="rs-pill warn" data-live="ix:${hubAt(hub)}:${b}" hidden></span></div>`;};return `<div class="cal-port-group"><h4>I2C buses</h4><div class="cal-buses">${[0,1,2,3].map(row).join('')}</div></div>`;};
      const order=D.hubIds(wiring),hubs=[...new Set(['control',...read.filter(d=>d.hub).map(d=>d.hub)])].sort((x,y)=>(order.indexOf(x)+1||99)-(order.indexOf(y)+1||99));
      const cards=read.length?hubs.map(hub=>{const on=read.filter(d=>d.hub===hub),html=[['motor','Motors'],['servo','Servo ports'],['digital','Digital'],['analog','Analog']].map(([fam,title])=>{const cells=on.filter(d=>familyOf(d)===fam).sort((x,y)=>x.port-y.port).map(d=>{const f=live.light.includes(d.name)?'light':fam==='servo'&&live.crservo.includes(d.name)?'crservo':fam;return live[f]?.includes(d.name)?tile(f,d.name,d.port):`<div class="cal-port missing"><div class="cal-port-head"><b>${title.replace(/s$/,'')} ${d.port}</b><code>${esc(d.name)}</code></div><small>In the robot’s configuration, but Torque Debug is not reading it. Check its cable, then restart live debug.</small></div>`;});return cells.length?`<div class="cal-port-group"><h4>${title}</h4><div class="cal-ports">${cells.join('')}</div></div>`:'';}).join('')+`<p class="cal-stray"><span class="rs-pill warn" data-live="ax:${hubAt(hub)}" data-ports="${on.filter(d=>familyOf(d)==='analog').map(d=>d.port).join(',')}" hidden></span></p>`+buses(hub,on.filter(d=>d.bus!==undefined));
        return `<section class="cal-hub"><h3>${esc(D.hubName(hub,wiring))}</h3>${html}</section>`;}):[];
      // What the robot reports that the read configuration did not list: read it again in Setup to place it on its port.
      const other=[...live.motor.map(n=>['motor',n]),...live.servo.map(n=>['servo',n]),...live.crservo.map(n=>['crservo',n]),...live.analog.map(n=>['analog',n]),...live.digital.map(n=>['digital',n]),...live.light.map(n=>['light',n])].filter(([f,n])=>!used.has(`${f}:${n}`));
      const otherI2c=(m.i2c||[]).filter(d=>!used.has(`i2c:${d.n}`));
      if(other.length||otherI2c.length)cards.push(`<section class="cal-hub"><h3>On the robot</h3>${other.length?`<div class="cal-ports">${other.map(([f,n])=>tile(f,n,'')).join('')}</div>`:''}${otherI2c.length?`<div class="cal-port-group"><h4>I2C</h4><div class="cal-buses">${otherI2c.map(d=>`<div class="cal-port cal-bus"><div class="cal-port-head"><span class="cal-port-who"><b>${d.b===undefined?'I2C':`Bus ${d.b}`}</b></span></div>${onBus(d.n,'')}</div>`).join('')}</div></div>`:''}</section>`);
      q('[data-debug-hubs]').innerHTML=`<p class="hint">Everything here comes from the robot’s active configuration. I2C devices and analog ports show whether anything is really there. Motors, servos and digital ports can’t tell: a motor with nothing plugged in just won’t move.</p>${cards.join('')}`;
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
    // Nothing is drawn while this panel is hidden, and readings can come 50 times a second. What it missed is drawn as it shows again (below), from what event kept.
    let paintMissed=false;
    if(typeof ResizeObserver==='function')new ResizeObserver(()=>{if(paintMissed&&host.offsetParent)paint(true);}).observe(host);
    // Nothing is running, so nothing here is being asked: the buses say so, and what could only come from the robot goes away.
    function idlePaint(){const box=q('[data-debug-hubs]');box.toggleAttribute('data-idle',true);for(const el of box.querySelectorAll('[data-live^="ib:"]')){el.textContent=I2C_IDLE;el.className='rs-pill';}for(const el of box.querySelectorAll('[data-live^="ix:"],[data-live^="ax:"],[data-live^="il:"],[data-live$=":plug"]'))el.hidden=true;const v=q('[data-live="bat:v"]'),bar=q('[data-live="bat:v:bar"]');v.textContent='—';bar.value=8;}
    function paint(force){
      if(!host.offsetParent){paintMissed=true;return;}paintMissed=false;
      if(!flowing)return idlePaint();
      const now=performance.now();if(!force&&now-lastPaint<66){if(!paintQueued){paintQueued=true;requestAnimationFrame(()=>{paintQueued=false;paint(true);});}return;}lastPaint=now;
      q('[data-debug-hubs]').toggleAttribute('data-idle',false);
      const f=frame,m=manifest;if(!f||!m)return;const D=H(),byName=new Map(rows().map(r=>[r.name,r])),v=values(f);
      q('[data-debug-stats]').textContent=`Loop ${fix(f.loop,1)} ms · battery ${fix(f.v,2)} V · robot clock ${fix(f.t/1000,1)} s${f.q?` · step test on ${f.q.actuator}: target ${fix(f.q.target,1)}, error ${fix(f.q.error,1)}, power ${fix(f.q.out,2)}`:''}`;
      for(const el of host.querySelectorAll('[data-live]')){const key=el.dataset.live,[kind,name,field]=key.split(':');
        if(kind==='m'){const row=byName.get(name),cpr=D.MODELS[row?.model]?.cpr;
          if(field==='rpm')el.textContent=cpr&&finite(v[`m:${name}:vel`])?fix(v[`m:${name}:vel`]/cpr*60,0):'—';else if(field==='cut')el.textContent=v[`m:${name}:cut`]?'Cut: drew too much current. Move its slider to run it again.':'';
          else el.textContent=field==='pos'?(v[key]??'—'):fix(v[key],field==='amps'?2:0);}
        else if(kind==='s'||kind==='c')el.textContent=fix(v[key],3);
        else if(kind==='sp'){const power=field==='M'?v[`m:${name}:power`]:v[`c:${name}`],slider=el.closest('.cal-spin').querySelector('input');if(slider!==held&&finite(power)&&performance.now()-releasedAt>300)slider.value=power;spinFill(slider);el.textContent=`${Math.round(+slider.value*100)}%`;}
        else if(kind==='sd'){if(el!==dialing&&finite(v[`s:${name}`]))dialSet(el,v[`s:${name}`]*+el.dataset.range);}
        else if(kind==='l'){const on=!!f.l?.[m.lights.findIndex(x=>x.n===name)];el.setAttribute('aria-checked',String(on));el.querySelector('[data-switch-word]').textContent=on?'On':'Off';}
        else if(kind==='iv'){const x=f.i?.[m.i2c.findIndex(d=>d.n===name)]?.v?.[field];el.textContent=typeof x==='number'?fix(x,2):x===undefined||x===null?'—':typeof x==='boolean'?(x?'Yes':'No'):String(x);}
        else if(kind==='il'){const i=m.i2c.findIndex(d=>d.n===name),r=f.i?.[i]?.v,keys=r&&f.on?.[i]!==0&&f.on?.[i]!==-1?Object.keys(r):[],sig=keys.join();el.hidden=!keys.length;if(el.dataset.keys!==sig){el.dataset.keys=sig;el.innerHTML=keys.map(x=>`<div><dt>${esc(i2cLabel(m.i2c[i]?.k,x))}</dt><dd data-live="iv:${esc(name)}:${esc(x)}"${typeof r[x]==='number'?` data-plot-key="i:${esc(name)}:${esc(x)}"`:''}>—</dd></div>`).join('');for(const k of plot)el.querySelector(`[data-plot-key="${CSS.escape(k)}"]`)?.classList.add('plotted');}}
        else if(kind==='bat'){const [,,,bar]=key.split(':');if(bar)el.value=finite(f.v)?f.v:0;else el.textContent=fix(f.v,2);}
        else if(kind==='d'){if(field==='edges'){el.textContent=edges[name]?`${edges[name]} changes`:'';continue;}const raw=v[`d:${name}`],low=el.dataset.activeLow==='1';el.textContent=raw===undefined?'—':`${raw?'HIGH':'LOW'} · ${low?(raw?'released':'pressed'):(raw?'on':'off')}`;el.dataset.on=raw===undefined?'':String(low?!raw:!!raw);}
        else if(kind==='a'){const val=v[`a:${name}`],row=byName.get(name),md=row&&D.SENSOR_MODELS[row.model];
          if(field==='plug'){const i=m.analog.findIndex(a=>a.n===name),recent=frames.slice(-100).map(x=>x.a?.[i]),low=recent.length>=25&&recent.every(x=>finite(x)&&x<=ANALOG_EMPTY);el.textContent='Reads 0 V: probably not plugged in';el.hidden=!low;}
          else if(field==='bar')el.value=finite(val)?val:0;else if(field==='means')el.textContent=analogMeaning(md,val,m.analog.find(a=>a.n===name)?.max)||'—';else if(field==='seen')el.textContent=seen[name]?`${fix(seen[name][0])}–${fix(seen[name][1])} V`:'—';else el.textContent=fix(val,3);}
        else if(kind==='ib'){const [words,level]=i2cState(f.on?.[m.i2c.findIndex(d=>d.n===name)]);el.textContent=words;el.className=`rs-pill ${level}`;}
        else if(kind==='ix'){const bus=+field,stray=strayI2c(f.b?.find(x=>x.h===+name)?.found?.[bus],m.i2c.filter(d=>d.h===+name&&d.b===bus).map(d=>d.a),bus);el.textContent=strayI2cWords(stray);el.hidden=!stray.length;}
        else if(kind==='ax'){const stray=strayAnalog(f.b?.find(x=>x.h===+name)?.a,el.dataset.ports.split(',').filter(Boolean).map(Number));el.textContent=strayAnalogWords(stray);el.hidden=!stray.length;}}
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
      if(e.manifest){manifest=e.manifest;frame=null;flowing=true;frames=[];edges={};seen={};checks.clear();status('Live: reading the robot','live');layout();checkPaint();onChange();return;}
      if(e.frame){const prev=values(frame);frame=e.frame;frames.push(frame);const cut=frame.t-(SPAN+2)*1000;while(frames.length&&frames[0].t<cut)frames.shift();
        const v=values(frame);for(const [k,x] of Object.entries(v)){if(k.startsWith('d:')&&prev[k]!==undefined&&prev[k]!==x)edges[k.slice(2)]=(edges[k.slice(2)]||0)+1;if(k.startsWith('a:')&&finite(x)){const n=k.slice(2),s=seen[n]||[x,x];seen[n]=[Math.min(s[0],x),Math.max(s[1],x)];}}
        if(pulse)pulse.frames.push(frame);for(const fn of listeners)fn(frame,v);paint(false);return;}
      if(e.ended||e.error){checkStop();flowing=false;paint(true);running=false;starting=false;auto=false;status(e.error?e.error:{stopped:'Stopped',ended:'Torque Debug stopped on the robot',lost:'Lost the robot connection',time:'Stopped after an hour'}[e.ended]||'Stopped',e.error?'error':'');buttons();checkPaint();onChange();for(const fn of endListeners)fn(e);}}
    if(native&&api.onRobotDebug)api.onRobotDebug(event);
    function buttons(){q('[data-debug-start]').textContent=running||starting?'Stop live debug':'Start live debug';q('[data-debug-stopall]').disabled=!running;q('[data-debug-install]').disabled=running||starting;}
    // The Control Hub left the cable: what was on its way to it will only fail, in words about ports and sockets, so that is not shown.
    let unplugs=0,installing=false;function unplugged(){unplugs++;flowing=false;paint(true);if(!starting&&!installing)return;starting=false;status('Lost the robot connection','');buttons();checkPaint();onChange();}
    async function start(){
      if(!native)return status('Live debug needs the installed app.','error');if(running||starting)return stop();
      const {host:to,label}=link(),was=unplugs;starting=true;buttons();status(`Starting Torque Debug on ${label}…`);
      try{await api.robotLink('debug-start',{host:to});if(was===unplugs)running=true;}catch(e){if(was===unplugs)status(e.message,'error');}finally{starting=false;buttons();checkPaint();onChange();}}
    async function stop(){checkStop();zeroHolds();await api.robotLink('debug-stop').catch(()=>{});flowing=false;paint(true);running=false;auto=false;buttons();checkPaint();onChange();}
    // Calibrate → Camera's way in, with nobody pressing anything: the robot's copy is asked about first and built only if it is not this one, so it builds once and not on every visit. The same install and the same start as the buttons here.
    // noStart: nobody pressed anything, so the Robot Controller app is not started. build: build whatever the robot's copy says. mayBuild: whether a build may happen on this try at all. still: whether it is still wanted, before a build and again once it is done.
    // Answers {started}, {built:false, problem}, {cantBuild}, {error}, or {left}.
    async function run({host:to=link().host,noStart=false,build=false,mayBuild=true,still=()=>true}={}){
      if(!native)return {error:'This needs the installed app.'};if(running||starting||installing)return {left:true};
      const was=unplugs,extra=noStart?{noStart:true}:{};let built=false;manifest=null;frame=null;starting=true;buttons();status('Getting ready…');
      try{const copy=build?{current:false}:await api.robotLink('debug-current',{host:to,...extra});if(was!==unplugs)return {left:true};let opMode=copy?.opMode;
        if(!still()){status('Not connected');return {left:true};}
        if(!copy?.current){if(!mayBuild){status('Not connected');return {cantBuild:true};}
          starting=false;const ok=await install(to,{auto:true,...extra});if(was!==unplugs)return {left:true};if(!ok)return {built:false,...lastBuild};opMode=lastBuild.opMode;built=true;starting=true;buttons();}
        if(!still()){status('Not connected');return {left:true,built};}
        await api.robotLink('debug-start',{host:to,auto:true,opMode,...extra});if(was!==unplugs)return {left:true};running=true;auto=true;return {started:true,built};}
      catch(e){if(was===unplugs)status(e.message,'error');return was===unplugs?{error:e.message}:{left:true};}
      finally{starting=false;buttons();checkPaint();onChange();}}
    // Over the cable this tab starts it by itself, the way Camera does, until someone stops it here. Leaving the tab forgets that.
    let heldOff=false;
    // warm: for a while after a Save it starts with no one looking, so it is already going when they get there.
    let warmUntil=0;
    const wanted=()=>{if(root.deckHoldAuto)return false;if(heldOff&&!host.offsetParent)heldOff=false;if(Date.now()<warmUntil&&!heldOff)return true;return !!host.offsetParent&&!heldOff;};
    // Puts this version on the robot ahead of time if it has another, and only that: nothing starts. Once for a hub.
    let preparedFor=null;
    async function prepare(to,serial){if(!native||root.deckHoldAuto||preparedFor===serial||running||starting||installing)return;preparedFor=serial;try{const copy=await api.robotLink('debug-current',{host:to,noStart:true});if(!copy?.current&&!running&&!starting&&!installing)await install(to,{auto:true,noStart:true}).catch(()=>{});}catch{}}
    q('[data-debug-start]').onclick=()=>{heldOff=running||starting;void start();};
    // STOP: everything off, whatever is going on. Space does the same anywhere on this tab, as it stops an op mode on a Driver Station.
    function zeroHolds(){releasedAt=performance.now();for(const s of host.querySelectorAll('[data-hold]')){s.value=0;spinFill(s);}held=null;}
    function stopAll(){const told=!!checkRun;checkStop();zeroHolds();for(const c of host.querySelectorAll('[data-enable]'))c.checked=false;if(!told)void send('X');}
    q('[data-debug-stopall]').onclick=stopAll;
    document.addEventListener('keydown',e=>{if(e.code!=='Space'||e.repeat||!running||!host.offsetParent||e.target?.matches?.('textarea,[contenteditable],input:not([type]),input[type=text]'))return;e.preventDefault();e.stopPropagation();stopAll();},true);
    // lastBuild: what the last install answered, for run: {opMode} or {problem}. An error on the way, such as the crash guard's, is thrown again for run to say.
    let lastBuild=null;
    async function install(host,extra={}){const {host:picked,label}=link(),to=host||picked,b=q('[data-debug-install]'),was=unplugs;b.disabled=true;installing=true;lastBuild=null;status(`Putting Torque Debug on ${label} and building…`);
      try{const r=await api.robotLink('debug-install',{host:to,...extra});if(was!==unplugs)return false;lastBuild=r?.built===false?{problem:r.problem||'The robot could not build. Open its OnBot Java page to see why.'}:{opMode:r?.opMode};status(lastBuild.problem||`${r?.opMode||'Torque Debug'} is on the robot. Start live debug.`,lastBuild.problem?'error':'');return !lastBuild.problem;}catch(e){if(was===unplugs){status(e.message,'error');if(host)throw e;}return false;}finally{installing=false;b.disabled=false;buttons();}}
    q('[data-debug-install]').onclick=()=>void install();
    // Hold-to-run: the slider sends while held and springs back to 0 when let go (pointer up, key up, focus lost). Its bar grows from the middle, the way it turns.
    let held=null,sentAt=0;
    const spinFill=s=>{const x=(+s.value+1)/2*100;s.style.setProperty('--a',`${Math.min(x,50)}%`);s.style.setProperty('--b',`${Math.max(x,50)}%`);};
    const holdSend=(el,force)=>{const now=performance.now();if(!force&&now-sentAt<40)return;sentAt=now;void send(`${el.dataset.hold}\t${el.dataset.name}\t${(+el.value).toFixed(3)}`);};
    let releasedAt=0;
    const release=el=>{if(!el)return;releasedAt=performance.now();el.value=0;spinFill(el);void send(`${el.dataset.hold}\t${el.dataset.name}\t0`);if(held===el)held=null;};
    // A positional servo's dial turns the way the servo does: its arc is the servo's real travel, 0° at the start, and the knob follows what the servo was last told.
    const dialPoint=deg=>{const a=(deg-90)*Math.PI/180;return `${(60+46*Math.cos(a)).toFixed(2)} ${(60+46*Math.sin(a)).toFixed(2)}`;};
    function dialHtml(name,p){const half=p.range/2,arc=`M${dialPoint(-half)} A46 46 0 ${half>90?1:0} 1 ${dialPoint(half)}`,n=esc(name);return `<div class="cal-dial" role="slider" tabindex="0" data-dial="${n}" data-range="${p.range}" data-live="sd:${n}" data-unset aria-label="${n}: turn to set its angle" aria-valuemin="0" aria-valuemax="${p.range}" aria-valuenow="0"><svg viewBox="0 0 120 120" aria-hidden="true"><path class="cal-dial-track" d="${arc}"/><path class="cal-dial-fill" d="${arc}" pathLength="100" stroke-dasharray="0 100"/><g class="cal-dial-knob" transform="rotate(0 60 60)"><line x1="60" y1="26" x2="60" y2="14"/><circle cx="60" cy="14" r="7"/></g></svg><output class="cal-dial-value">—</output></div>`;}
    function dialSet(el,deg){const range=+el.dataset.range,d=Math.max(0,Math.min(range,deg));el.removeAttribute('data-unset');el.setAttribute('aria-valuenow',String(Math.round(d)));el.querySelector('.cal-dial-knob').setAttribute('transform',`rotate(${(d-range/2).toFixed(1)} 60 60)`);el.querySelector('.cal-dial-fill').setAttribute('stroke-dasharray',`${(d/range*100).toFixed(2)} 100`);el.querySelector('output').textContent=`${Math.round(d)}°`;}
    const dialAngle=(el,e)=>{const r=el.getBoundingClientRect(),range=+el.dataset.range,half=range/2,a=Math.atan2(e.clientX-(r.left+r.width/2),-(e.clientY-(r.top+r.height/2)))*180/Math.PI;return Math.max(-half,Math.min(half,a))+half;};
    function servoTo(name,deg,range,force){const now=performance.now();if(!force&&now-sentAt<40)return;sentAt=now;void send(`S\t${name}\t${C().position(deg,range).toFixed(3)}`);const c=host.querySelector(`[data-enable="${CSS.escape(name)}"]`);if(c)c.checked=true;}
    let dialing=null;
    const dialTurn=(el,deg,force)=>{dialSet(el,deg);servoTo(el.dataset.dial,+el.getAttribute('aria-valuenow'),+el.dataset.range,force);};
    host.addEventListener('pointerdown',e=>{const el=e.target.closest?.('[data-dial]');if(!el||!running)return;dialing=el;el.setPointerCapture?.(e.pointerId);dialTurn(el,dialAngle(el,e),true);});
    host.addEventListener('pointermove',e=>{if(!dialing)return;const deg=dialAngle(dialing,e),now=+dialing.getAttribute('aria-valuenow'),range=+dialing.dataset.range;if(Math.abs(deg-now)>range/2)return;dialTurn(dialing,deg);});// across the gap at the bottom it would jump end to end
    for(const type of ['pointerup','pointercancel'])document.addEventListener(type,()=>{if(!dialing)return;const el=dialing;dialing=null;servoTo(el.dataset.dial,+el.getAttribute('aria-valuenow'),+el.dataset.range,true);});
    host.addEventListener('keydown',e=>{const el=e.target.closest?.('[data-dial]');if(!el||!running)return;const step={ArrowRight:1,ArrowUp:1,ArrowLeft:-1,ArrowDown:-1,PageUp:10,PageDown:-10}[e.key],now=+el.getAttribute('aria-valuenow'),to=e.key==='Home'?0:e.key==='End'?+el.dataset.range:step?now+step:null;if(to===null)return;e.preventDefault();dialTurn(el,to,true);});
    host.addEventListener('pointerdown',e=>{const el=e.target.closest?.('[data-hold]');if(el)held=el;});
    host.addEventListener('input',e=>{const el=e.target;if(el.dataset.hold){held=el;spinFill(el);holdSend(el);}});
    for(const type of ['pointerup','pointercancel'])document.addEventListener(type,()=>{if(held)release(held);});
    host.addEventListener('keyup',e=>{if(e.target.dataset?.hold)release(e.target);});
    host.addEventListener('focusout',e=>{if(e.target.dataset?.hold)release(e.target);});
    host.addEventListener('change',e=>{const el=e.target,d=el.dataset;if(d.enable)void send(`E\t${d.enable}\t${el.checked?1:0}`);else if(d.latch)void send(`L\t${d.latch}\t${el.checked?1:0}`);
      else if(d.servoDeg!==undefined){const dial=host.querySelector(`[data-dial="${CSS.escape(d.servoDeg)}"]`);if(dial&&el.value!==''&&running)dialTurn(dial,+el.value,true);}
      else if(d.set){const name=d.setName;setSetting(d.setKind,name,{[d.set]:+el.value});const p=settingsOf(d.setKind,name);if(d.set==='range'){const dial=host.querySelector(`[data-dial="${CSS.escape(name)}"]`),go=host.querySelector(`[data-servo-deg="${CSS.escape(name)}"]`);if(dial)dial.outerHTML=dialHtml(name,p);if(go)go.max=p.range;}const box=host.querySelector(`[data-set-box="${CSS.escape(name)}"]`);if(box)box.innerHTML=setHtml(d.setKind,name);checkPaint();paint(true);}});
    // Holding a slider keeps sending, so a held slider never times out on the robot.
    setInterval(()=>{if(held&&running)holdSend(held,true);},150);
    host.addEventListener('click',e=>{const r=e.target.closest('[data-reset]');if(r){void send(`R\t${r.dataset.reset}`);return;}
      const l=e.target.closest('[data-light]');if(l){void send(`G\t${l.dataset.light}\t${l.getAttribute('aria-checked')==='true'?0:1}`);return;}
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
    return {event,layout,start,run,install,stop,unplugged,wanted,prepare,warm:ms=>{warmUntil=Date.now()+ms;},send,pulse:pulseWatch,record,running:()=>running,shown:()=>!!host.offsetParent,state:()=>({running,starting,installing,auto,...said}),latest:()=>({manifest,frame}),values:()=>values(frame),onCamera(fn){cameraListeners.add(fn);return ()=>cameraListeners.delete(fn);},onEnd(fn){endListeners.add(fn);return ()=>endListeners.delete(fn);},listen(fn){listeners.add(fn);return ()=>listeners.delete(fn);}};
  }
  root.DeckLiveDebug={create,analogMeaning,i2cState,strayI2c,strayI2cWords,strayAnalog,strayAnalogWords};
})(typeof globalThis==='object'?globalThis:this);
