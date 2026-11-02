'use strict';
// A software stand-in for Axon's V2 programmer with a servo attached, moved from Axon Bridge's Sim.cs and built to the protocol read
// from Axon's official apps. It is what the Axon tests run against: it proves Torque's logic, not that real hardware behaves this way.
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const S=require('../../src/axon-servo.cjs');

function makeBlock(family,mode,name){
  if(family==='v1'){const b=Buffer.alloc(95);Buffer.from([0x3B,0xD0,0x0B,0xF6]).copy(b);b[4]=b[5]=202;b[6]=128;b[9]=77;b[0x0B]=100;b[0x0C]=0x20;b[0x0F]=235;b[0x11]=b[0x12]=b[0x13]=255;b[0x25]=mode==='cr'?0:0x90;b[0x28]=100;b[0x2A]=100;b[0x2C]=100;b[0x30]=12;b[0x31]=3;b[0x32]=23;
    b[0x35]=153;b[0x36]=mode==='cr'?60:15;b[0x37]=102;b[0x38]=49;b[0x39]=74;b[0x3A]=103;Buffer.from((name+'********').slice(0,8),'latin1').copy(b,0x40);b[90]=0x5A;return b;}
  const v=Buffer.alloc(59);Object.assign(v,{0:40,1:60,2:mode==='cr'?100:50,3:9,6:255,7:20,8:90,9:90,10:1,12:153,13:102,14:51,15:mode==='cr'?60:65,16:65,17:136,26:1,44:12,45:3,46:25});
  Buffer.from('USER_DEF****','latin1').copy(v,32);Buffer.from((name+'************').slice(0,12),'latin1').copy(v,47);return v;
}
class SimLink{
  constructor(family,mode,name,options={}){Object.assign(this,{family,mode,name,attached:true,powerOn:false,modelA:0x08,modelB:family==='v1'?0x01:0x22,rejectSecondChunk:false,noLengthEcho:false,readsFail:false,writesIgnored:false,failOnDataRecord:-1,attachOnExit:false,comeBack:true,volts:0x040C,amps:20,inputPulse:0},options);
    this.block=makeBlock(family,mode,name);this.inbox=[];this.key=Buffer.alloc(22);this.marker=-1;this.sessionRecords=0;Object.assign(this,{writeFrames:0,eraseRecords:0,dataRecords:0,badRecords:0,bootEntries:0,exitFrames:0,flashedBytes:0,lastWrites:[]});}
  async flush(){this.inbox.length=0;}
  async close(){this.closed=true;}
  async write(tx){const r=Buffer.alloc(64);r[0]=4;
    switch(tx[1]){
      case 0x91:r[1]=1;r[5]=0x22;break;
      case 0xAF:r[4]=0xAF;r[5]=0x05;r[6]=0xDC;r[9]=this.volts>>8;r[10]=this.volts&255;r[14]=this.amps;r[15]=2;r[16]=this.powerOn?3:0;if(this.inputPulse){r[19]=1;r[20]=0x4E;r[21]=0x20;r[22]=this.inputPulse>>8;r[23]=this.inputPulse&255;}break;
      case 0xB0:this.powerOn=tx[3]===1;r[1]=1;break;
      case 0x8A:r[4]=0x8A;if(this.attached&&this.powerOn&&!this.rebooting){r[1]=1;if(this.family==='v1'){r[5]=this.mode==='cr'?4:3;r[6]=1;r[7]=1;r[8]=0x0A;}else{r[5]=0x34;r[6]=this.mode==='cr'?0x31:0x11;r[7]=0x22;r[8]=5;}}break;
      case 0xCD:{const addr=(tx[2]<<8)|tx[3],len=tx[4];r[4]=this.noLengthEcho?0:len;if(this.readsFail||!this.attached||(this.rejectSecondChunk&&addr>=59)){r[1]=0;r[2]=1;break;}r[1]=1;this.block.copy(r,5,addr,Math.min(addr+len,this.block.length));break;}
      case 0xCB:{const addr=(tx[2]<<8)|tx[3],len=tx[4];this.writeFrames++;r[1]=1;r[4]=len;this.lastWrites.push({addr,len});if(!this.writesIgnored)tx.copy(this.block,addr,5,5+Math.min(len,this.block.length-addr));break;}
      case 0x5A:r[1]=1;r[4]=0x5A;r[5]=0xAA;this.block=makeBlock(this.family,this.mode,this.name);break;
      case 0x80:this.bootEntries++;r[1]=1;r[5]=0x56;r[6]=0x31;r[7]=0x30;r[8]=0x33;r[9]=this.modelA;r[10]=this.modelB;break;
      case 0x81:{this.sessionRecords=0;r[1]=1;const s=crypto.randomBytes(22);for(let i=0;i<22;i++){r[5+i]=s[i];this.key[i]=tx[3+i]^s[i];}break;}
      case 0x82:{const d=Buffer.alloc(22);for(let i=0;i<22;i++)d[i]=tx[3+i]^this.key[i];r[1]=1;
        if(d[0]===0x0A){this.eraseRecords++;r[5]=0x55;}
        else if(d[0]===0x3A){const count=d[1];if(count>16){this.badRecords++;break;}let sum=0;for(let i=1;i<5+count;i++)sum+=d[i];r[5]=(-sum)&255;if(this.sessionRecords===0)this.marker=d[5];this.sessionRecords++;this.dataRecords++;this.flashedBytes+=count;if(this.dataRecords===this.failOnDataRecord)r[5]^=0xFF;}
        else this.badRecords++;break;}
      case 0x83:this.exitFrames++;r[1]=1;if(this.marker>=0){this.mode=this.marker===0xC1?'cr':'servo';this.block=makeBlock(this.family,this.mode,this.name);this.marker=-1;if(!this.comeBack)this.attached=false;}if(this.attachOnExit)this.attached=true;break;
      default:r[1]=0;r[2]=0xFF;}
    this.inbox.push(r);return true;}
  async read(){return this.inbox.shift()||null;}
}
// The service's transport around one SimLink. rivalTitles stands for Axon's app or Axon Bridge being open.
function simTransport(link,{v1Programmer=false,bootMode=false,silent=false}={}){
  const t={link,plugged:true,rivalTitles:[],supported:true,v1Programmer,bootMode,silent,opened:0,
    find:async vid=>vid===S.VID_V2&&t.plugged?[{path:'sim',vid,pid:S.PID,version:0x0102,inLen:64,outLen:64,product:'Simulated V2 programmer',maker:'Test',serial:'SIM1'}]:vid===S.VID_V1&&t.v1Programmer?[{path:'sim-v1',vid,pid:S.PID}]:vid===S.VID_BOOT&&t.bootMode?[{path:'sim-boot',vid,pid:S.PID}]:[],
    rivals:async()=>t.rivalTitles,closeRivals:async()=>{t.rivalTitles=[];},
    open:async()=>{t.opened++;if(t.silent)return {write:async()=>true,read:async()=>null,flush:async()=>{},close:async()=>{}};return link;},stop(){}};
  return t;
}
// A synthetic firmware file in the real format, for testing only. Its first data byte says which mode the simulated servo takes.
function firmwareText(a,b,name,mode,records){let s=`@${a.toString(16).padStart(2,'0').toUpperCase()}${b.toString(16).padStart(2,'0').toUpperCase()}${name}\r\n$0800\r\n$0900\r\n`;
  for(let r=0;r<records;r++){const d=Buffer.alloc(16);for(let i=0;i<16;i++)d[i]=r*7+i;d[0]=mode==='cr'?0xC1:0x51;const addr=r*16;let sum=16+(addr>>8)+(addr&255);s+=`:10${addr.toString(16).padStart(4,'0').toUpperCase()}00`;for(const x of d){s+=x.toString(16).padStart(2,'0').toUpperCase();sum+=x;}s+=`${((-sum)&255).toString(16).padStart(2,'0').toUpperCase()}\r\n`;}
  return s+':00000001FF\r\n';}
