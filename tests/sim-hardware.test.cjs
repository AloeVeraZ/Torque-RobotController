'use strict';
// How a robot is wired (ui/sim-hardware.js): FTC hubs and their ports, the motors, servos and sensors teams buy with the
// tag Configure Robot saves for each, what may drive each mechanism and which sensors can tell where it is, the wiring a
// robot keeps (ui/sim-config.js), an offline port plan around what the team set, and the problems in it.
const {test}=require('node:test'),assert=require('node:assert/strict');
const H=require('../ui/sim-hardware.js'),A=require('../ui/sim-actuators.js'),C=require('../ui/sim-config.js'),Mech=require('../ui/sim-mechanisms.js'),RobotConfig=require('../ui/ftc/robot-config.js');

test('the catalogue: every model with its configuration tag, Axon servos with their feedback wire, and what each role may use',()=>{
  // Every model DeckActuators knows has the tag Configure Robot saves for it, and that tag is the right kind.
  for(const m of A.ALL){assert.ok(m.xmlType,m.id);assert.equal(RobotConfig.kindOf(m.xmlType),{dcmotor:'motor',servo:'servo',linear:'servo',crservo:'crservo'}[m.kind],m.id);}
  assert.deepEqual(['gobilda-5203-312','rev-ultra-20','rev-hd-hex-40','rev-core-hex','torquenado','studica-maverick','neverest-20','neverest-60','neverest-3-7','matrix-12v','other-motor'].map(id=>H.MODELS[id].xmlType),
    ['goBILDA5202SeriesMotor','RevRoboticsUltraplanetaryHDHexMotor','RevRobotics40HDHexMotor','RevRoboticsCoreHexMotor','TetrixMotor','StudicaMaverick','NeveRest20Gearmotor','NeveRest60Gearmotor','NeveRest3.7v1Gearmotor','Matrix12vMotor','Motor']);
  // Axon servos have the 4th wire, in servo and in continuous mode; others do not. Motors read their own encoder.
  assert.deepEqual(A.ALL.filter(m=>m.feedback==='analog').map(m=>m.id),['axon-max','axon-mini','axon-micro','axon-max-cr','axon-mini-cr','axon-micro-cr']);
  assert.ok(A.MOTORS.every(m=>m.feedback==='encoder'));
  // Pre-verified for 2026-27 and new here; the Actuonix L16-R is not on the list.
  for(const id of ['studica-multimode-fast','swyft-speed','swyft-balance','swyft-torque','swyft-slim','swyft-nano','plex-speed','plex-torque','torctex-max','torctex-pro','torctex-micro','mata-torque'])assert.equal(A.MODELS[id]?.kind,'servo',id);
  assert.equal(A.MODELS['actuonix-l16-50'].legal,false);assert.equal(A.MODELS['swyft-speed'].rangeAssumed,true,'SWYFT publishes no travel');
  // Motors with no simulator numbers are for the configuration only.
  assert.equal(A.MODELS['matrix-12v'],undefined);assert.equal(H.MODELS['other-motor'].simulated,false);
  // Hubs, from REV and the FTC SDK.
  assert.deepEqual([H.HUBS.control.motor,H.HUBS.control.servo,H.HUBS.control.analog,H.HUBS.control.digital,H.HUBS.control.i2c,H.HUBS.control.imuBus],[4,6,4,8,4,0]);
  assert.deepEqual([H.HUBS.servoHub.servo,H.HUBS.servoHub.motor,H.HUBS.servoHub.servoVolts,H.HUBS.control.servoVolts],[6,0,6,5]);assert.deepEqual(H.HUBS.expansion.fastEncoders,[0,3]);
  // Each sensor's tag reads back as its kind of device.
  for(const s of H.SENSORS)if(s.xmlType)assert.equal(RobotConfig.kindOf(s.xmlType),{analog:'analog',i2c:{color:'color',distance:'distance',octoquad:'octoquad'}[s.kind],digital:s.kind==='touch'?'touch':'digital'}[s.family],s.id);
  assert.equal(H.SENSOR_MODELS['rev-touch'].channels,'odd');assert.equal(H.SENSOR_MODELS['rev-potentiometer'].channels,'even');assert.equal(H.SENSOR_MODELS['rev-through-bore'].cpr,8192);
  // Roles: a flywheel reads its speed only from its motor's encoder; a turret may be a motor, a servo or a continuous servo;
  // a hood is a servo; every role says what it does.
  const kinds=role=>H.sensorsFor(role).map(s=>s.kind);
  assert.deepEqual([...new Set(H.sensorsFor('flywheel').filter(s=>H.ROLES.flywheel.sensors[s.kind]==='velocity').map(s=>s.kind))],['motorEncoder'],'speed only from its motor encoder');assert.ok(kinds('flywheel').includes('color'),'a piece sensor at the flywheel');assert.ok(['throughBore','axonFeedback','touch','motorEncoder'].every(k=>kinds('turret').includes(k)));assert.ok(!kinds('turret').includes('potentiometer'),'270° is short of a turret');
  assert.deepEqual(H.ROLES.turret.kinds,['dcmotor','servo','crservo']);assert.ok(H.modelsFor('hood').every(m=>m.kind==='servo'||m.kind==='linear'));assert.ok(H.modelsFor('hood').some(m=>m.id==='axon-max'));
  assert.ok(H.modelsFor('flywheel').every(m=>m.kind==='dcmotor')&&H.modelsFor('roller').some(m=>m.kind==='crservo'));
  for(const [id,r] of Object.entries(H.ROLES))if(id!=='sensor')assert.ok(r.explain.length>20,id);
});

