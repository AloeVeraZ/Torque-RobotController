'use strict';
// Puts the current FTC Robot Controller app on a Control Hub plugged into this computer, as the REV Hardware Client does:
// FIRST's own release APK from GitHub, checked against its published SHA-256, installed with ADB. The APK is kept, so a
// second hub needs no download. An app signed by someone else (an Android Studio build) or newer than the release cannot
// be updated in place: Android needs it removed first, which takes the team's Android Studio code with it, so that step
// waits for the team to agree. /sdcard/FIRST (configurations, OnBot Java, Blocks) is not touched either way.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const PACKAGE='com.qualcomm.ftcrobotcontroller',ASSET='FtcRobotController-release.apk';
const LATEST='https://api.github.com/repos/FIRST-Tech-Challenge/FtcRobotController/releases/latest';
// Releases checked by hand: a GitHub answer naming one of these must match it, so a tampered answer cannot swap the file.
const KNOWN={'v12.0':{sha256:'0f5a94fad17e7e114a7839328f41e92bda7e7a419a6b732df53446a48b5cd972',versionCode:63,versionName:'12.0'}};
const FALLBACK='v12.0';

// What is installed: from `dumpsys package`, or null when the app is not there.
function installed(dump){const t=String(dump||'');if(!/versionCode=\d+/.test(t))return null;
  const flags=/pkgFlags=\[([^\]]*)\]/.exec(t)?.[1]||'';
  return {versionCode:Number(/versionCode=(\d+)/.exec(t)[1]),versionName:/versionName=(\S+)/.exec(t)?.[1]||'',debug:/\b(DEBUGGABLE|TEST_ONLY)\b/.test(flags)};}
