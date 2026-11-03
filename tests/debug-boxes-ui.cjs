'use strict';
// Calibrate → Debug's boxes in the real app on a stubbed robot: each kind of device has the control that fits it, is checked from its own box with its own settings, and STOP or Space stops everything.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/debug-boxes-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright'),root=path.join(__dirname,'..'),wait=ms=>new Promise(r=>setTimeout(r,ms)),SERIAL='24677c4269e7e709';
const soon=async(what,fn)=>{const end=Date.now()+10000;while(Date.now()<end){if(await fn().catch(()=>false))return;await wait(60);}throw Error('Not within 10 s: '+what);};
const XML=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<Robot type="FirstInspires-FTC">
    <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">
        <LynxModule name="Control Hub" port="173">
            <goBILDA5202SeriesMotor name="arm" port="0" />
            <goBILDA5202SeriesMotor name="lift" port="1" />
            <ContinuousRotationServo name="spinner" port="0" />
            <Servo name="claw" port="1" />
            <RevBlinkinLedDriver name="strip" port="2" />
            <RevSPARKMini name="spark" port="3" />
            <DigitalDevice name="beam" port="0" />
            <Led name="lamp" port="1" />
            <RevTouchSensor name="home" port="2" />
            <AnalogInput name="pot" port="0" />
            <ControlHubImuBHI260AP name="imu" port="0" bus="0" />
            <KauaiLabsNavxMicro name="navx" port="0" bus="3" />
        </LynxModule>
    </LynxUsbDevice>
