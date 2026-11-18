'use strict';
// What mechanisms do along a route: a list of steps on each path (run together while driving) and at each pin (run one
// after another), a ramp that moves only on its own Ramp down / Ramp up steps, and turrets and moving parts sent to an
// angle. The simulator, the timed runner and every export run the same lists.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const P=require('../ui/sim-planner.js'),X=require('../ui/sim-export.js'),F=require('../ui/sim-ftc.js'),Mech=require('../ui/sim-mechanisms.js'),MM=require('../ui/sim-motionmodule.js'),Timed=require('../ui/sim-timed.js'),K=require('../ui/sim-kinematics.js');
const built=fs.existsSync(path.join(__dirname,'../sim-runtime/driver/classes/deck/sim/hub/VirtualHub.class')),skip=built?false:'run node tools/simulation/build.cjs first';
const robot={drivetrain:'mecanum',length:16,width:16,heightIn:12,driveRpm:450,intakeIn:0};
const mechanisms=Mech.sanitize({enabled:true,intakes:[{kind:'ramp',sides:['front'],down:.3,up:.3,servo:'ramp',motor:'intake'}],shooters:[{type:'turret',pieces:'pollen',mount:'center'}],preload:{pollen:0}});

test('a pin or path keeps its steps; one step is still the plain action every runtime reads',()=>{
  // An older save's single action becomes one step, and reads back as it was.
  const old=P.pinEffects({x:1,y:1,action:'Shoot',actionSeconds:1.5,cell:'other',path:{kind:'action',action:'Intake'}});
  assert.deepEqual(old.steps,[{action:'Shoot',seconds:1.5,cell:'other'}]);assert.deepEqual([old.action,old.actionSeconds,old.cell],['Shoot',1.5,'other']);
  assert.deepEqual(old.path.steps,[{action:'Intake',seconds:null,cell:'start'}]);assert.equal(old.path.kind,'action');
  // Several steps: the joined name, and no single time (each step has its own).
  const pin=P.pinEffects({steps:[{action:'Shoot'},{action:'Ramp down'},{action:'Intake',seconds:1.2},{action:'  '}],path:{steps:[{action:'Intake'},{action:'Aim',cell:'other'}]}});
  assert.equal(pin.action,'Shoot then Ramp down then Intake 1.2 s');assert.equal(pin.actionSeconds,null);assert.equal(pin.steps.length,3,'an empty step is dropped');
  assert.equal(pin.path.action,'Intake + Aim (other cell)');assert.equal(pin.path.cell,'other');assert.equal(pin.path.kind,'action');
  // Step names cannot hold the joining marks, and a pin keeps at most 8 steps.
  assert.equal(P.stepsOf([{action:'Lift + arm → out'}])[0].action,'Lift arm out');assert.equal(P.stepsOf(Array.from({length:12},()=>({action:'Wiggle'}))).length,P.MAX_STEPS);
  // Clearing the steps clears the action; an older nameless action path stays one.
  assert.equal(P.pinEffects({action:'Shoot',steps:[]}).action,'');assert.equal(P.pathEffects({kind:'action',steps:[]}).kind,'regular');assert.equal(P.pathEffects({kind:'action'}).kind,'action');
});

test('route action names: ramps, turret angles, and a fixed shooter turns for a pin whose steps shoot',()=>{
  assert.deepEqual(Mech.action('Ramp down'),{kind:'ramp',down:true});assert.deepEqual(Mech.action('ramp up'),{kind:'ramp',down:false});
  assert.deepEqual(Mech.action('Turret to -45°'),{kind:'turret',turret:null,degrees:-45});assert.deepEqual(Mech.action('Turret 2 to 30'),{kind:'turret',turret:1,degrees:30});
  assert.equal(Mech.turretAction(30.04),'Turret to 30°');assert.equal(Mech.turretAction(-10,1),'Turret 2 to -10°');
  assert.deepEqual(Mech.actions(mechanisms),['Intake','Ramp down','Ramp up','Spin up','Aim','Shoot']);
  assert.ok(!Mech.actions(Mech.sanitize({enabled:true,intakes:[{kind:'sweeper',sides:['front']}],shooters:[]})).includes('Ramp down'),'no ramp, no ramp actions');
  const fixed=Mech.sanitize({enabled:true,shooters:[{type:'fixed',facing:'front'}]}),[pin]=Mech.prepare([{x:20,y:20,steps:[{action:'Intake',seconds:1},{action:'Shoot'}]}],fixed,{x:60,y:60});
  assert.equal(pin.turnMode,'track','a pin that shoots in its steps turns to the target');
});

