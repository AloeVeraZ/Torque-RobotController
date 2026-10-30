'use strict';
// What drives a mechanism that has no motor of its own in the CAD: its pulleys followed through belts, shared shafts and
// gears to a motor elsewhere (DeckHardware.driveTrain), as on a student robot whose intake and indexer run on two motors
// in the chassis; mechanisms belted to one motor counted once against BIOBUZZ R503 (red when over); and Set up from the
// Control Hub giving the robot's one device to both of them.
const {test}=require('node:test'),assert=require('node:assert/strict');
const H=require('../ui/sim-hardware.js'),HS=require('../ui/sim-hub-setup.js'),RC=require('../ui/ftc/robot-config.js'),M=require('../ui/sim-mechanisms.js'),C=require('../ui/sim-config.js'),T=require('../ui/sim-test-robot.js');

// The student robot's intake drive, in inches, as its STEP import has it: a motor in the chassis, a 15T pulley on its
// shaft, a belt up to a 25T + 19T pulley pair on one shaft, a long belt to the intake's 31T pulley, the intake's own belt,
// and a mecanum wheel beside the intake's last pulley (touching its box, on another axle).
const at=(key,name,box)=>({ref:'#'+key,key:`robot/${key}`,name,box});
const INTAKE=[
  at('drivetrain/m1','Motor Part',[-9.68,1.8,4.42,-6.57,3.25,5.86]),
  at('drivetrain/p15','GT2 2mm 15t (3.175mm Bore) Pulley',[-10.36,2.29,4.9,-9.66,2.76,5.37]),
  at('drivetrain/b1','Belt',[-10.26,1.07,4.94,-10.02,2.73,6.98]),
  at('drivetrain/p25','[LS] Pulley 2mm Pitch 25T',[-10.35,1.01,6.27,-9.92,1.78,7.03]),
  at('drivetrain/p19','[LS] Pulley 2mm Pitch 19T',[-10.91,1.09,6.35,-10.48,1.7,6.96]),
  at('b2','Belt',[-10.79,-5,6.4,-10.55,1.65,9.56]),
  at('intake/p31a','[LS] Pulley 2mm Pitch 31T',[-10.87,-5.05,8.71,-10.48,-4.14,9.62]),
  at('intake/p31b','[LS] Pulley 2mm Pitch 31T',[-11.7,-5.05,8.71,-11.3,-4.14,9.62]),
  at('intake/b3','Belt',[-11.62,-6.08,6.7,-11.38,-4.19,9.56]),
  at('intake/p30','[LS] Pulley 2mm Pitch 30T',[-11.67,-6.09,6.69,-11,-5.29,7.49]),
  at('drivetrain/wheel','104mm Mecanum Wheel (GB)',[-11.7,-5.37,3.84,-10.21,-1.31,7.92])];
// A drive motor geared to that wheel through a pinion and a 108T gear on the wheel's axle.
const DRIVE=[
  at('drivetrain/m2','Motor Part',[-9.68,-2.39,4.42,-6.57,-0.94,5.86]),
  at('drivetrain/pinion','1/8" Bore 32 Pitch Shaft Mount Pinion Gear (Steel) 9 Tooth',[-10.07,-1.84,4.97,-9.66,-1.5,5.31]),
  at('drivetrain/g108','2302 Series Aluminum, MOD 0.8, Hub Mount Gear (14mm Bore, 108 Tooth)',[-10.09,-5.08,4.15,-9.86,-1.62,7.62])];

test('the intake with no motor of its own is driven by the chassis motor its belts lead to, not the drive motor beside it',()=>{
  const t=H.driveTrain([...INTAKE,...DRIVE]),hit=t.from(['robot/intake']);
  assert.equal(t.actuators.length,2);
  assert.equal(t.actuators.find(a=>a.key==='robot/drivetrain/m2').drive,true,'geared to the mecanum wheel');
  assert.equal(t.actuators.find(a=>a.key==='robot/drivetrain/m1').drive,false,'the wheel beside the intake pulley is on another axle');
  assert.equal(hit.actuator.key,'robot/drivetrain/m1');assert.equal(hit.actuator.kind,'dcmotor');assert.equal(hit.belts,2);
  // A motor the team already gave to another device is passed over; nothing else drives the intake.
  assert.equal(t.from(['robot/intake'],{skip:a=>a.key==='robot/drivetrain/m1'}),null);
  // Without the long belt nothing leads out of the intake.
  assert.equal(H.driveTrain([...INTAKE.filter(p=>p.key!=='robot/b2'),...DRIVE]).from(['robot/intake']),null);
});