</Robot>
`;
const MAN={deck:'debug',version:1,motors:['arm','lift'],servos:['claw'],crservos:['spinner','spark'],digital:['beam'],touch:['home'],cameras:[],lights:[{n:'lamp',k:'led'},{n:'strip',k:'blinkin'}],analog:[{n:'pot',max:3.3}],i2c:[{n:'imu',k:'imu',h:173,b:0,a:40},{n:'navx',k:'other',h:173,b:3,a:50}],hubs:[{n:'Control Hub',address:173,parent:true}]};
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-debug-boxes-')),env={...process.env,DECK_HEADLESS:'1',DECK_DATA_DIR:data,ADB:'C:\\Windows\\System32\\where.exe'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);await page.setViewportSize({width:1280,height:800});
    await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.webContents.setBackgroundThrottling(false);});
    await app.evaluate(({ipcMain},{xml,SERIAL})=>{const g=global;g.__sent=[];g.__installs=0;ipcMain.removeHandler('robot-link');ipcMain.handle('robot-link',async(e,action,d)=>{const ok=value=>({ok:true,value}),usb={serial:SERIAL,devices:[],addresses:[],at:1};
      if(action==='detect')return ok({usb:{found:true,serial:SERIAL},wifi:{robot:false}});if(action==='usb-status')return ok({found:true,serial:SERIAL});if(action==='usb-recover')return ok(null);
      if(action==='usb-watch')return ok({seq:1,at:Date.now(),usb:true,devices:[],hub:{serial:SERIAL,state:'device',model:null,vid:'2207',pid:'0011',usb:true},adb:{running:true,devices:[]},status:{found:true,serial:SERIAL},why:'+',drop:null,hubUsb:usb});
      if(action==='hub-usb')return ok(usb);if(action==='hub-usb-drops')return ok([]);if(action==='limelight')return ok({status:null});if(action==='hub-rc-up')return ok(true);
      if(action==='read-usb')return ok({serial:SERIAL,active:{name:'robot'},configurations:['robot'],files:{robot:xml}});if(action==='check')return ok([{name:'Robot Controller app',ok:true,detail:'FTC SDK 12.0'}]);
      if(action==='scan')return ok({portals:[{serial:'(embedded)',modules:[{address:173,parent:true,imu:'BHI260'}],servoHubs:[]}],others:[]});
      if(action==='debug-send'){g.__sent.push(d.line);return ok(true);}if(action==='debug-install'){g.__installs++;return ok({opMode:'TorqueDebug-x'});}if(action==='debug-current')return ok({current:true,opMode:'TorqueDebug-x'});
      if(action==='debug-start'||action==='debug-stop'||action==='debug-claim')return ok(true);return {ok:false,error:'not in this test: '+action};});},{xml:XML,SERIAL});
    await page.evaluate(()=>window.deck.page('setup'));await page.waitForFunction(()=>state.page==='setup');await page.waitForFunction(()=>document.querySelectorAll('#rs-configs .rs-config').length===1);await wait(800);
    await page.evaluate(()=>window.deck.page('calibrate'));await page.waitForFunction(()=>state.page==='calibrate');await page.click('#cal-tab-debug');
    const send=m=>app.evaluate(({BrowserWindow},x)=>{for(const w of BrowserWindow.getAllWindows())w.webContents.send('robot-link-debug',x);},m),sent=()=>app.evaluate(()=>global.__sent.filter(l=>l!=='P')),clear=()=>app.evaluate(()=>{global.__sent.length=0;});
    const box=name=>page.locator(`#cal-debug [data-port$=":${name}"]`);
    // Over the cable the tab starts it by itself.
    await soon('it starts with nothing pressed',async()=>/Stop live debug/.test(await page.textContent('[data-debug-start]')));
    // Stopped here it stays stopped, while this tab shows.
    await page.click('[data-debug-start]');await soon('stopped',async()=>/Start live debug/.test(await page.textContent('[data-debug-start]')));await wait(3500);assert.match(await page.textContent('[data-debug-start]'),/Start live debug/,'nothing starts it again');
    // Nothing to set before it goes on: the button builds.
    await page.click('[data-debug-install]');await soon('it builds at once',async()=>await app.evaluate(()=>global.__installs)===1);assert.equal(await page.locator('[data-debug-params],[data-debug-go]').count(),0);
    await page.click('[data-debug-start]');await soon('running',async()=>/Stop live debug/.test(await page.textContent('[data-debug-start]')));await send({manifest:MAN});await page.waitForSelector('#cal-debug [data-port="motor:arm"]');
    let t=0,run=true,lights=[0,0];(async()=>{while(run){await send({frame:{t:t+=40,loop:6,v:13,m:[[0,0,0,0,0],[0,0,0,0,0]],s:[[NaN,0,0]],c:[0,0],d:[1],touch:[0],l:lights,a:[1.5],i:[{age:10,v:{yaw:1,pitch:2,roll:3,wx:4,wy:5,wz:6}},{age:null,v:null}],on:[1,0],b:[{h:173,swept:true,found:[[40],[],[],[]],a:[1.5,0,0,0]}]}}).catch(()=>{});await wait(40);}})();
    await soon('frames drawn',async()=>/robot clock/.test(await page.textContent('[data-debug-stats]')));
    // ---- the top of the tab, in the order they are used, USB devices under everything, and only the simulated-webcam link below them
    {const order=await page.evaluate(()=>{const at=s=>document.querySelector(s).getBoundingClientRect().top;return ['[data-debug-install]','[data-check-all]','[data-debug-hubs]','[data-debug-tools]','[data-debug-usb]'].map(at);});assert.deepEqual(order,[...order].sort((a,b)=>a-b),'install, check, the boxes, the timeline, USB devices');assert.deepEqual(await page.evaluate(()=>{const last=document.querySelector('#cal-debug').lastElementChild;return [last.id,last.previousElementSibling.dataset.debugUsb];}),['cal-sim-cam','']);assert.equal(await page.locator('[data-check-stop],[data-check-rows]').count(),0,'one stop, and no list of checks');}
    // ---- the battery and STOP follow down the page, and the three are one size and shape
    {const bar=page.locator('.cal-debug-run'),shape=()=>page.evaluate(()=>['[data-port="power:battery"]','[data-check-all]','[data-debug-stopall]'].map(s=>{const el=document.querySelector(s),r=el.getBoundingClientRect(),c=getComputedStyle(el);return [Math.round(r.width),Math.round(r.height),c.borderTopLeftRadius];}));const [a,b,c]=await shape();assert.deepEqual(b,a);assert.deepEqual(c,a);
      await page.locator('#cal-debug [data-bus="control:3"]').scrollIntoViewIfNeeded();await wait(150);const top=(await bar.boundingBox()).y;await page.locator('#cal-debug [data-debug-tools]').scrollIntoViewIfNeeded();await wait(150);const still=(await bar.boundingBox()).y;assert.equal(still,top,'it stays');const header=await page.evaluate(()=>document.querySelector('body>header').getBoundingClientRect().bottom);assert.ok(still>=header-1,`under the header: ${still} against ${header}`);assert.ok(await page.evaluate(()=>{const r=document.querySelector('[data-debug-stopall]').getBoundingClientRect(),el=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!el?.closest('[data-debug-stopall]');}),'nothing covers STOP');
      const heads=await page.$$eval('#cal-debug .cal-port-group>h4',l=>l.map(x=>x.textContent));assert.deepEqual(heads,['Motors','Servo ports','Digital','Analog','I2C buses']);await page.locator('#cal-debug [data-debug-install]').scrollIntoViewIfNeeded();}
    // ---- each device has the control that fits it
    const has=async(name,s)=>box(name).locator(s).count();
    for(const name of ['arm','spinner','spark'])assert.equal(await has(name,'.cal-spin input[type=range][data-hold]'),1,name+' spins: a slider');
    assert.equal(await has('claw','.cal-spin'),0,'a positional servo has no slider');assert.equal(await has('claw','[role=slider][data-dial]'),1,'it has a dial');
    for(const name of ['lamp','strip']){assert.equal(await has(name,'[role=switch][data-light]'),1,name+' is a light: a switch');assert.equal(await has(name,'[data-check-one]'),0,'the switch is its check');assert.equal(await has(name,'.cal-spin,[data-dial]'),0);}
    for(const name of ['beam','home','pot']){assert.equal(await has(name,'[data-check-one]'),1,name+' is checked from its box');assert.equal(await has(name,'[data-set]'),0,'with nothing to set');}
    assert.match(await box('spark').innerText(),/REV SPARK Mini/);
    await soon('the IMU reads',async()=>/imu[\s\S]*Connected[\s\S]*Yaw °\s+1\.00[\s\S]*Roll °\s+3\.00[\s\S]*Turn Z °\/s\s+6\.00/.test(await page.locator('#cal-debug [data-bus="control:0"]').innerText()));await soon('the battery reads',async()=>/Battery[\s\S]*13\.00 V/.test(await page.locator('#cal-debug [data-port="power:battery"]').innerText()));assert.match(await box('beam').locator('.cal-lamp').innerText(),/^HIGH · on$/);assert.match(await box('home').locator('.cal-lamp').innerText(),/^HIGH · released$/);assert.match(await box('pot').innerText(),/Volts\s+1\.500[\s\S]*Range seen\s+1\.50–1\.50 V[\s\S]*Full range\s+0–3\.30 V/);assert.match(await page.locator('#cal-debug [data-bus="control:3"]').innerText(),/navx[\s\S]*Not answering/);assert.match(await page.locator('#cal-debug [data-bus="control:1"]').innerText(),/Bus 1\s+Nothing configured/);
    // ---- a slider: held it runs, let go it goes back to 0
    {const s=box('arm').locator('[data-hold]'),b=await (await s.scrollIntoViewIfNeeded(),s.boundingBox());await clear();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width*.9,b.y+b.height/2,{steps:3});await wait(250);assert.ok((await sent()).some(l=>/^M\tarm\t0\.[5-9]/.test(l)),'forward');assert.match(await box('arm').locator('.cal-spin output').innerText(),/^[5-9]\d%$/);await page.mouse.up();await soon('sent 0',async()=>(await sent()).at(-1)==='M\tarm\t0');await soon('back at 0',async()=>await s.inputValue()==='0');
      await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width*.1,b.y+b.height/2,{steps:3});await wait(150);assert.ok((await sent()).some(l=>/^M\tarm\t-0\.[5-9]/.test(l)),'reverse');await page.mouse.up();}
    // ---- a dial: it turns, to the angle the pointer is at, and the number goes to one angle
    {const dial=page.locator('[data-dial="claw"]');await dial.scrollIntoViewIfNeeded();assert.equal(await dial.getAttribute('data-unset'),'','nothing told yet');const b=await dial.boundingBox(),cx=b.x+b.width/2,cy=b.y+b.height/2;await clear();await page.mouse.move(cx,cy-b.height*.4);await page.mouse.down();await wait(50);assert.equal(await dial.getAttribute('aria-valuenow'),'135','straight up is the middle of 270°');
      await page.mouse.move(cx+b.width*.4,cy,{steps:3});await page.mouse.up();await wait(80);assert.equal(await dial.getAttribute('aria-valuenow'),'225','a quarter turn on');assert.equal((await sent()).at(-1),'S\tclaw\t0.833');assert.match(await dial.locator('output').innerText(),/^225°$/);assert.match(await dial.locator('.cal-dial-knob').getAttribute('transform'),/^rotate\(90\.0 /,'the knob turned');assert.equal(await box('claw').locator('[data-enable]').isChecked(),true,'it holds there');
      await page.mouse.move(cx,cy+b.height*.4);await page.mouse.down();await wait(50);await page.mouse.up();assert.ok(+await dial.getAttribute('aria-valuenow')===0||+await dial.getAttribute('aria-valuenow')===270,'the gap at the bottom goes to an end');
      await box('claw').locator('[data-servo-deg]').fill('90');await box('claw').locator('[data-servo-deg]').dispatchEvent('change');assert.equal((await sent()).at(-1),'S\tclaw\t0.333');assert.equal(await dial.getAttribute('aria-valuenow'),'90');
      await dial.focus();await page.keyboard.press('ArrowRight');assert.equal(await dial.getAttribute('aria-valuenow'),'91');
      await box('claw').locator('[data-set=range]').selectOption('180');const again=page.locator('[data-dial="claw"]');assert.equal(await again.getAttribute('data-range'),'180');assert.equal(await box('claw').locator('[data-servo-deg]').getAttribute('max'),'180');assert.ok((await box('claw').locator('[data-set=a] option').allTextContents()).includes('180°'));assert.ok(!(await box('claw').locator('[data-set=a] option').allTextContents()).includes('185°'));await box('claw').locator('[data-set=range]').selectOption('270');}
    // ---- a light: on and off
    await box('lamp').locator('[data-light]').scrollIntoViewIfNeeded();await clear();await box('lamp').locator('[data-light]').click();assert.equal((await sent()).at(-1),'G\tlamp\t1');lights=[1,0];await soon('it says on',async()=>await box('lamp').locator('[data-light]').getAttribute('aria-checked')==='true'&&/On/.test(await box('lamp').locator('[data-light]').innerText()));await box('lamp').locator('[data-light]').click();assert.equal((await sent()).at(-1),'G\tlamp\t0');lights=[0,0];
    // ---- each device is checked with its own settings, kept by its name, and answers on its own box
    await box('lift').locator('[data-set=speed]').scrollIntoViewIfNeeded();await box('lift').locator('[data-set=speed]').selectOption('35');assert.equal(await box('arm').locator('[data-set=speed]').inputValue(),'20','the other motor keeps its own');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('torque-debug-devices')).lift.speed),35);
    await box('lift').locator('[data-set=speed]').selectOption('60');assert.match(await box('lift').innerText(),/Not recommended/);assert.doesNotMatch(await box('arm').innerText(),/Not recommended/);await box('lift').locator('[data-set=speed]').selectOption('35');
    await clear();await box('lift').locator('[data-check-one]').click();await soon('forward at its speed',async()=>(await sent()).includes('M\tlift\t0.350'));assert.equal(await box('lift').getAttribute('data-check-state'),'running');assert.match(await box('lift').locator('[data-check-text]').innerText(),/Running forward at 35%/);assert.equal(await box('arm').locator('[data-check-one]').isDisabled(),true,'one at a time');assert.equal(await page.locator('[data-check-all]').isDisabled(),true);
    await soon('backward',async()=>(await sent()).includes('M\tlift\t-0.350'));await soon('it asks on its box',async()=>await box('lift').locator('[data-check-answer]').count()===2);assert.match(await box('lift').locator('[data-check-text]').innerText(),/Did the motor turn/);await box('lift').locator('[data-check-answer=no]').click();await soon('the answer',async()=>await box('lift').getAttribute('data-check-state')==='fail');assert.match(await box('lift').locator('[data-check-text]').innerText(),/It did not turn/);
    await box('claw').locator('[data-set=a]').selectOption('10');await box('claw').locator('[data-set=b]').selectOption('15');assert.match(await box('claw').innerText(),/at least 20° apart/);assert.equal(await box('claw').locator('[data-check-one]').isDisabled(),true,'too close to check');await box('claw').locator('[data-set=b]').selectOption('100');assert.equal(await box('claw').locator('[data-check-one]').isDisabled(),false);
    await clear();await box('claw').locator('[data-check-one]').click();await soon('to its first angle',async()=>(await sent()).some(l=>l==='S\tclaw\t'+(10/270).toFixed(3)));
    // ---- Space stops it, wherever the focus is
    await page.locator('[data-debug-stopall]').focus();await clear();await page.keyboard.press('Space');await soon('stopped',async()=>(await sent()).includes('X'));assert.match(await box('claw').locator('[data-check-text]').innerText(),/Stopped/);assert.equal(await box('claw').locator('[data-enable]').isChecked(),false);await wait(1200);assert.equal((await sent()).filter(l=>l==='X').length,1,'once, and the button under the focus did not press itself as well');assert.ok(!(await sent()).some(l=>/^S\tclaw/.test(l)),'and the check does not go on');
    // ---- the big button does the same
    await box('arm').locator('[data-check-one]').click();await soon('going',async()=>(await sent()).some(l=>/^M\tarm\t0\.200/.test(l)));await clear();await page.click('[data-debug-stopall]');await soon('stopped',async()=>(await sent()).includes('X'));assert.equal(await box('arm').getAttribute('data-check-state'),'idle');
    // ---- stopped, the buses do not claim to be checking
    run=false;await wait(100);await send({ended:'stopped'});await soon('it says to start it',async()=>await page.locator('#cal-debug [data-live="ib:imu"]').innerText()==='Start live debug to check');assert.equal(await page.locator('#cal-debug [data-live="ib:navx"]').getAttribute('class'),'rs-pill');assert.equal(await page.locator('#cal-debug [data-live="il:imu"]').isHidden(),true);assert.equal(await page.locator('#cal-debug [data-debug-hubs]').getAttribute('data-idle'),'');assert.equal(await page.locator('[data-debug-stopall]').isDisabled(),true);
    await clear();await page.keyboard.press('Space');await wait(100);assert.deepEqual(await sent(),[],'Space does nothing with nothing running');
    // ---- settings stay when it starts again, and so does how each check went: a stopped one is not kept
    await send({manifest:MAN});await page.waitForSelector('#cal-debug [data-port="motor:lift"]');assert.equal(await box('lift').locator('[data-set=speed]').inputValue(),'35');assert.equal(await box('claw').locator('[data-set=a]').inputValue(),'10');assert.equal(await page.locator('#cal-debug [data-live="ib:imu"]').innerText(),'Checking…','asked again, not yet answered');
    assert.equal(await box('lift').getAttribute('data-check-state'),'fail','its answer stays');assert.equal(await box('claw').getAttribute('data-check-state'),'idle');assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('torque-debug-checks')).map(([n,c])=>[n,c.state])),[['lift','fail']]);
    assert.deepEqual(errors,[]);console.log('Debug boxes: all passed');
  }finally{await app.close().catch(()=>{});fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,2400));process.exit(1);});
