'use strict';
// Any number of Expansion Hubs and Servo Hubs, and Servo Power Modules: in Setup, read from a robot's configuration and
// written back to one; and the Driver Station's USB relay, which leaves nothing on the hub.
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const D=require('../ui/sim-hardware.js'),W=require('../ui/sim-wiring.js'),HS=require('../ui/sim-hub-setup.js'),RC=require('../ui/ftc/robot-config.js'),C=require('../ui/sim-config.js'),M=require('../ui/sim-mechanisms.js'),T=require('../ui/sim-test-robot.js'),L=require('../src/robot-link.cjs');
const setup=()=>{const s=T.setup();s.robot=C.robot(s.robot,'ftc');s.mechanisms=M.sanitize(s.mechanisms);return s;};
const XML=`<?xml version='1.0'?><Robot type="FirstInspires-FTC"><LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">
<LynxModule name="Expansion Hub 5" port="5"><goBILDA5202SeriesMotor name="lift" port="1" /></LynxModule><LynxModule name="Expansion Hub 2" port="2"><goBILDA5202SeriesMotor name="arm" port="0" /></LynxModule>
<LynxModule name="Control Hub" port="173"><goBILDA5202SeriesMotor name="frontLeft" port="0" /><ControlHubImuBHI260AP name="imu" port="0" bus="0" /></LynxModule>
<ServoHub name="Servo Hub 7" port="7"><Servo name="wrist" port="2" /></ServoHub><ServoHub name="Servo Hub 3" port="3"><ContinuousRotationServo name="swerve" port="4" /></ServoHub></LynxUsbDevice></Robot>`;

test('a robot can have several Expansion Hubs and Servo Hubs, each with its own address',()=>{
  let w=W.setHubCount(null,'expansion',3);w=W.setHubCount(w,'servoHub',2);
  assert.deepEqual(D.hubIds(w),['control','expansion','expansion2','expansion3','servoHub','servoHub2']);
  const at=D.hubIds(w).slice(1).map(id=>w.hubs[id].address);assert.equal(new Set(at).size,5,'every address is used once');assert.ok(at.every(a=>a>=1&&a<=10));
  assert.equal(D.hubName('expansion2',w),`Expansion Hub ${w.hubs.expansion2.address}`);assert.equal(W.setHubCount(null,'expansion',1).hubs.expansion.address,2);
  assert.equal(D.hubName('expansion',W.setHubCount(null,'expansion',1)),'Expansion Hub','one is just the Expansion Hub');
  const fewer=W.setHubCount(w,'expansion',1);assert.deepEqual(D.hubIds(fewer),['control','expansion','servoHub','servoHub2']);
  assert.equal(W.setHubCount(w,'expansion',0).hubs.expansion,false,'none stays none');
  assert.equal(D.hubIds(W.setHubCount(null,'expansion',50)).length,11,'addresses 1 to 10: ten hubs at most off a Control Hub');
  assert.equal(W.setHubAddress(w,'expansion2',w.hubs.expansion.address).hubs.expansion2.address,w.hubs.expansion2.address,'an address in use is refused');
});

test('a device can be wired to any of them, and a removed hub sends it back to Deck’s choice',()=>{
  let w=W.setHubCount(null,'expansion',2);w=W.setHubCount(w,'servoHub',2);
  w=W.setPort(w,'kin.a','expansion2:3','motor');w=W.setPort(w,'kin.b','servoHub2:5','servo');
  assert.deepEqual([w.devices['kin.a'].hub,w.devices['kin.a'].port],['expansion2',3]);assert.deepEqual([w.devices['kin.b'].hub,w.devices['kin.b'].port],['servoHub2',5]);
  assert.equal(W.setHubCount(w,'expansion',1).devices['kin.a'],undefined);
  const list=[0,1,2,3,4].map(i=>({key:'kin.m'+i,name:'m'+i,label:'M'+i,family:'motor',role:'kin-motor',kind:'dcmotor'}));
  const plan=D.plan(list,W.setHubCount(null,'expansion',2)),hubs=new Set(Object.values(plan.assign).map(a=>a.hub));assert.ok(hubs.has('expansion')&&hubs.has('expansion2'),'motors fill the next hub');
  assert.ok(W.hubsHtml({wiring:w,rows:[]}).includes('data-hub="servoHub2"'),'each hub shows its ports');
});