test('a motor’s bracket, plate or pinion is not a motor; a motor in pieces is one',()=>{
  for(const n of ['UltraPlanetary Outside Mounting Bracket (REV-41-1621)','UltraPlanetary 550 Motor Plate (REV-41-1607)','UltraPlanetary 550 Motor Pinion Gear - 13 Tooth (REV-41-1608)'])assert.equal(H.fromCadName(n),null,n);
  assert.deepEqual(H.fromCadName('REV-41-1300'),{kind:'dcmotor',model:'rev-core-hex'});
  const t=H.driveTrain([at('m','Motor Part',[0,0,0,3,1.4,1.4]),at('s','Motor Sleeve',[1,-.01,-.01,2,1.41,1.41]),at('p','20t Gt2-2 Pulley',[3,.4,.4,3.5,1,1])]);
  assert.equal(t.actuators.length,1);
});

test('mechanisms belted to one motor count once against R503; over the limit is red but does not hold the steps after it',()=>{
  const row=(key,name,family='motor',role='roller')=>({key,name,family,role,kind:family==='motor'?'dcmotor':'servo'});
  const drive=['frontLeft','frontRight','backLeft','backRight'].map(k=>row('robot.'+k,k,'motor','drive'));
  const mech=[row('intakes.0.motor','intake'),row('shooters.0.motor','shooter','motor','flywheel'),row('shooters.1.motor','shooter2','motor','flywheel'),row('shooters.0.indexer','indexer','motor','feeder')];
  const limit=list=>H.conflicts(list,null).filter(p=>/R503/.test(p.text));
  assert.deepEqual(limit([...drive,...mech,row('shooters.1.indexer','indexer','motor','feeder')]),[],'the two feeders share “indexer”: 8 motors');
  const over=limit([...drive,...mech,row('shooters.1.indexer','indexer2','motor','feeder')]);
  assert.equal(over.length,1);assert.equal(over[0].level,'limit');assert.match(over[0].text,/9 motors; the game allows 8 \(R503\)\. Take 1 off/);
});

test('a servo in the CAD that powers nothing modelled counts against R503; a motor’s stray pieces do not',()=>{
  const parts=[{name:'Servo - Speed (SWYFT)',key:'a/indexer final <1>/s',path:['main assembly','indexer final <1>'],kind:'servo',model:'swyft-speed'},{name:'Motor Sleeve',key:'a/drivetrain <1>/m',path:['main assembly','drivetrain <1>'],kind:'dcmotor',model:null},{name:'Mini Servo',key:'a/turret/s',path:['main assembly','turret'],kind:'crservo',model:'axon-mini-cr'}];
  const others=H.cadOthers(parts,[{key:'shooters.0.turretMotor',ref:'a/turret/s'}]);
  assert.deepEqual(others,[{name:'Servo - Speed (SWYFT)',kind:'servo',model:'swyft-speed',in:'indexer final'}]);
  assert.deepEqual(M.sanitize({others}).others,others,'kept with the mechanisms');
  const servo=n=>({key:'s'+n,name:'s'+n,family:'servo',role:'hood',kind:'servo'}),limit=(n,o)=>H.conflicts(Array.from({length:n},(_,i)=>servo(i)),null,{others:o}).filter(p=>/R503/.test(p.text));
  assert.deepEqual(limit(7,others),[],'7 and this one: 8 servos');
  assert.match(limit(8,others)[0].text,/9 servos; the game allows 8 \(R503\)\. Take 1 off/);
});

