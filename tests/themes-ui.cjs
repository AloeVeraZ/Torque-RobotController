'use strict';
// Settings, in the real app: App theme and Driver Station theme each end in + to import a theme package
// (docs/THEMES.md), and Text ends in + to add a font file. What comes in goes into the list whose + was used, is put on,
// is kept in the app's data folder, and Remove takes it out again. The Driver Station, on an FTC robot (one simulated in
// memory), wears the Driver Station theme and the font. A folder without theme.json, or a file that is not a font, says
// so and changes nothing.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/themes-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/themes');fs.mkdirSync(out,{recursive:true});

(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-themes-ui-')),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'deck-themes-files-'));
  const env={...process.env,DECK_HEADLESS:'1',DECK_CONTROLLER_TEST:'1',DECK_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root,...(env.DECK_ELECTRON_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[])],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);
    const window=await app.browserWindow(page);await window.evaluate(w=>{w.setMinimumSize(0,0);w.setContentSize(1280,800);});
    await page.evaluate(()=>window.deck.page('settings'));await page.waitForFunction(()=>state.page==='settings');
    const names=list=>page.locator(`${list} :is(.theme-name,.font-name)`).allTextContents();
    const checked=list=>page.locator(`${list} [role=radio][aria-checked=true] :is(.theme-name,.font-name)`).textContent();
    const pick=async(tile,files)=>{const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator(tile).click()]);await chooser.setFiles(files);};
    const kept=dir=>{try{return fs.readdirSync(path.join(data,dir)).sort();}catch{return [];}};
    assert.equal((await names('#themes-app')).at(-1),'Import a theme');assert.equal((await names('#themes-station')).at(-1),'Import a theme');assert.equal((await names('#fonts')).at(-1),'Add a font');
    assert.equal(await checked('#themes-app'),'Torque');assert.equal(await checked('#themes-station'),'Same as the app');assert.equal(await checked('#fonts'),'Inter');

    // The example package says "for": "station"; imported with the App theme list's +, it is an app theme and goes on.
    await pick('#themes-app .add-card',path.join(root,'docs/themes/night-shift'));
    await page.waitForFunction(()=>document.querySelector('#theme-app-status').textContent==='Imported Night Shift and put it on.');
    assert.equal(await checked('#themes-app'),'Night Shift');assert.ok(!(await names('#themes-station')).includes('Night Shift'),'it is not in the Driver Station list');
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.look.startsWith('custom-night-shift-')),true);
    assert.equal(kept('themes').length,1,'the theme is kept in the data folder');
    await page.screenshot({path:path.join(out,'settings-imported.png')});
    await page.locator('#themes-app .choice-remove').click();
    await page.waitForFunction(()=>![...document.querySelectorAll('#themes-app .theme-name')].some(n=>n.textContent==='Night Shift'));
    assert.equal(await checked('#themes-app'),'Torque');assert.deepEqual(kept('themes'),[]);

    // The Driver Station list's + puts it there instead (it stays on for the Driver Station below).
    await pick('#themes-station .add-card',path.join(root,'docs/themes/field-day'));
    await page.waitForFunction(()=>/^Imported .+ and put it on\.$/.test(document.querySelector('#theme-station-status').textContent));
    const station=await checked('#themes-station');assert.notEqual(station,'Same as the app');assert.ok(!(await names('#themes-app')).includes(station));

    // A folder with no theme.json in it.
    fs.mkdirSync(path.join(scratch,'pictures'));fs.writeFileSync(path.join(scratch,'pictures','notes.txt'),'not a theme');
    await pick('#themes-app .add-card',path.join(scratch,'pictures'));
    await page.waitForFunction(()=>/no theme\.json/.test(document.querySelector('#theme-app-status').textContent));
    assert.equal(await checked('#themes-app'),'Torque');

    // A font file: added, put on for Torque, kept, then removed. A file that is not a font is turned away.
    fs.writeFileSync(path.join(scratch,'Not A Font-Regular.ttf'),'plain text, not a font');
    await pick('#fonts .add-card',path.join(scratch,'Not A Font-Regular.ttf'));
    await page.waitForFunction(()=>/^Couldn’t add it\. That file isn’t a font/.test(document.querySelector('#font-status').textContent));
    assert.equal(await checked('#fonts'),'Inter');assert.deepEqual(kept('fonts'),[]);
    fs.copyFileSync(path.join(root,'ui/fonts/barlow-condensed-700-latin.woff2'),path.join(scratch,'Barlow Condensed-Bold.woff2'));
    await pick('#fonts .add-card',path.join(scratch,'Barlow Condensed-Bold.woff2'));
    await page.waitForFunction(()=>document.documentElement.dataset.font==='custom');
    const added=await checked('#fonts');assert.equal(added,'Barlow Condensed Bold');
    const look=await page.evaluate(()=>{const s=getComputedStyle(document.documentElement);return {font:s.getPropertyValue('--font'),display:s.getPropertyValue('--font-display'),body:getComputedStyle(document.body).fontFamily};});
    assert.match(look.font,/^"torque-font-barlow-condensed-bold-[0-9a-f]{6}", system-ui/);assert.equal(look.display,look.font);assert.match(look.body,/torque-font-barlow-condensed-bold/);
    await page.evaluate(()=>document.fonts.ready);
    assert.ok(await page.evaluate(f=>[...document.fonts].some(face=>face.family.replace(/"/g,'')===f&&face.status==='loaded'),look.font.split(',')[0].replace(/"/g,'')),'the added font is loaded');
    assert.equal(kept('fonts').length,2,'the font file and its name are kept');
    await page.screenshot({path:path.join(out,'settings-font.png')});

    // An FTC robot, simulated in memory: its Driver Station has the Driver Station theme and the added font.
    await app.evaluate(({app})=>{const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json');const {FtcSocket}=req('./src/ftc.cjs'),{SimController}=req('./tools/ftc-sim.cjs');
      FtcSocket.prototype.open=async function(){this.address='10.9.9.9';const self=this;this.sim=new SimController({send:b=>{for(const fn of self.listeners)fn(new Uint8Array(b));}}).start();this.socket={close(cb){cb&&cb();}};return this;};
      FtcSocket.prototype.send=function(bytes){try{this.sim?.receive(new Uint8Array(bytes));}catch{}};FtcSocket.prototype.close=async function(){this.sim?.stop();this.sim=null;this.socket=null;this.listeners.clear();};});
    await page.evaluate(()=>window.deck.open({url:'10.9.9.9',name:'Practice bot',kind:'ftc'}));await page.waitForFunction(()=>state.kind==='ftc'&&!state.loading,null,{timeout:20000});
    let ds=null;for(let i=0;i<50&&!ds;i++){ds=app.context().pages().find(p=>p.url().includes('ui/ftc/index.html'));if(!ds)await page.waitForTimeout(100);}assert.ok(ds,'the Driver Station opened');
    ds.on('pageerror',e=>errors.push('Driver Station: '+e.message));
    await ds.waitForFunction(()=>document.documentElement.dataset.font==='custom'&&(document.documentElement.dataset.look||'').startsWith('custom-field-day-'),null,{timeout:15000});
    const dsFont=await ds.evaluate(()=>{const f=getComputedStyle(document.documentElement).getPropertyValue('--font');return {font:f,loaded:[...document.fonts].some(face=>f.includes(face.family.replace(/"/g,''))&&face.status==='loaded')};});
    assert.equal(dsFont.font,look.font,'the Driver Station uses the added font');assert.ok(dsFont.loaded,'and has it loaded');
    await ds.screenshot({path:path.join(out,'driver-station.png')});
    await page.evaluate(()=>window.deck.close?.());await page.evaluate(()=>window.deck.page('settings'));await page.waitForFunction(()=>state.page==='settings');

    await page.locator('#themes-station .choice-remove').click();await page.waitForFunction(()=>!document.querySelector('#themes-station .choice-remove'));
    assert.equal(await checked('#themes-station'),'Same as the app');
    await page.locator('#fonts .choice-remove').click();await page.waitForFunction(()=>!document.documentElement.dataset.font);
    assert.equal(await checked('#fonts'),'Inter');assert.deepEqual(kept('fonts'),[]);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--font').trim().startsWith('Inter')),true);

    assert.deepEqual(errors,[]);console.log('Themes and fonts: all passed');
  }finally{await app.close().catch(()=>{});fs.rmSync(data,{recursive:true,force:true});fs.rmSync(scratch,{recursive:true,force:true});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,4000));process.exit(1);});
