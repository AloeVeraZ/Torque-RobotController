'use strict';
// A route the planner cannot keep clear still runs, on physics (the user's call of 2026-11-17): planLoose routes every
// stretch it can and drives each blocked path as drawn, listing it in route.unclear for Path planning to draw yellow.
const {test}=require('node:test'),assert=require('node:assert/strict');
const planner=require('../ui/sim-planner.js');
const square={front:9,rear:9,half:9};
const rect=(x,y,width,height,id)=>({id:id||`r${x}-${y}`,type:'rect',x,y,width,height,angle:0});
const project=(zones,pins,extra={})=>({start:{x:12,y:72,heading:0},zones,pins:pins.map(p=>({wait:0,action:'',...p})),clearance:1,style:'sharp',rotate:true,...extra});
const loose=(p,fieldZones=[])=>planner.planLoose(p,square,fieldZones,planner.FIELD);
const ends=route=>route.stops.map(s=>[Math.round(s.x),Math.round(s.y)]);

test('a pin inside a barrier: the route still plans, and the paths into and out of it are drawn yellow',()=>{
  const wall=rect(72,72,20,20),p=project([wall],[{x:40,y:30},{x:72,y:72},{x:120,y:110}]);
  assert.throws(()=>planner.plan(p,square,[],planner.FIELD),/clearance|fit/i,'the planner alone refuses it');
  const r=loose(p);
  assert.deepEqual(r.unclear.map(u=>[u.pin,u.code]),[[1,'clearance'],[2,'after']]);
  assert.deepEqual(ends(r),[[40,30],[72,72],[120,110]],'one stop for every pin, in order');
  assert.ok(r.segments.every(s=>Number.isFinite(s.heading)),'every path carries its own heading');
  assert.equal(r.effects,true,'the simulator drives it as it is');assert.equal(r.turns,true);
  // The yellow path goes straight into the barrier: nothing is avoided on it.
  const into=r.segments.filter(s=>s.to===1);assert.equal(into.length,1);assert.deepEqual(into[0].points.map(q=>[Math.round(q.x),Math.round(q.y)]),[[40,30],[72,72]]);
  // The clear path before it is planned as usual, keeping the robot clear of the barrier.
  const first=r.segments.filter(s=>s.to===0);for(const s of first)for(let i=1;i<s.points.length;i++)assert.ok(planner.sweepClear(s.points[i-1],s.points[i],s.heading,[wall],square,planner.FIELD));
});

test('an end point the robot fits at but cannot reach: only that path is yellow',()=>{
  // A closed ring of barriers round (100, 72): the pin fits inside, but there is no way in.
  const ring=[rect(100,98,44,8,'n'),rect(100,46,44,8,'s'),rect(126,72,8,60,'e'),rect(74,72,8,60,'w')];
  const p=project(ring,[{x:40,y:110},{x:100,y:72}]),r=loose(p);
  assert.deepEqual(r.unclear.map(u=>[u.pin,u.code]),[[1,'path']]);
  assert.match(r.unclear[0].message,/pin 2/i,'the message names the path by its own pin');
});

test('what physics cannot settle still stops the route: a start overlapping something',()=>{
  const p=project([rect(12,72,10,10)],[{x:100,y:72}]);
  assert.throws(()=>loose(p),/Starting pose/);
});

test('a clear route comes back as the planner plans it, with nothing yellow',()=>{
  const p=project([rect(72,72,20,20)],[{x:40,y:30},{x:120,y:110}]),r=loose(p),plain=planner.plan(p,square,[],planner.FIELD);
  assert.deepEqual(r.unclear,[]);assert.equal(r.segments.length,plain.segments.length);assert.ok(Math.abs(r.length-plain.length)<1e-6);
});

test('clear stretches are routed together, so their curves still flow through the pins between them',()=>{
  const wall=rect(110,30,16,16),pins=[{x:40,y:110},{x:80,y:120},{x:110,y:30}],p=project([wall],pins,{style:'spline'}),r=loose(p);
  assert.deepEqual(r.unclear.map(u=>u.pin),[2]);
  const together=planner.plan(project([wall],pins.slice(0,2),{style:'spline'}),square,[],planner.FIELD);
  const head=r.segments.filter(s=>s.to<2);assert.equal(head.length,together.segments.length);
  head.forEach((s,i)=>assert.deepEqual(s.points,together.segments[i].points));
});

test('field elements count like barriers: a pin on one runs into it',()=>{
  const element=rect(72,100,24,24,'element'),p=project([],[{x:72,y:100}]),r=loose(p,[element]);
  assert.deepEqual(r.unclear.map(u=>u.pin),[0]);assert.equal(r.stops.length,1);
});

test('a tank-style robot gets yellow paths too, as straight legs it drives along its heading',()=>{
  const wall=rect(80,72,20,40),p=project([wall],[{x:50,y:110},{x:80,y:72},{x:120,y:30}],{nonholonomic:true}),r=loose(p);
  assert.deepEqual(r.unclear.map(u=>u.pin),[1,2]);assert.equal(r.nonholonomic,true);
  for(const s of r.segments){assert.equal(s.type,'line');const [a,b]=s.points,along=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI,d=((s.heading-along)%180+270)%180-90;assert.ok(Math.abs(d)<1e-6,`leg drives along its heading: ${s.heading} vs ${along}`);}
});
