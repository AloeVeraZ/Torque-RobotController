'use strict';
// A robot configuration as a wiring diagram: each hub drawn with its ports where they are on the real board (FTC docs,
// Control Hub REV-31-1595 and Expansion Hub REV-31-1153: battery and motor/encoder ports down the left edge, servo and
// +5V ports along the bottom, UART, RS485, I2C, digital and analog ports up the right edge), every configured device as
// a card with its picture beside the port it plugs into, and a pinout table. Wires on one side of a hub all run between
// the same two lines in the same order, so they never cross; a Control Hub and its Expansion Hub are joined through
// gutters outside every card. Returns an SVG string sized to fit, and its table rows and warnings.
(function(root,factory){const value=factory(root);if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckPinout=value;})(typeof globalThis==='object'?globalThis:this,root=>{
  const A=root.DeckDeviceArt||(typeof require==='function'?require('./device-art.js'):null);
  const esc=A.esc,FONT='Segoe UI,Inter,Helvetica,Arial,sans-serif';
  const COLOR={motor:'#dc2626',encoder:'#2563eb',servo:'#ea8a00',digital:'#16a34a',analog:'#9333ea',i2c:'#0d9488',usb:'#475467',power:'#dc2626',rs485:'#ca8a04',link:'#ca8a04'};
  const TITLE={motor:'MOTOR',servo:'SERVO',digital:'DIGITAL',analog:'ANALOG',i2c:'I2C',usb:'USB',power:'POWER',rs485:'RS485'};
  const fixed=n=>Math.round(n*10)/10;
  // Product photos for this sheet ({tag: data URL}); a tag with none is drawn.
  let PHOTOS=null;const picBg=tag=>PHOTOS?.[tag]?'#ffffff':'#f2f4f7',picLine=tag=>PHOTOS?.[tag]?' stroke="#eaecf0"':'';
  const t=(x,y,s,{size=12,weight=400,fill='#101828',anchor='start',family=FONT,more=''}={})=>`<text x="${fixed(x)}" y="${fixed(y)}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${more}>${esc(s)}</text>`;
  const r=(x,y,w,h,fill,rx=0,more='')=>`<rect x="${fixed(x)}" y="${fixed(y)}" width="${fixed(w)}" height="${fixed(h)}" rx="${rx}" fill="${fill}"${more}/>`;
  // Text cut to fit a width (an average glyph is about 0.56 em).
  const fit=(s,px,size)=>{s=String(s??'');const n=Math.floor(px/(size*.56));return s.length>n?s.slice(0,Math.max(1,n-1))+'…':s;};

  // ---- the hub drawing -------------------------------------------------------------------------------------------------
  const HUB={lynx:{w:520,h:380},servo:{w:340,h:210}};
  // Port positions on a Lynx hub (Control Hub or Expansion Hub), relative to its top left corner.
  const LYNX={battery:[44,78],motor:i=>124+i*62,encoder:i=>124+i*62+32,servo:i=>100+i*46,aux:[384,418],uart:28,rs485:58,
    i2c:b=>96+(3-b)*28,digital:c=>212+(3-Math.floor(c/2))*28,analog:c=>332+(1-Math.floor(c/2))*28,usb:[150,198,246,300]};
  function lynxHub(h,used){
    const {w:W,h:H}=HUB.lynx,on=(k)=>used.has(k),c=[];
    c.push(r(0,0,W,H,'#1c1f23',22),r(6,6,W-12,H-12,'none',18,' stroke="#2f343b" stroke-width="2"'));
    for(const [x,y] of [[22,22],[W-22,22],[22,H-22],[W-22,H-22]])c.push(`<circle cx="${x}" cy="${y}" r="9" fill="#0f1114"/><circle cx="${x}" cy="${y}" r="5" fill="#3b4048"/>`);
    // The big diagonal band and the hub's name, as on its label.
    c.push(`<polygon points="${W*.40},${H*.84} ${W*.53},${H*.84} ${W*.76},${H*.10} ${W*.63},${H*.10}" fill="#f2683a"/>`,r(W*.22,H*.36,W*.54,H*.27,'#f4f4f4',4),
      t(W*.49,H*.36+34,h.parent?'CONTROL HUB':'EXPANSION HUB',{size:25,weight:800,fill:'#1c1f23',anchor:'middle',more:' font-style="italic"'}),
      t(W*.49,H*.36+58,`${h.name} · address ${h.address}`,{size:12.5,weight:600,fill:'#344054',anchor:'middle'}),
      t(W*.49,H*.36+76,h.portal==='(embedded)'?'Control Hub Portal':`USB portal ${h.portal}`,{size:10.5,fill:'#667085',anchor:'middle'}));
    const group=(x,y,w,h,label,vertical=false)=>{c.push(r(x,y,w,h,'#f2683a',4));if(label)c.push(vertical?t(0,0,label,{size:9,weight:700,fill:'#fff',anchor:'middle',more:` transform="translate(${x+w/2+3} ${y+h/2}) rotate(-90)"`}):t(x+w/2,y+h-4,label,{size:9,weight:700,fill:'#fff',anchor:'middle'}));};
    const port=(x,y,w,h,used,color,label,labelAt)=>{c.push(r(x,y,w,h,used?'#f6f3ea':'#8b8f96',2.5,used?` stroke="${color}" stroke-width="3"`:''));if(label!==undefined)c.push(t(labelAt[0],labelAt[1],label,{size:10,weight:700,fill:used?'#fff':'#9aa0a8',anchor:'middle'}));};
    // Left edge: two XT30 battery ports, then motor (JST-VH) and encoder (JST-PH) ports 0-3.
    group(0,26,40,74,'');c.push(t(0,0,'BATTERY',{size:8.5,weight:700,fill:'#fff',anchor:'middle',more:` transform="translate(48 63) rotate(-90)"`}));
    LYNX.battery.forEach((y,i)=>{c.push(r(6,y-12,28,24,'#f2c200',4,on(`power:${i}`)?` stroke="${COLOR.power}" stroke-width="3"`:''),r(12,y-6,7,12,'#7a6200',2),r(22,y-6,7,12,'#7a6200',2));});
    for(let i=0;i<4;i++){const y=LYNX.motor(i);if(i%2)group(0,y-6,58,50,'');port(4,y,34,26,on(`motor:${i}`),COLOR.motor,String(i),[48,y+17]);port(36,y+26,24,13,on(`encoder:${i}`),COLOR.encoder);}
    c.push(t(6,LYNX.motor(0)-10,'MOTOR',{size:8.5,weight:700,fill:'#c9ced6'}),t(40,LYNX.motor(0)-10,'ENC',{size:8.5,weight:700,fill:'#c9ced6'}));
    // Bottom edge: servo ports 0-5 and the two +5V ports.
    group(LYNX.servo(0)-22,H-46,6*46+6,46,'');for(let i=0;i<6;i++){const x=LYNX.servo(i);port(x-18,H-16,36,12,on(`servo:${i}`),COLOR.servo,String(i),[x,H-24]);}
    c.push(t(LYNX.servo(0)-14,H-34,'SERVO',{size:9,weight:700,fill:'#fff'}));
    for(const x of LYNX.aux)port(x-15,H-16,30,12,false,'',undefined);c.push(t((LYNX.aux[0]+LYNX.aux[1])/2,H-24,'+5V',{size:9,weight:700,fill:'#c9ced6',anchor:'middle'}));
    // Right edge, top to bottom: UART, RS485, I2C buses 3-0, digital 6-7 down to 0-1, analog 2-3 and 0-1.
    port(W-30,LYNX.uart-8,26,16,false,'');c.push(t(W-40,LYNX.uart+4,'UART',{size:8.5,weight:700,fill:'#c9ced6',anchor:'end'}));
    group(W-36,LYNX.rs485-14,36,28,'');port(W-30,LYNX.rs485-9,26,18,on('rs485'),COLOR.rs485);c.push(t(W-42,LYNX.rs485+4,'RS485',{size:8.5,weight:700,fill:'#c9ced6',anchor:'end'}));
    for(let b=0;b<4;b++){const y=LYNX.i2c(b);port(W-30,y-10,26,20,on(`i2c:${b}`),COLOR.i2c,String(b),[W-42,y+4]);}c.push(t(0,0,'I2C',{size:9,weight:700,fill:'#c9ced6',anchor:'middle',more:` transform="translate(${W-60} ${LYNX.i2c(1)+14}) rotate(-90)"`}));
    group(W-36,LYNX.digital(7)-14,36,4*28,'');for(let p=0;p<8;p+=2){const y=LYNX.digital(p);port(W-30,y-10,26,20,on(`digital:${p}`)||on(`digital:${p+1}`),COLOR.digital,`${p}-${p+1}`,[W-48,y+4]);}
    c.push(t(0,0,'DIGITAL',{size:9,weight:700,fill:'#c9ced6',anchor:'middle',more:` transform="translate(${W-70} ${LYNX.digital(4)+14}) rotate(-90)"`}));
    for(let p=0;p<4;p+=2){const y=LYNX.analog(p);port(W-30,y-10,26,20,on(`analog:${p}`)||on(`analog:${p+1}`),COLOR.analog,`${p}-${p+1}`,[W-48,y+4]);}
    c.push(t(0,0,'ANALOG',{size:9,weight:700,fill:'#c9ced6',anchor:'middle',more:` transform="translate(${W-70} ${LYNX.analog(0)})  rotate(-90)"`}));
    // A Control Hub's USB and HDMI ports are on its front edge, drawn along the top.
    if(h.parent&&h.portal==='(embedded)')['USB-C','USB 2.0','USB 3.0','HDMI'].forEach((l,i)=>{const x=LYNX.usb[i];c.push(r(x-20,-6,40,14,on(`usb:${i}`)?'#f6f3ea':'#8b8f96',2,on(`usb:${i}`)?` stroke="${COLOR.usb}" stroke-width="3"`:''),t(x,24,l,{size:9,weight:700,fill:'#c9ced6',anchor:'middle'}));});
    return c.join('');
  }
  // REV Servo Hub (REV-11-1855): six servo ports, power and RS485.
  function servoHub(h,used){
    const {w:W,h:H}=HUB.servo,c=[r(0,0,W,H,'#1c1f23',18),r(6,6,W-12,H-12,'none',14,' stroke="#2f343b" stroke-width="2"'),
      t(W/2,H/2-6,'SERVO HUB',{size:22,weight:800,fill:'#f4f4f4',anchor:'middle',more:' font-style="italic"'}),t(W/2,H/2+14,`${h.name} · address ${h.address}`,{size:11.5,fill:'#c9ced6',anchor:'middle'})];
    c.push(r(6,32,28,24,'#f2c200',4));
    for(let i=0;i<6;i++){const x=SERVOHUB(i),u=used.has(`servo:${i}`);c.push(r(x-18,H-16,36,12,u?'#f6f3ea':'#8b8f96',2.5,u?` stroke="${COLOR.servo}" stroke-width="3"`:''),t(x,H-24,String(i),{size:10,weight:700,fill:u?'#fff':'#9aa0a8',anchor:'middle'}));}
    c.push(r(W-30,LYNX.rs485-9,26,18,used.has('rs485')?'#f6f3ea':'#8b8f96',2.5,used.has('rs485')?` stroke="${COLOR.rs485}" stroke-width="3"`:''),t(W-38,LYNX.rs485+4,'RS485',{size:8.5,weight:700,fill:'#c9ced6',anchor:'end'}));
    return c.join('');
  }
  const SERVOHUB=i=>50+i*48;

  // ---- device cards ----------------------------------------------------------------------------------------------------
  const CARD={w:276,h:88},COMPACT=64,SERVO_CARD={w:142,h:156},LINK={w:276,h:52},CHAIN=44,LANE=118;
  // A card: the device's picture, a port badge, its configured name and what it is.
  function card({x,y,w=CARD.w,h=CARD.h,tag,badge,color,name,type,detail,detail2,warn,dashed}){
    const c=[r(x,y,w,h,'#ffffff',12,` stroke="${warn?'#d92d20':'#d0d5dd'}" stroke-width="${warn?2:1.2}"${dashed?' stroke-dasharray="6 4"':''}`)];
    if(h>w){// a servo card: the picture on top
      c.push(r(x+8,y+8,w-16,76,picBg(tag),8,picLine(tag)),A.place(tag,x+12,y+10,w-24,72,PHOTOS),pill(x+8,y+92,badge,color),t(x+10,y+122,fit(name,w-20,13.5),{size:13.5,weight:700}),t(x+10,y+138,fit(type,w-20,10.5),{size:10.5,fill:'#475467'}));
      if(detail)c.push(t(x+10,y+151,fit(detail,w-20,10),{size:10,fill:'#667085'}));return c.join('');}
    const iw=Math.min(108,(h-12)*4/3);c.push(r(x+6,y+6,iw,h-12,picBg(tag),8,picLine(tag)),A.place(tag,x+8,y+8,iw-4,h-16,PHOTOS));
    const tx=x+iw+16,tw=w-iw-24;
    // A compact card (a hub with many sensors): the badge, name and type.
    if(h<80){c.push(pill(tx,y+7,badge,color),t(tx,y+39,fit(name,tw,14),{size:14,weight:700}),t(tx,y+55,fit(type,tw,11),{size:11,fill:'#475467'}));return c.join('');}
    c.push(pill(tx,y+9,badge,color),t(tx,y+42,fit(name,tw,15),{size:15,weight:700}),t(tx,y+59,fit(type,tw,11.5),{size:11.5,fill:'#475467'}));
    if(detail)c.push(t(tx,y+74,fit(detail,tw,10.5),{size:10.5,fill:warn?'#b42318':'#667085'}));if(detail2)c.push(t(tx,y+87-2,fit(detail2,tw,10.5),{size:10.5,fill:'#667085'}));
    return c.join('');
  }
  function pill(x,y,text,color){const w=Math.max(46,text.length*6.4+14);return r(x,y,w,17,color,8.5)+t(x+w/2,y+12.4,text,{size:9.5,weight:700,fill:'#fff',anchor:'middle',more:' letter-spacing=".5"'});}
  function linkCard({x,y,w=LINK.w,title,detail,color}){return r(x,y,w,LINK.h,'#fffbeb',10,` stroke="${color}" stroke-width="1.5"`)+r(x+8,y+10,32,32,color,8)+t(x+24,y+31,'⇄',{size:16,weight:700,fill:'#fff',anchor:'middle'})+
    t(x+50,y+23,fit(title,w-60,13),{size:13,weight:700})+t(x+50,y+40,fit(detail,w-60,10.5),{size:10.5,fill:'#475467'});}
  function batteryCard({x,y,w=CARD.w,h=CARD.h}){
    const art=`<svg x="${x+8}" y="${y+8}" width="104" height="${h-16}" viewBox="0 0 160 120"><rect x="10" y="30" width="96" height="60" rx="8" fill="#1f2329"/><rect x="10" y="30" width="96" height="22" rx="8" fill="#fff" opacity=".12"/><rect x="22" y="48" width="56" height="22" rx="3" fill="#f2c200"/><text x="50" y="64" font-family="${FONT}" font-size="12" font-weight="800" fill="#1f2329" text-anchor="middle">12V</text>`+
      `<rect x="116" y="44" width="34" height="36" rx="5" fill="#2b3038"/><rect x="126" y="52" width="14" height="20" rx="3" fill="#dc2626"/><path d="M106 60 H116" stroke="#dc2626" stroke-width="5"/></svg>`;
    return r(x,y,w,h,'#ffffff',12,' stroke="#d0d5dd" stroke-width="1.2"')+r(x+6,y+6,108,h-12,'#f2f4f7',8)+art+pill(x+128,y+9,'BATTERY',COLOR.power)+t(x+128,y+42,'12 V battery',{size:15,weight:700})+
      t(x+128,y+59,'through the main power switch',{size:11.5,fill:'#475467'})+t(x+128,y+74,'XT30 · 20 A fuse in the battery',{size:10.5,fill:'#667085'});
  }

  // ---- wires -----------------------------------------------------------------------------------------------------------
  // Every wire on a side goes from one line to another with the same control points, so wires in the same order at both
  // ends never cross. horizontal: from (x1, y1) to (x2, y2) leaving and arriving level; vertical: up or down.
  const curve=(x1,y1,x2,y2,vertical)=>{if(vertical){const m=(y1+y2)/2;return `M${fixed(x1)} ${fixed(y1)} C${fixed(x1)} ${fixed(m)} ${fixed(x2)} ${fixed(m)} ${fixed(x2)} ${fixed(y2)}`;}const m=(x1+x2)/2;return `M${fixed(x1)} ${fixed(y1)} C${fixed(m)} ${fixed(y1)} ${fixed(m)} ${fixed(y2)} ${fixed(x2)} ${fixed(y2)}`;};
  const stroke=(d,color,w,more='')=>`<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"${more}/>`;
  // A cable of strands (colors), each offset across the cable's run, on a white casing.
  function cable(x1,y1,x2,y2,strands,{vertical=false,gap=3.2,width=2.6,dashed=false}={}){
    const n=strands.length,out=[stroke(curve(x1,y1,x2,y2,vertical),'#ffffff',n*gap+5)];
    strands.forEach((color,i)=>{const o=(i-(n-1)/2)*gap;out.push(vertical?stroke(curve(x1+o,y1,x2+o,y2,true),color,width,dashed?' stroke-dasharray="5 4"':''):stroke(curve(x1,y1+o,x2,y2+o,false),color,width,dashed?' stroke-dasharray="5 4"':''));});
    return out.join('');
  }
  const STRANDS={motor:['#1f2937','#dc2626'],encoder:[COLOR.encoder],servo:['#7c4a2a','#dc2626','#f59e0b'],digital:[COLOR.digital],analog:[COLOR.analog],i2c:[COLOR.i2c],usb:[COLOR.usb],power:['#1f2937','#dc2626'],rs485:[COLOR.rs485]};

  // Stacks items (each {ideal, size}) along one axis in order, as close to their ideal centers as they can be without
  // overlapping (spaced by gap); a cluster that would overlap sits centered on its members' ideals.
  function spread(items,gap,min=-Infinity){
    let clusters=items.map((it,i)=>({members:[i],size:it.size,ideal:it.ideal}));
    const start=c=>c.center-c.size/2;
    const place=c=>{const total=c.members.reduce((s,i)=>s+items[i].size,0)+gap*(c.members.length-1),mean=c.members.reduce((s,i)=>s+items[i].ideal,0)/c.members.length;c.size=total;c.center=mean;};
    clusters.forEach(place);
    for(let again=true;again;){again=false;for(let i=1;i<clusters.length;i++){const a=clusters[i-1],b=clusters[i];if(start(b)<a.center+a.size/2+gap){a.members.push(...b.members);place(a);clusters.splice(i,1);again=true;break;}}}
    const out=[];let floor=min;for(const c of clusters){let s=Math.max(start(c),floor);for(const i of c.members){out[i]=s;s+=items[i].size+gap;}floor=s;}
    return out;// the start (top or left) of each item
  }

  // ---- what each device says on its card ----------------------------------------------------------------------------
  function describe(d,notes){
    const i=A.info(d.tag),n=notes?.[d.name]||{},lines={type:i.name,detail:'',detail2:''};
    if(d.family==='motor'){const g=A.gearOf(d.tag,n.gear);lines.detail=g?`${g.rpm} RPM · ${g.ratio}`:'';lines.detail2=n.encoder===false?'No encoder cable':`Encoder → encoder port ${d.port}`;
      if(!lines.detail){lines.detail=lines.detail2;lines.detail2='';}}
    else if(d.family==='i2c'){lines.detail=i.builtIn?'Built in · no cable':i.addr!==undefined?`I2C address ${A.hex(i.addr)}`:'';}
    else if(d.family==='digital'){lines.detail=`Channel ${d.port}${d.tag==='RevTouchSensor'&&d.port%2===0?' · must be odd':''}`;}
    else if(d.family==='analog')lines.detail=`Channel ${d.port} · 0–3.3 V`;
    else if(d.family==='servo')lines.detail=d.tag==='ServoFullRange'?'500–2500 µs':d.tag==='ContinuousRotationServo'?'Spins: set power':'';
    return lines;
  }
  const connector={motor:p=>`Motor ${p} · JST-VH 2-pin`,encoder:p=>`Encoder ${p} · JST-PH 4-pin`,servo:p=>`Servo ${p} · 3-pin 0.1″`,digital:p=>`Digital ${p-p%2}-${p-p%2+1}, channel ${p} · JST-PH 4-pin`,
    analog:p=>`Analog ${p-p%2}-${p-p%2+1}, channel ${p} · JST-PH 4-pin`,i2c:(p,b)=>`I2C bus ${b} · JST-PH 4-pin`,usb:()=>'USB'};

  // ---- one hub and everything plugged into it -----------------------------------------------------------------------
  // Coordinates are the hub's own (its top left at 0, 0); returns the layers and the box around them.
  function panel(h,devices,{notes,links,others,warnings}){
    const servoOnly=h.tag==='ServoHub',{w:W,h:H}=servoOnly?HUB.servo:HUB.lynx,used=new Set(),wires=[],cards=[],box={x0:0,y0:0,x1:W,y1:H},boxes=[{x:0,y:0,w:W,h:H,what:h.name}];
    const grow=(x,y,w,hh)=>{boxes.push({x,y,w,h:hh});box.x0=Math.min(box.x0,x);box.y0=Math.min(box.y0,y);box.x1=Math.max(box.x1,x+w);box.y1=Math.max(box.y1,y+hh);};
    const fam=f=>devices.filter(d=>d.family===f);
    // Left: power first (the battery on the Control Hub, power from the hub before on the others), then motors 0-3.
    const left=[];
    if(!servoOnly){
      if(links.powerIn)left.push({kind:'link',ideal:LYNX.battery[0],size:LINK.h,link:links.powerIn,port:0});
      else left.push({kind:'battery',ideal:LYNX.battery[0],size:CARD.h,port:0});
      if(links.powerOut)left.push({kind:'link',ideal:LYNX.battery[1],size:LINK.h,link:links.powerOut,port:1});
      for(const d of fam('motor').sort((a,b)=>a.port-b.port))left.push({kind:'device',d,ideal:LYNX.motor(d.port)+16,size:CARD.h});
    }else{if(links.powerIn)left.push({kind:'link',ideal:44,size:LINK.h,link:links.powerIn,port:0});}
    const lx=-LANE-CARD.w,ly=spread(left,14,-40);
    left.forEach((it,i)=>{const y=ly[i],edge=0,toX=lx+CARD.w;
      if(it.kind==='battery'){used.add('power:0');wires.push(cable(edge+6,LYNX.battery[0],toX,y+CARD.h/2,STRANDS.power,{gap:3.4,width:3}));cards.push(batteryCard({x:lx,y}));grow(lx,y,CARD.w,CARD.h);}
      else if(it.kind==='link'){const py=servoOnly?44:LYNX.battery[it.port];used.add(`power:${it.port}`);wires.push(cable(edge+6,py,toX,y+LINK.h/2,STRANDS.power,{gap:3.4,width:3}));cards.push(linkCard({x:lx,y,title:it.link.title,detail:it.link.detail,color:COLOR.power}));
        it.link.at={x:lx,y:y+LINK.h/2,side:'left'};grow(lx,y,CARD.w,LINK.h);}
      else{const d=it.d,n=notes?.[d.name]||{},s=describe(d,notes);used.add(`motor:${d.port}`);
        wires.push(cable(edge,LYNX.motor(d.port)+13,toX,y+30,STRANDS.motor,{gap:3.4,width:3}));
        if(n.encoder!==false){used.add(`encoder:${d.port}`);wires.push(stroke(`M36 ${LYNX.encoder(d.port)+6} H${edge}`,COLOR.encoder,2.6)+cable(edge,LYNX.encoder(d.port)+6,toX,y+62,STRANDS.encoder));}
        cards.push(card({x:lx,y,tag:d.tag,badge:`MOTOR ${d.port}`,color:COLOR.motor,name:d.name,...s}));grow(lx,y,CARD.w,CARD.h);}
    });
    // Right: RS485 to the other hubs, then I2C buses 3-0, digital 7-0 and analog 3-0, as they sit top to bottom.
    const rows=[];
    if(links.rs485)rows.push({kind:'link',port:LYNX.rs485,ideal:LYNX.rs485,size:LINK.h,link:links.rs485});
    if(!servoOnly){
      for(let b=3;b>=0;b--){const list=fam('i2c').filter(d=>d.bus===b).sort((a,c)=>Number(!!A.info(a.tag).builtIn)-Number(!!A.info(c.tag).builtIn)||a.port-c.port);if(list.length)rows.push({kind:'i2c',bus:b,list,port:LYNX.i2c(b),ideal:LYNX.i2c(b),size:CARD.h});}
      // Digital and analog cards are compact when the hub has many sensors.
      const many=fam('digital').length+fam('analog').length+rows.length>8,size=many?COMPACT:CARD.h;
      for(const f of ['digital','analog']){const max=f==='digital'?8:4;for(let p=max-2;p>=0;p-=2){const list=fam(f).filter(d=>d.port===p+1||d.port===p).sort((a,b)=>b.port-a.port);
        list.forEach((d,k)=>rows.push({kind:f,list:[d],port:LYNX[f](p),ideal:LYNX[f](p)+(k-(list.length-1)/2)*(size+10),size}));}}
    }
    const rx=W+LANE,ry=spread(rows,10,-40);
    rows.forEach((row,i)=>{const y=ry[i],mid=y+row.size/2;
      if(row.kind==='link'){used.add('rs485');wires.push(cable(W,row.port,rx,mid,STRANDS.rs485,{width:3}));cards.push(linkCard({x:rx,y,title:row.link.title,detail:row.link.detail,color:COLOR.rs485}));row.link.at={x:rx+LINK.w,y:mid,side:'right'};grow(rx,y,LINK.w,LINK.h);return;}
      const f=row.kind;let x=rx;
      if(f==='i2c'){used.add(`i2c:${row.bus}`);const clashes=A.addressClashes(row.list);
        for(const [a,b,addr] of clashes)warnings.push(`${h.name} I2C bus ${row.bus}: “${a.name}” and “${b.name}” both use address ${A.hex(addr)}. Only one can work: move one to another bus.`);
        row.list.forEach((d,k)=>{const s=describe(d,notes),builtIn=!!A.info(d.tag).builtIn,warn=clashes.some(([a,b])=>a===d||b===d);
          if(k===0)wires.push(cable(W,row.port,x,mid,STRANDS.i2c,{dashed:builtIn,width:3}));else wires.push(stroke(`M${x-CHAIN} ${mid} H${x}`,'#ffffff',8)+stroke(`M${x-CHAIN} ${mid} H${x}`,COLOR.i2c,3,builtIn?' stroke-dasharray="5 4"':''));
          cards.push(card({x,y,tag:d.tag,badge:`I2C BUS ${row.bus}`+(row.list.length>1?` · ${k+1}`:''),color:COLOR.i2c,name:d.name,...s,dashed:builtIn,warn,detail:warn?`Address ${A.hex(A.info(d.tag).addr)} clashes`:s.detail}));grow(x,y,CARD.w,CARD.h);x+=CARD.w+CHAIN;});
        if(row.list.length>1)cards.push(t(rx+CARD.w+CHAIN/2,mid-8,'chain',{size:9.5,fill:COLOR.i2c,anchor:'middle',weight:700}));
        return;}
      const d=row.list[0],s=describe(d,notes);used.add(`${f}:${d.port}`);wires.push(cable(W,row.port,x,mid,STRANDS[f],{width:3}));
      if(d.tag==='RevTouchSensor'&&d.port%2===0)warnings.push(`${h.name} digital channel ${d.port}: a REV Touch Sensor reads only on an odd channel (1, 3, 5, 7).`);
      cards.push(card({x,y,h:row.size,tag:d.tag,badge:`${TITLE[f]} ${d.port}`,color:COLOR[f],name:d.name,...s,warn:d.tag==='RevTouchSensor'&&d.port%2===0}));grow(x,y,CARD.w,row.size);
    });
    // Bottom: servos 0-5, below the hub and the motor cards and left of the right-hand wires. Each cable drops straight
    // down under the hub (where nothing else runs) to below the motor cards, then fans out to its card.
    const servos=fam('servo').sort((a,b)=>a.port-b.port);
    if(servos.length){const px=servoOnly?SERVOHUB:LYNX.servo,drop=Math.max(H,...boxes.filter(b=>b.x<0).map(b=>b.y+b.h))+24,top=drop+84,min=Math.min(box.x0,-LANE-CARD.w),ideal=servos.map(d=>({ideal:px(d.port)-SERVO_CARD.w/2,size:SERVO_CARD.w}));
      let xs=spread(ideal,12,min);const over=xs.at(-1)+SERVO_CARD.w-(W-12);if(over>0)xs=xs.map(x=>Math.max(min,x-over));
      servos.forEach((d,k)=>{const x=xs[k],s=describe(d,notes);used.add(`servo:${d.port}`);wires.push(drop>H+24?cable(px(d.port),H-10,px(d.port),drop,STRANDS.servo,{vertical:true,width:2.4,gap:3}):'',cable(px(d.port),drop>H+24?drop:H-10,x+SERVO_CARD.w/2,top,STRANDS.servo,{vertical:true,width:2.4,gap:3}));
        cards.push(card({x,y:top,w:SERVO_CARD.w,h:SERVO_CARD.h,tag:d.tag,badge:`SERVO ${d.port}`,color:COLOR.servo,name:d.name,type:s.type,detail:s.detail}));grow(x,top,SERVO_CARD.w,SERVO_CARD.h);});}
    // Top: cameras on the Control Hub's USB ports.
    if(others?.length){const top=-96-CARD.h,xs=spread(others.map((o,k)=>({ideal:LYNX.usb[1+Math.min(k,1)]-CARD.w/2,size:CARD.w})),16,-LANE-CARD.w);
      others.forEach((o,k)=>{const port=1+Math.min(k,1),x=xs[k];used.add(`usb:${port}`);wires.push(cable(LYNX.usb[port],-6,x+CARD.w/2,top+CARD.h,STRANDS.usb,{vertical:true,width:3.4}));
        cards.push(card({x,y:top,tag:o.tag,badge:o.tag==='EthernetDevice'?'USB · ETHERNET':`USB ${port===2?'3.0':'2.0'}`,color:COLOR.usb,name:o.name,type:A.info(o.tag).name,detail:o.tag==='EthernetDevice'?'Reached as an Ethernet device':'UVC camera'}));grow(x,top,CARD.w,CARD.h);});}
    return {hub:servoOnly?servoHub(h,used):lynxHub(h,used),wires:wires.join(''),cards:cards.join(''),box,boxes,size:{w:W,h:H}};
  }

  // ---- the whole sheet ---------------------------------------------------------------------------------------------
  // config: {name, robot?, hubs, devices (with module and family), other: devices on no hub, notes: {name: {gear,
  // encoder}}, java?: device => its SDK class}. Returns {svg, width, height, warnings, rows}.
  function build(config,{date=new Date()}={}){
    PHOTOS=config.photos||null;
    const hubs=(config.hubs||[]).filter(h=>Number.isFinite(h.address)&&(h.tag==='LynxModule'||h.tag==='ServoHub'));
    const order=[...hubs].sort((a,b)=>(a.tag==='ServoHub')-(b.tag==='ServoHub')||Number(b.parent)-Number(a.parent)||a.address-b.address);
    const same=(d,h)=>d.module&&d.module.portal===h.portal&&d.module.address===h.address&&!!d.module.servoHub===(h.tag==='ServoHub');
    const warnings=[],notes=config.notes||{},devices=(config.devices||[]).filter(d=>d.module),others=(config.other||[]).filter(d=>d.tag==='Webcam'||d.tag==='EthernetDevice');
    const parent=order.find(h=>h.parent&&h.tag==='LynxModule')||order[0];
    // Links between hubs: power and RS485 from the parent hub to each hub after it, in a chain.
    const links=new Map(order.map(h=>[h,{}]));
    order.forEach((h,i)=>{if(i===0)return;const prev=order[i-1],tag=h.tag==='ServoHub'?'Servo Hub':'Expansion Hub';
      const out={title:`Power to ${h.name}`,detail:`XT30 cable to the ${tag}’s XT30 port`},inn={title:`Power from ${prev.name}`,detail:`XT30 cable from its second XT30 port`};
      if(prev.tag!=='ServoHub'&&!links.get(prev).powerOut){links.get(prev).powerOut=out;links.get(h).powerIn=inn;out.pair=inn;}
      const a={title:`RS485 to ${h.name}`,detail:'JST-PH 3-pin RS485 cable'},b={title:`RS485 to ${prev.name}`,detail:`Address ${h.address} on the RS485 bus`};links.get(prev).rs485??=a;links.get(h).rs485=b;a.pair=b;});
    const panels=order.map(h=>({h,...panel(h,devices.filter(d=>same(d,h)),{notes,links:links.get(h),others:h===parent&&h.portal==='(embedded)'?others:[],warnings})}));
    const motors=devices.filter(d=>d.family==='motor').length;if(motors>8)warnings.push(`This configuration has ${motors} motors; a robot may use at most 8.`);
    const unplaced=devices.filter(d=>!order.some(h=>same(d,h)));for(const d of unplaced)warnings.push(`“${d.name}” is on a hub this configuration does not list.`);
    // Stack the panels, hubs lined up, with gutters for the links on both sides.
    const M=44,GUT=34,minX=Math.min(...panels.map(p=>p.box.x0),-LANE-CARD.w),maxX=Math.max(...panels.map(p=>p.box.x1),HUB.lynx.w+LANE+CARD.w);
    const hasLinks=order.length>1,left=M+(hasLinks?GUT:0)-minX,width=left+maxX+M+(hasLinks?GUT:0);
    const out=[],layers={wires:[],hubs:[],cards:[]};let y=184;
    for(const p of panels){const top=y-p.box.y0+30;p.dx=left;p.dy=top;
      const hubPhoto=PHOTOS?.[p.h.tag==='ServoHub'?'#ServoHub':p.h.parent?'#ControlHub':'#ExpansionHub'];
      if(hubPhoto)out.push(r(left+minX,y-34,72,54,'#ffffff',8,' stroke="#eaecf0"'),`<image x="${fixed(left+minX+3)}" y="${fixed(y-31)}" width="66" height="48" preserveAspectRatio="xMidYMid meet" href="${esc(hubPhoto)}"/>`);
      out.push(t(left+minX+(hubPhoto?84:0),y+12,p.h.tag==='ServoHub'?`SERVO HUB · ${p.h.name}`:p.h.parent?`CONTROL HUB · ${p.h.name}`:`EXPANSION HUB · ${p.h.name}`,{size:13,weight:800,fill:'#344054',more:' letter-spacing="1.2"'}),
        r(left+minX,y+20,maxX-minX,1.5,'#e4e7ec'));
      for(const k of ['wires','hubs','cards'])layers[k].push(`<g transform="translate(${fixed(left)} ${fixed(top)})">${k==='hubs'?p.hub:p[k]}</g>`);
      y=top+p.box.y1+92;}
    // Link cables through the gutters: power on the left, RS485 on the right.
    const gutters=[];for(const h of order)for(const [k,side] of [['powerOut','left'],['rs485','right']]){const a=links.get(h)[k];if(!a?.pair?.at||!a.at||(side==='right'&&!a.title.startsWith('RS485 to ')))continue;
      const pa=panels.find(p=>p.h===h),pb=panels.find(p=>links.get(p.h)[k==='powerOut'?'powerIn':'rs485']===a.pair);if(!pa||!pb)continue;
      const x1=pa.dx+a.at.x,y1=pa.dy+a.at.y,x2=pb.dx+a.pair.at.x,y2=pb.dy+a.pair.at.y,gx=side==='left'?M+GUT/2-6:width-M-GUT/2+6,color=side==='left'?COLOR.power:COLOR.rs485;
      const d=`M${fixed(x1)} ${fixed(y1)} H${fixed(gx)} V${fixed(y2)} H${fixed(x2)}`;gutters.push(stroke(d,'#ffffff',side==='left'?11:8),...(side==='left'?[stroke(d,'#1f2937',3,' stroke-linejoin="round" transform="translate(0 -1.7)"'),stroke(d,'#dc2626',3,' stroke-linejoin="round" transform="translate(0 1.7)"')]:[stroke(d,color,3,' stroke-linejoin="round"')]));}
    // The pinout table.
    const rows=table(order,devices,notes,config),tableTop=y+10;let ty=tableTop;
    const cols=[['Hub',150],['Port',290],['Device',180],['Type',230],['In code',0]];cols[4][1]=Math.max(160,width-2*M-cols.slice(0,4).reduce((s,c)=>s+c[1],0));
    out.push(t(M,ty+12,'PINOUT',{size:13,weight:800,fill:'#344054',more:' letter-spacing="1.2"'}),r(M,ty+20,width-2*M,1.5,'#e4e7ec'));ty+=34;
    out.push(r(M,ty,width-2*M,28,'#f2f4f7',6));let cx=M+12;for(const [label,w] of cols){out.push(t(cx,ty+18,label,{size:11,weight:700,fill:'#475467'}));cx+=w;}ty+=28;
    rows.forEach((row,i)=>{if(i%2)out.push(r(M,ty,width-2*M,26,'#f9fafb'));let x=M+12;row.cells.forEach((c,k)=>{out.push(t(x,ty+17,fit(c,cols[k][1]-14,11.5),{size:11.5,weight:k===2?700:400,fill:k===0||k===1?'#344054':'#101828',family:k===4?'Consolas,Menlo,monospace':FONT}),'');
      if(k===1)out.push(`<circle cx="${x-6}" cy="${ty+13}" r="3.5" fill="${COLOR[row.family]||'#98a2b3'}"/>`);x+=cols[k][1];});ty+=26;});
    if(!rows.length){out.push(t(M+12,ty+20,'No devices are configured yet. Open Edit to say what is plugged into each port.',{size:12,fill:'#667085'}));ty+=30;}
    // Warnings, then the legend.
    if(warnings.length){ty+=16;out.push(r(M,ty,width-2*M,24+warnings.length*20,'#fef3f2',8,' stroke="#fecdca"'));warnings.forEach((w,i)=>out.push(t(M+14,ty+21+i*20,'⚠ '+w,{size:12,fill:'#b42318'})));ty+=24+warnings.length*20;}
    const height=ty+M;
    // Title block and legend at the top.
    const head=[r(0,0,width,height,'#ffffff'),r(0,0,width,6,'#f2683a'),t(M,62,config.name||'Robot configuration',{size:30,weight:800}),
      t(M,90,`Wiring diagram${config.robot?` · ${config.robot}`:''} · ${order.length?order.map(h=>h.name).join(' + '):'no hubs'} · ${devices.length} device${devices.length===1?'':'s'}`,{size:14,fill:'#475467'}),
      t(width-M,62,date.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}),{size:13,fill:'#475467',anchor:'end'}),t(width-M,82,'Torque · FTC SDK 12.0 configuration',{size:11,fill:'#98a2b3',anchor:'end'})];
    let lx=M;const legend=[['Motor power','motor'],['Encoder','encoder'],['Servo','servo'],['Digital','digital'],['Analog','analog'],['I2C','i2c'],['RS485','rs485'],['USB','usb']];
    for(const [label,k] of legend){const s=STRANDS[k];s.forEach((c,i)=>head.push(r(lx,114+i*3.2-(s.length-1)*1.6,22,2.6,c,1)));head.push(t(lx+28,119,label,{size:11.5,fill:'#344054'}));lx+=28+label.length*6.6+22;}
    head.push(r(lx,108,22,12,'none',2,' stroke="#0d9488" stroke-width="2" stroke-dasharray="4 3"'),t(lx+28,119,'Built into the hub',{size:11.5,fill:'#344054'}));
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${fixed(width)}" height="${fixed(height)}" viewBox="0 0 ${fixed(width)} ${fixed(height)}" font-family="${FONT}">`+
      `<title>${esc(config.name||'Robot configuration')} wiring diagram</title>${head.join('')}${out.join('')}${gutters.join('')}${layers.wires.join('')}${layers.hubs.join('')}${layers.cards.join('')}</svg>`;
    // Where each hub and card is on the sheet (for checks that nothing overlaps).
    const boxes=panels.flatMap(p=>p.boxes.map(b=>({...b,x:b.x+p.dx,y:b.y+p.dy})));
    return {svg,width,height,warnings,rows,boxes};
  }
  // One row per wire: hub, port and connector, device, type and its SDK class.
  function table(order,devices,notes,config){
    const out=[],famOrder={motor:0,servo:1,digital:2,analog:3,i2c:4};
    for(const h of order){const list=devices.filter(d=>d.module.portal===h.portal&&d.module.address===h.address&&!!d.module.servoHub===(h.tag==='ServoHub')).sort((a,b)=>famOrder[a.family]-famOrder[b.family]||(a.bus??0)-(b.bus??0)||a.port-b.port);
      for(const d of list){const i=A.info(d.tag),n=notes[d.name]||{},g=d.family==='motor'?A.gearOf(d.tag,n.gear):null,java=config.java?config.java(d):'';
        out.push({family:d.family,cells:[h.name,connector[d.family]?connector[d.family](d.port,d.bus):`${d.family} ${d.port}`,d.name,i.name+(g?` · ${g.rpm} RPM`:''),java]});
        if(d.family==='motor'&&n.encoder!==false)out.push({family:'encoder',cells:[h.name,connector.encoder(d.port),d.name,'Motor encoder','(same motor)']});}}
    for(const o of (config.other||[]).filter(d=>d.tag==='Webcam'||d.tag==='EthernetDevice'))out.push({family:'usb',cells:['Control Hub','USB',o.name,A.info(o.tag).name,config.java?config.java(o):'']});
    return out;
  }
  // A photo on white with the store's stamps (mask: [x, y, w, h] fractions) painted out and, when it is a part on a white
  // backdrop, trimmed to the part with a small margin so every part fills its frame alike. At most 480 px on its long
  // side, as a JPEG: small enough to go into an exported pinout.
  function shrink(url,mask=[]){return new Promise(done=>{const img=new Image();img.onload=()=>{
    const W=img.naturalWidth,H=img.naturalHeight,s0=Math.min(1,1000/Math.max(W,H)),w=Math.max(1,Math.round(W*s0)),h=Math.max(1,Math.round(H*s0)),work=document.createElement('canvas');work.width=w;work.height=h;
    const g=work.getContext('2d',{willReadFrequently:true});g.fillStyle='#fff';g.fillRect(0,0,w,h);g.drawImage(img,0,0,w,h);for(const [x,y,mw,mh] of mask)g.fillRect(x*w,y*h,mw*w,mh*h);
    let box=[0,0,w,h];try{box=partBox(g.getImageData(0,0,w,h))||box;}catch{}
    const pad=Math.round(Math.max(box[2],box[3])*.05),cw=box[2]+2*pad,ch=box[3]+2*pad,s=Math.min(1,480/Math.max(cw,ch)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(cw*s));c.height=Math.max(1,Math.round(ch*s));
    const o=c.getContext('2d');o.fillStyle='#fff';o.fillRect(0,0,c.width,c.height);o.drawImage(work,box[0],box[1],box[2],box[3],pad*s,pad*s,box[2]*s,box[3]*s);try{done(c.toDataURL('image/jpeg',.9));}catch{done(url);}};
    img.onerror=()=>done(null);img.src=url;});}
  // The part's bounding box [x, y, w, h] in a photo whose edges are mostly white, else null (a photo on its own backdrop
  // is kept whole). Rows and columns with only a stray pixel or two count as white.
  function partBox({data,width:w,height:h}){
    const ink=(x,y)=>{const i=(y*w+x)*4;return Math.min(data[i],data[i+1],data[i+2])<236;};
    let edge=0,n=0;for(let x=0;x<w;x+=4){edge+=ink(x,0)+ink(x,h-1);n+=2;}for(let y=0;y<h;y+=4){edge+=ink(0,y)+ink(w-1,y);n+=2;}if(edge>n*.25)return null;
    const rows=new Uint32Array(h),cols=new Uint32Array(w);for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(ink(x,y)){rows[y]++;cols[x]++;}
    const min=2,first=a=>a.findIndex(v=>v>min),last=a=>a.length-1-[...a].reverse().findIndex(v=>v>min),x0=first(cols),y0=first(rows);if(x0<0||y0<0)return null;
    const x1=last(cols),y1=last(rows);return [x0,y0,x1-x0+1,y1-y0+1];}
  // The sheet as a PNG, at most 8000 px on its long side.
  async function png(url,sheet){const img=new Image();img.src=url;await img.decode();const scale=Math.min(2,8000/Math.max(sheet.width,sheet.height)),c=document.createElement('canvas');c.width=Math.round(sheet.width*scale);c.height=Math.round(sheet.height*scale);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);const blob=await new Promise(done=>c.toBlob(done,'image/png'));if(!blob)throw Error('The picture is too large to save as a PNG. Save it as an SVG.');return blob;}
  const base64=blob=>new Promise((done,fail)=>{const r=new FileReader();r.onload=()=>done(String(r.result).split(',')[1]);r.onerror=()=>fail(r.error);r.readAsDataURL(blob);});
  return {build,COLOR,spread,shrink,png,base64};
});
