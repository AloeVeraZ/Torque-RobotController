'use strict';
// The swerve steering law (ui/sim-chassis-cal.js snapStep; TorqueDebug.java's snap and the TeleOp's Steer run the same
// steps): snap to the angle, then nudge onto it. Checked here against simulated pods: a continuous servo with a delay from
// command to motion, a lag, a speed that saturates, static and kinetic friction, and an encoder read with noise through
// the Control Hub's 12-bit ADC. "real" is shaped like a kiwi swerve pod measured on a robot: about 330°/s at 28% power.
const {test}=require('node:test'),assert=require('node:assert/strict');
const K=require('../ui/sim-chassis-cal.js');
const PODS={real:{gain:1660,vmax:550,start:.08,keep:.06,delay:2,tau:25,noise:.11},slow:{gain:650,vmax:400,start:.12,keep:.084,delay:1,tau:60,noise:.11},
  free:{gain:1200,vmax:500,start:.03,keep:.02,delay:2,tau:30,noise:.3},laggy:{gain:1660,vmax:550,start:.08,keep:.06,delay:4,tau:40,noise:.11}};
function makePod(p,seed=1){let angle=7,vel=0,r=seed;const q=Array(p.delay).fill(0),rnd=()=>{r=(r*1664525+1013904223)%4294967296;return r/4294967296;};
  return {step(u){q.push(u);const c=q.shift(),a=Math.abs(c),stuck=Math.abs(vel)<3&&a<p.start,want=stuck||a<p.keep?0:Math.sign(c)*Math.min(p.vmax,(a-p.keep)*p.gain+20);vel+=(want-vel)*Math.min(1,20/p.tau);if(stuck)vel=0;angle+=vel*.02;},
    read(){let n=0;for(let i=0;i<4;i++)n+=rnd();return Math.round((angle+(n-2)*p.noise)/360*4095)/4095*360;},get angle(){return angle;}};}
// The targets in turn, each held 1.7 s: for each, when it settled inside the band for good, how far past it went, how often it crossed.
function run(p,k,targets,{seed=1,band=1.5,sign=1}={}){const pod=makePod(p,seed),s=K.snapState(),out=[];let most=0;
  for(const target of targets){let settle=null,over=0,cross=0,side=0;const from=Math.sign(target-pod.angle)||1;
    for(let i=0;i<85;i++){const m=sign*pod.read();let e=sign*target-m;e-=360*Math.round(e/360);const u=K.snapStep(s,e,m,.02,k);most=Math.max(most,Math.abs(u));pod.step(u);const err=target-pod.angle;
      if(-from*err>over)over=-from*err;const sd=Math.abs(err)>band/3?Math.sign(err):side;if(side&&sd!==side)cross++;side=sd;if(Math.abs(err)<=band){if(settle===null)settle=i*.02;}else settle=null;}
    out.push({target,settle,over,cross,end:target-pod.angle});}
  return {moves:out,scale:s.scale,most};}
// What the tuner would measure on a pod, and the gains it starts from (in degrees: span 360).
const speedAt=(p,u)=>Math.abs(u)<p.keep?0:Math.min(p.vmax,(Math.abs(u)-p.keep)*p.gain+20);
const startGains=p=>{const power=Math.min(.5,p.start+.2);return {...K.snapGains({Kv:speedAt(p,power)/power,L:Math.min(.3,p.delay*.02+p.tau/1000+.06),breakaway:p.start,keep:p.keep,creep:speedAt(p,p.keep*1.15+.005),noise:p.noise*4,span:360}),tol:.9,wrap:360};};
const ALL=[90,0,-90,0,45,0,-45,0,30,0,-30,0];

test('from the tuner’s own starting gains every pod lands 90°, 45° and 30° moves inside 1.5° and stays there',()=>{
  for(const [name,p] of Object.entries(PODS))for(const seed of [1,2,3]){const r=run(p,startGains(p),ALL,{seed});
    for(const m of r.moves){assert.notEqual(m.settle,null,`${name} seed ${seed}: ${m.target}° never settled (ended ${m.end.toFixed(1)}° off)`);assert.ok(Math.abs(m.end)<=1.5,`${name}: ended ${m.end.toFixed(2)}° off`);assert.ok(m.cross<=2,`${name}: crossed ${m.cross} times`);}}
});

test('with the gains the search reaches, a quick servo snaps a quarter turn in well under half a second',()=>{
  const p=PODS.real,k={...startGains(p),kP:.0087,kD:.00008};
  for(const seed of [1,2,3]){const r=run(p,k,ALL,{seed});for(const m of r.moves){assert.ok(m.settle!==null&&m.settle<=.45,`${m.target}° took ${m.settle} s`);assert.ok(m.over<=3,`${m.target}° went ${m.over.toFixed(1)}° past`);}
    assert.ok(r.most>.6,'far from the target it drives hard');}
});

