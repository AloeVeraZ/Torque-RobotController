'use strict';
// Offline simulator core. Runs in the simulation utility process (src/sim-host.cjs) or directly in
// tests. Physics is DSIM's own (sim-runtime/dsim-host.cjs); autonomous programs run in a Java
// controller process in lockstep with the physics clock. Nothing here touches a real robot.
//
// Frames: the app uses inches with a bottom-left origin (+X right, +Y up, heading CCW from +X).
// DSIM is centred on the field. Standard games add 72 on each axis; custom empty fields add
// half their configured width/depth. Headings are identical.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const planner=require('../ui/sim-planner.js');
const config=require('../ui/sim-config.js');
const {PracticeClock}=require('./sim-practice.cjs');
const Timed=require('../ui/sim-timed.js');
const Ftc=require('../ui/sim-ftc.js');
const Export=require('../ui/sim-export.js');
const Mech=require('../ui/sim-mechanisms.js'),Kin=require('../ui/sim-kinematics.js'),Act=require('../ui/sim-actuators.js');
const MotionModule=require('../ui/sim-motionmodule.js');
const OFFSET=72,DEG=180/Math.PI,ZERO={forward:0,strafe:0,turn:0};
// How long the game physics takes to swing its ramp down or up (DSIM's BB_RAMP_DEPLOY_S).
const RAMP_SWING=.3;
// Frames go to the page at least this far apart (ms). Windows wakes the 4 ms pump only every ~15.6 ms, so a
// 32 ms spacing became every third wake (47 ms, 21 frames a second); 28 ms is every second wake (31 ms).
const FRAME_MS=28;
const FIELDS={empty:'Empty field',decode:'DECODE',biobuzz:'BIOBUZZ'};
// What each game's planning obstacles are, for the UI.
const OBSTACLES={empty:'',decode:'goals and ramps',biobuzz:'hive legs and flower bases'};
const LOCALIZATION=Object.fromEntries(Object.entries(config.sensors).map(([k,v])=>[k,v.name]));
const finite=n=>typeof n==='number'&&Number.isFinite(n),clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));

// The hardware catalog (sensor models), when this checkout has it.
let Hardware=null;try{Hardware=require('../ui/sim-hardware.js');}catch{}
// ---------------------------------------------------------------- the virtual Control Hub's own parts and sensors
// hub.kinematics: each servo, linear servo, continuous servo and DC motor actuator under its configuration name
// ({id, name, type servo|crservo|motor, reversed, countsPerUnit, port?, servo:{center, perUnit, sign, ratio, pwm}});
// hub.sensors: each wired sensor (robot.wiring.sensors) and what it measures ({name, type analog|digital|touch|distance|
// color|encoder, source:{joint}|{actuator}|{turret:n}|{piece:'intake'|'shooter', index}, port?, inverted, zeroVolts,
// voltsPerUnit, countsPerUnit, at, band}); hub.modules: the hubs by configuration name. The exporter's own description
// when it gives one (DeckSimFtc.kinematicsHardware, sensorHardware), else worked out here from the same settings. See
// tools/simulation/java/deck/sim/hub/VirtualHub.java for how the hub uses them.
const PART_TYPES={servo:'servo',linear:'servo',crservo:'crservo',dcmotor:'motor'};
function hubKinematics(kin,robot){
  if(typeof Ftc.kinematicsHardware==='function')return Ftc.kinematicsHardware(kin,robot)||[];
  return (kin?.actuators||[]).filter(a=>PART_TYPES[a.kind]).map(a=>{const type=PART_TYPES[a.kind],v=Act.servo(a),port=robot?.wiring?.devices?.['kin.'+a.id]?.port;
    return {id:a.id,name:a.device||Act.camel(a.name),type,reversed:!!a.reversed,countsPerUnit:Act.countsPer(a),...(type==='servo'?{servo:{center:v.center,perUnit:Act.perUnit(a),sign:a.reversed?-1:1,ratio:finite(a.ratio)&&a.ratio?a.ratio:1,pwm:v.pwm}}:{}),...(Number.isInteger(port)?{port}:{})};});
}
// What a wired sensor is on the hub: its catalog model's kind, else what its model id says.
function hubSensorType(s){const m=Hardware?.SENSORS?.find?.(x=>x.id===s.model),kind=m?.kind||'',id=String(s.model||'');
  if(kind==='motorEncoder'||kind==='octoquad')return null;
  if(['analogAbs','axonFeedback','potentiometer'].includes(kind)||m?.family==='analog')return 'analog';
  if(kind==='touch'||(kind==='magnetic'||kind==='limit')&&m?.xmlType==='RevTouchSensor')return 'touch';
  if(kind==='magnetic'||kind==='limit'||m?.family==='digital')return 'digital';
  if(kind==='color'||kind==='distance')return kind;
  if(kind==='throughBore'||m?.family==='encoder')return 'encoder';
  if(m)return null;
  return /touch/i.test(id)?'touch':/limit|magnet|switch/i.test(id)?'digital':/colou?r/i.test(id)?'color':/dist|tof|range|lidar/i.test(id)?'distance':/bore|encoder|quad/i.test(id)?'encoder':/axon|analog|pot|abs/i.test(id)?'analog':null;}
function hubSensors(robot,kin,mechanisms,localization){
  if(typeof Ftc.sensorHardware==='function')return Ftc.sensorHardware(robot,kin,mechanisms,localization)||[];
  const actuators=new Set((kin?.actuators||[]).map(a=>a.id)),joints=new Set((kin?.joints||[]).map(j=>j.id));
  return (robot?.wiring?.sensors||[]).map(s=>{const type=hubSensorType(s);if(!type)return null;const [list,index,field]=String(s.for||'').split('.'),n=+index,m=Hardware?.SENSORS?.find?.(x=>x.id===s.model);
    // What it measures: a part of the robot's own design, a shooter's turret or hood, or a game piece at an intake or shooter.
    const hood=list==='shooters'&&field==='hood'?(kin?.joints||[]).find(j=>j.drive?.signal==='hood'&&j.drive.of==='shooter:'+(n||0)):null;
    const source=list==='kin'?(actuators.has(index)?{actuator:index}:joints.has(index)?{joint:index}:null):s.use==='piece'&&(list==='intakes'||list==='shooters')?{piece:list==='intakes'?'intake':'shooter',index:n||0}:list==='shooters'&&field==='turretMotor'?{turret:n||0}:hood?{joint:hood.id}:null;
    const pick=k=>finite(s[k])?{[k]:s[k]}:{},port=Number.isInteger(s.port)?{port:s.port}:{};
    // An analog sensor not yet calibrated reads its model's span (volts across its degrees), mid-span at the CAD pose.
    const span=finite(m?.voltage)&&m.voltage>0?m.voltage:Kin.VOLTS;
    return {name:s.name||s.id,type,source,inverted:!!s.inverted,...port,...(type==='analog'?{zeroVolts:finite(s.zeroVolts)?s.zeroVolts:span/2,...(finite(s.voltsPerUnit)?{voltsPerUnit:s.voltsPerUnit}:finite(m?.degrees)&&m.degrees>0?{voltsPerUnit:span/m.degrees}:{})}:{}),
      ...pick('countsPerUnit'),...pick('at'),...pick('band'),...(finite(m?.cpr)?{cpr:m.cpr}:{})};}).filter(Boolean);
}
function hubModules(robot){const hubs=robot?.wiring?.hubs||{},exp=Object.keys(hubs).filter(k=>/^expansion(\d+)?$/.test(k)&&hubs[k]).map(k=>Number.isInteger(hubs[k].address)?hubs[k].address:2);return [{name:'Control Hub',address:173,parent:true},...exp.map(address=>({name:'Expansion Hub '+address,address}))];}
// How a game piece looks to a color sensor (0–1 a channel): nectar red or blue, pollen green; nothing: dark.
const PIECE_COLOR={red:{r:.55,g:.12,b:.1,a:.6},blue:{r:.1,g:.2,b:.6,a:.6},green:{r:.12,g:.5,b:.15,a:.6},none:{r:.02,g:.02,b:.02,a:.05}};

// Seeded normal noise so a run is reproducible.
function rng(seed){let s=(seed>>>0)||1;const u=()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return (s+.5)/4294967296;};return ()=>Math.sqrt(-2*Math.log(u()))*Math.cos(2*Math.PI*u());}

function sensorConfig(raw={}){
  const mode=Object.hasOwn(LOCALIZATION,raw.localization)?raw.localization:'encoders';
  const defaults=config.sensors[mode].error;
  const num=(v,d,max)=>finite(v)?clamp(v,0,max):d;
  return {localization:mode,scaleError:num(raw.scaleError,defaults[0],.1),noise:num(raw.noise,defaults[1],Infinity),gyroDrift:num(raw.gyroDrift,defaults[2],Infinity),seed:finite(raw.seed)?raw.seed>>>0:1};
}

// Simulated sensors read the TRUTH and return what a localizer would measure: a robot-frame
// displacement from odometry (scale error, per-tick noise) and an IMU heading (drift, noise).
class Sensors{
  constructor(config,truth){this.config=config;this.normal=rng(config.seed);this.last={...truth};this.drift=0;this.heading=truth.heading;}
  read(truth,dt){
    const c=this.config,mid=this.last.heading+wrap(truth.heading-this.last.heading)/2,fx=truth.x-this.last.x,fy=truth.y-this.last.y;
    let dx=fx*Math.cos(mid)+fy*Math.sin(mid),dy=-fx*Math.sin(mid)+fy*Math.cos(mid);const turn=wrap(truth.heading-this.last.heading);this.last={...truth};
    const profile=config.sensors[c.localization];if(c.localization==='none')return {odo:null,imu:this.heading};
    this.drift+=c.gyroDrift/60/DEG*dt;const imu=truth.heading+this.drift+(c.localization==='ideal'?0:this.normal()*.0005);
    if(!profile.translation)return {odo:null,imu};
    if(!profile.imu)this.heading+=turn*(1+c.scaleError)+this.normal()*c.noise*Math.abs(turn);
    if(c.localization!=='ideal'){const n=c.noise*Math.hypot(dx,dy);dx=dx*(1+c.scaleError)+this.normal()*n;dy=dy*(1+c.scaleError)+this.normal()*n;}
    return {odo:{dx,dy},imu:profile.imu?imu:this.heading};
  }
}

