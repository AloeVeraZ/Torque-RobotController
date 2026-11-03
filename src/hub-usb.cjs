'use strict';
// What is plugged into a Control Hub's own USB ports, read over ADB with nothing installed on the hub. It only reads: usb-kinds.js says what each
// device is. See research_notes/Control Hub USB devices/usb-rules.md. A Limelight has never been plugged in while this ran, so its parts are
// tested against stand-ins only.
const {spawn}=require('node:child_process'),{adb,adbPath}=require('./robot-link.cjs');
const FIELDS='idVendor idProduct bDeviceClass bcdDevice speed busnum devnum manufacturer product serial bMaxPower bmAttributes maxchild';
// One line a device. On the hub printf is a program of its own, and starting it about a hundred times took three seconds, so this uses only the shell's
// builtins and answers in under 200 ms, adb included. Same output as READ_PLAIN, plus the network interfaces after each driver.
const READ=`{ cd /sys/bus/usb/devices;g(){ v=;[ -r "$1" ]&&IFS= read -r v <"$1";};for d in *;do case "$d" in *:*) continue;;esac;l=$d;for f in ${FIELDS};do g $d/$f;l="$l|$v";done;l="$l|";for i in $d/$d:*;do [ -d "$i" ]||continue;g $i/bInterfaceClass;l="$l$v/";g $i/bInterfaceSubClass;l="$l$v/";g $i/bInterfaceProtocol;l="$l$v/";[ -e $i/driver ]&&cd -P $i/driver&&{ l="$l\${PWD##*/}";cd /sys/bus/usb/devices;};for n in $i/net/*;do [ -e "$n" ]&&l="$l/\${n##*/}";done;l="$l,";done;print -r -- "$l";done; } 2>/dev/null`;
// The same in plain sh, for a hub whose shell has no print.
const READ_PLAIN=`cd /sys/bus/usb/devices; for d in *; do case "$d" in *:*) continue;; esac; printf '%s' "$d"; for f in ${FIELDS}; do printf '|%s' "$(cat $d/$f 2>/dev/null)"; done; printf '|'; for i in $d/$d:*; do [ -d "$i" ] && printf '%s/%s/%s/%s,' "$(cat $i/bInterfaceClass)" "$(cat $i/bInterfaceSubClass)" "$(cat $i/bInterfaceProtocol)" "$(basename "$(readlink $i/driver)" 2>/dev/null)"; done; echo; done`;

// "03/00/00/usbhid/eth0" -> an interface. A driver's name can have spaces; none of these has a slash.
function parseInterface(text){const [cls,sub,proto,driver='',...net]=text.split('/');return {class:cls.toLowerCase(),sub:sub?.toLowerCase()||'',proto:proto?.toLowerCase()||'',driver,net:net.filter(Boolean)};}
const hexByte=v=>parseInt(v||'0',16)||0,num=v=>{const n=parseFloat(v);return Number.isFinite(n)?n:0;};
// One line of the read, or null for a device that left part way through it. A strange maker's string can hold the separator: the fields at each end are fixed.
function parseUsbLine(line){const p=String(line).replace(/\r$/,'').split('|');if(p.length<15||!/^[0-9a-f]{4}$/i.test(p[1]))return null;
  const end=p.length-1,middle=p.slice(8,end-3),[maker='',product='',...rest]=middle,serial=rest.length?rest.pop():'',interfaces=p[end].split(',').filter(Boolean).map(parseInterface);
  return {path:p[0],vid:p[1].toLowerCase(),pid:p[2].toLowerCase(),class:p[3].toLowerCase(),bcd:p[4].toLowerCase(),speed:num(p[5]),bus:num(p[6]),dev:num(p[7]),maker,product:[product,...rest].join('|'),serial,maxPower:num(p[end-3]),attributes:hexByte(p[end-2]),maxChild:num(p[end-1]),interfaces,net:interfaces.flatMap(i=>i.net)};}
// A USB 3 splitter shows up twice, once on each half of the blue socket, as 1-1 and 2-1 (and the same one level down). They are one thing: it keeps the
// name on the USB 2 half, which is where a slower device behind it is named from, and takes the rest from the USB 3 half. Nothing else can be on both halves of a socket.
function mergeUsb3(devices){const byPath=new Map(devices.map(d=>[d.path,d])),out=[];
  for(const d of devices){const m=/^([12])-(.+)$/.exec(d.path),twin=m&&d.class==='09'?byPath.get(`${m[1]==='1'?2:1}-${m[2]}`):null;
    if(!twin||twin.class!=='09'){out.push(d);continue;}
    if(m[1]==='1')out.push({...d,...twin,path:d.path,paths:[d.path,twin.path],speed:Math.max(d.speed,twin.speed)});}
  return out;}
