'use strict';
// The engine drives the robot's joints from its mechanism model and sends their values in every frame.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Mech=require('../ui/sim-mechanisms.js'),K=require('../ui/sim-kinematics.js');
const root=path.join(__dirname,'..'),built=fs.existsSync(path.join(root,'sim-runtime/dsim-host.cjs'));
const robot={drivetrain:'mecanum',length:17,width:17,heightIn:12,driveRpm:312,intakeIn:0};
const kinematics={model:'0123456789abcdef0123456789abcdef.glb',joints:[
  {id:'turret1',type:'continuous',axis:[0,0,1],zero:-90,drive:{signal:'turret',of:'shooter:0'},parts:['#1']},
  {id:'hood1',type:'revolute',parent:'turret1',axis:[0,1,0],states:{rest:0,shoot:15},speed:60,drive:{signal:'hood',of:'shooter:0'}},
  {id:'fly1',type:'continuous',parent:'turret1',axis:[0,1,0],drive:{signal:'flywheel',of:'shooter:0'}},
  {id:'ramp1',type:'revolute',axis:[0,1,0],states:{raised:0,lowered:70},drive:{signal:'deploy',of:'intake:0'}},
  {id:'roll1',type:'continuous',parent:'ramp1',axis:[0,1,0],rpm:120,drive:{signal:'roller',of:'intake:0'}}]};
