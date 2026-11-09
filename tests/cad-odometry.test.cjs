'use strict';
// A CAD import whose odometry pods hang below the wheels on their springs (a student's 3-pod Kiwi swerve, with the part
// names and boxes its STEP import gave): the pods are odometry, not the chassis or an intake; the robot stands on its
// wheels, not on them; its size is the whole robot's, not a 1.5 in pod's; and a size outside 4 to 48 in is never taken.
const test=require('node:test'),assert=require('node:assert/strict');
const Mech=require('../ui/sim-mechanisms.js'),R=require('../ui/sim-robot-model.js'),C=require('../ui/sim-config.js'),H=require('../ui/sim-hardware.js');
// The import's named groups (inches, Y up as the STEP had it): three goBILDA 4-bar pods, a swingarm pod, a swerve module,
// the battery holder and the chassis plate. The pods reach 1.55 in below the plate's bottom.
const GROUPS=[['3110-0001-0002 (0°) (FOR Ø96mm DRIVE WHEELS)',[-4.825,-3.459,-1.549,4.825,-0.725,0.144]],['3110-0001-0002 (25.5°) (FULL RETRACTION)',[-4.714,-2.97,-1.549,4.825,-0.725,0.144]],
  ['3110-0001-0002 (-65.4mm) (FULL EXTENSION)',[-4.596,-4.147,-1.549,4.825,-0.725,0.144]],['New Moduel v1',[-7.138,-3.596,-5.226,7.138,0.666,7.808]],['3110-0002-0002',[-0.787,-1.263,-4.486,0.787,-0.554,-2.812]],
  ['Battery Holder',[-2.815,-1.263,-0.428,3.547,3.974,1.921]],['SOLID',[-9.457,-2.793,-5.643,9.457,-0.725,8.033]]];
const parts=GROUPS.map(([name,box])=>({name,...Mech.partRole(name,[]),box}));
const meta=R.meta({id:'0123456789abcdef0123456789abcdef.glb',name:'Kiwi Swerve Odometry.step',units:'in',front:'+x',top:'+y',source:'step',parts,bodyChassis:true});

test('odometry pods are odometry: not the chassis, not an intake',()=>{
  assert.deepEqual(parts.map(p=>p.role),['odometry','odometry','odometry','other','odometry','other','other']);
  for(const n of ['Odometry Pod','Dead wheel left','Swingarm Pod','odo_perp'])assert.equal(Mech.partRole(n).role,'odometry',n);
  for(const n of ['Front intake','Chassis','Swerve Pod','frontPod'])assert.notEqual(Mech.partRole(n).role,'odometry',n);
  assert.deepEqual(meta.parts.map(p=>p.role),parts.map(p=>p.role),'the model keeps the role');});

test('the robot’s size and floor come from the robot, not its pods',()=>{
  const b=R.partBoxes(meta);
  assert.ok(Math.abs(b.chassis.length-18.914)<.01&&Math.abs(b.chassis.width-13.676)<.01,JSON.stringify(b.chassis));assert.match(b.chassis.name,/odometry pods/);
  // Standing on the swerve module's wheels (Y -3.596), not on the pods hanging below them (Y -4.147).
  assert.ok(Math.abs(b.floor-(-3.596))<1e-6,`floor ${b.floor}`);
  const out=Mech.fromCad(b.parts,{length:b.extent.length,width:b.extent.width,chassis:b.chassis.derived?b.chassis:null});
  assert.deepEqual(out.robot,{length:19,width:13.75,heightIn:7.5});assert.equal(out.intakes?.length||0,0,'no intake from the pods');});

test('a part named as the chassis that is too small to be one is passed over',()=>{
  const tiny=[{name:'Pod frame',role:'chassis',box:{x0:-.8,x1:.8,y0:-.4,y1:.4,z0:0,z1:1}},{name:'Base plate',role:'chassis',box:{x0:-9,x1:9,y0:-8,y1:8,z0:0,z1:1}}];
  assert.equal(Mech.fromCad(tiny).robot.length,18);
  assert.equal(Mech.fromCad([tiny[0]],{length:18,width:16}).robot?.length??18,18,'a 1.6 in chassis is never the robot');});

test('swerve and kiwi drive names reach Simulate’s rows',()=>{
  const r=C.robot({drivetrain:'kiwiSwerve',devices:{front:{name:'frontPod'},steerFront:{name:'frontPodS'},backLeft:{name:'leftPod'},steerBackLeft:{name:'leftPodS'},backRight:{name:'rightPod'},steerBackRight:{name:'rightPodS'}}},'ftc');
  const rows=H.rows({controller:'ftc',robot:r,sensors:{localization:'encoders'},mechanisms:{enabled:false,intakes:[],shooters:[]}}).filter(x=>['drive','steer'].includes(x.role));
  assert.deepEqual(rows.map(x=>`${x.key}=${x.name}`),['robot.front=frontPod','robot.steerFront=frontPodS','robot.backLeft=leftPod','robot.steerBackLeft=leftPodS','robot.backRight=rightPod','robot.steerBackRight=rightPodS']);});
