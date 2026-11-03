'use strict';
// Real Chromium key defaults and the Electron keyboard-to-gamepad path.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright'),root=path.join(__dirname,'..');
(async()=>{
 const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Keyboard robot fixture</title><body tabindex="-1"><button id="action">Robot action</button><input id="text" aria-label="Robot text"><div style="height:5000px">Scrollable robot page</div><script>window.keys=[];window.clicks=0;addEventListener("keydown",e=>keys.push(e.code));document.querySelector("button").onclick=()=>clicks++;</script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.2',resolve));
 const env={...process.env,DECK_HEADLESS:'0',DECK_CONTROLLER_TEST:'1',DECK_DATA_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'deck-keyboard-app-'))};delete env.ELECTRON_RUN_AS_NODE;
 let app,wm;
 try{
  if(process.platform==='linux'&&env.DECK_TEST_WINDOW_MANAGER==='openbox'){wm=spawn('openbox',[],{stdio:'ignore'});await new Promise((resolve,reject)=>{wm.once('spawn',resolve);wm.once('error',reject);});}
  app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root,...(env.DECK_ELECTRON_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[])],env});
  const station=await app.firstWindow();station.setDefaultTimeout(15000);await station.waitForFunction(()=>typeof state==='object'&&!!window.deck);
  await station.evaluate(()=>window.deck.controllerSource('keyboard'));
  await station.evaluate(url=>window.deck.open({url,name:'Keyboard test'}),`http://127.0.0.2:${server.address().port}/`);await station.waitForFunction(()=>state.url&&!state.loading);
  const robot=app.context().pages().find(page=>page.url().startsWith('http://127.0.0.1:'));assert.ok(robot);robot.setDefaultTimeout(15000);
  // CDP key events bypass Electron's before-input-event; use native injection
  // for the complete physical-key -> gamepad -> browser-default regression.
  const sendKey=(type,key)=>app.evaluate(({webContents},{type,key})=>webContents.getAllWebContents().find(contents=>contents.getURL().startsWith('http://127.0.0.1:')).sendInputEvent({type,keyCode:key.replace('Arrow','')}),{type,key});
  await robot.evaluate(()=>{document.querySelector('#action').focus();scrollTo(0,200);});
  const scroll=await robot.evaluate(()=>scrollY);
  for(const [key,axis,value]of [['ArrowDown',3,1],['ArrowUp',3,-1],['ArrowRight',2,1],['ArrowLeft',2,-1],['w',1,-1]]){
   await sendKey('keyDown',key);await robot.waitForFunction(([axis,value])=>navigator.getGamepads()[0]?.axes[axis]===value,[axis,value]);
   await sendKey('keyUp',key);await robot.waitForFunction(()=>navigator.getGamepads()[0]?.axes.every(value=>value===0));
  }
  await sendKey('keyDown','Space');await robot.waitForFunction(()=>navigator.getGamepads()[0]?.buttons[0].pressed);await sendKey('keyUp','Space');
  await robot.waitForTimeout(200);assert.equal(await robot.evaluate(()=>scrollY),scroll,'controller keys scrolled the robot');assert.deepEqual(await robot.evaluate(()=>keys),[],'robot also received controller keys');assert.equal(await robot.evaluate(()=>clicks),0,'Space activated the focused robot button');
  await robot.locator('#text').fill('robot');await robot.keyboard.press('ArrowLeft');await robot.keyboard.type(' test');assert.equal(await robot.locator('#text').inputValue(),'robo testt','text editing must stay available');
  await robot.evaluate(()=>document.body.focus());await robot.keyboard.press('Control+f');assert.ok(await robot.evaluate(()=>keys.includes('KeyF')),'modifier chords should reach the page');
  await station.locator('#controller-1').click();await station.waitForFunction(()=>document.querySelector('#controller-dialog').open&&window.__deckControllerInput.state().keyboardKeys.includes('ArrowDown'));
  await station.evaluate(()=>{document.querySelector('#controller-input-tab').focus();document.querySelector('#controller-scroll').scrollTop=100;});
  const dialogScroll=await station.locator('#controller-scroll').evaluate(element=>element.scrollTop);
  for(const key of ['ArrowDown','ArrowUp','Space'])await station.keyboard.press(key);await station.waitForTimeout(200);assert.equal(await station.locator('#controller-scroll').evaluate(element=>element.scrollTop),dialogScroll,'keyboard diagnostics scrolled');
  await station.locator('#controller-done').click();await station.locator('#more').click();await station.locator('#menu-settings').click();await station.locator('#robot-name').fill('My robot');await station.keyboard.press('ArrowLeft');await station.keyboard.type(' test');assert.equal(await station.locator('#robot-name').inputValue(),'My robo testt');
  await station.locator('#discovery-allowed').focus();await station.keyboard.press('Space');assert.equal(await station.locator('#discovery-allowed').isChecked(),false,'controller Space must not toggle a focused checkbox');
  await station.evaluate(()=>window.deck.page('drive'));await station.evaluate(()=>window.deck.controllerSource('controller'));await robot.waitForFunction(()=>!window.__deckControllerInput.state().keyboardKeys.length);
  await station.evaluate(()=>window.deck.robotFocus());await robot.evaluate(()=>{document.body.focus();scrollTo(0,200);keys=[];});await sendKey('keyDown','ArrowDown');await sendKey('keyUp','ArrowDown');await robot.waitForFunction(()=>keys.includes('ArrowDown'));await robot.waitForFunction(()=>scrollY>200);
  console.log('PASS: keyboard drives both sticks and Space/A without scrolling or duplicate robot key/button actions; controller tester stays still; text editing works; choosing Controller restores normal keyboard scrolling.');
 }finally{await app?.close();wm?.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
