'use strict';
// Settings' looks, in the real app. App colour, App theme, Text, Driver Station colour and Driver Station theme, in that
// order. A colour list holds Torque, Purple, Orange and Mono, then the user's own, then + (Add a colour), which opens an
// editor: a name, a main colour and a background tint, shown on the screens while it is made; Save keeps a new one and
// puts it on, Cancel (or a pick anywhere, or leaving Settings) puts back what was there. A hex code goes in once it is whole,
// and a short one is filled out on leaving the field. An own colour can be edited, exported as a small file (the save
// dialog is stubbed) and removed (after asking); a colour file can be imported, once. A theme list holds Torque and DEV, then
// imported theme folders (docs/THEMES.md), then + (Import a theme). Any colour goes with any theme: an imported theme
// puts on its own colours ("<Theme>’s own", first in the colour list), any other colour is drawn over its pictures, and
// Torque or DEV bring back the colour from before. A list is full at 16 colours or 8 themes, and its + goes, even for two
// imports at once. The Driver Station lists start with Same as the app; the Driver Station, on an FTC robot (one
// simulated in memory), wears what they pick, and its Theme and colour menu picks back, by clicking its rows. Old preferences (a
// colour picked as a theme, Blue and Red, a robot's own theme) move over once. Text ends in + to add a font file; every
// font is drawn at Inter's size, so a line of words takes the same room in any of them.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/themes-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const Themes=require('../ui/themes.js');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/themes');fs.mkdirSync(out,{recursive:true});

