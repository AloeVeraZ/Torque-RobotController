'use strict';
// Calibrate's Axon section in the real app, against a simulated V2 programmer: the real main-process logic runs, only USB is stubbed.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/axon-programmer-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-axon-')),env={...process.env,DECK_HEADLESS:'1',DECK_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object');
    // Everything real but the USB: a programmer with no servo in it yet, and Axon Bridge open.
    await app.evaluate(({},{root,data})=>{const req=process.mainModule.require,A=req(root+'/src/axon-programmer.cjs'),Sim=req(root+'/tests/fixtures/axon-sim.cjs'),path=req('node:path');
      const link=new Sim.SimLink('v2','servo','MAXMK2',{attached:false,inputPulse:1500}),transport=Sim.simTransport(link);transport.rivalTitles=['Axon Bridge'];transport.plugged=false;
      const firmwareDir=path.join(data,'sim-firmware');A.overrides.catalog=Sim.installFirmware(firmwareDir);A.overrides.firmwareDir=firmwareDir;A.overrides.transport=transport;global.__axon={link,transport,Sim,firmwareDir,DeviceLost:req(root+'/src/axon-servo.cjs').DeviceLost};},{root,data});
    const sim=fn=>app.evaluate(fn),text=()=>page.locator('#cal-panel-axon').textContent();
    await page.click('#robot-setup-tab');await page.waitForSelector('#setup-view:not([hidden])');await page.click('#setup-view [data-flow=calibrate]');await page.waitForSelector('#calibrate-view:not([hidden])');
    await page.click('#cal-tab-calibrate');await page.click('#cal-tab-axon');
    // Before it is pressed, nothing touches USB.
    await page.waitForSelector('#axon-open');assert.equal((await sim(()=>global.__axon.transport.opened)),0);
    assert.match(await text(),/Axon Programmer/);await page.click('#axon-open');
    // It says what is needed before anything else.
    await page.waitForSelector('#axon-need-title');{const t=await text();assert.match(t,/Axon V2 programmer/);assert.match(t,/a team has to buy it/);assert.match(t,/Simple shows exactly the settings Axon/);}
    // A rival app: it waits, says so and can ask it to close.
    await page.waitForFunction(()=>/Axon Bridge is open/.test(document.querySelector('#axon-s1').textContent));assert.equal(await sim(()=>global.__axon.transport.opened),0,'it leaves the programmer to the other app');
    await page.click('#axon-close-rivals');
    await page.waitForFunction(()=>/Plug in the V2 programmer/.test(document.querySelector('#axon-s1').textContent));
    // Plug in the programmer: it reports it, and asks for a servo.
    await sim(()=>{global.__axon.transport.plugged=true;});
    await page.waitForFunction(()=>/V2 programmer connected/.test(document.querySelector('#axon-s1').textContent));
    await page.waitForFunction(()=>/Plug in a servo/.test(document.querySelector('#axon-s2').textContent));
    await page.waitForFunction(()=>/Simulated V2 programmer/.test(document.querySelector('#axon-prog').textContent)&&/5\.\d+ V/.test(document.querySelector('#axon-prog').textContent));
    assert.match(await page.locator('#axon-prog').textContent(),/1500 µs every 20\.0 ms \(50 Hz\)/);
    assert.equal(await page.locator('#axon-s1').getAttribute('data-state'),'done');
    // Plug in a servo: it is read by itself, and what it reports shows.
    await sim(()=>{global.__axon.link.attached=true;});
    await page.waitForFunction(()=>/V2 MAX \(sold as MAX MK2\) is plugged in/.test(document.querySelector('#axon-s2').textContent));
    await page.waitForSelector('#axon-f-pwm');{const t=await page.locator('#axon-servo').textContent();assert.match(t,/AISV112205/);assert.match(t,/MAXMK2/);assert.match(t,/2025\/03\/12/);}
    // Simple: exactly Axon's software. Every setting says what it means.
    const keys=()=>page.$$eval('[data-axon-field]',r=>r.map(x=>x.dataset.axonField));
    {const k=await keys();for(const key of ['left','right','neutral','signal','pwm','damping','sens','softstart','lostppm','inversion','beep','name','ol1t','ol1p','ol3p'])assert.ok(k.includes(key),key);assert.ok(!k.includes('sysamp')&&!k.includes('minpower'),'hidden tuning is not offered');
      assert.equal(await page.$$eval('[data-axon-field] .hint',h=>h.filter(x=>x.textContent.trim().length<20).length),0,'every setting explains itself');}
    assert.equal(await page.locator('#axon-settings input.num-slider').count(),0,'dropdowns, not sliders');
    // Change settings: nothing is sent until applied, and the list says what will change.
    const frames=await sim(()=>global.__axon.link.writeFrames);
    assert.equal(await page.inputValue('#axon-f-pwm'),'255');await page.selectOption('#axon-f-pwm','168');await page.selectOption('#axon-f-left','200');
    await page.waitForSelector('#axon-apply');assert.match(await page.locator('#axon-apply-box').textContent(),/PWM Power 100% → 66%/);assert.match(await page.locator('#axon-apply').textContent(),/Apply 2 changes/);assert.equal(await sim(()=>global.__axon.link.writeFrames),frames,'nothing sent yet');
    await page.waitForTimeout(1200);assert.equal(await page.inputValue('#axon-f-pwm'),'168','polling leaves the student\'s choice alone');
    await page.click('#axon-apply');
    // Confirm: what the servo reports back, after a real read-back.
    await page.waitForFunction(()=>/Confirmed/.test(document.querySelector('#axon-s5').textContent));
    {const t=await page.locator('#axon-result').textContent();assert.match(t,/Written, read back and confirmed/);assert.match(t,/PWM Power66%66%Yes/);assert.match(t,/Left Range200200Yes/);}
    assert.deepEqual(await sim(()=>{const b=global.__axon.link.block;return [b[6],b[9]];}),[168,200]);assert.equal(await page.locator('#axon-s5').getAttribute('data-state'),'done');
    // A servo that does not keep a value is called out, with what it really holds.
    await sim(()=>{global.__axon.link.writesIgnored=true;});await page.selectOption('#axon-f-pwm','191');await page.click('#axon-apply');
    await page.waitForFunction(()=>/It did not take/.test(document.querySelector('#axon-s5').textContent));assert.match(await page.locator('#axon-result').textContent(),/PWM Power75%66%No/);assert.equal(await page.locator('#axon-s5').getAttribute('data-state'),'bad');await sim(()=>{global.__axon.link.writesIgnored=false;});await page.click('#axon-discard');
    // Advanced is one button. It adds the confirmed setting on continuous rotation, and reports the rest, without offering to write it.
    await page.click('#axon-level');await page.waitForFunction(()=>/Back to Simple/.test(document.querySelector('#axon-level').textContent));
    {const t=await page.locator('#axon-servo').textContent();assert.match(t,/SysAmp: 40/);assert.match(t,/MinPower: 20/);assert.match(t,/Every settings byte/);assert.match(await page.locator('#axon-prog').textContent(),/Handshake reply/);assert.match(await page.locator('#axon-advanced').textContent(),/What Advanced will not change/);
      assert.match(await page.locator('[data-axon-field=pwm] .axon-factory').textContent(),/Factory value: 100%/);assert.ok(!(await keys()).includes('sysamp'));}
    await page.click('#axon-usb summary');await page.waitForFunction(()=>/TX 04 CB/.test(document.querySelector('#axon-usb-log').textContent));
    await page.click('#axon-level');
    // Switch to continuous rotation: firmware is asked for first, then it flashes, comes back and reads its new settings.
    await page.click('#axon-mode-cr');await page.waitForFunction(()=>/Switching means writing Axon/.test(document.querySelector('#axon-modes').textContent));
    await page.click('#axon-switch');await page.waitForFunction(()=>/resets its settings to Axon/.test(document.querySelector('#axon-apply-box').textContent));
    await page.click('#axon-ask-0');
    await page.waitForFunction(()=>/Switched to continuous rotation/.test(document.querySelector('#axon-result').textContent),null,{timeout:30000});
    assert.equal(await sim(()=>global.__axon.link.mode),'cr');
    await page.waitForSelector('#axon-f-proptl');assert.match(await page.locator('#axon-settings').textContent(),/V2 continuous rotation/);assert.deepEqual((await keys()).sort(),['beep','inversion','proptl','pwm'],'Simple is Axon\'s four settings on continuous rotation');
    // Advanced adds the stop band there, and it reaches its byte.
    await page.click('#axon-level');await page.waitForSelector('#axon-f-sens');assert.equal(await page.inputValue('#axon-f-sens'),'1');await page.selectOption('#axon-f-sens','0');await page.click('#axon-apply');
    await page.waitForFunction(()=>/Confirmed/.test(document.querySelector('#axon-s5').textContent));assert.equal(await sim(()=>global.__axon.link.block[2]),150);
    // Settings file: reviewed before anything goes to the servo.
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path.join(data,'arm.svp'));
    await page.click('#axon-save-file');await page.waitForFunction(f=>true,path.join(data,'arm.svp'));for(let i=0;i<50&&!fs.existsSync(path.join(data,'arm.svp'));i++)await page.waitForTimeout(100);assert.equal(fs.statSync(path.join(data,'arm.svp')).size,95);
    await page.selectOption('#axon-f-sens','2');await page.click('#axon-apply');await page.waitForFunction(()=>/Stop band/.test(document.querySelector('#axon-result').textContent)&&!document.querySelector('#axon-apply'));assert.equal(await sim(()=>global.__axon.link.block[2]),50);
    await page.click('#axon-open-file');await page.waitForSelector('#axon-apply');assert.match(await page.locator('#axon-apply-box').textContent(),/Stop band/);assert.equal(await sim(()=>global.__axon.link.block[2]),50,'opening a file writes nothing');await page.click('#axon-discard');
    // Factory reset asks first.
    await page.click('#axon-defaults');await page.waitForFunction(()=>/resets every setting/.test(document.querySelector('#axon-apply-box').textContent));await page.click('#axon-ask-1');assert.equal(await page.locator('.axon-confirm').count(),0);
    // A V1 servo: same flow, with the honest warning, and V1's own settings.
    await sim(()=>{const {transport,Sim}=global.__axon,link=new Sim.SimLink('v1','servo','SA81BHMW',{modelB:1,powerOn:true});global.__axon.link.flush=async()=>{throw new global.__axon.DeviceLost('swapped');};global.__axon.link=link;transport.link=link;transport.open=async()=>link;});
    await page.waitForFunction(()=>/V1 MAX \(sold as MAX\+\) is plugged in/.test(document.querySelector('#axon-s2').textContent),null,{timeout:15000});
    assert.match(await page.locator('#axon-s2').textContent(),/Axon says V1 servos do not work on the V2 programmer/);await page.waitForSelector('#axon-f-angle');{const k=await keys();assert.ok(k.includes('angle')&&k.includes('olp')&&k.includes('range'));}
    await page.click('#axon-mode-cr');await page.click('#axon-switch');await page.waitForFunction(()=>/has not been proven on real hardware/.test(document.querySelector('#axon-apply-box').textContent));await page.click('#axon-ask-1');await page.click('#axon-cancel-switch');
    // Recover, in Advanced, for a servo that stopped showing up: it asks right there, and the servo comes back.
    await sim(()=>{const l=global.__axon.link;l.attached=false;l.attachOnExit=true;});await page.waitForFunction(()=>/Plug in a servo/.test(document.querySelector('#axon-s2').textContent));
    await page.selectOption('#axon-recover-model','max1');await page.click('#axon-recover-go');await page.waitForSelector('#axon-recover .axon-confirm');assert.match(await page.locator('#axon-recover .axon-confirm').textContent(),/hardware check/);assert.equal(await page.locator('#axon-apply-box .axon-confirm').count(),0);await page.click('#axon-ask-0');
    await page.waitForFunction(()=>/Switched to servo mode/.test(document.querySelector('#axon-result').textContent),null,{timeout:30000});await page.waitForFunction(()=>/V1 MAX \(sold as MAX\+\) is plugged in/.test(document.querySelector('#axon-s2').textContent));
    // Leaving the page stops USB, and coming back starts it again.
    await page.click('#cal-tab-electronics');await page.waitForTimeout(1500);
    await sim(()=>{global.__axon.polls=0;const l=global.__axon.link,w=l.write.bind(l);l.write=async(...a)=>{global.__axon.polls++;return w(...a);};});await page.waitForTimeout(1200);assert.equal(await sim(()=>global.__axon.polls),0,'no USB while the page is not showing');
    await page.click('#cal-tab-axon');await page.waitForFunction(()=>/V1 MAX \(sold as MAX\+\) is plugged in/.test(document.querySelector('#axon-s2').textContent));assert.ok(await sim(()=>global.__axon.polls)>0,'USB runs again when it comes back');
    await page.click('#axon-back');await page.waitForSelector('#axon-open');
    assert.deepEqual(errors,[]);console.log('Axon programmer: all passed');
  }catch(e){const page=await app.firstWindow().catch(()=>null);if(page){console.error('Step 1 and 2:',await page.locator('#axon-s1').textContent().catch(()=>''),await page.locator('#axon-s2').textContent().catch(()=>''));console.error('Happened:',await page.locator('#axon-log').textContent().catch(()=>''));}throw e;}
  finally{await app.close().catch(()=>{});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,1500));process.exit(1);});
