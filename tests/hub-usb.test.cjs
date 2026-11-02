'use strict';
// Reading what is on a Control Hub's USB ports over ADB. The answers are FTC-zWL4's real ones; a Limelight's are stand-ins, since none has been plugged in.
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const H=require('../src/hub-usb.cjs'),K=require('../ui/ftc/usb-kinds.js');
const SERIAL='24677c4269e7e709';
const REAL=`1-1|a108|2240|ef|0090|480|1|2|HHYL|UVC Camera|Ucamera001|200mA|c0|0|0e/01/00/uvcvideo,0e/02/00/uvcvideo,03/00/00/usbhid,01/01/00/snd-usb-audio,01/02/00/snd-usb-audio,
3-1|05e3|0608|09|8538|480|3|2||USB2.0 Hub||100mA|e0|4|09/00/00/hub,
3-1.1|0bda|c820|ef|0200|480|3|3|Realtek|802.11ac NIC|123456|500mA|a0|0|e0/01/01/rtk_btusb,e0/01/01/rtk_btusb,ff/ff/ff/rtl8821cu/p2p0/wlan0,
usb1|1d6b|0002|09|0310|480|1|1|Linux 3.10.245 xhci-hcd|xHCI Host Controller|xhci-hcd.0.auto|0mA|e0|1|
`;
// What the adb helper runs: answer by the shell command.
const fake=answer=>{const calls=[],run=(file,args,opts,cb)=>{calls.push({file,args,opts});const out=answer(args[args.length-1],args);if(out instanceof Error)cb(out,'',out.message);else cb(null,out,'');};return {run,calls};};

