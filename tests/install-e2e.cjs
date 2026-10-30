'use strict';
// End-to-end check on the CI runner's own OS with real packages from tools/package.py:
// install version A with the shipped installer, launch it, update to B with the small App
// package, launch again, update with the full package, check icons, then uninstall (Windows).
// Usage: node tests/install-e2e.cjs <dist> <versionA> <versionB>
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync,spawn}=require('node:child_process'),{createHash}=require('node:crypto');
const [dist,versionA,versionB]=process.argv.slice(2).map((v,i)=>i===0?path.resolve(v):v);
const platform=process.platform,kind={win32:'Windows',linux:'SteamDeck',darwin:'macOS-arm64'}[platform];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,label,ms=120000){const end=Date.now()+ms;for(;;){const value=await check();if(value)return value;if(Date.now()>end)throw Error('Timed out: '+label);await sleep(500);}}
const home=fs.mkdtempSync(path.join(os.tmpdir(),'deck-e2e-')),data=path.join(home,'user-data');
const env={...process.env,DECK_HEADLESS:'1',DECK_DATA_DIR:data,DECK_NO_LAUNCH:'1'};delete env.ELECTRON_RUN_AS_NODE;
if(platform!=='win32')Object.assign(env,{HOME:home,XDG_DATA_HOME:path.join(home,'share')});
const install=platform==='win32'?{root:path.join(process.env.LOCALAPPDATA,'DeckDriverStation'),bin:'runtime/electron.exe',app:'app'}:platform==='darwin'?{root:path.join(home,'Applications','Deck Driver Station.app'),bin:'Contents/MacOS/Electron',app:'Contents/Resources/app'}:{root:path.join(home,'share','deck-driver-station'),bin:'runtime/electron',app:'app'};
const at=p=>path.join(install.root,p),installedVersion=()=>{try{return JSON.parse(fs.readFileSync(at(install.app+'/package.json'),'utf8')).version;}catch{return '';}};
const file=name=>{const f=path.join(dist,name);assert.ok(fs.existsSync(f),'missing package '+name);return f;};

