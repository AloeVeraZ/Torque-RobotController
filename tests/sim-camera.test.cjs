'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Cam=require('../ui/sim-camera.js'),L=require('../src/robot-link.cjs'),{startUdpRobot,startDebugServer,CONFIG_XML}=require('../tools/ftc-sim.cjs');

test('the simulated webcam follows the FTC docs: range against decimation, blur against exposure, gain only with manual exposure',()=>{
  assert.ok(Math.abs(Cam.rangeFeet(2,1)-10)<.01);assert.ok(Math.abs(Cam.rangeFeet(2,3)-4)<.1,'a 2-inch tag reads 4 ft at decimation 3');assert.deepEqual([1,2,3].map(Cam.fpsOf),[10,20,30]);
  const at=o=>Cam.simRate({exposure:5,gain:255,decimation:3,feet:4,...o});
  assert.ok(at({})>=.9,'short exposure, high gain reads');assert.equal(at({exposure:1,gain:0}),0,'too dark');assert.equal(at({feet:20}),0,'too far at decimation 3');assert.ok(Cam.simRate({exposure:5,gain:255,decimation:1,feet:15})>.9,'decimation 1 reaches farther');
  assert.ok(at({exposure:40,moving:true})<at({exposure:5,moving:true}),'a long exposure blurs a moving tag');assert.equal(Cam.blurPixels({exposure:10,moving:false}),0);
  assert.equal(Cam.simRate({exposure:'auto',gain:0,decimation:3,feet:4}),Cam.simRate({exposure:'auto',gain:255,decimation:3,feet:4}),'gain does nothing with automatic exposure');
});

test('tuning takes the lowest exposure that reads reliably, and says so in code',()=>{
  const list=Cam.EXPOSURES.map(exposure=>({exposure,rate:Cam.simRate({exposure,gain:255,decimation:3,feet:4,moving:true})})),best=Cam.pick(list);
  assert.ok(best.exposure>=3&&best.exposure<=8,`picked ${best.exposure} ms`);assert.ok(list.filter(r=>r.exposure<best.exposure).every(r=>r.rate<.9));assert.equal(Cam.pick([{exposure:1,rate:.2}]),null);
  const code=Cam.javaLines({exposure:6,gain:255,decimation:3});assert.match(code,/setExposure\(6, TimeUnit\.MILLISECONDS\)/);assert.match(code,/setGain\(255\)/);assert.match(code,/setDecimation\(3\)/);assert.match(code,/Mode\.Manual/);
  assert.deepEqual(Cam.sanitize({exposure:7,gain:9,decimation:9,rotate:45}),{exposure:'auto',gain:100,decimation:3,rotate:0,feet:4,moving:false});assert.equal(Cam.sanitize({exposure:5}).exposure,5);
});

test('Torque Debug’s camera over the link: named in its device list, frames on request, settings reach it, tags come back',async t=>{
  const address='127.0.0.11',xml=CONFIG_XML.replace(/(<Robot\b[^>]*>)/,'$1\n    <Webcam name="Webcam 1" serialNumber="UVC:046D:0825" />');let robot;
  try{robot=await startUdpRobot({address});}catch(e){t.skip('loopback unavailable: '+e.message);return;}t.after(()=>robot.close());
  robot.sim.opModes=[...robot.sim.opModes,{flavor:'TELEOP',group:'Torque',name:'TorqueDebug-18.30-10-30-26',source:'ONBOTJAVA'}];
  const debug=await startDebugServer({address,sim:robot.sim,xml,port:20886});t.after(()=>debug.close());assert.deepEqual(debug.manifest.cameras,['Webcam 1']);
  let manifest=null,last=null,images=0,size=0;const d=L.runDebug(address,{onManifest:m=>{manifest=m;},onFrame:f=>{last=f;},onCamera:b=>{images++;size=b.length;},connect:{host:address,port:20886}});
  const until=async(test,what)=>{for(const end=Date.now()+10000;Date.now()<end;await new Promise(r=>setTimeout(r,50)))if(test())return;assert.fail('timed out: '+what);};
  try{await until(()=>manifest&&last,'first frame');assert.deepEqual(manifest.cameras,['Webcam 1']);assert.equal(last.cam.state,'STREAMING');assert.deepEqual(last.cam.range,[1,100,0,255]);
    assert.equal(images,0,'no picture until asked');assert.ok(d.camera(true));await until(()=>images>=3,'three pictures in a row');assert.ok(size>1000);d.camera(false);
    assert.ok(d.send('V\t5\t255'));assert.ok(d.send('D\t2'));await until(()=>last.cam.exp===5&&last.cam.gain===255&&last.cam.dec===2,'settings applied');assert.deepEqual(debug.camera(),{exposure:5,gain:255,decimation:2,feet:4});
    await until(()=>last.cam.tags.length===1,'a tag read');assert.equal(last.cam.tags[0].id,584);
    assert.ok(d.send('V\tauto'));await until(()=>last.cam.exp===null,'back to automatic');}
  finally{d.stop();await d.ended.catch(()=>{});}
});

test('Torque Debug’s source has the camera commands and stays free of a package and nested classes',()=>{
  const src=L.debugSource('TorqueDebug-18.30-10-30-26');for(const s of ['VisionPortal.Builder','AprilTagProcessor.Builder','case "V": case "D":','"cameras"','portal.close()'])assert.ok(src.includes(s),s);assert.doesNotMatch(src,/^package /m);
});
