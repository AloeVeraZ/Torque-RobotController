'use strict';
// The Control Hub on this computer's USB: what the helper and adb track-devices say, which device is the hub, and what the page is told.
// tests/usb-plug-ui.cjs takes it from there.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {UsbWatch,parseDevicePath,parseHelperLine,parseAdbList,trackReader,findHub,usbKind,LOG_MAX}=require('../src/usb-watch.cjs');
const HUB='\\\\?\\USB#VID_2207&PID_0011#24677C4269E7E709#{a5dcbf10-6530-11d2-901f-00c04fb951ed}',MOUSE='\\\\?\\usb#vid_174f&pid_2454#5&2535f9dd&0&4#{a5dcbf10-6530-11d2-901f-00c04fb951ed}';
const hubId={vid:'2207',pid:'0011',serial:'24677C4269E7E709'};
const frame=text=>text.length.toString(16).padStart(4,'0')+text;

test('a device path gives its ids and serial, in either case Windows writes it',()=>{
  assert.deepEqual(parseDevicePath(HUB),hubId);
  assert.deepEqual(parseDevicePath('\\\\?\\usb#vid_2207&pid_0011#24677c4269e7e709#{a5dcbf10-6530-11d2-901f-00c04fb951ed}'),{...hubId,serial:'24677c4269e7e709'});
  assert.deepEqual(parseDevicePath(MOUSE),{vid:'174f',pid:'2454',serial:'5&2535f9dd&0&4'},'a device with no serial of its own');
  assert.equal(parseDevicePath('\\\\?\\USB#ROOT_HUB30#4&1a2b3c&0&0#{f18a0e88-c30c-11d0-8815-00a0c906bed8}'),null,'a root hub is no device here');
  assert.equal(parseDevicePath('\\\\?\\USB#VID_2207&PID_0011&MI_01#6&aff1613&0&0001#{f72fe0d4-cbcb-407d-8814-9ed673d0dd6b}'),null,'nor is one function of a composite device');
  assert.equal(parseDevicePath('nonsense'),null);assert.equal(parseDevicePath(null),null);
});
test('each line the helper writes is read',()=>{
  assert.deepEqual(parseHelperLine(`= 1793566579170 ${HUB}\tControl Hub v1.0`),{kind:'list',at:1793566579170,device:{...hubId,name:'Control Hub v1.0'}});
  assert.deepEqual(parseHelperLine(`+ 5 ${HUB}\t\r`),{kind:'add',at:5,device:{...hubId,name:''}},'it could not read a name');
  assert.deepEqual(parseHelperLine(`- 6 ${HUB}`),{kind:'remove',at:6,device:{...hubId,name:''}});
  assert.deepEqual(parseHelperLine('ready 7'),{kind:'ready',at:7});assert.deepEqual(parseHelperLine('err Could not ask (Windows error 5)'),{kind:'error',message:'Could not ask (Windows error 5)'});
  assert.equal(parseHelperLine('+ 5 \\\\?\\USB#ROOT_HUB30#x#{y}'),null);assert.equal(parseHelperLine(''),null);assert.equal(parseHelperLine('hello'),null);
});
test('adb track-devices is read with its length, which Windows\'s \\r\\n does not count',()=>{
  // Measured from this adb (31.0.3): long output pads the serial and ends in \r\n, with \n in the count.
  assert.deepEqual(parseAdbList('24677c4269e7e709       device product:ch_v1_box model:Control_Hub_v1_0 device:rk3328_box transport_id:2\n'),[{serial:'24677c4269e7e709',state:'device',model:'Control_Hub_v1_0'}]);
  assert.deepEqual(parseAdbList('24677c4269e7e709\tunauthorized\n4315Q2U9R9 device product:PX30_RDS model:Driver_Hub device:PX30_RDS\n\n'),[{serial:'24677c4269e7e709',state:'unauthorized',model:null},{serial:'4315Q2U9R9',state:'device',model:'Driver_Hub'}]);
  const lists=[],read=trackReader(l=>lists.push(l)),one='24677c4269e7e709\tdevice\n',wire=(frame(one)+frame('')+frame(one)).replace(/\n/g,'\r\n');
  for(const part of [wire.slice(0,3),wire.slice(3,9),wire.slice(9,25),wire.slice(25)])read(Buffer.from(part));
  assert.deepEqual(lists,[[{serial:'24677c4269e7e709',state:'device',model:null}],[],[{serial:'24677c4269e7e709',state:'device',model:null}]]);
  const noise=[],garbled=trackReader(l=>noise.push(l));garbled('adb: usage: unknown command\n');garbled(frame(one));assert.deepEqual(noise,[[{serial:'24677c4269e7e709',state:'device',model:null}]],'what is not a list is dropped, and the next list still reads');
});
test('what a USB device is, from Windows\'s word alone',()=>{
  const SERIAL='24677C4269E7E709',kind=(vid,pid,name='',serial='4315Q2U9R9')=>usbKind({vid,pid,name,serial});
  // Measured here: three Control Hubs and a Driver Hub.
  assert.equal(kind('2207','0011','Control Hub v1.0',SERIAL),'control-hub');assert.equal(kind('2207','0017','Driver Hub'),'driver-hub');assert.equal(kind('2207','0017'),'driver-hub','the ids are enough');
  // 2207:0006 is a Driver Hub starting up, or a Control Hub in fastboot.
  assert.equal(kind('2207','0006','Driver Hub'),'driver-hub');assert.equal(kind('2207','0006','Android',SERIAL),'control-hub-update');assert.equal(kind('2207','0006','Android','4315Q2U9R9'),'control-hub-update','anything but Driver Hub');
  assert.equal(kind('2207','0006','',SERIAL),'control-hub-update','no name: 16 hex digits is a Control Hub');assert.equal(kind('2207','0006','','4315Q2U9R9'),null,'and anything else is unknown');
  // The other USB modes in REV's driver list go the same way, and are not fastboot.
  for(const pid of ['0010','0012','0013','0014','0015']){assert.equal(kind('2207',pid,'Driver Hub'),'driver-hub');assert.equal(kind('2207',pid,'Control Hub v1.0',SERIAL),'control-hub');assert.equal(kind('2207',pid,'',SERIAL),'control-hub');assert.equal(kind('2207',pid,''),null);}
  assert.equal(kind('2207','320c'),null,'another Rockchip device is unknown');
  assert.equal(kind('18d1','d00d'),null,'Google\'s id: a phone can match, so it is ignored');assert.equal(kind('0403','6015','FT230X'),'expansion-hub');assert.equal(kind('174f','2454','Integrated Camera'),null);
});
test('which device is the hub',()=>{
  const look=o=>findHub({usb:true,devices:[],adb:[],...o}),mouse={vid:'174f',pid:'2454',serial:'x'},hub=hubId,adbHub={serial:'24677c4269e7e709',state:'device',model:'Control_Hub_v1_0'};
  assert.equal(look({devices:[mouse]}),null,'nothing here is a hub');
  assert.deepEqual(look({devices:[mouse,{...hub,name:'Control Hub v1.0'}]}),{serial:'24677c4269e7e709',state:null,update:false,model:null,name:'Control Hub v1.0',vid:'2207',pid:'0011',usb:true,key:'2207:0011:24677c4269e7e709'},'Windows names it before ADB has said a word');
  assert.equal(look({devices:[hub],adb:[adbHub]}).state,'device','and the serial matches whatever the case');
  assert.equal(look({devices:[{vid:'2207',pid:'0012',serial:'q'}]}),null,'another Rockchip device is unknown');
  assert.equal(look({devices:[{vid:'2207',pid:'0017',serial:'4315Q2U9R9',name:'Driver Hub'}]}),null,'a Driver Hub, with no ADB needed');
  assert.equal(look({devices:[{vid:'2207',pid:'0006',serial:'4315Q2U9R9',name:'Driver Hub'}]}),null,'also while it starts');
  assert.equal(look({devices:[{vid:'0403',pid:'6015',serial:'DQ1',name:'FT230X'}]}),null,'an Expansion Hub on the computer is no Control Hub');
  assert.equal(look({devices:[{vid:'18d1',pid:'d00d',serial:'q'}]}),null,'nor is fastboot on Google\'s id');
  {const f=look({devices:[{...hub,pid:'0006',name:'Android'}]});assert.equal(f.state,'update');assert.equal(f.update,true);assert.equal(f.serial,'24677c4269e7e709');}
  assert.equal(look({devices:[{...hub,pid:'0006',name:'Android'}],adb:[{serial:'zy22',state:'device',model:'moto'}]}).state,'update','a phone on ADB is not this hub in fastboot');
  const phone=look({devices:[mouse,{vid:'22b8',pid:'2e76',serial:'ZY22'}],adb:[{serial:'zy22',state:'device',model:'moto'}]});assert.equal(phone.serial,'zy22','what ADB can talk to is the robot, whatever its ids');assert.equal(phone.key,'22b8:2e76:zy22');
  assert.equal(look({devices:[{...hub,serial:'4315Q2U9R9'}],adb:[{serial:'4315Q2U9R9',state:'device',model:'Driver_Hub'}],notHubs:new Set(['4315q2u9r9'])}),null,'ADB has the final word on a Driver Hub');
  assert.equal(look({devices:[{...hub,serial:'5&abc&0&1'}],adb:[adbHub]}).serial,'24677c4269e7e709','a made-up serial joins the one thing ADB lists');
  assert.equal(look({devices:[{...hub,serial:'5&abc&0&1'}],adb:[{serial:'192.168.43.1:5555',state:'device'}]}).state,null,'but not a hub on the network');
  assert.equal(look({devices:[],adb:[adbHub],gone:new Set(['24677c4269e7e709'])}),null,'Windows says it left, and ADB is only late');
  assert.equal(look({devices:[],adb:[adbHub]}).usb,false,'ADB can see what Windows does not name');
  assert.equal(findHub({usb:false,devices:[],adb:[adbHub]}).serial,'24677c4269e7e709','with no helper, ADB alone');
  assert.equal(findHub({usb:false,devices:[],adb:[{serial:'d',state:'device',model:'Driver_Hub'}]}),null);
  const two=look({devices:[hub,{...hub,serial:'B'}],adb:[{serial:'b',state:'device'},{serial:'24677c4269e7e709',state:'offline'}]});assert.equal(two.serial,'b','of two, the one that answers');
  // The hub so far stays the hub while it is there, whatever the order.
  const a={...hub},b={...hub,serial:'B'},adbBoth=[{serial:'b',state:'device'},{serial:'24677c4269e7e709',state:'device'}],now=look({devices:[a,b],adb:adbBoth});assert.equal(now.serial,'24677c4269e7e709');
  assert.equal(look({devices:[b,a],adb:adbBoth,current:now}).serial,'24677c4269e7e709','Windows lists them the other way round');assert.equal(look({devices:[b,a],adb:adbBoth}).serial,'b','as it would have, with no current hub');
  assert.equal(look({devices:[b,a],adb:[{serial:'b',state:'device'},{serial:'24677c4269e7e709',state:'offline'}],current:now}).serial,'24677c4269e7e709','offline for a moment is still there');
  assert.equal(look({devices:[b],adb:[{serial:'b',state:'device'}],current:now}).serial,'b','gone: the other one');
  const noUsb={usb:false,devices:[]};assert.equal(findHub({...noUsb,adb:adbBoth,current:{serial:'24677c4269e7e709',key:null}}).serial,'24677c4269e7e709','ADB alone too');assert.equal(findHub({...noUsb,adb:adbBoth}).serial,'b');
});