const versionOf=tag=>String(tag||'').replace(/^v/i,'');
// 12.0 > 11.2.1 > 11.0: compared number by number.
function newer(a,b){const x=versionOf(a).split('.').map(Number),y=versionOf(b).split('.').map(Number);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return d>0;}return false;}
// The newest release and where its APK is. Offline, the newest one already kept here, else the release known when this was written.
async function latest({fetch=globalThis.fetch,cache}={}){
  try{const r=await fetch(LATEST,{headers:{Accept:'application/vnd.github+json','User-Agent':'Torque'},signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error(String(r.status));
    const rel=await r.json(),asset=(rel.assets||[]).find(a=>a.name===ASSET);if(!asset)throw Error('no APK');
    const sha256=/^sha256:([0-9a-f]{64})$/i.exec(asset.digest||'')?.[1]?.toLowerCase()||KNOWN[rel.tag_name]?.sha256;
    if(KNOWN[rel.tag_name]&&sha256!==KNOWN[rel.tag_name].sha256)throw Error('digest');if(!sha256)throw Error('no digest');
    return {tag:rel.tag_name,url:asset.browser_download_url,size:asset.size,sha256};}
  catch{const kept=cached(cache);if(kept)return kept;const k=KNOWN[FALLBACK];return {tag:FALLBACK,url:`https://github.com/FIRST-Tech-Challenge/FtcRobotController/releases/download/${FALLBACK}/${ASSET}`,sha256:k.sha256};}
}
function cached(cache){try{const tags=fs.readdirSync(cache).filter(t=>fs.existsSync(path.join(cache,t,ASSET))&&fs.existsSync(path.join(cache,t,'sha256'))).sort((a,b)=>newer(a,b)?-1:1);
  if(!tags.length)return null;const tag=tags[0];return {tag,file:path.join(cache,tag,ASSET),sha256:fs.readFileSync(path.join(cache,tag,'sha256'),'utf8').trim()};}catch{return null;}}
const hashOf=file=>new Promise((ok,fail)=>{const h=crypto.createHash('sha256');fs.createReadStream(file).on('data',d=>h.update(d)).on('error',fail).on('end',()=>ok(h.digest('hex')));});
// The APK on this computer, downloaded once and checked every time it is used.
async function apk(rel,{fetch=globalThis.fetch,cache,progress=()=>{}}){
  const dir=path.join(cache,rel.tag),file=path.join(dir,ASSET);
  if(fs.existsSync(file)&&await hashOf(file)===rel.sha256)return file;
  if(!rel.url)throw Error('The Robot Controller download is not on this computer, and there is no internet to fetch it. Connect to the internet, then try again.');
  fs.mkdirSync(dir,{recursive:true});const part=file+'.part';
  const r=await fetch(rel.url,{headers:{'User-Agent':'Torque'},redirect:'follow',signal:AbortSignal.timeout(300000)});
  if(!r.ok||!r.body)throw Error(`The Robot Controller download failed (${r.status}). Check the internet connection, then try again.`);
  const total=Number(r.headers.get('content-length'))||rel.size||0,out=fs.createWriteStream(part),h=crypto.createHash('sha256');let got=0,said=-1;
  try{for await(const chunk of r.body){h.update(chunk);got+=chunk.length;if(!out.write(chunk))await new Promise(ok=>out.once('drain',ok));
      const pct=total?Math.floor(got*100/total):-1;if(pct!==said&&pct%5===0){said=pct;progress(total?`Downloading ${pct}%`:'Downloading…');}}
    await new Promise((ok,fail)=>out.end(e=>e?fail(e):ok()));}
  catch(e){out.destroy();fs.rmSync(part,{force:true});throw Error(`The Robot Controller download stopped: ${e.message}`);}
  if(h.digest('hex')!==rel.sha256){fs.rmSync(part,{force:true});throw Error('The downloaded Robot Controller app did not match FIRST\'s published checksum, so it was not installed. Try again.');}
  fs.renameSync(part,file);fs.writeFileSync(path.join(dir,'sha256'),rel.sha256);return file;
}
// install: adb install's words into a sentence a team can act on.
function installProblem(text){const t=String(text);
  if(/INSUFFICIENT_STORAGE/.test(t))return 'The Control Hub is out of storage. Delete old files from it, then try again.';
  if(/UPDATE_INCOMPATIBLE|VERSION_DOWNGRADE/.test(t))return 'replace';
  return `The Control Hub did not take the Robot Controller app: ${t.trim().split(/\r?\n/).pop()||'no reason given'}.`;}
// update({serial, adb, controller, cache, replace}): replace = the team agreed to remove an app that cannot be updated in place.
// Resolves {upToDate} | {needsReplace, message} | {installed, versionName}.
async function update({serial,adb,controller,cache,replace=false,progress=()=>{},fetch}){
  const sh=cmd=>adb(['-s',serial,'shell',cmd]),now=installed(await sh(`dumpsys package ${PACKAGE}`).catch(()=>''));
  progress('Checking for the latest version…');const rel=await latest({fetch,cache});const target=versionOf(rel.tag);
  if(now&&!now.debug&&!newer(target,now.versionName))return {upToDate:true,versionName:now.versionName};
  const mustReplace=!!now&&(now.debug||KNOWN[rel.tag]&&now.versionCode>KNOWN[rel.tag].versionCode);
  if(mustReplace&&!replace)return {needsReplace:true,from:now.versionName,to:target,message:`This hub runs a Robot Controller ${now.versionName} built in Android Studio, so Android cannot update it in place. Updating to ${target} removes that app first, and with it any team code built in Android Studio. Configurations, OnBot Java and Blocks programs stay on the hub.`};
  const file=await apk(rel,{fetch,cache,progress});
  if(mustReplace){progress('Removing the old app…');await adb(['-s',serial,'uninstall',PACKAGE],{timeout:60000}).catch(()=>{});}
  progress(`Installing Robot Controller ${target}…`);
  let said='';try{said=await adb(['-s',serial,'install','-r','-g',file],{timeout:240000});}catch(e){said=String(e.message||e);}
  if(!/\bSuccess\b/.test(said)){const why=installProblem(said);if(why!=='replace')throw Error(why);
    if(!replace)return {needsReplace:true,from:now?.versionName||'',to:target,message:`Android will not update this hub's Robot Controller in place. Updating to ${target} removes the old app first, and with it any team code built in Android Studio. Configurations, OnBot Java and Blocks programs stay on the hub.`};
    await adb(['-s',serial,'uninstall',PACKAGE],{timeout:60000}).catch(()=>{});said=await adb(['-s',serial,'install','-r','-g',file],{timeout:240000}).catch(e=>String(e.message));
    if(!/\bSuccess\b/.test(said))throw Error(installProblem(said)==='replace'?'The Control Hub would not take the Robot Controller app. Restart the robot, then try again.':installProblem(said));}
  progress('Starting the Robot Controller…');await controller(serial);
  const after=installed(await sh(`dumpsys package ${PACKAGE}`).catch(()=>''));
  return {installed:true,versionName:after?.versionName||target};
}
module.exports={update,installed,newer,latest,apk,KNOWN,PACKAGE};
