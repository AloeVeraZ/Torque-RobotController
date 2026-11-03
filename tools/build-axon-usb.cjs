#!/usr/bin/env node
'use strict';
// Compiles src/axon-usb/AxonUsb.cs to src/axon-usb/AxonUsb.exe, the small helper src/axon-programmer.cjs runs to reach
// Axon's programmer. Run it after changing the C#. It uses the C# compiler that ships with Windows.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const dir=path.join(__dirname,'..','src','axon-usb'),csc=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
execFileSync(csc,['/nologo','/target:exe','/optimize+','/warn:3',`/out:${path.join(dir,'AxonUsb.exe')}`,path.join(dir,'AxonUsb.cs')],{stdio:'inherit'});
console.log(`${path.join(dir,'AxonUsb.exe')}: ${fs.statSync(path.join(dir,'AxonUsb.exe')).size} bytes`);
