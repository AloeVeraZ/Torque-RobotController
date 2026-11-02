'use strict';
// A camera plugged into the Control Hub: what Configure lists and writes, and what Calibrate → Camera offers.
const {test}=require('node:test'),assert=require('node:assert/strict'),R=require('../ui/ftc/robot-config.js');
globalThis.DeckRobotConfig=R;globalThis.DeckDeviceArt=require('../ui/ftc/device-art.js');globalThis.document??={addEventListener(){},activeElement:null};
const E=require('../ui/sim-config-editor.js'),Cam=require('../ui/sim-camera.js');
const XML=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<Robot type="FirstInspires-FTC">\n    <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">\n        <LynxModule name="Control Hub" port="173">\n            <goBILDA5202SeriesMotor name="left" port="0" />\n        </LynxModule>\n    </LynxUsbDevice>\n</Robot>\n`;
const CAM={serial:'Ucamera001',type:'WEBCAM'},LIME={serial:'EthernetOverUsb:eth0:172.29.0.23',type:'ETHERNET_DEVICE'};
const box=()=>({innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}});

test('a scan reads a generic camera as WEBCAM, and a configuration keeps its serial number on the device',()=>{
  assert.deepEqual(R.otherUsb(JSON.stringify({map:[{key:'(embedded)',value:'LYNX_USB_DEVICE'},{key:'Ucamera001',value:'WEBCAM'}]})),[CAM]);
  const saved=R.withWebcams(XML,[{name:'Webcam 1',serial:'Ucamera001'}]);assert.deepEqual(R.parse(saved).devices.find(d=>d.tag==='Webcam'),{name:'Webcam 1',tag:'Webcam',kind:'webcam',hub:null,serial:'Ucamera001'});
  assert.equal(R.usbLabel('WEBCAM'),'Webcam');assert.equal(R.usbLabel('ETHERNET_DEVICE'),'Limelight or USB network device','a scan does not check that it is a Limelight');assert.equal(R.usbLabel('SOME_OTHER'),'SOME OTHER');
});

test('a plugged-in camera is listed with its serial, says it is not in this configuration, and has one Add button',()=>{
  const e=E.load('robot',XML,null),html=E.usbHtml(e,[CAM]);
  assert.match(html,/Webcam · Ucamera001/);assert.match(html,/plugged in, not in this configuration/);assert.equal((html.match(/data-ce-usb-add=/g)||[]).length,1);assert.match(html,/data-ce-usb-add="Ucamera001"/);
  assert.match(E.usbNavHtml(e,[CAM]),/1 camera plugged in, not in this configuration/);
  assert.equal(E.usbHtml(e,[]),'','nothing plugged in and nothing configured: no rows');assert.match(E.usbNavHtml(e,[]),/Nothing else is on the Control Hub/);assert.match(E.usbNavHtml(e,null),/Connect to the robot/);
});

test('Add, rename and remove change the draft and write the right XML',()=>{
  const e=E.load('robot',XML,null);assert.equal(e.dirty,false);const c=E.addWebcam(e,'Ucamera001');assert.equal(c.name,'Webcam 1');assert.equal(e.dirty,true);assert.equal(E.addWebcam(e,'Ucamera001'),null,'one camera is added once');
  assert.ok(E.xmlOf(e).includes('<Webcam name="Webcam 1" serialNumber="Ucamera001" />'),E.xmlOf(e));assert.equal(e.xml,XML,'the draft only: what came from the robot is untouched');assert.ok(R.parse(E.xmlOf(e)).devices.some(d=>d.name==='left'),'the rest of it stays');
  assert.equal(E.renameWebcam(e,0,'  front cam '),null);assert.ok(E.xmlOf(e).includes('<Webcam name="front cam" serialNumber="Ucamera001" />'));
  assert.match(E.renameWebcam(e,0,'bad;name'),/letters, digits/);assert.match(E.renameWebcam(e,0,'LEFT'),/already named/);assert.equal(e.webcams[0].name,'front cam','a refused name changes nothing');
  assert.equal(E.addWebcam(e,'other').name,'Webcam 1','the next free name');assert.equal(E.addWebcam(e,'third').name,'Webcam 2');
  const again=E.load('robot',E.xmlOf(e),null);assert.equal(again.dirty,false);assert.deepEqual(again.webcams.map(x=>x.serial),['Ucamera001','other','third'],'it survives saving');
  E.removeWebcam(again,0);assert.equal(again.dirty,true);assert.ok(!E.xmlOf(again).includes('Ucamera001'));assert.deepEqual(again.webcams.map(x=>x.name),['Webcam 1','Webcam 2']);
  const taken=E.load('robot',R.withWebcams(XML,[{name:'Webcam 1',serial:'a'}]),null);assert.equal(E.addWebcam(taken,'b').name,'Webcam 2');
  const clash=E.load('robot',R.withWebcams(XML,[{name:'left',serial:'a'}]),null);assert.throws(()=>E.xmlOf(clash),/Two devices are named “left”/);
});

