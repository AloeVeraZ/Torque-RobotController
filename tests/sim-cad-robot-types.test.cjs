'use strict';
// Configure from CAD on different kinds of robot: a drivetrain alone, an intake alone, a kicker, side rollers, two fixed
// shooters, one turret, a turret under only one of two shooters, a passive funnel, and the user's own Lunala (its named
// assemblies and boxes as the STEP import gives them). Each one gets exactly the intakes and shooters its CAD shows, and
// every turret is tied to the shooter it turns.
const {test}=require('node:test'),assert=require('node:assert/strict');
const Mech=require('../ui/sim-mechanisms.js'),R=require('../ui/sim-robot-model.js');
// A named assembly in the robot frame (inches: x forward, y left, z up), classified as the import does.
const P=(name,b,inner=[])=>({name,...Mech.partRole(name,inner),box:{x0:b[0],y0:b[1],z0:b[2],x1:b[3],y1:b[4],z1:b[5]}});
const chassis=P('Drivetrain',[-9,-9,0,9,9,4],['104mm Mecanum Wheel']);
const configure=parts=>{const out=Mech.fromCad(parts,{length:18,width:18});return {out,...Mech.adoptCad({},out)};};
const intakes=m=>m.intakes.map(i=>`${i.kind}@${i.sides.join('+')}`),shooters=m=>m.shooters.map(s=>`${s.type}/${s.pieces}@${s.mount}`);

test('a drivetrain alone has no mechanisms',()=>{const {mechanisms:m,out}=configure([chassis]);assert.equal(m.enabled,false);assert.deepEqual([intakes(m),shooters(m)],[[],[]]);assert.deepEqual(out.found,['Chassis “Drivetrain”: 18 × 18 in']);});
test('an intake alone, a kicker and side rollers are each one intake on the front',()=>{
  for(const [name,inner,kind] of [['Intake',['Intake Roller'],'sweeper'],['Kicker',['Servo','Arm'],'kicker'],['Side roller intake',['Roller'],'siderollers']]){
    const {mechanisms:m}=configure([chassis,P(name,[6,-8,0,11,8,4],inner)]);assert.deepEqual([intakes(m),shooters(m)],[[`${kind}@front`],[]],name);}
});
test('two fixed shooters named for their pieces stay fixed, one per piece',()=>{
  const {mechanisms:m}=configure([chassis,P('Pollen shooter',[-6,1,6,0,7,12],['Flywheel','Hood']),P('Nectar shooter',[-6,-7,6,0,-1,12],['Flywheel','Hood'])]);
  assert.deepEqual(shooters(m),['fixed/pollen@left','fixed/nectar@right']);
});
test('one turret assembly carrying its flywheel is one turret shooter',()=>{
  const {mechanisms:m}=configure([chassis,P('Turret',[-6,-3,6,0,3,14],['Turntable','Flywheel','Hood'])]);assert.deepEqual(shooters(m),['turret/pollen@center']);
});
test('a turret under only one of two shooters turns that one; the other stays fixed',()=>{
  const {mechanisms:m,out}=configure([chassis,P('Shooter L',[-6,1,8,0,7,14],['Flywheel']),P('Shooter R',[-6,-7,8,0,-1,14],['Flywheel']),P('Turret',[-6,1,5,0,7,8],['Turntable','Servo'])]);
  assert.deepEqual(shooters(m),['turret/pollen@left','fixed/pollen@right']);assert.deepEqual(m.shooters[0].parts,['Shooter L','Turret']);assert.deepEqual(out.shooters[1].parts,['Shooter R']);
});
test('a funnel or chute is the indexer, and passive when nothing in it is a motor or servo',()=>{
  for(const name of ['Funnel','Ball chute']){const p=P(name,[-2,-6,3,5,6,9],['Funnel plate','Guide rail']);assert.equal(p.role,'indexer',name);assert.equal(p.passive,true,name);
    const {out,mechanisms:m}=configure([chassis,P('Intake',[6,-8,0,11,8,4],['Intake Roller']),p,P('Shooter',[-6,-3,8,0,3,14],['Flywheel','Hood'])]);
    assert.deepEqual([intakes(m),shooters(m)],[['sweeper@front'],['fixed/pollen@center']]);assert.ok(out.found.some(f=>f.startsWith(`Indexer “${name}”: passive`)),out.found.join(' | '));}
  assert.equal(P('Hopper',[0,0,0,1,1,1],['CR Servo']).passive,undefined,'a servo in it drives it');
});

