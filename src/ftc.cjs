'use strict';
// UDP transport for the FTC Driver Station page. Robot Controllers always reply to port 20884,
// so the station binds that port on the interface that routes to the robot.
const dgram=require('node:dgram'),dns=require('node:dns/promises'),net=require('node:net');
const Robocol=require('../ui/ftc/robocol.js');
async function resolve(host){if(net.isIP(host)===4)return host;return (await dns.lookup(host,{family:4})).address;}
function localAddressFor(address){
  return new Promise(done=>{const s=dgram.createSocket('udp4');const finish=a=>{try{s.close();}catch{}done(a);};s.once('error',()=>finish('0.0.0.0'));s.connect(Robocol.PORT,address,()=>{let a='0.0.0.0';try{a=s.address().address;}catch{}finish(a);});});
}
class FtcSocket {
  constructor(host,{localAddress}={}){this.host=host;this.localAddress=localAddress;this.listeners=new Set();this.socket=null;}
  async open(){
    this.address=await resolve(this.host).catch(()=>{throw Error(`Could not find the robot address ${this.host}.`);});
    const local=this.localAddress||await localAddressFor(this.address),socket=dgram.createSocket('udp4');
    try{await new Promise((ok,fail)=>{socket.once('error',fail);socket.bind(Robocol.PORT,local,()=>{socket.off('error',fail);ok();});});}
    catch(e){try{socket.close();}catch{}if(e.code==='EADDRINUSE')throw Error('UDP port 20884 is in use by another program. Close other FTC Driver Station apps or emulators, then try again.');throw Error(`Could not open the FTC robot connection: ${e.message}`);}
    socket.on('message',(msg,from)=>{if(from.address===this.address&&from.port===Robocol.PORT)for(const fn of this.listeners)fn(new Uint8Array(msg.buffer,msg.byteOffset,msg.length));});
    socket.on('error',()=>{});this.socket=socket;return this;
  }
  onPacket(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  send(bytes){if(!this.socket||!(bytes instanceof Uint8Array)||bytes.length<5||bytes.length>65507)return;this.socket.send(bytes,Robocol.PORT,this.address,()=>{});}
  async close(){const s=this.socket;this.socket=null;this.listeners.clear();if(s)await new Promise(r=>{try{s.close(r);}catch{r();}});}
}
// Detects a Robot Controller by peer discovery; any discovery reply (including "another DS connected") is FTC.
async function probeFtc(host,{timeout=1500,localAddress}={}){
  let socket;try{socket=await new FtcSocket(host,{localAddress}).open();}catch(e){return {ftc:false,error:e.message};}
  return new Promise(done=>{
    let seq=1,finished=false;const finish=result=>{if(finished)return;finished=true;clearInterval(timer);clearTimeout(limit);void socket.close().then(()=>done(result));};
    socket.onPacket(bytes=>{try{const p=Robocol.decode(bytes);if(p.type===Robocol.Msg.PEER_DISCOVERY)finish({ftc:true,robocol:p.version,sdk:`${p.major}.${p.minor}`});}catch{}});
    const ping=()=>socket.send(Robocol.encodePeerDiscovery({seq:seq++}));ping();const timer=setInterval(ping,300),limit=setTimeout(()=>finish({ftc:false}),timeout);
  });
}
// FTC robots sit at fixed addresses on their own Wi-Fi: Control Hub 192.168.43.1, RC phone (Wi-Fi Direct) 192.168.49.1.
const FTC_ADDRESSES=['192.168.43.1','192.168.49.1'];
// Asks several addresses at once; resolves with the first one whose Robot Controller answers, or null.
async function findFtc(hosts=FTC_ADDRESSES,{timeout=1500}={}){
  // Listen on the interface that routes to the robot (as FtcSocket does): Linux refuses a wildcard bind
  // on 20884 while any other address holds that port.
  const local=hosts.length?await localAddressFor(hosts[0]):'0.0.0.0',socket=dgram.createSocket('udp4');
  try{await new Promise((ok,fail)=>{socket.once('error',fail);socket.bind(Robocol.PORT,local,()=>{socket.off('error',fail);ok();});});}catch{try{socket.close();}catch{}return null;}
  socket.on('error',()=>{});const targets=new Set(hosts);let seq=1;
  return new Promise(done=>{
    let finished=false;const finish=host=>{if(finished)return;finished=true;clearInterval(timer);clearTimeout(limit);try{socket.close(()=>done(host));}catch{done(host);}};
    socket.on('message',(msg,from)=>{if(from.port!==Robocol.PORT||!targets.has(from.address))return;try{if(Robocol.decode(new Uint8Array(msg)).type===Robocol.Msg.PEER_DISCOVERY)finish(from.address);}catch{}});
    const ping=()=>{const d=Robocol.encodePeerDiscovery({seq:seq++});for(const h of targets)socket.send(d,Robocol.PORT,h,()=>{});};ping();
    const timer=setInterval(ping,300),limit=setTimeout(()=>finish(null),timeout);
  });
}
// The same Driver Station link over the USB cable: Robocol packets go over a TCP connection that ADB forwards to the
// relay Deck runs on the hub while the cable is in (src/usb-relay/DeckUsbRelay.java), which passes them to the Robot
// Controller there. Each packet is a 2-byte length and the packet. connect: () => Promise<{port}> starts the relay and
// sets up the ADB forward to the hub's port 20885.
class UsbFtcSocket extends FtcSocket {
  constructor(connect,{label='Control Hub on USB',grace,held=false}={}){super('usb');this.connect=connect;this.grace=grace;this.held=held;this.using=false;this.host='usb';this.address=label;this.listeners=new Set();this.socket=null;this.buffer=Buffer.alloc(0);}
  // The relay passes one station's packets at a time, so the holder (usbHold) lets go while this one is open.
  async open(){if(!this.held&&!this.using){this.using=true;await usbHold.acquire();}try{return await this.openLink();}catch(e){this.free();throw e;}}
  free(){if(this.using){this.using=false;usbHold.release();}}
  async openLink(){
    const {port}=await this.connect(),net=require('node:net');this.buffer=Buffer.alloc(0);
    const socket=await new Promise((ok,fail)=>{const s=net.connect({host:'127.0.0.1',port},()=>{s.off('error',fail);ok(s);});s.once('error',e=>fail(Error(`Could not reach the Control Hub over the USB cable (${e.code||e.message}). Unplug the cable, plug it back in and try again.`)));});
    socket.setNoDelay(true);socket.on('error',()=>{});
    // ADB takes the connection on this computer whatever the hub has, and hangs up at once when nothing listens there.
    if(await new Promise(r=>{const t=setTimeout(()=>{socket.off('close',c);r(false);},this.grace??500),c=()=>{clearTimeout(t);r(true);};socket.once('close',c);}))
      throw Error('The Control Hub hung up on the USB cable. Unplug the cable, plug it back in and try again.');
    socket.on('data',chunk=>{this.buffer=Buffer.concat([this.buffer,chunk]);
      while(this.buffer.length>=2){const n=this.buffer.readUInt16BE(0);if(this.buffer.length<2+n)break;const msg=this.buffer.subarray(2,2+n);this.buffer=this.buffer.subarray(2+n);
        for(const fn of this.listeners)fn(new Uint8Array(msg.buffer,msg.byteOffset,msg.length));}});
    socket.on('close',()=>{if(this.socket===socket){this.socket=null;this.free();for(const fn of this.closers||[])fn();}});
    this.socket=socket;return this;
  }
  onPacket(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  onClose(fn){(this.closers??=new Set()).add(fn);return()=>this.closers.delete(fn);}
  send(bytes){if(!this.socket||!(bytes instanceof Uint8Array)||bytes.length<5||bytes.length>65507)return;const head=Buffer.alloc(2);head.writeUInt16BE(bytes.length);this.socket.write(Buffer.concat([head,Buffer.from(bytes.buffer,bytes.byteOffset,bytes.length)]));}
  async close(){const s=this.socket;this.socket=null;this.listeners.clear();if(s)await new Promise(r=>{s.once('close',r);s.end();setTimeout(r,500);});this.free();}
}
// USB comes first. A Robot Controller keeps the Driver Station it has until that one has been silent for about two seconds, then
// takes whichever asks next (measured on a Control Hub, SDK 11.2: still ours after 1 s of silence, a Driver Hub's after 2.5 s). Torque
// talks to the robot in short sessions, so between them a Driver Station on the robot's Wi-Fi would get it back and the next
// session would be refused. While nothing else is using the cable, this keeps a station connected through the relay, which is all
// it does: it starts nothing and sends no commands of its own beyond what any station sends on connecting.
// enable(connect): connect as UsbFtcSocket takes it, and must not start the Robot Controller app. It holds from the first time
// something used the cable, tries a few times when the link drops (the cable was pulled), and waits for the next use after that.
class UsbHold {
  constructor(){this.connect=null;this.users=0;this.link=null;this.chain=Promise.resolve();this.timer=null;this.tries=0;this.armed=false;}
  enable(connect){this.connect=connect||null;if(!connect)return this.queue(()=>this.down());}
  holding(){return !!this.link&&this.link.ds.connected();}
  queue(fn){const p=this.chain.then(fn,fn);this.chain=p.catch(()=>{});return p;}
  acquire(){this.users++;this.armed=true;return this.queue(()=>this.down());}
  release(){this.users=Math.max(0,this.users-1);if(!this.users){this.tries=0;void this.queue(()=>this.up());}}
  retry(){clearTimeout(this.timer);if(++this.tries>5)return;this.timer=setTimeout(()=>void this.queue(()=>this.up()),3000);this.timer.unref?.();}
  async up(){
    if(!this.connect||!this.armed||this.users||this.link)return;const socket=new UsbFtcSocket(this.connect,{held:true});
    try{await socket.open();}catch{this.retry();return;}
    if(this.users||!this.connect){await socket.close();return;}
    const ds=new Robocol.DriverStation({send:bytes=>socket.send(bytes)});socket.onPacket(bytes=>ds.receive(bytes));
    socket.onClose(()=>{if(this.link?.socket===socket){ds.stop();this.link=null;this.retry();}});ds.start();this.link={socket,ds};this.tries=0;}
  async down(){clearTimeout(this.timer);const l=this.link;this.link=null;if(l){l.ds.stop();await l.socket.close();}}
}
const usbHold=new UsbHold();
module.exports={usbHold,UsbHold,FtcSocket,UsbFtcSocket,probeFtc,findFtc,FTC_ADDRESSES};
