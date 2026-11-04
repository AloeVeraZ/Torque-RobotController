'use strict';
// What Axon's V2 programmer and Axon servos understand: moved from Axon Bridge (Protocol.cs, Params.cs, Firmware.cs), which read
// it out of Axon's two official apps and firmware files. One USB report is report ID 4, command, address high, address low,
// length, payload, 64 bytes in all, and both servo generations answer the same commands through the V2 programmer.
// Field meanings and what is shown to a student are here too, so the page never decides what goes to a servo.
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const VID_V2=0x0473,VID_V1=0x0471,VID_BOOT=0x0472,PID=0x13AA,CHUNK=59,REPORT=64,V1_GAP=60,delay=ms=>new Promise(r=>setTimeout(r,ms));
const hex=(data,max=REPORT)=>[...data].slice(0,max).map(b=>b.toString(16).toUpperCase().padStart(2,'0')).join(' ');
function frame(...bytes){const r=Buffer.alloc(REPORT);r[0]=4;bytes.forEach((b,i)=>{r[i+1]=b&255;});return r;}
class DeviceLost extends Error{}

// A status reply. Byte 7 tells the generation apart: 0x01 is V1 (MAX+, MINI+), 0x22 is V2 (MK2). Axon's V2 app drops
// anything but 0x22, which is why it calls V1 servos incompatible.
function parseStatus(r){
  // A V1 servo answers 04 01 00 …; a MK2 servo on the V2 programmer answers 04 01 22 22 8A … (seen on real hardware 2026-11-04),
  // and no servo is 04 FA (V2) or 04 01 FA (V1).
  const s={family:'none',mode:'unknown',type:0,b6:0,b7:0,b8:0,firmware:''};if(r[1]!==1||(r[2]!==0&&!(r[2]===0x22&&r[7]===0x22)))return s;
  const two=n=>n.toString(16).toUpperCase().padStart(2,'0');Object.assign(s,{type:r[5],b6:r[6],b7:r[7],b8:r[8]});
  if(r[7]===0x01){s.family='v1';if(r[5]===3||r[5]===2)s.mode='servo';else if(r[5]===4)s.mode='cr';else s.family='unknown';s.firmware=`V${two(r[6])}${two(r[7])}${two(r[8])}`;}
  else if(r[7]===0x22){s.family='v2';if(r[5]===0x34||r[5]===0x04)s.mode=r[6]===0x41||r[6]===0x31?'cr':'servo';else s.family='unknown';s.firmware=`AISV${two(r[6])}${two(r[7])}${two(r[8])}`;}
  else{s.family='unknown';s.firmware=`${two(r[5])} ${two(r[6])} ${two(r[7])} ${two(r[8])}`;}
  return s;
}
const servoPresent=s=>s.family!=='none';
// False for a servo that answers but whose settings neither official app can decode.
const servoEditable=s=>(s.family==='v1'||s.family==='v2')&&s.mode!=='unknown'&&s.type!==2&&!s.viaBoot;
const servoKey=s=>`${s.family}/${s.mode}/${s.type}${s.viaBoot?'/boot':''}`;

const ascii=(b,at,n)=>[...b.subarray(at,at+n)].filter(c=>c>=32&&c<127).map(c=>String.fromCharCode(c)).join('').replaceAll('*',' ').trim();
// The servo's factory name, or null for a V1 servo whose second chunk the programmer refused.
const blockName=block=>block.family==='v1'?(block.validLen<0x48?null:ascii(block.data,0x40,8)):ascii(block.data,47,12);
const blockMade=block=>{const d=block.family==='v1'?0x30:44,b=block.data;return `${2000+b[d+2]}/${String(b[d+1]).padStart(2,'0')}/${String(b[d]).padStart(2,'0')}`;};

