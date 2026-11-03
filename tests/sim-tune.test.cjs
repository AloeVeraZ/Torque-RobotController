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
