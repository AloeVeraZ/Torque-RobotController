'use strict';
// What a device on a Control Hub's USB ports is, in words a student can use: which row of the table it falls in, what it can do on the
// robot, whether the rules allow it and whether it goes in the robot configuration. The table is research_notes/Control Hub USB devices/
// usb-rules.md section 4: first match wins. Also the port map, a webcam's UVC descriptors and the SDK's lens table.
// Shared by the desktop app, the main process and the tests. Takes what src/hub-usb.cjs reads.
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckUsbKinds=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  // Which socket, from the device's name under /sys/bus/usb/devices: "3-1.4.2" is the USB 2.0 port, through a splitter.
  function portOf(path){const p=String(path||'');
    if(/^usb\d+$/.test(p))return 'root';if(p==='3-1'||p==='3-1.1')return 'inside';if(/^[12]-1(\.|$)/.test(p))return 'usb3';if(/^3-1\./.test(p))return 'usb2';if(/^5-/.test(p))return 'usbc';return 'unknown';}
  const PORT_NAMES={root:'Inside the hub',inside:'Inside the hub',usb3:'Blue USB 3.0 port',usb2:'USB 2.0 port',usbc:'USB-C port',unknown:'USB port'};

  // ---- the SDK's lens data (SDK 12.0): VID:PID and an exact size. Only fx, fy, cx and cy matter to AprilTag.
  const LENSES={};for(const [ids,model,sizes] of [[['045e:0779'],'LifeCam HD-3000 v1',['640x480']],[['045e:0810'],'LifeCam HD-3000 v2',['640x480']],[['046d:081b'],'Logitech C310',['640x480','640x360']],
    [['046d:082d','046d:08e5'],'Logitech C920',['640x480','800x600','640x360','1920x1080','800x448','864x480']],[['046d:0825'],'Logitech C270',['640x480']],[['0bda:5805'],'goBILDA 3122-0003-0001',['1920x1080','1280x720','800x600','640x480']]])
    for(const id of ids)LENSES[id]={model,sizes};
  const FALLBACK_F=578.272,sizeOf=s=>s.split('x').map(Number);
  // The SDK's order: exact size, the same shape scaled, a known camera at another shape, an unknown camera. In the last two it silently uses a guess.
  function lensFor(vid,pid,width,height){const known=LENSES[`${String(vid).toLowerCase()}:${String(pid).toLowerCase()}`],w=+width,h=+height,guess={fx:FALLBACK_F,fy:FALLBACK_F,cx:w/2,cy:h/2};
    if(!known)return {match:'none',model:null,sizes:[],guess,text:"Distance will be wrong until this camera's lens is measured."};
    const {model,sizes}=known;if(sizes.includes(`${w}x${h}`))return {match:'exact',model,sizes,text:`FTC has lens data for the ${model} at this size.`};
    const from=sizes.filter(s=>{const [a,b]=sizeOf(s);return a*h===b*w;});
    if(from.length)return {match:'scaled',model,sizes,from,text:`FTC has lens data for the ${model} at ${from.join(', ')}, and scales it to this size.`};
    return {match:'other',model,sizes,guess,text:`Pick one of these sizes for accurate distance: ${sizes.join(', ')}.`};}

  // ---- UVC descriptors, from the device's raw descriptors. Walk by length; class-specific ones count only inside a video interface,
  // because audio uses the same type and subtypes. Advertised does not prove a control works.
  const CAMERA_BITS={0:'Scanning mode',1:'Auto-exposure mode',2:'Auto-exposure priority',3:'Exposure time (absolute)',4:'Exposure time (relative)',5:'Focus (absolute)',6:'Focus (relative)',7:'Iris (absolute)',8:'Iris (relative)',9:'Zoom (absolute)',10:'Zoom (relative)',11:'Pan and tilt (absolute)',12:'Pan and tilt (relative)',13:'Roll (absolute)',14:'Roll (relative)',17:'Focus auto',18:'Privacy shutter',19:'Focus (simple)',20:'Window',21:'Region of interest'};
  const PROCESSING_BITS={0:'Brightness',1:'Contrast',2:'Hue',3:'Saturation',4:'Sharpness',5:'Gamma',6:'White balance temperature',7:'White balance component',8:'Backlight compensation',9:'Gain',10:'Power line frequency',11:'Hue auto',12:'White balance temperature auto',13:'White balance component auto',14:'Digital multiplier',15:'Digital multiplier limit',16:'Analog video standard',17:'Analog video lock',18:'Contrast auto'};
  function parseUvc(hex){const text=String(hex||'').replace(/[^0-9a-f]/gi,''),b=[];for(let i=0;i+1<text.length;i+=2)b.push(parseInt(text.slice(i,i+2),16));
    const u16=at=>b[at]|b[at+1]<<8,u32=at=>(b[at]|b[at+1]<<8|b[at+2]<<16|b[at+3]<<24)>>>0,fps=interval=>interval?Math.round(1e9/interval)/100:0,fourCC=at=>String.fromCharCode(...b.slice(at,at+4)).replace(/\0+$/,'');
    const bits=(at,size,names)=>{const on=[];for(let bit=0;bit<size*8;bit++)if(b[at+(bit>>3)]>>(bit&7)&1&&names[bit])on.push(names[bit]);return on;},add=(list,more)=>{for(const m of more)if(!list.includes(m))list.push(m);};
    const out={modes:[],camera:[],processing:[],uvc:null};let cls=0,sub=0,format=null;
    for(let i=0,n;i+1<b.length&&(n=b[i])>=2&&i+n<=b.length;i+=n){const type=b[i+1],kind=b[i+2];
      if(type===4){cls=b[i+5];sub=b[i+6];continue;}if(type!==0x24||cls!==0x0e)continue;
      if(sub===1){
        if(kind===0x01)out.uvc=`${(b[i+4]>>4)*10+(b[i+4]&15)}.${b[i+3].toString(16).padStart(2,'0')}`;
        else if(kind===0x02&&u16(i+4)===0x0201)add(out.camera,bits(i+15,b[i+14],CAMERA_BITS));
        else if(kind===0x05)add(out.processing,bits(i+8,b[i+7],PROCESSING_BITS));
      }else if(sub===2){
        if(kind===0x04||kind===0x10)format=fourCC(i+5);else if(kind===0x06)format='MJPEG';
        else if((kind===0x05||kind===0x07||kind===0x11)&&format){// A frame-based frame keeps its interval count at byte 21 (it has bytes per line before the list); the others at 25. All list from 26.
          const count=b[i+(kind===0x11?21:25)],mode={format,width:u16(i+5),height:u16(i+7),fps:[]};
          if(count===0){mode.fps=[fps(u32(i+26)),fps(u32(i+30))];mode.continuous=true;}else for(let k=0;k<count;k++)mode.fps.push(fps(u32(i+26+k*4)));
          if(!out.modes.some(m=>m.format===mode.format&&m.width===mode.width&&m.height===mode.height))out.modes.push(mode);}
      }}
    return out;}

  // ---- what to test a device with
  const lower=s=>String(s??'').toLowerCase();
  const normal=d=>{const interfaces=(d.interfaces||[]).map(i=>({...i,class:lower(i.class),sub:lower(i.sub),proto:lower(i.proto),driver:i.driver||'',net:i.net||[]}));
    return {...d,path:String(d.path||''),vid:lower(d.vid),pid:lower(d.pid),class:lower(d.class),bcd:lower(d.bcd),product:d.product||'',maker:d.maker||'',serial:d.serial||'',interfaces,net:[...new Set([...(d.net||[]),...interfaces.flatMap(i=>i.net)])]};};
  const idOf=d=>`${d.vid}:${d.pid}`;
  const ids=(d,...list)=>list.includes(idOf(d));
  const vendor=(d,...list)=>list.includes(d.vid);
  const driver=(d,...list)=>d.interfaces.some(i=>list.includes(i.driver));
  // "0e/02/*": an interface of that class/subclass/protocol, * for any.
  const iface=(d,...list)=>d.interfaces.some(i=>list.some(p=>{const [c,s,x]=p.split('/');return c===i.class&&(s==='*'||s===i.sub)&&(x==='*'||x===i.proto);}));
  const video=d=>iface(d,'0e/*/*'),webcam=d=>iface(d,'0e/02/*');
  const bcdHigh=d=>parseInt(d.bcd||'0',16)&0xff00;
  const ftx=d=>ids(d,'0403:6015')&&bcdHigh(d)===0x1000;
  const portalFor=(d,scan)=>(scan?.portals||[]).find(p=>p.serial&&p.serial===d.serial&&(p.modules||[]).length);
  const hasEth=d=>d.net.some(n=>/^eth/.test(n));
  const networkish=d=>iface(d,'02/06/*','02/0d/*','02/0c/*','e0/01/03','ef/04/01')||driver(d,'asix','ax88179_178a','smsc95xx','smsc75xx','dm9601','cdc_ether','cdc_ncm','rndis_host')||hasEth(d)||ids(d,'1d6b:0104','0525:a4a2');
  // hwType's values are unpublished, so this only catches one that says so outright. Read it from the first real 3G.
  const is3G=lime=>/3\s*g/i.test(String(lime?.status?.hwType??''));
  const limeOn=(d,lime)=>!!lime?.status&&typeof lime.status==='object'&&!!lime.iface&&d.net.includes(lime.iface);
  const SUPPORTED_NOTHING='Nothing in the robot software.',NO_DRIVER='Nothing: the Control Hub has no driver for it.';
  const no=(rule,text)=>({ok:false,rule,text}),yes=(rule,text)=>({ok:true,rule,text}),NOT_USB=rule=>no(rule||'R707',"Not allowed on the robot's USB ports.");
  const WEBCAM_CHECKS=['PORT','SPEED','SERIAL','MODES','CTRL','LENS','CONFIG','DROPS','POWER','LIVE','EXPO'];
  const WEBCAM_LEGAL=yes('R707A, R708A','Allowed. Only its video stream can be used, not a microphone or buttons it may have.');
  // chip: what the short label on a row says, where the plain word would claim more than Torque knows.
  const ONE_LENS={...yes('R707A, R708A','Allowed if it has one lens. Only its video stream can be used, not a microphone or buttons it may have.'),chip:'Allowed if it has one lens'};
  const MEASURE='To measure its lens: hold the target flat, take varied views and keep the focus fixed.';

  // First match wins. when: is it this row. waiting: it may be, and a check has not answered yet. recalled: an ID remembered rather than checked
  // against its maker (true for the whole row): the label and the row's verdict stand, marked not sure. checks: what Torque can run itself
  // (usb-rules.md section 6; * in the notes means Torque Debug must be on the robot). explain: what Torque can only tell the student.
  // route: where a device with no use on USB does work. tag: the I2C device to pick in Configure. tab: the tab it belongs to. text: the plain truth, for every list that shows it.
  const ROWS=[
    {id:'A1',category:'Internal',name:'USB controller inside the hub',hidden:true,when:d=>/^usb\d+$/.test(d.path)},
    {id:'A2',category:'Internal',name:'USB splitter inside the hub',hidden:true,when:d=>d.path==='3-1'},
    {id:'A3',category:'Internal',name:"The hub's own Wi-Fi",can:"The hub's own Wi-Fi.",hidden:true,checks:['DROPS'],explain:"Static on the USB 2.0 port can knock this off, because they share a splitter inside the hub.",when:d=>d.path==='3-1.1'&&(driver(d,'rtl8821cu','rtk_btusb')||ids(d,'0bda:c820'))},
    {id:'B1',category:'Expansion Hub',name:'Expansion Hub on USB',can:'Four more motors, six servos and more sensor ports.',legal:yes('R707C, R701C','Allowed. A robot can have one Expansion Hub beside its Control Hub.'),config:'hub',checks:['SCAN','DISCOVER','PORT','DROPS'],explain:'Secure the Mini-USB plug so it cannot shake loose. Most teams join the hubs with RS-485 instead. A third hub is not allowed.',
      when:(d,c)=>ftx(d)&&!!portalFor(d,c.scan),waiting:(d,c)=>ftx(d)&&!c.scan,meanwhile:{name:'Expansion Hub or serial cable',can:'Checking whether it answers as an Expansion Hub.',text:'Torque is checking what this is.'}},
    {id:'B2',category:'Driver Hub',name:'Driver Hub (wrong place)',can:'Nothing here.',legal:no('R707, R901','Not allowed on the robot. It belongs on the driver console.'),checks:['PORT'],explain:'A Driver Hub goes in your hands and joins the robot by Wi-Fi.',when:d=>ids(d,'2207:0017')||d.product==='Driver Hub'},
    {id:'B3',category:'Second Control Hub',name:'Another Control Hub',can:'Nothing.',legal:no('R701, R707','Not allowed. One robot has one controller.'),explain:'One robot, one controller.',when:d=>ids(d,'2207:0011')||d.product.startsWith('Control Hub')},
    {id:'B4',category:'Rockchip other',name:'Android device starting up',can:'Nothing.',legal:NOT_USB(),explain:'Unplug it.',when:d=>vendor(d,'2207')},
    {id:'B5',category:'REV device with USB',name:'Probably a REV controller (SPARK, Power Hub or Servo Hub)',can:'Nothing over USB here. A Servo Hub works over RS-485.',legal:no('R707, R505','Not allowed on USB. A Servo Hub on RS-485 is allowed.'),explain:'Use the REV Hardware Client from the computer, and wire a Servo Hub with RS-485.',route:{text:'If this is a Servo Hub, it works over the RS485 cable, not USB.'},when:d=>ids(d,'0483:a30e','0483:a3b0','0483:a3b1')},
    {id:'B6',category:'Modern Robotics, or FT232',name:'Old Modern Robotics module or FTDI cable',can:'The robot software ignores it.',legal:no('R701, R707','Not allowed.'),explain:'Use a REV hub.',when:d=>ids(d,'0403:6001')&&bcdHigh(d)===0x0600},
    {id:'B7',category:'Axon programmer',name:'Axon servo programmer',can:'Nothing here.',legal:NOT_USB(),explain:"Plug it into the computer and use Torque's Axon Programmer tab.",route:{tab:'axon',text:'This is an Axon programmer: it goes in the computer, not the robot.'},when:d=>ids(d,'0471:13aa','0472:13aa','0473:13aa')},
    {id:'I1',category:'Phone',name:'Android phone',can:'Nothing here.',legal:no('R707, R701B, R703',"Not allowed on the robot's USB ports. A phone can only be a robot controller, with an Expansion Hub."),when:d=>iface(d,'ff/42/01')||(iface(d,'06/01/01')&&vendor(d,'18d1','04e8','22b8','2717','2a70','0bb4','12d1'))},
    {id:'C1',category:'Stereo or depth camera',name:'Depth camera (not allowed)',can:'The robot software may list it as a webcam, but it must not be used.',legal:no('R708','Not allowed. Stereo and depth cameras are banned.'),explain:'Use a single-lens webcam.',recalled:['045e:02ae','045e:02c4'],scanWarn:'Scan offers this as a webcam. Do not add it to the robot configuration.',when:d=>(video(d)&&vendor(d,'8086','8087','2b03','2bc5'))||ids(d,'045e:02ae','045e:02c4')},
    {id:'C2',category:'OAK',name:'Luxonis OAK',can:SUPPORTED_NOTHING,legal:no('R702 Example 6','Prohibited. It is a programmable vision computer.'),when:d=>vendor(d,'03e7')},
    {id:'C3',category:'OpenMV',name:'OpenMV camera',can:'Nothing.',legal:no('R702 Example 6','Prohibited. It is a programmable vision computer.'),when:d=>ids(d,'1209:abd1')},
    {id:'C4',category:'Pixy2',name:'Pixy2 on USB',can:'Nothing over USB.',legal:no('R702 Example 5, R707','A Pixy2 is allowed as a vision sensor, but not on USB.'),explain:"Check the Pixy2's own instructions for a connection that is not USB.",recalled:true,when:d=>ids(d,'b1ac:f000')},
    {id:'C5',category:'Coral',name:'Google Coral AI stick',can:'Nothing.',legal:no('R707, R702',"Not allowed on the robot's USB ports."),when:d=>ids(d,'1a6e:089a','18d1:9302')},
    {id:'C6',category:'Jetson',name:'NVIDIA Jetson',can:'Nothing.',legal:no('R707, R702',"Not allowed on the robot's USB ports."),when:d=>vendor(d,'0955')},
    {id:'C7',category:'Pi boot mode',name:'Raspberry Pi-based board in flash mode',can:'Nothing. A Limelight being flashed may look like this.',legal:NOT_USB(),explain:'To flash a Limelight, use the computer.',recalled:true,when:d=>ids(d,'0a5c:2711','0a5c:2712','0a5c:2764')},
    {id:'D1',category:'Arduino',name:'Arduino',can:SUPPORTED_NOTHING,legal:NOT_USB(),explain:"Sensors go on the hub's own ports.",when:d=>vendor(d,'2341','2a03')},
    {id:'D2',category:'Teensy',name:'Teensy',can:SUPPORTED_NOTHING,legal:NOT_USB(),explain:"Sensors go on the hub's own ports.",when:d=>ids(d,'16c0:0478','16c0:0483','16c0:0486')},
    {id:'D3',category:'Dev board',name:'ESP32, Pico or similar',can:`${SUPPORTED_NOTHING} An OctoQuad's USB port looks like this too.`,legal:no('R707, R702 Example 3','Not allowed on USB. An OctoQuad on I2C is allowed.'),explain:'An OctoQuad connects by I2C, not USB.',route:{tag:'OctoQuadFTC',label:'OctoQuad',text:'This may be an OctoQuad: it works on an I2C port, not USB.'},recalled:true,when:d=>vendor(d,'303a','2e8a','239a')},
    {id:'D4',category:'ST-Link',name:'STM32 board or programmer',can:'Nothing.',legal:NOT_USB(),when:d=>ids(d,'0483:374b','0483:5740','0483:df11')},
    {id:'D5',category:'CP210x',name:'USB serial chip: HuskyLens, LiDAR adapter, ESP32 board or plain adapter',can:NO_DRIVER,legal:no('R707, R702 Example 5','Not allowed on USB. A HuskyLens on I2C is allowed.'),explain:"A HuskyLens's USB is for firmware and power: connect it by I2C.",route:{tag:'HuskyLens',label:'HuskyLens',text:'This may be a HuskyLens: it works on an I2C port, not USB.'},when:d=>ids(d,'10c4:ea60','10c4:ea70')},
    {id:'D6',category:'CH34x',name:'USB serial chip, often a clone Arduino',can:NO_DRIVER,legal:NOT_USB(),when:d=>ids(d,'1a86:7523','1a86:5523','1a86:7522','1a86:55d4','1a86:55d3')},
    {id:'D7',category:'FTDI other',name:'FTDI serial cable',can:NO_DRIVER,legal:NOT_USB(),when:d=>ids(d,'0403:6001','0403:6010','0403:6011','0403:6014','0403:6015')},
    {id:'D8',category:'Prolific',name:'USB serial cable',can:NO_DRIVER,legal:NOT_USB(),when:d=>ids(d,'067b:2303','067b:23a3')},
    {id:'D9',category:'Hokuyo',name:'Hokuyo LiDAR',can:SUPPORTED_NOTHING,legal:NOT_USB(),explain:'Most LiDARs look like a plain USB serial chip and cannot be recognised.',recalled:true,when:d=>ids(d,'15d1:0000')},
    {id:'E1',category:'Webcam with FTC lens data',name:'Webcam (FTC knows this lens)',can:'AprilTags with real distance, plus colour and object finding.',legal:WEBCAM_LEGAL,config:'webcam',checks:WEBCAM_CHECKS,explain:'Aim it, mount it so it cannot move, and measure where the lens sits on the robot. FTC knows this camera model, not your own lens.',when:d=>webcam(d)&&!!LENSES[idOf(d)]},
    {id:'E2',category:'Arducam or goBILDA global shutter',name:'Global-shutter webcam',can:'AprilTags, colour and object finding, with far less motion blur. Use MJPEG.',legal:WEBCAM_LEGAL,config:'webcam',checks:WEBCAM_CHECKS,explain:'Say which one you have, an Arducam OV9281 or a goBILDA 3122-0004-0001: their lenses differ.',when:d=>ids(d,'0c45:6366')},
    {id:'E3',category:'Known webcam, no lens data',name:'Webcam (needs its lens measured)',can:'AprilTags are seen, but distance is wrong until the lens is measured.',legal:WEBCAM_LEGAL,config:'webcam',checks:[...WEBCAM_CHECKS,'LENSCAL'],explain:MEASURE,when:d=>ids(d,'046d:0843','046d:085e','046d:085c','046d:082c','046d:08b6','045e:076d','045e:0772')},
    {id:'E4',category:'Any webcam',name:'Webcam (needs its lens measured)',can:'AprilTags are seen, but distance is wrong until the lens is measured.',legal:ONE_LENS,config:'webcam',checks:[...WEBCAM_CHECKS,'LENSCAL'],explain:`${MEASURE} Torque cannot see a second lens, so check that this is not a stereo camera.`,when:d=>webcam(d)},
    {id:'F1',category:'USB hub',name:'USB splitter (hub)',can:'More USB devices on one port.',legal:yes('R707B, R611','Allowed. Its power can only come from a USB battery pack or the 5 V port on a REV hub.'),checks:['HUBTREE','PORT','POWER','DROPS'],explain:'Power it from a battery pack that follows R602, or from the 5 V port on a REV hub.',when:d=>d.class==='09'},
    {id:'G1',category:'Limelight 3A',name:'Limelight smart camera',can:'AprilTags, colour and neural pipelines. It does its own vision.',legal:yes('R707A, R708B, R702 Table 12-9','Allowed if it is a Limelight 3A. A 3G is not allowed, and a hub can only have one.'),config:'limelight',checks:['LLNET','LLSTATUS','LLHW','LLCAL','LLCONFIG','PORT','DROPS'],explain:'Use the blue port. Pipelines are set up on its own web page. To calibrate it, take at least 25 and then 50 snapshots, aiming for under 1 pixel of error.',
      when:(d,c)=>limeOn(d,c.limelight)&&!is3G(c.limelight),waiting:(d,c)=>networkish(d)&&c.limelight===undefined,meanwhile:{name:'Network device',can:'Checking whether it is a Limelight.',text:'Torque is checking what this is.'}},
    {id:'G2',category:'Limelight 3G',name:'Limelight 3G (not allowed)',can:'Must not be used.',legal:no('R702 Example 6','Prohibited. It is a programmable vision computer.'),explain:'Use a Limelight 3A.',when:(d,c)=>limeOn(d,c.limelight)&&is3G(c.limelight)},
    {id:'H1',category:'Wi-Fi dongle',name:'Wi-Fi dongle',can:'Must not be used.',legal:no('R704A, R707','Not allowed. A robot can have no other wireless.'),when:d=>driver(d,'rtl8821cu')||d.net.some(n=>/^wlan/.test(n))},
    {id:'H2',category:'Bluetooth dongle',name:'Bluetooth dongle',can:'Must not be used.',legal:no('R704A, R711C, R707','Not allowed. A robot can have no other wireless.'),when:d=>iface(d,'e0/01/01')},
    {id:'H3',category:'Mobile modem',name:'Mobile data modem',can:'Must not be used.',legal:no('R704A, R707','Not allowed. A robot can have no other wireless.'),when:d=>driver(d,'option','qmi_wwan','sierra_net','hso','cdc_mbim')},
    {id:'G3',category:'Other USB network',name:'USB network adapter or a small computer',can:'Nothing useful.',legal:no('R707, R702',"Not allowed on the robot's USB ports."),scanWarn:'Scan offers this as if it were a Limelight. Do not add it to the robot configuration.',when:networkish},
    {id:'J1',category:'Gamepad',name:'Gamepad (wrong place)',can:'Nothing here.',legal:no('R707, R901, R904','Not allowed on the robot. Gamepads plug into the Driver Hub.'),explain:'Plug it into the Driver Hub.',when:d=>ids(d,'046d:c21d','046d:c216','046d:c21f','045e:028e','045e:02ea','045e:0b12','054c:05c4','054c:09cc','054c:0ce6','057e:2009')||driver(d,'xpad')},
    {id:'J2',category:'Keyboard, mouse',name:'Keyboard or mouse',can:'Nothing for robot code.',legal:NOT_USB(),when:d=>iface(d,'03/01/01','03/01/02')},
    {id:'J3',category:'Other HID',name:'Button or control device',can:'Nothing.',legal:NOT_USB(),when:d=>iface(d,'03/*/*')},
    {id:'K1',category:'Storage',name:'USB drive',can:'Nothing for robot code.',legal:NOT_USB(),explain:'Move files over the USB-C cable instead.',when:d=>iface(d,'08/*/*')},
    {id:'L1',category:'Audio',name:'USB sound device',can:'Nothing for robot code.',legal:NOT_USB(),when:d=>iface(d,'01/*/*')},
    {id:'M1',category:'Still camera',name:'GoPro or photo camera',can:'Recording only, after matches.',legal:no('R709, R707','Not allowed on the robot\'s USB ports. A self-contained recording camera with its wireless off is allowed if it stays unconnected.'),explain:"Don't connect it to the hub.",when:d=>vendor(d,'2672')||iface(d,'06/01/*')},
    {id:'Z1',category:'Unknown',name:d=>`Unknown USB device${d.product||d.maker?`: ${[d.maker,d.product].filter(Boolean).join(' ')}`:''}`,can:'Nothing known.',legal:{...no('R707, R708','Not allowed, unless it is a vision device that follows the rules.'),chip:'Probably not allowed'},when:()=>true},
  ];

  // The Scan key of a webcam: its serial, unless it has none or has the one value the SDK refuses. Only then does the SDK make one up, with the
  // port in it when two such cameras are plugged in.
  const realSerial=serial=>!!serial&&serial!=='200901010001';
  const vendorProduct=d=>`VendorProduct:vendor=0x${d.vid}|product=0x${d.pid}|connection=`;
  const scanKey=device=>{const d=normal(device);return realSerial(d.serial)?d.serial:vendorProduct(d);};
  const keyPort=key=>/\|connection=(.+)$/.exec(String(key??''))?.[1]||null,keyBase=key=>String(key??'').replace(/\|connection=.*$/,'');
  // Whether two Scan keys name one camera. A key with a port names the camera in that port, so two with different ports are two cameras, as two identical cameras are. One with no port means any port.
  const sameCamera=(a,b)=>keyPort(a)&&keyPort(b)?String(a)===String(b):keyBase(a)===keyBase(b);
  // The row of what Torque read that a Scan key names: by its port when the key has one.
  const rowForKey=(rows,key)=>{const port=keyPort(key),all=(rows||[]).filter(r=>r.config==='webcam'&&keyBase(r.scanKey)===keyBase(key));return (port&&all.find(r=>(r.device?.paths||[r.device?.path]).includes(port)))||all[0]||null;};
  // A camera in words for a student: its serial, or, for the long key the robot makes up when a camera has none, its product name. That key belongs under Technical facts.
  const madeUpKey=key=>/^VendorProduct:/.test(String(key??''));
  const cameraLabel=(key,rows)=>{if(!madeUpKey(key))return String(key??'');const port=keyPort(key),name=rowForKey(rows,key)?.device?.product||'Camera with no serial number';return port?`${name}, ${PORT_NAMES[portOf(port)]}`:name;};
  // What the robot's own Scan said about this device. WEBCAM and ETHERNET_DEVICE say only what it looks like to the SDK: they settle nothing here.
  const offered=(d,scan)=>(scan?.others||[]).find(o=>{const k=String(o.serial||'');return o.type==='WEBCAM'?k===scanKey(d)||k.startsWith(vendorProduct(d)):o.type==='ETHERNET_DEVICE'&&d.net.includes(k.split(':')[1]);})||null;
  const USB2_WARNING="Move this to the blue USB 3.0 port. A static shock on the USB 2.0 port can knock out the robot's Wi-Fi.";

  function result(row,d,c,waiting){const recalled=row.recalled===true||(Array.isArray(row.recalled)&&row.recalled.includes(idOf(d))),port=portOf(d.path),hidden=!!row.hidden,w=waiting?row.meanwhile:null;
    const legal=w?{ok:null,rule:'',text:w.text,sure:false}:{...(row.legal||{ok:null,rule:'',text:''}),sure:!recalled};
    const warnings=[],scanned=offered(d,c.scan);
    if(!hidden&&port==='usb2')warnings.push({code:'PORT',text:USB2_WARNING});
    if(!w&&row.config==='webcam'&&(d.speed===12||d.speed===1.5))warnings.push({code:'SPEED',text:'This webcam is connected at a slow speed. A bad cable or adapter may be why.'});
    if(!w&&row.scanWarn&&scanned)warnings.push({code:'SCAN',text:row.scanWarn});
    const out={id:row.id,category:row.category,name:w?w.name:typeof row.name==='function'?row.name(d):row.name,can:w?w.can:row.can||'',legal,config:w?null:row.config||null,hidden,checks:row.checks||[],explain:w?'':row.explain||'',route:w?null:row.route||null,
      port,portName:PORT_NAMES[port],usbId:idOf(d),detail:[d.product,d.maker,idOf(d)].filter(Boolean).join(' · '),sure:!recalled&&!w,pending:!!w,warnings};
    if(out.config==='webcam'){out.scanKey=scanKey(d);out.scanned=!!scanned;const lens=LENSES[idOf(d)];if(lens)out.lens=lens;}
    if(out.config==='limelight'){const l=c.limelight;out.limelight={iface:l.iface,hubAddress:l.hubAddress,address:l.address};out.scanKey=l.scanKey||null;out.scanned=!!scanned;}
    if(out.config==='hub')out.portal=portalFor(d,c.scan);
    return out;}
  // device: as src/hub-usb.cjs reads it. scan: what Scan answered, {portals, others} (robot-link's scanDevices), or nothing if it has not answered since
  // this device arrived. limelight: what readLimelight answered, with status null if nothing answered as a Limelight, or nothing if it has not been asked.
  function classify(device,{scan,limelight}={}){const d=normal(device),c={scan,limelight};for(const row of ROWS){if(row.when(d,c))return result(row,d,c,false);if(row.waiting?.(d,c))return result(row,d,c,true);}return null;}
  // What the robot's own Scan can see: a camera, an Expansion Hub's chip, a USB network device. scanSet says when that changed, so it is worth asking the robot again: a device
  // plugged in, or one that has come back (dev), or a network device given the address Scan needs. It looks only at what was read, so a scan's own answer cannot change it.
  const scanKind=device=>{const d=normal(device);return video(d)?'camera':ftx(d)?'hub':networkish(d)?'network':null;};
  const scanSet=(devices,addresses)=>JSON.stringify([(devices||[]).filter(scanKind).map(d=>`${d.path}|${d.dev??''}`).sort(),(addresses||[]).filter(a=>/^eth/.test(a.iface)).map(a=>`${a.iface}:${a.address}`).sort()]);
  // Everything on the hub, with what can only be seen from the whole list: two cameras with one serial, two with none, two of a kind known to clash.
  // context: as classify's, or device => that, since a scan speaks only for what was there when it started.
  function classifyAll(devices,context){const all=(devices||[]).map(d=>({device:d,kind:classify(d,typeof context==='function'?context(d):context)})),cams=all.filter(x=>x.kind.config==='webcam');
    const warn=(x,code,text)=>x.kind.warnings.push({code,text}),serial=x=>normal(x.device).serial;
    for(const x of cams){
      if(realSerial(serial(x))&&cams.filter(o=>serial(o)===serial(x)).length>1)warn(x,'SERIAL','Two cameras here share one serial number, so the robot can only use one of them. Change one if its maker has a tool for that.');
      if(!realSerial(serial(x))&&cams.filter(o=>!realSerial(serial(o))).length>1)warn(x,'SERIAL','This camera has no serial number of its own, and neither does another one here. Each stays tied to the port it is in now.');
      if(x.kind.id==='E2'&&cams.filter(o=>o.kind.id==='E2').length>1)warn(x,'E2','FIRST reports that more than one of these cameras together may not work properly.');}
    return all.map(x=>({...x.kind,device:x.device}));}
  return {classify,classifyAll,portOf,parseUvc,lensFor,scanKey,scanKind,scanSet,sameCamera,rowForKey,madeUpKey,cameraLabel,rows:ROWS};
});
