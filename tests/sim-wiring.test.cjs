'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../ui/sim-wiring.js'),H=require('../ui/sim-hardware.js'),C=require('../ui/sim-config.js'),M=require('../ui/sim-mechanisms.js'),T=require('../ui/sim-test-robot.js');
const testSetup=()=>{const s=T.setup();s.robot=C.robot(s.robot,'ftc');s.mechanisms=M.sanitize(s.mechanisms);return s;};

test('the Test setup is wired with nothing red; the Robot step owns the drivetrain, the Mechanisms step the rest',()=>{
  const p=testSetup(),st=W.state(p);assert.equal(st.error,null);assert.deepEqual(st.problems,[]);
  assert.deepEqual(st.rows.filter(r=>W.stepOf(r.key)==='robot').map(r=>r.name),['front_left','front_right','back_left','back_right','imu','pinpoint']);
  assert.ok(W.state(p)===st,'the same project gives the same state');
  const html=W.summaryHtml(st);assert.match(html,/Expansion Hub</);assert.match(html,/<code>shooter<\/code>/);
  const fl=W.deviceHtml(st.rows[0],st);assert.match(fl,/data-wire-model="robot.frontLeft"/);assert.match(fl,/<option value="gobilda-5203-435" selected>/);assert.match(fl,/<option value="control:0" selected>/);
  assert.ok(W.modelChoices(st.rows[0]).every(m=>m.kind==='dcmotor'),'a drive motor picks from motors only');
  assert.ok(W.modelChoices(st.rows.find(r=>r.role==='hood')).every(m=>m.kind==='servo'||m.kind==='linear'));
});

test('two devices on one port are kept and shown red on their step; Deck picks the port again when it is cleared',()=>{
  const p=testSetup();p.robot.wiring=W.setPort(p.robot.wiring,'robot.backLeft','control:0','motor');
  const st=W.state(p),red=W.red(st,k=>W.stepOf(k)==='robot');assert.equal(red.length,1);assert.match(red[0].text,/Control Hub motor port 0 is used by Front left drive motor and Back left drive motor/);
  assert.equal(W.red(st,k=>W.stepOf(k)==='mechanisms').length,0);assert.match(W.deviceHtml(st.rows.find(r=>r.key==='robot.backLeft'),st),/sim-wire-row red/);
  p.robot.wiring=W.setPort(p.robot.wiring,'robot.backLeft','','motor');const again=W.state(p);assert.deepEqual(again.problems,[]);
  const bl=again.rows.find(r=>r.key==='robot.backLeft');assert.equal(bl.planned,true);assert.equal(bl.portLabel,'Control Hub motor port 2');
});

test('hubs, models and sensors change through the wiring helpers',()=>{
  let w=W.setHub(null,'servoHub',true);assert.deepEqual(w.hubs,{expansion:null,servoHub:{address:3}});w=W.setHub(w,'servoHub',true,7);assert.equal(w.hubs.servoHub.address,7);
  w=W.setModel(w,'shooters.0.hood','axon-max');assert.deepEqual(w.devices['shooters.0.hood'],{model:'axon-max'});
  w=H.sanitizeWiring({...w,sensors:[{id:'hoodAngle',model:'axon-feedback',for:'shooters.0.hood'}]});w=W.setSensorPort(w,'hoodAngle','control:1');
  assert.deepEqual(w.sensors[0],{id:'hoodAngle',model:'axon-feedback',for:'shooters.0.hood',use:'position',hub:'control',port:1});
  assert.equal(W.removeSensor(W.setModel(W.setHub(w,'servoHub',false),'shooters.0.hood',''),'hoodAngle'),null,'nothing left set');
});

test('what lights up on the model: a device row its joints (and what rides on them), a game part its joints and assemblies',()=>{
  const p=testSetup(),S=T.KEY.shooter,I=T.KEY.intake;p.model={parts:[{name:'Ramp intake',key:I},{name:'Turret shooter (pollen + nectar)',key:S}]};
  assert.deepEqual(W.focusRefs(p,'shooters.0.hood'),[S+'/Hood']);
  assert.deepEqual(new Set(W.focusRefs(p,'shooters.0.turretMotor')),new Set([S,S+'/Flywheel',S+'/Hood',S+'/Kicker']),'the turret carries the flywheel, hood and kicker');
  assert.deepEqual(W.focusRefs(p,'intakes.0.servo'),[I+'/Ramp']);
  const intake=W.focusRefs(p,'intake:0');assert.ok(intake.includes(I+'/Ramp')&&intake.includes(I+'/Rollers/Lower roller')&&intake.includes(I),'its joints and its named assembly');
  assert.deepEqual(W.focusRefs(p,'kin:wheelFL'),[T.KEY.chassis+'/Mecanum wheel FL']);assert.deepEqual(W.focusRefs(p,null),[]);
});

test('odometry pods with no motor port left go on a drive motor\'s encoder input: amber (name it as that motor), never red',()=>{
  for(const localization of ['odometry','odometry3']){const p=testSetup();p.sensors={localization};const st=W.state(p);
    assert.deepEqual(W.red(st,()=>true),[],localization);
    const pods=st.rows.filter(r=>r.role==='pod');assert.ok(pods.length>=2&&pods.every(r=>r.hub),localization+': every pod has a port');
    for(const pod of pods.filter(r=>r.via))assert.ok(st.problems.some(x=>x.level==='amber'&&x.keys.includes(pod.key)&&x.text.includes(`name it "${pod.via}"`)));}
});