test('a camera in the configuration says whether it is plugged in, and says nothing until a hub has said',()=>{
  const e=E.load('robot',R.withWebcams(XML,[{name:'Webcam 1',serial:'Ucamera001'}]),null);
  assert.match(E.usbHtml(e,[CAM]),/Webcam · Ucamera001 · plugged in</);assert.doesNotMatch(E.usbHtml(e,[CAM]),/data-ce-usb-add/,'no Add for one it has');
  assert.match(E.usbHtml(e,[]),/in this configuration, not plugged in/);assert.match(E.usbHtml(e,[]),/data-absent/);
  const none=E.usbHtml(e,null);assert.match(none,/Webcam · Ucamera001</);assert.doesNotMatch(none,/plugged in/);
});

test('a network device Scan offers shows under the same heading, with no Add until it answers as a Limelight, and one already configured says so',()=>{
  const e=E.load('robot',XML,null),html=E.usbHtml(e,[CAM,LIME]);assert.equal((html.match(/class="ce-heading">USB devices/g)||[]).length,1);assert.match(html,/<b>USB network device<\/b>/);assert.match(html,/checking whether it is a Limelight/);assert.equal((html.match(/data-ce-usb-add/g)||[]).length,1,'only the camera can be added');
  const kept=E.load('robot',XML.replace(/(<Robot\b[^>]*>)/,'$1\n    <EthernetDevice name="limelight" serialNumber="EthernetOverUsb:eth0:172.29.0.23" port="0" ipAddress="172.29.0.1" />'),null),row=E.usbHtml(kept,[LIME]);
  assert.match(row,/<b>limelight<\/b>/);assert.match(row,/Limelight · EthernetOverUsb:eth0:172\.29\.0\.23 · plugged in/);assert.doesNotMatch(row,/Configure Robot/);assert.match(E.xmlOf(kept),/<EthernetDevice name="limelight" serialNumber="EthernetOverUsb:eth0:172\.29\.0\.23" port="0" ipAddress="172\.29\.0\.1" \/>/,'written back as it was');
});

// What Torque's own read of the ports says: the rows DeckUsbKinds.classifyAll makes.
const K=require('../ui/ftc/usb-kinds.js'),ETH=[{class:'02',sub:'06',proto:'00',driver:'cdc_ether',net:['eth0']}],NET={path:'1-1',vid:'1d6b',pid:'0104',class:'00',bcd:'0100',speed:480,product:'Some Gadget',interfaces:ETH};
const LIMELIGHT={iface:'eth0',hubAddress:'172.29.0.23',address:'172.29.0.1',scanKey:LIME.serial,status:{name:'limelight',temp:40}};
const withRows=(list,devices,context)=>Object.assign([...list],{devices:K.classifyAll(devices,context)});