test('hubs of a kind stay numbered by address, and their devices follow an address change',()=>{
  let w=W.setHubCount(null,'expansion',2);assert.deepEqual([w.hubs.expansion.address,w.hubs.expansion2.address],[2,3]);
  w=W.setPort(w,'kin.a','expansion:1','motor');w=W.setHubAddress(w,'expansion',5);
  assert.deepEqual([w.hubs.expansion.address,w.hubs.expansion2.address],[3,5]);assert.equal(w.devices['kin.a'].hub,'expansion2','the motor stays on the hub at address 5');
});

test('hubs are found from the robot: a Servo Hub by its product number, and hubs the configuration lacks are added',()=>{
  const p=RC.lynxModules('{"modules":[{"imuType":"NONE","isParent":false,"moduleAddress":2,"revProductNumber":3215698},{"imuType":"NONE","isParent":false,"moduleAddress":4,"revProductNumber":1120341},{"imuType":"BHI260","isParent":true,"moduleAddress":173,"revProductNumber":3215698}],"serialNumber":"(embedded)"}');
  assert.deepEqual(p.modules.map(m=>m.address),[2,173]);assert.deepEqual(p.servoHubs,[{address:4}]);
  const bare=RC.parse(`<?xml version='1.0'?><Robot type="FirstInspires-FTC"><LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173"><LynxModule name="Control Hub" port="173"><Motor name="m" port="0" /></LynxModule></LynxUsbDevice></Robot>`);
  assert.deepEqual(HS.hubsOf(HS.withScan(bare,[p])).ids.map(([id,h])=>[id,h.address]),[['control',173],['expansion',2],['servoHub',4]]);
  assert.deepEqual(HS.hubsOf(HS.withScan(null,[p])).ids.map(([id])=>id),['control','expansion','servoHub'],'with no configuration the hubs still show');
  const none=RC.lynxModules('{"modules":[],"serialNumber":"(embedded)"}');assert.deepEqual(none,{serial:'(embedded)',modules:[]});
});

test('discovery asks until two answers agree: an empty or partial first answer is not the robot',async()=>{
  const m=(...a)=>JSON.stringify({serialNumber:'(embedded)',modules:a.map(x=>({moduleAddress:x,isParent:x===173,imuType:'NONE',revProductNumber:3215698}))}),answers=[m(),m(173),m(173,2),m(173,2)];let asked=0;
  const p=await RC.discover(async()=>answers[asked++],{wait:async()=>{}});assert.deepEqual(p.modules.map(x=>x.address),[173,2]);assert.equal(asked,4);
  const none=await RC.discover(async()=>m(),{tries:3,wait:async()=>{}});assert.deepEqual(none.modules,[],'a robot that keeps answering nothing ends the asking');
  const live=[{parentSerial:'(embedded)',moduleAddress:2,imuType:'none',revProductNumber:3215698},{parentSerial:'(embedded)',moduleAddress:4,imuType:'none',revProductNumber:1120341},{parentSerial:'other',moduleAddress:9}];
  const [merged]=RC.withLiveHubs([{serial:'(embedded)',modules:[{address:173,parent:true,imu:'BHI260'}]}],live);assert.deepEqual(merged.modules.map(x=>x.address),[173,2]);assert.deepEqual(merged.servoHubs,[{address:4}],'the robot’s open hubs count too');
});

test('a hub reports as connected, missing, or not yet configured',()=>{const k={scanned:[173,2],configured:[173,5]};
  assert.equal(HS.hubSeen(173,k).level,'ok');assert.match(HS.hubSeen(2,k).text,/not in the configuration/);assert.match(HS.hubSeen(5,k).text,/not found/);assert.equal(HS.hubSeen(2,{}),null);
});

test('a test is offered only when two hubs of one kind could be mistaken for each other',()=>{
  const needs=(e,s)=>HS.needsTest(W.setHubCount(W.setHubCount(null,'expansion',e),'servoHub',s));
  assert.deepEqual(needs(0,0),[]);assert.deepEqual(needs(1,0),[]);assert.deepEqual(needs(1,1),[],'one of each is known by its kind');assert.deepEqual(needs(2,1),['expansion']);assert.deepEqual(needs(1,2),['servoHub']);assert.deepEqual(needs(2,2),['expansion','servoHub']);
});

