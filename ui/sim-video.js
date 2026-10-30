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

  const FONT='system-ui, "Segoe UI", sans-serif';
  function pill(ctx,x,y,w,h,fill){ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,y,w,h,h*.22);else ctx.rect(x,y,w,h);ctx.fillStyle=fill;ctx.fill();}
  // The writing over the picture, sized to its height (720 lines is 1).
  function overlay(ctx,width,height,top,bottom,inset){
    const u=height/720,pad=18*u,h=42*u;ctx.save();ctx.textBaseline='middle';
    ctx.font=`600 ${14*u}px ${FONT}`;const phase=top.phase.toUpperCase(),pw=ctx.measureText(phase).width;ctx.font=`700 ${22*u}px ${FONT}`;const tw=ctx.measureText(top.time).width;
    pill(ctx,pad,pad,pw+tw+44*u,h,top.color);ctx.fillStyle='#fff';ctx.textAlign='left';ctx.font=`600 ${14*u}px ${FONT}`;ctx.fillText(phase,pad+16*u,pad+h/2);ctx.font=`700 ${22*u}px ${FONT}`;ctx.fillText(top.time,pad+28*u+pw,pad+h/2);
    const right=[top.name,top.score].filter(Boolean).join('  ·  ');
    if(right){ctx.font=`600 ${17*u}px ${FONT}`;const w=ctx.measureText(right).width+32*u;pill(ctx,width-pad-w,pad,w,h,'rgb(13 15 18 / .72)');ctx.fillStyle='#e8ecf1';ctx.textAlign='right';ctx.fillText(right,width-pad-16*u,pad+h/2);}
    if(bottom){ctx.font=`500 ${16*u}px ${FONT}`;const w=ctx.measureText(bottom).width+28*u,y=height-pad-h*.85;pill(ctx,pad,y,w,h*.85,'rgb(13 15 18 / .72)');ctx.fillStyle='#e8ecf1';ctx.textAlign='left';ctx.fillText(bottom,pad+14*u,y+h*.425);}
    if(inset){ctx.beginPath();if(ctx.roundRect)ctx.roundRect(inset.x,inset.y,inset.size,inset.size,6*u);else ctx.rect(inset.x,inset.y,inset.size,inset.size);ctx.lineWidth=3*u;ctx.strokeStyle='rgb(232 236 241 / .85)';ctx.stroke();}
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
      if(recorder)return;kind=pickType();if(!kind)throw Error('This app cannot record video on this system.');
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
  return {SECTIONS,VIEWS,pickType,sections,editable,caption,detail,title,create};
});
