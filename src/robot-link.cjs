'use strict';
// Send to robot: what the app does with a Control Hub over its Wi-Fi, for the simulator's exports.
//  - Reads the robot configuration as a Driver Station does (Robocol commands from FTC SDK 12.0's FtcEventLoopBase):
//    CMD_REQUEST_CONFIGURATIONS lists the saved configurations, CMD_NOTIFY_ACTIVE_CONFIGURATION names the active one, and
//    CMD_REQUEST_PARTICULAR_CONFIGURATION returns its XML.
//  - Uploads and builds code with the hub's own OnBot Java server on port 8080 (handlers from FTC SDK 12.0's OnBotJava
//    library): POST /java/file/save?f=/src/<path> with the form field data, GET /java/file/get?f=..., and
//    /java/build/start, /java/build/status ({completed, running, successful, startTimestamp, timestamp}) and
//    /java/build/log.
//  - Scans the robot's hubs as Configure Robot's Scan does (CMD_SCAN, then CMD_DISCOVER_LYNX_MODULES for each hub portal),
//    and saves a configuration with CMD_SAVE_CONFIGURATION, which the robot writes, makes active and announces with
//    CMD_NOTIFY_ACTIVE_CONFIGURATION. Only under a name the robot does not have yet: a saved configuration is never replaced.
//  - Runs the guided check TeleOp when the person asks (runCheck). It never starts the autonomous.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const Robocol=require('../ui/ftc/robocol.js'),RobotConfig=require('../ui/ftc/robot-config.js'),{FtcSocket}=require('./ftc.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
// A robot address: an IP address or a host name, nothing else (no scheme, port or path).
function checkHost(host){const h=String(host||'').trim();if(!net.isIP(h)&&!/^[A-Za-z0-9]([A-Za-z0-9-]{0,62}\.)*[A-Za-z0-9-]{1,63}$/.test(h))throw Error('Enter the robot address, such as 192.168.43.1.');return h;}

// ---- a Driver Station session, over Robocol
// Connects as a Driver Station, runs task, then disconnects. ask(command, extra) sends a command and waits for the
// robot's next <command>_RESP; until(test) waits for the station's state to pass test; sent(command) waits until the
// robot has acknowledged a command.
async function session(host,task,{timeout=8000,socket=null}={}){
  host=checkHost(host);
  let link=socket;if(!link){try{link=await new FtcSocket(host).open();}catch(e){throw Error(/in use/.test(e.message)?'Another FTC Driver Station on this computer is using the robot connection. Close the robot in Drive (or the other app) and try again.':e.message);}}
  const ds=new Robocol.DriverStation({send:bytes=>link.send(bytes)}),off=link.onPacket(bytes=>ds.receive(bytes)),answers=new Map(),waiters=[];
  ds.on('command',c=>{answers.set(c.name,c.extra);for(const w of [...waiters])if(w.name===c.name){waiters.splice(waiters.indexOf(w),1);w.done(c.extra);}});
  const answer=(name,ms=timeout)=>answers.has(name)?Promise.resolve(answers.get(name)):new Promise((done,fail)=>{const w={name,done:v=>{clearTimeout(t);done(v);}},t=setTimeout(()=>{waiters.splice(waiters.indexOf(w),1);fail(Error(`The robot did not answer ${name}.`));},ms);waiters.push(w);});
  const ask=(name,extra='',ms=timeout)=>{answers.delete(name+'_RESP');ds.command(name,extra);return answer(name+'_RESP',ms);};
  const until=(test,ms,message)=>new Promise((done,fail)=>{if(test(ds.state))return done(ds.state);const stop=ds.on('state',s=>{if(test(s)){clearTimeout(t);stop();done(s);}}),t=setTimeout(()=>{stop();fail(Error(message));},ms);});
  const sent=(command,ms=timeout)=>new Promise((done,fail)=>{const began=Date.now(),end=error=>{clearInterval(t);stop();error?fail(error):done();};
    const stop=ds.on('command-failed',c=>{if(c===command)end(Error(`The robot did not take ${command.name}.`));});
    const t=setInterval(()=>{if(!ds.pending.includes(command))end();else if(Date.now()-began>ms)end(Error(`The robot did not take ${command.name}.`));},20);});
  try{
    ds.start();
    const s=await until(s=>['connected','rejected','incompatible'].includes(s.connection),host==='usb'?Math.max(timeout,30000):timeout,host==='usb'?'The Robot Controller app on the Control Hub did not answer over the USB cable. Restart the robot, then try again.':`No FTC robot answered at ${host}. Join the robot's Wi-Fi and check the Robot Controller app is running.`);
    if(s.connection==='rejected')throw Error('Another Driver Station is connected to this robot. Disconnect it, then try again.');
    if(s.connection==='incompatible')throw Error(`This robot runs an FTC SDK older than this app supports (Robocol ${s.robot?.robocol}).`);
    return await task({ds,ask,answer,until,sent,host});
  }finally{ds.stop();off();if(!socket)await link.close();}
}
const configFile=name=>({name,resourceId:0,location:'LOCAL_STORAGE',isDirty:false});
// The saved configurations (RobotConfigFile entries) and the active one's name.
async function configurations({ask,until},timeout){
  const list=JSON.parse(await ask('CMD_REQUEST_CONFIGURATIONS')),files=Array.isArray(list)?list.filter(c=>c&&typeof c.name==='string'):[];
  // On connecting the station asks for the op modes and the active configuration.
  const active=(await until(s=>s.activeConfig,timeout,'The robot did not say which configuration is active.')).activeConfig.name;
  return {files,active};
}
// The robot's hubs: each hub portal's serial number ("(embedded)" for a Control Hub's own board) and the hubs behind it.
// IMUs the scan answers UNKNOWN come from the robot's web server (RobotConfig.withImus).
async function scanHubs(ask,host){
  const serials=RobotConfig.lynxSerials(await ask('CMD_SCAN','',20000)),portals=[];
  for(const serial of serials)portals.push(await RobotConfig.discover(()=>ask('CMD_DISCOVER_LYNX_MODULES',serial,20000)));
  const live=await rcHubs(host),found=RobotConfig.withLiveHubs(portals,live).filter(p=>p.modules.length);
  return RobotConfig.unknownImus(found)?RobotConfig.withImus(found,live):found;
}
// The hubs the Robot Controller's web server lists (/js/rcInfo.json revHubNamesAndVersions); none when it cannot be read.
async function rcHubs(host){
  try{const at=host==='usb'?{host:'127.0.0.1',port:(await usbForward()).port}:{host:checkHost(host),port:8080};
    const r=await request(at.host,'GET','/js/rcInfo.json',undefined,{port:at.port,timeout:4000}),hubs=r.status===200?JSON.parse(r.text).revHubNamesAndVersions:null;
    return Array.isArray(hubs)?hubs:[];}catch{return [];}
}