const pad=(buttons={},axes=[0,0,0,0])=>({mapping:'standard',axes,buttons:Array.from({length:17},(_,i)=>({pressed:!!buttons[i],value:buttons[i]?1:0}))});
test('frames carry joint values: the ramp folds down on Y and stays there, the hood tilts and the flywheel spins while shooting',{skip:!built&&'run node tools/simulation/build.cjs first'},async()=>{
  const {SimEngine}=require('../src/sim-engine.cjs'),frames=[];
  const e=new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-joints-')),now:()=>0,emit:m=>{if(m?.type==='frame')frames.push(m);}});
  const mechanisms=Mech.sanitize({enabled:true,intakes:[{kind:'ramp',sides:['front'],down:.3,up:.3}],shooters:[{type:'turret',pieces:'pollen',mount:'center'}]});
  try{await e.load({field:'biobuzz',alliance:'red',mechanisms,kinematics,start:{x:30,y:24,heading:90},robot,sensors:{localization:'fused'}});
    const first=e.frame();assert.deepEqual(Object.keys(first.joints).sort(),['fly1','hood1','ramp1','roll1','turret1']);
    assert.equal(first.joints.turret1,90,'the turret starts facing the front: 90° from where the CAD has it');
    await e.startPractice({mode:'teleop',timing:{autoSeconds:30,transitionSeconds:8,teleopSeconds:120}});
    e.practiceInput(pad());await e.practiceTick();
    // Right bumper: intake. The rollers turn; the ramp stays up (it moves only when sent).
    for(let i=0;i<30;i++){e.practiceInput(pad({5:true}));await e.practiceTick();}
    let j=e.frame().joints;assert.equal(j.ramp1,0,'intaking leaves the ramp up');e.practiceInput(pad({5:true}));await e.practiceTick();assert.notEqual(e.frame().joints.roll1,j.roll1,'rollers turning');
    // Y: the ramp folds down over its 0.3 s, and stays down after Y is let go.
    e.practiceInput(pad({3:true}));await e.practiceTick();for(let i=0;i<30;i++){e.practiceInput(pad());await e.practiceTick();}
    assert.equal(e.frame().joints.ramp1,70,'all the way down after 0.5 s');
    // Y again: it folds back up.
    e.practiceInput(pad({3:true}));await e.practiceTick();for(let i=0;i<30;i++){e.practiceInput(pad());await e.practiceTick();}assert.equal(e.frame().joints.ramp1,0);
    // Left trigger: spin up. The hood heads for its shooting tilt at 60°/s; the flywheel spins (drawn at the capped rate).
    const before=e.frame().joints.fly1;for(let i=0;i<12;i++){e.practiceInput(pad({6:true}));await e.practiceTick();}
    j=e.frame().joints;assert.ok(j.hood1>5&&j.hood1<15,`hood on its way (${j.hood1})`);assert.notEqual(j.fly1,before,'flywheel turning');
    for(let i=0;i<30;i++){e.practiceInput(pad({6:true}));await e.practiceTick();}assert.equal(e.frame().joints.hood1,15,'hood at its shooting tilt');
    // The turret joint is the mechanism model's turret angle less the CAD's heading.
    const s=e.mechanismState();assert.ok(Math.abs(e.frame().joints.turret1-(s.turrets[0]+90))<1e-3);
    assert.ok(frames.every(f=>f.joints),'every frame carries them');
  }finally{e.dispose();}
});
test('no joints, no joint values: frames stay as they were',{skip:!built&&'run node tools/simulation/build.cjs first'},async()=>{
  const {SimEngine}=require('../src/sim-engine.cjs'),e=new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-nojoints-')),now:()=>0,emit:()=>{}});
  try{await e.load({field:'empty',start:{x:30,y:24,heading:0},robot,sensors:{localization:'fused'}});assert.equal(e.frame().joints,null);}finally{e.dispose();}
});
test('the engine gets joints without their part lists',()=>{
  const m=K.forEngine(kinematics);assert.ok(m.joints.every(j=>!('parts' in j)));assert.equal(m.joints.length,5);
});
test('a route action naming a part and a position moves that part during the run, on any field',{skip:!built&&'run node tools/simulation/build.cjs first'},async()=>{
  const {SimEngine}=require('../src/sim-engine.cjs'),P=require('../ui/sim-planner.js'),e=new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-liftroute-')),now:()=>0,emit:()=>{}});
  const kin={model:null,joints:[{id:'lift',name:'Lift',type:'prismatic',axis:[0,0,1],lower:0,upper:20,states:{down:0,up:12},speed:8,drive:{signal:'action'}}]},start={x:30,y:30,heading:0};
  try{const info=await e.load({field:'empty',width:144,height:144,start,robot,kinematics:kin,sensors:{localization:'fused'}});
    const r=P.plan({start,zones:[],pins:[{x:50,y:30,wait:2,action:'Lift up'},{x:60,y:30}],clearance:2,defaultPower:1},info.footprint,info.fieldZones,info.bounds);r.defaultPower=1;
    const started=await e.run({kind:'route',route:r});assert.ok(started.ok,started.error);let top=0;
    for(let i=0;i<3600&&e.mode==='program';i++){await e.programTick();top=Math.max(top,e.frame().joints.lift);}
    assert.equal(top,12,'the lift went up to 12 in at the pin');
  }finally{e.dispose();}
});
test('a route action name resolves the same way for the simulator and the exporter: an action, or a part to a value',()=>{
  const model=K.sanitize({joints:[{id:'lift',name:'Lift',type:'prismatic',axis:[0,0,1],lower:0,upper:20,states:{down:0,up:12},drive:{signal:'action'}},{id:'arm',name:'Arm',type:'revolute',axis:[0,1,0],lower:-10,upper:180,states:{stow:0,up:90}}],
    actuators:[{id:'armServo',name:'Arm servo',joint:'arm',kind:'servo',speed:90}],actions:[{name:'Score',steps:[{actuator:'armServo',command:{state:'up'}}]}]});
  const r=K.resolveAction(model,' score ');assert.equal(r.kind,'steps');assert.equal(r.action.name,'Score');assert.equal(r.steps,model.actions[0].steps);
  assert.deepEqual(K.resolveAction(model,'Lift up'),{kind:'move',joint:'lift',value:12,state:'up'});
  assert.deepEqual(K.resolveAction(model,'Lift to 30 in'),{kind:'move',joint:'lift',value:20},'held at its end stop');
  assert.deepEqual(K.resolveAction(model,'Arm up'),{kind:'move',actuator:'armServo',value:90,state:'up'},'an actuator by its joint\'s name');
  assert.deepEqual(K.resolveAction(model,'Arm servo to -45°'),{kind:'move',actuator:'armServo',value:-10});
  assert.equal(K.resolveAction(model,'Lift sideways'),null);assert.equal(K.resolveAction(model,'Intake'),null);
  // Driver.start moves exactly what the resolver names, and busy() follows it.
  const d=new K.Driver(model);assert.equal(d.start('Lift up'),true);assert.equal(d.busy('lift up'),true);assert.equal(d.start('Intake'),false);
  for(let i=0;i<240;i++)d.tick(1/60);assert.equal(d.values().lift,12);assert.equal(d.busy('lift up'),false);
  assert.equal(d.start('Score'),true);for(let i=0;i<120;i++)d.tick(1/60);assert.equal(d.values().arm,90);
  assert.equal(K.moveSeconds(90,90),1,'moveSeconds is exported for the exporter\'s timed fallback');
});
test('a servo kicker feeder swings to its feed position and back; a feeder wheel keeps spinning',()=>{
  const model=K.sanitize({joints:[{id:'kick',type:'revolute',axis:[0,1,0],lower:0,upper:60,states:{rest:0,feed:40},speed:400,drive:{signal:'feeder',of:'shooter:0'}},
    {id:'wheel',type:'continuous',axis:[0,1,0],rpm:200,drive:{signal:'feeder',of:'shooter:0'}}]}),d=new K.Driver(model);
  let top=0;for(let i=0;i<9;i++){d.tick(1/60,{feed:true});top=Math.max(top,d.values().kick);}
  assert.equal(d.values().kick,40,'at its feed position after 0.15 s (40° at 400°/s)');assert.ok(top<=40);assert.ok(d.values().wheel>0,'the wheel spins while feeding');
  for(let i=0;i<9;i++)d.tick(1/60,{feed:false});assert.equal(d.values().kick,0,'back at rest');
  const still=d.values().wheel;d.tick(1/60,{feed:false});assert.equal(d.values().wheel,still,'the wheel stops when not feeding');
});
