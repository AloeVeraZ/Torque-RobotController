'use strict';
// Exercise production renderers with deliberately awkward content. Fixture-only
// render calls do not connect to networks, download updates or command a robot.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.join(__dirname,'..'),out=path.join(root,'test-results/layout-audit');fs.mkdirSync(out,{recursive:true});
const layouts=[[360,480,1],[390,844,1],[640,480,1],[800,600,1],[1024,600,1],[1280,720,1],[1280,800,1],[1920,1080,1],[3840,2160,1],[1280,800,1.25],[1280,800,1.5],[1280,800,2]];
const longSsid='Robot_Laboratory_ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0,32),longName='Robotics control station / '+('LongRobotName'.repeat(8)).slice(0,62),longUrl='http://robot.local:5000/'+('long-path-segment-'.repeat(100));
(async()=>{
 const env={...process.env,DECK_HEADLESS:'1',DECK_CONTROLLER_TEST:'1',DECK_DEVICE_MODEL:'Steam Deck LCD',DECK_DATA_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'deck-layout-audit-'))};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root,...(env.DECK_ELECTRON_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[])],env});
 const issues=[],errors=[];let cases=0;
 try{
  const page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>typeof hardware==='object'&&hardware.model==='Steam Deck LCD');
  await app.evaluate(({app},ssid)=>{const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),{Network}=req('./src/network.cjs');Network.prototype.status=async()=>({connected:true,native:true,ssid});Network.prototype.scan=async()=>Array.from({length:12},(_,i)=>({ssid:i?('Network_'+i+'_'+ssid).slice(0,32):ssid,security:'WPA2'}));},longSsid);
  await page.evaluate(()=>window.deck.network());for(let i=0;i<4;i++)await page.evaluate(r=>window.deck.save(r),{name:longName+i,url:longUrl+i});
  await page.evaluate(()=>window.__deckGamepadTest.set([{id:'Generic '+('unbroken_driver_description_'.repeat(65)),index:0,mapping:'standard',connected:true,axes:[-.98,.98,-.01,.04],buttons:Array.from({length:24},(_,i)=>({value:i%2,pressed:!!(i%2),touched:!!(i%2)}))}]));
  const win=await app.browserWindow(page);
  const touch=await page.context().newCDPSession(page);await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  const tap=async selector=>{const el=page.locator(selector);await el.scrollIntoViewIfNeeded();const r=await el.boundingBox();await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width/2,y:r.y+r.height/2}]});await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
  const inspect=async(name,label)=>{
   cases++;
   // Menus and dialogs open on a short spring (they grow from 94%); measure them settled. Each is taken to its end here
   // rather than waited for: a window that is not being drawn (a headless Linux run) never advances an animation.
   await page.evaluate(()=>{for(const a of document.getAnimations())if(a.effect?.getComputedTiming().iterations!==Infinity){try{a.finish();}catch{}}});
   const found=await page.evaluate(()=>{
    const problems=[],visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden',rect=e=>e.getBoundingClientRect(),cross=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
    const dialog=document.querySelector('dialog[open]'),scope=dialog||document;
    if(document.documentElement.scrollWidth>document.documentElement.clientWidth+1)problems.push('document horizontal overflow');
    if(dialog&&(dialog.scrollWidth>dialog.clientWidth+1||rect(dialog).left<0||rect(dialog).right>innerWidth+1))problems.push('dialog horizontal overflow');
    const groups=dialog?['.dialog-heading','.controller-identity','.controller-tabs','.controller-test-grid','.axis-readings','.stick-plots','.calibration-plots','.update-channels','.button-row','.dialog-actions']:['header','nav','.header-right','.browser-toolbar','.browser-actions','.panel-title','.settings-heading','.network-binding','.controller-card','.robot-card-head','.robot-card-actions','.saved-row','.saved-actions','.button-row','.wifi-row'];
    for(const selector of groups)for(const group of scope.querySelectorAll(selector)){
     const children=[...group.children].filter(e=>visible(e)&&getComputedStyle(e).position!=='absolute');
     for(let i=0;i<children.length;i++)for(let j=i+1;j<children.length;j++)if(cross(rect(children[i]),rect(children[j])))problems.push(selector+' children overlap: '+(children[i].id||children[i].className)+' / '+(children[j].id||children[j].className));
    }
    for(const el of scope.querySelectorAll('button,input,select'))if(visible(el)){
     const box=rect(el);if(box.width>innerWidth+1||box.left<-.5||box.right>innerWidth+.5)problems.push('control outside screen: '+(el.id||el.className));
     if(el.tagName==='BUTTON'&&el.scrollWidth>el.clientWidth+2)problems.push('button content clipped: '+(el.id||el.className));
     if(el.tagName==='BUTTON'&&box.height<43.5&&!el.closest('.touch-keyboard'))problems.push('small touch target: '+(el.id||el.className));
    }
    for(const el of scope.querySelectorAll('label'))if(visible(el))for(const text of el.childNodes)if(text.nodeType===3&&text.textContent.trim()){
     const range=document.createRange();range.selectNodeContents(text);for(const span of el.children)if(visible(span)&&getComputedStyle(span).float!=='none')for(const box of range.getClientRects())if(cross(box,rect(span)))problems.push('label text overlaps hint: '+el.htmlFor);
    }
    for(const selector of ['.welcome','.page-status']){const el=document.querySelector(selector);if(!dialog&&visible(el)){const box=rect(el),mount=rect(el.parentElement);const style=getComputedStyle(el.parentElement);if((box.top<mount.top-1&&el.parentElement.scrollTop===0)||(['hidden','clip'].includes(style.overflowY)&&box.bottom>mount.bottom+1))problems.push(selector+' clipped by drive viewport');}}
    if(dialog?.id==='controller-dialog')for(const id of ['controller-cancel','controller-done']){const box=rect(document.getElementById(id));if(box.top<0||box.bottom>innerHeight+1)problems.push('controller exit outside viewport: '+id);}
    const keyboard=document.querySelector('.touch-keyboard');if(visible(keyboard)){
     const host=rect(keyboard);if(host.top<0||host.bottom>innerHeight+1)problems.push('keyboard outside viewport');
     for(const key of keyboard.querySelectorAll('button')){const box=rect(key);if(box.top<host.top||box.bottom>host.bottom+1)problems.push('keyboard key clipped: '+key.textContent);if(box.height<28)problems.push('keyboard row collapsed');}
    }
    return [...new Set(problems)];
   });
   if(found.length)issues.push({layout:name,state:label,issues:found});
  };
  // The on-screen keyboard is off by default; switch it on as the three-dot menu does.
  await page.evaluate(()=>{const on=document.querySelector('#touch-keyboard-auto');if(!on.checked)document.querySelector('#menu-keyboard').click();});
  for(const [width,height,zoom]of layouts){
   const name=`${width}x${height}@${zoom}`;await win.evaluate((w,s)=>{w.setMinimumSize(0,0);w.setContentSize(s.width,s.height);w.webContents.setZoomFactor(s.zoom);},{width,height,zoom});
   await page.evaluate(()=>document.fonts.ready.then(()=>undefined));
   await page.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();setMenu(false);render({...state,page:'settings',url:'',robot:null,error:'',loading:false,robotFullscreen:false});});await inspect(name,'Settings / saved robots / long names');
   await page.evaluate(()=>{document.querySelector('#library-search').value='no matching robot';renderLibrary(true);});await inspect(name,'Settings / empty search');await page.evaluate(()=>{document.querySelector('#library-search').value='';renderLibrary(true);});
   await tap('#robot-url');await page.waitForFunction(()=>document.body.dataset.touchKeyboard==='open');await inspect(name,'Settings / touch keyboard');await page.locator('.touch-keyboard-title button').click();
   await page.locator('#wifi-picker').click();await page.locator('.wifi-row').first().waitFor();await inspect(name,'Wi-Fi / long SSIDs');await page.keyboard.press('Escape');
   await page.evaluate(()=>{render({...state,page:'drive',url:'',robot:null,error:'',loading:false});});await inspect(name,'Drive / welcome / saved shortcuts');
   await page.evaluate(url=>render({...state,page:'drive',url,title:'Loading',loading:true,error:'',kind:'web'}),longUrl);await inspect(name,'Drive / loading / long URL');
   await page.evaluate(url=>render({...state,page:'drive',url,title:'Connection paused',loading:false,error:'Wi-Fi disconnected. Your robot address is saved. Reconnect Wi-Fi, then choose Try again. '+url,recovering:true,kind:'ftc',manager:true,robot:{name:'Fixture',id:'fixture'}}),longUrl);await inspect(name,'Drive / recovery / all toolbar actions');
   await page.locator('#more').click();await inspect(name,'More menu');await page.keyboard.press('Escape');
   await page.evaluate(ssid=>{document.querySelector('#wifi-dialog-message').textContent='Connect to '+ssid;document.querySelector('#wifi-error').textContent='Could not connect. Check the password and try again.';document.querySelector('#wifi-dialog').showModal();},longSsid);await inspect(name,'Wi-Fi password / failure');await page.evaluate(()=>document.querySelector('#wifi-dialog').close());
   await page.evaluate(url=>{document.querySelector('#auth-host').textContent=url;document.querySelector('#auth-dialog').showModal();},longUrl);await inspect(name,'Robot sign-in / long host');await page.evaluate(()=>document.querySelector('#auth-dialog').close());
   await page.evaluate(()=>{document.querySelector('#controller-dialog').showModal();controllerMonitor.render({count:2,slots:[null,null],readings:[]});});await inspect(name,'Controller / unassigned');await page.evaluate(()=>document.querySelector('#controller-dialog').close());
   await page.evaluate(async()=>controllerMonitor.render(await window.deck.controllerInfo()));await page.locator('#controller-1').click();await page.locator('#controller-input-tab').click();await page.evaluate(()=>{document.querySelector('#controller-driver-details').open=true;document.querySelector('#steamdeck-controls').open=true;document.querySelector('#controller-mode-help').open=true;});await inspect(name,'Controller / 24 buttons / expanded help');
   await page.locator('#controller-calibration-tab').click();await inspect(name,'Controller / calibration');await page.locator('#controller-done').click();
   await page.locator('#controller-2').click();await inspect(name,'Controller 2 / optional / assignment capture');await page.locator('#controller-done').click();
   await page.evaluate(()=>{renderUpdateInfo({version:'99.99.99',channel:'main',installedChannel:'testing'});document.querySelector('#update-dialog').showModal();document.querySelector('#testing-warning').hidden=false;document.querySelector('#update-download').hidden=false;document.querySelector('#update-changelog').hidden=false;document.querySelector('#update-notes').textContent='Release notes '+('unbrokenReleaseNotes'.repeat(150));document.querySelector('#update-status').textContent='The update could not be downloaded. Check your connection and try again.';});await inspect(name,'Updates / warning / notes / failure');
   if(width===1280&&height===800&&zoom===1)await page.screenshot({path:path.join(out,'updates-lcd.png'),scale:'css'});
   await page.evaluate(()=>{document.querySelector('#testing-warning').hidden=true;document.querySelector('#update-progress').hidden=false;document.querySelector('#update-progress').value=40;document.querySelector('#update-status').textContent='Downloading and verifying update…';updateButtons(true);});await inspect(name,'Updates / download progress');await page.evaluate(()=>{updateButtons(false);document.querySelector('#update-progress').hidden=true;});
   await page.evaluate(()=>document.querySelector('#update-dialog').close());
   console.log('Audited '+name);
   if(width===1280&&height===800&&zoom===1){await page.evaluate(()=>render({...state,page:'settings',url:'',robot:null,error:'',loading:false}));await page.screenshot({path:path.join(out,'settings-lcd.png'),fullPage:true,scale:'css'});}
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,process.env.DECK_LAYOUT_BASELINE?'before.json':'report.json'),JSON.stringify({cases,layouts:layouts.length,issues},null,2));
  if(process.env.DECK_LAYOUT_BASELINE)console.log(JSON.stringify({cases,failing:issues.length,issues},null,2));else{assert.deepEqual(issues,[],'Layout audit found overlapping, clipped or unreachable controls');console.log(`PASS: ${cases} shell layout/state checks across ${layouts.length} screen/zoom configurations; long names/URLs/SSIDs, 24-button diagnostics, expanded help, recovery, sign-in, update warnings and notes; no geometry overlaps, horizontal overflow or clipped buttons. Robot websites excluded.`);}
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
