'use strict';
// The moving ground of the DEV and FIRST themes (ui/themes.js, THEMES, motion: 'ascii'): a scene drawn as text, the way
// an ASCII shader works. Each cell of a character grid gets a brightness from the scene and shows the character of that
// density, so the picture is made only of letters. Every scene has a slow interference field, a ring spreading from the
// middle and a scan line that scrambles what it passes, in the chosen colour's accent; in the middle turn its shapes,
// each like a coin. DEV's is Torque's τ (MARK in ui/sim-video.js), in the accent. FIRST's are FIRST's three: the
// triangle, the ring and the square on its corner, each in its own ink (the theme's `inks`, red, white and blue; the
// white is the logo's grey on a light ground), turning together as one body, each with the logo's grey depth behind it.
// NYC FIRST's are the same with the Statue of Liberty's crown in the ring's place.
// It sits behind every screen (fixed, under the page), faint enough that words over it stay easy to read. Reduced motion shows one still frame of the
// field, the ring and the τ, without the scan line; a hidden window, or one paused (DeckAscii.pause: minimised, or covered
// by the Driver Station), draws nothing.
(function(root){
  const RAMP=' .:-=+*#%@',GLITCH='01<>/\\{}[]#$%&*+=?',MARK='M12 14H50V22H34V36A7 7 0 0 0 45.95 40.95L51.607 46.607A15 15 0 0 1 26 36V22H12Z';
  const FPS=20,CELL_W=9,CELL_H=16,FONT_PX=13;
  // A scene: its shapes in their own units, the box they fill together, and how big that box may be (of the window's
  // height and width). Each shape is the path `d` (filled, or stroked at `stroke` units wide; `shade`: in the depth's
  // grey rather than an ink), turns about its own
  // middle `at` across, `phase` behind the first, in ink `ink` (an index into the theme's inks; none: the accent). `depth`
  // draws a grey copy that far behind it (across, down), the way FIRST's logo is extruded. A scene with `whole` turns as one
  // body instead: every shape about the middle of the box, all at once, so the logo keeps its shape as it turns.
  // FIRST's logo, measured from the logo's own picture (516 across, 309 down). The triangle and the square are thick
  // outlines along these centre lines (their outer corners: the triangle's at 77,0 25,294 254,192, the square's at 370,0
  // 515,139 375,284 231,145), each with the logo's grey depth below it, the triangle's to the left and the square's to the
  // right; the triangle's tip and the square's left corner both reach into the ring.
  const TRIANGLE={ink:0,stroke:32,at:120,phase:0,depth:[-10,8],d:'M84.5 29L41.9 270L229.6 186.6Z'},
    SQUARE={ink:2,stroke:36,at:372,phase:0,depth:[10,8],d:'M370.4 22.7L491.9 139.5L374.7 261.3L253.7 144.6Z'};
  // The ring is a flat washer seen from above at an angle, as in the logo: its white top face is the band between two
  // ellipses (outer 144.5 by 106.5 about 248,150.5; inner 105.5 by 75 about 248,147, so its near side is a little thicker
  // than its far side), and below it stands its grey wall, 27 deep, seen along its front and, through the hole, on the
  // inside at the back. It links through the triangle and the square like a chain: its far half (the top half of its face
  // and the inner wall) is behind them, its near half (the bottom of its face and the front wall) in front. The walls are
  // the logo's grey (`shade`); the face is the ring's ink.
  const R={cx:248,oy0:150.5,ox:144.5,oy:106.5,iy0:147,ix:105.5,iy:75,h:27},arc=(rx,ry,sweep,x,y)=>`A${rx} ${ry} 0 0 ${sweep} ${x} ${y}`;
  const RING_PARTS={
    innerWall:{shade:true,d:`M${R.cx-R.ix} ${R.iy0}${arc(R.ix,R.iy,1,R.cx+R.ix,R.iy0)}L${R.cx+R.ix} ${R.iy0+R.h}${arc(R.ix,R.iy,0,R.cx-R.ix,R.iy0+R.h)}Z`},
    farFace:{ink:1,d:`M${R.cx-R.ox} ${R.oy0}${arc(R.ox,R.oy,1,R.cx+R.ox,R.oy0)}L${R.cx+R.ix} ${R.iy0}${arc(R.ix,R.iy,0,R.cx-R.ix,R.iy0)}Z`},
    frontWall:{shade:true,d:`M${R.cx+R.ox} ${R.oy0}${arc(R.ox,R.oy,1,R.cx-R.ox,R.oy0)}L${R.cx-R.ox} ${R.oy0+R.h}${arc(R.ox,R.oy,0,R.cx+R.ox,R.oy0+R.h)}Z`},
    nearFace:{ink:1,d:`M${R.cx+R.ox} ${R.oy0}${arc(R.ox,R.oy,1,R.cx-R.ox,R.oy0)}L${R.cx-R.ix} ${R.iy0}${arc(R.ix,R.iy,0,R.cx+R.ix,R.iy0)}Z`}};
  const ring=k=>({at:R.cx,phase:0,...RING_PARTS[k]});
  // NYC FIRST's ring is Liberty's crown: the same ring, with seven rays rising from its far rim, fanned 22° apart about a
  // point inside the ring a little below its middle, each 24 wide where it leaves the rim and narrowing to a point 90
  // beyond it. They stand
  // behind the triangle and the square, like the ring's far half, and show in the V between them.
  const RAYS=(()=>{const fx=R.cx,fy=R.oy0+30,rad=d=>d*Math.PI/180,pt=(x,y)=>`${x.toFixed(1)} ${y.toFixed(1)}`;let d='';
    for(let i=0;i<7;i++){const a=rad(90+(i-3)*22),ux=Math.cos(a),uy=-Math.sin(a);
      // Where the ray leaves the rim: along its direction from the fan's point to the outer ellipse.
      let t=0;for(let k=0;k<60;k++){const x=fx+ux*t,y=fy+uy*t;if(((x-R.cx)/R.ox)**2+((y-R.oy0)/R.oy)**2>=1)break;t+=4;}
      const bx=fx+ux*(t-6),by=fy+uy*(t-6),px=-uy*12,py=ux*12;d+=`M${pt(bx-px,by-py)}L${pt(fx+ux*(t+90),fy+uy*(t+90))}L${pt(bx+px,by+py)}Z`;}
    return {ink:1,at:R.cx,phase:0,d};})();
  const LOGO={left:-12,right:526,top:-2,bottom:304},CROWNED={left:-12,right:526,top:-52,bottom:304};
  const SCENES={
    // The τ's own box in MARK's units: 12 to 51.6 across, 14 to 51 down (the bottom of its hook's curve).
    tau:{box:{left:12,right:51.607,top:14,bottom:51},fit:[.78,.5],shapes:[{d:MARK,at:31.8,phase:0}]},
    // FIRST's three, linked: the ring's far half, then the triangle and the square over it, then the ring's near half over
    // them (a later shape is in front).
    first:{whole:true,box:LOGO,fit:[.66,.8],shapes:[ring('innerWall'),ring('farFace'),TRIANGLE,SQUARE,ring('frontWall'),ring('nearFace')]},
    // NYC FIRST: the same logo, its ring crowned with Liberty's rays (behind the triangle and the square, as the ring's far half is).
    nyc:{whole:true,box:CROWNED,fit:[.66,.8],shapes:[ring('innerWall'),RAYS,ring('farFace'),TRIANGLE,SQUARE,ring('frontWall'),ring('nearFace')]}};
  const runs=new WeakMap(),held=new WeakSet();
  function start(doc,opts){
    const W=doc.defaultView,canvas=doc.createElement('canvas');canvas.className='theme-ascii';canvas.setAttribute('aria-hidden','true');
    // Its own spacing: a canvas draws text with the page's letter and word spacing, which a font in Settings → Text changes
    // (OpenDyslexic's tighter gaps), so it is set to none here and the grid's own spacing is added below.
    Object.assign(canvas.style,{position:'fixed',inset:'0',width:'100vw',height:'100vh',zIndex:'-1',pointerEvents:'none',letterSpacing:'0px',wordSpacing:'0px',fontKerning:'none'});
    doc.body.prepend(canvas);
    const ctx=canvas.getContext('2d'),still=W.matchMedia('(prefers-reduced-motion: reduce)'),scheme=W.matchMedia('(prefers-color-scheme: light)');
    let cols=0,rows=0,ox=0,oy=0,parts=[],colour='',ground='',inks=[],light=false,alpha=.2,frame=0,raf=0,last=0,paused=held.has(doc),scene=SCENES[opts?.scene]||SCENES.tau,given=opts?.inks||null;
    const FACE=`${FONT_PX}px ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, 'DejaVu Sans Mono', monospace`;
    // Every character one cell wide, whatever monospace face this computer has: its own width is measured and the rest of
    // the cell added as letter spacing, so a row of text spans the window exactly and the picture stays in the middle.
    function type(){ctx.font=FACE;ctx.letterSpacing='0px';ctx.wordSpacing='0px';ctx.fontKerning='none';ctx.textBaseline='top';const own=ctx.measureText('M'.repeat(20)).width/20;ctx.letterSpacing=`${(CELL_W-own).toFixed(3)}px`;}
    // Each shape, filled into a grid as big as the screen's character grid: 1 inside, 0 outside, with its edge cells marked 2
    // so the outline reads brighter than the fill; and its depth, the same shape moved back, in a grid of its own. Centred on
    // the middle of the scene's box; cells are about twice as tall as wide, so it is stretched across to look square.
    function shape(){
      const b=scene.box,k=Math.min(rows*scene.fit[0]/(b.bottom-b.top),cols*scene.fit[1]*CELL_W/CELL_H/(b.right-b.left)),sx=k*CELL_H/CELL_W,mx=(b.left+b.right)/2,my=(b.top+b.bottom)/2;
      const grid=(draw)=>{const c=doc.createElement('canvas');c.width=cols;c.height=rows;const g=c.getContext('2d');g.translate(cols/2,rows/2);g.scale(sx,k);g.translate(-mx,-my);draw(g);
        const px=g.getImageData(0,0,cols,rows).data,m=new Uint8Array(cols*rows);for(let i=0;i<m.length;i++)m[i]=px[i*4+3]>110?1:0;
        for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const i=y*cols+x;if(m[i]&&(x===0||y===0||x===cols-1||y===rows-1||!m[i-1]||!m[i+1]||!m[i-cols]||!m[i+cols]))m[i]=2;}return m;};
      const ink=(g,p,w)=>{if(w){g.lineWidth=w;g.lineJoin='miter';g.stroke(p);}else g.fill(p);};
      return scene.shapes.map(sh=>({...sh,cx:scene.whole?cols/2:cols/2+(sh.at-mx)*sx,phase:scene.whole?0:sh.phase,mask:grid(g=>ink(g,new Path2D(sh.d),sh.stroke)),
        depthMask:sh.depth?grid(g=>{g.translate(sh.depth[0],sh.depth[1]);ink(g,new Path2D(sh.d),sh.stroke);}):null}));}
    function resize(){const dpr=W.devicePixelRatio||1,w=W.innerWidth,h=W.innerHeight;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
      // The grid covers the whole window and is centred on it: an odd part-cell is split between both edges.
      cols=Math.ceil(w/CELL_W)+1;rows=Math.ceil(h/CELL_H)+1;ox=(w-cols*CELL_W)/2;oy=(h-rows*CELL_H)/2;type();parts=shape();paint();}
    // The colour's accent and how strong to draw it: a little stronger on a light ground, where thin strokes fade. A grey
    // stands in until the page has an accent.
    // A scene's own inks follow the mode too (the theme gives a set for dark and one for light), and its depth is the page's quiet grey.
    function look(){const s=W.getComputedStyle(doc.documentElement);colour=s.getPropertyValue('--accent').trim()||'#8d9490';ground=s.getPropertyValue('--quiet').trim()||'#8d9490';const bg=s.getPropertyValue('--bg').trim();
      light=/^#/.test(bg)&&parseInt(bg.slice(1,3),16)>128;alpha=light?.19:.17;inks=(given&&given[light?'light':'dark'])||[];}
    const hash=(x,y,t)=>{const n=Math.sin(x*127.1+y*311.7+t*74.7)*43758.5453;return n-Math.floor(n);};
    function paint(){
      if(!cols||paused)return;if(frame%30===0)look();
      const t=frame/FPS,w=W.innerWidth,h=W.innerHeight;ctx.clearRect(0,0,w,h);
      // Each shape's turn: its width is the cosine of its angle; the face towards you is brighter than the back. A scene that
      // turns whole has every shape on one axis and one angle, so the logo turns as one body.
      const turns=parts.map(p=>{const q=Math.cos(t*.45-p.phase);return {face:q>=0?1:.6,span:Math.max(.06,Math.abs(q))};});
      // The scan line only moves: the still frame (reduced motion) leaves it and its scrambled characters out, so nothing bright
      // stands across the words of a screen.
      const scan=still.matches?null:(t*.16%1.25-.1)*rows,hot=[];
      // One row of text per ink: the field and the accent's shapes, the depth, then each of the scene's inks. A cell is in one.
      const layers=[[],[],...inks.map(()=>[])],LAYER_FIELD=0,LAYER_DEPTH=1;
      for(let y=0;y<rows;y++){const row=layers.map(()=>Array(cols).fill(' '));
        for(let x=0;x<cols;x++){
          // The field: three slow waves crossing, kept low so it reads as texture.
          const u=x/cols,v=y/rows,f=Math.sin(u*9+t*.35)+Math.sin(v*7-t*.27+u*3)+Math.sin((u+v)*11+t*.5);let b=.13+.1*f/3,layer=LAYER_FIELD;
          // A ring spreading out from the middle every few seconds.
          const r=Math.hypot((u-.5)*cols*CELL_W/(rows*CELL_H),v-.5),ring=Math.exp(-((r-(t*.12%1.1))**2)/.0012);b+=ring*.32;
          // The shapes, each sampled back through its own turn; a later one in the scene is in front. Behind them, their depth.
          let front=-1,fb=0,deep=0;
          parts.forEach((p,i)=>{const {face,span}=turns[i],sx=Math.round(p.cx+(x-p.cx)/span);if(sx<0||sx>=cols)return;const m=p.mask[y*cols+sx];
            if(m){front=i;fb=(m===2?.9:.5)*face*(.75+.25*span)+.08*Math.sin(y*.6-t*3);}else if(p.depthMask?.[y*cols+sx])deep=Math.max(deep,.42*(.7+.3*span));});
          if(front>=0){const p=parts[front];if(p.shade){b=Math.max(b,fb*.85);layer=LAYER_DEPTH;}else{b=Math.max(b,fb);if(p.ink!==undefined&&inks[p.ink])layer=2+p.ink;}}
          else if(deep>b){b=deep;layer=LAYER_DEPTH;}
          const near=scan===null?Infinity:Math.abs(y-scan);
          if(near<1.5&&hash(x,y,Math.floor(t*FPS))>.62){hot.push([x,y,GLITCH[Math.floor(hash(y,x,t)*GLITCH.length)]]);continue;}
          if(near<6)b+=.12*(1-near/6);
          row[layer][x]=RAMP[Math.max(0,Math.min(RAMP.length-1,Math.floor(b*RAMP.length)))];}
        row.forEach((r,i)=>layers[i].push(r.join('')));}
      // The field and the depth faint; a scene's own inks a little stronger, since they are its picture.
      const draw=(lines,fill,a)=>{ctx.fillStyle=fill;ctx.globalAlpha=a;for(let y=0;y<rows;y++)if(lines[y].trim())ctx.fillText(lines[y],ox,oy+y*CELL_H);};
      draw(layers[LAYER_FIELD],colour,alpha);draw(layers[LAYER_DEPTH],ground,alpha*1.3);inks.forEach((c,i)=>draw(layers[2+i],c,light?.35:.42));
      ctx.fillStyle=colour;ctx.globalAlpha=Math.min(1,alpha*1.6);for(const [x,y,c] of hot)ctx.fillText(c,ox+x*CELL_W,oy+y*CELL_H);
      ctx.globalAlpha=1;}
    // Reduced motion turned on with its change missed (none is sent in some cases): the next frame notices and holds still.
    function tick(now){if(still.matches)return motion();raf=W.requestAnimationFrame(tick);if(doc.hidden||now-last<1000/FPS-2)return;last=now;frame++;paint();}
    function motion(){W.cancelAnimationFrame(raf);raf=0;if(paused)return;if(still.matches){frame=Math.round(FPS*2.2);paint();}else raf=W.requestAnimationFrame(tick);}
    // Light and Dark matching the device: the page's colours change with no attribute to watch, so the device's change
    // repaints (the still frame under reduced motion would otherwise keep the old colours).
    const onResize=()=>resize(),onTheme=new W.MutationObserver(()=>{look();type();paint();}),onScheme=()=>{look();paint();};
    W.addEventListener('resize',onResize);still.addEventListener('change',motion);scheme.addEventListener('change',onScheme);onTheme.observe(doc.documentElement,{attributes:true,attributeFilter:['data-theme','data-font','style']});
    // A font that arrives late (the monospace face loading) changes the width to pad to.
    doc.fonts?.addEventListener?.('loadingdone',onResize);
    look();resize();motion();
    const stop=()=>{W.cancelAnimationFrame(raf);W.removeEventListener('resize',onResize);doc.fonts?.removeEventListener?.('loadingdone',onResize);still.removeEventListener('change',motion);scheme.removeEventListener('change',onScheme);onTheme.disconnect();canvas.remove();};
    // A new colour comes as a changed stylesheet, which no attribute change shows, so set() tells a running ground.
    stop.refresh=()=>{look();paint();};
    // Paused, it draws nothing and asks for no frames; going on again it moves again, or paints its still frame.
    stop.hold=on=>{if(on===paused)return;paused=on;if(!on)look();motion();};
    stop.scene=opts?.scene||'tau';
    return stop;
  }
  // On (a moving theme is on this page) or off; opts: {scene: 'tau' (DEV), 'first' (FIRST) or 'nyc' (NYC FIRST), inks: {dark, light}}.
  // Safe to call again: on a page already moving the same scene it takes the page's colours again; another scene starts afresh.
  function set(doc,on,opts){if(!doc?.body)return;let stop=runs.get(doc);const scene=opts?.scene||'tau';
    if(stop&&on&&(stop.scene!==scene||JSON.stringify(stop.inks)!==JSON.stringify(opts?.inks||null))){stop();runs.delete(doc);stop=null;}
    if(on&&!stop){const s=start(doc,opts);s.inks=opts?.inks||null;runs.set(doc,s);}else if(on)stop.refresh();else if(stop){stop();runs.delete(doc);}}
  // Paused or not, for a window that is minimised, hidden or covered by the Driver Station: kept for the page, so it
  // holds before set() starts a ground and after one stops. Safe to call again with the same value.
  function pause(doc,paused){if(!doc)return;if(paused)held.add(doc);else held.delete(doc);runs.get(doc)?.hold(!!paused);}
  // A scene as a small vector picture, for its card in Settings: the same shapes from the same measurements, depth first,
  // then each shape in the scene's order (a later one in front). Classes say which ink draws it; the stylesheet colours them.
  function logo(name){const sc=SCENES[name];if(!sc)return '';const b=sc.box,box=`${b.left} ${b.top} ${b.right-b.left} ${b.bottom-b.top}`;
    const el=(sh,cls,extra='')=>`<path class="${cls} ${sh.stroke?'stroke':'fill'}" d="${sh.d}"${sh.stroke?` stroke-width="${sh.stroke}"`:''}${extra}/>`;
    return `<svg viewBox="${box}" aria-hidden="true">${sc.shapes.filter(sh=>sh.depth).map(sh=>el(sh,'shade',` transform="translate(${sh.depth[0]} ${sh.depth[1]})"`)).join('')}${sc.shapes.map(sh=>el(sh,sh.shade?'shade':`ink${sh.ink??'a'}`)).join('')}</svg>`;}
  root.DeckAscii={set,pause,logo};
})(typeof globalThis==='object'?globalThis:this);