test('setting keys and the wiring a robot keeps: unknown keys and models dropped, ports held to the hub, a port claimed twice kept for Setup to show red',()=>{
  assert.deepEqual([{robot:'frontLeft'},{list:'shooters',index:1,field:'hood'},{kin:'lift_motor'},{sensor:'liftHome'}].map(H.settingKey),['robot.frontLeft','shooters.1.hood','kin.lift_motor','sensor.liftHome']);
  assert.deepEqual(['robot.nothing','shooters.0.wheel','intakes.9.motor','kin.2bad',null].map(H.parseKey),[null,null,null,null,null]);assert.deepEqual(H.parseKey('intakes.1.servo'),{list:'intakes',index:1,field:'servo'});
  const raw={hubs:{expansion:{address:173},servoHub:{address:2}},devices:{
    'robot.frontLeft':{model:'gobilda-5203-312',hub:'control',port:0},'robot.frontRight':{hub:'control',port:0},'robot.par':{hub:'control',port:0},'robot.pinpoint':{hub:'control',port:7},
    'shooters.0.hood':{model:'axon-max',hub:'servoHub',port:9},'shooters.0.motor':{model:'not-a-motor',hub:'servoHub',port:1},'intakes.0.motor':{hub:'moon',port:1},'nonsense.key':{hub:'control',port:1},'kin.lift':{model:'gobilda-5203-435'}},
    sensors:[{id:'hoodAngle',model:'axon-feedback',for:'shooters.0.hood',hub:'control',port:6},{id:'hoodAngle',model:'rev-touch',for:'shooters.0.hood'},{id:'bad',model:'mystery',for:'shooters.0.hood'},{id:'nowhere',model:'rev-touch',for:'sensor.hoodAngle'},
      {id:'flyEnc',model:'motor-encoder',for:'shooters.0.motor',hub:'control',port:2},{id:'liftHome',model:'rev-touch',for:'kin.lift',hub:'servoHub',port:1,name:'lift home',inverted:true,zeroVolts:9},{id:'slot',model:'rev-color-v3',for:'intakes.0.motor',hub:'control',bus:1,voltsPerUnit:0}]};
  const w=C.robot({wiring:raw}).wiring;
  assert.deepEqual(w.hubs,{expansion:{address:2},servoHub:{address:3}},'173 is the Control Hub; the Servo Hub moves off the Expansion Hub’s address');
  assert.deepEqual(w.devices,{'robot.frontLeft':{model:'gobilda-5203-312',hub:'control',port:0},'robot.frontRight':{hub:'control',port:0},'robot.par':{hub:'control',port:0},'robot.pinpoint':{hub:'control',bus:3},
    'shooters.0.hood':{model:'axon-max',hub:'servoHub',port:5},'kin.lift':{model:'gobilda-5203-435'}},'front right keeps front left’s port (a conflict); a pod may share it (read through that name)');
  const both=H.conflicts(H.rows({robot:C.robot({wiring:{devices:{'robot.frontLeft':{hub:'control',port:0},'robot.frontRight':{hub:'control',port:0}}}}),sensors:{localization:'encoders'}}),{devices:{'robot.frontLeft':{hub:'control',port:0},'robot.frontRight':{hub:'control',port:0}}});
  assert.ok(both.some(x=>x.level==='red'&&x.keys.includes('robot.frontRight')&&/Control Hub motor port 0 is used by/.test(x.text)),'two drive motors on one port are red');
  assert.deepEqual(w.sensors,[{id:'hoodAngle',model:'axon-feedback',for:'shooters.0.hood',use:'position',hub:'control',port:3},{id:'flyEnc',model:'motor-encoder',for:'shooters.0.motor',use:'velocity'},
    {id:'liftHome',model:'rev-touch',for:'kin.lift',use:'home',name:'lift home',inverted:true},{id:'slot',model:'rev-color-v3',for:'intakes.0.motor',use:'piece',hub:'control',bus:1}],'a Servo Hub has no sensor ports; a motor encoder is on its motor');
  assert.deepEqual(H.sanitizeWiring(w),w,'sanitizing again changes nothing');assert.deepEqual(C.robot(C.robot({wiring:raw})).wiring,w);
  // Nothing set: no wiring kept, and an old robot loads as it did.
  const old={drivetrain:'tank',length:18,devices:{frontLeft:{name:'lf'}}};assert.equal('wiring' in C.robot(old),false);assert.equal(H.sanitizeWiring({hubs:{},devices:{},sensors:[]}),null);
  for(const junk of [null,5,'x',[],{devices:[1,2]},{sensors:'x'},{hubs:5,devices:{'robot.imu':null}}])assert.doesNotThrow(()=>H.sanitizeWiring(junk));
  assert.deepEqual(H.wiringOf({}),{hubs:{expansion:null,servoHub:null},devices:{},sensors:[]});
  assert.equal(H.sanitizeWiring({sensors:Array.from({length:40},(_,i)=>({id:'s'+i,model:'rev-touch',for:'robot.frontLeft'}))}).sensors.length,32);
  // Removing intake 1 moves intake 2's wiring down; its own devices and sensors go. Pruning drops a part no longer there.
  const two={devices:{'intakes.0.motor':{model:'gobilda-5203-1150'},'intakes.1.servo':{model:'axon-mini',hub:'control',port:4}},sensors:[{id:'a',model:'rev-color-v3',for:'intakes.0.motor'},{id:'b',model:'axon-feedback',for:'intakes.1.servo'}]};
  const after=H.reindex(two,'intakes',0);assert.deepEqual(after.devices,{'intakes.0.servo':{model:'axon-mini',hub:'control',port:4}});assert.deepEqual(after.sensors.map(s=>[s.id,s.for]),[['b','intakes.0.servo']]);
  assert.deepEqual(H.prune({devices:{'kin.a':{model:'axon-max'},'kin.b':{model:'axon-max'}}},k=>k!=='kin.b').devices,{'kin.a':{model:'axon-max'}});
  // A shooter's hood servo is kept by name; none: the hood is fixed.
  const m=Mech.sanitize({enabled:true,shooters:[{type:'turret',hood:' hood '},{type:'fixed',hood:'2 bad'}]});assert.deepEqual(m.shooters.map(s=>s.hood),['hood',undefined]);
});