// Every hub on the robot right now, from the robot itself: no configuration read, nothing started, nothing changed.
// Configure Robot's Scan, exactly: what answers on the wire now. A hub the robot has open but that does not answer is not
// counted; its web server only corrects a product number the scan failed to read.
// live: the web server's list when already read. onProgress({portals, others}): after each answer, to show it at once.
const scanDevices=(host,{timeout=8000,socket=null,live=null,onProgress}={})=>session(host,async link=>{const [scan,open]=await Promise.all([link.ask('CMD_SCAN','',20000),live||rcHubs(host)]),portals=[],others=RobotConfig.otherUsb(scan);
  const result=list=>{const found=RobotConfig.withLiveHubs(list,open,{add:false}).filter(p=>p.modules.length);return {portals:RobotConfig.unknownImus(found)?RobotConfig.withImus(found,open):found,others};};
  for(const serial of RobotConfig.lynxSerials(scan)){const i=portals.length;portals.push(await RobotConfig.discover(()=>link.ask('CMD_DISCOVER_LYNX_MODULES',serial,20000),{expect:open.filter(h=>h?.parentSerial===serial).map(h=>h.moduleAddress),onAnswer:p=>{const so=[...portals];so[i]=p;onProgress?.(result(so));}}));}
  return result(portals);},{timeout:Math.max(timeout,8000),socket});
const scanRobot=(host,{timeout=8000,socket=null}={})=>session(host,link=>scanHubs(link.ask,host),{timeout:Math.max(timeout,8000),socket});
// ---- the robot configuration
// The active configuration's devices and hubs. scan: also scan the robot's hubs (portals), to add devices or to make
// a configuration for a robot that has none.
async function readRobot(host,{timeout=8000,socket=null,scan=false}={}){
  return session(host,async link=>{
    const {ask,ds}=link,{files,active:activeName}=await configurations(link,timeout),active=files.find(c=>c.name===activeName)||null,names=files.map(c=>c.name);
    const portals=scan?await scanHubs(ask,host):undefined,extra=portals?{portals}:{};
    if(!active)return {robot:ds.state.robot,configurations:names,active:null,devices:[],hubs:[],opModes:ds.state.opModes,...extra};
    const xml=await ask('CMD_REQUEST_PARTICULAR_CONFIGURATION',JSON.stringify(active)),parsed=RobotConfig.parse(xml);
    return {robot:ds.state.robot,configurations:names,active:{name:active.name,dirty:!!active.isDirty},xml,...parsed,opModes:ds.state.opModes,...extra};
  },{timeout,socket});
}
// Saves xml as a new configuration and makes it active (the robot announces it), reads it back, then restarts the robot
// so its hardware map is built from it. A name the robot already has is refused.
async function writeConfiguration(host,{name,xml,replace=false}={},{timeout=8000,socket=null,restart=true}={}){
  if(!RobotConfig.validName(name))throw Error('A configuration name has letters, digits, spaces, - and _ only (up to 40).');
  // A Robocol command carries at most 64 KB.
  if(typeof xml!=='string'||Buffer.byteLength(xml)>60000)throw Error('That is not a robot configuration the robot can take.');
  const devices=RobotConfig.parse(xml).devices;if(xml.includes(';'))throw Error('The robot cannot take a configuration with a ; in it.');
  return session(host,async link=>{
    const {ds,ask,until,sent}=link,{files}=await configurations(link,timeout);
    if(!replace&&files.some(c=>c.name.toLowerCase()===name.toLowerCase()))throw Error(`The robot already has a configuration named “${name}”. Deck never replaces one.`);
    await sent(ds.command('CMD_SAVE_CONFIGURATION',`${JSON.stringify(configFile(name))};${xml}`));
    await until(s=>s.activeConfig?.name===name,15000,`The robot did not save “${name}”. Check the Robot Controller app, then try again.`);
    const saved=RobotConfig.parse(await ask('CMD_REQUEST_PARTICULAR_CONFIGURATION',JSON.stringify(configFile(name)))).devices;
    if(saved.length!==devices.length||devices.some(d=>!saved.some(s=>s.name===d.name&&s.tag===d.tag&&s.port===d.port&&s.bus===d.bus)))throw Error(`The robot saved “${name}” differently from what was sent. Check it in Configure Robot.`);
    if(restart)await sent(ds.restartRobot());
    return {name,devices:saved.length,restarted:restart};
  },{timeout,socket});
}

// Every configuration the robot keeps, read as Configure Robot lists them: {configurations, active, files: {name: xml}}. deviceName: the robot's name, from its web server, when it says.
async function readConfigurations(host,{timeout=8000,socket=null}={}){
  return session(host,async link=>{const {ask}=link,{files,active}=await configurations(link,timeout),out={};
    for(const f of files.slice(0,24)){try{const xml=await ask('CMD_REQUEST_PARTICULAR_CONFIGURATION',JSON.stringify(configFile(f.name)));if(/<Robot\b/.test(xml))out[f.name]=xml;}catch{}}
    const deviceName=host==='usb'?null:await rcDeviceName(host);return {source:'wifi',host,configurations:Object.keys(out),active:{name:active},files:out,...(deviceName?{deviceName}:{})};},{timeout,socket});}
const rcDeviceName=async host=>{try{const r=await request(checkHost(host),'GET','/js/rcInfo.json',undefined,{port:8080,timeout:4000}),name=r.status===200?JSON.parse(r.text).deviceName:null;return typeof name==='string'&&name?name:null;}catch{return null;}};
// A configuration's wiring notes are a comment in its file, and the robot sends configurations without comments, so over Wi-Fi they cannot be read and a write would take them out of the file.
// What the cable reads is kept on this computer (store: {get(robot, name), set(robot, name, notes)}), and what Wi-Fi reads gets it back. Notes this computer has never seen cannot come back.
function notesThrough(read,store){const robot=read?.deviceName;if(!robot||!read.files)return read;
  for(const [name,xml] of Object.entries(read.files)){const own=RobotConfig.notesOf(xml);if(Object.keys(own).length){store.set(robot,name,own);continue;}
    if(read.source!=='wifi')continue;const kept=store.get(robot,name);if(kept&&Object.keys(kept).length)read.files[name]=RobotConfig.withNotes(xml,kept);}
  return read;}
// Makes a saved configuration the active one, as the Driver Station's Configure Robot does, then restarts the robot so
// its hardware map is built from it.
async function activateConfiguration(host,name,{timeout=8000,socket=null,restart=true}={}){
  return session(host,async link=>{const {ds,until,sent}=link,{files}=await configurations(link,timeout);if(!files.some(c=>c.name===name))throw Error(`The robot has no configuration named “${name}”.`);
    await sent(ds.command('CMD_ACTIVATE_CONFIGURATION',JSON.stringify(configFile(name))));await until(s=>s.activeConfig?.name===name,15000,`The robot did not make “${name}” active.`);
    if(restart)await sent(ds.restartRobot());return {name,restarted:restart};},{timeout,socket});}

