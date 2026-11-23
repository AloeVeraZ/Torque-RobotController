'use strict';
const {contextBridge,ipcRenderer,webUtils}=require('electron');
const call=(name,...args)=>ipcRenderer.invoke(name,...args).then(r=>{if(!r.ok){const e=Error(r.error);e.code=r.code;throw e;}return r.value;});
const listen=(name,fn)=>{const cb=(_e,value)=>fn(value);ipcRenderer.on(name,cb);return()=>ipcRenderer.removeListener(name,cb);};
contextBridge.exposeInMainWorld('deck',{
  // The automated UI tests (DECK_TEST_SETUP=1) start on the generated Test setup; people start on the Starter Mecanum demo.
  testSetup:process.argv.includes('--deck-test-setup'),
  setTheme:theme=>ipcRenderer.send('app-theme',theme),
  // Themes (docs/THEMES.md): imported ones are kept in the app's data folder; the Driver Station's goes to its screen.
  themes:(action,data)=>call('themes',action,data),fonts:(action,data)=>call('fonts',action,data),themeGuide:which=>call('theme-guide',which),stationLook:look=>ipcRenderer.send('station-look',look),onStationTheme:fn=>listen('station-theme',fn),
  // Whether this window can be seen ({hidden}: minimised, hidden, or covered by the Driver Station or a robot's page), so
  // DEV's moving ground stops drawing while it cannot.
  onWindowState:fn=>listen('window-state',fn),
  robotFocus:()=>call('robot-focus'),
  devicePhoto:tag=>call('device-photo',tag),openExternal:url=>call('open-reference',url),savePinout:file=>call('save-pinout',file),
  robotFullscreen:enabled=>call('robot-fullscreen',enabled),
  controllerInfo:()=>call('controller-info'),controllerCapture:slot=>call('controller-capture',slot),controllerCancel:()=>call('controller-cancel'),controllerAutomatic:()=>call('controller-automatic'),controllerSource:source=>call('controller-source',source),onControllerState:fn=>listen('controller-state',fn),onControllerCapture:fn=>listen('controller-capture',fn),
  controllerCalibration:(slot,zone)=>call('controller-calibration',{slot,zone}),
  sim:(method,...args)=>call('sim',method,args),simFile:(action,data)=>call('sim-file',action,data),robotLink:(action,data)=>call('robot-link',action,data),onRobotServo:fn=>listen('robot-link-servo',fn),onRobotLink:fn=>listen('robot-link-progress',fn),onRobotCheck:fn=>listen('robot-link-check',fn),onRobotDebug:fn=>listen('robot-link-debug',fn),onRobotScan:fn=>listen('robot-link-scan',fn),onUsbWatch:fn=>listen('usb-watch',fn),axon:(action,data)=>call('axon',action,data),onAxon:fn=>listen('axon-state',fn),swyft:(action,data)=>call('swyft',action,data),onSwyft:fn=>listen('swyft-state',fn),simDropPath:file=>webUtils.getPathForFile(file),onSim:fn=>listen('sim-event',fn),onSimOpen:fn=>listen('sim-open',fn),simOpenReady:()=>call('sim-open-ready'),
  discoveryInfo:()=>call('discovery-info'),discoverRobot:input=>call('discover-robot',input),discoveryCancel:()=>call('discovery-cancel'),
  bugReport:report=>call('bug-report',report),bugReportBrowser:report=>call('bug-report-browser',report),
  updateInfo:()=>call('update-info'),updateState:()=>call('update-state'),updateChannel:(channel,confirmed)=>call('update-channel',channel,confirmed),updateCheck:()=>call('update-check'),updateDownload:()=>call('update-download'),onUpdateProgress:fn=>listen('update-progress',fn),
  configureRobot:()=>call('configure-robot'),onRobotConfig:fn=>listen('robot-config',fn),bootstrap:()=>call('bootstrap'),open:p=>call('open',p),close:()=>call('close'),page:p=>call('page',p),save:p=>call('save',p),remove:id=>call('remove',id),network:()=>call('network'),scan:()=>call('scan'),join:(ssid,pw)=>call('join',ssid,pw),systemWifi:()=>call('system-wifi'),bounds:r=>call('bounds',r),overlay:v=>call('overlay',v),reload:()=>call('reload'),back:()=>call('back'),zoom:step=>call('zoom',step),touchKeyboard:enabled=>call('touch-keyboard',enabled),cursor:(x,y)=>call('cursor',x,y),keepAwake:enabled=>call('keep-awake',enabled),controllers:()=>call('controllers'),auth:p=>call('auth',p),fullscreen:()=>call('fullscreen'),quit:()=>call('quit'),managerClose:()=>call('manager-close'),onNotice:fn=>listen('notice',fn),onState:fn=>listen('state',fn),onNetwork:fn=>listen('network',fn),onAuth:fn=>listen('auth',fn)
});
