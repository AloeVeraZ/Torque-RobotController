'use strict';
// The response graph on the Axon tab: a model of a servo moving, on the servo's real settings.
const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../ui/axon-response.js'),S=require('../src/axon-servo.cjs');

const run=(over={})=>R.simulate({damping:60,factory:60,pwm:255,band:.25,mass:4,move:45,...over});
const facts=(over,tol=2)=>R.measure(run(over),tol);

test('more Damping, less overshoot; a heavier load, more',()=>{
  let was=Infinity;for(const damping of [1,20,40,60,90,120,180,255]){const o=facts({damping}).overshoot;assert.ok(o<=was+1e-9,`Damping ${damping}: ${o} after ${was}`);was=o;}
  assert.equal(facts({damping:255,mass:2}).overshoot,0,'enough damping does not pass the target at all');assert.ok(facts({damping:1}).overshoot>10,'very little swings well past it');
  was=-1;for(const mass of R.LOADS.map(l=>l.mass)){const o=facts({mass}).overshoot;assert.ok(o>=was,`mass ${mass}`);was=o;}
});
test('the factory Damping is critical with no load, and the names follow',()=>{
  assert.ok(Math.abs(R.zetaOf({damping:60,factory:60,mass:1})-1)<.01);assert.equal(R.shape(R.zetaOf({damping:60,factory:60,mass:1})),'Critical damping');
  assert.deepEqual([.1,.5,1,1.5].map(R.shape),['Light damping','Heavy damping','Critical damping','Overdamping']);
  assert.equal(facts({mass:1,damping:60}).overshoot<1,true,'critical barely passes the target');
});
test('PWM Power caps the motor: the same move takes longer, and it never goes faster than the cap lets it',()=>{
  const reach=o=>{const r=run({move:90,...o});return r.samples.find(s=>s[1]>=85)[0];};
  assert.ok(reach({pwm:64})>reach({pwm:128})&&reach({pwm:128})>reach({pwm:255}));
  const r=run({move:90,pwm:64,mass:1,damping:1}),{samples:s}=r;for(let i=1;i<s.length;i++)assert.ok((s[i][1]-s[i-1][1])/(s[i][0]-s[i-1][0])<=500*64/255+1,'held under its top speed');
});
test('Sensitivity is a band where the error counts as none: the servo can rest off the target, and only inside the band',()=>{
  for(const band of [.25,.5,1,1.5]){const r=run({band,damping:255,mass:1});assert.ok(r.rest<=band+.05,`rests ${r.rest} inside ${band}`);}
  assert.ok(run({band:1.5,damping:255,mass:1}).rest>run({band:.25,damping:255,mass:1}).rest);
  assert.deepEqual([0,1,2,3].map(i=>R.bandOf('v2',i)),[1.5,1,.5,.25],'V2 keeps the firmware\'s 150, 100, 50, 25, Low first');assert.deepEqual([0,1,2,3].map(i=>R.bandOf('v1',i)),[.25,.5,.75,1],'V1 keeps its 16, 32, 48, 64, Ultra High first');
});
test('the numbers are what the curve really does',()=>{
  for(const o of [{damping:1},{damping:30},{damping:60},{damping:255,mass:1},{mass:8},{pwm:64,move:120}]){const r=run(o),m=R.measure(r,2),p=r.samples.map(s=>s[1]),top=Math.max(...p);
    if(top-r.move>.05){assert.equal(m.overshoot,top-r.move);assert.equal(r.samples.find(s=>s[1]===top)[0],m.overshootAt);assert.ok(Math.abs(m.percent-(top-r.move)/r.move*100)<1e-9);}else assert.equal(m.overshoot,0);
    if(m.undershoot){const after=r.samples.filter(s=>s[0]>m.overshootAt).map(s=>s[1]);assert.ok(Math.abs(r.move-Math.min(...after)-m.undershoot)<1e-9);assert.ok(m.undershootAt>m.overshootAt,'it comes after');}else assert.ok(!m.overshoot||Math.min(...r.samples.filter(s=>s[0]>m.overshootAt).map(s=>s[1]))>=r.move-.05);
    assert.ok(m.settle!==null);for(const [t,x] of r.samples)if(t>=m.settle)assert.ok(Math.abs(x-r.move)<=2,'stays inside from then on');const before=r.samples.filter(s=>s[0]<m.settle).pop();assert.ok(Math.abs(before[1]-r.move)>2,'and was outside just before');
    assert.ok(r.lastMove<8,'it does finish');assert.ok(r.end>=r.lastMove);}
});
test('the tolerance is the student\'s: a wider one settles sooner, and one narrower than where it rests never does',()=>{
  let was=Infinity;for(const tol of R.TOLERANCES){const t=facts({damping:20},tol).settle;assert.ok(t<=was,`±${tol}: ${t} after ${was}`);was=t;}
  const m=R.measure(run({band:1.5,damping:255,mass:1}),.5);assert.ok(m.rest>.5,`it rests ${m.rest} off`);assert.equal(m.settle,null);
  assert.ok(R.TOLERANCES.includes(R.DEFAULT_TOLERANCE));assert.ok(R.LOADS[R.DEFAULT_LOAD]);
});
test('every Axon servo\'s real range and factory value runs, from one end of each slider to the other',()=>{
  const codes=[...new Set(S.FIRMWARE.map(f=>f.code))];assert.ok(codes.length>=4);
  for(const code of codes){const model=S.modelByCode(code),schema=S.schemaFor(model.family,'servo'),fields=S.schemaView(schema).fields,v=schema.decode(S.factoryBlock(model,'servo')),damp=fields.find(f=>f.key==='damping'),pwm=fields.find(f=>f.key==='pwm'),sens=fields.find(f=>f.key==='sens');
    assert.ok(Number.isFinite(v.damping)&&v.damping>=damp.min&&v.damping<=damp.max,`${code} factory damping ${v.damping}`);assert.ok(v.sens>=0&&v.sens<sens.options.length);
    for(const damping of [damp.min,v.damping,damp.max])for(const p of [pwm.min,pwm.max])for(const mass of [1,8])for(const move of [R.MOVE.min,R.MOVE.max]){const r=R.simulate({damping,factory:v.damping,pwm:p,band:R.bandOf(model.family,v.sens),mass,move}),m=R.measure(r,2);
      assert.ok(r.samples.every(s=>Number.isFinite(s[1])),'it stays finite');assert.ok(r.samples.every(s=>Math.abs(s[1])<move*3),`${code} ${damping} ${p} ${mass} ${move} stays near`);assert.ok(Number.isFinite(m.rest));}}
});
test('the graph draws the target, the tolerance and what happened, with nothing broken and everything inside it',()=>{
  const cases=[[{damping:1,mass:8},2],[{damping:30},.5],[{damping:60},2],[{damping:255,mass:1},10],[{band:1.5,damping:255,mass:1},.5],[{pwm:25,move:180},5],[{move:10},10],[{damping:1,mass:8,move:180},1]];
  for(const [o,tol] of cases){const r=run(o),s=R.plot(r,tol),m=R.measure(r,tol);assert.match(s,/^<svg [^>]*role="img"/);assert.doesNotMatch(s,/NaN|undefined|Infinity/,JSON.stringify(o));assert.match(s,/Target \d/);assert.match(s,/axon-try-band/);assert.match(s,/Time \(seconds\)/);assert.match(s,/axon-try-curve/);
    assert.equal(s.includes('Overshoot +'),m.overshoot>0,JSON.stringify(o));assert.equal(s.includes(`Inside ±${tol}°`),m.settle!==null&&m.settle<=r.end,JSON.stringify(o));
    for(const a of s.matchAll(/\b(?:x|x1|x2|cx)="([\d.-]+)"/g))assert.ok(+a[1]>=0&&+a[1]<=660,`x ${a[1]}`);for(const a of s.matchAll(/\b(?:y|y1|y2|cy)="([\d.-]+)"/g))assert.ok(+a[1]>=0&&+a[1]<=268,`y ${a[1]}`);}
  assert.match(R.plot(run({damping:1,mass:8}),2),/Undershoot −/);assert.match(R.plot(run({damping:1,mass:8}),2),/axon-try-past/);assert.match(R.plot(run({damping:1,mass:8}),2),/axon-try-short/);
});
test('Simple is the basics every student knows, and Advanced is everything',()=>{
  const simple=(f,m)=>S.schemaView(S.schemaFor(f,m)).fields.filter(x=>!x.advanced).map(x=>x.key);
  assert.deepEqual(simple('v1','servo'),['angle','neutral','pwm','inversion']);assert.deepEqual(simple('v2','servo'),['left','right','neutral','pwm','inversion','name']);assert.deepEqual(simple('v1','cr'),['pwm','inversion']);assert.deepEqual(simple('v2','cr'),['pwm','inversion','name'],'a MK2 servo name can be changed in either mode');
  for(const [f,m] of [['v1','servo'],['v2','servo'],['v1','cr'],['v2','cr']])assert.equal(S.schemaView(S.schemaFor(f,m)).fields.length,S.schemaFor(f,m).fields.length,'none go missing');
  const adv=S.schemaView(S.schemaFor('v2','servo')).fields.filter(x=>x.advanced).map(x=>x.key);for(const k of ['damping','sens','signal','softstart','lostppm','beep','ol1t','ol3p'])assert.ok(adv.includes(k),k);
});
