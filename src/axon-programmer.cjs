'use strict';
// The Axon Programmer tab, in the main process: owns the programmer on one loop so a USB timeout can never freeze the
// window, and only while the page asks (start and stop). Moved from Axon Bridge's Worker.cs. It polls the programmer and servo,
// runs one job at a time, and tells the page what it sees with onState. USB itself is the small helper in src/axon-usb, which
// is Windows only: Node has no HID without a native module, and Torque's releases are Windows only for now.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const S=require('./axon-servo.cjs');
const SOFTWARE_MS=3000;
const BOOT_PROBE_MS=5000,MODE_PROBE_US=1650,MODE_PROBE_AMPS=.1,TEST_STEPS=5,TEST_MIN_V=3.4,CR_MIN_V=4.1,CR_STOP=1500,CR_SPAN=450,CR_SPAN_V1=500,CR_RAMP=600;
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
    stop:()=>helper.stop(),
    another:()=>usbTransport(new UsbHelper(helper.file))};
}

const blank=()=>({ready:false,kind:null,both:false,v1Seen:false,v2Seen:false,bootSeen:false,rivals:[],handshakeFailed:false,error:null,info:null,hello:null,browningOut:false});
const NAME={v1:'V1 programmer',v2:'V2 programmer'};
class AxonService{
  // transport as above; firmwareDir holds downloaded firmware; logFile keeps every USB frame; catalog lists Axon's firmware files.
  // only: 'v1' or 'v2' makes this service one programmer's, so the app can run one of each side by side (each with its own USB helper,
  // since taking turns on one lost the V1 servo). Without it, one service takes whichever programmer is plugged in, and asks for one
  // to be unplugged when both are.
  constructor({transport=usbTransport(),firmwareDir,logFile,keyFile=null,sharedKeyFile=null,findSoftware=null,catalog=S.FIRMWARE,onState=()=>{},fetchFile=null,only=null}={}){
    Object.assign(this,{transport,firmwareDir,logFile,keyFile,sharedKeyFile,findSoftware,catalog,onState,fetchFile,only});this.softwareNow=null;this.softwareAt=0;this.loadKeys();this.running=null;this.stopping=false;this.jobs=[];this.link=null;this.prog=null;this.resetView();this.log=[];this.traceLines=[];this.chosen=new Map();this.lastPower=0;
  }
  resetView(){this.testLive=null;this.programmer=blank();this.telemetry=null;this.servo=S.parseStatus(Buffer.alloc(S.REPORT));this.block=null;this.blockKey=null;this.lastKey='';this.readPending=false;this.readAttempts=0;this.busy=null;this.warnedVoltage=false;this.warnedHandshake=false;this.v1Misses=0;this.v1Restarted=false;this.bootServo=null;this.bootProbeAt=0;}
  say(text,tone='info'){if(this.log.at(-1)?.text===text)return;this.log.push({text,tone,at:Date.now()});if(this.log.length>LOG_LINES)this.log.shift();this.trace(`[${tone}] ${text}`);this.publish();}
  trace(line){const text=`${new Date().toISOString().slice(11,23)} ${this.only?`[${this.only}] `:''}${line}`;this.traceLines.push(text);if(this.traceLines.length>TRACE_LINES)this.traceLines.shift();if(this.logFile){try{fs.appendFileSync(this.logFile,text+'\n');}catch{}}}
  // Axon's own program for each servo family, if this computer has it (src/axon-software.cjs). Nothing needs it: it is only offered for a mode switch.
  softwareFound(fresh=false){if(!this.findSoftware)return {v1:{found:true},v2:{found:true}};if(fresh||!this.softwareNow||Date.now()-this.softwareAt>=SOFTWARE_MS){this.softwareAt=Date.now();try{this.softwareNow=this.findSoftware();}catch{this.softwareNow||={v1:{found:false},v2:{found:false}};}}return this.softwareNow;}
  softwareFile(family){return this.softwareFound(true)[family]?.path||null;}
  softwareView(){const s=this.softwareFound();return Object.fromEntries(['v1','v2'].map(f=>[f,{found:!!s[f]?.found,fileName:s[f]?.fileName||null}]));}
  // What the page draws. A value only the main process should hold (paths, the block's buffer) stays out.
  state(){
    const s=this.servo,block=this.block,present=S.servoPresent(s),name=block?S.blockName(block):null,model=name?S.modelByName(name):null,editable=S.servoEditable(s);
    let settings=null;
    if(block&&editable&&present){const schema=S.schemaFor(s.family,s.mode),values=schema.decode(block.data),factory=model?schema.decode(S.factoryBlock(model,s.mode)):null;
      settings={schema:S.schemaView(schema),values,factory};}
    return {only:this.only,supported:this.transport.supported!==false,running:!!this.running,programmer:this.programmer,telemetry:this.telemetry,
      servo:{...s,present,editable,key:S.servoKey(s),model:model?S.modelView(model):null,name,made:block?S.blockMade(block):null,validLen:block?.validLen??0,raw:block?S.hex(block.data,block.data.length):null,
        unconfirmed:block&&s.family==='v2'&&s.mode==='servo'?S.v2Unconfirmed.map(u=>({...u,value:block.data[u.at]})):[]},
      settings,models:S.MODELS.map(S.modelView),software:this.softwareView(),busy:this.busy,log:this.log,test:this.testLive||null};
  }
  publish(){try{this.onState(this.state());}catch{}}
  start(){if(this.transport.supported===false)return this.state();if(this.running){this.stopping=false;return this.state();}this.stopping=false;this.rivalsAt=0;this.resetView();
    if(this.logFile){try{if(fs.statSync(this.logFile).size>2e6)fs.truncateSync(this.logFile,0);}catch{}}this.trace(`Axon programmer started, ${new Date().toString()}`);
    void this.prefetchFirmware();this.running=this.loop().finally(()=>{this.running=null;if(!this.stopping)this.start();else this.publish();});return this.state();}
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
        if(e instanceof S.DeviceLost||!this.prog){const had=!!this.prog,kind=this.prog?.kind||'v2';await this.drop();this.saidConnected=null;if(had)this.say(`${NAME[kind]} disconnected. ${e.message}`,'warn');
          if(had&&kind==='v2'&&this.lastPower&&Date.now()-this.lastPower<4000&&++this.brownouts>=2&&!this.noAutoPower){this.noAutoPower=true;this.say('The servo pulls more current than this USB port gives, so the programmer keeps resetting. Torque stopped powering it. Plug the programmer into a different USB port or a powered hub, check the servo turns freely, then press Read.','bad');}const waiting=this.jobs.splice(0);this.resetView();for(const job of waiting)job.fail(e);
          // USB itself is the problem (the helper will not run, say), not a programmer that went away.
          if(!(e instanceof S.DeviceLost))this.programmer={...blank(),error:e.message};this.publish();await delay(500);}
        else{this.say(`Internal error: ${e.message}`,'bad');await delay(500);}
      }
    }
    await this.drop();for(const job of this.jobs.splice(0))job.fail(Error('The Axon programmer page closed.'));
  }
  async drop(){this.prog=null;this.lastKey='';this.readPending=false;const link=this.link;this.link=null;if(link)await link.close?.();}
  async step(){
    // A file that was just downloaded unlocks its servos by itself.
    if(this.findSoftware&&Date.now()-this.softwareAt>=SOFTWARE_MS){const was=JSON.stringify(this.softwareView());this.softwareAt=0;if(JSON.stringify(this.softwareView())!==was)this.publish();}
    // Axon's own app and Axon Bridge poll the same programmer, and two apps on one device corrupt each other's traffic.
    if(this.transport.rivals&&Date.now()-this.rivalsAt>=RIVALS_MS){this.rivalsAt=Date.now();this.rivalsNow=await this.transport.rivals();}
    const rivals=this.rivalsNow||[];
    if(rivals.length&&!this.jobs.length&&!this.busy&&!this.stopping){if(this.link)await this.drop();this.resetView();this.programmer={...blank(),rivals};this.publish();await delay(400);return;}
    if(!this.prog){await this.connect();if(!this.prog){await delay(700);return;}}
    // Only one programmer at a time: a second one plugged in stops everything until one is unplugged.
    if(!this.only&&!this.jobs.length&&!this.busy&&Date.now()-(this.otherAt||0)>=RIVALS_MS){this.otherAt=Date.now();const other=await this.transport.find(this.prog.kind==='v1'?S.VID_V2:S.VID_V1,S.PID);
      if(other.length){await this.drop();this.saidConnected=null;this.showBoth();return;}}
    const job=this.jobs.shift();
    if(job){try{job.done(await job.run(this.prog));}catch(e){job.fail(e);if(e instanceof S.DeviceLost)throw e;}this.lastPoll=0;return;}
    if(Date.now()-(this.lastPoll||0)>=POLL_MS){this.lastPoll=Date.now();await this.poll();}else await delay(20);
  }
  async connect(){
    const want=k=>!this.only||this.only===k,none=async()=>[];
    const [v2,v1,boot]=await Promise.all([want('v2')?this.transport.find(S.VID_V2,S.PID):none(),want('v1')?this.transport.find(S.VID_V1,S.PID):none(),want('v2')?this.transport.find(S.VID_BOOT,S.PID):none()]);
    if(v1.length&&v2.length){this.showBoth();return;}
    this.saidBoth=false;const pick=[['v2',v2],['v1',v1]].find(([,list])=>list.length);
    if(!pick){this.resetView();this.programmer={...blank(),bootSeen:boot.length>0};this.publish();return;}
    const [kind,list]=pick,link=await this.transport.open(list[0]),prog=new S.Programmer(link,{trace:line=>this.trace(line)});prog.kind=kind;
    // The V2 programmer answers 0x91. Axon's V1 app has no such check: the V1 programmer is taken as it is, and 0x8A says whether a servo is on it.
    const ok=kind==='v1'||await prog.hello()||await prog.hello();
    if(!ok){await link.close?.();this.resetView();this.programmer={...blank(),handshakeFailed:true,v1Seen:v1.length>0};this.publish();if(!this.warnedHandshake)this.say('A device with the V2 programmer\'s USB ID was found, but it did not answer the handshake.','bad');this.warnedHandshake=true;return;}
    this.warnedHandshake=false;this.link=link;this.prog=prog;this.emptyPolls=0;this.pulseOn=undefined;this.silentDraw=0;this.programmer={...blank(),ready:true,kind,info:list[0],hello:prog.helloReply,v1Seen:v1.length>0,v2Seen:v2.length>0,browningOut:!!this.noAutoPower};
    if(this.saidConnected!==kind){this.saidConnected=kind;this.say(`${NAME[kind]} connected: ${list[0].product||'HID device'}.`,'good');}
  }
  showBoth(){this.resetView();this.programmer={...blank(),both:true,v1Seen:true,v2Seen:true};if(!this.saidBoth){this.saidBoth=true;this.say('Both the V1 and the V2 programmer are plugged in. Unplug the one you are not using: Torque works with one at a time.','warn');}this.publish();}
  async managePower(t){
    if(!t)return;
    if(t.volts>OVER_VOLTAGE){if(!this.warnedVoltage)this.say(`Input voltage is ${t.volts.toFixed(1)} V, above the programmer's 9 V limit. Servo power stays off.`,'bad');this.warnedVoltage=true;return;}
    this.warnedVoltage=false;
    if(this.noAutoPower)return;
    if(!t.powerOn&&!t.powerAlarm&&t.volts<AUTO_POWER_BELOW&&Date.now()-this.lastPower>1200){this.lastPower=Date.now();await this.prog.setServoPower(true);}
  }
  async poll(){
    const v1=this.prog.kind==='v1',t=v1?null:await this.prog.telemetry();if(!v1)await this.managePower(t);let s=await this.prog.status();this.telemetry=t;
    // A V1 servo that stops answering is restarted once (no unplugging): one missed poll is allowed first. With nothing plugged in,
    // the restart finds no bootloader and Torque waits; a servo plugged in later answers by itself.
    if(v1&&!S.servoPresent(s)){if(this.lastKey&&++this.v1Misses<2)return;if(!this.v1Restarted){this.v1Restarted=true;s=await this.prog.restartV1();}}
    if(v1&&S.servoPresent(s)){this.v1Misses=0;this.v1Restarted=false;}
    if(S.servoPresent(s))this.bootServo=null;else if(!v1||this.v1Restarted){const b=await this.bootCheck();if(b)s=b;}
    this.servo=s;
    const present=S.servoPresent(s),key=present?S.servoKey(s):'';
    if(!v1)await this.guardV2(t,s,present);
    if(key!==this.lastKey){
      if(present){
        if(s.family==='unknown')this.say(`A servo answered with an ID Torque does not know (${s.firmware}).`,'warn');
        else if(s.viaBoot&&s.family==='v2')this.say('A MK2 servo is on the V1 programmer. Only its bootloader answers here, so Torque cannot read its model, mode or settings, and the V1 programmer cannot move it to tell. Its mode can be switched here; settings and tests need the V2 programmer.','good');
        else if(s.viaBoot)this.say(s.mode==='unknown'?'A V1 servo is on the V2 programmer, but Torque could not tell its mode. Its settings need the V1 programmer.':`A V1 servo is on the V2 programmer, in ${s.mode==='cr'?'continuous rotation':'servo mode'}: Torque turned it briefly to tell. Its settings need the V1 programmer.`,'good');
        else{this.say(`${s.family.toUpperCase()} servo found on the ${NAME[this.prog.kind]}, running ${s.mode==='cr'?'continuous rotation':'servo'} firmware ${s.firmware}.`,'good');if(s.family==='v1'&&this.prog.kind==='v2'&&!this.saidV1){this.saidV1=true;this.say('The V2 programmer can see this V1 servo.','good');}}
        this.readPending=S.servoEditable(s);this.readAttempts=0;this.block=null;
        if(!S.servoEditable(s)&&s.family==='v1'&&!s.viaBoot)this.say('This V1 variant has no settings layout in Axon\'s V1 app, so its settings cannot be edited.','warn');
      }else{if(this.lastKey)this.say('Servo removed.','warn');this.readPending=false;this.block=null;}
      this.lastKey=key;
    }
    this.publish();if(this.readPending)await this.readNow(s);
  }
  // The V2 programmer's pulse stays off. With a pulse, a servo drives to that position, and in servo mode (just after a switch, say) the
  // current can pass what USB gives, so the programmer drops off USB or locks up (seen 2026-11-04). Axon's MK2 app does not send
  // a pulse either. With none, the servo sits limp and draws nothing. A V1 servo on its pins does not creep either. And a servo
  // drawing over 1.5 A that still says nothing loses its power before it browns the programmer out.
  async guardV2(t,s,present){
    if(this.pulseOn!==false){this.pulseOn=false;await this.prog.pulse(false).catch(()=>{});}
    if(!present&&t?.powerOn&&t.amps>1.5){if(++this.silentDraw>=2){this.silentDraw=0;await this.prog.setServoPower(false);this.noAutoPower=true;this.programmer={...this.programmer,browningOut:true};
      this.say('Something on the V2 programmer draws over 1.5 A but does not answer, so Torque turned its power off. A V1 servo (MAX+ or MINI+) only talks to the V1 programmer. Press Read to power it again.','bad');}}else this.silentDraw=0;
  }
  // ---- A servo on the other generation's programmer. Its own program never answers there, but its bootloader does (seen 2026-11-04):
  // 0x80 answers "V0.3" with hardware 08 01 for a V1 servo on the V2 programmer, and 08 22 for a MK2 servo on the V1 programmer.
  // Asking restarts the servo, so it is asked only when nothing else answers, every BOOT_PROBE_MS. Each hardware ID is both models of
  // its generation, so which one it is must be picked. Only the V2 programmer can measure the mode (it moves the servo); on the V1
  // programmer the mode is unknown until Torque writes one.
  async bootCheck(){
    if(this.bootServo&&Date.now()-this.bootProbeAt<BOOT_PROBE_MS)return this.bootServo;if(Date.now()-this.bootProbeAt<BOOT_PROBE_MS)return null;this.bootProbeAt=Date.now();
    // One missed answer is asked again at once before the servo counts as gone.
    const v1=this.prog.kind==='v1';let hw=await this.bootProbe(this.prog);if(!hw&&this.bootServo)hw=await this.bootProbe(this.prog);if(!hw||hw!==(v1?'0822':'0801')){this.bootServo=null;this.bootMode=null;return null;}
    if(!this.bootMode&&!v1){this.bootMode=await this.measureMode(this.prog);this.bootModeHow='measured';}
    return this.bootServo=this.bootView(hw,this.bootMode);
  }
  // Its mode, from how it moves: with the pulse held a little off centre a continuous rotation servo keeps spinning and keeps drawing
  // current, while a servo in servo mode moves a few degrees and stops. Measured on a V1 MAX with nothing on its horn (2026-11-04):
  // about 0.21 A spinning against 0.03 A holding, 0.02 A idle. A load on the horn can blur this, so the page says to take it off.
  async measureMode(p){
    // Both directions are tried; when they disagree the mode is unknown rather than guessed.
    const hold=async us=>{await p.output(us);const end=Date.now()+900,late=Date.now()+350,amps=[];while(Date.now()<end){const x=await p.telemetry();if(x&&Date.now()>=late)amps.push(x.amps);}await p.output(1500);await delay(350);return amps.length<5?null:amps.reduce((a,b)=>a+b,0)/amps.length;};
    try{await delay(500);await p.output(1500);await delay(400);const up=await hold(MODE_PROBE_US),down=await hold(3000-MODE_PROBE_US);this.trace(`V1 servo mode check: ${up?.toFixed(3)} A at ${MODE_PROBE_US} µs, ${down?.toFixed(3)} A at ${3000-MODE_PROBE_US} µs`);
      if(up===null||down===null)return null;const spin=v=>v>MODE_PROBE_AMPS;return spin(up)&&spin(down)?'cr':!spin(up)&&!spin(down)?'servo':null;}
    finally{await p.pulse(false).catch(()=>{});this.pulseOn=false;}
  }
  bootView(hw,mode){return {family:hw==='0822'?'v2':'v1',mode:mode||'unknown',modeHow:mode?this.bootModeHow:null,type:0,b6:0,b7:hw==='0822'?0x22:1,b8:0,firmware:'',viaBoot:true,hardware:hw};}
  // The V1 programmer passes the bootloader through only in its update mode (04 90 00), as for its own servos.
  async bootProbe(p){
    if(p.kind==='v1'){await p.v1UpdateMode(true);const info=await p.exchange(S.frame(0x80,4,1,2,3,4),r=>r[5]===0x56,700,2,false);if(info){await p.bootExit('v2');await p.bootExit('v1');}await p.v1UpdateMode(false);await p.status();await delay(300);
      return info?info[9].toString(16).padStart(2,'0')+info[10].toString(16).padStart(2,'0'):null;}
    if(this.pulseOn!==false){await p.pulse(false).catch(()=>{});this.pulseOn=false;}const info=await p.exchange(S.frame(0x80,4,1,2,3,4),r=>r[5]===0x56,700,2,false);if(!info)return null;await p.bootExit('v1');
    // The exit alone leaves a V1 servo in its bootloader until something asks it a normal question: one 0x8A starts its own program
    // again (seen 2026-11-04: without it the servo neither spun nor held for 20 s, even across a power cycle).
    await p.status();await delay(300);
    return info[9].toString(16).padStart(2,'0')+info[10].toString(16).padStart(2,'0');}
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
  async liveServo(p){const s=await p.status();return p.kind==='v1'&&!S.servoPresent(s)?p.restartV1():s;}
  read(){this.noAutoPower=false;this.brownouts=0;return this.job('read','Reading the servo...',async()=>{
    const s=await this.liveServo(this.prog);this.servo=s;if(!S.servoEditable(s)){this.say('No servo that can be edited is responding.','warn');return {ok:false};}
    this.readAttempts=0;const ok=await this.readNow(s);if(!ok)this.say('Could not read the settings.','bad');return {ok};});}
  // Read, change, write, read back. Only bytes that belong to edited settings can change, and the answer says what the servo holds now.
  write(changes){return this.job('write','Writing to the servo...',async p=>{
    const cur=await this.liveServo(p);if(!S.servoEditable(cur)||S.servoKey(cur)!==S.servoKey(this.servo))return {ok:false,message:'The servo changed or was unplugged before the write started. Nothing was written.'};
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
    if(ok){await delay(200);const s=await this.liveServo(p);this.servo=s;if(S.servoEditable(s)){this.readAttempts=0;await this.readNow(s);}}return {ok};});}
  closeRivals(){this.rivalsAt=0;return this.transport.closeRivals?.();}

  // ---- Test: Torque drives the servo through the V2 programmer's pulse, and records the pulse it sent with the voltage and current the
  // programmer measured. Neither programmer can see where the servo is, so position is never measured (the page models it). A servo
  // moving from a laptop's USB port can pull more than the port gives: the programmer's voltage dips and it can reset, so each test
  // watches the voltage and stops cleanly below TEST_MIN_V. The pulse goes off at the end, as it is everywhere else.
  testCheck(mode){
    if(this.prog?.kind!=='v2')throw Error('Testing needs the V2 programmer: the V1 programmer has no pulse output Torque can drive.');
    if(this.servo?.viaBoot&&this.servo.family!=='v1')throw Error('Testing needs the V2 programmer.');
    const s=this.servo;if(!S.servoPresent(s)||(s.family!=='v2'&&!s.viaBoot))throw Error('Plug a MK2 servo into the V2 programmer first.');if(!s.viaBoot&&s.mode!==mode)throw Error(`This test is for ${mode==='cr'?'continuous rotation':'servo mode'}.`);
  }
  // At most one reading every 2 ms: about what the programmer gives anyway, and a fast link (the simulator) cannot flood the page.
  async testSample(p,live,t0){const gap=(live.lastAt||0)+2-Date.now();if(gap>0)await delay(gap);live.lastAt=Date.now();const x=await p.telemetry();if(!x)return null;const row=[Date.now()-t0,x.outputPulse,+x.volts.toFixed(2),+x.amps.toFixed(2)];live.samples.push(row);live.volts=row[2];live.amps=row[3];live.minVolts=Math.min(live.minVolts,row[2]);return row;}
  // steps: [{position: 0..1 as in FTC setPosition, hold: seconds}], the first one being where the servo starts.
  test(steps){
    this.testCheck('servo');if(!Array.isArray(steps)||steps.length<2||steps.length>TEST_STEPS+1)throw Error(`A test is a start position and 1 to ${TEST_STEPS} moves.`);
    for(const st of steps)if(!(st&&Number.isFinite(st.position)&&st.position>=0&&st.position<=1&&Number.isFinite(st.hold)&&st.hold>=.2&&st.hold<=5))throw Error('Each position is 0 to 1, and each hold 0.2 to 5 seconds.');
    const plan=steps.map(st=>({position:st.position,us:Math.round(500+st.position*2000),hold:st.hold}));
    this.testStopAsked=false;return this.job('test','Testing the servo. Space or Stop ends it.',async p=>{
      const t0=Date.now(),live=this.testLive={kind:'servo',running:true,plan,samples:[],marks:[],volts:null,amps:null,minVolts:99,ok:false,message:''};let shown=0;
      try{for(let i=0;i<plan.length;i++){live.at=i;live.marks.push(Date.now()-t0);await p.output(plan[i].us);this.pulseOn=null;
          for(const end=Date.now()+plan[i].hold*1000;Date.now()<end;){if(this.testStopAsked){live.message='Stopped. The pulse is off, so the servo is limp.';return this.testEnd(p,live);}const row=await this.testSample(p,live,t0);if(row&&row[2]<TEST_MIN_V){live.message=`The programmer's voltage fell to ${row[2].toFixed(1)} V while the servo moved: the USB port could not keep up, so Torque stopped the test. Try a smaller move, a lower PWM Power, or a powered USB hub.`;return this.testEnd(p,live);}
            if(Date.now()-shown>=100){shown=Date.now();this.busy={...this.busy,percent:Math.round((Date.now()-t0)/1000/plan.reduce((a,x)=>a+x.hold,0)*100)};this.publish();}}}
        live.ok=true;live.message=`The servo ran ${plan.length===2?'its move':`all ${plan.length-1} moves`}; the lowest voltage was ${live.minVolts.toFixed(2)} V.`;return this.testEnd(p,live);}
      catch(e){live.running=false;if(e instanceof S.DeviceLost){live.message='The programmer reset while the servo moved: it pulled more current than the USB port gives. Torque reconnects by itself. Try a smaller move, a lower PWM Power, or a powered USB hub.';throw new S.DeviceLost(live.message);}throw e;}});
  }
  // Stop asks a running position test to end at its next reading (within a few ms).
  testStop(){if(this.busy?.kind==='test')this.testStopAsked=true;return {ok:true};}
  async testEnd(p,live){await p.pulse(false).catch(()=>{});this.pulseOn=false;live.running=false;this.say(live.message,live.ok?'good':'warn');return {ok:live.ok,message:live.message};}
  // Continuous rotation: speed is -1 to 1, null to stop. A drive job runs while a speed is set, easing the pulse toward it so the motor
  // does not jump to full current, and easing back off if the voltage dips. MK2 continuous rotation is full speed at 1050 and 1950 µs.
  drive(speed){
    if(speed===null||speed===undefined){this.driveTarget=null;return {ok:true};}
    if(!Number.isFinite(speed)||speed<-1||speed>1)throw Error('Speed is -1 to 1.');
    this.testCheck('cr');this.driveTarget=speed;if(this.busy?.kind==='drive')return {ok:true};
    void this.job('drive','Spinning the servo. Press Stop to end.',async p=>{
      const t0=Date.now(),live=this.testLive={kind:'cr',running:true,samples:[],speed:0,target:speed,us:CR_STOP,volts:null,amps:null,minVolts:99,held:false,message:''};let us=CR_STOP,last=Date.now(),shown=0,cap=1;
      try{while(this.driveTarget!==null&&this.driveTarget!==undefined&&!this.stopping){
          // A slow turn of the loop (a busy computer) never becomes a jump: at most 50 ms of easing per step.
          const now=Date.now(),dt=Math.min(.05,(now-last)/1000);last=now;live.target=this.driveTarget;const want=CR_STOP+Math.max(-cap,Math.min(cap,this.driveTarget))*(this.servo.viaBoot?CR_SPAN_V1:CR_SPAN);
          us+=Math.max(-CR_RAMP*dt,Math.min(CR_RAMP*dt,want-us));await p.output(us);this.pulseOn=null;live.us=Math.round(us);live.speed=(us-CR_STOP)/(this.servo.viaBoot?CR_SPAN_V1:CR_SPAN);
          const row=await this.testSample(p,live,t0);if(live.samples.length>600)live.samples.splice(0,live.samples.length-600);
          // A dip: hold the speed a little lower from here on, so the port keeps up.
          if(row&&row[2]<CR_MIN_V){cap=Math.max(.1,Math.abs(live.speed)-.15);live.held=true;}
          if(now-shown>=100){shown=now;this.publish();}await delay(15);}
        live.message=live.held?'The USB port could not give full speed, so Torque held the speed back. A powered USB hub lets it go faster.':'';}
      finally{await p.pulse(false).catch(()=>{});this.pulseOn=false;live.running=false;live.speed=0;live.us=CR_STOP;this.driveTarget=null;this.publish();}
      return {ok:true};}).catch(e=>{this.say(e instanceof S.DeviceLost?'The programmer reset while the servo spun: it pulled more current than the USB port gives. Torque reconnects by itself.':e.message,'warn');});
    return {ok:true};
  }
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
  // Fetches one firmware file from Axon's link into the firmware folder, checked against its pinned size and hash. No busy banner.
  async fetchQuiet(file){
    const data=await this.fetchFile(file.url);
    if(data.length!==file.size||(file.sha256&&S.sha256(data)!==file.sha256))throw Error(`${file.fileName} from Axon's link is not the file Torque expects, so it was thrown away. Axon may have updated it: choose it by hand, or update Torque.`);
    S.loadFirmware(data,file.fileName);fs.mkdirSync(this.firmwareDir,{recursive:true});const temp=this.firmwarePath(file)+'.part';fs.writeFileSync(temp,data);fs.renameSync(temp,this.firmwarePath(file));
  }
  // All of Axon's firmware files (V1 .sfw and V2 .sfm), each once, in the background. A file already here is left alone.
  prefetchFirmware(){
    if(!this.fetchFile||!this.firmwareDir||this.only==='v1'||this.prefetching)return this.prefetching;
    this.prefetching=(async()=>{let got=0;for(const file of this.catalog){let have=false;try{const d=fs.readFileSync(this.firmwarePath(file));have=!file.sha256||S.sha256(d)===file.sha256;}catch{}
        if(have)continue;try{await this.fetchQuiet(file);got++;}catch{}}
      if(got)this.say(`Downloaded ${got} of Axon's firmware file${got===1?'':'s'}, so switching mode is one press.`,'good');})().finally(()=>{this.prefetching=null;});
    return this.prefetching;
  }
  async download(code,mode){
    const file=this.fileFor(code,mode);if(!file)throw Error('Torque has no firmware for that servo.');if(!this.fetchFile)throw Error('Downloading is not available here. Choose the file instead.');
    if(this.busy)throw Error('The programmer is busy with something else.');this.busy={kind:'download',text:`Downloading ${file.fileName}...`,percent:null};this.publish();
    try{const data=await this.fetchFile(file.url);
      if(data.length!==file.size||(file.sha256&&S.sha256(data)!==file.sha256))throw Error(`${file.fileName} from Axon's link is not the file Torque expects, so it was thrown away. Axon may have updated it: choose it by hand, or update Torque.`);
      S.loadFirmware(data,file.fileName);fs.mkdirSync(this.firmwareDir,{recursive:true});const temp=this.firmwarePath(file)+'.part';fs.writeFileSync(temp,data);fs.renameSync(temp,this.firmwarePath(file));this.say(`Downloaded ${file.fileName}.`,'good');return {fileName:file.fileName};}
    finally{this.busy=null;this.publish();}
  }
  // Recovery is for a servo that stopped appearing after an interrupted update: the hardware ID is still checked, its name cannot be.
  // again: the student confirmed writing the mode the servo is already in.
  // confirmed: the model the student said yes to, when Torque cannot identify the servo. A write for any other model is refused.
  flash({code,mode,recovery=false,allowUnknownName=false,again=false,confirmed=null}){
    this.trace(`Switch asked: ${code} ${mode}${confirmed?`, confirmed as ${confirmed}`:''}${again?', again':''}`);
    if(this.servo?.viaBoot&&!recovery&&confirmed!==code)throw Error(`The model to write (${S.modelByCode(code)?.title||code}) is not the one confirmed (${S.modelByCode(confirmed)?.title||'none'}). Nothing was written.`);
    const model=S.modelByCode(code),file=this.fileFor(code,mode);if(!model||!file)throw Error('Torque has no firmware for that servo.');
    const source=this.chosen.get(`${code}/${mode}`)||(this.firmwareStatus(code,mode).have?this.firmwarePath(file):null);
    if(!source&&this.fetchFile&&!arguments[0].fetched)return (this.prefetching||Promise.resolve()).then(()=>this.firmwareStatus(code,mode).have?null:this.fetchQuiet(file)).then(()=>this.flash({...arguments[0],fetched:true}));
    if(!source)throw Object.assign(Error(`${file.fileName} is needed first.`),{code:'FIRMWARE_NEEDED'});
    const image=S.readFirmware(source);if(image.family!==model.family)throw Error(`That firmware is for a ${image.family.toUpperCase()} servo, but this is a ${model.title}.`);
    // Every model has its own firmware (a MINI's is not a MAX's, in either generation), and each file names its model in its header.
    // The file must name the model picked, on every path, including through a bootloader where the servo cannot report its own name.
    if(S.norm(image.name)!==model.factoryName)throw Error(`${path.basename(source)} is firmware for "${image.name}", not a ${model.title} (${model.factoryName}). Nothing was written.`);
    if(image.badChecksums)this.say(`${image.badChecksums} records in this file fail the standard HEX checksum. The servo checks each one as it is written.`,'warn');
    const boot=!!this.servo.viaBoot&&image.family===this.servo.family;if(boot)allowUnknownName=true;
    const name=this.block&&this.servo.family===image.family?S.blockName(this.block):null;
    if(!recovery&&!name&&!allowUnknownName)throw Object.assign(Error('The servo\'s name could not be read, so it cannot be matched to this firmware by name. The hardware ID check still runs.'),{code:'NAME_UNKNOWN'});
    return this.job('flash',`Switching to ${mode==='cr'?'continuous rotation':'servo mode'}...`,async p=>{
      this.say(`Writing ${path.basename(source)} (${image.bytes} bytes, "${image.name}").`);
      const progress=(percent,message)=>{this.busy={...this.busy,percent};if(message)this.say(message);else this.publish();};
      if(boot&&p.kind==='v2'){const now=await this.measureMode(p);if(now===mode&&!again){this.bootMode=now;this.bootModeHow='measured';return {ok:false,changed:false,message:`It is already in ${mode==='cr'?'continuous rotation':'servo mode'}. Nothing was written.`};}}
      if(image.family!==p.kind&&!boot)return {ok:false,message:image.family==='v1'?'A V1 servo is switched through the V1 programmer. Plug it into that one. Nothing was changed.':'A MK2 servo is switched through the V2 programmer. Plug it into that one. Nothing was changed.',changed:false};
      const flashed=await S.flash(p,image,name,{allowUnknownName:recovery||allowUnknownName,progress});
      if(!flashed.ok){this.say(flashed.error,flashed.changed?'bad':'warn');this.lastKey='';return {ok:false,message:flashed.error,changed:flashed.changed};}
      // Through the bootloader only: the servo cannot be asked its mode, so its bootloader answering again is the check.
      if(boot){progress(100,'Checking the servo restarted...');await delay(600);this.bootProbeAt=0;const hw=await this.bootProbe(p);this.lastKey='';this.block=null;this.bootProbeAt=Date.now();
        const own=image.family==='v1'?'V1':'V2';if(!hw){this.bootServo=null;return {ok:false,changed:true,message:`The firmware was written, but the servo did not answer afterwards. Unplug it, plug it back in, and check it on the ${own} programmer.`};}
        this.bootMode=mode;this.bootModeHow='written';this.servo=this.bootServo=this.bootView(hw,mode);
        return {ok:true,changed:true,mode,message:`Switched to ${mode==='cr'?'continuous rotation':'servo mode'}. On the ${p.kind.toUpperCase()} programmer Torque cannot read this servo's mode back: it shows the one it wrote.`};}
      progress(100,'Waiting for the servo to restart...');await delay(800);
      let s=await this.waitForServo(p,10);
      // The two official apps frame the exit command differently, so try the other form once.
      if(!S.servoPresent(s)){await p.bootExit(image.family==='v1'?'v2':'v1');s=await this.waitForServo(p,6);}
      if(!S.servoPresent(s)&&p.kind==='v1')s=await p.restartV1();
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
