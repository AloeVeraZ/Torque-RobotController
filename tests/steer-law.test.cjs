'use strict';
// The swerve steering law (ui/sim-chassis-cal.js steerStep; TorqueDebug.java's steer and the TeleOp's Steer run the same
// steps). It was built on a real pod, measured on the robot, and is checked here against simulated pods with that pod's
// character: a continuous servo that turns only past a start power which differs each way, tops out near 470°/s, does
// what it is told 50 to 70 ms later, slows down only when its power goes to nothing, lurches from a standstill, and is
// read through an encoder whose voltage is pushed up while the servo draws current, with a wild reading as it starts.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const K=require('../ui/sim-chassis-cal.js'),T=require('../ui/sim-chassis-teleop.js');
// g: which way positive power moves the reading (-1 on the robot this was measured on).
function makePod(p={},seed=1){const P={startP:.11,keepP:.10,startN:.08,keepN:.065,slope:1750,vmax:465,delayP:.07,delayN:.05,tau:.022,stick:.008,noise:.1,bias:1.4,spike:3,g:-1,lurch:60,lurchFor:.09,...p};
  let angle=3,vel=0,t=0,r=seed,stuckFor=0,lastU=0,spikeAt=-1,lurchUntil=-1;const q=[],rnd=()=>{r=(r*1664525+1013904223)%4294967296;return r/4294967296;};
  return {P,step(u,dt){t+=dt;q.push([t+(u>0||(u===0&&lastU>0)?P.delayP:P.delayN)+(rnd()-.5)*.012,u]);q.sort((x,y)=>x[0]-y[0]);let c=lastU;while(q.length&&q[0][0]<=t)c=q.shift()[1];if(c!==0&&lastU===0)spikeAt=t+.005;lastU=c;
      const a=Math.abs(c),pos=c>0,start=(pos?P.startP:P.startN)+(P.sticky&&angle>P.sticky[0]&&angle<P.sticky[1]?P.sticky[2]:0),keep=pos?P.keepP:P.keepN;let want=0;
      if(Math.abs(vel)<3){if(a>=start){stuckFor+=dt;if(stuckFor>=P.stick)want=1;}else stuckFor=0;}else{stuckFor=0;want=a>=keep?1:0;}
      if(want&&Math.abs(vel)<3)lurchUntil=t+P.lurchFor;let target=want?Math.sign(c)*Math.min(P.vmax,(a-keep)*P.slope+15+(t<lurchUntil?P.lurch:0)):0;
      // Less power does not slow it: only no power does (it brakes).
      if(want&&Math.sign(vel)===Math.sign(target)&&Math.abs(vel)>Math.abs(target))target=vel*(1-dt/.25);
      vel+=(target-vel)*Math.min(1,dt/(!want&&Math.abs(vel)<80?P.tau/4:P.tau));if(!want&&Math.abs(vel)<3)vel=0;angle+=P.g*vel*dt;},
    read(){let n=0;for(let i=0;i<4;i++)n+=rnd();let v=angle+(n-2)*P.noise+P.bias*Math.min(1,Math.abs(lastU)/.3);if(spikeAt>0&&t>=spikeAt){v+=P.spike;spikeAt=-1;}return Math.round(v/360*4095)/4095*360;},
    get angle(){return angle;},get t(){return t;}};}
// What the tuner would measure on a pod, in degrees: the creep each way, the top speed, the stop times, a push from rest.
function gainsFor(pod,over={}){const P=pod.P,cP=P.startP+.01,cN=P.startN+.01,sp=(c,keep)=>(c-keep)*P.slope+15;
  return {...K.steerGains({cP,cN,vP:sp(cP,P.keepP),vN:sp(cN,P.keepN),slope:P.slope,vmax:P.vmax,stopP:P.delayP+P.tau-.01,stopN:P.delayN+P.tau-.01,rP:sp(cP,P.keepP)*2.2,rN:sp(cN,P.keepN)*2.2,noise:.2,span:360}),tol:.9,wrap:360,...over,kP:P.g*40};}
