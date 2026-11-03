'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../ui/sim-report.js');
// A recorded run, 0.1 s per frame: each step is [seconds, leg (1-based) or 0, x, vx, omega, extra].
function run(steps,result){
  return steps.map(([time,leg,x,vx=0,omega=0,extra={}])=>({time,truth:{x,y:72,heading:0,vx,vy:0,omega},telemetry:leg?{leg:`${leg} of 3`}:{},contacts:[],hit:[],violations:[],...extra})).concat(result?[]:[]);
}
const pins=[{x:30,y:72},{x:60,y:72},{x:90,y:72,path:{power:.5}}];
function frames({contactAt=null,startWall=true,timeLimit=false}={}){
  const out=[];let x=9;
  // 0.0–0.2 s: starting, no leg yet, against the wall.
  for(let t=0;t<.2;t+=.1)out.push([+t.toFixed(2),0,x,0,0,{contacts:startWall?['field-wall']:[]}]);
  // Leg 1: drive 2 s. Leg 2: drive 1 s, then turn in place 1 s. Leg 3: pause 1.5 s for Intake, then drive 2 s.
  for(let t=.2;t<2.2;t+=.1){x+=1;out.push([+t.toFixed(2),1,x,20,0,{contacts:startWall&&t<.4?['field-wall']:[]}]);}
  for(let t=2.2;t<3.2;t+=.1){x+=1;out.push([+t.toFixed(2),2,x,20,0,{contacts:contactAt&&t>=contactAt&&t<contactAt+.3?['field-3']:[]}]);}
  for(let t=3.2;t<4.2;t+=.1)out.push([+t.toFixed(2),2,x,0,90]);
  for(let t=4.2;t<5.7;t+=.1)out.push([+t.toFixed(2),3,x,0,0,{wait:{stop:2,action:'Intake',remaining:1}}]);
  for(let t=5.7;t<7.7;t+=.1){x+=1;out.push([+t.toFixed(2),3,x,20,0]);}
  const f=run(out);const end=f.at(-1);
  end.result={reason:timeLimit?'time-limit':'finished',kind:'route',time:end.time,truth:{x:89.5,y:72,heading:0},estimate:{x:89,y:72,heading:0},violations:[]};
  return f;
}

test('teleop has no route result: it is reported only when asked to cover the whole run',()=>{
  const driven=run([[0,0,9],[1,0,20,20],[2,0,40,20,0,{contacts:['field-wall'],mechanisms:{score:12,shots:0,landed:0}}]]);
  assert.equal(R.build(driven,{pins}),null);
  const r=R.build(driven,{pins,whole:true});assert.equal(r.driven,true);assert.match(r.title,/^Teleop ran for 2\.0 s, with 1 thing to check/);
  assert.equal(r.contacts[0].label,'teleop');assert.equal(r.legs.length,0);assert.ok(r.facts.some(([k,v])=>k==='Points'&&/^12/.test(v)));
  assert.ok(!R.nextSteps(r,{onExport(){}}).some(s=>s.id==='export'));
});

test('a full match reports its route, adds the match points, and whole-run contacts reach into teleop',()=>{
  const route=frames(),end=route.at(-1),after=[{...end,time:end.time+1,practice:{phase:'teleop'},contacts:['field-wall'],mechanisms:{score:30}},{...end,time:end.time+2,practice:{phase:'teleop'},contacts:[],mechanisms:{score:42}}];
  const r=R.build([...route,...after],{pins,autoSeconds:30});assert.match(r.title,/^Route finished/);assert.ok(r.facts.some(([k,v])=>k==='Full match points'&&v==='42'));assert.ok(!r.contacts.some(c=>c.id==='field-wall'&&c.time>end.time));
  assert.ok(R.build([...route,...after],{pins,whole:true}).contacts.some(c=>c.id==='field-wall'&&c.time>end.time));
});

