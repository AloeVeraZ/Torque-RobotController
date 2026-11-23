'use strict';
// The look, measured. Every screen of the real app, light and dark, is checked for the marks that make an interface read
// as machine-made: capsules, boxes inside boxes, tiny capitals, glows, blur, a coloured stripe down a card's side, arrows
// on buttons, code type on plain words, a type face or weight outside the two families (a font's own sample in Settings → Text
// aside), and text too faint to read.
// The rules these stand for are at the top of ui/tokens.css.
// The Driver Station is driven by a robot kept in memory, so this needs no loopback address and runs on any system.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/design-audit.cjs [screen-name-pattern]
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/design-audit');fs.mkdirSync(out,{recursive:true});
const only=process.argv[2]?new RegExp(process.argv[2],'i'):null;

// In the page: what on this screen (or in the open dialog) breaks a rule. Each entry names the element.
function probe(){
  const scope=document.querySelector('dialog[open]')||document.body,found={};
  const add=(rule,what)=>{(found[rule]||=new Set()).add(what);};
  const seen=e=>{if(!e.getClientRects().length)return false;const cs=getComputedStyle(e);if(cs.visibility==='hidden'||+cs.opacity===0)return false;const r=e.getBoundingClientRect();return r.width>=2&&r.height>=2&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;};
  const name=e=>(e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(e.classList.length?'.'+[...e.classList].slice(0,3).join('.'):'')).slice(0,70);
  const ink=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
  const colour=s=>{const m=/rgba?\(([^)]+)\)/.exec(s||'');if(m){const p=m[1].split(/[ ,/]+/).filter(Boolean).map(Number);return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};}ink.clearRect(0,0,1,1);ink.fillStyle='#000';ink.fillStyle=s;ink.fillRect(0,0,1,1);const d=ink.getImageData(0,0,1,1).data;return {r:d[0],g:d[1],b:d[2],a:d[3]/255};};
  const over=(top,under)=>({r:top.r*top.a+under.r*(1-top.a),g:top.g*top.a+under.g*(1-top.a),b:top.b*top.a+under.b*(1-top.a),a:1});
  const ground=e=>{const chain=[];for(let a=e;a;a=a.parentElement){const c=colour(getComputedStyle(a).backgroundColor);if(c.a>0){chain.push(c);if(c.a>=1)break;}}let base=colour(getComputedStyle(document.documentElement).backgroundColor);if(!base.a)base={r:255,g:255,b:255,a:1};for(let i=chain.length-1;i>=0;i--)base=over(chain[i],base);return base;};
  const lum=c=>{const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;};return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b);};
  const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const same=(a,b)=>Math.abs(a.r-b.r)+Math.abs(a.g-b.g)+Math.abs(a.b-b.b)<6;
  // What may be round or long and round: a switch, a slider, and the Driver Station's one big action.
  const ROUND='.switch,.switch *,[role=switch],[role=switch] *,.axon-toggle,.axon-toggle *,.cal-switch,.cal-switch *,input[type=range],.num-slider,progress,meter,.go,.abort,.round-play';
  // What floats may cast a shadow and sits over the page, so it is not "a box inside a box".
  const FLOATS='dialog,.menu,.menu-sub,.wifi-popover,[popover],.touch-keyboard,#toast,.sim-setup-list,.sim-setup-menu,.sim-popover,.sim-help-pop,.sim-path-tooltip,.sim-minimap,.ce-menu,.ce-tip,.picker,.sheet,.dev-menu';
  const boxed=new Set(),all=[...scope.querySelectorAll('*')].filter(e=>!(e instanceof SVGElement)&&!e.closest('.touch-keyboard')&&seen(e));
  for(const e of all){
    const cs=getComputedStyle(e),r=e.getBoundingClientRect();
    const side=s=>parseFloat(cs['border'+s+'Width'])*(cs['border'+s+'Style']!=='none'&&colour(cs['border'+s+'Color']).a>.05?1:0),bw=['Top','Right','Bottom','Left'].map(side);
    const bordered=bw.every(w=>w>0),bg=colour(cs.backgroundColor),under=e.parentElement?ground(e.parentElement):null,filled=bg.a>.04&&under&&!same(over(bg,under),under),rad=parseFloat(cs.borderTopLeftRadius)||0;
    const control=/^(BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|A|KBD|CODE|PRE|PROGRESS|METER|LABEL|CANVAS|IMG|VIDEO)$/.test(e.tagName)||e.getAttribute('role')==='button';
    if((bordered||filled)&&r.width>60&&r.height>28&&!control&&e.children.length>0&&!e.matches(FLOATS))boxed.add(e);
    if((bordered||filled)&&rad>=Math.min(r.height,r.width)/2-.5&&r.width>r.height*1.35&&r.height>=16&&!e.matches(ROUND))add('capsule',name(e));
    if(cs.boxShadow!=='none'&&!/^rgba?\([^)]*\) 0px 0px 0px/.test(cs.boxShadow)&&!/inset/.test(cs.boxShadow)&&cs.position!=='fixed'&&!e.closest(FLOATS)&&!e.matches(ROUND))add('shadow on something that does not float',name(e));
    if(cs.backdropFilter&&cs.backdropFilter!=='none')add('blur',name(e));
    if(/gradient/.test(cs.backgroundImage)&&!e.matches(ROUND+',canvas,select')&&!e.closest('.studio-timeline,.sim-report-bar')&&r.width>24)add('gradient as decoration',name(e));
    if(bw[3]>=3&&bw[0]<2&&bw[2]<2&&r.height>20)add('stripe down one side',name(e));
    const own=[...e.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim().length>1).map(n=>n.textContent.trim()).join(' ');if(!own)continue;
    const size=parseFloat(cs.fontSize),family=cs.fontFamily.split(',')[0].replace(/["']/g,'').trim(),letters=own.replace(/[^A-Za-z]/g,''),code=/mono|menlo|consolas|courier/i.test(family);
    if(!/^(Inter|Barlow Condensed)$/.test(family)&&!code&&!e.matches('.font-sample'))add('type face',name(e)+' '+family);
    if(!code&&!(family==='Barlow Condensed'?['700']:['400','500','600']).includes(cs.fontWeight))add('type weight',name(e)+' '+family+' '+cs.fontWeight);
    if(letters.length>=3&&size<=12.5&&(cs.textTransform==='uppercase'||(letters===letters.toUpperCase()&&parseFloat(cs.letterSpacing)>.3)))add('small capitals',name(e)+' “'+own.slice(0,24)+'”');
    if(code&&!e.closest('pre,code,kbd,samp,textarea,.lines,.sim-log,.cal-java,.sim-program-preview')&&!/^[\d\s.,:+\-−%°/xX#]+$/.test(own))add('code type on plain words',name(e)+' “'+own.slice(0,24)+'”');
    if(e.matches('button,a,summary,[role=button]')&&/[→←↗↘➜▸►]/.test(own))add('arrow on a button',name(e)+' “'+own.slice(0,28)+'”');
    if(!e.closest('[disabled],:disabled,[aria-disabled=true],[inert]')){const on=ground(e),c=contrast(over(colour(cs.color),on),on),need=size>=18.66||(size>=14&&+cs.fontWeight>=700)?3:4.5;if(c<need-.05)add('faint text',name(e)+' '+c.toFixed(2)+' “'+own.slice(0,24)+'”');}
  }
  for(const e of boxed)for(let a=e.parentElement;a&&a!==scope;a=a.parentElement)if(boxed.has(a)){add('box inside a box',name(e)+' in '+name(a));break;}
  return Object.fromEntries(Object.entries(found).map(([k,v])=>[k,[...v]]));
}

(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-design-audit-')),env={...process.env,DECK_HEADLESS:'1',DECK_CONTROLLER_TEST:'1',DECK_DATA_DIR:data,ADB:process.platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','System32','where.exe'):'/bin/false'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root,...(env.DECK_ELECTRON_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[])],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);await page.setViewportSize({width:1280,height:800});
    // A robot in memory in place of one on UDP, and a Wi-Fi that is connected.
    await app.evaluate(({app})=>{const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),{FtcSocket}=req('./src/ftc.cjs'),{SimController}=req('./tools/ftc-sim.cjs'),{Network}=req('./src/network.cjs');
      FtcSocket.prototype.open=async function(){this.address='10.9.9.9';const self=this;this.sim=new SimController({send:b=>{for(const fn of self.listeners)fn(new Uint8Array(b));}}).start();this.socket={close(cb){cb&&cb();}};return this;};
      FtcSocket.prototype.send=function(bytes){try{this.sim?.receive(new Uint8Array(bytes));}catch{}};FtcSocket.prototype.close=async function(){this.sim?.stop();this.sim=null;this.socket=null;this.listeners.clear();};
      Network.prototype.status=async()=>({connected:true,available:true,native:true,ssid:'9999-C-RC'});Network.prototype.scan=async()=>[{ssid:'9999-C-RC',security:'WPA2'},{ssid:'Robotics Lab',security:'WPA2'}];});
    await page.evaluate(()=>window.deck.network());for(const r of [{name:'Practice bot',url:'192.168.43.1',kind:'ftc'},{name:'MotionModule',url:'192.168.4.1'}])await page.evaluate(x=>window.deck.save(x),r);
    const go=async p=>{await page.evaluate(x=>window.deck.page(x),p);await page.waitForFunction(x=>state.page===x,p);},click=s=>page.locator(s).first().click(),simTab=t=>page.evaluate(x=>document.querySelector(`.sim-tabs [data-tab=${x}]`).click(),t);
    const shut=()=>page.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();setMenu(false);closeWifiPicker();});let loaded=false;
    const screens=[
      ['Drive',()=>go('drive')],['Drive menu',async()=>{await go('drive');await click('#more');await page.hover('#menu-shortcuts');},shut],['Wi-Fi list',async()=>{await go('drive');await click('#network-chip');await page.waitForTimeout(400);},shut],['Keyboard shortcuts',async()=>{await click('#more');await click('#menu-shortcuts');},shut],['Licenses and credits',async()=>{await click('#more');await click('#menu-credits');},shut],
      ['Settings',()=>go('settings')],['Controller test',async()=>{await go('settings');await click('#controller-1');},shut],['Controller calibration',async()=>{await go('settings');await click('#controller-1');await click('#controller-calibration-tab');},shut],
      ['Updates',async()=>{await click('#more');await click('#menu-updates');await page.waitForTimeout(500);},shut],['Report a bug',async()=>{await click('#bug-quick');await page.waitForTimeout(300);},shut],
      ['Setup → Robot',async()=>{await go('setup');await click('#sim-setup-step-robot');}],['Setup → Mechanisms',()=>click('#sim-setup-step-mechanisms')],['Setup → Hubs',()=>click('#setup-view .setup-flow [data-flow=setup]')],['Setup → Configure',()=>click('#setup-view .setup-flow [data-flow=configure]')],
      ['Calibrate → Electronics',async()=>{await go('calibrate');await click('#cal-tab-electronics');}],['Calibrate → Mechanisms',()=>click('#cal-tab-mechanisms')],['Calibrate → Camera',()=>click('#cal-tab-camera')],['Calibrate → TeleOp',()=>click('#cal-tab-teleop')],['Calibrate → Autonomous',()=>click('#cal-tab-auto')],['Calibrate → Debug',()=>click('#cal-tab-debug')],
      ['Calibrate → Axon Programmer',()=>click('#calibrate-view .cal-flow [data-flow=axon]')],['Calibrate → SWYFT Programmer',()=>click('#calibrate-view .cal-flow [data-flow=swyft]')],['Calibrate → Servo Test',()=>click('#calibrate-view .cal-flow [data-flow=servotest]')],
      // The first visit waits for Simulate to load its field and robot.
      ['Simulate → Field',async()=>{await go('simulation');if(!loaded){await page.waitForFunction(()=>document.querySelector('#sim-telemetry')?.children.length>0,null,{timeout:120000});loaded=true;}await simTab('field');}],['Simulate → Path planning',()=>simTab('plan')],['Simulate → Run & review',()=>simTab('run')],
      ['Simulate → Video editor',async()=>{await page.waitForFunction(()=>document.querySelector('#sim-tab-video')?.dataset.state==='done',null,{timeout:120000}).catch(()=>{});await simTab('video');await page.waitForTimeout(400);if(await page.locator('#sim-video-run[open]').count())await page.click('#sim-video-run button[value=no]');}],
    ];
    const problems=[],report={};let cases=0;
    const look=async(label,target)=>{for(const theme of ['light','dark']){for(const p of new Set([page,target]))await p.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);
      // What opens does so on a short ease; measure it settled. A window that is not being drawn never advances an animation.
      await target.evaluate(()=>{for(const a of document.getAnimations())if(a.effect?.getComputedTiming().iterations!==Infinity){try{a.finish();}catch{}}});await target.waitForTimeout(120);
      const found=await target.evaluate(probe);cases++;report[theme+' / '+label]=found;for(const [rule,list] of Object.entries(found))for(const what of list)problems.push(`${theme} / ${label}: ${rule}: ${what}`);}};
    for(const [label,open,after] of screens){if(only&&!only.test(label))continue;await open();await page.waitForTimeout(700);await look(label,page);if(after)await after();}
    // The Driver Station is its own page inside the window.
    if(!only||only.test('Driver Station')){
      await go('drive');await page.evaluate(()=>window.deck.open({url:'10.9.9.9',name:'Practice bot',kind:'ftc'}));await page.waitForFunction(()=>state.kind==='ftc'&&!state.loading);
      const station=app.context().pages().find(p=>p.url().includes('ui/ftc/index.html'));assert.ok(station,'the Driver Station opened');station.on('pageerror',e=>errors.push('Driver Station: '+e.message));
      await station.waitForFunction(()=>document.querySelector('#link-text').textContent==='Robot Connected');await look('Driver Station, connected',station);
      await station.locator('#teleop-list').click();await station.waitForTimeout(300);await look('Driver Station, picking an op mode',station);await station.locator('#picker-list button').filter({hasText:'Field Centric'}).click();
      await station.locator('#main-action').click();await station.waitForFunction(()=>document.body.dataset.robotState==='init');await look('Driver Station, INIT',station);
      await station.locator('#main-action').click();await station.waitForFunction(()=>document.body.dataset.robotState==='running');await station.waitForTimeout(500);await look('Driver Station, running',station);
      await station.locator('#main-action').click();await station.waitForFunction(()=>document.body.dataset.robotState==='stopped');
      await station.locator('#ds-more').click();await station.waitForTimeout(250);await look('Driver Station menu',station);await station.keyboard.press('Escape');
    }
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({cases,problems:problems.length,report},null,1));
    assert.deepEqual(errors,[]);assert.deepEqual(problems,[],'every screen keeps the design rules in ui/tokens.css');
    console.log(`Design audit: ${cases} screens and themes, all passed`);
  }finally{await app.close().catch(()=>{});fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,6000));process.exit(1);});
