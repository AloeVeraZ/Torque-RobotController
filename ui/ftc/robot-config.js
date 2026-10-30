'use strict';
// A Control Hub's robot configuration (the XML the FTC SDK saves under FIRST/ and sends a Driver Station on
// CMD_REQUEST_PARTICULAR_CONFIGURATION): every device's name, what it is, and its hub and port. Then the check Send to
// robot runs before uploading code: every name the export looks up must be on the robot as the right kind of device.
// Shared by the desktop app, the simulated Control Hub and the tests.
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckRobotConfig=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  // Device XML tags from the FTC SDK 12.0 annotations (@MotorType, @ServoType, @DeviceProperties). A tag ending in Motor or
  // Gearmotor is a motor too, so motor types added later still count.
  const MOTORS=new Set(['Motor','goBILDA5201SeriesMotor','goBILDA5202SeriesMotor','Matrix12vMotor','NeveRest20Gearmotor','NeveRest3.7v1Gearmotor','NeveRest40Gearmotor','NeveRest60Gearmotor',
    'RevRobotics20HDHexMotor','RevRobotics40HDHexMotor','RevRoboticsCoreHexMotor','RevRoboticsHDHexMotor','RevRoboticsUltraplanetaryHDHexMotor','StudicaMaverick','TetrixMotor']);
  const SERVOS=new Set(['Servo','ServoFullRange']),CRSERVOS=new Set(['ContinuousRotationServo','RevSPARKMini']);
  const IMUS=new Set(['ControlHubImuBHI260AP','LynxEmbeddedIMU','RevExternalImu','AdafruitBNO055IMU','AndyMarkIMU','KauaiLabsNavxMicro']);
  // Sensors: on an analog port (@AnalogSensorType), a digital port (@DigitalIoDeviceType; a REV Touch Sensor reads only
  // on an odd channel) or an I2C bus. A Limelight is an EthernetDevice under <Robot>, on no hub.
  const ANALOG=new Set(['AnalogInput','OpticalDistanceSensor','ModernRoboticsAnalogTouchSensor']),DIGITAL=new Set(['DigitalDevice','RevTouchSensor','Led']);
  const COLOR=new Set(['RevColorSensorV3','LynxColorSensor','AndyMarkColor','AdafruitColorSensor','ColorSensor','ModernRoboticsI2cColorSensor']),DISTANCE=new Set(['REV_VL53L0X_RANGE_SENSOR','AndyMarkTOF','MaxSonarI2CXL','ModernRoboticsI2cRangeSensor']);
  // Elements that hold devices rather than being one.
  const HUBS=new Set(['LynxModule','ServoHub']),CONTAINERS=new Set(['Robot','LynxUsbDevice','LynxModule','ServoHub']);
  function kindOf(tag){
    if(MOTORS.has(tag)||/(Motor|Gearmotor)$/.test(tag))return 'motor';if(SERVOS.has(tag))return 'servo';if(CRSERVOS.has(tag))return 'crservo';
    if(IMUS.has(tag))return 'imu';if(tag==='goBILDAPinpoint')return 'pinpoint';if(tag==='SparkFunOTOS')return 'otos';if(tag==='Webcam')return 'webcam';
    if(ANALOG.has(tag))return 'analog';if(tag==='RevTouchSensor')return 'touch';if(tag==='DigitalDevice')return 'digital';if(COLOR.has(tag))return 'color';if(DISTANCE.has(tag))return 'distance';
    if(tag==='OctoQuadFTC')return 'octoquad';if(tag==='HuskyLens')return 'huskylens';if(tag==='EthernetDevice')return 'limelight';if(tag==='Led'||tag==='RevBlinkinLedDriver'||tag==='QWIIC_LED_STICK')return 'led';return 'other';
  }
  const KINDS={motor:'a motor',servo:'a servo',crservo:'a continuous servo',motorOrCr:'a motor or a continuous servo',imu:'an IMU',pinpoint:'a goBILDA Pinpoint',otos:'a SparkFun OTOS',webcam:'a webcam',
    analog:'an analog input',digital:'a digital device',touch:'a touch sensor',color:'a colour sensor',distance:'a distance sensor',octoquad:'an OctoQuad',huskylens:'a HuskyLens',limelight:'a Limelight',led:'an LED',other:'another kind of device'};
  // The robot code looks a device up by its Java class, so a touch sensor (TouchSensor) is not a digital device
  // (DigitalChannel); a REV Color Sensor V3 is also a DistanceSensor.
  const fits=(need,kind)=>need==='motorOrCr'?kind==='motor'||kind==='crservo':need==='distance'?kind==='distance'||kind==='color':need===kind;
  const decode=s=>s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi,(m,e)=>({lt:'<',gt:'>',quot:'"',apos:"'",amp:'&'})[e.toLowerCase()]??String.fromCodePoint(e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10)));
  // Robot configuration XML is plain: elements with attributes, no text. Comments and the XML declaration are blanked
  // out, keeping every position, so a tag inside them is not read. Yields each element as it opens ({tag, attrs, start,
  // end, selfClose, parents}) and as it closes ({close: the element, start}).
  function* elements(xml){
    const body=xml.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g,m=>' '.repeat(m.length)),stack=[];
    for(const m of body.matchAll(/<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g)){
      const [text,close,tag,attrText,selfClose]=m,start=m.index;
      if(close){const at=stack.map(e=>e.tag).lastIndexOf(tag);if(at>=0){yield {close:stack[at],start};stack.length=at;}continue;}
      const attrs={};for(const a of attrText.matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))attrs[a[1]]=decode(a[2]??a[3]??'');
      const e={tag,attrs,start,end:start+text.length,selfClose:!!selfClose,parents:[...stack]};yield e;if(!selfClose)stack.push(e);
    }
  }
  const within=(e,tags)=>[...e.parents].reverse().find(p=>tags.has(p.tag));
  const PORTAL=new Set(['LynxUsbDevice']);
  // The configuration's devices and hubs. A hub is found by its portal (the USB device the robot reaches it through:
  // "(embedded)" for a Control Hub's own board) and its address; a device on one carries both as module.
  function parse(xml){
    if(typeof xml!=='string'||!/<Robot\b/.test(xml))throw Error('This is not an FTC robot configuration.');
    const devices=[],hubs=[];
    for(const e of elements(xml)){if(e.close)continue;const a=e.attrs,hub=within(e,HUBS),portal=within(e,PORTAL);
      if(HUBS.has(e.tag))hubs.push({name:a.name||e.tag,address:a.port!==undefined?Number(a.port):null,tag:e.tag,portal:portal?.attrs.serialNumber??'',parent:e.tag==='LynxModule'&&!!portal&&Number(portal.attrs.parentModuleAddress)===Number(a.port)});
      else if(!CONTAINERS.has(e.tag)&&a.name)devices.push({name:a.name,tag:e.tag,kind:kindOf(e.tag),hub:hub?.attrs.name||null,...(a.port!==undefined?{port:Number(a.port)}:{}),...(a.bus!==undefined?{bus:Number(a.bus)}:{}),
        ...(hub&&hub.attrs.port!==undefined?{module:{portal:portal?.attrs.serialNumber??'',address:Number(hub.attrs.port),...(hub.tag==='ServoHub'?{servoHub:true}:{})}}:{})});
    }
    return {devices,hubs};
  }
  // Name words, so leftFront, left_front_drive, frontLeftMotor and LF all read as front + left.
  const ABBREVIATIONS={lf:['left','front'],fl:['front','left'],rf:['right','front'],fr:['front','right'],lb:['left','back'],bl:['back','left'],rb:['right','back'],br:['back','right'],lr:['left','back'],rl:['back','left'],rr:['right','back']};
  const SAME={rear:'back',flywheel:'shooter',launcher:'shooter',outtake:'shooter',collector:'intake',roller:'intake',feeder:'indexer',transfer:'indexer',pusher:'indexer',kicker:'indexer',gate:'indexer',turntable:'turret',odo:'pinpoint',otos:'otos',imu:'imu'};
  const FILLER=new Set(['motor','drive','wheel','servo','m','the','dc','cr','ex','device']);
  function tokens(name){
    // Words run together all in one case ("frontleft", "backrightmotor") come apart at the direction words teams use.
    const words=String(name||'').replace(/([a-z0-9])([A-Z])/g,'$1 $2').toLowerCase().replace(/(front|back|rear|left|right|top|bottom|upper|lower)(?=[a-z])/g,'$1 ').split(/[^a-z0-9]+|(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/).filter(Boolean);
    return [...new Set(words.flatMap(w=>ABBREVIATIONS[w]||[SAME[w]||w]).filter(w=>!FILLER.has(w)))].sort();
  }
  const likeness=(a,b)=>{if(a===b)return 3;if(a.toLowerCase()===b.toLowerCase())return 2;const x=tokens(a),y=tokens(b);return x.length&&x.length===y.length&&x.every((w,i)=>w===y[i])?1:0;};
  // needs: [{name, need: motor|servo|crservo|motorOrCr|imu|pinpoint|otos|analog|digital|touch|color|distance|octoquad, label,
  // wired?: {hub, port|bus} (where Setup says it is plugged in), xmlType?, ...}] from the export. Each gets a status:
  //   ok      the robot has that name, as the right kind of device;
  //   kind    the robot has the name, as another kind of device;
  //   missing the robot has no device with that name.
  // candidates: the robot's devices that would fit, best match first (a name the export already uses elsewhere last);
  // suggestion: the one to use when a name that plainly means the same device is there (leftFront for front_left).
  // moved: the device is there, on another port than Setup's ({label}); retype: a motor configured as another motor
  // type than Setup's model (the SDK's ticks a turn and default PIDF follow the type).
  function check(needs,config){
    const devices=config?.devices||[],named=new Set(needs.map(n=>n.name)),used=new Set(needs.filter(n=>devices.some(d=>d.name===n.name&&fits(n.need,d.kind))).map(n=>n.name));
    const taken=new Set();
    const rows=needs.map(n=>{const found=devices.find(d=>d.name===n.name),status=!found?'missing':fits(n.need,found.kind)?'ok':'kind';
      const candidates=status==='ok'?[]:devices.filter(d=>fits(n.need,d.kind)).map(d=>({name:d.name,tag:d.kind,score:likeness(n.name,d.name)-(used.has(d.name)?10:0)})).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
      // One robot device is suggested for one name only, in the order the export lists them.
      const best=candidates[0],suggestion=best&&best.score>0&&!taken.has(best.name)&&!(candidates[1]?.score===best.score)?best.name:null;if(suggestion)taken.add(suggestion);
      const fix=status==='kind'?FIXES[`${n.setting?.field}:${found.kind}`]||FIXES[`need ${n.need}:${found.kind}`]:null,moved=status==='ok'?movedFrom(n,found,config):null;
      const retype=status==='ok'&&found.kind==='motor'&&MOTORS.has(n.xmlType)&&found.tag!==n.xmlType&&!(found.tag==='RevRoboticsHDHexMotor'&&n.xmlType==='RevRobotics40HDHexMotor')?n.xmlType:null;
      return {...n,status,...(fix?{fix}:{}),...(found?{found:{name:found.name,kind:found.kind,tag:found.tag,hub:found.hub,port:found.port,...(found.bus!==undefined?{bus:found.bus}:{})}}:{}),candidates:candidates.map(c=>c.name),...(suggestion?{suggestion}:{}),...(moved?{moved}:{}),...(retype?{retype}:{})};});
    // Two different devices in Deck cannot share a name on the robot.
    const seen=new Map();for(const r of rows){const other=seen.get(r.name);if(other&&other.need!==r.need)r.duplicate=other.label;else seen.set(r.name,r);}
    const unused=devices.filter(d=>['motor','servo','crservo','analog','digital','touch','color','distance','octoquad'].includes(d.kind)&&!named.has(d.name)).map(d=>({name:d.name,kind:d.kind}));
    return {rows,ok:rows.every(r=>r.status==='ok'&&!r.duplicate),unused};
  }
  // A device the robot has under that name, but as another kind, is often a Deck setting to change.
  const FIXES={'turretMotor:servo':'In Mechanisms, set the turret to turn on a servo.','indexer:servo':'In Mechanisms, set the feeder to a servo pusher or a servo gate.',
    'indexer:motor':'In Mechanisms, set the feeder to a motor or a continuous servo.','indexer:crservo':'In Mechanisms, set the feeder to a motor or a continuous servo.',
    'servo:crservo':'A ramp or kicker moves on a servo: set it to "Servo" in Configure Robot.','hood:crservo':'The hood moves on a servo: set it to "Servo" in Configure Robot.',
    'need touch:digital':'Set it to "REV Touch Sensor" in Configure Robot, or pick a limit switch for it in Deck.','need digital:touch':'Set it to "Digital Device" in Configure Robot, or pick a REV Touch Sensor for it in Deck.'};
  // The hub Setup means on this robot: control is the parent hub (the Control Hub), expansion, expansion2.. the other hubs
  // by address, servoHub, servoHub2.. the Servo Hubs by address, a number the hub at that address.
  // modules: [{portal, address, name, parent, servoHub?}].
  function hubFor(hub,modules){const all=modules||[],lynx=hubOrder(all.filter(m=>!m.servoHub)),nth=/^(expansion|servoHub)([2-9]|10)?$/.exec(String(hub)),n=Number(nth?.[2]||1);
    if(Number.isInteger(hub))return all.find(m=>m.address===hub)||null;if(hub==='control')return lynx[0]||null;if(nth?.[1]==='expansion')return lynx[n]||null;
    if(nth?.[1]==='servoHub')return all.filter(m=>m.servoHub).sort((a,b)=>a.address-b.address)[n-1]||null;return null;}
  const hubWord=hub=>/^expansion/.test(hub)?'an Expansion Hub':/^servoHub/.test(hub)?'a Servo Hub':hub==='control'?'the Control Hub':null;
  const modulesIn=config=>(config?.hubs||[]).filter(h=>Number.isFinite(h.address)).map(h=>({portal:h.portal,address:h.address,name:h.name,parent:h.parent,...(h.tag==='ServoHub'?{servoHub:true}:{})}));
  // Where Setup has a device, when the robot's configuration has it somewhere else.
  function movedFrom(n,found,config){
    const w=n.wired;if(!w||typeof w!=='object'||!found.module)return null;const want=hubFor(w.hub,modulesIn(config)),family=portFamily(n.device||n.need),i2c=family==='i2c'||found.bus!==undefined;
    const port=i2c?w.bus??w.port:w.port,same=want&&want.address===found.module.address&&want.portal===found.module.portal&&(i2c?found.bus===port:found.port===port);if(same||!Number.isInteger(port))return null;
    return {hub:w.hub,...(i2c?{bus:port}:{port}),label:`${want?want.name:hubWord(w.hub)||`hub ${w.hub}`} ${i2c?`I2C bus ${port}`:`${family} port ${port}`}`};}
  // A plain sentence for one row of the check.
  function explain(row){
    if(row.duplicate)return `"${row.name}" is also the name Deck uses for ${row.duplicate.toLowerCase()}. Each device needs its own name.`;
    if(row.status==='ok')return `"${row.name}" is ${KINDS[row.found.kind]}${row.found.hub?` on ${row.found.hub}`:''}${row.found.bus!==undefined?`, I2C bus ${row.found.bus}`:row.found.port!==undefined?`, port ${row.found.port}`:''}.`+
      (row.moved?` Setup has it on ${row.moved.label}: plug it in there, or change Setup to match the robot.`:'')+(row.retype?` It is configured as ${MOTOR_TYPES[row.found.tag]||row.found.tag}; Setup's motor is ${MOTOR_TYPES[row.retype]||row.retype}, which sets the SDK's encoder resolution and default PIDF.`:'');
    if(row.status==='kind')return `"${row.name}" is ${KINDS[row.found.kind]} on the robot; the code needs ${KINDS[row.need]}.${row.fix?' '+row.fix:''}`;
    return `The robot has no "${row.name}".${row.suggestion?` Its "${row.suggestion}" looks like the same device.`:row.candidates.length?` It has ${row.candidates.length===1?'one':row.candidates.length} ${KINDS[row.need].replace(/^an? /,'')}${row.candidates.length===1?'':'s'} to choose from.`:` It has no ${KINDS[row.need].replace(/^an? /,'')} free.`}`;
  }
  // ---- writing a configuration -------------------------------------------------------------------------------------
  // Devices Deck adds get a port on a hub (a Control Hub or Expansion Hub: motor ports 0-3, servo ports 0-5, analog
  // ports 0-3, digital ports 0-7, I2C buses 0-3; a Servo Hub: servo ports 0-5), are written as the FTC SDK writes them,
  // and go into a configuration saved under a new name. Nothing already in a configuration is changed.
  const PORTS={motor:4,servo:6,analog:4,digital:8,i2c:4};
  // Motor types for a new motor (every @MotorType in FTC SDK 12.0). The type sets the SDK's encoder resolution and its
  // default velocity PIDF.
  const MOTOR_TYPES={goBILDA5202SeriesMotor:'goBILDA Yellow Jacket',RevRoboticsUltraplanetaryHDHexMotor:'REV UltraPlanetary HD Hex',RevRobotics20HDHexMotor:'REV HD Hex 20:1',
    RevRobotics40HDHexMotor:'REV HD Hex 40:1',RevRoboticsCoreHexMotor:'REV Core Hex',goBILDA5201SeriesMotor:'goBILDA 5201 spur',StudicaMaverick:'Studica Maverick',TetrixMotor:'TETRIX motor',
    NeveRest20Gearmotor:'NeveRest 20',NeveRest40Gearmotor:'NeveRest 40',NeveRest60Gearmotor:'NeveRest 60','NeveRest3.7v1Gearmotor':'NeveRest Orbital 3.7',Matrix12vMotor:'MATRIX 12V',Motor:'Another motor'};
  // A hub's own IMU as CMD_DISCOVER_LYNX_MODULES reports it (LynxModuleImuType), and its configuration tag.
  const IMU_TAGS={BHI260:'ControlHubImuBHI260AP',BNO055:'LynxEmbeddedIMU'};
  // Tags on a servo port (FTC SDK 12.0 @ServoType); analog and digital tags (ANALOG, DIGITAL) take those ports.
  const SERVO_PORT=new Set([...SERVOS,...CRSERVOS,'RevBlinkinLedDriver']);
  const DRIVE=new Set(['frontLeft','frontRight','backLeft','backRight','left','right']);
  const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[c]);
  const moduleKey=m=>`${m.portal??''}#${m.address}`;
  // The port family of a device Deck adds (device: motor, crservo, servo, imu, pinpoint, otos, analog, touch, digital,
  // color, distance, octoquad). A sensor read on a motor port's encoder input is a motor there.
  const FAMILY={i2c:'i2c',servo:'servo',crservo:'servo',linear:'servo',imu:'i2c',pinpoint:'i2c',otos:'i2c',color:'i2c',distance:'i2c',octoquad:'i2c',huskylens:'i2c',analog:'analog',touch:'digital',digital:'digital'};
  const portFamily=device=>FAMILY[device]||'motor';
  // A port on a hub: motor 0-3, servo 0-5, analog 0-3, digital 0-7, or the first device on I2C bus 0-3.
  const portKey=(module,family,port,bus=0)=>`${moduleKey(module)}:${family}:${family==='i2c'?bus+'.':''}${port}`;
  // The ports a configured device takes. A device type Deck does not know (a team's own) may be on a motor or a servo port.
  function portsTaken(d){
    if(!d.module||d.port===undefined)return [];if(d.bus!==undefined)return [portKey(d.module,'i2c',d.port,d.bus)];if(d.module.servoHub)return [portKey(d.module,'servo',d.port)];
    if(d.kind==='motor')return [portKey(d.module,'motor',d.port)];if(SERVO_PORT.has(d.tag))return [portKey(d.module,'servo',d.port)];
    if(ANALOG.has(d.tag))return [portKey(d.module,'analog',d.port)];if(DIGITAL.has(d.tag))return [portKey(d.module,'digital',d.port)];
    return [portKey(d.module,'motor',d.port),portKey(d.module,'servo',d.port)];
  }
  // The devices a configuration lacks: the check's rows with no device of that name, each as Deck's settings describe it
  // (with where Setup has it and its model, when it says).
  const CARRY=['wired','model','xmlType','pwm','channels','fast'];
  const missingDevices=rows=>rows.filter(r=>r.status==='missing'&&!r.duplicate).map(r=>({name:r.name,label:r.label,device:r.device||(r.need==='motorOrCr'?'motor':r.need),setting:r.setting,...Object.fromEntries(CARRY.filter(k=>r[k]!==undefined&&r[k]!==false).map(k=>[k,r[k]]))}));
  // The tag a device is written with: a motor as its model's type (Configure Robot's motor type), a servo as a full range
  // servo when its code sends 500-2500 µs (FTC SDK 10.3 and later), sensors as Deck's catalogue has them.
  const SENSOR_TAGS={pinpoint:'goBILDAPinpoint',otos:'SparkFunOTOS',analog:'AnalogInput',touch:'RevTouchSensor',digital:'DigitalDevice',color:'RevColorSensorV3',distance:'REV_VL53L0X_RANGE_SENSOR',octoquad:'OctoQuadFTC',huskylens:'HuskyLens'};
  const modelTag=id=>{if(!id)return undefined;try{const H=globalThis.DeckHardware||(typeof require==='function'?require('../sim-hardware.js'):null);return H?.MODELS?.[id]?.xmlType;}catch{return undefined;}};
  function tagFor(add){
    const own=add.xmlType||modelTag(add.model);
    if(add.device==='servo'||add.device==='linear')return own==='ServoFullRange'||add.fullRange||Array.isArray(add.pwm)&&add.pwm[0]===500&&add.pwm[1]===2500?'ServoFullRange':'Servo';
    if(add.device==='crservo')return CRSERVOS.has(own)?own:'ContinuousRotationServo';
    if(SENSOR_TAGS[add.device])return own&&kindOf(own)===kindOf(SENSOR_TAGS[add.device])?own:SENSOR_TAGS[add.device];
    return add.motorType||(own&&kindOf(own)==='motor'?own:'goBILDA5202SeriesMotor');
  }
  // The hubs in the order devices go on them: the parent (the Control Hub, or the Expansion Hub a phone talks to) first.
  const hubOrder=modules=>[...modules].sort((a,b)=>Number(!!b.parent)-Number(!!a.parent)||a.address-b.address);
  // The ports a device may go on, on one hub, in the order Deck tries them: I2C devices from bus 1 (bus 0 has the hub's
  // IMU); a REV Touch Sensor only on odd digital channels and a REV Potentiometer only on even analog ones (channels);
  // when planning, other digital devices take even channels first (keeping odd ones for touch sensors) and a fast
  // encoder read on a motor port takes port 0 or 3 first (ports 1 and 2 count in software).
  function portsOf(family,module,add,planning){
    const n=module.servoHub?(family==='servo'?PORTS.servo:0):PORTS[family]||0,all=Array.from({length:n},(_,i)=>i),ch=add.channels||(add.device==='touch'?'odd':null);
    if(family==='i2c')return all.slice(1);if(ch==='odd')return all.filter(i=>i%2);if(ch==='even')return all.filter(i=>i%2===0);
    if(planning&&family==='digital')return [...all.filter(i=>i%2===0),...all.filter(i=>i%2)];if(planning&&family==='motor'&&add.fast)return [0,3,1,2].filter(i=>i<n);return all;
  }
  // The hubs a device of a family may go on: servo ports on a Servo Hub too, after the parent hub.
  const hubsFor=(family,modules,add)=>{const lynx=hubOrder(modules.filter(m=>!m.servoHub)),servo=modules.filter(m=>m.servoHub).sort((a,b)=>a.address-b.address);
    return family==='servo'?[lynx[0],...servo,...lynx.slice(1)].filter(Boolean):family==='motor'&&!DRIVE.has(add?.setting?.robot)?[...lynx.slice(1),lynx[0]].filter(Boolean):lynx;};
  // Ports for the devices to add. modules: the robot's hubs [{portal, address, name, parent, imu, servoHub?}]; devices:
  // what its configuration already has. adds: [{name, label, device: motor|crservo|servo|imu|pinpoint|otos|analog|touch|
  // digital|color|distance|octoquad, setting, motorType?, model?, xmlType?, pwm?, channels?, fast?, wired?}].
  // A device Setup put on a port (wired: {hub: control|expansion|servoHub|<address>, port|bus}) goes there first, or is
  // a problem when another device has it or the robot lacks that hub; the rest go around them. Drive motors go on the
  // parent hub first and other motors on another hub first, as teams usually wire them; servos and sensors go on the
  // parent hub first, sensors from I2C bus 1 (bus 0 has the hub's IMU). The IMU is the parent hub's own. A name listed
  // twice (an odometry pod read through its drive motor's port) gets one port.
  function planPorts(adds,{modules,devices=[]}){
    const used=new Map(),assignments=[],problems=[],seen=new Set(),parent=hubOrder(modules.filter(m=>!m.servoHub))[0],fixed=new Map(),failed=new Set();
    for(const d of devices)for(const key of portsTaken(d))used.set(key,d.name);
    if(!parent)return {assignments,problems:['The robot configuration has no Control Hub or Expansion Hub.']};
    for(const add of adds){if(!add.wired||typeof add.wired!=='object'||add.device==='imu'||fixed.has(add.name)||failed.has(add.name))continue;
      const family=portFamily(add.device),module=hubFor(add.wired.hub,modules),i2c=family==='i2c',port=i2c?add.wired.bus??add.wired.port:add.wired.port,at=module?(i2c?{module,port:0,bus:port}:{module,port}):null;
      if(!module){problems.push(`${add.label}: Setup has it on ${hubWord(add.wired.hub)||`hub ${add.wired.hub}`}, which the robot does not have.`);failed.add(add.name);continue;}
      const n=i2c?PORTS.i2c:module.servoHub?(family==='servo'?PORTS.servo:0):PORTS[family]||0;
      if(!(Number.isInteger(port)&&port>=0&&port<n)){problems.push(`${add.label}: ${module.name} has no ${i2c?'I2C bus':family+' port'} ${port}.`);failed.add(add.name);continue;}
      if(!i2c&&!portsOf(family,module,add,false).includes(port)){problems.push(`${add.label}: ${add.channels==='even'?'it reads only on even analog channels (0 and 2)':'it reads only on odd digital channels (1, 3, 5 and 7)'}; Setup has it on ${portLabel({...at,device:add.device})}.`);failed.add(add.name);continue;}
      const key=portKey(module,family,at.port,at.bus);if(used.has(key)){problems.push(`${add.label}: ${portLabel({...at,device:add.device})} has "${used.get(key)}".`);failed.add(add.name);continue;}
      used.set(key,add.name);fixed.set(add.name,{...at,fixed:true});}
    for(const add of adds){if(seen.has(add.name))continue;seen.add(add.name);if(failed.has(add.name))continue;const family=portFamily(add.device);
      if(fixed.has(add.name)){assignments.push({...add,tag:tagFor(add),...fixed.get(add.name)});continue;}
      if(add.device==='imu'){const tag=IMU_TAGS[parent.imu],key=portKey(parent,'i2c',0,0);
        if(!tag)problems.push(`Deck could not tell which IMU ${parent.name} has. Add it as "${add.name}" in Configure Robot on the Driver Station.`);
        else if(used.has(key))problems.push(`I2C bus 0 of ${parent.name}, where its own IMU goes, is taken. Name the device there "${add.name}" in Configure Robot.`);
        else{used.set(key,add.name);assignments.push({...add,tag,module:parent,port:0,bus:0});}continue;}
      let placed=null;
      for(const hub of hubsFor(family,modules,add)){for(const p of portsOf(family,hub,add,true)){const at=family==='i2c'?{module:hub,port:0,bus:p}:{module:hub,port:p},key=portKey(hub,family,at.port,at.bus);if(!used.has(key)){used.set(key,add.name);placed=at;break;}}if(placed)break;}
      if(!placed){problems.push(`No ${family==='i2c'?'I2C bus':family+' port'} is free for "${add.name}" (${add.label}).${family==='motor'?' Add an Expansion Hub, or run a roller on a continuous servo.':family==='servo'?' Add an Expansion Hub.':''}`);continue;}
      assignments.push({...add,tag:tagFor(add),...placed});
    }
    return {assignments,problems};
  }
  const keyOf=a=>portKey(a.module,portFamily(a.device),a.port,a.bus);
  const portLabel=a=>`${a.module.name} ${a.bus!==undefined?`I2C bus ${a.bus}`:`${portFamily(a.device)} port ${a.port}`}`;
  // Every port one planned device could move to, and what is on each: taken (a configured device, or one Setup put
  // there) or swap (another planned device, which would move to this one's port). An IMU stays on its hub's I2C bus 0,
  // and a device Setup put on a port (fixed) stays there: change it in Setup.
  function portChoices(assignments,index,{modules,devices=[]}){
    const a=assignments[index];if(!a||a.device==='imu'||a.fixed)return [];const family=portFamily(a.device),taken=new Map();
    for(const d of devices)for(const key of portsTaken(d))taken.set(key,d.name);
    const hubs=hubOrder(modules).filter(m=>!m.servoHub||family==='servo');
    return hubs.flatMap(module=>portsOf(family,module,a,false).map(p=>family==='i2c'?{module,port:0,bus:p}:{module,port:p})).map(at=>{
      const key=portKey(at.module,family,at.port,at.bus),other=assignments.find((b,j)=>j!==index&&keyOf(b)===key);
      return {...at,key,label:portLabel({...at,device:a.device}),...(taken.has(key)?{taken:taken.get(key)}:other?.fixed?{taken:other.name}:{}),...(other&&!other.fixed?{swap:other.name}:{})};});
  }
  // Moves one planned device to another port; a planned device already there takes this one's port.
  function movePort(assignments,index,key,context){
    const choice=portChoices(assignments,index,context).find(c=>c.key===key);if(!choice)throw Error('That port is not on this robot.');if(choice.taken)throw Error(`${choice.label} has "${choice.taken}".`);
    const out=assignments.map(a=>({...a})),from=out[index],other=out.findIndex((b,j)=>j!==index&&keyOf(b)===key);
    if(other>=0)Object.assign(out[other],{module:from.module,port:from.port,bus:from.bus});Object.assign(from,{module:choice.module,port:choice.port,bus:choice.bus});return out;
  }
  const withType=(a,motorType)=>({...a,motorType,tag:tagFor({...a,motorType})});
  const deviceXml=a=>`<${a.tag} name="${escape(a.name)}" port="${a.port}"${a.bus!==undefined?` bus="${a.bus}"`:''} />`;
  // The robot takes a configuration as CMD_SAVE_CONFIGURATION "<file>;<xml>" and splits it at every ";", so a
  // configuration with one anywhere (in a name, or in &amp; and the like) cannot be sent.
  function sendable(xml){if(xml.includes(';'))throw Error('A name in this configuration has ; & < > " or \' in it, which cannot be sent to the robot. Rename it in Configure Robot first.');return xml;}
  // The robot's own configuration with the planned devices added inside their hubs. Everything else is kept as it was.
  function addDevices(xml,assignments){
    parse(xml);const hubs=[],edits=[];
    for(const e of elements(xml)){if(e.close){const h=hubs.find(h=>h.element===e.close);if(h)h.close=e.start;}
      else if(HUBS.has(e.tag))hubs.push({element:e,key:moduleKey({portal:within(e,PORTAL)?.attrs.serialNumber??'',address:Number(e.attrs.port)})});}
    for(const key of [...new Set(assignments.map(a=>moduleKey(a.module)))]){
      const hub=hubs.find(h=>h.key===key),mine=assignments.filter(a=>moduleKey(a.module)===key).sort(written);if(!hub)throw Error(`The configuration has no ${mine[0].module.name}.`);
      const e=hub.element,indent=/^[ \t]*/.exec(xml.slice(xml.lastIndexOf('\n',e.start)+1))[0],lines=mine.map(a=>indent+'    '+deviceXml(a)).join('\n');
      if(e.selfClose){edits.push({start:e.start,end:e.end,text:xml.slice(e.start,e.end).replace(/\s*\/>$/,'>')+'\n'+lines+'\n'+indent+`</${e.tag}>`});continue;}
      if(hub.close===undefined)throw Error('The configuration is not complete.');
      const line=xml.lastIndexOf('\n',hub.close-1)+1;
      edits.push(/^[ \t]*$/.test(xml.slice(line,hub.close))&&line>e.end?{start:line,end:line,text:lines+'\n'}:{start:hub.close,end:hub.close,text:'\n'+lines+'\n'+indent});
    }
    let out=xml;for(const edit of edits.sort((a,b)=>b.start-a.start))out=out.slice(0,edit.start)+edit.text+out.slice(edit.end);
    const after=parse(out).devices;for(const a of assignments)if(!after.some(d=>d.name===a.name&&d.tag===a.tag))throw Error(`"${a.name}" could not be added.`);
    return sendable(out);
  }
  // A configuration for a robot that has none, from a scan of its hubs: every hub found, named as Configure Robot names
  // them, with the planned devices.
  const moduleName=(portal,m)=>m.name||(portal.serial==='(embedded)'&&m.parent?'Control Hub':`Expansion Hub ${m.address}`);
  // The SDK writes a hub's motors, then its servos, analog inputs, PWM outputs, digital devices and I2C devices, each in
  // port order (WriteXMLFileHandler, FTC SDK 12.0). A portal's Servo Hubs ({address, name?}) follow its hubs.
  const FAMILY_ORDER={motor:0,servo:1,analog:2,pwm:3,digital:4,i2c:5},written=(a,b)=>FAMILY_ORDER[portFamily(a.device)]-FAMILY_ORDER[portFamily(b.device)]||(a.bus??0)-(b.bus??0)||a.port-b.port;
  function newConfiguration(portals,assignments){
    const lines=["<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>",'<Robot type="FirstInspires-FTC">'];let usb=0;
    const hubXml=(tag,name,address,mine)=>{const open=`        <${tag} name="${escape(name)}" port="${address}"`;return mine.length?[open+'>',...mine.map(a=>'            '+deviceXml(a)),`        </${tag}>`]:[open+' />'];};
    for(const portal of portals){if(!portal.modules.length)continue;const parent=portal.modules.find(m=>m.parent)||portal.modules[0],on=(a,address,servoHub)=>!!a.module.servoHub===servoHub&&moduleKey(a.module)===moduleKey({portal:portal.serial,address});
      lines.push(`    <LynxUsbDevice name="${portal.serial==='(embedded)'?'Control Hub Portal':`Expansion Hub Portal ${++usb}`}" serialNumber="${escape(portal.serial)}" parentModuleAddress="${parent.address}">`);
      for(const m of [...portal.modules].sort((a,b)=>Number(a.parent)-Number(b.parent)||a.address-b.address))lines.push(...hubXml('LynxModule',moduleName(portal,m),m.address,assignments.filter(a=>on(a,m.address,false)).sort(written)));
      for(const h of [...(portal.servoHubs||[])].sort((a,b)=>a.address-b.address))lines.push(...hubXml('ServoHub',h.name||`Servo Hub ${h.address}`,h.address,assignments.filter(a=>on(a,h.address,true)).sort(written)));
      lines.push('    </LynxUsbDevice>');}
    lines.push('</Robot>','');const xml=lines.join('\n'),after=parse(xml).devices;
    for(const a of assignments)if(!after.some(d=>d.name===a.name))throw Error(`${a.module.name} was not found on the robot.`);
    return sendable(xml);
  }
  // The hubs a scan found (lynxModules answers). Only the Control Hub's own board is the parent when the robot has one.
  // A portal's Servo Hubs (servoHubs: [{address, name?}]) come after its hubs.
  const modulesFromScan=portals=>{const hub=portals.some(p=>p.serial==='(embedded)');return portals.flatMap(p=>[...p.modules.map(m=>({portal:p.serial,address:m.address,name:moduleName(p,m),parent:m.parent&&(!hub||p.serial==='(embedded)'),imu:m.imu})),
    ...(p.servoHubs||[]).map(h=>({portal:p.serial,address:h.address,name:h.name||`Servo Hub ${h.address}`,parent:false,servoHub:true}))]);};
  // A configuration's hubs, each with its IMU from a scan; missing: the scan did not find it on the robot. Its Servo Hubs
  // too (servoHub: a scan does not list them).
  const modulesOf=(config,portals)=>(config.hubs||[]).filter(h=>(h.tag==='LynxModule'||h.tag==='ServoHub')&&Number.isFinite(h.address)).map(h=>{
    if(h.tag==='ServoHub')return {portal:h.portal,address:h.address,name:h.name,parent:false,servoHub:true};
    const found=portals?.find(p=>p.serial===h.portal)?.modules.find(m=>m.address===h.address);
    return {portal:h.portal,address:h.address,name:h.name,parent:h.parent,...(found?{imu:found.imu}:portals?{missing:true}:{})};});
  // A whole configuration with no robot to scan: the Control Hub's own board (address 173), an Expansion Hub on its
  // RS485 port at each address Setup gives (wiring.hubs.expansion, expansion2..) and Servo Hubs (servoHub, servoHub2..), with each
  // device on the port Setup or Deck's plan gave it (DeckHardware.placed rows: {name, label, device, model?, xmlType?,
  // pwm?, channels?, fast?, setting?, hub?, port?, bus?, via?}; a row with no port is planned here). A sensor read
  // through a motor's port (via) has no line of its own. imu: the Control Hub's IMU, BHI260 (every Control Hub since
  // September 2022) or BNO055. Returns {xml, assignments, problems}; a device that found no port is left out.
  function configurationFor(rows,wiring,{imu='BHI260'}={}){
    const h=wiring?.hubs||{},address=(v,d)=>Number.isInteger(v)&&v>0&&v<255&&v!==173?v:d,of=(test,d)=>Object.keys(h).filter(k=>test.test(k)&&h[k]).map(k=>address(h[k].address,d)).sort((a,b)=>a-b);
    const exp=of(/^expansion(\d+)?$/,2),servo=of(/^servoHub(\d+)?$/,3).filter(a=>!exp.includes(a));
    const portal={serial:'(embedded)',modules:[{address:173,parent:true,imu},...exp.map(a=>({address:a,parent:false,imu:'NONE'}))],servoHubs:servo.map(a=>({address:a}))};
    const adds=(rows||[]).filter(r=>r&&r.name&&r.device&&!r.via).map(r=>({name:r.name,label:r.label||r.name,device:r.device,...(r.setting?{setting:r.setting}:{}),...Object.fromEntries(CARRY.slice(1).filter(k=>r[k]!==undefined&&r[k]!==null&&r[k]!==false).map(k=>[k,r[k]])),
      ...(r.hub?{wired:{hub:r.hub,...(r.bus!==undefined?{bus:r.bus}:{port:r.port})}}:r.wired&&typeof r.wired==='object'?{wired:r.wired}:{})}));
    const {assignments,problems}=planPorts(adds,{modules:modulesFromScan([portal])});
    return {xml:newConfiguration([portal],assignments),assignments,problems};
  }
  // A configuration name the robot does not have yet ("competition Deck", then "competition Deck 2", ...). Names keep to
  // letters, digits, spaces, - and _ (the name is the robot's file name, and a ; ends it).
  function configurationName(base,existing=[]){
    const clean=String(base||'').replace(/[^\w -]+/g,' ').replace(/\s+/g,' ').replace(/^[\s-]+/,'').slice(0,36).trim()||'Deck';let name=clean,n=2;
    while(existing.some(e=>e.toLowerCase()===name.toLowerCase()))name=`${clean} ${n++}`;return name;
  }
  const validName=name=>typeof name==='string'&&/^[A-Za-z0-9_][\w -]{0,39}$/.test(name)&&name.trim()===name;
  // The robot's answers to CMD_SCAN (ScannedDevices: {map: [{key: serial, value: UsbDeviceType}]}) and
  // CMD_DISCOVER_LYNX_MODULES (LynxModuleMetaList: {serialNumber, modules: [{moduleAddress, isParent, imuType, revProductNumber}]}).
  // A Servo Hub answers on the RS485 chain too, with its own product number (LynxConstants.SERVO_HUB_PRODUCT_NUMBER, FTC SDK 12.0).
  const lynxSerials=scan=>{const v=JSON.parse(scan);return (Array.isArray(v?.map)?v.map:[]).filter(e=>e?.value==='LYNX_USB_DEVICE'&&typeof e.key==='string').map(e=>e.key);};
  // Everything else the scan found on USB (a webcam): [{serial, type}].
  const otherUsb=scan=>{const v=JSON.parse(scan);return (Array.isArray(v?.map)?v.map:[]).filter(e=>typeof e?.key==='string'&&typeof e.value==='string'&&e.value!=='LYNX_USB_DEVICE').map(e=>({serial:e.key,type:e.value}));};
  const SERVO_HUB_PRODUCT=1120341;
  function lynxModules(list){const v=JSON.parse(list),all=(Array.isArray(v?.modules)?v.modules:[]).filter(m=>Number.isInteger(m?.moduleAddress)),servo=all.filter(m=>m.revProductNumber===SERVO_HUB_PRODUCT);
    return {serial:String(v?.serialNumber??''),modules:all.filter(m=>m.revProductNumber!==SERVO_HUB_PRODUCT).map(m=>({address:m.moduleAddress,parent:!!m.isParent,imu:typeof m.imuType==='string'?m.imuType:'UNKNOWN'})),...(servo.length?{servoHubs:servo.map(m=>({address:m.moduleAddress}))}:{})};}
  // While the robot has a hub open (it always has a Control Hub's own board), FTC SDK 12.0's scan answers its IMU as
  // UNKNOWN. The Robot Controller's web server knows it: /js/rcInfo.json revHubNamesAndVersions, [{parentSerial,
  // moduleAddress, imuType: BHI260AP, BNO055 or NONE}]. withImus fills the scan's UNKNOWN IMUs from that list.
  // Discovery takes about 1.2 s an answer and any answer can miss hubs, empty or partial, even after a full one (seen on a
  // Control Hub, FTC SDK 12.0, about one in four), but it never invents one. So the answers are added up, until one adds
  // nothing. expect: addresses the robot has open; one still missing gets a few more asks before it counts as gone.
  // ask(): one CMD_DISCOVER_LYNX_MODULES answer. onAnswer(hubs so far): after each answer, to show them at once.
  async function discover(ask,{tries=8,expect=[],onAnswer}={}){
    const key=p=>[...p.modules.map(m=>m.address),...(p.servoHubs||[]).map(h=>'s'+h.address)].sort().join();let all=null;
    for(let i=0;i<tries;i++){const p=lynxModules(await ask()),was=all?key(all):'';if(!all)all={...p,modules:[],servoHubs:[]};
      for(const h of p.servoHubs||[]){all.modules=all.modules.filter(m=>m.address!==h.address);if(!all.servoHubs.some(s=>s.address===h.address))all.servoHubs.push(h);}
      for(const m of p.modules){const had=all.modules.find(x=>x.address===m.address);if(had){if(had.imu==='UNKNOWN')had.imu=m.imu;}else if(!all.servoHubs.some(s=>s.address===m.address))all.modules.push({...m});}
      onAnswer?.(tidy(all));if(key(all)&&key(all)===was&&(i>=3||expect.every(a=>[...all.modules,...all.servoHubs].some(h=>h.address===a))))break;}
    return tidy(all);}
  const tidy=({servoHubs,...p})=>({...p,modules:p.modules.map(m=>({...m})),...(servoHubs.length?{servoHubs:servoHubs.map(h=>({...h}))}:{})});
  // The hubs the Robot Controller has open, by portal: known in a few milliseconds, before discovery has answered.
  const openHubs=hubs=>withLiveHubs([...new Set((Array.isArray(hubs)?hubs:[]).map(h=>h?.parentSerial).filter(s=>typeof s==='string'))].map(serial=>({serial,modules:[]})),hubs);
  // The configuration without one hub and the devices on it. address and tag say which hub; portal when there are several.
  function removeHub(xml,{address,tag,portal}){const {devices,hubs}=parse(xml),same=h=>h.address===address&&(!tag||h.tag===tag)&&(!portal||h.portal===portal),gone=hubs.filter(same);if(!gone.length)return {xml,devices:[]};
    const on=d=>d.module&&gone.some(h=>d.module.portal===h.portal&&d.module.address===h.address&&!!d.module.servoHub===(h.tag==='ServoHub')),keep=devices.filter(d=>d.module&&!on(d));
    const out=rebuild(xml,keep.map(({name,tag,port,bus,module})=>({name,tag,port,...(bus!==undefined?{bus}:{}),module})),hubs.filter(h=>!same(h)));
    return {xml:withNotes(out,Object.fromEntries(Object.entries(notesOf(xml)).filter(([name])=>keep.some(d=>d.name===name)))),devices:devices.filter(on)};}
  // Hubs the Robot Controller already has open (/js/rcInfo.json revHubNamesAndVersions) answered it, so they are there.
  // Its product number also corrects the scan: a scan can fail to read one (FTC SDK 12.0 logs "Failed to determine the REV
  // product number", seen with a real Servo Hub), and a hub with no number would pass for an Expansion Hub.
  function withLiveHubs(portals,hubs,{add=true}={}){return portals.map(p=>{const out={...p,modules:[...p.modules],...(p.servoHubs?{servoHubs:[...p.servoHubs]}:{})};
    for(const h of Array.isArray(hubs)?hubs:[]){const moved=h?.parentSerial===p.serial&&h.revProductNumber===SERVO_HUB_PRODUCT&&out.modules.some(m=>m.address===h.moduleAddress&&!m.parent);if(moved)out.modules=out.modules.filter(m=>m.address!==h.moduleAddress);
      if(!add&&!moved)continue;if(h?.parentSerial!==p.serial||!Number.isInteger(h.moduleAddress)||out.modules.some(m=>m.address===h.moduleAddress)||out.servoHubs?.some(s=>s.address===h.moduleAddress))continue;
      if(h.revProductNumber===SERVO_HUB_PRODUCT)(out.servoHubs??=[]).push({address:h.moduleAddress});else out.modules.push({address:h.moduleAddress,parent:h.moduleAddress===173,imu:imuOf(String(h.imuType||''))||'UNKNOWN'});}
    return out;});}
  const imuOf=t=>/^BHI260/i.test(t)?'BHI260':/^BNO055/i.test(t)?'BNO055':/^NONE$/i.test(t)?'NONE':null;
  const withImus=(portals,hubs)=>portals.map(p=>({...p,modules:p.modules.map(m=>{if(m.imu!=='UNKNOWN')return m;
    const h=(Array.isArray(hubs)?hubs:[]).find(h=>h?.parentSerial===p.serial&&h.moduleAddress===m.address),imu=imuOf(String(h?.imuType||''));return imu?{...m,imu}:m;})}));
  const unknownImus=portals=>portals.some(p=>p.modules.some(m=>m.imu==='UNKNOWN'));
  // ---- a configured device in Java, as Blocks lists it: its SDK type, the import and the hardwareMap.get line ----------
  const JAVA={motor:['DcMotorEx','com.qualcomm.robotcore.hardware.DcMotorEx'],servo:['Servo','com.qualcomm.robotcore.hardware.Servo'],crservo:['CRServo','com.qualcomm.robotcore.hardware.CRServo'],
    imu:['IMU','com.qualcomm.robotcore.hardware.IMU'],pinpoint:['GoBildaPinpointDriver','com.qualcomm.hardware.gobilda.GoBildaPinpointDriver'],otos:['SparkFunOTOS','com.qualcomm.hardware.sparkfun.SparkFunOTOS'],
    webcam:['WebcamName','org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName'],analog:['AnalogInput','com.qualcomm.robotcore.hardware.AnalogInput'],
    touch:['TouchSensor','com.qualcomm.robotcore.hardware.TouchSensor'],digital:['DigitalChannel','com.qualcomm.robotcore.hardware.DigitalChannel'],
    color:['NormalizedColorSensor','com.qualcomm.robotcore.hardware.NormalizedColorSensor'],distance:['DistanceSensor','com.qualcomm.robotcore.hardware.DistanceSensor'],
    octoquad:['OctoQuad','com.qualcomm.hardware.digitalchickenlabs.OctoQuad'],huskylens:['HuskyLens','com.qualcomm.hardware.dfrobot.HuskyLens'],
    limelight:['Limelight3A','com.qualcomm.hardware.limelightvision.Limelight3A'],other:['HardwareDevice','com.qualcomm.robotcore.hardware.HardwareDevice']};
  const KEYWORDS=new Set(['abstract','boolean','break','byte','case','catch','char','class','const','continue','default','do','double','else','enum','extends','final','finally','float','for','goto','if','implements','import','instanceof','int','interface','long','native','new','package','private','protected','public','return','short','static','super','switch','synchronized','this','throw','throws','transient','try','void','volatile','while','true','false','null','var','record']);
  // A Java variable from a configuration name: "front_left" frontLeft, "Intake Motor" intakeMotor, "2nd arm" arm2nd.
  function variableOf(name){const w=String(name||'').replace(/([a-z0-9])([A-Z])/g,'$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean);let v=w.map((x,i)=>i?x[0].toUpperCase()+x.slice(1).toLowerCase():x.toLowerCase()).join('');
    if(!v)v='device';if(/^[0-9]/.test(v))v='device'+v[0].toUpperCase()+v.slice(1);return KEYWORDS.has(v)?v+'Device':v;}
  // {type, import, variable, get, declare}: get is the expression, declare a full line. A Blinkin is its own driver.
  function javaFor(device){const k=device?.tag==='RevBlinkinLedDriver'?['RevBlinkinLedDriver','com.qualcomm.hardware.rev.RevBlinkinLedDriver']:device?.tag==='Led'?JAVA.digital:JAVA[device?.kind]||JAVA.other;
    const variable=variableOf(device?.name),get=`hardwareMap.get(${k[0]}.class, ${JSON.stringify(String(device?.name||''))})`;return {type:k[0],import:k[1],variable,get,declare:`${k[0]} ${variable} = ${get};`};}
  // Every device of a configuration as Java: the imports, the fields and the init lines, variables kept apart.
  function javaOf(devices){const used=new Set(),list=(devices||[]).map(d=>{const j=javaFor(d);let v=j.variable,n=2;while(used.has(v))v=j.variable+n++;used.add(v);return {...j,variable:v,declare:`${j.type} ${v} = ${j.get};`,device:d};});
    return {list,imports:[...new Set(list.map(j=>j.import))].sort().map(i=>`import ${i};`),fields:list.map(j=>`private ${j.type} ${j.variable};`),init:list.map(j=>`${j.variable} = ${j.get};`)};}
  // ---- Configure Robot in Deck: the types a port of each family takes, and a configuration written again after editing
  const EDIT_TYPES={motor:Object.entries(MOTOR_TYPES).map(([tag,label])=>[tag,label]),
    servo:[['Servo','Servo'],['ServoFullRange','Servo, full range (500–2500 µs)'],['ContinuousRotationServo','Continuous rotation servo'],['RevBlinkinLedDriver','REV Blinkin LED driver'],['RevSPARKMini','REV SPARK Mini']],
    analog:[['AnalogInput','Analog input'],['OpticalDistanceSensor','Optical distance sensor']],digital:[['DigitalDevice','Digital device'],['RevTouchSensor','REV Touch Sensor'],['Led','LED']],
    i2c:[['RevColorSensorV3','REV Color Sensor V3'],['REV_VL53L0X_RANGE_SENSOR','REV 2m Distance Sensor'],['goBILDAPinpoint','goBILDA Pinpoint'],['SparkFunOTOS','SparkFun OTOS'],['OctoQuadFTC','OctoQuad'],['HuskyLens','HuskyLens'],['ControlHubImuBHI260AP','Control Hub IMU (BHI260AP)'],['LynxEmbeddedIMU','Hub IMU (BNO055)']]};
  // What each port offers, named as the Driver Hub's lists show them (FTC SDK 12.0 @MotorType/@ServoType/@DeviceProperties).
  // These are the only parts Configure offers.
  const DEVICE_TYPES={motor:EDIT_TYPES.motor.map(([t,l])=>[t,t==='Motor'?'Unspecified Motor':l]),
  servo:[['Servo','Servo'],['ContinuousRotationServo','Continuous Rotation Servo'],['RevBlinkinLedDriver','REV Blinkin LED Driver'],['RevSPARKMini','REV SPARK Mini Motor Controller']],
  digital:[['DigitalDevice','Digital Device'],['Led','LED'],['RevTouchSensor','REV Touch Sensor']],
  analog:[['AnalogInput','Analog Input'],['OpticalDistanceSensor','Optical Distance Sensor'],['ModernRoboticsAnalogTouchSensor','MR Analog Touch Sensor']],
  i2c:[['AdafruitBNO055IMU','Adafruit IMU'],['AdafruitColorSensor','Adafruit RGB Color Sensor'],['AndyMarkIMU','AndyMark IMU'],['AndyMarkColor','AndyMark Proximity & Color Sensor'],['AndyMarkTOF','AndyMark 2m TOF Lidar'],
    ['ControlHubImuBHI260AP','REV Internal IMU (BHI260AP)'],['LynxEmbeddedIMU','REV Internal IMU (BNO055)'],['RevExternalImu','REV External IMU'],['OctoQuadFTC','DigitalChickenLabs OctoQuad'],['HuskyLens','DFRobot HuskyLens'],
    ['goBILDAPinpoint','goBILDA Pinpoint Odometry Computer'],['MaxSonarI2CXL','MaxBotix MaxSonar I2CXL'],['ModernRoboticsI2cColorSensor','MR Color Sensor'],['ModernRoboticsI2cRangeSensor','MR Range Sensor'],
    ['KauaiLabsNavxMicro','navX Micro'],['REV_VL53L0X_RANGE_SENSOR','REV 2m Distance Sensor'],['RevColorSensorV3','REV Color Sensor V3'],['LynxColorSensor','REV Color/Range Sensor'],['SparkFunOTOS','SparkFun OTOS'],['QWIIC_LED_STICK','SparkFun Qwiic LED Stick']]};
  const PORT_COUNT={motor:4,servo:6,analog:4,digital:8,i2c:4};
  // A configuration's hubs against what is plugged in right now. portals: the scan (lynxModules, withLiveHubs). A hub the
  // scan found and the configuration lacks is added; one written down as the wrong kind is corrected unless it has devices
  // on it (wrong: those, for the team to move). connected: hubKey of each hub found.
  const hubKey=(portal,address)=>`${portal}|${address}`;
  function matchHubs(hubs,portals,devices=[]){const out=(hubs||[]).map(h=>({...h})),added=[],fixed=[],wrong=[],connected=new Set(),word=tag=>tag==='ServoHub'?'Servo Hub':'Expansion Hub';
    for(const p of portals||[])for(const f of [...p.modules.map(m=>({address:m.address,tag:'LynxModule',parent:!!m.parent})),...(p.servoHubs||[]).map(h=>({address:h.address,tag:'ServoHub',parent:false}))]){connected.add(hubKey(p.serial,f.address));
      const h=out.find(x=>x.portal===p.serial&&x.address===f.address);
      if(!h){const hub={name:f.parent&&p.serial==='(embedded)'?'Control Hub':`${word(f.tag)} ${f.address}`,address:f.address,tag:f.tag,portal:p.serial,parent:f.parent};out.push(hub);added.push(hub.name);continue;}
      if(h.tag===f.tag)continue;if(devices.some(d=>d.module&&d.module.portal===p.serial&&d.module.address===f.address)){wrong.push({name:h.name,is:word(f.tag)});continue;}
      if(h.name===`${word(h.tag)} ${h.address}`)h.name=`${word(f.tag)} ${h.address}`;h.tag=f.tag;fixed.push(h.name);}
    return {hubs:out,added,fixed,wrong,connected};}
  // Webcams in a configuration: under <Robot>, on no hub, known by their serial number, as Configure Robot writes them.
  const webcamsOf=xml=>[...elements(xml)].filter(e=>!e.close&&e.tag==='Webcam').map(e=>({name:e.attrs.name,serial:e.attrs.serialNumber||''}));
  function withWebcams(xml,list){const clean=String(xml).replace(/[ \t]*<Webcam\b[^>]*?\/>[ \t]*\r?\n?/g,'').replace(/[ \t]*<Webcam\b[^>]*>\s*<\/Webcam>[ \t]*\r?\n?/g,'');
    return clean.replace(/(<Robot\b[^>]*>)[ \t]*\r?\n?/,(m,tag)=>`${tag}\n${(list||[]).map(c=>`    <Webcam name="${escape(c.name)}" serialNumber="${escape(c.serial)}" />\n`).join('')}`);}
  // A hub to add to a portal, for hubs a scan cannot find yet (not plugged in, or a Servo Hub): its default address when
  // free, else the next free one of 1-10 (the SDK's range), named as Configure Robot names them. Null when all are taken.
  function newHub(hubs,tag,portal='(embedded)'){const used=new Set((hubs||[]).map(h=>h.address)),first=tag==='ServoHub'?3:2,address=[first,1,2,3,4,5,6,7,8,9,10].find(a=>!used.has(a));if(address===undefined)return null;
    return {name:`${tag==='ServoHub'?'Servo Hub':'Expansion Hub'} ${address}`,address,tag,portal,parent:false};}
  // An LED is on the port family of its type: a digital LED, a Blinkin on a servo port, a Qwiic LED Stick on I2C.
  const familyOfTag=tag=>{for(const [f,list] of Object.entries(EDIT_TYPES))if(list.some(([t])=>t===tag))return f;return tag==='QWIIC_LED_STICK'?'i2c':portFamily(kindOf(tag));};
  // The configuration with its devices replaced by `devices` ({name, tag, port, bus?, module: {portal, address,
  // servoHub?}}), anything outside a hub (a webcam, a Limelight) kept as it was. hubs: the hubs to write, when they changed.
  function rebuild(xml,devices,newHubs){
    const hubs=newHubs||parse(xml).hubs,portals=[];for(const h of hubs){let p=portals.find(x=>x.serial===h.portal);if(!p){p={serial:h.portal,modules:[],servoHubs:[]};portals.push(p);}
      if(h.tag==='ServoHub')p.servoHubs.push({address:h.address,name:h.name});else p.modules.push({address:h.address,parent:h.parent,name:h.name});}
    for(const d of devices||[])if(!validName(d.name))throw Error(`“${d.name}” cannot be a device name: use letters, digits, spaces, - and _.`);
    const names=new Set();for(const d of devices||[]){if(names.has(d.name.toLowerCase()))throw Error(`Two devices are named “${d.name}”.`);names.add(d.name.toLowerCase());}
    const out=newConfiguration(portals,(devices||[]).map(d=>({...d,device:d.bus!==undefined?'i2c':familyOfTag(d.tag)})));
    const outside=[...elements(xml)].filter(e=>!e.close&&e.attrs.name&&!CONTAINERS.has(e.tag)&&!within(e,HUBS)).map(e=>'    '+xml.slice(e.start,xml.indexOf('>',e.start)+1).replace(/\s*>$/,'').replace(/\/$/,'').trim()+' />');
    return outside.length?out.replace(/(<Robot[^>]*>)/,'$1\n'+outside.join('\n')):out;}
  // ---- Deck's wiring notes: what a configuration cannot say (a motor's gearbox, whether its encoder cable is plugged in),
  // kept in the configuration as one XML comment the SDK skips: <!-- Deck wiring: {"frontLeft":{"gear":"13.7:1","encoder":false}} -->.
  // A "-" is written \u002d so the comment never holds "--"; a Driver Hub that saves the configuration drops it.
  // The Robot Controller keeps the comment in its file but sends a Driver Station each configuration written afresh,
  // without it, so Deck's Driver Station also keeps the notes on the computer (cleanNotes checks them either way).
  const NOTES=/[ \t]*<!--\s*Deck wiring:\s*([\s\S]*?)-->[ \t]*\r?\n?/;
  function notesOf(xml){const m=NOTES.exec(String(xml||''));if(!m)return {};let v;try{v=JSON.parse(m[1]);}catch{return {};}return cleanNotes(v);}
  function cleanNotes(v){const out={};
    if(v&&typeof v==='object'&&!Array.isArray(v))for(const [name,n] of Object.entries(v)){if(!n||typeof n!=='object')continue;const keep={};if(typeof n.gear==='string'&&n.gear.length<24)keep.gear=n.gear;if(typeof n.encoder==='boolean')keep.encoder=n.encoder;if(Object.keys(keep).length)out[name]=keep;}
    return out;}
  function withNotes(xml,notes){const clean=String(xml).replace(NOTES,''),keep={};
    for(const [name,n] of Object.entries(notes||{})){const k={};if(typeof n?.gear==='string'&&n.gear)k.gear=n.gear;if(typeof n?.encoder==='boolean')k.encoder=n.encoder;if(Object.keys(k).length)keep[name]=k;}
    if(!Object.keys(keep).length)return clean;const json=JSON.stringify(keep).replace(/-/g,'\\u002d').replace(/[<>&;]/g,c=>'\\u00'+c.charCodeAt(0).toString(16));
    return clean.replace(/(<Robot\b[^>]*>)[ \t]*\r?\n?/,(m,tag)=>`${tag}\n    <!-- Deck wiring: ${json} -->\n`);}
  return {notesOf,cleanNotes,withNotes,EDIT_TYPES,DEVICE_TYPES,PORT_COUNT,familyOfTag,rebuild,javaFor,javaOf,variableOf,parse,kindOf,check,explain,fits,tokens,KINDS,PORTS,MOTOR_TYPES,IMU_TAGS,missingDevices,planPorts,portChoices,movePort,withType,portLabel,portFamily,portKeyOf:keyOf,portsTaken,tagFor,hubFor,
    addDevices,newHub,matchHubs,hubKey,discover,withLiveHubs,openHubs,removeHub,webcamsOf,withWebcams,newConfiguration,configurationFor,modulesOf,modulesFromScan,configurationName,validName,lynxSerials,otherUsb,lynxModules,withImus,unknownImus,deviceXml};
});
