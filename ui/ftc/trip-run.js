'use strict';
// Robo Run: a small endless runner for the Drive tab's Robot status panel while no robot is connected.
// A robot legs it through a wrecked, burning data center; catching a virus gets it glitched out of its mind.
// One 2D canvas, no WebGL and no asset files, so it stays light on a Steam Deck on battery and fits the
// page CSP. The frame loop only runs during a run; idle, paused, game over and hidden cost nothing.
(()=>{
const MUTE_KEY='torque-trip-muted',BEST_KEY='torque-trip-best';
const MELT=1.5,GLASSES=1.0,WARP_IN=0.7,WARP_OUT=0.8,TRIP_LEN=20;
const SPEED0=125,SPEED_MAX=300,ACCEL=2.2;
const FLOOR=3,CEIL=-4.2,WALL=6.6,FAR=50,XMAX=4.6,YMIN=-2.6,YMAX=2.3;
// RACK is junk on the floor (a firewall pillar in the trip), BLOCK a corrupted data block, RING a data ring.
const RACK=0,DRONE=1,VIRUS=2,BLOCK=3,RING=4;
const load=k=>{try{return localStorage.getItem(k);}catch{return null;}};
const save=(k,v)=>{try{localStorage.setItem(k,String(v));}catch{}};
const clamp=(v,a,b)=>v<a?a:v>b?b:v,rnd=(a,b)=>a+Math.random()*(b-a);

// ---- Pixel art: each letter is a colour from COL, '.' shows what is behind. Original designs, one sprite
// pixel per world unit.
const COL={'#':'#2b313d','=':'#4a5263',s:'#8792a3',k:'#0b0d12',g:'#3dff8a',r:'#ff3b3b',a:'#ffb020',w:'#c8d0dc',
  y:'#f2c230',b:'#3a8dff',o:'#ff7a1a',v:'#7dff3a',m:'#ff2bd6'};
const HEAD=['...........#....','..........###...','...........#....','...........#....','....###########.','...#############',
  '...###...##...##','...###...##...##','...###...##...##','...#############','...#######..####','...#############','....###########.','.....#########..'];
const DUCK=['.##.................','...##...............','....###############.','...################.','...#####...##...###.','...#####...##...###.',
  '...#####...##...###.','...########..######.','....##############..'];
const FAN=(a,b)=>['ssssssssss','s########s'].concat(a.map(r=>'s#'+r+'#s'),['s#=#=#a#=s','ssssssssss']);
const ROBOT={
  run0:HEAD.concat(['....##.....##...','...###....###...']),
  run1:HEAD.concat(['.....##...##....','....###..###....']),
  jump:HEAD.concat(['....##.....##...','................']),
  duck0:DUCK.concat(['.....##.......##....','....###......###....']),
  duck1:DUCK.concat(['......##.....##.....','.....###....###.....']),
};
const ART={
  // A smashed server rack still standing, a server chassis on its side, a fan unit and a tangle of cables.
  rack:['s.s..ss.s.','ssssssss.s','s======g#s','s########s','s======a#s','s########s','s=.kk.r#.s','sk......ks','s======g#s','s########s',
    'sk..kk..ks','s====..r.s','s########s','s======g#s','s########s','s======r#s','s########s','s======g#s','s########s','s======a#s','ssssssssss','s.s....s.s'],
  server:['..ssssssssssss','.s#=#=#=#=#=#s','s#g#=#r#=#g#=s','s#=#=#=#=#=#=s','s#=#k#=#=#a#=s','s#=#=#=#=#=#=s','s#r#=#g#=#=#=s','s#=#=#=#=#=#=s','ssssssssssssss'],
  fan0:FAN(['kkwwkk','kkwwkk','wwssww','wwssww','kkwwkk','kkwwkk']),
  fan1:FAN(['wkkkkw','kwkkwk','kksskk','kksskk','kwkkwk','wkkkkw']),
  cables:['...y....b...','.yy.y..b.b..','y..b.yyo..b.','.bb.oy.bo.yb','obyo.bb.yyo.','bysobyoysbyo'],
  drone0:['ssss......ssss','..#........#..','..##########..','.#=########=#.','.#####rr#####.','..##########..','...#......#...','..ss......ss..'],
  drone1:['.ss........ss.','..#........#..','..##########..','.#=########=#.','.#####rr#####.','..##########..','...#......#...','..ss......ss..'],
  virus:['v...v...v','.v.vvv.v.','..vvvvv..','vvvkvkvvv','.vvvvvvv.','vvwkwkwvv','..vvvvv..','.v.vvv.v.','v...v...v'],
};
// The robot's arm and zapper, seen from behind in the first-person trip.
const ARM=['.......kggk.......','......ks==sk......','......ks==sk......','.....ks====sk.....','.....ks#==#sk.....','....ks######sk....',
  '....ks#=##=#sk....','...ks########sk...','...ks#=g==g=#sk...','..ks##########sk..','..ks#=######=#sk..','.ks############sk.',
  '.ks#=########=#sk.','ks##############sk','ks#=##########=#sk','ks##############sk'];
const GLASSES_ART=['############','....###..###','....###..###','.....#....#.'];
const EYES_STAND=[6,6,11,6],EYES_DUCK=[8,4,13,4],SPIN=[0,0,1,0,2,0,2,1,2,2,1,2,0,2,0,1];
const SPARK=['#ffd84a','#ff9a2a','#fff3b0'],EMBER=['#ff7a1a','#ffb020','#ff4a1a'],DUST=['#4a505c','#5d6472'],
  GOO=['#7dff3a','#ff2bd6','#2bf0ff'],SMACK=['#ffffff','#ff2bd6','#2bf0ff'];
const LED=['#3dff8a','#ff3b3b','#ffb020','#38c8ff'],WIRE=['#f2c230','#3a8dff','#ff7a1a','#9aa4b2','#3dff8a'];
// A 1-unit halo so the flying sunglasses stay readable over anything.
function halo(rows){
  const h=rows.length,w=rows[0].length,out=[];
  for(let y=-1;y<=h;y++){let s='';for(let x=-1;x<=w;x++){let on=false;
    for(let dy=-1;dy<=1&&!on;dy++)for(let dx=-1;dx<=1;dx++){const r=rows[y+dy];if(r&&r[x+dx]&&r[x+dx]!=='.'){on=true;break;}}
    s+=on?'#':'.';}out.push(s);}
  return out;
}
// A string paints every pixel that colour; a map paints each letter its own.
function paint(rows,color){
  const c=document.createElement('canvas');c.width=rows[0].length;c.height=rows.length;
  const g=c.getContext('2d');
  rows.forEach((r,y)=>{for(let x=0;x<r.length;x++){const ch=r[x];if(ch==='.')continue;
    const f=typeof color==='string'?color:color[ch];if(!f)continue;g.fillStyle=f;g.fillRect(x,y,1,1);}});
  return c;
}
function glow(rgb,a){
  const c=document.createElement('canvas');c.width=c.height=32;const g=c.getContext('2d'),gr=g.createRadialGradient(16,16,0,16,16,16);
  gr.addColorStop(0,`rgba(${rgb},${a})`);gr.addColorStop(1,`rgba(${rgb},0)`);g.fillStyle=gr;g.fillRect(0,0,32,32);return c;
}
// Trip colours come from fixed tables so a frame builds no colour strings.
const PAL=[[],[],[]];
for(let i=0;i<36;i++){PAL[0].push(`hsl(${i*10},100%,64%)`);PAL[1].push(`hsl(${i*10},90%,50%)`);PAL[2].push(`hsl(${i*10},75%,20%)`);}
const pal=(l,h)=>PAL[l][((Math.floor(h/10)%36)+36)%36];
// First-person surfaces fade to the fog colour with distance in 8 steps, again from fixed tables.
const FOG='#060408';
function shades(hex){const n=parseInt(hex.slice(1),16),c=[n>>16,(n>>8)&255,n&255],out=[];
  for(let i=0;i<8;i++){const t=i/7*0.92;out.push(`rgb(${c.map((v,k)=>Math.round(v+([6,4,8][k]-v)*t)).join(',')})`);}return out;}
const SH={floor:[shades('#3a3d46'),shades('#2c2f37')],ceil:shades('#1c1e25'),light:shades('#d8f4ff'),rack:[shades('#262b38'),shades('#1f2430')],line:shades('#0c0e14')};

function create(container,options){
  options=options||{};
  const maxH=options.maxHeight||240;
  const root=document.createElement('div');root.className='trip-run';
  Object.assign(root.style,{position:'relative',width:'100%',lineHeight:'0'});
  const cv=document.createElement('canvas');cv.className='trip-run-canvas';
  Object.assign(cv.style,{display:'block',width:'100%',height:'0px',touchAction:'none',cursor:'pointer'});
  cv.setAttribute('role','img');cv.setAttribute('aria-label','Robo Run mini game. Press Space or tap to play.');
  const muteBtn=document.createElement('button');muteBtn.type='button';muteBtn.className='trip-run-mute';
  Object.assign(muteBtn.style,{position:'absolute',top:'4px',left:'4px',width:'26px',height:'26px',padding:'4px',border:'0',borderRadius:'6px',
    background:'transparent',color:'#e8eef7',opacity:'.6',cursor:'pointer',lineHeight:'0'});
  root.append(cv,muteBtn);container.appendChild(root);
  const ctx=cv.getContext('2d');
  const buf=document.createElement('canvas'),bx=buf.getContext('2d');
  const lo=document.createElement('canvas'),lox=lo.getContext('2d');let LO=3; // the first-person view, drawn small
  const scan=document.createElement('canvas'),sx2=scan.getContext('2d');
  const far=document.createElement('canvas'),mid=document.createElement('canvas');

  // ---- Sprites (fixed colours: the data center is always dark) ----------------------------------
  const S={};
  for(const k in ROBOT)S[k]=paint(ROBOT[k],'#d5dde8');
  for(const k in ART)S[k]=paint(ART[k],COL);
  S.virusM=paint(ART.virus,'#ff2bd6');S.virusC=paint(ART.virus,'#2bf0ff');
  S.glasses=paint(GLASSES_ART,'#0a0a10');S.glassesHalo=paint(halo(GLASSES_ART),'#ff2bd6');S.glassesWhite=paint(GLASSES_ART,'#fff');
  S.arm=paint(ARM,COL);S.face=paint(HEAD,'#d5dde8');
  S.fire=glow('255,110,30',0.55);S.goo=glow('125,255,58',0.6);S.smoke=glow('34,34,42',0.75);
  let font='sans-serif';

  // ---- State ----------------------------------------------------------------------------------
  let cssW=0,cssH=0,dpr=1,cw=0,ch=0,P=2,WW=0,WH=0,GY=0,RX=12,TW=256,resizeQueued=0;
  let shown=true,paused=false,rafId=0,last=0,time=0,destroyed=false;
  let phase='idle',mode='run',modeT=0,overT=0;
  let score=0,best=Math.max(0,Math.floor(+load(BEST_KEY)||0)),nextMilestone=100,flashT=0,speed=SPEED0;
  let rb=0,rvy=0,onGround=true,ducking=false,holdT=0,runAnim=0,invuln=0,cool=false,impacted=false;
  let spawnGap=0,virusCool=0,hadVirus=false,tint=0,hueT=0,shake=0,flash=0,flashRed=false;
  let farX=0,midX=0,floorX=0,glT=-9,glBurst=false;
  let hintT=0,shootCool=0,beamT=0,beamX=0,beamY=0,recoil=0,kills=0,armTX=0,armTY=0;
  let fx=0,fy=0,fvx=0,fvy=0,fspeed=0,ftravel=0,lives=3,fhit=0,spawn3=0,flyT=0,roll=0,mouseT=-9,mtx=0,mty=0,fdone=false;
  let muted=load(MUTE_KEY)==='1',ac=null,master=null,noise=null;
  let scoreText='',scoreShown=-1;
  const held={jump:false,duck:false,left:false,right:false,up:false,down:false,ptr:false};
  const pad={a:false,duck:false,x:0,y:0,on:false};
  const obs=Array.from({length:14},()=>({on:false,kind:0,x:0,y:0,w:0,h:0,n:0,vx:0,anim:0,spr:[null,null,null],ox:[0,0,0],oy:[0,0,0]}));
  const debris=Array.from({length:40},()=>({x:0,y:0,w:1}));
  const smoke=Array.from({length:6},()=>({x:0,y:0,s:10,vy:6}));
  const wires=Array.from({length:5},(_,i)=>({x:0,len:10,ph:rnd(0,6),c:WIRE[i]}));
  const parts=Array.from({length:72},()=>({on:false,sp:false,x:0,y:0,vx:0,vy:0,g:200,life:0,max:1,s:1,hue:0,c:''}));
  const objs=Array.from({length:40},()=>({on:false,kind:0,x:0,y:0,z:0,h:0,r:1,a:0,va:0,hue:0}));
  const order=new Array(40).fill(null);
  const booms=Array.from({length:6},()=>({on:false,t:0,x:0,y:0,s:1}));
  const pops=Array.from({length:8},()=>({on:false,t:0,x:0,y:0,txt:''}));
  const cracks=Array.from({length:3},()=>({on:false,pts:new Float32Array(14)}));
  const towers=new Float32Array(32);for(let i=0;i<32;i++)towers[i]=rnd(0.3,1);
  const leds=new Float32Array(96*3);let ledN=0;
  const fires=new Float32Array(12*3);let fireN=0;
  const fl=new Float32Array(16),gl=new Float32Array(10*3),blocks=new Float32Array(3*4);

  // ---- Size ------------------------------------------------------------------------------------
  function measure(){
    resizeQueued=0;if(destroyed)return;
    const w=Math.floor(root.getBoundingClientRect().width);if(!w)return;
    const cs=getComputedStyle(container);
    const avail=container.clientHeight-(parseFloat(cs.paddingTop)||0)-(parseFloat(cs.paddingBottom)||0);
    const h=Math.max(100,Math.floor(avail>=60?Math.min(avail,maxH):maxH));
    const d=Math.min(1.5,window.devicePixelRatio||1);
    if(w===cssW&&h===cssH&&d===dpr)return;
    cssW=w;cssH=h;dpr=d;cw=Math.round(w*d);ch=Math.round(h*d);
    cv.width=buf.width=scan.width=cw;cv.height=buf.height=scan.height=ch;cv.style.height=h+'px';
    LO=Math.max(2,Math.round(cw/320));lo.width=Math.ceil(cw/LO);lo.height=Math.ceil(ch/LO);
    // Whole device pixels per sprite pixel keep the art crisp; the world is about 80 units tall.
    P=Math.max(1,Math.floor(ch/80));WW=cw/P;WH=ch/P;GY=Math.floor(WH-Math.max(7,WH*0.1));RX=Math.round(clamp(WW*0.08,10,40));
    if(onGround)rb=GY;
    debris.forEach(p=>{p.x=rnd(0,WW);p.y=rnd(2,6)|0;p.w=Math.random()<0.3?2:1;});
    smoke.forEach(p=>{p.x=rnd(0,WW);p.y=rnd(0,GY);p.s=rnd(10,20);p.vy=rnd(4,9);});
    wires.forEach(c=>{c.x=rnd(0,WW);c.len=rnd(8,Math.max(10,GY*0.35));});
    buildScene();buildScan();
    if(!rafId)draw();
  }
  // The back wall (racks, LEDs' sockets, the fire's glow on the air) and a row of closer racks, drawn once
  // per size into world-unit tiles that scroll at their own speeds.
  function buildScene(){
    const H=Math.max(8,GY);TW=Math.max(256,Math.ceil(WW)+48);
    far.width=mid.width=TW;far.height=mid.height=H;
    const f=far.getContext('2d'),gr=f.createLinearGradient(0,0,0,H);
    gr.addColorStop(0,'#05060a');gr.addColorStop(0.5,'#0d0b12');gr.addColorStop(1,'#33140c');f.fillStyle=gr;f.fillRect(0,0,TW,H);
    f.fillStyle='#14161d';f.fillRect(0,0,TW,4);f.fillStyle='#262a36';f.fillRect(0,4,TW,1);
    for(let x=8;x<TW;x+=40){f.fillStyle='#1e222c';f.fillRect(x,5,10,1);}
    ledN=0;let x=2;const top=Math.max(7,Math.floor(H*0.26));
    while(x<TW-14){
      const w=rnd(9,14)|0,gap=Math.random()<0.12;
      if(!gap){
        const t=top+(rnd(0,H*0.12)|0);
        f.fillStyle='#10131b';f.fillRect(x,t,w,H-t);
        f.fillStyle='#191d28';for(let y=t+2;y<H-1;y+=3)f.fillRect(x+1,y,w-2,1);
        f.fillStyle='#252b3a';f.fillRect(x,t,w,1);f.fillRect(x,t,1,H-t);
        if(Math.random()<0.3){const hy=t+(rnd(2,(H-t)*0.6)|0);f.fillStyle='#06070b';f.fillRect(x+2,hy,w-4,4);f.fillRect(x+3,hy+4,2,2);}
        for(let y=t+3;y<H-2;y+=3)if(Math.random()<0.4&&ledN<96){leds[ledN*3]=x+w-3;leds[ledN*3+1]=y;leds[ledN*3+2]=Math.random()<0.5?0:Math.random()<0.5?1:Math.random()<0.6?2:3;ledN++;}
      }
      x+=w+1+(gap?(rnd(4,10)|0):0);
    }
    const m=mid.getContext('2d');m.clearRect(0,0,TW,H);fireN=0;x=rnd(10,30);
    while(x<TW-30){
      const w=rnd(14,22)|0,t=(H*rnd(0.2,0.42))|0;
      m.fillStyle='#07080c';m.fillRect(x,t,w,H-t);
      m.fillStyle='#0e1017';for(let y=t+3;y<H-1;y+=4)m.fillRect(x+1,y,w-2,1);
      m.fillStyle='#5a2412';m.fillRect(x+w-1,t+2,1,H-t-2);m.fillRect(x+1,t,w-3,1);
      m.clearRect(x+(rnd(1,w-5)|0),t,3,(rnd(1,3)|0));
      if(Math.random()<0.5){m.fillStyle='#07080c';m.fillRect(x-4,t+6,4,1);m.fillRect(x-5,t+7,1,(rnd(4,10)|0));}
      if(Math.random()<0.65&&fireN<12){fires[fireN*3]=x+rnd(-6,w-4);fires[fireN*3+1]=rnd(9,15)|0;fires[fireN*3+2]=rnd(6,14);fireN++;}
      x+=w+rnd(26,64);
    }
  }
  // CRT scanlines laid over the glitch, drawn once per size.
  function buildScan(){
    const g=sx2;g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,cw,ch);g.fillStyle='rgba(0,0,0,.45)';
    const st=Math.max(3,Math.round(3*dpr)),lh=Math.max(1,Math.round(dpr));for(let y=0;y<ch;y+=st)g.fillRect(0,y,cw,lh);
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
    virus(){ // a glitchy chirp: bits flipping up and down
      tone(1568,0,0.04,'square',0.4);tone(392,0,0.05,'square',0.4,0.05);tone(1175,0,0.04,'square',0.4,0.1);tone(294,0,0.05,'square',0.4,0.15);
      tone(2093,98,0.25,'sawtooth',0.3,0.2);hiss(0.12,0.4,5000);},
    whoosh(){ // a slow wobbly slide: an LFO on the pitch makes the "trip" sound
      if(!ac||muted)return;const t=ac.currentTime,o=ac.createOscillator(),l=ac.createOscillator(),lg=ac.createGain(),g=ac.createGain();
      o.type='sine';o.frequency.setValueAtTime(180,t);o.frequency.exponentialRampToValueAtTime(900,t+1.4);
      l.frequency.value=7;lg.gain.value=70;l.connect(lg);lg.connect(o.frequency);
      g.gain.setValueAtTime(0.001,t);g.gain.exponentialRampToValueAtTime(0.4,t+0.3);g.gain.exponentialRampToValueAtTime(0.001,t+1.5);
      o.connect(g);g.connect(master);o.start(t);l.start(t);o.stop(t+1.55);l.stop(t+1.55);},
    smack(){hiss(0.08,0.9,3000);tone(160,45,0.18,'square',0.5);tone(1800,0,0.05,'square',0.25,0.02);},
    ring(){tone(988,1480,0.12,'triangle',0.45);},
    zap(){tone(1400,320,0.08,'square',0.22);},
    fizz(){hiss(0.22,0.6,2200);tone(660,0,0.06,'square',0.3);tone(990,0,0.09,'square',0.3,0.06);},
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
  function burst(n,x,y,spread,up,screen,hue,cols,grav){
    for(let i=0;i<n;i++){const p=take(parts);if(!p)return;p.on=true;p.sp=!!screen;p.x=x;p.y=y;p.vx=rnd(-spread,spread);p.vy=rnd(-up,up*0.3);
      p.g=grav===undefined?200:grav;p.c=cols?cols[(Math.random()*cols.length)|0]:DUST[0];
      p.life=p.max=rnd(0.35,0.8);p.s=screen?rnd(2,5)*dpr:(Math.random()<0.4?2:1);p.hue=hue===undefined?rnd(0,360):hue+rnd(-40,40);}
  }
  // Points float up from where they were scored (device pixels), the way old light-gun games did it.
  // A new one lands above any still floating near the same spot, so two at once both stay readable.
  function pop(txt,x,y,big){const p=take(pops);if(!p)return;p.on=true;p.t=0;p.x=x===undefined?cw/2+rnd(-0.1,0.1)*cw:x;p.y=y===undefined?ch*0.4:y;p.txt=txt;p.big=!!big;
    const step=ch*0.09;
    for(let tries=0;tries<pops.length;tries++){let clash=false;
      for(const q of pops)if(q!==p&&q.on&&Math.abs(q.x-p.x)<cw*0.08&&Math.abs((q.y-q.t*28*dpr)-p.y)<step*0.85){clash=true;break;}
      if(!clash)break;if(p.y-step<ch*0.24)p.x+=cw*0.09;else p.y-=step;}}

  // ---- Game flow ---------------------------------------------------------------------------------
  function start(){
    phase='play';paused=false;mode='run';modeT=0;score=0;nextMilestone=100;speed=SPEED0;tint=0;cool=false;invuln=0;flash=0;shake=0;
    rb=GY;rvy=0;onGround=true;ducking=false;spawnGap=WW*0.55+speed*1.5;virusCool=0;hadVirus=false;scoreShown=-1;
    obs.forEach(o=>{o.on=false;});parts.forEach(p=>{p.on=false;});
    startLoop();
  }
  function addScore(n){
    score+=n;if(score>=nextMilestone){nextMilestone+=100;flashT=1;sfx.milestone();}
  }
  function gameOver(){
    phase='over';overT=0;shake=6;sfx.crash();burst(16,RX+9,rb-8,70,100,false,0,SPARK);
    const s=Math.floor(score);if(s>best){best=s;save(BEST_KEY,best);}
  }
  function catchVirus(o){
    o.on=false;hadVirus=true;sfx.virus();sfx.whoosh();burst(16,o.x+4,o.y+4,60,80,false,0,GOO);addScore(25);
    mode='melt';modeT=0;impacted=false;
  }
  const PIECE={C:'cables',R:'rack',B:'server',F:'fan0'};
  function spawn(){
    const v=speed,o=take(obs);if(!o)return;
    o.on=true;o.x=WW+4;o.anim=0;o.vx=0;
    const late=score>180;
    if(late&&Math.random()<0.3){
      o.kind=DRONE;o.w=14;o.h=8;o.n=0;o.vx=rnd(15,40);
      const r=Math.random();o.y=r<0.4?GY-10:r<0.8?GY-17:GY-31;
    }else{
      o.kind=RACK;const r=Math.random(),lv=score<120?0:score<400?1:2;
      const set=lv===0?(r<0.4?'C':r<0.7?'B':r<0.85?'F':'R'):lv===1?(r<0.25?'C':r<0.45?'CB':r<0.6?'R':r<0.75?'F':r<0.88?'BC':'FC'):(r<0.2?'CC':r<0.4?'RF':r<0.6?'FB':r<0.8?'BC':'R');
      let x=0,h=0;o.n=set.length;
      for(let i=0;i<o.n;i++){const s=S[PIECE[set[i]]];o.spr[i]=s;o.ox[i]=x;o.oy[i]=GY-s.height;x+=s.width+1;h=Math.max(h,s.height);}
      o.w=x-1;o.h=h;o.y=GY-h;
    }
    spawnGap=o.w+v*rnd(0.62,1.35)*(1-Math.min(0.25,score/4000));
    // Viruses sit halfway along the gap, on the ground or at jump height; the first one comes early.
    if(virusCool<=0&&score>60&&(!hadVirus&&score>100||Math.random()<0.16)){
      const m=take(obs);if(m){m.on=true;m.kind=VIRUS;m.w=9;m.h=9;m.n=0;m.vx=0;m.anim=rnd(0,6);m.x=o.x+o.w+spawnGap*0.5-4;m.y=Math.random()<0.5?GY-10:GY-30;virusCool=150;hadVirus=true;}
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
  const wrap=(x,off,pad)=>{let s=x-off%TW;if(s<-pad)s+=TW;return s;};
  const WE=new Float32Array(2);
  function wireEnd(c){WE[0]=c.x+Math.sin(time*1.6+c.ph)*3;WE[1]=5+c.len;return WE;} // reused: no garbage per frame

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
      if(rb>=GY){rb=GY;rvy=0;onGround=true;burst(3,RX+8,GY-1,25,15,false,0,DUST);}
    }
    runAnim+=dt*v/14;
    if(invuln>0)invuln-=dt;
    for(let i=0;i<obs.length;i++){const o=obs[i];if(!o.on)continue;
      o.x-=(v+o.vx*slow)*dt;o.anim+=dt;
      if(o.x+o.w<-4){o.on=false;continue;}
      if(o.kind===RACK&&o.x<WW)for(let k=0;k<o.n;k++){ // fans spit sparks, racks shed embers
        if(o.spr[k]===S.fan0&&Math.random()<dt*5)burst(2,o.x+o.ox[k]+5,o.oy[k]+5,40,60,false,0,SPARK);
        else if(o.spr[k]===S.rack&&Math.random()<dt*3)burst(1,o.x+o.ox[k]+5,o.oy[k],8,30,false,0,EMBER,-40);}
      if(phase!=='play'||mode!=='run')continue;
      if(o.kind===VIRUS){if(hit(RX+3,rb-15,13,15,o.x-1,o.y-1+Math.sin(o.anim*4)*1.5,11,11))catchVirus(o);continue;}
      if(invuln>0)continue;
      if(o.kind===DRONE){if(robotHits(o.x+1,o.y+1,12,6)){gameOver();return;}}
      else for(let k=0;k<o.n;k++){const s=o.spr[k];if(robotHits(o.x+o.ox[k]+1,o.oy[k]+1,s.width-2,s.height-1)){gameOver();return;}}
    }
    if(mode==='run'&&phase==='play'){spawnGap-=v*dt;if(spawnGap<=0)spawn();virusCool-=v*dt*0.08;}
    farX+=v*0.12*dt;midX+=v*0.35*dt;floorX+=v*dt;
    const nd=Math.min(debris.length,Math.ceil(WW/10));
    for(let i=0;i<nd;i++){const p=debris[i];p.x-=v*dt;if(p.x<-3){p.x+=WW+6;p.y=rnd(2,6)|0;p.w=Math.random()<0.3?2:1;}}
    for(const p of smoke){p.x-=(v*0.3+4)*dt;p.y-=p.vy*dt;p.s+=dt*3;
      if(p.y<-p.s||p.x<-p.s*2){p.x=rnd(0,WW+40);p.y=GY-rnd(0,12);p.s=rnd(10,18);p.vy=rnd(4,9);}}
    for(const c of wires){c.x-=v*0.7*dt;if(c.x<-6){c.x+=WW+rnd(10,70);c.len=rnd(8,Math.max(10,GY*0.35));}
      else if(c.x<WW&&Math.random()<dt*0.9){const e=wireEnd(c);burst(4,e[0],e[1],30,15,false,0,SPARK);}}
    for(let i=0;i<fireN;i++)if(Math.random()<dt*2){const x=wrap(fires[i*3],midX,30);if(x<WW)burst(1,x+rnd(0,fires[i*3+2]),GY-fires[i*3+1]*0.6,8,25,false,0,EMBER,-45);}
  }
  function startFly(){
    fx=0;fy=0.6;fvx=fvy=0;ftravel=0;lives=3;kills=0;hintT=0;shootCool=0.3;beamT=0;recoil=0;booms.forEach(b=>{b.on=false;});fhit=0;spawn3=0.4;flyT=0;roll=0;fdone=false;
    objs.forEach(o=>{o.on=false;});cracks.forEach(c=>{c.on=false;});pops.forEach(p=>{p.on=false;});
  }
  function spawnObj(){
    const o=take(objs);if(!o)return;
    const r=Math.random();o.on=true;o.z=FAR;o.a=rnd(0,6);o.va=rnd(-2,2);o.hue=rnd(0,360);
    o.kind=r<0.32?RACK:r<0.62?BLOCK:r<0.84?RING:VIRUS;
    const aim=Math.random()<0.35; // some come straight at you so dodging matters
    o.x=clamp(aim?fx+rnd(-0.6,0.6):rnd(-6,6),-6,6);o.y=aim?fy+rnd(-0.5,0.5):rnd(YMIN,YMAX);
    if(o.kind===RACK){o.h=rnd(2.4,5.2);o.y=FLOOR;}
    else if(o.kind===BLOCK)o.r=rnd(0.5,1.2);
    else if(o.kind===RING){o.r=1.5;o.x=clamp(o.x,-XMAX,XMAX);o.y=clamp(o.y,YMIN,YMAX);}
    else o.r=0.8;
  }
  function crack(){
    const c=take(cracks);if(!c)return;c.on=true;
    let x=(Math.random()<0.5?0.26:0.74)*cw+rnd(-0.1,0.1)*cw,y=rnd(0.3,0.7)*ch,a=rnd(0,Math.PI*2);
    for(let i=0;i<7;i++){c.pts[i*2]=x;c.pts[i*2+1]=y;a+=rnd(-0.9,0.9);const d=rnd(0.03,0.07)*ch;x+=Math.cos(a)*d*2;y+=Math.sin(a)*d;}
  }
  // The zapper: whatever drone or firewall sits under the crosshair (straight ahead) fizzles out in sparks.
  function fire(){
    shootCool=0.2;beamT=0.09;recoil=1;sfx.zap();
    const f=ch*0.85,hy=-ch*0.1;let hitO=null;
    for(let i=0;i<objs.length;i++){const o=objs[i];if(!o.on||o.z<0.8||o.z>FAR*0.85||(o.kind!==BLOCK&&o.kind!==RACK))continue;
      const tol=0.35+o.z*0.015,ok=o.kind===BLOCK?Math.hypot(o.x-fx,o.y-fy)<o.r*1.1+tol:Math.abs(o.x-fx)<0.55+tol&&fy>FLOOR-o.h-0.5-tol;
      if(ok&&(!hitO||o.z<hitO.z))hitO=o;}
    beamX=0;beamY=0;
    if(!hitO)return;
    const s=f/hitO.z,px=(hitO.x-fx)*s,py=((hitO.kind===RACK?FLOOR-hitO.h*0.6:hitO.y)-fy)*s,pts=hitO.kind===BLOCK?100:50;
    hitO.on=false;kills++;addScore(pts);sfx.fizz();beamX=px;beamY=py;
    burst(16,px,py,ch*0.5,ch*0.5,true,hitO.kind===BLOCK?190:30);
    const b=take(booms);if(b){b.on=true;b.t=0;b.x=px;b.y=py;b.s=Math.max(ch*0.08,Math.min(ch*0.5,s*1.6));}
    pop(String(pts),cw/2+px,ch/2+hy+py,true);
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
      flyT+=dt;hintT+=dt;addScore(dt*12);
      shootCool-=dt;if((held.jump||held.ptr||pad.a)&&shootCool<=0&&mode==='fly')fire();
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
      else if(o.kind===VIRUS){if(d<1.0){o.on=false;addScore(25);pop('+25');flyT=Math.max(0,flyT-2);sfx.virus();burst(10,0,0,ch*0.5,ch*0.5,true,100);}}
      else if(fhit<=0){
        const bang=o.kind===RACK?Math.abs(dx)<0.75&&fy>FLOOR-o.h-0.4:d<o.r*0.85+0.35;
        if(bang){lives--;fhit=1;shake=12;flash=0.7;flashRed=true;crack();sfx.bump();if(lives<=0&&!fdone){fdone=true;endTrip();}}
      }
    }
    for(const p of pops)if(p.on){p.t+=dt;if(p.t>1.1)p.on=false;}
    for(const b of booms)if(b.on){b.t+=dt;if(b.t>0.3)b.on=false;}
    if(beamT>0)beamT-=dt;if(recoil>0)recoil=Math.max(0,recoil-dt*8);
  }
  function endTrip(){mode='warpOut';modeT=0;sfx.warp();}
  function stepParticles(dt){
    for(let i=0;i<parts.length;i++){const p=parts[i];if(!p.on)continue;p.life-=dt;if(p.life<=0){p.on=false;continue;}
      p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=(p.sp?ch*0.8:p.g)*dt;}
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
        if(!impacted&&modeT>=0.45){impacted=true;cool=true;flash=0.9;flashRed=false;shake=9;sfx.smack();burst(12,RX+9,rb-11,70,80,false,0,SMACK);}
        if(modeT>=GLASSES){mode='warpIn';modeT=0;startFly();sfx.warp();}break;
      case 'warpIn':update3D(dt,false);if(modeT>=WARP_IN){mode='fly';modeT=0;}break;
      case 'fly':update3D(dt,true);break;
      case 'warpOut':update3D(dt,false);tint=1;
        if(modeT>=WARP_OUT){mode='run';modeT=0;invuln=2;rb=GY;rvy=0;onGround=true;obs.forEach(o=>{o.on=false;});spawnGap=speed*1.2;virusCool=250;}break;
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
  // The glitch: slices of the frame jump sideways and colour bars flicker, re-rolled about 14 times a second.
  function glitchTick(){
    if(time-glT<0.07&&time>=glT)return;glT=time;glBurst=Math.random()<0.3;
    for(let i=0;i<10;i++){gl[i*3]=rnd(0,ch);gl[i*3+1]=rnd(2*dpr,ch*(Math.random()<0.2?0.16:0.05));gl[i*3+2]=rnd(-1,1)*cw*(Math.random()<0.25?0.12:0.04);}
    for(let i=0;i<3;i++){blocks[i*4]=rnd(0,cw);blocks[i*4+1]=rnd(0,ch);blocks[i*4+2]=rnd(0.05,0.2)*cw;blocks[i*4+3]=rnd(0.02,0.08)*ch;}
  }
  function draw(){
    if(!cw||destroyed)return;
    const shx=shake?rnd(-shake,shake)*dpr*0.5:0,shy=shake?rnd(-shake,shake)*dpr*0.5:0;
    ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.imageSmoothingEnabled=false;
    ctx.fillStyle='#05060a';ctx.fillRect(0,0,cw,ch);
    if(phase==='play'&&flying()){
      const into=mode==='fly'?1:clamp(mode==='warpIn'?modeT/WARP_IN:1-modeT/WARP_OUT,0,1);
      draw3D(shx,shy);
      if(mode==='fly'){const cx=cw/2,cy=ch/2-ch*0.1,c=Math.max(4,ch*0.025),lw=Math.max(1,dpr*1.5);
        ctx.setTransform(1,0,0,1,0,0);ctx.strokeStyle='rgba(125,255,58,.85)';ctx.lineWidth=lw;ctx.beginPath();
        ctx.moveTo(cx-c,cy);ctx.lineTo(cx-c*0.35,cy);ctx.moveTo(cx+c*0.35,cy);ctx.lineTo(cx+c,cy);ctx.moveTo(cx,cy-c);ctx.lineTo(cx,cy-c*0.35);ctx.moveTo(cx,cy+c*0.35);ctx.lineTo(cx,cy+c);ctx.stroke();}
      drawArm(into);
      if(beamT>0){const a=beamT/0.09,tx=cw/2+beamX,ty=ch/2-ch*0.1+beamY;ctx.globalAlpha=a;ctx.lineCap='round';
        ctx.strokeStyle='#7dff3a';ctx.lineWidth=Math.max(3,dpr*4);ctx.beginPath();ctx.moveTo(armTX,armTY);ctx.lineTo(tx,ty);ctx.stroke();
        ctx.strokeStyle='#fff';ctx.lineWidth=Math.max(1,dpr*1.5);ctx.stroke();ctx.globalAlpha=1;ctx.lineCap='butt';}
      if(mode!=='fly'){ // warp: the side view zooms and spins into (or out of) the robot's face
        const p=mode==='warpIn'?modeT/WARP_IN:1-modeT/WARP_OUT,e=clamp(p,0,1);
        render2D();const cx=(RX+10)*P,cy=(rb-9)*P;
        ctx.save();ctx.globalAlpha=1-e;ctx.translate(cx,cy);ctx.rotate(e*e*1.6*(mode==='warpIn'?1:-1));ctx.scale(1+e*e*9,1+e*e*9);ctx.translate(-cx,-cy);
        ctx.drawImage(buf,0,0);ctx.restore();
      }
      ctx.setTransform(1,0,0,1,0,0);
      glitchTick();
      if(glBurst||fhit>0.6){ctx.globalCompositeOperation='screen';ctx.globalAlpha=fhit>0.6?0.5:0.22;
        for(let i=0;i<3;i++){ctx.fillStyle=i%2?'#ff2bd6':'#2bf0ff';ctx.fillRect(0,gl[i*3],cw,gl[i*3+1]);}
        ctx.globalCompositeOperation='source-over';}
      ctx.globalAlpha=0.25;ctx.drawImage(scan,0,0);ctx.globalAlpha=1;drawCracks();
    }else if(phase==='play'&&(tint>0||mode==='melt'||mode==='glasses')){
      const amt=mode==='melt'?Math.min(1,modeT/0.8):mode==='glasses'?1:tint*0.7;
      drawGlitch(amt,shx,shy);
    }else draw2D(ctx,shx,shy);
    if(flash>0){ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=flash*0.8;ctx.fillStyle=flashRed?'#ff2a55':'#fff';ctx.fillRect(0,0,cw,ch);ctx.globalAlpha=1;}
    drawHud();
  }
  // The side view into the buffer, its colours pushed round the rainbow while the virus has hold.
  function render2D(){
    bx.setTransform(1,0,0,1,0,0);bx.globalAlpha=1;bx.globalCompositeOperation='source-over';bx.imageSmoothingEnabled=false;
    draw2D(bx,0,0);
    bx.setTransform(1,0,0,1,0,0);
    if(tint>0){bx.globalCompositeOperation='color';bx.globalAlpha=tint*0.8;const bw=Math.ceil(cw/10);
      for(let i=0;i<10;i++){bx.fillStyle=pal(1,hueT*1.5+i*36);bx.fillRect(i*bw,0,bw,ch);}
      bx.globalAlpha=1;bx.globalCompositeOperation='source-over';}
  }
  function drawGlitch(amt,shx,shy){
    render2D();glitchTick();
    ctx.drawImage(buf,shx,shy);
    const n=Math.ceil(10*amt);
    for(let i=0;i<n;i++){const y=gl[i*3],h=gl[i*3+1];ctx.drawImage(buf,0,y,cw,h,shx+gl[i*3+2]*amt,y+shy,cw,h);}
    ctx.globalCompositeOperation='screen';ctx.globalAlpha=0.35*amt;
    for(let i=0;i<n;i+=2){ctx.fillStyle=i%4?'#ff2bd6':'#2bf0ff';ctx.fillRect(0,gl[i*3],cw,gl[i*3+1]);}
    if(glBurst){ctx.globalCompositeOperation='difference';ctx.globalAlpha=0.8*amt;
      for(let i=0;i<3;i++){ctx.fillStyle=pal(0,hueT*2+i*120);ctx.fillRect(blocks[i*4],blocks[i*4+1],blocks[i*4+2],blocks[i*4+3]);}}
    ctx.globalCompositeOperation='source-over';ctx.globalAlpha=0.6*amt;ctx.drawImage(scan,0,0);ctx.globalAlpha=1;
  }
  function flame(g,x,base,w,h,seed){
    const n=Math.min(8,Math.ceil(w/2));
    for(let k=0;k<n;k++){const e=1-Math.abs(k-(n-1)/2)/(n*0.62);fl[k]=h*e*(0.55+0.45*Math.abs(Math.sin(time*9+seed+k*1.7)*Math.sin(time*5.3+k*0.9+seed)));}
    g.fillStyle='#c42a14';for(let k=0;k<n;k++)g.fillRect(x+k*2,base-fl[k],2,fl[k]);
    g.fillStyle='#ff7a1a';for(let k=0;k<n;k++){const hh=fl[k]*0.66;g.fillRect(x+k*2,base-hh,2,hh);}
    g.fillStyle='#ffd84a';for(let k=0;k<n;k++){const hh=fl[k]*0.33;g.fillRect(x+k*2,base-hh,2,hh);}
  }
  function draw2D(g,ox,oy){
    g.setTransform(P,0,0,P,ox,oy);g.globalAlpha=1;g.globalCompositeOperation='source-over';
    // Back wall and its blinking LEDs.
    const fo=Math.round(farX%TW);g.drawImage(far,-fo,0);g.drawImage(far,TW-fo,0);
    const tick=(time*4)|0;
    for(let c=0;c<4;c++){g.fillStyle=LED[c];
      for(let i=0;i<ledN;i++){if(leds[i*3+2]!==c||(i*13+tick*7)%11<3)continue;const x=wrap(leds[i*3],farX,2);if(x<WW)g.fillRect(Math.round(x),leds[i*3+1],1,1);}}
    // Closer racks with fires at their feet.
    const mo=Math.round(midX%TW);g.drawImage(mid,-mo,0);g.drawImage(mid,TW-mo,0);
    for(let i=0;i<fireN;i++){const x=wrap(fires[i*3],midX,30);if(x<WW+2)flame(g,Math.round(x),GY,fires[i*3+2],fires[i*3+1],i*2.3);}
    // Raised floor tiles.
    g.fillStyle='#14161c';g.fillRect(0,GY,WW,WH-GY);g.fillStyle='#3b4250';g.fillRect(0,GY,WW,1);g.fillStyle='#1d2028';g.fillRect(0,GY+1,WW,1);
    const so=floorX%16;g.fillStyle='#0a0b0f';for(let x=-so;x<WW;x+=16)g.fillRect(Math.round(x),GY+1,1,WH-GY);
    g.fillStyle='#22262f';for(let x=-so;x<WW;x+=16){const r=Math.round(x);g.fillRect(r+5,GY+3,1,1);g.fillRect(r+10,GY+3,1,1);g.fillRect(r+5,GY+5,1,1);g.fillRect(r+10,GY+5,1,1);}
    const nd=Math.min(debris.length,Math.ceil(WW/10));g.fillStyle='#4a505c';
    for(let i=0;i<nd;i++){const p=debris[i];g.fillRect(Math.round(p.x),GY+p.y,p.w,1);}
    // Fire light on the air and floor, then smoke.
    g.imageSmoothingEnabled=true;g.globalCompositeOperation='lighter';
    for(let i=0;i<fireN;i++){const x=wrap(fires[i*3],midX,30);if(x>WW+30)continue;const w=fires[i*3+2];
      g.globalAlpha=0.55+0.25*Math.sin(time*13+i*3);g.drawImage(S.fire,x+w/2-26,GY-34,52,46);}
    g.globalCompositeOperation='source-over';
    for(const p of smoke){g.globalAlpha=clamp((p.y+p.s)/(GY*0.6),0,1)*0.6;g.drawImage(S.smoke,p.x-p.s,p.y-p.s,p.s*2,p.s*2);}
    g.globalAlpha=1;g.imageSmoothingEnabled=false;
    // Snapped cables hanging from the ceiling tray.
    g.lineWidth=1;
    for(const c of wires){if(c.x>WW+4)continue;const e=wireEnd(c);g.strokeStyle=c.c;g.beginPath();g.moveTo(c.x,5);g.quadraticCurveTo(c.x-2+(e[0]-c.x)*0.3,5+c.len*0.7,e[0],e[1]);g.stroke();
      g.fillStyle=(time*20+c.ph*3|0)%3?'#ffd84a':'#fff';g.fillRect(Math.round(e[0]),Math.round(e[1]),1,1);}
    // The emergency light sweeps red.
    const b=Math.sin(time*2.4);if(b>0){g.globalAlpha=b*0.08;g.fillStyle='#ff1e2e';g.fillRect(0,0,WW,WH);g.globalAlpha=1;}
    for(let i=0;i<obs.length;i++){const o=obs[i];if(!o.on||o.x>WW)continue;const x=Math.round(o.x);
      if(o.kind===RACK)for(let k=0;k<o.n;k++){let s=o.spr[k];if(s===S.fan0&&(time*24|0)%2)s=S.fan1;g.drawImage(s,x+o.ox[k],o.oy[k]);
        if(s===S.rack)flame(g,x+o.ox[k]+1,o.oy[k]+2,8,7,k+o.anim);}
      else if(o.kind===DRONE){const y=Math.round(o.y+Math.sin(o.anim*5));g.drawImage((o.anim*12|0)%2?S.drone1:S.drone0,x,y);
        if((time*3|0)%2){g.fillStyle='#ff3b3b';g.globalAlpha=0.3;g.fillRect(x+4,y+8,6,GY-y-8);g.globalAlpha=1;}}
      else drawVirus(g,x,Math.round(o.y+Math.sin(o.anim*4)*1.5));
    }
    drawRobot(g);
    if(phase==='play'&&mode==='glasses'&&!impacted){ // the sunglasses fly in on an arc, spinning
      const t=clamp(modeT/0.45,0,1),x0=WW+12,y0=rb-40,x1=RX+2,y1=rb-11;
      const x=x0+(x1-x0)*t,y=y0+(y1-y0)*t-Math.sin(t*Math.PI)*18;
      g.save();g.translate(x+6,y+2);g.rotate((1-t)*9);drawGlasses(g,-6,-2);g.restore();
    }
    for(let i=0;i<parts.length;i++){const p=parts[i];if(!p.on||p.sp)continue;g.globalAlpha=Math.min(1,p.life/p.max*1.5);g.fillStyle=p.c;g.fillRect(Math.round(p.x),Math.round(p.y),p.s,p.s);}
    g.globalAlpha=1;
  }
  // The virus: a toxic glow, and its colour channels never quite line up.
  function drawVirus(g,x,y){
    g.imageSmoothingEnabled=true;g.globalCompositeOperation='lighter';g.globalAlpha=0.5+0.2*Math.sin(time*8);
    g.drawImage(S.goo,x-9,y-9,27,27);g.globalCompositeOperation='source-over';g.imageSmoothingEnabled=false;
    const j=((time*12)|0)%4;g.globalAlpha=0.75;
    g.drawImage(S.virusM,x-1-(j===1?1:0),y+(j===2?1:0));g.drawImage(S.virusC,x+1+(j===3?1:0),y-(j===0?1:0));
    g.globalAlpha=1;g.drawImage(S.virus,x,y);
  }
  // Worn, the shades are black with a neon glint; in flight they get a neon halo.
  function drawGlasses(g,x,y,worn){
    if(worn){g.drawImage(S.glasses,x,y);g.fillStyle='#ff2bd6';g.fillRect(x+5,y+1,1,1);g.fillRect(x+10,y+1,1,1);return;}
    g.drawImage(S.glassesHalo,x-1,y-1);g.drawImage(S.glasses,x,y);
  }
  function drawRobot(g){
    if(phase==='play'&&invuln>0&&(invuln*10|0)%2)return;
    const over=phase==='over',duck=!over&&ducking&&onGround&&phase==='play',fr=(runAnim|0)%2;
    const spr=over||phase!=='play'?S.run0:duck?(fr?S.duck1:S.duck0):!onGround?S.jump:fr?S.run1:S.run0;
    const x=RX,y=Math.round(rb)-spr.height+(phase==='play'&&onGround&&!duck&&fr?-1:0);
    g.drawImage(spr,x,y);
    const e=duck?EYES_DUCK:EYES_STAND;
    g.fillStyle='#0b0d14';g.fillRect(x+e[0],y+e[1],3,3);g.fillRect(x+e[2],y+e[3],3,3);
    if(!duck){g.fillStyle=over||(time*2|0)%2?'#ff3b3b':'#5a1414';g.fillRect(x+11,y,1,1);}
    const trip=phase==='play'&&(mode==='melt'||mode==='glasses'&&!impacted);
    g.fillStyle=over?'#ff3b3b':trip?'#7dff3a':'#5ff6ff';
    for(let k=0;k<4;k+=2){const ex=x+e[k],ey=y+e[k+1];
      if(over){g.fillRect(ex,ey,1,1);g.fillRect(ex+2,ey,1,1);g.fillRect(ex+1,ey+1,1,1);g.fillRect(ex,ey+2,1,1);g.fillRect(ex+2,ey+2,1,1);}
      else if(trip){ // spinning trip eyes
        const i=((time*18|0)+k*2)%8;g.fillRect(ex+1,ey+1,1,1);g.fillRect(ex+SPIN[i*2],ey+SPIN[i*2+1],1,1);g.fillRect(ex+SPIN[(i+4)%8*2],ey+SPIN[(i+4)%8*2+1],1,1);}
      else g.fillRect(ex+1,ey+1,1,1);
    }
    if(cool)drawGlasses(g,x+e[0]-4,y+e[1]-1,true);
  }
  // The trip, first person: a chunky corridor of burning server racks, rendered small and scaled up so it
  // looks like an old-school shooter and costs a quarter of the pixels. Darker with distance, no textures.
  function draw3D(shx,shy){
    const g=lox,f=ch*0.85,hy=-ch*0.1,R=LO;
    g.setTransform(1,0,0,1,0,0);g.globalAlpha=1;g.globalCompositeOperation='source-over';g.imageSmoothingEnabled=false;
    g.fillStyle=FOG;g.fillRect(0,0,lo.width,lo.height);
    g.setTransform(1/R,0,0,1/R,(cw/2+shx)/R,(ch/2+shy)/R);g.rotate(roll);
    const xl=-WALL-fx,xr=WALL-fx,fl0=FLOOR-fy,cl0=CEIL-fy,seg=3,base=Math.floor(ftravel/seg),fr=ftravel%seg;
    for(let k=17;k>=0;k--){
      let z0=k*seg-fr,z1=z0+seg;if(z1<=0.6)continue;if(z0<0.6)z0=0.6;
      const id=k+base,zm=(z0+z1)/2,lv=Math.min(7,(zm/FAR*9)|0),a=f/z0,b=f/z1;
      const fy0=fl0*a+hy,fy1=fl0*b+hy,cy0=cl0*a+hy,cy1=cl0*b+hy;
      // Floor tiles and ceiling panels, a strip light every third panel.
      g.fillStyle=SH.floor[id%2][lv];quad(g,xl*a,fy0,xr*a,fy0,xr*b,fy1,xl*b,fy1);
      g.fillStyle=SH.ceil[lv];quad(g,xl*a,cy0,xr*a,cy0,xr*b,cy1,xl*b,cy1);
      if(id%3===0){g.fillStyle=SH.light[lv];quad(g,-0.6*a-fx*a,cy0,0.6*a-fx*a,cy0,0.6*b-fx*b,cy1,-0.6*b-fx*b,cy1);}
      // Rack walls on both sides, with unit lines, blinking LEDs and now and then a fire.
      for(let s=0;s<2;s++){const x=s?xr:xl,h=(id*7+s*3)%5;
        g.fillStyle=SH.rack[h%2][lv];quad(g,x*a,cy0,x*b,cy1,x*b,fy1,x*a,fy0);
        g.strokeStyle=SH.line[lv];g.lineWidth=R;g.beginPath();
        for(let u=1;u<6;u++){const t=u/6,ya=cy0+(fy0-cy0)*t,yb=cy1+(fy1-cy1)*t;g.moveTo(x*a,ya);g.lineTo(x*b,yb);}
        g.moveTo(x*a,cy0);g.lineTo(x*a,fy0);g.stroke();
        const m=f/zm,lz=Math.max(R,m*0.12);
        if(lv<7&&zm>3)for(let u=0;u<4;u++){if((id*5+u*3+s+((time*3)|0))%4===0)continue;g.fillStyle=LED[(id+u+s)%4];
          g.fillRect(x*m-lz/2,(cl0+(fl0-cl0)*(0.18+u*0.2))*m+hy,lz,lz);}
        if(h===0&&zm>4&&zm<FAR*0.8){const fh=m*(1.6+0.4*Math.sin(time*12+id)),fw=m*1.2,fx0=x*m+(s?-fw:0);
          g.fillStyle='#c42a14';tri(g,fx0,fl0*m+hy,fx0+fw,fl0*m+hy,fx0+fw*0.5,fl0*m+hy-fh);
          g.fillStyle='#ff7a1a';tri(g,fx0+fw*0.15,fl0*m+hy,fx0+fw*0.85,fl0*m+hy,fx0+fw*0.45,fl0*m+hy-fh*0.65);
          g.fillStyle='#ffd84a';tri(g,fx0+fw*0.3,fl0*m+hy,fx0+fw*0.7,fl0*m+hy,fx0+fw*0.5,fl0*m+hy-fh*0.3);
          g.globalCompositeOperation='lighter';g.globalAlpha=0.6;g.drawImage(S.fire,fx0-fw,fl0*m+hy-fh*1.3,fw*3,fh*1.6);
          g.globalAlpha=1;g.globalCompositeOperation='source-over';}
      }
    }
    // Your shadow a few metres ahead shows your height above the floor.
    const s3=f/3;g.fillStyle='rgba(0,0,0,.4)';g.beginPath();g.ellipse(0,fl0*s3+hy,0.45*s3,0.12*s3,0,0,Math.PI*2);g.fill();
    // Things in the corridor as flat sprites, far to near (insertion sort on a reused array).
    let n=0;for(let i=0;i<objs.length;i++)if(objs[i].on&&objs[i].z>0.25)order[n++]=objs[i];
    for(let i=1;i<n;i++){const o=order[i];let j=i-1;while(j>=0&&order[j].z<o.z){order[j+1]=order[j];j--;}order[j+1]=o;}
    for(let i=0;i<n;i++){const o=order[i],s=f/o.z;g.globalAlpha=clamp((FAR-o.z)/12,0,1);drawObj(g,o,s,(o.x-fx)*s,(o.y-fy)*s+hy,hy);}
    g.globalAlpha=1;g.globalCompositeOperation='lighter';
    for(const b of booms)if(b.on){const k=b.t/0.3,r=b.s*(0.4+k);g.globalAlpha=1-k;g.drawImage(S.fire,b.x-r,b.y+hy-r,r*2,r*2);g.drawImage(S.goo,b.x-r*0.5,b.y+hy-r*0.5,r,r);}
    g.globalAlpha=1;g.globalCompositeOperation='source-over';
    for(let i=0;i<parts.length;i++){const p=parts[i];if(!p.on||!p.sp)continue;g.globalAlpha=Math.min(1,p.life/p.max*1.5);g.fillStyle=pal(0,p.hue);g.fillRect(p.x,p.y+hy,p.s,p.s);}
    g.globalAlpha=1;
    // Still high: the colours drift round the rainbow.
    g.setTransform(1,0,0,1,0,0);g.globalCompositeOperation='color';g.globalAlpha=0.32;const bw=Math.ceil(lo.width/6);
    for(let i=0;i<6;i++){g.fillStyle=pal(1,hueT*1.2+i*60);g.fillRect(i*bw,0,bw,lo.height);}
    g.globalAlpha=1;g.globalCompositeOperation='source-over';
    ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(lo,0,0,lo.width*R,lo.height*R);
  }
  // The robot's own arm, bobbing as it goes, with the zapper's tip glowing.
  function drawArm(e){
    const sc=Math.max(2,Math.round(ch*0.3/16)),bar=barH()*dpr,bob=Math.sin(time*7);
    const x=Math.round(cw/2-9*sc+bob*sc*2.5+fvx*sc*0.8),y=Math.round(ch-bar-16*sc+Math.abs(Math.cos(time*7))*sc*2+sc*3+(1-e)*sc*18+recoil*sc*3);armTX=x+9*sc;armTY=y+sc;
    ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=true;ctx.globalCompositeOperation='lighter';ctx.globalAlpha=0.5+0.3*Math.sin(time*9);
    ctx.drawImage(S.goo,x+9*sc-sc*6,y-sc*5,sc*12,sc*12);ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;ctx.imageSmoothingEnabled=false;
    ctx.drawImage(S.arm,x,y,18*sc,16*sc);
  }
  function quad(g,x0,y0,x1,y1,x2,y2,x3,y3){g.beginPath();g.moveTo(x0,y0);g.lineTo(x1,y1);g.lineTo(x2,y2);g.lineTo(x3,y3);g.closePath();g.fill();}
  function tri(g,x0,y0,x1,y1,x2,y2){g.beginPath();g.moveTo(x0,y0);g.lineTo(x1,y1);g.lineTo(x2,y2);g.closePath();g.fill();}
  function square(g,cx,cy,r,a){g.beginPath();for(let i=0;i<4;i++){const t=a+i*Math.PI/2;i?g.lineTo(cx+Math.cos(t)*r,cy+Math.sin(t)*r):g.moveTo(cx+Math.cos(t)*r,cy+Math.sin(t)*r);}g.closePath();}
  function drawObj(g,o,s,sx,sy,hy){
    const hue=o.hue+hueT*0.5;
    if(o.kind===RACK){ // a burning firewall
      const w=0.8*s,top=(FLOOR-o.h-fy)*s+hy,base=sy,bh=0.45*s,lw=Math.max(1,0.06*s);
      g.fillStyle=pal(1,hue);g.fillRect(sx-w/2,top,w,base-top);
      g.fillStyle=pal(2,hue);let r=0;
      for(let y=top+bh;y<base;y+=bh,r++){g.fillRect(sx-w/2,y,w,lw);g.fillRect(sx+(r%2?-w*0.2:w*0.2),y,lw,bh);}
      const fh=0.9*s*(0.8+0.2*Math.sin(time*14+o.a*3));
      g.fillStyle='#ff5a1a';g.beginPath();g.moveTo(sx-w/2,top);g.lineTo(sx-w*0.25,top-fh*0.7);g.lineTo(sx,top-fh);g.lineTo(sx+w*0.3,top-fh*0.6);g.lineTo(sx+w/2,top);g.fill();
      g.fillStyle='#ffd84a';g.beginPath();g.moveTo(sx-w*0.25,top);g.lineTo(sx+w*0.05,top-fh*0.5);g.lineTo(sx+w*0.28,top);g.fill();
    }else if(o.kind===BLOCK){ // a security drone coming down the corridor, as a flat sprite
      const w=o.r*s*2.6,h=w*8/14,fr=(time*12|0)%2?S.drone1:S.drone0;
      g.drawImage(fr,sx-w/2,sy-h/2+Math.sin(time*5+o.a)*0.1*s,w,h);
    }else if(o.kind===RING){
      g.lineWidth=0.24*s;g.strokeStyle=pal(0,hue+hueT);g.beginPath();g.arc(sx,sy,o.r*s,0,Math.PI*2);g.stroke();
      g.lineWidth=0.07*s;g.strokeStyle='#fff';g.beginPath();g.arc(sx,sy,o.r*s,0,Math.PI*2);g.stroke();
    }else{ // another virus: more of it keeps the trip going
      const w=1.7*s*(1+0.08*Math.sin(time*10+o.a));
      g.globalCompositeOperation='lighter';g.drawImage(S.goo,sx-w,sy-w,w*2,w*2);g.globalCompositeOperation='source-over';
      const j=((time*12)|0)%2?0.06*s:-0.06*s;
      g.drawImage(S.virusM,sx-w/2-j,sy-w/2,w,w);g.drawImage(S.virusC,sx-w/2+j,sy-w/2,w,w);g.drawImage(S.virus,sx-w/2,sy-w/2,w,w);
    }
  }
  function drawCracks(){
    ctx.setTransform(1,0,0,1,0,0);ctx.strokeStyle='rgba(255,255,255,.75)';ctx.lineWidth=Math.max(1,dpr);ctx.beginPath();
    for(const c of cracks)if(c.on){ctx.moveTo(c.pts[0],c.pts[1]);for(let i=1;i<7;i++)ctx.lineTo(c.pts[i*2],c.pts[i*2+1]);}
    ctx.stroke();
  }
  function text(str,x,y,size,weight,align,color,outline){
    ctx.font=`${weight} ${size}px ${font}`;ctx.textAlign=align;ctx.textBaseline='middle';
    if(outline){ctx.lineWidth=3;ctx.lineJoin='round';ctx.strokeStyle=outline;ctx.strokeText(str,x,y);}
    ctx.fillStyle=color;ctx.fillText(str,x,y);
  }
  // Big text with its colour channels split, the way the virus sees it.
  function glitchText(str,x,y,size,j){
    text(str,x-j,y,size,800,'center','#ff2bd6','rgba(0,0,0,.7)');text(str,x+j,y,size,800,'center','#2bf0ff');text(str,x,y,size,800,'center','#fff');
  }
  const barH=()=>Math.round(clamp(cssH*0.16,26,46));
  // The first-person status bar: score, the robot's face, spare shades (your lives) and how long the trip lasts.
  function statusBar(fs){
    const h=barH(),y=cssH-h,lab=Math.max(8,Math.round(h*0.22)),big=Math.round(h*0.46);
    ctx.fillStyle='#2a2d34';ctx.fillRect(0,y,cssW,h);ctx.fillStyle='#4a505b';ctx.fillRect(0,y,cssW,2);ctx.fillStyle='#16181d';ctx.fillRect(0,cssH-2,cssW,2);
    const fw=h*1.15,fx0=cssW/2-fw/2,cols=[0,cssW*0.3,fx0,fx0+fw,cssW*0.72];
    ctx.fillStyle='#1a1c22';for(let i=1;i<cols.length;i++)ctx.fillRect(cols[i]-1,y+3,2,h-5);
    const lab0=y+lab*0.8,num=y+h*0.6;
    text('SCORE',cssW*0.15,lab0,lab,700,'center','#9aa4b2');
    text(String(Math.floor(score)),cssW*0.15,num,big,800,'center','#ffb020','rgba(0,0,0,.6)');
    // The face looks hurt after a hit and wears the shades.
    ctx.fillStyle='#111318';ctx.fillRect(fx0+3,y+4,fw-6,h-7);
    const sc=Math.max(1,Math.floor((h-8)/14)),px=Math.round(cssW/2-8*sc),py=Math.round(y+4+(h-7-14*sc)/2);
    ctx.imageSmoothingEnabled=false;ctx.drawImage(S.face,px,py,16*sc,14*sc);
    ctx.fillStyle='#0b0d14';ctx.fillRect(px+6*sc,py+6*sc,3*sc,3*sc);ctx.fillRect(px+11*sc,py+6*sc,3*sc,3*sc);
    const hurt=fhit>0.3;ctx.fillStyle=hurt?'#ff3b3b':'#5ff6ff';
    if(hurt){for(let ex=6;ex<=11;ex+=5){ctx.fillRect(px+ex*sc,py+6*sc,sc,sc);ctx.fillRect(px+(ex+2)*sc,py+6*sc,sc,sc);ctx.fillRect(px+(ex+1)*sc,py+7*sc,sc,sc);ctx.fillRect(px+ex*sc,py+8*sc,sc,sc);ctx.fillRect(px+(ex+2)*sc,py+8*sc,sc,sc);}}
    else{ctx.drawImage(S.glasses,px+2*sc,py+5*sc,12*sc,4*sc);ctx.fillStyle='#ff2bd6';ctx.fillRect(px+7*sc,py+6*sc,sc,sc);ctx.fillRect(px+12*sc,py+6*sc,sc,sc);}
    const sx=(cols[1]+fx0)/2;text('SHADES',sx,lab0,lab,700,'center','#9aa4b2');
    const gw=Math.min(22,(fx0-cols[1])/3.6),gh=gw*4/12;
    for(let i=0;i<3;i++){ctx.globalAlpha=i<lives?1:0.2;ctx.drawImage(S.glassesWhite,sx-gw*1.6+i*gw*1.1,num-gh/2,gw,gh);}ctx.globalAlpha=1;
    const tx=(fx0+fw+cols[4])/2;text('GLITCH',tx,lab0,lab,700,'center','#9aa4b2');
    const tw=Math.min(90,(cols[4]-fx0-fw)*0.8),left=clamp(1-flyT/TRIP_LEN,0,1);
    ctx.fillStyle='#111318';ctx.fillRect(tx-tw/2,num-4,tw,8);ctx.fillStyle=pal(0,hueT);ctx.fillRect(tx-tw/2,num-4,tw*left,8);
    text('ZAPPED',cssW*0.86,lab0,lab,700,'center','#9aa4b2');text(String(kills),cssW*0.86,num,Math.round(big*0.8),800,'center','#eef3fa','rgba(0,0,0,.6)');
  }
  function drawHud(){
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.globalAlpha=1;
    const fs=Math.round(clamp(cssH*0.07,11,16)),fly=phase==='play'&&flying();
    const col='#eef3fa',ol='rgba(0,0,0,.65)';
    const s=Math.floor(score);
    if(s!==scoreShown){scoreShown=s;scoreText=(best?`HI ${String(best).padStart(5,'0')}   `:'')+String(s).padStart(5,'0');}
    if(phase!=='idle'&&!fly&&!(flashT>0&&(flashT*8|0)%2))text(scoreText,cssW-10,14,fs,600,'right',col,ol);
    else if(phase==='idle'&&best)text(`HI ${String(best).padStart(5,'0')}`,cssW-10,14,fs,600,'right',col,ol);
    if(phase==='play'&&(mode==='melt'||mode==='glasses')&&(time*6|0)%3)
      glitchText(mode==='melt'?'VIRUS DETECTED':'SYSTEM COMPROMISED',cssW/2,cssH*0.22,Math.round(fs*1.3),1+((time*20)|0)%3);
    if(fly){
      statusBar(fs);
      ctx.setTransform(dpr,0,0,dpr,0,0);
      for(const p of pops)if(p.on){ctx.globalAlpha=clamp((1.1-p.t)/0.4,0,1);text(p.txt,p.x/dpr,p.y/dpr-p.t*28,Math.round(fs*(p.big?1.5:1.3)),800,'center',p.big&&(p.t*10|0)%2?'#ffd84a':'#fff',ol);}
      ctx.globalAlpha=1;
      if(mode==='fly'&&hintT<2.2)text("Zap: Space / click  ·  Steer: arrows / WASD / mouse",cssW/2,cssH*0.2,fs,600,'center','#fff',ol);
    }
    const cy=cssH*0.36;
    if(phase==='idle'){
      const tall=cssH>130;ctx.fillStyle='rgba(4,5,9,.6)';ctx.fillRect(0,cy-fs*2.1,cssW,fs*(tall?4.9:3.3));
      glitchText('ROBO RUN',cssW/2,cy-fs*1.1,Math.round(fs*1.5),1.5);
      text('Press Space or tap to play',cssW/2,cy+fs*0.4,fs,500,'center',col,ol);
      if(tall)text('Space / ↑ jump  ·  ↓ duck  ·  viruses are… interesting',cssW/2,cy+fs*1.8,Math.max(10,fs-3),400,'center','#aab4c3');
    }else if(phase==='over'){
      ctx.fillStyle='rgba(4,5,9,.55)';ctx.fillRect(0,cy-fs*2,cssW,fs*4.2);
      glitchText('GAME OVER',cssW/2,cy-fs*0.9,Math.round(fs*1.4),1);
      text('robot.exe has stopped responding',cssW/2,cy+fs*0.35,Math.max(10,fs-3),400,'center','#ff8a8a',ol);
      text('Press Space to run again',cssW/2,cy+fs*1.4,fs,500,'center',col,ol);
    }else if(paused){
      ctx.globalAlpha=0.55;ctx.fillStyle='#000';ctx.fillRect(0,0,cssW,cssH);ctx.globalAlpha=1;
      text('Paused — press Space',cssW/2,cssH/2,Math.round(fs*1.2),700,'center','#fff',ol);
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
    unlockAudio();
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
  const ro=new ResizeObserver(()=>{if(!resizeQueued)resizeQueued=requestAnimationFrame(measure);}); // outside the callback: no RO loop warnings
  window.addEventListener('keydown',onKey);window.addEventListener('keyup',onKey);window.addEventListener('blur',pauseGame);
  document.addEventListener('visibilitychange',onVisibility);
  cv.addEventListener('pointerdown',onPointerDown);cv.addEventListener('pointerup',onPointerUp);cv.addEventListener('pointercancel',onPointerUp);
  cv.addEventListener('pointermove',pointerAim);muteBtn.addEventListener('click',onMute);
  cv.addEventListener('contextmenu',e=>e.preventDefault());
  ro.observe(container);
  font=getComputedStyle(document.body||document.documentElement).fontFamily||'sans-serif';
  drawMute();measure();

  // Tests only: lets a probe read the state and fast-forward to a trip.
  const debug=options.debug?{state:()=>({phase,mode,score:Math.floor(score),tint,lives,flyT,paused,rafId,invuln}),trip(){if(phase!=='play')start();mode='melt';modeT=0;impacted=false;},godMode(s){invuln=s;},popAt(txt,fx,fy){pop(txt,cw*fx,ch*fy,true);const out=[];for(const p of pops)if(p.on)out.push([Math.round(p.x),Math.round(p.y-p.t*28*dpr),p.txt]);return out;},fly(){if(phase!=='play')start();mode='warpIn';modeT=0;cool=true;startFly();}}:undefined;
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
      document.removeEventListener('visibilitychange',onVisibility);ro.disconnect();
      if(ac)ac.close().catch(()=>{});root.remove();
    },
    get playing(){return phase==='play'&&!paused&&!!rafId;},
  };
}
window.DeckTripRun={create};
})();
