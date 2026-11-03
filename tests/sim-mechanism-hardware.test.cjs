'use strict';
// Mechanism hardware: what each part runs on (motor or continuous servo rollers, one or two flywheel motors, velocity or
// power control, motor, servo pusher or servo gate feeders, motor or servo turrets), which way each device turns, and the
// check TeleOp. The generated code and the virtual Control Hub are built from one device list, and the virtual hub drives
// the game physics only when the code turns each device the way the setup says it is mounted.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Mech=require('../ui/sim-mechanisms.js'),P=require('../ui/sim-planner.js'),X=require('../ui/sim-export.js'),F=require('../ui/sim-ftc.js'),Pedro=require('../ui/sim-pedro.js'),C=require('../ui/sim-config.js'),{SimEngine}=require('../src/sim-engine.cjs');
const root=path.join(__dirname,'..'),built=fs.existsSync(path.join(root,'sim-runtime/dsim-host.cjs'))&&fs.existsSync(path.join(root,'sim-runtime/driver/classes/deck/sim/hub/VirtualHub.class'));
const robot={drivetrain:'mecanum',length:17,width:17,heightIn:12,driveRpm:312,intakeIn:0},start={x:9.83,y:27,heading:0},target={x:59.25,y:58.56};
const pins=[{x:24,y:30,action:'Shoot',path:{kind:'action',action:'Spin up'}},{x:22,y:20,path:{rotate:'turn',heading:-90,style:'spline'}},
  {x:16,y:12.5,wait:.6,action:'Intake',path:{kind:'action',action:'Intake',style:'sharp'}},{x:24,y:24,path:{style:'sharp'}},{x:36,y:28,action:'Shoot',path:{kind:'action',action:'Spin up',style:'spline'}}];
const VARIANTS={
  // Side rollers on two continuous servos (the second turns the other way), a two-motor flywheel with PIDF, and a reversed feeder and turret.
  rollers:{intakes:[{kind:'siderollers',sides:['front'],device:'crservo',motor:'roller',motor2:'roller2',reversed2:true}],shooters:[{type:'turret',motor:'shooter',motor2:'shooter_b',reversed2:true,turretReversed:true,indexerReversed:true}],shooter:{pidf:{p:1.2,i:.12,d:0,f:12}}},
  // No flywheel encoder (a set power), a servo pusher and a servo turret.
  pusher:{shooters:[{type:'turret',indexerKind:'pusher',indexer:'pusher',feedPos:.7,restPos:.2}],shooter:{control:'power',power:.9},turret:{kind:'servo',servoCenter:.5,servoDegrees:300},indexer:{seconds:.35,pushSeconds:.12}},
  // A kicker intake and a servo gate.
  gate:{intakes:[{kind:'kicker',sides:['front'],servo:'kicker',downPos:.1,upPos:.8}],shooters:[{type:'turret',indexerKind:'gate',indexer:'gate',feedPos:.9,restPos:.1}]}
};
const exportFor=(m,format='files',extra={})=>{const route=P.plan({start,zones:[],pins,clearance:2,style:'spline'},{front:8.5,rear:8.5,half:8.5}),layout={name:'Hardware',start,zones:[]};
  return F[format]({route,layout,tuning:{},robot,localization:'fused',mechanisms:m,target,setupName:'Hardware test',routeJava:X.java(route,layout,{polygon:P.polygon}),...extra});};
const dir='org/firstinspires/ftc/teamcode/';

