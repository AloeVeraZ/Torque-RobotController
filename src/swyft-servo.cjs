'use strict';
// What SWYFT's servo programmer and SWYFT servos understand, read out of SWYFT's own app (SWYFT Servo Programmer V2 2.0.0,
// Protocol/ServoProtocol, ViewModels/MainViewModel) on 2026-11-13 and checked against a real SWYFT Speed servo.
// The programmer is a plain CP2102 USB-to-UART adapter (USB 10C4:EA60) with TX and RX joined onto the servo's signal wire, so
// every byte sent comes straight back as an echo before the servo answers. 115200 baud, 8 data bits, no parity, 2 stop bits.
// A frame is 20 bytes: 0x55, 17 bytes, a checksum (low byte of the sum of bytes 1-17), 0xAA. A read is all zeros between the
// markers; the servo answers with its settings and bit 3 of byte 3 set. A write carries the settings with bit 1 of byte 3 set;
// the servo acknowledges with bit 2 of byte 3 set. Nothing in a reply names the servo model: SWYFT's app treats every SWYFT
// servo the same way, and so does this.
// Field meanings and what is shown to a student are here too, so the page never decides what goes to a servo.

const FRAME=20,HEAD=0x55,TAIL=0xAA,BAUD=115200;
const FLAG={reverse:0x01,write:0x02,ack:0x04,reply:0x08,stall:0x10,ramp:0x20};
const hex=data=>[...data].map(b=>b.toString(16).toUpperCase().padStart(2,'0')).join(' ');
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,Math.round(Number(v)||0)));

function checksum(f){let s=0;for(let i=1;i<18;i++)s+=f[i];return s&255;}
function validFrame(f){return !!f&&f.length>=FRAME&&f[0]===HEAD&&f[19]===TAIL&&f[18]===checksum(f);}
function readFrame(){const f=Buffer.alloc(FRAME);f[0]=HEAD;f[19]=TAIL;return f;}
const u16=(f,at)=>f[at]|(f[at+1]<<8);
function put16(f,at,v){v=clamp(v,0,65535);f[at]=v&255;f[at+1]=(v>>8)&255;}

// Settings as SWYFT's app names them on screen, with the servo's own field names in the comments.
// p = Torque, i = IntegralProportion, d = Brake, integralSpeed = IntegralSpeed, deadZone = Sensitivity, maxPower = MaxDuty,
// left/right = BigAngle/SmallAngle (the travel each side of the middle; 255 on both sides is continuous rotation).
function decode(f){
  return {p:f[1],i:f[2],reverse:!!(f[3]&FLAG.reverse),stall:!!(f[3]&FLAG.stall),ramp:!!(f[3]&FLAG.ramp),left:f[4],deadZone:f[5],
    integralSpeed:f[6],d:u16(f,7),minSignal:u16(f,9),maxSignal:u16(f,11),maxPower:u16(f,13),right:f[15],middleSignal:u16(f,16)};
}
function writeFrame(s){
  const f=Buffer.alloc(FRAME),b=v=>clamp(v,0,255);f[0]=HEAD;f[19]=TAIL;
  f[1]=b(s.p);f[2]=b(s.i);f[3]=FLAG.write|(s.reverse?FLAG.reverse:0)|(s.stall?FLAG.stall:0)|(s.ramp?FLAG.ramp:0);
  f[4]=b(s.left);f[5]=b(s.deadZone);f[6]=b(s.integralSpeed);put16(f,7,s.d);put16(f,9,s.minSignal);put16(f,11,s.maxSignal);
  put16(f,13,s.maxPower);f[15]=b(s.right);put16(f,16,s.middleSignal);f[18]=checksum(f);return f;
}
const isReadReply=f=>validFrame(f)&&(f[3]&FLAG.reply)===FLAG.reply;
const isWriteAck=f=>validFrame(f)&&(f[3]&FLAG.ack)===FLAG.ack;

// Travel. SWYFT's app shows one total in degrees, split evenly left and right: side = round((deg*19 + 420) / 50), so 270° is 111
// a side and 320° is 130. 255 on both sides is continuous rotation (full speed only).
const MAX_DEGREES=320,CONTINUOUS=255;
const degreesToSide=deg=>clamp((clamp(deg,0,MAX_DEGREES)*19+420)/50,0,255);
const sideToDegrees=v=>clamp((v*50-420)/19,0,MAX_DEGREES);
const isContinuous=s=>s.left>=CONTINUOUS&&s.right>=CONTINUOUS;
// The total a servo's two sides come to, as SWYFT's app shows it (it averages two unequal sides).
const travelDegrees=s=>sideToDegrees(Math.round((s.left+s.right)/2));
function withTravel(s,{continuous,degrees}){
  const side=continuous?CONTINUOUS:degreesToSide(degrees);return {...s,left:side,right:side};
}

