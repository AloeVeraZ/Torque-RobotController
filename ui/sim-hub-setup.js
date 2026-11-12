(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DeckHubSetup=api;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // One-button setup from the Control Hub: the robot's active configuration (read over USB) is matched to everything Setup
  // wires (drive motors, the IMU and position sensor, each mechanism's motors and servos, their sensors), by name and by
  // kind, and each match takes the robot's name, hub and port, and its motor type when that names one model. The robot's
  // position sensor (a Pinpoint or an OTOS) sets the localization, and its Expansion Hub is turned on at its address.
  // plan() only decides; apply() returns the changed project. Shared by Setup and the tests.
  const g=name=>globalThis[name]||(typeof require==='function'?require({DeckHardware:'./sim-hardware.js',DeckWiring:'./sim-wiring.js',DeckRobotConfig:'./ftc/robot-config.js',DeckSimConfig:'./sim-config.js',DeckMechanisms:'./sim-mechanisms.js',DeckKinematics:'./sim-kinematics.js'}[name]):null);
  const DIRS=new Set(['front','back','left','right','center','centre']),DRIVE_WORDS=/^(steer|turn|swerve|azimuth|angle|rot\w*|dt|chassis|base|mecanum|tank|module|mod|\d)$/;
  // Words that say what a sensor is, not what it is on ("liftHome" is the lift's limit switch).
  const SENSOR_WORDS=new Set(['sensor','home','limit','switch','touch','button','color','colour','distance','dist','range','tof','pot','potentiometer','encoder','enc','abs','absolute','analog','magnet','magnetic','piece','position','pos','feedback','beam','break','v3']);
  const ACT_KINDS={motor:['motor'],servo:['servo'],crservo:['crservo'],motorOrCr:['motor','crservo'],linear:['servo']};
  // What a role may run on, as RobotConfig kinds: a roller on a motor or a continuous servo, a feeder also on a servo...
  const ROLE_KINDS={roller:['motor','crservo'],feeder:['motor','crservo','servo'],turret:['motor','servo','crservo'],steer:['crservo','servo','motor']};
  const SENSOR_KINDS=new Set(['touch','digital','analog','color','distance']);
  // The words (as RobotConfig.tokens gives them: "flywheel" reads "shooter") that name a mechanism device's job.
  const ROLE_SAYS={flywheel:/^(shooter|flywheel|fly|launcher|launch|shoot)$/,feeder:/^(feed|feeder|indexer|index|kicker|kick|transfer|push|pusher|gate)$/,turret:/^(turret|turntable)$/,hood:/^hood$/,roller:/^(intake|roller|sweeper)$/};
  const words=name=>g('DeckRobotConfig').tokens(name);
  const dirsOf=t=>t.filter(w=>DIRS.has(w)).map(w=>w==='centre'?'center':w).sort().join(' ');
  // The configuration's hubs under Setup's ids: control, expansion, expansion2.. by address, servoHub, servoHub2.. by address.
  function hubsOf(config){
    const lynx=(config.hubs||[]).filter(h=>h.tag==='LynxModule'&&Number.isFinite(h.address)),servo=(config.hubs||[]).filter(h=>h.tag==='ServoHub'&&Number.isFinite(h.address));
    const control=lynx.find(h=>h.parent)||lynx.find(h=>h.address===173)||lynx[0]||null,others=lynx.filter(h=>h!==control).sort((a,b)=>a.address-b.address);
    const ids=[...(control?[['control',control]]:[]),...others.map((h,i)=>[g('DeckHardware').hubId('expansion',i+1),h]),...[...servo].sort((a,b)=>a.address-b.address).map((h,i)=>[g('DeckHardware').hubId('servoHub',i+1),h])];
    return {control,ids,expansion:others[0]||null,servoHub:ids.find(([id])=>id==='servoHub')?.[1]||null};}
  function placeOf(dev,hubs){const m=dev.module;if(!m)return null;const hub=hubs.ids.find(([,h])=>h.address===m.address&&(h.portal||'')===(m.portal||'')&&(h.tag==='ServoHub')===!!m.servoHub)?.[0];if(!hub)return null;
    return dev.bus!==undefined?{hub,bus:dev.bus}:Number.isInteger(dev.port)?{hub,port:dev.port}:null;}
  // A moving part runs on whatever the robot has it on: the robot's configuration decides motor or servo, and which servo.
  const kindsFor=row=>/^kin\./.test(row.key)&&row.role!=='sensor'?['motor','servo','crservo']:ROLE_KINDS[row.role]||ACT_KINDS[row.need]||[row.need];
  // How well a robot device fits one of Setup's rows: 0 is no match. A drive motor matches on its direction words alone
  // (frontLeft, FL, left_front_drive); anything else on the words its name shares with the row's name and label, never
  // across sides (leftLift is not rightLift).
  // hint: more words for a mechanism's device, from its CAD (the assemblies it is in, "POLLEN V2") and the pieces a
  // shooter takes, so pollenFlywheel goes to the pollen shooter's flywheel, not the nectar one's.
  function score(row,dev,hint=[]){
    if(!kindsFor(row).includes(dev.kind)&&!(row.role==='sensor'&&g('DeckRobotConfig').fits(row.need,dev.kind)))return 0;
    if(dev.name===row.name)return 100;if(dev.name.toLowerCase()===row.name.toLowerCase())return 95;
    const dt=words(dev.name),rt=[...new Set([...words(row.name),...(row.role==='drive'||row.role==='steer'?[]:[...words(row.label),...hint])])];
    if(row.role==='drive'||row.role==='steer'){const want=dirsOf(words(row.key.slice(6))),have=dirsOf(dt);if(!want||want!==have)return 0;
      const steerish=dt.some(w=>/^(steer|turn|swerve|azimuth|angle|rot)/.test(w));if(steerish!==(row.role==='steer'))return 0;
      // Any other word says it is something else (leftLift, frontIntake), unless it is one teams put on drive motors.
      return dt.some(w=>!DIRS.has(w)&&!DRIVE_WORDS.test(w))?0:80;}
    if(['imu','pinpoint','otos'].includes(row.role))return 70;
    const a=dirsOf(dt),b=dirsOf(rt);if(a&&b&&a!==b)return 0;
    const base=row.role==='sensor'?dt.filter(w=>!SENSOR_WORDS.has(w)):dt,shared=base.filter(w=>rt.includes(w)).length;if(!shared)return 0;
    // A name that says what the device does picks that device of a mechanism (pollenFlywheel is the flywheel, not the feeder).
    return 20+Math.round(40*shared/new Set([...base,...rt]).size)+(ROLE_SAYS[row.role]&&dt.some(w=>ROLE_SAYS[row.role].test(w))?10:0);}
  // A sensor the robot has that Setup does not: put it on the device its name is about, as the model its type says.
  function sensorFor(dev,rows){
    const H=g('DeckHardware'),dt=words(dev.name).filter(w=>!SENSOR_WORDS.has(w)),n=dev.name.toLowerCase();
    const models=H.SENSORS.filter(m=>m.xmlType===dev.tag||dev.kind==='digital'&&m.xmlType==='DigitalDevice'||dev.kind==='analog'&&m.xmlType==='AnalogInput');
    let best=null;
    for(const row of rows){if(['sensor','pod','imu','pinpoint','otos'].includes(row.role))continue;const allowed=H.ROLES[row.role]?.sensors||{};
      const rt=[...new Set([...words(row.name),...words(row.label)])],shared=dt.filter(w=>rt.includes(w)).length;if(!shared)continue;
      // The side is the one in the name the robot uses (leftPodS), before Setup's label for the slot (Back left steering).
      const a=dirsOf(dt),b=dirsOf(words(row.name))||dirsOf(rt);if(a&&b&&a!==b)continue;
      const fit=models.filter(m=>Object.hasOwn(allowed,m.kind)).sort((x,y)=>hint(y,n)-hint(x,n));if(!fit.length)continue;
      // A swerve module's analog sensor is its steering's absolute encoder, though the drive motor's name is closer (frontPodE: frontPod, frontPodS).
      const s=shared/new Set([...dt,...rt]).size+(row.role==='steer'&&dev.kind==='analog'?1:0);if(!best||s>best.s)best={s,row,model:fit[0],use:allowed[fit[0].kind]};}
    return best;}
  const hint=(m,n)=>(/pot/.test(n)&&m.kind==='potentiometer'||/axon/.test(n)&&m.kind==='axonFeedback'||/magnet/.test(n)&&m.kind==='magnetic'||/(limit|switch)/.test(n)&&m.kind==='limit'||/v2/.test(n)&&/v2/.test(m.id)||/(abs|bore)/.test(n)&&m.kind==='analogAbs'?1:0);
  // The model a configured motor or servo type names, when it names only one (goBILDA5202SeriesMotor is every Yellow
  // Jacket ratio, so that keeps Setup's model).
  function modelOf(row,dev){const H=g('DeckHardware'),now=H.MODELS[row.model];if(now&&now.xmlType===dev.tag)return null;
    const twin=now&&(now.cr?H.MODELS[now.cr]:H.ACTUATORS.find(m=>m.cr===now.id));if(twin&&twin.xmlType===dev.tag)return twin.id;
    const list=H.ACTUATORS.filter(m=>m.xmlType===dev.tag&&(H.ROLES[row.role]?.kinds||[]).includes(m.kind));return list.length===1?list[0].id:null;}
  // What the robot's configuration says is plugged in, device by device, whether Setup uses it or not: kept with the read so
  // Calibrate can show the hub's own answer. hubName only for a device on a hub Setup does not wire.
  function readout(config){const hubs=hubsOf(config||{});
    return (config?.devices||[]).filter(d=>d.module||d.kind==='imu').map(d=>{const at=placeOf(d,hubs);
      return {name:d.name,kind:d.kind,tag:d.tag,...(at||{hubName:d.hub||'',...(d.bus!==undefined?{bus:d.bus}:{}),...(Number.isInteger(d.port)?{port:d.port}:{})})};});}
  const LOCALIZATION={pinpoint:'fused',otos:'optical'};
  // project: Setup's project; config: {devices, hubs} (RobotConfig.parse of the active configuration).
  // only: 'chassis' matches the drivetrain and the IMU alone (a preset robot, whose mechanisms are its own).
  function plan(project,config,{only}={}){
    const W=g('DeckWiring'),devices=(config?.devices||[]).filter(d=>d.module||d.kind==='imu'),hubs=hubsOf(config||{}),chassis=only==='chassis',out={localization:null,assign:[],sensors:[],missing:[],dropped:[],unused:[],notes:[],hubs:{}};
    // The position sensor first: it decides which rows Setup has.
    let p=project;const loc=['pinpoint','otos'].map(k=>devices.some(d=>d.kind===k)?LOCALIZATION[k]:null).find(Boolean);
    out.sensing={localization:loc||project.sensors?.localization||null,hubImu:devices.some(d=>d.kind==='imu')};
    if(!chassis&&loc&&project.controller==='ftc'&&project.sensors?.localization!==loc){out.localization=loc;p={...project,sensors:{...project.sensors,localization:loc}};}
    const rows=W.state(p).rows.filter(r=>r.role!=='pod'&&(!chassis||W.stepOf(r.key)==='robot'&&!['pinpoint','otos'].includes(r.role)));
    out.hubs.expansion=false;for(const [id,h] of hubs.ids)if(id!=='control')out.hubs[id]={address:h.address};
    // Every fitting pair, best first; each row and each device is used once.
    const hintOf=row=>{const k=g('DeckHardware').parseKey(row.key),part=k?.list?p.mechanisms?.[k.list]?.[k.index]:null;
      return [...(row.parts||[]),['pollen','nectar'].includes(part?.pieces)?part.pieces:''].flatMap(n=>words(String(n).replace(/\s*<\d+>$/,''))).filter(w=>w.length>2&&!DIRS.has(w)&&!/\d/.test(w));};
    const pairs=[];for(const row of rows){const hint=hintOf(row);for(const dev of devices){const s=score(row,dev,hint);if(s>0)pairs.push({row,dev,s});}}
    pairs.sort((a,b)=>b.s-a.s||a.row.key.localeCompare(b.row.key)||a.dev.name.localeCompare(b.dev.name));
    const doneRow=new Set(),doneDev=new Set();
    for(const {row:first,dev,s} of pairs){if(doneRow.has(first.key)||doneDev.has(dev))continue;doneDev.add(dev);
      const mates=['sensor','pod','imu'].includes(first.role)?[]:rows.filter(r=>r!==first&&!doneRow.has(r.key)&&r.name===first.name&&r.family===first.family&&kindsFor(r).includes(dev.kind));
      for(const row of [first,...mates]){doneRow.add(row.key);
        const at=row.role==='imu'?null:placeOf(dev,hubs),model=row.role==='sensor'?null:modelOf(row,dev),kind=kindsFor(row).includes(dev.kind)&&!(ACT_KINDS[row.need]||[row.need]).includes(dev.kind)?dev.kind:null;
        out.assign.push({key:row.key,label:row.label,name:dev.name,was:row.name,family:row.family,tag:dev.tag,exact:s>=95,...(row===first?{}:{shared:first.label}),...(at||{}),...(model?{model}:{}),...(kind?{kind}:{}),...(row.role==='sensor'?{sensor:row.id}:{})});}}
    // Two of Setup's sensors under one name are one device on the robot: the copy on the wrong owner goes (an absolute
    // encoder is the steering's, not the drive motor's), instead of being reported as missing from the robot.
    const pref=r=>rows.find(x=>x.key===r.for)?.role==='steer'&&r.family==='analog'?1:0;
    for(const row of rows){if(doneRow.has(row.key)||row.role!=='sensor')continue;
      const a=out.assign.find(x=>x.sensor&&x.name.toLowerCase()===row.name.toLowerCase()),twin=a&&rows.find(r=>r.key===a.key);if(!twin||twin.family!==row.family||pref(row)===pref(twin))continue;
      doneRow.add(row.key);
      if(pref(row)>pref(twin)){out.dropped.push({id:twin.id,label:twin.label,name:a.name,kept:row.label});Object.assign(a,{key:row.key,label:row.label,was:row.name,sensor:row.id});}
      else out.dropped.push({id:row.id,label:row.label,name:a.name,kept:twin.label});}
    for(const row of rows)if(!doneRow.has(row.key)&&row.role!=='imu')out.missing.push({key:row.key,label:row.label,name:row.name});
    // Chassis only: the robot's mechanism devices are none of Setup's business, so only a leftover drive-like motor is listed.
    for(const dev of devices){if(doneDev.has(dev)||!['motor','servo','crservo',...SENSOR_KINDS].includes(dev.kind)||chassis&&!(dev.kind==='motor'&&dirsOf(words(dev.name))))continue;
      const fit=!chassis&&SENSOR_KINDS.has(dev.kind)?sensorFor(dev,rows):null,at=placeOf(dev,hubs);
      if(fit&&at){doneDev.add(dev);out.sensors.push({name:dev.name,model:fit.model.id,for:fit.row.key,forLabel:fit.row.label,use:fit.use,...at});continue;}
      out.unused.push({name:dev.name,kind:dev.kind,where:`${dev.hub||''}${dev.bus!==undefined?` I2C bus ${dev.bus}`:dev.port!==undefined?` port ${dev.port}`:''}`.trim()});}
    return out;}
  // The project with the plan in it: names where Setup keeps them (robot.devices, a mechanism's field, a moving part's
  // actuator), ports and models in robot.wiring, new sensors, hubs and the localization.
  function apply(project,result){
    const H=g('DeckHardware'),W=g('DeckWiring'),C=g('DeckSimConfig'),MECH=g('DeckMechanisms'),K=g('DeckKinematics'),p=structuredClone(project);
    if(result.localization)p.sensors={...p.sensors,localization:result.localization};
    // The robot's configuration says which hubs there are; Setup's choice of layout and Servo Power Modules stay.
    const was=H.wiringOf({wiring:p.robot.wiring}).hubs,count=H.hubIds({hubs:result.hubs}).length-1,lone=result.hubs.expansion&&count===1;
    let w=H.sanitizeWiring({...H.wiringOf({wiring:p.robot.wiring}),hubs:{...result.hubs,...(was.spm?{spm:was.spm}:{}),layout:lone?'stack':'custom'}});
    const devices={...(p.robot.devices||{})};
    if(result.dropped?.length){const cur=H.wiringOf({wiring:w}),gone=new Set(result.dropped.map(d=>d.id));w=H.sanitizeWiring({...cur,sensors:cur.sensors.filter(x=>!gone.has(x.id))});}
    for(const a of result.assign){const k=H.parseKey(a.key);if(!k)continue;
      if(a.sensor){w=H.sanitizeWiring({...H.wiringOf({wiring:w}),sensors:H.wiringOf({wiring:w}).sensors.map(s=>s.id===a.sensor?{...s,name:a.name,...(a.hub?{hub:a.hub,...(a.bus!==undefined?{bus:a.bus}:{port:a.port})}:{})}:s)});continue;}
      if(k.robot)devices[k.robot]={...(devices[k.robot]||{}),name:a.name};
      else if(k.list&&/^more[0-9]$/.test(k.field)){const x=p.mechanisms[k.list]?.[k.index]?.more?.[+k.field.slice(4)];if(x){x.name=a.name;if(a.kind&&x.device!=='servo')x.device=a.kind==='crservo'?'crservo':'motor';}}
      else if(k.list){const part=p.mechanisms[k.list]?.[k.index];if(part){part[k.field]=a.name;
        if(a.kind&&k.list==='intakes'&&/^motor2?$/.test(k.field))part.device=a.kind==='crservo'?'crservo':'motor';
        if(a.kind&&k.field==='indexer')part.indexerKind={motor:'motor',crservo:'crservo',servo:'pusher'}[a.kind];
        if(a.kind&&k.field==='turretMotor')p.mechanisms.turret.kind=a.kind==='servo'?'servo':a.kind==='crservo'?'crservo':'motor';}}
      else if(k.kin){const at=(globalThis.DeckKinematics||require('./sim-kinematics.js')).deviceAt(p.kinematics.actuators,k.kin),act=at?.actuator;if(act){(globalThis.DeckKinematics||require('./sim-kinematics.js')).nameDevice(act,at.n,a.name);if(a.kind&&at.n===1){const was=act.kind;act.kind={motor:'dcmotor',servo:'servo',crservo:'crservo'}[a.kind]||act.kind;if(act.kind!==was)delete act.model;}}}
      if(a.hub&&a.family)w=W.setPort(w,a.key,a.family==='i2c'?`${a.hub}:${a.bus}`:`${a.hub}:${a.port}`,a.family);
      if(a.model)w=W.setModel(w,a.key,a.model);}
    if(result.sensors.length){const cur=H.wiringOf({wiring:w}),ids=new Set(cur.sensors.map(s=>s.id)),add=[];
      for(const s of result.sensors){let id=s.name.replace(/[^\w-]/g,'').slice(0,28)||'sensor';if(!/^[A-Za-z]/.test(id))id='s'+id;for(let n=2;ids.has(id);n++)id=`${id.slice(0,26)}${n}`;ids.add(id);
        add.push({id,model:s.model,for:s.for,use:s.use,name:s.name,hub:s.hub,...(s.bus!==undefined?{bus:s.bus}:{port:s.port})});}
      w=H.sanitizeWiring({...cur,sensors:[...cur.sensors,...add]});}
    p.robot=C.robot({...p.robot,devices,wiring:w},p.controller);p.mechanisms=MECH.sanitize(p.mechanisms);p.kinematics=K.sanitize(p.kinematics);
    return p;}
  // One sentence for the status line, and one line a match for the list under it.
  function summary(result){const n=result.assign.length+result.sensors.length;
    return n?`Set up from the Control Hub: ${n} device${n===1?'':'s'} matched${result.missing.length?`, ${result.missing.length} Setup device${result.missing.length===1?'':'s'} not on the robot`:''}${result.unused.length?`, ${result.unused.length} on the robot Setup has nothing for`:''}.`:'Nothing on the Control Hub matches what this setup has. Name its devices as the robot does (frontLeft, lift, claw…), or add the mechanisms first.';}
  function lines(result){const where=a=>a.hub?` · ${g('DeckHardware').hubName(a.hub,{hubs:result.hubs})} ${a.bus!==undefined?`I2C bus ${a.bus}`:`port ${a.port}`}`:'';
    const s=result.sensing,sensing=s?.localization==='fused'?`Sensing: the Pinpoint reads its 2 goBILDA odometry pods and turns with its own IMU${s.hubImu?'; the Control Hub’s IMU is used too, as the heading backup if the Pinpoint stops answering':''}`:s?.localization==='optical'?`Sensing: the OTOS tracks position with its own IMU${s.hubImu?'; the Control Hub’s IMU is on the robot too':''}`:s?.hubImu?'Sensing: the Control Hub’s built-in IMU measures turning':'';
    return [...(sensing?[{level:'ok',text:sensing}]:[]),...result.assign.map(a=>({level:a.exact?'ok':'guess',text:`${a.label} → “${a.name}”${where(a)}${a.shared?` (the same motor as ${a.shared.toLowerCase()}: belted together)`:a.was!==a.name?` (was “${a.was}”)`:''}`})),
      ...result.sensors.map(s=>({level:'ok',text:`New sensor on ${s.forLabel} → “${s.name}”${where(s)}`})),
      ...(result.localization?[{level:'ok',text:`Position sensor: ${result.localization==='fused'?'goBILDA Pinpoint':'SparkFun OTOS'} (the robot has one)`}]:[]),
      ...(result.dropped||[]).map(d=>({level:'ok',text:`${d.label} was a second copy of “${d.name}”: removed, it is ${d.kept}`})),
      ...result.missing.map(m=>({level:'missing',text:`${m.label} (“${m.name}”) is not on the robot: Send to robot can add it`})),
      ...result.unused.map(u=>({level:'unused',text:`“${u.name}” (${u.kind}${u.where?', '+u.where:''}) is on the robot; nothing in Setup uses it`})),
      ...result.notes.map(t=>({level:'missing',text:t}))];}
  // The configuration with every hub the robot reported that it does not list, so all of them get Setup's ids together.
  // portals: RobotConfig.lynxModules answers.
  function withScan(config,portals){const hubs=[...(config?.hubs||[])],has=(a,portal)=>hubs.some(h=>h.address===a&&(h.portal||'')===(portal||''));
    for(const p of portals||[]){for(const m of p.modules||[])if(!has(m.address,p.serial))hubs.push({name:m.parent?'Control Hub':`Expansion Hub ${m.address}`,address:m.address,tag:'LynxModule',portal:p.serial,parent:!!m.parent});
      for(const h of p.servoHubs||[])if(!has(h.address,p.serial))hubs.push({name:`Servo Hub ${h.address}`,address:h.address,tag:'ServoHub',portal:p.serial,parent:false});}
    return {devices:[],...config,hubs};}
  // One line on a hub: what the robot reported and what its configuration says. null until the robot was asked.
  // checking: answers are still coming, so a hub not seen yet is not called missing. missing: Scan finished without it.
  function hubSeen(address,{scanned,configured,checking}){if(!scanned)return null;const on=scanned.includes(address),in_=configured.includes(address);
    if(!on&&checking)return {level:'',text:'Checking…'};
    return on&&in_?{level:'ok',text:'Connected'}:on?{level:'warn',text:'Connected, not in the configuration'}:in_?{level:'bad',text:'In the configuration, not found',missing:true}:{level:'warn',text:'Not found',missing:true};}
  // A hub's address and kind say which hub it is unless two of one kind look alike. Returns the kinds to tell apart.
  function needsTest(wiring){const D=g('DeckHardware'),w=D.wiringOf({wiring});return ['expansion','servoHub'].filter(kind=>D.hubsOfKind(w.hubs,kind).length>1);}
  // The test: for each hub that could be mistaken for another, one output to move, a motor first, then a servo. read: the
  // hub's read-out (readout()). A hub with nothing configured on it has nothing to move (device null).
  function testSteps(read,wiring){const D=g('DeckHardware'),w=D.wiringOf({wiring}),rank={motor:0,crservo:1,servo:2},cmd={motor:'M',crservo:'C',servo:'S'};
    return needsTest(w).flatMap(kind=>D.hubsOfKind(w.hubs,kind).map(hub=>{const d=(read||[]).filter(x=>x.hub===hub&&rank[x.kind]!==undefined).sort((a,b)=>rank[a.kind]-rank[b.kind]||a.port-b.port)[0];
      return {hub,kind,address:w.hubs[hub].address,device:d?{name:d.name,kind:d.kind,port:d.port,command:cmd[d.kind]}:null};}));}
  return {plan,apply,summary,lines,score,hubsOf,placeOf,readout,withScan,hubSeen,needsTest,testSteps};
});