test('a device the CAD does not show never makes a legal robot illegal; one the team picked counts',()=>{
  const motor=(n,extra={})=>({key:'m'+n,name:'m'+n,label:'Mechanism '+n,family:'motor',role:'roller',kind:'dcmotor',...extra}),list=[...Array.from({length:8},(_,i)=>motor(i)),motor(8),motor(9)],guessed=['m8','m9'];
  const said=H.conflicts(list,null,{guessed});
  assert.ok(!said.some(p=>p.level==='limit'),'8 found and 2 guessed is not over');
  const check=said.find(p=>p.check);assert.equal(check.level,'amber');assert.match(check.text,/does not show what powers mechanism 8, mechanism 9/);
  const picked=H.conflicts([...list.slice(0,9),motor(9,{model:'gobilda-5203-435'})],null,{guessed});
  assert.match(picked.find(p=>p.level==='limit').text,/The robot has 9 motors/);
  assert.equal(H.conflicts(list.slice(0,8),null,{guessed}).some(p=>p.check),false,'nothing to check at the limit');
});

test('mechanisms chained to one motor: the check follows belts to a motor another mechanism is named on, not parts that only touch',()=>{
  const box=(x,y=0)=>[x,y,0,x+1,y+1,1],parts=[at('m','5203 Series Yellow Jacket Motor 435rpm',box(0)),at('p1','20t Pulley',box(1)),at('b','Belt',[2,0,0,3,1,1]),at('p2','20t Pulley',box(3))];
  const train=H.driveTrain(parts),all=()=>true;
  const hit=H.chainOf(train,['robot/p2'],all);
  assert.equal(hit?.actuator.kind,'dcmotor');assert.equal(hit.belts,1);
  assert.equal(H.chainOf(train,['robot/p2'],a=>a.kind==='servo'),null,'a roller does not chain to a servo');
  const far={from:()=>({actuator:{id:1},belts:8,hops:28})};assert.equal(H.chainOf(far,['x'],all),null,'28 links is parts touching, not a drive');
  assert.equal(M.chained({intakes:[{motor:'shared'}],shooters:[{indexer:'shared'}]}),true);
  assert.equal(M.chained({intakes:[{motor:'intake'}],shooters:[{indexer:'indexer'}]}),false);
});

test('a gear train by several kinds of evidence: spaced-out gears are checked, gears side by side in other planes are not linked',()=>{
  const motor=at('m','5203 Series Yellow Jacket Motor 435rpm',[-4,-.5,-.5,0,.5,.5]),drive=at('d','24t Pinion Gear',[0,-1,-1,.5,1,1]);
  const gear=(x,y)=>at('g','100t Gear',[x,y-2,-2,x+.5,y+2,2]),any=()=>true;
  // In mesh: sure.
  let r=H.powerOf(H.driveTrain([motor,drive,gear(0,3)]),[],['robot/g'],any);assert.equal(r.sure,true);assert.equal(r.actuators[0].kind,'dcmotor');
  // 20% too far apart in the CAD (it lines up once built): found, and said to be checked.
  r=H.powerOf(H.driveTrain([motor,drive,gear(0,3.6)]),[],['robot/g'],any);assert.equal(r.sure,false);assert.equal(r.actuators[0].kind,'dcmotor');
  // Side by side, in another plane, driving something else: nothing.
  assert.equal(H.powerOf(H.driveTrain([motor,drive,gear(3,3)]),[],['robot/g'],any),null);
  // Bevels at right angles, named as bevels: sure. The same pair not named: loose.
  const upright=n=>at('g',n,[.1,-1,.5,2,1,1]);
  const flat=n=>at('d',n,[0,-1,-1,.5,1,1]);
  assert.equal(H.powerOf(H.driveTrain([motor,flat('Bevel Gear'),upright('Bevel Gear')]),[],['robot/g'],any).sure,true);
  assert.equal(H.powerOf(H.driveTrain([motor,flat('24t Gear'),upright('24t Gear')]),[],['robot/g'],any).sure,false);
});

