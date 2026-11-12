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

test('a push of a measured distance gives the ticks in an inch, and names a motor that counts backwards or not at all',()=>{
  // A mecanum with no Pinpoint: its drive encoders are what it has, so this is its distance calibration.
  const ch=K.chassisOf(robot(),C),k=ch.nominalTicksPerIn*1.04,at=(fl,fr,bl,br)=>({'m:leftFront:pos':fl,'m:rightFront:pos':-fr,'m:leftBack:pos':bl,'m:rightBack:pos':-br});
  assert.equal(K.rolls(ch),true);assert.equal(K.rolls(K.chassisOf(robot({sensors:{localization:'fused'}}),C)),false,'a Pinpoint robot measures distance with its pods');assert.equal(K.rolls(K.chassisOf(robot({sensors:{localization:'gyro'}}),C)),false,'heading only: no distance to calibrate');
  const r=K.rollOf(ch,at(100,100,100,100),at(100+48*k,100+48*k,100+48*k,100+48*k));
  near(r.ticksPerIn,k,.01,'ticks an inch');near(r.errorPct,4,.05,'4% more than the wheel size says');assert.equal(r.ok,true);
  const bad=K.rollOf(ch,at(0,0,0,0),at(48*k,-48*k,48*k,2));assert.equal(bad.ok,false);assert.deepEqual(bad.rows.map(x=>[x.backwards,x.weak]),[[false,false],[true,false],[false,false],[false,true]]);
  near(bad.ticksPerIn,k,.01,'the motor that hardly counted is left out');
  assert.match(K.rollOf(ch,at(0,0,0,0),at(3,3,3,3)).problem,/hardly counted/);assert.match(K.rollOf(ch,{},{}).problem,/No encoder reading/);
  // The measured figure is then what the chassis counts distance with.
  near(K.chassisOf({...robot(),calibration:{chassis:{roll:{ticksPerIn:50}}}},C).driveTicksPerIn,50,1e-9);});

