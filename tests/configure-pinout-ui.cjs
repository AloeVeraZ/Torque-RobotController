'use strict';
// In the real app, against a stubbed Control Hub:
//  A. Configure → Get pinout, right beside Active configuration: the wiring sheet of what is on screen, unsaved changes and
//     webcams included, saved as a picture;
//  B. Simulate's yellow note: gone on the demos that ship with Torque, there on a team's robot, closable, stays closed for that
//     setup, and holds nothing back: Plan, Run and Video open with no Setup or Calibrate done.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/configure-pinout-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/configure-pinout');fs.mkdirSync(out,{recursive:true});
const XML=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><Robot type="FirstInspires-FTC"><Webcam name="Webcam 1" serialNumber="ABC123" /><LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173"><LynxModule name="Expansion Hub 2" port="2"><goBILDA5202SeriesMotor name="arm" port="1" /></LynxModule><LynxModule name="Control Hub" port="173"><goBILDA5202SeriesMotor name="leftFront" port="0" /><Servo name="claw" port="2" /></LynxModule></LynxUsbDevice></Robot>`;
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-pinout-')),env={...process.env,DECK_HEADLESS:'1',DECK_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);await page.setViewportSize({width:1280,height:800});
    const saved=path.join(data,'lunala pinout.png');
    await app.evaluate(({ipcMain,dialog},{files,saved})=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:saved});
      ipcMain.removeHandler('robot-link');ipcMain.handle('robot-link',async(e,action)=>{const ok=value=>({ok:true,value});
        if(action==='detect')return ok({usb:{found:true,serial:'hub1'},wifi:{robot:false}});if(action==='usb-status')return ok({found:true,serial:'hub1'});
        if(action==='read-usb')return ok({serial:'hub1',active:{name:'lunala'},configurations:Object.keys(files),files});
        if(action==='check')return ok([{name:'Robot Controller app',ok:true,detail:'FTC SDK 12.0'}]);
        // The app scans by itself as soon as a hub is plugged in.
        if(action==='scan')return ok({portals:[],others:[]});
        return {ok:false,error:'not in this test: '+action};});},{files:{lunala:XML},saved});
    // A. The pinout, right beside Active configuration.
    await page.click('#robot-setup-tab');await page.waitForFunction(()=>document.querySelectorAll('#rs-configs .rs-config').length===1);
    await page.click('#setup-view .flow-steps [data-flow=configure]');await page.waitForSelector('[data-ce-pinout]');
    const side=await page.evaluate(()=>{const label=document.querySelector('.ce-config').getBoundingClientRect(),b=document.querySelector('[data-ce-pinout]').getBoundingClientRect();const select=document.querySelector('.ce-config select').getBoundingClientRect();return {gap:b.left-label.right,top:b.bottom-select.bottom,next:document.querySelector('.ce-config').nextElementSibling.dataset.cePinout!==undefined};});
    assert.ok(side.next,'the button comes straight after Active configuration');assert.ok(side.gap>=0&&side.gap<20,`right beside it: ${side.gap}px`);assert.ok(Math.abs(side.top)<12,'level with the dropdown');
    await page.click('[data-ce-pinout]');await page.waitForSelector('#sim-pinout[open] img.pin-sheet');
    const sheet=await page.evaluate(async()=>{const img=document.querySelector('#sim-pinout img.pin-sheet');await img.decode();const text=await (await fetch(img.src)).text(),box=document.querySelector('#sim-pinout').getBoundingClientRect();return {w:img.naturalWidth,shown:img.clientWidth,text,title:document.querySelector('#sim-pinout h2').textContent,left:box.left,right:box.right};});
    assert.ok(sheet.w>400&&sheet.shown>200,`the sheet draws: ${sheet.w}, ${sheet.shown}`);assert.equal(sheet.title,'Pinout · lunala');assert.ok(sheet.left>=0&&sheet.right<=1280,'fits the Steam Deck screen');
    for(const name of ['leftFront','arm','claw','Webcam 1'])assert.ok(sheet.text.includes(name),`${name} is on the sheet`);
    assert.equal(await page.locator('#sim-pinout .pin-note',{hasText:'before they are saved'}).count(),0,'nothing unsaved yet');
    const before=await page.locator('#sim-pinout .pin-sheet').evaluate(i=>i.clientWidth);await page.getByRole('button',{name:'Zoom in'}).click();assert.ok(await page.locator('#sim-pinout .pin-sheet').evaluate(i=>i.clientWidth)>before,'zooms in');await page.locator('#sim-pinout .pin-tools button',{hasText:'Fit'}).click();
    await page.screenshot({path:path.join(out,'pinout.png')});
    await page.locator('#sim-pinout button',{hasText:'Save PNG'}).click();await page.waitForFunction(()=>/Saved /.test(document.querySelector('#sim-pinout [role=status]').textContent));assert.ok(fs.statSync(saved).size>1000,'a PNG was written');assert.equal(fs.readFileSync(saved).subarray(1,4).toString(),'PNG');
    await page.getByRole('button',{name:'Close the pinout'}).click();assert.equal(await page.locator('#sim-pinout[open]').count(),0);await page.screenshot({path:path.join(out,'configure.png')});
    // Unsaved changes are drawn too.
    await page.locator('.ce-hubs').getByText('Expansion Hub 2').first().click().catch(()=>{});await page.waitForTimeout(150);await page.locator('.ce-main button',{hasText:/Motors/}).first().click();await page.locator('.ce-main input[id^=ce-name-]').first().fill('elbow');await page.locator('.ce-main input[id^=ce-name-]').first().press('Tab');await page.waitForSelector('[data-ce-save]:not([disabled])');
    await page.click('[data-ce-pinout]');await page.waitForSelector('#sim-pinout[open] .pin-note');assert.match(await page.locator('#sim-pinout .pin-note').first().textContent(),/before they are saved/);
    assert.ok((await page.evaluate(async()=>await (await fetch(document.querySelector('#sim-pinout img.pin-sheet').src)).text())).includes('elbow'),'the sheet has the new name');
    await page.keyboard.press('Escape');assert.equal(await page.locator('#sim-pinout[open]').count(),0,'Escape closes it');await page.click('[data-ce-cancel]');
    // B. The yellow note. A team's own robot has it.
    const note=page.locator('#sim-reliable'),setups=async()=>{await page.click('#sim-setup');const ids=await page.locator('.sim-setup-option').evaluateAll(l=>l.map(o=>[o.dataset.setupId,o.textContent]));await page.keyboard.press('Escape');return ids;};
    const pick=async id=>{if(await page.locator('#sim-setup-list').isHidden())await page.click('#sim-setup');await page.locator(`.sim-setup-option[data-setup-id="${id}"]`).click();await page.waitForFunction(i=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).setupId===i,id);await page.waitForTimeout(250);};
    await page.evaluate(()=>window.deck.page('simulation'));await page.waitForFunction(()=>state.page==='simulation');await page.waitForTimeout(400);
    const all=await setups(),demos=all.filter(([id])=>id.startsWith('preset:')),team=all.find(([id])=>!id.startsWith('preset:'));
    for(const name of ['A301 Swerve','Starter Mecanum'])assert.ok(demos.some(d=>d[1].includes(name)),`${name} ships with Torque`);assert.ok(team,'a team setup');
    await pick(team[0]);assert.equal(await note.isVisible(),true,'a team robot has the note');
    const close=note.locator('.sim-reliable-close'),mark=await close.evaluate(b=>{const r=document.createRange();r.selectNodeContents(b);const t=r.getBoundingClientRect(),o=b.getBoundingClientRect();return {dx:Math.abs((t.left+t.right)-(o.left+o.right))/2,dy:Math.abs((t.top+t.bottom)-(o.top+o.bottom))/2,w:o.width,h:o.height};});
    assert.ok(mark.dx<1.5&&mark.dy<3,`the × is centered: ${JSON.stringify(mark)}`);await page.screenshot({path:path.join(out,'note.png')});
    // Holds nothing back: every part of the simulation opens with no Setup or Calibrate done.
    const open=async()=>{for(const name of ['plan','run','video']){const b=page.locator(`.sim-tabs [data-tab=${name}]`);assert.equal(await b.isDisabled(),false,`${name} opens`);if(name==='video')continue;await b.click();assert.equal(await page.locator('[data-tab]').first().count(),1);await page.waitForFunction(n=>document.querySelector('.sim-tabs [data-tab='+n+']').getAttribute('aria-selected')==='true'||document.querySelector('.sim-tabs [data-tab='+n+']').classList.contains('active'),name);}await page.locator('.sim-tabs [data-tab=setup]').click();};
    await open();
    // The demos never have it.
    for(const [id,name] of demos.filter(d=>/A301|Starter Mecanum/.test(d[1]))){await pick(id);assert.equal(await note.isVisible(),false,`no note on ${name}`);await open();}
    await page.screenshot({path:path.join(out,'demo.png')});
    // Closing it holds for that setup, through a restart of the page, and for no other.
    await pick(team[0]);assert.equal(await note.isVisible(),true,'back on the team robot');await close.click();assert.equal(await note.isVisible(),false,'closes');
    await pick(demos[0][0]);await pick(team[0]);assert.equal(await note.isVisible(),false,'stays closed');
    await page.reload();await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);await page.evaluate(()=>window.deck.page('simulation'));await page.waitForFunction(()=>state.page==='simulation');await page.waitForTimeout(400);assert.equal(await note.isVisible(),false,'stays closed after a reload');
    assert.deepEqual(errors,[]);console.log('Configure pinout and Simulate note: all passed');
  }finally{await app.close().catch(()=>{});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,1500));process.exit(1);});
