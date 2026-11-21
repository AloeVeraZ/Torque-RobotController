'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const P=require('../ui/sim-planner.js'),Editor=require('../ui/sim-editor-state.js'),X=require('../ui/sim-export.js'),F=require('../ui/sim-ftc.js'),{SimEngine}=require('../src/sim-engine.cjs');
const start={x:30,y:30,heading:0},pins=[{x:75,y:40,path:{rotate:'track',target:{x:120,y:130},power:.4,kind:'action',action:'Intake',note:'Intake along this path'}},{x:105,y:85,path:{style:'sharp'}},{x:40,y:110,path:{rotate:'start'}}],base=()=>({start,zones:[{id:'box',type:'rect',x:70,y:70,width:10,height:10,angle:0}],pins:structuredClone(pins),style:'spline',clearance:1,rotate:false,defaultPower:.8});
test('edit sessions isolate drafts; only Done commits the selected path, pin or obstacle',()=>{
 const l=base(),before=structuredClone(l),edit=Editor.begin(l,{kind:'path',index:0});edit.draft.path.power=.9;edit.draft.path.target={x:115,y:140};edit.draft.wait=99;assert.deepEqual(l,before);edit.commit();assert.equal(l.pins[0].path.power,.9);assert.equal(l.pins[0].wait,undefined);assert.deepEqual(l.pins[0].path.target,{x:115,y:140});assert.throws(()=>edit.commit(),/already saved/);
 const pin=Editor.begin(l,{kind:'pin',index:0});pin.draft.wait=2;pin.draft.path.power=0;pin.commit();assert.equal(l.pins[0].wait,2);assert.equal(l.pins[0].path.power,.9);
 const zone=Editor.begin(l,{kind:'zone',id:'box'});zone.draft.width=.1;assert.throws(()=>zone.commit(),/size/);assert.equal(l.zones[0].width,10);zone.draft.width=18;zone.commit();assert.equal(l.zones[0].width,18);
});
test('mixed straight and spline paths use their own geometry and retain power, heading and actions',()=>{
 const q=base();q.zones=[];q.pins[0].path.style='sharp';q.pins[1].path.style='spline';const r=P.plan(q,{front:6,rear:6,half:6});assert.ok(r.segments.filter(s=>s.to===0).every(s=>s.type==='line'));assert.ok(r.segments.some(s=>s.to===1&&s.type==='curve'));assert.equal(r.stops[0].path.power,.4);assert.equal(r.stops[0].path.action,'Intake');assert.ok(r.segments.some(s=>s.target));
 const saved=P.pathEffects(JSON.parse(JSON.stringify({style:'spline',shapeAuto:true,power:.9})));assert.equal(saved.style,'spline');assert.equal(saved.shapeAuto,true);
});
test('Optimize enumerates small shape mixes, preserves manual choices and bounds longer searches',()=>{
 const q={...base(),pins:Array.from({length:4},(_,i)=>({x:30+i*20,y:50+(i%2)*30,path:{power:.3+i*.1,rotate:i?'keep':'relative',angle:90}}))};const all=P.shapeCandidates(q);assert.equal(all.length,16);assert.equal(new Set(all.map(c=>c.styles.join(','))).size,16);for(const c of all)assert.equal(c.project.pins[0].path.angle,90);
 q.pins[1].path.style='sharp';const locked=P.shapeCandidates(q);assert.equal(locked.length,8);assert.ok(locked.every(c=>c.styles[1]==='sharp'&&!c.project.pins[1].path.shapeAuto));assert.equal(q.pins[0].path.style,undefined);
 const long={...q,pins:Array.from({length:32},(_,i)=>({x:i+20,y:60,path:{}}))};assert.ok(P.shapeCandidates(long).length<=17);assert.ok(P.shapeCandidates(long,Array(32).fill('spline')).length<=33);
});
test('single-file OnBot Java compiles as Java 8 with SDK-only imports and no companion follower',async()=>{
 const e=new SimEngine({now:()=>0});try{const info=await e.load({field:'empty',start,robot:{length:14,width:12,intakeIn:0},sensors:{localization:'odometry'}}),q=base();q.zones=[];q.pins[0].path.action='Path';const route=P.plan(q,info.footprint),layout={name:'OnBot route',start,zones:[]},out=F.onBotJava({route,layout,tuning:info.tuning,robot:info.robot,localization:'odometry',routeJava:X.java(route,layout,{polygon:P.polygon})});
  // The whole autonomous is one file; the check TeleOp beside it is the only other one (an OpMode cannot be nested).
  assert.deepEqual(Object.keys(out.files).map(f=>f.split('/').pop()),['PlannedRouteAuto.java','PlannedRouteCheck.java']);assert.equal(out.name,'PlannedRouteAuto.java');assert.doesNotMatch(out.check.source,/^import deck\./m);assert.doesNotMatch(out.source,/com\.pedropathing|import deck\.|\brecord\s|Map\.of\(/);assert.match(out.source,/static final class DeckFollower/);assert.match(out.source,/Intake along this path/);assert.match(out.source,/MOTOR_POWER/);assert.ok(out.source.includes('"Path"'),'action literals are preserved when qualifying Java types');assert.throws(()=>X.validName('Path','org.firstinspires.ftc.teamcode'),/conflicts/);assert.throws(()=>X.validName('MyRoute','org.class'),/reserved/);assert.match(out.source,/target|face\(/i);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'deck-onbot-java8-')),file=path.join(dir,out.name);fs.writeFileSync(file,out.source);const jdk=path.join(__dirname,'../.cache/simulation-runtime/jdk'),home=fs.readdirSync(jdk).map(f=>path.join(jdk,f)).map(f=>fs.existsSync(path.join(f,'Contents/Home'))?path.join(f,'Contents/Home'):f).find(f=>fs.existsSync(path.join(f,'bin/javac.exe'))||fs.existsSync(path.join(f,'bin/javac'))),javac=path.join(home,'bin',process.platform==='win32'?'javac.exe':'javac');
  const result=spawnSync(javac,['--release','8','-encoding','UTF-8','-classpath',path.join(__dirname,'../sim-runtime/driver/classes'),'-d',dir,file],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);const bytes=fs.readFileSync(path.join(dir,'org/firstinspires/ftc/teamcode/PlannedRouteAuto.class'));assert.equal(bytes.readUInt16BE(6),52,'Java 8 bytecode');
 }finally{e.dispose();}
});
for(const localization of ['encoders','odometry','odometry3','fused','optical'])test(`OnBot Java standalone autonomous executes with ${localization}`,async()=>{
 let error='';const e=new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-onbot-')),now:()=>0,emit:m=>{if(m.state==='error')error=m.error;}});try{const info=await e.load({field:'empty',start,robot:{length:14,width:12,intakeIn:0,driveRpm:312},sensors:{localization}}),q=base();q.zones=[];const route=P.plan(q,info.footprint),layout={name:'OnBot route',start,zones:[]},out=F.onBotJava({route,layout,tuning:info.tuning,robot:info.robot,localization,routeJava:X.java(route,layout,{polygon:P.polygon})});assert.equal((await e.run({kind:'opmode',files:out.files,opMode:out.opMode})).ok,true,error);
  let i=0;for(;i<3600&&e.mode==='program';i++){await e.programTick();if(e.telemetry?.Phase==='Done')break;}assert.ok(i<3600,error||'OnBot routine did not finish');const t=e.truth();assert.ok(Math.hypot(t.x-40,t.y-110)<(localization==='encoders'?3:1.5),JSON.stringify(t));assert.ok(Math.abs(Math.atan2(Math.sin(t.heading),Math.cos(t.heading)))<.08);assert.equal(e.violations.size,0);
 }finally{e.dispose();}
});