// A pretend helper and adb.
function rig(options={}){const kids=[],states=[],gone=[];
  const start=(file,args)=>{const kid=new EventEmitter();kid.file=file;kid.args=args;kid.stdout=new EventEmitter();kid.written=[];kid.ended=false;kid.killed=false;kid.stdin=new EventEmitter();kid.stdin.write=t=>kid.written.push(t);kid.stdin.end=()=>{kid.ended=true;};kid.kill=()=>{kid.killed=true;};kids.push(kid);return kid;};
  const watch=new UsbWatch({helper:'helper.exe',adbPath:()=>'adb.exe',start,onChange:s=>states.push(s),onGone:s=>gone.push(s),supported:true,...options});
  const helper=()=>kids.filter(k=>k.file==='helper.exe').at(-1),track=()=>kids.filter(k=>k.file==='adb.exe').at(-1),say=(...lines)=>helper().stdout.emit('data',Buffer.from(lines.map(l=>l+'\n').join(''))),adb=text=>track().stdout.emit('data',Buffer.from(frame(text)));
  return {watch,kids,states,gone,helper,track,say,adb,last:()=>states.at(-1)};}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const ADB_HUB='24677c4269e7e709       device product:ch_v1_box model:Control_Hub_v1_0 device:rk3328_box transport_id:2\n';

