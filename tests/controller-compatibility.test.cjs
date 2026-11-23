'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {ControllerHub}=require('../src/controller-hub.cjs');
const {identity,buttonLabels,defaultPad}=require('../ui/controllers.js');
const {profiles}=require('./fixtures/controller-profiles.json');
const pad=(id,index=0,mapping='standard')=>({id,index,mapping,connected:true,axes:[-.75,.4,.6,-.2],buttons:Array.from({length:17},(_,i)=>i===6?.65:0)});
test('100 documented device/mode reports use brand-independent assignments on all desktop host profiles',()=>{
 assert.equal(profiles.length,100);assert.equal(new Set(profiles.map(p=>p.vendor+':'+p.product)).size,100);
 for(const platform of ['linux','win32','darwin'])for(const profile of profiles){
  const h=new ControllerHub({hardware:{platform}}),primary=pad(profile.id,3),second=pad('External generic gamepad',5);h.ingest([primary,second]);
  assert.deepEqual(h.state().slots.map(p=>p.index),[3,5],profile.name+' '+platform);assert.equal(h.state().count,2);
  h.setCount(2);assert.deepEqual(h.state().readings[0].axes,primary.axes);assert.equal(h.state().readings[0].buttons[6],.65);
  h.ingest([]);assert.deepEqual(h.state().slots,[null,null]);h.ingest([pad(profile.id,7)]);assert.equal(h.state().slots[0].index,7);
 }
});
test('future brands, third-party pads and virtual drivers need no product allowlist',()=>{
 for(const name of ['Logitech','Nintendo Switch Pro Controller','GameSir','GuliKit','8BitDo','PowerA','PDP','HORI','Nacon','Turtle Beach','Razer','SteelSeries','SCUF','Future 2030 Gamepad','XInput STANDARD GAMEPAD']){
  const h=new ControllerHub();h.ingest([pad(name)]);assert.equal(h.state().slots[0].id,name);assert.equal(h.state().readings[0].axes[0],-.75);
 }
});
test('unmapped handheld/raw HID devices never win automatic assignments, but can be inspected manually',()=>{
 const raw={...pad('Integrated Handheld Gamepad',0,''),axesActive:true},standard=pad('USB Xbox',3),h=new ControllerHub();
 assert.equal(defaultPad([raw],{builtInController:true}),null);h.ingest([raw,standard]);assert.deepEqual(h.state().slots.map(p=>p?.index),[3,undefined]);
 assert.equal(h.state().devices[0].mapping,'');h.begin(1);h.ingest([raw,standard]);h.ingest([{...raw,pressed:true},standard]);
 assert.equal(h.state().capture,null,'resting raw trigger axis must not prevent diagnostic assignment');assert.equal(h.state().slots[0].mapping,'');
});
test('Logitech and Nintendo/Sony VID/PIDs identify models conservatively and display positional labels',()=>{
 for(const [id,name] of [['Pro Controller (Vendor: 057e Product: 2009)','Nintendo Switch Pro controller'],['Wireless Controller (Vendor: 054c Product: 0ce6)','DualSense controller'],['054c-0df2-Wireless Controller','DualSense Edge controller'],['Controller (Vendor: 046d Product: c21d)','Logitech F310 controller'],['Controller (Vendor: 046d Product: c216)','Logitech controller']])assert.equal(identity(pad(id)).name,name);
 assert.deepEqual(buttonLabels(pad('Pro Controller (Vendor: 057e Product: 2009)')).slice(0,4),['B · South','A · East','Y · West','X · North']);
 assert.equal(buttonLabels(pad('DualSense'))[6],'L2');assert.equal(buttonLabels(pad('Xbox One'))[6],'LT');assert.equal(buttonLabels(pad('Unmapped',0,''))[0],'Raw button 0');
 assert.equal(identity(pad('Controller (Vendor: 045e Product: 028e)')).name,'Generic controller','virtual Xbox identity must not invent a physical model');
});
