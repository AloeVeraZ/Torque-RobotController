'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const U=require('../src/rc-update.cjs'),R=require('../ui/ftc/robocol.js');

const DEBUG_11='Packages:\n  Package [com.qualcomm.ftcrobotcontroller]\n    versionCode=60 minSdk=24 targetSdk=28\n    versionName=11.0\n    pkgFlags=[ HAS_CODE ALLOW_CLEAR_USER_DATA DEBUGGABLE TEST_ONLY ]\n';
const RELEASE_11='    versionCode=60 minSdk=24 targetSdk=28\n    versionName=11.0\n    pkgFlags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ]\n';
const RELEASE_12='    versionCode=63 minSdk=24 targetSdk=28\n    versionName=12.0\n    pkgFlags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ]\n';
// A cache already holding a "release" whose checksum is its own, and no internet: nothing is downloaded.
function setup(){const cache=fs.mkdtempSync(path.join(os.tmpdir(),'rc-apk-')),bytes=Buffer.from('not really an apk'),sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  fs.mkdirSync(path.join(cache,'v12.0'));fs.writeFileSync(path.join(cache,'v12.0','FtcRobotController-release.apk'),bytes);fs.writeFileSync(path.join(cache,'v12.0','sha256'),sha256);
  const offline=async()=>{throw Error('offline');};return {cache,fetch:offline};}
function hub(dump){const calls=[];let now=dump;
  const adb=async args=>{calls.push(args.slice(2).join(' '));const cmd=args.slice(2).join(' ');
    if(/dumpsys package/.test(cmd))return now;if(args[2]==='uninstall'){now='';return 'Success';}
    if(args[2]==='install'){if(/DEBUGGABLE/.test(now))return 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match]';now=RELEASE_12;return 'Performing Streamed Install\nSuccess';}return '';};
  return {adb,calls,controller:async()=>{calls.push('controller');}};}

test('what is installed, and which version is newer',()=>{
  assert.deepEqual(U.installed(DEBUG_11),{versionCode:60,versionName:'11.0',debug:true});
  assert.deepEqual(U.installed(RELEASE_11),{versionCode:60,versionName:'11.0',debug:false});
  assert.equal(U.installed(''),null);
  assert.equal(U.newer('12.0','11.2.1'),true);assert.equal(U.newer('v11.2.1','12.0'),false);assert.equal(U.newer('12.0','12.0'),false);
});
test('a release app is updated in place; an up-to-date one is left alone',async()=>{
  const {cache,fetch}=setup(),h=hub(RELEASE_11);const r=await U.update({serial:'S',adb:h.adb,controller:h.controller,cache,fetch});
  assert.equal(r.installed,true);assert.equal(r.versionName,'12.0');assert.ok(h.calls.some(c=>/^install -r -g /.test(c)));assert.ok(!h.calls.includes('uninstall com.qualcomm.ftcrobotcontroller'));assert.ok(h.calls.includes('controller'));
  const again=hub(RELEASE_12);assert.equal((await U.update({serial:'S',adb:again.adb,controller:again.controller,cache,fetch})).upToDate,true);assert.ok(!again.calls.some(c=>/^install/.test(c)));
});
test('an Android Studio build is only replaced once the team agrees',async()=>{
  const {cache,fetch}=setup(),h=hub(DEBUG_11);
  const ask=await U.update({serial:'S',adb:h.adb,controller:h.controller,cache,fetch});
  assert.equal(ask.needsReplace,true);assert.match(ask.message,/Android Studio/);assert.match(ask.message,/OnBot Java and Blocks programs stay/);assert.ok(!h.calls.some(c=>/^(un)?install/.test(c)),'nothing touched before agreeing');
  const r=await U.update({serial:'S',adb:h.adb,controller:h.controller,cache,fetch,replace:true});
  assert.equal(r.installed,true);assert.deepEqual(h.calls.filter(c=>/^(un)?install/.test(c)).map(c=>c.split(' ')[0]),['uninstall','install']);
});
test('a kept APK that no longer matches its checksum is not installed',async()=>{
  const {cache,fetch}=setup();fs.writeFileSync(path.join(cache,'v12.0','FtcRobotController-release.apk'),'tampered');const h=hub(RELEASE_11);
  await assert.rejects(U.update({serial:'S',adb:h.adb,controller:h.controller,cache,fetch}),/no internet|did not match/);assert.ok(!h.calls.some(c=>/^install/.test(c)));
});
test('the Driver Station keeps saying which SDK it is, whatever the robot runs, so an older robot does not call it obsolete',()=>{
  const sent=[];const ds=new R.DriverStation({send:b=>sent.push(b)});const before={...ds.identity};
  ds.receive(R.encodePeerDiscovery({seq:1,peerType:R.PeerType.PEER,month:8,year:2025,major:11,minor:0}));
  assert.equal(ds.state.connection,'connected');assert.deepEqual(ds.identity,before);
  ds.discover();const last=R.decode(sent.at(-1));assert.deepEqual([last.month,last.year,last.major,last.minor],[before.month,before.year,before.major,before.minor]);ds.shutdown?.();ds.stop();
});

// The answers that ask the team to agree say which hub they are about, and a failed install after the old app is gone says so.
test('"remove and update" is agreed for one hub; an install that fails after the removal says the hub has no app now',async()=>{
  const {cache,fetch}=setup(),h=hub(DEBUG_11);
  assert.equal((await U.update({serial:'HUB-A',adb:h.adb,controller:h.controller,cache,fetch})).serial,'HUB-A');
  const broken={...h,adb:async args=>args[2]==='install'?'Failure [INSTALL_FAILED_INTERNAL_ERROR]':h.adb(args)};
  await assert.rejects(U.update({serial:'HUB-A',adb:broken.adb,controller:h.controller,cache,fetch,replace:true}),/already removed, so the hub has no Robot Controller app now: plug it in and press Update again/);
  // An install that fails with nothing removed does not say so.
  const kept=hub(RELEASE_11),failing=async args=>args[2]==='install'?'Failure [INSTALL_FAILED_INTERNAL_ERROR]':kept.adb(args);
  await assert.rejects(U.update({serial:'S',adb:failing,controller:kept.controller,cache,fetch}),e=>!/already removed/.test(e.message)&&/did not take/.test(e.message));
});
test('a download that cannot be written to this computer (a full disk) ends with a reason instead of waiting for ever',async()=>{
  const cache=fs.mkdtempSync(path.join(os.tmpdir(),'rc-apk-')),bytes=Buffer.alloc(3e6,7),sha256=crypto.createHash('sha256').update(bytes).digest('hex'),rel={tag:'v99.0',url:'https://example.invalid/app.apk',size:bytes.length,sha256};
  // Where the download is written is taken by a folder: every write to it fails, as on a disk with no room.
  fs.mkdirSync(path.join(cache,'v99.0','FtcRobotController-release.apk.part'),{recursive:true});
  const body=()=>new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=65536)c.enqueue(bytes.subarray(i,i+65536));c.close();}}),fetch=async()=>new Response(body(),{status:200});
  const r=await Promise.race([U.apk(rel,{fetch,cache}).then(()=>'saved',e=>e.message),new Promise(ok=>setTimeout(()=>ok('still waiting'),4000))]);
  assert.match(r,/download stopped|disk is full/);
  // With room, the same download is saved and checked.
  fs.rmSync(path.join(cache,'v99.0'),{recursive:true,force:true});
  const file=await U.apk(rel,{fetch,cache});assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),sha256);assert.ok(!fs.existsSync(file+'.part'));
});
