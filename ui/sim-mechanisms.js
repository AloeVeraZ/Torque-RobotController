(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckMechanisms=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // The robot's game-piece mechanisms as parts: intakes (each covering one or more sides of the
  // robot), up to two shooters (a turret or a fixed shooter, each fed pollen, nectar or both; two may ride one turret), how
  // many of each piece the robot can hold, and the pollen it starts with. One timing model is shared
  // by the simulator, the generated Control Hub Java and MotionModule Python, so a route that works
  // in the simulator runs the same way on the robot.
  const finite=n=>typeof n==='number'&&Number.isFinite(n),clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),num=(v,d,a,b)=>finite(v)?clamp(v,a,b):d;
  // A device name as the robot configuration has it (letters, digits, spaces, _ . -); anything else keeps the default.
  const name=(v,d)=>typeof v==='string'&&/^[A-Za-z][\w .-]{0,39}$/.test(v.trim())?v.trim():d;
  const pick=(v,options,d)=>Object.hasOwn(options,v)?v:d;
  const INTAKES={sweeper:'Sweeper roller',siderollers:'Side rollers',ramp:'Deployable ramp',kicker:'Kicker'};
  // What each intake is and what it can reach (BIOBUZZ, from the game physics).
  const INTAKE_NOTES={sweeper:'A spinning roller across the robot’s edge that sweeps pieces off the floor into the robot. Cannot reach into a flower.',siderollers:'Two rollers that grip pieces from the sides; can also reach into a flower and pull out its bottom pollen.',ramp:'Sweeper rollers with a ramp that a servo folds down in front of the robot. The rollers take pieces off the floor with the ramp up or down; once it is down it wedges under a flower’s bottom pollen too. It moves only on Ramp down and Ramp up steps in your route, and stays where it was sent.',kicker:'An arm on a servo that swings down in front of the robot, scoops under pieces and swings back up to carry them in. It only picks up once it is all the way down; pieces move on into storage after it is back up.'};
  const EDGES=['front','back','left','right'];
  // Older saves describe one intake by a mount name; these are its sides.
  const SIDES={front:'Front',back:'Back',frontback:'Front and back',side:'Both sides',all:'All the way around'};
  const SIDE_EDGES={front:['front'],back:['back'],frontback:['front','back'],side:['left','right'],all:['front','back','left','right']};
  const SHOOTERS={turret:'Turret · aims itself',fixed:'Fixed · the robot turns to aim',none:'No shooter'};
  const SHOOTER_NOTES={turret:'A flywheel on a turntable: it turns by itself to point at the hive, so the robot can face any way.',fixed:'A flywheel fixed to the frame: it fires one way, so Shoot pins turn the robot to face the hive.'};
  const PIECES={pollen:'Pollen',nectar:'Nectar',both:'Pollen and nectar'};
  const MOUNTS={frontleft:'Front left',front:'Front',frontright:'Front right',left:'Left',center:'Center',right:'Right',backleft:'Back left',back:'Back',backright:'Back right'};
  // Where a mount sits on the chassis, as fractions of half-length (forward) and half-width (left).
  const MOUNT_AT={frontleft:[1,1],front:[1,0],frontright:[1,-1],left:[0,1],center:[0,0],right:[0,-1],backleft:[-1,1],back:[-1,0],backright:[-1,-1]};
  // The direction a fixed shooter fires, in degrees from the robot's front (counterclockwise).
  const FACING={front:0,left:90,back:180,right:-90};
  // Two shooters cannot share a cell of the 3×3 map or sit in neighbouring cells; the second moves to
  // the first one's partner across the robot (the game physics' own rule for two launchers).
  const PARTNER={front:'back',back:'front',left:'right',right:'left',frontleft:'backright',backright:'frontleft',frontright:'backleft',backleft:'frontright',center:'back'};
  const ORDER=Object.keys(MOUNT_AT),adjacent=(a,b)=>{const i=ORDER.indexOf(a),j=ORDER.indexOf(b);return Math.abs(Math.floor(i/3)-Math.floor(j/3))<=1&&Math.abs(i%3-j%3)<=1;};
  // The hardware each part runs on, for the exported robot code. A feeder (indexer) moves pieces into the shooter:
  // a motor or continuous servo runs while shooting, a servo pusher swings to its feed position for each shot and
  // back, and a servo gate opens while shooting.
  const INDEXERS={motor:'Motor',crservo:'Continuous servo',pusher:'Servo pusher',gate:'Servo gate'};
  const INDEXER_NOTES={motor:'A roller or belt on a DC motor runs while the robot shoots.',crservo:'A roller or belt on a continuous rotation servo runs while the robot shoots.',
    pusher:'A servo swings to its feed position to push each piece into the flywheel, then back to rest while the next piece drops in.',gate:'A servo opens to its feed position while the robot shoots, letting pieces through, and closes after.'};
  const ROLLERS={motor:'DC motor',crservo:'Continuous servo'};
  const FLYWHEELS={velocity:'Velocity control (encoder)',power:'Set power (no encoder)'};
  const TURRETS={motor:'Motor with encoder',servo:'Servo',crservo:'Continuous servo + its feedback wire'};
  const servoFeeder=kind=>kind==='pusher'||kind==='gate';
  // BIOBUZZ robots hold at most 4 pieces (pollen and nectar together) and start with up to 4 pollen.
  const STORAGE_MAX=4,FIRE_RECOVERY=.25,MAX_SHOOTERS=2;
  const DEFAULTS={enabled:false,
    intakes:[{kind:'sweeper',sides:['front'],reach:0,width:null,height:4,motor:'intake',power:1}],intake:{reach:0,height:4},
    shooters:[{type:'turret',pieces:'pollen',mount:'center',facing:'front',motor:'shooter',indexer:'indexer',indexerKind:'motor',turretMotor:'turret'}],
    capacity:{pollen:4,nectar:0},preload:{pollen:4},
    // transfer: from a piece touching the intake to sitting in the shooter, ready (an empty robot).
    // indexer: moving the next piece up into the shooter after a shot; a servo pusher stays at its feed position for pushSeconds.
    transfer:{seconds:1},indexer:{seconds:.35,power:1,pushSeconds:.15},
    // control: velocity (an encoder on the flywheel, at speed within tolerance) or power (no encoder, timed spin-up).
    shooter:{hood:75,rpm:3000,ticksPerRev:28,spinUp:.8,control:'velocity',power:1,tolerance:.05},
    // kind: a motor with an encoder (ticksPerDegree), a servo (servoCenter faces the front; servoDegrees from position 0 to 1)
    // or a continuous servo steered by its feedback wire (an Axon in continuous mode).
    turret:{speed:240,min:-170,max:170,ticksPerDegree:4.6,kind:'motor',servoCenter:.5,servoDegrees:300},
    target:null};
  // Calibrated hood angles by flywheel speed (Calibrate → Mechanisms): each point is an RPM, the hood angle (degrees,
  // within the game's 70-85) that lands a shot at that speed and optionally the hood servo's position there. Sorted by
  // RPM, one point per RPM, 8 at most; null without a point.
  const hoodMap=v=>{if(!Array.isArray(v))return null;const seen=new Set(),out=[];
    for(const p of v){if(!p||!finite(p.rpm)||!finite(p.deg))continue;const rpm=Math.round(clamp(p.rpm,100,6000));if(seen.has(rpm))continue;seen.add(rpm);out.push({rpm,deg:+clamp(p.deg,70,85).toFixed(2),...(finite(p.pos)?{pos:+clamp(p.pos,0,1).toFixed(4)}:{})});}
    out.sort((a,b)=>a.rpm-b.rpm);return out.length?out.slice(0,8):null;};
  // The hood angle (and servo position, when the points have one) for a flywheel speed: between two points it is
  // interpolated, past the ends it holds the end point. Without points it is the fixed hood angle.
  function hoodAt(m,rpm){const s=m.shooter,map=s.hoodMap;if(!map)return {deg:s.hood,pos:null};const r=finite(rpm)?rpm:s.rpm;
    const lo=[...map].reverse().find(p=>p.rpm<=r)||map[0],hi=map.find(p=>p.rpm>=r)||map[map.length-1],f=hi.rpm>lo.rpm?(r-lo.rpm)/(hi.rpm-lo.rpm):0,mix=(a,b)=>a+(b-a)*f;
    return {deg:+mix(lo.deg,hi.deg).toFixed(2),pos:finite(lo.pos)&&finite(hi.pos)?+mix(lo.pos,hi.pos).toFixed(4):null};}
  // How far below its target speed (0..1 of it) the flywheel may be and still fire: within the tolerance, or with a
  // calibrated hood down to the slowest speed it has a point for (the hood makes up for the lower speed).
  const readyAt=m=>{const s=m.shooter,floor=1-(s.tolerance??.05);return s.hoodMap&&s.hoodMap.length>1?Math.min(floor,s.hoodMap[0].rpm/s.rpm):floor;};
  // Velocity PIDF for the flywheel motors, or null for the SDK's own defaults.
  const pidf=v=>v&&typeof v==='object'&&['p','i','d','f'].every(k=>finite(v[k])&&v[k]>=0&&v[k]<=1000)?{p:v.p,i:v.i,d:v.d,f:v.f}:null;
  // Optional hardware fields are stored only when they differ from the plain setup, so older saves stay as they were.
  const flag=(key,on)=>on===true?{[key]:true}:{};
  // An intake's roller (not a kicker's): a DC motor or a continuous servo, an optional second roller, and which way each turns.
  const roller=raw=>{const second=name(raw.motor2,'');return {...(raw.device==='crservo'?{device:'crservo'}:{}),...flag('reversed',raw.reversed),...(second?{motor2:second,...flag('reversed2',raw.reversed2)}:{})};};
  const point=p=>p&&finite(p.x)&&finite(p.y)?{x:+p.x.toFixed(2),y:+p.y.toFixed(2),...(finite(p.z)?{z:+p.z.toFixed(2)}:{})}:null;
  // The CAD assemblies a part was set up from (names, as the Robot section lists them).
  const cadParts=v=>{const list=Array.isArray(v.parts)?v.parts.filter(p=>typeof p==='string'&&p.trim()).slice(0,8).map(p=>p.trim().slice(0,80)):[];return list.length?{parts:list}:{};};
  const takesNectar=s=>s.pieces!=='pollen',takesPollen=s=>s.pieces!=='nectar';
  // Intakes a servo moves down to pick up and back up after: a kicker, and a ramp.
  const deploys=kind=>kind==='kicker'||kind==='ramp';
  // The intake mount name the physics knows for a set of sides, or null when it is a custom mix.
  function mountOf(sides){const key=EDGES.filter(e=>sides.includes(e)).join(',');return {front:'front',back:'back','front,back':'frontback','left,right':'side','front,back,left,right':'all'}[key]||(key?null:'front');}
  function sanitize(raw){
    const r=raw&&typeof raw==='object'?raw:{},i=r.intake||{},x=r.indexer||{},s=r.shooter||{},t=r.turret||{};
    // Intakes. Older saves have one `intake` with a mount name.
    const intakeList=Array.isArray(r.intakes)?r.intakes:i.enabled===false?[]:[{kind:i.kind,sides:SIDE_EDGES[i.side]||['front'],reach:i.reach,motor:i.motor,power:i.power}];
    const used=new Set(),intakes=[];
    for(const raw of intakeList.slice(0,4)){if(!raw||typeof raw!=='object')continue;
      const sides=EDGES.filter(e=>(Array.isArray(raw.sides)?raw.sides:SIDE_EDGES[raw.side]||[]).includes(e)&&!used.has(e));if(!sides.length)continue;sides.forEach(e=>used.add(e));
      // Its box: how far it sticks out past the frame (pieces are taken at its outer face), how wide its
      // mouth is (null: the whole edge) and how tall its opening is (a taller piece does not fit).
      const n=intakes.length,kind=pick(raw.kind,INTAKES,'sweeper');intakes.push({kind,sides,reach:num(raw.reach,DEFAULTS.intake.reach,0,18),width:finite(raw.width)?clamp(raw.width,1,48):null,height:num(raw.height,DEFAULTS.intake.height,1,24),
        motor:name(raw.motor,n?`intake${n+1}`:'intake'),power:num(raw.power,1,.05,1),...(kind!=='kicker'?roller(raw):{}),...(point(raw.at)?{at:point(raw.at)}:{}),...cadParts(raw),
        // A kicker or a ramp moves on a servo: seconds to go down and back up, the servo, and its positions (0-1) down and up.
        // A ramp keeps its rollers (motor and power) too; the game physics folds a ramp down in 0.3 s.
        ...(raw.withFeeder===true?{withFeeder:true}:{}),...(deploys(kind)?{...(kind==='ramp'&&['linear','crservo','dcmotor'].includes(raw.rampKind)?{rampKind:raw.rampKind}:{}),down:num(raw.down,kind==='ramp'?.3:.4,0,3),up:num(raw.up,kind==='ramp'?.3:.4,0,3),servo:name(raw.servo,`${kind}${n?n+1:''}`),downPos:num(raw.downPos,0,0,1),upPos:num(raw.upPos,1,0,1),...(Number.isFinite(raw.travel)?{travel:num(raw.travel,90,1,360)}:{})}:{})});}
    // Shooters. Older saves have one `shooter` with a type (or 'none').
    const shooterList=Array.isArray(r.shooters)?r.shooters:s.type==='none'?[]:[{type:s.type,pieces:'pollen',mount:s.mount,facing:'front',motor:s.motor,indexer:x.name,indexerKind:x.kind,turretMotor:t.motor}];
    // hood: the servo that tilts the hood, by its configuration name (none: the hood is fixed).
    let shooters=shooterList.filter(v=>v&&typeof v==='object').slice(0,MAX_SHOOTERS).map((v,n)=>{const indexerKind=pick(v.indexerKind,INDEXERS,'motor'),second=name(v.motor2,''),hood=name(v.hood,'');
      return {type:v.type==='fixed'?'fixed':'turret',pieces:pick(v.pieces,PIECES,'pollen'),mount:pick(v.mount,MOUNTS,'center'),facing:pick(v.facing,FACING,'front'),
      motor:name(v.motor,n?'shooter2':'shooter'),indexer:name(v.indexer,n?'indexer2':'indexer'),indexerKind,turretMotor:name(v.turretMotor,n?'turret2':'turret'),...(v.turretMotor2?{turretMotor2:name(v.turretMotor2,n?'turret2b':'turretb')}:{}),...(hood?{hood}:{}),
      // The flywheel's motors (a second one for two-motor flywheels) and which way each turns; the feeder's direction, or
      // a servo feeder's positions; the turret's direction.
      ...flag('reversed',v.reversed),...(second?{motor2:second,...flag('reversed2',v.reversed2)}:{}),
      ...(servoFeeder(indexerKind)?{feedPos:num(v.feedPos,1,0,1),restPos:num(v.restPos,0,0,1)}:flag('indexerReversed',v.indexerReversed)),...flag('turretReversed',v.turretReversed),
      ...(point(v.at)?{at:point(v.at)}:{}),...cadParts(v),...(n&&v.sharesTurret===true?{sharesTurret:true}:{})};});
    const [one,two]=shooters;
    if(two?.sharesTurret&&one.type==='turret'&&two.type==='turret'){
      // Both flywheels on one turntable: the second rides the first one's turret, at its spot, turned by its motor.
      Object.assign(two,{mount:one.mount,turretMotor:one.turretMotor});delete two.at;delete two.turretReversed;if(one.at)two.at={...one.at};
    }else if(two){
      delete two.sharesTurret;
      // Two shooters on their own turrets (or fixed) cannot share a cell of the 3×3 map or sit next to each other,
      // and neither sits in the center (the game physics' rule for two launchers); the second moves to the first one's partner.
      if(one.mount==='center')one.mount='front';
      if(adjacent(one.mount,two.mount))two.mount=PARTNER[one.mount];
      // Two turrets need two turret motors (a second shooter that left the first one's turret still has its name).
      if(two.turretMotor===one.turretMotor)two.turretMotor=one.turretMotor==='turret2'?'turret':'turret2';
    }
    // Storage: pollen and nectar counted separately, 4 at most together. Nectar needs a shooter that takes it.
    const cap=r.capacity&&typeof r.capacity==='object'?r.capacity:{pollen:r.storage,nectar:0},nectarOk=shooters.some(takesNectar);
    const pollen=Math.round(num(cap.pollen,DEFAULTS.capacity.pollen,0,STORAGE_MAX)),nectar=nectarOk?Math.round(num(cap.nectar,0,0,STORAGE_MAX)):0;
    // Like the game, storage holds 4 pieces at most in any mix: each kind has its own limit, and together they stop at 4.
    const capacity=pollen+nectar?{pollen,nectar}:{pollen:1,nectar:0},storage=Math.min(STORAGE_MAX,capacity.pollen+capacity.nectar);
    const pre=r.preload&&typeof r.preload==='object'?r.preload.pollen:r.preload,preload={pollen:Math.round(num(pre,capacity.pollen,0,capacity.pollen))};
    const first=shooters[0],turret=shooters.find(v=>v.type==='turret'),sides=EDGES.filter(e=>used.has(e));
    // others: the CAD's motors and servos that power nothing modelled here (DeckHardware.cadOthers); they count against R503.
    const others=(Array.isArray(r.others)?r.others:[]).filter(o=>o&&typeof o.name==='string'&&['dcmotor','servo','crservo','linear'].includes(o.kind)).slice(0,16).map(o=>({name:o.name.slice(0,120),kind:o.kind,...(typeof o.model==='string'?{model:o.model}:{}),in:typeof o.in==='string'?o.in.slice(0,120):''}));
    // guessed: keys of devices the CAD does not show (DeckHardware.conflicts).
    const guessed=(Array.isArray(r.guessed)?r.guessed:[]).filter(k=>typeof k==='string').slice(0,32);
    // power: per device key, what the CAD's transmission shows: how many actuators turn it, and the parts of that train.
    const power=Object.fromEntries(Object.entries(r.power&&typeof r.power==='object'?r.power:{}).slice(0,64).filter(([,v])=>v&&Array.isArray(v.refs)).map(([k,v])=>[k,{refs:v.refs.filter(x=>typeof x==='string').slice(0,300),count:Math.max(1,Math.min(4,Math.round(+v.count||1)))}]));
    return {enabled:r.enabled===true,intakes,shooters,others,guessed,power,traced:r.traced===1?1:0,capacity,preload,storage,
      transfer:{seconds:num(r.transfer?.seconds,DEFAULTS.transfer.seconds,0,10)},
      indexer:{seconds:num(x.seconds,DEFAULTS.indexer.seconds,0,5),power:num(x.power,1,.05,1),kind:first?.indexerKind||'motor',name:first?.indexer||'indexer',pushSeconds:num(x.pushSeconds,DEFAULTS.indexer.pushSeconds,.05,2)},
      shooter:{hood:num(s.hood,DEFAULTS.shooter.hood,70,85),rpm:num(s.rpm,DEFAULTS.shooter.rpm,100,30000),ticksPerRev:num(s.ticksPerRev,28,1,10000),spinUp:num(s.spinUp,DEFAULTS.shooter.spinUp,0,10),
        control:pick(s.control,FLYWHEELS,'velocity'),power:num(s.power,1,.05,1),tolerance:num(s.tolerance,DEFAULTS.shooter.tolerance,.01,.5),...(pidf(s.pidf)?{pidf:pidf(s.pidf)}:{}),
        // Speed lost with each shot (0..0.6 of the target: the piece takes the flywheel's energy) and the calibrated hood.
        ...(finite(s.dropPerShot)&&s.dropPerShot>0?{dropPerShot:+clamp(s.dropPerShot,0,.6).toFixed(3)}:{}),...(hoodMap(s.hoodMap)?{hoodMap:hoodMap(s.hoodMap)}:{}),
        // The first shooter, for code that describes one.
        type:first?.type||'none',mount:first?.mount||'center',motor:first?.motor||'shooter'},
      turret:{speed:num(t.speed,DEFAULTS.turret.speed,5,2000),min:num(t.min,DEFAULTS.turret.min,-180,0),max:num(t.max,DEFAULTS.turret.max,0,180),ticksPerDegree:num(t.ticksPerDegree,DEFAULTS.turret.ticksPerDegree,.01,10000),
        kind:pick(t.kind,TURRETS,'motor'),servoCenter:num(t.servoCenter,DEFAULTS.turret.servoCenter,0,1),servoDegrees:num(t.servoDegrees,DEFAULTS.turret.servoDegrees,10,3600),...(Array.isArray(t.gears)&&t.gears.length?{gears:t.gears.slice(0,8).map(g=>[Math.round(num(g?.[0],20,1,2000)),Math.round(num(g?.[1],20,1,2000))])}:{}),motor:turret?.turretMotor||'turret'},
      // All intakes together, for code that describes one.
      intake:{enabled:intakes.length>0,kind:intakes[0]?.kind||'sweeper',sides,side:mountOf(sides)||'custom',motor:intakes[0]?.motor||'intake',power:intakes[0]?.power||1},
      target:point(r.target)};
  }
  const hasTurret=m=>m.shooters.some(s=>s.type==='turret');
  // The physics engine's robot description (BIOBUZZ mechanism vocabulary) for these settings. Every
  // shooter is a launcher that fires one piece at a time; the simulator points it (a turret where the
  // model aims it, a fixed shooter along its facing). Two shooters are the game's double launcher:
  // pollen from the first, nectar from the second. Two shooters on one turret launch from the same spot (the
  // engine puts mount2 back after the game's spawn checks, which keep two launchers apart).
  function engineSpec(m){
    const s=m.shooters,mount=m.intake.sides.length?mountOf(m.intake.sides):'front';
    const launcher=s.length===2?{kind:'twinturret',mount:s[0].mount,mount2:s[1].mount,hoodDeg:m.shooter.hood}:{kind:'turret',mount:s[0]?.mount||'center',hoodDeg:m.shooter.hood};
    // The game's spawn checks know four mounts; a custom mix spawns as front-and-back and the engine sets its sides.
    return {intakeMount:mount==='all'||!mount?'frontback':mount,ballStorage:m.storage,scoreMode:launcher.kind,shooterMount:launcher.mount,bbMech:{launcher,lift:null,intake:{kind:flowerKind(m)}}};
  }
  // The game physics has one intake kind per robot: the first intake that reaches into a flower (a ramp or side
  // rollers), else a sweeper. Only that intake's sides reach into flowers (the engine marks the others).
  const flowerKind=m=>m.intakes.find(i=>i.kind==='ramp'||i.kind==='siderollers')?.kind||'sweeper';
  // The intake sides the engine sets after spawn, when they are not one of the game's own mounts.
  const engineIntakeMount=m=>{const mount=mountOf(m.intake.sides);return mount&&mount!=='all'?null:mount==='all'?'all':'edges:'+m.intake.sides.join(',');};
  // BIOBUZZ: each alliance launches into its own hive's up-facing cell. At the start that is red's
  // audience-side (south) cell and blue's rear-side (north) cell, 15.519 in along a 30° arm.
  const CELL_DY=15.519*Math.cos(Math.PI/6);
  // cell 'other': the hive's other cell, which faces up after the first tip (mirrored across the pivot at y 72).
  function target(m,field,alliance,cell='start'){
    const start=m.target||(field==='biobuzz'?alliance==='blue'?{x:84.75,y:72+CELL_DY}:{x:59.25,y:72-CELL_DY}:{x:72,y:72});
    return cell==='other'?{x:start.x,y:+(144-start.y).toFixed(2)}:start;
  }
  // Route action names: "Intake", "Spin up", "Aim", "Shoot" (everything held) or "Shoot 3", "Ramp down" and
  // "Ramp up" (a ramp stays where it was sent), "Turret to 30°" (every turret, degrees from the robot's front,
  // counterclockwise) or "Turret 2 to -45°". Any other name is the team's own action with an empty code slot.
  function action(raw){
    const text=String(raw||'').trim(),m=/^shoot(?:\s+(\d+))?$/i.exec(text);
    if(m)return {kind:'shoot',count:m[1]?clamp(Number(m[1]),1,99):0};
    if(/^intake$/i.test(text))return {kind:'intake'};
    if(/^spin\s*up$/i.test(text))return {kind:'spin'};
    if(/^aim$/i.test(text))return {kind:'aim'};
    const r=/^ramps?\s+(down|up)$/i.exec(text);if(r)return {kind:'ramp',down:r[1].toLowerCase()==='down'};
    // Wait: a step that only takes its time (between the steps at a pin).
    if(/^wait$/i.test(text))return {kind:'wait'};
    const t=/^turrets?(?:\s+([12]))?\s+to\s+(-?\d+(?:\.\d+)?)\s*°?$/i.exec(text);if(t)return {kind:'turret',turret:t[1]?Number(t[1])-1:null,degrees:clamp(Number(t[2]),-180,180)};
    return {kind:text?'custom':'none'};
  }
  const hasRamp=m=>m.intakes.some(i=>i.kind==='ramp');
  // The name of a "Turret to" action, e.g. "Turret to 30°" (turret: null for every turret, or 0 or 1).
  const turretAction=(degrees,turret=null)=>`Turret${turret===null?'':' '+(turret+1)} to ${+clamp(degrees,-180,180).toFixed(1)}°`;
  // A fixed shooter fires along its facing: Shoot pins that set no heading of their own turn the robot
  // so that side faces the target, and shooting paths of a front-firing shooter track it. A pin or path aimed at the
  // hive's other cell (cell 'other') faces that cell, mirrored across the pivot as target() does.
  function prepare(pins,m,start){
    const fixed=m?.enabled&&m.shooters.find(s=>s.type==='fixed');if(!fixed||!start)return pins;
    const offset=FACING[fixed.facing],aim=cell=>cell==='other'?{x:start.x,y:+(144-start.y).toFixed(2)}:start;
    // A pin or path with several steps shoots when one of its steps does.
    const shoots=s=>Array.isArray(s?.steps)&&s.steps.length>1?s.steps.some(x=>action(x.action).kind==='shoot'):action(s?.action).kind==='shoot';
    return pins.map(p=>{const q={...p},target=aim(q.cell);
      if(shoots(q)&&!finite(q.turn)){if(offset===0){q.turn=0;q.turnMode='track';q.target={...target};}else{q.turn=+(((Math.atan2(target.y-q.y,target.x-q.x)*DEG-offset)%360+540)%360-180).toFixed(2);q.turnMode='absolute';}}
      if(offset===0&&q.path?.kind==='action'&&shoots(q.path)&&(!q.path.rotate||q.path.rotate==='keep'))q.path={...q.path,rotate:'track',target:{...aim(q.path.cell)}};return q;});
  }
  const actions=m=>m.enabled?[...(m.intakes.length?['Intake']:[]),...(hasRamp(m)?['Ramp down','Ramp up']:[]),...(m.shooters.length?['Spin up',...(hasTurret(m)?['Aim']:[]),'Shoot']:[])]:[];
  const wrap=d=>((d%360)+540)%360-180,DEG=180/Math.PI;
  // A plain-language summary, e.g. "Front + back sweeper · turret (pollen) · holds 3 pollen + 1 nectar".
  function summary(m){
    if(!m.enabled)return 'No mechanisms: the robot pushes pieces but does not carry them.';
    const intakes=m.intakes.map(i=>`${i.sides.map(e=>e[0].toUpperCase()+e.slice(1)).join(' + ')} ${INTAKES[i.kind].toLowerCase()}`).join(', ')||'No intake';
    const shooters=m.shooters[1]?.sharesTurret?`two shooters on one turret (${m.shooters.map(s=>PIECES[s.pieces].toLowerCase()).join(', ')})`:m.shooters.map(s=>`${s.type==='turret'?'turret':'fixed shooter'} (${PIECES[s.pieces].toLowerCase()})`).join(' and ')||'no shooter';
    return `${intakes} · ${shooters} · holds ${m.storage} ${m.capacity.nectar?`pieces (pollen or nectar)`:'pollen'}, starts with ${m.preload.pollen}`;
  }
  // How long a piece takes to move up from the intake to its place in storage. Storage is one path from
  // the intake to the shooter with a slot per piece, and pieces queue nose to tail, so a piece only
  // travels as far as the first free slot: in an empty robot it goes all the way to the shooter (the
  // full transfer time); with pieces ahead of it, it stops behind them sooner. With 4 slots and a 2 s
  // transfer: 2 s, 1.5 s, 1 s, then 0.5 s.
  const travel=(m,ahead)=>m.transfer.seconds*Math.max(0,1-ahead/Math.max(1,m.storage));
  // The mechanism hardware, tick by tick. Commands: intake, spin (flywheels), aim (turrets track the
  // target, or turretDeg when robot code positions them), feed (the indexer moves pieces up into the
  // shooters). The model owns flywheel speed (0..1 of target), turret angle (degrees from the robot's
  // front, counterclockwise; every turret aims at the same target, so they share it) and the queue of
  // held pieces. A piece fires the moment it sits in the shooter with the flywheel at speed and the
  // shooter on target, while feed is on: there is no extra shot delay. After a shot, the next piece
  // needs the indexing time (of feed) to move up into the shooter. Preloads start staged. The engine
  // reports the held count each tick: a rise is a capture (its transfer starts), a drop is a launch.
  // Where shooter n's turret turns on the robot, inches forward and left of the center: at its mount, pulled in
  // from each edge it touches by the turret's radius (the game physics launches from this point).
  function mountOffset(mount,{length=17,width=17}={}){const r=Math.min(3.8,Math.min(length,width)*.24),[fx,fy]=MOUNT_AT[mount]||[0,0];return [fx*(length/2-r),fy*(width/2-r)];}
  // The angle (degrees from the robot's front) a turret at `offset` must turn to face `target` from `pose`.
  function bearingFrom(offset,pose,target){const c=Math.cos(pose.heading),s=Math.sin(pose.heading),x=pose.x+offset[0]*c-offset[1]*s,y=pose.y+offset[0]*s+offset[1]*c;return wrap(Math.atan2(target.y-y,target.x-x)*DEG-pose.heading*DEG);}
  class Model{
    constructor(m,held=0,dims={}){this.m=m;this.dims=dims;this.turrets=m.shooters.map(()=>0);this.flywheel=0;this.turret=0;this.time=0;this.sinceShot=Infinity;this.shots=0;this.pending=false;this.held=held;
      // How far down each kicker or ramp is (0 up, 1 down); null for an intake that does not move.
      this.queue=Array.from({length:held},(_,i)=>({arrives:-Infinity,index:i?m.indexer.seconds:0}));this.kick=m.intakes.map(i=>deploys(i.kind)?0:null);
      // How far a roller on a swing arm has ridden up over the last piece taken in (0 at rest, 1 at the top).
      this.caught=-Infinity;this.lift=m.intakes.map(()=>0);
      // Behind a servo pusher the next piece drops into place while the pusher is back at rest, so its indexing time
      // passes whether or not the pusher is pushing; a push fires the piece that is in place.
      this.settles=pusherOnly(m);}
    tick(dt,cmd,{pose,target,held}){
      const m=this.m,s=m.shooter,t=m.turret;this.time+=dt;
      if(held<this.held){const gone=this.held-held;if(this.pending){this.shots+=gone;this.pending=false;this.sinceShot=0;if(s.dropPerShot)this.flywheel=Math.max(0,this.flywheel-s.dropPerShot*gone);}this.queue.splice(0,gone);
        // The next piece moves up into the shooter: it needs the indexing time.
        if(this.queue[0])this.queue[0].index=Math.max(this.queue[0].index,m.indexer.seconds);}
      // A kicker goes down while the intake runs and back up when it stops; it picks up only once all the way down.
      // A ramp moves only when it is sent (cmd.ramp: a Ramp down or Ramp up action, or robot code moving its servo)
      // and stays there. Its rollers take pieces off the floor either way; down, it also reaches into flowers.
      const sentDown=i=>i.kind==='ramp'?cmd.ramp===true:!!cmd.intake;
      this.kick=this.kick.map((v,k)=>{if(v===null)return null;const i=m.intakes[k];return sentDown(i)?Math.min(1,v+(i.down>0?dt/i.down:1)):Math.max(0,v-(i.up>0?dt/i.up:1));});
      const kicking=this.kick.some((v,k)=>v>0&&m.intakes[k].kind==='kicker'),onlyKickers=m.intakes.length>0&&m.intakes.every(i=>i.kind==='kicker');
      for(let k=this.held;k<held;k++){const ahead=this.queue.length;this.queue.push(onlyKickers&&kicking?{arrives:Infinity,scooped:true,index:ahead?m.indexer.seconds:0}:{arrives:this.time+travel(m,ahead),index:ahead?m.indexer.seconds:0});this.caught=this.time;}
      // The piece goes under the roller: it rides up quickly and settles back down.
      const since=this.time-this.caught,up=since<.08?since/.08:since<.2?1:since<.45?1-(since-.2)/.25:0;this.lift=m.intakes.map(i=>i.kind==='kicker'?0:up);
      // Back up: what the kickers scooped starts its transfer.
      if(!kicking)this.queue.forEach((p,k)=>{if(p.scooped){p.scooped=false;p.arrives=this.time+travel(m,k);}});
      this.held=held;this.sinceShot+=dt;
      const spin=cmd.spin||cmd.feed;this.flywheel=s.spinUp>0?clamp(this.flywheel+(spin?1:-1)*dt/s.spinUp,0,1):spin?1:0;
      // Each turret aims from its own spot on the robot (robot code may command each angle). Ready to fire once
      // every turret has reached the angle it was sent to. Where it points is physical: the game physics launches
      // along it, so a turret aimed from a poor estimate can miss. A fixed shooter fires along its facing.
      let aligned=true;
      m.shooters.forEach((sh,n)=>{if(sh.type!=='turret'||sh.sharesTurret)return;const given=finite(cmd.turretDegs?.[n])?cmd.turretDegs[n]:cmd.turretDeg;
        const want=clamp(finite(given)?given:target&&pose?bearingFrom(mountOffset(sh.mount,this.dims),pose,target):0,t.min,t.max);
        if(cmd.aim||cmd.feed||finite(given)){const step=t.speed*dt,d=want-this.turrets[n];this.turrets[n]+=Math.abs(d)<=step?d:Math.sign(d)*step;}
        aligned=aligned&&Math.abs(this.turrets[n]-want)<=2;});
      // A shooter on the first one's turret points wherever that turret does.
      if(m.shooters[1]?.sharesTurret)this.turrets[1]=this.turrets[0];
      const first=m.shooters.findIndex(sh=>sh.type==='turret');if(first>=0)this.turret=this.turrets[first];
      // At speed within the shooter's tolerance (5% unless set), as the robot code decides; with a calibrated hood, down
      // to the slowest speed it has a hood angle for.
      this.aligned=aligned;this.ready=this.flywheel>=readyAt(m)-1e-9;
      // The front piece moves up into the shooter while the indexer runs (behind a pusher, while it is back at rest).
      const front=this.queue[0];if(front&&(cmd.feed||this.settles)&&front.arrives<=this.time)front.index=Math.max(0,front.index-dt);
      let fire=false;
      if(cmd.feed&&m.shooters.length&&this.ready&&aligned&&front&&front.arrives<=this.time&&front.index<=1e-9&&!this.pending){fire=true;this.pending=true;this.sinceShot=0;}
      // A launch the physics refused is asked for again.
      else if(this.pending&&this.sinceShot>FIRE_RECOVERY&&held>0&&cmd.feed){fire=true;this.sinceShot=0;}
      return {intake:!!cmd.intake,fire,edgesOff:m.intakes.flatMap((i,k)=>i.kind==='kicker'&&this.kick[k]<1?i.sides:[]),ramp:this.rampState(sentDown)};
    }
    // The game physics has one ramp per robot, which reaches into flowers once it settles down: whether any ramp
    // is sent down, and the seconds until it is all the way there (down, or back up). Null without a ramp.
    rampState(sentDown){
      const ramps=this.m.intakes.map((i,k)=>[i,this.kick[k]]).filter(([i])=>i.kind==='ramp');if(!ramps.length)return null;
      const going=ramps.filter(([i])=>sentDown(i));
      return going.length?{down:true,eta:Math.min(...going.map(([i,v])=>(1-v)*i.down))}:{down:false,eta:Math.max(...ramps.map(([i,v])=>v*i.up))};
    }
    // The flywheel's speed now (RPM) and the hood angle the calibration gives for it.
    rpm(){return this.flywheel*this.m.shooter.rpm;}
    hood(){return hoodAt(this.m,this.rpm()).deg;}
    // Where shooter n points, in degrees from the robot's front.
    aim(n){const s=this.m.shooters[n];return !s?0:s.type==='turret'?this.turrets[n]:FACING[s.facing];}
    state(){const q=this.queue,front=q[0];return {flywheel:this.flywheel,rpm:this.rpm(),hood:this.hood(),turret:this.turret,turrets:this.turrets.slice(),aligned:!!this.aligned,ready:!!this.ready,shots:this.shots,held:this.held,
      deploy:this.kick.slice(),lift:this.lift.slice(),kickers:this.kick.filter((v,k)=>v!==null&&this.m.intakes[k].kind==='kicker'),ramps:this.kick.filter((v,k)=>v!==null&&this.m.intakes[k].kind==='ramp'),moving:q.filter(p=>p.arrives>this.time).length,staged:!!front&&front.arrives<=this.time&&front.index<=1e-9};}
  }
  // Runs route actions the way the generated robot code does, with no piece sensor. At a pin the action
  // is busy until it finishes; on an action path it runs while the path is driven. "Shoot N" spins up
  // and aims, waits until pieces taken by the last Intake have had the transfer time to move up, then
  // runs the indexer long enough for N shots: the first piece is already in the shooter, and each next
  // one needs the indexing time. "Shoot" alone shoots once per storage slot.
  const FIRE_MARGIN=.15;
  // How long the kickers take to swing back up after an intake (0 without a kicker).
  const liftSeconds=m=>Math.max(0,...m.intakes.filter(i=>i.kind==='kicker').map(i=>i.up));
  // Every feeder is a servo pusher: it pushes once per feed cycle and needs to get back to rest in between.
  function pusherOnly(m){return m.shooters.length>0&&m.shooters.every(s=>s.indexerKind==='pusher');}
  // A pusher pushes at the start of each cycle for pushSeconds; the cycle is the indexing time, and at least
  // twice the push so it is back at rest before the next piece. Other feeders run for the whole volley.
  const feedCycle=m=>pusherOnly(m)?Math.max(m.indexer.seconds,2*m.indexer.pushSeconds):m.indexer.seconds;
  const shootSeconds=(m,count)=>Math.max(0,(count||m.storage)-1)*feedCycle(m)+(pusherOnly(m)?Math.max(m.indexer.pushSeconds,FIRE_MARGIN):FIRE_MARGIN);
  // A ramp is sent down or up by its own actions and stays there (cmd.ramp, sent every tick while the robot has one).
  // joints, when given: {start(name), busy(name)} for the moving parts (Setup → Moving parts), which a list of steps
  // starts itself; a single action's parts are started by the engine.
  class Runner{
    constructor(m,joints=null){this.m=m;this.key='';this.spinning=false;this.lastIntake=-Infinity;this.ramp=false;this.joints=joints;this.slot={feedStart:-1,done:false};}
    commands(act,state,now){
      if(act?.steps?.length>1)return this.steps(act,state,now);
      const key=act?`${act.moving?'path'+(act.path??act.leg):'pin'+act.leg}:${act.name}`:'';
      if(key!==this.key){this.key=key;this.slot={feedStart:-1,done:false};}
      return this.one(act?.name,act,this.slot,state,now);
    }
    base(){const cmd={intake:false,spin:this.spinning,aim:false,feed:false};if(hasRamp(this.m))cmd.ramp=this.ramp;return cmd;}
    // One action this tick. slot keeps what a Shoot has done so far; opts: moving (on a path), seconds (a set time).
    one(name,opts,slot,state,now){
      const m=this.m,a=action(name),moving=!!opts?.moving,cmd=this.base();let busy=false;
      if(a.kind==='intake'){cmd.intake=m.intakes.length>0;if(cmd.intake)this.lastIntake=now;}
      else if(a.kind==='spin'){this.spinning=true;cmd.spin=true;}
      else if(a.kind==='aim'){cmd.aim=true;busy=!moving&&hasTurret(m)&&!state.aligned;}
      else if(a.kind==='ramp'&&hasRamp(m)){this.ramp=cmd.ramp=a.down;
        // At a pin it holds until the ramp has arrived (a ramp down reaches into a flower only once it settles).
        const ramps=state.ramps||[];busy=!moving&&ramps.some(v=>a.down?v<1:v>0);}
      else if(a.kind==='turret'&&hasTurret(m)){const t=m.turret,deg=clamp(a.degrees,t.min,t.max),own=m.shooters.map((s,n)=>s.type==='turret'&&!s.sharesTurret&&(a.turret===null||a.turret===n));
        if(a.turret===null)cmd.turretDeg=deg;else cmd.turretDegs=m.shooters.map((_,n)=>own[n]?deg:undefined);
        busy=!moving&&own.some((on,n)=>on&&Math.abs((state.turrets?.[n]??0)-deg)>2);}
      else if(a.kind==='shoot'&&m.shooters.length&&!slot.done){
        cmd.spin=cmd.aim=true;
        if(slot.feedStart<0&&state.ready&&state.aligned&&now-this.lastIntake>=m.transfer.seconds+liftSeconds(m))slot.feedStart=now;
        // Shooting for a set time keeps feeding until the route ends the action; otherwise it feeds for N shots.
        const window=finite(opts?.seconds)?Infinity:shootSeconds(m,a.count);
        // A pusher pushes at the start of each feed cycle, like the robot code; other feeders run the whole time.
        if(slot.feedStart>=0){const t=now-slot.feedStart;cmd.feed=t<window&&(!pusherOnly(m)||t%feedCycle(m)<m.indexer.pushSeconds);if(t>=window){slot.done=true;this.spinning=false;}}
        busy=!moving&&!slot.done;
      }
      return {cmd,busy};
    }
    // A list of steps (act.steps: {action, seconds, cell}). At a pin they run one after another: each for its set time,
    // or until it is done, and a step that is done at once (Spin up) lets the next one start the same tick. While driving
    // they run together from the start of the path, each for its set time or the whole path. cell: the hive cell the
    // running Shoot or Aim aims at.
    steps(act,state,now){
      const key=`${act.moving?'path'+(act.path??act.leg):'pin'+act.leg}:${act.name}`,list=act.steps;
      if(key!==this.key){this.key=key;this.run={t0:now,at:0,slots:list.map(()=>({feedStart:-1,done:false,t0:null,finished:false}))};}
      const r=this.run,j=this.joints,isPart=s=>action(s.action).kind==='custom';
      const begin=(s,slot)=>{if(slot.t0!==null)return;slot.t0=now;if(isPart(s)&&j)slot.part=j.start(s.action)!==false;};
      const finish=(s,slot)=>{slot.finished=true;if(action(s.action).kind==='shoot')this.spinning=false;};
      if(act.moving){const cmd=this.base();let cell;
        list.forEach((s,i)=>{const slot=r.slots[i];begin(s,slot);if(slot.finished)return;
          if(finite(s.seconds)&&now-slot.t0>=s.seconds){finish(s,slot);return;}
          const out=this.one(s.action,{moving:true,seconds:s.seconds},slot,state,now);if(slot.done)finish(s,slot);
          for(const k of ['intake','spin','aim','feed'])cmd[k]=cmd[k]||out.cmd[k];
          if(finite(out.cmd.turretDeg))cmd.turretDeg=out.cmd.turretDeg;if(out.cmd.turretDegs)cmd.turretDegs=out.cmd.turretDegs.map((v,n)=>finite(v)?v:cmd.turretDegs?.[n]);
          if(/^(shoot|aim)/.test(action(s.action).kind)&&cell===undefined)cell=s.cell;});
        if('ramp' in cmd)cmd.ramp=this.ramp;return {cmd,busy:false,cell};}
      while(r.at<list.length){const s=list[r.at],slot=r.slots[r.at];begin(s,slot);
        const out=this.one(s.action,{moving:false,seconds:s.seconds},slot,state,now),t=now-slot.t0;
        const part=slot.part&&j.busy(s.action),done=finite(s.seconds)?t>=s.seconds-1e-9:!out.busy&&!part;
        if(!done)return {cmd:out.cmd,busy:true,cell:s.cell};
        finish(s,slot);r.at++;}
      return {cmd:this.base(),busy:false};
    }
  }
  // Where a picked point on the robot (inches; x forward, y left, from the robot's center) falls: the
  // nearest of the nine mount cells, and the edge it is closest to.
  function locate(p,length,width){
    const fx=clamp(p.x/(length/2||1),-1,1),fy=clamp(p.y/(width/2||1),-1,1),snap=v=>v>1/3?1:v<-1/3?-1:0;
    const cell=Object.entries(MOUNT_AT).find(([,a])=>a[0]===snap(fx)&&a[1]===snap(fy))[0];
    const edge=Math.abs(fx)>=Math.abs(fy)?(fx>=0?'front':'back'):(fy>=0?'left':'right');
    return {mount:cell,edge};
  }
  // ---- parts from a CAD assembly ---------------------------------------------------------------
  // A STEP file's assemblies are named by the team ("Chassis", "Front intake", "Pollen shooter",
  // "Turret", "Indexer"...). The name says what each one is.
  const ROLE_WORDS=[['intake',/intake|roller|sweeper|ramp|collector|pick ?up|kicker|scoop|deploy|flap/i],['shooter',/shoot|launch|flywheel|turret|cannon|outtake/i],
    ['indexer',/index|feed|transfer|hopper|storage|magazine|conveyor|elevator/i],['chassis',/chassis|drive ?train|drive ?base|frame|base ?plate|^base$|^drive$/i]];
  // What an assembly carries, by the names inside it (the outermost of each, without instance numbers; a "Flywheel shaft"
  // or "Ramp plate" is hardware, not a mechanism): a turret its flywheel, hood and shooter; an intake its ramp or kicker
  // and its rollers. Rollers with a kicker or ramp inside one intake are a deployable ramp (a kicker alone has none).
  const CARRIED={shooter:[/fly ?wheel/i,/\bhood\b/i,/shoot|launch|cannon/i],intake:[/ramp|deploy|flap|kicker|scoop/i,/roller|\bwheels?\b|gecko|compliant|sweeper|brush/i]};
  const PART_WORDS=/\b(shaft|axle|motor|servo|plate|spacer|bearing|bushing|collar|pulley|belt|gear|bolt|screw|nut|washer|standoff|bracket|mount|encoder|sensor|cable|hub)s?\b/i;
  const bareName=n=>String(n||'').replace(/\s*<\d+>$/,'').trim();
  // An assembly whose own name says nothing is known by what is in it. A hood or a flywheel makes it a shooter, and so does
  // a fast motor (6000 rpm, bare or 1:1) beside wheels 60 mm or bigger, whatever a vendor's part name says: goBILDA's
  // "Intake Roller Wheel" feeding a flywheel does not make a shooter an intake.
  const SHOOTS_INSIDE=/\bhood\b|fly ?wheel|shoot|launch|cannon/i,FAST_MOTOR=/(5[5-9]\d\d|6000) ?rpm|bare (rex|motor)|\b1:1\b/i;
  const bigWheel=n=>/wheel|rhino|compliant/i.test(n)&&[...String(n).matchAll(/(\d{2,3})\s*mm\s*(?:diameter|dia\b|od\b|wheel)/gi)].some(m=>+m[1]>=60);
  const shooterInside=inner=>inner.some(n=>SHOOTS_INSIDE.test(n))||inner.some(n=>FAST_MOTOR.test(n))&&inner.some(bigWheel);
  function partRole(name,inner=[]){
    const find=text=>ROLE_WORDS.find(([,re])=>re.test(text))?.[0]||null,text=String(name||''),all=[text,...inner].join(' ');
    const nectar=/nectar/i.test(all),pollen=/pollen/i.test(all),role=find(text)||(shooterInside(inner)?'shooter':null)||find(inner.join(' '))||(nectar||pollen?'shooter':'other');
    const carries=[...new Set((CARRIED[role]||[]).map(re=>inner.find(n=>re.test(n)&&!PART_WORDS.test(n))).filter(Boolean).map(bareName))];
    const rollers=role==='intake'&&(/roller|sweeper/i.test(text)||inner.some(n=>CARRIED.intake[1].test(n)));
    return {role,pieces:nectar&&pollen?'both':nectar?'nectar':pollen?'pollen':null,type:role==='shooter'?(/turret/i.test(all)?'turret':'fixed'):null,
      kind:role==='intake'?(/kicker|scoop/i.test(text)?'kicker':/side ?roller/i.test(all)?'siderollers':/ramp|deploy|flap/i.test(all)?'ramp':/kicker|scoop/i.test(all)?(rollers?'ramp':'kicker'):'sweeper'):null,...(carries.length?{carries}:{})};
  }
  // The drivetrain from the part names anywhere in the assembly ("104mm Mecanum Wheel", "Swerve module"...).
  const DRIVE_WORDS=[['swerve',/swerve/i],['mecanum',/mecanum/i],['kiwi',/kiwi/i],['xdrive',/\b[xh]-?drive|omni/i],['tank',/\btracks\b|tread|drop ?cent(er|re)|west ?coast|\bwcd\b|6 ?wd|traction|\btank\b/i]];
  function drivetrainFromNames(names=[]){const text=names.join('\n');return DRIVE_WORDS.find(([,re])=>re.test(text))?.[0]||null;}
  // Copies of one assembly: "Turret <1>" and "Turret <2>" (instances), "Turret L" and "Turret R", "Left shooter" and
  // "Right shooter", "Shooter 1" and "Shooter 2". Two such parts are two mechanisms, never one, however close they sit.
  const SIDE_WORDS=new Set(['left','right','front','back','rear','l','r','lh','rh','a','b','one','two','first','second','1st','2nd','top','bottom','upper','lower','inner','outer']);
  const copyBase=name=>String(name||'').toLowerCase().replace(/<(\d+)>/g,' $1 ').replace(/([a-z])(\d)/g,'$1 $2').replace(/(\d)([a-z])/g,'$1 $2').split(/[^a-z0-9]+/).filter(w=>w&&!SIDE_WORDS.has(w)&&!/^\d+$/.test(w)).join(' ');
  // An intake's rollers and a shooter's feeder chained to one motor (one name): running one runs the other.
  const onOneMotor=m=>!!m?.intakes?.some(i=>[i.motor,i.motor2].filter(Boolean).some(n=>m.shooters?.some(s=>s.indexer===n))),
    // Or on two motors, when the feeder's wheels reach the intake's mouth and the two run as one (Configure from CAD, or the team says).
    chained=m=>onOneMotor(m)||!!m?.intakes?.some(i=>i.withFeeder);
  const copies=(a,b)=>String(a).trim().toLowerCase()!==String(b).trim().toLowerCase()&&copyBase(a)!==''&&copyBase(a)===copyBase(b);
  // A deployable ramp (or kicker) by its name: one that says it moves (deploy, fold, flip, drop down, kicker, flap).
  const MOVES_WORDS=/deploy|kicker|flap|fold|flip|drop ?down|swing/i;
  const quoted=list=>list.map(n=>`“${n}”`).join(' + ');
  // Mechanism parts from CAD part boxes in the robot frame (inches: x forward and y left from the chassis
  // center, z up from the floor). Returns the chassis size, intakes and shooters, and what was found.
  // Parts that hold other listed parts (their key is above the others' keys: an assembly the import split into the
  // turrets inside it) are not mechanisms themselves.
  // What a part of a mechanism is, from its name: a wheel or roller turns, a claw grips, and the rest is its body.
  function partKindOf(name){const n=String(name||'');if(/wheel|roller|gecko|mecanum|omni|compliant|tread|tire|tyre|sprocket/i.test(n))return 'wheel';if(/claw|gripper|grabber|pincer|\bjaw|finger/i.test(n))return 'claw';return 'body';}
  function fromCad(parts,{length,width,chassis:derived}={}){
    const chassis=parts.find(p=>p.role==='chassis')||(derived?{name:derived.name,derived:true,box:{x0:-derived.length/2,x1:derived.length/2,y0:-derived.width/2,y1:derived.width/2}}:null),round=v=>Math.round(v*4)/4,found=[];
    const L=chassis?chassis.box.x1-chassis.box.x0:length,W=chassis?chassis.box.y1-chassis.box.y0:width,hl=L/2,hw=W/2;
    if(chassis)found.push(chassis.derived?`Chassis (all parts except the intakes): ${round(L)} × ${round(W)} in`:`Chassis “${chassis.name}”: ${round(L)} × ${round(W)} in`);
    const holds=p=>typeof p.key==='string'&&parts.some(q=>q!==p&&typeof q.key==='string'&&q.key.startsWith(p.key+'/')),holderOf=name=>{const p=parts.find(q=>q.name===name);return p&&typeof p.key==='string'?parts.find(q=>q!==p&&holds(q)&&p.key.startsWith(q.key+'/'))?.name:null;};
    const usable=parts.filter(p=>!holds(p));
    const intakes=[],shooters=[],ramps=new Map(),extents=new Map(),grow=(i,b)=>{const e=extents.get(i);extents.set(i,e?{x0:Math.min(e.x0,b.x0),x1:Math.max(e.x1,b.x1),y0:Math.min(e.y0,b.y0),y1:Math.max(e.y1,b.y1),z1:Math.max(e.z1,b.z1)}:{...b});},up=v=>Math.ceil(v*4-1e-6)/4;
    for(const p of usable.filter(p=>p.role==='intake')){const b=p.box,out={front:b.x1-hl,back:-hl-b.x0,left:b.y1-hw,right:-hw-b.y0},center={x:(b.x0+b.x1)/2,y:(b.y0+b.y1)/2};
      let edge=Object.entries(out).sort((a,c)=>c[1]-a[1])[0];edge=edge[1]>.25?edge[0]:locate(center,L,W).edge;
      const along=edge==='front'||edge==='back',span=Math.min(along?b.y1-b.y0:b.x1-b.x0,along?W:L),deploying=p.kind==='ramp'||p.kind==='kicker';
      // Another assembly on the same edge (a ramp plate, a roller arm) is part of that intake: its moving parts are
      // looked for there too. What the intake is stays as its first assembly says, unless the other one is named as a ramp
      // or kicker that moves (a "Ramp deploy", a "Kicker"): rollers with a ramp folding down in front of them are a
      // deployable ramp. A ramp named only "Ramp" may be fixed; the CAD's hinge decides (Moving parts).
      const same=intakes.find(i=>i.sides.includes(edge));
      if(same){grow(same,b);if(same.parts.length<8&&!same.parts.includes(p.name))same.parts.push(p.name);
        if(deploying){ramps.set(same,[...(ramps.get(same)||[]),p.name]);if(same.kind==='sweeper'&&MOVES_WORDS.test(p.name)){same.kind='ramp';same.why=`“${p.name}” is named as a ramp that moves, on the same edge as the rollers`;}}
        continue;}
      const intake={kind:p.kind||'sweeper',sides:[edge],reach:round(Math.max(0,out[edge])),width:round(span),height:round(clamp(b.z1-b.z0,1,24)),motor:intakes.length?`intake${intakes.length+1}`:'intake',from:p.name,parts:[p.name]};
      // One assembly holding the ramp (or kicker) and the rollers says so by the names inside it.
      const inside=p.carries||[],rampIn=inside.find(n=>CARRIED.intake[0].test(n)),rollIn=inside.find(n=>n!==rampIn&&CARRIED.intake[1].test(n));
      if(rampIn&&deploying)intake.holds=`it holds “${rampIn}”${rollIn?` beside its rollers “${rollIn}”`:''}`;
      if(deploying)ramps.set(intake,[p.name]);grow(intake,b);intakes.push(intake);}
    for(const i of intakes){const e=extents.get(i),edge=i.sides[0],along=edge==='front'||edge==='back',o={front:e.x1-hl,back:-hl-e.x0,left:e.y1-hw,right:-hw-e.y0}[edge];i.reach=up(clamp(o,0,18));i.width=up(clamp(2*(along?Math.max(Math.abs(e.y0),Math.abs(e.y1)):Math.max(Math.abs(e.x0),Math.abs(e.x1))),1,48));if(Number.isFinite(e.z1))i.height=up(clamp(e.z1,1,24));}
    for(const i of intakes){const r=(ramps.get(i)||[]).filter(n=>n!==i.from),own=i.parts.filter(n=>!r.includes(n)),what=i.kind==='ramp'?'deployable ramp':i.kind==='kicker'?'kicker':null;
      const why=i.why?` · a ${what} because ${i.why}`:r.length?` · whether the ${i.kind==='kicker'?'kicker':'ramp'} swings down is checked on its hinge (Moving parts)`:what?` · a ${what} ${i.holds?`because ${i.holds}`:'by its name'}`:'';
      found.push(`Intake ${quoted(own)}${r.length?` + ${i.kind==='kicker'?'kicker':'ramp'} ${quoted(r)}`:''}: ${i.sides[0]}, ${i.reach} in out, ${i.width} in wide${why}`);
      delete i.why;delete i.holds;}
    // Shooters. A flywheel assembly (named shooter, launcher... or for its piece) is one shooter; assemblies that
    // overlap on the robot's footprint (a flywheel and its hood) are the same one, unless they take different pieces or
    // are copies of one assembly (two turrets' shooters sit close but are two). An assembly named only "turret" turns the
    // flywheels that sit over it: each of them gets its own turret, so one "Turret" assembly holding two turntables under
    // a pollen and a nectar flywheel is two independent turrets. Copies of a turret ("Turret L" and "Turret R") each take
    // the nearest flywheel; a turret with no flywheel over it is a shooter of its own (its flywheel rides inside it).
    const turretOnly=p=>p.type==='turret'&&/turret/i.test(p.name)&&!/shoot|launch|flywheel|cannon|outtake|pollen|nectar/i.test(p.name);
    const centerOf=b=>({x:(b.x0+b.x1)/2,y:(b.y0+b.y1)/2}),area=b=>Math.max(.01,(b.x1-b.x0)*(b.y1-b.y0)),apart=(a,b)=>Math.hypot(centerOf(a).x-centerOf(b).x,centerOf(a).y-centerOf(b).y);
    const shared=(a,b)=>Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
    const same=(s,p)=>!s.parts.some(n=>copies(n,p.name))&&(!s.pieces||!p.pieces||s.pieces===p.pieces)&&(shared(s.box,p.box)>.25*Math.min(area(s.box),area(p.box))||apart(s.box,p.box)<3);
    const union=(a,b)=>({x0:Math.min(a.x0,b.x0),x1:Math.max(a.x1,b.x1),y0:Math.min(a.y0,b.y0),y1:Math.max(a.y1,b.y1),z0:Math.min(a.z0,b.z0),z1:Math.max(a.z1,b.z1)});
    const groups=[],shooterParts=usable.filter(p=>p.role==='shooter');
    for(const p of shooterParts.filter(p=>!turretOnly(p))){const near=groups.find(s=>same(s,p));
      if(near){near.box=union(near.box,p.box);near.parts.push(p.name);near.flywheels.push(p.name);if(p.type==='turret')near.type='turret';near.pieces=near.pieces||p.pieces;continue;}
      groups.push({box:{...p.box},parts:[p.name],flywheels:[p.name],turrets:[],carries:[],type:p.type||'fixed',pieces:p.pieces});}
    // Turrets are matched to the flywheel shooters only (two turrets never make one shooter). A "Turret" assembly the import
    // split into the shooters inside it turns those shooters (its turntables stay in what is left of it).
    const flywheelGroups=groups.slice(),turretParts=shooterParts.filter(turretOnly),inside=(p,name)=>{const q=parts.find(x=>x.name===name);return typeof q?.key==='string'&&q.key.startsWith(p.key+'/');};
    const holders=parts.filter(p=>holds(p)&&p.role==='shooter'&&turretOnly(p)&&flywheelGroups.some(s=>s.flywheels.some(n=>inside(p,n))));
    for(const p of holders)for(const s of flywheelGroups.filter(s=>s.flywheels.some(n=>inside(p,n)))){s.type='turret';s.parts.push(p.name);s.turrets.push(p.name);}
    for(const p of turretParts){let over=flywheelGroups.filter(s=>shared(s.box,p.box)>.25*area(s.box)||same(s,{...p,pieces:null}));
      // One of two copies over several flywheels: the nearest one whose turret is not yet set.
      if(over.length>1&&turretParts.some(q=>q!==p&&copies(q.name,p.name))){const free=over.filter(s=>!s.turrets.some(n=>copies(n,p.name))),pool=free.length?free:over;over=[pool.sort((a,b)=>apart(a.box,p.box)-apart(b.box,p.box))[0]];}
      for(const s of over){s.type='turret';s.parts.push(p.name);s.turrets.push(p.name);for(const c of p.carries||[])if(!s.carries.includes(c))s.carries.push(c);}
      if(!over.length)groups.push({box:{...p.box},parts:[p.name],flywheels:[],turrets:[p.name],carries:[...(p.carries||[])],type:'turret',pieces:p.pieces});}
    // The game physics launches pollen from the first shooter and nectar from the second.
    // Shooters named for a piece come before unnamed ones when there are more than the simulator runs.
    const order={pollen:0,both:1,nectar:2},rank=g=>order[g.pieces]??3;groups.sort((a,b)=>rank(a)-rank(b));
    const kept=groups.slice(0,MAX_SHOOTERS).map(g=>({...g,pieces:g.pieces||'pollen'})).sort((a,b)=>rank(a)-rank(b));
    // What each one is called: with two, by the side each sits on (left and right, or front and back).
    const sides=(()=>{if(kept.length<2)return kept.map(()=>'');const [a,b]=kept.map(g=>centerOf(g.box)),dx=Math.abs(a.x-b.x),dy=Math.abs(a.y-b.y);
      if(Math.max(dx,dy)<.5)return ['First','Second'];return dy>=dx?[a.y>b.y?'Left':'Right',a.y>b.y?'Right':'Left']:[a.x>b.x?'Front':'Back',a.x>b.x?'Back':'Front'];})();
    const twins=kept.length===2&&kept[0].turrets.length&&kept[1].turrets.length&&kept[0].turrets.some(n=>kept[1].turrets.some(m=>copies(n,m)));
    kept.forEach((g,n)=>{const c=centerOf(g.box),mount=locate(c,L,W).mount,pieces=g.pieces||'pollen',kind=g.type==='turret'?'turret':'fixed shooter';
      const label=sides[n]?`${sides[n]} ${kind}`:kind[0].toUpperCase()+kind.slice(1),holder=g.parts.includes(holderOf(g.parts[0]))?null:holderOf(g.parts[0]);
      shooters.push({type:g.type,pieces,mount,facing:'front',at:{x:c.x,y:c.y,z:g.box.z1},from:g.parts[0],parts:g.parts.slice(0,8)});
      // Why: which assembly it is, what it carries, and why it is its own (a copy of the other, or its own turntable).
      const sharedTurret=g.turrets.length&&kept.some(o=>o!==g&&o.turrets.some(t=>g.turrets.includes(t)));
      const what=g.type!=='turret'||!g.turrets.length?quoted(g.flywheels.length?g.flywheels:g.parts):
        sharedTurret?`with shooter ${quoted(g.flywheels)}, on its own turntable in ${quoted(g.turrets)} (that assembly holds both turntables)`:
        g.flywheels.length?`${quoted(g.turrets)} carrying its shooter ${quoted(g.flywheels)}`:
        `${quoted(g.turrets)} carrying its own shooter${g.carries.length?` (${g.carries.map(x=>`“${x}”`).join(', ')} inside it)`:' (no flywheel is named in it; the shooter is taken to ride on it)'}`;
      found.push(`${label} ${what}${holder?` in “${holder}”`:''}: at the ${MOUNTS[mount].toLowerCase()}, shoots ${PIECES[pieces].toLowerCase()}${twins?' · one of two copies of the same turret assembly, so each is its own turret and shooter':''}`);});
    for(const g of groups.slice(MAX_SHOOTERS))found.push(`Shooter “${g.parts.join('” + “')}”: not set up; the simulator runs ${MAX_SHOOTERS} shooters at most`);
    for(const p of usable.filter(p=>p.role==='indexer'))found.push(`Indexer “${p.name}”: set its transfer and indexing times`);
    const top=parts.length?Math.max(...parts.map(p=>p.box.z1)):null;
    // A shooter that takes nectar needs room to hold it (the robot keeps a capacity the team already set).
    return {robot:chassis?{length:round(L),width:round(W),...(top?{heightIn:round(top)}:{})}:null,intakes,shooters,found,...(shooters.some(takesNectar)?{capacity:{pollen:STORAGE_MAX,nectar:STORAGE_MAX}}:{})};
  }
  // ---- the team's intakes and shooters, found in the CAD ---------------------------------------
  // Configure from CAD: each intake and shooter the team added takes what the CAD's named assemblies (fromCad) say about
  // it: an intake its side, size and parts (the CAD's intake of the same kind first, then in order); a shooter its spot
  // and parts (the one shooting the same pieces first). What the team chose stays: a shooter's turret or fixed, every
  // motor, servo and timing, and an intake's kind (but a plain sweeper whose CAD assembly is a deployable ramp or kicker
  // becomes one). The CAD's intakes and shooters beyond the team's are added too, as far as the robot has room for them
  // (an intake on a free edge, two shooters at most); the rest are listed in `extra`. Returns {mechanisms, matched, extra}.
  function adoptCad(raw,out){
    const r=sanitize(raw),cad=out||{intakes:[],shooters:[]},m={...r,intakes:r.enabled?r.intakes.map(i=>({...i})):[],shooters:r.enabled?r.shooters.map(s=>({...s})):[]},matched=[],extra=[];
    // Names without instance numbers, unless two would read the same ("Turret <1>" and "Turret <2>").
    const listed=c=>c.parts?.length?c.parts:[c.from],all=[...cad.intakes,...cad.shooters].flatMap(listed),shown=n=>all.some(o=>o!==n&&bareName(o)===bareName(n))?n:bareName(n);
    const names=c=>quoted(listed(c).map(shown));
    // Intakes: the team's, each given the CAD's intake of its kind (else the next one); then the CAD's others on free edges.
    const intakes=[...cad.intakes],taken=new Set(),placed=new Set(),hadIntakes=m.intakes.length>0,hadShooters=m.shooters.length>0;
    m.intakes=m.intakes.map((i,n)=>{let k=intakes.findIndex(c=>c.kind===i.kind);if(k<0&&intakes.length)k=0;if(k<0)return i;const c=intakes.splice(k,1)[0];c.sides.forEach(e=>taken.add(e));
      const kind=i.kind==='sweeper'&&deploys(c.kind)?c.kind:i.kind;
      matched.push(`Intake ${n+1} → ${names(c)}${kind!==i.kind?` (now a ${kind==='ramp'?'deployable ramp':'kicker'}: your CAD has one there)`:''}`);
      const next={...i,kind,sides:c.sides,reach:c.reach,width:c.width,height:c.height,...(c.parts?{parts:c.parts}:{})};delete next.at;placed.add(next);return next;});
    // An intake the CAD has nothing for keeps its sides where they are free, else takes a free edge.
    for(const i of m.intakes)if(!placed.has(i)){const free=i.sides.filter(e=>!taken.has(e));i.sides=free.length?free:[EDGES.find(e=>!taken.has(e))||i.sides[0]];i.sides.forEach(e=>taken.add(e));}
    for(const c of intakes.splice(0)){if(m.intakes.length<4&&c.sides.every(e=>!taken.has(e))){m.intakes.push({...c});c.sides.forEach(e=>taken.add(e));matched.push(`Intake ${m.intakes.length} → ${names(c)}${hadIntakes?' (added from your CAD)':''}`);}else intakes.push(c);}
    // Shooters: the team's, each given the CAD's shooter of the same pieces (else the next one); then the CAD's others.
    const shooters=[...cad.shooters];
    m.shooters=m.shooters.map((s,n)=>{let k=shooters.findIndex(c=>c.pieces===s.pieces);if(k<0&&shooters.length)k=0;if(k<0)return s;const c=shooters.splice(k,1)[0];
      matched.push(`Shooter ${n+1} → ${names(c)}`);return {...s,mount:c.mount,at:c.at,parts:c.parts};});
    for(const c of shooters.splice(0)){if(m.shooters.length<MAX_SHOOTERS){m.shooters.push({...c});matched.push(`Shooter ${m.shooters.length} → ${names(c)}${hadShooters?' (added from your CAD)':''}`);}else shooters.push(c);}
    for(const c of intakes)extra.push(`intake ${names(c)} (${c.sides[0]})`);for(const c of shooters)extra.push(`${c.type==='turret'?'turret':'shooter'} ${names(c)} (${PIECES[c.pieces].toLowerCase()})`);
    m.enabled=m.intakes.length+m.shooters.length>0;
    if(cad.capacity&&m.shooters.some(takesNectar)&&!m.capacity?.nectar)m.capacity=cad.capacity;
    return {mechanisms:sanitize(m),matched,extra};
  }
  // ---- a new front or top for the CAD -----------------------------------------------------------
  // The robot's front (or top) was set again on its CAD. What is tied to the CAD moves with it: an intake or shooter
  // from a part named in the CAD, or placed by clicking the model. One set with the side buttons stays where it is (those
  // sides are the robot's). turn: quarter turns counterclockwise (seen from above) that carried the model in the robot
  // frame, or null when the top changed too. before/after: fromCad() under the old and the new orientation; a named part
  // takes its new side, reach, mouth and height from it. Every other setting (kind, motors, power, timing) stays.
  const QUARTER={front:'left',left:'back',back:'right',right:'front'};
  function reoriented(raw,{turn=null,before=null,after=null}={}){
    const m=sanitize(raw);if(!m.enabled)return m;
    const turns=Number.isInteger(turn),q=turns?((turn%4)+4)%4:0,edge=e=>{for(let i=0;i<q;i++)e=QUARTER[e];return e;};
    const mount=k=>{let [x,y]=MOUNT_AT[k];for(let i=0;i<q;i++)[x,y]=[-y,x];return ORDER.find(o=>MOUNT_AT[o][0]===x&&MOUNT_AT[o][1]===y);};
    // A clicked spot (robot frame, from the chassis center) turns with the model; after a new top it no longer means anything.
    const spot=(out,at)=>{if(!at)return;if(!turns){delete out.at;return;}let {x,y}=at;for(let i=0;i<q;i++)[x,y]=[-y,x];out.at=point({...at,x,y});};
    m.intakes=m.intakes.map(i=>{const was=before?.intakes?.find(b=>i.sides.includes(b.sides[0])),now=was&&after?.intakes?.find(a=>a.from===was.from),out={...i};
      if(now)Object.assign(out,{sides:now.sides,reach:now.reach,width:now.width,height:now.height});else if(i.at)out.sides=i.sides.map(edge);
      spot(out,i.at);return out;});
    // Shooters are matched where the settings put the CAD's ones (two shooters never share the center).
    const placed=c=>sanitize({intakes:[],shooters:c?.shooters||[]}).shooters,was=placed(before),will=placed(after);
    m.shooters=m.shooters.map(s=>{const k=was.findIndex(b=>b.mount===s.mount),j=k<0?-1:after?.shooters?.findIndex(a=>a.from===before.shooters[k].from)??-1,now=j>=0?will[j]:null,out={...s};
      if(!now&&!s.at)return out;Object.assign(out,{mount:now?now.mount:mount(s.mount),facing:edge(s.facing)});spot(out,s.at);return out;});
    return sanitize(m);
  }
  // ---- preset robots ----------------------------------------------------------------------------
  // Ready-made robots: chassis and mechanisms, set together and not changed (Custom robot is for that). Three starter
  // robots: a mecanum kit bot that pushes pieces, on its Control Hub's IMU and drive motor encoders (adjustable: a team's own kit, so its size,
  // weight, wheels, power and wiring can be set to match), and the NYC FIRST A301 swerve as the fastest push
  // bot (drive: the card's drivetrain words, where the drivetrain's own name says less). Their CAD, joints, wiring,
  // sensors and demo routes are in ui/sim-preset-robots.js.
  const PRESETS={
    startermecanum:{name:'Starter Mecanum',blurb:'goBILDA Strafer-style kit bot: Control Hub IMU and motor encoders, pushes pieces. Set its size and wiring to match yours',adjustable:true,robot:{drivetrain:'mecanum',length:17.56,width:17.79,massLb:22,driveRpm:800}},
    a301swerve:{name:'A301 Swerve',blurb:'NYC FIRST A301 push bot: the fastest',robot:{drivetrain:'swerve',length:17,width:17,massLb:28,driveRpm:1150}}};
  // A preset's mechanisms, ready to use (on, 4 pollen preloaded, its own timing); a push bot's are off.
  const presetMechanisms=(id,base={})=>{if(!PRESETS[id])return null;const p=PRESETS[id].mechanisms;if(!p)return sanitize({...base,enabled:false});
    return sanitize({...base,...p,enabled:true,capacity:p.capacity||{pollen:4,nectar:0},preload:{pollen:4},transfer:p.transfer||base.transfer,indexer:{...base.indexer,...p.indexer},shooter:{...base.shooter,...p.shooter},target:null});};
  return {partKindOf,chained,onOneMotor,liftSeconds,PRESETS,presetMechanisms,mountOffset,bearingFrom,partRole,copies,copyBase,fromCad,adoptCad,reoriented,drivetrainFromNames,DEFAULTS,INTAKES,INTAKE_NOTES,SIDES,SIDE_EDGES,SHOOTERS,SHOOTER_NOTES,PIECES,MOUNTS,MOUNT_AT,FACING,EDGES,INDEXERS,INDEXER_NOTES,ROLLERS,FLYWHEELS,TURRETS,STORAGE_MAX,MAX_SHOOTERS,FIRE_RECOVERY,
    sanitize,hoodAt,readyAt,engineSpec,flowerKind,deploys,servoFeeder,pusherOnly,feedCycle,engineIntakeMount,target,action,actions,turretAction,hasRamp,prepare,summary,hasTurret,locate,mountOf,adjacent,PARTNER,travel,shootSeconds,FIRE_MARGIN,Model,Runner};
});