// Ticks the mechanism model with the runner's commands, recording what happened each tick.
function drive(runner,model,act,seconds,{pose={x:0,y:0,heading:0},target={x:50,y:0},held=0,t0=0}={}){
  const log=[];let now=t0;for(let i=0;i<Math.round(seconds/.01);i++){now+=.01;const out=runner.commands(act,model.state(),now);model.tick(.01,out.cmd,{pose,target,held});log.push({t:now,...out,state:model.state()});}return log;}

test('at a pin, steps run one after another; each waits for the one before it',()=>{
  const model=new Mech.Model(mechanisms,0),runner=new Mech.Runner(mechanisms);
  const act={name:'x',leg:0,moving:false,steps:[{action:'Ramp down',seconds:null},{action:'Turret to 60°',seconds:null},{action:'Intake',seconds:.5},{action:'Ramp up',seconds:null}]};
  const log=drive(runner,model,act,3),first=k=>log.findIndex(k);
  const down=first(l=>l.state.ramps[0]===1),turned=first(l=>Math.abs(l.state.turrets[0]-60)<=2),intaking=first(l=>l.cmd.intake),up=first(l=>l.state.ramps[0]===0&&l.t>log[down].t),done=first(l=>!l.busy);
  assert.ok(down>0&&Math.abs(log[down].t-.3)<.03,'the ramp folds down first, in its 0.3 s');
  assert.ok(log.slice(0,down).every(l=>!Number.isFinite(l.cmd.turretDeg)),'the turret waits for the ramp');
  assert.ok(turned>down&&intaking>=turned,'then the turret turns to 60°, then the intake runs');
  assert.ok(Math.abs(log.filter(l=>l.cmd.intake).length*.01-.5)<.03,'the intake runs for its 0.5 s');
  assert.ok(up>intaking&&done>=up,'then the ramp folds back up, and the pin is done once it is up');
  assert.ok(log.slice(0,done).every(l=>l.busy),'the pin holds the robot until the last step is done');
});

test('while driving, steps run together from the start of the path, each for its own time; the ramp stays where it was sent',()=>{
  const model=new Mech.Model(mechanisms,0),runner=new Mech.Runner(mechanisms);
  const log=drive(runner,model,{name:'y',leg:1,moving:true,steps:[{action:'Intake',seconds:null},{action:'Ramp down',seconds:null},{action:'Spin up',seconds:null},{action:'Turret to -30°',seconds:.2}]},1);
  assert.ok(log.every(l=>!l.busy),'a path never holds the robot');assert.ok(log.every(l=>l.cmd.intake&&l.cmd.ramp&&l.cmd.spin),'intake, ramp and flywheel together');
  assert.ok(log.filter(l=>Number.isFinite(l.cmd.turretDeg)).length<=21,'the turret step stops after its 0.2 s');
  // After the path: nothing runs, the ramp is still down and the flywheel keeps spinning for a later Shoot.
  const after=drive(runner,model,null,.5,{t0:1}).at(-1);assert.deepEqual([after.cmd.intake,after.cmd.ramp,after.cmd.spin,after.state.ramps[0]],[false,true,true,1]);
});

