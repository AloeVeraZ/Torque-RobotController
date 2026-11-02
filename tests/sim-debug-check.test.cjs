'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),C=require('../ui/sim-debug-check.js'),RC=require('../ui/ftc/robot-config.js'),L=require('../src/robot-link.cjs'),HS=require('../ui/sim-hub-setup.js');

test('Torque Debug is named by when it went on, on a 24-hour clock, and has no package or nested class',()=>{
  assert.equal(L.debugName(new Date(2026,9,30,18,11)),'TorqueDebug-18.11-10-30-26');assert.equal(L.debugName(new Date(2026,0,2,6,5)),'TorqueDebug-06.05-01-02-26');
  const src=L.debugSource('TorqueDebug-18.11-10-30-26');assert.ok(src.includes('@TeleOp(name = "TorqueDebug-18.11-10-30-26"'));assert.ok(L.isDebugOpMode({name:'TorqueDebug-18.11-10-30-26'}));assert.ok(!L.isDebugOpMode({name:'Deck Debug'}));
  const code=fs.readFileSync(path.join(__dirname,'../src/onbot/TorqueDebug.java'),'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g,'');
  assert.doesNotMatch(code,/^package /m,'Sinister crashes the Robot Controller on an OnBot Java class in a package');
  assert.deepEqual([...code.matchAll(/^[ \t]+(?:(?:public|private|protected|static|final|abstract)\s+)*(?:class|interface|enum)\s+\w+/gm)],[],'nor a nested class');
  assert.doesNotMatch(code,/new\s+\w+(?:<[^>]*>)?\([^)]*\)\s*\{/,'nor an anonymous one');
});

test('parameters: motors 20 to 40% unless more is allowed, servo angles at least 20° apart',()=>{
  assert.deepEqual(C.motorChoices(false),[20,25,30,35,40]);assert.ok(C.motorChoices(true).includes(100));
  assert.equal(C.sanitize({motor:60}).motor,20,'above 40 needs the box');assert.equal(C.sanitize({motor:60,over:true}).motor,60);assert.equal(C.sanitize({motor:10}).motor,20);
  assert.equal(C.problem(C.sanitize({servoA:100,servoB:119})),C.problem({servoA:0,servoB:0}));assert.equal(C.problem(C.sanitize({servoA:100,servoB:120})),'');assert.equal(C.problem(C.sanitize({servoA:120,servoB:100})),'');
  assert.equal(C.sanitize({servoA:0,servoB:270}).servoA,0);assert.equal(C.position(135),.5);assert.equal(C.direction({servoA:90,servoB:45}),-1);
});

test('digital: it changes and comes back; one already held lets go, is held and lets go',()=>{
  let s=C.digitalStart(1);assert.match(C.digitalPrompt(s),/Press/);s=C.digitalStep(s,1);assert.equal(s.seen,0);s=C.digitalStep(s,0);assert.match(C.digitalPrompt(s),/Let go/);assert.ok(!s.done);s=C.digitalStep(s,1);assert.ok(s.done);
  let h=C.digitalStart(0,true);assert.match(C.digitalPrompt(h),/Let go/);h=C.digitalStep(h,1);assert.match(C.digitalPrompt(h),/again/);assert.ok(!h.done);h=C.digitalStep(h,0);assert.match(C.digitalPrompt(h),/Let go/);assert.ok(!h.done);h=C.digitalStep(h,1);assert.ok(h.done);
});

test('analog: it reads, is rotated, is told to stop and stays on its value',()=>{
  let s=C.analogStart();s=C.analogStep(s,NaN,0);assert.equal(s.stage,'read');s=C.analogStep(s,1,0);assert.equal(s.stage,'turn');assert.match(C.analogPrompt(s),/Rotate/);
  s=C.analogStep(s,1.1,100);assert.equal(s.stage,'turn');s=C.analogStep(s,1.3,200);assert.equal(s.stage,'stop');assert.match(C.analogPrompt(s),/Stop/);
  s=C.analogStep(s,1.8,1000);assert.equal(s.stage,'stop','3 s to let go, moving or not');s=C.analogStep(s,1.8,3199);assert.equal(s.stage,'stop');s=C.analogStep(s,1.8,3200);assert.equal(s.stage,'done');assert.match(C.analogPrompt(s),/1\.80 V/);
});

test('discovery adds answers up: a full answer then a bad one keeps every hub, and a hub the robot has open gets more asks',async()=>{
  const m=(...a)=>JSON.stringify({serialNumber:'(embedded)',modules:a.map(x=>({moduleAddress:x,isParent:x===173,imuType:'NONE',revProductNumber:3215698}))}),seq=[m(173,2),m(),m(173)];let n=0,firsts=[];
  const p=await RC.discover(async()=>seq[n++]??m(173,2),{onAnswer:x=>firsts.push(x.modules.length)});assert.deepEqual(p.modules.map(x=>x.address),[173,2]);assert.equal(n,2,'the second answer added nothing');assert.equal(firsts[0],2,'the first answer shows at once');
  let k=0;const gone=await RC.discover(async()=>{k++;return m(173);},{expect:[173,2]});assert.deepEqual(gone.modules.map(x=>x.address),[173]);assert.equal(k,4,'an open hub that never answers ends the asking');
  const servo=await RC.discover((()=>{const a=[JSON.stringify({serialNumber:'(embedded)',modules:[{moduleAddress:3,isParent:false,imuType:'NONE'}]}),JSON.stringify({serialNumber:'(embedded)',modules:[{moduleAddress:3,isParent:false,imuType:'NONE',revProductNumber:1120341}]})];let i=0;return async()=>a[Math.min(i++,1)];})());assert.deepEqual(servo.modules,[]);assert.deepEqual(servo.servoHubs,[{address:3}]);
  assert.deepEqual(RC.openHubs([{parentSerial:'(embedded)',moduleAddress:173,imuType:'BHI260AP',revProductNumber:3215698},{parentSerial:'(embedded)',moduleAddress:2,imuType:'none',revProductNumber:3215698}]).map(x=>x.modules.map(y=>y.address)),[[173,2]]);
});

test('removing a hub Scan did not find keeps everything else; its devices go with it',()=>{
  const xml=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<Robot type="FirstInspires-FTC">\n    <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">\n        <LynxModule name="Arm Hub" port="2">\n            <goBILDA5202SeriesMotor name="arm" port="0" />\n        </LynxModule>\n        <LynxModule name="Control Hub" port="173">\n            <goBILDA5202SeriesMotor name="left" port="0" />\n        </LynxModule>\n        <ServoHub name="Servo Hub 3" port="3">\n            <Servo name="claw" port="1" />\n        </ServoHub>\n    </LynxUsbDevice>\n</Robot>\n`;
  const out=RC.removeHub(xml,{address:3,tag:'ServoHub'}),after=RC.parse(out.xml);assert.deepEqual(out.devices.map(d=>d.name),['claw']);assert.deepEqual(after.devices.map(d=>d.name).sort(),['arm','left']);assert.deepEqual(after.hubs.map(h=>h.address).sort(),[173,2].sort());assert.ok(out.xml.includes('name="Arm Hub"'),'a hub keeps its own name');
  assert.equal(RC.removeHub(xml,{address:9}).xml,xml,'a hub it does not have changes nothing');
  const seen=HS.hubSeen(3,{scanned:[173,2],configured:[173,2,3]});assert.equal(seen.missing,true);assert.equal(HS.hubSeen(3,{scanned:[173],configured:[3],checking:true}).missing,undefined);assert.equal(HS.hubSeen(173,{scanned:[173],configured:[173]}).missing,undefined);
});

test('a Robot Controller that crashes on Torque Debug gets it taken off and is started again; one that stays up is left alone',async()=>{
  const fake=(table)=>{const calls=[];return {calls,run:(f,args,o,done)=>{const a=args.join(' ');calls.push(a);if(/^devices/.test(a))return done(null,'List of devices attached\nABC\tdevice\n','');if(/cat \/proc\/net\/udp/.test(a))return done(null,table(calls),'');return done(null,'','');}};};
  const on='  1: 012BA8C0:5194 00000000:0000 07',ok=fake(()=>on);await L.usbDebugGuard({run:ok.run,watch:30,pause:5});assert.ok(!ok.calls.some(c=>/rm /.test(c)));
  let removed=false;const bad=fake(calls=>{removed=calls.some(c=>/rm -f/.test(c));return calls.some(c=>/am start/.test(c))?on:'';});await assert.rejects(L.usbDebugGuard({run:bad.run,watch:30000,pause:5}),/crashed when it loaded Torque Debug/);assert.ok(removed);assert.ok(bad.calls.some(c=>/rm -f \/sdcard\/FIRST\/java\/src\/TorqueDebug\.java/.test(c)));assert.ok(bad.calls.some(c=>/am start/.test(c)));
});

test('with nobody pressing anything, the Robot Controller is never started: a scan answers at once, a check only waits for it',async()=>{
  const on='  1: 012BA8C0:5194 00000000:0000 07',fake=table=>{const calls=[];return {calls,run:(f,args,o,done)=>{const a=args.join(' ');calls.push(a);if(/^devices/.test(a))return done(null,'List of devices attached\nABC\tdevice\n','');if(/cat \/proc\/net\/udp/.test(a))return done(null,table(calls),'');return done(null,'','');}};};
  const down=fake(()=>''),began=Date.now();await assert.rejects(L.usbController('ABC',{run:down.run,noStart:true,wait:0}),/app on this Control Hub is not answering/);assert.ok(Date.now()-began<1000,'at once');assert.ok(!down.calls.some(c=>/am start/.test(c)),'nothing started');assert.equal(down.calls.length,1,'one look');
  const later=fake(calls=>calls.length>=3?on:'');assert.equal(await L.usbController('ABC',{run:later.run,noStart:true,wait:2000,pause:5}),true,'it can wait for the app to come up by itself');assert.ok(!later.calls.some(c=>/am start/.test(c)));
  const up=fake(()=>on);assert.equal(await L.usbController('ABC',{run:up.run,noStart:true,wait:0}),false,'already listening: nothing to do');assert.equal(await L.usbControllerUp('ABC',{run:up.run}),true);assert.equal(await L.usbControllerUp('ABC',{run:down.run}),false);
  const pressed=fake(calls=>calls.some(c=>/am start/.test(c))?on:'');assert.equal(await L.usbController('ABC',{run:pressed.run,pause:5}),true);assert.ok(pressed.calls.some(c=>/am start/.test(c)),'a press still starts it');
  await assert.rejects(L.usbLink({run:fake(()=>'').run,noStart:true,wait:0}),/not answering/,'the whole link, as a scan asks for it');
});

test('the Robot Controller counts as listening on its own address, not the relay’s loopback one',()=>{
  const on='  157: 0000000000000000FFFF0000012BA8C0:5194 00000000000000000000000000000000:0000 07 00000000:00000000',relay='  12: 0100007F:5194 00000000:0000 07',relay6='  12: 0000000000000000FFFF00000100007F:5194 000:0000 07';
  assert.ok(L.controllerListening(on));assert.ok(!L.controllerListening(relay));assert.ok(!L.controllerListening(relay6));assert.ok(!L.controllerListening(''));assert.ok(L.controllerListening(relay+'\n'+on));
});

test('Setup shows an × only on a hub Scan did not find, and Configure shows its configuration, with the others to pick, beside Save',()=>{
  const W=require('../ui/sim-wiring.js'),st={wiring:W.setHubCount(W.setHubCount(null,'expansion',1),'servoHub',1),rows:[]},seen=id=>id==='servoHub'?{level:'bad',text:'In the configuration, not found',missing:true}:{level:'ok',text:'Connected'};
  const html=W.scanHtml(st,{expansion:1,servoHub:0,others:[]},{seen});assert.equal((html.match(/data-hub-remove=/g)||[]).length,1);assert.ok(html.includes('data-hub-remove="servoHub"'));assert.ok(W.scanHtml(st,{expansion:1,servoHub:0,others:[]},{seen,busy:true}).includes(' disabled>×'));
  globalThis.document??={addEventListener(){},activeElement:null};const E=require('../ui/sim-config-editor.js'),box={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}},xml=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<Robot type="FirstInspires-FTC">\n    <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">\n        <LynxModule name="Control Hub" port="173" />\n    </LynxUsbDevice>\n</Robot>\n`;
  const ed=E.create({box,api:{save:async()=>{},names:()=>['robot','lunala']}});ed.open('lunala',xml,null);const bar=box.innerHTML.slice(0,box.innerHTML.indexOf('data-ce-save'));
  assert.match(bar,/<h3>[^<]*<\/h3><label class="ce-config">/);assert.ok(bar.indexOf('value="lunala" selected')>0);assert.ok(bar.indexOf('value="lunala"')<bar.indexOf('value="robot"'),'in order, under lunala');
});

