(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DeckUsbDevices=api;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // What is on the Control Hub's USB ports, in two places. Calibrate → Electronics: port by port, what each one is, what it does, the rule and what to do; cameras and Limelights have their picture in the Camera tab, and a way there.
  // Debug: the same devices with what each is doing now.
  // What each thing is comes from DeckUsbKinds (research_notes/Control Hub USB devices/usb-rules.md section 4). This only draws it, and runs the checks that need nothing on the hub.
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const PORTS=[['usb3','Blue USB 3.0 port'],['usb2','USB 2.0 port'],['usbc','USB-C port'],['unknown','Another USB port']];
  const times=n=>n===1?'1 time':`${n} times`;
  // recentDrops' answer, counted. unplugged: it left. failed: it would not start. wifi: the hub's own Wi-Fi chip left.
  function dropCounts(drops){const byPath={};let wifi=0;for(const d of drops||[]){if(d.wifi){if(d.kind==='disconnect')wifi++;continue;}const e=byPath[d.path]??={unplugged:0,failed:0};if(d.kind==='disconnect')e.unplugged++;else e.failed++;}return {byPath,wifi};}
  // A row's device hangs under the nearest splitter above it: "1-1.2.3" under "1-1.2" under "1-1". A USB 3 splitter has both its names in paths.
  function layout(rows){const shown=(rows||[]).filter(r=>!r.hidden),byPath=new Map(),nodes=new Map(shown.map(r=>[r,{row:r,children:[]}])),ports={};
    for(const r of shown)for(const p of r.device?.paths||[r.device?.path])byPath.set(p,r);
    for(const r of shown){let up=String(r.device?.path||''),parent=null;for(let at;(at=up.lastIndexOf('.'))>=0&&!parent;){up=up.slice(0,at);const hit=byPath.get(up);if(hit&&hit!==r)parent=hit;}
      if(parent)nodes.get(parent).children.push(nodes.get(r));else(ports[r.port]??=[]).push(nodes.get(r));}
    return ports;}
  const inCameraTab=r=>r.config==='webcam'||r.config==='limelight';
  // These are Torque's readings of the manual, not rulings (docs/USB-DEVICES.md). R707 is a list of what may connect by USB, so what its text supports is that a device is not on it. A row that
  // rests on an ID remembered rather than checked may be something else, so it does not say for sure.
  const onR707=legal=>/\bR707\b/.test(String(legal?.rule||'')),hedged=legal=>legal?.sure===false||!!legal?.chip;
  const chipWords=legal=>legal.chip||(legal.ok?'Allowed':legal.sure===false?'Probably not allowed':onR707(legal)?'Not on the manual’s USB list':'Not allowed on the robot');
  function chip(legal,pending){if(pending||legal?.ok===null||legal?.ok===undefined)return '<span class="rs-pill">Checking</span>';return `<span class="rs-pill ${legal.ok?'ok':hedged(legal)?'warn':'bad'}">${esc(chipWords(legal))}: ${esc(legal.rule)}</span>`;}
  // Whether something may stay on the robot away from inspection is not in the manual's text, so this says what the text does say, and does not tell anyone to take it off.
  const listLine=row=>row.legal?.ok===false&&!row.pending&&!row.legal.chip&&onR707(row.legal)?`${row.legal.sure===false?'If so, the':'The'} manual’s R707 list of what may connect by USB does not include it. Ask your inspector if you are not sure.`:'';
  // What the student has to do themselves: numbered.
  function steps(row){return String(row.explain||'').split(/(?<=\.)\s+/).filter(Boolean);}
  // What Torque can find out by itself, for the checks in this device's row. drops: recentDrops' answer, undefined until read, null if it cannot be read.
  function checks(row,children,drops){const d=row.device||{},out=[],add=(code,state,text)=>out.push({code,state,text}),c=drops?dropCounts(drops).byPath[d.path]||{unplugged:0,failed:0}:null,dropped=c&&(c.unplugged||c.failed)?[c.unplugged?`Came unplugged ${times(c.unplugged)} since the hub started.`:'',c.failed?`Would not start ${times(c.failed)} since the hub started.`:'','If you did not unplug it, check its plug.'].filter(Boolean).join(' '):'';
    // Any device that has dropped says so, whether or not it is worth asking about the rest of the time.
    if(dropped&&!row.checks?.includes('DROPS'))add('DROPS','warn',dropped);
    for(const code of row.checks||[]){
      if(code==='PORT'&&row.port==='usb3')add(code,'ok','On the blue USB 3.0 port.');
      else if(code==='DROPS'){if(drops===undefined)add(code,'na','Reading how often it has come unplugged…');else if(!drops)add(code,'na','Torque cannot read how often it has come unplugged yet.');else add(code,dropped?'warn':'ok',dropped||'Has not come unplugged since the hub started.');}
      else if(code==='SCAN')add(code,row.portal?'ok':'warn',row.portal?'The robot’s own Scan found it.':'The robot’s own Scan did not find it.');
      else if(code==='DISCOVER'){const m=row.portal?.modules||[];add(code,m.length?'ok':'warn',m.length?`It answers at address ${m.map(x=>x.address).join(', ')}.`:'It did not answer as a hub.');}
      else if(code==='HUBTREE')add(code,'ok',`${children.length} of its ${d.maxChild||'?'} ports in use.`);
      else if(code==='POWER'&&row.category==='USB hub'){const self=(d.attributes&0x40)!==0,asks=children.reduce((a,n)=>a+(n.row.device?.maxPower||0),0);add(code,self?'ok':'warn',`It says it has ${self?'its own power':'no power of its own'}.${asks?` What is plugged into it asks for ${asks} mA.`:''} No limit for a USB port is published, and cameras that draw more, such as a C920, may want a powered splitter.`);}
    }
    return out;}
  // Student-readable first; this holds the rest.
  function facts(row){const d=row.device||{},line=(k,v)=>v===undefined||v===null||v===''?'':`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`,ifaces=(d.interfaces||[]).map(i=>`${i.class}/${i.sub}/${i.proto}${i.driver?` ${i.driver}`:''}`).join(', '),drivers=[...new Set((d.interfaces||[]).map(i=>i.driver).filter(Boolean))].join(', ');
    return `<details class="usb-facts" data-usb-facts="${esc(d.path)}"><summary>Technical facts</summary><dl class="cal-cam-facts">${line('Maker',d.maker)}${line('Product',d.product)}${line('IDs',row.usbId)}${line('Serial',d.serial)}${line('Speed',d.speed?`${d.speed} Mb/s`:'')}${line('Asks for',d.maxPower?`${d.maxPower} mA`:'')}${line('Driver',drivers)}${line('Interfaces',ifaces)}${line('Where',(d.paths||[d.path]).join(', '))}${line('Torque’s row',row.id)}</dl></details>`;}
  const checkList=list=>list.length?`<ul class="usb-checks">${list.map(c=>`<li data-check="${c.code}" data-state="${c.state}">${esc(c.text)}</li>`).join('')}</ul>`:'';
  const cameraWord=row=>row.config==='limelight'?'Limelight':`Webcam · ${row.device?.product||K().cameraLabel(row.scanKey)}`;
  function elsewhere(row){return `<article class="usb-card usb-elsewhere" data-usb-elsewhere="${esc(row.scanKey)}"><div class="usb-card-head"><b>${esc(cameraWord(row))}</b>${chip(row.legal,row.pending)}</div>${row.can?`<p>${esc(row.can)}</p>`:''}<div class="usb-card-end"><span class="hint">Its picture and settings are in Camera.</span><button type="button" class="secondary" data-usb-to-camera="${esc(row.scanKey)}">Go to Camera</button></div></article>`;}
  // Where a device with no use on USB does work.
  const routeHtml=row=>{const r=row.route;if(!r)return '';const go=r.tag?`<button type="button" class="secondary" data-usb-i2c="${esc(r.tag)}" aria-label="Set up a ${esc(r.label)} on an I2C port">Set up on I2C</button>`:r.tab==='axon'?'<button type="button" class="secondary" data-usb-axon>Open Axon Programmer</button>':'';return `<div class="usb-card-end" data-usb-route><span>${esc(r.text)}</span>${go}</div>`;};
  function nodeHtml(node,drops){const {row,children}=node;if(inCameraTab(row))return elsewhere(row);const did=row.route?[]:steps(row),warn=(row.warnings||[]);
    return `<article class="usb-card" data-usb-device="${esc(row.device?.path)}" data-row="${esc(row.id)}"><div class="usb-card-head"><b>${esc(row.name)}</b>${chip(row.legal,row.pending)}</div>
      ${row.can?`<p>${esc(row.can)}</p>`:''}${routeHtml(row)}${row.sure===false&&!row.pending?'<p class="hint">Torque knows this from an ID it has not checked with the maker, so it may be something else. If it is what Torque thinks:</p>':''}${row.legal?.text&&!row.pending&&!row.route?`<p class="hint">${esc(row.legal.text)}</p>`:''}${listLine(row)?`<p class="hint" data-usb-list>${esc(listLine(row))}</p>`:''}
      ${warn.map(w=>`<p class="cal-debug-warn" data-warn="${esc(w.code)}">${esc(w.text)}</p>`).join('')}${checkList(checks(row,children,drops))}
      ${did.length>1?`<ol class="cal-steps">${did.map(t=>`<li>${esc(t)}</li>`).join('')}</ol>`:did.length?`<p>${esc(did[0])}</p>`:''}${facts(row)}
      ${children.length?`<div class="usb-behind"><h4 class="cal-group-title">Plugged into this splitter</h4>${children.map(n=>nodeHtml(n,drops)).join('')}</div>`:''}</article>`;}
  // Everything shown, from what the hub has said. usb: what hubUsb() answers, null with no hub connected, its devices undefined until Torque has read the ports.
  function html(usb,drops){const head='<h2 id="cal-usb-title">USB devices</h2>',rows=usb?.devices;
    if(!usb)return `${head}<p class="hint" data-usb-state="no-hub">No Control Hub connected. Plug one in by USB-C with the robot on, and what is on its USB ports shows here by itself.</p>`;
    if(!rows)return `${head}<p class="hint" data-usb-state="unread">Torque has not read the Control Hub’s USB ports yet. It reads them over the USB-C cable.</p>`;
    const ports=layout(rows),known=new Set(rows.flatMap(r=>r.device?.paths||[r.device?.path])),counts=dropCounts(drops||[]),gone=port=>Object.entries(counts.byPath).filter(([p])=>!known.has(p)&&K().portOf(p)===port).reduce((a,[,c])=>a+c.unplugged,0),any=Object.values(ports).some(l=>l.length);
    const wifi=counts.wifi?`<p class="cal-debug-warn" data-usb-wifi>The hub’s own Wi-Fi chip dropped off USB ${times(counts.wifi)} since the hub started. That may mean a static shock.</p>`:'';
    const empty={usb3:'Nothing plugged in. This is the port to use for a camera, a Limelight or a splitter.',usb2:'Nothing plugged in. Good: FIRST says to use the blue port instead.'};
    return `${head}<p class="hint">What is plugged into the Control Hub’s two USB ports, with what each thing is and what to do with it.</p>${usb.stuck?`<p class="hint" data-usb-stuck role="status">${esc(usb.stuck)}</p>`:''}${any?'':'<p class="hint" data-usb-state="empty">Nothing is plugged into either port. If you did plug something in, try another cable: a charge-only cable shows nothing.</p>'}${wifi}
      ${PORTS.map(([port,name])=>{const list=ports[port]||[],left=gone(port);if(!list.length&&!left&&!empty[port])return '';return `<section class="usb-port" data-usb-port="${port}"><h3 class="cal-group-title">${esc(name)}</h3>${list.map(n=>nodeHtml(n,drops)).join('')||(empty[port]?`<p class="hint">${esc(empty[port])}</p>`:'')}${left?`<p class="hint" data-usb-gone>Something that is not here now came unplugged from this port ${times(left)} since the hub started.</p>`:''}</section>`;}).join('')}`;}
  const K=()=>globalThis.DeckUsbKinds||require('./ftc/usb-kinds.js');
  // usb: hubUsb. toCamera(scanKey): to the Camera tab, on that device.
  function create({host,api,native,usb,toCamera,toI2c,toAxon}){let drops,dropsAt=0,dropsKey=null,now=null,reading=false;const shown=()=>!!host.offsetParent;
    function paint(){const out=html(usb(),drops);if(out===now)return;const open=[...host.querySelectorAll('details[open]')].map(d=>d.dataset.usbFacts);now=out;host.innerHTML=out;for(const p of open)host.querySelector(`details[data-usb-facts="${CSS.escape(p||'')}"]`)?.setAttribute('open','');}
    // Only while this tab shows, when what is plugged in changed, and now and then for what left and came back between looks.
    async function readDrops(){const rows=usb()?.devices;if(!rows||!native||!api?.robotLink||reading)return;const key=JSON.stringify(rows.map(r=>[r.device?.path,r.device?.dev]));if(key===dropsKey&&Date.now()-dropsAt<30000)return;reading=true;dropsKey=key;dropsAt=Date.now();try{drops=await api.robotLink('hub-usb-drops');}catch{drops=null;}finally{reading=false;}paint();}
    function tick(){if(!shown())return;paint();void readDrops();}
    host.addEventListener('click',e=>{const b=e.target.closest('[data-usb-to-camera]');if(b)return toCamera?.(b.dataset.usbToCamera);const i=e.target.closest('[data-usb-i2c]');if(i)return toI2c?.(i.dataset.usbI2c);if(e.target.closest('[data-usb-axon]'))toAxon?.();});
    paint();const timer=setInterval(tick,1000);
    return {refresh:tick,stop(){clearInterval(timer);}};}
  // ---- Debug: what is plugged in, and what each is doing now. live: {running, manifest (what Torque Debug opened), cam (its camera's last word), lime (a Limelight's status, null if it did not answer, undefined until asked), configured (the configuration's devices on no hub)}.
  const pill=(level,text)=>`<span class="rs-pill ${level}">${esc(text)}</span>`;
  function webcamLive(key,{running,manifest,cam,configured=[]}){const c=configured.find(d=>d.tag==='Webcam'&&K().sameCamera(d.serial,key));if(!c)return {result:pill('warn','Not in the configuration'),add:true};
    if(!running)return {result:pill('','Start live debug to read it')};const open=manifest?.cameras||[];if(!manifest)return {result:pill('','Starting…')};
    // One is open at a time: it says which, and one from before it could has its first open. Calibrate → Camera can open another.
    if((cam?.open??open[0])===c.name){if(cam?.error)return {result:pill('bad',`Did not start: ${cam.error}`)};if(cam?.state==='STREAMING')return {result:pill('ok',`Streaming${Number.isFinite(cam.fps)?` · ${cam.fps.toFixed(0)} frames a second`:''}`)};return {result:pill('',cam?.state?`Camera ${String(cam.state).toLowerCase()}`:'Opening the camera…')};}
    return {result:pill('warn',open.includes(c.name)?'Another camera is open. Only one opens at a time':'Live debug did not open it')};}
  function limeLive(lime){if(lime===undefined)return pill('','Asking it how it is…');if(!lime)return pill('warn','Not answering');const n=(v,u)=>Number.isFinite(+v)&&v!==null&&v!==''?`${+(+v).toFixed(1)}${u}`:null;return pill('ok',['Answering',n(lime.temp,' °C'),n(lime.fps,' frames a second'),Number.isFinite(+lime.pipelineIndex)&&lime.pipelineIndex!==null?`pipeline ${lime.pipelineIndex}`:null].filter(Boolean).join(' · '));}
  const liveRow=(attrs,name,sub,result,buttons)=>`<div class="cal-usb-row"${attrs}><div class="cal-usb-text"><b>${esc(name)}</b>${sub?`<small>${esc(sub)}</small>`:''}</div><div class="cal-usb-end">${result}${buttons}</div></div>`;
  const toCameraBtn=key=>`<button type="button" class="secondary" data-usb-to-camera="${esc(key)}">Go to Camera</button>`,addBtn='<button type="button" class="primary" data-usb-auto>Auto-configure</button>';
  function liveHtml(usb,live={}){const head='<h3 class="cal-group-title">USB devices</h3>';if(!usb)return `${head}<p class="hint" data-usb-state="no-hub">No Control Hub connected.</p>`;const rows=usb.devices;
    const camera=(key,name,sub)=>{const w=webcamLive(key,live);return liveRow(` data-usb-live="${esc(key)}"`,name,sub,w.result,`${w.add?addBtn:''}${toCameraBtn(key)}`);};
    // Over Wi-Fi there is only the robot's own Scan to go on.
    if(!rows){const list=(Array.isArray(usb)?usb:[]).filter(d=>d.type==='WEBCAM').map(d=>camera(d.serial,'Webcam',K().cameraLabel(d.serial)));return `${head}${list.join('')||'<p class="hint" data-usb-state="empty">The robot’s Scan found no webcam on its USB ports.</p>'}`;}
    const shown=rows.filter(r=>!r.hidden),line=r=>[r.portName,r.device?.serial].filter(Boolean).join(' · ');
    return `${head}${shown.map(r=>r.config==='webcam'?camera(r.scanKey,r.name,line(r)):r.config==='limelight'?liveRow(` data-usb-live="${esc(r.scanKey)}"`,r.name,line(r),limeLive(live.lime),toCameraBtn(r.scanKey)):liveRow(` data-usb-live="${esc(r.device?.path)}"`,r.name,line(r),chip(r.legal,r.pending),'')).join('')||'<p class="hint" data-usb-state="empty">Nothing is plugged into its USB ports.</p>'}`;}
  // Reads only while Debug shows. debug: DeckLiveDebug's panel.
  function createLive({host,api,native,usb,debug,configured=()=>[],toCamera,auto}){let cam=null,lime,limeAt=0,asking=false,now=null,drawn=0;const shown=()=>!!host.offsetParent;
    function paint(){const running=!!debug?.running?.();if(!running)cam=null;const out=liveHtml(usb(),{running,manifest:debug?.latest?.().manifest||null,cam,lime,configured:configured()});if(out===now)return;now=out;host.innerHTML=out;}
    const hasLime=()=>!!usb()?.devices?.some(r=>r.config==='limelight');
    async function readLime(){if(!native||!api?.robotLink||asking||Date.now()-limeAt<2000)return;asking=true;limeAt=Date.now();try{const r=await api.robotLink('limelight',{});lime=r?.status&&typeof r.status==='object'?r.status:null;}catch{lime=null;}finally{asking=false;}if(shown())paint();}
    function tick(){if(!shown())return;paint();if(hasLime())void readLime();else lime=undefined;}
    const off=debug?.listen?.(f=>{if(!f.cam)return;cam=f.cam;if(shown()&&Date.now()-drawn>250){drawn=Date.now();paint();}});
    host.addEventListener('click',e=>{const b=e.target.closest('[data-usb-to-camera]');if(b)return toCamera?.(b.dataset.usbToCamera);if(e.target.closest('[data-usb-auto]'))auto?.();});
    paint();const timer=setInterval(tick,1000);
    return {refresh:tick,stop(){clearInterval(timer);off?.();}};}
  return {create,createLive,html,liveHtml,layout,checks,steps,dropCounts,chipWords};
});