test('two servos on one gear are both found and both count; a motor beside a shaft is not on it',()=>{
  const servo=(k,y)=>at(k,'Axon Mini Servo',[-1,y-1,0,1,y+1,1]),t=H.driveTrain([servo('s1',-3),servo('s2',3),at('m','5203 Series Yellow Jacket Motor 435rpm',[-4,6,0,4,7,1])]);
  const joints=[{axis:[0,0,1],origin:[0,-3,0]},{axis:[0,0,1],origin:[0,3,0]}];
  const r=H.powerOf(t,joints,[],()=>true);assert.equal(r.actuators.length,2);assert.ok(r.actuators.every(a=>a.kind==='servo'));
  assert.deepEqual(H.powerOf(t,[{axis:[0,0,1],origin:[0,6.5,0]}],[],()=>true),null,'the motor’s own axis is along x');
  const row=(k,n)=>({key:k,name:n,label:k,family:'servo',role:'turret',kind:'crservo'}),list=Array.from({length:7},(_,i)=>row('s'+i,'s'+i));
  assert.deepEqual(H.conflicts(list,null,{power:{s0:{count:2,refs:[]}}}).filter(p=>/R503/.test(p.text)),[],'8 with the pair');
  assert.match(H.conflicts(list,null,{power:{s0:{count:2,refs:[]},s1:{count:2,refs:[]}}}).find(p=>/R503/.test(p.text)).text,/9 servos/);
});

test('one indexer across the robot: its rollers go to the nearest shooter by what powers them; a lone shooter shares',()=>{
  const feeders=[{id:'a',origin:[-4,.9,9.4],power:'14'},{id:'b',origin:[-4,3,10.8],power:'14'},{id:'c',origin:[-4.2,-5.4,9.5],power:'5'}],pollen=[-6.6,5.2,15],nectar=[-6.9,-2.7,15];
  assert.deepEqual(H.feedersByShooter(feeders,[pollen,nectar]),[['a','b'],['c']]);
  assert.deepEqual(H.feedersByShooter([feeders[2]],[pollen,nectar]),[['c'],['c']],'both on the one motor');
  assert.deepEqual(H.feedersByShooter(feeders,[null,null]),[[],[]],'no flywheel joints: the caller keeps the row’s own');
});

test('Configure from Control Hub: two feeders sharing “indexer” both take the robot’s one indexer; its sensing names both IMUs',()=>{
  const s=T.setup(),p={...s,robot:C.robot(s.robot,'ftc')};
  p.mechanisms=M.sanitize({...s.mechanisms,enabled:true,shooters:[{type:'turret',pieces:'pollen',mount:'front',motor:'shooter',indexer:'indexer'},{type:'turret',pieces:'nectar',mount:'back',motor:'shooter2',indexer:'indexer'}]});
  const cfg=RC.parse(`<?xml version='1.0'?><Robot type="FirstInspires-FTC"><LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173"><LynxModule name="Control Hub" port="173"><goBILDA5202SeriesMotor name="indexer" port="2" /><ControlHubImuBHI260AP name="imu" port="0" bus="0" /><goBILDAPinpoint name="pinpoint" port="1" bus="1" /></LynxModule></LynxUsbDevice></Robot>`);
  const r=HS.plan(p,cfg),by=k=>r.assign.find(a=>a.key===k);
  assert.deepEqual([by('shooters.0.indexer')?.name,by('shooters.1.indexer')?.name],['indexer','indexer']);
  assert.equal(by('shooters.1.indexer').port,2);assert.ok(by('shooters.0.indexer').shared||by('shooters.1.indexer').shared);
  assert.ok(!r.missing.some(m=>/indexer/.test(m.key)),JSON.stringify(r.missing));
  assert.match(HS.lines(r)[0].text,/Pinpoint reads its 2 goBILDA odometry pods.*Control Hub’s IMU is used too/);
});

test('an Axon MINI configured on the robot as a plain servo takes its positional twin, and back',()=>{
  const s=T.setup(),p={...s,robot:C.robot({...s.robot,wiring:{devices:{'shooters.0.turretMotor':{model:'axon-mini-cr'}}}},'ftc')};
  p.mechanisms=M.sanitize({...s.mechanisms,enabled:true,shooters:[{type:'turret',pieces:'pollen',mount:'front',turretMotor:'turret'}],turret:{kind:'crservo'}});
  const cfg=kind=>RC.parse(`<?xml version='1.0'?><Robot type="FirstInspires-FTC"><LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173"><LynxModule name="Control Hub" port="173"><${kind} name="turret" port="1" /><ControlHubImuBHI260AP name="imu" port="0" bus="0" /></LynxModule></LynxUsbDevice></Robot>`);
  const servo=HS.plan(p,cfg('Servo')).assign.find(a=>a.key==='shooters.0.turretMotor');
  assert.deepEqual([servo.kind,servo.model],['servo','axon-mini']);
  const cr=HS.plan(p,cfg('ContinuousRotationServo')).assign.find(a=>a.key==='shooters.0.turretMotor');
  assert.equal(cr.model,undefined,'already the continuous-mode model');assert.equal(HS.apply(p,HS.plan(p,cfg('ContinuousRotationServo'))).mechanisms.turret.kind,'crservo');
});