test('a Limelight that answers gets an Add, which writes the entry under <Robot> as a draft',()=>{
  const usb=withRows([LIME],[NET],{scan:{portals:[],others:[LIME]},limelight:LIMELIGHT}),e=E.load('robot',XML,null);
  assert.match(E.usbHtml(e,usb),/data-ce-usb-add-lime="EthernetOverUsb:eth0:172\.29\.0\.23"/);assert.match(E.usbNavHtml(e,usb),/a Limelight plugged in, not in this configuration/);
  assert.equal(R.withLimelights(XML,[]),XML,'nothing to write changes nothing');
  const c=E.addLimelight(e,{serial:LIME.serial,address:'172.29.0.1'});assert.equal(c.name,'limelight');assert.equal(e.dirty,true);assert.equal(e.xml,XML,'the draft only');assert.equal(E.addLimelight(e,{serial:'other',address:'172.29.1.1'}),null,'a hub can only have one');
  const out=E.xmlOf(e);assert.ok(out.includes('<EthernetDevice name="limelight" serialNumber="EthernetOverUsb:eth0:172.29.0.23" port="-1" ipAddress="172.29.0.1" />'),out);assert.match(out,/<Robot[^>]*>\s*<EthernetDevice/,'directly under Robot');assert.ok(R.parse(out).devices.some(d=>d.name==='left'),'the rest of it stays');
  assert.deepEqual(R.parse(out).devices.find(d=>d.tag==='EthernetDevice'),{name:'limelight',tag:'EthernetDevice',kind:'limelight',hub:null,serial:LIME.serial,port:-1},'read back the same way');
  assert.doesNotMatch(E.usbHtml(e,usb),/data-ce-usb-add-lime/,'no second Add');assert.match(E.usbHtml(e,usb),/<b>limelight<\/b><small>Limelight · EthernetOverUsb:eth0:172\.29\.0\.23 · plugged in/);
  const again=E.load('robot',out,null);assert.equal(again.dirty,false);assert.deepEqual(again.limelights,[{name:'limelight',serial:LIME.serial,port:-1,ipAddress:'172.29.0.1'}],'it survives saving');assert.deepEqual(again.outside,[]);
  E.removeLimelight(again,0);assert.equal(again.dirty,true);assert.ok(!E.xmlOf(again).includes('EthernetDevice'));
  const named=E.load('robot',XML.replace('name="left"','name="limelight"'),null);assert.equal(E.addLimelight(named,{serial:'s',address:'a'}).name,'limelight 2','a name taken moves over');
});

test('a Limelight whose address moved keeps its entry, and offers to update it',()=>{
  const old=E.load('robot',R.withLimelights(XML,[{name:'limelight',serial:'EthernetOverUsb:eth0:172.29.0.9',port:-1,ipAddress:'172.29.0.1'}]),null),usb=withRows([LIME],[NET],{scan:{portals:[],others:[LIME]},limelight:LIMELIGHT}),html=E.usbHtml(old,usb);
  assert.match(html,/with an old address/);assert.match(html,/data-ce-usb-lime-fix="0"/);assert.doesNotMatch(html,/data-ce-usb-add-lime/);
  E.fixLimelight(old,0,{serial:LIME.serial,address:'172.29.0.1'});assert.ok(E.xmlOf(old).includes(`serialNumber="${LIME.serial}"`));
});

test('a USB network device that does not answer as a Limelight gets a warning and no Add',()=>{
  const e=E.load('robot',XML,null),usb=withRows([LIME],[NET],{scan:{portals:[],others:[LIME]},limelight:{status:null}}),html=E.usbHtml(e,usb);
  assert.doesNotMatch(html,/data-ce-usb-add/);assert.match(html,/Scan offers this as if it were a Limelight/);assert.match(html,/data-warn/);assert.equal((html.match(/data-warn/g)||[]).length,1,'said once, though Scan and the read both found it');
  const noScan=E.usbHtml(e,withRows([],[NET],{scan:{portals:[],others:[]},limelight:{status:null}}));assert.match(noScan,/Scan offers this as if it were a Limelight/);assert.doesNotMatch(noScan,/data-ce-usb-add/);
  assert.match(E.usbHtml(e,withRows([LIME],[NET],{scan:{portals:[],others:[LIME]}})),/checking whether it is a Limelight/,'while the check has not answered');
});

test('a webcam the read found before Scan can be added, and a depth camera Scan offers cannot',()=>{
  const CAM_IF=[{class:'0e',sub:'01',proto:'00',driver:'uvcvideo'},{class:'0e',sub:'02',proto:'00',driver:'uvcvideo'}],cam={path:'1-1',vid:'a108',pid:'2240',class:'ef',bcd:'0090',speed:480,serial:'Ucamera001',product:'UVC Camera',interfaces:CAM_IF},e=E.load('robot',XML,null);
  assert.match(E.usbHtml(e,withRows([],[cam],{})),/data-ce-usb-add="Ucamera001"/);
  const own=E.load('robot',R.withWebcams(XML,[{name:'Webcam 1',serial:'Ucamera001'}]),null);assert.match(E.usbHtml(own,withRows([],[cam],{})),/Webcam · Ucamera001 · plugged in</,'the read says it is here, whatever the last Scan said');assert.match(E.usbHtml(own,withRows([CAM],[],{})),/in this configuration, not plugged in/,'and that it has gone');
  const depth={...cam,vid:'8086',pid:'0b07',serial:'RS1'},bad=E.usbHtml(e,withRows([{serial:'RS1',type:'WEBCAM'}],[depth],{scan:{portals:[],others:[{serial:'RS1',type:'WEBCAM'}]}}));assert.doesNotMatch(bad,/data-ce-usb-add/);assert.match(bad,/Do not add it/);
});