test('shooting while intaking: a Shoot beside a running Intake feeds at once instead of waiting for pieces to move up',()=>{
  const m=Mech.sanitize({enabled:true,intakes:[{kind:'sweeper',sides:['front'],motor:'intake'}],shooters:[{type:'turret',pieces:'pollen',mount:'center'}],preload:{pollen:0}});
  const feedAt=(act,held=2)=>{const model=new Mech.Model(m,held),runner=new Mech.Runner(m);return drive(runner,model,act,4);};
  // On a path, Intake + Shoot together: the feeders run with the intake for the whole path.
  const path=feedAt({name:'p',leg:0,moving:true,steps:[{action:'Intake',seconds:null},{action:'Shoot',seconds:null}]}),first=path.findIndex(l=>l.cmd.feed);
  assert.ok(first>0&&path[first].t<m.shooter.spinUp+.5,`feeds as soon as it is spun up and aimed (${path[first]?.t})`);
  assert.ok(path.slice(first).every(l=>l.cmd.feed&&l.cmd.intake),'and keeps feeding and intaking for the whole path');
  // A Shoot on a path after an Intake that already ended still waits for the pieces to move up.
  const late=feedAt({name:'q',leg:1,moving:true,steps:[{action:'Intake',seconds:.5},{action:'Shoot',seconds:null}]}),lateFirst=late.findIndex(l=>l.cmd.feed&&l.t>.5);
  assert.ok(late.filter(l=>l.t>.5&&l.t<.5+m.transfer.seconds-.05).every(l=>!l.cmd.feed||l.t<=.5),'no new feed starts before the transfer time');assert.ok(lateFirst>0);
  // At a pin, an Intake with no time stays on for the steps after it; the pin ends when the timed Shoot does.
  const pin=feedAt({name:'r',leg:2,moving:false,steps:[{action:'Intake',seconds:null},{action:'Shoot',seconds:2}]}),busy=pin.filter(l=>l.busy);
  assert.ok(Math.abs(busy.length*.01-2)<.05,`the pin holds for the Shoot's 2 s (${busy.length*.01})`);assert.ok(busy.every(l=>l.cmd.intake),'with the intake on throughout');
  assert.ok(busy.some(l=>l.cmd.feed)&&busy.findIndex(l=>l.cmd.feed)*.01<m.shooter.spinUp+.5,'and the feeders running without the transfer wait');
  assert.equal(pin.at(-1).cmd.intake,false,'the intake stops when the pin is done');
  // The same pin with a timed Intake first is unchanged: one after the other, and the Shoot waits.
  const seq=feedAt({name:'s',leg:3,moving:false,steps:[{action:'Intake',seconds:.5},{action:'Shoot',seconds:null}]});
  assert.ok(seq.filter(l=>l.cmd.feed).every(l=>!l.cmd.intake&&l.t>=.5+m.transfer.seconds-.05),'a timed Intake then Shoot still waits for the transfer');
  assert.equal(require('../ui/sim-steps.js').describe({action:'Intake',seconds:null},'pin'),'Intake on');
});

test('Intake no longer lowers a ramp; a Turret to angle at a pin waits for the turret',()=>{
  const model=new Mech.Model(mechanisms,0),runner=new Mech.Runner(mechanisms);
  const log=drive(runner,model,{name:'Intake',leg:0,moving:false,seconds:1},1);assert.ok(log.every(l=>l.cmd.intake&&l.cmd.ramp===false&&l.state.ramps[0]===0));
  const turn=drive(runner,model,{name:'Turret 1 to 90°',leg:1,moving:false},1,{t0:1});
  assert.ok(turn[0].busy,'busy while turning');const at=turn.findIndex(l=>!l.busy);assert.ok(at>0&&Math.abs(turn[at].state.turrets[0]-90)<=2,'done at 90°');
});

test('moving parts: "Arm to 40°" sends a part to any angle within its end stops, and a list of steps starts it',()=>{
  const model=K.sanitize({joints:[{id:'arm',name:'Arm',type:'revolute',axis:[0,1,0],lower:-10,upper:100,speed:200,states:{stow:0,out:90},drive:{signal:'action'}}]});
  const d=new K.Driver(model);assert.equal(d.start('Arm to 40°'),true);for(let i=0;i<50;i++)d.tick(.01,{});assert.ok(Math.abs(d.values().arm-40)<1e-6);
  assert.equal(d.start('Arm to 400 deg'),true);for(let i=0;i<100;i++)d.tick(.01,{});assert.equal(d.values().arm,100,'held at its upper end stop');assert.equal(d.busy('Arm to 400 deg'),false,'and done there');
  // A pin's steps start the part and wait for it, then go on.
  const off=Mech.sanitize({enabled:false}),runner=new Mech.Runner(off,{start:n=>d.start(n),busy:n=>d.busy(n)}),state=new Mech.Model(off,0).state();
  let now=0,busy=true,ticks=0;const act={name:'z',leg:0,moving:false,steps:[{action:'Arm stow',seconds:null},{action:'Wave',seconds:.2}]};
  while(busy&&ticks<300){now+=.01;busy=runner.commands(act,state,now).busy;d.tick(.01,{});ticks++;}
  assert.ok(Math.abs(d.values().arm)<1e-6,'the arm went to stow');assert.ok(ticks>50+20-3,'then the team\'s own step ran for its 0.2 s ('+ticks+' ticks)');
});