// Deletes a saved configuration, as the Driver Station's Configure Robot does.
async function deleteConfiguration(host,name,{timeout=8000,socket=null}={}){
  return session(host,async link=>{const {ds,ask,sent}=link,{files}=await configurations(link,timeout);if(!files.some(c=>c.name===name))throw Error(`The robot has no configuration named “${name}”.`);
    await sent(ds.command('CMD_DELETE_CONFIGURATION',JSON.stringify(configFile(name))));const left=JSON.parse(await ask('CMD_REQUEST_CONFIGURATIONS'));if(Array.isArray(left)&&left.some(c=>c?.name===name))throw Error(`The robot did not delete “${name}”.`);return {name};},{timeout,socket});}
// That data really goes both ways with this robot, whichever hub and FTC SDK it has. Each step: {name, ok, detail}.
async function connectionCheck(host,{timeout=8000,socket=null}={}){
  return session(host,async({ds,ask})=>{const robot=ds.state.robot||{},began=Date.now(),list=JSON.parse(await ask('CMD_REQUEST_CONFIGURATIONS')),ms=Date.now()-began,live=await rcHubs(host);
    return [{name:'Robot Controller app',ok:true,detail:`FTC SDK ${robot.sdk||'unknown'}, Robocol ${robot.robocol??'unknown'}${ds.state.adaptedVersion?' (matched to this robot)':''}`},
      {name:'Data to and from the robot',ok:true,detail:`${Array.isArray(list)?list.length:0} configuration${Array.isArray(list)&&list.length===1?'':'s'} read in ${ms} ms`},
      {name:'Robot web server',ok:live.length>0,detail:live.length?`${live.length} hub${live.length===1?'':'s'} open`:'Did not answer. Hubs, sending code and logs may not work until the robot restarts.'}];},{timeout,socket});}

// ---- the guided check, run from Deck
// Runs the check TeleOp as a Driver Station does (INIT, then START once it has initialized) and stays connected while
// it runs: onUpdate gets its telemetry, press() presses a gamepad 1 button for the person answering in Deck, and stop()
// stops the op mode (as a Driver Station's stop button does) and disconnects. The check also ends when the op mode stops
// on the robot, when the connection drops, and after `limit`. ended resolves with why: stopped, ended, time or lost.
const BUTTONS=new Set(['a','b','x','y','dpad_up','dpad_down','dpad_left','dpad_right']);
function runCheck(host,opMode,{onUpdate=()=>{},limit=20*60e3,timeout=8000,socket=null}={}){
  if(typeof opMode!=='string'||!opMode||opMode.length>200)throw Error('Which op mode is the check?');
  let finish=()=>{},ds=null,release=null,running=false,stopping=false;const done=new Promise(r=>{finish=why=>{stopping=true;r(why);};});
  const ended=session(host,async({ds:station,until})=>{
    ds=station;
    // The robot lists its op modes on connecting.
    await until(s=>s.opModes.length,timeout,'The robot did not list its op modes.').catch(()=>{});
    if(!ds.state.opModes.some(m=>m.name===opMode))throw Error(`The robot has no op mode “${opMode}”. Send to robot first, so it is built.`);
    if(ds.state.opModeState!=='stopped')throw Error(`“${ds.state.activeOpMode}” is running on the robot. Stop it first.`);
    ds.initOpMode(opMode);await until(s=>s.activeOpMode===opMode&&s.opModeState==='init',10000,'The robot did not INIT the check.');
    // Stopped while it initialized: it never starts.
    if(stopping){ds.stopOpMode();await until(s=>s.opModeState==='stopped',3000,'').catch(()=>{});return 'stopped';}
    ds.startOpMode(opMode);await until(s=>s.opModeState==='running',10000,'The robot did not START the check.');running=true;
    const report=()=>onUpdate({state:ds.state.opModeState,lines:ds.state.telemetry.lines});report();
    const offState=ds.on('state',s=>{report();if(s.connection!=='connected')finish('lost');else if(s.opModeState==='stopped')finish('ended');});
    const timer=setTimeout(()=>finish('time'),limit);
    const why=await done;clearTimeout(timer);offState();clearTimeout(release);running=false;
    if(ds.connected()&&ds.state.opModeState!=='stopped'){ds.setGamepad(1,null);ds.stopOpMode();await until(s=>s.opModeState==='stopped',3000,'').catch(()=>{});}
    return why;
  },{timeout,socket});
  ended.catch(()=>{}).finally(()=>{running=false;});
  let held=false;
  return {ended,
    // A short press (200 ms), as a person taps a button. Only while the check runs.
    press(button){if(!running||!BUTTONS.has(button))return false;clearTimeout(release);ds.setGamepad(1,{id:1,timestamp:Date.now(),[button]:true});release=setTimeout(()=>ds.setGamepad(1,{id:1,timestamp:Date.now()}),200);return true;},
    // This computer's controller 1 (a Steam Deck's own controls, as a standard-mapping gamepad): its face buttons and
    // D-pad are gamepad 1's on the robot for as long as they are held.
    pad(p){if(!running)return;const down=PAD.filter(([i])=>p?.buttons?.[i]?.pressed).map(([,name])=>name);
      if(down.length){clearTimeout(release);held=true;ds.setGamepad(1,{id:1,timestamp:Date.now(),...Object.fromEntries(down.map(name=>[name,true]))});}
      else if(held){held=false;ds.setGamepad(1,{id:1,timestamp:Date.now()});}},
    stop(why='stopped'){finish(why);}};
}
const PAD=[[0,'a'],[1,'b'],[2,'x'],[3,'y'],[12,'dpad_up'],[13,'dpad_down'],[14,'dpad_left'],[15,'dpad_right']];

