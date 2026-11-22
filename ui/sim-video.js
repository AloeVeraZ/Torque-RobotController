(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckSimVideo=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Run videos: a camera of their own films the run (not the window), in 2D straight down at the field or in 3D
  // behind the robot, with the period, the clock, the points and what the robot is doing drawn over it.
  // Filmed live while a run plays, or afterwards by replaying the recorded run.
  const SECTIONS={all:'Whole run',auto:'Autonomous',teleop:'Teleop'};
  const VIEWS={'2d':'2D · top-down','3d':'3D · follows the robot'};
  const PHASES={auto:['Autonomous','#2f8f5b'],transition:['Transition','#7a7f87'],teleop:['Teleop','#2f6fb5'],finished:['Finished','#7a7f87']};
  // MP4 (H.264) plays everywhere a team shares videos; WebM is the fallback where the recorder lacks it.
  const TYPES=['video/mp4;codecs=avc1.640028','video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
  function pickType(supported=t=>globalThis.MediaRecorder?.isTypeSupported?.(t)){const type=TYPES.find(t=>{try{return supported(t);}catch{return false;}});return type?{type,ext:type.startsWith('video/mp4')?'mp4':'webm'}:null;}
  // Where each section starts and ends in a recorded run: [first frame, last frame] indices, or null.
  function sections(frames){
    const out={all:frames.length?[0,frames.length-1]:null,auto:null,teleop:null};
    frames.forEach((f,i)=>{const p=f.practice?.phase;if(p==='auto'||p==='teleop'){if(!out[p])out[p]=[i,i];else out[p][1]=i;}});
    // A run with no practice timer (or only one period) is all one section.
    if(!out.auto&&!out.teleop&&out.all&&!frames.some(f=>f.practice))out.auto=out.all.slice();
    return out;
  }
  // The frames a video of the run covers. An autonomous on its own ends a second after the robot finishes rather than
  // when its period's clock runs out, as a live recording does; a run with a teleop is kept whole.
  function editable(frames){
    const end=frames.find(f=>f.result)?.result;if(!end||frames.some(f=>['transition','teleop'].includes(f.practice?.phase)))return frames;
    return frames.filter(f=>f.time<=end.time+1);
  }
  const clock=s=>{const t=Math.max(0,Math.ceil(s-1e-6));return `${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`;};
  // The top of the picture: the period and its clock, the run's name, and the points when it scores.
  function caption(f,{name='',start=0}={}){
    const p=f?.practice,[phase,color]=PHASES[p?.phase]||['Run','#3a4049'];
    const time=p&&Number.isFinite(p.remaining)&&p.phase!=='finished'?clock(p.remaining):`${Math.max(0,(f?.time??start)-start).toFixed(1)} s`;
    const score=Number.isFinite(f?.mechanisms?.score)?`${f.mechanisms.score} pts`:'';
    return {phase,color,time,name:String(name).slice(0,60),score};
  }
  // The bottom of the picture: how fast the robot goes, what it holds and what its shooter is doing.
  function detail(f){
    const t=f?.truth;if(!t)return '';const m=f.mechanisms,parts=[`${Math.round(Math.hypot(t.vx||0,t.vy||0))} in/s`];
    if(m){parts.push(`${m.held??0} held`);const c=m.command||{};if(c.feed)parts.push('shooting');else if(m.ready&&m.aligned&&(c.spin||c.aim))parts.push('on target');else if(m.flywheel>.05)parts.push('spinning up');else if(c.intake)parts.push('intaking');}
    if(f.acting)parts.push(String(f.acting).slice(0,40));return parts.join('  ·  ');
  }
  const safeName=s=>String(s||'').replace(/[^\w -]+/g,'').replace(/\s+/g,' ').trim().slice(0,60);
  // The suggested file name, without its extension: "Red auto - Autonomous - 3D".
  const title=(name,section,view)=>`${safeName(name)||'Deck run'} - ${SECTIONS[section]||'Run'}${VIEWS[view]?` - ${view.toUpperCase()}`:''}`;

  // The app's two faces: Inter reads, Barlow Condensed sets the clock and the points (ui/tokens.css).
  const FONT='Inter, system-ui, "Segoe UI", sans-serif',DISPLAY='"Barlow Condensed", Inter, system-ui, sans-serif';
  const PLATE='rgb(12 15 13 / .8)',TEXT='#ebf0ed',MUTED='#b5bcb8';
  // The app's mark: τ, the symbol for torque, its foot turning as torque turns a shaft, on a 64-unit square, light
  // on the app's ink. The icons are drawn from it (tools/icons.cjs), and so is a video's end card.
  const MARK='M12 14H50V22H34V36A7 7 0 0 0 45.95 40.95L51.607 46.607A15 15 0 0 1 26 36V22H12Z',INK='#141a16',PAPER='#ebf0ed';
  // A superellipse filling w × h at x, y: the rounded square an app icon sits in.
  function squircle(x,y,w,h,n=5,steps=240){const p=[],r=v=>+v.toFixed(3);for(let i=0;i<steps;i++){const t=i/steps*2*Math.PI,c=Math.cos(t),s=Math.sin(t);
    p.push(`${r(x+w/2+w/2*Math.sign(c)*Math.abs(c)**(2/n))} ${r(y+h/2+h/2*Math.sign(s)*Math.abs(s)**(2/n))}`);}return `M${p.join('L')}Z`;}
  // A dark plate with small corners (4 at 720 lines) that the writing sits on.
  function plate(ctx,x,y,w,h,u,fill=PLATE){ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,y,w,h,4*u);else ctx.rect(x,y,w,h);ctx.fillStyle=fill;ctx.fill();}
  // Runs of [text, font, colour] side by side on one plate, `gap` apart; `align` says which end x is. Returns its height.
  function runs(ctx,parts,x,y,h,u,{align='left',gap=10,pad=14}={}){
    const widths=parts.map(([t,font])=>{ctx.font=font;return ctx.measureText(t).width;}),w=widths.reduce((a,b)=>a+b,0)+gap*u*(parts.length-1)+2*pad*u,left=align==='right'?x-w:align==='center'?x-w/2:x;
    plate(ctx,left,y,w,h,u);let at=left+pad*u;ctx.textAlign='left';ctx.textBaseline='middle';
    parts.forEach(([t,font,colour],i)=>{ctx.font=font;ctx.fillStyle=colour;ctx.fillText(t,at,y+h/2+(font.includes('Barlow')?u:0));at+=widths[i]+gap*u;});return h;
  }
  // Fonts are drawn only once the page has them; ask for them before the first picture.
  function loadFonts(){try{return Promise.all(['500 16px Inter','700 28px "Barlow Condensed"'].map(f=>globalThis.document?.fonts?.load?.(f))).catch(()=>{});}catch{return Promise.resolve();}}
  // The writing over the picture, sized to its height (720 lines is 1).
  function overlay(ctx,width,height,top,bottom,inset){
    const u=height/720,pad=18*u,h=44*u;ctx.save();
    // The period in words and its clock; the run's name and, once it scores, its points.
    runs(ctx,[[top.phase,`500 ${15*u}px ${FONT}`,MUTED],[top.time,`700 ${28*u}px ${DISPLAY}`,TEXT]],pad,pad,h,u);
    const right=[top.name&&[top.name,`500 ${16*u}px ${FONT}`,top.score?MUTED:TEXT],top.score&&[top.score,`700 ${26*u}px ${DISPLAY}`,TEXT]].filter(Boolean);
    if(right.length)runs(ctx,right,width-pad,pad,h,u,{align:'right'});
    if(bottom){const bh=36*u;runs(ctx,[[bottom,`500 ${15*u}px ${FONT}`,TEXT]],pad,height-pad-bh,bh,u,{pad:12});}
    if(inset){ctx.beginPath();if(ctx.roundRect)ctx.roundRect(inset.x,inset.y,inset.size,inset.size,4*u);else ctx.rect(inset.x,inset.y,inset.size,inset.size);ctx.lineWidth=2*u;ctx.strokeStyle='rgb(235 240 237 / .85)';ctx.stroke();}
    ctx.restore();
  }

  // A recorder for a run video. `shoot(dt)` draws the next picture ({canvas, inset}) `dt` seconds after the last;
  // `frame()` gives the run frame it shows, for the writing over it. begin() films at 30 pictures a second (on
  // a timer, so it keeps filming when the window is behind another); stop() resolves with the video.
  function create({shoot,frame,name=()=>'',start=()=>0,width=1280,height=720}){
    let canvas=null,ctx=null,track=null,recorder=null,chunks=[],timer=0,last=0,done=null,kind=null;
    function draw(){
      const now=performance.now(),dt=last?(now-last)/1000:0;last=now;
      const pic=shoot(dt),f=frame();ctx.drawImage(pic.canvas,0,0,width,height);overlay(ctx,width,height,caption(f,{name:name(),start:start()}),detail(f),pic.inset);track?.requestFrame?.();
    }
    function tick(){if(!recorder)return;const at=performance.now();try{draw();}catch(e){console.error(e);}timer=setTimeout(tick,Math.max(0,1000/30-(performance.now()-at)));}
    function begin(){
      if(recorder)return;kind=pickType();if(!kind)throw Error('This app cannot record video on this system.');void loadFonts();
      canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;ctx=canvas.getContext('2d');last=0;draw();
      chunks=[];recorder=new MediaRecorder(new MediaStream([track=canvas.captureStream(0).getVideoTracks()[0]]),{mimeType:kind.type,videoBitsPerSecond:8e6});
      recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
      done=new Promise(resolve=>{recorder.onstop=()=>{clearTimeout(timer);const blob=new Blob(chunks,{type:kind.type.split(';')[0]});recorder=null;chunks=[];resolve(blob);};});
      recorder.start(1000);tick();
    }
    // Resolves with the video (a Blob, possibly empty) once the recorder has written its last part.
    async function stop(){if(!recorder)return null;const wait=done;clearTimeout(timer);if(recorder.state!=='inactive')recorder.stop();return wait;}
    function close(){clearTimeout(timer);if(recorder&&recorder.state!=='inactive'){recorder.onstop=null;recorder.stop();}recorder=null;track?.stop();track=null;}
    return {begin,stop,close,recording:()=>!!recorder,ext:()=>kind?.ext||'webm'};
  }
  return {SECTIONS,VIEWS,pickType,sections,editable,caption,detail,title,create,runs,loadFonts,FONT,DISPLAY,TEXT,MUTED,MARK,INK,PAPER,squircle};
});
