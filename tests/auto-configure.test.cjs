'use strict';
// Setup's two columns, Configure's Auto-configure, and Debug's USB devices, from what they are given. tests/auto-configure-app.cjs runs the same flow in the real app against the virtual Control Hub.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
globalThis.document??={addEventListener(){},activeElement:null};
const W=require('../ui/sim-wiring.js'),E=require('../ui/sim-config-editor.js'),R=require('../ui/ftc/robot-config.js'),K=require('../ui/ftc/usb-kinds.js'),U=require('../ui/sim-usb-devices.js'),{parseUsb}=require('../src/hub-usb.cjs');
// The real answer of FTC-zWL4, with a generic webcam in the blue port, and what else may be plugged in.
const INSIDE=`3-1|05e3|0608|09|8538|480|3|2||USB2.0 Hub||100mA|e0|4|09/00/00/hub,\n3-1.1|0bda|c820|ef|0200|480|3|3|Realtek|802.11ac NIC|123456|500mA|a0|0|e0/01/01/rtk_btusb,ff/ff/ff/rtl8821cu,\nusb1|1d6b|0002|09|0310|480|1|1|Linux 3.10.245 xhci-hcd|xHCI Host Controller|xhci-hcd.0.auto|0mA|e0|1|`;
const CAM=`1-1|a108|2240|ef|0090|480|1|2|HHYL|UVC Camera|Ucamera001|200mA|c0|0|0e/01/00/uvcvideo,0e/02/00/uvcvideo,03/00/00/usbhid,01/01/00/snd-usb-audio,01/02/00/snd-usb-audio,`,C270=`1-1.3|046d|0825|ef|0010|480|1|6|Logitech|C270|ABC270|500mA|80|0|0e/01/00/uvcvideo,0e/02/00/uvcvideo,`,HUSKY=`3-1.4|10c4|ea60|00|0100|12|3|5|Silicon Labs|CP2102||100mA|80|0|ff/00/00/,`;
const usb=(lines,context={},others=[])=>Object.assign([...others],{devices:K.classifyAll(parseUsb([INSIDE,...lines].join('\n')),context)});
const XML=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<Robot type="FirstInspires-FTC">\n    <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">\n        <LynxModule name="Control Hub" port="173">\n            <goBILDA5202SeriesMotor name="left" port="0" />\n        </LynxModule>\n    </LynxUsbDevice>\n</Robot>\n`;
const CABLE=[{serial:'(embedded)',modules:[{address:173,parent:true,imu:'BHI260'},{address:2,parent:false,imu:'NONE'}],servoHubs:[{address:3}]}],ALONE=[{serial:'(embedded)',modules:[{address:173,parent:true,imu:'BHI260'}]}];
const col=(html,name)=>{const a=html.indexOf(`data-scan-col="${name}"`);assert.ok(a>=0,name);const b=html.indexOf('data-scan-col="',a+20);return html.slice(a,b<0?undefined:b);};
const hubsSt=()=>({wiring:W.setHubCount(W.setHubCount(null,'expansion',1),'servoHub',1),rows:[]});
const seen=()=>({level:'ok',text:'Connected'});

