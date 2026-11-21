'use strict';
// The turn law every turn on the spot uses (ui/sim-chassis-teleop.js turnStep): TorqueDebug.java's IMU turning and the IMU turn
// test's Turn class run it step for step, it lands on simulated robots without hunting, and IMU tuning in Torque Debug runs end
// to end on a simulated robot (late, repeated IMU readings; a chassis that needs more power to start turning than to keep turning).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const T=require('../ui/sim-chassis-teleop.js');
const root=path.join(__dirname,'..'),bin=n=>path.join(root,'sim-runtime/java/bin',process.platform==='win32'?n+'.exe':n),stubs=path.join(root,'tools/simulation/java');

// A robot turning on the spot. ps: the power that starts it turning, p0: the power under which it stops; the IMU samples every
// imuEvery seconds and a read takes readMs; a power reaches the wheels about a loop later.
function robot({vmax=300,p0=.06,ps=.11,tauUp=.12,brakeTau=.05,imuEvery=.01,readMs=.007,loop=.012,seed=3}={}){
  let th=0,w=0,t=0,p=0,r=seed;const pending=[],samples=[{t:0,th:0}],rnd=()=>{r=(r*1664525+1013904223)%4294967296;return r/4294967296;};
  function adv(dt){const n=Math.ceil(dt/.001);for(let i=0;i<n;i++){const h=dt/n;t+=h;while(pending.length&&pending[0].at<=t)p=pending.shift().p;
    const a=Math.abs(p),stuck=Math.abs(w)<2&&a<ps,goal=!stuck&&a>p0?Math.sign(p)*vmax*(a-p0)/(1-p0):0;
    if(stuck)w=0;else if(goal===0||Math.sign(goal)!==Math.sign(w)&&Math.abs(w)>1)w-=w*h/brakeTau;else w+=(goal-w)*h/tauUp;th+=w*h;
    if(t-samples.at(-1).t>=imuEvery)samples.push({t,th:th+(rnd()-.5)*.05});if(samples.length>50)samples.shift();}}
  return {read(){const v=samples.at(-1).th;adv(readMs*(.8+.4*rnd()));return v;},set(x){pending.push({at:t+loop*(.5+rnd()),p:x});},wait(s){adv(s*(.8+.4*rnd()));},get t(){return t;},get th(){return th;}};}
function turn(target,k,o,secs=6){const R=robot(o),s=T.turnState(),t0=R.t,powers=[];let arrived=false,flips=0,last=0;
  while(R.t-t0<secs){const p=T.turnStep(s,target,R.read(),R.t-t0,k);R.set(p);powers.push(p);if(Math.abs(R.th-target)<=k.done)arrived=true;const sg=Math.abs(p)<1e-9?0:Math.sign(p);if(arrived&&sg&&last&&sg!==last)flips++;if(sg)last=sg;R.wait(.01);}
  return {off:R.th-target,flips,quiet:powers.slice(-100).every(p=>p===0)};}

const ROBOTS=[['a light robot, quick IMU',{},{top:.6,least:.13,slowFrom:45,brake:.0011,done:1.5,lag:.02}],
  ['a sticky robot, slow IMU',{ps:.16,p0:.05,imuEvery:.02,readMs:.009},{top:.6,least:.19,slowFrom:45,brake:.0011,done:2,lag:.025}],
  ['a sticky robot, gentle numbers',{ps:.16,p0:.05,imuEvery:.02,readMs:.009},{top:.25,least:.19,slowFrom:60,brake:.002,done:2,lag:.025}],
  ['a heavy robot',{ps:.2,p0:.08,imuEvery:.02,tauUp:.2,brakeTau:.09,readMs:.01},{top:.7,least:.22,slowFrom:60,brake:.0014,done:2,lag:.03}]];
test('the turn law lands inside its tolerance and stays there: no swinging back and forth, the motors quiet once it is there',()=>{
  for(const [name,o,k] of ROBOTS)for(const target of [90,-90,10,180])for(const seed of [1,2,3]){const r=turn(target,k,{...o,seed},10);
    assert.ok(Math.abs(r.off)<=k.done,`${name}, ${target}°: ended ${r.off.toFixed(2)}° off`);assert.ok(r.flips<=1,`${name}, ${target}°: turned back and forth ${r.flips} times once there`);assert.ok(r.quiet,`${name}, ${target}°: still driving its motors once there`);}
});

