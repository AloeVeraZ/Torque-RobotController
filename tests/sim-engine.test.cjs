'use strict';
// Simulator engine: DSIM physics plus the Deck controller process, stepped tick by tick.
// Needs the local simulation build (node tools/simulation/build.cjs).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const runtime=path.join(__dirname,'../sim-runtime'),built=fs.existsSync(path.join(runtime,'dsim-host.cjs'))&&fs.existsSync(path.join(runtime,'driver/classes/deck/sim/RunBridge.class'));
const skip=built?false:'run node tools/simulation/build.cjs first';
const planner=built?require('../ui/sim-planner.js'):null;
function engine(){
  const {SimEngine}=require('../src/sim-engine.cjs'),events=[];
  // A frozen wall clock: the pacing timer never steps, so each test drives ticks explicitly.
  const e=new SimEngine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-sim-test-')),emit:m=>{if(m.type!=='frame')events.push(m);},now:()=>0});
  // These follower regressions use the original measured test robot and odometry explicitly.
  // New UI setups correctly start sensor-free and use the bundled Strafer specification.
  const load=e.load.bind(e);e.load=raw=>load({...raw,robot:{intake:'sloped',length:14.5,width:16.5,massLb:23.5,driveRpm:500,...raw?.robot},sensors:{localization:'odometry',...raw?.sensors}});
  e.events=events;return e;
}
async function ticks(e,limit,until=()=>false){for(let i=0;i<limit&&e.mode==='program'&&!until();i++)await e.programTick();}
const runEvent=(e,state)=>e.events.find(m=>m.type==='run'&&m.state===state);
const source=body=>`import deck.pathing.DeckFollower.Paths;\nimport deck.pathing.DeckFollower.Pose;\nimport deck.sim.*;\npublic class T implements DeckAutonomous {\n${body}\n}\n`;

