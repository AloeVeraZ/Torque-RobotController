'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const T=require('../ui/sim-tune.js'),Types=require('../ui/sim-mechanism-types.js');
const close=(a,b,tol,msg)=>assert.ok(Math.abs(a-b)<=tol,`${msg}: ${a} vs ${b}`);

test('every mechanism type has a calibration template, and the illegal ones are flagged',()=>{
  const ids=Object.keys((Types.TYPES||globalThis.DeckMechanismTypes?.TYPES));assert.equal(ids.length,80);
  for(const id of ids)assert.ok(T.TEMPLATES[T.TYPE_TEMPLATE[id]],`${id} has no template`);
  assert.deepEqual([...T.ILLEGAL].sort(),['piston','propeller','suction-gripper']);
});

test('feedback decides the template: a blind servo is blind whatever it moves, an encoder makes a position loop',()=>{
  const plain={role:'kin-servo',kind:'servo',sensors:[]},axon={...plain,sensors:[{kind:'axonFeedback',use:'position'}]};
  assert.equal(T.feedbackOf(plain).kind,'endpoints');assert.equal(T.templateOf('claw',T.feedbackOf(plain)),'T5');
  assert.equal(T.feedbackOf(axon).kind,'servo');assert.equal(T.templateOf('claw',T.feedbackOf(axon)),'T4');
  const lift={role:'kin-motor',kind:'dcmotor',encoder:true,sensors:[]},bare={role:'kin-motor',kind:'dcmotor',encoder:false,sensors:[]};
  assert.equal(T.templateOf('lift',T.feedbackOf(lift)),'T1');assert.equal(T.templateOf('lift',T.feedbackOf(bare)),'T5');
  assert.equal(T.templateOf('flywheel',T.feedbackOf({role:'flywheel',kind:'dcmotor',encoder:true,sensors:[]})),'T3');
  assert.equal(T.feedbackOf({role:'steer',kind:'crservo',sensors:[{kind:'axonFeedback',use:'position'}]}).wrap,true);
  assert.equal(T.feedbackOf({role:'imu'}),null);
});

test('gates open in order, go stale when what they depended on changes, and follow the template',()=>{
  const rec={gates:{G0:{dep:'a'},G1:{dep:'a'},G2:{dep:'a'}}};
  const s=T.gateStates('T1',rec,{all:'a'});assert.equal(s.G2,'pass');assert.equal(s.G3,'todo');assert.equal(s.G4,'locked');assert.equal(s.GT,'na');
  const stale=T.gateStates('T1',rec,{all:'a',G1:'b'});assert.equal(stale.G1,'stale');assert.equal(stale.G2,'locked');
  const blind=T.gateStates('T5',{},{});assert.equal(blind.G6,'na');assert.equal(blind.G3,'na');assert.equal(blind.G0,'todo');
  assert.equal(T.gateStates('T3',{},{threshold:true}).GT,'locked');
});

test('units: counts through a gear ratio and a spool, and volts through two points, both ways',()=>{
  // goBILDA 312 RPM (537.7 counts a turn) on a 120 mm-per-turn belt slide, 2-stage cascade.
  const slide={cpr:537.7,ratio:1,perTurn:T.perTurnOf({unit:'mm',spoolMm:120/Math.PI,stages:2})};
  close(T.toUnits(537.7,slide),240,1e-9,'one motor turn moves the top stage 240 mm');close(T.toRaw(240,slide),537.7,1e-9,'and back');
  // A turret: 8192-count Through Bore on the motor, 62:109 pulleys to the ring, reversed, zero captured at 10°.
  const turret={cpr:8192,ratio:109/62,perTurn:360,sign:-1,offset:10};
  close(T.toUnits(T.toRaw(45,turret),turret),45,1e-9,'turret round trip');
  // Axon feedback: 0.3 V at 0°, 3.0 V at 300°.
  const axon={analog:true,v0:.3,v1:3,u0:0,u1:300};close(T.toUnits(1.65,axon),150,1e-9,'mid-span');close(T.toRaw(150,axon),1.65,1e-9,'mid-span back');
  // REV potentiometer: mid-travel reads 1.10 V, not 1.65 V.
  close(T.toUnits(1.1,{analog:true,curve:'rev-pot'}),135,.01,'REV curve');
});

