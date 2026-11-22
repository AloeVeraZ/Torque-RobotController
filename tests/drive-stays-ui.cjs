'use strict';
// Drive comes back as it was after a page that needed the robot, unless someone closed it. Competition mode keeps Torque off Wi-Fi. Sounds mute from the three-dot menu.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/drive-stays-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright'),{startUdpRobot}=require('../tools/ftc-sim.cjs'),root=path.join(__dirname,'..'),wait=ms=>new Promise(r=>setTimeout(r,ms)),ROBOT='127.0.0.12';
(async()=>{
  const robot=await startUdpRobot({address:ROBOT}),data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-drive-stays-')),env={...process.env,DECK_HEADLESS:'1',DECK_DATA_DIR:data,ADB:'C:\\Windows\\System32\\where.exe'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);await page.setViewportSize({width:1280,height:800});
    const go=async where=>{await page.evaluate(w=>window.deck.page(w),where);await page.waitForFunction(w=>state.page===w,where);},open=()=>page.evaluate(h=>window.deck.open({url:h,kind:'ftc',name:'Bench robot'}),ROBOT),on=()=>page.waitForFunction(()=>state.kind==='ftc'&&!state.loading&&!!state.url,null,{timeout:20000}),off=()=>page.waitForFunction(()=>!state.url);
    // ---- Drive stays on
    assert.equal((await open()).opened,true);await on();
    await go('setup');await off();await go('calibrate');await off();
    await go('drive');await on();assert.equal(await page.evaluate(()=>state.title||state.robot?.name),'Bench robot','the same robot');
    await go('settings');await wait(300);assert.ok(await page.evaluate(()=>!!state.url),'Settings never took it');await go('drive');
    await go('setup');await off();await go('settings');await wait(300);assert.equal(await page.evaluate(()=>!!state.url),false,'it waits for Drive');await go('drive');await on();
    // Closed by someone, it stays closed.
    await page.evaluate(()=>window.deck.close());await off();await go('setup');await go('drive');await wait(1500);assert.equal(await page.evaluate(()=>!!state.url),false,'closed stays closed');
    assert.match(await page.locator('#drive-practice').textContent(),/Inspection and matches need the FTC Driver Station app/);
    // ---- No sounds: the three-dot menu has no Sounds item, and the app plays none
    await page.click('#more');assert.equal(await page.locator('#menu-sounds').count(),0);assert.equal(await page.evaluate(()=>'DeckSounds' in window),false);
    // Competition mode is gone: the menu offers no switch for it.
    assert.equal(await page.locator('#menu-competition, #competition-chip').count(),0);
    assert.deepEqual(errors,[]);console.log('Drive stays on: all passed');
  }finally{await app.close().catch(()=>{});fs.rmSync(data,{recursive:true,force:true});await robot.close?.();}
})().then(()=>process.exit(0),e=>{console.error(String(e.stack||e).slice(0,2400));process.exit(1);});