test('one line of the read, as it really comes',()=>{
  const [cam,inner,wifi,root]=H.parseUsb(REAL);
  assert.deepEqual(cam,{path:'1-1',vid:'a108',pid:'2240',class:'ef',bcd:'0090',speed:480,bus:1,dev:2,maker:'HHYL',product:'UVC Camera',serial:'Ucamera001',maxPower:200,attributes:0xc0,maxChild:0,
    interfaces:[{class:'0e',sub:'01',proto:'00',driver:'uvcvideo',net:[]},{class:'0e',sub:'02',proto:'00',driver:'uvcvideo',net:[]},{class:'03',sub:'00',proto:'00',driver:'usbhid',net:[]},{class:'01',sub:'01',proto:'00',driver:'snd-usb-audio',net:[]},{class:'01',sub:'02',proto:'00',driver:'snd-usb-audio',net:[]}],net:[]});
  assert.equal(inner.maker,'');assert.equal(inner.product,'USB2.0 Hub');assert.equal(inner.serial,'');assert.equal(inner.maxChild,4);assert.equal(inner.class,'09');
  assert.deepEqual(wifi.net,['p2p0','wlan0']);assert.deepEqual(wifi.interfaces[2],{class:'ff',sub:'ff',proto:'ff',driver:'rtl8821cu',net:['p2p0','wlan0']});
  assert.deepEqual(root.interfaces,[]);assert.equal(root.path,'usb1');assert.equal(root.maxPower,0);
});
test('section 1\'s own line, with no network names, reads the same',()=>{
  const line='3-1.1|0bda|c820|ef|0200|480|3|3|Realtek|802.11ac NIC|123456|500mA|a0|0|e0/01/01/rtk_btusb,e0/01/01/rtk_btusb,ff/ff/ff/rtl8821cu,',d=H.parseUsbLine(line);
  assert.equal(d.interfaces[2].driver,'rtl8821cu');assert.deepEqual(d.net,[]);
});
test('Windows line ends, an unbound interface, a separator in a name, and a device that left half way',()=>{
  assert.equal(H.parseUsb(REAL.replace(/\n/g,'\r\n')).length,4);assert.equal(H.parseUsb(REAL.replace(/\n/g,'\r\n'))[3].interfaces.length,0);
  assert.deepEqual(H.parseUsbLine('1-1|1234|5678|00|0100|480|1|2|M|P|S|100mA|80|0|ff/00/00/,').interfaces,[{class:'ff',sub:'00',proto:'00',driver:'',net:[]}]);
  const odd=H.parseUsbLine('1-1|1234|5678|00|0100|480|1|2|Maker|A|B|S1|100mA|80|0|');assert.equal(odd.maker,'Maker');assert.equal(odd.product,'A|B');assert.equal(odd.serial,'S1');assert.equal(odd.maxPower,100);
  assert.equal(H.parseUsbLine('1-1||||||||||||||'),null);assert.equal(H.parseUsbLine(''),null);assert.equal(H.parseUsbLine('garbage'),null);
  assert.equal(H.parseUsb('').length,0);
});
test('a USB 3 splitter on both halves of the blue socket is one thing',()=>{
  const line=(path,pid,speed,product,child=4)=>`${path}|05e3|${pid}|09|0100|${speed}|${path[0]}|2||${product}||100mA|e0|${child}|09/00/00/hub,`;
  const text=[line('1-1','0610',480,'USB2.1 Hub'),`1-1.2|046d|0825|ef|0010|480|1|3|||X|500mA|80|0|0e/01/00/uvcvideo,0e/02/00/uvcvideo,`,line('2-1','0620',5000,'USB3.0 Hub'),`2-1.3|046d|085e|ef|0010|5000|2|3|||Y|500mA|80|0|0e/01/00/uvcvideo,0e/02/00/uvcvideo,`,'usb1|1d6b|0002|09|0310|480|1|1|||x|0mA|e0|1|'].join('\n');
  const list=H.parseUsb(text);assert.deepEqual(list.map(d=>d.path),['1-1','1-1.2','2-1.3','usb1']);
  const hub=list[0];assert.deepEqual(hub.paths,['1-1','2-1']);assert.equal(hub.speed,5000);assert.equal(hub.product,'USB3.0 Hub');assert.equal(hub.pid,'0620');
  assert.equal(K.classify(hub,{}).id,'F1');assert.equal(K.classify(hub,{}).port,'usb3');
  // The same one level down, behind another splitter.
  assert.deepEqual(H.parseUsb([line('1-1','0610',480,'a'),line('2-1','0620',5000,'b'),line('1-1.1','0610',480,'c'),line('2-1.1','0620',5000,'d')].join('\n')).map(d=>d.path),['1-1','1-1.1']);
  // Alone on one half, it stays as it is.
  assert.deepEqual(H.parseUsb(line('1-1','0608',480,'USB2.0 Hub')).map(d=>[d.path,d.paths]),[['1-1',undefined]]);
  assert.deepEqual(H.parseUsb(line('2-1','0620',5000,'b')).map(d=>d.path),['2-1']);
  // A device is never merged; nor is the internal splitter on bus 3.
  assert.deepEqual(H.parseUsb(`1-1|046d|0825|ef|0010|480|1|2|||X|500mA|80|0|\n2-1|046d|085e|ef|0010|5000|2|2|||Y|500mA|80|0|`).map(d=>d.path),['1-1','2-1']);
  assert.deepEqual(H.parseUsb([line('3-1','0608',480,'a'),line('1-1','0610',480,'b')].join('\n')).map(d=>d.path),['3-1','1-1']);
});

test('readHubUsb asks once, by that hub\'s serial, and falls back to plain sh',async()=>{
  const f=fake(()=>REAL),list=await H.readHubUsb(SERIAL,{run:f.run});
  assert.equal(list.length,4);assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].args.slice(0,3),['-s',SERIAL,'shell']);assert.equal(f.calls[0].args[3],H.READ);
  const g=fake(cmd=>cmd===H.READ?'':REAL);assert.equal((await H.readHubUsb(SERIAL,{run:g.run})).length,4);assert.equal(g.calls.length,2);assert.equal(g.calls[1].args[3],H.READ_PLAIN);
  await assert.rejects(H.readHubUsb(SERIAL,{run:fake(()=>Object.assign(Error('device not found'),{code:1})).run}),/device not found/);
});
test('the commands only read',()=>{
  for(const cmd of [H.READ,H.READ_PLAIN,H.WATCH])assert.doesNotMatch(cmd,/\b(rm|mv|cp|setprop|svc|am|pm|reboot|su|chmod|mkdir|touch|tee)\b|>\s*[^&/ ]|>>/,cmd.slice(0,40));
  // The two reads ask for the same fields in the same order.
  for(const f of ['idVendor idProduct bDeviceClass bcdDevice speed busnum devnum manufacturer product serial bMaxPower bmAttributes maxchild'])assert.ok(H.READ.includes(f)&&H.READ_PLAIN.includes(f));
});