function robotConfig(raw={}){
  return config.robot(raw);
}
// Run folders are numbered per process, not per engine: a stopped engine deletes its folder a moment
// later, which must never be the folder another engine (a test drive, Optimize) is compiling in.
let runFolders=0;

class SimEngine{
  constructor({runtimeDir=path.join(__dirname,'../sim-runtime'),workDir,emit=()=>{},now=()=>performance.now()}={}){
    this.runtimeDir=runtimeDir;this.workDir=workDir||path.join(require('node:os').tmpdir(),'deck-sim');this.emit=emit;this.now=now;
    this.dsim=require(path.join(runtimeDir,'dsim-host.cjs'));this.ready=null;
    this.world=null;this.info=null;this.config=null;this.mode='idle';this.playing=false;this.speed=1;this.manualInput=null;this.practice=null;this.practiceInputAt=-Infinity;
    this.command={...ZERO};this.runSeq=0;this.child=null;this.pending=null;this.timer=null;this.busy=false;this.lastFrame=0;this.result=null;this.zones=[];
  }
  init(){return this.ready||(this.ready=(async()=>{await this.dsim.initPhysics();await this.dsim.initPhysics3d();})());}

  // ---------------------------------------------------------------- world
  async load(raw={}){
    await this.init();this.stopProgram('Simulation reloaded.');this.practice=null;this.playing=false;this.lastLoad=raw;
    const field=Object.hasOwn(FIELDS,raw.field)?raw.field:'empty',physics=field==='biobuzz'&&raw.physics!=='2d'?'3d':'2d';
    const start=raw.start&&[raw.start.x,raw.start.y,raw.start.heading].every(finite)?{x:raw.start.x,y:raw.start.y,heading:raw.start.heading}:{x:9,y:72,heading:0};
    // Mechanisms (intake, storage, indexer, shooter) use the game's own piece physics, so they act on BIOBUZZ.
    const mechanisms=Mech.sanitize(raw.mechanisms);mechanisms.enabled=mechanisms.enabled&&field==='biobuzz';
    // How the robot's parts move (joints, actuators, actions): drawn from the joint values each frame carries.
    const kinematics=Kin.forEngine(raw.kinematics);
    this.config={field,physics,start,mechanisms,kinematics,alliance:raw.alliance==='blue'?'blue':'red',controller:raw.controller==='motionmodule'?'motionmodule':'ftc',timing:Timed.settings(raw.timing),elements:field!=='empty'&&raw.elements!==false,robot:config.robot(raw.robot,raw.controller==='motionmodule'?'motionmodule':'ftc'),bounds:config.bounds({...raw,field}),sensors:sensorConfig(raw.controller==='motionmodule'?{...raw.sensors,localization:config.localization('motionmodule',raw.sensors?.localization)}:raw.sensors),tuning:raw.tuning&&typeof raw.tuning==='object'?raw.tuning:{}};this._empty=null;
    this.origin=field==='empty'?{x:this.config.bounds.x1/2,y:this.config.bounds.y1/2}:{x:OFFSET,y:OFFSET};
    this.zones=Array.isArray(raw.zones)?raw.zones.slice(0,24).map(z=>{try{return planner.validateZone(z);}catch{return null;}}).filter(Boolean):[];
    this.build();
    // Timed driving needs no floor measurements: unless the team typed numbers measured on their robot,
    // speed, speed-up and coasting come from the robot settings (the simulated robot driven 1 s and 2 s).
    if(this.config.timing.source==='robot'){const key=JSON.stringify([this.config.robot,this.config.timing.power]);if(this._timedAuto?.key!==key)this._timedAuto={key,value:this.timedCalibration(this.config.timing.power)};const {power,...value}=this._timedAuto.value;Object.assign(this.config.timing,value);}
    const r=this.world.robots[0],D=this.dsim,ext=D.footprintExtents(r.spec),dp=D.driveParams(r.spec);
    const mod=this.module(),walls=4,bounds=mod?mod.bounds:{halfX:OFFSET,halfY:OFFSET};
    const fieldZones=mod?mod.colliders.statics.slice(walls).map((s,i)=>({id:`field-${i}`,type:'rect',x:s.tx+OFFSET,y:s.ty+OFFSET,width:2*s.hx,height:2*s.hy,angle:s.rot*DEG})):[];
    if(field==='decode')for(const a of ['red','blue'])fieldZones.push({id:'goal-'+a,type:'polygon',points:D.goalTriangle(a).map(p=>({x:p.x+OFFSET,y:p.y+OFFSET}))});
    // BIOBUZZ's 3D structures (hive frames, flower supports), for drawing only: planning uses the
    // floor-level obstacles above, which are the same solids DSIM's planar solve uses.
    const structures=field==='biobuzz'?D.cadStatics().map(s=>{const p=[];for(let i=0;i<s.points.length;i+=3)p.push(+(s.points[i]+OFFSET).toFixed(3),+(s.points[i+1]+OFFSET).toFixed(3),+s.points[i+2].toFixed(3));return p;}):[];
    const structureParts=field==='biobuzz'?D.cadStatics().map((s,i)=>({name:s.name,kind:s.class,points:structures[i]})):[];
    if(field==='biobuzz'){const data=D.fieldColliders3d();for(const a of ['red','blue']){const tray=data.trays[a],angle=D.cadCaptureTheta(a),c=Math.cos(angle),s=Math.sin(angle);for(const hull of tray.hulls){const points=[];for(let i=0;i<hull.points.length;i+=3){const [x,y,z]=hull.points.slice(i,i+3);points.push(x+tray.pivot[0]+OFFSET,y*c-z*s+tray.pivot[1]+OFFSET,y*s+z*c+tray.pivot[2]);}structureParts.push({name:a+' '+hull.name,kind:hull.class,alliance:a,points});}}}
    const flowers=field==='biobuzz'?D.fieldColliders3d().flowers.map(f=>({name:f.id,rings:f.rings.map(r=>({z:r.z,hole:r.hole,x:r.bore[0]+OFFSET,y:r.bore[1]+OFFSET}))})):[];
    const goals=field==='decode'?['red','blue'].map(alliance=>{const rect=D.classifierRect(alliance);return {alliance,triangle:D.goalTriangle(alliance).map(p=>({x:p.x+OFFSET,y:p.y+OFFSET})),openingZ:D.GOAL_OPENING_Z,classifier:{x0:rect.x0+OFFSET,x1:rect.x1+OFFSET,y0:rect.y0+OFFSET,y1:rect.y1+OFFSET,height:D.CLASSIFIER_HEIGHT}};}):[];
    const trays=field==='biobuzz'?Object.fromEntries(['red','blue'].map(a=>[a,{pivot:D.fieldColliders3d().trays[a].pivot.map((v,i)=>v+(i<2?OFFSET:0)),reference:D.cadCaptureTheta(a)}])):{};
    this.info={field,fieldName:FIELDS[field],obstacleName:OBSTACLES[field],physics,structures,structureParts,flowers,goals,trays,
      bounds:field==='empty'?this.config.bounds:{x0:OFFSET-bounds.halfX,y0:OFFSET-bounds.halfY,x1:OFFSET+bounds.halfX,y1:OFFSET+bounds.halfY},fieldZones,
      footprint:{front:ext.front,rear:ext.rear,half:ext.half},
      robot:{...this.config.robot},driveProfile:config.drives[this.config.robot.drivetrain],
      drive:{maxSpeed:dp.maxSpeed,maxStrafe:dp.maxSpeed*dp.strafeMult,maxTurnDeg:dp.maxTurn*DEG,accel:dp.accel},
      mechanisms:this.config.mechanisms,alliance:this.config.alliance,target:Mech.target(this.config.mechanisms,field,this.config.alliance),
      timing:{...this.config.timing},sensors:this.config.sensors,localizationName:LOCALIZATION[this.config.sensors.localization],tuning:this.tuning(r.spec)};
    this.emitFrame(true);return this.info;
  }
  module(){return this.config.field==='empty'?null:this.dsim.SIM_GAMES[this.config.field];}
  build(){
    const D=this.dsim;if(this.world?.game==='biobuzz')D.disposePhysics3dFor(this.world);
    const c=this.config,m=c.mechanisms,engineDrive=config.drives[c.robot.drivetrain].engine,spec=D.coerceSpec({...D.DEFAULT_SPEC,...c.robot,drivetrain:engineDrive,intake:'sloped',...(m.enabled?Mech.engineSpec(m):{})},D.DEFAULT_SPEC,c.field==='biobuzz'?'biobuzz':'decode');
    const setup={id:0,alliance:c.field==='biobuzz'?c.alliance:'blue',spec,assists:{fieldCentric:false,aimAssist:false,autoIntake:false,autoFire:false},startIndex:0};
    const mod=this.module();
    this.world=mod?mod.createWorld('free',1,[setup],undefined,c.physics):D.SIM_GAMES.decode.createWorld('free',1,[setup]);
    // Without mechanisms the robot is a pushbot: it carries nothing. With them it keeps up to
    // `preload` of the pieces the game stages in or on the robot.
    const robot=this.world.robots[0],keep=m.enabled&&c.elements?m.preload.pollen:0;let held=0;
    this.world.balls=c.elements?this.world.balls.filter(b=>b.state?.kind!=='held'||held++<keep):[];if(Array.isArray(robot.hopper))robot.hopper=robot.hopper.slice(0,Math.min(keep,held));
    this.spreadStaged();
    this.mech=new Mech.Model(m,Array.isArray(robot.hopper)?robot.hopper.length:0,{length:c.robot.length,width:c.robot.width});this.mechRunner=new Mech.Runner(m,{start:name=>this.kin.start(name),busy:name=>this.kin.busy(name)});this.mechCmd={intake:false,spin:false,aim:false,feed:false};this.mechOut={intake:false,fire:false};this.mechBusy=false;this.mechLatch={};this.pieceStats=null;this.kin=new Kin.Driver(c.kinematics||Kin.EMPTY());this.partCmds={};this.jointTick(0);
    this.applyBarriers();
    const r=this.world.robots[0],p={x:c.start.x-this.origin.x,y:c.start.y-this.origin.y};
    // The game engine's competition limits do not apply to an offline pushbot. Override after
    // spawn coercion, before the first physics step (including lazy Rapier body construction).
    // Preserve the drive model's historical 20 A torque reference at the editor's nominal
    // 10 A per-port setting. This calibration is a torque scale, not a measured current draw.
    Object.assign(r.spec,{length:c.robot.length,width:c.robot.width,heightIn:c.robot.heightIn,stowHeightIn:c.robot.heightIn,massLb:c.robot.massLb,driveRpm:c.robot.driveRpm,deckWheelMm:c.robot.wheelDiameterMm,deckDriveMotors:c.robot.drivetrain==='tank2'?2:4,drivetrain:engineDrive,deckIntakeReach:config.chassisHitbox(c.robot)?0:c.robot.intakeIn,deckBodyOnly:config.chassisHitbox(c.robot)});
    // Mechanism parts beyond the game's builder (build adapter deck-mechanism-parts): intake sides, separate
    // pollen and nectar capacity, and fixed shooters that keep the heading mechanismTick gives them.
    if(m.enabled){const mount=Mech.engineIntakeMount(m);if(mount)r.spec.intakeMount=mount;r.spec.deckCaps={...m.capacity};r.spec.deckFixedYaw=m.shooters.map(s=>s.type==='fixed');r.spec.deckShooterPieces=m.shooters.map(s=>s.pieces);
      // Each intake's box is its hitbox: it sticks out past the frame, and a piece must touch it to be taken.
      // flower: whether it is the intake kind the physics reaches into flowers with (a ramp or side rollers).
      const boxes={},flower=Mech.flowerKind(m);for(const i of m.intakes)for(const e of i.sides){const edge=e==='front'||e==='back'?c.robot.width:c.robot.length;const col=i.pickup==='rollers'&&i.column?i.column:null,reach=col?Mech.columnReach(col,e,c.robot):i.reach;boxes[e]={reach,width:i.width??edge,height:i.height,flower:i.kind===flower,...(col?{column:{a:col.a,b:col.b,r:col.d/2}}:{})};}r.spec.deckIntakeBoxes=boxes;
      // Two shooters on one turret launch from its one spot; the game's spawn checks moved the second apart.
      if(m.shooters[1]?.sharesTurret&&r.spec.bbMech?.launcher)r.spec.bbMech={...r.spec.bbMech,launcher:{...r.spec.bbMech.launcher,mount:m.shooters[0].mount,mount2:m.shooters[0].mount}};
      this.rampDown=false;this.rampOut=false;this.rampHeld=false;}
    // The mechanism model points the turret (see mechanismTick); the game physics launches along it.
    Object.assign(r,{pos:p,heading:c.start.heading/DEG,turretHeading:c.start.heading/DEG,vel:{x:0,y:0},angVel:0,fieldCentric:false,aimAssist:false,autoIntake:false,autoFire:false});
    this.sensors=new Sensors(c.sensors,this.truth());this.estimate=null;this.command={...ZERO};this.result=null;this.trail=[];
  }
  // BIOBUZZ stages each missing robot's four POLLEN in one line at its alliance's loading zone. Deck
  // drives one robot, so the other alliance has two no-shows and both lines land on the same spot:
  // every ball starts inside another and the first physics step blasts them across the field. The
  // stacked lines become one line of eight along the wall, filling the 22.69 in zone as on the real field.
  spreadStaged(){const at=new Map();for(const b of this.world.balls){if(b.state?.kind!=='ground')continue;const key=b.pos.x.toFixed(3)+','+b.pos.y.toFixed(3);at.set(key,[...(at.get(key)||[]),b]);}
    const lines=new Map();for(const group of at.values())if(group.length>1){const x=group[0].pos.x.toFixed(3);lines.set(x,[...(lines.get(x)||[]),...group]);}
    for(const line of lines.values()){const d=2*(line[0].r||1.4),mid=line.reduce((s,b)=>s+b.pos.y,0)/line.length;line.sort((p,q)=>p.pos.y-q.pos.y).forEach((b,k)=>{b.pos={x:b.pos.x,y:mid+(k-(line.length-1)/2)*d};});}}
  colliders(){const T=10,b=this.config.bounds,x0=b.x0-this.origin.x,x1=b.x1-this.origin.x,y0=b.y0-this.origin.y,y1=b.y1-this.origin.y,w=x1-x0,h=y1-y0,wall=(tx,ty,hx,hy)=>({tx,ty,hx,hy,rot:0});return this._empty||(this._empty={statics:[wall(x0-T,(y0+y1)/2,T,h/2+2*T),wall(x1+T,(y0+y1)/2,T,h/2+2*T),wall((x0+x1)/2,y0-T,w/2+2*T,T),wall((x0+x1)/2,y1+T,w/2+2*T,T)],bounds:{halfX:w/2,halfY:h/2}});}
  applyBarriers(){const triangles=[];for(const zone of this.zones){let p=planner.polygon(zone);if(p.length===2){const [a,b]=p,angle=Math.atan2(b.y-a.y,b.x-a.x)*DEG;p=planner.polygon({type:'rect',x:(a.x+b.x)/2,y:(a.y+b.y)/2,width:Math.hypot(b.x-a.x,b.y-a.y),height:1,angle});}const points=p.flatMap(q=>[q.x-this.origin.x,q.y-this.origin.y]),indices=this.dsim.Earcut.triangulate(points);for(let i=0;i<indices.length;i+=3)triangles.push(indices.slice(i,i+3).flatMap(j=>points.slice(j*2,j*2+2)));}this.world.deckPolygons=triangles;}
  physicsStep(world,cmd){
    const D=this.dsim,dt=D.SIM_DT,mech=world===this.world&&this.config.mechanisms.enabled?this.mechOut:null,input={driveX:-cmd.strafe,driveY:cmd.forward,rotate:cmd.turn,leftDrive:clamp(cmd.forward-cmd.turn,-1,1),rightDrive:clamp(cmd.forward+cmd.turn,-1,1),intake:!!mech?.intake,fire:!!mech?.fire};
    // Explicit FLOAT commands coast unpowered axes instead of braking.
    world.robots[0].deckFloat=cmd.float===true;
    const mod=world===this.world?this.module():null;
    if(mod){const previous=mod.colliders.deckPolygons;mod.colliders.deckPolygons=world.deckPolygons;try{mod.step(world,dt,new Map([[0,input]]));}finally{mod.colliders.deckPolygons=previous;}}
    else{world.time+=dt;world.tick++;const r=world.robots[0],wrench=D.updateRobot(world,r,input,dt),colliders={...this.colliders(),deckPolygons:world.deckPolygons};D.solveRobots(world,dt,colliders,undefined,new Map([[r.id,wrench]]));}
  }
  truth(){const r=this.world.robots[0];return {x:r.pos.x+this.origin.x,y:r.pos.y+this.origin.y,heading:r.heading,vx:r.vel.x,vy:r.vel.y,omega:r.angVel,z:r.z||0};}