// The targets in turn, each held `hold` seconds on a loop of about 13.5 ms (uneven, as on the hub): for each, when it was
// inside the band for good, how far past it went, where it ended; and every power given.
function run(pod,k,targets,{hold=2,band=1.5,seed=7,state=K.steerState()}={}){const out=[],powers=[];let r=seed;const rnd=()=>{r=(r*1664525+1013904223)%4294967296;return r/4294967296;};
  for(const target of targets){let settle=null,over=0;const from=Math.sign(target-pod.angle)||1,t0=pod.t,mine=[];
    while(pod.t-t0<hold){const dt=.0135*(.85+.3*rnd()),m=pod.read();let e=target-m;e-=360*Math.round(e/360);const u=K.steerStep(state,e,m,dt,k);mine.push([target-pod.angle,u]);pod.step(u,dt);const err=target-pod.angle;
      if(-from*err>over)over=-from*err;if(Math.abs(err)<=band){if(settle===null)settle=pod.t-t0;}else settle=null;}
    out.push({target,settle,over,end:target-pod.angle});powers.push(mine);}
  return {moves:out,powers,state};}
const PODS={real:{},reversed:{g:1},stickier:{startP:.14,keepP:.11,startN:.10,keepN:.07},quick:{delayP:.03,delayN:.03,tau:.012},weak:{slope:900,vmax:300},steady:{lurch:0,bias:0,spike:0}},ALL=[90,0,-90,0,45,0,-45,0,30,0,-30,0];

test('every pod lands 90°, 45° and 30° moves inside 1.5° and stays there, whichever way its servo turns',()=>{
  for(const [name,p] of Object.entries(PODS))for(let seed=1;seed<=6;seed++){const pod=makePod(p,seed),r=run(pod,gainsFor(pod),ALL,{seed});
    for(const m of r.moves){assert.notEqual(m.settle,null,`${name} seed ${seed}: ${m.target}° never settled (ended ${m.end.toFixed(1)}° off)`);assert.ok(Math.abs(m.end)<=1.5,`${name}: ended ${m.end.toFixed(2)}° off`);}}
});

test('a quarter turn is full power, then no power: it is never eased down, which a continuous servo answers by running on',()=>{
  const pod=makePod({},2),k=gainsFor(pod),r=run(pod,k,[90]),far=r.powers[0].filter(([err])=>Math.abs(err)>k.zone),driven=far.filter(([,u])=>u!==0);
  assert.ok(driven.length>5&&driven.every(([,u])=>Math.abs(u)===1),'full power while it is far');
  const cut=r.powers[0].findIndex(([,u],i)=>i>0&&u===0&&Math.abs(r.powers[0][i-1][1])===1);assert.ok(cut>0,'then the power goes straight to nothing');
  assert.ok(Math.abs(r.powers[0][cut][0])>15,'while the wheel is still well out: it stops in the time it takes a command to show');
  assert.ok(r.moves[0].over<=6,`and it does not sail past (went ${r.moves[0].over.toFixed(1)}° past)`);assert.ok(r.moves[0].settle<1,`there in ${r.moves[0].settle.toFixed(2)} s`);
});

test('inside the tolerance the servo is off, and at rest it stays off until the reading is clearly out',()=>{
  const k={...gainsFor(makePod()),kP:40},s=K.steerState();
  for(let i=0;i<12;i++)assert.equal(K.steerStep(s,.5,10,.0135,k),0,'0.5° off, inside 0.9°: no power');assert.equal(s.rest,true,'stopped there for 80 ms: at rest');
  for(let i=0;i<10;i++)assert.equal(K.steerStep(s,1.3,9.2,.0135,k),0,'1.3° off is inside 1.6 tolerances: left alone (another servo’s current moves the reading that much)');
  let pushed=false;for(let i=0;i<25;i++)if(K.steerStep(s,2.5,8,.0135,k)!==0)pushed=true;assert.ok(pushed,'2.5° off: it is pushed back');
});

test('a wheel that stops a little outside the tolerance but inside what is allowed is left where it is',()=>{
  // The tolerance is 0.6 of the allowed band: 1.1° off is inside 1.35 tolerances. A push from rest could as well knock it out.
  const k=gainsFor(makePod()),s=K.steerState();for(let i=0;i<30;i++)assert.equal(K.steerStep(s,1.1,20,.0135,k),0);assert.equal(s.rest,true);
  const s2=K.steerState();let pushed=false;for(let i=0;i<30;i++)if(K.steerStep(s2,1.4,20,.0135,k)!==0)pushed=true;assert.ok(pushed,'1.4° off is not: that one is pushed');
});

