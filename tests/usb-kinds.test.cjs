'use strict';
// What a device on a Control Hub's USB ports is: research_notes/Control Hub USB devices/usb-rules.md sections 2, 4 and 7.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const K=require('../ui/ftc/usb-kinds.js'),{parseUsb}=require('../src/hub-usb.cjs');
// The real answer of FTC-zWL4, with a generic webcam in the blue port.
const REAL=`1-1|a108|2240|ef|0090|480|1|2|HHYL|UVC Camera|Ucamera001|200mA|c0|0|0e/01/00/uvcvideo,0e/02/00/uvcvideo,03/00/00/usbhid,01/01/00/snd-usb-audio,01/02/00/snd-usb-audio,
3-1|05e3|0608|09|8538|480|3|2||USB2.0 Hub||100mA|e0|4|09/00/00/hub,
3-1.1|0bda|c820|ef|0200|480|3|3|Realtek|802.11ac NIC|123456|500mA|a0|0|e0/01/01/rtk_btusb,e0/01/01/rtk_btusb,ff/ff/ff/rtl8821cu,
usb1|1d6b|0002|09|0310|480|1|1|Linux 3.10.245 xhci-hcd|xHCI Host Controller|xhci-hcd.0.auto|0mA|e0|1|`;
// A device: "vid:pid", then interfaces as class/sub/proto[/driver[/net]], then anything else. In the blue port unless it says.
const dev=(id,ifaces=[],more={})=>{const [vid,pid]=id.split(':');return {path:'1-1',vid,pid,class:'00',bcd:'0100',speed:480,serial:'',product:'',maker:'',interfaces:ifaces.map(s=>{const [c,sub,proto,driver='',...net]=s.split('/');return {class:c,sub,proto,driver,net};}),...more};};
const CAM=['0e/01/00/uvcvideo','0e/02/00/uvcvideo'],ETH=['02/06/00/cdc_ether/eth0','0a/00/00/cdc_ether'],LIME={iface:'eth0',hubAddress:'172.29.0.23',address:'172.29.0.1',scanKey:'EthernetOverUsb:eth0:172.29.0.23',status:{name:'limelight',hwType:'unknown'}},NO_LIME={status:null};
const PORTAL={serial:'DQ123',modules:[{address:2,parent:true,imu:'NONE'}]};
const SCANNED={scan:{portals:[PORTAL],others:[]}},NOTHING={scan:{portals:[],others:[]},limelight:NO_LIME};
const id=(d,c=NOTHING)=>K.classify(d,c).id;

