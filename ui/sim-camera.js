(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DeckCamera=api;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Calibrate → Camera: a webcam's live view, its AprilTags and its settings. From a robot, Torque Debug runs the SDK's VisionPortal
  // with an AprilTagProcessor and the picture comes as the Driver Station's Camera Stream does. With no camera, the simulated webcam
  // behaves as the FTC docs describe: exposure blurs a moving tag and gain brightens the picture (usable only with manual
  // exposure), and decimation trades range for frame rate (a 2-inch tag: 10 ft at 1, 4 ft at 3). Its numbers are a model, not a measurement.
  // Also the checks on the camera picked, from what the hub reads over ADB (research_notes/Control Hub USB devices/usb-rules.md section 6),
  // a one-tag lens measurement, and a Limelight's status in place of a picture.
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const K=()=>globalThis.DeckUsbKinds||require('./ftc/usb-kinds.js'),U=()=>globalThis.DeckUsbDevices||require('./sim-usb-devices.js');
  const EXPOSURES=[1,2,3,4,5,6,8,10,12,15,20,25,30,40,50,75,100],GAINS=[0,25,50,75,100,125,150,175,200,225,255],DECIMATIONS=[1,2,3],FEET=[1,2,3,4,5,6,8,10,12,15,20],ROTATIONS=[0,90,180,270];
  const DEFAULTS={exposure:'auto',gain:100,decimation:3,rotate:0,feet:4,moving:false},AUTO_MS=33,GOOD=.9,STORE='torque-camera';
  // Torque Debug opens a camera at VisionPortal's default size and has no setting for another. FALLBACK_FX: what the SDK silently assumes with no lens data.
  // SIM_FX: the simulated webcam's own lens, which it reads short with until it is measured.
  const LIVE_SIZE='640x480',FALLBACK_FX=578.272,SIM_FX=822,LENS_MS=3000,MIN_READINGS=3,RATIO=[.5,2],SQUARE_DEG=15,SPREAD=.1;
  function sanitize(s){const one=(list,v,d)=>list.includes(+v)?+v:d;return {exposure:s?.exposure==='auto'||s?.exposure===undefined?'auto':one(EXPOSURES,s.exposure,'auto'),gain:one(GAINS,s?.gain,DEFAULTS.gain),decimation:one(DECIMATIONS,s?.decimation,DEFAULTS.decimation),rotate:one(ROTATIONS,s?.rotate,0),feet:one(FEET,s?.feet,DEFAULTS.feet),moving:s?.moving===true};}
  const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
  // How far a tag of this size can be read: 10 ft for 2 inches at decimation 1, 4 ft at 3.
  const rangeFeet=(inches,decimation)=>10*(inches/2)/decimation**.83;
  const fpsOf=decimation=>({1:10,2:20,3:30}[decimation]||30);
  const exposureOf=s=>s.exposure==='auto'?AUTO_MS:s.exposure,gainOf=s=>s.exposure==='auto'?64:s.gain;
  const tagPixels=feet=>Math.min(320,1100/feet);
  const blurPixels=s=>s.moving?800*exposureOf(s)/1000:0;
  // The share of frames the simulated webcam reads its tag in.
  function simRate(input,inches=4){const s=sanitize(input),light=exposureOf(s)*(1+gainOf(s)/64),cell=tagPixels(s.feet)/8/s.decimation,limit=rangeFeet(inches,s.decimation),blur=blurPixels(s);
    return smooth(12,22,light)*(1-smooth(400,800,light))*(1-smooth(.4*cell,cell,blur))*(1-smooth(.9*limit,1.1*limit,s.feet));}
  // The FTC docs' way: highest gain, then the lowest exposure that reads reliably, so a moving tag blurs least.
  const pick=results=>results.find(r=>r.rate>=GOOD)||null;
  function javaLines({exposure,gain,decimation}){return ['ExposureControl exposure = portal.getCameraControl(ExposureControl.class);','exposure.setMode(ExposureControl.Mode.Manual);',`exposure.setExposure(${exposure}, TimeUnit.MILLISECONDS);`,...(gain===null||gain===undefined?[]:[`portal.getCameraControl(GainControl.class).setGain(${gain});`]),`aprilTag.setDecimation(${decimation});`].join('\n');}
  // A small picture for the simulated hub's Camera Stream: grey, with a dark square that moves and a brightness that follows the settings.
  function simFrame(n=0,bright=.6,w=160,h=120){const size=54+1024+w*h,row=(w+3)&~3,total=54+1024+row*h,b=Buffer.alloc(total);b.write('BM');b.writeUInt32LE(total,2);b.writeUInt32LE(1078,10);b.writeUInt32LE(40,14);b.writeInt32LE(w,18);b.writeInt32LE(h,22);b.writeUInt16LE(1,26);b.writeUInt16LE(8,28);b.writeUInt32LE(256,46);
    for(let i=0;i<256;i++){b[54+i*4]=b[55+i*4]=b[56+i*4]=i;}const x0=50+Math.round(20*Math.sin(n/8));for(let y=0;y<h;y++)for(let x=0;x<w;x++){const tag=x>=x0&&x<x0+60&&y>=30&&y<90,inner=tag&&x>=x0+6&&x<x0+54&&y>=36&&y<84;b[1078+y*row+x]=Math.round(255*bright*(tag?(inner?(((x-x0)>>3^(y-30)>>3)&1?1:.08):.08):.55));}return size&&b;}
  // A camera with no serial has its port in its Scan key only when two are plugged in.
  const sameCamera=(a,b)=>K().sameCamera(a,b);
  const R=()=>globalThis.DeckRobotConfig||require('./ftc/robot-config.js');
  // The cameras to choose from: live (Torque Debug has it open), configured (in the active configuration), spare (on the hub's USB but
  // not in the configuration, which the Robot Controller cannot open), a Limelight, or the simulated webcam when there is no real one.
  // configured: [{name, serial}]. plugged: what is on the hub's USB [{serial, type}], null when no hub has said. limelights: rows of DeckUsbKinds that answered as one.
  // Each configured camera accounts for one thing plugged in: with two alike and one configured with no port, the other can still be added. d.name: what to call it, where Torque has read the hub's ports.
  function choices(live,configured,plugged,limelights){const own=configured||[],on=(plugged||[]).filter(d=>d.type==='WEBCAM'),taken=new Set(),word=d=>d.name||K().cameraLabel(d.serial);for(const c of own){const d=on.find(x=>!taken.has(x)&&sameCamera(c.serial,x.serial));if(d)taken.add(d);}
    const spare=on.filter(d=>!taken.has(d)).map(d=>({value:`usb:${d.serial}`,label:`Webcam · ${word(d)} (not in this configuration)`,state:'spare',serial:d.serial}));
    const first=live?.length?live.map(n=>({value:n,label:n,state:'live'})):own.map(c=>{const here=on.find(d=>sameCamera(d.serial,c.serial)),absent=!!plugged&&!!c.serial&&!here;return {value:c.name,label:`${c.name}${c.serial?` · ${here?word(here):K().cameraLabel(c.serial)}`:''}${absent?' (not plugged in)':''}`,state:'configured',serial:c.serial,absent};});
    const lime=(limelights||[]).map(l=>({value:`limelight:${l.scanKey}`,label:`Limelight · ${l.limelight?.address||l.scanKey}`,state:'limelight',serial:l.scanKey,row:l}));
    const all=[...first,...spare,...lime];return all.length?all:[{value:'sim',label:'Simulated webcam',state:'sim'}];}

  // ---- what a camera's descriptors say, in words. Advertised does not prove a control works.
  // The sizes the SDK can ask for: it offers only YUY2 and MJPEG.
  function modesOf(uvc){const by=new Map();for(const m of uvc?.modes||[]){if(m.format!=='YUY2'&&m.format!=='MJPEG')continue;const size=`${m.width}x${m.height}`,e=by.get(size)||{size,formats:[],fps:0};if(!e.formats.includes(m.format))e.formats.push(m.format);e.fps=Math.max(e.fps,...m.fps);by.set(size,e);}return [...by.values()];}
  // Null when the descriptors say nothing, so nothing can be hidden on their word.
  function controlsOf(uvc){if(!uvc||!(uvc.camera?.length||uvc.processing?.length))return null;return {list:[...uvc.camera,...uvc.processing],exposure:uvc.camera.some(c=>c.startsWith('Exposure time')),gain:uvc.processing.includes('Gain'),whiteBalance:uvc.processing.some(c=>c.startsWith('White balance'))};}
  const listed=a=>a.length<2?a.join(''):`${a.slice(0,-1).join(', ')} and ${a.at(-1)}`;
  // The lens answer for this camera at this size, the SDK's way. A USB ID names the camera's USB chip, not the lens in front of it.
  function lensLine(vid,pid,size,saved){const [w,h]=size.split('x').map(Number),l=K().lensFor(vid,pid,w,h),chip='A camera’s USB ID names its USB chip, not your exact lens.';
    if(saved)return {state:'ok',match:l.match,text:`You measured this camera at ${size}. Your code still needs the numbers: they are under “Measure this lens”.`};
    if(l.match==='exact')return {state:'ok',match:l.match,text:`FTC has lens data for this model at ${size} (${l.model}). ${chip}`};
    if(l.match==='scaled')return {state:'ok',match:l.match,text:`FTC has lens data for this model at ${listed(l.from)} (${l.model}), and scales it to ${size}. ${chip}`};
    const why=`With no lens data the robot software silently assumes a focal length of ${FALLBACK_FX} pixels (fx=${FALLBACK_FX}).`;
    if(l.match==='other')return {state:'warn',match:l.match,text:`Distance will be wrong at ${size}: pick one of these sizes: ${listed(l.sizes)}. ${why}`};
    return {state:'warn',match:l.match,text:`Distance will be wrong until the lens is measured. ${why}`};}
  // The checks on one camera. row: its DeckUsbKinds row. uvc: parseUvc's answer, undefined while it is read, null if it could not be. drops: recentDrops' answer, null if it could not be read.
  function cameraChecks({row,uvc,drops,size=LIVE_SIZE,saved}){const d=row.device||{},out=[],add=(code,state,text)=>out.push({code,state,text}),warned=c=>row.warnings.filter(w=>w.code===c).map(w=>w.text);
    if(row.port==='usb3')add('PORT','ok','On the blue USB 3.0 port.');else if(warned('PORT').length)add('PORT','warn',warned('PORT')[0]);else add('PORT','na','Torque cannot tell which port this is in.');
    if(d.speed===12||d.speed===1.5)add('SPEED','warn',`Connected at ${d.speed} Mb/s. That is probably a bad cable or adapter.`);else if(d.speed)add('SPEED','ok',`Connected at ${d.speed} Mb/s.`);
    const clash=[...warned('SERIAL'),...warned('E2')];if(clash.length)add('SERIAL','warn',`${clash.join(' ')}${row.id==='E2'&&warned('SERIAL').some(t=>/share one serial/.test(t))?' FIRST suggests the Arducam Serial Number Tool.':''}`);
    else add('SERIAL','ok',d.serial&&d.serial!=='200901010001'?`Serial number ${d.serial}.`:'It has no serial number of its own, so the robot finds it by its USB ID.');
    const modes=modesOf(uvc);
    if(uvc===undefined)add('MODES','na','Reading what this camera offers…');else if(!uvc||!modes.length)add('MODES','na','Torque could not read what this camera offers.');
    else{const both=modes.filter(m=>m.formats.includes('YUY2')),only=modes.filter(m=>!m.formats.includes('YUY2')),fps=Math.max(...modes.map(m=>m.fps));
      add('MODES','ok',`${[both.length?`${listed(both.map(m=>m.size))} in YUY2${both.some(m=>m.formats.includes('MJPEG'))?' or MJPEG':''}`:'',only.length?`${listed(only.map(m=>m.size))} in MJPEG only`:''].filter(Boolean).join('; ')}. Up to ${fps} frames a second.`);
      if(only.length)add('MODES','warn',`${listed(only.map(m=>m.size))} ${only.length>1?'exist':'exists'} only in MJPEG. FTC’s default is YUY2, so ${only.length>1?'those sizes need':'that size needs'} .setStreamFormat(VisionPortal.StreamFormat.MJPEG) in your code.`);
      if(!both.some(m=>m.size===LIVE_SIZE))add('MODES','warn',`Live debug opens ${LIVE_SIZE} in YUY2, and this camera does not list that, so live debug may not start.`);}
    const c=controlsOf(uvc);if(uvc===undefined)add('CTRL','na','Reading its controls…');else if(!c)add('CTRL','na','Torque could not read its controls.');
    else{const none=[c.gain?'':'gain',c.whiteBalance?'':'white balance'].filter(Boolean);add('CTRL',none.length?'warn':'ok',`${none.length?`This camera has no ${none.map(n=>`${n} control`).join(' and no ')}. `:''}It lists ${listed([...new Set(c.list.map(x=>x.replace(/ \((absolute|relative)\)$/,'')))])}. Listing a control does not prove it works.`);}
    const lens=lensLine(d.vid,d.pid,size,saved);add('LENS',lens.state,lens.text);
    if(drops===undefined)add('DROPS','na','Reading how often it has come unplugged…');else if(!drops)add('DROPS','na','Torque cannot read how often it has come unplugged.');else{const n=U().dropCounts(drops).byPath[d.path]?.unplugged||0;add('DROPS',n?'warn':'ok',n?`Came unplugged ${n===1?'1 time':`${n} times`} since the hub started. If you did not unplug it, check its plug.`:'Has not come unplugged since the hub started.');}
    add('R708','note','Only the video stream may be used (R708), not the camera’s microphone or buttons.');
    return out;}
  const CHECK_NAMES={PORT:'Port',SPEED:'Speed',SERIAL:'Serial number',MODES:'Sizes',CTRL:'Controls',LENS:'Lens',DROPS:'Plug',R708:'Rules'};
  const checksHtml=list=>`<ul class="cal-cam-checks">${list.map((c,i)=>`<li data-check="${c.code}" data-state="${c.state}"><b>${i&&list[i-1].code===c.code?'':esc(CHECK_NAMES[c.code])}</b><span>${esc(c.text)}</span></li>`).join('')}</ul>`;

  // ---- one tag at a measured distance. Range is proportional to focal length, so the lens is what makes the two agree. It takes the centre of the lens to be the middle of the picture.
  const parseInches=text=>{const m=/^\s*(\d+(?:\.\d+)?|\.\d+)\s*(?:in|inch|inches|")?\s*$/i.exec(String(text??'')),v=m?+m[1]:NaN;return v>0?v:NaN;};
  const lensKey=serial=>String(serial||'').replace(/\|connection=.*$/,'').replace(/[^\w.:-]/g,'_').slice(0,80)||'camera';
  const intrinsics=l=>`.setLensIntrinsics(${l.fx}, ${l.fy}, ${l.cx}, ${l.cy})`;
  // readings: the tag as Torque Debug reports it, {r range in inches, b bearing, y yaw, p pitch in degrees}. many: readings thrown out for more than one tag in view.
  function lensFromReadings({measured,readings,fxCurrent,size=LIVE_SIZE,many=0}){const no=text=>({ok:false,text}),good=(readings||[]).filter(t=>Number.isFinite(t?.r)&&t.r>0),[w,h]=size.split('x').map(Number);
    if(!(measured>0))return no('Type the distance from the lens to the tag in inches, as a number.');
    if(many>good.length)return no('More than one tag was in view. Show the camera just one, then measure again.');
    if(good.length<MIN_READINGS)return no(good.length?`Torque read the tag only ${good.length===1?'once':`${good.length} times`}. Keep it in view and hold it still, then measure again.`:'Torque did not see a tag. Hold one in view, then measure again.');
    const off=key=>{const v=good.map(t=>t[key]).filter(Number.isFinite);return v.length?v.reduce((a,x)=>a+Math.abs(x),0)/v.length:0;},turned=Math.max(off('y'),off('p'),off('b'));
    if(turned>SQUARE_DEG)return no(`The tag was about ${Math.round(turned)}° off square. Face it straight at the lens, near the middle of the picture, then measure again. Nothing was stored.`);
    const r=good.map(t=>t.r),reported=r.reduce((a,x)=>a+x,0)/r.length;if((Math.max(...r)-Math.min(...r))/reported>SPREAD)return no('The reading moved too much. Hold the tag still, then measure again. Nothing was stored.');
    const ratio=measured/reported;if(ratio<RATIO[0]||ratio>RATIO[1])return no(`The tape says ${measured} in and the camera says ${reported.toFixed(1)} in. Those are too far apart to be this lens (the ratio is ${ratio.toFixed(2)}, and it should be between ${RATIO[0]} and ${RATIO[1]}). Check the tape, that you typed inches, and that the tag is printed at full size. Nothing was stored.`);
    const fx=+(fxCurrent*ratio).toFixed(3);return {ok:true,fx,fy:fx,cx:w/2,cy:h/2,size,ratio,reported,measured,readings:good.length};}

  // ---- a Limelight, from its own REST port. readLimelight answers {status: {...}}, a path {json}.
  const limeStatus=r=>r?.status&&typeof r.status==='object'?r.status:r?.json&&typeof r.json==='object'?r.json:null;
  function findError(j,depth=0){if(!j||typeof j!=='object'||depth>3)return null;for(const [k,v] of Object.entries(j))if(/reproj|rms/i.test(k)&&Number.isFinite(+v)&&+v>0)return +v;for(const v of Object.values(j)){const f=findError(v,depth+1);if(f!==null)return f;}return null;}
  // Which calibration it runs on, from what /cal-file, /cal-eeprom, /cal-default, /cal-stats and /cal-latest answered. No real Limelight has been read: this is what its documentation says to expect.
  function limeCal({file,eeprom,def,stats,latest}={}){const body=r=>r?.ok&&r.json&&typeof r.json==='object'&&Object.keys(r.json).length?r.json:null,base=body(def),same=j=>!!base&&JSON.stringify(j)===JSON.stringify(base);
    const custom=[body(file),body(eeprom)].some(j=>j&&!same(j)),answered=[file,eeprom,def].some(r=>r?.status);return {state:custom?'custom':answered?'default':'unknown',error:custom?findError(body(stats))??findError(body(latest)):null};}
  function limeCalText(c){if(c?.state==='custom'){const e=c.error;return {state:e===null||e>=1?'warn':'ok',text:e===null?'A custom calibration is active. Torque could not read its error.':`A custom calibration is active. Its reprojection error is ${(+e.toFixed(2))} pixels, which is ${e<1?'good':'high'}: under 1 is good, and 0.3 to 0.8 is typical.`};}
    return c?.state==='default'?{state:'warn',text:'The default calibration is active, not one made for this Limelight.'}:{state:'na',text:'Torque has not read its calibration.'};}
  const LIME_STEPS=['Plug the Limelight into the computer, not the hub, and go to http://limelight.local:5801 in a web browser.','Open its Calibration tab and print a ChArUco board (the default is 11x8, 5x5_100).','Take at least 25 snapshots, then go on to 50, with edges and tilted views among them.','Aim for a reprojection error under 1 pixel. 0.3 to 0.8 is typical.','Plug it back into the Control Hub’s blue USB 3.0 port.'];

  function create({host,api,native,debug,configured=()=>[],plugged=()=>null,active=()=>null,toConfigure,limelights=()=>[],lens=null}){const q=s=>host.querySelector(s);let settings=(()=>{try{return sanitize(JSON.parse(localStorage.getItem(STORE)||'{}'));}catch{return sanitize({});}})(),source='sim',tags=[],tuning=null,result=null,streaming=false,raf=0,lastDraw=0,hits=[],camUrl=null,cam=null,timer=null;
    let lensBusy=false,lensFail='',lensSent=null,lensCopied=false,checkSize=LIVE_SIZE,drops,dropsAt=0,dropsKey=null,checksHtmlNow=null,lensHtmlNow=null,limeHtmlNow=null;const uvcs=new Map(),lime={at:0,calAt:0,busy:false,status:null,info:null,error:null,cal:null};
    const remember=()=>{try{localStorage.setItem(STORE,JSON.stringify(settings));}catch{}};
    const cameras=()=>debug?.running()?(debug.latest().manifest?.cameras||[]):[];
    // Once Torque has read the hub's USB ports they say what is plugged in right now; until then the robot's own Scan does.
    const rows=()=>plugged()?.devices||null,limeRows=()=>(rows()||[]).filter(r=>r.config==='limelight');
    // Two alike with no serial read as one key, so each gets the port that tells them apart, as the robot's own key does.
    const pluggedNow=()=>{const o=plugged(),r=o?.devices;if(!r)return o;const cams=r.filter(x=>x.config==='webcam');return cams.map(x=>{const serial=K().madeUpKey(x.scanKey)&&cams.filter(y=>y.scanKey===x.scanKey).length>1?`${x.scanKey}${x.device?.path}`:x.scanKey;return {serial,type:'WEBCAM',name:K().cameraLabel(serial,cams)};});};
    const offered=()=>choices(cameras(),configured(),pluggedNow(),limeRows()),current=()=>{const all=offered();return all.find(o=>o.value===source)||all[0];},real=()=>current().state==='live';
    // A real camera with no picture yet (not in the configuration, or live debug not started): no simulated picture in its place.
    const waiting=()=>['configured','spare'].includes(current().state),limelightOn=()=>current().state==='limelight';
    const shown=()=>!!host.offsetParent;
    const serialOf=now=>now.state==='live'?configured().find(c=>c.name===now.value)?.serial:now.serial;
    const rowOf=now=>{const key=serialOf(now);return key?K().rowForKey(rows(),key):null;};
    const addable=now=>R().canSend(now.serial),NO_ADD='Its serial number has a symbol, such as & or an apostrophe, that the robot will not take in a configuration, so Torque cannot add it.';
    const uvcKey=row=>[row.device?.path,row.device?.dev,row.usbId,row.device?.serial].join('|');
    // undefined while reading, null when it cannot be read.
    const uvcOf=row=>{const e=row&&uvcs.get(uvcKey(row));return e?.uvc;};
    const controlsNow=()=>{const row=rowOf(current());return row?controlsOf(uvcOf(row)):null;};
    const opts=(list,now,word=v=>v)=>list.map(v=>`<option value="${esc(v)}"${String(v)===String(now)?' selected':''}>${esc(word(v))}</option>`).join('');
    function exposures(){const r=cam?.range,all=r?EXPOSURES.filter(v=>v>=r[0]&&v<=r[1]):EXPOSURES;return ['auto',...all];}
    function controls(){const s=settings,now=current(),c=controlsNow(),pick=`<div class="cal-field"><label for="cam-source">Camera</label><select id="cam-source" data-cam="source">${offered().map(o=>`<option value="${esc(o.value)}"${o.value===now.value?' selected':''}>${esc(o.label)}</option>`).join('')}</select></div>`;if(now.state==='limelight')return pick;
      return `${pick}
      <div class="cal-field"><label for="cam-rotate">Rotate the view</label><select id="cam-rotate" data-cam="rotate">${opts(ROTATIONS,s.rotate,v=>`${v}°`)}</select></div>
      ${c&&!c.exposure?'':`<div class="cal-field"><label for="cam-exposure">Exposure</label><select id="cam-exposure" data-cam="exposure">${opts(exposures(),s.exposure,v=>v==='auto'?'Automatic':`${v} ms`)}</select></div>`}
      ${c&&!c.gain?'':`<div class="cal-field"><label for="cam-gain">Gain</label><select id="cam-gain" data-cam="gain"${s.exposure==='auto'?' disabled title="Gain can be set only with a manual exposure."':''}>${opts(GAINS,s.gain)}</select></div>`}
      <div class="cal-field"><label for="cam-decimation">Decimation</label><select id="cam-decimation" data-cam="decimation">${opts(DECIMATIONS,s.decimation,v=>({1:'1: farthest, slowest',2:'2: in between',3:'3: closest, fastest'}[v]))}</select></div>
      ${now.state==='sim'?`<div class="cal-field"><label for="cam-feet">Tag distance</label><select id="cam-feet" data-cam="feet">${opts(FEET,s.feet,v=>`${v} ft`)}</select></div><div class="cal-field"><label for="cam-moving">Robot</label><select id="cam-moving" data-cam="moving"><option value="0"${s.moving?'':' selected'}>Standing still</option><option value="1"${s.moving?' selected':''}>Driving</option></select></div>`:''}`;}
    // What this camera needs next, in words.
    function noteOf(now,link){const name=active();
      if(now.state==='sim')return 'This is a simulated webcam: no camera or robot is needed, and its numbers are a model of the FTC docs, not a measurement.';
      if(now.state==='limelight')return limeInConfig(now)?`This Limelight is in the active configuration as “${limeInConfig(now).name}”.`:`This Limelight is plugged in, but it is not in the active configuration${name?`, “${name}”`:''}. Your code can only reach it from the configuration, so add it in Configure and press Save.`;
      if(now.state==='spare')return `${K().cameraLabel(now.serial,rows())} is plugged into the Control Hub, but it is not in the active configuration${name?`, “${name}”`:''}. The Robot Controller can only open cameras in its active configuration, ${addable(now)?'so add it in Configure and press Save.':`and ${NO_ADD.charAt(0).toLowerCase()}${NO_ADD.slice(1)}`}`;
      if(now.state==='configured'){if(now.absent)return `“${now.value}” is in the active configuration, but ${plugged()?.devices?'it is not plugged into the Control Hub':'the last scan did not find it on the Control Hub'}. Check its USB cable.`;if(link?.running&&debug.latest().manifest)return `Live debug is running, but the robot did not open “${now.value}”. Stop live debug and start it again.`;return `Your robot has “${now.value}”. Start live debug to see it.`;}
      return cam?.error?`The camera did not start: ${cam.error}`:cam?`${cam.state||'Starting'}${Number.isFinite(cam.fps)?` · ${cam.fps.toFixed(0)} frames a second`:''}`:'Waiting for the camera…';}
    const limeInConfig=now=>{const all=limelights()||[];return all.find(c=>c.serial===now.serial)||all[0]||null;};
    // The same Start and Put on the robot as the Debug tab's, so a student never has to walk there and back.
    function actions(now,link){const hub=now.state==='configured'||now.state==='live',busy=!!(link?.running||link?.starting),line=q('[data-cam-link]'),add=(now.state==='spare'&&addable(now))||(now.state==='limelight'&&!limeInConfig(now));q('[data-cam-add]').hidden=!add;q('[data-cam-start]').hidden=q('[data-cam-install]').hidden=!hub||!debug;q('[data-cam-actions]').hidden=!hub&&!add;
      q('[data-cam-start]').textContent=busy?'Stop live debug':'Start live debug';q('[data-cam-install]').disabled=busy;line.hidden=!hub||!link||link.text==='Not connected';line.textContent=link?.text||'';line.className=link?.kind==='error'?'cal-debug-bad':'hint';
      q('[data-cam-empty]').hidden=!waiting();q('[data-cam-empty]').textContent=now.state==='spare'?(addable(now)?'Add this camera in Configure to see its picture.':'Torque cannot show this camera’s picture.'):'Start live debug to see this camera’s picture.';}
    function paint(){const now=current(),link=debug?.state?.(),c=controlsNow();if(waiting()||now.state==='limelight')tags=[];q('[data-cam-controls]').innerHTML=controls();
      q('[data-cam-note]').textContent=noteOf(now,link);actions(now,link);
      q('[data-cam-tune]').disabled=!!tuning||waiting()||(!!c&&!c.exposure);q('[data-cam-result]').innerHTML=tuning?`<p class="hint" role="status">${esc(tuning)}</p>`:result?(result.none?`<p class="cal-debug-warn" role="status">${esc(result.none)}</p>`:`<p role="status">Best: exposure ${result.exposure} ms${result.gain===null?'':`, gain ${result.gain}`}, decimation ${result.decimation}. It read the tag in ${Math.round(result.rate*100)}% of frames. These are set now.</p><p class="hint">To use them in your own code, after the camera is streaming:</p><pre class="cal-cam-code">${esc(javaLines(result))}</pre>`):'';
      view();listTags();paintChecks();paintLens();paintLime();}
    function listTags(){q('[data-cam-tags]').innerHTML=tags.length?tags.map(t=>`<li><b>Tag ${esc(t.id)}</b>${t.name?` ${esc(t.name)}`:''}${Number.isFinite(t.r)?` · ${t.r.toFixed(1)} in away, ${t.b.toFixed(0)}° to the side`:''}${Number.isFinite(t.m)?` · margin ${t.m.toFixed(0)}`:''}</li>`).join(''):'<li class="hint">No AprilTag in view.</li>';}
    function view(){const turn=settings.rotate,scale=turn%180?.75:1,on=limelightOn();for(const el of [q('[data-cam-canvas]'),q('[data-cam-image]')])el.style.transform=`rotate(${turn}deg) scale(${scale})`;q('[data-cam-canvas]').hidden=real()||waiting()||on;q('[data-cam-image]').hidden=!real();q('[data-cam-view]').hidden=on;q('[data-cam-lime]').hidden=!on;q('[data-cam-tuning]').hidden=on;}
    // ---- the checks on the camera picked
    function paintChecks(){const now=current(),box=q('[data-cam-checks]'),row=rowOf(now);let html='';
      if(now.state==='sim')html=`<h3 class="cal-group-title">Checks on this camera</h3><p class="hint">The simulated webcam has no USB port to check. Plug a real one into the Control Hub to see its checks here.</p>`;
      else if(now.state!=='limelight'&&!row)html=`<h3 class="cal-group-title">Checks on this camera</h3><p class="hint">${now.absent?'It has to be plugged in to be checked.':plugged()?.devices?'Torque does not see this camera on the Control Hub’s USB ports.':'Torque checks a camera once it has read the Control Hub’s USB ports, which it does over the USB-C cable.'}</p>`;
      else if(row){const uvc=uvcOf(row),modes=modesOf(uvc),sizes=[...new Set([...modes.map(m=>m.size),LIVE_SIZE])],size=sizes.includes(checkSize)?checkSize:LIVE_SIZE,legal=row.legal||{},extra=(row.id==='E2'?['The Arducam OV9281 and the goBILDA 3122-0004-0001 can share this USB ID, and their lenses differ, so measure yours.']:String(row.explain||'').split(/(?<=\.)\s+/).filter(s=>s&&!s.startsWith('To measure its lens')));
        html=`<h3 class="cal-group-title">Checks on this camera</h3><p class="cal-cam-chip"><span class="rs-pill ${legal.ok?'ok':'bad'}">${esc(U().chipWords(legal))}: ${esc(legal.rule)}</span></p>${checksHtml(cameraChecks({row,uvc,drops,size,saved:stored(lensKey(serialOf(now)),size)}))}
          ${sizes.length>1?`<div class="cal-field cal-cam-size"><label for="cam-check-size">Size to check the lens at</label><select id="cam-check-size" data-cam-size>${opts(sizes,size)}</select></div><p class="hint">Live debug always opens ${LIVE_SIZE}. This only changes which size the lens check talks about, for your own code.</p>`:''}${extra.length?`<p class="hint">${esc(extra.join(' '))}</p>`:''}${K().madeUpKey(serialOf(now))?`<details class="usb-facts"><summary>Technical facts</summary><dl class="cal-cam-facts"><dt>The robot’s name for it</dt><dd>${esc(serialOf(now))}</dd></dl></details>`:''}`;}
      if(html!==checksHtmlNow){const open=box.querySelector('details')?.open;checksHtmlNow=html;box.innerHTML=html;box.hidden=!html;if(open){const d=box.querySelector('details');if(d)d.open=true;}}}
    // ---- reading what the checks need, only while this tab shows and only when something changed
    async function readUvc(row){const key=uvcKey(row),had=uvcs.get(key);if(had&&(had.uvc!==null||Date.now()-had.at<10000))return;uvcs.set(key,{at:Date.now()});paintChecks();let uvc=null;try{const r=await api.robotLink('hub-usb-camera',{path:row.device.path});uvc=r?.hex?K().parseUvc(r.hex):null;}catch{}uvcs.set(key,{at:Date.now(),uvc});paint();}
    async function readDrops(){const key=JSON.stringify((rows()||[]).map(r=>[r.device?.path,r.device?.dev]));if(key===dropsKey&&Date.now()-dropsAt<30000)return;dropsKey=key;dropsAt=Date.now();try{drops=await api.robotLink('hub-usb-drops');}catch{drops=null;}paintChecks();}
    async function readLime(){if(lime.busy||Date.now()-lime.at<2000)return;lime.busy=true;lime.at=Date.now();
      try{const r=await api.robotLink('limelight',{});lime.info=r;lime.status=limeStatus(r);lime.error=null;}catch(e){lime.error=e.message;lime.status=null;}
      try{if(lime.status&&Date.now()-lime.calAt>=30000){lime.calAt=Date.now();const got={};for(const [k,path] of [['file','/cal-file'],['eeprom','/cal-eeprom'],['def','/cal-default'],['stats','/cal-stats'],['latest','/cal-latest']]){try{got[k]=await api.robotLink('limelight',{path});}catch{got[k]=null;}}lime.cal=limeCal(got);}}
      finally{lime.busy=false;paintLime();}}
    // ---- a Limelight in place of the picture
    function paintLime(){const now=current(),box=q('[data-cam-lime]');if(now.state!=='limelight'){limeHtmlNow=null;return;}const s=lime.status,row=now.row,fact=(k,v)=>v===undefined||v===null||v===''?'':`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`,num=(v,u)=>Number.isFinite(+v)&&v!==null&&v!==''?`${+(+v).toFixed(1)}${u}`:null,cal=limeCalText(lime.cal),usb2=row?.warnings?.find(w=>w.code==='PORT'),lost=drops&&row?U().dropCounts(drops).byPath[row.device?.path]?.unplugged||0:0;
      const html=`<h3 class="cal-group-title">Limelight smart camera</h3><p class="cal-cam-chip"><span class="rs-pill ok">Allowed if it is a Limelight 3A: ${esc(row?.legal?.rule||'')}</span></p>${usb2?`<p class="cal-debug-warn">${esc(usb2.text)}</p>`:''}${lost?`<p class="cal-debug-warn">Came unplugged ${lost===1?'1 time':`${lost} times`} since the hub started. If you did not unplug it, check its plug.</p>`:''}
        ${s?`<dl class="cal-cam-facts" data-lime-status>${fact('Name',s.name)}${fact('Temperature',num(s.temp,' °C'))}${fact('CPU',num(s.cpu,'%'))}${fact('Memory',num(s.ram,'%'))}${fact('Frame rate',num(s.fps,' frames a second'))}${fact('Pipeline',s.pipelineIndex)}</dl><p data-lime-cal data-state="${cal.state}">${esc(cal.text)}</p>`:`<p class="hint" role="status">${lime.error?'Torque cannot reach it from here yet.':'Asking the Limelight how it is…'}</p>`}
        <h3 class="cal-group-title">Calibrate it on its own page</h3><ol class="cal-steps">${LIME_STEPS.map(t=>`<li>${esc(t)}</li>`).join('')}</ol>
        <p class="hint">A hub can have one Limelight, on the blue port. A Limelight 3G is prohibited (R702), and Torque cannot tell a 3G from a 3A yet, so check the label on yours.</p>
        <details class="usb-facts"><summary>Technical facts</summary><dl class="cal-cam-facts">${fact('Its address',lime.info?.address||row?.limelight?.address)}${fact('The hub’s address',lime.info?.hubAddress||row?.limelight?.hubAddress)}${fact('Network interface',lime.info?.iface||row?.limelight?.iface)}${fact('Scan key',row?.scanKey)}${s?fact('hwType',s.hwType):''}</dl></details>`;
      if(html!==limeHtmlNow){const open=box.querySelector('details')?.open;limeHtmlNow=html;box.innerHTML=html;if(open)box.querySelector('details').open=true;}}
    // ---- measuring the lens
    const stored=(key,size=LIVE_SIZE)=>lens?.all?.()?.[key]?.[size]||null;
    function keep(key,size,value){const all={...(lens?.all?.()||{})},one={...(all[key]||{})};if(value)one[size]=value;else delete one[size];if(Object.keys(one).length)all[key]=one;else delete all[key];lens?.save?.(all);}
    const keyNow=now=>now.state==='sim'?'sim':lensKey(serialOf(now));
    // The focal length the readings were worked out with, or null when only the SDK knows it: Torque Debug reports its own once it has been given one.
    function fxNow(now){if(now.state==='sim')return stored('sim')?.fx??FALLBACK_FX;if(Array.isArray(cam?.lens))return cam.lens[0];const row=rowOf(now);if(!row)return null;return ['none','other'].includes(lensLine(row.device.vid,row.device.pid,LIVE_SIZE).match)?FALLBACK_FX:null;}
    function lensState(now){if(now.state==='limelight')return {show:false};if(now.state==='sim')return {show:true,ready:true,note:`The simulated tag is ${settings.feet*12} inches away. This webcam’s made-up lens has no FTC data, so it reads short until you measure it.`};
      const row=rowOf(now),has=stored(keyNow(now)),need=row?['none','other'].includes(lensLine(row.device.vid,row.device.pid,LIVE_SIZE).match):false;
      if(now.state!=='live')return {show:!!row&&(need||!!has),ready:false,note:now.state==='spare'?'Add this camera in Configure first. Then this runs while live debug shows it.':'Start live debug first: this reads the distance the robot reports.'};
      if(cameras()[0]!==now.value)return {show:false};
      if(!row&&!Array.isArray(cam?.lens))return {show:true,ready:false,note:'Torque has to know which camera this is first, so connect the Control Hub by USB-C.'};
      if(!need&&!has&&!Array.isArray(cam?.lens))return {show:false};
      if(cam?.state!=='STREAMING')return {show:true,ready:false,note:'Waiting for the camera to stream…'};return {show:true,ready:true,note:''};}
    function lensWhere(now,has){if(now.state==='sim')return 'The simulated webcam uses these numbers now.';if(!real())return 'The next live debug uses these numbers.';
      if(cam&&cam.lens===undefined)return 'The Torque Debug on the robot is too old to take these numbers. Press Put Torque Debug on the robot, then start live debug again.';
      return Array.isArray(cam?.lens)&&Math.abs(cam.lens[0]-has.fx)<.01?'Live debug is using these numbers now.':'Sending these numbers to Torque Debug. The camera opens again to use them.';}
    function paintLens(){const now=current(),box=q('[data-cam-lens]'),st=lensState(now);box.hidden=!st.show;if(!st.show){lensHtmlNow=null;return;}const has=stored(keyNow(now));
      q('[data-cam-lens-note]').textContent=lensBusy?'Measuring. Hold the tag still…':st.note;q('[data-cam-lens-note]').hidden=!lensBusy&&!st.note;q('[data-cam-lens-go]').disabled=lensBusy||!st.ready;q('[data-cam-lens-distance]').disabled=!st.ready;q('[data-cam-lens-forget]').hidden=!has;
      const html=`${lensFail?`<p class="cal-debug-warn" role="alert">${esc(lensFail)}</p>`:''}${has?`<p role="status">Saved for this camera at ${LIVE_SIZE}: the tape said ${esc(has.measured)} in and the camera said ${esc((+has.reported).toFixed(1))} in.</p><pre class="cal-cam-code" data-cam-lens-line>${esc(intrinsics(has))}</pre><div class="button-row"><button type="button" class="secondary" data-cam-lens-copy>${lensCopied?'Copied':'Copy'}</button></div><p class="hint">${esc(lensWhere(now,has))} In your own code, it goes on <code>new AprilTagProcessor.Builder()</code>. Show the constants file, in Calibrate → Mechanisms, has these numbers too.</p>`:''}`;
      if(html!==lensHtmlNow){lensHtmlNow=html;q('[data-cam-lens-result]').innerHTML=html;}}
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    // What the camera reported for a few seconds.
    async function readingsNow(now){const end=Date.now()+LENS_MS,out=[];let many=0;
      if(now.state==='sim'){for(;Date.now()<end;await wait(100)){const t=simTag();if(t)out.push(t);}return {readings:out,many};}
      let last=null;const off=debug.listen(f=>{const list=f.cam?.state==='STREAMING'?f.cam.tags:null;if(!list?.length)return;if(list.length>1){many++;return;}if(list[0].r!==last){last=list[0].r;out.push(list[0]);}});await wait(LENS_MS);off();return {readings:out,many};}
    async function measureLens(){if(lensBusy)return;const now=current(),measured=parseInches(q('[data-cam-lens-distance]').value);lensFail='';lensCopied=false;
      if(!(measured>0)){lensFail=lensFromReadings({measured}).text;paintLens();q('[data-cam-lens-distance]').focus();return;}
      const fxCurrent=fxNow(now);if(!fxCurrent){lensFail='Torque does not know which lens numbers the robot is using, so it cannot work this out.';paintLens();return;}
      lensBusy=true;paintLens();let out;try{out=lensFromReadings({measured,fxCurrent,...await readingsNow(now)});}finally{lensBusy=false;}
      if(out.ok){keep(keyNow(now),LIVE_SIZE,{fx:out.fx,fy:out.fy,cx:out.cx,cy:out.cy,measured:out.measured,reported:+out.reported.toFixed(3),at:new Date().toISOString()});lensSent=null;syncLens();}else lensFail=out.text;
      paint();}
    // AprilTag takes its lens numbers only when it is built, so Torque Debug opens its camera again when they change. Only its first camera is ever open.
    function syncLens(){if(!real()||!cam||cam.lens===undefined||cameras()[0]!==current().value)return;const want=stored(keyNow(current())),have=cam.lens,same=want?Array.isArray(have)&&Math.abs(have[0]-want.fx)<.01&&Math.abs(have[1]-want.fy)<.01&&Math.abs(have[2]-want.cx)<.01&&Math.abs(have[3]-want.cy)<.01:!Array.isArray(have);if(same){lensSent=null;return;}
      const line=want?`K\t${want.fx}\t${want.fy}\t${want.cx}\t${want.cy}`:'K\toff';if(lensSent!==line){lensSent=line;send(line);}}
    // ---- the simulated view
    const seedBit=(i,j)=>((i*7+j*13+i*j*5+11)%5)<2;
    // One look at its tag, read through the lens numbers it has been given.
    function simTag(now=performance.now()){const s=settings,rate=simRate(s);if(Math.random()>=rate)return null;return {id:584,name:'Simulated tag',r:s.feet*12*(stored('sim')?.fx??FALLBACK_FX)/SIM_FX*(1+(Math.random()-.5)*.004),b:s.moving?Math.sin(now/500)*8:0,y:0,p:0,m:40+50*rate};}
    function draw(now){const s=settings,c=q('[data-cam-canvas]'),g=c.getContext('2d'),W=c.width,H=c.height,e=exposureOf(s),gain=gainOf(s),light=e*(1+gain/64),bright=Math.max(.08,Math.min(1.7,light/30)),blur=blurPixels(s),size=tagPixels(s.feet),x=W/2-size/2+(s.moving?70*Math.sin(now/500):0),y=H/2-size/2;
      g.filter='none';g.fillStyle='#6d7277';g.fillRect(0,0,W,H);g.filter=`blur(${Math.min(40,blur).toFixed(1)}px) brightness(${bright.toFixed(2)})`;g.fillStyle='#8d9196';g.fillRect(0,H*.62,W,H*.38);g.fillStyle='#fff';g.fillRect(x-size*.12,y-size*.12,size*1.24,size*1.24);g.fillStyle='#000';g.fillRect(x,y,size,size);g.fillStyle='#fff';for(let i=1;i<7;i++)for(let j=1;j<7;j++)if(seedBit(i,j))g.fillRect(x+i*size/8,y+j*size/8,size/8+.5,size/8+.5);g.filter='none';
      if(s.exposure!=='auto'&&gain>0){g.fillStyle='rgba(255,255,255,.35)';for(let i=0;i<gain*3;i++)g.fillRect(Math.random()*W,Math.random()*H,2,2);}
      const tag=simTag(now),hit=!!tag;tags=hit?[tag]:[];hits.push(hit);if(hits.length>90)hits.shift();
      if(hit){g.strokeStyle='#3ddc84';g.lineWidth=4;g.strokeRect(x,y,size,size);g.fillStyle='#3ddc84';g.font='22px sans-serif';g.fillText('Tag 584',x,Math.max(24,y-size*.16));}listTags();}
    function frame(now){raf=0;if(!shown()||real()||waiting()||limelightOn())return;if(now-lastDraw>=1000/fpsOf(settings.decimation)){lastDraw=now;draw(now);}raf=requestAnimationFrame(frame);}
    // ---- a robot's camera
    const send=line=>debug?.send(line);
    function sendSettings(){if(!real())return;const s=settings,c=controlsNow();if(!c||c.exposure)send(s.exposure==='auto'?'V\tauto':`V\t${s.exposure}\t${c&&!c.gain?0:s.gain}`);send(`D\t${s.decimation}`);}
    function stream(on){if(streaming===on||!native||!api.robotLink)return;streaming=on;void api.robotLink('debug-camera',{on}).catch(()=>{});}
    function tick(){if(!shown()){stream(false);return;}const had=cameras().join(),now=current();stream(real());if(!debug?.running?.())lensSent=null;if(!real()&&!raf&&!waiting()&&!limelightOn())raf=requestAnimationFrame(frame);const row=rowOf(now);
      if(native&&api.robotLink){if(row){void readUvc(row);}if(rows())void readDrops();if(now.state==='limelight')void readLime();}
      const link=debug?.state?.(),seen=(rows()||[]).map(r=>[r.device?.path,r.device?.dev,r.id,r.pending,r.scanKey]),known=JSON.stringify([had,configured(),plugged(),seen,limelights(),active(),link]);if(tick.cams!==known){tick.cams=known;if(real()&&!tuning)sendSettings();paint();}}
    debug?.onCamera?.(bytes=>{if(!real()||!shown())return;const url=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));q('[data-cam-image]').src=url;if(camUrl)URL.revokeObjectURL(camUrl);camUrl=url;});
    const unlisten=debug?.listen?.(f=>{const c=f.cam;if(!c)return;const was=`${cam?.state}${cam?.error}${cam?.lens}`;cam=c;if(real()){tags=c.tags||[];listTags();syncLens();}if(was!==`${c.state}${c.error}${c.lens}`)paint();});
    // ---- Find the best settings
    async function measure(s){if(!real()){settings=s;return simRate(s);}settings=s;sendSettings();await wait(900);let n=0,hit=0;const off=debug.listen(f=>{if(f.cam){n++;if(f.cam.tags?.length)hit++;}});await wait(1500);off();return n?hit/n:0;}
    async function tune(){if(tuning)return;const keep=settings,r=cam?.range,noGain=controlsNow()?.gain===false,gain=noGain?0:r?GAINS.filter(v=>v<=r[3]).at(-1):255,list=r?EXPOSURES.filter(v=>v>=r[0]&&v<=r[1]):EXPOSURES;result=null;tuning='Starting…';paint();let best=null,top=0;
      try{for(const exposure of list){tuning=`Trying exposure ${exposure} ms${noGain?'':` at gain ${gain}`}…`;q('[data-cam-result]').innerHTML=`<p class="hint" role="status">${esc(tuning)}</p>`;const s=sanitize({...keep,exposure,gain}),rate=await measure(s);top=Math.max(top,rate);if(!real())await wait(120);if(rate>=GOOD){best={exposure,gain:noGain?null:gain,decimation:s.decimation,rate};break;}}
        tuning=null;if(best){settings=sanitize({...keep,exposure:best.exposure,gain:noGain?keep.gain:best.gain});result=best;}else{settings=keep;result={none:top?`It never read the tag reliably (best ${Math.round(top*100)}% of frames). Move the tag closer, or choose a lower decimation, then try again.`:'It never saw a tag. Point the camera at an AprilTag about as far away as you will use it, then try again.'};}
        sendSettings();remember();}
      finally{tuning=null;paint();}}
    host.innerHTML=`<h2>Camera</h2><p class="hint">See what a webcam sees, turn the view and tune AprilTag reading. To use a real webcam, plug it into the Control Hub’s blue USB 3.0 port.</p>
      <div class="cal-cam"><div class="cal-cam-view" data-cam-view><canvas data-cam-canvas width="640" height="480" aria-label="Simulated camera view"></canvas><img data-cam-image alt="Live camera view" hidden><p class="cal-cam-empty" data-cam-empty hidden></p></div><div class="cal-cam-lime" data-cam-lime hidden></div>
      <div class="cal-cam-side"><p class="hint" data-cam-note role="status"></p><div class="button-row" data-cam-actions hidden><button type="button" class="primary" data-cam-add hidden>Add it in Configure</button><button type="button" class="primary" data-cam-start hidden>Start live debug</button><button type="button" class="secondary" data-cam-install hidden>Put Torque Debug on the robot</button></div><p class="hint" data-cam-link role="status" hidden></p><div data-cam-params></div><div class="cal-fields" data-cam-controls></div><div data-cam-tuning><div class="button-row"><button type="button" class="primary" data-cam-tune>Find the best settings</button></div><p class="hint">Hold a tag where the robot will see it. This raises exposure from the lowest until tags read reliably, which keeps a moving tag sharpest.</p><div data-cam-result></div><h3 class="cal-group-title">AprilTags in view</h3><ul class="cal-cam-tags" data-cam-tags></ul></div></div></div>
      <div class="cal-cam-more"><section class="cal-cam-part" data-cam-checks hidden></section><section class="cal-cam-part" data-cam-lens hidden><h3 class="cal-group-title">Measure this lens</h3><p class="hint" data-cam-lens-note role="status" hidden></p>
        <ol class="cal-steps"><li>Hold a tag printed at full size flat and square to the camera, near the middle of the picture. One tag only.</li><li>Measure from the lens to the tag with a tape measure, and type it here.</li><li>Press Measure and hold still for ${LENS_MS/1000} seconds. Torque averages what the camera reports.</li></ol>
        <div class="cal-field cal-cam-distance"><label for="cam-lens-distance">Distance to the tag, in inches</label><input id="cam-lens-distance" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-slider="off" data-cam-lens-distance placeholder="24"></div>
        <div class="button-row"><button type="button" class="primary" data-cam-lens-go>Measure</button><button type="button" class="secondary" data-cam-lens-forget hidden>Forget these numbers</button></div><div data-cam-lens-result></div>
        <p class="hint">This is a single-point estimate that takes the centre of the lens to be the middle of the picture. It is good enough to fix distance. FIRST’s full method, with 3DF Zephyr or OpenCV, is the better one.</p></section></div>`;
    q('[data-cam-controls]').addEventListener('change',e=>{const k=e.target.dataset.cam;if(!k)return;result=null;lensFail='';if(k==='source'){source=e.target.value;tags=[];cam=real()?cam:null;limeReset();stream(real());sendSettings();}else{const v=e.target.value;settings=sanitize({...settings,[k]:k==='moving'?v==='1':k==='exposure'&&v==='auto'?'auto':+v});remember();if(['exposure','gain','decimation'].includes(k))sendSettings();}paint();tick();});
    function limeReset(){lime.status=null;lime.info=null;lime.cal=null;lime.at=0;lime.calAt=0;lensCopied=false;}
    q('[data-cam-checks]').addEventListener('change',e=>{if(e.target.dataset.camSize===undefined)return;checkSize=e.target.value;paintChecks();q('[data-cam-size]')?.focus();});
    q('[data-cam-lens]').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset,now=current();
      if(d.camLensGo!==undefined)void measureLens();
      else if(d.camLensForget!==undefined){keep(keyNow(now),LIVE_SIZE,null);lensFail='';lensSent=null;syncLens();paint();}
      else if(d.camLensCopy!==undefined){const has=stored(keyNow(now));if(has){void navigator.clipboard?.writeText(intrinsics(has)).catch(()=>{});lensCopied=true;paintLens();}}});
    q('[data-cam-lens-distance]').addEventListener('keydown',e=>{if(e.key==='Enter'&&!q('[data-cam-lens-go]').disabled)void measureLens();});
    q('[data-cam-tune]').onclick=()=>void tune();
    q('[data-cam-add]').onclick=()=>toConfigure?.(current().serial);
    q('[data-cam-start]').onclick=()=>{void debug.start();tick();};
    q('[data-cam-install]').onclick=()=>debug.offerInstall(q('[data-cam-params]'));
    paint();timer=setInterval(tick,500);
    return {refresh:()=>{paint();tick();},settings:()=>settings,
      // From the USB devices tab: this camera or Limelight, by its Scan key.
      select(serial){const o=offered().find(x=>sameCamera(serialOf(x),serial));if(o){source=o.value;tags=[];limeReset();}paint();tick();},
      stop(){clearInterval(timer);unlisten?.();stream(false);}};}
  return {create,choices,sanitize,simRate,pick,rangeFeet,fpsOf,javaLines,simFrame,blurPixels,modesOf,controlsOf,lensLine,cameraChecks,parseInches,lensKey,intrinsics,lensFromReadings,limeStatus,limeCal,limeCalText,sameCamera,DEFAULTS,EXPOSURES,GAINS,LIVE_SIZE,FALLBACK_FX,SIM_FX};
});