// A mecanum robot on a Pinpoint with a ramp intake, a turret shooter with a hood, and a lift, wired in part.
const project=(wiring)=>({robot:C.robot({drivetrain:'mecanum',wiring}),sensors:{localization:'fused'},
  mechanisms:Mech.sanitize({enabled:true,intakes:[{kind:'ramp',sides:['front'],motor:'intake',servo:'ramp',parts:['RAMP']}],shooters:[{type:'turret',mount:'center',motor:'shooter',indexer:'indexer',turretMotor:'turret',hood:'hood',parts:['TURRET']}]}),
  kinematics:{joints:[{id:'turretJ',drive:{signal:'turret',of:'shooter:0'}},{id:'hoodJ',drive:{signal:'hood',of:'shooter:0'}},{id:'rampJ',drive:{signal:'deploy',of:'intake:0'}},{id:'lift',name:'Lift'}],
    actuators:[{id:'liftMotor',name:'Lift',joint:'lift',kind:'dcmotor',model:'gobilda-5203-435',device:'lift'},{id:'turretActuator',name:'Turret',joint:'turretJ',kind:'dcmotor'}]}});
const WIRING={hubs:{expansion:{address:2}},devices:{'shooters.0.hood':{model:'axon-max',hub:'control',port:2},'shooters.0.motor':{model:'gobilda-5203-6000'}},
  sensors:[{id:'hoodAngle',model:'axon-feedback',for:'shooters.0.hood',hub:'control',port:0},{id:'turretHome',model:'rev-touch',for:'shooters.0.turretMotor'},{id:'turretTb',model:'rev-through-bore',for:'shooters.0.turretMotor'},
    {id:'flyEnc',model:'motor-encoder',for:'shooters.0.motor'},{id:'liftHome',model:'limit-switch',for:'kin.liftMotor'}]};

