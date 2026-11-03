'use strict';
// FTC Robocol: the UDP protocol between an FTC Driver Station and a Robot Controller
// (Control Hub or RC phone). Independent implementation of the documented wire format;
// shared by the desktop renderer, the browser preview, Node tests, and the robot simulator.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.Robocol=factory();})(typeof self!=='undefined'?self:this,function(){
const PORT=20884,HEADER=5,VERSION=124,STOP_OP_MODE='$Stop$Robot$';
const Msg={EMPTY:0,HEARTBEAT:1,GAMEPAD:2,PEER_DISCOVERY:3,COMMAND:4,TELEMETRY:5,KEEPALIVE:6};
const PeerType={NOT_SET:0,PEER:1,GROUP_OWNER:2,REJECTED:3};
const RobotStates={'-1':'UNKNOWN',0:'NOT_STARTED',1:'INIT',2:'RUNNING',3:'STOPPED',4:'EMERGENCY_STOP'};
const GamepadType={UNKNOWN:0,LOGITECH_F310:1,XBOX_360:2,SONY_PS4:3,SONY_PS4_SUPPORTED_BY_KERNEL:4};
// Bit order of the gamepad button word, most significant first.
const BUTTONS=['touchpad_finger_1','touchpad_finger_2','touchpad','left_stick_button','right_stick_button','dpad_up','dpad_down','dpad_left','dpad_right','a','b','x','y','guide','start','back','left_bumper','right_bumper'];
const AXES=['left_stick_x','left_stick_y','right_stick_x','right_stick_y','left_trigger','right_trigger'];
const Tags={BATTERY:'$Robot$Battery$Level$',RC_BATTERY:'$RobotController$Battery$Status$',ERROR:'$System$Error$',WARNING:'$System$Warning$',NONE:'$System$None$',NO_VOLTAGE:'$no$voltage$sensor$'};
const utf8=new TextEncoder(),text=new TextDecoder();

class Writer {
  constructor(size){this.bytes=new Uint8Array(size);this.view=new DataView(this.bytes.buffer);this.at=0;}
  u8(v){this.view.setUint8(this.at,v&255);this.at+=1;return this;}
  u16(v){this.view.setUint16(this.at,v&0xffff);this.at+=2;return this;}
  i32(v){this.view.setInt32(this.at,v|0);this.at+=4;return this;}
  i64(v){this.view.setBigInt64(this.at,BigInt.asIntN(64,BigInt(v)));this.at+=8;return this;}
  f32(v){this.view.setFloat32(this.at,Number(v)||0);this.at+=4;return this;}
  raw(b){this.bytes.set(b,this.at);this.at+=b.length;return this;}
}
class Reader {
  constructor(bytes,at=0){this.bytes=bytes;this.view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);this.at=at;}
  need(n){if(this.at+n>this.bytes.length)throw RangeError('Robocol packet is too short.');}
  u8(){this.need(1);return this.view.getUint8(this.at++);}
  i8(){this.need(1);return this.view.getInt8(this.at++);}
  u16(){this.need(2);const v=this.view.getUint16(this.at);this.at+=2;return v;}
  i32(){this.need(4);const v=this.view.getInt32(this.at);this.at+=4;return v;}
  i64(){this.need(8);const v=this.view.getBigInt64(this.at);this.at+=8;return v;}
  f32(){this.need(4);const v=this.view.getFloat32(this.at);this.at+=4;return v;}
  raw(n){this.need(n);const v=this.bytes.subarray(this.at,this.at+n);this.at+=n;return v;}
  str(n){return text.decode(this.raw(n));}
}
function header(type,payload,seq){return new Writer(HEADER+payload).u8(type).u16(payload).u16(seq);}

