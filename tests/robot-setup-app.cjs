'use strict';
// One-button robot setup in the real app (Simulate → Run & review → Export → Send to robot), against the simulated
// Control Hub and its OnBot Java server:
//  A. a robot configured with other drive names and without two of the mechanism's devices: Deck takes the robot's
//     names, adds the two devices to a copy of its configuration (a port moved by hand swaps with the other), uploads and
//     builds; the Guided check runs from Calibrate (the simulated hub's stand-in check) and its answer goes into the
//     setup; and Drive opens with the autonomous selected;
//  B. a robot with no configuration: Deck scans its hubs and saves one with every device;
//  C. Calibrate → Live debug: Torque Debug put on the robot and run (the simulated hub's stand-in), a motor held to run
//     and read back, and the Mechanisms gates: the hub read by Live debug, the intake confirmed, pulsed and signed.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/robot-setup-app.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright'),{startUdpRobot,startOnBotJava,startDebugServer,listBuilt,CONFIG_XML}=require('../tools/ftc-sim.cjs'),RobotConfig=require('../ui/ftc/robot-config.js');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/robot-setup');fs.mkdirSync(out,{recursive:true});
// The robot and the app's station use their own loopback addresses, so this runs beside the other app tests.
const ROBOT='127.0.0.6',STATION='127.0.0.7',DEBUG_PORT=9337;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=20000,what='condition'){const end=Date.now()+ms;while(Date.now()<end){try{const v=await fn();if(v)return v;}catch{}await wait(150);}throw Error('Timed out: '+what);}
class Cdp{constructor(url){this.ws=new WebSocket(url);this.id=0;this.cbs=new Map();this.ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&this.cbs.has(d.id)){this.cbs.get(d.id)(d);this.cbs.delete(d.id);}};this.ready=new Promise(r=>this.ws.onopen=r);}
  send(method,params={}){const id=++this.id;return new Promise(r=>{this.cbs.set(id,r);this.ws.send(JSON.stringify({id,method,params}));});}
  async eval(expr){const r=await this.send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails).slice(0,400));return r.result?.result?.value;}
  async shot(file){const r=await this.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(file,Buffer.from(r.result.data,'base64'));}
  close(){this.ws.close();}}
