'use strict';
// Mechanisms' device rows and what they light up on the model, the second turret device and gear train, and their export.
const test=require('node:test'),assert=require('node:assert/strict');
const H=require('../ui/sim-hardware.js'),W=require('../ui/sim-wiring.js'),M=require('../ui/sim-mechanisms.js'),F=require('../ui/sim-ftc.js');
const mech=extra=>M.sanitize({enabled:true,intakes:[{kind:'ramp',sides:['front'],...extra?.intake}],shooters:[{type:'turret',pieces:'pollen',mount:'back',parts:['POLLEN V2','turret final'],...extra?.shooter},{type:'turret',pieces:'nectar',mount:'front',parts:['NECTAR V2','turret final']}],turret:{kind:'servo',...extra?.turret}});
const project=(m,wiring,kinematics)=>({controller:'ftc',robot:{drivetrain:'mecanum',...(wiring?{wiring}:{})},sensors:{},mechanisms:m,kinematics:kinematics||{joints:[],actuators:[]},model:{parts:[{name:'POLLEN V2',key:'a/POLLEN V2'},{name:'NECTAR V2',key:'a/NECTAR V2'},{name:'turret final',key:'a/turret final'}]}});

test('a device row is its type, model, port, power and sensor, with no sentences',()=>{
  const st=W.state(project(mech())),row=st.rows.find(r=>r.key==='intakes.0.motor'),html=W.mechRowHtml(row,st);
  for(const want of ['data-wire-kind','data-wire-model','data-wire-port','data-wire-sensor-add'])assert.ok(html.includes(want),want);
  for(const gone of ['sim-wire-explain','sim-wire-why','<code','data-wire-ratio','data-wire-spm'])assert.ok(!html.includes(gone),gone);
  assert.match(html,/<option value="">No sensor · \+ Add one…<\/option>/);for(const g of ['Analog','Digital','I2C'])assert.ok(html.includes(`<optgroup label="${g}">`),g);assert.doesNotMatch(html,/tells/i);
});

test('Simulate lists what a mechanism runs on and its feedback sensor, and no ports',()=>{
  const st=W.state(project(mech())),row=st.rows.find(r=>r.key==='intakes.0.motor'),w=W.addSensor(st.wiring,row,'rev-color-v3'),shown=W.state(project(mech(),w)),html=W.mechRowHtml(shown.rows.find(r=>r.key===row.key),shown,{ports:false});
  for(const gone of ['data-wire-port','data-wire-assign','data-wire-sensor-port','plugged into'])assert.ok(!html.includes(gone),gone);
  for(const want of ['data-wire-kind','data-wire-model','data-wire-sensor-add','REV Color Sensor V3','data-wire-linked="off"','Linked in Calibrate'])assert.ok(html.includes(want),want);
  assert.match(W.mechRowHtml(st.rows.find(r=>r.key===row.key),st,{ports:false}),/Feedback sensor/);
});

