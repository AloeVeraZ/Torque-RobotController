'use strict';
// The preset robots' generated CAD (ui/sim-preset-robots.js): each the size its preset says, found by the app's CAD rules
// as the drivetrain it is (and the tank's sweeper and fixed shooter), joints that resolve to its parts (swerve wheels
// riding their steering), wiring with no problems, and its demo route run headlessly in the simulator physics.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const PR=require('../ui/sim-preset-robots.js'),T=require('../ui/sim-test-robot.js'),SM=require('../src/sim-model.cjs'),Mech=require('../ui/sim-mechanisms.js'),K=require('../ui/sim-kinematics.js');
const C=require('../ui/sim-config.js'),W=require('../ui/sim-wiring.js'),DS=require('../tools/deck-sim.cjs');
const near=(a,b,tol,msg)=>[].concat(a).forEach((v,i)=>assert.ok(Math.abs(v-[].concat(b)[i])<=tol,`${msg||''} ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`));
const IDS=['startermecanum','a301swerve'];
const engineOf=d=>C.drives[d].engine;

test('there is a generated robot for every preset, and the Test robot is unchanged by sharing its builders',()=>{
  assert.deepEqual(Object.keys(PR.ROBOTS),Object.keys(Mech.PRESETS));assert.deepEqual(IDS,Object.keys(PR.ROBOTS));
  for(const id of IDS){assert.equal(PR.ROBOTS[id].name,Mech.PRESETS[id].name);assert.equal(PR.ofModel({name:PR.ROBOTS[id].name}),id);}
  assert.equal(PR.ofModel({name:T.NAME}),null);assert.equal(T.meshes().length,113);assert.ok(T.meshes().every(m=>m.path[0]===T.NAME));
});

for(const id of IDS)test(`${id}: its preset's length and width on the floor, outward faces, the drivetrain its parts are named for`,()=>{
  const r=PR.ROBOTS[id],p=Mech.PRESETS[id],m=PR.meshes(id),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];let triangles=0;
  for(const x of m){assert.equal(x.path[0],r.name);assert.ok(x.position instanceof Float32Array&&x.index instanceof Uint32Array&&x.normal.length===x.position.length);
    for(let i=0;i<x.position.length;i++){const a=i%3;lo[a]=Math.min(lo[a],x.position[i]);hi[a]=Math.max(hi[a],x.position[i]);}triangles+=x.index.length/3;}
  near([hi[0]-lo[0],hi[1]-lo[1]],[p.robot.length,p.robot.width],.03,'length x width');assert.ok(Math.abs(lo[2])<.03,`on the floor (${lo[2]})`);assert.ok(hi[2]<=r.heightIn,`${hi[2]} in tall`);
  assert.ok(triangles<=60000,`${triangles} triangles`);
  const res=PR.result(id,SM),groups=res.groups.map(g=>[g.name,Mech.partRole(g.name,g.inner).role]);assert.equal(engineOf(Mech.drivetrainFromNames(res.names)),engineOf(p.robot.drivetrain));
  const chassis=res.groups.find(g=>g.name==='Chassis');near([chassis.box[3]-chassis.box[0],chassis.box[4]-chassis.box[1]],[p.robot.length,p.robot.width],.03,'chassis box');
  assert.deepEqual(groups,[['Chassis','chassis'],['Electronics','other']]);
  // The same robot every time (the stored model's id is a hash of its bytes).
  const again=PR.meshes(id);m.forEach((x,i)=>assert.deepEqual(Buffer.from(again[i].position.buffer),Buffer.from(x.position.buffer)));
});

for(const id of IDS)test(`${id}: every joint moves parts of the model; wheels roll on the floor; swerve wheels ride their steering`,()=>{
  const m=PR.meshes(id),P=K.partIndex(SM.tree(m)),kin=K.sanitize(PR.kinematics(id)),raw=PR.kinematics(id);
  assert.equal(kin.joints.length,raw.joints.length,'none dropped');for(const j of kin.joints)assert.ok(P.expand(j.parts).size>0,`${j.id} names parts of the model`);
  const wheels=kin.joints.filter(j=>j.drive?.signal==='wheel');assert.equal(wheels.length,4);
  for(const j of wheels){near(j.origin[2],j.radius,1e-3,j.id);}
  if(id==='a301swerve')for(const k of ['FL','FR','BL','BR']){const steer=kin.joints.find(j=>j.id==='steer'+k),wheel=kin.joints.find(j=>j.id==='wheel'+k);
    assert.deepEqual([steer.drive.signal,wheel.parent,steer.axis],['steer','steer'+k,[0,0,1]]);const all=P.expand(steer.parts);for(const p of P.expand(wheel.parts))assert.ok(all.has(p),'the wheel is inside its module');}
});

