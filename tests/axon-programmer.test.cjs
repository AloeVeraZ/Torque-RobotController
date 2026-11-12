'use strict';
// Calibrate's Axon programmer against a simulated V2 programmer: the settings maps, identification, reads and writes, firmware
// files and flashing, moved from Axon Bridge's self test, whose expected bytes come from Axon's own apps and firmware.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const S=require('../src/axon-servo.cjs'),{AxonService,UsbHelper}=require('../src/axon-programmer.cjs'),{SimLink,simTransport,makeBlock,firmwareText,encryptV1,encryptV2,installFirmware,TEST_KEYS}=require('./fixtures/axon-sim.cjs');
S.useKeys(TEST_KEYS);
const onlyChanged=(a,b,...allowed)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i]&&!allowed.includes(i))assert.fail(`byte ${i} changed unexpectedly`);};
const statusReply=(ok,type,b6,fam,b8)=>{const r=Buffer.alloc(64);r[0]=4;r[1]=ok;r[4]=0x8A;r[5]=type;r[6]=b6;r[7]=fam;r[8]=b8;return r;};
const edit=(schema,raw,changes)=>{const b=Buffer.from(raw),basis=schema.decode(raw);schema.encode(b,{...basis,...changes},basis);return b;};

test('V1 servo settings decode and encode to the bytes Axon\'s V1 app uses',()=>{
  const s=S.schemaFor('v1','servo'),raw=makeBlock('v1','servo','AXONTEST'),v=s.decode(raw);
  assert.equal(v.angle,202);assert.equal(v.neutral,0);assert.equal(v.range,0);assert.equal(v.sens,1);assert.equal(v.pwm,255);assert.equal(v.damping,100);assert.deepEqual([v.softstart,v.olp,v.inversion],[1,1,0]);assert.deepEqual([v.ol1p,v.ol3t],[153,103]);
  const alt=Buffer.from(raw);alt[0x26]=0x40;alt[0x13]=180;alt[0x27]=1;alt[0x28]=44;assert.deepEqual([s.decode(alt).pwm,s.decode(alt).damping],[180,300],'bit 0x40 of byte 0x26 selects the other power and damping');
  assert.deepEqual(edit(s,raw,{}),raw,'no edits leave it byte for byte');
  let b=edit(s,raw,{pwm:200});assert.deepEqual([b[0x11],b[0x12],b[0x13],b[0x0F]],[200,200,200,180]);onlyChanged(raw,b,0x0F,0x11,0x12,0x13);
  b=edit(s,raw,{damping:300});for(const at of [0x0A,0x27,0x29,0x2B])assert.deepEqual([b[at],b[at+1]],[1,44]);onlyChanged(raw,b,0x0A,0x0B,0x27,0x28,0x29,0x2A,0x2B,0x2C);
  b=edit(s,raw,{angle:90});assert.deepEqual([b[4],b[5]],[90,90]);
  assert.equal(edit(s,raw,{neutral:-5})[6],123);
  for(const [i,byte] of [[0,0x10],[2,0x30],[3,0x40]]){b=edit(s,raw,{sens:i});assert.equal(b[0x0C],byte);assert.equal(s.decode(b).sens,i);}
  for(const [i,a,c,d,e,f] of [[1,0x32,0x3E,0x15,0x88,0],[2,0x2D,0x75,0x1A,0x51,0],[3,0x19,0x1F,0x0A,0xC4,8],[4,0x0B,0x3E,0x03,0x1C,4]]){b=edit(s,raw,{range:i});assert.deepEqual([b[0],b[1],b[2],b[3],b[0x25]&0x0C],[a,c,d,e,f]);assert.equal(s.decode(b).range,i);}
  b=edit(s,raw,{inversion:1});assert.equal(b[0x25]&3,3,'inversion sets bit 1 and flips bit 0');const off=Buffer.from(b),on=s.decode(b);s.encode(off,{...on,inversion:0},on);assert.equal(off[0x25]&3,0);
  for(const [i,bits] of [[1,0x40],[2,0x60]]){b=edit(s,raw,{lostppm:i});assert.equal(b[0x25]&0x60,bits);assert.equal(s.decode(b).lostppm,i);}
  b=edit(s,raw,{ol2p:200,ol3t:50});assert.deepEqual([b[0x37],b[0x3A]],[200,50]);onlyChanged(raw,b,0x37,0x3A);
  assert.equal(s.sanity({data:raw,validLen:95}),null);assert.notEqual(s.sanity({data:Buffer.alloc(95),validLen:95}),null,'an all-zero block fails');
});

test('V1 continuous rotation settings',()=>{
  const s=S.schemaFor('v1','cr'),raw=makeBlock('v1','cr','AXONTEST'),v=s.decode(raw);assert.deepEqual([v.pwm,v.proptl],[255,60]);
  const b=edit(s,raw,{pwm:180,proptl:99,inversion:1});assert.deepEqual([b[0x12],b[0x36],b[0x25]&3],[180,99,3]);onlyChanged(raw,b,0x12,0x36,0x25);
});

test('V2 servo settings decode and encode to the bytes Axon\'s MK2 app uses',()=>{
  const s=S.schemaFor('v2','servo'),raw=makeBlock('v2','servo','MAXMK2'),v=s.decode(raw);
  assert.deepEqual([v.damping,v.pwm,v.right,v.left,v.sens,v.name],[60,255,90,90,2,'MAXMK2']);
  assert.deepEqual(edit(s,raw,{}),raw);
  for(const [i,byte] of [[0,150],[1,100],[3,25]]){const b=edit(s,raw,{sens:i});assert.equal(b[2],byte);assert.equal(s.decode(b).sens,i);}
  let b=edit(s,raw,{neutral:-7});assert.deepEqual([b[22],b[23]],[0xF9,0xFF]);assert.equal(s.decode(b).neutral,-7);onlyChanged(raw,b,22,23);
  b=edit(s,raw,{softstart:11});assert.equal(b[10],255);assert.equal(s.decode(b).softstart,11);assert.equal(edit(s,raw,{softstart:4})[10],4);
  b=edit(s,raw,{inversion:1,beep:0});assert.deepEqual([b[20]&1,b[26]&1],[1,0]);
  for(const [i,bits] of [[1,0x40],[2,0x48]]){b=edit(s,raw,{lostppm:i});assert.equal(b[20]&0x48,bits);assert.equal(s.decode(b).lostppm,i);}
  for(const [i,bits,proto] of [[1,0x80,220],[2,0x10,0],[3,0x80,143]]){b=edit(s,raw,{signal:i});assert.equal(b[20]&0x90,bits);if(proto)assert.equal(b[18],proto);assert.equal(s.decode(b).signal,i);}
  const sig=edit(s,raw,{signal:1}),was=s.decode(sig);s.encode(sig,{...was,signal:0},was);assert.equal(sig[20]&0x90,0);assert.equal(s.decode(sig).signal,0);
  b=edit(s,raw,{name:'ROBOT'});assert.equal(b.subarray(32,44).toString('latin1'),'ROBOT*******');assert.equal(s.decode(b).name,'ROBOT');onlyChanged(raw,b,32,33,34,35,36,37,38,39,40,41,42,43);
  b=edit(s,raw,{ol1p:10,ol2p:11,ol3p:12,ol1t:13,ol2t:14,ol3t:15});assert.deepEqual([...b.subarray(12,18)],[10,11,12,13,14,15]);
});

test('V2 continuous rotation: Axon\'s four settings, and the stop band Advanced adds, on the same byte as servo mode',()=>{
  const s=S.schemaFor('v2','cr'),raw=makeBlock('v2','cr','MAXMK2'),v=s.decode(raw);assert.deepEqual([v.proptl,v.pwm,v.sens],[60,255,1]);
  let b=edit(s,raw,{pwm:100,proptl:33,inversion:1,beep:0});assert.deepEqual([b[6],b[15],b[20]&1,b[26]&1],[100,33,1,0]);onlyChanged(raw,b,6,15,20,26);
  for(const [i,byte] of [[0,150],[2,50],[3,25]]){b=edit(s,raw,{sens:i});assert.equal(b[2],byte);onlyChanged(raw,b,2);assert.equal(s.decode(b).sens,i);}
  assert.equal(s.fields.filter(f=>f.advanced).map(f=>f.key).join(),'sens','it is the only field beyond Axon\'s app');
  assert.ok(!S.schemaFor('v1','servo').fields.some(f=>f.advanced)&&!S.schemaFor('v1','cr').fields.some(f=>f.advanced)&&!S.schemaFor('v2','servo').fields.some(f=>f.advanced),'no other schema offers anything extra');
});

test('every setting explains itself, and a model\'s factory values can be previewed with no USB',()=>{
  for(const [f,m] of [['v1','servo'],['v1','cr'],['v2','servo'],['v2','cr']])for(const field of S.schemaFor(f,m).fields){assert.ok(field.short&&field.short.length<=30,`${f} ${m} ${field.key}: "${field.short}" must fit beside the control`);assert.ok(field.what&&field.what.length>field.short.length,`${f} ${m} ${field.key} needs a longer explanation`);}
  const s=new AxonService({transport:{supported:true}}),p=s.preview('max2','cr');assert.equal(p.schema.title,'V2 continuous rotation');assert.deepEqual([p.values.pwm,p.values.proptl,p.values.sens],[255,30,1]);assert.equal(s.preview('mini1','servo').values.pwm,200);assert.throws(()=>s.preview('nope','cr'),/no firmware/);assert.throws(()=>s.preview('max2','swerve'),/no firmware/);
});