test('Calibrate links each part Simulate lists to a device of the robot’s configuration',()=>{
  const read=[{name:'intakeMotor',kind:'motor',hub:'control',port:2,tag:'Motor'},{name:'lf',kind:'motor',hub:'control',port:0,tag:'Motor'},{name:'gate',kind:'servo',hub:'control',port:1,tag:'Servo'},{name:'pieceSeen',kind:'color',hub:'control',bus:2,tag:'RevColorSensorV3'}];
  let st=W.state(project(mech())),row=st.rows.find(r=>r.key==='intakes.0.motor'),w=W.addSensor(W.addSensor(st.wiring,row,'rev-color-v3'),row,'motor-encoder');st=W.state(project(mech(),w));row=st.rows.find(r=>r.key==='intakes.0.motor');
  const html=W.linkHtml(row,st,read),id=st.wiring.sensors.find(s=>s.model==='rev-color-v3').id;
  assert.match(html,/data-wire-assign="intakes\.0\.motor" data-link-state="off"/);assert.match(html,/<option value="control:2\|intakeMotor">intakeMotor · Control Hub motor port 2<\/option>/);assert.doesNotMatch(html,/gate · /,'only its own kind of device');
  assert.match(html,new RegExp(`data-wire-sensor-assign="${id}"`));assert.match(html,/<option value="control:2\|pieceSeen">pieceSeen · Control Hub I2C bus 2<\/option>/);assert.match(html,/encoder cable of this motor’s own port/);
  assert.equal(W.linked(row,st,read),false,'nothing linked yet');
  // The motor takes the configured name and port (as Calibrate's deviceAssign does), then the sensor.
  const m=mech();m.intakes[0].motor='intakeMotor';w=W.setPort(w,'intakes.0.motor','control:2','motor');let now=W.state(project(M.sanitize(m),w));
  assert.equal(W.linked(now.rows.find(r=>r.key==='intakes.0.motor'),now,read),false,'its sensor is not');
  w=W.assignSensor(w,id,'control:2|pieceSeen');now=W.state(project(M.sanitize(m),w));const done=now.rows.find(r=>r.key==='intakes.0.motor');
  assert.deepEqual((({name,hub,bus})=>({name,hub,bus}))(now.rows.find(r=>r.key==='sensor.'+id)),{name:'pieceSeen',hub:'control',bus:2});assert.equal(W.linked(done,now,read),true);
  assert.match(W.linkHtml(done,now,read),/data-wire-assign="intakes\.0\.motor" data-link-state="on"/);assert.match(W.mechRowHtml(done,now,{ports:false}),/data-wire-linked="on">intakeMotor · Control Hub motor port 2</);
  assert.match(W.linkHtml(done,now,[]),/data-link-none/,'a configuration without one says so');
  assert.match(W.linkHtml(st.rows.find(r=>r.key==='intakes.0.servo'),st,read),/data-link-nosensor/);
});

test('a port left unset says nothing; two devices put on one port do',()=>{
  const st=W.state(project(mech()));assert.doesNotMatch(st.rows.filter(r=>r.key.startsWith('intakes')).map(r=>W.mechRowHtml(r,st)).join(''),/sim-wire-problem/);
  const base=W.state(project(mech())).wiring,w=W.setPort(W.setPort(base,'intakes.0.motor','control:0','motor'),'shooters.0.motor','control:0','motor'),two=W.state(project(mech(),w));
  assert.match(W.mechRowHtml(two.rows.find(r=>r.key==='intakes.0.motor'),two),/sim-wire-problem/);
});

test('the game limit is not repeated on every device',()=>{
  const m=mech({shooter:{turretMotor2:'turretb'}}),st=W.state(project(m));for(const r of st.rows.filter(x=>x.key.includes('turret')))assert.doesNotMatch(W.mechRowHtml(r,st),/R503/);
});

test('several sensors on one part, of any kind, each with its port',()=>{
  {const st=W.state(project(mech())),row=st.rows.find(r=>r.key==='intakes.0.motor');let w=W.addSensor(st.wiring,row,'rev-color-v3');w=W.addSensor(w,row,'digital-sensor');w=W.addSensor(w,row,'axon-feedback');
    assert.deepEqual(H.wiringOf({wiring:w}).sensors.filter(s=>s.for===row.key).map(s=>s.model),['rev-color-v3','digital-sensor','axon-feedback']);const shown=W.state(project(mech(),w)),html=W.mechRowHtml(shown.rows.find(r=>r.key===row.key),shown);
    for(const t of ['REV Color Sensor V3 plugged into','Digital sensor plugged into','Axon feedback wire plugged into','+ Add another…'])assert.ok(html.includes(t),t);assert.equal((html.match(/data-wire-sensor-remove/g)||[]).length,3);}
  const st=W.state(project(mech())),row=st.rows.find(r=>r.key==='intakes.0.servo');let w=W.setMechSensor(st.wiring,row,'rev-touch');let on=H.wiringOf({wiring:w}).sensors.filter(s=>s.for===row.key);assert.equal(on.length,1);assert.equal(on[0].model,'rev-touch');
  w=W.setMechSensor(w,row,'axon-feedback');on=H.wiringOf({wiring:w}).sensors.filter(s=>s.for===row.key);assert.equal(on.length,1,'replaced');assert.equal(on[0].model,'axon-feedback');
  const shown=W.state(project(mech(),w));assert.match(W.mechRowHtml(shown.rows.find(r=>r.key===row.key),shown),/Axon feedback wire plugged into/);
  assert.equal(H.wiringOf({wiring:W.setMechSensor(w,row,'')}).sensors.filter(s=>s.for===row.key).length,0);
});