test('hardware settings: device kinds, second motors, directions, servo feeders, flywheel control and turret kind',()=>{
  // The plain setup is unchanged: no optional fields appear, so older saves round-trip as they were.
  const plain=Mech.sanitize({enabled:true});assert.deepEqual(plain.intakes[0],{kind:'sweeper',sides:['front'],reach:0,width:null,height:4,motor:'intake',power:1});
  assert.deepEqual(plain.shooters[0],{type:'turret',pieces:'pollen',mount:'center',facing:'front',motor:'shooter',indexer:'indexer',indexerKind:'motor',turretMotor:'turret'});
  assert.deepEqual([plain.shooter.control,plain.shooter.power,plain.shooter.tolerance,plain.shooter.pidf,plain.turret.kind,plain.indexer.pushSeconds],['velocity',1,.05,undefined,'motor',.15]);
  const m=Mech.sanitize({enabled:true,...VARIANTS.rollers});
  assert.deepEqual(m.intakes[0],{kind:'siderollers',sides:['front'],reach:0,width:null,height:4,motor:'roller',power:1,device:'crservo',motor2:'roller2',reversed2:true});
  assert.deepEqual(m.shooters[0],{type:'turret',pieces:'pollen',mount:'center',facing:'front',motor:'shooter',indexer:'indexer',indexerKind:'motor',turretMotor:'turret',motor2:'shooter_b',reversed2:true,indexerReversed:true,turretReversed:true});
  assert.deepEqual(m.shooter.pidf,{p:1.2,i:.12,d:0,f:12});assert.deepEqual(Mech.sanitize(m),m,'sanitizing again changes nothing');
  // A servo feeder has positions instead of a direction; a kicker has no roller.
  const s=Mech.sanitize({enabled:true,...VARIANTS.pusher});assert.deepEqual([s.shooters[0].feedPos,s.shooters[0].restPos,'indexerReversed' in s.shooters[0]],[.7,.2,false]);
  assert.deepEqual([s.shooter.control,s.shooter.power,s.turret.kind,s.turret.servoCenter,s.turret.servoDegrees],['power',.9,'servo',.5,300]);
  assert.equal('device' in Mech.sanitize({enabled:true,...VARIANTS.gate}).intakes[0],false);
  // Out-of-range or invalid values fall back; a PIDF needs all four numbers.
  const bad=Mech.sanitize({enabled:true,intakes:[{sides:['front'],device:'laser',motor2:'2bad'}],shooters:[{indexerKind:'catapult',feedPos:7}],shooter:{control:'magic',tolerance:9,pidf:{p:1}},turret:{kind:'arm',servoDegrees:-5}});
  assert.deepEqual([bad.intakes[0].device,bad.intakes[0].motor2,bad.shooters[0].indexerKind,bad.shooter.control,bad.shooter.tolerance,bad.shooter.pidf,bad.turret.kind,bad.turret.servoDegrees],[undefined,undefined,'motor','velocity',.5,undefined,'motor',10]);
  // Names may use letters, digits, spaces, _ . and - as the robot configuration does.
  assert.equal(Mech.sanitize({enabled:true,intakes:[{sides:['front'],motor:'front-roller.1'}]}).intakes[0].motor,'front-roller.1');
  // A shooter on the first one's turret has no turret of its own, so no direction for one.
  const shared=Mech.sanitize({enabled:true,shooters:[{type:'turret'},{type:'turret',pieces:'nectar',sharesTurret:true,turretReversed:true}],capacity:{pollen:2,nectar:2}});assert.equal('turretReversed' in shared.shooters[1],false);
});

test('a servo pusher pushes once per feed cycle and the next piece drops in while it is back at rest',()=>{
  const m=Mech.sanitize({enabled:true,...VARIANTS.pusher});assert.equal(Mech.pusherOnly(m),true);assert.equal(Mech.feedCycle(m),.35);
  assert.ok(Math.abs(Mech.shootSeconds(m,3)-(2*.35+.15))<1e-9,'(N-1) cycles and the last push or margin');
  assert.equal(Mech.feedCycle(Mech.sanitize({enabled:true,shooters:[{indexerKind:'pusher'}],indexer:{seconds:.1,pushSeconds:.2}})),.4,'at least twice the push, to get back to rest');
  // In the simulator's own run, Shoot 3 fires a shot per cycle as the pusher pushes.
  const model=new Mech.Model(m,4),runner=new Mech.Runner(m),dt=1/60;let held=4,time=0,busy=true;const fires=[],pushes=[];
  while(busy&&time<10){const step=runner.commands({name:'Shoot 3',leg:0,moving:false},model.state(),time);busy=step.busy;if(step.cmd.feed)pushes.push(time);const out=model.tick(dt,step.cmd,{pose:{x:30,y:20,heading:0},target:{x:60,y:58},held});if(out.fire){fires.push(time);held--;}time+=dt;}
  assert.equal(fires.length,3);for(let i=1;i<3;i++)assert.ok(Math.abs(fires[i]-fires[i-1]-.35)<.04,'one shot per feed cycle: '+fires);
  assert.ok(pushes.length<Math.ceil((2*.35+.15)/dt),'the pusher is not held at its feed position the whole volley');
});

