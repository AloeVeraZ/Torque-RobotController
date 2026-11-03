(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckHardware=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // How a robot is wired, as the team plugs it in: which hub and port each motor, servo and sensor is on, what model
  // it is and which sensor tells where a mechanism is. Facts from FIRST's FTC SDK 12.0 and REV's hub documentation
  // (docs/MECHANISM_RESEARCH.md §8). project.robot.wiring keeps only what the team set; Deck plans the rest:
  //   hubs:    {expansion: null | false | {address}, expansion2..: {address}, servoHub: null | {address}, servoHub2..: {address},
  //            layout?: stack|custom, spm?: how many Servo Power Modules}; a Control Hub is always there. Each may have a label:
  //            the number the team calls it by ("Expansion Hub 2"), found by testing which hub is which.
  //   devices: {[settingKey]: {model?, hub: control|expansion[n]|servoHub[n], port, spm?: the Servo Power Module its servo
  //            goes through}} (an I2C device: bus in place of port).
  //   sensors: [{id, model, for: settingKey of what it measures (or kin.<joint id>), use: position|home|velocity|piece,
  //             hub, port? (analog 0-3, digital 0-7, encoder 0-3), bus? (I2C), channel? (an OctoQuad's 0-7), name?,
  //             inverted?, zeroVolts?, voltsPerUnit?, countsPerUnit?}]
  // A setting key names one physical device the way the export's rows name its setting: robot.frontLeft,
  // intakes.0.servo, shooters.1.hood, kin.<actuator id>, sensor.<sensor id>.
  const A=globalThis.DeckActuators||(typeof require==='function'?require('./sim-actuators.js'):null);
  const finite=Number.isFinite,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  // ---- hubs ---------------------------------------------------------------------------------------------------------
  // REV Control Hub and Expansion Hub: motor ports 0-3, each with an encoder input; servo ports 0-5 (5 V); analog 0-3
  // (2 connectors: blue wire n, white wire n+1; the SDK reads 0-3.3 V); digital 0-7 (4 connectors); I2C buses 0-3 (the
  // Control Hub's own IMU is on bus 0). Encoder ports 0 and 3 are decoded in hardware; 1 and 2 in software, which can
  // drop counts from a fast encoder such as a Through Bore (8192 a turn). A REV Servo Hub has servo ports 0-5 at 6 V.
  const HUBS={
    control:{id:'control',name:'Control Hub',part:'REV-31-1595',address:173,motor:4,encoder:4,servo:6,analog:4,digital:8,i2c:4,servoVolts:5,imuBus:0,fastEncoders:[0,3]},
    expansion:{id:'expansion',name:'Expansion Hub',part:'REV-31-1153',address:2,motor:4,encoder:4,servo:6,analog:4,digital:8,i2c:4,servoVolts:5,fastEncoders:[0,3]},
    servoHub:{id:'servoHub',name:'Servo Hub',part:'REV-11-1855',address:3,motor:0,encoder:0,servo:6,analog:0,digital:0,i2c:0,servoVolts:6}};
  // A robot's hub ids: control, expansion, expansion2.., servoHub, servoHub2.. The SDK takes RS485 addresses 1-10
  // (LynxConstants.MAX_UNRESERVED_MODULE_ADDRESS), each used once, so 10 hubs at most hang off a Control Hub. R701 lets a
  // competition robot have one Expansion Hub; more work on the bench, and Setup says so. A REV Servo Power Module
  // (REV-11-1144) passes a hub's servo signal on at 6 V: the robot's configuration cannot show it, so only Setup knows.
  const MAX_CHAINED=10,MAX_SPM=4,SPM={name:'Servo Power Module',part:'REV-11-1144',ports:6,servoVolts:6};
  const hubKind=id=>{const m=/^(control|expansion|servoHub)(?:([2-9]|10))?$/.exec(String(id));return m&&!(m[1]==='control'&&m[2])?m[1]:null;};
  const hubSpec=id=>HUBS[hubKind(id)]||null,hubIndex=id=>Number(/\d+$/.exec(String(id))?.[0]||1),hubId=(kind,n)=>n>1?kind+n:kind;
  const hubsOfKind=(hubs,kind)=>Object.keys(hubs||{}).filter(k=>hubKind(k)===kind&&hubs[k]).sort((a,b)=>hubIndex(a)-hubIndex(b));
  // The hubs a robot has, in the order they are listed: the Control Hub, Expansion Hubs, Servo Hubs.
  const hubIds=w=>['control',...hubsOfKind(w?.hubs,'expansion'),...hubsOfKind(w?.hubs,'servoHub')];
  const FAMILIES={motor:'motor port',encoder:'encoder port',servo:'servo port',analog:'analog port',digital:'digital port',i2c:'I2C bus'};
  const count=(hub,family)=>hubSpec(hub)?.[family]||0;
  // ---- what drives a mechanism ----------------------------------------------------------------------------------------
  // DeckActuators' models (each with its configuration tag, xmlType), and legal motors the simulator has no numbers for:
  // they can be wired and written to a configuration, with the counts a turn the team enters.
  const EXTRA=[
    {id:'matrix-12v',name:'MATRIX 12V motor (Modern Robotics, now goBILDA 5000 series)',short:'MATRIX 12V',kind:'dcmotor',family:'MATRIX',xmlType:'Matrix12vMotor',ratio:52.8,rpm:190,cpr:1478.4,feedback:'encoder',simulated:false},
    {id:'gobilda-5201',name:'goBILDA 5201 spur gear motor (older kits)',short:'goBILDA 5201',kind:'dcmotor',family:'goBILDA 5201',xmlType:'goBILDA5201SeriesMotor',rpm:null,cpr:null,feedback:'encoder',simulated:false},
    {id:'other-motor',name:'Another legal motor (SWYFT Spike, NFR Yuksel, WATTOS Stingray): enter its counts a turn',short:'Another motor',kind:'dcmotor',family:'Other',xmlType:'Motor',rpm:null,cpr:null,feedback:'encoder',simulated:false}];
  const ACTUATORS=[...(A?A.ALL:[]),...EXTRA],MODELS=Object.fromEntries(ACTUATORS.map(m=>[m.id,m]));
  const ofKind=k=>ACTUATORS.filter(m=>m.kind===k),MOTORS=ofKind('dcmotor'),SERVOS=ofKind('servo'),CRSERVOS=ofKind('crservo'),LINEARS=ofKind('linear');
  const familyOfKind=k=>k==='dcmotor'?'motor':k==='servo'||k==='crservo'||k==='linear'?'servo':k==='imu'||k==='pinpoint'||k==='otos'?'i2c':null;
  const KIND_TAG={dcmotor:'goBILDA5202SeriesMotor',servo:'Servo',linear:'Servo',crservo:'ContinuousRotationServo'};
  const xmlTypeOf=(model,kind)=>MODELS[model]?.xmlType||KIND_TAG[kind]||null;
  // ---- sensors --------------------------------------------------------------------------------------------------------
  // family: the port it plugs into (encoder: a motor port's encoder input, read through the motor configured there).
  // measures: what a mechanism can use it for. channels: REV's touch sensor reads only on odd digital channels (n+1) and
  // REV's potentiometer only on even analog channels (n). Axon feedback: angle = (1 − V/3.3)·360° − offset, wrapping at
  // 0 and 3.3 V; Axon publishes no table and the voltage shifts under load, so the guided check calibrates it.
  const SENSORS=[
    {id:'motor-encoder',name:'Motor encoder (built into the motor)',short:'Motor encoder',kind:'motorEncoder',family:'encoder',xmlType:null,javaType:'DcMotorEx',measures:['position','velocity','home']},
    {id:'rev-through-bore',name:'REV Through Bore Encoder (REV-11-1271)',short:'REV Through Bore',kind:'throughBore',family:'encoder',xmlType:null,javaType:'DcMotorEx',measures:['position'],cpr:8192,fast:true},
    {id:'rev-through-bore-v2',name:'REV Through Bore Encoder V2',short:'REV Through Bore V2',kind:'throughBore',family:'encoder',xmlType:null,javaType:'DcMotorEx',measures:['position'],cpr:8192,fast:true},
    {id:'gobilda-pod-encoder',name:'goBILDA odometry pod or swingarm encoder (2000 counts a turn)',short:'goBILDA pod encoder',kind:'throughBore',family:'encoder',xmlType:null,javaType:'DcMotorEx',measures:['position','velocity'],cpr:2000},
    {id:'quadrature-encoder',name:'Another quadrature encoder (US Digital E4T, CUI AMT102, Andymark): set its counts a turn',short:'Quadrature encoder',kind:'throughBore',family:'encoder',xmlType:null,javaType:'DcMotorEx',measures:['position','velocity'],cpr:2048},
    {id:'rev-through-bore-abs',name:'REV Through Bore Encoder V2, absolute output on an analog port',short:'Through Bore V2 absolute',kind:'analogAbs',family:'analog',xmlType:'AnalogInput',javaType:'AnalogInput',measures:['position'],degrees:360,voltage:3.3,channels:'any'},
    {id:'axon-feedback',name:"Axon servo's feedback wire (its 4th wire)",short:'Axon feedback wire',kind:'axonFeedback',family:'analog',xmlType:'AnalogInput',javaType:'AnalogInput',measures:['position'],degrees:360,voltage:3.3,channels:'any'},
    {id:'rev-potentiometer',name:'REV Potentiometer (REV-31-1155)',short:'REV Potentiometer',kind:'potentiometer',family:'analog',xmlType:'AnalogInput',javaType:'AnalogInput',measures:['position'],degrees:270,voltage:3.3,channels:'even'},
    {id:'andymark-am5200',name:'AndyMark HexBore absolute encoder (am-5200), analog output',short:'AndyMark HexBore',kind:'analogAbs',family:'analog',xmlType:'AnalogInput',javaType:'AnalogInput',measures:['position'],degrees:360,voltage:1.056,channels:'any'},
    {id:'analog-absolute',name:'Another analog absolute encoder (US Digital MA3, Thrifty)',short:'Analog absolute encoder',kind:'analogAbs',family:'analog',xmlType:'AnalogInput',javaType:'AnalogInput',measures:['position'],degrees:360,voltage:3.3,channels:'any'},
    {id:'rev-touch',name:'REV Touch Sensor (REV-31-1425)',short:'REV Touch Sensor',kind:'touch',family:'digital',xmlType:'RevTouchSensor',javaType:'TouchSensor',measures:['home','piece'],channels:'odd',activeLow:true},
    {id:'rev-magnetic-limit',name:'REV Magnetic Limit Switch (REV-31-1462)',short:'REV Magnetic Limit Switch',kind:'magnetic',family:'digital',xmlType:'DigitalDevice',javaType:'DigitalChannel',measures:['home'],channels:'any',activeLow:true},
    {id:'limit-switch',name:'Limit switch or microswitch (goBILDA 3103-0001)',short:'Limit switch',kind:'limit',family:'digital',xmlType:'DigitalDevice',javaType:'DigitalChannel',measures:['home','piece'],channels:'any',activeLow:true},
    {id:'rev-color-v3',name:'REV Color Sensor V3 (REV-31-1557)',short:'REV Color Sensor V3',kind:'color',family:'i2c',xmlType:'RevColorSensorV3',javaType:'NormalizedColorSensor',measures:['piece'],rangeCm:[1,10]},
    {id:'rev-color-v2',name:'REV Color Sensor V2',short:'REV Color Sensor V2',kind:'color',family:'i2c',xmlType:'LynxColorSensor',javaType:'NormalizedColorSensor',measures:['piece'],rangeCm:[1,6]},
    {id:'adafruit-color',name:'Adafruit RGB Color Sensor',short:'Adafruit Color',kind:'color',family:'i2c',xmlType:'AdafruitColorSensor',javaType:'NormalizedColorSensor',measures:['piece'],rangeCm:[1,6]},
    {id:'andymark-color',name:'AndyMark Proximity & Color Sensor',short:'AndyMark Color',kind:'color',family:'i2c',xmlType:'AndyMarkColor',javaType:'NormalizedColorSensor',measures:['piece'],rangeCm:[1,10]},
    {id:'rev-2m-distance',name:'REV 2m Distance Sensor (REV-31-1505)',short:'REV 2m Distance',kind:'distance',family:'i2c',xmlType:'REV_VL53L0X_RANGE_SENSOR',javaType:'DistanceSensor',measures:['piece','position'],rangeCm:[5,200]},
    {id:'andymark-tof',name:'AndyMark 2m TOF Lidar',short:'AndyMark TOF',kind:'distance',family:'i2c',xmlType:'AndyMarkTOF',javaType:'DistanceSensor',measures:['piece','position'],rangeCm:[5,200],sinceSdk:'11.1'},
    {id:'mr-range',name:'MR Range Sensor',short:'MR Range',kind:'distance',family:'i2c',xmlType:'ModernRoboticsI2cRangeSensor',javaType:'DistanceSensor',measures:['piece','position'],rangeCm:[5,255]},
    {id:'maxsonar',name:'MaxBotix MaxSonar I2CXL',short:'MaxSonar',kind:'distance',family:'i2c',xmlType:'MaxSonarI2CXL',javaType:'DistanceSensor',measures:['piece','position'],rangeCm:[20,765]},
    {id:'octoquad',name:'DigitalChickenLabs OctoQuad FTC (MK2): an encoder on one of its 8 channels',short:'OctoQuad',kind:'octoquad',family:'i2c',xmlType:'OctoQuadFTC',javaType:'OctoQuad',measures:['position','velocity'],channels:8}];
  const SENSOR_MODELS=Object.fromEntries(SENSORS.map(s=>[s.id,s]));
  // The picture of a model or sensor (DeckDeviceArt): its own photo; a tag of its own when one type covers many makers' parts, so
  // that it never shows another maker's; its type's otherwise. A continuous servo is its servo in another mode.
  const SHARED_TAGS=new Set(['Servo','ContinuousRotationServo','goBILDA5202SeriesMotor','AnalogInput','DigitalDevice','Motor']),DRAWN={throughBore:'AnalogInput',analogAbs:'AnalogInput',axonFeedback:'AnalogInput'};
  function pictureTag(id){const m=MODELS[id]||SENSOR_MODELS[id];if(!m)return '';const base=String(id).replace(/-cr$/,''),drawn=m.xmlType||DRAWN[m.kind]||'',art=globalThis.DeckDeviceArt;if(!drawn)return '';
    return art?.PHOTOS?.['model-'+base]||SHARED_TAGS.has(m.xmlType)||!m.xmlType?`model-${base}|${drawn}`:drawn;}
  const USES={position:'where it is',home:'when it is at its zero',velocity:'how fast it spins',piece:'when a piece is there'};
  const TELLS={position:w=>`where ${w} is`,home:w=>`when ${w} is at its zero`,velocity:w=>`how fast ${w} spins`,piece:w=>`when a piece is at ${w}`};
  const A_KIND={dcmotor:'a motor',servo:'a servo',crservo:'a continuous servo',linear:'a linear servo'};
  // ---- roles ----------------------------------------------------------------------------------------------------------
  // What each device does, what may drive it (actuator kinds; models follow), which sensors the export can use on it and
  // for what. A flywheel's speed comes only from its motor's encoder: a Through Bore's 8192 counts a turn overflow the
  // hub's 16-bit velocity above about 240 rpm. A REV potentiometer turns 270°, short of a turret's sweep.
  const HOME={touch:'home',magnetic:'home',limit:'home'},PIECE={color:'piece',distance:'piece',touch:'piece',limit:'piece'},ANGLE={axonFeedback:'position',analogAbs:'position'};
  const R=(name,family,kinds,sensors,explain,o={})=>({name,family,kinds,sensors,explain,...o});
  const ROLES={
    drive:R('Drive motor','motor',['dcmotor'],{motorEncoder:'position',throughBore:'position',...ANGLE},'Turns a wheel. Its encoder counts the wheel’s turns when the robot finds its place from the drive motors.'),
    steer:R('Swerve steering','servo',['crservo','servo','dcmotor'],{...ANGLE,throughBore:'position',motorEncoder:'position'},'Turns a swerve module to its angle. An absolute encoder (an Axon\u2019s feedback wire, a Through Bore V2) tells where it points.'),
    pod:R('Odometry pod','motor',[],{},'A free wheel with an encoder, plugged into a motor port’s encoder input. The robot reads it through the name configured on that port.'),
    imu:R('IMU','i2c',[],{},'The hub’s own IMU, on I2C bus 0: it tells which way the robot faces.'),
    pinpoint:R('goBILDA Pinpoint','i2c',[],{},'Reads both odometry pods and its own IMU and tells where the robot is. It goes on an I2C bus other than the IMU’s bus 0.'),
    otos:R('SparkFun OTOS','i2c',[],{},'Watches the floor and tells where the robot is. It goes on an I2C bus other than the IMU’s bus 0.'),
    roller:R('Intake roller','motor',['dcmotor','crservo'],{...PIECE,motorEncoder:'velocity'},'Spins the intake rollers on power, so it needs no sensor. A colour or distance sensor can tell a piece is in.'),
    ramp:R('Ramp','servo',['servo','linear','crservo','dcmotor'],{...ANGLE,potentiometer:'position',throughBore:'position',...HOME},'Lowers the ramp to take pieces and lifts it back. A servo goes to set positions; an Axon’s feedback wire or a potentiometer tells where it really is.'),
    kicker:R('Kicker','servo',['servo','linear'],{...ANGLE,potentiometer:'position',throughBore:'position',...HOME},'Swings down to scoop pieces in and back up. A servo goes to set positions; an Axon’s feedback wire or a potentiometer tells where it really is.'),
    flywheel:R('Flywheel','motor',['dcmotor'],{motorEncoder:'velocity'},'Spins the flywheel at a set speed. Only its motor’s own encoder can read that speed.'),
    feeder:R('Feeder','motor',['dcmotor','crservo','servo'],{...PIECE,motorEncoder:'position',throughBore:'position',...ANGLE},'Pushes pieces into the flywheel: a motor or continuous servo spins, a servo pusher or gate moves between two positions. A piece sensor can tell storage is empty.'),
    turret:R('Turret','motor',['dcmotor','servo','crservo'],{motorEncoder:'position',throughBore:'position',octoquad:'position',...ANGLE,...HOME},'Turns the shooter to aim. A motor counts its encoder (or a Through Bore on the turret, best on encoder port 0 or 3); a servo goes to positions; a continuous servo needs an absolute sensor such as an Axon’s feedback wire. A limit switch can find its zero.',{needs:{crservo:['axonFeedback','analogAbs','throughBore','octoquad']}}),
    hood:R('Hood','servo',['servo','linear'],{...ANGLE,potentiometer:'position',throughBore:'position',...HOME},'Tilts the hood to its shooting angle for Spin up and Shoot, and back after. A servo goes to set positions; an Axon’s feedback wire tells where it is.'),
    'kin-servo':R('Servo','servo',['servo'],{...ANGLE,potentiometer:'position',throughBore:'position',octoquad:'position',...HOME,color:'piece',distance:'piece'},'Goes to the part’s named positions. Its position is where it was told to go; an Axon’s feedback wire or a potentiometer tells where it really is.'),
    'kin-crservo':R('Continuous servo','servo',['crservo'],{...ANGLE,throughBore:'position',octoquad:'position',...HOME},'Spins on power. To stop at a named position it needs a sensor: an Axon’s feedback wire, an absolute encoder or a limit switch.',{needs:{crservo:['axonFeedback','analogAbs','throughBore','octoquad','touch','magnetic','limit']}}),
    'kin-motor':R('Motor','motor',['dcmotor'],{motorEncoder:'position',throughBore:'position',octoquad:'position',potentiometer:'position',analogAbs:'position',distance:'position',...HOME},'Runs to encoder counts for each named position, counted from the pose in the CAD. A limit switch can find that zero after a restart.'),
    'kin-linear':R('Linear servo','servo',['linear'],{...HOME,distance:'position',...ANGLE,throughBore:'position'},'Pushes its rod out to set positions; the position is where it was told to go.'),
    sensor:R('Sensor',null,[],{},'')};
  for(const r of Object.values(ROLES))r.models=r.kinds.flatMap(k=>ofKind(k).map(m=>m.id));
  const modelsFor=role=>(ROLES[role]?.models||[]).map(id=>MODELS[id]);
  const sensorsFor=role=>SENSORS.filter(s=>Object.hasOwn(ROLES[role]?.sensors||{},s.kind));
  // ---- setting keys ---------------------------------------------------------------------------------------------------
  // As sim-config's DEVICE_KEYS: drive motors, IMU, Pinpoint, OTOS and odometry pods.
  // Drive motors of drivetrains Deck exports no code for (Kiwi, H-drive, swerve...): wired as on the robot all the same.
  const MORE_DRIVE=['front','leftB','rightB','frontLeftB','frontRightB','backLeftB','backRightB'],STEER=['steerFront','steerFrontLeft','steerFrontRight','steerBackLeft','steerBackRight'];
  const DEVICE_KEYS=['frontLeft','frontRight','backLeft','backRight','left','right','imu','pinpoint','otos','par','perp','par_left','par_right',...MORE_DRIVE,...STEER],DRIVE_KEYS=[...DEVICE_KEYS.slice(0,6),...MORE_DRIVE],PODS=['par','perp','par_left','par_right'];
  const FIELDS={intakes:['motor','motor2','servo'],shooters:['motor','motor2','indexer','turretMotor','turretMotor2','hood']},ID=/^[A-Za-z][\w-]{0,31}$/,NAME=/^[A-Za-z][\w .-]{0,39}$/;
  function settingKey(s){
    if(typeof s==='string')return parseKey(s)?s:null;if(!s||typeof s!=='object')return null;
    if(typeof s.robot==='string')return `robot.${s.robot}`;if(typeof s.list==='string'&&Number.isInteger(s.index)&&typeof s.field==='string')return `${s.list}.${s.index}.${s.field}`;
    if(typeof s.kin==='string')return `kin.${s.kin}`;if(typeof s.sensor==='string')return `sensor.${s.sensor}`;return null;}
  function parseKey(key){
    if(typeof key!=='string')return null;let m;
    if((m=/^robot\.(\w+)$/.exec(key)))return DEVICE_KEYS.includes(m[1])?{robot:m[1]}:null;
    if((m=/^(intakes|shooters)\.([0-3])\.(\w+)$/.exec(key)))return FIELDS[m[1]].includes(m[3])?{list:m[1],index:+m[2],field:m[3]}:null;
    if((m=/^(kin|sensor)\.(.+)$/.exec(key)))return ID.test(m[2])?{[m[1]]:m[2]}:null;
    return null;}
  // The port family a device key is on when its kind is known from the key alone (a roller, feeder, turret or part may be
  // on a motor or a servo port, depending on what drives it).
  function keyFamily(key,model){
    const md=MODELS[model];if(md)return familyOfKind(md.kind);const k=parseKey(key);if(!k)return null;
    if(k.robot)return ['imu','pinpoint','otos'].includes(k.robot)?'i2c':STEER.includes(k.robot)?'servo':'motor';
    if(k.field==='servo'||k.field==='hood')return 'servo';if(k.list==='shooters'&&(k.field==='motor'||k.field==='motor2'))return 'motor';return null;}
  // ---- project.robot.wiring -------------------------------------------------------------------------------------------
  const EMPTY=()=>({hubs:{expansion:null,servoHub:null},devices:{},sensors:[]});
  const address=(v,d)=>{const a=finite(v)?Math.round(v):d;return a>=1&&a<=254&&a!==173?a:d;};
  const portIn=(v,n)=>finite(v)&&n>0?clamp(Math.round(v),0,n-1):null;
  const name=v=>typeof v==='string'&&NAME.test(v.trim())?v.trim():null;
  // Where one device or sensor is plugged in, or null: the hub must be on the robot and have that kind of port.
  function placement(raw,family,hubs,{channels=false}={}){
    const hub=raw?.hub;if(!(hub==='control'||hubKind(hub)&&hubs[hub]))return null;
    if(family==='i2c'){const bus=portIn(raw.bus??raw.port,count(hub,'i2c'));return bus===null?null:{hub,bus,...(channels&&portIn(raw.channel,8)!==null?{channel:portIn(raw.channel,8)}:{})};}
    const n=family?count(hub,family):Math.max(count(hub,'motor'),count(hub,'servo')),port=portIn(raw.port,n);return port===null?null:{hub,port};}
  // Only what the team set is kept: unknown keys and models are dropped, ports held to the hub's range, and 32 sensors at
  // most. A port two devices claim is kept as set, so Setup shows it red (conflicts) until the team moves one of them.
  // Returns null when nothing is set. Never throws.
  function sanitizeWiring(raw){
    try{
      if(!raw||typeof raw!=='object')return null;const h=raw.hubs&&typeof raw.hubs==='object'?raw.hubs:{},out=EMPTY();
      // Each hub its own address; hubs past the 10 a Control Hub can have are dropped.
      const taken=new Set([173]),chain=kind=>Object.keys(h).filter(k=>hubKind(k)===kind&&h[k]).sort((a,b)=>hubIndex(a)-hubIndex(b));let room=MAX_CHAINED;
      const put=(k,d)=>{if(room<=0)return;room--;let a=address(h[k].address,d);while(taken.has(a))a++;taken.add(a);out.hubs[k]={address:a,...(finite(h[k].label)&&h[k].label>=1&&h[k].label<=MAX_CHAINED?{label:Math.round(h[k].label)}:{})};};
      if(h.expansion===false)out.hubs.expansion=false;for(const k of chain('expansion'))put(k,HUBS.expansion.address);for(const k of chain('servoHub'))put(k,HUBS.servoHub.address);
      if(h.layout==='stack'||h.layout==='custom')out.hubs.layout=h.layout;
      if(finite(h.spm)&&h.spm>=1)out.hubs.spm=clamp(Math.round(h.spm),1,MAX_SPM);
      const devices=raw.devices&&typeof raw.devices==='object'?raw.devices:{};
      for(const key of Object.keys(devices).slice(0,160)){const v=devices[key],k=parseKey(key);if(!v||typeof v!=='object'||!k||k.sensor)continue;
        const e={};if(typeof v.model==='string'&&Object.hasOwn(MODELS,v.model))e.model=v.model;if(finite(v.ratio)&&v.ratio>0&&v.ratio!==1)e.ratio=clamp(v.ratio,.01,1000);
        if(typeof v.from==='string'&&v.from.trim())e.from=v.from.trim().slice(0,160);
        const family=keyFamily(key,e.model),at=placement(v,family,out.hubs);
        if(at)Object.assign(e,at);
        if(finite(v.spm)&&v.spm>=1&&v.spm<=(out.hubs.spm||0))e.spm=Math.round(v.spm);
        if(Object.keys(e).length)out.devices[key]=e;}
      const ids=new Set();
      for(const s of (Array.isArray(raw.sensors)?raw.sensors:[]).slice(0,64)){if(out.sensors.length>=32)break;
        const md=s&&typeof s==='object'?SENSOR_MODELS[s.model]:null,on=md&&typeof s.for==='string'&&parseKey(s.for)&&!parseKey(s.for).sensor?s.for:null;
        if(!on||typeof s.id!=='string'||!ID.test(s.id)||ids.has(s.id))continue;ids.add(s.id);
        const e={id:s.id,model:s.model,for:on,use:md.measures.includes(s.use)?s.use:/^shooters\.\d\.motor2?$/.test(on)&&md.measures.includes('velocity')?'velocity':md.measures[0]};
        if(md.kind!=='motorEncoder'){const at=placement(s,md.family,out.hubs,{channels:md.kind==='octoquad'});if(at&&hubKind(at.hub)!=='servoHub')Object.assign(e,at);}
        const n=name(s.name);if(n)e.name=n;if(s.inverted===true)e.inverted=true;
        if(finite(s.zeroVolts)&&s.zeroVolts>=0&&s.zeroVolts<=5)e.zeroVolts=+s.zeroVolts.toFixed(4);
        for(const f of ['voltsPerUnit','countsPerUnit'])if(finite(s[f])&&s[f]!==0&&Math.abs(s[f])<1e6)e[f]=+s[f].toPrecision(6);
        out.sensors.push(e);}
      return hubIds(out).length>1||out.hubs.expansion===false||out.hubs.layout||out.hubs.spm||Object.keys(out.devices).length||out.sensors.length?out:null;
    }catch{return null;}
  }
  // A robot's wiring with every part present (nothing set: a Control Hub alone, Deck plans every port).
  const wiringOf=robot=>sanitizeWiring(robot?.wiring)||EMPTY();
  // Keys after intake or shooter `removed` is deleted: later ones move down one; its own devices and sensors go.
  function reindex(wiring,list,removed){
    const w=sanitizeWiring(wiring);if(!w)return null;const move=key=>{const k=parseKey(key);if(!k||k.list!==list)return key;if(k.index===removed)return null;return k.index>removed?`${list}.${k.index-1}.${k.field}`:key;};
    const devices={};for(const [key,v] of Object.entries(w.devices)){const to=move(key);if(to)devices[to]=v;}
    return sanitizeWiring({...w,devices,sensors:w.sensors.map(s=>{const to=move(s.for);return to?{...s,for:to}:null;}).filter(Boolean)});}
  // Wiring without the keys keep(key) refuses (a part or joint no longer there), and the sensors on them.
  function prune(wiring,keep){const w=sanitizeWiring(wiring);if(!w)return null;
    return sanitizeWiring({...w,devices:Object.fromEntries(Object.entries(w.devices).filter(([k])=>keep(k))),sensors:w.sensors.filter(s=>keep(s.for))});}
  // ---- the devices a robot needs ----------------------------------------------------------------------------------------
  // With one Expansion Hub it is just "Expansion Hub"; with more, each goes by its address, as Servo Hubs always do.
  const hubName=(hub,w)=>{const kind=hubKind(hub),at=w?.hubs?.[hub]?.address,own=w?.hubs?.[hub]?.label;if(kind==='control')return 'Control Hub';if(own)return `${HUBS[kind].name} ${own}`;
    if(kind==='expansion')return hubsOfKind(w?.hubs,'expansion').length>1||hubIndex(hub)>1?`Expansion Hub ${at??hubIndex(hub)+1}`:'Expansion Hub';return kind==='servoHub'?`Servo Hub ${at??hubIndex(hub)+2}`:'';};
  const portLabel=(p,family,w)=>!p?.hub?'':`${hubName(p.hub,w)} ${family==='i2c'?`I2C bus ${p.bus}`:`${FAMILIES[family]||'port'} ${p.port}`}${p.channel!==undefined?`, channel ${p.channel}`:''}`;
  const SIGNALS={roller:['roller'],ramp:['deploy'],kicker:['deploy'],flywheel:['flywheel'],feeder:['feeder'],turret:['turret'],hood:['hood']};
  const kindOfDevice=d=>d==='motor'?'dcmotor':d==='servo'||d==='crservo'||d==='linear'?d:d==='imu'||d==='pinpoint'||d==='otos'?d:null;
  function roleOf(setting,mech){
    if(setting?.robot)return DRIVE_KEYS.includes(setting.robot)?'drive':STEER.includes(setting.robot)?'steer':PODS.includes(setting.robot)?'pod':setting.robot;
    const f=setting?.field;if(setting?.list==='intakes')return f==='servo'?(mech?.intakes?.[setting.index]?.kind==='ramp'?'ramp':'kicker'):'roller';
    if(setting?.list==='shooters')return {motor:'flywheel',motor2:'flywheel',indexer:'feeder',turretMotor:'turret',turretMotor2:'turret',hood:'hood'}[f]||null;return null;}
  const camel=v=>A?A.camel(v):String(v||'');
  const DEVICE_OF={motorEncoder:null,throughBore:'motor',axonFeedback:'analog',potentiometer:'analog',analogAbs:'analog',touch:'touch',magnetic:'digital',limit:'digital',color:'color',distance:'distance',octoquad:'octoquad'};
  const SUFFIX={position:'Position',home:'Home',velocity:'Speed',piece:'Piece'};
  // Every device the robot needs, one row each: {key, label, role, family, kind, device and need (as RobotConfig names
  // them), name, model, xmlType, hub?, port?, bus?, wired, encoder (its encoder input is read), sensors (what measures
  // it), joints (kinematics joint ids that move with it), parts (CAD assembly names)}, then one row per sensor (role
  // sensor, with for, use, channels?, fast?; its name is the configuration name it gets: the sensors on one OctoQuad
  // share "octoquad"). needs: DeckSimFtc.robotNeeds' rows (taken from DeckSimFtc when not given); kinematics actuators
  // and the hood are added when the needs lack them.
  const DL={frontLeft:'Front left drive motor',frontRight:'Front right drive motor',backLeft:'Back left drive motor',backRight:'Back right drive motor',left:'Left drive motor',right:'Right drive motor',front:'Front drive motor',center:'Centre (strafe) drive motor',
    frontLeftB:'Front left module, second motor',frontRightB:'Front right module, second motor',backLeftB:'Back left module, second motor',backRightB:'Back right module, second motor',steerFront:'Front steering',steerFrontLeft:'Front left steering',steerFrontRight:'Front right steering',steerBackLeft:'Back left steering',steerBackRight:'Back right steering'};
  const slots=keys=>keys.map(k=>[k,DL[k]]),FOUR=['frontLeft','frontRight','backLeft','backRight'];
  // Each module's parts together: a drive and its steering, or a differential module's two motors.
  const PAIRED=[['frontLeft','steerFrontLeft'],['frontRight','steerFrontRight'],['backLeft','steerBackLeft'],['backRight','steerBackRight']].flat();
  const twoEach=(...parts)=>parts.flatMap(([a,b,name])=>[[a,`${name}, motor 1`],[b,`${name}, motor 2`]]);
  const DRIVE_SLOTS={mecanum:slots(FOUR),xdrive:slots(FOUR),butterfly:slots(FOUR),tank:slots(FOUR),tank2:slots(['left','right']),kiwi:slots(['front','backLeft','backRight']),swerve:slots(PAIRED),coaxSwerve:slots(PAIRED),
    kiwiSwerve:slots(['front','steerFront','backLeft','steerBackLeft','backRight','steerBackRight']),diffSwerve2:twoEach(['left','leftB','Left drive'],['right','rightB','Right drive']),
    diffSwerve:twoEach(['frontLeft','frontLeftB','Front left'],['frontRight','frontRightB','Front right'],['backLeft','backLeftB','Back left'],['backRight','backRightB','Back right'])};
  function rows(project,needs){
    const p=project||{},robot=p.robot||{},w=wiringOf(robot),mech=p.mechanisms,kin=p.kinematics||{},joints=Array.isArray(kin.joints)?kin.joints:[],actuators=Array.isArray(kin.actuators)?kin.actuators:[];
    if(!Array.isArray(needs)){try{const F=globalThis.DeckSimFtc||(typeof require==='function'?require('./sim-ftc.js'):null);needs=F?F.robotNeeds(robot,p.sensors?.localization,mech):[];}catch{needs=[];}}
    const out=[],seen=new Set(),byKey=new Map(),localization=p.sensors?.localization;
    const jointsOf=(role,setting)=>{if(!setting?.list)return [];const part=`${setting.list==='intakes'?'intake':'shooter'}:${setting.index}`;
      return joints.filter(j=>j.drive&&(SIGNALS[role]||[]).includes(j.drive.signal)&&(j.drive.of===part||role==='feeder'&&j.drive.of==='any')).map(j=>j.id);};
    const add=(n,extra={})=>{const key=settingKey(n.setting);if(!key||seen.has(key))return;seen.add(key);const k=parseKey(key);if(!k||k.sensor)return;
      const act=k.kin?actuators.find(a=>a.id===k.kin||a.device2&&a.id+'-2'===k.kin):null,role=k.kin?`kin-${{dcmotor:'motor',servo:'servo',crservo:'crservo',linear:'linear'}[act?.kind]||'servo'}`:roleOf(n.setting,mech);if(!role)return;
      const e=w.devices[key]||{},model=act?.model||e.model||null,md=MODELS[model],kind=act?.kind||(md&&ROLES[role]?.kinds.includes(md.kind)&&md.kind==='linear'&&n.device==='servo'?'linear':kindOfDevice(n.device)),family=role==='pod'?'motor':familyOfKind(kind);
      // Whether it reads its own motor encoder: a flywheel's speed, a motor turret's or part's position (unless a Through
      // Bore or an OctoQuad channel reads it instead), drive motors when the robot finds its place from them.
      const outside=w.sensors.some(s=>s.for===key&&['throughBore','octoquad'].includes(SENSOR_MODELS[s.model].kind)&&s.use==='position');
      const encoder=role==='pod'||role==='flywheel'||(role==='turret'&&kind==='dcmotor'||role==='kin-motor')&&!outside||role==='drive'&&localization==='encoders'||w.sensors.some(s=>s.for===key&&s.model==='motor-encoder');
      const list=k.list?mech?.[k.list]?.[k.index]:null,parts=Array.isArray(list?.parts)?list.parts:[],moved=k.kin?(act?.joint?[act.joint]:[]):jointsOf(role,n.setting);
      const row={key,label:n.label,role,family,kind,device:role==='pod'?'motor':n.device||kind,need:n.need||(n.device==='linear'?'servo':n.device),name:n.name,model,xmlType:role==='pod'?'Motor':xmlTypeOf(model,kind),...(n.setting?{setting:n.setting}:{}),
        ...(e.hub?{hub:e.hub,...(e.bus!==undefined?{bus:e.bus}:{port:e.port})}:{}),...(e.spm?{spm:e.spm}:{}),wired:!!e.hub,encoder,sensors:[],...(e.from?{from:e.from}:{}),...(moved.length?{joints:moved}:{}),...(parts.length?{parts}:{}),...extra};
      out.push(row);byKey.set(key,row);};
    for(const n of needs||[])add(n);
    if(!out.some(r=>r.role==='drive')){const slots=DRIVE_SLOTS[robot.drivetrain||'mecanum']||DRIVE_SLOTS.mecanum;
      for(const [key,label] of slots)add({name:key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),device:STEER.includes(key)?'crservo':'motor',label,setting:{robot:key}});}
    (mech?.enabled?mech.shooters||[]:[]).forEach((s,i)=>{if(s.hood)add({name:s.hood,device:'servo',label:`Shooter ${i+1} hood`,setting:{list:'shooters',index:i,field:'hood'}});});
    for(const a of actuators){if(!['servo','crservo','dcmotor','linear'].includes(a.kind))continue;const j=joints.find(x=>x.id===a.joint);if(j?.drive&&j.drive.signal!=='action')continue;
      const servoPwm=a.servo?.pwm,device=a.kind==='dcmotor'?'motor':a.kind==='linear'?'servo':a.kind;add({name:a.device||camel(a.name),device,label:a.name||a.id,setting:{kin:a.id}},{...(servoPwm?{pwm:servoPwm}:{}),...(a.reversed?{reversed:true}:{})});
      if(a.device2)add({name:a.device2,device,label:`${a.name||a.id} (second)`,setting:{kin:a.id+'-2'}},{...(servoPwm?{pwm:servoPwm}:{}),...(a.reversed2?{reversed:true}:{})});}
    for(const s of w.sensors){const md=SENSOR_MODELS[s.model],dev=byKey.get(s.for),k=parseKey(s.for),joint=k?.kin?joints.find(j=>j.id===k.kin):null;
      if(dev)dev.sensors.push({id:s.id,model:s.model,kind:md.kind,use:s.use,...(s.hub?{hub:s.hub,...(s.bus!==undefined?{bus:s.bus}:{port:s.port}),...(s.channel!==undefined?{channel:s.channel}:{})}:{})});
      if(md.kind==='motorEncoder')continue;
      const what=dev?.label||joint?.name||s.for,base=dev?.name||camel(joint?.name||k?.kin||s.for);
      out.push({key:`sensor.${s.id}`,id:s.id,label:`${what}: ${md.short}`,role:'sensor',family:md.family,kind:md.kind,device:DEVICE_OF[md.kind],need:DEVICE_OF[md.kind],name:s.name||(md.kind==='octoquad'?'octoquad':`${base}${md.family==='encoder'?'Encoder':SUFFIX[s.use]}`.slice(0,40)),model:s.model,xmlType:md.family==='encoder'?'Motor':md.xmlType,
        for:s.for,use:s.use,...(s.hub?{hub:s.hub,...(s.bus!==undefined?{bus:s.bus}:{port:s.port}),...(s.channel!==undefined?{channel:s.channel}:{})}:{}),wired:!!s.hub,encoder:md.family==='encoder',...(md.channels==='odd'||md.channels==='even'?{channels:md.channels}:{}),...(md.fast?{fast:true}:{}),
        ...(dev?.joints?{joints:dev.joints}:joint?{joints:[joint.id]}:{}),...(dev?.parts?{parts:dev.parts}:{})});}
    return out;
  }
  // ---- motors and servos named in a CAD -------------------------------------------------------------------------------
  // What a CAD part's name says it is: {kind: dcmotor|servo|crservo|linear, model: catalog id or null}, or null. Vendor
  // part numbers first (goBILDA 5203/5202-…, REV-41-…, 2000-0025-…), then names with an rpm or a gear ratio.
  const GB_RATIO={'0001':6000,'0003':1620,'0005':1150,'0014':435,'0019':312,'0027':223,'0051':117,'0071':84,'0100':60,'0139':43,'0188':30};
  const nearest=(rpm,list)=>list.reduce((a,b)=>Math.abs(b.rpm-rpm)<Math.abs(a.rpm-rpm)?b:a);
  function fromCadName(raw){
    const s=String(raw||'').toLowerCase().replace(/[_]+/g,' ');if(!s)return null;let m;
    const gb=MOTORS.filter(x=>/^gobilda-5203-/.test(x.id)),rpmOf=/(\d{2,4}(?:\.\d+)?)\s*rpm/.exec(s),ratioOf=/(\d{1,3}(?:\.\d+)?)\s*:\s*1\b/.exec(s);
    if((m=/520[23]-\d{4}-(\d{4})/.exec(s))&&GB_RATIO[m[1]])return {kind:'dcmotor',model:'gobilda-5203-'+GB_RATIO[m[1]]};
    // goBILDA's own CAD names its motors "6000rpm Motor - Bare REX (GB)", "312rpm Motor (GB)".
    if(/yellow ?jacket|520[23][- ]series|\b520[23]\b|gobilda.*motor|\bmotor\b.*\(gb\)|\(gb\).*\bmotor\b/.test(s)&&!/motor (mount|bracket|plate|pinion|spacer|shaft|gear|pulley|sleeve)/.test(s)){if(rpmOf)return {kind:'dcmotor',model:nearest(+rpmOf[1],gb).id};
      if(ratioOf){const r=+ratioOf[1];return {kind:'dcmotor',model:gb.reduce((a,b)=>Math.abs(6000/b.rpm-r)<Math.abs(6000/a.rpm-r)?b:a).id};}return {kind:'dcmotor',model:null};}
    // A motor's bracket, plate, pinion or cartridge is not the motor ("UltraPlanetary Outside Mounting Bracket").
    if(/\b(bracket|plate|pinion|cartridge|bushing|endcap)\b|mounting/.test(s))return null;
    if(/rev-?41-?1300|core ?hex/.test(s))return {kind:'dcmotor',model:'rev-core-hex'};
    if(/rev-?41-?1301|hd ?hex|ultraplanetary|rev-?41-?1600/.test(s)){const r=ratioOf?+ratioOf[1]:null,ultra=MOTORS.filter(x=>/^rev-ultra-|^rev-hd-hex/.test(x.id));
      return {kind:'dcmotor',model:rpmOf?nearest(+rpmOf[1],ultra).id:r?ultra.reduce((a,b)=>Math.abs(6000/b.rpm-r)<Math.abs(6000/a.rpm-r)?b:a).id:/ultraplanetary|1600/.test(s)?'rev-ultra-20':'rev-hd-hex'};}
    if(/neverest/.test(s))return {kind:'dcmotor',model:/3\.7|orbital 3/.test(s)?'neverest-3-7':/60/.test(s)?'neverest-60':/40/.test(s)?'neverest-40':'neverest-20'};
    if(/torquenado/.test(s))return {kind:'dcmotor',model:'torquenado'};if(/maverick/.test(s))return {kind:'dcmotor',model:'studica-maverick'};
    const cr=/continuous|\bcr\b|cont\.? ?rot/.test(s),pick=(id,crId)=>({kind:cr&&crId?'crservo':'servo',model:cr&&crId?crId:id});
    if(/2000-0025-0002|torque servo|dual mode.*torque/.test(s))return pick('gobilda-torque','gobilda-torque-cr');
    if(/2000-0025-0004|super ?speed/.test(s))return pick('gobilda-superspeed','gobilda-superspeed-cr');
    if(/2000-0025-0003|speed servo|dual mode.*speed/.test(s))return pick('gobilda-speed','gobilda-speed-cr');
    if(/2000-0025-0503|5[- ]turn/.test(s))return {kind:'servo',model:'gobilda-5turn'};
    if((m=/axon\s*(max|mini|micro)/.exec(s)||/\b(max|mini|micro)\b[^()]*servo.*axon/.exec(s)))return pick('axon-'+m[1],'axon-'+m[1]+'-cr');
    if(/rev-?41-?3336|ultraspeed/.test(s))return {kind:'servo',model:'rev-smart-ultra'};
    if(/rev-?41-?1097|smart robot servo/.test(s))return pick('rev-smart','rev-smart-cr');
    if(/75007|200 fast/.test(s))return {kind:'servo',model:'studica-multimode-fast'};if(/75002|multi-?mode/.test(s))return pick('studica-multimode','studica-multimode-cr');
    if((m=/sr-servo-0([1-5])/.exec(s)))return {kind:'servo',model:'swyft-'+['speed','balance','torque','slim','nano'][+m[1]-1]};
    if(/swyft/.test(s)&&/\bservo\b/.test(s)&&(m=/\b(speed|balance|torque|slim|nano)\b/.exec(s)))return {kind:'servo',model:'swyft-'+m[1]};
    if(/plex-09-0017-0001/.test(s))return {kind:'servo',model:'plex-speed'};if(/plex-09-0017-0002/.test(s))return {kind:'servo',model:'plex-torque'};
    if((m=/torctex\s*(max|pro|micro)/.exec(s)))return {kind:'servo',model:'torctex-'+m[1]};
    if(/l16/.test(s)&&/actuonix|linear/.test(s))return {kind:'linear',model:/140/.test(s)?'actuonix-l16-140':/100/.test(s)?'actuonix-l16-100':'actuonix-l16-50'};
    if(/hls12/.test(s))return {kind:'linear',model:'hitec-hls12'};if(/hs-?485/.test(s))return {kind:'servo',model:'hitec-485'};
    // A part simply called a motor or a servo: its kind, its model left to the team.
    if(/\bservo\b/.test(s)&&!/servo (hub|horn|block|mount|bracket|shaft|plate|spline|gear|pulley|sprocket|arm|coupler|adapter|extension|cable|power)|hub shaft|\d+t servo/.test(s))return {kind:cr?'crservo':'servo',model:null};
    if(/\bmotor\b/.test(s)&&!/motor (mount|bracket|plate|pinion|spacer|shaft|gear|pulley)/.test(s))return {kind:'dcmotor',model:null};
    return null;}
  // The hubs and sensors a CAD shows by their part names: goBILDA's "GB Pinpoint Computer", REV's "Expansion Hub" and
  // "REV-11-1855" (the Servo Hub; goBILDA's "Servo Hub (GB)" is a servo horn), "IR Break Beam Sensor", "Absolute Encoder".
  // parts: [{name, path (its assembly names, outermost first)}]. Returns {expansion, servoHub, localization (fused,
  // optical, odometry or null), sensors: [{name, what, model (a SENSORS id, or null when Setup has none like it), path}]}.
  const CAD_SENSORS=[[/break ?beam|beam ?break/,'Break-beam sensor',null],[/color sensor|colou?r v3|rev-?31-?1557/,'Color sensor','rev-color-v3'],[/2m distance|rev-?31-?1505|time.of.flight|\btof\b/,'Distance sensor','rev-2m-distance'],
    [/through ?bore|rev-?11-?1271/,'Through Bore encoder','rev-through-bore'],[/absolute encoder|\bmag ?encoder|\bma3\b/,'Absolute encoder','analog-absolute'],[/touch sensor|rev-?31-?1425/,'Touch sensor','rev-touch'],
    [/magnetic limit|rev-?31-?1462/,'Magnetic limit switch','rev-magnetic-limit'],[/limit switch|micro ?switch|3103-0001/,'Limit switch','limit-switch'],[/potentiometer|rev-?31-?1155/,'Potentiometer','rev-potentiometer']];
  function cadSensors(parts){
    const out={expansion:false,servoHub:false,localization:null,sensors:[]},seen=new Set();let pods=0;
    for(const p of parts||[]){const s=String(p.name||'').toLowerCase();if(!s)continue;
      if(/expansion hub|rev-?31-?1153/.test(s))out.expansion=true;
      if(/rev-?11-?1855|rev servo hub/.test(s))out.servoHub=true;
      if(/pinpoint/.test(s))out.localization='fused';else if(/\botos\b|optical (tracking )?odometry/.test(s)&&out.localization!=='fused')out.localization='optical';
      else if(/odometry pod|odo pod|swingarm odometry|dead ?wheel|3110-0001/.test(s))pods++;
      const hit=CAD_SENSORS.find(([re])=>re.test(s));if(!hit)continue;const key=hit[1]+'|'+(p.path||[]).slice(0,2).join('/');if(seen.has(key))continue;seen.add(key);
      out.sensors.push({name:String(p.name).replace(/\s*<\d+>$/,''),what:hit[1],model:hit[2],path:p.path||[]});}
    if(!out.localization&&pods)out.localization=pods>=3?'odometry3':'odometry';
    return out;}
  // Which device each actuator found in a CAD drives. parts: [{name, path (its assembly names, outermost first), kind,
  // model}]; devices: rows {key, role, family, scope: CAD refs of its mechanism, own: refs of what it moves}; key of each
  // part: its CAD ref. A part goes to a device of its family in whose mechanism it sits, preferring words in its path that
  // say what the device does and the parts the device moves; in a shooter the fastest motor turns the flywheel.
  // Returns [{key: device key, part, kind, model}].
  const ROLE_WORDS={flywheel:/fly ?wheel|launch|shoot|outtake/,turret:/turret|turntable|lazy ?susan|rotat/,hood:/hood/,feeder:/kick|feed|index|transfer|push|gate|flick/,
    ramp:/ramp|deploy|pivot|flip|wrist/,kicker:/kick|scoop/,roller:/roller|intake|sweep|brush|spin/,drive:/drive|chassis|mecanum|base|frame/,steer:/steer|swerve|module/};
  const FAMILY_KINDS={motor:['dcmotor','crservo'],servo:['servo','linear','crservo']};
  function assignCad(parts,devices){
    const within=(ref,refs)=>refs.some(r=>ref===r||ref.startsWith(r+'/')),pairs=[];
    for(const d of devices){const kinds=FAMILY_KINDS[d.family]||[];if(!kinds.length)continue;
      // A turret also turns on a servo (an Axon under its turntable), whatever Setup has it on now.
      for(const p of parts){if(!(kinds.includes(p.kind)||d.role==='turret'&&FAMILY_KINDS.servo.includes(p.kind))||(d.family==='motor'&&p.kind==='crservo'&&!['roller','feeder','steer','turret'].includes(d.role)))continue;
        // Its own name and the assemblies around it say what it drives ("Turret motor" on the chassis still turns the turret,
        // a servo in the "Indexer" assembly feeds the shooter).
        const words=ROLE_WORDS[d.role],named=!!words&&words.test(p.name.toLowerCase()),around=!!words&&words.test(p.path.join('/').toLowerCase()),inside=d.scope.length?within(p.key,d.scope):d.role==='drive';if(!inside&&!named&&!around)continue;
        let score=(inside?1:0)+(named?4:around?3:0)+(d.own.length&&within(p.key,d.own)?2:0)-(d.scope.length?0:.5);
        // A turret carries its flywheel's motor, so the motor's speed decides: a 6000 rpm motor spins the flywheel.
        if(d.role==='flywheel'||d.role==='turret'){const rpm=MODELS[p.model]?.rpm||0;score+=d.role==='flywheel'?rpm/2000:-rpm/2000;}
        pairs.push({d,p,score,named:named||around});}}
    // A CAD lists the copies of a part once ("Mini Servo" under the "Turret" assembly turns both turrets), so a part named
    // for what it does serves every device of that role.
    pairs.sort((a,b)=>b.score-a.score);const used=new Map(),done=new Set(),out=[];
    for(const {d,p,named} of pairs){if(done.has(d.key)||used.has(p.key)&&!(named&&used.get(p.key)===d.role))continue;
      // Drive motors: one CAD part each, but four of one kind usually: every drive motor takes the model found.
      done.add(d.key);used.set(p.key,d.role);out.push({key:d.key,part:p.name,ref:p.key,kind:p.kind,model:p.model});}
    return out;}
  // The motors and servos in a CAD that power nothing Deck models ("Servo - Speed" in an indexer whose feed runs on a belted
  // motor): they are still on the robot, so they count against the game's limit. found: assignCad's list with whatever else
  // was traced. A motor named only "Motor Part" or "Motor Sleeve" may be a piece of one already counted, so it is left out.
  // The check for mechanisms chained to one motor: what turns the parts under refs, through belts, gears and shafts. A very
  // long path is parts that only touch, not a drive (a real indexer may run 5 belts, about 3 links each), so it does not
  // count. fits(actuator): whether this device can run on it. Returns {actuator, belts, hops} or null.
  const CHAIN_HOPS=24;
  function chainOf(train,refs,fits){const hit=train.from(refs,{skip:a=>!fits(a)});return hit&&hit.hops<=CHAIN_HOPS?hit:null;}
  function cadOthers(parts,found){const used=new Set((found||[]).map(f=>f.ref));
    return (parts||[]).filter(p=>!used.has(p.key)&&(p.kind!=='dcmotor'||p.model)).map(p=>({name:p.name,kind:p.kind,...(p.model?{model:p.model}:{}),in:String(p.path?.[p.path.length-1]||'').replace(/\s*<\d+>$/,'')}));}
  // ---- belts, chains and gears in a CAD -------------------------------------------------------------------------------
  // What drives a mechanism with no motor of its own: its pulleys, sprockets and gears are followed through the belts and
  // chains they touch, the shafts they share and the gears they mesh with, to the motor or servo at the other end ("Motor
  // Part" in the chassis → 15T pulley → belt → 25T pulley → belt → the intake's 31T pulley). parts: every leaf of the CAD,
  // [{ref ('#leaf'), key (its node's key), name, box [x0,y0,z0,x1,y1,z1]}]. Returns {actuators, from(refs)}: the motors
  // and servos (a motor modelled in several pieces is one), and for the leaves under refs the nearest actuator that is not
  // a drive motor (one geared to a mecanum, omni or traction wheel) as {actuator, belts, hops}, or null.
  const TRANSMISSION=[['belt',/\bbelt\b|\bchain\b(?!.*(tensioner|guard))/],['wheel',/mecanum|\bomni\b|traction wheel|grip ?force|drive wheel/],
    ['gear',/pulley|sprocket|\bgear\b|pinion|\d+ ?(t|tooth|teeth)\b/],['shaft',/\bshaft\b|\baxle\b|coupler|hub mount|servo hub \(gb\)|sonic hub|\bhex hub\b/]];
  function transmissionOf(name){const s=String(name||'').toLowerCase();if(!s)return null;
    const a=fromCadName(s);if(a&&!/pulley|sprocket|gear|pinion|\bbelt\b|\bhub\b|shaft/.test(s))return {type:'actuator',...a};
    const hit=TRANSMISSION.find(([,re])=>re.test(s));return hit?{type:hit[0]}:null;}
  function driveTrain(parts){
    const list=(parts||[]).filter(p=>Array.isArray(p.box)&&p.box.length===6&&p.box.every(finite)).map(p=>({...p,...transmissionOf(p.name)})).filter(p=>p.type);
    if(!list.length)return {actuators:[],from:()=>null,onAxis:()=>[],spread:()=>({groups:[],stopped:[]})};
    // Lengths relative to the drive train's size (about the robot's): touching within 0.2% of it, one shaft carrying two
    // pulleys up to 6% of it apart (an inch on an FTC robot).
    let size=0;for(let a=0;a<3;a++)size=Math.max(size,Math.max(...list.map(p=>p.box[a+3]))-Math.min(...list.map(p=>p.box[a])));
    const tol=size*.002,reach=size*.06;
    const touch=(a,b,t=tol)=>[0,1,2].every(k=>a[k]-t<=b[k+3]&&b[k]-t<=a[k+3]);
    // A round part's axis: the side unlike the other two (its two equal sides are its diameter); a motor's: its longest.
    const dims=b=>[0,1,2].map(k=>b[k+3]-b[k]),center=b=>[0,1,2].map(k=>(b[k]+b[k+3])/2);
    const axisOf=(b,long)=>{const d=dims(b);if(long)return d.indexOf(Math.max(...d));
      // A thin part turns about its thin side, whole or a sector of a gear (a hood's gear is not round in its box).
      const thin=Math.min(...d),rest=d.filter((_,k)=>k!==d.indexOf(thin));if(thin<.5*Math.min(...rest))return d.indexOf(thin);let best=0,gap=Infinity;for(const k of [0,1,2]){const [u,v]=[0,1,2].filter(x=>x!==k),g=Math.abs(d[u]-d[v])/Math.max(d[u],d[v],1e-9);if(g<gap){gap=g;best=k;}}return best;};
    // Two parts on one axis line (a shaft through both, a pulley on a motor's output): the same axis, centred on each
    // other across it, and close along it.
    const coaxial=(a,b,ax,bx)=>{if(ax!==bx)return false;const ca=center(a.box),cb=center(b.box),across=[0,1,2].filter(k=>k!==ax),r=Math.min(...across.map(k=>Math.min(a.box[k+3]-a.box[k],b.box[k+3]-b.box[k])))/2;
      if(!across.every(k=>Math.abs(ca[k]-cb[k])<=Math.max(r*.35,tol)))return false;return Math.max(a.box[ax],b.box[ax])-Math.min(a.box[ax+3],b.box[ax+3])<=reach;};
    // A motor modelled in pieces ("Motor Part", "Motor Sleeve", a gearbox) is one actuator: actuator pieces that touch.
    const acts=list.filter(p=>p.type==='actuator'),group=acts.map((_,i)=>i),find=i=>group[i]===i?i:group[i]=find(group[i]);
    for(let i=0;i<acts.length;i++)for(let j=i+1;j<acts.length;j++)if(touch(acts[i].box,acts[j].box,-tol)&&(acts[i].kind==='dcmotor')===(acts[j].kind==='dcmotor'))group[find(i)]=find(j);
    const byRoot=new Map();acts.forEach((p,i)=>{const r=find(i);if(!byRoot.has(r))byRoot.set(r,[]);byRoot.get(r).push(p);});
    const actuators=[...byRoot.values()].map((pieces,n)=>{const box=[0,1,2].map(k=>Math.min(...pieces.map(p=>p.box[k]))).concat([0,1,2].map(k=>Math.max(...pieces.map(p=>p.box[k+3]))));
      const named=pieces.find(p=>p.model)||pieces.find(p=>!/sleeve|cover|body|part/i.test(p.name))||pieces[0];
      return {id:n,name:named.name,key:named.key,kind:named.kind,model:named.model||null,box,refs:pieces.map(p=>p.ref),type:'actuator'};});
    // A part called a shaft is one only if it looks it: long and slender (even at a small angle, on a turned turret) or a small
    // hub. Anything else is a strut or a plate that a team named "shaft", and a strut carries no drive.
    const sides=b=>dims(b).sort((x,y)=>y-x),rod=b=>sides(b)[0]>=2.5*sides(b)[1],notShaft=p=>p.type==='shaft'&&!rod(p.box)&&sides(p.box)[0]>reach*1.5;
    const nodes=[...list.filter(p=>p.type!=='actuator'&&!notShaft(p)),...actuators],axes=nodes.map(p=>axisOf(p.box,p.type==='actuator'||p.type==='shaft'));
    const links=nodes.map(()=>[]),loose=nodes.map(()=>[]);
    // Round parts by what they do, not by their boxes touching: boxes meet at the corners of gears that do not. Students'
    // CAD is rarely exact, and teams space gears differently, so there are two kinds of link. A sure one: a mesh within 8%
    // in one plane, a pulley on a belt, a gear on a shaft. A loose one, used only when no sure path exists and said to be
    // checked: gears up to 30% apart (they line up once the robot is built and flexes), a stack on one axis with a gap, or
    // gears at right angles that touch (a bevel, a differential). Gears side by side in different planes never mesh.
    const radius=(b,ax)=>Math.max(...[0,1,2].filter(k=>k!==ax).map(k=>b[k+3]-b[k]))/2,along=(a,b,ax,t=tol)=>a[ax]-t<=b[ax+3]&&b[ax]-t<=a[ax+3];
    const meshes=(a,b,ax,far=1.08)=>{const ca=center(a),cb=center(b),across=[0,1,2].filter(k=>k!==ax),gap=Math.hypot(...across.map(k=>ca[k]-cb[k])),sum=radius(a,ax)+radius(b,ax);return along(a,b,ax)&&gap<=sum*far&&gap>=Math.abs(radius(a,ax)-radius(b,ax))*.5;};
    const bevel=/bevel|miter|mitre/i;
    // A belt's box runs from pulley to pulley: a pulley on it is in its plane, with its centre inside, at the box's edge.
    const onBelt=(belt,g,ax)=>{const c=center(g),r=radius(g,ax),across=[0,1,2].filter(k=>k!==ax);return along(belt,g,ax,(belt[ax+3]-belt[ax])*.5)&&across.every(k=>c[k]>=belt[k]-r*.3&&c[k]<=belt[k+3]+r*.3)&&across.some(k=>c[k]-r<=belt[k]+r*.3||c[k]+r>=belt[k+3]-r*.3);};
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j],types=[a.type,b.type].sort().join('+');
      let on=false;
      if(types==='belt+gear'){const [belt,g,ax]=a.type==='belt'?[a,b,axes[j]]:[b,a,axes[i]];on=onBelt(belt.box,g.box,ax);}
      else if(types==='gear+gear'){const same=axes[i]===axes[j],stack=coaxial(a,b,axes[i],axes[j]),pulleys=/pulley|sprocket/i.test(a.name)&&/pulley|sprocket/i.test(b.name);
        // Pulleys on one axis are on one shaft, modelled or not (a belt stage); gears on one axis may turn apart.
        on=same&&meshes(a.box,b.box,axes[i])||stack&&(pulleys||touch(a.box,b.box))||!same&&touch(a.box,b.box)&&bevel.test(a.name)&&bevel.test(b.name);
        if(!on&&(same&&meshes(a.box,b.box,axes[i],1.3)||stack||!same&&touch(a.box,b.box))){loose[i].push(j);loose[j].push(i);}}
      else if(types==='gear+shaft'){const [s,g,sx,gx]=a.type==='shaft'?[a,b,axes[i],axes[j]]:[b,a,axes[j],axes[i]];on=coaxial(s,g,sx,gx)||touch(a.box,b.box)&&sx===gx;}
      // Two rods drive each other only end to end, on one line; two that merely touch are loose. A hub on a rod touches it.
      else if(types==='shaft+shaft'){if(rod(a.box)&&rod(b.box)){on=coaxial(a,b,axes[i],axes[j]);if(!on&&touch(a.box,b.box)){loose[i].push(j);loose[j].push(i);}}else on=touch(a.box,b.box);}
      // A wheel turns with what is on its own axle, not with a pulley that sits beside it.
      else if(types==='gear+wheel'||types==='shaft+wheel')on=coaxial(a,b,axes[i],axes[j]);
      else if(types==='actuator+gear'||types==='actuator+shaft')on=touch(a.box,b.box)||coaxial(a,b,axes[i],axes[j]);
      if(on){links[i].push(j);links[j].push(i);}}
    // Breadth first through belts, gears and shafts (never through another motor or a wheel) from the given nodes.
    const walk=(start,useLoose=false)=>{const seen=new Map(start.map(i=>[i,{hops:0,belts:0,via:-1}])),queue=[...start],hit=[];
      const pathTo=i=>{const out=[];for(let k=i;k>=0;k=seen.get(k).via)out.unshift(nodes[k]);return out;};
      while(queue.length){const i=queue.shift(),at=seen.get(i);for(const j of useLoose?[...links[i],...loose[i]]:links[i]){if(seen.has(j))continue;const step={hops:at.hops+1,belts:at.belts+(nodes[j].type==='belt'?1:0),via:i};seen.set(j,step);
        if(nodes[j].type==='actuator'||nodes[j].type==='wheel')hit.push({node:nodes[j],...step,path:pathTo(j)});else queue.push(j);}}
      return hit;};
    const index=new Map(nodes.map((n,i)=>[n,i]));
    for(const a of actuators)a.drive=walk([index.get(a)]).some(h=>h.node.type==='wheel');
    const within=(p,refs)=>refs.some(r=>p.ref===r||p.key===r||String(p.key||'').startsWith(r+'/'));
    function from(refs,{skip,gears=false,useLoose=false}={}){const list=(refs||[]).filter(Boolean);if(!list.length)return null;
      const start=nodes.map((n,i)=>n.type!=='actuator'&&n.type!=='wheel'&&within(n,list)?i:-1).filter(i=>i>=0);if(!start.length)return null;
      const hit=walk(start,useLoose).filter(h=>h.node.type==='actuator'&&!h.node.drive&&(gears||h.belts>0)&&!skip?.(h.node)).sort((a,b)=>a.hops-b.hops)[0];
      return hit?{actuator:hit.node,belts:hit.belts,hops:hit.hops,refs:hit.path.flatMap(n=>n.refs||[n.ref]).filter(Boolean)}:null;}
    // The actuators whose output is on a joint's axis (a servo under the gear it turns, a gearbox on its shaft). A motor's
    // own axis is its longest side, so a motor beside a shaft is not on it. joint: {axis, origin}.
    function onAxis(joint,{skip}={}){const ax=joint?.axis,o=joint?.origin;if(!Array.isArray(ax)||!Array.isArray(o))return [];const k=ax.findIndex(v=>Math.abs(v)>.9);if(k<0)return [];const across=[0,1,2].filter(x=>x!==k);
      return actuators.filter(a=>!a.drive&&!skip?.(a)&&(a.kind==='dcmotor'?dims(a.box).indexOf(Math.max(...dims(a.box)))===k:true)&&across.every(x=>o[x]>=a.box[x]-tol&&o[x]<=a.box[x+3]+tol)&&a.box[k]-reach<=o[k]+reach*4&&a.box[k+3]+reach>=o[k]-reach*4);}
    // ---- what turns with what, and how fast. Stricter than the links above, which only ask what powers a part: here a
    // boxes-touching guess would spin the wrong thing. Locked: on one line, a part on a rod (a rod on a turned turret lies at a
    // small angle, so its box is a little wider), a hub on a rod, a stack of gears, a motor's output. A mesh: two round gears in
    // one plane, teeth just touching; it turns the other way by the teeth. A belt: pulleys in its plane share its speed. A right
    // angle: two gears whose axes meet; but a gear between two others on one line is a differential, which has two ways to go, so
    // the drive stops there. A gear with a bearing in its bore turns freely on its shaft.
    const crossing=ax=>[0,1,2].filter(k=>k!==ax),pulley=p=>/pulley|sprocket/i.test(p.name),toothed=p=>p.type==='gear'&&!pulley(p)&&/gear|pinion|spur|bevel|miter|mitre|\bmod\b/i.test(p.name);
    const lineAxis=nodes.map((p,i)=>p.type==='shaft'&&!rod(p.box)?axisOf(p.box,false):axes[i]),isRod=p=>p.type==='shaft'&&rod(p.box);
    const onLine=(line,b,ax)=>{const c=center(b);return crossing(ax).every(k=>c[k]>=line[k]-tol&&c[k]<=line[k+3]+tol);};
    const looksRound=(b,ax)=>{const [u,v]=crossing(ax).map(k=>b[k+3]-b[k]);return Math.abs(u-v)<=.22*Math.max(u,v);};
    const bearings=(parts||[]).filter(p=>/bearing/i.test(p.name||'')&&Array.isArray(p.box)&&p.box.every(finite));
    const onBearing=(g,ax)=>bearings.some(b=>{const c=center(b.box),m=center(g.box),r=radius(g.box,ax),inside=Math.min(b.box[ax+3],g.box[ax+3])-Math.max(b.box[ax],g.box[ax]),own=b.box[ax+3]-b.box[ax];return crossing(ax).every(k=>Math.abs(c[k]-m[k])<=Math.max(.2*r,tol))&&radius(b.box,ax)<r&&own>0&&inside>=.5*own;});
    const axesMeet=(i,j)=>{const k=[0,1,2].find(x=>x!==lineAxis[i]&&x!==lineAxis[j]),a=center(nodes[i].box),b=center(nodes[j].box);return Math.abs(a[k]-b[k])<=.55*Math.min(radius(nodes[i].box,lineAxis[i]),radius(nodes[j].box,lineAxis[j]));};
    function locked(i,j){const a=nodes[i],b=nodes[j],ax=lineAxis[i],bx=lineAxis[j],types=[a.type,b.type].sort().join('+');
      if(types==='actuator+gear'||types==='actuator+shaft'){const [m,p,mx,px]=a.type==='actuator'?[a,b,ax,bx]:[b,a,bx,ax];if(m.kind==='dcmotor')return mx===px&&onLine(m.box,p.box,mx)&&along(m.box,p.box,mx,reach);return !isRod(p)&&touch(m.box,p.box)&&onLine(m.box,p.box,px);}
      if(ax!==bx)return false;
      if(types==='gear+gear')return coaxial(a,b,ax,bx)&&(pulley(a)&&pulley(b)||touch(a.box,b.box));
      if(types==='gear+shaft'){const [r,g]=a.type==='shaft'?[a,b]:[b,a];if(onBearing(g,ax))return false;return isRod(r)?onLine(r.box,g.box,ax)&&along(r.box,g.box,ax,tol):coaxial(r,g,ax,bx)&&touch(r.box,g.box,tol*2);}
      if(types==='shaft+shaft'){if(isRod(a)&&isRod(b))return (onLine(a.box,b.box,ax)||onLine(b.box,a.box,ax))&&along(a.box,b.box,ax,reach);const [r,h]=isRod(a)?[a,b]:[b,a];return isRod(r)?onLine(r.box,h.box,ax)&&along(r.box,h.box,ax,tol):coaxial(a,b,ax,bx)&&touch(a.box,b.box);}
      if(types==='gear+wheel'||types==='shaft+wheel')return coaxial(a,b,ax,bx);
      return false;}
    const teethOf=name=>{const t=/(\d{1,3})\s*(?:t\b|tooth|teeth)/i.exec(String(name||''))||/^(\d{1,3})\s+pinion/i.exec(String(name||''));return t?+t[1]:0;};
    let driveLinks=null,rigidRoot=null;
    function buildDrive(){driveLinks=nodes.map(()=>[]);const add=(i,j,how)=>{driveLinks[i].push({j,how});driveLinks[j].push({j:i,how});},angled=nodes.map(()=>[]);
      for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j];if(a.type==='actuator'&&b.type==='actuator')continue;
        if(a.type==='belt'||b.type==='belt'){const [belt,g,gi]=a.type==='belt'?[a,b,j]:[b,a,i];const ax=lineAxis[gi];if(g.type==='gear'&&!toothed(g)&&onBelt(belt.box,g.box,ax)&&g.box[ax+3]>=belt.box[ax]&&g.box[ax]<=belt.box[ax+3])add(i,j,'belt');continue;}
        if(locked(i,j)){add(i,j,'rigid');continue;}if(!toothed(a)||!toothed(b))continue;
        if(lineAxis[i]===lineAxis[j]){const ax=lineAxis[i],ca=center(a.box),cb=center(b.box),gap=Math.hypot(...crossing(ax).map(k=>ca[k]-cb[k])),sum=radius(a.box,ax)+radius(b.box,ax),ta=teethOf(a.name),tb=teethOf(b.name),pitch=ta&&tb?radius(a.box,ax)*ta/(ta+2)+radius(b.box,ax)*tb/(tb+2):0;const slim=p=>teethOf(p.name)||p.box[ax+3]-p.box[ax]<=2.4*radius(p.box,ax);if(along(a.box,b.box,ax)&&looksRound(a.box,ax)&&looksRound(b.box,ax)&&slim(a)&&slim(b)&&(pitch?Math.abs(gap/pitch-1)<=.035:gap<=sum*1.06&&gap>=sum*.85))add(i,j,'mesh');}
        else if(touch(a.box,b.box)&&axesMeet(i,j)){angled[i].push(j);angled[j].push(i);}}
      const spider=nodes.map(()=>false);nodes.forEach((_,k)=>{for(const x of angled[k])for(const y of angled[k])if(x<y&&lineAxis[x]===lineAxis[y]&&onLine(nodes[x].box,nodes[y].box,lineAxis[x]))spider[k]=spider[x]=spider[y]=true;});
      angled.forEach((list,i)=>{for(const j of list)if(i<j)add(i,j,spider[i]||spider[j]?'differential':'angle');});
      rigidRoot=nodes.map((_,i)=>i);const root=i=>rigidRoot[i]===i?i:rigidRoot[i]=root(rigidRoot[i]);driveLinks.forEach((list,i)=>{for(const {j,how} of list)if(how==='rigid')rigidRoot[root(i)]=root(j);});nodes.forEach((_,i)=>root(i));}
    const heldBy=(i,start)=>nodes.some((n,k)=>n.type==='actuator'&&k!==start&&rigidRoot[k]===rigidRoot[i]);
    const ratioAcross=(i,j)=>{const ta=teethOf(nodes[i].name),tb=teethOf(nodes[j].name);return ta&&tb?ta/tb:radius(nodes[i].box,lineAxis[i])/Math.max(radius(nodes[j].box,lineAxis[j]),1e-9);};
    // Which way a right angle turns the next gear: the two turn so that their teeth move together where they meet.
    function angleSign(i,j){const ci=center(nodes[i].box),cj=center(nodes[j].box),ax=lineAxis[i],bx=lineAxis[j],k=[0,1,2].find(x=>x!==ax&&x!==bx),meet=[0,0,0];meet[ax]=cj[ax];meet[bx]=ci[bx];meet[k]=(ci[k]+cj[k])/2;return Math.sign(ci[ax]-meet[ax])*Math.sign(cj[bx]-meet[bx])*(((ax+1)%3===bx)?-1:1)*-1||-1;}
    // Everything an actuator turns: the groups locked together, each with its speed in turns per turn of the actuator (signed
    // about the group's axis, +x, +y or +z), the rods and gears in it, what rides on its rod (wheels, spacers, the pieces of a
    // star wheel), and the parts where the drive stopped.
    function spread(actuator){const start=index.get(actuator);if(start===undefined)return {groups:[],stopped:[]};if(!driveLinks)buildDrive();
      const speed=new Map([[start,1]]),queue=[start],stopped=new Set(),beltFrom=new Map();
      while(queue.length){const i=queue.shift();for(const {j,how} of driveLinks[i]){const m=nodes[j];if(j===start)continue;if(how==='differential'||m.type==='actuator'||how!=='rigid'&&m.type!=='belt'&&heldBy(j,start)){stopped.add(j);continue;}
          let w;if(m.type==='belt'){if(!speed.has(j)){speed.set(j,0);beltFrom.set(j,i);queue.push(j);}continue;}
          if(nodes[i].type==='belt'){const src=beltFrom.get(i);if(j===src)continue;w=speed.get(src)*ratioAcross(src,j);}
          else if(how==='mesh')w=-speed.get(i)*ratioAcross(i,j);else if(how==='angle')w=angleSign(i,j)*speed.get(i)*ratioAcross(i,j);else w=speed.get(i);
          if(!speed.has(j)){speed.set(j,w);if(m.type!=='wheel')queue.push(j);}else if(Math.abs(speed.get(j)-w)>.05*Math.abs(w))stopped.add(j);}}
      const seen=new Set(),groups=[];for(const [i] of speed){if(seen.has(i)||nodes[i].type==='belt')continue;const members=[],stack=[i];seen.add(i);
        while(stack.length){const k=stack.pop();members.push(k);for(const {j,how} of driveLinks[k])if(how==='rigid'&&speed.has(j)&&!seen.has(j)&&nodes[j].type!=='belt'&&nodes[j].type!=='actuator'){seen.add(j);stack.push(j);}}
        const turning=members.filter(k=>nodes[k].type!=='actuator');if(!turning.length)continue;
        const line=turning.find(k=>isRod(nodes[k]))??turning.find(k=>nodes[k].type==='gear')??turning[0],ax=lineAxis[line];
        groups.push({speed:speed.get(i),axis:ax,center:center(nodes[line].box),refs:turning.flatMap(k=>nodes[k].refs||[nodes[k].ref]).filter(Boolean),names:turning.map(k=>nodes[k].name),hasActuator:members.length>turning.length,boxes:turning.map(k=>nodes[k].box),rods:turning.filter(k=>isRod(nodes[k])).map(k=>nodes[k].box),nodes:members});}
      const out={groups,stopped:[...stopped].map(k=>nodes[k].name)};for(const g of groups)Object.assign(g,riders(g));return out;}
    // What rides on a group's line without being a gear or a shaft: a wheel, a spacer, or the pieces of a star wheel arranged
    // around it (three curved tubes on a hub), whose middle is on the line though none of them is.
    const NOT_RIDER=/bearing|screw|bolt|\bnut\b|rivet|washer|standoff|bracket|channel|plate|block|mount|wall|rail|guide|frame|bump|sensor/i;
    const loosePieces=(parts||[]).filter(p=>Array.isArray(p.box)&&p.box.length===6&&p.box.every(finite)&&p.name&&!transmissionOf(p.name)&&!NOT_RIDER.test(p.name));
    function riders(g){const ax=g.axis,lo=Math.min(...g.boxes.map(b=>b[ax])),hi=Math.max(...g.boxes.map(b=>b[ax+3])),big=size*.2,lines=g.rods.length?g.rods:g.boxes,near=loosePieces.filter(p=>p.box[ax+3]>=lo-tol&&p.box[ax]<=hi+tol&&radius(p.box,ax)<=big);
      const refs=[],names=[],take=p=>{if(p.ref&&!refs.includes(p.ref)){refs.push(p.ref);names.push(p.name);}},clean=n=>String(n).replace(/\s*<\d+>$/,'');
      const onIt=c=>lines.some(l=>crossing(ax).every(k=>c[k]>=l[k]-tol*2&&c[k]<=l[k+3]+tol*2));
      for(const p of near)if(looksRound(p.box,ax)&&onIt(center(p.box)))take(p);
      const sets=new Map();for(const p of near){const c=center(p.box),key=clean(p.name)+'@'+Math.round(c[ax]/(tol*4));if(!sets.has(key))sets.set(key,[]);sets.get(key).push(p);}
      for(const list of sets.values()){if(list.length<2)continue;const cs=list.map(p=>center(p.box)),mid=[0,1,2].map(k=>cs.reduce((t,c)=>t+c[k],0)/cs.length),far=cs.map(c=>Math.hypot(...crossing(ax).map(k=>c[k]-mid[k])));if(far.some(d=>Math.abs(d-far[0])>.3*Math.max(far[0],1e-9))||far[0]>big)continue;if(onIt(mid)&&far[0]>tol)for(const p of list)take(p);}
      return {riders:refs,riderNames:names};}
    return {actuators,from,onAxis,spread};}
  // What each motor's train adds to a model that already has its rollers, feeders and flywheels as joints. A shaft reached by a
  // motor turns with it at its speed: a shaft holding one of those joints gives that joint its ratio to the motor, and any
  // other becomes a follower of it. A shaft two motors reach at different speeds has two ways to go, so it is left alone.
  // joints: the model's; leavesOf(joint): the '#n' refs of its parts. Returns [{actuator, primaries: [{joint, speed, extra}],
  // followers: [{of: a joint's id, ratio, axis: 0, 1 or 2, origin, refs, names}]}].
  function spinPlan(train,joints,leavesOf){
    const spinning=(joints||[]).filter(j=>j.type==='continuous'&&['roller','feeder','flywheel'].includes(j.drive?.signal)),reached=new Map(),plans=[];
    for(const a of train.actuators){if(a.drive)continue;const r=train.spread(a);for(const g of r.groups)for(const ref of g.refs){if(!reached.has(ref))reached.set(ref,[]);reached.get(ref).push({a,speed:Math.abs(g.speed)});}
      const owner=g=>spinning.find(j=>{if(j.drive.signal==='flywheel'&&a.kind!=='dcmotor')return false;const own=leavesOf(j);return [...g.refs,...g.riders].some(x=>own.has(x));});
      const held=r.groups.map(g=>({g,joint:owner(g)})),first=held.find(x=>x.joint);if(!first)continue;
      plans.push({actuator:a,primaries:held.filter(x=>x.joint).map(x=>({joint:x.joint,speed:x.g.speed,extra:[...x.g.refs,...x.g.riders].filter(y=>!leavesOf(x.joint).has(y))})),
        followers:held.filter(x=>!x.joint).map(x=>({of:first.joint.id,ratio:x.g.speed/first.g.speed,axis:x.g.axis,leadAxis:first.g.axis,origin:x.g.center,refs:[...x.g.refs,...x.g.riders],names:x.g.names,rides:x.g.riders.length}))});}
    const twoWays=f=>f.refs.some(ref=>{const by=reached.get(ref)||[];return by.length>1&&by.some(x=>Math.abs(x.speed-by[0].speed)>.05*by[0].speed);});
    for(const p of plans)p.followers=p.followers.filter(f=>!twoWays(f));
    return plans;}
  // What powers a moving part, from the CAD's geometry alone, by the strongest evidence there is. joints: this device's
  // joints with the ones geared to them (Discovery's couplings); refs: their own parts, not the assemblies they carry.
  // 1. Every actuator on one of their axes, as two servos on one gear both are. 2. The nearest through sure links (belts,
  // chains, meshes, shafts). 3. The nearest through loose ones, with sure:false so the team is asked to check it. The
  // caller falls back on the assembly it sits in and its name (assignCad). Returns {actuators, belts, hops, how, sure,
  // refs: the parts of the path} or null.
  function powerOf(train,joints,refs,fits){
    const on=[];for(const j of joints||[])for(const a of train.onAxis(j,{skip:x=>!fits(x)}))if(!on.includes(a))on.push(a);
    if(on.length)return {actuators:on,belts:0,hops:0,how:'axis',sure:true,refs:on.flatMap(a=>a.refs||[])};
    for(const useLoose of [false,true]){const hit=train.from(refs,{skip:a=>!fits(a),gears:true,useLoose});if(hit&&hit.hops<=CHAIN_HOPS)return {actuators:[hit.actuator],belts:hit.belts,hops:hit.hops,how:'train',sure:!useLoose,refs:hit.refs};}
    return null;}
  // Feeders named only as "feeding" (one indexer running across the robot) go to the shooter they sit nearest, by what powers
  // them: rollers on one motor stay together. feeders: [{id, origin, power: an id for what powers it}]; shooters: their
  // flywheel's origin, or null. A shooter left without a group takes the nearest one (they share it). Returns ids per shooter.
  function feedersByShooter(feeders,shooters){
    const groups=new Map();for(const f of feeders){if(!groups.has(f.power))groups.set(f.power,[]);groups.get(f.power).push(f);}
    const list=[...groups.values()],mid=g=>[0,1,2].map(k=>g.reduce((s,f)=>s+f.origin[k],0)/g.length),gap=(a,b)=>b?Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]):Infinity;
    const out=shooters.map(()=>[]),pairs=[];list.forEach((g,i)=>shooters.forEach((s,k)=>pairs.push({i,k,d:gap(mid(g),s)})));pairs.sort((a,b)=>a.d-b.d);
    const took=new Set(),filled=new Set();for(const p of pairs){if(took.has(p.i)||filled.has(p.k)||p.d===Infinity)continue;took.add(p.i);filled.add(p.k);out[p.k]=list[p.i].map(f=>f.id);}
    list.forEach((g,i)=>{if(took.has(i))return;const near=pairs.find(p=>p.i===i&&p.d<Infinity);if(near)out[near.k].push(...g.map(f=>f.id));});
    shooters.forEach((s,k)=>{if(out[k].length)return;const near=pairs.find(p=>p.k===k&&p.d<Infinity);if(near)out[k]=list[near.i].map(f=>f.id);});
    return out;}
  // ---- an offline port plan -------------------------------------------------------------------------------------------
  const problem=(level,keys,text)=>({level,keys,text}),lowerLabel=s=>String(s||'').replace(/^[A-Z](?![A-Z])/,c=>c.toLowerCase());
  // A problem with where something is plugged in: Setup's to fix, and none of the simulation's business.
  const portProblem=(level,keys,text)=>({...problem(level,keys,text),port:true});
  // Ports to try, in order, for one row on one hub: touch sensors on odd digital channels and REV potentiometers on even
  // analog ones (REV's wiring); other switches take even channels first, keeping odd ones for touch sensors; a fast
  // encoder takes encoder port 0 or 3 first; I2C devices start at bus 1 (bus 0 has the hub's IMU).
  function portOrder(row,hub){const n=count(hub,row.family==='encoder'?'encoder':row.family),all=Array.from({length:n},(_,i)=>i);
    if(row.family==='i2c')return all.filter(i=>i>0);if(row.channels==='odd')return all.filter(i=>i%2);if(row.channels==='even')return all.filter(i=>i%2===0);
    if(row.family==='digital')return [...all.filter(i=>i%2===0),...all.filter(i=>i%2)];if(row.family==='encoder')return [0,3,1,2].filter(i=>i<n);return all;}
  // Hubs to try for a row: drive motors on the Control Hub first, other motors on the Expansion Hub first, servos on the
  // Control Hub, then a Servo Hub, then the Expansion Hub; sensors on the hub of what they measure first.
  function hubOrder(row,hubs,near){
    const of=kind=>hubs.filter(h=>hubKind(h)===kind),exp=of('expansion'),servo=of('servoHub');
    const order=row.family==='motor'?(row.role==='drive'||row.role==='imu'?['control',...exp]:[...exp,'control']):row.family==='servo'?['control',...servo,...exp]:['control',...exp];
    const ok=order.filter(h=>count(h,row.family)>0);return near&&ok.includes(near)?[near,...ok.filter(h=>h!==near)]:ok;}
  // A port for every row the team has not wired, around the ones they have: {assign: {[key]: {hub, port|bus, channel?,
  // wired, label, via?, conflict?}}, problems: [{level: red|amber, keys, text}]}. Rows that share a name (an odometry pod
  // read through its drive motor's name) share a port. A sensor on an encoder input shares the motor port it is on when
  // that motor does not read its own encoder (the robot reads it through that motor's name: via); with no motor there,
  // the configuration gets a motor entry under the sensor's name for it.
  function plan(rowList,wiring){
    const w=sanitizeWiring(wiring)||EMPTY(),hubs=hubIds(w);
    const list=(rowList||[]).filter(r=>r&&r.key&&r.family&&!(r.role==='sensor'&&r.kind==='motorEncoder')),used=new Map(),assign={},problems=[],byName=new Map();
    const at=r=>assign[r.key],label=(r,p)=>portLabel(p,r.family,w);
    const slots=(r,p)=>{if(r.family==='i2c')return [`${p.hub}:i2c:${p.bus}`];if(r.family==='encoder')return [`${p.hub}:encoder:${p.port}`];
      return [`${p.hub}:${r.family}:${p.port}`,...(r.family==='motor'&&r.encoder?[`${p.hub}:encoder:${p.port}`]:[])];};
    // Who holds a slot, and whether r may share it: the same name, or OctoQuad sensors on one OctoQuad.
    const clash=(r,p)=>{for(const s of slots(r,p)){const o=used.get(s);if(o&&o!==r&&!(o.name===r.name&&o.family===r.family)&&!(o.kind==='octoquad'&&r.kind==='octoquad'))return o;}
      if(r.family==='encoder'){const m=used.get(`${p.hub}:motor:${p.port}`);if(m&&(m.encoder||m.role==='pod'))return m;}return null;};
    const take=(r,p,wired)=>{for(const s of slots(r,p))if(!used.has(s))used.set(s,r);let via;
      if(r.family==='encoder'){const m=used.get(`${p.hub}:motor:${p.port}`);if(m&&m!==r&&!m.encoder)via=m.name;else used.set(`${p.hub}:motor:${p.port}`,r);}
      assign[r.key]={...p,wired,label:label(r,p),...(via?{via}:{})};if(r.family==='motor')byName.set(r.name,assign[r.key]);};
    const hubOk=(r,p)=>p.hub==='control'||hubs.includes(p.hub);
    // 1. What the team wired, where they wired it.
    for(const r of list){if(!r.hub)continue;const p={hub:r.hub,...(r.family==='i2c'?{bus:r.bus??r.port}:{port:r.port}),...(r.channel!==undefined?{channel:r.channel}:{})},n=count(p.hub,r.family);
      if(!hubOk(r,p)){problems.push(portProblem('red',[r.key],`${r.label} is wired to the ${hubSpec(p.hub)?.name||'hub'}, which this robot does not have.`));continue;}
      const port=r.family==='i2c'?p.bus:p.port;if(!(Number.isInteger(port)&&port>=0&&port<n)){problems.push(portProblem('red',[r.key],`${hubName(p.hub,w)} has no ${FAMILIES[r.family]} ${port} for ${r.label}${n?'':`: it has no ${FAMILIES[r.family]}s`}.`));continue;}
      const o=clash(r,p);if(o){problems.push(portProblem('red',[o.key,r.key],`${label(r,p)} is used by ${o.label} and ${r.label}.`));assign[r.key]={...p,wired:true,label:label(r,p),conflict:true};continue;}
      take(r,p,true);}
    // 2. The rest, devices before the sensors that may share their ports.
    const rest=list.filter(r=>!at(r)&&!(r.hub&&problems.some(x=>x.keys.includes(r.key)&&!x.keys[1])));
    for(const r of [...rest.filter(r=>r.role!=='sensor'),...rest.filter(r=>r.role==='sensor')]){
      if(r.role==='imu'){const p={hub:'control',bus:0},o=clash(r,p);if(o)problems.push(portProblem('red',[o.key,r.key],`Control Hub I2C bus 0 has the hub’s own IMU; ${o.label} cannot go there.`));else take(r,p,false);continue;}
      const same=r.family==='motor'&&byName.get(r.name);if(same){assign[r.key]={...same,wired:false};continue;}
      // A sensor goes on the hub of what it measures; one on an encoder input first on that motor's own port (read through
      // its name) when the port counts in hardware or nothing else is free.
      const near=r.for?(at({key:r.for})||{}).hub:null,mine=r.family==='encoder'&&list.find(x=>x.key===r.for)?.family==='motor'?at({key:r.for}):null,own=mine&&{hub:mine.hub,port:mine.port};let placed=null;
      if(own&&(!r.fast||hubSpec(own.hub).fastEncoders?.includes(own.port))&&!clash(r,own))placed=own;
      if(!placed)for(const hub of hubOrder(r,hubs,near)){
        if(r.kind==='octoquad'){const q=Object.entries(assign).find(([k,a])=>a.hub===hub&&list.find(x=>x.key===k)?.kind==='octoquad');
          if(q){const busy=new Set(list.filter(x=>x.kind==='octoquad'&&at(x)?.hub===hub&&at(x)?.bus===q[1].bus).map(x=>at(x).channel));const ch=[0,1,2,3,4,5,6,7].find(c=>!busy.has(c));if(ch!==undefined){placed={hub,bus:q[1].bus,channel:ch};break;}}}
        for(const port of portOrder(r,hub)){const p=r.family==='i2c'?{hub,bus:port,...(r.kind==='octoquad'?{channel:0}:{})}:{hub,port};if(!clash(r,p)){placed=p;break;}}if(placed)break;}
      if(!placed&&own&&!clash(r,own))placed=own;
      // An odometry pod with no motor port of its own goes on the encoder input of a motor that does not read its own
      // encoder (usually a drive motor): the robot reads it through that motor's name.
      if(!placed&&r.role==='pod'){const m=[...used.entries()].find(([slot,o])=>/:motor:/.test(slot)&&o.family==='motor'&&!o.encoder&&o.role!=='pod'&&!used.has(slot.replace(':motor:',':encoder:')));
        if(m){const [hub,,port]=m[0].split(':'),p={hub,port:+port};used.set(`${hub}:encoder:${port}`,r);assign[r.key]={...p,wired:false,label:label(r,p),via:m[1].name};
          problems.push(problem('amber',[r.key],`${r.label} goes on the encoder input of ${label(r,p)}, beside "${m[1].name}": the code reads it as "${r.name}", so name it "${m[1].name}" in Robot controller → Device names.`));continue;}}
      if(!placed){const fam=FAMILIES[r.family];problems.push(portProblem('amber',[r.key],`No ${fam} is free for ${r.label}.${r.family==='motor'?(w.hubs.expansion?' Run a roller on a continuous servo, or free a motor port.':' Add an Expansion Hub, or run a roller on a continuous servo.'):r.family==='servo'?(w.hubs.servoHub?' Free a servo port.':' Add a Servo Hub or an Expansion Hub.'):w.hubs.expansion?'':' Add an Expansion Hub.'}`));continue;}
      take(r,placed,false);
      if(r.fast&&r.family==='encoder'&&!hubSpec(placed.hub).fastEncoders.includes(placed.port))problems.push(problem('amber',[r.key],`${r.label} is on ${assign[r.key].label}: ports 1 and 2 count in software and can miss counts from its ${SENSOR_MODELS[r.model]?.cpr||8192} a turn. Encoder ports 0 and 3 are taken.`));}
    return {assign,problems};
  }
  // Rows with their planned ports filled in (planned: Deck picked it).
  function placed(rowList,wiring){const {assign}=plan(rowList,wiring);return rowList.map(r=>{const a=assign[r.key];if(!a)return r;const {label,wired,...p}=a;return {...r,...p,portLabel:label,...(wired?{}:{planned:true})};});}
  // ---- problems -------------------------------------------------------------------------------------------------------
  // Everything wrong or worth a look in a robot's wiring: red for what cannot work (two devices on one port, a model
  // that is not what the mechanism runs on, a touch sensor on an even channel), amber for what to check.
  function conflicts(rowList,wiring,{others,guessed,power}={}){
    const w=sanitizeWiring(wiring)||EMPTY(),list=rowList||[],out=[],keys=new Set(list.map(r=>r.key));
    for(const r of list){const role=ROLES[r.role],md=MODELS[r.model];
      if(md&&r.role!=='sensor'){
        if(md.kind!==r.kind&&!(md.kind==='linear'&&r.kind==='servo')&&r.role!=='pod')out.push(problem('red',[r.key],`${r.label} is set to run on ${A_KIND[r.kind]||r.kind}, but its model, ${md.short}, is ${A_KIND[md.kind]||md.kind}.`));
        else if(role&&role.kinds.length&&!role.kinds.includes(md.kind))out.push(problem('red',[r.key],`A ${role.name.toLowerCase()} cannot run on ${md.short}.`));
        if(md.legal===false)out.push(problem('amber',[r.key],`${md.short} on ${r.label} is not on the 2026-27 pre-verified list: bring its data sheet to inspection.`));
        if(md.simulated===false&&!finite(md.cpr))out.push(problem('amber',[r.key],`Enter the counts a turn of ${md.short} on ${r.label}: Deck has no figure for it.`));}
      if(r.role==='sensor'){const dev=list.find(x=>x.key===r.for),allowed=dev?ROLES[dev.role]?.sensors||{}:null;
        if(!dev&&!/^kin\./.test(r.for||''))out.push(problem('amber',[r.key],`${r.label} measures a device this robot no longer has.`));
        else if(allowed&&!Object.hasOwn(allowed,r.kind))out.push(problem(dev.role==='flywheel'?'red':'amber',[r.key],dev.role==='flywheel'?`${dev.label}: only its motor’s own encoder can read its speed (a ${SENSOR_MODELS[r.model]?.short||'sensor'} overflows the hub’s speed reading).`:`Deck’s robot code does not use a ${SENSOR_MODELS[r.model]?.short||r.kind} on ${dev.label.toLowerCase()}.`));
        if(r.kind==='axonFeedback'&&dev){const dm=MODELS[dev.model];if(dev.kind!=='servo'&&dev.kind!=='crservo')out.push(problem('amber',[r.key],`${r.label}: the feedback wire comes from an Axon servo, and ${dev.label.toLowerCase()} runs on ${A_KIND[dev.kind]||dev.kind}.`));
          else if(dm&&dm.feedback!=='analog')out.push(problem('amber',[r.key],`${r.label}: ${dm.short} has no feedback wire; pick an Axon for ${dev.label.toLowerCase()}, or another sensor.`));}
        if(r.hub&&r.channels==='odd'&&r.port%2===0)out.push(portProblem('red',[r.key],`${r.label} is on ${portLabel(r,r.family,w)}; it reads only on odd digital channels (1, 3, 5 and 7).`));
        if(r.hub&&r.channels==='even'&&r.port%2===1)out.push(portProblem('red',[r.key],`${r.label} is on ${portLabel(r,r.family,w)}; it reads only on even analog channels (0 and 2).`));
        if(r.hub&&r.fast&&!hubSpec(r.hub)?.fastEncoders?.includes(r.port))out.push(problem('amber',[r.key],`${r.label} is on ${portLabel(r,r.family,w)}: ports 1 and 2 count in software and can miss counts from a Through Bore. Use encoder port 0 or 3.`));}
      const needs=role?.needs?.[r.kind];if(needs&&!list.some(s=>s.for===r.key&&needs.includes(s.kind))&&!w.sensors.some(s=>s.for===r.key&&needs.includes(SENSOR_MODELS[s.model]?.kind)))
        out.push(problem('amber',[r.key],`${r.label} turns on a continuous servo: give it a sensor that tells where it is (an Axon’s feedback wire or an absolute encoder), or it can only run for set times.`));}
    for(const s of w.sensors)if(!keys.has(`sensor.${s.id}`)&&SENSOR_MODELS[s.model]?.kind!=='motorEncoder'&&!list.some(r=>r.key===s.for)&&list.length)out.push(problem('amber',[`sensor.${s.id}`],`Sensor "${s.id}" measures a device this robot no longer has.`));
    // BIOBUZZ R503: 8 motors and 8 servos at most; one belted to two mechanisms (one name) counts once. Over the limit is
    // red (level 'limit') so the team changes the robot, but the simulation still runs it. others: the CAD's motors and
    // servos that power nothing Deck models (cadOthers). guessed: keys of devices the CAD does not show, on Deck's default
    // until the team picks one. They never make a robot illegal: over the limit only with them is amber, to pick what they are.
    // power: what the CAD's transmission shows, so two servos on one gear count as two.
    const isGuess=r=>(guessed||[]).includes(r.key)&&!r.model,units=rs=>{const byName=new Map();for(const r of rs)byName.set(r.name||r.key,Math.max(byName.get(r.name||r.key)||1,power?.[r.key]?.count||1));return [...byName.values()].reduce((a,b)=>a+b,0);},otherMotors=(others||[]).filter(o=>o.kind==='dcmotor').length,extra={motor:otherMotors,servo:(others||[]).length-otherMotors};
    for(const [family,word,fix] of [['motor','motors',', or belt two mechanisms to one motor'],['servo','servos','']]){const all=list.filter(r=>r.family===family&&r.role!=='pod'&&r.role!=='sensor'),sure=all.filter(r=>!isGuess(r)),count=units(sure)+extra[family],total=units(all)+extra[family];
      if(count>8)out.push(problem('limit',sure.map(r=>r.key),`The robot has ${count} ${word}; the game allows 8 (R503). Take ${count-8} off${fix}.`));
      else if(total>8)out.push({...problem('amber',all.filter(isGuess).map(r=>r.key),`Your CAD does not show what powers ${all.filter(isGuess).map(r=>lowerLabel(r.label)).join(', ')}. Pick a motor or servo for each.`),check:true});}
    // R701: a Control Hub and at most one Expansion Hub. A bench robot may have more, so it is a warning.
    const exp=hubsOfKind(w.hubs,'expansion').length;if(exp>1)out.push(problem('amber',[],`${exp} Expansion Hubs work on the bench, but a competition robot may have only one with its Control Hub (R701).`));
    for(let n=1;n<=(w.hubs.spm||0);n++){const on=list.filter(r=>r.spm===n);if(on.length>SPM.ports)out.push(problem('amber',on.map(r=>r.key),`${on.length} servos go through Servo Power Module ${n}, which has ${SPM.ports} ports.`));}
    const seen=new Set(out.map(p=>p.text));for(const p of plan(list,w).problems)if(!seen.has(p.text)){seen.add(p.text);out.push(p);}
    return out;
  }
  // The export's device list (DeckSimFtc.robotNeeds rows) with what Setup says of each: wired {hub, port|bus} and the
  // model with its configuration tag, for RobotConfig.check (moved, retype) and RobotConfig.planPorts (wired first).
  function wire(needs,wiring){const w=sanitizeWiring(wiring)||EMPTY();return (needs||[]).map(n=>{const e=w.devices[settingKey(n.setting)];if(!e)return n;
    return {...n,...(e.hub?{wired:{hub:e.hub,...(e.bus!==undefined?{bus:e.bus}:{port:e.port})}}:{}),...(e.model?{model:e.model,xmlType:MODELS[e.model].xmlType}:{})};});}
  // Rows (from placed(), so a sensor read through a motor's name is known) as RobotConfig.check needs them: every device
  // the robot's configuration must have under its name, sensors included; wired only where the team put it.
  const needs=rowList=>(rowList||[]).filter(r=>r.need&&r.name&&!r.via&&r.kind!=='motorEncoder').map(r=>({name:r.name,need:r.need,device:r.device,label:r.label,setting:r.setting||(r.role==='sensor'?{sensor:r.id}:undefined),
    ...(r.hub&&r.wired===true?{wired:{hub:r.hub,...(r.bus!==undefined?{bus:r.bus}:{port:r.port})}}:{}),...(r.model&&r.xmlType?{model:r.model,xmlType:r.xmlType}:{}),...(r.channels?{channels:r.channels}:{}),...(r.fast?{fast:true}:{}),...(r.pwm?{pwm:r.pwm}:{})}));
  // ---- plain words ----------------------------------------------------------------------------------------------------
  const lower=s=>String(s||'').replace(/^[A-Z](?![A-Z])/,c=>c.toLowerCase());
  // One sentence on a row: what it is, where it is plugged in, and what its sensors tell ("Axon MAX on Control Hub servo
  // port 2; its feedback wire on analog port 0 tells where shooter 1 hood is."). Pass rows from placed() for planned ports.
  function explain(row,wiring){
    if(!row)return '';const w=wiring?sanitizeWiring(wiring)||EMPTY():null,md=MODELS[row.model],sm=SENSOR_MODELS[row.model],where=row.hub?portLabel(row,row.family,w)+(row.spm?`, through Servo Power Module ${row.spm} (6 V)`:''):'',at=where?` on ${where}`:': Deck picks its port';
    if(row.role==='imu')return `${row.label} "${row.name}": the Control Hub’s own IMU, on I2C bus 0. It tells which way the robot faces.`;
    if(row.role==='sensor'){const what=lower(String(row.label).split(':')[0]),via=row.via?` It is read through "${row.via}", the motor on that port.`:'';
      return `${sm?.short||'Sensor'} "${row.name}"${at}. It tells ${(TELLS[row.use]||TELLS.position)(what)}.${via}`;}
    const thing=row.role==='pod'?'Odometry pod':md?.short||{dcmotor:'Motor',servo:'Servo',crservo:'Continuous servo',linear:'Linear servo',pinpoint:'goBILDA Pinpoint',otos:'SparkFun OTOS'}[row.kind]||'Device';
    const tells=(row.sensors||[]).filter(s=>SENSOR_MODELS[s.model]).map(s=>{const k=SENSOR_MODELS[s.model],how=(TELLS[s.use]||TELLS.position)(lower(row.label)),on=!s.hub?'':s.hub===row.hub&&k.family!=='i2c'?` on ${FAMILIES[k.family]} ${s.port}`:` on ${portLabel(s,k.family,w)}`;
      return k.kind==='motorEncoder'?`its encoder tells ${how}`:k.kind==='axonFeedback'?`its feedback wire${on} tells ${how}`:`a ${lower(k.short)}${on} tells ${how}`;});
    const from=row.from?` Your CAD shows it driven by ${row.from}.`:'';
    return `${thing} "${row.name}"${at}${tells.length?'; '+tells.join('; '):''}.${from}${ROLES[row.role]?.explain&&!row.hub&&!tells.length&&!from?' '+ROLES[row.role].explain:''}`;
  }
  return {HUBS,SPM,MAX_CHAINED,MAX_SPM,hubKind,hubSpec,hubIndex,hubId,hubIds,hubsOfKind,FAMILIES,MODELS,ACTUATORS,MOTORS,SERVOS,CRSERVOS,LINEARS,SENSORS,SENSOR_MODELS,ROLES,USES,DEVICE_KEYS,DRIVE_SLOTS,modelsFor,sensorsFor,xmlTypeOf,familyOfKind,
    fromCadName,assignCad,chainOf,powerOf,feedersByShooter,cadOthers,cadSensors,driveTrain,spinPlan,pictureTag,transmissionOf,settingKey,parseKey,sanitizeWiring,wiringOf,reindex,prune,hubName,portLabel,rows,plan,placed,conflicts,wire,needs,explain};
});