test('rows: every device the robot needs, with its role, model, port, sensors and the parts it moves',()=>{
  const rows=H.rows(project(WIRING)),row=key=>rows.find(r=>r.key===key);
  assert.deepEqual(rows.map(r=>[r.key,r.role,r.family,r.name]),[['robot.frontLeft','drive','motor','front_left'],['robot.frontRight','drive','motor','front_right'],['robot.backLeft','drive','motor','back_left'],['robot.backRight','drive','motor','back_right'],
    ['robot.imu','imu','i2c','imu'],['robot.pinpoint','pinpoint','i2c','pinpoint'],['intakes.0.motor','roller','motor','intake'],['intakes.0.servo','ramp','servo','ramp'],['shooters.0.motor','flywheel','motor','shooter'],
    ['shooters.0.indexer','feeder','motor','indexer'],['shooters.0.turretMotor','turret','motor','turret'],['shooters.0.hood','hood','servo','hood'],['kin.liftMotor','kin-motor','motor','lift'],
    ['sensor.hoodAngle','sensor','analog','hoodPosition'],['sensor.turretHome','sensor','digital','turretHome'],['sensor.turretTb','sensor','encoder','turretEncoder'],['sensor.liftHome','sensor','digital','liftHome']],'a game-driven joint’s actuator is the turret row, not a part of its own');
  const hood=row('shooters.0.hood');assert.deepEqual([hood.model,hood.xmlType,hood.hub,hood.port,hood.wired,hood.joints,hood.parts],['axon-max','Servo','control',2,true,['hoodJ'],['TURRET']]);
  assert.deepEqual(hood.sensors,[{id:'hoodAngle',model:'axon-feedback',kind:'axonFeedback',use:'position',hub:'control',port:0}]);
  assert.deepEqual(row('shooters.0.motor').sensors.map(s=>[s.kind,s.use]),[['motorEncoder','velocity']],'a flywheel reads its speed from its own encoder');
  assert.deepEqual([row('shooters.0.turretMotor').joints,row('intakes.0.servo').joints,row('kin.liftMotor').joints,row('sensor.turretHome').joints],[['turretJ'],['rampJ'],['lift'],['turretJ']]);
  assert.deepEqual([row('shooters.0.motor').encoder,row('intakes.0.motor').encoder,row('robot.frontLeft').encoder,row('shooters.0.turretMotor').encoder,row('kin.liftMotor').encoder],[true,false,false,false,true],
    'a roller runs on power; drive encoders are not read with a Pinpoint; the turret’s Through Bore reads it in place of its motor’s encoder');
  assert.deepEqual([row('sensor.turretTb').device,row('sensor.turretTb').xmlType,row('sensor.turretHome').channels,row('sensor.hoodAngle').need],['motor','Motor','odd','analog']);
  // The export's rows can come in instead of DeckSimFtc's, and Setup's wiring rides on them for the robot's check.
  const wired=H.wire([{name:'hood',need:'servo',device:'servo',label:'Hood',setting:{list:'shooters',index:0,field:'hood'}},{name:'x',need:'motor',label:'X',setting:{robot:'frontLeft'}}],WIRING);
  assert.deepEqual(wired[0],{name:'hood',need:'servo',device:'servo',label:'Hood',setting:{list:'shooters',index:0,field:'hood'},wired:{hub:'control',port:2},model:'axon-max',xmlType:'Servo'});assert.equal(wired[1].wired,undefined);
});

