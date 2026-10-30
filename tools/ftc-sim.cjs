'use strict';
// Simulated FTC Robot Controller for tests and previews. Behaves like a Control Hub on Robocol:
// answers discovery, echoes heartbeats, acknowledges commands, and runs pretend op modes.
const dgram=require('node:dgram');const R=require('../ui/ftc/robocol.js');
const OP_MODES=[
  {flavor:'AUTONOMOUS',group:'$$$$$$$',name:'Blue Auto',autoTransition:'Field Centric TeleOp',source:'ANDROID_STUDIO'},
  {flavor:'AUTONOMOUS',group:'Test',name:'Red Auto',source:'BLOCKLY'},
  {flavor:'TELEOP',group:'$$$$$$$',name:'Field Centric TeleOp',source:'ANDROID_STUDIO'},
  {flavor:'TELEOP',group:'Test',name:'Servo Tuner',source:'ONBOTJAVA'},
  {flavor:'SYSTEM',group:'$$$$$$$',name:'$Stop$Robot$',systemOpModeBaseDisplayName:'Stop Robot'}
];
// A Control Hub with an Expansion Hub, configured as the FTC SDK saves it (FIRST/competition.xml): Deck's own device
// names for a mecanum robot with Pinpoint and a turret shooter.
const CONFIG_XML=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<Robot type="FirstInspires-FTC">
    <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">
        <LynxModule name="Expansion Hub 2" port="2">
            <goBILDA5202SeriesMotor name="shooter" port="0" />
            <goBILDA5202SeriesMotor name="indexer" port="1" />
            <goBILDA5202SeriesMotor name="turret" port="2" />
            <goBILDA5202SeriesMotor name="intake" port="3" />
        </LynxModule>
        <LynxModule name="Control Hub" port="173">
            <goBILDA5202SeriesMotor name="front_left" port="0" />
            <goBILDA5202SeriesMotor name="front_right" port="1" />
            <goBILDA5202SeriesMotor name="back_left" port="2" />
            <goBILDA5202SeriesMotor name="back_right" port="3" />
            <ControlHubImuBHI260AP name="imu" port="0" bus="0" />
            <goBILDAPinpoint name="pinpoint" port="0" bus="1" />
        </LynxModule>
    </LynxUsbDevice>