// The programmer, over a link with write(report,timeoutMs), read(timeoutMs) (a report, or null on timeout) and flush().
class Programmer{
  constructor(link,{trace}={}){this.link=link;this.trace=trace||null;this.quiet=new Map();}
  log(dir,data,quiet){if(!this.trace)return;const line=hex(data,64);if(quiet){const key=(dir==='TX'?0:256)+data[1]+(data[4]<<9);if(this.quiet.get(key)===line)return;this.quiet.set(key,line);}this.trace(`${dir} ${line}`);}
  // The V1 programmer refuses a request sent within ~30 ms of its last reply (Axon's V1 app leaves ~30 ms), and a refused read or
  // write makes the V1 servo stop answering until it restarts, so every V1 request waits V1_GAP after the last reply, and a refusal
  // is not retried here: restartV1 brings the servo back first (seen on real hardware, 2026-11-04).
  async exchange(tx,accept,timeoutMs,tries,quiet){
    for(let busy=0;;busy++){
      if(this.kind==='v1'){const wait=(this.lastAt||0)+V1_GAP-Date.now();if(wait>0)await delay(wait);}
      await this.link.flush();this.log('TX',tx,quiet);
      if(!await this.link.write(tx,1000))throw new DeviceLost('The programmer stopped accepting USB data.');
      let again=false;
      try{for(let i=0;i<tries;i++){const rx=await this.link.read(timeoutMs);if(!rx)continue;this.log('RX',rx,quiet);if(tx[1]!==0x8A&&rx[2]===2&&(rx[1]===tx[1]||(rx[1]===1&&rx[3]===tx[3]&&rx[4]===tx[4]))){again=true;break;}if(accept(rx))return rx;}}
      finally{this.lastAt=Date.now();}
      if(!again||busy>=10)return null;
      if(this.kind==='v1'){this.refused=true;return null;}
      await delay(120);
    }
  }
  // Restarts a V1 servo with no unplugging: update mode, the bootloader's info, its exit (which restarts the servo's own program),
  // update mode off. This is what a mode switch does around the firmware, with no firmware in between. Returns the servo's status.
  async restartV1(){
    this.refused=false;await this.v1UpdateMode(true);const info=await this.bootInfo();await this.bootExit('v1');await this.v1UpdateMode(false);
    let s=parseStatus(Buffer.alloc(REPORT));if(!info)return s;
    for(const end=Date.now()+2500;Date.now()<end&&!servoPresent(s);){await delay(150);s=await this.status();}
    return s;
  }
  // A V1 read or write that was refused is tried once more after a restart.
  async v1Retry(fn){const r=await fn();if(this.kind!=='v1'||!(r?.error||typeof r==='string'))return r;await this.restartV1();return fn();}
  // The V2 programmer's identity check: it answers 0x91 with 0x22 in byte 5.
  async hello(){const r=await this.exchange(frame(0x91),x=>x[5]===0x22,400,2,false);this.helloReply=r?hex(r,16):null;return !!r;}
  // Byte positions and scales are the ones Axon's V2 app reads off this report. Byte 15 is shown raw: only its changes matter to that app.
  async telemetry(){
    const r=await this.exchange(frame(0xAF),x=>x[4]===0xAF,120,3,true);if(!r)return null;
    let amps=((r[13]*256+r[14])/4096)*3.3/0.6;if(amps<0.08)amps=0;if(amps>5)amps=5;
    return {volts:((r[9]*256+r[10])/4096)*3.3*5.99,amps,source:r[15],powerState:r[16],powerOn:r[16]===3,powerAlarm:r[16]===1,outputPulse:r[5]*256+r[6],inputValid:r[19]===1,inputPeriod:r[20]*256+r[21],inputPulse:r[22]*256+r[23],lowReturn:r[24]===1,raw:hex(r,32)};
  }
  // The programmer only powers its servo pins after this. Axon's app sends it by itself below 8.6 V.
  async setServoPower(on){await this.exchange(frame(0xB0,0,on?1:0),()=>true,400,1,false);}
  // The programmer's pulse to its servo (0xAC: period, reference, max, min, centre, period, big-endian). Off is all zero, as Axon's
  // MK2 app sends before a firmware update ("PPM signal output is automatically suspended"); on is that app's 50 Hz preset.
  // One steady pulse to the servo, in µs: what a Test sends. The programmer reports it back in its telemetry (outputPulse).
  async output(us){const w=[20000,Math.round(us),2500,500,1500,20000],b=[];for(const v of w)b.push(v>>8,v&255);await this.exchange(frame(0xAC,0,...b),()=>true,400,1,false);}
  async pulse(on){const w=on?[20000,1500,2500,500,1500,20000]:[0,0,0,0,0,0],b=[];for(const v of w)b.push(v>>8,v&255);await this.exchange(frame(0xAC,0,...b),()=>true,400,1,false);}
  async status(){
    // The V1 programmer answers each 0x8A once, about 33 ms later: 04 01 00 01 <type> … names the servo, 04 01 FA 00 01 says none.
    if(this.kind==='v1'){const r=await this.exchange(frame(0x8A,0,0,4),x=>x[1]===1&&(x[2]===0||x[2]===0xFA),300,2,true);return parseStatus(r||Buffer.alloc(REPORT));}
    const r=await this.exchange(frame(0x8A,0,0,4),x=>x[4]===0x8A||x[1]===0,400,2,true);return r?parseStatus(r):parseStatus(Buffer.alloc(REPORT));}
  async readChunk(addr,n){
    if(this.kind!=='v1')await delay(25);const tx=frame(0xCD,addr>>8,addr&255,n);let rx=await this.exchange(tx,r=>r[4]===n&&r[1]===1&&r[2]===0,400,3,false);
    if(!rx&&this.refused)return {error:`The servo refused the read (address ${addr}).`};
    if(!rx){// No length echo: only trust the data if two separate reads agree exactly.
      const good=r=>r[1]!==0&&r[2]===0,a=await this.exchange(tx,good,400,2,false);await delay(25);const b=a&&await this.exchange(tx,good,400,2,false);
      if(!a||!b||!a.subarray(0,REPORT).equals(b.subarray(0,REPORT)))return {error:`The servo did not return parameter data (address ${addr}).`};
      rx=a;}
    if(rx[1]===0)return {error:`The programmer reported an error reading parameters (${hex(rx.subarray(1,3))}).`};
    return {data:Buffer.from(rx.subarray(5,5+n))};
  }
  // V1 servos have 95 bytes in two chunks, V2 servos 59 in one. validLen drops to 59 on a V1 servo if the programmer refuses the second chunk.
  readBlock(family){return this.v1Retry(()=>this.readBlockOnce(family));}
  async readBlockOnce(family){
    const first=await this.readChunk(0,CHUNK);if(first.error)return {error:first.error};
    if(family!=='v1')return {block:{family,data:first.data,validLen:CHUNK}};
    const data=Buffer.alloc(95);first.data.copy(data);const second=await this.readChunk(CHUNK,95-CHUNK);let validLen=CHUNK;
    if(second.data){second.data.copy(data,CHUNK);validLen=95;}
    return {block:{family,data,validLen}};
  }
  writeBlock(block){return block.family==='v1'?this.v1Retry(()=>this.writeBlockOnce(block)):this.writeBlockOnce(block);}
  async writeBlockOnce(block){
    if(block.family==='v1'){// Same sequence as the V1 app: up to 59 bytes per frame, each acknowledged.
      for(let addr=0;addr<block.validLen;){const n=Math.min(CHUNK,block.validLen-addr);const tx=frame(0xCB,addr>>8,addr&255,n);block.data.copy(tx,5,addr,addr+n);
        const rx=await this.exchange(tx,r=>r[1]===1||r[1]===0,1200,2,false);if(!rx||rx[1]!==1||rx[2]!==0)return `The servo did not acknowledge the write (address ${addr}).`;addr+=n;}
      return null;}
    // V2 stores bytes 0-43 only: the date and factory name after them are read-only. The reply is not relied on; the read-back is.
    const tx=frame(0xCB,0,0,44);block.data.copy(tx,5,0,CHUNK);await this.exchange(tx,()=>true,800,1,false);return null;
  }
  async factoryDefault(){await delay(25);return !!await this.exchange(frame(0x5A,0,0,1),r=>r[5]===0xAA,1000,3,false);}
  // The bootloader: 0x80 info, 0x81 session key, 0x82 records, 0x83 exit.
  bootInfo(){return this.exchange(frame(0x80,4,1,2,3,4),r=>r[5]===0x56,1000,2,false);}
  bootQuick(){return this.exchange(frame(0x80,4,1,2,3,4),r=>r[5]===0x56,120,1,false);}
  bootSeed(seed){const tx=frame(0x81,22);seed.copy(tx,3);return this.exchange(tx,()=>true,1500,1,false);}
  async bootRecord(record,timeoutMs){const tx=frame(0x82,22);record.copy(tx,3);
    for(let busy=0;;busy++){this.log('TX',tx,true);if(!await this.link.write(tx,1000))throw new DeviceLost('The programmer stopped accepting USB data.');const rx=await this.link.read(timeoutMs);if(!rx)return -1;this.log('RX',rx,true);
      if(rx[2]===2&&busy<5){await delay(60);continue;}return rx[5];}}
  // Axon's V1 app puts the V1 programmer in update mode (04 90 00) before it asks for the bootloader, and back (04 90 01) before 0x83.
  async v1UpdateMode(on){await this.exchange(frame(0x90,on?0:1),r=>r[1]===1,400,2,false);}
  // Leaves the bootloader. The two official apps place the 0xFF 0x55 0xAA signature at different offsets.
  async bootExit(family){await this.exchange(family==='v1'?frame(0x83,22,0xFF,0x55,0xAA):frame(0x83,22,0,0,0xFF,0x55,0xAA),()=>true,600,1,false);}
}