// Every row of the table, with one example it must catch.
const ROWS=[
  ['A1',dev('1d6b:0002',[],{path:'usb1',class:'09'})],
  ['A2',dev('05e3:0608',['09/00/00/hub'],{path:'3-1',class:'09'})],
  ['A3',dev('0bda:c820',['e0/01/01/rtk_btusb','ff/ff/ff/rtl8821cu'],{path:'3-1.1'})],
  ['B1',dev('0403:6015',[],{bcd:'1000',serial:'DQ123'}),SCANNED],
  ['B2',dev('2207:0017')],['B2',dev('1234:5678',[],{product:'Driver Hub'})],
  ['B3',dev('2207:0011')],['B3',dev('1234:5678',[],{product:'Control Hub v1.0'})],
  ['B4',dev('2207:0006')],
  ['B5',dev('0483:a30e')],['B5',dev('0483:a3b1')],
  ['B6',dev('0403:6001',[],{bcd:'0600'})],
  ['B7',dev('0471:13aa')],['B7',dev('0473:13aa')],
  ['I1',dev('18d1:4ee7',['ff/42/01/'])],['I1',dev('04e8:6860',['06/01/01/'])],
  ['C1',dev('8086:0b07',CAM)],['C1',dev('2b03:f582',CAM)],['C1',dev('2bc5:0401',CAM)],['C1',dev('045e:02ae')],
  ['C2',dev('03e7:2485')],['C3',dev('1209:abd1')],['C4',dev('b1ac:f000')],
  ['C5',dev('1a6e:089a')],['C5',dev('18d1:9302')],['C6',dev('0955:7020')],['C7',dev('0a5c:2711')],
  ['D1',dev('2341:0043')],['D1',dev('2a03:0043')],['D2',dev('16c0:0483')],['D3',dev('303a:1001')],['D3',dev('2e8a:0005')],['D3',dev('239a:80f4')],
  ['D4',dev('0483:374b')],['D4',dev('0483:df11')],['D5',dev('10c4:ea60')],['D6',dev('1a86:7523')],['D6',dev('1a86:55d4')],
  ['D7',dev('0403:6014')],['D7',dev('0403:6015',[],{bcd:'1000',serial:'XX'})],['D8',dev('067b:2303')],['D9',dev('15d1:0000')],
  ['E1',dev('046d:0825',CAM)],['E1',dev('0bda:5805',CAM)],['E2',dev('0c45:6366',CAM)],['E3',dev('046d:0843',CAM)],['E3',dev('045e:0772',CAM)],['E4',dev('a108:2240',CAM)],
  ['F1',dev('1a40:0101',['09/00/00/hub'],{class:'09'})],
  ['G1',dev('1d6b:0104',ETH),{limelight:LIME}],
  ['G2',dev('1d6b:0104',ETH),{limelight:{...LIME,status:{hwType:'Limelight3G'}}}],
  ['H1',dev('0bda:c820',['e0/01/01/rtk_btusb','ff/ff/ff/rtl8821cu'],{path:'3-1.4'})],['H1',dev('148f:7601',['ff/ff/ff/x/wlan1'])],
  ['H2',dev('0a12:0001',['e0/01/01/'])],
  ['H3',dev('12d1:1506',['ff/01/01/option'])],['H3',dev('1199:9071',['ff/ff/ff/qmi_wwan'])],
  ['G3',dev('0b95:772b',['ff/ff/00/asix/eth0'])],['G3',dev('1d6b:0104',['e0/01/03/rndis_host'])],['G3',dev('0525:a4a2')],['G3',dev('1234:5678',['ff/00/00//eth1'])],
  ['J1',dev('046d:c21d',['ff/5d/01/'])],['J1',dev('1234:5678',['ff/5d/01/xpad'])],['J2',dev('046a:0011',['03/01/01/usbhid'])],['J2',dev('046d:c077',['03/01/02/usbhid'])],['J3',dev('1234:5678',['03/00/00/usbhid'])],
  ['K1',dev('0781:5567',['08/06/50/usb-storage'])],['L1',dev('0d8c:0014',['01/01/00/snd-usb-audio','01/02/00/snd-usb-audio'])],
  ['M1',dev('2672:0047')],['M1',dev('04a9:32b4',['06/01/01/'])],
  ['Z1',dev('dead:beef',['ff/ff/ff/'])],
];
test('every row of the table catches its example, and no row is left without one',()=>{
  for(const [want,d,c] of ROWS)assert.equal(id(d,c||NOTHING),want,`${want}: ${d.vid}:${d.pid}`);
  assert.deepEqual([...new Set(ROWS.map(r=>r[0]))].sort(),K.rows.map(r=>r.id).sort());
});
test('the rows stay in the order of the table, since first match wins',()=>{
  assert.deepEqual(K.rows.map(r=>r.id).join(' '),'A1 A2 A3 B1 B2 B3 B4 B5 B6 B7 I1 C1 C2 C3 C4 C5 C6 C7 D1 D2 D3 D4 D5 D6 D7 D8 D9 E1 E2 E3 E4 F1 G1 G2 H1 H2 H3 G3 J1 J2 J3 K1 L1 M1 Z1');
});

test('the real hub: the webcam shows; its Wi-Fi, its splitter and the root hubs stay hidden',()=>{
  const kinds=K.classifyAll(parseUsb(REAL),{});
  assert.deepEqual(kinds.map(k=>[k.device.path,k.id,k.hidden]),[['1-1','E4',false],['3-1','A2',true],['3-1.1','A3',true],['usb1','A1',true]]);
  const c=kinds[0];assert.equal(c.name,'Webcam (needs its lens measured)');assert.equal(c.config,'webcam');assert.equal(c.scanKey,'Ucamera001');assert.equal(c.port,'usb3');assert.equal(c.legal.ok,true);assert.deepEqual(c.warnings,[]);
  assert.match(c.detail,/UVC Camera/);assert.match(c.detail,/a108:2240/);
});