test('Setup: how many of each, then the Control Hub, what is on the RS485 cable and what is on USB, with nothing to press for a hub',()=>{
  const html=W.scanHtml(hubsSt(),{expansion:1,servoHub:1,others:[]},{seen,rows:usb([CAM]).devices,conn:{how:'USB-C',serial:'24677c4269e7e709'},configured:[]}),left=col(html,'hubs'),right=col(html,'usb');
  assert.ok(left.indexOf('data-hub-row="control"')<left.indexOf('data-hub-row="expansion"'));assert.ok(html.indexOf('data-scan-col="hubs"')<html.indexOf('data-scan-col="usb"'));assert.match(left,/Over USB-C · Serial 24677c4269e7e709/);assert.match(left,/data-hub-row="expansion"[\s\S]*Address 2/);assert.match(left,/data-hub-row="servoHub"[\s\S]*Address 3/);assert.doesNotMatch(left,/<button/,'scanning adds them');
  assert.match(right,/Webcam \(needs its lens measured\)/);assert.match(right,/Blue USB 3\.0 port · Ucamera001/);assert.match(right,/Not in the configuration/);assert.doesNotMatch(html,/802\.11ac|USB2\.0 Hub|xHCI/,'the hub’s own parts stay hidden');assert.deepEqual([...html.matchAll(/<b>([^<]*)<\/b><p class="hint">[^<]*<\/p><div class="sim-wire-stepper"><output>([^<]*)</g)].map(m=>`${m[1]} ${m[2]}`),['Control Hub 1','Expansion Hubs 1','Servo Hubs 1','USB devices 1']);
});
test('Setup: what the configuration has, none found, and over Wi-Fi',()=>{
  const st={wiring:W.setHubCount(null,'expansion',0),rows:[]},html=W.scanHtml(st,{expansion:0,servoHub:0,others:[]},{rows:usb([CAM]).devices,conn:{how:'USB-C'},configured:[{name:'Webcam',tag:'Webcam',serial:'Ucamera001'}]});
  assert.match(col(html,'usb'),/Configured as “Webcam”/);assert.match(html,/Expansion Hubs<\/b><p class="hint">[^<]*<\/p><div class="sim-wire-stepper"><output>0</);assert.doesNotMatch(col(html,'hubs'),/data-hub-row="expansion"/);
  assert.match(W.scanHtml(st,null,{conn:{how:'USB-C'},checking:true}),/Looking on the RS485 cable/);
  const wifi=W.scanHtml(st,{expansion:0,servoHub:0,others:[{serial:'Ucamera001',type:'WEBCAM'}]},{conn:{how:'Wi-Fi'}});assert.match(col(wifi,'usb'),/Webcam/);assert.match(col(wifi,'usb'),/Over Wi-Fi this is only what the robot’s own Scan can see/);assert.doesNotMatch(wifi,/Blue USB/);
  assert.match(W.scanHtml(st,{expansion:0,servoHub:0,others:[]},{rows:[],conn:{how:'USB-C'}}),/USB devices<\/b><p class="hint">[^<]*<\/p><div class="sim-wire-stepper"><output>0</);
  assert.match(W.scanHtml(st,null,{auto:{text:'1 new USB device'},conn:{how:'USB-C'}}),/data-auto-offer><span>1 new USB device<\/span><button[^>]*data-auto-configure/);
  const usbHub=W.scanHtml(hubsSt(),{expansion:1,servoHub:1,others:[]},{seen,conn:{how:'USB-C'},onUsb:id=>id==='expansion'});assert.match(usbHub,/Address 2 · on USB, not the RS485 cable/);
});
test('Setup tells the truth about a HuskyLens, and sends it to I2C',()=>{
  const html=W.scanHtml({wiring:W.setHubCount(null,'expansion',0),rows:[]},{others:[]},{rows:usb([HUSKY]).devices,conn:{how:'USB-C'}});assert.match(html,/This may be a HuskyLens: it works on an I2C port, not USB\./);assert.match(html,/data-usb-i2c="HuskyLens"/);assert.doesNotMatch(html,/Not in the configuration/,'it can never be in one from USB');
  const axon=W.scanHtml({wiring:W.setHubCount(null,'expansion',0),rows:[]},{others:[]},{rows:usb(['1-1|0471|13aa|00|0100|12|1|5|Axon|Programmer||100mA|80|0|03/00/00/']).devices,conn:{how:'USB-C'}});assert.match(axon,/it goes in the computer, not the robot/);assert.match(axon,/data-usb-axon/);
});

