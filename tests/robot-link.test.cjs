'use strict';
// Send to robot: a Control Hub's robot configuration read over Robocol and checked against every device name an export
// uses, and the export uploaded and built with the hub's OnBot Java server. Runs against the simulated Control Hub
// (tools/ftc-sim.cjs), which answers the same commands and routes as FTC SDK 12.0.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const RobotConfig=require('../ui/ftc/robot-config.js'),Hardware=require('../ui/sim-hardware.js'),C=require('../ui/sim-config.js'),F=require('../ui/sim-ftc.js'),Mech=require('../ui/sim-mechanisms.js'),P=require('../ui/sim-planner.js'),X=require('../ui/sim-export.js');
const {startUdpRobot,startOnBotJava,CONFIG_XML,SENSOR_CONFIG_XML,HUBS,OP_MODES}=require('../tools/ftc-sim.cjs'),{readRobot,writeConfiguration,runCheck,OnBotJava,send,buildErrors,buildProblem,debugCurrent,debugSource,DEBUG_FILE,formEncode,checkHost}=require('../src/robot-link.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const {FtcSocket}=require('../src/ftc.cjs'),robot={drivetrain:'mecanum',length:17,width:17,heightIn:12,driveRpm:312,intakeIn:0};
// The simulated robot and this station use their own loopback addresses (Robocol needs port 20884 on both ends), so these
// tests can run beside ftc.test.cjs, which uses 127.0.0.1 and 127.0.0.2.
const ROBOT='127.0.0.4',station=()=>new FtcSocket(ROBOT,{localAddress:'127.0.0.5'}).open();
const read=async(options={})=>{const socket=await station();try{return await readRobot(ROBOT,{...options,socket});}finally{await socket.close();}};

test('a robot configuration: every device with its kind, hub and port',()=>{
  const c=RobotConfig.parse(CONFIG_XML);
  assert.deepEqual(c.hubs.map(h=>[h.name,h.address]),[['Expansion Hub 2',2],['Control Hub',173]]);
  assert.deepEqual(c.devices.map(d=>[d.name,d.kind,d.hub,d.port]),[['shooter','motor','Expansion Hub 2',0],['indexer','motor','Expansion Hub 2',1],['turret','motor','Expansion Hub 2',2],['intake','motor','Expansion Hub 2',3],
    ['front_left','motor','Control Hub',0],['front_right','motor','Control Hub',1],['back_left','motor','Control Hub',2],['back_right','motor','Control Hub',3],['imu','imu','Control Hub',0],['pinpoint','pinpoint','Control Hub',0]]);
  assert.equal(c.devices.find(d=>d.name==='pinpoint').bus,1);
  // Servos, continuous servos, a SPARK Mini, entities in names, comments, and motor types added after this list.
  const other=RobotConfig.parse(`<?xml version="1.0"?><!-- a comment <Servo name="ghost"/> --><Robot type="FirstInspires-FTC"><LynxUsbDevice name="Portal" serialNumber="(embedded)" parentModuleAddress="173"><LynxModule name="Control Hub" port="173">
    <Servo name="kicker" port="0"/><ServoFullRange name="gate" port="1"/><ContinuousRotationServo name="roller &amp; belt" port="2"/><RevSPARKMini name="spark" port="3"/><goBILDA5203NewSeriesMotor name="new" port="0"/><RevColorSensorV3 name="color" port="0" bus="2"/></LynxModule></LynxUsbDevice><Webcam name="Webcam 1" serialNumber="SN1"/></Robot>`);
  assert.deepEqual(other.devices.map(d=>[d.name,d.kind]),[['kicker','servo'],['gate','servo'],['roller & belt','crservo'],['spark','crservo'],['new','motor'],['color','color'],['Webcam 1','webcam']]);
  assert.throws(()=>RobotConfig.parse('<html></html>'),/not an FTC robot configuration/);
});

test('the check: names the export uses against the robot, with suggestions, wrong kinds and the setting to change',()=>{
  const m=Mech.sanitize({enabled:true}),needs=F.robotNeeds(robot,'fused',m);
  assert.deepEqual(needs.map(n=>[n.name,n.need]),[['front_left','motor'],['front_right','motor'],['back_left','motor'],['back_right','motor'],['imu','imu'],['pinpoint','pinpoint'],['intake','motorOrCr'],['shooter','motor'],['indexer','motorOrCr'],['turret','motor']]);
  assert.deepEqual(needs.find(n=>n.name==='turret').setting,{list:'shooters',index:0,field:'turretMotor'});assert.deepEqual(needs[0].setting,{robot:'frontLeft'});
  const all=RobotConfig.check(needs,RobotConfig.parse(CONFIG_XML));assert.equal(all.ok,true,JSON.stringify(all.rows.filter(r=>r.status!=='ok')));assert.deepEqual(all.unused,[]);
  // A robot configured with the Pedro Quickstart's drive names, a continuous servo intake and a servo turret.
  const theirs=RobotConfig.parse(CONFIG_XML.replace('"front_left"','"leftFront"').replace('"front_right"','"rightFront"').replace('"back_left"','"leftRear"').replace('"back_right"','"rightRear"')
    .replace('<goBILDA5202SeriesMotor name="intake" port="3" />','<ContinuousRotationServo name="Intake" port="0" />').replace('<goBILDA5202SeriesMotor name="turret" port="2" />','<Servo name="turret" port="1" />'));
  const r=RobotConfig.check(needs,theirs),row=name=>r.rows.find(x=>x.name===name);assert.equal(r.ok,false);
  assert.deepEqual(['front_left','front_right','back_left','back_right'].map(n=>row(n).suggestion),['leftFront','rightFront','leftRear','rightRear'],'drive names that mean the same wheel');
  assert.equal(row('intake').suggestion,'Intake','a continuous servo fits an intake roller, and the name differs only in case');
  assert.equal(row('turret').status,'kind');assert.match(RobotConfig.explain(row('turret')),/is a servo on the robot; the code needs a motor\. In Mechanisms, set the turret to turn on a servo\./);
  assert.equal(row('shooter').status,'ok');assert.match(RobotConfig.explain(row('shooter')),/"shooter" is a motor on Expansion Hub 2, port 0\./);
  // A robot device is suggested once, and a name already in use goes last.
  const two=RobotConfig.check([{name:'intake',need:'motorOrCr',label:'A'},{name:'intake2',need:'motorOrCr',label:'B'}],RobotConfig.parse('<Robot><LynxModule name="Control Hub" port="173"><ContinuousRotationServo name="Intake" port="0"/></LynxModule></Robot>'));
  assert.deepEqual(two.rows.map(x=>x.suggestion??null),['Intake',null]);
  // Two Deck devices of different kinds under one name.
  const dup=RobotConfig.check([{name:'arm',need:'motor',label:'Turret'},{name:'arm',need:'servo',label:'Kicker'}],{devices:[]});assert.match(RobotConfig.explain(dup.rows[1]),/also the name Deck uses for turret/);
  assert.deepEqual(RobotConfig.tokens('left_front_drive'),RobotConfig.tokens('frontLeftMotor'));assert.deepEqual(RobotConfig.tokens('LF'),['front','left']);assert.notDeepEqual(RobotConfig.tokens('intake2'),RobotConfig.tokens('intake'));
});

test('sensors, a Servo Hub and a Limelight: each device on its own kind of port',()=>{
  const c=RobotConfig.parse(SENSOR_CONFIG_XML),device=n=>c.devices.find(d=>d.name===n);
  assert.deepEqual(['wristAngle','liftHome','turretHome','slot','extendDistance','limelight','hood','wrist','imu'].map(n=>device(n).kind),['analog','touch','digital','color','distance','limelight','servo','servo','imu']);
  assert.deepEqual(device('hood').module,{portal:'(embedded)',address:3,servoHub:true});assert.equal(device('limelight').module,undefined,'a Limelight is on no hub');
  assert.deepEqual(['wristAngle','liftHome','turretHome','slot','hood','lift'].map(n=>RobotConfig.portsTaken(device(n))),[['(embedded)#2:analog:0'],['(embedded)#2:digital:1'],['(embedded)#2:digital:2'],['(embedded)#2:i2c:1.0'],['(embedded)#3:servo:0'],['(embedded)#2:motor:0']]);
  const modules=RobotConfig.modulesOf(c);assert.deepEqual(modules.map(m=>[m.name,!!m.parent,!!m.servoHub]),[['Expansion Hub 2',false,false],['Control Hub',true,false],['Servo Hub 3',false,true]]);
  // Analog and digital devices get ports of their own: a REV potentiometer an even analog channel, a touch sensor an odd
  // digital one and other switches an even one first; I2C past the buses taken; servos on the Control Hub, then the Servo Hub.
  const adds=[{name:'armAngle',label:'Arm angle',device:'analog'},{name:'armPot',label:'Arm pot',device:'analog',channels:'even'},{name:'armHome',label:'Arm home',device:'touch'},{name:'gate',label:'Gate',device:'digital'},
    {name:'intakeColor',label:'Intake colour',device:'color'},...Array.from({length:7},(_,i)=>({name:'s'+i,label:'S'+i,device:'servo'}))];
  const plan=RobotConfig.planPorts(adds,{modules,devices:c.devices});assert.deepEqual(plan.problems,[]);
  assert.deepEqual(plan.assignments.map(a=>[a.name,RobotConfig.portLabel(a),a.tag]).slice(0,5),[['armAngle','Control Hub analog port 0','AnalogInput'],['armPot','Control Hub analog port 2','AnalogInput'],['armHome','Control Hub digital port 1','RevTouchSensor'],
    ['gate','Control Hub digital port 0','DigitalDevice'],['intakeColor','Control Hub I2C bus 3','RevColorSensorV3']]);
  assert.deepEqual(plan.assignments.slice(-2).map(RobotConfig.portLabel),['Control Hub servo port 5','Servo Hub 3 servo port 1'],'the Servo Hub’s port 0 has the hood');
  // Added inside each hub where the SDK would write them, the Servo Hub too.
  const xml=RobotConfig.addDevices(SENSOR_CONFIG_XML,plan.assignments),after=RobotConfig.parse(xml);assert.equal(after.devices.length,c.devices.length+adds.length);
  assert.match(xml,/<ServoHub name="Servo Hub 3" port="3">\n            <Servo name="hood" port="0" \/>\n            <Servo name="s6" port="1" \/>\n        <\/ServoHub>/);
  assert.match(xml,/<goBILDAPinpoint name="pinpoint" port="0" bus="1" \/>\n            <REV_VL53L0X_RANGE_SENSOR name="extendDistance" port="0" bus="2" \/>\n(            <[^\n]+\n){11}        <\/LynxModule>/);
  // The check: a sensor of the right kind is ok; a REV Touch Sensor where the code reads a digital device is not, and says how to fix it.
  const check=RobotConfig.check([{name:'wristAngle',need:'analog',label:'Wrist angle'},{name:'liftHome',need:'digital',label:'Lift home'},{name:'extendDistance',need:'distance',label:'Extension'},{name:'slot',need:'distance',label:'Slot'}],c);
  assert.deepEqual(check.rows.map(r=>r.status),['ok','kind','ok','ok'],'a colour sensor V3 reads distance too');
  assert.match(RobotConfig.explain(check.rows[1]),/"liftHome" is a touch sensor on the robot; the code needs a digital device\. Set it to "Digital Device" in Configure Robot/);
  assert.ok(check.unused.some(d=>d.name==='turretHome'&&d.kind==='digital'),'unused sensors are listed too');
  // With the hubs' devices written back in the SDK's order (motors, servos, analog, digital, I2C; the Servo Hub after the
  // hubs), it is the configuration the fixture has, line for line, but for the Limelight, which a scan configures.
  const portals=[{serial:'(embedded)',modules:[{address:173,parent:true,imu:'BHI260'},{address:2,parent:false,imu:'NONE'}],servoHubs:[{address:3}]}],scanned=RobotConfig.modulesFromScan(portals);
  const DEVICE={analog:'analog',touch:'touch',digital:'digital',color:'color',distance:'distance'};
  const back=c.devices.filter(d=>d.module).map(d=>({name:d.name,device:DEVICE[d.kind]||d.kind,tag:d.tag,module:scanned.find(m=>m.address===d.module.address),port:d.port,...(d.bus!==undefined?{bus:d.bus}:{})}));
  assert.equal(RobotConfig.newConfiguration(portals,[...back].reverse()),SENSOR_CONFIG_XML.replace(/    <EthernetDevice[^\n]*\n/,''));
});

test('Setup’s wiring: a device lands on the port Setup gave it, a taken port or a missing hub is a problem, the rest plan around it',()=>{
  const portals=HUBS.map(h=>RobotConfig.lynxModules(JSON.stringify({serialNumber:h.serial,modules:h.modules}))),modules=RobotConfig.modulesFromScan(portals),m=Mech.sanitize({enabled:true,intakes:[{kind:'ramp',sides:['front'],motor:'intake',servo:'ramp'}]});
  const wiring={devices:{'intakes.0.motor':{hub:'expansion',port:0},'shooters.0.turretMotor':{hub:'expansion',port:0},'intakes.0.servo':{hub:'servoHub',port:0},'robot.frontLeft':{hub:'control',port:3,model:'rev-core-hex'}}};
  const needs=Hardware.wire(F.robotNeeds(robot,'fused',m),C.robot({wiring:{hubs:{expansion:{},servoHub:{}},...wiring}}).wiring),adds=RobotConfig.missingDevices(RobotConfig.check(needs,{devices:[]}).rows);
  assert.deepEqual(adds.find(a=>a.name==='front_left'),{name:'front_left',label:'Front left drive motor',device:'motor',setting:{robot:'frontLeft'},wired:{hub:'control',port:3},model:'rev-core-hex',xmlType:'RevRoboticsCoreHexMotor'});
  const {assignments,problems}=RobotConfig.planPorts(adds,{modules});
  assert.deepEqual(assignments.map(a=>[a.name,RobotConfig.portLabel(a),a.tag,!!a.fixed]),[['front_left','Control Hub motor port 3','RevRoboticsCoreHexMotor',true],['front_right','Control Hub motor port 0','goBILDA5202SeriesMotor',false],
    ['back_left','Control Hub motor port 1','goBILDA5202SeriesMotor',false],['back_right','Control Hub motor port 2','goBILDA5202SeriesMotor',false],['imu','Control Hub I2C bus 0','ControlHubImuBHI260AP',false],
    ['pinpoint','Control Hub I2C bus 1','goBILDAPinpoint',false],['intake','Expansion Hub 2 motor port 0','goBILDA5202SeriesMotor',true],['shooter','Expansion Hub 2 motor port 1','goBILDA5202SeriesMotor',false],['indexer','Expansion Hub 2 motor port 2','goBILDA5202SeriesMotor',false]]);
  assert.deepEqual(problems,['Intake 1 ramp: Setup has it on a Servo Hub, which the robot does not have.','Shooter 1 turret: Expansion Hub 2 motor port 0 has "intake".']);
  // A device Setup placed keeps its port when sending (change it in Setup); another device cannot be swapped onto it.
  assert.deepEqual(RobotConfig.portChoices(assignments,0,{modules}),[]);
  const choices=RobotConfig.portChoices(assignments,assignments.findIndex(a=>a.name==='shooter'),{modules});assert.deepEqual(choices.find(c=>c.label==='Expansion Hub 2 motor port 0').taken,'intake');
  // Setup's port on a hub of the robot's configuration that is already taken, and a touch sensor on an even channel.
  const config=RobotConfig.parse(CONFIG_XML),own=RobotConfig.modulesOf(config,portals);
  const taken=RobotConfig.planPorts([{name:'kicker',label:'Kicker',device:'servo',wired:{hub:'control',port:1}},{name:'arm',label:'Arm',device:'motor',wired:{hub:2,port:3}},{name:'home',label:'Home',device:'touch',wired:{hub:'control',port:2}}],{modules:own,devices:config.devices});
  assert.deepEqual(taken.assignments.map(a=>[a.name,RobotConfig.portLabel(a)]),[['kicker','Control Hub servo port 1']]);
  assert.deepEqual(taken.problems,['Arm: Expansion Hub 2 motor port 3 has "intake".','Home: it reads only on odd digital channels (1, 3, 5 and 7); Setup has it on Control Hub digital port 2.']);
});

test('the check says when a device is on another port than Setup has it, or configured as another motor type',()=>{
  const wiring=C.robot({wiring:{devices:{'robot.frontLeft':{hub:'control',port:1,model:'rev-ultra-20'},'shooters.0.motor':{hub:'expansion',port:0,model:'gobilda-5203-6000'},'robot.pinpoint':{hub:'control',bus:2}}}}).wiring;
  const needs=Hardware.wire(F.robotNeeds(robot,'fused',Mech.sanitize({enabled:true})),wiring),r=RobotConfig.check(needs,RobotConfig.parse(CONFIG_XML)),row=n=>r.rows.find(x=>x.name===n);
  assert.equal(r.ok,true,'the names all match, so the code runs');
  assert.deepEqual(row('front_left').moved,{hub:'control',port:1,label:'Control Hub motor port 1'});assert.equal(row('front_left').retype,'RevRoboticsUltraplanetaryHDHexMotor');
  assert.equal(row('shooter').moved,undefined,'where Setup has it');assert.equal(row('shooter').retype,undefined,'a goBILDA motor is the type Configure Robot has');
  assert.deepEqual(row('pinpoint').moved,{hub:'control',bus:2,label:'Control Hub I2C bus 2'});
  assert.equal(RobotConfig.explain(row('front_left')),`"front_left" is a motor on Control Hub, port 0. Setup has it on Control Hub motor port 1: plug it in there, or change Setup to match the robot. It is configured as goBILDA Yellow Jacket; Setup's motor is REV UltraPlanetary HD Hex, which sets the SDK's encoder resolution and default PIDF.`);
  assert.equal(RobotConfig.explain(row('pinpoint')),'"pinpoint" is a goBILDA Pinpoint on Control Hub, I2C bus 1. Setup has it on Control Hub I2C bus 2: plug it in there, or change Setup to match the robot.');
});

test('a configuration with no robot to scan: the Control Hub, an Expansion Hub on RS485 and a Servo Hub, read back as written',()=>{
  const wiring={hubs:{expansion:{address:4},servoHub:{address:5}},devices:{'shooters.0.hood':{model:'axon-max',hub:'servoHub',port:2},'shooters.0.turretMotor':{model:'rev-core-hex',hub:'expansion',port:3}},
    sensors:[{id:'hoodAngle',model:'axon-feedback',for:'shooters.0.hood'},{id:'liftHome',model:'rev-touch',for:'kin.liftMotor'},{id:'slot',model:'rev-color-v3',for:'intakes.0.motor',hub:'expansion',bus:2},{id:'turretTb',model:'rev-through-bore',for:'shooters.0.turretMotor'}]};
  const project={robot:C.robot({drivetrain:'mecanum',wiring}),sensors:{localization:'fused'},mechanisms:Mech.sanitize({enabled:true,shooters:[{type:'turret',hood:'hood'}]}),
    kinematics:{joints:[{id:'arm',name:'Arm'}],actuators:[{id:'liftMotor',name:'Lift',joint:'arm',kind:'dcmotor',model:'gobilda-5203-435',device:'lift'},{id:'claw',name:'Claw',joint:'arm',kind:'servo',model:'gobilda-speed',servo:{pwm:[500,2500]}}]}};
  const rows=Hardware.placed(Hardware.rows(project),project.robot.wiring),{xml,problems}=RobotConfig.configurationFor(rows,project.robot.wiring);
  assert.deepEqual(problems,['No motor port is free for "lift" (Lift). Add an Expansion Hub, or run a roller on a continuous servo.'],'eight motors fill both hubs');
  assert.equal(xml,`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<Robot type="FirstInspires-FTC">
    <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">
        <LynxModule name="Expansion Hub 4" port="4">
            <goBILDA5202SeriesMotor name="intake" port="0" />
            <goBILDA5202SeriesMotor name="shooter" port="1" />
            <goBILDA5202SeriesMotor name="indexer" port="2" />
            <RevRoboticsCoreHexMotor name="turret" port="3" />
            <RevColorSensorV3 name="intakePiece" port="0" bus="2" />
        </LynxModule>
        <LynxModule name="Control Hub" port="173">
            <goBILDA5202SeriesMotor name="front_left" port="0" />
            <goBILDA5202SeriesMotor name="front_right" port="1" />
            <goBILDA5202SeriesMotor name="back_left" port="2" />
            <goBILDA5202SeriesMotor name="back_right" port="3" />
            <ServoFullRange name="claw" port="0" />
            <AnalogInput name="hoodPosition" port="0" />
            <RevTouchSensor name="liftHome" port="1" />
            <ControlHubImuBHI260AP name="imu" port="0" bus="0" />
            <goBILDAPinpoint name="pinpoint" port="0" bus="1" />
        </LynxModule>
        <ServoHub name="Servo Hub 5" port="5">
            <Servo name="hood" port="2" />
        </ServoHub>
    </LynxUsbDevice>
</Robot>
`);
  // Read back: every device on the hub and port Setup or the plan gave it, and Deck's own check passes on it. The lift
  // has no motor port left (8 motors), so it is the one row missing, and Deck's plan says so first.
  const c=RobotConfig.parse(xml),placedRows=rows.filter(r=>r.hub&&!r.via&&r.kind!=='motorEncoder');
  for(const r of placedRows){const d=c.devices.find(x=>x.name===r.name);assert.ok(d,r.name);const hub={control:'Control Hub',expansion:'Expansion Hub 4',servoHub:'Servo Hub 5'}[r.hub];assert.equal(d.hub,hub,r.name);assert.equal(r.bus!==undefined?d.bus:d.port,r.bus??r.port,r.name);}
  assert.equal(rows.find(r=>r.key==='sensor.turretTb').via,'turret','the Through Bore is read through the turret motor’s own port');
  const check=RobotConfig.check(Hardware.needs(rows),c);assert.deepEqual(check.rows.filter(r=>r.status!=='ok').map(r=>r.name),['lift']);assert.ok(check.rows.every(r=>!r.moved));
  assert.match(Hardware.plan(Hardware.rows(project),project.robot.wiring).problems[0].text,/No motor port is free for Lift/);
  // A Control Hub alone, with an older IMU.
  assert.match(RobotConfig.configurationFor([{name:'imu',device:'imu',label:'IMU'},{name:'arm',device:'motor',label:'Arm',hub:'control',port:2}],{},{imu:'BNO055'}).xml,
    /<LynxModule name="Control Hub" port="173">\n            <goBILDA5202SeriesMotor name="arm" port="2" \/>\n            <LynxEmbeddedIMU name="imu" port="0" bus="0" \/>\n        <\/LynxModule>\n    <\/LynxUsbDevice>/);
});

test('Send to robot reads the active configuration over Robocol, as a Driver Station does',async t=>{
  let robot2;try{robot2=await startUdpRobot({address:ROBOT});}catch(e){t.skip(ROBOT+' loopback is unavailable: '+e.message);return;}
  t.after(()=>robot2.close());
  const r=await read();assert.deepEqual(r.active,{name:'competition',dirty:false});assert.deepEqual(r.configurations,['competition']);assert.equal(r.devices.length,10);assert.equal(r.xml,CONFIG_XML);
  assert.ok(r.opModes.length>0,'the op mode list comes along');
  // No active configuration on the robot: nothing to check against, and that is said.
  robot2.sim.active='No Config Set';const none=await read();assert.equal(none.active,null);assert.deepEqual(none.devices,[]);
});

test('adding devices to a configuration: free ports on the right hubs, and nothing already there changed',()=>{
  const portals=HUBS.map(h=>RobotConfig.lynxModules(JSON.stringify({serialNumber:h.serial,modules:h.modules}))),config=RobotConfig.parse(CONFIG_XML),modules=RobotConfig.modulesOf(config,portals);
  assert.deepEqual(modules.map(m=>[m.name,m.parent,m.imu]),[['Expansion Hub 2',false,'BNO055'],['Control Hub',true,'BHI260']]);
  // The setup adds a kicker servo and a second flywheel motor to the robot in CONFIG_XML, whose eight motor ports are full.
  const m=Mech.sanitize({enabled:true,intakes:[{kind:'kicker',sides:['front'],motor:'intake',servo:'kicker'}],shooters:[{type:'turret',mount:'center',motor:'shooter',motor2:'shooter2',indexer:'indexer',turretMotor:'turret'}]});
  const adds=RobotConfig.missingDevices(RobotConfig.check(F.robotNeeds(robot,'fused',m),config).rows);
  assert.deepEqual(adds.map(a=>[a.name,a.device]),[['kicker','servo'],['shooter2','motor']]);
  const plan=RobotConfig.planPorts(adds,{modules,devices:config.devices});
  assert.deepEqual(plan.assignments.map(a=>[a.name,RobotConfig.portLabel(a),a.tag]),[['kicker','Control Hub servo port 0','Servo']]);
  assert.deepEqual(plan.problems,['No motor port is free for "shooter2" (Shooter 1 second flywheel motor). Add an Expansion Hub, or run a roller on a continuous servo.']);
  const xml=RobotConfig.addDevices(CONFIG_XML,plan.assignments);
  assert.equal(xml,CONFIG_XML.replace('            <goBILDAPinpoint name="pinpoint" port="0" bus="1" />\n','$&            <Servo name="kicker" port="0" />\n'),'one line added inside the Control Hub, everything else as it was');
  // Sensors start at I2C bus 1, past the hub's IMU; a port another device takes is skipped, and one name gets one port.
  const otos=RobotConfig.planPorts([{name:'sensor_otos',label:'SparkFun OTOS',device:'otos'},{name:'odo',label:'Pod',device:'motor'},{name:'odo',label:'Pod',device:'motor'}],{modules,devices:config.devices.filter(d=>d.name!=='intake')});
  assert.deepEqual(otos.assignments.map(a=>[a.name,RobotConfig.portLabel(a),a.tag]),[['sensor_otos','Control Hub I2C bus 2','SparkFunOTOS'],['odo','Expansion Hub 2 motor port 3','goBILDA5202SeriesMotor']]);
  // A team's own device type might be on a motor or a servo port, so neither is offered; digital devices take neither.
  const own=RobotConfig.parse(CONFIG_XML.replace('<goBILDAPinpoint','<MyServoThing name="thing" port="0" />\n            <RevTouchSensor name="touch" port="1" />\n            <goBILDAPinpoint'));
  assert.deepEqual(RobotConfig.planPorts([{name:'a',label:'A',device:'servo'},{name:'b',label:'B',device:'servo'}],{modules,devices:own.devices}).assignments.map(a=>a.port),[1,2]);
  // A hub's IMU type decides its tag; a hub the scan did not report gets none, and the reason is given.
  const imu=[{name:'imu',label:'IMU',device:'imu'}],bare={modules:RobotConfig.modulesOf(RobotConfig.parse('<Robot><LynxUsbDevice name="P" serialNumber="(embedded)" parentModuleAddress="173"><LynxModule name="Control Hub" port="173" /></LynxUsbDevice></Robot>'),portals)};
  assert.equal(RobotConfig.planPorts(imu,bare).assignments[0].tag,'ControlHubImuBHI260AP');
  assert.match(RobotConfig.planPorts(imu,{modules:bare.modules.map(h=>({...h,imu:'UNKNOWN'}))}).problems[0],/could not tell which IMU Control Hub has/);
  // A name with an XML escape or a ; cannot travel in CMD_SAVE_CONFIGURATION, which the robot splits at ;.
  assert.throws(()=>RobotConfig.addDevices(CONFIG_XML.replace('"shooter"','"shooter &amp; feeder"'),plan.assignments),/cannot be sent to the robot/);
  assert.equal(RobotConfig.configurationName('competition Deck',['Competition Deck','competition Deck 2']),'competition Deck 3');assert.equal(RobotConfig.configurationName('Deck lunala: red/auto'),'Deck lunala red auto');
  assert.equal(RobotConfig.validName('competition Deck'),true);for(const bad of ['a;b',' a','a/b','',null,'x'.repeat(41)])assert.equal(RobotConfig.validName(bad),false,String(bad));
});

test('a configuration for a robot that has none: every hub the scan found, in the SDK\'s own layout, and ports to swap',()=>{
  const portals=HUBS.map(h=>RobotConfig.lynxModules(JSON.stringify({serialNumber:h.serial,modules:h.modules}))),modules=RobotConfig.modulesFromScan(portals);
  assert.deepEqual(modules.map(m=>[m.name,m.parent]),[['Control Hub',true],['Expansion Hub 2',false]]);
  const needs=F.robotNeeds(robot,'fused',Mech.sanitize({enabled:true}));
  let {assignments,problems}=RobotConfig.planPorts(RobotConfig.missingDevices(RobotConfig.check(needs,{devices:[]}).rows),{modules});assert.deepEqual(problems,[]);
  assert.deepEqual(assignments.map(a=>[a.name,RobotConfig.portLabel(a)]),[['front_left','Control Hub motor port 0'],['front_right','Control Hub motor port 1'],['back_left','Control Hub motor port 2'],['back_right','Control Hub motor port 3'],
    ['imu','Control Hub I2C bus 0'],['pinpoint','Control Hub I2C bus 1'],['intake','Expansion Hub 2 motor port 0'],['shooter','Expansion Hub 2 motor port 1'],['indexer','Expansion Hub 2 motor port 2'],['turret','Expansion Hub 2 motor port 3']],'drive motors on the Control Hub, mechanism motors on the Expansion Hub');
  // Moving a device onto another planned device's port swaps them; a configured device's port is refused.
  const at=name=>assignments.findIndex(a=>a.name===name),choices=RobotConfig.portChoices(assignments,at('intake'),{modules});
  assert.deepEqual(choices.filter(c=>c.swap).map(c=>[c.label,c.swap]).slice(0,2),[['Control Hub motor port 0','front_left'],['Control Hub motor port 1','front_right']]);
  for(const [name,port] of [['shooter',0],['indexer',1],['turret',2]])assignments=RobotConfig.movePort(assignments,at(name),choices.find(c=>c.module.address===2&&c.port===port).key,{modules});
  assert.equal(RobotConfig.portLabel(assignments[at('intake')]),'Expansion Hub 2 motor port 3');
  const arm=[{name:'arm',kind:'motor',module:{portal:'(embedded)',address:173},port:1}],armPort=RobotConfig.portChoices(assignments,0,{modules,devices:arm}).find(c=>c.taken);
  assert.equal(armPort.label,'Control Hub motor port 1');assert.throws(()=>RobotConfig.movePort(assignments,0,armPort.key,{modules,devices:arm}),/has "arm"/);
  // With the fixture's names and ports, it is the configuration Configure Robot saved (CONFIG_XML), line for line.
  assert.equal(RobotConfig.newConfiguration(portals,assignments),CONFIG_XML);
  assert.equal(RobotConfig.withType(assignments[0],'RevRoboticsCoreHexMotor').tag,'RevRoboticsCoreHexMotor');
  // An Expansion Hub on its own USB cable is a second portal, and the Control Hub stays the parent.
  const usb=RobotConfig.modulesFromScan([...portals,{serial:'DQ12AB34',modules:[{address:3,parent:true,imu:'BNO055'}]}]);assert.deepEqual(usb.map(m=>[m.name,m.parent]),[['Control Hub',true],['Expansion Hub 2',false],['Expansion Hub 3',false]]);
  assert.match(RobotConfig.newConfiguration([...portals,{serial:'DQ12AB34',modules:[{address:3,parent:true,imu:'BNO055'}]}],[]),/<LynxUsbDevice name="Expansion Hub Portal 1" serialNumber="DQ12AB34" parentModuleAddress="3">\n        <LynxModule name="Expansion Hub 3" port="3" \/>/);
  assert.deepEqual(RobotConfig.lynxSerials('{"map":[{"key":"(embedded)","value":"LYNX_USB_DEVICE"},{"key":"UVC:046D:0825","value":"WEBCAM"}]}'),['(embedded)']);
});

test('Send to robot scans the hubs and saves a new configuration as the active one, never over a saved one',async t=>{
  let robot2;try{robot2=await startUdpRobot({address:ROBOT});}catch(e){t.skip(ROBOT+' loopback is unavailable: '+e.message);return;}
  t.after(()=>robot2.close());
  const r=await read({scan:true});assert.deepEqual(r.portals,[{serial:'(embedded)',modules:[{address:173,parent:true,imu:'BHI260'},{address:2,parent:false,imu:'BNO055'}]}]);
  const plan=RobotConfig.planPorts([{name:'kicker',label:'Intake 1 kicker',device:'servo'}],{modules:RobotConfig.modulesOf(r,r.portals),devices:r.devices}),xml=RobotConfig.addDevices(r.xml,plan.assignments);
  const write=async(name,text)=>{const socket=await station();try{return await writeConfiguration(ROBOT,{name,xml:text},{socket});}finally{await socket.close();}};
  assert.deepEqual(await write('competition Deck',xml),{name:'competition Deck',devices:11,restarted:true});
  assert.equal(robot2.sim.active,'competition Deck');assert.equal(robot2.sim.restarts,1,'the robot restarts to build its hardware map from it');
  assert.equal(robot2.sim.configurations.find(c=>c.name==='competition').xml,CONFIG_XML,'the configuration it came from is kept as it was');
  const after=await read();assert.equal(after.active.name,'competition Deck');assert.deepEqual(after.configurations,['competition','competition Deck']);
  assert.ok(after.devices.some(d=>d.name==='kicker'&&d.kind==='servo'&&d.hub==='Control Hub'&&d.port===0));
  await assert.rejects(write('Competition deck',xml),/already has a configuration named “Competition deck”/);assert.equal(robot2.sim.restarts,1);
  await assert.rejects(write('bad;name',xml),/letters, digits, spaces/);
  await assert.rejects(write('other',xml.replace('"kicker"','"a;b"')),/cannot take a configuration with a ;/);
  // A robot with no configuration at all.
  robot2.sim.configurations=[];robot2.sim.active='No Config Set';const none=await read({scan:true});assert.equal(none.active,null);assert.equal(none.portals.length,1);
});

test('the guided check runs from Deck: INIT and START, answers pressed on gamepad 1, the results read back, then STOP',async t=>{
  // The simulated hub runs a stand-in for any op mode named "... check (Deck)": a wheel question, then a servo to move.
  let robot2;try{robot2=await startUdpRobot({address:ROBOT,opModes:[...OP_MODES,{flavor:'TELEOP',group:'Torque',name:'Test check (Deck)',source:'ONBOTJAVA'}]});}catch(e){t.skip(ROBOT+' loopback is unavailable: '+e.message);return;}
  t.after(()=>robot2.close());const socket=await station(),updates=[];
  try{
    const check=runCheck(ROBOT,'Test check (Deck)',{socket,onUpdate:u=>updates.push(u)});
    const seen=async test=>{const end=Date.now()+8000;while(Date.now()<end){const u=updates.at(-1);if(u&&test(u.lines||[]))return u;await delay(40);}throw Error('not seen; last: '+JSON.stringify(updates.at(-1)));};
    await seen(l=>l.includes('Answer : A: yes | B: no, the other way | X: nothing moved | Y: again'));assert.equal(robot2.sim.opState,'running','INIT, then START');
    assert.equal(check.press('b'),true);await seen(l=>l.some(x=>x.startsWith('Answer : D-pad up/down: move')));
    check.press('dpad_up');await delay(400);check.press('dpad_right');await seen(l=>l.some(x=>x.includes('Now at 0.460.')));
    // Controller 1 of this computer answers too, held as long as it is held.
    check.pad({buttons:Object.assign([],{0:{pressed:true}})});await delay(250);check.pad({buttons:[]});
    const done=await seen(l=>l.includes('Step : Done'));
    assert.deepEqual(F.checkResults(done.lines.find(x=>x.startsWith('Deck results : '))),{'robot.frontLeft.reversed':'false','intakes.0.downPos':'0.460'});
    assert.equal(check.press('start'),false,'only the buttons the check answers with');
    check.stop();assert.equal(await check.ended,'stopped');assert.equal(robot2.sim.opState,'stopped','Deck stops the op mode');assert.equal(check.press('a'),false);
    await assert.rejects(runCheck(ROBOT,'Missing check (Deck)',{socket}).ended,/The robot has no op mode “Missing check \(Deck\)”\. Send to robot first/);
  }finally{await socket.close();}
});

test('Send to robot refuses a robot that another Driver Station is using, and an address that is not one',async t=>{
  let robot2;try{robot2=await startUdpRobot({address:ROBOT,reject:true});}catch(e){t.skip(ROBOT+' loopback is unavailable: '+e.message);return;}
  t.after(()=>robot2.close());
  await assert.rejects(read(),/Another Driver Station is connected/);
  for(const bad of ['http://192.168.43.1','192.168.43.1:8080','a b','',null])assert.throws(()=>checkHost(bad),/Enter the robot address/);assert.equal(checkHost(' 192.168.43.1 '),'192.168.43.1');
});

test('Send to robot uploads the export with OnBot Java, builds it, keeps a copy of a file someone changed on the robot, and reports compile errors',async t=>{
  let onbot;try{onbot=await startOnBotJava({address:'127.0.0.2',port:0});}catch(e){t.skip('127.0.0.2 loopback is unavailable: '+e.message);return;}
  t.after(()=>onbot.close());const client=new OnBotJava('127.0.0.2',{port:onbot.port}),backupDir=fs.mkdtempSync(path.join(os.tmpdir(),'deck-robot-backups-'));
  // The real OnBot Java export: the autonomous and its check TeleOp.
  const start={x:9.83,y:27,heading:0},route=P.plan({start,zones:[],pins:[{x:40,y:30,action:'Shoot'}],clearance:2},{front:8.5,rear:8.5,half:8.5}),layout={name:'Send test',start,zones:[]};
  const out=F.onBotJava({route,layout,tuning:{},robot,localization:'fused',mechanisms:Mech.sanitize({enabled:true}),target:{x:59,y:58},setupName:'Send test',routeJava:X.java(route,layout,{polygon:P.polygon})});
  const progress=[],first=await send('127.0.0.2',out.files,{client,backupDir,onProgress:(stage,file)=>progress.push(stage+(file?' '+file:''))});
  assert.equal(first.built,true);assert.deepEqual(first.written,['PlannedRouteAuto.java','PlannedRouteCheck.java']);assert.deepEqual(first.backups,[]);assert.equal(onbot.counts.builds,1);
  assert.deepEqual([...onbot.files.keys()],['/src/org/firstinspires/ftc/teamcode/PlannedRouteAuto.java','/src/org/firstinspires/ftc/teamcode/PlannedRouteCheck.java']);
  assert.equal(onbot.files.get('/src/org/firstinspires/ftc/teamcode/PlannedRouteAuto.java'),out.source,'the file arrives exactly as exported');assert.deepEqual(progress,['uploading PlannedRouteAuto.java','uploading PlannedRouteCheck.java','building']);
  // Someone edited the autonomous in OnBot Java: sending again keeps their copy on this computer first.
  onbot.files.set('/src/org/firstinspires/ftc/teamcode/PlannedRouteAuto.java',out.source.replace('// Example: private DcMotorEx intake;','private int theirs;'));
  const again=await send('127.0.0.2',out.files,{client,backupDir});assert.equal(again.backups.length,1);assert.match(fs.readFileSync(again.backups[0],'utf8'),/private int theirs;/);assert.match(path.basename(again.backups[0]),/PlannedRouteAuto\.java$/);
  // Files in keep are written only when the robot does not have them yet.
  const kept=await send('127.0.0.2',{'org/firstinspires/ftc/teamcode/RobotActions.java':'class RobotActions {}'},{client,keep:['org/firstinspires/ftc/teamcode/RobotActions.java']});assert.deepEqual(kept.written,['RobotActions.java']);
  const keptAgain=await send('127.0.0.2',{'org/firstinspires/ftc/teamcode/RobotActions.java':'class RobotActions { int changed; }'},{client,keep:['org/firstinspires/ftc/teamcode/RobotActions.java']});assert.deepEqual([keptAgain.written,keptAgain.kept],[[],['RobotActions.java']]);
  // A build that fails reports each error with its file and line.
  const failing=await startOnBotJava({address:'127.0.0.2',port:0,compile:()=>['/src/org/firstinspires/ftc/teamcode/PlannedRouteAuto.java:42: error: cannot find symbol']});t.after(()=>failing.close());
  const bad=await send('127.0.0.2',out.files,{client:new OnBotJava('127.0.0.2',{port:failing.port})});assert.equal(bad.built,false);assert.deepEqual(bad.errors,[{file:'PlannedRouteAuto.java',line:42,message:'cannot find symbol'}]);
  // Whether the robot's Torque Debug is this one: only its name, which says when it went on, may differ. Nothing on the robot, or an older copy, is not.
  assert.deepEqual(await debugCurrent('127.0.0.2',{client}),{current:false,opMode:null});
  await client.save(DEBUG_FILE,debugSource('TorqueDebug-10.00-01-01-26').replace(/\n/g,'\r\n'));assert.deepEqual(await debugCurrent('127.0.0.2',{client}),{current:true,opMode:'TorqueDebug-10.00-01-01-26'},'its line endings do not matter');
  await client.save(DEBUG_FILE,debugSource('TorqueDebug-10.00-01-01-26').replace('STALL_MS = 400','STALL_MS = 500'));assert.deepEqual(await debugCurrent('127.0.0.2',{client}),{current:false,opMode:null},'an older copy');await client.remove(DEBUG_FILE).catch(()=>{});
  // Paths stay under /src as Java files.
  await assert.rejects(send('127.0.0.2',{'../evil.java':'x'},{client}),/not a Java source path/);
});

test('the OnBot Java form encoding and build log parsing',async()=>{
  const text='a+b = 100% & "quoted" \'single\' (x)*! é\r\nline';assert.equal(new URLSearchParams('data='+formEncode(text)).get('data'),text,'every character survives the robot\'s form decoding');
  assert.doesNotMatch(formEncode("!'()*"),/[!'()*]/);
  // OnBot Java's own log, as a real Control Hub wrote it.
  assert.deepEqual(buildErrors('org/firstinspires/ftc/teamcode/mySecondJavaOpModeFritz.java(49:9): ERROR: cannot find symbol\n  symbol:   variable imu'),[{file:'mySecondJavaOpModeFritz.java',line:49,message:'cannot find symbol: variable imu'}]);
  assert.deepEqual(buildErrors('Foo.java:3:5: error: ; expected\nnote: something\nsrc/org/Bar.java:10: error: incompatible types'),[{file:'Foo.java',line:3,message:'; expected'},{file:'Bar.java',line:10,message:'incompatible types'}]);
  // Exactly what a Control Hub on SDK 12.0 said about the old Torque Debug, and javac's own shape with the source line and caret between.
  const real='TorqueDebug.java(421:77): ERROR: cannot find symbol\n  symbol:   variable decisionMargin\n  location: variable d of type org.firstinspires.ftc.vision.apriltag.AprilTagDetection\nTorqueDebug.java(422:18): ERROR: cannot find symbol\n  symbol:   variable metadata\n  location: variable d of type org.firstinspires.ftc.vision.apriltag.AprilTagDetection\n';
  assert.deepEqual(buildErrors(real),[{file:'TorqueDebug.java',line:421,message:'cannot find symbol: variable decisionMargin'},{file:'TorqueDebug.java',line:422,message:'cannot find symbol: variable metadata'}]);
  assert.equal(buildErrors('Foo.java:3: error: cannot find symbol\n    x.y();\n    ^\n  symbol:   variable x\n  location: class Foo\n')[0].message,'cannot find symbol: variable x');
  // One line, saying whose file it is: OnBot Java builds them all, so a team's broken file stops Torque's too.
  assert.match(buildProblem(buildErrors(real)),/^Torque’s own program did not build on this robot \(TorqueDebug\.java line 421: cannot find symbol: variable decisionMargin\)\. This is not your code\./);
  const theirs=buildProblem(buildErrors('TorqueDebug.java(1:1): ERROR: x\nTeamAuto.java(12:4): ERROR: cannot find symbol\n  symbol:   method bar()\n'));assert.match(theirs,/^Your file TeamAuto\.java has an error on line 12: cannot find symbol: method bar\(\)\. OnBot Java builds every file together/);assert.match(theirs,/Torque did not change it/);
  assert.match(buildProblem([]),/OnBot Java page/);
  // Nothing listening: the message says where it looked and what to check.
  await assert.rejects(new OnBotJava('127.0.0.2',{port:9,timeout:2000}).available(),/Could not reach the robot's OnBot Java at http:\/\/127\.0\.0\.2:9.*Join the robot's Wi-Fi/);
});

test('Configure Robot from Deck over Wi-Fi: every configuration read, an edited one saved as new and active, another made active',async t=>{
  let robot;try{robot=await startUdpRobot({address:ROBOT});}catch(e){t.skip(ROBOT+' loopback is unavailable: '+e.message);return;}
  t.after(()=>robot.close());const {readConfigurations,activateConfiguration}=require('../src/robot-link.cjs');
  const withSocket=async f=>{const socket=await station();try{return await f(socket);}finally{await socket.close();}};
  const all=await withSocket(socket=>readConfigurations(ROBOT,{socket}));assert.deepEqual(all.active,{name:'competition'});assert.equal(all.files.competition,CONFIG_XML);
  // Rename the intake, move it to port 0's neighbour, add a touch sensor: the robot's XML as Configure Robot writes it.
  const devices=RobotConfig.parse(CONFIG_XML).devices.map(d=>d.name==='intake'?{...d,name:'roller'}:d);devices.push({name:'liftHome',tag:'RevTouchSensor',port:1,module:{portal:'(embedded)',address:173}});
  const xml=RobotConfig.rebuild(CONFIG_XML,devices);assert.match(xml,/<goBILDA5202SeriesMotor name="roller" port="3" \/>/);assert.match(xml,/<RevTouchSensor name="liftHome" port="1" \/>\n            <ControlHubImuBHI260AP/);
  assert.throws(()=>RobotConfig.rebuild(CONFIG_XML,[...devices,{...devices[0]}]),/Two devices are named/);
  const saved=await withSocket(socket=>writeConfiguration(ROBOT,{name:'competition Deck',xml},{socket}));assert.deepEqual(saved,{name:'competition Deck',devices:11,restarted:true});
  const back=await withSocket(socket=>activateConfiguration(ROBOT,'competition',{socket}));assert.deepEqual(back,{name:'competition',restarted:true});
  const now=await withSocket(socket=>readConfigurations(ROBOT,{socket}));assert.deepEqual(now.configurations.sort(),['competition','competition Deck']);assert.equal(now.active.name,'competition');
  await assert.rejects(withSocket(socket=>activateConfiguration(ROBOT,'nope',{socket})),/no configuration named/);
});

test('Setup checks the connection, replaces a configuration when editing it, and deletes one',async t=>{
  let robot;try{robot=await startUdpRobot({address:ROBOT});}catch(e){t.skip(ROBOT+' loopback is unavailable: '+e.message);return;}
  t.after(()=>robot.close());const {connectionCheck,deleteConfiguration,readConfigurations}=require('../src/robot-link.cjs');
  const withSocket=async f=>{const socket=await station();try{return await f(socket);}finally{await socket.close();}};
  const steps=await withSocket(socket=>connectionCheck(ROBOT,{socket}));assert.equal(steps[0].ok,true);assert.match(steps[0].detail,/FTC SDK/);assert.equal(steps[1].ok,true);assert.match(steps[1].detail,/configuration/);
  await assert.rejects(withSocket(socket=>writeConfiguration(ROBOT,{name:'competition',xml:CONFIG_XML},{socket})),/already has/);
  assert.equal((await withSocket(socket=>writeConfiguration(ROBOT,{name:'competition',xml:CONFIG_XML,replace:true},{socket}))).name,'competition');
  await withSocket(socket=>writeConfiguration(ROBOT,{name:'spare',xml:CONFIG_XML},{socket}));await withSocket(socket=>deleteConfiguration(ROBOT,'spare',{socket}));
  assert.ok(!(await withSocket(socket=>readConfigurations(ROBOT,{socket}))).configurations.includes('spare'));
  await assert.rejects(withSocket(socket=>deleteConfiguration(ROBOT,'nope',{socket})),/no configuration named/);
});
