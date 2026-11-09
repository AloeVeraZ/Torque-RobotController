'use strict';
// Simulate → Setup in the real app, on the first run's Test setup (a generated robot attached like a CAD import):
//  A. step 2 is CAD and fits one screen: Import CAD and Remove model side by side, the model, which side is which, then the
//     chassis hitbox (length, width, height, mass) above the robot's parts; only the parts list scrolls;
//  B. wheels, power and driving style are on the Chassis card in Mechanisms, and work there;
//  C. the Starter Mecanum kit, whose Mechanisms step is closed, keeps them beside its size.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/cad-tab-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/cad-tab');fs.mkdirSync(out,{recursive:true});
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-cad-')),env={...process.env,DECK_HEADLESS:'1',DECK_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);await page.setViewportSize({width:1280,height:800});
    await page.evaluate(()=>window.deck.page('simulation'));await page.waitForFunction(()=>state.page==='simulation');
    await page.waitForFunction(()=>/Deck test robot.*fitted/.test(document.querySelector('#sim-mesh-size').textContent),null,{timeout:90000});
    const project=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')));
    // A. One screen.
    assert.equal(await page.locator('#sim-setup-step-robot').textContent(),'2 · CAD');assert.equal(await page.locator('[data-setup-page=field] .sim-setup-nav .primary').textContent(),'Next: CAD →');
    await page.click('#sim-setup-step-robot');await page.waitForTimeout(500);
    const fits=async(height,label)=>{await page.setViewportSize({width:1280,height});await page.waitForTimeout(300);
      const r=await page.evaluate(()=>{const box=s=>{const e=document.querySelector(s);if(!e||e.hidden||e.closest('[hidden]'))return null;const b=e.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,h:b.height};};
        return {doc:document.documentElement.scrollHeight,win:innerHeight,open:box('#sim-model-open'),remove:box('#sim-model-remove'),view:box('#sim-model-preview'),front:box('#sim-model-front'),bottom:box('#sim-model-bottom'),length:box('#sim-length'),mass:box('#sim-mass'),parts:box('#sim-parts'),list:box('#sim-part-list'),next:box('[data-setup-page=robot] .sim-setup-nav .primary')};});
      assert.ok(r.doc<=r.win,`${label}: the page does not scroll (${r.doc} > ${r.win})`);
      for(const k of ['open','remove','view','front','bottom','length','mass','next'])assert.ok(r[k]&&r[k].top>=0&&r[k].bottom<=r.win,`${label}: ${k} in view ${JSON.stringify(r[k])}`);
      assert.ok(r.remove.left>r.open.right&&r.remove.left-r.open.right<24&&Math.abs(r.remove.top-r.open.top)<2,'Remove model is beside Import CAD');
      assert.ok(Math.abs(r.front.top-r.bottom.top)<2,'the six sides fit one row');assert.ok(r.view.h>=(height<700?140:250),`${label}: the model has room: ${r.view.h}`);
      assert.ok(r.length.bottom<r.parts.top,'the hitbox is above the parts');assert.ok(Math.abs(r.length.top-r.mass.top)<2,'length, width, height and mass in one row');assert.ok(r.list&&r.list.bottom<=r.next.top,'the parts stay above the buttons');return r;};
    await fits(800,'Steam Deck');await page.waitForTimeout(2500);await page.screenshot({path:path.join(out,'cad-800.png')});await fits(1080,'1080p');await fits(660,'short');await page.setViewportSize({width:1280,height:800});
    // Only the fields it should have.
    const specs=await page.locator('.sim-robot-specs input:visible,.sim-robot-specs select:visible').evaluateAll(l=>l.map(e=>e.id));assert.deepEqual(specs,['sim-length','sim-width','sim-height','sim-mass'],'the hitbox is all there is');
    assert.equal(await page.locator('#sim-footprint').textContent(),'','no words under a size that fits');assert.equal(await page.locator('.sim-robot-cad h3:visible').count(),0);
    // A long parts list scrolls by itself.
    await page.setViewportSize({width:1280,height:640});await page.waitForTimeout(300);
    {const list=await page.locator('#sim-part-list').evaluate(e=>{for(let i=0;i<60;i++)e.append(e.firstElementChild.cloneNode(true));e.scrollTop=9999;return {scrolled:e.scrollTop>0,doc:document.documentElement.scrollHeight,win:innerHeight};});assert.ok(list.scrolled,'the parts scroll');assert.ok(list.doc<=list.win,'the page does not');}
    await page.setViewportSize({width:1280,height:800});
    // Choosing a part keeps the screen as it is.
    await page.locator('#sim-part-list button').first().click();await page.waitForSelector('#sim-part-pick:not([hidden])');assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight),'the part’s roles fit');await page.screenshot({path:path.join(out,'cad-part.png')});await page.click('#sim-part-clear');
    // B. Wheels, power and driving style are on the chassis.
    await page.click('#sim-setup-step-mechanisms');await page.waitForTimeout(300);
    for(const id of ['sim-rpm','sim-wheel','sim-maxspeed','sim-drive-style'])assert.equal(await page.locator(`#mech-drive #${id}`).isVisible(),true,`${id} is on the Chassis card`);
    await page.fill('#sim-wheel','96');await page.press('#sim-wheel','Tab');await page.fill('#sim-maxspeed','0.6');await page.press('#sim-maxspeed','Tab');await page.selectOption('#sim-drive-style','field');await page.waitForTimeout(200);
    {const p=await project();assert.equal(p.robot.wheelDiameterMm,96);assert.equal(p.tuning.maxPathSpeed,0.6);assert.equal(p.robot.driveStyle,'field');}
    // The chassis asks only for ports: no model or gear ratio, and a port leaves the typed Wheel RPM alone.
    await page.fill('#sim-rpm','416');await page.press('#sim-rpm','Tab');
    for(const gone of ['[data-wire-model]','[data-wire-ratio]','[data-wire-kind]'])assert.equal(await page.locator(`#mech-drive-ports ${gone}`).count(),0,`no ${gone}`);
    assert.match(await page.locator('label[for=sim-maxspeed]').textContent(),/^Default auto chassis motor power · 0–1/);
    // Each wheel is a part of the chassis, a tile under Chassis that opens it alone with its port.
    await page.click('[data-garage="chassis:frontLeft"]');assert.equal(await page.locator('#sim-rpm').isVisible(),false,'a wheel shows itself, not the chassis settings');
    await page.selectOption('[id="wire-chassis-robot.frontLeft"]','control:2');await page.waitForTimeout(250);
    {const p=await project();assert.equal(p.robot.driveRpm,416,'the wheels keep the RPM typed');assert.equal(p.robot.wiring.devices['robot.frontLeft'].hub,'control');assert.equal(p.robot.wiring.devices['robot.frontLeft'].port,2);assert.equal(await page.inputValue('#sim-rpm'),'416');}
    assert.equal(await page.inputValue('[id="wire-chassis-robot.frontLeft"]'),'control:2','the choice stays on screen');await page.click('[data-garage="chassis"]');
    await page.screenshot({path:path.join(out,'chassis.png')});
    // Kiwi swerve: three drive motors and three steering servos, each steering with its absolute encoder.
    await page.selectOption('#sim-drivetrain','kiwiSwerve');await page.waitForFunction(()=>document.querySelector('#mech-drive-ports').textContent.includes('Front steering'),null,{timeout:15000});
    assert.deepEqual(await page.locator('#mech-drive-ports .sim-chassis-row label').allTextContents(),['Front drive motor','Front steering','Front steering absolute encoder','Back left drive motor','Back left steering','Back left steering absolute encoder','Back right drive motor','Back right steering','Back right steering absolute encoder']);
    assert.ok(await page.locator('[id="wire-chassis-robot.steerFront"] option',{hasText:/servo port 1/i}).count(),'steering takes a servo port');assert.ok(await page.locator('[id="wire-chassis-encoder-robot.steerFront"] option',{hasText:/analog port 1/i}).count(),'its encoder an analog port');
    await page.click('[data-garage="chassis:front"]');
    {const servo=await page.locator('[id="wire-chassis-robot.steerFront"] option',{hasText:/Control Hub servo port 1/i}).getAttribute('value'),analog=await page.locator('[id="wire-chassis-encoder-robot.steerFront"] option',{hasText:/Control Hub analog port 1/i}).getAttribute('value');
      await page.selectOption('[id="wire-chassis-robot.steerFront"]',servo);await page.waitForTimeout(250);await page.selectOption('[id="wire-chassis-encoder-robot.steerFront"]',analog);await page.waitForTimeout(250);
      const w=(await project()).robot.wiring,enc=w.sensors.find(s=>s.for==='robot.steerFront');assert.equal(w.devices['robot.steerFront'].port,1);assert.equal(enc.hub,'control');assert.equal(enc.port,1);assert.equal(await page.inputValue('[id="wire-chassis-encoder-robot.steerFront"]'),analog);
      await page.selectOption('[id="wire-chassis-encoder-robot.steerFront"]','');await page.waitForTimeout(250);assert.equal((await project()).robot.wiring.sensors.some(s=>s.for==='robot.steerFront'),false,'Not assigned takes it away');await page.selectOption('[id="wire-chassis-encoder-robot.steerFront"]',analog);await page.waitForTimeout(250);}
    await page.setViewportSize({width:1280,height:1500});await page.evaluate(()=>document.querySelector('#mech-drive-ports').scrollIntoView({block:'center'}));await page.waitForTimeout(300);await page.screenshot({path:path.join(out,'kiwi.png')});await page.setViewportSize({width:1280,height:800});await page.click('[data-garage="chassis"]');
    // A differential module has no steering: its encoder is on the module.
    await page.selectOption('#sim-drivetrain','diffSwerve2');await page.waitForFunction(()=>document.querySelector('#mech-drive-ports').textContent.includes('Left drive, motor 1'),null,{timeout:15000});assert.deepEqual(await page.locator('#mech-drive-ports .sim-chassis-row label').allTextContents(),['Left drive, motor 1','Left drive module absolute encoder','Left drive, motor 2','Right drive, motor 1','Right drive module absolute encoder','Right drive, motor 2']);
    await page.selectOption('#sim-drivetrain','mecanum');await page.waitForFunction(()=>document.querySelector('#mech-drive-ports').textContent.includes('Front left drive motor'),null,{timeout:15000});assert.equal(await page.locator('#mech-drive-ports [data-wire-chassis-encoder]').count(),0,'mecanum has no module encoder');
    // The chassis picker: five drivetrains, each with its count of motors or modules, and what steers a swerve module.
    assert.deepEqual(await page.$$eval('#sim-drive-family option',l=>l.map(o=>o.textContent)),['Mecanum','Tank','Kiwi (3 omni wheels)','Swerve','Differential swerve']);
    assert.equal(await page.inputValue('#sim-drive-family'),'mecanum');assert.equal(await page.locator('#sim-drive-count-box').isHidden(),true,'mecanum has four motors, no choice');assert.equal(await page.locator('#sim-drive-steer-box').isHidden(),true);
    assert.match(await page.textContent('#sim-drive-parts'),/^4 drive motors\.$/);
    await page.selectOption('#sim-drive-family','swerve');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot.drivetrain==='coaxSwerve');
    assert.equal(await page.inputValue('#sim-drive-count'),'4');assert.equal(await page.textContent('#sim-drive-count-label'),'Modules');
    await page.selectOption('#sim-drive-count','3');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot.drivetrain==='kiwiSwerve');
    await page.waitForFunction(()=>document.querySelectorAll('#mech-drive-ports .sim-chassis-module:not([data-module^="pod:"]):not([data-module=pinpoint]):not([data-module=otos])').length===3,null,{timeout:15000});assert.match(await page.locator('#mech-drive-ports .sim-chassis-module-head').first().innerText(),/Front module/);
    assert.match(await page.textContent('#sim-drive-parts'),/^3 drive motors, 3 continuous servos, and an absolute encoder on each module if it has one\.$/);
    // Each module is a part of the chassis: a tile under Chassis that opens it alone, where it is typed or clicked on the model.
    await page.waitForFunction(()=>document.querySelectorAll('#mech-rail .sim-tile-sub[data-garage]').length>=3);
    assert.deepEqual(await page.$$eval('#mech-rail .sim-tile-sub[data-garage]',l=>l.map(b=>b.dataset.garage).filter(k=>/^chassis:/.test(k)&&!/^chassis:(pod:|pinpoint$|otos$)/.test(k))),['chassis:controller','chassis:front','chassis:backLeft','chassis:backRight'],'what runs the robot on top, then the modules');
    assert.equal(await page.locator('[data-module="front"]').isVisible(),false,'Chassis shows the drivetrain, not each module');
    await page.click('[data-garage="chassis:front"]');assert.equal(await page.locator('[data-module="front"]').isVisible(),true);assert.equal(await page.locator('[data-module="backLeft"]').isVisible(),false);
    await page.fill('[data-wheel-pos="front"][data-wheel-axis="x"]','6');await page.press('[data-wheel-pos="front"][data-wheel-axis="x"]','Tab');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot.wheelPos?.front?.x===6);
    await page.waitForFunction(()=>/6\.00 in from the centre/.test(document.querySelector('[data-module="front"]').textContent));
    // Click it on the model: moving over the model says what a click there would take, before anything is clicked.
    await page.click('[data-wheel-place="front"]');assert.equal(await page.getAttribute('[data-wheel-place="front"]','aria-pressed'),'true');
    {const c=await page.locator('#mech-model-preview canvas').boundingBox();for(let i=0;i<12;i++)await page.mouse.move(c.x+c.width*(.3+i*.04),c.y+c.height*(.4+i*.02),{steps:2});await page.mouse.move(c.x+c.width*.43,c.y+c.height*.42,{steps:3});}
    await page.waitForFunction(()=>/click to (take|place it here)/.test(document.querySelector('#mech-model-help').textContent));
    await page.keyboard.press('Escape');
    await page.click('[data-wheels-find]');await page.waitForFunction(()=>/Import the robot’s CAD first|No drive wheels found in the CAD|Found \d+ wheel/.test(document.querySelector('[data-wheels-said]').textContent));
    await page.click('[data-garage="chassis"]');await page.selectOption('#sim-drive-steer','servo');await page.waitForFunction(()=>/3 servos/.test(document.querySelector('#sim-drive-parts').textContent));
    {const p=await project(),models=['steerFront','steerBackLeft','steerBackRight'].map(k=>p.robot.wiring.devices['robot.'+k]?.model);assert.ok(models.every(Boolean),'every module steers with a servo: '+models);}
    await page.selectOption('#sim-drive-steer','crservo');await page.waitForFunction(()=>/3 continuous servos/.test(document.querySelector('#sim-drive-parts').textContent));
    await page.selectOption('#sim-drive-family','tank');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot.drivetrain==='tank');
    assert.deepEqual(await page.$$eval('#sim-drive-count option',l=>l.map(o=>o.value)),['2','4']);assert.equal(await page.textContent('#sim-drive-count-label'),'Motors');
    await page.selectOption('#sim-drive-count','2');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot.drivetrain==='tank2');
    await page.selectOption('#sim-drive-family','mecanum');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot.drivetrain==='mecanum');
    // An impossible value there stops the steps after it, not the ones before.
    await page.fill('#sim-rpm','');await page.waitForTimeout(200);assert.equal(await page.locator('[data-setup-page=mechanisms] .sim-setup-nav .primary').isDisabled(),true);assert.equal(await page.locator('#sim-setup-step-robot').isDisabled(),false);await page.fill('#sim-rpm','312');await page.press('#sim-rpm','Tab');await page.waitForTimeout(200);assert.equal(await page.locator('[data-setup-page=mechanisms] .sim-setup-nav .primary').isDisabled(),false);
    // What runs the robot is a part of Chassis, not a step: Control Hub or MotionModule, then that one's own settings.
    assert.equal(await page.locator('#sim-setup-step-controller').isVisible(),false,'no Robot controller step');assert.equal(await page.locator(`${'[data-setup-page=mechanisms] .sim-setup-nav .primary'}`).textContent(),'Next: path planning →');
    for(const gone of ['#sim-wiring-open','#sim-wiring-dialog'])assert.equal(await page.locator(gone).count(),0,`${gone} is gone`);assert.equal(await page.locator('#mech-controller [data-wire-model],#mech-controller [data-wire-ratio]').count(),0);
    await page.click('[data-garage="chassis:controller"]');await page.waitForTimeout(250);assert.equal(await page.locator('#mech-controller [data-controller]').count(),2,'Control Hub or MotionModule');assert.equal(await page.locator('#mech-controller #sim-ctl-sensors').isVisible(),false,'position sensing is + Add to Chassis');
    await page.click('#mech-controller [data-controller="ftc"]');await page.waitForTimeout(250);assert.equal(await page.locator('[data-garage="chassis:controller"] b').textContent(),'Control Hub','the tile is what was picked');assert.equal(await page.locator('#sim-hub-mount').isVisible(),true,'how the hub is mounted');await page.screenshot({path:path.join(out,'controller.png')});
    // Remove model: the drop zone takes its place, and it is still one screen.
    await page.click('#sim-setup-step-robot');await page.waitForTimeout(200);await page.click('#sim-model-remove');await page.waitForFunction(()=>document.querySelector('#sim-model-box').hidden);
    {const r=await page.evaluate(()=>({doc:document.documentElement.scrollHeight,win:innerHeight,remove:document.querySelector('#sim-model-remove').hidden,drop:document.querySelector('#sim-model-drop').getBoundingClientRect().height,parts:document.querySelector('#sim-parts').hidden}));assert.equal(r.remove,true,'nothing to remove');assert.ok(r.doc<=r.win,'one screen');assert.ok(r.drop>200,`the drop zone fills it: ${r.drop}`);assert.equal(r.parts,true);}
    await page.screenshot({path:path.join(out,'cad-empty.png')});
    // C. The kit: no CAD and no Mechanisms step, so wheels and power stay beside its size.
    await page.click('#sim-setup');const all=await page.locator('.sim-setup-option').evaluateAll(l=>l.map(o=>[o.dataset.setupId,o.textContent]));const kit=all.find(o=>/Starter Mecanum/.test(o[1]));const fixed=all.find(o=>/A301/.test(o[1]));
    await page.locator(`.sim-setup-option[data-setup-id="${kit[0]}"]`).click();await page.waitForFunction(i=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).setupId===i,kit[0]);await page.waitForTimeout(300);
    assert.equal(await page.locator('#sim-setup-step-robot').textContent(),'2 · Robot');await page.click('#sim-setup-step-robot');await page.waitForTimeout(300);
    for(const id of ['sim-length','sim-mass','sim-rpm','sim-wheel','sim-maxspeed','sim-drive-style'])assert.equal(await page.locator(`[data-setup-page=robot] #${id}`).isVisible(),true,`${id} on the kit`);
    await page.screenshot({path:path.join(out,'kit.png')});
    // Its Mechanisms step is closed too, so its ports are on a Chassis step of its own, and they work there.
    assert.equal(await page.locator('#sim-setup-step-controller').textContent(),'3 · Chassis');await page.click('#sim-setup-step-controller');await page.waitForTimeout(300);assert.equal(await page.locator('[data-setup-page=controller] #mech-drive-ports').isVisible(),true,'the kit sets its ports');const kitRow=page.locator('#mech-drive-ports select').first(),kitPort=await kitRow.locator('option').nth(2).getAttribute('value');await kitRow.selectOption(kitPort);await page.waitForTimeout(250);assert.equal(await kitRow.inputValue(),kitPort);await page.screenshot({path:path.join(out,'kit-controller.png')});
    await page.click('#sim-setup');await page.locator(`.sim-setup-option[data-setup-id="${fixed[0]}"]`).click();await page.waitForFunction(i=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).setupId===i,fixed[0]);await page.waitForTimeout(300);await page.click('#sim-setup-step-robot');await page.waitForTimeout(200);assert.equal(await page.locator('#sim-rpm').isVisible(),false,'the fixed demo keeps its card');assert.equal(await page.locator('#sim-preset-lock').isVisible(),true);
    // Back on a team's robot they return to the chassis.
    const team=all.find(o=>!o[0].startsWith('preset:'));await page.click('#sim-setup');await page.locator(`.sim-setup-option[data-setup-id="${team[0]}"]`).click();await page.waitForFunction(i=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).setupId===i,team[0]);await page.waitForTimeout(300);assert.equal(await page.locator('#mech-drive #sim-rpm').count(),1);assert.equal(await page.locator('#mech-drive #mech-drive-ports').count(),1,'the ports come back too');
    assert.deepEqual(errors,[]);console.log('CAD tab: all passed');
  }finally{await app.close().catch(()=>{});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,1500));process.exit(1);});
