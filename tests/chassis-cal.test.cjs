'use strict';
// Calibrate → Mechanisms' chassis (ui/sim-chassis-cal.js): the drivetrain from Simulate, what the robot lacks, and where it
// is on the field from each kind of position sensing, relative to the zero the student sets.
const test=require('node:test'),assert=require('node:assert/strict');
const K=require('../ui/sim-chassis-cal.js'),C=require('../ui/sim-config.js'),L=require('../ui/sim-links.js');
const near=(a,b,tol=.05,what='')=>assert.ok(Math.abs(a-b)<=tol,`${what} ${a} ≈ ${b}`);
const robot=(more={})=>({robot:{drivetrain:'mecanum',wheelDiameterMm:104,devices:{frontLeft:{name:'leftFront'},backLeft:{name:'leftBack'},frontRight:{name:'rightFront',reversed:true},backRight:{name:'rightBack',reversed:true}},...more.robot},sensors:{localization:'encoders',...more.sensors}});

test('the chassis is what Simulate says, named as the configuration names it',()=>{
  const ch=K.chassisOf(robot(),C);assert.equal(ch.name,'Mecanum · 4 DC motors');assert.deepEqual(ch.motors.map(m=>m.name),['leftFront','rightFront','leftBack','rightBack']);assert.equal(K.measures(ch),'position');
  assert.deepEqual(K.chassisOf({robot:{drivetrain:'tank2'},sensors:{localization:'gyro'}},C).motors.map(m=>m.key),['left','right']);
  assert.equal(K.measures(K.chassisOf({robot:{drivetrain:'tank2'},sensors:{localization:'gyro'}},C)),'heading');});

test('what the robot lacks: a drivetrain scanned from the hub with no Pinpoint',()=>{
  const devs=L.devices([{name:'leftFront',kind:'motor'},{name:'leftBack',kind:'motor'},{name:'rightFront',kind:'motor'},{name:'rightBack',kind:'motor'},{name:'imu',kind:'imu'}],null);
  assert.deepEqual(K.missing(K.chassisOf(robot(),C),devs),[]);
  assert.deepEqual(K.missing(K.chassisOf(robot({sensors:{localization:'fused'}}),C),devs),['pinpoint']);});

test('a Pinpoint: where it is from the zero, in the zero’s own frame',()=>{
  const ch=K.chassisOf(robot({sensors:{localization:'fused'}}),C),t=K.tracker(ch),v=(x,y,h)=>({'i:pinpoint:x':x*25.4,'i:pinpoint:y':y*25.4,'i:pinpoint:h':h});
  assert.equal(t.zero(v(10,20,90)),true);
  // Facing +y of the Pinpoint's frame at the zero: moving +y there is forward from the zero.
  const p=t.update(v(10,32,90));near(p.x,12,.01,'x');near(p.y,0,.01,'y');near(p.h,0,.01,'h');
  near(t.update(v(10,20,-170)).h,100,.01,'heading wraps');});

test('two pods and the IMU: travel, and a spin in place that moves nothing',()=>{
  const ch=K.chassisOf(robot({sensors:{localization:'odometry'},robot:{devices:{par:{name:'par'},perp:{name:'perp'}}}}),C),t=K.tracker(ch),tpi=ch.podTicksPerIn;
  const v=(f,s,h)=>({'m:par:pos':f*tpi,'m:perp:pos':s*tpi,'i:imu:yaw':h});
  t.zero(v(0,0,0));let p=t.update(v(24,0,0));near(p.x,24,.01);near(p.y,0,.01);
  // Spinning 90° left in place: the forward pod (4 in left) rolls −4·π/2, the strafe pod (3 in behind) −3·π/2; position stays.
  for(let k=1;k<=90;k++)p=t.update(v(24-4*(k*Math.PI/180),-3*(k*Math.PI/180),k));near(p.x,24,.05,'x');near(p.y,0,.05,'y');near(p.h,90,.01);
  // Now facing left, forward travel is +y.
  p=t.update(v(24-4*Math.PI/2+12,-3*Math.PI/2,90));near(p.y,12,.05,'y');});

test('mecanum drive encoders: forward and strafe, with the right side reversed',()=>{
  const ch=K.chassisOf(robot(),C),t=K.tracker(ch),k=ch.driveTicksPerIn;
  const v=(fl,fr,bl,br)=>({'m:leftFront:pos':fl*k,'m:rightFront:pos':-fr*k,'m:leftBack:pos':bl*k,'m:rightBack:pos':-br*k,'i:imu:yaw':0});
  t.zero(v(0,0,0,0));let p=t.update(v(10,10,10,10));near(p.x,10,.01);near(p.y,0,.01);
  p=t.update(v(10-5,10+5,10+5,10-5));near(p.x,10,.01);near(p.y,5,.01,'strafed left');
  assert.equal(K.tracker(ch).update(v(1,1,1,1)),null,'nothing before a zero');});

