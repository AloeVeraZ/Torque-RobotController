'use strict';
// The chassis in Mechanisms asks only what each motor or servo is plugged into: from what the Control Hub reported when it has
// been read, otherwise any port on the hubs. A swerve's steering also says where its absolute encoder is.
const test=require('node:test'),assert=require('node:assert/strict');
global.window=global;
const H=require('../ui/sim-hardware.js');global.DeckHardware=H;const W=require('../ui/sim-wiring.js');
const project=(drivetrain,wiring)=>({controller:'ftc',robot:{drivetrain,...(wiring?{wiring}:{})},sensors:{},mechanisms:{enabled:false},kinematics:{joints:[],actuators:[]}});
const chassis=st=>st.rows.filter(r=>['drive','steer'].includes(r.role));
const READ=[{name:'lf',kind:'motor',hub:'control',port:2},{name:'turnFront',kind:'crservo',hub:'control',port:1},{name:'turnEnc',kind:'analog',hub:'control',port:3},{name:'light',kind:'digital',hub:'control',port:0}];

test('with no read-out, every port of the right kind on the hubs is offered, and no model or gear ratio',()=>{
  const st=W.state(project('kiwiSwerve')),html=W.chassisHtml(chassis(st),st,null);
  assert.doesNotMatch(html,/data-wire-model|data-wire-ratio|data-wire-kind/);assert.match(html,/data-wire-port="robot\.front"/);assert.match(html,/Control Hub motor port 3/);assert.match(html,/Control Hub servo port 5/);assert.match(html,/Control Hub analog port 3/);
  assert.equal((html.match(/data-wire-chassis-encoder=/g)||[]).length,3,'one encoder for each steering servo');
});

test('with a read-out, only what the hub reported is offered, and choosing takes its configuration name',()=>{
  const st=W.state(project('kiwiSwerve')),html=W.chassisHtml(chassis(st),st,READ);
  assert.match(html,/data-wire-assign="robot\.front"/);assert.match(html,/value="control:2\|lf"/);assert.match(html,/value="control:1\|turnFront"/);assert.match(html,/value="control:3\|turnEnc"/);assert.doesNotMatch(html,/value="control:0\|light"/,'a digital device is no choice');
});

test('a module encoder is added on its port with its name, keeps a model already given, and comes off',()=>{
  const st=W.state(project('kiwiSwerve')),row=chassis(st).find(r=>r.key==='robot.steerFront');
  let w=W.setChassisEncoder(st.wiring,row,'control:3','turnEnc');let enc=w.sensors.find(s=>s.for===row.key);
  assert.equal(enc.model,'analog-absolute');assert.equal(enc.hub,'control');assert.equal(enc.port,3);assert.equal(enc.name,'turnEnc');
  w={...w,sensors:w.sensors.map(s=>s.for===row.key?{...s,model:'axon-feedback'}:s)};w=W.setChassisEncoder(w,row,'control:1');enc=w.sensors.find(s=>s.for===row.key);assert.equal(enc.model,'axon-feedback','the model from Setup & Calibrate stays');assert.equal(enc.port,1);assert.equal(w.sensors.filter(s=>s.for===row.key).length,1);
  const shown=W.state(project('kiwiSwerve',w));assert.match(W.chassisHtml(chassis(shown),shown,null),/value="control:1" selected>Control Hub analog port 1/);
  assert.equal(H.wiringOf({wiring:W.setChassisEncoder(w,row,'')}).sensors.some(s=>s.for===row.key),false);
});

test('two motors on one port say so on the chassis, and hold nothing back',()=>{
  const base=W.state(project('mecanum')).wiring,w=W.setPort(W.setPort(base,'robot.frontLeft','control:0','motor'),'robot.frontRight','control:0','motor'),st=W.state(project('mecanum',w));
  assert.match(W.chassisHtml(chassis(st),st,null),/sim-wire-problem/);
});
