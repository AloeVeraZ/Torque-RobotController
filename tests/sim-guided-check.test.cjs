'use strict';
// The guided check TeleOp on the virtual Control Hub. The virtual robot is wired as the "true" settings say, while the
// code is exported from settings that get some directions, servo positions and the turret encoder wrong, as a team's
// first export would. A scripted person at the robot answers each question from what the device really did (the hub's
// device readout), as someone watching it would. The check's results, applied to the wrong settings, give the true ones,
// and the autonomous exported from them then shoots and picks up what the simulator planned.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Mech=require('../ui/sim-mechanisms.js'),P=require('../ui/sim-planner.js'),X=require('../ui/sim-export.js'),F=require('../ui/sim-ftc.js'),C=require('../ui/sim-config.js'),{SimEngine}=require('../src/sim-engine.cjs');
const root=path.join(__dirname,'..'),built=fs.existsSync(path.join(root,'sim-runtime/dsim-host.cjs'))&&fs.existsSync(path.join(root,'sim-runtime/driver/classes/deck/sim/hub/VirtualHub.class'));
const skip=!built&&'run node tools/simulation/build.cjs first';
const base={drivetrain:'mecanum',length:17,width:17,heightIn:12,driveRpm:312,intakeIn:0},start={x:9.83,y:27,heading:0},target={x:59.25,y:58.56};
const pins=[{x:24,y:30,action:'Shoot',path:{kind:'action',action:'Spin up'}},{x:22,y:20,path:{rotate:'turn',heading:-90,style:'spline'}},
  {x:16,y:12.5,wait:.6,action:'Intake',path:{kind:'action',action:'Intake',style:'sharp'}},{x:24,y:24,path:{style:'sharp'}},{x:36,y:28,action:'Shoot',path:{kind:'action',action:'Spin up',style:'spline'}}];
const layout={name:'Guided',start,zones:[]};
const engine=()=>new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-check-')),now:()=>0,emit:msg=>{if(msg?.state==='error')engine.error=msg.error;}});
const exportFor=(info,robot,mechanisms)=>{const route=P.plan({start,zones:[],pins,clearance:2,style:'spline',defaultPower:1},info.footprint,info.fieldZones,info.bounds);route.defaultPower=1;
  return {route,out:F.files({route,layout,tuning:info.tuning,robot,localization:'fused',mechanisms,target:info.target||target,setupName:'Guided',routeJava:X.java(route,layout,{polygon:P.polygon})})};};

