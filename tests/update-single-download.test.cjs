'use strict';
// In-app updates install from the one download each release publishes per platform: the Steam Deck installer (.run,
// whose embedded package is checked and unpacked), the Windows installer (run silently by update-install.ps1) and the
// Mac zip. These build each kind of file the way tools/package.py does and check what the updater makes of it.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const {prepareInstall,runPayload,assetNames,selectRelease}=require('../src/updater.cjs');
const temp=t=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'torque-single-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;};
const put=(file,text,mode)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);if(mode)fs.chmodSync(file,mode);};
// The header tools/package.py writes in front of the Steam Deck package (same marker and checksum line).
function makeRun(dir,version,{tamper=false}={}){
  const name=`DeckDriverStation-${version}-SteamDeck`,src=path.join(dir,'src');
  put(path.join(src,name,'app/package.json'),JSON.stringify({name:'deck-driver-station',version}));put(path.join(src,name,'runtime/electron'),'#!/bin/sh\n',0o755);
  put(path.join(src,name,'launch.sh'),'#!/bin/sh\n',0o755);put(path.join(src,name,'install.sh'),'#!/bin/sh\n',0o755);
  const tgz=path.join(dir,name+'.tar.gz');execFileSync('tar',['-czf',tgz,'-C',src,name]);const payload=fs.readFileSync(tgz),hash=createHash('sha256').update(payload).digest('hex');
  const header=`#!/usr/bin/env bash\nset -euo pipefail\nstage="$(mktemp -d)"\nline=$(awk '/^__ARCHIVE_BELOW__$/ { print NR+1; exit }' "$0")\ntail -n +"$line" "$0" > "$stage/package.tar.gz"\nprintf '%s  %s\\n' '${hash}' "$stage/package.tar.gz" | sha256sum -c -\ntar -xzf "$stage/package.tar.gz" -C "$stage"\nbash "$stage/${name}/install.sh"\nexit 0\n__ARCHIVE_BELOW__\n`;
  const body=tamper?Buffer.concat([payload.subarray(0,-1),Buffer.from([payload.at(-1)^1])]):payload;
  const run=path.join(dir,name+'.run');fs.writeFileSync(run,Buffer.concat([Buffer.from(header),body]));return run;
}
function installed(dir,platform){
  const root=path.join(dir,'installed');put(path.join(root,'app/package.json'),JSON.stringify({name:'deck-driver-station',version:'2.4.34'}));put(path.join(root,'runtime',platform==='win32'?'electron.exe':'electron'),'old');
  return {appPath:path.join(root,'app'),executable:path.join(root,'runtime',platform==='win32'?'electron.exe':'electron'),root};
}

test('each platform updates from the one file its release publishes',()=>{
  assert.deepEqual(assetNames('2.4.35','win32','x64')[0],'DeckDriverStation-2.4.35-Windows-Setup.exe');
  assert.deepEqual(assetNames('2.4.35','linux','x64')[0],'DeckDriverStation-2.4.35-SteamDeck.run');
  assert.deepEqual(assetNames('2.4.35','darwin','arm64'),['DeckDriverStation-2.4.35-macOS-arm64.zip']);
  // A release with only the three downloads (V2 onward) is an update on every system.
  const files=['Windows-Setup.exe','macOS-arm64.zip','SteamDeck.run'].map(s=>({name:`DeckDriverStation-2.4.35-${s}`,state:'uploaded',size:1,browser_download_url:'x'}));
  for(const [platform,arch] of [['win32','x64'],['linux','x64'],['darwin','arm64']]){const r=selectRelease([{tag_name:'v2.4.35',prerelease:false,draft:false,assets:files}],{version:'2.4.34',channel:'main',platform,arch});assert.equal(r.status,'available',platform);assert.equal(r.asset.name,assetNames('2.4.35',platform,arch)[0]);}
});

// The Steam Deck package is made and unpacked with tar, as on a Steam Deck; Windows' tar cannot take C:\ paths.
const linuxTools={skip:process.platform==='win32'&&'Steam Deck updates run on Linux'};
test('the Steam Deck installer\'s package is checked against its own checksum and unpacked for the swap',linuxTools,async t=>{
  const dir=temp(t),run=makeRun(dir,'2.4.35'),folder=path.join(dir,'download');fs.mkdirSync(folder);
  const out=runPayload(run,path.join(folder,'check.tar.gz'));assert.ok(fs.statSync(out).size>0);
  const {appPath,executable,root}=installed(dir,'linux');
  const prepared=await prepareInstall({file:run,folder,version:'2.4.35',kind:'full'},{appPath,executable,platform:'linux',pid:1});
  assert.equal(prepared.plan.destination,root);assert.equal(prepared.plan.source,path.join(folder,'extracted','DeckDriverStation-2.4.35-SteamDeck'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(prepared.plan.source,'app/package.json'))).version,'2.4.35');assert.ok(prepared.script.endsWith('install.sh'));
});

test('a Steam Deck installer whose package does not match its checksum is refused',linuxTools,t=>{
  const dir=temp(t),run=makeRun(dir,'2.4.35',{tamper:true});
  assert.throws(()=>runPayload(run,path.join(dir,'out.tar.gz')),/does not match its checksum/);
  const plain=path.join(dir,'plain.run');fs.writeFileSync(plain,'#!/bin/sh\necho hi\n');assert.throws(()=>runPayload(plain,path.join(dir,'x')),/no package inside/);
});

test('a Windows update hands the installer to the helper with the version it must install',async t=>{
  const dir=temp(t),folder=path.join(dir,'download');fs.mkdirSync(folder);const setup=path.join(folder,'DeckDriverStation-2.4.35-Windows-Setup.exe');fs.writeFileSync(setup,'MZ');
  const {appPath,executable,root}=installed(dir,'win32');
  const prepared=await prepareInstall({file:setup,folder,version:'2.4.35',kind:'full'},{appPath,executable,platform:'win32',pid:42});
  assert.deepEqual(prepared.plan,{setup,version:'2.4.35',destination:root,pid:42,platform:'win32',stage:folder});
  assert.ok(prepared.script.endsWith('install.ps1'));assert.equal(fs.readFileSync(prepared.script,'utf8'),fs.readFileSync(path.join(__dirname,'../src/update-install.ps1'),'utf8'));
  // The helper runs the installer silently into this install, checks the version and restores the old copy on failure.
  const helper=fs.readFileSync(prepared.script,'utf8');assert.match(helper,/if \(\$plan\.setup\)/);assert.match(helper,/'\/S', \('\/D='\+\$destination\)/);assert.match(helper,/\$installed -ne \$plan\.version/);assert.match(helper,/Move-Item -LiteralPath \(Join-Path \$backup \$item\) -Destination \$destination/);
});

test('the update icon\'s background check never closes the robot page being driven',()=>{
  const app=fs.readFileSync(path.join(__dirname,'../ui/app.js'),'utf8'),main=fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8');
  const offer=app.slice(app.indexOf('async function offerUpdate('),app.indexOf('\n',app.indexOf('async function offerUpdate(')+200)+400);
  assert.match(offer,/api\.updateState\(\)/);assert.doesNotMatch(offer,/api\.updateInfo\(/,'update-info closes the robot page: only the Updates popup may call it');
  const state=main.match(/handle\('update-state',[^;]*;/)?.[0];assert.ok(state,'update-state is handled');assert.doesNotMatch(state,/closeRobot|dismissed|finding/);
  assert.match(main,/handle\('update-info',async\(\)=>\{auto\.dismissed=true;finding\?\.abort\(\);await closeRobot\(\);/,'opening the Updates popup still closes the robot page');
});
