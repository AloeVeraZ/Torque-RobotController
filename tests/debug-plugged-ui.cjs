'use strict';
// Calibrate → Debug on the lines a robot sends, in the real app with its real styles: what it says about an analog input stuck at 0 V, and about I2C devices with no read configuration behind them.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/debug-plugged-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright'),root=path.join(__dirname,'..'),wait=ms=>new Promise(r=>setTimeout(r,ms));
const soon=async(what,fn)=>{const end=Date.now()+8000;while(Date.now()<end){if(await fn().catch(()=>false))return;await wait(100);}throw Error('Not within 8 s: '+what);};
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-debug-plugged-')),env={...process.env,DECK_HEADLESS:'1',DECK_DATA_DIR:data,ADB:'C:\\Windows\\System32\\where.exe'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);await page.setViewportSize({width:1280,height:800});
    await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.webContents.setBackgroundThrottling(false);});
    await page.evaluate(()=>window.deck.page('calibrate'));await page.waitForFunction(()=>state.page==='calibrate');await page.click('#cal-tab-debug');
    const send=message=>app.evaluate(({BrowserWindow},m)=>{for(const w of BrowserWindow.getAllWindows())w.webContents.send('robot-link-debug',m);},message);
    await send({manifest:{deck:'debug',version:1,motors:[],servos:[],crservos:[],digital:[],touch:[],cameras:[],analog:[{n:'wrist',max:3.3}],i2c:[{n:'gone',k:'color',h:173,b:1,a:0x29},{n:'there',k:'other',h:173,b:2,a:0x32},{n:'asking',k:'distance',h:173,b:3,a:0x29},{n:'nowhere',k:'other'}],hubs:[{n:'Control Hub',address:173,parent:true}]}});
    await page.waitForSelector('#cal-debug [data-port="analog:wrist"]');
    // Frames, then until the page has drawn the last: the robot clock in the stats line says how far it has got.
    let t=0;const frames=async(volts,count)=>{for(let i=0;i<count;i++){t+=100;await send({frame:{t,loop:6,v:12.6,m:[],s:[],c:[],d:[],touch:[],a:[volts],i:[{age:null,v:null},{age:null,v:null},{age:null,v:null},{age:null,v:null}],on:[0,1,-1],b:[{h:173,swept:true,found:[[],[],[0x32],[]],a:[volts,0,0,0]}]}});}
      await soon('the last frame drawn',async()=>(await page.textContent('[data-debug-stats]')).includes(`robot clock ${(t/1000).toFixed(1)} s`));};
    const plug=page.locator('#cal-debug [data-live="a:wrist:plug"]'),pill=name=>page.locator(`#cal-debug [data-live="ib:${name}"]`);
    // A moment at 0 V is not enough: a sensor can pass through it.
    await frames(0,10);assert.equal(await plug.isHidden(),true,'too soon to say');
    await frames(0,30);await soon('stuck at 0 V',()=>plug.isVisible());assert.equal(await plug.innerText(),'Reads 0 V: probably not plugged in');
    await frames(1.2,110);await soon('it reads something',()=>plug.isHidden());
    await frames(.001,110);await soon('an empty port on a real hub read up to 0.001 V',()=>plug.isVisible());
    // No configuration was read, so these are listed under the robot rather than on a bus, and still say what the hub heard.
    assert.equal(await pill('gone').innerText(),'Not answering: check its cable');assert.equal(await pill('there').innerText(),'Connected');assert.equal(await pill('asking').innerText(),'Checking…');assert.equal(await pill('nowhere').innerText(),'In the configuration');
    assert.deepEqual(errors,[]);console.log('Debug, what is plugged in: all passed');
  }finally{await app.close().catch(()=>{});fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,2400));process.exit(1);});