test('descriptors are read on demand, and only for cameras',async()=>{
  const f=fake(()=>'12010002ef0201\n4008a140 \r\n2290\n'),list=H.parseUsb(REAL);
  assert.equal(await H.readDescriptors(SERIAL,'1-1',{run:f.run}),'12010002ef02014008a1402290');assert.equal(f.calls[0].args[3],'xxd -p /sys/bus/usb/devices/1-1/descriptors');
  const g=fake(()=>'aa'),got=await H.readCameraDescriptors(SERIAL,list,{run:g.run});assert.deepEqual(got,{'1-1':'aa'});assert.equal(g.calls.length,1);
  await assert.rejects(H.readDescriptors(SERIAL,'1-1;reboot',{run:f.run}),/not a USB device/);await assert.rejects(H.readDescriptors(SERIAL,'../../etc',{run:f.run}),/not a USB device/);assert.equal(f.calls.length,1);
  // A camera that left while reading is left out.
  assert.deepEqual(await H.readCameraDescriptors(SERIAL,list,{run:fake(()=>Error('gone')).run}),{});
});

// ---- the watch
const stubChild=()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin=Object.assign(new EventEmitter(),{ended:0,end(){this.ended++;}});c.killed=0;c.kill=()=>{c.killed++;};return c;};
const NAMES='/sys/bus/usb/devices/1-0:1.0 /sys/bus/usb/devices/1-1 /sys/bus/usb/devices/1-1:1.0 /sys/bus/usb/devices/3-1 /sys/bus/usb/devices/usb1 /sys/bus/usb/devices/1-1/driver /sys/bus/usb/devices/1-1:1.0/driver /sys/class/net/lo /sys/class/net/wlan0';
test('a line from the watch says which devices and networks are there',()=>{
  assert.deepEqual(H.parseWatchLine(`${NAMES}|`),{devices:['1-1','3-1','usb1'],net:['lo','wlan0'],addresses:[]});
  // Nothing matched: the shell leaves the pattern as it is.
  assert.deepEqual(H.parseWatchLine('/sys/bus/usb/devices/* /sys/bus/usb/devices/*/driver /sys/class/net/*|'),{devices:[],net:[],addresses:[]});
  const eth=H.parseWatchLine(`${NAMES} /sys/class/net/eth0|4: eth0    inet 172.29.0.23/24 brd 172.29.0.255 scope global eth0\\       valid_lft forever preferred_lft forever;5: eth1    inet 10.0.0.2/8 scope global eth1\r\n`);
  assert.deepEqual(eth.net,['lo','wlan0','eth0']);assert.deepEqual(eth.addresses,[{iface:'eth0',address:'172.29.0.23',prefix:24},{iface:'eth1',address:'10.0.0.2',prefix:8}]);
});
test('the watch is one long adb shell that hears each change, pieces of a line or not',async()=>{
  const c=stubChild(),seen=[],args=[],w=H.watchHubUsb(SERIAL,x=>seen.push(x),{start:(...a)=>{args.push(a);return c;}});
  assert.equal(args.length,1);assert.deepEqual(args[0][1].slice(0,3),['-s',SERIAL,'shell']);assert.equal(args[0][1][3],H.WATCH);assert.equal(args[0][2].stdio[0],'pipe');
  c.stdout.emit('data',Buffer.from(`${NAMES}|\r`));assert.equal(seen.length,0);c.stdout.emit('data',Buffer.from('\n'));
  assert.equal(seen.length,1);assert.equal(seen[0].first,true);assert.deepEqual(seen[0].devices,['1-1','3-1','usb1']);
  c.stdout.emit('data',Buffer.from('/sys/bus/usb/devices/usb1|\n/sys/bus/usb/devices/3-1 /sys/bus'));c.stdout.emit('data',Buffer.from('/usb/devices/usb1|\n'));
  assert.equal(seen.length,3);assert.equal(seen[1].first,false);assert.deepEqual(seen[2].devices,['3-1','usb1']);
  c.stdout.emit('data',Buffer.from('\r\n\n'));assert.equal(seen.length,3);
  c.stderr.emit('data','error: closed\n');c.emit('exit',1,null);assert.deepEqual(await w.ended,{why:'gone',message:'error: closed'});
});
test('a watch that fails to start, or throws in its listener, does not take anything down',async()=>{
  const c=stubChild(),w=H.watchHubUsb(SERIAL,()=>{throw Error('listener');},{start:()=>c});c.stdout.emit('data',`${NAMES}|\n`);c.emit('error',Error('spawn failed'));assert.equal((await w.ended).why,'gone');
  c.emit('exit',1,null);w.stop();assert.equal(c.stdin.ended,0);assert.equal(c.killed,0);
});
test('stopping closes its input, which ends it on the hub, and it says it was stopped',async()=>{
  const c=stubChild(),w=H.watchHubUsb(SERIAL,()=>{},{start:()=>c});w.stop();w.stop();assert.equal(c.stdin.ended,1);c.emit('exit',0,null);assert.deepEqual(await w.ended,{why:'stopped'});
});
test('if adb will not end, it is killed a second later',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const c=stubChild(),w=H.watchHubUsb(SERIAL,()=>{},{start:()=>c});w.stop();assert.equal(c.killed,0);t.mock.timers.tick(1000);assert.equal(c.killed,1);c.emit('exit',null,'SIGTERM');assert.equal((await w.ended).why,'stopped');
});
test('the watch looks at what a change would touch, and cleans up after itself',()=>{
  for(const part of ['/sys/bus/usb/devices/*','/sys/bus/usb/devices/*/driver','/sys/class/net/*','sleep 0.5','print -r','[ -d /proc/$$ ]','cat >/dev/null','kill $p'])assert.ok(H.WATCH.includes(part),part);
  // The body of the loop stays in a function: inline, the hub's shell grew by 2.8 kB a look.
  assert.ok(H.WATCH.startsWith('(t(){ '));assert.ok(H.WATCH.includes('while t;do :;done'));
  assert.ok(H.WATCH.includes(`a=\${a//$'\\n'/;}`));
  // No program of its own on each look: ls would be one.
  assert.doesNotMatch(H.WATCH,/\b(ls|tr|find)\b/);
});

