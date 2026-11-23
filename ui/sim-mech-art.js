(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckMechArt=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // A drawing of each kind of mechanism for the garage: what it is at a glance, before a team has any CAD. Three tones from the
  // page's colours (ma-body, ma-dark, ma-line) and one tint that matches its marker on the model, so they work light and dark.
  const fix=v=>+v.toFixed(2);
  // A spur gear's outline.
  function gear(cx,cy,r,teeth,depth=r*.16){const pts=[];const step=Math.PI*2/teeth;for(let i=0;i<teeth;i++){const a=i*step;for(const [da,rr] of [[-.28,r-depth],[-.14,r],[.14,r],[.28,r-depth]])pts.push(`${fix(cx+Math.cos(a+da*step)*rr)} ${fix(cy+Math.sin(a+da*step)*rr)}`);}return `M${pts.join('L')}Z`;}
  const circle=(cx,cy,r,c)=>`<circle cx="${cx}" cy="${cy}" r="${r}" class="${c}"/>`;
  const rect=(x,y,w,h,rx,c,more='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="${c}"${more}/>`;
  const path=(d,c)=>`<path d="${d}" class="${c}"/>`;
  const line=d=>path(d,'ma-line');
  const arrow=d=>path(d,'ma-arrow');
  // A piece of the game, the thing the mechanism moves.
  const piece=(x,y,r=4)=>circle(x,y,r,'ma-tint');
  // A roller seen from the side, ribbed.
  const roller=(x,y,w,h)=>`${rect(x,y,w,h,h/2,'ma-dark')}${Array.from({length:Math.floor(w/5)},(_,i)=>line(`M${x+4+i*5} ${y+1.5}l-2 ${h-3}`)).join('')}`;
  // One wheel from above.
  const wheel=(x,y,w,h,kind)=>`${rect(x,y,w,h,2,'ma-dark')}${kind==='mecanum'?Array.from({length:4},(_,i)=>line(`M${x+1} ${y+2+i*(h-4)/3.2}l${w-2} 2.2`)).join(''):kind==='tread'?Array.from({length:5},(_,i)=>line(`M${x+1} ${y+1.5+i*(h-3)/4}h${w-2}`)).join(''):line(`M${x+w/2} ${y+1.5}v${h-3}`)}`;
  // A bar or link from one point to another, w thick with round ends, and goBILDA's row of holes along it.
  const bar=(x1,y1,x2,y2,w,c)=>{const l=Math.hypot(x2-x1,y2-y1),a=Math.atan2(y2-y1,x2-x1)*180/Math.PI;return `<rect x="${fix(x1-w/2)}" y="${fix(y1-w/2)}" width="${fix(l+w)}" height="${w}" rx="${w/2}" class="${c}" transform="rotate(${fix(a)} ${x1} ${y1})"/>`;};
  const holes=(x1,y1,x2,y2,n,r=.9)=>Array.from({length:n},(_,i)=>{const t=(i+.5)/n;return circle(fix(x1+(x2-x1)*t),fix(y1+(y2-y1)*t),r,'ma-hub');}).join('');
  // A pivot: a bolt through a bushing.
  const pin=(x,y,r=2.4)=>circle(x,y,r,'ma-dark')+circle(x,y,r*.4,'ma-hub');
  // A spring as a zigzag between two points.
  const spring=(x1,y1,x2,y2,n=6,a=3)=>{const dx=x2-x1,dy=y2-y1,l=Math.hypot(dx,dy),nx=-dy/l*a,ny=dx/l*a;let d=`M${x1} ${y1}`;for(let i=1;i<n*2;i++){const t=i/(n*2),s=i%2?1:-1;d+=`L${fix(x1+dx*t+nx*s)} ${fix(y1+dy*t+ny*s)}`;}return path(d+`L${x2} ${y2}`,'ma-ground');};
  // A wheel from the side. mecanum: rollers set at 45°; omni: rollers across the rim; else a tyre with tread.
  function sideWheel(cx,cy,r,kind){
    if(kind==='mecanum'||kind==='omni'){const n=r>12?9:8,len=fix(2*Math.PI*r/n*.86),h=fix(r*.3),ring=Array.from({length:n},(_,i)=>`<g transform="rotate(${fix(i*360/n)} ${cx} ${cy})">${rect(fix(cx-len/2),fix(cy-r-h/2),len,h,h/2,'ma-dark')}${kind==='mecanum'?line(`M${fix(cx-len*.3)} ${fix(cy-r+h*.3)}L${fix(cx+len*.3)} ${fix(cy-r-h*.3)}`):''}</g>`).join('');
      return `${ring}${circle(cx,cy,fix(r*.76),'ma-body')}${Array.from({length:6},(_,i)=>{const a=i*Math.PI/3;return circle(fix(cx+Math.cos(a)*r*.52),fix(cy+Math.sin(a)*r*.52),fix(r*.08),'ma-hub');}).join('')}${circle(cx,cy,fix(r*.3),'ma-dark')}${circle(cx,cy,fix(r*.12),'ma-hub')}`;}
    return `${circle(cx,cy,r,'ma-dark')}${Array.from({length:18},(_,i)=>{const a=i*Math.PI/9;return line(`M${fix(cx+Math.cos(a)*r*.86)} ${fix(cy+Math.sin(a)*r*.86)}L${fix(cx+Math.cos(a)*r*.98)} ${fix(cy+Math.sin(a)*r*.98)}`);}).join('')}${circle(cx,cy,fix(r*.66),'ma-body')}${Array.from({length:5},(_,i)=>{const a=i*Math.PI*2/5-Math.PI/2;return circle(fix(cx+Math.cos(a)*r*.42),fix(cy+Math.sin(a)*r*.42),fix(r*.12),'ma-hub');}).join('')}${circle(cx,cy,fix(r*.14),'ma-dark')}`;}
  const wheelKind=drive=>/^tank/.test(drive||'')?'tread':/mecanum/.test(drive||'mecanum')?'mecanum':/xdrive|kiwi$|hdrive|butterfly/.test(drive)?'omni':'tread';
  // A circuit board from above: its corner holes and the connectors along its edges.
  const corners=(x,y,w,h,i,r)=>[[x+i,y+i],[x+w-i,y+i],[x+i,y+h-i],[x+w-i,y+h-i]].map(([a,b])=>circle(a,b,r,'ma-hub')).join('');
  const plug=(x,y,w,h,pins,vertical)=>`${rect(x,y,w,h,.8,'ma-body')}${Array.from({length:pins},(_,i)=>vertical?circle(fix(x+w/2),fix(y+h*(i+.5)/pins),.55,'ma-dark'):circle(fix(x+w*(i+.5)/pins),fix(y+h/2),.55,'ma-dark')).join('')}`;
  // Two claw fingers opening from (x,y) to the right, closed on a piece.
  const fingers=(x,y,s=1)=>`${path(`M${x} ${y-2}h${8*s}l${8*s} ${-7*s}l${3*s} ${3*s}l${-7*s} ${8*s}H${x}z`,'ma-body')}${path(`M${x} ${y+2}h${8*s}l${8*s} ${7*s}l${3*s} ${-3*s}l${-7*s} ${-8*s}H${x}z`,'ma-body')}`;
  const chassis=drive=>{const plate=rect(16,7,32,34,3,'ma-body')+line('M32 12l-5 5M32 12l5 5');
    if(drive==='swerve'||drive==='coaxSwerve'||drive==='diffSwerve')return `${plate}${[[17,11],[47,11],[17,37],[47,37]].map(([x,y])=>`${circle(x,y,6.5,'ma-dark')}${path(`M${x} ${y-4.5}v9`,'ma-tintline')}`).join('')}`;
    if(/^kiwi/.test(drive||''))return `${path('M32 6L53 40H11Z','ma-body')}${line('M32 14l-4 5M32 14l4 5')}${rect(28,3,8,5,1.5,'ma-dark')}${path('M6 36l6 8 5-3-6-8z','ma-dark')}${path('M58 36l-6 8-5-3 6-8z','ma-dark')}`;
    const kind=drive==='tank'||drive==='tank2'?'tread':/mecanum|xdrive|butterfly/.test(drive||'mecanum')?'mecanum':'plain';return `${plate}${wheel(7,7,8,14,kind)}${wheel(49,7,8,14,kind)}${wheel(7,27,8,14,kind)}${wheel(49,27,8,14,kind)}`;};
  const DRAW={
    chassis:o=>chassis(o.drive),
    ramp:()=>`${path('M5 42h54','ma-ground')}${path('M49 14 13 38l3 4 36-24z','ma-body')}${circle(50.5,16,4,'ma-dark')}${roller(10,33,14,7)}${piece(8,37.5)}${arrow('M36 10a15 15 0 0 0-14 8')}`,
    rollers:()=>`${roller(10,10,44,10)}${roller(10,28,44,10)}${piece(32,24,4.5)}${arrow('M52 24H42')}`,
    sweeper:()=>`${path('M5 42h54','ma-ground')}${circle(24,28,11,'ma-dark')}${Array.from({length:6},(_,i)=>{const a=i*Math.PI/3;return path(`M${fix(24+Math.cos(a)*7)} ${fix(28+Math.sin(a)*7)}L${fix(24+Math.cos(a)*14)} ${fix(28+Math.sin(a)*14)}`,'ma-fin');}).join('')}${path('M36 16h20v10H42z','ma-body')}${piece(46,37.5)}`,
    siderollers:()=>`${rect(10,6,12,36,6,'ma-dark')}${rect(42,6,12,36,6,'ma-dark')}${[12,20,28,36].map(y=>line(`M12 ${y}l8 2M44 ${y}l8 2`)).join('')}${piece(32,24,5.5)}${arrow('M32 44V33')}`,
    kicker:()=>`${path('M5 42h54','ma-ground')}${circle(46,14,4.5,'ma-dark')}${path('M44 11 16 28l3 5 29-17z','ma-body')}${path('M14 26l7 10-4 3-8-11z','ma-dark')}${piece(24,37.5)}${arrow('M28 10a18 18 0 0 0-14 9')}`,
    feeder:()=>`${path('M14 36 46 12l4 5-32 24z','ma-body')}${circle(16,38,6,'ma-dark')}${circle(48,14,6,'ma-dark')}${circle(16,38,2,'ma-hub')}${circle(48,14,2,'ma-hub')}${piece(32,20,4)}${arrow('M26 36l12-9')}`,
    shooter:()=>`${path('M8 18A25 25 0 0 1 48 10l-4 4A19 19 0 0 0 13 21z','ma-body')}${circle(26,30,13,'ma-dark')}${circle(26,30,4,'ma-hub')}${[0,1,2,3,4,5].map(i=>{const a=i*Math.PI/3;return path(`M${fix(26+Math.cos(a)*5)} ${fix(30+Math.sin(a)*5)}L${fix(26+Math.cos(a)*11)} ${fix(30+Math.sin(a)*11)}`,'ma-fin');}).join('')}${piece(50,12,4.5)}${arrow('M56 6l-3 3')}`,
    turret:()=>`${path(gear(30,27,17,20),'ma-body')}${circle(30,27,9,'ma-dark')}${path(gear(52,12,7,10),'ma-tint')}${circle(52,12,2,'ma-hub')}${path('M30 27 44 41','ma-tintline')}${arrow('M8 40a26 26 0 0 1-2-16')}`,
    timing:()=>`${rect(28,3,8,5,1.5,'ma-dark')}${circle(32,27,18,'ma-body')}${circle(32,27,13,'ma-dark')}${path('M32 27V17','ma-tintline')}${path('M32 27l6 4','ma-tintline')}`,
    preload:()=>`${path('M9 24v12a6 6 0 0 0 6 6h34a6 6 0 0 0 6-6V24z','ma-body')}${piece(21,19,6.5)}${piece(36,14,6.5)}${piece(45,24,6.5)}`,
    moving:()=>`${path(gear(25,27,16,12),'ma-body')}${circle(25,27,6,'ma-dark')}${path(gear(47,14,10,9),'ma-tint')}${circle(47,14,3,'ma-hub')}`,
    // The FTC Control Hub from above: its four motor ports along one side, six servo ports along the other, USB-C, the battery's XT30 and its status light.
    hub:()=>`${rect(5,8,54,32,4,'ma-dark')}${rect(12,14,40,20,2.5,'ma-body')}${Array.from({length:4},(_,i)=>rect(13+i*10,9.8,7,2.8,.6,'ma-hub')).join('')}${Array.from({length:6},(_,i)=>rect(12.5+i*6.8,35.4,4.6,2.6,.5,'ma-hub')).join('')}${rect(5.8,19,2.6,6,1.3,'ma-hub')}${rect(55.6,18,2.6,12,1,'ma-hub')}${line('M17 20h17M17 24h17M17 28h11')}${circle(46,20,2.2,'ma-tint')}`,
    // Any other circuit board: a chip, its headers and a light.
    board:()=>`${rect(12,8,40,32,3,'ma-dark')}${corners(12,8,40,32,3.5,1.6)}${rect(25,16,14,14,1.5,'ma-body')}${Array.from({length:4},(_,i)=>line(`M${27.5+i*3} 13.5v1.6M${27.5+i*3} 31.5v1.6`)).join('')}${plug(15,33,10,3.5,4)}${circle(45,35,1.6,'ma-tint')}`,
    // goBILDA Pinpoint: a small square board with a plug for each odometry pod on one side, I2C on the other, and its IMU chip.
    pinpoint:()=>`${rect(14,6,36,36,3.5,'ma-dark')}${corners(14,6,36,36,4,2)}${plug(15,14,5,8,4,true)}${plug(15,26,5,8,4,true)}${plug(44,20,5,8,4,true)}${rect(26,18,12,12,1.5,'ma-body')}${circle(28.4,20.4,.9,'ma-dark')}${path('M23 38v-5M23 38h5','ma-tintline')}`,
    // SparkFun OTOS: a board with the optical sensor that watches the floor in its middle, and a Qwiic plug either side.
    otos:()=>`${rect(13,8,38,32,3.5,'ma-dark')}${corners(13,8,38,32,3.5,1.8)}${plug(14,19,4.5,10,4,true)}${plug(45.5,19,4.5,10,4,true)}${circle(32,24,9,'ma-body')}${circle(32,24,6,'ma-dark')}${circle(32,24,3.4,'ma-tint')}${circle(30.6,22.6,1,'ma-hub')}`,
    // One drive wheel from the side, as the drivetrain has it.
    wheel:o=>sideWheel(32,24,20,wheelKind(o.drive)),
    // A swerve module from the side: the wheel in its fork under the steering gear, which turns the whole module.
    swerve:()=>`${path('M20 12h24l-5 22H25z','ma-body')}${holes(24,16,40,16,4)}${rect(8,5,48,7,2,'ma-tint')}${Array.from({length:14},(_,i)=>line(`M${11+i*3.2} 5.6v1.8`)).join('')}${sideWheel(32,33,12,'tread')}${arrow('M5 15a27 4 0 0 0 54 0')}`,
    // An odometry pod from the side: a small omni wheel on a sprung arm, its encoder on the axle.
    pod:()=>`${path('M4 44h56','ma-ground')}${rect(4,4,26,6,1.5,'ma-dark')}${spring(26,10,38,24,5,2.4)}${bar(12,14,40,33,8,'ma-body')}${holes(12,14,34,29,4)}${pin(12,14)}${sideWheel(40,33,10,'omni')}${circle(40,33,3.2,'ma-tint')}${circle(40,33,1.2,'ma-hub')}`,
    claw:()=>`${rect(3,15,14,18,2.5,'ma-dark')}${holes(10,18,10,30,3)}${path('M15 19h10l14-12 5 5-13 13H15z','ma-body')}${path('M15 29h10l14 12 5-5-13-13H15z','ma-body')}${pin(24,20.5,2)}${pin(24,27.5,2)}${piece(40,24,6)}`,
    gripper:()=>`${rect(6,6,52,6,2,'ma-dark')}${holes(8,9,56,9,8)}${rect(15,12,6,28,1.5,'ma-body')}${rect(43,12,6,28,1.5,'ma-body')}${piece(32,30,6)}${arrow('M12 44h8M44 44h8')}`,
    lift:()=>`${rect(12,14,10,30,1.5,'ma-dark')}${holes(17,16,17,42,6)}${rect(23,8,9,32,1.5,'ma-body')}${holes(27.5,10,27.5,38,6)}${rect(33,3,8,30,1.5,'ma-dark')}${holes(37,5,37,31,5)}${rect(31,1,12,5,1.5,'ma-tint')}${circle(52,40,5,'ma-dark')}${circle(52,40,2,'ma-hub')}${path('M48 37L40 6','ma-ground')}${arrow('M54 30V8')}`,
    slide:()=>`${rect(3,32,32,9,1.5,'ma-dark')}${holes(5,36.5,33,36.5,6)}${rect(14,24,32,8,1.5,'ma-body')}${holes(16,28,44,28,6)}${rect(25,17,30,7,1.5,'ma-dark')}${holes(27,20.5,53,20.5,5)}${rect(53,12,7,14,1.5,'ma-tint')}${arrow('M8 10h30')}`,
    scissor:()=>`${rect(8,41,48,4,1.5,'ma-dark')}${[0,1,2].map(i=>{const y=40-i*11;return bar(14,y,50,y-11,3.4,'ma-body')+bar(14,y-11,50,y,3.4,'ma-body')+pin(32,y-5.5,1.8);}).join('')}${rect(9,4,46,4,1.5,'ma-tint')}`,
    dr4b:()=>`${rect(6,26,8,18,1.5,'ma-dark')}${bar(10,30,40,20,3.4,'ma-body')}${bar(10,40,40,30,3.4,'ma-body')}${rect(36,14,8,20,1.5,'ma-dark')}${bar(40,18,14,8,3.4,'ma-body')}${bar(40,28,14,18,3.4,'ma-body')}${rect(8,3,10,18,1.5,'ma-tint')}${[[10,30],[10,40],[40,20],[40,30],[40,18],[40,28],[14,8],[14,18]].map(([x,y])=>circle(x,y,1,'ma-hub')).join('')}`,
    linkage:()=>`${rect(4,36,56,5,1.5,'ma-dark')}${rect(40,29,14,7,1.5,'ma-tint')}${circle(14,26,6,'ma-dark')}${bar(14,26,30,12,3.6,'ma-body')}${bar(30,12,46,30,3.6,'ma-body')}${pin(14,26,2)}${pin(30,12,1.8)}${pin(46,30,1.8)}${arrow('M36 46h18')}`,
    arm:()=>`${path('M8 44h22l-5-18H13z','ma-dark')}${bar(19,26,52,10,7,'ma-body')}${holes(23,24,49,11.5,5)}${pin(19,26,3)}${circle(53,9.5,4,'ma-tint')}${arrow('M46 34a27 27 0 0 0 1-12')}`,
    fourbar:()=>`${path('M6 44h20l-4-24H10z','ma-dark')}${bar(16,24,46,12,3.6,'ma-body')}${bar(16,36,46,24,3.6,'ma-body')}${rect(43,8,7,20,1.5,'ma-dark')}${pin(16,24,1.8)}${pin(16,36,1.8)}${pin(46,12,1.6)}${pin(46,24,1.6)}${piece(56,18,4)}`,
    pivotslide:()=>`${path('M6 44h22l-5-16H11z','ma-dark')}${bar(17,28,42,14,8,'ma-dark')}${bar(30,21,56,7,5,'ma-body')}${holes(33,19.5,53,8.5,4)}${pin(17,28,3)}${circle(57,6,3.4,'ma-tint')}${arrow('M44 30l10-6')}`,
    elbow:()=>`${path('M4 44h20l-4-14H8z','ma-dark')}${bar(14,30,36,12,6,'ma-body')}${holes(17,27.5,33,14.5,3)}${bar(36,12,54,30,5,'ma-dark')}${pin(14,30,2.6)}${circle(36,12,3.4,'ma-tint')}${circle(36,12,1.3,'ma-hub')}${piece(56,35,3.6)}${arrow('M48 6a14 14 0 0 1 8 10')}`,
    wrist:()=>`${bar(4,30,26,22,7,'ma-body')}${holes(7,29,23,23,3)}${rect(22,14,12,12,2,'ma-dark')}${circle(28,20,3.4,'ma-tint')}${circle(28,20,1.3,'ma-hub')}${bar(28,20,44,34,4.4,'ma-dark')}${piece(48,38,3.6)}${arrow('M44 12a18 18 0 0 1 8 14')}`,
    roll:()=>`${bar(4,24,26,24,8,'ma-body')}${holes(7,24,23,24,3)}${rect(26,15,6,18,1.5,'ma-tint')}${fingers(32,24,.9)}${arrow('M29 8a6 16 0 1 1 0 32')}`,
    bucket:()=>`${path('M10 14h36l-5 24H15z','ma-body')}${path('M14 18h28l-3.6 16H17.6z','ma-dark')}${piece(23,29,4)}${piece(32,29,4)}${piece(27.5,22,4)}${pin(43,38,2.4)}${arrow('M52 32a16 16 0 0 0 0-18')}`,
    conveyor:()=>`${rect(5,18,54,14,7,'ma-dark')}${circle(12,25,5,'ma-body')}${circle(52,25,5,'ma-body')}${circle(12,25,1.6,'ma-hub')}${circle(52,25,1.6,'ma-hub')}${line('M20 19.5h24M20 30.5h24')}${piece(26,13,4.5)}${piece(38,13,4.5)}${arrow('M22 40h20')}`,
    spindexer:()=>`${circle(30,24,20,'ma-body')}${[0,1,2].map(i=>{const a=i*Math.PI*2/3-Math.PI/2,x=fix(30+Math.cos(a)*10.5),y=fix(24+Math.sin(a)*10.5);return circle(x,y,6.5,'ma-dark')+(i<2?piece(x,y,4.6):'');}).join('')}${pin(30,24,2.6)}${arrow('M55 14a26 26 0 0 1 0 20')}`,
    gate:()=>`${path('M4 44h56','ma-ground')}${rect(32,4,6,6,1.5,'ma-dark')}${bar(35,8,35,40,5,'ma-tint')}${pin(35,8,1.8)}${piece(14,38.5,5)}${piece(25,38.5,5)}${arrow('M46 38a30 30 0 0 0 4-18')}`,
    hook:()=>`${rect(16,41,28,4,1.5,'ma-dark')}${rect(26,14,8,28,1.5,'ma-body')}${holes(30,16,30,40,5)}${path('M30 15V9a7 7 0 0 1 14 0v4','ma-tintline')}${circle(37,6.5,2.8,'ma-dark')}${path('M8 6.5h50','ma-ground')}`,
    winch:()=>`${rect(6,36,30,6,1.5,'ma-dark')}${circle(21,22,13,'ma-body')}${circle(21,22,8,'ma-dark')}${Array.from({length:5},(_,i)=>line(`M${15+i*3} 16v12`)).join('')}${circle(21,22,2.4,'ma-hub')}${path('M29 22H52v14','ma-tintline')}${path('M52 36a3 3 0 1 1-4 2','ma-tintline')}${arrow('M8 6a16 16 0 0 1 20-2')}`,
    ratchet:()=>{const pts=[];for(let i=0;i<12;i++){const a=i*Math.PI/6,b=a+Math.PI/6;pts.push(`${fix(28+Math.cos(a)*11)} ${fix(26+Math.sin(a)*11)}`,`${fix(28+Math.cos(b-.05)*16)} ${fix(26+Math.sin(b-.05)*16)}`);}return `${path(`M${pts.join('L')}Z`,'ma-body')}${circle(28,26,5,'ma-dark')}${circle(28,26,2,'ma-hub')}${bar(54,7,43.5,15,4,'ma-tint')}${pin(54,7,2)}${spring(57,11,57,30,4,2)}`;},
    catapult:()=>`${rect(6,38,44,6,1.5,'ma-dark')}${spring(14,38,22,30,4,2)}${bar(24,36,50,14,4.4,'ma-body')}${path('M44 12a7 7 0 0 0 12 4','ma-tintline')}${piece(51,10,3.8)}${pin(24,36,2.6)}${arrow('M32 12a24 24 0 0 0-14 8')}`,
    launcher:()=>`${rect(4,30,48,6,1.5,'ma-dark')}${spring(6,26,24,26,5,2.6)}${rect(24,20,4,10,1.2,'ma-body')}${path('M30 26L54 18L34 30z','ma-tint')}${path('M30 26l8 0','ma-line')}${arrow('M36 12h18')}`,
    spinner:()=>`${circle(24,30,15,'ma-body')}${circle(24,30,4,'ma-dark')}${piece(14,22,3.8)}${piece(33,38,3.8)}${sideWheel(47,14,9,'tread')}${arrow('M8 10a20 20 0 0 1 10-6')}`,
    camera:()=>`${rect(14,10,30,18,3,'ma-dark')}${circle(29,19,7,'ma-body')}${circle(29,19,4.2,'ma-tint')}${circle(27.8,17.8,1,'ma-hub')}${circle(40,13.5,1.2,'ma-hub')}${path('M23 28h12v8h6v5H17v-5h6z','ma-body')}${arrow('M48 14a22 22 0 0 1 0 14')}`,
    leg:()=>`${rect(8,3,30,9,2,'ma-body')}${bar(22,11,30,27,6,'ma-dark')}${bar(30,27,22,41,5,'ma-body')}${bar(18,43,34,43,3.4,'ma-dark')}${pin(22,11,2.2)}${circle(30,27,3.2,'ma-tint')}${circle(30,27,1.2,'ma-hub')}${pin(22,41,1.8)}${path('M4 46h56','ma-ground')}`,
    piston:()=>`${rect(4,17,34,14,3,'ma-dark')}${rect(8,13,4,4,1,'ma-body')}${rect(30,13,4,4,1,'ma-body')}${rect(36,21,18,6,1.5,'ma-body')}${circle(55,24,4,'ma-tint')}${circle(55,24,1.5,'ma-hub')}${arrow('M38 38h16')}`,
    part:()=>`${path('M32 6 53 17v18L32 44 11 35V17z','ma-body')}${path('M32 25 53 17v18L32 44z','ma-dark')}${path('M32 25v19','ma-line')}${path('M11 17l21 8','ma-line')}`};
  function svg(kind,{tint='',drive=''}={}){const draw=DRAW[kind]||DRAW.part;return `<svg class="ma${tint?' ma-'+tint:''}" viewBox="0 0 64 48" aria-hidden="true" focusable="false">${draw({drive})}</svg>`;}
  // Which drawing a mechanism type (sim-mechanism-types.js) gets: what that mechanism is, not the robot it is on.
  const OF={'roller-intake':'sweeper','deploy-intake':'ramp',claw:'claw',finger:'claw','parallel-gripper':'gripper','roller-claw':'rollers',wrist:'wrist','diffy-wrist':'wrist','wrist-roll':'roll',bucket:'bucket',kicker:'kicker',transfer:'arm',conveyor:'conveyor',spindexer:'spindexer',gate:'gate',feeder:'feeder',
    lift:'lift','linear-slide':'slide','scissor-lift':'scissor','lead-screw':'slide','rack-pinion':'slide','linkage-slide':'linkage',dr4b:'dr4b',gantry:'slide',piston:'piston',
    arm:'arm','pivot-extension':'pivotslide',elbow:'elbow',scara:'elbow','four-bar':'fourbar',v4b:'fourbar',flywheel:'shooter',hood:'shooter',turret:'turret','mini-turret':'turret','base-yaw':'turret',catapult:'catapult','drone-launcher':'launcher',spinner:'spinner',
    'hang-hook':'hook',winch:'winch',ratchet:'ratchet','drive-wheel':'wheel','swerve-steer':'swerve',steering:'swerve','odometry-pod':'pod','odo-retract':'pod','camera-mount':'camera',neck:'camera',hip:'leg',knee:'leg',ankle:'leg'};
  const JOINT={prismatic:'slide',revolute:'arm',continuous:'rollers'};
  const kindOf=(type,joint)=>OF[type]||JOINT[joint]||'part';
  return {svg,kinds:Object.keys(DRAW),gear,kindOf,wheelKind};
});