// A train built to measure, in inches: a motor along x with a 20T pulley, a belt to a 40T pulley on a rod, a 36T gear on that
// rod meshing a 36T on the next rod, each rod carrying a wheel or a star of tubes; a third shaft a bearing keeps free.
const box=(c,d)=>[c[0]-d[0]/2,c[1]-d[1]/2,c[2]-d[2]/2,c[0]+d[0]/2,c[1]+d[1]/2,c[2]+d[2]/2];
const part=(key,name,c,d)=>({ref:'#'+key,key:'robot/'+key,name,box:box(c,d)});
const pulley=(key,teeth,c)=>part(key,'Pulley 2mm Pitch '+teeth+'T',c,[.3,teeth*.04,teeth*.04]);
const spur=(key,teeth,c)=>part(key,'Spur gear ('+teeth+' teeth)',c,[.25,(teeth+2)*.04,(teeth+2)*.04]);
const rod=(key,c,len=6)=>part(key,'shaft',c,[len,.3,.3]);
const TRAIN=[part('m','Motor Part',[-3,0,0],[3,1.4,1.4]),pulley('p20',20,[-1,0,0]),part('b','Belt',[-1,1,0],[.2,3,1.6]),
  pulley('p40',40,[-1,2,0]),rod('r1',[1,2,0]),part('gecko','48mm Gecko Wheel',[1,2,0],[.6,1.9,1.9]),spur('s1',36,[2,2,0]),spur('s2',36,[2,3.44,0]),rod('r2',[1,3.44,0]),
  ...[[1,.8,0],[1,-.4,.69],[1,-.4,-.69]].map(([x,y,z],i)=>part('tube'+i,'Curved Tubing',[x,3.44+y,z],[.3,.5,.5]))];
test('a motor turns what is on its belts, shafts and gears, each at its own speed: pulleys by their teeth, a mesh the other way',()=>{
  const train=H.driveTrain(TRAIN),motor=train.actuators[0],{groups}=train.spread(motor),on=name=>groups.find(g=>g.names.some(n=>n.includes(name)));
  assert.equal(on('40T').speed,.5,'a 20T pulley turns a 40T half as fast');assert.ok(on('40T').refs.includes('#r1'),'the rod turns with its pulley');assert.ok(on('40T').riders.includes('#gecko'),'and the wheel on it');
  const after=groups.find(g=>g.refs.includes('#r2'));assert.equal(after.speed,-.5,'one mesh of equal gears: as fast, the other way');
  assert.deepEqual(['#tube0','#tube1','#tube2'].filter(r=>after.riders.includes(r)).length,3,'the pieces of a star wheel, whose middle is on the shaft, turn with it');});
test('a gear on a bearing turns freely, and a differential stops the drive',()=>{
  const free=H.driveTrain([...TRAIN,part('brg','8x14x4mm Bearing',[-1,2,0],[.2,.55,.55])]);assert.ok(!free.spread(free.actuators[0]).groups.some(g=>g.refs.includes('#r1')),'the 40T spins on its bearing; the rod does not');
  // Bevels: the motor's gear on x meets a gear on z, which meets a second one on x on the first's line. The middle one has two ways to go.
  const bevels=[part('mo','Motor Part',[-3,0,0],[3,1.4,1.4]),part('b1','Bevel gear 20T',[-1,0,0],[.3,1,1]),part('b2','Bevel gear 20T',[-.35,0,-.55],[1,1,.3]),part('b3','Bevel gear 20T',[.3,0,0],[.3,1,1]),part('out','shaft',[2.3,0,0],[4,.3,.3])],diff=H.driveTrain(bevels),g=diff.spread(diff.actuators[0]);
  assert.ok(!g.groups.some(x=>x.refs.includes('#out')),'the far shaft is not driven through a differential');assert.ok(g.stopped.length>0,'and it says where it stopped');
  const pair=H.driveTrain(bevels.filter(p=>p.ref!=='#b3').concat(part('out2','shaft',[-.35,0,-2.4],[.3,.3,4])));assert.ok(pair.spread(pair.actuators[0]).groups.some(x=>x.refs.includes('#out2')),'one right angle does carry it');});
