'use strict';
const BugReport=require('./bug-report.cjs');
const {app,BrowserWindow,WebContentsView,ipcMain,screen,Menu,shell,powerMonitor,powerSaveBlocker,utilityProcess,dialog,net}=require('electron');
const fs=require('node:fs'),path=require('node:path');const {execFile}=require('node:child_process');const {promisify}=require('node:util');const {createHash,randomUUID}=require('node:crypto');
const {Library,normalizeUrl,cleanSsid}=require('./library.cjs');const {Network}=require('./network.cjs');const {RobotProxy}=require('./robot-proxy.cjs');const {FtcSocket,UsbFtcSocket,probeFtc,findFtc}=require('./ftc.cjs');
const {Updater,prepareInstall,launchInstall}=require('./updater.cjs');const {shortcut}=require('./shortcuts.cjs');let build={};try{build=JSON.parse(fs.readFileSync(path.join(__dirname,'../build.json'),'utf8'));}catch{}const meta=require('../package.json');let updater;
const {identifyHardware,detectHardware}=require('./hardware.cjs');let device=identifyHardware();
const {ControllerHub}=require('./controller-hub.cjs');let controllerHub,lastControllerState='',lastInputConfig='';
// Controller 1 can be the keyboard: a virtual standard pad built from held physical keys.
const DeckKeyboard=require('../ui/keyboard-layout.js');let keyboardSource=false,sourceFile='',lastPads=[];const {KeyboardInput}=require('./keyboard-input.cjs');const keyboardInput=new KeyboardInput();let shellKeyboardEditing=false;
const {controllerOutput}=require('./controller-output.cjs');let lastControllerInput=0;
const {deadzone}=require('../ui/controller-calibration.js');let calibrationFile,calibrations=Object.create(null);
const discovery=require('./discovery.cjs');let finding=null;
const {RobotKeyboard}=require('./touch-keyboard.cjs');let robotKeyboard;
const controllerSessions=new WeakSet(),controllerArguments=process.env.DECK_CONTROLLER_TEST==='1'?['--deck-controller-fixtures']:[];
const robotArguments=()=>[...controllerArguments,...(device.builtInController?['--deck-touch-first']:[]),...(touchKeyboard?[]:['--deck-touch-keyboard-off'])];
const run=promisify(execFile);let win,library,robotView=null,bridge=null,auth=null,pollTimer,active=null,currentNetwork=null,opening=false,viewBounds={x:0,y:127,width:1280,height:643};
// FTC robots: robotView is the bundled Driver Station page, bridge its UDP socket; managerView is Program & Manage.
let managerView=null,managerProxy=null;
let robotExitView=null,robotExitReady=null,robotFullscreenPrevious=false;
let suspended=false,interruption=null,connectionEpoch=0,pageEpoch=0;const recoveryControllers=new Set();
// Setup, Simulate and Calibrate work offline from a robot's Driver Station: they close it and share the simulation process.
const offlinePage=page=>page==='simulation'||page==='calibrate'||page==='setup';
const state={page:'drive',loading:false,url:'',title:'',error:'',robot:null,kind:'',manager:false,robotFullscreen:false,recovering:false};const network=new Network();let overlay=false;
app.setName('Torque');
// Torque was Deck Driver Station: a computer that has that app's data (saved setups, robots, CAD, settings) keeps using
// its folder, so nothing is moved or lost.
const LEGACY_NAME='Deck Driver Station';
if(!process.env.DECK_DATA_DIR){const legacy=path.join(app.getPath('appData'),LEGACY_NAME);if(fs.existsSync(legacy)&&!fs.existsSync(path.join(app.getPath('appData'),'Torque')))app.setPath('userData',legacy);}
// Offline simulator: a utility process started by the Simulation view, never connected to a robot.
const {DevicePhotos}=require('./device-photos.cjs');let devicePhotos=null;const photos=()=>devicePhotos||=new DevicePhotos(path.join(app.getPath('userData'),'device-photos'));
const {SimulationHost}=require('./sim-bridge.cjs');let simulation=null;const robotLink=require('./robot-link.cjs'),axonProgrammer=require('./axon-programmer.cjs'),axonSoftware=require('./axon-software.cjs'),{UsbWatch}=require('./usb-watch.cjs'),HubUsb=require('./hub-usb.cjs');let axon=null,usbWatch=null;
if(process.env.DECK_DATA_DIR){fs.mkdirSync(process.env.DECK_DATA_DIR,{recursive:true});app.setPath('userData',process.env.DECK_DATA_DIR);}
// UI checks on GPU-less CI displays: Chromium's software WebGL, which it no longer falls back to on its own.
if(process.env.DECK_TEST_SOFTWARE_GL==='1')app.commandLine.appendSwitch('enable-unsafe-swiftshader');
if(!app.requestSingleInstanceLock())app.quit();app.on('second-instance',(_event,argv)=>{win?.show();win?.focus();terminalSetup(argv);});
// Terminal integration: `tools/deck-sim.cjs show` launches the app (or reaches the running one
// through the single-instance hand-off) with --deck-sim-open=<setup.json>. The setup opens in
// Simulation once the window says it is listening; only .json setup files are read.
let terminalRequest=null,terminalReady=false;
function terminalSetup(argv){
  const arg=name=>{const prefix=`--deck-sim-${name}=`,a=argv.find(v=>typeof v==='string'&&v.startsWith(prefix));return a?a.slice(prefix.length):'';},file=arg('open');if(!file)return;
  try{
    const abs=path.resolve(file);if(!/\.json$/i.test(abs)||!fs.statSync(abs).isFile()||fs.statSync(abs).size>150*1024*1024)throw Error('Use a simulation setup .json file.');
    const model=arg('model'),axis=v=>['+x','-x','+y','-y','+z','-z'].includes(v)?v:'';
    terminalRequest={name:path.basename(abs),text:fs.readFileSync(abs,'utf8'),tab:['setup','plan','run'].includes(arg('tab'))?arg('tab'):'run',run:argv.includes('--deck-sim-run'),model:model&&path.isAbsolute(model)&&fs.existsSync(model)?model:'',front:axis(arg('front')),top:axis(arg('top'))};
    void deliverTerminalSetup();
  }catch(e){emit('notice',`Could not open ${path.basename(file)} from the terminal: ${e.message}`);}
}
async function deliverTerminalSetup(){
  if(!terminalReady||!terminalRequest||!win||win.isDestroyed())return;const request=terminalRequest;terminalRequest=null;
  try{if(state.page!=='simulation')await setPage('simulation');emit('sim-open',request);}catch(e){emit('notice',e.message);}
}
// The shell's webContents, or null once the window is destroyed (late IPC during shutdown).
function shellContents(){return win&&!win.isDestroyed()?win.webContents:null;}
function emit(channel,value){try{if(win&&!win.isDestroyed())win.webContents.send(channel,value);}catch{}}
function snapshot(){return {...state,zoom:currentZoom(),robots:library?.list(currentNetwork?.ssid),network:currentNetwork};}
function update(patch={}){Object.assign(state,patch);if(state.page!=='drive'||state.error||!state.url)robotKeyboard?.hide({focus:false});if(state.robotFullscreen&&(state.page!=='drive'||state.error||!state.url))void setRobotFullscreen(false);syncAwake();emit('state',snapshot());}
// Keep the display on while a robot is open (Settings preference, on by default).
let keepAwake=true,awakeBlocker=null,touchKeyboard=false;
// Robot pages learn the on-screen keyboard preference on load and whenever it changes.
function sendTouchKeyboard(contents){if(contents&&!contents.isDestroyed())contents.send('deck-touch-keyboard-enabled',touchKeyboard);}
function syncAwake(){const wanted=keepAwake&&!!robotView&&!suspended;if(wanted&&awakeBlocker===null)awakeBlocker=powerSaveBlocker.start('prevent-display-sleep');else if(!wanted&&awakeBlocker!==null){powerSaveBlocker.stop(awakeBlocker);awakeBlocker=null;}}
// Robot page zoom, remembered per saved robot (and separately for Program & Manage).
const zoomSteps=[.5,.67,.75,.8,.9,1,1.1,1.25,1.5,1.75,2];let zoomFile='',zooms={};
function zoomKey(contents){const id=active?.id||active?.url||'';return id&&(contents===managerView?.webContents?'manage:'+id:id);}
function currentZoom(){try{return Number(((managerView||robotView)?.webContents.getZoomFactor()||1).toFixed(2));}catch{return 1;}}
function applyZoom(contents){const factor=zooms[zoomKey(contents)]||1;if(contents.getZoomFactor()!==factor){contents.setZoomFactor(factor);emit('state',snapshot());}}
function setZoom(step){const contents=(managerView||robotView)?.webContents;if(!contents)return 1;const current=contents.getZoomFactor(),nearest=zoomSteps.reduce((best,z,i)=>Math.abs(z-current)<Math.abs(zoomSteps[best]-current)?i:best,0),next=step===0?1:zoomSteps[Math.max(0,Math.min(zoomSteps.length-1,nearest+step))],key=zoomKey(contents);
  if(key){if(next===1)delete zooms[key];else zooms[key]=next;try{fs.writeFileSync(zoomFile,JSON.stringify(zooms),{mode:0o600});}catch{}}contents.setZoomFactor(next);emit('state',snapshot());return next;}
function trusted(e){const shell=shellContents();if(!shell||e.sender!==shell||e.senderFrame!==shell.mainFrame)throw Error('Only app settings can perform this action.');}
function handle(channel,fn){ipcMain.handle(channel,async(e,...args)=>{try{trusted(e);return {ok:true,value:await fn(...args)};}catch(e){return {ok:false,error:e.message,code:e.code};}});}
// ⋮ → Report a bug (src/bug-report.cjs). Without the relay it opens on GitHub, with its pictures in a folder to drag from.
const bugAbout=()=>BugReport.about({version:meta.version,channel:meta.updateChannel,platform:process.platform,arch:process.arch,release:require('node:os').release()});
handle('bug-report',report=>BugReport.send(report,{url:process.env.DECK_BUG_REPORT_URL??meta.bugReportUrl,about:bugAbout()}));
handle('bug-report-browser',async report=>{const r=BugReport.clean(report);
  if(r.images.length){const dir=fs.mkdtempSync(path.join(app.getPath('temp'),'torque-bug-report-'));r.images.forEach((image,i)=>fs.writeFileSync(path.join(dir,`picture-${i+1}.${image.type}`),image.bytes));void shell.openPath(dir);}
  await shell.openExternal(BugReport.issueUrl(report,{repo:meta.repository.url,about:bugAbout()}));return true;});
