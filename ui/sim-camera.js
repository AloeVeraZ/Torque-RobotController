(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DeckCamera=api;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Calibrate → Camera: a webcam's live view, its AprilTags and its settings. From a robot, Torque Debug runs the SDK's VisionPortal
  // with an AprilTagProcessor and the picture comes as the Driver Station's Camera Stream does. With no camera, the simulated webcam
  // behaves as the FTC docs describe: exposure blurs a moving tag and gain brightens the picture (usable only with manual
  // exposure), and decimation trades range for frame rate (a 2-inch tag: 10 ft at 1, 4 ft at 3). Its numbers are a model, not a measurement.
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const EXPOSURES=[1,2,3,4,5,6,8,10,12,15,20,25,30,40,50,75,100],GAINS=[0,25,50,75,100,125,150,175,200,225,255],DECIMATIONS=[1,2,3],FEET=[1,2,3,4,5,6,8,10,12,15,20],ROTATIONS=[0,90,180,270];
  const DEFAULTS={exposure:'auto',gain:100,decimation:3,rotate:0,feet:4,moving:false},AUTO_MS=33,GOOD=.9,STORE='torque-camera';
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
  function javaLines({exposure,gain,decimation}){return ['ExposureControl exposure = portal.getCameraControl(ExposureControl.class);','exposure.setMode(ExposureControl.Mode.Manual);',`exposure.setExposure(${exposure}, TimeUnit.MILLISECONDS);`,`portal.getCameraControl(GainControl.class).setGain(${gain});`,`aprilTag.setDecimation(${decimation});`].join('\n');}
  // A small picture for the simulated hub's Camera Stream: grey, with a dark square that moves and a brightness that follows the settings.
  function simFrame(n=0,bright=.6,w=160,h=120){const size=54+1024+w*h,row=(w+3)&~3,total=54+1024+row*h,b=Buffer.alloc(total);b.write('BM');b.writeUInt32LE(total,2);b.writeUInt32LE(1078,10);b.writeUInt32LE(40,14);b.writeInt32LE(w,18);b.writeInt32LE(h,22);b.writeUInt16LE(1,26);b.writeUInt16LE(8,28);b.writeUInt32LE(256,46);
    for(let i=0;i<256;i++){b[54+i*4]=b[55+i*4]=b[56+i*4]=i;}const x0=50+Math.round(20*Math.sin(n/8));for(let y=0;y<h;y++)for(let x=0;x<w;x++){const tag=x>=x0&&x<x0+60&&y>=30&&y<90,inner=tag&&x>=x0+6&&x<x0+54&&y>=36&&y<84;b[1078+y*row+x]=Math.round(255*bright*(tag?(inner?(((x-x0)>>3^(y-30)>>3)&1?1:.08):.08):.55));}return size&&b;}

  function create({host,api,native,debug,configured=()=>[]}){const q=s=>host.querySelector(s);let settings=(()=>{try{return sanitize(JSON.parse(localStorage.getItem(STORE)||'{}'));}catch{return sanitize({});}})(),source='sim',tags=[],tuning=null,result=null,streaming=false,raf=0,lastDraw=0,hits=[],camUrl=null,cam=null,timer=null;
    const remember=()=>{try{localStorage.setItem(STORE,JSON.stringify(settings));}catch{}};
    const cameras=()=>debug?.running()?(debug.latest().manifest?.cameras||[]):[],real=()=>source!=='sim';
    // A real camera the robot has but live debug has not started: nothing to show yet, and no simulated picture in its place.
    const waiting=()=>!cameras().length&&configured().length>0;
    const shown=()=>!!host.offsetParent;
    const opts=(list,now,word=v=>v)=>list.map(v=>`<option value="${esc(v)}"${String(v)===String(now)?' selected':''}>${esc(word(v))}</option>`).join('');
    function exposures(){const r=cam?.range,all=r?EXPOSURES.filter(v=>v>=r[0]&&v<=r[1]):EXPOSURES;return ['auto',...all];}
    function controls(){const s=settings,cams=cameras(),names=cams.length?cams:configured();return `<div class="cal-field"><label for="cam-source">Camera</label><select id="cam-source" data-cam="source"${waiting()?' disabled':''}>${names.map(n=>`<option value="${esc(n)}"${source===n?' selected':''}>${esc(n)}</option>`).join('')}${names.length?'':`<option value="sim"${source==='sim'?' selected':''}>Simulated webcam</option>`}</select></div>
      <div class="cal-field"><label for="cam-rotate">Rotate the view</label><select id="cam-rotate" data-cam="rotate">${opts(ROTATIONS,s.rotate,v=>`${v}°`)}</select></div>
      <div class="cal-field"><label for="cam-exposure">Exposure</label><select id="cam-exposure" data-cam="exposure">${opts(exposures(),s.exposure,v=>v==='auto'?'Automatic':`${v} ms`)}</select></div>
      <div class="cal-field"><label for="cam-gain">Gain</label><select id="cam-gain" data-cam="gain"${s.exposure==='auto'?' disabled title="Gain can be set only with a manual exposure."':''}>${opts(GAINS,s.gain)}</select></div>
      <div class="cal-field"><label for="cam-decimation">Decimation</label><select id="cam-decimation" data-cam="decimation">${opts(DECIMATIONS,s.decimation,v=>({1:'1: farthest, slowest',2:'2: in between',3:'3: closest, fastest'}[v]))}</select></div>
      ${real()?'':`<div class="cal-field"><label for="cam-feet">Tag distance</label><select id="cam-feet" data-cam="feet">${opts(FEET,s.feet,v=>`${v} ft`)}</select></div><div class="cal-field"><label for="cam-moving">Robot</label><select id="cam-moving" data-cam="moving"><option value="0"${s.moving?'':' selected'}>Standing still</option><option value="1"${s.moving?' selected':''}>Driving</option></select></div>`}`;}
    function paint(){const cams=cameras(),r=real();if(r&&!cams.includes(source))source='sim';q('[data-cam-controls]').innerHTML=controls();
      q('[data-cam-note]').textContent=waiting()?'Your robot has a camera. Start live debug in the Debug tab to see it.':source==='sim'?'This is a simulated webcam: no camera or robot is needed, and its numbers are a model of the FTC docs, not a measurement.':cam?.error?`The camera did not start: ${cam.error}`:cam?`${cam.state||'Starting'}${Number.isFinite(cam.fps)?` · ${cam.fps.toFixed(0)} frames a second`:''}`:'Waiting for the camera…';
      q('[data-cam-tune]').disabled=!!tuning||waiting();q('[data-cam-result]').innerHTML=tuning?`<p class="hint" role="status">${esc(tuning)}</p>`:result?(result.none?`<p class="cal-debug-warn" role="status">${esc(result.none)}</p>`:`<p role="status">Best: exposure ${result.exposure} ms, gain ${result.gain}, decimation ${result.decimation}. It read the tag in ${Math.round(result.rate*100)}% of frames. These are set now.</p><p class="hint">To use them in your own code, after the camera is streaming:</p><pre class="cal-cam-code">${esc(javaLines(result))}</pre>`):'';
      view();listTags();}
    function listTags(){q('[data-cam-tags]').innerHTML=tags.length?tags.map(t=>`<li><b>Tag ${esc(t.id)}</b>${t.name?` ${esc(t.name)}`:''}${Number.isFinite(t.r)?` · ${t.r.toFixed(1)} in away, ${t.b.toFixed(0)}° to the side`:''}${Number.isFinite(t.m)?` · margin ${t.m.toFixed(0)}`:''}</li>`).join(''):'<li class="hint">No AprilTag in view.</li>';}
    function view(){const turn=settings.rotate,scale=turn%180?.75:1;for(const el of [q('[data-cam-canvas]'),q('[data-cam-image]')])el.style.transform=`rotate(${turn}deg) scale(${scale})`;q('[data-cam-canvas]').hidden=real();q('[data-cam-image]').hidden=!real();}
    // ---- the simulated view
    const seedBit=(i,j)=>((i*7+j*13+i*j*5+11)%5)<2;
    function draw(now){const s=settings,c=q('[data-cam-canvas]'),g=c.getContext('2d'),W=c.width,H=c.height,e=exposureOf(s),gain=gainOf(s),light=e*(1+gain/64),bright=Math.max(.08,Math.min(1.7,light/30)),blur=blurPixels(s),size=tagPixels(s.feet),x=W/2-size/2+(s.moving?70*Math.sin(now/500):0),y=H/2-size/2;
      g.filter='none';g.fillStyle='#6d7277';g.fillRect(0,0,W,H);g.filter=`blur(${Math.min(40,blur).toFixed(1)}px) brightness(${bright.toFixed(2)})`;g.fillStyle='#8d9196';g.fillRect(0,H*.62,W,H*.38);g.fillStyle='#fff';g.fillRect(x-size*.12,y-size*.12,size*1.24,size*1.24);g.fillStyle='#000';g.fillRect(x,y,size,size);g.fillStyle='#fff';for(let i=1;i<7;i++)for(let j=1;j<7;j++)if(seedBit(i,j))g.fillRect(x+i*size/8,y+j*size/8,size/8+.5,size/8+.5);g.filter='none';
      if(s.exposure!=='auto'&&gain>0){g.fillStyle='rgba(255,255,255,.35)';for(let i=0;i<gain*3;i++)g.fillRect(Math.random()*W,Math.random()*H,2,2);}
      const hit=Math.random()<simRate(s);tags=hit?[{id:584,name:'Simulated tag',r:s.feet*12,b:s.moving?Math.sin(now/500)*8:0,m:40+50*simRate(s)}]:[];hits.push(hit);if(hits.length>90)hits.shift();
      if(hit){g.strokeStyle='#3ddc84';g.lineWidth=4;g.strokeRect(x,y,size,size);g.fillStyle='#3ddc84';g.font='22px sans-serif';g.fillText('Tag 584',x,Math.max(24,y-size*.16));}listTags();}
    function frame(now){raf=0;if(!shown()||real())return;if(now-lastDraw>=1000/fpsOf(settings.decimation)){lastDraw=now;draw(now);}raf=requestAnimationFrame(frame);}
    // ---- a robot's camera
    const send=line=>debug?.send(line);
    function sendSettings(){if(!real())return;const s=settings;send(s.exposure==='auto'?'V\tauto':`V\t${s.exposure}\t${s.gain}`);send(`D\t${s.decimation}`);}
    function stream(on){if(streaming===on||!native||!api.robotLink)return;streaming=on;void api.robotLink('debug-camera',{on}).catch(()=>{});}
    function tick(){if(!shown()){stream(false);return;}const had=cameras().join();stream(real());if(!real()&&!raf&&!waiting())raf=requestAnimationFrame(frame);const known=had+'|'+configured().join();if(tick.cams!==known){tick.cams=known;if(had&&source==='sim'&&!tuning){source=cameras()[0];sendSettings();}paint();}}
    debug?.onCamera?.(bytes=>{if(!real()||!shown())return;const url=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));q('[data-cam-image]').src=url;if(camUrl)URL.revokeObjectURL(camUrl);camUrl=url;});
    debug?.listen?.(f=>{const c=f.cam;if(!c)return;const was=cam?.state+cam?.error;cam=c;if(real()){tags=c.tags||[];listTags();}if(was!==c.state+c.error)paint();});
    // ---- Find the best settings
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    async function measure(s){if(!real()){settings=s;return simRate(s);}settings=s;sendSettings();await wait(900);let n=0,hit=0;const off=debug.listen(f=>{if(f.cam){n++;if(f.cam.tags?.length)hit++;}});await wait(1500);off();return n?hit/n:0;}
    async function tune(){if(tuning)return;const keep=settings,r=cam?.range,gain=r?GAINS.filter(v=>v<=r[3]).at(-1):255,list=r?EXPOSURES.filter(v=>v>=r[0]&&v<=r[1]):EXPOSURES;result=null;tuning='Starting…';paint();let best=null,top=0;
      try{for(const exposure of list){tuning=`Trying exposure ${exposure} ms at gain ${gain}…`;q('[data-cam-result]').innerHTML=`<p class="hint" role="status">${esc(tuning)}</p>`;const s=sanitize({...keep,exposure,gain}),rate=await measure(s);top=Math.max(top,rate);if(!real())await wait(120);if(rate>=GOOD){best={exposure,gain,decimation:s.decimation,rate};break;}}
        tuning=null;if(best){settings=sanitize({...keep,exposure:best.exposure,gain:best.gain});result=best;}else{settings=keep;result={none:top?`It never read the tag reliably (best ${Math.round(top*100)}% of frames). Move the tag closer, or choose a lower decimation, then try again.`:'It never saw a tag. Point the camera at an AprilTag about as far away as you will use it, then try again.'};}
        sendSettings();remember();}
      finally{tuning=null;paint();}}
    host.innerHTML=`<h2>Camera</h2><p class="hint">See what a webcam sees, turn the view and tune AprilTag reading. To use a real webcam: plug it into the Control Hub, press Scan in Setup, add it in Configure, then start Live debug in the Debug tab.</p>
      <div class="cal-cam"><div class="cal-cam-view"><canvas data-cam-canvas width="640" height="480" aria-label="Simulated camera view"></canvas><img data-cam-image alt="Live camera view" hidden></div>
      <div class="cal-cam-side"><p class="hint" data-cam-note role="status"></p><div class="cal-fields" data-cam-controls></div><div class="button-row"><button type="button" class="primary" data-cam-tune>Find the best settings</button></div><p class="hint">Hold a tag where the robot will see it. This raises exposure from the lowest until tags read reliably, which keeps a moving tag sharpest.</p><div data-cam-result></div><h3 class="cal-group-title">AprilTags in view</h3><ul class="cal-cam-tags" data-cam-tags></ul></div></div>`;
    q('[data-cam-controls]').addEventListener('change',e=>{const k=e.target.dataset.cam;if(!k)return;result=null;if(k==='source'){source=e.target.value;tags=[];cam=real()?cam:null;tick.chosen=true;stream(real());sendSettings();}else{const v=e.target.value;settings=sanitize({...settings,[k]:k==='moving'?v==='1':k==='exposure'&&v==='auto'?'auto':+v});remember();if(['exposure','gain','decimation'].includes(k))sendSettings();}paint();tick();});
    q('[data-cam-tune]').onclick=()=>void tune();
    paint();timer=setInterval(tick,500);
    return {refresh:()=>{paint();tick();},settings:()=>settings,stop(){clearInterval(timer);stream(false);}};}
  return {create,sanitize,simRate,pick,rangeFeet,fpsOf,javaLines,simFrame,blurPixels,DEFAULTS,EXPOSURES,GAINS};
});