test('a spot that takes more power than was measured gets more, that way only, until the wheel moves',()=>{
  // Between -100° and -80° this pod takes 5% more power to start than anywhere else (the real one has such a spot).
  const pod=makePod({sticky:[-100,-80,.05]},3),k=gainsFor(pod),r=run(pod,k,[-88,-92,-86],{hold:3});
  for(const m of r.moves)assert.notEqual(m.settle,null,`${m.target}° never settled (ended ${m.end.toFixed(1)}° off)`);
  const top=Math.max(...r.powers.flat().filter(([err])=>Math.abs(err)<8).map(([,u])=>Math.abs(u)));assert.ok(top>Math.max(k.cP,k.cN)+.02,`the pushes grew past the creep power (to ${top.toFixed(3)})`);
});

test('a servo that lowers the reading gets the same loop the other way round',()=>{
  const k=gainsFor(makePod({g:1})),a=K.steerState(),b=K.steerState(),mirror={...k,kP:-k.kP};let powered=0;
  for(const [e,m] of [[60,10],[58,12],[50,20],[30,40],[12,58],[5,65],[4,66],[4,66],[4,66],[4,66],[4,66],[4,66],[4,66],[3,67],[.4,69.6],[.4,69.6]]){const u=K.steerStep(a,e,m,.0135,k),v=K.steerStep(b,-e,-m,.0135,mirror);assert.equal(v,u,'the same power for a mirrored pod with K turned round: the creep and stop times go with the power’s sign, not the reading’s');if(u)powered++;}
  assert.ok(powered>3);
});

test('an approach reports where its braking stop left the wheel, for the tuner to set the stop time by',()=>{
  // One quarter turn, up to its first report: how far short (+) or past (-), and which way the servo was driven (to raise
  // this pod's reading its power is negative).
  const pod=makePod({},4),k=gainsFor(pod),s=K.steerState();for(let i=0;i<110&&!s.stops;i++){const m=pod.read();let e=90-m;e-=360*Math.round(e/360);pod.step(K.steerStep(s,e,m,.0135,k),.0135);}
  assert.equal(s.stops,1);assert.equal(s.stopFull,true,'from full power');assert.equal(s.stopWay,-1);assert.ok(Math.abs(s.stopErr)<15,`near the target (${s.stopErr.toFixed(1)}°)`);
  // Braking far too late, it goes well past.
  const pod2=makePod({},4),late=run(pod2,gainsFor(pod2,{leadP:.03,leadN:.03}),[90],{hold:1});assert.ok(late.moves[0].over>6,`${late.moves[0].over.toFixed(1)}° past`);
});

test('the tuner’s starting numbers are in the encoder’s own units and stay inside sane limits',()=>{
  const per=3.3/360,k=K.steerGains({cP:.115,cN:.085,vP:30*per,vN:45*per,slope:2000*per,vmax:480*per,stopP:.057,stopN:.039,rP:110*per,rN:65*per,noise:.001,span:3.3});
  assert.equal(k.leadP,.087,'the stop time plus 30 ms');assert.equal(k.leadN,.069);assert.equal(k.cP,.115);assert.ok(Math.abs(k.zone/per-8)<.01);assert.ok(Math.abs(k.ease/per-1)<.01);assert.ok(Math.abs(k.still/per-12)<.01);
  const odd=K.steerGains({cP:.1,cN:.1,vP:0,vN:0,slope:0,vmax:400*per,stopP:NaN,stopN:9,rP:NaN,rN:1e6,span:3.3});
  assert.equal(odd.leadP,.09,'no stop time measured: a usual one');assert.equal(odd.leadN,.18,'never longer than 180 ms');assert.ok(odd.vP>=8*per-1e-4,'a creep that crawls at least');assert.ok(odd.rP>=odd.vP&&odd.rN<=400*per*.6+1e-9,'a push from rest between the creep and well under the top speed');
});