  // Measure the simulated drivetrain: free speed,
  // then braking distance from two speeds (forward, strafe, turn) on a separate empty world.
  tuning(spec){
    const D=this.dsim,key=JSON.stringify([spec.drivetrain,spec.length,spec.width,spec.intake,spec.deckIntakeReach,spec.massLb,spec.driveRpm,spec.deckWheelMm,spec.deckDriveMotors]);
    if(this._tuning?.key===key)return this.userTuning(this._tuning.value);
    const make=()=>{const w=D.SIM_GAMES.decode.createWorld('free',1,[{id:0,alliance:'blue',spec,assists:{fieldCentric:false,aimAssist:false,autoIntake:false,autoFire:false},startIndex:0}]);w.balls=[];Object.assign(w.robots[0].spec,spec);Object.assign(w.robots[0],{pos:{x:0,y:0},heading:0,vel:{x:0,y:0},angVel:0,fieldCentric:false,autoIntake:false,autoFire:false,aimAssist:false,hopper:[]});return w;};
    const brake=(axis,power)=>{if(axis==='strafe'&&D.driveParams(spec).strafeMult===0)return brake('forward',power);const w=make(),r=w.robots[0],cmd={...ZERO,[axis]:power};
      // Far walls: measure free motion, not a collision.
      const saved=this._empty;this._empty={statics:[],bounds:{halfX:1e6,halfY:1e6}};
      const dp=D.driveParams(spec),limit=axis==='turn'?dp.maxTurn:dp.maxSpeed*(axis==='strafe'?dp.strafeMult:1),accel=axis==='turn'?dp.turnAccel:dp.accel,steps=Math.min(18000,Math.max(90,Math.ceil(4*limit/Math.max(.01,accel)/D.SIM_DT)));
      try{for(let i=0;i<steps;i++)this.physicsStep(w,cmd);const v=axis==='turn'?r.angVel:Math.hypot(r.vel.x,r.vel.y),p0={...r.pos};let previous=r.heading,rotation=0;for(let i=0;i<Math.max(120,steps);i++){this.physicsStep(w,ZERO);rotation+=wrap(r.heading-previous);previous=r.heading;if(Math.hypot(r.vel.x,r.vel.y)<1e-5&&Math.abs(r.angVel)<1e-5)break;}
        // Heading wraps at ±pi; endpoint subtraction invents a full turn at that seam.
        return {v:Math.abs(v),d:axis==='turn'?Math.abs(rotation):Math.hypot(r.pos.x-p0.x,r.pos.y-p0.y)};}finally{this._empty=saved;}};
    // Measure FLOAT coast-down separately from driven braking. Retain the legacy quadratic-fit
    // fields for setup compatibility, with a positive linear floor to avoid degenerate fits.
    const coast=axis=>{if(axis==='strafe'&&D.driveParams(spec).strafeMult===0)return coast('forward');const w=make(),r=w.robots[0],cmd={...ZERO,[axis]:1},saved=this._empty;this._empty={statics:[],bounds:{halfX:1e6,halfY:1e6}};
      const dp=D.driveParams(spec),steps=Math.min(18000,Math.max(90,Math.ceil(4*dp.maxSpeed/Math.max(.01,dp.accel)/D.SIM_DT)));
      try{for(let i=0;i<steps;i++)this.physicsStep(w,cmd);const v=Math.hypot(r.vel.x,r.vel.y),p0={...r.pos};for(let i=0;i<36000;i++){this.physicsStep(w,{...ZERO,float:true});if(Math.hypot(r.vel.x,r.vel.y)<1e-3)break;}
        return v*v/(2*Math.max(1e-6,Math.hypot(r.pos.x-p0.x,r.pos.y-p0.y)));}finally{this._empty=saved;}};
    const LINEAR_MIN=1e-3,fit=(a,b)=>{const det=a.v*a.v*b.v-b.v*b.v*a.v;if(Math.abs(det)<1e-9)return {q:Math.max(1e-6,a.d/Math.max(1e-9,a.v*a.v)),l:LINEAR_MIN};const q=(a.d*b.v-b.d*a.v)/det,l=(a.v*a.v*b.d-b.v*b.v*a.d)/det;return {q:Math.max(q,1e-6),l:Math.max(l,LINEAR_MIN)};};
    const fwd=brake('forward',1),f=fit(fwd,brake('forward',.5)),tank=D.driveParams(spec).strafeMult===0;
    const str=tank?fwd:brake('strafe',1),s=tank?f:fit(str,brake('strafe',.5)),h=fit(brake('turn',1),brake('turn',.5));
    const speedScale=Math.min(4,Math.max(.25,58.46/fwd.v)),turnScale=Math.min(4,Math.max(.25,301.2/DEG/Math.max(1e-6,D.driveParams(spec).maxTurn)));
    // A robot with less rotational inertia than the 9.41 lb, 17.56 x 17.79 in reference responds faster to
    // the same heading power, and full-strength gains ring around the target (a 5 lb 15 x 15 in robot never
    // settled a turn). Scale heading gains by the inertia ratio; heavier robots keep the reference gains.
    const inertiaScale=Math.min(1,Math.max(.2,spec.massLb*(spec.length**2+spec.width**2)/(9.41*(17.56**2+17.79**2))));
    const value={maxForward:fwd.v,maxStrafe:str.v,maxTurn:D.driveParams(spec).maxTurn,maxAcceleration:D.driveParams(spec).accel,forwardDeceleration:coast('forward'),strafeDeceleration:coast('strafe'),
      linearBrakeForward:f.l,linearBrakeStrafe:s.l,quadraticBrakeForward:f.q,quadraticBrakeStrafe:s.q,headingBrakeLinear:h.l,headingBrakeQuadratic:h.q,
      // Starting feedback gains measured across the simulated drive model. The controller adapter
      // scales these power gains for its velocity feedforward and position/heading PD loops.
      // A faster robot needs proportionally less correction power: scale by this
      // robot's speed relative to the 312 RPM reference chassis they were tuned on (58.5 in/s, 301°/s).
      headingP:6*turnScale*inertiaScale,headingD:.06*turnScale*inertiaScale,translationalP:.45*speedScale,translationalSmall:.15*speedScale,translationalD:.012*speedScale,
      // Default path speed: 60% of top speed, capped near 45 in/s so a fast robot still tracks tight
      // corners within ~2 in (measured). Advanced settings can raise it.
      maxPathSpeed:Math.max(.3,Math.min(.8,Math.floor(45/fwd.v*20)/20)),holdTimeoutMs:2000};
    this._tuning={key,value};return this.userTuning(value);
  }
  // Timed-driving calibration, the way a team does it on the floor: drive at `power` for 1 s and for
  // 2 s on an empty field, measure how far the robot went once stopped, and fit distance = speed·time +
  // offset. The offset becomes start compensation (lag) or stop compensation (roll-on).
  timedCalibration(power=this.config?.timing?.power??.45){
    const D=this.dsim,spec=this.world.robots[0].spec,p=clamp(finite(power)?power:.45,.05,1),saved=this._empty;this._empty={statics:[],bounds:{halfX:1e6,halfY:1e6}};
    const drive=(axis,seconds)=>{const w=D.SIM_GAMES.decode.createWorld('free',1,[{id:0,alliance:'blue',spec,assists:{fieldCentric:false,aimAssist:false,autoIntake:false,autoFire:false},startIndex:0}]);w.balls=[];const r=w.robots[0];Object.assign(r.spec,spec);Object.assign(r,{pos:{x:0,y:0},heading:0,vel:{x:0,y:0},angVel:0,fieldCentric:false,autoIntake:false,autoFire:false,aimAssist:false,hopper:[]});
      for(let i=0;i<Math.round(seconds/D.SIM_DT);i++)this.physicsStep(w,{...ZERO,[axis]:p});for(let i=0;i<1200;i++){this.physicsStep(w,ZERO);if(Math.hypot(r.vel.x,r.vel.y)<1e-3)break;}return Math.hypot(r.pos.x,r.pos.y);};
    try{const fit=axis=>{const d1=drive(axis,1),d2=drive(axis,2),v=d2-d1,offset=d1-v;return {speed:v/p,startup:Math.max(0,-offset/v),stopping:Math.max(0,offset/v)};};
      const f=fit('forward'),s=D.driveParams(spec).strafeMult>0?fit('strafe'):f;
      return {power:p,forwardSpeed:+f.speed.toFixed(2),strafeSpeed:+s.speed.toFixed(2),startup:+f.startup.toFixed(3),stopping:+f.stopping.toFixed(3),strafeStopping:+Math.max(0,s.stopping-s.startup).toFixed(3)};}
    finally{this._empty=saved;}
  }
  userTuning(base={}){
    const t=this.config?.tuning||{},out={...base};
    // Correction gains always come from this robot's measured drive model. Old raw PID overrides
    // and the retired 0–2 correction strength are ignored; arbitrarily large gains ring.
    out.maxPathSpeed=finite(t.maxPathSpeed)?clamp(t.maxPathSpeed,0,1):(base.maxPathSpeed??.8);
    return out;
  }