const VP='VendorProduct:vendor=0x046d|product=0x0825|connection=',CAM_IFACES=[{class:'0e',sub:'01',proto:'00',driver:'uvcvideo'},{class:'0e',sub:'02',proto:'00',driver:'uvcvideo'}];
const C270=(path='1-1')=>({path,vid:'046d',pid:'0825',class:'ef',bcd:'0010',speed:480,serial:'',product:'C270 HD WEBCAM',interfaces:CAM_IFACES});

test('two identical cameras with no serial: the port in the key tells them apart, so the second can still be added',()=>{
  const a=`${VP}1-1`,b=`${VP}3-1.4`,scan=[{serial:a,type:'WEBCAM'},{serial:b,type:'WEBCAM'}],e=E.load('robot',XML,null);
  assert.equal(K.sameCamera(a,b),false,'two ports, two cameras');assert.equal(K.sameCamera(a,a),true);assert.equal(K.sameCamera(VP,a),true,'no port means any port');assert.equal(K.sameCamera('x','x'),true);assert.equal(K.sameCamera('x','y'),false);assert.equal(Cam.sameCamera(a,b),false,'Camera agrees');
  const usb=withRows(scan,[C270('1-1'),C270('3-1.4')],{scan:{portals:[],others:scan}});assert.equal((E.usbHtml(e,usb).match(/data-ce-usb-add=/g)||[]).length,2);
  assert.ok(E.addWebcam(e,a));let html=E.usbHtml(e,usb);assert.equal((html.match(/data-ce-usb-add=/g)||[]).length,1,'the first went in, and the second is still offered');assert.ok(html.includes(`data-ce-usb-add="${b}"`));
  assert.ok(E.addWebcam(e,b));html=E.usbHtml(e,usb);assert.doesNotMatch(html,/data-ce-usb-add=/);assert.deepEqual(e.webcams.map(c=>c.name),['Webcam 1','Webcam 2']);assert.doesNotMatch(html,/not plugged in/,'both are plugged in');
  assert.ok(E.xmlOf(e).includes(`serialNumber="${a}"`)&&E.xmlOf(e).includes(`serialNumber="${b}"`));
  // One set up with no port when it was alone, and now a twin beside it.
  const old=E.load('robot',R.withWebcams(XML,[{name:'Webcam 1',serial:VP}]),null);assert.equal((E.usbHtml(old,usb).match(/data-ce-usb-add=/g)||[]).length,1,'it accounts for one of them');
  // Camera the same way, with no two entries on one key.
  assert.deepEqual(Cam.choices([],[{name:'Webcam 1',serial:a}],scan).map(o=>[o.value,o.state]),[['Webcam 1','configured'],[`usb:${b}`,'spare']]);assert.deepEqual(Cam.choices([],[{name:'Webcam 1',serial:VP}],scan).map(o=>o.state),['configured','spare']);
  // Before Scan has said which port is which: one row, with nothing to add yet.
  const early=E.usbHtml(E.load('robot',XML,null),withRows([],[C270('1-1'),C270('3-1.4')],{}));assert.doesNotMatch(early,/data-ce-usb-add=/);assert.equal((early.match(/class="ce-usb"/g)||[]).length,1);assert.match(early,/waiting for Scan to tell them apart/);
});

