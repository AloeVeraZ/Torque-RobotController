'use strict';
// The Driver Station's bar, in the real app on an FTC robot kept in memory: the Theme and colour menu beside Network, and
// fullscreen. The menu's rows pick the Driver Station's theme and colour (Settings shows the same picks); it works from the
// keyboard; a long colour name shows whole on two lines; and in a very short window the menu still fits, every row in reach.
// With many colours a list says there is more: it ends halfway through a row, the edge with more beyond it fades until that
// end is reached, and its thumb stays in sight, however it is moved (wheel, finger, keys), in two columns and stacked.
// Fullscreen has no round ×: the station's own button goes in and comes out, and a page from its menu has the way out in its
// head. Escape with a menu, a dialog or a page open only closes that; with nothing open it leaves fullscreen. A menu left
// open when its robot closed holds nothing back for the next robot. DEV's moving ground shows behind the station's pages,
// and rests while a page cannot be seen (the window minimised, or the robot's view over the app).
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/ds-looks-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const Themes=require('../ui/themes.js');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/ds-looks');fs.mkdirSync(out,{recursive:true});

(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-ds-looks-'));
  const env={...process.env,DECK_HEADLESS:'1',DECK_CONTROLLER_TEST:'1',DECK_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  const server=http.createServer((_q,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Website robot</title><h1>Robot website</h1>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root,...(env.DECK_ELECTRON_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[])],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);
    const window=await app.browserWindow(page),size=(w,h)=>window.evaluate((bw,[w,h])=>{bw.setMinimumSize(0,0);bw.setContentSize(w,h);},[w,h]);await size(1280,800);
    await page.evaluate(()=>{localStorage.setItem('deck-theme','dark');document.documentElement.dataset.theme='dark';});
    // Two Driver Station colours whose long names differ only at the end.
    const long=['Robotics Team Midnight Gold Variant One','Robotics Team Midnight Gold Variant Two'];
    await page.evaluate(names=>{for(const [i,name] of names.entries())colours.push(DeckThemes.colour({name,accent:i?'#3a7bd5':'#e0a030',for:'station'}));saveColours();applyLooks();},long);
    // An FTC robot, simulated in memory.
    await app.evaluate(({app})=>{const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json');const {FtcSocket}=req('./src/ftc.cjs'),{SimController}=req('./tools/ftc-sim.cjs');global.__ftc={FtcSocket,open:FtcSocket.prototype.open};
      FtcSocket.prototype.open=async function(){this.address='10.9.9.9';const self=this;this.sim=new SimController({send:b=>{for(const fn of self.listeners)fn(new Uint8Array(b));}}).start();this.socket={close(cb){cb&&cb();}};return this;};
      FtcSocket.prototype.send=function(bytes){try{this.sim?.receive(new Uint8Array(bytes));}catch{}};FtcSocket.prototype.close=async function(){this.sim?.stop();this.sim=null;this.socket=null;this.listeners.clear();};});
    // What main sends: the station's menu flag, and the windows' state as each page hears it.
    await app.evaluate(({ipcMain})=>{global.__menu=[];ipcMain.on('ftc-menu',(_e,open)=>global.__menu.push(open));});
    const record=p=>p.evaluate(()=>{window.__rest=[];window.DeckAscii=window.DeckAscii||{};const was=window.DeckAscii.pause;window.DeckAscii.pause=(doc,paused)=>{window.__rest.push(paused);return was?.(doc,paused);};});
    await record(page);
    const openStation=async()=>{
      await page.evaluate(()=>window.deck.page('drive'));await page.evaluate(()=>window.deck.open({url:'10.9.9.9',name:'Practice bot',kind:'ftc'}));await page.waitForFunction(()=>state.kind==='ftc'&&!state.loading,null,{timeout:20000});
      let ds=null;for(let i=0;i<80&&!ds;i++){ds=app.context().pages().find(p=>p.url().includes('ui/ftc/index.html'));if(!ds)await page.waitForTimeout(100);}assert.ok(ds,'the Driver Station opened');
      ds.on('pageerror',e=>errors.push('Driver Station: '+e.message));await ds.waitForFunction(()=>!document.querySelector('#ds-looks').hidden&&document.querySelector('#link-text').textContent==='Robot Connected',null,{timeout:15000});
      return ds;};
    let ds=await openStation();await record(ds);
    // Escape as the keyboard sends it, through main (which decides about fullscreen) to the page.
    const escape=async(view='ui/ftc/index.html')=>{await app.evaluate(({BrowserWindow},view)=>{const w=BrowserWindow.getAllWindows()[0],v=w.contentView.children.find(v=>v.webContents.getURL().includes(view));v.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});v.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});},view);await page.waitForTimeout(300);};
    const fullscreen=()=>page.evaluate(()=>state.robotFullscreen);
    // Going in or out, then waiting for the window to finish (macOS animates it, and a late end would undo the next change).
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];for(const e of ['enter-full-screen','leave-full-screen'])w.on(e,()=>{global.__fs=e;});});
    const turn=async(action,on)=>{await app.evaluate(()=>{global.__fs=null;});await action();await page.waitForFunction(on=>state.robotFullscreen===on,on);
      for(let i=0;i<50&&await app.evaluate(()=>global.__fs)!==(on?'enter-full-screen':'leave-full-screen');i++)await page.waitForTimeout(100);await page.waitForTimeout(200);};
    const roundExit=()=>app.evaluate(({BrowserWindow})=>{const v=BrowserWindow.getAllWindows()[0].contentView.children.find(v=>v.webContents.getURL().endsWith('robot-fullscreen-exit.html'));return !!v&&v.getVisible();});
    const menuOpen=()=>ds.evaluate(()=>!document.querySelector('#looks-menu').hidden);
    const label=sel=>ds.evaluate(s=>{const b=document.querySelector(s);return {label:b.getAttribute('aria-label'),title:b.title};},sel);

    // The button, beside Network, says what it opens; the hint and the fullscreen button name what is there.
    assert.deepEqual(await ds.evaluate(()=>{const b=document.querySelector('#looks-button');return {words:b.querySelector('span').textContent,shown:getComputedStyle(b.querySelector('span')).display!=='none',label:b.getAttribute('aria-label'),next:document.querySelector('#ds-looks').nextElementSibling.className};}),{words:'Theme and colour',shown:true,label:'Theme and colour',next:'net'});
    assert.equal(await ds.locator('#assign-hint span').textContent(),'Click User 1 in the bar, then press a button on the gamepad to assign it.');
    assert.deepEqual(await label('#ds-fullscreen'),{label:'Fullscreen robot view',title:'Fullscreen robot view'});

    // The menu: Theme on the left, Colour on the right, each colour's dot its main colour.
    await ds.evaluate(()=>{document.documentElement.dataset.theme='dark';});await ds.click('#looks-button');assert.equal(await menuOpen(),true);
    const menu=await ds.evaluate(()=>{const R=e=>e.getBoundingClientRect(),[t,c]=[...document.querySelectorAll('#looks-menu .looks-group')];
      return {titles:[...document.querySelectorAll('#looks-menu .looks-title')].map(h=>h.textContent),themes:[...t.querySelectorAll('.looks-name')].map(n=>n.textContent),colours:[...c.querySelectorAll('.looks-name')].map(n=>n.textContent),
        side:R(t).right<=R(c).left,dots:[...c.querySelectorAll('.colour-dot')].map(d=>d.style.getPropertyValue('--dot')),rows:Math.min(...[...document.querySelectorAll('#looks-menu .looks-item')].map(r=>R(r).height)),
        long:[...c.querySelectorAll('.looks-name')].filter(n=>n.textContent.startsWith('Robotics')).map(n=>({whole:n.scrollHeight<=n.clientHeight+1,lines:Math.round(n.clientHeight/parseFloat(getComputedStyle(n).lineHeight))})),
        inside:R(document.querySelector('#looks-menu')).right<=innerWidth&&R(document.querySelector('#looks-menu')).bottom<=innerHeight};});
    assert.deepEqual(menu.titles,['Theme','Colour']);assert.deepEqual(menu.themes,['Same as the app','Torque','DEV','FIRST','NYC FIRST']);
    assert.deepEqual(menu.colours,['Same as the app',...Themes.COLOURS.map(c=>c.name),...long]);assert.ok(menu.side,'Theme stands left of Colour');
    assert.ok(menu.dots.every(d=>/^#[0-9a-f]{6}$/i.test(d)),'every colour has a dot in its main colour: '+menu.dots);assert.equal(menu.dots.at(-1).toLowerCase(),'#3a7bd5');
    assert.ok(menu.rows>=44,'rows are a finger high');assert.ok(menu.inside,'the menu is inside the window');
    assert.ok(menu.long.every(n=>n.whole),'a long colour name shows whole: '+JSON.stringify(menu.long));
    assert.equal(await app.evaluate(()=>global.__menu.at(-1)),true,'main hears the menu is open');
    await ds.waitForTimeout(300);await ds.screenshot({path:path.join(out,'looks-dark-1280.png')});
    // A row picks: DEV, then a long-named colour. Settings keeps the same picks.
    await ds.locator('#looks-menu .looks-item[data-kind=theme]',{hasText:'DEV'}).click();
    await ds.waitForFunction(()=>document.documentElement.dataset.look==='dev');assert.equal(await menuOpen(),false);
    assert.equal(await page.evaluate(()=>prefs.get('torque-station-theme','')),'dev');
    await ds.click('#looks-button');await ds.locator('#looks-menu .looks-item[data-kind=colour]',{hasText:long[1]}).click();
    const twoId=await page.evaluate(n=>colours.find(c=>c.name===n).id,long[1]);
    await page.waitForFunction(id=>prefs.get('torque-station-colour','')===id,twoId);
    await ds.waitForFunction(()=>document.querySelector('#looks-menu .looks-item[data-kind=colour][aria-checked=true]')?.textContent.includes('Two'));
    // Light: the menu shows its pick, and the dot keeps its main colour.
    await ds.evaluate(()=>{document.documentElement.dataset.theme='light';});await ds.click('#looks-button');
    assert.equal(await ds.evaluate(()=>document.querySelector('#looks-menu .looks-item[aria-checked=true][data-kind=colour] .colour-dot').style.getPropertyValue('--dot').toLowerCase()),'#3a7bd5');
    await ds.waitForTimeout(300);await ds.screenshot({path:path.join(out,'looks-light-1280.png')});
    // The keyboard: Escape closes and hands focus back; Down opens at the pick; Right goes across, End to the end.
    await escape();assert.equal(await menuOpen(),false);assert.equal(await ds.evaluate(()=>document.activeElement.id),'looks-button');
    await ds.keyboard.press('ArrowDown');assert.equal(await menuOpen(),true);
    assert.equal(await ds.evaluate(()=>document.activeElement.dataset.id),'dev');
    await ds.keyboard.press('ArrowRight');assert.equal(await ds.evaluate(()=>document.activeElement.dataset.kind),'colour');
    await ds.keyboard.press('Home');assert.equal(await ds.evaluate(()=>document.activeElement.dataset.id),'same');
    await ds.keyboard.press('ArrowDown');await ds.keyboard.press('Enter');
    await page.waitForFunction(()=>prefs.get('torque-station-colour','')==='torque');assert.equal(await menuOpen(),false);
    await ds.evaluate(()=>{document.documentElement.dataset.theme='dark';});

    // A very short window: the menu fits, and End brings the last row into sight.
    for(const [w,h] of [[800,260],[640,300]]){
      await size(w,h);await ds.waitForTimeout(300);await ds.click('#looks-button');
      await ds.locator('#looks-menu .looks-item[data-kind=colour]').first().focus();await ds.keyboard.press('End');
      const fit=await ds.evaluate(()=>{const m=document.querySelector('#looks-menu').getBoundingClientRect(),a=document.activeElement.getBoundingClientRect();return {top:m.top,bottom:m.bottom,h:innerHeight,row:[a.top,a.bottom],last:document.activeElement.textContent};});
      assert.ok(fit.top>=0&&fit.bottom<=fit.h,`the menu fits a ${w}×${h} window: ${JSON.stringify(fit)}`);
      assert.ok(fit.row[0]>=fit.top&&fit.row[1]<=fit.bottom+.5,`End shows the last row at ${w}×${h}: ${JSON.stringify(fit)}`);assert.equal(fit.last,long[1]);
      await ds.waitForTimeout(300);await ds.screenshot({path:path.join(out,`looks-${w}x${h}.png`)});await escape();
    }
    await size(1280,800);await ds.waitForTimeout(300);

    // Many colours: a list longer than its room says so. It ends halfway through a row, never at a row's edge; the edge
    // with more beyond it fades until the list reaches that end; and its thumb stays in sight. The wheel, a finger and the
    // keys all move it, and a row reached from the keyboard stops clear of the fade. Two columns: the colour list scrolls;
    // stacked: the whole menu does. The fade follows the list and has no motion of its own.
    const many=Array.from({length:12},(_,i)=>`Station colour number ${i+1}`);
    await page.evaluate(names=>{for(const [i,name] of names.entries())colours.push(DeckThemes.colour({name,accent:'#'+(0x305070+i*0x0b0a05).toString(16).slice(-6),for:'station'}));saveColours();applyLooks();},many);
    await ds.waitForFunction(n=>document.querySelectorAll('#looks-menu .looks-item[data-kind=colour]').length===n,1+Themes.COLOURS.length+long.length+many.length);
    const more=()=>ds.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const m=document.querySelector('#looks-menu'),box=m.classList.contains('stacked')?m:m.querySelectorAll('.looks-list')[1],r=box.getBoundingClientRect(),fade=p=>getComputedStyle(box,p);
      const cut=[...box.querySelectorAll('.looks-item')].map(x=>x.getBoundingClientRect()).find(q=>q.top<r.bottom-1&&q.bottom>r.bottom+1);
      return {below:box.classList.contains('more-below'),above:box.classList.contains('more-above'),fadeBelow:+fade('::after').opacity,fadeAbove:+fade('::before').opacity,thumb:box.offsetWidth-box.clientWidth,
        cut:cut?Math.round((r.bottom-cut.top)/cut.height*100)/100:null,still:fade('::after').transitionDuration==='0s'&&fade('::after').animationName==='none',fadeHeight:parseFloat(fade('::after').height),
        rows:Math.min(...[...m.querySelectorAll('.looks-item')].map(x=>x.getBoundingClientRect().height)),centre:[r.left+r.width/2,r.top+r.height/2],bottom:r.bottom,top:r.top};});
    const atTop=(s,where)=>{assert.ok(s.below&&!s.above&&s.fadeBelow===1&&s.fadeAbove===0,`${where}: more below is shown at the top: ${JSON.stringify(s)}`);
      assert.ok(s.cut>=.35&&s.cut<=.65,`${where}: the last row in sight is cut through its middle: ${JSON.stringify(s)}`);
      assert.ok(s.thumb>0,`${where}: the thumb stays in sight: ${JSON.stringify(s)}`);assert.ok(s.rows>=44,`${where}: rows stay a finger high`);assert.ok(s.still,`${where}: the fade has no motion of its own`);};
    const atEnd=(s,where)=>assert.ok(!s.below&&s.above&&s.fadeBelow===0&&s.fadeAbove===1,`${where}: at the end, no more below and more above: ${JSON.stringify(s)}`);
    const wheel=async(s,dy)=>{await ds.mouse.move(...s.centre);await ds.mouse.wheel(0,dy);await ds.waitForTimeout(400);return more();};
    // Two columns, dark: open at the top; the keys go down past the cut row; the wheel goes to the end and back a little; a
    // finger brings it back to the top.
    await ds.click('#looks-button');await ds.waitForTimeout(300);
    let s=await more();atTop(s,'1280×800');await ds.screenshot({path:path.join(out,'looks-many-1280-top.png')});
    await ds.locator('#looks-menu .looks-item[data-kind=colour]').first().focus();await ds.keyboard.press('Home');
    const past=await ds.evaluate(()=>{const list=document.querySelectorAll('#looks-menu .looks-list')[1],b=list.getBoundingClientRect().bottom;return [...list.querySelectorAll('.looks-item')].findIndex(x=>x.getBoundingClientRect().bottom>b+1);});
    for(let i=0;i<past;i++)await ds.keyboard.press('ArrowDown');
    s=await more();
    const reached=await ds.evaluate(()=>{const a=document.activeElement.getBoundingClientRect(),list=document.activeElement.closest('.looks-list').getBoundingClientRect();return {top:a.top,bottom:a.bottom,listTop:list.top,listBottom:list.bottom};});
    assert.ok(s.below&&s.above,'down the list, more both ways: '+JSON.stringify(s));
    assert.ok(reached.top>=reached.listTop&&reached.bottom<=s.bottom-s.fadeHeight+1,`the row reached from the keyboard stops clear of the fade: ${JSON.stringify({reached,fade:s.fadeHeight})}`);
    s=await wheel(s,4000);atEnd(s,'1280×800 wheel');await ds.screenshot({path:path.join(out,'looks-many-1280-end.png')});
    s=await wheel(s,-100);assert.ok(s.below&&s.above&&s.fadeBelow===1,'a little back up, more both ways: '+JSON.stringify(s));
    const cdp=await ds.context().newCDPSession(ds);
    await cdp.send('Input.synthesizeScrollGesture',{x:Math.round(s.centre[0]),y:Math.round(s.centre[1]),yDistance:3000,gestureSourceType:'touch',speed:4000});await ds.waitForTimeout(500);
    s=await more();atTop(s,'1280×800 after a finger');assert.equal(await menuOpen(),true,'a finger on the list leaves the menu open');
    await ds.keyboard.press('End');s=await more();atEnd(s,'1280×800 End');await escape();
    // Stacked, light: the whole menu scrolls and says the same.
    await ds.evaluate(()=>{document.documentElement.dataset.theme='light';});await size(480,640);await ds.waitForTimeout(300);await ds.click('#looks-button');await ds.waitForTimeout(300);
    assert.equal(await ds.evaluate(()=>document.querySelector('#looks-menu').classList.contains('stacked')),true);
    s=await more();atTop(s,'stacked');await ds.screenshot({path:path.join(out,'looks-many-stacked-top.png')});
    s=await wheel(s,4000);atEnd(s,'stacked wheel');await ds.screenshot({path:path.join(out,'looks-many-stacked-end.png')});
    await escape();
    await page.evaluate(names=>{for(let i=colours.length-1;i>=0;i--)if(names.includes(colours[i].name))colours.splice(i,1);saveColours();applyLooks();},many);
    await ds.waitForFunction(n=>document.querySelectorAll('#looks-menu .looks-item[data-kind=colour]').length===n,1+Themes.COLOURS.length+long.length);
    await ds.evaluate(()=>{document.documentElement.dataset.theme='dark';});await size(1280,800);await ds.waitForTimeout(300);

    // Fullscreen: no round ×; the bar's own button says the way out and takes it.
    await turn(()=>ds.click('#ds-fullscreen'),true);
    assert.equal(await roundExit(),false,'no round × over the Driver Station');assert.deepEqual(await label('#ds-fullscreen'),{label:'Leave fullscreen',title:'Leave fullscreen'});
    assert.equal(await ds.evaluate(()=>document.querySelector('#ds-fullscreen').getBoundingClientRect().top<48),true,'the button stays in the bar');
    // Escape with a menu, a list, a dialog or a page open closes only that.
    const only=async(open,isOpen,what)=>{await open();assert.equal(await ds.evaluate(isOpen),true,what+' opened');await ds.waitForTimeout(100);await escape();
      assert.equal(await ds.evaluate(isOpen),false,'Escape closes '+what);assert.equal(await fullscreen(),true,'Escape on '+what+' keeps fullscreen');};
    await only(()=>ds.click('#looks-button'),()=>!document.querySelector('#looks-menu').hidden,'the looks menu');
    await only(()=>ds.click('#ds-more'),()=>!document.querySelector('#ds-menu').hidden,'the three-dot menu');
    await only(()=>ds.click('#teleop-list'),()=>!document.querySelector('#picker').hidden,'the op mode list');
    await only(async()=>{await ds.click('#ds-more');await ds.click('#menu-gamepads');},()=>document.querySelector('#ds-dialog').open,'Gamepad assignment');
    assert.match(await ds.locator('#dialog-text').textContent(),/^Click User 1 in the bar/);
    await only(async()=>{await ds.click('#ds-more');await ds.click('#menu-settings');},()=>!document.querySelector('#ds-page').hidden,'Settings');
    // A page's own question: Configure Robot → New.
    await ds.click('#ds-more');await ds.click('#menu-configure');await ds.locator('#page-actions button',{hasText:'New'}).waitFor();await ds.waitForFunction(()=>!document.querySelector('#page-actions button').disabled);
    await only(()=>ds.click('#page-actions button'),()=>document.querySelector('#page-ask').open,'the new configuration’s name');
    assert.equal(await ds.evaluate(()=>!document.querySelector('#ds-page').hidden),true,'the page stays');
    // The page covers the bar, so its head has the way out, at the same end.
    const out1=await ds.evaluate(()=>{const b=document.querySelector('#page-fullscreen'),r=b.getBoundingClientRect(),f=document.querySelector('#ds-fullscreen').getBoundingClientRect();return {shown:!b.hidden&&r.width>0,label:b.getAttribute('aria-label'),right:r.right>innerWidth-120,top:r.top<f.bottom,bar:getComputedStyle(document.querySelector('.bar')).visibility};});
    assert.deepEqual(out1,{shown:true,label:'Leave fullscreen',right:true,top:true,bar:'hidden'});
    await ds.waitForTimeout(300);await ds.screenshot({path:path.join(out,'page-fullscreen-dev.png')});
    // DEV fills the screen behind the page; its head keeps the ground, as the bar does.
    assert.deepEqual(await ds.evaluate(()=>{const c=e=>getComputedStyle(document.querySelector(e)).backgroundColor;return {page:c('#ds-page'),head:c('.page-head')!=='rgba(0, 0, 0, 0)',station:getComputedStyle(document.querySelector('.grid')).visibility};}),{page:'rgba(0, 0, 0, 0)',head:true,station:'hidden'});
    await turn(()=>ds.click('#page-fullscreen'),false);
    assert.equal(await ds.evaluate(()=>document.querySelector('#page-fullscreen').hidden),true,'the way out goes once out');
    assert.equal(await ds.evaluate(()=>!document.querySelector('#ds-page').hidden&&document.activeElement.id),'page-back','the page stays, focus on Back');
    await ds.click('#page-back');await ds.waitForFunction(()=>document.querySelector('#ds-page').hidden);
    // With nothing open, Escape leaves fullscreen; and the bar's button goes in and comes out.
    await turn(()=>ds.click('#ds-fullscreen'),true);await turn(()=>escape(),false);
    await turn(()=>ds.click('#ds-fullscreen'),true);await turn(()=>ds.click('#ds-fullscreen'),false);
    assert.deepEqual(await label('#ds-fullscreen'),{label:'Fullscreen robot view',title:'Fullscreen robot view'});

    // Seen or not: DEV's ground rests while the window is minimised, while the robot's view covers the app in fullscreen,
    // and while the station's view is put away. Each page hears only changes.
    const rest=p=>p.evaluate(()=>window.__rest.slice());
    await page.evaluate(()=>{window.__rest.length=0;});await ds.evaluate(()=>{window.__rest.length=0;});
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.isMinimized=()=>true;w.emit('minimize');w.emit('minimize');});await ds.waitForTimeout(300);
    assert.deepEqual(await rest(page),[true]);assert.deepEqual(await rest(ds),[true]);
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];delete w.isMinimized;w.emit('restore');});await ds.waitForTimeout(300);
    assert.deepEqual(await rest(page),[true,false]);assert.deepEqual(await rest(ds),[true,false]);
    await turn(()=>ds.click('#ds-fullscreen'),true);
    assert.deepEqual(await rest(page),[true,false,true],'the robot’s view covers the app');assert.deepEqual(await rest(ds),[true,false]);
    await turn(()=>ds.click('#ds-fullscreen'),false);
    assert.deepEqual(await rest(page),[true,false,true,false]);
    await page.evaluate(()=>window.deck.page('settings'));await ds.waitForTimeout(300);assert.deepEqual(await rest(ds),[true,false,true],'the station is put away');
    await page.evaluate(()=>window.deck.page('drive'));await ds.waitForTimeout(300);assert.deepEqual(await rest(ds),[true,false,true,false]);
    await ds.waitForTimeout(300);await ds.screenshot({path:path.join(out,'station-dev.png')});

    // A menu left open when its robot closes holds nothing back for the next one: a website robot's fullscreen leaves on Escape.
    await ds.click('#looks-button');assert.equal(await menuOpen(),true);
    await page.evaluate(()=>window.deck.close());await page.waitForFunction(()=>!state.url);
    await app.evaluate(()=>{global.__ftc.FtcSocket.prototype.open=global.__ftc.open;});
    const site=`http://127.0.0.1:${server.address().port}/`;
    await page.evaluate(url=>window.deck.open({url,name:'Website robot'}),site);await page.waitForFunction(()=>state.kind==='web'&&!state.loading,null,{timeout:20000});
    await turn(()=>page.evaluate(()=>window.deck.robotFullscreen(true)),true);
    assert.equal(await roundExit(),true,'a website robot keeps its round ×');
    await turn(()=>escape('127.0.0.1'),false);
    await page.evaluate(()=>window.deck.close());

    assert.deepEqual(errors,[]);console.log('Driver Station looks menu and fullscreen: all passed');
  }finally{await app.close().catch(()=>{});server.close();fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,4000));process.exit(1);});