// ---- settings
// Values are in the servo's own raw units, so reading and writing one back can never drift through rounding. Each field says
// what it means twice: short sits beside the control, and what is the fuller version on the hint line when it is pointed at.
// format says how its raw number reads to a person (drawn by ui/axon-programmer.js).
const POWER='How hard the motor may push, as a share of full power. Lower it if the servo stalls on a Control Hub: Axon suggests about 66% (MAX) or 75% (MINI) at 4.8 V, and 85% at 6 V from a Servo Power Module or Servo Hub.';
const SENSITIVITY='How small a change in the signal the servo reacts to. Higher reacts to smaller changes but can buzz while holding still. Lower is calmer but less exact. Axon calls this the dead-band.';
const LOST='What the servo does if the signal stops while it still has power, such as when a wire comes loose. Release goes limp, Keep Position holds where it is, and Go Neutral moves to center.';
const DAMPING='Slows the servo as it arrives so it does not overshoot. Axon tunes this at the factory and advises against changing it. Change it only if the servo overshoots or oscillates.';
const OVERLOAD='When the servo stalls, it cuts its own power in up to three stages so the motor does not burn out. Axon recommends keeping the factory values or something more careful.';
const INVERT='Reverses which way the servo turns for the same command. Counter-clockwise is the default.';
const PROPTL='How long the servo may hold full power before it starts limiting itself. Continuous rotation has no three-stage overload protection, so this is its only stall protection.';
const BEEP='Plays a sound when the servo powers up.';
const POWER_SHORT='Caps how hard it pushes',DAMPING_SHORT='Stops overshoot',SENSITIVITY_SHORT='Smallest change it reacts to',SOFT_SHORT='Gentler start at power-on',INVERT_SHORT='Reverses the direction',LOST_SHORT='If the signal stops',BEEP_SHORT='Beep at power-up',PROPTL_SHORT='Full power time before limit';
const LOST_OPTIONS=['Release','Keep Position','Go Neutral'],bit=(flags,mask,on)=>on?flags|mask:flags&~mask&255,be16=(b,at,v)=>{b[at]=v>>8&255;b[at+1]=v&255;};
const changed=(now,basis,key)=>now[key]!==basis[key];
const overloadFields=(tMax,pMin,format)=>[1,2,3].flatMap(n=>[{key:`ol${n}t`,label:`Level ${n} after`,group:'Overload protection',kind:'range',min:0,max:tMax,format,short:`Stall time before level ${n}`,what:`How long the servo must stay stalled before level ${n} starts. ${OVERLOAD}`},{key:`ol${n}p`,label:`Level ${n} power`,group:'Overload protection',kind:'range',min:pMin,max:255,format:'pct',short:`Power limit during level ${n}`,what:`How much power the servo may use once level ${n} starts. ${OVERLOAD}`}]);
const V1_RANGES=[[0x3BD0,0x0BF6],[0x323E,0x1588],[0x2D75,0x1A51],[0x191F,0x0AC4],[0x0B3E,0x031C]];
const SENS_V2=[150,100,50,25];

