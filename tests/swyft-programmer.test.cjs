'use strict';
// SWYFT Programmer: the protocol read out of SWYFT's app (src/swyft-servo.cjs) and the service (src/swyft-programmer.cjs),
// against a simulated programmer and servo (tests/fixtures/swyft-sim.cjs). Nothing here touches a real COM port.
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../src/swyft-servo.cjs'),{SwyftService,checkChanges}=require('../src/swyft-programmer.cjs'),{SimLink,simTransport,REAL}=require('./fixtures/swyft-sim.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=3000){const end=Date.now()+ms;for(;;){const v=fn();if(v)return v;if(Date.now()>end)throw Error('Timed out waiting.');await wait(10);}}
// Every service a test starts is stopped after it, so a failed assertion cannot leave a loop running.
const started=[];test.afterEach(async()=>{for(const s of started.splice(0))await s.dispose();});
function service(link=new SimLink(),opts={}){const transport=simTransport(link,opts),states=[];const s=new SwyftService({transport,pollMs:40,onState:x=>states.push(x)});started.push(s);return {s,link,transport,states};}

// The exact bytes the real SWYFT Speed servo sent back to a read on 2026-11-13.
const REAL_REPLY=Buffer.from('55 13 0D 18 82 00 00 2F 00 F4 01 C4 09 F4 01 82 DC 05 03 AA'.replace(/ /g,''),'hex');

test('a real servo reply decodes to what SWYFT\'s app showed',()=>{
  assert.ok(S.validFrame(REAL_REPLY));assert.ok(S.isReadReply(REAL_REPLY));assert.ok(!S.isWriteAck(REAL_REPLY));
  assert.deepEqual(S.decode(REAL_REPLY),REAL);
  assert.equal(S.travelDegrees(REAL),320);assert.equal(S.isContinuous(REAL),false);
});
test('a read is 55, zeros, AA, as SWYFT\'s app sends it',()=>{
  assert.equal(S.hex(S.readFrame()),'55 '+'00 '.repeat(18)+'AA');
});
test('a write frame carries every setting and the write flag, and checks',()=>{
  const f=S.writeFrame(REAL);assert.ok(S.validFrame(f));assert.equal(f[3],S.FLAG.write|S.FLAG.stall);
  assert.deepEqual(S.decode(f),REAL);
  const all=S.writeFrame({...REAL,reverse:true,ramp:true});assert.equal(all[3],0x02|0x01|0x10|0x20);
  assert.equal(S.hex(f.subarray(7,9)),'2F 00');assert.equal(S.hex(f.subarray(16,18)),'DC 05');
});
test('travel uses SWYFT\'s own conversion: 270° is 111 a side, 320° is 130',()=>{
  assert.equal(S.degreesToSide(270),111);assert.equal(S.degreesToSide(320),130);assert.equal(S.degreesToSide(999),130);
  assert.equal(S.sideToDegrees(111),270);assert.equal(S.sideToDegrees(130),320);
  const cr=S.withTravel(REAL,{continuous:true});assert.equal(cr.left,255);assert.equal(cr.right,255);assert.ok(S.isContinuous(cr));
  assert.deepEqual(S.withTravel(REAL,{degrees:270}),{...REAL,left:111,right:111});
});
test('frames are found among noise, and a bad checksum is skipped',()=>{
  const bad=Buffer.from(REAL_REPLY);bad[18]^=1;
  const {frames,rest}=S.takeFrames(Buffer.concat([Buffer.from([0x00,0x55,0x12]),bad,REAL_REPLY,Buffer.from([0x55,0x01])]));
  assert.equal(frames.length,1);assert.ok(frames[0].equals(REAL_REPLY));assert.equal(S.hex(rest),'55 01');
});
test('problems name a value out of range',()=>{
  assert.deepEqual(S.problems(REAL),[]);
  assert.match(S.problems({...REAL,maxPower:600}).join(),/Max power must be 0–500/);
  assert.match(S.problems({...REAL,minSignal:100}).join(),/Min signal/);
});
test('SWYFT\'s defaults are kept as its app writes them',()=>{
  assert.deepEqual({...S.DEFAULTS},{p:19,i:13,d:47,integralSpeed:20,minSignal:500,maxSignal:2500,middleSignal:1500,deadZone:5,maxPower:400,left:111,right:111,reverse:true,stall:true,ramp:true});
  assert.deepEqual(S.problems(S.DEFAULTS),[]);
});
test('every programmable SWYFT servo is listed, and only those',()=>{
  assert.deepEqual(S.MODELS.map(m=>m.id),['speed','balance','torque','slim','nano']);
  assert.ok(S.MODELS.every(m=>m.programmable));assert.equal(S.modelById('speed-cr'),null);
});

test('the programmer skips its own echo and returns the servo\'s reply',async()=>{
  const link=new SimLink(),p=new S.Programmer(link),r=await p.read();
  assert.ok(r.ok);assert.deepEqual(r.settings,REAL);
});
test('no servo: the echo still proves the programmer works',async()=>{
  const p=new S.Programmer(new SimLink({servo:false}),{replyMs:120}),r=await p.read();
  assert.equal(r.ok,false);assert.equal(r.echo,true);
});
test('nothing at all comes back: the programmer itself is not answering',async()=>{
  const link={write:async()=>{},read:async ms=>{await wait(ms);return null;},flush:async()=>{}};
  const r=await new S.Programmer(link,{replyMs:120}).read();assert.equal(r.ok,false);assert.equal(r.echo,false);
});

