'use strict';
// Exported Control Hub autonomous (OpMode + Deck controller/wiring + route) on the virtual Control Hub:
// FTC SDK stand-ins with the exported hardware adapter, simulated motors and sensors.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const P=require('../ui/sim-planner.js'),X=require('../ui/sim-export.js'),F=require('../ui/sim-ftc.js'),{SimEngine}=require('../src/sim-engine.cjs');
const built=fs.existsSync(path.join(__dirname,'../sim-runtime/driver/classes/deck/sim/hub/VirtualHub.class')),skip=built?false:'run node tools/simulation/build.cjs first';
const ROBOT={drivetrain:'mecanum',length:17,width:17,heightIn:5,driveRpm:500,intakeIn:0};
const start={x:20,y:30,heading:0},zones=[{id:'a',type:'rect',x:70,y:60,width:16,height:40}],pins=[{x:110,y:40,wait:.5,action:'Score'},{x:120,y:120}];
async function setup(localization,robot=ROBOT,{pins:stops=pins,zones:walls=zones}={}){
  let error='';const e=new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-hub-test-')),now:()=>0,emit:m=>{if(m?.state==='error')error=m.error;}});
  const info=await e.load({field:'empty',start,robot,zones:walls,sensors:{localization}});
  const route=P.plan({start,zones:walls,pins:stops,clearance:2,style:'spline'},info.footprint,[],info.bounds),layout={name:'Hub check',field:'empty',width:144,height:144,start,zones:walls};
  const routeJava=X.java(route,layout,{polygon:P.polygon,className:'PlannedRoute',packageName:'org.firstinspires.ftc.teamcode'});
  const out=F.files({route,layout,tuning:info.tuning,robot:info.robot,localization,setupName:'Control Hub mecanum',routeJava});
  return {e,route,out,error:()=>error};
}
async function finish(e,limit=1800){const phases=new Set();for(let i=0;i<limit&&e.mode==='program';i++){await e.programTick();phases.add(e.telemetry?.Phase);if(e.telemetry?.Phase==='Done')break;}return phases;}

for(const [localization,tolerance] of [['gyro',25],['encoders',2.5],['odometry',1],['odometry3',1],['fused',1],['optical',1]])
  test(`exported Control Hub OpMode runs on the virtual hub with ${F.SUPPORTED[localization]}`,{skip},async()=>{
    const {e,out,error}=await setup(localization);try{
      assert.ok(Object.keys(out.files).some(k=>k.endsWith('drive/Constants.java')));assert.ok(Object.keys(out.files).some(k=>k.endsWith('drive/RobotDrive.java')));assert.ok(out.files['deck/pathing/DeckFollower.java']);assert.ok(Object.values(out.files).every(s=>!s.includes('com.pedropathing')));
      const started=await e.run({kind:'opmode',files:out.files,opMode:out.opMode});assert.equal(started.ok,true,error());assert.equal(started.program,'org.firstinspires.ftc.teamcode.PlannedRouteAuto');
      const phases=await finish(e);assert.ok(['Driving','Pause','Done'].every(p=>phases.has(p)),[...phases].join());assert.ok(!phases.has('Turning'),'a fixed-heading route never stops to turn');
      const t=e.truth();assert.ok(Math.hypot(t.x-120,t.y-120)<tolerance,JSON.stringify(t));assert.ok(Math.abs(t.heading)<.1);
      // With nothing measuring distance it lands roughly, and may brush a zone a measured robot clears.
      if(localization!=='gyro')assert.equal(e.violations.size,0,'no zone touched');
    }finally{e.dispose();}
  });

// A Pinpoint alone (no pods) is the IMU: the heading comes from it, the distance from the drive encoders, or from time
// where a drive motor has none.
for(const [localization,tolerance] of [['encoders',2.5],['gyro',25]])
  test(`exported Control Hub OpMode runs with a Pinpoint alone as its IMU and ${localization==='encoders'?'drive encoders':'time'} for distance`,{skip},async()=>{
    const {e,out,error}=await setup(localization,{...ROBOT,pinpointImu:true});try{
      const drive=Object.entries(out.files).find(([k])=>k.endsWith('drive/RobotDrive.java'))[1];assert.match(drive,/PINPOINT_HAS_PODS = false/);assert.match(drive,/map\.get\(GoBildaPinpointDriver\.class,"pinpoint"\)/);assert.doesNotMatch(drive,/setOffsets/);
      assert.ok(F.deviceSlots({...ROBOT,pinpointImu:true},localization).some(d=>d.kind==='pinpoint'),'the Pinpoint is one of the robot’s devices');
      const started=await e.run({kind:'opmode',files:out.files,opMode:out.opMode});assert.equal(started.ok,true,error());
      const phases=await finish(e);assert.ok(phases.has('Done'),[...phases].join());const t=e.truth();assert.ok(Math.hypot(t.x-120,t.y-120)<tolerance,JSON.stringify(t));assert.ok(Math.abs(t.heading)<.1);
    }finally{e.dispose();}
  });