const parseUsb=text=>mergeUsb3(String(text).split(/\r?\n/).map(parseUsbLine).filter(Boolean));
// Every device on the hub, its own Wi-Fi and root hubs too: usb-kinds marks those hidden. The hub always has root hubs, so an empty answer means the fast read failed.
async function readHubUsb(serial,{run}={}){const sh=cmd=>adb(['-s',serial,'shell',cmd],{run}),found=parseUsb(await sh(READ));return found.length?found:parseUsb(await sh(READ_PLAIN));}

// ---- a webcam's raw descriptors, for usb-kinds' parseUvc. Reading them does not touch the camera.
const PATH=/^\d+-\d+(\.\d+)*$/,isCamera=d=>(d.interfaces||[]).some(i=>i.class==='0e');
async function readDescriptors(serial,path,{run}={}){if(!PATH.test(path))throw Error('That is not a USB device on the hub.');return (await adb(['-s',serial,'shell',`xxd -p /sys/bus/usb/devices/${path}/descriptors`],{run})).replace(/\s+/g,'');}
// Each camera in a list from readHubUsb: {path: hex}. A camera that has just left is left out.
async function readCameraDescriptors(serial,devices,{run}={}){const out={};for(const d of devices.filter(isCamera)){try{out[d.path]=await readDescriptors(serial,d.path,{run});}catch{}}return out;}

// ---- knowing when to read again. One adb shell stays open, and the hub's shell looks at its own folders twice a second, saying something only when they
// changed. It looks at the devices, their interfaces, the drivers as they bind (a moment after the device) and the network interfaces. While a network
// interface called eth* has no address yet it keeps asking for one, because that is what Scan and a Limelight need. glob, print, sleep and cat are all builtins
// of the hub's shell, so nothing starts on each look: measured at 0.9% of one of the hub's four cores. It stops when its input closes. If adb's end goes
// away instead, the outer shell dies without running its kill, leaving the loop an orphan, which is why the loop also checks that the outer shell ($$) is there.
// The look is a function because this shell frees a while loop's memory only when the loop ends: inline it grew by 2.8 kB a look, 20 MB an hour. A function frees
// its own on each return. inotifyd on /dev/bus/usb would not see a network interface or a driver.
const WATCH=`(t(){ [ -d /proc/$$ ]||return 1;set -- /sys/bus/usb/devices/* /sys/bus/usb/devices/*/driver /sys/class/net/*;n="$*";[ "$n" = "$l" ]||{ l=$n;a=;};case "$n" in *net/eth*)[ -n "$a" ]||{ a=$(ip -o -4 addr 2>/dev/null|grep ' eth');a=\${a//$'\\n'/;};};;esac;[ "$n|$a" = "$o" ]||{ o="$n|$a";print -r -- "$o";};sleep 0.5;};o=;a=;l=;while t;do :;done)& p=$!;cat >/dev/null;kill $p`;
// "<paths>|<ip -o -4 addr lines>" -> {devices: names with no interface, net, addresses}. Root hubs are in devices, as in readHubUsb.
function parseWatchLine(line){const [names='',addr='']=String(line).replace(/\r$/,'').split('|'),all=names.split(/\s+/).filter(Boolean),leaf=p=>p.slice(p.lastIndexOf('/')+1);
  return {devices:all.filter(p=>p.startsWith('/sys/bus/usb/devices/')&&!p.endsWith('/driver')&&!leaf(p).includes(':')&&!leaf(p).includes('*')).map(leaf),
    net:all.filter(p=>p.startsWith('/sys/class/net/')&&!leaf(p).includes('*')).map(leaf),addresses:parseIpAddr(addr.replace(/;/g,'\n'))};}