// 95-byte block. Offsets come from the V1 app's decode and encode.
const v1Servo={title:'V1 servo mode',family:'v1',mode:'servo',fields:[
    {key:'angle',label:'Servo Angle',group:'Travel',kind:'range',min:1,max:255,format:'angle',short:'Total travel, up to 355°',what:'How far the servo may turn in total. 255 is 355 degrees and the factory value is about 180.'},
    {key:'neutral',label:'Neutral',group:'Travel',kind:'range',min:-127,max:127,format:'plain',short:'Shifts the center position',what:'Moves the center position a little. Axon warns that large changes can have side effects.'},
    {key:'range',label:'Pulse Range',group:'Travel',kind:'choice',options:['500-2500','900-2100','1100-1900','Narrow','SSR'],short:'Keep 500-2500 for FTC',what:'The signal the servo expects, in µs. Narrow is 450-1050 and SSR is 130-470. An FTC hub sends 500-2500, so leave this there on a robot.'},
    {key:'pwm',label:'PWM Power',group:'Response',kind:'range',min:100,max:255,format:'pct',short:POWER_SHORT,what:POWER},{key:'damping',label:'Damping',group:'Response',kind:'range',min:50,max:600,format:'plain',short:DAMPING_SHORT,what:DAMPING},
    {key:'sens',label:'Sensitivity',group:'Response',kind:'choice',options:['Ultra High','High','Medium','Low'],short:SENSITIVITY_SHORT,what:SENSITIVITY},{key:'softstart',label:'Soft Start',group:'Response',kind:'switch',short:SOFT_SHORT,what:'Limits how fast the servo accelerates just after power-on, so it does not jump.'},
    {key:'inversion',label:'Inversion',group:'Response',kind:'switch',short:INVERT_SHORT,what:INVERT},{key:'lostppm',label:'Lose PPM',group:'Response',kind:'choice',options:LOST_OPTIONS,short:LOST_SHORT,what:LOST},
    {key:'olp',label:'Enabled',group:'Overload protection',kind:'switch',short:'Cuts power when stalled',what:OVERLOAD},...overloadFields(103,74,'olV1')],
  decode(b){const f=b[0x25],s=b[0x0C]>>4,alt=(b[0x26]&0x40)!==0,us=((b[0]<<8)|b[1])*8/49;
    return {softstart:f&0x10?1:0,inversion:f&2?1:0,olp:f&0x80?1:0,lostppm:f&0x40?(f&0x20?2:1):0,range:f&8?3:f&4?4:us>2450?0:us>2005?1:2,angle:b[4],neutral:b[6]-128,sens:s>1?Math.min(s-1,3):0,pwm:alt?b[0x13]:b[0x12],damping:alt?(b[0x27]<<8)|b[0x28]:(b[0x0A]<<8)|b[0x0B],ol1p:b[0x35],ol1t:b[0x36],ol2p:b[0x37],ol2t:b[0x38],ol3p:b[0x39],ol3t:b[0x3A]};},
  encode(b,now,was){let f=b[0x25];
    if(changed(now,was,'softstart'))f=bit(f,0x10,now.softstart);
    if(changed(now,was,'range')){const r=now.range;f=bit(f,8,r===3);f=bit(f,4,r===4);be16(b,0,V1_RANGES[r][0]);be16(b,2,V1_RANGES[r][1]);}
    // The V1 app flips bit 0 along with the inversion flag, so direction and feedback polarity stay paired.
    if(changed(now,was,'inversion')){const on=!!now.inversion;if(on!==((f&2)!==0)){f=bit(f,2,on);f^=1;}}
    if(changed(now,was,'olp'))f=bit(f,0x80,now.olp);
    if(changed(now,was,'lostppm')){f=bit(f,0x40,now.lostppm!==0);f=bit(f,0x20,now.lostppm===2);}
    b[0x25]=f;
    if(changed(now,was,'angle'))b[4]=b[5]=now.angle;
    if(changed(now,was,'neutral'))b[6]=now.neutral+128;
    if(changed(now,was,'sens'))b[0x0C]=(now.sens+1)<<4;
    if(changed(now,was,'pwm')){b[0x11]=b[0x12]=b[0x13]=now.pwm;b[0x0F]=now.pwm-20;}
    if(changed(now,was,'damping'))for(const at of [0x0A,0x27,0x29,0x2B])be16(b,at,now.damping);
    ['ol1p','ol1t','ol2p','ol2t','ol3p','ol3t'].forEach((k,i)=>{if(changed(now,was,k))b[0x35+i]=now[k];});},
  sanity(block){const b=block.data,max=(b[0]<<8)|b[1],min=(b[2]<<8)|b[3];if(max<=min||max===0xFFFF)return `pulse timing bytes look wrong (${hex(b.subarray(0,4))})`;if(b[4]===0&&b[5]===0)return 'servo angle is zero';return null;}};
const v1Cr={title:'V1 continuous rotation',family:'v1',mode:'cr',fields:[
    {key:'pwm',label:'PWM Power',group:'Continuous rotation',kind:'range',min:100,max:255,format:'pct',short:POWER_SHORT,what:POWER},{key:'proptl',label:'ProPTL',group:'Continuous rotation',kind:'range',min:0,max:255,format:'tenth',short:PROPTL_SHORT,what:PROPTL},{key:'inversion',label:'Inversion',group:'Continuous rotation',kind:'switch',short:INVERT_SHORT,what:INVERT}],
  decode:b=>({inversion:b[0x25]&2?1:0,pwm:b[0x12],proptl:b[0x36]}),
  encode(b,now,was){if(changed(now,was,'inversion')){const on=!!now.inversion;if(on!==((b[0x25]&2)!==0)){b[0x25]=bit(b[0x25],2,on);b[0x25]^=1;}}if(changed(now,was,'pwm'))b[0x12]=now.pwm;if(changed(now,was,'proptl'))b[0x36]=now.proptl;},
  sanity:()=>null};

