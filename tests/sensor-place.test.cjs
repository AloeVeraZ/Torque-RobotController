'use strict';
// Where each IMU and odometry sensor sits and which way it faces (ui/sim-sensor-place.js): kept on the robot, picked on the
// CAD or typed, and fed into the exports, Calibrate's code and the odometry offsets.
const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../ui/sim-config.js'),P=require('../ui/sim-sensor-place.js'),F=require('../ui/sim-ftc.js'),Pedro=require('../ui/sim-pedro.js'),E=require('../ui/sim-config-editor.js'),T=require('../ui/sim-chassis-teleop.js');
const base=()=>({...C.robot({},'ftc'),length:16,width:16});

test('Configure offers the right role for each I2C device',()=>{
  assert.deepEqual(P.rolesOf('ControlHubImuBHI260AP'),['imu']);assert.deepEqual(P.rolesOf('LynxEmbeddedIMU'),['imu']);
  assert.deepEqual(P.rolesOf('KauaiLabsNavxMicro'),['imu']);assert.deepEqual(P.rolesOf('goBILDAPinpoint'),['odometry']);
  assert.deepEqual(P.rolesOf('SparkFunOTOS'),['odometry']);assert.deepEqual(P.rolesOf('RevColorSensorV3'),[]);
  assert.equal(P.kindOfTag('LynxEmbeddedIMU',{parent:true}),'controlHub');assert.equal(P.kindOfTag('LynxEmbeddedIMU',{parent:false}),'expansionHub');
  // The I2C bus shows the choice for those devices only, with what Setup says now; a device with no name cannot be picked yet.
  const hub={name:'Control Hub',portal:'p',address:173,tag:'LynxModule',parent:true},e={hubs:[hub],devices:[
    {name:'imu',tag:'ControlHubImuBHI260AP',port:0,bus:0,family:'i2c',module:{portal:'p',address:173}},{name:'',tag:'goBILDAPinpoint',port:1,bus:0,family:'i2c',module:{portal:'p',address:173}},
    {name:'color',tag:'RevColorSensorV3',port:2,bus:0,family:'i2c',module:{portal:'p',address:173}}],hub:0,family:'i2c',bus:0};
  const html=E.portsHtml(e,{roleOf:d=>d.name==='imu'?'imu':''});
  assert.match(html,/data-ce-role="0"[^>]*><option value="">Not for heading or position<\/option><option value="imu" selected>/);
  assert.match(html,/data-ce-role="1" disabled/);assert.doesNotMatch(html,/data-ce-role="2"/);
  assert.doesNotMatch(E.portsHtml(e),/data-ce-role/,'without Setup to ask, nothing is offered');
});

test('the IMU keeps its place and turns it through the hub mounting; the OTOS through its odometry',()=>{
  let r=C.robot(P.place(base(),'imu',{kind:'expansionHub',x:2,y:-3.5,z:4,from:'cad',part:'Expansion Hub',a:'left',b:'up'}),'ftc');
  assert.deepEqual([r.hubLogo,r.hubUsb],['left','up'],'the IMU’s two directions are RevHubOrientationOnRobot’s');
  assert.deepEqual(r.sensorPlace,{imu:{kind:'expansionHub',x:2,y:-3.5,z:4,from:'cad',part:'Expansion Hub'}});
  const imu=P.of(r).imu;assert.equal(P.words(imu),'Logo left, USB ports up');assert.equal(P.where(imu),'2.00 in forward, 3.50 in right, 4.00 in up');
  // An impossible pair is fixed as the hub's is.
  r=C.robot(P.place(r,'imu',{a:'left',b:'right'}),'ftc');assert.equal(r.hubLogo,'left');assert.ok(!['left','right'].includes(r.hubUsb),r.hubUsb);
  // The OTOS: typed or clicked x and y are its odometry offset, its Y arrow its heading (Y forward: -90°, Y left: 0°).
  r=C.robot(P.place(base(),'otos',{x:1.5,y:-2,z:.4,from:'typed',b:'left'}),'ftc');
  assert.deepEqual(C.odometryOf(r).otos,{x:1.5,y:-2,heading:0,linearScalar:1,angularScalar:1});assert.deepEqual(r.sensorPlace,{otos:{z:.4,from:'typed'}});
  assert.equal(P.of(r).otos.b,'left');for(const [b,h] of [['forward',-90],['backward',90],['right',-180]])assert.equal(C.odometryOf(C.robot(P.place(r,'otos',{b}),'ftc')).otos.heading,h,b);
  assert.equal(P.otosArrow(-88),'forward');
  // The Pinpoint is sticker side up or down, nothing else; down is warned about.
  r=C.robot(P.place(base(),'pinpoint',{x:-1,y:0,a:'down'}),'ftc');assert.equal(P.of(r).pinpoint.a,'down');assert.match(P.warnings(P.of(r).pinpoint)[0],/sticker side up/);
  assert.equal(P.of(C.robot(P.place(r,'pinpoint',{a:'left'}),'ftc')).pinpoint.a,'up');
  assert.deepEqual(C.robot({sensorPlace:{imu:{kind:'toaster',x:99,y:'2'},nope:{x:1}}},'ftc').sensorPlace,undefined,'nonsense is dropped');
});

