'use strict';
// + Add mechanism's library (ui/sim-mech-catalog.js): every vendor part is a generic mechanism type with the vendor's
// numbers in, and what it sets survives the kinematics' sanitize.
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../ui/sim-mech-catalog.js'),T=require('../ui/sim-mechanism-types.js'),A=require('../ui/sim-actuators.js'),K=require('../ui/sim-kinematics.js');
globalThis.DeckKinematics=K;
// The joint and motor + Add mechanism makes for a type, as sim-joints' add does.
function made(type){const j=T.joint(type,{id:'part',name:'Part'}),spec=T.motorFor(type);return {j,a:A.create({id:'part_motor',joint:'part',name:'Part',spec,speed:j.speed??90,travel:A.travelOf(j),states:j.states})};}

test('every part is a known type, from a listed vendor, with a product page and a model the app has',()=>{
  assert.ok(C.ITEMS.length>=25);const ids=new Set();
  for(const it of C.ITEMS){assert.ok(!ids.has(it.id),'one id each: '+it.id);ids.add(it.id);assert.ok(T.TYPES[it.type],it.id+': '+it.type);assert.ok(C.vendor(it.vendor),it.id);
    assert.match(it.url||'',/^https:\/\//,it.id+' links its page');const m=it.preset?.motor?.model;if(m)assert.ok(A.MODELS[m],it.id+': '+m);assert.ok(C.picFor(it.type).startsWith('<svg'));}
  assert.deepEqual(C.VENDORS.slice(0,3).map(v=>v.id),['gobilda','rev','offset']);});

test('a vendor part sets its travel, gearing and motor, and says what it is',()=>{
  const it=C.ITEMS.find(i=>i.id==='gb-viper-2s-336'),{j,a}=made(it.type),r=C.apply(it,j,a,{A});
  assert.equal(r.joint.upper,19.213);assert.equal(r.joint.states.up,19.213);assert.equal(r.actuator.model,'gobilda-5203-435');assert.deepEqual(r.actuator.transmission,[{kind:'spool',diameter:1.504}]);
  assert.deepEqual(r.joint.product,{vendor:'goBILDA',name:it.name,sku:'3210-0003-0002',url:it.url});
  const kept=K.sanitize({joints:[r.joint],actuators:[r.actuator]});assert.deepEqual(kept.joints[0].product,r.joint.product,'kept when saved');assert.equal(kept.joints[0].upper,19.213);});

test('a kit on another kind of drive gets that drive: a servo-driven rack, a servo winch',()=>{
  for(const id of ['gb-rack-5kg']){const it=C.ITEMS.find(i=>i.id===id),{j,a}=made(it.type);assert.equal(a.kind,'dcmotor');const r=C.apply(it,j,a,{A});assert.equal(r.actuator.kind,it.preset.motor.kind,id);assert.equal(r.actuator.model,it.preset.motor.model,id);}});

test('parts sold as ready-made game mechanisms say to check R301',()=>{
  const flagged=C.ITEMS.filter(i=>i.legal).map(i=>i.id).sort();assert.deepEqual(flagged,['am-conveyance-kit','am-launcher-kit']);for(const id of flagged)assert.match(C.ITEMS.find(i=>i.id===id).legal,/R301/);});

test('the picker offers only mechanism kits from the seven companies, each with its listing photo of the kit',()=>{
  const P=require('../ui/ftc/mech-photos.js');assert.deepEqual(C.VENDORS.map(v=>v.id).sort(),['andymark','gobilda','offset','pitsco','rev','studica','swyft']);
  for(const it of C.ITEMS){const p=P['mech:cat:'+it.id];assert.ok(p,it.id+' has a photo');assert.equal(p[0],it.url,it.id+': the photo is from its own listing');assert.match(p[2]?.image||'',/^https:\/\//,it.id);assert.equal(p[2]?.kind,'mechanism-photo',it.id);
    assert.ok(!/\$/.test(it.specs.join(' ')),it.id+' shows no price');}});