// Every number SWYFT's app lets a student change, in its order, with its limits and its words.
const FIELDS=[
  {key:'p',name:'P coefficient',min:0,max:255,unit:'',help:'Proportional: how strongly the servo reacts to the error between its current and target position. Higher P = faster response, but can cause overshoot or oscillation.'},
  {key:'i',name:'I coefficient',min:0,max:255,unit:'',help:'Integral: corrects accumulated error over time, removing steady-state offset. Higher I = removes offset faster, but can reduce stability.'},
  {key:'d',name:'D coefficient',min:0,max:65535,unit:'',help:'Derivative: dampens the response to reduce overshoot and oscillation. Higher D = smoother response, but can slow the servo down.'},
  {key:'integralSpeed',name:'Integral speed',min:0,max:255,unit:'×3 ms',help:'Integration interval. Higher values integrate more slowly.'},
  {key:'minSignal',name:'Min signal',min:500,max:2500,unit:'µs',help:"PWM signal value corresponding to the servo's leftmost position."},
  {key:'maxSignal',name:'Max signal',min:500,max:2500,unit:'µs',help:"PWM signal value corresponding to the servo's rightmost position."},
  {key:'middleSignal',name:'Middle signal',min:500,max:2500,unit:'µs',help:"PWM signal value for the servo's center position. Recommended: 1500."},
  {key:'deadZone',name:'Dead zone',min:0,max:255,unit:'µs',help:'How close the servo must be to its target before it stops correcting. Smaller = higher precision but may add jitter.'},
  {key:'maxPower',name:'Max power',min:0,max:500,unit:'',help:'Maximum power output to the servo motor (0–500, where 500 is full power; 90% = 450).'},
];
const SWITCHES=[
  {key:'reverse',name:'Reverse direction',help:'Swaps left and right. Off = default direction.'},
  {key:'stall',name:'Stall protection',help:'Shuts off the servo if stalled for over 10 seconds to prevent damage.'},
  {key:'ramp',name:'Ramp mode',help:'Limits the initial current surge at startup.'},
];
// Simple mode: what every student should know. The rest is Advanced.
const BASICS=['travel','reverse','maxPower','stall'];
const fieldFor=key=>FIELDS.find(f=>f.key===key)||null;
// Problems a write must not go out with: a number out of its range, or no travel at all.
function problems(s){
  const out=[];for(const f of FIELDS){const v=s[f.key];if(!Number.isInteger(v)||v<f.min||v>f.max)out.push(`${f.name} must be ${f.min}–${f.max}.`);}
  for(const side of ['left','right'])if(!Number.isInteger(s[side])||s[side]<0||s[side]>255)out.push('Travel is out of range.');
  return [...new Set(out)];
}

// SWYFT's "Set defaults": its recommended settings, 270° travel. Kept as SWYFT wrote them.
const DEFAULTS=Object.freeze({p:19,i:13,d:47,integralSpeed:20,minSignal:500,maxSignal:2500,middleSignal:1500,deadZone:5,maxPower:400,
  left:111,right:111,reverse:true,stall:true,ramp:true});

// SWYFT's programmable servos, from swyftrobotics.com (read 2026-11-13). The Speed sold as continuous rotation only
// (SR-Servo-01-CR) is left out: SWYFT says it is not programmable. The programmer cannot tell them apart, so the student picks one;
// it only changes what is shown, never what is written. Speeds and torques are as SWYFT lists them (RPM, kg·cm).
const MODELS=[
  {id:'speed',name:'Speed',sku:'SR-Servo-01',rpm:161,torque:19,grams:83,spline:'H25T',programmable:true},
  {id:'balance',name:'Balance',sku:'SR-Servo-02',rpm:109,torque:27.3,grams:83,spline:'H25T',programmable:true},
  {id:'torque',name:'Torque',sku:'SR-Servo-03',rpm:89,torque:33.5,grams:83,spline:'H25T',programmable:true},
  {id:'slim',name:'Slim',sku:'SR-SERVO-04',rpm:133,torque:14,grams:60,spline:'H25T',programmable:true},
  {id:'nano',name:'Nano',sku:'SR-SERVO-05',rpm:91,torque:10.2,grams:20,spline:'B25T',programmable:true},
];
const modelById=id=>MODELS.find(m=>m.id===id)||null;