test('a CAD box gives the position; the marker shows the face and arrow picked',()=>{
  const box={lo:[1,-2,3],hi:[5.06,3.63,4.16]};
  // The hub's chip is under PROUD, near the label's lower right: 18 mm along the hub towards the I2C end (the SDK's +X)
  // and 16 mm away from the USB side (-Y), 6 mm under the middle. Logo up, USB forward: X is right, so the chip is
  // 0.71 in right, 0.63 in back and 0.24 in down.
  assert.deepEqual(P.fromBox(box,'controlHub','up','forward'),{x:2.4,y:.106,z:3.344});
  assert.deepEqual(P.fromBox(box,'expansionHub','up','forward'),{x:2.4,y:.106,z:3.344},'the Expansion Hub is the same board');
  // Logo left, USB up: X = Y × Z = up × left = backward, so the chip is 0.71 in back, 0.63 in down and 0.24 in right.
  assert.deepEqual(P.fromBox(box,'controlHub','left','up'),{x:2.321,y:.579,z:2.95});
  {const mk=P.marker({kind:'controlHub',x:2.4,y:.106,z:3.344,a:'up',b:'forward'});assert.deepEqual(mk.chip,[2.4,.106,3.344]);assert.deepEqual(mk.origin.map(v=>+v.toFixed(3)),[3.03,.815,3.58],'the case is drawn round the chip');}
  assert.equal(P.boxFits(box,'controlHub'),true);assert.equal(P.boxFits({lo:[0,0,0],hi:[18,18,4]},'controlHub'),false,'the whole chassis is not a hub');
  const m=P.marker({kind:'controlHub',x:0,y:0,z:2,a:'left',b:'up'});assert.deepEqual(m.face,[0,1,0]);assert.deepEqual(m.arrow,[0,0,1]);assert.ok(m.led[1]>.5,'the lit dot is on the logo side');
  // The external boards, from their makers' files: the REV 9-Axis IMU's BNO055 is centred, 6 mm over its middle; the OTOS's
  // LSM6DSO at its centre, 1.2 mm over the board's middle; the Pinpoint's and navX's chips are not published, so the middle.
  assert.deepEqual(P.fromBox({lo:[0,0,0],hi:[1.634,.59,.661]},'externalImu','up','forward'),{x:.817,y:.295,z:.567});
  assert.deepEqual(P.fromBox({lo:[0,0,.3],hi:[1,1,.363]},'otos','up','forward'),{x:.5,y:.5,z:.379});
  assert.deepEqual(P.fromBox({lo:[0,0,0],hi:[1.689,1.579,.618]},'pinpoint','up','left'),{x:.845,y:.789,z:.309});
  for(const kind of ['pinpoint','navx'])assert.match(P.chipNote({kind}),/does not publish where the IMU chip is, so its centre is used/,kind);
  assert.deepEqual(P.warnings({kind:'pinpoint',a:'up',b:'left'}),[],'the centre is not a warning');
  assert.deepEqual(P.warnings({kind:'otos',a:'up',b:'forward'}),[]);
  // Sticker up, a Pinpoint's X arrow points forward and its Y arrow left: goBILDA's own frame is the robot's.
  assert.deepEqual(P.matrix(...Object.values(P.faces('pinpoint','up'))),[[1,0,0],[0,1,0],[0,0,1]]);
  // The device frame is right-handed: X = Y × Z, as the SDK's hub frame is.
  assert.deepEqual(P.matrix('up','forward').map(row=>row.map(v=>v+0)),[[0,1,0],[-1,0,0],[0,0,1]]);
});

