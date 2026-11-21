'use strict';
// Torque reaches a Control Hub on USB with adb. Each system keeps it somewhere else, and an app opened from the Dock or
// Finder on a Mac does not get the shell's PATH, so the REV Hardware Client's own copy has to be found where it installs it.
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {adbCandidates}=require('../src/robot-link.cjs');
test('a Mac finds the adb inside the REV Hardware Client app first, then Android Studio and Homebrew',()=>{
  const list=adbCandidates({platform:'darwin',env:{},home:'/Users/team'});
  assert.equal(list[0],'/Applications/REV Hardware Client 2.app/Contents/bin/adb');
  assert.ok(list.includes('/Users/team/Applications/REV Hardware Client 2.app/Contents/bin/adb'),'an app in ~/Applications too');
  assert.ok(list.includes('/Users/team/Library/Android/sdk/platform-tools/adb'));assert.ok(list.includes('/opt/homebrew/bin/adb'));
  assert.equal(adbCandidates({platform:'darwin',env:{ADB:'/x/adb'},home:'/h'})[0],'/x/adb','ADB set by hand comes first');
});
test('Windows keeps the REV Hardware Client\'s adb.exe first, and Linux looks in its usual places',()=>{
  const win=adbCandidates({platform:'win32',env:{'ProgramFiles(x86)':'C:\\PF'},home:'C:\\Users\\team'});
  assert.equal(win[0],path.win32.join('C:\\PF','REV Robotics','REV Hardware Client','android-tools','adb.exe'));assert.ok(win.every(f=>f.endsWith('adb.exe')));
  const linux=adbCandidates({platform:'linux',env:{ANDROID_HOME:'/sdk'},home:'/home/deck'});
  assert.deepEqual(linux,['/home/deck/Android/Sdk/platform-tools/adb','/sdk/platform-tools/adb','/usr/bin/adb','/usr/local/bin/adb']);
});
