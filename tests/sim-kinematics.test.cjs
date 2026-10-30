'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),K=require('../ui/sim-kinematics.js');
const {apply,applyDir}=K.math,near=(a,b,tol=1e-6,msg)=>{const x=[].concat(a),y=[].concat(b);x.forEach((v,i)=>assert.ok(Math.abs(v-y[i])<=tol,`${msg||''} ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`));};
const model=raw=>K.sanitize(raw);
test('revolute joint turns its link about its own origin and axis, not the frame origin',()=>{
  const m=model({joints:[{id:'arm',type:'revolute',origin:[10,0,0],axis:[0,0,1]}]});
  const {W}=K.pose(m,{arm:90});near(apply(W.get('arm'),[12,0,0]),[10,2,0],1e-9,'point 2 in out from the pivot swings to +y');
  near(apply(W.get('arm'),[10,0,5]),[10,0,5],1e-9,'points on the axis stay');
});
test('nested joints compose: a hood on a turret pivots about an axis the turret carries',()=>{
  const m=model({joints:[{id:'turret',type:'continuous',origin:[0,0,0],axis:[0,0,1]},{id:'hood',type:'revolute',parent:'turret',origin:[2,0,10],axis:[0,1,0]}]});
  // Hood tip 3 in forward of its pivot. Hood up 90° about +y (tip goes to -z... right-hand about +y takes +x to -z), then turret 90°.
  const {W}=K.pose(m,{turret:90,hood:90});near(apply(W.get('hood'),[5,0,10]),[0,2,7],1e-9);
  // The turret alone carries the hood pivot round.
  near(apply(K.pose(m,{turret:180}).W.get('hood'),[2,0,10]),[-2,0,10],1e-9);
});
test('prismatic, cylindrical and screw joints move in inches whatever the CAD unit',()=>{
  // CAD in millimetres: 1 unit is 1/25.4 in.
  const m=model({unit:1/25.4,joints:[{id:'lift',type:'prismatic',origin:[0,0,0],axis:[0,0,2]},{id:'cyl',type:'cylindrical',axis:[1,0,0]},{id:'nut',type:'screw',axis:[0,0,1],lead:.5}]});
  near(apply(K.pose(m,{lift:2}).W.get('lift'),[0,0,0]),[0,0,50.8],1e-9,'2 in = 50.8 mm along the axis (axis length does not matter)');
  near(apply(K.pose(m,{cyl:[90,1]}).W.get('cyl'),[0,1,0]),[25.4,0,1],1e-9,'turns about x then slides 1 in');
  near(apply(K.pose(m,{nut:720}).W.get('nut'),[0,0,0]),[0,0,25.4],1e-9,'two turns of a 0.5 in lead screw = 1 in');
});
test('universal, ball, planar, floating and pin-slot joints',()=>{
  const m=model({joints:[{id:'u',type:'universal',origin:[0,0,0],axis:[0,0,1],axis2:[1,0,0]},{id:'b',type:'ball',origin:[1,1,1],axis:[0,0,1],axis2:[1,0,0]},{id:'p',type:'planar',axis:[0,0,1],axis2:[1,0,0]},{id:'f',type:'floating',axis:[0,0,1],axis2:[1,0,0]},{id:'s',type:'pinslot',origin:[0,0,0],axis:[0,0,1],axis2:[1,0,0]}]});
  near(apply(K.pose(m,{u:[90,90]}).W.get('u'),[0,1,0]),[0,0,1],1e-9,'universal: 90 about z (carried x becomes y) then 90 about carried x');
  near(apply(K.pose(m,{b:[0,0,0]}).W.get('b'),[3,2,1]),[3,2,1],1e-12,'ball at zero is the rest pose');
  near(apply(K.pose(m,{p:[2,3,90]}).W.get('p'),[1,0,0]),[2,4,0],1e-9,'planar: turn 90 about z then slide 2 along x and 3 along y');
  near(apply(K.pose(m,{f:[1,2,3,0,0,0]}).W.get('f'),[0,0,0]),[2,3,1],1e-9,'floating translates along its frame: a = z, b = x, c = a × b = y');
  near(apply(K.pose(m,{s:[0,1.5]}).W.get('s'),[0,0,0]),[1.5,0,0],1e-9,'pin-slot slides along its slot');
  // Rotations stay rigid (orthonormal).
  const R=K.pose(m,{b:[30,-40,70]}).W.get('b'),x=applyDir(R,[1,0,0]),y=applyDir(R,[0,1,0]);near([K.math.len(x),K.math.len(y),K.math.dot(x,y)],[1,1,0],1e-9);
});
test('couplings set one joint from another: gears reverse, chains of gears, rack and pinion',()=>{
  const m=model({joints:[{id:'motor',type:'continuous'},{id:'gear',type:'continuous'},{id:'out',type:'continuous'},{id:'rack',type:'prismatic',axis:[1,0,0]}],
    couplings:[{kind:'gear',from:'gear',to:'out',ratio:-.5},{kind:'gear',from:'motor',to:'gear',ratio:-2},{kind:'rack',from:'out',to:'rack',ratio:Math.PI*1/360}]});
  const q=K.resolve(m,{motor:90});near(q.gear,[-180]);near(q.out,[90],1e-9,'two meshes: same direction, ratio 1');near(q.rack,[Math.PI/4],1e-9,'a 1 in pitch-diameter pinion turning 90° moves the rack π/4 in');
  assert.equal(K.sanitize({joints:[{id:'a',type:'revolute'},{id:'b',type:'revolute'}],couplings:[{from:'a',to:'b'},{from:'a',to:'b',ratio:3}]}).couplings.length,1,'one coupling per driven joint');
});
// Four-bar: ground pivots A (0,0) and D (d,0); crank AB = a, coupler BC = b, rocker DC = c. Freudenstein gives the
// rocker angle from the crank angle.
// Both places C can be: where the circle of radius b about B meets the circle of radius c about D.
function fourBar(a,b,c,d,theta){const t=theta*Math.PI/180,B={x:a*Math.cos(t),y:a*Math.sin(t)},ux=d-B.x,uy=-B.y,e=Math.hypot(ux,uy),along=(b*b-c*c+e*e)/(2*e),h=Math.sqrt(Math.max(0,b*b-along*along));
  return [1,-1].map(s=>({x:B.x+along*ux/e-s*h*uy/e,y:B.y+along*uy/e+s*h*ux/e}));}