  // ---------------------------------------------------------------- clock
  play(){if(!this.world)throw Error('Load the simulation first.');this.playing=true;this.anchor=null;if(!this.timer){this.timer=setInterval(()=>void this.pump(),4);this.timer.unref?.();}this.emitFrame(true);}
  pause(){this.playing=false;this.manualInput=null;if(this.practice)this.practice.neutralRequired=true;this.emitFrame(true);}
  setSpeed(speed){this.speed=clamp(finite(speed)?speed:1,.1,4);this.anchor=null;}
  manual(input){
    if(!input){this.manualInput=null;return;}
    const n=v=>finite(v)?clamp(v,-1,1):0;this.manualInput={x:n(input.x),y:n(input.y),turn:n(input.turn),fieldCentric:!!input.fieldCentric,precision:!!input.precision};
    if(this.mode==='idle'&&(this.manualInput.x||this.manualInput.y||this.manualInput.turn))this.mode='manual';
  }
  manualCommand(){
    const m=this.manualInput;if(!m)return {...ZERO};const h=this.world.robots[0].heading,k=m.precision?.4:1;let forward=m.y,left=-m.x;
    if(m.fieldCentric){forward=m.x*Math.cos(h)+m.y*Math.sin(h);left=-m.x*Math.sin(h)+m.y*Math.cos(h);if(!config.drives[this.config.robot.drivetrain].holonomic){const magnitude=Math.hypot(m.x,m.y),error=wrap(Math.atan2(m.y,m.x)-h);return {forward:magnitude>.05?Math.min(1,magnitude)*Math.max(0,Math.cos(error))*(Math.abs(error)<.2?1:0)*k:0,strafe:0,turn:clamp((magnitude>.05?error*1.5:0)-m.turn,-1,1)*k};}}
    return {forward:forward*k,strafe:left*k,turn:-m.turn*k};
  }
  async pump(){
    if(this.busy||!this.playing||!this.world)return;
    const dt=this.dsim.SIM_DT,now=this.now();if(!this.anchor)this.anchor={wall:now,sim:this.world.time};
    let due=Math.floor(((now-this.anchor.wall)/1000*this.speed-(this.world.time-this.anchor.sim))/dt);
    if(due>8){this.anchor={wall:now,sim:this.world.time};due=1;}
    this.busy=true;
    try{for(let i=0;i<due&&this.playing;i++)await this.practiceTick();}
    catch(e){this.fail(e.message);}finally{this.busy=false;}
    if(now-this.lastFrame>=FRAME_MS)this.emitFrame();
  }
  // Mechanism commands for this tick become the game physics' intake and fire inputs.
  mechanismTick(){
    if(!this.config.mechanisms.enabled)return;
    const r=this.world.robots[0],t=this.truth();
    this.mechOut=this.mech.tick(this.dsim.SIM_DT,this.mechCmd,{pose:{x:t.x,y:t.y,heading:t.heading},target:this.aimTarget(),held:Array.isArray(r.hopper)?r.hopper.length:0});
    const boxes=r.spec.deckIntakeBoxes;if(boxes)for(const e of Object.keys(boxes))boxes[e].off=this.mechOut.edgesOff.includes(e);
    // A ramp's servo: when it is sent down or up, the game physics swings its ramp (RAMP_SWING s) so it settles when
    // the model's ramp gets there. Only a settled ramp reaches into flowers; one that hits a wall folds back.
    const ramp=this.mechOut.ramp;
    if(ramp&&ramp.down!==this.rampDown){this.rampDown=ramp.down;Object.assign(r,{bbRampOut:ramp.down,bbRampAt:this.world.time+ramp.eta-RAMP_SWING,bbRampBlocked:false});}
    // Each shooter points where the model says, relative to the chassis (a turret where it aimed, a fixed
    // shooter along its facing); launches follow it. The second shooter is the game's nectar launcher.
    const shooters=this.config.mechanisms.shooters;r.aimAssist=false;
    if(shooters[0])r.turretHeading=r.heading+this.mech.aim(0)/DEG;if(shooters[1])r.bbTurret2Heading=r.heading+this.mech.aim(1)/DEG;
  }
  // A route action that names a moving part's action, or a part and one of its positions, starts it once each time the
  // route reaches it; a pin holds while it moves.
  routeJoints(act){const key=act?(act.moving?'path'+(act.path??act.leg):'pin'+act.leg)+':'+act.name:'';if(key!==this.kinKey){this.kinKey=key;if(act?.name)this.kin.start(act.name);}return !!(act&&!act.moving&&this.kin.busy(act.name));}
  // Joint values for this tick from the mechanism model's signals (turrets, flywheels, intakes, ramps, feeders). The hood
  // follows the flywheel's speed now through the calibrated hood angles (the fixed hood angle without them).
  jointTick(dt=this.dsim.SIM_DT){
    if(!this.kin)return;const m=this.mech,c=this.mechCmd||{},on=this.config.mechanisms.enabled;
    const last=this.world?.robots?.[0]?.hopper?.at?.(-1),piece=last===undefined?null:/^(red|blue)$/.test(String(last))?3.6:2.8;
    this.kin.tick(dt,on?{turrets:m.turrets,flywheel:m.flywheel,kick:m.kick,lift:m.lift,piece,intake:!!c.intake,spin:!!c.spin,aim:!!c.aim,feed:!!c.feed,chained:Mech.chained(this.config.mechanisms),rpm:this.config.mechanisms.shooter.rpm,hood:m.hood()}:{});
  }
  // Where shooters aim: the cell the route's action names (the hive cell up at the start, or the other one);
  // in teleop, whichever cell faces up right now, as a driver would.
  aimTarget(){
    const c=this.config,hive=this.world?.biobuzz?.hives?.[c.alliance];
    const cell=this.mode==='manual'&&hive?(hive.up===(c.alliance==='blue'?'north':'south')?'start':'other'):this.mechCell||'start';
    return Mech.target(c.mechanisms,c.field,c.alliance,cell);
  }
  mechanismState(){
    if(!this.config.mechanisms.enabled)return null;const s=this.mech.state(),m=this.config.mechanisms,score=this.world.biobuzz?.points?.[this.config.alliance];
    const st=this.pieceStats,hopper=Array.isArray(this.world.robots[0].hopper)?this.world.robots[0].hopper:[],nectar=hopper.filter(c=>c==='red'||c==='blue').length;return {...s,pollen:hopper.length-nectar,nectar,pickedUp:st?.picked??0,launched:st?.launched.size??0,landed:st?.landed.size??0,busy:this.mechBusy,command:{...this.mechCmd},flywheelTicksPerSecond:s.flywheel*m.shooter.rpm*m.shooter.ticksPerRev/60,turretTicks:s.turret*m.turret.ticksPerDegree,score:finite(score)?score:null,tips:this.world.biobuzz?.hives?.[this.config.alliance]?.tips??null};
  }
  // Run analysis: pieces the robot picked up, launched, and that landed in its alliance's hive, by piece id.
  trackPieces(){
    const w=this.world,r=w.robots[0];if(!this.config.mechanisms.enabled||!w.biobuzz)return;
    const held=new Set(w.balls.filter(b=>b.state?.kind==='held'&&(b.state.robot===undefined||b.state.robot===r.id)).map(b=>b.id));
    const st=this.pieceStats||(this.pieceStats={held,picked:0,launched:new Set(),landed:new Set()});
    for(const id of held)if(!st.held.has(id))st.picked++;for(const id of st.held)if(!held.has(id))st.launched.add(id);st.held=held;
    for(const id of w.biobuzz.hives?.[this.config.alliance]?.contents||[])if(st.launched.has(id))st.landed.add(id);
  }
  tick(cmd){
    this.mechanismTick();this.jointTick();this.command=cmd;this.physicsStep(this.world,cmd);this.trackPieces();const t=this.truth(),reading=this.sensors.read(t,this.dsim.SIM_DT);
    if(this.world.tick%3===0){this.trail.push({x:t.x,y:t.y,e:this.estimate?{x:this.estimate.x,y:this.estimate.y}:null});if(this.trail.length>2400)this.trail.splice(0,600);}
    const corners=planner.body({x:t.x,y:t.y,heading:t.heading*DEG},this.info.footprint);
    const hit=this.zones.filter(z=>planner.zoneHits(corners,z)).map(z=>z.id);
    const contacts=(this.info.fieldZones||[]).filter(z=>planner.zoneHits(corners,z)).map(z=>z.id);
    const b=this.info.bounds;if(corners.some(p=>p.x<=b.x0+.05||p.x>=b.x1-.05||p.y<=b.y0+.05||p.y>=b.y1-.05))contacts.push('field-wall');
    this.contacts=contacts;this.contactEvents=this.contactEvents||new Set();for(const id of contacts)this.contactEvents.add(id);
    if(hit.length){this.violations=this.violations||new Set();for(const id of hit)this.violations.add(id);}
    this.hit=hit;return reading;
  }
  step(count=1){for(let i=0;i<count;i++)this.tick(this.manualCommand());this.emitFrame(true);}

