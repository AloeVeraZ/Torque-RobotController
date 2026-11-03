'use strict';
// End to end: a BIOBUZZ robot's CAD with one intake (rollers and a ramp that folds down) and two turrets, each carrying
// its own shooter (a flywheel and a hood), named as teams name them in Onshape, SolidWorks and Fusion. From the STEP
// reader's meshes through the import (src/sim-model.cjs), the named parts (partRole), Configure from CAD (fromCad,
// adoptCad) and Find again on the Moving parts panel (sim-joints.js with the finder in sim-discovery.js), to what the
// panel lists and says.
const {test}=require('node:test'),assert=require('node:assert/strict');
const SM=require('../src/sim-model.cjs'),Mech=require('../ui/sim-mechanisms.js'),R=require('../ui/sim-robot-model.js'),D=require('../ui/sim-discovery.js'),K=require('../ui/sim-kinematics.js');
const F=require('./fixtures/biobuzz-cad.cjs'),S=require('./fixtures/mechanism-shapes.cjs');
Object.assign(globalThis,{DeckKinematics:K,DeckDiscovery:D,DeckRobotModel:R,DeckMechanisms:Mech,DeckMechanismTypes:require('../ui/sim-mechanism-types.js'),DeckCollide:require('../ui/sim-collide.js')});
globalThis.document??={activeElement:null,addEventListener(){}};
require('../ui/sim-joints.js');
const ID='0123456789abcdef0123456789abcdef.glb';
// The import as the page does it: the reader's meshes merged into one body with its part tree, and each named assembly
// kept with its role from its name and its box (simulation.js importModel).
function imported(meshes){
  const value={...SM.merge(meshes),tree:SM.tree(meshes),groups:SM.groups(meshes),names:SM.names(meshes)};
  const parts=value.groups.map(g=>({name:g.name,...(g.key?{key:g.key}:{}),...Mech.partRole(g.name,g.inner),box:g.box}));
  return {value,meta:R.meta({id:ID,name:'BIOBUZZ.step',units:'in',front:'+x',top:'+z',source:'step',parts,bodyChassis:true})};
}
// Configure from CAD's first half (simulation.js setUpFromCad merge): the team's intakes and shooters take the CAD's.
function configure(meta,team){const b=R.partBoxes(meta),out=Mech.fromCad(b.parts,{length:b.extent.length,width:b.extent.width,chassis:b.chassis?.derived?b.chassis:null});return {out,...Mech.adoptCad(team,out)};}
// The Moving parts panel on a page that keeps only what the panel gives it.
function panel(value,meta,mechanisms){
  const project={kinematics:K.sanitize({}),mechanisms},line={textContent:''};
  const host={innerHTML:'',hidden:false,querySelector:s=>s==='.sim-joints-status'?line:null,querySelectorAll:()=>[],contains:()=>false,addEventListener(){}};
  const geometry={attributes:{position:{array:value.positions},_part:{array:value.part}},index:{array:value.index},userData:{parts:value.tree}};
  const p=globalThis.DeckJointsPanel.create({host,api:{kinematics:()=>project.kinematics,mechanisms:()=>project.mechanisms,model:()=>({id:ID,geometry}),meta:()=>meta,preview:()=>null,
    commit(next){project.kinematics=K.sanitize(next);},setIntake(n,patch){const m=structuredClone(project.mechanisms);Object.assign(m.intakes[n],patch);project.mechanisms=Mech.sanitize(m);},
    footprint:()=>null,hitboxes:()=>false,refreshPicker(){}}});
  return {p,project,host,status:()=>line.textContent,leaves:j=>K.partIndex(value.tree).expand(j.parts)};
}
// Each style: its two turrets' assemblies (left, right) as the page names them, its intake's, and what each turret is said
// to carry.
const STYLES={
  onshape:{turrets:['Turret <1>','Turret <2>'],intake:['Intake <1>','Intake Ramp <1>'],intakeSaid:'“Intake” + “Intake Ramp”',carries:'(“Flywheel”, “Hood” inside it)'},
  sides:{turrets:['Left Turret Assembly-1','Right Turret Assembly-1'],intake:['Intake-1'],intakeSaid:'“Intake-1”',carries:'(“Flywheel”, “Hood” inside it)'},
  shooter:{turrets:['Turret 1','Turret 2'],intake:['Front Intake','Ramp Deploy'],intakeSaid:'“Front Intake” + “Ramp Deploy”',carries:'(“Flywheel Assembly”, “Hood Assembly” inside it)'},
  kicker:{turrets:['Shooter L <1>','Shooter R <1>'],said:['“Shooter L”','“Shooter R”'],intake:['Intake <1>','Kicker Mech <1>'],intakeSaid:'“Intake” + “Kicker Mech”'},
  fusion:{turrets:['Turret v7:1','Turret v7:2'],intake:['Intake v5:1'],intakeSaid:'“Intake v5:1”',carries:'(“Flywheel v1:1”, “Hood v1:1” inside it)'},
  inline:{turrets:['Turret <1>','Turret <2>'],intake:['Intake <1>'],intakeSaid:'“Intake”',carries:'(“Flywheel”, “Hood” inside it)'}};