test('the test moves one output on each look-alike hub, a motor first, and a hub with nothing on it says so',()=>{
  let w=W.setHubCount(W.setHubCount(null,'expansion',2),'servoHub',1);
  const read=[{name:'s',kind:'servo',hub:'expansion',port:0},{name:'m',kind:'motor',hub:'expansion',port:3},{name:'x',kind:'motor',hub:'control',port:0},{name:'y',kind:'servo',hub:'servoHub',port:1}],steps=HS.testSteps(read,w);
  assert.deepEqual(steps.map(s=>s.hub),['expansion','expansion2'],'the only Servo Hub and the Control Hub need no test');
  assert.deepEqual(steps[0].device,{name:'m',kind:'motor',port:3,command:'M'});assert.equal(steps[1].device,null);
});

test('the name a team gives a hub is one number per hub, and survives an address change',()=>{
  let w=W.setHubCount(null,'expansion',2);w=W.setHubLabel(w,'expansion2',1);assert.equal(D.hubName('expansion2',w),'Expansion Hub 1');
  w=W.setHubLabel(w,'expansion',1);assert.equal(w.hubs.expansion.label,1);assert.equal(w.hubs.expansion2.label,undefined,'the number moves over');
  assert.equal(W.setHubAddress(w,'expansion',9).hubs.expansion2.label,1,'the hub keeps its name when renumbered by address');
  const html=W.hubsHtml({wiring:W.setHubCount(null,'expansion',2),rows:[]},{ids:'x-'});assert.match(html,/id="x-wire-more-expansion" data-wire-hub-step="expansion" data-step="1"/);assert.match(html,/id="x-wire-less-servoHub"[^>]* disabled/,'none to take away');assert.ok(html.includes('<output>2</output>'));
});

test('more than one Expansion Hub is a warning under R701, and works',()=>{
  const two=W.setHubCount(null,'expansion',2),one=W.setHubCount(null,'expansion',1),rule=w=>D.conflicts([],w).filter(p=>/R701/.test(p.text));
  assert.equal(rule(one).length,0);assert.deepEqual(rule(two).map(p=>p.level),['amber']);
  assert.equal(rule(W.setHubCount(W.setHubCount(null,'expansion',1),'servoHub',4)).length,0,'R701 says nothing of Servo Hubs');
});

test('reading a configuration finds every hub and where each device is',()=>{
  const cfg=RC.parse(XML),hubs=HS.hubsOf(cfg);
  assert.deepEqual(hubs.ids.map(([id,h])=>[id,h.address]),[['control',173],['expansion',2],['expansion2',5],['servoHub',3],['servoHub2',7]]);
  const read=HS.readout(cfg),by=n=>read.find(d=>d.name===n);
  assert.deepEqual([by('lift').hub,by('lift').port],['expansion2',1]);assert.deepEqual([by('wrist').hub,by('wrist').port],['servoHub2',2]);assert.deepEqual([by('swerve').hub,by('swerve').port],['servoHub',4]);
  const p=setup(),result=HS.plan(p,cfg);assert.deepEqual(result.notes,[],'no hub is left out');
  const q=HS.apply(p,result),w=q.robot.wiring;assert.deepEqual(D.hubIds(w),['control','expansion','expansion2','servoHub','servoHub2']);assert.equal(w.hubs.servoHub2.address,7);
  const html=W.readoutHtml(read,W.state(q));for(const t of ['Control Hub','Expansion Hub 2','Expansion Hub 5','Servo Hub 3','Servo Hub 7'])assert.match(html,new RegExp(`>${t}<`));
  assert.match(html,/data-read-row="wrist"/);
});

test('a configuration read with fewer hubs takes the others off Setup',()=>{
  const p=setup();p.robot=C.robot({...p.robot,wiring:W.setHubCount(W.setHubCount(p.robot.wiring,'expansion',3),'servoHub',2)},'ftc');
  const bare=RC.parse(`<?xml version='1.0'?><Robot type="FirstInspires-FTC"><LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173"><LynxModule name="Control Hub" port="173"><goBILDA5202SeriesMotor name="frontLeft" port="0" /></LynxModule></LynxUsbDevice></Robot>`);
  assert.deepEqual(D.hubIds(HS.apply(p,HS.plan(p,bare)).robot.wiring),['control']);
});

