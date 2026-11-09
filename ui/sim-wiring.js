(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DeckWiring=api;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // The robot's wiring in Setup: what is plugged into each hub port (DeckHardware rows, planned ports and problems), the
  // editors for one device and its sensors, the hubs on the robot and a read-only summary of the whole configuration.
  // project.robot.wiring keeps only what the team set; an empty choice means Deck picks it (shown with what it picked).
  const H=()=>globalThis.DeckHardware||(typeof require==='function'?require('./sim-hardware.js'):null);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const ORDER=['motor','encoder','servo','analog','digital','i2c'];
  // Rows (with planned ports), problems and the stored wiring for one project; the same inputs give the same object.
  let memo={key:'',value:null};
  function state(project){
    const p=project||{},key=JSON.stringify([p.controller,p.robot,p.sensors,p.mechanisms,p.kinematics?.joints,p.kinematics?.actuators]);if(memo.key===key)return memo.value;
    const D=H();let value;
    try{const wiring=D.wiringOf(p.robot),raw=p.controller==='motionmodule'?[]:D.rows(p),rows=D.placed(raw,wiring),problems=D.conflicts(raw,wiring,p.mechanisms?.enabled?p.mechanisms:{});value={wiring,rows,problems,error:null};}
    catch(e){value={wiring:D.wiringOf(p.robot),rows:[],problems:[],error:e.message};}
    value.project=p;memo={key,value};return value;}
  const problemsOf=(st,key)=>st.problems.filter(x=>x.keys.includes(key));
  const red=(st,test)=>st.problems.filter(x=>x.level==='red'&&x.keys.some(test));
  // The setup step a device belongs to: the drivetrain and its sensors on Robot, everything else on Mechanisms.
  const stepOf=key=>/^robot\./.test(key)?'robot':'mechanisms';
  // ---- choices ------------------------------------------------------------------------------------------------------
  // The types a device may be, by what it does: a roller on a DC motor or a continuous servo, a feeder that spins or a
  // servo that pushes or gates... Setting one sets the mechanism (setKind in Setup); the Model list then shows that type.
  const TYPES={drive:[['dcmotor','DC motor']],flywheel:[['dcmotor','DC motor']],roller:[['dcmotor','DC motor'],['crservo','Continuous'],['servo','Set position (can’t keep a roller spinning)',true]],ramp:[['servo','Set position'],['linear','Linear'],['crservo','Continuous'],['dcmotor','DC motor']],kicker:[['servo','Set position'],['linear','Linear']],
    hood:[['servo','Set position'],['linear','Linear']],feeder:[['dcmotor','DC motor'],['crservo','Continuous'],['pusher','Set position, as a pusher'],['gate','Set position, as a gate']],
    turret:[['dcmotor','DC motor'],['servo','Set position'],['crservo','Continuous']],steer:[['crservo','Continuous'],['servo','Set position'],['dcmotor','DC motor']]};
  function typeOf(row,st){if(row.role==='feeder'){const s=st.project?.mechanisms?.shooters?.[row.setting?.index];return {motor:'dcmotor',crservo:'crservo',pusher:'pusher',gate:'gate'}[s?.indexerKind]||row.kind;}return row.kind;}
  function typeSelect(row,st){const list=TYPES[row.role];if(!list||/^kin\./.test(row.key))return '';const now=typeOf(row,st),servos=list.filter(([k])=>k!=='dcmotor'),motor=list.some(([k])=>k==='dcmotor'),isServo=now!=='dcmotor',id=esc(row.key);
    // Motor or servo first; a servo then says which kind. Choosing Servo takes the row's first kind of servo.
    const first=[...(motor?[['dcmotor','DC motor']]:[]),...(servos.length?[[isServo?now:servos[0][0],'Servo']]:[])];
    return `<div><label for="wire-type-${id}">Runs on</label><select id="wire-type-${id}" data-wire-kind="${id}"${first.length<2?' disabled title="Deck’s robot code runs this on one kind of device."':''}>${first.map(([k,l])=>`<option value="${k}"${k===now?' selected':''}>${esc(l)}</option>`).join('')}</select></div>${isServo&&servos.length>1?`<div><label for="wire-servo-${id}">Servo type</label><select id="wire-servo-${id}" data-wire-kind="${id}">${servos.map(([k,l,off])=>`<option value="${k}"${k===now?' selected':''}${off?' disabled':''}>${esc(l)}</option>`).join('')}</select></div>`:''}`;}
  // Models a row may run on: its kind (a servo row may take a linear servo when its role allows one), grouped by maker.
  function modelChoices(row){
    const D=H(),role=D.ROLES[row.role];if(!role||!role.kinds.length)return [];
    const kinds=role.kinds.filter(k=>k===row.kind);
    return D.ACTUATORS.filter(m=>kinds.includes(m.kind));}
  const groupOf=m=>m.family||(m.name.split(/\s/)[0]);
  function modelSelect(row){
    const list=modelChoices(row);if(!list.length)return '';const groups=new Map();for(const m of list){const g=groupOf(m);if(!groups.has(g))groups.set(g,[]);groups.get(g).push(m);}
    const opts=[...groups].map(([g,ms])=>`<optgroup label="${esc(g)}">${ms.map(m=>`<option value="${esc(m.id)}"${m.id===row.model?' selected':''}>${esc(m.short||m.name)}${m.legal===false?' (not pre-verified)':''}</option>`).join('')}</optgroup>`).join('');
    return `<div><label for="wire-model-${esc(row.key)}">Model</label><select id="wire-model-${esc(row.key)}" data-wire-model="${esc(row.key)}"><option value="">Not set</option>${opts}</select></div>`;}
  // Ports of a family on the hubs the robot has, with who is on each now.
  function portChoices(family,st,{skip}={}){
    // The Control Hub and at least one Expansion Hub, always: Simulate is for planning the wiring, so every port can be picked
    // (picking an Expansion Hub port gives the robot one).
    const D=H(),w=st.wiring,hubs=D.hubIds(w),out=[];if(!hubs.some(h=>D.hubKind(h)==='expansion'))hubs.splice(1,0,'expansion');
    const n=(hub)=>D.hubSpec(hub)[family==='encoder'?'encoder':family]||0;
    for(const hub of hubs)for(let i=0;i<n(hub);i++){if(family==='i2c'&&hub==='control'&&i===0)continue;const p=family==='i2c'?{hub,bus:i}:{hub,port:i};
      const on=st.rows.filter(r=>r.key!==skip&&r.hub===hub&&(r.family===family||family==='motor'&&r.family==='encoder'||family==='encoder'&&r.family==='motor')&&(family==='i2c'?r.bus===i:r.port===i)).map(r=>r.name);
      out.push({value:`${hub}:${i}`,label:`${D.portLabel(p,family,w)}${on.length?` · ${[...new Set(on)].join(', ')}`:''}`});}
    return out;}
  // With no Control Hub plugged in, on Wi-Fi or saved there is nothing to plug into: Plugged into is grayed out and says why when hovered.
  function portSelect(row,st,{id='wire-port-'+row.key,attr='data-wire-port',key=row.key,family=row.family,set=row.wired?(row.family==='i2c'?`${row.hub}:${row.bus}`:`${row.hub}:${row.port}`):''}={}){
    if(!family||row.role==='imu')return `<div><span class="sim-mech-label">Plugged into</span><p class="sim-wire-fixed">${esc(row.portLabel||'Control Hub I2C bus 0')}</p></div>`;
    const planned=row.portLabel&&!set?row.portLabel:'',shared=attr==='data-wire-port'?sharedWith(row,st):null;
    return `<div><label for="${esc(id)}">Plugged into</label><select id="${esc(id)}" ${attr}="${esc(key)}"><option value=""${!shared&&!set?' selected':''}>Not assigned</option>${portChoices(family,st,{skip:row.key}).map(o=>`<option value="${o.value}"${!shared&&o.value===set?' selected':''}>${esc(o.label)}</option>`).join('')}</select></div>`;}
  // One motor or servo can power several mechanisms: this device has its own, or runs on another's. A shared one sets only
  // the speed its mechanism turns at.
  const twin=(row,r)=>row.role==='feeder'&&r.role==='feeder';
  const mateOf=(row,st)=>st.rows.find(r=>r.key!==row.key&&r.family===row.family&&r.name===row.name&&!['sensor','pod','imu'].includes(r.role)&&!twin(row,r))||null;
  function shareSelect(row,st){const mates=row.family==='motor'||row.family==='servo'?shareable(row,st).filter(r=>!['drive','steer'].includes(r.role)&&!twin(row,r)):[],word=row.family==='servo'?'servo':'motor',shared=mateOf(row,st);if(!mates.length||['drive','steer'].includes(row.role))return '';
    return `<div><label for="wire-share-${esc(row.key)}">Powered by</label><select id="wire-share-${esc(row.key)}" data-wire-share="${esc(row.key)}"><option value=""${shared?'':' selected'}>Its own ${word}</option>${mates.map(r=>`<option value="${esc(r.key)}"${shared?.key===r.key?' selected':''}>Same ${word} as ${esc(r.label.toLowerCase())}</option>`).join('')}</select></div>`;}
  function spmSelect(row,st){const D=H(),n=st.wiring.hubs.spm||0;if(!n||row.family!=='servo'||D.hubKind(row.hub)==='servoHub')return '';
    return `<div><label for="wire-spm-${esc(row.key)}">Power</label><select id="wire-spm-${esc(row.key)}" data-wire-spm="${esc(row.key)}"><option value="">From the hub’s port (5 V)</option>${Array.from({length:n},(_,i)=>`<option value="${i+1}"${row.spm===i+1?' selected':''}>Through Servo Power Module ${i+1} (6 V)</option>`).join('')}</select></div>`;}
  // How fast it turns, from its model and the CAD's ratios, and the team's to change. A flywheel's own speed is on its card, unless it shares a motor.
  function rpmInput(row,st){if(!['flywheel','roller','feeder'].includes(row.role)||row.role==='flywheel'&&!mateOf(row,st)||row.kind!=='dcmotor'&&row.kind!=='crservo')return '';const m=st.project?.mechanisms,j=(st.project?.kinematics?.joints||[]).find(x=>row.joints?.includes(x.id));if(row.role!=='flywheel'&&!j)return '';const rpm=row.role==='flywheel'?m?.shooter?.rpm??3000:+(j.rpm??(H().MODELS[row.model]?.rpm??(row.kind==='crservo'?71:300))*(j.ratio||1)).toFixed(1);
    return `<div><label for="wire-rpm-${esc(row.key)}">Turns at · rpm</label><input id="wire-rpm-${esc(row.key)}" type="number" min="1" max="60000" data-wire-rpm="${esc(row.key)}" value="${esc(rpm)}"></div>`;}
  // Devices this one could share an actuator with (the same family, not a sensor, pod or the IMU), and the one it shares
  // with: another device of its family with the same configuration name.
  const shareable=(row,st)=>st.rows.filter(r=>r.key!==row.key&&r.family===row.family&&!['sensor','pod','imu'].includes(r.role));
  const sharedWith=(row,st)=>st.rows.find(r=>r.key!==row.key&&r.family===row.family&&r.name===row.name&&!['sensor','pod','imu'].includes(r.role))||null;
  const problemLines=list=>list.map(x=>`<p class="sim-wire-problem ${x.level}">${esc(x.text)}</p>`).join('');
  // ---- what the Control Hub reported ---------------------------------------------------------------------------------
  // read: the devices of its configuration (DeckHubSetup.readout). Calibrate shows ports only from this, never Deck's plan.
  const readFamily=d=>d.bus!==undefined?'i2c':d.kind==='motor'?'motor':['servo','crservo'].includes(d.kind)?'servo':d.kind==='analog'?'analog':['digital','touch'].includes(d.kind)?'digital':'';
  const readPlace=(d,w)=>d.hub?H().portLabel(d,readFamily(d),w):`${d.hubName||'Another hub'}${d.bus!==undefined?` I2C bus ${d.bus}`:d.port!==undefined?` port ${d.port}`:''}`;
  const readDevice=(row,read)=>read.find(d=>d.name===(row.via||row.name))||(row.role==='imu'?read.find(d=>d.kind==='imu'):null)||null;
  const readPort=(row,st,read)=>{const d=readDevice(row,read);return `<div><span class="sim-mech-label">Plugged into</span><p class="sim-wire-fixed" data-wire-read="${d?'on':'off'}">${d?esc(readPlace(d,st.wiring)):'Not on the Control Hub'}</p></div>`;};
  // The sentence on a device, with the hub's port in place of Deck's plan.
  function readExplain(row,st,read){const D=H(),d=readDevice(row,read),at=d?{hub:d.hub,port:d.port,bus:d.bus}:{hub:null};
    return D.explain({...row,...at},st.wiring).replace(': Deck picks its port',': not in the Control Hub’s configuration');}
  const READ_KINDS={motor:'Motor',servo:'Servo',crservo:'Continuous servo',imu:'IMU',touch:'Touch sensor',digital:'Digital sensor',analog:'Analog sensor',color:'Color sensor',distance:'Distance sensor',pinpoint:'goBILDA Pinpoint',otos:'SparkFun OTOS',octoquad:'OctoQuad'};
  // Every device the hub reported, hub by hub and port by port.
  function readoutHtml(read,st){
    const D=H(),w=st.wiring,titleOf=d=>d.hub?D.hubName(d.hub,w):d.hubName||'Another hub',order=D.hubIds(w),hubRank=d=>{const i=order.indexOf(d.hub);return i<0?order.length:i;},titles=[...new Set([...order.map(h=>D.hubName(h,w)),...[...read].sort((a,b)=>hubRank(a)-hubRank(b)).map(titleOf)])];
    return titles.map(title=>{const on=read.filter(d=>titleOf(d)===title).sort((a,b)=>ORDER.indexOf(readFamily(a))-ORDER.indexOf(readFamily(b))||(a.port??a.bus??0)-(b.port??b.bus??0));
      const lines=on.map(d=>{const place=readPlace(d,w).slice(title.length).trim();return `<tr data-read-row="${esc(d.name)}"><td>${esc(place.charAt(0).toUpperCase()+place.slice(1))}</td><td><code>${esc(d.name)}</code></td><td title="${esc(d.tag)}">${esc(READ_KINDS[d.kind]||d.tag)}</td></tr>`;});
      return `<h4 class="sim-setup-group">${esc(title)}</h4>${lines.length?`<table class="sim-wire-table"><thead><tr><th>Port</th><th>Name</th><th>Type</th></tr></thead><tbody>${lines.join('')}</tbody></table>`:'<p class="hint">Nothing configured on it yet.</p>'}`;}).join('')||'<p class="hint">Its configuration has no devices on it yet.</p>';}
  // ---- one device -----------------------------------------------------------------------------------------------------
  // A device's row: its name, model, port, a sentence on what it is and does, and its problems (red, but they hold nothing back).
  // read: the hub's read-out; its port is then shown as the hub reported it and cannot be changed here.
  let st_w=null;const st_wiring=()=>st_w;
  function assignBox(row,assign){const id=`wire-assign-${esc(row.key)}`,list=(assign||[]).filter(d=>d.hub&&readFamily(d)===row.family);
    if(!assign)return `<div><span class="sim-mech-label">Plugged into</span><p class="sim-wire-fixed sim-wire-unset">Set in Setup &amp; Calibrate</p></div>`;
    const now=row.wired?`${row.hub}:${row.family==='i2c'?row.bus:row.port}`:'';
    return `<div><label for="${id}">Plugged into</label><select id="${id}" data-wire-assign="${esc(row.key)}"><option value="">Not assigned</option>${list.map(d=>{const at=`${d.hub}:${d.bus??d.port}`;return `<option value="${esc(at)}|${esc(d.name)}"${at===now?' selected':''}>${esc(H().portLabel(d,readFamily(d),st_wiring(row)))}</option>`;}).join('')}</select></div>`;}
  // A gearbox added after the motor: the output is the motor's speed divided by this.
  function ratioBox(row,st){const md=H().MODELS[row.model];if(row.family!=='motor'||row.role==='pod'||!md||md.kind!=='dcmotor')return '';const ratio=st.wiring.devices?.[row.key]?.ratio||1,id=`wire-ratio-${esc(row.key)}`;
    return `<div class="sim-wire-ratio"><label for="${id}">Gear ratio after the motor</label><input id="${id}" type="number" min="0.01" max="1000" step="any" data-wire-ratio="${esc(row.key)}" value="${ratio}"><p class="hint">${md.rpm?`${md.rpm} rpm ÷ ${ratio} = ${Math.round(md.rpm/ratio*10)/10} rpm at the output.`:'1 means nothing after the motor.'}</p></div>`;}
  function deviceHtml(row,st,{sensors=false,model=true,read=null,noPort=false,assign}={}){
    st_w=st.wiring;
    const portBox=()=>noPort?(assign!==undefined&&row.family&&row.role!=='imu'?assignBox(row,assign):''):read?readPort(row,st,read):portSelect(row,st),share=`${read?'':`${shareSelect(row,st)}${rpmInput(row,st)}`}${noPort?'':spmSelect(row,st)}`,told=(read?readExplain(row,st,read):H().explain(noPort?{...row,hub:null}:row,st.wiring)).replace(noPort?': Deck picks its port':'\0','');
    const D=H(),list=problemsOf(st,row.key).filter(x=>!noPort||!x.port),level=list.some(x=>x.level==='red'||x.level==='limit')?'red':list.length?'amber':'';
    const role=D.ROLES[row.role],why=role?.explain?`<p class="hint sim-wire-why">${esc(role.explain)}</p>`:'';
    const pod=row.role==='pod'&&!noPort?'<p class="hint">Plug the pod into the encoder input of a motor port: the code reads it through the name of the motor on that port.</p>':'';
    return `<div class="sim-wire-row${level?' '+level:''}" data-wire-row="${esc(row.key)}"><div class="sim-wire-head"><b>${esc(row.label)}</b><code title="Its name in the robot configuration">${esc(row.name)}</code></div>
      ${model&&TYPES[row.role]&&!/^kin\./.test(row.key)?`<div class="start-xy">${typeSelect(row,st)}${modelSelect(row)}</div>${read?'':ratioBox(row,st)}<div class="start-xy">${portBox()}${share}</div>`:`<div class="start-xy">${model?modelSelect(row):''}${portBox()}${share}</div>`}<p class="sim-wire-explain">${esc(told)}${sharedWith(row,st)?` It shares this ${row.family==='servo'?'servo':'motor'} with ${esc(sharedWith(row,st).label.toLowerCase())}: they are belted or geared together and always turn together.`:''}</p>${pod}${sensors?sensorsHtml(row,st,{read,noPort}):''}${problemLines(list)}${sensors?'':why}</div>`;}
  // Sensors on one device: each with its model, what it is used for and its port, and an Add choice of the sensors the
  // export can use on that device.
  function sensorsHtml(row,st,{read=null,noPort=false}={}){
    const D=H(),allowed=D.ROLES[row.role]?.sensors||{},own=st.wiring.sensors.filter(s=>s.for===row.key);
    const items=own.map(s=>{const md=D.SENSOR_MODELS[s.model],sr=st.rows.find(r=>r.key==='sensor.'+s.id)||{key:'sensor.'+s.id,family:md.family,role:'sensor'},list=problemsOf(st,'sensor.'+s.id).filter(x=>!noPort||!x.port);
      const port=noPort?'':md.kind==='motorEncoder'?`<div><span class="sim-mech-label">Plugged into</span><p class="sim-wire-fixed">The motor’s own cable</p></div>`:read?readPort(sr,st,read):portSelect(sr,st,{id:'wire-sensor-'+s.id,attr:'data-wire-sensor-port',key:s.id,family:md.family,set:s.hub?(md.family==='i2c'?`${s.hub}:${s.bus}`:`${s.hub}:${s.port}`):''});
      const uses=md.measures.length>1?`<div><label for="wire-use-${esc(s.id)}">Tells</label><select id="wire-use-${esc(s.id)}" data-wire-sensor-use="${esc(s.id)}">${md.measures.map(u=>`<option value="${u}"${u===s.use?' selected':''}>${esc(D.USES[u])}</option>`).join('')}</select></div>`:'';
      return `<li class="sim-wire-sensor${list.some(x=>x.level==='red')?' red':list.length?' amber':''}"><div class="sim-wire-head"><b>${esc(md.short)}</b>${md.kind==='motorEncoder'?'':`<code>${esc(sr.name||s.id)}</code>`}<button type="button" class="icon-button" data-wire-sensor-remove="${esc(s.id)}" aria-label="Remove ${esc(md.short)}" title="Remove">×</button></div>
        <div class="start-xy">${uses}${port}</div>${md.kind==='motorEncoder'?'':`<p class="sim-wire-explain">${esc((read?readExplain(sr,st,read):D.explain(noPort?{...sr,hub:null}:sr,st.wiring)).replace(noPort?': Deck picks its port':'\0',''))}</p>`}${problemLines(list)}</li>`;});
    const can=D.SENSORS.filter(m=>Object.hasOwn(allowed,m.kind)&&!(m.kind==='motorEncoder'&&(row.family!=='motor'||own.some(s=>s.model===m.id))));
    const add=can.length?`<label class="sr-only" for="wire-add-${esc(row.key)}">Add a sensor to ${esc(row.label)}</label><select id="wire-add-${esc(row.key)}" data-wire-sensor-add="${esc(row.key)}"><option value="">+ Add a sensor…</option>${can.map(m=>`<option value="${m.id}">${esc(m.short)}: tells ${esc(D.USES[allowed[m.kind]])}</option>`).join('')}</select>`:'';
    return `<div class="sim-wire-sensors"><span class="sim-mech-label">Sensors</span>${items.length?`<ul>${items.join('')}</ul>`:`<p class="hint">${row.encoder?'Its own encoder is read (no extra sensor).':'None: it runs on set positions and times.'}</p>`}${add}</div>`;}
  // The chassis in Mechanisms: every wheel turns at one RPM and models come from Setup & Calibrate, so each motor or servo says
  // only what it is plugged into, and what tells a module's angle says where that is. read: the hub's read-out, when there is one.
  const moduleEncoder=(row,st)=>row.role==='steer'||(/^diffSwerve/.test(st.project?.robot?.drivetrain||'')&&!/B$/.test(row.key)&&row.role==='drive');
  const encoderOf=(row,st)=>st.wiring.sensors.find(s=>s.for===row.key&&H().SENSOR_MODELS[s.model]?.family==='analog')||null;
  function chassisChoices(family,st,read,skip){const list=(read||[]).filter(d=>d.hub&&readFamily(d)===family);
    // An I2C device sits on a bus, not a port. Each choice names the configured device too: picking one also gives this row that name.
    return list.length?list.filter(d=>family!=='i2c'||d.kind!=='imu'||/imu/i.test(skip||'')).map(d=>{const at=`${d.hub}:${family==='i2c'?d.bus:d.port}`;return {value:`${at}|${d.name}`,at,label:`${H().portLabel(d,family,st.wiring)} · ${d.name}`};}):portChoices(family,st,{skip}).map(o=>({...o,at:o.value}));}
  function chassisSelect(id,attr,key,label,choices,now){return `<div class="sim-chassis-row"><label for="${esc(id)}">${esc(label)}</label><select id="${esc(id)}" ${attr}="${esc(key)}"><option value="">Not assigned</option>${choices.map(o=>`<option value="${esc(o.value)}"${o.at===now?' selected':''}>${esc(o.label)}</option>`).join('')}</select></div>`;}
  // Grouped by wheel or module: a drive motor, then what belongs to it (its steering, a differential module's second motor).
  // opts: placing, the key (wheel, pod:<key>, pinpoint:x|y) the next click on the model places; pick, a model to click on.
  const placeBtn=(key,label,{placing,pick})=>pick?`<button type="button" class="secondary sim-place" data-wheel-place="${esc(key)}" aria-pressed="${placing===key}" aria-label="${placing===key?'Stop placing':'Click it on the model'}: ${esc(label)}">${placing===key?'Click it on the model…':'Click it on the model'}</button>`:'';
  function chassisHtml(rows,st,read,opts={}){const groups=[];for(const row of rows){if(row.role==='drive'&&!/B$/.test(row.key)||!groups.length)groups.push([]);groups[groups.length-1].push(row);}
    return groups.map(g=>{const title=g[0].label.replace(/ drive motor$/,'').replace(/, motor 1$/,'').replace(/ drive$/,''),module=g.length>1;
      // Where it is: inches forward and left of the robot's centre, found in the CAD or typed.
      const k=g[0].key.replace(/^robot\./,''),p=st.project?.robot?.wheelPos?.[k],num=(axis,label)=>`<label>${label}<input type="number" step="0.25" min="-36" max="36" data-slider="off" data-wheel-pos="${esc(k)}" data-wheel-axis="${axis}" value="${p?esc(p[axis]):''}"></label>`;
      const pos=`<div class="sim-chassis-pos">${num('x','Forward · in')}${num('y','Left · in')}<small>${p?`${Math.hypot(p.x,p.y).toFixed(2)} in from the centre${p.from==='cad'?' · from the CAD':''}${p.r?` · ${(2*p.r).toFixed(2)} in wheel`:''}`:'Not placed yet'}</small>${placeBtn(k,title,opts)}</div>`;
      return `<div class="sim-chassis-module" data-module="${esc(k)}" data-module-title="${esc(title)} ${module?'module':'wheel'}"><div class="sim-chassis-module-head"><b>${esc(title)} ${module?'module':'wheel'}</b><small>${g.map(r=>`<code>${esc(r.name)}</code>`).join(' · ')}</small></div>${pos}${chassisRows(g,st,read)}</div>`;}).join('');}
  // What tells the chassis where it is, each in a card of its own like a wheel's: an odometry pod (where it is and the
  // motor port whose encoder input it uses), a goBILDA Pinpoint (its I2C port and where its two pods are) or an OTOS.
  function senseHtml(rows,st,read,opts={}){const C=globalThis.DeckSimConfig||require('./sim-config.js'),odo=C.odometryOf(st.project?.robot||{});
    const field=(attr,key,axis,label,v)=>`<label>${label}<input type="number" step="0.25" min="-36" max="36" data-slider="off" ${attr}="${esc(key)}" data-wheel-axis="${axis}" value="${Number.isFinite(v)?esc(v):''}"></label>`;
    return rows.map(row=>{const k=row.key.replace(/^robot./,''),port=`<div class="start-xy">${mechPort(row,st,read)}</div>`;
      if(row.role==='pod'){const p=odo.pods[k]||{},title=`Odometry pod · ${{par:'forward',perp:'strafe',par_left:'left forward',par_right:'right forward'}[k]||k}`;
        return `<div class="sim-chassis-module" data-module="pod:${esc(k)}" data-module-title="${esc(title)}" data-wire-row="${esc(row.key)}"><div class="sim-chassis-module-head"><b>${esc(title)}</b><small><code>${esc(row.name)}</code></small></div>
          <div class="sim-chassis-pos">${field('data-pod-pos',k,'x','Forward · in',p.x)}${field('data-pod-pos',k,'y','Left · in',p.y)}<small></small>${placeBtn('pod:'+k,title,opts)}</div>${port}</div>`;}
      if(row.role==='pinpoint'){const p=odo.pinpoint;
        return `<div class="sim-chassis-module" data-module="pinpoint" data-module-title="Odometry · goBILDA Pinpoint" data-wire-row="${esc(row.key)}"><div class="sim-chassis-module-head"><b>Odometry · goBILDA Pinpoint</b><small><code>${esc(row.name)}</code></small></div>
          <div class="sim-chassis-pos">${field('data-pinpoint-pos','xOffset','y','X pod · left · in',p.xOffset)}<small></small>${placeBtn('pinpoint:x','the X (forward) pod',opts)}</div>
          <div class="sim-chassis-pos">${field('data-pinpoint-pos','yOffset','x','Y pod · forward · in',p.yOffset)}<small></small>${placeBtn('pinpoint:y','the Y (strafe) pod',opts)}</div>${port}</div>`;}
      const title=row.role==='otos'?'Odometry · SparkFun OTOS':row.label;
      return `<div class="sim-chassis-module" data-module="${esc(k)}" data-module-title="${esc(title)}" data-wire-row="${esc(row.key)}"><div class="sim-chassis-module-head"><b>${esc(title)}</b><small><code>${esc(row.name)}</code></small></div>${port}</div>`;}).join('');}
  function chassisRows(rows,st,read){return rows.map(row=>{const fromRead=(read||[]).some(d=>d.hub&&readFamily(d)===row.family),own=row.wired?`${row.hub}:${row.port}`:'',sensor=moduleEncoder(row,st)?encoderOf(row,st):null;
    const port=chassisSelect(`wire-chassis-${row.key}`,fromRead?'data-wire-assign':'data-wire-port',row.key,row.label,chassisChoices(row.family,st,read,row.key),own);
    const encoder=moduleEncoder(row,st)?chassisSelect(`wire-chassis-encoder-${row.key}`,'data-wire-chassis-encoder',row.key,`${row.label.replace(/, motor 1$/,' module')} absolute encoder`,chassisChoices('analog',st,read,sensor?`sensor.${sensor.id}`:row.key),sensor?.hub?`${sensor.hub}:${sensor.port}`:''):'';
    // A drive motor's own encoder: ticked when its encoder cable is plugged in. With position from the drive encoders every one has it.
    const implied=row.role==='drive'&&st.project?.sensors?.localization==='encoders',hasEnc=implied||st.wiring.sensors.some(s=>s.for===row.key&&s.model==='motor-encoder');
    const enc=row.role==='drive'?`<label class="check sim-chassis-enc" title="${implied?'Position comes from the drive encoders, so every drive motor has one':'Its encoder cable is plugged into the hub'}"><input type="checkbox" data-wire-encoder="${esc(row.key)}"${hasEnc?' checked':''}${implied?' disabled':''}> Encoder</label>`:'';
    return `<div data-wire-row="${esc(row.key)}" title="Its name in the robot configuration: ${esc(row.name)}">${port}${enc}${encoder}${problemLines(problemsOf(st,row.key).filter(x=>x.port&&row.wired&&x.keys.length>1))}</div>`;}).join('');}
  // The hub's IMU on Chassis → Control Hub: the I2C bus it is on in the robot's configuration. The built-in one is on bus 0
  // unless the team moved it; with the robot's configuration read, the choices are the IMUs it has.
  function imuHtml(st,read){const row=st.rows.find(r=>r.role==='imu');if(!row)return '';const id='wire-port-'+row.key,now=row.hub?`${row.hub}:${row.bus??0}`:'control:0';
    const imus=(read||[]).filter(d=>d.hub&&d.kind==='imu'&&d.bus!==undefined),fromRead=imus.length>0;
    const choices=fromRead?imus.map(d=>{const at=`${d.hub}:${d.bus}`;return {value:`${at}|${d.name}`,at,label:`${H().portLabel(d,'i2c',st.wiring)} · ${d.name}`};})
      :[{value:'control:0',at:'control:0',label:`${H().portLabel({hub:'control',bus:0},'i2c',st.wiring)} · built in`},...portChoices('i2c',st,{skip:row.key}).map(o=>({...o,at:o.value}))];
    if(!choices.some(o=>o.at===now))choices.unshift({value:fromRead?`${now}|${row.name}`:now,at:now,label:H().portLabel({hub:row.hub||'control',bus:row.bus??0},'i2c',st.wiring)});
    const bus=now.split(':')[1];
    return `<div class="sim-imu-port" data-wire-row="${esc(row.key)}"><div class="sim-chassis-module-head"><b>IMU</b><small><code>${esc(row.name)}</code></small></div><div class="start-xy"><div><label for="${esc(id)}">Plugged into</label><select id="${esc(id)}" ${fromRead?'data-wire-assign':'data-wire-port'}="${esc(row.key)}">${choices.map(o=>`<option value="${esc(o.value)}"${o.at===now?' selected':''}>${esc(o.label)}</option>`).join('')}</select></div></div><p class="hint">${fromRead?`The robot’s configuration has “${esc(row.name)}” on I2C bus ${esc(bus)}.`:bus==='0'?`The Control Hub’s IMU is built in: its configuration names it “${esc(row.name)}” on I2C bus 0.`:`“${esc(row.name)}” on I2C bus ${esc(bus)}: the configuration must have it there too.`}</p></div>`;}
  // A module's absolute encoder on an analog port. A model Setup & Calibrate already gave it stays.
  function setChassisEncoder(wiring,row,at,name){const D=H(),w=D.wiringOf({wiring}),own=w.sensors.find(s=>s.for===row.key&&D.SENSOR_MODELS[s.model]?.family==='analog');
    if(!at)return own?removeSensor(wiring,own.id):D.sanitizeWiring(w);
    const added=own?D.sanitizeWiring(w):addSensor(w,row,'analog-absolute'),id=own?.id||added.sensors.find(s=>!w.sensors.some(x=>x.id===s.id))?.id;if(!id)return D.sanitizeWiring(w);
    const placed=setSensorPort(added,id,at);return name?setSensor(placed,id,s=>{s.name=name;}):placed;}
  // A mechanism's motor or servo, the same way every time: what it runs on, its model, its port, what powers it, and a sensor
  // if it has one. Only what runs on it is needed for the simulation; the rest is for the real robot and can stay unset.
  function mechPort(row,st,read){const fromRead=(read||[]).some(d=>d.hub&&readFamily(d)===row.family),now=row.wired?`${row.hub}:${row.family==='i2c'?row.bus:row.port}`:'',id=`wire-port-${row.key}`;
    return `<div><label for="${esc(id)}">Plugged into</label><select id="${esc(id)}" ${fromRead?'data-wire-assign':'data-wire-port'}="${esc(row.key)}"><option value="">Not assigned</option>${chassisChoices(row.family,st,read,row.key).map(o=>`<option value="${esc(o.value)}"${!mateOf(row,st)&&o.at===now?' selected':''}>${esc(o.label)}</option>`).join('')}</select></div>`;}
  function mechSensor(row,st){const D=H(),allowed=D.ROLES[row.role]?.sensors||{},own=st.wiring.sensors.filter(s=>s.for===row.key),first=own[0],md=first&&D.SENSOR_MODELS[first.model],id=`wire-sensor-pick-${row.key}`;
    const can=D.SENSORS.filter(m=>Object.hasOwn(allowed,m.kind)&&(m.kind!=='motorEncoder'||row.family==='motor'));
    const port=md&&md.kind!=='motorEncoder'?portSelect(st.rows.find(r=>r.key==='sensor.'+first.id)||{key:'sensor.'+first.id,family:md.family,role:'sensor'},st,{id:'wire-sensor-'+first.id,attr:'data-wire-sensor-port',key:first.id,family:md.family,set:first.hub?(md.family==='i2c'?`${first.hub}:${first.bus}`:`${first.hub}:${first.port}`):''}).replace('Plugged into','Sensor plugged into'):'';
    return `${can.length?`<div><label for="${esc(id)}">Sensor</label><select id="${esc(id)}" data-wire-sensor-pick="${esc(row.key)}"><option value="">No sensor</option>${can.map(m=>`<option value="${m.id}"${m.id===first?.model?' selected':''}>${esc(m.short)}</option>`).join('')}</select></div>`:''}${port}`;}
  // Every sensor on a mechanism's motor or servo, each with where it is plugged in and a remove button, then + Add a sensor
  // with the ones that part can use, grouped by the port they plug into (analog, digital, I2C, an encoder input).
  const SENSOR_GROUPS=[['analog','Analog'],['digital','Digital'],['i2c','I2C'],['encoder','Encoder']];
  function mechSensors(row,st,{ports=true}={}){const D=H(),allowed=D.ROLES[row.role]?.sensors||{},own=st.wiring.sensors.filter(s=>s.for===row.key);
    const items=own.map(s=>{const md=D.SENSOR_MODELS[s.model];if(!md)return '';const port=md.kind==='motorEncoder'||!ports?'':portSelect(st.rows.find(r=>r.key==='sensor.'+s.id)||{key:'sensor.'+s.id,family:md.family,role:'sensor'},st,{id:'wire-sensor-'+s.id,attr:'data-wire-sensor-port',key:s.id,family:md.family,set:s.hub?(md.family==='i2c'?`${s.hub}:${s.bus}`:`${s.hub}:${s.port}`):''}).replace('Plugged into',`${esc(md.short)} plugged into`);
      const uses=md.measures.filter(u=>Object.values(allowed).includes(u)||u===s.use),use=uses.length>1?`<div><label for="wire-use-${esc(s.id)}">Tells</label><select id="wire-use-${esc(s.id)}" data-wire-sensor-use="${esc(s.id)}">${uses.map(u=>`<option value="${u}"${u===s.use?' selected':''}>${esc(D.USES[u])}</option>`).join('')}</select></div>`:'';
      return `<div class="sim-mech-sensor">${port||`<div><span class="sim-mech-label">${esc(md.short)}</span></div>`}${use}<button type="button" class="icon-button" data-wire-sensor-remove="${esc(s.id)}" aria-label="Remove ${esc(md.short)}" title="Remove">×</button></div>`;}).join('');
    const can=D.SENSORS.filter(m=>Object.hasOwn(allowed,m.kind)&&!(m.kind==='motorEncoder'&&(row.family!=='motor'||own.some(s=>s.model===m.id)))),id=`wire-add-${row.key}`;
    const add=can.length?`<div><label for="${esc(id)}">${own.length?'Another sensor':ports?'Sensor':'Feedback sensor'}</label><select id="${esc(id)}" data-wire-sensor-add="${esc(row.key)}"><option value="">${own.length?'+ Add another…':'No sensor · + Add one…'}</option>${SENSOR_GROUPS.map(([f,t])=>{const list=can.filter(m=>m.family===f);return list.length?`<optgroup label="${t}">${list.map(m=>`<option value="${m.id}">${esc(m.short)}</option>`).join('')}</optgroup>`:'';}).join('')}</select></div>`:'';
    return items||add?`<div class="sim-mech-sensors">${items}<div class="start-xy">${add}</div></div>`:'';}
  // Its picture: the model's when it has one, else one of its kind. A product photo replaces the drawing when it is on this computer.
  function devicePicture(row){const tag=H().pictureTag(row.model)||{dcmotor:'model-none|goBILDA5202SeriesMotor',servo:'model-none|Servo',crservo:'model-none|ContinuousRotationServo',linear:'model-none|Servo'}[row.kind],art=globalThis.DeckDeviceArt;return tag&&art?`<span class="ce-fig small" data-fig="${esc(tag)}">${art.svg(tag,{title:false})}</span>`:'';}
  // ports: false in Simulate, which lists what a mechanism runs on and what measures it; which port each is on is linked in Calibrate → Mechanisms (linkHtml).
  function linkNote(row,st){const on=row.wired&&!mateOf(row,st);return `<div><span class="sim-mech-label">On the robot</span><p class="sim-wire-fixed${on?'':' sim-wire-unset'}" data-wire-linked="${on?'on':'off'}">${on?`${esc(row.name)} · ${esc(H().portLabel(row,row.family,st.wiring))}`:'Linked in Calibrate → Mechanisms'}</p></div>`;}
  function mechRowHtml(row,st,{read=null,model=true,ports=true}={}){st_w=st.wiring;const list=problemsOf(st,row.key).filter(x=>x.port?row.wired&&x.keys.length>1:x.level==='red'),level=list.length?'red':'',typed=model&&TYPES[row.role]&&!/^kin\./.test(row.key);
    return `<div class="sim-wire-row${level?' '+level:''}" data-wire-row="${esc(row.key)}" title="Its name in the robot configuration: ${esc(row.name)}"><div class="sim-wire-head">${devicePicture(row)}<b>${esc(row.label)}</b></div>
      <div class="start-xy">${typed?typeSelect(row,st):''}${model?modelSelect(row):''}${ports?mechPort(row,st,read):linkNote(row,st)}${shareSelect(row,st)}${rpmInput(row,st)}</div>${mechSensors(row,st,{ports})}${problemLines(list)}</div>`;}
  // ---- Calibrate → Mechanisms, the link step ---------------------------------------------------------------------------
  // Simulate says what a mechanism runs on and what measures it; here each of those is one device of the robot's configuration.
  // read: the hub's read-out. A motor or servo takes the configured device's name and port; a sensor too; an encoder takes the
  // motor port whose encoder input it is plugged into, and keeps its own name.
  const linkFamily=f=>f==='encoder'?'motor':f,linkList=(read,family)=>(read||[]).filter(d=>d.hub&&readFamily(d)===linkFamily(family));
  const samePort=(row,d)=>d.hub===row.hub&&(row.family==='i2c'?d.bus===row.bus:d.port===row.port);
  function linkedTo(row,read){if(!row||!row.wired)return null;return linkList(read,row.family).find(d=>samePort(row,d)&&(row.family==='encoder'||d.name===row.name))||null;}
  function linkSelect(id,attr,key,row,family,st,read,label){const list=linkList(read,family),on=linkedTo(row&&{...row,family},read),what={motor:'motor',servo:'servo',encoder:'motor port',analog:'analog sensor',digital:'digital sensor',i2c:'I2C sensor'}[family]||'device';
    const also=d=>st.rows.filter(r=>r.key!==row?.key&&r.wired&&r.family===family&&samePort({...r,family},d)&&(family==='encoder'||r.name===d.name)).map(r=>r.label);
    const opts=list.map(d=>{const u=also(d),text=family==='encoder'?`${H().portLabel(d,'encoder',st.wiring)} · beside ${d.name}`:`${d.name} · ${H().portLabel(d,readFamily(d),st.wiring)}`;return `<option value="${esc(d.hub)}:${d.bus??d.port}|${family==='encoder'?'':esc(d.name)}"${d===on?' selected':''}>${esc(text)}${u.length?` · also ${esc(u.join(', '))}`:''}</option>`;}).join('');
    return `<div><label for="${esc(id)}">${esc(label)}</label><select id="${esc(id)}" ${attr}="${esc(key)}" data-link-state="${on?'on':'off'}"><option value="">Not linked</option>${opts}</select></div>${list.length?'':`<p class="cal-note" data-link-none>The robot’s configuration has no ${what} yet. Add it in Configure, then read the Control Hub again.</p>`}`;}
  const KIND_WORDS={dcmotor:'DC motor',servo:'Servo',crservo:'Continuous servo',linear:'Linear servo'};
  function linkHtml(row,st,read){st_w=st.wiring;const D=H(),own=st.wiring.sensors.filter(s=>s.for===row.key),servo=row.family==='servo';
    const head=(title,sub,pic='')=>`<div class="sim-wire-head">${pic}<b>${esc(title)}</b><small>${esc(sub)}</small></div>`;
    const lines=[`<div class="cal-link-row" data-link-row="${esc(row.key)}">${head(row.label,D.MODELS[row.model]?.short||KIND_WORDS[row.kind]||'',devicePicture(row))}${linkSelect('cal-link-'+row.key,'data-wire-assign',row.key,row,row.family,st,read,`Which ${servo?'servo':'motor'} on the robot`)}</div>`];
    for(const s of own){const md=D.SENSOR_MODELS[s.model];if(!md)continue;const r=st.rows.find(x=>x.key==='sensor.'+s.id),sub=`Feedback: tells ${D.USES[s.use]||'what it does'}`;
      lines.push(`<div class="cal-link-row" data-link-row="sensor.${esc(s.id)}">${head(md.short,sub)}${md.kind==='motorEncoder'?'<div><span class="sim-mech-label">On the robot</span><p class="sim-wire-fixed">The encoder cable of this motor’s own port</p></div>':linkSelect('cal-link-sensor-'+s.id,'data-wire-sensor-assign',s.id,r||null,md.family,st,read,md.family==='encoder'?'Which motor port’s encoder input':'Which sensor on the robot')}</div>`);}
    if(!own.length)lines.push(`<p class="hint" data-link-nosensor>Simulate lists no feedback sensor on it, so nothing measures it: it gets set positions or power and time. Add its sensor in Simulate to tune it by feedback.</p>`);
    return lines.join('');}
  // Whether the mechanism's device and every sensor Simulate lists on it is one of the configuration's.
  function linked(row,st,read){const D=H();if(!linkedTo(row,read))return false;return st.wiring.sensors.filter(s=>s.for===row.key).every(s=>{const md=D.SENSOR_MODELS[s.model];if(!md||md.kind==='motorEncoder')return true;const r=st.rows.find(x=>x.key==='sensor.'+s.id);return !!r&&!!linkedTo({...r,family:md.family},read);});}
  // A sensor takes a configured device's port and, unless it is an encoder input, its name.
  function assignSensor(wiring,id,value){const [at,name]=String(value||'').split('|'),placed=setSensorPort(wiring,id,at||'');return name?setSensor(placed,id,s=>{s.name=name;}):placed;}
  // Picks the device's one sensor, or none: a model chosen in Setup & Calibrate's list replaces the one it had.
  function setMechSensor(wiring,row,model){const D=H(),w=D.wiringOf({wiring}),rest=D.sanitizeWiring({...w,sensors:(()=>{const own=w.sensors.filter(s=>s.for===row.key);return w.sensors.filter(s=>s!==own[0]);})()});return model?addSensor(rest,row,model):rest;}
  // ---- hubs -----------------------------------------------------------------------------------------------------------
  // The Control Hub is always there. How many Expansion Hubs, Servo Hubs and Servo Power Modules hang off it, each set with
  // − and +; each hub in a section of its own that opens to its ports. seen(id): what the robot said of that hub, when asked.
  function hubsHtml(st,{counts=true,ids='',seen=null,only=null}={}){
    const D=H(),w=st.wiring,room=kind=>D.MAX_CHAINED-(D.hubIds(w).length-1)+D.hubsOfKind(w.hubs,kind).length;
    const list=(id,attr,value,max,from=0,word=n=>n)=>`<select id="${ids}${id}" ${attr}>${Array.from({length:max-from+1},(_,i)=>i+from).map(n=>`<option value="${n}"${n===value?' selected':''}>${word(n)}</option>`).join('')}</select>`;
    const step=(kind,name,dir,off)=>`<button type="button" class="secondary" id="${ids}wire-${dir>0?'more':'less'}-${kind}" data-wire-hub-step="${kind}" data-step="${dir}" aria-label="${dir>0?'One more':'One fewer'}: ${name}"${off?' disabled':''}><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14${dir>0?'M12 5v14':''}"/></svg></button>`;
    const box=(kind,name,note,n,max)=>`<div class="sim-wire-hub sim-wire-card"><b id="${ids}wire-count-${kind}">${name}</b><p class="hint">${note}</p><div class="sim-wire-stepper" role="group" aria-labelledby="${ids}wire-count-${kind}">${step(kind,name,-1,n<=0)}<output>${n}</output>${step(kind,name,1,n>=max)}</div></div>`;
    const chooser=only?`<div class="sim-wire-hubs">${only.includes('spm')?box('spm','Servo Power Modules','V1, REV-11-1144: boosts a hub’s servo ports. No robot can report one, so say how many here.',w.hubs.spm||0,D.MAX_SPM):''}</div>`:counts?`<div class="sim-wire-hubs"><div class="sim-wire-hub sim-wire-card"><b>Control Hub</b><p class="hint">Every robot has one. Everything else connects to it.</p><div class="sim-wire-stepper"><output>1</output></div></div>${box('expansion','Expansion Hubs','On the RS485 cable. A competition robot may have one (R701).',D.hubsOfKind(w.hubs,'expansion').length,room('expansion'))}
      ${box('servoHub','Servo Hubs','V2, REV-11-1855: battery power, data over the RS485 cable.',D.hubsOfKind(w.hubs,'servoHub').length,room('servoHub'))}
      ${box('spm','Servo Power Modules','V1, REV-11-1144: boosts a hub’s servo ports. No robot can report one, so pick it here.',w.hubs.spm||0,D.MAX_SPM)}</div>`:'';
    const section=id=>{const kind=D.hubKind(id),mates=D.hubsOfKind(w.hubs,kind),said=seen?seen(id):null,head=`<b>${esc(D.hubName(id,w))}</b>${said?`<span class="rs-pill ${said.level}">${esc(said.text)}</span>`:''}`;
      const own=id==='control'?'':`<div class="sim-wire-hubs">${mates.length>1?`<div class="sim-wire-hub"><label for="${ids}wire-label-${id}">This is my</label>${list(`wire-label-${id}`,`data-wire-hub-label="${id}"`,w.hubs[id].label||0,mates.length,0,n=>n?`${D.HUBS[kind].name} ${n}`:'Not decided')}</div>`:''}<div class="sim-wire-hub"><label for="${ids}wire-address-${id}">Address</label>${list(`wire-address-${id}`,`data-wire-hub-address="${id}"`,w.hubs[id].address,Math.max(10,w.hubs[id].address),1)}<p class="hint">${said?.level==='ok'?'The hub reported this. ':''}Change a hub’s real address in the REV Hardware Client.</p></div></div>`;
      return `<details class="rs-hub"${seen?'':' open'}><summary>${head}</summary>${own}${portGrid(st,id,ids)}</details>`;};
    return `${chooser}${only?'':D.hubIds(w).map(section).join('')}`;}
  // Setup: what Scan found, as Configure Robot's Scan shows it: how many of each, then one list, the hubs first. Scanning adds a hub on the RS485 cable, with nothing to press.
  // scan: {expansion, servoHub, others: [{serial, type}]}, null before the first Scan. seen(id): the robot's answer for that hub. A hub Scan did not find has an × that removes it.
  // conn: {how, serial}, how this computer reaches the hub. checking: a scan is on its way. onUsb(id): the hub is on a USB cable of its own, not the RS485 one.
  // rows: what is on the hub's USB ports by Torque's own reading (DeckUsbKinds.classifyAll), which only the USB-C cable gives. Without it, over Wi-Fi say, the list is Scan's.
  // configured: the active configuration's devices on no hub, {name, tag, serial}. auto: {text, off}, something new to offer Auto-configure for. told: what Auto-configure is doing.
  function scanHtml(st,scan,{seen=()=>null,busy=false,rows=null,conn=null,checking=false,onUsb=()=>false,configured=[],auto=null,told=''}={}){const D=H(),w=st.wiring,K=globalThis.DeckUsbKinds||require('./ftc/usb-kinds.js'),U=globalThis.DeckUsbDevices||require('./sim-usb-devices.js'),R=globalThis.DeckRobotConfig||require('./ftc/robot-config.js'),shown=rows&&rows.filter(r=>!r.hidden),n=v=>scan?v:'–';
    const card=(name,note,value)=>`<div class="sim-wire-hub sim-wire-card"><b>${name}</b><p class="hint">${note}</p><div class="sim-wire-stepper"><output>${value}</output></div></div>`;
    const pill=(level,text)=>text?`<span class="rs-pill ${level}">${esc(text)}</span>`:'',row=(attrs,name,state,sub,end='',note='',action='')=>`<div class="rs-hub rs-hub-row"${attrs}><div class="rs-hub-head"><b>${esc(name)}</b>${state}</div><div class="rs-hub-end">${sub?`<span class="hint">${esc(sub)}</span>`:''}${end}</div>${note}${action}</div>`;
    const hub=id=>{const said=seen(id),name=D.hubName(id,w);return row(` data-hub-row="${id}"`,name,said?pill(said.level,said.text):'',`Address ${w.hubs[id].address}${onUsb(id)?' · on USB, not the RS485 cable':''}`,said?.missing?`<button type="button" class="icon-button rs-hub-x" data-hub-remove="${id}" aria-label="Remove ${esc(name)}" title="Remove this hub from the configuration"${busy?' disabled':''}>×</button>`:'');};
    const cable=D.hubIds(w).filter(id=>id!=='control'),hubs=`<section class="rs-hub-list" data-scan-col="hubs">${conn?row(' data-hub-row="control"',D.hubName('control',w),pill('ok','Connected'),`Over ${conn.how}${conn.serial?` · Serial ${conn.serial}`:''}`):'<p class="hint">Plug in the Control Hub and what is connected shows here by itself. Over Wi-Fi, press Scan.</p>'}${scan?cable.map(hub).join(''):conn&&checking?'<p class="hint" data-scan-empty>Looking on the RS485 cable…</p>':''}</section>`;
    // In the configuration, or not yet: only what can go in one says either.
    const inFile=(tag,key)=>configured.find(c=>c.tag===tag&&K.sameCamera(c.serial,key)),state=(tag,key)=>{const c=inFile(tag,key);return c?pill('ok',`Configured as “${c.name}”`):pill('warn','Not in the configuration');};
    const verdict=r=>r.pending||r.legal?.ok===null?pill('','Checking'):r.config==='webcam'?state('Webcam',r.scanKey):r.config==='limelight'?state('EthernetDevice',r.scanKey):r.route?'':pill(r.legal?.ok?'ok':r.legal?.sure===false||r.legal?.chip?'warn':'bad',`${U.chipWords(r.legal)}: ${r.legal?.rule}`);
    const routeHtml=r=>r.route?`<p class="rs-hub-note">${esc(r.route.text)}</p>`:'',routeBtn=r=>r.route?.tag?`<button type="button" class="secondary" data-usb-i2c="${esc(r.route.tag)}" aria-label="Set up a ${esc(r.route.label)} on an I2C port">Set up on I2C</button>`:r.route?.tab==='axon'?'<button type="button" class="secondary" data-usb-axon>Open Axon Programmer</button>':'';
    const usbRow=r=>row(` data-usb-row="${esc(r.id)}"`,r.name,verdict(r),[r.portName,r.device?.serial].filter(Boolean).join(' · '),'',routeHtml(r),routeBtn(r));
    const other=d=>row(' data-usb-row="scan"',R.usbLabel(d.type),d.type==='WEBCAM'?state('Webcam',d.serial):d.type==='ETHERNET_DEVICE'?state('EthernetDevice',d.serial):'',K.cameraLabel(d.serial));
    const list=shown?shown.map(usbRow).join(''):scan?`${(scan.others||[]).map(other).join('')}<p class="hint">Over Wi-Fi this is only what the robot’s own Scan can see. Over the USB-C cable Torque reads the ports itself.</p>`:conn?'<p class="hint" data-scan-empty>Reading the Control Hub’s USB ports…</p>':'';
    return `<div class="rs-scan"><div class="sim-wire-hubs">${card('Control Hub','What this computer is connected to.',conn?1:'–')}${card('Expansion Hubs','On the RS485 cable.',n(scan?.expansion))}${card('Servo Hubs','On the RS485 cable.',n(scan?.servoHub))}${card('USB devices','Webcams and other devices on USB.',shown?shown.length:n(scan?.others?.length))}</div>${auto?`<div class="rs-auto" data-auto-offer><span>${esc(auto.text)}</span><button type="button" class="primary" data-auto-configure${auto.off?' disabled':''}>Auto-configure</button></div>`:''}${told?`<p class="rs-told" role="status">${esc(told)}</p>`:''}${hubs}<section class="rs-hub-list" data-scan-col="usb">${list}</section></div>`;}
  // Every motor port, servo port and I2C bus of one hub with what is plugged into it, as Configure Robot shows a hub:
  // pick a device for a port and it moves there (whatever the team had put on that port goes back to Deck's choice).
  function portGrid(st,hub,ids=''){
    const D=H(),w=st.wiring,devices=st.rows.filter(r=>!['sensor','pod','imu'].includes(r.role));
    const spec=D.hubSpec(hub),fams=[['motor','Motor port',spec.motor,0],['servo','Servo port',spec.servo,0],['i2c','I2C bus',spec.i2c,hub==='control'?1:0]];
    const cells=fams.map(([fam,name,n,from])=>Array.from({length:n-from},(_,k)=>{const i=k+from,on=devices.find(r=>r.family===fam&&r.hub===hub&&(fam==='i2c'?r.bus===i:r.port===i)),id=`${ids}wire-slot-${hub}-${fam}-${i}`;
      const opts=devices.filter(r=>r.family===fam).map(r=>`<option value="${esc(r.key)}"${on?.key===r.key?' selected':''}>${esc(r.label)} · ${esc(r.name)}</option>`).join('');
      return `<div class="sim-wire-slot" data-fam="${fam}"><label for="${id}">${name} ${i}</label><select id="${id}" data-wire-slot="${hub}|${fam}|${i}"><option value="">Nothing</option>${opts}</select></div>`;}).join('')).join('');
    return `<div class="sim-wire-grid" data-hub="${hub}"><h4 class="sim-setup-group">${esc(D.hubName(hub,w))}${hub==='control'?' · I2C bus 0: its IMU':''}</h4><div class="sim-wire-slots">${cells}</div></div>`;}
  // ---- the whole configuration ----------------------------------------------------------------------------------------
  // Every port in use, hub by hub, as it goes into the robot's configuration.
  function summaryHtml(st){
    const D=H(),w=st.wiring;if(st.error)return `<p class="hint">${esc(st.error)}</p>`;
    const hubs=D.hubIds(w),rows=st.rows.filter(r=>r.hub&&!r.conflict);
    const sections=hubs.map(hub=>{const on=rows.filter(r=>r.hub===hub).sort((a,b)=>ORDER.indexOf(a.family)-ORDER.indexOf(b.family)||(a.port??a.bus)-(b.port??b.bus));
      const lines=on.map(r=>{const md=D.MODELS[r.model]||D.SENSOR_MODELS[r.model],place=r.family==='i2c'?`I2C ${r.bus}`:`${{motor:'Motor',encoder:'Encoder',servo:'Servo',analog:'Analog',digital:'Digital'}[r.family]||'Port'} ${r.port}`;
        return `<tr data-config-row="${esc(r.key)}"${problemsOf(st,r.key).some(x=>x.level==='red')?' class="red"':''}><td>${place}</td><td><code>${esc(r.via?r.via:r.name)}</code></td><td>${esc(r.label)}${r.via?' (read through this motor)':''}${r.spm?` (through Servo Power Module ${r.spm})`:''}</td><td>${esc(md?.short||(r.role==='imu'?'Built-in IMU':''))}</td><td>${r.planned?'<span class="hint">Deck picked</span>':''}</td></tr>`;});
      return `<h4 class="sim-setup-group">${esc(D.hubName(hub,w))}</h4>${lines.length?`<table class="sim-wire-table"><thead><tr><th>Port</th><th>Name</th><th>What</th><th>Model</th><th></th></tr></thead><tbody>${lines.join('')}</tbody></table>`:'<p class="hint">Nothing plugged in.</p>'}`;}).join('');
    return sections+problemLines(st.problems);}
  // ---- what to light up on the model ------------------------------------------------------------------------------------
  // The CAD parts (refs for DeckKinematics.partIndex().expand) of what is being edited: a device or sensor row (the joints it
  // moves, with the parts riding on them), a game part (intake:N, shooter:N: its joints and its named assemblies) or a
  // moving part (kin:<joint id>).
  function focusRefs(project,target){
    const p=project||{},joints=p.kinematics?.joints||[],named=p.model?.parts||[],m=p.mechanisms||{},out=new Set();if(typeof target!=='string'||!target)return [];
    // A device whose transmission was traced in the CAD: its motor or servo, the train, and what that turns.
    {const t=/^shooters\.([0-9])\.turretMotor2?$/.exec(target);if(t){const n=+t[1],of=`shooter:${n&&m.shooters?.[n]?.sharesTurret?0:n}`,mine=joints.filter(j=>j.drive?.signal==='turret'&&j.drive.of===of),gears=joints.filter(j=>mine.some(x=>String(j.id).startsWith(x.id+'gear')));
      const plate=new Set(mine.flatMap(j=>j.parts||[])),train=[...gears.flatMap(j=>j.parts||[]),...(m.power?.[target]?.refs||[]).filter(r=>!plate.has(r))];if(gears.length&&train.length)return [...new Set(train)];}}
    if(m.power?.[target]?.refs?.length)return m.power[target].refs;
    const joint=id=>{const ids=[id];for(let i=0;i<ids.length;i++)for(const j of joints)if(j.parent===ids[i]&&!ids.includes(j.id))ids.push(j.id);for(const x of ids)for(const r of joints.find(j=>j.id===x)?.parts||[])out.add(r);};
    const names=list=>{for(const n of list||[]){const part=named.find(q=>q.name===n);if(part?.key)out.add(part.key);}};
    const game=(kind,n)=>{const of=`${kind}:${n}`,list=m[kind+'s']?.[n]?.parts||[],own=kind==='shooter'?list.filter(x=>!/turret/i.test(x)):list;for(const j of joints)if(j.drive?.of===of&&!(kind==='shooter'&&j.drive.signal==='turret'))joint(j.id);names(own.length?own:list);};
    let k;if((k=/^kin:(.+)$/.exec(target)))joint(k[1]);else if((k=/^(intake|shooter):([0-9])$/.exec(target)))game(k[1],+k[2]);
    else{const row=state(p).rows.find(r=>r.key===target);if(row?.joints?.length)for(const id of row.joints)joint(id);else{const g=/^(intakes|shooters)[.]([0-9])[.]/.exec(row?.for||target);if(g)game(g[1].slice(0,-1),+g[2]);}}
    return [...out];}
  // ---- changes --------------------------------------------------------------------------------------------------------
  // Each returns the new wiring for project.robot.wiring (null when nothing is set).
  const parsePort=(v,family)=>{if(!v)return null;const [hub,n]=v.split(':');return family==='i2c'?{hub,bus:+n}:{hub,port:+n};};
  function setDevice(wiring,key,change){const D=H(),w=D.wiringOf({wiring}),e={...(w.devices[key]||{})};change(e);for(const k of Object.keys(e))if(e[k]===undefined||e[k]===null||e[k]==='')delete e[k];
    const devices={...w.devices};if(Object.keys(e).length)devices[key]=e;else delete devices[key];return D.sanitizeWiring({...w,devices});}
  const setModel=(wiring,key,model)=>setDevice(wiring,key,e=>{e.model=model||undefined;});
  const setFrom=(wiring,key,text)=>setDevice(wiring,key,e=>{e.from=text||undefined;});
  // A sensor of model `model` on the device row, named after it ("turretAxonFeedback"), used for what its role reads with it.
  function addSensor(wiring,row,model){const D=H(),w=D.wiringOf({wiring}),allowed=D.ROLES[row?.role]?.sensors||{},md=D.SENSOR_MODELS[model];if(!md||!row?.key)return D.sanitizeWiring(w);
    let id=`${row.name||'sensor'}${md.kind[0].toUpperCase()}${md.kind.slice(1)}`.replace(/[^\w-]/g,'').slice(0,28),n=1;if(!/^[A-Za-z]/.test(id))id='s'+id;while(w.sensors.some(s=>s.id===id))id=`${id.slice(0,26)}${++n}`;
    return D.sanitizeWiring({...w,sensors:[...w.sensors,{id,model,for:row.key,...(allowed[md.kind]&&md.measures.includes(allowed[md.kind])?{use:allowed[md.kind]}:{})}]});}
  const setRatio=(wiring,key,ratio)=>setDevice(wiring,key,e=>{e.ratio=ratio>0&&ratio!==1?ratio:undefined;});
  // A port on an Expansion Hub the robot did not have yet gives it one first (a device, a sensor or a module's encoder).
  const withHub=(wiring,p)=>{const D=H();return p&&D.hubKind(p.hub)==='expansion'&&!D.hubsOfKind(D.wiringOf({wiring}).hubs,'expansion').includes(p.hub)?setHub(wiring,p.hub,true):wiring;};
  const setPort=(wiring,key,value,family)=>{const p=parsePort(value,family);return setDevice(withHub(wiring,p),key,e=>{delete e.hub;delete e.port;delete e.bus;Object.assign(e,p||{});});};
  function setHub(wiring,hub,on,address){const D=H(),w=D.wiringOf({wiring});return D.sanitizeWiring({...w,hubs:{...w.hubs,[hub]:on?{address:address??w.hubs[hub]?.address??D.hubSpec(hub).address}:hub==='expansion'?false:null}});}
  // How many hubs of a kind the robot has: new ones take the next free address from 1 up (a Servo Hub's default 3 first),
  // and the last ones go first, their devices back to Deck's choice. Choosing a number makes the robot a custom one.
  // A kind's hubs are numbered by address, as a configuration read from the robot numbers them, so the hub Setup means is the
  // same one on the robot. When an address change breaks that order, the hubs swap ids and their devices and sensors follow.
  function inAddressOrder(w,kind){const D=H(),ids=D.hubsOfKind(w.hubs,kind),byAddress=[...ids].sort((a,b)=>w.hubs[a].address-w.hubs[b].address);if(ids.every((id,i)=>id===byAddress[i]))return w;
    const to=Object.fromEntries(byAddress.map((id,i)=>[id,ids[i]])),hubs={...w.hubs};for(const id of ids)hubs[to[id]]=w.hubs[id];const move=e=>to[e.hub]?{...e,hub:to[e.hub]}:e;
    return {...w,hubs,devices:Object.fromEntries(Object.entries(w.devices).map(([k,e])=>[k,move(e)])),sensors:w.sensors.map(move)};}
  function setHubCount(wiring,kind,n){const D=H(),w=D.wiringOf({wiring}),now=D.hubsOfKind(w.hubs,kind),want=Math.max(0,Math.min(D.MAX_CHAINED,Math.round(+n)||0)),hubs={...w.hubs,layout:'custom'},used=new Set(Object.values(w.hubs).map(h=>h?.address));
    for(const id of now.slice(want))delete hubs[id];if(!want&&kind==='expansion')hubs.expansion=false;
    for(let i=now.length;i<want;i++){const id=D.hubId(kind,i+1),all=[1,2,3,4,5,6,7,8,9,10],last=Math.max(D.HUBS[kind].address-1,...now.slice(0,i).map(k=>hubs[k]?.address||0),...Array.from({length:i},(_,k)=>hubs[D.hubId(kind,k+1)]?.address||0));let a=all.find(x=>x>last&&!used.has(x))??all.find(x=>!used.has(x));if(a===undefined)break;used.add(a);hubs[id]={address:a};}
    return D.sanitizeWiring(inAddressOrder({...w,hubs},kind));}
  const setHubAddress=(wiring,id,address)=>{const D=H(),w=D.wiringOf({wiring}),others=Object.entries(w.hubs).filter(([k,h])=>k!==id&&h?.address).map(([,h])=>h.address),a=Math.round(+address);if(!(a>=1&&a<=10)||others.includes(a))return D.sanitizeWiring(w);return D.sanitizeWiring(inAddressOrder({...w,hubs:{...w.hubs,[id]:{...w.hubs[id],address:a}}},D.hubKind(id)));};
  // The number the team calls a hub by: a hub already called that swaps with it, so each number means one hub.
  function setHubLabel(wiring,id,n){const D=H(),w=D.wiringOf({wiring}),hubs={...w.hubs},label=+n||0,kind=D.hubKind(id),was=hubs[id]?.label;
    for(const other of D.hubsOfKind(hubs,kind))if(other!==id&&label&&hubs[other].label===label){const {label:_,...rest}=hubs[other];hubs[other]=was?{...rest,label:was}:rest;}
    const {label:_,...me}=hubs[id]||{};hubs[id]=label?{...me,label}:me;return D.sanitizeWiring({...w,hubs});}
  const setSpmCount=(wiring,n)=>{const D=H(),w=D.wiringOf({wiring}),want=Math.max(0,Math.min(D.MAX_SPM,Math.round(+n)||0)),hubs={...w.hubs};if(want)hubs.spm=want;else delete hubs.spm;return D.sanitizeWiring({...w,hubs});};
  const setSpm=(wiring,key,n)=>setDevice(wiring,key,e=>{e.spm=+n||undefined;});
  // A device picked for one port: it moves there, and a device the team had put on that port goes back to Deck's choice.
  function setSlot(wiring,st,hub,fam,i,key){let w=wiring;const on=st.rows.find(r=>r.family===fam&&r.hub===hub&&(fam==='i2c'?r.bus===i:r.port===i)&&r.role!=='sensor'&&r.role!=='pod');
    if(on&&on.key!==key&&on.wired)w=setPort(w,on.key,'',fam);if(key)w=setPort(w,key,`${hub}:${i}`,fam);return w;}
  function setSensor(wiring,id,change){const D=H(),w=D.wiringOf({wiring});return D.sanitizeWiring({...w,sensors:w.sensors.map(s=>{if(s.id!==id)return s;const e={...s};change(e,D.SENSOR_MODELS[s.model]);return e;}).filter(Boolean)});}
  const removeSensor=(wiring,id)=>{const D=H(),w=D.wiringOf({wiring});return D.sanitizeWiring({...w,sensors:w.sensors.filter(s=>s.id!==id)});};
  const setSensorPort=(wiring,id,value)=>{const D=H(),s=D.wiringOf({wiring}).sensors.find(x=>x.id===id),md=s&&D.SENSOR_MODELS[s.model];return setSensor(md?withHub(wiring,parsePort(value,md.family)):wiring,id,(e,m)=>{delete e.hub;delete e.port;delete e.bus;Object.assign(e,parsePort(value,m.family)||{});});};
  // Binds a host's controls: every change calls apply(newWiring).
  function bind(host,{project,apply,focus,setKind,share,setRpm,assign}){
    host.addEventListener('change',e=>{const el=e.target,d=el.dataset,w=project().robot.wiring,st=state(project());let next;
      if(d.wireAssign){if(assign)assign(d.wireAssign,el.value);return;}
      if(d.wireRatio){const v=+el.value;if(v>0)apply(setRatio(w,d.wireRatio,v));return;}
      if(d.wireShare){if(share)share(d.wireShare,el.value||null);return;}
      if(d.wireRpm){const v=+el.value;if(setRpm&&v>0)setRpm(d.wireRpm,v);return;}
      if(d.wireModel)next=setModel(w,d.wireModel,el.value);
      else if(d.wirePort){const row=st.rows.find(r=>r.key===d.wirePort);
        // A port of its own again gives it a name of its own.
        if(row&&sharedWith(row,st)&&share)share(d.wirePort,null);next=setPort(project().robot.wiring,d.wirePort,el.value,row?.family);}
      else if(d.wireHub)next=setHub(w,d.wireHub,el.checked);
      else if(d.wireHubAddress)next=setHubAddress(w,d.wireHubAddress,el.value);
      else if(d.wireHubLabel)next=setHubLabel(w,d.wireHubLabel,el.value);
      else if(d.wireSpm)next=setSpm(w,d.wireSpm,el.value);
      else if(d.wireSlot){const [hub,fam,i]=d.wireSlot.split('|');next=setSlot(w,st,hub,fam,+i,el.value);}
      else if(d.wireKind){if(setKind)setKind(d.wireKind,el.value);return;}
      else if(d.wireSensorAdd){if(!el.value)return;next=addSensor(w,st.rows.find(r=>r.key===d.wireSensorAdd)||{key:d.wireSensorAdd},el.value);}
      else if(d.wireSensorUse)next=setSensor(w,d.wireSensorUse,s=>{s.use=el.value;});
      else if(d.wireSensorPort)next=setSensorPort(w,d.wireSensorPort,el.value);
      else if(d.wireSensorAssign)next=assignSensor(w,d.wireSensorAssign,el.value);
      else if(d.wireSensorPick)next=setMechSensor(w,st.rows.find(r=>r.key===d.wireSensorPick)||{key:d.wireSensorPick},el.value);
      else if(d.wireChassisEncoder){const [at,name]=el.value.split('|');next=setChassisEncoder(w,st.rows.find(r=>r.key===d.wireChassisEncoder)||{key:d.wireChassisEncoder},at,name);}
      else return;apply(next);});
    host.addEventListener('click',e=>{const w=project().robot.wiring,s=e.target.closest('[data-wire-hub-step]');
      if(s){const D=H(),hubs=D.wiringOf({wiring:w}).hubs,kind=s.dataset.wireHubStep,dir=+s.dataset.step;apply(kind==='spm'?setSpmCount(w,(hubs.spm||0)+dir):setHubCount(w,kind,D.hubsOfKind(hubs,kind).length+dir));return;}
      const b=e.target.closest('[data-wire-sensor-remove]');if(b)apply(removeSensor(w,b.dataset.wireSensorRemove));});
    if(focus)host.addEventListener('focusin',e=>{const r=e.target.closest('[data-wire-row]');if(r)focus(r.dataset.wireRow);});}
  return {state,stepOf,focusRefs,sharedWith,shareable,TYPES,typeOf,setSlot,portGrid,red,problemsOf,modelChoices,portChoices,deviceHtml,chassisHtml,senseHtml,imuHtml,setChassisEncoder,mechRowHtml,linkHtml,linked,assignSensor,setMechSensor,sensorsHtml,hubsHtml,scanHtml,summaryHtml,readoutHtml,setModel,setRatio,setFrom,addSensor,setPort,setHub,setHubCount,setHubAddress,setHubLabel,setSpmCount,setSpm,setSensor,setSensorPort,removeSensor,bind,esc};
});