test('the hidden factory-tuning bytes are never offered, and bad values never reach a servo',()=>{
  for(const [f,m] of [['v1','servo'],['v1','cr'],['v2','servo'],['v2','cr']])for(const key of ['sysamp','minpower'])assert.throws(()=>S.checkChanges(S.schemaFor(f,m),{[key]:50}),/no setting/);
  const s=S.schemaFor('v2','servo');
  assert.throws(()=>S.checkChanges(s,{pwm:24}),/between 25 and 255/);assert.throws(()=>S.checkChanges(s,{pwm:256}),/between/);assert.throws(()=>S.checkChanges(s,{pwm:66.5}),/between/);assert.throws(()=>S.checkChanges(s,{sens:4}),/between/);assert.throws(()=>S.checkChanges(s,{inversion:2}),/between/);
  assert.throws(()=>S.checkChanges(s,{name:'THIRTEEN CHAR'}),/12 plain/);assert.throws(()=>S.checkChanges(s,{name:'a*b'}),/12 plain/);
  assert.deepEqual(S.checkChanges(s,{pwm:168,name:'ARM'}),{pwm:168,name:'ARM'});
});

test('the decoders read Axon\'s real factory data',()=>{
  const m=c=>S.modelByCode(c),v1=S.schemaFor('v1','servo'),max=S.factoryBlock(m('max1'),'servo');
  assert.equal(max.length,95);let v=v1.decode(max);assert.equal(v.angle,130);assert.equal(max[4],max[5]);assert.deepEqual([v.range,v.neutral,v.pwm,max[0x0F],v.damping],[0,0,230,210,85]);assert.deepEqual([v.olp,v.lostppm,v.sens],[1,2,0]);
  const block={family:'v1',data:max,validLen:95};assert.equal(S.blockName(block),'SA81BHMW');assert.equal(S.blockMade(block),'2022/10/15');assert.equal(v1.sanity(block),null);assert.equal(S.modelByName('SA81BHMW').code,'max1');
  const mini=S.factoryBlock(m('mini1'),'servo');v=v1.decode(mini);assert.deepEqual([v.pwm,mini[0x0F],v.damping],[200,180,65]);assert.equal(S.modelByName(S.blockName({family:'v1',data:mini,validLen:95})).code,'mini1');
  v=S.schemaFor('v1','cr').decode(S.factoryBlock(m('max1'),'cr'));assert.deepEqual([v.pwm,v.proptl],[220,30]);
  for(const code of ['max2','mini2']){const b=S.factoryBlock(m(code),'servo'),s=S.schemaFor('v2','servo');assert.equal(b.length,59);v=s.decode(b);assert.deepEqual([v.left,v.right,v.neutral,v.sens,v.pwm,v.ol1p,v.ol1t,v.ol3t,v.beep,v.softstart],[250,250,0,3,255,202,52,156,1,11]);
    const blk={family:'v2',data:b,validLen:59};assert.equal(s.sanity(blk),null);assert.equal(S.blockMade(blk),'2025/08/20');assert.equal(S.modelByName(S.blockName(blk)).code,code);}
  v=S.schemaFor('v2','cr').decode(S.factoryBlock(m('max2'),'cr'));assert.deepEqual([v.pwm,v.proptl,v.sens],[255,30,1],'continuous rotation ships at Medium');
  for(const model of S.MODELS)for(const mode of ['servo','cr']){const s=S.schemaFor(model.family,mode),raw=S.factoryBlock(model,mode);assert.deepEqual(edit(s,raw,{}),raw,`${model.title} ${mode} no-edit round trip`);}
});

test('servo identification',()=>{
  let s=S.parseStatus(statusReply(1,3,1,1,0x0A));assert.deepEqual([s.family,s.mode,S.servoEditable(s)],['v1','servo',true]);
  s=S.parseStatus(statusReply(1,4,1,1,0x0A));assert.deepEqual([s.family,s.mode,S.servoEditable(s)],['v1','cr',true]);
  s=S.parseStatus(statusReply(1,2,1,1,0x0A));assert.deepEqual([s.family,S.servoEditable(s)],['v1',false],'type 2 is seen but not editable, as in the V1 app');
  s=S.parseStatus(statusReply(1,0x34,0x11,0x22,5));assert.deepEqual([s.family,s.mode,s.firmware],['v2','servo','AISV112205']);
  for(const b6 of [0x41,0x31])assert.equal(S.parseStatus(statusReply(1,0x34,b6,0x22,5)).mode,'cr');
  assert.ok(!S.servoPresent(S.parseStatus(statusReply(0,3,1,1,0))),'status 0 means no servo');
  s=S.parseStatus(statusReply(1,9,9,9,9));assert.deepEqual([s.family,S.servoEditable(s)],['unknown',false],'an unknown ID is never editable');
});

test('the real status replies recorded from both programmers',()=>{
  const r=hex=>{const b=Buffer.alloc(64);Buffer.from(hex.replace(/ /g,''),'hex').copy(b);return b;};
  assert.deepEqual(['family','mode','firmware'].map(k=>S.parseStatus(r('04 01 22 22 8A 34 31 22 08'))[k]),['v2','cr','AISV312208'],'MINI MK2 in CR on the V2 programmer');
  assert.equal(S.parseStatus(r('04 01 22 22 8A 34 11 22 08')).mode,'servo');
  assert.equal(S.parseStatus(r('04 FA 00 22 8A')).family,'none','no servo on the V2 programmer');
  assert.deepEqual(['family','mode'].map(k=>S.parseStatus(r('04 01 00 01 01 04 02 01 08'))[k]),['v1','cr'],'V1 MAX in CR on the V1 programmer');
  assert.equal(S.parseStatus(r('04 01 FA 00 01')).family,'none','no servo on the V1 programmer');
});

test('reading and writing through the programmer',async()=>{
  let link=new SimLink('v1','servo','AXONTEST'),p=new S.Programmer(link);
  assert.ok(await p.hello());let t=await p.telemetry();assert.ok(Math.abs(t.volts-5)<0.1&&!t.powerOn);assert.equal(t.outputPulse,1500);assert.ok(!S.servoPresent(await p.status()),'an unpowered servo does not answer');
  await p.setServoPower(true);assert.ok((await p.telemetry()).powerOn);const st=await p.status();assert.deepEqual([st.family,st.mode],['v1','servo']);
  let {block}=await p.readBlock('v1');assert.deepEqual([block.validLen,block.data[90],S.blockName(block),S.blockMade(block)],[95,0x5A,'AXONTEST','2023/03/12']);
  block.data[0x12]=123;block.data[90]=0x33;assert.equal(await p.writeBlock(block),null);assert.equal(link.writeFrames,2,'V1 writes use two frames');assert.deepEqual([link.block[0x12],link.block[90]],[123,0x33]);
  link=new SimLink('v1','servo','AXONTEST',{powerOn:true,rejectSecondChunk:true});p=new S.Programmer(link);({block}=await p.readBlock('v1'));assert.deepEqual([block.validLen,S.blockName(block)],[59,null],'second chunk refused: the first is still usable');
  const keep=link.block[90];block.data[0x12]=77;await p.writeBlock(block);assert.deepEqual([link.writeFrames,link.block[0x12],link.block[90]],[1,77,keep],'it writes only what it read');
  link=new SimLink('v1','servo','AXONTEST',{powerOn:true,noLengthEcho:true});p=new S.Programmer(link);assert.equal((await p.readBlock('v1')).block.validLen,95,'no length echo: accepted after two identical reads');
  link=new SimLink('v1','servo','AXONTEST',{powerOn:true,readsFail:true});p=new S.Programmer(link);assert.ok((await p.readBlock('v1')).error,'a failed read is an error, not bad data');
  link=new SimLink('v2','servo','MAXMK2',{powerOn:true});p=new S.Programmer(link);({block}=await p.readBlock('v2'));assert.deepEqual([block.data.length,S.blockName(block)],[59,'MAXMK2']);
  block.data[43]=0x41;block.data[44]=0x99;await p.writeBlock(block);assert.deepEqual(link.lastWrites.at(-1),{addr:0,len:44});assert.equal(link.block[43],0x41);assert.notEqual(link.block[44],0x99,'V2 writes stop at byte 43 and protect the date');
  link.block[6]=1;assert.ok(await p.factoryDefault());assert.equal(link.block[6],255);
});

