'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {PracticeClock,timing}=require('../src/sim-practice.cjs'),C=require('../ui/sim-config.js'),P=require('../ui/sim-planner.js');
test('practice defaults follow FTC periods; phase time is simulation time',()=>{
  assert.deepEqual(timing(),{autoSeconds:30,transitionSeconds:8,teleopSeconds:120});const c=new PracticeClock('match');
  for(let i=0;i<1800;i++)c.advance(1/60);assert.equal(c.phase,'transition');assert.equal(c.remaining,8);
  for(let i=0;i<480;i++)c.advance(1/60);assert.equal(c.phase,'teleop');assert.equal(c.remaining,120);
  for(let i=0;i<7200;i++)c.advance(1/60);assert.equal(c.phase,'finished');
  const direct=new PracticeClock('match',{autoSeconds:1,transitionSeconds:0,teleopSeconds:1});direct.advance(1);assert.equal(direct.phase,'teleop');
  assert.equal(new PracticeClock('teleop').phase,'teleop');assert.equal(new PracticeClock('autonomous').advance(30).to,'finished');
});
test('robot families, numeric intake and large custom fields retain their dimensions',()=>{
  assert.ok(C.drives.kiwi&&C.drives.tank2&&C.drives.swerve&&!C.drives.tank6&&!C.drives.hdrive);assert.equal(C.robot({drivetrain:'tank6'}).drivetrain,'tank');assert.equal(C.robot({drivetrain:'hdrive'}).drivetrain,'xdrive');assert.equal(C.robot({length:96,width:80,intakeIn:7.25}).length,96);
  assert.deepEqual(C.footprint({length:96,width:80,intakeIn:7.25}),{front:55.25,rear:48,half:40});
  assert.equal(C.intake({intake:'vector'}),3.5);assert.equal(C.bounds({field:'decode',width:300}).x1,144);
  const b=C.bounds({field:'empty',width:720,height:360}),fp=C.footprint({length:96,width:80,intakeIn:7.25});
  const route=P.plan({start:{x:80,y:100,heading:0},pins:[{x:630,y:100}],zones:[],clearance:2,style:'sharp'},fp,[],b);assert.ok(route.length>500);
  assert.throws(()=>P.plan({start:{x:80,y:100,heading:0},pins:[{x:760,y:100}],zones:[]},fp,[],b),/field|pin/i);
});
const built=fs.existsSync(path.join(__dirname,'../sim-runtime/dsim-host.cjs'));
function engine(now=()=>0){const {SimEngine}=require('../src/sim-engine.cjs');return new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-practice-')),now});}
const pad=(x=0,y=0,turn=0)=>({mapping:'standard',axes:[x,y,turn,0],buttons:[]});
test('IMU-only defaults do not invent odometry; teleop works without odometry and requires neutral',{skip:!built},async()=>{
  let wallTime=0;const e=engine(()=>wallTime);try{
    const info=await e.load({field:'empty',width:300,height:180,start:{x:35,y:72,heading:0},sensors:{localization:'gyro'},robot:{length:24,width:23,intakeIn:2.5}});
    assert.equal(info.sensors.localization,'gyro');assert.equal(info.bounds.x1,300);assert.equal(info.robot.length,24);assert.equal(info.footprint.front,14.5);
    const reading=e.sensors.read(e.truth(),1/60);assert.equal(reading.odo,null);assert.ok(Number.isFinite(reading.imu)&&Math.abs(reading.imu)<.01);
    await assert.rejects(e.run({kind:'source',source:'test'}),/IMU-only/);
    await e.startPractice({mode:'teleop',timing:{teleopSeconds:2}});e.practiceInput(pad(0,-1));assert.equal(e.manualInput,null,'held sticks cannot start driving');
    e.practiceInput(pad());assert.equal(e.practice.neutralRequired,false);wallTime+=17;await e.practiceTick();assert.equal(e.practice.neutralRequired,false,'neutral arming survives the next physics tick');e.practiceInput(pad(0,-1));
    const x=e.truth().x;for(let i=0;i<30;i++)await e.practiceTick();assert.ok(e.truth().x>x+5,'controller drove the pushbot through physics');
    wallTime+=501;await e.practiceTick();assert.equal(e.practice.neutralRequired,true,'stale controller input locks driving');assert.equal(e.manualInput,null);e.practiceInput(pad(0,-1));assert.equal(e.manualInput,null);e.practiceInput(pad());wallTime+=17;await e.practiceTick();e.practiceInput(pad(0,-1));assert.ok(e.manualInput);e.practiceInput(null);assert.equal(e.practice.neutralRequired,true);assert.equal(e.manualInput,null);e.pause();const time=e.world.time;assert.equal(e.playing,false);assert.equal(e.world.time,time);
    e.play();for(let i=0;i<120;i++)await e.practiceTick();assert.equal(e.practice.phase,'finished');assert.equal(e.playing,false);assert.deepEqual(e.command,{forward:0,strafe:0,turn:0});
  }finally{e.dispose();}
});
test('full practice blocks controllers through autonomous and transition, preserves pose into teleop and Stop cancels the sequence',{skip:!built},async()=>{
  const e=engine();try{
    const start={x:25,y:72,heading:0};await e.load({field:'empty',start,sensors:{localization:'ideal'}});
    const route=P.plan({start,pins:[{x:80,y:72}],zones:[],clearance:1},e.info.footprint,[],e.info.bounds);
    assert.equal((await e.startPractice({mode:'match',timing:{autoSeconds:.5,transitionSeconds:.25,teleopSeconds:1},program:{kind:'route',route}})).ok,true);
    e.practiceInput(pad(1,-1));assert.equal(e.manualInput,null);for(let i=0;i<30;i++)await e.practiceTick();assert.equal(e.practice.phase,'transition');assert.equal(e.child,null);
    assert.equal(e.result.reason,'time-limit','an unfinished autonomous is reported, not silently called successful');
    const position=e.truth();for(let i=0;i<15;i++){e.practiceInput(pad(1,-1));await e.practiceTick();}assert.equal(e.practice.phase,'teleop');assert.ok(Math.hypot(e.truth().x-position.x,e.truth().y-position.y)<.1);
    e.practiceInput(pad(0,-1));assert.equal(e.manualInput,null);e.practiceInput(pad());e.practiceInput(pad(0,-1));await e.practiceTick();assert.ok(e.command.forward>0);
    e.stop();assert.equal(e.practice,null);assert.equal(e.playing,false);assert.equal(e.child,null);e.practiceInput(pad(0,-1));assert.equal(e.manualInput,null);
  }finally{e.dispose();}
});
test('custom field walls use the configured dimensions in physics, not the standard 144-inch square',{skip:!built},async()=>{
  const e=engine();try{await e.load({field:'empty',width:240,height:180,start:{x:35,y:72,heading:0},sensors:{localization:'gyro'},robot:{length:24,width:22,intakeIn:0}});
    for(let i=0;i<600;i++)e.tick({forward:1,strafe:0,turn:0});assert.ok(e.truth().x>220&&e.truth().x+12<=240.5,JSON.stringify(e.truth()));
    for(let i=0;i<600;i++)e.tick({forward:0,strafe:1,turn:0});assert.ok(e.truth().y>160&&e.truth().y+11<=180.5,JSON.stringify(e.truth()));
  }finally{e.dispose();}
});
test('tank families cannot strafe; their straight autonomous uses the Deck controller and reaches its pin',{skip:!built},async()=>{
  const e=engine();try{const start={x:30,y:72,heading:0},info=await e.load({field:'empty',start,robot:{drivetrain:'tank',length:24,width:22,intakeIn:0,massLb:23.5,driveRpm:400},sensors:{localization:'ideal'}});assert.equal(info.drive.maxStrafe,0);
    const lateral=P.plan({start,pins:[{x:30,y:110}],zones:[]},info.footprint,[],info.bounds);assert.equal((await e.run({kind:'route',route:lateral})).ok,true);for(let i=0;i<1200&&e.mode==='program';i++)await e.programTick();assert.ok(e.result);assert.ok(Math.hypot(e.result.truth.x-30,e.result.truth.y-110)<1.5,JSON.stringify(e.result));
    const straight=P.plan({start,pins:[{x:110,y:72}],zones:[]},info.footprint,[],info.bounds);assert.equal((await e.run({kind:'route',route:straight})).ok,true);
    for(let i=0;i<1200&&e.mode==='program';i++)await e.programTick();assert.ok(e.result,'tank autonomous finished');assert.ok(Math.hypot(e.result.truth.x-110,e.result.truth.y-72)<1.5,JSON.stringify(e.result));
  }finally{e.dispose();}
});