test('unplugged: the page is told as soon as Windows says, whatever ADB still lists; plugged in: before ADB answers',()=>{
  const r=rig();const first=r.watch.start();assert.deepEqual([first.usb,first.hub,first.status],[false,null,null],'nothing known yet');
  assert.deepEqual(r.track().args,['track-devices','-l']);assert.equal(r.states.length,0);
  r.say(`= 1 ${MOUSE}`,`= 1 ${HUB}`);assert.equal(r.states.length,0,'the list is whole only at ready');r.say('ready 2');
  assert.deepEqual(r.last().devices.map(d=>d.vid),['174f','2207']);assert.deepEqual(r.last().hub.serial,'24677c4269e7e709');assert.equal(r.last().status,null,'ADB has not said yet, so it still has to be asked');
  assert.equal(r.watch.status(),null);r.adb(ADB_HUB);assert.deepEqual(r.last().status,{found:true,serial:'24677c4269e7e709'});assert.deepEqual(r.watch.status(),{found:true,serial:'24677c4269e7e709'});assert.equal(r.last().adb.running,true);assert.equal(r.last().hub.model,'Control_Hub_v1_0');
  // Pulled. ADB has not noticed yet.
  r.say(`- 10 ${HUB}`);assert.equal(r.last().hub,null);assert.equal(r.last().drop,'unplugged');assert.equal(r.last().why,'-');assert.deepEqual(r.last().status,{found:false,message:'Not plugged in.'});assert.deepEqual(r.gone,['24677c4269e7e709'],'what was kept for it is let go');
  assert.equal(r.last().adb.devices.length,1,'ADB is still late');const n=r.states.length;r.adb('');assert.equal(r.states.length,n+1);assert.equal(r.last().hub,null);assert.equal(r.last().drop,null,'one drop, not two');assert.deepEqual(r.gone,['24677c4269e7e709']);
  // Back. Windows knows first; ADB moves it on.
  r.say(`+ 20 ${HUB}`);assert.equal(r.last().hub.state,null);assert.deepEqual(r.last().status,{found:false,plugged:true,state:null,message:'Control Hub plugged in. Waiting for it to answer…'});
  r.adb('24677c4269e7e709\toffline\n');assert.equal(r.last().status.state,'offline');assert.match(r.last().status.message,/Waiting for it to answer/);
  r.adb('24677c4269e7e709\tunauthorized\n');assert.match(r.last().status.message,/Allow this computer in the REV Hardware Client/);assert.equal(r.last().status.found,false);assert.equal(r.last().status.plugged,true);
  r.adb(ADB_HUB);assert.equal(r.last().status.found,true);assert.deepEqual(r.gone,['24677c4269e7e709'],'nothing left along the way');r.watch.quit();
});
test('a device that is not the hub comes and goes without a drop',()=>{
  const r=rig();r.watch.start();r.say(`= 1 ${HUB}`,'ready 2');r.adb(ADB_HUB);r.say(`+ 3 ${MOUSE}`);assert.equal(r.last().devices.length,2);assert.equal(r.last().drop,null);r.say(`- 4 ${MOUSE}`);assert.equal(r.last().devices.length,1);assert.equal(r.last().drop,null);assert.deepEqual(r.gone,[]);assert.ok(r.last().hub);r.watch.quit();
});
test('nothing is pushed when nothing changed, and an ADB change has Windows\'s list read again, so a missed event is not a stuck screen',()=>{
  const r=rig();r.watch.start();r.say(`= 1 ${HUB}`,'ready 2');r.adb(ADB_HUB);assert.deepEqual(r.helper().written,['list\n']);let n=r.states.length;
  r.adb(ADB_HUB);assert.equal(r.states.length,n);assert.equal(r.helper().written.length,1,'the same list again asks for nothing');
  r.say(`= 3 ${HUB}`,'ready 4');assert.equal(r.states.length,n,'the same answer pushes nothing');
  // ADB saw it leave and no - ever came: the list read again says so.
  r.adb('');assert.equal(r.helper().written.length,2);assert.equal(r.last().hub.state,null,'until Windows answers it is still on the cable');r.say('ready 5');assert.equal(r.last().hub,null);assert.equal(r.last().drop,'unplugged');r.watch.quit();
});
const device=(vid,pid,serial)=>`\\\\?\\USB#VID_${vid}&PID_${pid}#${serial}#{a5dcbf10-6530-11d2-901f-00c04fb951ed}`;
test('a Driver Hub is never told as a hub: not as it starts, not running, and not when ADB lists it with no model',()=>{
  const r=rig(),start=device('2207','0006','4315Q2U9R9'),running=device('2207','0017','4315Q2U9R9');r.watch.start();r.say('ready 1');r.adb('');
  r.say(`+ 2 ${start}\tDriver Hub`);assert.equal(r.last().hub,null);assert.equal(r.last().devices[0].kind,'driver-hub');r.say(`- 3 ${start}`);assert.equal(r.last().drop,null,'nothing dropped');
  r.say(`+ 4 ${running}\tDriver Hub`);assert.equal(r.last().hub,null);assert.equal(r.last().drop,null);
  r.adb('4315Q2U9R9\tunauthorized\n');assert.equal(r.last().hub,null,'known by its serial');r.say(`- 5 ${running}`);assert.equal(r.last().hub,null,'and still, with ADB late');assert.ok(r.states.every(s=>!s.hub&&s.status?.found!==true));assert.deepEqual(r.gone,[]);r.watch.quit();
  // ADB on its own, with no helper to say first, still has its word.
  const off=rig({supported:false});off.watch.start();off.adb('4315Q2U9R9 device product:PX30_RDS model:Driver_Hub device:PX30_RDS\n');assert.equal(off.last().hub,null);off.watch.quit();
});
test('a Control Hub in update mode says so, is never read as ready, and leaving it is no drop',()=>{
  const r=rig(),fast=device('2207','0006','24677C4269E7E709');r.watch.start();r.say('ready 1');r.adb('');
  r.say(`+ 2 ${fast}\tAndroid`);assert.equal(r.last().hub.update,true);assert.deepEqual(r.last().status,{found:false,plugged:true,state:'update',message:'Control Hub plugged in. It is in update mode, so Torque cannot read it until it restarts.'});
  r.say(`- 3 ${fast}`);assert.equal(r.last().drop,'restarting');assert.deepEqual(r.gone,[],'nothing was kept for it');
  r.say(`+ 4 ${HUB}\tControl Hub v1.0`);assert.equal(r.last().hub.update,false);assert.equal(r.last().hub.name,'Control Hub v1.0');assert.match(r.last().status.message,/Waiting for it to answer/);r.adb(ADB_HUB);assert.equal(r.last().status.found,true);r.watch.quit();
  const asked=rig();asked.watch.start();asked.say(`= 1 ${fast}\tAndroid`,'ready 2');assert.match(asked.watch.withPoll({found:false,message:'Not plugged in.'}).message,/update mode/);asked.watch.quit();
});
test('should ADB ever call a 2207:0011 device a Driver Hub, it goes quietly: no drop, and it never comes back as a Control Hub',()=>{
  const r=rig(),DH=device('2207','0011','4315Q2U9R9');r.watch.start();r.say('ready 1');r.adb('');
  r.say(`+ 2 ${DH}`);assert.equal(r.last().hub.serial,'4315q2u9r9','it looks like a hub until ADB says');
  r.adb('4315Q2U9R9 device product:PX30_RDS model:Driver_Hub device:PX30_RDS\n');assert.equal(r.last().hub,null);assert.equal(r.last().drop,'driver-hub');assert.deepEqual(r.gone,[]);
  r.say(`- 3 ${DH}`);r.adb('');r.say(`+ 4 ${DH}`);assert.equal(r.last().hub,null,'known now');assert.equal(r.last().devices.length,1,'still on the list of what is plugged in');r.watch.quit();
});
test('with a Driver Hub and a Control Hub both plugged in, the Control Hub is the hub',()=>{
  const r=rig(),DH=device('2207','0017','4315Q2U9R9');r.watch.start();r.say(`= 1 ${DH}\tDriver Hub`,`= 1 ${HUB}\tControl Hub v1.0`,'ready 2');assert.equal(r.last().hub.serial,'24677c4269e7e709','before ADB answers too');
  r.adb('4315Q2U9R9 device model:Driver_Hub\n'+ADB_HUB);assert.equal(r.last().hub.serial,'24677c4269e7e709');assert.deepEqual(r.last().status,{found:true,serial:'24677c4269e7e709'});r.watch.quit();
});
test('the helper stopping is no drop: it comes back by itself, and ADB covers meanwhile',async()=>{
  const r=rig();r.watch.start();r.say(`= 1 ${HUB}`,'ready 2');r.adb(ADB_HUB);const first=r.helper();first.emit('exit',1);
  assert.equal(r.last().usb,false);assert.equal(r.last().hub.serial,'24677c4269e7e709','ADB still has it');assert.equal(r.last().status,null,'so the old way is asked again');assert.deepEqual(r.gone,[]);
  await delay(350);assert.notEqual(r.helper(),first,'started again');r.say(`= 3 ${HUB}`,'ready 4');assert.equal(r.last().usb,true);assert.equal(r.last().hub.usb,true);assert.equal(r.last().drop,null);r.watch.quit();
});
test('both gone says nothing about the hub, and ADB\'s child comes back after its server restarts',async()=>{
  const r=rig();r.watch.start();r.say(`= 1 ${HUB}`,'ready 2');r.adb(ADB_HUB);const was=r.track();was.emit('exit',0);assert.equal(r.last().adb.running,false);assert.equal(r.last().hub.state,null,'still on the cable, state unknown');assert.equal(r.last().status,null);
  r.helper().emit('exit',1);assert.equal(r.last().hub,null);assert.equal(r.last().drop,null,'nobody can see, so nobody says it left');assert.deepEqual(r.gone,[]);
  await delay(350);assert.notEqual(r.track(),was);r.watch.quit();
});
test('with no helper, or a helper that will not start, ADB alone runs it and nothing throws',async()=>{
  const off=rig({supported:false});off.watch.start();assert.equal(off.kids.length,1);assert.equal(off.kids[0].file,'adb.exe');off.adb(ADB_HUB);assert.equal(off.last().usb,false);assert.equal(off.last().hub.serial,'24677c4269e7e709');assert.equal(off.last().status,null,'the old way goes on being asked too');
  off.adb('');assert.equal(off.last().hub,null);assert.equal(off.last().drop,'unplugged');assert.deepEqual(off.gone,['24677c4269e7e709']);off.watch.quit();
  let calls=0;const states=[],broken=new UsbWatch({supported:true,helper:'gone.exe',adbPath:()=>'adb.exe',onChange:s=>states.push(s),start:()=>{calls++;throw Error('spawn failed');}});assert.equal(broken.start().usb,false);await delay(300);assert.ok(calls>=3,'it keeps trying, quietly');broken.quit();
  const missing=rig();missing.watch.start();missing.helper().emit('error',Object.assign(Error('spawn'),{code:'ENOENT'}));missing.track().emit('error',Object.assign(Error('spawn'),{code:'ENOENT'}));assert.equal(missing.last().usb,false);missing.watch.quit();
});
test('with two ADB devices, one coming up does not end the session of the hub that is still plugged in',()=>{
  const r=rig(),OTHER=device('2207','0011','AAAA0000BBBB1111');r.watch.start();r.say(`= 1 ${HUB}`,'ready 2');r.adb(ADB_HUB);assert.equal(r.last().hub.serial,'24677c4269e7e709');
  r.say(`+ 3 ${OTHER}`);r.adb(`AAAA0000BBBB1111\tdevice\n${ADB_HUB}`);r.say(`= 4 ${OTHER}`,`= 4 ${HUB}`,'ready 5');
  assert.equal(r.last().hub.serial,'24677c4269e7e709','it stays the hub');assert.deepEqual(r.gone,[],'nothing was told it left');assert.ok(r.states.every(s=>s.drop===null));
  r.say(`- 6 ${HUB}`);assert.equal(r.last().hub.serial,'AAAA0000BBBB1111','it really left: the other one');assert.deepEqual(r.gone,['24677c4269e7e709']);assert.equal(r.last().drop,'unplugged');r.watch.quit();
});
test('a device whose made-up serial loses its match in ADB is the same device: no drop',()=>{
  const r=rig(),NO_SERIAL=device('2207','0011','5&abc&0&1');r.watch.start();r.say(`= 1 ${NO_SERIAL}`,'ready 2');r.adb(ADB_HUB);assert.equal(r.last().hub.serial,'24677c4269e7e709');
  r.track().emit('exit',0);assert.equal(r.last().drop,null);assert.equal(r.last().hub.serial,'5&abc&0&1','Windows still has it');assert.deepEqual(r.gone,[]);r.watch.quit();
});
test('late output from a helper already let go changes nothing: no hub comes back, and the next start hears no false drop',()=>{
  const r=rig();r.watch.start();r.say(`= 1 ${HUB}`,'ready 2');r.adb(ADB_HUB);const old=r.helper();r.watch.quit();assert.equal(r.watch.usbLive,false);
  old.stdout.emit('data',Buffer.from(`= 3 ${HUB}\nready 4\n+ 5 ${HUB}\n`));assert.equal(r.watch.usbLive,false,'nothing is revived');assert.equal(r.watch.hub,null);assert.equal(r.watch.devices.size,0);
  const n=r.states.length,first=r.watch.start();assert.deepEqual([first.usb,first.hub],[false,null]);r.say('ready 6');r.adb('');assert.equal(r.states.length>n,true);assert.ok(r.states.slice(n).every(s=>s.drop===null),'the hub was pulled meanwhile: no dialog for that');assert.deepEqual(r.gone,[]);r.watch.quit();
});
test('with no helper, ADB\'s server restarting is no drop: its first list is often empty, and the hub comes back',async()=>{
  const r=rig({supported:false,unseenMs:40});r.watch.start();r.adb(ADB_HUB);assert.equal(r.last().hub.serial,'24677c4269e7e709');
  r.track().emit('exit',0);assert.equal(r.last().hub,null);assert.equal(r.last().drop,null);await delay(300);r.adb('');assert.equal(r.last().hub,null,'its first list');assert.equal(r.last().drop,null,'says nothing yet');assert.deepEqual(r.gone,[]);
  r.adb(ADB_HUB);assert.equal(r.last().hub.serial,'24677c4269e7e709');assert.equal(r.last().drop,null);await delay(80);assert.ok(r.states.every(s=>s.drop===null),'and nothing fires later');assert.deepEqual(r.gone,[]);r.watch.quit();
});
test('with no helper, a hub pulled while ADB restarted is still found gone: later, and once',async()=>{
  const r=rig({supported:false,unseenMs:40});r.watch.start();r.adb(ADB_HUB);r.track().emit('exit',0);await delay(300);r.adb('');assert.equal(r.last().drop,null);await delay(80);
  assert.equal(r.last().drop,'unplugged','so the page can say so');assert.equal(r.last().why,'unseen');assert.equal(r.last().hub,null);assert.deepEqual(r.gone,['24677c4269e7e709'],'and what was kept for it goes');
  const n=r.states.length;await delay(80);r.adb('');assert.equal(r.states.length,n,'once');r.watch.quit();
  // Pulled with ADB up is the quick way, as ever.
  const quick=rig({supported:false});quick.watch.start();quick.adb(ADB_HUB);quick.adb('');assert.equal(quick.last().drop,'unplugged');assert.deepEqual(quick.gone,['24677c4269e7e709']);quick.watch.quit();
});
test('both layers gone and Windows back first: its word is final, and with the hub on its list nothing happened',async()=>{
  const gone=rig({unseenMs:100000});gone.watch.start();gone.say(`= 1 ${HUB}`,'ready 2');gone.adb(ADB_HUB);gone.track().emit('exit',0);gone.helper().emit('exit',1);assert.equal(gone.last().hub,null);assert.equal(gone.last().drop,null);await delay(300);gone.say('ready 3');assert.equal(gone.last().drop,'unplugged');assert.deepEqual(gone.gone,['24677c4269e7e709']);gone.watch.quit();
  const here=rig({unseenMs:100000});here.watch.start();here.say(`= 1 ${HUB}`,'ready 2');here.adb(ADB_HUB);here.track().emit('exit',0);here.helper().emit('exit',1);await delay(300);here.say(`= 3 ${HUB}`,'ready 4');assert.equal(here.last().hub.serial,'24677c4269e7e709');assert.equal(here.last().drop,null);assert.deepEqual(here.gone,[]);here.watch.quit();
  // Stopping forgets it: a quit is no drop.
  const quit=rig({supported:false,unseenMs:30});quit.watch.start();quit.adb(ADB_HUB);quit.track().emit('exit',0);await delay(300);quit.adb('');quit.watch.quit();const n=quit.states.length;await delay(60);assert.equal(quit.states.length,n);assert.deepEqual(quit.gone,[]);
});
test('asked the old way, a hub Windows can see still reads as plugged in',()=>{
  const r=rig();r.watch.start();r.say(`= 1 ${HUB}`,'ready 2');
  assert.deepEqual(r.watch.withPoll({found:true,serial:'s'}),{found:true,serial:'s'});
  assert.deepEqual(r.watch.withPoll({found:false,message:'Not plugged in.'}),{found:false,plugged:true,state:null,message:'Control Hub plugged in. Waiting for it to answer…'});
  assert.match(r.watch.withPoll({found:false,message:'Allow this computer in the REV Hardware Client.'}).message,/^Control Hub plugged in\. Allow this computer/);
  assert.match(r.watch.withPoll({found:false,message:'Torque could not find its USB tool. Install the REV Hardware Client, which includes it.'}).message,/^Control Hub plugged in\. Torque could not find its USB tool/);
  r.say(`- 3 ${HUB}`);assert.deepEqual(r.watch.withPoll({found:false,message:'Not plugged in.'}),{found:false,message:'Not plugged in.'});r.watch.quit();
});
test('it runs only while wanted: going between tabs keeps it, leaving lets it go, and nothing outlives the app',async()=>{
  const r=rig();r.watch.start();const helper=r.helper(),track=r.track();r.watch.stop();r.watch.start();assert.equal(r.kids.length,2,'one stop and one start is no new process');
  r.watch.stop();r.watch.quit();assert.equal(helper.ended,true,'closing stdin is what ends the helper');assert.equal(track.killed,true);helper.emit('exit',0);track.emit('exit',0);await delay(350);assert.equal(r.kids.length,2,'not wanted, it does not come back');
  const n=r.states.length;r.watch.start();assert.equal(r.kids.length,4,'wanted again, it starts again');assert.equal(r.states.length,n);r.watch.quit();
  const quiet=rig();quiet.watch.start();quiet.say(`= 1 ${HUB}`,'ready 2');quiet.adb(ADB_HUB);quiet.watch.stop();const m=quiet.states.length;quiet.say(`- 3 ${HUB}`);assert.equal(quiet.states.length,m,'a tab no longer shows, so nothing is told');assert.deepEqual(quiet.gone,[]);quiet.watch.quit();
});
test('usb-watch.log has the time of each event, stays small, and says when the page drew it',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'usb-watch-')),logFile=path.join(dir,'usb-watch.log');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let clock=1000;const r=rig({logFile,now:()=>clock});r.watch.start();r.say(`= 1 ${HUB}`,'ready 2');r.adb(ADB_HUB);clock=5000;r.say(`- 4990 ${HUB}`);const seq=r.last().seq;r.watch.shown(seq,5040);r.watch.shown(seq-1,5041);
  const text=fs.readFileSync(logFile,'utf8');assert.match(text,/- 2207:0011 24677C4269E7E709 helper=4990 main=5000 pushed=5000 seq=\d+ hub=none drop=unplugged/);assert.match(text,/shown seq=\d+ at=5040 windows-to-page=50ms/);assert.ok(!/at=5041/.test(text),'only for the latest');
  for(let i=0;i<1500;i++){clock+=1;r.say(`${i%2?'-':'+'} ${clock} ${MOUSE}`);}assert.ok(fs.statSync(logFile).size<=LOG_MAX,`capped: ${fs.statSync(logFile).size}`);assert.match(fs.readFileSync(logFile,'utf8').split('\n')[0],/^\d{4}-\d\d-\d\dT/,'starts on a whole line');r.watch.quit();
});
test('the helper is present and built from its source',{skip:process.platform!=='win32'},()=>{
  const dir=path.join(__dirname,'..','src','usb-watch');assert.ok(fs.existsSync(path.join(dir,'UsbWatch.cs')));const exe=fs.readFileSync(path.join(dir,'UsbWatch.exe'));assert.equal(exe.slice(0,2).toString(),'MZ');
});