// ---- live debug (Calibrate → Electronics), run from Deck
// Torque Debug (src/onbot/TorqueDebug.java, put on the robot with send()) uses every device in the active configuration, so it
// fits any robot. Its name says when it went on, on a 24-hour clock: TorqueDebug-18.11-10-30-26. runDebug runs
// it as a Driver Station does, then connects to the op mode's own port (20886: through ADB on the USB cable, or at the
// robot's address on its Wi-Fi) and keeps a heartbeat going every 100 ms, which the op mode's watchdog needs to keep any
// output on. onManifest gets its device list once, onFrame each line of readings. send(line) passes one command (see
// DeckDebug.apply); stop() stops the outputs and the op mode. ended resolves with why: stopped, ended, time or lost.
const DEBUG_PORT=20886,DEBUG_FILE='TorqueDebug.java',OLD_DEBUG_FILE='org/firstinspires/ftc/teamcode/DeckDebug.java',isDebugOpMode=m=>/^TorqueDebug\b/.test(m?.name||'');
const two=n=>String(n).padStart(2,'0'),debugName=(at=new Date())=>`TorqueDebug-${two(at.getHours())}.${two(at.getMinutes())}-${two(at.getMonth()+1)}-${two(at.getDate())}-${two(at.getFullYear()%100)}`;
const debugSource=(name=debugName())=>fs.readFileSync(path.join(__dirname,'onbot','TorqueDebug.java'),'utf8').replace('@TeleOp(name = "TorqueDebug"',`@TeleOp(name = "${name}"`);
// Whether the robot's copy is this one: its name only says when it went on, so everything else in the source has to match. opMode: the name it has there, which the robot has built only if it lists it.
const debugBody=text=>String(text).replace(/\r\n/g,'\n').replace(/@TeleOp\(name = "[^"]*"/,'@TeleOp(name = "TorqueDebug"').trim(),debugNameIn=text=>/@TeleOp\(name = "([^"]*)"/.exec(String(text))?.[1]||null;
async function debugCurrent(host,{client}={}){if(!client)client=await onBotClient(host);await webReady(client);const theirs=await client.read(DEBUG_FILE),current=theirs!==null&&debugBody(theirs)===debugBody(debugSource());return {current,opMode:current?debugNameIn(theirs):null};}
// Whether the robot is free for what nobody pressed for, seen as a Driver Station sees it. session itself refuses when another Driver Station has the robot. A Torque Debug left running is nobody's work and holds the camera, so it goes.
const debugIdle=(host,{timeout=8000,socket=null,settle=400}={})=>session(host,async({ds,until})=>{await until(s=>s.opModes.length,timeout,'The robot did not list its op modes.').catch(()=>{});
  // The robot says what is running on its next loop after the connection, which can be just after the list.
  await delay(settle);if(ds.state.opModeState==='stopped')return true;if(!isDebugOpMode({name:ds.state.activeOpMode}))throw Error(`“${ds.state.activeOpMode}” is running on the robot. Stop it first.`);
  ds.stopOpMode();await until(s=>s.opModeState==='stopped',5000,'The robot did not stop the Torque Debug it was running.');return true;},{timeout,socket});
// Until the op mode has said something. ADB takes a connection on this computer whether or not the hub's port is open yet and then hangs up, so being connected proves nothing: its first line, sent as soon as it accepts, does.
// A connection that is taken and says nothing is given up with the rest of the time. stopped: a promise; once it resolves this gives up at once, with null.
function connectRetry({host,port},ms,stopped){
  return new Promise((ok,fail)=>{let s=null,again=null,over=false,why='it said nothing';
    const drop=()=>{if(!s)return;s.off('error',retry);s.off('close',closed);s.off('data',heard);s.on('error',()=>{});s.destroy();s=null;},end=act=>{if(over)return;over=true;clearTimeout(limit);clearTimeout(again);act();},
      retry=e=>{why=e?.code||e?.message||'it hung up';drop();if(!over)again=setTimeout(attempt,250);},closed=()=>retry(),
      heard=first=>{const sock=s;sock.off('error',retry);sock.off('close',closed);sock.off('data',heard);s=null;end(()=>ok({sock,first}));},
      attempt=()=>{if(over)return;s=net.connect({host,port});s.once('error',retry);s.once('close',closed);s.once('data',heard);},
      limit=setTimeout(()=>{drop();end(()=>fail(Error(`Torque Debug did not open its port on the robot (${why}).`)));},ms);
    stopped?.then(()=>{drop();end(()=>ok(null));});attempt();});}
// opMode: the one to run, by its exact name; any Torque Debug without it.
function runDebug(host,{onManifest=()=>{},onFrame=()=>{},onCamera=()=>{},limit=60*60e3,timeout=8000,socket=null,connect=null,opMode=null,startWait=20000}={}){
  let finish=()=>{},stopping=false,sock=null,station=null,wantCamera=false,abandoned=false;const done=new Promise(r=>{finish=why=>{stopping=true;r(why);};});
  const ended=session(host,async({ds,until})=>{
    // A stop ends any wait for the robot at once, so whatever comes after the stop finds this session over and is not reached by a stop of its.
    const step=(test,ms,message)=>Promise.race([until(test,ms,message),done]);let began=false;
    await step(s=>s.opModes.length,timeout,'The robot did not list its op modes.').catch(()=>{});if(stopping)return done;
    const mode=(opMode?ds.state.opModes.find(m=>m.name===opMode):ds.state.opModes.find(isDebugOpMode))?.name;if(!mode)throw Error('The robot has no Torque Debug op mode yet. Put Torque Debug on the robot first.');
    if(ds.state.opModeState!=='stopped'&&ds.state.activeOpMode!==mode){if(!isDebugOpMode({name:ds.state.activeOpMode}))throw Error(`“${ds.state.activeOpMode}” is running on the robot. Stop it first.`);
      // Another build of Torque Debug, left running: it holds the camera, so it goes.
      ds.stopOpMode();await step(s=>s.opModeState==='stopped',5000,'The robot did not stop the Torque Debug it was running.');}
    if(!stopping&&ds.state.opModeState==='stopped'){began=true;ds.initOpMode(mode);await step(s=>s.activeOpMode===mode&&s.opModeState==='init',10000,'The robot did not INIT Torque Debug.');}
    if(!stopping&&ds.state.opModeState!=='running'){began=true;ds.startOpMode(mode);await step(s=>s.opModeState==='running',10000,'The robot did not START Torque Debug.');}
    // The picture, as the Driver Station's Camera Stream asks for it: one frame, then the next once it has come. A stream that
    // is not up yet answers nothing, so the asking goes on.
    let ping=null,timer=null,offState=()=>{},asked=0,offFrame=ds.on('frame',bytes=>{onCamera(bytes);asked=0;if(wantCamera){asked=Date.now();ds.requestFrame();}});station=ds;const asking=setInterval(()=>{if(wantCamera&&Date.now()-asked>1000){asked=Date.now();ds.requestFrame();}},250);
    try{
      const target=stopping?null:connect||(host==='usb'?{host:'127.0.0.1',port:(await usbForward()).debug}:{host:checkHost(host),port:DEBUG_PORT}),opened=target&&!stopping?await connectRetry(target,startWait,done):null;
      if(opened){sock=opened.sock;sock.setNoDelay(true);
        let buffer='',first=true;
        const take=chunk=>{buffer+=chunk.toString('utf8');for(let i;(i=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line)continue;let value;try{value=JSON.parse(line);}catch{continue;}
          if(first){first=false;onManifest(value);}else onFrame(value);}if(buffer.length>1e6)buffer='';};
        sock.on('data',take);take(opened.first);
        sock.on('close',()=>finish('lost'));sock.on('error',()=>{});
        ping=setInterval(()=>{if(!sock.destroyed)sock.write('P\n');},100);
        offState=ds.on('state',s=>{if(s.connection!=='connected')finish('lost');else if(s.opModeState==='stopped')finish('ended');});
        timer=setTimeout(()=>finish('time'),limit);}
      return await done;
    }finally{
      clearInterval(ping);clearTimeout(timer);clearInterval(asking);offFrame();station=null;wantCamera=false;offState();
      if(sock&&!sock.destroyed){try{sock.write('X\n');}catch{}sock.end();setTimeout(()=>sock.destroy(),300);}
      // Asked to INIT and stopped before it said so: it still gets its stop. Given up on: nothing more goes to the robot, which may belong to someone else by now.
      if(!abandoned&&ds.connected()&&(began||ds.state.opModeState!=='stopped')){ds.stopOpMode();await until(s=>s.opModeState==='stopped',3000,'').catch(()=>{});}
    }
  },{timeout,socket});
  ended.catch(()=>{});
  return {ended,
    send(line){if(!sock||sock.destroyed||typeof line!=='string'||!line||line.length>400||/[\r\n]/.test(line))return false;sock.write(line+'\n');return true;},
    camera(on){wantCamera=!!on;return !!station;},
    stop(why='stopped'){finish(why);},
    // Someone waited for the stop and has moved on: whatever is still under way here sends the robot nothing more.
    abandon(){abandoned=true;finish('stopped');}};
}

// ---- OnBot Java, over HTTP on port 8080
// The OnBot Java editor's own form encoding (encodeURIComponent, plus ! ' ( ) *).
const formEncode=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16));
function request(host,method,route,body,{timeout=15000,port=8080}={}){
  return new Promise((resolve,reject)=>{
    const data=body===undefined?null:Buffer.from(body,'utf8');
    // One request a connection: the robot's server (and an ADB forward to it) hangs up on a kept-alive one. It also hangs
    // up on a request without a User-Agent for some pages (/js/rcInfo.json).
    const req=http.request({host,port,method,path:route,headers:{Connection:'close','User-Agent':'Deck Driver Station',...(data?{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','Content-Length':data.length}:{})}},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,text:Buffer.concat(chunks).toString('utf8')}));});
    req.setTimeout(timeout,()=>req.destroy(Object.assign(Error('timed out'),{code:'ETIMEDOUT'})));
    req.on('error',e=>reject(Object.assign(Error(`Could not reach the robot's OnBot Java at http://${host}:${port} (${e.code||e.message}). Join the robot's Wi-Fi, and check the Robot Controller app is running.`),{code:e.code})));
    if(data)req.write(data);req.end();
  });
}
// An export path under TeamCode's java folder, as OnBot Java keeps it under /src.
const sourcePath=file=>{if(!/^[A-Za-z_][\w]*(\/[A-Za-z_][\w]*)*\.java$/.test(file))throw Error(`${file} is not a Java source path.`);return '/src/'+file;};
class OnBotJava{
  constructor(host,options={}){this.host=checkHost(host);this.options=options;}
  call(method,route,body,options){return request(this.host,method,route,body,{...this.options,...options});}
  // Whether the robot runs OnBot Java at all (its build status answers).
  async available(){const r=await this.call('GET','/java/build/status');if(r.status!==200)throw Error(`The robot at ${this.host} has no OnBot Java (HTTP ${r.status}). Use a Control Hub, or a Robot Controller phone with its programming mode on.`);return JSON.parse(r.text);}
  // The robot's copy of a file, or null when it has none (OnBot Java answers 404 "File Not Found!").
  async read(file){const r=await this.call('GET','/java/file/get?f='+sourcePath(file));if(r.status===404)return null;if(r.status!==200)throw Error(`The robot did not return ${path.basename(file)} (HTTP ${r.status}: ${r.text.slice(0,120)}).`);return r.text;}
  async save(file,text){const r=await this.call('POST','/java/file/save?f='+sourcePath(file),'data='+formEncode(text));if(r.status!==200)throw Error(`The robot refused to save ${path.basename(file)} (HTTP ${r.status}${r.text?`: ${r.text.slice(0,120)}`:''}).`);}
  // Deletes a file, as the OnBot Java editor does.
  async remove(file){const r=await this.call('POST','/java/file/delete','delete='+formEncode(JSON.stringify([decodeURIComponent(sourcePath(file))])));if(r.status!==200)throw Error(`The robot did not delete ${path.basename(file)} (HTTP ${r.status}).`);}
  async status(){const r=await this.call('GET','/java/build/status');if(r.status!==200)throw Error(`The robot's build status could not be read (HTTP ${r.status}).`);return JSON.parse(r.text);}
  // Builds everything in OnBot Java and waits for it. Resolves with whether it built, how long it took and its log.
  async build({timeout=240000,poll=500,onProgress=()=>{}}={}){
    const began=Date.now();let launched=NaN;
    // A successful start answers with the new build's start time (a JSON number).
    for(let attempt=0;attempt<2;attempt++){const r=await this.call('GET','/java/build/start');if(r.status===200){launched=Number(r.text.trim());break;}
      // Another build is running: wait for it, then start ours.
      await this.waitIdle(timeout,poll);}
    onProgress('building');
    for(;;){
      if(Date.now()-began>timeout)throw Error('The robot did not finish building within 4 minutes.');
      const s=await this.status();
      if(s.completed&&!s.running&&(!Number.isFinite(launched)||s.startTimestamp>=launched)){const log=(await this.call('GET','/java/build/log')).text||'';return {built:!!s.successful,seconds:+((Date.now()-began)/1000).toFixed(1),log,errors:buildErrors(log)};}
      await delay(poll);
    }
  }
  async waitIdle(timeout,poll){const began=Date.now();while(Date.now()-began<timeout){const s=await this.status();if(!s.running)return;await delay(poll);}throw Error('A build on the robot did not finish.');}
}
// Compiler errors from a build log: file, line and message for each.
function buildErrors(log){
  // javac writes "File.java:49: error: ..."; OnBot Java writes "File.java(49:9): ERROR: ...". Under "cannot find symbol" both indent a "symbol:" line, and that line is what says what is missing.
  const out=[];for(const m of String(log).matchAll(/([\w./\\-]+\.java)(?::(\d+)(?::\d+)?:|\((\d+):\d+\):)\s*error:\s*([^\r\n]*)((?:\r?\n[ \t]+[^\r\n]*)*)/gi)){const symbol=/^\s*symbol:\s*(.+?)\s*$/m.exec(m[5]||'')?.[1];out.push({file:path.basename(m[1]),line:Number(m[2]??m[3]),message:`${m[4].trim()}${symbol?`: ${symbol}`:''}`});}
  return out.slice(0,20);
}
// One line for a build that failed. OnBot Java builds every file in src/ together, so a team's own broken file stops Torque's too: this says whose it is, and which.
function buildProblem(errors){const list=errors||[],theirs=list.find(e=>e.file!==DEBUG_FILE),own=list[0];
  if(theirs)return `Your file ${theirs.file} has an error on line ${theirs.line}: ${theirs.message}. OnBot Java builds every file together, so nothing new can go on the robot until that file is fixed. Torque did not change it.`;
  if(own)return `Torque’s own program did not build on this robot (${own.file} line ${own.line}: ${own.message}). This is not your code. Check for a Torque update.`;
  return 'The robot could not build. Open its OnBot Java page to see why.';}
// Uploads the export's files and builds them. A file the robot already has with other contents is kept on this computer
// first (backupDir); files listed in keep are written only when the robot does not have them yet. remove: files of Deck's own
// that this replaces, deleted first.
const onBotClient=async host=>host==='usb'?new OnBotJava('127.0.0.1',{port:(await usbForward()).port}):new OnBotJava(host);
// Just after a new configuration the robot restarts, and its web server may refuse a connection for a moment.
async function webReady(client){for(let attempt=0;;attempt++){try{return await client.available();}catch(e){if(!['ECONNREFUSED','ECONNRESET'].includes(e.code)||attempt>=8)throw e;await delay(1000);}}}
async function send(host,files,{keep=[],remove=[],backupDir,onProgress=()=>{},client}={}){
  if(!client)client=await onBotClient(host);
  const entries=Object.entries(files||{});if(!entries.length)throw Error('Nothing to send.');
  const backups=[],written=[],kept=[];
  await webReady(client);
  for(const file of remove)if(await client.read(file)!==null)await client.remove(file);
  for(const [file,text] of entries){
    if(typeof text!=='string'||text.length>4*1024*1024)throw Error(`${file} is not a source file.`);
    onProgress('uploading',path.basename(file));
    const theirs=await client.read(file);
    if(theirs!==null&&keep.includes(file)){kept.push(path.basename(file));continue;}
    if(theirs!==null&&theirs.replace(/\r\n/g,'\n')!==text.replace(/\r\n/g,'\n')&&backupDir){
      const stamp=new Date().toISOString().replace(/[:.]/g,'-'),dir=path.join(backupDir,client.host.replace(/[^\w.-]/g,'_'));fs.mkdirSync(dir,{recursive:true});
      const copy=path.join(dir,`${stamp}-${path.basename(file)}`);fs.writeFileSync(copy,theirs);backups.push(copy);}
    await client.save(file,text);written.push(path.basename(file));
  }
  const result=await client.build({onProgress});
  return {...result,written,kept,backups};
}
// ---- a Control Hub on this computer's USB cable (ADB) -------------------------------------------------------------
// The Robot Controller keeps each configuration as /sdcard/FIRST/<name>.xml. Over USB Deck lists and reads them with ADB
// (the copy the REV Hardware Client installs, Android's platform-tools, or one on PATH). The Robot Controller's own web
// server (port 8080), forwarded over the same cable, says which one is active (/js/rcInfo.json activeConfigName) and
// lists the hardware Blocks offers from it (/hardware: allHardwareIdentifiers, "<name>As<Type>").
const {execFile,spawn}=require('node:child_process'),os=require('node:os');
function adbPath(){const fsx=require('node:fs'),cands=[process.env.ADB,process.platform==='win32'?path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','REV Robotics','REV Hardware Client','android-tools','adb.exe'):null,
    process.env.LOCALAPPDATA?path.join(process.env.LOCALAPPDATA,'Android','Sdk','platform-tools','adb.exe'):null,process.env.ANDROID_HOME?path.join(process.env.ANDROID_HOME,'platform-tools',process.platform==='win32'?'adb.exe':'adb'):null].filter(Boolean);
  return cands.find(f=>fsx.existsSync(f))||'adb';}
const adb=(args,{timeout=10000,run=execFile}={})=>new Promise((resolve,reject)=>run(adbPath(),args,{timeout,maxBuffer:8*1024*1024,windowsHide:true,encoding:'utf8'},(e,out,err)=>e?reject(Object.assign(Error(e.code==='ENOENT'?'Torque could not find its USB tool. Install the REV Hardware Client, which includes it.':(String(err||e.message).trim()||e.message)),{code:e.code})):resolve(String(out))));
// GET a path of the robot's web server forwarded to this computer's port (it hangs up on a kept-alive request).
const getLocal=(port,p,timeout=5000)=>new Promise((resolve,reject)=>{const req=http.get({host:'127.0.0.1',port,path:p,timeout,headers:{'User-Agent':'Deck Driver Station','Accept':'*/*','Connection':'close'}},res=>{let body='';res.setEncoding('utf8');res.on('data',c=>body+=c);res.on('end',()=>res.statusCode===200?resolve(body):reject(Error(`HTTP ${res.statusCode}`)));});req.on('timeout',()=>req.destroy(Error('timed out')));req.on('error',reject);});
// Blocks' hardware names: "frontleftAsDcMotor" is the device "frontleft" as a DcMotor (hub modules left out).
function blocksHardware(js){const m=/allHardwareIdentifiers\s*=\s*\[([^\]]*)\]/.exec(String(js||''));if(!m)return [];
  return [...m[1].matchAll(/'((?:\\.|[^'\\])*)'/g)].map(x=>x[1].replace(/\\(.)/g,'$1')).map(id=>{const i=id.lastIndexOf('As');return i>0?{identifier:id,name:id.slice(0,i),type:id.slice(i+2)}:null;}).filter(x=>x&&!/^(REVModule|ServoController|VoltageSensor|MotorController|LynxModule)$/.test(x.type));}
const usbList=async(run,timeout)=>{const all=(await adb(['devices','-l'],{run,...(timeout?{timeout}:{})})).split(/\r?\n/).slice(1).map(l=>l.trim()).filter(Boolean);return all.filter(l=>!/\bmodel:Driver_Hub\b/.test(l)).map(l=>l.split(/\s+/)).filter(x=>x[0]);};
async function readUsb({run}={}){
  const listed=await usbList(run);
  if(!listed.length)throw Error('No Control Hub on USB. Plug its USB-C port into this computer with a data cable (some cables only charge).');
  const ready=listed.find(x=>x[1]==='device');if(!ready)throw Error(listed[0][1]==='unauthorized'?'The Control Hub is on USB but has not allowed this computer yet: look for the prompt in the REV Hardware Client.':`The Control Hub on USB is ${listed[0][1]}.`);
  const serial=ready[0],sh=cmd=>adb(['-s',serial,'shell',cmd],{run});
  // Names with their times, newest first: ls -l --full-time is not on every Android, so plain ls -l and a sort by name too.
  // The hub answers on USB before Android has finished starting, so its storage can fail to list: that is not an error, only a wait.
  // Fully started with no folder is a hub that has no configurations yet.
  let listing='';try{listing=await sh('ls -1t /sdcard/FIRST/ 2>/dev/null');}catch(e){const up=await sh('getprop sys.boot_completed').then(v=>v.trim()==='1',()=>false);if(!up)throw Object.assign(Error('The Control Hub is still starting up. This takes about a minute after the battery goes on.'),{code:'HUB_STARTING'});await new Promise(r=>setTimeout(r,1000));listing=await sh('ls -1t /sdcard/FIRST/ 2>/dev/null').catch(()=>'');}
  const files=listing.split(/\r?\n/).map(s=>s.trim()).filter(s=>/\.xml$/i.test(s)&&!/^\./.test(s));
  if(!files.length)return {source:'usb',serial,configurations:[],active:null,devices:[],hubs:[],files:{}};
  const out={};for(const f of files.slice(0,20)){try{const xml=await sh(`cat '/sdcard/FIRST/${f.replace(/'/g,'')}'`);if(/<Robot\b/.test(xml))out[f.replace(/\.xml$/i,'')]=xml;}catch{}}
  const names=Object.keys(out);if(!names.length)return {source:'usb',serial,configurations:[],active:null,devices:[],hubs:[],files:{}};
  // The active configuration and Blocks' list, from the robot's web server over the cable; the newest file otherwise.
  let active=null,blocks=[],deviceName=null;const port=18000+Math.floor(Math.random()*2000);
  try{await adb(['-s',serial,'forward',`tcp:${port}`,'tcp:8080'],{run});const info=JSON.parse(await getLocal(port,'/js/rcInfo.json'));if(typeof info.activeConfigName==='string')active=info.activeConfigName;if(typeof info.deviceName==='string'&&info.deviceName)deviceName=info.deviceName;
    try{blocks=blocksHardware(await getLocal(port,'/hardware',10000));}catch{}}catch{}finally{adb(['-s',serial,'forward','--remove',`tcp:${port}`],{run}).catch(()=>{});}
  const name=active&&out[active]?active:names[0],parsed=RobotConfig.parse(out[name]);
  return {source:'usb',serial,configurations:names,active:{name,...(active&&out[active]?{}:{guessed:true})},xml:out[name],...parsed,blocks,files:out,...(deviceName?{deviceName}:{})};}
// Whether a Control Hub is on the USB cable and has allowed this computer, without touching it: Send to robot's USB choice.
async function usbStatus({run}={}){
  const listed=await usbList(run,5000),ready=listed.find(x=>x[1]==='device');
  return ready?{found:true,serial:ready[0]}:{found:false,message:listed.length?(listed[0][1]==='unauthorized'?'Allow this computer in the REV Hardware Client.':`The Control Hub on USB is ${listed[0][1]}.`):'Not plugged in.'};}
// Tries to bring a lost Control Hub back without a replug. A hub ADB lists as offline gets its link reset; with nothing listed at
// all, ADB's own server may be stuck (after the computer sleeps, say), so it is restarted, unless it is serving a Driver Hub.
let usbRecovered=0;
async function usbRecover({run,now=Date.now()}={}){if(now-usbRecovered<30000)return {did:null};usbRecovered=now;
  const listed=await usbList(run,5000);if(listed.some(x=>x[1]==='device'))return {did:null};
  if(listed.some(x=>x[1]==='offline')){await adb(['reconnect','offline'],{run,timeout:5000}).catch(()=>{});return {did:'reconnect'};}
  if(listed.length||/\bmodel:Driver_Hub\b/.test(await adb(['devices','-l'],{run,timeout:5000})))return {did:null};
  stopUsbRelay();usbPorts=null;await adb(['kill-server'],{run,timeout:5000}).catch(()=>{});await adb(['start-server'],{run,timeout:10000}).catch(()=>{});return {did:'restart'};}
// The first checks of a USB connection: the ADB tool, and a Control Hub that has allowed this computer.
async function usbCheck({run}={}){const steps=[];let version;try{version=await adb(['version'],{run,timeout:5000});}catch(e){return [{name:'USB tool (ADB)',ok:false,detail:'Not found. Install the REV Hardware Client, which includes it.'}];}
  steps.push({name:'USB tool (ADB)',ok:true,detail:/version ([\d.]+)/.exec(version)?.[1]||'found'});const status=await usbStatus({run});
  steps.push(status.found?{name:'Control Hub on USB-C',ok:true,detail:String(status.serial)}:{name:'Control Hub on USB-C',ok:false,detail:status.message==='Not plugged in.'?'Not found. Use a data cable (some only charge) with the robot on.':status.message});return steps;}
// The robot's web server (8080: OnBot Java, Blocks, Program & Manage), its WebSocket (8081, the port after it), the
// USB relay (20885, usbLink below: the Driver Station over the cable) and Deck Debug's port (20886) on four ports of this computer, kept while the hub stays plugged in: Send to robot uploads and
// builds over it, and the robot's own dashboard opens on it, with this computer on any Wi-Fi.
let usbPorts=null;
async function usbForward({run}={}){
  const listed=await usbList(run),ready=listed.find(x=>x[1]==='device');
  if(!ready)throw Error(listed.length?(listed[0][1]==='unauthorized'?'The Control Hub is on USB but has not allowed this computer yet: look for the prompt in the REV Hardware Client.':`The Control Hub on USB is ${listed[0][1]}.`):'No Control Hub on USB. Plug its USB-C port into this computer with a data cable (some cables only charge).');
  const serial=ready[0];if(usbPorts?.serial===serial){try{if((await adb(['-s',serial,'forward','--list'],{run})).includes(`tcp:${usbPorts.port} tcp:8080`))return usbPorts;}catch{}}
  const port=18000+3*Math.floor(Math.random()*600);await adb(['-s',serial,'forward',`tcp:${port}`,'tcp:8080'],{run});await adb(['-s',serial,'forward',`tcp:${port+1}`,'tcp:8081'],{run});
  await adb(['-s',serial,'forward',`tcp:${port+2}`,'tcp:20885'],{run});await adb(['-s',serial,'forward',`tcp:${port+3}`,`tcp:${DEBUG_PORT}`],{run});usbPorts={serial,port,link:port+2,debug:port+3};return usbPorts;}
// The Driver Station over the cable works on any Control Hub with nothing installed on it. ADB forwards TCP but not UDP,
// so a small relay (src/usb-relay/DeckUsbRelay.java) runs on the hub as ADB's own unprivileged shell user, from a temporary
// file that is deleted once it has started. It ends when the cable is pulled or Deck closes (its standard input closes).
// The Robot Controller app, team code, configurations and firmware are not touched (R706). A hub that already answers on
// the port, as an older Deck's OnBot Java link does, needs no relay.
const RELAY_DEX=path.join(__dirname,'usb-relay','classes.dex'),RELAY_REMOTE='/data/local/tmp/deck-usb-relay.dex';
let usbRelayChild=null,usbRelaySerial=null,usbRelayOpening=null;
function stopUsbRelay(){const child=usbRelayChild;usbRelayChild=null;usbRelaySerial=null;usbRelayOpening=null;if(!child)return;try{child.stdin.end();}catch{}try{child.kill();}catch{}}
// The cable was pulled: the ports and relay kept for that hub went with it, so plugging it back in starts clean.
function usbForget(serial){const mine=s=>!!s&&String(s).toLowerCase()===String(serial).toLowerCase();if(mine(usbPorts?.serial)||mine(usbRelaySerial)){stopUsbRelay();usbPorts=null;}}
// Two callers at once (a scan and Start live debug) share one start: a second relay could not bind the port, and would say the relay failed.
function usbRelay(serial,options){if(usbRelayOpening?.serial===serial)return usbRelayOpening.ready;
  const ready=usbRelayStart(serial,options).finally(()=>{if(usbRelayOpening?.ready===ready)usbRelayOpening=null;});usbRelayOpening={serial,ready};return ready;}
async function usbRelayStart(serial,{run,start=spawn}={}){
  if(usbRelayChild&&usbRelaySerial===serial&&usbRelayChild.exitCode===null)return;if(usbRelayChild)stopUsbRelay();
  const sh=cmd=>adb(['-s',serial,'shell',cmd],{run});
  if(/:5195 [0-9A-F:]+ 0A /i.test(await sh('cat /proc/net/tcp /proc/net/tcp6 2>/dev/null')))return;
  // Inside the packaged app the file is in an archive only Deck can read, so ADB pushes a copy.
  const local=path.join(os.tmpdir(),`deck-usb-relay-${process.pid}.dex`);fs.writeFileSync(local,fs.readFileSync(RELAY_DEX));
  try{await adb(['-s',serial,'push',local,RELAY_REMOTE],{run,timeout:20000});}finally{fs.rmSync(local,{force:true});}
  const child=start(adbPath(),['-s',serial,'shell',`CLASSPATH=${RELAY_REMOTE} app_process /system/bin DeckUsbRelay`],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  try{await new Promise((ok,fail)=>{let said='';const limit=setTimeout(()=>fail(Error('The Control Hub did not start the USB relay.')),15000),done=f=>v=>{clearTimeout(limit);f(v);};
      child.stdout.on('data',d=>{if(/ready/.test(String(d)))done(ok)();});child.stderr?.on('data',d=>{said+=d;});child.once('error',done(fail));child.once('exit',()=>done(fail)(Error(`The Control Hub could not run the USB relay.${said?' '+said.trim():''}`)));});}
  catch(e){try{child.kill();}catch{}throw e;}finally{adb(['-s',serial,'shell',`rm -f ${RELAY_REMOTE}`],{run}).catch(()=>{});}
  child.stdin.on('error',()=>{});child.once('exit',()=>{if(usbRelayChild===child){usbRelayChild=null;usbRelaySerial=null;}});usbRelayChild=child;usbRelaySerial=serial;}
// The Robot Controller app listens for Driver Stations on UDP 20884 (:5194 in /proc/net/udp), on the hub's own address; the
// relay's socket is the one on loopback. If the app has stopped or crashed it is started, as a hub does when it powers on,
// and the wait covers the 40 s or so it takes (and a restart after saving a configuration). noStart: nobody pressed anything, so nothing is started, which matters most for
// a build that crashes the app each time it starts; it only waits, and wait: 0 answers at once.
const controllerListening=table=>/^\s*\d+:\s+(?![0-9A-F]*0100007F:)[0-9A-F]+:5194 /im.test(String(table));
const usbControllerUp=async(serial,{run}={})=>controllerListening(await adb(['-s',serial,'shell','cat /proc/net/udp /proc/net/udp6 2>/dev/null'],{run}));
async function usbController(serial,{run,wait=70000,pause=500,noStart=false}={}){const sh=cmd=>adb(['-s',serial,'shell',cmd],{run}),on=()=>usbControllerUp(serial,{run});if(await on())return false;
  if(!noStart)await sh('am start -n com.qualcomm.ftcrobotcontroller/org.firstinspires.ftc.robotcontroller.internal.PermissionValidatorWrapper').catch(()=>{});
  for(const end=Date.now()+wait;Date.now()<end;){await delay(pause);if(await on())return true;}
  if(noStart)throw Error('The Robot Controller app on this Control Hub is not answering. Press Scan to start it, or restart the robot.');
  throw Error('The Robot Controller app on this Control Hub is not running and did not start. Restart the robot, then try again.');}
// The Robot Controller app's crashes in Android's crash log (only read): each line holds its time and process, so a new crash is a line not seen before. Null when it cannot be read.
const crashLines=log=>String(log).split(/\r?\n/).filter(l=>/(?:Process: |>>> )com\.qualcomm\.ftcrobotcontroller\b/.test(l));
async function usbCrashes({run,serial}={}){const hub=serial||(await usbForward({run})).serial;try{return crashLines(await adb(['-s',hub,'shell','logcat -b crash -d 2>/dev/null'],{run}));}catch{return null;}}
// After Torque Debug is built: if the Robot Controller crashes within the time a crash on new OnBot Java code takes (under 30 s
// seen, from Sinister in the team's build), it would crash again each time it starts. So that build and Torque Debug's source
// are taken off, the app is started again, and this says so. The team's own sources stay, but the build was theirs too.
// The app not listening proves nothing: a save, a Driver Hub or a press restarts it too, and a team's build is not to go for that. Only a crash that the log did not hold at the start counts. before: the log from before the build, so a crash during it counts.
async function usbDebugGuard({run,watch=40000,pause=2000,before}={}){const {serial}=await usbForward({run}),sh=cmd=>adb(['-s',serial,'shell',cmd],{run}),old=before===undefined?await usbCrashes({run,serial}):before;
  for(const end=Date.now()+watch;Date.now()<end;await delay(pause)){if(controllerListening(await sh('cat /proc/net/udp /proc/net/udp6 2>/dev/null')))continue;
    await delay(Math.min(5000,watch));if(controllerListening(await sh('cat /proc/net/udp /proc/net/udp6 2>/dev/null')))continue;
    const now=await usbCrashes({run,serial});if(!old||!now||!now.some(l=>!old.includes(l)))continue;
    await sh(`rm -f /sdcard/FIRST/java/src/${DEBUG_FILE}; rm -rf /sdcard/FIRST/java/build/jars/* /sdcard/FIRST/java/build/classes/*`);await usbController(serial,{run});
    throw Object.assign(Error('The Robot Controller app on this robot crashed when it loaded Torque Debug, so Torque took that program off and restarted the app. Your OnBot Java files are all still there, but their last build had to be cleared too, so your OnBot Java op modes will not show until you open OnBot Java and press Build Everything.'),{crashed:true,serial});}}
// Sets up the ports, the Robot Controller and the relay: what the Driver Station link needs.
async function usbLink(options){const ports=await usbForward(options);await usbController(ports.serial,options);await usbRelay(ports.serial,options);return ports;}
module.exports={adb,runDebug,debugCurrent,debugIdle,connectRetry,DEBUG_FILE,OLD_DEBUG_FILE,debugName,isDebugOpMode,controllerListening,usbController,usbControllerUp,usbDebugGuard,usbCrashes,crashLines,notesThrough,notesOf:RobotConfig.notesOf,debugSource,rcHubs,openHubs:RobotConfig.openHubs,usbForward,usbLink,usbRelay,stopUsbRelay,usbForget,usbStatus,usbRecover,usbCheck,connectionCheck,deleteConfiguration,scanRobot,scanDevices,readConfigurations,activateConfiguration,readUsb,adbPath,blocksHardware,readRobot,writeConfiguration,runCheck,session,OnBotJava,send,buildErrors,buildProblem,formEncode,checkHost};
