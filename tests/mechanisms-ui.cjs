'use strict';
// Simulate → Mechanisms in the real app, on the first run's Test setup: only what a new student needs.
//  A. no log of what the CAD held, no Configure from Setup, no range test, no Actuators sections; one Feeder and one Turret card;
//  B. every device row is the same few choices in the same order, with one sensor list that starts at No sensor;
//  C. a ramp has one fold time, and a range from 0 that a negative number flips;
//  D. a ramp can run on a DC motor or a servo of three types; a turret takes a second servo and a gear train.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/mechanisms-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/mechanisms');fs.mkdirSync(out,{recursive:true});
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-mech-ui-')),env={...process.env,DECK_HEADLESS:'1',DECK_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    const tile=async key=>{await page.click(`[data-garage="${key}"]`);await page.waitForTimeout(200);};
    const project=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);await page.setViewportSize({width:1280,height:900});
    await page.evaluate(()=>window.deck.page('simulation'));await page.waitForFunction(()=>state.page==='simulation');
    await page.waitForFunction(()=>/Deck test robot.*fitted/.test(document.querySelector('#sim-mesh-size').textContent),null,{timeout:90000});
    await page.click('#sim-setup-step-mechanisms');await page.waitForTimeout(800);
    // A. What is gone.
    assert.deepEqual(await page.locator('.sim-mech-toolbar button').allTextContents(),['+ Add mechanism','Configure from CAD']);
    for(const gone of ['#mech-from-setup','#mech-cad-details','#mech-hub-list','#mech-motion','#mech-fly-control','.sim-mech-devices'])assert.equal(await page.locator(gone).count(),0,`${gone} is gone`);
    assert.equal(await page.locator('.sim-mech-main details:not(#mech-joints details)').count(),0,'nothing is folded away in a details section');
    {const text=await page.locator('.sim-mech-main').innerText();for(const gone of ['What was found','Actuators','Range of motion','Flywheel and turret on the robot','Gear ratio after the motor','Set in Setup'])assert.ok(!text.includes(gone),`no “${gone}”`);}
    // Configure from CAD says one line, and no log appears.
    await page.click('#mech-from-cad');await page.waitForFunction(()=>/From your CAD|Nothing in your CAD/.test(document.querySelector('#mech-list-status').textContent),null,{timeout:60000});assert.ok((await page.locator('#mech-list-status').textContent()).length<220,'one line');
    {const tiles=await page.locator('#mech-rail .sim-tile b').allTextContents();for(const want of ['Chassis','Feeder','Turret','Preloads','Moving parts'])assert.ok(tiles.includes(want),`${want} tile: ${tiles}`);assert.equal(await page.locator('.sim-tile[aria-pressed=true]').count(),1);}
    await tile('feeder');assert.equal(await page.locator('#mech-feeder').isVisible(),true,'one part at a time');assert.equal(await page.locator('#mech-drive').isVisible(),false);assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight),'one screen');await page.screenshot({path:path.join(out,'garage.png')});
    await tile('turret');assert.equal(await page.locator('#mech-turret').isVisible(),true);assert.match(await page.locator('#mech-gears').textContent()+await page.locator('#mech-gear-add').textContent(),/gear pair/i);await tile('moving');assert.equal(await page.locator('#mech-joints').isVisible(),true);await page.screenshot({path:path.join(out,'moving.png')});
    assert.equal(await page.locator('[data-part^="shooter"] [data-wire-row*="indexer"]').count(),0,'the feeder is not under a shooter');assert.equal(await page.locator('[data-part^="shooter"] [data-wire-row*="turretMotor"]').count(),0,'the turret is not under a shooter');
    assert.deepEqual(await page.locator('#mech-feeder .sim-wire-head b').allTextContents(),['Feeder'],'one feeder');
    // B. Every row, the same way.
    const labels=async key=>page.locator(`[data-wire-row="${key}"] label`).evaluateAll(l=>l.map(x=>x.textContent));
    const roller=await labels('intakes.0.motor');for(const want of ['Runs on','Model','Plugged into','Sensor'])assert.ok(roller.includes(want),`${want} on the roller: ${roller}`);
    assert.equal(await page.locator('[data-wire-row="intakes.0.motor"] code').count(),0);assert.equal(await page.locator('[data-wire-row="intakes.0.motor"] .sim-wire-explain,[data-wire-row="intakes.0.motor"] .sim-wire-why').count(),0,'no sentences');
    await tile('intake:0:1');assert.equal(await page.locator('[data-wire-row="intakes.0.motor"]').isVisible(),true,'the rollers tile shows the rollers');assert.equal(await page.locator('[data-wire-row="intakes.0.servo"]').isVisible(),false,'and not the ramp');
    const pick=page.locator('[id="wire-sensor-pick-intakes.0.motor"]');assert.equal(await pick.locator('option').first().textContent(),'No sensor');assert.ok(!/tells/i.test((await pick.locator('option').allTextContents()).join()),'the list only names sensors');
    await pick.selectOption({label:'Motor encoder'});await page.waitForTimeout(250);assert.ok((await project()).robot.wiring.sensors.some(s=>s.for==='intakes.0.motor'));await page.locator('[id="wire-sensor-pick-intakes.0.motor"]').selectOption('');await page.waitForTimeout(250);assert.ok(!(await project()).robot.wiring?.sensors?.some(s=>s.for==='intakes.0.motor'),'No sensor takes it off');
    assert.deepEqual(await page.locator('.sim-mech-main .sim-wire-row.red').evaluateAll(l=>l.map(x=>x.querySelector('.sim-wire-problem')?.textContent)),[],'a port left unset is not an error, and the CAD leaves no model that cannot run');
    // C. The ramp.
    const ramp=(await project()).mechanisms.intakes.findIndex(i=>i.kind==='ramp');assert.ok(ramp>=0,'the test robot has a ramp');await tile(`intake:${ramp}:0`);assert.match(await page.locator('#mech-stats').textContent(),/Ramp/);
    await page.fill(`#mech-deploy-time-${ramp}`,'0.5');await page.press(`#mech-deploy-time-${ramp}`,'Tab');await page.waitForTimeout(200);{const i=(await project()).mechanisms.intakes[ramp];assert.equal(i.down,.5);assert.equal(i.up,.5,'one time, both ways');}
    const jointOf=async()=>(await project()).kinematics.joints.find(j=>j.drive?.signal==='deploy'&&j.drive.of==='intake:'+ramp);
    const before=await jointOf();await page.fill(`#mech-intake-range-${ramp}`,'75');await page.press(`#mech-intake-range-${ramp}`,'Tab');await page.waitForTimeout(400);
    if(before){const j=await jointOf();assert.equal(j.states.lowered-j.states.raised,75);assert.deepEqual(j.axis.map(x=>+x.toFixed(4)),before.axis.map(x=>+x.toFixed(4)),'the same way round');
      await page.fill(`#mech-intake-range-${ramp}`,'-75');await page.press(`#mech-intake-range-${ramp}`,'Tab');await page.waitForTimeout(400);const k=await jointOf();assert.equal(k.states.lowered-k.states.raised,75,'that way is now positive');assert.deepEqual(k.axis.map(x=>+(-x).toFixed(4)),before.axis.map(x=>+x.toFixed(4)),'the axis is flipped');assert.equal(await page.inputValue(`#mech-intake-range-${ramp}`),'75');}
    // D. What it runs on.
    const key=`intakes.${ramp}.servo`;assert.deepEqual(await page.locator(`[id="wire-type-${key}"] option`).allTextContents(),['DC motor','Servo']);assert.deepEqual(await page.locator(`[id="wire-servo-${key}"] option`).allTextContents(),['Set position','Linear','Continuous']);
    await page.selectOption(`[id="wire-type-${key}"]`,'dcmotor');await page.waitForTimeout(300);assert.equal((await project()).mechanisms.intakes[ramp].rampKind,'dcmotor');assert.equal(await page.inputValue(`[id="wire-type-${key}"]`),'dcmotor');
    await page.selectOption(`[id="wire-type-${key}"]`,{label:'Servo'});await page.waitForTimeout(300);assert.equal((await project()).mechanisms.intakes[ramp].rampKind,undefined);
    // A turret on two servos, through a gear train.
    await tile('turret');
    if(await page.locator('[data-turret-second="0"]').count()){await page.locator('[data-turret-second="0"]').click();await page.waitForTimeout(300);}
    {const p=await project();assert.ok(p.mechanisms.shooters[0].turretMotor2,'a second device');assert.notEqual(p.mechanisms.shooters[0].turretMotor2,p.mechanisms.shooters[0].turretMotor);}
    assert.ok(await page.locator('[data-wire-row="shooters.0.turretMotor2"]').count(),'its row');
    while(await page.locator('[data-gear-remove]').count()){await page.locator('[data-gear-remove]').first().click();await page.waitForTimeout(150);}
    await page.click('#mech-gear-add');await page.waitForTimeout(200);await page.click('#mech-gear-add');await page.waitForTimeout(200);await page.fill('#mech-gear-0-0','100');await page.press('#mech-gear-0-0','Tab');await page.waitForTimeout(150);await page.fill('#mech-gear-0-1','24');await page.press('#mech-gear-0-1','Tab');await page.waitForTimeout(150);await page.fill('#mech-gear-1-0','20');await page.press('#mech-gear-1-0','Tab');await page.waitForTimeout(150);await page.fill('#mech-gear-1-1','83');await page.press('#mech-gear-1-1','Tab');await page.waitForTimeout(250);
    assert.deepEqual((await project()).mechanisms.turret.gears,[[100,24],[20,83]]);assert.match(await page.locator('#mech-gears .hint').textContent(),/1 turns? of the/);
    await page.locator('#mech-turret').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'turret.png')});
    await page.locator('[data-turret-second-off="0"]').click();await page.waitForTimeout(250);assert.equal((await project()).mechanisms.shooters[0].turretMotor2,undefined);
    // Every number a tile runs on is an input there, and there is no tile of read-only numbers.
    assert.equal(await page.locator('#mech-stats dl').count(),0,'no read-only numbers');assert.equal(await page.locator('[data-garage="timing"]').count(),0,'their tile is gone');
    await tile('shooter:0');for(const id of ['#mech-rpm','#mech-spinup','#mech-pidf-p','#mech-pidf-f'])assert.ok(await page.locator(id).isVisible(),id+' on the shooter');
    await page.fill('#mech-rpm','2500');await page.press('#mech-rpm','Tab');await page.fill('#mech-spinup','1.2');await page.press('#mech-spinup','Tab');await page.fill('#mech-pidf-p','12');await page.press('#mech-pidf-p','Tab');await page.waitForTimeout(300);
    {const p=await project();assert.equal(p.mechanisms.shooter.rpm,2500);assert.equal(p.mechanisms.shooter.spinUp,1.2);assert.deepEqual(p.mechanisms.shooter.pidf,{p:12,i:0,d:0,f:0});}
    await page.fill('#mech-pidf-p','');await page.press('#mech-pidf-p','Tab');await page.waitForTimeout(200);assert.equal((await project()).mechanisms.shooter.pidf,undefined,'empty: the SDK default');
    await tile('feeder');for(const id of ['#mech-transfer','#mech-index'])assert.ok(await page.locator(id).isVisible(),id+' on the feeder');await page.fill('#mech-index','.5');await page.press('#mech-index','Tab');await page.waitForTimeout(200);assert.equal((await project()).mechanisms.indexer.seconds,.5);
    await page.locator('#mech-with-intake').check();await page.waitForTimeout(250);assert.equal((await project()).mechanisms.intakes[0].withFeeder,true,'the feeder and intake run as one');await page.locator('#mech-with-intake').uncheck();await page.waitForTimeout(250);assert.equal((await project()).mechanisms.intakes[0].withFeeder,undefined);
    // A model sets how fast things go; none chosen, REV's.
    await page.evaluate(()=>{const s=document.querySelector('select[data-wire-model="shooters.0.motor"]');s.value='gobilda-5203-1150';s.dispatchEvent(new Event('change',{bubbles:true}));});await page.waitForTimeout(300);assert.equal((await project()).mechanisms.shooter.rpm,1150,'a flywheel above its new motor’s top speed comes down to it');
    await page.evaluate(()=>{const s=document.querySelector('select[data-wire-model="shooters.0.motor"]');s.value='gobilda-5203-6000';s.dispatchEvent(new Event('change',{bubbles:true}));});await page.waitForTimeout(300);assert.equal((await project()).mechanisms.shooter.rpm,6000,'and one flat out stays flat out');
    await tile('turret');await page.evaluate(()=>{const s=document.querySelector('select[data-wire-model="shooters.0.turretMotor"]');if(s){s.value='axon-mini';s.dispatchEvent(new Event('change',{bubbles:true}));}});await page.waitForTimeout(300);{const p=await project();if(p.robot.wiring?.devices?.['shooters.0.turretMotor']?.model==='axon-mini')assert.equal(p.mechanisms.turret.speed,Math.round(666.7/((p.mechanisms.turret.gears||[]).reduce((r,[a,b])=>r*b/a,1)||1)),'a servo’s speed through the gears');}
    // Each model its own picture, not one maker's for all of them.
    assert.ok(await page.evaluate(()=>window.DeckHardware.pictureTag('axon-mini')!==window.DeckHardware.pictureTag('gobilda-speed')));
    // Reset: one part, and all of them, back where the CAD has it.
    await tile('moving');await page.locator('#mech-joints .sim-joint-row').first().click();await page.waitForTimeout(200);const tryIt=page.locator('#mech-joints [data-try]').first();await tryIt.fill('40');await page.waitForTimeout(100);assert.equal(await tryIt.inputValue(),'40');await page.locator('#mech-joints [data-j="reset-one"]').click();assert.equal(+await tryIt.inputValue(),0,'that part is back');await tryIt.fill('25');await page.locator('#mech-joints [data-j="reset"]').click();assert.equal(+await tryIt.inputValue(),0,'all are back');await page.locator('#mech-joints .sim-joint-row').first().click();
    // The keyboard walks the tiles, and the choice moves with it.
    await page.locator('[data-garage="chassis"]').focus();await page.keyboard.press('ArrowDown');await page.waitForTimeout(250);{const k=await page.evaluate(()=>document.activeElement?.dataset?.garage);assert.ok(k&&k!=='chassis','the next tile has focus: '+k);assert.equal(await page.locator(`[data-garage="${k}"]`).getAttribute('aria-pressed'),'true','and is chosen');}await page.keyboard.press('Home');await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.garage),'chassis');
    // A number says what it is and how to measure it, and closes again.
    const help=page.locator('[data-help="sim-rpm"]');await help.click();await page.waitForTimeout(100);assert.match(await page.locator('#sim-drive-settings .sim-help').textContent(),/Measure it:/);assert.equal(await help.getAttribute('aria-expanded'),'true');assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight),'help stays on one screen');await help.click();assert.equal(await page.locator('#sim-drive-settings .sim-help').count(),0);
    // Everything a student reads is readable, light and dark.
    const contrast=()=>page.evaluate(()=>{const rgb=v=>{const m=v.match(/[\d.]+/g).map(Number);return m;},lum=([r,g,b])=>{const f=x=>{x/=255;return x<=.03928?x/12.92:((x+.055)/1.055)**2.4;};return .2126*f(r)+.7152*f(g)+.0722*f(b);},back=e=>{for(let n=e;n;n=n.parentElement){const c=rgb(getComputedStyle(n).backgroundColor);if(c.length<4||c[3]>.9)return c;}return [255,255,255];};
      return [...document.querySelectorAll('.sim-tile b,.sim-tile small,.sim-hero-text h3,.sim-hero-text p,.sim-stats dt,.sim-stats dd,#mech-drive label,#mech-drive .hint')].filter(e=>e.offsetParent&&e.textContent.trim()).map(e=>{const a=lum(rgb(getComputedStyle(e).color)),b=lum(back(e));return [e.className||e.tagName,e.textContent.trim().slice(0,24),+((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toFixed(2)];}).filter(x=>x[2]<4.5);});
    for(const theme of ['dark','light']){await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);await tile('chassis');await page.waitForTimeout(150);assert.deepEqual(await contrast(),[],'contrast in '+theme);await page.screenshot({path:path.join(out,`chassis-${theme}.png`)});}
    assert.deepEqual(errors,[]);console.log('Mechanisms: all passed');
  }finally{await app.close().catch(()=>{});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,1500));process.exit(1);});
