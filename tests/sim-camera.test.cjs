'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Cam=require('../ui/sim-camera.js'),L=require('../src/robot-link.cjs'),{startUdpRobot,startDebugServer,onBotCompile,CONFIG_XML}=require('../tools/ftc-sim.cjs');

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
    assert.ok(d.send('V\tauto'));await until(()=>last.cam.exp===null,'back to automatic');
    // Lens numbers: a frame says which it uses, and the range reported follows them. Null until sent, so a Torque Debug too old to take them can be told by the field being absent.
    assert.equal(last.cam.lens,null);await until(()=>last.cam.tags.length===1,'a tag read');assert.ok(Math.abs(last.cam.tags[0].r-48*Cam.FALLBACK_FX/Cam.SIM_FX)<.01,'read through the SDK’s guess');
    assert.ok(d.send(`K\t${Cam.SIM_FX}\t${Cam.SIM_FX}\t320\t240`));await until(()=>last.cam.lens?.[0]===Cam.SIM_FX,'the lens took');assert.deepEqual(last.cam.lens,[Cam.SIM_FX,Cam.SIM_FX,320,240]);await until(()=>last.cam.tags[0]?.r===48,'the right distance');
    assert.ok(d.send('K\toff'));await until(()=>last.cam.lens===null,'back to the SDK’s own');}
  finally{d.stop();await d.ended.catch(()=>{});}
});

test('the link follows the tab: it starts with nothing pressed, is shared if someone else started it, and goes shortly after the tab is left',()=>{
  const base={want:false,keep:false,running:false,moving:false,blocked:false,own:false,hard:false,at:100000,tryAt:0,leftAt:0},step=o=>Cam.linkStep({...base,...o});
  assert.equal(step({want:true}),'start','opening the tab is enough');assert.equal(step({want:true,running:true,own:true}),'wait','running already');assert.equal(step({want:true,running:true}),'wait','someone else’s run is shared');
  assert.equal(step({want:true,moving:true}),'wait');assert.equal(step({want:true,blocked:true}),'wait','a Send, a guided check or a scan has the robot');assert.equal(step({want:true,hard:true}),'wait','only a person starts it again');assert.equal(step({want:true,tryAt:base.at+1}),'wait','not before its retry');
  // Off the tab, as on Drive: never a start.
  assert.equal(step({}),'wait','no tab, no start');assert.equal(step({blocked:true}),'wait');
  // Leaving: not at once, so a look at another tab keeps the camera; then only a run started here goes.
  const left={running:true,own:true,leftAt:base.at-1000};assert.equal(step(left),'wait','it lingers');assert.equal(step({...left,leftAt:base.at-Cam.LINGER}),'stop','then lets go');assert.equal(step({...left,leftAt:base.at-Cam.LINGER,own:false}),'wait','someone else’s run stays');assert.equal(step({...left,leftAt:base.at-Cam.LINGER,keep:true}),'wait','the Debug tab is looking at it');assert.equal(step({...left,leftAt:base.at-Cam.LINGER,moving:true}),'wait');
});