// The person at the robot. They see what each device does (devices: a wheel's forward command, a roller's pull-in, a
// servo's position, a turret's angle) and know where the servos and turret should be (truth); they press a button for a
// few ticks, then let go. Returns the "Deck results" values from the screen once the check says Done.
async function operate(e,truth,log=[]){
  const servos={};for(const x of F.mechanismDevices(truth)){
    if(x.role==='kicker'||x.role==='ramp')servos[x.name]={first:x.down,second:x.up};
    else if(x.role==='feeder'&&Mech.servoFeeder(x.feeder))servos[x.name]={first:x.rest,second:x.feed};}
  let hold=0,rest=0,settle=0,seen={},last='',pushing=null,blocks=null;
  const press=button=>{e.setGamepad(1,{[button]:true});hold=3;log.push(button);};
  for(let i=0;i<60000&&e.mode==='program';i++){
    // On blocks until the odometry steps: the wheels turn, the robot stays put. Then pushed by hand, half an inch a tick.
    const r=e.world.robots[0];
    if(blocks){r.pos.x=blocks.x;r.pos.y=blocks.y;r.heading=blocks.heading;r.vel={x:0,y:0};r.angVel=0;}
    if(pushing){const c=Math.cos(r.heading),s=Math.sin(r.heading);r.pos.x+=pushing.forward*c-pushing.left*s;r.pos.y+=pushing.forward*s+pushing.left*c;}
    await e.programTick();
    if(pushing){if(--pushing.ticks<=0){pushing=null;press('a');}continue;}
    if(hold>0){if(--hold===0){e.setGamepad(1,null);rest=3;}continue;}if(rest>0){rest--;continue;}
    const t=e.telemetry||{},dev=e.hubDevices||{},step=t.Step||'',answer=t.Answer||'',name=(/\("([^"]+)"\)\s*$/.exec(step)||[])[1],prompt=Object.keys(t).find(k=>!t[k]&&/^(Move|Now|Point)/.test(k))||'';
    if(step!==last){last=step;seen={};const floor=/^\d+ of \d+: (Pinpoint|OTOS|odometry)/.test(step);blocks=floor?null:blocks||{x:r.pos.x,y:r.pos.y,heading:r.heading};}
    if(step==='Done')return F.checkResults(t['Deck results']);
    if(answer.startsWith('A: pushed it 48 in')){pushing={forward:.5,left:0,ticks:96};continue;}
    if(answer==='A: pushed it | B: skip'){pushing={forward:0,left:.5,ticks:48};continue;}
    if(answer==='A: turn it | B: skip'){press('a');continue;}
    if('Watch it: it turns now.' in t){const v=dev[name];if(Number.isFinite(v)&&Math.abs(v)>Math.abs(seen[name]||0))seen[name]=v;continue;}
    if(answer.startsWith('A: yes | B: no')){const v=seen[name]||0;press(v>.01?'a':v<-.01?'b':'x');continue;}
    if(answer==='A: turned it | B: skip'){press('b');continue;}
    if(answer==='A: run them | B: skip'){press('a');continue;}
    if(answer.startsWith('D-pad up/down: move')){
      // A servo: the first position asked (down, rest, straight ahead) or the second (up, feed, a quarter turn left).
      const second=/^Now/.test(prompt),turret=/turret/.test(step);let dp;
      if(turret){const want=second?90:0,mount=truth.shooters[0].turretReversed?-1:1;dp=(want-dev[name])/(mount*truth.turret.servoDegrees);}
      else{const s=servos[name];dp=(second?s.second:s.first)-dev[name];}
      press(Math.abs(dp)<=.005?'a':Math.abs(dp)>=.05?(dp>0?'dpad_right':'dpad_left'):(dp>0?'dpad_up':'dpad_down'));continue;}
    if(answer.startsWith('D-pad left/right: turn 1 degree')){
      // A turret motor: turn it until it points there, wait for it to get there, then A.
      const want=/^Now/.test(prompt)?90:0,diff=want-(dev[name]??0);
      if(Math.abs(diff)<=.6){if(++settle>90){settle=0;press('a');}continue;}
      settle=0;press(Math.abs(diff)>=6?(diff>0?'dpad_up':'dpad_down'):(diff>0?'dpad_left':'dpad_right'));continue;}
  }
  throw Error(`The check did not finish (${e.mode}: ${JSON.stringify(e.telemetry)} ${engine.error||''})`);
}
// Runs the check exported from `believed` on a robot wired as `truth`; returns the results and the corrected settings.
async function guided(truth,believed){
  const e=engine();
  try{const tm=Mech.sanitize({enabled:true,...truth.mechanisms}),bm=Mech.sanitize({enabled:true,...believed.mechanisms});
    const info=await e.load({field:'biobuzz',alliance:'red',mechanisms:tm,start,robot:C.robot(truth.robot),sensors:{localization:'fused'}});
    const {out}=exportFor(info,C.robot(believed.robot),bm);
    assert.equal((await e.run({kind:'opmode',files:out.files,opMode:out.check.opMode})).ok,true,String(engine.error));
    const results=await operate(e,tm),applied=F.applyCheck(results,{robot:C.robot(believed.robot),mechanisms:bm,localization:'fused'});
    return {results,applied,robot:C.robot(applied.robot),mechanisms:Mech.sanitize(applied.mechanisms),truth:{robot:C.robot(truth.robot),mechanisms:tm}};}
  finally{e.dispose();}
}
// The autonomous from these settings on the truth robot, and the simulator's own run of the same route.
async function autonomous(settings,truth){
  const run=async program=>{const e=engine();try{const info=await e.load({field:'biobuzz',alliance:'red',mechanisms:truth.mechanisms,start,robot:truth.robot,sensors:{localization:'fused'}});
    const {route,out}=exportFor(info,settings.robot,settings.mechanisms);
    assert.equal((await e.run(program==='route'?{kind:'route',route}:{kind:'opmode',files:out.files,opMode:out.opMode})).ok,true,String(engine.error));
    for(let i=0;i<3600&&e.mode==='program'&&e.telemetry?.Phase!=='Done';i++)await e.programTick();
    return e.mechanismState();}finally{e.dispose();}};
  return {planned:await run('route'),code:await run('code')};
}