test('a heading that repeats (the IMU had nothing new) does not make the power jump about',()=>{
  const k={top:.6,least:.13,slowFrom:45,brake:.0011,done:1.5,lag:.02},s=T.turnState(),out=[];let h=0;
  // Turning at 120°/s, read every 10 ms, but the reading only moves every third read.
  for(let i=0;i<60;i++){if(i%3===0)h=i*.01*120;out.push(T.turnStep(s,90,h,i*.01,k));}
  const jumps=out.slice(10,40).map((p,i,a)=>i?Math.abs(p-a[i-1]):0);assert.ok(Math.max(...jumps)<.05,'the power moved '+Math.max(...jumps).toFixed(3)+' in one step');
});

function javaDir(t){if(!fs.existsSync(bin('javac'))||!fs.existsSync(stubs)){t.skip('the simulator’s JDK is not built here');return null;}return fs.mkdtempSync(path.join(os.tmpdir(),'turn-law-'));}
const compile=(dir,files)=>{try{execFileSync(bin('javac'),['-nowarn','-proc:none','-sourcepath',[stubs,path.join(root,'src/onbot'),dir].join(path.delimiter),'-d',path.join(dir,'out'),path.join(root,'src/onbot/TorqueDebug.java'),...files.map(f=>path.join(dir,f))],{stdio:'pipe'});}catch(e){assert.fail('the Java does not compile: '+String(e.stderr||e.message).slice(0,1500));}};