test('a serial number with & or an apostrophe gets no Add, and says why in plain words',()=>{
  assert.equal(R.canSend('Ucamera001'),true);assert.equal(R.canSend(`${VP}1-1`),true,'the made-up key is fine');for(const bad of ['A&B',"O'Neil",'a;b','a<b','a>b','a"b'])assert.equal(R.canSend(bad),false,bad);
  const e=E.load('robot',XML,null),scan=[{serial:'A&B',type:'WEBCAM'}],html=E.usbHtml(e,scan);assert.doesNotMatch(html,/data-ce-usb-add=/);assert.match(html,/data-warn/);assert.match(html,/Torque cannot add this camera: its serial number has a symbol, such as &amp; or an apostrophe/);assert.match(html,/A&amp;B/);
  assert.equal(E.addWebcam(e,'A&B'),null,'nor can it be added any other way');assert.equal(e.dirty,false);
  const cam={path:'1-1',vid:'a108',pid:'2240',class:'ef',bcd:'0090',speed:480,serial:"O'Neil",product:'UVC Camera',interfaces:CAM_IFACES},read=E.usbHtml(E.load('robot',XML,null),withRows([],[cam],{}));assert.doesNotMatch(read,/data-ce-usb-add=/,'nor when the read found it first');assert.match(read,/Torque cannot add this camera/);
});

test('the long key the robot makes up for a camera never shows where a student reads: only under Technical facts',()=>{
  const usb=withRows([{serial:VP,type:'WEBCAM'}],[C270()],{scan:{portals:[],others:[{serial:VP,type:'WEBCAM'}]}}),e=E.load('robot',XML,null),html=E.usbHtml(e,usb);
  assert.match(html,/<b>Webcam · C270 HD WEBCAM<\/b>/);assert.match(html,/aria-label="Add Webcam C270 HD WEBCAM to this configuration"/);
  const closed=/<details class="usb-facts"><summary>Technical facts<\/summary>VendorProduct:vendor=0x046d\|product=0x0825\|connection=<\/details>/;assert.match(html,closed,'closed, and there if wanted');
  const seen=h=>h.replace(/<details[\s\S]*?<\/details>/g,'').replace(/(id|data-ce-usb-add)="[^"]*"/g,'');assert.doesNotMatch(seen(html),/VendorProduct/);
  const own=E.load('robot',R.withWebcams(XML,[{name:'Webcam 1',serial:VP}]),null),mine=E.usbHtml(own,usb);assert.match(mine,/Webcam · C270 HD WEBCAM · plugged in/);assert.match(mine,closed);assert.doesNotMatch(seen(mine),/VendorProduct/);
  assert.doesNotMatch(seen(E.usbHtml(own,[])),/VendorProduct/,'not plugged in, so its name is not known');assert.match(E.usbHtml(own,[]),/Camera with no serial number · in this configuration, not plugged in/);
  assert.doesNotMatch(E.usbNavHtml(e,usb),/VendorProduct/);
  // A real serial stays as it is, with nothing to open.
  assert.doesNotMatch(E.usbHtml(E.load('robot',XML,null),[CAM]),/Technical facts/);
  // Two of them: which port each is in.
  const two=[`${VP}1-1`,`${VP}3-1.4`].map(serial=>({serial,type:'WEBCAM'})),both=E.usbHtml(E.load('robot',XML,null),withRows(two,[C270('1-1'),C270('3-1.4')],{scan:{portals:[],others:two}}));assert.match(both,/C270 HD WEBCAM, Blue USB 3\.0 port/);assert.match(both,/C270 HD WEBCAM, USB 2\.0 port/);
  // Camera's list, and what it says with nothing read yet.
  assert.deepEqual(Cam.choices([],[],[{serial:VP,type:'WEBCAM',name:'C270 HD WEBCAM'}])[0].label,'Webcam · C270 HD WEBCAM (not in this configuration)');assert.equal(Cam.choices([],[],[{serial:VP,type:'WEBCAM'}])[0].label,'Webcam · Camera with no serial number (not in this configuration)');
  const conf=Cam.choices([],[{name:'Webcam 1',serial:VP}],[{serial:VP,type:'WEBCAM',name:'C270 HD WEBCAM'}])[0];assert.equal(conf.label,'Webcam 1 · C270 HD WEBCAM');assert.equal(conf.serial,VP,'it still knows the key');assert.doesNotMatch(Cam.choices([],[{name:'Webcam 1',serial:VP}],[])[0].label,/VendorProduct/);
  assert.equal(K.cameraLabel('Ucamera001'),'Ucamera001');assert.equal(K.cameraLabel(''),'');
  // Setup's list over Wi-Fi, where only Scan has said.
  const W=require('../ui/sim-wiring.js'),D=require('../ui/sim-hardware.js'),wifi=W.scanHtml({wiring:D.wiringOf({})},{expansion:0,servoHub:0,others:[{serial:VP,type:'WEBCAM'}]},{});assert.match(wifi,/Camera with no serial number/);assert.doesNotMatch(wifi,/VendorProduct/);
});

