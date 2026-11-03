'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {pipeline}=require('node:stream/promises');
const {Readable,Transform}=require('node:stream');
const {execFile,spawn}=require('node:child_process');
const {promisify}=require('node:util');const run=promisify(execFile);
const LIMIT=700*1024*1024;
// GitHub redirects a renamed repository's old URLs. Channel manifests keep the old name for installs from before the rename.
const RENAMED_FROM={'AloeVeraZ/Torque-RobotController':['AloeVeraZ/SteamDeck-RobotController']};
function repository(value){const s=String(value||'').trim().replace(/^https:\/\/github\.com\//,'').replace(/\.git$/,'').replace(/\/$/,'');if(!/^[\w-]+\/[\w.-]+$/.test(s))throw Error('Enter a GitHub repository as owner/repository.');return s;}
function compare(a,b){const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;}
function assetName(version,platform,arch){const suffix=platform==='linux'&&arch==='x64'?'SteamDeck.tar.gz':platform==='win32'&&arch==='x64'?'Windows.zip':platform==='darwin'&&arch==='arm64'?'macOS-arm64.zip':null;if(!suffix)throw Error('Updates support Steam Deck x64, Windows x64, and Apple Silicon.');return `DeckDriverStation-${version}-${suffix}`;}
// A release's App package holds only app/; it fits installs built on the same runtime base.
function appAssetName(version,base){return /^[a-f0-9]{12}$/.test(String(base||''))?`DeckDriverStation-${version}-App-${base}.tar.gz`:null;}
// Each platform's full download and the device name the update dialog uses for it.
const DEVICES=[['SteamDeck.tar.gz','Steam Deck / Linux'],['Windows.zip','Windows'],['macOS-arm64.zip','Apple Silicon Mac']];
function selectRelease(releases,{version,channel,installedChannel=channel,platform,arch,base}){
  const pattern=channel==='testing'?/^testing-v(\d+\.\d+\.\d+)$/:/^v(\d+\.\d+\.\d+)$/;
  const candidates=releases.filter(r=>!r.draft&&!!r.prerelease===(channel==='testing')&&pattern.test(r.tag_name)).map(r=>({...r,version:r.tag_name.match(pattern)[1]})).sort((a,b)=>compare(b.version,a.version));
  if(!candidates.length)return {status:'unpublished',message:`No ${channel} releases have been published yet.`};
  const r=candidates[0];if(channel===installedChannel&&compare(r.version,version)<=0)return {status:'current',latest:r.version,message:`You’re up to date. Latest ${channel} release: ${r.version}.`};
  // A release can be built for only some devices (testing builds). It reaches this device only with
  // this device's full download; its App package fits every platform, so it counts only beside that.
  // Otherwise the newest earlier release with the download is offered while it is still an update.
  const uploaded=(c,n)=>n&&c.assets?.find(a=>a.name===n&&a.state==='uploaded');let hit=null;
  for(const c of candidates){if(channel===installedChannel&&compare(c.version,version)<=0)break;const full=uploaded(c,assetName(c.version,platform,arch));if(full){hit={c,full,small:uploaded(c,appAssetName(c.version,base))};break;}}
  const here=DEVICES.find(([s])=>assetName(r.version,platform,arch).endsWith('-'+s))[1],built=DEVICES.filter(([s])=>uploaded(r,`DeckDriverStation-${r.version}-${s}`)).map(([,d])=>d);
  const skipped=`${channel==='testing'?'Testing':'Main'} ${r.version} has no download for ${here} yet${built.length?` (it was built for ${built.join(' and ')} only)`:''}.`;
  if(!hit)return {status:'unavailable',latest:r.version,message:`${skipped} Nothing was downloaded; you’re still on ${version}.`};
  const {c,full,small}=hit,asset=small||full,kind=small?'app':'full';
  return {status:'available',latest:c.version,tag:c.tag_name,asset,kind,fullSize:full.size||0,notes:String(c.body||'').slice(0,8000),message:(channel!==installedChannel?`Switch to ${channel} by installing version ${c.version}. Your saved robots and Wi-Fi settings are kept.`:`Version ${c.version} is available.`)+(c===r?'':` ${skipped}`)};
}
class Updater{
  constructor({directory,version,repo,channel='testing',platform=process.platform,arch=process.arch,base='',fetcher=fetch,onProgress=()=>{}}){Object.assign(this,{directory,version,channel,installedChannel:channel,platform,arch,base,fetcher,onProgress});this.file=path.join(directory,'update-settings.json');this.repo=repository(repo);try{const saved=JSON.parse(fs.readFileSync(this.file));if(['main','testing'].includes(saved.channel))this.channel=saved.channel;}catch{}this.release=null;this.busy=false;}
  info(){return {version:this.version,repository:this.repo,channel:this.channel,installedChannel:this.installedChannel,platform:this.platform,arch:this.arch};}
  persist(){fs.mkdirSync(this.directory,{recursive:true});fs.writeFileSync(this.file,JSON.stringify({channel:this.channel}),{mode:0o600});}
  setChannel(channel,confirmed=false){if(this.busy)throw Error('An update operation is already in progress.');if(!['main','testing'].includes(channel))throw Error('Choose Main or Testing.');if(channel==='testing'&&this.channel!=='testing'&&confirmed!==true)throw Error('Testing is experimental. Confirm the warning before switching.');this.channel=channel;this.release=null;this.downloaded=null;this.persist();return this.info();}
  async response(url,max=120000){const r=await this.fetcher(url,{headers:{'User-Agent':'DeckDriverStation','Accept':url.includes('api.github.com')?'application/vnd.github+json':'application/octet-stream','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(max)});if(!r.ok){if(r.status===404)throw Error('Repository or release not found. It may be private or not published yet.');if(r.status===403||r.status===429)throw Error('GitHub rate limit or access restriction. Try again later.');throw Error(`GitHub returned HTTP ${r.status}.`);}return r;}
  // Release list for this channel. First the channel manifest, a plain release download that
  // GitHub's hourly API limit does not apply to; then the API with a cached ETag (a 304 reply
  // is not counted); if GitHub refuses, the last saved list, or a clear time to try again.
  async releases(){
    try{const r=await this.fetcher(`https://github.com/${this.repo}/releases/download/${this.channel}-channel/channel.json`,{headers:{'User-Agent':'DeckDriverStation','Accept':'application/json'},signal:AbortSignal.timeout(15000)});
      if(r.ok){const manifest=await r.json();if(manifest?.schema===1&&manifest.channel===this.channel&&Array.isArray(manifest.releases)&&manifest.releases.every(x=>typeof x?.tag_name==='string'&&Array.isArray(x.assets)))return {releases:manifest.releases};}}catch{}
    const cacheFile=path.join(this.directory,'release-cache.json'),key=`${this.repo}#${this.channel}`;let cache=null;try{const saved=JSON.parse(fs.readFileSync(cacheFile,'utf8'));if(saved.key===key&&Array.isArray(saved.releases))cache=saved;}catch{}
    const url=`https://api.github.com/repos/${this.repo}/releases?per_page=100`;
    const r=await this.fetcher(url,{headers:{'User-Agent':'DeckDriverStation','Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(cache?.etag?{'If-None-Match':cache.etag}:{})},signal:AbortSignal.timeout(20000)});
    if(r.status===304&&cache)return {releases:cache.releases};
    if(r.status===403||r.status===429){
      const reset=Number(r.headers?.get?.('x-ratelimit-reset')),when=Number.isFinite(reset)&&reset>0?new Date(reset*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'';
      if(cache)return {releases:cache.releases,note:`(GitHub's hourly limit for this network is used up, so this is the last check from ${new Date(cache.time).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}.)`};
      throw Error(`GitHub's hourly limit for update checks on this network is used up${when?'. Try again after '+when:'. Try again in an hour'}.`);
    }
    if(!r.ok){if(r.status===404)throw Error('Repository or release not found. It may be private or not published yet.');throw Error(`GitHub returned HTTP ${r.status}.`);}
    const releases=await r.json();if(!Array.isArray(releases))throw Error('Invalid GitHub release response.');
    try{fs.writeFileSync(cacheFile,JSON.stringify({key,etag:r.headers?.get?.('etag')||'',time:Date.now(),releases}),{mode:0o600});}catch{}
    return {releases};
  }
  async check(){if(this.busy)throw Error('An update operation is already in progress.');this.busy=true;this.release=null;this.downloaded=null;try{this.persist();const {releases,note}=await this.releases();const result=selectRelease(releases,this);if(note)result.message+=' '+note;if(result.asset){this.validateUrl(result.asset.browser_download_url,result.tag);this.release=result;}return {...this.info(),...result,asset:result.asset?{name:result.asset.name,size:result.asset.size,kind:result.kind}:undefined};}finally{this.busy=false;}}
  validateUrl(url,tag){const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='github.com'||u.username||u.password||![this.repo,...(RENAMED_FROM[this.repo]||[])].some(repo=>u.pathname.startsWith(`/${repo}/releases/download/${encodeURIComponent(tag)}/`)))throw Error('The update download must belong to this GitHub repository and release.');return u.href;}
  async download(){if(this.busy)throw Error('An update operation is already in progress.');if(!this.release)throw Error('Check for updates first.');this.busy=true;try{
    const {asset,tag}=this.release;let hash=asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1].toLowerCase();
    if(!hash){const url=this.validateUrl(asset.browser_download_url,tag)+'.sha256';const text=await(await this.response(url,20000)).text();const match=text.trim().match(/^([a-f0-9]{64})\s+\*?([^\r\n]+)$/i);if(!match||match[2]!==asset.name)throw Error('The release has no valid SHA-256 checksum.');hash=match[1].toLowerCase();}
    const folder=path.join(this.directory,'updates',randomUUID());fs.mkdirSync(folder,{recursive:true,mode:0o700});const file=path.join(folder,asset.name),partial=file+'.part';let bytes=0;const digest=createHash('sha256');
    try{const response=await this.response(this.validateUrl(asset.browser_download_url,tag),300000);await pipeline(Readable.fromWeb(response.body),new Transform({transform:(chunk,_enc,cb)=>{bytes+=chunk.length;if(bytes>LIMIT)return cb(Error('Update download exceeds the size limit.'));digest.update(chunk);this.onProgress({bytes,total:asset.size||0});cb(null,chunk);}}),fs.createWriteStream(partial,{mode:0o600,flags:'wx'}));if(asset.size&&bytes!==asset.size)throw Error('Update download was incomplete.');if(digest.digest('hex')!==hash)throw Error('Update checksum mismatch. The update was not installed.');fs.renameSync(partial,file);}catch(e){fs.rmSync(partial,{force:true});throw e;}
    this.downloaded={file,folder,version:this.release.latest,kind:this.release.kind||'full'};return {...this.downloaded,verified:true};
  }finally{this.busy=false;}}
  async downloadAndInstall(install){const download=await this.download();this.busy=true;try{this.onProgress({phase:'installing'});return await install(download);}finally{this.busy=false;}}
}
function installRoot(appPath,executable,platform){
  if(platform==='darwin'){const suffix=path.join('Contents','Resources','app');if(!appPath.endsWith(suffix))return null;const root=appPath.slice(0,-suffix.length-1);return path.resolve(executable)===path.join(root,'Contents','MacOS','Electron')?root:null;}
  const root=path.dirname(appPath);return path.basename(appPath)==='app'&&path.resolve(path.dirname(executable))===path.join(root,'runtime')?root:null;
}
async function prepareInstall(download,{appPath,executable,platform=process.platform,pid=process.pid}){
  const destination=installRoot(appPath,executable,platform);if(!destination)throw Error('This is a development copy. Install the downloaded package first; in-app updates work in the installed app.');
  const stage=path.join(download.folder,'extracted');fs.mkdirSync(stage);
  if(download.kind==='app'){const source=await assembleAppUpdate(download,{destination,stage,platform});return finishPrepare(download,{source,destination,pid,platform});}
  if(platform==='win32')await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'update-extract.ps1'),download.file,stage],{windowsHide:true,timeout:180000,maxBuffer:1024*1024});
  else if(platform==='darwin')await run('/usr/bin/ditto',['-x','-k',download.file,stage],{timeout:180000});
  else {const {stdout}=await run('tar',['-tzf',download.file],{timeout:30000,maxBuffer:4*1024*1024});if(stdout.split('\n').some(s=>s.startsWith('/')||s.split('/').includes('..')))throw Error('Unsafe update archive path.');await run('tar',['-xzf',download.file,'-C',stage],{timeout:180000});}
  const kind=platform==='win32'?'Windows':platform==='darwin'?'macOS':'SteamDeck';const source=platform==='darwin'?path.join(stage,'Deck Driver Station.app'):path.join(stage,`DeckDriverStation-${download.version}-${kind}`);
  return finishPrepare(download,{source,destination,pid,platform});
}
function tarCommand(platform){return platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','System32','tar.exe'):'tar';}
// Combine the downloaded app/ with this install's own runtime and launchers, so the
// helper swaps a complete copy exactly as it does for a full package.
async function assembleAppUpdate(download,{destination,stage,platform}){
  const tar=tarCommand(platform),incoming=path.join(stage,'incoming');fs.mkdirSync(incoming);
  const {stdout}=await run(tar,['-tzf',download.file],{timeout:30000,maxBuffer:4*1024*1024,windowsHide:true});
  const entries=stdout.split(/\r?\n/).filter(Boolean);if(!entries.length||entries.some(e=>!e.startsWith('app/')||e.startsWith('/')||e.split(/[\\/]/).includes('..')))throw Error('Unsafe update archive path.');
  await run(tar,['-xzf',download.file,'-C',incoming],{timeout:120000,windowsHide:true});
  const app=path.join(incoming,'app');
  if(platform==='darwin'){
    const source=path.join(stage,'Deck Driver Station.app'),resources=path.join(source,'Contents','Resources');
    await run('/usr/bin/ditto',[destination,source],{timeout:180000});
    fs.rmSync(path.join(resources,'app'),{recursive:true,force:true});fs.renameSync(app,path.join(resources,'app'));
    fs.copyFileSync(path.join(resources,'app','ui','icon.icns'),path.join(resources,'deck.icns'));
    const plist=path.join(source,'Contents','Info.plist');for(const key of ['CFBundleShortVersionString','CFBundleVersion'])await run('/usr/bin/plutil',['-replace',key,'-string',download.version,plist],{timeout:15000});
    return source;
  }
  const kind=platform==='win32'?'Windows':'SteamDeck',source=path.join(stage,`DeckDriverStation-${download.version}-${kind}`);fs.mkdirSync(source);
  fs.renameSync(app,path.join(source,'app'));
  fs.cpSync(path.join(destination,'runtime'),path.join(source,'runtime'),{recursive:true,verbatimSymlinks:true,preserveTimestamps:true});
  for(const name of platform==='win32'?['DeckDriverStation.exe']:['launch.sh'])if(fs.existsSync(path.join(destination,name)))fs.copyFileSync(path.join(destination,name),path.join(source,name));
  return source;
}
// Field and robot CAD whose terms forbid redistribution is left out of every release package, so a laptop that
// installed it locally (tools/simulation/install-local.ps1) would lose it on update and fall back to outline fields.
const LOCAL_CAD=[/^ui[\\/]vendor[\\/]models[\\/]/,/^ui[\\/]assets[\\/](fields|robots)[\\/][^\\/]+\.glb\.gz$/];
function keepLocalCad(source,destination,platform){
  const inner=platform==='darwin'?path.join('Contents','Resources','app'):'app',from=path.join(destination,inner),to=path.join(source,inner);let kept=0;
  if(!fs.existsSync(path.join(from,'ui')))return 0;
  for(const rel of fs.readdirSync(path.join(from,'ui'),{recursive:true}).map(r=>path.join('ui',r))){
    if(!LOCAL_CAD.some(r=>r.test(rel))||fs.existsSync(path.join(to,rel))||!fs.statSync(path.join(from,rel)).isFile())continue;
    fs.mkdirSync(path.dirname(path.join(to,rel)),{recursive:true});fs.copyFileSync(path.join(from,rel),path.join(to,rel));kept++;
  }
  return kept;
}
function finishPrepare(download,{source,destination,pid,platform}){
  const meta=JSON.parse(fs.readFileSync(path.join(source,platform==='darwin'?'Contents/Resources/app/package.json':'app/package.json')));if(meta.version!==download.version||meta.name!=='deck-driver-station')throw Error('The extracted update is not the expected application version.');
  keepLocalCad(source,destination,platform);
  const bin=path.join(source,platform==='darwin'?'Contents/MacOS/Electron':platform==='win32'?'runtime/electron.exe':'runtime/electron');if(!fs.statSync(bin).isFile())throw Error('The update runtime is missing.');
  const plan={source,destination,pid,platform,stage:download.folder};const planPath=path.join(download.folder,'install-plan.json');fs.writeFileSync(planPath,JSON.stringify(plan),{mode:0o600});
  const script=path.join(download.folder,platform==='win32'?'install.ps1':'install.sh');fs.copyFileSync(path.join(__dirname,platform==='win32'?'update-install.ps1':'update-install.sh'),script);return {plan,planPath,script};
}
async function launchInstall(prepared){const {plan,script,planPath}=prepared;const logPath=path.join(plan.stage,'install.log');
  if(plan.platform==='win32'){
    // Start-Process creates an independent hidden console. PowerShell otherwise
    // exits without running the helper when its console-owning launcher quits.
    await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'update-launch.ps1'),script,planPath,logPath],{windowsHide:true,timeout:15000});return;
  }
  const log=fs.openSync(logPath,'a');const child=spawn('/bin/bash',[script,plan.source,plan.destination,String(plan.pid),plan.platform,plan.stage],{detached:true,stdio:['ignore',log,log]});fs.closeSync(log);child.unref();await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});}
module.exports={Updater,repository,selectRelease,compare,assetName,installRoot,prepareInstall,launchInstall,keepLocalCad};