test('settings files match what Axon\'s apps read',()=>{
  const v1=S.factoryBlock(S.MODELS[0],'servo'),v2=S.factoryBlock(S.MODELS[3],'servo'),f1=S.packConfig('v1',v1),f2=S.packConfig('v2',v2);
  assert.deepEqual([f1.length,f1[0x12],f1[94]],[95,v1[0x12],v1[94]]);assert.equal(S.configProblem('v1',f1),null);assert.ok(S.configProblem('v1',Buffer.alloc(50)));
  assert.deepEqual([f2.length,f2[93],f2[94],f2[6]],[95,0x56,0x34,v2[6]]);assert.equal(S.configProblem('v2',f2),null);
  const old=Buffer.from(f2);old[94]=0x30;assert.ok(S.configProblem('v2',old),'an old .svp is refused like Axon\'s app does');assert.ok(S.configProblem('v2',Buffer.alloc(96)));
  assert.equal(S.schemaFor('v2','servo').decode(f2).pwm,S.schemaFor('v2','servo').decode(v2).pwm);
});

test('firmware file formats',()=>{
  const text=firmwareText(0x12,0xAB,'AXONTEST','cr',40);
  let a=S.loadFirmware(encryptV1(text),'a.sfw');assert.deepEqual([a.family,a.modelA,a.modelB,a.name,a.records,a.erase,a.badChecksums,a.bytes],['v1',0x12,0xAB,'AXONTEST',40,2,0,640]);
  a=S.loadFirmware(encryptV2(text),'b.sfm');assert.deepEqual([a.family,a.name,a.records],['v2','AXONTEST',40]);
  const bad=encryptV1(text);bad[3]^=0xFF;assert.throws(()=>S.loadFirmware(bad,'a.sfw'));assert.throws(()=>S.loadFirmware(encryptV1(text),'b.sfm'),'the wrong key is rejected');assert.throws(()=>S.loadFirmware(Buffer.alloc(33),'b.sfm'));assert.throws(()=>S.loadFirmware(encryptV1(text),'a.bin'));
});

// On the computer that has Axon Bridge installed and a key file imported, Axon's eight real files must still match the pins and flash cleanly against the simulator.
const REAL=process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Programs','Axon Bridge','firmware'),REAL_KEYS=process.env.APPDATA&&path.join(process.env.APPDATA,'Deck Driver Station','axon-keys.json');
test('Axon\'s real firmware files match the pinned hashes and flash against the simulator',{skip:REAL&&fs.existsSync(REAL)&&REAL_KEYS&&fs.existsSync(REAL_KEYS)?false:'Axon\'s firmware and a key file are not on this computer'},async t=>{
  t.after(()=>S.useKeys(TEST_KEYS));S.useKeys(S.parseKeys(fs.readFileSync(REAL_KEYS,'utf8')));
  for(const f of S.FIRMWARE){const data=fs.readFileSync(path.join(REAL,f.fileName));assert.equal(data.length,f.size,f.fileName);assert.equal(S.sha256(data),f.sha256,f.fileName);
    const image=S.loadFirmware(data,f.fileName),model=S.modelByCode(f.code);assert.equal(image.name,model.factoryName,f.fileName);assert.equal(image.badChecksums,0,f.fileName);
    const link=new SimLink(model.family,f.mode==='cr'?'servo':'cr',model.factoryName,{powerOn:true,modelA:image.modelA,modelB:image.modelB}),r=await S.flash(new S.Programmer(link),image,model.factoryName);assert.ok(r.ok,`${f.fileName}: ${r.error}`);assert.equal(link.badRecords,0);assert.equal(link.dataRecords,image.records);assert.equal(link.eraseRecords,image.erase);
    // What Torque shows as factory values is what this firmware really installs.
    const raw=S.factoryBlock(model,f.mode),lines=image.lines.filter(l=>l.startsWith(':')&&l.slice(7,9)==='00'),mem=new Map();for(const l of lines){const n=parseInt(l.slice(1,3),16),a=parseInt(l.slice(3,7),16);for(let i=0;i<n;i++)mem.set(a+i,parseInt(l.slice(9+i*2,11+i*2),16));}
    const base=model.family==='v1'?0x1C00:0x1C01;for(let i=0;i<raw.length;i++)assert.equal(mem.get(base+i),raw[i],`${f.fileName} byte ${i}`);}
});

test('flashing: every check runs before anything is erased',async()=>{
  for(const family of ['v1','v2']){
    const n=family==='v1'?'AXONTEST':'MAXMK2',hw=family==='v1'?1:0x22,img=(a,b,name,mode)=>S.parseFirmware(firmwareText(a,b,name,mode,60),family);
    let link=new SimLink(family,'servo',n,{powerOn:true}),p=new S.Programmer(link),r=await S.flash(p,img(8,hw,n,'cr'),n);
    assert.ok(r.ok,r.error);assert.deepEqual([link.eraseRecords,link.dataRecords,link.badRecords,link.flashedBytes],[2,60,0,960],`${family}: every record decrypted`);assert.deepEqual([link.mode,link.exitFrames],['cr',1]);assert.equal((await p.status()).mode,'cr');
    r=await S.flash(p,img(8,hw,n,'servo'),n);assert.ok(r.ok&&link.mode==='servo');
    link=new SimLink(family,'servo',n,{powerOn:true});r=await S.flash(new S.Programmer(link),img(0x99,0x22,n,'cr'),n);assert.deepEqual([r.ok,r.changed,link.eraseRecords,link.mode,link.exitFrames],[false,false,0,'servo',1],'the wrong hardware ID stops first');
    link=new SimLink(family,'servo',n,{powerOn:true});r=await S.flash(new S.Programmer(link),img(8,hw,'SOMEONEX','cr'),n);assert.deepEqual([r.ok,link.eraseRecords,link.exitFrames],[false,0,1],'the wrong servo name stops first');
    link=new SimLink(family,'servo',n,{powerOn:true});p=new S.Programmer(link);r=await S.flash(p,img(8,hw,n,'cr'),null);assert.deepEqual([r.ok,link.eraseRecords],[false,0],'an unknown name stops unless overridden');r=await S.flash(p,img(8,hw,n,'cr'),null,{allowUnknownName:true});assert.ok(r.ok,'recovery override');
    link=new SimLink(family,'servo',n,{powerOn:true,failOnDataRecord:10});r=await S.flash(new S.Programmer(link),img(8,hw,n,'cr'),n);assert.deepEqual([r.ok,r.changed,link.dataRecords,link.exitFrames],[false,true,10,1],'a bad record stops at once');
  }
  assert.equal(S.FIRMWARE.length,8);for(const m of S.MODELS)for(const mode of ['servo','cr'])assert.ok(S.FIRMWARE.some(f=>f.code===m.code&&f.mode===mode));
});

// ---- the service, end to end against the simulator
function service(link,options={},transportOptions){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'torque-axon-')),catalog=installFirmware(path.join(dir,'firmware')),states=[],transport=simTransport(link,transportOptions);
  const s=new AxonService({transport,firmwareDir:path.join(dir,'firmware'),logFile:path.join(dir,'usb.log'),catalog,onState:x=>states.push(x),...options});return {s,dir,transport,states,catalog};}
const until=async(test,ms=8000,what='condition')=>{const end=Date.now()+ms;for(;;){const v=test();if(v)return v;if(Date.now()>end)throw Error(`Timed out waiting for ${what}.`);await new Promise(r=>setTimeout(r,20));}};
const ready=(s,what='settings')=>until(()=>s.state().settings,8000,what);

test('the service finds the programmer, powers the servo, reads it and confirms a write',async()=>{
  const link=new SimLink('v2','servo','MAXMK2',{inputPulse:1500}),{s,dir}=service(link);s.start();
  try{await ready(s);const st=s.state();
    assert.equal(st.programmer.ready,true);assert.equal(st.programmer.info.product,'Simulated V2 programmer');assert.ok(link.powerOn,'it powered the servo pins');assert.deepEqual([st.servo.family,st.servo.mode,st.servo.firmware,st.servo.model.code,st.servo.name],['v2','servo','AISV112205','max2','MAXMK2']);
    assert.ok(st.telemetry.volts>4.9);assert.deepEqual([st.telemetry.inputValid,st.telemetry.inputPulse,st.telemetry.inputPeriod],[true,1500,20000]);assert.equal(st.settings.factory.left,250,'factory values come with it');
    assert.deepEqual(st.servo.unconfirmed.map(u=>[u.at,u.name,u.value]),[[0,'SysAmp',40],[7,'MinPower',20]],'hidden bytes are reported');
    const before=Buffer.from(link.block),r=await s.write({pwm:168,left:200});assert.equal(r.ok,true,r.message);onlyChanged(before,link.block,6,9);assert.deepEqual([link.block[6],link.block[9]],[168,200]);
    assert.deepEqual(r.confirmed.map(c=>[c.key,c.was,c.asked,c.now,c.took]),[['pwm',255,168,168,true],['left',90,200,200,true]]);assert.equal(s.state().settings.values.pwm,168,'the page sees what the servo holds now');
    assert.equal((await s.write({pwm:168})).message,'The servo already has these settings.');
    const frames=link.writeFrames;assert.match((await s.write({minpower:9})).message,/no setting.*Nothing was written/);assert.equal(link.writeFrames,frames,'a refused change writes nothing');
    link.writesIgnored=true;const bad=await s.write({pwm:100});assert.equal(bad.ok,false);assert.match(bad.message,/did not keep/);assert.equal(bad.confirmed[0].took,false);assert.equal(bad.confirmed[0].now,168,'it reports what the servo really holds');link.writesIgnored=false;
    assert.ok((await s.defaults()).ok);assert.equal(s.state().settings.values.pwm,255);assert.ok(fs.readFileSync(path.join(dir,'usb.log'),'utf8').includes('TX 04 CB'),'every frame is logged');
  }finally{await s.dispose();}
});

