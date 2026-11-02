'use strict';
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const {spawn}=require('node:child_process');
const root=path.join(__dirname,'..'),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<100;i++){if(await fn())return;await wait(50);}throw Error('Timed out: '+label);}
(async()=>{
 // A bare Xvfb server has no WM to apply/acknowledge fullscreen geometry. Run
 // the Linux check with a real WM and a shown window, like a desktop install.
 const wm=process.platform==='linux'&&process.env.DECK_TEST_WINDOW_MANAGER==='openbox'?spawn('openbox',[],{stdio:'ignore'}):null;
 if(wm)await new Promise((resolve,reject)=>{wm.once('spawn',resolve);wm.once('error',reject);});
 const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Fullscreen robot fixture</title><style>body{margin:0;background:#111214;color:#f7f4ed;font:20px system-ui;padding:30px}h1{color:#9dccff}</style><h1>Robot interface</h1><p>The same robot page remains open.</p><script>window.pageToken=Math.random();setInterval(()=>window.sample=navigator.getGamepads()[0]?.axes[1],20)</script>');});await new Promise(r=>server.listen(0,'127.0.0.2',r));
 const env={...process.env,DECK_HEADLESS:process.platform==='linux'?'0':'1',DECK_CONTROLLER_TEST:'1',DECK_DATA_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'deck-robot-fullscreen-'))};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root,...(env.DECK_ELECTRON_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[])],env});
 try{
  const page=await app.firstWindow();await page.waitForFunction(()=>typeof state==='object'&&!!window.deck);const native=await app.browserWindow(page);
  await assert.rejects(page.evaluate(()=>window.deck.robotFullscreen(true)),/Open a robot/);
  assert.equal(await page.locator('#robot-fullscreen').isVisible(),false);
  await page.evaluate(url=>window.deck.open({url,name:'Fullscreen robot fixture'}),`http://127.0.0.2:${server.address().port}`);await page.waitForFunction(()=>state.url&&!state.loading);
  const robot=app.context().pages().find(p=>p.url().startsWith('http://127.0.0.1:'));assert.ok(robot);const token=await robot.evaluate(()=>window.pageToken);
  const pads=[{id:'Xbox One Controller',index:0,mapping:'standard',connected:true,axes:[0,-.65,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))}];
  await robot.evaluate(pads=>window.__deckGamepadTest.set(pads),pads);await page.evaluate(pads=>window.__deckGamepadTest.set(pads),pads);await robot.waitForFunction(()=>window.sample===-.65);
  const original=await native.evaluate(w=>({size:w.getContentSize(),fullscreen:w.isFullScreen()}));
  for(const size of [[1280,800],[390,844]]){
   await native.evaluate((w,size)=>{w.setMinimumSize(0,0);w.setContentSize(...size);},size);
   await page.waitForTimeout(150);const close=await page.locator('#close-page').boundingBox(),full=await page.locator('#robot-fullscreen').boundingBox();
   assert.ok(close.x+close.width<=full.x&&full.x+full.width<=size[0],'fullscreen button overlaps or leaves the toolbar');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'Drive has horizontal overflow');
  }
  await native.evaluate((w,size)=>w.setContentSize(...size),original.size);
  await page.waitForFunction(size=>innerWidth===size[0]&&innerHeight===size[1],original.size);
  for(const zoom of [1,1.25,1.5,2]){
   await native.evaluate((w,z)=>w.webContents.setZoomFactor(z),zoom);
   let view,want;for(let i=0;i<30;i++){
    const mount=await page.evaluate(async()=>{await bounds();return document.querySelector('#robot-mount').getBoundingClientRect().toJSON();});
    view=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].contentView.children.find(v=>v.webContents.getURL().startsWith('http://127.0.0.1:')).getBounds());
    const x=Math.round(mount.x*zoom),y=Math.round(mount.y*zoom);want={x,y,width:Math.min(Math.round(mount.width*zoom),original.size[0]-x),height:Math.min(Math.round(mount.height*zoom),original.size[1]-y)};
    if(JSON.stringify(view)===JSON.stringify(want))break;await page.waitForTimeout(100);}
   assert.deepEqual(view,want,'native robot view covers the station chrome or footer at zoom '+zoom);
  }
  await native.evaluate(w=>w.webContents.setZoomFactor(1));await page.evaluate(()=>bounds());
  if(process.env.DECK_ZOOM_ONLY==='1'){console.log('PASS: embedded native robot view stays inside its mount at 100/125/150/200% app zoom.');return;}
  for(const method of ['button','escape','settings','already-fullscreen','close']){
   if(method==='already-fullscreen'){await native.evaluate(w=>w.setFullScreen(true));await until(()=>native.evaluate(w=>w.isFullScreen()),'app fullscreen');}
   await page.locator('#robot-fullscreen').click();await page.waitForFunction(()=>state.robotFullscreen&&document.body.classList.contains('robot-fullscreen'));
   await until(()=>native.evaluate(w=>w.isFullScreen()),'robot fullscreen');
   // Linux/macOS fullscreen transitions and child-view resize notifications are
   // asynchronous. Require the real viewport/overlay bounds to converge first.
   let views;
   await until(async()=>{
    views=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return {size:w.getContentSize(),children:w.contentView.children.map(v=>({url:v.webContents.getURL(),bounds:v.getBounds()}))};});
    const target=views.children.find(v=>v.url.startsWith('http://127.0.0.1:')),exit=views.children.at(-1);
    return target?.bounds.x===0&&target.bounds.y===0&&target.bounds.width===views.size[0]&&target.bounds.height===views.size[1]&&exit?.bounds.x===views.size[0]-60;
   },'fullscreen view and exit bounds: '+method);
   const target=views.children.find(v=>v.url.startsWith('http://127.0.0.1:')),exit=views.children.at(-1);
   assert.deepEqual(target.bounds,{x:0,y:0,width:views.size[0],height:views.size[1]});assert.ok(exit.url.endsWith('robot-fullscreen-exit.html'),'exit control is not above the robot view');assert.deepEqual(exit.bounds,{x:views.size[0]-60,y:12,width:48,height:48});
   assert.equal(await page.locator('body>header').isVisible(),false);assert.equal(await page.locator('.browser-toolbar').isVisible(),false);assert.equal(await robot.evaluate(()=>window.pageToken),token);assert.equal(await robot.evaluate(()=>typeof window.robotViewControls),'undefined');
   const helper=app.context().pages().find(p=>p.url().endsWith('robot-fullscreen-exit.html'));assert.ok(helper);assert.deepEqual(await helper.evaluate(()=>[typeof require,typeof window.deck,typeof window.robotViewControls.exit]),['undefined','undefined','function']);
   await robot.evaluate(pads=>window.__deckGamepadTest.set(pads),pads);await robot.waitForFunction(()=>window.sample===-.65);
   if(method==='escape')await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].contentView.children.find(v=>v.webContents.getURL().startsWith('http://127.0.0.1:')).webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}));
   else if(method==='settings')await page.evaluate(()=>window.deck.page('settings'));
   else if(method==='close')await page.evaluate(()=>window.deck.close());
   else await helper.locator('button').click();
   await page.waitForFunction(()=>!state.robotFullscreen&&!document.body.classList.contains('robot-fullscreen'));
   if(method==='already-fullscreen'){assert.equal(await native.evaluate(w=>w.isFullScreen()),true);await native.evaluate(w=>w.setFullScreen(false));}
   await until(()=>native.evaluate(w=>!w.isFullScreen()),'normal window restored');
   if(method==='settings'){await page.evaluate(()=>window.deck.page('drive'));await page.waitForFunction(()=>state.page==='drive');}
   if(method!=='close'){assert.equal(await robot.evaluate(()=>window.pageToken),token);assert.equal(await page.locator('body>header').isVisible(),true);}
  }
  assert.equal(await page.locator('#robot-fullscreen').isVisible(),false);assert.deepEqual(await native.evaluate(w=>w.getContentSize()),original.size);
  console.log('PASS: embedded view matches station mount at 100/125/150/200% zoom; native robot-only fullscreen bounds and topmost X; button/Escape/Settings/close restoration; existing app fullscreen preserved; same robot page and controller inputs remain; isolated exit overlay.');
 }finally{await app.close();wm?.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
