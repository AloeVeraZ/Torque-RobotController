'use strict';
// Exported Control Hub autonomous (OpMode + Deck controller/wiring + route) on the virtual Control Hub:
// FTC SDK stand-ins with the exported hardware adapter, simulated motors and sensors.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const P=require('../ui/sim-planner.js'),X=require('../ui/sim-export.js'),F=require('../ui/sim-ftc.js'),{SimEngine}=require('../src/sim-engine.cjs');
const built=fs.existsSync(path.join(__dirname,'../sim-runtime/driver/classes/deck/sim/hub/VirtualHub.class')),skip=built?false:'run node tools/simulation/build.cjs first';
const robot={drivetrain:'mecanum',length:17,width:17,heightIn:5,driveRpm:500,intakeIn:0};
const start={x:20,y:30,heading:0},zones=[{id:'a',type:'rect',x:70,y:60,width:16,height:40}],pins=[{x:110,y:40,wait:.5,action:'Score'},{x:120,y:120}];
async function setup(localization){
  let error='';const e=new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-hub-test-')),now:()=>0,emit:m=>{if(m?.state==='error')error=m.error;}});
  const info=await e.load({field:'empty',start,robot,zones,sensors:{localization}});
  const route=P.plan({start,zones,pins,clearance:2,style:'spline'},info.footprint,[],info.bounds),layout={name:'Hub check',field:'empty',width:144,height:144,start,zones};
  const routeJava=X.java(route,layout,{polygon:P.polygon,className:'PlannedRoute',packageName:'org.firstinspires.ftc.teamcode'});
  const out=F.files({route,layout,tuning:info.tuning,robot:info.robot,localization,setupName:'Control Hub mecanum',routeJava});
  return {e,route,out,error:()=>error};
}
async function finish(e,limit=1800){const phases=new Set();for(let i=0;i<limit&&e.mode==='program';i++){await e.programTick();phases.add(e.telemetry?.Phase);if(e.telemetry?.Phase==='Done')break;}return phases;}

for(const [localization,tolerance] of [['encoders',2.5],['odometry',1],['odometry3',1],['fused',1],['optical',1]])
  test(`exported Control Hub OpMode runs on the virtual hub with ${F.SUPPORTED[localization]}`,{skip},async()=>{
    const {e,out,error}=await setup(localization);try{
      assert.ok(Object.keys(out.files).some(k=>k.endsWith('drive/Constants.java')));assert.ok(Object.keys(out.files).some(k=>k.endsWith('drive/RobotDrive.java')));assert.ok(out.files['deck/pathing/DeckFollower.java']);assert.ok(Object.values(out.files).every(s=>!s.includes('com.pedropathing')));
      const started=await e.run({kind:'opmode',files:out.files,opMode:out.opMode});assert.equal(started.ok,true,error());assert.equal(started.program,'org.firstinspires.ftc.teamcode.PlannedRouteAuto');
      const phases=await finish(e);assert.ok(['Driving','Pause','Done'].every(p=>phases.has(p)),[...phases].join());assert.ok(!phases.has('Turning'),'a fixed-heading route never stops to turn');
      const t=e.truth();assert.ok(Math.hypot(t.x-120,t.y-120)<tolerance,JSON.stringify(t));assert.ok(Math.abs(t.heading)<.1);
      assert.equal(e.violations.size,0,'no zone touched');
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

test('IMU-only and unsupported drivetrains are refused for positional export on a Control Hub with a clear reason',()=>{
  assert.throws(()=>F.hardware({drivetrain:'swerve',length:17,width:17,driveRpm:500},'odometry'),/mecanum and tank drivetrains/);assert.equal(F.hardware({drivetrain:'tank2',length:17,width:17,driveRpm:500},'odometry').drive.kind,'tank');
  assert.throws(()=>F.hardware({length:17,width:17,driveRpm:500},'gyro'),/IMU-only setups export timed commands/);
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