test('the service switches mode by flashing, waits for the servo, and reads its new settings',async()=>{
  const link=new SimLink('v2','servo','MAXMK2'),{s,catalog}=service(link);s.start();
  try{await ready(s);assert.equal(s.firmwareStatus('max2','cr').have,true);const r=await s.flash({code:'max2',mode:'cr'});assert.equal(r.ok,true,r.message);assert.equal(link.mode,'cr');assert.equal(r.mode,'cr');
    await until(()=>s.state().settings?.schema.mode==='cr',8000,'the new settings');assert.equal(s.state().settings.schema.title,'V2 continuous rotation');assert.equal(s.state().settings.values.sens,1);
    const w=await s.write({sens:0});assert.ok(w.ok,w.message);assert.equal(link.block[2],150,'the stop band reached its byte');
    assert.throws(()=>s.flash({code:'nope',mode:'cr'}),/no firmware/);assert.equal(catalog.length,8);
  }finally{await s.dispose();}
});

test('the service refuses firmware it cannot match, and asks when the name cannot be read',async()=>{
  // A V1 servo is switched through the V1 programmer (a V2 programmer never answers one).
  const link=new SimLink('v1','servo','SA81BHMW',{rejectSecondChunk:true,modelB:1}),{s,dir,catalog,transport}=service(link);transport.plugged=false;transport.v1Programmer=true;link.powerOn=true;s.start();
  try{await ready(s);assert.equal(s.state().servo.name,null);assert.throws(()=>s.flash({code:'max1',mode:'cr'}),e=>e.code==='NAME_UNKNOWN');assert.equal(link.bootEntries,0,'nothing happened yet');
    const r=await s.flash({code:'max1',mode:'cr',allowUnknownName:true});assert.ok(r.ok,r.message);
    fs.rmSync(path.join(dir,'firmware',catalog.find(f=>f.code==='max1'&&f.mode==='servo').fileName));assert.throws(()=>s.flash({code:'max1',mode:'servo',allowUnknownName:true}),e=>e.code==='FIRMWARE_NEEDED');
  }finally{await s.dispose();}
  {const v1OnV2=new SimLink('v1','servo','SA81BHMW'),one=service(v1OnV2);one.s.start();try{await ready(one.s);const r=await one.s.flash({code:'max1',mode:'cr'});assert.deepEqual([r.ok,r.changed,v1OnV2.bootEntries],[false,false,0]);assert.match(r.message,/V1 servo is switched through the V1 programmer/);}finally{await one.s.dispose();}}
  const wrong=new SimLink('v2','servo','MINIMK2'),two=service(wrong);two.s.start();try{await ready(two.s);const r=await two.s.flash({code:'max2',mode:'cr'});assert.deepEqual([r.ok,r.changed,wrong.eraseRecords],[false,false,0]);assert.match(r.message,/Nothing was changed/);}finally{await two.s.dispose();}
});

test('Recover writes firmware to a servo that no longer shows up',async()=>{
  const link=new SimLink('v2','servo','MAXMK2',{attached:false,attachOnExit:true}),{s}=service(link);s.start();
  try{await until(()=>s.state().telemetry);assert.equal(s.state().servo.present,false);const r=await s.flash({code:'max2',mode:'cr',recovery:true});assert.ok(r.ok,r.message);assert.equal(link.mode,'cr');await ready(s);assert.equal(s.state().servo.model.code,'max2');}finally{await s.dispose();}
});

test('downloads are thrown away unless they are exactly the listed file',async()=>{
  const link=new SimLink('v2','servo','MAXMK2'),good=Buffer.from('x'.repeat(13152)),fetched=[],dir=fs.mkdtempSync(path.join(os.tmpdir(),'torque-axon-'));
  const s=new AxonService({transport:simTransport(link),firmwareDir:dir,fetchFile:async url=>{fetched.push(url);return good;}});
  await assert.rejects(s.download('max2','cr'),/not the file Torque expects/);assert.equal(fs.readdirSync(dir).length,0,'nothing saved');assert.ok(fetched[0].startsWith('https://cdn.shopify.com/s/files/1/0657/9182/0008/files/Axon_MAX_MK2_CR_Mode.sfm'));assert.equal(s.firmwareStatus('max2','cr').have,false);
  // A file on disk that is not the listed one does not count either.
  fs.writeFileSync(path.join(dir,'Axon_MAX_MK2_CR_Mode.sfm'),good);assert.equal(s.firmwareStatus('max2','cr').have,false);
});

test('the service steps aside for Axon\'s app, and says what it found on USB',async()=>{
  const link=new SimLink('v2','servo','MAXMK2'),{s,transport}=service(link);transport.rivalTitles=['Axon Bridge'];s.start();
  try{await until(()=>s.state().programmer.rivals.length);assert.deepEqual(s.state().programmer.rivals,['Axon Bridge']);assert.equal(transport.opened,0,'it does not touch the programmer');
    await s.closeRivals();await ready(s);transport.rivalTitles=['Axon Software MK2'];await until(()=>s.state().programmer.rivals.length);assert.equal(s.state().settings,null);assert.ok(link.closed,'it let go of the device');
    // The V2 gone and a V1 programmer there: Torque opens the V1 one (Axon's V1 app has no handshake to wait for).
    transport.rivalTitles=[];await ready(s);const was=transport.opened;transport.plugged=false;transport.v1Programmer=true;link.flush=async()=>{throw new S.DeviceLost('unplugged');};await until(()=>transport.opened>was+1);assert.equal(s.state().servo.present,false);
  }finally{await s.dispose();}
  const silent=service(new SimLink('v2','servo','MAXMK2'),{},{silent:true});silent.s.start();try{await until(()=>silent.s.state().programmer.handshakeFailed);}finally{await silent.s.dispose();}
});

test('with both programmers plugged in it asks for one to be unplugged, and carries on once one is',async()=>{
  const link=new SimLink('v2','servo','MAXMK2'),{s,transport}=service(link);transport.v1Programmer=true;s.start();
  try{await until(()=>s.state().programmer.both,8000,'the two-programmer warning');assert.equal(transport.opened,0,'neither is opened');assert.ok(s.state().log.some(l=>/Unplug the one you are not using/.test(l.text)));
    transport.v1Programmer=false;await ready(s);assert.equal(s.state().programmer.both,false);
    transport.v1Programmer=true;await until(()=>s.state().programmer.both,8000,'the warning again when a second one is plugged in');assert.equal(s.state().settings,null);
  }finally{await s.dispose();}
});

test('Test moves a MK2 servo through the pulse and writes nothing; continuous rotation eases up to speed and stops with the pulse off',async()=>{
  const link=new SimLink('v2','servo','MAXMK2'),{s}=service(link);s.start();
  try{await ready(s);const frames=link.writeFrames;
    assert.throws(()=>s.test([{position:.5,hold:1}]),/1 to 5 moves/);assert.throws(()=>s.test([{position:.5,hold:1},{position:2,hold:1}]),/0 to 1/);assert.throws(()=>s.drive(.5),/continuous rotation/);
    const r=await s.test([{position:.5,hold:.3},{position:.75,hold:.3}]);assert.ok(r.ok,r.message);assert.deepEqual(link.pulses.filter(Boolean),[1500,2000]);assert.equal(link.out,0,'pulse off after');assert.equal(link.writeFrames,frames);
    const t=s.state().test;assert.ok(t.samples.length>10);assert.deepEqual(t.samples.map(x=>x[1]).filter((v,i,a)=>a.indexOf(v)===i),[1500,2000],'the programmer reports the pulse sent');
  }finally{await s.dispose();}
  const cr=new SimLink('v2','cr','MAXMK2'),b=service(cr);b.s.start();
  try{await ready(b.s);cr.pulses=[];b.s.drive(1);await until(()=>b.s.state().test?.us>=1950,4000,'full speed');const sent=cr.pulses.filter(Boolean);
    for(let i=1;i<sent.length;i++)assert.ok(Math.abs(sent[i]-sent[i-1])<=40,`no jump: ${sent[i-1]} to ${sent[i]}`);assert.equal(Math.max(...sent),1950,'MK2 full speed');
    b.s.drive(null);await until(()=>!b.s.state().busy,3000,'it stops');assert.equal(cr.out,0,'the pulse is off');assert.equal(b.s.state().test.running,false);
  }finally{await b.s.dispose();}
  const v1=new SimLink('v1','cr','SA81BHMW',{modelB:1}),c=service(v1);c.transport.plugged=false;c.transport.v1Programmer=true;v1.powerOn=true;c.s.start();
  try{await ready(c.s);assert.throws(()=>c.s.drive(.3),/V1 programmer has no pulse output/);}finally{await c.s.dispose();}
});