test('what stops the link is one plain line, and it tries again only where that can help',()=>{
  const f=Cam.linkFailure;assert.deepEqual(f('The robot has no Torque Debug op mode yet. Put Torque Debug on the robot first.'),{rebuild:true});
  const crash=f('The Robot Controller app on this robot crashed when it loaded Torque Debug, so Torque took that program off and restarted the app. Your OnBot Java files are all still there, but their last build had to be cleared too, so your OnBot Java op modes will not show until you open OnBot Java and press Build Everything.');assert.equal(crash.hard,true);assert.equal(crash.sticky,true,'going back to the tab must not crash it again');assert.match(crash.text,/crashed when it loaded the camera program/);assert.match(crash.text,/press Build Everything\.$/,'how to get the team’s code back');
  const again=f('Last time, the Robot Controller app on this robot crashed when it loaded Torque Debug, so Torque will not put it back by itself. Press Try again to put it on once more.');assert.equal(again.hard,true);assert.equal(again.sticky,true);assert.match(again.text,/Press Try again/);assert.doesNotMatch(again.text,/Torque Debug/);
  const other=f('Another Driver Station is connected to this robot. Disconnect it, then try again.');assert.ok(other.again>0);assert.ok(!other.hard);assert.equal(other.wait,true,'it clears by itself');assert.match(other.text,/The picture starts once it disconnects/);assert.equal(f('“Team Auto” is running on the robot. Stop it first.').wait,true);assert.equal(f('The Robot Controller app on this Control Hub is not answering. Press Scan to start it, or restart the robot.').rc,true,'Try again can start it');
  assert.match(f('Close the robot in Drive first: its Driver Station is using the robot connection.').text,/^Close the robot in Drive/);assert.match(f('Another FTC Driver Station on this computer is using the robot connection. Close the robot in Drive (or the other app) and try again.').text,/^Close the robot in Drive/);
  assert.match(f('“Team Auto” is running on the robot. Stop it first.').text,/^“Team Auto” is running on the robot\. The picture starts once it stops\.$/);
  for(const m of ['The Robot Controller app on this Control Hub is not answering. Press Scan to start it, or restart the robot.','The Robot Controller app on this Control Hub is not running and did not start. Restart the robot, then try again.','The Robot Controller app on the Control Hub did not answer over the USB cable. Restart the robot, then try again.']){const r=f(m);assert.ok(r.again>0,m);assert.doesNotMatch(r.text,/Scan/);assert.match(r.text,/Robot Controller app is not answering/);}
  assert.equal(f('This robot runs an FTC SDK older than this app supports (Robocol 1).').hard,true);
  for(const m of ['Torque Debug did not open its port on the robot (it hung up).','Live debug is still running. Stop it first.','The robot did not START Torque Debug.'])assert.doesNotMatch(f(m).text,/torque debug|live debug/i,'neither word on this tab');
});

test('a run that keeps ending comes back later each time, then stops trying',()=>{
  const waits=[];for(let ends=0;Cam.endedWait('lost',ends)!==null;ends++)waits.push(Cam.endedWait('lost',ends));assert.deepEqual(waits,[3000,6000,12000,24000,48000]);assert.equal(Cam.endedWait('ended',5),null);
  assert.equal(Cam.endedWait('stopped',0),1500,'a press elsewhere took the robot: back shortly');assert.equal(Cam.endedWait('stopped',1),6000,'but not over and over');
});

test('asked to stop, the link stops: a connection that says nothing does not hold it, and the op mode is stopped',async t=>{
  const address='127.0.0.57',net=require('node:net'),name='TorqueDebug-18.30-10-30-26';let robot;try{robot=await startUdpRobot({address});}catch(e){t.skip('loopback unavailable: '+e.message);return;}t.after(()=>robot.close());
  robot.sim.opModes=[...robot.sim.opModes,{flavor:'TELEOP',group:'Torque',name,source:'ONBOTJAVA'}];
  const open=new Set(),server=net.createServer(s=>{open.add(s);s.on('error',()=>{});s.on('close',()=>open.delete(s));s.resume();});await new Promise(r=>server.listen(20957,address,r));t.after(()=>new Promise(r=>server.close(r)));
  const connect={host:address,port:20957},until=async(test,what,ms=8000)=>{for(const end=Date.now()+ms;Date.now()<end;await new Promise(r=>setTimeout(r,20)))if(test())return;assert.fail('timed out: '+what);};
  // Silent, then stop: over in moments, the robot told, and no socket left.
  {const d=L.runDebug(address,{opMode:name,connect});await until(()=>robot.sim.opState==='running'&&open.size===1,'it runs and is connected');const began=Date.now();d.stop();assert.equal(await d.ended,'stopped');assert.ok(Date.now()-began<4000,`${Date.now()-began} ms`);assert.equal(robot.sim.opState,'stopped');await until(()=>open.size===0,'its socket is closed');}
  // Silent to the end of the time: it fails and says so, and the op mode is stopped.
  {const d=L.runDebug(address,{opMode:name,connect,startWait:400});await assert.rejects(d.ended,/did not open its port on the robot \(it said nothing\)/);assert.equal(robot.sim.opState,'stopped');await until(()=>open.size===0,'its socket is closed');}
  // No port at all, retrying: a stop ends that too.
  {const d=L.runDebug(address,{opMode:name,connect:{host:address,port:20958}});await until(()=>robot.sim.opState==='running','it runs');await new Promise(r=>setTimeout(r,400));const began=Date.now();d.stop();assert.equal(await d.ended,'stopped');assert.ok(Date.now()-began<4000);assert.equal(robot.sim.opState,'stopped');}
  // Stopped while it is still asking the robot to start: no more waiting, and it still gets its stop.
  {const d=L.runDebug(address,{opMode:name,connect});d.stop();assert.equal(await d.ended,'stopped');}
  // Given up on: nothing more goes to the robot, which may belong to the next session by now.
  {const d=L.runDebug(address,{opMode:name,connect});await until(()=>robot.sim.opState==='running'&&open.size===1,'it runs again');const stops=robot.sim.commands.filter(c=>c.name==='CMD_INIT_OP_MODE').length;d.abandon();assert.equal(await d.ended,'stopped');assert.equal(robot.sim.commands.filter(c=>c.name==='CMD_INIT_OP_MODE').length,stops,'no stop sent');await new Promise(r=>setTimeout(r,2300));assert.equal(robot.sim.opState,'stopped','the robot stops it by itself once nobody is there');}
});

