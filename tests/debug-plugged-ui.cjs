'use strict';
// Calibrate → Debug on the lines a robot sends, in the real app with its real styles: what it says about an analog input stuck at 0 V, and about I2C devices with no read configuration behind them.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/debug-plugged-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright'),root=path.join(__dirname,'..'),wait=ms=>new Promise(r=>setTimeout(r,ms));
const soon=async(what,fn)=>{const end=Date.now()+8000;while(Date.now()<end){if(await fn().catch(()=>false))return;await wait(100);}throw Error('Not within 8 s: '+what);};
const XML=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<Robot type="FirstInspires-FTC">\n    <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">\n        <LynxModule name="Control Hub" port="173" />\n    </LynxUsbDevice>\n</Robot>\n`;
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-debug-plugged-')),env={...process.env,DECK_HEADLESS:'1',DECK_DATA_DIR:data,ADB:'C:\\Windows\\System32\\where.exe'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);await page.setViewportSize({width:1280,height:800});
    await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.webContents.setBackgroundThrottling(false);});
    // A Control Hub on the cable once plugged in, with only the Control Hub in its active configuration: nothing configured on its ports or buses.
    await app.evaluate(({ipcMain},{SERIAL,xml})=>{ipcMain.removeHandler('robot-link');ipcMain.handle('robot-link',async(e,action)=>{const ok=value=>({ok:true,value});if(!global.__plugged&&['detect','usb-status'].includes(action))return ok(action==='detect'?{usb:{found:false,message:'Not plugged in.'},wifi:{robot:false}}:{found:false});if(!global.__plugged)return {ok:false,error:'not plugged in'};const usb={serial:SERIAL,devices:[],addresses:[],at:1};
      if(action==='detect')return ok({usb:{found:true,serial:SERIAL},wifi:{robot:false}});if(action==='usb-status')return ok({found:true,serial:SERIAL});if(action==='usb-recover')return ok(null);
      if(action==='usb-watch')return ok({seq:1,at:Date.now(),usb:true,devices:[],hub:{serial:SERIAL,state:'device',model:null,vid:'2207',pid:'0011',usb:true},adb:{running:true,devices:[]},status:{found:true,serial:SERIAL},why:'+',drop:null,hubUsb:usb});
      if(action==='hub-usb')return ok(usb);if(action==='hub-usb-drops')return ok([]);if(action==='limelight')return ok({status:null});if(action==='hub-rc-up')return ok(true);
      if(action==='read-usb')return ok({serial:SERIAL,active:{name:'robot'},configurations:['robot'],files:{robot:xml}});if(action==='check')return ok([{name:'Robot Controller app',ok:true,detail:'FTC SDK 12.0'}]);
      if(action==='scan')return ok({portals:[{serial:'(embedded)',modules:[{address:173,parent:true}],servoHubs:[]}],others:[]});
      if(action==='debug-current')return ok({current:true,opMode:'TorqueDebug-x'});if(['debug-start','debug-stop','debug-claim','debug-send'].includes(action))return ok(true);return {ok:false,error:'not in this test: '+action};});},{SERIAL:'24677c4269e7e709',xml:XML});
    // Debug needs a robot with an active configuration. Before one answers, Calibrate says so in one line and shows nothing else.
    await page.evaluate(()=>window.deck.page('calibrate'));await page.waitForFunction(()=>state.page==='calibrate');await soon('the gate',()=>page.locator('#cal-gate').isVisible());assert.match(await page.textContent('#cal-gate'),/^Connect to the robot first/);assert.equal(await page.locator('#cal-debug').isVisible(),false,'nothing behind the gate');
    assert.equal(await page.getAttribute('#calibrate-view [data-flow=debug]','data-locked'),'','Debug waits for Configure');assert.equal(await page.getAttribute('#calibrate-view [data-flow=calibrate]','data-locked'),'','Calibrate waits for Debug');
    await app.evaluate(()=>{global.__plugged=true;});
    await page.evaluate(()=>window.deck.page('setup'));await page.waitForFunction(()=>state.page==='setup');await page.waitForFunction(()=>document.querySelectorAll('#rs-configs .rs-config').length===1);
    await page.evaluate(()=>window.deck.page('calibrate'));await page.waitForFunction(()=>state.page==='calibrate');await soon('the gate opens',()=>page.locator('#cal-gate').isHidden());assert.equal(await page.getAttribute('#calibrate-view [data-flow=debug]','data-locked'),null);
    // Debug by itself has no row of tabs: there is no camera.
    assert.equal(await page.locator('[data-cal-top-tabs]').isHidden(),true,'a lone Debug tab is not shown');
    const send=message=>app.evaluate(({BrowserWindow},m)=>{for(const w of BrowserWindow.getAllWindows())w.webContents.send('robot-link-debug',m);},message);
    // Over the cable Debug starts by itself; what the robot sends is read once it has.
    await soon('it starts by itself',async()=>/Stop live debug/.test(await page.textContent('[data-debug-start]')));await wait(1000);
    await send({manifest:{deck:'debug',version:1,motors:[],servos:[],crservos:[],digital:[],touch:[],cameras:[],analog:[{n:'wrist',max:3.3}],i2c:[{n:'gone',k:'color',h:173,b:1,a:0x29},{n:'there',k:'other',h:173,b:2,a:0x32},{n:'asking',k:'distance',h:173,b:3,a:0x29},{n:'nowhere',k:'other'}],hubs:[{n:'Control Hub',address:173,parent:true}]}});
    await page.waitForSelector('#cal-debug [data-port="analog:wrist"]');
    // Frames, then until the page has drawn the last: the robot clock in the stats line says how far it has got.
    let t=0;const frames=async(volts,count)=>{for(let i=0;i<count;i++){t+=100;await send({frame:{t,loop:6,v:12.6,m:[],s:[],c:[],d:[],touch:[],a:[volts],i:[{age:null,v:null},{age:null,v:null},{age:null,v:null},{age:null,v:null}],on:[0,1,-1],b:[{h:173,swept:true,found:[[],[],[0x32],[]],a:[volts,0,0,0]}]}});}
      await soon('the last frame drawn',async()=>(await page.textContent('[data-debug-stats]')).includes(`robot clock ${(t/1000).toFixed(1)} s`));};
    const plug=page.locator('#cal-debug [data-live="a:wrist:plug"]'),pill=name=>page.locator(`#cal-debug [data-live="ib:${name}"]`);
    // A moment at 0 V is not enough: a sensor can pass through it.
    await frames(0,10);assert.equal(await plug.isHidden(),true,'too soon to say');
    await frames(0,30);await soon('stuck at 0 V',()=>plug.isVisible());assert.equal(await plug.innerText(),'Reads 0 V: probably not plugged in');
    await frames(1.2,110);await soon('it reads something',()=>plug.isHidden());
    await frames(.001,110);await soon('an empty port on a real hub read up to 0.001 V',()=>plug.isVisible());
    // No configuration was read, so these are listed under the robot rather than on a bus, and still say what the hub heard.
    assert.equal(await pill('gone').innerText(),'Not answering: check its cable');assert.equal(await pill('there').innerText(),'Connected');assert.equal(await pill('asking').innerText(),'Checking…');assert.equal(await pill('nowhere').innerText(),'In the configuration');
    assert.deepEqual(errors,[]);console.log('Debug, what is plugged in: all passed');
  }finally{await app.close().catch(()=>{});fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,2400));process.exit(1);});
