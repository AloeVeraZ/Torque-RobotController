'use strict';
// A camera on the Control Hub's USB in the real app, against a stubbed hub:
//  A. Calibrate's tabs run Camera, Debug, Calibrate, and open on Camera;
//  B. a scan's camera reaches Configure and Camera, a new scan redraws both with nothing lost, and neither writes to the robot until Save;
//  C. Add, rename and remove, and the XML Save sends;
//  D. the Robot Controller restarting after a scan does not hide the camera from Configure while Setup still shows it;
//  E. Camera's picture with nothing pressed: built once, started by itself, its settings beside it, released after the tab is left, and failures in one line;
//  F. several cameras: a row of names, one open at a time;
//  G. leaving while it asks about the robot's copy builds nothing, a copy that never matches is built once a visit, and a Robot Controller app that never starts says so and offers Try again;
//  H. the Debug panel draws nothing while hidden and shows the latest when it shows again, and the camera line ends on the last reading of a burst.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/usb-camera-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const Cam=require('../ui/sim-camera.js');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/usb-camera');fs.mkdirSync(out,{recursive:true});
const XML=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<Robot type="FirstInspires-FTC">\n    <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">\n        <LynxModule name="Control Hub" port="173">\n            <goBILDA5202SeriesMotor name="leftFront" port="0" />\n        </LynxModule>\n    </LynxUsbDevice>\n</Robot>\n`;
const CAM={serial:'Ucamera001',type:'WEBCAM'};
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-usb-camera-')),env={...process.env,DECK_HEADLESS:'1',DECK_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);await page.setViewportSize({width:1280,height:800});
    await app.evaluate(({ipcMain,BrowserWindow},{xml,cam})=>{const g=global;g.__u={xml,others:[cam],fail:0,scans:0,saves:[],starts:0,stops:0,installs:0,currents:0,installed:false,opMode:null,startedWith:[],installData:[],sent:[],build:null,reads:0,streaming:false,guessed:false,rcStarts:0,holdCurrent:0,mismatch:false};ipcMain.removeHandler('robot-link');ipcMain.handle('robot-link',async(e,action,data)=>{const r=g.__u,ok=value=>({ok:true,value});
      if(action==='detect')return ok({usb:{found:true,serial:'hub1'},wifi:{robot:false}});if(action==='usb-status')return ok({found:true,serial:'hub1'});if(action==='usb-recover')return ok(null);
      if(action==='read-usb'){r.reads++;if(r.fail>0){r.fail--;return {ok:false,error:'The Control Hub is still starting up. This takes about a minute after the battery goes on.',code:'HUB_STARTING'};}return ok({serial:'hub1',active:{name:'robot',...(r.guessed?{guessed:true}:{})},configurations:['robot'],files:{robot:r.xml}});}
      if(action==='check')return ok([{name:'Robot Controller app',ok:true,detail:'FTC SDK 12.0'}]);
      if(action==='scan'){r.scans++;return ok({portals:[{serial:'(embedded)',modules:[{address:173,parent:true}],servoHubs:[]}],others:r.others});}
      if(action==='configure'){r.saves.push(data);r.xml=data.xml;return ok(true);}
      if(action==='debug-current'){r.currents++;if(r.holdCurrent)await new Promise(done=>setTimeout(done,r.holdCurrent));if(r.guessed&&data?.noStart)return {ok:false,error:'The Robot Controller app on this Control Hub is not answering. Press Scan to start it, or restart the robot.'};return ok({current:r.installed&&!r.mismatch,opMode:r.installed&&!r.mismatch?r.opMode:null});}
      if(action==='rc-start'){r.rcStarts++;r.guessed=false;return ok(true);}
      if(action==='debug-install'){r.installs++;r.installData.push(data);if(r.build)return ok(r.build);r.installed=true;r.opMode=`TorqueDebug-test${r.installs}`;return ok({built:true,opMode:r.opMode});}
      if(action==='debug-start'){r.starts++;r.startedWith.push(data);return ok(true);}
      if(action==='debug-stop'){r.stops++;BrowserWindow.getAllWindows()[0].webContents.send('robot-link-debug',{ended:'stopped'});return ok(true);}
      if(action==='debug-camera'){r.streaming=data?.on===true;return ok(true);}
      if(action==='debug-send'){r.sent.push(data.line);return ok(true);}
      if(action==='debug-claim')return ok(true);
      return {ok:false,error:'not in this test: '+action};});},{xml:XML,cam:CAM});
    const u=()=>app.evaluate(()=>global.__u),text=s=>page.locator(s).first().innerText();
    const toCalibrate=async()=>{await page.evaluate(()=>window.deck.page('calibrate'));await page.waitForFunction(()=>state.page==='calibrate');};
    const toConfigure=async()=>{await page.evaluate(()=>window.deck.page('setup'));await page.waitForFunction(()=>state.page==='setup');await page.click('#setup-view .flow-steps [data-flow=configure]');await page.waitForSelector('.ce-grid');};
    const until=async(what,fn,ms=20000)=>{for(const end=Date.now()+ms;;await page.waitForTimeout(100)){if(await fn())return;if(Date.now()>end)assert.fail('timed out: '+what);}};

    // A. The order, and where it opens.
    await toCalibrate();
    assert.deepEqual(await page.$$eval('#calibrate-view [data-cal-top]',l=>l.map(b=>[b.id,b.textContent])),[['cal-tab-camera','Camera'],['cal-tab-debug','Debug'],['cal-tab-calibrate','Calibrate']],'Camera first, Calibrate at the very end');
    const opened=()=>page.$$eval('#calibrate-view [data-cal-top-panel]',l=>l.filter(p=>!p.hidden).map(p=>p.id));
    assert.equal(await page.getAttribute('#cal-tab-camera','aria-selected'),'true','it opens on Camera');assert.deepEqual(await opened(),['cal-panel-camera']);
    await page.focus('#cal-tab-camera');await page.keyboard.press('ArrowRight');assert.deepEqual(await opened(),['cal-panel-debug'],'the arrow keys follow the same order');await page.keyboard.press('ArrowRight');assert.deepEqual(await opened(),['cal-panel-calibrate']);
    await page.click('#cal-tab-camera');
    // Nothing a student has to read first, and no words about how it works.
    const cameraWords=async()=>{const t=await page.locator('#cal-camera').evaluate(e=>e.textContent);assert.doesNotMatch(t,/see what a webcam sees/i);assert.doesNotMatch(t,/live debug|torque debug|decimation/i,t.slice(0,400));};await cameraWords();

    // B. It scans by itself; Setup, Configure and Camera all have the camera.
    await page.click('#robot-setup-tab');await page.waitForFunction(()=>/Ucamera001/.test(document.querySelector('#rs-hubs').textContent));assert.ok((await u()).scans>=1);
    await toConfigure();
    const row=page.locator('#rs-step-configure .ce-usb',{hasText:'Ucamera001'});await row.waitFor();assert.match(await row.innerText(),/Webcam · Ucamera001\s+(Add\s+)?plugged in, not in this configuration/);assert.equal(await page.locator('#rs-step-configure [data-ce-usb-add]').count(),1,'one Add button');
    assert.ok(await page.evaluate(()=>{const r=document.querySelector('#rs-step-configure .ce-usb button').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),'on screen without scrolling');assert.equal(await page.locator('[data-ce-save]').isDisabled(),true,'seeing it changes nothing');
    await page.screenshot({path:path.join(out,'configure.png')});
    // Camera: heads the tab by its name, says what to do in one line, and offers the one button.
    await toCalibrate();await page.waitForFunction(()=>/Ucamera001/.test(document.querySelector('[data-cam-name]').textContent));
    await page.waitForFunction(()=>/not in the active configuration/.test(document.querySelector('[data-cam-status]').textContent));assert.match(await text('[data-cam-status]'),/^Ucamera001 is plugged in, but it is not in the active configuration, “robot”\.$/);
    assert.equal(await text('[data-cam-add]'),'Auto-configure');assert.equal(await page.locator('[data-cam-canvas]').isVisible(),false,'no simulated picture');assert.equal(await page.locator('[data-cam-image]').isVisible(),false);assert.equal(await page.locator('[data-cam-tune]').isDisabled(),true);assert.equal(await page.locator('[data-cam-pick]').isVisible(),false,'one camera: no row of names');assert.equal((await u()).starts,0,'it cannot be opened yet');assert.equal((await u()).installs,0);await page.screenshot({path:path.join(out,'camera.png')});
    await cameraWords();

    // A new scan draws it again in place, with a device edit and a name still being typed safe.
    await toConfigure();await page.locator('.ce-hubs [data-ce-hub]').first().click();await page.locator('.ce-main button',{hasText:/Motors/}).first().click();await page.locator('.ce-main input[id^=ce-name-]').first().fill('elbow');await page.locator('.ce-main input[id^=ce-name-]').first().press('Tab');await page.waitForSelector('[data-ce-save]:not([disabled])');
    await page.locator('.ce-main input[id^=ce-name-]').first().click();await page.keyboard.press('End');await page.keyboard.type('Two');
    await app.evaluate(({},cam)=>{global.__u.others=[cam,{serial:'SECOND',type:'WEBCAM'}];},CAM);await page.evaluate(()=>document.querySelector('#rs-scan').click());
    await page.waitForSelector('[data-ce-usb-add="SECOND"]',{timeout:15000});
    const name=page.locator('.ce-main input[id^=ce-name-]').first();assert.equal(await name.inputValue(),'elbowTwo','what is being typed stays');assert.equal(await page.evaluate(()=>document.activeElement?.id),await name.getAttribute('id'),'and so does the cursor');await page.keyboard.type('x');assert.equal(await name.inputValue(),'elbowTwox','typing carries on where it was');
    await page.keyboard.press('Tab');await page.waitForTimeout(100);assert.equal(await page.locator('.ce-main input[id^=ce-name-]').first().inputValue(),'elbowTwox','leaving the box takes the name');assert.equal(await page.locator('[data-ce-save]').isDisabled(),false,'the edit is still there to save');assert.equal((await u()).saves.length,0,'nothing went to the robot');
    await page.click('[data-ce-cancel]');assert.equal(await page.locator('[data-ce-save]').isDisabled(),true);await page.click('[data-ce-back]');
    // Camera follows the same scan: two cameras, a row of their names.
    const names=()=>page.$$eval('[data-cam-choice]',l=>l.map(b=>b.textContent));
    await toCalibrate();await page.waitForFunction(()=>document.querySelectorAll('[data-cam-choice]').length===2);assert.deepEqual(await names(),['Ucamera001','SECOND']);assert.equal(await page.locator('[data-cam-name]').isVisible(),false,'the row is the heading');await page.click('[data-cam-choice="usb:SECOND"]');assert.equal(await page.getAttribute('[data-cam-choice="usb:SECOND"]','aria-pressed'),'true');assert.match(await text('[data-cam-status]'),/^SECOND is plugged in/);
    await app.evaluate(({},cam)=>{global.__u.others=[cam];},CAM);await page.evaluate(()=>window.deck.page('setup'));await page.waitForFunction(()=>state.page==='setup');await page.evaluate(()=>document.querySelector('#rs-scan').click());await page.waitForFunction(()=>!document.querySelector('[data-ce-usb-add="SECOND"]'),null,{timeout:15000});

    // C. Add, rename and remove: the draft only, until Save.
    await page.click('[data-ce-usb-add="Ucamera001"]');const box=page.locator('[data-ce-usb-name="0"]');assert.equal(await box.inputValue(),'Webcam');assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.ceUsbName),'0','ready to rename');assert.match(await text('#rs-step-configure .ce-usb'),/Webcam · Ucamera001 · plugged in/);assert.match(await text('.ce-note'),/Press Save to put it on the robot/);assert.equal(await page.locator('[data-ce-save]').isDisabled(),false);assert.equal((await u()).saves.length,0,'Add writes nothing');
    await box.fill('leftFront');await box.press('Tab');assert.match(await text('.ce-note'),/already named/);assert.equal(await page.locator('[data-ce-usb-name="0"]').inputValue(),'Webcam','a name taken is refused');
    await page.locator('[data-ce-usb-name="0"]').fill('front cam');await page.locator('[data-ce-usb-name="0"]').press('Tab');assert.equal(await page.locator('[data-ce-usb-name="0"]').inputValue(),'front cam');
    await page.click('[data-ce-usb-remove="0"]');await page.waitForSelector('[data-ce-usb-add="Ucamera001"]');assert.equal(await page.locator('[data-ce-usb-name]').count(),0,'back to plugged in, not in this configuration');assert.equal((await u()).saves.length,0);
    await page.click('[data-ce-usb-add="Ucamera001"]');await page.click('[data-ce-save]');for(let i=0;i<40&&!(await u()).saves.length;i++)await page.waitForTimeout(100);
    {const r=await u();assert.equal(r.saves.length,1,'Save writes it');assert.ok(r.saves[0].xml.includes('<Webcam name="Webcam" serialNumber="Ucamera001" />'),r.saves[0].xml);assert.ok(r.saves[0].xml.includes('name="leftFront"'),'the rest of it stays');}
    await page.waitForSelector('[data-ce-usb-name="0"]');await page.waitForFunction(()=>document.querySelector('[data-ce-save]').disabled,null,{timeout:15000});

    // E. The camera is in the configuration. Opening the tab is all it takes: the robot has no copy, so it goes on once, and it starts.
    const debugEvent=m=>app.evaluate(({BrowserWindow},m)=>BrowserWindow.getAllWindows()[0].webContents.send('robot-link-debug',m),m);
    const live=(more={})=>({frame:{t:1,loop:5,v:12,cam:{state:'STREAMING',open:'Webcam',fps:11.4,range:[0,100,1,10],modes:['Manual'],seen:50,exp:null,gain:null,dec:3,lens:null,tags:[],...more}}});
    const picture=[...Cam.simFrame(1,.6)],manifest={cameras:['Webcam'],motors:[],servos:[],crservos:[],digital:[],touch:[],analog:[],i2c:[]};
    await page.waitForTimeout(300);await toCalibrate();await page.click('#cal-tab-camera');await until('it starts by itself',async()=>(await u()).starts===1);
    {const r=await u();assert.equal(r.installs,1,'the robot had no copy');assert.ok(r.currents>=1,'it asked first');assert.equal(r.startedWith[0].host,'usb');assert.equal(r.startedWith[0].auto,true);assert.equal(r.startedWith[0].opMode,'TorqueDebug-test1','the build it just made');assert.equal(r.startedWith[0].noStart,true,'nobody pressed anything, so the Robot Controller app is not started');assert.deepEqual(r.installData[0],{host:'usb',auto:true,noStart:true},'the build says so too, and main looks at the robot first');}
    assert.match(await text('[data-cam-name]'),/^Webcam$/);assert.match(await text('[data-cam-status]'),/^Getting the camera ready…/);assert.equal(await page.locator('[data-cam-add]').isVisible(),false);await cameraWords();
    await debugEvent({manifest});await debugEvent(live());await until('its picture is asked for',async()=>(await u()).streaming);
    await debugEvent({camera:Uint8Array.from(picture)});await page.waitForFunction(()=>{const i=document.querySelector('[data-cam-image]');return !i.hidden&&i.naturalWidth===160;});await debugEvent(live());await page.waitForFunction(()=>document.querySelector('[data-cam-status]').textContent==='11 frames a second');assert.equal(await page.locator('[data-cam-canvas]').isVisible(),false);assert.equal(await page.locator('[data-cam-empty]').isVisible(),false);
    // Right beside the picture, with no scrolling at 1280x800.
    const fits=()=>page.evaluate(()=>{const bottom=s=>document.querySelector(s).getBoundingClientRect().bottom,view=document.querySelector('[data-cam-view]').getBoundingClientRect(),side=document.querySelector('[data-cam-side]').getBoundingClientRect(),card=document.querySelector('#cal-camera'),box=card.getBoundingClientRect(),pad=parseFloat(getComputedStyle(card).paddingRight),image=document.querySelector('[data-cam-image]');return {page:document.documentElement.scrollHeight,win:innerHeight,tune:bottom('[data-cam-tune]'),tags:bottom('[data-cam-tags]'),view:bottom('[data-cam-view]'),beside:side.left>=view.right&&side.top<view.bottom,wide:view.width,tall:view.height,left:box.right-pad-side.right,frame:image.naturalWidth/image.naturalHeight};});
    // The picture and its settings fill the card, the picture as large as the height allows, at its own shape, and the whole row fits. A real camera's frame comes at 960x720.
    for(const [width,height,least] of [[1280,800,560],[2000,1100,900]]){await page.setViewportSize({width,height});await page.waitForTimeout(150);const f=await fits(),size=`at ${width}x${height}: ${JSON.stringify(f)}`;assert.ok(f.beside,`the settings are next to the picture ${size}`);assert.ok(f.tags<=f.win&&f.view<=f.win,size);assert.ok(f.page<=f.win,`nothing scrolls ${size}`);assert.ok(f.wide>=least,`the picture is as large as fits ${size}`);assert.ok(Math.abs(f.left)<2,`nothing empty on the right ${size}`);assert.ok(Math.abs(f.wide/f.tall-4/3)<.01,`its box is 4:3 ${size}`);assert.ok(Math.abs(f.frame-4/3)<.01,`and so is the frame ${size}`);}await page.setViewportSize({width:1280,height:800});
    await page.screenshot({path:path.join(out,'camera-live.png')});
    // Its settings: rotate is the view's own, exposure goes to the robot, and what this camera lacks is not offered.
    await page.selectOption('#cam-rotate','90');assert.match(await page.locator('[data-cam-image]').evaluate(e=>e.style.transform),/rotate\(90deg\)/);await page.selectOption('#cam-rotate','0');
    assert.equal(await page.locator('#cam-gain').count(),0,'no gain on this camera');assert.deepEqual(await page.$$eval('#cam-exposure option',l=>l.map(o=>o.textContent)).then(o=>o.includes('Automatic')),false,'nor automatic');assert.equal(await page.inputValue('#cam-exposure'),'50','it shows what the camera says it has');
    // A camera with only a manual exposure that has gain: its gain is not greyed out as if automatic were on, and picking one goes with the exposure the box shows.
    await debugEvent(live({range:[0,100,0,255]}));await page.waitForSelector('#cam-gain');assert.equal(await page.locator('#cam-gain').isDisabled(),false,'gain can be set');assert.equal(await page.locator('#cam-gain').getAttribute('title'),null);await page.selectOption('#cam-gain','125');await until('gain sent with its exposure',async()=>(await u()).sent.includes('V\t50\t125'));await page.selectOption('#cam-gain','100');await debugEvent(live());await page.waitForFunction(()=>!document.querySelector('#cam-gain'));
    await page.selectOption('#cam-exposure','5');await until('the exposure sent',async()=>(await u()).sent.includes('V\t5\t0'));assert.deepEqual(await page.$$eval('#cam-decimation option',l=>l.map(o=>o.textContent)),['Farthest, slowest (1)','In between (2)','Closest, fastest (3)']);await page.selectOption('#cam-decimation','1');await until('the reading sent',async()=>(await u()).sent.includes('D\t1'));assert.ok((await u()).sent.every(l=>/^[VDKW]\t/.test(l)),'nothing but the camera’s own settings on this path');await page.selectOption('#cam-decimation','3');
    await page.locator('#cal-camera').evaluate(e=>e.scrollIntoView({block:'start'}));
    // A look at another tab keeps it: no restart, no stop. Leaving lets go, shortly after.
    await page.click('#cal-tab-debug');await page.waitForTimeout(1500);await page.click('#cal-tab-camera');await page.waitForTimeout(600);{const r=await u();assert.equal(r.starts,1);assert.equal(r.stops,0);}
    await page.click('#cal-tab-calibrate');const left=Date.now();await until('it lets go',async()=>(await u()).stops===1,Cam.LINGER+8000);assert.ok(Date.now()-left>=Cam.LINGER-1500,'not at once');assert.equal((await u()).streaming,false);
    // Back: the robot's copy is this one, so nothing is built; it only starts.
    await page.click('#cal-tab-camera');await until('it starts again',async()=>(await u()).starts===2);{const r=await u();assert.equal(r.installs,1,'not rebuilt');assert.equal(r.startedWith[1].opMode,'TorqueDebug-test1');}
    await debugEvent({manifest});await debugEvent(live());
    // Someone else's run is shared: stopping it is not this tab's to do. And on Drive nothing starts.
    await page.click('#cal-tab-calibrate');await until('it lets go again',async()=>(await u()).stops===2,Cam.LINGER+8000);{const was=(await u()).starts;await page.evaluate(()=>window.deck.page('drive'));await page.waitForFunction(()=>state.page==='drive');await page.waitForTimeout(2500);assert.equal((await u()).starts,was,'never on Drive');}
    // A failed build: its one line, with the file and the symbol; nothing tries again by itself; Try again does.
    await app.evaluate(()=>{const r=global.__u;r.installed=false;r.build={built:false,errors:[{file:'TeamAuto.java',line:12,message:'cannot find symbol: method bar()'}],problem:'Your file TeamAuto.java has an error on line 12: cannot find symbol: method bar(). OnBot Java builds every file together, so nothing new can go on the robot until that file is fixed. Torque did not change it.'};});
    await toCalibrate();await page.click('#cal-tab-camera');await page.waitForFunction(()=>/TeamAuto\.java/.test(document.querySelector('[data-cam-status]').textContent));assert.match(await text('[data-cam-status]'),/^Your file TeamAuto\.java has an error on line 12: cannot find symbol: method bar\(\)\./);assert.equal(await page.locator('[data-cam-again]').isVisible(),true);assert.equal(await page.locator('[data-cam-image]').isVisible(),false);await page.screenshot({path:path.join(out,'camera-build-failed.png')});
    {const r=await u(),was=[r.installs,r.starts];await page.waitForTimeout(4500);const n=await u();assert.deepEqual([n.installs,n.starts],was,'a broken file does not get rebuilt over and over');}
    await app.evaluate(()=>{global.__u.build=null;});await page.click('[data-cam-again]');await until('Try again',async()=>(await u()).installed);await page.waitForFunction(()=>!/TeamAuto/.test(document.querySelector('[data-cam-status]').textContent));{const r=await u();assert.deepEqual(r.installData.at(-1),{host:'usb',auto:true},'a press: main may look, and it clears a crash');await until('it starts',async()=>(await u()).startedWith.at(-1).noStart===undefined);}await debugEvent({manifest});await debugEvent(live());
    // The crash guard: says what happened, and a visit does not try it again. Another Driver Station: says so, and tries again by itself.
    await debugEvent({error:'Another Driver Station is connected to this robot. Disconnect it, then try again.'});await page.waitForFunction(()=>/Another Driver Station is connected/.test(document.querySelector('[data-cam-status]').textContent));assert.equal(await page.locator('[data-cam-again]').isVisible(),false,'it clears by itself');{const was=(await u()).starts;await until('it tries again',async()=>(await u()).starts>was,16000);assert.equal((await u()).startedWith.at(-1).noStart,true,'a retry nobody pressed for never starts the Robot Controller app');}
    await debugEvent({error:'The Robot Controller app on this robot crashed when it loaded Torque Debug, so Torque took it off again and restarted the app. Nothing else changed.'});await page.waitForFunction(()=>/crashed when it loaded the camera program/.test(document.querySelector('[data-cam-status]').textContent));await cameraWords();
    {const was=(await u()).starts;await page.click('#cal-tab-debug');await page.click('#cal-tab-camera');await page.waitForTimeout(2500);assert.equal((await u()).starts,was,'coming back does not crash it again');assert.match(await text('[data-cam-status]'),/crashed/);await page.click('[data-cam-again]');await until('only a press does',async()=>(await u()).starts>was);}

    // F. Two cameras in the configuration: a row of names, and the row opens the one picked. Only one is ever open.
    await app.evaluate(({},cam)=>{const r=global.__u;r.others=[cam,{serial:'SECOND',type:'WEBCAM'}];r.xml=r.xml.replace('<Webcam name="Webcam" serialNumber="Ucamera001" />','<Webcam name="Webcam" serialNumber="Ucamera001" />\n    <Webcam name="Back" serialNumber="SECOND" />');r.sent=[];},CAM);
    await debugEvent({manifest:{...manifest,cameras:['Webcam','Back']}});await debugEvent(live());await page.waitForFunction(()=>document.querySelectorAll('[data-cam-choice]').length>=2);assert.ok((await names()).includes('Back'));await page.click('[data-cam-choice="Back"]');await until('the other camera asked for',async()=>(await u()).sent.includes('W\tBack'));assert.match(await text('[data-cam-status]'),/^Opening “Back”\. One camera opens at a time\.$/);
    await debugEvent(live({open:'Back',state:'OPENING'}));await debugEvent(live({open:'Back'}));await debugEvent({camera:Uint8Array.from(picture)});await page.waitForFunction(()=>document.querySelector('[data-cam-status]').textContent==='11 frames a second');assert.equal((await u()).sent.filter(l=>l==='W\tBack').length,1,'asked once');await page.screenshot({path:path.join(out,'camera-two.png')});
    await debugEvent({ended:'stopped'});await page.click('#cal-tab-calibrate');await page.waitForTimeout(300);await app.evaluate(({},xml)=>{const r=global.__u;r.xml=r.xml.replace(/\n\s*<Webcam name="Back"[^>]*>/,'');},XML);

    // A camera in the configuration and not plugged in says so, in both places.
    await app.evaluate(()=>{global.__u.others=[];});await page.evaluate(()=>window.deck.page('setup'));await page.waitForFunction(()=>state.page==='setup');await page.evaluate(()=>document.querySelector('#rs-scan').click());
    await page.waitForFunction(()=>/in this configuration, not plugged in/.test(document.querySelector('#rs-step-configure').textContent),null,{timeout:15000});await toCalibrate();await page.click('#cal-tab-camera');await page.waitForFunction(()=>/last scan did not find it/.test(document.querySelector('[data-cam-status]').textContent));

    // D. The Robot Controller restarts after a scan: Setup and Configure agree, and it looks again.
    await app.evaluate(({},cam)=>{global.__u.others=[cam];},CAM);await page.evaluate(()=>window.deck.page('setup'));await page.waitForFunction(()=>state.page==='setup');await page.evaluate(()=>document.querySelector('#rs-scan').click());await page.waitForFunction(()=>/Ucamera001/.test(document.querySelector('#rs-hubs').textContent),null,{timeout:15000});
    const both=()=>page.evaluate(()=>[/Ucamera001/.test(document.querySelector('#rs-hubs').textContent),/Ucamera001/.test(document.querySelector('#rs-step-configure')?.textContent||'')]);await page.waitForFunction(()=>/Ucamera001/.test(document.querySelector('#rs-step-configure').textContent),null,{timeout:15000});
    const before=(await u()).scans;await app.evaluate(()=>{global.__u.fail=1;});await page.evaluate(()=>document.querySelector('#rs-read').click());await page.waitForFunction(()=>/Ucamera001/.test(document.querySelector('#rs-step-configure').textContent));for(let i=0;i<120&&(await u()).scans<=before;i++)await page.waitForTimeout(250);
    assert.ok((await u()).scans>before,'it scans again after the restart');assert.deepEqual(await both(),[true,true],'Setup and Configure agree');

    // G. Leaving while it asks whether the robot's copy is this one: nothing is built.
    await debugEvent({ended:'stopped'});await page.waitForTimeout(100);const toCamera=async()=>{await toCalibrate();await page.click('#cal-tab-camera');};
    await app.evaluate(()=>{const r=global.__u;r.installed=false;r.holdCurrent=1500;r.installs=0;r.installData=[];r.currents=0;r.starts=0;r.startedWith=[];});await toCamera();await until('it asks',async()=>(await u()).currents>0);await page.evaluate(()=>window.deck.page('drive'));await page.waitForFunction(()=>state.page==='drive');await page.waitForTimeout(2500);{const r=await u();assert.equal(r.installs,0,'no build for a page that has gone');assert.equal(r.starts,0);}
    // A copy that never matches: one build a visit, then a line and Try again, however often it comes back.
    await app.evaluate(()=>{const r=global.__u;r.holdCurrent=0;r.mismatch=true;});await toCamera();await until('the one build',async()=>(await u()).installs===1&&(await u()).starts===1);await debugEvent({manifest});await debugEvent(live());await debugEvent({ended:'lost'});
    await page.waitForFunction(()=>/still does not match this version of Torque/.test(document.querySelector('[data-cam-status]').textContent),null,{timeout:10000});assert.equal(await page.locator('[data-cam-again]').isVisible(),true);{const r=await u();assert.equal(r.installs,1,'not built again');assert.equal(r.starts,1);}await page.waitForTimeout(3500);assert.equal((await u()).installs,1,'nor by itself later');
    await page.click('[data-cam-again]');await until('a press builds again',async()=>(await u()).installs===2);await until('and starts it',async()=>(await u()).starts===2);await app.evaluate(()=>{global.__u.mismatch=false;});await debugEvent({manifest});await debugEvent(live());{const was=(await u()).stops;await page.click('#cal-tab-calibrate');await until('it lets go',async()=>(await u()).stops>was,Cam.LINGER+8000);}
    // A Robot Controller app that never starts: not "getting ready" for ever. It says so, offers Try again, and asks far less often. Each visit asks at once, which here stands in for the 40 seconds of it.
    await app.evaluate(()=>{const r=global.__u;r.guessed=true;r.rcStarts=0;r.starts=0;});await page.click('#cal-tab-camera');await page.waitForFunction(()=>/^Getting the camera ready…/.test(document.querySelector('[data-cam-status]').textContent));assert.equal((await u()).starts,0,'it does not start on a guess');
    for(let i=0;i<Cam.GUESSES+6&&(await text('[data-cam-status]'))!==Cam.RC_QUIET;i++){await page.click('#cal-tab-debug');await page.waitForTimeout(650);await page.click('#cal-tab-camera');await page.waitForTimeout(650);}
    assert.equal(await text('[data-cam-status]'),Cam.RC_QUIET);assert.equal(await page.locator('[data-cam-again]').isVisible(),true);assert.equal(await page.locator('[data-cam-add]').isVisible(),false);assert.equal((await u()).rcStarts,0,'nothing pressed, nothing started');{const was=(await u()).reads;await page.waitForTimeout(6000);assert.ok((await u()).reads-was<=1,'it asks far less often');}await page.screenshot({path:path.join(out,'camera-not-answering.png')});
    await page.click('[data-cam-again]');await until('a press starts the app',async()=>(await u()).rcStarts===1);await until('and the picture follows',async()=>(await u()).starts>=1);assert.equal((await u()).startedWith.at(-1).noStart,undefined,'the press carries through');await debugEvent({manifest});await debugEvent(live());

    // H. Hidden, the Debug panel draws nothing, and on showing again it has the latest without waiting for another reading.
    const stats=()=>page.locator('[data-debug-stats]').evaluate(e=>e.textContent);await debugEvent({frame:{...live().frame,t:9000,v:11.11}});await page.waitForTimeout(300);assert.doesNotMatch(await stats(),/11\.11 V/,'not while hidden');await page.click('#cal-tab-debug');await page.waitForFunction(()=>/11\.11 V/.test(document.querySelector('[data-debug-stats]').textContent));await page.click('#cal-tab-camera');
    // A burst of readings: the line ends on the last.
    await debugEvent({camera:Uint8Array.from(picture)});for(const fps of [11,12,13,14,23])await debugEvent(live({fps}));await page.waitForFunction(()=>document.querySelector('[data-cam-status]').textContent==='23 frames a second');

    assert.deepEqual(errors,[]);console.log('USB camera: all passed');
  }finally{await app.close().catch(()=>{});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,1800));process.exit(1);});