// ---- a Limelight. These answers are stand-ins: none has been plugged in.
const IP=`1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever preferred_lft forever
3: wlan0    inet 192.168.43.1/24 brd 192.168.43.255 scope global wlan0\\       valid_lft forever preferred_lft forever
`,IP_ETH=`${IP}7: eth0    inet 172.29.0.23/24 brd 172.29.0.255 scope global eth0\\       valid_lft forever preferred_lft forever\r\n`;
test('the hub\'s real addresses have no Limelight',async()=>{
  assert.deepEqual(H.parseIpAddr(IP).map(a=>a.iface),['lo','wlan0']);assert.equal(await H.limelightAddress(SERIAL,{run:fake(()=>IP).run}),null);
  assert.equal(H.limelightFrom([{iface:'eth0',address:'192.168.1.5'}]),null);assert.equal(H.limelightFrom([{iface:'wlan0',address:'172.29.0.4'}]),null);
});
test('a Limelight\'s address and the Scan key, with the hub\'s address in the key and the Limelight\'s beside it',async()=>{
  const f=fake(()=>IP_ETH);assert.deepEqual(await H.limelightAddress(SERIAL,{run:f.run}),{iface:'eth0',hubAddress:'172.29.0.23',address:'172.29.0.1',scanKey:'EthernetOverUsb:eth0:172.29.0.23'});assert.equal(f.calls[0].args[3],'ip -o -4 addr');
  assert.equal(H.limelightFrom([{iface:'eth0',address:'172.29.3.8'}]).address,'172.29.3.1');
});
const HTTP=body=>`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n${body}`,STATUS='{"cpu":12.5,"fps":90,"hwType":"x","name":"limelight","temp":41}';
test('asking a Limelight through the hub\'s shell, since adb forwarding cannot reach it',async()=>{
  const f=fake(()=>HTTP(STATUS)),r=await H.limelightGet(SERIAL,'/status',{run:f.run});
  assert.equal(f.calls[0].args[3],"printf 'GET /status HTTP/1.0\\r\\n\\r\\n' | toybox nc -w 2 -q 3 172.29.0.1 5807");
  assert.equal(r.ok,true);assert.equal(r.status,200);assert.equal(r.json.fps,90);assert.equal(r.body,STATUS);
  assert.deepEqual(await H.limelightGet(SERIAL,'/cal-stats',{run:fake(()=>HTTP('not json')).run}),{ok:true,status:200,body:'not json',json:null});
  assert.equal((await H.limelightGet(SERIAL,'/nope',{run:fake(()=>'HTTP/1.0 404 Not Found\r\n\r\n').run})).status,404);
  assert.equal((await H.limelightGet(SERIAL,'/nope',{run:fake(()=>'HTTP/1.0 404 Not Found\r\n\r\n').run})).ok,false);
  // The hub's real answer with nothing there.
  const none=await H.limelightGet(SERIAL,'/status',{run:fake(()=>Object.assign(Error('nc: connect: Network is unreachable'),{code:1})).run});assert.equal(none.ok,false);assert.match(none.error,/unreachable/);
  assert.equal((await H.limelightGet(SERIAL,'/status',{run:fake(()=>'').run})).ok,false);
  await assert.rejects(H.limelightGet(SERIAL,"/x'; reboot #",{run:f.run}),/not a Limelight/);await assert.rejects(H.limelightGet(SERIAL,'/x',{run:f.run,host:'1;reboot'}),/not a Limelight/);
});
test('readLimelight gives classify what it needs',async()=>{
  const eth=cmd=>cmd.startsWith('ip ')?IP_ETH:HTTP(STATUS),got=await H.readLimelight(SERIAL,{run:fake(eth).run});assert.equal(got.iface,'eth0');assert.equal(got.status.name,'limelight');
  const d={path:'1-1',vid:'1d6b',pid:'0104',class:'ef',interfaces:[{class:'02',sub:'06',proto:'00',driver:'cdc_ether',net:['eth0']}]};assert.equal(K.classify(d,{limelight:got}).id,'G1');
  // No address, no answer, or an answer that is not JSON: a network adapter.
  assert.deepEqual(await H.readLimelight(SERIAL,{run:fake(()=>IP).run}),{status:null});
  for(const answer of [cmd=>cmd.startsWith('ip ')?IP_ETH:Error('timed out'),cmd=>cmd.startsWith('ip ')?IP_ETH:HTTP('<html>')]){const r=await H.readLimelight(SERIAL,{run:fake(answer).run});assert.equal(r.status,null);assert.equal(K.classify(d,{limelight:r}).id,'G3');}
  // It asks the address the hub found, not a fixed one.
  const f=fake(cmd=>cmd.startsWith('ip ')?IP_ETH.replace(/172\.29\.0\./g,'172.29.3.'):HTTP(STATUS));await H.readLimelight(SERIAL,{run:f.run});assert.match(f.calls[1].args[3],/nc -w 2 -q 3 172\.29\.3\.1 5807$/);
});