// 59-byte block, from the V2 app's parameter struct: 1 Damping, 2 Sensitivity, 6 PWM Power, 8 Right, 9 Left, 10 Soft Start, 12-14 overload
// power, 15-17 overload time, 18 protocol, 20 flags, 22-23 Neutral (little-endian), 26 Beep, 32-43 user name, 44-46 date, 47-58 factory name.
// Bytes 0 and 7 are shown but never written: see docs/AXON.md.
const v2Name=b=>{const user=b.subarray(32,44).toString('latin1').replace(/[*\0]+$/,'');return user==='USER_DEF'?b.subarray(47,59).toString('latin1').replace(/[*\0]+$/,''):user;};
const v2NameEncode=(b,now,was)=>{if(changed(now,was,'name')){const text=Buffer.from(now.name||'','latin1');for(let i=0;i<12;i++)b[32+i]=i<text.length?text[i]:0x2A;}};
const v2Servo={title:'V2 servo mode',family:'v2',mode:'servo',fields:[
    {key:'left',label:'Left Range',group:'Travel',kind:'range',min:10,max:255,format:'plain',short:'Travel limit left of center',what:'How far the servo may travel to the left of center. The factory value is 250. Lower it if a mechanism would hit something.'},
    {key:'right',label:'Right Range',group:'Travel',kind:'range',min:10,max:255,format:'plain',short:'Travel limit right of center',what:'How far the servo may travel to the right of center. The factory value is 250. Lower it if a mechanism would hit something.'},
    {key:'neutral',label:'Neutral',group:'Travel',kind:'range',min:-25,max:25,format:'signedUs',short:'Shifts the center position',what:'Moves the center position a little, in microseconds of signal.'},
    {key:'signal',label:'Signal Type',group:'Travel',kind:'choice',options:['Normal','SANWA SR','FUTABA SR','FUTABA UR'],short:'Keep Normal on an FTC hub',what:'The kind of signal the servo expects. An FTC hub sends Normal, so leave this there on a robot.'},
    {key:'pwm',label:'PWM Power',group:'Response',kind:'range',min:25,max:255,format:'pct',short:POWER_SHORT,what:POWER},{key:'damping',label:'Damping',group:'Response',kind:'range',min:1,max:255,format:'plain',short:DAMPING_SHORT,what:DAMPING},
    {key:'sens',label:'Sensitivity',group:'Response',kind:'choice',options:['Low','Medium','High','Ultra High'],short:SENSITIVITY_SHORT,what:SENSITIVITY},{key:'softstart',label:'Soft Start',group:'Response',kind:'range',min:1,max:11,format:'level',short:SOFT_SHORT,what:'Limits how fast the servo accelerates just after power-on, so it does not jump. Level 11 is the factory value.'},
    {key:'lostppm',label:'Lose PPM',group:'Response',kind:'choice',options:LOST_OPTIONS,short:LOST_SHORT,what:LOST},{key:'inversion',label:'Inversion',group:'Response',kind:'switch',short:INVERT_SHORT,what:INVERT},{key:'beep',label:'Power-on Sound',group:'Response',kind:'switch',short:BEEP_SHORT,what:BEEP},
    {key:'name',label:'Model Name',group:'',kind:'text',short:'Stored on the servo',what:'A name stored on the servo, up to 12 characters. It helps you tell servos apart.'},...overloadFields(156,26,'olV2')],
  decode(b){const f=b[20];return {damping:b[1],sens:b[2]>100?0:b[2]>50?1:b[2]>25?2:3,pwm:b[6],right:b[8],left:b[9],softstart:b[10]>10?11:b[10],ol1p:b[12],ol2p:b[13],ol3p:b[14],ol1t:b[15],ol2t:b[16],ol3t:b[17],inversion:f&1,lostppm:f&0x40?(f&8?2:1):0,
      signal:f&0x10?2:f&0x80&&b[18]===220?1:f&0x80&&b[18]===143?3:0,neutral:(b[22]|(b[23]<<8))<<16>>16,beep:b[26]&1,name:v2Name(b)};},
  encode(b,now,was){if(changed(now,was,'damping'))b[1]=now.damping;if(changed(now,was,'sens'))b[2]=SENS_V2[now.sens];if(changed(now,was,'pwm'))b[6]=now.pwm;if(changed(now,was,'right'))b[8]=now.right;if(changed(now,was,'left'))b[9]=now.left;
    if(changed(now,was,'softstart'))b[10]=now.softstart>10?255:now.softstart;
    ['ol1p','ol2p','ol3p','ol1t','ol2t','ol3t'].forEach((k,i)=>{if(changed(now,was,k))b[12+i]=now[k];});
    let f=b[20];if(changed(now,was,'inversion'))f=bit(f,1,now.inversion);
    if(changed(now,was,'lostppm')){f=now.lostppm===0?f&0xB7:now.lostppm===1?(f&0xF7)|0x40:f|0x48;}
    if(changed(now,was,'signal')){f&=~0x90&255;if(now.signal===2)f|=0x10;else if(now.signal===1){f|=0x80;b[18]=220;}else if(now.signal===3){f|=0x80;b[18]=143;}}
    b[20]=f;
    if(changed(now,was,'neutral')){b[22]=now.neutral&255;b[23]=now.neutral>>8&255;}
    if(changed(now,was,'beep'))b[26]=bit(b[26],1,now.beep);
    v2NameEncode(b,now,was);},
  sanity(block){const b=block.data;if(b[0]===0)return 'the first parameter byte is zero';for(let i=47;i<59;i++)if(b[i]!==0&&(b[i]<32||b[i]>126))return 'the factory name is not readable text';return null;}};
const v2Cr={title:'V2 continuous rotation',family:'v2',mode:'cr',fields:[
    {key:'pwm',label:'PWM Power',group:'Continuous rotation',kind:'range',min:25,max:255,format:'pct',short:POWER_SHORT,what:POWER},{key:'proptl',label:'ProPTL',group:'Continuous rotation',kind:'range',min:1,max:250,format:'tenth',short:PROPTL_SHORT,what:PROPTL},{key:'inversion',label:'Inversion',group:'Continuous rotation',kind:'switch',short:INVERT_SHORT,what:INVERT},{key:'beep',label:'Power-on Sound',group:'Continuous rotation',kind:'switch',short:BEEP_SHORT,what:BEEP},{key:'name',label:'Model Name',group:'',kind:'text',short:'Stored on the servo',what:'A name stored on the servo, up to 12 characters. It helps you tell servos apart.'},
    // Advanced. Axon's app hides this on its continuous rotation page, but both V2 CR firmware files read byte 2 at start and
    // treat a smaller control error as no error, and the factory value for this firmware is Medium. Same byte, same four values as servo mode.
    {key:'sens',label:'Stop Band',group:'Advanced',kind:'choice',advanced:true,options:['Low','Medium','High','Ultra High'],short:'Low widest, factory Medium',what:'How wide the stop zone is around the center signal. If the servo creeps when it should be stopped, move to a wider band. If it ignores small commands, move to a narrower one. Axon\'s software does not show this in continuous rotation, but this firmware reads it.'}],
  decode:b=>({pwm:b[6],proptl:b[15],inversion:b[20]&1,beep:b[26]&1,sens:b[2]>100?0:b[2]>50?1:b[2]>25?2:3,name:v2Name(b)}),
  encode(b,now,was){if(changed(now,was,'pwm'))b[6]=now.pwm;if(changed(now,was,'proptl'))b[15]=now.proptl;if(changed(now,was,'inversion'))b[20]=bit(b[20],1,now.inversion);if(changed(now,was,'beep'))b[26]=bit(b[26],1,now.beep);if(changed(now,was,'sens'))b[2]=SENS_V2[now.sens];v2NameEncode(b,now,was);},
  sanity:()=>null};