test('an offline plan: drive motors on the Control Hub, other motors on the Expansion Hub, servos on the Control Hub, sensors by REV’s channel rules',()=>{
  const rows=H.rows(project(WIRING)),{assign,problems}=H.plan(rows,WIRING),at=key=>assign[key]?.label;
  assert.deepEqual(rows.map(r=>[r.key,at(r.key)]),[['robot.frontLeft','Control Hub motor port 0'],['robot.frontRight','Control Hub motor port 1'],['robot.backLeft','Control Hub motor port 2'],['robot.backRight','Control Hub motor port 3'],
    ['robot.imu','Control Hub I2C bus 0'],['robot.pinpoint','Control Hub I2C bus 1'],['intakes.0.motor','Expansion Hub motor port 0'],['intakes.0.servo','Control Hub servo port 0'],['shooters.0.motor','Expansion Hub motor port 1'],
    ['shooters.0.indexer','Expansion Hub motor port 2'],['shooters.0.turretMotor','Expansion Hub motor port 3'],['shooters.0.hood','Control Hub servo port 2'],['kin.liftMotor',undefined],
    ['sensor.hoodAngle','Control Hub analog port 0'],['sensor.turretHome','Expansion Hub digital port 1'],['sensor.turretTb','Expansion Hub encoder port 3'],['sensor.liftHome','Control Hub digital port 0']]);
  assert.equal(assign['shooters.0.hood'].wired,true);assert.equal(assign['robot.frontLeft'].wired,false);
  // The Through Bore on the turret is plugged into the turret motor's own encoder input (port 3 counts in hardware): the
  // robot reads it through "turret", whose own encoder is then not used.
  assert.equal(assign['sensor.turretTb'].via,'turret');
  assert.deepEqual(problems,[{level:'amber',keys:['kin.liftMotor'],text:'No motor port is free for Lift. Run a roller on a continuous servo, or free a motor port.',port:true}]);
  // Deterministic, and the same with no Expansion Hub says to add one; a Servo Hub takes servos past the Control Hub's six.
  assert.deepEqual(H.plan(rows,WIRING),H.plan(rows,WIRING));
  const alone=H.plan(rows,{devices:WIRING.devices});assert.match(alone.problems.map(p=>p.text).join('\n'),/No motor port is free for Intake 1 roller\. Add an Expansion Hub/);
  const servos=Array.from({length:8},(_,i)=>({key:`kin.s${i}`,label:`S${i}`,role:'kin-servo',family:'servo',kind:'servo',name:`s${i}`}));
  assert.deepEqual(Object.values(H.plan(servos,{hubs:{servoHub:{address:4},expansion:{}}}).assign).map(a=>a.label).slice(5),['Control Hub servo port 5','Servo Hub 4 servo port 0','Servo Hub 4 servo port 1']);
  // A REV potentiometer on an even analog channel, a fast encoder on port 0 or 3 first, a second touch sensor on the next odd channel.
  const sensors=[{key:'a',label:'A',role:'sensor',family:'analog',kind:'axonFeedback',name:'a'},{key:'b',label:'B',role:'sensor',family:'analog',kind:'potentiometer',channels:'even',name:'b'},
    {key:'c',label:'C',role:'sensor',family:'digital',kind:'touch',channels:'odd',name:'c'},{key:'d',label:'D',role:'sensor',family:'digital',kind:'touch',channels:'odd',name:'d'},
    {key:'e',label:'E',role:'sensor',family:'encoder',kind:'throughBore',fast:true,name:'e'},{key:'f',label:'F',role:'sensor',family:'encoder',kind:'throughBore',fast:true,name:'f'}];
  assert.deepEqual(Object.values(H.plan(sensors,null).assign).map(a=>a.label),['Control Hub analog port 0','Control Hub analog port 2','Control Hub digital port 1','Control Hub digital port 3','Control Hub encoder port 0','Control Hub encoder port 3']);
  // Two continuous servos read through one OctoQuad: one I2C device ("octoquad"), a channel each.
  const swerve={robot:{wiring:{sensors:[{id:'qa',model:'octoquad',for:'kin.a',hub:'control',bus:2,channel:5},{id:'qb',model:'octoquad',for:'kin.b'}]}},
    kinematics:{joints:[{id:'j'}],actuators:[{id:'a',name:'A',joint:'j',kind:'crservo'},{id:'b',name:'B',joint:'j',kind:'crservo'}]}},octo=H.rows(swerve,[]);
  assert.deepEqual(octo.filter(r=>r.role==='sensor').map(r=>r.name),['octoquad','octoquad']);
  const oq=H.plan(octo,swerve.robot.wiring).assign;assert.deepEqual(['sensor.qa','sensor.qb'].map(k=>oq[k].label),['Control Hub I2C bus 2, channel 5','Control Hub I2C bus 2, channel 0']);
  assert.deepEqual(H.conflicts(octo,swerve.robot.wiring),[],'an absolute encoder on each continuous servo');
});