test('the service finds the programmer and reads the servo, without writing anything',async()=>{
  const {s,link}=service();s.start();
  const st=await until(()=>s.state().servo.present&&s.state());
  assert.equal(st.programmer.ready,true);assert.equal(st.programmer.port,'COM8');
  assert.deepEqual(st.servo.settings,REAL);assert.equal(st.servo.degrees,320);
  assert.equal(link.writes.length,0);await s.dispose();
});
test('a port that is not a SWYFT programmer is listed but never opened',async()=>{
  const link=new SimLink(),transport=simTransport(link,{others:[{port:'COM5',vid:0x1A86,pid:0x7523,name:'USB-SERIAL CH340 (COM5)',serial:''}]});transport.plugged=false;
  const s=new SwyftService({transport,pollMs:40});started.push(s);s.start();await wait(150);
  assert.equal(transport.opened,0);assert.equal(s.state().programmer.ready,false);assert.equal(s.state().programmer.others[0].port,'COM5');
  await s.dispose();
});
test('SWYFT\'s own app open: Torque waits and can close it',async()=>{
  const {s,transport}=service(undefined,{rivals:['SwyftServoProgrammerV2']});s.start();await wait(150);
  assert.deepEqual(s.state().programmer.rivals,['SwyftServoProgrammerV2']);assert.equal(transport.opened,0);
  await s.closeRivals();await until(()=>s.state().servo.present);await s.dispose();
});
test('a port held by another program is reported, not fought over',async()=>{
  const {s,transport}=service(undefined,{held:true});s.start();
  await until(()=>s.state().programmer.held);assert.equal(s.state().programmer.ready,false);
  transport.held=false;await until(()=>s.state().servo.present);await s.dispose();
});
test('a write changes only what was asked, and is read back and confirmed',async()=>{
  const {s,link}=service();s.start();await until(()=>s.state().servo.present);
  const r=await s.write({maxPower:450,reverse:true,degrees:270});
  assert.equal(r.ok,true);assert.deepEqual(r.confirmed.map(c=>[c.key,c.took]),[['travel',true],['reverse',true],['maxPower',true]]);
  assert.deepEqual(r.confirmed[0],{key:'travel',asked:'270°',was:'320°',now:'270°',took:true});
  assert.equal(link.writes.length,1);assert.deepEqual(link.writes[0],{...REAL,maxPower:450,reverse:true,left:111,right:111});
  assert.deepEqual(s.state().servo.settings,{...REAL,maxPower:450,reverse:true,left:111,right:111});await s.dispose();
});
test('a value out of range, or a setting Torque does not know, is never written',async()=>{
  const {s,link}=service();s.start();await until(()=>s.state().servo.present);
  assert.match((await s.write({maxPower:900})).message,/Max power must be 0–500.*Nothing was written/);
  assert.match((await s.write({speed:3})).message,/does not know the setting/);
  assert.match((await s.write({reverse:1})).message,/wrong kind of value/);
  assert.match((await s.write({left:111})).message,/does not know the setting "left"/);
  assert.match((await s.write({degrees:400})).message,/Travel must be 0–320°/);
  assert.equal(link.writes.length,0);await s.dispose();
});
test('the same settings again are not sent',async()=>{
  const {s,link}=service();s.start();await until(()=>s.state().servo.present);
  const r=await s.write({maxPower:REAL.maxPower});assert.equal(r.ok,true);assert.match(r.message,/already has/);assert.equal(link.writes.length,0);await s.dispose();
});
test('a servo that does not keep a value is reported',async()=>{
  const {s}=service(new SimLink({keeps:false}));s.start();await until(()=>s.state().servo.present);
  const r=await s.write({maxPower:300});assert.equal(r.ok,false);assert.deepEqual(r.confirmed.map(c=>[c.key,c.took]),[['maxPower',false]]);await s.dispose();
});
test('a servo that never acknowledges is reported',async()=>{
  const {s}=service(new SimLink({ackFlag:0}));s.start();await until(()=>s.state().servo.present);
  const r=await s.write({maxPower:300});assert.equal(r.ok,false);assert.match(r.message,/did not acknowledge/);await s.dispose();
});
test('a servo pulled out shows as removed, and plugging it back finds it',async()=>{
  const {s,link}=service();s.start();await until(()=>s.state().servo.present);
  link.servo=false;await until(()=>!s.state().servo.present,5000);assert.ok(s.state().log.some(l=>l.text==='Servo removed.'));
  link.servo=true;await until(()=>s.state().servo.present,5000);await s.dispose();
});
test('the programmer pulled out shows as disconnected',async()=>{
  const {s,link,transport}=service();s.start();await until(()=>s.state().servo.present);
  transport.plugged=false;link.lost=true;await until(()=>!s.state().programmer.ready,5000);
  assert.ok(s.state().log.some(l=>/disconnected/.test(l.text)));await s.dispose();
});
test('continuous rotation sets both sides to 255, and leaving it puts the travel back',async()=>{
  const {s,link}=service();s.start();await until(()=>s.state().servo.present);
  assert.equal((await s.write({continuous:true})).ok,true);assert.equal(link.settings.left,255);assert.equal(link.settings.right,255);assert.equal(s.state().servo.continuous,true);
  assert.equal((await s.write({continuous:false,degrees:300})).ok,true);assert.equal(link.settings.left,S.degreesToSide(300));assert.equal(s.state().servo.degrees,299,'the nearest SWYFT can hold: one side step is about 2.6°');
  assert.equal((await s.write({continuous:true})).ok,true);assert.equal((await s.write({continuous:false})).ok,true);assert.equal(s.state().servo.degrees,270,"SWYFT's shipping travel when none is given");
  await s.dispose();
});
test('checkChanges takes only known settings of the right kind',()=>{
  assert.deepEqual(checkChanges({p:20,stall:false}),{p:20,stall:false});
  assert.throws(()=>checkChanges({}),/No changes/);assert.throws(()=>checkChanges({p:1.5}),/wrong kind/);
});

