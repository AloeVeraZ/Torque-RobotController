'use strict';
// One-button setup from the Control Hub (ui/sim-hub-setup.js): the robot's active configuration matched to Setup's drive
// motors, mechanisms and sensors by name and kind, with the robot's hubs and ports.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const HS=require('../ui/sim-hub-setup.js'),RC=require('../ui/ftc/robot-config.js'),W=require('../ui/sim-wiring.js'),C=require('../ui/sim-config.js'),M=require('../ui/sim-mechanisms.js'),T=require('../ui/sim-test-robot.js'),PR=require('../ui/sim-preset-robots.js');
const testSetup=()=>{const s=T.setup();s.robot=C.robot(s.robot,'ftc');s.mechanisms=M.sanitize(s.mechanisms);return s;};
const hub=(body,expansion='')=>RC.parse(`<?xml version='1.0'?><Robot type="FirstInspires-FTC"><LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173"><LynxModule name="Control Hub" port="173">${body}<ControlHubImuBHI260AP name="imu" port="0" bus="0" /></LynxModule>${expansion?`<LynxModule name="Expansion Hub 2" port="2">${expansion}</LynxModule>`:''}</LynxUsbDevice></Robot>`);

test('drive motors match by their direction words and take the robot’s ports, whatever the robot calls them',()=>{
  const p=testSetup(),cfg=hub('<goBILDA5202SeriesMotor name="rightFront" port="0" /><goBILDA5202SeriesMotor name="LB" port="1" /><goBILDA5202SeriesMotor name="left_front_drive" port="2" /><goBILDA5202SeriesMotor name="backRightMotor" port="3" />');
  const r=HS.plan(p,cfg),by=k=>r.assign.find(a=>a.key===k);
  assert.deepEqual(['frontLeft','frontRight','backLeft','backRight'].map(k=>[by('robot.'+k).name,by('robot.'+k).port]),[['left_front_drive',2],['rightFront',0],['LB',1],['backRightMotor',3]]);
  assert.equal(by('robot.imu').name,'imu');assert.equal(r.hubs.expansion,false,'the robot has no Expansion Hub');
  const q=HS.apply(p,r),st=W.state(q),fl=st.rows.find(x=>x.key==='robot.frontLeft');assert.equal(fl.name,'left_front_drive');assert.deepEqual([fl.hub,fl.port,fl.wired],['control',2,true]);
  assert.equal(q.robot.wiring.hubs.expansion,false);
});

test('the real aloetest configuration sets up the Starter Mecanum chassis alone, its mechanisms left as the preset has them',()=>{
  const xml=fs.readFileSync(path.join(__dirname,'../examples/robot-configurations/aloetest.xml'),'utf8'),base=testSetup(),p={...base,...PR.apply('startermecanum',base,C,{})};
  const r=HS.plan(p,RC.parse(xml),{only:'chassis'});assert.ok(r.assign.every(a=>W.stepOf(a.key)==='robot'));
  assert.deepEqual(Object.fromEntries(r.assign.filter(a=>a.port!==undefined).map(a=>[a.key,a.port])),{'robot.frontRight':0,'robot.backLeft':1,'robot.frontLeft':2,'robot.backRight':3});
  const more=hub('<goBILDA5202SeriesMotor name="frontRight" port="0" /><goBILDA5202SeriesMotor name="backLeft" port="1" /><goBILDA5202SeriesMotor name="frontLeft" port="2" /><goBILDA5202SeriesMotor name="backRight" port="3" />','<goBILDA5202SeriesMotor name="shooter" port="0" /><goBILDA5202SeriesMotor name="middleLeft" port="1" />');
  assert.deepEqual(HS.plan(p,more,{only:'chassis'}).unused.map(u=>u.name),['middleLeft'],'a preset lists only a leftover drive-like motor');
  const q=HS.apply(p,r);assert.deepEqual(q.mechanisms,p.mechanisms);assert.deepEqual(W.state(q).problems.filter(x=>x.level==='red'),[]);
});