// A BIOBUZZ route with steps: Ramp down and a turret angle at pin 1, then Intake + Ramp up while driving to pin 2.
const start={x:30,y:24,heading:90},pins=[{x:30,y:40,steps:[{action:'Spin up'},{action:'Ramp down'},{action:'Turret to 45°'}]},{x:46,y:30,path:{steps:[{action:'Intake'},{action:'Ramp up',seconds:.4}]}}];
async function loaded(localization='fused'){const {SimEngine}=require('../src/sim-engine.cjs');let error='';
  const e=new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-steps-')),now:()=>0,emit:m=>{if(m?.state==='error')error=m.error;}});
  const info=await e.load({field:'biobuzz',alliance:'red',mechanisms,start,robot,sensors:{localization}});
  const route=P.plan({start,zones:[],pins:Mech.prepare(pins,mechanisms,null),clearance:1,style:'spline'},info.footprint,info.fieldZones,info.bounds);return {e,info,route,error:()=>error};}
const watch=async(e,step)=>{const log=[];for(let i=0;i<2400&&e.mode!=='idle'&&!e.result;i++){await step();const s=e.mechanismState(),t=e.truth();log.push({t:e.world.time,ramp:s.ramps[0],turret:s.turrets[0],intake:!!e.mechCmd.intake,x:t.x,y:t.y});}return log;};
function sequenceRan(log,what){
  const atPin=log.filter(l=>Math.hypot(l.x-30,l.y-40)<1.5),down=log.findIndex(l=>l.ramp===1),turned=log.findIndex(l=>Math.abs(l.turret-45)<=2);
  assert.ok(atPin.length,what+': reached pin 1');assert.ok(down>=0,what+': the ramp went down');assert.ok(turned>down,what+': the turret turned to 45° after the ramp was down');
  assert.ok(log.slice(0,down).every(l=>!l.intake),what+': no intake before the ramp step');
  const intaking=log.filter(l=>l.intake);assert.ok(intaking.length>10,what+': the intake ran while driving to pin 2');assert.equal(log.at(-1).ramp,0,what+': Ramp up on the path folded it back');}

test('the simulator runs the steps of a planned route',{skip},async()=>{
  const {e,route,error}=await loaded();try{const r=await e.run({route});assert.equal(r.ok,true,error());
    const log=await watch(e,()=>e.programTick());assert.ok(e.result,'the route finished: '+error());sequenceRan(log,'route');}finally{e.dispose();}
});

test('a timed route (IMU only) runs the same steps',{skip},async()=>{
  const {e,route,error}=await loaded('gyro');try{const r=await e.run({route});assert.equal(r.ok,true,error());assert.equal(e.mode,'timed');
    const log=await watch(e,()=>e.timedTick());assert.ok(e.result,'the route finished: '+error());
    // Timed driving lands near the pins, not on them: check the order of what the mechanisms did.
    const down=log.findIndex(l=>l.ramp===1),turned=log.findIndex(l=>Math.abs(l.turret-45)<=2);
    assert.ok(down>=0&&turned>down,'ramp down, then the turret');assert.ok(log.slice(0,down).every(l=>!l.intake)&&log.some(l=>l.intake),'the intake runs on the path after');assert.equal(log.at(-1).ramp,0);}finally{e.dispose();}
});

test('the exported Control Hub code runs the same steps on the virtual hub',{skip},async()=>{
  const {e,info,route,error}=await loaded();try{
    const layout={name:'Steps',field:'biobuzz',alliance:'red',width:144,height:144,start,zones:[]};
    const out=F.files({route,layout,tuning:info.tuning,robot:info.robot,localization:'fused',setupName:'Steps',mechanisms,target:Mech.target(mechanisms,'biobuzz','red'),routeJava:X.java(route,layout,{polygon:P.polygon})});
    const actions=out.files['org/firstinspires/ftc/teamcode/RouteActions.java'];assert.match(actions,/case "Spin up then Ramp down then Turret to 45°": return steps\(steps1, step\);/);assert.match(actions,/case "Intake \+ Ramp up 0\.4 s": return steps\(steps2, step\);/);
    assert.match(actions,/mech\.turnTurrets\(45\.0\);\n\s+return step\.moving \|\| mech\.aimed\(\);/);
    const r=await e.run({kind:'opmode',files:out.files,opMode:out.opMode});assert.equal(r.ok,true,error());
    const log=[];for(let i=0;i<2400&&e.mode==='program'&&e.telemetry?.Phase!=='Done';i++){await e.programTick();const s=e.mechanismState(),t=e.truth();log.push({t:e.world.time,ramp:s.ramps[0],turret:s.turrets[0],intake:!!e.mechCmd.intake,x:t.x,y:t.y});}
    assert.equal(e.telemetry?.Phase,'Done',error());for(let i=0;i<40;i++){await e.programTick();const s=e.mechanismState();log.push({...log.at(-1),ramp:s.ramps[0]});}sequenceRan(log,'Control Hub');
  }finally{e.dispose();}
});