const schemaFor=(family,mode)=>family==='v1'?(mode==='cr'?v1Cr:v1Servo):(mode==='cr'?v2Cr:v2Servo);
// The schema a page can draw: no functions.
const BASICS=new Set(['angle','left','right','neutral','pwm','inversion','name']);
const schemaView=s=>({title:s.title,family:s.family,mode:s.mode,fields:s.fields.map(f=>BASICS.has(f.key)?f:{...f,advanced:true})});

// Raw bytes shown in Advanced that are read and left alone, with what is and is not known about them.
const UNCONFIRMED='The servo\'s control code uses this, but Axon documents nothing about it and keeps it on a locked page. A wrong value could make the servo oscillate, so Torque never writes it.',v2Unconfirmed=[{at:0,name:'SysAmp',why:UNCONFIRMED},{at:7,name:'MinPower',why:UNCONFIRMED}];

// Rejects anything but a known field with a value that field allows, so a bad message from the page can never reach a servo.
function checkChanges(schema,changes,{advanced=true}={}){
  const out={};for(const [key,value] of Object.entries(changes||{})){const field=schema.fields.find(f=>f.key===key);if(!field||(field.advanced&&!advanced))throw Error(`Torque has no setting called ${key} on this servo.`);
    if(field.kind==='text'){if(typeof value!=='string'||value.length>12||!/^[ -)+-~]*$/.test(value))throw Error(`${field.label} must be up to 12 plain characters, without *.`);out[key]=value;continue;}
    const max=field.kind==='switch'?1:field.kind==='choice'?field.options.length-1:field.max,min=field.kind==='range'?field.min:0;
    if(!Number.isInteger(value)||value<min||value>max)throw Error(`${field.label} must be between ${min} and ${max}.`);out[key]=value;}
  return out;
}

// Settings files: V1 .svo is the raw 95-byte block, V2 .svp is 95 bytes with the block first and a "V4" marker at the end. Axon's apps open both.
const CONFIG_SIZE=95;
function packConfig(family,block){const file=Buffer.alloc(CONFIG_SIZE);Buffer.from(block).copy(file,0,0,Math.min(block.length,CONFIG_SIZE));if(family==='v2'){file[93]=0x56;file[94]=0x34;}return file;}
function configProblem(family,file){if(family==='v1')return file.length<CONFIG_SIZE?'That file is not the right size for a V1 servo.':null;if(file.length<59||file.length>CONFIG_SIZE)return 'That file is not the right size for a V2 servo.';if(file.length===CONFIG_SIZE&&file[94]<0x34&&file[93]===0x56)return 'That settings file is from an older version, and Axon\'s app refuses it too.';return null;}

// ---- the four servos. Factory blocks are the tail of Axon's firmware for each model (flash 0x1C00 on V1, 0x1C01 on V2).
const MODELS=[
  {code:'max1',title:'V1 MAX',sold:'MAX+',family:'v1',factoryName:'SA81BHMW',servo:'3BD00BF682828003003C00551E0000D20AE6E6E6241C181419003C003C003C000000000001E1C00055005500550000000F0A16000096327850506423E30000005341383142484D570000000000000000000000000000000000000000000001',cr:'3BD00BF624210003000A00BAFA0000DC0CDCDCDC050505050A002D002D002D000000000001A00001C201C201C20000000F0A160000A01E8050407824200000005341383142484D570000000000000000000000000000000000000000000000'},
  {code:'mini1',title:'V1 MINI',sold:'MINI+',family:'v1',factoryName:'SA33',servo:'3BD00BF682828003003200411E0000B40AC8C8C82119151114003200320032000000000001E3C0004100410041000000080914000078326450506423E3000000534133332A2A2A2A0000000000000000000000000000000000000000000000',cr:'3BD00BF624210003000A00BAFA0000DC0CDCDCDC050505050A002D002D002D000000000001A30001C201C201C20000001E08160000A01E805040782420000000534133332A2A2A2A0000000000000000000000000000000000000000000000'},
  {code:'mini2',title:'V2 MINI',sold:'MINI MK2',family:'v2',factoryName:'MINIMK2',servo:'3E821948F02FFF50FAFAFFDCCA735234689CDC0A209000001200010014001400303030302A2A2A2A2A2A2A2A1408194D494E494D4B322A2A2A2A2A',cr:'3E826448F02FFF50FAFAFFDC0A73521E689CDC0A209000001200010014001400303030302A2A2A2A2A2A2A2A1408194D494E494D4B322A2A2A2A2A'},
  {code:'max2',title:'V2 MAX',sold:'MAX MK2',family:'v2',factoryName:'MAXMK2',servo:'3E781948F02FFF78FAFAFFDCCA735234689CDC0A229000001200010014001400303030302A2A2A2A2A2A2A2A1408194D41584D4B322A2A2A2A2A2A',cr:'3E786448F02FFF78FAFAFFDC0A73521E689CDC0A219000001200010014001400303030302A2A2A2A2A2A2A2A1A08194D41584D4B322A2A2A2A2A2A'},
];
const norm=s=>String(s??'').replaceAll(' ','').replaceAll('*','').replaceAll('\0','').trim();
const modelByCode=code=>MODELS.find(m=>m.code===code)||null,modelByName=name=>MODELS.find(m=>m.factoryName===norm(name))||null;
const factoryBlock=(model,mode)=>Buffer.from(mode==='cr'?model.cr:model.servo,'hex');
const modelView=m=>({code:m.code,title:m.title,sold:m.sold,family:m.family});

