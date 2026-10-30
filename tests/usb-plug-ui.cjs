'use strict';
// Setup in the real app when a Control Hub is plugged in, against a stubbed USB link: a hub still starting shows a calm note and is
// read by itself when it is ready, and it scans by itself, once for each time it is plugged in.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/usb-plug-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..');
const XML=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><Robot type="FirstInspires-FTC"><LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173"><LynxModule name="Control Hub" port="173"><goBILDA5202SeriesMotor name="leftFront" port="0" /></LynxModule></LynxUsbDevice></Robot>`;
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-usb-')),env={...process.env,DECK_HEADLESS:'1',DECK_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);
    await app.evaluate(({ipcMain},xml)=>{const g=global;g.__u={plugged:true,reads:0,starting:2,scans:0};ipcMain.removeHandler('robot-link');ipcMain.handle('robot-link',async(e,action)=>{const r=g.__u,ok=value=>({ok:true,value});
      if(action==='detect')return ok(r.plugged?{usb:{found:true,serial:'hub1'},wifi:{robot:false}}:{usb:{found:false,message:'Not plugged in.'},wifi:{robot:false}});if(action==='usb-status')return ok({found:r.plugged,serial:'hub1'});if(action==='usb-recover')return ok(null);
      if(action==='read-usb'){r.reads++;if(r.starting>0){r.starting--;return {ok:false,error:'The Control Hub is still starting up. This takes about a minute after the battery goes on.',code:'HUB_STARTING'};}return ok({serial:'hub1',active:{name:'lunala'},configurations:['lunala'],files:{lunala:xml}});}
      if(action==='check')return ok([{name:'Robot Controller app',ok:true,detail:'FTC SDK 12.0'}]);if(action==='scan'){r.scans++;return ok({portals:[{serial:'(embedded)',modules:[{address:173,parent:true}],servoHubs:[]}],others:[]});}
      return {ok:false,error:'not in this test: '+action};});},XML);
    const u=()=>app.evaluate(()=>global.__u);
    await page.click('#robot-setup-tab');
    // Still starting: no red, no "could not read".
    await page.waitForFunction(()=>/still starting/.test(document.querySelector('#setup-view').textContent),null,{timeout:15000});assert.ok(!/Could not read/.test(await page.locator('#setup-view').textContent()),'not an error');
    // Ready: read and scanned with nothing pressed.
    await page.waitForFunction(()=>document.querySelectorAll('#rs-configs .rs-config').length===1,null,{timeout:30000});await page.waitForTimeout(4000);
    {const r=await u();assert.ok(r.reads>=3,`it kept reading: ${r.reads}`);assert.equal(r.scans,1,'it scanned by itself, once');}
    await page.waitForTimeout(4000);assert.equal((await u()).scans,1,'and not again');
    // Unplugged and plugged in again: read and scanned again.
    await app.evaluate(()=>{global.__u.plugged=false;});await page.waitForTimeout(7000);await page.evaluate(()=>document.querySelector('#hub-dropped[open]')?.close());await app.evaluate(()=>{global.__u.plugged=true;});await page.waitForTimeout(8000);assert.equal((await u()).scans,2,'plugged in again, it scans again');
    assert.deepEqual(errors,[]);console.log('USB plug in: all passed');
  }finally{await app.close().catch(()=>{});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,1200));process.exit(1);});
