'use strict';
// Intakes from the CAD: what swings on them (a ramp or kicker on a servo hub, a roller on a swing arm) is found from the
// shapes whatever the intake is set up as, and "Configure from CAD" sets the intake to what the CAD shows.
const {test}=require('node:test'),assert=require('node:assert/strict'),D=require('../ui/sim-discovery.js'),K=require('../ui/sim-kinematics.js'),Mech=require('../ui/sim-mechanisms.js'),M=require('../ui/sim-robot-model.js');
const S=require('./fixtures/mechanism-shapes.cjs');
const near=(a,b,tol,msg)=>assert.ok(Math.abs(a-b)<=tol,`${msg||''} ${a} ≠ ${b}`);
const parallel=(a,b)=>Math.abs(K.math.dot(K.math.unit(a),K.math.unit(b)))>.999;
const lineDistance=(p,o,a)=>{const d=K.math.sub(p,o),u=K.math.unit(a);return K.math.len(K.math.sub(d,K.math.scale(u,K.math.dot(d,u))));};
const ROWS=[[1,0,0],[0,1,0],[0,0,1]];
test('an intake set up as a sweeper whose CAD swings a plate down on a servo hub is found as a deployable ramp',()=>{
  const r=S.ftcRobot(),ctx=D.prepare(r.arrays),L=r.leaves,m=Mech.sanitize({...r.mechanisms,intakes:[{...r.mechanisms.intakes[0],kind:'sweeper'}]});
  const {joints,intakes,report}=D.discover(ctx,{rows:ROWS,unit:1,meta:r.meta,mechanisms:m}),ramp=joints.find(j=>j.id==='deploy1');
  assert.ok(ramp,'its hinge is looked for although the intake is a sweeper: '+report.join(' | '));
  assert.deepEqual(ramp.drive,{signal:'deploy',of:'intake:0'});assert.ok(ctx.parts.expand(ramp.parts).has(L.ramp),'the ramp plate swings');
  assert.equal(intakes.length,1);assert.equal(intakes[0].intake,0);assert.equal(intakes[0].kind,'ramp','rollers behind the plate make it a ramp');assert.equal(intakes[0].joint,'deploy1');
  assert.match(intakes[0].why,/Servo Hub Shaft/);assert.ok(report.some(x=>/so it is a deployable ramp/.test(x)));
  // Already a ramp: nothing to change.
  assert.deepEqual(D.discover(ctx,{rows:ROWS,unit:1,meta:r.meta,mechanisms:Mech.sanitize(r.mechanisms)}).intakes,[]);
});
test('a sweeper with no hinge stays a sweeper: nothing swings and nothing is suggested',()=>{
  const r=S.swingArmIntake({slot:false}),ctx=D.prepare(r.arrays),{joints,intakes}=D.discover(ctx,{rows:ROWS,unit:1,meta:r.meta,mechanisms:Mech.sanitize(r.mechanisms)});
  assert.deepEqual(intakes,[]);assert.ok(!joints.some(j=>j.drive?.signal==='deploy'),'no ramp');
  assert.ok(!joints.some(j=>j.drive?.signal==='float'),'its roller sits in round holes in the side plates, so it is on no swing arm');
  assert.equal(joints.find(j=>j.id==='roller1').parent??null,null);
});
test('a roller on a swing arm: it turns on the drive axle, the side plates’ slot says how far it lifts, the roller spins on it',()=>{
  const r=S.swingArmIntake(),ctx=D.prepare(r.arrays),L=r.leaves,{joints,report}=D.discover(ctx,{rows:ROWS,unit:1,meta:r.meta,mechanisms:Mech.sanitize(r.mechanisms)});
  const arm=joints.find(j=>j.drive?.signal==='float');assert.ok(arm,'found: '+report.join(' | '));
  assert.deepEqual(arm.drive,{signal:'float',of:'intake:0'});assert.ok(parallel(arm.axis,[0,1,0]));near(lineDistance([8,0,3],arm.origin,arm.axis),0,.01,'on the drive axle');
  // The slot runs 30° up from the roller's axle; the bearing in it stops a little past where its centre line ends.
  near(arm.upper,30,1.5,'lifts as far as the slot lets it');assert.ok(arm.lower>-2&&arm.lower<=0,'it already sits at the bottom of the slot');
  // It rests at the bottom of its slot, whatever the CAD shows, and starts there; the gap under its roller grows as it lifts.
  assert.deepEqual(arm.states,{rest:arm.lower,up:arm.upper});assert.deepEqual(arm.home,[arm.lower]);assert.ok(arm.gaps&&arm.gaps.up>arm.gaps.rest,JSON.stringify(arm.gaps));assert.match(arm.note,/slot in “Side plate”/);assert.match(arm.note,/Drive shaft/);assert.match(arm.note,/Pulley 30T/);
  const moving=ctx.parts.expand(arm.parts);
  assert.ok(L.arms.every(k=>moving.has(k))&&moving.has(L.bar)&&moving.has(L.roller)&&moving.has(L.rollerAxle),'the arm plates, the crossbar on them and the roller swing');
  assert.ok(!L.sides.some(k=>moving.has(k))&&!moving.has(L.axle)&&!moving.has(L.pulley)&&!L.axleBearings.some(k=>moving.has(k)),'the side plates and the drive axle stay');
  const roller=joints.find(j=>j.id==='roller1');assert.equal(roller.parent,arm.id,'the roller turns on the arm');
  // Positive turns raise the roller.
  const W=K.worlds(K.sanitize({joints}),{[arm.id]:15}).get(arm.id);assert.ok(K.math.apply(W,[10,0,3])[2]>3.5,'up is up');
  assert.ok(report.some(x=>/rides on a swing arm in the slot in .* under it at rest, .* at the top of the slot/.test(x)),report.join(" | "));
});
test('a floating arm rides up over each piece the intake takes in, then settles back down',()=>{
  const model=K.sanitize({joints:[{id:'arm1',type:'revolute',origin:[8,0,3],axis:[0,-1,0],lower:0,upper:30,states:{rest:0,up:30},drive:{signal:'float',of:'intake:0'}}]});
  const d=new K.Driver(model);d.tick(.01,{lift:[.5]});assert.equal(d.q.arm1,15);d.tick(.01,{lift:[0]});assert.equal(d.q.arm1,0);
  const m=Mech.sanitize({enabled:true,intakes:[{kind:'sweeper',sides:['front']}],shooters:[]}),g=new Mech.Model(m,0),dt=1/120,seen=[];
  let held=0;for(let t=0;t<1;t+=dt){if(t>=.2&&!held)held=1;g.tick(dt,{intake:true},{held});seen.push([t,g.state().lift[0]]);}
  assert.ok(seen.filter(([t])=>t<.2).every(([,v])=>v===0),'still until a piece comes in');
  assert.ok(seen.some(([t,v])=>t>.25&&t<.4&&v===1),'up over it');assert.ok(seen.filter(([t])=>t>.7).every(([,v])=>v===0),'and back down');
  // gameValues (recordings and the 3D view without joint values) follow it the same way.
  assert.equal(M.gameValues(model,{lift:[1]}).arm1,30);
});
test('Configure from CAD: a second intake assembly on the same edge is part of that intake',()=>{
  const parts=[{name:'Chassis',role:'chassis',box:{x0:-8,x1:8,y0:-8,y1:8,z0:0,z1:4}},{name:'intake v4',role:'intake',kind:'sweeper',box:{x0:6,x1:14,y0:-7,y1:7,z0:2,z1:9}},{name:'FRONT RAMP',role:'intake',kind:'ramp',box:{x0:7,x1:8,y0:-5,y1:5,z0:.4,z1:1}}];
  const out=Mech.fromCad(parts,{length:16,width:16});
  assert.equal(out.intakes.length,1);assert.deepEqual(out.intakes[0].parts,['intake v4','FRONT RAMP']);assert.equal(out.intakes[0].kind,'sweeper','the first assembly says what it is; its shapes decide the rest');
  assert.ok(out.found.includes('Intake “intake v4” + ramp “FRONT RAMP”: front, 6 in out, 14 in wide · whether the ramp swings down is checked on its hinge (Moving parts)'),out.found.join(' | '));
  // A ramp named as one that moves makes the rollers' intake a deployable ramp, and says why.
  const deploy=Mech.fromCad([...parts.slice(0,2),{...parts[2],name:'Ramp deploy'}],{length:16,width:16});
  assert.equal(deploy.intakes.length,1);assert.equal(deploy.intakes[0].kind,'ramp');
  assert.ok(deploy.found.includes('Intake “intake v4” + ramp “Ramp deploy”: front, 6 in out, 14 in wide · a deployable ramp because “Ramp deploy” is named as a ramp that moves, on the same edge as the rollers'),deploy.found.join(' | '));
});
test('star or flex wheels turn with the axle they are centred on, even named only “Blue Version”; a square block on it stays',()=>{
  const r=S.starFeeder(),ctx=D.prepare(r.arrays),L=r.leaves,{joints}=D.discover(ctx,{rows:ROWS,unit:1,meta:r.meta,mechanisms:Mech.sanitize(r.mechanisms)});
  assert.ok(L.stars.every(k=>!D.feature(ctx,k).revolve),'a star is not round');
  const feeders=joints.filter(j=>/^Feeder wheels/.test(j.name)),front=feeders.find(j=>ctx.parts.expand(j.parts).has(L.shaft));assert.ok(front,'the axle with star wheels is a feeder axle: '+joints.map(j=>j.name).join(', '));
  const parts=ctx.parts.expand(front.parts);assert.ok(L.stars.every(k=>parts.has(k))&&parts.has(L.pulley),'its star wheels and pulley turn with it');
  assert.ok(!parts.has(L.block),'a square block centred on the shaft fills its circle too much to be a wheel');assert.ok(!L.sides.some(k=>parts.has(k)),'the side plates stay');
  near(front.radius,.7,.02,'drawn as big as the stars reach');assert.match(front.note,/3 of them star or flex wheels/);
  assert.ok(feeders.some(j=>ctx.parts.expand(j.parts).has(L.gecko)),'the gecko wheel axle as before');
});