test('a four-bar linkage stays closed: driving the crank solves the coupler and rocker (Freudenstein)',()=>{
  const a=2,b=6,c=5,d=6,rest=60,[C0]=fourBar(a,b,c,d,rest).sort((p,q)=>q.y-p.y),B0={x:a*Math.cos(rest*Math.PI/180),y:a*Math.sin(rest*Math.PI/180)};
  // Built in the CAD at a crank angle of 60°: crank about A, coupler about B (child of crank), rocker about D, loop at C.
  const m=model({joints:[{id:'crank',type:'continuous',origin:[0,0,0],axis:[0,0,1],drive:{signal:'action'}},{id:'coupler',type:'revolute',parent:'crank',origin:[B0.x,B0.y,0],axis:[0,0,1]},{id:'rocker',type:'revolute',origin:[d,0,0],axis:[0,0,1]}],
    loops:[{a:{joint:'coupler',point:[C0.x,C0.y,0]},b:{joint:'rocker',point:[C0.x,C0.y,0]}}]});
  for(const turn of [0,20,90,150,240,300]){
    const p=K.pose(m,{crank:turn}),[cx,cy]=apply(p.W.get("rocker"),[C0.x,C0.y,0]),C={x:cx,y:cy},want=fourBar(a,b,c,d,rest+turn).sort((u,v)=>Math.hypot(u.x-C.x,u.y-C.y)-Math.hypot(v.x-C.x,v.y-C.y))[0];
    assert.ok(p.loopError<1e-5,`closed at ${turn}° (${p.loopError})`);near([C.x,C.y],[want.x,want.y],1e-4,`rocker end at crank +${turn}°`);
    // And it stayed on the branch it was built in (the upper one for this geometry).
    assert.ok(C.y>0,`same branch at ${turn}°`);}
});
test('a slider-crank: the slider position follows x = r cos θ + √(l² − r² sin² θ)',()=>{
  const r=2,l=7,x0=r+l;// at rest the crank points along +x (θ = 0): pin B at (2,0), slider pin C at (9,0)
  const m=model({joints:[{id:'crank',type:'continuous',origin:[0,0,0],axis:[0,0,1]},{id:'rod',type:'revolute',parent:'crank',origin:[r,0,0],axis:[0,0,1]},{id:'slider',type:'prismatic',origin:[x0,0,0],axis:[1,0,0]}],
    loops:[{a:{joint:'rod',point:[x0,0,0]},b:{joint:'slider',point:[x0,0,0]}}]});
  for(const th of [30,90,135,200,330]){const p=K.pose(m,{crank:th}),t=th*Math.PI/180,want=r*Math.cos(t)+Math.sqrt(l*l-r*r*Math.sin(t)**2);
    near(x0+p.q.slider[0],want,1e-4,`slider at θ=${th}`);}
});
test('inverse kinematics: a two-link planar arm reaches a point (law of cosines check)',()=>{
  const m=model({joints:[{id:'shoulder',type:'revolute',origin:[0,0,0],axis:[0,0,1],lower:-170,upper:170},{id:'elbow',type:'revolute',parent:'shoulder',origin:[10,0,0],axis:[0,0,1],lower:-170,upper:170}]});
  const target=[12,6,0],{q,error}=K.reach(m,{joint:'elbow',point:[18,0,0],target});assert.ok(error<1e-4,`reached (${error})`);
  const W=K.worlds(m,q);near(apply(W.get('elbow'),[18,0,0]),target,1e-4);
  const cosE=(12*12+6*6-10*10-8*8)/(2*10*8);near(Math.abs(q.elbow[0]),Math.acos(cosE)*180/Math.PI,1e-2,'elbow angle');
  assert.ok(K.reach(m,{joint:'elbow',point:[18,0,0],target:[40,0,0]}).error>10,'out of reach is reported, not faked');
});
test('actuator trapezoid: reaches its target in the time worked out ahead, and limits stop it',()=>{
  const a=new K.Axis(0,{speed:90,accel:180});a.to(90);let t=0;while(!a.done&&t<10){a.step(1/240);t+=1/240;}
  near(t,K.moveSeconds(90,90,180),2/240,'90° at 90°/s with 180°/s² takes 1.5 s');near(K.moveSeconds(90,90,180),1.5,1e-12);near(K.moveSeconds(10,90,180),2*Math.sqrt(10/180),1e-12,'short move never reaches full speed');
  const b=new K.Axis(0,{speed:50,upper:20});b.to(100);for(let i=0;i<100;i++)b.step(.01);near(b.q,20,1e-12,'end stop');
  const c=new K.Axis(0,{speed:100,accel:50});c.spin(100);for(let i=0;i<100;i++)c.step(.01);near(c.v,50,1e-9,'speeds up at its acceleration');
});
test('the driver turns game signals into joint values: turret, deploy, hood, flywheel (drawn slower), rollers',()=>{
  const m=model({joints:[{id:'t',type:'continuous',axis:[0,0,1],zero:-90,drive:{signal:'turret',of:'shooter:0'}},{id:'r',type:'revolute',axis:[1,0,0],states:{raised:0,lowered:60},drive:{signal:'deploy',of:'intake:0'}},
    {id:'h',type:'revolute',axis:[0,1,0],states:{rest:0,shoot:20},speed:40,drive:{signal:'hood',of:'shooter:0'}},{id:'f',type:'continuous',axis:[0,1,0],drive:{signal:'flywheel',of:'shooter:0'}},{id:'i',type:'continuous',axis:[1,0,0],rpm:30,drive:{signal:'roller',of:'intake:0'}}]});
  const d=new K.Driver(m);d.tick(1/60,{turrets:[30],kick:[.5],spin:true,flywheel:1,rpm:3000,intake:true});const v=d.values();
  near(v.t,120,1e-9,'turret at 30° from the front; the CAD has it facing right (−90°), so it turns 120°');near(v.r,30,1e-9,'half way down');
  near(v.h,40/60,1e-4,'hood moving to its shooting position at 40°/s');near(v.f,K.shownRate(3000)/60,1e-4,'flywheel drawn slower than it turns, still faster than a slower one');assert.ok(K.shownRate(3000)<K.shownRate(6000)&&K.shownRate(6000)<=K.SHOW_SPIN&&K.shownRate(30)<K.shownRate(300),'each speed looks different, and none strobes');near(K.shownRate(300),1800,1e-9,'up to 300 rpm as it is');near(v.i,30*6/60,1e-4,'30 rpm roller');
  for(let k=0;k<60;k++)d.tick(1/60,{turrets:[30],kick:[1],spin:true});near(d.values().h,20,1e-9,'hood reached its shooting position');near(d.values().r,60,1e-9);
  for(let k=0;k<60;k++)d.tick(1/60,{turrets:[30],kick:[0]});near(d.values().h,0,1e-9,'and goes back to rest when the shooter stops');
});
test('a shaft that follows a spinning one never jumps, however many turns go by',()=>{
  const m=model({joints:[{id:'f',type:'continuous',axis:[1,0,0],rpm:300,drive:{signal:'feeder',of:'any'}},{id:'g',type:'continuous',axis:[1,0,0]}],couplings:[{kind:'gear',from:'f',to:'g',ratio:.444}]});
  const d=new K.Driver(m);let last=0;for(let k=0;k<600;k++){d.tick(1/60,{feed:true});const now=K.resolve(m,d.values()).g[0];assert.ok(Math.abs(now-last-1800*.444/60)<1e-6,'one step a tick, tick '+k);last=now;}});
