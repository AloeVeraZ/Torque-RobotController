'use strict';
const {execFile}=require('node:child_process');const {promisify}=require('node:util');const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');const {randomUUID}=require('node:crypto');const {cleanSsid}=require('./library.cjs');
const nativeRun=promisify(execFile);
function splitEscaped(line){const out=[];let value='',escaped=false;for(const c of line){if(escaped){value+=c;escaped=false;}else if(c==='\\')escaped=true;else if(c===':'){out.push(value);value='';}else value+=c;}out.push(value);return out;}
const xml=s=>String(s).replace(/[<>&'\"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
// Signal as 1–4 bars, the way the system's own menus draw it: from a percent (Windows, Linux) or from dBm (macOS).
const barsFromPercent=p=>Number.isFinite(p)&&p>0?p>=75?4:p>=50?3:p>=25?2:1:0,barsFromRssi=r=>Number.isFinite(r)&&r<0?r>=-55?4:r>=-67?3:r>=-75?2:1:0;
// macOS keeps the joined network's name from apps that lack location access, but still gives its channel and signal; the name is
// then the network on that channel in the system's last scan whose signal is closest. Never throws: an empty answer means unknown.
const MAC_CURRENT=`ObjC.import('CoreWLAN'); const i=$.CWWiFiClient.sharedWiFiClient.interface; let out={rssi:0,channel:0,name:''}; if(i&&!i.isNil()){const ch=i.wlanChannel,c=ch.isNil()?0:Number(ch.channelNumber),rssi=Number(i.rssiValue);let name=ObjC.unwrap(i.ssid)||'';
if(!name&&c){const list=i.cachedScanResults;let best=null;if(list&&!list.isNil())for(const n of list.allObjects.js){const w=n.wlanChannel;if(w.isNil()||Number(w.channelNumber)!==c)continue;const s=ObjC.unwrap(n.ssid);if(!s)continue;const d=Math.abs(Number(n.rssiValue)-rssi);if(!best||d<best.d)best={s,d};}name=best?best.s:'';}
out={rssi,channel:c,name};} JSON.stringify(out);`;
function wifiError(message,code='NETWORK_ERROR'){const e=Error(message);e.code=code;return e;}
class Network {
  constructor({platform=process.platform,runner=nativeRun,sleep=ms=>new Promise(r=>setTimeout(r,ms)),interfaces=()=>os.networkInterfaces()}={}){this.platform=platform;this.runner=runner;this.sleep=sleep;this.interfaces=interfaces;this.busy=false;this.joined=null;}
  async run(file,args,timeout=5000){return (await this.runner(file,args,{timeout,maxBuffer:500000,windowsHide:true,env:{...process.env,LC_ALL:'C',LANG:'C'}})).stdout.trim();}
  async status(){
    try{
      if(this.platform==='linux'){
        const rows=(await this.run('nmcli',['-t','--escape','yes','-f','DEVICE,TYPE,STATE,CONNECTION','device','status'])).split('\n').map(splitEscaped);
        const device=rows.find(r=>r[1]==='wifi'&&r[2]==='connected')||rows.find(r=>r[1]==='wifi');
        let ssid='';if(device?.[2]==='connected'){const uuid=await this.run('nmcli',['-g','GENERAL.CON-UUID','device','show',device[0]]);ssid=splitEscaped(await this.run('nmcli',['-g','802-11-wireless.ssid','connection','show','uuid',uuid])).join(':');}
        const bars=ssid?barsFromPercent(Number(splitEscaped((await this.run('nmcli',['-t','--escape','yes','-f','IN-USE,SIGNAL','device','wifi','list','--rescan','no']).catch(()=>'')).split('\n').find(l=>l.startsWith('*'))||'')[1])):0;
        return {available:!!device,connected:!!ssid,ssid,device:device?.[0]||'',native:true,...(bars?{bars}:{})};
      }
      if(this.platform==='win32'){
        const s=await this.run('netsh',['wlan','show','interfaces']);const active=s.split(/(?=^\s*Name\s*:)/m).find(block=>/^\s*SSID\s*:\s*\S/m.test(block))||'',ssid=active.match(/^\s*SSID\s*:\s*(.+)$/m)?.[1]?.trim()||'';const bars=ssid?barsFromPercent(Number(active.match(/^\s*Signal\s*:\s*(\d+)\s*%/m)?.[1])):0;return {available:!s.includes('no wireless interface'),connected:!!ssid,ssid,device:active.match(/^\s*Name\s*:\s*(.+)$/m)?.[1]?.trim()||'',native:true,...(bars?{bars}:{})};
      }
      if(this.platform==='darwin'){
        const ports=await this.run('/usr/sbin/networksetup',['-listallhardwareports']);const device=ports.match(/Hardware Port: (?:Wi-Fi|AirPort)\r?\nDevice: (\S+)/)?.[1]||'en0';
        const raw=await this.run('/usr/sbin/networksetup',['-getairportnetwork',device]);const ssid=raw.match(/Current Wi-Fi Network: (.+)/)?.[1]||'';
        // Newer macOS keeps a network's name from apps (it answers "not associated" while connected). CoreWLAN still gives the signal and
        // channel, and the name from the last scan (MAC_CURRENT). A Control Hub's network (192.168.43.x) or a Robot Controller phone's
        // (192.168.49.x) is known by the interface's address; a network this app joined keeps the name it was joined by.
        const here=await this.run('/usr/bin/osascript',['-l','JavaScript','-e',MAC_CURRENT],4000).then(JSON.parse).catch(()=>({})),bars=barsFromRssi(Number(here?.rssi)),sig=bars?{bars}:{};
        if(ssid)return {available:true,connected:true,ssid,device,native:true,...sig};
        const ip=(this.interfaces()[device]||[]).find(a=>a&&a.family==='IPv4'&&!a.internal)?.address||'',net3=ip.split('.').slice(0,3).join('.'),hub=net3==='192.168.43',phone=net3==='192.168.49',robot=hub||phone?{robotHost:hub?'192.168.43.1':'192.168.49.1'}:{};
        if(!ip){this.joined=null;return {available:true,connected:false,ssid:'',device,native:true};}
        if(this.joined&&(this.joined.net3??=net3)===net3)return {available:true,connected:true,ssid:this.joined.ssid,device,native:true,nameHidden:true,...sig,...robot};
        this.joined=null;let seen='';try{seen=typeof here?.name==='string'?cleanSsid(here.name):'';}catch{}
        if(seen||hub||phone)return {available:true,connected:true,ssid:seen||(hub?'FTC-robot':'DIRECT-robot'),device,native:true,nameHidden:true,...sig,...robot};
        // Connected, but nothing says to which network.
        if(bars)return {available:true,connected:true,ssid:'',device,native:true,nameHidden:true,...sig};
        return {available:true,connected:!!ssid,ssid,device,native:true};
      }
    }catch{}
    return {available:false,connected:false,ssid:'',native:false,message:'Wi-Fi details are unavailable. Open system Wi-Fi settings, or use Ethernet.'};
  }
  async scan(){
    if(this.platform==='linux'){
      const raw=await this.run('nmcli',['-t','--escape','yes','-f','IN-USE,SSID,SIGNAL,SECURITY','device','wifi','list','--rescan','yes'],18000);
      const entries=raw.split('\n').filter(Boolean).map(splitEscaped).filter(r=>r[1]).map(r=>({ssid:r[1],signal:Number(r[2]),security:r[3],active:r[0]==='*'}));
      const unique=new Map();for(const e of entries.sort((a,b)=>b.signal-a.signal))if(!unique.has(e.ssid))unique.set(e.ssid,e);return [...unique.values()];
    }
    if(this.platform==='win32'){
      // netsh only reports Windows' cached scan, which often holds just the connected network; request a fresh scan first.
      const fresh=await this.run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'wifi-scan.ps1')],15000).then(out=>Number(out)>0).catch(()=>false);
      let list=await this.windowsNetworks();
      for(let i=0,stable=0;fresh&&i<6&&stable<2;i++){await this.sleep(800);const next=await this.windowsNetworks();stable=i>=2&&next.length===list.length?stable+1:0;list=next;}
      return list;
    }
    if(this.platform==='darwin'){
      const script=`ObjC.import('CoreWLAN'); const iface=$.CWWiFiClient.sharedWiFiClient.interface; if(!iface)throw Error('No Wi-Fi interface'); const error=Ref(); const result=iface.scanForNetworksWithSSIDError($(),error); if(!result)throw Error('macOS could not scan Wi-Fi. Use system Wi-Fi settings and allow location access if requested.'); const list=result.allObjects.js.map(n=>({ssid:ObjC.unwrap(n.ssid)||'',signal:Number(n.rssiValue),security:n.supportsSecurity(0)?'':'Secured'})).filter(n=>n.ssid); JSON.stringify(list);`;
      const entries=JSON.parse(await this.run('/usr/bin/osascript',['-l','JavaScript','-e',script],25000));const unique=new Map();for(const e of entries.sort((a,b)=>b.signal-a.signal))if(!unique.has(e.ssid))unique.set(e.ssid,e);return [...unique.values()];
    }
    return [];
  }
  async context(){
    const wifi=await this.status();if(!wifi.connected||!wifi.device)return {...wifi,internet:'unknown'};
    try{
      if(this.platform==='win32')return {...wifi,...JSON.parse(await this.run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'wifi-context.ps1'),'-Device',wifi.device]))};
      if(this.platform==='linux'){
        const [gateway,address,connectivity]=await Promise.all([this.run('nmcli',['-g','IP4.GATEWAY','device','show',wifi.device]),this.run('nmcli',['-g','IP4.ADDRESS','device','show',wifi.device]),this.run('nmcli',['-g','GENERAL.IP4-CONNECTIVITY','device','show',wifi.device]).catch(()=>'unknown')]);
        const [ip,prefix]=address.split('\n')[0].split('/');return {...wifi,address:ip,prefix:Number(prefix),gateway:gateway.split('\n')[0],internet:/full|^4\b/i.test(connectivity)?'full':/limited|^3\b/i.test(connectivity)?'limited':/portal|^2\b/i.test(connectivity)?'portal':'unknown'};
      }
      if(this.platform==='darwin'){
        const [address,gateway,mask]=await Promise.all([this.run('/usr/sbin/ipconfig',['getifaddr',wifi.device]),this.run('/usr/sbin/ipconfig',['getoption',wifi.device,'router']),this.run('/usr/sbin/ipconfig',['getoption',wifi.device,'subnet_mask'])]);
        const binary=mask.split('.').map(n=>Number(n).toString(2).padStart(8,'0')).join('');return {...wifi,address,gateway:gateway.split(/\s/)[0],prefix:/^1+0*$/.test(binary)?binary.indexOf('0')===-1?32:binary.indexOf('0'):0,internet:'unknown'};
      }
    }catch{}
    return {...wifi,internet:'unknown'};
  }
  async windowsNetworks(){
    const raw=await this.run('netsh',['wlan','show','networks','mode=bssid']);const entries=[];let item;
    for(const line of raw.split('\n')){const m=line.match(/^SSID \d+\s*:\s*(.*)/);if(m){item={ssid:m[1].trim(),signal:0,security:'',active:false};if(item.ssid)entries.push(item);}else if(item){const n=line.match(/Signal\s*:\s*(\d+)/);if(n)item.signal=Number(n[1]);const a=line.match(/Authentication\s*:\s*(.*)/);if(a)item.security=a[1].trim();}}
    if(!entries.length&&/location/i.test(raw))throw wifiError('Windows needs Location access to list Wi-Fi networks. Turn on Settings › Privacy & security › Location and “Let desktop apps access your location”.','SYSTEM_WIFI');
    const unique=new Map();for(const e of entries.sort((a,b)=>b.signal-a.signal))if(!unique.has(e.ssid))unique.set(e.ssid,e);return [...unique.values()];
  }
  async join(ssid,password=''){
    ssid=cleanSsid(ssid);if(!ssid)throw wifiError('Choose a Wi-Fi network.');if(typeof password!=='string'||/[\r\n\0]/.test(password)||password.length>128)throw wifiError('Invalid Wi-Fi password.');
    if(this.busy)throw wifiError('A Wi-Fi connection is already in progress.');this.busy=true;
    try{
      const current=await this.status();if(current.ssid===ssid)return current;
      if(this.platform==='linux')await this.joinLinux(ssid,password,current);
      else if(this.platform==='win32')await this.joinWindows(ssid,password);
      else if(this.platform==='darwin'){
        if(!password)throw wifiError('Enter this network’s password, or connect using system Wi-Fi settings.','NEEDS_PASSWORD');
        // networksetup says what went wrong in words and still exits clean.
        const said=await this.run('/usr/sbin/networksetup',['-setairportnetwork',current.device||'en0',ssid,password],35000);if(/could not find|failed to join|error/i.test(said))throw wifiError(said.split('\n')[0].slice(0,200));
        // Newer macOS will not say which network this is afterwards, so the one just joined is remembered; it counts once the interface has its address.
        this.joined={ssid};await this.sleep(1500);let result=await this.status();for(let i=0;i<16&&result.ssid!==ssid;i++){this.joined={ssid};await this.sleep(500);result=await this.status();}
        if(result.ssid!==ssid){this.joined=null;throw wifiError('The network switch has not completed. Check system Wi-Fi settings and try again.');}return result;
      }else throw wifiError('Use system Wi-Fi settings on this device.','SYSTEM_WIFI');
      const result=await this.status();if(result.ssid!==ssid)throw wifiError('The network switch has not completed. Check system Wi-Fi settings and try again.');return result;
    }catch(e){if(e.code==='NEEDS_PASSWORD'||e.code==='SYSTEM_WIFI')throw e;throw wifiError('Could not join Wi-Fi. Check the password, signal, and system network permissions.','NEEDS_PASSWORD');}finally{this.busy=false;}
  }
  async joinLinux(ssid,password,current){
    if(!current.device)throw wifiError('No Wi-Fi adapter was found.','SYSTEM_WIFI');
    const rows=(await this.run('nmcli',['-t','--escape','yes','-f','UUID,TYPE,NAME','connection','show'])).split('\n').map(splitEscaped).filter(r=>['wifi','802-11-wireless'].includes(r[1]));let uuid='';
    for(const r of rows){if(splitEscaped(await this.run('nmcli',['-g','802-11-wireless.ssid','connection','show','uuid',r[0]])).join(':')===ssid){uuid=r[0];break;}}
    if(!uuid){
      const networks=await this.scan(),ap=networks.find(n=>n.ssid===ssid);const secured=ap?!!ap.security&&ap.security!=='--':true;
      if(secured&&!password)throw wifiError('Enter the Wi-Fi password for this robot network.','NEEDS_PASSWORD');
      if(ap?.security?.includes('802.1X'))throw wifiError('Set up this enterprise network in system Wi-Fi settings.','SYSTEM_WIFI');
      uuid=randomUUID();await this.run('nmcli',['connection','add','type','wifi','ifname',current.device,'con-name',`Deck Robot ${ssid}`,'ssid',ssid,'connection.uuid',uuid,'connection.autoconnect','no','connection.permissions',`user:${os.userInfo().username}`]);
      if(secured)await this.run('nmcli',['connection','modify','uuid',uuid,'wifi-sec.key-mgmt',ap?.security==='WPA3'?'sae':'wpa-psk','wifi-sec.psk-flags','0']);
    }
    if(password){
      const dir=await fs.mkdtemp(path.join(os.tmpdir(),'deck-wifi-'));const secret=path.join(dir,'secret');
      try{await fs.chmod(dir,0o700);await fs.writeFile(secret,`802-11-wireless-security.psk:${password}\n`,{mode:0o600});await this.run('nmcli',['--wait','30','connection','up','uuid',uuid,'ifname',current.device,'passwd-file',secret],35000);}finally{await fs.unlink(secret).catch(()=>{});await fs.rmdir(dir).catch(()=>{});}
    }else{try{await this.run('nmcli',['--wait','30','connection','up','uuid',uuid,'ifname',current.device],35000);}catch{throw wifiError('This saved network needs its Wi-Fi password.','NEEDS_PASSWORD');}}
  }
  async joinWindows(ssid,password){
    const ap=(await this.windowsNetworks().catch(()=>[])).find(n=>n.ssid===ssid),open=ap?.security==='Open';
    if(password||open){
      if(password&&/enterprise|802\.1x/i.test(ap?.security||''))throw wifiError('Set up this enterprise network in system Wi-Fi settings.','SYSTEM_WIFI');
      const dir=await fs.mkdtemp(path.join(os.tmpdir(),'deck-wifi-')),file=path.join(dir,'network.xml');
      const authentication=open?'open':/WPA3/i.test(ap?.security||'')?'WPA3SAE':'WPA2PSK';
      const key=open?'':`<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${xml(password)}</keyMaterial></sharedKey>`;
      const body=`<?xml version="1.0"?><WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1"><name>${xml(ssid)}</name><SSIDConfig><SSID><name>${xml(ssid)}</name></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>manual</connectionMode><MSM><security><authEncryption><authentication>${authentication}</authentication><encryption>${open?'none':'AES'}</encryption><useOneX>false</useOneX></authEncryption>${key}</security></MSM></WLANProfile>`;
      try{await fs.writeFile(file,body,{mode:0o600});await this.run('netsh',['wlan','add','profile',`filename=${file}`,'user=current']);}finally{await fs.unlink(file).catch(()=>{});await fs.rmdir(dir).catch(()=>{});}
    }
    const out=await this.run('netsh',['wlan','connect',`name=${ssid}`,`ssid=${ssid}`],10000);if(/not found|failed|error|not available/i.test(out))throw wifiError('Join this network in system Wi-Fi settings or enter its password.','NEEDS_PASSWORD');
    for(let i=0;i<12;i++){if((await this.status()).ssid===ssid)return;await new Promise(r=>setTimeout(r,500));}
  }
}
module.exports={Network,splitEscaped,xml};