test('Auto-configure adds every camera plugged in, as Webcam then Webcam 2, and the hubs on the cable, and writes them as the SDK does',()=>{
  const list=usb([CAM,C270],{},[{serial:'Ucamera001',type:'WEBCAM'},{serial:'ABC270',type:'WEBCAM'}]),e=E.load('robot',XML,CABLE),plan=E.autoPlan(e,list);
  assert.equal(plan.writes,true);assert.deepEqual(plan.webcams.map(r=>r.add),['Ucamera001','ABC270']);assert.deepEqual(plan.hubs.map(h=>h.name),['Expansion Hub 2','Servo Hub 3']);assert.equal(E.offerText(plan),'2 new USB devices and 2 new hubs');
  assert.deepEqual(E.autoApply(e,list),{cameras:['Webcam','Webcam 2'],hubs:['Expansion Hub 2','Servo Hub 3']});const out=E.xmlOf(e);
  assert.ok(out.includes('<Webcam name="Webcam" serialNumber="Ucamera001" />'),out);assert.ok(out.includes('<Webcam name="Webcam 2" serialNumber="ABC270" />'));assert.ok(out.includes('<LynxModule name="Expansion Hub 2" port="2" />'),out);assert.ok(out.includes('<ServoHub name="Servo Hub 3" port="3" />'),out);assert.ok(out.includes('<goBILDA5202SeriesMotor name="left" port="0" />'),'the rest stays');
  assert.equal(R.parse(out).devices.filter(d=>d.tag==='Webcam').length,2);assert.equal(E.autoPlan(E.load('robot',out,CABLE),list).writes,false,'once written there is nothing left to do');
});
test('Auto-configure honours the names a team already has',()=>{
  const taken=E.load('robot',R.withWebcams(XML,[{name:'front cam',serial:'Ucamera001'}]),null),list=usb([CAM,C270],{},[{serial:'Ucamera001',type:'WEBCAM'},{serial:'ABC270',type:'WEBCAM'}]);assert.deepEqual(E.autoApply(taken,list).cameras,['Webcam']);
  const web=E.load('robot',R.withWebcams(XML,[{name:'Webcam',serial:'Ucamera001'}]),null);assert.deepEqual(E.autoApply(web,list).cameras,['Webcam 2']);
});
test('Auto-configure with everything already there writes nothing, and says which cameras are ready',()=>{
  const list=usb([CAM],{},[{serial:'Ucamera001',type:'WEBCAM'}]),e=E.load('robot',R.withWebcams(XML,[{name:'Webcam',serial:'Ucamera001'}]),ALONE),plan=E.autoPlan(e,list);
  assert.equal(plan.writes,false);assert.deepEqual(plan.ready,['Webcam']);assert.equal(plan.readyKey,'Ucamera001');assert.equal(e.dirty,false);
  // A camera in the file and not plugged in is not ready; a hub in the file the scan did not find is not removed.
  assert.deepEqual(E.autoPlan(E.load('robot',R.withWebcams(XML,[{name:'Webcam',serial:'gone'}]),ALONE),usb([],{},[])).ready,[]);
  const absent=XML.replace('<LynxModule name="Control Hub" port="173">','<LynxModule name="Expansion Hub 2" port="2" />\n        <LynxModule name="Control Hub" port="173">');assert.equal(E.autoPlan(E.load('robot',absent,ALONE),usb([])).writes,false,'nothing is taken out by itself');
});
test('a Limelight that answers goes in, one that moved is corrected, and one that does not answer stays out',()=>{
  const NET=`1-1|1d6b|0104|00|0100|480|1|5|Some|Gadget||100mA|80|0|02/06/00/cdc_ether/eth0,0a/00/00/cdc_ether,`,LIME={iface:'eth0',hubAddress:'172.29.0.23',address:'172.29.0.1',scanKey:'EthernetOverUsb:eth0:172.29.0.23',status:{name:'limelight'}},SCAN=[{serial:LIME.scanKey,type:'ETHERNET_DEVICE'}],list=usb([NET],{limelight:LIME,scan:{portals:[],others:SCAN}},SCAN);
  const e=E.load('robot',XML,null);assert.ok(E.autoPlan(e,list).limelight);assert.deepEqual(E.autoApply(e,list).cameras,['limelight']);assert.match(E.xmlOf(e),/<EthernetDevice name="limelight" serialNumber="EthernetOverUsb:eth0:172\.29\.0\.23" port="-1" ipAddress="172\.29\.0\.1" \/>/);
  const old=E.load('robot',R.withLimelights(XML,[{name:'limelight',serial:'EthernetOverUsb:eth0:172.29.0.9',port:-1,ipAddress:'172.29.0.1'}]),null);assert.equal(E.autoPlan(old,list).fixLime,0);E.autoApply(old,list);assert.equal(old.limelights[0].serial,LIME.scanKey);
  const not=usb([NET],{limelight:{status:null},scan:{portals:[],others:SCAN}},SCAN),n=E.load('robot',XML,null),plan=E.autoPlan(n,not);assert.equal(plan.writes,false);assert.equal(plan.limelight,null);assert.equal(plan.left.length,1);
});
test('what has no way in from USB is named, with the rule, and not added',()=>{
  const list=usb([HUSKY]),e=E.load('robot',XML,null),plan=E.autoPlan(e,list);assert.equal(plan.writes,false);assert.equal(plan.left.length,1);assert.match(plan.left[0].warn,/This may be a HuskyLens: it works on an I2C port, not USB\./);
  const html=E.usbHtml(e,list);assert.match(html,/data-warn/);assert.match(html,/USB 2\.0 port · plugged in/);assert.match(html,/data-usb-i2c="HuskyLens"/);assert.doesNotMatch(html,/data-ce-usb-add/);assert.doesNotMatch(E.xmlOf(e),/HuskyLens/);
  const arduino=E.usbHtml(e,usb(['3-1.4|2341|0043|02|0100|12|3|7|Arduino|Uno||100mA|80|0|02/02/01/cdc_acm,']));assert.match(arduino,/Arduino/);assert.match(arduino,/Not on the manual’s USB list: R707/,'the rule');assert.doesNotMatch(arduino,/data-usb-i2c/);
  assert.match(E.usbHtml(e,usb(['1-1|05e3|0608|09|8538|480|1|2||USB2.0 Hub||100mA|e0|4|09/00/00/hub,'])),/plugged in, nothing to configure/,'a splitter has nothing to say against it');
});
test('a new scan’s hubs go into a draft with its edits kept, and whether there are edits is told apart from a hub a scan found',()=>{
  const e=E.load('robot',XML,ALONE);assert.equal(E.edited(e),false);E.withPortals(e,CABLE);assert.equal(e.dirty,true,'a hub to save');assert.equal(E.edited(e),false,'not the student’s');assert.deepEqual(e.hubs.map(h=>h.name),['Control Hub','Expansion Hub 2','Servo Hub 3']);
  e.devices[0].name='elbow';e.dirty=true;assert.equal(E.edited(e),true);E.withPortals(e,CABLE);assert.equal(e.devices[0].name,'elbow');
  const blank=E.load('robot',XML,null);E.setType(blank,blank.hubs[0],'servo',0,'Servo');assert.equal(E.edited(blank),true,'half done counts');
  e.hub=1;E.withPortals(e,[{serial:'(embedded)',modules:[{address:173,parent:true},{address:2,parent:false},{address:7,parent:false}],servoHubs:[{address:3}]}]);assert.equal(e.hubs[e.hub].name,'Expansion Hub 2','the hub picked stays picked');
  const gone=E.load('robot',XML,CABLE);E.withPortals(gone,ALONE);assert.deepEqual(E.autoPlan(gone,[]).hubs,[],'a hub that left is not written');
});
const box=()=>{const on={};return {on,innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[],addEventListener(t,f){on[t]=f;}};};
test('one press writes once; without the edits the robot gets only what is new and the edits stay',async()=>{
  const saved=[],list=usb([CAM],{},[{serial:'Ucamera001',type:'WEBCAM'}]),b=box(),ed=E.create({box:b,api:{save:async(name,xml)=>{saved.push([name,xml]);},usb:()=>list,auto:()=>{}}});ed.open('robot',XML,CABLE);
  assert.match(b.innerHTML,/class="ce-bar-end"><button[^>]*data-ce-auto/);assert.match(b.innerHTML,/data-auto-offer><span>1 new USB device and 2 new hubs/);assert.equal(saved.length,0,'seeing them writes nothing');assert.equal(ed.edited(),false);
  const r=await ed.autoWrite(false);assert.equal(r.ok,true);assert.equal(saved.length,1);assert.deepEqual(r.cameras,['Webcam']);assert.equal(saved[0][0],'robot');assert.ok(saved[0][1].includes('<Webcam name="Webcam" serialNumber="Ucamera001" />'));assert.equal(ed.dirty(),false,'nothing left to save');assert.equal(ed.plan().writes,false);
});
test('unsaved edits: kept back they stay a draft on top of what was written, and sent they go with it',async()=>{
  const saved=[],list=usb([CAM],{},[{serial:'Ucamera001',type:'WEBCAM'}]),b=box(),ed=E.create({box:b,api:{save:async(name,xml)=>{saved.push(xml);},usb:()=>list,auto:()=>{}}});ed.open('robot',XML,null);
  b.on.change({target:{matches:()=>true,dataset:{ceName:'motor|0|'},value:'elbow',defaultValue:'left'}});assert.equal(ed.edited(),true);
  assert.equal((await ed.autoWrite(false)).ok,true);assert.doesNotMatch(saved[0],/elbow/,'not the edit');assert.match(saved[0],/name="left"/);assert.match(saved[0],/<Webcam name="Webcam" serialNumber="Ucamera001" \/>/);assert.equal(ed.dirty(),true,'still to save');assert.equal(ed.edited(),true);assert.equal(ed.plan().writes,false,'the camera is in the file now');
  assert.equal((await ed.autoWrite(true)).ok,true);assert.match(saved[1],/name="elbow"/);assert.equal((saved[1].match(/<Webcam /g)||[]).length,1,'once');assert.equal(ed.dirty(),false);
});
test('a save that fails loses nothing and says why',async()=>{
  const list=usb([CAM],{},[{serial:'Ucamera001',type:'WEBCAM'}]),b=box(),ed=E.create({box:b,api:{save:async()=>{throw Error('The robot did not answer.');},usb:()=>list,auto:()=>{}}});ed.open('robot',XML,null);
  const r=await ed.autoWrite(false);assert.equal(r.ok,false);assert.equal(r.error,'The robot did not answer.');assert.match(b.innerHTML,/The robot did not answer\./);assert.equal(ed.plan().writes,true,'still to do');
});

