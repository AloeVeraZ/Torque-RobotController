#!/usr/bin/env node
'use strict';
// Compiles src/usb-relay/DeckUsbRelay.java to src/usb-relay/classes.dex, the file Deck runs on a Control Hub over the USB
// cable (src/robot-link.cjs). Run it after changing the Java. It uses the JDK and d8 under .cache/android-build.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..'),build=path.join(root,'.cache','android-build'),dir=path.join(root,'src','usb-relay');
const home=fs.readdirSync(path.join(build,'jdk')).map(d=>path.join(build,'jdk',d)).find(d=>fs.existsSync(path.join(d,'bin')));
const bin=name=>path.join(home,'bin',process.platform==='win32'?name+'.exe':name),d8=path.join(build,'tools','android-15','lib','d8.jar');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'deck-usb-relay-'));
try{
  execFileSync(bin('javac'),['--release','8','-nowarn','-encoding','UTF-8','-d',out,path.join(dir,'DeckUsbRelay.java')],{stdio:'inherit'});
  const classes=fs.readdirSync(out).filter(f=>f.endsWith('.class')).map(f=>path.join(out,f));
  execFileSync(bin('java'),['-cp',d8,'com.android.tools.r8.D8','--release','--min-api','24','--output',dir,...classes],{stdio:'inherit'});
  console.log(`${path.join(dir,'classes.dex')}: ${fs.statSync(path.join(dir,'classes.dex')).size} bytes`);
}finally{fs.rmSync(out,{recursive:true,force:true});}
