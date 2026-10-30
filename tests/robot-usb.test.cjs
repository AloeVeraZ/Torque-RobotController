'use strict';
// A Control Hub on USB: its configurations read with ADB, the active one and Blocks' hardware list from its own web
// server, and each device turned into the Java that gets it from the hardware map.
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const R=require('../ui/ftc/robot-config.js'),L=require('../src/robot-link.cjs');
const XML=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<Robot type="FirstInspires-FTC">
    <Webcam name="Webcam 1" serialNumber="UC762" />
    <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">
        <LynxModule name="Expansion Hub 2" port="2">
            <goBILDA5202SeriesMotor name="armMotor" port="0" />
        </LynxModule>
        <LynxModule name="Control Hub" port="173">
            <goBILDA5202SeriesMotor name="frontleft" port="0" />
            <Servo name="left claw" port="0" />
            <ContinuousRotationServo name="intake" port="1" />
            <RevTouchSensor name="liftHome" port="1" />
            <RevColorSensorV3 name="color" port="0" bus="1" />
            <goBILDAPinpoint name="pinpoint" port="0" bus="2" />
            <ControlHubImuBHI260AP name="imu" port="0" bus="0" />
        </LynxModule>
    </LynxUsbDevice>
</Robot>`;

test('each configured device as Java: its SDK type, import and hardwareMap.get line, as Blocks lists them',()=>{
  const j=R.javaOf(R.parse(XML).devices),line=n=>j.list.find(x=>x.device.name===n).declare;
  assert.equal(line('frontleft'),'DcMotorEx frontleft = hardwareMap.get(DcMotorEx.class, "frontleft");');
  assert.equal(line('left claw'),'Servo leftClaw = hardwareMap.get(Servo.class, "left claw");');
  assert.equal(line('intake'),'CRServo intake = hardwareMap.get(CRServo.class, "intake");');
  assert.equal(line('liftHome'),'TouchSensor liftHome = hardwareMap.get(TouchSensor.class, "liftHome");');
  assert.equal(line('color'),'NormalizedColorSensor color = hardwareMap.get(NormalizedColorSensor.class, "color");');
  assert.equal(line('pinpoint'),'GoBildaPinpointDriver pinpoint = hardwareMap.get(GoBildaPinpointDriver.class, "pinpoint");');
  assert.equal(line('Webcam 1'),'WebcamName webcam1 = hardwareMap.get(WebcamName.class, "Webcam 1");');
  assert.ok(j.imports.includes('import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;'));assert.equal(R.variableOf('class'),'classDevice');assert.equal(R.variableOf('2nd arm'),'device2ndArm');
  assert.deepEqual(['frontleft','backrightmotor','FL','left_front'].map(n=>R.tokens(n).join(' ')),['front left','back right','front left','front left'],'run-together names match their parts');
});

test('over USB: ADB lists and reads /sdcard/FIRST, the robot\'s web server names the active one and Blocks\' list',async()=>{
  const server=http.createServer((req,res)=>{if(req.url==='/js/rcInfo.json'){res.end(JSON.stringify({activeConfigName:'comp'}));return;}
    if(req.url==='/hardware'){res.end("var allHardwareIdentifiers = [ 'ControlHubAsREVModule', 'frontleftAsDcMotor', 'imuAsIMU', ];");return;}res.statusCode=404;res.end();});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port,calls=[];
  // A fake ADB: one hub, two configurations, and port forwarding onto the test server.
  const run=(file,args,opts,done)=>{calls.push(args.join(' '));const a=args.join(' ');
    if(a==='devices'||a==='devices -l')return done(null,'List of devices attached\nABC123\tdevice\n\n','');
    if(/shell ls -1t/.test(a))return done(null,'practice.xml\ncomp.xml\nFastLoadBundle.jar\n','');
    if(/shell cat '\/sdcard\/FIRST\/comp\.xml'/.test(a))return done(null,XML,'');if(/shell cat '\/sdcard\/FIRST\/practice\.xml'/.test(a))return done(null,XML.replace('frontleft','fl'),'');
    if(/forward tcp:\d+ tcp:8080/.test(a)&&!/--remove/.test(a)){const local=+/tcp:(\d+) tcp:8080/.exec(a)[1];const proxy=require('node:net').createServer(s=>{const c=require('node:net').connect(port,'127.0.0.1');s.pipe(c).pipe(s);});proxy.listen(local,'127.0.0.1',()=>done(null,'',''));run.proxy=proxy;return;}
    return done(null,'','');};
  try{const r=await L.readUsb({run});assert.equal(r.serial,'ABC123');assert.deepEqual(r.configurations,['practice','comp']);assert.deepEqual(r.active,{name:'comp'});
    assert.ok(r.devices.some(d=>d.name==='frontleft'&&d.port===0));assert.deepEqual(r.blocks,[{identifier:'frontleftAsDcMotor',name:'frontleft',type:'DcMotor'},{identifier:'imuAsIMU',name:'imu',type:'IMU'}]);
    assert.ok(calls.some(c=>/forward --remove tcp:/.test(c)),'the forwarded port is given back');}
  finally{server.close();run.proxy?.close();}
  // Still starting: its storage cannot be listed yet, and that is a wait, not a failure.
  const booting=up=>(f,a,o,done)=>{const c=a.join(' ');if(c==='devices'||c==='devices -l')return done(null,'List of devices attached\nX\tdevice\n','');if(/getprop sys.boot_completed/.test(c))return done(null,up?'1\n':'\n','');if(/ls -1t/.test(c))return done(Object.assign(Error('Command failed'),{code:1}),'','');return done(null,'','');};
  await assert.rejects(L.readUsb({run:booting(false)}),/still starting/);
  assert.deepEqual((await L.readUsb({run:booting(true)})).configurations,[],'fully started with no folder has no configurations');
  await assert.rejects(L.readUsb({run:(f,a,o,done)=>done(null,'List of devices attached\n\n','')}),/No Control Hub on USB/);
  await assert.rejects(L.readUsb({run:(f,a,o,done)=>done(null,'List of devices attached\nX\tunauthorized\n','')}),/has not allowed this computer/);
});

test('the Driver Station over the USB cable: Robocol packets framed over TCP reach the Robot Controller and its answers come back',async t=>{
  const dgram=require('node:dgram'),net=require('node:net'),{startUdpRobot,CONFIG_XML}=require('../tools/ftc-sim.cjs'),{UsbFtcSocket}=require('../src/ftc.cjs');
  let robot;try{robot=await startUdpRobot({address:'127.0.0.8'});}catch(e){t.skip('loopback unavailable: '+e.message);return;}t.after(()=>robot.close());
  // Stand-in for src/usb-relay/DeckUsbRelay.java on the hub: each TCP frame [2-byte length][packet] goes out as one datagram.
  const link=net.createServer(s=>{const udp=dgram.createSocket('udp4');udp.bind(20884,'127.0.0.9');let buf=Buffer.alloc(0);
    udp.on('message',m=>{const h=Buffer.alloc(2);h.writeUInt16BE(m.length);s.write(Buffer.concat([h,m]));});
    s.on('data',c=>{buf=Buffer.concat([buf,c]);while(buf.length>=2){const n=buf.readUInt16BE(0);if(buf.length<2+n)break;udp.send(buf.subarray(2,2+n),20884,'127.0.0.8');buf=buf.subarray(2+n);}});
    s.on('close',()=>udp.close());});
  await new Promise(r=>link.listen(0,'127.0.0.1',r));t.after(()=>link.close());
  const socket=await new UsbFtcSocket(async()=>({port:link.address().port})).open();
  try{const r=await L.readRobot('usb',{socket});assert.equal(r.active.name,'competition');assert.equal(r.xml,CONFIG_XML,'the whole configuration came through the link');}
  finally{await socket.close();}
  assert.ok(socket instanceof require('../src/ftc.cjs').FtcSocket,'Drive treats it as a Driver Station link');
});

test('a Control Hub that hangs up on the cable says to plug it back in, and asks for nothing to be installed on the robot',async t=>{
  const net=require('node:net'),{UsbFtcSocket}=require('../src/ftc.cjs');
  const hangUp=net.createServer(s=>s.destroy());await new Promise(r=>hangUp.listen(0,'127.0.0.1',r));t.after(()=>hangUp.close());
  await assert.rejects(new UsbFtcSocket(async()=>({port:hangUp.address().port})).open(),/hung up on the USB cable.*plug it back in/);
  const keep=net.createServer(()=>{});await new Promise(r=>keep.listen(0,'127.0.0.1',r));t.after(()=>keep.close());
  const socket=await new UsbFtcSocket(async()=>({port:keep.address().port}),{grace:100}).open();assert.ok(socket.socket,'a link that stays connected opens');await socket.close();
});

test('the scan leaves an open Control Hub\'s IMU UNKNOWN (FTC SDK 12.0); the Robot Controller\'s hub list says which one it is',()=>{
  // As a Control Hub v1.0 with a BHI260AP answered over USB, with nothing plugged into it.
  const scan=R.lynxModules('{"modules":[{"imuType":"UNKNOWN","isParent":true,"moduleAddress":173,"revProductNumber":3215698}],"serialNumber":"(embedded)"}');
  const hubs=[{firmwareVersion:'1.8.2',imuType:'BHI260AP',moduleAddress:173,name:'Control Hub',parentSerial:'(embedded)',revProductNumber:3215698}];
  assert.ok(R.unknownImus([scan]));const [filled]=R.withImus([scan],hubs);
  assert.equal(filled.modules[0].imu,'BHI260');assert.equal(R.IMU_TAGS[filled.modules[0].imu],'ControlHubImuBHI260AP');assert.equal(R.unknownImus([filled]),false);
  assert.equal(R.withImus([scan],[{...hubs[0],imuType:'BNO055'}])[0].modules[0].imu,'BNO055','an older Control Hub keeps its BNO055');
  assert.equal(R.withImus([scan],[])[0].modules[0].imu,'UNKNOWN','no list: still UNKNOWN, and no IMU is guessed');
  assert.equal(R.withImus([scan],[{...hubs[0],moduleAddress:2}])[0].modules[0].imu,'UNKNOWN','only the same hub answers');
});

test('a Driver Hub on USB is not taken for a Control Hub, and a missing USB tool says what to install',async()=>{
  const {usbStatus,usbCheck}=require('../src/robot-link.cjs');const answer=out=>(file,args,opts,cb)=>cb(null,out,'');
  assert.deepEqual(await usbStatus({run:answer('List of devices attached\n4315Q2U9R9 device product:PX30_RDS model:Driver_Hub device:PX30_RDS\n')}),{found:false,message:'Not plugged in.'});
  assert.deepEqual(await usbStatus({run:answer('List of devices attached\n4315Q2U9R9 device model:Driver_Hub\n57825145521d15f0 device model:Control_Hub\n')}),{found:true,serial:'57825145521d15f0'});
  const missing=await usbCheck({run:(file,args,opts,cb)=>cb(Object.assign(Error('spawn'),{code:'ENOENT'}),'','')});assert.equal(missing[0].ok,false);assert.match(missing[0].detail,/REV Hardware Client/);
});

test('a lost Control Hub gets one try to come back: an offline link is reset, a stuck ADB restarted, and a Driver Hub left alone',async()=>{
  const {usbRecover}=require('../src/robot-link.cjs');let now=1e9;const go=async out=>{const calls=[];now+=60000;const r=await usbRecover({now,run:(file,args,opts,cb)=>{calls.push(args.join(' '));cb(null,args[0]==='devices'?out:'','');}});return {did:r.did,calls:calls.filter(c=>c!=='devices -l')};};
  assert.deepEqual(await go('List of devices attached\nABC offline\n'),{did:'reconnect',calls:['reconnect offline']});
  assert.deepEqual(await go('List of devices attached\n'),{did:'restart',calls:['kill-server','start-server']});
  assert.deepEqual(await go('List of devices attached\nABC device\n'),{did:null,calls:[]});
  assert.deepEqual(await go('List of devices attached\n4315Q2U9R9 device model:Driver_Hub\n'),{did:null,calls:[]},'a Driver Hub keeps its connection');
  const again=[];now+=1000;assert.deepEqual(await usbRecover({now,run:(f,a,o,cb)=>{again.push(a);cb(null,'','');}}),{did:null});assert.deepEqual(again,[],'at most one try in 30 s');
});
