(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckSimConfig=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Shared by the editor and the local physics adapter. Labels describe drivetrain families,
  // not hardware integrations. H/Kiwi use the generic omni-wheel physics model.
  const drives={
    mecanum:{name:'Mecanum · 4 DC motors',engine:'mecanum',holonomic:true},
    tank2:{name:'Tank · 2 DC motors',engine:'tank',holonomic:false},
    tank:{name:'Tank · 4 DC motors',engine:'tank',holonomic:false},
    xdrive:{name:'X-drive · 4 DC motors',engine:'xdrive',holonomic:true},
    kiwi:{name:'Kiwi · 3 DC motors',engine:'xdrive',holonomic:true,approximation:'Generic omni-wheel physics'},
    swerve:{name:'Swerve · 4 modules, drive and steering each',engine:'swerve',holonomic:true},
    coaxSwerve:{name:'Coaxial swerve · 4 modules, 1 motor and 1 servo each',engine:'swerve',holonomic:true,approximation:'Generic swerve physics'},
    kiwiSwerve:{name:'Kiwi swerve · 3 modules, 1 motor and 1 servo each',engine:'swerve',holonomic:true,approximation:'Generic swerve physics'},
    diffSwerve2:{name:'Differential swerve · 2 modules + casters, 4 DC motors',engine:'swerve',holonomic:true,approximation:'Generic swerve physics'},
    diffSwerve:{name:'Differential swerve · 4 modules, 8 DC motors',engine:'swerve',holonomic:true,approximation:'Generic swerve physics'},
    butterfly:{name:'Butterfly · mecanum set lowered',engine:'butterfly',holonomic:true}
  };
  // Saved setups may name drivetrains that are no longer offered.
  const RETIRED={tank6:'tank',tank8:'tank',tracks:'tank',hdrive:'xdrive'};
  const sensors={
    none:{name:'Legacy sensor-free test fixture',translation:false,imu:false,error:[0,0,0],hidden:true},
    odometry:{name:'2 odometry pods + IMU',translation:true,imu:true,error:[.003,.02,.5]},
    odometry3:{name:'3 odometry pods + IMU',translation:true,imu:true,error:[.003,.02,.5]},
    encoders:{name:'Drive encoders + IMU',translation:true,imu:true,error:[.015,.05,.5]},
    encodersOnly:{name:'Legacy encoder test fixture',translation:true,imu:false,error:[.015,.05,2],hidden:true},
    optical:{name:'SparkFun OTOS · optical + IMU',translation:true,imu:true,error:[.005,.025,.5]},
    fused:{name:'goBILDA Pinpoint · 2 pods + IMU',translation:true,imu:true,error:[.002,.01,.2]},
    vision:{name:'Legacy vision test fixture',translation:true,imu:true,error:[.01,.06,.5],hidden:true},
    gyro:{name:'IMU only · drives by time (no position sensing)',translation:false,imu:true,error:[0,0,.5]},
    ideal:{name:'Internal deterministic test fixture',translation:true,imu:true,error:[0,0,0],hidden:true}
  };
  const finite=n=>typeof n==='number'&&Number.isFinite(n),positive=(n,f)=>finite(n)&&n>0?n:f;
  const intake=r=>finite(r?.intakeIn)?Math.max(0,r.intakeIn):({sloped:3,vector:3.5,triangle:3}[r?.intake]??0);
  // REV Control Hub: 10 A continuous per motor port (20 A absolute peak), 8–15 V input,
  // nominal 12 V. MotionModule's reference build uses external 3–18 V dual drivers,
  // a 12 V battery, regulated Pi 5 V and a separate servo rail. Its driver listing's
  // 10 A is an estimate, not a verified continuous rating. Neither model simulates fuses.
  // driveAmps is retained solely for old setup files; it is not an editable torque multiplier.
  const electrical={ftc:{defaultAmps:10,maxAmps:10,voltage:12,minVoltage:8,maxVoltage:15},motionmodule:{defaultAmps:10,voltage:12,minVoltage:3,maxVoltage:18}};
  function current(value,controller){const profile=electrical[controller];return Math.min(profile?.maxAmps??Infinity,positive(value,profile?.defaultAmps??20));}
  // How the Control Hub is mounted, for its IMU (RevHubOrientationOnRobot). The logo and the USB ports must face
  // along different axes; an impossible pair keeps the logo and picks a USB direction across it.
  const HUB=['up','down','forward','backward','left','right'],hubAxis=d=>Math.floor(HUB.indexOf(d)/2);
  function hubMounting(raw={}){const hubLogo=HUB.includes(raw.hubLogo)?raw.hubLogo:'up';let hubUsb=HUB.includes(raw.hubUsb)?raw.hubUsb:'forward';if(hubAxis(hubUsb)===hubAxis(hubLogo))hubUsb=hubAxis(hubLogo)===1?'up':'forward';return {hubLogo,hubUsb};}
  // The robot's own names for the drive motors and sensors in its Control Hub configuration (Deck's names otherwise),
  // and drive motors set to turn the other way. Only what differs from Deck's defaults is kept.
  // The drive motors and steering of drivetrains Deck exports no code for (Kiwi, swerve...) keep their configuration names too.
  const DEVICE_KEYS=['frontLeft','frontRight','backLeft','backRight','left','right','imu','pinpoint','otos','par','perp','par_left','par_right','front','leftB','rightB','frontLeftB','frontRightB','backLeftB','backRightB','steerFront','steerFrontLeft','steerFrontRight','steerBackLeft','steerBackRight'],DRIVE_KEYS=DEVICE_KEYS.slice(0,6);
  const deviceName=v=>typeof v==='string'&&/^[A-Za-z][\w .-]{0,39}$/.test(v.trim())?v.trim():null;
  function devices(raw){const out={};if(!raw||typeof raw!=='object')return out;
    for(const key of DEVICE_KEYS){const v=raw[key];if(!v||typeof v!=='object')continue;const name=deviceName(v.name),entry={...(name?{name}:{}),...(DRIVE_KEYS.includes(key)&&typeof v.reversed==='boolean'?{reversed:v.reversed}:{})};if(Object.keys(entry).length)out[key]=entry;}
    return out;}
  // Odometry on the robot: where each pod or sensor sits, in inches from the robot's centre (x forward, y left), and
  // which way it counts. The Pinpoint's X pod is its forward pod (xOffset: inches left of centre) and its Y pod the
  // strafe pod (yOffset: inches forward of centre), as goBILDA's setOffsets takes them. The OTOS is where its chip sits,
  // and heading is where its X axis points, degrees counterclockwise from the robot's front (SparkFun's offset; -90: its
  // Y arrow points forward). Scalars correct the OTOS's distance and turn readings. Only what differs is kept.
  const ODOMETRY={pods:{par:{x:0,y:4},perp:{x:-3,y:0},par_left:{x:0,y:6},par_right:{x:0,y:-6}},
    pinpoint:{pods:'4bar',xOffset:4,yOffset:-3,xReversed:false,yReversed:false},otos:{x:0,y:0,heading:-90,linearScalar:1,angularScalar:1}};
  // goBILDA's pods, in encoder ticks per millimetre (FTC SDK 12.0's setEncoderResolution).
  const POD_TYPES={'4bar':{name:'goBILDA 4-bar pod',ticksPerMm:19.894367218017578},swingarm:{name:'goBILDA swingarm pod',ticksPerMm:13.262911796569824}};
  // The OTOS takes scalars from 0.872 to 1.127 (SparkFunOTOS.MIN_SCALAR and MAX_SCALAR).
  const OTOS_SCALARS=[.872,1.127];
  function odometry(raw){
    const out={};if(!raw||typeof raw!=='object')return out;const inch=v=>finite(v)&&Math.abs(v)<=36?+v.toFixed(3):undefined;
    const pods={};for(const [key,d] of Object.entries(ODOMETRY.pods)){const v=raw.pods?.[key];if(!v||typeof v!=='object')continue;const e={};
      for(const axis of ['x','y']){const n=inch(v[axis]);if(n!==undefined&&n!==d[axis])e[axis]=n;}if(v.reversed===true)e.reversed=true;if(finite(v.scale)&&v.scale>=.8&&v.scale<=1.25&&Math.abs(v.scale-1)>1e-6)e.scale=+v.scale.toFixed(5);if(Object.keys(e).length)pods[key]=e;}
    if(Object.keys(pods).length)out.pods=pods;
    // The Control Hub IMU's heading scale, from ten turns in Calibrate. Further than 5% off is a fault, not something to scale away.
    const im=raw.imu;if(im&&typeof im==='object'&&finite(im.scale)&&im.scale>=.95&&im.scale<=1.05&&Math.abs(im.scale-1)>1e-6)out.imu={scale:+im.scale.toFixed(6)};
    const p=raw.pinpoint,pd=ODOMETRY.pinpoint;if(p&&typeof p==='object'){const e={};if(Object.hasOwn(POD_TYPES,p.pods)&&p.pods!==pd.pods)e.pods=p.pods;
      for(const k of ['xOffset','yOffset']){const n=inch(p[k]);if(n!==undefined&&n!==pd[k])e[k]=n;}for(const k of ['xReversed','yReversed'])if(p[k]===true)e[k]=true;if(Object.keys(e).length)out.pinpoint=e;}
    const o=raw.otos,od=ODOMETRY.otos;if(o&&typeof o==='object'){const e={};for(const k of ['x','y']){const n=inch(o[k]);if(n!==undefined&&n!==od[k])e[k]=n;}
      if(finite(o.heading)){const h=+((((o.heading+180)%360)+360)%360-180).toFixed(2);if(h!==od.heading)e.heading=h;}
      for(const k of ['linearScalar','angularScalar'])if(finite(o[k])&&o[k]>=OTOS_SCALARS[0]&&o[k]<=OTOS_SCALARS[1]&&Math.abs(o[k]-1)>1e-6)e[k]=+o[k].toFixed(4);
      if(Object.keys(e).length)out.otos=e;}
    return out;
  }
  // Every odometry value for a robot, with the defaults filled in.
  function odometryOf(r){const o=odometry(r?.odometry);return {pods:Object.fromEntries(Object.entries(ODOMETRY.pods).map(([k,d])=>[k,{...d,reversed:false,...o.pods?.[k]}])),pinpoint:{...ODOMETRY.pinpoint,...o.pinpoint},otos:{...ODOMETRY.otos,...o.otos},imu:{scale:1,...o.imu}};}
  // Which hub and port each device and sensor is plugged into, as the team set it (DeckHardware.sanitizeWiring; null when
  // nothing is set). Without the catalogue loaded the wiring is kept as it came, so a save never loses it.
  function wiring(raw){const H=globalThis.DeckHardware||(typeof require==='function'?require('./sim-hardware.js'):null);
    if(H)return H.sanitizeWiring(raw);try{return raw&&typeof raw==='object'?JSON.parse(JSON.stringify(raw)):null;}catch{return null;}}
  // Where each wheel or swerve module is, by its drive motor's key: inches forward (x) and left (y) of the robot's centre.
  // from: 'cad' when found in the robot's CAD, else typed. Clicked on the model, also where it meets the floor (bottom,
  // inches up in the robot frame) and its radius (r): a wheel clicked next is checked against them.
  function wheelPos(raw){const out={};if(!raw||typeof raw!=='object')return out;for(const k of DEVICE_KEYS){if(/^steer|^(imu|pinpoint|otos|par|perp|par_left|par_right)$/.test(k))continue;const v=raw[k];
    if(v&&typeof v==='object'&&finite(v.x)&&finite(v.y)&&Math.abs(v.x)<=36&&Math.abs(v.y)<=36)out[k]={x:+v.x.toFixed(3),y:+v.y.toFixed(3),...(v.from==='cad'?{from:'cad'}:{}),...(finite(v.bottom)&&Math.abs(v.bottom)<=36?{bottom:+v.bottom.toFixed(3)}:{}),...(finite(v.r)&&v.r>0&&v.r<=12?{r:+v.r.toFixed(3)}:{})};}return out;}
  function robot(raw={},controller){if(RETIRED[raw.drivetrain])raw={...raw,drivetrain:RETIRED[raw.drivetrain]};const own=devices(raw.devices),odo=odometry(raw.odometry),wire=wiring(raw.wiring);return {drivetrain:Object.hasOwn(drives,raw.drivetrain)?raw.drivetrain:'mecanum',wheelPos:wheelPos(raw.wheelPos),intakeIn:intake(raw),
    length:positive(raw.length,17.56),width:positive(raw.width,17.79),heightIn:positive(raw.heightIn,12),massLb:positive(raw.massLb,9.41),driveRpm:positive(raw.driveRpm,312),wheelDiameterMm:positive(raw.wheelDiameterMm,104),driveAmps:current(raw.driveAmps,controller),driveStyle:raw.driveStyle==='field'?'field':'robot',...hubMounting(raw),
    appearance:['strafer','swechanum','plain','custom'].includes(raw.appearance)?raw.appearance:raw.drivetrain==='swerve'?'swechanum':'strafer',...(Object.keys(own).length?{devices:own}:{}),...(Object.keys(odo).length?{odometry:odo}:{}),...(wire?{wiring:wire}:{})};}
  // A robot imported from CAD (appearance custom) collides as its chassis only: length × width.
  const chassisHitbox=r=>r?.appearance==='custom';
  function footprint(raw){const r=robot(raw);return {front:r.length/2+(chassisHitbox(r)?0:r.intakeIn),rear:r.length/2,half:r.width/2};}
  function bounds(layout){if(layout?.field!=='empty')return {x0:0,y0:0,x1:144,y1:144};
    return {x0:0,y0:0,x1:positive(layout.width,144),y1:positive(layout.height,144)};}
  const sensorChoices=controller=>controller==='motionmodule'?['gyro','odometry','odometry3','optical']:['encoders','odometry','odometry3','fused','optical','gyro'];
  const localization=(controller,mode)=>sensorChoices(controller).includes(mode)?mode:controller==='motionmodule'?'gyro':'encoders';
  return {HUB,hubMounting,DEVICE_KEYS,devices,deviceName,wiring,ODOMETRY,POD_TYPES,OTOS_SCALARS,odometry,odometryOf,drives,sensors,sensorChoices,localization,electrical,current,robot,intake,chassisHitbox,footprint,bounds,finite};
});