test('the robot’s Java and the TeleOp’s Steer class return the reference law’s power, step for step',t=>{
  const root=path.join(__dirname,'..'),bin=n=>path.join(root,'sim-runtime/java/bin',process.platform==='win32'?n+'.exe':n),stubs=path.join(root,'tools/simulation/java');
  if(!fs.existsSync(bin('javac'))||!fs.existsSync(stubs))return t.skip('the simulator’s JDK is not built here');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'steer-law-'));
  try{const pod0=(n,x,y)=>({label:n,drive:n+'M',reversed:false,servo:n+'S',encoder:n+'E',x,y,zero:1.5,encoderSign:1,servoSign:-1,gain:22,leadP:.083,leadN:.071,creepP:.13,creepN:.1,creepSpeedP:78,creepSpeedN:74,slope:1700,top:475,pushP:150,pushN:140,zone:8,ease:1,still:12,lag:.14,volts:3.3});
    fs.writeFileSync(path.join(dir,T.NAME+'.java'),T.teleopOf({kind:'swerve',tolerance:.9,pods:[pod0('front',6,0)],robot:{},imu:{name:'imu',scale:1},map:T.DEFAULT,config:'swerve'}).source);
    for(const [name,g] of [['pos',1],['neg',-1]]){const rows=[],pod=makePod({g,startP:.16,keepP:.13},3),k={kP:g*22,leadP:.083,leadN:.071,cP:.13,cN:.1,vP:78,vN:74,slope:1700,vmax:475,rP:150,rN:140,tol:.9,zone:8,ease:1,still:12,lag:.14,wrap:360},s=K.steerState();let r=5;const rnd=()=>{r=(r*1664525+1013904223)%4294967296;return r/4294967296;};
      for(const target of [90,0,-90,0,45,0,-30,0,5,0,2,0,170,-170,3,0,1.2,0])for(let i=0;i<70;i++){const dt=.0135*(.7+.6*rnd()),m=pod.read();let e=target-m;e-=360*Math.round(e/360);const u=K.steerStep(s,e,m,dt,k);rows.push(`${e} ${m} ${dt} ${u}`);pod.step(u,dt);}
      assert.ok(rows.filter(x=>!x.endsWith(' 0')).length>200,'the run drives the servo');fs.writeFileSync(path.join(dir,name+'.txt'),rows.join('\n'));}
    fs.writeFileSync(path.join(dir,'Cross.java'),['import java.nio.file.*; import java.util.*;','public class Cross { public static void main(String[] a) throws Exception { for (String name : new String[]{"pos", "neg"}) { double g = name.equals("pos") ? 1 : -1;',
      '  TorqueDebug td = new TorqueDebug(); TorqueDebugLoop l = new TorqueDebugLoop(); l.kP = g * 22; l.leadP = .083; l.leadN = .071; l.cP = .13; l.cN = .1; l.vP = 78; l.vN = 74; l.slope = 1700; l.vmax = 475; l.rP = 150; l.rN = 140; l.tol = .9; l.zone = 8; l.ease = 1; l.still = 12; l.lag = .14; l.wrap = 360; l.steer = true;',
      '  TorqueChassis.Steer st = new TorqueChassis.Steer(g, 22, .083, .071, .13, .1, 78, 74, 1700, 475, 150, 140, 8, 1, 12, .14, .9); double debug = 0, tele = 0;',
      '  for (String row : Files.readAllLines(Paths.get(a[0], name + ".txt"))) { String[] f = row.trim().split(" "); double e = Double.parseDouble(f[0]), m = Double.parseDouble(f[1]), dt = Double.parseDouble(f[2]), want = Double.parseDouble(f[3]);',
      '    debug = Math.max(debug, Math.abs(td.steer(l, e, m, dt) - want)); tele = Math.max(tele, Math.abs(st.step(e, m, dt) - want)); }','  System.out.println(name + " " + debug + " " + tele); } } }'].join('\n'));
    try{execFileSync(bin('javac'),['-nowarn','-proc:none','-sourcepath',[stubs,path.join(root,'src/onbot'),dir].join(path.delimiter),'-d',path.join(dir,'out'),path.join(dir,'Cross.java')],{stdio:'pipe'});}catch(e){assert.fail('the Java does not compile: '+String(e.stderr||e.message).slice(0,600));}
    const said=execFileSync(bin('java'),['-cp',path.join(dir,'out'),'Cross',dir],{encoding:'utf8'}).trim().split('\n').map(x=>x.split(' '));assert.equal(said.length,2);
    for(const [name,debug,tele] of said){assert.ok(+debug<1e-9,`TorqueDebug.java differs from the reference (${name}: ${debug})`);assert.ok(+tele<1e-9,`the TeleOp’s Steer differs from the reference (${name}: ${tele})`);}}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
