'use strict';
// A simulated SWYFT programmer with a servo on it, for tests: it echoes every byte sent (TX and RX share the servo's signal
// wire), answers a read with the servo's settings and a write with an acknowledgement, the way src/swyft-servo.cjs reads
// SWYFT's app. The real servo answers in about 200 ms; this one answers after replyMs.
const S=require('../../src/swyft-servo.cjs');
// What the real SWYFT Speed servo held when first read (2026-11-13): 320° travel, stall protection on.
const REAL={p:19,i:13,d:47,integralSpeed:0,minSignal:500,maxSignal:2500,middleSignal:1500,deadZone:0,maxPower:500,left:130,right:130,reverse:false,stall:true,ramp:false};

function reply(settings,flag){const f=S.writeFrame(settings);f[3]=(f[3]&~S.FLAG.write)|flag;f[18]=S.checksum(f);return f;}

class SimLink{
  constructor({settings=REAL,servo=true,replyMs=5,ackFlag=S.FLAG.ack,keeps=true}={}){
    Object.assign(this,{settings:{...settings},servo,replyMs,ackFlag,keeps});this.inbox=[];this.sent=[];this.writes=[];this.closed=false;this.lost=false;this.waiters=[];
  }
  push(bytes){this.inbox.push(Buffer.from(bytes));for(const w of this.waiters.splice(0))w();}
  async write(bytes){
    if(this.lost)throw new S.DeviceLost('The port went away.');const tx=Buffer.from(bytes);this.sent.push(tx);this.push(tx);
    if(!this.servo||!S.validFrame(tx))return;
    let back;
    if(tx[3]&S.FLAG.write){const next=S.decode(tx);this.writes.push(next);if(this.keeps)this.settings={...next};back=reply(this.settings,this.ackFlag);}
    else back=reply(this.settings,S.FLAG.reply);
    setTimeout(()=>this.push(back),this.replyMs);
  }
  async read(timeoutMs){
    if(this.lost)throw new S.DeviceLost('The port went away.');
    if(!this.inbox.length)await new Promise(r=>{const t=setTimeout(r,timeoutMs);this.waiters.push(()=>{clearTimeout(t);r();});});
    if(!this.inbox.length)return null;const all=Buffer.concat(this.inbox);this.inbox=[];return all;
  }
  async flush(){this.inbox=[];}
  async close(){this.closed=true;}
  reads(){return this.sent.filter(f=>S.validFrame(f)&&!(f[3]&S.FLAG.write)).length;}
}
// A transport with one SWYFT programmer on `port`, plus any other USB serial ports given. plugged=false takes it away.
function simTransport(link,{port='COM8',others=[],rivals=[],held=false}={}){
  const t={supported:true,plugged:true,rivalsNow:rivals,held,opened:0,
    ports:async()=>[...(t.plugged?[{port,vid:0x10C4,pid:0xEA60,name:`Silicon Labs CP210x USB to UART Bridge (${port})`,serial:'0001'}]:[]),...others],
    rivals:async()=>t.rivalsNow,closeRivals:async()=>{t.rivalsNow=[];},
    open:async info=>{if(t.held)throw Object.assign(Error(`${info.port} is open in another program.`),{busy:true});t.opened++;link.lost=false;return link;},
    stop:()=>{}};
  return t;
}
module.exports={SimLink,simTransport,REAL,reply};
