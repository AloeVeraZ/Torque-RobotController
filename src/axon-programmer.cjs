'use strict';
// The Axon Programmer tab, in the main process: owns the programmer on one loop so a USB timeout can never freeze the
// window, and only while the page asks (start and stop). Moved from Axon Bridge's Worker.cs. It polls the programmer and servo,
// runs one job at a time, and tells the page what it sees with onState. USB itself is the small helper in src/axon-usb, which
// is Windows only: Node has no HID without a native module, and Torque's releases are Windows only for now.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const S=require('./axon-servo.cjs');
const AUTO_POWER_BELOW=8.6,OVER_VOLTAGE=9.1,POLL_MS=400,RIVALS_MS=1000,LOG_LINES=60,TRACE_LINES=400,delay=ms=>new Promise(r=>setTimeout(r,ms));

// ---- the helper. One request a line, one answer a line, in order.
class UsbHelper{
  constructor(file=path.join(__dirname,'axon-usb','AxonUsb.exe')){this.file=file;this.next=1;this.waiting=new Map();this.child=null;}
  start(){if(this.child)return;const child=spawn(this.file,[],{windowsHide:true,stdio:['pipe','pipe','ignore']});this.child=child;let text='';
    // A helper being replaced says nothing: its successor's requests are not its own.
    const gone=why=>{if(this.child!==child)return;this.child=null;for(const w of this.waiting.values())w.fail(Error(why));this.waiting.clear();};
    child.on('error',e=>gone(e.code==='ENOENT'?'Torque\'s USB helper is missing.':`Torque's USB helper could not start: ${e.message}`));child.on('exit',()=>gone('Torque\'s USB helper stopped.'));child.stdin.on('error',()=>{});
    child.stdout.on('data',d=>{text+=d.toString('latin1');for(let at;(at=text.indexOf('\n'))>=0;text=text.slice(at+1)){const [id,kind,...rest]=text.slice(0,at).trim().split(' '),w=this.waiting.get(+id);if(!w)continue;this.waiting.delete(+id);const value=rest.join(' ');
      if(kind==='ok')w.done(value);else if(kind==='lost')w.fail(new S.DeviceLost(value));else w.fail(Error(value));}});}
  ask(...words){this.start();return new Promise((done,fail)=>{const id=this.next++;this.waiting.set(id,{done,fail});try{this.child.stdin.write(`${id} ${words.join(' ')}\n`);}catch(e){this.waiting.delete(id);fail(e);}});}
  stop(){const child=this.child;this.child=null;for(const w of this.waiting.values())w.fail(Error('Torque\'s USB helper stopped.'));this.waiting.clear();try{child?.stdin.end();}catch{}if(child)setTimeout(()=>{try{child.kill();}catch{}},1500).unref();}
}
// The transport the service uses: the helper, or a simulated programmer in tests.
function usbTransport(helper=new UsbHelper()){
  return {
    supported:process.platform==='win32',
    find:async(vid,pid)=>JSON.parse(await helper.ask('find',vid.toString(16),pid.toString(16))),
    rivals:async()=>JSON.parse(await helper.ask('rivals')),
    closeRivals:()=>helper.ask('close-rivals'),
    open:async info=>{await helper.ask('open',info.vid.toString(16),info.pid.toString(16),info.path);return {
      write:async(report,timeoutMs)=>await helper.ask('write',timeoutMs,Buffer.from(report).toString('hex'))==='1',
      read:async timeoutMs=>{const r=await helper.ask('read',timeoutMs);return r?Buffer.from(r,'hex'):null;},
      flush:()=>helper.ask('flush'),close:()=>helper.ask('close').catch(()=>{})};},
    stop:()=>helper.stop()};
}

