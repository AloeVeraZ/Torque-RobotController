'use strict';
// Real Chromium touch events against the native app, with simulated networking,
// standardized gamepads and a local robot form. No physical Wi-Fi or motors.
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.join(__dirname,'..'),out=path.join(root,'test-results/touch');fs.mkdirSync(out,{recursive:true});
const sessions=new WeakMap();
async function cdp(page){if(!sessions.has(page)){const session=await page.context().newCDPSession(page);await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});sessions.set(page,session);}return sessions.get(page);}
async function tap(page,locator){await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();assert.ok(b,'touch target missing');const session=await cdp(page);await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,radiusX:2,radiusY:2,force:1}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
async function key(page,label){await tap(page,page.locator('.touch-keyboard').getByRole('button',{name:label,exact:true}).first());}
async function type(page,text){for(const character of text)await key(page,character===' '?'Space':character);}
const pad=(id,index,y=0)=>({id,index,connected:true,mapping:'standard',axes:[0,y,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))});
(async()=>{
 const wm=process.platform==='linux'&&process.env.DECK_TEST_WINDOW_MANAGER==='openbox'?spawn('openbox',[],{stdio:'ignore'}):null;if(wm)await new Promise((resolve,reject)=>{wm.once('spawn',resolve);wm.once('error',reject);});
 const server=http.createServer((_q,r)=>{if(_q.url==='/challenge'&&!_q.headers.authorization){r.writeHead(401,{'WWW-Authenticate':'Basic realm="Touch robot"'});r.end('Sign in');return;}r.setHeader('Content-Type','text/html; charset=utf-8');r.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Touch robot fixture</title><style>body{font:16px system-ui;background:#111214;color:white;margin:0;padding:30px}input,button{min-height:48px;font:16px system-ui;display:block;margin:8px 0 20px}input{width:250px}</style><h1>Simulated robot sign-in</h1><form><label for="secret">Robot password</label><input id="secret" type="password"><button>Sign in</button></form><script>document.querySelector("form").onsubmit=e=>{e.preventDefault();window.submitted=true};setInterval(()=>window.sample=Array.from(navigator.getGamepads()).map(p=>p?{id:p.id,y:p.axes[1],a:p.buttons[0].pressed}:null),10)</script>');});await new Promise(r=>server.listen(0,'127.0.0.2',r));
 const env={...process.env,DECK_HEADLESS:'0',DECK_CONTROLLER_TEST:'1',DECK_DEVICE_MODEL:'Steam Deck LCD',DECK_DATA_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'deck-touch-ui-'))};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root,...(env.DECK_ELECTRON_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[])],env});
 let page;
 try{
  page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));console.log('Touch check: app launched.');
  await app.evaluate(({app})=>{const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),{Network}=req('./src/network.cjs');Network.prototype.status=async()=>({connected:true,native:true,ssid:'Touch test network (simulated)'});Network.prototype.scan=async()=>Array.from({length:24},(_,i)=>({ssid:'Simulated network '+(i+1),security:'WPA2',signal:90-i}));Network.prototype.join=async(ssid,password)=>password?{connected:true,native:true,ssid}:{needsPassword:true,ssid};});
  await page.waitForFunction(()=>typeof state==='object'&&!!window.deck&&hardware.model==='Steam Deck LCD');const native=await app.browserWindow(page);await native.evaluate(w=>w.setContentSize(1280,800));
  // Bootstrap may have queried the OS before the test transport was installed.
  // Refresh the fixture SSID explicitly so the current network is always the
  // 25th entry, independent of process startup timing or the runner's Wi-Fi.
  await page.evaluate(()=>window.deck.network());await page.waitForFunction(()=>wifi.ssid==='Touch test network (simulated)'&&scanPromise===null);
  await tap(page,page.locator('#more'));await tap(page,page.locator('#menu-settings'));await page.waitForFunction(()=>state.page==='settings');
  console.log('Touch check: Settings opened with a real touch event.');
  // The on-screen keyboard is off by default; switch it on as the three-dot menu does.
  await page.evaluate(()=>{const on=document.querySelector('#touch-keyboard-auto');if(!on.checked)document.querySelector('#menu-keyboard').click();});
  const undersized=await page.evaluate(()=>[...document.querySelectorAll('button,input:not([type=checkbox]),select,summary')].filter(e=>e.getClientRects().length&&!e.disabled).map(e=>({id:e.id||e.textContent.trim().slice(0,20),rect:e.getBoundingClientRect()})).filter(e=>e.rect.height<43.5||e.rect.width<43.5).map(e=>e.id));assert.deepEqual(undersized,[],'small touch targets');
  await tap(page,page.locator('#wifi-picker'));await page.waitForFunction(()=>document.querySelectorAll('.wifi-row').length===25);
  const box=await page.locator('#wifi-list').boundingBox(),session=await cdp(page),x=box.x+box.width/2,from=box.y+box.height-30,to=box.y+30;
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:from}]});for(let step=1;step<=8;step++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:from+(to-from)*step/8}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForFunction(()=>document.querySelector('#wifi-list').scrollTop>0);
  await tap(page,page.locator('#wifi-picker'));
  console.log('Touch check: Wi-Fi list swiped.');
  await tap(page,page.locator('#robot-url'));await page.waitForFunction(()=>document.querySelector('#touch-keyboard')?.matches(':popover-open'));
  const url=`http://127.0.0.2:${server.address().port}/`;await type(page,url);assert.equal(await page.locator('#robot-url').inputValue(),url);
  await key(page,'Backspace');await key(page,'/');assert.equal(await page.locator('#robot-url').inputValue(),url);
  const field=await page.locator('#robot-url').boundingBox(),keyboard=await page.locator('#touch-keyboard').boundingBox();assert.ok(field.y+field.height<=keyboard.y,'keyboard covers its field');
  assert.ok(await page.locator('#touch-keyboard button').evaluateAll(nodes=>nodes.every(node=>{const r=node.getBoundingClientRect();return r.width>=43.5&&r.height>=43.5;})),'small LCD keyboard keys');
  await page.screenshot({path:path.join(out,'settings-touch-keyboard.png'),scale:'css'});await key(page,'Done');
  console.log('Touch check: address entered with on-screen keys.');
  await session.send('Emulation.setTouchEmulationEnabled',{enabled:false});await page.locator('#robot-name').click();await page.waitForFunction(()=>document.querySelector('#touch-keyboard').matches(':popover-open'));await page.locator('#touch-keyboard').getByRole('button',{name:'Done',exact:true}).click();await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await tap(page,page.locator('#wifi-picker'));await tap(page,page.locator('.wifi-row').filter({hasText:'Simulated network 12'}));await tap(page,page.locator('#join-network'));await page.locator('#wifi-dialog').waitFor({state:'visible'});
  await tap(page,page.locator('#wifi-password'));await key(page,'a');await key(page,'Shift');await key(page,'B');await key(page,'Lowercase');await key(page,'Symbols');await key(page,'!');await key(page,'ABC');await key(page,'3');assert.equal(await page.locator('#wifi-password').inputValue(),'aB!3');assert.equal(await page.locator('#wifi-password').getAttribute('type'),'password');
  const password=await page.locator('#wifi-password').boundingBox(),modalKeys=await page.locator('#touch-keyboard').boundingBox();assert.ok(password.y+password.height<=modalKeys.y,'keyboard covers modal password field');await page.screenshot({path:path.join(out,'wifi-password-touch-keyboard.png'),scale:'css'});await key(page,'Done');await tap(page,page.locator('#wifi-cancel'));
  await tap(page,page.locator('#open-robot'));await page.waitForFunction(()=>state.url&&!state.loading&&state.page==='drive');
  const robot=app.context().pages().find(p=>p.url().startsWith('http://127.0.0.1:'));assert.ok(robot);robot.setDefaultTimeout(15000);
  let pads=[pad('USB controller',0,.25),null,null,pad('Steam Deck Controller',3,-.65)];
  const feed=async()=>{await page.evaluate(p=>window.__deckGamepadTest.set(p),pads);await robot.evaluate(p=>window.__deckGamepadTest.set(p),pads);};await feed();await robot.waitForFunction(()=>sample?.[0]?.y===-.65);
  assert.equal(await page.evaluate(()=>Array.from(navigator.getGamepads()).every(p=>p===null)),true,'dashboard received robot controls');
  assert.deepEqual(await page.evaluate(()=>window.deck.controllerInfo().then(s=>s.slots.map(p=>p.index))),[3,0]);
  await tap(page,page.locator('#more'));await robot.waitForFunction(()=>sample[0].y===0);await tap(page,page.locator('#more'));await robot.waitForFunction(()=>sample[0].y===-.65);
  // Gaming/desktop compositors may expose a screen tap as a mouse click. The
  // known-handheld default must still open its keyboard without a physical one.
  await robot.locator('#secret').click();
  await page.waitForFunction(()=>window.deck.controllerInfo().then(s=>s.paused));
  let helper;for(let i=0;i<80&&!helper;i++){helper=app.context().pages().find(p=>p.url().endsWith('touch-keyboard-native.html'));if(!helper)await page.waitForTimeout(50);}assert.ok(helper,'native touch keyboard absent');helper.setDefaultTimeout(15000);await helper.locator('.touch-keyboard button').first().waitFor();
  assert.deepEqual(await helper.evaluate(()=>[typeof require,typeof window.deck,typeof window.touchKeyboardNative.press]),['undefined','undefined','function']);assert.equal(await robot.evaluate(()=>typeof window.touchKeyboardNative),'undefined');
  await robot.waitForFunction(()=>sample[0].y===0);
  await type(helper,'touch:123');assert.equal(await robot.locator('#secret').inputValue(),'touch:123');assert.equal(await robot.locator('#secret').getAttribute('type'),'password');assert.ok(!(await helper.locator('body').textContent()).includes('touch:123'));
  await key(helper,'Move caret left');await key(helper,'0');assert.equal(await robot.locator('#secret').inputValue(),'touch:1203');await key(helper,'Backspace');await key(helper,'Move caret right');assert.equal(await robot.locator('#secret').inputValue(),'touch:123');
  const bounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].contentView.children.map(v=>({url:v.webContents.getURL(),bounds:v.getBounds()}))),bot=bounds.find(v=>v.url.startsWith('http://127.0.0.1:')),keys=bounds.find(v=>v.url.endsWith('touch-keyboard-native.html'));assert.ok(bot.bounds.y+bot.bounds.height<=keys.bounds.y,'native keyboard covers robot fields');
  await key(helper,'Done');await page.waitForFunction(()=>window.deck.controllerInfo().then(s=>!s.paused));assert.equal(await robot.evaluate(()=>sample[0].y),0,'held input resumed during text editing');
  pads[3].axes[1]=0;await feed();pads[3].axes[1]=-.65;await feed();await robot.waitForFunction(()=>sample[0].y===-.65);
  await tap(page,page.locator('#controller-1'));await page.waitForFunction(()=>document.querySelector('#controller-dialog').open);await page.waitForFunction(()=>document.querySelector('#controller-axis-1').textContent==='-0.65');await tap(page,page.locator('#controller-done'));
  await tap(page,page.locator('#robot-fullscreen'));await page.waitForFunction(()=>state.robotFullscreen);await tap(robot,robot.locator('#secret'));await helper.locator('.touch-keyboard button').first().waitFor();await page.waitForFunction(()=>window.deck.controllerInfo().then(s=>s.paused));
  await key(helper,'Enter');await robot.waitForFunction(()=>window.submitted===true);await page.waitForFunction(()=>window.deck.controllerInfo().then(s=>!s.paused));
  await tap(robot,robot.locator('#secret'));await page.waitForFunction(()=>window.deck.controllerInfo().then(s=>s.paused));await robot.evaluate(()=>{void fetch('/challenge').catch(()=>{});});await page.locator('#auth-dialog').waitFor({state:'visible'});
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].contentView.children.find(v=>v.webContents.getURL().endsWith('touch-keyboard-native.html')).getVisible()),false,'robot keyboard covers the HTTP sign-in dialog');
  await page.waitForFunction(()=>!state.robotFullscreen&&innerHeight===800);
  await tap(page,page.locator('#auth-username'));await type(page,'driver');await key(page,'Done');await tap(page,page.locator('#auth-password'));await type(page,'secret');await key(page,'Done');await tap(page,page.locator('#auth-form button[type=submit]'));await page.locator('#auth-dialog').waitFor({state:'hidden'});
  await page.evaluate(()=>window.deck.close());assert.deepEqual(errors,[]);
  console.log('PASS: real touch taps/swipes, 44px targets, touch-only URL entry/editing, Wi-Fi and robot passwords, Shift/Symbols/caret keys/Enter, HTTP authentication handoff, touch menu/diagnostics/fullscreen, neutral robot inputs while typing, built-in C1/external C2 detection with no dashboard gamepad enumeration. Physical touch panels/OS emulation remain device checks.');
 }catch(error){console.error('Touch failure:',error.message);if(page){console.error('Fixture state:',JSON.stringify(await page.evaluate(()=>({page:state.page,ssid:wifi.ssid,rows:document.querySelectorAll('.wifi-row').length,picker:document.querySelector('#wifi-picker').getAttribute('aria-expanded')})).catch(()=>null)));await page.screenshot({path:path.join(out,'failure.png'),scale:'css'}).catch(()=>{});}throw error;}finally{await app.close();wm?.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