test('a V1 and a V2 programmer side by side: each service takes only its own, and both work at once',async()=>{
  const l1=new SimLink('v1','servo','SA81BHMW',{modelB:1}),l2=new SimLink('v2','cr','MINIMK2'),a=service(l1,{only:'v1'}),b=service(l2,{only:'v2'});
  // Each transport sees both programmers plugged in, as USB does; neither service asks for one to be unplugged.
  a.transport.v1Programmer=true;b.transport.v1Programmer=true;l1.powerOn=true;a.transport.find=async vid=>vid===S.VID_V1?[{path:'v1',vid,pid:S.PID,version:1,inLen:64,outLen:64,product:'USBBootloader V1.3'}]:vid===S.VID_V2?[{path:'v2',vid,pid:S.PID}]:[];
  a.s.start();b.s.start();
  try{await ready(a.s,'the V1 servo');await ready(b.s,'the MK2 servo');
    assert.deepEqual([a.s.state().programmer.kind,a.s.state().servo.family,a.s.state().programmer.both,a.s.state().only],['v1','v1',false,'v1']);assert.deepEqual([b.s.state().programmer.kind,b.s.state().servo.family,b.s.state().programmer.both],['v2','v2',false]);
    const [w1,w2]=await Promise.all([a.s.write({angle:150}),b.s.write({pwm:200})]);assert.ok(w1.ok&&w2.ok,`${w1.message} / ${w2.message}`);assert.equal(l1.block[4],150);assert.equal(l2.block[6],200);
    b.s.drive(.5);await until(()=>b.s.state().test?.us>1600,4000,'the MK2 servo spins');const r=await a.s.read();assert.ok(r.ok,'the V1 one reads meanwhile');b.s.drive(null);await until(()=>!b.s.state().busy,3000);
  }finally{await a.s.dispose();await b.s.dispose();}
});

