'use strict';
// Robot CAD import for the simulator. A STEP assembly is tessellated by OpenCascade
// (occt-import-js, LGPL-2.1) and every part is merged into ONE rigid body: no joints, no
// articulation, one draw call. The model is visual; the collision footprint stays the robot
// settings the team enters.
//
// Speed: one OpenCascade read of a big assembly is single-threaded and slows down badly with size (a 150 MB
// robot took 10 minutes and still failed to mesh). The file is split into pieces of whole solids, each keeping the
// assembly structure (step-split.cjs), and the pieces are read at the same time on worker threads. A finished
// import is cached by the file's contents, so loading the same CAD again is immediate.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{Worker}=require('node:worker_threads');
const {plan}=require('./step-split.cjs'),{swapMarkers}=require('./step-hull.cjs');
// CACHE_VERSION: 4 since an assembly holding two mechanisms is split into them (groups) and a part named as its own
// instance ("Flywheel" in "Flywheel <1>") is one node of the tree, so a robot imported before is read again.
const STEP_LIMIT=200*1024*1024,TRIANGLE_LIMIT=2500000,PIECE_BYTES=2.5*1024*1024,CACHE_VERSION=4;
let compiled=null;
const wasmModule=runtimeDir=>compiled||=WebAssembly.compile(fs.readFileSync(path.join(runtimeDir,'occt','occt-import-js.wasm')));
// Facet size in inches: fine on a part, coarser on a whole big robot (it is a visual model).
const deflectionFor=size=>size>60*1024*1024?.04:size>15*1024*1024?.025:.012;
function merge(meshes){
  let vertices=0,triangles=0;for(const m of meshes){vertices+=m.position.length/3;triangles+=m.index.length/3;}
  // part: which mesh (part instance) each vertex belongs to, so a click on the body finds its part.
  const positions=new Float32Array(vertices*3),normals=new Float32Array(vertices*3),colors=new Uint8Array(vertices*3),index=new Uint32Array(triangles*3),part=new Float32Array(vertices);
  let v=0,t=0;
  for(const [k,m] of meshes.entries()){
    const p=m.position,n=m.normal,c=(m.color||[.62,.65,.7]).map(x=>Math.round(Math.max(0,Math.min(1,x))*255)),count=p.length/3;
    positions.set(p,v*3);if(n&&n.length===p.length)normals.set(n,v*3);
    for(let i=0;i<count;i++){colors[(v+i)*3]=c[0];colors[(v+i)*3+1]=c[1];colors[(v+i)*3+2]=c[2];}
    const idx=m.index;for(let i=0;i<idx.length;i++)index[t+i]=idx[i]+v;
    part.fill(k,v,v+count);v+=count;t+=idx.length;
  }
  return {positions,normals,colors,index,part,parts:meshes.length,triangles};
}
// The assembly's named parts: the first level of the name tree that splits it into several assemblies (chassis,
// intake, shooter...), each with its bounding box (inches, file frame) and the names inside it. Every mesh
// carries the assembly names above it, so the pieces' meshes group the same way the whole file would.
// An assembly that holds two mechanisms of its own (two turrets in one "Shooter" assembly, "Turret <1>" and
// "Turret <2>", "Left intake" and "Right intake") is split into them, so each is found as its own mechanism; what is left
// of it (its frame, brackets) keeps its name and key, and its key above theirs says it holds them.
// Parts of one mechanism are not mechanisms of their own: an intake's "Intake roller top" and "Intake roller bottom" are
// one intake, a shooter's (or turret's) "Top flywheel" and "Bottom flywheel" one shooter ("Shooters" holds several).
const SHOOTER_WORDS=/turret|shoot|launch|cannon/i,SHOOTER_PARTS=/fly ?wheel|\bhood\b/i;
const MECHANISM_WORDS=/turret|shoot|launch|fly ?wheel|cannon|intake|ramp|kicker|deploy|sweeper|collector/i,HARDWARE_WORDS=/\b(ring|gear|bearing|plate|base|mount|bracket|spacer|shaft|axle|bolt|screw|nut|washer|standoff|belt|pulley|motor|servo|roller|(?<!fly ?)wheel)s?\b/i;
const SIDE_WORDS=new Set(['left','right','front','back','rear','l','r','lh','rh','a','b','one','two','first','second','1st','2nd','top','bottom','upper','lower','inner','outer']);
const copyBase=name=>String(name||'').toLowerCase().replace(/<(\d+)>/g,' $1 ').replace(/([a-z])(\d)/g,'$1 $2').replace(/(\d)([a-z])/g,'$1 $2').split(/[^a-z0-9]+/).filter(w=>w&&!SIDE_WORDS.has(w)&&!/^\d+$/.test(w)).join(' ');
function mechanismsIn(n,all){
  const partOf=c=>SHOOTER_WORDS.test(n.name||'')&&!/(turret|shooter|launcher|cannon)s\b/i.test(n.name||'')&&SHOOTER_PARTS.test(c.name)&&!SHOOTER_WORDS.test(c.name);
  const kids=[...n.children.values()].filter(c=>all(c).length>=2&&MECHANISM_WORDS.test(c.name)&&!HARDWARE_WORDS.test(c.name)&&!partOf(c));
  // Copies of one sub-assembly (instances, or left and right), or two shooter assemblies (a pollen and a nectar turret).
  const copies=kids.filter(c=>kids.some(d=>d!==c&&d.name.trim().toLowerCase()!==c.name.trim().toLowerCase()&&copyBase(c.name)&&copyBase(c.name)===copyBase(d.name)));
  const shooters=kids.filter(c=>/turret|shoot|launch|fly ?wheel|cannon/i.test(c.name));
  return copies.length>=2?copies:shooters.length>=2?shooters:[];
}
function groups(meshes){
  const tree={children:new Map(),meshes:[]};
  meshes.forEach((m,i)=>{let node=tree;for(const name of m.path||[]){let next=node.children.get(name);if(!next)node.children.set(name,next={name,key:(node.key?node.key+'/':'')+name,children:new Map(),meshes:[]});node=next;}node.meshes.push(i);});
  let level=tree;while(level.children.size===1&&!level.meshes.length)level=[...level.children.values()][0];
  if(level.children.size<2)return [];
  // The names inside an assembly: its sub-assemblies and its parts. A part the reader filed straight into the assembly's
  // node (no instance of its own) is named by its mesh ("Flywheel" in "Turret <1>"); one named as its instance ("Flywheel"
  // in "Flywheel <1>", "Flywheel-1", "Flywheel v1:1") is not named twice.
  const instanceOf=(node,x)=>node.startsWith(x)&&/^(\s*<\d+>|[-_ ]\d+|\s+v\d+:\d+|:\d+)?$/.test(node.slice(x.length));
  const own=n=>[...new Set(n.meshes.map(i=>String(meshes[i].name||'')).filter(x=>x&&!instanceOf(String(n.name||''),x)))];
  const all=(n,out=[])=>{out.push(...n.meshes);for(const c of n.children.values())all(c,out);return out;},inner=(n,out=[])=>{for(const x of own(n))if(out.length<24)out.push(x);for(const c of n.children.values()){if(out.length<24)out.push(c.name);inner(c,out);}return out;};
  const group=(n,list,names)=>{const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(const i of list){const p=meshes[i].position;for(let k=0;k<p.length;k+=3)for(let a=0;a<3;a++){const v=p[k+a];if(v<lo[a])lo[a]=v;if(v>hi[a])hi[a]=v;}}
    return lo.every(Number.isFinite)?{name:String(n.name||'').slice(0,80),key:n.key,inner:names.map(v=>String(v).slice(0,80)),box:[...lo,...hi].map(v=>+v.toFixed(3))}:null;};
  // Each top assembly, or the mechanisms inside it and what is left of it (two levels down at most).
  const out=[],visit=(n,depth)=>{const inside=depth<2?mechanismsIn(n,all):[];if(!inside.length){out.push(group(n,all(n),inner(n)));return;}
    const rest=[...n.meshes],restNames=own(n);for(const c of n.children.values())if(!inside.includes(c)){rest.push(...all(c));restNames.push(c.name,...inner(c));}
    if(rest.length)out.push(group(n,rest,restNames.slice(0,24)));for(const c of inside)visit(c,depth+1);};
  for(const n of level.children.values())visit(n,0);
  return out.filter(Boolean).slice(0,64);
}
// The assembly tree for picking parts: nodes {name, parent} (-1 for the top) and, per mesh, its own node. A mesh
// named differently from the assembly it sits in (a part of a part) gets a node of its own.
function tree(meshes){
  const nodes=[],key=new Map(),node=(name,parent)=>{const k=parent+'/'+name;let i=key.get(k);if(i===undefined){i=nodes.length;key.set(k,i);nodes.push({name:String(name).slice(0,80),parent});}return i;};
  const leaf=meshes.map(m=>{let at=-1;for(const name of m.path||[])at=node(name,at);const own=String(m.name||'');if(own&&own!==String((m.path||[]).at(-1)||'').replace(/\s*<\d+>$/,''))at=node(own,at);return at<0?node('Part',-1):at;});
  return {nodes,leaf};
}
// Every distinct assembly and part name ("104mm Mecanum Wheel"...), without instance numbers.
function names(meshes){const out=new Set();for(const m of meshes)for(const name of [...(m.path||[]),m.name])if(name&&out.size<2000)out.add(String(name).replace(/\s*<\d+>$/,'').slice(0,80));return [...out];}
// Reads the pieces `ids` on up to `threads` workers, each with paramsFor(id); done(id, meshes) and progress(done,total)
// after each.
async function readPieces(planned,ids,runtimeDir,paramsFor,threads,{progress,done:read}={}){
  const module=await wasmModule(runtimeDir),total=ids.length;let next=0,done=0;
  const workers=Array.from({length:Math.min(threads,total)},()=>new Worker(path.join(__dirname,'step-worker.cjs'),{workerData:{runtimeDir,module}}));
  try{
    await Promise.all(workers.map(worker=>new Promise((resolve,reject)=>{
      const send=()=>{if(next>=total)return resolve();const id=ids[next++];worker.postMessage({id,bytes:Buffer.from(planned.piece(id),'latin1'),params:paramsFor(id)});};
      worker.on('message',m=>{if(!m.ok)return reject(Error(m.error));read?.(m.id,m.meshes);progress?.(++done,total);send();});
      worker.on('error',reject);worker.on('exit',code=>{if(code)reject(Error(`The CAD reader stopped (code ${code}).`));});
      send();})));
  }finally{for(const w of workers)void w.terminate();}
}
const cacheFile=(dir,key)=>dir&&path.join(dir,`${key}.bin`);
// An import as bytes (the cache's layout; a prepared bundled robot, ui/assets/robots/*.deck.gz, is one gzipped): a JSON
// header, then the merged arrays.
function decodeImport(buf){
  const head=buf.readUInt32LE(0),meta=JSON.parse(buf.subarray(4,4+head).toString('utf8'));let at=4+head;
  const take=(Type,count)=>{const out=new Type(count);Buffer.from(out.buffer).set(buf.subarray(at,at+out.byteLength));at+=out.byteLength;return out;};
  const positions=take(Float32Array,meta.vertices*3),normals=take(Float32Array,meta.vertices*3),colors=take(Uint8Array,meta.vertices*3),index=take(Uint32Array,meta.triangles*3),part=take(Float32Array,meta.vertices);
  return {...meta.info,positions,normals,colors,index,part};
}
function encodeImport(value){
  const {positions,normals,colors,index,part,...info}=value,meta=Buffer.from(JSON.stringify({vertices:positions.length/3,triangles:index.length/3,info}),'utf8'),head=Buffer.alloc(4);head.writeUInt32LE(meta.length);
  return Buffer.concat([head,meta,...[positions,normals,colors,index,part].map(a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength))]);
}
function readCache(file){try{return decodeImport(fs.readFileSync(file));}catch{return null;}}
function writeCache(file,value){
  try{fs.mkdirSync(path.dirname(file),{recursive:true});
    // Keep the newest few imports.
    const dir=path.dirname(file),old=fs.readdirSync(dir).filter(f=>f.endsWith('.bin')).map(f=>({f,t:fs.statSync(path.join(dir,f)).mtimeMs})).sort((a,b)=>b.t-a.t).slice(5);for(const {f} of old)fs.rmSync(path.join(dir,f),{force:true});
    const tmp=file+'.tmp';fs.writeFileSync(tmp,encodeImport(value));fs.renameSync(tmp,file);}catch{}
}
// Every part is read exactly. `exactBytes` (tests) turns solids beyond that much geometry into hulls instead.
async function convertStep(file,runtimeDir,{cacheDir=null,progress=null,threads=null,pieces=null,exactBytes=Infinity}={}){
  if(typeof file!=='string'||!/\.(step|stp)$/i.test(file))throw Error('Choose a .step or .stp file.');
  const size=fs.statSync(file).size;if(size>STEP_LIMIT)throw Error(`${path.basename(file)} is larger than 200 MB.`);
  const bytes=fs.readFileSync(file),key=crypto.createHash('sha256').update(bytes).digest('hex').slice(0,32)+'-v'+CACHE_VERSION,cached=readCache(cacheFile(cacheDir,key));
  if(cached)return {...cached,name:path.basename(file),cached:true};
  progress?.({stage:'split'});
  const text=bytes.toString('latin1'),cores=threads||Math.max(1,Math.min(8,(os.availableParallelism?.()||os.cpus().length)-1));
  const planned=plan(text,pieces||(size<PIECE_BYTES?1:Math.max(cores,Math.min(64,Math.ceil(size/PIECE_BYTES)))),{exact:exactBytes});
  // The facet size is chosen while reading. Reading a piece takes as long at any facet size (OpenCascade's time goes into
  // the solids, not the triangles), so reading the robot twice to make it lighter doubled the import. From the pieces read
  // so far (triangles per byte of geometry) the whole robot's triangles are projected, and a robot heading past
  // TRIANGLE_LIMIT reads its other pieces coarser (triangles go about as facet size^-0.4 on robot parts). Pieces read
  // finer are read again only when the robot ends far over the limit.
  const count=planned.count,loads=planned.loads||new Array(count).fill(1),totalLoad=loads.reduce((a,b)=>a+b,0)||1,got=new Array(count),used=new Array(count),tris=new Array(count).fill(0);
  let deflection=deflectionFor(size),meshes,triangles,load=0;
  const paramsFor=id=>{used[id]=deflection;return {linearUnit:'inch',linearDeflectionType:'absolute_value',linearDeflection:deflection,angularDeflection:.5};};
  const read=(id,list)=>{
    // Heavy parts came back as markers: each becomes its hull where the assembly placed it.
    if(planned.shapes.length)for(const m of list){const swapped=swapMarkers(m,planned.shapes);if(swapped)Object.assign(m,swapped);}
    got[id]=list;tris[id]=list.reduce((n,m)=>n+m.index.length/3,0);
    load=0;for(let k=0;k<count;k++)if(got[k])load+=loads[k];
    const projected=()=>{let n=0;for(let k=0;k<count;k++)if(got[k])n+=tris[k]*(used[k]/deflection)**.4;return n/load*totalLoad;};
    if(load>=totalLoad*.04)while(projected()>TRIANGLE_LIMIT*.85&&deflection<.5)deflection*=1.5;};
  let ids=[...Array(count).keys()];
  for(let pass=0;pass<4&&ids.length;pass++){
    await readPieces(planned,ids,runtimeDir,paramsFor,cores,{done:read,progress:(done,total)=>progress?.({stage:'read',done,total})});
    triangles=tris.reduce((a,b)=>a+b,0);if(triangles<=TRIANGLE_LIMIT*(pass?1:1.4))break;
    if(!ids.some(id=>used[id]<deflection))deflection*=3;ids=ids.filter(id=>used[id]<deflection);
  }
  meshes=got.flat();
  if(!meshes.length)throw Error('That STEP file has no solid parts. Export it again as STEP AP214 or AP242.');
  if(!triangles)throw Error('The CAD reader found parts but could not mesh them. Export the robot as a GLB, STL or OBJ mesh instead.');
  const value={name:path.basename(file),...merge(meshes),tree:tree(meshes),groups:groups(meshes),names:names(meshes),pieces:planned.count,simplified:meshes.reduce((n,m)=>n+(m.hulls||0),0)};
  if(cacheDir)writeCache(cacheFile(cacheDir,key),value);
  return value;
}
module.exports={convertStep,merge,groups,tree,names,deflectionFor,decodeImport,encodeImport,STEP_LIMIT};
