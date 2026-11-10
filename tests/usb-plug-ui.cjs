'use strict';
// Setup in the real app when a Control Hub is plugged in, against a stubbed USB link: a hub still starting shows a calm note and is
// read by itself when it is ready, and it scans by itself, once for each time it is plugged in. Then with the USB watch pushing what
// src/usb-watch.cjs pushes: an unplug shows at once whatever is in flight, nothing late brings the hub back or overwrites the message,
// a plug shows before ADB answers, a replug closes the dialog, and a Driver Hub goes quietly. Then with what is on the hub's own USB ports coming with those pushes:
// a camera appears and goes on Setup, Configure and Calibrate with nothing pressed, a change during a scan scans again, nothing scans on Drive, a scan that fails says nothing.
// A scan nobody pressed for gets in nobody's way: what is pressed during one waits and happens, a draft goes only for a change the robot took, the project changes only if the hubs did,
// it starts nothing on the robot, and it stops after a few tries with one line to say so. ADB restarting is no drop, and a real drop with no helper still reaches the dialog.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/usb-plug-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright'),{UsbWatch}=require('../src/usb-watch.cjs'),{parseUsb}=require('../src/hub-usb.cjs');
const root=path.resolve(__dirname,'..'),wait=ms=>new Promise(r=>setTimeout(r,ms));
const XML=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><Robot type="FirstInspires-FTC"><LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173"><LynxModule name="Control Hub" port="173"><goBILDA5202SeriesMotor name="leftFront" port="0" /></LynxModule></LynxUsbDevice></Robot>`;
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-usb-')),env={...process.env,DECK_HEADLESS:'1',DECK_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);
    await app.evaluate(({ipcMain},xml)=>{const g=global;g.__u={plugged:true,reads:0,starting:2,scans:0,watch:[],notYet:0,detects:0};ipcMain.removeHandler('robot-link');ipcMain.handle('robot-link',async(e,action,d)=>{const r=g.__u,ok=value=>({ok:true,value});
      if(action==='usb-watch'){if(d?.on!==undefined)r.watch.push(d.on);if(d?.on&&r.watchState)return ok(r.watchState);return {ok:false,error:'not in this test'};}
      if(action==='hub-usb'){r.hubAsks=(r.hubAsks||0)+1;return r.hubList?ok(r.hubList):{ok:false,error:'not in this test'};}if(action==='limelight'){r.limeAsks=(r.limeAsks||0)+1;return ok(r.lime||{status:null});}
      if(action==='read-all')return ok({configurations:['lunala'],active:{name:'lunala'},files:{lunala:xml}});
      if(action==='detect'){r.detects++;}if(action==='detect')return ok(r.plugged?{usb:{found:true,serial:'hub1'},wifi:{robot:false}}:{usb:{found:false,message:'Not plugged in.'},wifi:r.wifi||{robot:false}});if(action==='usb-status')return ok({found:r.plugged,serial:'hub1'});if(action==='usb-recover'){r.recovers=(r.recovers||0)+1;return ok(null);}
      if(action==='read-usb'){r.reads++;if(r.holdRead){const fail=await new Promise(done=>{r.letRead=done;});if(fail)return {ok:false,error:fail};}if(r.notYet>0){r.notYet--;return {ok:false,error:'No Control Hub on USB. Plug its USB-C port into this computer with a data cable (some cables only charge).'};}if(r.starting>0){r.starting--;return {ok:false,error:'The Control Hub is still starting up. This takes about a minute after the battery goes on.',code:'HUB_STARTING'};}const names=r.names||['lunala'];return ok({serial:'hub1',active:{name:r.activeName||names[0]},configurations:names,files:Object.fromEntries(names.map(n=>[n,xml]))});}
      if(action==='activate'){r.activates=(r.activates||0)+1;if(r.failActivate)return {ok:false,error:r.failActivate};r.activeName=d.name;return ok(true);}if(action==='delete-config'){r.deletes=(r.deletes||0)+1;r.names=r.names.filter(n=>n!==d.name);return ok(true);}
      if(action==='configure'){r.saves=(r.saves||0)+1;if(r.holdSave){const fail=await new Promise(done=>{r.letSave=done;});if(fail)return {ok:false,error:fail};}return ok({name:d.name,devices:1});}if(action==='hub-rc-up'){r.rcAsks=(r.rcAsks||0)+1;return ok(!!r.rcUp);}
      if(action==='check'){(r.checkAsks??=[]).push(!!d?.noStart);return ok([{name:'Robot Controller app',ok:true,detail:'FTC SDK 12.0'}]);}if(action==='scan'){r.scans++;(r.scanAsks??=[]).push(!!d?.noStart);r.scanning=(r.scanning||0)+1;r.mostScanning=Math.max(r.mostScanning||0,r.scanning);if(r.progress)e.sender.send('robot-link-scan',{portals:[{serial:'(embedded)',modules:[{address:173,parent:true}],servoHubs:[]}],others:[]});try{if(r.holdScan){const fail=await new Promise(done=>{r.letScan=done;});if(fail)return {ok:false,error:fail};}if(r.failScans>0){r.failScans--;return {ok:false,error:r.scanError||'the robot did not answer the scan'};}return ok({portals:[{serial:'(embedded)',modules:[{address:173,parent:true}],servoHubs:[]},...(r.portals||[])],others:r.others||[]});}finally{r.scanning--;}}
      // Torque Debug is on the robot, so Calibrate's step opens once the hub is read.
      if(action==='debug-current')return ok({current:true,opMode:'TorqueDebug-x'});
      return {ok:false,error:'not in this test: '+action};});
      // How many times the simulation is loaded, with what really does it left in place.
      const sim=ipcMain._invokeHandlers?.get('sim');if(sim){g.__u.simLoads=0;ipcMain.removeHandler('sim');ipcMain.handle('sim',(e,method,...rest)=>{if(method==='load')g.__u.simLoads++;return sim(e,method,...rest);});}},XML);
    const u=()=>app.evaluate(()=>{const {letRead,letScan,letSave,...r}=global.__u;return r;});
    // Away from the tabs that use the hub nothing watches it, and looking now and then must not become a loop: each look draws panels that can ask for another.
    await page.evaluate(()=>window.deck.page('simulation'));await page.waitForFunction(()=>state.page==='simulation');await page.waitForTimeout(5000);{const r=await u();assert.ok(r.detects<=3,`it looks only now and then on Simulate: ${r.detects} in 5 s`);assert.deepEqual(r.watch,[],'the watch rests off these tabs');}
    await page.click('#robot-setup-tab');
    // Still starting: no red, no "could not read".
    await page.waitForFunction(()=>/still starting/.test(document.querySelector('#setup-view').textContent),null,{timeout:15000});assert.ok(!/Could not read/.test(await page.locator('#setup-view').textContent()),'not an error');
    // Ready: read and scanned with nothing pressed.
    await page.waitForFunction(()=>document.querySelectorAll('#rs-configs .rs-config').length===1,null,{timeout:30000});await page.waitForTimeout(4000);
    {const r=await u();assert.ok(r.reads>=3,`it kept reading: ${r.reads}`);assert.equal(r.scans,1,'it scanned by itself, once');}
    await page.waitForTimeout(4000);assert.equal((await u()).scans,1,'and not again');
    assert.deepEqual((await u()).watch,[true],'the watch was asked for once, on the tab that uses it');
    // Unplugged and plugged in again, with the watch down: found by asking, read and scanned again.
    await app.evaluate(()=>{global.__u.plugged=false;});await page.waitForTimeout(7000);assert.ok(await page.evaluate(()=>document.querySelector('#hub-dropped').open),'asking still finds it gone');await page.evaluate(()=>document.querySelector('#hub-dropped[open]')?.close());await app.evaluate(()=>{global.__u.plugged=true;});await page.waitForTimeout(8000);assert.equal((await u()).scans,2,'plugged in again, it scans again');

    // ---- The watch up. Timers run at 1 Hz in this hidden window but events do not, so the waits look from outside.
    let seq=100;
    const status=hub=>Object.assign(new UsbWatch({supported:false}),{usbLive:true,adbLive:true,hub}).status();
    const said=(hub,extra={})=>({seq:++seq,at:Date.now(),usb:true,devices:[],hub,adb:{running:true,devices:[]},status:status(hub),why:hub?'+':'-',drop:null,...extra});
    const push=state=>app.evaluate(({BrowserWindow},s)=>{BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('ui/index.html')).webContents.send('usb-watch',s);},state);
    const hub=(state,serial='hub1')=>({serial,state,model:null,vid:'2207',pid:'0011',usb:true});
    const soon=async(what,test,ms=1500)=>{const end=Date.now()+ms;for(;;){if(await test())return;if(Date.now()>end)throw Error(`Not within ${ms} ms: ${what}. Says: ${await plug()}; dialog ${await dropped()}.`);await wait(25);}};
    const plug=()=>page.textContent('#rs-plug span'),dropped=()=>page.evaluate(()=>document.querySelector('#hub-dropped').open),says=async re=>re.test(await plug());
    const setupText=()=>page.locator('#setup-view').textContent(),usbLink=()=>page.textContent('#sim-link-usb');
    const release=(which,fail)=>app.evaluate((_,[w,f])=>{global.__u[w](f);},[which,fail??null]);

    // The hub is there, and the watch agrees: nothing moves.
    let reads=(await u()).reads;await push(said(hub('device')));await wait(600);assert.match(await plug(),/Control Hub hub1 connected over USB-C/);assert.equal((await u()).reads,reads,'read once already');assert.match(await usbLink(),/Control Hub hub1/);

    // Pulled: at once, and how long from main to the page having drawn it.
    await page.evaluate(()=>{window.__drawn=0;new MutationObserver(()=>{window.__drawn||=Date.now();}).observe(document.querySelector('#hub-dropped'),{attributes:true,attributeFilter:['open']});});
    const recovers=(await u()).recovers;await app.evaluate(()=>{global.__u.plugged=false;});const told=said(null,{drop:'unplugged'});await push(told);
    await soon('the dialog',dropped);assert.equal((await u()).recovers,recovers,'Windows said so: nothing to try first, no second look');await soon('the plug line',()=>says(/Plug the Control Hub in by USB-C/));assert.match(await usbLink(),/Not plugged in/);assert.equal(await page.locator('#rs-configs .rs-config').count(),0,'what it read goes with it');
    const drawn=await page.evaluate(()=>window.__drawn)-told.at;assert.ok(drawn<300,`from main to the page in ${drawn} ms`);console.log(`main to page: ${drawn} ms`);

    // Plugged in: says so before ADB has said anything, and closes the dialog by itself. Nothing is read yet.
    reads=(await u()).reads;await app.evaluate(()=>{global.__u.plugged=true;global.__u.holdRead=true;});await push(said(hub(null)));
    await soon('plugged in',()=>says(/^Control Hub plugged in\./));assert.equal(await dropped(),false,'a replug closes the dialog');await wait(400);assert.equal((await u()).reads,reads,'ADB has not answered');assert.match(await plug(),/^Control Hub plugged in\. Waiting for it to answer…/);
    // ADB says it can talk: read, and pulled in the middle of the read.
    await push(said(hub('device')));await soon('reading',async()=>(await u()).reads===reads+1);await soon('the reading line',()=>says(/Reading what is connected/));
    await push(said(null,{drop:'unplugged'}));await soon('the dialog during a read',dropped);await soon('the plug line during a read',()=>says(/Plug the Control Hub in/));
    // The read's answer comes late, and does not bring the hub back.
    await release('letRead');await wait(1000);assert.ok(await dropped(),'still dropped');assert.match(await plug(),/Plug the Control Hub in/);assert.equal(await page.locator('#rs-configs .rs-config').count(),0,'the late answer is dropped');
    // A late error from a read is dropped too.
    reads=(await u()).reads;await push(said(hub('device')));await soon('a second read',async()=>(await u()).reads===reads+1);await push(said(null,{drop:'unplugged'}));await soon('the dialog',dropped);await release('letRead','adb.exe: device offline');await wait(800);assert.match(await plug(),/Plug the Control Hub in/);assert.ok(!/Could not read/.test(await setupText()),'no late error');

    // Pulled in the middle of a scan, whose error comes late.
    await app.evaluate(()=>{global.__u.holdRead=false;global.__u.holdScan=true;});let scans=(await u()).scans;await push(said(hub('device')));await soon('a scan',async()=>(await u()).scans===scans+1,8000);await soon('the scan line',()=>says(/Scanning for hubs and devices/));assert.equal(await dropped(),false);
    await push(said(null,{drop:'unplugged'}));await soon('the dialog during a scan',dropped);await soon('the plug line during a scan',()=>says(/Plug the Control Hub in/));
    await release('letScan','error: device not found');await wait(1000);assert.match(await plug(),/Plug the Control Hub in/);assert.ok(await dropped());assert.ok(!/did not finish|device not found/.test(await setupText()),'the late error goes nowhere');
    await app.evaluate(()=>{global.__u.holdScan=false;});

    // Has not allowed this computer: a plain step, not a failure. Then ADB still bringing it up.
    reads=(await u()).reads;await push(said(hub('unauthorized')));await soon('allow',()=>says(/^Control Hub plugged in\. Allow this computer in the REV Hardware Client\./));assert.equal(await dropped(),false);assert.equal((await u()).reads,reads);assert.match(await usbLink(),/Allow this computer/);
    assert.ok(await page.evaluate(()=>document.querySelector('#rs-plug i').classList.contains('live')),'the dot stays on');
    await push(said(hub('offline')));await soon('waiting',()=>says(/^Control Hub plugged in\. Waiting for it to answer…/));assert.equal((await u()).reads,reads);
    // Stuck offline with the hub on the cable: ADB is nudged once, not every look.
    {const a=(await u()).recovers;await soon('one nudge',async()=>(await u()).recovers===a+1,12000);await wait(4000);assert.equal((await u()).recovers,a+1,'once');assert.equal(await dropped(),false);}
    // Allowed and Android still starting: the calm note. Then ADB says it is not there yet: only a wait. Then it reads, by itself.
    await app.evaluate(()=>{global.__u.starting=1;global.__u.notYet=1;});await push(said(hub('device')));await soon('a calm wait',()=>says(/^Control Hub plugged in\. Waiting for it to answer…/),3000);assert.ok(!/Could not read/.test(await setupText()),'no error on the way up');
    await soon('still starting',()=>says(/still starting/),8000);assert.ok(!/Could not read/.test(await setupText()),'no error on the way up');
    await soon('read by itself',async()=>await page.locator('#rs-configs .rs-config').count()===1,20000);await soon('connected',()=>says(/Control Hub hub1 connected over USB-C|Scanning/),8000);assert.match(await usbLink(),/Control Hub hub1/);await soon('the scan is done',()=>says(/Control Hub hub1 connected over USB-C/),8000);

    // Another device coming and going with the hub still there changes nothing.
    reads=(await u()).reads;await push(said(hub('device'),{devices:[{vid:'174f',pid:'2454',serial:'x'}]}));await wait(300);assert.equal(await dropped(),false);assert.equal((await u()).reads,reads);assert.match(await plug(),/connected over USB-C/);

    // A Driver Hub looks like a hub until ADB says otherwise, and then just goes: no dialog, no chime.
    await push(said(null,{drop:'unplugged'}));await soon('the dialog',dropped);await page.click('#hub-dropped-ok');assert.equal(await dropped(),false);await app.evaluate(()=>{global.__u.plugged=false;});
    await push(said(hub('unauthorized','4315q2u9r9')));await soon('plugged in',()=>says(/^Control Hub plugged in/));await push(said(null,{drop:'driver-hub',devices:[{vid:'2207',pid:'0011',serial:'4315Q2U9R9'}]}));await soon('the plug line',()=>says(/Plug the Control Hub in/));await wait(300);assert.equal(await dropped(),false,'a Driver Hub is no dropped hub');assert.ok(!/4315/.test(await setupText()));

    // A hub in update mode says so, is not read, and leaving it (a restart) is no drop.
    reads=(await u()).reads;await push(said(hub('update')));await soon('update mode',()=>says(/^Control Hub plugged in\. It is in update mode/));await wait(300);assert.equal((await u()).reads,reads,'nothing to read yet');await push(said(null,{drop:'restarting'}));await soon('the plug line',()=>says(/Plug the Control Hub in/));await wait(300);assert.equal(await dropped(),false,'a restart is no dropped hub');

    // The Axon Programmer tab: the watch rests, and no dialog.
    await push(said(hub('device')));await soon('read',async()=>await page.locator('#rs-configs .rs-config').count()===1,8000);await page.locator('#setup-view [data-flow="axon"]').click();await soon('the watch rests',async()=>(await u()).watch.at(-1)===false);
    await push(said(null,{drop:'unplugged'}));await wait(300);assert.equal(await dropped(),false,'not on the Axon tab');
    await page.locator('#setup-view [data-flow="setup"]').click();await soon('the watch runs again',async()=>(await u()).watch.at(-1)===true);await wait(300);assert.equal(await dropped(),false,'it left while nobody was looking: no dialog, only the plain state');await soon('the plug line',()=>says(/Plug the Control Hub in/),5000);

    // ---- What is on the hub's own USB ports, read by main and carried on the same pushes (src/hub-usb.cjs).
    const INSIDE=`3-1|05e3|0608|09|8538|480|3|2||USB2.0 Hub||100mA|e0|4|09/00/00/hub,\n3-1.1|0bda|c820|ef|0200|480|3|3|Realtek|802.11ac NIC|123456|500mA|a0|0|e0/01/01/rtk_btusb,e0/01/01/rtk_btusb,ff/ff/ff/rtl8821cu/p2p0/wlan0,\nusb1|1d6b|0002|09|0310|480|1|1|Linux 3.10.245 xhci-hcd|xHCI Host Controller|xhci-hcd.0.auto|0mA|e0|1|`;
    const cam=(dev=4,serial='Ucamera001')=>`1-1|a108|2240|ef|0090|480|1|${dev}|HHYL|UVC Camera|${serial}|200mA|c0|0|0e/01/00/uvcvideo,0e/02/00/uvcvideo,03/00/00/usbhid,01/01/00/snd-usb-audio,01/02/00/snd-usb-audio,`,CAM_SCAN={serial:'Ucamera001',type:'WEBCAM'};
    let stamp=1000;const ports=(lines=[],addresses=[])=>({serial:'hub1',devices:parseUsb([INSIDE,...lines].join('\n')),addresses,at:++stamp});
    const listed=(lines,addresses)=>push(said(hub('device'),{why:'hub-usb',hubUsb:ports(lines,addresses)}));
    const scansNow=async()=>(await u()).scans,rsHubs=()=>page.textContent('#rs-hubs'),setOthers=list=>app.evaluate((_,l)=>{global.__u.others=l;},list),cameraList=()=>page.$eval('#cal-camera',b=>`${b.querySelector('[data-cam-name]').textContent} ${b.querySelector('[data-cam-pick]').textContent}`);
    const scanOnce=async(what,from,ms=6000)=>{await soon(what,async()=>await scansNow()===from+1,ms);await wait(1500);assert.equal(await scansNow(),from+1,`${what}: once`);};
    const closeDropped=()=>page.evaluate(()=>document.querySelector('#hub-dropped[open]')?.close());

    // Plugged in, on Setup: read, and the one scan that comes with plugging in. Its list starting the same moment is no reason for a second.
    await app.evaluate(()=>{global.__u.plugged=true;global.__u.others=[];});scans=await scansNow();await push(said(hub('device'),{hubUsb:ports()}));await soon('read',async()=>await page.locator('#rs-configs .rs-config').count()===1,8000);await scanOnce('the first scan',scans,8000);await soon('connected',()=>says(/Control Hub hub1 connected over USB-C/),5000);
    // Its own parts never show.
    {const t=await rsHubs();assert.doesNotMatch(t,/802\.11ac|USB2\.0 Hub|xHCI|Realtek/,'the hub’s own parts stay hidden');assert.doesNotMatch(t,/press Scan/i,'nobody has to press anything');}
    const others=()=>page.$$eval('#rs-hubs [data-usb-row]',l=>String(l.length));assert.equal(await others(),'0');
    // Setup: a camera in, by its student name, with nothing pressed; then the robot's scan follows by itself. And out again.
    scans=await scansNow();await setOthers([CAM_SCAN]);await listed([cam()]);await soon('the camera on Setup',async()=>/Webcam \(needs its lens measured\)/.test(await rsHubs()));assert.match(await rsHubs(),/Blue USB 3\.0 port · Ucamera001/);assert.doesNotMatch(await rsHubs(),/802\.11ac|USB2\.0 Hub|xHCI/);assert.equal(await others(),'1');await scanOnce('a scan on Setup',scans);
    scans=await scansNow();await setOthers([]);await listed([]);await soon('gone from Setup',async()=>!/needs its lens|Ucamera001/.test(await rsHubs()));assert.equal(await others(),'0');await scanOnce('a scan when it left',scans);
    // Configure.
    await page.click('#setup-view .flow-steps [data-flow=configure]');await page.waitForSelector('.ce-grid');
    scans=await scansNow();await setOthers([CAM_SCAN]);await listed([cam(5)]);await soon('the camera on Configure',async()=>/Webcam · Ucamera001[\s\S]*plugged in, not in this configuration/.test(await page.textContent('.ce-hubs')));await scanOnce('a scan on Configure',scans);
    scans=await scansNow();await setOthers([]);await listed([]);await soon('gone from Configure',async()=>!/Ucamera001/.test(await page.textContent('.ce-hubs')));await scanOnce('a scan when it left Configure',scans);
    await page.click('#setup-view .flow-steps [data-flow=setup]');
    // Calibrate, with the hub already read on Setup. No camera is plugged in yet, so Camera opens from Debug's link, and keeps its tab while the camera comes and goes.
    await page.evaluate(()=>window.deck.page('calibrate'));await page.waitForFunction(()=>state.page==='calibrate');assert.equal(await page.locator('#cal-tab-camera').isVisible(),false,'no camera, no tab');await page.click('#cal-sim-cam [data-sim-cam]');
    scans=await scansNow();await setOthers([CAM_SCAN]);await listed([cam(6)]);await soon('the camera on Calibrate',async()=>/Ucamera001/.test(await cameraList()));await scanOnce('a scan on Calibrate',scans);
    await page.click('#calibrate-view [data-flow=debug]');await soon('USB devices in Electronics',async()=>await page.locator('[data-usb-elsewhere="Ucamera001"]').count()===1);
    // Something a scan cannot see is shown at once, and is no reason to scan.
    scans=await scansNow();await listed([cam(6),'3-1.4|2341|0043|02|0100|12|3|7|Arduino|Uno||100mA|80|0|02/02/01/cdc_acm,']);await soon('an Arduino',async()=>/Arduino/.test(await page.textContent('#cal-usb')));await wait(2500);assert.equal(await scansNow(),scans,'an Arduino is no reason to scan');
    await page.click('#calibrate-view [data-flow=debug]');await page.evaluate(()=>document.querySelector('#cal-tab-camera').click());scans=await scansNow();await setOthers([]);await listed([]);await soon('gone from Calibrate',async()=>!/Ucamera001/.test(await cameraList()));await scanOnce('a scan when it left Calibrate',scans);
    // Calibrate with the hub plugged in there: it reads the configuration once (Electronics lists its devices, and Calibrate opens once there is one); the camera still reaches Camera's list, and the scan still runs.
    await push(said(null,{drop:'unplugged'}));await soon('the dialog',dropped);await closeDropped();await soon('nothing connected',async()=>!/Ucamera001/.test(await cameraList()));
    let reads0=(await u()).reads;scans=await scansNow();await setOthers([CAM_SCAN]);await push(said(hub('device'),{hubUsb:ports([cam(8)])}));await soon('the camera, plugged in on Calibrate',async()=>/Ucamera001/.test(await cameraList()));await scanOnce('a scan with nothing read',scans);assert.equal((await u()).reads,reads0+1,'Calibrate reads the configuration once, for its devices: no more');
    scans=await scansNow();await setOthers([]);await listed([]);await soon('gone, with nothing read',async()=>!/Ucamera001/.test(await cameraList()));await scanOnce('a scan when it left, with nothing read',scans);

    // A change during a scan: one scan at a time, and another after it. The list is right before either answers.
    await app.evaluate(()=>{global.__u.holdScan=true;global.__u.mostScanning=0;});scans=await scansNow();await listed([cam(9)]);await soon('a scan held',async()=>await scansNow()===scans+1,6000);await listed([cam(9),cam(10,'SECOND').replace('1-1|','3-1.4|')]);await soon('both cameras already',async()=>/SECOND/.test(await cameraList()));await wait(2500);assert.equal(await scansNow(),scans+1,'not two at once');
    await app.evaluate(()=>{global.__u.holdScan=false;});await setOthers([CAM_SCAN,{serial:'SECOND',type:'WEBCAM'}]);await release('letScan');await scanOnce('a scan after the change',scans+1,6000);assert.equal((await u()).mostScanning,1,'never two at once');
    // Unplugged in the middle of a scan: nothing comes back from it.
    await app.evaluate(()=>{global.__u.holdScan=true;});scans=await scansNow();await listed([cam(9)]);await soon('another held',async()=>await scansNow()===scans+1,6000);await push(said(null,{drop:'unplugged'}));await soon('the dialog',dropped);await closeDropped();await app.evaluate(()=>{global.__u.holdScan=false;});await release('letScan');await wait(1500);assert.equal(await scansNow(),scans+1,'no hub, no scan');assert.doesNotMatch(await cameraList(),/Ucamera001|SECOND/);

    // Setup again, for what fails and what is not there. A scan that fails says nothing and tries again by itself.
    // Arriving, the hub is found by asking, with its ports not read yet, so it is read and scanned once. The list then comes, and what is new since that scan began is one more.
    scans=await scansNow();await setOthers([]);await page.evaluate(()=>window.deck.page('setup'));await page.waitForFunction(()=>state.page==='setup');await soon('read again',async()=>await page.locator('#rs-configs .rs-config').count()===1,8000);await soon('settled',async()=>{const a=await scansNow();await wait(1800);return a===await scansNow();},12000);assert.equal(await scansNow(),scans+1,'arriving scans once');
    scans=await scansNow();await push(said(hub('device'),{hubUsb:ports()}));await scanOnce('a scan for the list',scans,8000);await soon('connected',()=>says(/Control Hub hub1 connected over USB-C/),5000);
    await app.evaluate(()=>{global.__u.failScans=2;});scans=await scansNow();await setOthers([CAM_SCAN]);await listed([cam(11)]);await soon('a scan that fails',async()=>await scansNow()===scans+1,6000);await wait(200);assert.match(await plug(),/Control Hub hub1 connected over USB-C/);assert.doesNotMatch(await setupText(),/did not finish|did not answer|Waiting for the Robot Controller/);
    await soon('it tries again, and again',async()=>await scansNow()===scans+3,16000);await wait(800);assert.doesNotMatch(await setupText(),/did not finish|did not answer/);assert.match(await plug(),/Control Hub hub1 connected over USB-C/);assert.match(await rsHubs(),/Webcam \(needs its lens measured\)/,'the list never depended on it');await wait(3500);assert.equal(await scansNow(),scans+3,'and stops once it answers');

    // An FT-X chip: while a scan is out nothing can say yet, and an older scan does not get to. Then its answer decides.
    const ftx=(dev,serial)=>`3-1.4|0403|6015|00|1000|12|3|${dev}|FTDI|FT230X|${serial}|90mA|80|0|ff/00/00/,`;
    await app.evaluate(()=>{global.__u.holdScan=true;global.__u.portals=[{serial:'DQ123',modules:[{address:2,parent:true}],servoHubs:[]}];});scans=await scansNow();await listed([cam(11),ftx(12,'DQ123')]);await soon('a plug on a chip',async()=>/Expansion Hub or serial cable/.test(await rsHubs()));await soon('held',async()=>await scansNow()===scans+1,6000);assert.match(await rsHubs(),/USB 2\.0 port · DQ123/);
    await app.evaluate(()=>{global.__u.holdScan=false;});await release('letScan');await soon('an Expansion Hub',async()=>/Expansion Hub on USB/.test(await rsHubs()),3000);
    await app.evaluate(()=>{global.__u.portals=[];});scans=await scansNow();await listed([cam(11),ftx(13,'XX')]);await soon('a new one, not yet known',async()=>/Expansion Hub or serial cable/.test(await rsHubs()));await soon('a cable',async()=>/FTDI serial cable/.test(await rsHubs()),6000);assert.doesNotMatch(await rsHubs(),/Expansion Hub on USB/);await listed([cam(11)]);await soon('the cable left',async()=>!/FTDI/.test(await rsHubs()));
    await soon('settled',async()=>{const a=await scansNow();await wait(1800);return a===await scansNow();},12000);

    // A USB network device asks whether it is a Limelight, by itself. While it is asking, it is neither.
    const net=(dev,iface='eth0')=>`3-1.2|1d6b|0104|00|0100|480|3|${dev}|Some|Gadget||100mA|80|0|02/06/00/cdc_ether/${iface},0a/00/00/cdc_ether,`,LIME={iface:'eth0',hubAddress:'172.29.0.23',address:'172.29.0.1',scanKey:'EthernetOverUsb:eth0:172.29.0.23',status:{name:'limelight'}};
    await app.evaluate((_,l)=>{global.__u.lime=l;global.__u.limeAsks=0;},LIME);scans=await scansNow();await listed([cam(11),net(14)]);await soon('a Limelight',async()=>/Limelight smart camera/.test(await rsHubs()),3000);assert.equal((await u()).limeAsks,1,'asked once');await scanOnce('a scan for it',scans);
    await app.evaluate(()=>{global.__u.lime={status:null};global.__u.limeAsks=0;});await listed([cam(11),net(15)]);await soon('asking',async()=>/Network device/.test(await rsHubs()));assert.doesNotMatch(await rsHubs(),/Limelight smart camera/,'that was another device');await soon('asks more than once',async()=>(await u()).limeAsks>=2,6000);assert.match(await rsHubs(),/Network device/,'still asking: it gets no verdict yet');
    await soon('not a Limelight',async()=>/USB network adapter or a small computer/.test(await rsHubs()),40000);assert.equal((await u()).limeAsks,5,'half a minute, then it stops');
    // The hub gets an address from it: that is new, so it asks again, and it can answer now.
    await app.evaluate((_,l)=>{global.__u.lime=l;},LIME);scans=await scansNow();await listed([cam(11),net(15)],[{iface:'eth0',address:'172.29.0.23',prefix:24}]);await soon('a Limelight after all',async()=>/Limelight smart camera/.test(await rsHubs()),3000);await scanOnce('a scan for its address',scans);
    await listed([cam(11)]);await soon('it left',async()=>!/Limelight/.test(await rsHubs()));await soon('settled',async()=>{const a=await scansNow();await wait(1800);return a===await scansNow();},12000);

    // Nothing scans on Drive: not one already waiting when the tab changes, and not one for a change while it shows. Coming back catches up.
    scans=await scansNow();await listed([cam(11),cam(16,'THIRD').replace('1-1|','3-1.2|')]);await page.evaluate(()=>window.deck.page('drive'));await page.waitForFunction(()=>state.page==='drive');await soon('the watch rests',async()=>(await u()).watch.at(-1)===false);await wait(2500);assert.equal(await scansNow(),scans,'nothing scans on Drive');
    await listed([cam(11),cam(17,'FOURTH').replace('1-1|','3-1.2|')]);await wait(2500);assert.equal(await scansNow(),scans,'a change while on Drive scans nothing');
    await app.evaluate((_,s)=>{global.__u.watchState=s;},said(hub('device'),{hubUsb:ports([cam(11),cam(17,'FOURTH').replace('1-1|','3-1.2|')])}));await page.evaluate(()=>window.deck.page('setup'));await page.waitForFunction(()=>state.page==='setup');await soon('the watch runs',async()=>(await u()).watch.at(-1)===true);await scanOnce('coming back catches up',scans);await app.evaluate(()=>{global.__u.watchState=null;});assert.equal((await u()).mostScanning,1,'never two at once, all along');

    // A page that has to ask: with no list pushed, it asks by itself, and only while it has none.
    await push(said(null,{drop:'unplugged'}));await soon('the dialog',dropped);await closeDropped();await app.evaluate((_,l)=>{global.__u.hubList=l;global.__u.hubAsks=0;},ports([cam(18)]));await push(said(hub('device')));await soon('asked',async()=>/Webcam \(needs its lens measured\)/.test(await rsHubs()),8000);assert.equal((await u()).hubAsks,1);await wait(3500);assert.equal((await u()).hubAsks,1,'once it has a list it stops asking');await app.evaluate(()=>{global.__u.hubList=null;});
    await soon('settled',async()=>{const a=await scansNow();await wait(1800);return a===await scansNow();},12000);

    // ---- A scan nobody pressed for: it gets in nobody's way, and changes nothing unless the hubs really changed.
    const rows=()=>page.locator('#rs-configs .rs-config').count(),setupStep=()=>page.click('#setup-view .flow-steps [data-flow=setup]'),configureStep=async()=>{await page.click('#setup-view .flow-steps [data-flow=configure]');await page.waitForSelector('.ce-grid');};
    const heldScan=async dev=>{const from=await scansNow();await app.evaluate(()=>{global.__u.holdScan=true;});await listed([cam(dev)]);await soon('a scan held',async()=>await scansNow()===from+1,6000);return from;},letScanGo=async fail=>{await app.evaluate(()=>{global.__u.holdScan=false;});await release('letScan',fail);};
    const matched=()=>page.textContent('#rs-matched'),mark=()=>page.evaluate(()=>{document.querySelector('#rs-matched').textContent='untouched';}),simLoads=async()=>(await u()).simLoads,setPortals=list=>app.evaluate((_,l)=>{global.__u.portals=l;},list),SECOND_HUB=[{serial:'DQ9',modules:[{address:2,parent:true}],servoHubs:[]}];
    const draft=async name=>{if(!await page.locator('[data-ce-back]').count())await page.locator('.ce-main button',{hasText:/Motors/}).first().click();await page.locator('.ce-main input[id^=ce-name-]').first().fill(name);await page.locator('.ce-main input[id^=ce-name-]').first().press('Tab');await page.waitForSelector('[data-ce-save]:not([disabled])');},saveOff=async()=>await page.locator('[data-ce-save]').getAttribute('data-draft')==='0';
    const toggles=async()=>[await page.locator('#rs-read').isDisabled(),await page.locator('#rs-scan').isDisabled(),await page.locator('#rs-new').isDisabled()];
    await push(said(null,{drop:'unplugged'}));await soon('the dialog',dropped);await closeDropped();await setOthers([]);await setPortals([]);await app.evaluate(()=>{const r=global.__u;r.plugged=true;r.names=['lunala','other'];r.activeName='lunala';r.activates=0;r.deletes=0;r.saves=0;});
    scans=await scansNow();await push(said(hub('device'),{hubUsb:ports()}));await soon('read',async()=>await rows()===2,8000);await scanOnce('the first scan',scans,8000);await soon('connected',()=>says(/Control Hub hub1 connected over USB-C/),5000);
    assert.equal((await u()).checkAsks.at(-1),true,'plugging in checks the link, and starts nothing');assert.equal((await u()).scanAsks.at(-1),true,'and so does the scan that comes with it');

    // The same hubs: the project is not written, and nothing reloads. Its camera still shows.
    await mark();let loads=await simLoads();scans=await scansNow();await setOthers([CAM_SCAN]);await listed([cam(30)]);await scanOnce('a scan for a camera',scans);assert.equal(await matched(),'untouched','the same hubs: the project is not written again');assert.equal(await simLoads(),loads,'and nothing reloads');assert.equal((await u()).scanAsks.at(-1),true,'it starts nothing on the robot');assert.match(await rsHubs(),/Webcam \(needs its lens measured\)/);
    // The hubs really changed: taken, with nothing reloaded.
    await mark();scans=await scansNow();await setPortals(SECOND_HUB);await listed([cam(31)]);await scanOnce('a scan with a new hub',scans);await soon('the new hub taken',async()=>await matched()!=='untouched');assert.equal(await simLoads(),loads,'still nothing reloads');
    await setPortals([]);scans=await scansNow();await listed([cam(32)]);await scanOnce('a scan with the hub gone',scans);
    // Left for Drive with a scan out: its answer goes nowhere, and coming back catches up.
    await mark();await setPortals(SECOND_HUB);scans=await heldScan(33);loads=await simLoads();await page.evaluate(()=>window.deck.page('drive'));await page.waitForFunction(()=>state.page==='drive');await letScanGo();await wait(1500);assert.equal(await matched(),'untouched','nothing happens on Drive');assert.equal(await simLoads(),loads,'and nothing loads there');assert.equal(await dropped(),false);
    await page.evaluate(()=>window.deck.page('setup'));await page.waitForFunction(()=>state.page==='setup');await soon('asked again',async()=>await scansNow()===scans+2,6000);await soon('taken on coming back',async()=>await matched()!=='untouched',4000);await setPortals([]);scans=await scansNow();await listed([cam(34)]);await scanOnce('settled',scans);

    // A failed one says nothing and leaves the buttons as they were, even after showing what the robot's web server said.
    await app.evaluate(()=>{const r=global.__u;r.progress=true;r.failScans=1;r.scanError='Another Driver Station is connected to this robot. Disconnect it, then try again.';});scans=await scansNow();await listed([cam(35)]);await soon('a scan that fails',async()=>await scansNow()===scans+1,6000);await wait(300);assert.deepEqual(await toggles(),[false,false,false],'nothing stays greyed out');assert.equal(await page.locator('#rs-configs [data-cfg=delete]').first().isDisabled(),false);assert.match(await plug(),/connected over USB-C/);
    await soon('and tries again',async()=>await scansNow()===scans+2,8000);await app.evaluate(()=>{const r=global.__u;r.progress=false;r.scanError=null;});await wait(500);

    // A press during one: the buttons stay live, and what is pressed happens once it is done. Nothing is dropped, and a draft is lost only for a change the robot took.
    await configureStep();await draft('renamed');await heldScan(36);assert.equal(await saveOff(),false);await page.selectOption('[data-ce-config]','other');await page.waitForSelector('#rs-active-confirm[open]');assert.match(await page.textContent('#rs-active-text'),/are not saved and will be lost/);await page.click('#rs-active-yes');await wait(400);
    assert.equal((await u()).activates,0,'it waits its turn');assert.equal(await saveOff(),false,'and until it has happened the draft is still there');
    await letScanGo();await soon('activated',async()=>(await u()).activates===1,3000);await soon('the draft goes with it',saveOff,5000);await soon('Configure shows it',async()=>await page.locator('[data-ce-config]').inputValue()==='other',8000);assert.doesNotMatch(await setupText(),/has not reported/);
    // The robot refuses: the draft stays, and it says why, once.
    await app.evaluate(()=>{global.__u.failActivate='The robot did not take CMD_ACTIVATE_CONFIGURATION.';});await draft('renamed again');await heldScan(37);await page.selectOption('[data-ce-config]','lunala');await page.waitForSelector('#rs-active-confirm[open]');await page.click('#rs-active-yes');await wait(300);await letScanGo();await soon('asked the robot',async()=>(await u()).activates===2,3000);await wait(2500);assert.equal(await saveOff(),false,'the draft is still there');assert.match(await page.textContent('#rs-status'),/did not take CMD_ACTIVATE_CONFIGURATION/);assert.doesNotMatch(await setupText(),/has not reported/);assert.equal((await u()).activates,2,'tried once');await app.evaluate(()=>{global.__u.failActivate=null;});
    // Save waits too, and what it read afterwards is the new configuration.
    {await heldScan(38);reads=(await u()).reads;await page.click('[data-ce-save]');await wait(400);assert.equal((await u()).saves,0,'Save waits its turn');await letScanGo();await soon('saved',async()=>(await u()).saves===1,3000);await soon('read after saving',async()=>(await u()).reads===reads+1,3000);await soon('saved says so',async()=>/Saved to the robot/.test(await page.textContent('.ce-note')),3000);}
    // Check again and Scan.
    await setupStep();await heldScan(39);assert.deepEqual(await toggles(),[false,false,false],'it looks as it did');reads=(await u()).reads;await page.click('#rs-read');await wait(300);assert.equal((await u()).reads,reads,'waiting');assert.equal(await page.locator('#rs-read').isDisabled(),true,'and the button shows it was heard');await letScanGo();await soon('Check again ran',async()=>(await u()).reads>=reads+1,4000);await soon('and a press may start the app',async()=>(await u()).checkAsks.at(-1)===false,4000);await soon('free again',async()=>!(await toggles()).includes(true),4000);
    scans=await heldScan(40);await page.click('#rs-scan');await wait(300);assert.equal(await scansNow(),scans+1,'one at a time');await letScanGo();await soon('Scan ran',async()=>await scansNow()===scans+2,4000);assert.equal((await u()).scanAsks.at(-1),false,'a press may start the app');await soon('free again',async()=>!(await toggles()).includes(true),4000);
    // Delete.
    await heldScan(41);page.once('dialog',d=>void d.accept());await page.click('#rs-configs [data-cfg=delete][data-name=lunala]');await wait(300);assert.equal((await u()).deletes,0,'waiting');await letScanGo();await soon('deleted',async()=>(await u()).deletes===1,4000);await soon('gone from the list',async()=>await rows()===1,4000);await app.evaluate(()=>{global.__u.names=['lunala','other'];});
    await soon('free again',async()=>!(await toggles()).includes(true),4000);assert.equal((await u()).mostScanning,1,'never two at once');

    // Unplugged during Save: the plain sentence, not what the link said on its way down. The draft stays.
    await configureStep();await draft('renamed once more');await app.evaluate(()=>{global.__u.holdSave=true;global.__u.saves=0;});await page.click('[data-ce-save]');await soon('saving',async()=>(await u()).saves===1,3000);await push(said(null,{drop:'unplugged'}));await soon('the dialog',dropped);await release('letSave','The robot did not answer CMD_SAVE_CONFIGURATION.');await soon('the note',async()=>/The Control Hub was unplugged/.test(await page.textContent('.ce-note')));assert.doesNotMatch(await page.textContent('.ce-note'),/CMD_/);assert.equal(await saveOff(),false,'the draft is still there');await closeDropped();await app.evaluate(()=>{global.__u.holdSave=false;});await page.click('[data-ce-cancel]');await setupStep();

    // ADB's server restarting with no helper running: nothing known, then an empty first list. No dialog, nothing lost. A real drop that way still reaches the dialog.
    const adbOnly=(state,extra={})=>({seq:++seq,at:Date.now(),usb:false,devices:[],hub:state,adb:{running:true,devices:[]},status:null,why:'adb',drop:null,...extra});
    await push(adbOnly(hub('device')));await soon('read',async()=>await rows()===2,8000);await soon('connected',()=>says(/Control Hub hub1 connected over USB-C/),8000);await wait(1500);
    reads=(await u()).reads;await app.evaluate(()=>{global.__u.plugged=false;});await push(adbOnly(null,{adb:{running:false,devices:[]}}));await wait(200);await push(adbOnly(null));await wait(4000);assert.equal(await dropped(),false,'ADB only restarted');assert.equal(await rows(),2,'what it read stays');assert.match(await plug(),/connected over USB-C/);
    await app.evaluate(()=>{global.__u.plugged=true;});await push(adbOnly(hub('device')));await wait(1000);assert.equal(await dropped(),false);assert.equal((await u()).reads,reads,'it was never away');
    await app.evaluate(()=>{global.__u.plugged=false;});await push(adbOnly(null,{drop:'unplugged',why:'unseen'}));await soon('the dialog for a real drop',dropped);await closeDropped();await soon('the plug line',()=>says(/Plug the Control Hub in/),5000);

    // With a Robot Controller that does not answer it is never started, it stops asking, and it says so. A press, a new device or the app starting to listen each start it again.
    const stuckLine=()=>page.textContent('#rs-scan-stuck'),stuckOff=()=>page.locator('#rs-scan-stuck').evaluate(el=>el.hidden);
    await app.evaluate(()=>{global.__u.plugged=true;global.__u.scanAsks=[];});scans=await scansNow();await push(said(hub('device'),{hubUsb:ports()}));await soon('read',async()=>await rows()===2,8000);await scanOnce('the first scan',scans,8000);
    await app.evaluate(()=>{const r=global.__u;r.failScans=1000;r.scanError='The Robot Controller app on this Control Hub is not answering. Press Scan to start it, or restart the robot.';r.rcUp=false;r.rcAsks=0;});scans=await scansNow();await listed([cam(50)]);await soon('stops after five tries',async()=>await scansNow()===scans+5,75000);assert.equal(await stuckOff(),false);assert.match(await stuckLine(),/The Robot Controller app is not answering/);assert.doesNotMatch(await setupText(),/did not finish/);await wait(5000);assert.equal(await scansNow(),scans+5,'and stays stopped');assert.ok((await u()).scanAsks.every(Boolean),'none of them could start anything');assert.deepEqual(await toggles(),[false,false,false]);
    await soon('it watches for the app, starting nothing',async()=>(await u()).rcAsks>=1,20000);
    // A new device: it tries again, and the line goes. Still no answer, so it stops again.
    scans=await scansNow();await listed([cam(51)]);await soon('a new device starts it again',async()=>await scansNow()===scans+1,4000);await soon('the line goes',stuckOff,3000);await soon('stopped again',async()=>await scansNow()===scans+5,75000);await soon('says so',async()=>!await stuckOff(),3000);
    // A press tries, and may start the app: today's Scan, and what it says when it fails.
    scans=await scansNow();await page.click('#rs-scan');await soon('a press still scans',async()=>await scansNow()===scans+1,3000);assert.equal((await u()).scanAsks.at(-1),false,'and may start the app');await soon('it says so',()=>says(/^The scan did not finish\./),3000);
    // The app starts listening: asked again, with nothing pressed, and all is well.
    await app.evaluate(()=>{const r=global.__u;r.rcUp=true;r.failScans=0;});scans=await scansNow();await soon('the app began to listen',async()=>await scansNow()===scans+1,20000);await soon('the line goes',stuckOff,3000);await soon('and it says connected',()=>says(/Control Hub hub1 connected over USB-C/),3000);assert.equal((await u()).scanAsks.at(-1),true,'with nothing pressed, it starts nothing');
    await app.evaluate(()=>{const r=global.__u;r.scanError=null;r.names=null;r.activeName=null;});await soon('settled',async()=>{const a=await scansNow();await wait(1800);return a===await scansNow();},12000);

    // Over Wi-Fi there is no such list and none is made up: what Scan said, as it said it.
    await push(said(null,{drop:'unplugged'}));await soon('the dialog',dropped);await closeDropped();await setOthers([CAM_SCAN]);await app.evaluate(()=>{global.__u.plugged=false;global.__u.hubAsks=0;global.__u.wifi={robot:true,reachable:true,host:'192.168.43.1',ssid:'FTC-zWL4',name:''};});await soon('over Wi-Fi',()=>says(/connected over Wi-Fi/),12000);await soon('Scan’s list',async()=>/Ucamera001/.test(await rsHubs()),8000);{const t=await rsHubs();assert.doesNotMatch(t,/needs its lens measured|Blue USB/,'no classified names without a list');assert.match(t,/Webcam/);}assert.equal(await page.locator('#rs-scan').getAttribute('class'),'secondary','the button stays for this, out of the way');assert.equal((await u()).hubAsks,0,'nothing asks for a list Wi-Fi cannot have');
    scans=await scansNow();await page.click('#rs-scan');await soon('a scan pressed for',async()=>await scansNow()===scans+1,5000);

    assert.deepEqual(errors,[]);console.log('USB plug in: all passed');
  }finally{await app.close().catch(()=>{});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,1200));process.exit(1);});
