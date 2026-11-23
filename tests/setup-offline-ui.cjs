'use strict';
// Setup with no robot plugged in, in the real app: everything in Setup is editable offline (only Calibrate needs the robot).
//  A. The Starter Mecanum demo is set up on the same Mechanisms page as any robot: Your robot lists Chassis, the Control Hub,
//     each wheel and the Pinpoint, with + Add to Chassis; motors, encoders and the Pinpoint are all on to start with.
//  B. Setup has no "Simulated robot" banner (Calibrate keeps it).
//  C. Right-click the odometry tile → Delete odometry takes it off; Ctrl+Z (⌘Z) puts it back and Ctrl+Shift+Z takes it off again.
//  D. + Add to Chassis → Odometry & IMU → two odometry pods works with no Control Hub.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/setup-offline-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/setup-offline');fs.mkdirSync(out,{recursive:true});
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-offline-')),env={...process.env,DECK_HEADLESS:'1',DECK_TEST_SETUP:'1',DECK_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);await page.setViewportSize({width:1280,height:800});
    const project=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')));
    const loc=()=>project().then(p=>p.sensors.localization);
    await page.evaluate(()=>window.deck.page('setup'));await page.waitForFunction(()=>state.page==='setup');
    await page.click('#sim-setup');await page.locator('.sim-setup-option[data-setup-id="preset:startermecanum"]').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).setupId==='preset:startermecanum');await page.waitForTimeout(1500);
    // A. The same steps and the same Your robot list as a new robot.
    assert.deepEqual(await page.$$eval('#setup-view .setup-flow [data-flow]:not([hidden])',l=>l.map(b=>b.textContent)),['1Robot','2Mechanisms','3Hubs','4Configure'],'no kit-only Chassis step');
    await page.click('#sim-setup-step-mechanisms');await page.waitForSelector('[data-garage="chassis:controller"]');
    const tiles=await page.$$eval('#mech-rail [data-garage],#mech-rail [data-garage-add]',l=>l.map(b=>b.dataset.garage||'+'+b.dataset.garageAdd));
    for(const t of ['chassis','chassis:controller','chassis:frontLeft','chassis:frontRight','chassis:backLeft','chassis:backRight','chassis:pinpoint','+chassis'])assert.ok(tiles.includes(t),`${t} in ${tiles}`);
    assert.equal(await loc(),'fused','the Pinpoint is on');
    await page.click('[data-garage="chassis:frontLeft"]');await page.waitForTimeout(300);
    assert.equal(await page.locator('#mech-drive-ports [data-wire-encoder="robot.frontLeft"]').isChecked(),true,'its encoder is ticked');assert.equal(await page.locator('#mech-drive-ports [data-wire-encoder="robot.frontLeft"]').isEnabled(),true,'and the tick is the team’s to take off');
    // B. Mechanisms needs no robot, so Setup says nothing about one here; Hubs and Configure, which show the hubs Torque
    // simulates, say Simulated robot as Calibrate does.
    assert.equal(await page.locator('#setup-view [data-sample-banner]').isVisible(),false,'Mechanisms says nothing about a missing robot');
    for(const step of ['setup','configure']){await page.click(`#setup-view .setup-flow [data-flow="${step}"]`);await page.waitForTimeout(300);
      assert.match(await page.locator('#setup-view [data-sample-banner]').innerText(),/^Simulated robot\s+No Control Hub is connected, so Torque simulates this robot’s hubs from Setup\./,`${step} says the robot is simulated`);}
    await page.click('#setup-view .setup-flow [data-flow="mechanisms"]');await page.waitForTimeout(300);await page.click('[data-garage="chassis:frontLeft"]');await page.waitForTimeout(300);
    await page.screenshot({path:path.join(out,'demo-mechanisms.png')});
    // C. Delete odometry, then undo and redo it.
    await page.click('[data-garage="chassis:pinpoint"]',{button:'right'});await page.waitForSelector('#mech-tile-menu:not([hidden]) [data-tile-act=delete]');
    assert.equal((await page.textContent('#mech-tile-menu [data-tile-act=delete]')).trim(),'Delete odometry');
    await page.click('#mech-tile-menu [data-tile-act=delete]');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).sensors.localization==='encoders');
    assert.equal(await page.locator('[data-garage="chassis:pinpoint"]').count(),0,'its tile is gone');
    await page.locator('body').click({position:{x:5,y:5}});const mod=process.platform==='darwin'?'Meta':'Control';
    await page.keyboard.press(`${mod}+z`);if(process.env.DEBUG_UNDO){await page.waitForTimeout(800);console.log(await page.evaluate(()=>({act:document.activeElement?.tagName+'#'+document.activeElement?.id,status:document.querySelector('#mech-list-status')?.textContent,loc:JSON.parse(localStorage.getItem('deck-simulation-project-v2')).sensors.localization})));}await page.waitForFunction(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).sensors.localization==='fused');
    await page.waitForSelector('[data-garage="chassis:pinpoint"]');
    await page.keyboard.press(`${mod}+Shift+z`);await page.waitForFunction(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).sensors.localization==='encoders');
    await page.keyboard.press(`${mod}+z`);await page.waitForFunction(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).sensors.localization==='fused');
    // D. Two odometry pods, offline.
    await page.click('[data-garage-add="chassis"]');await page.click('[data-add-kind="odometry"]');await page.click('#mech-add-chassis [data-sensor-card="odometry"]');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).sensors.localization==='odometry');await page.click('#mech-add-chassis [data-dialog-done]');
    await page.waitForSelector('[data-garage^="chassis:pod"]');await page.screenshot({path:path.join(out,'two-pods.png')});
    assert.deepEqual(errors,[]);console.log('setup offline UI: all passed');
  }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