test('the robot is free only with no other Driver Station and nothing running, and a Torque Debug left running is nobody’s',async t=>{
  const address='127.0.0.58';let robot;try{robot=await startUdpRobot({address});}catch(e){t.skip('loopback unavailable: '+e.message);return;}t.after(()=>robot.close());const idle=()=>L.debugIdle(address,{settle:50});
  assert.equal(await idle(),true);assert.equal(robot.sim.opState,'stopped');await new Promise(r=>setTimeout(r,2200));
  robot.sim.setOpMode('Team Auto','running');await assert.rejects(idle(),/“Team Auto” is running on the robot/);assert.equal(robot.sim.opState,'running','their op mode is left alone');assert.equal(robot.sim.opMode,'Team Auto');robot.sim.setOpMode('$Stop$Robot$','stopped');await new Promise(r=>setTimeout(r,2200));
  robot.sim.reject=true;await assert.rejects(idle(),/Another Driver Station is connected/);robot.sim.reject=false;await new Promise(r=>setTimeout(r,2200));
  robot.sim.setOpMode('TorqueDebug-18.30-10-30-26','running');assert.equal(await idle(),true);assert.equal(robot.sim.opState,'stopped','the one left running goes');
});

test('the summary under the picture says only what needs doing',()=>{
  const row=d=>({device:{speed:480,serial:'A',path:'1-1',vid:'046d',pid:'0825',...d},port:'usb3',warnings:[],legal:{ok:true,rule:'R707A'},usbId:'046d:0825'});
  const uvc={camera:['Exposure time (absolute)'],processing:['Gain','White balance temperature'],modes:[{format:'YUY2',width:640,height:480,fps:[30]}]},fine=Cam.cameraChecks({row:row(),uvc,drops:[]});assert.deepEqual(Cam.checkSummary(fine,{ok:true}),{state:'ok',text:'All good'});
  // No gain control needs nothing done, so it is not in the summary even though Details says so.
  const noGain=Cam.cameraChecks({row:row(),uvc:{...uvc,processing:[]},drops:[]});assert.ok(noGain.some(c=>c.code==='CTRL'&&c.state==='warn'));assert.equal(Cam.checkSummary(noGain,{ok:true}).text,'All good');
  const real=Cam.cameraChecks({row:row({vid:'a108',pid:'2240'}),uvc:{...uvc,modes:[...uvc.modes,{format:'MJPEG',width:1280,height:720,fps:[30]}]},drops:[]});assert.equal(Cam.checkSummary(real,{ok:true}).text,'This camera’s 1280x720 needs MJPEG · Distance will be wrong until the lens is measured');assert.equal(Cam.checkSummary(real,{ok:true}).state,'warn');
  assert.equal(Cam.checkSummary(Cam.cameraChecks({row:row(),uvc:undefined}),{ok:true}).state,'wait','still reading: nothing to say yet');
  assert.match(Cam.checkSummary(fine,{ok:false,rule:'R708'}).text,/R708/,'not allowed comes first');
});

