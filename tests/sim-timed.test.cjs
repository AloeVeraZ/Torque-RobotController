'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),T=require('../ui/sim-timed.js'),{SimEngine}=require('../src/sim-engine.cjs');
const route={heading:0,segments:[{type:'line',points:[{x:30,y:72},{x:100,y:72}]}],stops:[{segment:0,wait:1,action:'Pause'}]};
test('timed route uses calibrated power and time; only IMU heading enters its runtime controller',()=>{
  const a=T.compile(route,{power:.5,forwardSpeed:50,startup:0});assert.equal(a.steps[0].seconds,2.8);assert.equal(a.steps[0].forward,.5);assert.equal(a.steps[1].seconds,1);assert.equal(a.steps[1].action,undefined,'the pause comes first');assert.deepEqual([a.steps[2].action,a.steps[2].seconds],['Pause',0],'then the action, until it finishes');
  const runner=new T.Runner(route,{power:.5,forwardSpeed:50,startup:0});const command=runner.advance(1/60,.1);assert.ok(command.drive.forward>0&&Math.abs(command.drive.forward)+Math.abs(command.drive.turn)<=.5+1e-9);assert.ok(command.drive.turn<0);assert.equal('x' in command.drive,false);for(let i=0;i<300;i++)runner.advance(1/60,0);assert.equal(runner.advance(1/60,0).done,true);
});
test('MotionModule enforces IMU-only timed drive and cannot correct X/Y using simulation truth',async()=>{
  const e=new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-timed-')),now:()=>0});try{await e.load({controller:'motionmodule',field:'empty',start:{x:30,y:72,heading:0},sensors:{localization:'ideal'},timing:{source:'measured',power:.45,forwardSpeed:120,startup:0}});assert.equal(e.config.sensors.localization,'gyro');assert.equal((await e.run({kind:'route',route})).ok,true);assert.equal(e.child,null,'there is no Java controller process');assert.equal(e.frame().execution,'timed');
    for(let i=0;i<600&&e.mode==='timed';i++)e.timedTick();assert.ok(e.result);assert.equal(e.result.kind,'timed');assert.equal(e.estimate,null);assert.ok(Math.abs(e.result.truth.x-100)>10,'intentionally wrong speed calibration is not corrected with hidden X/Y feedback');assert.equal(e.sensors.read(e.truth(),1/60).odo,null);
    e.stop();assert.equal(e.timed,null);assert.deepEqual(e.command,{forward:0,strafe:0,turn:0});
  }finally{e.dispose();}
});
test('FTC IMU-only autonomous starts a timed route rather than refusing to run',async()=>{
  const e=new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-ftc-imu-')),now:()=>0});try{await e.load({field:'empty',start:{x:30,y:72,heading:0},sensors:{localization:'gyro'}});assert.equal(e.config.sensors.localization,'gyro');assert.equal((await e.startPractice({mode:'autonomous',timing:{autoSeconds:10},program:{kind:'route',route}})).ok,true);assert.equal(e.frame().execution,'timed');for(let i=0;i<1200&&e.playing;i++)await e.practiceTick();/* 10 s of autonomous, then the 8 s transition */assert.ok(e.result);assert.equal(e.practice.phase,'finished');assert.equal(e.playing,false);}finally{e.dispose();}
});
test('timed autonomous transition advances simulation time for the whole configured hold',async()=>{
  const e=new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-timed-match-')),now:()=>0});try{await e.load({controller:'motionmodule',field:'empty',start:{x:30,y:72,heading:0}});await e.startPractice({mode:'match',timing:{autoSeconds:1,transitionSeconds:1,teleopSeconds:1},program:{kind:'route',route}});for(let i=0;i<60;i++)await e.practiceTick();assert.equal(e.practice.phase,'transition');const start=e.world.time;for(let i=0;i<60;i++)await e.practiceTick();assert.equal(e.practice.phase,'teleop');assert.ok(Math.abs(e.world.time-start-1)<1e-7);for(let i=0;i<60;i++)await e.practiceTick();assert.equal(e.practice.phase,'finished');assert.ok(Math.abs(e.world.time-3)<1e-7);}finally{e.dispose();}
});
test('without measured numbers, timed driving works its speeds out from the robot settings and lands near the pin',async()=>{
  const e=new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-timed-auto-')),now:()=>0});try{const info=await e.load({controller:'motionmodule',field:'empty',start:{x:30,y:72,heading:0},timing:{power:.45,forwardSpeed:999}});
    assert.equal(info.timing.source,'robot');assert.ok(info.timing.forwardSpeed>20&&info.timing.forwardSpeed<200,'worked out: '+info.timing.forwardSpeed);
    assert.equal((await e.run({kind:'route',route})).ok,true);for(let i=0;i<900&&e.mode==='timed';i++)e.timedTick();assert.ok(Math.abs(e.result.truth.x-100)<4,'ended at '+e.result.truth.x);
  }finally{e.dispose();}
});
test('a timed route stops before turning back on itself, for as long as the robot takes to come to rest',()=>{
  const back={heading:0,segments:[{type:'line',points:[{x:20,y:72},{x:60,y:72}]},{type:'line',points:[{x:60,y:72},{x:30,y:72}]}],stops:[]};
  const plan=T.compile(back,{power:1,forwardSpeed:50,startup:0,rest:.4,forwardCurve:[[.1,.05],[1,.98],[2,1.98]],curvePower:1});
  const moving=plan.steps.filter(s=>s.forward||s.strafe),stop=plan.steps.find(s=>!s.forward&&!s.strafe);
  assert.equal(moving.length,2);assert.ok(moving[0].forward>0&&moving[1].forward<0);assert.equal(stop.seconds,.4,'it stops for the measured time to rest');
  assert.ok(plan.steps.indexOf(stop)===1,'between the two legs');
  for(const k of ['cruise','forwardShare','fromStop','fromCurve','settle'])assert.equal(k in plan.steps[0],false,'no working fields left on the steps');
});
test('a leg at the power its rest-to-rest curve was measured at takes the time the curve gives',()=>{
  const leg={heading:0,segments:[{type:'line',points:[{x:20,y:72},{x:30,y:72}]}],stops:[]},curve=[[.1,.05],[.2,.14],[.5,.47],[1,.98],[2,1.98]];
  // 10 in at 50 in/s is .2 s at cruise; the curve says that takes .218 s of power from rest to rest.
  const a=T.compile(leg,{power:1,forwardSpeed:50,startup:0,forwardCurve:curve,curvePower:1});assert.ok(Math.abs(a.steps[0].seconds-(.2+(.5-.2)*(.2-.14)/(.47-.14)))<1e-9,String(a.steps[0].seconds));
  // At another power the curve does not apply: speed and lag as before.
  const b=T.compile(leg,{power:.5,forwardSpeed:50,startup:.1,forwardCurve:curve,curvePower:1});assert.ok(Math.abs(b.steps[0].seconds-.5)<1e-9,String(b.steps[0].seconds));
  // Typed (measured) numbers have no curve.
  assert.equal(T.settings({source:'measured',forwardCurve:curve,curvePower:1}).forwardCurve,undefined);
});
