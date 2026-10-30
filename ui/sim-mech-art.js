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
    part:()=>`${path('M32 6 53 17v18L32 44 11 35V17z','ma-body')}${path('M32 25 53 17v18L32 44z','ma-dark')}${path('M32 25v19','ma-line')}${path('M11 17l21 8','ma-line')}`};
  function svg(kind,{tint='',drive=''}={}){const draw=DRAW[kind]||DRAW.part;return `<svg class="ma${tint?' ma-'+tint:''}" viewBox="0 0 64 48" aria-hidden="true" focusable="false">${draw({drive})}</svg>`;}
  return {svg,kinds:Object.keys(DRAW),gear};
});
