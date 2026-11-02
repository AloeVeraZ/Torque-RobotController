'use strict';
// Where the Control Hub is on this computer's USB, as it changes. Three layers, quickest first: Windows says a device came or went (the
// small helper in src/usb-watch, which waits on Windows and uses no CPU), then ADB says what state it is in (adb track-devices, which ADB's
// server pushes), and only after that does the page read the hub. Each change goes to onChange at once, as state() below: new fields can
// join it without touching what is there. It runs only between start and stop, while a tab that works with the hub shows. Where the helper
// cannot run, ADB alone keeps it going, with no word to the student; status() then says null, and the caller asks ADB on its old timer.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const HELPER=path.join(__dirname,'usb-watch','UsbWatch.exe'),LINGER_MS=2000,STEADY_MS=10000,UNSEEN_MS=10000,LOG_MAX=64*1024,BACKOFF_MS=[250,500,1000,2000,5000,15000,30000];
const lower=s=>String(s||'').toLowerCase();
// What a USB device is from Windows's word alone, measured from this computer's records (research_notes/Control Hub USB devices/findings.md,
// section 7). 2207:0011 is a Control Hub on Android and 2207:0017 a Driver Hub. 2207:0006 is a Driver Hub starting up or a Control Hub in fastboot,
// and 0010, 0012 to 0015 are other USB modes, so those go by what the device calls itself; with no name, a Control Hub's serial is 16 hex digits.
// 0403:6015 is an Expansion Hub on the computer, or any FT-X cable. 18d1:d00d is a Driver Hub in fastboot, but also any phone's: nothing to go on.
const usbKind=d=>{if(d.vid==='0403'&&d.pid==='6015')return 'expansion-hub';if(d.vid!=='2207')return null;if(d.pid==='0011')return 'control-hub';if(d.pid==='0017')return 'driver-hub';
  const update=d.pid==='0006';if(!update&&!['0010','0012','0013','0014','0015'].includes(d.pid))return null;if(/driver hub/i.test(d.name||''))return 'driver-hub';
  return d.name||/^[0-9a-f]{16}$/i.test(d.serial)?(update?'control-hub-update':'control-hub'):null;};
// Once ADB answers it has the final word, whatever Windows said: a Driver Hub is never the Control Hub.
const isDriverHub=d=>d.model==='Driver_Hub';
// The second half of "Control Hub plugged in." for each way it is not ready yet.
const plugWords=state=>state==='unauthorized'?'Allow this computer in the REV Hardware Client.':state==='update'?'It is in update mode, so Torque cannot read it until it restarts.':'Waiting for it to answer…';

