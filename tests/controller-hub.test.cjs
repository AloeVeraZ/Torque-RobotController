'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {ControllerHub}=require('../src/controller-hub.cjs');
const pad=(id,index,extra={})=>({id,index,mapping:'standard',connected:true,pressed:false,axesActive:false,...extra});
const external=pad('Xbox Wireless',0),builtin=pad('Steam Deck Controller',3),hardware={builtInController:true,controllerFamily:'steamdeck'};
test('both controller slots are assigned independently of the robot’s one/two input limit',()=>{
 const h=new ControllerHub({hardware});h.ingest([external,builtin]);assert.deepEqual(h.state().slots.map(p=>p?.index),[3,0]);assert.equal(h.state().count,2,'every robot takes both controllers');
 h.begin(2);assert.equal(h.state().capture.slot,2);h.cancel();h.setCount(2);assert.equal(h.state().count,2);
 h.setCount(1);assert.deepEqual(h.state().slots.map(p=>p.index),[3,0]);assert.throws(()=>h.setCount(3));assert.throws(()=>h.begin(3));
});
test('click and press assignment waits for release, swaps slots and suppresses held input until neutral',()=>{
 let persisted;const h=new ControllerHub({hardware,persist:v=>persisted=v});h.setCount(2);h.ingest([pad(external.id,0,{pressed:true}),builtin]);h.begin(1);
 h.ingest([pad(external.id,0,{pressed:true}),builtin]);assert.equal(h.state().capture.slot,1);
 h.ingest([external,builtin]);h.ingest([pad(external.id,0,{pressed:true}),builtin]);
 assert.equal(h.state().capture,null);assert.deepEqual(h.state().slots.map(p=>p.index),[0,3]);assert.equal(persisted[0].id,external.id);assert.equal(h.state().assignment.slot,1);assert.ok(h.state().blocked.includes('0:'+external.id));
 h.ingest([pad(external.id,0,{axesActive:true}),builtin]);assert.ok(h.state().blocked.includes('0:'+external.id));
 h.ingest([external,builtin]);assert.deepEqual(h.state().blocked,[]);
});
test('saved manual choices survive a restart and reconnect under a changed index',()=>{
 const h=new ControllerHub({hardware,preferred:[external,builtin]});h.setCount(2);h.ingest([builtin,external]);assert.deepEqual(h.state().slots.map(p=>p.id),[external.id,builtin.id]);
 h.ingest([]);h.ingest([builtin,pad(external.id,5)]);assert.deepEqual(h.state().slots.map(p=>p.index),[5,3]);
});
test('capture cancellation and timeout leave assignments intact; missing devices do not block another capture',()=>{
 const h=new ControllerHub();h.ingest([external]);h.begin(1,100);h.tick(15100);assert.equal(h.state().capture,null);assert.equal(h.state().slots[0].id,external.id);
 h.begin(1);h.cancel();assert.equal(h.state().capture,null);h.ingest([]);h.begin(1);h.ingest([pad('New USB pad',1,{pressed:true})]);assert.equal(h.state().slots[0].id,'New USB pad');
});
test('malformed device reports cannot create extra slots or duplicate indices',()=>{
 const h=new ControllerHub();for(const v of [null,{},'invalid']){h.ingest(v);assert.deepEqual(h.state().slots,[null,null]);}
 h.ingest([pad('bad',-1),pad('bad',16),pad('x'.repeat(2049),0),pad('Valid',2),pad('Duplicate',2)]);assert.equal(h.pads.length,1);assert.equal(h.state().slots[0].id,'Valid');
});
test('live input diagnostics are bounded and separate from assignment descriptors',()=>{
 const h=new ControllerHub();h.ingest([pad('Xbox',0,{axes:[-0.5,5,NaN,-5,7],buttons:[0,0.7,8,NaN],pressed:true})]);
 assert.deepEqual(h.state().readings[0].axes,[-0.5,1,0,-1]);assert.deepEqual(h.state().readings[0].buttons,[0,0.7,1,0]);assert.equal(h.state().slots[0].axes,undefined);
});
test('automatic assignment restores built-in controls after a manual swap and survives restart',()=>{
 let preferred;const h=new ControllerHub({hardware,persist:p=>preferred=p});h.ingest([external,builtin]);h.begin(1);h.ingest([pad(external.id,0,{pressed:true}),builtin]);assert.equal(h.state().slots[0].index,0);
 h.automatic();assert.equal(h.state().slots[0].index,3);assert.equal(h.state().automatic,true);assert.equal(preferred[0],null);
 const copy=new ControllerHub({hardware,preferred});copy.ingest([external,builtin]);assert.equal(copy.state().slots[0].index,3);
});
test('automatic reset rebuilds both slots and drops a manually pinned raw second device',()=>{const h=new ControllerHub({hardware,preferred:[external,pad('Raw HID',4,{mapping:''})]});h.ingest([external,builtin,pad('Raw HID',4,{mapping:''})]);assert.equal(h.state().slots[1].index,4);h.automatic();assert.deepEqual(h.state().slots.map(p=>p.index),[3,0]);assert.deepEqual(h.preferred,[null,null]);h.ingest([builtin]);assert.deepEqual(h.state().slots.map(p=>p?.index),[3,undefined]);h.ingest([builtin,pad('New external',7)]);assert.deepEqual(h.state().slots.map(p=>p.index),[3,7]);});
test('calibrated resting drift can release the input lock while an intentional stick hold stays blocked',()=>{const h=new ControllerHub({zoneFor:()=>.15}),drifting=pad('Drifting pad',0,{axes:[.1,0,0,0],axesActive:true});h.ingest([drifting]);h.automatic();assert.ok(h.state().blocked.length);h.ingest([pad(drifting.id,0,{axes:[.4,0,0,0],axesActive:true})]);assert.ok(h.state().blocked.length);h.ingest([drifting]);assert.deepEqual(h.state().blocked,[]);h.begin(1);h.ingest([{...drifting,pressed:true}]);assert.equal(h.state().capture,null);assert.equal(h.state().readings[0].axes[0],.1);});
