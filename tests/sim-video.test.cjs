'use strict';
// Run videos (Run & review → Record, and Export → Run video): the parts of a run, the writing over the picture and the file names.
const {test}=require('node:test'),assert=require('node:assert/strict');
const V=require('../ui/sim-video.js');

const run=phases=>phases.map((phase,i)=>({time:10+i*.5,truth:{x:0,y:0,heading:0},practice:phase?{phase,remaining:30-i*.5}:undefined}));

test('a full match splits into autonomous and teleop, without the transition',()=>{
  const s=V.sections(run(['auto','auto','auto','transition','transition','teleop','teleop','finished']));
  assert.deepEqual(s,{all:[0,7],auto:[0,2],teleop:[5,6]});
  assert.deepEqual(V.sections(run(['teleop','teleop'])),{all:[0,1],auto:null,teleop:[0,1]});
  assert.deepEqual(V.sections([]),{all:null,auto:null,teleop:null});
  // A run without a practice timer is the autonomous.
  assert.deepEqual(V.sections(run([null,null,null])),{all:[0,2],auto:[0,2],teleop:null});
});

test('a video of an autonomous on its own ends a second after the robot finishes; teleop and a match stay whole',()=>{
  const clocked=(phase,n,extra={})=>Array.from({length:n},(_,i)=>({time:i,practice:{phase},...extra,...(extra.result&&i<3?{result:undefined}:{})}));
  const held=clocked('auto',10,{result:{time:3}});assert.equal(V.editable(held).at(-1).time,4);
  const teleop=clocked('teleop',10);assert.equal(V.editable(teleop),teleop);
  const match=[...clocked('auto',4,{result:{time:2}}),...clocked('teleop',2).map(f=>({...f,time:f.time+4,result:{time:2}}))];assert.equal(V.editable(match),match);
  const stopped=clocked('auto',5);assert.equal(V.editable(stopped),stopped);
});

test('MP4 is preferred and WebM is the fallback',()=>{
  assert.deepEqual(V.pickType(t=>t.startsWith('video/mp4')),{type:'video/mp4;codecs=avc1.640028',ext:'mp4'});
  assert.deepEqual(V.pickType(t=>t==='video/webm;codecs=vp8'),{type:'video/webm;codecs=vp8',ext:'webm'});
  assert.equal(V.pickType(()=>false),null);
  assert.equal(V.pickType(()=>{throw Error('no');}),null);
});

test('the bar shows the period clock, the name and the points',()=>{
  assert.deepEqual(V.caption({time:3,practice:{phase:'auto',remaining:27.2},mechanisms:{score:12}},{name:'Red auto'}),{phase:'Autonomous',color:'#2f8f5b',time:'0:28',name:'Red auto',score:'12 pts'});
  assert.equal(V.caption({time:3,practice:{phase:'teleop',remaining:95}}).time,'1:35');
  assert.equal(V.caption({time:3,practice:{phase:'teleop',remaining:0}}).time,'0:00');
  // No timer: seconds since filming started.
  assert.equal(V.caption({time:14.25},{start:10}).time,'4.3 s');
  assert.equal(V.caption(null).phase,'Run');
});

test('the bottom line says how fast the robot goes and what its shooter does',()=>{
  const f=(m,extra={})=>({time:1,truth:{x:0,y:0,heading:0,vx:30,vy:40},mechanisms:m,...extra});
  assert.equal(V.detail(f(undefined)),'50 in/s');
  assert.equal(V.detail(f({held:2,flywheel:.5,command:{spin:true}})),'50 in/s  ·  2 held  ·  spinning up');
  assert.equal(V.detail(f({held:2,flywheel:1,ready:true,aligned:true,command:{aim:true}})),'50 in/s  ·  2 held  ·  on target');
  assert.equal(V.detail(f({held:1,flywheel:1,ready:true,aligned:true,command:{feed:true}},{acting:'Shoot'})),'50 in/s  ·  1 held  ·  shooting  ·  Shoot');
  assert.equal(V.detail(f({held:0,flywheel:0,command:{intake:true}})),'50 in/s  ·  0 held  ·  intaking');
  assert.equal(V.detail(null),'');
});

test('file names are safe and say which part of the run and which camera they are',()=>{
  assert.equal(V.title('Red: auto / cycles','auto','3d'),'Red auto cycles - Autonomous - 3D');
  assert.equal(V.title('','teleop','2d'),'Deck run - Teleop - 2D');
  assert.equal(V.title('../..\\x','all'),'x - Whole run');
  assert.deepEqual(Object.keys(V.VIEWS),['2d','3d']);
});