test('problems: two devices on one port, a model that is not what the mechanism runs on, REV’s channel rules, a sensor that cannot read a flywheel',()=>{
  const wiring={hubs:{expansion:{address:2}},devices:{'intakes.0.motor':{hub:'expansion',port:1},'shooters.0.turretMotor':{hub:'expansion',port:1},'shooters.0.indexer':{model:'axon-max-cr'},'shooters.0.hood':{model:'actuonix-l16-50'},'intakes.0.servo':{model:'gobilda-torque'}},
    sensors:[{id:'flyTb',model:'rev-through-bore',for:'shooters.0.motor',hub:'expansion',port:2},{id:'home',model:'rev-touch',for:'shooters.0.turretMotor',hub:'control',port:2},{id:'pot',model:'rev-potentiometer',for:'intakes.0.servo',hub:'control',port:1},
      {id:'ghost',model:'rev-color-v3',for:'shooters.1.indexer'},{id:'axon',model:'axon-feedback',for:'intakes.0.servo',hub:'control',port:3}]};
  const p=project(wiring),texts=H.conflicts(H.rows(p),p.robot.wiring).map(x=>`${x.level}: ${x.text}`);
  for(const want of ['red: Expansion Hub motor port 1 is used by Intake 1 roller and Shooter 1 turret.',
    'red: Shooter 1 feeder is set to run on a motor, but its model, Axon MAX (continuous), is a continuous servo.',
    'amber: Actuonix L16-R 50 mm on Shooter 1 hood is not on the 2026-27 pre-verified list: bring its data sheet to inspection.',
    'red: Shooter 1 flywheel: only its motor’s own encoder can read its speed (a REV Through Bore overflows the hub’s speed reading).',
    'red: Shooter 1 turret: REV Touch Sensor is on Control Hub digital port 2; it reads only on odd digital channels (1, 3, 5 and 7).',
    'red: Intake 1 ramp: REV Potentiometer is on Control Hub analog port 1; it reads only on even analog channels (0 and 2).',
    'amber: Shooter 1 flywheel: REV Through Bore is on Expansion Hub encoder port 2: ports 1 and 2 count in software and can miss counts from a Through Bore. Use encoder port 0 or 3.',
    'amber: shooters.1.indexer: REV Color Sensor V3 measures a device this robot no longer has.',
    'amber: Intake 1 ramp: Axon feedback wire: goBILDA Torque servo has no feedback wire; pick an Axon for intake 1 ramp, or another sensor.'])assert.ok(texts.includes(want),want+'\n'+texts.join('\n'));
  // A continuous servo turret needs a sensor that tells where it is; the IMU's bus is the hub's own.
  const cr=H.conflicts([{key:'shooters.0.turretMotor',label:'Shooter 1 turret',role:'turret',family:'servo',kind:'crservo',name:'turret'},{key:'robot.imu',label:'IMU',role:'imu',family:'i2c',kind:'imu',name:'imu'},
    {key:'robot.pinpoint',label:'goBILDA Pinpoint',role:'pinpoint',family:'i2c',kind:'pinpoint',name:'pinpoint',hub:'control',bus:0}],null).map(x=>x.text);
  assert.ok(cr.includes('Shooter 1 turret turns on a continuous servo: give it a sensor that tells where it is (an Axon’s feedback wire or an absolute encoder), or it can only run for set times.'),cr.join('\n'));
  assert.ok(cr.includes('Control Hub I2C bus 0 has the hub’s own IMU; goBILDA Pinpoint cannot go there.'),cr.join('\n'));
  // Nothing set by hand: no problems on a robot that fits its hubs.
  const plain=project({hubs:{expansion:{}}});plain.kinematics.actuators=[];assert.deepEqual(H.conflicts(H.rows(plain),plain.robot.wiring),[]);
});

