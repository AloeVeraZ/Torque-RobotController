'use strict';
// Every screen a student uses fits the window, in the real app: at a laptop's maximized 1280 × 718, the Steam Deck's
// 1280 × 800 and a small 1024 × 600, the page itself never scrolls (what is long scrolls in its own list, pane or column),
// and no button, field or tab is cut off where no scrolling reaches it. Drive is not checked here.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/window-fit-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/window-fit');fs.mkdirSync(out,{recursive:true});
const SIZES=[[1280,718],[1280,800],[1024,600]];

// In the page: how far the page scrolls, and each control cut off where no scrolling reaches it.
function check(){
  const scrolls=v=>v==='auto'||v==='scroll',name=e=>`${e.tagName.toLowerCase()}${e.id?'#'+e.id:''}${e.classList.length?'.'+[...e.classList].slice(0,2).join('.'):''} "${(e.getAttribute('aria-label')||e.textContent||e.value||'').replace(/\s+/g,' ').trim().slice(0,40)}"`;
  const shown=e=>{if(!e.getClientRects().length||e instanceof SVGElement)return false;const cs=getComputedStyle(e);if(cs.visibility==='hidden'||+cs.opacity===0)return false;if(e.closest('[hidden],[inert],#drive-view,details:not([open])>:not(summary),.sr-only,[aria-hidden=true]'))return false;const r=e.getBoundingClientRect();return r.width>=3&&r.height>=3;};
  const cut=[],pageScrolls=document.scrollingElement.scrollHeight>innerHeight+1;
  for(const e of document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,summary,[role=tab]')){if(!shown(e))continue;
    const r=e.getBoundingClientRect();let x0=r.left,y0=r.top,x1=r.right,y1=r.bottom,by=null;
    for(let a=e.parentElement;a&&a!==document.body;a=a.parentElement){const cs=getComputedStyle(a);if(cs.overflowX==='visible'&&cs.overflowY==='visible')continue;
      const b=a.getBoundingClientRect(),ax0=b.left+a.clientLeft,ay0=b.top+a.clientTop,ax1=ax0+a.clientWidth,ay1=ay0+a.clientHeight,outY=y0<ay0-1||y1>ay1+1,outX=x0<ax0-1||x1>ax1+1;
      if(outY&&!scrolls(cs.overflowY)||outX&&!scrolls(cs.overflowX)){by=a;break;}if(outY||outX){by='scrolls';break;}
      x0=Math.max(x0,ax0);y0=Math.max(y0,ay0);x1=Math.min(x1,ax1);y1=Math.min(y1,ay1);}
    if(by==='scrolls')continue;if(!by&&!pageScrolls&&(y1>innerHeight+1||x1>innerWidth+1))by=document.documentElement;if(!by)continue;
    const seen=Math.max(0,Math.min(x1,innerWidth)-Math.max(x0,0))*Math.max(0,Math.min(y1,innerHeight)-Math.max(y0,0))/(r.width*r.height);
    if(seen<.9)cut.push(`${name(e)} ${Math.round(seen*100)}% seen, cut by ${by===document.documentElement?'the window':name(by)}`);}
  return {down:Math.round(document.scrollingElement.scrollHeight-innerHeight),across:Math.round(document.scrollingElement.scrollWidth-innerWidth),cut};}

(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-window-fit-')),env={...process.env,DECK_HEADLESS:'1',DECK_CONTROLLER_TEST:'1',DECK_DATA_DIR:data,ADB:process.platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','System32','where.exe'):'/bin/false'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);
    const go=async p=>{await page.evaluate(x=>window.deck.page(x),p);await page.waitForFunction(x=>state.page===x,p);},click=s=>page.locator(s).first().click(),simTab=t=>page.evaluate(x=>document.querySelector(`.sim-tabs [data-tab=${x}]`).click(),t);
    let loaded=false;const screens=[
      ['Setup → Robot',async()=>{await go('setup');await click('#sim-setup-step-robot');}],
      ['Setup → Mechanisms',()=>click('#sim-setup-step-mechanisms')],
      ['Setup → Hubs',()=>click('#setup-view .setup-flow [data-flow=setup]')],
      ['Setup → Configure',()=>click('#setup-view .setup-flow [data-flow=configure]')],
      ['Calibrate → Electronics',async()=>{await go('calibrate');await click('#cal-tab-electronics');}],
      ['Calibrate → Mechanisms',()=>click('#cal-tab-mechanisms')],
      ['Calibrate → Camera',()=>click('#cal-tab-camera')],
      ['Calibrate → TeleOp',()=>click('#cal-tab-teleop')],
      ['Calibrate → Debug',()=>click('#cal-tab-debug')],
      ['Calibrate → Axon Programmer',()=>click('#calibrate-view .cal-flow [data-flow=axon]')],
      ['Calibrate → SWYFT Programmer',()=>click('#calibrate-view .cal-flow [data-flow=swyft]')],
      ['Calibrate → Servo Test',()=>click('#calibrate-view .cal-flow [data-flow=servotest]')],
      // The first visit waits for Simulate to load its field and robot.
      ['Simulate → Field',async()=>{await go('simulation');if(!loaded){await page.waitForFunction(()=>document.querySelector('#sim-telemetry')?.children.length>0,null,{timeout:120000});loaded=true;}await simTab('field');}],
      ['Simulate → Path planning',()=>simTab('plan')],
      ['Simulate → Run & review',()=>simTab('run')],
      // The Video editor films a finished run: wait for Simulate's own, and say Not now if it still asks for one.
      ['Simulate → Video editor',async()=>{await page.waitForFunction(()=>document.querySelector('#sim-tab-video')?.dataset.state==='done',null,{timeout:120000}).catch(()=>{});await simTab('video');await page.waitForTimeout(400);if(await page.locator('#sim-video-run[open]').count())await page.click('#sim-video-run button[value=no]');}],
      ['Settings',()=>go('settings')],
    ];
    const problems=[];
    for(const [W,H] of SIZES){await page.setViewportSize({width:W,height:H});
      for(const [label,open] of screens){await open();await page.waitForTimeout(700);const r=await page.evaluate(check);
        if(r.down>2)problems.push(`${W}×${H} ${label}: the page scrolls ${r.down}px`);if(r.across>2)problems.push(`${W}×${H} ${label}: the page scrolls ${r.across}px sideways`);
        for(const c of r.cut)problems.push(`${W}×${H} ${label}: ${c}`);
        if(W===1280&&H===718)await page.screenshot({path:path.join(out,`${label.replace(/[^a-z]+/gi,'-').toLowerCase()}.png`)});}}
    assert.deepEqual(problems,[],'every screen fits the window');
    // Settings at a laptop's size: Open robot shows without scrolling anything.
    await page.setViewportSize({width:1280,height:718});await go('settings');const open=await page.locator('#open-robot').boundingBox();assert.ok(open&&open.y>=0&&open.y+open.height<=718,'Open robot is in view');
    // Calibrate keeps the robot bar and its steps where they are while a list scrolls.
    await go('calibrate');await click('#cal-tab-electronics');const bar=async()=>(await page.locator('#calibrate-view .cal-flow').boundingBox()).y,y0=await bar();
    await page.evaluate(()=>{const l=document.querySelector('#cal-links .cal-elec-list');l.scrollTop=l.scrollHeight;document.querySelector('#cal-links [data-elec-pick]:last-of-type')?.scrollIntoView({block:'start'});});assert.equal(await bar(),y0,'the steps stay put');
    assert.deepEqual(errors,[]);console.log('Window fit: all passed');
  }finally{await app.close().catch(()=>{});fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,4000));process.exit(1);});
