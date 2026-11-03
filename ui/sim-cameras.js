(function(root,factory){const value=factory(root);if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckCameras=value;})(typeof globalThis==='object'?globalThis:this,root=>{
  'use strict';
  // Run-video cameras. Each one is a path worked out from the recorded run, frame by frame: where the camera sits and
  // what it looks at ([x, y, z] in field inches, z up) and its field of view. The path depends only on the recorded
  // frames, the field and the camera's settings, so a picture at 12.5 s is the same in the preview, after seeking and
  // in an export, and changing cameras never changes the run. Camera 1 is the original run-video camera (the follow
  // camera of Record), worked out as it always was; the others watch the game pieces, whatever the robot moves them
  // with: where they come in, and each one leaving it (shot, lifted or dropped) on its way to score. Every camera then
  // keeps out of the walls, the field's structures and flowers and the robot, and does not watch through them (clear).
  const DEG=Math.PI/180,wrap=a=>Math.atan2(Math.sin(a),Math.cos(a)),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),finite=Number.isFinite;
  const mech=()=>root.DeckMechanisms||(typeof require==='function'?require('./sim-mechanisms.js'):null);
  const CAMERAS=[
    {id:'main',name:'Main',label:'Main · follow camera',key:'1',color:'#4ea1ff',
      hint:'The original run-video camera: behind and above the robot, turning to the goal while it shoots, with the whole field in the corner.'},
    {id:'mech',name:'Front corner',label:'Front corner · what it reaches for',key:'2',color:'#f2bc62',
      hint:'Low at the robot’s front corner, on whatever it reaches for: pieces on the floor or in a field element.',
      modes:{track:'Tracks the action',fixed:'Fixed on the robot'}},
    {id:'turret',name:'Scoring',label:'Scoring · each piece to the goal',key:'3',color:'#b79bff',
      hint:'Rides behind each piece that leaves the robot (shot, lifted or dropped) until it lands; between them it waits behind where pieces leave, looking at the goal.',
      modes:{piece:'Follows each piece',follow:'Behind where pieces leave',pov:'Over the shooter, looking where it aims',fixed:'Fixed on the robot'}},
    {id:'chase',name:'Rear chase',label:'Rear chase',key:'4',color:'#49cbb3',
      hint:'Low behind the chassis, trailing it smoothly through turns and strafes, further back the faster it drives.',
      modes:{smooth:'Smooth chase',tight:'Tight chase'}},
    {id:'intake',name:'Pick-up',label:'Pick-up · pieces coming in',key:'5',color:'#e5484d',
      hint:'In front of where pieces come into the robot, looking back at it, so each one is seen going in.',
      modes:{follow:'Dynamic follow',fixed:'Fixed close-up'}}];
  const IDS=CAMERAS.map(c=>c.id),byId=Object.fromEntries(CAMERAS.map(c=>[c.id,c]));
  // Fine-tuning per camera: its mode, how far and how high it sits (1 is as designed), how far it swings round the
  // robot (degrees) and its field of view. Camera 1 has none: it stays the original.
  const DEFAULTS={main:{fov:50},mech:{mode:'track',distance:1,height:1,swing:0,fov:58},turret:{mode:'piece',distance:1,height:1,swing:0,fov:60},chase:{mode:'smooth',distance:1,height:1,swing:0,fov:55},intake:{mode:'follow',distance:1,height:1,swing:0,fov:62}};
  function settings(raw){
    const out={};for(const id of IDS){const d=DEFAULTS[id],r=raw?.[id]||{};out[id]={...d};if(id==='main')continue;
      if(byId[id].modes[r.mode])out[id].mode=r.mode;for(const [k,[a,b]] of Object.entries({distance:[.5,2.5],height:[.3,3],swing:[-90,90],fov:[25,90]}))if(finite(r[k]))out[id][k]=clamp(r[k],a,b);}
    return out;
  }
  // ---------------------------------------------------------------- where the mechanisms are
  // Points on the robot (robot frame: inches, x forward, y left, z up from the floor) the cameras look at: the front
  // intake's mouth (or the first intake's), the ramp, and each shooter's turret. From the CAD parts when the model
  // names them, else from the mechanism settings and the robot's size. `reach` is how far intakes stick out past the
  // chassis on each side, so the cameras keep clear of them too. `turrets` are the turrets drawn on the robot's top
  // (sim-robot-model.js kin.turrets): a shooter drawn so turns about that pivot, the cameras keep out of it, and `top`
  // is how tall the robot looks with them (`height` stays the chassis's own, for the robot's box).
  const SIDE={front:[1,0],back:[-1,0],left:[0,1],right:[0,-1]};
  function rig({footprint,robot={},mechanisms,parts,aim,turrets}={}){
    const f=footprint||{front:9,rear:9,half:9},height=finite(robot.heightIn)?robot.heightIn:12,size=Math.max(14,f.front+f.rear),m=mechanisms?.enabled?mechanisms:null;
    const edge=side=>side==='front'?f.front:side==='back'?f.rear:f.half,box=p=>p?.box?[(p.box.x0+p.box.x1)/2,(p.box.y0+p.box.y1)/2,(p.box.z0+p.box.z1)/2]:null;
    const partFor=(role,kind)=>(parts||[]).find(p=>p.role===role&&(!kind||p.kind===kind)),out=i=>finite(i?.reach)?Math.max(0,i.reach):0;
    const at=(intake)=>{const side=(intake?.sides||['front']).find(s=>s==='front')||intake?.sides?.[0]||'front',[dx,dy]=SIDE[side]||SIDE.front,e=edge(side)+out(intake)-1;
      return {side,dir:[dx,dy],point:[dx*e,dy*e,clamp(finite(intake?.height)?intake.height/2:3,1.5,6)]};};
    const intakes=m?.intakes||[],front=intakes.find(i=>i.sides?.includes('front'))||intakes[0]||null,ramp=intakes.find(i=>i.kind==='ramp')||null;
    const reach={front:0,back:0,left:0,right:0};for(const i of intakes)for(const s of i.sides||[])if(s in reach)reach[s]=Math.max(reach[s],out(i));
    const intake=at(front),rampAt=ramp?at(ramp):null;
    // A CAD part for the intake or ramp moves the point to the part, when it sits on that side of the robot.
    const ip=box(partFor('intake',front?.kind)),rp=box(partFor('intake','ramp'));
    if(ip&&ip[0]*intake.dir[0]+ip[1]*intake.dir[1]>0)intake.point=[ip[0],ip[1],clamp(ip[2],1.5,8)];
    if(rampAt&&rp&&rp[0]*rampAt.dir[0]+rp[1]*rampAt.dir[1]>0)rampAt.point=[rp[0],rp[1],clamp(rp[2],1.5,8)];
    const M=mech(),dims={length:robot.length||17,width:robot.width||17};
    const shooters=(aim?.shooters||m?.shooters||[]).map((s,n)=>{const [ox,oy]=M?M.mountOffset(s.mount,dims):[0,0],a=s.at,d=(turrets||[]).find(x=>x?.n===n&&!x.hidden&&x.pivot?.every(finite)&&finite(x.z1));
      const point=d?[d.pivot[0],d.pivot[1],d.z1]:a&&finite(a.x)&&finite(a.y)?[a.x,a.y,finite(a.z)?a.z:height]:[ox,oy,height];
      return {n,type:s.type,pieces:s.pieces||'pollen',point,facing:M?.FACING?.[s.facing]||0,drawn:d||null};});
    const gate=!!m?.shooters?.some(s=>s.indexerKind==='gate');
    return {size,height,top:Math.max(height,...shooters.map(s=>s.drawn?s.drawn.z1:0)),footprint:f,reach,intake,ramp:rampAt,shooters,gate,hasMechanisms:!!m};
  }
  // ---------------------------------------------------------------- the field, as solid boxes
  // A solid is a box: centre c, three unit axes u, half sizes e along them, and r, the radius of a ball round it.
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  // The axes of a 3×3 symmetric matrix (its eigenvectors), by Jacobi rotations.
  function axes(S){
    const A=S.map(r=>r.slice()),V=[[1,0,0],[0,1,0],[0,0,1]];
    for(let sweep=0;sweep<12;sweep++)for(const [p,q] of [[0,1],[0,2],[1,2]]){
      if(Math.abs(A[p][q])<1e-12)continue;const th=(A[q][q]-A[p][p])/(2*A[p][q]),t=(th<0?-1:1)/(Math.abs(th)+Math.sqrt(th*th+1)),c=1/Math.sqrt(t*t+1),s=t*c;
      for(let k=0;k<3;k++){const a=A[k][p],b=A[k][q];A[k][p]=c*a-s*b;A[k][q]=s*a+c*b;}
      for(let k=0;k<3;k++){const a=A[p][k],b=A[q][k];A[p][k]=c*a-s*b;A[q][k]=s*a+c*b;}
      for(let k=0;k<3;k++){const a=V[k][p],b=V[k][q];V[k][p]=c*a-s*b;V[k][q]=s*a+c*b;}}
    return [0,1,2].map(j=>[V[0][j],V[1][j],V[2][j]]);
  }
  // The box round points (flat [x, y, z, ...]), turned to their main directions so a slanting hive leg gets a slim
  // box rather than one round its whole slope; `turned` false keeps it square to the field.
  function fit(p,turned=true){
    const n=p.length/3;if(n<2)return null;const c=[0,0,0];for(let i=0;i<p.length;i+=3)for(let k=0;k<3;k++)c[k]+=p[i+k]/n;
    let u=[[1,0,0],[0,1,0],[0,0,1]];
    if(turned){const A=[[0,0,0],[0,0,0],[0,0,0]];for(let i=0;i<p.length;i+=3){const d=[p[i]-c[0],p[i+1]-c[1],p[i+2]-c[2]];for(let a=0;a<3;a++)for(let b=0;b<3;b++)A[a][b]+=d[a]*d[b];}u=axes(A);}
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<p.length;i+=3){const d=[p[i]-c[0],p[i+1]-c[1],p[i+2]-c[2]];for(let k=0;k<3;k++){const v=dot(d,u[k]);lo[k]=Math.min(lo[k],v);hi[k]=Math.max(hi[k],v);}}
    const centre=c.slice();for(let k=0;k<3;k++)for(let j=0;j<3;j++)centre[j]+=u[k][j]*(lo[k]+hi[k])/2;
    const e=[0,1,2].map(k=>Math.max(.3,(hi[k]-lo[k])/2));return {c:centre,u,e,r:Math.hypot(...e)};
  }
  // P in the box's own frame.
  function local(o,P){const d=[P[0]-o.c[0],P[1]-o.c[1],P[2]-o.c[2]];return [dot(d,o.u[0]),dot(d,o.u[1]),dot(d,o.u[2])];}
  // How far P is from the box (0 inside it), and the box's point nearest P.
  function gap(o,P){const q=local(o,P);let s=0;for(let k=0;k<3;k++){const d=Math.abs(q[k])-o.e[k];if(d>0)s+=d*d;}return Math.sqrt(s);}
  function nearest(o,P){const q=local(o,P),out=o.c.slice();for(let k=0;k<3;k++){const v=clamp(q[k],-o.e[k],o.e[k]);for(let j=0;j<3;j++)out[j]+=o.u[k][j]*v;}return out;}
  // Whether the segment from A to B passes through the box.
  function crosses(o,A,B){
    const a=local(o,A),b=local(o,B);let t0=0,t1=1;
    for(let k=0;k<3;k++){const d=b[k]-a[k],e=o.e[k];if(Math.abs(d)<1e-9){if(Math.abs(a[k])>e)return false;continue;}
      let p=(-e-a[k])/d,q=(e-a[k])/d;if(p>q)[p,q]=[q,p];t0=Math.max(t0,p);t1=Math.min(t1,q);if(t0>t1)return false;}
    return true;
  }
  // The field's solid parts as the cameras see them: each part of the hive (frame legs, bars, panels, tray cells) as
  // a box fitted to it, each flower as one box (its posts with the pollen stacked between them) and, on other game
  // fields, the floor obstacles raised as the field view draws them; the perimeter walls (WALL high) stand on the
  // bounds. From the engine's field info. goalZ is about the height of the goal's cells.
  const WALL=12;
  function field(info){
    if(!info)return null;const solids=[],flowers=new Map();
    for(const part of info.structureParts||[]){if(!(part.points?.length>=6))continue;const f=/^flower_(\d+)_/.exec(part.name||'');
      if(f){if(!flowers.has(f[1]))flowers.set(f[1],[]);flowers.get(f[1]).push(...part.points);}else{const b=fit(part.points);if(b)solids.push(b);}}
    for(const points of flowers.values())solids.push(fit(points,false));
    if(info.field!=='biobuzz')for(const z of info.fieldZones||[]){
      if(z.type==='rect'&&[z.x,z.y,z.width,z.height].every(finite)){const a=z.angle||0,c=Math.cos(a),s=Math.sin(a),e=[z.width/2,z.height/2,(z.width<10?16:18)/2];solids.push({c:[z.x,z.y,e[2]],u:[[c,s,0],[-s,c,0],[0,0,1]],e,r:Math.hypot(...e)});}
      else if(Array.isArray(z.points)&&z.points.length>2){const p=[];for(const q of z.points)p.push(q.x,q.y,0,q.x,q.y,43);solids.push(fit(p,false));}}
    const tray=Object.values(info.trays||{})[0];
    return {bounds:info.bounds||null,wall:WALL,solids,goalZ:finite(tray?.pivot?.[2])?tray.pivot[2]-4:36};
  }
  // ---------------------------------------------------------------- shared helpers
  const toWorld=(t,yaw,[x,y,z])=>[t.x+x*Math.cos(yaw)-y*Math.sin(yaw),t.y+x*Math.sin(yaw)+y*Math.cos(yaw),z];
  const lerp=(a,b,k)=>a.map((v,i)=>v+(b[i]-v)*k);
  const ease=(dt,tau,ready)=>ready?1-Math.exp(-Math.max(0,dt)/tau):1;
  const ballXY=b=>[b.pos.x+72,b.pos.y+72,Math.max(0,b.z||0)];
  // Where each shooter points while it spins up, aims or shoots, and the goal along that line (within 25°).
  // This is the original run-video camera's own reading of the aim, also used to draw the aim beams.
  function aims(frame,aim){
    const m=frame?.mechanisms,t=frame?.truth,c=m?.command||{};if(!aim||!m||!t||!(c.feed||c.spin||c.aim||m.flywheel>.05))return [];
    const M=mech(),h=t.heading*DEG;
    return aim.shooters.map((s,n)=>{const [ox,oy]=M.mountOffset(s.mount,aim.dims),x=t.x+ox*Math.cos(h)-oy*Math.sin(h),y=t.y+ox*Math.sin(h)+oy*Math.cos(h);
      const dir=h+(s.type==='turret'?(m.turrets?.[n]??m.turret??0):M.FACING[s.facing]||0)*DEG;let len=48,goal=null;
      for(const g of aim.targets){const d=Math.hypot(g.x-x,g.y-y);if(Math.abs(wrap(Math.atan2(g.y-y,g.x-x)-dir))<25*DEG&&(!goal||d<len)){len=d;goal=g;}}
      return {x,y,dir,len,goal,on:!!(m.ready&&m.aligned)};});
  }
  // ---------------------------------------------------------------- camera 1: the original follow camera
  // Behind the robot and above it, turning with it (smoothly, so turning on the spot does not whip the picture
  // round). While the robot spins up, aims or shoots, and for 2 s after, the camera swings behind the robot towards
  // the goal, pulls up and widens its view (50° to 60°), so the robot, its aim and where the pieces land are all in
  // view. A robot that has stood still for 1.5 s (parked, or waiting) is seen from further back and higher up.
  // `follow` carries it between pictures; dt 0 starts afresh.
  function mainStep(follow,{frame,start,aim,footprint,bounds},dt){
    const t=frame?.truth||start;if(!t)return null;if(!dt)follow.ready=false;
    const k=tau=>follow.ready?1-Math.exp(-Math.max(0,dt)/tau):1,f=footprint||{front:9,rear:9},size=Math.max(14,f.front+f.rear),h=t.heading*DEG;
    follow.yaw=(follow.yaw||0)+wrap(h-(follow.yaw||0))*k(.7);
    const goal=aims(frame,aim).find(b=>b.goal)?.goal;if(goal){follow.goal=goal;follow.hold=2;}else follow.hold=Math.max(0,(follow.hold||0)-dt);
    follow.shot=(follow.shot||0)+((follow.hold>0&&follow.goal?1:0)-(follow.shot||0))*k(.6);
    follow.still=Math.hypot(t.vx||0,t.vy||0)>2||Math.abs(t.omega||0)>10?0:(follow.still||0)+Math.max(0,dt);follow.wide=(follow.wide||0)+((follow.still>1.5?1:0)-(follow.wide||0))*k(1.2);
    const r=[t.x,t.y,0],dir=[Math.cos(follow.yaw),Math.sin(follow.yaw),0];
    const far=1+.7*follow.wide;let pos=[r[0]-dir[0]*size*2.4*far,r[1]-dir[1]*size*2.4*far,size*2.3*(1+.9*follow.wide)],look=[r[0]+dir[0]*size*1.8,r[1]+dir[1]*size*1.8,0];
    if(follow.shot>.001&&follow.goal){const to=[follow.goal.x-r[0],follow.goal.y-r[1],0],len=Math.hypot(to[0],to[1]),d=len>1?[to[0]/len,to[1]/len,0]:dir;
      pos=lerp(pos,[r[0]-d[0]*size*2.4,r[1]-d[1]*size*2.4,size*2.6],follow.shot);look=lerp(look,[r[0]+to[0]*.4,r[1]+to[1]*.4,16],follow.shot);}
    // Not far outside the field, where the camera would look through the perimeter.
    if(bounds){pos[0]=clamp(pos[0],bounds.x0-18,bounds.x1+18);pos[1]=clamp(pos[1],bounds.y0-18,bounds.y1+18);}
    follow.pos=follow.ready&&follow.pos?lerp(follow.pos,pos,k(.3)):pos;follow.look=follow.ready&&follow.look?lerp(follow.look,look,k(.3)):look;follow.ready=true;
    return {p:follow.pos.slice(),l:follow.look.slice(),fov:50+10*(follow.goal?follow.shot:0)};
  }
  // Camera 1 keeps all of the robot (a ball r inches round S) in its 16:9 picture: where the robot would reach past an
  // edge (driving fast out of the shot, or under a camera moved round something), it turns just enough to bring it back.
  function inView(pose,S,r){
    const p=pose.p,v=[pose.l[0]-p[0],pose.l[1]-p[1],pose.l[2]-p[2]],d=[S[0]-p[0],S[1]-p[1],S[2]-p[2]],ld=Math.hypot(...v),sd=Math.hypot(...d);if(!ld||!sd)return pose;
    const ly=Math.atan2(v[1],v[0]),lp=Math.atan2(v[2],Math.hypot(v[0],v[1])),sy=Math.atan2(d[1],d[0]),sp=Math.atan2(d[2],Math.hypot(d[0],d[1]));
    const high=pose.fov*DEG/2,wide=Math.atan(Math.tan(high)*16/9),size=Math.asin(Math.min(1,r/sd))+2*DEG,up=sp-lp,side=wrap(sy-ly)*Math.cos(sp);
    const over=(a,most)=>Math.abs(a)>most?a-Math.sign(a)*most:0,dp=over(up,Math.max(0,high-size)),dy=over(side,Math.max(0,wide-size));if(!dp&&!dy)return pose;
    const pitch=clamp(lp+dp,-88*DEG,88*DEG),yaw=ly+dy/Math.max(.2,Math.cos(sp));
    return {...pose,l:[p[0]+ld*Math.cos(pitch)*Math.cos(yaw),p[1]+ld*Math.cos(pitch)*Math.sin(yaw),p[2]+ld*Math.sin(pitch)]};
  }
  // The robot as camera 1 keeps it in view: the middle of it as drawn and the ball round it (a little inside its box's corners).
  const robotBall=(t,R)=>[[t.x,t.y,R.top/2+(t.z||0)],.8*Math.hypot(Math.max(R.footprint.front,R.footprint.rear),R.footprint.half,R.top/2)];
  // ---------------------------------------------------------------- cameras 2 to 5
  // The piece in the air to follow (its id): the one followed so far while it flies, else the one that left the robot
  // last (nearest it), or null.
  function pieceInFlight(world,id,at){const flying=(world?.balls||[]).filter(b=>b.state?.kind==='flight');if(!flying.length)return null;if(id!=null&&flying.some(b=>b.id===id))return id;
    let best=null,bd=Infinity;for(const b of flying){const p=ballXY(b),d=Math.hypot(p[0]-at[0],p[1]-at[1]);if(d<bd){bd=d;best=b.id;}}return best;}
  // Something worth looking at near a point: the closest flower piece or loose piece within `reach` inches.
  function interest(world,point,reach,kinds){
    let best=null,bd=reach;for(const b of world?.balls||[]){const k=b.state?.kind;if(!kinds.includes(k))continue;const p=ballXY(b),d=Math.hypot(p[0]-point[0],p[1]-point[1]);if(d<bd){bd=d;best=p;}}
    return best;
  }
  // The shooter that fires most in the recording, by the colour of the pieces seen leaving (yellow pollen, red
  // nectar): the camera inside the turret rides it. A turret wins a tie, then the first shooter.
  function busiest(frames,R){
    const list=R?.shooters||[];if(list.length<2)return 0;const seen=new Set(),count={pollen:0,nectar:0};
    for(const f of frames)for(const b of f.fieldState?.balls||[])if(b.state?.kind==='flight'&&!seen.has(b.id)){seen.add(b.id);count[b.color==='yellow'?'pollen':'nectar']++;}
    let best=0,top=-Infinity;list.forEach((sh,i)=>{const v=(sh.pieces==='both'?count.pollen+count.nectar:count[sh.pieces]||0)+(sh.type==='turret'?.5:0)-i*.01;if(v>top){top=v;best=i;}});
    return best;
  }
  // One picture of camera `id` from frame `frame`, `dt` seconds after the last one (0 starts afresh). `s` carries the
  // camera between pictures; `cfg` is its fine-tuning. Besides the pose it says what the camera watches (`watch`: a
  // point, how wide the thing round it is, and whether it is on the robot's edge, where the robot can hide it), which
  // is what clear() keeps in view.
  function step(id,s,{frame,start,aim,footprint,bounds,field:G,rig:R},cfg,dt){
    if(id==='main')return mainStep(s,{frame,start,aim,footprint,bounds},dt);
    const t=frame?.truth||start;if(!t)return null;if(!dt)s.ready=false;
    const k=tau=>ease(dt,tau,s.ready),h=t.heading*DEG,D=cfg.distance,H=cfg.height,swing=cfg.swing*DEG,world=frame?.fieldState,m=frame?.mechanisms;
    const fixed=cfg.mode==='fixed',pov=id==='turret'&&cfg.mode==='pov',size=R.size,f=R.footprint,robot={at:[t.x,t.y,R.height*.55],spread:f.half,edge:false};
    // The yaw the camera turns with: the robot's heading, smoothed (none when fixed to the robot).
    const tauYaw={mech:.22,turret:.12,chase:cfg.mode==='tight'?.25:.45,intake:.3}[id];
    s.yaw=s.ready&&!fixed?s.yaw+wrap(h-s.yaw)*k(tauYaw):h;
    let pos,look,watch,fov=cfg.fov;
    if(id==='mech'){
      // Low at the front-right corner, looking at the ramp (or intake) and across the robot's front.
      const spot=(R.ramp||R.intake).point,target=[spot[0],spot[1],spot[2]];
      const rel=[f.front+9*D,-(f.half+9*D),6+5*D*H],c=Math.cos(swing),sn=Math.sin(swing),off=[rel[0]-target[0],rel[1]-target[1]];
      const p=[target[0]+off[0]*c-off[1]*sn,target[1]+off[0]*sn+off[1]*c,rel[2]];
      pos=toWorld(t,s.yaw,p);look=toWorld(t,s.yaw,target);watch={at:toWorld(t,h,target),spread:3,edge:true};
      // Tracking: the flower pollen (or loose piece) the intake is reaching for pulls the picture towards it.
      if(!fixed){const ahead=toWorld(t,h,[spot[0]+6,spot[1],spot[2]]),near=interest(world,ahead,22,['element','ground']);s.near=s.ready&&s.near?lerp(s.near,near||s.near,k(.4)):near||look;s.w=(s.w||0)+(((near?1:0))-(s.w||0))*k(.5);
        look=lerp(look,[s.near[0],s.near[1],Math.max(1.5,s.near[2])],.35*s.w);}
    }else if(pov){
      // Inside the turret: just over the shooter it rides and a little behind its pivot, looking where it aims, the
      // shooter's top along the bottom of the picture (over a turret drawn on the robot's top, high enough that its
      // housing stays low in the picture and a piece it fires passes well clear of the lens). It turns only with the
      // turret and the robot, never after a piece, so a volley is seen leaving from under the picture and flying on;
      // while the shooter aims at a goal the picture tilts up until the goal is in its upper part (held a moment, so a
      // flicker in the aim does not nod it).
      const sh=R.shooters[s.which]||R.shooters[0],n=sh?.n??0,pivot=sh?sh.point:[0,0,R.height],turn=(sh?sh.type==='turret'?(m?.turrets?.[n]??m?.turret??0):sh.facing:0)*DEG,d=sh?.drawn;
      pos=toWorld(t,h,[pivot[0]-Math.cos(turn)*4*D,pivot[1]-Math.sin(turn)*4*D,(d?d.z1+1.5:Math.max(pivot[2],R.top))+2*H+(t.z||0)]);
      s.aim=s.ready?s.aim+wrap(h+turn+swing-s.aim)*k(.05):h+turn+swing;
      const goal=aims(frame,aim)[n]?.goal;if(goal){s.goal=goal;s.hold=1.5;}else s.hold=Math.max(0,(s.hold||0)-dt);
      // (Only while it still faces the goal: a robot turning away after a volley does not leave it staring at the sky.)
      const facing=s.goal&&Math.abs(wrap(Math.atan2(s.goal.y-pos[1],s.goal.x-pos[0])-s.aim))<40*DEG;
      const tilt=s.hold>0&&facing?clamp(Math.atan2((G?.goalZ??36)-pos[2],Math.hypot(s.goal.x-pos[0],s.goal.y-pos[1]))-12*DEG,-10*DEG,18*DEG):-8*DEG;
      s.pitch=s.ready&&finite(s.pitch)?s.pitch+(tilt-s.pitch)*k(.5):tilt;
      look=[pos[0]+Math.cos(s.aim)*Math.cos(s.pitch)*60,pos[1]+Math.sin(s.aim)*Math.cos(s.pitch)*60,pos[2]+Math.sin(s.pitch)*60];
    }else if(id==='turret'&&cfg.mode==='piece'&&(s.ball=pieceInFlight(world,s.ball,robot.at))){
      // Behind the piece in the air, along the way it is going, a little above it, looking where it is headed: the
      // piece stays in the middle of the picture all the way to the goal. The same piece is kept until it lands.
      const b=(world.balls||[]).find(x=>x.id===s.ball),p=ballXY(b),v=[b.vel?.x||0,b.vel?.y||0],sp=Math.hypot(v[0],v[1]),dir=sp>1?[v[0]/sp,v[1]/sp]:[Math.cos(h),Math.sin(h)];
      pos=[p[0]-dir[0]*16*D,p[1]-dir[1]*16*D,p[2]+5*H];look=[p[0]+dir[0]*12,p[1]+dir[1]*12,p[2]+(b.vz||0)*.05];watch={at:p,spread:2,edge:false};fov=cfg.fov+6;
    }else if(id==='turret'){
      // Behind where pieces leave the robot (its shooter, or its top when it has none), turning with it: the shooter
      // stays in the middle of the picture however fast it turns.
      const sh=R.shooters[s.which]||R.shooters[0],n=sh?.n??0,pivot=sh?sh.point:[0,0,R.height];
      const turret=sh?(sh.type==='turret'?(m?.turrets?.[n]??m?.turret??0):sh.facing):0,aimYaw=h+turret*DEG+(fixed?0:swing);
      s.aim=s.ready&&!fixed?s.aim+wrap(aimYaw-s.aim)*k(.12):aimYaw;
      const base=toWorld(t,h,pivot),dir=[Math.cos(fixed?h+swing:s.aim),Math.sin(fixed?h+swing:s.aim)],left=[-dir[1],dir[0]];
      pos=[base[0]-dir[0]*15*D+left[0]*5,base[1]-dir[1]*15*D+left[1]*5,pivot[2]+8*D*H];look=[base[0]+dir[0]*34,base[1]+dir[1]*34,pivot[2]+1];watch={at:base,spread:3,edge:true};
    }else if(id==='chase'){
      // Trailing the chassis: further back the faster it goes, looking a little ahead of where it is going, high
      // enough that a tall robot's top (turrets drawn on it) stays in the picture.
      const speed=Math.hypot(t.vx||0,t.vy||0),back=size*(1.55+.6*Math.min(1,speed/60))*D,yaw=s.yaw+swing;
      pos=[t.x-Math.cos(yaw)*back,t.y-Math.sin(yaw)*back,Math.max(size*.72,R.top*.75)*H+3];look=[t.x+Math.cos(s.yaw)*size*.5+(t.vx||0)*.3,t.y+Math.sin(s.yaw)*size*.5+(t.vy||0)*.3,Math.max(4,R.top*.3)];watch=robot;
    }else{
      // In front of the intake looking back at it; following, it leans towards the piece being picked up.
      const I=R.intake,[dx,dy]=I.dir,c=Math.cos(swing),sn=Math.sin(swing),out=[dx*c-dy*sn,dx*sn+dy*c],rel=[I.point[0]+out[0]*15*D,I.point[1]+out[1]*15*D,7*D*H+2];
      pos=toWorld(t,s.yaw,rel);look=toWorld(t,s.yaw,[I.point[0],I.point[1],Math.max(1.5,I.point[2]-1)]);watch={at:toWorld(t,h,I.point),spread:3,edge:true};
      if(!fixed){const near=interest(world,toWorld(t,h,[I.point[0]+dx*5,I.point[1]+dy*5,0]),14,['ground','element']);s.w=(s.w||0)+((near?1:0)-(s.w||0))*k(.35);s.near=near||s.near||look;
        look=lerp(look,[s.near[0],s.near[1],Math.max(1.5,s.near[2])],.3*s.w);}
    }
    // The position is smoothed too, so a bump does not shake the picture (fixed cameras stay rigid, and the camera
    // inside the turret stays on it).
    const tauPos=fixed||pov?0:{mech:.12,turret:cfg.mode==='piece'?.25:.08,chase:cfg.mode==='tight'?.12:.2,intake:.1}[id];
    const was=s.ready?s.pos:null;s.pos=s.ready&&tauPos?lerp(s.pos,pos,k(tauPos)):pos;s.look=s.ready&&tauPos?lerp(s.look,look,k(tauPos*.8)):look;
    // Following a piece, the camera glides after it (at most 90 in/s) and turns to keep it in the middle, so a fast shot
    // pans the picture instead of throwing the camera across the field.
    if(was&&id==='turret'&&cfg.mode==='piece'){const d=Math.hypot(s.pos[0]-was[0],s.pos[1]-was[1],s.pos[2]-was[2]),max=90*dt;if(d>max)s.pos=lerp(was,s.pos,max/d);}
    s.ready=true;
    return {p:s.pos.slice(),l:s.look.slice(),fov,watch};
  }
  // ---------------------------------------------------------------- keeping clear of the field
  // Where a camera can go when the place it was designed for is blocked: swung round what it watches, raised over it
  // (or lowered, under the hive's trays), and brought closer, each costing (per second shown) how far that strays
  // from the design. CLEAR is the room a camera keeps round itself, NEAR how close in front of the lens something
  // starts to crowd the picture.
  const MOVES=[];for(const sw of [0,35,-35,70,-70,105,-105])for(const up of [0,20,40,60,-20])for(const near of [1,.7])MOVES.push({swing:sw*DEG,raise:up*DEG,scale:near,cost:Math.abs(sw)/60+Math.abs(up)/35+(1-near)/.3});
  const SWITCH=new Float32Array(MOVES.length**2),CLEAR=2.5,NEAR=6,HARD=40;
  MOVES.forEach((a,i)=>MOVES.forEach((b,j)=>{SWITCH[i*MOVES.length+j]=i===j?0:.4+.3*(Math.abs(a.swing-b.swing)/(60*DEG)+Math.abs(a.raise-b.raise)/(35*DEG)+Math.abs(a.scale-b.scale)/.3);}));
  const toward=(A,B,d)=>{const v=[B[0]-A[0],B[1]-A[1],B[2]-A[2]],l=Math.hypot(...v);return l>d?[A[0]+v[0]*d/l,A[1]+v[1]*d/l,A[2]+v[2]*d/l]:B.slice();};
  // The height at which the line from S (on the field) to P (outside it) passes over the perimeter.
  function over(S,P,b){let t=1;for(const [s,p,lo,hi] of [[S[0],P[0],b.x0,b.x1],[S[1],P[1],b.y0,b.y1]]){if(p>hi)t=Math.min(t,(hi-s)/(p-s));if(p<lo)t=Math.min(t,(lo-s)/(p-s));}return S[2]+Math.max(0,t)*(P[2]-S[2]);}
  // What can block a camera about P that looks at L and watches w (a point `at`, how wide the thing round it is, and
  // whether it is on the robot's edge) while the robot is at t with mechanism state m: the robot as a box with its
  // intakes' reach and the turrets drawn on its top, the field's solids (G, from field()) and loose pieces within the
  // camera's reach, and the walls.
  function sceneAt(t,balls,w,P,L,G,R,bounds,m){
    const f=R.footprint,out=R.reach||{front:0,back:0,left:0,right:0},x0=-f.rear-out.back,x1=f.front+out.front,y0=-f.half-out.right,y1=f.half+out.left;
    const h=t.heading*DEG,c=Math.cos(h),s=Math.sin(h),reach=Math.hypot(P[0]-w.at[0],P[1]-w.at[1],P[2]-w.at[2])+NEAR+CLEAR,mx=(x0+x1)/2,my=(y0+y1)/2;
    const robot={c:[t.x+c*mx-s*my,t.y+s*mx+c*my,R.height/2],u:[[c,s,0],[-s,c,0],[0,0,1]],e:[(x1-x0)/2,(y1-y0)/2,R.height/2]};
    // Each drawn turret is a box turned with it, from behind its turntable to its barrel's tip.
    const parts=R.shooters.filter(sh=>sh.drawn).map(sh=>{const d=sh.drawn,a=h+(sh.type==='turret'?(m?.turrets?.[sh.n]??m?.turret??0):sh.facing)*DEG,ca=Math.cos(a),sa=Math.sin(a),mid=(d.x0+d.tip)/2;
      return {c:[t.x+c*d.pivot[0]-s*d.pivot[1]+ca*mid,t.y+s*d.pivot[0]+c*d.pivot[1]+sa*mid,(d.z0+d.z1)/2+(t.z||0)],u:[[ca,sa,0],[-sa,ca,0],[0,0,1]],e:[(d.tip-d.x0)/2,d.y,(d.z1-d.z0)/2]};});
    // A solid that holds what the camera watches (a flower the ramp reaches into) does not hide it: it is what is seen.
    const near=(G?.solids||[]).filter(o=>Math.hypot(o.c[0]-w.at[0],o.c[1]-w.at[1],o.c[2]-w.at[2])<reach+o.r),holds=new Set(near.filter(o=>gap(o,w.at)<1)),pieces=[];
    for(const ball of balls||[])if(ball.state?.kind==='ground'){const r=finite(ball.r)?ball.r:1.6,q=[ball.pos.x+72,ball.pos.y+72,Math.max(0,ball.z||0)+r];if(Math.hypot(q[0]-w.at[0],q[1]-w.at[1],q[2]-w.at[2])<reach)pieces.push([...q,r]);}
    return {w,L,robot,core:{...robot,e:robot.e.map(v=>Math.max(.5,v-1.5))},parts,near,holds,balls:pieces,heading:h,b:G?.bounds||bounds,wall:G?.wall??WALL};
  }
  // A camera at P moved by swing, raise and scale round what scene q watches.
  function placeIn(q,P,sw,up,sc){const S=q.w.at,v=[P[0]-S[0],P[1]-S[1],P[2]-S[2]],dh=Math.hypot(v[0],v[1]),ph=Math.atan2(v[2],dh),L=Math.hypot(dh,v[2])*sc;
    const th=(dh>1e-6?Math.atan2(v[1],v[0]):q.heading+Math.PI)+sw,el=up<0?Math.max(Math.min(ph,-10*DEG),ph+up):Math.min(Math.max(ph,82*DEG),ph+up);
    return [S[0]+L*Math.cos(el)*Math.cos(th),S[1]+L*Math.cos(el)*Math.sin(th),S[2]+L*Math.sin(el)];}
  // Where a camera moved from P to P2 looks: what scene q watches stays where it was in the picture (as far to the side
  // of the middle and as far above or below it), so a camera swung round the hive or raised over a wall still has the
  // robot in view instead of looking at the spot it looked at from where it was. The further it has moved (up to
  // 15 in), the nearer the middle that is, so a camera brought closer or craning over the robot keeps all of it in view.
  function aimIn(q,P,P2){
    const S=q.w.at,L=q.L,dir=(A,B)=>{const v=[B[0]-A[0],B[1]-A[1],B[2]-A[2]];return [Math.atan2(v[1],v[0]),Math.atan2(v[2],Math.hypot(v[0],v[1])),Math.hypot(...v)];};
    const k=1-.6*clamp(Math.hypot(P2[0]-P[0],P2[1]-P[1],P2[2]-P[2])/15,0,1)**2;
    const [ly,lp,ld]=dir(P,L),[sy,sp]=dir(P,S),[ny,np]=dir(P2,S),yaw=ny+wrap(ly-sy)*k,pitch=clamp(np+(lp-sp)*k,-88*DEG,88*DEG);
    return [P2[0]+ld*Math.cos(pitch)*Math.cos(yaw),P2[1]+ld*Math.cos(pitch)*Math.sin(yaw),P2[2]+ld*Math.sin(pitch)];
  }
  // What a camera at P looking at L (as aimIn aims it) costs per second in scene q for what is in its way: HARD or
  // more when it is inside something or cannot see what it watches, a little when something crowds the lens or hides
  // the sides of it.
  function blockedIn(q,P,L=q.L){
    const w=q.w,S=w.at,b=q.b,wall=q.wall;let hard=0,soft=0;
    if(b){const out=Math.max(b.x0+CLEAR-P[0],P[0]-b.x1+CLEAR,b.y0+CLEAR-P[1],P[1]-b.y1+CLEAR,0);
      if(out>0){if(P[2]<wall+CLEAR)hard+=1+out/12;else if(out>30+CLEAR||over(S,P,b)<wall+1)hard++;}}
    const view=[L[0]-P[0],L[1]-P[1],L[2]-P[2]],vl=Math.hypot(...view)||1,ahead=o=>{const Q=nearest(o,P),a=[Q[0]-P[0],Q[1]-P[1],Q[2]-P[2]];return dot(a,view)/(Math.hypot(...a)*vl||1)>Math.cos(40*DEG);};
    // The robot: never in it, not right up against its parts (its CAD is not quite its box), and, watching a
    // mechanism on its edge, not looking through it.
    const rg=gap(q.robot,P);if(P[2]<1.5)hard++;if(rg<CLEAR)hard++;else if(rg<8&&ahead(q.robot))soft+=(8-rg)/8;if(w.edge&&crosses(q.core,toward(S,P,1.5),P))hard++;
    // Its drawn turrets: not in them or crowded by them (they hide nothing: they are the robot, which is what is seen).
    for(const o of q.parts){const g=gap(o,P);if(g<CLEAR)hard++;else if(g<NEAR&&ahead(o))soft+=(NEAR-g)/NEAR;}
    const d=[P[0]-S[0],P[1]-S[1]],l=Math.hypot(...d)||1,side=[-d[1]/l*w.spread,d[0]/l*w.spread],ends=[S,[S[0]+side[0],S[1]+side[1],S[2]],[S[0]-side[0],S[1]-side[1],S[2]],[S[0],S[1],S[2]+Math.min(5,w.spread)]].map(T=>toward(T,P,3));
    // Only a solid near the line of sight can hide anything (the lines to the sides of S stay within `spread` of it).
    const sight=[S[0]-P[0],S[1]-P[1],S[2]-P[2]],ss=dot(sight,sight)||1,offSight=o=>{const c=[o.c[0]-P[0],o.c[1]-P[1],o.c[2]-P[2]],k=clamp(dot(c,sight)/ss,0,1);return Math.hypot(c[0]-sight[0]*k,c[1]-sight[1]*k,c[2]-sight[2]*k);};
    for(const o of q.near){const g=gap(o,P);if(g<CLEAR)hard+=1+(CLEAR-g)/CLEAR;else if(g<NEAR&&ahead(o))soft+=(NEAR-g)/NEAR;
      if(!q.holds.has(o)&&offSight(o)<o.r+w.spread+5)ends.forEach((T,j)=>{if(crosses(o,P,T)){if(j)soft+=.3;else hard++;}});}
    for(const ball of q.balls)if(Math.hypot(ball[0]-P[0],ball[1]-P[1],ball[2]-P[2])<ball[3]+1.2)soft+=.5;
    return hard?HARD+30*hard:6*soft;
  }
  // One camera's poses for a whole run, moved where they are blocked. A pose is blocked when the camera would be in a
  // wall (or outside one, below its top or seeing the field through it), in or right against a field structure, a
  // flower or the robot, or when one stands between it and what it watches. Blocked stretches, with a second either
  // side, are worked out as a whole: each picture takes one of MOVES, holding it rather than changing often (the
  // cheapest sequence, found by Viterbi), and the camera glides from one to the next, getting there before it would
  // be blocked and leaving only once it is clear. A moved camera is aimed again (aimIn), so what it watches stays where
  // it was in the picture. Poses with nothing in the way stay exactly as they were.
  function clear(poses,frames,ctx){
    const N=poses.length,K=MOVES.length,G=ctx.field,R=ctx.rig||rig(ctx);
    if(!N)return poses;
    const scene=poses.map((pose,i)=>{const t=frames[i]?.truth;return t&&pose.watch?sceneAt(t,frames[i].fieldState?.balls,pose.watch,pose.p,pose.l,G,R,ctx.bounds,frames[i].mechanisms):null;});
    // The camera of picture i moved by swing, raise and scale round what it watches, and what that costs.
    const place=(i,sw,up,sc)=>scene[i]?placeIn(scene[i],poses[i].p,sw,up,sc):poses[i].p,blocked=(i,P)=>blockedIn(scene[i],P,aimIn(scene[i],poses[i].p,P));
    const cost0=poses.map((p,i)=>scene[i]?blocked(i,p.p):0),span=N>1?(frames[N-1].time-frames[0].time)/(N-1)||1/30:1/30,pad=Math.ceil(1.2/span);
    // Blocked stretches (anything costing more than a second of a small move), each with `pad` pictures either side.
    const stretches=[];for(let i=0;i<N;i++)if(cost0[i]>1){const a=Math.max(0,i-pad),z=Math.min(N-1,i+pad),last=stretches.at(-1);if(last&&a<=last[1]+1)last[1]=Math.max(last[1],z);else stretches.push([a,z]);}
    if(!stretches.length)return poses;
    const sw=new Float64Array(N),up=new Float64Array(N),sc=new Float64Array(N).fill(1);
    // Glides between the moves of stretch a (len pictures, `seq` the move of each), about 2 in a picture at most (a
    // quarter of a second to 1.2 s). One to a move the old one could not keep ends before the old one is blocked; one
    // back ends no sooner than the change. Each is placed (how long, how far before or after the change, and its
    // shape: swinging and rising or dropping together, one before the other, or up over what it watches like a crane,
    // swinging while high, then down) where the pictures on the way, and those held before or after it, are least in
    // the way of anything. The crane shapes take a camera from one side of the robot to the other over it rather than
    // round through the wall in front of it. Returns the changes whose glide could not keep clear ([index, from, to]);
    // on the last pass (`last`) a glide that would still go through something is a cut instead (`cuts`).
    const smooth=x=>x*x*(3-2*x),hold=(x,a,b)=>smooth(clamp((x-a)/(b-a),0,1)),crane=x=>hold(x,0,.3)*(1-hold(x,.7,1)),ARCH=70*DEG;
    const SHAPES=[x=>[smooth(x),smooth(x),0],x=>[hold(x,0,.5),hold(x,.5,1),0],x=>[hold(x,.5,1),hold(x,0,.5),0],x=>[hold(x,.3,.7),smooth(x),crane(x)*.5],x=>[hold(x,.3,.7),smooth(x),crane(x)]];
    const cuts=new Set();
    function glide(a,len,seq,viol,last){
      const changes=[],wrong=[];for(let j=1;j<len;j++)if(seq[j]!==seq[j-1])changes.push(j);
      let free=0;
      changes.forEach((j,n)=>{const A=seq[j-1],B=seq[j],mA=MOVES[A],mB=MOVES[B],i=a+j,early=viol[j*K+A]>=HARD,after=n+1<changes.length?changes[n+1]:len;
        // The parameters partway along glide shape f: swing and raise each by its own share (and the crane's lift), scale with x.
        const mid=(s0,f,x)=>{const [ks,kr,lift]=f(x),k=smooth(x);return [s0[0]+(mB.swing-s0[0])*ks,s0[1]+(mB.raise-s0[1])*kr+ARCH*lift,s0[2]+(mB.scale-s0[2])*k];};
        // How far the camera goes along shape f (inches): the way it goes, not just from one end to the other. At about
        // 2 in a picture that is T pictures.
        const length=f=>{let d=0,p=place(i,mA.swing,mA.raise,mA.scale);for(let s=1;s<=8;s++){const q=place(i,...mid([mA.swing,mA.raise,mA.scale],f,s/8));d+=Math.hypot(q[0]-p[0],q[1]-p[1],q[2]-p[2]);p=q;}return d;};
        // Hemmed in by the glides either side (or the start of the run), it is as long as there is room for.
        const room=early?j-free:after-j;let best=null;
        SHAPES.forEach((f,fi)=>{const way=length(f),T=clamp(Math.ceil(way/2),8,36);for(const L of new Set([T,Math.max(8,Math.ceil(T*.6)),Math.min(T,8),Math.min(T,room)].filter(v=>v>=1&&v<=room)))for(let shift=0;shift<=24;shift+=4){
          const start=early?j-L-shift:j+shift;if(start<free||start+L>after)continue;
          const k0=a+Math.min(start,j)-1,s0=k0>=0?[sw[k0],up[k0],sc[k0]]:[mA.swing,mA.raise,mA.scale];let score=shift*.02+(T-L)*.01+[0,.05,.05,.15,.2][fi],hits=0;
          if(early)for(let u=start+L;u<j;u++)score+=viol[u*K+B]*span;else for(let u=j;u<start;u++)score+=viol[u*K+A]*span;
          for(let u=0;u<L;u++){const q=a+start+u;if(!scene[q])continue;const v=blocked(q,place(q,...mid(s0,f,(u+1)/(L+1))));score+=v*span;if(v>=HARD)hits++;}
          if(!best||score<best.score)best={start,L,s0,f,score,hits,fast:way/(L+1)>5};}});
        if(!best)return;const {start,L,s0,f}=best;if(best.hits||best.fast)wrong.push([j,A,B]);
        // Still through something, or too quick to be a glide (over 5 in a picture), after every other way was tried:
        // the picture cuts from one move to the next.
        if(last&&(best.hits>2||best.fast)){cuts.add(a+j);free=j;return;}
        if(early)for(let u=start+L;u<j;u++){sw[a+u]=mB.swing;up[a+u]=mB.raise;sc[a+u]=mB.scale;}else for(let u=j;u<start;u++){sw[a+u]=s0[0];up[a+u]=s0[1];sc[a+u]=s0[2];}
        for(let u=0;u<L;u++){const q=a+start+u;[sw[q],up[q],sc[q]]=mid(s0,f,(u+1)/(L+1));}
        free=start+L;});
      return wrong;
    }
    for(const [a,z] of stretches){
      const len=z-a+1,cost=new Float32Array(len*K),viol=new Float32Array(len*K);
      for(let j=0;j<len;j++){const i=a+j;for(let c=0;c<K;c++){const mv=MOVES[c],v=!scene[i]?0:c?blocked(i,place(i,mv.swing,mv.raise,mv.scale)):cost0[i];viol[j*K+c]=v;cost[j*K+c]=(mv.cost+v)*span;}}
      // A stretch inside the run starts and ends as the camera was designed.
      for(let c=1;c<K;c++){if(a>0)cost[c]+=1e6;if(z<N-1)cost[(len-1)*K+c]+=1e6;}
      // The cheapest sequence of moves (Viterbi), then the glides between them. A change whose glide still passes
      // through something is barred near there and the sequence is worked out again (three times at most), so the
      // camera finds another way round or holds its move until it can glide clear.
      const from=new Int16Array(len*K),seq=new Int16Array(len),best=new Float64Array(K),next=new Float64Array(K),barred=new Map();
      for(let pass=0;;pass++){
        best.set(cost.subarray(0,K));
        for(let j=1;j<len;j++){const no=barred.get(j);for(let c=0;c<K;c++){let low=best[c],arg=c;for(let e=0;e<K;e++){if(e===c)continue;const v=best[e]+SWITCH[e*K+c]+(no?.has(e*K+c)?5:0);if(v<low){low=v;arg=e;}}next[c]=low+cost[j*K+c];from[j*K+c]=arg;}best.set(next);}
        let c=0;for(let e=1;e<K;e++)if(best[e]<best[c])c=e;for(let j=len-1;j>=0;j--){seq[j]=c;if(j)c=from[j*K+c];}
        for(let j=0;j<len;j++){const mv=MOVES[seq[j]];sw[a+j]=mv.swing;up[a+j]=mv.raise;sc[a+j]=mv.scale;}
        const wrong=glide(a,len,seq,viol,pass===3);if(!wrong.length||pass===3)break;
        for(const [j,A,B] of wrong)for(let u=Math.max(1,j-20);u<=Math.min(len-1,j+20);u++){if(!barred.has(u))barred.set(u,new Set());barred.get(u).add(A*K+B);}
      }
      // Two cuts within 0.3 s would flash a move for a moment: the move after them (or else the one before) takes its
      // place, where it is clear there.
      const clearWith=(i0,i1,q)=>{for(let i=i0;i<i1;i++)if(scene[i]&&blocked(i,place(i,...q))>=HARD)return false;return true;},inside=[...cuts].filter(c=>c>a&&c<=z).sort((x,y)=>x-y);
      for(let n=1;n<inside.length;n++){const c1=inside[n-1],c2=inside[n];if(c2-c1>9||!cuts.has(c1))continue;const later=[sw[c2],up[c2],sc[c2]],earlier=[sw[c1-1],up[c1-1],sc[c1-1]];
        if(clearWith(c1,c2,later)){for(let i=c1;i<c2;i++)[sw[i],up[i],sc[i]]=later;cuts.delete(c2);}else if(clearWith(c1,c2,earlier)){for(let i=c1;i<c2;i++)[sw[i],up[i],sc[i]]=earlier;cuts.delete(c1);}}
      // A last light smoothing takes the corners off the glides (not across a cut, and not where it would take the
      // camera into something the glide kept clear of).
      const across=(p,q)=>{for(let c=Math.min(p,q)+1;c<=Math.max(p,q);c++)if(cuts.has(a+c))return true;return false;},raw=[sw,up,sc].map(arr=>arr.slice(a,z+1));
      raw.forEach((copy,k)=>{const arr=[sw,up,sc][k];for(let j=1;j<len-1;j++){let s=0,n=0;for(let d=-3;d<=3;d++){const q=j+d;if(q<0||q>=len||across(j,q))continue;s+=copy[q];n++;}arr[a+j]=s/n;}});
      for(let j=1;j<len-1;j++){const i=a+j;if(!scene[i]||blocked(i,place(i,sw[i],up[i],sc[i]))<HARD||blocked(i,place(i,raw[0][j],raw[1][j],raw[2][j]))>=HARD)continue;sw[i]=raw[0][j];up[i]=raw[1][j];sc[i]=raw[2][j];}
    }
    return poses.map((p,i)=>{if(!scene[i]||(!sw[i]&&!up[i]&&sc[i]===1))return p;const P=place(i,sw[i],up[i],sc[i]);return {...p,p:P,l:aimIn(scene[i],p.p,P)};});
  }
  // Camera 1 as Record films it live, picture by picture: the original follow camera kept clear of the field by the
  // same rules as clear(), but without the rest of the run to look ahead in. Each picture weighs every move where the
  // robot is now and where its speed takes it in half a second. The camera keeps its move unless another stays
  // clearly better for a moment (it changes at once when blocked now or soon), and glides to it: quickly when it is
  // blocked, slowly back towards the design once clear. It keeps all of the robot in its picture (inView). `follow`
  // carries it between pictures; dt 0 starts afresh. Without a field (ctx.field) only the walls and the robot count.
  const amount=q=>Math.abs(q[0])/(60*DEG)+Math.abs(q[1])/(35*DEG)+(1-q[2])/.3;
  function mainLive(follow,ctx,dt){
    const pose=mainStep(follow,ctx,dt),t=ctx.frame?.truth;if(!pose||!t)return pose;
    const R=ctx.rig||rig(ctx),G=ctx.field,K=MOVES.length,balls=ctx.frame.fieldState?.balls;if(!dt||!follow.keep)follow.keep={m:0,q:[0,0,1],next:-1,wait:0,v:null};const keep=follow.keep;
    const w={at:[t.x,t.y,R.height*.55],spread:R.footprint.half,edge:false},now=sceneAt(t,balls,w,pose.p,pose.l,G,R,ctx.bounds,ctx.frame.mechanisms);
    // Half a second on: the robot at its speed, and the camera and what it looks at each at their own (smoothed), as
    // the follow camera swings round the robot when it turns to the goal.
    const ahead=.5,d=[(t.vx||0)*ahead,(t.vy||0)*ahead,0],later={...t,x:t.x+d[0],y:t.y+d[1],heading:t.heading+(t.omega||0)*ahead};
    if(dt&&keep.v){const kv=1-Math.exp(-dt/.1),v=[...pose.p,...pose.l].map((x,i)=>(x-keep.v.at[i])/dt);keep.v.speed=keep.v.speed.map((s,i)=>s+(v[i]-s)*kv);}
    keep.v={at:[...pose.p,...pose.l],speed:keep.v?.speed||[(t.vx||0),(t.vy||0),0,(t.vx||0),(t.vy||0),0]};
    const Pl=pose.p.map((x,i)=>x+keep.v.speed[i]*ahead),Ll=pose.l.map((x,i)=>x+keep.v.speed[i+3]*ahead);
    const soon=sceneAt(later,balls,{...w,at:w.at.map((x,i)=>x+d[i])},Pl,Ll,G,R,ctx.bounds,ctx.frame.mechanisms),cost=new Float64Array(K);let best=0;
    // What the camera moved by swing, raise and scale (aimed again at what it watches) meets in scene q.
    const moved=(q,P0,sw,up,sc)=>{const P=placeIn(q,P0,sw,up,sc);return blockedIn(q,P,aimIn(q,P0,P));};
    for(let c=0;c<K;c++){const m=MOVES[c];cost[c]=m.cost+moved(now,pose.p,m.swing,m.raise,m.scale)+.5*moved(soon,Pl,m.swing,m.raise,m.scale);if(cost[c]<cost[best])best=c;}
    if(!dt){keep.m=best;keep.q=[MOVES[best].swing,MOVES[best].raise,MOVES[best].scale];}
    else if(cost[keep.m]>=HARD/2){keep.m=best;keep.next=-1;}
    else if(best!==keep.m&&cost[best]<cost[keep.m]-.3){if(keep.next!==best){keep.next=best;keep.wait=0;}else if((keep.wait+=dt)>=.4){keep.m=best;keep.next=-1;}}
    else keep.next=-1;
    // The glide itself carries the camera at most 120 in/s (on top of the robot's own motion), so it never jumps.
    const to=MOVES[keep.m],target=[to.swing,to.raise,to.scale],from=placeIn(now,pose.p,...keep.q),k=dt?1-Math.exp(-dt/(moved(now,pose.p,...keep.q)>=HARD?.08:moved(soon,Pl,...keep.q)>=HARD?.12:amount(target)>amount(keep.q)?.2:.5)):1;
    let q=keep.q.map((v,i)=>v+(target[i]-v)*k);
    if(dt){const P=placeIn(now,pose.p,...q),went=Math.hypot(P[0]-from[0],P[1]-from[1],P[2]-from[2]),most=120*dt;if(went>most)q=keep.q.map((v,i)=>v+(q[i]-v)*most/went);}
    keep.q=!keep.m&&amount(q)<.002?[0,0,1]:q;
    if(!amount(keep.q))return inView(pose,...robotBall(t,R));const P=placeIn(now,pose.p,...keep.q);return inView({...pose,p:P,l:aimIn(now,pose.p,P)},...robotBall(t,R));
  }
  // ---------------------------------------------------------------- whole-run paths
  // The path of one camera through a recording: seven numbers per frame (camera x, y, z, look x, y, z, fov). The
  // camera inside the turret is not moved by clear(): it sits on the robot, over its top. Camera 1 then keeps all of
  // the robot in its picture (inView).
  function path(id,frames,ctx,cfg){
    cfg=cfg||DEFAULTS[id];const s={},R=ctx.rig||rig(ctx),poses=[];let last=null;if(id==='turret')s.which=busiest(frames,R);
    frames.forEach((frame,i)=>{const dt=i?Math.max(0,frame.time-frames[i-1].time):0;let p=step(id,s,{...ctx,rig:R,frame},cfg,dt);
      if(p&&id==='main'&&frame.truth)p.watch={at:[frame.truth.x,frame.truth.y,R.height*.55],spread:R.footprint.half,edge:false};
      p=p||last||{p:[72,-40,80],l:[72,72,0],fov:50};last=p;poses.push(p);});
    const out=new Float32Array(frames.length*7),done=id==='turret'&&cfg.mode==='pov'?poses:clear(poses,frames,{...ctx,rig:R});
    done.forEach((p,i)=>{if(id==='main'&&frames[i].truth)p=inView(p,...robotBall(frames[i].truth,R));out.set([...p.p,...p.l,p.fov],i*7);});
    return out;
  }
  // Every camera's path: {main: Float32Array, ...}. `cfg` from settings().
  function paths(frames,ctx,cfg){const c=settings(cfg),out={};for(const id of IDS)out[id]=path(id,frames,ctx,c[id]);return out;}
  // The frame index at or before `time` (seconds of the recording), by halving.
  function indexAt(frames,time){let lo=0,hi=frames.length-1;if(hi<0)return -1;if(time<=frames[0].time)return 0;if(time>=frames[hi].time)return hi;
    while(hi-lo>1){const mid=(lo+hi)>>1;if(frames[mid].time<=time)lo=mid;else hi=mid;}return lo;}
  // A camera's pose at any time, between the two recorded frames around it.
  function poseAt(track,frames,time){
    const i=indexAt(frames,time);if(i<0)return null;const j=Math.min(frames.length-1,i+1),span=frames[j].time-frames[i].time,k=span>0?clamp((time-frames[i].time)/span,0,1):0;
    const a=i*7,b=j*7,v=n=>track[a+n]+(track[b+n]-track[a+n])*k;return {p:[v(0),v(1),v(2)],l:[v(3),v(4),v(5)],fov:v(6)};
  }
  return {CAMERAS,IDS,DEFAULTS,settings,rig,field,aims,mainStep,mainLive,step,clear,path,paths,indexAt,poseAt};
});
