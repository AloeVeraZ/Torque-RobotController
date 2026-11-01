'use strict';
// Calibrate's Axon programmer against a simulated V2 programmer: the settings maps, identification, reads and writes, firmware
// files and flashing, moved from Axon Bridge's self test, whose expected bytes come from Axon's own apps and firmware.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const S=require('../src/axon-servo.cjs'),{AxonService,UsbHelper}=require('../src/axon-programmer.cjs'),{SimLink,simTransport,makeBlock,firmwareText,encryptV1,encryptV2,installFirmware}=require('./fixtures/axon-sim.cjs');
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

// On the computer that has Axon Bridge installed, Axon's eight real files must still match the pins and flash cleanly against the simulator.
const REAL=process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Programs','Axon Bridge','firmware');
test('Axon\'s real firmware files match the pinned hashes and flash against the simulator',{skip:REAL&&fs.existsSync(REAL)?false:'Axon\'s firmware is not on this computer'},async()=>{
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
  const link=new SimLink('v1','servo','SA81BHMW',{rejectSecondChunk:true,modelB:1}),{s,dir,catalog}=service(link);s.start();
  try{await ready(s);assert.equal(s.state().servo.name,null);assert.throws(()=>s.flash({code:'max1',mode:'cr'}),e=>e.code==='NAME_UNKNOWN');assert.equal(link.bootEntries,0,'nothing happened yet');
    const r=await s.flash({code:'max1',mode:'cr',allowUnknownName:true});assert.ok(r.ok,r.message);
    fs.rmSync(path.join(dir,'firmware',catalog.find(f=>f.code==='max1'&&f.mode==='servo').fileName));assert.throws(()=>s.flash({code:'max1',mode:'servo',allowUnknownName:true}),e=>e.code==='FIRMWARE_NEEDED');
  }finally{await s.dispose();}
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
    transport.rivalTitles=[];await ready(s);transport.plugged=false;transport.v1Programmer=true;link.flush=async()=>{throw new S.DeviceLost('unplugged');};await until(()=>s.state().programmer.v1Seen);assert.equal(s.state().programmer.ready,false);assert.equal(s.state().servo.present,false);
  }finally{await s.dispose();}
  const silent=service(new SimLink('v2','servo','MAXMK2'),{},{silent:true});silent.s.start();try{await until(()=>silent.s.state().programmer.handshakeFailed);}finally{await silent.s.dispose();}
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