// ---- firmware. Switching mode means flashing firmware, as it does in Axon's own apps. Axon publishes these eight files on its
// documentation pages. Torque does not ship them: they are fetched from those exact links when a student agrees, or picked from
// a folder, and each download must match the hash of the file read when this was written.
const CDN='https://cdn.shopify.com/s/files/1/0657/9182/0008/files/';
const FIRMWARE=[
  {code:'max1',mode:'servo',fileName:'Axon_Max_Servo_Mode.sfw',size:17104,v:'1679588434',sha256:'6573946de5eeeb3dbf739ea79cfc71c649ba7cbd29bb3e781227a32cdca7db2e'},
  {code:'max1',mode:'cr',fileName:'Axon_Max_Modified_CR_Mode.sfw',size:15152,v:'1679588434',sha256:'1e7428593cac311dea15f470f6ae194ff128bef9de134d6679b4fefbd1985631'},
  {code:'mini1',mode:'servo',fileName:'Axon_Mini_Servo_Mode.sfw',size:17216,v:'1679588434',sha256:'c9f038a854629c1f237e5008c9444a829d2fe5744203bcc959c8fd0c2e95c2c3'},
  {code:'mini1',mode:'cr',fileName:'Axon_Mini_Modified_CR_Mode.sfw',size:15136,v:'1679588434',sha256:'684ba8d5f904b183e635469b6f55341b0bf7cb49546a6f069d59504cf9ae6380'},
  {code:'max2',mode:'servo',fileName:'Axon_MAX_MK2_Servo_Mode.sfm',size:17328,v:'1758606422',sha256:'2ac8e4541a90ff28e447f65cd6b39f6fe7e4d27a01f542c3944d496d3b5b1d77'},
  {code:'max2',mode:'cr',fileName:'Axon_MAX_MK2_CR_Mode.sfm',size:13152,v:'1758606422',sha256:'eb6874e2769f8475ca5ab3bc42c6e3de2078171587809bd73246b5a626241587'},
  {code:'mini2',mode:'servo',fileName:'Axon_MINI_MK2_Servo_Mode.sfm',size:17328,v:'1758606431',sha256:'07f0976f7cf6cd2404f3efcaf8d109f191d73a5958474065bd0d863e1abde418'},
  {code:'mini2',mode:'cr',fileName:'Axon_MINI_MK2_CR_Mode.sfm',size:13152,v:'1758606431',sha256:'a00f203ca736220d583dd4043c2b638347adb4ae02542df8b17677816157d6d0'},
].map(f=>({...f,url:`${CDN}${f.fileName}?v=${f.v}`}));
const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');
// Axon's firmware files are encrypted with Axon's own keys. No key is in this code or in a release. Whoever has them imports a key file once (AxonService.importKeys), and until then the rest of the tab works and only changing firmware asks for it.
const NO_KEYS='Changing a servo\'s firmware needs Axon\'s keys, and Torque does not include them. Import your key file to use this, or switch modes with Axon\'s own app. Everything else here works without them.';
let firmwareKeys=null;
const goodKey=k=>typeof k==='string'&&/^[0-9a-f]{32}$/i.test(k);
// A key file: {"v1": 32 hex digits, "v2": 32 hex digits}, either or both.
function parseKeys(text){let v=null;try{v=JSON.parse(String(text));}catch{}const keys={};for(const k of ['v1','v2'])if(goodKey(v?.[k]))keys[k]=v[k].toLowerCase();if(!Object.keys(keys).length)throw Error('That is not a key file Torque can read. It should hold v1 and v2, each 32 hexadecimal digits.');return keys;}
const useKeys=keys=>{firmwareKeys=keys||null;},hasKey=family=>!!firmwareKeys?.[family];
const keyFor=family=>{if(!hasKey(family))throw Error(NO_KEYS);return Buffer.from(firmwareKeys[family],'hex');};
const aes=(key,mode,data)=>{const d=crypto.createDecipheriv(mode,key,mode==='aes-128-cbc'?Buffer.alloc(16):null);d.setAutoPadding(false);return Buffer.concat([d.update(data),d.final()]);};
// V1: the first block is an ECB header holding {int32 length, 'x', 'x'}. The body is CBC with a zero IV.
function decryptV1(file){if(file.length<32||file.length%16!==0)throw Error('This is not a valid .sfw file (bad length).');
  const key=keyFor('v1'),head=aes(key,'aes-128-ecb',file.subarray(0,16)),size=head.readInt32LE(0);if(head[4]!==0x78||head[5]!==0x78||size<=0||size>file.length)throw Error('This is not a valid .sfw file (bad header).');
  const blocks=Math.ceil(size/16);if(16+blocks*16>file.length)throw Error('This .sfw file is truncated.');return aes(key,'aes-128-cbc',file.subarray(16,16+blocks*16)).toString('latin1').slice(0,size);}
// V2: a 16-byte header is skipped, then CBC with a zero IV and no padding.
function decryptV2(file){if(file.length<32||file.length%16!==0)throw Error('This is not a valid .sfm file (bad length).');return aes(keyFor('v2'),'aes-128-cbc',file.subarray(16)).toString('latin1');}
const hx=(s,at)=>{const t=s.slice(at,at+2);if(!/^[0-9A-Fa-f]{2}$/.test(t))throw Error('not hex');return parseInt(t,16);};
// A decrypted file: an "@AABBNAME" header, "$" erase lines and Intel-HEX ":" data lines. Only the key and header check differ between generations.
function parseFirmware(text,family){
  const lines=text.split(/\r?\n/),head=lines[0];if(head.length<6||head[0]!=='@')throw Error('This firmware file has no valid header.');
  const image={family,lines,erase:0,records:0,badChecksums:0,bytes:0};
  try{image.modelA=hx(head,1);image.modelB=hx(head,3);}catch{throw Error('This firmware file has a corrupt header.');}
  let name=head.slice(5);if(family==='v1'&&name.length>8)name=name.slice(0,8);image.name=norm(name);
  for(let i=1;i<lines.length;i++){const l=lines[i];
    if(l.includes('$')){if(l.length<5)throw Error(`Corrupt erase record on line ${i+1}.`);image.erase++;}
    if(l.includes(':')&&l.length>=9&&l.slice(7,9)==='00'){let count;try{count=hx(l,1);}catch{throw Error(`Corrupt data record on line ${i+1}.`);}
      if(count>16||l.length<11+count*2)throw Error(`Data record on line ${i+1} has an unsupported length.`);
      let sum=0;for(let j=0;j<count+5;j++)sum+=hx(l,1+j*2);if(sum&255)image.badChecksums++;image.records++;image.bytes+=count;}}
  if(!image.records)throw Error('This firmware file contains no program data.');
  return image;
}
function loadFirmware(data,fileName){const ext=path.extname(fileName).toLowerCase();if(ext==='.sfw')return parseFirmware(decryptV1(data),'v1');if(ext==='.sfm')return parseFirmware(decryptV2(data),'v2');throw Error('Firmware files must be .sfw (V1) or .sfm (V2).');}
const readFirmware=file=>loadFirmware(fs.readFileSync(file),path.basename(file));