test('what was checked is written as constants for the team’s code: a mecanum, and a Kiwi swerve with its pods',()=>{
  const links=[{causes:[{name:'rightFront'}],effect:{key:'m:rightFront:pos',dir:-1},result:{state:'pass'}}];
  const mec=K.codeOf({ch:K.chassisOf(robot(),C),rec:{roll:{ticksPerIn:45.5,inches:48},pods:{frontLeft:{drive:true,enc:1}}},links,config:'aloetest',date:'2026-11-10'});
  assert.match(mec,/public final class TorqueCalibration \{/);assert.match(mec,/DRIVE_TICKS_PER_INCH = 45\.5; \/\/ measured by pushing 48 in/);
  assert.match(mec,/LEFT_FRONT_REVERSED = false;\n/);assert.match(mec,/LEFT_FRONT_ENCODER_SIGN = 1;\n/);assert.match(mec,/RIGHT_FRONT_REVERSED = true; \/\/ not checked yet/);assert.match(mec,/RIGHT_FRONT_ENCODER_SIGN = -1;/,'Electronics’ link, until it is checked here');
  assert.match(mec,/LEFT_BACK_ENCODER_SIGN = 1; \/\/ not checked yet/);assert.match(mec,/IMU_HEADING_SCALE = 1\.0; \/\/ not corrected/);assert.doesNotMatch(mec,/STEER/,'no steering on a mecanum');
  const kiwi={robot:{drivetrain:'kiwiSwerve',devices:{front:{name:'frontPod'},backLeft:{name:'leftPod'},backRight:{name:'rightPod',reversed:true}},odometry:{imu:{scale:1.00123}}},sensors:{localization:'encoders'}},ch=K.chassisOf(kiwi,C);
  assert.deepEqual(ch.motors.map(m=>m.name),['frontPod','leftPod','rightPod']);assert.equal(C.robot(kiwi.robot,'ftc').devices.backRight.reversed,true,'a reversed pod motor is kept with the setup');
  // A swerve on drive encoders and the IMU measures its heading only: no distance to calibrate, none in the code.
  assert.equal(K.measures(ch),'heading');assert.equal(K.rolls(ch),false);
  const steer=[{key:'robot.steerFront',name:'frontPodE',servo:'frontPodS',volts:3.3},{key:'robot.steerBackLeft',name:'leftPodE',servo:'leftPodS',volts:3.3}];
  assert.deepEqual(K.podsOf(ch,steer).map(q=>[q.key,q.label,q.steer?.name||null]),[['front','Front','frontPodE'],['backLeft','Back left','leftPodE'],['backRight','Back right',null]]);
  const sw=K.codeOf({ch,rec:{steer:{zero:{frontPodE:1.652}},pods:{front:{left:true,right:true,drive:true,sense:-1,enc:-1}}},links:[{causes:[{name:'frontPodS'}],effect:{key:'a:frontPodE',dir:-1},result:{state:'pass'}}],steer});
  assert.match(sw,/IMU_HEADING_SCALE = 1\.00123; \/\/ measured/);assert.match(sw,/FRONT_POD_E_ZERO_VOLTS = 1\.6520;\n/);assert.match(sw,/FRONT_POD_E_ENCODER_SIGN = -1;\n/);
  assert.match(sw,/FRONT_POD_S_SERVO_SIGN = 1;\n/,'the servo lowers the reading, and a lower reading is left');assert.match(sw,/FRONT_POD_ENCODER_SIGN = -1;\n/);assert.match(sw,/RIGHT_POD_REVERSED = true; \/\/ not checked yet/);
  assert.match(sw,/LEFT_POD_E_ZERO_VOLTS = 0\.0; \/\/ not set/);assert.match(sw,/LEFT_POD_E_ENCODER_SIGN = 1; \/\/ not checked yet/);assert.doesNotMatch(sw,/DRIVE_TICKS_PER_INCH/);
  assert.equal(sw.split('{').length,sw.split('}').length);for(const l of sw.split('\n').filter(x=>/public static final/.test(x)))assert.match(l,/^    public static final (double|int|boolean) [A-Z0-9_]+ = (-?[0-9.]+|true|false);/);});

test('a pod’s quarter turns: the reading to hold, the angle a reading is, and the loop Torque Debug runs',()=>{
  // Zero at 1.0 V of 3.3: a quarter turn left is a quarter of the span up, and the other way with the sense turned round.
  near(K.steerTarget(1,90,3.3),1.825,1e-9);near(K.steerTarget(1,-90,3.3),.175,1e-9);near(K.steerTarget(1,90,3.3,-1),.175,1e-9);
  near(K.steerTarget(.5,-90,3.3),.5-.825+3.3,1e-9,'past the end of the encoder, it comes round');
  near(K.steerAngle(1.825,1,3.3),90,1e-9);near(K.steerAngle(.175,1,3.3,-1),90,1e-9);near(K.steerAngle(2.975,.5,3.3),-90,1e-9,'the short way round');
  const q=K.steerLoop({servo:'frontPodS',name:'frontPodE'},1.825,-1,3.3).split('\t');
  assert.deepEqual(q.slice(0,5),['Q','frontPodS','ana:frontPodE','pos','1.8250']);assert.ok(+q[5]<0&&+q[7]<0&&+q[9]<0,'a servo that lowers the reading is driven the other way');assert.equal(q[5],'-0.300','gentle until the pod is tuned');
  near(+q[11],.6*1.5/360*3.3,1e-4,'the loop rests well inside the degree and a half allowed, not on its edge');near(+K.steerLoop({servo:'s',name:'e'},1,1,3.3,undefined,3).split('\t')[11],.6*3/360*3.3,1e-4,'or inside what the team allows');assert.equal(q[12],'3.3','the short way round one turn');assert.equal(K.TOL_DEG,1.5);});

test('a pod’s steering is tuned from how its own servo answers',()=>{
  // A servo that turns the reading at 5 V/s at full power, 80 ms after it is told, run at 30%: 1.5 V/s from 0.08 s on.
  const run=(kv,L,u,sign=1)=>Array.from({length:12},(_,i)=>{const t=(i+1)*.04;return [t,sign*Math.max(0,t-L)*kv*u];});
  const p=K.plantOf(run(5,.08,.3),.3);near(p.Kv,5,.01,'speed at full power');near(p.L,.08,.005,'the wait');assert.equal(p.g,1);
  assert.equal(K.plantOf(run(5,.08,.3,-1),.3).g,-1,'which way it moves the reading comes from the run itself');assert.equal(K.plantOf(run(0,.08,.3),.3),null,'it never moved');assert.equal(K.plantOf([[0,0]],.3),null);
  // A quick servo with a long wait gets less proportional than a slow one; never more than 60% power for a quarter turn.
  const quick=K.gainsOf({Kv:8,L:.12,breakaway:.07}),slow=K.gainsOf({Kv:1,L:.03,breakaway:.1});
  near(quick.kP,.3/(8*.12),.002);assert.ok(quick.kP<slow.kP);near(slow.kP,.6/(3.3/4),.002,'capped');near(quick.kS,.042,.001,'most of what it took to start moving');assert.ok(quick.kD>0);
  // A test turn that swings past and hunts is not steady; one that arrives and stays is.
  const hunting=Array.from({length:60},(_,i)=>[i*.04,45*Math.cos(i*.5)*Math.exp(-i*.01)]),good=Array.from({length:60},(_,i)=>[i*.04,45*Math.exp(-i*.25)]);
  const h=K.stepStats(hunting),ok=K.stepStats(good);assert.ok(h.crossings>3&&h.overshoot>20&&!K.steady(h));assert.equal(ok.crossings,0);assert.equal(ok.overshoot,0);assert.ok(ok.settle>0&&ok.settle<1.2);assert.ok(K.steady(ok));
  assert.equal(K.steady(K.stepStats(Array.from({length:40},(_,i)=>[i*.04,10]))),false,'stopped short is not there');
  // The loop Torque Debug runs takes those gains, turned round for a servo that lowers the reading.
  const q=K.steerLoop({servo:'leftPodS',name:'leftPodE'},1.568,-1,3.3,{kP:.25,kD:.01,kS:.04}).split('\t');assert.deepEqual([q[5],q[7],q[9]],['-0.250','-0.0100','-0.040']);
  // And they go to the team's code a degree at a time.
  const kiwi={robot:{drivetrain:'kiwiSwerve',devices:{front:{name:'frontPod'},backLeft:{name:'leftPod'},backRight:{name:'rightPod'}}},sensors:{localization:'encoders'}};
  const code=K.codeOf({ch:K.chassisOf(kiwi,C),rec:{steer:{zero:{leftPodE:.743}},pods:{backLeft:{left:true,right:true,sense:1,pid:{kP:.36,kD:.009,kS:.04,g:-1}}}},steer:[{key:'robot.steerBackLeft',name:'leftPodE',servo:'leftPodS',volts:3.6}]});
  assert.match(code,/LEFT_POD_S_SERVO_SIGN = -1;\n/,'the tuned direction, not Electronics’ link');assert.match(code,/LEFT_POD_S_KP = 0\.0036; \/\/ power per degree/);assert.match(code,/LEFT_POD_S_KS = 0\.04; \/\/ power, towards the target/);
  // With the loop itself, to call from teleop and autonomous: it is the loop that was tuned, a degree at a time.
  assert.match(code,/public static double steerPower\(double volts, double targetDegrees, double zeroVolts, int encoderSign, int servoSign, double kP, double kS\) \{/);assert.match(code,/STEER_TOLERANCE_DEGREES = 1\.5;/);
  const steerPower=(volts,target,zero,enc,servo,kP,kS)=>{let e=target-enc*(volts-zero)/3.6*360;e-=360*Math.round(e/360);return Math.abs(e)<=1.5?0:servo*(kP*e+kS*Math.sign(e));};
  // The same power Torque Debug's loop gave at that reading: its gains are per volt, on (target volts − volts), turned by g.
  const volts=1.1,target=K.steerTarget(.743,90,3.6,1),robot=-1*(.36*(target-volts)+.04*Math.sign(target-volts));near(steerPower(volts,90,.743,1,-1,.0036,.04),robot,1e-9,'one loop, two units');});

test('the tune looks for the quickest quarter turn that stays accurate, and the team sets how far off is allowed',()=>{
  const good=settle=>({settle,overshoot:.5,crossings:1}),hot={settle:null,overshoot:9,crossings:6},short={settle:null,overshoot:0,crossings:0},base={kP:.2,kD:.006,kS:.05,g:-1};
  // Steady: a third more each time, until one is not; then it stops, and the quickest steady one is kept.
  const up=K.nextTry([{pid:base,stats:good(.6)}]);near(up.kP,.27,1e-9);near(up.kD,.0081,1e-9);assert.equal(up.kS,.05);assert.equal(up.g,-1);
  const tries=[{pid:base,stats:good(.6)},{pid:up,stats:good(.42)},{pid:{...up,kP:.365},stats:hot}];assert.equal(K.nextTry(tries),null);assert.equal(K.bestTry(tries).pid.kP,.27,'the quickest that stayed accurate');
  // Too much from the start: down until one is steady, then no climbing back.
  near(K.nextTry([{pid:base,stats:hot}]).kP,.12,1e-9);assert.equal(K.nextTry([{pid:base,stats:hot},{pid:{...base,kP:.12},stats:good(.8)}]),null);assert.equal(K.bestTry([{pid:base,stats:hot}]),null);
  // Stopped short without swinging: more push against friction, not less gain.
  assert.deepEqual(K.nextTry([{pid:base,stats:short}]),{...base,kS:.07});
  assert.equal(K.nextTry(Array.from({length:9},()=>({pid:base,stats:good(.5)}))),null,'nine turns at most');assert.equal(K.nextTry([{pid:{...base,kP:4},stats:good(.3)}]),null,'no point past full power');
  // What is allowed: a degree and a half each way unless the team picks otherwise, and only from the list.
  assert.deepEqual(K.tolOf({}),{plus:1.5,minus:1.5});assert.deepEqual(K.tolOf({tol:{plus:3,minus:.5}}),{plus:3,minus:.5});assert.deepEqual(K.tolOf({tol:{plus:40,minus:'x'}}),{plus:1.5,minus:1.5});
  const kiwi={robot:{drivetrain:'kiwiSwerve',devices:{front:{name:'frontPod'}}},sensors:{localization:'encoders'}};
  assert.match(K.codeOf({ch:K.chassisOf(kiwi,C),rec:{tol:{plus:3,minus:1}},steer:[{key:'robot.steerFront',name:'frontPodE',servo:'frontPodS',volts:3.3}]}),/STEER_TOLERANCE_DEGREES = 1;/,'the code holds the tighter side');});


test('the long tune tries each gain up and down and keeps what made the turn better',()=>{
  // The best turn is at kP 0.5, kI 0, kD 0.02; the cost grows with the distance from it.
  const cost=([p,i,d])=>Math.abs(p-.5)+Math.abs(i)*2+Math.abs(d-.02)*10;let s=K.searchStart([.2,0,.005],[.05,.1,.003]);const first=cost(s.p);
  for(let n=0;n<120;n++)s=K.searchStep(s,cost(s.p));
  assert.ok(s.best<first/8,`it got much better: ${first} to ${s.best}`);near(s.bestP[0],.5,.06,'kP');near(s.bestP[1],0,.02,'kI stayed out');near(s.bestP[2],.02,.006,'kD');assert.ok(s.bestP.every(v=>v>=0),'no gain goes below zero');
  // A turn that never settled costs more than any that did; a quicker steady turn costs less than a slower one.
  const fast={settle:.3,overshoot:1,crossings:1},slow={settle:.6,overshoot:0,crossings:0},never={settle:null,overshoot:2,crossings:5};
  assert.ok(K.costOf(fast)<K.costOf(slow)&&K.costOf(slow)<K.costOf(never)&&K.costOf(never)<K.costOf(null));
  // The loop Torque Debug runs carries the integral gain too, turned round with the others.
  assert.equal(K.steerLoop({servo:'s',name:'e'},1,-1,3.3,{kP:.3,kI:.2,kD:.01,kS:.04}).split('\t')[6],'-0.200');});

test('a turn that hunts after it arrives is caught as oscillating, even inside the tolerance',()=>{
  // Arrives in 0.4 s, then: still; or wobbling ±0.5° four times a second; or swinging out of the tolerance and back.
  const arrive=i=>45*Math.exp(-i*.35),run=after=>Array.from({length:70},(_,i)=>[i*.04,i<20?arrive(i):after(i-20)]);
  const still=K.stepStats(run(()=>.1)),buzz=K.stepStats(run(k=>.5*Math.sin(k*1.0))),wild=K.stepStats(run(k=>4*Math.sin(k*.6)));
  assert.equal(still.hunt,0);assert.ok(still.held>1.8&&still.swing<.3);assert.equal(K.oscillates(still),false);assert.ok(K.steady(still,1.8),'held still for the whole watch');
  assert.ok(buzz.hunt>=3&&buzz.swing>.6,JSON.stringify(buzz));assert.equal(buzz.settle!==null,true,'it never left the tolerance');assert.equal(K.oscillates(buzz),true);assert.equal(K.steady(buzz),false);
  assert.equal(K.steady(wild,1.8),false,'in and out of the tolerance is not holding');assert.ok(wild.held<1.8);
  // And it costs: hunting gains lose to calm ones however quick they got there.
  assert.ok(K.costOf(buzz)>K.costOf(still)+3);assert.ok(K.costOf({settle:.3,overshoot:0,crossings:0,hunt:1,swing:.3})>K.costOf({settle:.3,overshoot:0,crossings:0,hunt:0,swing:0}));
  // Watched for too short a time to say: not steady for a longer hold.
  assert.equal(K.steady({settle:.4,held:.3,overshoot:0,crossings:0,hunt:0,swing:0},1.8),false);assert.equal(K.steady({settle:.4,held:.3,overshoot:0,crossings:0,hunt:0,swing:0}),true);});