(async()=>{
  // Pedro Quickstart drive names, and no indexer or turret yet.
  const xml=CONFIG_XML.replace('"front_left"','"leftFront"').replace('"front_right"','"rightFront"').replace('"back_left"','"leftRear"').replace('"back_right"','"rightRear"')
    .replace('            <goBILDA5202SeriesMotor name="indexer" port="1" />\n','').replace('            <goBILDA5202SeriesMotor name="turret" port="2" />\n','');
  const robot=await startUdpRobot({address:ROBOT,configurations:[{name:'competition',xml}]}),onbot=await startOnBotJava({address:ROBOT,port:8080,buildMs:300,built:listBuilt(robot.sim)});
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-robot-setup-')),env={...process.env,DECK_HEADLESS:'1',DECK_CONTROLLER_TEST:'1',DECK_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  // This test's robot is the simulated one. A real Control Hub on this computer's USB takes no part: with this in ADB's place, nothing can talk to it.
  env.ADB=process.platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','System32','where.exe'):'/bin/false';
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root,`--remote-debugging-port=${DEBUG_PORT}`,`--deck-sim-open=${path.join(root,'examples/biobuzz-red-auto.json')}`,'--deck-sim-tab=run'],env});
  const errors=[];let drive=null,debug=null;
  try{
    const page=await app.firstWindow();page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
    await app.evaluate(({app},[robotHost,station])=>{const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),{FtcSocket}=req('./src/ftc.cjs'),open=FtcSocket.prototype.open;
      FtcSocket.prototype.open=function(){if(this.host===robotHost)this.localAddress=station;return open.call(this);};},[ROBOT,STATION]);
    const loaded=()=>page.waitForFunction(()=>document.querySelector('#sim-telemetry')?.children.length>0,null,{timeout:120000});
    const exportPanel=async()=>{await page.evaluate(()=>document.querySelector('button[data-tab=run]')?.click());
      await page.evaluate(()=>[...document.querySelectorAll('button')].find(x=>/^Export$/.test(x.textContent.trim())&&x.closest('[data-panel=run]'))?.click());await page.waitForTimeout(500);};
    const text=s=>page.textContent(s),texts=s=>page.$$eval(s,l=>l.map(x=>x.textContent)),finished=()=>page.waitForFunction(()=>/Built on the robot|could not build|Could not|did not/.test(document.querySelector('#sim-send-status').textContent),null,{timeout:90000});
    const shotPlan=async name=>{await page.locator('#sim-send-plan').evaluate(e=>e.scrollIntoView({block:'start'}));await page.waitForTimeout(150);await page.screenshot({path:path.join(out,name+'.png')});};
    await loaded();await page.evaluate(host=>window.deck.save({name:'Sim hub',url:host,kind:'ftc'}),ROBOT);await exportPanel();
    // Send to robot offers the USB cable or Wi-Fi; on Wi-Fi it reaches the robot saved in Settings.
    const useWifi=async()=>{await page.click('[data-link=wifi]');await page.waitForFunction(host=>document.querySelector('#sim-send-robot').value===host,ROBOT);};
    await useWifi();

    // ---- A: the robot's own names, two devices added to a copy of its configuration.
    await page.click('#sim-send-go');await page.waitForSelector('#sim-send-confirm:not([hidden])',{timeout:40000});
    assert.match(await text('#sim-send-status'),/6 of 10 device names do not match the configuration “competition”/);
    const steps=await texts('#sim-send-steps li');assert.equal(steps.length,3,steps.join('\n'));
    assert.match(steps[0],/“leftFront” for “front_left”, “rightFront” for “front_right”, “leftRear” for “back_left”, “rightRear” for “back_right”/);
    assert.match(steps[1],/Save “competition Deck”: a copy of “competition” with 2 devices added/);assert.match(steps[2],/Upload BiobuzzRedAuto\.java and BiobuzzRedCheck\.java to Sim hub/);
    assert.equal(await text('#sim-send-summary'),'','nothing is left unmatched');assert.equal(await text('#sim-send-yes'),'Save and send');
    assert.equal(await text('#sim-send-plan-title'),'Added to a copy of “competition”, saved as “competition Deck”');
    const port=label=>page.$eval(`#sim-send-ports select[aria-label="Port for ${label}"]`,s=>s.selectedOptions[0].textContent);
    assert.deepEqual([await port('Shooter 1 feeder'),await port('Shooter 1 turret')],['Expansion Hub 2 motor port 1','Expansion Hub 2 motor port 2'],'the free motor ports');
    assert.match(await page.$eval('#sim-send-ports select[aria-label="Port for Shooter 1 turret"]',s=>[...s.options].map(o=>o.textContent).join('|')),/Control Hub motor port 0 \(has leftFront\)/);
    // The turret is already wired to port 1: picking it there moves the feeder to port 2.
    const turret=page.locator('#sim-send-ports select[aria-label="Port for Shooter 1 turret"]');await turret.selectOption(await turret.evaluate(s=>[...s.options].find(o=>/^Expansion Hub 2 motor port 1/.test(o.textContent)).value));
    assert.deepEqual([await port('Shooter 1 feeder'),await port('Shooter 1 turret')],['Expansion Hub 2 motor port 2','Expansion Hub 2 motor port 1']);
    await shotPlan('a-plan');
    await page.click('#sim-send-yes');await finished();
    const done=await text('#sim-send-status');assert.match(done,/^Saved “competition Deck” as the robot's active configuration \(the robot restarted\)\. Built on the robot in/);
    assert.match(done,/run “BIOBUZZ red auto check \(Deck\)” \(TeleOp\) first.*In Drive, “BIOBUZZ red auto \(Deck\)” is selected when you open this robot\./);
    assert.deepEqual(await texts('#sim-send-ports li'),['indexer Shooter 1 feeder: Expansion Hub 2 motor port 2, goBILDA Yellow Jacket','turret Shooter 1 turret: Expansion Hub 2 motor port 1, goBILDA Yellow Jacket'],'the wiring list stays');
    await shotPlan('a-done');
    assert.equal(robot.sim.active,'competition Deck');assert.equal(robot.sim.restarts,1);assert.equal(robot.sim.configurations.find(c=>c.name==='competition').xml,xml,'the robot\'s own configuration is kept as it was');
    const saved=RobotConfig.parse(robot.sim.configurations.find(c=>c.name==='competition Deck').xml).devices;
    assert.deepEqual(saved.filter(d=>['indexer','turret'].includes(d.name)).map(d=>[d.name,d.hub,d.port,d.tag]),[['turret','Expansion Hub 2',1,'goBILDA5202SeriesMotor'],['indexer','Expansion Hub 2',2,'goBILDA5202SeriesMotor']]);
    const files=Object.fromEntries(onbot.files),auto=Object.entries(files).find(([f])=>/BiobuzzRedAuto\.java$/.test(f))?.[1]||'';
    assert.ok(auto.includes('"leftFront"')&&auto.includes('"rightRear"')&&auto.includes('"indexer"'),'the code was generated with the robot\'s names');
    assert.equal(RobotConfig.check(await page.evaluate(()=>window.DeckSimFtc.robotNeeds(JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot,'fused',JSON.parse(localStorage.getItem('deck-simulation-project-v2')).mechanisms)),{devices:saved}).ok,true,'every name now matches the new configuration');
    // The guided check, run from here: the simulated hub's stand-in asks about the front left wheel, then a servo.
    assert.deepEqual(robot.sim.opModes.filter(m=>m.source==='ONBOTJAVA').map(m=>m.name),['BIOBUZZ red auto (Deck)','BIOBUZZ red auto check (Deck)'],'the robot lists what it built');
    // The guided check is in Calibrate, which takes the Send to robot panel with it.
    await page.evaluate(()=>window.deck.page('calibrate'));await page.waitForFunction(()=>state.page==='calibrate');await page.click('#cal-tab-calibrate');await page.waitForSelector('#calibrate-view #sim-send');await page.click('#sim-check-start');await page.click('#sim-check-go');
    const answer=async label=>{const b=page.locator('#sim-check-answers button',{hasText:label});await b.waitFor({timeout:20000}).catch(async e=>{throw Error(`${e.message}
Guided check said: ${await text('#sim-check-status').catch(()=>'')} | ${await text('#sim-check-prompt').catch(()=>'')}`);});await b.click();};
    await answer('B · no, the other way');assert.equal(robot.sim.opState,'running');
    await answer('▲ move');await page.waitForFunction(()=>/Now at 0\.410\./.test(document.querySelector('#sim-check-prompt').textContent));await answer('A · save');
    await page.waitForFunction(()=>/^Done/.test(document.querySelector('#sim-check-step').textContent));
    assert.deepEqual(await texts('#sim-check-changes li'),['Front left wheel: turns the other way off.'],'a kicker position is not for this sweeper intake');
    await page.locator('#sim-check').evaluate(e=>e.scrollIntoView({block:'start'}));await page.waitForTimeout(150);await page.screenshot({path:path.join(out,'a-check.png')});
    // At Done the check keeps running, to try the mechanisms. Using the settings stops it, saves them and sends again:
    // what is left is the upload's confirmation.
    assert.equal(robot.sim.opState,'running');await page.click('#sim-check-apply');await page.waitForSelector('#sim-send-confirm:not([hidden])',{timeout:40000});
    assert.equal(robot.sim.opState,'stopped','the check was stopped first');assert.match(await text('#sim-check-status'),/^Saved 1 setting from the check\. Send to robot puts it on the robot\./);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot.devices.frontLeft.reversed),false);
    assert.equal(await text('#sim-send-yes'),'Upload and build');await page.click('#sim-send-yes');await finished();assert.match(await text('#sim-send-status'),/^Built on the robot/);
    assert.match(onbot.files.get(Object.keys(files).find(f=>/BiobuzzRedAuto\.java$/.test(f))),/motors\[0\]=map\.get\(DcMotorEx\.class, "leftFront"\); motors\[0\]\.setDirection\(DcMotorSimple\.Direction\.FORWARD\);/,'the check\'s answer is in the code on the robot');
    // Drive opens with the autonomous selected.
    await page.evaluate(host=>window.deck.open({url:host,name:'Sim hub',kind:'ftc'}),ROBOT);
    const target=await until(async()=>(await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find(t=>t.url.includes('ui/ftc/index.html')),20000,'Drive view');
    drive=new Cdp(target.webSocketDebuggerUrl);await drive.ready;
    const picked=await until(()=>drive.eval(`(()=>{const l=document.querySelector('#opmode-label').textContent;return l==='BIOBUZZ red auto (Deck)'?{label:l,config:document.querySelector('#config').textContent,toast:document.querySelector('#ds-toast').textContent}:null;})()`),20000,'the autonomous selected in Drive');
    assert.equal(picked.config,'competition Deck');assert.match(picked.toast,/BIOBUZZ red auto \(Deck\) is selected: Deck just sent it to the robot\.|Controller/);
    await drive.shot(path.join(out,'a-drive.png'));drive.close();drive=null;

    // ---- B: no configuration on the robot; back to the simulator, which closes the robot in Drive.
    robot.sim.configurations=[];robot.sim.active='No Config Set';
    await page.click('#simulate-tab');await loaded();await exportPanel();await useWifi();
    await page.click('#sim-send-go');await page.waitForSelector('#sim-send-confirm:not([hidden])',{timeout:40000});
    assert.match(await text('#sim-send-status'),/The robot has no active configuration\. Send to robot makes one for this code\./);
    const fresh=await texts('#sim-send-steps li');assert.match(fresh[0],/Save a new configuration “Deck biobuzz-red-auto” with the robot's hubs and 10 devices/);
    assert.equal(await text('#sim-send-plan-title'),'New configuration “Deck biobuzz-red-auto”');assert.match((await texts('#sim-send-ports li'))[4],/^imu IMU: Control Hub I2C bus 0 \(the hub’s own IMU\)$/);
    await shotPlan('b-plan');
    // At Steam Deck size the port list fits the panel: no sideways scrolling, every select inside its row.
    const size=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('ui/index.html'));const was=w.getContentSize();w.setContentSize(1280,800);return was;});await page.waitForTimeout(500);
    assert.ok(await page.$eval('#sim-send-ports',e=>e.scrollWidth<=e.clientWidth+1&&[...e.querySelectorAll('select')].every(s=>s.getBoundingClientRect().right<=s.closest('li').getBoundingClientRect().right+1)),'the port list fits the panel');
    await shotPlan('b-plan-deck');await app.evaluate(({BrowserWindow},[w,h])=>BrowserWindow.getAllWindows().find(x=>x.webContents.getURL().includes('ui/index.html')).setContentSize(w,h),size);
    await page.click('#sim-send-yes');await finished();assert.match(await text('#sim-send-status'),/^Saved “Deck biobuzz-red-auto” as the robot's active configuration/);
    assert.equal(robot.sim.active,'Deck biobuzz-red-auto');assert.equal(robot.sim.restarts,2);
    assert.deepEqual(RobotConfig.parse(robot.sim.configurations[0].xml).devices.map(d=>`${d.name}@${d.hub}:${d.bus!==undefined?'i2c'+d.bus:d.port}`),
      ['intake@Expansion Hub 2:0','shooter@Expansion Hub 2:1','indexer@Expansion Hub 2:2','turret@Expansion Hub 2:3','leftFront@Control Hub:0','rightFront@Control Hub:1','leftRear@Control Hub:2','rightRear@Control Hub:3','imu@Control Hub:i2c0','pinpoint@Control Hub:i2c1']);
    // Space stops a running check, as it stops an op mode on a Driver Station.
    await page.evaluate(()=>window.deck.page('calibrate'));await page.waitForFunction(()=>state.page==='calibrate');await page.click('#cal-tab-calibrate');await page.waitForSelector('#calibrate-view #sim-send');await page.click('#sim-check-start');await page.click('#sim-check-go');await page.locator('#sim-check-answers button').first().waitFor({timeout:20000});
    assert.equal(robot.sim.opState,'running');await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('#sim-check-run').hidden,null,{timeout:10000});
    assert.equal(robot.sim.opState,'stopped');assert.match(await text('#sim-check-status'),/^Stopped before the last step/);

    // ---- C: Live debug, then the Mechanisms gates, on the robot's own configuration.
    debug=await startDebugServer({address:ROBOT,sim:robot.sim,xml:robot.sim.configurations.find(c=>c.name===robot.sim.active).xml});
    await page.click('#cal-tab-debug');await page.click('[data-debug-install]');await page.click('[data-debug-go]');await until(()=>robot.sim.opModes.some(m=>/^TorqueDebug-/.test(m.name)),30000,'Torque Debug built');
    await page.waitForFunction(()=>/TorqueDebug-[0-9.-]+ is on the robot/.test(document.querySelector('[data-debug-status]').textContent));
    await page.click('[data-debug-start]');await page.waitForSelector('#cal-debug [data-port="motor:intake"]',{timeout:20000});assert.match(robot.sim.opMode,/^TorqueDebug-/);
    // The device check: every device listed; a motor runs at the chosen speed both ways and its encoder proves it.
    await page.waitForSelector('#cal-debug [data-check-row="intake"]');await page.click('#cal-debug [data-check-one="intake"]');await page.waitForSelector('#cal-debug [data-check-row="intake"][data-state="pass"]',{timeout:15000});assert.match(await page.locator('#cal-debug [data-check-row="intake"]').innerText(),/encoder counted/);
    await page.locator('#cal-debug [data-check]').evaluate(e=>e.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(out,'c-device-check.png')});
    // Held, the intake runs and its encoder counts up; let go, it stops (the slider springs back to 0).
    const slider=page.locator('#cal-debug [data-hold][data-name="intake"]');await slider.scrollIntoViewIfNeeded();const box=await slider.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*.85,box.y+box.height/2,{steps:4});await wait(700);
    const held=debug.positions[debug.manifest.motors.indexOf('intake')];await page.mouse.up();assert.ok(held>200,'the held intake turned ('+held+' ticks; robot heard '+JSON.stringify(debug.commands.filter(c=>c[0]!=='P').slice(-4))+')');
    await until(async()=>+(await text('#cal-debug [data-live="m:intake:pos"]'))>200,5000,'ticks shown');assert.equal(await slider.inputValue(),'0');
    await wait(500);const still=debug.positions[debug.manifest.motors.indexOf('intake')];await wait(500);assert.equal(debug.positions[debug.manifest.motors.indexOf('intake')],still,'stopped when let go');
    await page.locator('#cal-debug').evaluate(e=>e.scrollIntoView({block:'start'}));await page.waitForTimeout(150);await page.screenshot({path:path.join(out,'c-live-debug.png')});
    // Mechanisms: the hub counts as read; the intake is confirmed (G1), pulsed and signed (G2).
    await page.click('#cal-tab-calibrate');await page.click('#cal-tab-mechanisms');await page.waitForSelector('.cal-g0[data-state=pass]');
    const chip=g=>page.locator('[data-cal-mech-row="intake:0:roller"] [data-cal-gate="'+g+'"]').first();await chip('G1').click();await page.click('[data-cal-act=pass][data-cal-gate=G1]');await until(async()=>await chip('G1').getAttribute('data-state')==='pass',5000,'G1 passed');
    await chip('G2').click();await page.click('[data-cal-act=g2-pulse]');await page.waitForSelector('[data-cal-act=g2-sign][data-sign="1"]',{timeout:15000});assert.match(await text('.cal-gate .cal-debug-pulse'),/intake:pos changed by/);
    await page.click('[data-cal-act=g2-sign][data-sign="1"]');await until(async()=>await chip('G2').getAttribute('data-state')==='pass',5000,'G2 passed');
    const cal=await page.evaluate(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).calibration);assert.equal(cal.hub.source,'live');assert.equal(cal.mechs['intake:0:roller'].motorSign,1);assert.equal(cal.mechs['intake:0:roller'].bind,'m:intake:vel');
    await page.screenshot({path:path.join(out,'c-gates.png')});
    // The Camera tab: the simulated webcam tunes itself the way the FTC docs say, and the view turns.
    await page.click('#cal-tab-camera');await page.waitForSelector('#cal-camera [data-cam-canvas]',{state:'visible'});await page.selectOption('#cam-moving','1');await page.selectOption('#cam-rotate','90');assert.ok((await page.locator("#cal-camera [data-cam-canvas]").evaluate(e=>e.style.transform)).includes("rotate(90deg)"));await page.selectOption('#cam-rotate','0');
    await page.click('#cal-camera [data-cam-tune]');await page.waitForFunction(()=>/Best: exposure/.test(document.querySelector('[data-cam-result]').textContent),null,{timeout:20000});assert.match(await text('[data-cam-result]'),/exposure 5 ms, gain 255/);assert.equal(await page.inputValue('#cam-exposure'),'5');
    await page.waitForFunction(()=>/Tag 584/.test(document.querySelector('[data-cam-tags]').textContent),null,{timeout:5000});await page.locator('#cal-camera').evaluate(e=>e.scrollIntoView({block:'start'}));await page.waitForTimeout(200);await page.screenshot({path:path.join(out,'c-camera.png')});
    await page.click('#cal-tab-debug');await page.click('[data-debug-start]');await until(()=>robot.sim.opState==='stopped',10000,'Torque Debug stopped');
    assert.deepEqual(errors,[]);
    console.log('PASS: robot names taken, two devices added to a copy of the configuration with a port swapped, built, checked with the Guided check, selected in Drive; a robot with no configuration got one from its scan; Live debug ran a motor and read it back, and the Mechanisms gates confirmed, pulsed and signed the intake.');
  }finally{drive?.close();await debug?.close();await app.close();await robot.close();await onbot.close();fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