test('every naming style of the fixture is covered',()=>{assert.deepEqual(Object.keys(STYLES).sort(),[...F.STYLES].sort());});
for(const [style,want] of Object.entries(STYLES))test(`a robot with two turrets, each with its own flywheel and hood, and a ramp intake (${style} names): found from Configure from CAD to Find again`,async()=>{
  const {meshes,leaf:L}=F.biobuzzCad(style),{value,meta}=imported(meshes),said=want.said||want.turrets.map(n=>`“${n}”`);
  assert.equal(Mech.drivetrainFromNames(value.names),'mecanum');
  // Configure from CAD: one intake, two turrets, each its own shooter, named by the side it sits on.
  const {out,mechanisms,matched,extra}=configure(meta,{});
  assert.deepEqual(out.shooters.map(s=>[s.type,s.mount,s.parts[0]]),[['turret','backleft',want.turrets[0]],['turret','backright',want.turrets[1]]],out.found.join(' | '));
  assert.deepEqual(out.intakes.map(i=>[i.sides,i.parts]),[[['front'],want.intake]],out.found.join(' | '));
  for(const [n,side] of [[0,'Left'],[1,'Right']])assert.ok(out.found.some(f=>f.startsWith(`${side} turret “${want.turrets[n]}”`)&&f.includes(`at the back ${side.toLowerCase()}`)&&(!want.carries||f.includes(`carrying its own shooter ${want.carries}`))),out.found.join(' | '));
  assert.deepEqual(extra,[]);assert.equal(matched.length,3,matched.join(' | '));
  assert.deepEqual([mechanisms.intakes.length,mechanisms.shooters.length],[1,2]);
  // Find again (on the page that opens after Configure from CAD): every moving part, each bound to its own mechanism.
  const ui=panel(value,meta,mechanisms),r=await ui.p.discover({fromCad:true}),joints=ui.project.kinematics.joints,j=id=>joints.find(x=>x.id===id);
  assert.ok(r&&r.moving>=8,ui.status());
  const game=joints.filter(x=>x.drive&&x.drive.signal!=='wheel').map(x=>[x.id,x.drive.signal,x.drive.of,x.parent||null]);
  assert.deepEqual(game,[['turret1','turret','shooter:0',null],['flywheel1','flywheel','shooter:0','turret1'],['hood1','hood','shooter:0','turret1'],
    ['turret2','turret','shooter:1',null],['flywheel2','flywheel','shooter:1','turret2'],['hood2','hood','shooter:1','turret2'],['deploy1','deploy','intake:0',null],['roller1','roller','intake:0',null]],ui.status());
  assert.equal(joints.filter(x=>x.drive?.signal==='wheel').length,4,'and the four drive wheels');
  // Each turret turns its own shooter about its own turntable; the plate it is bolted to stays with the robot.
  for(const [n,t] of [[1,'t0.'],[2,'t1.']]){const other=t==='t0.'?'t1.':'t0.',has=(id,part)=>ui.leaves(j(id)).has(L[part]);
    assert.ok(has(`turret${n}`,t+'ring')&&has(`turret${n}`,t+'flywheel')&&has(`turret${n}`,t+'plateL'),`turret ${n} carries its shooter`);
    assert.ok(!has(`turret${n}`,t+'mount')&&!Object.keys(L).some(k=>k.startsWith(other)&&has(`turret${n}`,k)),`turret ${n}: not its mount plate, nothing of the other turret`);
    assert.ok(Math.abs(j(`turret${n}`).origin[1]-(n===1?4:-4))<1e-3,'on its own turntable’s axis');
    assert.ok(has(`flywheel${n}`,t+'flywheel')&&has(`flywheel${n}`,t+'shaft')&&!has(`flywheel${n}`,t+'hood'));assert.ok(has(`hood${n}`,t+'hood')&&!has(`hood${n}`,t+'flywheel'));
    assert.ok(Math.abs(Math.abs(j(`turret${n}`).zero)-180)<1,'it fires over the flywheel, away from the hood');assert.ok(Math.abs(j(`hood${n}`).launch-60)<2,'its CAD launch angle');
    assert.match(j(`turret${n}`).note,new RegExp(`^${said[n-1]} turns about this axis because it turns on “Turntable”`));assert.match(j(`hood${n}`).note,new RegExp(`^“Hood” in ${said[n-1]} pivots here`));}
  assert.ok(['rampPlate','armL','armR'].every(k=>ui.leaves(j('deploy1')).has(L[k]))&&!ui.leaves(j('deploy1')).has(L.roller),'the ramp swings, the rollers stay');
  assert.ok(ui.leaves(j('roller1')).has(L.roller));
  // The intake is a deployable ramp, whatever its CAD called the ramp.
  assert.equal(ui.project.mechanisms.intakes[0].kind,'ramp');
  // What Configure from CAD lists under "What was found": each shooter and the intake by the parts in the CAD, and why.
  // The panel itself keeps one short line.
  const text=r.told.join(' ');assert.match(ui.status(),/^\d+ moving parts found\./);
  for(const n of [0,1])assert.ok(text.includes(`Shooter ${n+1} is ${said[n]} in your CAD: a turret on “Turntable”, flywheel “Flywheel”, hood “Hood”.`),text);
  assert.ok(text.includes(`Intake 1 is ${want.intakeSaid} in your CAD: rollers “Roller”, a ramp that swings down on “Servo Hub Shaft”`),text);
  assert.ok(r.told.some(t=>t.startsWith('Shooter 2 is ')),'Configure from CAD says it too');
  // The list: every moving part by its mechanism.
  ui.p.render();for(const name of ['Turret · shooter 1','Flywheel · shooter 1','Hood · shooter 1','Turret · shooter 2','Flywheel · shooter 2','Hood · shooter 2','Ramp · intake 1','Roller · intake 1'])assert.ok(ui.host.innerHTML.includes(`<span>${name}`),name);
  assert.match(ui.host.innerHTML,/>Find again</);
  // Find again finds the same parts again.
  const before=JSON.stringify(joints.map(x=>[x.id,x.parts]));await ui.p.discover({});assert.equal(JSON.stringify(ui.project.kinematics.joints.map(x=>[x.id,x.parts])),before);
});
test('a team that set up one sweeper and one turret: Configure from CAD adds the second turret and makes the intake the ramp its CAD has',async()=>{
  const {meshes,leaf:L}=F.biobuzzCad('onshape'),{value,meta}=imported(meshes);
  const team=Mech.sanitize({enabled:true,intakes:[{kind:'sweeper',sides:['front'],motor:'intakeMotor'}],shooters:[{type:'turret',pieces:'pollen',mount:'center',motor:'fly'}]});
  const {mechanisms,matched}=configure(meta,team);
  assert.deepEqual(matched,['Intake 1 → “Intake” + “Intake Ramp”','Shooter 1 → “Turret <1>”','Shooter 2 → “Turret <2>” (added from your CAD)'],'the two copies keep their instance numbers apart');
  assert.deepEqual(mechanisms.shooters.map(s=>[s.motor,s.mount,s.parts]),[['fly','backleft',['Turret <1>']],['shooter2','backright',['Turret <2>']]],'the team’s motor stays');
  const ui=panel(value,meta,mechanisms),r=await ui.p.discover({fromCad:true});
  assert.equal(ui.project.mechanisms.intakes[0].kind,'ramp');assert.equal(ui.project.mechanisms.intakes[0].motor,'intakeMotor');
  assert.ok(r.told.some(t=>/^Intake 1 is now a deployable ramp: “Ramp plate” and “Arm” swing down on “Servo Hub Shaft”/.test(t)),r.told.join(' | '));
  const of=id=>ui.project.kinematics.joints.find(x=>x.id===id);
  assert.deepEqual(['turret1','flywheel1','hood1','turret2','flywheel2','hood2'].map(id=>of(id)?.drive.of),['shooter:0','shooter:0','shooter:0','shooter:1','shooter:1','shooter:1']);
  assert.ok(ui.leaves(of('flywheel2')).has(L['t1.flywheel']),'the second flywheel is the right turret’s');
});
test('one "Turret" assembly holding a pollen and a nectar shooter over two turntables: two turrets, each its own shooter',()=>{
  const mesh=(path,name,g)=>({name,path:['Robot',...path],position:Float32Array.from(g.positions),index:Uint32Array.from(g.index)});
  const shooter=(name,y)=>[mesh(['Turret',name],'Flywheel',S.cylinder({center:[-3.5,y,8.5],axis:[0,1,0],r:1.4,length:1})),mesh(['Turret',name],'Hood',S.arcBand({center:[-3.5,y,8.5],axis:[0,1,0],r:3.6,t:.2,width:2,from:-30,to:60,start:[1,0,0]}))];
  const meshes=[mesh(['Chassis'],'Frame',S.box([-8,-8,1],[8,8,4])),...[4,-4].map((y,i)=>mesh(['Turret'],`Turntable ${'AB'[i]}`,S.cylinder({center:[-3.5,y,5.4],axis:[0,0,1],r:2.6,length:.25,seg:60}))),...shooter('Pollen shooter',4),...shooter('Nectar shooter',-4)];
  const {value,meta}=imported(meshes);
  assert.deepEqual(value.groups.map(g=>[g.key,g.inner]),[['Robot/Chassis',['Frame']],['Robot/Turret',['Turntable A','Turntable B']],['Robot/Turret/Pollen shooter',['Flywheel','Hood']],['Robot/Turret/Nectar shooter',['Flywheel','Hood']]],'split into the shooters inside it');
  const {out,mechanisms}=configure(meta,{});
  assert.deepEqual(out.shooters.map(s=>[s.type,s.pieces,s.parts]),[['turret','pollen',['Pollen shooter','Turret']],['turret','nectar',['Nectar shooter','Turret']]],out.found.join(' | '));
  assert.ok(out.found.some(f=>/^Left turret with shooter “Pollen shooter”, on its own turntable in “Turret” \(that assembly holds both turntables\)/.test(f)),out.found.join(' | '));
  const ctx=D.prepare({...value}),{joints,report}=D.discover(ctx,{rows:R.rows(meta),unit:1,meta,mechanisms});
  assert.deepEqual(joints.filter(j=>j.drive).map(j=>[j.id,j.drive.of,j.parent||null]),[['turret1','shooter:0',null],['flywheel1','shooter:0','turret1'],['hood1','shooter:0','turret1'],['turret2','shooter:1',null],['flywheel2','shooter:1','turret2'],['hood2','shooter:1','turret2']]);
  assert.ok(report.includes('Shooter 2 is “Nectar shooter” + “Turret” in your CAD: a turret on “Turntable B”, flywheel “Flywheel”, hood “Hood”.'),report.join(' | '));
});
test('the import tree: a part named as its own instance is one node, an assembly’s parts are named in it',()=>{
  const box=S.box([0,0,0],[1,1,1]),mesh=(path,name)=>({name,path,position:Float32Array.from(box.positions),index:Uint32Array.from(box.index)});
  const meshes=[mesh(['Robot','Turret <1>','Flywheel <1>'],'Flywheel'),mesh(['Robot','Turret <1>'],'Hood'),mesh(['Robot','Chassis'],'Frame'),mesh(['Robot','Turret <1>','Side plate-1'],'Side plate')];
  const t=SM.tree(meshes);
  assert.deepEqual(t.nodes.map(n=>n.name),['Robot','Turret <1>','Flywheel <1>','Hood','Chassis','Frame','Side plate-1','Side plate'],'“Flywheel” in “Flywheel <1>” is that instance, not a part of it');
  assert.deepEqual(t.leaf,[2,3,5,7]);
  assert.deepEqual(SM.groups(meshes).map(g=>[g.name,g.inner]),[['Turret <1>',['Hood','Flywheel <1>','Side plate-1']],['Chassis',['Frame']]]);
  // Split into mechanisms: two turrets in a shooter assembly, two shooters in "Shooters"; not a shooter's top and bottom
  // flywheels, nor an intake's two rollers.
  const two=(parent,a,b)=>[a,a,b,b].map((name,i)=>mesh(['Robot',parent,name],'p'+i));
  const keys=SM.groups([mesh(['Robot','Chassis'],'Frame'),...two('Shooter','Turret <1>','Turret <2>'),...two('Shooters','Flywheel L','Flywheel R'),...two('Launcher','Top flywheel','Bottom flywheel'),...two('Intake','Intake roller top <1>','Intake roller bottom <1>')]).map(g=>g.key);
  assert.deepEqual(keys,['Robot/Chassis','Robot/Shooter/Turret <1>','Robot/Shooter/Turret <2>','Robot/Shooters/Flywheel L','Robot/Shooters/Flywheel R','Robot/Launcher','Robot/Intake']);
});
