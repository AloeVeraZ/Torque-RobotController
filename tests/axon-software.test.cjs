'use strict';
// Axon's own programs unlock their servos: finding the file a student downloaded, and refusing writes until it is there.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const W=require('../src/axon-software.cjs'),S=require('../src/axon-servo.cjs'),{AxonService}=require('../src/axon-programmer.cjs'),{SimLink,simTransport}=require('./fixtures/axon-sim.cjs');
const folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'torque-axon-software-'));
const program=(dir,name,size=2e6)=>{fs.mkdirSync(dir,{recursive:true});const b=Buffer.alloc(size);b[0]=0x4D;b[1]=0x5A;const f=path.join(dir,name);fs.writeFileSync(f,b);return f;};

test('each family has its own file, and any version counts',()=>{
  const a=folder(),b=folder(),find=W.finder({folders:[a,b]});assert.deepEqual(find(),{v1:{found:false,fileName:null,path:null},v2:{found:false,fileName:null,path:null}});
  const v2=program(b,'Axon_Software_MK2_v1.1.2.exe');let s=find();assert.equal(s.v1.found,false);assert.deepEqual(s.v2,{found:true,fileName:'Axon_Software_MK2_v1.1.2.exe',path:v2});
  program(a,'Axon_Servo_Programming_Software_v1.0.5 (1).exe');s=find();assert.equal(s.v1.found,true,'a browser\'s second copy counts');assert.equal(s.v2.found,true);
  const c=folder();program(c,'axon_software_mk2_v9.9.exe');assert.equal(W.finder({folders:[c]})().v2.found,true,'a later version, any case');assert.equal(W.finder({folders:[c]})().v1.found,false);
});
test('a download still arriving, a stray file or another Axon tool does not count',()=>{
  const d=folder(),find=W.finder({folders:[d]});program(d,'Axon_Software_MK2_v1.1.2.exe.crdownload');program(d,'Axon_Software_MK2_v1.1.2.exe.txt');program(d,'Axon_Bridge.exe');program(d,'Axon_MAX_MK2_Servo_Mode.sfm');fs.writeFileSync(path.join(d,'Axon_Software_MK2_small.exe'),Buffer.from('MZ'));
  const big=Buffer.alloc(2e6);fs.writeFileSync(path.join(d,'Axon_Software_MK2_notes.exe'),big);assert.equal(find().v2.found,false);assert.equal(find().v1.found,false);
});
test('it looks one level into an Axon folder, not everywhere, and a missing folder is fine',()=>{
  const d=folder();program(path.join(d,'Axon stuff'),'Axon_Software_MK2_v1.1.2.exe');assert.equal(W.finder({folders:[d,path.join(d,'nope'),null]})().v2.found,true);
  const e=folder();program(path.join(e,'other'),'Axon_Software_MK2_v1.1.2.exe');assert.equal(W.finder({folders:[e]})().v2.found,false);const f=folder();program(path.join(f,'Axon','deeper'),'Axon_Software_MK2_v1.1.2.exe');assert.equal(W.finder({folders:[f]})().v2.found,false);
});
test('a file somewhere else can be pointed at, and only the right one is taken',()=>{
  const d=folder(),memo=path.join(d,'kept','axon-software.json'),elsewhere=folder(),find=W.finder({folders:[d],memo});const v1=program(elsewhere,'Axon_Servo_Programming_Software_v1.0.5.exe');
  assert.throws(()=>W.remember(memo,'v2',v1),/not Axon Software MK2/);assert.throws(()=>W.remember(memo,'v2',program(elsewhere,'robot.exe')),/not Axon Software MK2/);assert.equal(find().v2.found,false);
  W.remember(memo,'v1',v1);assert.deepEqual(find().v1,{found:true,fileName:path.basename(v1),path:v1});fs.rmSync(v1);assert.equal(find().v1.found,false,'and it stops counting if it goes away');
  fs.writeFileSync(memo,'not json');assert.equal(find().v1.found,false);
});
test('the pages open on the download link, and Torque reads no keys out of the program',()=>{
  assert.match(W.SOFTWARE.v1.page,/^https:\/\/docs\.axon-robotics\.com\/archive\/programmer#:~:text=Software%20Download-,Axon%20Programming%20Software$/);assert.match(W.SOFTWARE.v2.page,/^https:\/\/docs\.axon-robotics\.com\/servos\/programmer#:~:text=Software%20Download-,Axon%20Software%20MK2$/);
  const src=fs.readFileSync(require.resolve('../src/axon-software.cjs'),'utf8');assert.doesNotMatch(src,/useKeys|parseKeys|aes-/i,'finding it has nothing to do with the keys');
});
test('with a family\'s program missing its servos cannot be written, and the other family can',async()=>{
  const d=folder(),found={v1:{found:false},v2:{found:false}},s=new AxonService({transport:simTransport(new SimLink('v2','servo','MAXMK2')),firmwareDir:d,findSoftware:()=>found});assert.deepEqual(s.softwareView(),{v1:{found:false,fileName:null},v2:{found:false,fileName:null}});
  assert.throws(()=>s.needSoftware('v2'),/Axon's V2 software is not on this computer/);assert.throws(()=>s.needSoftware('v1'),/Axon's V1 software/);s.needSoftware('unknown');s.servo={...s.servo,family:'v2'};assert.throws(()=>s.write({pwm:100}),/Axon's V2 software/);assert.throws(()=>s.defaults(),/Axon's V2 software/);assert.throws(()=>s.flash({code:'max2',mode:'cr'}),/Axon's V2 software/);
  found.v2={found:true,fileName:'Axon_Software_MK2_v1.1.2.exe',path:'C:/x/secret.exe'};s.softwareFound(true);s.needSoftware('v2');assert.throws(()=>s.needSoftware('v1'),/Axon's V1 software/);assert.deepEqual(s.state().software.v2,{found:true,fileName:'Axon_Software_MK2_v1.1.2.exe'},'the path stays out of the page');assert.equal(s.softwareFile('v2'),'C:/x/secret.exe');
  const free=new AxonService({transport:simTransport(new SimLink('v2','servo','MAXMK2')),firmwareDir:d});free.needSoftware('v1');free.needSoftware('v2');
});