test('plain words for each device: what it is, where it is plugged in and what its sensors tell',()=>{
  const p=project(WIRING),rows=H.placed(H.rows(p),p.robot.wiring),say=key=>H.explain(rows.find(r=>r.key===key),p.robot.wiring);
  assert.equal(say('shooters.0.hood'),'Axon MAX "hood" on Control Hub servo port 2; its feedback wire on analog port 0 tells where shooter 1 hood is.');
  assert.equal(say('shooters.0.motor'),'goBILDA 6000 rpm (1:1) "shooter" on Expansion Hub motor port 1; its encoder tells how fast shooter 1 flywheel spins.');
  assert.equal(say('sensor.turretTb'),'REV Through Bore "turretEncoder" on Expansion Hub encoder port 3. It tells where shooter 1 turret is. It is read through "turret", the motor on that port.');
  assert.equal(say('sensor.turretHome'),'REV Touch Sensor "turretHome" on Expansion Hub digital port 1. It tells when shooter 1 turret is at its zero.');
  assert.equal(say('robot.imu'),'IMU "imu": the Control Hub’s own IMU, on I2C bus 0. It tells which way the robot faces.');
  assert.equal(say('kin.liftMotor'),'goBILDA 435 rpm (13.7:1) "lift": Deck picks its port; a limit switch tells when lift is at its zero.');
  assert.match(H.explain({key:'kin.x',label:'Arm',role:'kin-motor',family:'motor',kind:'dcmotor',name:'arm'}),/^Motor "arm": Deck picks its port\. Runs to encoder counts/);
  assert.deepEqual([rows.find(r=>r.key==='robot.frontLeft').planned,rows.find(r=>r.key==='shooters.0.hood').planned],[true,undefined]);
});

test('motors and servos named in a CAD: the model from part numbers and names, and which mechanism each one drives',()=>{
  const n=x=>H.fromCadName(x);
  assert.deepEqual(n('5203 Series Yellow Jacket Planetary Gear Motor (19.2:1 Ratio, 312 RPM) 5203-2402-0019'),{kind:'dcmotor',model:'gobilda-5203-312'});
  assert.deepEqual(n('goBILDA Yellow Jacket 6000 RPM'),{kind:'dcmotor',model:'gobilda-5203-6000'});assert.deepEqual(n('REV-41-1300 Core Hex Motor'),{kind:'dcmotor',model:'rev-core-hex'});
  assert.deepEqual(n('2000-0025-0002 Dual Mode Servo'),{kind:'servo',model:'gobilda-torque'});assert.deepEqual(n('axon mini continuous'),{kind:'crservo',model:'axon-mini-cr'});
  assert.deepEqual(n('Ramp servo'),{kind:'servo',model:null});assert.equal(n('Servo Hub Shaft - 16mm (GB)'),null);assert.equal(n('Motor Mount Plate'),null);
  const S='Robot/Shooter',parts=[{name:'Turret motor',key:'Robot/Chassis/Turret motor',path:['Robot','Chassis'],kind:'dcmotor',model:'gobilda-5203-435'},
    {name:'Flywheel motor',key:S+'/Flywheel motor',path:['Robot','Shooter'],kind:'dcmotor',model:'gobilda-5203-6000'},{name:'Kicker servo',key:S+'/Kicker servo',path:['Robot','Shooter'],kind:'servo',model:null},
    {name:'Hood servo',key:S+'/Hood servo',path:['Robot','Shooter'],kind:'servo',model:'axon-max'}];
  const d=(key,role,family)=>({key,role,family,scope:[S],own:[]});
  const got=Object.fromEntries(H.assignCad(parts,[d('shooters.0.turretMotor','turret','motor'),d('shooters.0.motor','flywheel','motor'),d('shooters.0.indexer','feeder','servo'),d('shooters.0.hood','hood','servo')]).map(x=>[x.key,x.part]));
  assert.deepEqual(got,{'shooters.0.motor':'Flywheel motor','shooters.0.turretMotor':'Turret motor','shooters.0.indexer':'Kicker servo','shooters.0.hood':'Hood servo'},'a turret motor mounted on the chassis still turns the turret');
});

test('an FTC robot can only be given what the Control Hub lets you configure',()=>{
  const legal=new Set(Object.values(RobotConfig.DEVICE_TYPES).flat().map(([tag])=>tag));
  for(const m of H.ACTUATORS)assert.ok(legal.has(m.xmlType),m.id);
  for(const s of H.SENSORS)if(s.xmlType)assert.ok(legal.has(s.xmlType),s.id);
  assert.ok(!H.ACTUATORS.concat(H.SENSORS).some(p=>/stepper|rplidar/i.test(p.name)));
});
