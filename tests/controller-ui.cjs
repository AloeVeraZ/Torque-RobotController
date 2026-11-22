'use strict';
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.join(__dirname,'..'),out=path.join(root,'test-results','controllers');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const env={...process.env,DECK_DATA_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'deck-controller-ui-')),DECK_DEVICE_MODEL:'Steam Deck LCD',DECK_CONTROLLER_TEST:'1',DECK_HEADLESS:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const args=[root,...(env.DECK_ELECTRON_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[])];
 const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args,env});
 try{
  const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>{errors.push(e.message);console.error('Renderer error:',e.message);});await page.waitForFunction(()=>typeof state==='object'&&!!window.__deckGamepadTest);
  await page.evaluate(()=>window.__deckGamepadTest.set([{id:'Steam Deck Controller',index:0,mapping:'standard',connected:true,axes:[-0.55,-0.8,0.75,0.35],buttons:Array.from({length:17},(_,i)=>({pressed:[0,4,6].includes(i),value:[0,4].includes(i)?1:i===6?0.65:0}))}]));
  await page.waitForFunction(()=>document.querySelector('#controller-1 small').textContent.includes('Steam Deck LCD controls'));
  await page.locator('#controller-1').click();await page.locator('#controller-dialog').waitFor({state:'visible'});
  await page.evaluate(()=>document.fonts.ready.then(()=>undefined));
  assert.ok(await page.evaluate(()=>document.fonts.check('400 13px Inter')&&document.fonts.check('600 22px Inter')),'Station interface font did not load offline');
  await page.waitForFunction(()=>document.querySelector('#controller-axis-1').textContent==='-0.80');
  const window=await app.browserWindow(page);
  for(const [width,height,name] of [[1280,800,'lcd'],[1920,1080,'desktop'],[390,844,'portrait']]){
   await window.evaluate((w,size)=>{w.setMinimumSize(0,0);w.setContentSize(size.width,size.height);},{width,height});await page.waitForTimeout(150);
   const dims=await page.locator('#controller-dialog').evaluate(d=>({width:d.clientWidth,scroll:d.scrollWidth}));assert.ok(dims.scroll<=dims.width+1,name+' dialog overflows horizontally');
   if(name==='lcd'){const done=await page.locator('#controller-done').boundingBox();assert.ok(done.y+done.height<=height,'LCD controller screen requires scrolling to exit');}
   await page.screenshot({path:path.join(out,'input-test-'+name+'.png'),scale:'css'});
  }
  assert.equal(await page.locator('.input-button.pressed').count(),3);assert.equal(await page.locator('#controller-axis-2').textContent(),'0.75');
  assert.equal(await page.locator('#controller-2').getAttribute('hidden'),null);
  assert.equal(await page.locator('#controller-mode-title').textContent(),'Steam Deck · Desktop shortcut');
  await window.evaluate(w=>w.setContentSize(1280,800));
  for(const [id,name,art] of [['Microsoft X-Box 360 pad 0','Generic controller','generic'],['DualSense Wireless Controller','DualSense controller','playstation'],['Xbox One Wireless Controller','Xbox One controller','xbox']]){
   await page.evaluate(id=>window.__deckGamepadTest.set([{id,index:0,mapping:'standard',connected:true,axes:[-.55,-.8,.75,.35],buttons:Array.from({length:17},(_,i)=>({pressed:[0,4,6].includes(i),value:[0,4].includes(i)?1:i===6?.65:0}))}]),id);
   await page.waitForFunction(name=>document.querySelector('#controller-monitor-name').textContent===name,name);
   assert.equal(await page.locator('#controller-visual svg').getAttribute('data-device-view'),'standard');
   assert.equal(await page.locator('#controller-driver-name').textContent(),id);
   assert.equal(await page.locator('#controller-1 small').textContent(),name);
   assert.equal(await page.locator('#pad-name-1').textContent(),name);
   assert.deepEqual((await page.locator('[data-pad-button]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.padButton)))).sort((a,b)=>a-b),Array.from({length:17},(_,i)=>i));
   assert.equal(await page.locator('[data-pad-button].pressed').count(),3);
   assert.equal(await page.locator('#trigger-left-fill').getAttribute('height'),'22.1');
   assert.equal(await page.locator('#trigger-right-fill').getAttribute('height'),'0');
   assert.equal(await page.locator('#trigger-left-fill').getAttribute('y'),'17.9');
   assert.equal(await page.locator('#plot-left-dot').getAttribute('transform'),'translate(-24.200000000000003 -35.2)');
   assert.equal(await page.locator('#plot-right-dot').getAttribute('transform'),'translate(33 15.399999999999999)');
   assert.equal(await page.locator('#stick-left-dot').getAttribute('transform'),'translate(-4.4 -6.4)');
   assert.equal(await page.locator('#stick-right-dot').getAttribute('transform'),'translate(6 2.8)');
   const done=await page.locator('#controller-done').boundingBox();assert.ok(done.y+done.height<=800,art+' illustration pushes exit off LCD');
   await page.screenshot({path:path.join(out,'input-test-'+art+'.png'),scale:'css'});
  }
  await page.locator('#controller-driver-details summary').click();await page.locator('#controller-driver-name').waitFor({state:'visible'});
  await page.locator('#controller-mode-title').click();
  const expandedDone=await page.locator('#controller-done').boundingBox();assert.ok(expandedDone.y+expandedDone.height<=800,'expanded help hides Done on LCD');
  await page.locator('#controller-mode-title').click();await page.locator('#controller-driver-details summary').click();
  await page.evaluate(()=>window.__deckGamepadTest.set([{id:'Steam Deck Controller',index:0,mapping:'standard',connected:true,axes:[.03,.04,0,0],buttons:Array.from({length:21},(_,i)=>({pressed:i===18,value:i===18?1:0}))}]));
  await page.waitForFunction(()=>document.querySelector('[data-button="18"]').classList.contains('pressed'));
  assert.equal(await page.locator('#steamdeck-controls').isVisible(),true);
  await page.locator('#controller-calibration-tab').click();await page.locator('#calibration-measure').click();
  await page.waitForFunction(()=>document.querySelector('#calibration-status').textContent.includes('left 5.0%'));
  assert.match(await page.locator('#calibration-status').textContent(),/deadzone: 7%/);
  await page.locator('#calibration-suggest').click();await page.waitForFunction(()=>document.querySelector('#calibration-saved').textContent.includes('7%'));
  assert.match(await page.locator('#calibration-stick-0').textContent(),/X 0.03.*Y 0.04/,'calibration must show raw readings after applying deadzone');
  await page.screenshot({path:path.join(out,'calibration-lcd.png'),scale:'css'});
  await page.locator('#calibration-reset').click();await page.waitForFunction(()=>document.querySelector('#calibration-saved').textContent.includes('0%'));
  await page.locator('#controller-done').click();await page.locator('#controller-dialog').waitFor({state:'hidden'});
  await page.evaluate(()=>window.__deckGamepadTest.set([{id:'Steam Deck Controller',index:0,mapping:'standard',connected:true,axes:[0,0,0,0],buttons:[]},{id:'DualSense Wireless Controller',index:1,mapping:'standard',connected:true,axes:[.01,0,0,0],buttons:[]}]));await page.waitForFunction(()=>document.querySelector('#controller-2 small').textContent.includes('DualSense'));
  await page.locator('#controller-2').click();await page.locator('#controller-calibration-tab').click();await page.locator('#calibration-deadzone').press('Home');for(let i=0;i<5;i++)await page.locator('#calibration-deadzone').press('ArrowRight');await page.locator('#calibration-apply').click();await page.waitForFunction(()=>document.querySelector('#calibration-saved').textContent.includes('5%'));assert.deepEqual(await page.evaluate(()=>window.deck.controllerInfo().then(s=>s.deadzones)),[0,.05]);await page.locator('#controller-done').click();
  assert.deepEqual(errors,[]);console.log('PASS: live visual sticks/buttons/triggers, persistent test screen, both slots visible, LCD/desktop/portrait controller layouts, no page errors.');
 }finally{await app.close();}
 for(const model of ['Windows desktop','ROG Ally','Mac']){
  const other=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args,env:{...env,DECK_DEVICE_MODEL:model,DECK_DATA_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'deck-controller-host-'))}});
  try{
   const page=await other.firstWindow();await page.waitForFunction(()=>typeof state==='object'&&!!window.__deckGamepadTest);
   // Even a controller reporting Steam Deck cannot turn a Windows/Mac host into one.
   await page.evaluate(()=>window.__deckGamepadTest.set([{id:'Steam Deck Controller',index:0,mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))}]));
   await page.waitForFunction(()=>document.querySelector('#controller-1 small').textContent==='Steam Deck controls');
   await page.locator('#controller-1').click();await page.locator('#controller-dialog').waitFor({state:'visible'});
   assert.equal(await page.locator('#controller-mode-title').textContent(),'Gamepad input · built-in or external',model);
   assert.ok(!(await page.locator('#controller-mode-copy').textContent()).includes('Keep Steam running'),model);
  }finally{await other.close();}
 }
 console.log('PASS: conservative model names, raw driver details, correct standard visual mappings, Steam Deck desktop instructions absent on Windows/ROG Ally/Mac hosts.');
})().catch(e=>{console.error(e);process.exitCode=1;});