  // ---------------------------------------------------------------- programs
  async startPractice(raw={}){
    this.stop();this.practice=null;
    if(!planner.safePose(this.config.start,[],this.info.footprint,this.info.bounds))throw Error('The starting robot footprint must fit inside this field. Change the field size, robot size or starting pose.');
    if(raw.mode==='teleop'){this.reset(true);this.practice=new PracticeClock('teleop',raw.timing);this.mode='manual';this.play();return {ok:true};}
    const result=await this.run(raw.program||{});if(result.ok)this.practice=new PracticeClock(raw.mode,raw.timing);this.emitFrame(true);return result;
  }
  practiceInput(pad){
    if(!this.practice||this.practice.phase!=='teleop'||!this.playing){this.manualInput=null;this.manualMech=null;return;}
    const n=v=>finite(v)?clamp(v,-1,1):0,valid=pad&&pad.mapping==='standard',x=valid?n(pad.axes?.[0]):0,y=valid?-n(pad.axes?.[1]):0,turn=valid?n(pad.axes?.[2]):0;
    if(!valid){this.manualInput=null;this.manualMech=null;this.practice.neutralRequired=true;return;}
    if(this.practice.neutralRequired){this.manualInput=null;if(Math.max(Math.abs(x),Math.abs(y),Math.abs(turn))<=.06){this.practice.neutralRequired=false;this.practiceInputAt=this.now();}return;}
    this.practiceInputAt=this.now();this.manualInput={x,y,turn,fieldCentric:this.config.robot.driveStyle==='field',precision:!!pad.buttons?.[4]?.pressed};
    // Teleop mechanisms: right bumper intakes, left trigger spins up, right trigger shoots, Y folds a ramp down or back
    // up (keyboard: E, Shift, G, F).
    const press=i=>!!pad.buttons?.[i]?.pressed||(pad.buttons?.[i]?.value??0)>.3,toggle=press(3);if(toggle&&!this.rampHeld)this.rampOut=!this.rampOut;this.rampHeld=toggle;
    this.manualMech={intake:press(5),spin:press(6),feed:press(7)};
  }
  async practiceTick(){
    const practice=this.practice,seq=this.runSeq;
    if(practice&&practice.phase==='teleop'&&this.now()-this.practiceInputAt>500){this.manualInput=null;this.manualMech=null;practice.neutralRequired=true;}
    if(this.mode==='manual'&&this.config.mechanisms.enabled){const b=practice?.phase==='teleop'&&this.manualInput?this.manualMech||{}:{},shoot=!!b.feed;this.mechCmd={intake:!!b.intake,spin:!!b.spin||shoot,aim:!!b.spin||shoot,feed:shoot,ramp:!!this.rampOut};this.mechBusy=false;}
    if(this.mode==='program')await this.programTick();else if(this.mode==='timed')this.timedTick();else this.tick(practice&&practice.phase!=='teleop'?ZERO:this.manualCommand());
    if(!practice||practice!==this.practice||!this.playing)return;
    // A run failure invalidates the session; a clean early finish holds still until AUTO ends.
    if(seq!==this.runSeq&&this.child)return;
    const change=practice.advance(this.dsim.SIM_DT);if(!change)return;
    if(change.from==='auto'&&(this.child||this.timed)){const t=this.truth();this.result={reason:'time-limit',kind:this.child?.kind||'timed',time:this.world.time,truth:{x:t.x,y:t.y,heading:t.heading*DEG},violations:[...(this.violations||[])]};this.emit({type:'run',state:'auto-time-limit',result:this.result});}
    this.stopProgram('Practice phase ended.');const r=this.world.robots[0];r.vel={x:0,y:0};r.angVel=0;this.practiceInputAt=-Infinity;
    if(change.to==='teleop'){this.mode='manual';this.estimate=null;this.follower=null;this.telemetry=null;}
    if(change.to==='finished'){this.playing=false;this.emit({type:'run',state:'practice-finished',result:this.result});}
    this.emit({type:'practice',...practice.snapshot()});this.emitFrame(true);
  }
  async run(program={}){
    if(!this.world)throw Error('Load the simulation first.');
    if(!planner.safePose(this.config.start,[],this.info.footprint,this.info.bounds))throw Error('The starting robot footprint must fit inside this field. Change the field size, robot size or starting pose.');
    // 'opmode': exported code and its hardware adapter run on FTC SDK stand-ins.
    // 'motionmodule': an exported autonomous.py on MotionModule's real runtime (development check;
    // needs Python and the MotionModule source, see tools/simulation/motionmodule-bridge.py).
    const kind=['source','opmode','motionmodule'].includes(program.kind)?program.kind:'route';
    if(kind==='motionmodule'&&(typeof program.source!=='string'||!program.source.trim()||!program.python||!program.motionModule))throw Error('The virtual MotionModule needs autonomous.py, Python and the MotionModule source.');
    // Extra libraries for exported team code (Pedro Pathing, from tools/simulation/fetch-pedro.cjs): only
    // jars this checkout downloaded into its own .cache folder.
    const cache=path.resolve(__dirname,'../.cache')+path.sep,extra=kind==='opmode'&&Array.isArray(program.classpath)?program.classpath.map(f=>path.resolve(String(f))):[];
    if(extra.some(f=>!f.startsWith(cache)||!f.endsWith('.jar')||!fs.existsSync(f)))throw Error('Extra libraries must be jars in this checkout’s .cache folder.');
    let hub=null;
    if(kind==='opmode'){
      if(!program.files||typeof program.files!=='object'||typeof program.opMode!=='string')throw Error('Export the Control Hub files first.');
      const size=Object.values(program.files).reduce((s,v)=>s+(typeof v==='string'?v.length:Infinity),0);if(size>400000)throw Error('TeamCode files are limited to 400 KB.');
      if(!['mecanum','tank'].includes(config.drives[this.config.robot.drivetrain].engine))throw Error('The virtual Control Hub runs mecanum and tank-style drivetrains; choose one of those robots.');
      hub={...Ftc.hardware(this.config.robot,this.config.sensors.localization),files:program.files,opmode:program.opMode};if(this.config.mechanisms.enabled)hub.mechanisms=Ftc.mechanismHardware(this.config.mechanisms);
      // The robot's own moving parts and its sensors, fed from the simulated joints (see hubKinematics).
      const parts=hubKinematics(this.config.kinematics,this.config.robot),sensed=hubSensors(this.config.robot,this.config.kinematics,this.config.mechanisms,this.config.sensors.localization);
      if(parts.length)hub.kinematics=parts;if(sensed.length)hub.sensors=sensed;hub.modules=hubModules(this.config.robot);
    }
    if(kind==='route'&&!program.route?.segments?.length)throw Error('Plan a route first.');
    const timed=kind==='route'&&!config.sensors[this.config.sensors.localization].translation;
    if(kind==='source'&&!config.sensors[this.config.sensors.localization].translation)throw Error('IMU-only sensing cannot measure X/Y for this Deck Java program. Run the timed planned route, or select odometry in the FTC setup.');
    if(kind==='route'&&!config.drives[this.config.robot.drivetrain].holonomic&&!program.route.effects)program={...program,route:planner.tankRoute(program.route,this.zones.concat(this.info.fieldZones),this.info.footprint,this.info.bounds)};
    if(kind==='source'&&(typeof program.source!=='string'||!program.source.trim()))throw Error('Choose a Java program first.');
    if(kind==='source'&&program.source.length>200000)throw Error('Program source is limited to 200 KB.');
    this.stopProgram('Restarted.');this.build();this.violations=new Set();this.contacts=[];this.contactEvents=new Set();
    if(timed){this.timed=new Timed.Runner(program.route,this.config.timing);this.mode='timed';this.estimate=null;this.follower=null;this.emit({type:'run',state:'starting',kind:'timed'});this.emit({type:'run',state:'running',kind:'timed'});this.play();return {ok:true,program:'Timed power + IMU heading hold'};}
    // Java ships beside the app in releases (runtime-java, per platform) and inside sim-runtime in local builds.
    const bin=process.platform==='win32'?'java.exe':'java',seq=++this.runSeq,java=[path.join(this.runtimeDir,'java/bin',bin),path.join(this.runtimeDir,'../../runtime/java/bin',bin),path.join(this.runtimeDir,'../../runtime-java/bin',bin)].find(f=>fs.existsSync(f))||path.join(this.runtimeDir,'java/bin',bin);
    if(kind!=='motionmodule'&&!fs.existsSync(java))throw Error('The simulator Java runtime is missing. Rebuild with tools/simulation/build.cjs.');
    const dir=path.join(this.workDir,`run-${process.pid}-${++runFolders}`);fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
    const cp=[path.join(this.runtimeDir,'driver/classes'),path.join(this.runtimeDir,'driver/gson.jar'),...extra].join(path.delimiter);
    const child=kind==='motionmodule'?spawn(program.python,['-I','-u',path.join(__dirname,'../tools/simulation/motionmodule-bridge.py')],{cwd:dir,stdio:['pipe','pipe','pipe'],windowsHide:true})
      :spawn(java,['-Xmx256m','-Xss4m','-XX:+UseSerialGC','-XX:TieredStopAtLevel=1','-Dfile.encoding=UTF-8','-cp',cp,'deck.sim.RunBridge'],{cwd:dir,stdio:['pipe','pipe','pipe'],windowsHide:true});
    const bridge={child,seq,dir,buffer:'',stderr:'',waiters:[],exited:false,started:this.now(),kind,ticks:0,parts:hub?.kinematics||null,sensed:hub?.sensors||null};this.child=bridge;
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{bridge.buffer+=chunk;if(bridge.buffer.length>1<<20){this.fail('Program output exceeded the protocol limit.',seq);return;}let i;while((i=bridge.buffer.indexOf('\n'))>=0){const line=bridge.buffer.slice(0,i);bridge.buffer=bridge.buffer.slice(i+1);let msg;try{msg=JSON.parse(line);}catch{this.fail('The Deck bridge sent an unreadable reply.',seq);return;}const w=bridge.waiters.shift();if(w)w.resolve(msg);}});
    child.stderr.on('data',chunk=>{if(bridge.stderr.length<20000)bridge.stderr+=chunk;});
    child.on('error',e=>{bridge.exited=true;for(const w of bridge.waiters.splice(0))w.reject(Error('Java could not start: '+e.message));});
    child.on('exit',code=>{bridge.exited=true;for(const w of bridge.waiters.splice(0))w.reject(Error(`The Deck process exited (code ${code}).${bridge.stderr?' '+bridge.stderr.trim().slice(-500):''}`));});
    child.stdin.on('error',()=>{});
    const t=this.truth(),route=program.route?.segments?.length?{heading:program.route.heading/DEG,turns:!!(program.route.turns||program.route.nonholonomic||program.route.segments.some(s=>finite(s.heading))),segments:program.route.segments,stops:(program.route.stops||[]).map(s=>({x:s.x,y:s.y,wait:finite(s.wait)?Math.max(0,s.wait):0,action:typeof s.action==='string'?s.action.slice(0,400):'',segment:Number.isInteger(s.segment)?s.segment:-1}))}:null;
    // The leg plan every export shares: where the robot stops, turns at pins and runs action paths.
    const legPlan=route?Export.legs(program.route):null;this.legPaths=legPlan?.map(l=>l.path)??null;this.legSeconds=legPlan?.map(l=>({pin:l.actionSeconds,moving:l.moving?.seconds??null}))??null;this.legCells=legPlan?.map(l=>({pin:l.cell||0,moving:l.moving?.cell||0}))??null;this.legSteps=legPlan?.map(l=>({pin:l.steps,moving:l.moving?.steps??null}))??null;
    if(route){let last=-1;route.legs=Export.legs(program.route).map(l=>{last+=l.segments.length;return {last,power:l.power??this.info.tuning.maxPathSpeed,wait:Math.max(0,l.wait||0),action:String(l.action||'').slice(0,400),actionSeconds:finite(l.actionSeconds)?l.actionSeconds:null,movingSeconds:finite(l.moving?.seconds)?l.moving.seconds:null,path:l.path,moving:String(l.moving?.action||(l.moving?'Action path':'')).slice(0,400),heading:finite(l.heading)?l.heading:program.route.heading,turn:finite(l.turn)?l.turn:null};});}
    // The parts and sensors as the program starts, so init() reads them and zeroes encoders there.
    if(hub&&(bridge.parts||bridge.sensed))hub.state={...(bridge.parts?{kin:this.partState(bridge.parts)}:{}),...(bridge.sensed?{sensors:this.hubReadings(bridge.sensed)}:{})};
    const init={type:'init',workDir:dir,program:kind==='source'?{kind,source:program.source}:kind==='opmode'?{kind,hub}:kind==='motionmodule'?{kind,source:program.source,actions:typeof program.actions==='string'?program.actions:'',motionModule:program.motionModule,deps:program.deps||'',...(this.config.mechanisms.enabled?{mechanisms:MotionModule.mechanismHardware(this.config.mechanisms)}:{})}:{kind},start:{x:t.x,y:t.y,heading:t.heading},route,
      drive:{kind:config.drives[this.info.robot.drivetrain].engine,halfLength:this.info.robot.length/2,halfWidth:this.info.robot.width/2},tuning:this.info.tuning};
    this.mode='program';this.playing=false;this.result=null;this.emit({type:'run',state:'starting',kind});this.emitFrame(true);
    let ready;try{ready=await this.request(bridge,init,30000,'Compiling and starting the program');}catch(e){if(seq===this.runSeq)this.fail(e.message,seq);return {ok:false,error:e.message};}
    if(seq!==this.runSeq)return {ok:false,error:'Stopped.'};
    if(ready.type==='error'){this.fail(this.describe(ready),seq,ready);return {ok:false,error:this.describe(ready)};}
    this.emit({type:'run',state:'running',kind,program:ready.program,log:ready.log});this.play();return {ok:true,program:ready.program};
  }
  request(bridge,message,timeout,what){
    return new Promise((resolve,reject)=>{
      if(bridge.exited)return reject(Error('The Deck process is not running.'));
      const waiter={resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}};
      const timer=setTimeout(()=>{const i=bridge.waiters.indexOf(waiter);if(i>=0)bridge.waiters.splice(i,1);reject(Error(`${what} took longer than ${timeout/1000} s. The program may be stuck in a loop or waiting; loop() must return every tick.`));},timeout);
      bridge.waiters.push(waiter);const line=JSON.stringify(message);if(line.length>1<<20)return waiter.reject(Error('Program message too large.'));
      bridge.child.stdin.write(line+'\n');
    });
  }
  async programTick(){
    const bridge=this.child;if(!bridge||bridge.seq!==this.runSeq){this.mode='idle';return;}
    const steps=this.mechAct&&this.legSteps?.[this.mechAct.leg]?.[this.mechAct.moving?'moving':'pin'],jointBusy=steps?false:this.routeJoints(this.mechAct);
    // A list of steps: the runner runs them in turn (at a pin) or together (on a path), moving parts included.
    if(steps&&bridge.kind!=='opmode'&&bridge.kind!=='motionmodule'){const next=this.mechRunner.commands({...this.mechAct,path:this.legPaths?.[this.mechAct.leg],steps},this.mech.state(),this.world.time);
      if(this.config.mechanisms.enabled){this.mechCmd=next.cmd;this.mechCell=next.cell==='other'||next.cell===1?'other':'start';}this.mechBusy=next.busy;}
    // Mechanisms: a route names its active action; exported code drives its mechanism motors and servos.
    else if(this.config.mechanisms.enabled){
      if(bridge.kind==='opmode'||bridge.kind==='motionmodule'){
        // MotionModule zeroes every motor for a few milliseconds when a drive wheel reverses (dead time);
        // a spinning flywheel or indexer barely notices, so its outputs count as on for 0.12 s after.
        const d=this.mechDevices||{},now=this.world.time,latch=this.mechLatch||(this.mechLatch={}),on=(key,active)=>{if(active)latch[key]=now;return bridge.kind==='motionmodule'?now-(latch[key]??-Infinity)<=.12:active;};
        // Commands are signed after each device's mounting: a roller or feeder running backwards spits pieces out, so only
        // a forward command takes pieces in or feeds the shooter.
        this.mechCmd={intake:on('intake',(d.intake||0)>.2),spin:on('spin',(d.flywheel||0)>.2),feed:on('feed',(d.indexer||0)>.2),aim:finite(d.turretDeg)||Array.isArray(d.turretDegs),turretDeg:finite(d.turretDeg)?d.turretDeg:undefined,turretDegs:Array.isArray(d.turretDegs)?d.turretDegs:undefined,...(typeof d.ramp==='number'?{ramp:d.ramp>.5}:{})};this.mechBusy=false;}
      else{this.mechCell=this.mechAct&&this.legCells?.[this.mechAct.leg]?.[this.mechAct.moving?'moving':'pin']?'other':'start';const next=this.mechRunner.commands(this.mechAct&&{...this.mechAct,path:this.legPaths?.[this.mechAct.leg],seconds:this.legSeconds?.[this.mechAct.leg]?.[this.mechAct.moving?'moving':'pin']},this.mech.state(),this.world.time);this.mechCmd=next.cmd;this.mechBusy=next.busy||jointBusy;}
    }
    const reading=this.tick(this.command),seq=bridge.seq;bridge.ticks++;
    const msg={type:'tick',seq:bridge.ticks,t:this.world.time,dt:this.dsim.SIM_DT,odo:reading.odo,imu:reading.imu,mech:this.mechanismState()??(jointBusy?{busy:true}:null),...(bridge.parts?{kin:this.partState(bridge.parts)}:{}),...(bridge.sensed?{sensors:this.hubReadings(bridge.sensed)}:{}),...(bridge.kind==='opmode'&&this.gamepads?{gamepad1:this.gamepads[1]||{},gamepad2:this.gamepads[2]||{}}:{})};
    // The first ticks include JIT warm-up; later ticks must return promptly.
    let reply;try{reply=await this.request(bridge,msg,bridge.ticks<30?5000:750,'One loop() call');}catch(e){this.fail(e.message,seq);return;}
    if(seq!==this.runSeq)return; // stopped while waiting: discard the stale reply
    if(reply.type==='error'){this.fail(this.describe(reply),seq,reply);return;}
    const d=reply.drive||{},n=v=>finite(v)?clamp(v,-1,1):0;this.command={forward:n(d.forward),strafe:n(d.strafe),turn:n(d.turn),float:d.float===true};
    this.estimate=reply.estimate;this.follower=reply.follower;this.telemetry=reply.telemetry;this.waiting=reply.wait||null;this.mechAct=reply.act||null;this.mechDevices=reply.mech||null;this.hubDevices=reply.devices||null;if(bridge.parts&&reply.kin)this.driveParts(reply.kin);
    if(reply.log?.length)this.emit({type:'log',lines:reply.log.slice(-60)});
    if(reply.done)this.finish(seq);
  }
  // Where each motor-driven part of the robot's own design is ({id: [value, value a second]}), for its motor's encoder.
  partState(parts){const out={};for(const p of parts){const axis=p.type==='motor'&&this.kin.axes.get(p.id);if(axis)out[p.id]=[+axis.q.toFixed(6),+axis.v.toFixed(6)];}return out;}
  // What the code on the virtual hub tells each part: a joint value (a servo's position; a motor's RUN_TO_POSITION target,
  // at the speed its power allows), a speed or a power. A command a part already has is not sent again, so a move runs
  // its course.
  driveParts(cmds){const last=this.partCmds||(this.partCmds={});
    for(const [id,c] of Object.entries(cmds)){const axis=this.kin.axes.get(id);if(!axis||!c||typeof c!=='object')continue;const key=JSON.stringify(c);if(last[id]===key)continue;last[id]=key;
      if(finite(c.value))axis.to(c.value,axis.response==='ideal'&&finite(c.power)&&c.power>0&&c.power<1?{speed:axis.speed*c.power}:{});else if(finite(c.velocity))axis.spin(c.velocity);else if(finite(c.power))axis.push(c.power);}}
  // Each hub sensor's reading now ({name: reading}): an analog port's volts, a switch closed or not, a distance in mm
  // (null: nothing in range), a color sensor's color (0–1 a channel) and distance, an encoder's [counts, counts a second].
  hubReadings(list){const out={};for(const s of list)out[s.name]=this.hubReading(s);return out;}
  hubReading(s){const src=s.source||{},sign=s.inverted?-1:1;
    if(src.piece){const seen=this.pieceAt(src),near=finite(s.near)?s.near:20;
      if(s.type==='digital'||s.type==='touch')return !!seen;if(s.type==='analog')return seen?Kin.VOLTS:0;if(s.type==='distance')return seen?near:null;
      if(s.type==='color')return {mm:seen?near:finite(s.far)?s.far:120,...PIECE_COLOR[seen&&PIECE_COLOR[seen]?seen:seen?'green':'none']};return null;}
    const m=Number.isInteger(src.turret)?(finite(this.mech?.turrets?.[src.turret])?{value:this.mech.turrets[src.turret],velocity:0,unit:'deg'}:null):this.kin.measure(src);
    if(s.type==='digital'||s.type==='touch')return m?Kin.reading('limit',m.value,s):false;if(!m)return null;
    if(s.type==='analog')return Kin.reading('analog',m.value,{unit:m.unit,...s});
    if(s.type==='encoder'){const per=finite(s.countsPerUnit)?s.countsPerUnit:(finite(s.cpr)?s.cpr:8192)/(m.unit==='in'?1:360);return [sign*Math.round(m.value*per),sign*m.velocity*per];}
    // A distance sensor along a part's travel: zeroMm where the CAD has it, mmPerUnit further a unit (out of range past 2 m).
    const mm=(finite(s.zeroMm)?s.zeroMm:50)+(finite(s.mmPerUnit)?s.mmPerUnit:m.unit==='in'?25.4:0)*m.value,seen=mm>=0&&mm<=2000?mm:null;
    return s.type==='color'?{mm:seen,...PIECE_COLOR.none}:seen;}
  // The game piece a piece sensor sees (its color), or null: at a shooter, the next piece it shoots while one is held;
  // at an intake, the last piece in once the robot is full (count: pieces held to see one instead).
  pieceAt(src){const m=this.config.mechanisms,r=this.world?.robots?.[0];if(!m.enabled||!Array.isArray(r?.hopper))return null;
    const nectar=c=>c==='red'||c==='blue',takes=src.piece==='shooter'?m.shooters[src.index||0]?.pieces||'pollen':'both',held=r.hopper.filter(c=>takes==='both'||(takes==='nectar')===nectar(c));
    const need=finite(src.count)?src.count:src.piece==='shooter'?1:Math.max(1,(m.capacity?.pollen||0)+(m.capacity?.nectar||0));
    return held.length>=need?(src.piece==='shooter'?held[0]:held.at(-1)):null;}
  // Gamepad 1 or 2 for team code on the virtual Control Hub (a TeleOp such as the guided check): FTC gamepad fields
  // (a, b, dpad_up, left_stick_y, ...). null releases every button and stick.
  setGamepad(user,state){if(user!==1&&user!==2)return;this.gamepads={...this.gamepads,[user]:state&&typeof state==='object'?{...state}:{}};}
  finish(seq){
    if(seq!==this.runSeq)return;
    // A program can end while the robot still rolls (timed driving cuts power early so the robot
    // coasts onto the pin). Record where it comes to rest, as a real robot would be measured.
    for(let i=0;i<120;i++){const r=this.truth();if(Math.hypot(r.vx,r.vy)<.5&&Math.abs(r.omega)<.02)break;this.command={...ZERO};this.tick(this.command);}
    const t=this.truth();
    this.result={reason:'finished',kind:this.timed?'timed':this.child?.kind,time:this.world.time,truth:{x:t.x,y:t.y,heading:t.heading*DEG},estimate:this.estimate&&{x:this.estimate.x,y:this.estimate.y,heading:this.estimate.heading*DEG},violations:[...(this.violations||[])],mechanisms:this.mechanismState()};
    this.stopProgram();this.emit({type:'run',state:'finished',result:this.result});this.emitFrame(true);
  }
  timedTick(){const runner=this.timed;if(!runner)return;const reading=this.tick(this.command),mech=this.config.mechanisms.enabled;let held=false;
    // A pin's mechanism action holds the timed robot until it finishes, like the exported MotionModule code.
    const hold=(step,index)=>{const act={name:step.action,leg:index,moving:false,...(step.steps?{steps:step.steps}:{})},joints=step.steps?false:this.routeJoints(act);held=true;if(!mech&&!step.steps)return joints;this.mechCell=step.cell==='other'?'other':'start';const next=this.mechRunner.commands(act,this.mech.state(),this.world.time);if(mech){this.mechCmd=next.cmd;if(next.cell)this.mechCell=next.cell;}this.mechBusy=next.busy||joints;return this.mechBusy;};
    const next=runner.advance(this.dsim.SIM_DT,reading.imu,hold);
    const moving=next.acting?{name:next.acting,leg:next.segment,path:'timed:'+next.acting,moving:true,...(next.actingSteps?{steps:next.actingSteps}:{})}:null;
    if(!held&&!moving?.steps)this.routeJoints(moving);
    if((mech||moving?.steps)&&!held){this.mechCell=next.acting&&next.actingCell==='other'?'other':'start';const r=this.mechRunner.commands(moving,this.mech.state(),this.world.time);if(mech){this.mechCmd=r.cmd;if(r.cell)this.mechCell=r.cell;}this.mechBusy=false;}this.command=next.drive;this.waiting=next.wait;this.acting=next.acting||null;this.follower={pathIndex:next.segment||0};this.estimate=null;if(next.done)this.finish(this.runSeq);}
  describe(reply){const where={compile:'Compile error',load:'Could not load the program',init:'init() failed',loop:'loop() failed',bridge:'Deck bridge error'}[reply.stage]||'Program error';return `${where}: ${reply.message}`;}
  fail(message,seq=this.runSeq,reply){
    if(seq!==this.runSeq)return;this.stopProgram();this.playing=false;this.practice=null;
    this.emit({type:'run',state:'error',error:message,trace:reply?.trace||[],diagnostics:reply?.trace||[],log:reply?.log||[]});this.emitFrame(true);
  }
  // Ends any program: invalidates pending replies, kills the Java process and zeroes the drive.
  stopProgram(reason){
    const bridge=this.child;this.runSeq++;this.child=null;this.timed=null;this.command={...ZERO};this.manualInput=null;this.waiting=null;this.acting=null;this.mechAct=null;this.mechDevices=null;this.mechBusy=false;if(this.mechCmd)this.mechCmd={intake:false,spin:false,aim:false,feed:false};
    if(['program','manual','timed'].includes(this.mode))this.mode='idle';
    if(bridge){for(const w of bridge.waiters.splice(0))w.reject(Error(reason||'Stopped.'));try{bridge.child.stdin.end(JSON.stringify({type:'stop'})+'\n');}catch{}try{bridge.child.kill();}catch{}setTimeout(()=>{try{fs.rmSync(bridge.dir,{recursive:true,force:true});}catch{}},2000).unref?.();}
  }
  stop(){const running=!!this.child||!!this.timed||!!this.practice;this.practice=null;this.playing=false;this.stopProgram('Stopped.');if(this.world){this.world.robots[0].vel={x:0,y:0};this.world.robots[0].angVel=0;}if(running)this.emit({type:'run',state:'stopped'});this.emitFrame(true);}
  // quiet: a practice run starting resets without telling the window the run is over.
  reset(quiet=false){this.practice=null;this.stopProgram('Reset.');this.playing=false;this.build();this.violations=new Set();this.contacts=[];this.contactEvents=new Set();this.estimate=null;this.follower=null;this.telemetry=null;if(!quiet)this.emit({type:'run',state:'reset'});this.emitFrame(true);}
  setZones(zones){this.zones=Array.isArray(zones)?zones.slice(0,24).map(z=>{try{return planner.validateZone(z);}catch{return null;}}).filter(Boolean):[];this.lastLoad={...this.lastLoad,zones:structuredClone(this.zones)};if(this.world){if(this.world.game==='biobuzz')this.dsim.disposePhysics3dFor(this.world);this.applyBarriers();}}
  setStart(start){if(!start||![start.x,start.y,start.heading].every(finite))throw Error('Invalid start pose.');if(this.practice||this.timed)this.stop();this.config.start={...start};this.lastLoad={...this.lastLoad,start:{...start}};if(this.mode!=='program'){this.playing=false;this.build();this.emitFrame(true);}}

  // Test-drive candidate routes on fresh, headless copies of this simulation (same field, robot,
  // sensors and follower) as fast as the CPU allows. Nothing here moves the visible robot.
  async evaluate(candidates,progress=()=>{}){
    if(!this.lastLoad)throw Error('Load the simulation first.');
    if(!Array.isArray(candidates)||!candidates.length||candidates.length>6)throw Error('Give 1 to 6 routes to compare.');
    const results=[],request=structuredClone(this.lastLoad);
    for(let i=0;i<candidates.length;i++){
      progress(i,candidates.length);
      let failure='';const trial=new SimEngine({runtimeDir:this.runtimeDir,workDir:path.join(this.workDir,'trial'),now:()=>0,emit:m=>{if(m.type==='run'&&m.state==='error')failure=m.error;}});
      try{
        await trial.load(request);const started=await trial.run({kind:'route',route:candidates[i]});
        if(!started.ok){results.push({ok:false,error:started.error});continue;}
        for(let guard=0;['program','timed'].includes(trial.mode)&&guard<3600;guard++)if(trial.mode==='timed')trial.timedTick();else await trial.programTick();
        const r=trial.result;results.push(r?{ok:true,time:r.time,violations:r.violations.length,truth:r.truth}:{ok:false,error:['program','timed'].includes(trial.mode)?'Did not finish within 60 s.':failure||'The test drive stopped early.'});
      }catch(e){results.push({ok:false,error:e.message});}finally{trial.dispose();}
    }
    return results;
  }

  // ---------------------------------------------------------------- frames
  frame(){
    const t=this.truth();
    return {type:'frame',time:this.world.time,tick:this.world.tick,mode:this.mode,playing:this.playing,speed:this.speed,
      truth:{x:t.x,y:t.y,heading:t.heading*DEG,vx:t.vx,vy:t.vy,omega:t.omega*DEG,z:t.z},command:this.command,
      estimate:this.estimate?{x:this.estimate.x,y:this.estimate.y,heading:this.estimate.heading*DEG}:null,
      follower:this.follower||null,telemetry:this.telemetry||null,contacts:this.contacts||[],contactEvents:this.contactEvents?.size||0,hit:this.hit||[],violations:[...(this.violations||[])],result:this.result,wait:this.waiting||null,acting:this.acting||null,practice:this.practice?.snapshot()||null,execution:this.timed?'timed':this.child?'deck':null,mechanisms:this.mechanismState(),joints:this.kin?.model.joints.length?this.kin.values():null,
      modules:config.drives[this.config.robot.drivetrain]?.engine==='swerve'&&Array.isArray(this.world.robots[0].moduleAngles)?this.world.robots[0].moduleAngles.slice(0,4):null,
      fieldState:{game:this.config.field,time:this.world.time,tick:this.world.tick,balls:this.world.balls.map(b=>({...b,pos:{...b.pos},state:{...b.state}})),robots:[],biobuzz:this.world.biobuzz?structuredClone(this.world.biobuzz):undefined}};
  }
  emitFrame(force=false){if(!this.world)return;const now=this.now();if(!force&&now-this.lastFrame<FRAME_MS)return;this.lastFrame=now;this.emit(this.frame());}
  dispose(){this.stopProgram('Closed.');this.playing=false;if(this.timer)clearInterval(this.timer);this.timer=null;if(this.world?.game==='biobuzz')this.dsim.disposePhysics3dFor(this.world);this.world=null;}
}
module.exports={SimEngine,FIELDS,LOCALIZATION,OFFSET,sensorConfig,robotConfig,hubKinematics,hubSensors};