// PeerDiscovery keeps its historical 13-byte layout: the version and peer type come before the sequence number.
// The SDK this Driver Station speaks: FTC SDK 12.0, built September 2026. A Robot Controller checks the first discovery
// it receives once, so an earlier season here shows "The Driver Station app is obsolete" (SoftwareVersionWarningSource).
const SDK={month:9,year:2026,major:12,minor:0};
function encodePeerDiscovery({seq=0,version=VERSION,peerType=PeerType.PEER,month=SDK.month,year=SDK.year,major=SDK.major,minor=SDK.minor}={}){
  return new Writer(13).u8(Msg.PEER_DISCOVERY).u16(10).u8(version).u8(peerType).u16(seq).u8(month).u16(year).u8(major).u8(minor).u8(0).bytes;
}
function decodePeerDiscovery(bytes){
  if(bytes.length<13)throw RangeError('Peer discovery packet is too short.');
  const r=new Reader(bytes,3);const version=r.u8(),peerType=r.u8(),seq=r.u16(),month=r.u8(),year=r.u16(),major=r.u8(),minor=r.u8();
  return {type:Msg.PEER_DISCOVERY,version,peerType,seq,month,year,major,minor};
}
function encodeHeartbeat({seq=0,timestamp=0n,robotState=0,t0=0,t1=0,t2=0,timeZone='UTC'}){
  const tz=utf8.encode(timeZone).subarray(0,127);
  return header(Msg.HEARTBEAT,8+1+24+1+tz.length,seq).i64(timestamp).u8(robotState).i64(t0).i64(t1).i64(t2).u8(tz.length).raw(tz).bytes;
}
function decodeHeartbeat(r){const timestamp=r.i64(),robotState=r.i8(),t0=r.i64(),t1=r.i64(),t2=r.i64(),timeZone=r.str(r.u8());return {timestamp,robotState,t0:Number(t0),t1:Number(t1),t2:Number(t2),timeZone};}
function encodeGamepad(g){
  const w=header(Msg.GAMEPAD,60,g.seq||0).u8(5).i32(g.id??-1).i64(g.timestamp||0);
  for(const axis of AXES)w.f32(g[axis]);
  let buttons=0;for(const name of BUTTONS)buttons=(buttons<<1)|(g[name]?1:0);
  const type=g.gamepadType??GamepadType.UNKNOWN;
  return w.i32(buttons).u8(g.user??-1).u8(Math.min(type,GamepadType.SONY_PS4)).u8(type).f32(g.touchpad_finger_1_x).f32(g.touchpad_finger_1_y).f32(g.touchpad_finger_2_x).f32(g.touchpad_finger_2_y).bytes;
}
function decodeGamepad(r){
  const version=r.u8(),g={version,id:r.i32(),timestamp:Number(r.i64())};for(const axis of AXES)g[axis]=r.f32();
  const buttons=r.i32();BUTTONS.forEach((name,i)=>{g[name]=!!(buttons&(1<<(BUTTONS.length-1-i)));});
  if(version>=2)g.user=r.i8();if(version>=3)g.gamepadType=r.u8();if(version>=4)g.gamepadType=r.u8();
  if(version>=5){g.touchpad_finger_1_x=r.f32();g.touchpad_finger_1_y=r.f32();g.touchpad_finger_2_x=r.f32();g.touchpad_finger_2_y=r.f32();}
  return g;
}
function encodeCommand({seq=0,timestamp,acknowledged=false,name,extra=''}){
  const n=utf8.encode(name),x=utf8.encode(extra??'');
  const w=header(Msg.COMMAND,9+2+n.length+(acknowledged?0:2+x.length),seq).i64(timestamp).u8(acknowledged?1:0).u16(n.length).raw(n);
  if(!acknowledged)w.u16(x.length).raw(x);return w.bytes;
}
function decodeCommand(r){const timestamp=r.i64(),acknowledged=r.u8()!==0,name=r.str(r.u16());return {timestamp,acknowledged,name,extra:acknowledged?'':r.str(r.u16())};}
function encodeTelemetry({seq=0,timestamp=Date.now(),sorted=false,robotState=0,tag='',strings=[],numbers=[]}){
  const t=utf8.encode(tag),s=strings.map(([k,v])=>[utf8.encode(k),utf8.encode(String(v))]),n=numbers.map(([k,v])=>[utf8.encode(k),v]);
  const size=8+1+1+1+t.length+1+s.reduce((a,[k,v])=>a+4+k.length+v.length,0)+1+n.reduce((a,[k])=>a+6+k.length,0);
  const w=header(Msg.TELEMETRY,size,seq).i64(timestamp).u8(sorted?1:0).u8(robotState).u8(t.length).raw(t).u8(s.length);
  for(const [k,v]of s)w.u16(k.length).raw(k).u16(v.length).raw(v);w.u8(n.length);for(const [k,v]of n)w.u16(k.length).raw(k).f32(v);return w.bytes;
}
function decodeTelemetry(r){
  const timestamp=Number(r.i64()),sorted=r.u8()!==0,robotState=r.i8(),tag=r.str(r.u8()),strings=[],numbers=[];
  for(let i=r.u8();i>0;i--){const k=r.str(r.u16());strings.push([k,r.str(r.u16())]);}
  for(let i=r.u8();i>0;i--){const k=r.str(r.u16());numbers.push([k,r.f32()]);}
  return {timestamp,sorted,robotState,tag,strings,numbers};
}
function encodeKeepAlive({seq=0}={}){return header(Msg.KEEPALIVE,1,seq).u8(0).bytes;}
function decode(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);if(bytes.length<HEADER)throw RangeError('Robocol packet is too short.');
  const type=bytes[0];if(type===Msg.PEER_DISCOVERY)return decodePeerDiscovery(bytes);
  const length=(bytes[1]<<8)|bytes[2],seq=(bytes[3]<<8)|bytes[4],r=new Reader(bytes.subarray(0,Math.min(bytes.length,HEADER+length)),HEADER),base={type,seq};
  if(type===Msg.HEARTBEAT)return {...base,...decodeHeartbeat(r)};if(type===Msg.GAMEPAD)return {...base,...decodeGamepad(r)};
  if(type===Msg.COMMAND)return {...base,...decodeCommand(r)};if(type===Msg.TELEMETRY)return {...base,...decodeTelemetry(r)};
  return base;
}
function base64(value){const s=atob(String(value||'').replace(/\s+/g,''));const out=new Uint8Array(s.length);for(let i=0;i<s.length;i++)out[i]=s.charCodeAt(i);return out;}
function json(value,fallback=null){try{return JSON.parse(value);}catch{return fallback;}}
function robotStateName(v){return RobotStates[v]||'UNKNOWN';}
function atRest(g){return !g||(AXES.every(a=>Math.abs(g[a]||0)<0.0001)&&BUTTONS.every(b=>!g[b]));}