test('manual driving moves through DSIM physics: acceleration limited, wall stops it',{skip},async()=>{
  const e=engine();try{
    await e.load({field:'empty',start:{x:20,y:72,heading:0}});e.manual({x:0,y:1,turn:0});
    const xs=[];for(let i=0;i<60;i++){e.tick(e.manualCommand());xs.push(e.truth().x);}
    const v1=(xs[1]-xs[0])*60,v59=(xs[59]-xs[58])*60;assert.ok(v1<20,'first tick is not a teleport');assert.ok(v59>60,'reaches speed');
    for(let i=0;i<240;i++)e.tick(e.manualCommand());const t=e.truth(),front=t.x+e.info.footprint.front;assert.ok(front<=144.5&&front>143,`stopped by the wall at ${front}`);
  }finally{e.dispose();}
});
test('a route that ends where game pieces are trapped against the wall stops pushing and finishes',{skip},async()=>{
  const e=engine();try{
    // BIOBUZZ lays a row of pollen along the right wall: a robot with no intake cannot reach a pin flush against it.
    const start={x:100,y:40,heading:0},info=await e.load({field:'biobuzz',start,sensors:{localization:'odometry'}}),pins=[{x:info.bounds.x1-info.footprint.front-.1,y:40}];
    const route=planner.plan({start,zones:[],pins,clearance:0},info.footprint,info.fieldZones,info.bounds);assert.ok(route.segments.length,'the planner allows the pin');
    const r=await e.run({kind:'route',route:{heading:route.heading,segments:route.segments,stops:route.stops}});assert.equal(r.ok,true);
    await ticks(e,60*12);const done=runEvent(e,'finished');assert.ok(done,'the run finished instead of pushing until time ran out');
    const short=pins[0].x-done.result.truth.x;assert.ok(short>1.5&&short<4,`stopped ${short} in short`);assert.ok(done.result.time<6,`took ${done.result.time} s`);
    assert.match(String(e.telemetry.blocked),/^Leg 1 stopped \d\.\d in short of its end point$/);
  }finally{e.dispose();}
});
test('Deck follows a planned route around a no-go zone through physics',{skip},async()=>{
  const e=engine();try{
    const zones=[{id:'z',type:'rect',x:72,y:72,width:20,height:50,angle:0}],start={x:20,y:72,heading:0},pins=[{x:124,y:72}];
    // Odometry pods isolate the follower from drive-encoder slip (which alone is worth 1-2 in).
    const info=await e.load({field:'empty',start,zones,sensors:{localization:'odometry'}});
    // FLOAT coast-down from the reference drivetrain (~84 in/s²).
    // Default path speed is 60% of top speed, capped near 45 in/s: this 500 RPM robot gets 0.45.
    assert.ok(info.tuning.maxPathSpeed>=.3&&info.tuning.maxPathSpeed<=.6);assert.ok(info.tuning.maxPathSpeed*info.tuning.maxForward<=45.5);assert.ok(info.tuning.forwardDeceleration>70&&info.tuning.forwardDeceleration<100,String(info.tuning.forwardDeceleration));
    const route=planner.plan({start,zones,pins,clearance:2},info.footprint,info.fieldZones,info.bounds);
    const r=await e.run({kind:'route',route:{heading:route.heading,segments:route.segments,stops:route.stops}});assert.equal(r.ok,true);assert.equal(r.program,'deck.sim.RouteAutonomous');
    let maxStep=0,prev=e.truth();await ticks(e,1200,()=>{const t=e.truth();maxStep=Math.max(maxStep,Math.hypot(t.x-prev.x,t.y-prev.y));prev=t;return false;});
    const done=runEvent(e,'finished');assert.ok(done,'run finished');const t=done.result.truth;
    assert.ok(Math.hypot(t.x-124,t.y-72)<1,`final error ${Math.hypot(t.x-124,t.y-72)}`);assert.deepEqual(done.result.violations,[]);
    assert.ok(maxStep<2,'no teleporting: per-tick motion is physical');assert.ok(done.result.time>route.length/info.drive.maxSpeed,'takes at least path length / top speed');
    assert.ok(done.result.estimate&&Math.hypot(done.result.estimate.x-t.x,done.result.estimate.y-t.y)>0,'estimate comes from simulated sensors, not truth');
  }finally{e.dispose();}
});
test('Stop stops the controller, zeroes the drive and ignores stale replies',{skip},async()=>{
  const e=engine();try{
    const start={x:20,y:72,heading:0},pins=[{x:120,y:72}],info=await e.load({field:'empty',start});
    const route=planner.plan({start,zones:[],pins,clearance:1},info.footprint,[],info.bounds);await e.run({kind:'route',route:{heading:0,segments:route.segments,stops:route.stops}});
    await ticks(e,40);assert.ok(Math.abs(e.command.forward)>.1,'moving under the Deck controller');
    const child=e.child.child,pending=e.programTick();e.stop();await pending.catch(()=>{});
    assert.deepEqual(e.command,{forward:0,strafe:0,turn:0});assert.equal(e.mode,'idle');assert.equal(e.child,null);
    await new Promise(r=>child.exitCode!==null||child.signalCode?r():child.once('exit',r));
    for(let i=0;i<120;i++)e.tick(e.manualCommand());assert.ok(Math.hypot(e.truth().vx,e.truth().vy)<.5,'robot came to rest');assert.equal(e.command.forward,0);
  }finally{e.dispose();}
});
test('user Java program: Deck API, telemetry and captured output',{skip},async()=>{
  const e=engine();try{
    await e.load({field:'empty',start:{x:30,y:30,heading:90}});
    const r=await e.run({kind:'source',source:source(`deck.pathing.DeckFollower f; public void init(SimRobot r){f=r.follower();f.setPose(r.startPose());System.out.println("init ok");f.follow(Paths.line(r.startPose(),new Pose(30,80,Math.PI/2)).constant(Math.PI/2));}
public void loop(SimRobot r){f.update();r.telemetry("y",Math.round(f.pose().y()));if(!f.isBusy())r.finish();}`)});
    assert.equal(r.ok,true,r.error);await ticks(e,900);
    const done=runEvent(e,'finished');assert.ok(done,'finished');assert.ok(Math.abs(done.result.truth.y-80)<1.2,`y ${done.result.truth.y}`);
    assert.ok(e.events.some(m=>m.type==='log'&&m.lines.includes('init ok'))||runEvent(e,'running').log?.includes('init ok'),'stdout captured, not mixed into the protocol');
    assert.ok(e.telemetry?.y,'telemetry reported');
  }finally{e.dispose();}
});
test('user code failures are readable and never hang the engine',{skip},async()=>{
  const e=engine();try{
    await e.load({field:'empty',start:{x:30,y:30,heading:0}});
    let r=await e.run({kind:'source',source:source('public void init(SimRobot r){ int x = "text"; } public void loop(SimRobot r){}')});
    assert.equal(r.ok,false);assert.match(r.error,/Compile error: T\.java:5: .*incompatible types/);
    r=await e.run({kind:'source',source:'public class Nope { }'});assert.match(r.error,/must implement deck\.sim\.DeckAutonomous/);
    e.events.length=0;r=await e.run({kind:'source',source:source('public void init(SimRobot r){} public void loop(SimRobot r){ if (r.time() > 0.05) throw new IllegalStateException("boom"); }')});
    assert.equal(r.ok,true);await ticks(e,30);const err=runEvent(e,'error');assert.match(err.error,/loop\(\) failed: IllegalStateException: boom/);assert.ok(err.trace.some(f=>f.startsWith('T.loop')));
    e.events.length=0;r=await e.run({kind:'source',source:source('public void init(SimRobot r){} public void loop(SimRobot r){ while (true) { } }')});
    const t0=Date.now();await ticks(e,3);assert.match(runEvent(e,'error').error,/took longer than 5 s/);assert.ok(Date.now()-t0<9000);assert.equal(e.child,null);
  }finally{e.dispose();}
});
test('gyro-only sensing refuses positional Java; pause holds time; reset restores the start',{skip},async()=>{
  const e=engine();try{
    const start={x:40,y:40,heading:45};await e.load({field:'empty',start,sensors:{localization:'gyro'}});
    await assert.rejects(e.run({kind:'source',source:'test'}),/IMU-only sensing cannot measure X\/Y/);
    e.manual({x:0,y:1,turn:.3});for(let i=0;i<30;i++)e.tick(e.manualCommand());const moved=e.truth();assert.ok(Math.hypot(moved.x-40,moved.y-40)>3);
    e.play();e.pause();const t=e.world.time;await new Promise(r=>setTimeout(r,60));await e.pump();assert.equal(e.world.time,t);
    e.reset();const back=e.truth();assert.ok(Math.abs(back.x-40)<1e-6&&Math.abs(back.y-40)<1e-6&&Math.abs(back.heading-45*Math.PI/180)<1e-9);assert.equal(e.world.time,0);
  }finally{e.dispose();}
});
test('DSIM fields: DECODE planar, BIOBUZZ Rapier 3D; reload disposes the 3D world',{skip},async()=>{
  const e=engine();try{
    const decode=await e.load({field:'decode',start:{x:30,y:72,heading:0}});assert.equal(decode.physics,'2d');assert.ok(decode.fieldZones.length>=4);assert.equal(e.world.balls.length,24,'loose game pieces remain in the physics world');assert.equal(decode.obstacleName,'goals and ramps');
    const red=decode.goals.find(g=>g.alliance==='red'),blue=decode.goals.find(g=>g.alliance==='blue');assert.equal(red.openingZ,38.75);assert.ok(red.triangle.every(p=>p.x>100)&&blue.triangle.every(p=>p.x<44),'goal colors and measured triangles match the physics frame');
    const bb=await e.load({field:'biobuzz',start:{x:30,y:40,heading:0}});assert.equal(bb.physics,'3d');assert.equal(e.world.balls.length,52);assert.ok(bb.structures.length>=4,'3D hive and flower structures for drawing');assert.equal(e.world.biobuzz.physics,'3d');assert.ok(bb.bounds.x0>1.3&&bb.bounds.x0<1.4);
    const first=e.world;e.manual({x:0,y:1,turn:0});for(let i=0;i<30;i++)e.tick(e.manualCommand());assert.ok(e.truth().x>35);
    e.reset();assert.notEqual(e.world,first,'reset builds a fresh world');assert.ok(Math.abs(e.truth().x-30)<1e-6);
  }finally{e.dispose();}
});
test('BIOBUZZ staged pollen starts apart and stays put until something touches it',{skip},async()=>{
  // One robot means two no-shows on the other alliance; both of their preload lines used to land on one spot.
  const e=engine();try{for(const alliance of ['red','blue']){
    await e.load({field:'biobuzz',alliance,start:{x:72,y:20,heading:90}});const ground=e.world.balls.filter(b=>b.state.kind==='ground'),before=new Map(ground.map(b=>[b.id,{...b.pos}]));
    for(const [i,a] of ground.entries())for(const b of ground.slice(i+1))assert.ok(Math.hypot(a.pos.x-b.pos.x,a.pos.y-b.pos.y)>=a.r+b.r-1e-6,`${alliance}: pollen ${a.id} and ${b.id} start overlapping`);
    // As on the real field: the other alliance's eight sit in one line against its side wall, inside its LOADING ZONE.
    const other=alliance==='red'?'blue':'red',zone=other==='red'?[95.9,118.6]:[25.4,48.1],wall=other==='red'?e.info.bounds.x0:e.info.bounds.x1;
    const line=ground.filter(b=>Math.abs(b.pos.x+72-wall)<3&&b.pos.y+72>zone[0]-1&&b.pos.y+72<zone[1]+1);
    assert.equal(line.length,8,`${other}: eight pollen in the loading zone`);assert.equal(new Set(line.map(b=>b.pos.x.toFixed(3))).size,1,`${other}: one line, not two`);
    for(const b of line)assert.ok(b.pos.y+72-b.r>zone[0]-.01&&b.pos.y+72+b.r<zone[1]+.01,`${other}: pollen ${b.id} inside the loading zone`);
    e.manual({x:0,y:0,turn:0});for(let i=0;i<120;i++)e.tick(e.manualCommand());
    for(const b of e.world.balls.filter(b=>before.has(b.id))){const p=before.get(b.id);assert.ok(Math.hypot(b.pos.x-p.x,b.pos.y-p.y)<.5,`${alliance}: pollen ${b.id} moved on its own`);}
  }}finally{e.dispose();}
});
test('the standalone Deck controller is built without a third-party follower and uses an injected clock',{skip},()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(runtime,'manifest.json'),'utf8'));assert.equal(manifest.java.controller,'deck');assert.equal(manifest.java.clock,'injected simulation clock');assert.equal(manifest.upstream.pedro,undefined);
  const source=fs.readFileSync(path.join(__dirname,'../tools/simulation/java/deck/pathing/DeckFollower.java'),'utf8');assert.doesNotMatch(source,/com\.pedropathing|System\.nanoTime/);assert.match(source,/LongSupplier/);
});
test('a light, fast robot stays on a zigzag route: correction keeps priority over path speed',{skip},async()=>{
  const e=engine();try{
    // 9 lb at 1150 RPM: a 0.3 power ceiling leaves cruise and correction fighting for the same motors.
    // Uniformly scaling both let this robot cut corners by about 4 in.
    const start={x:20,y:20,heading:0},pins=[{x:60,y:60},{x:100,y:20},{x:124,y:110}];
    const info=await e.load({field:'empty',start,robot:{length:15,width:15,massLb:9,driveRpm:1150},sensors:{noise:0,gyroDrift:0}});
    const route=planner.plan({start,zones:[],pins,clearance:2,style:'sharp',rotate:false},info.footprint,info.fieldZones,info.bounds);
    const path=route.segments.flatMap(s=>s.points),off=t=>Math.min(...path.slice(1).map((b,i)=>{const a=path[i],dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy||1,u=Math.max(0,Math.min(1,((t.x-a.x)*dx+(t.y-a.y)*dy)/l));return Math.hypot(t.x-a.x-dx*u,t.y-a.y-dy*u);}));
    await e.run({kind:'route',route:{heading:route.heading,segments:route.segments,stops:route.stops}});
    let worst=0;await ticks(e,1800,()=>{worst=Math.max(worst,off(e.truth()));return false;});
    const done=runEvent(e,'finished');assert.ok(done,'finished');assert.ok(worst<2,`left the path by ${worst.toFixed(2)} in`);assert.ok(Math.hypot(done.result.truth.x-124,done.result.truth.y-110)<1);
  }finally{e.dispose();}
});
test('pins with a pause: the robot stops, waits, then continues',{skip},async()=>{
  const e=engine();try{
    const start={x:20,y:40,heading:0},pins=[{x:60,y:40,wait:1,action:'Score'},{x:100,y:40}],info=await e.load({field:'empty',start});
    const route=planner.plan({start,zones:[],pins,clearance:1,style:'spline'},info.footprint,[],info.bounds);
    await e.run({kind:'route',route:{heading:route.heading,segments:route.segments,stops:route.stops}});
    let still=0,sawAction=false;
    await ticks(e,1200,()=>{if(e.waiting){sawAction=sawAction||e.waiting.action==='Score';const t=e.truth();if(Math.hypot(t.vx,t.vy)<.5&&Math.abs(t.x-60)<1.5)still++;}return false;});
    const done=runEvent(e,'finished');assert.ok(done,'finished');assert.ok(sawAction,'reported the pause action');
    assert.ok(still>=45,`robot held still at the stop for about 1 s (${still} ticks)`);assert.ok(Math.abs(done.result.truth.x-100)<1);
  }finally{e.dispose();}
});
test('find fastest route: test-drives candidates headlessly and reports times',{skip},async()=>{
  const e=engine();try{
    const start={x:20,y:72,heading:0},zones=[{id:'z',type:'rect',x:72,y:72,width:24,height:40,angle:0}],pins=[{x:124,y:72}],info=await e.load({field:'empty',start,zones,sensors:{localization:'odometry'}});
    const routes=['sharp','rounded','spline'].map(style=>planner.plan({start,zones,pins,clearance:2,style,rotate:false},info.footprint,[],info.bounds)).map(r=>({heading:r.heading,segments:r.segments,stops:r.stops}));
    const progress=[],results=await e.evaluate(routes,(i,n)=>progress.push(`${i}/${n}`));
    assert.deepEqual(progress,['0/3','1/3','2/3']);assert.equal(results.length,3);
    for(const r of results){assert.equal(r.ok,true,r.error);assert.equal(r.violations,0);assert.ok(Math.hypot(r.truth.x-124,r.truth.y-72)<1.5);}
    // Each time is physical: no faster than the path at the capped path speed, and well within the 60 s limit.
    const lengths=['sharp','rounded','spline'].map(style=>planner.plan({start,zones,pins,clearance:2,style,rotate:false},info.footprint,[],info.bounds).length);
    results.forEach((r,i)=>{assert.ok(r.time>=lengths[i]/(info.tuning.maxForward*info.tuning.maxPathSpeed)-.05,`${r.time} s for ${lengths[i]} in`);assert.ok(r.time<15);});
    assert.equal(e.world.time,0,'the visible simulation did not move');
  }finally{e.dispose();}
});
test('STEP assembly import merges every part into one rigid body, in inches',{skip},async()=>{
  const step=path.join(__dirname,'../.cache/simulation-deps/node_modules/occt-import-js/test/testfiles/cax-if/as1-oc-214.stp');
  if(!fs.existsSync(step)||!fs.existsSync(path.join(runtime,'occt/occt-import-js.wasm')))return;
  const {convertStep}=require('../src/sim-model.cjs'),m=await convertStep(step,runtime);
  assert.ok(m.parts>10,'a multi-part assembly');assert.equal(m.index.length,m.triangles*3);assert.equal(m.positions.length,m.colors.length);
  let max=0;for(const i of m.index)max=Math.max(max,i);assert.ok(max<m.positions.length/3,'one index buffer over all parts');
  let x0=Infinity,x1=-Infinity;for(let i=0;i<m.positions.length;i+=3){x0=Math.min(x0,m.positions[i]);x1=Math.max(x1,m.positions[i]);}
  assert.ok(x1-x0>7&&x1-x0<8.5,`size in inches (${(x1-x0).toFixed(2)})`);
  // Read in pieces on several threads, the same body: every part, placed and coloured as in one read.
  const split=await convertStep(step,runtime,{pieces:4,threads:3});
  assert.ok(split.pieces>1,'split into pieces');assert.equal(split.parts,m.parts);assert.equal(split.triangles,m.triangles);
  const box=v=>{const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(let i=0;i<v.positions.length;i+=3)for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],v.positions[i+a]);hi[a]=Math.max(hi[a],v.positions[i+a]);}return [...lo,...hi].map(x=>+x.toFixed(3));};
  assert.deepEqual(box(split),box(m));assert.deepEqual(new Set(split.colors),new Set(m.colors));
  // Heavy parts as convex hulls: every part still there, placed where it belongs (the hull of a part is no smaller
  // than the part, and no bigger than its edges allow).
  const quick=await convertStep(step,runtime,{exactBytes:0,pieces:3,threads:3});
  assert.ok(quick.simplified>0,'some parts simplified');assert.equal(quick.parts,m.parts);
  box(quick).forEach((v,i)=>assert.ok(Math.abs(v-box(m)[i])<.05,`hull box ${i}: ${v} vs ${box(m)[i]}`));
  // A second import of the same file comes from the cache.
  const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),'deck-cad-'));await convertStep(step,runtime,{cacheDir});const again=await convertStep(step,runtime,{cacheDir});
  assert.equal(again.cached,true);assert.equal(again.triangles,m.triangles);assert.deepEqual(box(again),box(m));
  await assert.rejects(convertStep(path.join(__dirname,'sim-engine.test.cjs'),runtime),/\.step or \.stp/);
});