test('order traps',()=>{
  // A RealSense reports as a webcam to Scan. It is a stereo camera first.
  const rs=dev('8086:0b07',CAM,{serial:'R1'}),rsk=K.classify(rs,{scan:{portals:[],others:[{serial:'R1',type:'WEBCAM'}]},limelight:NO_LIME});
  assert.equal(rsk.id,'C1');assert.equal(rsk.legal.ok,false);assert.equal(rsk.config,null);assert.ok(rsk.warnings.some(w=>w.code==='SCAN'));
  // An FT230X that answers no discovery is a cable, not an Expansion Hub, even though Scan calls it LYNX_USB_DEVICE.
  const ftx=dev('0403:6015',[],{bcd:'1000',serial:'XX'}),cable=K.classify(ftx,{scan:{portals:[PORTAL],others:[]}});assert.equal(cable.id,'D7');assert.equal(cable.name,'FTDI serial cable');assert.equal(cable.config,null);assert.equal(cable.legal.ok,false);
  // Only the FT-X chip's own bcdDevice counts as a possible Expansion Hub.
  assert.equal(id(dev('0403:6015',[],{bcd:'0600',serial:'DQ123'}),SCANNED),'D7');
  const hub=K.classify(dev('0403:6015',[],{bcd:'1000',serial:'DQ123'}),SCANNED);assert.equal(hub.config,'hub');assert.equal(hub.legal.ok,true);assert.deepEqual(hub.portal,PORTAL);
  // An ordinary FT232R and a Modern Robotics module look alike; another bcdDevice is only a cable.
  assert.equal(id(dev('0403:6001',[],{bcd:'0600'})),'B6');assert.equal(id(dev('0403:6001',[],{bcd:'0800'})),'D7');
  // A CP210x stays a guess: nothing tells a HuskyLens from a LiDAR adapter.
  const cp=K.classify(dev('10c4:ea60'),NOTHING);assert.match(cp.name,/HuskyLens/);assert.match(cp.name,/LiDAR/);assert.equal(cp.config,null);assert.match(cp.can,/no driver/);
  // A webcam's microphone and buttons do not make it a sound or control device.
  assert.equal(id(dev('a108:2240',[...CAM,'03/00/00/usbhid','01/01/00/snd-usb-audio'])),'E4');
  // The hub's Wi-Fi chip anywhere else is a Wi-Fi dongle; a combined dongle counts as Wi-Fi before Bluetooth.
  assert.equal(id(dev('0bda:c820',['e0/01/01/rtk_btusb','ff/ff/ff/rtl8821cu'],{path:'3-1.1'})),'A3');
  assert.equal(id(dev('0bda:c820',['e0/01/01/rtk_btusb','ff/ff/ff/rtl8821cu'],{path:'1-1'})),'H1');
  // Android and Rockchip devices are named before a phone's own interfaces.
  assert.equal(id(dev('2207:0017',['ff/42/01/'])),'B2');
  // A phone in photo mode is a phone; another maker's is a camera.
  assert.equal(id(dev('04e8:6860',['06/01/01/'])),'I1');assert.equal(id(dev('04a9:32b4',['06/01/01/'])),'M1');
  // RNDIS is a network device; a Bluetooth interface is not.
  assert.equal(id(dev('1234:5678',['e0/01/03/rndis_host'])),'G3');assert.equal(id(dev('1234:5678',['e0/01/01/'])),'H2');
});

test('a Limelight is decided by its answer, not by Scan or by having eth0',()=>{
  const d=dev('1d6b:0104',ETH),scan={portals:[],others:[{serial:'EthernetOverUsb:eth0:172.29.0.23',type:'ETHERNET_DEVICE'}]};
  // Scan offers it, and nothing answered: a plain network adapter, with a warning.
  const plain=K.classify(d,{scan,limelight:NO_LIME});assert.equal(plain.id,'G3');assert.equal(plain.config,null);assert.equal(plain.legal.ok,false);assert.match(plain.warnings.find(w=>w.code==='SCAN').text,/as if it were a Limelight/);
  // Answered as a Limelight, on that interface.
  const real=K.classify(d,{scan,limelight:LIME});assert.equal(real.id,'G1');assert.equal(real.config,'limelight');assert.equal(real.scanKey,LIME.scanKey);assert.equal(real.limelight.address,'172.29.0.1');assert.equal(real.scanned,true);assert.match(real.legal.text,/3A/);assert.match(real.legal.text,/3G/);
  // Something else answered: another interface's Limelight is not this device.
  assert.equal(K.classify(dev('0b95:772b',['ff/ff/00/asix/eth1']),{limelight:LIME}).id,'G3');
  assert.equal(K.classify(dev('0781:5567',['08/06/50/usb-storage']),{limelight:LIME}).id,'K1');
  // The old name of the scan value means nothing.
  assert.equal(K.classify(d,{scan:{portals:[],others:[{serial:'EthernetOverUsb:eth0:172.29.0.23',type:'ETHERNET_OVER_USB_DEVICE'}]},limelight:NO_LIME}).warnings.length,0);
  // A 3G is known only if it says so: its values are unpublished, and any other hwType stays with the 3A row's words.
  assert.equal(K.classify(d,{limelight:{...LIME,status:{hwType:'3G'}}}).id,'G2');assert.equal(K.classify(d,{limelight:{...LIME,status:{hwType:7}}}).id,'G1');
});