// A continuous-servo turret keeps whatever power it was last given. Sent to an angle on an action path (the route does not
// wait there), it must still be steered to that angle and stopped, and one whose reading never changes must not turn for ever.
test('a continuous-servo turret is steered every loop, also on an action path, and stopped when its reading does not move',()=>{
  const C=require('../ui/sim-config.js'),Mech=require('../ui/sim-mechanisms.js'),s0={x:30,y:30,heading:0};
  const route=P.plan({start:s0,zones:[],pins:[{x:75,y:40,path:{kind:'action',action:'Turret to 30°'}},{x:105,y:85,action:'Shoot'}],style:'spline',clearance:1,defaultPower:.8},{front:8,rear:8,half:8}),layout={name:'Turret',field:'empty',width:144,height:144,start:s0,zones:[]};
  const mechanisms=Mech.sanitize({enabled:true,intakes:[{kind:'ramp',sides:['front'],motor:'intake',servo:'ramp'}],shooters:[{type:'turret',motor:'shooter',indexer:'indexer',indexerKind:'pusher',turretMotor:'turret',hood:'hood'}],turret:{kind:'crservo'}});
  const out=F.onBotJava({route,layout,tuning:{maxForward:60,maxStrafe:50},robot:{...C.robot({},'ftc'),length:16,width:16},localization:'optical',mechanisms,target:{x:72,y:72},setupName:'Turret',routeJava:X.java(route,layout,{polygon:P.polygon})}),src=out.source;
  assert.match(src,/CRServo turret/,'this robot’s turret is a continuous servo');
  assert.match(src,/public void update\(\) \{\s*if \(steering\) steerTurrets\(\);\s*\}/);assert.match(src,/public void update\(\) \{\s*mech\.update\(\);/,'the route calls it every loop');
  assert.match(src,/steering = true;\s*steerTurrets\(\);/);assert.match(src,/public void stop\(\) \{\s*steering = false;/,'and nothing steers after the stop');
  assert.match(src,/now - \w+SeenAt > TURRET_STALL_SECONDS/);
  // Nor does a turret that never gets there keep a Shoot or an Aim waiting for the rest of the autonomous.
  assert.match(src,/if \(aimSince < 0\) aimSince = now;\s*return now - aimSince >= AIM_TIMEOUT_SECONDS;/);
  // The guided check begins no further step once STOP is pressed, and switches off what was turning whatever happened.
  assert.match(out.check.source,/if \(!opModeIsActive\(\)\) throw new Stopped\(\);/);assert.match(out.check.source,/\} catch \(Stopped stopped\) \{\s*return;\s*\} finally \{/);assert.match(src,/setPower\(there \|\| \w+Dead \|\|/);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'deck-onbot-turret-')),jdk=path.join(__dirname,'../.cache/simulation-runtime/jdk'),home=fs.readdirSync(jdk).map(f=>path.join(jdk,f)).map(f=>fs.existsSync(path.join(f,'Contents/Home'))?path.join(f,'Contents/Home'):f).find(f=>fs.existsSync(path.join(f,'bin/javac.exe'))||fs.existsSync(path.join(f,'bin/javac'))),javac=path.join(home,'bin',process.platform==='win32'?'javac.exe':'javac');
  try{for(const [name,source] of [[out.name,src],[path.basename(out.check.file||'PlannedRouteCheck.java'),out.check.source]]){const file=path.join(dir,name);fs.writeFileSync(file,source);
    const r=spawnSync(javac,['--release','8','-encoding','UTF-8','-classpath',[path.join(__dirname,'../sim-runtime/driver/classes'),dir].join(path.delimiter),'-d',dir,file],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,`${name}:\n${r.stderr}`);}}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
