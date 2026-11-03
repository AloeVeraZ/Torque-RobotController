'use strict';
const path=require('node:path');
// Desktop FTC check: drives the real Electron app over CDP against the simulated Control Hub on 127.0.0.2.
// DECK_ELECTRON=path/to/electron node tests/ftc-app.cjs
const root=path.join(__dirname,'..'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),assert=require('node:assert/strict');
const model=process.env.DECK_TEST_MODEL||'Steam Deck LCD';
const {startUdpRobot}=require(path.join(root,'tools/ftc-sim.cjs'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=8000,what='condition'){const end=Date.now()+ms;while(Date.now()<end){try{const v=await fn();if(v)return v;}catch{}await wait(100);}throw Error('Timed out: '+what);}
class Cdp{constructor(url){this.ws=new WebSocket(url);this.id=0;this.cbs=new Map();this.ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&this.cbs.has(d.id)){this.cbs.get(d.id)(d);this.cbs.delete(d.id);}};this.ready=new Promise(r=>this.ws.onopen=r);}
  send(method,params={}){const id=++this.id;return new Promise(r=>{this.cbs.set(id,r);this.ws.send(JSON.stringify({id,method,params}));});}
  async eval(expr){const r=await this.send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails).slice(0,400));return r.result?.result?.value;}
  async shot(file){const r=await this.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(file,Buffer.from(r.result.data,'base64'));}}
