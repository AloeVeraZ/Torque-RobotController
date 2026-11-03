#!/usr/bin/env node
'use strict';
// Deck simulation from a terminal. Inspect a built-in field, build or edit a setup file, plan the
// route, test-drive it in the same physics the app uses, optimize path shapes, export robot code,
// and show the result in the app (Run & review). Offline only: nothing here talks to a robot.
//   node tools/deck-sim.cjs help        (Windows without Node on PATH: deck-sim.cmd help)
// Frames match the app: inches, origin at the audience-left corner, +X right, +Y away from the
// audience, headings in degrees counter-clockwise from +X.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.join(__dirname,'..');
const RobotLog=require('../ui/sim-robot-log.js'),Mech=require('../ui/sim-mechanisms.js'),Wpilog=require('../ui/sim-wpilog.js'),P=require('../ui/sim-planner.js'),C=require('../ui/sim-config.js'),X=require('../ui/sim-export.js'),F=require('../ui/sim-ftc.js'),M=require('../ui/sim-motionmodule.js'),Timed=require('../ui/sim-timed.js'),Pedro=require('../ui/sim-pedro.js');
const GAMES={empty:'Empty field',biobuzz:'BIOBUZZ'},AXES=['+x','-x','+y','-y','+z','-z'];
const finite=n=>typeof n==='number'&&Number.isFinite(n),round=(n,d=2)=>Math.round(n*10**d)/10**d;

// ------------------------------------------------------------------ arguments and files
function parse(argv){
  const out={_:[],flags:{}};
  for(let i=0;i<argv.length;i++){const a=argv[i];if(!a.startsWith('--')){out._.push(a);continue;}
    const eq=a.indexOf('='),key=a.slice(2,eq>0?eq:undefined);
    if(eq>0)out.flags[key]=a.slice(eq+1);else if(i+1<argv.length&&!argv[i+1].startsWith('--'))out.flags[key]=argv[++i];else out.flags[key]=true;}
  return out;
}
const num=(v,name)=>{const n=Number(v);if(v===undefined||v===true||!Number.isFinite(n))throw Error(`${name} needs a number.`);return n;};
const point=(v,name)=>{const [x,y]=String(v).split(',').map(Number);if(!finite(x)||!finite(y))throw Error(`${name} needs x,y in inches, e.g. 59.25,58.56.`);return {x,y};};
function readSetup(file){
  if(!file)throw Error('Name the setup file, e.g. my-route.json.');
  const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(raw?.deckSimulation!==2&&raw?.deckSimulation!==1)throw Error(`${file} is not a Deck simulation setup.`);
  if(!Array.isArray(raw.layouts)||!raw.layouts.length)throw Error(`${file} has no field layouts.`);return raw;
}
const writeSetup=(file,setup)=>fs.writeFileSync(file,JSON.stringify(setup,null,2)+'\n');
const layoutOf=setup=>setup.layouts.find(l=>l.id===setup.active)||setup.layouts[0];
const holonomic=setup=>C.drives[setup.robot?.drivetrain]?.holonomic!==false;
const power=setup=>setup.tuning?.maxPathSpeed??.8;
// The --odometry keys: each odometry setting by its dotted name (pinpoint.xOffset, otos.heading, pods.perp.reversed).
const odometryKeys=()=>Object.entries(C.odometryOf({})).flatMap(([group,v])=>group==='pods'?Object.entries(v).flatMap(([pod,p])=>Object.keys(p).map(k=>`pods.${pod}.${k}`)):Object.keys(v).map(k=>`${group}.${k}`));

// ------------------------------------------------------------------ the simulator
let Engine=null;
async function load(setup,l=layoutOf(setup)){
  // The CAD kernel's one-time initialization notice is not useful in a terminal or in --json output.
  if(!Engine){const warn=console.warn;console.warn=(...a)=>{if(!/deprecated parameters for the initialization/.test(String(a[0])))warn(...a);};}
  Engine??=require('../src/sim-engine.cjs').SimEngine;
  const e=new Engine({workDir:fs.mkdtempSync(path.join(os.tmpdir(),'deck-sim-')),now:()=>0,emit:m=>{if(m?.type==='run'&&m.state==='error')e.lastError=m.error;}});
  const info=await e.load({mechanisms:setup.mechanisms,alliance:l.alliance,field:l.field,width:l.width,height:l.height,elements:l.elements!==false,start:l.start||{x:24,y:24,heading:0},zones:l.zones||[],robot:setup.robot,controller:setup.controller,sensors:setup.sensors,timing:{...setup.timing,power:power(setup)},tuning:setup.tuning,kinematics:setup.kinematics});
  return {e,info,l};
}
function request(setup,l,info,pins=l.pins){
  if(!l.start)throw Error('Set a starting pose first: deck-sim start <setup> <x> <y> <heading>.');
  return {start:l.start,zones:l.zones||[],pins:Mech.prepare(pins,info.mechanisms,info.target),clearance:l.clearance??2,style:l.style||'spline',tension:l.tension,rotate:l.rotate!==false,nonholonomic:!holonomic(setup),defaultPower:power(setup)};
}
function planRoute(setup,l,info,project=request(setup,l,info)){const route=P.plan(project,info.footprint,info.fieldZones,info.bounds);route.defaultPower=power(setup);return route;}
// Drives one route to completion on this engine, exactly as Run does in the app.
async function drive(e,route){
  const started=await e.run({kind:'route',route});if(!started.ok)throw Error(started.error||'The route could not start.');
  for(let guard=0;['program','timed'].includes(e.mode)&&guard<3600;guard++)if(e.mode==='timed')e.timedTick();else await e.programTick();
  if(!e.result)throw Error(['program','timed'].includes(e.mode)?'The route did not finish within 60 s.':e.lastError||'The test drive stopped early.');
  return e.result;
}

// ------------------------------------------------------------------ field facts for planners
// BIOBUZZ (2026-27, Competition Manual V1 of 2026-09-12; geometry from FIRST's field CAD as used
// by the simulator). Each HIVE cell sits 15.519 in along a 30° tilted arm from its pivot; at the
// start red's audience-side (south) cell and blue's rear-side (north) cell face up. A shot only
// enters the up cell travelling toward the pivot, so launch from the up cell's outer side.
function fieldFacts(info){
  const facts={field:info.field,name:info.fieldName,bounds:info.bounds,obstacles:info.fieldZones,footprint:info.footprint,timing:{autoSeconds:30,transitionSeconds:8,teleopSeconds:120}};
  if(info.field==='biobuzz'){
    const dy=round(15.519*Math.cos(Math.PI/6)),cell=(x,s)=>({x,y:round(72+(s==='north'?dy:-dy))});
    const hive=(a,up)=>{const x=info.trays[a].pivot[0];return {pivot:{x,y:72},cells:{north:cell(x,'north'),south:cell(x,'south')},upAtStart:up,launchFrom:up==='south'?'the audience side (y below the cell), shooting toward +y':'the rear side (y above the cell), shooting toward -y'};};
    Object.assign(facts,{
      alliances:{red:'x < 72 (columns A-C)',blue:'x > 72 (columns D-F)'},
      hives:{red:hive('red','south'),blue:hive('blue','north')},
      flowers:info.flowers.map(f=>({name:f.name,x:round(f.rings[0].x),y:round(f.rings[0].y),note:'4 pollen inside at the start; pollen can be pulled from the bottom retrieval opening'})),
      loadingZones:{red:{x0:1.33,x1:12.9,y0:95.91,y1:118.6},blue:{x0:131.1,x1:142.67,y0:25.4,y1:48.09}},
      gardens:{red:{x0:1.33,x1:24.59,y0:1.33,y1:3.9,note:'4 pollen staged along the audience wall from the corner'},blue:{x0:119.41,x1:142.67,y0:140.1,y1:142.67,note:'4 pollen staged along the rear wall from the corner'}},
      scoring:['LEAVE 3 (auto): stop touching the perimeter wall','PARK 5 (end of auto and end of match): at least partly in a LOADING ZONE','HIVE TIP 20: launch into the up-facing cell until it tips','Pollen/nectar left in an up cell 2, in an owned FLOWER 2 (FLOWER scoring opens with 60 s left), in your GARDEN 1'],
      startRules:'Touch the wall, stay on your own half, not in a LOADING ZONE, not touching a FLOWER, 4 pollen preloaded.'});
  }
  if(info.goals?.length)facts.goals=info.goals;
  facts.actions={Intake:'run the intake rollers (pin: --for S seconds after its --wait pause; path: the whole path or --path-for S)','Ramp down':'fold the ramp down (it stays down; needed to reach flower pollen)','Ramp up':'fold the ramp back up','Turret to DEG':'turn every turret to an angle from the robot front (Turret 2 to DEG for the second)','Spin up':'start the flywheel early',Aim:'point the turret at the target',Shoot:'spin up, aim and shoot: at a pin until empty or --for S; on a path the whole path or --path-for S',steps:'several in one --action (one after another) or --path-action (together), separated by ";", each may end in "for S"'};
  return facts;
}