test('tank: no strafe; a robot with only an IMU gives its heading',()=>{
  const ch=K.chassisOf({robot:{drivetrain:'tank2',devices:{left:{name:'l'},right:{name:'r'}}},sensors:{localization:'encoders'}},C),t=K.tracker(ch),k=ch.driveTicksPerIn;
  t.zero({'m:l:pos':0,'m:r:pos':0,'i:imu:yaw':0});near(t.update({'m:l:pos':6*k,'m:r:pos':6*k,'i:imu:yaw':0}).x,6,.01);
  const g=K.tracker(K.chassisOf({robot:{drivetrain:'tank2'},sensors:{localization:'gyro'}},C));g.zero({'i:imu:yaw':5});const p=g.update({'i:imu:yaw':35});near(p.h,30,.01);assert.ok(Number.isNaN(p.x));});

test('a measured spot within an inch passes',()=>{assert.ok(K.spotError({x:24,y:0},{x:24.5,y:.5})<=K.PASS_IN);assert.ok(K.spotError({x:24,y:0},{x:26,y:0})>K.PASS_IN);});

test('the CAD’s drive wheels go to the wheel or module they point at, odometry pods left out',()=>{
  const H=require('../ui/sim-hardware.js'),sl=t=>H.DRIVE_SLOTS[t].filter(([k])=>!/^steer/.test(k)).map(([key])=>({key})),j=(id,x,y,extra={})=>({id,origin:[x,y,2],drive:{signal:'wheel'},...extra});
  assert.deepEqual(K.wheelSlots(sl('mecanum'),[j('a',7,7.5),j('b',7,-7.5),j('c',-7,7.5),j('d',-7,-7.5)]),{frontLeft:{x:7,y:7.5,wheels:['a']},frontRight:{x:7,y:-7.5,wheels:['b']},backLeft:{x:-7,y:7.5,wheels:['c']},backRight:{x:-7,y:-7.5,wheels:['d']}});
  const kiwi=K.wheelSlots(sl('kiwiSwerve'),[j('a',6,0),j('b',-3,5.2),j('c',-3,-5.2),j('p',0,2,{kind:'odometry-pod'}),j('q',1,-1,{name:'Odometry wheel'})]);
  assert.deepEqual(Object.keys(kiwi),['front','backLeft','backRight']);assert.equal(kiwi.front.x,6);assert.deepEqual(kiwi.backRight,{x:-3,y:-5.2,wheels:['c']});
  assert.deepEqual(K.wheelSlots(sl('tank2'),[j('a',5,7),j('b',0,7),j('c',-5,7),j('d',5,-7),j('e',0,-7),j('f',-5,-7)]),{left:{x:0,y:7,wheels:['a','b','c']},right:{x:0,y:-7,wheels:['d','e','f']}},'six wheels: each side’s middle');
  assert.deepEqual(K.wheelSlots(sl('mecanum'),[]),{});
  // Origins are in the CAD's frame (here y up, z back): toRobot turns them into robot inches before they are given out.
  const toRobot=([x,,z])=>[-z,x,0],cad=K.wheelSlots(sl('kiwi'),[j('a',0,0,{origin:[0,-2.57,-6.2]}),j('b',0,0,{origin:[5.85,-2.57,3.95]}),j('c',0,0,{origin:[-5.85,-2.57,3.95]})],{toRobot});
  assert.deepEqual(cad,{front:{x:6.2,y:0,wheels:['a']},backLeft:{x:-3.95,y:5.85,wheels:['b']},backRight:{x:-3.95,y:-5.85,wheels:['c']}},'a kiwi from its CAD frame');
  assert.deepEqual(C.robot({wheelPos:{front:{x:6,y:0,from:'cad',bottom:-.4,r:1.02},backLeft:{x:1,y:1,bottom:99}}}).wheelPos,{front:{x:6,y:0,from:'cad',bottom:-.4,r:1.02},backLeft:{x:1,y:1}},'a clicked wheel keeps its height and size');
  assert.deepEqual(C.robot({wheelPos:{front:{x:6,y:0,from:'cad'},steerFront:{x:1,y:1},backLeft:{x:99,y:0}}}).wheelPos,{front:{x:6,y:0,from:'cad'}},'kept in Simulate, sane values only');});