test('fits: hold band splits gravity from friction, ramps give kS and kV, two encoders give the ratio',()=>{
  const hb=T.holdBand(.32,.12);close(hb.kG,.22,1e-9,'kG');close(hb.kS,.10,1e-9,'kS');
  const pts=[.2,.4,.6,.8].map(p=>({power:p,velocity:(p-.05)/.0004}));const v=T.velocityFit(pts);close(v.kV,.0004,1e-9,'kV');close(v.kS,.05,1e-9,'kS');assert.ok(v.r2>.999);
  const motor=[0,1000,2000,3000],ring=motor.map(x=>x*62/109);close(T.ratioFit(motor,ring).ratio,62/109,1e-9,'ratio');
});

test('step scoring and the simulated loop: a sane gain settles, a hot one swings, and wrap takes the short way',()=>{
  const free=300,good=T.suggest({kind:'position',freeSpeed:free,tau:.06});
  const ok=T.simulate({kind:'position',from:90,target:0,...good,tolerance:1,freeSpeed:free,tau:.06});assert.ok(ok.holds,'settles');
  const hot=T.simulate({kind:'position',from:90,target:0,kP:good.kP*25,kI:0,kD:0,tolerance:1,freeSpeed:free,tau:.06,period:.05});assert.ok(hot.overshoot>ok.overshoot,'more swing');
  const wrap=T.simulate({kind:'position',from:170,target:-170,...good,tolerance:1,freeSpeed:free,tau:.06,wrap:true});assert.ok(wrap.first>0&&wrap.first<=20,'shortest way is +20°, not −340°');
  const info=T.stepInfo(ok.samples.map(s=>({t:s.t,value:s.value})),90,0,1);assert.ok(info.holds&&info.rise>0);
  const g=T.simulate({kind:'position',from:0,target:100,...good,kG:.2,gravity:.2,tolerance:1,freeSpeed:free,tau:.06});assert.ok(g.holds,'kG holds a gravity load');
});

test('thresholds sit between the two groups, and records keep only plain values',()=>{
  const t=T.threshold([.05,.06,.07],[.4,.5,.45]);close(t.value,.235,1e-9,'midpoint');assert.equal(t.overlap,false);
  assert.equal(T.threshold([.1,.3],[.2,.4]).overlap,true);
  const c=T.sanitize({hub:{at:'x',hash:'h'},mechs:{'shooter:0:flywheel':{gates:{G1:{dep:'a'}},fn:()=>1,big:'x'.repeat(500)}},junk:1});
  assert.deepEqual(Object.keys(c),['hub','mechs']);assert.equal(c.mechs['shooter:0:flywheel'].fn,undefined);assert.equal(c.mechs['shooter:0:flywheel'].big.length,200);
  const java=T.constants([{name:'lift',template:'T1',rec:{transform:{cpr:537.7,perTurn:240},range:{lo:0,hi:600},ff:{kS:.1,kG:.2,kV:.001},pid:{kP:.01,kI:0,kD:.0005,tolerance:2}}}]);
  assert.match(java,/public final class DeckCalibration/);assert.match(java,/LIFT_KG = 0\.2/);assert.match(java,/LIFT_MAX = 600/);
});

// ---- what a passed gate puts into the simulated robot ----
const Mech=require('../ui/sim-mechanisms.js'),Kin=require('../ui/sim-kinematics.js');
const byPath=values=>Object.fromEntries(values.map(v=>[v.path,v]));
const all={G0:true,G1:true,G2:true,G3:true,G4:true,G5:true,G6:true,G7:true,G8:true};

