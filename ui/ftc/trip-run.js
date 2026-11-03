'use strict';
// Trip Run: a small endless runner for the Drive tab's Robot status panel while no robot is connected.
// One 2D canvas, no WebGL and no asset files, so it stays light on a Steam Deck on battery and fits the
// page CSP. The frame loop only runs during a run; idle, paused, game over and hidden cost nothing.
(()=>{
const MUTE_KEY='torque-trip-muted',BEST_KEY='torque-trip-best';
const MELT=1.5,GLASSES=1.0,WARP_IN=0.7,WARP_OUT=0.8,TRIP_LEN=20;
const SPEED0=125,SPEED_MAX=300,ACCEL=2.2;
const FLOOR=3,FAR=50,XMAX=4.6,YMIN=-2.6,YMAX=2.3;
const CACTUS=0,DRONE=1,MUSH=2,ROCK=3,RING=4;
const load=k=>{try{return localStorage.getItem(k);}catch{return null;}};
const save=(k,v)=>{try{localStorage.setItem(k,String(v));}catch{}};
const clamp=(v,a,b)=>v<a?a:v>b?b:v,rnd=(a,b)=>a+Math.random()*(b-a);

// ---- Pixel art: '#' is ink, '.' shows the background. Original designs, one sprite pixel per world unit.
const HEAD=['...........#....','..........###...','...........#....','...........#....','....###########.','...#############',
  '...###...##...##','...###...##...##','...###...##...##','...#############','...#######..####','...#############','....###########.','.....#########..'];
const DUCK=['.##.................','...##...............','....###############.','...################.','...#####...##...###.','...#####...##...###.',
  '...#####...##...###.','...########..######.','....##############..'];
const ART={
  run0:HEAD.concat(['....##.....##...','...###....###...']),
  run1:HEAD.concat(['.....##...##....','....###..###....']),
  jump:HEAD.concat(['....##.....##...','................']),
  duck0:DUCK.concat(['.....##.......##....','....###......###....']),
  duck1:DUCK.concat(['......##.....##.....','.....###....###.....']),
  cactusS:['...##...','..####..','..####..','..####.#','#.####.#','#.####.#','#.######','#.####..','######..','..####..','..####..','..####..','..####..','..####..','..####..'],
  cactusT:['.....##.....','....####....','....####....','....####....','....####.##.','....####.##.','.##.####.##.','.##.####.##.','.##.####.##.','.##.#######.',
    '.##.######..','.#######....','..######....'].concat(Array(11).fill('....####....')),
  cactusB:['....##....','#.######.#','.########.','##########','###.##.###','##########','###.##.###','##########','.########.','..######..'],
  drone0:['####......####','..#........#..','..##########..','.############.','.#####..#####.','..##########..','...#......#...','..##......##..'],
  drone1:['.##........##.','..#........#..','..##########..','.############.','.#####..#####.','..##########..','...#......#...','..##......##..'],
  mush:['..#####..','.#..####.','##..##..#','######..#','#########','...###...','...###...','...###...','..#####..'],
  glasses:['############','....###..###','....###..###','.....#....#.'],
  cloud:['........######........','......##......##......','..####..........###...','.#.................##.','#....................#','######################'],
};
const EYES_STAND=[6,6,11,6],EYES_DUCK=[8,4,13,4],SPIN=[0,0,1,0,2,0,2,1,2,2,1,2,0,2,0,1];
// A 1-unit halo so the flying ink sunglasses stay readable over ink.
function halo(rows){
  const h=rows.length,w=rows[0].length,out=[];
  for(let y=-1;y<=h;y++){let s='';for(let x=-1;x<=w;x++){let on=false;
    for(let dy=-1;dy<=1&&!on;dy++)for(let dx=-1;dx<=1;dx++){const r=rows[y+dy];if(r&&r[x+dx]==='#'){on=true;break;}}
    s+=on?'#':'.';}out.push(s);}
  return out;
}
ART.glassesHalo=halo(ART.glasses);
function paint(rows,color){
  const c=document.createElement('canvas');c.width=rows[0].length;c.height=rows.length;
  const g=c.getContext('2d');g.fillStyle=color;
  rows.forEach((r,y)=>{for(let x=0;x<r.length;x++)if(r[x]==='#')g.fillRect(x,y,1,1);});
  return c;
}
// Trip colours come from fixed tables so a frame builds no colour strings.
const PAL=[[],[],[]];
for(let i=0;i<36;i++){PAL[0].push(`hsl(${i*10},100%,64%)`);PAL[1].push(`hsl(${i*10},90%,50%)`);PAL[2].push(`hsl(${i*10},75%,20%)`);}
const pal=(l,h)=>PAL[l][((Math.floor(h/10)%36)+36)%36];
function hslRgb(h,s,l){h=((h%360)+360)%360/60;const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h%2-1)),m=l-c/2;
  const [r,g,b]=h<1?[c,x,0]:h<2?[x,c,0]:h<3?[0,c,x]:h<4?[0,x,c]:h<5?[x,0,c]:[c,0,x];return [(r+m)*255,(g+m)*255,(b+m)*255];}