test('while a check has not answered it says it is checking, and gives no verdict',()=>{
  const ftx=K.classify(dev('0403:6015',[],{bcd:'1000',serial:'DQ123'}),{});assert.equal(ftx.id,'B1');assert.equal(ftx.pending,true);assert.equal(ftx.legal.ok,null);assert.equal(ftx.config,null);assert.equal(ftx.name,'Expansion Hub or serial cable');
  const net=K.classify(dev('1d6b:0104',ETH),{});assert.equal(net.id,'G1');assert.equal(net.pending,true);assert.equal(net.legal.ok,null);assert.equal(net.config,null);
  assert.equal(K.classify(dev('1d6b:0104',['e0/01/03/rndis_host']),{}).pending,true);
  // Not for anything else.
  assert.equal(K.classify(dev('a108:2240',CAM),{}).pending,false);assert.equal(K.classify(dev('dead:beef'),{}).pending,false);
});

test('rows remembered rather than checked keep their label and the table\'s words, marked not sure',()=>{
  for(const d of [dev('b1ac:f000'),dev('0a5c:2711'),dev('303a:1001'),dev('15d1:0000'),dev('045e:02ae')]){const k=K.classify(d,NOTHING);assert.equal(k.sure,false,k.id);assert.equal(k.legal.sure,false,k.id);assert.ok(k.name,k.id);}
  // C1 by its checked vendors is sure.
  const rs=K.classify(dev('8086:0b07',CAM),NOTHING);assert.equal(rs.sure,true);assert.equal(rs.legal.sure,true);
  assert.equal(K.classify(dev('a108:2240',CAM),NOTHING).sure,true);
});

test('what can go in a robot configuration',()=>{
  const config=(d,c=NOTHING)=>K.classify(d,c).config;
  for(const d of [dev('046d:0825',CAM),dev('0c45:6366',CAM),dev('046d:0843',CAM),dev('a108:2240',CAM)])assert.equal(config(d),'webcam');
  assert.equal(config(dev('0403:6015',[],{bcd:'1000',serial:'DQ123'}),SCANNED),'hub');assert.equal(config(dev('1d6b:0104',ETH),{limelight:LIME}),'limelight');
  for(const [,d,c] of ROWS.filter(([x])=>!['E1','E2','E3','E4','B1','G1'].includes(x)))assert.equal(config(d,c||NOTHING),null,`${d.vid}:${d.pid}`);
});

test('a camera\'s Scan key: its serial, or the one the SDK makes up',()=>{
  assert.equal(K.scanKey(dev('a108:2240',CAM,{serial:'Ucamera001'})),'Ucamera001');
  assert.equal(K.scanKey(dev('046d:0825',CAM)),'VendorProduct:vendor=0x046d|product=0x0825|connection=');
  assert.equal(K.scanKey(dev('046d:0825',CAM,{serial:'200901010001'})),'VendorProduct:vendor=0x046d|product=0x0825|connection=');
  const scan=key=>({scan:{portals:[],others:[{serial:key,type:'WEBCAM'}]}});
  assert.equal(K.classify(dev('a108:2240',CAM,{serial:'Ucamera001'}),scan('Ucamera001')).scanned,true);
  assert.equal(K.classify(dev('046d:0825',CAM),scan('VendorProduct:vendor=0x046d|product=0x0825|connection=1-1')).scanned,true);
  assert.equal(K.classify(dev('a108:2240',CAM,{serial:'Ucamera001'}),scan('Other')).scanned,false);
});