test('exports use the IMU picked and where the odometry sits, and refuse a navX',()=>{
  let r=C.robot(P.place(base(),'imu',{kind:'controlHub',x:3,y:1,a:'backward',b:'up'}),'ftc');r.devices={imu:{name:'hubImu'}};r=C.robot(r,'ftc');
  const h=F.hardware(r,'odometry');assert.deepEqual(h.hub,{logo:'BACKWARD',usb:'UP'});assert.equal(h.imu,'hubImu');assert.match(h.imuPlace.said,/Logo backward, USB ports up, 3\.00 in forward, 1\.00 in left/);
  const rr=P.roadRunner(h);assert.match(rr,/LOGO_FACING_DIRECTION = "BACKWARD"/);assert.match(rr,/USB_FACING_DIRECTION = "UP"/);assert.match(rr,/IMU_NAME = "hubImu"/);
  const tpi=h.pods[0].ticksPerInch;assert.match(rr,new RegExp(`PAR_Y_TICKS = ${+(4*tpi).toFixed(6)};`));assert.match(rr,new RegExp(`PERP_X_TICKS = ${+(-3*tpi).toFixed(6)};`));
  const tuning={maxForward:86.6,maxStrafe:69.3,forwardDeceleration:83.8,strafeDeceleration:68.9,linearBrakeForward:.0941,linearBrakeStrafe:.0403,quadraticBrakeForward:.00176,quadraticBrakeStrafe:.00237,headingBrakeLinear:.0601,headingBrakeQuadratic:.00486,headingP:3.95,translationalP:.304,translationalSmall:.1};
  assert.match(Pedro.starterConstants({hardware:h,tuning}),/\/\/ Control Hub IMU: Logo backward, USB ports up, 3\.00 in forward/);
  // The Pinpoint's offsets in its own pods' ticks, as Road Runner's PinpointLocalizer passes them to setOffsets.
  const pin=C.robot({...base(),odometry:{pinpoint:{xOffset:-3.3,yOffset:-6.6}}},'ftc'),hp=F.hardware(pin,'fused'),perIn=hp.pinpointMount.ticksPerMm*25.4;
  assert.match(P.roadRunner(hp),new RegExp(`PAR_Y_TICKS = ${+(-3.3*perIn).toFixed(6)};`));
  // The OTOS as SparkFun's offset.
  const ot=C.robot(P.place(base(),'otos',{x:2,y:-1,b:'right'}),'ftc'),ro=P.roadRunner(F.hardware(ot,'optical'));assert.match(ro,/OTOS_X = 2\.0;/);assert.match(ro,/OTOS_Y = -1\.0;/);assert.match(ro,/OTOS_HEADING_DEGREES = -180\.0;/);
  // The TeamCode export carries the Road Runner values, and its drive reads the IMU picked.
  assert.throws(()=>F.hardware(C.robot(P.place(base(),'imu',{kind:'navx'}),'ftc'),'encoders'),/navX2-Micro as a gyroscope/);
});

test('Calibrate’s generated code says which IMU it is and turns it as Setup has it',()=>{
  const r=C.robot(P.place(base(),'imu',{x:-2,y:0,a:'up',b:'left'}),'ftc'),src=T.teleopOf({kind:'mecanum',robot:r,imu:{name:'imu',scale:1},motors:[{name:'frontLeft'},{name:'frontRight'},{name:'backLeft'},{name:'backRight'}],config:'c',date:'d'});
  assert.match(src.source||src,/Control Hub IMU: Logo up, USB ports left, 2\.00 in back, 0\.00 in left/);assert.match(src.source||src,/LogoFacingDirection\.UP, RevHubOrientationOnRobot\.UsbFacingDirection\.LEFT/);
});