test('Setup’s hubs are written into the configuration Deck sends, in the SDK’s form',()=>{
  let w=W.setHubCount(null,'expansion',2);w=W.setHubCount(w,'servoHub',2);
  const rows=[{name:'a',label:'A',device:'motor',hub:'expansion2',port:1},{name:'b',label:'B',device:'servo',hub:'servoHub2',port:2},{name:'c',label:'C',device:'motor',hub:'expansion',port:0}];
  const {xml,problems}=RC.configurationFor(rows,w);assert.deepEqual(problems,[]);const cfg=RC.parse(xml);
  assert.equal(cfg.hubs.filter(h=>h.tag==='LynxModule').length,3);assert.equal(cfg.hubs.filter(h=>h.tag==='ServoHub').length,2);
  const on=n=>cfg.devices.find(d=>d.name===n).module;assert.equal(on('a').address,w.hubs.expansion2.address);assert.equal(on('c').address,w.hubs.expansion.address);assert.equal(on('b').address,Math.max(w.hubs.servoHub.address,w.hubs.servoHub2.address));assert.equal(on('b').servoHub,true);
});

test('Configure Robot can add a hub that is not plugged in yet, and rebuild keeps it',()=>{
  const {hubs}=RC.parse(XML),exp=RC.newHub(hubs,'LynxModule'),sh=RC.newHub(hubs,'ServoHub');
  assert.equal(exp.address,1);assert.equal(exp.name,'Expansion Hub 1');assert.equal(sh.address,1);
  const out=RC.parse(RC.rebuild(XML,RC.parse(XML).devices.filter(d=>d.module),[...hubs,exp]));assert.ok(out.hubs.some(h=>h.name==='Expansion Hub 1'&&h.address===1));
  assert.equal(RC.newHub(Array.from({length:10},(_,i)=>({address:i+1})),'ServoHub'),null,'addresses 1 to 10 only');
});

test('a Servo Power Module is Setup’s to know: a servo on a hub port goes through it, a Servo Hub servo never',()=>{
  let w=W.setSpmCount(null,2);assert.equal(w.hubs.spm,2);w=W.setPort(w,'kin.s','control:1','servo');w=W.setSpm(w,'kin.s',2);assert.equal(w.devices['kin.s'].spm,2);
  assert.equal(W.setSpmCount(w,1).devices['kin.s'].spm,undefined,'a module taken off lets its servos go');
  assert.match(D.explain({label:'Claw',role:'kin-servo',name:'claw',kind:'servo',family:'servo',hub:'control',port:1,spm:2},w),/through Servo Power Module 2 \(6 V\)/);
  const seven=Array.from({length:7},(_,i)=>({key:'kin.s'+i,name:'s'+i,label:'S'+i,family:'servo',role:'kin-servo',kind:'servo',spm:1}));assert.ok(D.conflicts(seven,W.setSpmCount(null,1)).some(p=>/6 ports/.test(p.text)));
});

test('− and + on the hub counts go through the same wiring change, and − on the last Expansion Hub means none',()=>{
  let click,wiring=W.setHubCount(null,'expansion',1);const host={addEventListener:(type,fn)=>{if(type==='click')click=fn;}},press=(kind,dir)=>click({target:{closest:q=>q==='[data-wire-hub-step]'?{dataset:{wireHubStep:kind,step:String(dir)}}:null}});
  W.bind(host,{project:()=>({robot:{wiring}}),apply:next=>{wiring=next;}});
  press('expansion',1);press('servoHub',1);press('servoHub',1);press('spm',1);assert.deepEqual(D.hubIds(wiring),['control','expansion','expansion2','servoHub','servoHub2']);assert.equal(wiring.hubs.spm,1);
  press('expansion',-1);press('expansion',-1);assert.equal(wiring.hubs.expansion,false,'taken away by the team, so not added back');
});

