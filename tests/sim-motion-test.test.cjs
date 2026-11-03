'use strict';
// The range of motion test: what each mechanism's range is, and what its real surfaces run into across that range.
const {test}=require('node:test'),assert=require('node:assert/strict'),D=require('../ui/sim-discovery.js'),K=require('../ui/sim-kinematics.js'),C=require('../ui/sim-collide.js'),T=require('../ui/sim-motion-test.js'),S=require('./fixtures/mechanism-shapes.cjs');
Object.assign(globalThis,{DeckKinematics:K,DeckDiscovery:D,DeckCollide:C});
// A frame, a post 10 in along +y, and an arm along +x pivoting up about z.
function robot(extra){
  const b=S.builder(),root=b.node('Robot'),base=b.node('Base',root),arm=b.node('Arm',root);
  b.add(b.node('Plate',base),S.box([-2,-2,-1],[2,2,0]));const post=b.add(b.node('Post',base),S.box([-.5,9.5,0],[.5,10.5,6]));
  const bar=b.add(b.node('Bar',arm),S.box([0,-.25,1],[12,.25,1.5]));
  extra?.(b,root,base,arm);return {ctx:D.prepare(b.arrays()),post,bar};
}
const arm=(o={})=>({id:'arm',name:'Arm',type:'revolute',axis:[0,0,1],parts:['Robot/Arm'],...o});
test('an arm stops being clear where its surface reaches the post, and the far way it is clear',()=>{
  const {ctx,post,bar}=robot(),model=K.sanitize({joints:[arm({lower:-90,upper:170})]}),r=C.rangeSweep(ctx,model,{joint:'arm',lower:-90,upper:170});
  assert.equal(r.free[0],-90,'clear to its lower limit');
  const want=(Math.atan2(9.5,.5)-Math.asin(.25/Math.hypot(.5,9.5)))*180/Math.PI;assert.ok(Math.abs(r.free[1]-want)<1,`clear to about ${want.toFixed(1)}° (${r.free[1]}°)`);
  assert.deepEqual(r.hits.map(h=>[h.a,h.b]),[[post,bar]].map(([p,q])=>r.hits[0].a===q?[q,p]:[p,q]),'only the bar and the post');
  assert.ok(r.hits[0].names.includes('Post'));
});
test('a range that stops before the post is clear; a cap past a full turn sweeps only once round',()=>{
  const {ctx}=robot();let model=K.sanitize({joints:[arm({lower:-90,upper:60})]}),r=C.rangeSweep(ctx,model,{joint:'arm',lower:-90,upper:60});
  assert.deepEqual([r.hits.length,r.free],[0,[-90,60]]);
  model=K.sanitize({joints:[arm({lower:0,upper:500})]});r=C.rangeSweep(ctx,model,{joint:'arm',lower:0,upper:500});
  assert.ok(r.hits.length&&r.free[1]<90,'it still meets the post on the way');assert.ok(r.samples<400,'once round is enough');
});
test('an arm clear all round is clear up to its 500° cap',()=>{
  const b=S.builder(),root=b.node('Robot'),base=b.node('Base',root),a=b.node('Arm',root);b.add(b.node('Plate',base),S.box([-2,-2,-1],[2,2,0]));b.add(b.node('Bar',a),S.box([0,-.25,1],[6,.25,1.5]));
  const ctx=D.prepare(b.arrays()),model=K.sanitize({joints:[arm({lower:-20,upper:500})]}),r=C.rangeSweep(ctx,model,{joint:'arm',lower:-20,upper:500});assert.deepEqual([r.hits.length,r.free],[0,[-20,500]]);
});
test('parts touching at zero are assembled, until one is pushed into the other: an arm on its stop cannot go through it',()=>{
  const {ctx}=robot((b,root,base)=>{b.add(b.node('Stop',base),S.box([3,-1.25,1],[4,-.25,1.5]));}),model=K.sanitize({joints:[arm({lower:-30,upper:30})]});
  const r=C.rangeSweep(ctx,model,{joint:'arm',lower:-30,upper:30});
  assert.ok(r.hits.some(h=>h.names.includes('Stop')&&h.first<0),'turning into its stop is a contact');assert.equal(r.free[1],30,'turning away from it is clear');assert.ok(r.free[0]<0&&r.free[0]>-30);
});
test('a part spinning round its own axis cannot hit anything, belts are left out, and meshing gears do not count',()=>{
  const b=S.builder(),root=b.node('Robot'),base=b.node('Base',root),wheel=b.node('Wheel',root),a=b.node('Arm',root);
  b.add(b.node('Plate',base),S.box([-6,-6,-3],[6,6,-1]));b.add(b.node('Timing Belt',base),S.box([2,-1,1],[3,1,2]));
  b.add(b.node('Roller',wheel),S.cylinder({center:[0,0,0],axis:[0,0,1],r:1,length:1}));b.add(b.node('Bar',a),S.box([1.5,-.25,1.2],[5,.25,1.8]));
  const ctx=D.prepare(b.arrays()),model=K.sanitize({joints:[{id:'wheel',name:'Wheel',type:'continuous',axis:[0,0,1],parts:['Robot/Wheel']},arm({lower:-40,upper:40})]});
  assert.ok(C.rangeSweep(ctx,model,{joint:'wheel',lower:-180,upper:180}).spins);
  const r=C.rangeSweep(ctx,model,{joint:'arm',lower:-40,upper:40});assert.deepEqual([r.hits.length,r.free],[0,[-40,40]],'the belt in its path does not count');
  assert.equal(C.scene(ctx,model).flexible.length,1);
});
test('two arms each clear alone can meet together, and the pair is reported with where',()=>{
  const b=S.builder(),root=b.node('Robot'),base=b.node('Base',root),l=b.node('Left',root),r=b.node('Right',root);
  b.add(b.node('Plate',base),S.box([-1,-1,-4],[1,1,-3]));b.add(b.node('Left bar',l),S.box([0,3,0],[6,3.5,1]));b.add(b.node('Right bar',r),S.box([0,-3.5,0],[6,-3,1]));
  const ctx=D.prepare(b.arrays()),model=K.sanitize({joints:[{id:'left',name:'Left',type:'revolute',axis:[0,0,1],origin:[0,3.25,0],parts:['Robot/Left'],lower:-60,upper:0},{id:'right',name:'Right',type:'revolute',axis:[0,0,1],origin:[0,-3.25,0],parts:['Robot/Right'],lower:0,upper:60}]});
  const a=C.rangeSweep(ctx,model,{joint:'left',lower:-60,upper:0}),c=C.rangeSweep(ctx,model,{joint:'right',lower:0,upper:60});assert.deepEqual([a.hits.length,c.hits.length],[0,0],'each is clear by itself');
  const items=[{joint:'left',lower:-60,upper:0},{joint:'right',lower:0,upper:60}];assert.deepEqual(C.combos(ctx,model,items),[['left','right']]);
  const p=C.pairSweep(ctx,model,{a:items[0],b:items[1]});assert.ok(p.hits.length>0);assert.ok(p.hits[0].at.left<0&&p.hits[0].at.right>0);assert.deepEqual([...p.hits[0].names].sort(),['Left bar','Right bar']);
  const again=C.pairSweep(ctx,model,{a:items[0],b:items[1],ignore:p.hits.map(h=>h.a+':'+h.b)});assert.equal(again.hits.length,0,'a contact its own sweep found is not said twice');
});
test('the range of each mechanism: limits, all the way round, a cap, its aim, its positions, not set',()=>{
  const mech={turret:{min:-170,max:170}},j=o=>K.sanitize({joints:[{id:'x',name:'X',parts:['a'],axis:[0,0,1],...o}]}).joints[0],of=o=>T.rangeOf(j(o),{mechanisms:mech,model:{couplings:[]}});
  assert.deepEqual(['kind','lower','upper'].map(k=>of({type:'revolute',lower:-10,upper:500})[k]),['limits',-10,500],'a 500° cap');
  assert.equal(of({type:'continuous'}).kind,'free');
  assert.equal(of({type:'revolute'}).kind,'unset','a pivot with no limits or positions needs a range');
  assert.deepEqual(['kind','lower','upper'].map(k=>of({type:'revolute',states:{down:40,up:0}})[k]),['positions',0,40]);
  assert.deepEqual(['kind','lower','upper'].map(k=>of({type:'continuous',drive:{signal:'turret',of:'shooter:0'}})[k]),['aim',-170,170]);
  assert.equal(of({type:'continuous',free:true,drive:{signal:'turret',of:'shooter:0'}}).kind,'free','the team says it has a slip ring');
  assert.equal(T.rangeOf({...j({type:'revolute'}),parts:[]},{}).kind,'none');
  assert.equal(T.rangeOf(j({type:'revolute'}),{model:{couplings:[{from:'y',to:'x'}]}}).kind,'follows');
  const r=j({type:'revolute'});T.setRange(r,{lower:0,upper:500});assert.deepEqual([r.type,r.lower,r.upper],['revolute',0,500]);T.setRange(r,{free:true});assert.deepEqual([r.type,r.lower,r.upper,r.free],['continuous',undefined,undefined,true]);T.setRange(r,{lower:-5,upper:5});assert.deepEqual([r.type,r.free],['revolute',undefined]);
});
test('it says what each range is and what is wrong before anything moves',()=>{
  const j={id:'x',name:'X',type:'revolute',axis:[0,0,1],parts:['a'],states:{out:600}},cap=T.rangeOf({...j,lower:0,upper:500},{});
  assert.match(T.describe(j,cap),/\+500° the other: 500° in all.*1\.39 turns/);
  assert.match(T.describe(j,{kind:'free',unit:'°',lower:-180,upper:180}),/all the way round/);
  const lim=(lower,upper)=>T.setupIssues({...j,lower,upper},T.rangeOf({...j,lower,upper},{}),{}).map(i=>i.text).join(' ');
  assert.match(lim(10,40),/Zero is outside its range/);assert.match(lim(0,500),/“out” \(\+600°\) is outside its range/);
  assert.match(T.setupIssues(j,{kind:'unset',unit:'°'},{})[0].text,/not set/);
  assert.match(T.setupIssues({...j,drive:{signal:'turret'},states:{},lower:-90,upper:90},{kind:'limits',unit:'°',lower:-90,upper:90},{mechanisms:{turret:{min:-170,max:170}}})[0].text,/stop short/);
});
test('the verdict and summary count problems, and a clean run says so',()=>{
  const r={kind:'limits',unit:'°',lower:-90,upper:170},bad={free:[-90,86],hits:[{a:1,b:2,first:86.5,last:170,names:['Bar','Post']},{a:3,b:2,first:90,last:170,names:['Hub','Post']}]};
  assert.equal(T.verdict(bad,r).level,'hit');assert.match(T.verdict(bad,r).text,/−90° to 86°/);
  const lines=T.hitLines(bad,r);assert.equal(lines.length,1,'grouped by what it hits');assert.match(lines[0].text,/“Bar”, “Hub” hits “Post” at 86.5°/);
  assert.equal(T.verdict({spins:true,hits:[]},r).level,'ok');
  assert.equal(T.pivotSuspect(bad),false);assert.equal(T.pivotSuspect({hits:[{names:['Arm','8x14x5mm Bearing']}]}),true);
  assert.match(T.summary([{issues:[],result:bad}],[{hits:[{}]}]).text,/2 problems found: 1 mechanism run into something, and 1 pair of mechanisms meet/);
  assert.equal(T.summary([{issues:[],result:{hits:[],free:[0,1]}}],[]).clear,true);
  assert.match(T.summary([{issues:[{level:'block',text:''}]}],[]).text,/still needs a range/);
});