// Axon's MK2 app: pulse off, 200 ms, then 0x80. A servo that still does not answer is restarted (servo power off, on) and asked again
// at once, in case its bootloader only listens just after power-up. Pulse-capable programmers only: the V1 programmer has no 0xAC.
async function enterBootloader(programmer){
  if(programmer.kind!=='v1'){await programmer.pulse(false);await delay(200);}
  let info=await programmer.bootInfo();if(info||programmer.kind==='v1')return info;
  await programmer.setServoPower(false);await delay(600);await programmer.setServoPower(true);
  for(const end=Date.now()+2000;!info&&Date.now()<end;)info=await programmer.bootQuick();
  return info;}
// The flash sequence shared by both official apps. Nothing is erased until the file has been matched to this servo.
async function flash(programmer,image,servoName,{allowUnknownName=false,progress=()=>{}}={}){
  const v1=programmer.kind==='v1',leave=async()=>{if(v1)await programmer.v1UpdateMode(false);await programmer.bootExit(image.family);};
  const fail=async error=>{await leave();return {ok:false,error,changed:!/Nothing was changed\.$/.test(error)};};
  // In update mode the V1 programmer reports the servo with FA in byte 2 (04 01 FA 01 00 04 02 01 08). Axon's V1 app asks once and goes
  // on to the bootloader whatever it says: whether the bootloader answers is the check.
  if(v1){await programmer.v1UpdateMode(true);await programmer.status();}
  progress(0,'Entering the servo\'s bootloader...');
  const info=await enterBootloader(programmer);if(!info)return fail('The servo\'s bootloader did not answer, even with the pulse off and the servo restarted. Unplug the servo, plug it back in and try again. Nothing was changed.');
  const boot=String.fromCharCode(info[5],info[6],info[7],info[8]),two=n=>n.toString(16).toUpperCase().padStart(2,'0');progress(0,`Boot version ${boot}, hardware ${two(info[9])}${two(info[10])}.`);
  if(image.family==='v1'&&info[8]===0x32&&info[6]===0x30)return fail(`This servo's bootloader (${boot}) is too old to update. Nothing was changed.`);
  if(info[9]!==image.modelA||info[10]!==image.modelB)return fail(`This firmware is for different hardware (file ${two(image.modelA)}${two(image.modelB)}, servo ${two(info[9])}${two(info[10])}). Nothing was changed.`);
  const have=norm(servoName);
  if(have){if(have!==image.name)return fail(`This firmware is for "${image.name}" but the servo reports "${have}". Nothing was changed.`);}
  else if(!allowUnknownName)return fail('Could not read the servo\'s name to match it against the firmware. Nothing was changed.');
  const seed=crypto.randomBytes(22),answer=await programmer.bootSeed(seed);if(!answer)return fail('The bootloader did not start an update session. Nothing was changed.');
  const key=Buffer.alloc(22);for(let i=0;i<22;i++)key[i]=seed[i]^answer[5+i];
  const total=image.lines.length;
  for(let i=1;i<total;i++){const line=image.lines[i],rec=crypto.randomBytes(22);let send=false,expect=0,timeout=1500;
    if(line.includes('$')){rec[0]=0x0A;rec[1]=hx(line,1);rec[2]=hx(line,3);expect=0x55;timeout=4000;send=true;}
    else if(line.includes(':')&&line.length>=9&&line.slice(7,9)==='00'){const pairs=Math.floor((line.trimEnd().length-1)/2);let last=0;rec[0]=0x3A;for(let j=0;j<pairs&&j<21;j++){last=hx(line,1+j*2);rec[1+j]=last;}
      const count=rec[1],padFrom=image.family==='v1'?count+5:count+6;// Bytes after the record are noise. The V1 app also overwrites the checksum, the V2 app keeps it.
      if(count+5<22){const noise=crypto.randomBytes(22);for(let k=padFrom;k<22;k++)rec[k]=noise[k];}
      expect=last;send=true;}
    if(send){for(let k=0;k<22;k++)rec[k]^=key[k];const got=await programmer.bootRecord(rec,timeout);
      if(got!==expect)return fail(`The update failed on line ${i+1} of ${total} (servo answered ${got<0?'nothing':two(got)}, expected ${two(expect)}). Keep the servo plugged in and use Recover to try again.`);}
    if(i%8===0||i===total-1)progress(Math.floor(i*100/total),null);}
  await leave();progress(100,'Firmware written.');return {ok:true};
}

module.exports={NO_KEYS,parseKeys,useKeys,hasKey,VID_V2,VID_V1,VID_BOOT,PID,CHUNK,REPORT,DeviceLost,hex,frame,parseStatus,servoPresent,servoEditable,servoKey,blockName,blockMade,Programmer,schemaFor,schemaView,checkChanges,v2Unconfirmed,packConfig,configProblem,CONFIG_SIZE,MODELS,norm,modelByCode,modelByName,factoryBlock,modelView,FIRMWARE,sha256,decryptV1,decryptV2,parseFirmware,loadFirmware,readFirmware,flash};