test('the generated Mechanisms.java: per-device code with directions, two flywheel motors, PIDF, power control, pushers, gates and servo turrets',()=>{
  const java=v=>exportFor(Mech.sanitize({enabled:true,...v})).files[dir+'Mechanisms.java'];
  const a=java(VARIANTS.rollers);
  assert.match(a,/INTAKE_1 = "roller";\n\s+public static final boolean INTAKE_1_REVERSED = false;/);assert.match(a,/INTAKE_1B = "roller2";\n\s+public static final boolean INTAKE_1B_REVERSED = true;/);
  assert.match(a,/intake1b = map\.get\(DcMotorSimple\.class, INTAKE_1B\);\n\s+intake1b\.setDirection\(direction\(INTAKE_1B_REVERSED\)\);/);
  assert.match(a,/FLYWHEEL_1 = "shooter", FLYWHEEL_1B = "shooter_b";/);assert.match(a,/FLYWHEEL_1B_REVERSED = true/);assert.match(a,/flywheel1b\.setVelocity\(speed\);/);assert.match(a,/return atSpeed\(flywheel1\) && atSpeed\(flywheel1b\);/);
  assert.match(a,/motor\.setVelocityPIDFCoefficients\(FLYWHEEL_P, FLYWHEEL_I, FLYWHEEL_D, FLYWHEEL_F\);/);assert.match(a,/FLYWHEEL_P = 1\.2, FLYWHEEL_I = 0\.12, FLYWHEEL_D = 0\.0, FLYWHEEL_F = 12\.0;/);
  assert.match(a,/TURRET_1_REVERSED = true/);assert.match(a,/turret1 = turretMotor\(map, TURRET_1, TURRET_1_REVERSED\);/);assert.match(a,/FEEDER_1_REVERSED = true/);
  assert.match(a,/"roller" \(turns the other way\)|"roller2" \(turns the other way\)/,'the header lists which devices turn the other way');
  const b=java(VARIANTS.pusher);
  assert.match(b,/FLYWHEEL_POWER = 0\.9, SPIN_UP_SECONDS = 0\.8;/);assert.match(b,/motor\.setMode\(DcMotor\.RunMode\.RUN_WITHOUT_ENCODER\);/);assert.match(b,/flywheel1\.setPower\(power\);/);assert.doesNotMatch(b,/setVelocity\(/);
  assert.match(b,/return clock\.seconds\(\) - spinStart >= SPIN_UP_SECONDS;/,'no encoder: at speed after the spin-up time');
  assert.match(b,/boolean push = feeding && t % FEED_CYCLE_SECONDS < PUSH_SECONDS;\n\s+feeder1\.setPosition\(push \? FEEDER_1_FEED : FEEDER_1_REST\);/);assert.match(b,/FEEDER_1_FEED = 0\.7, FEEDER_1_REST = 0\.2;/);
  assert.match(b,/TURRET_SERVO_CENTER = 0\.5, TURRET_SERVO_DEGREES = 300\.0/);assert.match(b,/turret1\.setPosition\(Math\.max\(0, Math\.min\(1, position\)\)\);/);
  assert.match(b,/return Math\.abs\(turret1At - turret1Degrees\) <= AIMED_DEGREES;/,'a servo turret is aimed once its tracked angle has arrived');
  assert.deepEqual(F.mechanismHardware(Mech.sanitize({enabled:true,...VARIANTS.pusher})).shooters[0],{flywheels:[{name:'shooter',mount:1}],ticksPerSecond:1400,indexer:{name:'pusher',kind:'pusher',mount:1,feed:.7,rest:.2},turret:{name:'turret',kind:'servo',center:.5,degrees:300,mount:1}});
  const c=java(VARIANTS.gate);assert.match(c,/kicker1\.setPosition\(on \? KICKER_1_DOWN : KICKER_1_UP\);/);assert.match(c,/feeder1\.setPosition\(feeding \? FEEDER_1_FEED : FEEDER_1_REST\);/);
  // Every device the code uses, with what the robot configuration must have there.
  assert.deepEqual(F.mechanismDevices(Mech.sanitize({enabled:true,...VARIANTS.rollers})).map(d=>[d.name,d.device,d.reversed]),[['roller','crservo',false],['roller2','crservo',true],['shooter','motor',false],['shooter_b','motor',true],['indexer','motor',true],['turret','motor',true]]);
});

test('the check TeleOp is a guided check of every device: drive wheels, rollers, flywheels with top speed and PIDF, feeders, turrets and servo positions',()=>{
  const m=Mech.sanitize({enabled:true,...VARIANTS.pusher}),out=exportFor(m),check=out.files[dir+'PlannedRouteCheck.java'];
  assert.ok(check,'TeamCode gets PlannedRouteCheck.java');assert.equal(out.check.opMode,'org.firstinspires.ftc.teamcode.PlannedRouteCheck');
  assert.match(check,/@TeleOp\(name = "Hardware check \(Deck\)", group = "Torque"\)/);
  assert.match(check,/DRIVE = new String\[\] \{"front_left", "front_right", "back_left", "back_right"\};\n\s+private static final boolean\[\] DRIVE_REVERSED = \{true, false, true, false\};/);
  assert.match(check,/hardwareMap\.tryGet\(DcMotorEx\.class, DRIVE\[i\]\)/,'a missing drive motor is reported, not a crash');
  // Every device by its Mechanisms constant, so the check uses what the autonomous uses.
  assert.match(check,/DcMotorSimple intake1 = hardwareMap\.tryGet\(DcMotorSimple\.class, Mechanisms\.INTAKE_1\);/);
  assert.match(check,/position\(feeder1, Mechanisms\.FEEDER_1_REST, "Move the pusher to REST/);assert.match(check,/position\(turret1, Mechanisms\.TURRET_SERVO_CENTER,/);
  assert.match(check,/mech\.intake\(intaking\)/,'after the last step the mechanisms can be tried');
  assert.doesNotMatch(check,/topSpeed\(/,'no encoder on the flywheel: no top-speed measurement');
  const v=exportFor(Mech.sanitize({enabled:true,...VARIANTS.rollers})).files[dir+'PlannedRouteCheck.java'];assert.match(v,/double f = 32767 \/ top, p = 0\.1 \* f, i = 0\.1 \* p;/);
  assert.match(v,/turnTo\(turret1, 20 \* Mechanisms\.TURRET_TICKS_PER_DEGREE,/);assert.match(v,/result\("turret\.ticksPerDegree"/);assert.match(v,/result\("intakes\.0\.reversed2", "\?missing"\)/);
  // OnBot Java: the check is its own file and uses the autonomous file's Mechanisms.
  const one=exportFor(m,'onBotJava');assert.deepEqual(Object.keys(one.files),[dir+'PlannedRouteAuto.java',dir+'PlannedRouteCheck.java']);
  assert.match(one.check.source,/PlannedRouteAuto\.Mechanisms mech = new PlannedRouteAuto\.Mechanisms\(\);/);assert.match(one.check.source,/hardwareMap\.tryGet\(DcMotorSimple\.class, PlannedRouteAuto\.Mechanisms\.INTAKE_1\)/);assert.doesNotMatch(one.source,/class PlannedRouteCheck/);
  // Without mechanisms the check still tests the IMU, the drive and (last, on the floor) the Pinpoint.
  const plain=exportFor(Mech.sanitize({})).files[dir+'PlannedRouteCheck.java'];assert.match(plain,/private static final int STEPS = 6;/);assert.match(plain,/next\("Pinpoint \(\\"pinpoint\\"\)"\);/);assert.doesNotMatch(plain,/Mechanisms|intake/);
  // Pedro: the same check beside the Pedro OpMode.
  const route=P.plan({start,zones:[],pins,clearance:2,style:'spline'},{front:8.5,rear:8.5,half:8.5}),pedro=Pedro.files({route,layout:{name:'Hardware',start,zones:[]},setupName:'Hardware test',robot,mechanisms:m,target,defaultPower:.8,hardware:F.hardware(robot,'fused')});
  assert.match(pedro.files[dir+'PlannedRouteCheck.java'],/Mechanisms mech = new Mechanisms\(\);/);
});

test('robot names for the drive motors and sensors, and drive motors that turn the other way, reach every export',()=>{
  const own=C.robot({...robot,devices:{frontLeft:{name:'leftFront',reversed:false},frontRight:{name:'rightFront'},backLeft:{name:'leftRear'},backRight:{name:'rightRear',reversed:true},pinpoint:{name:'odo'},imu:{name:'bad"name'},otos:'nope'}});
  assert.deepEqual(own.devices,{frontLeft:{name:'leftFront',reversed:false},frontRight:{name:'rightFront'},backLeft:{name:'leftRear'},backRight:{name:'rightRear',reversed:true},pinpoint:{name:'odo'}});
  assert.equal(C.robot(robot).devices,undefined,'nothing stored without changes');
  const h=F.hardware(own,'fused');assert.deepEqual(Object.values(h.drive.motors).map(x=>[x.name,x.mount]),[['leftFront',1],['rightFront',1],['leftRear',-1],['rightRear',-1]]);assert.equal(h.pinpoint,'odo');assert.equal(h.imu,'imu');
  const out=F.files({...{route:P.plan({start,zones:[],pins:[{x:40,y:30}],clearance:2},{front:8.5,rear:8.5,half:8.5})},layout:{name:'Names',start,zones:[]},tuning:{},robot:own,localization:'fused',routeJava:'public static final double[] MOTOR_POWER = {1}'});
  const drive=out.files[dir+'drive/RobotDrive.java'];assert.match(drive,/map\.get\(DcMotorEx\.class, "leftFront"\); motors\[0\]\.setDirection\(DcMotorSimple\.Direction\.FORWARD\)/);assert.match(drive,/"rightRear"\); motors\[3\]\.setDirection\(DcMotorSimple\.Direction\.REVERSE\)/);assert.match(drive,/GoBildaPinpointDriver\.class,"odo"/);
  assert.match(out.files[dir+'PlannedRouteCheck.java'],/\{"leftFront", "rightFront", "leftRear", "rightRear"\}/);
  assert.deepEqual(F.deviceSlots(own,'odometry').map(s=>[s.key,s.name,s.kind]),[['frontLeft','leftFront','motor'],['frontRight','rightFront','motor'],['backLeft','leftRear','motor'],['backRight','rightRear','motor'],['imu','imu','imu'],['par','par','motor'],['perp','perp','motor']]);
});

const {spawnSync}=require('node:child_process'),MM=require('../ui/sim-motionmodule.js'),mmRoot=process.env.DECK_MOTIONMODULE_SOURCE||path.join(root,'../MotionModule');
const python=[process.env.DECK_PYTHON,path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'),'python3','python'].find(p=>p&&spawnSync(p,['-c','import sys;assert sys.version_info>=(3,9)'],{windowsHide:true}).status===0);
const mmSkip=!built?'run node tools/simulation/build.cjs first':!python?'Python 3 is not available (set DECK_PYTHON)':!fs.existsSync(path.join(mmRoot,'core/motion_module/autonomous.py'))?'MotionModule source not found (set DECK_MOTIONMODULE_SOURCE)':false;
test('MotionModule: rollers on continuous servos, a second flywheel motor and a pusher run with their directions; a wrong one picks up nothing',{skip:mmSkip},async()=>{
  const m=Mech.sanitize({enabled:true,...VARIANTS.rollers,shooters:[{...VARIANTS.rollers.shooters[0],indexerKind:'pusher',feedPos:.7,restPos:.2}]});
  const hw=MM.mechanismHardware(m);assert.deepEqual(hw.intakes,[{channel:6,servo:true,mount:1,part:0},{channel:7,servo:true,mount:-1,part:0}]);assert.deepEqual(hw.shooters[0].flywheels,[{channel:5,mount:1},{channel:6,mount:-1}]);
  const run=async(edit=s=>s)=>{let error='';const e=new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-hw-mm-')),now:()=>0,emit:msg=>{if(msg?.state==='error')error=msg.error;}});
    try{const load=timing=>e.load({field:'biobuzz',alliance:'red',mechanisms:m,start,robot,controller:'motionmodule',sensors:{localization:'gyro'},timing});await load();const timing={headingP:1.6,...e.timedCalibration(1)};const info=await load(timing);
      const route=P.plan({start,zones:[],pins,clearance:2,style:'spline',defaultPower:1},info.footprint,info.fieldZones,info.bounds);route.defaultPower=1;
      const exported=MM.autonomous(route,{...timing,power:1},{name:'Hardware',mechanisms:info.mechanisms,target:info.target,robot}),source=edit(exported);
      assert.match(exported,/\("roller", 6, 1\.0, True\),\n\s+\("roller2", 7, -1\.0, True\),/,'the second roller turns the other way');assert.match(exported,/\[\("shooter", 5, 1\), \("shooter_b", 6, -1\)\]/);
      assert.equal((await e.run({kind:'motionmodule',source,actions:MM.actionsFile(route,{name:'Hardware',mechanisms:info.mechanisms}),python,motionModule:mmRoot,deps:path.join(root,'.cache/motionmodule-test-deps')})).ok,true,error);
      for(let i=0;i<4000&&e.mode==='program';i++)await e.programTick();return e.mechanismState();}finally{e.dispose();}};
  const good=await run();assert.ok(good.pickedUp>0&&good.shots>=5,`picks up and shoots (${good.pickedUp} picked, ${good.shots} shots)`);
  const wrong=await run(s=>s.replace('("roller2", 7, -1.0, True)','("roller2", 7, 1.0, True)'));assert.equal(wrong.pickedUp,0,'a roller turning the wrong way spits pieces out');
});

test('BIOBUZZ on the virtual Control Hub: every hardware variant shoots what the simulator planned, and a direction the code gets wrong picks up nothing',{skip:!built&&'run node tools/simulation/build.cjs first'},async()=>{
  const run=async(extra,code,edit=s=>s)=>{const e=new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-hw-')),now:()=>0,emit:msg=>{if(msg?.state==='error')e.lastError=msg.error;}});
    try{const m=Mech.sanitize({enabled:true,...extra}),info=await e.load({field:'biobuzz',alliance:'red',mechanisms:m,start,robot,sensors:{localization:'fused'}});
      const route=P.plan({start,zones:[],pins,clearance:2,style:'spline',defaultPower:1},info.footprint,info.fieldZones,info.bounds);route.defaultPower=1;
      if(code){const layout={name:'Hardware',start,zones:[]},out=F.onBotJava({route,layout,tuning:info.tuning,robot:info.robot,localization:'fused',mechanisms:info.mechanisms,target:info.target,setupName:'Hardware',routeJava:X.java(route,layout,{polygon:P.polygon})});
        for(const k of Object.keys(out.files))out.files[k]=edit(out.files[k]);
        assert.equal((await e.run({kind:'opmode',files:out.files,opMode:out.opMode})).ok,true,JSON.stringify(e.lastError));for(let i=0;i<3600&&e.mode==='program'&&e.telemetry?.Phase!=='Done';i++)await e.programTick();}
      else{assert.equal((await e.run({kind:'route',route})).ok,true);for(let i=0;i<3600&&e.mode==='program';i++)await e.programTick();}
      return e.mechanismState();}finally{e.dispose();}};
  for(const [name,extra] of Object.entries(VARIANTS)){const planned=await run(extra,null),robotCode=await run(extra,'onbot');
    assert.ok(planned.shots>=5,`${name}: the simulator shoots the preloads and the garden pollen (${planned.shots})`);
    assert.deepEqual([robotCode.shots,robotCode.pickedUp,robotCode.score],[planned.shots,planned.pickedUp,planned.score],`${name}: the exported code shoots what the simulator planned`);}
  // The second roller turns the other way on this robot. Code that forgets it pushes pieces back out, so nothing is picked up.
  const wrong=await run(VARIANTS.rollers,'onbot',s=>s.replace('INTAKE_1B_REVERSED = true','INTAKE_1B_REVERSED = false'));assert.equal(wrong.pickedUp,0);
});