test('the link waits for the op mode to speak: ADB takes a connection before the hub’s port is open, then hangs up',async t=>{
  const address='127.0.0.11',net=require('node:net');let robot;try{robot=await startUdpRobot({address});}catch(e){t.skip('loopback unavailable: '+e.message);return;}t.after(()=>robot.close());
  robot.sim.opModes=[...robot.sim.opModes,{flavor:'TELEOP',group:'Torque',name:'TorqueDebug-18.30-10-30-26',source:'ONBOTJAVA'}];
  let tries=0;const server=net.createServer(s=>{s.on('error',()=>{});s.resume();if(++tries<3){s.destroy();return;}s.write('{"cameras":[]}\n{"t":1}\n');});await new Promise(r=>server.listen(20887,address,r));t.after(()=>new Promise(r=>server.close(r)));
  let manifest=null,frame=null;const d=L.runDebug(address,{opMode:'TorqueDebug-18.30-10-30-26',onManifest:m=>{manifest=m;},onFrame:f=>{frame=f;},connect:{host:address,port:20887}});
  try{for(const end=Date.now()+10000;Date.now()<end&&!frame;)await new Promise(r=>setTimeout(r,50));assert.deepEqual(manifest,{cameras:[]},'the first thing it said is the manifest');assert.deepEqual(frame,{t:1});assert.equal(tries,3,'two hang-ups are not the end of it');assert.equal(robot.sim.opMode,'TorqueDebug-18.30-10-30-26');}
  finally{d.stop();await d.ended.catch(()=>{});}
  // A name the robot does not list is the same as none: that one has not been built.
  await assert.rejects(L.runDebug(address,{opMode:'TorqueDebug-other',connect:{host:address,port:20887}}).ended,/no Torque Debug op mode/);
});

