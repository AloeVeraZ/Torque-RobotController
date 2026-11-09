'use strict';
// Reproducible local build of the simulator's third-party pieces. Inputs are the pinned,
// git-ignored upstream clones and dependency folders under .cache; outputs are git-ignored:
//   ui/vendor/        browser bundles, DSIM field models and license notices
//   sim-runtime/      DSIM headless physics bundle, compiled Deck controller, Java runtime
// Usage: node tools/simulation/build.cjs [--skip-java]
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'../..'),cache=path.join(root,'.cache'),deps=path.join(cache,'simulation-deps/node_modules'),runtime=path.join(cache,'simulation-runtime');
const upstream={dsim:{dir:path.join(cache,'upstream/dsim'),commit:'0df84143a52dde4c7c196fb21b94264a13da91b6'}};
// Must match tools/simulation/deps-package.json (installed into .cache/simulation-deps).
const versions={esbuild:'0.25.12','@dimforge/rapier2d-compat':'0.19.3','@dimforge/rapier3d-deterministic-compat':'0.20.0',three:'0.186.0','clipper-lib':'6.4.2',dijkstrajs:'1.0.3','occt-import-js':'0.0.23'};
const vendor=path.join(root,'ui/vendor'),out=path.join(root,'sim-runtime'),skipJava=process.argv.includes('--skip-java');
// --public: a build for redistribution. Third-party CAD whose terms do not allow redistribution (FIRST
// field models, vendor chassis) is left out; the app falls back to drawings and plain shapes.
const publicBuild=process.argv.includes('--public');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function check(){
  for(const [name,{dir,commit}] of Object.entries(upstream)){
    const head=execFileSync('git',['-C',dir,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
    if(head!==commit)throw Error(`${name} clone is at ${head}; expected pinned ${commit}.`);
    const dirty=execFileSync('git',['-C',dir,'status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim();
    if(dirty)throw Error(`${name} clone has local modifications:\n${dirty}`);
  }
  for(const [name,version] of Object.entries(versions)){const actual=JSON.parse(fs.readFileSync(path.join(deps,name,'package.json'),'utf8')).version;if(actual!==version)throw Error(`${name} ${actual} installed; expected ${version}.`);}
  const robots=JSON.parse(fs.readFileSync(path.join(root,'ui/assets/robots/catalog.json'),'utf8'));for(const id of ['strafer','swechanum'])if(fs.existsSync(path.join(root,'ui/assets/robots',id+'.glb.gz'))&&sha(path.join(root,'ui/assets/robots',id+'.glb.gz'))!==robots[id].assetSha256)throw Error(`Bundled ${id} CAD differs from its prepared hash.`);
}
function copy(from,to){fs.mkdirSync(path.dirname(to),{recursive:true});fs.cpSync(from,to,{recursive:true});}
async function bundles(){
  const esbuild=require(path.join(deps,'esbuild'));
  // DSIM's online-only modules stay out of the bundle; see stubs/discordActivity.ts.
  const stubs={name:'deck-dsim-stubs',setup(b){b.onResolve({filter:/net\/discordActivity$/},()=>({path:path.join(__dirname,'stubs/discordActivity.ts')}));}};
  // Offline robots use a typed intake reach rather than a game's fixed intake preset.
  const footprint={name:'deck-offline-footprint',setup(b){b.onLoad({filter:/[\\/]src[\\/]sim[\\/]field\.ts$/},args=>{const text=fs.readFileSync(args.path,'utf8'),from='const reach = C.INTAKE_PRESETS[spec.intake].reach;';if(text.split(from).length!==2)throw Error('Review the DSIM footprint adapter.');return {contents:text.split(from).join("const deckBoxes = (spec as RobotSpec & {deckIntakeBoxes?:Record<string,{reach:number}>}).deckIntakeBoxes; if (deckBoxes) { const out = (e: string) => (spec as RobotSpec & {deckBodyOnly?:boolean}).deckBodyOnly ? 0 : deckBoxes[e]?.reach ?? 0; return { front: spec.length / 2 + out('front'), rear: spec.length / 2 + out('back'), half: spec.width / 2 + Math.max(out('left'), out('right')) }; }\n  const reach = (spec as RobotSpec & {deckIntakeReach?:number}).deckIntakeReach ?? C.INTAKE_PRESETS[spec.intake].reach;"),loader:'ts'};});}};
  const pushbot={name:'deck-offline-pushbot',setup(b){b.onLoad({filter:/[\\/]games[\\/]biobuzz[\\/]sim3d[\\/]bodies\.ts$/},args=>{let text=fs.readFileSync(args.path,'utf8');const patches={
    'export function chassis3dShapes(spec: RobotSpec, heightIn: number): Chassis3dShape[] {':'const deckBoxes = (spec as RobotSpec & {deckIntakeBoxes?:Record<string,{reach:number}>}).deckIntakeBoxes; if (deckBoxes) { const o = (e: string) => (spec as RobotSpec & {deckBodyOnly?:boolean}).deckBodyOnly ? 0 : deckBoxes[e]?.reach ?? 0; return [{cx:(o("front")-o("back"))/2,cy:(o("left")-o("right"))/2,cz:0,hx:(spec.length+o("front")+o("back"))/2,hy:(spec.width+o("left")+o("right"))/2,hz:heightIn/2}]; }\nconst deckReach = (spec as RobotSpec & {deckIntakeReach?:number}).deckIntakeReach; if (deckReach !== undefined) return [{cx:deckReach/2,cy:0,cz:0,hx:(spec.length+deckReach)/2,hy:spec.width/2,hz:heightIn/2}];',
    'export function chassis3dPocketShapes(spec: RobotSpec, heightIn: number): Chassis3dShape[] {':'if ((spec as RobotSpec & {deckIntakeReach?:number}).deckIntakeReach !== undefined) return [];',
    // A deployed ramp keeps BIOBUZZ's blade and rails: the blade slides under a flower's bottom pollen and lifts
    // it off the lower ring plate. Without it the roller can only drag the pollen into the plate's rim, which
    // frees it only when the staged column happens to lean towards the wall (F1 and F3, never F2 or F4).
    'export function chassis3dReachShapes(spec: RobotSpec, heightIn: number, rampReady: boolean): Chassis3dShape[] {':'if ((spec as RobotSpec & {deckIntakeReach?:number}).deckIntakeReach !== undefined && bbIntakeKindOf(spec) !== "ramp") return [];'};
    for(const [from,code] of Object.entries(patches)){if(text.split(from).length!==2)throw Error('Review the BIOBUZZ pushbot collider adapter.');text=text.split(from).join(from+'\n'+code);}return {contents:text,loader:'ts'};});}};
  const barriers={name:'deck-offline-barriers',setup(b){b.onLoad({filter:/[\\/]sim[\\/]physicsEngine\.ts$/},args=>{let text=fs.readFileSync(args.path,'utf8'),from='function buildStatics(rw: RAPIER.World, colliders: FieldColliders, groups?: number, friction?: number): void {';if(text.split(from).length!==2)throw Error('Review 2D barrier adapter.');text=text.split(from).join(from+'\nfor (const points of (colliders as FieldColliders & {deckPolygons?:number[][]}).deckPolygons ?? []) { const desc=RAPIER.ColliderDesc.convexHull(new Float32Array(points)); if(desc) rw.createCollider(statics(desc,groups,friction)); }');return {contents:text,loader:'ts'};});
    b.onLoad({filter:/[\\/]sim3d[\\/]engineImpl\.ts$/},args=>{let text=fs.readFileSync(args.path,'utf8'),from='buildStatics3d(RAPIER, world3d, PHYS_WALL_FRICTION);';if(text.split(from).length!==2)throw Error('Review 3D barrier adapter.');text=text.split(from).join(from+'\nfor (const points of (world as World & {deckPolygons?:number[][]}).deckPolygons ?? []) { const p:number[]=[];for(let i=0;i<points.length;i+=2)for(const z of [0,12])p.push(points[i],points[i+1],z);const desc=RAPIER.ColliderDesc.convexHull(new Float32Array(p));if(desc)world3d.createCollider(desc.setFriction(PHYS_WALL_FRICTION).setRestitution(0)); }');return {contents:text,loader:'ts'};});
    b.onLoad({filter:/[\\/](sim[\\/]artifactSolids|games[\\/]biobuzz[\\/]robot)\.ts$/},args=>{let text=fs.readFileSync(args.path,'utf8').split('\r\n').join('\n'),from='): RobotSolids {\n  const hl = r.spec.length / 2;';if(text.split(from).length!==2)throw Error('Review pushbot element-solid adapter.');text=text.split(from).join('): RobotSolids {\nconst deckBoxes=(r.spec as RobotSpec & {deckIntakeBoxes?:Record<string,{reach:number}>}).deckIntakeBoxes;if(deckBoxes){const o=(e:string)=>(r.spec as RobotSpec & {deckBodyOnly?:boolean}).deckBodyOnly?0:deckBoxes[e]?.reach??0;return {chassis:{kind:"box",cx:(o("front")-o("back"))/2,cy:(o("left")-o("right"))/2,hx:(r.spec.length+o("front")+o("back"))/2,hy:(r.spec.width+o("left")+o("right"))/2},structure:[],held:[]};}\nconst deckReach=(r.spec as RobotSpec & {deckIntakeReach?:number}).deckIntakeReach;if(deckReach!==undefined)return {chassis:{kind:"box",cx:deckReach/2,cy:0,hx:(r.spec.length+deckReach)/2,hy:r.spec.width/2},structure:[],held:[]};\n  const hl = r.spec.length / 2;');
      // BIOBUZZ's robot.ts also takes the Deck mechanism-part patches (one loader per file).
      if(path.basename(args.path)==='robot.ts')text=patchMechanisms('robot.ts',text);return {contents:text,loader:'ts'};});}};
  // A documented reference motor replaces the online game's balancing constants.
  const current={name:'deck-reference-drive',setup(b){b.onLoad({filter:/[\\/]sim[\\/]drivetrain\.ts$/},args=>{let text=fs.readFileSync(args.path,'utf8').replaceAll('\r\n','\n');
    const start=text.indexOf('  const maxSpeed =',text.indexOf('export function driveParams')),end=text.indexOf('\n}\n',start);
    if(start<0||end<0)throw Error('Review reference drivetrain adapter.');
    text='import {referenceDrive} from '+JSON.stringify(path.join(__dirname,'reference-drive.ts').replaceAll('\\','/'))+';\n'+text.slice(0,start)+'  return referenceDrive(spec,p,rpm);'+text.slice(end);
    const torque='frac = Math.max(1 - C.MOTOR_TORQUE_CURVE * s, C.MOTOR_MIN_TORQUE_FRAC);';
    if(text.split(torque).length!==3)throw Error('Review voltage/torque curve adapter.');
    text=text.replace(torque,'frac = Math.max(0, Math.abs(target) / Math.max(vFree,1e-9) - s);').replace(torque,'frac = Math.max(0, hyp(tx,ty) / Math.max(vFree,1e-9) - s);');
    // Contact authority uses the same force budget as acceleration, rather than the game's shove score.
    const pushStart=text.indexOf('  const { p, rpm } = activeDrive(spec, tankMode);',text.indexOf('export function pushForce')),pushEnd=text.indexOf('\n}',pushStart);
    text=text.slice(0,pushStart)+'  return spec.massLb * driveParams(spec,tankMode).accel * (1-powerDraw);'+text.slice(pushEnd);
    return {contents:text,loader:'ts'};});}};
  // FLOAT zero-power behaviour: an unpowered axis coasts on friction instead of braking. Coast rates
  // are from a tuned DECODE mecanum robot's Pedro AutoTune (natural deceleration 83.6 in/s² forward,
  // 68.8 strafe); one robot's data, so an approximation. Powered braking is unchanged.
  const coast={name:'deck-float-coast',setup(b){b.onLoad({filter:/[\\/]sim[\\/]robot\.ts$/},args=>{let text=fs.readFileSync(args.path,'utf8');
    const move='    shoved ? C.MOTOR_SHOVE_BRAKE : C.MOTOR_BRAKE_MULT,',yaw='    shovedYaw ? C.MOTOR_SHOVE_BRAKE : C.MOTOR_BRAKE_MULT,';if(text.split(move).length!==2||text.split(yaw).length!==2)throw Error('Review float coast adapter.');
    const decel='((s: number, c: number, n: number) => (83.6 * c * c + (dp.strafeMult > 0 && dp.strafeMult < 1 ? 68.8 : 83.6) * n * n))(Math.hypot(velRobot.x, velRobot.y) || 1, velRobot.x / (Math.hypot(velRobot.x, velRobot.y) || 1), velRobot.y / (Math.hypot(velRobot.x, velRobot.y) || 1))';
    // Powered braking: the same robot's braking distance d(v) = l·v + q·v² (forward l 0.1323, q 0.0015;
    // strafe 0.0502, 0.0023; heading 0.0855, 0.0038) implies a(v) = v / (l + 2·q·v). It never falls
    // below the coast rate and never exceeds DSIM's traction-limited brake.
    const brake=(l,q,v,floor,cap)=>`Math.min(${cap}, Math.max(${floor}, ${v} / (${l} + 2 * ${q} * ${v})))`;
    const speed='Math.hypot(velRobot.x, velRobot.y)',forward=`Math.abs(velRobot.x) / (${speed} || 1)`;
    const linear=`(${forward} * ${forward} * ${brake(0.1323,0.0015,speed,83.6,'C.MOTOR_BRAKE_MULT * dp.accel')} + (1 - ${forward} * ${forward}) * ${brake('(dp.strafeMult > 0 && dp.strafeMult < 1 ? 0.0502 : 0.1323)','(dp.strafeMult > 0 && dp.strafeMult < 1 ? 0.0023 : 0.0015)',speed,'(dp.strafeMult > 0 && dp.strafeMult < 1 ? 68.8 : 83.6)','C.MOTOR_BRAKE_MULT * dp.accel')}) / Math.max(dp.accel, 1e-6)`;
    text=text.split(move).join(`    (r as RobotState & {deckFloat?: boolean}).deckFloat && unpowered ? ${decel} / Math.max(dp.accel, 1e-6) : shoved ? C.MOTOR_SHOVE_BRAKE : ${linear},`);
    // Static friction: a stopped chassis does not creep under less than ~4% power (FTC drive motors
    // need a few percent to break away), so a robot holding a point stays put under tiny corrections.
    const still='  const unpowered = targetFwd === 0 && targetStrafe === 0;';if(text.split(still).length!==2)throw Error('Review static friction adapter.');
    text=text.split(still).join(`  if (Math.hypot(velRobot.x, velRobot.y) < 0.5 && Math.hypot(targetFwd, targetStrafe) < 0.04 * dp.maxSpeed) { targetFwd = 0; targetStrafe = 0; }\n  if (Math.abs(r.angVel) < 0.02 && Math.abs(targetOmega) < 0.04 * dp.maxTurn) targetOmega = 0;\n${still}`);
    const radius='(Math.hypot(r.spec.length, r.spec.width) / 2)';
    text=text.split(yaw).join(`    (r as RobotState & {deckFloat?: boolean}).deckFloat && targetOmega === 0 ? 83.6 / ${radius} / Math.max(dp.turnAccel, 1e-6) : shovedYaw ? C.MOTOR_SHOVE_BRAKE : ${brake(0.0855,0.0038,'Math.abs(r.angVel)',`83.6 / ${radius}`,'C.MOTOR_BRAKE_MULT * dp.turnAccel')} / Math.max(dp.turnAccel, 1e-6),`);
    return {contents:text,loader:'ts'};});}};
  // A robot whose whole perimeter is an intake: BIOBUZZ's mounts stop at front, back, both ends or both
  // sides, so an 'all' mount puts a sweeper mouth on all four edges. Set after spawn (see sim-engine.cjs).
  // Deck mechanism parts the game's builder does not offer, all off unless the engine sets their spec fields:
  // intakes on any mix of sides ('all' or 'edges:front,left'), pollen and nectar capacity counted
  // separately (deckCaps), fixed shooters whose launcher keeps the heading the engine gives it (deckFixedYaw), and
  // what each shooter takes (deckShooterPieces: pollen, nectar or both), each intake's own box (deckIntakeBoxes: how far it sticks out, how wide its mouth is, how tall its opening is).
  const mechanismPatches={
    'mounts.ts':{'  const m = spec.intakeMount;\n':"  if ((spec.intakeMount as string) === 'all' || String(spec.intakeMount).startsWith('edges:')) return spec.intakeMount as BbIntakeMount;\n",
      'export function bbIntakeEdges(mount: BbIntakeMount): BbEdge[] {\n  switch (mount) {\n':"    case 'all' as BbIntakeMount:\n      return ['front', 'back', 'left', 'right'];\n    default:\n      if (String(mount).startsWith('edges:')) return String(mount).slice(6).split(',') as BbEdge[];\n"},
    'mechs.ts':{"  if (color !== 'red' && color !== 'blue') return true;\n":"  const deckCaps = (spec as { deckCaps?: { pollen: number; nectar: number } }).deckCaps;\n  if (deckCaps) return color !== 'red' && color !== 'blue' ? deckCaps.pollen > 0 : color === alliance && deckCaps.nectar > 0;\n"},
    'elements.ts':{'  if (r.hopper.length >= bbHopperCap(r.spec)) return false;\n':"  const deckCaps = (r.spec as { deckCaps?: { pollen: number; nectar: number } }).deckCaps;\n  if (deckCaps) {\n    const nectar = ball.color === 'red' || ball.color === 'blue';\n    if (r.hopper.filter((c) => (c === 'red' || c === 'blue') === nectar).length >= (nectar ? deckCaps.nectar : deckCaps.pollen)) return false;\n  }\n"},
    'robot.ts':{'  if (wantYaw !== null) {\n':"  if ((r.spec as { deckFixedYaw?: boolean[] }).deckFixedYaw?.[which]) wantYaw = null;\n",
      '  return bbIntakeEdges(bbIntakeMountOf(spec)).map((edge): LocalRect => {\n':"  const deckBoxes = (spec as { deckIntakeBoxes?: Record<string, { reach: number; width: number }> }).deckIntakeBoxes;\n  if (deckBoxes) return bbIntakeEdges(bbIntakeMountOf(spec)).map((edge): LocalRect => {\n    const box = deckBoxes[edge] ?? { reach: 0, width: edge === 'front' || edge === 'back' ? spec.width : spec.length };\n    const h = box.width / 2;\n    if (edge === 'front') return { edge, x0: hl - it.depth, x1: hl + box.reach, y0: -h, y1: h };\n    if (edge === 'back') return { edge, x0: -hl - box.reach, x1: -hl + it.depth, y0: -h, y1: h };\n    if (edge === 'left') return { edge, x0: -h, x1: h, y0: flankInner, y1: hw + box.reach };\n    return { edge, x0: -h, x1: h, y0: -hw - box.reach, y1: -flankInner };\n  });\n",
      '      if (bbTurretFor(launcher, isNectarColour(c)) === which) return c;\n':"      const deckPieces = (r.spec as { deckShooterPieces?: string[] }).deckShooterPieces;\n      if (deckPieces) { if (deckPieces[which] === 'both' || (deckPieces[which] === 'nectar') === isNectarColour(c)) return c; continue; }\n",
      // An intake box is part of the solid robot, so pieces seat at its outer face (the roller line).
      // With a roller column (deckIntakeBoxes[edge].column) a piece in the mouth is taken only when it touches the rollers: its
      // centre within the wheels' radius plus its own of their axle, between the end wheels, seen from above: a ramp lifts it
      // into rollers that sit above the floor, and the box's opening height still decides what fits.
      '  const lowFlight = opts.lowFlight ?? false;\n':"  if ((r.spec as { deckIntakeBoxes?: object }).deckIntakeBoxes) opts = { ...opts, seat: 'footprint' };\n",
      '      if (!(Math.abs(v) < g.half)) continue;\n':"      if ((r.spec as { deckIntakeBoxes?: Record<string, { off?: boolean }> }).deckIntakeBoxes?.[mouths[i].edge]?.off) continue;\n      const deckHeight = (r.spec as { deckIntakeBoxes?: Record<string, { height: number }> }).deckIntakeBoxes?.[mouths[i].edge]?.height;\n      if (deckHeight !== undefined && (2 * er > deckHeight || b.z > deckHeight)) continue;\n      const deckCol = (r.spec as { deckIntakeBoxes?: Record<string, { column?: { a: number[]; b: number[]; r: number } }> }).deckIntakeBoxes?.[mouths[i].edge]?.column;\n      if (deckCol) {\n        const ca = deckCol.a, cd = [deckCol.b[0] - ca[0], deckCol.b[1] - ca[1]], cw = [local.x - ca[0], local.y - ca[1]];\n        const cl = cd[0] * cd[0] + cd[1] * cd[1], ct = cl > 0 ? Math.max(0, Math.min(1, (cw[0] * cd[0] + cw[1] * cd[1]) / cl)) : 0;\n        if (Math.hypot(cw[0] - ct * cd[0], cw[1] - ct * cd[1]) > deckCol.r + er + BB_INTAKE_LIP) continue;\n      }\n"},
    // Only the sides of the intake the physics' kind describes reach into flowers (deckIntakeBoxes flower), and not while
    // that intake is up (off: a ramp still folding down).
    'play.ts':{'    for (const m of mouths) {\n      const ax = mouthAxes(m, hl, hw);\n':"      const deckBox = (r.spec as { deckIntakeBoxes?: Record<string, { off?: boolean; flower?: boolean }> }).deckIntakeBoxes?.[m.edge];\n      if (deckBox && (deckBox.off || deckBox.flower === false)) continue;\n"}};
  // Each patch goes just before (robot.ts, mechs.ts, elements.ts) or just after (mounts.ts, play.ts) its anchor.
  function patchMechanisms(file,text){const after=file==='mounts.ts'||file==='play.ts';
    for(const [from,code] of Object.entries(mechanismPatches[file])){if(text.split(from).length!==2)throw Error('Review the Deck mechanism adapter for '+file+'.');text=text.split(from).join(after?from+code:code+from);}return text;}
  // robot.ts is loaded by the element-solid adapter above, which applies its patches.
  const mechanisms={name:'deck-mechanism-parts',setup(b){b.onLoad({filter:/[\\/]games[\\/]biobuzz[\\/](mounts|mechs|elements|play)\.ts$/},args=>({contents:patchMechanisms(path.basename(args.path),fs.readFileSync(args.path,'utf8').replaceAll('\r\n','\n')),loader:'ts'}));}};
  const common={bundle:true,logLevel:'warning',nodePaths:[deps],alias:{dsim:upstream.dsim.dir},plugins:[stubs,footprint,pushbot,barriers,current,coast,mechanisms],legalComments:'eof',target:'es2022',minify:true,
    define:{'import.meta.env':JSON.stringify({BASE_URL:'deck-asset://dsim/',DEV:false,PROD:true,MODE:'production'})}};
  await esbuild.build({...common,entryPoints:[path.join(__dirname,'planning-entry.js')],format:'iife',globalName:'DeckPlanningLibs',platform:'browser',outfile:path.join(vendor,'planning.js')});
  await esbuild.build({...common,entryPoints:[path.join(__dirname,'planning-entry.js')],format:'cjs',platform:'node',outfile:path.join(vendor,'planning.cjs')});
  await esbuild.build({...common,entryPoints:[path.join(__dirname,'dsim-host-entry.ts')],format:'cjs',platform:'node',outfile:path.join(out,'dsim-host.cjs')});
  await esbuild.build({...common,define:{'import.meta.env':JSON.stringify({BASE_URL:'./vendor/',DEV:false,PROD:true,MODE:'production'})},entryPoints:[path.join(__dirname,'view-entry.js')],format:'iife',globalName:'DeckThree',platform:'browser',outfile:path.join(vendor,'three-view.js')});
}
function assets(){
  fs.rmSync(path.join(vendor,'models'),{recursive:true,force:true});
  if(!publicBuild)for(const name of ['field.glb','field-low.glb','elements.glb','README.md'])copy(path.join(upstream.dsim.dir,'public/models/biobuzz',name),path.join(vendor,'models/biobuzz',name));
  const decode=path.join(root,'ui/assets/fields/decode.glb.gz');if(!publicBuild&&fs.existsSync(decode)){if(sha(decode)!=='7fd6aac73fead31e75f9e654a6437a45ca1916f5b481c0a7ca8cdeeb475370e9')throw Error('DECODE field CAD changed; review its source and hash.');fs.mkdirSync(path.join(vendor,'models/decode'),{recursive:true});fs.writeFileSync(path.join(vendor,'models/decode/field.glb'),require('node:zlib').gunzipSync(fs.readFileSync(decode)));}
  for(const stale of ['dsim','dsim-view.js'])fs.rmSync(path.join(vendor,stale),{recursive:true,force:true});
  const occt=path.join(deps,'occt-import-js/dist');for(const file of ['occt-import-js.js','occt-import-js.wasm'])copy(path.join(occt,file),path.join(out,'occt',file));
  const licenses=path.join(vendor,'licenses');fs.rmSync(licenses,{recursive:true,force:true});fs.mkdirSync(licenses,{recursive:true});
  const notices={'DSIM-LICENSE':path.join(upstream.dsim.dir,'LICENSE'),'DSIM-NOTICE':path.join(upstream.dsim.dir,'NOTICE'),'PEDRO-LICENSE':path.join(root,'docs/PEDRO-ADAPTER-LICENSE.txt'),
    'OCCT-IMPORT-JS-LICENSE':path.join(deps,'occt-import-js/dist/license.occt-import-js.txt'),'OPENCASCADE-LICENSE':path.join(deps,'occt-import-js/dist/license.occt.txt'),'THREE-LICENSE':path.join(deps,'three/LICENSE'),
    'RAPIER3D-LICENSE':path.join(deps,'@dimforge/rapier3d-deterministic-compat/LICENSE'),'DIJKSTRAJS-LICENSE':path.join(deps,'dijkstrajs/LICENSE.md')};
  for(const [name,file] of Object.entries(notices)){if(!fs.existsSync(file))throw Error('Missing license file '+file);fs.copyFileSync(file,path.join(licenses,name));}
  // The CAD notices describe CAD that only personal local builds include.
  for(const [from,name] of [['ui/assets/robots/NOTICES.md','ROBOT-CAD-NOTICES.md'],['ui/assets/fields/NOTICES.md','FIELD-CAD-NOTICES.md']]){
    if(publicBuild)fs.rmSync(path.join(licenses,name),{force:true});else fs.copyFileSync(path.join(root,from),path.join(licenses,name));}
  // These two packages ship their terms in package metadata or a source header, not a file.
  fs.writeFileSync(path.join(licenses,'RAPIER2D-NOTICE.txt'),'@dimforge/rapier2d-compat 0.19.3 is licensed under the Apache License 2.0 (package.json "license": "Apache-2.0"). Its npm package omits the text; RAPIER3D-LICENSE is the same Apache-2.0 license from the same authors (Dimforge).\n');
  const clipper=fs.readFileSync(path.join(deps,'clipper-lib/clipper.js'),'utf8'),header=clipper.slice(0,clipper.indexOf('*/')+2);
  if(!/Boost Software License/.test(header))throw Error('Clipper license header not found.');fs.writeFileSync(path.join(licenses,'CLIPPER-NOTICE.txt'),header+'\n\nBoost Software License 1.0: https://www.boost.org/LICENSE_1_0.txt\n');
}
function java(){
  // A macOS JDK keeps its tools under Contents/Home.
  const top=fs.readdirSync(path.join(runtime,'jdk')).map(d=>path.join(runtime,'jdk',d))[0],jdk=fs.existsSync(path.join(top,'Contents/Home'))?path.join(top,'Contents/Home'):top,javac=path.join(jdk,'bin',process.platform==='win32'?'javac.exe':'javac');
  const build=path.join(cache,'simulation-build'),src=path.join(build,'src'),classes=path.join(out,'driver/classes');
  // Retire the old generated follower directory before packaging an updated build.
  const retired=path.resolve(out,'pedro');if(path.dirname(retired)!==path.resolve(out))throw Error('Invalid retired runtime path.');
  fs.rmSync(retired,{recursive:true,force:true});
  fs.rmSync(build,{recursive:true,force:true});fs.rmSync(classes,{recursive:true,force:true});fs.mkdirSync(src,{recursive:true});
  copy(path.join(__dirname,'java'),src);
  const files=walk(src).filter(f=>f.endsWith('.java')),list=path.join(build,'sources.txt');fs.writeFileSync(list,files.map(f=>'"'+f.replace(/\\/g,'/')+'"').join('\n'));
  fs.mkdirSync(classes,{recursive:true});
  execFileSync(javac,['--release','17','-encoding','UTF-8','-nowarn','-cp',path.join(runtime,'gson.jar'),'-d',classes,'@'+list],{stdio:'inherit'});
  fs.copyFileSync(path.join(runtime,'gson.jar'),path.join(out,'driver/gson.jar'));
  fs.writeFileSync(path.join(out,'driver/GSON-NOTICE.txt'),'Gson 2.11.0 (com.google.code.gson:gson), Apache License 2.0. Copyright 2008 Google Inc.\nhttps://www.apache.org/licenses/LICENSE-2.0\n');
  // This machine's reduced runtime (tools/simulation/fetch.cjs builds one per platform; releases ship
  // them beside the app instead, see tools/package.py).
  const hostRuntime=[path.join(runtime,`java-${process.platform}-${process.arch}`),path.join(runtime,'java')].find(d=>fs.existsSync(d));
  fs.rmSync(path.join(out,'java'),{recursive:true,force:true});copy(hostRuntime,path.join(out,'java'));
  return 0;
}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
(async()=>{
  check();fs.mkdirSync(vendor,{recursive:true});fs.mkdirSync(out,{recursive:true});
  const followerSource=fs.readFileSync(path.join(__dirname,'java/deck/pathing/DeckFollower.java'),'utf8');fs.writeFileSync(path.join(root,'ui/sim-follower-source.js'),'(function(r){const s='+JSON.stringify(followerSource)+';if(typeof module===\"object\"&&module.exports)module.exports=s;else r.DeckFollowerSource=s;})(globalThis);\n');
  await bundles();assets();const clockReads=skipJava?null:java();
  const files=[...walk(vendor),...walk(path.join(root,'ui/assets/robots')).filter(f=>!f.endsWith('.glb')),...walk(path.join(root,'ui/assets/fields')),...['dsim-host.cjs','occt/occt-import-js.js','occt/occt-import-js.wasm'].map(f=>path.join(out,f))].filter(f=>!f.includes(path.sep+'licenses'+path.sep));
  let previous=null;try{previous=JSON.parse(fs.readFileSync(path.join(out,'manifest.json'),'utf8')).java;}catch{}
  const manifest={upstream:Object.fromEntries(Object.entries(upstream).map(([k,v])=>[k,v.commit])),versions,java:skipJava?previous:{runtime:fs.readFileSync(path.join(out,'java/release'),'utf8').match(/JAVA_VERSION="([^"]+)"/)[1],gson:'2.11.0',controller:'deck',clock:'injected simulation clock'},
    outputs:Object.fromEntries(files.map(f=>[path.relative(root,f).replace(/\\/g,'/'),sha(f)]))};
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,1));
  console.log('Simulation build complete:',Object.keys(manifest.outputs).length,'outputs.');
})().catch(e=>{console.error(e.message||e);process.exitCode=1;});
