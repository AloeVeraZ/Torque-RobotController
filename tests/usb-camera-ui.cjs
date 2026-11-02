'use strict';
// A camera on the Control Hub's USB in the real app, against a stubbed hub:
//  A. Calibrate's tabs run Camera, USB devices, Debug, Calibrate, and open on Camera;
//  B. a scan's camera reaches Configure and Camera, a new scan redraws both with nothing lost, and neither writes to the robot until Save;
//  C. Add, rename and remove, and the XML Save sends;
//  D. the Robot Controller restarting after a scan does not hide the camera from Configure while Setup still shows it;
//  E. Camera's own Start live debug and Put Torque Debug on the robot, with the Debug tab's consent.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/usb-camera-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/usb-camera');fs.mkdirSync(out,{recursive:true});
const XML=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<Robot type="FirstInspires-FTC">\n    <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">\n        <LynxModule name="Control Hub" port="173">\n            <goBILDA5202SeriesMotor name="leftFront" port="0" />\n        </LynxModule>\n    </LynxUsbDevice>\n</Robot>\n`;
const CAM={serial:'Ucamera001',type:'WEBCAM'};
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-usb-camera-')),env={...process.env,DECK_HEADLESS:'1',DECK_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);await page.setViewportSize({width:1280,height:800});
    await app.evaluate(({ipcMain},{xml,cam})=>{const g=global;g.__u={xml,others:[cam],fail:0,scans:0,saves:[],starts:0,installs:0,installed:false};ipcMain.removeHandler('robot-link');ipcMain.handle('robot-link',async(e,action,data)=>{const r=g.__u,ok=value=>({ok:true,value});
      if(action==='detect')return ok({usb:{found:true,serial:'hub1'},wifi:{robot:false}});if(action==='usb-status')return ok({found:true,serial:'hub1'});if(action==='usb-recover')return ok(null);
      if(action==='read-usb'){if(r.fail>0){r.fail--;return {ok:false,error:'The Control Hub is still starting up. This takes about a minute after the battery goes on.',code:'HUB_STARTING'};}return ok({serial:'hub1',active:{name:'robot'},configurations:['robot'],files:{robot:r.xml}});}
      if(action==='check')return ok([{name:'Robot Controller app',ok:true,detail:'FTC SDK 12.0'}]);
      if(action==='scan'){r.scans++;return ok({portals:[{serial:'(embedded)',modules:[{address:173,parent:true}],servoHubs:[]}],others:r.others});}
      if(action==='configure'){r.saves.push(data);r.xml=data.xml;return ok(true);}
      if(action==='debug-start'){r.starts++;return ok(true);}if(action==='debug-stop')return ok(true);if(action==='debug-camera'){r.streaming=data?.on===true;return ok(true);}
      if(action==='debug-install'){r.installs++;r.installed=true;return ok({built:true,opMode:'TorqueDebug-test'});}
      return {ok:false,error:'not in this test: '+action};});},{xml:XML,cam:CAM});
    const u=()=>app.evaluate(()=>global.__u),text=s=>page.locator(s).first().innerText();
    const toCalibrate=async()=>{await page.evaluate(()=>window.deck.page('calibrate'));await page.waitForFunction(()=>state.page==='calibrate');};
    const toConfigure=async()=>{await page.evaluate(()=>window.deck.page('setup'));await page.waitForFunction(()=>state.page==='setup');await page.click('#setup-view .flow-steps [data-flow=configure]');await page.waitForSelector('.ce-grid');};

    // A. The order, and where it opens.
    await toCalibrate();
    assert.deepEqual(await page.$$eval('#calibrate-view [data-cal-top]',l=>l.map(b=>[b.id,b.textContent])),[['cal-tab-camera','Camera'],['cal-tab-usb','USB devices'],['cal-tab-debug','Debug'],['cal-tab-calibrate','Calibrate']],'Camera first, Calibrate at the very end');
    const opened=()=>page.$$eval('#calibrate-view [data-cal-top-panel]',l=>l.filter(p=>!p.hidden).map(p=>p.id));
    assert.equal(await page.getAttribute('#cal-tab-camera','aria-selected'),'true','it opens on Camera');assert.deepEqual(await opened(),['cal-panel-camera']);
    await page.click('#cal-tab-usb');assert.deepEqual(await opened(),['cal-panel-usb']);assert.equal(await page.locator('#cal-usb h2').innerText(),'USB devices');
    await page.focus('#cal-tab-usb');await page.keyboard.press('ArrowRight');assert.deepEqual(await opened(),['cal-panel-debug'],'the arrow keys follow the same order');await page.keyboard.press('ArrowRight');assert.deepEqual(await opened(),['cal-panel-calibrate']);
    await page.click('#cal-tab-camera');

    // B. It scans by itself; Setup, Configure and Camera all have the camera.
    await page.click('#robot-setup-tab');await page.waitForFunction(()=>/Ucamera001/.test(document.querySelector('#rs-hubs').textContent));assert.ok((await u()).scans>=1);
    await toConfigure();
    const row=page.locator('.ce-main .ce-usb',{hasText:'Ucamera001'});await row.waitFor();assert.match(await row.innerText(),/Webcam · Ucamera001\s+plugged in, not in this configuration/);assert.equal(await page.locator('.ce-main [data-ce-usb-add]').count(),1,'one Add button');
    assert.ok(await page.evaluate(()=>{const r=document.querySelector('.ce-main .ce-usb button').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),'on screen without scrolling');assert.equal(await page.locator('[data-ce-save]').isDisabled(),true,'seeing it changes nothing');
    assert.match(await text('.ce-hubs [data-ce-usb-show]'),/1 camera plugged in, not in this configuration/);await page.screenshot({path:path.join(out,'configure.png')});
    // From inside a family it is one press away.
    await page.locator('.ce-main button',{hasText:/Motors/}).first().click();assert.equal(await page.locator('.ce-main .ce-usb').count(),0);assert.equal(await page.locator('.ce-hubs [data-ce-usb-show]').count(),1,'still on the right');await page.click('.ce-hubs [data-ce-usb-show]');await row.waitFor();
    // Camera: in its dropdown, says what to do, and takes the student to it.
    await toCalibrate();const source=()=>page.$eval('#cam-source',s=>[...s.options].map(o=>o.textContent));
    await page.waitForFunction(()=>[...document.querySelector('#cam-source').options].some(o=>/Ucamera001/.test(o.textContent)));assert.deepEqual(await source(),['Webcam · Ucamera001 (not in this configuration)'],'no simulated webcam in its place');
    assert.match(await text('[data-cam-note]'),/Ucamera001 is plugged into the Control Hub, but it is not in the active configuration, “robot”\. The Robot Controller can only open cameras in its active configuration/);assert.equal(await page.locator('[data-cam-start]').isVisible(),false,'it cannot be opened yet');assert.equal(await page.locator('[data-cam-canvas]').isVisible(),false,'no simulated picture');assert.equal(await page.locator('[data-cam-tune]').isDisabled(),true);await page.screenshot({path:path.join(out,'camera.png')});
    await page.click('[data-cam-add]');await page.waitForFunction(()=>state.page==='setup'&&!document.querySelector('#rs-step-configure').hidden);await row.waitFor();await page.waitForFunction(()=>document.activeElement?.dataset?.ceUsbAdd==='Ucamera001');

    // A new scan draws it again in place, with a device edit and a name still being typed safe.
    await page.locator('.ce-hubs [data-ce-hub]').first().click();await page.locator('.ce-main button',{hasText:/Motors/}).first().click();await page.locator('.ce-main input[id^=ce-name-]').first().fill('elbow');await page.locator('.ce-main input[id^=ce-name-]').first().press('Tab');await page.waitForSelector('[data-ce-save]:not([disabled])');
    await page.locator('.ce-main input[id^=ce-name-]').first().click();await page.keyboard.press('End');await page.keyboard.type('Two');
    await app.evaluate(({},cam)=>{global.__u.others=[cam,{serial:'SECOND',type:'WEBCAM'}];},CAM);await page.evaluate(()=>document.querySelector('#rs-scan').click());
    await page.waitForFunction(()=>/2 cameras plugged in/.test(document.querySelector('.ce-hubs').textContent),null,{timeout:15000});
    const name=page.locator('.ce-main input[id^=ce-name-]').first();assert.equal(await name.inputValue(),'elbowTwo','what is being typed stays');assert.equal(await page.evaluate(()=>document.activeElement?.id),await name.getAttribute('id'),'and so does the cursor');await page.keyboard.type('x');assert.equal(await name.inputValue(),'elbowTwox','typing carries on where it was');
    await page.keyboard.press('Tab');await page.waitForTimeout(100);assert.equal(await page.locator('.ce-main input[id^=ce-name-]').first().inputValue(),'elbowTwox','leaving the box takes the name');assert.equal(await page.locator('[data-ce-save]').isDisabled(),false,'the edit is still there to save');assert.equal((await u()).saves.length,0,'nothing went to the robot');
    await page.click('[data-ce-cancel]');assert.equal(await page.locator('[data-ce-save]').isDisabled(),true);await page.click('[data-ce-back]');
    // Camera follows the same scan, with no leaving and coming back.
    await toCalibrate();await page.waitForFunction(()=>document.querySelector('#cam-source').options.length===2);assert.deepEqual(await source(),['Webcam · Ucamera001 (not in this configuration)','Webcam · SECOND (not in this configuration)']);await page.selectOption('#cam-source','usb:SECOND');assert.match(await text('[data-cam-note]'),/^SECOND is plugged in/);
    await app.evaluate(({},cam)=>{global.__u.others=[cam];},CAM);await page.evaluate(()=>window.deck.page('setup'));await page.waitForFunction(()=>state.page==='setup');await page.evaluate(()=>document.querySelector('#rs-scan').click());await page.waitForFunction(()=>/1 camera plugged in/.test(document.querySelector('.ce-hubs').textContent),null,{timeout:15000});

    // C. Add, rename and remove: the draft only, until Save.
    await page.click('[data-ce-usb-add="Ucamera001"]');const box=page.locator('[data-ce-usb-name="0"]');assert.equal(await box.inputValue(),'Webcam 1');assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.ceUsbName),'0','ready to rename');assert.match(await text('.ce-main .ce-usb'),/Webcam · Ucamera001 · plugged in/);assert.match(await text('.ce-note'),/Press Save to put it on the robot/);assert.equal(await page.locator('[data-ce-save]').isDisabled(),false);assert.equal((await u()).saves.length,0,'Add writes nothing');
    await box.fill('leftFront');await box.press('Tab');assert.match(await text('.ce-note'),/already named/);assert.equal(await page.locator('[data-ce-usb-name="0"]').inputValue(),'Webcam 1','a name taken is refused');
    await page.locator('[data-ce-usb-name="0"]').fill('front cam');await page.locator('[data-ce-usb-name="0"]').press('Tab');assert.equal(await page.locator('[data-ce-usb-name="0"]').inputValue(),'front cam');
    await page.click('[data-ce-usb-remove="0"]');await page.waitForSelector('[data-ce-usb-add="Ucamera001"]');assert.equal(await page.locator('[data-ce-usb-name]').count(),0,'back to plugged in, not in this configuration');assert.equal((await u()).saves.length,0);
    await page.click('[data-ce-usb-add="Ucamera001"]');await page.click('[data-ce-save]');for(let i=0;i<40&&!(await u()).saves.length;i++)await page.waitForTimeout(100);
    {const r=await u();assert.equal(r.saves.length,1,'Save writes it');assert.ok(r.saves[0].xml.includes('<Webcam name="Webcam 1" serialNumber="Ucamera001" />'),r.saves[0].xml);assert.ok(r.saves[0].xml.includes('name="leftFront"'),'the rest of it stays');}
    await page.waitForSelector('[data-ce-usb-name="0"]');await page.waitForFunction(()=>document.querySelector('[data-ce-save]').disabled,null,{timeout:15000});

    // E. Camera, now the camera is in the configuration: its own Start, and the Debug tab's consent before anything is built.
    await page.waitForTimeout(300);await toCalibrate();await page.waitForFunction(()=>/Webcam 1/.test(document.querySelector('#cam-source').options[0].textContent));assert.match(await text('[data-cam-note]'),/Your robot has “Webcam 1”\. Start live debug to see it\./);
    assert.equal(await page.locator('[data-cam-start]').isVisible(),true);assert.equal(await page.locator('[data-cam-install]').isVisible(),true);assert.equal((await u()).starts,0,'nothing starts by itself');assert.equal((await u()).installs,0,'nothing builds by itself');
    await page.click('[data-cam-install]');const panel=page.locator('#cal-camera [data-debug-params]');await panel.waitFor();assert.match(await panel.innerText(),/Before it goes on the robot/);assert.match(await panel.innerText(),/Put it on the robot/);await page.screenshot({path:path.join(out,'camera-install.png')});assert.equal((await u()).installs,0,'opening it builds nothing');
    await panel.locator('[data-debug-cancel]').click();assert.equal(await page.locator('#cal-camera [data-debug-params]').count(),0,'Cancel puts it back');assert.equal((await u()).installs,0);
    await page.click('[data-cam-install]');await panel.locator('[data-debug-go]').click();for(let i=0;i<40&&!(await u()).installs;i++)await page.waitForTimeout(100);assert.equal((await u()).installs,1,'Put it on the robot builds it');await page.waitForFunction(()=>/is on the robot/.test(document.querySelector('[data-cam-link]').textContent));
    await page.click('[data-cam-start]');for(let i=0;i<40&&!(await u()).starts;i++)await page.waitForTimeout(100);assert.equal((await u()).starts,1,'the same routine as the Debug tab');await page.waitForFunction(()=>document.querySelector('[data-cam-start]').textContent==='Stop live debug');assert.match(await page.locator('[data-debug-start]').evaluate(b=>b.textContent),/Stop live debug/,'the Debug tab agrees');
    // Live: the robot's camera takes over the view, and its picture is asked for.
    const debugEvent=m=>app.evaluate(({BrowserWindow},m)=>BrowserWindow.getAllWindows()[0].webContents.send('robot-link-debug',m),m);
    await debugEvent({manifest:{cameras:['Webcam 1'],motors:[],servos:[],crservos:[],digital:[],touch:[],analog:[],i2c:[]}});await page.waitForFunction(()=>!document.querySelector('[data-cam-image]').hidden);
    assert.deepEqual(await source(),['Webcam 1']);assert.equal(await page.locator('[data-cam-canvas]').isVisible(),false);assert.equal(await page.locator('[data-cam-empty]').isVisible(),false);assert.match(await text('[data-cam-note]'),/Waiting for the camera/);assert.equal((await u()).streaming,true);assert.equal(await page.locator('[data-cam-tune]').isDisabled(),false,'it can tune now');
    await debugEvent({frame:{t:1,loop:5,v:12,cam:{state:'STREAMING',fps:30,tags:[{id:584,name:'Blue',r:12,b:1,m:50}],range:[1,100,0,255]}}});await page.waitForFunction(()=>/STREAMING/.test(document.querySelector('[data-cam-note]').textContent));assert.match(await text('[data-cam-tags]'),/Tag 584/);
    await page.click('[data-cam-start]');await page.waitForFunction(()=>document.querySelector('[data-cam-start]').textContent==='Start live debug');await page.waitForFunction(()=>document.querySelector('[data-cam-image]').hidden);assert.equal(await page.locator('[data-cam-empty]').isVisible(),true,'stopped: no picture, and still no simulated one');assert.match(await text('[data-cam-note]'),/Start live debug to see it/);assert.equal((await u()).streaming,false);

    // A camera in the configuration and not plugged in says so, in both places.
    await app.evaluate(()=>{global.__u.others=[];});await page.evaluate(()=>window.deck.page('setup'));await page.waitForFunction(()=>state.page==='setup');await page.evaluate(()=>document.querySelector('#rs-scan').click());
    await page.waitForFunction(()=>/in this configuration, not plugged in/.test(document.querySelector('.ce-main').textContent),null,{timeout:15000});await toCalibrate();await page.waitForFunction(()=>/not plugged in/.test(document.querySelector('#cam-source').textContent));assert.match(await text('[data-cam-note]'),/last scan did not find it/);

    // D. The Robot Controller restarts after a scan: Setup and Configure agree, and it looks again.
    await app.evaluate(({},cam)=>{global.__u.others=[cam];},CAM);await page.evaluate(()=>window.deck.page('setup'));await page.waitForFunction(()=>state.page==='setup');await page.evaluate(()=>document.querySelector('#rs-scan').click());await page.waitForFunction(()=>/Ucamera001/.test(document.querySelector('#rs-hubs').textContent),null,{timeout:15000});
    const both=()=>page.evaluate(()=>[/Ucamera001/.test(document.querySelector('#rs-hubs').textContent),/Ucamera001/.test(document.querySelector('.ce-main,.ce-hubs')?.textContent||'')]);await page.waitForFunction(()=>/Ucamera001/.test(document.querySelector('.ce-main').textContent),null,{timeout:15000});
    const before=(await u()).scans;await app.evaluate(()=>{global.__u.fail=1;});await page.evaluate(()=>document.querySelector('#rs-read').click());await page.waitForFunction(()=>/Ucamera001/.test(document.querySelector('.ce-main').textContent));for(let i=0;i<120&&(await u()).scans<=before;i++)await page.waitForTimeout(250);
    assert.ok((await u()).scans>before,'it scans again after the restart');assert.deepEqual(await both(),[true,true],'Setup and Configure agree');

    assert.deepEqual(errors,[]);console.log('USB camera: all passed');
  }finally{await app.close().catch(()=>{});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,1800));process.exit(1);});