test('Torque Debug’s source compiles on SDK 12.0 and before, opens one camera of several, and commands nothing until told',()=>{
  const src=L.debugSource('TorqueDebug-18.30-10-30-26');for(const s of ['VisionPortal.Builder','AprilTagProcessor.Builder','case "V": case "D": case "K": case "W":','"cameras"','open.close()','setLensIntrinsics(lens[0], lens[1], lens[2], lens[3])','\\"lens\\":','\\"open\\":','webcams.get(camIndex)'])assert.ok(src.includes(s),s);assert.doesNotMatch(src,/^package /m);
  // SDK 12.0 moved these to AprilTagDetection's subclasses, and that is what broke the build on a real hub: "cannot find symbol: variable decisionMargin".
  const code=src.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g,'');assert.doesNotMatch(code,/\bd\.(id|decisionMargin|metadata)\b/);for(const name of ['id','decisionMargin','metadata'])assert.ok(code.includes(`field(d, "${name}")`),name);assert.match(code,/getField\(name\)\.get\(from\)/);assert.match(code,/d\.ftcPose/,'ftcPose stayed on the class');
  // Nothing moves until told. Motors are set to 0; a continuous servo is written only once told, since 0 power on a position servo is a move to its middle; servos go limp and get a position only from S.
  assert.match(code,/if \(crTold\[i\] && driven\) c\.setPower\(crPower\[i\]\)/);
  // A continuous servo nothing drives has no PWM at all, so what it turns (a swerve pod) moves freely by hand for its encoder's check.
  assert.match(code,/else if \(!driven && p\.isPwmEnabled\(\)\) p\.setPwmDisable\(\)/);assert.doesNotMatch(code,/for \(CRServo s : crservos\) s\.setPower/);assert.match(code,/if \(servoOn\[i\] && !Double\.isNaN\(servoPos\[i\]\)\)/);assert.match(code,/\.setPwmDisable\(\)/);
  // The port opens before the camera does.
  assert.ok(code.indexOf('serve.start()')<code.indexOf('startCamera();'));
  // The camera is always let go. Stopping closes whichever portal is current, one closing never goes around that, and a stop during a reopen leaves no new portal holding the camera.
  assert.match(src,/void closePortal\(\) \{\s*synchronized \(portalLock\) \{\s*VisionPortal open = portal;\s*if \(open == null \|\| open == closedPortal\) return;\s*closedPortal = open;\s*open\.close\(\);/);
  assert.match(src,/\} finally \{\s*running = false;[\s\S]{0,300}?closePortal\(\);\s*close\(\);/,'stopping closes it');assert.doesNotMatch(src,/\bportal\.close\(\)/,'everything goes through closePortal');
  assert.match(src,/closePortal\(\);\s*Thread\.sleep\(500\);\s*if \(!running\) return;\s*tryOpenCamera\(\);\s*if \(!running\) \{ closePortal\(\); return; \}/,'a reopen checks before it opens, and closes what it opened if stopped meanwhile');
});

test('the virtual hub’s compiler says what a real hub on SDK 12.0 said about the old source, and builds this one on both shapes of the class',t=>{
  const compile=onBotCompile();if(!compile){t.skip('the simulator’s Java is not built');return;}
  const now=L.debugSource('TorqueDebug-18.30-10-30-26'),old=now.replace(/( *)Object id = field\(d, "id"\)[^\n]*\n[^\n]*\n[^\n]*\n/,(_,pad)=>`${pad}b.append("{\\"id\\":").append(d.id).append(",\\"m\\":").append(num(d.decisionMargin));\n${pad}if (d.metadata != null) b.append(",\\"name\\":").append(str(d.metadata.name));\n`);assert.notEqual(old,now);
  // The very errors in a real hub's build log, in its own form, and the line a student sees.
  const log=compile({'/src/TorqueDebug.java':old}).join('\n');for(const name of ['id','decisionMargin','metadata'])assert.match(log,new RegExp(`TorqueDebug\\.java\\(\\d+:\\d+\\): ERROR: cannot find symbol\\n  symbol:   variable ${name}\\n  location: variable d of type AprilTagDetection`),name);
  assert.deepEqual(L.buildErrors(log).map(e=>e.message),['cannot find symbol: variable id','cannot find symbol: variable decisionMargin','cannot find symbol: variable metadata','cannot find symbol: variable metadata']);assert.match(L.buildProblem(L.buildErrors(log)),/^Torque’s own program did not build on this robot \(TorqueDebug\.java line \d+: cannot find symbol: variable id\)/);
  assert.deepEqual(compile({'/src/TorqueDebug.java':now}),[],'this source on SDK 12.0');
  // A team's broken file, as it fails beside Torque's: it is the one named.
  const both=compile({'/src/TorqueDebug.java':now,'/src/TeamAuto.java':'public class TeamAuto {\n    void go() {\n        bar();\n    }\n}\n'}).join('\n');assert.match(L.buildProblem(L.buildErrors(both)),/^Your file TeamAuto\.java has an error on line 3: cannot find symbol: method bar\(\)\./);
  // Before SDK 12.0 those fields sat on the class itself, which the old source was written for. This one has to build there too.
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'deck-old-sdk-')),at=path.join(dir,'org/firstinspires/ftc/vision/apriltag');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(at,{recursive:true});fs.writeFileSync(path.join(at,'AprilTagDetection.java'),'package org.firstinspires.ftc.vision.apriltag; public class AprilTagDetection { public final int id = 7; public final float decisionMargin = 42f; public final AprilTagMetadata metadata = null; public final AprilTagPoseFtc ftcPose = null; }');
  const older=onBotCompile({before:[dir]});assert.deepEqual(older({'/src/TorqueDebug.java':now}),[],'this source before SDK 12.0');assert.deepEqual(older({'/src/TorqueDebug.java':old}),[],'and why it worked on the earlier hub');
});
