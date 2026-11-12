'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),S=require('../ui/sim-sensor-cal.js');
const C=require('../ui/sim-config.js');

test('a heading is followed through every wrap at ±180°',()=>{
  const u=S.unwrapper();for(let a=0;a<=3600;a+=30)u.add(S.wrap(a));assert.equal(Math.round(u.total),3600);
  const back=S.unwrapper();for(let a=0;a>=-720;a-=45)back.add(S.wrap(a));assert.equal(Math.round(back.total),-720);
});
test('ten turns that read long or short give the scale that cancels it',()=>{
  const r=S.headingScale(3610.8);assert.ok(Math.abs(r.scale*3610.8-3600)<1e-9);assert.ok(Math.abs(r.errorDeg-10.8)<1e-9);assert.ok(Math.abs(r.errorPct-.3)<1e-9);assert.equal(r.backwards,false);
  assert.equal(S.headingScale(-3600).backwards,true);assert.equal(r.turns,10,'however many turns were made are counted');
});
test('one whole turn off a wall is enough, and Torque counts however many were made',()=>{
  const one=S.headingScale(360.8);assert.equal(one.turns,1);assert.ok(Math.abs(one.errorDeg-.8)<1e-9);assert.equal(one.tolerancePct,S.PASS.headingPct,'a wall squares it finer than the IMU’s own limit, so that limit is the tolerance');assert.ok(Math.abs(S.headingScale(360.2).errorPct)<=one.tolerancePct,'0.2° on one turn could be the wall');assert.ok(one.errorPct>one.tolerancePct,'0.8° is the IMU');
  const off=S.headingScale(363.6);assert.ok(Math.abs(off.errorPct-1)<1e-9);assert.ok(off.errorPct>off.tolerancePct,'1% is the IMU, not the eye');assert.ok(Math.abs(off.scale*363.6-360)<1e-9);
  // More turns make it finer: the same degree of lining up is a smaller share, down to the IMU's own limit.
  assert.ok(S.headingScale(1081).tolerancePct<=one.tolerancePct);assert.equal(S.headingScale(1081).turns,3);assert.equal(S.headingScale(3600.5).tolerancePct,S.PASS.headingPct);
  // It ends by itself: turned a whole turn or more, then still for a second and a half. Not while it is still turning,
  // not before it has turned, and not on the first readings.
  const run=(deg,ms=40,n=120)=>Array.from({length:n},(_,i)=>[i*ms,deg(i*ms)]);
  assert.equal(S.atRest(run(t=>Math.min(361,t*.4))),true,'turned, then still');assert.equal(S.atRest(run(t=>t*.4)),false,'still turning');assert.equal(S.atRest(run(()=>0)),false,'never turned');
  assert.equal(S.atRest(run(t=>-Math.min(722,t*.8))),true,'either way round, any number of turns');assert.equal(S.atRest(run(t=>361+Math.sin(t/100))),false,'rocking is not still');assert.equal(S.atRest([[0,361],[40,361]]),false,'too soon to say');assert.equal(S.atRest([]),false);
  assert.equal(S.headingScale(120),null,'a third of a turn is not a turn');assert.equal(S.headingScale(-361).backwards,true);assert.equal(S.headingScale(-361).turns,1);
});
test('a straight push says which way a pod counts and how far off it reads',()=>{
  const r=S.push(-47.5,48);assert.equal(r.backwards,true);assert.ok(Math.abs(r.scale-48/47.5)<1e-12);assert.ok(r.errorPct<0);
  assert.equal(S.push(2,48),null,'a pod that hardly counted is a cable, not a scale');
});
test('a spin in place puts each pod where it sits: forward pods by -d/θ, strafe pods by +d/θ',()=>{
  const θ=2*Math.PI*5;// five turns counterclockwise
  // A forward pod 4 in left of centre rolls backwards by 4·θ; a strafe pod 3 in behind centre rolls right (negative) by 3·θ.
  assert.ok(Math.abs(S.forwardPodY(-4*θ,θ)-4)<1e-12);assert.ok(Math.abs(S.strafePodX(-3*θ,θ)+3)<1e-12);
});
test('the setup keeps a pod scale and the hub IMU heading scale, within sane limits',()=>{
  const o=C.odometryOf({odometry:{pods:{par:{scale:1.012}},imu:{scale:.9985}}});assert.equal(o.pods.par.scale,1.012);assert.equal(o.imu.scale,.9985);
  const wild=C.odometryOf({odometry:{pods:{par:{scale:3}},imu:{scale:1.2}}});assert.equal(wild.pods.par.scale,undefined);assert.equal(wild.imu.scale,1);
});