test('a flywheel: its encoder ticks a turn, the robot\'s spin-up and its at-speed tolerance; its top speed from the ramps',()=>{
  // A 6000 RPM motor 1:1 (28 counts a turn) measured to top out at (1 − 0.05) / 0.00019 = 5000 RPM, stepped 0 → 3000 RPM.
  const rec={transform:{cpr:28,ratio:1,perTurn:60,unit:'rpm'},ff:{kS:.05,kG:0,kV:.00019},pid:{kP:.0006,kI:0,kD:0,kF:.0002,kS:.05,tolerance:60,from:0,target:3000},response:{settle:.9,rise:.5,overshoot:0}};
  close(T.topSpeed(rec.ff),5000,1e-6,'top speed');
  const v=byPath(T.simValues({id:'shooter:0:flywheel',template:'T3'},rec,all,{rpm:3000}));
  assert.equal(v['shooter.ticksPerRev'].value,28);assert.equal(v['shooter.ticksPerRev'].gate,'G3');
  close(v['shooter.tolerance'].value,.02,1e-9,'60 RPM of 3000');assert.equal(v['shooter.tolerance'].gate,'G7');
  // Ready (within 2 %) 0.9 s after starting, as on the robot: the straight-line spin-up takes 0.9 / 0.98 s to full speed.
  close(v['shooter.spinUp'].value,.9/.98,1e-5,'spin-up from the robot\'s run');
  // A gate passed before runs were kept: the loop simulated on the measured gains gives a settle time instead.
  const old=byPath(T.simValues({id:'shooter:0:flywheel',template:'T3'},{...rec,response:undefined},all,{rpm:3000}));
  assert.ok(old['shooter.spinUp'].value>0&&old['shooter.spinUp'].value<10,'simulated spin-up');
  // Only what passes now counts: before G7 there is no tolerance or spin-up, before G3 no ticks.
  assert.deepEqual(T.simValues({id:'shooter:0:flywheel',template:'T3'},rec,{G3:true,G6:true},{}).map(x=>x.path),['shooter.ticksPerRev']);
  assert.deepEqual(T.simValues({id:'shooter:0:flywheel',template:'T3'},rec,{},{}),[]);
});

test('a motor turret: ticks a degree, its stops on each side of the front, and its speed from the measured step',()=>{
  const rec={transform:{cpr:8192,ratio:109/62,perTurn:360,unit:'deg'},range:{lo:-80,hi:95},ff:{kS:.08,kG:0,kV:0},pid:{kP:.02,kI:0,kD:.001,kS:.08,tolerance:1,from:-40,target:40},response:{settle:.5}};
  const v=byPath(T.simValues({id:'shooter:1:turret',template:'T2'},rec,all,{turret:'motor',free:400}));
  close(v['turret.ticksPerDegree'].value,8192*109/62/360,1e-3,'ticks a degree');
  assert.equal(v['turret.min'].value,-80);assert.equal(v['turret.max'].value,95);assert.equal(v['turret.min'].gate,'G5');
  close(v['turret.speed'].value,160,1e-9,'80° in 0.5 s');assert.equal(v['turret.speed'].gate,'G7');
  // Stops always straddle the front, as the simulation keeps them; a servo turret has no encoder ticks to give.
  const off=byPath(T.simValues({id:'shooter:0:turret',template:'T2'},{...rec,range:{lo:10,hi:200}},all,{turret:'motor'}));assert.equal(off['turret.min'].value,0);assert.equal(off['turret.max'].value,180);
  assert.equal(byPath(T.simValues({id:'shooter:0:turret',template:'T4'},rec,all,{turret:'servo'}))['turret.ticksPerDegree'],undefined);
  // The hood, feeders and intakes change nothing the simulation runs on.
  for(const id of ['shooter:0:hood','shooter:0:feeder','intake:0:roller','intake:0:deploy'])assert.deepEqual(T.simValues({id,template:'T4'},rec,all,{}),[],id);
});