test('Debug: what is plugged in with its live result, and a way to Camera',()=>{
  const list=usb([CAM,C270,HUSKY]),configured=[{name:'Webcam',tag:'Webcam',serial:'Ucamera001'}],row=(html,key)=>{const a=html.indexOf(`data-usb-live="${key}"`);assert.ok(a>=0,key);const b=html.indexOf('data-usb-live="',a+20);return html.slice(a,b<0?undefined:b);};
  const idle=U.liveHtml(list,{running:false,configured});assert.match(row(idle,'Ucamera001'),/Start live debug to read it/);assert.match(row(idle,'Ucamera001'),/data-usb-to-camera="Ucamera001"/);assert.match(row(idle,'ABC270'),/Not in the configuration/);assert.match(row(idle,'ABC270'),/data-usb-auto/);assert.doesNotMatch(idle,/802\.11ac|xHCI/);assert.match(idle,/Not on the manual’s USB list: R707, R702 Example 5/);
  const manifest={cameras:['Webcam','Other']};assert.match(row(U.liveHtml(list,{running:true,manifest:null,configured}),'Ucamera001'),/Starting…/);
  assert.match(row(U.liveHtml(list,{running:true,manifest,cam:{state:'STREAMING',fps:29.7},configured}),'Ucamera001'),/rs-pill ok">Streaming · 30 frames a second/);
  assert.match(row(U.liveHtml(list,{running:true,manifest,cam:{state:'OPENING'},configured}),'Ucamera001'),/Camera opening/);assert.match(row(U.liveHtml(list,{running:true,manifest,cam:{error:'no such camera'},configured}),'Ucamera001'),/rs-pill bad">Did not start: no such camera/);
  assert.match(row(U.liveHtml(list,{running:true,manifest:{cameras:[]},configured}),'Ucamera001'),/Live debug did not open it/);assert.match(row(U.liveHtml(list,{running:true,manifest:{cameras:['Other','Webcam']},configured}),'Ucamera001'),/Only one opens at a time/);
  assert.match(U.liveHtml(null,{}),/No Control Hub connected/);assert.match(U.liveHtml(usb([]),{}),/Nothing is plugged into its USB ports/);assert.match(U.liveHtml([{serial:'Ucamera001',type:'WEBCAM'}],{configured}),/data-usb-live="Ucamera001"/,'over Wi-Fi');
});
test('Debug: a Limelight says how it is',()=>{
  const NET=`1-1|1d6b|0104|00|0100|480|1|5|Some|Gadget||100mA|80|0|02/06/00/cdc_ether/eth0,`,LIME={iface:'eth0',hubAddress:'172.29.0.23',address:'172.29.0.1',scanKey:'EthernetOverUsb:eth0:172.29.0.23',status:{name:'limelight'}},list=usb([NET],{limelight:LIME});
  assert.match(U.liveHtml(list,{lime:{temp:48.52,fps:90,pipelineIndex:2}}),/rs-pill ok">Answering · 48\.5 °C · 90 frames a second · pipeline 2/);assert.match(U.liveHtml(list,{lime:null}),/rs-pill warn">Not answering/);assert.match(U.liveHtml(list,{}),/Asking it how it is/);
});
test('Calibrate has three tabs, with USB devices inside Electronics and Debug',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../ui/simulation.js'),'utf8'),tops=[...src.matchAll(/data-cal-top="(\w+)"/g)].map(m=>m[1]);assert.deepEqual(tops,['camera','debug','calibrate']);assert.doesNotMatch(src,/cal-panel-usb|cal-tab-usb/);
  const electronics=src.slice(src.indexOf('id="cal-panel-electronics"'),src.indexOf('id="cal-panel-mechanisms"'));assert.match(electronics,/id="cal-usb"/);assert.match(src,/DeckUsbDevices\.createLive/);
  assert.match(src,/class="flow-axon" data-flow="axon"><span class="flow-new">New<\/span><span class="flow-num" aria-hidden="true">4<\/span>Axon Programmer/);
});

// ---- What the review found.
test('what is new is judged against the file on the robot, not the draft',async()=>{
  const list=usb([CAM],{},[{serial:'Ucamera001',type:'WEBCAM'}]);
  // Added on the row and never saved: still to write, and not called ready.
  const added=E.load('robot',XML,null);E.addWebcam(added,'Ucamera001');let plan=E.autoPlan(added,list);assert.equal(plan.writes,true,'it is not in the file');assert.deepEqual(plan.ready,[]);assert.deepEqual(plan.webcams.map(r=>r.add),['Ucamera001']);assert.deepEqual(E.autoApply(added,list).cameras,['Webcam'],'the one the student added');assert.equal(added.webcams.length,1,'not twice');
  // A name the student gave it goes with it.
  const named=E.load('robot',XML,null);E.addWebcam(named,'Ucamera001');E.renameWebcam(named,0,'front');assert.deepEqual(E.autoApply(named,list).cameras,['front']);
  // Removed from the draft and never saved: it is still in the file, so it is ready and not put back.
  const removed=E.load('robot',R.withWebcams(XML,[{name:'Webcam',serial:'Ucamera001'}]),null);E.removeWebcam(removed,0);plan=E.autoPlan(removed,list);assert.equal(plan.writes,false);assert.deepEqual(plan.ready,['Webcam']);
  // A failed Save them too has already changed the draft: the next press still writes.
  const b=box();let fail=true;const saved=[],ed=E.create({box:b,api:{save:async(n,x)=>{if(fail)throw Error('The robot did not answer.');saved.push(x);},usb:()=>list,auto:()=>{}}});ed.open('robot',XML,null);b.on.change({target:{matches:()=>true,dataset:{ceName:'motor|0|'},value:'elbow',defaultValue:'left'}});
  assert.equal((await ed.autoWrite(true)).ok,false);assert.equal(ed.plan().writes,true,'still to do');assert.deepEqual(ed.plan().ready,[]);fail=false;const again=await ed.autoWrite(true);assert.equal(again.ok,true);assert.deepEqual(again.cameras,['Webcam']);assert.equal((saved[0].match(/<Webcam /g)||[]).length,1);assert.match(saved[0],/name="elbow"/);
  // A Limelight added on its row, unsaved, is the same.
  const NET=`1-1|1d6b|0104|00|0100|480|1|5|Some|Gadget||100mA|80|0|02/06/00/cdc_ether/eth0,0a/00/00/cdc_ether,`,LIME={iface:'eth0',hubAddress:'172.29.0.23',address:'172.29.0.1',scanKey:'EthernetOverUsb:eth0:172.29.0.23',status:{name:'limelight'}},SCAN=[{serial:LIME.scanKey,type:'ETHERNET_DEVICE'}],nets=usb([NET],{limelight:LIME,scan:{portals:[],others:SCAN}},SCAN),lime=E.load('robot',XML,null);E.addLimelight(lime,{serial:LIME.scanKey,address:LIME.address});assert.equal(E.autoPlan(lime,nets).writes,true);assert.deepEqual(E.autoApply(lime,nets).cameras,['limelight']);assert.equal(lime.limelights.length,1);
});
test('with nothing to say what is plugged in, no camera is called ready',()=>{
  const plan=E.autoPlan(E.load('robot',R.withWebcams(XML,[{name:'Webcam',serial:'Ucamera001'}]),null),null);assert.equal(plan.writes,false);assert.deepEqual(plan.ready,[],'no scan has answered');assert.equal(plan.readyKey,null);
});
const THEIRS=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<Robot type="FirstInspires-FTC">\n    <!-- Deck wiring: {"arm.motor":{"gear":"13.7:1"},"left":{"gear":"5.2:1"}} -->\n    <!-- team note: do not touch -->\n    <Webcam name="front" serialNumber="ABC" />\n    <LynxUsbDevice name="My Portal" serialNumber="(embedded)" parentModuleAddress="173">\n        <LynxModule name="Brain" port="173">\n            <goBILDA5202SeriesMotor name="arm.motor" port="0" />\n            <goBILDA5202SeriesMotor name="left" port="1" />\n        </LynxModule>\n    </LynxUsbDevice>\n</Robot>\n`,MINE=[{serial:'(embedded)',modules:[{address:173,parent:true,imu:'BHI260'}]}];
test('USB devices alone go into the file by text: every other byte stays, whatever it holds',async()=>{
  const list=usb([CAM],{},[{serial:'ABC',type:'WEBCAM'},{serial:'Ucamera001',type:'WEBCAM'}]),saved=[],b=box(),ed=E.create({box:b,api:{save:async(n,x)=>{saved.push(x);},usb:()=>list,auto:()=>{}}});ed.open('robot',THEIRS,MINE);assert.equal(ed.edited(),false);
  const r=await ed.autoWrite(false);assert.equal(r.ok,true,r.error);assert.deepEqual(r.cameras,['Webcam']);assert.equal(saved[0],THEIRS.replace('<Webcam name="front" serialNumber="ABC" />','<Webcam name="front" serialNumber="ABC" />\n    <Webcam name="Webcam" serialNumber="Ucamera001" />'),'only that line is new');assert.deepEqual(R.webcamsOf(saved[0]).map(c=>c.name),['front','Webcam'],'in order');assert.equal(ed.dirty(),false);assert.equal(ed.plan().writes,false);
  // Nothing there yet: first under <Robot>, ahead of the notes, with them still there.
  assert.equal(R.withUsbAdded(XML,{webcams:[{name:'Webcam',serial:'X'}]}),XML.replace('<Robot type="FirstInspires-FTC">\n','<Robot type="FirstInspires-FTC">\n    <Webcam name="Webcam" serialNumber="X" />\n'));assert.equal(R.withUsbAdded(XML,{}),XML);
  // A Limelight too, and one whose address moved is corrected where it is.
  const NET=`1-1|1d6b|0104|00|0100|480|1|5|Some|Gadget||100mA|80|0|02/06/00/cdc_ether/eth0,0a/00/00/cdc_ether,`,LIME={iface:'eth0',hubAddress:'172.29.0.23',address:'172.29.0.1',scanKey:'EthernetOverUsb:eth0:172.29.0.23',status:{name:'limelight'}},SCAN=[{serial:LIME.scanKey,type:'ETHERNET_DEVICE'}],nets=usb([NET],{limelight:LIME,scan:{portals:[],others:SCAN}},SCAN),out=[],c=box(),lime=E.create({box:c,api:{save:async(n,x)=>{out.push(x);},usb:()=>nets,auto:()=>{}}});lime.open('robot',THEIRS,MINE);assert.equal((await lime.autoWrite(false)).ok,true);assert.match(out[0],/<EthernetDevice name="limelight" serialNumber="EthernetOverUsb:eth0:172\.29\.0\.23" port="-1" ipAddress="172\.29\.0\.1" \/>/);assert.match(out[0],/team note: do not touch/);assert.match(out[0],/name="arm\.motor"/);
  const moved=R.withLimelights(THEIRS,[{name:'limelight',serial:'EthernetOverUsb:eth0:172.29.0.9',port:-1,ipAddress:'172.29.0.1'}]),fixed=[],d=box(),fix=E.create({box:d,api:{save:async(n,x)=>{fixed.push(x);},usb:()=>nets,auto:()=>{}}});fix.open('robot',moved,MINE);assert.equal((await fix.autoWrite(false)).ok,true);assert.equal(R.limelightsOf(fixed[0]).length,1);assert.equal(R.limelightsOf(fixed[0])[0].serial,LIME.scanKey);assert.match(fixed[0],/team note: do not touch/);
});
test('a name a Driver Hub allowed does not block anything, and a hub a scan added is not the student’s change',async()=>{
  const e=E.load('robot',THEIRS,MINE);assert.equal(E.edited(e),false);E.withPortals(e,CABLE);assert.equal(e.dirty,true);assert.equal(E.edited(e),false,'only hubs a scan found');
  // A hub that came and went is not their change either.
  const gone=E.load('robot',THEIRS,CABLE);E.withPortals(gone,MINE);assert.equal(E.edited(gone),false);
  e.devices.find(d=>d.name==='left').name='elbow';assert.equal(E.edited(e),true);const back=E.load('robot',THEIRS,MINE);E.setType(back,back.hubs[0],'servo',0,'Servo');assert.equal(E.edited(back),true,'half done counts');
  // Gear chosen, then chosen back: not a change.
  const gear=E.load('robot',THEIRS,MINE);const m=gear.devices.find(d=>d.name==='left');m.gear='13.7:1';gear.dirty=true;assert.equal(E.edited(gear),true);m.gear='5.2:1';assert.equal(E.edited(gear),false);
  // Written afresh, as adding a hub takes: the name stays, with the portal's name and the notes.
  const list=usb([CAM],{},[{serial:'ABC',type:'WEBCAM'},{serial:'Ucamera001',type:'WEBCAM'}]),saved=[],b=box(),ed=E.create({box:b,api:{save:async(n,x)=>{saved.push(x);},usb:()=>list,auto:()=>{}}});ed.open('robot',THEIRS,CABLE);assert.equal(ed.edited(),false);
  const r=await ed.autoWrite(false);assert.equal(r.ok,true,r.error);assert.deepEqual(r.hubs,['Expansion Hub 2','Servo Hub 3']);const x=saved[0];assert.match(x,/<goBILDA5202SeriesMotor name="arm\.motor" port="0" \/>/);assert.match(x,/<LynxUsbDevice name="My Portal" serialNumber="\(embedded\)"/);assert.match(x,/<LynxModule name="Brain" port="173">/);assert.match(x,/<LynxModule name="Expansion Hub 2" port="2" \/>/);assert.deepEqual(Object.keys(R.notesOf(x)).sort(),['arm.motor','left'],'its notes');assert.match(x,/<Webcam name="front" serialNumber="ABC" \/>/);assert.match(x,/<Webcam name="Webcam" serialNumber="Ucamera001" \/>/);
  // A name the student types is still held to the rule. Drive's Configure Robot, which does not ask to keep anything, is as it was.
  const typed=E.load('robot',XML,null);typed.devices[0].name='new.name';typed.dirty=true;assert.throws(()=>E.xmlOf(typed),/“new\.name” cannot be a device name/);assert.throws(()=>R.rebuild(THEIRS,[{name:'arm.motor',tag:'goBILDA5202SeriesMotor',port:0,module:{portal:'(embedded)',address:173}}]),/cannot be a device name/);assert.match(R.rebuild(THEIRS,[]),/<LynxUsbDevice name="Control Hub Portal"/);
  // A name with a symbol the robot cannot be sent says so, and writes nothing.
  const sym=XML.replace('name="left"','name="o&apos;clock"'),no=[],c=box(),bad=E.create({box:c,api:{save:async(n,x)=>{no.push(x);},usb:()=>list,auto:()=>{}}});bad.open('robot',sym,CABLE);const w=await bad.autoWrite(false);assert.equal(w.ok,false);assert.match(w.error,/cannot be sent to the robot/);assert.equal(no.length,0);
});
test('wiring notes read over the cable come back over Wi-Fi, where the robot sends none, and a save has the last word',()=>{
  const L=require('../src/robot-link.cjs'),kept=new Map(),store={get:(r,n)=>kept.get(`${r}|${n}`)||null,set:(r,n,v)=>kept.set(`${r}|${n}`,v)},withNotes=R.withNotes(XML,{left:{gear:'13.7:1'}});
  const cable=L.notesThrough({source:'usb',deviceName:'FTC-1',files:{robot:withNotes,other:XML}},store);assert.equal(cable.files.robot,withNotes);assert.deepEqual(kept.get('FTC-1|robot'),{left:{gear:'13.7:1'}});assert.equal(kept.has('FTC-1|other'),false,'nothing to keep');
  const wifi=L.notesThrough({source:'wifi',deviceName:'FTC-1',files:{robot:XML,other:XML}},store);assert.deepEqual(R.notesOf(wifi.files.robot),{left:{gear:'13.7:1'}});assert.equal(wifi.files.other,XML,'none known: as it came');
  const e=E.load('robot',wifi.files.robot,null);assert.equal(e.devices[0].gear,'13.7:1','Configure shows them');assert.deepEqual(R.notesOf(E.xmlOf(e)),{left:{gear:'13.7:1'}},'and Save keeps them');
  assert.equal(L.notesThrough({source:'wifi',files:{robot:XML}},store).files.robot,XML,'no name for the robot: nothing to go by');store.set('FTC-1','robot',{});assert.equal(L.notesThrough({source:'wifi',deviceName:'FTC-1',files:{robot:XML}},store).files.robot,XML,'cleared by a save');
});