// onChange({first, devices, net, addresses}) each time something changed, first for what is there at the start. Read again with readHubUsb to know what it was.
// Answers {ended, stop}: ended says {why:'stopped'} after stop, or {why:'gone', message} when adb ended by itself, such as for a pulled cable. It does not start again.
function watchHubUsb(serial,onChange,{start=spawn}={}){let finish,stopped=false,err='',text='',seen=false,done=false;const ended=new Promise(r=>{finish=r;});
  const child=start(adbPath(),['-s',serial,'shell',WATCH],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  const close=()=>{if(done)return;done=true;finish(stopped?{why:'stopped'}:{why:'gone',message:err.trim()});};
  child.stdin?.on?.('error',()=>{});child.stderr?.on('data',d=>{err=(err+d).slice(-400);});child.on('error',close);child.on('exit',close);
  child.stdout?.on('data',d=>{text+=d;for(let at;(at=text.indexOf('\n'))>=0;text=text.slice(at+1)){const line=text.slice(0,at).trim();if(!line)continue;const change={first:!seen,...parseWatchLine(line)};seen=true;try{onChange(change);}catch{}}});
  return {ended,stop(){if(stopped||done)return;stopped=true;try{child.stdin?.end();}catch{}const t=setTimeout(()=>{try{child.kill();}catch{}},1000);t.unref?.();}};}

// ---- one hub at a time, for the main process. While it is there one watch runs and each change is read, one read at a time, with a change during a read read after it; onChange
// hears only a list that differs, {serial, devices, addresses, at}. follow(null), or another serial, ends what runs: that is all it takes to leave no adb shell behind. If the watch's
// adb ends while the hub is still followed (its server restarted), it starts again.
const WATCH_AGAIN_MS=[1000,2000,5000,10000];
// Which hub to follow, from what src/usb-watch.cjs says: one ADB can talk to.
const hubToFollow=state=>state?.hub?.state==='device'?state.hub.serial:null;
class HubUsbFollower{
  constructor({onChange=()=>{},run,start}={}){Object.assign(this,{onChange,run,start,serial:null,watch:null,list:null,addresses:[],pending:null,again:false,watchTimer:null,readTimer:null,tries:0,fails:0,gen:0});}
  latest(){return this.list;}
  follow(serial){const next=serial||null;if(next===this.serial)return;this.end();this.serial=next;if(next)this.startWatch();}
  end(){this.gen++;clearTimeout(this.watchTimer);clearTimeout(this.readTimer);this.watchTimer=this.readTimer=null;const w=this.watch;this.watch=null;w?.stop();Object.assign(this,{list:null,addresses:[],pending:null,again:false,tries:0,fails:0});}
  startWatch(){const w=watchHubUsb(this.serial,c=>{if(this.watch!==w)return;this.tries=0;this.addresses=c.addresses;void this.read();},{start:this.start});this.watch=w;
    void w.ended.then(()=>{if(this.watch!==w)return;this.watch=null;this.watchTimer=setTimeout(()=>{this.watchTimer=null;if(this.serial&&!this.watch)this.startWatch();},WATCH_AGAIN_MS[Math.min(this.tries++,WATCH_AGAIN_MS.length-1)]);this.watchTimer.unref?.();});}
  // The list now. A read under way counts, and one more follows it, since something may have changed after it began.
  read(){if(!this.serial)return Promise.resolve(null);if(this.pending){this.again=true;return this.pending;}return this.pending=this.readOnce(this.gen,this.serial);}
  async readOnce(gen,serial){let devices=null;try{devices=await readHubUsb(serial,{run:this.run});}catch{}if(gen!==this.gen)return null;this.pending=null;
    if(devices){this.fails=0;const was=this.list,list={serial,devices,addresses:this.addresses,at:Date.now()};this.list=list;if(JSON.stringify([was?.devices,was?.addresses])!==JSON.stringify([devices,this.addresses])){try{this.onChange(list);}catch{}}}
    else if(this.fails++<3){this.readTimer=setTimeout(()=>{this.readTimer=null;void this.read();},1000);this.readTimer.unref?.();}
    if(this.again){this.again=false;void this.read();}return this.list;}
}
// Once, for a page that asks with nothing following that hub.
async function readHubUsbList(serial,{run}={}){const [devices,ip]=await Promise.all([readHubUsb(serial,{run}),adb(['-s',serial,'shell','ip -o -4 addr'],{run}).catch(()=>'')]);return {serial,devices,addresses:parseIpAddr(ip).filter(a=>/^eth/.test(a.iface)),at:Date.now()};}

// ---- a Limelight on the hub's USB: a network interface called eth*, an address from it, and its REST port. None of this has met a real one.
// "4: eth0    inet 172.29.0.23/24 brd ..." -> {iface, address, prefix}.
const parseIpAddr=text=>String(text).split(/\r?\n/).map(l=>/^\d+:\s+(\S+)\s+inet\s+([\d.]+)(?:\/(\d+))?/.exec(l.trim())).filter(Boolean).map(m=>({iface:m[1],address:m[2],prefix:m[3]?+m[3]:null}));
// hubAddress is what the Limelight gave the hub, which the Scan key holds. address is the Limelight's own: by default the same with the last number set to 1.
function limelightFrom(addresses){const a=addresses.find(x=>/^eth/.test(x.iface)&&x.address.startsWith('172.29.'));return a?{iface:a.iface,hubAddress:a.address,address:a.address.replace(/\.\d+$/,'.1'),scanKey:`EthernetOverUsb:${a.iface}:${a.address}`}:null;}
const limelightAddress=async(serial,{run}={})=>limelightFrom(parseIpAddr(await adb(['-s',serial,'shell','ip -o -4 addr'],{run})));
// "HTTP/1.1 200 OK\r\n...\r\n\r\n{...}" -> {ok, status, body, json}.
function parseHttp(text){const s=String(text),at=s.search(/\r?\n\r?\n/),status=+/^HTTP\/\d(?:\.\d)?\s+(\d+)/.exec(s)?.[1]||0;if(!status)return {ok:false,status:0,body:'',json:null,error:'No answer on that port.'};
  const body=at<0?'':s.slice(at).replace(/^\s+/,'');let json=null;try{json=JSON.parse(body);}catch{}return {ok:status===200,status,body,json};}
// The hub's shell asks: adb's own port forwarding reaches only the hub's localhost, not the Limelight behind it. Never rejects: no Limelight is an ordinary answer.
async function limelightGet(serial,path,{run,host='172.29.0.1',timeout=6000}={}){if(!/^\/[\w\-./?=&%]*$/.test(path)||!/^[\d.]+$/.test(host))throw Error('That is not a Limelight address.');
  try{return parseHttp(await adb(['-s',serial,'shell',`printf 'GET ${path} HTTP/1.0\\r\\n\\r\\n' | toybox nc -w 2 -q 3 ${host} 5807`],{run,timeout}));}catch(e){return {ok:false,status:0,body:'',json:null,error:e.message};}}
// What classify's limelight wants: where it is and what /status said, with status null when nothing answered as a Limelight.
async function readLimelight(serial,{run}={}){const at=await limelightAddress(serial,{run});if(!at)return {status:null};const r=await limelightGet(serial,'/status',{run,host:at.address});return {...at,status:r.ok&&r.json&&typeof r.json==='object'?r.json:null};}

// ---- drops since the hub started, from its kernel log: which device fell off USB or would not start, and when (seconds since boot). wifi: the hub's own Wi-Fi fell off, the mark of a static shock.
function parseDrops(text){const out=[];for(const line of String(text).split(/\r?\n/)){const m=/^(?:<\d+>)?\[\s*([\d.]+)\]\s+usb (\d+-[\d.]+): (.*)$/.exec(line.trim());if(!m)continue;
    const [,at,path,what]=m,gone=/^USB disconnect(?:, device number (\d+))?/.exec(what),kind=gone?'disconnect':/not accepting address/.test(what)?'address':/error -71/.test(what)?'error':null;
    if(kind)out.push({at:+at,path,kind,...(gone?.[1]?{device:+gone[1]}:{}),wifi:path==='3-1.1',text:what});}
  return out;}
// grep says "failed" when it finds nothing, and adb passes that on: nothing is an answer here.
const recentDrops=async(serial,{run}={})=>parseDrops(await adb(['-s',serial,'shell',`dmesg|grep -E 'usb [0-9]+-[0-9.]+: .*(USB disconnect|error -71|not accepting address)';true`],{run,timeout:15000}));

module.exports={readHubUsb,readHubUsbList,HubUsbFollower,hubToFollow,parseUsb,parseUsbLine,mergeUsb3,readDescriptors,readCameraDescriptors,watchHubUsb,parseWatchLine,limelightAddress,limelightFrom,limelightGet,readLimelight,parseIpAddr,parseHttp,recentDrops,parseDrops,READ,READ_PLAIN,WATCH};
