'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),S=require('../ui/sim-sensor-cal.js');
const C=require('../ui/sim-config.js');

test('a heading is followed through every wrap at ±180°',()=>{
  const u=S.unwrapper();for(let a=0;a<=3600;a+=30)u.add(S.wrap(a));assert.equal(Math.round(u.total),3600);
  const back=S.unwrapper();for(let a=0;a>=-720;a-=45)back.add(S.wrap(a));assert.equal(Math.round(back.total),-720);
});
test('ten turns that read long or short give the scale that cancels it',()=>{
  const r=S.headingScale(3610.8);assert.ok(Math.abs(r.scale*3610.8-3600)<1e-9);assert.ok(Math.abs(r.errorDeg-10.8)<1e-9);assert.ok(Math.abs(r.errorPct-.3)<1e-9);assert.equal(r.backwards,false);
  assert.equal(S.headingScale(-3600).backwards,true);assert.equal(S.headingScale(400),null,'one turn is not ten');
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
