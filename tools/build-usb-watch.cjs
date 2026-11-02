#!/usr/bin/env node
'use strict';
// Compiles src/usb-watch/UsbWatch.cs to src/usb-watch/UsbWatch.exe, the small helper src/usb-watch.cjs runs so Torque hears
// the moment a USB device comes or goes. Run it after changing the C#. It uses the C# compiler that ships with Windows.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const dir=path.join(__dirname,'..','src','usb-watch'),csc=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
execFileSync(csc,['/nologo','/target:exe','/optimize+','/warn:3',`/out:${path.join(dir,'UsbWatch.exe')}`,path.join(dir,'UsbWatch.cs')],{stdio:'inherit'});
console.log(`${path.join(dir,'UsbWatch.exe')}: ${fs.statSync(path.join(dir,'UsbWatch.exe')).size} bytes`);