test('the check TeleOp: every step, its question, and the results it reports',()=>{
  const m=Mech.sanitize({enabled:true,intakes:[{kind:'kicker',sides:['front'],servo:'kicker'}],shooters:[{type:'turret',indexerKind:'pusher',indexer:'pusher'}],shooter:{control:'power'},turret:{kind:'servo'}});
  const java=F.files({route:P.plan({start,zones:[],pins:[{x:40,y:30}],clearance:2},{front:8.5,rear:8.5,half:8.5}),layout,tuning:{},robot:C.robot(base),localization:'fused',mechanisms:m,target,setupName:'Guided',routeJava:'class R {}'}).files['org/firstinspires/ftc/teamcode/PlannedRouteCheck.java'];
  assert.match(java,/@TeleOp\(name = "Guided check \(Deck\)", group = "Torque"\)/);
  assert.match(java,/private static final int STEPS = 10;/,'IMU, four wheels, kicker, flywheel, pusher, turret, Pinpoint');
  assert.match(java,/Did the front left wheel turn so the robot would drive FORWARD\?/);assert.match(java,/position\(kicker1, Mechanisms\.KICKER_1_DOWN, "Move the kicker DOWN/);
  assert.match(java,/result\("shooters\.0\.restPos", number\(rest\)\)/);assert.match(java,/result\("turret\.servoCenter", number\(center\)\)/);
  assert.doesNotMatch(java,/topSpeed\(/,'a set-power flywheel has no top speed step');assert.match(java,/String\.format\(Locale\.US/,'numbers are written with a decimal point on every robot');
  // The results line read back and applied.
  const values=F.checkResults('Deck results : v1 robot.frontRight.reversed=true robot.frontLeft.reversed=true intakes.0.downPos=0.150 shooters.0.turretReversed=true turret.servoDegrees=272.7 shooter.pidf=1.2,0.12,0,12 shooters.0.restPos=?missing imu.turn=?backward');
  assert.deepEqual(values,{'robot.frontRight.reversed':'true','robot.frontLeft.reversed':'true','intakes.0.downPos':'0.150','shooters.0.turretReversed':'true','turret.servoDegrees':'272.7','shooter.pidf':'1.2,0.12,0,12','shooters.0.restPos':'?missing','imu.turn':'?backward'});
  const a=F.applyCheck(values,{robot:C.robot(base),mechanisms:m,localization:'fused'});
  assert.deepEqual(a.changes,['Front right wheel: turns the other way on.','Intake 1 kicker down position: 0 → 0.15.','Shooter 1 turret: turns the other way on.','Turret servo range: 300 → 272.7 degrees.','Flywheel velocity PIDF: P 1.2, I 0.12, D 0, F 12.'],'the front left wheel is reversed already, so it is no change');
  assert.deepEqual(a.problems,['Shooter 1 feeder is not on the robot: its name is not in the robot configuration, or it is another kind of device there.','IMU read the quarter turn left as a turn right: the Control Hub mounting in Deck (Setup → Robot controller) is wrong.']);
  assert.equal(C.robot(a.robot).devices.frontRight.reversed,true);assert.equal(Mech.sanitize(a.mechanisms).intakes[0].downPos,.15);
  assert.equal(F.checkResults('Step : Done'),null);assert.deepEqual(F.checkResults('v1'),{});
});

test('guided check on the virtual Control Hub: motors, rollers, flywheels, a feeder and a turret turning the wrong way, and the turret encoder',{skip},async()=>{
  const truth={robot:{...base,devices:{frontRight:{reversed:true},backLeft:{reversed:false}}},
    mechanisms:{intakes:[{kind:'siderollers',sides:['front'],device:'crservo',motor:'roller',motor2:'roller2',reversed2:true}],shooters:[{type:'turret',motor:'shooter',motor2:'shooter_b',reversed:true,indexerReversed:true}],turret:{ticksPerDegree:5}}};
  const believed={robot:base,mechanisms:{intakes:[{kind:'siderollers',sides:['front'],device:'crservo',motor:'roller',motor2:'roller2'}],shooters:[{type:'turret',motor:'shooter',motor2:'shooter_b'}]}};
  const g=await guided(truth,believed);
  assert.deepEqual(g.applied.problems,[]);
  assert.equal(g.results['robot.frontLeft.reversed'],'true');assert.equal(g.results['robot.frontRight.reversed'],'true');assert.equal(g.results['robot.backLeft.reversed'],'false');
  assert.deepEqual(['frontLeft','frontRight','backLeft','backRight'].map(k=>F.hardware(g.robot,'fused').drive.motors[k].mount),['frontLeft','frontRight','backLeft','backRight'].map(k=>F.hardware(g.truth.robot,'fused').drive.motors[k].mount),'every wheel now turns as the robot is wired');
  const [s,t]=[g.mechanisms.shooters[0],g.truth.mechanisms.shooters[0]];
  assert.deepEqual([!!g.mechanisms.intakes[0].reversed,!!g.mechanisms.intakes[0].reversed2,!!s.reversed,!!s.reversed2,!!s.indexerReversed,!!s.turretReversed],[false,true,true,false,true,false]);
  assert.ok(Math.abs(g.mechanisms.turret.ticksPerDegree-5)<.06,`turret encoder measured ${g.mechanisms.turret.ticksPerDegree} ticks per degree`);
  assert.ok(g.mechanisms.shooter.pidf&&Math.abs(g.mechanisms.shooter.pidf.f-32767/(g.truth.mechanisms.shooter.rpm*g.truth.mechanisms.shooter.ticksPerRev/60))<.01,'PIDF from the top speed');
  assert.equal(g.results['shooter.rpm'],undefined,'the flywheel reaches its shooting speed');
  assert.ok(g.applied.changes.some(c=>/^Shooter 1 flywheel: turns the other way on\./.test(c)),g.applied.changes.join('\n'));void t;
  // The autonomous from the checked settings shoots and picks up what the simulator planned.
  const {planned,code}=await autonomous({robot:g.robot,mechanisms:g.mechanisms},g.truth);
  assert.ok(planned.shots>=5,`the simulator shoots (${planned.shots})`);assert.deepEqual([code.shots,code.pickedUp,code.score],[planned.shots,planned.pickedUp,planned.score]);
});

test('guided check on the virtual Control Hub: kicker, pusher and servo turret positions',{skip},async()=>{
  const truth={robot:base,mechanisms:{intakes:[{kind:'kicker',sides:['front'],servo:'kicker',downPos:.15,upPos:.85}],shooters:[{type:'turret',indexerKind:'pusher',indexer:'pusher',feedPos:.65,restPos:.25,turretReversed:true}],shooter:{control:'power',power:.9},turret:{kind:'servo',servoCenter:.55,servoDegrees:270}}};
  const believed={robot:base,mechanisms:{intakes:[{kind:'kicker',sides:['front'],servo:'kicker'}],shooters:[{type:'turret',indexerKind:'pusher',indexer:'pusher'}],shooter:{control:'power',power:.9},turret:{kind:'servo'}}};
  const g=await guided(truth,believed);
  assert.deepEqual(g.applied.problems,[]);
  const i=g.mechanisms.intakes[0],s=g.mechanisms.shooters[0];
  assert.deepEqual([i.downPos,i.upPos,s.restPos,s.feedPos],[.15,.85,.25,.65]);
  assert.equal(s.turretReversed,true);assert.ok(Math.abs(g.mechanisms.turret.servoCenter-.55)<=.005,`center ${g.mechanisms.turret.servoCenter}`);assert.ok(Math.abs(g.mechanisms.turret.servoDegrees-270)<12,`range ${g.mechanisms.turret.servoDegrees}`);
  assert.equal(g.mechanisms.shooter.pidf,undefined,'no PIDF for a set-power flywheel');
  const {planned,code}=await autonomous({robot:g.robot,mechanisms:g.mechanisms},g.truth);
  assert.ok(planned.shots>=5,`the simulator shoots (${planned.shots})`);assert.deepEqual([code.shots,code.pickedUp,code.score],[planned.shots,planned.pickedUp,planned.score]);
});

// ---- Odometry. The virtual Pinpoint, OTOS and pods are mounted as the "true" robot's settings say; the code is exported
// from the plain settings. The check's pushes and turn find the mounting, and the autonomous from the corrected settings
// ends where the route does.
const odoRobot=extra=>C.robot({drivetrain:'mecanum',length:17,width:17,heightIn:5,driveRpm:500,intakeIn:0,...extra});
async function odometryCheck(truth,localization){
  const e=engine(),start={x:72,y:72,heading:0};
  try{const info=await e.load({field:'empty',start,robot:truth,zones:[],sensors:{localization}});
    const route=P.plan({start,zones:[],pins:[{x:84,y:72}],clearance:2},info.footprint,[],info.bounds),layout={name:'Odometry',field:'empty',width:144,height:144,start,zones:[]};
    const out=F.files({route,layout,tuning:info.tuning,robot:odoRobot({}),localization,setupName:'Odometry',routeJava:X.java(route,layout,{polygon:P.polygon})});
    assert.equal((await e.run({kind:'opmode',files:out.files,opMode:out.check.opMode})).ok,true,String(engine.error));
    const results=await operate(e,Mech.sanitize({})),applied=F.applyCheck(results,{robot:odoRobot({}),mechanisms:Mech.sanitize({}),localization});
    return {results,applied,robot:C.robot(applied.robot)};}finally{e.dispose();}
}
// Where the autonomous exported from these settings ends, on the truth robot: inches from the route's end.
async function odometryRoute(truth,settings,localization){
  const e=engine(),start={x:20,y:30,heading:0},pins=[{x:110,y:40,wait:.5},{x:120,y:120}];
  try{const info=await e.load({field:'empty',start,robot:truth,zones:[],sensors:{localization}});
    const route=P.plan({start,zones:[],pins,clearance:2,style:'spline'},info.footprint,[],info.bounds),layout={name:'Odometry route',field:'empty',width:144,height:144,start,zones:[]};
    const out=F.files({route,layout,tuning:info.tuning,robot:settings,localization,setupName:'Odometry',routeJava:X.java(route,layout,{polygon:P.polygon,className:'PlannedRoute',packageName:'org.firstinspires.ftc.teamcode'})});
    assert.equal((await e.run({kind:'opmode',files:out.files,opMode:out.opMode})).ok,true,String(engine.error));
    for(let i=0;i<2400&&e.mode==='program'&&e.telemetry?.Phase!=='Done';i++)await e.programTick();
    const t=e.truth();return Math.hypot(t.x-120,t.y-120);}finally{e.dispose();}
}
const near=(value,want,within,what)=>assert.ok(Math.abs(Number(value)-want)<=within,`${what}: ${value}, wanted ${want} ± ${within}`);

test('odometry settings: kept only when they differ, every value bounded, defaults filled in',()=>{
  assert.equal(C.robot({}).odometry,undefined,'nothing stored for the plain robot');
  const r=C.robot({odometry:{pinpoint:{xOffset:4,yOffset:-3.5,yReversed:true,pods:'swingarm',xReversed:'yes'},otos:{heading:270,x:99,linearScalar:1.5,angularScalar:.99},pods:{perp:{x:-5,reversed:true},par:{y:4},bogus:{x:1}}}});
  assert.deepEqual(r.odometry,{pinpoint:{pods:'swingarm',yOffset:-3.5,yReversed:true},otos:{angularScalar:.99},pods:{perp:{x:-5,reversed:true}}},'defaults dropped, out-of-range values refused');
  assert.equal(C.robot({odometry:{otos:{heading:270}}}).odometry,undefined,'270° is the default -90°');assert.equal(C.robot({odometry:{otos:{heading:450}}}).odometry.otos.heading,90);
  const all=C.odometryOf(r);assert.deepEqual([all.pinpoint.xOffset,all.pinpoint.yOffset,all.otos.heading,all.pods.par.y,all.pods.perp.x],[4,-3.5,-90,4,-5]);
  const h=F.hardware(r,'fused');assert.deepEqual(h.pinpointMount,{pods:'swingarm',xOffset:4,yOffset:-3.5,xReversed:false,yReversed:true,ticksPerMm:13.262911796569824});
  assert.deepEqual(F.hardware(r,'odometry').pods.map(p=>[p.key,p.x,p.y,!!p.reversed]),[['par',0,4,false],['perp',-5,0,true]]);
  // The check's results, applied.
  const a=F.applyCheck(F.checkResults('v1 pinpoint.xReversed=true pinpoint.xOffset=-2.500 pinpoint.pods=swingarm otos.heading=90.0 otos.linearScalar=1.0200 pods.perp.x=-5.000 pods.perp.reversed=false pinpoint.distance=?31 otos.mirror=?mirrored'),{robot:odoRobot({}),localization:'fused'});
  assert.deepEqual(a.changes,['Pinpoint X (forward) pod: counts backward on.','Pinpoint X (forward) pod: 4 in → -2.5 in left of centre.','Pinpoint pods: goBILDA 4-bar pod → goBILDA swingarm pod.','OTOS X axis: -90° → 90° (counterclockwise from the robot\'s front).','OTOS linear scalar: 1 → 1.02.','Sideways odometry pod: -3 in → -5 in forward of centre.']);
  assert.deepEqual(a.problems,['The Pinpoint\'s pods read 31 in for the 48 in push: check the pod type, and that the robot moved exactly 48 in.','The OTOS sees the floor mirrored, as if it were mounted upside down.']);
  assert.deepEqual(C.robot(a.robot).odometry,{pinpoint:{pods:'swingarm',xOffset:-2.5,xReversed:true},otos:{heading:90,linearScalar:1.02},pods:{perp:{x:-5}}});
});

test('deck-sim robot --odometry sets where the odometry sits and refuses what the robot cannot have',async()=>{
  const D=require('../tools/deck-sim.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'deck-odo-')),file=path.join(dir,'r.json'),log=console.log,said=[];console.log=line=>said.push(String(line));
  try{await D.main(['new',file,'--field','empty','--sensors','fused']);await D.main(['robot',file,'--odometry','pinpoint.xOffset=-2.5,pinpoint.pods=swingarm,pinpoint.yReversed=on,otos.heading=270,pods.perp.reversed=on']);
    assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).robot.odometry,{pods:{perp:{reversed:true}},pinpoint:{pods:'swingarm',xOffset:-2.5,yReversed:true}},'270° is the default -90°');
    assert.match(said.at(-1),/Odometry: pods\.perp\.reversed=on, pinpoint\.pods=swingarm, pinpoint\.xOffset=-2\.5, pinpoint\.yReversed=on\./);
    await D.main(['robot',file,'--odometry','pods.perp.reversed=off,pinpoint.pods=4bar']);assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).robot.odometry,{pinpoint:{xOffset:-2.5,yReversed:true}});
    await assert.rejects(D.main(['robot',file,'--odometry','pinpoint.zOffset=1']),/--odometry keys are pods\.par\.x, /);await assert.rejects(D.main(['robot',file,'--odometry','otos.linearScalar=1.5']),/is from 0\.872 to 1\.127/);
    await assert.rejects(D.main(['robot',file,'--odometry','pods.par.y=40']),/is from -36 to 36/);await assert.rejects(D.main(['robot',file,'--odometry','pinpoint.xReversed=yes']),/takes on or off/);
    await assert.rejects(D.main(['robot',file,'--odometry','pinpoint.pods=wheel']),/is one of: 4bar, swingarm/);await assert.rejects(D.main(['robot',file,'--odometry','otos.x=']),/needs a number/);}
  finally{console.log=log;fs.rmSync(dir,{recursive:true,force:true});}
});

for(const [name,localization,mount,expect] of [
  ['the Pinpoint: a reversed strafe pod, swingarm pods and its pods off where the settings say','fused',{pinpoint:{xOffset:-2.5,yOffset:5,yReversed:true,pods:'swingarm'}},
    r=>{assert.equal(r['pinpoint.xReversed'],'false');assert.equal(r['pinpoint.yReversed'],'true');assert.equal(r['pinpoint.pods'],'swingarm');near(r['pinpoint.xOffset'],-2.5,.3,'X pod offset');near(r['pinpoint.yOffset'],5,.3,'Y pod offset');}],
  ['the OTOS: turned the other way, off centre, and reading 2% short','optical',{otos:{x:3,y:-1,heading:90,linearScalar:1.02,angularScalar:.99}},
    // The simulator's own OTOS model reads distance 0.5% long on top (its scale error), so the scalar it needs is 1.02 / 1.005.
    r=>{near(r['otos.heading'],90,2,'X axis');near(r['otos.x'],3,.4,'forward');near(r['otos.y'],-1,.4,'left');near(r['otos.linearScalar'],1.02/1.005,.006,'linear scalar');near(r['otos.angularScalar'],.99,.005,'angular scalar');}],
  ['two pods: the sideways one reversed and further back','odometry',{pods:{par:{y:5},perp:{x:-5,reversed:true}}},
    r=>{assert.equal(r['pods.par.reversed'],'false');assert.equal(r['pods.perp.reversed'],'true');near(r['pods.par.y'],5,.3,'forward pod');near(r['pods.perp.x'],-5,.3,'sideways pod');}],
  ['three pods: the right one reversed','odometry3',{pods:{par_left:{y:6.5},par_right:{y:-5.5,reversed:true}}},
    r=>{assert.equal(r['pods.par_right.reversed'],'true');assert.equal(r['pods.par_left.reversed'],'false');near(r['pods.par_left.y'],6.5,.3,'left pod');near(r['pods.par_right.y'],-5.5,.3,'right pod');}]])
  test(`guided check finds how the odometry is mounted: ${name}`,{skip},async()=>{
    const truth=odoRobot({odometry:mount}),g=await odometryCheck(truth,localization);
    expect(g.results);assert.deepEqual(g.applied.problems,[],JSON.stringify(g.results));
    const fixed=await odometryRoute(truth,g.robot,localization),plain=await odometryRoute(truth,odoRobot({}),localization);
    assert.ok(fixed<1.5,`with the check's settings the autonomous ends ${fixed.toFixed(2)} in from the route's end`);
    assert.ok(plain>fixed+2,`with the plain settings it ends ${plain.toFixed(2)} in away (the check's: ${fixed.toFixed(2)})`);
  });