</Robot>
`;
// A robot with sensors and a Servo Hub, as the FTC SDK 12.0 saves it (WriteXMLFileHandler: each hub's motors, servos,
// analog inputs, digital devices and I2C devices, in port order; a Servo Hub after the hubs; a Limelight under <Robot>).
const SENSOR_CONFIG_XML=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<Robot type="FirstInspires-FTC">
    <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">
        <LynxModule name="Expansion Hub 2" port="2">
            <goBILDA5202SeriesMotor name="lift" port="0" />
            <RevRoboticsCoreHexMotor name="turret" port="3" />
            <Servo name="claw" port="0" />
            <ServoFullRange name="wrist" port="1" />
            <ContinuousRotationServo name="roller" port="2" />
            <AnalogInput name="wristAngle" port="0" />
            <RevTouchSensor name="liftHome" port="1" />
            <DigitalDevice name="turretHome" port="2" />
            <RevColorSensorV3 name="slot" port="0" bus="1" />
        </LynxModule>
        <LynxModule name="Control Hub" port="173">
            <goBILDA5202SeriesMotor name="frontLeft" port="0" />
            <goBILDA5202SeriesMotor name="frontRight" port="1" />
            <goBILDA5202SeriesMotor name="backLeft" port="2" />
            <goBILDA5202SeriesMotor name="backRight" port="3" />
            <ControlHubImuBHI260AP name="imu" port="0" bus="0" />
            <goBILDAPinpoint name="pinpoint" port="0" bus="1" />
            <REV_VL53L0X_RANGE_SENSOR name="extendDistance" port="0" bus="2" />
        </LynxModule>
        <ServoHub name="Servo Hub 3" port="3">
            <Servo name="hood" port="0" />
        </ServoHub>
    </LynxUsbDevice>
    <EthernetDevice name="limelight" serialNumber="EthernetOverUsb:eth0:172.29.0.24" port="0" ipAddress="172.29.0.1" />
</Robot>
`;
const CONFIGURATIONS=[{name:'competition',xml:CONFIG_XML}];
// A stand-in for the guided check TeleOp (any op mode named "... check (Deck)"), for trying Deck's Guided check without a
// robot: two steps in the real check's telemetry format, answered with gamepad 1, then Done with its results line.
class CheckScript {
  constructor(){this.step=1;this.results='v1';this.position=.4;this.down={};this.turning=Date.now();}
  lines(){
    const results=`Deck results : ${this.results}`;
    if(this.step===1)return Date.now()-this.turning<1500?['Step : 1 of 2: front left wheel ("front_left")','Watch it: it turns now.',results]
      :['Step : 1 of 2: front left wheel ("front_left")','Did the front left wheel turn so the robot would drive FORWARD?','Answer : A: yes | B: no, the other way | X: nothing moved | Y: again',results];
    if(this.step===2)return ['Step : 2 of 2: intake 1 kicker servo ("kicker")',`Move the kicker DOWN, to where it scoops pieces in. Now at ${this.position.toFixed(3)}.`,'Answer : D-pad up/down: move | D-pad right/left: move more | A: save | B: keep 0.400',results];
    return ['Step : Done','Every step is done. Send to robot again from Deck to use the results.',results];
  }
  // A button counts when it goes down.
  input(g){
    const pressed=name=>!!g?.[name]&&!this.down[name];
    if(this.step===1&&Date.now()-this.turning>=1500){
      if(pressed('a'))this.answer('true');else if(pressed('b'))this.answer('false');else if(pressed('x'))this.answer('?none');else if(pressed('y'))this.turning=Date.now();}
    else if(this.step===2){
      const move=pressed('dpad_up')?.01:pressed('dpad_down')?-.01:pressed('dpad_right')?.05:pressed('dpad_left')?-.05:0;this.position=Math.round(Math.max(0,Math.min(1,this.position+move))*1000)/1000;
      if(pressed('a')){this.results+=` intakes.0.downPos=${this.position.toFixed(3)}`;this.step=3;}else if(pressed('b'))this.step=3;}
    for(const name of ['a','b','x','y','dpad_up','dpad_down','dpad_left','dpad_right'])this.down[name]=!!g?.[name];
  }
  answer(value){this.results+=` robot.frontLeft.reversed=${value}`;this.step=2;}
}
// The hubs a scan finds: hub portals (USB devices; "(embedded)" is a Control Hub's own board) and the hubs behind each,
// as LynxModuleMeta (address, whether it is the portal's parent, its IMU).
const HUBS=[{serial:'(embedded)',modules:[{moduleAddress:173,isParent:true,imuType:'BHI260'},{moduleAddress:2,isParent:false,imuType:'BNO055'}]}];
class SimController {
  constructor({send,version=R.VERSION,reject=false,opModes=OP_MODES,battery='12.84',configurations=CONFIGURATIONS,active='competition',hubs=HUBS,usb=[]}={}){
    this.usb=usb;this.camera=null;this.frameNum=0;
    this.send=send;this.version=version;this.reject=reject;this.opModes=opModes;this.battery=battery;this.configurations=structuredClone(configurations);this.active=active;this.hubs=hubs;this.seq=0;this.stamp=1n;
    this.peer=false;this.lastPacket=0;this.opMode=R.STOP_OP_MODE;this.opState='stopped';this.gamepads={};this.commands=[];this.pending=[];this.timers=[];this.robotState=0;this.heartbeats=0;this.restarts=0;
  }
  start(){this.timers.push(setInterval(()=>this.loop(),50),setInterval(()=>this.telemetry(),250));return this;}
  stop(){for(const t of this.timers)clearInterval(t);this.timers=[];}
  next(){this.seq=(this.seq+1)&0xffff;return this.seq;}
  command(name,extra=''){const c={name,extra,timestamp:this.stamp++,seq:this.next(),sent:0,tries:0};this.pending.push(c);this.flush();}
  flush(){const now=Date.now();this.pending=this.pending.filter(c=>{if(c.tries>10)return false;if(now-c.sent>200){c.tries++;c.sent=now;this.send(R.encodeCommand(c));}return true;});}
  loop(){if(this.peer&&Date.now()-this.lastPacket>2000){this.peer=false;if(this.opMode!==R.STOP_OP_MODE)this.setOpMode(R.STOP_OP_MODE,'stopped',true);}this.flush();}
  setOpMode(name,state,quiet=false){const streaming=state!=='stopped';if(streaming!==(this.opState!=='stopped')&&!quiet)this.command('CMD_STREAM_CHANGE',String(streaming));this.opMode=name;this.opState=state;this.robotState=state==='running'?2:state==='init'?1:0;
    this.check=state==='running'&&/ check \(Deck\)$/.test(name)?this.check||new CheckScript():null;if(!quiet)this.command(state==='running'?'CMD_NOTIFY_RUN_OP_MODE':'CMD_NOTIFY_INIT_OP_MODE',name);}
  telemetry(){
    if(!this.peer)return;
    this.send(R.encodeTelemetry({tag:R.Tags.BATTERY,robotState:this.robotState,strings:[[R.Tags.BATTERY,this.battery]]}));
    if(this.opState==='stopped')return;
    if(this.check){this.send(R.encodeTelemetry({robotState:this.robotState,strings:this.check.lines().map((line,i)=>['\0'+String.fromCharCode(0x180+i),line])}));return;}
    const g=this.gamepads[1];
    this.send(R.encodeTelemetry({robotState:this.robotState,strings:[['\0ƀ',`Op mode : ${this.opMode}`],['\0Ɓ',`State : ${this.opState}`],['\0Ƃ',`Gamepad 1 left_stick_y : ${(g?.left_stick_y??0).toFixed(2)}`],['\0ƃ',`Gamepad 1 a : ${!!g?.a}`]]}));
  }
  receive(bytes){
    let p;try{p=R.decode(bytes);}catch{return;}this.lastPacket=Date.now();
    if(p.type===R.Msg.PEER_DISCOVERY){
      const accepted=!this.reject&&p.version===this.version;this.send(R.encodePeerDiscovery({seq:this.next(),version:this.version,peerType:this.reject?R.PeerType.REJECTED:R.PeerType.PEER,month:9,year:2025,major:11,minor:0}));
      if(accepted&&!this.peer){this.peer=true;if(this.opMode!==R.STOP_OP_MODE)this.command(this.opState==='running'?'CMD_NOTIFY_RUN_OP_MODE':'CMD_NOTIFY_INIT_OP_MODE',this.opMode);}return;
    }
    if(!this.peer)return;
    if(p.type===R.Msg.HEARTBEAT){this.heartbeats++;this.send(R.encodeHeartbeat({...p,seq:p.seq,robotState:this.robotState,t1:Date.now(),t2:Date.now()}));}
    else if(p.type===R.Msg.GAMEPAD){if(p.user===1||p.user===2)this.gamepads[p.user]=p;if(p.user===1)this.check?.input(p);}
    else if(p.type===R.Msg.COMMAND){
      if(p.acknowledged){this.pending=this.pending.filter(c=>!(c.name===p.name&&c.timestamp===p.timestamp));return;}
      this.send(R.encodeCommand({...p,acknowledged:true}));
      if(this.commands.some(c=>c.name===p.name&&c.timestamp===p.timestamp))return;this.commands.push(p);this.handle(p.name,p.extra);
    }
  }
  // A RobotConfigFile as the SDK serializes it (Gson): its name, location and whether it has unsaved changes.
  configFile(name){return {name,resourceId:0,location:'LOCAL_STORAGE',isDirty:false};}
  activate(name){this.active=name;this.command('CMD_NOTIFY_ACTIVE_CONFIGURATION',JSON.stringify(this.configFile(name)));}
  handle(name,extra){
    if(name==='CMD_REQUEST_OP_MODE_LIST'){this.command('CMD_NOTIFY_OP_MODE_LIST',JSON.stringify(this.opModes));this.send(R.encodeTelemetry({tag:R.Tags.NONE,strings:[[R.Tags.NONE,'']]}));}
    else if(name==='CMD_REQUEST_ACTIVE_CONFIG')this.command('CMD_NOTIFY_ACTIVE_CONFIGURATION',JSON.stringify(this.configFile(this.active)));
    // Robot configurations as FtcEventLoopBase answers them: the list, then one configuration's XML by its entry.
    else if(name==='CMD_REQUEST_CONFIGURATIONS')this.command('CMD_REQUEST_CONFIGURATIONS_RESP',JSON.stringify(this.configurations.map(c=>this.configFile(c.name))));
    else if(name==='CMD_REQUEST_PARTICULAR_CONFIGURATION'){let want=null;try{want=JSON.parse(extra).name;}catch{}const c=this.configurations.find(c=>c.name===want);if(c)this.command('CMD_REQUEST_PARTICULAR_CONFIGURATION_RESP',c.xml);}
    // Configure Robot's Scan: the USB devices (ScannedDevices), then the hubs behind one (LynxModuleMetaList).
    else if(name==='CMD_SCAN')this.command('CMD_SCAN_RESP',JSON.stringify({map:[...this.hubs.map(h=>({key:h.serial,value:'LYNX_USB_DEVICE'})),...this.usb.map(d=>({key:d.serial,value:d.type}))]}));
    // The Camera Stream: a frame in base64 chunks, as CameraStreamServer sends it (a small picture, not a JPEG, for tests).
    else if(name==='CMD_REQUEST_FRAME'&&this.camera){const bytes=this.camera();if(bytes){const frameNum=++this.frameNum;this.command('CMD_RECEIVE_FRAME_BEGIN',JSON.stringify({frameNum,length:bytes.length,numChunks:Math.ceil(bytes.length/4000),quality:75}));for(let at=0,chunkNum=0;at<bytes.length;at+=4000,chunkNum++)this.command('CMD_RECEIVE_FRAME_CHUNK',JSON.stringify({frameNum,chunkNum,encodedData:bytes.subarray(at,at+4000).toString('base64')}));}}
    else if(name==='CMD_DISCOVER_LYNX_MODULES')this.command('CMD_DISCOVER_LYNX_MODULES_RESP',JSON.stringify({serialNumber:extra,modules:this.hubs.find(h=>h.serial===extra)?.modules||[]}));
    // Save writes FIRST/<name>.xml, replacing one of that name, and makes it active; as in the SDK, the text is split at
    // every ";" and only what comes before the second one is kept.
    else if(name==='CMD_SAVE_CONFIGURATION'){const [file,xml]=extra.split(';');let config=null;try{config=JSON.parse(file);}catch{}if(!config?.name||xml===undefined)return;
      const old=this.configurations.find(c=>c.name===config.name);if(old)old.xml=xml;else this.configurations.push({name:config.name,xml});this.activate(config.name);}
    // Delete removes FIRST/<name>.xml; deleting the active one leaves the robot with none.
    else if(name==='CMD_DELETE_CONFIGURATION'){let config=null;try{config=JSON.parse(extra);}catch{}const at=this.configurations.findIndex(c=>c.name===config?.name);if(at<0)return;this.configurations.splice(at,1);if(this.active===config.name)this.activate('No Config Set');}
    // Self Inspect: the Robot Controller's InspectionState.
    else if(name==='CMD_REQUEST_INSPECTION_REPORT')this.command('CMD_REQUEST_INSPECTION_REPORT_RESP',JSON.stringify({deviceName:'9999-C-RC',manufacturer:'REV Robotics',model:'Control Hub v1.0',osVersion:'7.1.2',sdkInt:25,controlHubOsVersion:'1.1.6',firmwareVersion:'1.8.2',robotControllerVersion:'11.0',batteryFraction:1,wifiEnabled:true,wifiDirectEnabled:false,bluetoothOn:false,airplaneModeOn:false,isDefaultPassword:false}));
    else if(name==='CMD_ACTIVATE_CONFIGURATION'){let config=null;try{config=JSON.parse(extra);}catch{}if(this.configurations.some(c=>c.name===config?.name))this.activate(config.name);}
    else if(name==='CMD_INIT_OP_MODE')this.setOpMode(extra,extra===R.STOP_OP_MODE?'stopped':'init');
    else if(name==='CMD_RUN_OP_MODE'){if(this.opMode!==extra)this.setOpMode(extra,'init');this.setOpMode(extra,'running');}
    else if(name==='CMD_RESTART_ROBOT'){this.restarts++;this.setOpMode(R.STOP_OP_MODE,'stopped');this.command('CMD_SHOW_TOAST',JSON.stringify({message:'Restarting Robot',duration:1}));}
    else if(name==='CMD_REQUEST_FRAME'){const jpeg=Buffer.from(SAMPLE_JPEG,'base64');this.command('CMD_RECEIVE_FRAME_BEGIN',JSON.stringify({frameNum:1,length:jpeg.length}));this.command('CMD_RECEIVE_FRAME_CHUNK',JSON.stringify({frameNum:1,chunkNum:0,encodedData:jpeg.toString('base64')}));}
    else if(name==='CMD_REQUEST_ABOUT_INFO')this.command('CMD_REQUEST_ABOUT_INFO_RESP',JSON.stringify({appVersion:'11.0',libVersion:'11.0',networkProtocolVersion:String(this.version),buildTime:'2025-09-01',networkConnectionInfo:'Simulated Control Hub',osVersion:'7.1.2'}));
  }
}
// 160x120 colour-bar JPEG used as the simulated camera frame.
const SAMPLE_JPEG='/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAB4AKADASIAAhEBAxEB/8QAGgABAAMBAQEAAAAAAAAAAAAAAAMFBwYEAv/EAC4QAQAAAwUHAgYDAAAAAAAAAAABAgMEBQYzNjI0coGCsbJUkxEUFTFV0RJRkv/EABoBAAIDAQEAAAAAAAAAAAAAAAAFAwQGAgH/xAAqEQEAAQEECgMAAwAAAAAAAAAAAQUCAwQ0ETEyM0JxcoGxwRJBUSEiYf/aAAwDAQACEQMRAD8A5QBrkAubm3Sbjj2gplzc26Tcce0Cqs5WecK2K3awAZEtR1sqZ5XqrZUzypbGprqBlrXVPiAB0eO1AZ4kEtPZ5oktPZ5r1N3/AGR3uy+gGhVlLjDTFs6POVmLTsYaYtnR5ysxAAAFiA1yAXNzbpNxx7QUy5ubdJuOPaBVWcrPOFbFbtYAMiWo62VM8r1VsqZ5UtjU11Ay1rqnxAA6PHagM8SCWns80SWns816m7/sjvdl9ANCrKXGGmLZ0ecrMWnYw0xbOjzlZiAAALEBrkAubm3Sbjj2gplzc26Tcce0Cqs5WecK2K3awAZEtR1sqZ5XqrZUzypbGprqBlrXVPiAB0eO1AZ4kEtPZ5oktPZ5r1N3/ZHe7L6AaFWUuMNMWzo85WYtOxhpi2dHnKzEAAAWIDXIBc3Nuk3HHtBTLm5t0m449oFVZys84VsVu1gAyJajrZUzyvVWypnlS2NTXUDLWuqfEADo8dqAzxIJaezzRJaezzXqbv8Asjvdl9ANCrKXGGmLZ0ecrMWnYw0xbOjzlZiAAALEBrkAubm3Sbjj2gplzc26Tcce0Cqs5WecK2K3awAZEtR1sqZ5XqrZUzypbGprqBlrXVPiAB0eO1AZ4kEtPZ5oktPZ5r1N3/ZHe7L6AaFWUuMNMWzo85WYtOxhpi2dHnKzEAAAWIDXIBc3Nuk3HHtBTLm5t0m449oFVZys84VsVu1gAyJajrZUzyvVWypnlS2NTXUDLWuqfEADo8dqAzxIJaezzRJaezzXqbv+yO92X0A0KspcYaYtnR5ysxadjDTFs6POVmIAAAsWmfS7u9BZfZl/TM2rnFTtTHw0T++kdhlDUJLDY6cPhTslCWH3+EtOEGXtXeVXVZjn6FiInW5F1Hylm9PS/wAQcu65ncNETp0qOAiJ+Wn/AD242tlTOr+RsfpaHtwcpWypnZPcNH8St4G1MYaNE8U+LLg3a/I2P0tD24OKd47uY1nlRtTHx0T++kCb+MP6ghTltLsxa+emPz2o306kCeEIQ+yBO9pUR/eeXsX30AHCBS4w0xbOjzle36Pdf42x+xL+nixhpi2dHnKugGLtb+j3X+NsfsS/pkjaAGUNXA3qvB39I7DKGrgKrwd/QsORdcDPYb7Uqfxdvbja2VM7IHuG1Ss4LLR1T4suDd4Dq5+zypcPf0gTgXUrj7e1K++kCcBSuPt7F99ABwgUuMNMWzo85V0ADF20AA//2Q==';
// UDP robot bound to its own loopback address so a station on 127.0.0.1 can use the same port.
async function startUdpRobot({address='127.0.0.2',...options}={}){
  const socket=dgram.createSocket('udp4');await new Promise((ok,fail)=>{socket.once('error',fail);socket.bind(R.PORT,address,ok);});
  let station=null;const sim=new SimController({...options,send:bytes=>{if(station)socket.send(bytes,R.PORT,station);}});
  socket.on('message',(msg,from)=>{if(from.port!==R.PORT)return;station=from.address;sim.receive(new Uint8Array(msg.buffer,msg.byteOffset,msg.length));});
  sim.start();return {sim,address,close:()=>{sim.stop();return new Promise(r=>socket.close(r));}};
}
// The op modes in OnBot Java sources, as the robot lists them after a build: each @Autonomous or @TeleOp class not
// marked @Disabled, by its annotation's name and group.
function opModesIn(files){
  const out=[];for(const text of Object.values(files)){if(/^\s*@Disabled\b/m.test(text))continue;
    const m=/@(Autonomous|TeleOp)\s*\(((?:"(?:\\.|[^"\\])*"|[^)"])*)\)/.exec(text),attr=key=>(new RegExp(`\\b${key}\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(m?.[2]||'')||[])[1];
    if(m&&attr('name'))out.push({flavor:m[1]==='Autonomous'?'AUTONOMOUS':'TELEOP',group:attr('group')||'$$$$$$$',name:attr('name').replace(/\\(.)/g,'$1'),source:'ONBOTJAVA'});}
  return out;
}
// The Control Hub's OnBot Java server (port 8080) as Send to robot uses it, from the handlers in FTC SDK 12.0's OnBotJava
// library: files kept in memory under /src, and builds that succeed unless compile(files) returns error lines (javac's
// "File.java:12: error: ..." format). built(files) runs after each successful build.
function startOnBotJava({address='127.0.0.2',port=8080,compile=()=>[],buildMs=150,built=()=>{}}={}){
  const http=require('node:http'),files=new Map(),state={running:false,completed:true,successful:true,startTimestamp:0,log:''},counts={builds:0,saves:0};
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://robot'),reply=(status,text,type='text/plain')=>{res.writeHead(status,{'Content-Type':type});res.end(text);},f=url.searchParams.get('f');
    if(url.pathname==='/java/build/status')return reply(200,JSON.stringify({completed:state.completed,running:state.running,successful:state.successful,timestamp:Date.now(),startTimestamp:state.startTimestamp}),'application/json');
    if(url.pathname==='/java/build/start'){if(state.running)return reply(500,'Server Error');counts.builds++;Object.assign(state,{running:true,completed:false,startTimestamp:Date.now()});
      setTimeout(()=>{const all=Object.fromEntries(files),errors=compile(all);Object.assign(state,{running:false,completed:true,successful:!errors.length,log:errors.length?errors.join('\n')+`\n${errors.length} error${errors.length>1?'s':''}`:'Build SUCCEEDED'});if(!errors.length)built(all);},buildMs);
      return reply(200,JSON.stringify(state.startTimestamp),'application/json');}
    if(url.pathname==='/java/build/log')return reply(200,state.log);
    if(url.pathname==='/java/file/get')return files.has(f)?reply(200,files.get(f)):reply(404,'File Not Found!');
    if(url.pathname==='/java/file/save'&&req.method==='POST'){let body='';for await(const c of req)body+=c;const data=new URLSearchParams(body).get('data');
      if(!f?.startsWith('/src/')||data===null)return reply(400,'{"success":"false"}','application/json');files.set(f,data);counts.saves++;return reply(200,'{"success":"true"}','application/json');}
    reply(404,'File Not Found!');
  });
  return new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,address,()=>ok({files,state,counts,port:server.address().port,close:()=>new Promise(r=>server.close(()=>r()))}));});
}
// A robot whose op mode list includes what OnBot Java last built, announced to a connected station as the SDK does.
function listBuilt(sim){const base=sim.opModes.filter(m=>m.source!=='ONBOTJAVA');return files=>{sim.opModes=[...base,...opModesIn(files)];if(sim.peer)sim.command('CMD_NOTIFY_OP_MODE_LIST',JSON.stringify(sim.opModes));};}
// Torque Debug (src/onbot/TorqueDebug.java) as the robot runs it, for tests: while the simulated robot runs its "TorqueDebug-..."
// op mode, port 20886 answers with the devices of a configuration (one JSON line) and then readings every 20 ms, and
// takes Deck's commands (M, C, S, E, L, R, Q, T, X, P) with the same 300 ms watchdog (a motor power lasts 300 ms unless sent again). Motors turn at 2800 ticks/s at
// full power; a switch named …home or …limit is pressed (active-low, reads 0) while the first mechanism motor is below
// 100 ticks; a colour sensor sees a piece while a motor named intake runs; an analog input follows the first servo.
// commands lists every line Deck sent, for tests to check.
function startDebugServer({address='127.0.0.2',sim,xml=CONFIG_XML,port=20886}={}){
  const net=require('node:net'),RobotConfig=require('../ui/ftc/robot-config.js'),devices=RobotConfig.parse(xml).devices.filter(d=>d.module||d.bus!==undefined);
  const of=(fam,test=()=>true)=>devices.filter(d=>RobotConfig.familyOfTag(d.tag)===fam&&test(d)).map(d=>d.name);
  const I2C={RevColorSensorV3:'color',REV_VL53L0X_RANGE_SENSOR:'distance',goBILDAPinpoint:'pinpoint',SparkFunOTOS:'otos',ControlHubImuBHI260AP:'imu',LynxEmbeddedIMU:'imu'};
  const m={deck:'debug',version:1,motors:of('motor'),servos:of('servo',d=>d.tag!=='ContinuousRotationServo'),crservos:of('servo',d=>d.tag==='ContinuousRotationServo'),digital:of('digital',d=>d.tag!=='RevTouchSensor'),touch:of('digital',d=>d.tag==='RevTouchSensor'),
    analog:of('analog').map(n=>({n,max:3.3})),i2c:devices.filter(d=>I2C[d.tag]).map(d=>({n:d.name,k:I2C[d.tag]})),hubs:[{n:'Control Hub',address:173,parent:true}]};
  // A webcam in the configuration: the SDK's camera as ui/sim-camera.js models it, one tag in view at 4 ft.
  const Cam=require('../ui/sim-camera.js'),webcams=[...xml.matchAll(/<Webcam\b[^>]*\bname="([^"]*)"/g)].map(x=>x[1]);m.cameras=webcams;let camera={exposure:'auto',gain:100,decimation:3,feet:4},camNum=0;
  if(webcams.length&&sim){sim.camera=()=>Cam.simFrame(camNum++,.6);sim.command?.('CMD_STREAM_CHANGE','true');}
  const pos=m.motors.map(()=>0),power=m.motors.map(()=>0),at=m.motors.map(()=>0),cr=m.crservos.map(()=>0),servo=m.servos.map(()=>null),on=m.servos.map(()=>false),latched=m.servos.map(()=>false),commands=[];
  let client=null,heard=0,loop=null,t0=Date.now(),timer=null;const running=()=>/^TorqueDebug-/.test(sim.opMode||'')&&sim.opState==='running';
  const mech=Math.max(0,m.motors.findIndex(n=>!/front|back|left|right/.test(n)));
  const apply=line=>{commands.push(line);const f=line.split('\t'),i=k=>m[k].indexOf(f[1]);
    if(f[0]==='M'&&i('motors')>=0){power[i('motors')]=Math.max(-1,Math.min(1,+f[2]||0));at[i('motors')]=Date.now();if(loop?.index===i('motors'))loop=null;}
    else if(f[0]==='C'&&i('crservos')>=0)cr[i('crservos')]=Math.max(-1,Math.min(1,+f[2]||0));
    else if(f[0]==='S'&&i('servos')>=0){servo[i('servos')]=Math.max(0,Math.min(1,+f[2]||0));on[i('servos')]=true;}
    else if(f[0]==='E'&&i('servos')>=0)on[i('servos')]=f[2]==='1'&&servo[i('servos')]!==null;
    else if(f[0]==='L'&&i('servos')>=0)latched[i('servos')]=f[2]==='1';
    else if(f[0]==='R'&&i('motors')>=0)pos[i('motors')]=0;
    else if(f[0]==='Q'){const index=m.motors.indexOf(f[1]);if(index>=0)loop={index,target:+f[4],kP:+f[5],kI:+f[6],kD:+f[7],kS:+f[9],kG:+f[10],tol:+f[11],integral:0,last:null};}
    else if(f[0]==='T'&&loop)loop.target=+f[1];
    else if(f[0]==='V')camera={...camera,...(f[1]==='auto'?{exposure:'auto'}:{exposure:+f[1],gain:+f[2]})};
    else if(f[0]==='D')camera={...camera,decimation:+f[1]};
    else if(f[0]==='X')stopAll();};
  const stopAll=()=>{loop=null;power.fill(0);cr.fill(0);m.servos.forEach((_,k)=>{if(!latched[k])on[k]=false;});};
  const tick=()=>{if(!running()){if(client){client.destroy();client=null;}stopAll();return;}
    if(!client||Date.now()-heard>300)stopAll();
    power.forEach((p,k)=>{if(Date.now()-at[k]>300&&loop?.index!==k)power[k]=0;});
    if(loop){const e=loop.target-pos[loop.index],d=loop.last===null?0:(e-loop.last)/.02;loop.last=e;loop.integral+=e*.02;power[loop.index]=Math.max(-1,Math.min(1,loop.kP*e+loop.kI*loop.integral+loop.kD*d+loop.kG+(Math.abs(e)>loop.tol?loop.kS*Math.sign(e):0)));}
    power.forEach((p,k)=>{pos[k]+=Math.sign(p)*Math.max(0,Math.abs(p)-.04)*2800*.02;});
    if(!client)return;const intake=m.motors.findIndex(n=>/intake/i.test(n)),piece=intake>=0&&Math.abs(power[intake])>.2,home=pos[mech]<100;
    const frame={t:Date.now()-t0,loop:6.2,v:12.6,m:m.motors.map((n,k)=>[Math.round(pos[k]),Math.round(Math.sign(power[k])*Math.max(0,Math.abs(power[k])-.04)*2800/20)*20,power[k],Math.abs(power[k])*2,0]),
      s:m.servos.map((n,k)=>[servo[k],on[k]?1:0,latched[k]?1:0]),c:cr,d:m.digital.map(n=>/home|limit/i.test(n)?(home?0:1):1),touch:m.touch.map(()=>0),a:m.analog.map(()=>servo[0]!==null&&on[0]?+(servo[0]*3.3).toFixed(4):1.65),
      i:m.i2c.map(d=>({age:10,v:d.k==='color'?{r:.1,g:.1,b:.1,a:piece?.6:.05,d:piece?2:8}:d.k==='distance'?{d:piece?3:20}:d.k==='pinpoint'?{x:0,y:0,h:0,ex:0,ey:0,status:'READY'}:d.k==='otos'?{x:0,y:0,h:0}:{yaw:0,pitch:0,roll:0,wz:0}}))};
    if(webcams.length){const hit=Math.random()<Cam.simRate(camera);frame.cam={state:'STREAMING',fps:Cam.fpsOf(camera.decimation),range:[1,100,0,255],exp:camera.exposure==='auto'?null:camera.exposure,gain:camera.exposure==='auto'?null:camera.gain,dec:camera.decimation,tags:hit?[{id:584,name:'Simulated tag',m:60,r:48,b:0,y:0}]:[]};}
    client.write(JSON.stringify(frame)+'\n');};
  const server=net.createServer(s=>{if(!running()){s.destroy();return;}if(client)client.destroy();client=s;heard=Date.now();t0=Date.now();s.setNoDelay(true);s.write(JSON.stringify(m)+'\n');
    let buffer='';s.on('data',c=>{heard=Date.now();buffer+=c;for(let k;(k=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,k);buffer=buffer.slice(k+1);if(line)apply(line);}});
    s.on('close',()=>{if(client===s){client=null;stopAll();}});s.on('error',()=>{});});
  return new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,address,()=>{timer=setInterval(tick,20);ok({manifest:m,commands,camera:()=>camera,positions:pos,close:()=>{clearInterval(timer);client?.destroy();return new Promise(r=>server.close(()=>r()));}});});});
}
module.exports={SimController,CheckScript,startUdpRobot,startOnBotJava,opModesIn,listBuilt,startDebugServer,OP_MODES,CONFIG_XML,SENSOR_CONFIG_XML,HUBS};
if(require.main===module){const address=process.argv.slice(2).find(a=>!a.startsWith('--'))||'127.0.0.2';
  // --empty starts a robot with no configuration; --onbot also serves OnBot Java on port 8080. Together they try the
  // whole of Send to robot without a robot.
  const empty=process.argv.includes('--empty');
  startUdpRobot({address,...(empty?{configurations:[],active:'No Config Set'}:{})}).then(robot=>{console.log(`Simulated FTC Robot Controller on ${address}:${R.PORT}${empty?', with no configuration':''}`);
    if(process.argv.includes('--onbot'))return startOnBotJava({address,built:listBuilt(robot.sim)}).then(s=>console.log(`Simulated OnBot Java on http://${address}:${s.port}`)).catch(e=>console.error('OnBot Java: '+e.message));}).catch(e=>{console.error(e.message);process.exit(1);});}
