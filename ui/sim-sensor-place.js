'use strict';
// Where each IMU and odometry sensor sits on the robot and which way it faces: one place for Setup (Configure marks a
// device as the IMU or as odometry + IMU; Mechanisms → Chassis places it on the CAD or takes typed inches), the exports
// and Calibrate. Positions are inches from the robot's centre, x forward, y left, z up (from the floor). Which way a
// device faces is always the team's own pick, as two directions (a: its top face, b: the arrow or port end across it),
// named as RevHubOrientationOnRobot names a hub's: up, down, forward, backward, left, right. A CAD box cannot say which
// way a board faces, so a CAD pick only ever sets the position.
// Device frames (each kind's own, as its maker draws it): X to the device's right, Y out of its b end, Z out of its a face.
//   Control/Expansion Hub: Z out of the logo, Y out of the USB end (the FTC SDK's hub frame).
//   navX2-Micro: Z out of the top (component side), Y along its printed Y arrow.
//   goBILDA Pinpoint: Z out of its label, Y along its printed Y arrow (the Y pod's positive way); X is its X arrow.
//   SparkFun OTOS: Z out of its top, away from the floor (the lens looks down); Y along its printed Y arrow.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DeckSensorPlace=api;})(typeof globalThis==='object'?globalThis:this,()=>{
  const FACES=['up','down','forward','backward','left','right'],axis=d=>Math.floor(FACES.indexOf(d)/2);
  const VEC={forward:[1,0,0],backward:[-1,0,0],left:[0,1,0],right:[0,-1,0],up:[0,0,1],down:[0,0,-1]};
  const MM=1/25.4,finite=n=>typeof n==='number'&&Number.isFinite(n),round=n=>+(+n).toFixed(3);
  // Each kind: what it is, which configuration tags it is, its box (mm, device frame: across X, along Y, through Z) and,
  // for an IMU inside a box, where the IMU chip sits from the box's middle (mm, device frame). a and b: the words for its two
  // directions and which ones it may take (a board that must lie flat takes up or down only).
  // REV's hubs are both 143 × 103 × 29.5 mm (docs.revrobotics.com, Control Hub and Expansion Hub basics). FTC's IMU page
  // puts the chip "approximately under the word PROUD, near the lower right corner"; no one publishes it in millimetres.
  // REV's own STEP of the Control Hub (REV-31-1595) shows its frame: the USB and HDMI ports on one long side, the XT30
  // and motor ports on one short end, the sensor ports at the other. So the SDK's X (towards the I2C ports) runs along
  // the hub's 143 mm length, away from the motor end, and its Y (towards USB) across its 103 mm width. The label reads
  // along the length from the motor end, the USB side at its top. "PROUDLY SUPPORTING" sits about 71% along the lid and
  // 79% down it (FTC's Logo UP, USB FORWARD photo, orthogonal-1.png); the lid's top is 81.7 × 93.2 mm, set towards the USB
  // side and the motor end (the STEP). So the chip is about 18 mm towards the I2C end and 16 mm away from the USB side of
  // the hub's middle, on the main board about 6 mm under the middle. From a photo: good to about 5 mm. The Expansion Hub
  // is the same board and label. An IMU reads turning, which is the same everywhere on a rigid robot, so this only says
  // where the chip is: positions here are the chip's, a CAD click on the case lands on it.
  // The other boards' chips (each from its maker's board file or drawing where there is one):
  //   SparkFun OTOS: 25.4 × 25.4 × 1.6 mm board; the LSM6DSO IMU on top and the PAA5160 optical sensor under it are both
  //     at the board's centre (SparkFun's Eagle file, U2 and U1 at 12.7, 12.7 mm). The IMU sits about 1.2 mm over the
  //     board's middle. Its X arrow points at the Qwiic connector J1, its Y arrow away from the 6-pin header.
  //   REV 9-Axis IMU (REV-31-3332, BNO055): 41.5 × 15 × 16.8 mm; the chip is centred (20.8 mm from the end, 7.5 mm from
  //     the edge) and 14.4 mm over the mounting face, 6 mm over the middle (REV's drawing, REV-31-3332-DR). X runs along
  //     the long edge to the REV logo end.
  //   goBILDA Pinpoint: housing 42.9 (X arrow, away from the connectors) × 40.1 (Y arrow, along them) × 15.7 mm, its board
  //     centred in it (goBILDA's STEP, 3110-0002-0001). The STEP models the board's ESP32-S3, LED, button and connectors
  //     but not its IMU, and goBILDA publishes neither the part nor where it is: taken at the board's centre.
  //   navX2-Micro (LSM6DSM IMU): Kauai Labs publishes neither the board's size nor where the chip is: taken at the middle
  //     of a board about 33 × 23 mm.
  // Expansion Hubs bought after December 2021 have no IMU; Control Hubs from September 2022 have the BHI260AP.
  // The navX2-Micro is not an SDK IMU (NavxMicroNavigationSensor is a gyroscope; its OmniMount sets which axis is up on the
  // board itself), so the exports, which read heading through the SDK's IMU, cannot use it. The Pinpoint is mounted
  // sticker side up (goBILDA's guide); where it sits does not matter, only its pods' offsets do. The OTOS sits 10 mm over
  // the tiles, lens down; its heading offset is where its X arrow points.
  const KINDS={
    controlHub:{name:'Control Hub · built-in IMU',short:'Control Hub IMU',role:'imu',tags:['ControlHubImuBHI260AP','LynxEmbeddedIMU'],size:[143,103,29.5],chip:[18,-16,-6],
      a:{label:'Logo faces',word:'logo'},b:{label:'USB ports face',word:'USB ports'}},
    expansionHub:{name:'Expansion Hub · built-in IMU',short:'Expansion Hub IMU',role:'imu',tags:['LynxEmbeddedIMU','ControlHubImuBHI260AP'],size:[143,103,29.5],chip:[18,-16,-6],
      a:{label:'Logo faces',word:'logo'},b:{label:'USB ports face',word:'USB ports'}},
    navx:{name:'Kauai Labs navX2-Micro',short:'navX2-Micro',role:'imu',sdkImu:false,maker:'Kauai Labs',tags:['KauaiLabsNavxMicro'],size:[33,23,4],chip:[0,0,0],chipKnown:false,
      a:{label:'Top (chips) faces',word:'top'},b:{label:'Its Y arrow points',word:'Y arrow'}},
    externalImu:{name:'REV 9-Axis IMU (REV-31-3332)',short:'REV 9-Axis IMU',role:'imu',tags:['RevExternalImu'],size:[41.5,15,16.8],chip:[0,0,6],
      a:{label:'Top (chip side) faces',word:'top'},b:{label:'Its Y arrow points',word:'Y arrow'}},
    pinpoint:{name:'goBILDA Pinpoint · odometry + IMU',short:'goBILDA Pinpoint',role:'odometry',maker:'goBILDA',tags:['goBILDAPinpoint'],size:[42.9,40.1,15.7],chip:[0,0,0],chipKnown:false,
      a:{label:'Sticker faces',word:'sticker',only:['up','down']},b:{label:'Its Y arrow points',word:'Y arrow',only:['left'],hidden:true}},
    otos:{name:'SparkFun OTOS · odometry + IMU',short:'SparkFun OTOS',role:'odometry',tags:['SparkFunOTOS'],size:[25.4,25.4,1.6],chip:[0,0,1.2],
      a:{label:'Top faces (the lens looks at the floor)',word:'top',only:['up']},b:{label:'Its Y arrow points',word:'Y arrow',only:['forward','backward','left','right']}}};
  const IMU_KINDS=Object.keys(KINDS).filter(k=>KINDS[k].role==='imu');
  // A configuration device's kind. parent: it is on the Control Hub itself (the portal's parent hub), not an Expansion Hub.
  function kindOfTag(tag,{parent=true}={}){if(tag==='ControlHubImuBHI260AP'||tag==='LynxEmbeddedIMU')return parent?'controlHub':'expansionHub';
    for(const [k,v] of Object.entries(KINDS))if(v.tags.includes(tag))return k;return null;}
  // What a device can be marked as in Configure: an IMU (the robot's heading), or odometry + IMU (a Pinpoint or an OTOS
  // gives both), or neither.
  function rolesOf(tag){const k=kindOfTag(tag);if(!k)return [];return [KINDS[k].role];}
  // A pair that can be: b on another axis than a, each among what the kind takes. Fixed the same way the hub's is.
  function faces(kind,a,b){const K=KINDS[kind]||KINDS.controlHub,okA=K.a.only||FACES,okB=K.b.only||FACES;let A=okA.includes(a)?a:okA[0],B=okB.includes(b)?b:okB.find(x=>axis(x)!==axis(A))||'forward';
    if(axis(B)===axis(A))B=okB.find(x=>axis(x)!==axis(A));return {a:A,b:B};}
  const cross=(p,q)=>[p[1]*q[2]-p[2]*q[1],p[2]*q[0]-p[0]*q[2],p[0]*q[1]-p[1]*q[0]];
  // The robot-from-device turn (rows): device X, Y, Z as robot vectors are its columns. Robot frame x forward, y left, z up.
  function matrix(a,b){const z=VEC[a],y=VEC[b],x=cross(y,z);return [[x[0],y[0],z[0]],[x[1],y[1],z[1]],[x[2],y[2],z[2]]];}
  const apply=(m,v)=>[0,1,2].map(i=>m[i][0]*v[0]+m[i][1]*v[1]+m[i][2]*v[2]);
  // ---- what is kept: robot.sensorPlace {imu:{kind, x, y, z, from, part}, pinpoint:{x, y, z, from, part, a, b}, otos:{z, from, part}}
  // The IMU's two directions are the robot's hubLogo/hubUsb (as before: RevHubOrientationOnRobot); the OTOS's x, y and
  // which way it faces are its odometry offset (robot.odometry.otos x, y, heading). Neither is kept twice.
  const KEYS=['imu','pinpoint','otos'];
  function sanitize(raw){const out={};if(!raw||typeof raw!=='object')return out;
    for(const key of KEYS){const v=raw[key];if(!v||typeof v!=='object')continue;const e={};
      if(key==='imu'&&IMU_KINDS.includes(v.kind))e.kind=v.kind;
      for(const n of key==='otos'?['z']:['x','y','z'])if(finite(v[n])&&Math.abs(v[n])<=48)e[n]=round(v[n]);
      if(v.from==='cad'||v.from==='typed')e.from=v.from;if(typeof v.part==='string'&&v.part.trim())e.part=v.part.trim().slice(0,80);
      if(key==='pinpoint'&&(FACES.includes(v.a)||FACES.includes(v.b))){const f=faces('pinpoint',v.a,v.b);e.a=f.a;e.b=f.b;}
      if(Object.keys(e).length)out[key]=e;}
    return out;}
  // The OTOS's heading (SparkFun's offset h: where its X arrow points, degrees counterclockwise from the robot's front)
  // from where its Y arrow points, and back. Y forward: X points right, -90°.
  const OTOS_HEADING={forward:-90,left:0,backward:90,right:-180};
  const otosHeading=b=>OTOS_HEADING[b]??-90;
  function otosArrow(h){const n=((((+h||0)+180)%360)+360)%360-180;return Object.entries(OTOS_HEADING).reduce((best,[k,v])=>{const d=Math.abs(((n-v+540)%360)-180);return d<best[1]?[k,d]:best;},['forward',Infinity])[0];}
  // Where each device is and which way it faces, for a robot (C: DeckSimConfig). Returns {imu, pinpoint, otos}, each
  // {kind, x, y, z, from, part, a, b, placed} (placed: x and y were given, here or in its odometry).
  function of(robot,C){C=C||globalThis.DeckSimConfig||require('./sim-config.js');const own=sanitize(robot?.sensorPlace),hub=C.hubMounting(robot||{}),odo=C.odometryOf(robot||{});
    const imu=own.imu||{},kind=imu.kind||'controlHub',fi=faces(kind,hub.hubLogo,hub.hubUsb),pp=own.pinpoint||{},fp=faces('pinpoint',pp.a,pp.b),ot=own.otos||{};
    return {imu:{kind,...pick(imu),a:fi.a,b:fi.b,placed:finite(imu.x)&&finite(imu.y)},
      pinpoint:{kind:'pinpoint',...pick(pp),a:fp.a,b:fp.b,placed:finite(pp.x)&&finite(pp.y)},
      otos:{kind:'otos',x:odo.otos.x,y:odo.otos.y,...(finite(ot.z)?{z:ot.z}:{}),...(ot.from?{from:ot.from}:{}),...(ot.part?{part:ot.part}:{}),a:'up',b:otosArrow(odo.otos.heading),placed:true}};}
  const pick=v=>Object.fromEntries(['x','y','z','from','part'].filter(k=>v[k]!==undefined).map(k=>[k,v[k]]));
  // A robot with one device placed or turned. patch: {x, y, z, from, part, a, b, kind}; null for a field clears it.
  // The IMU's a/b go to hubLogo/hubUsb and the OTOS's x, y, b to its odometry. Returns the new robot (C.robot not applied).
  function place(robot,key,patch,C){C=C||globalThis.DeckSimConfig||require('./sim-config.js');if(!KEYS.includes(key))return robot;
    const r={...robot},all=sanitize(r.sensorPlace),cur={...all[key]};
    for(const [k,v] of Object.entries(patch||{})){if(v===null||v===undefined){delete cur[k];continue;}if(['x','y','z'].includes(k)&&finite(v))cur[k]=round(v);else if(k==='from'||k==='part'||k==='kind')cur[k]=v;}
    if(key==='imu'&&(patch?.a||patch?.b)){const was=C.hubMounting(r),f=faces(cur.kind||'controlHub',patch.a||was.hubLogo,patch.b||was.hubUsb);Object.assign(r,C.hubMounting({hubLogo:f.a,hubUsb:f.b}));}
    if(key==='imu'&&patch?.kind){const f=faces(patch.kind,r.hubLogo,r.hubUsb);Object.assign(r,C.hubMounting({hubLogo:f.a,hubUsb:f.b}));}
    if(key==='pinpoint'&&(patch?.a||patch?.b)){const f=faces('pinpoint',patch.a||cur.a,patch.b||cur.b);cur.a=f.a;cur.b=f.b;}
    if(key==='otos'){const odo=structuredClone(C.odometryOf(r));let touched=false;for(const k of ['x','y'])if(finite(cur[k])){odo.otos[k]=cur[k];delete cur[k];touched=true;}
      if(patch?.b){odo.otos.heading=otosHeading(faces('otos','up',patch.b).b);touched=true;}if(touched)r.odometry=C.odometry(odo);}
    all[key]=cur;r.sensorPlace=sanitize(all);if(!Object.keys(r.sensorPlace).length)delete r.sensorPlace;return r;}
  // A part clicked on the CAD: its box (robot inches, {lo:[x,y,z], hi:[x,y,z]}) gives where the device is: the box's middle,
  // and for an IMU inside a box the chip's place in it turned the way the team says the box faces.
  function fromBox(box,kind,a,b){if(!box||!Array.isArray(box.lo)||!Array.isArray(box.hi))return null;const mid=[0,1,2].map(i=>(box.lo[i]+box.hi[i])/2);if(!mid.every(finite))return null;
    const K=KINDS[kind],chip=K?apply(matrix(...Object.values(faces(kind,a,b))),K.chip.map(v=>v*MM)):[0,0,0];return {x:round(mid[0]+chip[0]),y:round(mid[1]+chip[1]),z:round(mid[2]+chip[2])};}
  // How big the CAD box is against what the kind measures, so a click on a screw or the whole chassis is caught.
  function boxFits(box,kind){const K=KINDS[kind];if(!K||!box)return true;const got=[0,1,2].map(i=>Math.abs(box.hi[i]-box.lo[i])).sort((p,q)=>q-p),want=K.size.map(v=>v*MM).sort((p,q)=>q-p);return got[0]<=want[0]*2.2&&got[0]>=want[0]*.35;}
  // The marker on the model: the device's case round its chip (origin: the case's middle; chip: where the IMU is), the way its a face looks (a lit dot, like a status LED, on that face) and
  // the way its b arrow points. Robot inches.
  function marker(p){const K=KINDS[p.kind]||KINDS.controlHub,m=matrix(p.a,p.b),half=K.size.map(v=>v*MM/2),chip=[p.x,p.y,finite(p.z)?p.z:2],off=apply(m,K.chip.map(v=>v*MM)),o=chip.map((v,i)=>v-off[i]);
    const up=apply(m,[0,0,1]),along=apply(m,[0,1,0]),led=o.map((v,i)=>v+up[i]*(half[2]+.15));
    return {origin:o,chip,face:up,arrow:along,led,size:apply(m,K.size.map(v=>v*MM)).map(Math.abs),arrowLength:Math.max(2,half[1]+1.2)};}
  // In words: "Logo up, USB ports forward".
  function words(p){const K=KINDS[p.kind]||KINDS.controlHub,cap=s=>s[0].toUpperCase()+s.slice(1);return `${cap(K.a.word)} ${p.a}${K.b.hidden?'':`, ${K.b.word} ${p.b}`}`;}
  // Where, in words: "3.25 in forward, 1.00 in left, 4.50 in up".
  function where(p){if(!finite(p.x)||!finite(p.y))return 'Not placed yet';const f=(v,pos,neg)=>`${Math.abs(v).toFixed(2)} in ${v>=0?pos:neg}`;return `${f(p.x,'forward','back')}, ${f(p.y,'left','right')}${finite(p.z)?`, ${p.z.toFixed(2)} in up`:''}`;}
  // Which way the Pinpoint's heading counts: its IMU turns about its own Z, so a board label down counts a left turn as a right one.
  const pinpointYawSign=a=>a==='down'?-1:1;
  // What to tell the team about a pick: a mounting the maker does not support, an IMU the exports cannot read.
  function warnings(p){const out=[];if(p.kind==='pinpoint'&&p.a==='down')out.push('goBILDA says to mount the Pinpoint sticker side up. Upside down, its heading counts the wrong way round: turn it over, or check the quarter turn in Calibrate.');
    if(KINDS[p.kind]?.sdkImu===false)out.push('The FTC SDK reads a navX2-Micro as a gyroscope, not as an IMU, so Torque’s exports and Calibrate cannot use it for heading: they need the Control Hub’s IMU. The navX sets which way is up on the board itself (OmniMount).');
    if(p.kind==='expansionHub')out.push('Expansion Hubs bought after December 2021 have no IMU: the Manage page on the robot says whether this one does.');return out;}
  // Said beside it, not as a warning: where the chip is taken to be when its maker does not say.
  const chipNote=p=>KINDS[p.kind]?.chipKnown===false?`${KINDS[p.kind].maker} does not publish where the IMU chip is, so its centre is used: close enough, heading does not depend on it.`:'';
  // ---- Road Runner ----
  // The values Road Runner 1.0's quickstart takes, from a TeamCode export's hardware (DeckFtc.hardware): MecanumDrive.PARAMS'
  // logo and USB directions and inPerTick, and the localizer's Params. Road Runner's frame is x forward, y left, and its pod
  // positions are in ticks: parYTicks is the forward pod's inches left of centre times ticks an inch, perpXTicks the strafe
  // pod's inches forward. Its PinpointLocalizer passes parYTicks and perpXTicks (times mm a tick) to goBILDA's setOffsets,
  // so they are the Pinpoint's xOffset and yOffset in its pods' ticks. Its OTOSLocalizer takes SparkFun's offset as it is.
  // A Java class of constants only (no Road Runner import), so it compiles in any TeamCode.
  function roadRunner(h,{packageName='org.firstinspires.ftc.teamcode.drive',className='RoadRunnerParams'}={}){
    const n=v=>{const t=String(v&&Math.abs(v)<1?+(+v).toPrecision(7):+(+v).toFixed(6));return /[.eE]/.test(t)?t:t+'.0';},str=v=>JSON.stringify(String(v)),loc=h.localization,lines=[];
    const field=(type,name,value,note)=>lines.push(...(note?[`    /** ${note} */`]:[]),`    public static final ${type} ${name} = ${value};`);
    field('String','LOGO_FACING_DIRECTION',str(h.hub.logo),'MecanumDrive.PARAMS.logoFacingDirection: RevHubOrientationOnRobot.LogoFacingDirection.'+h.hub.logo+'.');
    field('String','USB_FACING_DIRECTION',str(h.hub.usb),'MecanumDrive.PARAMS.usbFacingDirection: RevHubOrientationOnRobot.UsbFacingDirection.'+h.hub.usb+'.');
    field('String','IMU_NAME',str(h.imu),`The IMU's name in the robot configuration (${(h.imuPlace?.said||'Control Hub IMU').replace(/\*\//g,'')}).`);
    if(loc==='encoders')field('double','IN_PER_TICK',n(1/h.drive.ticksPerInch),'MecanumDrive.PARAMS.inPerTick, from the drive wheels: measure it with ForwardPushTest.');
    const pods=h.pods||[],fwd=pods.filter(p=>p.axis==='forward').sort((a,b)=>b.y-a.y),side=pods.find(p=>p.axis==='strafe'),tick=p=>p.ticksPerInch;
    if(pods.length){field('double','IN_PER_TICK',n(1/tick(fwd[0]||side)),'MecanumDrive.PARAMS.inPerTick, from the pod wheels (goBILDA 32 mm, 2000 counts a turn).');
      if(loc==='odometry'&&fwd[0]&&side){field('double','PAR_Y_TICKS',n(fwd[0].y*tick(fwd[0])),`TwoDeadWheelLocalizer.Params.parYTicks: "${fwd[0].name}" sits ${n(fwd[0].y)} in left of centre.`);
        field('double','PERP_X_TICKS',n(side.x*tick(side)),`TwoDeadWheelLocalizer.Params.perpXTicks: "${side.name}" sits ${n(side.x)} in forward of centre.`);}
      if(loc==='odometry3'&&fwd.length>1&&side){field('double','PAR0_Y_TICKS',n(fwd[0].y*tick(fwd[0])),`ThreeDeadWheelLocalizer.Params.par0YTicks: "${fwd[0].name}", ${n(fwd[0].y)} in left of centre.`);
        field('double','PAR1_Y_TICKS',n(fwd[1].y*tick(fwd[1])),`ThreeDeadWheelLocalizer.Params.par1YTicks: "${fwd[1].name}", ${n(fwd[1].y)} in left of centre.`);
        field('double','PERP_X_TICKS',n(side.x*tick(side)),`ThreeDeadWheelLocalizer.Params.perpXTicks: "${side.name}", ${n(side.x)} in forward of centre.`);}
      for(const p of pods)if(p.reversed)lines.push(`    // "${p.name}" counts backwards: reverse it in the localizer (par.setDirection(DcMotorSimple.Direction.REVERSE)).`);}
    if(loc==='fused'&&h.pinpointMount){const pp=h.pinpointMount,perIn=pp.ticksPerMm*25.4;
      field('double','PAR_Y_TICKS',n(pp.xOffset*perIn),`PinpointLocalizer.Params.parYTicks: the X (forward) pod, ${n(pp.xOffset)} in left of centre, in its ${n(pp.ticksPerMm)} ticks a mm.`);
      field('double','PERP_X_TICKS',n(pp.yOffset*perIn),`PinpointLocalizer.Params.perpXTicks: the Y (strafe) pod, ${n(pp.yOffset)} in forward of centre.`);
      field('double','IN_PER_TICK',n(1/perIn),'MecanumDrive.PARAMS.inPerTick for the Pinpoint\'s pods.');
      field('String','PINPOINT_NAME',str(h.pinpoint),null);
      if(pp.xReversed||pp.yReversed)lines.push(`    // The quickstart sets both pods FORWARD: set ${[pp.xReversed?'the X pod':'',pp.yReversed?'the Y pod':''].filter(Boolean).join(' and ')} to REVERSED in PinpointLocalizer.`);}
    if(loc==='optical'&&h.otosMount){const o=h.otosMount;
      field('double','OTOS_X',n(o.x),'OTOSLocalizer.Params.offset = new SparkFunOTOS.Pose2D(OTOS_X, OTOS_Y, Math.toRadians(OTOS_HEADING_DEGREES)): inches forward of centre.');
      field('double','OTOS_Y',n(o.y),'Inches left of centre.');field('double','OTOS_HEADING_DEGREES',n(o.heading),`Where its X arrow points, degrees counterclockwise from the front (its Y arrow points ${otosArrow(o.heading)}).`);
      field('double','LINEAR_SCALAR',n(o.linearScalar),null);field('double','ANGULAR_SCALAR',n(o.angularScalar),null);field('String','OTOS_NAME',str(h.otos),null);}
    return `package ${packageName};\n\n/**\n * Road Runner 1.0 (road-runner-quickstart) values for this robot, from Torque's Setup: copy each into MecanumDrive.PARAMS\n * or the localizer's Params as its comment says. Road Runner's frame is x forward, y left; positions are in ticks.\n * Still run Road Runner's tuning OpModes on the real robot: these are where Setup says the parts are.\n */\npublic final class ${className} {\n    private ${className}() {}\n\n${lines.join('\n')}\n}\n`;}
  // ---- the two pickers, the Control Hub's own extended to every kind ----
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // key: the robot key (imu, pinpoint, otos). attr: the data attribute the page listens on, data-sense-face="key:a|b".
  function facesHtml(key,p){const K=KINDS[p.kind]||KINDS.controlHub,sel=(which,label,list,now,other)=>{const id=`sense-face-${key}-${which}`;
      return `<div><label for="${id}">${esc(label)}</label><select id="${id}" data-sense-face="${key}:${which}"${list.length<2?' disabled':''}>${list.map(d=>`<option value="${d}"${d===now?' selected':''}${which==='b'&&axis(d)===axis(other)?' disabled':''}>${d[0].toUpperCase()+d.slice(1)}</option>`).join('')}</select></div>`;};
    return `<div class="start-xy sim-sense-faces">${sel('a',K.a.label,K.a.only||FACES,p.a)}${K.b.hidden?'':sel('b',K.b.label,K.b.only||FACES,p.b,p.a)}</div>`;}
  function posHtml(key,p,{placing,pick}={}){const num=(n,label,min,max)=>`<label>${label}<input type="number" step="0.25" min="${min}" max="${max}" data-slider="off" data-sense-pos="${key}:${n}" value="${finite(p[n])?esc(p[n]):''}"></label>`;
    const btn=pick?`<button type="button" class="secondary sim-place" data-sense-place="${key}" aria-pressed="${placing===key}">${placing===key?'Click it on the model…':'Click it on the model'}</button>`:'';
    return `<div class="sim-chassis-pos">${num('x','Forward · in',-36,36)}${num('y','Left · in',-36,36)}${num('z','Up · in',0,36)}<small>${esc(p.from==='cad'&&p.part?`From the CAD: “${p.part}”`:p.from==='cad'?'From the CAD':'')}</small>${btn}</div>`;}
  return {FACES,KINDS,IMU_KINDS,KEYS,kindOfTag,rolesOf,faces,matrix,sanitize,of,place,fromBox,boxFits,marker,words,where,otosHeading,otosArrow,pinpointYawSign,warnings,chipNote,roadRunner,facesHtml,posHtml,esc};
});