async function targets(){return (await fetch('http://127.0.0.1:9333/json/list')).json();}
(async()=>{
  const robot=await startUdpRobot({address:'127.0.0.2'}),data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-e2e-')),out=path.join(root,'test-results','ftc');fs.mkdirSync(out,{recursive:true});
  // Ubuntu CI restricts unprivileged user namespaces. The sandbox exception is
  // confined to this simulated-robot test process, never the packaged launcher.
  const launch=()=>spawn(process.env.DECK_ELECTRON||path.join(root,'.cache/runtime-win32-x64-44.8.0/electron.exe'),[root,'--remote-debugging-port=9333',...(process.env.DECK_ELECTRON_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[])],{env:(()=>{const e={...process.env,ADB:process.env.ADB||(process.platform==='win32'?'C:\\Windows\\System32\\where.exe':process.platform==='darwin'?'/usr/bin/true':'/bin/true'),DECK_DATA_DIR:data,DECK_DEVICE_MODEL:model,DECK_CONTROLLER_TEST:'1',DECK_HEADLESS:process.env.DECK_FTC_SCREENSHOTS==='1'?'0':'1'};delete e.ELECTRON_RUN_AS_NODE;return e;})(),stdio:'ignore'});
  let app=launch();
  try{
    const launcherT=await until(async()=>(await targets()).find(t=>t.url.endsWith('ui/index.html')),15000,'launcher');const L=new Cdp(launcherT.webSocketDebuggerUrl);await L.ready;
    await until(()=>L.eval('typeof state==="object"&&!!document.querySelector("#wifi-summary")'),10000,'launcher ready');
    await L.eval(`window.deck.open({url:'127.0.0.2',name:'Practice Bot'})`);
    const dsT=await until(async()=>(await targets()).find(t=>t.url.includes('ui/ftc/index.html')),10000,'driver station view');const D=new Cdp(dsT.webSocketDebuggerUrl);await D.ready;
    await until(()=>D.eval(`document.querySelector('#link-text').textContent==='Robot Connected'&&document.querySelector('#config').textContent==='competition'`),8000,'DS connected');
    // Both renderers see fixture pads through the production input preload.
    const controllerName=/ROG/i.test(model)?'ROG Ally Controller':/Legion/i.test(model)?'Lenovo Legion Go Controller':'Steam Deck Controller (Vendor: 28de Product: 1205)';
    const make=(id,index,y=0,pressed=false)=>({id,index,connected:true,mapping:'standard',axes:[0,y,0,0],buttons:Array.from({length:17},(_,i)=>({pressed:pressed&&i===0,value:pressed&&i===0?1:0}))});
    const pads=[make('Xbox Wireless Controller',0),null,make(controllerName,2)];
    async function feed(){const capture=await L.eval('window.deck.controllerInfo().then(s=>!!s.capture||s.paused)');for(const c of capture?[D,L]:[L,D])await c.eval('window.__deckGamepadTest.set('+JSON.stringify(pads)+')');}
    await until(()=>D.eval('!!window.__deckGamepadTest'),5000,'shared gamepad preload');
    await D.eval("Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});document.hasFocus=()=>true");
    await feed();pads[0].axes[1]=0.25;pads[2].axes[1]=-0.5;await feed();
    await until(()=>robot.sim.gamepads[1]?.id===1&&robot.sim.gamepads[1]?.left_stick_y===-0.5,5000,model+' built-in axes as logical User 1');
    assert.ok(!robot.sim.gamepads[2]||robot.sim.gamepads[2].id===-2,'one-controller robot forwarded User 2');
    assert.equal((await L.eval('window.deck.controllers()'))[0].index,2);
    assert.equal(await L.eval('document.querySelector("#controller-2").hidden'),false);
    assert.equal(await D.eval('document.querySelector("#pad-2").hidden'),false);
    await L.eval('window.deck.save({...state.robot,controllerCount:2})');await feed();
    await until(()=>robot.sim.gamepads[2]?.id===2&&robot.sim.gamepads[2]?.left_stick_y===0.25,5000,'two-controller robot enabled User 2');
    assert.equal(await L.eval('document.querySelector("#controller-2").hidden'),false);
    await L.eval('document.querySelector("#controller-1").click()');
    await until(()=>L.eval('document.querySelector("#controller-dialog").open'),3000,'assignment prompt');
    await L.eval('document.querySelector("#controller-assign").click()');
    pads[0]=make(pads[0].id,0);pads[2]=make(controllerName,2);await feed();
    pads[0]=make(pads[0].id,0,0,true);await feed();
    await until(()=>L.eval('window.deck.controllerInfo().then(s=>!s.capture&&s.slots[0].index===0)'),3000,'assignment accepted');
    assert.equal(await L.eval('document.querySelector("#controller-dialog").open'),true);await L.eval('document.querySelector("#controller-done").click()');
    await until(()=>robot.sim.gamepads[1]?.left_stick_y===0&&!robot.sim.gamepads[1]?.a,5000,'assignment press suppressed');
    assert.deepEqual((await L.eval('window.deck.controllers()')).map(p=>p.index),[0,2]);
    pads[0]=make(pads[0].id,0);await feed();pads[0].axes[1]=0.25;pads[2].axes[1]=-0.5;await feed();
    await until(()=>robot.sim.gamepads[1]?.left_stick_y===0.25&&robot.sim.gamepads[2]?.left_stick_y===-0.5,5000,'swapped logical Users 1 and 2');
    pads[0]=null;pads[2]=null;await feed();await until(()=>robot.sim.gamepads[1]?.id===-2&&robot.sim.gamepads[2]?.id===-2,5000,'both users disconnected');
    pads[3]=make('Xbox Wireless Controller',3,0.75);pads[4]=make(controllerName,4,-0.75);await feed();
    await until(()=>robot.sim.gamepads[1]?.left_stick_y===0.75&&robot.sim.gamepads[2]?.left_stick_y===-0.75,5000,'manual slots restored after reconnect');
    assert.deepEqual((await L.eval('window.deck.controllers()')).map(p=>p.index),[3,4]);
    console.log('PASS:',model,'default User 1, optional User 2, click/press swapping, neutral assignment press, actual UDP axes, and reconnect.');
    if(process.env.DECK_TEST_CONTROLLERS_ONLY==='1')return;
    pads.length=0;await feed();
    console.log('launcher state:',JSON.stringify(await L.eval('({kind:state.kind,title:state.title,url:state.url,robot:state.robot?.kind})')));
    console.log('DS:',await D.eval(`[...document.querySelectorAll('#ds-name,#link-text,#network,#ping,#volts,#volts-min,#config,#ds-battery-text')].map(e=>e.textContent).join(' | ')`));
    await D.eval(`document.querySelector('#teleop-list').click();[...document.querySelectorAll('#picker-list button')].find(b=>b.textContent.startsWith('Field Centric')).click();`);await wait(200);await D.eval(`document.querySelector('#main-action').click()`);
    await until(()=>robot.sim.opState==='init',5000,'robot init');
    await D.eval(`document.querySelector('#main-action').click()`);await until(()=>robot.sim.opState==='running',5000,'robot running');
    await wait(500);if(process.env.DECK_FTC_SCREENSHOTS==='1'){await D.shot(path.join(out,'ds-running.png'));await L.shot(path.join(out,'launcher-running.png'));}
    // Settings keeps the robot connected and running; Drive shows it again.
    await L.eval(`document.querySelector('#menu-settings').click()`);await wait(2600);
    if(robot.sim.opState!=='running'||!robot.sim.peer)throw Error('Settings disconnected or stopped the robot');
    console.log('after settings 2.6s: sim',robot.sim.opState,'peer',robot.sim.peer,'| launcher url',await L.eval('state.url'),'| DS active input',await D.eval('document.querySelector("#link-text").textContent'));
    await L.eval(`document.querySelector('#drive-tab').click()`);await wait(300);
    const hb=robot.sim.heartbeats;await wait(1000);const rate=robot.sim.heartbeats-hb;console.log('heartbeats/s while shown:',rate);if(rate<6)throw Error('heartbeat rate too low');
    // The station's bar replaces the browser toolbar and footer, follows the app's theme and drives fullscreen.
    assert.equal(await L.eval(`getComputedStyle(document.querySelector('.browser-toolbar')).display`),'none');assert.equal(await L.eval(`getComputedStyle(document.querySelector('#drive-view footer')).display`),'none');
    await L.eval(`document.querySelector('[data-theme-choice=light]').click()`);await until(()=>D.eval(`document.documentElement.dataset.theme==='light'`),3000,'station follows the light theme');
    await L.eval(`document.querySelector('[data-theme-choice=system]').click()`);await until(()=>D.eval(`!document.documentElement.dataset.theme`),3000,'station follows the system theme');
    await D.eval(`document.querySelector('#ds-fullscreen').click()`);await until(()=>D.eval(`document.body.classList.contains('fullscreen')`),3000,'station fullscreen');
    await L.eval('window.deck.robotFullscreen(false)');await until(()=>D.eval(`!document.body.classList.contains('fullscreen')`),3000,'station leaves fullscreen');
    // Close robot: STOP is sent before the socket closes.
    await L.eval(`document.querySelector('#close-page').click()`);await until(()=>robot.sim.opState==='stopped',3000,'stop on close');console.log('close sent stop: sim',robot.sim.opState,robot.sim.opMode);
    const saved=JSON.parse(fs.readFileSync(path.join(data,'robots.json'),'utf8')).robots;console.log('saved:',JSON.stringify(saved.map(r=>({name:r.name,url:r.url,kind:r.kind}))));
    // Reopen from the library: no probe needed, straight to the station.
    await L.eval(`window.deck.open({id:${JSON.stringify(saved[0].id)}})`);await until(async()=>(await targets()).some(t=>t.url.includes('ui/ftc/index.html')),5000,'reopen');
    // A robot saved as FTC opens by itself on its Wi-Fi, but not again after the driver closes it.
    const ssid=await L.eval('wifi.ssid||""');
    if(ssid){
      await L.eval(`document.querySelector('#close-page').click()`);await wait(6500);if((await targets()).some(t=>t.url.includes('ui/ftc/index.html')))throw Error('closed FTC robot reopened by itself');
      app.kill();await wait(1500);app=launch();
      await until(async()=>(await targets()).some(t=>t.url.includes('ui/ftc/index.html')),15000,'automatic open of saved FTC robot');console.log('saved FTC robot opened automatically on',ssid);
    }else console.log('No Wi-Fi network: automatic open not checked');
    console.log('PASS');
  }catch(e){console.error('FAIL',e.message);process.exitCode=1;}
  finally{app.kill();await robot.close();}
})();