function hardware(){const d=screen.getDisplayMatching(win.getBounds());return {...device,platform:process.platform,launchedThroughSteam:[process.env.SteamGameId,process.env.SteamAppId].some(id=>/^[1-9]\d*$/.test(id||'')),display:{width:d.size.width,height:d.size.height,scale:d.scaleFactor}};}
function controllerState(){const value=controllerHub?.state()||{count:1,slots:[null,null],capture:null,blocked:[]};return {...value,source1:keyboardSource?'keyboard':'controller',deadzones:value.slots.map(p=>p?calibrations[p.id]||0:0),paused:suspended||state.recovering||state.page!=='drive'||!!overlay||!!auth||!!managerView||!!robotKeyboard?.visible||keyboardSource&&shellKeyboardEditing};}
function blockHeldControllers(){for(const pad of controllerHub?.state().slots||[])if(pad){recoveryControllers.add(pad.id);controllerHub.blocked.add(`${pad.index}:${pad.id}`);}}
function inputConfig(value=controllerState()){const {count,slots,capture,blocked,paused,deadzones}=value;return {count,slots,capture,blocked,paused,deadzones,keyboardKeys:keyboardSource&&(state.page!=='simulation'||overlay)?[...DeckKeyboard.used]:[],pads:controllerOutput(value)};}
function ingestPads(pads){
  lastPads=Array.isArray(pads)?pads:[];
  controllerHub.ingest(keyboardSource?[...lastPads.filter(p=>p?.index!==DeckKeyboard.INDEX),DeckKeyboard.pad(keyboardInput.down)]:lastPads,{pin:keyboardSource?DeckKeyboard.ID:null});
}
function keyboardKey(input){
  if(keyboardInput.key(input)&&controllerHub){ingestPads(lastPads);sendControllers();}
}
function releaseKeys(){const changed=keyboardInput.release();if(changed&&controllerHub)ingestPads(lastPads);if(keyboardSource)simulation?.practiceInput(null);sendControllers();}
function sendControllers(force=false){
  if(!controllerHub)return;controllerHub.tick();const value=controllerState(),signature=JSON.stringify(value);if(!force&&signature===lastControllerState)return;lastControllerState=signature;
  emit('controller-state',value);
  // Raw diagnostics stay in the trusted app UI. Robot pages need only slot
  // routing and pause state, not the test screen's other-controller readings.
  const config=inputConfig(value),routing=JSON.stringify(config);if(force||routing!==lastInputConfig){lastInputConfig=routing;for(const view of [win,robotView])try{view?.webContents.send('controller-config',config);}catch{}}
}
const touchSessions=new WeakSet();
function touchSession(session){if(!touchSessions.has(session)){session.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'touch-preload.cjs')});touchSessions.add(session);}}
function controllerSession(session){if(!controllerSessions.has(session)){session.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'controller-preload.cjs')});touchSession(session);controllerSessions.add(session);}}
function controllerSender(e){return e.sender===shellContents()||e.sender===robotView?.webContents;}
ipcMain.on('controller-ready',e=>{if(controllerSender(e)&&e.senderFrame===e.sender.mainFrame)e.reply('controller-config',inputConfig());});
ipcMain.on('controller-keyboard-editing',(e,editing)=>{
  if(e.sender!==shellContents()||e.senderFrame!==e.sender.mainFrame||typeof editing!=='boolean'||editing===shellKeyboardEditing)return;
  shellKeyboardEditing=editing;releaseKeys();
});
ipcMain.on('controller-input',(e,pads)=>{
  if(!controllerHub||e.sender!==shellContents()||e.senderFrame!==e.sender.mainFrame)return;
  lastControllerInput=performance.now();ingestPads(pads);
  for(const pad of controllerHub.pads)if(recoveryControllers.has(pad.id)){if(!pad.pressed&&!controllerHub.axesActive(pad))recoveryControllers.delete(pad.id);else controllerHub.blocked.add(`${pad.index}:${pad.id}`);}
  if(suspended||state.recovering)blockHeldControllers();sendControllers();
  // The simulation process accepts Controller 1 only during an explicitly started TELEOP
  // practice phase. Autonomous and transition always reject it; robot output stays paused.
  // A guided check running from Calibrate takes Controller 1's face buttons and D-pad as its answers.
  if((simulation?.running||robotCheck)&&offlinePage(state.page)){const padState=controllerState(),blocked=suspended||state.recovering||overlay||auth||managerView||robotKeyboard?.visible||padState.capture||keyboardSource&&shellKeyboardEditing;
    const pad=blocked?null:controllerOutput({...padState,paused:false})[0];if(simulation?.running)simulation.practiceInput(pad);robotCheck?.pad(pad);}
});
function captureController(slot){controllerHub.begin(slot);win.webContents.focus();sendControllers(true);emit('controller-capture',controllerState());return controllerState();}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function closeManager(){
  robotKeyboard?.hide({focus:false});
  const view=managerView,proxy=managerProxy;managerView=null;managerProxy=null;
  if(view){try{win.contentView.removeChildView(view);view.webContents.close();}catch{}}
  if(proxy)await proxy.close();if(state.manager)update({manager:false});fitView();
}
async function closeRobot({retain=false}={}){
  if(!retain&&interruption)await interruption;
  connectionEpoch++;
  const selection=retain?{robot:active||state.robot,url:state.url||active?.url||'',title:state.title,kind:state.kind}:{};
  robotKeyboard?.hide({focus:false});
  await setRobotFullscreen(false);
  if(auth){auth.callback();auth=null;}
  await closeManager();
  // An FTC station sends STOP for an active op mode before its socket closes; the robot also stops on its own after 2 s.
  if(robotView&&bridge instanceof FtcSocket){try{await Promise.race([robotView.webContents.executeJavaScript('window.deckShutdown?.()'),delay(300)]);await delay(80);}catch{}}
  const view=robotView,proxy=bridge;robotView=null;bridge=null;active=null;
  controllerHub?.cancel();if(!retain)controllerHub?.setCount(1);sendControllers(true);
  if(view){try{win.contentView.removeChildView(view);view.webContents.close();}catch{}}
  if(proxy)await proxy.close();update({loading:false,robot:null,url:'',title:'',error:'',kind:'',recovering:false,...selection,...(retain?{recovering:true}:{})});
}
function interruptRobot(message){
  connectionEpoch++;finding?.abort();
  if(interruption)return interruption;
  if(!state.url&&!active)return Promise.resolve();
  update({loading:false,recovering:true,error:message});blockHeldControllers();sendControllers(true);
  interruption=closeRobot({retain:true}).then(()=>update({error:message})).finally(()=>{interruption=null;});
  return interruption;
}
let appTheme='system';
// Shell measurements are CSS pixels; native child-view bounds use window units.
function place(view,visible){const [width,fullHeight]=win.getContentSize(),height=fullHeight-(robotKeyboard?.visible?robotKeyboard.height():0);if(state.robotFullscreen){view.setBounds({x:0,y:0,width,height});view.setVisible(visible);return;}const zoom=win.webContents.getZoomFactor(),x=Math.min(Math.max(0,Math.round(viewBounds.x*zoom)),width),y=Math.min(Math.max(0,Math.round(viewBounds.y*zoom)),height);view.setBounds({x,y,width:Math.max(0,Math.min(Math.round(viewBounds.width*zoom),width-x)),height:Math.max(0,Math.min(Math.round(viewBounds.height*zoom),height-y))});view.setVisible(visible);}
function fitView(){
  if(!robotView||!win)return;const shown=state.page==='drive'&&!auth&&!state.error&&!overlay;
  if(managerView)place(managerView,shown);place(robotView,shown&&!managerView);
  if(robotExitView){const [width]=win.getContentSize();robotExitView.setBounds({x:Math.max(0,width-60),y:12,width:48,height:48});robotExitView.setVisible(state.robotFullscreen&&shown);}
  robotKeyboard?.layout();
  // Hidden Driver Station: gamepads are released to rest, the connection (and a running op mode) continues.
  if(bridge instanceof FtcSocket)try{robotView.webContents.send('ftc-active',shown&&!managerView);robotView.webContents.send('ftc-fullscreen',!!state.robotFullscreen);}catch{}
  sendControllers();
}
async function ensureRobotExit(){
  if(robotExitView){await robotExitReady;win.contentView.removeChildView(robotExitView);win.contentView.addChildView(robotExitView);return;}
  const view=new WebContentsView({webPreferences:{preload:path.join(__dirname,'robot-fullscreen-preload.cjs'),partition:'robot-fullscreen-controls',sandbox:true,contextIsolation:true,nodeIntegration:false}});
  robotExitView=view;view.setVisible(false);view.setBackgroundColor('#00000000');win.contentView.addChildView(view);
  const file=path.join(__dirname,'../ui/robot-fullscreen-exit.html'),url=require('node:url').pathToFileURL(file).href;lockDown(view.webContents,target=>target===url);
  view.webContents.on('render-process-gone',()=>{if(robotExitView!==view)return;win?.contentView.removeChildView(view);robotExitView=null;void setRobotFullscreen(false);});
  robotExitReady=view.webContents.loadFile(file);
  try{await robotExitReady;}catch(error){if(robotExitView===view){win?.contentView.removeChildView(view);robotExitView=null;}view.webContents.close();throw error;}finally{robotExitReady=null;}
}
async function setRobotFullscreen(enabled){
  enabled=!!enabled;if(enabled===state.robotFullscreen)return snapshot();
  if(enabled){
    if(!robotView||state.page!=='drive'||state.loading||state.error||auth||overlay)throw Error('Open a robot before expanding its view.');
    await ensureRobotExit();if(state.robotFullscreen)return snapshot();
    if(!robotView||state.page!=='drive'||state.loading||state.error||auth||overlay||!win||win.isDestroyed())throw Error('Open a robot before expanding its view.');
    robotFullscreenPrevious=win.isFullScreen();update({robotFullscreen:true});win.setFullScreen(true);fitView();(managerView||robotView).webContents.focus();
  }else{
    update({robotFullscreen:false});robotExitView?.setVisible(false);if(win&&!win.isDestroyed()){if(!robotFullscreenPrevious&&win.isFullScreen())win.setFullScreen(false);fitView();if(state.page==='drive') (managerView||robotView)?.webContents.focus();}
  }
  return snapshot();
}
async function runShortcut(action){
  if(action==='reload')return (managerView||robotView)?.webContents.reload();if(action==='back')return goBack();
  if(action==='zoom-in'||action==='zoom-out'||action==='zoom-reset')return setZoom(action==='zoom-in'?1:action==='zoom-out'?-1:0);
  if(action==='drive'||action==='settings')return setPage(action);
  if(action==='fullscreen'){if(robotView&&state.page==='drive'&&!state.error&&!state.loading)return setRobotFullscreen(!state.robotFullscreen);if(!state.robotFullscreen)win?.setFullScreen(!win.isFullScreen());}
}
// Escape always leaves fullscreen (robot view first, then the app window) unless a station
// menu or dialog is open, where it only closes that. The key still reaches the page.
function leaveFullscreen(){if(state.robotFullscreen)void setRobotFullscreen(false);else if(win&&!win.isDestroyed()&&win.isFullScreen())win.setFullScreen(false);}
function keys(contents,{shell=false}={}){contents.on('before-input-event',(event,input)=>{if(keyboardSource&&DeckKeyboard.used.has(DeckKeyboard.code(input)))keyboardKey(input);if(input.type==='keyDown'&&input.key==='Escape'&&!(shell&&(overlay||auth)))leaveFullscreen();const action=shortcut(input);if(!action||shell&&(overlay||auth)&&action!=='reload')return;event.preventDefault();void runShortcut(action).catch(e=>emit('notice',e.message));});}
function robotEscape(contents){keys(contents);contents.on('dom-ready',()=>sendTouchKeyboard(contents));contents.on('zoom-changed',(_event,direction)=>setZoom(direction==='in'?1:-1));contents.on('did-finish-load',()=>applyZoom(contents));contents.on('before-input-event',(_event,input)=>{if(input.type==='keyDown'&&input.key==='Escape')robotKeyboard?.hide();});contents.on('did-start-navigation',(_event,_url,inPlace,mainFrame)=>{if(mainFrame&&!inPlace)robotKeyboard?.hide({focus:false});});}
handle('robot-fullscreen',setRobotFullscreen);
ipcMain.handle('robot-fullscreen-exit',async e=>{if(e.sender!==robotExitView?.webContents||e.senderFrame!==e.sender.mainFrame)throw Error('Only the fullscreen exit button can restore this view.');await setRobotFullscreen(false);});
async function refreshNetwork(){
  const next=await network.status(),previous=currentNetwork;currentNetwork=next;
  if(previous&&(next.ssid!==previous.ssid||next.device!==previous.device))finding?.abort();
  // A robot on the USB cable does not care which Wi-Fi this computer is on.
  const expected=isUsb(active?.url||state.robot?.url)?null:active?.ssid||state.robot?.ssid||previous?.ssid;
  if((robotView||opening&&state.url)&&expected&&next.ssid!==expected&&!network.busy&&!suspended){await interruptRobot(next.ssid?'Wi-Fi changed. Your robot address is saved. Choose Try again to reconnect to its network.':'Wi-Fi disconnected. Your robot address is saved. Reconnect Wi-Fi, then choose Try again.');}
  emit('network',next);return next;
}
// A Control Hub on the USB cable is saved at this address: Drive's Driver Station reaches it through ADB and a relay that
// runs only while the cable is in (robotLink.usbLink), whatever Wi-Fi this computer is on.
const USB_HOST='usb.control-hub',isUsb=url=>{try{return new URL(url).hostname===USB_HOST;}catch{return false;}};
async function openRobot(input){
  const navigation=pageEpoch;finding?.abort();
  if(opening)throw Error('A robot connection is already opening.');opening=true;
  try{
    if(interruption)await interruption;
    if(suspended)throw Error('Wait for this device to wake before reconnecting.');
    const saved=input.id?library.get(input.id):null,target={...saved,...input,url:normalizeUrl(input.url||saved?.url)},usb=isUsb(target.url);if(usb)target.kind='ftc';
    const wifi=await refreshNetwork(),ssid=usb?'':cleanSsid(input.id&&!input.url?saved?.ssid||wifi.ssid:input.ssid||wifi.ssid);
    if(ssid&&wifi.ssid!==ssid)return {needsWifi:{ssid},request:target};
    // The automatic FTC check holds UDP 20884 for up to 1.5 s; let it finish first.
    for(let i=0;auto.busy&&i<40;i++)await delay(50);
    if(navigation!==pageEpoch)return {opened:false};
    await closeRobot();
    if(navigation!==pageEpoch)return {opened:false};
    if(suspended)throw Error('Wait for this device to wake before reconnecting.');
    const epoch=++connectionEpoch;active={...target,ssid};
    update({page:'drive',loading:true,url:target.url,title:target.name||'Opening robot',robot:active,error:''});
    // FTC Robot Controllers answer Robocol discovery on UDP 20884 and get the Driver Station; everything else is a website.
    // The Settings "FTC robot" box forces the Driver Station; unticked ("auto") detects again.
    // The USB address is not a real host name: it is always the Driver Station over the cable, never a website.
    let kind=usb||input.kind==='ftc'?'ftc':input.kind==='auto'?undefined:saved?.url===target.url?saved.kind:undefined;
    if(!kind){kind=(await probeFtc(new URL(target.url).hostname)).ftc?'ftc':'web';}
    if(epoch!==connectionEpoch||suspended)return {opened:false};
    if(kind==='ftc')return await openFtc(target,ssid,epoch);
    const proxy=new RobotProxy(target.url),localUrl=await proxy.start();if(epoch!==connectionEpoch||suspended){await proxy.close();return {opened:false};}bridge=proxy;
    const identity=createHash('sha256').update(`${ssid}\0${new URL(target.url).origin}`).digest('hex');
    const view=new WebContentsView({webPreferences:{partition:`persist:robot-${identity}`,additionalArguments:robotArguments(),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,webSecurity:true}});
    robotView=view;active={...target,ssid};win.contentView.addChildView(view);
    const contents=view.webContents,session=contents.session;
    robotEscape(contents);
    controllerSession(session);controllerHub.setCount(target.controllerCount===2?2:1);
    session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));session.setPermissionCheckHandler(()=>false);
    session.webRequest.onBeforeRequest((details,cb)=>{
      try{const u=new URL(details.url);
        if(['http:','https:'].includes(u.protocol)&&u.origin===proxy.target.origin)return cb({redirectURL:proxy.origin+u.pathname+u.search});
        if(['http:','https:','ws:','wss:'].includes(u.protocol)&&['127.0.0.1','localhost'].includes(u.hostname)&&u.port!==new URL(proxy.origin).port){u.hostname=proxy.target.hostname;if(u.href!==details.url)return cb({redirectURL:u.href});}
      }catch{}cb({});
    });
    const allowed=url=>{try{return new URL(url).origin===proxy.origin;}catch{return false;}};
    contents.on('will-navigate',(e,url)=>{if(!allowed(url))e.preventDefault();});
    contents.on('will-redirect',(e,url)=>{if(!allowed(url)){e.preventDefault();update({error:'The robot redirected outside its address. Enter that address in Settings if intended.'});}});
    contents.setWindowOpenHandler(({url})=>{if(allowed(url))void contents.loadURL(url);return {action:'deny'};});
    contents.on('did-start-loading',()=>{if(robotView===view)update({loading:true,error:''});});
    contents.on('did-finish-load',()=>{
      if(robotView!==view)return;const title=contents.getTitle(),u=new URL(contents.getURL());
      const robotUrl=proxy.target.origin+u.pathname+u.search+u.hash;
      const robot=library.upsert({...active,url:robotUrl,kind:'web'},{opened:true,title});active=robot;update({loading:false,title:robot.name,url:robotUrl,robot,kind:'web'});
    });
    contents.on('page-title-updated',(_e,title)=>{if(robotView===view&&active?.id){const robot=library.updateTitle(active.id,title);update({title:robot.name,robot});}});
    contents.on('did-fail-load',(_e,code,message,_url,isMainFrame)=>{if(robotView===view&&isMainFrame&&code!==-3){view.setVisible(false);update({loading:false,error:`Could not open the robot: ${message}`});}});
    contents.on('render-process-gone',()=>{if(robotView===view)void interruptRobot('Robot page closed unexpectedly. Your address is saved. Choose Try again to reconnect.');});
    update({page:'drive',loading:true,url:target.url,title:target.name||'Opening robot',robot:active,error:''});fitView();
    void contents.loadURL(localUrl).then(()=>{if(robotView===view)contents.focus();}).catch(e=>{if(robotView===view)update({loading:false,error:e.message});});return {opened:true};
  }finally{opening=false;}
}
function lockDown(contents,allowed){
  const session=contents.session;session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));session.setPermissionCheckHandler(()=>false);
  contents.on('will-navigate',(e,url)=>{if(!allowed(url))e.preventDefault();});contents.setWindowOpenHandler(({url})=>{if(allowed(url))void contents.loadURL(url);return {action:'deny'};});
}
async function openFtc(target,ssid,epoch){
  const host=new URL(target.url).hostname;if(competition&&host!==USB_HOST)throw Error(COMPETITION_WIFI);const socket=host===USB_HOST?new UsbFtcSocket(()=>robotLink.usbLink().then(f=>({port:f.link}))):new FtcSocket(host);
  try{await socket.open();}catch(e){if(epoch===connectionEpoch)update({page:'drive',loading:false,url:target.url,title:target.name||host,error:e.message});return {opened:false};}
  if(epoch!==connectionEpoch||suspended){await socket.close();return {opened:false};}
  const robot=library.upsert({...target,ssid,kind:'ftc'},{opened:true});
  const view=new WebContentsView({webPreferences:{preload:path.join(__dirname,'ftc-preload.cjs'),partition:'ftc-driver-station',additionalArguments:robotArguments(),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,webSecurity:true}});
  const page=path.join(__dirname,'../ui/ftc/index.html'),pageUrl=require('node:url').pathToFileURL(page).href;
  robotView=view;bridge=socket;active=robot;win.contentView.addChildView(view);lockDown(view.webContents,url=>url===pageUrl);
  robotEscape(view.webContents);
  controllerSession(view.webContents.session);controllerHub.setCount(robot.controllerCount);
  socket.onPacket(bytes=>{if(robotView===view)view.webContents.send('ftc-packet',bytes);});
  view.webContents.on('render-process-gone',()=>{if(robotView===view)void interruptRobot('The Driver Station closed unexpectedly. Your robot address is saved. Choose Try again to reconnect.');});
  update({page:'drive',loading:false,url:target.url,title:robot.name,robot,kind:'ftc',error:''});fitView();
  await view.webContents.loadFile(page);if(robotView===view){view.webContents.focus();fitView();}return {opened:true,kind:'ftc'};
}
// Program & Manage: the Robot Controller's own web interface (port 8080) over the existing website bridge.
async function openManager(){
  if(!(bridge instanceof FtcSocket))throw Error('Program & Manage is available for FTC robots.');await closeManager();
  const usbPort=bridge instanceof UsbFtcSocket?(await robotLink.usbForward()).port:null;
  const proxy=new RobotProxy(usbPort?`http://127.0.0.1:${usbPort}/`:`http://${bridge.host.includes(':')?`[${bridge.host}]`:bridge.host}:8080/`),localUrl=await proxy.start();
  const view=new WebContentsView({webPreferences:{partition:`persist:robot-manage-${createHash('sha256').update(bridge.host).digest('hex')}`,additionalArguments:robotArguments(),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  touchSession(view.webContents.session);
  managerView=view;managerProxy=proxy;win.contentView.addChildView(view);lockDown(view.webContents,url=>{try{return new URL(url).origin===proxy.origin;}catch{return false;}});
  if(state.robotFullscreen&&robotExitView){win.contentView.removeChildView(robotExitView);win.contentView.addChildView(robotExitView);}
  robotEscape(view.webContents);
  view.webContents.on('did-fail-load',(_e,code,message,_u,main)=>{if(managerView===view&&main&&code!==-3)void closeManager().then(()=>emit('notice',`Program & Manage is not reachable: ${message}`));});
  update({manager:true});fitView();void view.webContents.loadURL(localUrl);return true;
}
ipcMain.on('ftc-send',(e,bytes)=>{if(robotView&&e.sender===robotView.webContents&&bridge instanceof FtcSocket&&bytes instanceof Uint8Array)bridge.send(bytes);});
ipcMain.handle('ftc-info',e=>{if(!robotView||e.sender!==robotView.webContents||!(bridge instanceof FtcSocket))throw Error('No FTC robot is open.');
  const select=sentOpMode?.host===bridge.host&&Date.now()-sentOpMode.at<3600e3?sentOpMode.name:null;if(select)sentOpMode=null;const open=dsOpenPage;dsOpenPage=null;
  return {name:active?.name||bridge.host,host:bridge.host,address:bridge.address,ssid:bridge instanceof UsbFtcSocket?'USB cable':active?.ssid||currentNetwork?.ssid||'',controllerCount:active?.controllerCount||1,...device,steamDeck:device.controllerFamily==='steamdeck',...(select?{select}:{}),...(open?{open}:{}),theme:appTheme,fullscreen:!!state.robotFullscreen};});
// The Driver Station's own bar closes the robot and goes fullscreen, and it follows the app's colour theme.
ipcMain.handle('ftc-close',async e=>{if(!robotView||e.sender!==robotView.webContents)throw Error('No FTC robot is open.');auto.dismissed=true;await closeRobot();return true;});
ipcMain.handle('ftc-fullscreen',async e=>{if(!robotView||e.sender!==robotView.webContents)throw Error('No FTC robot is open.');await setRobotFullscreen(true);return true;});
ipcMain.on('app-theme',(e,theme)=>{if(e.sender!==win?.webContents||!['system','light','dark'].includes(theme))return;appTheme=theme;if(bridge instanceof FtcSocket)try{robotView?.webContents.send('ftc-theme',theme);}catch{}});
// A configuration saved or picked in the Driver Station's Configure Robot goes to Setup, Simulate and Calibrate.
ipcMain.on('ftc-use-configuration',(e,c)=>{if(robotView&&e.sender===robotView.webContents&&typeof c?.xml==='string'&&c.xml.length<200000&&typeof c.name==='string')emit('robot-config',{name:c.name,xml:c.xml});});
ipcMain.handle('ftc-controller-capture',(e,slot)=>{if(e.sender!==robotView?.webContents||!(bridge instanceof FtcSocket))throw Error('No FTC driver station is open.');return captureController(slot);});
ipcMain.handle('ftc-manage',async e=>{if(!robotView||e.sender!==robotView.webContents)throw Error('No FTC robot is open.');return openManager();});
// The Driver Station's Settings > Pair with Robot Controller: Deck's Settings, with the robot kept connected.
ipcMain.handle('ftc-settings',async e=>{if(!robotView||e.sender!==robotView.webContents)throw Error('No FTC robot is open.');await setPage('settings');return true;});
// Configure Robot's product photos (read from the makers' listings while online and kept here) and saving a pinout.
const fromDs=e=>{if(!robotView||e.sender!==robotView.webContents)throw Error('No FTC robot is open.');};
handle('device-photo',tag=>photos().photo(String(tag||'')));
// The computer stays awake while a Control Hub is in use over USB: sleeping suspends the port, and the hub can then need a replug.
let hubSeenAt=0,awake=null;
setInterval(()=>{const on=bridge instanceof UsbFtcSocket||Date.now()-hubSeenAt<15000;if(on&&awake===null)awake=powerSaveBlocker.start('prevent-app-suspension');else if(!on&&awake!==null){powerSaveBlocker.stop(awake);awake=null;}},5000).unref();
ipcMain.handle('ftc-device-photo',async(e,tag)=>{fromDs(e);return photos().photo(String(tag||''));});
ipcMain.handle('ftc-device-photos',async e=>{fromDs(e);return photos().prefetch();});
// The hubs the open robot's web server lists, with each one's IMU (Configure Robot's New: the scan leaves it UNKNOWN).
ipcMain.handle('ftc-rc-hubs',async e=>{fromDs(e);if(!(bridge instanceof FtcSocket))return [];return robotLink.rcHubs(bridge instanceof UsbFtcSocket?'usb':bridge.host);});
// Configure Robot's wiring notes (a motor's gearbox, whether its encoder cable is in) by robot and configuration: the robot
// sends configurations without them. notes: set (an empty object removes); omitted: read.
ipcMain.handle('ftc-wiring-notes',async(e,{robot,name,notes}={})=>{fromDs(e);const file=path.join(app.getPath('userData'),'wiring-notes.json'),key=`${String(robot||'').slice(0,80)}\n${String(name||'').slice(0,80)}`;
  let all={};try{all=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}if(!all||typeof all!=='object'||Array.isArray(all))all={};
  if(notes!==undefined){const json=JSON.stringify(notes??{});if(json.length>20000)throw Error('Too many notes.');if(json==='{}')delete all[key];else all[key]=JSON.parse(json);fs.writeFileSync(file+'.tmp',JSON.stringify(all));fs.renameSync(file+'.tmp',file);}
  return all[key]||null;});
async function savePinoutFile({name,data,kind}){const types={png:['PNG image','png'],svg:['SVG drawing','svg']},t=types[kind];if(!t||typeof data!=='string')throw Error('Choose PNG or SVG.');
  const safe=String(name||'pinout').replace(/[\\/:*?"<>|]+/g,' ').trim().slice(0,80)||'pinout',r=await dialog.showSaveDialog(win,{title:'Save pinout',defaultPath:path.join(app.getPath('documents'),`${safe}.${t[1]}`),filters:[{name:t[0],extensions:[t[1]]}]});
  if(r.canceled||!r.filePath)return null;fs.writeFileSync(r.filePath,kind==='png'?Buffer.from(data,'base64'):data);return r.filePath;}
ipcMain.handle('ftc-save-file',async(e,file)=>{fromDs(e);return savePinoutFile(file);});
handle('save-pinout',savePinoutFile);
handle('manager-close',closeManager);
// An FTC robot makes its own Wi-Fi network. Once a robot is saved as FTC, joining that network opens Drive and
// its Driver Station as soon as the Robot Controller answers. Retries every poll (the hub's Wi-Fi starts before
// its software); closing the robot stops this until the network changes.
const auto={ssid:null,dismissed:false,busy:false};
async function autoOpenFtc(){
  const ssid=currentNetwork?.ssid||'';if(auto.ssid!==ssid)Object.assign(auto,{ssid,dismissed:false});
  if(competition||offlinePage(state.page)||suspended||state.recovering||auto.busy||auto.dismissed||robotView||opening||finding||updater?.busy||network.busy||!library||!ssid)return;
  const saved=library.list(ssid).filter(r=>r.ssid===ssid&&r.kind==='ftc');if(!saved.length)return;
  auto.busy=true;
  try{
    const host=await findFtc([...new Set(saved.map(r=>new URL(r.url).hostname))]);const robot=saved.find(r=>new URL(r.url).hostname===host);
    if(robot&&!offlinePage(state.page)&&!suspended&&!state.recovering&&!robotView&&!opening&&!auto.dismissed&&(currentNetwork?.ssid||'')===ssid){auto.busy=false;await openRobot({id:robot.id});}
  }catch(e){emit('notice',e.message);}finally{auto.busy=false;}
}
handle('bootstrap',async()=>{await refreshNetwork();setTimeout(()=>void autoOpenFtc(),300);return {state:snapshot(),hardware:hardware(),app:{version:meta.version,channel:meta.updateChannel}};});handle('open',input=>{driveRobot=null;return openRobot(input);});handle('close',async()=>{auto.dismissed=true;driveRobot=null;await closeRobot();});
// The open robot stays connected while Settings is shown; it is hidden, not closed. Setup, Calibrate and Simulate need the robot themselves, since only one Driver Station can talk to it at a time, so what was open comes back when Drive does.
let driveRobot=null;
// Competition mode, from the three-dot menu. R704 lets Wi-Fi streaming go only through the FTC Driver Station app, so Torque drives and streams only over the cable. docs/COMPETITION-RULES.md
let competition=false;
const COMPETITION_WIFI='Competition mode is on, and FTC rule R704 allows streaming over Wi-Fi only through the FTC Driver Station app. Use the USB-C cable, or turn Competition mode off in the three-dot menu once you are away from the event.';
async function driveAgain(){const robot=driveRobot;driveRobot=null;try{await debugStop();if(robotCheck){robotCheck.stop();await Promise.race([robotCheck.ended?.catch(()=>{}),delay(5000)]);}if(state.page==='drive'&&!robotView&&!opening)await openRobot(robot);}catch(e){emit('notice',e.message);}}
async function setPage(page){
  if(!['drive','setup','settings','simulation','calibrate'].includes(page))throw Error('Unknown app view.');
  pageEpoch++;releaseKeys();
  if(page!=='drive'){robotKeyboard?.hide({focus:false});await setRobotFullscreen(false);}
  update({page});fitView();
  // Simulation and Calibrate are offline. Close the live robot, including its active FTC op mode.
  if(offlinePage(page)){finding?.abort();if(robotView&&active)driveRobot={...active};await closeRobot();}
  // Leaving them ends the simulation's processes, including any running Java program, and a guided check running on a robot.
  else {simulation?.stop();robotCheck?.stop();}
  // Live debug drives the robot's outputs: it only runs while Calibrate or Setup's hub test shows.
  if(page!=='calibrate'&&page!=='setup')robotDebug?.stop();
  if(page==='drive'&&driveRobot)void driveAgain();
  return snapshot();
}
handle('page',setPage);
// Setup's Configure Robot button: the Driver Station's own page (its three-dot menu's Configure Robot), on the robot that is
// open or the Control Hub on the cable. Without a robot it says how to get one.
let dsOpenPage=null;
handle('configure-robot',async()=>{
  if(robotView&&bridge instanceof FtcSocket){await setPage('drive');robotView.webContents.send('ftc-open','configure');return {opened:true};}
  const usb=await robotLink.usbStatus().catch(e=>({found:false,message:e.message}));
  if(!usb.found)throw Error(`Configure Robot needs a robot. Plug the Control Hub in by USB-C, or open your robot in Settings. (${usb.message})`);
  dsOpenPage='configure';const opened=await openRobot({url:USB_HOST,name:'Control Hub (USB)',kind:'ftc',controllerCount:active?.controllerCount||1});if(!opened?.opened)dsOpenPage=null;return opened;});
handle('sim-open-ready',()=>{terminalReady=true;void deliverTerminalSetup();});
// A simulator robot drag locks the pointer; on release the system cursor is put back on the robot.
// Electron cannot move the cursor, so Windows uses user32 from one long-lived PowerShell (started
// when the drag begins) and Linux uses xdotool when it is installed. macOS leaves it in place.
let cursorHelper=null;
function cursorProcess(){
  if(process.platform!=='win32')return null;if(cursorHelper&&cursorHelper.exitCode===null&&!cursorHelper.killed)return cursorHelper;
  const script='$s=\'[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr c);\';Add-Type -Namespace Deck -Name Cursor -MemberDefinition $s;try{[void][Deck.Cursor]::SetProcessDpiAwarenessContext([System.IntPtr]::new(-4))}catch{};while(($l=[Console]::In.ReadLine()) -ne $null){$a=$l.Split(\' \');[void][Deck.Cursor]::SetCursorPos([int]$a[0],[int]$a[1])}';
  cursorHelper=require('node:child_process').spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{windowsHide:true,stdio:['pipe','ignore','ignore']});
  cursorHelper.on('error',()=>{cursorHelper=null;});cursorHelper.stdin.on('error',()=>{});return cursorHelper;
}
handle('cursor',(x,y)=>{
  if(x==='prepare'){cursorProcess();return false;}
  if(!win||win.isDestroyed()||![x,y].every(Number.isFinite))return false;
  const b=win.getContentBounds(),zoom=win.webContents.getZoomFactor(),dip={x:Math.round(b.x+x*zoom),y:Math.round(b.y+y*zoom)};
  if(process.platform==='win32'){const p=screen.dipToScreenPoint(dip);cursorProcess()?.stdin.write(`${Math.round(p.x)} ${Math.round(p.y)}\n`);return true;}
  if(process.platform==='linux'){const s=screen.getDisplayNearestPoint(dip).scaleFactor||1;execFile('xdotool',['mousemove',String(Math.round(dip.x*s)),String(Math.round(dip.y*s))],()=>{});return true;}
  return false;
});
app.on('will-quit',()=>{try{cursorHelper?.kill();}catch{}});
handle('sim',async(method,args)=>{if(!offlinePage(state.page))throw Error('Open the Simulation view first.');return simulation.call(method,args);});
handle('sim-file',(action,data)=>simulation.file(dialog,win,action,data));
// Setup & Calibrate → Axon Programmer: Axon servos through Axon's V2 programmer. USB runs only between start and stop, while that tab shows.
const axonSoftwareFolders=()=>{const home=app.getPath('home'),cloud=process.env.OneDrive;return [app.getPath('downloads'),app.getPath('desktop'),app.getPath('documents'),path.join(home,'Downloads'),path.join(home,'Desktop'),path.join(home,'Documents'),...(cloud?['Downloads','Desktop','Documents'].map(n=>path.join(cloud,n)):[])];};
const axonService=()=>axon||=new axonProgrammer.AxonService({findSoftware:axonSoftware.finder({folders:axonSoftwareFolders()}),firmwareDir:path.join(app.getPath('userData'),'axon-firmware'),keyFile:path.join(app.getPath('userData'),'axon-keys.json'),sharedKeyFile:process.env.DECK_DATA_DIR?null:path.join(app.getPath('documents'),'Torque Axon keys.json'),logFile:path.join(app.getPath('userData'),'axon-usb.log'),onState:s=>emit('axon-state',s),
  fetchFile:async url=>{const r=await net.fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(`Axon's link answered ${r.status}.`);return Buffer.from(await r.arrayBuffer());},...axonProgrammer.overrides});
handle('axon',async(action,data)=>{const s=axonService(),ext=()=>s.state().servo.family==='v1'?'svo':'svp';
  if(action==='preview')return s.preview(data?.code,data?.mode);if(action==='start')return s.start();if(action==='stop')return void await s.dispose();if(action==='state')return s.state();if(action==='trace')return s.traceLines;
  if(action==='read')return s.read();if(action==='write')return s.write(data?.changes);if(action==='defaults')return s.defaults();if(action==='close-rivals')return void await s.closeRivals();
  if(action==='firmware-status')return s.firmwareStatus(data?.code,data?.mode);if(action==='download')return s.download(data?.code,data?.mode);if(action==='flash')return s.flash(data||{});
  if(action==='choose-firmware'){const r=await dialog.showOpenDialog(win,{title:'Choose Axon firmware',filters:[{name:'Axon firmware',extensions:['sfw','sfm']}],properties:['openFile']});return r.canceled?null:s.chooseFirmware(data?.code,data?.mode,r.filePaths[0]);}
  if(action==='software-open'){const file=s.softwareFile(data?.family);if(!file)throw Error("Axon's software is not on this computer.");const problem=await shell.openPath(file);if(problem)throw Error(problem);return true;}
  if(action==='import-keys'){const r=await dialog.showOpenDialog(win,{title:'Import your key file',filters:[{name:'Key file',extensions:['json']}],properties:['openFile']});return r.canceled?null:s.importKeys(r.filePaths[0]);}
  if(action==='open-settings'){const r=await dialog.showOpenDialog(win,{title:'Open servo settings',filters:[{name:'Servo settings',extensions:[ext()]}],properties:['openFile']});return r.canceled?null:s.loadSettings(fs.readFileSync(r.filePaths[0]),path.basename(r.filePaths[0]));}
  if(action==='save-settings'){const file=s.packSettings(data?.changes),r=await dialog.showSaveDialog(win,{title:'Save servo settings',defaultPath:path.join(app.getPath('documents'),`${s.state().servo.name||'servo'}.${ext()}`),filters:[{name:'Servo settings',extensions:[ext()]}]});if(r.canceled||!r.filePath)return null;fs.writeFileSync(r.filePath,file);return {name:path.basename(r.filePath)};}
  throw Error('Unknown Axon action.');});
// Send to robot (Simulation → Run & review → Export): reads a Control Hub's configuration (and scans its hubs to add
// devices), saves a new configuration with the devices it lacks, and uploads and builds the exported OnBot Java over its
// Wi-Fi. It never starts an op mode. robots lists the saved FTC robots to pick from.
// select: the autonomous just built, which Drive selects when that robot is next opened (within the hour).
// check-start / check-press / check-stop: the guided check TeleOp, run from the Send panel; its telemetry arrives as
// robot-link-check events, then one {ended} (or {error}) when it stops.
// debug-install / debug-start / debug-send / debug-stop: Torque Debug (Calibrate → Camera and Debug). Its device
// list and readings arrive as robot-link-debug events ({manifest}, {frame}), then one {ended} (or {error}).
let sentOpMode=null,robotCheck=null,robotDebug=null,debugBusy=null;
const debugStop=async()=>{const debug=robotDebug;if(!debug)return;debug.stop();const over=await Promise.race([debug.ended.then(()=>true,()=>true),delay(5000).then(()=>false)]);
  // Given up on: what comes next must not be reached by a late stop of this one's. The page still hears that it ended.
  if(!over&&!debug.told){debug.told=true;debug.abandon();emit('robot-link-debug',{ended:'stopped'});}if(robotDebug===debug)robotDebug=null;};
// A hub whose Robot Controller app really crashed on Torque Debug: it does not go on that hub again until someone presses for it. Kept on this computer, so relaunching does not try again.
const debugTripFile=()=>path.join(app.getPath('userData'),'torque-debug-crashes.json');
const debugTrips=()=>{try{const all=JSON.parse(fs.readFileSync(debugTripFile(),'utf8'));return all&&typeof all==='object'?all:{};}catch{return {};}};
function debugTrip(serial,on){const all=debugTrips();if(!!all[serial]===on)return;if(on)all[serial]=new Date().toISOString();else delete all[serial];try{fs.writeFileSync(debugTripFile(),JSON.stringify(all));}catch{}}
// The crash guard's watch after a build, beside whatever comes next. A newer build has its own. A real crash takes the program off and says so to whoever is listening, and that hub is remembered.
let debugGuarding=null;
function debugWatch(before,serial){const me={};debugGuarding=me;void robotLink.usbDebugGuard({before,still:()=>debugGuarding===me}).catch(e=>{if(e.crashed){debugTrip(serial,true);emit('robot-link-debug',{error:e.message});}}).finally(()=>{if(debugGuarding===me)debugGuarding=null;});}
// Torque Debug onto the robot and built, and over the cable the crash guard then watches that the app survives it. auto: Calibrate → Camera asked, so nothing goes on unless the robot is free and that page still shows: a build
// on a robot someone is driving would disturb them. noStart with it: nobody pressed anything, which never happens over Wi-Fi, where nothing could bring the app back from a crash, or on a hub it has crashed.
async function debugInstall(data,overLink,usbOptions){const usb=data?.host==='usb',nobody=data?.noStart===true,here=()=>{if(state.page!=='calibrate'&&state.page!=='setup')throw Error('Torque left this page before the robot started.');},serial=usb?(await robotLink.usbForward()).serial:null;
  if(data?.auto){here();if(bridge instanceof FtcSocket)throw Error('Close the robot in Drive first: its Driver Station is using the robot connection.');
    if(nobody&&!usb)throw Error('Over Wi-Fi, Torque puts the camera program on the robot only when someone asks.');
    if(nobody&&debugTrips()[serial])throw Error('Last time, the Robot Controller app on this robot crashed when it loaded Torque Debug, so Torque will not put it back by itself. Press Try again to put it on once more.');
    await overLink(o=>robotLink.debugIdle(data?.host,o),undefined,usbOptions);here();}
  if(serial&&!nobody)debugTrip(serial,false);
  const before=usb?await robotLink.usbCrashes({serial}):undefined,opMode=robotLink.debugName(),built=await robotLink.send(data?.host,{[robotLink.DEBUG_FILE]:robotLink.debugSource(opMode)},{remove:[robotLink.OLD_DEBUG_FILE],backupDir:path.join(app.getPath('userData'),'robot-backups'),onProgress:(stage,file)=>emit('robot-link-progress',{stage,file})});
  if(built.built&&usb)debugWatch(before,serial);
  return {...built,opMode,...(built.built?{}:{problem:robotLink.buildProblem(built.errors)})};}
// What waits while that runs: a save or a restart would look like a crash to the guard, and a build is not to be interrupted. Reading the hub's files and ports does neither.
const DEBUG_HOLDS=new Set(['check-start','debug-start','debug-current','debug-install','rc-start','read','read-all','hubs','scan','delete-config','check','activate','configure','send']);
// Wiring notes read over the cable, for when Wi-Fi cannot read them (robotLink.notesThrough), and failing that those Drive's Configure Robot keeps. An entry here, empty or not, is what was last saved or read.
let notesRobot=null;const notesStore={file:()=>path.join(app.getPath('userData'),'configuration-notes.json'),key:(robot,name)=>`${String(robot).slice(0,80)}\n${String(name).slice(0,80)}`,
  all(file){try{const v=JSON.parse(fs.readFileSync(file,'utf8'));return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return {};}},
  get(robot,name){const k=notesStore.key(robot,name),own=notesStore.all(notesStore.file());return k in own?own[k]:notesStore.all(path.join(app.getPath('userData'),'wiring-notes.json'))[k]||null;},
  set(robot,name,notes){const k=notesStore.key(robot,name),file=notesStore.file(),own=notesStore.all(file);if(JSON.stringify(own[k]??null)===JSON.stringify(notes))return;own[k]=notes;try{fs.writeFileSync(file,JSON.stringify(own));}catch{}}};
const readThrough=read=>{if(read?.deviceName)notesRobot=read.deviceName;return robotLink.notesThrough(read,notesStore);};
// The Control Hub left the cable: what was kept for it goes, and whatever runs through it has ended, now rather than when it times out.
function hubUnplugged(serial){robotLink.usbForget(serial);
  if(robotDebug?.usb){const debug=robotDebug;robotDebug=null;debug.told=true;debug.stop('lost');emit('robot-link-debug',{ended:'lost'});}
  if(robotCheck?.usb){const check=robotCheck;robotCheck=null;check.told=true;check.stop('lost');emit('robot-link-check',{ended:'lost'});}}
// The USB watch (src/usb-watch.cjs), while a tab that works with the Control Hub shows. Its changes arrive as usb-watch events. What is on the hub's own USB ports follows it
// (src/hub-usb.cjs): the same events carry the list as hubUsb, and a change there is one more event, why 'hub-usb'. It runs while ADB can talk to the hub and stops when the watch does.
const hubFollower=new HubUsb.HubUsbFollower({onChange:list=>{if(usbWatch?.wanted)emit('usb-watch',{...usbWatch.state(),why:'hub-usb',hubUsb:list});}});
const hubWatcher=()=>usbWatch||=new UsbWatch({adbPath:robotLink.adbPath,logFile:path.join(app.getPath('userData'),'usb-watch.log'),onChange:s=>{hubFollower.follow(HubUsb.hubToFollow(s));emit('usb-watch',{...s,hubUsb:hubFollower.latest()});},onGone:hubUnplugged,onQuit:()=>hubFollower.follow(null)});
// The hub to ask, for a page that asks before the watch has said: the watch knows without running ADB.
const hubOnUsb=async()=>{const known=HubUsb.hubToFollow({hub:usbWatch?.hub});if(known)return known;const s=await robotLink.usbStatus();if(!s.found)throw Error(s.message||'No Control Hub on USB.');return s.serial;};
handle('robot-link',async(action,data)=>{
  if(action==='competition'){competition=data?.on===true;return competition;}
  if(action==='usb-watch'){if(data?.shown)return hubWatcher().shown(data.shown,data.at);if(!data?.on)return usbWatch?.stop()??null;const s=hubWatcher().start();hubFollower.follow(HubUsb.hubToFollow(s));return {...s,hubUsb:hubFollower.latest()};}
  // What is on the hub's own USB ports. They only read the hub, so they go on while live debug runs.
  if(action==='hub-usb'){const serial=await hubOnUsb();return hubFollower.serial===serial?hubFollower.latest()||await hubFollower.read():HubUsb.readHubUsbList(serial);}
  if(action==='hub-usb-camera')return {hex:await HubUsb.readDescriptors(await hubOnUsb(),String(data?.path||''))};
  if(action==='hub-usb-drops')return HubUsb.recentDrops(await hubOnUsb());
  if(action==='hub-rc-up')return robotLink.usbControllerUp(await hubOnUsb());
  if(action==='limelight'){const serial=await hubOnUsb();if(!data?.path)return HubUsb.readLimelight(serial);const at=await HubUsb.limelightAddress(serial);return HubUsb.limelightGet(serial,String(data.path),{host:at?.address});}
  if(action==='robots')return library.list().filter(r=>r.kind==='ftc').map(r=>{let host='';try{host=new URL(r.url).hostname;}catch{}return {name:r.name,host};}).filter(r=>r.host);
  if(action==='select'){const name=typeof data?.opMode==='string'?data.opMode:'';if(!name||name.length>200)throw Error('No op mode to select.');sentOpMode={host:robotLink.checkHost(data?.host),name,at:Date.now()};return true;}
  // Which ways Send to robot can reach a robot now: a Control Hub on the USB cable, and the robot whose Wi-Fi this
  // computer is on (a saved FTC robot on this network, or a Control Hub or Robot Controller phone network by its name).
  // Its address: the robot saved for this network, else one saved for any network, else the usual Control Hub address.
  if(action==='detect'){const ssid=currentNetwork?.ssid||'',ftc=library.list(ssid).filter(r=>r.kind==='ftc'),saved=ftc.find(r=>ssid&&r.ssid===ssid)||ftc.find(r=>!r.ssid),phone=/^DIRECT-/i.test(ssid);let host='';try{host=saved?new URL(saved.url).hostname:'';}catch{}
    // While the USB watch is up it already knows, so no ADB runs for this.
    const usb=usbWatch?.status()??await robotLink.usbStatus().catch(e=>({found:false,message:e.message})).then(p=>usbWatch?usbWatch.withPoll(p):p);if(usb.found)hubSeenAt=Date.now();
    // A robot saved under this network, or a network named like one, is only a guess: without a hub on USB, ask whether it answers. A port already in use is usually this app holding a link to it, Live debug say, which nothing else could be doing.
    const robot=!!saved&&!!ssid&&saved.ssid===ssid||/^FTC-|-RC$|^DIRECT-/i.test(ssid),wifiHost=host||(phone?'192.168.49.1':'192.168.43.1'),reachable=robot&&!usb.found?await probeFtc(wifiHost,{timeout:700}).then(r=>!!r.ftc||/in use/.test(r.error||"")).catch(()=>false):robot;
    return {usb,wifi:{ssid,robot,reachable,host:wifiHost,name:saved?.name||''}};}
  if(action==='check-press')return !!robotCheck?.press(String(data?.button||''));
  if(action==='debug-camera')return !!robotDebug?.camera(data?.on===true);
  if(action==='debug-send')return !!robotDebug?.send(String(data?.line||''));
  if(action==='debug-stop'){await debugStop();return true;}
  // Calibrate → Camera runs it by itself, and that gives way to anything a student asks of the robot, until something has driven an output (debug-claim).
  if(action==='debug-claim'){if(robotDebug)robotDebug.auto=false;return true;}
  if(debugBusy&&DEBUG_HOLDS.has(action))await debugBusy.catch(()=>{});
  if(robotDebug?.auto||robotDebug&&(action==='configure'||action==='activate'))await debugStop();
  if(robotDebug)throw Error('Live debug is still running. Stop it first.');
  // Resolves once the robot has stopped the check and the connection is free (5 s at most).
  if(action==='check-stop'){const check=robotCheck;if(check){check.stop();await Promise.race([check.ended.catch(()=>{}),delay(5000)]);}return true;}
  if(robotCheck)throw Error('The guided check is still running. Stop it first.');
  // noStart: nobody pressed anything, so a stopped Robot Controller app stays stopped.
  const usbOptions=data?.noStart===true?{noStart:true,wait:0}:undefined;
  // Over the cable these go through the Driver Station link, as over Wi-Fi. link: for what nobody pressed, which does not start the Robot Controller app.
  const overLink=async(task,options,link)=>{if(data?.host!=='usb')return task({});const socket=await new UsbFtcSocket(()=>robotLink.usbLink(link).then(f=>({port:f.link})),options).open();try{return await task({socket});}finally{await socket.close();}};
  if(action==='debug-install'){const job=debugInstall(data,overLink,usbOptions),done=()=>{if(debugBusy===job)debugBusy=null;};debugBusy=job;job.then(done,done);return job;}
  if(bridge instanceof FtcSocket)throw Error('Close the robot in Drive first: its Driver Station is using the robot connection.');
  // Try again on Calibrate → Camera, when the Robot Controller app is not answering: a press may start it.
  if(action==='rc-start'){if(data?.host==='usb')await robotLink.usbController((await robotLink.usbForward()).serial);return true;}
  // Is the robot's Torque Debug this one? The app has to be up to say.
  if(action==='debug-current'){if(data?.host==='usb')await robotLink.usbLink(usbOptions);return robotLink.debugCurrent(data?.host);}
  if(action==='check-start'){
    const check=robotLink.runCheck(data?.host,data?.opMode,{onUpdate:update=>emit('robot-link-check',update)});robotCheck=check;check.usb=data?.host==='usb';
    check.ended.then(why=>{if(!check.told)emit('robot-link-check',{ended:why});},e=>{if(!check.told)emit('robot-link-check',{error:e.message});}).finally(()=>{if(robotCheck===check)robotCheck=null;});
    return true;}
  if(action==='debug-start'){
    if(competition&&data?.host!=='usb')throw Error(COMPETITION_WIFI);
    const host=data?.host==='usb'?'usb':robotLink.checkHost(data?.host),socket=host==='usb'?await new UsbFtcSocket(()=>robotLink.usbLink(usbOptions).then(f=>({port:f.link}))).open():null;
    // The page may have changed while the cable's link came up, and Live debug only runs while Calibrate or Setup shows.
    if(state.page!=='calibrate'&&state.page!=='setup'){await socket?.close();throw Error('Torque left this page before the robot started.');}
    const debug=robotLink.runDebug(host,{socket,opMode:typeof data?.opMode==='string'?data.opMode:null,onManifest:manifest=>emit('robot-link-debug',{manifest}),onFrame:frame=>emit('robot-link-debug',{frame}),onCamera:bytes=>emit('robot-link-debug',{camera:Uint8Array.from(bytes)})});robotDebug=debug;debug.usb=host==='usb';debug.auto=data?.auto===true;
    debug.ended.then(why=>{if(!debug.told)emit('robot-link-debug',{ended:why});},e=>{if(!debug.told)emit('robot-link-debug',{error:e.message});}).finally(()=>{if(robotDebug===debug)robotDebug=null;if(socket)void socket.close();});
    return true;}
  if(action==='read')return robotLink.readRobot(data?.host,{scan:data?.scan===true});
  if(action==='read-usb')return readThrough(await robotLink.readUsb());
  // The robot's own dashboard (Program & Manage, OnBot Java, Blocks) through the USB cable, in a window of its own.
  if(action==='usb-dashboard'){const {port,serial}=await robotLink.usbForward();const view=new BrowserWindow({width:1200,height:820,title:`Robot Controller ${serial} (USB)`,autoHideMenuBar:true,webPreferences:{contextIsolation:true,sandbox:true}});await view.loadURL(`http://127.0.0.1:${port}/`);return {port,serial};}
  if(action==='usb-status')return robotLink.usbStatus();
  if(action==='usb-recover')return robotLink.usbRecover();
  if(action==='hubs')return overLink(o=>robotLink.scanRobot(data?.host,o));
  // The hubs the robot has open show first, from its web server in milliseconds; then each answer from the RS485 cable.
  if(action==='scan'){const live=await robotLink.rcHubs(data?.host),onProgress=p=>emit('robot-link-scan',p);if(live.length)onProgress({portals:robotLink.openHubs(live)});return overLink(o=>robotLink.scanDevices(data?.host,{...o,live,onProgress}),{grace:150},data?.noStart===true?{noStart:true,wait:0}:undefined);}
  if(action==='delete-config')return overLink(o=>robotLink.deleteConfiguration(data?.host,data?.name,o));
  if(action==='check'){const usb=data?.host==='usb'?await robotLink.usbCheck():[];if(usb.some(s=>!s.ok))return usb;const talk=()=>overLink(o=>robotLink.connectionCheck(data?.host,o),undefined,data?.noStart===true?{noStart:true}:undefined);try{return [...usb,...await talk().catch(async e=>{if(!/not found|offline|closed/i.test(e.message))throw e;await new Promise(r=>setTimeout(r,1200));return talk();})];}catch(e){return [...usb,{name:'Talk to the robot',ok:false,detail:e.message}];}}
  if(action==='read-all')return readThrough(await overLink(o=>robotLink.readConfigurations(data?.host,o)));
  if(action==='activate')return overLink(o=>robotLink.activateConfiguration(data?.host,data?.name,o));
  if(action==='configure'){const saved=await overLink(o=>robotLink.writeConfiguration(data?.host,{name:data?.name,xml:data?.xml,replace:data?.replace===true},o));if(notesRobot)notesStore.set(notesRobot,data?.name,robotLink.notesOf(data?.xml));return saved;}
  if(action==='send')return robotLink.send(data?.host,data?.files,{keep:Array.isArray(data?.keep)?data.keep:[],backupDir:path.join(app.getPath('userData'),'robot-backups'),onProgress:(stage,file)=>emit('robot-link-progress',{stage,file})});
  throw Error('Unknown robot action.');
});
handle('save',async input=>{const wifi=await refreshNetwork();const robot=library.upsert({...input,ssid:wifi.ssid||''});if(active?.id===robot.id){active=robot;controllerHub.setCount(robot.controllerCount);update({robot});sendControllers(true);}else update();return robot;});handle('remove',id=>{library.remove(id);update();});
handle('network',refreshNetwork);handle('scan',()=>network.scan());
handle('discovery-info',async()=>{const context=await network.context();return {...context,reason:discovery.eligibility(context)};});
handle('discover-robot',async input=>{if(finding)throw Error('Already finding a robot.');if(robotView||opening)throw Error('Close the current robot before finding another.');const controller=new AbortController();finding=controller;try{return await discovery.discover({network,ssid:input?.ssid,confirmed:input?.confirmed,signal:controller.signal});}finally{if(finding===controller)finding=null;}});
handle('discovery-cancel',()=>{finding?.abort();});
handle('join',async(ssid,password)=>{await closeRobot();let info;try{info=await network.join(ssid,password);}catch(e){if(e.code==='NEEDS_PASSWORD')return {needsPassword:true,ssid,message:e.message};throw e;}currentNetwork=info;emit('network',info);update();setTimeout(()=>void autoOpenFtc(),500);return info;});
handle('system-wifi',async()=>{
  await closeRobot();if(process.platform==='win32')return shell.openExternal('ms-settings:network-wifi');
  if(process.platform==='darwin')return shell.openExternal('x-apple.systempreferences:com.apple.wifi-settings-extension');
  await run('systemsettings',['kcm_networkmanagement'],{timeout:5000}).catch(e=>{if(e.killed)return;throw Error('Open Wi-Fi from the SteamOS quick settings menu.');});
});
handle('bounds',bounds=>{if(!bounds||!['x','y','width','height'].every(k=>Number.isFinite(bounds[k])&&bounds[k]>=0))throw Error('Invalid robot view bounds.');if(!state.robotFullscreen)viewBounds=bounds;fitView();});
handle('overlay',visible=>{const previous=overlay;overlay=!!visible;if(previous!==overlay)releaseKeys();if(overlay)robotKeyboard?.hide({focus:false});fitView();if(previous&&!overlay&&state.page==='drive'&&win.isFocused())robotView?.webContents.focus();});
handle('robot-focus',()=>{if(state.page==='drive'&&!overlay&&!auth&&!robotKeyboard?.visible&&win.isFocused())(managerView||robotView)?.webContents.focus();});
async function goBack(){const view=managerView||robotView;if(view?.webContents.navigationHistory.canGoBack())view.webContents.navigationHistory.goBack();else if(managerView)await closeManager();}
handle('reload',()=>{const view=managerView||robotView;if(view)view.webContents.reload();});handle('back',goBack);handle('zoom',step=>setZoom(Math.sign(Number(step))||0));handle('keep-awake',enabled=>{keepAwake=enabled!==false;syncAwake();return keepAwake;});handle('touch-keyboard',enabled=>{touchKeyboard=enabled!==false;if(!touchKeyboard)robotKeyboard?.hide({focus:false});for(const view of [robotView,managerView])sendTouchKeyboard(view?.webContents);return touchKeyboard;});
handle('controllers',()=>controllerHub.state().slots);
handle('controller-info',()=>controllerState());handle('controller-capture',captureController);handle('controller-cancel',()=>{controllerHub.cancel();sendControllers(true);return controllerState();});
handle('controller-source',source=>{if(!['controller','keyboard'].includes(source))throw Error('Choose a controller or the keyboard.');keyboardSource=source==='keyboard';keyboardInput.reset();simulation?.practiceInput(null);try{fs.writeFileSync(sourceFile,JSON.stringify({controller1:source}),{mode:0o600});}catch{}ingestPads(lastPads);if(!keyboardSource){controllerHub.promote();ingestPads(lastPads);}sendControllers(true);return controllerState();});
handle('controller-automatic',()=>{controllerHub.automatic();sendControllers(true);return controllerState();});
handle('controller-calibration',({slot,zone})=>{if(![1,2].includes(slot))throw Error('Choose controller 1 or controller 2.');const pad=controllerHub.state().slots[slot-1];if(!pad||pad.mapping!=='standard')throw Error('Connect a mapped controller first.');const next=Object.assign(Object.create(null),calibrations,{[pad.id]:deadzone(zone)});fs.writeFileSync(calibrationFile+'.tmp',JSON.stringify(next),{mode:0o600});fs.renameSync(calibrationFile+'.tmp',calibrationFile);calibrations=next;controllerHub.blocked.add(`${pad.index}:${pad.id}`);sendControllers(true);return controllerState();});
handle('auth',({id,username,password,cancel})=>{if(!auth||auth.id!==id)throw Error('This sign-in prompt expired.');const pending=auth;auth=null;if(cancel)pending.callback();else pending.callback(String(username||'').slice(0,256),String(password||'').slice(0,1024));fitView();});
handle('fullscreen',()=>win.setFullScreen(!win.isFullScreen()));handle('quit',()=>app.quit());
handle('update-info',async()=>{auto.dismissed=true;finding?.abort();await closeRobot();return updater.info();});
handle('update-check',()=>updater.check());
handle('update-channel',(channel,confirmed)=>updater.setChannel(channel,confirmed));
handle('update-download',()=>updater.downloadAndInstall(async download=>{await closeRobot();const prepared=await prepareInstall(download,{appPath:app.getAppPath(),executable:process.execPath});await launchInstall(prepared);setTimeout(()=>app.quit(),200);return {restarting:true};}));
app.on('login',(event,contents,details,info,callback)=>{
  if(contents!==robotView?.webContents)return;event.preventDefault();if(auth)auth.callback();auth={id:randomUUID(),callback};robotKeyboard?.hide({focus:false});robotView.setVisible(false);emit('auth',{id:auth.id,host:active?.url||'',realm:info.realm||'',retry:!details.firstAuthAttempt});
  void setRobotFullscreen(false);
});
// A copy installed by a sandboxed Windows app (a packaged agent or shell) keeps its data inside that app's
// LocalCache, out of Explorer's reach. On the first start of a normal install, bring that robot list along.
function recoverSandboxedLibrary(dir){
  if(process.platform!=='win32'||process.env.DECK_DATA_DIR||fs.existsSync(path.join(dir,'robots.json'))||!process.env.LOCALAPPDATA)return;
  try{
    const packages=path.join(process.env.LOCALAPPDATA,'Packages');let best=null;
    for(const name of fs.readdirSync(packages)){for(const folder of [path.join(packages,name,'LocalCache','Roaming',app.getName()),path.join(packages,name,'LocalCache','Roaming',LEGACY_NAME)])try{const t=fs.statSync(path.join(folder,'robots.json')).mtimeMs;if(!best||t>best.t)best={folder,t};}catch{}}
    if(!best)return;fs.mkdirSync(dir,{recursive:true});
    for(const file of ['robots.json','update-settings.json'])if(fs.existsSync(path.join(best.folder,file))&&!fs.existsSync(path.join(dir,file)))fs.copyFileSync(path.join(best.folder,file),path.join(dir,file));
  }catch{}
}
app.whenReady().then(async()=>{
  powerMonitor.on('suspend',()=>{suspended=true;blockHeldControllers();sendControllers(true);void interruptRobot('Device sleeping. Your robot address is saved. After waking and reconnecting Wi-Fi, choose Try again.');});
  powerMonitor.on('resume',()=>{suspended=false;lastControllerInput=0;if(controllerHub)ingestPads([]);sendControllers(true);void (async()=>{if(interruption)await interruption;await refreshNetwork();if(state.recovering)update({error:'Device resumed. Your robot address is saved. Check Wi-Fi, then choose Try again. Robot controls stay neutral until released.'});})().catch(e=>emit('notice',e.message));});
  device=await detectHardware();
  recoverSandboxedLibrary(app.getPath('userData'));
  sourceFile=path.join(app.getPath('userData'),'input-source.json');try{keyboardSource=JSON.parse(fs.readFileSync(sourceFile,'utf8')).controller1==='keyboard';}catch{}
  const controllerFile=path.join(app.getPath('userData'),'controller-settings.json');let preferred=[];try{const saved=JSON.parse(fs.readFileSync(controllerFile,'utf8'));if(Array.isArray(saved))preferred=saved;}catch{}
  controllerHub=new ControllerHub({hardware:device,preferred,zoneFor:id=>calibrations[id]||0,persist:value=>fs.writeFileSync(controllerFile,JSON.stringify(value),{mode:0o600})});
  calibrationFile=path.join(app.getPath('userData'),'controller-calibration.json');try{for(const [id,zone]of Object.entries(JSON.parse(fs.readFileSync(calibrationFile,'utf8')))){if(id.length<=2048)calibrations[id]=deadzone(zone);}}catch{}
  zoomFile=path.join(app.getPath('userData'),'robot-zoom.json');try{for(const [key,factor]of Object.entries(JSON.parse(fs.readFileSync(zoomFile,'utf8'))))if(key.length<=2048&&zoomSteps.includes(factor))zooms[key]=factor;}catch{}
  updater=new Updater({directory:app.getPath('userData'),version:meta.version,repo:meta.repository.url,channel:meta.updateChannel,base:build.electron===process.versions.electron?build.base:'',onProgress:p=>emit('update-progress',p)});
  try{library=new Library(path.join(app.getPath('userData'),'robots.json'));}catch(e){state.error=`Saved library could not be read: ${e.message}`;library=new Library(path.join(app.getPath('userData'),`robots-recovered-${Date.now()}.json`));}
  const d=screen.getPrimaryDisplay().workAreaSize;
  win=new BrowserWindow({show:process.env.DECK_HEADLESS!=='1',width:Math.min(1280,d.width),height:Math.min(800,d.height),minWidth:360,minHeight:480,title:'Torque',icon:path.join(__dirname,'../ui/icon.png'),backgroundColor:'#080808',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),additionalArguments:[...controllerArguments,'--deck-controller-shell'],partition:'persist:launcher',sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  robotKeyboard=new RobotKeyboard({WebContentsView,ipcMain,window:()=>win,robot:()=>managerView||robotView,allowed:()=>touchKeyboard&&!!win&&!win.isDestroyed()&&state.page==='drive'&&!overlay&&!auth&&!state.error,changed:()=>fitView(),released:()=>{for(const pad of controllerHub.state().slots)if(pad)controllerHub.blocked.add(`${pad.index}:${pad.id}`);}});
  controllerSession(win.webContents.session);const controllerTimer=setInterval(()=>{if(lastControllerInput&&performance.now()-lastControllerInput>500)ingestPads([]);sendControllers();},100);controllerTimer.unref();
  win.webContents.on('render-process-gone',()=>{lastControllerInput=0;ingestPads([]);sendControllers(true);simulation.stop();});
  simulation=new SimulationHost({utilityProcess,dataDir:app.getPath('userData'),emit:message=>emit('sim-event',message)});
  // Install and update checks launch the packaged app with DECK_SMOKE_FILE and read back what started.
  if(process.env.DECK_SMOKE_FILE)win.webContents.once('did-finish-load',()=>{fs.writeFileSync(process.env.DECK_SMOKE_FILE,JSON.stringify({version:meta.version,electron:process.versions.electron,base:build.base||'',appPath:app.getAppPath(),pid:process.pid}));setTimeout(()=>app.exit(0),200);});
  keys(win.webContents,{shell:true});Menu.setApplicationMenu(null);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());win.on('resize',fitView);win.webContents.on('did-start-loading',()=>{terminalReady=false;});win.loadFile(path.join(__dirname,'../ui/index.html'));terminalSetup(process.argv);
  win.on('blur',releaseKeys);win.on('enter-full-screen',fitView);win.on('leave-full-screen',()=>{if(state.robotFullscreen)void setRobotFullscreen(false);else fitView();});
  // Closing while a Simulate setup is still being set up (Setup open, Path planning never opened) asks first; the setup
  // itself is already saved. Test runs (no window shown) close straight away.
  let closeAsked=false;
  win.on('close',e=>{
    if(!closeAsked&&process.env.DECK_HEADLESS!=='1'&&!win.webContents.isDestroyed()){e.preventDefault();closeAsked=true;
      const ask=Promise.race([win.webContents.executeJavaScript('window.deckUnfinishedSetup?.()??null',true),new Promise(r=>setTimeout(r,1500,null))]).catch(()=>null);
      void ask.then(async name=>{if(win.isDestroyed())return;
        if(axon?.flashing){const r=await dialog.showMessageBox(win,{type:'warning',buttons:['Keep running','Close anyway'],defaultId:0,cancelId:0,noLink:true,title:'Firmware update running',message:'An Axon servo is being updated.',detail:'Closing now can leave the servo needing Recover. It takes about a minute.'});if(r.response!==1){closeAsked=false;return;}}
        if(typeof name==='string'){const r=await dialog.showMessageBox(win,{type:'question',buttons:['Keep setting up','Close anyway'],defaultId:0,cancelId:0,noLink:true,title:'Setup not finished',
          message:`You haven’t finished setting up “${name}”.`,detail:'Your changes are saved. Finish the Robot, Robot controller and Mechanisms steps, then go to Path planning to plan its route.'});
          if(r.response!==1){closeAsked=false;return;}}
        win.close();});
      return;}
    robotKeyboard?.close();});win.on('closed',()=>{robotExitView?.webContents.close();robotExitView=null;});
  pollTimer=setInterval(()=>{if(!network.busy)void refreshNetwork().then(()=>autoOpenFtc());},5000);pollTimer.unref();
});
// Over the cable a stop reaches the robot through the relay, so Torque Debug's stop goes first and the relay last. A hub that does not answer holds quitting up for two seconds at most.
let closing=false;app.on('before-quit',e=>{usbWatch?.quit();axon?.quit();simulation?.stop();robotCheck?.stop();if(closing){robotDebug?.stop();robotLink.stopUsbRelay();return;}e.preventDefault();closing=true;clearInterval(pollTimer);
  void Promise.all([Promise.race([Promise.all([debugStop(),robotCheck?.ended.catch(()=>{})]),delay(2000)]),closeRobot().catch(()=>{})]).finally(()=>{robotLink.stopUsbRelay();app.quit();});});app.on('window-all-closed',()=>app.quit());