test('the plan: a joint on the train gets its ratio, every other shaft follows it, a shaft two motors reach at different speeds is left alone',()=>{
  const train=H.driveTrain(TRAIN),joints=[{id:'feeder1',type:'continuous',parts:['#gecko'],drive:{signal:'feeder',of:'any'}}],leaves=j=>new Set(j.parts),[plan]=H.spinPlan(train,joints,leaves);
  assert.equal(plan.primaries[0].joint.id,'feeder1');assert.equal(plan.primaries[0].speed,.5);assert.ok(plan.primaries[0].extra.includes('#r1'),'its whole shaft');
  const f=plan.followers.find(x=>x.refs.includes('#r2'));assert.equal(f.of,'feeder1');assert.equal(f.ratio,-1);assert.equal(plan.followers.find(x=>x.refs.includes('#p20')).ratio,2,'the motor’s own pulley turns twice as fast');
  assert.equal(H.spinPlan(train,[],leaves).length,0,'nothing to follow');
  // A second motor belted to the far rod through a pulley of another size: the rods it shares are left out.
  const two=H.driveTrain([...TRAIN,part('m2','Motor Part',[-3,6,0],[3,1.4,1.4]),pulley('q20',20,[-1,6,0]),part('b2','Belt',[-1,5,0],[.2,3,1.4]),pulley('q30',30,[-1,3.44,0])]);
  const plans=H.spinPlan(two,joints,leaves);assert.ok(plans.every(p=>!p.followers.some(x=>x.refs.includes('#r2'))),'two ways to go');});
test('the picture of a model is that model: never another maker’s photo, and a continuous servo is its servo',()=>{
  const A=require('../ui/ftc/device-art.js');globalThis.DeckDeviceArt=A;
  try{const key=id=>A.photoKey(H.pictureTag(id));
    for(const m of H.ACTUATORS)if(A.photoOf(key(m.id))&&m.xmlType==='Servo')assert.equal(key(m.id),'model-'+m.id,m.id);
    assert.equal(key('axon-mini-cr'),'model-axon-mini');assert.match(A.photoOf('model-axon-mini').page,/axon-robotics/);assert.match(A.photoOf('model-swyft-speed').page,/swyftrobotics/);assert.match(A.photoOf('model-gobilda-5203-6000').page,/6000-rpm/);
    assert.equal(A.photoOf(key('mata-torque')),null,'no listing: its drawing, not a goBILDA servo');assert.equal(A.info(H.pictureTag('mata-torque')).family,A.info('Servo').family);assert.ok(A.svg(H.pictureTag('mata-torque')).includes('<svg'));
    for(const s of H.SENSORS)if(s.id!=='motor-encoder')assert.ok(H.pictureTag(s.id),s.id+' has a picture');
    assert.equal(key('rev-color-v3'),'RevColorSensorV3','a type of its own keeps its photo');}finally{delete globalThis.DeckDeviceArt;}});
test('rollers and a feeder on two motors run together when the team, or the CAD, says so',()=>{
  assert.equal(M.chained({intakes:[{motor:'intake',withFeeder:true}],shooters:[{indexer:'indexer'}]}),true);
  assert.equal(M.onOneMotor({intakes:[{motor:'intake',withFeeder:true}],shooters:[{indexer:'indexer'}]}),false);
  const s=M.sanitize({enabled:true,intakes:[{kind:'sweeper',sides:['front'],motor:'intake',withFeeder:true}],shooters:[]});assert.equal(s.intakes[0].withFeeder,true,'kept');});