test('a network device that has left is no reason to warn, however long ago the last Scan was',()=>{
  const e=E.load('robot',XML,null),here=withRows([LIME],[NET],{scan:{portals:[],others:[LIME]},limelight:{status:null}}),gone=withRows([LIME],[],{scan:{portals:[],others:[LIME]}});
  assert.match(E.usbHtml(e,here),/Scan offers this as if it were a Limelight/,'while it is there');assert.doesNotMatch(E.usbHtml(e,gone),/Limelight/,'gone: nothing is said');assert.doesNotMatch(E.usbHtml(e,gone),/data-warn/);assert.match(E.usbNavHtml(e,gone),/Nothing else is on the Control Hub/);
  assert.match(E.usbHtml(e,[LIME]),/checking whether it is a Limelight/,'with the ports not read, the last Scan is all there is');
});

test('the constants file has the lens numbers, and never the simulated webcam’s',()=>{
  const T=require('../ui/sim-tune.js'),java=T.constants([],{lens:{sim:{'640x480':{fx:1,fy:1,cx:1,cy:1}},Ucamera001:{'640x480':{fx:822.5,fy:822.5,cx:320,cy:240}}}});
  assert.match(java,/LENS_UCAMERA001_640X480_FX = 822\.5, LENS_UCAMERA001_640X480_FY = 822\.5, LENS_UCAMERA001_640X480_CX = 320, LENS_UCAMERA001_640X480_CY = 240;/);assert.match(java,/setLensIntrinsics\(LENS_UCAMERA001_640X480_FX/);assert.doesNotMatch(java,/SIM/);
  assert.deepEqual(T.sanitize({lens:{Ucamera001:{'640x480':{fx:822.5}}},mechs:{}}).lens,{Ucamera001:{'640x480':{fx:822.5}}},'saving the calibration keeps them');assert.deepEqual(T.sanitize({mechs:{}}),{mechs:{}},'and adds nothing when there are none');
});

test('the editor draws them above the families, and seeing them changes nothing',()=>{
  let others=[],saved=0;const b=box(),ed=E.create({box:b,api:{save:async()=>{saved++;},usb:()=>others}});ed.open('robot',XML,null);assert.doesNotMatch(b.innerHTML,/data-ce-usb-add/);
  others=[CAM];ed.render();const main=b.innerHTML.slice(b.innerHTML.indexOf('class="ce-main"'),b.innerHTML.indexOf('class="ce-hubs"'));assert.ok(main.indexOf('data-ce-usb-add')>=0,'in the main column');assert.ok(main.indexOf('data-ce-usb-add')<main.indexOf('data-ce-family="motor"'),'above the families');assert.match(b.innerHTML.slice(b.innerHTML.indexOf('class="ce-hubs"')),/data-ce-usb-show/);
  assert.equal(ed.dirty(),false,'seeing a camera changes nothing');assert.equal(saved,0);
});

test('Camera offers what is plugged in as well as what is configured',()=>{
  assert.deepEqual(Cam.choices([],[],null),[{value:'sim',label:'Simulated webcam',state:'sim'}],'no hub: the simulated webcam');assert.equal(Cam.choices([],[],[])[0].state,'sim');assert.equal(Cam.choices([],[],[LIME])[0].state,'sim','a Limelight is not a webcam');
  assert.deepEqual(Cam.choices([],[],[CAM]),[{value:'usb:Ucamera001',label:'Webcam · Ucamera001 (not in this configuration)',state:'spare',serial:'Ucamera001'}]);
  const own=[{name:'Webcam 1',serial:'Ucamera001'}];assert.deepEqual(Cam.choices([],own,[CAM]).map(o=>[o.value,o.state,o.absent]),[['Webcam 1','configured',false]],'in the configuration: once');assert.equal(Cam.choices([],own,[]).at(0).absent,true,'not plugged in');assert.match(Cam.choices([],own,[])[0].label,/not plugged in/);assert.equal(Cam.choices([],own,null)[0].absent,false,'no hub has said');
  assert.deepEqual(Cam.choices(['Webcam 1'],own,[CAM,{serial:'b',type:'WEBCAM'}]).map(o=>[o.value,o.state]),[['Webcam 1','live'],['usb:b','spare']],'a second one stays on the list, to add');
});