const blank=()=>({ready:false,v1Seen:false,bootSeen:false,rivals:[],handshakeFailed:false,error:null,info:null,hello:null});
class AxonService{
  // transport as above; firmwareDir holds downloaded firmware; logFile keeps every USB frame; catalog lists Axon's firmware files.
  constructor({transport=usbTransport(),firmwareDir,logFile,keyFile=null,sharedKeyFile=null,catalog=S.FIRMWARE,onState=()=>{},fetchFile=null}={}){
    Object.assign(this,{transport,firmwareDir,logFile,keyFile,sharedKeyFile,catalog,onState,fetchFile});this.loadKeys();this.running=null;this.stopping=false;this.jobs=[];this.link=null;this.prog=null;this.resetView();this.log=[];this.traceLines=[];this.chosen=new Map();this.lastPower=0;
  }
  resetView(){this.programmer=blank();this.telemetry=null;this.servo=S.parseStatus(Buffer.alloc(S.REPORT));this.block=null;this.blockKey=null;this.lastKey='';this.readPending=false;this.readAttempts=0;this.busy=null;this.warnedVoltage=false;this.warnedHandshake=false;}
  say(text,tone='info'){if(this.log.at(-1)?.text===text)return;this.log.push({text,tone,at:Date.now()});if(this.log.length>LOG_LINES)this.log.shift();this.trace(`[${tone}] ${text}`);this.publish();}
  trace(line){const text=`${new Date().toISOString().slice(11,23)} ${line}`;this.traceLines.push(text);if(this.traceLines.length>TRACE_LINES)this.traceLines.shift();if(this.logFile){try{fs.appendFileSync(this.logFile,text+'\n');}catch{}}}
  // What the page draws. A value only the main process should hold (paths, the block's buffer) stays out.
  state(){
    const s=this.servo,block=this.block,present=S.servoPresent(s),name=block?S.blockName(block):null,model=name?S.modelByName(name):null,editable=S.servoEditable(s);
    let settings=null;
    if(block&&editable&&present){const schema=S.schemaFor(s.family,s.mode),values=schema.decode(block.data),factory=model?schema.decode(S.factoryBlock(model,s.mode)):null;
      settings={schema:S.schemaView(schema),values,factory};}
    return {supported:this.transport.supported!==false,running:!!this.running,programmer:this.programmer,telemetry:this.telemetry,
      servo:{...s,present,editable,key:S.servoKey(s),model:model?S.modelView(model):null,name,made:block?S.blockMade(block):null,validLen:block?.validLen??0,raw:block?S.hex(block.data,block.data.length):null,
        unconfirmed:block&&s.family==='v2'&&s.mode==='servo'?S.v2Unconfirmed.map(u=>({...u,value:block.data[u.at]})):[]},
      settings,models:S.MODELS.map(S.modelView),busy:this.busy,log:this.log};
  }
  publish(){try{this.onState(this.state());}catch{}}
  start(){if(this.transport.supported===false)return this.state();if(this.running){this.stopping=false;return this.state();}this.stopping=false;this.rivalsAt=0;this.resetView();
    if(this.logFile){try{if(fs.statSync(this.logFile).size>2e6)fs.truncateSync(this.logFile,0);}catch{}}this.trace(`Axon programmer started, ${new Date().toString()}`);
    this.running=this.loop().finally(()=>{this.running=null;if(!this.stopping)this.start();else this.publish();});return this.state();}
  // The loop only ends between steps and with no job waiting, so a firmware update that was asked for always finishes.
  async stop(){this.stopping=true;const ended=this.running;if(ended)await ended;}
  async dispose(){await this.stop();if(!this.running)this.transport.stop?.();}
  // Quitting: the helper goes now, whatever it was doing.
  quit(){this.stopping=true;this.transport.stop?.();}
  get flashing(){return this.busy?.kind==='flash';}
  async loop(){
    while(!this.stopping||(this.jobs.length&&this.prog)){
      try{await this.step();}
      catch(e){
        if(e instanceof S.DeviceLost||!this.prog){const had=!!this.prog;await this.drop();if(had)this.say(`V2 programmer disconnected. ${e.message}`,'warn');const waiting=this.jobs.splice(0);this.resetView();for(const job of waiting)job.fail(e);
          // USB itself is the problem (the helper will not run, say), not a programmer that went away.
          if(!(e instanceof S.DeviceLost))this.programmer={...blank(),error:e.message};this.publish();await delay(500);}
        else{this.say(`Internal error: ${e.message}`,'bad');await delay(500);}
      }
    }
    await this.drop();for(const job of this.jobs.splice(0))job.fail(Error('The Axon programmer page closed.'));
  }
  async drop(){this.prog=null;this.lastKey='';this.readPending=false;const link=this.link;this.link=null;if(link)await link.close?.();}
  async step(){
    // Axon's own app and Axon Bridge poll the same programmer, and two apps on one device corrupt each other's traffic.
    if(this.transport.rivals&&Date.now()-this.rivalsAt>=RIVALS_MS){this.rivalsAt=Date.now();this.rivalsNow=await this.transport.rivals();}
    const rivals=this.rivalsNow||[];
    if(rivals.length&&!this.jobs.length&&!this.busy&&!this.stopping){if(this.link)await this.drop();this.resetView();this.programmer={...blank(),rivals};this.publish();await delay(400);return;}
    if(!this.prog){await this.connect();if(!this.prog){await delay(700);return;}}
    const job=this.jobs.shift();
    if(job){try{job.done(await job.run(this.prog));}catch(e){job.fail(e);if(e instanceof S.DeviceLost)throw e;}this.lastPoll=0;return;}
    if(Date.now()-(this.lastPoll||0)>=POLL_MS){this.lastPoll=Date.now();await this.poll();}else await delay(20);
  }
  async connect(){
    const found=await this.transport.find(S.VID_V2,S.PID);
    if(!found.length){const [v1,boot]=await Promise.all([this.transport.find(S.VID_V1,S.PID),this.transport.find(S.VID_BOOT,S.PID)]);this.resetView();this.programmer={...blank(),v1Seen:v1.length>0,bootSeen:boot.length>0};this.publish();return;}
    const link=await this.transport.open(found[0]),prog=new S.Programmer(link,{trace:line=>this.trace(line)});
    const ok=await prog.hello()||await prog.hello();
    if(!ok){await link.close?.();this.resetView();this.programmer={...blank(),handshakeFailed:true};this.publish();if(!this.warnedHandshake)this.say('A device with the V2 programmer\'s USB ID was found, but it did not answer the handshake.','bad');this.warnedHandshake=true;return;}
    this.warnedHandshake=false;this.link=link;this.prog=prog;this.programmer={...blank(),ready:true,info:found[0],hello:prog.helloReply};this.say(`V2 programmer connected: ${found[0].product||'HID device'}.`,'good');
  }
  async managePower(t){
    if(!t)return;
    if(t.volts>OVER_VOLTAGE){if(!this.warnedVoltage)this.say(`Input voltage is ${t.volts.toFixed(1)} V, above the programmer's 9 V limit. Servo power stays off.`,'bad');this.warnedVoltage=true;return;}
    this.warnedVoltage=false;
    if(!t.powerOn&&!t.powerAlarm&&t.volts<AUTO_POWER_BELOW&&Date.now()-this.lastPower>1200){this.lastPower=Date.now();await this.prog.setServoPower(true);}
  }
  async poll(){
    const t=await this.prog.telemetry();await this.managePower(t);const s=await this.prog.status();this.telemetry=t;this.servo=s;
    const present=S.servoPresent(s),key=present?S.servoKey(s):'';
    if(key!==this.lastKey){
      if(present){
        if(s.family==='unknown')this.say(`A servo answered with an ID Torque does not know (${s.firmware}).`,'warn');
        else{this.say(`${s.family.toUpperCase()} servo found, running ${s.mode==='cr'?'continuous rotation':'servo'} firmware ${s.firmware}.`,'good');if(s.family==='v1'&&!this.saidV1){this.saidV1=true;this.say('The V2 programmer can see this V1 servo.','good');}}
        this.readPending=S.servoEditable(s);this.readAttempts=0;this.block=null;
        if(!S.servoEditable(s)&&s.family==='v1')this.say('This V1 variant has no settings layout in Axon\'s V1 app, so its settings cannot be edited.','warn');
      }else{if(this.lastKey)this.say('Servo removed.','warn');this.readPending=false;this.block=null;}
      this.lastKey=key;
    }
    this.publish();if(this.readPending)await this.readNow(s);
  }
  async readNow(s){
    const {block,error}=await this.prog.readBlock(s.family);this.readAttempts++;
    if(!block){if(this.readAttempts>=3){this.readPending=false;this.say(`Could not read this servo's settings. ${error}`,'bad');}return false;}
    this.readPending=false;this.block=block;
    if(block.family==='v1'&&block.validLen<95)this.say('The programmer returned only the first 59 of 95 bytes. All the settings are there, but the servo\'s name is not.','warn');
    this.say('Read the servo\'s current settings.','good');return true;
  }

