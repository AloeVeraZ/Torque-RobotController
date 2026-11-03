'use strict';
// Native visual/interaction check against the existing UDP Control Hub simulator.
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const {startUdpRobot}=require('../tools/ftc-sim.cjs');
const root=path.join(__dirname,'..'),out=path.join(root,'test-results','design');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const robot=await startUdpRobot({address:'127.0.0.2'});let robotClosed=false,app;
 const env={...process.env,DECK_HEADLESS:'1',DECK_DEVICE_MODEL:'Steam Deck LCD',DECK_DATA_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'deck-design-'))};delete env.ELECTRON_RUN_AS_NODE;
 try{
  app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root,...(env.DECK_ELECTRON_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[])],env});
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);
  const window=await app.browserWindow(page);
  await app.evaluate(({app})=>{const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),{Network}=req('./src/network.cjs');Network.prototype.status=async()=>({connected:true,available:true,native:true,ssid:'Robotics Lab'});Network.prototype.scan=async()=>[{ssid:'Robotics Lab',security:'WPA2'},{ssid:'Robot Hotspot',security:'WPA2'}];});
  await page.evaluate(()=>window.deck.network());
  await page.locator('#drive-tab').click();await page.locator('#welcome').waitFor({state:'visible'});
  await page.screenshot({path:path.join(out,'drive-ready.png'),scale:'css'});
  for(const [name,url] of [['MotionModule','192.168.4.1'],['City Tech Robot','192.168.68.20']])await page.evaluate(robot=>window.deck.save(robot),{name,url});
  await page.locator('#more').click();await page.locator('#menu-settings').click();await page.waitForFunction(()=>state.robots.length===2&&document.querySelectorAll('.saved-row').length===2);
  await page.screenshot({path:path.join(out,'settings-saved-robots.png'),fullPage:true,scale:'css'});
  await page.locator('#wifi-picker').click();await page.locator('.wifi-row').filter({hasText:'Robot Hotspot'}).click();
  await page.screenshot({path:path.join(out,'wifi-picker.png'),fullPage:true,scale:'css'});await page.keyboard.press('Escape');
  await page.evaluate(()=>window.deck.open({url:'127.0.0.2',name:'FTC simulator',kind:'ftc'}));
  await page.waitForFunction(()=>state.kind==='ftc'&&!state.loading);
  const station=app.context().pages().find(p=>p.url().includes('ui/ftc/index.html'));assert.ok(station);station.on('pageerror',e=>errors.push(e.message));
  await station.waitForFunction(()=>document.querySelector('#link-text').textContent==='Robot Connected');
  await station.locator('#teleop-list').click();await station.locator('#picker-list button').filter({hasText:'Field Centric'}).click();
  await station.locator('#main-action').click();await station.waitForFunction(()=>document.body.dataset.robotState==='init');
  await station.locator('#main-action').click();await station.waitForFunction(()=>document.body.dataset.robotState==='running');
  await station.evaluate(()=>{window.statusAnnouncements=0;new MutationObserver(()=>window.statusAnnouncements++).observe(document.querySelector('#status-line'),{childList:true,characterData:true,subtree:true});});
  await page.waitForTimeout(300);assert.equal(await station.evaluate(()=>window.statusAnnouncements),0,'unchanged status re-announced on each robot packet');
  for(const [width,height,name] of [[1280,800,'lcd'],[1366,768,'laptop'],[1920,1080,'desktop'],[390,844,'portrait']]){
   await window.evaluate((w,s)=>{w.setMinimumSize(0,0);w.setContentSize(s.width,s.height);},{width,height});await page.waitForTimeout(150);
   const layout=await station.evaluate(()=>({width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,stop:document.querySelector('#main-action').getBoundingClientRect().toJSON()}));
   assert.ok(layout.scroll<=layout.width+1,name+' FTC screen overflows horizontally');
   if(width>720)assert.ok(layout.stop.y>=0&&layout.stop.bottom<=layout.height,name+' STOP is not visible');
   assert.equal(await station.locator('#main-action').getAttribute('aria-label'),'STOP');
   await station.screenshot({path:path.join(out,'ftc-running-'+name+'.png'),fullPage:true,scale:'css'});
  }
  await window.evaluate(w=>w.setContentSize(1280,800));
  await station.locator('#main-action').click();await station.waitForFunction(()=>document.body.dataset.robotState==='stopped');assert.equal(robot.sim.opState,'stopped');
  assert.ok(await station.evaluate(()=>window.statusAnnouncements>0),'changed robot state was not announced');
  robot.sim.battery='10.50';await station.waitForFunction(()=>document.querySelector('#volts-tile').classList.contains('danger'));
  assert.ok((await station.locator('#volts').textContent()).includes('10.50 V'));
  await station.screenshot({path:path.join(out,'ftc-low-voltage.png'),scale:'css'});
  await robot.close();robotClosed=true;await station.waitForFunction(()=>document.body.dataset.robotState==='disconnected');
  assert.equal(await station.locator('#main-action').isDisabled(),true);assert.equal(await station.locator('#link-text').textContent(),'Searching for Robot');
  await station.screenshot({path:path.join(out,'ftc-disconnected.png'),scale:'css'});
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('#drive-tab').evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
  assert.deepEqual(errors,[]);
  console.log('PASS: saved-robot/Wi-Fi visuals; FTC real UDP INIT/START/STOP, low-voltage and lost-link states, visible STOP at LCD/1366/1920 sizes, portrait layout and reduced motion.');
 }finally{if(app)await app.close();if(!robotClosed)await robot.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
