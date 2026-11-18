#!/usr/bin/env node
'use strict';
// Compiles src/swyft-serial/SwyftSerial.cs to src/swyft-serial/SwyftSerial.exe, the small helper src/swyft-programmer.cjs runs to
// reach SWYFT's servo programmer (a COM port). Run it after changing the C#. It uses the C# compiler that ships with Windows.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const dir=path.join(__dirname,'..','src','swyft-serial'),csc=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
execFileSync(csc,['/nologo','/target:exe','/optimize+','/warn:3','/reference:System.dll',`/out:${path.join(dir,'SwyftSerial.exe')}`,path.join(dir,'SwyftSerial.cs')],{stdio:'inherit'});
console.log(`${path.join(dir,'SwyftSerial.exe')}: ${fs.statSync(path.join(dir,'SwyftSerial.exe')).size} bytes`);