  // ---- jobs, one at a time on the loop
  job(kind,text,run){
    if(!this.running)throw Error('Open the Axon programmer first.');if(this.busy)throw Error('The programmer is busy with something else.');
    return new Promise((done,fail)=>{this.busy={kind,text,percent:null};this.publish();
      const finish=fn=>value=>{this.busy=null;this.publish();fn(value);};this.jobs.push({run,done:finish(done),fail:finish(fail)});});
  }
  read(){return this.job('read','Reading the servo...',async()=>{const s=await this.prog.status();this.servo=s;if(!S.servoEditable(s)){this.say('No servo that can be edited is responding.','warn');return {ok:false};}
    this.readAttempts=0;const ok=await this.readNow(s);if(!ok)this.say('Could not read the settings.','bad');return {ok};});}
  // Read, change, write, read back. Only bytes that belong to edited settings can change, and the answer says what the servo holds now.
  write(changes){return this.job('write','Writing to the servo...',async p=>{
    const cur=await p.status();if(!S.servoEditable(cur)||S.servoKey(cur)!==S.servoKey(this.servo))return {ok:false,message:'The servo changed or was unplugged before the write started. Nothing was written.'};
    const schema=S.schemaFor(cur.family,cur.mode);let wanted;try{wanted=S.checkChanges(schema,changes);}catch(e){return {ok:false,message:`${e.message} Nothing was written.`};}
    const {block:fresh,error}=await p.readBlock(cur.family);if(!fresh)return {ok:false,message:`Could not read the servo first, so nothing was written. ${error}`};
    const insane=schema.sanity(fresh);if(insane)return {ok:false,message:`The data read from the servo does not look right (${insane}), so nothing was written.`};
    const basis=schema.decode(fresh.data),now={...basis,...wanted},next={...fresh,data:Buffer.from(fresh.data)};schema.encode(next.data,now,basis);
    const diff=[];for(let i=0;i<fresh.validLen;i++)if(fresh.data[i]!==next.data[i])diff.push(i);
    if(!diff.length){this.block=fresh;return {ok:true,message:'The servo already has these settings.',confirmed:[]};}
    const failed=await p.writeBlock(next);if(failed)return {ok:false,message:failed};
    await delay(80);
    const {block:back,error:backError}=await p.readBlock(cur.family);if(!back)return {ok:false,message:`The write was sent, but the servo could not be read back to confirm it. ${backError}`};
    this.block=back;const bad=diff.filter(i=>back.data[i]!==next.data[i]),holds=schema.decode(back.data);
    const confirmed=Object.keys(wanted).map(key=>{const field=schema.fields.find(f=>f.key===key);return {key,label:field.label,field,asked:wanted[key],was:basis[key],now:holds[key],took:holds[key]===wanted[key]};});
    if(bad.length)return {ok:false,message:`The servo did not keep the new values (${bad.length} of ${diff.length} bytes differ, first at byte ${bad[0]}).`,confirmed};
    return {ok:true,message:'Written, read back and confirmed.',confirmed};});}
  defaults(){return this.job('defaults','Restoring factory settings...',async p=>{const ok=await p.factoryDefault();this.say(ok?'Factory settings restored.':'The servo refused the factory reset.',ok?'good':'bad');
    if(ok){await delay(200);const s=await p.status();this.servo=s;if(S.servoEditable(s)){this.readAttempts=0;await this.readNow(s);}}return {ok};});}
  closeRivals(){this.rivalsAt=0;return this.transport.closeRivals?.();}
  // A model's factory settings, drawn greyed out until a servo is plugged in. No USB.
  preview(code,mode){const model=S.modelByCode(code);if(!model||(mode!=='servo'&&mode!=='cr'))throw Error('Torque has no firmware for that servo.');const schema=S.schemaFor(model.family,mode);return {schema:S.schemaView(schema),values:schema.decode(S.factoryBlock(model,mode))};}