// ------------------------------------------------------------------ robot CAD
// Bounding box of a STEP, STL, OBJ or GLB model, in inches, for the collision footprint. The app
// still shows the model itself; planning uses the length/width/height measured here.
async function cadBox(file,{units,up='z'}){
  const ext=path.extname(file).toLowerCase();let points=null,scale=1,groups=[];
  if(ext==='.step'||ext==='.stp'){const step=await require('../src/sim-model.cjs').convertStep(file,path.join(root,'sim-runtime'));points=step.positions;groups=step.groups||[];}
  else if(ext==='.stl'){const b=fs.readFileSync(file);scale=1/25.4;
    if(b.length>=84&&84+b.readUInt32LE(80)*50===b.length){const n=b.readUInt32LE(80);points=new Float32Array(n*9);for(let i=0;i<n;i++)for(let j=0;j<9;j++)points[i*9+j]=b.readFloatLE(84+i*50+12+j*4);}
    else points=Float32Array.from([...b.toString('utf8').matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap(m=>[+m[1],+m[2],+m[3]]));}
  else if(ext==='.obj'){scale=1/25.4;points=Float32Array.from([...fs.readFileSync(file,'utf8').matchAll(/^v\s+(\S+)\s+(\S+)\s+(\S+)/gm)].flatMap(m=>[+m[1],+m[2],+m[3]]));}
  else if(ext==='.glb'){const b=fs.readFileSync(file);if(b.readUInt32LE(0)!==0x46546c67)throw Error('That .glb file is not binary glTF.');const json=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));scale=39.3701;up=units?up:'y';
    const box=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];for(const mesh of json.meshes||[])for(const p of mesh.primitives||[]){const a=json.accessors?.[p.attributes?.POSITION];if(a?.min&&a?.max)for(let i=0;i<3;i++){box[i]=Math.min(box[i],a.min[i]);box[i+3]=Math.max(box[i+3],a.max[i]);}}
    points=Float32Array.from(box);}
  else throw Error('Use a STEP (.step/.stp), .stl, .obj or .glb robot file.');
  if(units)scale={in:1,mm:1/25.4,cm:1/2.54,m:39.3701}[units]??(()=>{throw Error('--units is in, mm, cm or m.');})();
  if(!points?.length)throw Error(`${path.basename(file)} has no geometry.`);
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(let i=0;i<points.length;i+=3)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],points[i+k]);hi[k]=Math.max(hi[k],points[i+k]);}
  const size=lo.map((v,k)=>(hi[k]-v)*scale),vertical=up==='y'?1:2,[a,b]=[0,1,2].filter(k=>k!==vertical);
  return {length:round(size[a],1),width:round(size[b],1),height:round(size[vertical],1),...(groups.length?{groups}:{})};
}
// A STEP assembly's named parts (Chassis, Intake, Shooter, Turret, Indexer...) set up the robot like the app's import:
// chassis size, intakes and shooters. Returns lines describing what was found.
function setUpFromCad(setup,box,ref){
  if(!box.groups?.length)return [];const M=require('../ui/sim-robot-model.js'),parts=box.groups.map(g=>({name:g.name,...Mech.partRole(g.name,g.inner),box:g.box}));
  const boxes=M.partBoxes({units:'in',front:ref.front,top:ref.top,parts});if(!boxes)return [];const out=Mech.fromCad(boxes.parts,{length:setup.robot.length,width:setup.robot.width});
  if(out.robot)Object.assign(setup.robot,{length:out.robot.length,width:out.robot.width});
  if(out.intakes.length||out.shooters.length){const m=Mech.sanitize(setup.mechanisms);if(!m.enabled){m.intakes=[];m.shooters=[];}if(out.intakes.length)m.intakes=out.intakes;if(out.shooters.length)m.shooters=out.shooters;if(out.capacity&&!m.capacity?.nectar)m.capacity=out.capacity;m.enabled=true;setup.mechanisms=Mech.sanitize(m);}
  return out.found;
}

// ------------------------------------------------------------------ pins
// A pin is a stop on the route; its `path` describes the drive that reaches it.
// Several steps in one --action or --path-action, separated by ";" (each may end in "for S"): "Shoot; Ramp down; Intake for 1.5".
// --for and --cell apply to a single step.
// A single action keeps the plain fields (action, actionSeconds, cell).
function stepsInto(target,text,seconds,cell){const parts=String(text).split(';').map(t=>t.trim()).filter(Boolean);
  if(parts.length<2){target.action=parts[0]||'';if(seconds!==null)target.actionSeconds=seconds;if(cell==='other')target.cell='other';return;}
  target.steps=parts.map(t=>{const m=/^(.*?)\s+for\s+(\d+(?:\.\d+)?)\s*s?$/i.exec(t);return {action:m?m[1]:t,seconds:m?Number(m[2]):null,cell:'start'};});}
