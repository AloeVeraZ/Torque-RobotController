'use strict';
// The SWYFT Programmer tab in the real app, against a simulated SWYFT programmer and servo: the real main-process logic runs,
// only the COM port is stubbed. DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/swyft-programmer-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-swyft-'));const env={...process.env,DECK_HEADLESS:'1',DECK_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1280,height:800});
    await page.waitForFunction(()=>typeof state==='object');
    // Everything real but the port: SWYFT's own app is open, and the programmer is not plugged in yet.
    await app.evaluate(({ipcMain},{root})=>{const req=process.mainModule.require,P=req(root+'/src/swyft-programmer.cjs'),Sim=req(root+'/tests/fixtures/swyft-sim.cjs');
      const link=new Sim.SimLink(),transport=Sim.simTransport(link,{rivals:['SwyftServoProgrammerV2'],others:[{port:'COM3',vid:0x8086,pid:0xA0E3,name:'Not USB'}]});transport.plugged=false;
      P.overrides.transport=transport;P.overrides.pollMs=150;global.__swyft={link,transport,Sim};
      ipcMain.removeHandler('robot-link');ipcMain.handle('robot-link',async(e,action)=>{if(action==='detect')return {ok:true,value:{usb:{found:false,message:'Not plugged in.'},wifi:{robot:false}}};if(action==='usb-status')return {ok:true,value:{found:false}};return {ok:false,error:'not in this test: '+action};});},{root});
    const sim=fn=>app.evaluate(fn),banner=()=>page.locator('#swyft-banner').textContent(),until=re=>page.waitForFunction(s=>new RegExp(s).test(document.querySelector('#swyft-banner').textContent),re.source);
    const rowKeys=()=>page.$$eval('[data-swyft-field]',r=>r.map(x=>x.dataset.swyftField));

    await page.click('#calibrate-tab');await page.waitForSelector('#calibrate-view:not([hidden])');
    // A tool of Calibrate's, after the Axon Programmer, at the far right with Servo Test.
    {const tabs=await page.$$eval('#calibrate-view .flow-steps [data-flow]',b=>b.map(x=>x.dataset.flow));assert.deepEqual(tabs.slice(-3),['axon','swyft','servotest']);
      const geo=await page.evaluate(()=>{const rail=document.querySelector('#calibrate-view .flow-steps'),t=rail.querySelector('[data-flow=swyft]');return {edge:rail.getBoundingClientRect().right-rail.querySelector('[data-flow=servotest]').getBoundingClientRect().right,number:t.querySelector('.flow-num')?.textContent??null,text:t.textContent,tagged:!!t.querySelector('.flow-new'),axonTagged:!!rail.querySelector('[data-flow=axon] .flow-new'),gap:t.getBoundingClientRect().left-rail.querySelector('[data-flow=axon]').getBoundingClientRect().right,fits:rail.scrollWidth<=rail.clientWidth};});
      assert.ok(geo.edge>=16&&geo.edge<=60,`the optional tools end a little in from the right: ${geo.edge}`);assert.equal(geo.number,null,'no number: an optional tool');assert.match(geo.text,/SWYFT Programmer/);assert.equal(geo.fits,true,'the rail still fits');
      assert.equal(geo.tagged,false,'one New tag for the pair, on Axon');assert.equal(geo.axonTagged,true);assert.ok(geo.gap<=20,`close beside Axon: ${geo.gap}px`);}
    assert.equal(await sim(()=>global.__swyft.transport.opened),0,'nothing touches the port before the tab opens');
    await page.click('#calibrate-view [data-flow=swyft]');await page.waitForSelector('#cal-panel-swyft:not([hidden]) #rs-step-swyft');
    assert.equal(await page.isHidden('#rs-step-axon'),true);
    // SWYFT's own app holds the programmer: Torque says so and offers to close it.
    await until(/SWYFT's own programmer app is open/);await page.click('#swyft-close-rivals');
    // Then: no programmer. The whole page stays as a preview, greyed and out of reach, and a port that is not SWYFT's is never opened.
    await until(/Plug in the SWYFT programmer/);assert.match(await banner(),/COM3 is plugged in, but it is not a SWYFT programmer/);assert.equal(await sim(()=>global.__swyft.transport.opened),0);
    assert.deepEqual((await page.$$eval('#rs-step-swyft .swyft-picks, #rs-step-swyft .axon-main',e=>e.map(x=>x.inert))),[true,true]);assert.equal(await page.locator('#swyft-model-speed').isVisible(),true,'there to preview');assert.equal(await page.locator('#swyft-v-travel').textContent(),'270°',"SWYFT's defaults");
    await page.click('#swyft-level-advanced');assert.ok((await rowKeys()).includes('p'),'Advanced can be previewed');await page.click('#swyft-level-simple');
    // The programmer with no servo.
    await sim(()=>{global.__swyft.link.servo=false;global.__swyft.transport.plugged=true;});
    await until(/Plug a SWYFT servo into the programmer/);assert.match(await page.locator('#swyft-chips').textContent(),/Programmer · COM8/);assert.deepEqual((await page.$$eval('#rs-step-swyft .swyft-picks, #rs-step-swyft .axon-main',e=>e.map(x=>x.inert))),[false,false]);
    // Simple with no servo previews SWYFT's defaults, disabled.
    assert.deepEqual(await rowKeys(),['travel','reverse','maxPower','stall']);assert.equal(await page.isDisabled('#swyft-f-maxPower'),true);
    assert.match(await page.locator('#swyft-tag').textContent(),/Preview of SWYFT's defaults/);
    // The servo plugged in: its real settings, live.
    await sim(()=>{global.__swyft.link.servo=true;});
    await until(/A SWYFT servo is ready/);assert.match(await banner(),/programmer cannot tell them apart/);
    assert.equal(await page.locator('#swyft-v-travel').textContent(),'320°');assert.equal(await page.locator('#swyft-v-maxPower').textContent(),'500 (100%)');
    assert.equal(await page.isChecked('#swyft-f-stall'),true);assert.equal(await page.getAttribute('#swyft-f-reverse-off','aria-pressed'),'true');
    assert.equal(await page.getAttribute('#swyft-mode-servo','aria-pressed'),'true');assert.match(await page.locator('#swyft-mode-servo').textContent(),/Now/);
    for(const size of [{width:1280,height:800},{width:1280,height:640}]){await page.setViewportSize(size);await page.waitForTimeout(150);
      const cut=await page.$$eval('#swyft-settings .axon-row',rows=>rows.filter(r=>{const b=r.getBoundingClientRect(),box=r.closest('.axon-settings-body').getBoundingClientRect();return b.bottom>box.bottom+1;}).map(r=>r.dataset.swyftField));
      assert.deepEqual(cut,[],`every Simple row shows at ${size.height}px high`);}
    await page.setViewportSize({width:1280,height:800});
    // Picking the model changes what is shown, never the servo. Only programmable SWYFT servos are offered.
    assert.deepEqual(await page.$$eval('#swyft-models [data-id]',b=>b.map(x=>x.dataset.id)),['speed','balance','torque','slim','nano']);await page.click('#swyft-model-speed');
    await until(/SWYFT Speed is ready/);assert.match(await page.locator('#swyft-report').textContent(),/SWYFT Speed/);
    // Advanced shows every setting SWYFT's app has, and Simple again drops advanced edits.
    await page.click('#swyft-level-advanced');assert.deepEqual(await rowKeys(),['travel','reverse','minSignal','middleSignal','maxSignal','maxPower','stall','ramp','deadZone','p','i','d','integralSpeed']);
    assert.match(await page.locator('#swyft-more').textContent(),/55 13 0D 18 82/);await page.click('[data-swyft-nudge="1"][data-for=swyft-f-p]');
    assert.equal(await page.isHidden('[data-swyft-field=p] [data-swyft-mark]'),false);assert.match(await page.locator('#swyft-apply').textContent(),/Apply 1 change/);
    await page.click('#swyft-level-simple');assert.deepEqual(await rowKeys(),['travel','reverse','maxPower','stall']);assert.equal(await page.isDisabled('#swyft-apply'),true,'the P change went with Advanced');
    // A change in Simple: lower power, a shorter travel, reversed. Apply writes once, reads back, and the table says it took.
    await page.evaluate(()=>{const r=document.querySelector('#swyft-f-maxPower');r.value=450;r.dispatchEvent(new Event('input',{bubbles:true}));});
    const at270=await page.evaluate(()=>{const s=document.querySelector('#swyft-f-travel');return [...Array(+s.max+1).keys()].find(i=>{s.value=i;s.dispatchEvent(new Event('input',{bubbles:true}));return document.querySelector('#swyft-v-travel').textContent==='270°';});});
    assert.ok(at270>0,'270° is one of the slider steps');await page.click('#swyft-f-reverse-on');assert.equal(await page.getAttribute('#swyft-f-reverse-on','aria-pressed'),'true');
    await until(/Ready to write 3 changes/);assert.equal(await sim(()=>global.__swyft.link.writes.length),0,'nothing is written before Apply');
    // Apply asks first whether the servo plugged in is the one picked. No writes nothing and points back to 1 Servo.
    await page.click('#swyft-apply');await page.waitForSelector('#swyft-ask[open]');assert.match(await page.locator('#swyft-ask-title').textContent(),/^Is the servo plugged in a SWYFT Speed\?$/);
    assert.match(await page.locator('#swyft-ask').textContent(),/check the label on the servo/);await page.click('#swyft-ask-1');
    await until(/Pick the servo that is plugged in/);assert.equal(await sim(()=>global.__swyft.link.writes.length),0,'No writes nothing');
    await page.click('#swyft-model-slim');await until(/Ready to write 3 changes/);
    await page.click('#swyft-apply');await page.waitForSelector('#swyft-ask[open]');assert.match(await page.locator('#swyft-ask-title').textContent(),/SWYFT Slim\?/);
    await page.click('#swyft-ask-1');await page.click('#swyft-model-speed');
    await page.click('#swyft-apply');await page.waitForSelector('#swyft-ask[open]');assert.match(await page.locator('#swyft-ask-0').textContent(),/Yes, it is a Speed/);await page.click('#swyft-ask-0');await until(/Confirmed/);
    const wrote=await sim(()=>global.__swyft.link.writes);assert.equal(wrote.length,1);assert.equal(wrote[0].maxPower,450);assert.equal(wrote[0].left,111);assert.equal(wrote[0].right,111);assert.equal(wrote[0].reverse,true);assert.equal(wrote[0].p,19,'the rest kept');
    assert.deepEqual(await page.$$eval('#swyft-result tbody th',t=>t.map(x=>x.textContent)),['Travel','Reverse direction','Max power']);
    assert.deepEqual(await page.$$eval('#swyft-result td[data-took]',t=>t.map(x=>x.textContent)),['Yes','Yes','Yes']);
    // Continuous rotation is a mode card: it greys the travel and writes both sides at 255.
    await page.click('#swyft-mode-cr');assert.equal(await page.locator('#swyft-v-travel').textContent(),'Continuous');assert.equal(await page.isDisabled('#swyft-f-travel'),true);
    await page.click('#swyft-apply');await page.click('#swyft-ask-0');await until(/Confirmed/);assert.deepEqual(await sim(()=>[global.__swyft.link.settings.left,global.__swyft.link.settings.right]),[255,255]);
    assert.match(await page.locator('#swyft-mode-cr').textContent(),/Now/);
    // Defaults: asked first, filled in, and only written with Apply. Discard drops them.
    await page.click('#swyft-defaults');await page.waitForSelector('#swyft-ask[open]');assert.match(await page.locator('#swyft-ask').textContent(),/Nothing is written until you press Apply/);
    await page.click('#swyft-ask-0');await until(/Ready to write \d+ changes/);assert.equal(await page.locator('#swyft-v-travel').textContent(),'270°');
    const before=await sim(()=>global.__swyft.link.writes.length);await page.click('#swyft-discard');assert.equal(await page.isDisabled('#swyft-apply'),true);assert.equal(await sim(()=>global.__swyft.link.writes.length),before);
    // The servo pulled out, then the programmer.
    await sim(()=>{global.__swyft.link.servo=false;});await until(/Plug a SWYFT servo/);
    await sim(()=>{global.__swyft.transport.plugged=false;global.__swyft.link.lost=true;});await until(/Plug in the SWYFT programmer/);assert.deepEqual((await page.$$eval('#rs-step-swyft .swyft-picks, #rs-step-swyft .axon-main',e=>e.map(x=>x.inert))),[true,true]);
    // Leaving the tab (for Setup's Hubs) closes the port.
    await sim(()=>{global.__swyft.transport.plugged=true;global.__swyft.link.servo=true;});await until(/is ready/);
    await page.click('#robot-setup-tab');await page.click('#setup-view [data-flow=setup]');await page.waitForSelector('#rs-step-swyft',{state:'hidden'});
    await page.waitForFunction(()=>true);await new Promise(r=>setTimeout(r,500));assert.equal(await sim(()=>global.__swyft.link.closed),true,'the port closes with the tab');
    // Servo Test: one page beside the programmers, in Calibrate. With no Control Hub on USB it waits for one and cannot start.
    {await page.click('#calibrate-tab');await page.click('#calibrate-view [data-flow=servotest]');await page.waitForSelector('#cal-panel-servotest:not([hidden]) #rs-step-servotest');
      assert.match(await page.locator('#servo-test-banner').textContent(),/Plug in a Control Hub/);assert.match(await page.locator('#servo-test-banner').textContent(),/never goes over Wi-Fi/);
      assert.equal(await page.isHidden('#servo-test-go'),true,'no hub, nothing to start');
      // No hub: the page says so where the hub would be picked.
      assert.match(await page.locator('#st-hubs').textContent(),/No Control Hub on USB/);
      // The presets set the slider.
      await page.click('#st-preset-high');assert.equal(await page.locator('#st-us').textContent(),'2400');assert.equal(await page.inputValue('#st-slider'),'2400');
      // The port is picked: 0 unless changed.
      assert.equal(await page.getAttribute('[data-st=port][data-v="0"]','aria-pressed'),'true');await page.click('[data-st=port][data-v="3"]');assert.match(await page.locator('#st-port-note').textContent(),/servo port 3 on the Control Hub/);await page.click('[data-st=port][data-v="0"]');
      // A narrower range moves the slider's ends and keeps the pulse inside it; a preset outside it cannot be picked.
      await page.selectOption('#st-to','2000');assert.equal(await page.getAttribute('#st-slider','max'),'2000');assert.equal(await page.locator('#st-us').textContent(),'2000');assert.equal(await page.isDisabled('#st-preset-high'),true);
      await page.selectOption('#st-from','1000');assert.equal(await page.isDisabled('#st-preset-low'),true);assert.equal(await page.locator('#st-min').textContent(),'1000');}
    assert.deepEqual(errors,[]);
    console.log('swyft-programmer-ui: ok');
  }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