  // ---- settings files. The page gets values to review; nothing goes to the servo until it is applied.
  loadSettings(data,fileName){
    const s=this.servo,problem=this.block&&S.servoEditable(s)?S.configProblem(s.family,data):'Read a servo first.';if(problem)throw Error(problem);
    const schema=S.schemaFor(s.family,s.mode),values=schema.decode(data);this.say(`Loaded ${fileName}. Apply it to write it to the servo.`);return {values};
  }
  packSettings(changes){
    const s=this.servo;if(!this.block||!S.servoEditable(s))throw Error('Read a servo first.');const schema=S.schemaFor(s.family,s.mode),wanted=S.checkChanges(schema,changes),basis=schema.decode(this.block.data),data=Buffer.from(this.block.data);schema.encode(data,{...basis,...wanted},basis);return S.packConfig(s.family,data);
  }

  // ---- firmware
  fileFor(code,mode){return this.catalog.find(f=>f.code===code&&f.mode===mode)||null;}
  firmwarePath(file){return path.join(this.firmwareDir,file.fileName);}
  // A saved file only counts while it is exactly the one that was listed.
  // A key file this computer already has: one imported here, or the owner's own copy in Documents, which follows them if that folder syncs.
  loadKeys(){for(const f of [this.keyFile,this.sharedKeyFile])if(f){try{S.useKeys(S.parseKeys(fs.readFileSync(f,'utf8')));return;}catch{}}}
  firmwareStatus(code,mode){if(!S.hasKey(S.modelByCode(code)?.family))this.loadKeys();const file=this.fileFor(code,mode);if(!file)throw Error('Torque has no firmware for that servo.');let have=false;try{const data=fs.readFileSync(this.firmwarePath(file));have=!file.sha256||S.sha256(data)===file.sha256;}catch{}
    return {have,chosen:this.chosen.has(`${code}/${mode}`),keys:S.hasKey(S.modelByCode(code)?.family),fileName:file.fileName,size:file.size,url:file.url};}
  // A key file someone already has, kept beside this computer's settings.
  importKeys(filePath){const text=fs.readFileSync(filePath,'utf8'),keys=S.parseKeys(text);if(this.keyFile){fs.mkdirSync(path.dirname(this.keyFile),{recursive:true});fs.writeFileSync(this.keyFile,JSON.stringify(keys,null,2));}S.useKeys(keys);this.say('Imported your key file. It stays on this computer.','good');return {imported:Object.keys(keys)};}
  chooseFirmware(code,mode,filePath){const image=S.readFirmware(filePath),model=S.modelByCode(code);if(!model||image.family!==model.family)throw Error(`${path.basename(filePath)} is ${image.family.toUpperCase()} firmware, but this is a ${model?.title}.`);this.chosen.set(`${code}/${mode}`,filePath);this.say(`Using ${path.basename(filePath)} for this servo.`);return {name:path.basename(filePath)};}
  async download(code,mode){
    const file=this.fileFor(code,mode);if(!file)throw Error('Torque has no firmware for that servo.');if(!this.fetchFile)throw Error('Downloading is not available here. Choose the file instead.');
    if(this.busy)throw Error('The programmer is busy with something else.');this.busy={kind:'download',text:`Downloading ${file.fileName}...`,percent:null};this.publish();
    try{const data=await this.fetchFile(file.url);
      if(data.length!==file.size||(file.sha256&&S.sha256(data)!==file.sha256))throw Error(`${file.fileName} from Axon's link is not the file Torque expects, so it was thrown away. Axon may have updated it: choose it by hand, or update Torque.`);
      S.loadFirmware(data,file.fileName);fs.mkdirSync(this.firmwareDir,{recursive:true});const temp=this.firmwarePath(file)+'.part';fs.writeFileSync(temp,data);fs.renameSync(temp,this.firmwarePath(file));this.say(`Downloaded ${file.fileName}.`,'good');return {fileName:file.fileName};}
    finally{this.busy=null;this.publish();}
  }
  // Recovery is for a servo that stopped appearing after an interrupted update: the hardware ID is still checked, its name cannot be.
  flash({code,mode,recovery=false,allowUnknownName=false}){
    const model=S.modelByCode(code),file=this.fileFor(code,mode);if(!model||!file)throw Error('Torque has no firmware for that servo.');
    const source=this.chosen.get(`${code}/${mode}`)||(this.firmwareStatus(code,mode).have?this.firmwarePath(file):null);if(!source)throw Object.assign(Error(`${file.fileName} is needed first.`),{code:'FIRMWARE_NEEDED'});
    const image=S.readFirmware(source);if(image.family!==model.family)throw Error(`That firmware is for a ${image.family.toUpperCase()} servo, but this is a ${model.title}.`);
    if(image.badChecksums)this.say(`${image.badChecksums} records in this file fail the standard HEX checksum. The servo checks each one as it is written.`,'warn');
    const name=this.block&&this.servo.family===image.family?S.blockName(this.block):null;
    if(!recovery&&!name&&!allowUnknownName)throw Object.assign(Error('The servo\'s name could not be read, so it cannot be matched to this firmware by name. The hardware ID check still runs.'),{code:'NAME_UNKNOWN'});
    return this.job('flash',`Switching to ${mode==='cr'?'continuous rotation':'servo mode'}...`,async p=>{
      this.say(`Writing ${path.basename(source)} (${image.bytes} bytes, "${image.name}").`);
      const progress=(percent,message)=>{this.busy={...this.busy,percent};if(message)this.say(message);else this.publish();};
      const flashed=await S.flash(p,image,name,{allowUnknownName:recovery||allowUnknownName,progress});
      if(!flashed.ok){this.say(flashed.error,flashed.changed?'bad':'warn');this.lastKey='';return {ok:false,message:flashed.error,changed:flashed.changed};}
      progress(100,'Waiting for the servo to restart...');await delay(800);
      let s=await this.waitForServo(p,10);
      // The two official apps frame the exit command differently, so try the other form once.
      if(!S.servoPresent(s)){await p.bootExit(image.family==='v1'?'v2':'v1');s=await this.waitForServo(p,6);}
      this.lastKey='';this.servo=s;this.block=null;
      if(!S.servoPresent(s))return {ok:false,changed:true,message:'The firmware was written, but the servo did not come back. Unplug it, plug it back in, and check its mode here.'};
      if(s.mode!==mode)return {ok:false,changed:true,message:`The firmware was written, but the servo reports ${s.mode==='cr'?'continuous rotation':'servo'} mode.`};
      return {ok:true,changed:true,mode,firmware:s.firmware,message:`Switched to ${mode==='cr'?'continuous rotation':'servo mode'}, firmware ${s.firmware}.`};});
  }
  async waitForServo(p,seconds){const until=Date.now()+seconds*1000;let s=S.parseStatus(Buffer.alloc(S.REPORT));while(Date.now()<until&&!S.servoPresent(s)){await this.managePower(await p.telemetry());s=await p.status();if(!S.servoPresent(s))await delay(300);}return s;}
}

// The real app's service; tests give it a simulated programmer through overrides.
const overrides={};
module.exports={AxonService,UsbHelper,usbTransport,overrides};
