'use strict';
// The robot view's fullscreen when its button is pressed faster than the window can follow, in the real app on an FTC robot
// kept in memory. macOS animates going in and out of fullscreen and tells the app only when each change ends; Electron holds
// a change asked for during the animation until it ends. A test window is never on screen, so the window here stands in for
// macOS's (the change ends 400 ms later; the window reads as fullscreen from the start of going in, and either from the start
// or the end of coming out), for Windows' (each change ends at once) and for a window that never answers. Each press of the
// Driver Station's fullscreen button turns it the other way, so two quick presses end where they began and three end in
// fullscreen; the end of the app's own change is never taken for the user leaving. Escape, the user leaving the window's
// fullscreen and the three-dot menu's Fullscreen still work, and a window the user made fullscreen stays so.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/fullscreen-race-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..');

(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-fullscreen-race-'));
  const env={...process.env,DECK_HEADLESS:'1',DECK_CONTROLLER_TEST:'1',DECK_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root,...(env.DECK_ELECTRON_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[])],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);
    // An FTC robot, simulated in memory.
    await app.evaluate(({app})=>{const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json');const {FtcSocket}=req('./src/ftc.cjs'),{SimController}=req('./tools/ftc-sim.cjs');
      FtcSocket.prototype.open=async function(){this.address='10.9.9.9';const self=this;this.sim=new SimController({send:b=>{for(const fn of self.listeners)fn(new Uint8Array(b));}}).start();this.socket={close(cb){cb&&cb();}};return this;};
      FtcSocket.prototype.send=function(bytes){try{this.sim?.receive(new Uint8Array(bytes));}catch{}};FtcSocket.prototype.close=async function(){this.sim?.stop();this.sim=null;this.socket=null;this.listeners.clear();};});
    // The stand-in window. Like Electron on macOS: a change asked for while one runs waits in a queue (the same change twice in a
    // row is kept once) and starts when that one ends, right after its enter-full-screen or leave-full-screen; a change to the
    // state the window is already in does nothing. user(on) is the green button or Control-Command-F: the window changes
    // without the app asking.
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];
      const m=global.__window={mode:'mac',leaveMask:'end',ms:400,full:false,moving:null,queue:[],asks:[]};
      const end=on=>{m.full=on;m.moving=null;w.emit(on?'enter-full-screen':'leave-full-screen');if(m.queue.length)change(m.queue.shift());};
      const change=on=>{
        if(m.mode==='silent')return;
        if(m.mode==='instant'){if(on===m.full)return;w.emit(on?'enter-full-screen':'leave-full-screen');m.full=on;return;}
        if(m.moving!==null){if(m.queue.at(-1)!==on)m.queue.push(on);return;}
        if(on===m.full)return;m.moving=on;if(on||m.leaveMask==='start')m.full=on;setTimeout(()=>end(on),m.ms);};
      w.isFullScreen=()=>m.full;w.setFullScreen=on=>{m.asks.push(!!on);change(!!on);};m.user=on=>change(!!on);
      m.reset=mode=>{Object.assign(m,{mode:mode.mode,leaveMask:mode.leaveMask||'end',full:false,moving:null,queue:[],asks:[]});};});
    await page.evaluate(()=>window.deck.page('drive'));await page.evaluate(()=>window.deck.open({url:'10.9.9.9',name:'Practice bot',kind:'ftc'}));
    await page.waitForFunction(()=>state.kind==='ftc'&&!state.loading,null,{timeout:20000});
    let ds=null;for(let i=0;i<80&&!ds;i++){ds=app.context().pages().find(p=>p.url().includes('ui/ftc/index.html'));if(!ds)await page.waitForTimeout(100);}assert.ok(ds,'the Driver Station opened');
    ds.on('pageerror',e=>errors.push('Driver Station: '+e.message));
    await ds.waitForFunction(()=>!document.querySelector('#ds-fullscreen').hidden&&document.querySelector('#link-text').textContent==='Robot Connected',null,{timeout:15000});

    const button=ds.locator('#ds-fullscreen'),press=()=>button.click(),gap=ms=>page.waitForTimeout(ms);
    const escape=()=>app.evaluate(({BrowserWindow})=>{const v=BrowserWindow.getAllWindows()[0].contentView.children.find(v=>v.webContents.getURL().includes('ui/ftc/index.html'));v.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});v.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});});
    const menu=()=>page.evaluate(()=>window.deck.fullscreen());
    // Settled: the window has nothing running or waiting, the app and the station agree, and it stays so for a moment.
    const read=async()=>({robot:await page.evaluate(()=>state.robotFullscreen),window:await app.evaluate(()=>global.__window.full),station:await ds.evaluate(()=>document.body.classList.contains('fullscreen')),
      busy:await app.evaluate(()=>global.__window.moving!==null||global.__window.queue.length>0)});
    const settle=async()=>{let last='',same=0;for(let i=0;i<60;i++){const now=await read(),key=JSON.stringify(now);same=key===last&&!now.busy?same+1:0;last=key;if(same>=3){delete now.busy;return now;}await gap(150);}throw Error('The fullscreen never settled: '+last);};
    const expect=async(name,robot,window)=>{const got=await settle();assert.deepEqual(got,{robot,window,station:robot},name);};
    const reset=async mode=>{await page.evaluate(()=>window.deck.robotFullscreen(false));await settle();await app.evaluate((_e,mode)=>global.__window.reset(mode),mode);await gap(50);};

    for(const mode of [{mode:'mac',leaveMask:'end'},{mode:'mac',leaveMask:'start'},{mode:'instant'}]){
      const name=s=>`${mode.mode}${mode.leaveMask?' ('+mode.leaveMask+')':''}: ${s}`;
      await reset(mode);
      await press();await expect(name('one press goes in'),true,true);
      await press();await gap(80);await press();await expect(name('out and in again 80 ms apart stays in'),true,true);
      await button.dblclick();await expect(name('a double press in fullscreen stays in'),true,true);
      await press();await expect(name('one press comes out'),false,false);
      await button.dblclick();await expect(name('a double press from the window stays out'),false,false);
      await press();await gap(80);await press();await expect(name('out again while still going in'),false,false);
      await press();await gap(60);await press();await gap(60);await press();await expect(name('three quick presses go in'),true,true);
      await press();await gap(60);await press();await gap(60);await press();await gap(60);await press();await expect(name('four quick presses in fullscreen stay in'),true,true);
      await press();await expect(name('one press comes out again'),false,false);
      // Escape, and the user's own way out of the window's fullscreen.
      await press();await expect(name('in for Escape'),true,true);await escape();await expect(name('Escape leaves'),false,false);
      await press();await gap(80);await escape();await expect(name('Escape on the way in leaves'),false,false);
      await press();await expect(name('in for the user'),true,true);
      await app.evaluate(()=>global.__window.user(false));await expect(name('the user leaving the window’s fullscreen leaves the robot’s'),false,false);
      // A window the user made fullscreen with the menu stays fullscreen around the robot's, also when pressed mid-change.
      await menu();await expect(name('the menu’s Fullscreen'),false,true);
      await press();await expect(name('in from a fullscreen window'),true,true);
      await press();await expect(name('out keeps the window fullscreen'),false,true);
      await menu();await expect(name('the menu’s Fullscreen comes out'),false,false);
      await menu();await gap(80);await press();await expect(name('in while the window is still going in'),true,true);
      await press();await expect(name('out keeps that window fullscreen'),false,true);
      await menu();await expect(name('and the menu takes it out'),false,false);
      console.log(name('passed'));
    }
    // A window that never answers (one not on screen) holds nothing up: each press still turns the robot's view, and the
    // window is asked again once the press changes what it should be.
    await reset({mode:'silent'});
    await press();await page.waitForFunction(()=>state.robotFullscreen);await press();await page.waitForFunction(()=>!state.robotFullscreen);
    await gap(3500);await press();await page.waitForFunction(()=>state.robotFullscreen);await gap(100);
    assert.deepEqual(await app.evaluate(()=>global.__window.asks),[true,true],'a window that never answers is asked again');
    await press();await page.waitForFunction(()=>!state.robotFullscreen);

    assert.deepEqual(errors,[]);console.log('Fullscreen pressed faster than the window follows: all passed');
  }finally{await app.close().catch(()=>{});fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,4000));process.exit(1);});
