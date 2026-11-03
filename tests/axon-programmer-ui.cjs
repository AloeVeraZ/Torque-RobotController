'use strict';
// The Axon Programmer tab in the real app, against a simulated V2 programmer: the real main-process logic runs, only USB is stubbed.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/axon-programmer-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-axon-'));fs.writeFileSync(path.join(data,'axon-keys.json'),JSON.stringify(require('./fixtures/axon-sim.cjs').TEST_KEYS));const env={...process.env,DECK_HEADLESS:'1',DECK_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1280,height:800});
    await page.waitForFunction(()=>typeof state==='object');
    // Everything real but the USB: a programmer with no servo in it yet, and Axon Bridge open. The Control Hub's USB watch is counted.
    await app.evaluate(({ipcMain},{root,data})=>{const req=process.mainModule.require,A=req(root+'/src/axon-programmer.cjs'),Sim=req(root+'/tests/fixtures/axon-sim.cjs'),path=req('node:path');
      const link=new Sim.SimLink('v2','servo','MAXMK2',{attached:false,inputPulse:1500}),transport=Sim.simTransport(link);transport.rivalTitles=['Axon Bridge'];transport.plugged=false;
      const firmwareDir=path.join(data,'sim-firmware');A.overrides.catalog=Sim.installFirmware(firmwareDir);A.overrides.firmwareDir=firmwareDir;A.overrides.transport=transport;A.overrides.findSoftware=()=>global.__axon.software;global.__axon={software:{v1:{found:true,fileName:'Axon_Servo_Programming_Software_v1.0.5.exe',path:'C:/a.exe'},v2:{found:true,fileName:'Axon_Software_MK2_v1.1.2.exe',path:'C:/b.exe'}},link,transport,Sim,firmwareDir,DeviceLost:req(root+'/src/axon-servo.cjs').DeviceLost,detects:0};
      ipcMain.removeHandler('robot-link');ipcMain.handle('robot-link',async(e,action)=>{if(action==='detect'){global.__axon.detects++;return {ok:true,value:{usb:{found:false,message:'Not plugged in.'},wifi:{robot:false}}};}if(action==='usb-status')return {ok:true,value:{found:false}};return {ok:false,error:'not in this test: '+action};});},{root,data});
    const sim=fn=>app.evaluate(fn),banner=()=>page.locator('#axon-banner').textContent(),until=(re,opts)=>page.waitForFunction(s=>new RegExp(s).test(document.querySelector('#axon-banner').textContent),re.source,opts);
    const keys=()=>page.$$eval('[data-axon-field]',r=>r.map(x=>x.dataset.axonField));
    const asked=async text=>{await page.waitForSelector('#axon-ask[open]');assert.match(await page.locator('#axon-ask').textContent(),text);};

    await page.click('#robot-setup-tab');await page.waitForSelector('#setup-view:not([hidden])');
    // A fourth tab, all the way to the right and apart from the three steps, and nothing of it left in Calibrate.
    {const tabs=await page.$$eval('#setup-view .flow-steps [data-flow]',b=>b.map(x=>x.dataset.flow));assert.deepEqual(tabs,['setup','configure','calibrate','axon']);
      const geo=await page.evaluate(()=>{const rail=document.querySelector('#setup-view .flow-steps'),t=rail.querySelector('[data-flow=axon]'),c=rail.querySelector('[data-flow=calibrate]');return {gap:t.getBoundingClientRect().left-c.getBoundingClientRect().right,edge:rail.getBoundingClientRect().right-t.getBoundingClientRect().right,arrows:rail.querySelectorAll('.flow-arrow').length,number:t.querySelector('.flow-num')?.textContent,isNew:t.querySelector('.flow-new')?.textContent,same:getComputedStyle(t.querySelector('.flow-num')).width===getComputedStyle(c.querySelector('.flow-num')).width,fits:rail.scrollWidth<=rail.clientWidth,before:t.previousElementSibling.tagName};});
      assert.ok(geo.gap>300,`it sits apart from the three steps: ${geo.gap}`);assert.ok(geo.edge<=1,'it is all the way to the right');assert.equal(geo.arrows,2,'no arrow joins it');assert.equal(geo.number,'4','a circled 4');assert.equal(geo.same,true,'like the other steps’ circles');assert.equal(geo.isNew,'New');assert.equal(geo.fits,true,'tidy at this size');assert.equal(geo.before,'BUTTON');}
    assert.equal(await page.locator('#cal-tab-axon').count(),0);assert.deepEqual(await page.$$eval('[data-cal-tab]',b=>b.map(x=>x.dataset.calTab)),['electronics','mechanisms']);
    assert.equal(await sim(()=>global.__axon.transport.opened),0,'nothing touches USB before it opens');
    // It opens directly, from either view's row of steps, and says up front what is needed.
    await page.click('#setup-view [data-flow=calibrate]');await page.waitForSelector('#calibrate-view:not([hidden])');await page.click('#calibrate-view [data-flow=axon]');await page.waitForSelector('#setup-view:not([hidden]) #rs-step-axon:not([hidden])');
    assert.equal(await page.getAttribute('#setup-view [data-flow=axon]','data-here'),'');assert.equal(await page.locator('#axon-open').count(),0,'no button in front of it');
    await page.waitForFunction(()=>/Simple is what every student needs/.test(document.querySelector('#axon-hint').textContent));
    // The response graph with nothing plugged in: the real range and the factory value, and nothing to apply.
    {await page.click('[data-view=graph]');await page.waitForSelector('#axon-try-graph svg');const damp=page.locator('#axon-try-damping'),facts=()=>page.locator('#axon-try-facts').textContent(),graph=()=>page.locator('#axon-try-graph').textContent();
      assert.deepEqual([await damp.getAttribute('min'),await damp.getAttribute('max'),await damp.inputValue()],['50','600','85'],'V1 MAX\'s real Damping');assert.match(await page.locator('#axon-tag').textContent(),/Nothing here is written to the servo/);assert.match(await page.locator('#axon-settings-title').textContent(),/Response graph/);assert.match(await page.locator('#axon-hint').textContent(),/not a measurement/);
      assert.match(await graph(),/Target 45°/);assert.match(await facts(),/Settling time \(±2°\)/);const was=await page.locator('#axon-try-graph').innerHTML();
      await page.fill('#axon-try-damping','50');await page.selectOption('#axon-try-load','3');assert.notEqual(await page.locator('#axon-try-graph').innerHTML(),was,'the wave follows the sliders');assert.match(await graph(),/Overshoot \+/);assert.match(await graph(),/Undershoot −/);assert.match(await facts(),/past the target/);
      await page.selectOption('#axon-try-tol','10');assert.match(await facts(),/Settling time \(±10°\)/);assert.match(await graph(),/Inside ±10°/);
      await page.selectOption('#axon-try-load','0');await page.click('[data-axon-try-set=high]');assert.equal(await damp.inputValue(),'255','three times the factory value');assert.match(await facts(),/OvershootNone/);await page.selectOption('#axon-try-sens','3');await page.selectOption('#axon-try-tol','0.5');assert.match(await facts(),/Never/,'it rests outside a tolerance tighter than Sensitivity');
      await page.click('[data-axon-try-set=factory]');assert.equal(await damp.inputValue(),'85');assert.equal(await page.locator('[data-axon-try-set=servo]').count(),0,'no servo to go back to');assert.equal(await page.isDisabled('#axon-apply'),true,'nothing to apply');
      const m=await page.evaluate(()=>{const v=document.querySelector('#setup-view'),b=document.querySelector('.axon-settings-body');return [document.scrollingElement.scrollHeight-innerHeight,v.scrollHeight-v.clientHeight,b.scrollHeight-b.clientHeight];});assert.deepEqual(m.map(x=>x<=0),[true,true,true],`it all fits at 1280x800: ${m}`);
      await page.selectOption('#axon-try-tol','2');await page.selectOption('#axon-try-load','2');await page.click('[data-view=settings]');await page.waitForSelector('[data-axon-field=pwm] .axon-slider');await page.mouse.move(2,2);}
    // Axon's own program is never needed: with neither on this computer, the settings are all there and nothing is locked.
    {await app.evaluate(({shell})=>{shell.openPath=async f=>{global.__axon.ran=f;return '';};});const had=await sim(()=>global.__axon.software);await sim(()=>{global.__axon.software={v1:{found:false},v2:{found:false}};});await page.waitForTimeout(3500);
      assert.equal(await page.locator('.axon-gate').count(),0);await page.waitForSelector('#axon-f-angle');assert.match(await page.locator('#axon-model-max1').textContent(),/sold as MAX\+/);assert.doesNotMatch(await banner(),/Download Axon/);
      await page.click('#axon-model-max2');await page.waitForSelector('#axon-f-left');await page.click('#axon-model-max1');await page.waitForSelector('#axon-f-angle');await app.evaluate((x,h)=>{global.__axon.software=h;},had);}
    // Advanced shows every setting at once on both families, with nothing scrolling and no row of choices wrapping.
    {const fits=async name=>{const m=await page.evaluate(()=>{const b=document.querySelector('.axon-settings-body'),rows=c=>[...c.querySelectorAll('.axon-row')].length,cols=[...b.querySelectorAll('.axon-column')];return {over:b.scrollHeight-b.clientHeight,wrapped:[...b.querySelectorAll('.axon-seg')].filter(s=>new Set([...s.children].map(c=>c.offsetTop)).size>1).length,apart:Math.abs(rows(cols[0])-rows(cols[1]))};});assert.deepEqual([m.over<=0,m.wrapped],[true,0],`${name}: ${JSON.stringify(m)}`);assert.ok(m.apart<=1,`${name} is split evenly: ${m.apart}`);};
      await page.click('#axon-level');await page.waitForSelector('[data-axon-seg=range]');await fits('V1 advanced');await page.click('#axon-model-max2');await page.waitForSelector('[data-axon-seg=signal]');await fits('V2 advanced');
      await page.setViewportSize({width:1280,height:720});await page.waitForTimeout(150);await fits('V2 at 720');await page.click('#axon-model-max1');await page.waitForSelector('[data-axon-seg=range]');await fits('V1 at 720');await page.setViewportSize({width:1280,height:800});await page.click('#axon-level');await page.waitForSelector('#axon-f-angle');}
    // It rests the Control Hub's USB watch while it shows.
    {const a=await sim(()=>global.__axon.detects);await page.waitForTimeout(3500);assert.equal(await sim(()=>global.__axon.detects),a);}
    // A rival app: it waits, says so and can ask it to close.
    await until(/Axon Bridge is open/);assert.equal(await sim(()=>global.__axon.transport.opened),0,'it leaves the programmer to the other app');await page.click('#axon-close-rivals');
    await until(/Plug in the V2 programmer/);
    // Nothing plugged in: factory values of the model picked, greyed out, as Axon Bridge shows them.
    await page.waitForSelector('#axon-f-angle');assert.match(await page.locator('#axon-tag').textContent(),/Factory values/);assert.equal(await page.isDisabled('#axon-f-pwm'),true);
    await page.click('#axon-model-max2');await page.waitForSelector('#axon-f-left');assert.equal(await page.inputValue('#axon-f-left'),'250');await page.click('#axon-mode-cr');await page.waitForFunction(()=>/V2 continuous rotation/.test(document.querySelector('#axon-settings-title').textContent));assert.equal(await page.locator('[data-view=graph]').count(),0,'the graph is for servo mode');await page.click('#axon-mode-servo');
    // Plug in the programmer: it reports it, and asks for a servo.
    await sim(()=>{global.__axon.transport.plugged=true;});
    await until(/Plug a servo into the V2 programmer/);assert.match(await page.locator('#axon-chips').textContent(),/V2 programmer/);await page.waitForFunction(()=>/5\.0 V/.test(document.querySelector('#axon-chips').textContent));
    assert.match(await page.locator('#axon-report').textContent(),/5\.\d+ V/);
    // Plug in a servo: it is read by itself, and what it reports shows.
    await sim(()=>{global.__axon.link.attached=true;});
    await until(/V2 MAX is ready/);await page.waitForSelector('#axon-f-pwm:not([disabled])');
    {const t=await page.locator('#axon-report').textContent();assert.match(t,/MAXMK2/);assert.match(t,/Servo mode/i);assert.doesNotMatch(t,/AISV112205|2025\/03\/12|V2 servo through V2 programmer|Simulated V2 programmer/,'Advanced has the rest');}
    assert.match(await page.locator('#axon-model-max2').textContent(),/Plugged in/);assert.equal(await page.isDisabled('#axon-model-max1'),true,'the wrong model cannot be picked');assert.match(await page.locator('#axon-mode-servo').textContent(),/Now/);assert.match(await page.locator('#axon-tag').textContent(),/Live values/);
    // Laid out like Axon Bridge, all at once: the whole tab fits 1280x800 without the page or its panels scrolling.
    {const m=await page.evaluate(()=>{const r=q=>document.querySelector(q).getBoundingClientRect(),v=document.querySelector('#setup-view'),s=document.querySelector('.axon-settings-body');return {page:document.scrollingElement.scrollHeight-innerHeight,view:v.scrollHeight-v.clientHeight,settings:s.scrollHeight-s.clientHeight,top:r('.axon-top'),cards:r('#axon-models'),modes:r('#axon-modes'),panel:r('.axon-settings'),side:r('.axon-side'),actions:r('.axon-actions'),bar:r('.axon-bar'),apply:r('#axon-apply')};});
      assert.ok(m.page<=0&&m.view<=0,`the page does not scroll: ${m.page} ${m.view}`);assert.ok(m.settings<=0,`every setting shows at once: ${m.settings}`);
      assert.ok(m.top.bottom<=m.cards.top&&m.cards.bottom<=m.panel.top&&m.panel.bottom<=m.bar.top&&m.bar.bottom<=800,'top, cards, settings, then the bar');assert.ok(m.cards.right<=m.modes.left,'mode sits beside the servo');assert.ok(m.panel.right<=m.side.left,'what it reports sits beside the settings');assert.ok(m.apply.right>m.bar.right-2,'Apply is at the bottom right');}
    // Simple: the basics every student knows. Every setting has a short note, and a fuller one when pointed at.
    {assert.deepEqual(await keys(),['left','right','neutral','pwm','inversion']);assert.equal(await page.locator('#axon-open-file').isVisible(),false,'settings files are Advanced');assert.equal(await page.locator('#axon-save-file').isVisible(),false);assert.equal(await page.locator('#axon-defaults').isVisible(),true);
      assert.equal(await page.$$eval('[data-axon-field] small',s=>s.filter(x=>x.textContent.trim().length<8).length),0,'every setting has a note beside it');
      assert.equal(await page.$$eval('[data-axon-field] small',s=>s.filter(x=>x.scrollWidth>x.clientWidth).length),0,'and every note fits');
      assert.deepEqual(await page.$$eval('.axon-seg',g=>g.flatMap(s=>[...s.children].filter(b=>b.scrollWidth>b.clientWidth+1||b.getBoundingClientRect().right>s.getBoundingClientRect().right+1).map(b=>b.textContent))),[],'no choice runs into the next');
      await page.hover('[data-axon-field=pwm] small');await page.waitForFunction(()=>/Axon suggests about 66%/.test(document.querySelector('#axon-hint').textContent));await page.hover('#axon-report');await page.waitForFunction(()=>/Simple is what every student needs/.test(document.querySelector('#axon-hint').textContent));
      assert.equal(await page.locator('#axon-recover-go').isVisible(),false,'Recover is Advanced');assert.equal(await page.locator('[style]').evaluateAll(e=>e.filter(x=>x.closest('#rs-step-axon')&&x.getAttribute('style')&&!/^--fill:/.test(x.getAttribute('style'))).length),0,'no inline styles');}
    // Change settings like Axon Bridge's rows: slider, minus and plus, a pick-one and a switch. Nothing is sent until applied.
    const frames=await sim(()=>global.__axon.link.writeFrames);
    assert.equal(await page.inputValue('#axon-f-pwm'),'255');await page.fill('#axon-f-pwm','168');await page.fill('#axon-f-left','200');
    await page.click('[data-for=axon-f-left][data-axon-nudge="1"]');assert.equal(await page.locator('#axon-v-left').textContent(),'201');assert.equal(await page.inputValue('#axon-f-left'),'201');await page.click('[data-for=axon-f-left][data-axon-nudge="-1"]');assert.equal(await page.inputValue('#axon-f-left'),'200');assert.equal(await page.locator('#axon-v-pwm').textContent(),'66%');
    assert.equal(await page.locator('[data-axon-field=pwm] [data-axon-mark]').isVisible(),true,'a dot marks the change');assert.equal(await page.locator('[data-axon-field=right] [data-axon-mark]').isVisible(),false);
    await page.click('[data-axon-field=inversion] .axon-toggle');assert.match(await page.locator('[data-axon-field=inversion] .axon-toggle').textContent(),/On/);assert.match(await page.locator('#axon-apply').textContent(),/Apply 3 changes/);await page.click('[data-axon-field=inversion] .axon-toggle');
    assert.match(await page.locator('#axon-apply').textContent(),/Apply 2 changes/);assert.match(await banner(),/Ready to write 2 changes/);assert.equal(await sim(()=>global.__axon.link.writeFrames),frames,'nothing sent yet');
    await page.waitForTimeout(1200);assert.equal(await page.inputValue('#axon-f-pwm'),'168','polling leaves the student\'s choice alone');
    await page.click('#axon-apply');
    // Confirm: what the servo reports back, after a real read-back.
    await until(/Confirmed/);assert.match(await banner(),/Written, read back and confirmed/);
    {const t=await page.locator('#axon-result').textContent();assert.match(t,/PWM Power66%66%Yes/);assert.match(t,/Left Range200200Yes/);}
    assert.deepEqual(await sim(()=>{const b=global.__axon.link.block;return [b[6],b[9]];}),[168,200]);assert.equal(await page.locator('[data-axon-field=pwm] [data-axon-mark]').isVisible(),false,'the dot clears');assert.equal(await page.isDisabled('#axon-apply'),true);
    // A servo that does not keep a value is called out, with what it really holds, and Apply stays to try again.
    await sim(()=>{global.__axon.link.writesIgnored=true;});await page.fill('#axon-f-pwm','191');await page.click('#axon-apply');
    await until(/It did not take/);assert.match(await page.locator('#axon-result').textContent(),/PWM Power75%66%No/);assert.equal(await page.isDisabled('#axon-apply'),false);await sim(()=>{global.__axon.link.writesIgnored=false;});await page.click('#axon-discard');assert.equal(await page.inputValue('#axon-f-pwm'),'168');
    // Advanced is one button. It adds factory values and all that is reported, and offers no write to the hidden tuning.
    await page.click('#axon-level');await page.waitForFunction(()=>/Back to Simple/.test(document.querySelector('#axon-level').textContent));
    {const t=await page.locator('#axon-report').textContent();assert.match(t,/AISV112205/);assert.match(t,/2025\/03\/12/);assert.match(t,/V2 servo through V2 programmer/);assert.match(t,/Simulated V2 programmer/);assert.match(t,/1500 µs, 50 Hz/);
      const k=await keys();for(const key of ['left','right','neutral','signal','pwm','damping','sens','softstart','lostppm','inversion','beep','name','ol1t','ol1p','ol3p'])assert.ok(k.includes(key),key);assert.ok(!k.includes('sysamp')&&!k.includes('minpower'),'hidden tuning is not offered');assert.equal(await page.locator('#axon-open-file').isVisible(),true);
      assert.deepEqual(await page.$$eval('.axon-seg',g=>g.flatMap(s=>[...s.children].filter(b=>b.scrollWidth>b.clientWidth+1||b.getBoundingClientRect().right>s.getBoundingClientRect().right+1).map(b=>b.textContent))),[],'no choice runs into the next');
      await page.click('[data-axon-seg=sens][data-value="3"]');assert.equal(await page.getAttribute('[data-axon-seg=sens][data-value="3"]','aria-pressed'),'true');assert.match(await page.locator('#axon-apply').textContent(),/Apply 1 change/);await page.click('#axon-discard');await page.waitForFunction(()=>/^Apply$/.test(document.querySelector('#axon-apply').textContent));}
    {const more=await page.locator('#axon-more').textContent();assert.match(more,/SysAmp: 40/);assert.match(more,/MinPower: 20/);assert.match(more,/Every settings byte/);assert.match(more,/Different from Axon's factory values/);assert.match(await page.locator('#axon-report').textContent(),/Handshake reply/);assert.match(await page.locator('#axon-advanced').textContent(),/What Advanced will not change/);
      assert.match(await page.locator('[data-axon-field=pwm] small').textContent(),/Factory: 100%/);assert.ok(!(await keys()).includes('sysamp'));assert.equal(await page.locator('#axon-recover-go').isVisible(),true);assert.equal(await page.isDisabled('#axon-recover-go'),true,'not with a servo showing');}
    await page.click('#axon-usb summary');await page.waitForFunction(()=>/TX 04 CB/.test(document.querySelector('#axon-usb-log').textContent));
    {const m=await page.evaluate(()=>[document.scrollingElement.scrollHeight-innerHeight,document.querySelector('#setup-view').scrollHeight-document.querySelector('#setup-view').clientHeight]);assert.deepEqual(m.map(x=>x<=0),[true,true],'all of that scrolls in its own panel, not the page');}
    await page.click('#axon-level');
    // With a servo, the graph starts at its values, and moving them sends nothing.
    {await page.click('[data-view=graph]');await page.waitForSelector('#axon-try-graph svg');assert.equal(await page.inputValue('#axon-try-damping'),String(await sim(()=>global.__axon.link.block[1])),'this servo\'s Damping');const frames=await sim(()=>global.__axon.link.writeFrames);
      await page.fill('#axon-try-damping','1');await page.click('[data-axon-try-set=low]');assert.match(await page.locator('#axon-try-facts').textContent(),/past the target/);assert.match(await page.locator('#axon-apply').textContent(),/^Apply$/);assert.equal(await page.isDisabled('#axon-apply'),true);await page.waitForTimeout(1200);assert.equal(await page.inputValue('#axon-try-damping'),'1','polling leaves it alone');assert.equal(await sim(()=>global.__axon.link.writeFrames),frames,'nothing was written');
      await page.click('[data-axon-try-set=servo]');assert.equal(await page.inputValue('#axon-try-damping'),String(await sim(()=>global.__axon.link.block[1])),'and it goes back');await page.click('[data-view=settings]');await page.waitForSelector('#axon-f-pwm');await page.mouse.move(2,2);}
    // Switch to continuous rotation: it says what will happen, asks, flashes, comes back and reads its new settings.
    await page.click('#axon-mode-cr');await page.waitForFunction(()=>/gets Axon's official firmware/.test(document.querySelector('#axon-settings').textContent));assert.equal(await page.locator('#axon-apply').textContent(),'Switch mode');assert.match(await banner(),/Ready to switch to continuous rotation/);
    // With no key file, switching asks for one and nothing changes on the servo. Everything else on the tab goes on working.
    const keyFile=path.join(data,'axon-keys.json'),keyText=fs.readFileSync(keyFile,'utf8');fs.rmSync(keyFile);await app.evaluate((x,root)=>{process.mainModule.require(root+'/src/axon-servo.cjs').useKeys(null);},root);await page.click('#axon-apply');await asked(/Torque does not include the keys/);assert.match(await page.locator('#axon-ask').textContent(),/Axon's own program is on this computer too/);assert.equal(await page.locator('#axon-ask-1').textContent(),'Import key file');await page.click('#axon-ask-0');for(let i=0;i<30&&!(await sim(()=>global.__axon.ran));i++)await page.waitForTimeout(50);assert.equal(await sim(()=>global.__axon.ran),'C:/b.exe','it opens Axon\'s own program for the switch');await page.click('#axon-apply');await asked(/Torque does not include the keys/);await page.click('#axon-ask-2');await page.waitForSelector('#axon-ask[open]',{state:'detached'});assert.equal(await sim(()=>global.__axon.link.mode),'servo','nothing was flashed');
    fs.writeFileSync(keyFile,keyText);
    await page.click('#axon-apply');await asked(/resets its settings to Axon/);await page.click('#axon-ask-0');
    await until(/Switched to continuous rotation/,{timeout:30000});await page.waitForFunction(()=>!document.querySelector('[data-view=graph]'));assert.equal(await sim(()=>global.__axon.link.mode),'cr');assert.equal(await page.locator('#axon-ask[open]').count(),0);
    await page.waitForSelector('#axon-f-pwm:not([disabled])');assert.match(await page.locator('#axon-settings-title').textContent(),/V2 continuous rotation/);assert.deepEqual((await keys()).sort(),['inversion','pwm'],'Simple is power and direction on continuous rotation');assert.match(await page.locator('#axon-mode-cr').textContent(),/Now/);
    // Advanced adds the stop band there, and it reaches its byte.
    await page.click('#axon-level');await page.waitForSelector('[data-axon-seg=sens]');assert.equal(await page.getAttribute('[data-axon-seg=sens][data-value="1"]','aria-pressed'),'true');await page.click('[data-axon-seg=sens][data-value="0"]');await page.click('#axon-apply');
    await until(/Confirmed/);assert.equal(await sim(()=>global.__axon.link.block[2]),150);assert.match(await page.locator('#axon-result').textContent(),/Stop Band/);
    // Settings file: reviewed before anything goes to the servo.
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path.join(data,'arm.svp'));
    await page.click('#axon-save-file');for(let i=0;i<50&&!fs.existsSync(path.join(data,'arm.svp'));i++)await page.waitForTimeout(100);assert.equal(fs.statSync(path.join(data,'arm.svp')).size,95);
    await page.click('[data-axon-seg=sens][data-value="2"]');await page.click('#axon-apply');await until(/Confirmed/);assert.equal(await sim(()=>global.__axon.link.block[2]),50);
    await page.click('#axon-open-file');await until(/Ready to write 1 change/);assert.equal(await sim(()=>global.__axon.link.block[2]),50,'opening a file writes nothing');await page.click('#axon-discard');
    // Factory reset asks first.
    await page.click('#axon-defaults');await asked(/resets every setting/);await page.click('#axon-ask-1');await page.waitForFunction(()=>!document.querySelector('#axon-ask').open);
    // A V1 servo: same layout, with the honest warning, and V1's own settings. What the last servo confirmed does not carry over.
    await sim(()=>{const {transport,Sim}=global.__axon,link=new Sim.SimLink('v1','servo','SA81BHMW',{modelB:1,powerOn:true});global.__axon.link.flush=async()=>{throw new global.__axon.DeviceLost('swapped');};global.__axon.link=link;transport.link=link;transport.open=async()=>link;});
    await page.waitForFunction(()=>/Plugged in/.test(document.querySelector('#axon-model-max1').textContent),null,{timeout:15000});await until(/V1 MAX is ready/);assert.equal(await page.locator('#axon-result').textContent(),'','no result carried over');
    assert.match(await page.locator('#axon-report').textContent(),/Axon says V1 servos do not work on the V2 programmer/);assert.match(await page.locator('#axon-report').textContent(),/V1 servo through V2 programmer/);await page.waitForSelector('#axon-f-angle:not([disabled])');{const k=await keys();assert.ok(k.includes('angle')&&k.includes('olp')&&k.includes('range'));}
    await page.click('#axon-mode-cr');await page.click('#axon-apply');await asked(/has not been proven on real hardware/);await page.click('#axon-ask-1');await page.click('#axon-discard');assert.match(await page.locator('#axon-settings-title').textContent(),/V1 servo mode/);
    // Recover, in Advanced, for a servo that stopped showing up: it writes the servo and mode picked at the top, and the servo comes back.
    await sim(()=>{const l=global.__axon.link;l.attached=false;l.attachOnExit=true;});await until(/Plug a servo into the V2 programmer/);
    await page.click('#axon-model-max1');await page.click('#axon-recover-go');await asked(/writes V1 MAX servo mode firmware/);await page.click('#axon-ask-0');
    await until(/Switched to servo mode/,{timeout:30000});await page.waitForFunction(()=>/Plugged in/.test(document.querySelector('#axon-model-max1').textContent));
    // Leaving the tab stops USB, and coming back starts it again.
    await page.click('#setup-view [data-flow=setup]');await page.waitForTimeout(1500);
    await sim(()=>{global.__axon.polls=0;const l=global.__axon.link,w=l.write.bind(l);l.write=async(...a)=>{global.__axon.polls++;return w(...a);};});await page.waitForTimeout(1200);assert.equal(await sim(()=>global.__axon.polls),0,'no USB while the tab is not showing');
    {const a=await sim(()=>global.__axon.detects);await page.waitForTimeout(3500);assert.ok(await sim(()=>global.__axon.detects)>a,'the Control Hub watch is back');}
    await page.click('#setup-view [data-flow=axon]');await until(/V1 MAX is ready/);assert.ok(await sim(()=>global.__axon.polls)>0,'USB runs again when it comes back');
    // Steam Deck and a narrow window: it still works, and nothing scrolls the page sideways.
    await page.setViewportSize({width:420,height:800});await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.scrollingElement.scrollWidth<=innerWidth),'no sideways scroll when narrow');assert.equal(await page.locator('#axon-apply').isVisible(),true);await page.setViewportSize({width:1280,height:800});
    assert.deepEqual(errors,[]);console.log('Axon programmer: all passed');
  }catch(e){const page=await app.firstWindow().catch(()=>null);if(page){console.error('Banner:',await page.locator('#axon-banner').textContent().catch(()=>''));console.error('Happened:',await page.locator('#axon-log').textContent().catch(()=>''));}throw e;}
  finally{await app.close().catch(()=>{});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,1500));process.exit(1);});
