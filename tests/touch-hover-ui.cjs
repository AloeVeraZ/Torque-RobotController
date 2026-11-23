'use strict';
// A finger tap leaves no hover look behind. Taps and mouse moves go in as real input (the DevTools protocol's touch
// and mouse events, as a touchscreen and a trackpad send them): after a tap opens and closes a menu its button looks
// as it did before; once the mouse moves over it the hover look is back. It also checks that the hover really does
// stick when the page is not told about the finger, so a pass means something.
// The Driver Station is driven by a robot kept in memory, so this needs no loopback address and runs on any system.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/touch-hover-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..');

async function check(app,page,label,selector){
  // Colours change on a short ease, and a window that is not drawn never finishes one; read them settled.
  await page.emulateMedia({reducedMotion:'reduce'});
  const cdp=await app.context().newCDPSession(page);
  const box=await page.locator(selector).boundingBox();assert.ok(box,`${label}: the button is on screen`);
  const x=box.x+box.width/2,y=box.y+box.height/2;
  const look=()=>page.evaluate(s=>{const e=document.querySelector(s),cs=getComputedStyle(e);return cs.backgroundColor+' '+cs.color;},selector);
  const marked=()=>page.evaluate(()=>'touch' in document.documentElement.dataset);
  const tap=async()=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(250);};
  // A touch-only screen: no mouse has moved on this page yet. Open the menu with a finger, then close it with another tap.
  const rest=await look();
  await tap();await tap();
  assert.equal(await marked(),true,`${label}: the page knows a finger was used`);
  assert.equal(await page.evaluate(s=>document.querySelector(s).matches(':hover'),selector),true,`${label}: the tapped button holds :hover, as a finger leaves it`);
  assert.equal(await look(),rest,`${label}: after two taps the button looks as it did before, with no hover look left on it`);
  // Without the mark the hover look would have stuck: that is the flaw this guards against.
  await page.evaluate(()=>{delete document.documentElement.dataset.touch;});const stuck=await look();
  assert.notEqual(stuck,rest,`${label}: without the mark the hover look would stay on the tapped button`);
  await tap();await tap();assert.equal(await look(),rest,`${label}: the next taps put the mark back`);
  // A mouse or trackpad move brings the hover look back.
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+1,y});await page.waitForTimeout(150);
  assert.equal(await marked(),false,`${label}: a mouse move clears the finger mark`);
  assert.equal(await look(),stuck,`${label}: the mouse over the button shows its hover look`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:box.y+box.height+200});await page.waitForTimeout(150);
  assert.equal(await look(),rest,`${label}: the mouse moving away takes the hover look off`);
  await cdp.detach();
}

(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-touch-hover-')),env={...process.env,DECK_HEADLESS:'1',DECK_CONTROLLER_TEST:'1',DECK_DATA_DIR:data,ADB:process.platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','System32','where.exe'):'/bin/false'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root,...(env.DECK_ELECTRON_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[])],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);await page.setViewportSize({width:1280,height:800});
    await app.evaluate(({app})=>{const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),{FtcSocket}=req('./src/ftc.cjs'),{SimController}=req('./tools/ftc-sim.cjs'),{Network}=req('./src/network.cjs');
      FtcSocket.prototype.open=async function(){this.address='10.9.9.9';const self=this;this.sim=new SimController({send:b=>{for(const fn of self.listeners)fn(new Uint8Array(b));}}).start();this.socket={close(cb){cb&&cb();}};return this;};
      FtcSocket.prototype.send=function(bytes){try{this.sim?.receive(new Uint8Array(bytes));}catch{}};FtcSocket.prototype.close=async function(){this.sim?.stop();this.sim=null;this.socket=null;this.listeners.clear();};
      Network.prototype.status=async()=>({connected:true,available:true,native:true,ssid:'9999-C-RC'});});
    await page.evaluate(()=>window.deck.page('drive'));await page.waitForFunction(()=>state.page==='drive');
    await check(app,page,'Torque, the ⋮ menu button','#more');
    // The Driver Station is its own page inside the window.
    await page.evaluate(()=>window.deck.save({name:'Practice bot',url:'10.9.9.9',kind:'ftc'}));
    await page.evaluate(()=>window.deck.open({url:'10.9.9.9',name:'Practice bot',kind:'ftc'}));await page.waitForFunction(()=>state.kind==='ftc'&&!state.loading);
    const station=app.context().pages().find(p=>p.url().includes('ui/ftc/index.html'));assert.ok(station,'the Driver Station opened');station.on('pageerror',e=>errors.push('Driver Station: '+e.message));
    await station.waitForFunction(()=>document.querySelector('#link-text').textContent==='Robot Connected');
    await check(app,station,'Driver Station, the ⋮ menu button','#ds-more');
    assert.deepEqual(errors,[]);
    console.log('Touch hover: a tap leaves no hover look behind in Torque and the Driver Station, and the mouse brings it back');
  }finally{await app.close().catch(()=>{});fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,6000));process.exit(1);});