test('mechanism motors, servos and sensors match by the words they share; a Pinpoint sets the localization; an Expansion Hub turns on',()=>{
  const p=testSetup(),st=W.state(p),mech=st.rows.filter(r=>W.stepOf(r.key)==='mechanisms'&&r.role!=='sensor');assert.ok(mech.length>=3,'the Test setup has mechanisms');
  const shooter=mech.find(r=>r.role==='flywheel'),hood=mech.find(r=>r.role==='hood');
  const cfg=hub('<goBILDA5202SeriesMotor name="fl" port="0" /><goBILDA5202SeriesMotor name="fr" port="1" /><goBILDA5202SeriesMotor name="bl" port="2" /><goBILDA5202SeriesMotor name="br" port="3" /><goBILDAPinpoint name="odo" port="0" bus="1" />',
    `<goBILDA5202SeriesMotor name="${shooter.name}" port="3" /><Servo name="hoodServo" port="4" /><RevTouchSensor name="extraThing" port="1" />`);
  const r=HS.plan({...p,sensors:{...p.sensors,localization:'encoders'}},cfg),by=k=>r.assign.find(a=>a.key===k);
  assert.equal(r.localization,'fused');assert.equal(by('robot.pinpoint').name,'odo');assert.deepEqual(r.hubs.expansion,{address:2});
  assert.deepEqual([by(shooter.key).hub,by(shooter.key).port,by(shooter.key).exact],['expansion',3,true]);
  assert.deepEqual([by(hood.key).name,by(hood.key).hub,by(hood.key).port],['hoodServo','expansion',4]);
  assert.ok(r.unused.some(u=>u.name==='extraThing'),'a sensor named for nothing in Setup is listed, not guessed');
  const q=HS.apply(p,r);assert.equal(q.sensors.localization,'fused');assert.equal(q.robot.wiring.hubs.expansion.address,2);
  assert.ok(HS.lines(r).length>=r.assign.length);assert.match(HS.summary(r),/matched/);
});

test('sides never cross: leftLift is not the right lift, and a lift motor is not a drive motor',()=>{
  const row=(key,name,role,label='')=>({key,name,role,label,need:'motor',family:'motor'});
  assert.equal(HS.score(row('kin.l','rightLift','kin-motor','Right lift'),{name:'leftLift',kind:'motor'}),0);
  assert.ok(HS.score(row('kin.l','leftLift','kin-motor','Left lift'),{name:'liftLeft',kind:'motor'})>0);
  assert.equal(HS.score(row('robot.left','left_drive','drive'),{name:'leftLift',kind:'motor'})<HS.score(row('kin.l','lift','kin-motor','Lift'),{name:'leftLift',kind:'motor'}),true);
  assert.equal(HS.score(row('robot.frontLeft','front_left','drive'),{name:'frontLeft',kind:'servo'}),0,'a servo is not a drive motor');
});

test('Calibrate shows ports only as the Control Hub reported them: its read-out, and each device’s port from it',()=>{
  const cfg=hub('<goBILDA5202SeriesMotor name="frontLeft" port="2" /><Servo name="mystery" port="4" />'),p0=testSetup(),p=HS.apply(p0,HS.plan(p0,cfg)),read=HS.readout(cfg),st=W.state(p);
  assert.deepEqual(read.find(d=>d.name==='frontLeft'),{name:'frontLeft',kind:'motor',tag:'goBILDA5202SeriesMotor',hub:'control',port:2});
  const table=W.readoutHtml(read,st);assert.match(table,/<tr data-read-row="frontLeft"><td>Motor port 2<\/td>/);assert.match(table,/<tr data-read-row="mystery"><td>Servo port 4<\/td>/);
  const row=k=>st.rows.find(r=>r.key===k),on=W.deviceHtml(row('robot.frontLeft'),st,{sensors:true,read});
  assert.match(on,/data-wire-read="on">Control Hub motor port 2</);assert.doesNotMatch(on,/data-wire-port|Deck picks/);
  const off=W.deviceHtml(row('robot.frontRight'),st,{sensors:true,read});
  assert.match(off,/data-wire-read="off">Not on the Control Hub</);assert.doesNotMatch(off,/data-wire-port|Deck picks|motor port \d/);
});

test('a moving part takes motor or servo from the robot: a ramp set as continuous runs as the set-position servo the configuration has',()=>{
  const project=C.defaults?C.defaults():T.setup();project.controller='ftc';project.kinematics=require('../ui/sim-kinematics.js').sanitize({joints:[{id:'ramp',name:'Deployable ramp',type:'revolute',lower:0,upper:90,states:{up:0,down:90}}],actuators:[{id:'rampServo',name:'Deployable ramp',joint:'ramp',kind:'crservo',device:'ramp',speed:90}]});
  const config=RC.parse(`<?xml version='1.0'?><Robot type="FirstInspires-FTC"><LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173"><LynxModule name="Control Hub" port="173"><Servo name="ramp" port="2" /></LynxModule></LynxUsbDevice></Robot>`);
  const next=HS.apply(project,HS.plan(project,config));assert.equal(next.kinematics.actuators.find(a=>a.id==='rampServo').kind,'servo');
});