test('a shooter lights up its own assembly, not the turret it rides; a turret device lights up its gear train',()=>{
  const joints=[{id:'turret1',type:'continuous',parts:['plate'],drive:{signal:'turret',of:'shooter:0'}},{id:'turret1gear1',type:'continuous',parts:['pinion','spur'],parent:undefined},{id:'turret1gear2',type:'continuous',parts:['100t','hub']},{id:'flywheel1',type:'continuous',parts:['wheel'],parent:'turret1',drive:{signal:'flywheel',of:'shooter:0'}}];
  const p=project(mech(),null,{joints,actuators:[]}),shooter=W.focusRefs(p,'shooter:0'),turret=W.focusRefs(p,'shooters.0.turretMotor');
  assert.ok(shooter.includes('a/POLLEN V2'));assert.ok(shooter.includes('wheel'));assert.ok(!shooter.includes('a/turret final'),'not the whole turret assembly');assert.ok(!shooter.includes('plate'),'not the plate');
  assert.deepEqual(turret.sort(),['100t','hub','pinion','spur'],'the gears, not the plate or the shooter');
});

test('a part of an intake is a wheel, a claw or its body',()=>{
  for(const n of ['48mm Gecko Wheel - 15A (GB)','Intake Roller Wheel','104mm Mecanum Wheel'])assert.equal(M.partKindOf(n),'wheel',n);for(const n of ['Claw left','Parallel Gripper','Finger 2'])assert.equal(M.partKindOf(n),'claw',n);for(const n of ['FRONT RAMP','SIDE WALL','Part 1','Servo Hub (GB)'])assert.equal(M.partKindOf(n),'body',n);
});

test('an intake’s box holds every assembly on its edge, out to its outermost point, centred on the robot',()=>{
  const part=(name,x1,y0,y1,z1,x0=5)=>({name,role:'intake',box:{x0,x1,y0,y1,z0:1,z1}});
  const out=M.fromCad([{name:'frame',role:'chassis',box:{x0:-8,x1:8,y0:-8,y1:8,z0:0,z1:6}},part('rollers',9,-6,6,5),part('FRONT RAMP',11.1,-7,9.2,11.1)]),i=out.intakes[0];
  assert.equal(i.reach,3.25,'to the ramp, the furthest of the two, and never short of it');assert.equal(i.width,18.5,'wider than the chassis, and centred');assert.equal(i.height,11.25,'from the floor to its top');
});

test('a ramp runs on a DC motor, or a servo of three types',()=>{
  assert.deepEqual(W.TYPES.ramp.map(t=>t[0]),['servo','linear','crservo','dcmotor']);
  const motor=W.state(project(mech({intake:{rampKind:'dcmotor'}}))).rows.find(r=>r.key==='intakes.0.servo');assert.equal(motor.kind,'dcmotor');assert.equal(motor.family,'motor');
  const cr=W.state(project(mech({intake:{rampKind:'crservo'}}))).rows.find(r=>r.key==='intakes.0.servo');assert.equal(cr.kind,'crservo');
  assert.equal(M.sanitize({enabled:true,intakes:[{kind:'ramp',sides:['front'],rampKind:'nonsense'}]}).intakes[0].rampKind,undefined);
});