test('a constant push cannot do this: the old loop’s kick bounces a quick servo off a 1.5° target for good',()=>{
  // The loop before: power = kP·error + kS towards the target whenever outside the tolerance (what TorqueDebug ran).
  const p=PODS.real,pod=makePod(p),kP=.0046,kS=.08;let crossings=0,side=0,inside=0;
  for(let i=0;i<150;i++){const e=30-pod.read();pod.step(Math.abs(e)>.9?Math.max(-1,Math.min(1,kP*e+kS*Math.sign(e))):0);const err=30-pod.angle;if(i>60){const sd=Math.abs(err)>.5?Math.sign(err):side;if(side&&sd!==side)crossings++;side=sd;if(Math.abs(err)<=1.5)inside++;}}
  assert.ok(crossings>=4,`it kept crossing the target (${crossings} times in 1.8 s)`);
  const r=run(p,startGains(p),[30]);assert.ok(r.moves[0].settle!==null&&r.moves[0].cross<=1,'the nudge lands the same move');
});

test('inside the tolerance the servo is off, and a wheel knocked out of it is nudged back',()=>{
  const k={...startGains(PODS.real)},s=K.snapState();for(let i=0;i<10;i++)assert.equal(K.snapStep(s,.5,10,.02,k),0,'0.5° off, inside 0.9°: no power');
  const pod=makePod(PODS.real,4),st=K.snapState();let t=0;for(;t<60;t++){const m=pod.read();pod.step(K.snapStep(st,0-m+7,m-7,.02,k));}
  assert.ok(Math.abs(pod.angle-7)<=1.5);
});

test('a wheel that stalls short of the nudge zone is pushed with the power that starts it',()=>{
  // kS here is under what starts this pod, and kP too small to help: without the stall push it would sit 20° away for ever.
  const p=PODS.slow,k={...startGains(p),kP:.0006,kD:0,kS:p.keep*1.05},r=run(p,k,[20],{seed:2});
  assert.notEqual(r.moves[0].settle,null,`it got there (ended ${r.moves[0].end.toFixed(1)}° off)`);
});

test('the nudge finds its own size: a pulse too weak to move the wheel grows until it does',()=>{
  const p=PODS.real,k={...startGains(p),pulse:p.start*.55},r=run(p,k,[8,0,6,0],{seed:3});
  assert.ok(r.scale>1.3,`the pulse grew (scale ${r.scale.toFixed(2)})`);assert.ok(r.moves.slice(1).every(m=>m.settle!==null),'and the later moves land');
});

test('a servo that lowers the reading gets the same loop the other way round',()=>{
  const p=PODS.real,k=startGains(p),s1=K.snapState(),s2=K.snapState();
  for(const [e,m] of [[40,10],[38,12],[30,20],[12,38],[3,47],[2.5,47.5],[2.5,47.5],[.4,49.6]]){const a=K.snapStep(s1,e,m,.02,k),b=K.snapStep(s2,-e,-m,.02,{...k,kP:-k.kP});assert.equal(b,a,'the same power for a mirrored pod with kP turned round');}
});

test('a pod whose servo lowers the reading lands its moves too (it must not be driven away from the target)',()=>{
  // The encoder reads the other way round from the servo: positive power lowers the reading. kP carries that sign.
  for(const name of ['real','slow']){const p=PODS[name],pod=makePod(p,2),k={...startGains(p)},s=K.snapState();k.kP=-k.kP;
    for(const target of [90,0,-45,0,30,0]){let settle=null;for(let i=0;i<85;i++){const m=-pod.read();let e=target-m;e-=360*Math.round(e/360);pod.step(K.snapStep(s,e,m,.02,k));if(Math.abs(target+pod.angle)<=1.5){if(settle===null)settle=i*.02;}else settle=null;}
      assert.notEqual(settle,null,`${name}: ${target}° never settled (the reading ended ${(-pod.angle).toFixed(1)}°)`);}}
});

test('the tuner’s starting gains are in the encoder’s own units and stay inside sane limits',()=>{
  const volts=K.snapGains({Kv:10.87,L:.109,breakaway:.08,keep:.06,creep:.3,noise:.002,span:3.3}),perDeg=3.3/360;
  assert.ok(volts.kP*perDeg>=.0005&&volts.kP*perDeg<=1/30,'full power no nearer than 30° out, and never next to nothing');
  assert.ok(volts.kS>.06&&volts.kS<.08,'just over what keeps it turning');assert.equal(volts.pulse,.08,'the nudge starts at the power that starts the wheel');
  assert.ok(volts.zone/perDeg>=3&&volts.zone/perDeg<=15,'a nudge zone of 3° to 15°');assert.ok(volts.lag>=4&&volts.lag<=12);assert.ok(volts.still/perDeg>=7.99);
});
