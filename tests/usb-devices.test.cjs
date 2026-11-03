'use strict';
// Calibrate → USB devices and the checks in Calibrate → Camera: what they say from what the hub reads. The UI itself is tests/usb-devices-ui.cjs.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const K=require('../ui/ftc/usb-kinds.js'),U=require('../ui/sim-usb-devices.js'),Cam=require('../ui/sim-camera.js'),{parseUsb}=require('../src/hub-usb.cjs');
globalThis.DeckUsbKinds=K;globalThis.DeckUsbDevices=U;
// The real answer of FTC-zWL4, with a generic webcam in the blue port.
const REAL=parseUsb(`1-1|a108|2240|ef|0090|480|1|2|HHYL|UVC Camera|Ucamera001|200mA|c0|0|0e/01/00/uvcvideo,0e/02/00/uvcvideo,03/00/00/usbhid,01/01/00/snd-usb-audio,01/02/00/snd-usb-audio,
3-1|05e3|0608|09|8538|480|3|2||USB2.0 Hub||100mA|e0|4|09/00/00/hub,
3-1.1|0bda|c820|ef|0200|480|3|3|Realtek|802.11ac NIC|123456|500mA|a0|0|e0/01/01/rtk_btusb,e0/01/01/rtk_btusb,ff/ff/ff/rtl8821cu,
usb1|1d6b|0002|09|0310|480|1|1|Linux 3.10.245 xhci-hcd|xHCI Host Controller|xhci-hcd.0.auto|0mA|e0|1|`);
const HEX=fs.readFileSync(path.join(__dirname,'fixtures/uvc-a108-2240.hex'),'utf8'),UVC=K.parseUvc(HEX);
const dev=(id,ifaces=[],more={})=>{const [vid,pid]=id.split(':');return {path:'1-1',vid,pid,class:'00',bcd:'0100',speed:480,serial:'',product:'',maker:'',interfaces:ifaces.map(s=>{const [c,sub,proto,driver='',...net]=s.split('/');return {class:c,sub,proto,driver,net};}),net:ifaces.flatMap(s=>s.split('/').slice(4)),...more};};
const CAM_IF=['0e/01/00/uvcvideo','0e/02/00/uvcvideo'],rowsOf=(list,c)=>K.classifyAll(list,c),usb=(list,c)=>Object.assign([],{devices:rowsOf(list,c)}),realRow=()=>rowsOf(REAL).find(r=>r.config==='webcam');
const section=(html,port)=>{const a=html.indexOf(`data-usb-port="${port}"`);if(a<0)return '';const b=html.indexOf('data-usb-port="',a+20);return html.slice(a,b<0?undefined:b);};

test('each honest state says what it is',()=>{
  assert.match(U.html(null),/data-usb-state="no-hub"/);assert.match(U.html(null),/No Control Hub connected/);
  assert.match(U.html([]),/data-usb-state="unread"/,'a hub, and its ports not read yet');
  const none=U.html(usb([]));assert.match(none,/data-usb-state="empty"/);assert.match(none,/charge-only cable/);assert.match(section(none,'usb3'),/Nothing plugged in/);assert.match(section(none,'usb2'),/Nothing plugged in/);
  assert.match(U.html(usb(REAL.filter(d=>d.path!=='1-1'))),/data-usb-state="empty"/,'what is inside the hub does not count');
});

test('the real hub: the camera says what it is and has a way to the Camera tab, and what is inside the hub never shows',()=>{
  const html=U.html(usb(REAL),[]),blue=section(html,'usb3');
  assert.match(blue,/data-usb-elsewhere="Ucamera001"/);assert.match(blue,/Webcam · UVC Camera<\/b>/);assert.match(blue,/Allowed if it has one lens: R707A, R708A/);assert.match(blue,/distance is wrong until the lens is measured/,'what it does');assert.match(blue,/data-usb-to-camera="Ucamera001"/);assert.doesNotMatch(blue,/data-usb-device=/,'its checks are in Camera');
  assert.doesNotMatch(html,/802\.11ac|USB2\.0 Hub|xHCI/);assert.match(section(html,'usb2'),/Nothing plugged in/);assert.doesNotMatch(html,/data-usb-state="empty"/);
  assert.doesNotMatch(html,/section="usbc"/);assert.equal(section(html,'usbc'),'','a port nobody can use is not offered');
});