(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-themes-ui-')),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'deck-themes-files-'));
  const env={...process.env,DECK_HEADLESS:'1',DECK_CONTROLLER_TEST:'1',DECK_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root,...(env.DECK_ELECTRON_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[])],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    // Remove asks first. The answer is yes unless a step says no.
    let answer=true;const asked=[];page.on('dialog',d=>{asked.push(d.message());void(answer?d.accept():d.dismiss());});
    const ready=async()=>{await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model&&themesReady);await page.evaluate(()=>window.deck.page('settings'));await page.waitForFunction(()=>state.page==='settings');};
    await ready();
    const window=await app.browserWindow(page);await window.evaluate(w=>{w.setMinimumSize(0,0);w.setContentSize(1280,800);});
    // Every look the app sends the Driver Station, as main receives it.
    await app.evaluate(({ipcMain})=>{global.__looks=[];ipcMain.on('station-look',(_e,look)=>global.__looks.push({...look,font:{id:look.font?.id},theme:{id:look.theme?.id,look:look.theme?.look,motion:look.theme?.motion}}));});
    const lastLook=async(want=()=>true)=>{for(let i=0;i<50;i++){const l=await app.evaluate(()=>global.__looks.at(-1));if(l&&want(l))return l;await page.waitForTimeout(100);}return app.evaluate(()=>global.__looks.at(-1));};
    // What main would send the app: a pick from the Driver Station's Theme and colour menu, or whether the window can be seen.
    const fromMain=(channel,value)=>app.evaluate(({BrowserWindow},[c,v])=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('ui/index.html'))?.webContents.send(c,v),[channel,value]);
    // Dark, so the colours read back are the dark ones.
    const dark=()=>page.evaluate(()=>{localStorage.setItem('deck-theme','dark');document.documentElement.dataset.theme='dark';});await dark();
    const names=list=>page.locator(`${list} :is(.theme-name,.font-name)`).allTextContents();
    const checked=list=>page.locator(`${list} [role=radio][aria-checked=true] :is(.theme-name,.font-name)`).textContent();
    const pick=async(tile,files)=>{const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator(tile).click()]);await chooser.setFiles(files);};
    const kept=dir=>{try{return fs.readdirSync(path.join(data,dir)).sort();}catch{return [];}};
    const accent=()=>page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    const pref=key=>page.evaluate(k=>localStorage.getItem(k),key);
    const status=(id,text)=>page.waitForFunction(([id,t])=>document.getElementById(id).textContent===t,[id,text]);
    const text=id=>page.locator('#'+id).textContent();
    // Where focus is: a card (its list and id), never the page itself.
    const focused=()=>page.evaluate(()=>{const a=document.activeElement;return a===document.body||!a?'body':`${a.closest('[id]')?.id} ${a.dataset.id||''}${a.dataset.action?' '+a.dataset.action:''}`;});
    const card=(list,name)=>page.locator(`${list} [role=radio]`,{hasText:name});
    const BUILT=['Torque','Purple','Orange','Mono'];
    const clean=()=>page.evaluate(()=>{for(const k of Object.keys(localStorage))if(/^torque-(app|station)-|^torque-colours$/.test(k))localStorage.removeItem(k);colours=[];applyLooks();});

    // Old preferences move over once. A colour picked as a theme is the colour now, with the Torque theme (Orange for the
    // Driver Station, whose theme is Torque and not Same as the app, so it never picks up a theme the app has on); Blue and
    // Red are gone, so one picked is an own colour of that name from its main colour, and stays on. A robot's own theme is
    // gone.
    await page.evaluate(()=>{localStorage.removeItem('torque-looks');localStorage.setItem('torque-app-theme','blue');localStorage.setItem('torque-station-theme','red');localStorage.setItem('torque-robot-themes','{"r1":"purple"}');});
    await page.reload();await ready();
    const own=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('torque-colours')||'[]'));
    let mine=await own();
    assert.deepEqual(mine.map(c=>[c.name,c.accent,c.tint,c.for]),[['Blue','#87bafe',null,'app'],['Red','#ff958f',null,'station']]);
    assert.deepEqual(await page.evaluate(()=>['torque-app-theme','torque-app-colour','torque-station-theme','torque-station-colour','torque-robot-themes'].map(k=>localStorage.getItem(k))),['torque',mine[0].id,'torque',mine[1].id,null]);
    assert.equal(await checked('#colours-app'),'Blue');assert.equal(await checked('#colours-station'),'Red');
    assert.equal(await accent(),Themes.colour({name:'Blue',accent:'#87bafe',for:'app'}).dark.accent,'the app looks as it did');
    // Only once: Blue already made is not made again.
    await page.evaluate(()=>{localStorage.removeItem('torque-looks');localStorage.setItem('torque-app-colour','blue');});await page.reload();await ready();
    assert.equal((await own()).filter(c=>c.name==='Blue').length,1);assert.equal(await checked('#colours-app'),'Blue');
    // Orange picked as the Driver Station's theme is its colour, under the Torque theme; an imported theme that was on keeps its own colours, the
    // colour picked before it waiting for Torque or DEV (this one is no longer there, so Purple is back on).
    await page.evaluate(()=>{for(const k of Object.keys(localStorage))if(/^torque-/.test(k))localStorage.removeItem(k);localStorage.setItem('torque-station-theme','orange');localStorage.setItem('torque-app-theme','custom-gone-12345');localStorage.setItem('torque-app-colour','purple');});
    await page.reload();await ready();
    assert.deepEqual(await page.evaluate(()=>['torque-station-theme','torque-station-colour','torque-app-colour-last','torque-app-colour'].map(k=>localStorage.getItem(k))),['torque','orange','purple','purple']);
    assert.equal(await checked('#colours-station'),'Orange');assert.equal(await checked('#themes-station'),'Torque');assert.equal(await checked('#colours-app'),'Purple');
    await clean();

    // The order, the built-in lists and what is picked at first.
    assert.deepEqual(await page.locator('#settings-view .settings-group h2').allTextContents(),['App colour','App theme','Text','Driver Station colour','Driver Station theme','Driving','About Torque']);
    assert.deepEqual(await names('#colours-app'),[...BUILT,'Add a colour']);
    assert.deepEqual(await names('#themes-app'),['Torque','DEV','FIRST','NYC FIRST','Import a theme']);
    assert.deepEqual(await names('#colours-station'),['Same as the app',...BUILT,'Add a colour']);
    assert.deepEqual(await names('#themes-station'),['Same as the app','Torque','DEV','FIRST','NYC FIRST','Import a theme']);
    assert.equal((await names('#fonts')).at(-1),'Add a font');
    assert.equal(await checked('#colours-app'),'Torque');assert.equal(await checked('#themes-app'),'Torque');
    assert.equal(await checked('#colours-station'),'Same as the app');assert.equal(await checked('#themes-station'),'Same as the app');assert.equal(await checked('#fonts'),'Inter');
    assert.equal(await page.locator('#robot-themes, #colours-app-note, #colours-station-note').count(),0,'robots have no looks of their own, and no line says a theme has its own colours');
    assert.equal(await accent(),'#31d78c');
    // A card is read by its name: its preview is a picture only (DEV's is rows of characters).
    assert.equal(await page.locator('#settings-view :is(.theme-preview, .font-sample):not([aria-hidden=true])').count(),0);
    assert.equal(await page.getByRole('radio',{name:'DEV',exact:true}).count(),2,'DEV in both theme lists, read as its name');
    assert.equal(await page.locator('#theme-cycle').getAttribute('aria-label'),'Light or dark: dark');assert.equal(await page.locator('#theme-cycle').getAttribute('title'),'Light or dark: dark');
    // Light or dark is in Settings too, at the top of App colour (a narrow window's bar has no room for its button), and
    // shows what the bar's button shows: a pick in either is a pick in both.
    const modePick=()=>page.evaluate(()=>[...document.querySelectorAll('#mode-pick button')].filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.textContent));
    assert.deepEqual(await page.locator('#mode-pick button').allTextContents(),['Match the device','Light','Dark']);assert.equal(await page.locator('#mode-pick').getAttribute('aria-label'),'Light or dark','named for a screen reader, with no words on the page');assert.equal(await page.locator('.mode-pick .setting-label').count(),0);
    assert.equal(await page.locator('#mode-pick').evaluate(e=>!!e.closest('#colours-app, .settings-group')?.querySelector('#colour-app-title')),true,'in the App colour part');
    assert.deepEqual(await modePick(),['Dark']);
    await page.locator('#mode-pick button',{hasText:'Light'}).click();
    assert.deepEqual([await pref('deck-theme'),await page.evaluate(()=>document.documentElement.dataset.theme),await page.locator('#theme-cycle').getAttribute('aria-label')],['light','light','Light or dark: light']);
    await page.locator('#theme-cycle').evaluate(b=>b.click());assert.deepEqual(await modePick(),['Dark'],'the bar\'s button steps on, and Settings follows');
    await page.locator('#theme-cycle').evaluate(b=>b.click());assert.deepEqual(await modePick(),['Match the device']);assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme??null),null);
    await page.locator('#mode-pick button',{hasText:'Dark'}).click();assert.equal(await pref('deck-theme'),'dark');assert.equal(await page.locator('#theme-cycle').getAttribute('aria-label'),'Light or dark: dark');
    // How to make a theme opens docs/THEMES.md at Making a theme, in the browser.
    assert.deepEqual(await page.locator('#theme-make-app, #theme-make-station').allTextContents(),['How to make a theme','How to make a theme']);
    await app.evaluate(({shell})=>{global.__opened=[];global.__open=shell.openExternal;shell.openExternal=async url=>{global.__opened.push(url);};});
    try{await page.locator('#theme-make-app').click();await page.locator('#theme-make-station').click();
      const opened=await (async()=>{for(let i=0;i<50;i++){const o=await app.evaluate(()=>global.__opened);if(o.length===2)return o;await page.waitForTimeout(100);}return app.evaluate(()=>global.__opened);})();
      assert.equal(opened.length,2);for(const url of opened)assert.match(url,/^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/(main|testing)\/docs\/THEMES\.md#making-a-theme$/);
      assert.match(fs.readFileSync(path.join(root,'docs/THEMES.md'),'utf8'),/^## Making a theme$/m,'the section the link opens');}
    finally{await app.evaluate(({shell})=>{shell.openExternal=global.__open;});}

    // A built-in colour and DEV go on; DEV's preview shows its characters. A pick keeps focus on what was picked.
    await card('#colours-app','Purple').click();
    assert.equal(await accent(),Themes.COLOURS[1].dark.accent);assert.equal(await focused(),'colours-app purple');
    await card('#themes-app','DEV').click();
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.look),'dev');assert.equal(await card('#themes-app','DEV').locator('.p-ascii').count(),1);
    // Hidden, the window stops DEV's ground; shown again, it goes on.
    await page.evaluate(()=>{window.__paused=[];const real=window.DeckAscii.pause;window.DeckAscii.pause=(doc,p)=>{window.__paused.push(p);return real?.(doc,p);};});
    await fromMain('window-state',{hidden:true});await fromMain('window-state',{hidden:false});
    await page.waitForFunction(()=>window.__paused.length===2);assert.deepEqual(await page.evaluate(()=>window.__paused),[true,false]);
    await card('#themes-app','Torque').click();await card('#colours-app','Torque').click();
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.look),'torque');assert.equal(await accent(),'#31d78c');

    // Making a colour: it starts from the colour on, as it was picked, and shows on the screens while it is made.
    await card('#colours-app','Purple').click();
    await page.locator('#colours-app .add-card').click();
    assert.equal(await page.locator('#colour-editor').isVisible(),true);assert.equal(await text('colour-editor-title'),'New colour');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'colour-name');
    assert.equal(await page.inputValue('#colour-accent-hex'),Themes.COLOURS[1].dark.accent);
    await page.fill('#colour-name','Sunset');
    // A hex code goes in once it is whole: typing #e91 shows nothing new until the field is left, then it is #ee9911.
    await page.fill('#colour-accent-hex','');await page.locator('#colour-accent-hex').pressSequentially('#e91');
    assert.equal(await page.inputValue('#colour-accent'),Themes.COLOURS[1].dark.accent,'a part-typed code changes nothing');assert.equal(await accent(),Themes.COLOURS[1].dark.accent);
    await page.locator('#colour-accent-hex').blur();
    assert.equal(await page.inputValue('#colour-accent-hex'),'#ee9911');assert.equal(await page.inputValue('#colour-accent'),'#ee9911');
    assert.equal(await accent(),Themes.colour({name:'Sunset',accent:'#ee9911',for:'app'}).dark.accent);
    // Without #, in capitals: Enter fills it out and puts it on, and the editor stays open.
    await page.fill('#colour-accent-hex','FF5A36');assert.equal(await page.inputValue('#colour-accent'),'#ee9911');
    await page.locator('#colour-accent-hex').press('Enter');
    assert.equal(await page.inputValue('#colour-accent-hex'),'#ff5a36');assert.equal(await page.inputValue('#colour-accent'),'#ff5a36','the colour well follows the hex code');
    assert.equal(await page.locator('#colour-editor').isVisible(),true);
    const sunset=Themes.colour({name:'Sunset',accent:'#ff5a36',for:'app'});
    assert.equal(await accent(),sunset.dark.accent,'the app shows it while it is made');
    await page.click('#colour-cancel');assert.equal(await page.locator('#colour-editor').isVisible(),false);assert.equal(await accent(),Themes.COLOURS[1].dark.accent);
    assert.deepEqual(await names('#colours-app'),[...BUILT,'Add a colour']);assert.equal(await focused(),'colours-app add','Cancel goes back to +');
    // Escape cancels too, and so does leaving Settings.
    await page.locator('#colours-app .add-card').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#colour-editor').isVisible(),false);
    await page.locator('#colours-app .add-card').click();await page.fill('#colour-accent-hex','#ff5a36');assert.equal(await accent(),sunset.dark.accent);
    await page.evaluate(()=>window.deck.page('drive'));await page.waitForFunction(()=>state.page==='drive');
    assert.equal(await page.locator('#colour-editor').isHidden(),true);assert.equal(await accent(),Themes.COLOURS[1].dark.accent,'leaving Settings puts back what was there');
    await page.evaluate(()=>window.deck.page('settings'));await page.waitForFunction(()=>state.page==='settings');
    await card('#colours-app','Torque').click();
    // A name is needed; then Save keeps it and puts it on, and focus goes to its card.
    await page.locator('#colours-app .add-card').click();await page.fill('#colour-accent-hex','#ff5a36');await page.click('#colour-save');
    assert.equal(await text('colour-editor-error'),'Give the colour a name.');
    await page.fill('#colour-name','Sunset');await page.click('#colour-save');
    await status('colour-app-status','Saved Sunset and put it on.');
    assert.deepEqual(await names('#colours-app'),[...BUILT,'Sunset','Add a colour']);assert.equal(await checked('#colours-app'),'Sunset');
    assert.equal(await accent(),sunset.dark.accent);assert.equal(JSON.parse(await pref('torque-colours')).length,1);
    const sunsetId=await page.evaluate(()=>colours[0].id);assert.equal(await focused(),`colours-app ${sunsetId}`);
    assert.ok(!(await names('#colours-station')).includes('Sunset'),'it is not in the Driver Station list');
    // The built-in colours have nothing under them; an own one has Edit, Export and Remove, each a finger wide.
    assert.deepEqual(await page.locator('#colours-app .choice-actions button').allTextContents(),['Edit','Export','Remove']);
    for(const w of await page.locator('#colours-app .choice-actions button').evaluateAll(b=>b.map(x=>x.getBoundingClientRect().width)))assert.ok(w>=44,`an action is ${w} px wide`);
    // A new colour starts from the one on as it was picked: Sunset's #ff5a36, not the accent moved to read.
    await page.locator('#colours-app .add-card').click();assert.equal(await page.inputValue('#colour-accent-hex'),'#ff5a36');await page.click('#colour-cancel');
    // Picking a colour takes away what the last save said.
    await card('#colours-app','Torque').click();assert.equal(await text('colour-app-status'),'');

    // Edit, while another colour is on: a new name and a background tint of its own. It is saved, and stays off.
    await page.getByRole('button',{name:'Edit Sunset'}).click();
    assert.equal(await text('colour-editor-title'),'Edit Sunset');assert.equal(await page.inputValue('#colour-name'),'Sunset');
    assert.equal(await page.locator('#colour-tint-field').isVisible(),false);
    await page.fill('#colour-name','Dusk');await page.uncheck('#colour-tint-same');assert.equal(await page.locator('#colour-tint-field').isVisible(),true);
    await page.fill('#colour-tint-hex','#3355ff');
    await page.screenshot({path:path.join(out,'settings-colour-editor.png')});
    await page.click('#colour-save');await status('colour-app-status','Saved Dusk.');
    assert.deepEqual(await names('#colours-app'),[...BUILT,'Dusk','Add a colour']);assert.equal(await checked('#colours-app'),'Torque');assert.equal(await focused(),`colours-app ${sunsetId}`);
    const saved=JSON.parse(await pref('torque-colours'));assert.equal(saved.length,1);assert.equal(saved[0].name,'Dusk');assert.equal(saved[0].tint,'#3355ff');
    const dusk=Themes.colour({name:'Dusk',accent:'#ff5a36',tint:'#3355ff',for:'app'});
    await card('#colours-app','Dusk').click();
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()),dusk.dark.bg,'the ground takes the tint');

    // Export: the save dialog picks a file, which holds the colour.
    const file=path.join(scratch,'Dusk.torque-colour.json');
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
    await page.getByRole('button',{name:'Export Dusk'}).click();await status('colour-app-status',`Exported Dusk to ${file}.`);
    assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{format:'torque-colour',version:1,name:'Dusk',accent:'#ff5a36',tint:'#3355ff'});

    // Remove asks first; no keeps it. Yes removes it, Torque goes back on, the line about the export goes, and focus is
    // on the colour now picked.
    answer=false;await page.getByRole('button',{name:'Remove Dusk'}).click();answer=true;
    assert.match(asked.at(-1),/^Remove Dusk\? /);assert.ok((await names('#colours-app')).includes('Dusk'));assert.equal(await checked('#colours-app'),'Dusk');
    await page.getByRole('button',{name:'Remove Dusk'}).click();
    await page.waitForFunction(()=>![...document.querySelectorAll('#colours-app .theme-name')].some(n=>n.textContent==='Dusk'));
    assert.equal(await checked('#colours-app'),'Torque');assert.equal(await accent(),'#31d78c');assert.deepEqual(JSON.parse(await pref('torque-colours')),[]);
    assert.equal(await text('colour-app-status'),'');assert.equal(await focused(),'colours-app torque');

    // Import, from the editor under the Driver Station colour list: into that list, and on. The same file again is not a
    // second copy.
    fs.writeFileSync(path.join(scratch,'broken.json'),'{"format":"torque-colour","version":1,"name":"Broken","accent":"red"}');
    await page.locator('#colours-station .add-card').click();
    assert.equal(await page.locator('#colour-import').textContent(),'Import a colour file');
    await pick('#colour-import',path.join(scratch,'broken.json'));
    await page.waitForFunction(()=>/^Couldn’t import it\. .*"accent" must be a hex colour/.test(document.querySelector('#colour-editor-error').textContent));
    await pick('#colour-import',file);await status('colour-station-status','Imported Dusk and put it on.');
    assert.equal(await page.locator('#colour-editor').isVisible(),false);
    assert.deepEqual(await names('#colours-station'),['Same as the app',...BUILT,'Dusk','Add a colour']);assert.equal(await checked('#colours-station'),'Dusk');
    assert.deepEqual(await names('#colours-app'),[...BUILT,'Add a colour']);
    const duskId=await page.evaluate(()=>colours[0].id);assert.equal(await focused(),`colours-station ${duskId}`);
    assert.equal((await lastLook(l=>l.current.colour===duskId)).current.colour,duskId);
    await page.locator('#colours-station .add-card').click();await pick('#colour-import',file);
    await page.waitForFunction(()=>document.querySelector('#colour-editor-error').textContent==='Dusk is already in this list.');
    assert.equal(await page.evaluate(()=>colours.length),1);await page.click('#colour-cancel');
    // Each colour carries its main colour as picked on the wheel, for its dot: Dusk's own, not the one moved to read.
    const withDusk=await lastLook(l=>l.current.colour===duskId);
    assert.deepEqual(withDusk.colours.map(c=>c.primary),['#31d78c',...Themes.COLOURS.map(c=>c.dark.accent),'#ff5a36']);
    assert.deepEqual(await page.locator('#colours-station .colour-dot').evaluateAll(d=>d.map(e=>e.style.getPropertyValue('--dot'))),['#31d78c',...Themes.COLOURS.map(c=>c.dark.accent),'#ff5a36']);
    await page.getByRole('button',{name:'Remove Dusk'}).click();await page.waitForFunction(()=>!document.querySelector('#colours-station .choice-remove'));
    assert.equal(await checked('#colours-station'),'Same as the app');assert.equal(await text('colour-station-status'),'');assert.equal(await focused(),'colours-station same');

    // A list is full at 16 colours, built-in ones counted: the + goes, and a line says why.
    await page.evaluate(n=>{colours=Array.from({length:n},(_,i)=>Themes.colour({name:'Colour '+(i+1),accent:'#3a7bd5',for:'app'}));saveColours();applyLooks();},Themes.MAX_COLOURS-Themes.COLOURS.length);
    assert.equal((await names('#colours-app')).length,Themes.MAX_COLOURS);assert.equal(await page.locator('#colours-app .add-card').count(),0);
    assert.equal(await text('colours-app-full'),'This list is full at 16 colours. Remove one of yours to add another.');
    assert.equal(await page.locator('#colours-station .add-card').count(),1,'the other list has its own room');
    await page.screenshot({path:path.join(out,'settings-colours-full.png')});
    await page.getByRole('button',{name:'Remove Colour 1',exact:true}).click();
    await page.waitForFunction(()=>!!document.querySelector('#colours-app .add-card'));assert.equal(await text('colours-app-full'),'');
    // They come back after the page loads again; then they go.
    await page.reload();await ready();assert.equal(await page.locator('#colours-app .choice-item').count(),Themes.MAX_COLOURS-Themes.COLOURS.length-1);
    await page.evaluate(()=>{colours=[];saveColours();applyLooks();});

    // An imported theme. The example package says "for": "station"; imported with the App theme list's +, it is an
    // app theme and goes on, in its own colours: "Night Shift’s own" comes first in the colour list, picked.
    await pick('#themes-app .add-card',path.join(root,'docs/themes/night-shift'));
    await status('theme-app-status','Imported Night Shift and put it on.');
    const night=await page.evaluate(()=>imported[0]);
    assert.equal(await checked('#themes-app'),'Night Shift');assert.ok(!(await names('#themes-station')).includes('Night Shift'),'it is not in the Driver Station list');assert.equal(await focused(),`themes-app ${night.id}`);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.look.startsWith('custom-night-shift-')),true);
    assert.equal(kept('themes').length,1,'the theme is kept in the data folder');
    assert.deepEqual(await names('#colours-app'),['Night Shift’s own',...BUILT,'Add a colour']);assert.equal(await checked('#colours-app'),'Night Shift’s own');
    assert.equal(await accent(),night.dark.accent);assert.equal(await pref('torque-app-colour'),'theme');
    assert.deepEqual(await names('#colours-station'),['Same as the app','Night Shift’s own',...BUILT,'Add a colour'],'the Driver Station is the same as the app');
    assert.equal(await checked('#colours-station'),'Same as the app');
    await page.screenshot({path:path.join(out,'settings-imported.png')});
    // Any colour over it: Purple, with the theme's pictures and logo kept. A pick takes away the import's line.
    await card('#colours-app','Purple').click();assert.equal(await text('theme-app-status'),'');
    assert.equal(await accent(),Themes.COLOURS[1].dark.accent);
    const drawn=await page.evaluate(()=>({look:document.documentElement.dataset.look,image:'themeImage' in document.documentElement.dataset,logo:'themeLogo' in document.documentElement.dataset}));
    assert.deepEqual(drawn,{look:night.id,image:true,logo:true});
    await page.screenshot({path:path.join(out,'settings-imported-purple.png')});
    // Its own again, then Torque: the colour from before the theme's own (Purple) is back.
    await card('#colours-app','Night Shift’s own').click();assert.equal(await accent(),night.dark.accent);
    await card('#themes-app','Torque').click();
    assert.equal(await checked('#colours-app'),'Purple');assert.equal(await accent(),Themes.COLOURS[1].dark.accent);assert.deepEqual(await names('#colours-app'),[...BUILT,'Add a colour']);
    // Picking it again puts its own colours on again.
    await card('#themes-app','Night Shift').click();assert.equal(await checked('#colours-app'),'Night Shift’s own');assert.equal(await accent(),night.dark.accent);
    // A list is full at 8 themes, built-in ones counted.
    await page.evaluate(n=>{const t=imported[0];imported=[...imported,...Array.from({length:n},(_,i)=>({...t,id:`${t.id}-${i}`,name:`Copy ${i+1}`}))];applyLooks();},Themes.MAX_THEMES-Themes.THEMES.length-1);
    assert.equal((await names('#themes-app')).length,Themes.MAX_THEMES);assert.equal(await page.locator('#themes-app .add-card').count(),0);
    assert.equal(await text('themes-app-full'),'This list is full at 8 themes. Remove one you imported to import another.');
    // Room for one, and two imports at once: only one gets in.
    await page.evaluate(()=>{imported=imported.slice(0,Themes.MAX_THEMES-Themes.THEMES.length-1);applyLooks();});assert.equal((await names('#themes-app')).length,Themes.MAX_THEMES);
    const before=kept('themes').length;
    await page.evaluate(()=>{const json=JSON.stringify({format:'torque-theme',version:1,name:'Twice',colours:{dark:{accent:'#ffa94d',background:'#0b0f1a',text:'#eef1f8'},light:{accent:'#b2560a',background:'#f3f5fa',text:'#121726'}}});const input=$('#theme-import-input');
      for(let i=0;i<2;i++){const files=new DataTransfer();files.items.add(new File([json],'theme.json',{type:'application/json'}));input.files=files.files;importKind='app';input.onchange();}});
    await page.waitForFunction(()=>imported.filter(t=>t.name==='Twice').length===1&&!importing.app);await page.waitForTimeout(300);
    assert.equal(await page.evaluate(()=>themeList('app').length),Themes.MAX_THEMES);assert.equal(kept('themes').length,before+1);
    await page.evaluate(async()=>{for(const t of imported.filter(t=>t.name==='Twice'))await window.deck.themes('remove',t.id);imported=imported.slice(0,1);prefs.set('torque-app-theme',imported[0].id);applyLooks();});
    assert.equal(await page.locator('#themes-app .add-card').count(),1);assert.equal(await text('themes-app-full'),'');
    await page.locator('#themes-app .choice-remove').click();assert.match(asked.at(-1),/^Remove Night Shift\? /);
    await page.waitForFunction(()=>![...document.querySelectorAll('#themes-app .theme-name')].some(n=>n.textContent==='Night Shift'));
    assert.equal(await checked('#themes-app'),'Torque');assert.deepEqual(kept('themes'),[]);assert.equal(await focused(),'themes-app torque');
    assert.equal(await checked('#colours-app'),'Purple','its own colours go with it');assert.deepEqual(await names('#colours-app'),[...BUILT,'Add a colour']);
    await card('#colours-app','Torque').click();

    // The Driver Station list's + puts it there instead (it stays on for the Driver Station below), in its own colours.
    await pick('#themes-station .add-card',path.join(root,'docs/themes/field-day'));
    await page.waitForFunction(()=>/^Imported .+ and put it on\.$/.test(document.querySelector('#theme-station-status').textContent));
    const fieldDay=await checked('#themes-station');assert.notEqual(fieldDay,'Same as the app');assert.ok(!(await names('#themes-app')).includes(fieldDay));
    assert.deepEqual(await names('#colours-station'),['Same as the app',`${fieldDay}’s own`,...BUILT,'Add a colour']);assert.equal(await checked('#colours-station'),`${fieldDay}’s own`);
    assert.deepEqual(await names('#colours-app'),[...BUILT,'Add a colour']);

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
    await page.waitForFunction(f=>[...document.fonts].some(face=>face.family.replace(/"/g,'')===f&&face.status==='loaded'),look.font.split(',')[0].replace(/"/g,''));
    assert.equal(kept('fonts').length,2,'the font file and its name are kept');
    await page.screenshot({path:path.join(out,'settings-font.png')});

    // What the Driver Station is sent: its look, and the lists and picks for the Theme and colour menu in its bar. The theme's own
    // colours come right after Same as the app.
    const stationThemeId=await page.evaluate(()=>imported[0].id),sent=await lastLook(l=>l.current.theme===stationThemeId);
    assert.deepEqual(sent.themes.map(t=>t.name),['Same as the app','Torque','DEV','FIRST','NYC FIRST',fieldDay]);
    assert.deepEqual(sent.colours.map(c=>[c.id,c.name]),[['same','Same as the app'],['theme',`${fieldDay}’s own`],...Themes.COLOURS.map(c=>[c.id,c.name])]);
    assert.equal(sent.colours[0].swatch.length,4);assert.ok(sent.colours.every(c=>/^#[0-9a-f]{6}$/.test(c.primary)),'every colour has its main colour');
    assert.deepEqual(sent.current,{theme:stationThemeId,colour:'theme'});assert.equal(sent.theme.look,stationThemeId);

    // A pick from the Driver Station's Theme and colour menu while a colour is half made: the same as a pick in Settings, so the editor
    // closes and nothing is saved.
    await page.locator('#colours-station .add-card').click();await page.fill('#colour-name','Half made');await page.fill('#colour-accent-hex','#ff00aa');
    await fromMain('station-theme',{kind:'colour',id:'mono'});
    await page.waitForFunction(()=>document.querySelector('#colour-editor').hidden);
    assert.equal(await pref('torque-station-colour'),'mono');assert.equal(await page.evaluate(()=>colours.length),0);assert.equal(await checked('#colours-station'),'Mono');
    await fromMain('station-theme',{kind:'colour',id:'theme'});await page.waitForFunction(()=>localStorage.getItem('torque-station-colour')==='theme');

    // An FTC robot, simulated in memory: its Driver Station has the Driver Station theme and the added font.
    await app.evaluate(({app})=>{const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json');const {FtcSocket}=req('./src/ftc.cjs'),{SimController}=req('./tools/ftc-sim.cjs');
      FtcSocket.prototype.open=async function(){this.address='10.9.9.9';const self=this;this.sim=new SimController({send:b=>{for(const fn of self.listeners)fn(new Uint8Array(b));}}).start();this.socket={close(cb){cb&&cb();}};return this;};
      FtcSocket.prototype.send=function(bytes){try{this.sim?.receive(new Uint8Array(bytes));}catch{}};FtcSocket.prototype.close=async function(){this.sim?.stop();this.sim=null;this.socket=null;this.listeners.clear();};});
    await page.evaluate(()=>window.deck.open({url:'10.9.9.9',name:'Practice bot',kind:'ftc'}));await page.waitForFunction(()=>state.kind==='ftc'&&!state.loading,null,{timeout:20000});
    let ds=null;for(let i=0;i<50&&!ds;i++){ds=app.context().pages().find(p=>p.url().includes('ui/ftc/index.html'));if(!ds)await page.waitForTimeout(100);}assert.ok(ds,'the Driver Station opened');
    ds.on('pageerror',e=>errors.push('Driver Station: '+e.message));
    await ds.waitForFunction(()=>document.documentElement.dataset.font==='custom'&&(document.documentElement.dataset.look||'').startsWith('custom-field-day-'),null,{timeout:15000});
    const fd=await page.evaluate(()=>imported[0]);
    await ds.waitForFunction(a=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()===a,fd.dark.accent,{timeout:15000});
    assert.equal(await ds.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--font')),look.font,'the Driver Station uses the added font');
    await ds.waitForFunction(f=>[...document.fonts].some(face=>f.includes(face.family.replace(/"/g,''))&&face.status==='loaded'),look.font,{timeout:15000});
    assert.equal(await ds.evaluate(()=>'fontWide' in document.documentElement.dataset),false,'Barlow Condensed is not a wide face');
    await ds.screenshot({path:path.join(out,'driver-station.png')});
    // Its Theme and colour menu, clicked: the theme's own colours are a row, picked; Orange goes over the theme's picture; then DEV in
    // Orange. Settings shows the same picks.
    const row=(kind,id)=>ds.locator(`#looks-menu .looks-item[data-kind="${kind}"][data-id="${id}"]`);
    const dsPick=async(kind,id)=>{await ds.locator('#looks-button').click();await row(kind,id).click();await ds.waitForFunction(()=>document.querySelector('#looks-menu').hidden);};
    await ds.locator('#looks-button').click();assert.equal(await row('colour','theme').getAttribute('aria-checked'),'true');assert.equal(await row('colour','theme').textContent(),`${fieldDay}’s own`);
    await ds.screenshot({path:path.join(out,'driver-station-theme-menu.png')});
    await ds.keyboard.press('Escape');
    const orange=Themes.COLOURS.find(c=>c.id==='orange');
    await dsPick('colour','orange');
    await ds.waitForFunction(o=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()===o,orange.dark.accent,{timeout:15000});
    assert.ok((await ds.evaluate(()=>document.documentElement.dataset.look)).startsWith('custom-field-day-'),'the theme stays on under the colour');
    assert.equal(await ds.evaluate(()=>'themeImage' in document.documentElement.dataset),true,'with its picture');
    await dsPick('theme','dev');
    await ds.waitForFunction(()=>document.documentElement.dataset.look==='dev',null,{timeout:15000});
    await ds.waitForFunction(o=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()===o,orange.dark.accent,{timeout:15000});
    assert.deepEqual([await pref('torque-station-theme'),await pref('torque-station-colour')],['dev','orange']);
    assert.equal(await checked('#themes-station'),'DEV');assert.equal(await checked('#colours-station'),'Orange');
    assert.deepEqual((await lastLook(l=>l.current.colour==='orange'&&l.current.theme==='dev')).current,{theme:'dev',colour:'orange'});
    await ds.locator('#looks-button').click();assert.equal(await row('colour','theme').count(),0,'with DEV on there is no theme’s own');await ds.keyboard.press('Escape');
    await ds.screenshot({path:path.join(out,'driver-station-dev.png')});
    // Something that is not in its lists changes nothing.
    await fromMain('station-theme',{kind:'colour',id:'colour-nothing-12345'});await fromMain('station-theme',{kind:'colour',id:'theme'});await page.waitForTimeout(200);assert.equal(await pref('torque-station-colour'),'orange');
    await dsPick('theme','same');await dsPick('colour','same');
    await ds.waitForFunction(()=>document.documentElement.dataset.look==='torque',null,{timeout:15000});
    // OpenDyslexic reaches the Driver Station too, at Inter's size, and the added font comes back after it.
    const addedId=await page.evaluate(()=>prefs.get('torque-font',''));
    await page.evaluate(()=>{prefs.set('torque-font','dyslexic');applyLooks();});
    await ds.waitForFunction(()=>document.documentElement.dataset.font==='dyslexic'&&!('fontWide' in document.documentElement.dataset),null,{timeout:15000});
    await ds.waitForFunction(()=>[...document.fonts].some(f=>f.family==='OpenDyslexic'&&f.status==='loaded'),null,{timeout:15000});
    await ds.screenshot({path:path.join(out,'driver-station-dyslexic.png')});
    await page.evaluate(id=>{prefs.set('torque-font',id);applyLooks();},addedId);
    await ds.waitForFunction(()=>document.documentElement.dataset.font==='custom'&&!('fontWide' in document.documentElement.dataset),null,{timeout:15000});
    await page.evaluate(()=>window.deck.close?.());await page.evaluate(()=>window.deck.page('settings'));await page.waitForFunction(()=>state.page==='settings');

    await page.locator('#themes-station .choice-remove').click();await page.waitForFunction(()=>!document.querySelector('#themes-station .choice-remove'));
    assert.equal(await checked('#themes-station'),'Same as the app');
    await page.locator('#fonts .choice-remove').click();await page.waitForFunction(()=>!document.documentElement.dataset.font);
    assert.equal(await checked('#fonts'),'Inter');assert.deepEqual(kept('fonts'),[]);assert.equal(await focused(),'fonts inter');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--font').trim().startsWith('Inter')),true);

    // OpenDyslexic, built in: words, titles and readings in it, a line as long as Inter's, and still on after a reload.
    const line=()=>page.evaluate(async()=>{await document.fonts.ready;const s=document.createElement('span');s.textContent='Plug the Control Hub into this computer with a USB-C cable.';s.style.cssText='position:absolute;white-space:nowrap;font-size:15px';document.body.append(s);const w=s.getBoundingClientRect().width;s.remove();return w;});
    const interLine=await line();
    await page.locator('#fonts .font-card',{hasText:'OpenDyslexic'}).click();
    await page.waitForFunction(()=>document.documentElement.dataset.font==='dyslexic'&&!('fontWide' in document.documentElement.dataset));
    assert.equal(await checked('#fonts'),'OpenDyslexic');
    const dys=await page.evaluate(async()=>{await document.fonts.ready;const s=getComputedStyle(document.documentElement);return {font:s.getPropertyValue('--font').trim(),display:s.getPropertyValue('--font-display').trim(),body:getComputedStyle(document.body).fontFamily,faces:[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family)};});
    assert.match(dys.font,/^OpenDyslexic,/);assert.match(dys.display,/^OpenDyslexic,/);assert.match(dys.body,/^OpenDyslexic/);
    assert.ok(dys.faces.includes('OpenDyslexic'),'it loads from the app: '+dys.faces.join(', '));
    const ratio=(await line())/interLine;assert.ok(ratio>.9&&ratio<1.12,`a line in OpenDyslexic is as long as in Inter (${ratio.toFixed(2)} times)`);
    await page.screenshot({path:path.join(out,'settings-dyslexic.png')});
    await page.reload();await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.font),'dyslexic','it is still on after the page loads again');
    await page.evaluate(()=>window.deck.page('settings'));await page.waitForFunction(()=>state.page==='settings');
    await page.locator('#fonts .font-card',{hasText:'Inter'}).click();
    await page.waitForFunction(()=>!document.documentElement.dataset.font&&!('fontWide' in document.documentElement.dataset));

    assert.deepEqual(errors,[]);console.log('Themes, colours and fonts: all passed');
  }finally{await app.close().catch(()=>{});fs.rmSync(data,{recursive:true,force:true});fs.rmSync(scratch,{recursive:true,force:true});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,4000));process.exit(1);});
