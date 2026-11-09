'use strict';
// An intake that picks up only on its rollers: the rollers are a column from one end wheel to the other (Configure from
// CAD measures it, or the team picks the two end wheels on the model), and a piece is taken only when it touches them,
// not anywhere in the intake's box.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Mech=require('../ui/sim-mechanisms.js');
const root=path.join(__dirname,'..'),built=fs.existsSync(path.join(root,'sim-runtime/dsim-host.cjs'));
const robot={drivetrain:'mecanum',length:17,width:17,heightIn:12,driveRpm:312,intakeIn:0};
const box={kind:'sweeper',sides:['front'],reach:4,width:16,height:8},rollers={...box,pickup:'rollers',column:{a:[8,-3,2],b:[8,3,2],d:2}};

test('the column is saved with the intake; picking up on the rollers needs one',()=>{
  const m=Mech.sanitize({enabled:true,intakes:[{...rollers,column:{...rollers.column,by:'hand',d:99}}]});
  assert.deepEqual(m.intakes[0].column,{a:[8,-3,2],b:[8,3,2],d:12,by:'hand'});assert.equal(m.intakes[0].pickup,'rollers');
  assert.equal(Mech.sanitize({enabled:true,intakes:[{...box,pickup:'rollers'}]}).intakes[0].pickup,undefined,'no column: anywhere in the box');
  assert.equal(Mech.sanitize({enabled:true,intakes:[{...rollers,column:{a:[8,0],b:[8,3,2],d:2}}]}).intakes[0].column,undefined,'a broken column is dropped');
  assert.equal(Mech.sanitize({enabled:true,intakes:[{...rollers,kind:'kicker'}]}).intakes[0].column,undefined,'a kicker has no rollers');
});
test('the mouth ends at the rollers’ outer face, on whichever edge they are',()=>{
  const c={a:[8,-3,2],b:[8,3,2],d:2};
  assert.equal(Mech.columnReach(c,'front',robot),.5,'8 in out plus 1 in of wheel, past a 17 in robot’s 8.5 in edge');
  assert.equal(Mech.columnReach({a:[-3,9,2],b:[3,9,2],d:2},'left',robot),1.5);assert.equal(Mech.columnReach(c,'back',robot),0,'not past the back');
});

// A robot driving slowly at one pollen ahead of it, lateral inches off its centre line; how many it holds after 4 s.
async function pickup(intake,lateral){const {SimEngine}=require('../src/sim-engine.cjs'),e=new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-column-')),now:()=>0,emit:()=>{}});
  try{await e.load({field:'biobuzz',alliance:'red',mechanisms:Mech.sanitize({enabled:true,intakes:[intake],shooters:[],capacity:{pollen:3,nectar:0},preload:{pollen:0,nectar:0}}),robot,start:{x:60,y:60,heading:0},sensors:{localization:'fused'}});
    const r=e.world.robots[0],h=r.heading,ball=e.world.balls.find(b=>b.state?.kind==='ground'&&!/red|blue/.test(b.color||''));
    for(const b of e.world.balls)if(b!==ball)b.pos={x:-500,y:-500};
    ball.pos={x:r.pos.x+16*Math.cos(h)-lateral*Math.sin(h),y:r.pos.y+16*Math.sin(h)+lateral*Math.cos(h)};ball.vel={x:0,y:0};
    e.mechCmd={intake:true,spin:false,aim:false,feed:false};for(let i=0;i<240;i++)e.tick({forward:.25,strafe:0,turn:0});return r.hopper.length;}finally{e.dispose();}}
test('a piece is taken only where it touches the rollers, not anywhere in the box',{skip:!built&&'run node tools/simulation/build.cjs first'},async()=>{
  assert.equal(await pickup(box,0),1,'the box takes a piece ahead');assert.equal(await pickup(box,6.5),1,'and one near its side');
  assert.equal(await pickup(rollers,0),1,'the rollers take the piece they touch');
  assert.equal(await pickup(rollers,4.5),0,'beside the end wheel: it touches no roller');assert.equal(await pickup(rollers,6.5),0,'in the box but past the rollers');
});

// A roller on a floating arm in a slot (nothing drives it): it starts at the bottom of the slot whatever pose the CAD shows,
// a pollen (2.8 in) that fits the gap under it there barely moves it, and a nectar (3.6 in) lifts it to the top.
test('a floating roller arm starts at the bottom of its slot and lifts only as far as the piece under it needs',()=>{
  const K=require('../ui/sim-kinematics.js');
  const arm={id:'arm1',name:'Roller arm · intake 1',type:'revolute',origin:[0,0,0],axis:[1,0,0],lower:-26.5,upper:.5,home:[-26.5],states:{rest:-26.5,up:.5},gaps:{rest:2.76,up:3.58},drive:{signal:'float',of:'intake:0'}};
  const model=K.sanitize({joints:[arm]});assert.deepEqual(model.joints[0].gaps,{rest:2.76,up:3.58},'the gaps are kept');
  const d=new K.Driver(model);assert.equal(d.values().arm1,-26.5,'it starts at the bottom, not where the CAD drew it');
  const at=(lift,piece)=>{d.tick(.02,{lift:[lift],piece});return d.values().arm1;};
  assert.equal(at(0,null),-26.5,'nothing under it: it rests');
  const small=at(1,2.8),big=at(1,3.6);
  assert.ok(small>-26.5&&small<-24,`a pollen fits under it, so it barely moves (${small}°)`);assert.equal(big,.5,'a nectar lifts it to the top of the slot');
  assert.equal(at(.5,3.6),-13,'and it settles back as the piece passes');
});