// The user's Lunala as the import names it (main assembly, front -y): an intake with a ramp, a pollen and a nectar shooter
// (each a 6000 rpm flywheel with a hood), one "turret final" holding both turntables, and the funnel ("indexer final").
const LUNALA=[
  ['drivetrain <1>',['104mm Mecanum Wheel (GB)','Motor Part','Motor Sleeve','FRONT RAMP','REV Servo Hub'],[-12.239,-7.333,3.844,3.587,9.072,11.236]],
  ['indexer final <1>',['POLLEN RAIL','40t Servo Gear - 25t Spline (GB)','Curved Tubing','NECTAR RAIL','48mm Gecko Wheel - 15A (GB)'],[-9.523,-7.085,4.31,0.87,9.245,12.49]],
  ['turret final <2>',['nectar gear','pollen gear','Servo Hub (GB)','Mini Servo - 25t spline (AXON)'],[-11.853,-6.275,7.436,3.213,9.029,13.817]],
  ['POLLEN V2 <1>',['GEAR','3614 Series Rhino Wheel (14mm Bore, 72mm Diameter, 30A Durometer) 3614-0014-0072','HOOD SPACER','GEAR HOOD','Servo Hub (GB)','6000rpm Motor - Bare REX (GB)','HOOD'],[-8.421,2.389,13.444,-0.305,9.187,18.171]],
  ['NECTAR V2 <1>',['GEAR','3614 Series Rhino Wheel (14mm Bore, 72mm Diameter, 30A Durometer) 3614-0014-0072','Servo Hub (GB)','6000rpm Motor - Bare REX (GB)','GEAR HOOD','HOOD'],[-8.519,-6.744,13.499,0.196,0.444,18.23]],
  ['Belt',[],[-11.223,-5.989,6.388,0.437,1.661,10.069]],
  ['intake v4 <1>',['Servo Hub Shaft - 16mm (GB)','Max Servo - 25t spline (AXON)','48mm Gecko Wheel - 15A (GB)'],[-12.251,-8.587,6.613,3.68,-3.408,18.194]],
  ['FRONT RAMP',[],[-9.011,-6.02,4.312,0.359,-5.238,4.831]]];
test('Lunala: one ramp intake, and two turrets, each on its own turntable in “turret final” and tied to its own shooter',()=>{
  const parts=LUNALA.map(([name,inner,box])=>({name,key:'main assembly/'+name,...Mech.partRole(name,inner),box}));
  const meta=R.meta({id:'0123456789abcdef0123456789abcdef.glb',name:'lunala.step',units:'in',front:'-y',top:'+z',source:'step',parts,bodyChassis:true}),b=R.partBoxes(meta);
  const out=Mech.fromCad(b.parts,{length:b.extent.length,width:b.extent.width,chassis:b.chassis?.derived?b.chassis:null}),{mechanisms:m,extra}=Mech.adoptCad({},out);
  assert.deepEqual(intakes(m),['sweeper@front'],'rollers, whose ramp the hinge finder confirms');assert.deepEqual(m.intakes[0].parts,['intake v4 <1>','FRONT RAMP']);
  assert.deepEqual(m.shooters.map(s=>[s.type,s.pieces,s.parts]),[['turret','pollen',['POLLEN V2 <1>','turret final <2>']],['turret','nectar',['NECTAR V2 <1>','turret final <2>']]]);
  assert.ok(!m.shooters.some(s=>s.sharesTurret),'two turrets, not one');assert.deepEqual(extra,[]);
  assert.ok(out.found.some(f=>/^Indexer “indexer final <1>”: set its/.test(f)),'a servo in the funnel: not passive');
});