// ADB as the relay sees it: answers each command, and the relay child says "ready".
function fakeAdb({listening=false}={}){const calls=[],run=(_f,args,_o,done)=>{calls.push(args.join(' '));const cmd=args.join(' ');
    if(cmd==='devices')return done(null,'List of devices attached\nHUB1\tdevice\n','');if(/\/proc\/net\/tcp/.test(cmd))return done(null,listening?'  1: 0100007F:5195 00000000:0000 0A 0\n':'','');return done(null,'','');};
  const children=[],start=(_f,args)=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin=new EventEmitter();c.stdin.end=()=>{};c.exitCode=null;c.kill=()=>{c.exitCode=0;};c.args=args;children.push(c);setImmediate(()=>c.stdout.emit('data','ready\n'));return c;};
  return {calls,run,start,children};}

test('the USB relay runs from a temporary file as the shell user: no install, deleted once started, and stopped with the app',async t=>{
  const a=fakeAdb();t.after(()=>L.stopUsbRelay());
  await L.usbRelay('HUB1',{run:a.run,start:a.start});
  assert.equal(a.children.length,1);assert.match(a.children[0].args.join(' '),/shell CLASSPATH=\/data\/local\/tmp\/deck-usb-relay\.dex app_process \/system\/bin DeckUsbRelay/);
  assert.ok(a.calls.some(c=>/push .*\/data\/local\/tmp\/deck-usb-relay\.dex/.test(c)));await new Promise(r=>setImmediate(r));assert.ok(a.calls.some(c=>/rm -f \/data\/local\/tmp\/deck-usb-relay\.dex/.test(c)),'the file is removed at once');
  assert.ok(!a.calls.some(c=>/\b(install|setprop|su|remount|pm|am)\b/.test(c)),'nothing is installed or changed on the hub');
  await L.usbRelay('HUB1',{run:a.run,start:a.start});assert.equal(a.children.length,1,'one relay while it runs');
  L.stopUsbRelay();assert.equal(a.children[0].exitCode,0);
});

test('two asking for the relay at once share one start: a second could not bind the port, and would say the relay failed',async t=>{
  const a=fakeAdb();t.after(()=>L.stopUsbRelay());
  await Promise.all([L.usbRelay('HUB1',{run:a.run,start:a.start}),L.usbRelay('HUB1',{run:a.run,start:a.start})]);assert.equal(a.children.length,1);assert.equal((a.calls.filter(c=>/\bpush\b/.test(c))).length,1);
  await L.usbRelay('HUB1',{run:a.run,start:a.start});assert.equal(a.children.length,1,'and the one that is running stays');
  L.stopUsbRelay();await L.usbRelay('HUB1',{run:a.run,start:a.start});assert.equal(a.children.length,2,'stopped, it can start again');
});

test('a relay that fails to start does not leave the next caller waiting on it',async t=>{
  t.after(()=>L.stopUsbRelay());const a=fakeAdb(),bad=(f,args)=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin=new EventEmitter();c.stdin.end=()=>{};c.exitCode=null;c.kill=()=>{};setImmediate(()=>c.emit('exit',1));return c;};
  await assert.rejects(L.usbRelay('HUB1',{run:a.run,start:bad}),/could not run the USB relay/);await L.usbRelay('HUB1',{run:a.run,start:a.start});assert.equal(a.children.length,1);
});

test('a hub already answering on the port needs no relay',async()=>{const a=fakeAdb({listening:true});await L.usbRelay('HUB1',{run:a.run,start:a.start});assert.equal(a.children.length,0);assert.ok(!a.calls.some(c=>/push/.test(c)));});