// With its pods it is as before, and a robot without the flag has no Pinpoint.
test('a Pinpoint is in the code only where the robot has one',()=>{assert.equal(F.hardware(ROBOT,'encoders').pinpoint,undefined);assert.equal(F.hardware({...ROBOT,pinpointImu:true},'fused').pinpointImu,undefined);assert.equal(F.hardware({...ROBOT,pinpointImu:true},'gyro').pinpointImu,true);});
// A real Pinpoint with no pods plugged in never says READY: goBILDA's driver reports the pods it cannot find first
// (FAULT_NO_PODS_DETECTED), and the virtual one does the same. Its heading is still what the code turns by. Here Calibrate's
// correction for the Control Hub's IMU is the wrong way round, so a robot that turned by the hub's IMU (as code that waits
// for READY does) would turn the wrong way at the corner and lose its route.
test('a Pinpoint alone that finds no pods still gives the heading: a route with a turn ends where it should, with the hub’s IMU taken the wrong way round',{skip},async()=>{
  const {e,out,error}=await setup('encoders',{...ROBOT,pinpointImu:true,odometry:{imu:{reversed:true}}},{pins:[{x:60,y:30,path:{rotate:'turn',heading:90}},{x:60,y:80}],zones:[]});try{
    const drive=Object.entries(out.files).find(([k])=>k.endsWith('drive/RobotDrive.java'))[1];
    assert.match(drive,/private static boolean answers\(GoBildaPinpointDriver\.DeviceStatus s\)\{return s==GoBildaPinpointDriver\.DeviceStatus\.READY\|\|s==GoBildaPinpointDriver\.DeviceStatus\.FAULT_NO_PODS_DETECTED\|\|s==GoBildaPinpointDriver\.DeviceStatus\.FAULT_X_POD_NOT_DETECTED\|\|s==GoBildaPinpointDriver\.DeviceStatus\.FAULT_Y_POD_NOT_DETECTED;\}/);
    assert.match(drive,/if\(answers\(pinpoint\.getDeviceStatus\(\)\)\)\{double turned=pinpoint\.getHeading\(AngleUnit\.RADIANS\);if\(!Double\.isNaN\(oldPinpoint\)\)dh=DeckFollower\.angle\(turned-oldPinpoint\);/);assert.match(drive,/dh=-1\.0\*DeckFollower\.angle\(yaw-oldImu\)/,'the hub’s turn, the wrong way round');
    const started=await e.run({kind:'opmode',files:out.files,opMode:out.opMode});assert.equal(started.ok,true,error());
    const phases=await finish(e,2400);assert.ok(phases.has('Done'),[...phases].join());const t=e.truth();assert.ok(Math.hypot(t.x-60,t.y-80)<2.5,JSON.stringify(t));assert.ok(Math.abs(t.heading-Math.PI/2)<.1,'it turned left to face +y');
  }finally{e.dispose();}
});
// Calibrate's IMU tuning found the Pinpoint alone counts a turn to the left as a turn to the right (DeckChassisCal's turn()
// says backwards): the autonomous takes its turn the other way round. A Pinpoint with its pods gives the whole pose itself.
test('the autonomous takes a Pinpoint alone’s heading the way round Calibrate found it',()=>{
  const route=P.plan({start,zones:[],pins:[{x:60,y:30}],clearance:2},{front:8.5,rear:8.5,half:8.5}),layout={name:'Turn',field:'empty',width:144,height:144,start,zones:[]},drive=(robot,localization,turn)=>F.files({route,layout,tuning:{},robot,localization,turn,routeJava:'class R {}'}).files['org/firstinspires/ftc/teamcode/drive/RobotDrive.java'];
  const back=drive({...ROBOT,pinpointImu:true},'encoders',{top:.5,backwards:true});assert.match(back,/dh=-DeckFollower\.angle\(turned-oldPinpoint\)/);assert.match(back,/Calibrate \(IMU tuning\) found the Pinpoint counts a turn to the left as a turn to the right/);
  assert.match(drive({...ROBOT,pinpointImu:true},'gyro',{top:.5}),/dh=DeckFollower\.angle\(turned-oldPinpoint\)/);assert.doesNotMatch(drive({...ROBOT,pinpointImu:true},'fused',{backwards:true}),/-DeckFollower\.angle\(turned|answers\(/);
});
// The simulator's own run: with a Pinpoint alone the heading is the Pinpoint's IMU, so it drifts as the Pinpoint's does, and
// the distance keeps the drive encoders' error (or none, by time).
test('a Pinpoint alone’s simulated heading drifts as a Pinpoint’s, not as the Control Hub’s IMU',()=>{
  const C=require('../ui/sim-config.js'),{sensorConfig}=require('../src/sim-engine.cjs'),alone={...ROBOT,pinpointImu:true};
  assert.equal(sensorConfig({localization:'encoders'},alone).gyroDrift,C.sensors.fused.error[2]);assert.equal(sensorConfig({localization:'gyro'},alone).gyroDrift,C.sensors.fused.error[2]);
  assert.equal(sensorConfig({localization:'encoders'},alone).scaleError,C.sensors.encoders.error[0]);assert.equal(sensorConfig({localization:'encoders'},alone).noise,C.sensors.encoders.error[1]);
  assert.equal(sensorConfig({localization:'encoders'},ROBOT).gyroDrift,C.sensors.encoders.error[2]);assert.equal(sensorConfig({localization:'gyro'},alone,'motionmodule').gyroDrift,C.sensors.gyro.error[2],'a flag left on a MotionModule robot');
  assert.equal(sensorConfig({localization:'encoders',gyroDrift:0},alone).gyroDrift,0,'a setting given is kept');assert.ok(C.sensors.fused.error[2]<C.sensors.encoders.error[2]);
});
// The chassis TeleOp with a Pinpoint alone, on the virtual Control Hub: field centric by the Pinpoint's heading. The hub IMU's
// correction is the wrong way round (IMU_SCALE -1), so only the Pinpoint's heading drives it the right way.
test('the TeleOp with a Pinpoint alone drives field centric by its heading on the virtual Control Hub, and Start makes forward the robot’s front',{skip},async()=>{
  const T=require('../ui/sim-chassis-teleop.js');let error='';const e=new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-hub-test-')),now:()=>0,emit:m=>{if(m?.state==='error')error=m.error;}});
  try{
    const info=await e.load({field:'empty',start:{x:72,y:72,heading:0},robot:{...ROBOT,pinpointImu:true},zones:[],sensors:{localization:'encoders'}});
    const h=F.hardware(info.robot,'encoders'),motors=Object.entries(h.drive.motors).map(([key,m])=>({key,name:m.name,reversed:m.mount<0}));
    const tele=T.teleopOf({kind:'mecanum',robot:info.robot,imu:{name:h.imu,scale:-1},pinpoint:{name:h.pinpoint,scale:1},motors});
    assert.equal((await e.run({kind:'opmode',files:{[tele.file]:tele.source},opMode:'TorqueChassis'})).ok,true,error);
    const tick=async(n,pad)=>{e.setGamepad(1,pad);for(let i=0;i<n&&e.mode==='program';i++)await e.programTick();assert.equal(e.mode,'program',error);};
    await tick(30,{});
    // About a quarter turn to the left on the turn stick: it faces the field's +y.
    for(let i=0;i<600&&e.truth().heading<Math.PI/2-.15;i++)await tick(1,{right_stick_x:-.4});
    await tick(40,{});const faces=e.truth().heading;assert.ok(faces>1.2&&faces<2,`it faces ${faces} rad`);
    // The drive stick pushed forward takes it away from the driver, along the field's +x, though its front faces +y.
    let a=e.truth();await tick(60,{left_stick_y:-.6});await tick(40,{});let b=e.truth();
    assert.ok(b.x-a.x>8,`it went ${(b.x-a.x).toFixed(1)} in along +x`);assert.ok(Math.abs(b.y-a.y)<.3*(b.x-a.x),`and ${(b.y-a.y).toFixed(1)} in along y`);
    // Set heading to 0 (Start): forward is the way its front faces now.
    await tick(5,{start:true});await tick(5,{});a=e.truth();await tick(60,{left_stick_y:-.6});await tick(40,{});b=e.truth();
    assert.ok(b.y-a.y>8,`after Start it went ${(b.y-a.y).toFixed(1)} in along +y`);assert.ok(Math.abs(b.x-a.x)<.3*(b.y-a.y),`and ${(b.x-a.x).toFixed(1)} in along x`);
  }finally{e.dispose();}
});

test('the exported OpMode reproduces the simulated follower: same route, end point and timing',{skip},async()=>{
  const sim=await setup('odometry'),hub=await setup('odometry');try{
    await sim.e.run({route:sim.route});for(let i=0;i<1800&&sim.e.mode==='program';i++)await sim.e.programTick();assert.ok(sim.e.result);
    await hub.e.run({kind:'opmode',files:hub.out.files,opMode:hub.out.opMode});let ticks=0;for(;ticks<1800&&hub.e.mode==='program'&&hub.e.telemetry?.Phase!=='Done';ticks++)await hub.e.programTick();
    const a=sim.e.result.truth,b=hub.e.truth(),hubTime=hub.e.world.time;
    assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1,`simulated ${JSON.stringify(a)} vs exported ${JSON.stringify(b)}`);
    assert.ok(Math.abs(hubTime-sim.e.result.time)<.75,`simulated ${sim.e.result.time} s vs exported ${hubTime} s`);
  }finally{sim.e.dispose();hub.e.dispose();}
});

test('the virtual hub catches wiring and compile mistakes that would fail on a real Control Hub',{skip},async()=>{
  const {e,out,error}=await setup('odometry');try{
    const constants=Object.keys(out.files).find(k=>k.endsWith('RobotDrive.java'));
    const miswired={...out.files,[constants]:out.files[constants].replace('motors[0].setDirection(DcMotorSimple.Direction.REVERSE)','motors[0].setDirection(DcMotorSimple.Direction.FORWARD)')};
    assert.notEqual(miswired[constants],out.files[constants]);assert.equal((await e.run({kind:'opmode',files:miswired,opMode:out.opMode})).ok,true);await finish(e,900);
    const t=e.truth();assert.ok(Math.hypot(t.x-120,t.y-120)>10||e.violations.size>0,'a reversed front-left motor cannot finish the route cleanly');
    const broken={...out.files,[constants]:out.files[constants].replace('limit=0.6','limit=\"invalid\"')};
    const r=await e.run({kind:'opmode',files:broken,opMode:out.opMode});assert.equal(r.ok,false);assert.match(r.error+error(),/String cannot be converted to double/);
    await assert.rejects(e.run({kind:'opmode',files:out.files,opMode:'org.firstinspires.ftc.teamcode.Missing'}).then(x=>{if(!x.ok)throw Error(x.error);}),/No OpMode class/);
  }finally{e.dispose();}
});

test('unsupported drivetrains and sensing are refused for export on a Control Hub with a clear reason',()=>{
  assert.throws(()=>F.hardware({drivetrain:'swerve',length:17,width:17,driveRpm:500},'odometry'),/mecanum and tank drivetrains/);assert.equal(F.hardware({drivetrain:'tank2',length:17,width:17,driveRpm:500},'odometry').drive.kind,'tank');
  assert.equal(F.hardware({length:17,width:17,driveRpm:500},'gyro').localization,'gyro','the IMU alone is enough: distance goes by time');assert.throws(()=>F.hardware({length:17,width:17,driveRpm:500},'none'),/runs on the IMU alone, drive encoders/);
  const h=F.hardware({length:17,width:17,driveRpm:500},'encoders');assert.equal(h.drive.ticksPerRev,336);assert.ok(Math.abs(h.drive.ticksPerInch-336/(Math.PI*104/25.4))<1e-9);
  assert.deepEqual(Object.values(h.drive.motors).map(m=>m.mount),[-1,1,-1,1]);
});
// Tank-style robots: the exported hardware adapter on two or four motors, turning in place
// to face each straight leg, with drive encoders or odometry pods.
for(const [drivetrain,localization] of [['tank','encoders'],['tank2','encoders'],['tank','odometry']])
  test(`exported Control Hub OpMode drives a ${drivetrain} robot with ${F.SUPPORTED[localization]} on the virtual hub`,{skip},async()=>{
    let error='';const e=new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-hub-tank-')),now:()=>0,emit:m=>{if(m?.state==='error')error=m.error;}});
    try{const start={x:24,y:24,heading:0},robot={drivetrain,length:17,width:17,heightIn:5,driveRpm:500,intakeIn:0},pins=[{x:100,y:24},{x:100,y:100,wait:.5,action:'Score'}];
      const info=await e.load({field:'empty',start,robot,zones:[],sensors:{localization}});
      const route=P.plan({start,zones:[],pins,clearance:2,style:'sharp',nonholonomic:true},info.footprint,[],info.bounds),layout={name:'Tank check',field:'empty',width:144,height:144,start,zones:[]};
      const out=F.files({route,layout,tuning:info.tuning,robot:info.robot,localization,routeJava:X.java(route,layout,{polygon:P.polygon})});
      const dir='org/firstinspires/ftc/teamcode/drive/';assert.ok(out.files[dir+'RobotDrive.java']);assert.match(out.files[dir+'Constants.java'],/config.tank=true/);assert.match(out.files[dir+'RobotDrive.java'],drivetrain==='tank2'?/left_drive/:/front_left/);
      assert.equal((await e.run({kind:'opmode',files:out.files,opMode:out.opMode})).ok,true,error);
      const phases=await finish(e,3000);assert.ok(['Turning','Driving','Pause','Done'].every(p=>phases.has(p)),[...phases].join());
      const t=e.truth();assert.ok(Math.hypot(t.x-100,t.y-100)<2.5,JSON.stringify(t));assert.equal(e.violations.size,0);
    }finally{e.dispose();}
  });

test('an export without measured tuning uses the Deck controller defaults, never NaN',()=>{
  const start={x:24,y:24,heading:0},layout={name:'No tuning',field:'empty',width:144,height:144,start,zones:[]},route=P.plan({start,zones:[],pins:[{x:90,y:24}],style:'sharp',clearance:1},{front:8,rear:8,half:8});
  const routeJava=X.java(route,layout,{polygon:P.polygon}),files=F.files({route,layout,tuning:{},robot:{length:16,width:16},localization:'odometry',routeJava}).files;
  for(const [name,src] of Object.entries(files))assert.doesNotMatch(src.split('\n').filter(l=>!/^ *(\*|\/\/|\/\*\*)/.test(l)).join('\n').replace(/Double\.(isNaN|NaN)/g,''),/NaN|Infinity|undefined/,name);
  const constants=Object.entries(files).find(([k])=>k.endsWith('drive/Constants.java'))[1];
  assert.match(constants,/config\.maxForward=60\.0; config\.maxStrafe=50\.0;/);assert.match(constants,/config\.positionD=0\.01;/);assert.match(constants,/config\.headingD=0\.12;/);
});


// A robot that meets something the plan did not know about (another robot, a wall) must not push at it for the rest of the
// autonomous: two seconds with no progress and everything is off, and stays off.
test('a robot blocked on its way stops within a few seconds and stays stopped; an unblocked one never trips it',{skip},async()=>{
  let error='';const e=new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-hub-test-')),now:()=>0,emit:m=>{if(m?.state==='error')error=m.error;}});
  try{
    const block=[{id:'block',type:'rect',x:70,y:30,width:6,height:60}],info=await e.load({field:'empty',start,robot:ROBOT,zones:block,sensors:{localization:'odometry'}});
    // The route is planned as if nothing were there: straight through the block.
    const route=P.plan({start,zones:[],pins:[{x:120,y:30}],clearance:2,style:'spline'},info.footprint,[],info.bounds),layout={name:'Blocked',field:'empty',width:144,height:144,start,zones:[]};
    const routeJava=X.java(route,layout,{polygon:P.polygon,className:'PlannedRoute',packageName:'org.firstinspires.ftc.teamcode'});
    const out=F.files({route,layout,tuning:info.tuning,robot:info.robot,localization:'odometry',setupName:'Control Hub mecanum',routeJava});
    assert.equal((await e.run({kind:'opmode',files:out.files,opMode:out.opMode})).ok,true,error);
    let stoppedAt=-1;for(let i=0;i<600&&e.mode==='program';i++){await e.programTick();if(/^Stopped: no progress/.test(e.telemetry?.Phase||'')){stoppedAt=i;break;}}
    assert.ok(stoppedAt>0,`it stopped itself (last phase ${e.telemetry?.Phase}) ${error}`);assert.ok(stoppedAt<6*60,`within six seconds of starting, at tick ${stoppedAt}`);
    const at=e.truth();assert.ok(at.x<70,`it never got through: ${JSON.stringify(at)}`);
    for(let i=0;i<180&&e.mode==='program';i++)await e.programTick();
    const later=e.truth();assert.ok(Math.hypot(later.x-at.x,later.y-at.y)<.5,'it stays where it stopped');assert.match(e.telemetry?.Phase||'',/^Stopped: no progress/,'and does not carry on with the route');
  }finally{e.dispose();}
});
