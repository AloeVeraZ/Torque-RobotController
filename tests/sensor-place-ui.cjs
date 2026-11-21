'use strict';
// Setup in the real app, on the first run's Test setup (a generated robot attached like a CAD import): where the IMU and
// odometry sit and which way they face (ui/sim-sensor-place.js).
//  A. Mechanisms → Chassis → Control Hub: which IMU, typed inches, a part clicked on the model, the logo/USB pickers (the
//     same setting as the hub's mounting), and the marker on the model;
//  B. a Pinpoint: its sticker side and the warning when it is down; an OTOS: its Y arrow is its odometry heading;
//  C. Configure: an IMU on an I2C bus marked as the robot's IMU names it in Setup.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/sensor-place-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/sensor-place');fs.mkdirSync(out,{recursive:true});
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-sense-')),env={...process.env,DECK_HEADLESS:'1',DECK_TEST_SETUP:'1',DECK_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);await page.setViewportSize({width:1280,height:800});
    await page.evaluate(()=>window.deck.page('simulation'));await page.waitForFunction(()=>state.page==='simulation');
    await page.waitForFunction(()=>/Deck test robot.*fitted/.test(document.querySelector('#sim-mesh-size').textContent),null,{timeout:90000});
    const project=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')));
    await page.evaluate(()=>window.deck.page('setup'));await page.waitForFunction(()=>state.page==='setup');
    await page.click('#sim-setup-step-robot');await page.click('#rs-control-card [data-controller="ftc"]');await page.waitForTimeout(250);
    await page.click('#sim-setup-step-mechanisms');await page.click('[data-garage="chassis:controller"]');await page.waitForTimeout(400);
    // A. The IMU's card.
    const imu='#mech-controller-imu';await page.waitForSelector(`${imu} [data-sense-board="imu"]`);
    assert.equal(await page.inputValue('#sense-imu-kind'),'controlHub');
    await page.selectOption('#sense-face-imu-a','left');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot.hubLogo==='left');
    assert.equal(await page.inputValue('#sim-hub-logo'),'left','the hub mounting picker shows the same');
    assert.equal(await page.locator('#sense-face-imu-b option[value="right"]').isDisabled(),true,'the USB end cannot face along the logo');
    await page.fill(`${imu} [data-sense-pos="imu:x"]`,'3.5');await page.press(`${imu} [data-sense-pos="imu:x"]`,'Tab');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot.sensorPlace?.imu?.x===3.5);
    assert.equal((await project()).robot.sensorPlace.imu.from,'typed');
    await page.selectOption('#sense-imu-kind','navx');await page.waitForSelector(`${imu} .cal-sense-note.bad`);assert.match(await page.textContent(`${imu} .cal-sense-note.bad`),/gyroscope, not as an IMU/);
    await page.selectOption('#sense-imu-kind','controlHub');await page.waitForTimeout(250);
    // A part clicked on the model: its box gives x, y and z.
    await page.click(`${imu} [data-sense-place="imu"]`);await page.waitForTimeout(250);
    const canvas=page.locator('#mech-model-preview canvas');await canvas.scrollIntoViewIfNeeded();const b=await canvas.boundingBox();
    let placed=null;for(const [fx,fy] of [[.5,.5],[.45,.45],[.55,.5],[.5,.6],[.4,.55]]){await page.mouse.click(b.x+b.width*fx,b.y+b.height*fy);await page.waitForTimeout(400);placed=(await project()).robot.sensorPlace?.imu;if(placed?.from==='cad')break;
      if(!await page.locator(`${imu} [data-sense-place="imu"][aria-pressed="true"]`).count())await page.click(`${imu} [data-sense-place="imu"]`);}
    assert.equal(placed?.from,'cad',`clicked on the model: ${JSON.stringify(placed)}`);assert.ok(Number.isFinite(placed.z)&&placed.part,'its box gives a height and its name');
    assert.match(await page.textContent(`${imu} [data-sense-said]`),/^Logo left, USB ports \w+ · /);
    assert.equal((await project()).robot.hubLogo,'left','a CAD pick leaves which way it faces alone');
    await page.waitForTimeout(600);await page.screenshot({path:path.join(out,'imu-placed.png')});
    // Or found by itself: the Control Hub and the Pinpoint by their parts' names, the IMU at the hub's chip; which way it faces stays as picked.
    await page.click(`${imu} [data-sensors-find]`);await page.waitForFunction(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot.sensorPlace?.imu?.part==='Control Hub');
    {const r=(await project()).robot;assert.equal(r.sensorPlace.imu.from,'cad');assert.equal(r.hubLogo,'left','found, not turned');assert.match(await page.textContent(`${imu} .sim-chassis-find [role=status]`),/^Found the IMU in “Control Hub”/);
      // The Test robot's hub stands on edge at the back left: its chip is inside that box.
      const p=r.sensorPlace.imu;assert.ok(p.x<-2&&p.x>-8.2&&p.y>5&&p.y<6.8,JSON.stringify(p));assert.equal(r.sensorPlace.pinpoint?.part,'Pinpoint');}
    // B. A Pinpoint and an OTOS on the chassis.
    await page.evaluate(()=>{const s=document.querySelector('#sim-localization');s.value='fused';s.dispatchEvent(new Event('change'));});await page.waitForTimeout(400);
    await page.click('[data-garage="chassis:pinpoint"]');await page.waitForSelector('#mech-drive-ports [data-sense-board="pinpoint"]');
    await page.selectOption('#sense-face-pinpoint-a','down');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot.sensorPlace?.pinpoint?.a==='down');
    assert.match(await page.textContent('#mech-drive-ports [data-sense-board="pinpoint"]'),/sticker side up/);assert.equal(await page.locator('#sense-face-pinpoint-b').count(),0,'no arrow to pick on a Pinpoint');
    await page.screenshot({path:path.join(out,'pinpoint.png')});
    await page.evaluate(()=>{const s=document.querySelector('#sim-localization');s.value='optical';s.dispatchEvent(new Event('change'));});await page.waitForTimeout(400);
    await page.click('[data-garage="chassis:otos"]');await page.waitForSelector('#mech-drive-ports [data-sense-board="otos"]');
    await page.selectOption('#sense-face-otos-b','left');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot.odometry?.otos?.heading===0);
    await page.fill('#mech-drive-ports [data-sense-pos="otos:y"]','-2');await page.press('#mech-drive-ports [data-sense-pos="otos:y"]','Tab');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot.odometry?.otos?.y===-2);
    await page.screenshot({path:path.join(out,'otos.png')});
    // C. Configure: the hub's IMU on I2C bus 0 is marked as the robot's IMU; marking it names it in Setup.
    await page.click('#setup-view .flow-steps [data-flow=configure]');await page.waitForSelector('#rs-step-configure [data-ce-hub]');
    await page.click('#rs-step-configure [data-ce-hub="0"]');await page.click('#rs-step-configure [data-ce-family="i2c"][data-ce-bus="0"]');await page.waitForSelector('#rs-step-configure [data-ce-role]');
    const role=page.locator('#rs-step-configure [data-ce-role]').first();assert.equal(await role.inputValue(),'imu','the IMU Setup uses is shown as the robot’s IMU');
    await role.selectOption('');await page.waitForFunction(()=>/no longer uses/.test(document.querySelector('#rs-step-configure .ce-note')?.textContent||''));
    await page.locator('#rs-step-configure [data-ce-role]').first().selectOption('imu');await page.waitForFunction(()=>/is the robot’s IMU/.test(document.querySelector('#rs-step-configure .ce-note')?.textContent||''));
    assert.equal((await project()).robot.sensorPlace?.imu?.kind,'controlHub');await page.screenshot({path:path.join(out,'configure-role.png')});
    assert.deepEqual(errors,[]);console.log('sensor place UI: ok');
  }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