test('the Control Hub Portal follows what is plugged in: a Servo Hub is found and named, and a failed product number cannot make it an Expansion Hub',()=>{
  const hubs=[{name:'Control Hub',address:173,tag:'LynxModule',portal:'(embedded)',parent:true},{name:'Expansion Hub 2',address:2,tag:'LynxModule',portal:'(embedded)',parent:false}];
  // As a real Control Hub reports them (rcInfo.json, FTC SDK 12.0): the scan read no product number for the Servo Hub.
  const live=[{moduleAddress:173,name:'Control Hub',parentSerial:'(embedded)',revProductNumber:3215698,imuType:'BHI260AP'},{moduleAddress:2,name:'Expansion Hub 2',parentSerial:'(embedded)',revProductNumber:3215698,imuType:'none'},{moduleAddress:3,name:'Servo Hub 3',parentSerial:'(embedded)',revProductNumber:1120341,imuType:'none'}];
  const scan=RC.lynxModules(JSON.stringify({serialNumber:'(embedded)',modules:[{moduleAddress:173,isParent:true,imuType:'UNKNOWN',revProductNumber:3215698},{moduleAddress:2,isParent:false,imuType:'NONE',revProductNumber:3215698},{moduleAddress:3,isParent:false,imuType:'NONE',revProductNumber:0}]}));
  assert.deepEqual(scan.modules.map(m=>m.address),[173,2,3],'alone, the scan takes it for a hub');
  const [portal]=RC.withLiveHubs([scan],live);assert.deepEqual(portal.modules.map(m=>m.address),[173,2]);assert.deepEqual(portal.servoHubs,[{address:3}]);
  const found=RC.matchHubs(hubs,[portal]);assert.deepEqual(found.added,['Servo Hub 3']);assert.equal(found.hubs.find(h=>h.address===3).tag,'ServoHub');assert.ok(found.connected.has(RC.hubKey('(embedded)',3)));
  // Written down as the wrong kind: corrected while empty, left for the team when devices are on it.
  const wrong=[...hubs,{name:'Expansion Hub 3',address:3,tag:'LynxModule',portal:'(embedded)',parent:false}];
  const fixed=RC.matchHubs(wrong,[portal]);assert.deepEqual(fixed.fixed,['Servo Hub 3']);assert.equal(fixed.hubs.find(h=>h.address===3).tag,'ServoHub');
  const kept=RC.matchHubs(wrong,[portal],[{name:'m',module:{portal:'(embedded)',address:3}}]);assert.deepEqual(kept.wrong,[{name:'Expansion Hub 3',is:'Servo Hub'}]);assert.equal(kept.hubs.find(h=>h.address===3).tag,'LynxModule');
  // A hub written in before it is plugged in stays, and is not connected. No scan: nothing changes.
  const later=RC.matchHubs([...hubs,{name:'Servo Hub 5',address:5,tag:'ServoHub',portal:'(embedded)',parent:false}],[portal]);assert.ok(!later.connected.has(RC.hubKey('(embedded)',5)));assert.ok(later.hubs.some(h=>h.address===5));
  assert.deepEqual(RC.matchHubs(hubs,null).hubs,hubs);
});

test('Setup shows what Scan found and offers nothing to change: counts, hubs, other USB devices',()=>{
  const st={wiring:W.setHubCount(W.setHubCount(null,'expansion',1),'servoHub',1),rows:[]};
  const before=W.scanHtml(st,null);assert.ok(before.includes('press Scan'));assert.ok(before.includes('<output>–</output>'));assert.doesNotMatch(before,/<select|<button|<input/);
  const after=W.scanHtml(st,{expansion:1,servoHub:0,others:[{serial:'UVC:046D:0825',type:'WEBCAM'}]},{seen:id=>id==='servoHub'?{level:'bad',text:'In the configuration, not found'}:null});
  assert.doesNotMatch(after,/<select|<button|<input/,'read-only');assert.ok(after.includes('Webcam'));assert.ok(after.includes('In the configuration, not found'));
  assert.deepEqual(RC.otherUsb('{"map":[{"key":"(embedded)","value":"LYNX_USB_DEVICE"},{"key":"UVC:046D:0825","value":"WEBCAM"}]}'),[{serial:'UVC:046D:0825',type:'WEBCAM'}]);
  // A hub the robot has open but that does not answer is not counted; a wrong product number is still corrected.
  const live=[{moduleAddress:5,parentSerial:'(embedded)',revProductNumber:1120341},{moduleAddress:3,parentSerial:'(embedded)',revProductNumber:1120341}],scan=RC.lynxModules('{"serialNumber":"(embedded)","modules":[{"moduleAddress":173,"isParent":true,"imuType":"NONE"},{"moduleAddress":3,"isParent":false,"imuType":"NONE"}]}');
  const [p]=RC.withLiveHubs([scan],live,{add:false});assert.deepEqual(p.modules.map(m=>m.address),[173]);assert.deepEqual(p.servoHubs,[{address:3}]);
});