// Driver Station session: discovery, heartbeat/time sync, gamepads, reliable commands, robot state.
// `send(Uint8Array)` writes one datagram to the robot; feed received datagrams to `receive()`.
class DriverStation {
  constructor({send,clock=()=>Date.now(),monotonic=()=>(typeof performance!=='undefined'?performance.now():Date.now()),timeZone,sdk}={}){
    if(typeof send!=='function')throw TypeError('A datagram send function is required.');
    this.sendRaw=send;this.clock=clock;this.mono=monotonic;this.listeners={};this.timers=[];this.seq=Math.floor(Math.random()*0xffff);this.stamp=0n;
    this.timeZone=timeZone||(()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';}catch{return 'UTC';}})();
    this.identity={version:VERSION,month:sdk?.month||SDK.month,year:sdk?.year||SDK.year,major:sdk?.major??SDK.major,minor:sdk?.minor??SDK.minor};
    this.pending=[];this.seen=[];this.gamepads={1:null,2:null};this.synthetic={1:0,2:0};this.frames=null;this.lastReceive=0;this.lastHeartbeat=0;this.pings=new Map();
    this.state={connection:'idle',ping:null,robotState:'UNKNOWN',opModes:[],activeOpMode:STOP_OP_MODE,opModeState:'stopped',pendingAction:null,activeConfig:null,battery:null,rcBattery:null,
      telemetry:{lines:[],format:'CLASSIC',updated:0},systemError:'',systemWarning:'',robot:null,streamAvailable:false,adaptedVersion:false};
    this.lastStarted=null;
  }
  on(name,fn){(this.listeners[name]||=[]).push(fn);return()=>{this.listeners[name]=this.listeners[name].filter(f=>f!==fn);};}
  emit(name,value){for(const fn of this.listeners[name]||[])try{fn(value);}catch(e){if(typeof console!=='undefined')console.error(e);}}
  update(patch){Object.assign(this.state,patch);this.emit('state',this.state);}
  nextSeq(){this.seq=(this.seq+1)&0xffff;return this.seq;}
  // Command identity is (name, timestamp); keep timestamps unique and monotonic.
  nextStamp(){let t=BigInt(Math.round(this.mono()*1e6));if(t<=this.stamp)t=this.stamp+1n;this.stamp=t;return t;}
  transmit(bytes){try{this.sendRaw(bytes);}catch(e){this.emit('error',e);}}
  start(){
    if(this.timers.length)return;this.beat=0;this.update({connection:'searching'});this.discover();
    // Four times a second while searching, so a robot that has just come up answers within a quarter second; once a second when connected.
    this.timers.push(setInterval(()=>{if(!this.connected()||++this.beat%4===0)this.discover();},250),setInterval(()=>this.tick(),40));
  }
  stop(){for(const t of this.timers)clearInterval(t);this.timers=[];this.update({connection:'idle'});}
  discover(){this.transmit(encodePeerDiscovery({seq:this.nextSeq(),peerType:PeerType.PEER,...this.identity}));}
  connected(){return this.state.connection==='connected';}
  tick(){
    const now=this.mono();
    if(this.connected()&&now-this.lastReceive>2000){this.disconnected();return;}
    if(!this.connected())return;
    if(now-this.lastHeartbeat>=100){
      this.lastHeartbeat=now;const timestamp=this.nextStamp();this.pings.set(timestamp,now);if(this.pings.size>40)this.pings.delete(this.pings.keys().next().value);
      this.transmit(encodeHeartbeat({seq:this.nextSeq(),timestamp,robotState:0,t0:this.clock(),timeZone:this.timeZone}));
    }
    for(const user of [1,2]){
      const g=this.gamepads[user];
      if(g){if(Date.now()-g.timestamp>1000&&atRest(g))continue;this.transmit(encodeGamepad({...g,user,seq:this.nextSeq()}));}
      else if(this.synthetic[user]>0){this.synthetic[user]--;this.transmit(encodeGamepad({id:-2,user,timestamp:Date.now(),seq:this.nextSeq()}));}
    }
    this.flush(now);
  }
  flush(now=this.mono()){
    if(!this.connected())return;
    const keep=[];
    for(const c of this.pending){
      if(c.acknowledged){this.transmit(encodeCommand({...c,seq:c.seq}));continue;}
      if(c.attempts>10){this.emit('command-failed',c);continue;}
      if(!c.sentAt||now-c.sentAt>200){c.attempts++;c.sentAt=now;this.transmit(encodeCommand(c));}
      keep.push(c);
    }
    this.pending=keep;
  }
  disconnected(){
    this.pending=this.pending.filter(c=>!c.acknowledged);
    this.update({connection:'searching',ping:null,robotState:'UNKNOWN',battery:null,rcBattery:null,pendingAction:null,opModeState:'stopped',activeOpMode:STOP_OP_MODE});
    this.emit('disconnected');
  }
  command(name,extra=''){const c={name,extra,timestamp:this.nextStamp(),seq:this.nextSeq(),acknowledged:false,attempts:0,sentAt:0};this.pending.push(c);this.flush();return c;}
  initOpMode(name){this.update({pendingAction:'init'});return this.command('CMD_INIT_OP_MODE',name);}
  startOpMode(name){this.update({pendingAction:'start'});return this.command('CMD_RUN_OP_MODE',name);}
  stopOpMode(){this.update({pendingAction:'stop'});return this.command('CMD_INIT_OP_MODE',STOP_OP_MODE);}
  restartRobot(){return this.command('CMD_RESTART_ROBOT');}
  requestFrame(){return this.command('CMD_REQUEST_FRAME');}
  requestAbout(){return this.command('CMD_REQUEST_ABOUT_INFO');}
  // Emergency path used when the page is closing: send stop immediately, no retry loop available.
  shutdown(){if(!this.connected())return;if(this.state.activeOpMode!==STOP_OP_MODE||this.state.opModeState!=='stopped'){const c={name:'CMD_INIT_OP_MODE',extra:STOP_OP_MODE,timestamp:this.nextStamp(),acknowledged:false};for(let i=0;i<3;i++)this.transmit(encodeCommand({...c,seq:this.nextSeq()}));}for(const user of [1,2])if(this.gamepads[user])this.transmit(encodeGamepad({id:-2,user,timestamp:Date.now(),seq:this.nextSeq()}));}
  // `pad` is an FTC gamepad object without user; null releases the user (a synthetic at-rest pad is sent).
  setGamepad(user,pad){if(pad){this.gamepads[user]=pad;this.synthetic[user]=0;}else if(this.gamepads[user]){this.gamepads[user]=null;this.synthetic[user]=5;}}
  receive(input){
    let p;try{p=decode(input);}catch(e){this.emit('error',e);return;}
    this.lastReceive=this.mono();
    if(p.type===Msg.PEER_DISCOVERY)return this.onDiscovery(p);
    if(!this.connected())return;
    if(p.type===Msg.HEARTBEAT){const sent=this.pings.get(p.timestamp);if(sent!==undefined){this.pings.delete(p.timestamp);this.update({ping:Math.max(0,Math.round(this.mono()-sent)),robotState:robotStateName(p.robotState)});}}
    else if(p.type===Msg.COMMAND)this.onCommand(p);else if(p.type===Msg.TELEMETRY)this.onTelemetry(p);
  }
  onDiscovery(p){
    const robot={robocol:p.version,sdk:`${p.major}.${p.minor}`,built:p.month>=1&&p.month<=12?`${p.year}-${String(p.month).padStart(2,'0')}`:''};
    if(p.peerType===PeerType.REJECTED){this.update({connection:'rejected',robot});return;}
    if(p.version!==this.identity.version){
      // Match the robot's SDK generation; supported FTC SDK releases share these packet layouts.
      if(p.version<121){this.update({connection:'incompatible',robot});return;}
      Object.assign(this.identity,{version:p.version});this.update({adaptedVersion:true,robot});this.discover();return;
    }
    if(!this.connected()){
      this.lastReceive=this.mono();this.lastHeartbeat=0;this.update({connection:'connected',robot});this.emit('connected',robot);
      this.command('CMD_REQUEST_OP_MODE_LIST');this.command('CMD_REQUEST_ACTIVE_CONFIG');
    }
  }
  onCommand(c){
    if(c.acknowledged){this.pending=this.pending.filter(x=>x.acknowledged||!(x.name===c.name&&x.timestamp===c.timestamp));return;}
    this.pending.push({...c,acknowledged:true});this.flush();
    const id=c.name+'\0'+c.timestamp;if(this.seen.includes(id))return;this.seen.push(id);if(this.seen.length>200)this.seen.shift();
    this.handle(c.name,c.extra);
  }
  handle(name,extra){
    switch(name){
      case 'CMD_NOTIFY_OP_MODE_LIST':{const list=json(extra,[]);this.update({opModes:Array.isArray(list)?list.filter(m=>m&&m.name&&m.flavor!=='SYSTEM'):[]});break;}
      case 'CMD_NOTIFY_ACTIVE_CONFIGURATION':{const cfg=json(extra,{});this.update({activeConfig:cfg&&typeof cfg==='object'?{name:String(cfg.name||''),dirty:!!cfg.isDirty}:null});break;}
      case 'CMD_NOTIFY_INIT_OP_MODE':{
        const previous=this.state;const stopped=extra===STOP_OP_MODE;
        if(stopped&&previous.activeOpMode!==STOP_OP_MODE&&previous.opModeState==='running'){const ended=this.state.opModes.find(m=>m.name===previous.activeOpMode);this.emit('op-mode-ended',ended||{name:previous.activeOpMode});}
        if(!stopped&&extra!==previous.activeOpMode)this.update({telemetry:{...this.state.telemetry,lines:[],updated:Date.now()}});
        this.update({activeOpMode:extra,opModeState:stopped?'stopped':'init',pendingAction:null});break;
      }
      case 'CMD_NOTIFY_RUN_OP_MODE':this.update({activeOpMode:extra,opModeState:extra===STOP_OP_MODE?'stopped':'running',pendingAction:null});break;
      case 'CMD_NOTIFY_ROBOT_STATE':this.update({robotState:robotStateName(Number(extra))});break;
      case 'CMD_SET_TELEM_DISPL_FORMAT':if(['CLASSIC','MONOSPACE','HTML'].includes(extra))this.update({telemetry:{...this.state.telemetry,format:extra}});break;
      case 'CMD_SHOW_TOAST':{const t=json(extra,{message:extra});this.emit('toast',{message:String(t?.message??''),duration:Number(t?.duration)||0});break;}
      case 'CMD_SHOW_DIALOG':{const d=json(extra,{});this.emit('dialog',{id:String(d?.uuidString||''),title:String(d?.title||''),message:String(d?.message||'')});break;}
      case 'CMD_DISMISS_DIALOG':{const d=json(extra,{});this.emit('dismiss-dialog',String(d?.uuidString||''));break;}
      case 'CMD_DISMISS_ALL_DIALOGS':this.emit('dismiss-dialog','*');break;
      case 'CMD_SHOW_PROGRESS':{const d=json(extra,{});this.emit('progress',{message:String(d?.message||''),cur:Number(d?.cur)||0,max:Number(d?.max)||100});break;}
      case 'CMD_DISMISS_PROGRESS':this.emit('progress',null);break;
      case 'CMD_SHOW_STACKTRACE':this.emit('stacktrace',String(extra));break;
      case 'CMD_RUMBLE_EFFECT':{const r=json(extra,null);if(r&&Array.isArray(r.steps))this.emit('rumble',r);break;}
      case 'CMD_TEXT_TO_SPEECH':{const s=json(extra,null);if(s?.text)this.emit('speech',s);break;}
      case 'CMD_REQUEST_ABOUT_INFO_RESP':this.emit('about',json(extra,{}));break;
      case 'CMD_STREAM_CHANGE':this.update({streamAvailable:extra==='true'});break;
      case 'CMD_RECEIVE_FRAME_BEGIN':{const f=json(extra,null);if(f&&f.length>0&&f.length<8e6)this.frames={num:f.frameNum,length:f.length,chunks:[],received:0};break;}
      case 'CMD_RECEIVE_FRAME_CHUNK':{
        const f=json(extra,null),frame=this.frames;if(!f||!frame||f.frameNum!==frame.num||frame.chunks[f.chunkNum])break;
        const data=base64(f.encodedData);frame.chunks[f.chunkNum]=data;frame.received+=data.length;
        if(frame.received>=frame.length){const out=new Uint8Array(frame.received);let at=0;for(const c of frame.chunks){if(c){out.set(c,at);at+=c.length;}}this.frames=null;this.emit('frame',out.subarray(0,frame.length));}
        break;
      }
      default:this.emit('command',{name,extra});
    }
  }
  onTelemetry(t){
    const patch={robotState:robotStateName(t.robotState)},value=t.strings.find(([k])=>k===t.tag)?.[1];
    if(t.tag===Tags.BATTERY)patch.battery=value===Tags.NO_VOLTAGE?{volts:null}:{volts:Number.parseFloat(value)};
    else if(t.tag===Tags.RC_BATTERY){const [percent,charging]=String(value||'').split('|');patch.rcBattery={percent:Number(percent),charging:charging==='true'};}
    else if(t.tag===Tags.ERROR)Object.assign(patch,{systemError:value||'',systemWarning:''});
    else if(t.tag===Tags.WARNING)Object.assign(patch,{systemWarning:value||'',systemError:''});
    else if(t.tag===Tags.NONE)Object.assign(patch,{systemError:'',systemWarning:''});
    else if(!t.tag||t.tag==='TELEMETRY_DATA'){
      const strings=t.sorted?[...t.strings].sort((a,b)=>a[0].localeCompare(b[0])):t.strings;
      const lines=[...strings.map(([k,v])=>k.startsWith('\0')?v:`${k} : ${v}`),...t.numbers.map(([k,v])=>k.startsWith('\0')?String(v):`${k} : ${v}`)];
      patch.telemetry={...this.state.telemetry,lines,updated:Date.now()};
    }
    this.update(patch);
  }
}
return {PORT,VERSION,SDK,STOP_OP_MODE,Msg,PeerType,GamepadType,BUTTONS,AXES,Tags,encodePeerDiscovery,encodeHeartbeat,encodeGamepad,encodeCommand,encodeTelemetry,encodeKeepAlive,decode,atRest,robotStateName,DriverStation};
});
