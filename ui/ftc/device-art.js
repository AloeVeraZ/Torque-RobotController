'use strict';
// Pictures and facts for every device Configure Robot offers (FTC SDK 12.0 configuration tags): what it is, who makes it,
// how it plugs in, its I2C address, and a drawing of it. The drawings are Deck's own flat illustrations, drawn in a
// 160 x 120 box, so they work with no internet (a robot's Wi-Fi has none) and inside an exported pinout.
// Shared by Configure Robot's device picker, the pinout and the tests.
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckDeviceArt=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const rect=(x,y,w,h,fill,rx=0,more='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"${more}/>`;
  const circle=(cx,cy,r,fill,more='')=>`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${more}/>`;
  const text=(x,y,s,size,fill,more='')=>`<text x="${x}" y="${y}" font-family="Segoe UI,Inter,Arial,sans-serif" font-size="${size}" font-weight="700" fill="${fill}" text-anchor="middle"${more}>${esc(s)}</text>`;
  const path=(d,stroke,w,more='')=>`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"${more}/>`;
  const hexagon=(cx,cy,r,fill)=>`<polygon points="${[0,1,2,3,4,5].map(i=>{const a=Math.PI/6+i*Math.PI/3;return `${(cx+r*Math.cos(a)).toFixed(1)},${(cy+r*Math.sin(a)).toFixed(1)}`;}).join(' ')}" fill="${fill}"/>`;
  const shade=(x,y,w,h,rx=0)=>rect(x,y,w,h*.38,'#fff',rx,' opacity=".16"')+rect(x,y+h*.72,w,h*.28,'#000',rx,' opacity=".18"');
  // A 4-pin JST-PH plug (sensors, encoders, I2C), drawn at (x, y) facing right.
  const jst=(x,y,pins=4)=>rect(x,y,10,pins*4+2,'#f4f1e8',1.5)+Array.from({length:pins},(_,i)=>rect(x+3,y+2+i*4,4,2.4,'#b8b2a0')).join('');
  // Power leads (red and black) out of the back of a motor, ending in a JST-VH plug.
  const leads=(x,y)=>path(`M${x} ${y} C${x+14} ${y} ${x+2} ${y+30} ${x+14} ${y+38}`,'#1b1b1b',3.2)+path(`M${x} ${y+5} C${x+12} ${y+5} ${x-2} ${y+32} ${x+8} ${y+40}`,'#d92d20',3.2)+rect(x+5,y+38,14,9,'#f4f1e8',1.5);
  const encoderLead=(x,y)=>path(`M${x} ${y} C${x+10} ${y} ${x+6} ${y-14} ${x+14} ${y-20}`,'#6b7280',2.4)+jst(x+11,y-31,4);

  // ---- motors, side on: shaft, gearbox, can with its label, end cap with the encoder, leads ------------------------
  function motor(o){
    const g=o.gearbox||{},can=o.can||'#1f2329',top=38,h=44,gx=26,gw=g.length||34,cx=gx+gw,cw=o.canLength||60,ex=cx+cw;
    let s='';
    // Output shaft: REX (round with a flat), hex or D.
    s+=o.shaft==='hex'?rect(4,54,24,12,'#c4c9d1',1)+rect(4,59,24,2,'#8d939c'):rect(4,55,24,10,'#c9ced6',4)+rect(4,55,24,3,'#e5e8ec',1.5);
    if(g.style==='stack'){const n=g.stages||2,w=gw/n;s+=rect(gx,top+2,gw,h-4,'#25282d',3);for(let i=0;i<n;i++)s+=rect(gx+i*w+1,top+2,w-2,h-4,'#2c3036',3)+rect(gx+i*w+w-2,top+2,2,h-4,'#4a4f57');
      s+=shade(gx,top+2,gw,h-4,3);}
    else if(g.style==='spur'){s+=rect(gx-2,top-8,gw+2,h+16,g.color||'#b9c0c9',4)+circle(gx+gw/2-1,top-1,2.4,'#7d848e')+circle(gx+gw/2-1,top+h+1,2.4,'#7d848e')+shade(gx-2,top-8,gw+2,h+16,4);}
    else{s+=rect(gx,top+1,gw,h-2,g.color||'#b9c0c9',4)+rect(gx-3,top-2,6,h+4,g.face||g.color||'#b9c0c9',2);for(const at of g.rings||[.45,.75])s+=rect(gx+gw*at,top+1,1.6,h-2,'#000',0,' opacity=".25"');s+=shade(gx,top+1,gw,h-2,4);}
    s+=rect(cx,top,cw,h,can,5);
    if(o.label){const l=o.label;s+=rect(cx+8,top,cw-16,h,l.color,0)+(l.text?text(cx+cw/2,top+h/2+(l.size||9)/3,l.text,l.size||9,l.ink||'#111'):'')+(l.stripe?rect(cx+8,top+h-7,cw-16,4,l.stripe):'');}
    s+=shade(cx,top,cw,h,5)+rect(ex,top+4,12,h-8,o.cap||'#2b3038',3)+rect(ex+10,top+8,3,h-16,'#15171a',1);
    s+=leads(ex+12,top+10)+(o.encoder===false?'':encoderLead(ex+12,top+h-6));
    return s;
  }
  // REV Core Hex: a squat housing with the hex output in its face.
  function coreHex(){
    return rect(20,30,112,62,'#1d2025',10)+shade(20,30,112,62,10)+rect(122,42,22,38,'#2a2e34',6)+circle(58,61,19,'#2b2f35')+hexagon(58,61,8,'#c4c9d1')+hexagon(58,61,4,'#2b2f35')
      +[[30,40],[30,82],[86,40],[86,82]].map(([x,y])=>circle(x,y,2.6,'#4b5058')).join('')+rect(84,52,30,6,'#f2683a',2)+text(99,72,'CORE HEX',7.5,'#e8e8e8')+leads(144,50)+encoderLead(144,74);
  }
  // ---- servos: the case with its mounting ears, the output spline and horn, the three-wire lead -----------------------
  function servo(o){
    const c=o.color||'#1e2227';let s=rect(14,52,132,10,c,3)+rect(34,36,92,58,c,5)+shade(34,36,92,58,5)+circle(22,57,3,'#0003')+circle(138,57,3,'#0003');
    s+=circle(60,32,11,'#30343a')+circle(60,32,5,'#d7dbe0');
    if(o.cr)s+=path('M44 20 A17 17 0 1 1 46 46','#4f8cff',3)+'<polygon points="40,46 50,48 46,38" fill="#4f8cff"/>';
    else s+=`<rect x="40" y="28" width="56" height="8" rx="4" fill="#f4f4f4" transform="rotate(-18 60 32)"/>`+circle(60,32,4,'#9aa0a8');
    if(o.label)s+=rect(68,50,52,26,o.label.color,3)+text(94,63+(o.label.small?1:3),o.label.text,o.label.small?6.5:9,o.label.ink||'#111')+(o.label.sub?text(94,72,o.label.sub,6,o.label.ink||'#111'):'');
    s+=path('M126 86 C140 86 140 104 152 106','#7a4a2a',2.4)+path('M126 89 C138 89 138 107 150 109','#d92d20',2.4)+path('M126 92 C136 92 136 110 148 112','#f59e0b',2.4)+rect(146,102,10,13,'#1b1b1b',1.5);
    return s;
  }
  // ---- boards and sensors: a PCB or housing with its parts, mounting holes and a JST connector ------------------------
  function board(o){
    const w=o.w||96,h=o.h||70,x=(160-w)/2,y=(120-h)/2,c=o.color||'#1f2329';let s=rect(x,y,w,h,c,o.rx??6)+shade(x,y,w,h,o.rx??6);
    if(o.holes!==false)for(const [hx,hy] of [[x+7,y+7],[x+w-7,y+7],[x+7,y+h-7],[x+w-7,y+h-7]])s+=circle(hx,hy,3.2,'#0006')+circle(hx,hy,1.8,'#d8dde3',' opacity=".55"');
    for(const f of o.parts||[])s+=f(x,y,w,h);
    if(o.ports!==0)for(let i=0;i<(o.ports||1);i++)s+=jst(x+w-2,y+h/2-9+(i-((o.ports||1)-1)/2)*22,4);
    if(o.name)s+=text(x+w/2,y+h-9,o.name,o.nameSize||8,o.ink||'#e9edf2');
    return s;
  }
  const chip=(dx,dy,w,h,fill='#0d0f12')=>(x,y)=>rect(x+dx,y+dy,w,h,fill,1.5);
  const lens=(dx,dy,r,ring='#3a3f47')=>(x,y)=>circle(x+dx,y+dy,r+3,ring)+circle(x+dx,y+dy,r,'#0b1220')+circle(x+dx-r/3,y+dy-r/3,r/3,'#9ec5ff',' opacity=".55"');
  const led=(dx,dy,color='#ffffff')=>(x,y)=>circle(x+dx,y+dy,7,color,' opacity=".18"')+circle(x+dx,y+dy,3.6,color);
  const axes=(dx,dy)=>(x,y)=>path(`M${x+dx} ${y+dy} h14`,'#ef4444',1.8)+path(`M${x+dx} ${y+dy} v-14`,'#22c55e',1.8)+circle(x+dx,y+dy,2.4,'#3b82f6');
  const label=(dx,dy,s,size,fill)=>(x,y)=>text(x+dx,y+dy,s,size,fill);
  const button=(dx,dy)=>(x,y)=>rect(x+dx-12,y+dy-12,24,24,'#3a3f47',3)+circle(x+dx,y+dy,8,'#e5e7eb')+circle(x+dx,y+dy,5,'#f2683a');
  const knob=(dx,dy)=>(x,y)=>circle(x+dx,y+dy,15,'#30343a')+circle(x+dx,y+dy,11,'#c4c9d1')+hexagon(x+dx,y+dy,5,'#30343a');
  const pods=(x,y,w,h)=>jst(x+8,y+h-24,4)+jst(x+24,y+h-24,4);
  const octo=(x,y,w,h)=>Array.from({length:8},(_,i)=>rect(x+8+i*((w-18)/8),y+h-14,8,10,'#f4f1e8',1.5)).join('');
  const screen=(dx,dy,w,h)=>(x,y)=>rect(x+dx,y+dy,w,h,'#0b1220',2)+rect(x+dx+3,y+dy+3,w-6,h-6,'#1d4ed8',1,' opacity=".55"')+rect(x+dx+8,y+dy+8,14,10,'none',0,' stroke="#22c55e" stroke-width="1.6"');
  function ledStick(){let s=rect(8,48,144,24,'#c8102e',3)+shade(8,48,144,24,3);const colors=['#ef4444','#f97316','#facc15','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#ec4899','#ffffff','#ef4444'];
    colors.forEach((c,i)=>{s+=rect(16+i*13,54,9,9,'#f4f4f4',1)+circle(20.5+i*13,58.5,3,c);});return s+jst(146,51,4)+jst(4,51,4);}
  function limitSwitch(){return rect(40,50,80,40,'#1f2329',4)+shade(40,50,80,40,4)+path('M52 50 L118 30','#c4c9d1',3)+circle(120,29,5,'#c4c9d1')+rect(56,46,8,6,'#e11d48',1)+circle(52,82,3,'#0006')+circle(108,82,3,'#0006')
    +path('M120 74 C134 74 134 96 146 98','#1b1b1b',2.4)+path('M120 79 C132 79 132 101 144 103','#d92d20',2.4)+jst(142,92,4);}
  function ledBulb(){return path('M72 84 v26','#a8adb5',2.4)+path('M88 84 v30','#a8adb5',2.4)+rect(62,78,36,8,'#16a34a',2)+`<path d="M64 80 V52 a16 16 0 0 1 32 0 V80 Z" fill="#22c55e" opacity=".85"/>`+circle(80,52,22,'#22c55e',' opacity=".18"')+rect(70,48,6,18,'#fff',3,' opacity=".45"');}
  function sonar(){return board({color:'#0f5132',w:96,h:70,ports:1,parts:[(x,y)=>circle(x+44,y+33,24,'#c4c9d1')+circle(x+44,y+33,19,'#2b2f35')+circle(x+44,y+33,13,'#3f444c')]});}
  function webcam(){return rect(44,90,72,8,'#2b2f35',3)+rect(74,70,12,22,'#30343a')+rect(26,26,108,48,'#1f2329',22)+shade(26,26,108,48,22)+circle(80,50,17,'#30343a')+circle(80,50,12,'#0b1220')+circle(76,46,4,'#9ec5ff',' opacity=".55"')+circle(118,40,3,'#22c55e');}
  function limelight(){return rect(20,26,120,68,'#1f2329',8)+shade(20,26,120,68,8)+circle(80,60,20,'#2b2f35')+circle(80,60,14,'#0b1220')+[[36,40],[124,40],[36,80],[124,80],[52,40],[108,80]].map(([x,y])=>circle(x,y,4,'#4ade80')).join('')+circle(76,56,4,'#9ec5ff',' opacity=".55"');}
  function sparkMini(){return rect(26,36,96,52,'#1f2329',5)+Array.from({length:7},(_,i)=>rect(32+i*12,40,6,44,'#2b3038',2)).join('')+shade(26,36,96,52,5)+rect(48,52,52,18,'#f2f2f2',2)+text(74,64,'SPARK MINI',7,'#111')
    +path('M122 46 C138 46 140 30 152 26','#d92d20',3)+path('M122 52 C140 52 142 34 154 32','#1b1b1b',3)+path('M122 80 C136 80 136 100 148 104','#7a4a2a',2.2)+path('M122 83 C134 83 134 103 146 107','#d92d20',2.2)+path('M122 86 C132 86 132 106 144 110','#f59e0b',2.2)+rect(142,100,9,13,'#1b1b1b',1.5);}
  function blinkin(){let s=rect(30,40,74,44,'#1f2329',5)+shade(30,40,74,44,5)+circle(46,52,3,'#ef4444')+circle(56,52,3,'#22c55e')+text(67,74,'BLINKIN',8,'#e9edf2');
    const cs=['#ef4444','#f97316','#facc15','#22c55e','#3b82f6','#8b5cf6'];s+=path('M104 50 C124 50 126 30 150 26','#e5e7eb',6);cs.forEach((c,i)=>{const t=i/5;s+=circle(108+t*40,48-t*21,2.6,c);});
    return s+path('M104 76 C118 76 118 96 130 100','#7a4a2a',2.2)+path('M104 79 C116 79 116 99 128 103','#d92d20',2.2)+path('M104 82 C114 82 114 102 126 106','#f59e0b',2.2)+rect(124,97,9,13,'#1b1b1b',1.5);}
  function unknown(){return rect(36,30,88,60,'#3a3f47',8)+shade(36,30,88,60,8)+text(80,71,'?',34,'#e5e7eb')+jst(124,51,4);}

  // ---- the catalogue ---------------------------------------------------------------------------------------------
  // family: motor | servo | digital | analog | i2c | usb. connector: what plugs into the hub. addr: 7-bit I2C address.
  const YJ={can:'#1f2329',gearbox:{color:'#b9c0c9',length:34},label:{color:'#f6c500',text:'goBILDA',size:8.5},shaft:'rex'};
  const DEVICES={
    goBILDA5202SeriesMotor:{name:'goBILDA Yellow Jacket',maker:'goBILDA',family:'motor',what:'5202/5203/5204 series planetary gear motor: 12 V, 6000 RPM motor with a planetary gearbox (1:1 to 188:1). Built-in 28 counts-per-revolution encoder on the motor.',art:()=>motor(YJ)},
    goBILDA5201SeriesMotor:{name:'goBILDA 5201 spur gear motor',maker:'goBILDA',family:'motor',what:'5201 series spur gear motor (discontinued): 12 V with a spur gearbox and a built-in encoder.',art:()=>motor({...YJ,gearbox:{style:'spur',color:'#b9c0c9',length:30}})},
    RevRoboticsUltraplanetaryHDHexMotor:{name:'REV UltraPlanetary HD Hex',maker:'REV Robotics',family:'motor',what:'REV-41-1600: HD Hex Motor with stackable 3:1, 4:1 and 5:1 cartridges and a 5 mm hex output. 28 counts-per-revolution encoder on the motor.',art:()=>motor({can:'#1f2329',gearbox:{style:'stack',stages:2,length:38},label:{color:'#2b2f35',text:'HD HEX',ink:'#f2f2f2',stripe:'#f2683a',size:8},shaft:'hex'})},
    RevRobotics20HDHexMotor:{name:'REV HD Hex 20:1',maker:'REV Robotics',family:'motor',what:'REV-41-1301 HD Hex Motor with a 20:1 spur gearbox, about 300 RPM free speed. 560 counts per output revolution.',art:()=>motor({can:'#1f2329',gearbox:{color:'#2a2e34',face:'#3a3f47',length:30},label:{color:'#2b2f35',text:'HD HEX',ink:'#f2f2f2',stripe:'#f2683a',size:8},shaft:'hex'})},
    RevRobotics40HDHexMotor:{name:'REV HD Hex 40:1',maker:'REV Robotics',family:'motor',what:'REV-41-1301 HD Hex Motor with a 40:1 spur gearbox, about 150 RPM free speed. 1120 counts per output revolution.',art:()=>motor({can:'#1f2329',gearbox:{color:'#2a2e34',face:'#3a3f47',length:38,rings:[.3,.55,.8]},label:{color:'#2b2f35',text:'HD HEX',ink:'#f2f2f2',stripe:'#f2683a',size:8},shaft:'hex'})},
    RevRoboticsHDHexMotor:{name:'REV HD Hex (bare)',maker:'REV Robotics',family:'motor',what:'REV HD Hex Motor with no gearbox.',art:()=>motor({can:'#1f2329',gearbox:{color:'#2a2e34',length:8,rings:[]},label:{color:'#2b2f35',text:'HD HEX',ink:'#f2f2f2',stripe:'#f2683a',size:8},shaft:'hex'})},
    RevRoboticsCoreHexMotor:{name:'REV Core Hex',maker:'REV Robotics',family:'motor',what:'REV-41-1300: compact 72:1 motor, about 125 RPM, with a 5 mm hex output through its face. 288 counts per output revolution.',art:coreHex},
    NeveRest20Gearmotor:{name:'NeveRest Orbital 20',maker:'AndyMark',family:'motor',what:'AndyMark NeveRest with a 20:1 gearbox, about 340 RPM.',art:()=>motor({can:'#c0c5cc',gearbox:{color:'#25282d',length:28},label:{color:'#111',text:'NeveRest',ink:'#f5f5f5',size:8},cap:'#25282d'})},
    NeveRest40Gearmotor:{name:'NeveRest 40',maker:'AndyMark',family:'motor',what:'AndyMark NeveRest with a 40:1 gearbox, about 160 RPM.',art:()=>motor({can:'#c0c5cc',gearbox:{color:'#25282d',length:36},label:{color:'#111',text:'NeveRest',ink:'#f5f5f5',size:8},cap:'#25282d'})},
    NeveRest60Gearmotor:{name:'NeveRest 60',maker:'AndyMark',family:'motor',what:'AndyMark NeveRest with a 60:1 gearbox, about 105 RPM.',art:()=>motor({can:'#c0c5cc',gearbox:{color:'#25282d',length:42,rings:[.3,.55,.8]},label:{color:'#111',text:'NeveRest',ink:'#f5f5f5',size:8},cap:'#25282d'})},
    'NeveRest3.7v1Gearmotor':{name:'NeveRest Orbital 3.7',maker:'AndyMark',family:'motor',what:'AndyMark NeveRest Orbital with a 3.7:1 planetary gearbox, about 1780 RPM.',art:()=>motor({can:'#c0c5cc',gearbox:{color:'#25282d',length:22,rings:[.5]},label:{color:'#111',text:'NeveRest',ink:'#f5f5f5',size:8},cap:'#25282d'})},
    TetrixMotor:{name:'TETRIX MAX motor',maker:'Pitsco',family:'motor',what:'Pitsco TETRIX MAX TorqueNADO 12 V DC motor.',art:()=>motor({can:'#c0c5cc',gearbox:{color:'#2a2e34',length:30},label:{color:'#1d4ed8',text:'TETRIX',ink:'#fff',size:8.5},cap:'#2a2e34'})},
    Matrix12vMotor:{name:'MATRIX 12 V motor',maker:'MATRIX',family:'motor',what:'MATRIX 12 V DC gear motor.',art:()=>motor({can:'#c0c5cc',gearbox:{color:'#2a2e34',length:30},label:{color:'#f97316',text:'MATRIX',ink:'#111',size:8.5},cap:'#2a2e34'})},
    StudicaMaverick:{name:'Studica Maverick',maker:'Studica',family:'motor',what:'Studica Robotics Maverick 12 V DC gear motor.',art:()=>motor({can:'#3a3f47',gearbox:{color:'#b9c0c9',length:32},label:{color:'#1e6bd6',text:'MAVERICK',ink:'#fff',size:7.5}})},
    Motor:{name:'Unspecified motor',maker:'Any maker',family:'motor',what:'A 12 V DC motor the SDK has no type for. The SDK uses default ticks per revolution and PIDF.',art:()=>motor({can:'#4b5058',gearbox:{color:'#8d939c',length:30},label:{color:'#9aa0a8',text:'DC MOTOR',ink:'#111',size:7.5}})},
    Servo:{name:'Servo',maker:'Any maker',family:'servo',what:'A positional servo (goBILDA, REV Smart Robot Servo, Axon…). The SDK sends 600–2400 µs pulses for positions 0 to 1.',art:()=>servo({label:{color:'#e5e7eb',text:'SERVO'}})},
    ServoFullRange:{name:'Servo, full range',maker:'Any maker',family:'servo',what:'A positional servo driven with 500–2500 µs pulses for its full travel (FTC SDK 10.3 and later).',art:()=>servo({label:{color:'#f6c500',text:'FULL RANGE',sub:'500–2500 µs',small:true}})},
    ContinuousRotationServo:{name:'Continuous rotation servo',maker:'Any maker',family:'servo',what:'A servo that spins continuously: the code sets its power, not a position.',art:()=>servo({cr:true,label:{color:'#bfdbfe',text:'CR SERVO',small:true}})},
    RevBlinkinLedDriver:{name:'REV Blinkin LED driver',maker:'REV Robotics',family:'servo',what:'REV-11-1105: drives a 5 V or 12 V addressable LED strip; the code picks a pattern through a servo port.',art:blinkin},
    RevSPARKMini:{name:'REV SPARK Mini',maker:'REV Robotics',family:'servo',what:'REV-31-1230: a motor controller driven from a servo port, for one more brushed 12 V motor.',art:sparkMini},
    DigitalDevice:{name:'Digital device',maker:'Any maker',family:'digital',what:'An on/off signal: a limit switch, beam break or magnetic limit switch, read as a DigitalChannel.',art:limitSwitch},
    RevTouchSensor:{name:'REV Touch Sensor',maker:'REV Robotics',family:'digital',what:'REV-31-1425: a push button on a small board. It reads on the odd channel of its digital connector (1, 3, 5 or 7).',art:()=>board({color:'#1f2329',w:84,h:62,parts:[button(36,26)],name:'TOUCH'})},
    Led:{name:'LED',maker:'Any maker',family:'digital',what:'A single LED switched by a digital channel set as an output.',art:ledBulb},
    AnalogInput:{name:'Analog input',maker:'Any maker',family:'analog',what:'A 0–3.3 V signal, such as a REV Potentiometer (REV-31-1155) or an Axon servo’s position wire.',art:()=>board({color:'#1f2329',w:84,h:62,parts:[knob(36,28)],name:'ANALOG'})},
    OpticalDistanceSensor:{name:'Optical distance sensor',maker:'Modern Robotics',family:'analog',what:'Modern Robotics Optical Distance Sensor: reflected light as an analog voltage.',art:()=>board({color:'#30343a',w:84,h:62,parts:[led(28,26,'#fca5a5'),chip(46,20,14,12)],name:'ODS'})},
    ModernRoboticsAnalogTouchSensor:{name:'MR analog touch sensor',maker:'Modern Robotics',family:'analog',what:'Modern Robotics touch sensor read on an analog port.',art:()=>board({color:'#30343a',w:84,h:62,parts:[button(36,26)],name:'MR TOUCH'})},
    ControlHubImuBHI260AP:{name:'Control Hub IMU (BHI260AP)',maker:'REV Robotics',family:'i2c',addr:0x28,builtIn:true,what:'The IMU inside the Control Hub (every Control Hub since September 2022), on I2C bus 0. No cable.',art:()=>board({color:'#1f2329',w:84,h:66,ports:0,parts:[chip(30,18,24,24),axes(14,52)],name:'BHI260AP',nameSize:7})},
    LynxEmbeddedIMU:{name:'Hub IMU (BNO055)',maker:'REV Robotics',family:'i2c',addr:0x28,builtIn:true,what:'The BNO055 IMU inside older Control Hubs and Expansion Hubs, on I2C bus 0. No cable.',art:()=>board({color:'#1f2329',w:84,h:66,ports:0,parts:[chip(30,18,24,24),axes(14,52)],name:'BNO055',nameSize:7})},
    RevExternalImu:{name:'REV External IMU',maker:'REV Robotics',family:'i2c',what:'REV’s external 9-axis IMU board for an I2C port.',art:()=>board({color:'#1f2329',w:84,h:62,parts:[chip(30,16,22,22),axes(14,48)],name:'IMU'})},
    AdafruitBNO055IMU:{name:'Adafruit BNO055 IMU',maker:'Adafruit',family:'i2c',addr:0x28,what:'Adafruit BNO055 9-DOF absolute orientation board.',art:()=>board({color:'#1b3a8a',w:84,h:62,parts:[chip(30,16,22,22),axes(14,48)],name:'BNO055'})},
    AndyMarkIMU:{name:'AndyMark IMU',maker:'AndyMark',family:'i2c',addr:0x28,what:'AndyMark BNO055 IMU board.',art:()=>board({color:'#1f2329',w:84,h:62,parts:[chip(30,16,22,22),axes(14,48)],name:'AM IMU'})},
    KauaiLabsNavxMicro:{name:'navX2-Micro',maker:'Kauai Labs',family:'i2c',addr:0x32,what:'Kauai Labs navX-Micro 9-axis IMU.',art:()=>board({color:'#0e5a6b',w:84,h:62,parts:[chip(30,16,22,22),led(66,16,'#22c55e'),led(66,30,'#f59e0b')],name:'navX'})},
    goBILDAOdometryPod:{name:'goBILDA odometry pod',maker:'goBILDA',family:'motor',what:'Swingarm odometry pod: a free wheel on a spring arm with an encoder that plugs into a motor port’s encoder input.',art:()=>board({color:'#1f2329',w:96,h:70,parts:[(x,y,w,h)=>circle(x+w/2,y+h/2+6,20,'#3a3f47')+circle(x+w/2,y+h/2+6,8,'#f6c500'),label(48,14,'POD',8,'#f6c500')],name:''})},
    goBILDAPinpoint:{name:'goBILDA Pinpoint',maker:'goBILDA',family:'i2c',addr:0x31,what:'goBILDA Pinpoint Odometry Computer: reads two odometry pods and its own IMU and reports the robot’s position.',art:()=>board({color:'#1f2329',w:96,h:70,parts:[chip(38,14,22,22),label(48,48,'PINPOINT',8,'#f6c500'),pods],name:''})},
    SparkFunOTOS:{name:'SparkFun OTOS',maker:'SparkFun',family:'i2c',addr:0x17,what:'SparkFun Optical Tracking Odometry Sensor: an optical mouse sensor and IMU that report the robot’s position. Mount it 10 mm off the floor.',art:()=>board({color:'#c8102e',w:84,h:72,ports:2,parts:[lens(42,30,12)],name:'OTOS',ink:'#fff'})},
    OctoQuadFTC:{name:'OctoQuad',maker:'DigitalChicken Labs',family:'i2c',addr:0x30,what:'DigitalChicken Labs OctoQuad: reads up to eight encoders (odometry pods or absolute encoders).',art:()=>board({color:'#14324d',w:110,h:66,parts:[chip(40,12,26,18),octo],name:''})},
    HuskyLens:{name:'DFRobot HuskyLens',maker:'DFRobot',family:'i2c',addr:0x32,what:'DFRobot HuskyLens AI camera with its own screen: object, color and tag recognition.',art:()=>board({color:'#16365c',w:104,h:74,holes:false,parts:[screen(8,10,56,40),lens(84,30,10)],name:'HUSKYLENS',nameSize:7})},
    RevColorSensorV3:{name:'REV Color Sensor V3',maker:'REV Robotics',family:'i2c',addr:0x52,what:'REV-31-1557: color, light and proximity sensor (Broadcom APDS-9151). Best within 1–2 cm of the object.',art:()=>board({color:'#1f2329',w:72,h:62,parts:[led(24,24),chip(38,18,14,12,'#111827')],name:'COLOR V3',nameSize:7})},
    LynxColorSensor:{name:'REV Color Sensor V2',maker:'REV Robotics',family:'i2c',addr:0x39,what:'REV-31-1537: older color and range sensor.',art:()=>board({color:'#1f2329',w:72,h:62,parts:[led(24,24),chip(38,18,14,12,'#111827')],name:'COLOR V2',nameSize:7})},
    REV_VL53L0X_RANGE_SENSOR:{name:'REV 2m Distance Sensor',maker:'REV Robotics',family:'i2c',addr:0x29,what:'REV-31-1505: laser time-of-flight distance sensor (ST VL53L0X), up to about 2 m.',art:()=>board({color:'#1f2329',w:72,h:62,parts:[chip(20,18,30,14,'#0b0d10'),(x,y)=>circle(x+28,y+25,3.4,'#7f1d1d')+circle(x+42,y+25,3.4,'#111827')],name:'2M DIST',nameSize:7})},
    AndyMarkTOF:{name:'AndyMark 2m TOF Lidar',maker:'AndyMark',family:'i2c',addr:0x29,what:'AndyMark time-of-flight distance sensor (VL53L0X).',art:()=>board({color:'#1f2329',w:72,h:62,parts:[chip(20,18,30,14,'#0b0d10'),(x,y)=>circle(x+28,y+25,3.4,'#7f1d1d')+circle(x+42,y+25,3.4,'#111827')],name:'AM TOF',nameSize:7})},
    AndyMarkColor:{name:'AndyMark proximity & color',maker:'AndyMark',family:'i2c',addr:0x39,what:'AndyMark proximity and color sensor.',art:()=>board({color:'#1f2329',w:72,h:62,parts:[led(24,24),chip(38,18,14,12,'#111827')],name:'AM COLOR',nameSize:7})},
    AdafruitColorSensor:{name:'Adafruit RGB color sensor',maker:'Adafruit',family:'i2c',addr:0x29,what:'Adafruit TCS34725 RGB color sensor.',art:()=>board({color:'#1b3a8a',w:72,h:62,parts:[led(24,24),chip(38,18,14,12,'#111827')],name:'TCS34725',nameSize:7})},
    MaxSonarI2CXL:{name:'MaxBotix MaxSonar I2CXL',maker:'MaxBotix',family:'i2c',addr:0x70,what:'MaxBotix ultrasonic range finder on I2C.',art:sonar},
    ModernRoboticsI2cColorSensor:{name:'MR color sensor',maker:'Modern Robotics',family:'i2c',addr:0x1e,what:'Modern Robotics I2C color sensor.',art:()=>board({color:'#30343a',w:72,h:62,parts:[led(24,24),chip(38,18,14,12,'#111827')],name:'MR COLOR',nameSize:7})},
    ModernRoboticsI2cRangeSensor:{name:'MR range sensor',maker:'Modern Robotics',family:'i2c',addr:0x14,what:'Modern Robotics ultrasonic and optical range sensor.',art:()=>board({color:'#30343a',w:84,h:62,parts:[(x,y)=>circle(x+26,y+26,10,'#c4c9d1')+circle(x+26,y+26,6,'#2b2f35'),led(56,26,'#fca5a5')],name:'MR RANGE',nameSize:7})},
    QWIIC_LED_STICK:{name:'SparkFun Qwiic LED Stick',maker:'SparkFun',family:'i2c',addr:0x23,what:'SparkFun Qwiic LED Stick: ten addressable RGB LEDs on I2C.',art:ledStick},
    Webcam:{name:'Webcam',maker:'Any maker',family:'usb',what:'A UVC webcam (Logitech C270, Arducam…) on a Control Hub USB port.',art:webcam},
    EthernetDevice:{name:'Limelight 3A',maker:'Limelight',family:'usb',what:'Limelight 3A vision camera: USB to the Control Hub, which reaches it as an Ethernet device.',art:limelight}
  };
  // Product photos: each device's listing on its maker's store, as [page, what the photo shows, {image, mask}]. The app
  // reads the listing's main product image (its og:image), or the gallery photo named by image where the main one is a
  // close-up, a crop or a group shot, when it is online and keeps it on this computer for the times it is on the robot's
  // Wi-Fi; the photos stay the makers' own and are never bundled with Deck. mask lists [x, y, w, h] boxes (fractions of
  // the photo) painted white to hide a store's stamp ("FTC Legal", "Patented") beside the part. A discontinued part
  // shows its maker's archived listing. A generic type shows a common part of that kind; only Unspecified Motor
  // and Other device keep a drawing.
  const REV=n=>`https://www.revrobotics.com/rev-${n}/`,AM=p=>`https://www.andymark.com/products/${p}`,GB=p=>`https://www.gobilda.com/${p}/`;
  const GBI=p=>`https://cdn11.bigcommerce.com/s-x56mtydx1w/images/stencil/1280w/products/${p}.jpg`,AMI=p=>`https://cdn.shopify.com/s/files/1/0644/2303/5052/files/${p}.jpg?width=1000`;
  const MR=(page,image,what)=>[`https://web.archive.org/web/2018/http://www.modernroboticsinc.com/${page}`,`Modern Robotics ${what} (discontinued)`,{image:`https://web.archive.org/web/2018id_/http://www.modernroboticsinc.com/content/images/thumbs/${image}.png`}];
  const STAMP=[.6,0,.4,.18],POWERPOLE=[.28,.8,.225,.18];
  const PHOTOS={
    goBILDA5202SeriesMotor:[GB('5203-series-yellow-jacket-planetary-gear-motor-13-7-1-ratio-24mm-length-8mm-rex-shaft-435-rpm-3-3-5v-encoder'),'goBILDA 5203 Yellow Jacket',
      {image:GBI('1490/14801/5203-2402-0014__42460.1746574613'),mask:[STAMP,[.6,.9,.4,.1]]}],
    goBILDA5201SeriesMotor:[GB('5201-series-53-1-ratio-105-rpm-spur-gear-motor-w-encoder'),'goBILDA 5201-0002-0053 (discontinued)',{image:GBI('836/4621/5201-0002-0053-FTC-Legal__41351__17713.1701992249'),mask:[STAMP]}],
    Matrix12vMotor:[GB('modern-robotics-matrix-12vdc-motor-with-17-tooth-gear'),'MATRIX 12 VDC motor (goBILDA 5000-0002-0117)',{image:GBI('1424/7052/5000-0002-0117_FTC-Legal__08504__01887.1701993048'),mask:[STAMP]}],
    StudicaMaverick:['https://www.studica.com/maverick-12v-dc-gear-motor-with-encoder','Studica 75001 Maverick',
      // Studica's store turns away apps, so its photo comes from the Internet Archive's copy.
      {image:'https://web.archive.org/web/20251105160445id_/https://www.studica.com/images/thumbs/0004207_maverick-12v-dc-gear-motor-611-wencoder.jpeg'}],
    RevRoboticsUltraplanetaryHDHexMotor:[REV('41-1600'),'REV-41-1600'],RevRobotics20HDHexMotor:[REV('41-1301'),'REV-41-1301'],RevRobotics40HDHexMotor:[REV('41-1301'),'REV-41-1301'],
    RevRoboticsHDHexMotor:[REV('41-1301'),'REV-41-1301'],RevRoboticsCoreHexMotor:[REV('41-1300'),'REV-41-1300'],
    NeveRest20Gearmotor:[AM('neverest-orbital-gearmotors'),'AndyMark NeveRest Orbital',{image:AMI('am-4608a_1c63043e-3c5b-430b-8bb9-19750f5624d0')}],
    'NeveRest3.7v1Gearmotor':[AM('neverest-orbital-gearmotors'),'AndyMark NeveRest Orbital',{image:AMI('am-4608a_1c63043e-3c5b-430b-8bb9-19750f5624d0')}],
    NeveRest40Gearmotor:[AM('neverest-classic-40-gearmotor'),'AndyMark am-2964a',{image:AMI('am-2964a_4d14bdab-4c42-4409-886d-a606795c7e00'),mask:[POWERPOLE]}],
    NeveRest60Gearmotor:[AM('neverest-classic-60-gearmotor'),'AndyMark am-3103',{image:AMI('am-3103_e2e377ae-526e-4c38-a406-fdd4db8fa146'),mask:[POWERPOLE]}],
    TetrixMotor:['https://www.pitsco.com/TETRIX-MAX-TorqueNADO-Motor-with-Encoder','Pitsco 44260'],
    Servo:[GB('2000-series-dual-mode-servo-25-2'),'Shown: goBILDA 2000-0025-0002 Torque servo'],ServoFullRange:[GB('2000-series-dual-mode-servo-25-2'),'Shown: goBILDA 2000-0025-0002 (500–2500 µs)'],
    ContinuousRotationServo:[GB('2000-series-dual-mode-servo-25-3-speed'),'Shown: goBILDA 2000-0025-0003 in continuous mode'],
    RevBlinkinLedDriver:[REV('11-1105'),'REV-11-1105'],RevSPARKMini:[REV('31-1230'),'REV-31-1230'],
    DigitalDevice:[REV('31-1462'),'Shown: REV Magnetic Limit Switch'],RevTouchSensor:[REV('31-1425'),'REV-31-1425'],Led:[REV('31-2010'),'Shown: REV Digital LED Indicator'],
    AnalogInput:[REV('31-1155'),'Shown: REV Potentiometer'],OpticalDistanceSensor:MR('optical-distance-sensor-2','0000399_optical-distance-sensor_226','45-2006 Optical Distance Sensor'),
    ModernRoboticsAnalogTouchSensor:MR('touch-sensor-2','0000398_touch-sensor_226','45-2007 Touch Sensor'),ModernRoboticsI2cColorSensor:MR('color-sensor','0000397_color-sensor_500','45-2018 Color Sensor'),
    ModernRoboticsI2cRangeSensor:MR('range-sensor','0000400_range-sensor_500','45-2008 Range Sensor'),
    ControlHubImuBHI260AP:[REV('31-1595'),'Inside the REV Control Hub'],LynxEmbeddedIMU:[REV('31-1153'),'Inside the REV hub'],RevExternalImu:[REV('31-3332'),'REV-31-3332'],
    AdafruitBNO055IMU:[AM('absolute-orientation-imu-fusion-breakout'),'Adafruit BNO055 breakout'],AndyMarkIMU:[AM('imu-andymark-standard-sensors-2'),'AndyMark am-5638'],KauaiLabsNavxMicro:[AM('navx2-micro-navigation-sensor'),'AndyMark am-3554a'],
    goBILDAOdometryPod:[GB('swingarm-odometry-pod-48mm-wheel'),'goBILDA 3110-0001-0001'],
    goBILDAPinpoint:[GB('pinpoint-odometry-computer-imu-sensor-fusion-for-2-wheel-odometry'),'goBILDA 3110-0002-0001',{image:GBI('2262/13386/unnamed__75902__17614.1726607396'),mask:[[.6,.83,.4,.17]]}],SparkFunOTOS:['https://www.sparkfun.com/sparkfun-optical-tracking-odometry-sensor-paa5160e1-qwiic.html','SparkFun SEN-24904'],
    OctoQuadFTC:['https://www.tindie.com/products/digitalchickenlabs/octoquad-ftc-ed-mk2-8x-encoderpwm-imu/','OctoQuad FTC Edition MK2',
      {image:'https://img.tindie.com/images/resize/bFPvBQRWnsoWWMAng1wdRAjEBNw=/p/fit-in/1032x688/filters:fill(fff)/i/730853/products/2025-03-08T23:58:39.498Z-MK2_CaseClosed.jpg?1741449693'}],HuskyLens:['https://www.dfrobot.com/product-1922.html','DFRobot SEN0305'],
    RevColorSensorV3:[REV('31-1557'),'REV-31-1557'],LynxColorSensor:[REV('31-1537'),'REV-31-1537'],REV_VL53L0X_RANGE_SENSOR:[REV('31-1505'),'REV-31-1505'],
    AndyMarkTOF:[AM('lidar-distance-sensor-andymark-standard-sensors'),'AndyMark am-5684'],AndyMarkColor:[AM('color-and-proximity-sensor-andymark-standard-sensors'),'AndyMark color & proximity'],
    AdafruitColorSensor:['https://www.adafruit.com/product/1334','Adafruit 1334'],MaxSonarI2CXL:['https://maxbotix.com/products/mb1242','MaxBotix MB1242'],
    QWIIC_LED_STICK:['https://www.sparkfun.com/sparkfun-qwiic-led-stick-apa102c.html','SparkFun COM-18354'],Webcam:['https://www.logitech.com/en-us/products/webcams/c270-hd-webcam.960-000694.html','Shown: Logitech C270',
      {image:'https://resource.logitech.com/w_800,c_limit,q_auto,f_png,dpr_1.0/d_transparent.gif/content/dam/products/logitech/webcams/c270-hd-webcam/gallery/c270-hd-webcam-1-0224.png'}],
    EthernetDevice:[AM('limelight-3a'),'Limelight 3A (AndyMark am-3833)',{image:AMI('am-3833_3A')}],
    // Each model of a type that many makers share (a Servo, a goBILDA motor, an encoder), so the picture is of the one chosen.
    // A tag "model-<id>|<device>" is that photo, drawn as <device> until it is on this computer. A model with no listing to show
    // has no entry, and keeps the drawing rather than another maker's photo.
    ...(()=>{const AX=p=>`https://axon-robotics.com/products/${p}`,SW=p=>`https://swyftrobotics.com/motion/${p}`,Y=(r,rpm)=>GB(`5203-series-yellow-jacket-planetary-gear-motor-${r}-ratio-24mm-length-8mm-rex-shaft-${rpm}-rpm-3-3-5v-encoder`),AC=p=>`https://www.actuonix.com/${p}`,STUDICA='https://web.archive.org/web/2025id_/https://www.studica.com/multi-mode-smart-servo',US=p=>`https://www.usdigital.com/products/encoders/${p}/`;
      const table={'gobilda-torque':[GB('2000-series-dual-mode-servo-25-2-torque'),'goBILDA 2000-0025-0002'],'gobilda-speed':[GB('2000-series-dual-mode-servo-25-3-speed'),'goBILDA 2000-0025-0003'],'gobilda-superspeed':[GB('2000-series-dual-mode-servo-25-4-super-speed'),'goBILDA 2000-0025-0004'],'gobilda-5turn':[GB('2000-series-5-turn-dual-mode-servo-25-3-speed'),'goBILDA 2000-0025-0503'],
        'axon-max':[AX('max'),'Axon MAX'],'axon-mini':[AX('mini'),'Axon MINI'],'axon-micro':[AX('micro'),'Axon MICRO'],'rev-smart':['https://web.archive.org/web/2024id_/https://www.revrobotics.com/rev-41-1097/','REV-41-1097 (discontinued)'],
        'studica-multimode':[STUDICA,'Studica Multi-Mode'],'studica-multimode-fast':[STUDICA,'Studica Multi-Mode'],'swyft-speed':[SW('swyft-servos'),'SWYFT servo'],'swyft-balance':[SW('swyft-servos'),'SWYFT servo'],'swyft-torque':[SW('swyft-servos'),'SWYFT servo'],'swyft-slim':[SW('swyft-mini-servos'),'SWYFT mini servo'],'swyft-nano':[SW('swyft-mini-servos'),'SWYFT mini servo'],
        'torctex-max':['https://torctex.com/products/torctex-max','TORCTEX MAX'],'hitec-485':['https://hitecrcd.com/products/servos/analog/sport-2/hs-485hb/product','Hitec HS-485HB'],
        'actuonix-l16-50':[AC('l16-50-150-6-r'),'Actuonix L16-50'],'actuonix-l16-100':[AC('l16-100-150-6-r'),'Actuonix L16-100'],'actuonix-l16-140':[AC('l16-140-150-6-r'),'Actuonix L16-140'],'hitec-hls12':['https://hitecrcd.com/products/servos/linear-series/hls12-3050-6v-501-gear-ratio-30mm-stroke-5mm-lead-linear-servo-6v/product','Hitec HLS12-3050'],
        'gobilda-5203-6000':[GB('5203-series-yellow-jacket-motor-1-1-ratio-24mm-length-8mm-rex-shaft-6000-rpm-3-3-5v-encoder'),'goBILDA 5203-2402-0001'],'gobilda-5203-1620':[GB('5203-series-yellow-jacket-planetary-gear-motor-3-7-1-ratio-1620-rpm-3-3-5v-encoder'),'goBILDA 5203-2402-0003'],'gobilda-5203-1150':[Y('5-2-1',1150),'goBILDA 5203-2402-0005'],'gobilda-5203-435':[Y('13-7-1',435),'goBILDA 5203-2402-0014'],'gobilda-5203-312':[Y('19-2-1',312),'goBILDA 5203-2402-0019'],'gobilda-5203-223':[Y('26-9-1',223),'goBILDA 5203-2402-0027'],'gobilda-5203-117':[Y('50-9-1',117),'goBILDA 5203-2402-0051'],'gobilda-5203-84':[Y('71-2-1',84),'goBILDA 5203-2402-0071'],'gobilda-5203-60':[Y('99-5-1',60),'goBILDA 5203-2402-0100'],'gobilda-5203-43':[Y('139-1',43),'goBILDA 5203-2402-0139'],'gobilda-5203-30':[Y('188-1',30),'goBILDA 5203-2402-0188'],
        'rev-hd-hex':[REV('41-1291'),'REV-41-1291'],'rev-through-bore':[REV('11-1271'),'REV-11-1271'],'rev-through-bore-v2':[REV('11-3174'),'REV-11-3174'],'rev-through-bore-abs':[REV('11-3174'),'REV-11-3174'],'gobilda-pod-encoder':[GB('swingarm-odometry-pod-48mm-wheel'),'goBILDA 3110-0001-0001'],'quadrature-encoder':[US('incremental/kit/e4t'),'Shown: US Digital E4T'],
        'axon-feedback':[AX('max'),'Shown: Axon MAX'],'rev-potentiometer':[REV('31-1155'),'REV-31-1155'],'andymark-am5200':[AM('hex-bore-encoder'),'AndyMark am-5200'],'analog-absolute':[US('absolute/shaft/ma3'),'Shown: US Digital MA3'],'rev-magnetic-limit':[REV('31-1462'),'REV-31-1462'],'limit-switch':[AM('limit-switch'),'Shown: AndyMark am-3372']};
      return Object.fromEntries(Object.entries(table).map(([id,p])=>['model-'+id,p]));})(),
    // The hubs themselves, for the pinout's panel headings.
    '#ControlHub':[REV('31-1595'),'REV-31-1595 Control Hub'],'#ExpansionHub':[REV('31-1153'),'REV-31-1153 Expansion Hub'],'#ServoHub':[REV('11-1855'),'REV-11-1855 Servo Hub']};
  // An archived listing names the maker's own site.
  const siteOf=page=>{try{const u=new URL(page),old=u.hostname==='web.archive.org'&&/\/web\/[^/]+\/(https?:\/\/[^/]+)/.exec(u.pathname)?.[1];
    return old?new URL(old).hostname.replace(/^www\./,'')+' (archived)':u.hostname.replace(/^www\./,'');}catch{return '';}};
  const photoKey=tag=>String(tag??'').split('|')[0];
  const photoOf=tag=>{const p=PHOTOS[photoKey(tag)];if(!p)return null;return {page:p[0],caption:p[1],site:siteOf(p[0]),image:p[2]?.image||null,mask:p[2]?.mask||[]};};
  const OTHER={name:'Other device',maker:'',family:'other',what:'A device type Deck has no picture for.',art:unknown};
  const info=tag=>{const drawn=String(tag??'').split('|')[1]??tag;return DEVICES[drawn]||{...OTHER,name:drawn||OTHER.name};};
  // The drawing as a standalone SVG, or (nested) placed in a pinout at x, y, w, h: the product photo when photos has
  // one for the tag (a data: URL), else the drawing.
  const svg=(tag,{title=true}={})=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120" role="img"${title?` aria-label="${esc(info(tag).name)}"`:' aria-hidden="true"'}>${info(tag).art()}</svg>`;
  const place=(tag,x,y,w,h,photos)=>photos?.[tag]?`<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" href="${esc(photos[tag])}"/>`:`<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 160 120">${info(tag).art()}</svg>`;

  // ---- motor gearing: what Configure Robot cannot say, kept as Deck's wiring notes ----------------------------------
  // goBILDA 5202/5203/5204: ratio, output RPM at 12 V and encoder counts per output revolution (28 x the actual ratio;
  // its planetary stages are 1+46/17 and 1+46/11, so 13.7:1 counts 384.5 a turn).
  const GA=1+46/17,GB5=1+46/11;
  const GOBILDA=[['1:1',1,6000],['3.7:1',GA,1620],['5.2:1',GB5,1150],['13.7:1',GA*GA,435],['19.2:1',GA*GB5,312],['26.9:1',GB5*GB5,223],['50.9:1',GA**3,117],['71.2:1',GA*GA*GB5,84],['99.5:1',GA*GB5*GB5,60],['139:1',GB5**3,43],['188:1',GA**4,30]]
    .map(([ratio,actual,rpm])=>({id:ratio,label:`${rpm} RPM (${ratio})`,rpm,ratio,cpr:Math.round(28*actual*10)/10}));
  // REV UltraPlanetary: cartridges 3:1, 4:1 and 5:1 are really 2.89, 3.61 and 5.23 (6000 RPM motor, 28 counts).
  const CART={3:84/29,4:76/21,5:68/13},ULTRA=[[],[3],[4],[5],[3,3],[3,4],[4,4],[3,5],[4,5],[3,3,3],[5,5],[3,3,4],[3,4,4],[3,3,5],[4,4,4],[3,4,5],[4,4,5],[3,5,5],[4,5,5],[5,5,5]].map(stack=>{
    const actual=stack.reduce((a,c)=>a*CART[c],1),nominal=stack.reduce((a,c)=>a*c,1),rpm=Math.round(6000/actual);
    return {id:stack.length?stack.join('x'):'1',label:`${rpm} RPM (${nominal}:1${stack.length>1?`, ${stack.map(c=>c+':1').join(' + ')}`:''})`,rpm,ratio:`${nominal}:1`,cpr:Math.round(28*actual*10)/10};});
  const GEARING={goBILDA5202SeriesMotor:GOBILDA,RevRoboticsUltraplanetaryHDHexMotor:ULTRA};
  const gearOf=(tag,id)=>(GEARING[tag]||[]).find(g=>g.id===id)||null;

  // ---- I2C addresses on one bus ---------------------------------------------------------------------------------------
  // Two devices with the same address on one bus cannot both work. devices: [{name, tag}]; returns [[a, b, addr]].
  function addressClashes(devices){const out=[];(devices||[]).forEach((a,i)=>devices.slice(i+1).forEach(b=>{const x=info(a.tag).addr,y=info(b.tag).addr;if(x!==undefined&&x===y)out.push([a,b,x]);}));return out;}
  const hex=n=>'0x'+n.toString(16).toUpperCase().padStart(2,'0');
  return {DEVICES,PHOTOS,photoOf,photoKey,info,svg,place,GEARING,gearOf,addressClashes,hex,esc};
});