test('warnings about the socket, the speed, and two of a kind',()=>{
  const usb2=K.classify(dev('a108:2240',CAM,{path:'3-1.4'}),NOTHING);assert.equal(usb2.port,'usb2');assert.equal(usb2.warnings[0].code,'PORT');assert.match(usb2.warnings[0].text,/blue USB 3\.0 port/);assert.match(usb2.warnings[0].text,/Wi-Fi/);
  assert.equal(K.classify(dev('a108:2240',CAM),NOTHING).warnings.length,0);
  assert.equal(K.classify(dev('a108:2240',CAM,{speed:12}),NOTHING).warnings[0].code,'SPEED');
  assert.equal(K.classify(dev('0781:5567',['08/06/50/usb-storage'],{speed:12}),NOTHING).warnings.length,0);
  // The hub's own parts never warn.
  assert.equal(K.classify(dev('0bda:c820',['ff/ff/ff/rtl8821cu'],{path:'3-1.1'}),NOTHING).warnings.length,0);
  const codes=list=>K.classifyAll(list,NOTHING).map(k=>k.warnings.map(w=>w.code));
  assert.deepEqual(codes([dev('a108:2240',CAM,{serial:'Ucamera001'}),dev('a108:2240',CAM,{serial:'Ucamera001',path:'3-1.4'})]),[['SERIAL'],['PORT','SERIAL']]);
  assert.deepEqual(codes([dev('046d:0825',CAM),dev('046d:0825',CAM,{path:'3-1.4'})]),[['SERIAL'],['PORT','SERIAL']]);
  assert.deepEqual(codes([dev('046d:0825',CAM),dev('a108:2240',CAM,{serial:'Ucamera001'})]),[[],[]]);
  assert.deepEqual(codes([dev('0c45:6366',CAM,{serial:'A'}),dev('0c45:6366',CAM,{serial:'B'})]),[['E2'],['E2']]);
});

test('a student reads names and sentences, not the tools behind them',()=>{
  const words=/\b(sysfs|vid|pid|adb|bcdDevice|uvcvideo|lsusb|dmesg)\b/i,says=k=>[k.name,k.can,k.explain,k.legal.text,...k.warnings.map(w=>w.text)].join(' ');
  for(const [,d,c] of ROWS){const k=K.classify(d,c||NOTHING);assert.doesNotMatch(says(k),words,k.id);if(!k.hidden){assert.ok(k.name&&k.can,k.id);assert.ok(k.legal.text,k.id);}}
  for(const w of [K.classify(dev('0403:6015',[],{bcd:'1000'}),{}),K.classify(dev('1d6b:0104',ETH),{}),K.classify(dev('a108:2240',CAM,{path:'3-1.4',speed:12}),NOTHING)])assert.doesNotMatch(says(w),words);
  assert.equal(K.classify(dev('dead:beef',[],{maker:'Acme',product:'Thing'}),NOTHING).name,'Unknown USB device: Acme Thing');assert.equal(K.classify(dev('dead:beef'),NOTHING).name,'Unknown USB device');
  assert.match(K.classify(dev('dead:beef'),NOTHING).detail,/dead:beef/);
});

test('which socket a device is in',()=>{
  for(const [p,want] of [['usb1','root'],['usb5','root'],['3-1','inside'],['3-1.1','inside'],['1-1','usb3'],['2-1','usb3'],['1-1.3','usb3'],['2-1.2.4','usb3'],['3-1.4','usb2'],['3-1.2','usb2'],['3-1.4.2','usb2'],['5-1','usbc'],['4-1','unknown'],['1-2','unknown'],['','unknown']])assert.equal(K.portOf(p),want,p);
});