function installFirst(){
  if(platform==='win32')execFileSync(file(`DeckDriverStation-${versionA}-Windows-Setup.exe`),['/S'],{env,timeout:300000});
  else if(platform==='linux')execFileSync('bash',[file(`DeckDriverStation-${versionA}-SteamDeck.run`)],{env,timeout:300000,stdio:'inherit'});
  else{const unpacked=path.join(home,'unpacked');execFileSync('/usr/bin/ditto',['-x','-k',file(`DeckDriverStation-${versionA}-macOS-arm64.zip`),unpacked]);execFileSync('/bin/bash',[path.join(unpacked,'Install-Mac.command')],{env,timeout:300000,stdio:'inherit'});}
  assert.equal(installedVersion(),versionA,'installer did not install '+versionA);
}
async function launch(label){
  const smoke=path.join(home,`smoke-${label}.json`);fs.rmSync(smoke,{force:true});
  const args=[at(install.app),...(platform==='linux'?['--no-sandbox','--ozone-platform=x11']:[])];
  const child=spawn(at(install.bin),args,{env:{...env,DECK_SMOKE_FILE:smoke},stdio:'inherit'});
  try{const result=JSON.parse(await until(()=>fs.existsSync(smoke)&&fs.readFileSync(smoke,'utf8'),'app start: '+label,90000));await until(()=>child.exitCode!==null||child.signalCode!==null,label+' app exit',30000).catch(()=>{});return result;}finally{child.kill();}
}
function release(version,assets){
  const list=assets.map(name=>{const f=file(name),bytes=fs.readFileSync(f);return {name,state:'uploaded',size:bytes.length,digest:'sha256:'+createHash('sha256').update(bytes).digest('hex'),browser_download_url:`https://github.com/AloeVeraZ/Torque-RobotController/releases/download/testing-v${version}/${name}`};});
  return [{tag_name:'testing-v'+version,prerelease:true,draft:false,assets:list}];
}
async function update(label,{version,base,assets,expect}){
  const {Updater,prepareInstall,launchInstall}=require(at(install.app+'/src/updater.cjs'));
  const releases=release(versionB,assets),served=[];
  const updater=new Updater({directory:path.join(home,'updates-'+label),version,repo:'AloeVeraZ/Torque-RobotController',channel:'testing',base,fetcher:async url=>{served.push(url);if(url.endsWith('/testing-channel/channel.json'))return new Response(JSON.stringify({schema:1,channel:'testing',releases}));if(url.includes('api.github.com'))throw Error('the channel manifest should make API calls unnecessary');return new Response(fs.readFileSync(file(decodeURIComponent(url.split('/').pop()))));}});
  const check=await updater.check();assert.equal(check.status,'available');assert.equal(check.asset.kind,expect,label+' picked '+check.asset.kind);
  // The helper waits for "the app" to exit; a short-lived stand-in plays that part here.
  const standIn=spawn(process.execPath,['-e','setTimeout(()=>{},1500)']);const restartSmoke=path.join(home,`restart-${label}.json`);process.env.DECK_SMOKE_FILE=restartSmoke;Object.assign(process.env,{DECK_HEADLESS:'1',DECK_DATA_DIR:data});
  let stage='';await updater.downloadAndInstall(async download=>{stage=download.folder;const prepared=await prepareInstall(download,{appPath:at(install.app),executable:at(install.bin),pid:standIn.pid});await launchInstall(prepared);});
  await until(()=>installedVersion()===versionB&&fs.existsSync(path.join(stage,'previous'+(platform==='darwin'?'.app':''))),label+' install',180000).catch(e=>{for(const log of ['install.log','install.log.error'])if(fs.existsSync(path.join(stage,log)))console.error(fs.readFileSync(path.join(stage,log),'utf8'));throw e;});
  // Windows and Linux helpers restart the app with this environment; macOS uses `open`.
  // The restarted copy holds the single-instance lock until it exits; wait for that before relaunching.
  if(platform!=='darwin'){const {pid}=JSON.parse(await until(()=>fs.existsSync(restartSmoke)&&fs.readFileSync(restartSmoke,'utf8'),label+' automatic restart',90000));await until(()=>{try{process.kill(pid,0);return false;}catch{return true;}},label+' restarted app exit',30000).catch(()=>{try{process.kill(pid);}catch{}});}
  else{
    // LaunchServices does not inherit the smoke-test environment. Wait for the
    // actual restarted main process, then stop that PID. A fixed sleep + pkill
    // could kill the still-running install helper, miss a late launch, or wait
    // forever on Chromium's crash handler after the main app had already exited.
    const binaries=[at(install.bin),fs.realpathSync(at(install.bin))];
    const processes=()=>execFileSync('ps',['-axo','pid=,stat=,command='],{encoding:'utf8'}).split('\n').map(line=>line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/)).filter(Boolean).map(([,pid,status,command])=>({pid:Number(pid),status,command}));
    const restarted=await until(()=>processes().find(p=>!p.status.startsWith('Z')&&binaries.some(bin=>p.command===bin||p.command.startsWith(bin+' '))&&!p.command.includes(' --type=')),label+' automatic restart',90000);
    process.kill(restarted.pid,'SIGTERM');
    await until(()=>!processes().some(p=>p.pid===restarted.pid&&!p.status.startsWith('Z')),label+' restarted app exit',30000);
  }
  delete process.env.DECK_SMOKE_FILE;
  return {check,downloaded:served.filter(u=>!u.includes('api.github.com')&&!u.endsWith('/channel.json')).map(u=>u.split('/').pop())};
}
(async()=>{
  console.log(`== ${kind}: install ${versionA}, App update and full update to ${versionB}`);
  installFirst();
  const first=await launch('installed');assert.equal(first.version,versionA);assert.match(first.base,/^[a-f0-9]{12}$/);console.log('PASS: installer and first launch',first);
  const base=JSON.parse(fs.readFileSync(at(install.app+'/build.json'),'utf8')).base;assert.equal(base,first.base);
  const appName=`DeckDriverStation-${versionB}-App-${base}.tar.gz`,fullName=platform==='linux'?`DeckDriverStation-${versionB}-SteamDeck.tar.gz`:platform==='win32'?`DeckDriverStation-${versionB}-Windows.zip`:`DeckDriverStation-${versionB}-macOS-arm64.zip`;
  const small=await update('app',{version:versionA,base,assets:[fullName,appName],expect:'app'});
  // About 7 MB with the simulator bundle (DSIM physics and the OCCT CAD reader), against 115+ MB full packages.
  assert.deepEqual(small.downloaded,[appName],'App update downloaded '+small.downloaded);assert.ok(small.check.asset.size<10*1024*1024,'App package too large: '+small.check.asset.size);
  const second=await launch('after-app-update');assert.equal(second.version,versionB);assert.equal(second.electron,first.electron);
  console.log(`PASS: ${Math.round(small.check.asset.size/1024)} KB App update (full package is ${Math.round(small.check.fullSize/1048576)} MB), restart and relaunch`);
  // A runtime base that does not match must take the full package.
  const big=await update('full',{version:versionA,base:'',assets:[fullName,appName],expect:'full'});assert.deepEqual(big.downloaded,[fullName]);
  const third=await launch('after-full-update');assert.equal(third.version,versionB);console.log('PASS: full-package update, restart and relaunch');
  if(platform==='win32'){
    assert.ok(fs.existsSync(at(`icons/deck-${versionB}.ico`)),'versioned icon missing');
    const desktop=path.join(os.homedir(),'Desktop','Deck Driver Station.lnk');
    if(fs.existsSync(desktop)){const icon=execFileSync('powershell.exe',['-NoProfile','-Command',`(New-Object -ComObject WScript.Shell).CreateShortcut('${desktop}').IconLocation`]).toString().trim();assert.match(icon,new RegExp(`deck-${versionB.replace(/\./g,'\\.')}\\.ico`),'desktop shortcut icon: '+icon);}
    execFileSync(at('Uninstall.exe'),['/S','_?='+install.root],{timeout:120000});await until(()=>!fs.existsSync(at('app')),'uninstall',60000);
    console.log('PASS: shortcut icons follow the update; uninstaller removes the app');
  }else if(platform==='linux'){
    const share=path.join(home,'share');assert.ok(fs.existsSync(path.join(share,'applications','deck-driver-station.desktop')));
    assert.deepEqual(fs.readFileSync(path.join(share,'icons','hicolor','scalable','apps','deck-driver-station.svg')),fs.readFileSync(at('app/ui/icon.svg')));
    console.log('PASS: desktop entry present and menu icon matches the updated app');
  }else{
    assert.deepEqual(fs.readFileSync(at('Contents/Resources/deck.icns')),fs.readFileSync(at('Contents/Resources/app/ui/icon.icns')));
    execFileSync('/usr/bin/codesign',['--verify','--deep',install.root]);
    console.log('PASS: bundle icon matches the updated app and the signature verifies');
  }
  console.log(`PASS: ${kind} install, App update, full update and relaunch`);process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