// ---- drops
test('drops come from the kernel log, read without clearing it',async()=>{
  const LOG=`[  199.375000] usb 3-1.4: new high-speed USB device number 4 using ehci-platform
[  199.458344] usb 3-1.4: Product: UVC Camera
[  208.008349] usb 3-1.4: USB disconnect, device number 4
[  214.922148] usb 1-1: new high-speed USB device number 2 using xhci-hcd
[  301.100000] usb 1-1: device descriptor read/64, error -71
[  302.100000] usb 1-1: device not accepting address 5, error -71
<6>[  400.500000] usb 3-1.1: USB disconnect, device number 3
[  500.000000] hub 3-1:1.0: something else, error -71\r\n`;
  assert.deepEqual(H.parseDrops(LOG),[
    {at:208.008349,path:'3-1.4',kind:'disconnect',device:4,wifi:false,text:'USB disconnect, device number 4'},
    {at:301.1,path:'1-1',kind:'error',wifi:false,text:'device descriptor read/64, error -71'},
    {at:302.1,path:'1-1',kind:'address',wifi:false,text:'device not accepting address 5, error -71'},
    {at:400.5,path:'3-1.1',kind:'disconnect',device:3,wifi:true,text:'USB disconnect, device number 3'}]);
  const f=fake(()=>LOG),got=await H.recentDrops(SERIAL,{run:f.run});assert.equal(got.length,4);const cmd=f.calls[0].args[3];assert.match(cmd,/^dmesg\|grep/);assert.doesNotMatch(cmd,/dmesg -c/);assert.match(cmd,/;true$/);
  assert.deepEqual(await H.recentDrops(SERIAL,{run:fake(()=>'').run}),[]);
});