test('TorqueDebug’s IMU turning and the IMU turn test’s Turn class return the reference law’s power, step for step',t=>{
  const dir=javaDir(t);if(!dir)return;
  try{const k={top:.6,least:.15,slowFrom:45,brake:.0011,done:1.5,lag:.025},rows=[];
    for(const [target,seed] of [[90,1],[-90,2],[10,3],[0,4]]){const R=robot({ps:.16,p0:.05,imuEvery:.02,seed}),s=T.turnState(),t0=R.t;rows.push('B');
      while(R.t-t0<4){const h=R.read(),tt=R.t-t0,p=T.turnStep(s,target,h,tt,k);rows.push(`${target} ${h} ${tt} ${p}`);R.set(p);R.wait(.01);}}
    fs.writeFileSync(path.join(dir,'rows.txt'),rows.join('\n'));
    fs.writeFileSync(path.join(dir,'TorqueTurnTest.java'),T.turnTestOf({kind:'mecanum',motors:[{key:'frontLeft',name:'fl'},{key:'frontRight',name:'fr'},{key:'backLeft',name:'bl'},{key:'backRight',name:'br'}],robot:{},imu:{name:'imu',scale:1}}).source);
    fs.writeFileSync(path.join(dir,'Cross.java'),['import java.nio.file.*;','public class Cross { public static void main(String[] a) throws Exception {',
      `  double top = ${k.top}, least = ${k.least}, slow = ${k.slowFrom}, brake = ${k.brake}, done = ${k.done}, lag = ${k.lag};`,
      '  TorqueDebugTurn d = null; TorqueTurnTest.Turn g = null; double worstD = 0, worstG = 0; int n = 0;',
      '  for (String row : Files.readAllLines(Paths.get(a[0], "rows.txt"))) {',
      '    if (row.equals("B")) { d = new TorqueDebugTurn(null, "check", 0, done); d.top = top; d.least = least; d.slowFrom = slow; d.brake = brake; d.lag = lag; d.begin(); g = new TorqueTurnTest.Turn(top, least, slow, brake, done, lag); continue; }',
      '    String[] f = row.split(" "); double target = Double.parseDouble(f[0]), h = Double.parseDouble(f[1]), t = Double.parseDouble(f[2]), want = Double.parseDouble(f[3]);',
      '    worstD = Math.max(worstD, Math.abs(d.step(target, h, t) - want)); worstG = Math.max(worstG, Math.abs(g.step(target, h, t) - want)); n++; }',
      '  System.out.println(n + " " + worstD + " " + worstG); } }'].join('\n'));
    compile(dir,['Cross.java','TorqueTurnTest.java']);
    const [n,d,g]=execFileSync(bin('java'),['-cp',path.join(dir,'out'),'Cross',dir],{encoding:'utf8'}).trim().split(' ').map(Number);
    assert.ok(n>500,'the run turns');assert.ok(d<1e-9,`TorqueDebug.java differs from the reference law (${d})`);assert.ok(g<1e-9,`the IMU turn test’s Turn differs from the reference law (${g})`);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});

// The whole tuning, as TorqueDebug runs it, against a simulated robot in simulated time.
const SIM=['import java.util.*;','public class Sim implements TorqueDebugTurnRobot {',
  '  double th, w, t, p, vmax = 320, p0 = 0.05, ps = 0.15, tauUp = 0.14, brakeTau = 0.06, sign; long seed = 7; final ArrayDeque<double[]> pending = new ArrayDeque<>(); double sampleT, sample;',
  '  Sim(double sign) { this.sign = sign; }',
  '  double rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296L; return seed / 4294967296.0; }',
  '  void adv(double dt) { int n = (int) Math.ceil(dt / 0.001); for (int i = 0; i < n; i++) { double h = dt / n; t += h; while (!pending.isEmpty() && pending.peek()[0] <= t) p = pending.poll()[1];',
  '    double a = Math.abs(p); boolean stuck = Math.abs(w) < 2 && a < ps; double goal = !stuck && a > p0 ? Math.signum(p) * vmax * (a - p0) / (1 - p0) : 0;',
  '    if (stuck) w = 0; else if (goal == 0 || Math.signum(goal) != Math.signum(w) && Math.abs(w) > 1) w -= w * h / brakeTau; else w += (goal - w) * h / tauUp; th += w * h;',
  '    if (t - sampleT >= 0.02) { sampleT = t; sample = th; } } }',
  '  /** The yaw as the sensor gives it: wrapped, the way it counts (sign), late. */',
  '  public double heading() { double v = sample * sign; adv(0.008); return v - 360 * Math.round(v / 360); }',
  '  public void power(double turn) { pending.add(new double[]{t + 0.012 * (0.5 + rnd()), turn}); }',
  '  public boolean alive() { return t < 900; }',
  '  public void pause(long ms) { adv(ms / 1000.0); }',
  '  public double seconds() { return t; }',
  '  public double loopMs() { return 15; }',
  '  public void setUp() { } public void tearDown() { }',
  '  public static void main(String[] a) {',
  '    for (String job : a) { String[] f = job.split(":"); Sim s = new Sim(Double.parseDouble(f[1])); TorqueDebugTurn u = new TorqueDebugTurn(s, f[0], 1, 2);',
  '      if (f[0].equals("check")) { u.top = 0.6; u.least = 0.18; u.slowFrom = 60; u.brake = 0.0011; u.lag = 0.02; }',
  '      u.run(); System.out.println(u.result == null ? "none " + u.state : u.result); } } }'].join('\n');
test('IMU tuning runs in Torque Debug, start to end, on a simulated robot: every power from 50% to 100%, a heading that counts backwards, and the check',t=>{
  const dir=javaDir(t);if(!dir)return;
  try{fs.writeFileSync(path.join(dir,'Sim.java'),SIM);compile(dir,['Sim.java']);
    const out=execFileSync(bin('java'),['-cp',path.join(dir,'out'),'Sim','tune:1','tune:-1','check:1'],{encoding:'utf8',timeout:120000}).trim().split('\n');
    const [std,back]=out.slice(0,2).map(T.turnResultOf),check=JSON.parse(out[2]);
    for(const [name,res] of [['tuning',std],['backwards',back]]){assert.ok(res,`${name}: a result (${out.join(' | ')})`);assert.ok(res.best,`${name}: a power landed: ${JSON.stringify(res.rounds)}`);}
    assert.equal(std.backwards,false);assert.deepEqual(std.rounds.map(x=>x.power),[.5,.6,.7,.75,.8,.85,.9,.95,1],'every power, 10% steps to 70% then 5% steps');assert.ok(std.rounds.filter(x=>x.ok).length>=6,JSON.stringify(std.rounds));
    assert.equal(back.backwards,true,'a heading that counts a left turn as a right one is found');
    assert.equal(check.check,true);assert.equal(check.turns.length,4);assert.ok(check.turns.every(x=>x.off<=2),JSON.stringify(check.turns));}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