test('a webcam Scan found goes into a configuration under <Robot> with its serial number, and survives saving',()=>{
  const R=RC,E=require('../ui/sim-config-editor.js'),xml=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<Robot type="FirstInspires-FTC">\n    <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">\n        <LynxModule name="Control Hub" port="173">\n            <goBILDA5202SeriesMotor name="left" port="0" />\n        </LynxModule>\n    </LynxUsbDevice>\n</Robot>\n`;
  const e=E.load('a',xml,null);assert.deepEqual(e.webcams,[]);e.webcams.push({name:'Webcam 1',serial:'UVC:046D:0825'});const out=E.xmlOf(e);assert.deepEqual(R.webcamsOf(out),[{name:'Webcam 1',serial:'UVC:046D:0825'}]);assert.ok(R.parse(out).devices.some(d=>d.name==='left'));
  const again=E.load('a',out,null);assert.equal(again.webcams.length,1);again.webcams=[];assert.deepEqual(R.webcamsOf(E.xmlOf(again)),[]);assert.deepEqual(R.webcamsOf(R.withWebcams(R.withWebcams(xml,[{name:'A',serial:'1'}]),[{name:'B',serial:'2'}])),[{name:'B',serial:'2'}]);
  const hub=RC.removeHub(out,{address:173}).xml;assert.equal(R.webcamsOf(hub).length,1,'removing a hub keeps the webcam');
});