// ---- UVC
const hex=()=>fs.readFileSync(path.join(__dirname,'fixtures/uvc-a108-2240.hex'),'utf8');
const RATES=[30,25,20,15,10,7,5];
test('the real a108:2240 camera, from its own descriptors',()=>{
  const u=K.parseUvc(hex());assert.equal(u.uvc,'1.10');
  assert.deepEqual(u.camera,['Auto-exposure mode','Exposure time (absolute)','Focus (absolute)','Zoom (absolute)','Focus auto']);
  assert.deepEqual(u.processing,['Brightness','Contrast','Hue','Saturation','Sharpness','Backlight compensation','Power line frequency']);
  assert.ok(!u.processing.includes('Gain')&&!u.processing.some(x=>/White balance/.test(x)));
  const of=f=>u.modes.filter(m=>m.format===f).map(m=>`${m.width}x${m.height}`);
  assert.deepEqual(of('MJPEG'),['1920x1080','1280x720','800x600','640x480','640x360']);assert.deepEqual(of('YUY2'),['640x480','640x360']);assert.deepEqual(of('H264'),['1920x1080','1280x720','800x600','640x480','640x360']);
  for(const m of u.modes)assert.deepEqual(m.fps,RATES,`${m.format} ${m.width}x${m.height}`);
  // Its line breaks and upper or lower case mean nothing.
  assert.deepEqual(K.parseUvc(hex().toUpperCase().replace(/(.{60})/g,'$1\n')),u);
});
const bytes=(...list)=>list.flat().map(v=>v.toString(16).padStart(2,'0')).join('');
const u16le=v=>[v&255,v>>8&255],u32le=v=>[v&255,v>>8&255,v>>16&255,v>>>24&255];
const INTERFACE=(cls,sub)=>[9,4,0,0,0,cls,sub,0,0];
const FRAME_BASED_FORMAT=[28,0x24,0x10,1,1,0x48,0x32,0x36,0x34,...Array(19).fill(0)];
test('a frame-based frame keeps its intervals at another offset',()=>{
  // bFrameIntervalType at byte 21 and dwBytesPerLine at 22 to 25: this last must not be read as the count.
  const frame=[34,0x24,0x11,1,0,...u16le(1280),...u16le(720),...u32le(1),...u32le(2),...u32le(333333),2,...u32le(0x05050505),...u32le(333333),...u32le(666666)];
  const u=K.parseUvc(bytes(INTERFACE(0x0e,2),FRAME_BASED_FORMAT,frame));
  assert.deepEqual(u.modes,[{format:'H264',width:1280,height:720,fps:[30,15]}]);
});
test('a continuous range of frame rates gives its two ends',()=>{
  const frame=[38,0x24,0x07,1,0,...u16le(640),...u16le(480),...u32le(1),...u32le(2),...u32le(1),...u32le(333333),0,...u32le(333333),...u32le(1000000),...u32le(1)];
  const u=K.parseUvc(bytes(INTERFACE(0x0e,2),[11,0x24,0x06,1,1,0,0,0,0,0,0],frame));
  assert.deepEqual(u.modes,[{format:'MJPEG',width:640,height:480,fps:[30,10],continuous:true}]);
});
test('audio descriptors share the same type and subtypes, and are not read as a camera',()=>{
  // An audio class input terminal and a mixer unit look like a camera terminal and a processing unit.
  const fake=[18,0x24,0x02,1,...u16le(0x0201),0,0,...Array(7).fill(0),3,0xff,0xff,0xff],unit=[11,0x24,0x05,2,1,0,0,2,0xff,0xff,0];
  assert.deepEqual(K.parseUvc(bytes(INTERFACE(1,1),fake,unit)),{modes:[],camera:[],processing:[],uvc:null});
  // A terminal that is not a camera has no camera controls.
  assert.deepEqual(K.parseUvc(bytes(INTERFACE(0x0e,1),[18,0x24,0x02,1,...u16le(0x0202),0,0,...Array(7).fill(0),3,0xff,0xff,0xff])).camera,[]);
});
test('a descriptor cut short or empty gives what it can, without failing',()=>{
  assert.deepEqual(K.parseUvc(''),{modes:[],camera:[],processing:[],uvc:null});assert.deepEqual(K.parseUvc('00ff'),{modes:[],camera:[],processing:[],uvc:null});
  const u=K.parseUvc(hex().replace(/\s/g,'').slice(0,400));assert.equal(u.uvc,'1.10');
});