test('run report splits route time per path by driving, turning and pausing, from the recorded frames',()=>{
  const r=R.build(frames(),{pins,defaultPower:1,autoSeconds:30});
  assert.equal(r.level,'ok');assert.match(r.title,/^Route finished cleanly in 7\.7 s$/);
  assert.deepEqual(r.legs.map(l=>l.label),['Path 1','Path 2','Path 3']);assert.deepEqual(r.legs.map(l=>l.pin),[0,1,2]);
  const near=(a,b)=>assert.ok(Math.abs(a-b)<.06,`${a} ≈ ${b}`);
  near(r.legs[0].drive,2);near(r.legs[1].drive,1);near(r.legs[1].turn,1);near(r.legs[2].pause,1.5);near(r.legs[2].drive,2);near(r.before,.2);
  assert.deepEqual(r.legs[2].actions,['Intake']);near(r.legs[1].start,2.2);
  // Facts are the run's own numbers.
  assert.equal(r.facts[0][1],'7.7 s of the 30 s autonomous · 22.3 s to spare');assert.equal(r.auto,30,'the time bar is drawn on the period it ran in');assert.equal(r.facts.find(f=>f[0]==='Final position')[1],'0.5 in from the last end point');assert.equal(r.facts.find(f=>f[0]==='Contact')[1],'None');
  // Starting against the wall is not a route contact.
  assert.equal(r.contacts.length,0);assert.equal(r.issues.length,0);
  // Suggestions name the slowest path and the low-power one; never more than three.
  assert.ok(r.tips.length<=3);assert.match(r.tips.find(t=>/longest/.test(t.text)).text,/^Path 3 takes the longest: 3\.5 s of 7\.7 s, including 1\.5 s stopped for intake/);
  assert.ok(r.tips.some(t=>t.pin===2&&/50% motor power/.test(t.text)));
});

test('run report ties a contact to the path where it began and flags a run that ran out of time',()=>{
  const r=R.build(frames({contactAt:2.5}),{pins,defaultPower:1,autoSeconds:30});
  assert.equal(r.level,'bad');assert.equal(r.contacts.length,1);assert.deepEqual([r.contacts[0].kind,r.contacts[0].pin],['field',1]);
  assert.match(r.issues[0].text,/Touched a field structure during Path 2 at 2\.5 s/);assert.equal(r.issues[0].pin,1);
  const late=R.build(frames({timeLimit:true}),{pins,autoSeconds:7});assert.equal(late.level,'bad');assert.match(late.title,/before the route finished/);assert.match(late.tips[0].text,/more than the 7 s period \(it was on Path 3\)/);
});

test('legs are only linked to planner paths when the run has one leg per path',()=>{
  const r=R.build(frames(),{pins:pins.slice(0,2),autoSeconds:30});assert.deepEqual(r.legs.map(l=>[l.label,l.pin]),[['Leg 1',null],['Leg 2',null],['Leg 3',null]]);
  assert.equal(R.build([],{pins}),null);assert.equal(R.build(frames().map(({result,...f})=>f),{pins}),null,'no report before the run ends');
});

test('after a run the next step is fixing the path where something went wrong, else exporting the clean route',()=>{
  const go={onEdit:()=>{},onExport:()=>{},onOutput:()=>{}};
  const clean=R.nextSteps(R.build(frames(),{pins,autoSeconds:30}),go);assert.deepEqual(clean.map(s=>[s.id,s.primary]),[['export',true],['output',false]]);
  const hit=R.nextSteps(R.build(frames({contactAt:2.5}),{pins,autoSeconds:30}),go);assert.deepEqual(hit.map(s=>[s.id,s.primary]),[['fix',true],['export',false],['output',false]]);assert.equal(hit[0].label,'Fix path 2 →');
  // Out of time with no contact: the fix is the path it was on when the period ended.
  const late=R.nextSteps(R.build(frames({timeLimit:true}),{pins,autoSeconds:7}),go);assert.equal(late[0].label,'Fix path 3 →');
  assert.deepEqual(R.nextSteps(R.build(frames(),{pins,autoSeconds:30}),{}),[],'no actions without handlers');
});

test('tips that name a Route options setting say where it is and carry it, so the report can open it',()=>{
  const tips=[...R.build(frames({contactAt:2.5}),{pins,autoSeconds:30,optimized:false}).tips,...R.build(frames(),{pins:[pins[0],pins[1],{...pins[2],path:{power:1}}],autoSeconds:30,optimized:false}).tips];
  const named=tips.filter(t=>/Optimize|Space around obstacles/.test(t.text));assert.ok(named.length>=1,tips.map(t=>t.text).join('\n'));
  for(const t of named){assert.match(t.text,/Path planning → Route options/);assert.ok(['optimize','clearance'].includes(t.setting),t.text);}
});