function pinFrom(flags,x,y){
  const pin={x:num(x,'x'),y:num(y,'y'),wait:flags.wait!==undefined?num(flags.wait,'--wait'):0,action:'',path:{}};
  if(typeof flags.action==='string')stepsInto(pin,flags.action,flags.for!==undefined?num(flags.for,'--for'):null,flags.cell);
  else{if(flags.for!==undefined)pin.actionSeconds=num(flags.for,'--for');if(flags.cell==='other')pin.cell='other';}
  if(flags.note)pin.note=String(flags.note);
  if(flags.turn!==undefined){pin.turn=num(flags.turn,'--turn');pin.turnMode=flags['turn-mode']||'absolute';}
  if(flags.face){pin.turnMode='track';pin.turn=0;pin.target=point(flags.face,'--face');}
  const p=pin.path;
  if(flags.power!==undefined)p.power=num(flags.power,'--power');
  if(flags.style)p.style=flags.style;
  if(typeof flags['path-action']==='string'){p.kind='action';stepsInto(p,flags['path-action'],flags['path-for']!==undefined?num(flags['path-for'],'--path-for'):null,flags['path-cell']);}
  if(flags.track){p.rotate='track';p.target=point(flags.track,'--track');}
  else if(flags.heading!==undefined){p.rotate='turn';p.heading=num(flags.heading,'--heading');}
  else if(flags.spin!==undefined){p.rotate='spin';p.spins=num(flags.spin,'--spin');}
  else if(flags.tangent)p.rotate='tangent';
  else if(flags.reverse)p.rotate='reverse';
  // --curve x1,y1[,x2,y2[,x3,y3]]: a custom Bezier curve through these control points, driven as given.
  if(flags.curve!==undefined){const v=String(flags.curve).split(',').map(Number);if(v.length<2||v.length>6||v.length%2||!v.every(Number.isFinite))throw Error('--curve needs 1 to 3 control points: x1,y1[,x2,y2[,x3,y3]].');p.controls=[];for(let i=0;i<v.length;i+=2)p.controls.push({x:v[i],y:v[i+1]});}
  if(flags['path-note'])p.note=String(flags['path-note']);
  return clean(pin);
}
// Same rules the app's editors apply, so a terminal-made pin is never something the app rejects.
function clean(raw){
  if(!raw||!finite(raw.x)||!finite(raw.y))throw Error('Each pin needs numeric x and y.');
  // Several steps are kept as steps; the joined name is kept too, for older versions of the app.
  const e=P.pinEffects(raw),pin={x:raw.x,y:raw.y,wait:e.wait,action:e.action};if(e.actionSeconds!==null)pin.actionSeconds=e.actionSeconds;if(e.cell==='other')pin.cell='other';if(e.steps.length>1)pin.steps=e.steps;
  if(e.note)pin.note=e.note;if(e.turn!==null){pin.turn=e.turn;pin.turnMode=e.turnMode;}if(e.target)pin.target=e.target;
  const p=e.path,path={};if(p.kind==='action'){path.kind='action';path.action=p.action;if(p.actionSeconds!==null)path.actionSeconds=p.actionSeconds;if(p.cell==='other')path.cell='other';if(p.steps.length>1)path.steps=p.steps;}if(p.style)path.style=p.style;if(p.controls)path.controls=p.controls;if(p.power!==null)path.power=p.power;if(p.note)path.note=p.note;
  if(p.rotate!=='keep'){path.rotate=p.rotate;if(p.rotate==='turn')path.heading=p.heading;if(p.rotate==='relative')path.angle=p.angle;if(p.rotate==='spin')path.spins=p.spins;if(p.rotate==='track')path.target=p.target;}
  if(Object.keys(path).length)pin.path=path;return pin;
}
function describeMechanisms(m,l){
  if(!m.enabled)return 'Mechanisms: off (the robot pushes pieces but cannot carry or shoot). Turn on: deck-sim mech <setup> --on';
  const s=m.shooter,t=Mech.target(m,l.field,l.alliance),cap=m.capacity;
  return [`Mechanisms: on · ${l.alliance||'red'} alliance · holds ${cap.pollen} pollen${cap.nectar?` + ${cap.nectar} nectar`:''} · preloads ${m.preload.pollen} pollen`,
    ...(m.intakes.length?m.intakes.map((i,n)=>`  Intake ${n+1}: ${Mech.INTAKES[i.kind]} on the ${i.sides.join(' + ')}${i.kind==='kicker'?'':` · ${i.device==='crservo'?'continuous servo':'motor'} "${i.motor}"${i.reversed?' (reversed)':''}${i.motor2?` + "${i.motor2}"${i.reversed2?' (reversed)':''}`:''} at ${i.power}`}${Mech.deploys(i.kind)?` · servo "${i.servo}" (down in ${i.down} s, up in ${i.up} s)`:''}`):['  Intake: none (shoots its preloads)']),
    ...(m.shooters.length?m.shooters.map((x,n)=>`  Shooter ${n+1}: ${x.sharesTurret?"on shooter 1's turret":x.type==='turret'?'turret':`fixed, firing ${x.facing}`} at ${Mech.MOUNTS[x.mount].toLowerCase()} · ${Mech.PIECES[x.pieces].toLowerCase()} · flywheel "${x.motor}"${x.reversed?' (reversed)':''}${x.motor2?` + "${x.motor2}"${x.reversed2?' (reversed)':''}`:''} · ${Mech.INDEXERS[x.indexerKind].toLowerCase()} feeder "${x.indexer}"${Mech.servoFeeder(x.indexerKind)?` (feed ${x.feedPos}, rest ${x.restPos})`:x.indexerReversed?' (reversed)':''}${x.type==='turret'&&!x.sharesTurret?` · turret ${m.turret.kind} "${x.turretMotor}"${x.turretReversed?' (reversed)':''}`:''}`):['  Shooter: none']),
    m.shooters.length?`  Timing: ${s.control==='power'?`flywheels at power ${s.power} (no encoder)`:`${s.rpm} RPM flywheels, at speed within ${round(s.tolerance*100,1)}%${s.pidf?`, PIDF ${s.pidf.p}/${s.pidf.i}/${s.pidf.d}/${s.pidf.f}`:''}`} · spin-up ${s.spinUp} s · transfer ${m.transfer.seconds} s · indexing ${m.indexer.seconds} s${m.shooters.some(x=>x.indexerKind==='pusher')?` · push ${m.indexer.pushSeconds} s`:''}`:'',
    Mech.hasTurret(m)?`  Turrets: ${m.turret.speed}°/s · ${m.turret.min}° to ${m.turret.max}° · ${m.turret.kind==='servo'?`servo facing forward at ${m.turret.servoCenter}, ${m.turret.servoDegrees}° from 0 to 1`:`${m.turret.ticksPerDegree} ticks/°`}`:'',
    m.shooters.length?`  Aims at (${round(t.x)}, ${round(t.y)})${m.target?'':' (own hive up cell)'}`:''].filter(Boolean).join('\n');
}
function describe(setup,l,route){
  const lines=[`${l.name} · ${GAMES[l.field]||l.field} · ${l.start?`start (${round(l.start.x)}, ${round(l.start.y)}) ${round(l.start.heading,1)}°`:'no start yet (deck-sim start <setup> <x> <y> <heading>)'}`];
  l.pins.forEach((pin,i)=>{const s=route?.stops?.[i],bits=[P.pathDescription(pin.path,power(setup)).join(', ')];if(pin.wait)bits.push(`pause ${pin.wait} s`);if(pin.action)bits.push(`at pin: ${pin.action}`);
    if(finite(pin.turn))bits.push(pin.turnMode==='track'&&pin.target?`face (${pin.target.x}, ${pin.target.y})`:`turn ${pin.turnMode==='relative'?'by ':'to '}${pin.turn}°`);
    lines.push(`  ${i+1}. (${round(pin.x)}, ${round(pin.y)})  ${bits.join(' · ')}`);});
  if(route)lines.push(`Route: ${round(route.length,1)} in, ${route.stops.filter(s=>s.wait>0).length} pauses, ${route.segments.length} segments.`);
  return lines.join('\n');
}

// ------------------------------------------------------------------ exports
const layoutFor=l=>({name:l.name,field:l.field,fieldName:GAMES[l.field],width:l.width,height:l.height,start:l.start,zones:l.zones||[]});
const javaNames=setup=>({className:setup.export?.className||'PlannedRoute',packageName:setup.export?.packageName||'org.firstinspires.ftc.teamcode'});
// The Control Hub code the app exports: one OnBot Java file, or the TeamCode file set.
function teamCode(setup,l,route,info,onbot){
  const lay=layoutFor(l),names=javaNames(setup);
  return F[onbot?'onBotJava':'files']({route,layout:lay,mechanisms:info.mechanisms,kinematics:require('../ui/sim-kinematics.js').sanitize(setup.kinematics),target:info.target,tuning:info.tuning,robot:info.robot,localization:setup.sensors?.localization,setupName:setup.setupName,...names,routeJava:X.java(route,lay,{...names,polygon:P.polygon})});
}
// The Pedro export plus a pedro/Constants.java that builds the Follower from DeckStarterConstants, as a team would.
function pedroForSim(setup,l,route,info){
  const names=javaNames(setup),out=Pedro.files({route,layout:layoutFor(l),mechanisms:info.mechanisms,target:info.target,robot:info.robot,setupName:setup.setupName,defaultPower:power(setup),...names,exporter:X,ftc:F,hardware:F.hardware(info.robot,setup.sensors?.localization),tuning:info.tuning});
  if(!out.files['org/firstinspires/ftc/teamcode/pedro/DeckStarterConstants.java'])throw Error('Pedro starter constants need a mecanum robot with goBILDA Pinpoint, SparkFun OTOS or two/three odometry pods.');
  return {...out,files:{...out.files,'org/firstinspires/ftc/teamcode/pedro/Constants.java':Pedro.QUICKSTART_USING_STARTER}};
}
function exported(setup,l,route,info,format){
  const lay=layoutFor(l),names=javaNames(setup),routeJava=()=>X.java(route,lay,{...names,polygon:P.polygon}),team=onbot=>teamCode(setup,l,route,info,onbot);
  const timing={...info.timing,power:power(setup)};
  // OnBot Java: the autonomous and its check TeleOp (which tests each device on the robot first).
  if(format==='onbot'){const out=team(true);return {files:{[out.name]:out.source,[out.check.name]:out.check.source},note:`Upload both files to OnBot Java. Run ${out.check.name.replace(/\.java$/,'')} (TeleOp) first to test each device.`};}
  if(format==='teamcode'){const out=team(false);return {files:out.files,note:`OpMode ${out.opMode}. Mechanism code goes in RobotActions.java.`};}
  if(format==='pedro'){const out=Pedro.files({route,layout:lay,mechanisms:info.mechanisms,kinematics:require('../ui/sim-kinematics.js').sanitize(setup.kinematics),localization:setup.sensors?.localization,target:info.target,robot:info.robot,setupName:setup.setupName,defaultPower:power(setup),...names,exporter:X,ftc:F,hardware:F.hardwareIfSupported(info.robot,setup.sensors?.localization),tuning:info.tuning});return {files:out.files,note:`OpMode ${out.opMode} for Pedro Pathing ${Pedro.PEDRO_VERSION} (needs the Quickstart's pedro/Constants.java). Mechanism code goes in RobotActions.java.`};}
  if(format==='java')return {files:{[`${names.className}.java`]:routeJava()}};
  if(format==='pp')return {files:{[`${l.name.replace(/[^\w-]+/g,'_')}.pp`]:X.pp(route,lay,{polygon:P.polygon,bounds:info.bounds,pins:l.pins})}};
  if(format==='timed')return {files:{'timed-route.json':JSON.stringify({format:'deck-timed-drive-v1',controller:setup.controller,units:'inches',feedback:'IMU heading only; no X/Y feedback',start:l.start,field:l.field,...Timed.compile(route,timing)},null,2)}};
  if(format==='motionmodule')return {files:{'autonomous.py':M.autonomous(route,timing,{name:l.name,mechanisms:info.mechanisms,target:info.target}),'robot_actions.py':M.actionsFile(route,{name:l.name,mechanisms:info.mechanisms})}};
  throw Error('Formats: onbot, teamcode, pedro, java, pp, timed, motionmodule.');
}

