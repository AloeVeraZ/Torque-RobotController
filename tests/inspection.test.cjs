'use strict';
// Self Inspect: the rows and marks the FTC Driver Station app shows, from the robot's InspectionState (ui/ftc/inspection.js).
const test=require('node:test'),assert=require('node:assert/strict'),I=require('../ui/ftc/inspection.js');
const mark=(list,label)=>list.find(x=>x.label===label)?.mark;
const value=(list,label)=>list.find(x=>x.label===label)?.value;
const NOV_2026=new Date(2026,10,13);
// The user's real Control Hub as their Driver Hub (DS 11.1) showed it on 2026-11-13: RC 11.2.0, factory name FTC-o21m.
const REAL={mfr:'REV Robotics',mdl:'Control Hub v1.0',os:'7.1.2',sdk:25,chOs:'1.1.4',chOsNum:7,fw:'[Control Hub] 1.8.2',bat:1,bt:false,pw:false,wfEn:true,wfConn:true,name:'FTC-o21m',rcIn:true,dsIn:false,aVmj:11,aVmn:2,aVpt:0,bldTs:'2026-07-15T10:00:00.000-0700'};

test('the real Control Hub report reads as the Driver Hub showed it',()=>{
  const list=I.rows(REAL,{kind:'rc',viewer:{major:11,minor:1},now:NOV_2026});
  assert.deepEqual(list.filter(x=>!x.head).map(x=>x.label),['Manufacturer','Model','Control Hub OS Version','Android Version','Hub Firmware','Battery Level','Bluetooth','RC Password','Wi-Fi Enabled','Standard Wi-Fi Connected','Robot Controller Name','Robot Controller','Matches DS version','Driver Station']);
  assert.equal(value(list,'Hub Firmware'),'[CH] 1.8.2');assert.equal(mark(list,'Hub Firmware'),'ok');
  assert.equal(mark(list,'Control Hub OS Version'),'ok');assert.equal(mark(list,'Android Version'),'ok');assert.equal(mark(list,'Bluetooth'),'ok');assert.equal(value(list,'RC Password'),'Not default');
  assert.equal(mark(list,'Robot Controller Name'),'bad','FTC-o21m is not ####-RC');
  assert.equal(value(list,'Robot Controller'),'11.2.0');assert.equal(mark(list,'Robot Controller'),'warn','obsolete in November 2026');
  assert.equal(value(list,'Matches DS version'),'No, the DS version is 11.1');assert.equal(mark(list,'Matches DS version'),'warn');
  assert.equal(value(list,'Driver Station'),'Not installed');assert.equal(mark(list,'Driver Station'),'ok');
  assert.equal(I.passes(list),false,'the name fails inspection');
});
test('a legal Control Hub passes, warnings and all',()=>{
  const list=I.rows({...REAL,name:'24038-RC',aVmj:12,aVmn:0,bldTs:'2026-09-07T09:45:36.180-0700'},{kind:'rc',viewer:{major:12,minor:0},now:NOV_2026});
  assert.equal(I.passes(list),true);assert.equal(mark(list,'Robot Controller'),'ok');assert.equal(value(list,'Matches DS version'),'Yes');
  assert.equal(mark(I.rows({...REAL,name:'24038-B-RC'},{now:NOV_2026}),'Robot Controller Name'),'ok','a spare letter is allowed');
  assert.equal(mark(I.rows({...REAL,name:'24038-b-RC'},{now:NOV_2026}),'Robot Controller Name'),'bad','the letter is a capital');
});
test('each failing setting is red',()=>{
  const list=I.rows({...REAL,bt:true,pw:true,wfEn:false,chOsNum:5,fw:'[Control Hub] 1.7.2',sdk:22},{now:NOV_2026});
  for(const l of ['Bluetooth','RC Password','Wi-Fi Enabled','Control Hub OS Version','Hub Firmware','Android Version'])assert.equal(mark(list,l),'bad',l);
});
test('obsolete follows the season: built before August, from October on',()=>{
  assert.equal(I.obsolete('2026-07-01',new Date(2026,9,1)),true);assert.equal(I.obsolete('2026-09-07',new Date(2026,9,1)),false);
  assert.equal(I.obsolete('2026-07-01',new Date(2026,8,1)),false,'before October, last August is the cutoff');assert.equal(I.obsolete('',NOV_2026),true);
});
test('a phone as Robot Controller shows Airplane Mode, and Location from Android 8',()=>{
  const list=I.rows({mfr:'motorola',mdl:'moto e5',os:'8.1',sdk:27,am:true,loc:true,bt:false,wfEn:true,wfConn:false,name:'1234-RC',rcIn:true,aVmj:12,aVmn:0,bldTs:'2026-09-07'},{now:NOV_2026});
  assert.equal(mark(list,'Airplane Mode'),'ok');assert.equal(mark(list,'Location services'),'ok');assert.equal(list.some(x=>x.label==='RC Password'),false);
});
test('a Driver Station report checks its name against the robot it is connected to',()=>{
  const ds={mfr:'REV Robotics',mdl:'Driver Hub',os:'10',sdk:29,dhOs:'1.2.0',dhOsNum:21,bat:.9,bt:false,loc:true,wfEn:true,wfConn:true,name:'24038-DS',connectedToName:'24038-RC',rcIn:false,dsIn:true,aVmj:12,aVmn:0,aVpt:0,bldTs:'2026-09-07'};
  const list=I.rows(ds,{kind:'ds',now:NOV_2026});assert.equal(mark(list,'Driver Station Name'),'ok');assert.equal(mark(list,'Robot Controller Name'),'ok');assert.equal(value(list,'Driver Station'),'12.0.0');assert.equal(I.passes(list),true);
  assert.equal(mark(I.rows({...ds,connectedToName:'FTC-o21m'},{kind:'ds',now:NOV_2026}),'Robot Controller Name'),'bad');
});
test('each red or orange mark says what to change',()=>{
  const list=I.rows(REAL,{kind:'rc',viewer:{major:11,minor:1},now:NOV_2026});
  assert.match(list.find(x=>x.label==='Robot Controller Name').fix,/team number and -RC.*R705/);
  assert.match(list.find(x=>x.label==='Robot Controller').fix,/update the Robot Controller app/);
  assert.equal(list.find(x=>x.label==='Bluetooth').fix,undefined,'nothing to change on a green row');
});
