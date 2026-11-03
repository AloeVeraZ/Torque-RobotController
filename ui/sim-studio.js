(function(){
  'use strict';
  // The Video tab: a recorded run, edited into a video. The run is kept as its recorded frames, so any moment of it can
  // be seen through any of the six cameras; the edit (sim-edit.js) says which camera shows which part, with titles,
  // speed changes, freeze frames and transitions, and Export draws it picture by picture into an MP4 or WebM file
  // (sim-encode.js). The preview and the export draw the same pictures, so what plays here is what is saved.
  const E=window.DeckEdit,K=window.DeckCameras,N=window.DeckEncode,V=window.DeckSimVideo;
  // A video ends on this card unless it is removed (Words on the video): "Edited with Torque" fades in over its last END_CARD seconds.
  const BRAND='Torque',END_CARD=2.5;
  const CAMS=[...K.CAMERAS,{id:'top',name:'Top-down',label:'Top-down · whole field',key:'6',color:'#8a94a3',hint:'Straight down at the whole field, the way 2D recordings film it.'}],CAM=Object.fromEntries(CAMS.map(c=>[c.id,c]));
  const OVERLAYS={match:'Period, clock & points',velocity:'Speed & what the robot is doing',path:'Field map in the corner',camera:'Camera name',position:'Position & heading',timestamp:'Run time'};
  const SPEEDS={0.25:'¼× (slow motion)',0.5:'½×',1:'1× (real speed)',1.5:'1.5×',2:'2×',4:'4×'};
  const SIZES={'1280x720':'1280 × 720 (720p)','1920x1080':'1920 × 1080 (1080p)'},HEAD=96,FONT='system-ui, "Segoe UI", sans-serif';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const options=(list,value)=>Object.entries(list).map(([k,v])=>`<option value="${k}"${String(k)===String(value)?' selected':''}>${esc(v)}</option>`).join('');
  const editing=el=>el?.closest?.('input,textarea,select,[contenteditable=true]');
  // The app's content security policy blocks style attributes in markup, so positions and colours written as
  // data-css are applied through the style object instead.
  const css=box=>{for(const el of box.querySelectorAll('[data-css]'))for(const rule of el.dataset.css.split(';')){const i=rule.indexOf(':');if(i>0)el.style.setProperty(rule.slice(0,i).trim(),rule.slice(i+1).trim());}};
  const wrapAngle=a=>Math.atan2(Math.sin(a),Math.cos(a));

  // opts: host (the tab panel), camera() resolves with a run-video camera (sim-3d.js, video: true),
  // save(bytes, ext, name) and saveOriginal() resolve with what happened, discard() drops the recording.
  function create(opts){
    const host=opts.host;
    host.innerHTML=`<div class="studio-head">
        <div class="studio-name"><input id="studio-name" maxlength="80" aria-label="Video name" spellcheck="false"><label class="studio-part" id="studio-part-box" title="A full match can be edited whole, or just its autonomous or teleop; each keeps its own edit" hidden>Part<select id="studio-part"></select></label><span id="studio-meta" class="hint"></span></div>
        <div class="studio-head-actions">
          <button type="button" class="secondary" id="studio-undo" title="Undo (Ctrl+Z)">Undo</button><button type="button" class="secondary" id="studio-redo" title="Redo (Ctrl+Shift+Z)">Redo</button>
          <button type="button" class="secondary" id="studio-discard" title="Throw away this recording">Discard</button>
          <progress id="studio-progress" max="1" value="0" hidden></progress><button type="button" class="primary" id="studio-save" title="Save the video as a file, with any changes made here">Save video…</button></div></div>
      <div class="studio-body">
        <div class="studio-viewer"><div class="studio-screen" id="studio-screen"><canvas id="studio-canvas" width="960" height="540" aria-label="Video preview"></canvas><p class="studio-loading" id="studio-loading">Getting the cameras ready…</p></div>
          <div class="studio-transport">
            <button type="button" class="secondary" id="studio-start" title="Go to the start (Home)" aria-label="Go to the start">⏮</button><button type="button" class="secondary" id="studio-back" title="Back one frame (←, Shift+← one second)" aria-label="Back one frame">◂</button>
            <button type="button" class="primary" id="studio-play" title="Play or pause (Space)">Play</button>
            <button type="button" class="secondary" id="studio-fwd" title="Forward one frame (→, Shift+→ one second)" aria-label="Forward one frame">▸</button><button type="button" class="secondary" id="studio-end" title="Go to the end (End)" aria-label="Go to the end">⏭</button>
            <output id="studio-time" class="studio-time"></output><p id="studio-status" class="studio-status hint" role="status"></p></div></div>
        <aside class="studio-side" aria-label="Video settings">
          <div class="studio-side-tabs" role="tablist" aria-label="Video settings"><button type="button" role="tab" data-sidetab="clip" hidden>Clip</button><button type="button" role="tab" data-sidetab="cameras">Camera</button><button type="button" role="tab" data-sidetab="tune">Adjust</button><button type="button" role="tab" data-sidetab="moments">Moments</button><button type="button" role="tab" data-sidetab="look">Text</button><button type="button" role="tab" data-sidetab="export">File</button></div>
          <section class="studio-pane studio-clip-pane" data-side="clip" hidden></section>
          <section class="studio-pane" data-side="cameras"></section>
          <section class="studio-pane" data-side="tune" hidden><div id="studio-tune-body"></div></section>
          <section class="studio-pane" data-side="moments" hidden></section>
          <section class="studio-pane" data-side="look" hidden></section>
          <section class="studio-pane" data-side="export" hidden></section></aside></div>
      <div class="studio-timeline">
        <div class="studio-tools" role="toolbar" aria-label="Edit">
          <button type="button" class="secondary" data-act="split" title="Cut the clip under the red line in two (S)">Split</button><button type="button" class="secondary" data-act="remove" title="Delete the chosen clip (Delete)">Delete</button>
          <button type="button" class="secondary" data-act="title" title="Put words on the video at the red line (T)">+ Text</button>
          <button type="button" class="secondary" id="studio-more" aria-expanded="false" title="Freeze frame, picture in picture and more">More tools</button>
          <span class="studio-more" id="studio-more-tools" hidden><button type="button" class="secondary" data-act="duplicate" title="Copy the chosen clip (Ctrl+D)">Copy</button><button type="button" class="secondary" data-act="freeze" title="Hold the picture at the red line for 2 seconds (F)">Freeze</button>
            <button type="button" class="secondary" data-act="pip" title="Show a second camera small in a corner (P)">+ Corner camera</button><span class="studio-sep" aria-hidden="true"></span>
            <button type="button" class="secondary" data-act="in" title="Save only from the red line (I)">Start here</button><button type="button" class="secondary" data-act="out" title="Save only up to the red line (O)">End here</button><button type="button" class="secondary" data-act="clear-range" title="Save the whole video">Whole video</button></span>
          <span class="studio-spacer" aria-hidden="true"></span>
          <button type="button" class="secondary" data-act="zoom-out" title="Zoom out (Ctrl+wheel)" aria-label="Zoom out">−</button><button type="button" class="secondary" data-act="fit" title="Fit the whole video">Fit</button><button type="button" class="secondary" data-act="zoom-in" title="Zoom in (Ctrl+wheel)" aria-label="Zoom in">+</button></div>
        <div class="studio-scroll" id="studio-scroll"><div class="studio-tracks" id="studio-tracks"></div></div></div>`;
    const $=s=>host.querySelector(s),$$=s=>[...host.querySelectorAll(s)];
    const canvas=$('#studio-canvas'),pctx=canvas.getContext('2d'),scroll=$('#studio-scroll'),tracks=$('#studio-tracks'),screen=$('#studio-screen');
    const pane=k=>$(`[data-side="${k}"]`);for(const b of $$('[data-sidetab]'))b.onclick=()=>showSide(b.dataset.sidetab);
    let take=null,editor=null,paths={},pathKeys={},trail=null,events=[],selected=new Set(),t=0,playing=false,pps=40,cam=null,shown=false,exporting=null,side='cameras',lastTick=0,lastPaint=0,raf=0,drawQueued=false,formats=null,formatKey='',discardArmed=0,focusSnap=null;
    const lanes=E.TRACKS.filter(x=>x.kind!=='audio'),NAMES={T1:'Text',V2:'Corner',V1:'Camera'};
    const say=text=>{$('#studio-status').textContent=text||'';};
    const duration=()=>editor?Math.max(E.MIN,E.duration(editor.doc)):0;

    // ------------------------------------------------------------ the recorded run
    // The run frame at a time of the recording (seconds from its start), between the two recorded frames around it
    // so slow motion glides rather than steps.
    function frameAt(src){
      const F=take.frames,time=take.t0+src,i=K.indexAt(F,time),a=F[i],b=F[Math.min(F.length-1,i+1)],span=b.time-a.time,k=span>0?clamp((time-a.time)/span,0,1):0;
      if(k<.02||!a.truth||!b.truth)return {f:a,i};const A=a.truth,B=b.truth,mix=(x,y)=>Number.isFinite(x)&&Number.isFinite(y)?x+(y-x)*k:x;
      const truth={...A,x:mix(A.x,B.x),y:mix(A.y,B.y),z:mix(A.z,B.z),heading:A.heading+wrapAngle((B.heading-A.heading)*Math.PI/180)*180/Math.PI*k};
      const m=a.mechanisms&&b.mechanisms?{...a.mechanisms,turret:mix(a.mechanisms.turret,b.mechanisms.turret),turrets:a.mechanisms.turrets?.map((v,n)=>mix(v,b.mechanisms.turrets?.[n])),ramps:a.mechanisms.ramps?.map((v,n)=>mix(v,b.mechanisms.ramps?.[n]))}:a.mechanisms;
      return {f:{...a,time,truth,mechanisms:m},i};
    }
    // The path behind the robot up to frame i, growing in steps of six frames so the 3D overlay is rebuilt rarely.
    const trailAt=i=>trail.points.slice(0,trail.count[i-(i%6)]);
    function buildTrail(F){const points=[],count=new Array(F.length);let last=null;
      F.forEach((f,i)=>{const p=f.truth;if(p&&(!last||Math.hypot(last.x-p.x,last.y-p.y)>.4)){points.push({x:p.x,y:p.y,e:null});last=p;}count[i]=points.length;});return {points,count};}
    // Camera paths follow the camera settings in the edit, so undo puts a camera back too. A camera's path is worked
    // out when it is first shown (or in a quiet moment after the recording opens), and again only when its own
    // settings change: keeping clear of the field takes a moment per camera.
    function track(id){if(!K.IDS.includes(id))id='main';const cfg=K.settings(editor.doc.cameras)[id],key=JSON.stringify(cfg);
      if(pathKeys[id]!==key){pathKeys[id]=key;paths[id]=K.path(id,take.frames,take.ctx,cfg);}return paths[id];}
    function warmPaths(){const idle=f=>window.requestIdleCallback?requestIdleCallback(f,{timeout:400}):setTimeout(f,60),next=()=>{if(!editor)return;const id=K.IDS.find(x=>pathKeys[x]!==JSON.stringify(K.settings(editor.doc.cameras)[x]));if(id){track(id);idle(next);}};idle(next);}

    // ------------------------------------------------------------ drawing a picture
    function pill(ctx,x,y,w,h,fill){ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,y,w,h,h*.22);else ctx.rect(x,y,w,h);ctx.fillStyle=fill;ctx.fill();}
    function chip(ctx,text,x,y,u,{align='left',size=16,weight=600,fill='rgb(13 15 18 / .72)'}={}){
      ctx.font=`${weight} ${size*u}px ${FONT}`;const h=(size+18)*u,w=ctx.measureText(text).width+28*u,left=align==='right'?x-w:align==='center'?x-w/2:x;
      pill(ctx,left,y,w,h,fill);ctx.fillStyle='#e8ecf1';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(text,left+14*u,y+h/2);return h;}
    // The writing over the main picture: the period, clock and points as the original recordings have them, and
    // whatever else the Overlays tab turns on.
    function drawOverlays(ctx,W,H,lead,o){
      const u=H/720,pad=18*u,h=42*u,f=lead.f;ctx.save();ctx.textBaseline='middle';let top=pad;
      if(o.match){const c=V.caption(f,{name:editor.doc.name,start:take.t0}),phase=c.phase.toUpperCase();
        ctx.font=`600 ${14*u}px ${FONT}`;const pw=ctx.measureText(phase).width;ctx.font=`700 ${22*u}px ${FONT}`;const tw=ctx.measureText(c.time).width;
        pill(ctx,pad,pad,pw+tw+44*u,h,c.color);ctx.fillStyle='#fff';ctx.textAlign='left';ctx.font=`600 ${14*u}px ${FONT}`;ctx.fillText(phase,pad+16*u,pad+h/2);ctx.font=`700 ${22*u}px ${FONT}`;ctx.fillText(c.time,pad+28*u+pw,pad+h/2);
        const right=[c.name,c.score].filter(Boolean).join('  ·  ');if(right)chip(ctx,right,W-pad,pad,u,{align:'right',size:17});top+=h+8*u;}
      if(o.camera)top+=chip(ctx,CAM[lead.camera].label,pad,top,u,{size:14})+8*u;
      if(o.timestamp)chip(ctx,`Run ${(f.time-take.t0).toFixed(1)} s`,W/2,pad,u,{align:'center',size:16,weight:700});
      let bottom=H-pad;
      if(o.velocity){const d=V.detail(f);if(d){const ch=(16+18)*u;bottom-=ch;chip(ctx,d,pad,bottom,u);bottom-=8*u;}}
      if(o.position&&f.truth){const p=f.truth,ch=(14+18)*u;bottom-=ch;chip(ctx,`x ${p.x.toFixed(1)} in · y ${p.y.toFixed(1)} in · ${Math.round(((p.heading%360)+360)%360)}°`,pad,bottom,u,{size:14});}
      if(lead.inset){const r=lead.inset;ctx.beginPath();if(ctx.roundRect)ctx.roundRect(r.x,r.y,r.size,r.size,6*u);else ctx.rect(r.x,r.y,r.size,r.size);ctx.lineWidth=3*u;ctx.strokeStyle='rgb(232 236 241 / .85)';ctx.stroke();}
      ctx.restore();
    }
    // ------------------------------------------------------------ contact replays
    // A contact replay holds the picture where the robot touched something and zooms in on the spot (k: 0 not at all,
    // 1 all the way). A 3D camera moves from its own pose to one about 40 in from the contact, looking down at it from
    // the side the camera was on; the top-down picture is enlarged 3× round the contact instead.
    const lerp=(a,b,k)=>a+(b-a)*k,CLOSE=40,TOP_ZOOM=3,RING=7;
    function closeUp(pose,focus,k){
      const dx=focus.x-pose.p[0],dy=focus.y-pose.p[1],d=Math.hypot(dx,dy)||1,near={p:[focus.x-dx/d*CLOSE*.7,focus.y-dy/d*CLOSE*.7,CLOSE*.75],l:[focus.x,focus.y,2],fov:50};
      return {p:pose.p.map((v,n)=>lerp(v,near.p[n],k)),l:pose.l.map((v,n)=>lerp(v,near.l[n],k)),fov:lerp(pose.fov,near.fov,k)};
    }
    // Where a field point (inches, z up) lands in a W×H picture from a camera pose, and how many pixels RING inches
    // are there; null behind the camera.
    function project(pose,q,W,H){
      const sub=(a,b)=>a.map((v,n)=>v-b[n]),dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
      const fw=unit(sub(pose.l,pose.p)),right=unit(cross(fw,[0,0,1])),up=cross(right,fw),d=sub(q,pose.p),z=dot(d,fw);if(z<=1)return null;
      const px=H/2/Math.tan(pose.fov*Math.PI/360)/z;return {x:W/2+dot(d,right)*px,y:H/2-dot(d,up)*px,r:RING*px};
    }
    // The top-down picture fitted the way sim-3d.js fits it (the field's bounds, 6% margin), enlarged round the contact.
    function topZoom(focus,k,W,H){
      const b=take.state?.info?.bounds||{x0:0,y0:0,x1:144,y1:144},a=W/H,hh=Math.max((b.y1-b.y0)/2,(b.x1-b.x0)/2/a)*1.06,px=H/2/hh;
      const sx=W/2+(focus.x-(b.x0+b.x1)/2)*px,sy=H/2-(focus.y-(b.y0+b.y1)/2)*px,scale=lerp(1,TOP_ZOOM,k),cx=lerp(W/2,sx,k),cy=lerp(H/2,sy,k);
      return {scale,x:W/2-cx*scale,y:H/2-cy*scale,at:{x:W/2+(sx-cx)*scale,y:H/2+(sy-cy)*scale},r:RING*px*scale};
    }
    // The red mark on the contact (a dot, a ring and a ring pulsing out from it) and what was touched, with when.
    function drawCrash(ctx,W,H,c,time){
      const u=H/720,u0=time-c.clip.start,show=clamp(u0/.3,0,1)*clamp((E.len(c.clip)-u0)/.3,0,1)*c.alpha;if(show<=0)return;ctx.save();ctx.globalAlpha=show;
      if(c.at){const r=clamp(c.r||20*u,14*u,90*u),pulse=(u0%1.1)/1.1;ctx.strokeStyle=E.CRASH_COLOR;ctx.fillStyle=E.CRASH_COLOR;
        ctx.lineWidth=4*u;ctx.beginPath();ctx.arc(c.at.x,c.at.y,r,0,Math.PI*2);ctx.stroke();
        ctx.globalAlpha=show*(1-pulse)*.9;ctx.lineWidth=3*u;ctx.beginPath();ctx.arc(c.at.x,c.at.y,r*(1+pulse*1.2),0,Math.PI*2);ctx.stroke();
        ctx.globalAlpha=show;ctx.beginPath();ctx.arc(c.at.x,c.at.y,Math.max(4*u,r*.18),0,Math.PI*2);ctx.fill();}
      const line=`Contact with ${c.focus.label} at ${c.focus.at.toFixed(1)} s`;ctx.font=`700 ${20*u}px ${FONT}`;const w=ctx.measureText(line).width+40*u,h=46*u,y=H-140*u;
      pill(ctx,W/2-w/2,y,w,h,'rgb(178 34 40 / .92)');ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(line,W/2,y+h/2);
      ctx.restore();
    }
    // Text sized down until it fits the width it has.
    function fit(ctx,text,weight,size,max){let s=size;do{ctx.font=`${weight} ${s}px ${FONT}`;s*=.92;}while(ctx.measureText(text).width>max&&s>8);}
    function drawTitle(ctx,W,H,c,alpha){
      const u=H/720;ctx.save();ctx.globalAlpha=clamp(alpha,0,1);ctx.textBaseline='middle';ctx.textAlign='center';
      if(c.style==='title'){ctx.fillStyle='rgb(0 0 0 / .5)';ctx.fillRect(0,H*.34,W,H*.32);ctx.fillStyle='#fff';fit(ctx,c.text,800,64*u,W*.88);ctx.fillText(c.text,W/2,H*(c.sub?.465:.5));
        if(c.sub){ctx.fillStyle='#d6dbe2';fit(ctx,c.sub,500,28*u,W*.85);ctx.fillText(c.sub,W/2,H*.575);}}
      else if(c.style==='lower'){const x=48*u,y=H*.7,w=Math.min(W*.6,W-2*x),h=(c.sub?96:64)*u;ctx.fillStyle='rgb(13 15 18 / .82)';ctx.fillRect(x,y,w,h);ctx.fillStyle='#4ea1ff';ctx.fillRect(x,y,6*u,h);
        ctx.textAlign='left';ctx.fillStyle='#fff';fit(ctx,c.text,700,30*u,w-44*u);ctx.fillText(c.text,x+24*u,y+(c.sub?34:32)*u);if(c.sub){ctx.fillStyle='#c5ccd6';fit(ctx,c.sub,500,20*u,w-44*u);ctx.fillText(c.sub,x+24*u,y+70*u);}}
      else if(c.style==='caption'){const line=[c.text,c.sub].filter(Boolean).join(' — ');fit(ctx,line,600,26*u,W*.8);const w=ctx.measureText(line).width+40*u,h=48*u,y=H-110*u;pill(ctx,W/2-w/2,y,w,h,'rgb(0 0 0 / .72)');ctx.fillStyle='#fff';ctx.fillText(line,W/2,y+h/2);}
      else{const line=[c.text,c.sub].filter(Boolean).join(' · ');chip(ctx,line,W-18*u,H*.12,u,{align:'right',size:18,weight:700,fill:'rgb(78 161 255 / .85)'});}
      ctx.restore();
    }
    // The edit's picture at edit time `time`, drawn into ctx (W×H): the video tracks bottom to top, the overlays,
    // fades and dips to black, then the titles.
    function paint(ctx,W,H,time){
      const doc=editor.doc,r=E.resolve(doc,time);ctx.save();ctx.globalAlpha=1;ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
      let lead=null;if(cam)cam.size(W,H);
      let crash=null;
      for(const l of r.layers){if(!cam)break;const {f,i}=frameAt(l.source),shot={rect:[0,0,W,H]},focus=!l.pip&&l.clip.focus,k=focus?E.crashZoom(l.clip,time):0;
        if(l.camera==='top')shot.top=true;else{shot.pose=K.poseAt(track(l.camera),take.frames,take.t0+l.source);shot.inset=!!doc.overlays.path&&!l.pip;if(focus)shot.pose=closeUp(shot.pose,focus,k);}
        const pic=cam.picture(f,{...take.state,frame:f,trail:trailAt(i)},[shot]);ctx.globalAlpha=clamp(l.alpha*(l.fade??1),0,1);
        if(focus){crash={clip:l.clip,focus,alpha:ctx.globalAlpha};if(l.camera==='top'){const z=topZoom(focus,k,W,H);ctx.drawImage(pic,0,0,pic.width,pic.height,z.x,z.y,W*z.scale,H*z.scale);crash.at=z.at;crash.r=z.r;}
          else{ctx.drawImage(pic,0,0,W,H);const p=project(shot.pose,[focus.x,focus.y,3],W,H);crash.at=p;crash.r=p?.r;}lead={f,camera:l.camera,inset:l.camera==='top'?null:shot.insetRect||null};}
        else if(l.pip){const w=Math.round(W*.34),h=Math.round(w*H/W),m=Math.round(H*.03),x=W-w-m,y=Math.round(H*.12);ctx.drawImage(pic,x,y,w,h);ctx.lineWidth=Math.max(2,H/300);ctx.strokeStyle='rgb(232 236 241 / .9)';ctx.strokeRect(x,y,w,h);}
        else{ctx.drawImage(pic,0,0,W,H);lead={f,camera:l.camera,inset:shot.insetRect||null};}}
      ctx.globalAlpha=1;if(lead)drawOverlays(ctx,W,H,lead,doc.overlays);if(crash)drawCrash(ctx,W,H,crash,time);
      if(r.black>0){ctx.fillStyle=`rgb(0 0 0 / ${clamp(r.black,0,1)})`;ctx.fillRect(0,0,W,H);}
      for(const ti of r.titles)drawTitle(ctx,W,H,ti.clip,ti.alpha);
      const left=E.exportRange(doc).out-time;if(doc.endCard!==false&&left<END_CARD)drawEndCard(ctx,W,H,clamp((END_CARD-left)/.6,0,1));
      ctx.restore();
    }
    function drawEndCard(ctx,W,H,alpha){const s=H/720,font=(w,px)=>`${w} ${Math.round(px*s)}px Inter, "Segoe UI", system-ui, sans-serif`;ctx.save();ctx.globalAlpha=alpha;
      ctx.fillStyle='rgb(8 10 14 / .8)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';ctx.textBaseline='alphabetic';
      ctx.fillStyle='#9aa3ad';ctx.font=font(600,26);ctx.fillText('Edited with',W/2,H/2-24*s);ctx.fillStyle='#f2f4f7';ctx.font=font(800,72);ctx.fillText(BRAND,W/2,H/2+46*s);
      ctx.fillStyle='#9aa3ad';ctx.font=font(500,22);if(editor.doc.name)ctx.fillText(editor.doc.name,W/2,H/2+96*s);ctx.restore();}
    function drawNow(){if(!take||!shown||exporting)return;lastPaint=performance.now();try{paint(pctx,canvas.width,canvas.height,t);}catch(e){console.error(e);say(e.message);}}
    function requestDraw(){if(drawQueued)return;drawQueued=true;requestAnimationFrame(()=>{drawQueued=false;drawNow();});}
    // The preview is drawn at the size it shows (up to 1280 wide), so a small window stays quick.
    // The preview is the video's own shape against the left edge, and the settings take the rest of the width: no black
    // bars beside the picture (narrow windows stack them instead).
    const body=$('.studio-body'),transportBar=$('.studio-transport');new ResizeObserver(()=>{if(innerWidth<=900){body.style.gridTemplateColumns='';return;}
      const h=body.clientHeight-transportBar.offsetHeight-6,w=Math.max(320,Math.min(body.clientWidth-300-12,h*16/9));body.style.gridTemplateColumns=`${Math.floor(w)}px minmax(300px,1fr)`;}).observe(body);
    new ResizeObserver(()=>{const w=Math.round(clamp(Math.min(screen.clientWidth,screen.clientHeight*16/9)*Math.min(devicePixelRatio||1,1.5),320,1280));if(Math.abs(w-canvas.width)>8){canvas.width=w;canvas.height=Math.round(w*9/16);requestDraw();}}).observe(screen);

    // ------------------------------------------------------------ playing
    function setTime(next,{follow=true}={}){t=clamp(next,0,duration());clock();playhead(follow);requestDraw();if(side==='cameras')cameraMarks();}
    function clock(){$('#studio-time').textContent=`${E.timecode(t)} / ${E.timecode(duration())}`;}
    function play(){if(playing||!take)return;const end=editor.doc.range?E.exportRange(editor.doc).out:duration();if(t>=end-1e-3)t=editor.doc.range?E.exportRange(editor.doc).in:0;playing=true;lastTick=performance.now();transport();raf=requestAnimationFrame(tick);}
    function pause(){if(!playing)return;playing=false;cancelAnimationFrame(raf);transport();requestDraw();if(side==='cameras')cameraMarks();}
    // Playing draws at most 30 pictures a second: the same rate as the export, and half the work of every frame.
    function tick(now){
      if(!playing)return;t+=(now-lastTick)/1000;lastTick=now;const end=editor.doc.range?E.exportRange(editor.doc).out:duration();
      if(t>=end){t=end;playing=false;transport();}
      clock();playhead(true);if(now-lastPaint>=31||!playing)drawNow();if(playing)raf=requestAnimationFrame(tick);
    }
    function transport(){$('#studio-play').textContent=playing?'Pause':'Play';$('#studio-play').setAttribute('aria-pressed',String(playing));}

    // ------------------------------------------------------------ timeline
    const laneLeft=()=>tracks.getBoundingClientRect().left+HEAD;
    const xTime=x=>(x-laneLeft())/pps;
    function rulerStep(){return [.25,.5,1,2,5,10,15,30,60].find(s=>s*pps>=56)||60;}
    function clipLabel(c){
      if(c.kind==='text')return c.text||'Title';const cam=CAM[c.camera]?.name||c.camera;
      if(c.focus)return `Contact replay · ${c.focus.label}`;
      return c.freeze?`${cam} · freeze`:`${cam}${c.speed!==1?` · ${c.speed}×`:''}${c.pip?' · corner':''}`;
    }
    function timeline(){
      if(!editor)return;const doc=editor.doc,D=Math.max(duration(),take.duration)+3,width=Math.ceil(D*pps),step=rulerStep();
      tracks.style.width=`${HEAD+width}px`;tracks.style.setProperty('--pps',pps);
      const ticks=[];for(let s=0;s<=D;s+=step)ticks.push(`<span class="studio-tick${Math.abs(s/(step*2)-Math.round(s/(step*2)))<1e-6?' major':''}" data-css="left:${(s*pps).toFixed(1)}px">${Math.abs(s/(step*2)-Math.round(s/(step*2)))<1e-6?E.timecode(s).replace(/\.\d+$/,''):''}</span>`);
      const range=doc.range?`<span class="studio-range" data-css="left:${(doc.range.in*pps).toFixed(1)}px;width:${((doc.range.out-doc.range.in)*pps).toFixed(1)}px" title="Exported part"></span>`:'';
      const rows=lanes.filter(track=>track.id!=='V2'||E.onTrack(doc,'V2').length).map(track=>{const tr=doc.tracks.find(x=>x.id===track.id),clips=E.onTrack(doc,track.id).map(c=>{const x=c.start*pps,w=Math.max(3,E.len(c)*pps);
          const color=c.kind==='text'?'#d9cfb8':c.focus?E.CRASH_COLOR:CAM[c.camera]?.color||'#888',fx=c.kind==='video'&&c.transition!=='cut'?`<span class="studio-fx" title="${esc(E.TRANSITIONS[c.transition])}"></span>`:'';
          return `<div class="studio-clip${selected.has(c.id)?' selected':''}${c.kind==='text'?' text':''}" data-id="${c.id}" data-css="left:${x.toFixed(1)}px;width:${w.toFixed(1)}px;--c:${color}" title="${esc(clipLabel(c))} · ${E.timecode(c.start)} to ${E.timecode(E.end(c))}">${fx}<span class="studio-trim l" aria-hidden="true"></span><span class="studio-clip-name">${esc(clipLabel(c))}</span><span class="studio-trim r" aria-hidden="true"></span></div>`;}).join('');
        return `<div class="studio-row${tr.hidden?' off':''}" data-track="${track.id}"><div class="studio-headcell"><span>${NAMES[track.id]}</span></div><div class="studio-lane" data-lane="${track.id}">${clips}</div></div>`;}).join('');
      const marks=doc.markers.map(m=>`<span class="studio-mark" data-css="left:${(m.t*pps).toFixed(1)}px;--c:${m.color}" title="${esc(m.label)} · ${E.timecode(m.t)}"></span>`).join('');
      tracks.innerHTML=`<div class="studio-row studio-ruler-row"><div class="studio-headcell studio-corner">${E.timecode(duration())}</div><div class="studio-ruler" title="Click or drag to move the red line">${range}${ticks.join('')}${marks}</div></div>${rows}<div class="studio-playhead" id="studio-playhead" aria-hidden="true"></div>`;css(tracks);
      playhead(false);
    }
    function playhead(follow){
      const p=$('#studio-playhead');if(!p)return;const x=HEAD+t*pps;p.style.transform=`translateX(${x.toFixed(1)}px)`;
      if(follow){const view=scroll.scrollLeft,w=scroll.clientWidth;if(x<view+HEAD||x>view+w-24)scroll.scrollLeft=Math.max(0,x-HEAD-w*.2);}
    }
    function fitZoom(){if(!take)return;pps=clamp((scroll.clientWidth-HEAD-24)/Math.max(1,duration()+.5),4,400);timeline();}
    function zoom(k,anchor){const at=anchor??t,x=HEAD+at*pps-scroll.scrollLeft;pps=clamp(pps*k,4,400);timeline();scroll.scrollLeft=Math.max(0,HEAD+at*pps-x);}
    // Snapping: clip edges, the playhead and the run's moments pull a dragged time to them within 8 pixels.
    function snap(time,skip){
      const near=[0,t,...events.map(e=>e.t)];for(const c of editor.doc.clips)if(!skip.includes(c.id))near.push(c.start,E.end(c));
      let best=time,d=8/pps;for(const s of near)if(Math.abs(s-time)<d){d=Math.abs(s-time);best=s;}return best;
    }
    function laneAt(y){for(const lane of $$('.studio-lane')){const r=lane.getBoundingClientRect();if(y>=r.top&&y<=r.bottom)return lane.dataset.lane;}return null;}
    tracks.addEventListener('pointerdown',e=>{
      if(!editor||e.button!==0||exporting)return;
      const clipEl=e.target.closest('.studio-clip'),onRuler=!!e.target.closest('.studio-ruler'),lane=e.target.closest('.studio-lane');
      if(!clipEl){if(!onRuler&&!lane)return;if(lane&&!onRuler&&selected.size){selected.clear();refresh();}
        pause();tracks.setPointerCapture?.(e.pointerId);const go=ev=>setTime(xTime(ev.clientX),{follow:false});go(e);
        const up=()=>{tracks.removeEventListener('pointermove',go);tracks.removeEventListener('pointerup',up);tracks.removeEventListener('pointercancel',up);};
        tracks.addEventListener('pointermove',go);tracks.addEventListener('pointerup',up);tracks.addEventListener('pointercancel',up);return;}
      e.preventDefault();const id=clipEl.dataset.id,edge=e.target.classList.contains('l')?'start':e.target.classList.contains('r')?'end':null;
      if(edge||!(e.shiftKey||e.ctrlKey||e.metaKey)){if(edge||!selected.has(id))selected=new Set([id]);}else{if(selected.has(id))selected.delete(id);else selected.add(id);}
      const snapDoc=JSON.stringify(editor.doc),clip0=editor.doc.clips.find(c=>c.id===id),ids=[...selected],x0=e.clientX;let moved=false,apply=null;
      tracks.setPointerCapture?.(e.pointerId);refresh();
      const move=ev=>{const dx=ev.clientX-x0,target=laneAt(ev.clientY),other=!edge&&target&&target!==clip0.track&&ids.length===1&&E.TRACKS.find(x=>x.id===target)?.kind===clip0.kind?target:null;
        if(!moved&&Math.abs(dx)<4&&!other)return;moved=true;editor.doc=JSON.parse(snapDoc);
        if(edge){const tt=snap((edge==='start'?clip0.start:E.end(clip0))+dx/pps,[id]);apply=d=>E.ops.trim(d,id,edge,tt,{ripple:ev.altKey});}
        else{const s=snap(Math.max(0,clip0.start+dx/pps),ids),dt=s-clip0.start;apply=d=>E.ops.move(d,ids,dt,other?(c=>c.id===id?other:null):null);}
        apply(editor.doc);timeline();requestDraw();};
      const up=()=>{tracks.removeEventListener('pointermove',move);tracks.removeEventListener('pointerup',up);tracks.removeEventListener('pointercancel',up);
        editor.doc=JSON.parse(snapDoc);if(moved&&apply)editor.change(edge?'Trim clip':'Move clip',apply);else{if(!edge&&!(e.shiftKey||e.ctrlKey||e.metaKey))setTime(xTime(x0),{follow:false});refresh();}};
      tracks.addEventListener('pointermove',move);tracks.addEventListener('pointerup',up);tracks.addEventListener('pointercancel',up);
    });
    tracks.addEventListener('dblclick',e=>{const c=e.target.closest('.studio-clip');if(c){selected=new Set([c.dataset.id]);showSide('clip');}});
    scroll.addEventListener('wheel',e=>{if(!(e.ctrlKey||e.metaKey))return;e.preventDefault();zoom(e.deltaY<0?1.2:1/1.2,xTime(e.clientX));},{passive:false});

    // ------------------------------------------------------------ edits
    const one=()=>selected.size===1?editor.doc.clips.find(c=>c.id===[...selected][0])||null:null;
    function act(name,shift=false){
      if(!editor||exporting)return;const doc=editor.doc,ids=[...selected];
      if(name==='split'){const sel=ids.map(id=>doc.clips.find(c=>c.id===id)).filter(c=>c&&c.start<t&&E.end(c)>t),tracksTo=sel.length?[...new Set(sel.map(c=>c.track))]:undefined;
        const made=editor.change('Split',d=>E.ops.splitAt(d,t,tracksTo));say(made?.length?`Split at ${E.timecode(t)}. Click a part to change its camera, or Delete it.`:'Move the red line over a clip to split it.');}
      else if(name==='remove'){if(!ids.length)return say('Click a clip in the timeline first.');editor.change(shift?'Delete and close the gap':'Delete',d=>E.ops.remove(d,ids,{ripple:shift}));selected.clear();refresh();}
      else if(name==='duplicate'){if(!ids.length)return say('Click a clip in the timeline first.');const made=editor.change('Duplicate',d=>E.ops.duplicate(d,ids));if(made?.length){selected=new Set(made);refresh();}}
      else if(name==='freeze'){const id=editor.change('Freeze frame',d=>E.ops.freeze(d,t,2,'V1'));if(id){selected=new Set([id]);refresh();say('The picture holds for 2 s. Drag its right edge to change how long.');}else say('Move the red line over a camera clip to freeze it.');}
      else if(name==='title'){const id=editor.change('Add title',d=>E.ops.add(d,E.textClip({track:'T1',start:t,dur:3,text:editor.doc.name||'Title',sub:'',style:'title'})));selected=new Set([id]);showSide('clip');refresh();$('[data-field=text]')?.focus();}
      else if(name==='pip'){const len=Math.min(4,Math.max(E.MIN,take.duration-t)),camera=E.at(doc,'V1',t)?.camera==='turret'?'intake':'turret',src=clamp(E.at(doc,'V1',t)?E.sourceAt(E.at(doc,'V1',t),t):t,0,take.duration-len);
        const id=editor.change('Add picture in picture',d=>E.ops.add(d,E.videoClip({track:'V2',start:t,in:src,out:src+len,camera,pip:true})));selected=new Set([id]);showSide('clip');refresh();}
      else if(name==='in'||name==='out'){editor.change(name==='in'?'Set In':'Set Out',d=>{const r=d.range||{in:0,out:duration()};if(name==='in')r.in=Math.min(t,r.out-E.MIN);else r.out=Math.max(t,r.in+E.MIN);d.range=r.out-r.in>=E.MIN?r:null;});}
      else if(name==='clear-range')editor.change('Clear in/out',d=>{d.range=null;});
      else if(name==='zoom-in')zoom(1.4);else if(name==='zoom-out')zoom(1/1.4);else if(name==='fit')fitZoom();
    }
    for(const b of $$('[data-act]'))b.onclick=e=>act(b.dataset.act,e.shiftKey);
    function cutTo(camera){
      if(!editor||exporting)return;const id=editor.change(`Cut to ${CAM[camera].name}`,d=>E.ops.cut(d,t,camera,'V1'));
      if(id){say(`${CAM[camera].name} camera from ${E.timecode(t)}. Move the red line and pick another to switch again.`);selected.clear();refresh();}else say('Move the red line over the Camera row to switch cameras there.');
    }
    function changed(){
      selected=new Set([...selected].filter(id=>editor.doc.clips.some(c=>c.id===id)));
      if(t>duration())t=duration();refresh();requestDraw();
    }
    function refresh(){timeline();clock();buttons();clipPane();cameraMarks();lookPane();void exportPane();sideTabs();}
    function buttons(){
      const u=$('#studio-undo'),r=$('#studio-redo');u.disabled=!editor?.canUndo||!!exporting;r.disabled=!editor?.canRedo||!!exporting;
      u.title=editor?.canUndo?`Undo ${editor.nextUndo()} (Ctrl+Z)`:'Nothing to undo';r.title=editor?.canRedo?`Redo ${editor.nextRedo()} (Ctrl+Shift+Z)`:'Nothing to redo';
      for(const b of $$('[data-act=remove],[data-act=duplicate]'))b.disabled=!selected.size||!!exporting;$('[data-act=clear-range]').disabled=!editor?.doc.range||!!exporting;
      for(const b of $$('.studio-tools button,.studio-transport button,.studio-head-actions button'))if(!['studio-undo','studio-redo','studio-save'].includes(b.id)&&!['remove','duplicate','clear-range'].includes(b.dataset.act))b.disabled=!!exporting;
    }
    $('#studio-undo').onclick=()=>{const l=editor?.undo();if(l)say(`Undid ${l.toLowerCase()}.`);};
    $('#studio-redo').onclick=()=>{const l=editor?.redo();if(l)say(`Redid ${l.toLowerCase()}.`);};
    $('#studio-play').onclick=()=>playing?pause():play();
    $('#studio-start').onclick=()=>{pause();setTime(0);};$('#studio-end').onclick=()=>{pause();setTime(duration());};
    $('#studio-back').onclick=e=>{pause();setTime(t-(e.shiftKey?1:1/30));};$('#studio-fwd').onclick=e=>{pause();setTime(t+(e.shiftKey?1:1/30));};
    $('#studio-name').onchange=e=>{const v=e.target.value.trim().slice(0,80)||'Run video';editor?.change('Rename',d=>{d.name=v;});};
    $('#studio-save').onclick=()=>exporting?exporting.abort():void exportVideo();
    $('#studio-more').onclick=()=>{const box=$('#studio-more-tools'),open=box.hidden;box.hidden=!open;$('#studio-more').setAttribute('aria-expanded',String(open));$('#studio-more').textContent=open?'Fewer tools':'More tools';};
    $('#studio-discard').onclick=()=>{const b=$('#studio-discard');if(Date.now()-discardArmed>4000){discardArmed=Date.now();b.textContent='Discard? Click again';b.classList.add('danger');setTimeout(()=>{b.textContent='Discard';b.classList.remove('danger');},4000);return;}
      discardArmed=0;b.textContent='Discard';b.classList.remove('danger');clear();opts.discard();};

    // ------------------------------------------------------------ side panes
    // Brings one part of the side column into view (opening its fold).
    // The side panel's tab: Clip while a clip is selected (it opens when one is picked), else what the team chose.
    let sideTab='cameras',sideSel='';
    function sideTabs(){const sel=editor&&one()?[...selected].join():'';if(sel&&sel!==sideSel)sideTab='clip';sideSel=sel;if(sideTab==='clip'&&!sel)sideTab='cameras';
      for(const b of $$('[data-sidetab]')){const k=b.dataset.sidetab;if(k==='clip')b.hidden=!sel;b.setAttribute('aria-selected',String(k===sideTab));}
      for(const k of ['clip','cameras','tune','moments','look','export'])pane(k).hidden=k!==sideTab;}
    function showSide(k){if(k==='clip')clipPane();sideTab=k;sideTabs();}
    // Replacing the Camera row puts the contact replays back where the run touched something.
    function recrash(d){d.markers=d.markers.filter(m=>m.color!==E.CRASH_COLOR);E.addCrashes(d,take.crashes);}
    function camerasPane(){
      const p=pane('cameras');if(!take){p.innerHTML='';return;}
      p.innerHTML=`<p class="hint">Pick a camera: the video switches to it from the red line in the timeline.</p>
        <div class="studio-cams">${CAMS.map(c=>`<button type="button" class="studio-cam" data-cam="${c.id}" data-css="--c:${c.color}" title="${esc(c.hint)}"><kbd>${c.key}</kbd><span>${esc(c.name)}</span></button>`).join('')}</div>
        <p class="hint studio-cam-hint" id="studio-cam-hint"></p>
        <div class="studio-row-buttons"><button type="button" class="secondary" id="studio-autocut" title="Switch cameras automatically, following what the robot does">Pick cameras for me</button><button type="button" class="secondary" id="studio-onecam" title="Go back to one camera for the whole video">Start over</button></div>
`;
      // What happened in the run, as one list to pick from: the video jumps there.
      const moments=[...editor.doc.clips.filter(c=>c.focus).map(c=>({t:c.start,label:`Contact with ${c.focus.label} (replay)`})),...events].sort((a,b)=>a.t-b.t);
      pane('moments').innerHTML=moments.length?`<label>Jump to a moment<select id="studio-moment"><option value="">Choose what happened…</option>${moments.map(e=>`<option value="${e.t}">${E.timecode(e.t)} · ${esc(e.label)}</option>`).join('')}</select></label>`:'<p class="hint">Nothing stood out in this run.</p>';css(pane('moments'));
      css(p);for(const b of p.querySelectorAll('[data-cam]'))b.onclick=()=>cutTo(b.dataset.cam);
      const moment=pane('moments').querySelector('#studio-moment');if(moment)moment.onchange=()=>{if(moment.value==='')return;pause();setTime(+moment.value);};
      p.querySelector('#studio-autocut').onclick=()=>{const clips=E.autoCut(take.frames,{duration:take.duration});if(!clips.length)return say('This run is too short to cut.');editor.change('Pick cameras',d=>{E.ops.replaceTrack(d,'V1',clips);recrash(d);});selected.clear();refresh();say(`The video now switches between ${new Set(clips.map(c=>c.camera)).size} cameras ${clips.length-1} times. Press Play to watch; Undo puts it back.`);};
      p.querySelector('#studio-onecam').onclick=()=>{const camera=take.view==='2d'?'top':'main';editor.change('Start over',d=>{E.ops.replaceTrack(d,'V1',[E.videoClip({start:0,in:0,out:take.duration,camera})]);recrash(d);});selected.clear();refresh();say('Back to one camera for the whole video.');};
      cameraMarks();
    }
    // Which camera shows at the playhead, and its fine-tuning.
    function cameraMarks(){
      const p=pane('cameras');if(!editor)return;const c=E.at(editor.doc,'V1',t),id=c?.kind==='video'?c.camera:null;
      for(const b of p.querySelectorAll('[data-cam]'))b.setAttribute('aria-pressed',String(b.dataset.cam===id));
      const hint=p.querySelector('#studio-cam-hint');if(hint)hint.textContent=id?`Showing now: ${CAM[id].label}. ${CAM[id].hint}`:'Nothing on the Camera row at the red line.';
      const body=$('#studio-tune-body');if(!body)return;const key=id||'';if(body.dataset.cam===key&&!body.dataset.stale)return;body.dataset.cam=key;delete body.dataset.stale;
      if(!id||id==='main'||id==='top'){body.innerHTML=`<p class="hint">${id?`${CAM[id].name} has nothing to adjust: it films the way the recordings always have.`:'Move the playhead over a clip.'}</p>`;return;}
      const s=K.settings(editor.doc.cameras)[id],modes=K.CAMERAS.find(x=>x.id===id).modes||{};
      const slider=(k,label,min,max,step,unit='')=>`<label>${label} <output>${s[k]}${unit}</output><input type="range" data-tune="${k}" min="${min}" max="${max}" step="${step}" value="${s[k]}"></label>`;
      body.innerHTML=`<label>Mode<select data-tune="mode">${options(modes,s.mode)}</select></label>${slider('distance','Distance',.5,2.5,.05,'×')}${slider('height','Height',.3,3,.05,'×')}${slider('swing','Swing round',-90,90,1,'°')}${slider('fov','Field of view',25,90,1,'°')}<button type="button" class="text-button" data-tune-reset>Back to how it was designed</button>`;
      for(const input of body.querySelectorAll('[data-tune]')){const k=input.dataset.tune;
        input.onfocus=()=>{focusSnap=JSON.stringify(editor.doc);};
        input.oninput=()=>{const v=k==='mode'?input.value:+input.value;if(input.previousElementSibling?.tagName==='OUTPUT')input.previousElementSibling.textContent=input.value+(k==='distance'||k==='height'?'×':'°');
          editor.doc.cameras={...editor.doc.cameras,[id]:{...K.settings(editor.doc.cameras)[id],[k]:v}};requestDraw();};
        input.onchange=()=>commit(focusSnap,'Adjust camera');}
      body.querySelector('[data-tune-reset]').onclick=()=>{editor.change('Reset camera',d=>{const c={...d.cameras};delete c[id];d.cameras=c;});body.dataset.stale='1';cameraMarks();};
    }
    // A live change (typed or dragged) becomes one undo step when it is done.
    function commit(before,label){if(!before||!editor)return;const now=JSON.stringify(editor.doc);if(now===before)return;editor.undoStack.push({label,doc:before});if(editor.undoStack.length>editor.limit)editor.undoStack.shift();editor.redoStack=[];focusSnap=now;changed();}
    function clipPane(){
      const p=pane('clip'),c=editor&&one();p.hidden=!c;
      if(!c){p.innerHTML='';return;}
      const num=(k,label,v,min,max,step,unit='s')=>`<label>${label}<span class="studio-num"><input type="number" data-field="${k}" value="${+v.toFixed(2)}" min="${min}" max="${max}" step="${step}"><span>${unit}</span></span></label>`;
      const head=`<div class="studio-clip-head"><h4 class="studio-sub">${c.kind==='text'?'Words':c.freeze?'Freeze frame':'Chosen clip'} <span class="hint">${E.timecode(c.start)}–${E.timecode(E.end(c))}</span></h4><button type="button" class="secondary" data-clip-done>Done</button></div>`;
      const fades=`<div class="studio-pair">${num('fadeIn','Fade in',c.fadeIn,0,10,.1)}${num('fadeOut','Fade out',c.fadeOut,0,10,.1)}</div>`,remove=`<button type="button" class="text-button studio-remove" data-clip-remove>Delete this clip</button>`;
      if(c.kind==='text')p.innerHTML=`${head}<label>Words<input data-field="text" maxlength="200" value="${esc(c.text)}"></label><label>Look<select data-field="style">${options(E.TEXT_STYLES,c.style)}</select></label>${num('dur','Shows for',c.dur,E.MIN,600,.1)}
        <details class="sim-fold studio-tune"><summary>More</summary><label>Second line<input data-field="sub" maxlength="200" value="${esc(c.sub)}" placeholder="Optional"></label>${fades}</details>${remove}`;
      else p.innerHTML=`${head}<div class="studio-cams small">${CAMS.map(k=>`<button type="button" class="studio-cam" data-clipcam="${k.id}" data-css="--c:${k.color}" aria-pressed="${k.id===c.camera}" title="${esc(k.label)}"><kbd>${k.key}</kbd><span>${esc(k.name)}</span></button>`).join('')}</div>
        ${c.freeze?num('hold','Hold for',c.hold,E.MIN,600,.1):`<label>Speed<select data-field="speed">${options(SPEEDS,c.speed)}${SPEEDS[c.speed]?'':`<option value="${c.speed}" selected>${c.speed}×</option>`}</select></label>`}
        <details class="sim-fold studio-tune"><summary>More</summary><label>Change into this clip with<select data-field="transition">${options(E.TRANSITIONS,c.transition)}</select></label>${c.transition!=='cut'?num('transitionLength','Change takes',c.transitionLength,.05,5,.05):''}
        ${fades}<label class="studio-check"><input type="checkbox" data-field="pip"${c.pip?' checked':''}> Small, in the corner</label></details>${remove}`;
      css(p);p.querySelector('[data-clip-done]').onclick=()=>{selected.clear();refresh();};p.querySelector('[data-clip-remove]').onclick=()=>act('remove');for(const b of p.querySelectorAll('[data-clipcam]'))b.onclick=()=>editor.change('Change camera',d=>E.ops.setCamera(d,[c.id],b.dataset.clipcam));
      for(const input of p.querySelectorAll('[data-field]')){const k=input.dataset.field;
        const value=()=>input.type==='checkbox'?input.checked:input.type==='number'||k==='speed'?+input.value:input.value;
        const apply=d=>{const v=value();if(input.type==='number'&&!Number.isFinite(v))return;if(k==='speed')E.ops.speed(d,c.id,v);else E.ops.set(d,c.id,{[k]:input.type==='number'?clamp(v,+input.min,+input.max):v});};
        input.onfocus=()=>{focusSnap=JSON.stringify(editor.doc);};
        if(input.type==='text'||input.tagName==='INPUT'&&input.type!=='checkbox'&&input.type!=='number'){input.oninput=()=>{editor.doc=JSON.parse(focusSnap||JSON.stringify(editor.doc));apply(editor.doc);timeline();requestDraw();};input.onchange=()=>commit(focusSnap,'Edit words');}
        else input.onchange=()=>{editor.change('Change clip',apply);};}
    }
    function lookPane(){
      const p=pane('look');if(!editor){p.innerHTML='';return;}const o=editor.doc.overlays;
      p.innerHTML=`<p class="hint">Shown on top of the picture. To add your own words, use + Text under the video.</p>${Object.entries(OVERLAYS).map(([k,v])=>`<label class="studio-check"><input type="checkbox" data-overlay="${k}"${o[k]?' checked':''}> ${esc(v)}</label>`).join('')}<div class="button-row"><button type="button" class="secondary" id="studio-end-card">${editor.doc.endCard===false?'Add “Edited with Torque” at the end':'Remove “Edited with Torque” at the end'}</button></div>`;
      p.querySelector('#studio-end-card').onclick=()=>{const on=editor.doc.endCard===false;editor.change(on?'Add end card':'Remove end card',d=>{d.endCard=on;});lookPane();requestDraw();};
      for(const input of p.querySelectorAll('[data-overlay]'))input.onchange=()=>editor.change(input.checked?'Show overlay':'Hide overlay',d=>{d.overlays[input.dataset.overlay]=input.checked;});
    }

    // ------------------------------------------------------------ export
    const exportSettings={size:'1280x720',fps:30,part:'all',format:0};
    async function probe(){const [w,h]=exportSettings.size.split('x').map(Number),key=`${w}x${h}@${exportSettings.fps}`;if(formatKey===key&&formats)return formats;formatKey=key;formats=null;
      try{formats=await N.probe({width:w,height:h,fps:exportSettings.fps});}catch{formats={video:[],webcodecs:false};}return formats;}
    const formatName=f=>f.container==='mp4'?'MP4 (H.264): plays everywhere':f.codec==='vp9'?'WebM (VP9)':'WebM (VP8)';
    async function exportPane(){
      const p=pane('export');if(!editor){p.innerHTML='';return;}if(exporting)return;const r=E.exportRange(editor.doc),hasRange=!!editor.doc.range;if(!hasRange)exportSettings.part='all';
      const span=exportSettings.part==='range'?r.out-r.in:duration();
      p.innerHTML=`<p class="hint">The defaults suit almost everyone. A ${span.toFixed(1)} s video takes a few seconds to save.</p>
        <label>Size<select data-exp="size">${options(SIZES,exportSettings.size)}</select></label><label>Frame rate<select data-exp="fps">${options({30:'30 per second',60:'60 per second (smoother, twice as long to export)'},exportSettings.fps)}</select></label>
        <label>Format<select data-exp="format" id="studio-format"><option>Checking what this computer can encode…</option></select></label>
        <label>Part<select data-exp="part">${options({all:'The whole video',...(hasRange?{range:`Only ${E.timecode(r.in)} to ${E.timecode(r.out)}`}:{})},exportSettings.part)}</select></label>
        <p class="hint" id="studio-export-note" role="status"></p><button type="button" class="secondary studio-export-go" id="studio-original" title="The video exactly as it was recorded, without the changes made here">Save the recording as filmed…</button>`;
      for(const s of p.querySelectorAll('[data-exp]'))s.onchange=()=>{const k=s.dataset.exp;exportSettings[k]=k==='fps'||k==='format'?+s.value:s.value;exportPane();};
      p.querySelector('#studio-original').onclick=async e=>{const b=e.currentTarget;b.disabled=true;say('Choose where to save the recording…');try{say(await opts.saveOriginal());}catch(err){say(err.message);}b.disabled=false;};
      const f=await probe();if(exporting||!p.isConnected)return;const sel=p.querySelector('#studio-format');if(!sel)return;$('#studio-save').disabled=!f?.video?.length;
      if(!f?.video?.length){sel.innerHTML='<option>None available</option>';sel.disabled=true;p.querySelector('#studio-export-note').textContent=f?.webcodecs===false?'This computer cannot save edited videos. Save the recording as filmed keeps it as it was.':'This computer cannot save this size and rate. Try 720p or 30 per second.';return;}
      exportSettings.format=Math.min(exportSettings.format,f.video.length-1);sel.innerHTML=f.video.map((v,i)=>`<option value="${i}"${i===exportSettings.format?' selected':''}>${formatName(v)}</option>`).join('');
    }
    async function exportVideo(){
      if(exporting||!editor)return;const f=await probe(),format=f?.video?.[exportSettings.format];if(!format)return;
      const [W,H]=exportSettings.size.split('x').map(Number),fps=exportSettings.fps,r=exportSettings.part==='range'?E.exportRange(editor.doc):{in:0,out:duration()},count=Math.max(1,Math.round((r.out-r.in)*fps));
      pause();exporting=new AbortController();buttons();const p=pane('export'),go=$('#studio-save'),bar=$('#studio-progress'),note={set textContent(v){say(v);}};
      for(const s of p.querySelectorAll('select,button'))s.disabled=true;go.textContent='Cancel';go.classList.replace('primary','secondary');go.disabled=false;bar.hidden=false;bar.value=0;
      const out=Object.assign(document.createElement('canvas'),{width:W,height:H}),octx=out.getContext('2d'),began=performance.now();let message='';
      try{
        const bytes=await N.encode({format,width:W,height:H,fps,count,signal:exporting.signal,
          draw:async i=>{const time=r.in+i/fps;paint(octx,W,H,time);t=time;if(i%3===0){clock();playhead(true);await new Promise(res=>setTimeout(res,0));}return out;},
          onProgress:(done,n)=>{bar.value=done/n;if(done%10===0||done===n){const left=(performance.now()-began)/done*(n-done)/1000;note.textContent=`Making the video… ${Math.round(done/n*100)}%${done<n&&done>20?` · about ${Math.ceil(left)} s left`:''}`;}}});
        note.textContent='Choose where to save the video…';
        message=await opts.save(bytes,format.container==='mp4'?'mp4':'webm',editor.doc.name);
      }catch(e){message=e?.name==='AbortError'?'Export cancelled.':e?.message||'The export failed.';}
      exporting=null;go.textContent='Save video…';go.classList.replace('secondary','primary');bar.hidden=true;buttons();await exportPane();say(message);requestDraw();
    }

    // ------------------------------------------------------------ keys
    document.addEventListener('keydown',e=>{
      if(!shown||!editor||exporting||editing(e.target)||document.querySelector('dialog[open]'))return;const k=e.key,ctrl=e.ctrlKey||e.metaKey;let done=true;
      if(ctrl&&(k==='z'||k==='Z')){if(e.shiftKey)$('#studio-redo').click();else $('#studio-undo').click();}
      else if(ctrl&&(k==='y'||k==='Y'))$('#studio-redo').click();
      else if(ctrl&&(k==='d'||k==='D'))act('duplicate');
      else if(ctrl)done=false;
      else if(k===' ')playing?pause():play();
      else if(/^[1-6]$/.test(k))cutTo(CAMS[+k-1].id);
      else if(k==='s'||k==='S')act('split');
      else if(k==='Delete'||k==='Backspace')act('remove',e.shiftKey);
      else if(k==='f'||k==='F')act('freeze');
      else if(k==='t'||k==='T')act('title');
      else if(k==='p'||k==='P')act('pip');
      else if(k==='i'||k==='I')act('in');
      else if(k==='o'||k==='O')act('out');
      else if(k==='ArrowLeft'||k==='ArrowRight'){pause();setTime(t+(k==='ArrowLeft'?-1:1)*(e.shiftKey?1:1/30));}
      else if(k==='Home'){pause();setTime(0);}else if(k==='End'){pause();setTime(duration());}
      else if(k==='Escape'&&selected.size){selected.clear();refresh();}
      else done=false;
      if(done)e.preventDefault();
    });

    // ------------------------------------------------------------ the recording
    // next: {frames, ctx (the cameras' view of the robot), state (what the 3D field shows), name, view, seconds}.
    // The cameras also get the field's solid parts from the field info, to keep out of them.
    // A full match (a run with an autonomous and a teleop) can be edited whole or one period at a time; a period
    // is the frames of that part alone, with the contacts in it, and each part keeps its edit while another is open.
    let run=null,parts=null,part='all',partDocs={};
    async function load(next){
      if(!next.frames?.length)return;
      const s=V.sections(next.frames);run=next;parts=s.auto&&s.teleop?s:null;part='all';partDocs={};
      $('#studio-part-box').hidden=!parts;if(parts)$('#studio-part').innerHTML=options({all:'Whole match',auto:V.SECTIONS.auto,teleop:V.SECTIONS.teleop},'all');
      await open(next);
    }
    function openPart(key){
      partDocs[part]=editor.doc;part=key;const [a,b]=parts[key],F=run.frames.slice(a,b+1),off=F[0].time-run.frames[0].time,span=F.at(-1).time-F[0].time;
      const crashes=(run.crashes||[]).filter(c=>c.at>=off&&c.at<=off+span).map(c=>({...c,at:c.at-off}));
      return open({...run,frames:F,crashes,name:key==='all'?run.name:`${run.name||'Run video'} - ${V.SECTIONS[key]}`},partDocs[key]);
    }
    $('#studio-part').onchange=e=>{if(!take||exporting){e.target.value=part;return;}void openPart(e.target.value);};
    async function open(next,kept){
      pause();const F=next.frames;
      take={...next,t0:F[0].time,duration:Math.max(E.MIN,F.at(-1).time-F[0].time),ctx:{...next.ctx,rig:K.rig(next.ctx),field:K.field(next.state?.info)}};
      const doc=kept||E.create({recording:{id:'take',duration:take.duration},name:next.name||'Run video'});
      // Where the robot touched a wall, a field structure or a no-go zone, the video stops and zooms in on it.
      take.crashes=(next.crashes||[]).filter(c=>Number.isFinite(c?.at)&&c.at<take.duration);
      if(!kept){if(next.view==='2d')doc.clips[0].camera='top';Object.assign(doc.overlays,{match:true,velocity:true,path:next.view!=='2d'});E.addCrashes(doc,take.crashes);}
      editor=new E.Editor(doc,{onChange:changed});paths={};pathKeys={};warmPaths();trail=buildTrail(F);events=E.events(F);selected.clear();t=0;
      $('#studio-name').value=doc.name;$('#studio-meta').textContent=`${E.timecode(take.duration).replace(/\.\d+$/,'')} long`;
      say(take.crashes.length?`The robot touched something ${take.crashes.length===1?'once':`${take.crashes.length} times`}: the video stops and zooms in on each one (red on the timeline). Press Play to watch it.`:'Press Play to watch it. Save video keeps it; changing it first is optional.');
      camerasPane();requestAnimationFrame(fitZoom);refresh();
      $('#studio-loading').hidden=false;$('#studio-loading').textContent='Getting the cameras ready…';
      try{cam=await opts.camera();$('#studio-loading').hidden=true;}catch(e){$('#studio-loading').textContent=e.message||'The cameras could not load.';}
      requestDraw();
    }
    function clear(){pause();exporting?.abort();run=null;parts=null;partDocs={};$('#studio-part-box').hidden=true;take=null;editor=null;paths={};pathKeys={};trail=null;events=[];selected.clear();pctx.clearRect(0,0,canvas.width,canvas.height);tracks.innerHTML='';for(const k of ['cameras','clip','look','export'])pane(k).innerHTML='';say('');}
    // The tab is on screen (or not): playing stops when it is hidden.
    function show(on){shown=!!on;if(!shown){pause();return;}if(take){requestAnimationFrame(()=>{if(pps===40)fitZoom();else timeline();requestDraw();});}}
    return {load,show,clear,has:()=>!!take,busy:()=>!!exporting};
  }
  window.DeckStudio={create,CAMS};
})();