test('a V1 servo on the V2 programmer is found through its bootloader: no settings, but its mode can be switched and it can be tested',async()=>{
  const link=new SimLink('v1','cr','SA81BHMW',{modelB:1,bootOnly:true}),{s}=service(link);s.start();
  try{await until(()=>s.state().servo.viaBoot,8000,'the V1 servo through its bootloader');
    // Found, and not moved: something may be attached to it. Its mode and model wait for the student to pick them or ask for Identify.
    assert.deepEqual([s.state().servo.family,s.state().servo.mode,s.state().servo.modeHow,s.state().servo.model],['v1','unknown',null,null]);assert.ok(!(link.pulses||[]).some(us=>us>0),'Torque does not move a servo by itself');assert.equal(s.state().servo.epoch,1,'the first servo found here');assert.ok(s.state().log.some(l=>/cannot read which V1 servo it is or its mode: pick them, or let Torque identify it by moving it slightly/.test(l.text)));
    await new Promise(r=>setTimeout(r,6500));assert.ok(!(link.pulses||[]).some(us=>us>0),'nor at the next bootloader check');
    const id=await s.identify();assert.deepEqual([id.ok,id.mode,id.model],[true,'cr','max1']);const moved=link.pulses.filter(us=>us>0);assert.ok(Math.max(...moved)<=1615&&Math.min(...moved)>=1385,'Identify never goes further than a nudge past the stop zone: '+[...new Set(moved)].join(' '));const st=s.state();
    assert.deepEqual([st.servo.family,st.servo.mode,st.servo.modeHow,st.servo.editable,st.settings],['v1','cr','measured',false,null],'its mode measured from how it moves, no settings');assert.equal(link.out,0,'the pulse is off again');assert.ok(link.exitFrames>=1,'it was let go again');assert.ok(st.log.some(l=>/settings need the V1 programmer/.test(l.text)));
    const same=await s.flash({code:'max1',mode:'cr',confirmed:'max1'});assert.deepEqual([same.ok,same.changed],[false,false]);assert.match(same.message,/already in continuous rotation/);assert.equal(link.dataRecords,0,'the same mode is not written again unless asked');
    const re=await s.flash({code:'max1',mode:'cr',again:true,confirmed:'max1'});assert.ok(re.ok,re.message);assert.ok(link.dataRecords>0,'asked for, it is written again');
    assert.throws(()=>s.flash({code:'max1',mode:'servo',confirmed:'mini1'}),/not the one confirmed/);assert.throws(()=>s.flash({code:'max1',mode:'servo'}),/not the one confirmed/);
    const r=await s.flash({code:'max1',mode:'servo',confirmed:'max1'});assert.ok(r.ok,r.message);assert.equal(link.mode,'servo','the firmware went through the bootloader');assert.equal(s.state().servo.mode,'servo','shown as the mode Torque wrote');assert.match(r.message,/cannot read this servo's mode back/);
    const t=await s.test([{position:.5,hold:.3},{position:.55,hold:.3}]);assert.ok(t.ok,t.message);assert.equal(link.out,0);
  }finally{await s.dispose();}
});

test('a MK2 servo on the V1 programmer is found through its bootloader and switched, with no Test; every model gets only its own firmware',async()=>{
  const link=new SimLink('v2','cr','MINIMK2',{bootOnly:true}),{s,transport,dir,catalog}=service(link);transport.plugged=false;transport.v1Programmer=true;link.powerOn=true;s.start();
  try{await until(()=>s.state().servo.viaBoot,10000,'the MK2 servo through its bootloader');const st=s.state();
    assert.deepEqual([st.programmer.kind,st.servo.family,st.servo.mode,st.servo.editable],['v1','v2','unknown',false],'no mode it could tell: the V1 programmer cannot move it');assert.ok(st.log.some(l=>/MK2 servo is on the V1 programmer/.test(l.text)));
    assert.throws(()=>s.test([{position:.5,hold:.3},{position:.6,hold:.3}]),/needs the V2 programmer/);assert.throws(()=>s.drive(.3),/V2 programmer/);
    // A MINI MK2's file chosen for a MAX MK2 is refused before anything is sent: the file names its model.
    const mini=path.join(dir,'firmware',catalog.find(f=>f.code==='mini2'&&f.mode==='servo').fileName);s.chooseFirmware('max2','servo',mini);
    const before=link.dataRecords;assert.throws(()=>s.flash({code:'max2',mode:'servo',confirmed:'max2'}),/firmware for "MINIMK2", not a V2 MAX/);assert.equal(link.dataRecords,before,'nothing written');
    const r=await s.flash({code:'mini2',mode:'servo',confirmed:'mini2'});assert.ok(r.ok,r.message);assert.equal(link.mode,'servo');assert.equal(s.state().servo.mode,'servo');assert.match(r.message,/V1 programmer/);
  }finally{await s.dispose();}
  for(const m of S.MODELS)for(const mode of ['servo','cr'])assert.match(S.FIRMWARE.find(f=>f.code===m.code&&f.mode===mode).fileName,m.family==='v1'?(m.code==='max1'?/^Axon_Max_/:/^Axon_Mini_/):(m.code==='max2'?/^Axon_MAX_MK2_/:/^Axon_MINI_MK2_/),`${m.code} ${mode} has its own file`);
});

// ---- What a real V1 MAX (SA81BHMW, continuous rotation firmware V020108) answered on each programmer, recorded 2026-11-10 with one
// on the V1 programmer and one on the V2 programmer. Only reads were sent. The telemetry lines are from Torque's own mode check on it.
const HEARD={
  v1:{status:'04 01 00 01 01 04 02 01 08',
    read0:'04 01 00 00 3B 3B D0 0B F6 24 21 00 03 00 0A 00 BA FA 00 00 DC 0C DC DC DC 05 05 05 05 0A 00 2D 00 2D 00 2D 00 00 00 00 00 01 A0 00 01 C2 01 C2 01 C2 00 00 00 0F 0A 16 00 00 A0 1E 80 50 40 78',
    read59:'04 01 00 3B 24 24 20 00 00 00 53 41 38 31 42 48 4D 57',link:'04 01'},
  v2:{hello:'04 01 00 00 00 22 00 FF 01 BB 07 D8 07 10 0D',status:'04 FA 00 22 8A',boot:'04 01 00 01 80 56 30 2E 33 08 01',exit:'04 01 00 FF 55 AA',link:'04 01',
    idle:'04 01 00 00 AF 05 DC 03 FF 03 D8 01 A6 00 0F 00 03 07 C6',up:'04 01 00 00 AF 06 72 03 FF 03 BA 01 BB 00 B4 01 03 07 C8',down:'04 01 00 00 AF 05 46 03 FF 03 C0 01 BD 00 A0 01 03 07 CA',
    // A real V1 MINI (continuous rotation) in the same check on the same programmer: the same bootloader reply, more current.
    miniUp:'04 01 00 00 AF 06 72 03 EF 03 A8 01 B8 00 F0 01 03 07 CE',miniDown:'04 01 00 00 AF 05 46 03 F0 03 A9 01 BA 00 DB 01 03 07 CB'}};
const real=hex=>{const b=Buffer.alloc(64);Buffer.from(hex.replace(/ /g,''),'hex').copy(b);return b;};
// A programmer that answers only with those recorded replies. asked counts each command sent to it.
class Replay{
  constructor(kind,mini=false){this.kind=kind;this.mini=mini;this.inbox=[];this.asked={};this.out=0;}
  async flush(){this.inbox.length=0;}async close(){}async read(){return this.inbox.shift()||null;}
  // The current of the crawl check as the real servos gave it (2026-11-10): nothing inside the stop zone, 48 counts at its edge
  // (MAX +30 and -55 µs, MINI +55 and -35 µs), and 80 µs further 121 and 119 counts for the MAX, 172 and 144 for the MINI.
  crawl(){const d=this.out?this.out-1500:0,[u,dn,nu,nd]=this.mini?[55,-35,172,144]:[30,-55,121,119],raw=d>=u+80?nu:d<=dn-80?nd:d>=u||d<=dn?48:15,b=real(HEARD.v2.idle);b[5]=this.out>>8;b[6]=this.out&255;b[13]=raw>>8;b[14]=raw&255;b[15]=this.out?1:0;return S.hex(b,19);}
  async write(tx){const c=tx[1],R=HEARD[this.kind];this.asked[c]=(this.asked[c]||0)+1;let r=null;
    if(this.kind==='v1')r=c===0x8A?R.status:c===0xCD?(tx[3]===0?R.read0:R.read59):c===0x90?R.link:null;
    // The V2 programmer refuses a read at once when no servo answered its 0x8A (04 CD 02 <address> <length>), and echoes a pulse.
    else if(c===0xCD)r=`04 CD 02 ${S.hex(tx.subarray(3,5))}`;
    else if(c===0xAC){this.out=(tx[5]<<8)|tx[6];r=`04 01 00 ${S.hex(tx.subarray(3,15))}`;}
    else r=c===0x91?R.hello:c===0x8A?R.status:c===0x80?R.boot:c===0x83?R.exit:c===0x90?R.link:c===0xAF?this.crawl():null;
    if(r)this.inbox.push(real(r));return true;}
}
const v1Finder=vid=>vid===S.VID_V1?[{path:'v1',vid,pid:S.PID,version:1,inLen:64,outLen:64,product:'USBBootloader V1.3'}]:[];

test('a real V1 MAX on the V1 programmer is named from its settings: the recorded replies',async()=>{
  const block={family:'v1',data:Buffer.concat([real(HEARD.v1.read0).subarray(5,64),real(HEARD.v1.read59).subarray(5,41)]),validLen:95};
  assert.equal(S.blockName(block),'SA81BHMW');assert.equal(S.modelByName(S.blockName(block)).code,'max1');assert.equal(S.blockMade(block),'2022/10/15');
  const link=new Replay('v1'),{s,transport}=service(link,{only:'v1'});transport.find=async vid=>v1Finder(vid);s.start();
  try{await ready(s,'the V1 MAX');const st=s.state();
    assert.deepEqual([st.programmer.kind,st.servo.family,st.servo.mode,st.servo.firmware,st.servo.name,st.servo.model.code,st.servo.viaBoot,st.servo.carried],['v1','v1','cr','V020108','SA81BHMW','max1',undefined,null]);
    assert.deepEqual([st.settings.values.pwm,st.settings.values.proptl,st.settings.values.inversion],[220,30,0]);assert.ok(!link.asked[0xCB]&&!link.asked[0x81]&&!link.asked[0x82],'nothing was written');
  }finally{await s.dispose();}
});

test('a real V1 MAX and a real V1 MINI on the V2 programmer: no name can be read, and they are told apart by the current of the mode check',async()=>{
  assert.equal(S.parseStatus(real(HEARD.v2.status)).family,'none','no answer to 0x8A');
  const link=new Replay('v2'),{s}=service(link,{only:'v2'});s.start();
  try{await until(()=>s.state().servo.viaBoot,10000,'the V1 MAX through its bootloader');assert.deepEqual([s.state().servo.mode,s.state().servo.model,link.asked[0xAC]&&link.out],['unknown',null,0],'found without being moved');
    await s.identify();const st=s.state();
    assert.deepEqual([st.servo.family,st.servo.hardware,st.servo.mode,st.servo.modeHow,st.servo.model?.code,st.servo.name,st.servo.carried,st.servo.guessed,st.servo.editable],['v1','0801','cr','measured','max1',null,null,{amps:.161},false],'the generation, the mode, and the model as measured: 121 and 119 counts');
    await until(()=>s.state().log.some(l=>/looks like a V1 MAX: Torque nudged it slightly and it drew 0\.16 A/.test(l.text)),4000,'it says what it measured');assert.throws(()=>s.flash({code:'max1',mode:'servo'}),/not the one confirmed/,'a measured model is never enough to write firmware');
    assert.ok(link.asked[0x8A]>=1&&link.asked[0x80]>=1&&link.asked[0x83]>=1);assert.ok(!link.asked[0xCB]&&!link.asked[0x81]&&!link.asked[0x82],'nothing was written');
    const q=new S.Programmer(link);q.kind='v2';await q.v1UpdateMode(true);await q.restartV1().catch(()=>{});assert.ok(!link.asked[0x90],'0x90 never goes to a V2 programmer: there it overwrites the bytes the programmer identifies itself with');
    const mini=service(new Replay('v2',true),{only:'v2'});mini.s.start();try{await until(()=>mini.s.state().servo.viaBoot,10000,'the V1 MINI through its bootloader');await mini.s.identify();assert.deepEqual([mini.s.state().servo.model?.code,mini.s.state().servo.guessed,mini.s.state().servo.name],['mini1',{amps:.212},null],'172 and 144 counts');}finally{await mini.s.dispose();}
    // Between the two, nothing is said.
    for(const [up,down,code] of [[121,119,'max1'],[130,133,'max1'],[133,134,null],[143,146,null],[146,147,'mini1'],[172,144,'mini1']]){s.creep={up:{at:25,raw:up},down:{at:-55,raw:down}};assert.equal(s.guessV1()?.code||null,code,`${up} + ${down} counts`);}
    const p=new S.Programmer(new Replay('v2'));p.kind='v2';const r=await p.readBlock('v1');assert.equal(r.block,undefined,'and its settings cannot be read there');assert.match(r.error,/did not return parameter data|error reading/);
  }finally{await s.dispose();}
});

// Two programmers, each with its own service, as the app runs them. nothing: no servo on those pins at all.
const nothing=link=>{link.attached=false;link.bootSilent=true;},pluggedBoot=link=>{link.bootSilent=false;};
test('a V1 servo read on the V1 programmer and then moved to the V2 programmer keeps its name; one that was already there does not get it',async()=>{
  const l1=new SimLink('v1','cr','SA81BHMW',{modelB:1,powerOn:true}),l2=new SimLink('v1','cr','SA81BHMW',{modelB:1,bootOnly:true,bootSilent:true}),a=service(l1,{only:'v1'}),b=service(l2,{only:'v2'});a.transport.find=async vid=>v1Finder(vid);
  a.s.start();b.s.start();
  try{await ready(a.s,'the V1 MAX on the V1 programmer');assert.equal(a.s.state().servo.model.code,'max1');await until(()=>b.s.state().programmer.ready,8000,'the V2 programmer');assert.equal(b.s.state().servo.present,false);
    // Pulling the servo drops the V1 programmer off USB for a moment, as the real one did: what it read is not lost with it.
    {const w=l1.write.bind(l1);let lost=1;l1.write=async tx=>{if(lost){lost=0;throw new S.DeviceLost('USB write failed (error 1167).');}return w(tx);};}
    nothing(l1);await until(()=>a.s.state().log.some(l=>/V1 programmer disconnected/.test(l.text)),8000,'the V1 programmer drops off USB');await until(()=>a.s.state().programmer.ready&&!a.s.state().servo.present,8000,'it is back with no servo');pluggedBoot(l2);
    await until(()=>b.s.state().servo.viaBoot,12000,'it shows up on the V2 programmer');const st=b.s.state();
    assert.deepEqual([st.servo.family,st.servo.model?.code,st.servo.name,st.servo.carried,st.servo.guessed,st.servo.mode,st.servo.modeHow,st.servo.editable],['v1','max1','SA81BHMW',{from:'v1'},null,'cr','carried',false]);
    assert.ok(!(l2.pulses||[]).some(us=>us>0),'a servo Torque already read is not turned: its mode came with its name');
    assert.ok(st.log.some(l=>/V1 MAX that was on the V1 programmer a moment ago is now on the V2 programmer/.test(l.text)),JSON.stringify(st.log.map(l=>l.text)));
    assert.throws(()=>b.s.flash({code:'max1',mode:'servo'}),/not the one confirmed/,'a firmware write still needs the student to confirm the model');
    // It stays that servo while it stays plugged in, and the name goes when it does.
    await new Promise(r=>setTimeout(r,600));assert.equal(b.s.state().servo.model?.code,'max1');
    // Torque restarted with the servo still there: the name is kept beside the USB log and comes back, marked as restored.
    await b.s.dispose();const again=new AxonService({transport:b.transport,firmwareDir:path.join(b.dir,'firmware'),logFile:path.join(b.dir,'usb.log'),catalog:b.catalog,only:'v2'});again.start();
    try{await until(()=>again.state().servo.viaBoot,12000,'the same servo after a restart');assert.deepEqual([again.state().servo.model?.code,again.state().servo.name,again.state().servo.carried],['max1','SA81BHMW',{from:'v1',restored:true}]);
      // Unplugged for good, the saved name goes too.
      l2.bootSilent=true;await until(()=>!JSON.parse(fs.readFileSync(path.join(b.dir,'axon-carried.json'),'utf8')).v2,30000,'the saved name is dropped once the servo is gone');
    }finally{await again.dispose();}
  }finally{await a.s.dispose();await b.s.dispose();}
  // Both plugged in from the start, as on 2026-11-10: the one on the V2 programmer is another servo, whatever happens on the V1 programmer.
  const m1=new SimLink('v1','cr','SA81BHMW',{modelB:1,powerOn:true}),m2=new SimLink('v1','cr','SA33',{modelB:1,bootOnly:true,spinAdc:160}),c=service(m1,{only:'v1'}),d=service(m2,{only:'v2'});c.transport.find=async vid=>v1Finder(vid);
  c.s.start();d.s.start();
  try{await ready(c.s);await until(()=>d.s.state().servo.viaBoot,12000,'the other V1 servo on the V2 programmer');await d.s.identify();assert.deepEqual([d.s.state().servo.model?.code,d.s.state().servo.carried],['mini1',null],'measured as what it is');
    nothing(m1);await until(()=>!c.s.state().servo.present,8000);await new Promise(r=>setTimeout(r,1200));
    assert.deepEqual([d.s.state().servo.viaBoot,d.s.state().servo.model?.code,d.s.state().servo.carried,!!d.s.state().servo.guessed],[true,'mini1',null,true],'never named after a servo that was on the other programmer at the same time');
  }finally{await c.s.dispose();await d.s.dispose();}
});

test('a MK2 servo read on the V2 programmer and then moved to the V1 programmer keeps its name and its mode',async()=>{
  const l2=new SimLink('v2','cr','MINIMK2'),l1=new SimLink('v2','cr','MINIMK2',{bootOnly:true,bootSilent:true}),b=service(l2,{only:'v2'}),a=service(l1,{only:'v1'});a.transport.find=async vid=>v1Finder(vid);
  a.s.start();b.s.start();
  try{await ready(b.s,'the MINI MK2 on the V2 programmer');await until(()=>a.s.state().programmer.ready,8000,'the V1 programmer');
    nothing(l2);await until(()=>!b.s.state().servo.present,8000,'it leaves the V2 programmer');pluggedBoot(l1);
    await until(()=>a.s.state().servo.viaBoot&&a.s.state().servo.model,15000,'it shows up on the V1 programmer');const st=a.s.state();
    assert.deepEqual([st.programmer.kind,st.servo.family,st.servo.model.code,st.servo.name,st.servo.carried,st.servo.mode,st.servo.modeHow],['v1','v2','mini2','MINIMK2',{from:'v2'},'cr','carried'],'the V1 programmer cannot tell the mode, so the one read on the V2 programmer comes along');
    assert.ok(st.log.some(l=>/V2 MINI that was on the V2 programmer a moment ago is now on the V1 programmer, in continuous rotation/.test(l.text)),JSON.stringify(st.log.map(l=>l.text)));
  }finally{await a.s.dispose();await b.s.dispose();}
});

test('a model Torque has no evidence for is shown by the name and reply it gave, never as a near one',async()=>{
  // Axon's range is MAX+, MINI+ and MICRO+ (V1), MAX MK2 and MINI MK2 (V2). No MICRO+ has been read, so its name is not in the table.
  assert.deepEqual(S.MODELS.map(m=>[m.family,m.sold,m.factoryName]),[['v1','MAX+','SA81BHMW'],['v1','MINI+','SA33'],['v2','MINI MK2','MINIMK2'],['v2','MAX MK2','MAXMK2']]);
  for(const near of ['SA81','SA33B','SA20','MICROMK2','MAXMK3',''])assert.equal(S.modelByName(near),null,`"${near}" is not a known model`);
  const link=new SimLink('v1','servo','SA20BHMW',{modelB:1}),{s}=service(link);s.start();
  try{await ready(s,'the unknown V1 servo');const st=s.state();assert.deepEqual([st.servo.family,st.servo.name,st.servo.model],['v1','SA20BHMW',null]);
    assert.ok(st.log.some(l=>/calls itself "SA20BHMW", which is not a model Torque knows.*status reply was 03 01 01 0A/.test(l.text)),JSON.stringify(st.log.map(l=>l.text)));
    const r=await s.flash({code:'max1',mode:'cr'});assert.equal(r.ok,false);assert.match(r.message,/Nothing was changed/);assert.equal(link.dataRecords,0,'no other model\'s firmware is written to it');
  }finally{await s.dispose();}
  // A bootloader whose hardware ID is neither 08 01 nor 08 22: an unknown servo with its raw reply, not a V1 or a MK2 one.
  const odd=new SimLink('v1','cr','X',{modelB:5,bootOnly:true}),o=service(odd);o.s.start();
  try{await until(()=>o.s.state().servo.present,10000,'the unknown bootloader');const st=o.s.state();
    assert.deepEqual([st.servo.family,st.servo.viaBoot,st.servo.editable,st.servo.model],['unknown',undefined,false,null]);assert.match(st.servo.firmware,/bootloader reply 04 01 00 00 00 56 31 30 33 08 05/);
    assert.throws(()=>o.s.test([{position:.5,hold:.3},{position:.6,hold:.3}]),/MK2 servo/);
  }finally{await o.s.dispose();}
});

// ---- Servos and programmers coming and going at awkward moments. plug/unplug stand for a hand on the connector.
test('a V1 servo on the V2 programmer: pulled out, pulled out in the middle of Identify, swapped, and the programmer itself dropping off USB',async()=>{
  const link=new SimLink('v1','cr','SA81BHMW',{modelB:1,bootOnly:true,pinsReport:true}),{s}=service(link,{only:'v2'}),unplug=()=>{link.bootSilent=true;},plug=()=>{link.bootSilent=false;};
  const gone=(ms,what)=>until(()=>!s.state().servo.present,ms,what),found=(ms,what)=>until(()=>s.state().servo.viaBoot,ms,what);s.start();
  try{await found(8000,'the V1 servo');assert.equal(s.state().servo.epoch,1);
    assert.throws(()=>s.identify.call({prog:{kind:'v2'},servo:{family:'none'}}),/Identify is for a V1 servo on the V2 programmer/);
    // Pulled out: said within a second or two, not at the next 5 second check.
    let t0=Date.now();unplug();await gone(2500,'it is gone, fast');assert.ok(Date.now()-t0<2500);assert.ok(s.state().log.some(l=>/Servo removed/.test(l.text)));
    assert.throws(()=>s.identify(),/Identify is for a V1 servo/,'nothing to identify once it is gone');
    // Plugged back in: found again at once, as another servo, with nothing known about it.
    t0=Date.now();plug();await found(2500,'found again, fast');assert.deepEqual([s.state().servo.epoch,s.state().servo.mode,s.state().servo.model],[2,'unknown',null]);
    // Identified, then pulled out: the fast check still works after an Identify (it used to be spent by then).
    assert.equal((await s.identify()).model,'max1');await until(()=>s.state().servo.mode==='cr',3000);t0=Date.now();unplug();await gone(2500,'gone fast after an Identify');
    // A MINI goes in instead: nothing of the MAX before it is left.
    link.spinAdc=160;plug();await found(2500,'the other servo');assert.deepEqual([s.state().servo.epoch,s.state().servo.mode,s.state().servo.model,s.state().servo.guessed],[3,'unknown',null,null]);
    // Pulled out in the middle of Identify: no answer from the movement, and it is shown as gone, not as "mode unknown".
    const mid=s.identify();await new Promise(r=>setTimeout(r,700));unplug();const r=await mid;assert.deepEqual([r.ok,r.mode,r.model],[false,r.mode,null]);assert.notEqual(r.mode,'cr');
    await gone(2500,'gone after being pulled out mid-Identify');assert.equal(link.out,0,'and the pulse is off');
    // Back in, and this time the programmer itself drops off USB during Identify, as the real ones do when a servo is pulled.
    plug();await found(2500,'in again');const w=link.write.bind(link);let drop=false;link.write=async tx=>{if(drop&&tx[1]===0xAF){drop=false;throw new S.DeviceLost('USB read failed (error 1167).');}return w(tx);};
    const lost=s.identify();await new Promise(r=>setTimeout(r,500));drop=true;await assert.rejects(lost,/1167|disconnected|USB/);
    await until(()=>s.state().log.some(l=>/V2 programmer disconnected/.test(l.text)),4000,'the drop is said');await until(()=>s.state().log.at(-1)&&/cannot read which V1 servo it is/.test(s.state().log.at(-1).text)&&s.state().programmer.ready&&s.state().servo.viaBoot,10000,'the programmer comes back and finds the servo');assert.deepEqual([s.state().servo.mode,s.state().busy],['unknown',null],'asked about again, nothing stuck');
    assert.equal((await s.identify()).model,'mini1','and Identify works after all that');
  }finally{await s.dispose();}
});

test('the pins reading empty while the servo still answers (it is restarting) never drops it, and Torque stops asking early',async()=>{
  const link=new SimLink('v1','cr','SA81BHMW',{modelB:1,bootOnly:true,pinsReport:true}),{s}=service(link,{only:'v2'});s.start();
  try{await until(()=>s.state().servo.viaBoot,8000,'the V1 servo');link.pinsStuck=true;const before=link.bootEntries;await new Promise(r=>setTimeout(r,4500));
    assert.equal(s.state().servo.viaBoot,true,'still there');assert.equal(s.state().servo.epoch,1,'and the same servo');assert.ok(link.bootEntries-before<=5,`asked early three times, then at the usual pace: ${link.bootEntries-before}`);
  }finally{await s.dispose();}
});

test('the V1 programmer says a servo is gone quickly too: its own V1 servo, and a MK2 servo it only sees through the bootloader',async()=>{
  const l1=new SimLink('v1','servo','SA81BHMW',{modelB:1,powerOn:true}),a=service(l1,{only:'v1'});a.transport.find=async vid=>v1Finder(vid);a.s.start();
  try{await ready(a.s,'the V1 MAX');const t0=Date.now();l1.attached=false;l1.bootSilent=true;await until(()=>!a.s.state().servo.present,2000,'the V1 servo gone within two seconds');assert.ok(Date.now()-t0<2000);
    // Back in: found and read again by itself.
    l1.attached=true;l1.bootSilent=false;await ready(a.s,'the V1 MAX again');assert.equal(a.s.state().servo.model.code,'max1');
    // One that only stopped answering (still plugged in) is brought back by the restart, not left as gone.
    l1.attached=false;await until(()=>!a.s.state().servo.present,2000);l1.attached=true;await ready(a.s,'it answers again after the restart');
  }finally{await a.s.dispose();}
  const l2=new SimLink('v2','cr','MINIMK2',{bootOnly:true,powerOn:true}),b=service(l2,{only:'v1'});b.transport.find=async vid=>v1Finder(vid);b.s.start();
  try{await until(()=>b.s.state().servo.viaBoot,10000,'the MK2 servo through its bootloader');const e=b.s.state().servo.epoch,t0=Date.now();l2.bootSilent=true;await until(()=>!b.s.state().servo.present,9000,'the MK2 servo gone');assert.ok(Date.now()-t0<9000);
    l2.bootSilent=false;await until(()=>b.s.state().servo.viaBoot,5000,'the MK2 servo found again');assert.equal(b.s.state().servo.epoch,e+1,'as a newly plugged in servo');
  }finally{await b.s.dispose();}
});

test('over 9 V it keeps servo power off; an unplugged servo clears its settings',async()=>{
  const high=new SimLink('v2','servo','MAXMK2',{volts:0x09C0}),a=service(high);a.s.start();try{await until(()=>a.s.state().log.some(l=>/above the programmer's 9 V limit/.test(l.text)));assert.equal(high.powerOn,false);}finally{await a.s.dispose();}
  const link=new SimLink('v2','cr','MINIMK2'),b=service(link);b.s.start();try{await ready(b.s);assert.equal(b.s.state().servo.model.code,'mini2');link.attached=false;await until(()=>!b.s.state().settings);assert.equal(b.s.state().servo.present,false);assert.ok(b.s.state().log.some(l=>l.text==='Servo removed.'));}finally{await b.s.dispose();}
});

test('a USB helper that will not run is said plainly, not shown as an empty programmer',async()=>{
  const {usbTransport}=require('../src/axon-programmer.cjs'),s=new AxonService({transport:{...usbTransport(new UsbHelper(path.join(os.tmpdir(),'no-such-axon-helper.exe'))),supported:true}});s.start();
  try{await until(()=>s.state().programmer.error);assert.match(s.state().programmer.error,/helper/i);assert.equal(s.state().programmer.ready,false);}finally{await s.dispose();}
});

test('a computer that cannot reach USB says so and starts nothing',async()=>{
  const spawned=[],s=new AxonService({transport:{supported:false,find:async()=>{spawned.push('find');return [];},rivals:async()=>{spawned.push('rivals');return [];}}}),st=s.start();
  assert.equal(st.supported,false);await new Promise(r=>setTimeout(r,60));assert.deepEqual(spawned,[]);assert.equal(s.state().running,false);await assert.doesNotReject(s.dispose());
});

test('a helper being replaced does not fail its successor\'s requests',{skip:process.platform==='win32'?false:'Windows only'},async()=>{
  const h=new UsbHelper(path.join(__dirname,'..','src','axon-usb','AxonUsb.exe'));
  try{assert.equal(await h.ask('ping'),'pong');h.stop();assert.equal(await h.ask('ping'),'pong');await new Promise(r=>setTimeout(r,400));assert.equal(await h.ask('ping'),'pong','the old one exiting changed nothing');}finally{h.stop();}
});

test('a firmware update that has started finishes even if the page leaves',async()=>{
  const link=new SimLink('v2','servo','MAXMK2'),{s}=service(link);s.start();await ready(s);const job=s.flash({code:'max2',mode:'cr'});await s.stop();assert.equal((await job).ok,true);assert.equal(link.mode,'cr');await s.dispose();
});

const HELPER=path.join(__dirname,'..','src','axon-usb','AxonUsb.exe');
test('the USB helper answers, and gives up when the app goes away',{skip:process.platform==='win32'?false:'Windows only'},async()=>{
  assert.equal(fs.readFileSync(HELPER).subarray(0,2).toString(),'MZ');
  const lines=execFileSync(HELPER,{input:'1 ping\n2 find 473 13aa\n3 read 5\n4 nope\n',encoding:'utf8'}).trim().split('\n');assert.equal(lines[0],'1 ok pong');assert.match(lines[1],/^2 ok \[/);assert.equal(lines[2],'3 lost The programmer is not open.');assert.match(lines[3],/^4 err /);
  const h=new UsbHelper();try{assert.equal(await h.ask('ping'),'pong');assert.ok(Array.isArray(JSON.parse(await h.ask('rivals'))));await assert.rejects(h.ask('read',5),e=>e instanceof S.DeviceLost);}finally{h.stop();}
  const missing=new UsbHelper(path.join(os.tmpdir(),'no-such-axon-helper.exe'));await assert.rejects(missing.ask('ping'),/missing|stopped|could not start/);
});

test('no Axon key is in the code, firmware asks for an imported file, and a bad one is refused',()=>{
  const src=['src/axon-servo.cjs','src/axon-programmer.cjs','tests/fixtures/axon-sim.cjs'].map(f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8')).join('\n');assert.doesNotMatch(src,/Buffer\.from\('[0-9a-f]{32}','hex'\)/i,'no key written out in the code');assert.doesNotMatch(src,/Buffer\.alloc\(16,0x[0-9a-f]{2}\)/i);
  const text=firmwareText(0x12,0xAB,'AXONTEST','cr',4),v1=encryptV1(text),v2=encryptV2(text);S.useKeys(null);
  try{assert.throws(()=>S.loadFirmware(v2,'b.sfm'),/needs Axon's keys, and Torque does not include them/);assert.throws(()=>S.loadFirmware(v1,'a.sfw'),/needs Axon's keys/);assert.equal(S.hasKey('v2'),false);
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'torque-axon-keys-')),keyFile=path.join(dir,'kept','axon-keys.json'),file=path.join(dir,'mine.json'),s=new AxonService({transport:simTransport(new SimLink('v2','servo','MAXMK2')),firmwareDir:dir,keyFile});assert.equal(s.firmwareStatus('max2','cr').keys,false);
    fs.writeFileSync(file,'not a key file');assert.throws(()=>s.importKeys(file),/not a key file Torque can read/);fs.writeFileSync(file,JSON.stringify({v2:'zz'}));assert.throws(()=>s.importKeys(file),/not a key file/);assert.equal(fs.existsSync(keyFile),false,'nothing kept');
    fs.writeFileSync(file,JSON.stringify(TEST_KEYS));assert.deepEqual(s.importKeys(file),{imported:['v1','v2']});assert.equal(s.firmwareStatus('max2','cr').keys,true);assert.equal(S.loadFirmware(v2,'b.sfm').family,'v2');
    S.useKeys(null);new AxonService({transport:simTransport(new SimLink('v2','servo','MAXMK2')),firmwareDir:dir,keyFile});assert.equal(S.hasKey('v2'),true,'it is there next time');
    const shared=path.join(dir,'in documents.json');S.useKeys(null);const found=new AxonService({transport:simTransport(new SimLink('v2','servo','MAXMK2')),firmwareDir:dir,keyFile:path.join(dir,'none.json'),sharedKeyFile:shared});assert.equal(found.firmwareStatus('max2','cr').keys,false);fs.writeFileSync(shared,JSON.stringify(TEST_KEYS));assert.equal(found.firmwareStatus('max2','cr').keys,true,'a file in Documents is found with no prompt, even one that synced in later');assert.equal(fs.existsSync(path.join(dir,'none.json')),false,'and it is not copied');}
  finally{S.useKeys(TEST_KEYS);}
});
