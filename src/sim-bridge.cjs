'use strict';
// Main-process side of the offline simulator: owns the simulation utility process, relays its
// messages to the driver station window and handles local files
// (projects, robot models, route exports, Java programs). Nothing here talks to a robot; leaving
// the Simulation view kills the utility process (and with it any Java program).
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const MESH_TYPES={'.glb':'glb','.gltf':'gltf','.stl':'stl','.obj':'obj'},STEP_TYPES=['.step','.stp'];
const MODEL_LIMIT=200*1024*1024,STORED_LIMIT=150*1024*1024,SOURCE_LIMIT=200*1024,PROJECT_LIMIT=150*1024*1024,EXPORT_LIMIT=4*1024*1024;
const EXPORTS={onbot:{name:'OnBot Java autonomous',extensions:['java']},java:{name:'Route Java',extensions:['java']},pp:{name:'Deck path file',extensions:['pp']},timed:{name:'Timed drive commands',extensions:['json']},motionmodule:{name:'MotionModule autonomous',extensions:['py']},config:{name:'Robot configuration',extensions:['xml']}};
const validKey=key=>typeof key==='string'&&/^[\w-]{1,64}$/.test(key);

class SimulationHost{
  constructor({utilityProcess,dataDir,emit}){this.utilityProcess=utilityProcess;this.dataDir=dataDir;this.emit=emit;this.proc=null;this.pending=new Map();this.nextId=1;}
  get running(){return !!this.proc;}
  start(){
    if(this.proc)return this.proc;
    const work=path.join(this.dataDir,'simulation','work');fs.mkdirSync(work,{recursive:true});
    const proc=this.utilityProcess.fork(path.join(__dirname,'sim-host.cjs'),[work],{serviceName:'Torque simulation',stdio:'pipe'});
    let stderr='';proc.stderr?.on('data',d=>{stderr=(stderr+d).slice(-4000);});proc.stdout?.on('data',()=>{});
    proc.on('message',message=>{
      if(proc!==this.proc)return;
      if(message?.type==='reply'){const p=this.pending.get(message.id);if(!p)return;this.pending.delete(message.id);clearTimeout(p.timer);message.ok?p.resolve(message.value):p.reject(Error(message.error));return;}
      this.emit(message);
    });
    proc.on('exit',code=>{if(proc!==this.proc)return;this.proc=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('The simulation process stopped.'));}this.pending.clear();
      this.emit({type:'host-exit',code,error:code?`The simulation process stopped unexpectedly (code ${code}). ${stderr.trim().split('\n').slice(-3).join(' ')}`.trim():''});});
    this.proc=proc;return proc;
  }
  call(method,args=[]){
    if(typeof method!=='string'||!Array.isArray(args))return Promise.reject(Error('Invalid simulator call.'));
    const proc=this.start(),id=this.nextId++,timeout={run:60000,practice:60000,load:30000,evaluate:180000,convertStep:1200000}[method]||10000;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('The simulator did not respond.'));},timeout);this.pending.set(id,{resolve,reject,timer});proc.postMessage({id,method,args});});
  }
  // A STEP file is read in its own utility process (sim-model-host.cjs, which reads pieces on worker threads) so a
  // big assembly does not stall the simulator; progress goes to the window. Finished imports are cached by content.
  // Bounded at 20 minutes.
  convertStep(file){
    return new Promise((resolve,reject)=>{
      const proc=this.utilityProcess.fork(path.join(__dirname,'sim-model-host.cjs'),[],{serviceName:'Torque CAD import',stdio:'pipe'});let stderr='',settled=false;
      const done=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);try{proc.kill();}catch{}fn(value);};
      const timer=setTimeout(()=>done(reject,Error('Reading the CAD took longer than 20 minutes. Export a smaller STEP (or a GLB/STL mesh).')),1200000);
      proc.stderr?.on('data',d=>{stderr=(stderr+d).slice(-2000);});proc.stdout?.on('data',()=>{});
      proc.on('message',m=>{if(m?.type==='progress')this.emit({type:'cad-progress',stage:m.stage,done:m.done,total:m.total});else if(m?.type==='step')m.ok?done(resolve,m.value):done(reject,Error(m.error));});
      proc.on('exit',code=>done(reject,Error(`The CAD reader stopped (code ${code}). ${stderr.trim().split('\n').slice(-2).join(' ')}`.trim())));
      proc.postMessage({file,cacheDir:path.join(this.dataDir,'simulation','cad-cache')});
    });
  }
  stop(){const proc=this.proc;this.proc=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Simulation closed.'));}this.pending.clear();if(proc)try{proc.kill();}catch{}}
  practiceInput(pad){if(this.proc)this.proc.postMessage({method:'practice-input',args:[pad||null]});}
  // A robot model the team picked or dropped: STEP is tessellated and merged into one body in the
  // simulation process; mesh formats are returned as bytes for the window to merge.
  async readModel(file){
    const ext=path.extname(file).toLowerCase(),size=fs.statSync(file).size;
    if(size>MODEL_LIMIT)throw Error(`${path.basename(file)} is larger than 200 MB.`);
    if(STEP_TYPES.includes(ext))return {kind:'step',...await this.convertStep(file)};
    if(ext==='.urdf')return this.readUrdf(file);
    if(['.sdf','.world','.mjcf','.xml','.usda','.usd','.usdc','.usdz'].includes(ext))return this.readDescription(file);
    if(!MESH_TYPES[ext])throw Error('Use a STEP (.step/.stp), URDF (.urdf), SDFormat (.sdf), MuJoCo (.xml), USD (.usda), .glb, .gltf, .stl or .obj file.');
    return {kind:'mesh',name:path.basename(file),format:MESH_TYPES[ext],bytes:new Uint8Array(fs.readFileSync(file))};
  }
  // A URDF and the mesh files it names.
  readUrdf(file){
    const U=require('../ui/sim-urdf.js'),xml=fs.readFileSync(file,'utf8'),u=U.parse(xml);
    return {kind:'urdf',name:path.basename(file),xml,...this.meshesFor(U.meshFiles(u),path.dirname(file),Buffer.byteLength(xml))};
  }
  // An SDFormat, MuJoCo or text USD robot (an .xml file is told apart by its root element) and the mesh files it names.
  readDescription(file){
    const F=require('../ui/sim-robot-formats.js'),xml=fs.readFileSync(file,'utf8'),kind=F.kindOf(file,xml);
    if(kind==='urdf')return this.readUrdf(file);if(!kind)throw Error(`${path.basename(file)} is not a URDF, SDFormat or MuJoCo robot.`);
    if(kind==='usd-binary')throw Error(`${path.basename(file)} is binary USD, which is not read. Save the stage as text (.usda) and import that.`);
    return {kind,name:path.basename(file),xml,...this.meshesFor(F.meshFiles(F.parse(kind,xml)),path.dirname(file),Buffer.byteLength(xml))};
  }
  // Reads the mesh files a robot file names: package://name/... and model://name/... are looked for in the folders above
  // it (as ROS finds packages and Gazebo models), file:// as given, anything else relative to the file. Only mesh files
  // are read; a Collada (.dae) mesh is reported, and its link's collision shapes are drawn instead.
  meshesFor(refs,dir,total){
    const files=[],missing=[],find=ref=>{const pkg=/^(?:package|model):\/\/([^/]+)\/(.*)$/.exec(ref);
      if(pkg){for(let d=dir;;d=path.dirname(d)){for(const c of [path.join(d,pkg[1],pkg[2]),path.basename(d)===pkg[1]?path.join(d,pkg[2]):null])if(c&&fs.existsSync(c))return c;if(d===path.dirname(d))return null;}}
      if(/^file:\/\//.test(ref))return require('node:url').fileURLToPath(ref);return path.resolve(dir,ref);};
    for(const ref of refs){const at=find(ref),kind=at&&MESH_TYPES[path.extname(at).toLowerCase()];
      if(!at||!fs.existsSync(at)){missing.push(`${ref} (not found)`);continue;}if(!kind){missing.push(`${ref} (${path.extname(at).slice(1)} meshes are not read)`);continue;}
      const size=fs.statSync(at).size;if(total+size>MODEL_LIMIT){missing.push(`${ref} (over 200 MB in all)`);continue;}total+=size;files.push({ref,format:kind,bytes:new Uint8Array(fs.readFileSync(at))});}
    return {files,missing};
  }
  exportsFile(){return path.join(this.dataDir,'simulation','exports.json');}
  exportTargets(){try{const v=JSON.parse(fs.readFileSync(this.exportsFile(),'utf8'));return v&&typeof v==='object'?v:{};}catch{return {};}}
  async file(dialog,win,action,data){
    // Licensed CAD (FIRST field models, vendor chassis) is only present in personal local builds;
    // public releases leave it out and the window falls back to drawings and plain shapes.
    if(action==='assets'){const ui=path.join(__dirname,'../ui'),has=rel=>fs.existsSync(path.join(ui,rel));
      return {robots:['strafer','swechanum'].filter(id=>has(`assets/robots/${id}.glb.gz`)),fields:{decode:has('vendor/models/decode/field.glb'),biobuzz:has('vendor/models/biobuzz/field.glb')&&has('vendor/models/biobuzz/elements.glb')}};}
    if(action==='builtin-model'){if(!['strafer','swechanum'].includes(data))throw Error('Unknown bundled robot.');const dir=path.join(__dirname,'../ui/assets/robots'),catalog=JSON.parse(fs.readFileSync(path.join(dir,'catalog.json'),'utf8'));return {bytes:new Uint8Array(require('node:zlib').gunzipSync(fs.readFileSync(path.join(dir,data+'.glb.gz')))),meta:catalog[data]};}
    // The Test setup's robot, generated from FTC parts (ui/sim-test-robot.js, original geometry, in every build) and shaped
    // like a STEP import by the import's own functions, so the window stores, discovers and rigs it as a team's own CAD.
    if(action==='test-robot')return require('../ui/sim-test-robot.js').result(require('./sim-model.cjs'));
    // A preset robot's CAD (ui/sim-preset-robots.js), made the same way.
    if(action==='preset-robot'){const P=require('../ui/sim-preset-robots.js'),SM=require('./sim-model.cjs'),id=typeof data==='string'?data:data?.id;if(!P.has(id))throw Error('Unknown preset robot.');return P.result(id,SM);}
    const models=path.join(this.dataDir,'simulation','models');
    const open=async(title,filters,limit)=>{const r=await dialog.showOpenDialog(win,{title,properties:['openFile'],filters});if(r.canceled||!r.filePaths[0])return null;const file=r.filePaths[0];if(fs.statSync(file).size>limit)throw Error(`${path.basename(file)} is larger than ${Math.round(limit/1048576)} MB.`);return file;};
    if(action==='project-save'){
      if(typeof data!=='string'||data.length>PROJECT_LIMIT)throw Error('Project is too large to save.');
      const r=await dialog.showSaveDialog(win,{title:'Save simulation project',defaultPath:'deck-simulation.json',filters:[{name:'Simulation project',extensions:['json']}]});
      if(r.canceled||!r.filePath)return null;fs.writeFileSync(r.filePath,data);return {name:path.basename(r.filePath)};
    }
    // A robot file: robot settings, mechanisms, sensors and its CAD, to load into any setup.
    if(action==='robot-save'){
      if(typeof data!=='string'||data.length>PROJECT_LIMIT)throw Error('Robot is too large to save.');
      const r=await dialog.showSaveDialog(win,{title:'Save robot',defaultPath:'robot.deckrobot.json',filters:[{name:'Deck robot',extensions:['json']}]});
      if(r.canceled||!r.filePath)return null;fs.writeFileSync(r.filePath,data);return {name:path.basename(r.filePath)};
    }
    if(action==='robot-open'){const file=await open('Load a robot',[{name:'Deck robot',extensions:['json']}],PROJECT_LIMIT);return file&&{name:path.basename(file),text:fs.readFileSync(file,'utf8')};}
    if(action==='project-open'){const file=await open('Open simulation project',[{name:'Simulation project',extensions:['json']}],PROJECT_LIMIT);return file&&{name:path.basename(file),text:fs.readFileSync(file,'utf8')};}
    // A log from the real robot to compare with the plan: read only, never written back.
    if(action==='pp-open'){const file=await open('Import a path file',[{name:'Path file',extensions:['pp','json']}],8*1024*1024);return file&&{name:path.basename(file),text:fs.readFileSync(file,'utf8')};}
    if(action==='robot-log-open'){const file=await open('Compare with a robot log',[{name:'Robot log',extensions:['wpilog','csv','txt']}],64*1024*1024);return file&&{name:path.basename(file),bytes:new Uint8Array(fs.readFileSync(file))};}
    if(action==='java-open'){const file=await open('Choose a Java autonomous program',[{name:'Java source',extensions:['java']}],SOURCE_LIMIT);return file&&{name:path.basename(file),source:fs.readFileSync(file,'utf8')};}
    // Only picks the file: the window confirms it is the robot's starting position before model-drop reads it.
    if(action==='model-pick'){const file=await open('Import your robot',[{name:'Robot CAD or mesh',extensions:['step','stp','urdf','sdf','world','xml','mjcf','usda','usd','glb','gltf','stl','obj']}],MODEL_LIMIT);return file&&{file,name:path.basename(file)};}
    // A file dropped on the window: the path comes from Electron's own File-to-path lookup.
    if(action==='model-drop'){const file=typeof data==='string'?data:data?.file;if(typeof file!=='string'||!path.isAbsolute(file)||!fs.existsSync(file))throw Error('That file could not be opened.');return this.readModel(file);}
    if(action==='model-save'){
      if(!data||typeof data.name!=='string'||!(data.bytes instanceof Uint8Array)||data.bytes.length>STORED_LIMIT)throw Error('Invalid model data.');
      const bytes=Buffer.from(data.bytes),id=crypto.createHash('sha256').update(bytes).digest('hex').slice(0,32)+'.glb';
      fs.mkdirSync(models,{recursive:true});fs.writeFileSync(path.join(models,id),bytes);return {id,name:path.basename(data.name).slice(0,120)};
    }
    if(action==='model-read'){if(typeof data!=='string'||!/^[0-9a-f]{32}\.glb$/.test(data))throw Error('Invalid model id.');const file=path.join(models,data);return fs.existsSync(file)?{id:data,bytes:new Uint8Array(fs.readFileSync(file))}:null;}
    // Control Hub TeamCode: the OpMode, Deck controller, wiring and route, written at their package paths under
    // a folder the user picks (normally TeamCode/src/main/java). Names are checked so nothing escapes it.
    // Files listed in keep (the team's own RobotActions.java) are written only when they do not exist.
    // A recorded run as a WPILOG, saved where the team chooses.
    if(action==='log-save'){
      if(!data||!(data.bytes instanceof Uint8Array)||data.bytes.length>64*1024*1024)throw Error('Invalid run log.');
      const base=String(data.name||'deck-run').replace(/[^\w -]+/g,'').trim().slice(0,60)||'deck-run';
      const r=await dialog.showSaveDialog(win,{title:'Save run log',defaultPath:`${base}.wpilog`,filters:[{name:'WPILOG',extensions:['wpilog']}]});if(r.canceled||!r.filePath)return null;fs.writeFileSync(r.filePath,Buffer.from(data.bytes));return {name:path.basename(r.filePath),message:`Saved ${path.basename(r.filePath)}.`};
    }
    // A run video (MP4 or WebM, filmed in the window), saved where the team chooses.
    if(action==='video-save'){
      if(!data||!(data.bytes instanceof Uint8Array)||!data.bytes.length||data.bytes.length>2*1024*1024*1024||!['mp4','webm'].includes(data.ext))throw Error('Invalid run video.');
      const base=String(data.name||'Deck run').replace(/[^\w -]+/g,'').trim().slice(0,80)||'Deck run';
      const r=await dialog.showSaveDialog(win,{title:'Save run video',defaultPath:`${base}.${data.ext}`,filters:[{name:data.ext==='mp4'?'MP4 video':'WebM video',extensions:[data.ext]}]});if(r.canceled||!r.filePath)return null;fs.writeFileSync(r.filePath,Buffer.from(data.bytes.buffer,data.bytes.byteOffset,data.bytes.length));return {name:path.basename(r.filePath),message:`Saved ${path.basename(r.filePath)}.`};
    }
    if(action==='teamcode-save'){
      const files=data?.files;if(!files||typeof files!=='object')throw Error('Invalid TeamCode export.');
      const entries=Object.entries(files);if(!entries.length||entries.length>12||entries.some(([rel,text])=>typeof text!=='string'||!/^[A-Za-z0-9_]+(\/[A-Za-z0-9_]+)*\.java$/.test(rel))||entries.reduce((s,[,text])=>s+text.length,0)>EXPORT_LIMIT)throw Error('Invalid TeamCode export.');
      const r=await dialog.showOpenDialog(win,{title:'Choose your TeamCode java folder (TeamCode/src/main/java)',properties:['openDirectory','createDirectory']});
      if(r.canceled||!r.filePaths[0])return null;const base=path.resolve(r.filePaths[0]);
      const keep=new Set(Array.isArray(data.keep)?data.keep.filter(k=>typeof k==='string'):[]),kept=[];
      const retired=[];
      for(const [rel,text] of entries){const file=path.resolve(base,rel);if(!file.startsWith(base+path.sep))throw Error('Invalid TeamCode path.');
        // A kept file is the team's, but its untouched empty methods for actions Deck now runs would override Deck's code.
        if(keep.has(rel)&&fs.existsSync(file)){kept.push(path.basename(rel));const slots=Array.isArray(data.retire?.[rel])?data.retire[rel].filter(s=>typeof s==='string'):[];
          if(slots.length){const r=require('../ui/sim-ftc.js').retireStubs(fs.readFileSync(file,'utf8'),slots);if(r.removed.length){fs.writeFileSync(file+'.bak',fs.readFileSync(file));fs.writeFileSync(file,r.text);retired.push(...r.removed);}}continue;}fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);}
      return {name:path.basename(base),count:entries.length-kept.length,kept,retired};
    }
    // Route exports. The window may only write to a file the user picked in a save dialog; with
    // "keep updated" that choice is remembered per field layout and format.
    if(['export-save','export-update','export-status','export-forget'].includes(action)){
      if(!data||!validKey(data.key))throw Error('Invalid export target.');
      const targets=this.exportTargets(),save=()=>{fs.mkdirSync(path.dirname(this.exportsFile()),{recursive:true});fs.writeFileSync(this.exportsFile(),JSON.stringify(targets),{mode:0o600});};
      if(action==='export-status')return targets[data.key]?{name:path.basename(targets[data.key].path),format:targets[data.key].format}:null;
      if(action==='export-forget'){delete targets[data.key];save();return null;}
      if(!EXPORTS[data.format]||typeof data.text!=='string'||data.text.length>EXPORT_LIMIT)throw Error('Invalid export.');
      // A companion file (MotionModule's robot_actions.py) goes beside the export, only when it is missing.
      const companion=file=>{const c=data.companion;if(!c||typeof c.text!=='string'||c.text.length>EXPORT_LIMIT||!/^[A-Za-z0-9_]+\.py$/.test(c.name||''))return null;const target=path.join(path.dirname(file),c.name);if(fs.existsSync(target))return null;fs.writeFileSync(target,c.text);return c.name;};
      // Generated files that always go beside an OnBot Java export (its check TeleOp), replaced on every export.
      const beside=file=>(data.format==='onbot'&&Array.isArray(data.beside)?data.beside:[]).filter(b=>b&&typeof b.text==='string'&&b.text.length<=EXPORT_LIMIT&&/^[A-Za-z0-9_]+\.java$/.test(b.name||'')&&b.name!==path.basename(file))
        .map(b=>{fs.writeFileSync(path.join(path.dirname(file),b.name),b.text);return b.name;});
      if(action==='export-update'){const t=targets[data.key];if(!t||t.format!==data.format)return null;fs.writeFileSync(t.path,data.text);return {name:path.basename(t.path),created:companion(t.path),beside:beside(t.path)};}
      const r=await dialog.showSaveDialog(win,{title:`Export ${EXPORTS[data.format].name}`,defaultPath:typeof data.name==='string'?path.basename(data.name):'PlannedRoute.'+EXPORTS[data.format].extensions[0],filters:[EXPORTS[data.format]]});
      if(r.canceled||!r.filePath)return null;fs.writeFileSync(r.filePath,data.text);
      if(data.keep){targets[data.key]={path:r.filePath,format:data.format};save();}
      return {name:path.basename(r.filePath),created:companion(r.filePath),beside:beside(r.filePath)};
    }
    throw Error('Unknown simulator file action.');
  }
}
module.exports={SimulationHost};