// Keys made up for these tests: they open only the fake files below.
const TEST_KEYS={v1:'11'.repeat(16),v2:'22'.repeat(16)};
const crypt=(key,mode,data)=>{const c=crypto.createCipheriv(mode,key,mode==='aes-128-cbc'?Buffer.alloc(16):null);c.setAutoPadding(false);return Buffer.concat([c.update(data),c.final()]);};
const pad16=d=>{const p=Buffer.alloc(Math.ceil(d.length/16)*16);d.copy(p);return p;};
function encryptV1(text){const plain=Buffer.from(text,'latin1'),key=Buffer.from(TEST_KEYS.v1,'hex'),head=Buffer.alloc(16);head.writeInt32LE(plain.length,0);head[4]=head[5]=0x78;return Buffer.concat([crypt(key,'aes-128-ecb',head),crypt(key,'aes-128-cbc',pad16(plain))]);}
function encryptV2(text){return Buffer.concat([Buffer.alloc(16),crypt(Buffer.from(TEST_KEYS.v2,'hex'),'aes-128-cbc',pad16(Buffer.from(text,'latin1')))]);}
// Fake mode files with the real servos' names under the real file names, and a catalog without hashes to go with them.
function installFirmware(dir){fs.mkdirSync(dir,{recursive:true});
  return S.FIRMWARE.map(f=>{const model=S.modelByCode(f.code),v1=f.fileName.endsWith('.sfw'),text=firmwareText(0x08,v1?1:0x22,model.factoryName,f.mode,120);fs.writeFileSync(path.join(dir,f.fileName),v1?encryptV1(text):encryptV2(text));return {...f,sha256:null};});}
module.exports={TEST_KEYS,SimLink,simTransport,makeBlock,firmwareText,encryptV1,encryptV2,installFirmware};