// ---- lens data
test('lens data follows the SDK: exact, same shape scaled, other shape, none',()=>{
  const exact=K.lensFor('046d','0825',640,480);assert.equal(exact.match,'exact');assert.equal(exact.model,'Logitech C270');assert.equal(exact.guess,undefined);
  const scaled=K.lensFor('046d','0825',320,240);assert.equal(scaled.match,'scaled');assert.deepEqual(scaled.from,['640x480']);assert.equal(scaled.guess,undefined);assert.match(scaled.text,/scales/);
  const c920=K.lensFor('046d','08e5',1280,720);assert.equal(c920.match,'scaled');assert.deepEqual(c920.from,['640x360','1920x1080']);assert.equal(c920.model,'Logitech C920');
  const other=K.lensFor('046d','0825',1280,720);assert.equal(other.match,'other');assert.deepEqual(other.sizes,['640x480']);assert.deepEqual(other.guess,{fx:578.272,fy:578.272,cx:640,cy:360});assert.match(other.text,/Pick one of these sizes/);
  const none=K.lensFor('a108','2240',640,480);assert.equal(none.match,'none');assert.equal(none.model,null);assert.deepEqual(none.guess,{fx:578.272,fy:578.272,cx:320,cy:240});assert.match(none.text,/wrong until/);
  for(const [v,p,w,h] of [['045e','0779',640,480],['045e','0810',640,480],['046d','081b',640,360],['046d','082d',864,480],['046d','08E5',800,448],['0bda','5805',1920,1080]])assert.equal(K.lensFor(v,p,w,h).match,'exact',`${v}:${p}`);
  // 864x480 and 800x448 are not the same shape as 16:9.
  assert.equal(K.lensFor('0bda','5805',864,480).match,'other');
});
test('a webcam the SDK has lens data for says so',()=>{
  const k=K.classify(dev('046d:0825',CAM),NOTHING);assert.equal(k.id,'E1');assert.equal(k.lens.model,'Logitech C270');
  assert.equal(K.classify(dev('a108:2240',CAM),NOTHING).lens,undefined);
  // The lens table's IDs without a video stream are not a webcam.
  assert.equal(id(dev('046d:0825',['ff/ff/ff/'])),'Z1');
});

// ---- when it is worth asking the robot to scan again
test('what Scan can see, and what is only something else on the ports',()=>{
  assert.equal(K.scanKind(dev('a108:2240',CAM)),'camera');assert.equal(K.scanKind(dev('8086:0b07',CAM)),'camera','a depth camera too: Scan lists it');assert.equal(K.scanKind(dev('0403:6015',[],{bcd:'1000'})),'hub');assert.equal(K.scanKind(dev('1d6b:0104',ETH)),'network');
  for(const d of [dev('0403:6014'),dev('0403:6015',[],{bcd:'0600'}),dev('0781:5567',['08/06/50/usb-storage']),dev('1a40:0101',['09/00/00/hub'],{class:'09'}),dev('0bda:c820',['e0/01/01/rtk_btusb','ff/ff/ff/rtl8821cu/wlan0'],{path:'3-1.1'})])assert.equal(K.scanKind(d),null,`${d.vid}:${d.pid}`);
});
test('the set Scan is asked about changes with those devices and their addresses, and nothing else',()=>{
  const cam=dev('a108:2240',CAM,{dev:2}),drive=dev('0781:5567',['08/06/50/usb-storage'],{path:'3-1.4',dev:3}),net=dev('1d6b:0104',ETH,{path:'3-1.2',dev:4}),set=K.scanSet;
  assert.equal(set([cam],[]),set([cam,drive],[]),'a USB drive changes nothing');assert.notEqual(set([],[]),set([cam],[]));assert.notEqual(set([cam],[]),set([{...cam,dev:5}],[]),'pulled and back: it has to be asked again');assert.equal(set([cam,net],[]),set([net,cam],[]),'order means nothing');
  const ip=[{iface:'eth0',address:'172.29.0.23',prefix:24}];assert.notEqual(set([net],[]),set([net],ip),'Scan needs the address');assert.equal(set([],[{iface:'wlan0',address:'192.168.43.1'}]),set([],[]),'only an eth');assert.equal(set(undefined,undefined),set([],[]));
  // What a scan or a Limelight answers cannot change it: it looks only at what was read.
  assert.deepEqual(JSON.parse(set(parseUsb(REAL),[])),[['1-1|2'],[]]);
});
test('classifyAll takes each device\'s own context, since a scan speaks only for what was there when it began',()=>{
  const old=dev('0403:6015',[],{bcd:'1000',serial:'DQ123',path:'1-1'}),fresh=dev('0403:6015',[],{bcd:'1000',serial:'DQ456',path:'3-1.4'});
  const [a,b]=K.classifyAll([old,fresh],d=>d.serial==='DQ123'?SCANNED:{});assert.equal(a.name,'Expansion Hub on USB');assert.equal(a.pending,false);assert.equal(b.name,'Expansion Hub or serial cable');assert.equal(b.pending,true);
  assert.equal(K.classifyAll([old],SCANNED)[0].id,'B1','a plain context still does');
});