function create(container,options){
  options=options||{};
  const maxH=options.maxHeight||240;
  const root=document.createElement('div');root.className='trip-run';
  Object.assign(root.style,{position:'relative',width:'100%',lineHeight:'0'});
  const cv=document.createElement('canvas');cv.className='trip-run-canvas';
  Object.assign(cv.style,{display:'block',width:'100%',height:'0px',touchAction:'none',cursor:'pointer'});
  cv.setAttribute('role','img');cv.setAttribute('aria-label','Trip Run mini game. Press Space or tap to play.');
  const muteBtn=document.createElement('button');muteBtn.type='button';muteBtn.className='trip-run-mute';
  Object.assign(muteBtn.style,{position:'absolute',top:'4px',left:'4px',width:'26px',height:'26px',padding:'4px',border:'0',borderRadius:'6px',
    background:'transparent',color:'inherit',opacity:'.55',cursor:'pointer',lineHeight:'0'});
  root.append(cv,muteBtn);container.appendChild(root);
  const ctx=cv.getContext('2d');
  const buf=document.createElement('canvas'),bx=buf.getContext('2d');
  const lens=document.createElement('canvas'),lx=lens.getContext('2d');

  // ---- State ----------------------------------------------------------------------------------
  let cssW=0,cssH=0,dpr=1,cw=0,ch=0,P=2,WW=0,WH=0,GY=0,RX=12,resizeQueued=0;
  let ink='#0a0a0a',bg='',bgRgb=null,font='sans-serif',S={};
  let shown=true,paused=false,rafId=0,last=0,time=0,destroyed=false;
  let phase='idle',mode='run',modeT=0,overT=0;
  let score=0,best=Math.max(0,Math.floor(+load(BEST_KEY)||0)),nextMilestone=100,flashT=0,speed=SPEED0;
  let rb=0,rvy=0,onGround=true,ducking=false,holdT=0,runAnim=0,invuln=0,cool=false,impacted=false,blinkT=2;
  let spawnGap=0,mushCool=0,hadMush=false,tint=0,hueT=0,shake=0,flash=0,flashRed=false;
  let fx=0,fy=0,fvx=0,fvy=0,fspeed=0,ftravel=0,lives=3,fhit=0,spawn3=0,flyT=0,roll=0,mouseT=-9,mtx=0,mty=0,fdone=false;
  let muted=load(MUTE_KEY)==='1',ac=null,master=null,noise=null;
  let scoreText='',scoreShown=-1,muteLight=false;
  const held={jump:false,duck:false,left:false,right:false,up:false,down:false,ptr:false};
  const pad={a:false,duck:false,x:0,y:0,on:false};
  const obs=Array.from({length:14},()=>({on:false,kind:0,x:0,y:0,w:0,h:0,n:0,vx:0,anim:0,spr:[null,null,null],ox:[0,0,0],oy:[0,0,0]}));
  const clouds=Array.from({length:6},()=>({x:0,y:0,f:0}));
  const pebbles=Array.from({length:40},()=>({x:0,y:0,w:1}));
  const parts=Array.from({length:64},()=>({on:false,sp:false,x:0,y:0,vx:0,vy:0,life:0,max:1,s:1,hue:0}));
  const objs=Array.from({length:40},()=>({on:false,kind:0,x:0,y:0,z:0,h:0,r:1,a:0,va:0,hue:0,rad:new Float32Array(7)}));
  const order=new Array(40).fill(null);
  const pops=Array.from({length:6},()=>({on:false,t:0,x:0,y:0,txt:''}));
  const cracks=Array.from({length:3},()=>({on:false,pts:new Float32Array(14)}));
  const mountains=new Float32Array(32);for(let i=0;i<32;i++)mountains[i]=rnd(0.3,1);

  // ---- Theme, size ------------------------------------------------------------------------------
  function norm(c){ctx.fillStyle='#000';ctx.fillStyle=c;return ctx.fillStyle;}
  function rgbOf(c){const m=/^#([0-9a-f]{6})$/i.exec(c);if(m){const n=parseInt(m[1],16);return [n>>16,(n>>8)&255,n&255];}
    const r=/rgba?\(([^)]+)\)/.exec(c);if(!r)return null;const v=r[1].split(',').map(Number);return v.length>3&&v[3]===0?null:v;}
  function readTheme(){
    const cs=getComputedStyle(document.documentElement),v=n=>cs.getPropertyValue(n).trim();
    ink=norm(v('--text')||'#0a0a0a');
    const p=v('--panel')||v('--surface');bg=p?norm(p):'';bgRgb=bg?rgbOf(bg):null;if(!bgRgb)bg='';
    font=getComputedStyle(document.body||document.documentElement).fontFamily||'sans-serif';
    S={};for(const k in ART)S[k]=paint(ART[k],ink);
    S.glassesHalo=paint(ART.glassesHalo,bg||'#000');S.glassesBg=paint(ART.glasses,bg||'#000');
    if(!rafId)draw();
  }
  function measure(){
    resizeQueued=0;if(destroyed)return;
    const w=Math.floor(root.getBoundingClientRect().width);if(!w)return;
    const cs=getComputedStyle(container);
    const avail=container.clientHeight-(parseFloat(cs.paddingTop)||0)-(parseFloat(cs.paddingBottom)||0);
    const h=Math.max(100,Math.floor(avail>=60?Math.min(avail,maxH):maxH));
    const d=Math.min(1.5,window.devicePixelRatio||1);
    if(w===cssW&&h===cssH&&d===dpr)return;
    cssW=w;cssH=h;dpr=d;cw=Math.round(w*d);ch=Math.round(h*d);
    cv.width=buf.width=lens.width=cw;cv.height=buf.height=lens.height=ch;cv.style.height=h+'px';
    // Whole device pixels per sprite pixel keep the art crisp; the world is about 80 units tall.
    P=Math.max(1,Math.floor(ch/80));WW=cw/P;WH=ch/P;GY=Math.floor(WH-Math.max(7,WH*0.1));RX=Math.round(clamp(WW*0.08,10,40));
    if(onGround)rb=GY;
    clouds.forEach(c=>{c.x=rnd(0,WW);c.y=rnd(4,GY-42);c.f=rnd(0.1,0.25);});
    pebbles.forEach(p=>{p.x=rnd(0,WW);p.y=rnd(2,6)|0;p.w=Math.random()<0.3?2:1;});
    buildLens();
    if(!rafId)draw();
  }
  // Sunglasses frame for the flight view, drawn once per size.
  function buildLens(){
    const g=lx;g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,cw,ch);g.globalCompositeOperation='source-over';
    g.fillStyle='rgba(8,6,14,.94)';g.fillRect(0,0,cw,ch);
    const rx=cw*0.245,ry=ch*0.47,ly=ch*0.52;
    g.globalCompositeOperation='destination-out';g.beginPath();g.ellipse(cw*0.26,ly,rx,ry,0,0,Math.PI*2);g.ellipse(cw*0.74,ly,rx,ry,0,0,Math.PI*2);g.fill();
    g.globalCompositeOperation='source-over';
    g.fillStyle='rgba(40,0,70,.12)';g.beginPath();g.ellipse(cw*0.26,ly,rx,ry,0,0,Math.PI*2);g.ellipse(cw*0.74,ly,rx,ry,0,0,Math.PI*2);g.fill();
    g.lineWidth=Math.max(3,ch*0.03);g.strokeStyle='#08060e';
    g.beginPath();g.ellipse(cw*0.26,ly,rx,ry,0,0,Math.PI*2);g.stroke();g.beginPath();g.ellipse(cw*0.74,ly,rx,ry,0,0,Math.PI*2);g.stroke();
    g.fillStyle='#08060e';g.fillRect(cw*0.47,ch*0.05,cw*0.06,ch*0.07);
    g.lineWidth=Math.max(2,ch*0.012);g.strokeStyle='rgba(255,255,255,.22)';
    g.beginPath();g.ellipse(cw*0.26,ly,rx*0.82,ry*0.82,0,Math.PI*1.1,Math.PI*1.35);g.stroke();
    g.beginPath();g.ellipse(cw*0.74,ly,rx*0.82,ry*0.82,0,Math.PI*1.1,Math.PI*1.35);g.stroke();
  }

  // ---- Sound: quiet retro blips, created on the first key press or tap ----------------------------
  function unlockAudio(){
    if(ac===null){try{const A=window.AudioContext||window.webkitAudioContext;ac=new A();master=ac.createGain();master.gain.value=muted?0:0.07;master.connect(ac.destination);
      noise=ac.createBuffer(1,ac.sampleRate*0.4,ac.sampleRate);const d=noise.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;}catch{ac=false;}}
    if(ac&&ac.state==='suspended')ac.resume().catch(()=>{});
  }
  function tone(f1,f2,dur,type,vol,delay){
    if(!ac||muted)return;const t=ac.currentTime+(delay||0),o=ac.createOscillator(),g=ac.createGain();
    o.type=type||'square';o.frequency.setValueAtTime(f1,t);if(f2)o.frequency.exponentialRampToValueAtTime(f2,t+dur);
    g.gain.setValueAtTime(vol||0.6,t);g.gain.exponentialRampToValueAtTime(0.001,t+dur);o.connect(g);g.connect(master);o.start(t);o.stop(t+dur+0.02);
  }
  function hiss(dur,vol,freq){
    if(!ac||muted)return;const t=ac.currentTime,s=ac.createBufferSource(),f=ac.createBiquadFilter(),g=ac.createGain();
    s.buffer=noise;f.type='lowpass';f.frequency.value=freq||1200;g.gain.setValueAtTime(vol||0.6,t);g.gain.exponentialRampToValueAtTime(0.001,t+dur);
    s.connect(f);f.connect(g);g.connect(master);s.start(t);s.stop(t+dur);
  }
  const sfx={
    jump(){tone(420,760,0.09,'square',0.35);},
    milestone(){tone(880,0,0.07,'square',0.3);tone(1320,0,0.1,'square',0.3,0.08);},
    crash(){hiss(0.3,0.7,900);tone(220,55,0.32,'sawtooth',0.35);},
    mush(){tone(523,0,0.07,'triangle',0.5);tone(659,0,0.07,'triangle',0.5,0.07);tone(784,0,0.07,'triangle',0.5,0.14);tone(1047,0,0.12,'triangle',0.5,0.21);},
    whoosh(){ // a slow wobbly slide: an LFO on the pitch makes the "trip" sound
      if(!ac||muted)return;const t=ac.currentTime,o=ac.createOscillator(),l=ac.createOscillator(),lg=ac.createGain(),g=ac.createGain();
      o.type='sine';o.frequency.setValueAtTime(180,t);o.frequency.exponentialRampToValueAtTime(900,t+1.4);
      l.frequency.value=7;lg.gain.value=70;l.connect(lg);lg.connect(o.frequency);
      g.gain.setValueAtTime(0.001,t);g.gain.exponentialRampToValueAtTime(0.4,t+0.3);g.gain.exponentialRampToValueAtTime(0.001,t+1.5);
      o.connect(g);g.connect(master);o.start(t);l.start(t);o.stop(t+1.55);l.stop(t+1.55);},
    smack(){hiss(0.08,0.9,3000);tone(160,45,0.18,'square',0.5);tone(1800,0,0.05,'square',0.25,0.02);},
    ring(){tone(988,1480,0.12,'triangle',0.45);},
    bump(){hiss(0.2,0.6,600);tone(140,60,0.2,'square',0.35);},
    warp(){tone(1200,120,0.6,'sine',0.35);},
  };
  function setMuted(m){muted=m;save(MUTE_KEY,m?'1':'0');if(master)master.gain.value=m?0:0.07;drawMute();}
  function drawMute(){
    muteBtn.title=muted?'Unmute (M)':'Mute (M)';muteBtn.setAttribute('aria-label',muteBtn.title);
    muteBtn.innerHTML='<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z"/>'+
      (muted?'<path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" stroke-width="1.5" fill="none"/>':'<path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" stroke="currentColor" stroke-width="1.3" fill="none"/>')+'</svg>';
  }

  // ---- Pools -------------------------------------------------------------------------------------
  function take(pool){for(let i=0;i<pool.length;i++)if(!pool[i].on)return pool[i];return null;}
  function burst(n,x,y,spread,up,screen,hue){
    for(let i=0;i<n;i++){const p=take(parts);if(!p)return;p.on=true;p.sp=!!screen;p.x=x;p.y=y;p.vx=rnd(-spread,spread);p.vy=rnd(-up,up*0.3);
      p.life=p.max=rnd(0.35,0.8);p.s=screen?rnd(2,5)*dpr:(Math.random()<0.4?2:1);p.hue=hue===undefined?rnd(0,360):hue+rnd(-40,40);}
  }
  function pop(txt){const p=take(pops);if(!p)return;p.on=true;p.t=0;p.x=rnd(-0.1,0.1)*cw;p.y=-ch*0.1;p.txt=txt;}

  // ---- Game flow ---------------------------------------------------------------------------------
  function start(){
    phase='play';paused=false;mode='run';modeT=0;score=0;nextMilestone=100;speed=SPEED0;tint=0;cool=false;invuln=0;flash=0;shake=0;
    rb=GY;rvy=0;onGround=true;ducking=false;spawnGap=WW*0.55+speed*1.5;mushCool=0;hadMush=false;scoreShown=-1;
    obs.forEach(o=>{o.on=false;});parts.forEach(p=>{p.on=false;});
    startLoop();
  }
  function addScore(n){
    score+=n;if(score>=nextMilestone){nextMilestone+=100;flashT=1;sfx.milestone();}
  }
  function gameOver(){
    phase='over';overT=0;shake=6;sfx.crash();burst(14,RX+9,rb-8,60,90);
    const s=Math.floor(score);if(s>best){best=s;save(BEST_KEY,best);}
  }
  function eatMushroom(o){
    o.on=false;hadMush=true;sfx.mush();sfx.whoosh();burst(12,o.x+4,o.y+4,50,70);addScore(25);
    mode='melt';modeT=0;impacted=false;
  }
  function spawn(){
    const v=speed,o=take(obs);if(!o)return;
    o.on=true;o.x=WW+4;o.anim=0;o.vx=0;
    const late=score>180;
    if(late&&Math.random()<0.3){
      o.kind=DRONE;o.w=14;o.h=8;o.n=0;o.vx=rnd(15,40);
      const r=Math.random();o.y=r<0.4?GY-10:r<0.8?GY-17:GY-31;
    }else{
      o.kind=CACTUS;const r=Math.random(),lv=score<120?0:score<400?1:2;
      const set=lv===0?(r<0.6?'S':r<0.85?'B':'T'):lv===1?(r<0.3?'S':r<0.5?'SS':r<0.7?'T':r<0.85?'BS':'TS'):(r<0.2?'SS':r<0.4?'SSS':r<0.6?'TS':r<0.8?'TB':'T');
      let x=0,h=0;o.n=set.length;
      for(let i=0;i<o.n;i++){const s=set[i]==='S'?S.cactusS:set[i]==='T'?S.cactusT:S.cactusB;o.spr[i]=s;o.ox[i]=x;o.oy[i]=GY-s.height;x+=s.width+1;h=Math.max(h,s.height);}
      o.w=x-1;o.h=h;o.y=GY-h;
    }
    spawnGap=o.w+v*rnd(0.62,1.35)*(1-Math.min(0.25,score/4000));
    // Mushrooms sit halfway along the gap, on the ground or at jump height; the first one comes early.
    if(mushCool<=0&&score>60&&(!hadMush&&score>100||Math.random()<0.16)){
      const m=take(obs);if(m){m.on=true;m.kind=MUSH;m.w=9;m.h=9;m.n=0;m.vx=0;m.anim=rnd(0,6);m.x=o.x+o.w+spawnGap*0.5-4;m.y=Math.random()<0.5?GY-10:GY-30;mushCool=150;hadMush=true;}
    }
  }
  const hit=(ax,ay,aw,ah,bx2,by,bw,bh)=>ax<bx2+bw&&ax+aw>bx2&&ay<by+bh&&ay+ah>by;
  function robotHits(x,y,w,h){
    if(ducking&&onGround)return hit(RX+4,rb-8,14,7,x,y,w,h);
    return hit(RX+4,rb-11,11,8,x,y,w,h)||hit(RX+5,rb-4,8,4,x,y,w,h);
  }
  function jumpPress(){
    if(phase!=='play'||paused||mode==='fly'||mode==='warpIn'||mode==='warpOut')return;
    if(onGround){rvy=-200;onGround=false;holdT=0;sfx.jump();}
  }

  function update2D(dt){
    const slow=mode==='run'?1:0.35;
    if(mode==='run'){speed=Math.min(SPEED_MAX,speed+ACCEL*dt*(speed<200?1:0.6));}
    const v=speed*slow;
    if(mode==='run')addScore(v*dt*0.08);
    // Robot: hold the jump for a higher, floatier arc; duck in the air to drop fast.
    const holding=held.jump||held.ptr||pad.a;ducking=held.duck||pad.duck;
    if(!onGround){
      holdT+=dt;const g=ducking?2600:holding&&rvy<0&&holdT<0.25?520:1300;
      rvy+=g*dt;rb+=rvy*dt;
      if(rb>=GY){rb=GY;rvy=0;onGround=true;burst(3,RX+8,GY-1,25,15);}
    }
    runAnim+=dt*v/14;
    if(invuln>0)invuln-=dt;
    for(let i=0;i<obs.length;i++){const o=obs[i];if(!o.on)continue;
      o.x-=(v+o.vx*slow)*dt;o.anim+=dt;
      if(o.x+o.w<-4){o.on=false;continue;}
      if(phase!=='play'||mode!=='run')continue;
      if(o.kind===MUSH){if(hit(RX+3,rb-15,13,15,o.x-1,o.y-1+Math.sin(o.anim*4)*1.5,11,11))eatMushroom(o);continue;}
      if(invuln>0)continue;
      if(o.kind===DRONE){if(robotHits(o.x+1,o.y+1,12,6)){gameOver();return;}}
      else for(let k=0;k<o.n;k++){const s=o.spr[k];if(robotHits(o.x+o.ox[k]+1,o.oy[k]+1,s.width-2,s.height-1)){gameOver();return;}}
    }
    if(mode==='run'&&phase==='play'){spawnGap-=v*dt;if(spawnGap<=0)spawn();mushCool-=v*dt*0.08;}
    for(const c of clouds){c.x-=v*c.f*dt;if(c.x<-24){c.x=WW+rnd(0,40);c.y=rnd(4,Math.max(5,GY-42));}}
    const np=Math.min(pebbles.length,Math.ceil(WW/10));
    for(let i=0;i<np;i++){const p=pebbles[i];p.x-=v*dt;if(p.x<-3){p.x+=WW+6;p.y=rnd(2,6)|0;p.w=Math.random()<0.3?2:1;}}
  }
  function startFly(){
    fx=0;fy=0.6;fvx=fvy=0;ftravel=0;lives=3;fhit=0;spawn3=0.4;flyT=0;roll=0;fdone=false;
    objs.forEach(o=>{o.on=false;});cracks.forEach(c=>{c.on=false;});pops.forEach(p=>{p.on=false;});
  }
  function spawnObj(){
    const o=take(objs);if(!o)return;
    const r=Math.random();o.on=true;o.z=FAR;o.a=rnd(0,6);o.va=rnd(-2,2);o.hue=rnd(0,360);
    o.kind=r<0.32?CACTUS:r<0.62?ROCK:r<0.84?RING:MUSH;
    const aim=Math.random()<0.35; // some come straight at you so dodging matters
    o.x=clamp(aim?fx+rnd(-0.6,0.6):rnd(-6,6),-6,6);o.y=aim?fy+rnd(-0.5,0.5):rnd(YMIN,YMAX);
    if(o.kind===CACTUS){o.h=rnd(2.4,5.2);o.y=FLOOR;}
    else if(o.kind===ROCK){o.r=rnd(0.5,1.2);for(let i=0;i<7;i++)o.rad[i]=rnd(0.7,1.15);}
    else if(o.kind===RING){o.r=1.5;o.x=clamp(o.x,-XMAX,XMAX);o.y=clamp(o.y,YMIN,YMAX);}
    else o.r=0.8;
  }
  function crack(){
    const c=take(cracks);if(!c)return;c.on=true;
    let x=(Math.random()<0.5?0.26:0.74)*cw+rnd(-0.1,0.1)*cw,y=rnd(0.3,0.7)*ch,a=rnd(0,Math.PI*2);
    for(let i=0;i<7;i++){c.pts[i*2]=x;c.pts[i*2+1]=y;a+=rnd(-0.9,0.9);const d=rnd(0.03,0.07)*ch;x+=Math.cos(a)*d*2;y+=Math.sin(a)*d;}
  }
  function update3D(dt,live){
    let ix=(held.right?1:0)-(held.left?1:0)+pad.x,iy=(held.down?1:0)-(held.up?1:0)+pad.y;
    if(!ix&&!iy&&time-mouseT<1.5){ix=clamp((mtx-fx)*0.9,-1,1);iy=clamp((mty-fy)*0.9,-1,1);}
    ix=clamp(ix,-1,1);iy=clamp(iy,-1,1);
    const k=Math.min(1,dt*7);fvx+=(ix*8-fvx)*k;fvy+=(iy*6-fvy)*k;
    fx=clamp(fx+fvx*dt,-XMAX,XMAX);fy=clamp(fy+fvy*dt,YMIN,YMAX);
    roll=-fvx*0.03+Math.sin(time*1.3)*0.04;
    fspeed=Math.min(26,15+flyT*0.55);ftravel+=fspeed*dt;
    if(fhit>0)fhit-=dt;
    if(live){
      flyT+=dt;addScore(dt*12);
      spawn3-=dt;if(spawn3<=0){spawnObj();spawn3=Math.max(0.17,0.32-flyT*0.007);}
      if(flyT>=TRIP_LEN&&!fdone){fdone=true;endTrip();}
    }
    for(let i=0;i<objs.length;i++){const o=objs[i];if(!o.on)continue;
      const pz=o.z;o.z-=fspeed*dt;o.a+=o.va*dt;
      if(o.z<-2){o.on=false;continue;}
      if(!live||!(pz>=0&&o.z<0))continue;
      // The object just crossed the player's plane: test against the player at the screen centre.
      const dx=o.x-fx,dy=o.y-fy,d=Math.hypot(dx,dy);
      if(o.kind===RING){if(d<1.15){addScore(50);pop('+50');sfx.ring();burst(14,0,0,ch*0.6,ch*0.6,true,o.hue);}}
      else if(o.kind===MUSH){if(d<1.0){o.on=false;addScore(25);pop('+25');flyT=Math.max(0,flyT-2);sfx.mush();burst(10,0,0,ch*0.5,ch*0.5,true,300);}}
      else if(fhit<=0){
        const bang=o.kind===CACTUS?Math.abs(dx)<0.75&&fy>FLOOR-o.h-0.4:d<o.r*0.85+0.35;
        if(bang){lives--;fhit=1;shake=12;flash=0.7;flashRed=true;crack();sfx.bump();if(lives<=0&&!fdone){fdone=true;endTrip();}}
      }
    }
    for(const p of pops)if(p.on){p.t+=dt;if(p.t>0.9)p.on=false;}
  }
  function endTrip(){mode='warpOut';modeT=0;sfx.warp();}
  function stepParticles(dt){
    for(let i=0;i<parts.length;i++){const p=parts[i];if(!p.on)continue;p.life-=dt;if(p.life<=0){p.on=false;continue;}
      p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=(p.sp?ch*0.8:200)*dt;}
  }
  function step(dt){
    time+=dt;hueT+=dt*90;
    if(shake>0)shake=Math.max(0,shake-dt*25);if(flash>0)flash=Math.max(0,flash-dt*2.2);if(flashT>0)flashT-=dt;
    stepParticles(dt);
    if(phase==='over'){overT+=dt;return;}
    if(phase!=='play')return;
    pollPad();modeT+=dt;
    switch(mode){
      case 'run':update2D(dt);if(tint>0)tint=Math.max(0,tint-dt/1.4);break;
      case 'melt':update2D(dt);tint=Math.min(1,modeT/1.0);if(modeT>=MELT){mode='glasses';modeT=0;}break;
      case 'glasses':update2D(dt);
        if(!impacted&&modeT>=0.45){impacted=true;cool=true;flash=0.9;flashRed=false;shake=9;sfx.smack();burst(12,RX+9,rb-11,70,80);}
        if(modeT>=GLASSES){mode='warpIn';modeT=0;startFly();sfx.warp();}break;
      case 'warpIn':update3D(dt,false);if(modeT>=WARP_IN){mode='fly';modeT=0;}break;
      case 'fly':update3D(dt,true);break;
      case 'warpOut':update3D(dt,false);tint=1;
        if(modeT>=WARP_OUT){mode='run';modeT=0;invuln=2;rb=GY;rvy=0;onGround=true;obs.forEach(o=>{o.on=false;});spawnGap=speed*1.2;mushCool=250;}break;
    }
  }
  function pollPad(){
    pad.on=false;const list=navigator.getGamepads?navigator.getGamepads():null;if(!list)return;
    let p=null;for(let i=0;i<list.length;i++)if(list[i]&&list[i].connected){p=list[i];break;}
    if(!p){pad.a=pad.duck=false;pad.x=pad.y=0;return;}
    pad.on=true;const b=i=>!!(p.buttons[i]&&p.buttons[i].pressed),dz=v=>Math.abs(v)<0.2?0:v;
    const a=b(0);if(a&&!pad.a)jumpPress();pad.a=a;
    const flying=mode==='fly'||mode==='warpIn'||mode==='warpOut';
    pad.duck=!flying&&(b(1)||b(13));
    pad.x=flying?dz(p.axes[0]||0)+(b(15)?1:0)-(b(14)?1:0):0;pad.y=flying?dz(p.axes[1]||0)+(b(13)?1:0)-(b(12)?1:0):0;
  }

  // ---- Drawing -----------------------------------------------------------------------------------
  const flying=()=>mode==='fly'||mode==='warpIn'||mode==='warpOut';
  function draw(){
    if(!cw||destroyed)return;
    const shx=shake?rnd(-shake,shake)*dpr*0.5:0,shy=shake?rnd(-shake,shake)*dpr*0.5:0;
    ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.imageSmoothingEnabled=false;
    ctx.clearRect(0,0,cw,ch);
    const light=phase==='play'&&(flying()||tint>0.3); // the mute icon turns white over trip colours
    if(light!==muteLight){muteLight=light;muteBtn.style.color=light?'#fff':'inherit';}
    if(phase==='play'&&flying()){
      draw3D(ctx,shx,shy);
      if(mode!=='fly'){ // warp: the side view zooms and spins into (or out of) the robot's face
        const p=mode==='warpIn'?modeT/WARP_IN:1-modeT/WARP_OUT,e=clamp(p,0,1);
        render2D();const cx=(RX+10)*P,cy=(rb-9)*P;
        ctx.save();ctx.globalAlpha=1-e;ctx.translate(cx,cy);ctx.rotate(e*e*1.6*(mode==='warpIn'?1:-1));ctx.scale(1+e*e*9,1+e*e*9);ctx.translate(-cx,-cy);
        ctx.drawImage(buf,0,0);ctx.restore();
      }
      ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=mode==='fly'?1:clamp(mode==='warpIn'?modeT/WARP_IN:1-modeT/WARP_OUT,0,1);
      ctx.drawImage(lens,0,0);ctx.globalAlpha=1;drawCracks();
    }else if(tint>0||mode==='melt'||mode==='glasses'){
      render2D();
      const wob=(mode==='melt'?Math.min(1,modeT/0.8):mode==='glasses'?1:tint*0.7)*P*3;
      ctx.fillStyle=bgNow();ctx.fillRect(0,0,cw,ch);
      // Cheap melt: copy the frame in strips, each pushed sideways along a sine.
      const sh=Math.max(2,Math.round(3*dpr));
      for(let y=0;y<ch;y+=sh)ctx.drawImage(buf,0,y,cw,sh,shx+Math.sin(y*0.035+time*7)*wob,y+shy,cw,sh);
    }else{
      if(bg){ctx.fillStyle=bg;ctx.fillRect(0,0,cw,ch);}
      draw2D(ctx,shx,shy);
    }
    if(flash>0){ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=flash*0.8;ctx.fillStyle=flashRed?'#ff2a55':'#fff';ctx.fillRect(0,0,cw,ch);ctx.globalAlpha=1;}
    drawHud();
  }
  function bgNow(){
    const [r,g,b]=hslRgb(hueT+200,0.7,0.18);
    if(!bgRgb)return `rgba(${r|0},${g|0},${b|0},${tint})`;
    const m=(a,c)=>(a+(c-a)*tint)|0;return `rgb(${m(bgRgb[0],r)},${m(bgRgb[1],g)},${m(bgRgb[2],b)})`;
  }
  // The side view into the buffer, tinted with rainbow bands over the ink only, background underneath.
  function render2D(){
    bx.setTransform(1,0,0,1,0,0);bx.globalAlpha=1;bx.globalCompositeOperation='source-over';bx.imageSmoothingEnabled=false;
    bx.clearRect(0,0,cw,ch);draw2D(bx,0,0,true);
    bx.setTransform(1,0,0,1,0,0);
    if(tint>0){bx.globalCompositeOperation='source-atop';bx.globalAlpha=tint;const bw=Math.ceil(cw/10);
      for(let i=0;i<10;i++){bx.fillStyle=pal(0,hueT*1.5+i*36);bx.fillRect(i*bw,0,bw,ch);}bx.globalAlpha=1;}
    bx.globalCompositeOperation='destination-over';bx.fillStyle=bgNow();bx.fillRect(0,0,cw,ch);bx.globalCompositeOperation='source-over';
  }
  function draw2D(g,ox,oy,buffered){
    g.setTransform(P,0,0,P,ox,oy);g.fillStyle=ink;
    for(const c of clouds)if(c.x<WW)g.drawImage(S.cloud,Math.round(c.x),Math.round(c.y));
    g.fillRect(0,GY,WW,1);
    const np=Math.min(pebbles.length,Math.ceil(WW/10));
    for(let i=0;i<np;i++){const p=pebbles[i];g.fillRect(Math.round(p.x),GY+p.y,p.w,1);}
    for(let i=0;i<obs.length;i++){const o=obs[i];if(!o.on||o.x>WW)continue;const x=Math.round(o.x);
      if(o.kind===CACTUS)for(let k=0;k<o.n;k++)g.drawImage(o.spr[k],x+o.ox[k],o.oy[k]);
      else if(o.kind===DRONE)g.drawImage((o.anim*12|0)%2?S.drone1:S.drone0,x,Math.round(o.y+Math.sin(o.anim*5)));
      else g.drawImage(S.mush,x,Math.round(o.y+Math.sin(o.anim*4)*1.5));
    }
    drawRobot(g,buffered);
    if(phase==='play'&&mode==='glasses'&&!impacted){ // the sunglasses fly in on an arc, spinning
      const t=clamp(modeT/0.45,0,1),x0=WW+12,y0=rb-40,x1=RX+2,y1=rb-11;
      const x=x0+(x1-x0)*t,y=y0+(y1-y0)*t-Math.sin(t*Math.PI)*18;
      g.save();g.translate(x+6,y+2);g.rotate((1-t)*9);drawGlasses(g,-6,-2,buffered);g.restore();
    }
    for(let i=0;i<parts.length;i++){const p=parts[i];if(!p.on||p.sp)continue;g.globalAlpha=Math.min(1,p.life/p.max*1.5);g.fillRect(Math.round(p.x),Math.round(p.y),p.s,p.s);}
    g.globalAlpha=1;
  }
  // On the head the shades are cut out of the ink (dark on dark reads as negative space) with a glint;
  // in flight they are ink with a halo.
  function drawGlasses(g,x,y,buffered,worn){
    const cut=buffered||!bg;
    if(worn){if(cut)g.globalCompositeOperation='destination-out';g.drawImage(cut?S.glasses:S.glassesBg,x,y);g.globalCompositeOperation='source-over';
      g.fillStyle=ink;g.fillRect(x+5,y+1,1,1);g.fillRect(x+10,y+1,1,1);return;}
    if(cut)g.globalCompositeOperation='destination-out';g.drawImage(S.glassesHalo,x-1,y-1);g.globalCompositeOperation='source-over';
    g.drawImage(S.glasses,x,y);
  }
  function drawRobot(g,buffered){
    if(phase==='play'&&invuln>0&&(invuln*10|0)%2)return;
    const over=phase==='over',duck=!over&&ducking&&onGround&&phase==='play',fr=(runAnim|0)%2;
    const spr=over||phase!=='play'?S.run0:duck?(fr?S.duck1:S.duck0):!onGround?S.jump:fr?S.run1:S.run0;
    const x=RX,y=Math.round(rb)-spr.height+(phase==='play'&&onGround&&!duck&&fr?-1:0);
    g.drawImage(spr,x,y);
    const e=duck?EYES_DUCK:EYES_STAND;g.fillStyle=ink;
    for(let k=0;k<4;k+=2){const ex=x+e[k],ey=y+e[k+1];
      if(over){g.fillRect(ex,ey,1,1);g.fillRect(ex+2,ey,1,1);g.fillRect(ex+1,ey+1,1,1);g.fillRect(ex,ey+2,1,1);g.fillRect(ex+2,ey+2,1,1);}
      else if(phase==='play'&&(mode==='melt'||mode==='glasses'&&!impacted)){ // spinning trip eyes
        const i=((time*18|0)+k*2)%8;g.fillRect(ex+1,ey+1,1,1);g.fillRect(ex+SPIN[i*2],ey+SPIN[i*2+1],1,1);g.fillRect(ex+SPIN[(i+4)%8*2],ey+SPIN[(i+4)%8*2+1],1,1);}
      else if(phase==='idle'&&blinkT<0.15)g.fillRect(ex,ey+1,3,1);
      else g.fillRect(ex+1,ey+1,1,1);
    }
    if(cool)drawGlasses(g,x+e[0]-4,y+e[1]-1,buffered,true);
  }
  function draw3D(g,shx,shy){
    const f=ch*0.85,hy=-ch*0.06,D=Math.hypot(cw,ch)/2+8,ht=hueT;
    g.setTransform(1,0,0,1,cw/2+shx,ch/2+shy);g.rotate(roll);
    // Sky in shifting bands, a striped sun, jagged mountains, then the floor grid.
    const bands=7,bh=(hy+D)/bands;
    for(let i=0;i<bands;i++){g.fillStyle=pal(i<4?2:1,ht*0.6+i*22+200);g.fillRect(-D,-D+i*bh,2*D,bh+1);}
    const R=ch*0.26,sy=hy-R*0.3,sx=-fx*f*0.012;
    g.fillStyle=pal(0,ht*0.6+40);g.beginPath();g.arc(sx,sy,R,0,Math.PI*2);g.fill();
    g.fillStyle=pal(1,ht*0.6+6*22+200);for(let k=0;k<5;k++){const yy=sy+R*(0.05+k*0.2);g.fillRect(sx-R,yy,2*R,R*(0.04+k*0.03));}
    const step=2*D/24,shift=-fx*f*0.02,off=((shift%step)+step)%step,base=Math.floor(shift/step);
    g.fillStyle=pal(2,ht*0.6+280);g.beginPath();g.moveTo(-D,hy);
    for(let i=-1;i<=25;i++){const m=mountains[(((i-base)%32)+32)%32];g.lineTo(-D+i*step+off,hy-m*ch*0.12);}
    g.lineTo(D,hy);g.closePath();g.fill();
    g.fillStyle=pal(2,ht*0.6+300);g.fillRect(-D,hy,2*D,D);
    g.strokeStyle=pal(0,ht+160);g.lineWidth=Math.max(1,dpr);g.beginPath();
    const ground=FLOOR-fy;
    for(let i=0;i<14;i++){const z=i*4+4-(ftravel%4);if(z<0.5||z>FAR)continue;const y=ground*f/z+hy;if(y>D)continue;g.moveTo(-D,y);g.lineTo(D,y);}
    for(let j=-14;j<=14;j++){const x=j*2.5-fx;g.moveTo(x*f/0.7,ground*f/0.7+hy);g.lineTo(x*f/FAR,ground*f/FAR+hy);}
    g.stroke();
    // Your shadow a few metres ahead shows your height above the floor.
    const s3=f/3;g.fillStyle='rgba(0,0,0,.35)';g.beginPath();g.ellipse(0,ground*s3+hy,0.45*s3,0.12*s3,0,0,Math.PI*2);g.fill();
    // Painter's algorithm: far to near, insertion sort on a reused array.
    let n=0;for(let i=0;i<objs.length;i++)if(objs[i].on&&objs[i].z>0.25)order[n++]=objs[i];
    for(let i=1;i<n;i++){const o=order[i];let j=i-1;while(j>=0&&order[j].z<o.z){order[j+1]=order[j];j--;}order[j+1]=o;}
    for(let i=0;i<n;i++){const o=order[i],s=f/o.z;g.globalAlpha=clamp((FAR-o.z)/12,0,1);drawObj(g,o,s,(o.x-fx)*s,(o.y-fy)*s+hy,hy);}
    g.globalAlpha=1;
    g.strokeStyle='rgba(255,255,255,.55)';g.lineWidth=Math.max(1,dpr*1.2);const c=ch*0.025;
    g.beginPath();g.moveTo(-c,hy);g.lineTo(-c*0.4,hy);g.moveTo(c*0.4,hy);g.lineTo(c,hy);g.moveTo(0,hy-c);g.lineTo(0,hy-c*0.4);g.moveTo(0,hy+c*0.4);g.lineTo(0,hy+c);g.stroke();
    for(let i=0;i<parts.length;i++){const p=parts[i];if(!p.on||!p.sp)continue;g.globalAlpha=Math.min(1,p.life/p.max*1.5);g.fillStyle=pal(0,p.hue);g.fillRect(p.x,p.y+hy,p.s,p.s);}
    g.globalAlpha=1;
  }
  function drawObj(g,o,s,sx,sy,hy){
    const hue=o.hue+hueT*0.5;
    if(o.kind===CACTUS){
      const w=0.7*s,top=(FLOOR-o.h-fy)*s+hy,base=sy,aw=0.3*s;
      g.fillStyle=pal(1,hue);g.fillRect(sx-w/2,top,w,base-top);
      g.beginPath();g.arc(sx,top,w/2,Math.PI,0);g.fill();
      const a1=(FLOOR-o.h*0.5-fy)*s+hy,a2=(FLOOR-o.h*0.68-fy)*s+hy;
      g.fillRect(sx-w/2-0.55*s,a1,0.55*s,aw);g.fillRect(sx-w/2-0.55*s,a1-0.9*s,aw,0.9*s+aw);
      g.fillRect(sx+w/2,a2,0.5*s,aw);g.fillRect(sx+w/2+0.5*s-aw,a2-0.7*s,aw,0.7*s+aw);
      g.fillStyle=pal(2,hue);g.fillRect(sx+w*0.12,top,w*0.38,base-top);
    }else if(o.kind===ROCK){
      const r=o.r*s;g.fillStyle=pal(2,hue+30);g.beginPath();
      for(let i=0;i<7;i++){const a=o.a+i*0.8976,q=o.rad[i]*r;i?g.lineTo(sx+Math.cos(a)*q,sy+Math.sin(a)*q):g.moveTo(sx+Math.cos(a)*q,sy+Math.sin(a)*q);}
      g.closePath();g.fill();g.fillStyle=pal(1,hue+30);g.beginPath();
      for(let i=0;i<7;i++){const a=o.a+i*0.8976,q=o.rad[i]*r*0.55,cx=sx-r*0.18,cy=sy-r*0.18;i?g.lineTo(cx+Math.cos(a)*q,cy+Math.sin(a)*q):g.moveTo(cx+Math.cos(a)*q,cy+Math.sin(a)*q);}
      g.closePath();g.fill();
    }else if(o.kind===RING){
      g.lineWidth=0.24*s;g.strokeStyle=pal(0,hue+hueT);g.beginPath();g.arc(sx,sy,o.r*s,0,Math.PI*2);g.stroke();
      g.lineWidth=0.07*s;g.strokeStyle='#fff';g.beginPath();g.arc(sx,sy,o.r*s,0,Math.PI*2);g.stroke();
    }else{
      g.fillStyle='#f3e9d2';g.fillRect(sx-0.22*s,sy,0.44*s,0.65*s);
      g.fillStyle=pal(1,hue);g.beginPath();g.ellipse(sx,sy+0.05*s,0.85*s,0.6*s,0,Math.PI,0);g.fill();
      g.fillStyle='#fff';g.beginPath();g.arc(sx-0.35*s,sy-0.2*s,0.13*s,0,Math.PI*2);g.arc(sx+0.25*s,sy-0.35*s,0.11*s,0,Math.PI*2);g.arc(sx+0.5*s,sy-0.08*s,0.08*s,0,Math.PI*2);g.fill();
    }
  }
  function drawCracks(){
    ctx.setTransform(1,0,0,1,0,0);ctx.strokeStyle='rgba(255,255,255,.75)';ctx.lineWidth=Math.max(1,dpr);ctx.beginPath();
    for(const c of cracks)if(c.on){ctx.moveTo(c.pts[0],c.pts[1]);for(let i=1;i<7;i++)ctx.lineTo(c.pts[i*2],c.pts[i*2+1]);}
    ctx.stroke();
  }
  function text(str,x,y,size,weight,align,color,outline){
    ctx.font=`${weight} ${size}px ${font}`;ctx.textAlign=align;ctx.textBaseline='middle';
    if(outline){ctx.lineWidth=outline===bg?5:3;ctx.lineJoin='round';ctx.strokeStyle=outline;ctx.strokeText(str,x,y);}
    ctx.fillStyle=color;ctx.fillText(str,x,y);
  }
  function drawHud(){
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.globalAlpha=1;
    const fs=Math.round(clamp(cssH*0.07,11,16)),fly=phase==='play'&&flying(),bright=fly||tint>0.3;
    const col=bright?'#fff':ink,ol=bright?'rgba(0,0,0,.6)':'';
    const s=Math.floor(score);
    if(s!==scoreShown){scoreShown=s;scoreText=(best?`HI ${String(best).padStart(5,'0')}   `:'')+String(s).padStart(5,'0');}
    if(phase!=='idle'&&!(flashT>0&&(flashT*8|0)%2))text(scoreText,cssW-10,14,fs,600,'right',col,ol||bg);
    else if(phase==='idle'&&best)text(`HI ${String(best).padStart(5,'0')}`,cssW-10,14,fs,600,'right',col,ol);
    if(fly){ // trip timer and spare sunglasses
      const w=Math.min(160,cssW*0.3),x=cssW/2-w/2,left=clamp(1-flyT/TRIP_LEN,0,1);
      ctx.fillStyle='rgba(0,0,0,.5)';ctx.fillRect(x,cssH-14,w,5);ctx.fillStyle=pal(0,hueT);ctx.fillRect(x,cssH-14,w*left,5);
      ctx.imageSmoothingEnabled=false;
      for(let i=0;i<3;i++){ctx.globalAlpha=i<lives?1:0.25;ctx.drawImage(S.glassesWhite||(S.glassesWhite=paint(ART.glasses,'#fff')),36+i*26,8,22,8);}
      ctx.globalAlpha=1;
      for(const p of pops)if(p.on){ctx.globalAlpha=1-p.t/0.9;text(p.txt,cssW/2+p.x/dpr,cssH*0.4-p.t*30,fs*1.3,700,'center','#fff','rgba(0,0,0,.6)');}
      ctx.globalAlpha=1;
      if(mode==='fly'&&flyT<2.2)text('Fly! Arrows / WASD / mouse to dodge',cssW/2,cssH*0.2,fs,600,'center','#fff','rgba(0,0,0,.6)');
    }
    const cy=cssH*0.36;
    if(phase==='idle'){
      const halo=bg||'';
      text('TRIP RUN',cssW/2,cy-fs*1.1,Math.round(fs*1.5),800,'center',ink,halo);
      text('Press Space or tap to play',cssW/2,cy+fs*0.4,fs,500,'center',ink,halo);
      if(cssH>130)text('Space / ↑ jump  ·  ↓ duck  ·  mushrooms are… interesting',cssW/2,cy+fs*1.8,Math.max(10,fs-3),400,'center',ink);
    }else if(phase==='over'){
      text('GAME OVER',cssW/2,cy-fs*0.7,Math.round(fs*1.4),800,'center',col,ol||bg);
      text('Press Space to run again',cssW/2,cy+fs*0.8,fs,500,'center',col,ol||bg);
    }else if(paused){
      ctx.globalAlpha=0.55;ctx.fillStyle=bright?'#000':(bg||'#000');ctx.fillRect(0,0,cssW,cssH);ctx.globalAlpha=1;
      text('Paused — press Space',cssW/2,cssH/2,Math.round(fs*1.2),700,'center',bright||!bg?'#fff':ink,bright?ol:'');
    }
  }

  // ---- Loop --------------------------------------------------------------------------------------
  const needLoop=()=>shown&&!destroyed&&(phase==='play'&&!paused||phase==='over'&&overT<1.2);
  function frame(now){
    rafId=0;if(!needLoop()){draw();return;}
    const el=now-last;
    if(el<1000/61){rafId=requestAnimationFrame(frame);return;} // 60 fps cap on fast screens
    last=now;step(Math.min(0.05,el/1000));draw();
    if(needLoop())rafId=requestAnimationFrame(frame);
  }
  function startLoop(){if(!rafId&&needLoop()){last=performance.now();rafId=requestAnimationFrame(frame);}}
  function stopLoop(){if(rafId){cancelAnimationFrame(rafId);rafId=0;}}
  function clearHeld(){for(const k in held)held[k]=false;pad.a=pad.duck=false;pad.x=pad.y=0;}
  function pauseGame(){clearHeld();if(phase==='play'&&!paused){paused=true;}stopLoop();if(phase==='over')overT=9;draw();}
  function unpause(){if(phase==='play'&&paused){paused=false;startLoop();}}

  // ---- Input -------------------------------------------------------------------------------------
  const visible=()=>shown&&!destroyed&&root.isConnected&&cv.offsetParent!==null&&cssW>0;
  function onKey(e){
    if(!visible()||e.ctrlKey||e.metaKey||e.altKey)return;
    const t=e.target;if(t&&(t.isContentEditable||/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName||'')))return;
    if(document.querySelector('dialog[open]'))return;
    const down=e.type==='keydown',fly=phase==='play'&&!paused&&flying();let used=true;
    switch(e.code){
      case 'Space':held.jump=down;if(down&&!e.repeat)action();break;
      case 'ArrowUp':case 'KeyW':held.jump=held.up=down;if(down&&!e.repeat)action();break;
      case 'ArrowDown':case 'KeyS':held.duck=held.down=down;break;
      case 'ArrowLeft':case 'KeyA':held.left=down;used=fly;break;
      case 'ArrowRight':case 'KeyD':held.right=down;used=fly;break;
      case 'KeyM':if(down&&!e.repeat){unlockAudio();setMuted(!muted);}break;
      case 'KeyP':if(down&&!e.repeat&&phase==='play'){if(paused)unpause();else pauseGame();}break;
      default:used=false;
    }
    if(used)e.preventDefault();
  }
  function action(){
    unlockAudio();blinkT=3;
    if(phase==='play'&&paused)unpause();
    else if(phase==='idle'||phase==='over'&&overT>0.45)start();
    else if(phase==='play')jumpPress();
  }
  function onPointerDown(e){
    if(e.button!==undefined&&e.button!==0)return;e.preventDefault();
    try{cv.setPointerCapture(e.pointerId);}catch{}
    pointerAim(e);held.ptr=true;
    if(phase==='play'&&!paused&&flying()){unlockAudio();return;}
    action();
  }
  function onPointerUp(){held.ptr=false;}
  function pointerAim(e){
    if(!(phase==='play'&&flying())||!cssW)return;const r=cv.getBoundingClientRect();
    mtx=clamp(((e.clientX-r.left)/r.width*2-1)*XMAX*1.15,-XMAX,XMAX);mty=clamp(((e.clientY-r.top)/r.height*2-1)*2.8,YMIN,YMAX);mouseT=time;
  }
  function onMute(e){unlockAudio();setMuted(!muted);if(e.detail)muteBtn.blur();}
  function onVisibility(){if(document.hidden)pauseGame();}
  function onTheme(){readTheme();}
  const ro=new ResizeObserver(()=>{if(!resizeQueued)resizeQueued=requestAnimationFrame(measure);}); // outside the callback: no RO loop warnings
  const mo=new MutationObserver(onTheme);
  const mq=window.matchMedia?window.matchMedia('(prefers-color-scheme: dark)'):null;
  window.addEventListener('keydown',onKey);window.addEventListener('keyup',onKey);window.addEventListener('blur',pauseGame);
  document.addEventListener('visibilitychange',onVisibility);
  cv.addEventListener('pointerdown',onPointerDown);cv.addEventListener('pointerup',onPointerUp);cv.addEventListener('pointercancel',onPointerUp);
  cv.addEventListener('pointermove',pointerAim);muteBtn.addEventListener('click',onMute);
  cv.addEventListener('contextmenu',e=>e.preventDefault());
  ro.observe(container);mo.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','class']});
  if(mq)mq.addEventListener('change',onTheme);
  drawMute();readTheme();measure();

  // Tests only: lets a probe read the state and fast-forward to a trip.
  const debug=options.debug?{state:()=>({phase,mode,score:Math.floor(score),tint,lives,flyT,paused,rafId,invuln}),trip(){if(phase!=='play')start();mode='melt';modeT=0;impacted=false;},godMode(s){invuln=s;},fly(){if(phase!=='play')start();mode='warpIn';modeT=0;cool=true;startFly();}}:undefined;
  return {
    debug,
    show(){if(destroyed)return;shown=true;root.hidden=false;measure();draw();},
    hide(){if(destroyed)return;pauseGame();shown=false;root.hidden=true;},
    pause(){if(!destroyed)pauseGame();},
    // Resume shows the cached frame; a run in progress waits on "Paused - press Space" unless forced.
    resume(force){if(destroyed)return;shown=true;root.hidden=false;if(force)unpause();draw();},
    destroy(){
      if(destroyed)return;destroyed=true;stopLoop();if(resizeQueued)cancelAnimationFrame(resizeQueued);
      window.removeEventListener('keydown',onKey);window.removeEventListener('keyup',onKey);window.removeEventListener('blur',pauseGame);
      document.removeEventListener('visibilitychange',onVisibility);ro.disconnect();mo.disconnect();if(mq)mq.removeEventListener('change',onTheme);
      if(ac)ac.close().catch(()=>{});root.remove();
    },
    get playing(){return phase==='play'&&!paused&&!!rafId;},
  };
}
window.DeckTripRun={create};
})();