// ---- following one hub, as the main process does
const {UsbWatch}=require('../src/usb-watch.cjs');
const tick=()=>new Promise(r=>setImmediate(r));
const CAM_LINE='1-1|a108|2240|ef|0090|480|1|2|HHYL|UVC Camera|Ucamera001|200mA|c0|0|0e/01/00/uvcvideo,0e/02/00/uvcvideo,';
function following(answer=()=>REAL){const kids=[],heard=[],reads=[],f=new H.HubUsbFollower({onChange:l=>heard.push(l),start:(file,args)=>{const c=stubChild();c.args=args;kids.push(c);return c;},run:(file,args,opts,cb)=>{reads.push(args);const out=answer(reads.length,cb);if(out===undefined)return;if(out instanceof Error)cb(out,'',out.message);else cb(null,out,'');}});
  const say=(c,text=NAMES+'|')=>c.stdout.emit('data',Buffer.from(text+'\n'));return {f,kids,heard,reads,say};}
test('which hub to follow: one ADB can talk to',()=>{
  assert.equal(H.hubToFollow({hub:{serial:'a',state:'device'}}),'a');for(const state of ['unauthorized','offline','update',null])assert.equal(H.hubToFollow({hub:{serial:'a',state}}),null,String(state));assert.equal(H.hubToFollow({hub:null}),null);assert.equal(H.hubToFollow(undefined),null);
});
test('following a hub: one watch, a read on each change, and word only of a list that differs',async()=>{
  const {f,kids,heard,reads,say}=following();f.follow('hub1');f.follow('hub1');assert.equal(kids.length,1,'one watch');assert.deepEqual(kids[0].args.slice(0,3),['-s','hub1','shell']);assert.equal(f.latest(),null,'nothing read yet');
  say(kids[0]);await tick();assert.equal(reads.length,1);assert.equal(heard.length,1);assert.equal(heard[0].serial,'hub1');assert.equal(heard[0].devices.length,4);assert.deepEqual(f.latest(),heard[0]);
  say(kids[0]);await tick();assert.equal(reads.length,2,'it reads');assert.equal(heard.length,1,'the same list is no news');
  say(kids[0],`${NAMES} /sys/class/net/eth0|7: eth0    inet 172.29.0.23/24 brd 172.29.0.255 scope global eth0`);await tick();assert.equal(heard.length,2,'an address given is news');assert.deepEqual(heard[1].addresses,[{iface:'eth0',address:'172.29.0.23',prefix:24}]);
  f.follow(null);assert.equal(kids[0].stdin.ended,1);
});
test('a change during a read is read afterwards, and never two at once',async()=>{
  const held=[],{f,kids,heard,reads,say}=following((n,cb)=>{held.push(cb);});f.follow('hub1');say(kids[0]);say(kids[0]);say(kids[0]);await tick();assert.equal(reads.length,1,'one at a time');
  held[0](null,REAL,'');await tick();assert.equal(heard.length,1);assert.equal(reads.length,2,'one more for what came meanwhile, not two');held[1](null,REAL+CAM_LINE.replace('1-1|','1-1.2|')+'\n','');await tick();assert.equal(reads.length,2);assert.equal(heard.length,2);assert.equal(heard[1].devices.length,5);f.follow(null);
});
test('the hub leaving ends the watch, and a late answer goes nowhere',async()=>{
  const held=[],{f,kids,heard,say}=following((n,cb)=>{held.push(cb);});f.follow('hub1');say(kids[0]);await tick();f.follow(null);assert.equal(kids[0].stdin.ended,1,'its input closes, which ends it on the hub');assert.equal(f.serial,null);held[0](null,REAL,'');await tick();assert.equal(heard.length,0);assert.equal(f.latest(),null);
  kids[0].emit('exit',0,null);await tick();assert.equal(kids.length,1,'and it does not come back');
  // Another hub: the old watch ends and the new one starts with nothing kept.
  f.follow('hub2');assert.equal(kids.length,2);f.follow('hub3');assert.equal(kids[1].stdin.ended,1);assert.equal(kids.length,3);assert.deepEqual(kids[2].args.slice(0,2),['-s','hub3']);f.follow(null);
});
test('if the watch\'s adb ends with the hub still there it starts again; a read that fails is tried again',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const {f,kids,reads,heard,say}=following(n=>n===1?Error('device busy'):REAL);f.follow('hub1');kids[0].emit('exit',1,null);await tick();assert.equal(kids.length,1,'not at once');t.mock.timers.tick(1000);assert.equal(kids.length,2,'a second later');
  say(kids[1]);await tick();assert.equal(reads.length,1);assert.equal(heard.length,0);t.mock.timers.tick(1000);await tick();assert.equal(reads.length,2);assert.equal(heard.length,1);
  kids[1].emit('exit',1,null);await tick();f.follow(null);t.mock.timers.tick(20000);assert.equal(kids.length,2,'let go: no more');
});
test('a page can ask before anything has changed',async()=>{
  const {f,kids}=following();assert.equal(await f.read(),null,'no hub');f.follow('hub1');const got=await f.read();assert.equal(got.devices.length,4);assert.equal(f.latest(),got);f.follow(null);assert.equal(kids.length,1);
  const list=await H.readHubUsbList(SERIAL,{run:fake(cmd=>cmd.startsWith('ip ')?IP_ETH:REAL).run});assert.equal(list.serial,SERIAL);assert.equal(list.devices.length,4);assert.deepEqual(list.addresses.map(a=>a.iface),['eth0'],'only what a Limelight could be');
  assert.deepEqual((await H.readHubUsbList(SERIAL,{run:fake(cmd=>cmd.startsWith('ip ')?Error('no ip'):REAL).run})).addresses,[]);
});
// Wired as main wires it, against the watch's real code with ADB's track-devices stood in for.
test('the watcher follows the USB watch: it stops on unplug, and when the watch stops',async()=>{
  const track=[],watchers=[],frame=text=>text.length.toString(16).padStart(4,'0')+text,LINE=`${SERIAL} device product:ch_v1_box model:Control_Hub_v1_0 device:rk3328_box\n`;
  const f=new H.HubUsbFollower({start:(file,args)=>{const c=stubChild();c.args=args;watchers.push(c);return c;},run:(file,args,opts,cb)=>cb(null,REAL,'')});
  const w=new UsbWatch({supported:false,adbPath:()=>'adb',start:()=>{const c=stubChild();track.push(c);return c;},onChange:s=>f.follow(H.hubToFollow(s)),onQuit:()=>f.follow(null)});
  w.start();assert.equal(watchers.length,0,'nothing plugged in');track[0].stdout.emit('data',frame(`${SERIAL} offline\n`));assert.equal(watchers.length,0,'ADB cannot talk to it yet');
  track[0].stdout.emit('data',frame(LINE));assert.equal(watchers.length,1,'it can now');
  track[0].stdout.emit('data',frame(`${SERIAL} offline\n`));assert.equal(watchers[0].stdin.ended,1,'gone offline: stopped');track[0].stdout.emit('data',frame(LINE));assert.equal(watchers.length,2,'back');
  track[0].stdout.emit('data','0000');assert.equal(watchers[1].stdin.ended,1,'unplugged: stopped');assert.equal(f.serial,null);
  track[0].stdout.emit('data',frame(LINE));assert.equal(watchers.length,3,'plugged in again');
  w.quit();assert.equal(watchers[2].stdin.ended,1,'the watch stopped, so this does');assert.equal(watchers.length,3);
});