test('timed routes and MotionModule run lists of steps; the .pp file keeps them',{skip},async()=>{
  const {e,route,error}=await loaded();try{
    // The timed runner (IMU only) holds at pin 1 for its steps.
    const plan=Timed.compile(route,{});const held=plan.steps.find(s=>s.action);assert.deepEqual(held.steps.map(s=>s.action),['Spin up','Ramp down','Turret to 45°']);
    assert.deepEqual(plan.steps.find(s=>s.movingSteps)?.movingSteps.map(s=>s.action),['Intake','Ramp up']);
    // MotionModule: each step is built in, and STEPS lists them.
    const py=MM.autonomous(route,Timed.settings({}),{name:'Steps',mechanisms,target:{x:59,y:58}});
    assert.match(py,/STEPS = \{\n {4}"Spin up then Ramp down then Turret to 45°": \(False, \(\("Spin up", 0\.0\), \("Ramp down", 0\.0\), \("Turret to 45°", 0\.0\),\)\),\n {4}"Intake \+ Ramp up 0\.4 s": \(True, \(\("Intake", 0\.0\), \("Ramp up", 0\.4\),\)\),\n\}/);
    assert.match(py,/return MECHANISMS\.run\("ramp", 1, step\)/);assert.match(py,/return MECHANISMS\.run\("turret", \(None, 45\.0\), step\)/);assert.match(py,/def call_steps\(self, name, step\):/);
    // Edited in the Pedro Visualizer (Deck's own pins dropped), the lines still carry the steps.
    const layout={name:'Steps',field:'biobuzz',start,zones:[]},file=JSON.parse(X.pp(route,layout,{bounds:e.info.bounds,polygon:P.polygon}));delete file.deck;
    const back=X.fromPP(file,{field:'biobuzz',bounds:e.info.bounds});const pin1=back.pins.find(p=>p.steps),path2=back.pins.find(p=>p.path?.steps);
    assert.deepEqual(P.pinEffects(pin1).steps.map(s=>s.action),['Spin up','Ramp down','Turret to 45°']);assert.deepEqual(P.pathEffects(path2.path).steps,[{action:'Intake',seconds:null,cell:'start'},{action:'Ramp up',seconds:.4,cell:'start'}]);
  }finally{e.dispose();}
});

// Path planning offers a game action only when the robot has the part that does it (Setup → Mechanisms).
require('node:test').test('the actions offered for a path or pin follow the robot\'s mechanisms',()=>{
  const assert=require('node:assert/strict'),S=require('../ui/sim-steps.js'),M=require('../ui/sim-mechanisms.js');
  const offered=m=>{const c=S.catalog({field:'biobuzz',mechanisms:M.sanitize(m)});return [...c.game,...(c.turrets.length?['Turret angle']:[])];};
  assert.deepEqual(offered({enabled:false}),[],'no mechanisms: none of the game\'s actions');
  assert.deepEqual(offered({enabled:true,intakes:[],shooters:[]}),[]);
  assert.deepEqual(offered({enabled:true,intakes:[{kind:'sweeper',sides:['front']}],shooters:[]}),['Intake']);
  assert.deepEqual(offered({enabled:true,intakes:[{kind:'ramp',sides:['front']}],shooters:[]}),['Intake','Ramp down','Ramp up']);
  assert.deepEqual(offered({enabled:true,intakes:[],shooters:[{type:'fixed'}]}),['Spin up','Shoot']);
  assert.deepEqual(offered({enabled:true,intakes:[{kind:'ramp',sides:['front']}],shooters:[{type:'turret'}]}),['Intake','Ramp down','Ramp up','Spin up','Aim','Shoot','Turret angle']);
});