test('a second turret device and a gear train are kept, counted and sensible',()=>{
  const m=mech({shooter:{turretMotor2:'turretb'},turret:{gears:[[100,24],[20,83],['x',-1]]}});assert.equal(m.shooters[0].turretMotor2,'turretb');assert.deepEqual(m.turret.gears[0],[100,24]);assert.ok(m.turret.gears.every(g=>g.every(t=>t>=1)));
  const rows=W.state(project(m)).rows;assert.ok(rows.some(r=>r.key==='shooters.0.turretMotor2'&&r.role==='turret'&&r.kind==='servo'));assert.ok(H.parseKey('shooters.0.turretMotor2'));
});

test('exported code moves both turret servos together, and says so when it cannot run what was picked',()=>{
  const m=mech({shooter:{turretMotor2:'turretb'}}),src=F.mechanismsSource({packageName:'p'},m,{x:72,y:72},{length:17,width:17});
  assert.match(src,/turret1b = map\.get\(Servo\.class, TURRET_1B\)/);assert.match(src,/public static final String TURRET_1B = "turretb";/);assert.match(src,/private Servo turret1b;/);
  const moves=src.match(/turret1b\.setPosition\(Math\.max\(0, Math\.min\(1, position\)\)\);/g)||[];assert.equal(moves.length,1,'it follows the first servo');
  assert.throws(()=>F.mechanismsSource({packageName:'p'},mech({intake:{rampKind:'dcmotor'}}),{x:72,y:72},{length:17,width:17}),/runs a ramp or kicker on a servo/);
  assert.throws(()=>F.mechanismsSource({packageName:'p'},mech({shooter:{turretMotor2:'turretb'},turret:{kind:'motor'}}),{x:72,y:72},{length:17,width:17}),/second turret device/);
});

test('an intake takes more motors and servos: each its own port row, run with the rollers or the ramp, counted and exported',()=>{
  const m=mech({intake:{more:[{name:'intake_motor2',device:'motor',reversed:true},{name:'intake_servo2',device:'crservo'},{name:'ramp_servo2',device:'servo'},{name:'intake_motor2',device:'motor'}]}});
  assert.deepEqual(m.intakes[0].more.map(x=>x.name),['intake_motor2','intake_servo2','ramp_servo2'],'one of each name');
  const rows=W.state(project(m)).rows.filter(r=>/^intakes\.0\.more/.test(r.key));assert.deepEqual(rows.map(r=>[r.key,r.role,r.family]),[['intakes.0.more0','roller','motor'],['intakes.0.more1','roller','servo'],['intakes.0.more2','ramp','servo']]);
  const d=F.mechanismDevices(m).filter(x=>/^more/.test(x.setting.field));assert.deepEqual(d.map(x=>x.role),['roller','roller','ramp']);
  assert.deepEqual(F.mechanismHardware(m).intakes.map(x=>x.name).slice(1),['intake_motor2','intake_servo2']);
  assert.ok(!M.sanitize({enabled:true,intakes:[{kind:'sweeper',sides:['front'],more:[{name:'x1',device:'servo'}]}]}).intakes[0].more,'a sweeper has no ramp servo to move with');
  assert.ok(!M.sanitize({enabled:true,intakes:[{kind:'kicker',sides:['front'],more:[{name:'x1',device:'motor'}]}]}).intakes[0].more,'a kicker has no rollers');
});

test('a robot may hold no pollen, no nectar, or nothing at all, and then starts with nothing',()=>{
  const none=M.sanitize({enabled:true,intakes:[],shooters:[{type:'fixed',pieces:'both',mount:'back'}],capacity:{pollen:0,nectar:0},preload:{pollen:4}});
  assert.deepEqual([none.capacity,none.preload.pollen,none.storage],[{pollen:0,nectar:0},0,0]);
  const nectarOnly=M.sanitize({enabled:true,intakes:[],shooters:[{type:'fixed',pieces:'both',mount:'back'}],capacity:{pollen:0,nectar:3},preload:{pollen:2}});
  assert.deepEqual([nectarOnly.capacity,nectarOnly.preload.pollen,nectarOnly.storage],[{pollen:0,nectar:3},0,3]);
});