test('Configure edits the configuration itself: every port of every hub, legal parts only, and saves as the SDK writes it',()=>{
  const CE=require('../ui/sim-config-editor.js');globalThis.DeckRobotConfig=RC;
  const xml=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><Robot type="FirstInspires-FTC"><LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173"><LynxModule name="Expansion Hub 2" port="2"></LynxModule><LynxModule name="Control Hub" port="173"><goBILDA5202SeriesMotor name="fl" port="0" /></LynxModule><ServoHub name="Servo Hub 3" port="3" /></LynxUsbDevice></Robot>`;
  const e=CE.load('lunala',xml);assert.deepEqual(e.hubs.map(h=>h.name),['Control Hub','Expansion Hub 2','Servo Hub 3']);assert.equal(e.dirty,false);
  globalThis.DeckDeviceArt=require('../ui/ftc/device-art.js');
  // The hub list stays on the side; the hub picked shows its families, as a Driver Hub does.
  assert.match(CE.hubsHtml(e),/Control Hub · address 173 · 1 device/);assert.match(CE.hubsHtml(e),/Servo Hub · address 3 · nothing set up yet/);
  const families=CE.familiesHtml(e);for(const word of ['Motors','Servos','Digital Devices','Analog Input Devices','I2C Bus 3'])assert.ok(families.includes(word),word);
  e.hub=2;assert.doesNotMatch(CE.familiesHtml(e),/I2C|Motors/,'a Servo Hub has only servos');assert.deepEqual(CE.trail({...e,family:'servo'}),['lunala','Control Hub Portal','Servo Hub 3','Servos']);e.hub=0;
  for(const [f,n] of [['motor',4],['servo',6],['analog',4],['digital',8]]){e.family=f;assert.equal((CE.portsHtml(e).match(/data-ce-type=/g)||[]).length,n,f);}
  e.family='motor';assert.match(CE.portsHtml(e),/Encoder cable plugged in/);
  // A Servo Hub's servo ports offer what a Driver Hub offers.
  assert.deepEqual(CE.menuTypes('servo').map(([t])=>t),['Servo','ContinuousRotationServo','RevBlinkinLedDriver','RevSPARKMini']);
  CE.setType(e,e.hubs[2],'servo',1,'Servo');assert.throws(()=>CE.xmlOf(e),/Name every device: Servo Hub 3 servo port 1/);e.devices.find(d=>d.tag==='Servo').name='claw';
  CE.addI2c(e,e.hubs[0],1);e.devices.find(d=>d.family==='i2c').name='color';
  const saved=RC.parse(CE.xmlOf(e));assert.equal(saved.devices.find(d=>d.name==='claw').module.servoHub,true);assert.equal(saved.devices.find(d=>d.name==='color').bus,1);assert.equal(saved.hubs.length,3);
  CE.setType(e,e.hubs[0],'motor',0,'');assert.ok(!RC.parse(CE.xmlOf(e)).devices.some(d=>d.name==='fl'));
  // A hub the last Scan found is added, not saved until asked.
  const f=CE.load('lunala',xml,[{serial:'(embedded)',modules:[{address:173,parent:true},{address:2,parent:false},{address:4,parent:false}],servoHubs:[{address:3}]}]);assert.ok(f.hubs.some(h=>h.address===4));assert.equal(f.dirty,true);
});

test('in Simulate a device takes a port from the configuration, by port and not by name, and asks for Setup without one',()=>{
  const st={wiring:W.setHubCount(null,'expansion',1),rows:[],problems:[]},row={key:'robot.frontLeft',label:'Front left drive motor',name:'front_left',family:'motor',role:'drive',kind:'dcmotor',model:'gobilda-5203-435',planned:true,wired:false};
  const none=W.deviceHtml(row,st,{model:false,noPort:true,assign:null});assert.ok(none.includes('Set in Setup &amp; Calibrate'));assert.doesNotMatch(none,/Deck pick/);
  const read=[{name:'leftRear',kind:'motor',tag:'goBILDA5202SeriesMotor',hub:'control',port:0},{name:'claw',kind:'servo',tag:'Servo',hub:'control',port:0}];
  const some=W.deviceHtml(row,st,{model:false,noPort:true,assign:read}),select=some.split('data-wire-assign')[1].split('</select>')[0];assert.ok(select.includes('value="control:0|leftRear"'));assert.ok(select.includes('Control Hub motor port 0'));assert.doesNotMatch(select,/>[^<]*leftRear/,'the name is not shown');assert.doesNotMatch(select,/claw/,'motors only');
});