test('a device on each port, with FIRST’s reason on the USB 2.0 one and the rule on the chip',()=>{
  const list=[dev('10c4:ea60',[],{path:'1-1',product:'CP2102N'}),dev('2341:0043',['02/02/01/cdc_acm'],{path:'3-1.4',product:'Uno'})],html=U.html(usb(list),[]),blue=section(html,'usb3'),two=section(html,'usb2');
  assert.match(blue,/HuskyLens, LiDAR adapter/);assert.match(blue,/Not on the manual’s USB list: R707, R702 Example 5/);assert.match(blue,/This may be a HuskyLens: it works on an I2C port, not USB\./);assert.match(blue,/data-usb-i2c="HuskyLens"/);assert.doesNotMatch(blue,/connect it by I2C|A HuskyLens on I2C is allowed/,'said once');assert.match(blue,/On the blue|data-usb-device="1-1"/);assert.doesNotMatch(blue,/Move this/);
  assert.match(two,/Arduino/);assert.match(two,/Move this to the blue USB 3\.0 port\. A static shock on the USB 2\.0 port can knock out the robot&#39;s Wi-Fi\./);assert.match(two,/Sensors go on the hub&#39;s own ports/);assert.match(two,/The manual’s R707 list of what may connect by USB does not include it\. Ask your inspector if you are not sure\./);assert.doesNotMatch(two,/before inspection/,'the manual does not say that');
  assert.match(two,/<details class="usb-facts" data-usb-facts="3-1\.4"><summary>/,'closed');assert.match(two,/2341:0043/);assert.doesNotMatch(two.slice(0,two.indexOf('<details')),/2341|cdc_acm/,'no IDs above the fold');
});

test('what is not allowed says what to do instead',()=>{
  const say=(d,re)=>assert.match(U.html(usb([d]),[]),re);
  say(dev('0471:13aa'),/goes in the computer, not the robot/);say(dev('0471:13aa'),/data-usb-axon/);say(dev('046d:c21d',[]),/Plug it into the Driver Hub/);say(dev('2207:0017'),/Not on the manual’s USB list: R707, R901/);say(dev('03e7:2485'),/rs-pill bad">Not allowed on the robot: R702 Example 6/);
  const row=rowsOf([dev('2341:0043')])[0];assert.deepEqual(U.steps(row),["Sensors go on the hub's own ports."],'the steps are things to do');
});

test('a row resting on an ID recalled rather than checked says so, and is not stated as fact; the manual is quoted only for what it says',()=>{
  for(const id of ['b1ac:f000','0a5c:2711','2e8a:0005','15d1:0000']){const html=U.html(usb([dev(id)]),[]);
    assert.match(html,/rs-pill warn">Probably not allowed: /,id);assert.doesNotMatch(html,/rs-pill bad/,id);assert.match(html,/may be something else/,id);assert.match(html,/If so, the manual’s R707 list of what may connect by USB does not include it/,id);assert.doesNotMatch(html,/before inspection/,id);}
  const depth=rowsOf([dev('045e:02ae',CAM_IF)])[0];assert.equal(depth.sure,false,'only that ID, in a row that has others');assert.equal(U.chipWords(depth.legal),'Probably not allowed');assert.equal(U.chipWords(rowsOf([dev('8086:0b07',CAM_IF)])[0].legal),'Not allowed on the robot','R708 names stereo cameras outright');
  const other=U.html(usb([dev('dead:beef',[],{product:'Thing'})]),[]);assert.match(other,/Unknown USB device: Thing/);assert.match(other,/rs-pill warn">Probably not allowed: R707, R708/,'it might be a vision device');assert.doesNotMatch(other,/R707 list/,'nobody can say it is not on the list');
  const prohibited=U.html(usb([dev('03e7:2485')]),[]);assert.doesNotMatch(prohibited,/R707 list/,'this row rests on R702');
});

test('the chip keeps a condition the row has: a webcam Torque cannot see the lenses of',()=>{
  assert.equal(U.chipWords(realRow().legal),'Allowed if it has one lens');assert.equal(realRow().id,'E4');
  assert.equal(U.chipWords(rowsOf([dev('046d:0825',CAM_IF)])[0].legal),'Allowed','a camera FTC knows has one lens');
  const splitter=U.html(usb([dev('05e3:0608',['09/00/00/hub'],{class:'09',maxChild:4})]),[]);assert.match(splitter,/rs-pill ok">Allowed: R707B, R611/);
});

test('when Torque has stopped scanning by itself, it says so once, and the raw key of a camera stays out of sight',()=>{
  const stuck=Object.assign([],{devices:rowsOf(REAL),stuck:'The Robot Controller app is not answering.'});assert.equal((U.html(stuck,[]).match(/data-usb-stuck/g)||[]).length,1);assert.doesNotMatch(U.html(usb(REAL),[]),/data-usb-stuck/);
  const blank=dev('046d:0825',CAM_IF,{path:'1-1',serial:'',product:''}),html=U.html(usb([blank]),[]);assert.match(html,/Webcam · Camera with no serial number<\/b>/);assert.doesNotMatch(html.replace(/data-usb-[a-z-]+="[^"]*"/g,''),/VendorProduct/);
});

test('a splitter shows what is behind it, on either half of the blue port and on the USB 2.0 port',()=>{
  const list=[dev('2109:2813',['09/00/00/hub'],{path:'1-1',paths:['1-1','2-1'],class:'09',maxChild:4,attributes:0xa0,maxPower:0}),dev('2341:0043',[],{path:'1-1.1',maxPower:100}),dev('046d:0825',CAM_IF,{path:'1-1.2',serial:'C270',product:'C270',maxPower:500}),dev('10c4:ea60',[],{path:'2-1.3'}),dev('05e3:0608',['09/00/00/hub'],{path:'3-1.4',class:'09',maxChild:4}),dev('2341:0043',[],{path:'3-1.4.2'})];
  const ports=U.layout(rowsOf(list));assert.equal(ports.usb3.length,1);assert.equal(ports.usb3[0].children.length,3,'the USB 3 half too');assert.equal(ports.usb2.length,1);assert.equal(ports.usb2[0].children.length,1,'not under the splitter inside the hub');
  const html=U.html(usb(list),[]),blue=section(html,'usb3');assert.match(blue,/Plugged into this splitter/);assert.match(blue,/3 of its 4 ports in use/);assert.match(blue,/Allowed: R707B, R611/);assert.match(blue,/data-usb-elsewhere="C270"/,'the camera’s one line is under the splitter');assert.match(blue,/asks for 600 mA/,'what is plugged in asks for');assert.match(blue,/no power of its own/);
  assert.match(U.html(usb(list.slice(4)),[]),/Move this to the blue/);
});

test('an Expansion Hub shows Scan and its address, and a look-alike does not',()=>{
  const d=dev('0403:6015',[],{bcd:'1000',serial:'DQ1'}),found=U.html(usb([d],{scan:{portals:[{serial:'DQ1',modules:[{address:2}]}],others:[]}}),[]);assert.match(found,/Expansion Hub on USB/);assert.match(found,/Allowed: R707C, R701C/);assert.match(found,/Scan found it/);assert.match(found,/answers at address 2/);assert.match(found,/<ol class="cal-steps"><li>Secure the Mini-USB plug/);
  assert.match(U.html(usb([d],{scan:{portals:[],others:[]}}),[]),/FTDI serial cable/);assert.match(U.html(usb([d]),[]),/rs-pill">Checking/,'until Scan has answered');
});

test('drops: counted per device, the Wi-Fi chip as one line that says may, and what left is still counted',()=>{
  const d=dev('05e3:0608',['09/00/00/hub'],{path:'1-1',class:'09',maxChild:4}),drop=(p,kind='disconnect',wifi=false)=>({at:1,path:p,kind,wifi,text:''}),html=U.html(usb([d]),[drop('1-1'),drop('1-1'),drop('1-1','error'),drop('3-1.1','disconnect',true),drop('3-1.4')]);
  assert.match(html,/Came unplugged 2 times since the hub started\./);assert.match(html,/Would not start 1 time/);assert.match(html,/data-usb-wifi>The hub’s own Wi-Fi chip dropped off USB 1 time since the hub started\. That may mean a static shock\./);
  assert.match(section(html,'usb2'),/came unplugged from this port 1 time/);
  assert.doesNotMatch(U.html(usb([d]),[]),/data-usb-wifi/);assert.match(U.html(usb([d]),[]),/Has not come unplugged/);assert.match(U.html(usb([d]),null),/cannot read how often/,'not available');assert.match(U.html(usb([d])),/Reading how often/,'not read yet');
  assert.deepEqual(U.dropCounts([drop('1-1'),drop('1-1','address'),drop('3-1.1','disconnect',true)]),{byPath:{'1-1':{unplugged:1,failed:1}},wifi:1});
});

const check=(list,code)=>list.filter(c=>c.code===code);
test('the real camera’s checks',()=>{
  const list=Cam.cameraChecks({row:realRow(),uvc:UVC,drops:[]}),text=list.map(c=>c.text).join('\n');
  assert.deepEqual(check(list,'PORT').map(c=>[c.state,c.text]),[['ok','On the blue USB 3.0 port.']]);assert.equal(check(list,'SPEED')[0].text,'Connected at 480 Mb/s.');assert.equal(check(list,'SERIAL')[0].text,'Serial number Ucamera001.');
  const sizes=check(list,'MODES');assert.match(sizes[0].text,/640x480 and 640x360 in YUY2 or MJPEG; 1920x1080, 1280x720 and 800x600 in MJPEG only\. Up to 30 frames a second\./);assert.equal(sizes[1].state,'warn');assert.match(sizes[1].text,/only in MJPEG.*\.setStreamFormat\(VisionPortal\.StreamFormat\.MJPEG\)/);assert.doesNotMatch(text,/H\.?264/,'the SDK cannot ask for it');assert.equal(sizes.length,2);
  const c=check(list,'CTRL')[0];assert.match(c.text,/^This camera has no gain control and no white balance control\./);assert.match(c.text,/does not prove it works/);assert.match(c.text,/Focus/);assert.equal((text.match(/no gain control/g)||[]).length,1,'said once');
  assert.match(check(list,'LENS')[0].text,/^Distance will be wrong until the lens is measured\..*fx=578\.272/);assert.equal(check(list,'LENS')[0].state,'warn');assert.equal(check(list,'DROPS')[0].state,'ok');assert.equal((text.match(/R708/g)||[]).length,1);assert.match(check(list,'R708')[0].text,/microphone or buttons/);
  assert.deepEqual(Cam.controlsOf(UVC),{list:Cam.controlsOf(UVC).list,exposure:true,gain:false,whiteBalance:false});assert.equal(Cam.controlsOf(null),null);assert.equal(Cam.controlsOf({camera:[],processing:[]}),null,'descriptors that say nothing hide nothing');
});

test('while a read has not answered, or cannot be made, a check says so',()=>{
  const row=realRow(),reading=Cam.cameraChecks({row,uvc:undefined}),gone=Cam.cameraChecks({row,uvc:null,drops:null});
  assert.match(check(reading,'MODES')[0].text,/Reading/);assert.match(check(reading,'CTRL')[0].text,/Reading/);assert.match(check(reading,'DROPS')[0].text,/Reading/);
  for(const code of ['MODES','CTRL','DROPS'])assert.equal(check(gone,code)[0].state,'na',code);assert.equal(check(gone,'PORT')[0].state,'ok','what needs no read still answers');
});

test('port, speed and serial problems',()=>{
  const cam=(more,id='a108:2240')=>dev(id,CAM_IF,{serial:'A',...more}),one=(d,all=[d])=>Cam.cameraChecks({row:rowsOf(all).find(r=>r.device===d),uvc:UVC,drops:[]});
  assert.match(check(one(cam({path:'3-1.4'})),'PORT')[0].text,/^Move this to the blue USB 3\.0 port\./);assert.equal(check(one(cam({path:'9-9'})),'PORT')[0].state,'na');
  const slow=check(one(cam({speed:12})),'SPEED')[0];assert.equal(slow.state,'warn');assert.match(slow.text,/12 Mb\/s\. That is probably a bad cable or adapter/);
  const twin=[cam({path:'1-1.1'}),cam({path:'1-1.2'})];assert.match(check(one(twin[0],twin),'SERIAL')[0].text,/share one serial number, so the robot can only use one/);assert.doesNotMatch(check(one(twin[0],twin),'SERIAL')[0].text,/Arducam/,'the tool only where FIRST names it');
  const ardu=[cam({path:'1-1.1'},'0c45:6366'),cam({path:'1-1.2'},'0c45:6366')];assert.match(check(one(ardu[0],ardu),'SERIAL')[0].text,/Arducam Serial Number Tool/);
  const none=[cam({path:'1-1.1',serial:''}),cam({path:'1-1.2',serial:''},'046d:0825')];assert.match(check(one(none[0],none),'SERIAL')[0].text,/tied to the port/);assert.match(check(one(cam({serial:''})),'SERIAL')[0].text,/no serial number of its own/);assert.match(check(one(cam({serial:'200901010001'})),'SERIAL')[0].text,/no serial number of its own/,'the one value the SDK refuses');
});

test('the lens wording, for a camera FTC knows, one at the wrong shape and one it does not',()=>{
  const exact=Cam.lensLine('046d','0825','640x480');assert.equal(exact.state,'ok');assert.match(exact.text,/^FTC has lens data for this model at 640x480 \(Logitech C270\)\./);assert.match(exact.text,/USB ID names its USB chip, not your exact lens/);
  const shape=Cam.lensLine('046d','0825','1280x720');assert.equal(shape.state,'warn');assert.match(shape.text,/pick one of these sizes: 640x480\./);assert.match(shape.text,/fx=578\.272/);
  const scaled=Cam.lensLine('046d','0825','320x240');assert.equal(scaled.state,'ok');assert.match(scaled.text,/at 640x480 \(Logitech C270\), and scales it to 320x240/);
  const unknown=Cam.lensLine('a108','2240','640x480');assert.equal(unknown.state,'warn');assert.match(unknown.text,/^Distance will be wrong until the lens is measured\. With no lens data the robot software silently assumes a focal length of 578\.272 pixels/);
  assert.match(Cam.lensLine('a108','2240','640x480',{fx:800}).text,/You measured this camera at 640x480/);
});

test('one tag: range is proportional to focal length, and the sanity checks store nothing',()=>{
  const seen=(r,more={})=>Array.from({length:8},(_,i)=>({r:r+(i%2?.05:-.05),b:0,y:0,p:0,...more})),one=o=>Cam.lensFromReadings({measured:48,fxCurrent:578.272,readings:seen(48*578.272/822),...o});
  const ok=one();assert.equal(ok.ok,true);assert.ok(Math.abs(ok.fx-822)<.5,`fx ${ok.fx}`);assert.equal(ok.fy,ok.fx);assert.equal(ok.cx,320);assert.equal(ok.cy,240);assert.ok(Math.abs(ok.ratio-822/578.272)<.01);assert.equal(ok.readings,8);
  const again=Cam.lensFromReadings({measured:48,fxCurrent:ok.fx,readings:seen(48)});assert.ok(Math.abs(again.fx-ok.fx)<1,'measuring again with the right lens changes little');
  assert.equal(Cam.intrinsics({fx:822.5,fy:822.5,cx:320,cy:240}),'.setLensIntrinsics(822.5, 822.5, 320, 240)');
  assert.match(one({measured:NaN}).text,/Type the distance/);assert.match(one({readings:[]}).text,/did not see a tag/);assert.match(one({readings:seen(30).slice(0,2)}).text,/only 2 times/);assert.match(one({readings:[],many:12}).text,/More than one tag/);
  for(const key of ['y','p','b']){const bad=one({readings:seen(34,{[key]:40})});assert.equal(bad.ok,false,key);assert.match(bad.text,/about 40° off square.*Nothing was stored/);}assert.equal(one({readings:seen(34,{y:10})}).ok,true,'a little off is fine');
  assert.match(one({readings:[20,30,40,20,30,40].map(r=>({r}))}).text,/moved too much/);
  const wild=one({measured:500});assert.equal(wild.ok,false);assert.match(wild.text,/too far apart.*the ratio is 14\.\d+, and it should be between 0\.5 and 2.*Nothing was stored/);assert.equal(one({measured:10}).ok,false,'too small a ratio too');
  assert.equal(Cam.parseInches('24'),24);assert.equal(Cam.parseInches(' 24.5 in'),24.5);assert.equal(Cam.parseInches('24"'),24);assert.ok(Number.isNaN(Cam.parseInches('')));assert.ok(Number.isNaN(Cam.parseInches('two feet')));assert.ok(Number.isNaN(Cam.parseInches('0')));
  assert.equal(Cam.lensKey('Ucamera001'),'Ucamera001');assert.equal(Cam.lensKey('VendorProduct:vendor=0x046d|product=0x0825|connection=1-1'),Cam.lensKey('VendorProduct:vendor=0x046d|product=0x0825|connection='),'whichever port it is in');assert.match(Cam.lensKey('VendorProduct:vendor=0x046d|product=0x0825|connection='),/^[\w.:-]{1,80}$/,'a key saved calibrations keep');
});

test('Limelight: its status, and which calibration it runs on, from what it answers',()=>{
  assert.deepEqual(Cam.limeStatus({status:{name:'a'}}),{name:'a'},'readLimelight');assert.deepEqual(Cam.limeStatus({ok:true,status:200,json:{name:'b'}}),{name:'b'},'a path');assert.equal(Cam.limeStatus({status:null}),null);assert.equal(Cam.limeStatus(null),null);
  const yes=json=>({ok:true,status:200,json}),no={ok:false,status:404,json:null},def={fx:1};
  assert.deepEqual(Cam.limeCal({file:yes({fx:2}),def:yes(def),stats:yes({reprojectionError:.52})}),{state:'custom',error:.52});assert.deepEqual(Cam.limeCal({eeprom:yes({fx:2}),latest:yes({a:{rms_px:1.4}})}),{state:'custom',error:1.4},'looks a level down');
  assert.deepEqual(Cam.limeCal({file:yes(def),def:yes(def)}),{state:'default',error:null},'the same as the default is not custom');assert.deepEqual(Cam.limeCal({file:no,eeprom:no,def:yes(def)}),{state:'default',error:null});assert.equal(Cam.limeCal({}).state,'unknown');
  assert.match(Cam.limeCalText({state:'custom',error:.52}).text,/custom calibration is active.*0\.52 pixels, which is good: under 1 is good, and 0\.3 to 0\.8 is typical/);assert.equal(Cam.limeCalText({state:'custom',error:1.4}).state,'warn');assert.match(Cam.limeCalText({state:'custom',error:null}).text,/could not read/);assert.match(Cam.limeCalText({state:'default'}).text,/default calibration/);assert.equal(Cam.limeCalText(null).state,'na');
});

test('Camera lists a Limelight on its own, and a camera however its port is written',()=>{
  const lime={config:'limelight',scanKey:'EthernetOverUsb:eth0:172.29.0.23',limelight:{address:'172.29.0.1'}};
  assert.deepEqual(Cam.choices([],[],[],[lime]).map(o=>[o.value,o.state,o.label]),[['limelight:EthernetOverUsb:eth0:172.29.0.23','limelight','Limelight · 172.29.0.1']],'no simulated webcam in its place');
  const key='VendorProduct:vendor=0x046d|product=0x0825|connection=',own=[{name:'Webcam 1',serial:`${key}1-1`}];assert.deepEqual(Cam.choices([],own,[{serial:key,type:'WEBCAM'}]).map(o=>[o.state,o.absent]),[['configured',false]]);
  assert.equal(Cam.javaLines({exposure:5,gain:null,decimation:3}).includes('GainControl'),false,'no gain line for a camera with no gain');
});