test('actions run steps together, in sequence and after delays; the timeline agrees with the ticking driver',()=>{
  const m=model({joints:[{id:'lift',type:'prismatic',axis:[0,0,1],lower:0,upper:20},{id:'claw',type:'revolute',axis:[1,0,0]}],
    actuators:[{id:'lm',joint:'lift',kind:'dcmotor',speed:10,accel:20,states:{down:0,up:15}},{id:'cs',joint:'claw',kind:'servo',speed:180,states:{open:45,closed:0}}],
    actions:[{name:'Score',steps:[{actuator:'lm',command:{state:'up'}},{actuator:'cs',command:{state:'open'},after:0,delay:.25},{actuator:'lm',command:{state:'down'},after:1}]}]});
  const tl=K.timeline(m,m.actions[0]);near(tl.steps[0].end,K.moveSeconds(15,10,20),1e-12);near(tl.steps[1].start,tl.steps[0].end+.25,1e-12,'claw opens 0.25 s after the lift is up');near(tl.steps[2].start,tl.steps[1].end,1e-12);
  const d=new K.Driver(m);assert.equal(d.start('score'),true,'by name, any case');let t=0,openedAt=null;const dt=1/600;
  while(d.busy('Score')&&t<20){d.tick(dt,{});t+=dt;if(openedAt===null&&Math.abs(d.values().claw-45)<1e-6)openedAt=t;}
  near(t,tl.duration,3*dt,'the driver finishes when the timeline says');near(openedAt,tl.steps[1].end,3*dt);near(d.values().lift,0,1e-9);
  const mid=K.sampleTimeline(m,tl,tl.steps[0].end/2);near(mid.lm,7.5,1e-9,'half way through a symmetric trapezoid is half way');
});
test('sanitize keeps the model safe to store: bad parents, cycles, ids and references go',()=>{
  const s=K.sanitize({joints:[{id:'a',parent:'b'},{id:'b',parent:'a'},{id:'c',parent:'nope'},{id:'bad id'},{id:'a'},{id:'d',type:'warp',axis:[0,0,0]}],actuators:[{id:'x',joint:'zz'},{id:'y',joint:'a',mode:'chaos'}],loops:[{a:{joint:'a',point:[0,0,0]},b:{joint:'a',point:[1,1,1]}}]});
  assert.deepEqual(s.joints.map(j=>j.id),['a','b','c','d']);assert.ok(s.joints.every(j=>j.parent===null||j.id==='a'||j.id==='b'));assert.ok(!(s.joints[0].parent==='b'&&s.joints[1].parent==='a'),'cycle broken');
  assert.equal(s.joints[2].parent,null);assert.equal(s.joints[3].type,'revolute');near(s.joints[3].axis,[0,0,1]);assert.deepEqual(s.actuators.map(a=>a.id),['y']);assert.equal(s.actuators[0].mode,'position');assert.equal(s.loops.length,0,'a loop on one link says nothing');
  assert.deepEqual(K.sanitize(JSON.parse(JSON.stringify(s))),s,'stable through save and load');
});
test('part refs: whole assemblies where every part is in, single parts otherwise',()=>{
  const tree={nodes:[{name:'robot',parent:-1},{name:'shooter',parent:0},{name:'wheel',parent:1},{name:'plate',parent:0}],leaf:[2,2,1,3,3]};
  const P=K.partIndex(tree),set=new Set([0,1,2,3]);const r=P.compress(set);assert.deepEqual(r,['robot/shooter','#3']);assert.deepEqual([...P.expand(r)].sort(),[0,1,2,3]);
  assert.deepEqual(P.compress(new Set([0])),['#0']);assert.equal(P.name(4),'plate');assert.equal(P.key(0),'robot/shooter/wheel');
});
test('removing a mechanism moves the joints that later ones drive',()=>{
  const m=model({joints:[{id:'a',drive:{signal:'roller',of:'intake:0'}},{id:'b',drive:{signal:'roller',of:'intake:1'}},{id:'c',drive:{signal:'turret',of:'shooter:0'}}]});
  const r=K.reindex(m,'intake',0);assert.equal(r.joints[0].drive,undefined);assert.equal(r.joints[1].drive.of,'intake:0');assert.equal(r.joints[2].drive.of,'shooter:0');
});
test('a route action naming a part and one of its positions moves it there, busy until it arrives',()=>{
  const m=model({joints:[{id:'lift',name:'Lift',type:'prismatic',axis:[0,0,1],lower:0,upper:20,states:{down:0,up:12},speed:6,drive:{signal:'action'}}]});
  const d=new K.Driver(m);assert.equal(d.start('lift UP'),true,'joint name and position, any case');assert.equal(d.start('Lift sideways'),false,'not one of its positions');assert.equal(d.start('Shoot'),false);
  let t=0;while(d.busy('Lift up')&&t<10){d.tick(.01,{});t+=.01;}near(t,2,.02,'12 in at 6 in/s');near(d.values().lift,12,1e-9);
});
test('an action can name parts directly: lift up, then open the claw a quarter second later; route actions run it',()=>{
  const m=model({joints:[{id:'lift',name:'Lift',type:'prismatic',axis:[0,0,1],lower:0,upper:20,states:{down:0,up:12},speed:6,drive:{signal:'action'}},{id:'claw',name:'Claw',type:'revolute',axis:[1,0,0],states:{closed:0,open:40},speed:160,drive:{signal:'action'}}],
    actions:[{name:'Score',steps:[{actuator:'lift',command:{state:'up'}},{actuator:'claw',command:{state:'open'},after:0,delay:.25}]}]});
  assert.equal(m.actions[0].steps.length,2,'part steps are kept');const tl=K.timeline(m,m.actions[0]);near([tl.steps[0].end,tl.steps[1].start,tl.duration],[2,2.25,2.5],1e-9);
  const d=new K.Driver(m);assert.equal(d.start('score'),true);let t=0;while(d.busy('Score')&&t<10){d.tick(.01,{});t+=.01;}near(t,2.5,.03);near([d.values().lift,d.values().claw],[12,40],1e-9);
  near(K.sampleTimeline(m,tl,1).lift,6,1e-9,'half way up at 1 s');
});