// ------------------------------------------------------------------ the app
function launcher(dev){
  if(process.env.DECK_ELECTRON)return {exe:process.env.DECK_ELECTRON,app:process.env.DECK_APP_DIR||root};
  const local=process.env.LOCALAPPDATA,installed=local&&{exe:path.join(local,'DeckDriverStation','runtime','electron.exe'),app:path.join(local,'DeckDriverStation','app')};
  if(!dev&&process.platform==='win32'&&installed&&fs.existsSync(installed.exe)&&fs.existsSync(installed.app))return installed;
  const version=require('../package.json').devDependencies?.electron,cached=path.join(root,'.cache',`runtime-${process.platform}-${process.arch}-${version}`,process.platform==='win32'?'electron.exe':'electron');
  if(fs.existsSync(cached))return {exe:cached,app:root};
  try{return {exe:require('electron'),app:root};}catch{}
  throw Error('Torque was not found. Install it, or run from a checkout with its Electron runtime in .cache.');
}
function show(file,setup,flags){
  const {exe,app}=launcher(flags.dev===true),cad=setup.deckCli?.model,tab=['setup','plan','run'].includes(flags.tab)?flags.tab:'run';
  const args=[app,`--deck-sim-open=${path.resolve(file)}`,`--deck-sim-tab=${tab}`];
  if(flags.run)args.push('--deck-sim-run');
  if(cad?.file&&fs.existsSync(cad.file))args.push(`--deck-sim-model=${cad.file}`,`--deck-sim-front=${cad.front||'+x'}`,`--deck-sim-top=${cad.top||'+z'}`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  spawn(exe,args,{detached:true,stdio:'ignore',env,windowsHide:false}).unref();
  return `Opening ${path.basename(file)} in Torque (${tab==='run'?'Run & review':tab==='plan'?'Path planning':'Setup'}${flags.run?', starting the run':''}). Simulation closes any live robot connection.`;
}


// ------------------------------------------------------------------ setups
function newSetup(flags){
  const field=flags.field||'empty';if(!GAMES[field])throw Error(`Fields: ${Object.keys(GAMES).join(', ')}.`);
  const drivetrain=flags.drivetrain||'mecanum';if(!C.drives[drivetrain])throw Error(`Drivetrains: ${Object.keys(C.drives).join(', ')}.`);
  const controller=flags.controller==='motionmodule'?'motionmodule':'ftc',localization=C.localization(controller,flags.sensors||'fused'),id='cli'+Date.now().toString(36);
  return {deckSimulation:2,version:2,imuSource:'hub',timing:{power:1},orientations:{},hitboxes:false,
    robot:{drivetrain,length:flags.length?num(flags.length,'--length'):17,width:flags.width?num(flags.width,'--width'):17,heightIn:flags.height?num(flags.height,'--height'):12,driveRpm:flags.rpm?num(flags.rpm,'--rpm'):312,intakeIn:0,driveStyle:'robot',appearance:drivetrain==='mecanum'?'strafer':'simple'},
    tuning:{maxPathSpeed:flags.power!==undefined?num(flags.power,'--power'):.8},practice:{mode:'autonomous',autoSeconds:30,transitionSeconds:8,teleopSeconds:120},program:{kind:'route',name:'',source:''},model:null,view:'2d',
    export:{packageName:'org.firstinspires.ftc.teamcode',className:flags.class||'PlannedRoute',keep:false},controller,sensors:{localization},
    layouts:[{id,name:flags.name||GAMES[field],field,alliance:flags.alliance==='blue'?'blue':'red',width:144,height:144,elements:true,start:null,zones:[],pins:[],clearance:2,style:'spline',rotate:true}],active:id};
}

const HELP=`deck-sim — Deck simulation from a terminal (offline; never talks to a robot)

Fields and setups
  fields                                   List built-in fields
  field <empty|decode|biobuzz> [--json]    Obstacles, scoring areas, hive cells, start rules
  new <setup.json> --field biobuzz [--alliance red|blue] [--name N] [--drivetrain mecanum] [--length 17 --width 17 --height 12]
                   [--rpm 312] [--sensors fused|odometry|odometry3|encoders|optical|gyro] [--power 1] [--class Name]
  robot <setup.json> [--cad robot.step [--units mm] [--up z|y] [--front +x] [--top +z]]
                     [--length L --width W --height H --drivetrain D --rpm R]
                     [--hub-logo up --hub-usb forward]   how the Control Hub is mounted (for its IMU)
                     [--names frontLeft=leftFront,imu=imu]   the robot's names for drive motors and sensors (keys: ${C.DEVICE_KEYS.join(', ')})
                     [--reversed frontLeft=off,frontRight=on]   drive motors that turn the other way (Deck reverses the left side)
                     [--odometry pinpoint.xOffset=-2.5,pinpoint.yReversed=on]   where the pods, Pinpoint or OTOS sit
                                 (inches from the centre: x forward, y left) and which way they count. Keys:
                                 pinpoint.{pods,xOffset,yOffset,xReversed,yReversed}, otos.{x,y,heading,linearScalar,
                                 angularScalar}, pods.{par,perp,par_left,par_right}.{x,y,reversed}; on/off for reversed
  start <setup.json> <x> <y> <heading>     Starting pose (checked against walls and field parts)
  alliance <setup.json> red|blue [--keep]  BIOBUZZ alliance: which hive shots aim at and score for; moves the
                                           route to that side (turned 180° about the centre) unless --keep

Mechanisms (BIOBUZZ parts: intakes, shooters, storage, preloads)
  mech <setup.json> [--on|--off]
       [--intakes front+back:sweeper,left:ramp | none]   every intake: its sides (front, back, left, right) and type
       [--intake sweeper|siderollers|ramp|none] [--intake-side front|back|frontback|side|all] [--intake-motor intake]
       [--shooters turret@center:pollen,fixed@back>back:nectar | none]   up to two: type@mount>facing:pieces
       [--shared-turret on|off]   two turret shooters on one turntable (the second rides the first's turret) or each on its own
       [--shooter turret|fixed|none] [--mount center|front|back|left|right|frontleft|...] [--facing front|back|left|right]
       [--pieces pollen|nectar|both] [--shooter-motor shooter] [--indexer motor|crservo] [--indexer-name indexer] [--turret-motor turret]
       [--pollen 4] [--nectar 0] [--preload 4]   how many of each piece it holds (4 together at most), pollen it starts with
       [--index-seconds 0.35] [--rpm 3000] [--ticks-per-rev 28] [--spin-up 0.8] [--shot-gap 0.3] [--hood 75]
       [--turret-speed 240] [--turret-min -170] [--turret-max 170] [--turret-ticks-per-degree 4.6] [--target x,y|auto]
     Robot hardware (first intake and shooter):
       [--intake-device motor|crservo] [--intake-reversed on|off] [--intake-second NAME|none] [--intake-second-reversed on|off]
       [--flywheel-reversed on|off] [--flywheel-second NAME|none] [--flywheel-second-reversed on|off]
       [--indexer motor|crservo|pusher|gate] [--indexer-reversed on|off] [--feed-pos 1] [--rest-pos 0] [--push-seconds 0.15]
       [--flywheel-control velocity|power] [--flywheel-power 1] [--at-speed 5 (percent)] [--pidf p,i,d,f|default]
       [--turret-kind motor|servo] [--turret-servo-center 0.5] [--turret-servo-degrees 300] [--turret-reversed on|off]
  Two shooters: the first takes pollen and the second nectar; they spin, aim and feed together.
  A ramp intake is rollers with a ramp a servo folds down: the rollers pick up off the floor either way; Ramp down
  and Ramp up move the ramp, which stays where it was sent, and only a ramp that is down reaches flower pollen.
  Route actions the mechanisms run: Intake, Ramp down, Ramp up, Turret to DEG, Spin up, Aim, Shoot (once per storage slot) or Shoot N.
  At a pin the robot pauses (--wait), runs the --action (for --for seconds, or until done), then drives on.
  A path's --path-action runs from the start of the path, for --path-for seconds or the whole path.
  Several steps: --action "Shoot; Ramp down; Intake for 1.5" runs them one after another at the pin;
  --path-action "Intake; Ramp down" runs them together while driving.
  info <setup.json>                        Setup, start and pins

Route
  pins <setup.json> <pins.json|->          Replace every pin from a JSON array (- reads stdin)
  pin <setup.json> add <x> <y> [options]   Append a pin. Options:
      --wait S            pause at the pin first      --action NAME   then run an action (Intake, Shoot, Spin up...)
      --for S             run the pin's action for S seconds (default: Shoot until empty; Intake needs a time)
      --turn DEG          turn in place at the pin    --face X,Y      turn to face a point at the pin
      --power 0-1         motor power for the path    --style spline|sharp
      --path-action NAME  run an action while driving (e.g. Shoot, Intake)
      --path-for S        only for the first S seconds of the path (default: the whole path)
      --cell other        aim the pin's Shoot/Aim at the hive's other cell (up after the first tip); --path-cell other for a path
      --track X,Y         keep aiming at a point while driving   --heading DEG   turn to a heading while driving
      --tangent           face along the path while driving      --reverse       face backwards along it
      --curve X1,Y1,X2,Y2 a custom Bezier curve with these control points (1-3 points), driven exactly
  pin <setup.json> clear                   Remove every pin
  plan <setup.json> [--json]               Plan the route; report length, pauses and any blocked pin
  test <setup.json> [--json] [--code onbot|teamcode|pedro|motionmodule] [--log run.wpilog] [--frames run.json]
                                           Test-drive the route in the simulator physics (or run its exported code);
                                           --log saves the run as a WPILOG file; --frames saves every recorded
                                           frame (as the app's Record keeps them, for the Video workspace)
  optimize <setup.json>                    Test-drive spline/straight shapes per path; keep the fastest safe one
  import-pp <setup.json> <file.pp>        Replace the start and paths with a Pedro Pathing visualizer (or Deck) .pp file
  compare <setup.json> <log.wpilog|log.csv> [--origin center] [--json]
                                           Compare a real robot's log with the planned route: average and worst
                                           distance from the plan, and from the last end point. CSV coordinates
                                           are from the bottom-left corner unless --origin center (FTC frame)

Code and app
  export <setup.json> --format onbot|teamcode|pedro|java|pp|timed|motionmodule --out <file-or-folder>
  show <setup.json> [--tab run|plan|setup] [--run] [--dev]
                                           Open it in the app (launches the app or reuses the open one)
  Any command that changes a setup also accepts --show to open the result in the app right away.`;

async function main(argv){
  const {_:[command,file,...rest],flags}=parse(argv),json=flags.json===true,say=v=>console.log(typeof v==='string'?v:JSON.stringify(v,null,2));
  const changed=(setup,message)=>{writeSetup(file,setup);say(message);if(flags.show)say(show(file,setup,flags));};
  switch(command){
    case undefined:case'help':case'--help':return say(HELP);
    case'fields':return say(Object.entries(GAMES).map(([k,v])=>`${k.padEnd(8)} ${v}`).join('\n'));
    case'field':{const name=file||'biobuzz';if(!GAMES[name])throw Error(`Fields: ${Object.keys(GAMES).join(', ')}.`);
      const {e,info}=await load(newSetup({field:name}),{...newSetup({field:name}).layouts[0],start:{x:24,y:24,heading:0}});try{const f=fieldFacts(info);if(!json){delete f.obstacles;f.obstacles=`${info.fieldZones.length} planning obstacles (${info.obstacleName||'none'}); use --json for their shapes`;}say(f);}finally{e.dispose();}return;}
    case'new':{if(!file)throw Error('Name the new setup file.');if(fs.existsSync(file)&&!flags.force)throw Error(`${file} exists. Pass --force to replace it.`);const setup=newSetup(flags);setup.setupName=path.basename(file,'.json');
      let cadFound=[];if(flags.cad){const box=await cadBox(path.resolve(flags.cad),flags);Object.assign(setup.robot,pickSize(box,flags));setup.deckCli={model:cadRef(flags)};cadFound=setUpFromCad(setup,box,setup.deckCli.model);}
      return changed(setup,(cadFound.length?`From the CAD assembly names: ${cadFound.join('; ')}.
`:'')+`Created ${file}: ${GAMES[setup.layouts[0].field]}, ${setup.robot.drivetrain} ${setup.robot.length} x ${setup.robot.width} x ${setup.robot.heightIn} in. Next: deck-sim start ${file} <x> <y> <heading>.`);}
    case'alliance':{const setup=readSetup(file),l=layoutOf(setup),side=rest[0];if(!['red','blue'].includes(side))throw Error('Alliance is red or blue.');if((l.alliance||'red')===side)return say(`Alliance is already ${side}.`);
      // BIOBUZZ is point-symmetric: the other alliance runs the same route turned 180° about the field centre.
      const move=l.field==='biobuzz'&&!flags.keep&&(l.start||l.pins?.length||l.zones?.length);if(move)Object.assign(l,P.allianceRoute(l,{mode:'rotate',width:l.width,height:l.height}));
      l.alliance=side;return changed(setup,`Alliance: ${side}. Shots aim at ${side}'s hive by default.${move?` Moved the starting pose, paths and obstacles to the ${side} side (turned 180° about the field centre; --keep leaves them).`:''}`);}
    case'mech':{const setup=readSetup(file),m=Mech.sanitize(setup.mechanisms),f=flags,set=(obj,key,flag,conv=v=>v)=>{if(obj&&f[flag]!==undefined&&f[flag]!==true)obj[key]=conv(f[flag]);};
      const oneOf=(flag,value,options)=>{if(!Object.hasOwn(options,value))throw Error(`--${flag} is one of: ${Object.keys(options).join(', ')}.`);return value;};
      // --intakes "front+back:sweeper,left:ramp": every intake, as sides:kind.
      if(typeof f.intakes==='string')m.intakes=f.intakes==='none'?[]:f.intakes.split(',').map(entry=>{const [sides,kind='sweeper']=entry.trim().split(':');
        const list=sides.split('+').map(v=>v.trim());for(const side of list)if(!Mech.EDGES.includes(side))throw Error(`--intakes sides are ${Mech.EDGES.join(', ')} (joined with +).`);return {sides:list,kind:oneOf('intakes',kind,Mech.INTAKES)};});
      // --intake KIND|none and --intake-side: the first intake (older single-intake flags).
      if(f.intake==='none')m.intakes=[];else if(typeof f.intake==='string'||typeof f['intake-side']==='string'){if(!m.intakes.length)m.intakes.push({sides:['front']});
        if(typeof f.intake==='string')m.intakes[0].kind=oneOf('intake',f.intake,Mech.INTAKES);if(typeof f['intake-side']==='string')m.intakes[0].sides=Mech.SIDE_EDGES[oneOf('intake-side',f['intake-side'],Mech.SIDES)];}
      set(m.intakes[0],'motor','intake-motor');set(m.intakes[0],'power','intake-power',v=>num(v,'--intake-power'));
      // --shooters "turret@center:pollen,fixed@back>back:nectar": every shooter, as type@mount[>facing][:pieces].
      if(typeof f.shooters==='string')m.shooters=f.shooters==='none'?[]:f.shooters.split(',').map(entry=>{const x=/^\s*(turret|fixed)(?:@(\w+))?(?:>(\w+))?(?::(\w+))?\s*$/.exec(entry);
        if(!x)throw Error('--shooters entries are type@mount>facing:pieces, e.g. turret@center:pollen or fixed@back>back:nectar.');
        return {type:x[1],mount:x[2]?oneOf('shooters mount',x[2],Mech.MOUNTS):'center',facing:x[3]?oneOf('shooters facing',x[3],Mech.FACING):'front',pieces:x[4]?oneOf('shooters pieces',x[4],Mech.PIECES):'pollen'};});
      // --shared-turret on|off: the second shooter rides the first one's turret, or has its own.
      if(f['shared-turret']!==undefined&&m.shooters[1]){const on=f['shared-turret']===true||f['shared-turret']==='on';if(!on&&f['shared-turret']!=='off')throw Error('--shared-turret is on or off.');
        if(on&&!(m.shooters[0].type==='turret'&&m.shooters[1].type==='turret'))throw Error('--shared-turret needs two turret shooters.');m.shooters[1].sharesTurret=on;if(!on&&m.shooters[1].mount===m.shooters[0].mount)m.shooters[1].mount=Mech.PARTNER[m.shooters[0].mount==='center'?'front':m.shooters[0].mount];}
      // --shooter TYPE|none, --mount, --facing, --pieces: the first shooter.
      if(f.shooter==='none')m.shooters=[];else if(typeof f.shooter==='string'){oneOf('shooter',f.shooter,Mech.SHOOTERS);if(!m.shooters.length)m.shooters.push({});m.shooters[0].type=f.shooter;}
      if(typeof f.mount==='string')m.shooters[0]&&(m.shooters[0].mount=oneOf('mount',f.mount,Mech.MOUNTS));if(typeof f.facing==='string')m.shooters[0]&&(m.shooters[0].facing=oneOf('facing',f.facing,Mech.FACING));if(typeof f.pieces==='string')m.shooters[0]&&(m.shooters[0].pieces=oneOf('pieces',f.pieces,Mech.PIECES));
      set(m.shooters[0],'motor','shooter-motor');set(m.shooters[0],'indexer','indexer-name');set(m.shooters[0],'turretMotor','turret-motor');if(typeof f.indexer==='string'&&m.shooters[0])m.shooters[0].indexerKind=oneOf('indexer',f.indexer,Mech.INDEXERS);
      // Robot hardware for the first intake and shooter: what each runs on, second motors, which way each turns,
      // servo feeder positions, how the flywheels hold their speed and what the turret turns on.
      const onOff=flag=>{const v=f[flag];if(v===true||v==='on')return true;if(v==='off')return false;throw Error(`--${flag} is on or off.`);},second=v=>v==='none'?'':String(v);
      if(typeof f['intake-device']==='string'&&m.intakes[0])m.intakes[0].device=oneOf('intake-device',f['intake-device'],Mech.ROLLERS);
      if(f['intake-second']!==undefined&&m.intakes[0])m.intakes[0].motor2=second(f['intake-second']);
      for(const [flag,key] of [['intake-reversed','reversed'],['intake-second-reversed','reversed2']])if(f[flag]!==undefined&&m.intakes[0])m.intakes[0][key]=onOff(flag);
      if(f['flywheel-second']!==undefined&&m.shooters[0])m.shooters[0].motor2=second(f['flywheel-second']);
      for(const [flag,key] of [['flywheel-reversed','reversed'],['flywheel-second-reversed','reversed2'],['indexer-reversed','indexerReversed'],['turret-reversed','turretReversed']])if(f[flag]!==undefined&&m.shooters[0])m.shooters[0][key]=onOff(flag);
      set(m.shooters[0],'feedPos','feed-pos',v=>num(v,'--feed-pos'));set(m.shooters[0],'restPos','rest-pos',v=>num(v,'--rest-pos'));set(m.indexer,'pushSeconds','push-seconds',v=>num(v,'--push-seconds'));
      if(typeof f['flywheel-control']==='string')m.shooter.control=oneOf('flywheel-control',f['flywheel-control'],Mech.FLYWHEELS);
      set(m.shooter,'power','flywheel-power',v=>num(v,'--flywheel-power'));set(m.shooter,'tolerance','at-speed',v=>num(v,'--at-speed')/100);
      if(f.pidf==='default')delete m.shooter.pidf;else if(typeof f.pidf==='string'){const [p,i,d,ff]=f.pidf.split(',').map(v=>num(v,'--pidf'));if(![p,i,d,ff].every(finite))throw Error('--pidf is four numbers p,i,d,f (or default).');m.shooter.pidf={p,i,d,f:ff};}
      if(typeof f['turret-kind']==='string')m.turret.kind=oneOf('turret-kind',f['turret-kind'],Mech.TURRETS);
      set(m.turret,'servoCenter','turret-servo-center',v=>num(v,'--turret-servo-center'));set(m.turret,'servoDegrees','turret-servo-degrees',v=>num(v,'--turret-servo-degrees'));
      // Storage: --pollen and --nectar capacity (--storage is the pollen capacity), --preload pollen.
      set(m.capacity,'pollen','pollen',v=>num(v,'--pollen'));set(m.capacity,'pollen','storage',v=>num(v,'--storage'));set(m.capacity,'nectar','nectar',v=>num(v,'--nectar'));set(m.preload,'pollen','preload',v=>num(v,'--preload'));
      set(m.indexer,'seconds','index-seconds',v=>num(v,'--index-seconds'));set(m.indexer,'power','indexer-power',v=>num(v,'--indexer-power'));
      set(m.shooter,'hood','hood',v=>num(v,'--hood'));set(m.shooter,'rpm','rpm',v=>num(v,'--rpm'));set(m.shooter,'ticksPerRev','ticks-per-rev',v=>num(v,'--ticks-per-rev'));set(m.shooter,'spinUp','spin-up',v=>num(v,'--spin-up'));set(m.shooter,'shotGap','shot-gap',v=>num(v,'--shot-gap'));
      set(m.turret,'speed','turret-speed',v=>num(v,'--turret-speed'));set(m.turret,'min','turret-min',v=>num(v,'--turret-min'));set(m.turret,'max','turret-max',v=>num(v,'--turret-max'));set(m.turret,'ticksPerDegree','turret-ticks-per-degree',v=>num(v,'--turret-ticks-per-degree'));
      if(f.target==='auto')m.target=null;else if(f.target)m.target=point(f.target,'--target');
      // Changing any setting turns mechanisms on unless --off says otherwise.
      if(f.off)m.enabled=false;else if(f.on||Object.keys(f).some(k=>!['show','json','dev','tab','run'].includes(k)))m.enabled=true;
      setup.mechanisms=Mech.sanitize({...m,intake:undefined,shooter:{...m.shooter,type:undefined}});
      return changed(setup,json?JSON.stringify(setup.mechanisms,null,2):describeMechanisms(setup.mechanisms,layoutOf(setup)));}
    case'robot':{const setup=readSetup(file);if(flags.drivetrain){if(!C.drives[flags.drivetrain])throw Error(`Drivetrains: ${Object.keys(C.drives).join(', ')}.`);setup.robot.drivetrain=flags.drivetrain;}
      if(flags.rpm)setup.robot.driveRpm=num(flags.rpm,'--rpm');
      // Control Hub mounting for its IMU: --hub-logo and --hub-usb, each up, down, forward, backward, left or right.
      for(const [flag,key] of [['hub-logo','hubLogo'],['hub-usb','hubUsb']])if(flags[flag]!==undefined){const v=String(flags[flag]).toLowerCase();if(!C.HUB.includes(v))throw Error(`--${flag} is one of: ${C.HUB.join(', ')}.`);setup.robot[key]=v;}
      if((flags['hub-logo']!==undefined||flags['hub-usb']!==undefined)&&C.hubMounting(setup.robot).hubUsb!==(setup.robot.hubUsb||'forward'))throw Error('The Control Hub logo and USB ports cannot face along the same axis (for example up and down).');
      // The robot's own device names (--names frontLeft=leftFront,imu=imu) and drive motors that turn the other way (--reversed frontRight=on).
      const pairs=(flag,check)=>String(flags[flag]).split(',').filter(Boolean).map(entry=>{const [key,value]=entry.split('=').map(v=>v?.trim());if(!C.DEVICE_KEYS.includes(key))throw Error(`--${flag} keys are ${C.DEVICE_KEYS.join(', ')}.`);check(key,value);return [key,value];});
      if(flags.names!==undefined||flags.reversed!==undefined){const devices={...(setup.robot.devices||{})},entry=key=>devices[key]={...(devices[key]||{})};
        if(flags.names!==undefined)for(const [key,value] of pairs('names',(k,v)=>{if(!C.deviceName(v||''))throw Error(`--names ${k}= needs a name of letters, digits, spaces, _ . or -.`);}))entry(key).name=value;
        if(flags.reversed!==undefined)for(const [key,value] of pairs('reversed',(k,v)=>{if(!C.DEVICE_KEYS.slice(0,6).includes(k)||!['on','off'].includes(v))throw Error('--reversed takes drive motors (frontLeft, frontRight, backLeft, backRight, left, right) with on or off.');}))entry(key).reversed=value==='on';
        setup.robot.devices=devices;}
      // Where the odometry sits and which way it counts: --odometry pinpoint.xOffset=-2.5,pinpoint.pods=swingarm,pods.perp.reversed=on.
      if(flags.odometry!==undefined){const odo=C.odometryOf(setup.robot),keys=odometryKeys();
        for(const entry of String(flags.odometry).split(',').filter(Boolean)){const [key,value='']=entry.split('=').map(v=>v.trim());if(!keys.includes(key))throw Error(`--odometry keys are ${keys.join(', ')}.`);
          const at=key.split('.'),last=at.pop(),obj=at.reduce((o,k)=>o[k],odo);
          if(typeof obj[last]==='boolean'){if(!['on','off'].includes(value))throw Error(`--odometry ${key}= takes on or off.`);obj[last]=value==='on';}
          else if(last==='pods'){if(!Object.hasOwn(C.POD_TYPES,value))throw Error(`--odometry ${key}= is one of: ${Object.keys(C.POD_TYPES).join(', ')}.`);obj[last]=value;}
          else{const v=num(value||undefined,'--odometry '+key),[min,max]=/Scalar$/.test(last)?C.OTOS_SCALARS:last==='heading'?[-Infinity,Infinity]:[-36,36];if(v<min||v>max)throw Error(`--odometry ${key}= is from ${min} to ${max}.`);obj[last]=v;}}
        setup.robot.odometry=C.odometry(odo);if(!Object.keys(setup.robot.odometry).length)delete setup.robot.odometry;}
      let cadFound=[];if(flags.cad){const box=await cadBox(path.resolve(flags.cad),flags);Object.assign(setup.robot,pickSize(box,flags));setup.deckCli={...setup.deckCli,model:cadRef(flags)};cadFound=setUpFromCad(setup,box,setup.deckCli.model);}
      else Object.assign(setup.robot,pickSize({},flags));
      const own=C.devices(setup.robot.devices),named=Object.entries(own).map(([k,v])=>`${k}${v.name?` "${v.name}"`:''}${v.reversed!==undefined?` ${v.reversed?'reversed':'forward'}`:''}`);
      const odo=C.odometry(setup.robot.odometry),odoSet=Object.entries(odo).flatMap(([group,v])=>group==='pods'?Object.entries(v).flatMap(([pod,p])=>Object.entries(p).map(([k,x])=>`pods.${pod}.${k}=${x===true?'on':x}`)):Object.entries(v).map(([k,x])=>`${group}.${k}=${x===true?'on':x}`));
      return changed(setup,`Robot: ${setup.robot.drivetrain} ${setup.robot.length} x ${setup.robot.width} x ${setup.robot.heightIn} in${setup.deckCli?.model?` from ${path.basename(setup.deckCli.model.file)}`:''}.${named.length?` Names on the robot: ${named.join(', ')}.`:''}${odoSet.length?` Odometry: ${odoSet.join(', ')}.`:''}${cadFound.length?`
From the CAD assembly names: ${cadFound.join('; ')}.`:''}`);}
    case'start':{const setup=readSetup(file),l=layoutOf(setup),[x,y,heading]=rest.map((v,i)=>num(v,['x','y','heading'][i]));const {e,info}=await load(setup,{...l,start:{x,y,heading}});
      try{if(!P.safePose({x,y,heading},info.fieldZones,info.footprint,info.bounds))throw Error(`The robot overlaps a wall or field part at (${x}, ${y}). Field bounds ${JSON.stringify(info.bounds)}; robot reaches ${info.footprint.front} in forward, ${info.footprint.rear} back, ${info.footprint.half} to each side.`);}finally{e.dispose();}
      l.start={x,y,heading};return changed(setup,`Start: (${x}, ${y}) facing ${heading}°.`);}
    case'info':{const setup=readSetup(file),l=layoutOf(setup),m=Mech.sanitize(setup.mechanisms);return say(json?{robot:setup.robot,sensors:setup.sensors,power:power(setup),mechanisms:m,layout:l}:`${describe(setup,l)}\nRobot: ${setup.robot.drivetrain} ${setup.robot.length} x ${setup.robot.width} in · default path power ${power(setup)}${setup.controller!=='motionmodule'&&(setup.imuSource||'hub')==='hub'?(h=>` · Control Hub logo ${h.hubLogo}, USB ${h.hubUsb}`)(C.hubMounting(setup.robot)):''}\n${describeMechanisms(m,l)}`);}
    case'pins':{const setup=readSetup(file),source=rest[0];if(!source)throw Error('Give a pins JSON file, or - to read stdin.');const raw=JSON.parse(source==='-'?fs.readFileSync(0,'utf8'):fs.readFileSync(source,'utf8'));
      if(!Array.isArray(raw))throw Error('Pins JSON must be an array of {x, y, wait, action, path:{...}} objects.');layoutOf(setup).pins=raw.map(clean);layoutOf(setup).route=null;layoutOf(setup).tested=null;return changed(setup,`${raw.length} pins set.`);}
    case'pin':{const setup=readSetup(file),l=layoutOf(setup),[action,x,y]=rest;l.route=null;l.tested=null;
      if(action==='clear'){l.pins=[];return changed(setup,'Cleared every pin.');}
      if(action!=='add')throw Error('Use: pin <setup> add <x> <y> [options], or pin <setup> clear.');
      l.pins.push(pinFrom(flags,x,y));return changed(setup,`Pin ${l.pins.length} at (${x}, ${y}).`);}
    case'plan':{const setup=readSetup(file),{e,info,l}=await load(setup);
      try{let route;try{route=planRoute(setup,l,info);}catch(err){const issues=err.issues?.length?err.issues:P.analyze(request(setup,l,info),info.footprint,info.fieldZones,info.bounds);throw Error(`${err.message}${issues.length?'\n'+issues.map(i=>`  - ${i.pin!=null?`pin ${i.pin+1}: `:''}${i.message}`).join('\n'):''}`);}
        return say(json?{length:route.length,stops:route.stops,segments:route.segments.length}:describe(setup,l,route));}finally{e.dispose();}}
    case'test':{const setup=readSetup(file),{e,info,l}=await load(setup);
      try{const route=planRoute(setup,l,info),code=flags.code===true?'onbot':flags.code,frames=[],logFile=flags.log===true?path.basename(file,'.json')+'.wpilog':flags.log,framesFile=flags.frames===true?path.basename(file,'.json')+'.frames.json':flags.frames;let r;
        // --log records the run (about 30 frames a second) as a WPILOG.
        if(logFile||framesFile){const tick=e.tick.bind(e);e.tick=c=>{const out=tick(c);if(e.world.tick%2===0)frames.push(e.frame());return out;};}
        // --code runs the exported Control Hub Java on the virtual Control Hub, or the exported autonomous.py
        // on MotionModule's own runtime, instead of the planner's follower.
        if(code==='motionmodule'){
          if(setup.controller!=='motionmodule')throw Error('This setup is for a Control Hub. Use --code onbot or teamcode, or choose MotionModule in setup.');
          const motionModule=path.resolve(flags['motionmodule-source']||process.env.DECK_MOTIONMODULE_SOURCE||path.join(root,'../MotionModule')),python=flags.python||process.env.DECK_PYTHON||(process.platform==='win32'?'python':'python3');
          if(!fs.existsSync(path.join(motionModule,'core/motion_module')))throw Error(`MotionModule's source was not found at ${motionModule}. Pass --motionmodule-source <folder>.`);
          const timing={...info.timing,power:power(setup)},started=await e.run({kind:'motionmodule',source:M.autonomous(route,timing,{name:l.name,mechanisms:info.mechanisms,target:info.target}),actions:M.actionsFile(route,{name:l.name,mechanisms:info.mechanisms}),python,motionModule,deps:flags.deps||process.env.DECK_MOTIONMODULE_DEPS||path.join(root,'.cache/motionmodule-test-deps')});
          if(!started.ok)throw Error(started.error||e.lastError||'The exported autonomous.py could not start.');
          for(let guard=0;guard<4200&&e.mode==='program';guard++)await e.programTick();if(!e.result)throw Error(e.lastError||'The exported autonomous.py did not finish within 70 s.');r=e.result;}
        else if(code){if(!['onbot','teamcode','pedro'].includes(code))throw Error('--code is onbot, teamcode, pedro or motionmodule.');
          // --code pedro: the Pedro Pathing export with Pedro's real Follower (jars from tools/simulation/fetch-pedro.cjs),
          // built by DeckStarterConstants from this simulated robot.
          const jars=code==='pedro'?require('./simulation/fetch-pedro.cjs').cached():null;if(code==='pedro'&&!jars)throw Error('Run node tools/simulation/fetch-pedro.cjs first: it downloads Pedro Pathing 3.0.2 for local tests.');
          const out=code==='pedro'?pedroForSim(setup,l,route,info):teamCode(setup,l,route,info,code==='onbot'),started=await e.run({kind:'opmode',files:out.files,opMode:out.opMode,...(jars?{classpath:jars}:{})});if(!started.ok)throw Error(started.error||e.lastError||'The exported code could not start.');
          for(let guard=0;guard<3600&&e.mode==='program'&&e.telemetry?.Phase!=='Done';guard++)await e.programTick();if(e.telemetry?.Phase!=='Done')throw Error(e.lastError||'The exported code did not finish within 60 s.');
          r={time:e.world.time,violations:[...e.violations],truth:e.truth(),mechanisms:e.mechanismState()};}
        else r=await drive(e,route);
        // Let the last launched pieces land before counting what scored.
        // Score at the end of the 30 s autonomous period: a hive still swinging tips (and scores) after the route ends.
        const ended=e.mechanismState();for(let i=0;i<150||e.world.time<30;i++)e.tick({forward:0,strafe:0,turn:0});const after=e.mechanismState();if(r.mechanisms&&after)r.mechanisms={...after,shots:ended.shots};
        const last=l.pins.at(-1),miss=Math.hypot(r.truth.x-last.x,r.truth.y-last.y),auto=setup.practice?.autoSeconds??30;
        let logged='';if(logFile){const out=path.resolve(logFile);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,Wpilog.fromFrames(frames,{alliance:l.alliance,mechanisms:info.mechanisms,robot:info.robot,name:l.name}));logged=` Log: ${out}.`;}
        if(framesFile){const out=path.resolve(framesFile);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({field:l.field,alliance:l.alliance,name:l.name,frames}));logged+=` Frames: ${out} (${frames.length}).`;}
        const ran=code==='motionmodule'?"the exported autonomous.py on MotionModule's runtime":code?`the exported ${code} Java on the virtual Control Hub`:'',report={ran:ran||'route follower',time:round(r.time),fitsAuto:r.time<=auto,zoneTouches:r.violations.length,finalMissIn:round(miss),end:{x:round(r.truth.x),y:round(r.truth.y),heading:round(r.truth.heading,1)},...(r.mechanisms?{mechanisms:{pickedUp:r.mechanisms.pickedUp,shots:r.mechanisms.shots,landed:r.mechanisms.landed,accuracy:r.mechanisms.shots?Math.round(100*r.mechanisms.landed/r.mechanisms.shots):null,held:r.mechanisms.held,score:r.mechanisms.score,tips:r.mechanisms.tips}}:{})};
        return say(json?report:`${ran?`Ran ${ran}`:'Drove the route'}: ${l.pins.length} pins in ${report.time} s (${report.fitsAuto?'fits':'does NOT fit'} the ${auto} s autonomous period). Zone touches: ${report.zoneTouches}. Ended ${report.finalMissIn} in from the last pin.${report.mechanisms?`
Analysis: picked up ${report.mechanisms.pickedUp}, shot ${report.mechanisms.shots}, landed in the hive ${report.mechanisms.landed}${report.mechanisms.accuracy!==null?` (${report.mechanisms.accuracy}% accurate)`:''}, still holding ${report.mechanisms.held}, ${report.mechanisms.tips??0} hive tip${report.mechanisms.tips===1?'':'s'}, ${report.mechanisms.score??0} points.`:""}${logged}`);}finally{e.dispose();}}
    case'optimize':{const setup=readSetup(file),{e,info,l}=await load(setup);
      try{const base=request(setup,l,info),rows=[],seen=new Set();let chosen=null,reason='';
        const compare=async candidates=>{const planned=[];for(const c of candidates){const key=c.styles.join(',');if(seen.has(key))continue;seen.add(key);try{planned.push({...c,route:planRoute(setup,l,info,c.project)});}catch(err){reason||=err.message;}}
          for(let i=0;i<planned.length;i+=6){const batch=planned.slice(i,i+6),results=await e.evaluate(batch.map(c=>c.route));batch.forEach((c,j)=>{const r=results[j],last=l.pins.at(-1),ok=!!(r?.ok&&r.violations===0&&Math.hypot(r.truth.x-last.x,r.truth.y-last.y)<1.5);rows.push({label:c.label,time:r?.time,ok,note:r?.error||(ok?'':'touched a zone or missed the final pin')});if(ok&&(!chosen||r.time<chosen.time))chosen={...c,time:r.time,row:rows.at(-1)};});console.error(`Test-drove ${Math.min(i+6,planned.length)} of ${planned.length} shapes…`);}};
        await compare(holonomic(setup)?P.shapeCandidates(base):[{project:base,styles:l.pins.map(()=>'sharp'),label:'Tank route'}]);if(chosen&&l.pins.length>4)await compare(P.shapeCandidates(base,chosen.styles));
        if(!chosen)throw Error(reason||'No tested shape finished clear of obstacles and on target. Increase clearance or move the pins.');
        l.pins=chosen.project.pins.map(clean);l.tested=rows.map(r=>({...r,best:r===chosen.row}));
        return changed(setup,`Fastest safe shape: ${chosen.label.toLowerCase()} in ${round(chosen.time)} s (${rows.length} tested). Saved to ${file}.`);}finally{e.dispose();}}
    case'export':{const setup=readSetup(file),format=flags.format||'onbot',out=flags.out;if(!out||out===true)throw Error('Give --out <file or folder>.');const {e,info,l}=await load(setup);
      try{const route=planRoute(setup,l,info),{files,note}=exported(setup,l,route,info,format),names=Object.keys(files);
        // A path ending in a slash, without an extension, or already a folder receives the files by name. A file path receives
        // the first file, and any others go beside it by name (OnBot Java's check TeleOp, MotionModule's robot_actions.py).
        const folder=format==='teamcode'||format==='pedro'||/[\\/]$/.test(out)||!path.extname(out)||fs.existsSync(out)&&fs.statSync(out).isDirectory();
        for(const [i,[rel,text]] of Object.entries(files).entries()){const target=folder?path.resolve(out,rel):i===0?path.resolve(out):path.resolve(path.dirname(out),path.basename(rel));if(folder&&!target.startsWith(path.resolve(out)+path.sep))throw Error('Invalid export path.');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);}
        say(`Wrote ${names.length} file${names.length>1?'s':''} to ${path.resolve(out)}${note?`. ${note}`:''}`);if(flags.show)say(show(file,setup,flags));return;}finally{e.dispose();}}
    case'import-pp':{const pp=rest[0];if(!pp)throw Error('Use: import-pp <setup.json> <file.pp>.');
      const setup=readSetup(file),l=layoutOf(setup),{e,info}=await load(setup);let r;try{r=X.fromPP(fs.readFileSync(pp,'utf8'),{field:l.field,bounds:info.bounds,robot:{length:info.footprint.front+info.footprint.rear,width:2*info.footprint.half}});}finally{e.dispose();}
      l.start=r.start;l.pins=r.pins;if(r.zones.length||r.exact)l.zones=r.zones;l.route=null;l.tested=null;
      return changed(setup,`Imported ${r.pins.length} path${r.pins.length===1?'':'s'} from ${path.basename(pp)}${r.exact?' exactly as Deck saved them':''}.${r.notes.length?'\n'+r.notes.map(n=>'  - '+n).join('\n'):''}`);}
    case'compare':{const log=rest[0];if(!log)throw Error('Use: compare <setup.json> <log.wpilog|log.csv> [--origin center].');
      const setup=readSetup(file),{e,info,l}=await load(setup);
      try{const route=planRoute(setup,l,info),data=RobotLog.parse({name:path.basename(log),bytes:new Uint8Array(fs.readFileSync(log))},{origin:flags.origin==='center'?'center':'corner'}),r=RobotLog.compare(data,route),f=v=>+v.toFixed(2);
        return say(json?{log:data.key,poses:r.samples,seconds:f(r.duration),meanError:f(r.meanError),maxError:f(r.maxError),worst:{x:f(r.worst.x),y:f(r.worst.y)},worstPath:r.worstPath===null?null:r.worstPath+1,endError:f(r.endError)}
          :`${path.basename(log)} · ${data.key}: ${r.samples} poses over ${f(r.duration)} s.\nFrom the plan: average ${f(r.meanError)} in, worst ${f(r.maxError)} in at (${f(r.worst.x)}, ${f(r.worst.y)})${r.worstPath!==null?` on path ${r.worstPath+1}`:''}.\nStopped ${f(r.endError)} in from the last end point.`);}
      finally{e.dispose();}}
    case'show':return say(show(file,readSetup(file),flags));
    default:throw Error(`Unknown command "${command}". Run: deck-sim help`);
  }
  function pickSize(box,f){const out={};for(const [k,key] of [['length','length'],['width','width'],['height','heightIn']]){const v=f[k]!==undefined?num(f[k],'--'+k):box[k];if(finite(v)){if(v<4||v>48)throw Error(`Robot ${k} ${v} in is outside 4-48 in. Check --units and --up.`);out[key]=v;}}return out;}
  function cadRef(f){const ax=(v,d)=>AXES.includes(v)?v:d;return {file:path.resolve(f.cad),front:ax(f.front,'+x'),top:ax(f.top,f.up==='y'?'+y':'+z')};}
}

if(require.main===module)main(process.argv.slice(2)).then(()=>process.exit(0),e=>{console.error(e.message);process.exit(1);});
module.exports={main,parse,pinFrom,clean,cadBox,fieldFacts,newSetup,readSetup,layoutOf,load,request,planRoute,exported,layoutFor,javaNames};