for(const id of IDS)test(`${id}: applied to a setup it is a locked FTC robot with clean wiring and its mechanisms on its CAD`,()=>{
  const s=PR.apply(id,T.setup(),C),p=Mech.PRESETS[id];
  assert.deepEqual([s.controller,s.robotPreset,s.robot.drivetrain,s.robot.length,s.robot.width,s.robot.appearance],['ftc',id,p.robot.drivetrain,p.robot.length,p.robot.width,'custom']);
  assert.equal(s.sensors.localization,PR.ROBOTS[id].localization);assert.ok(C.sensorChoices('ftc').includes(s.sensors.localization));
  const st=W.state(s);assert.equal(st.error,null);assert.deepEqual(st.problems,[],'no wiring problems');assert.ok(st.rows.length>=4&&st.rows.every(r=>r.wired),'every device on the port the preset gives it');
  assert.equal(s.mechanisms.enabled,!!p.mechanisms);
  const l=PR.layout(id);assert.deepEqual([l.field,l.alliance,l.name],['biobuzz','red',`${p.name} demo`]);for(const pin of l.pins)assert.deepEqual(DS.clean(pin),pin);
});

test('a fixed shooter aimed at the other cell faces that cell, not the start cell',()=>{
  const back=Mech.sanitize({enabled:true,intakes:[{kind:'sweeper',sides:['front'],reach:1.5}],shooters:[{type:'fixed',pieces:'both',mount:'center',facing:'back',indexerKind:'crservo'}],capacity:{pollen:4,nectar:4}}),front=Mech.sanitize({...back,shooters:[{...back.shooters[0],facing:'front'}]}),start={x:59.25,y:58.56},other={x:59.25,y:85.44};
  const pins=[{x:24,y:30,action:'Shoot'},{x:28,y:104,action:'Shoot',cell:'other'}],[a,b]=Mech.prepare(pins,front,start);
  assert.deepEqual([a.target,b.target],[start,other]);
  // A launcher that fires out of the back: Shoot pins turn its back to the cell.
  const bearing=(p,q)=>Math.atan2(q.y-p.y,q.x-p.x)*180/Math.PI,[c,d]=Mech.prepare(pins,back,start);
  near([c.turn,d.turn],[bearing(pins[0],start)-180,bearing(pins[1],other)+180],.01,'back to the cell');
});

for(const id of IDS)test(`${id}: its demo route runs headlessly inside the 30 s period, touching no zone and ending at its last pin`,async t=>{
  const {SimEngine}=require('../src/sim-engine.cjs'),s=PR.apply(id,T.setup(),C),l={...PR.layout(id),id:'demo'},e=new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-preset-')),now:()=>0,emit:()=>{}});
  try{
    const info=await e.load({mechanisms:s.mechanisms,alliance:l.alliance,field:l.field,width:l.width,height:l.height,elements:true,start:l.start,zones:l.zones,robot:s.robot,controller:s.controller,sensors:s.sensors,timing:{...s.timing,power:1},tuning:s.tuning,kinematics:s.kinematics});
    const route=DS.planRoute({...s,layouts:[l],active:l.id},l,info);assert.ok(route.segments.length>0);assert.equal((await e.run({kind:'route',route})).ok,true);
    const moved={};for(let i=0;i<5400&&['program','timed'].includes(e.mode);i++){if(e.mode==='timed')e.timedTick();else await e.programTick();for(const [k,v] of Object.entries(e.frame().joints||{}))moved[k]=(moved[k]||0)+Math.abs(v);}
    assert.ok(e.result,e.lastError||'the route finished');const end=l.pins.at(-1),st=e.mechanismState();
    t.diagnostic(`${e.result.time.toFixed(2)} s${st?`, picked ${st.pickedUp}, shot ${st.shots}, landed ${st.landed}, ${st.tips} tips`:''}`);
    assert.equal(e.result.violations.length,0,'no zone touches');assert.ok(Math.hypot(e.result.truth.x-end.x,e.result.truth.y-end.y)<1.5,'ends within 1.5 in of the last pin (as the app checks)');assert.ok(e.result.time<30,`${e.result.time} s`);
    // It ends partly in the red loading zone (x below 12.9 in, y 95.9 to 118.6 in): PARK.
    const f=C.footprint(s.robot);assert.ok(e.result.truth.x-Math.max(f.front,f.half)<12.9&&e.result.truth.y>95.9&&e.result.truth.y<118.6,'parked');
  }finally{e.dispose();}
});