// A short line for the log, in the order SWYFT's app writes it.
const describe=s=>`P=${s.p}, I=${s.i}, D=${s.d}, integral speed=${s.integralSpeed}, signal ${s.minSignal}/${s.middleSignal}/${s.maxSignal} µs, `+
  `dead zone=${s.deadZone}, max power=${s.maxPower}, travel=${isContinuous(s)?'continuous':`${travelDegrees(s)}° (${s.left}/${s.right})`}, `+
  `direction=${s.reverse?'reversed':'normal'}, stall protection=${s.stall?'on':'off'}, ramp=${s.ramp?'on':'off'}`;

// The settings a servo holds, compared field by field (left and right travel included).
const KEYS=Object.keys(DEFAULTS);
const sameSettings=(a,b)=>!!a&&!!b&&KEYS.every(k=>a[k]===b[k]);

// Picks frames out of what arrived. The programmer echoes every byte sent, so the request comes back first and is skipped.
// Bytes before a 0x55 that starts a valid frame are noise and are dropped.
function takeFrames(buf){
  const frames=[];let at=0;
  while(buf.length-at>=FRAME){
    const start=buf.indexOf(HEAD,at);if(start<0){at=buf.length;break;}
    if(buf.length-start<FRAME){at=start;break;}
    const f=buf.subarray(start,start+FRAME);if(validFrame(f)){frames.push(Buffer.from(f));at=start+FRAME;}else at=start+1;
  }
  return {frames,rest:buf.subarray(at)};
}

// The programmer, over a link with write(bytes), read(timeoutMs) (the bytes that arrived, or null on timeout) and flush().
// One request at a time; every byte is passed to trace as TX/RX lines when given.
// SWYFT's app waits 80 ms after sending and throws away what came, to clear the echo, then waits 600 ms for the reply. A real Speed
// servo answered 165-205 ms after the request (2026-11-13). Torque keeps every byte and skips the echo by matching it instead.
class DeviceLost extends Error{}
const REPLY_MS=700;
class Programmer{
  constructor(link,{trace,replyMs=REPLY_MS}={}){this.link=link;this.trace=trace||null;this.replyMs=replyMs;}
  log(dir,data){if(this.trace)this.trace(`${dir} ${hex(data)}`);}
  // Sends a frame and returns the first frame back that is not its own echo and that accept() takes, or null on timeout.
  // The echo proves the programmer itself works, so `echo` tells a dead programmer apart from a servo that is not answering.
  async transact(tx,accept){
    await this.link.flush();this.log('TX',tx);await this.link.write(tx);
    const end=Date.now()+this.replyMs;let buf=Buffer.alloc(0),echo=false;
    for(;;){
      const left=end-Date.now();if(left<=0)return {frame:null,echo};
      const chunk=await this.link.read(Math.min(left,250));if(!chunk||!chunk.length)continue;
      const {frames,rest}=takeFrames(Buffer.concat([buf,chunk]));buf=Buffer.from(rest);
      for(const f of frames){this.log('RX',f);if(!echo&&f.equals(tx)){echo=true;continue;}if(accept(f))return {frame:f,echo:true};}
      // Bytes that are no frame at all, sent back the way they went out, still prove the programmer is there.
      if(!echo&&buf.length>=FRAME&&buf.subarray(0,FRAME).equals(tx))echo=true;
    }
  }
  // The servo's settings, or why they could not be read: echo false means the programmer itself did not answer.
  async read(){
    const {frame,echo}=await this.transact(readFrame(),isReadReply);
    return frame?{ok:true,settings:decode(frame),raw:hex(frame)}:{ok:false,echo};
  }
  // Sends settings and waits for the servo's acknowledgement. The caller reads it back to confirm.
  async write(s){
    const {frame,echo}=await this.transact(writeFrame(s),isWriteAck);
    return {ok:!!frame,echo,raw:frame?hex(frame):null};
  }
}

module.exports={FRAME,HEAD,TAIL,BAUD,FLAG,FIELDS,SWITCHES,BASICS,DEFAULTS,MODELS,MAX_DEGREES,CONTINUOUS,REPLY_MS,
  checksum,validFrame,readFrame,writeFrame,decode,isReadReply,isWriteAck,degreesToSide,sideToDegrees,isContinuous,travelDegrees,withTravel,
  fieldFor,problems,modelById,describe,takeFrames,hex,sameSettings,Programmer,DeviceLost};