test('a moving part: stops in its joint\'s units and its actuator\'s speed, from the step or else the ramps',()=>{
  const arm={id:'kin:armMotor',template:'T1',joint:{id:'arm',type:'revolute'},actuator:'armMotor'};
  const rec={transform:{cpr:537.7,ratio:4,perTurn:360,unit:'deg'},range:{lo:-5,hi:120},ff:{kS:.06,kG:.12,kV:0},pid:{kP:.03,kI:0,kD:.002,kG:.12,kS:.06,tolerance:2,from:10,target:100},response:{settle:1}};
  const v=byPath(T.simValues(arm,rec,all,{free:180}));
  assert.equal(v['joint:arm:lower'].value,-5);assert.equal(v['joint:arm:upper'].value,120);close(v['actuator:armMotor:speed'].value,90,1e-9,'90° in 1 s');
  // Before G7, the speed at full power less what friction and gravity take: 180 × (1 − 0.06 − 0.12).
  const g6=byPath(T.simValues(arm,{...rec,pid:undefined,response:undefined},{...all,G7:false},{free:180}));close(g6['actuator:armMotor:speed'].value,180*.82,1e-6,'from the ramps');assert.equal(g6['actuator:armMotor:speed'].gate,'G6');
  // A slide measured in millimetres goes in inches; one measured in degrees of its spool does not fit its joint.
  const slide={id:'kin:lift',template:'T1',joint:{id:'liftSlide',type:'prismatic'},actuator:'lift'},mm={transform:{cpr:537.7,ratio:1,perTurn:240,unit:'mm'},range:{lo:0,hi:762}};
  const s=byPath(T.simValues(slide,mm,all,{}));close(s['joint:liftSlide:upper'].value,30,1e-9,'762 mm');assert.equal(s['joint:liftSlide:lower'].value,0);
  assert.deepEqual(T.simValues(slide,{...mm,transform:{...mm.transform,unit:'deg'}},all,{}),[]);
  // A stale range is not used; a spinning part's measured top speed is its actuator's, in degrees a second.
  assert.equal(byPath(T.simValues(arm,rec,{...all,G5:false},{free:180}))['joint:arm:lower'],undefined);
  const spin=byPath(T.simValues({id:'kin:spinner',template:'T3',joint:{id:'wheel',type:'continuous'},actuator:'spinner'},{transform:{cpr:28,ratio:1,perTurn:60,unit:'rpm'},ff:{kS:.05,kV:.00095}},all,{}));
  close(spin['actuator:spinner:speed'].value,6000,1e-6,'1000 RPM is 6000°/s');
});

test('measured values go into the robot, survive its sanitizers, and stop counting as measured once Setup changes them',()=>{
  const robot={mechanisms:Mech.sanitize({}),kinematics:Kin.sanitize({joints:[{id:'arm',type:'revolute',source:'inferred'}],actuators:[{id:'armMotor',joint:'arm',kind:'dcmotor'}]})};
  const values=[{path:'turret.min',value:-80},{path:'turret.max',value:95},{path:'shooter.spinUp',value:.92},{path:'joint:arm:lower',value:-5},{path:'joint:arm:upper',value:120},{path:'actuator:armMotor:speed',value:90},{path:'joint:gone:lower',value:1}];
  const raw=T.simWrite(robot,values),next={mechanisms:Mech.sanitize(raw.mechanisms),kinematics:Kin.sanitize(raw.kinematics)};
  assert.notEqual(raw.mechanisms,robot.mechanisms,'written into copies');assert.equal(robot.mechanisms.turret.min,Mech.DEFAULTS.turret.min,'the original is untouched');
  for(const v of values.slice(0,6))assert.equal(T.simValueAt(next,v.path),v.value,v.path);
  assert.equal(T.simValueAt(next,'joint:gone:lower'),undefined,'a removed joint is skipped');
  assert.equal(next.kinematics.joints[0].source,'user','a measured joint is the team\'s now');
  const rec={applied:Object.fromEntries(values.slice(0,6).map(v=>[v.path,v.value]))};
  assert.ok(T.simMeasured(rec,next,'turret.max'));next.mechanisms.turret.max=120;assert.equal(T.simMeasured(rec,next,'turret.max'),false,'changed in Setup');
  assert.equal(T.simMeasured({},next,'turret.min'),false,'nothing measured');
  // The record keeps what it wrote and the robot's run, as plain values.
  const kept=T.sanitize({mechs:{'kin:armMotor':{gates:{G5:{dep:'a'}},applied:rec.applied,response:{settle:1,rise:.4,overshoot:.02}}}}).mechs['kin:armMotor'];
  assert.deepEqual(kept.applied,rec.applied);assert.equal(kept.response.settle,1);
});