// \\?\USB#VID_2207&PID_0011#24677C4269E7E709#{a5dcbf10-...} -> {vid, pid, serial}. A root hub or one function of a composite device is no device here.
function parseDevicePath(name){const m=/^\\\\[?.]\\USB#VID_([0-9A-F]{4})&PID_([0-9A-F]{4})#([^#]+)#\{/i.exec(String(name||''));return m?{vid:lower(m[1]),pid:lower(m[2]),serial:m[3]}:null;}
const deviceKey=d=>`${d.vid}:${d.pid}:${lower(d.serial)}`;
// One line from the helper: {kind: list, ready, add, remove or error, at, device or message}, or null for anything else. A device's name follows a tab.
function parseHelperLine(line){const text=String(line).trim();let m;
  if((m=/^ready (\d+)$/.exec(text)))return {kind:'ready',at:+m[1]};
  if((m=/^err (.*)$/.exec(text)))return {kind:'error',message:m[1]};
  if((m=/^([=+-]) (\d+) ([^\t]+)(?:\t(.*))?$/.exec(text))){const device=parseDevicePath(m[3]);return device?{kind:{'=':'list','+':'add','-':'remove'}[m[1]],at:+m[2],device:{...device,name:m[4]?.trim()||''}}:null;}
  return null;}
// "<serial> <state> product:... model:... device:..." lines. Long output pads the serial with spaces; short output uses a tab.
const parseAdbList=text=>String(text).split(/\r?\n/).map(l=>/^(\S+)\s+(\S+)(.*)$/.exec(l.trim())).filter(Boolean).map(m=>({serial:m[1],state:m[2],model:/\bmodel:(\S+)/.exec(m[3])?.[1]||null}));
// adb track-devices says the whole list each time it changes: four hex digits of length, then the list. On Windows its \n comes out as
// \r\n after that length was counted, so \r never counts.
function trackReader(onList){let text='';return chunk=>{text+=(Buffer.isBuffer(chunk)?chunk.toString('latin1'):String(chunk)).replace(/\r/g,'');
  for(;;){text=text.replace(/^\s+/,'');const head=text.slice(0,4);if(head.length<4)return;if(!/^[0-9a-f]{4}$/i.test(head)){text='';return;}const n=parseInt(head,16);if(text.length<4+n)return;onList(parseAdbList(text.slice(4,4+n)));text=text.slice(4+n);}};}
// Which device is the Control Hub. usb: Windows's list can be trusted. notHubs: serials known to be a Driver Hub. gone: serials Windows
// says left, which ADB may list for a moment longer. state: ADB's word on it, null before ADB has one, or update for fastboot, where ADB has none.
// current: the hub so far, which stays the hub while it is there, whatever else comes and however the lists are ordered: its live debug must not end because another device said hello.
function findHub({usb,devices,adb,notHubs=new Set(),gone=new Set(),current=null}){
  const robots=adb.filter(d=>!isDriverHub(d)&&!notHubs.has(lower(d.serial)));
  if(usb){const on=d=>robots.find(r=>lower(r.serial)===lower(d.serial)),hubs=devices.filter(d=>{const kind=usbKind(d);return kind!=='driver-hub'&&!notHubs.has(lower(d.serial))&&(kind==='control-hub'||kind==='control-hub-update'||on(d));}),u=(current&&hubs.find(d=>deviceKey(d)===current.key||lower(d.serial)===lower(current.serial)))||hubs.find(d=>on(d)?.state==='device')||hubs.find(on)||hubs[0];
    if(u){// A device with no serial of its own gets one made up by Windows, which ADB cannot match: with one of each, they are the same.
      const update=usbKind(u)==='control-hub-update',lone=hubs.length===1&&!update?robots.filter(r=>!r.serial.includes(':')&&!gone.has(lower(r.serial))&&!devices.some(d=>lower(d.serial)===lower(r.serial))):[],a=on(u)||(lone.length===1?lone[0]:null);
      return {serial:a?.serial||lower(u.serial),state:a?.state||(update?'update':null),update,model:a?.model||null,name:u.name||null,vid:u.vid,pid:u.pid,usb:true,key:deviceKey(u)};}}
  // ADB sees it and Windows does not name it: a hub over the network, or a computer without the helper.
  const left=robots.filter(r=>!(usb&&gone.has(lower(r.serial)))),a=(current&&left.find(r=>lower(r.serial)===lower(current.serial)))||left.find(r=>r.state==='device')||left[0];
  return a?{serial:a.serial,state:a.state,update:false,model:a.model,name:null,vid:null,pid:null,usb:false,key:null}:null;}

class UsbWatch{
  // adbPath: () => the path to run. onChange(state): each change, at once. onGone(serial): that hub has left, before onChange hears it. onQuit(): the watch has really stopped.
  // logFile: a small file of timed events, for reading real latencies. start, now: stand-ins for tests. unseenMs: how long ADB gets to list a hub again after both layers lost sight of it.
  constructor({helper=HELPER,adbPath=()=>'adb',onChange=()=>{},onGone=()=>{},onQuit=()=>{},logFile=null,start=spawn,supported=process.platform==='win32',now=Date.now,unseenMs=UNSEEN_MS}={}){
    Object.assign(this,{helper,adbPath,onChange,onGone,onQuit,logFile,run:start,supported,now,unseenMs});
    this.unseen=null;this.wanted=false;this.devices=new Map();this.notHubs=new Set();this.gone=new Set();this.adbList=[];this.usbLive=false;this.adbLive=false;this.hub=null;this.seq=0;this.sent='';this.tries={helper:0,track:0};this.timers={};this.event=null;}
  // The watch is wanted: runs it, or keeps it if it was only just let go. Answers with what is known now.
  start(){clearTimeout(this.timers.linger);this.timers.linger=null;this.wanted=true;this.runHelper();this.runTrack();return this.state();}
  // Not wanted now. It lingers a moment: going between tabs is one stop and one start.
  stop(){this.wanted=false;clearTimeout(this.timers.linger);this.timers.linger=setTimeout(()=>this.quit(),LINGER_MS);this.timers.linger.unref?.();return null;}
  quit(){this.wanted=false;for(const t of Object.values(this.timers))clearTimeout(t);this.timers={};const helper=this.helperChild,track=this.trackChild;this.helperChild=this.trackChild=null;
    try{helper?.stdin.end();}catch{}if(helper)setTimeout(()=>{try{helper.kill();}catch{}},1500).unref?.();try{track?.kill();}catch{}
    this.usbLive=this.adbLive=false;this.pending=null;this.devices.clear();this.gone.clear();this.adbList=[];this.hub=null;this.unseen=null;this.sent='';this.tries={helper:0,track:0};try{this.onQuit();}catch{}}
  state(){return {seq:this.seq,at:this.now(),usb:this.usbLive,devices:[...this.devices.values()].map(d=>({...d,kind:usbKind(d)})),hub:this.hub&&(({key,...hub})=>hub)(this.hub),adb:{running:this.adbLive,devices:this.adbList},status:this.status()};}
  // The answer the rest of the app knows from robot-link's usbStatus, or null when both layers are not up, so ADB has to be asked.
  status(){if(!this.usbLive||!this.adbLive)return null;const h=this.hub;if(!h)return {found:false,message:'Not plugged in.'};if(h.state==='device')return {found:true,serial:h.serial};
    return {found:false,plugged:true,state:h.state,message:`Control Hub plugged in. ${plugWords(h.state)}`};}
  // What ADB said when it had to be asked, for a hub Windows can see.
  withPoll(p){if(p?.found||!this.usbLive||!this.hub)return p;return {found:false,plugged:true,state:this.hub.state,message:`Control Hub plugged in. ${/USB tool/.test(p?.message)&&!this.hub.update?p.message:plugWords(/Allow this computer/.test(p?.message)?'unauthorized':this.hub.state)}`};}
  // ---- the helper
  runHelper(){if(!this.supported||!this.wanted||this.helperChild||this.timers.helper)return;
    let child;try{child=this.run(this.helper,[],{windowsHide:true,stdio:['pipe','pipe','ignore']});}catch{return this.helperGone(null);}
    const born=this.now();this.helperChild=child;let text='';child.stdin?.on('error',()=>{});
    // A helper let go can still say something on its way out: by then it speaks for nobody, and it must not bring back a hub that has since been pulled.
    child.stdout?.on('data',d=>{if(this.helperChild!==child)return;text+=d.toString('latin1');for(let at;(at=text.indexOf('\n'))>=0;text=text.slice(at+1))this.helperLine(text.slice(0,at));});
    const gone=()=>{if(this.helperChild===child)this.helperGone(born);};child.on('error',gone);child.on('exit',gone);}
  helperGone(born){this.helperChild=null;this.usbLive=false;this.pending=null;this.devices.clear();this.gone.clear();this.log('helper stopped');this.publish('helper');this.retry('helper',born,()=>this.runHelper());}
  helperLine(line){const got=this.now(),e=parseHelperLine(line);if(!e)return;
    // A Driver Hub is known as soon as Windows says, and stays known by its serial, for when ADB lists it with no model.
    if(e.device&&e.kind!=='remove'&&usbKind(e.device)==='driver-hub')this.notHubs.add(lower(e.device.serial));
    if(e.kind==='list'){(this.pending??=new Map()).set(deviceKey(e.device),e.device);return;}
    if(e.kind==='ready'){const was=this.devices,hub=this.hub,now=this.pending||new Map();this.pending=null;this.devices=now;this.usbLive=true;for(const [k,d] of was)if(!now.has(k))this.left(k,d,hub);for(const [k,d] of now)if(!was.has(k))this.gone.delete(lower(d.serial));
      this.publish('ready',{helper:e.at,got,text:`ready: ${now.size} devices`});return;}
    if(e.kind==='error'){this.log(`helper: ${e.message}`);return;}
    const k=deviceKey(e.device),text=`${e.kind==='add'?'+':'-'} ${e.device.vid}:${e.device.pid} ${e.device.serial}`;
    if(e.kind==='add'){this.devices.set(k,e.device);this.gone.delete(lower(e.device.serial));this.publish('+',{helper:e.at,got,text});}
    else{const hub=this.hub;this.devices.delete(k);this.left(k,e.device,hub);this.publish('-',{helper:e.at,got,text});}}
  left(key,device,hub){if(hub?.key===key)this.gone.add(lower(hub.serial));if(this.adbList.some(d=>lower(d.serial)===lower(device.serial)))this.gone.add(lower(device.serial));}
  // ---- ADB's own view, pushed by its server. Its child ends if the server restarts.
  runTrack(){if(!this.wanted||this.trackChild||this.timers.track)return;
    let child;try{child=this.run(this.adbPath(),['track-devices','-l'],{windowsHide:true,stdio:['ignore','pipe','ignore']});}catch{return this.trackGone(null);}
    const born=this.now();this.trackChild=child;const read=trackReader(list=>{if(this.trackChild===child)this.adbSaid(list);});child.stdout?.on('data',read);
    const gone=()=>{if(this.trackChild===child)this.trackGone(born);};child.on('error',gone);child.on('exit',gone);}
  trackGone(born){this.trackChild=null;this.adbLive=false;this.adbList=[];this.gone.clear();this.publish('adb');this.retry('track',born,()=>this.runTrack());}
  adbSaid(list){const got=this.now(),changed=JSON.stringify(list)!==JSON.stringify(this.adbList);this.adbLive=true;this.adbList=list;for(const d of list)if(isDriverHub(d))this.notHubs.add(lower(d.serial));
    for(const s of [...this.gone])if(!list.some(d=>lower(d.serial)===s))this.gone.delete(s);
    // ADB saw a change: Windows should have said something too, so its list is read again. A missed event costs a moment, not a stuck screen.
    if(changed&&this.usbLive){try{this.helperChild?.stdin.write('list\n');}catch{}}
    this.publish('adb',{got,text:`adb: ${list.map(d=>`${d.serial} ${d.state}`).join(', ')||'nothing'}`});}
  retry(which,born,again){if(!this.wanted)return;if(born!==null&&this.now()-born>=STEADY_MS)this.tries[which]=0;const ms=BACKOFF_MS[Math.min(this.tries[which]++,BACKOFF_MS.length-1)];
    this.timers[which]=setTimeout(()=>{this.timers[which]=null;again();},ms);this.timers[which].unref?.();}
  // ---- telling
  publish(why,event){const was=this.hub,hub=findHub({usb:this.usbLive,devices:[...this.devices.values()],adb:this.adbList,notHubs:this.notHubs,gone:this.gone,current:was}),text=JSON.stringify({usb:this.usbLive,devices:[...this.devices.keys()],hub,adbLive:this.adbLive,adb:this.adbList});this.hub=hub;
    if(!this.usbLive&&!this.adbLive&&was&&!hub)this.unseen=was;if(hub){this.unseen=null;clearTimeout(this.timers.unseen);this.timers.unseen=null;}
    if(!this.wanted)return;const lost=this.lostSight(why,hub);if(text===this.sent&&!lost)return;this.sent=text;
    // Windows and ADB both gone says nothing about the hub. A Driver Hub found out is no hub that left, and leaving update mode is most likely a restart.
    const same=hub&&was&&(lower(hub.serial)===lower(was.serial)||(hub.key&&hub.key===was.key)),left=was&&!same&&(this.usbLive||this.adbLive)?was:lost,drop=!left?null:this.notHubs.has(lower(left.serial))?'driver-hub':left.update?'restarting':'unplugged';
    if(drop==='unplugged'){try{this.onGone(left.serial);}catch{}}
    this.seq++;const state={...this.state(),why,drop};try{this.onChange(state);}catch{}
    if(event){const pushed=this.now();this.event={seq:this.seq,helper:event.helper,got:event.got,pushed};this.log(`${event.text}${event.helper?` helper=${event.helper}`:''} main=${event.got} pushed=${pushed} seq=${this.seq} hub=${hub?`${hub.serial}/${hub.state||'-'}`:'none'}${drop?` drop=${drop}`:''}`);}}
  // Both layers lost sight of a hub, as when ADB's server restarts, and now one is back without it. Windows's word is final. ADB's first list after a restart is often empty, so it
  // gets time to list the hub again, and only then has the hub left: a slower way to the same drop, for a hub pulled while nobody could see. Answers the hub that has left, if one has.
  lostSight(why,hub){const seen=this.unseen;if(!seen||hub||(!this.usbLive&&!this.adbLive))return null;if(this.usbLive||why==='unseen'){this.unseen=null;clearTimeout(this.timers.unseen);this.timers.unseen=null;return seen;}
    if(!this.timers.unseen){this.timers.unseen=setTimeout(()=>{this.timers.unseen=null;this.publish('unseen');},this.unseenMs);this.timers.unseen.unref?.();}return null;}
  // The page drew that change at this time.
  shown(seq,at){const e=this.event;if(e?.seq!==seq)return;this.log(`shown seq=${seq} at=${at}${e.helper?` windows-to-page=${at-e.helper}ms`:` main-to-page=${at-e.got}ms`}`);}
  log(line){if(!this.logFile)return;try{const text=`${new Date(this.now()).toISOString()} ${line}\n`;this.logBytes??=fs.existsSync(this.logFile)?fs.statSync(this.logFile).size:0;fs.mkdirSync(path.dirname(this.logFile),{recursive:true});fs.appendFileSync(this.logFile,text);this.logBytes+=text.length;
    if(this.logBytes>LOG_MAX){const kept=fs.readFileSync(this.logFile,'latin1').slice(-LOG_MAX/2).replace(/^[^\n]*\n/,'');fs.writeFileSync(this.logFile,kept,'latin1');this.logBytes=kept.length;}}catch{}}
}
module.exports={UsbWatch,parseDevicePath,parseHelperLine,parseAdbList,trackReader,findHub,usbKind,isDriverHub,LOG_MAX};
