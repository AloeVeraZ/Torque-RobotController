'use strict';
// The Axon Programmer tab, in the main process: owns the programmer on one loop so a USB timeout can never freeze the
// window, and only while the page asks (start and stop). Moved from Axon Bridge's Worker.cs. It polls the programmer and servo,
// runs one job at a time, and tells the page what it sees with onState. USB itself is the small helper in src/axon-usb, which
// is Windows only: Node has no HID without a native module, and Torque's releases are Windows only for now.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const S=require('./axon-servo.cjs');
const SOFTWARE_MS=3000;
const BOOT_PROBE_MS=5000,BOOT_PROBE_V1_MS=2000,CREEP_STEP=5,CREEP_STEP_MS=90,CREEP_END=150,CREEP_RISE=10,CREEP_NUDGE=80,CREEP_HOLD=350,TEST_STEPS=5,TEST_MIN_V=3.4,CR_MIN_V=4.1,CR_STOP=1500,CR_SPAN=450,CR_SPAN_V1=500,CR_RAMP=600;
// A servo moved from its own programmer to the other one: see carry() below.
const HANDOVER_MS=60000,BOOT_SAME_MS=12000,known={};
// A V1 servo in continuous rotation on the V2 programmer, told apart by what it draws while Torque turns it to find its mode: the two
// currents of that check added together (one each way, so the Inversion setting does not matter). Measured 2026-11-10 from a laptop
// USB port with nothing on the horn: two V1 MAX in 7 checks, 0.42 to 0.48 A; one V1 MINI in 7 checks, 0.58 to 0.62 A. Between the
// two limits Torque says nothing rather than guess. It is a measurement of three servos, not a reading of the name: the tab says
// so, the other model can be picked, and a firmware write still asks.
const V1_CR_MAX_BELOW=.50,V1_CR_MINI_ABOVE=.555;
// The same, from the crawl check's raw counts (both ways added). Not set until both models have been measured this way.
// Measured 2026-11-10 on one V1 MAX and one V1 MINI, six checks each, laptop USB, nothing on the horn: MAX 238 to 247 counts,
// MINI 309 to 320. (At the crawl point itself both read 48 counts: the same firmware starts both at the same drive. A nudge of
// 60 µs gave 204 to 218 against 249 to 263, too close.) Between the two limits Torque says nothing rather than guess.
const V1_CRAWL_MAX_BELOW=265,V1_CRAWL_MINI_ABOVE=292;
// Whether anything is on the V2 programmer's servo pins, from bytes 7-8 of its status report (seen 2026-11-10 while V1 MAX and MINI
// servos were plugged and unplugged): 0x03FF with a servo on the pins, 0x0416 to 0x0418 with none, within one report of the change.
// Axon's app does not use these bytes and what they measure is not known, so they only decide WHEN Torque asks the bootloader
// (at once, instead of at the next 5 second check); the bootloader's answer is still what says a servo is there or gone.
const PINS_SERVO=0x3FF,pinsEmpty=v=>v>=0x410&&v<=0x420;
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
    Object.assign(this,{transport,firmwareDir,logFile,keyFile,sharedKeyFile,findSoftware,catalog,onState,fetchFile,only});this.carriedFile=logFile?path.join(path.dirname(logFile),'axon-carried.json'):null;this.softwareNow=null;this.softwareAt=0;this.loadKeys();this.running=null;this.stopping=false;this.jobs=[];this.link=null;this.prog=null;this.resetView();this.log=[];this.traceLines=[];this.chosen=new Map();this.lastPower=0;
  }
  resetView(){this.testLive=null;this.programmer=blank();this.telemetry=null;this.servo=S.parseStatus(Buffer.alloc(S.REPORT));this.block=null;this.blockKey=null;this.lastKey='';this.readPending=false;this.readAttempts=0;this.busy=null;this.warnedVoltage=false;this.warnedHandshake=false;this.v1Misses=0;this.v1Restarted=false;this.bootServo=null;this.bootProbeAt=0;this.gone();this.carried=null;this.carriedOld=false;this.bootFirstAt=0;this.bootLastAt=0;}
  say(text,tone='info'){if(this.log.at(-1)?.text===text)return;this.log.push({text,tone,at:Date.now()});if(this.log.length>LOG_LINES)this.log.shift();this.trace(`[${tone}] ${text}`);this.publish();}
  trace(line){const text=`${new Date().toISOString().slice(11,23)} ${this.only?`[${this.only}] `:''}${line}`;this.traceLines.push(text);if(this.traceLines.length>TRACE_LINES)this.traceLines.shift();if(this.logFile){try{fs.appendFileSync(this.logFile,text+'\n');}catch{}}}
  // Axon's own program for each servo family, if this computer has it (src/axon-software.cjs). Nothing needs it: it is only offered for a mode switch.
  softwareFound(fresh=false){if(!this.findSoftware)return {v1:{found:true},v2:{found:true}};if(fresh||!this.softwareNow||Date.now()-this.softwareAt>=SOFTWARE_MS){this.softwareAt=Date.now();try{this.softwareNow=this.findSoftware();}catch{this.softwareNow||={v1:{found:false},v2:{found:false}};}}return this.softwareNow;}
  softwareFile(family){return this.softwareFound(true)[family]?.path||null;}
  softwareView(){const s=this.softwareFound();return Object.fromEntries(['v1','v2'].map(f=>[f,{found:!!s[f]?.found,fileName:s[f]?.fileName||null}]));}
  // What the page draws. A value only the main process should hold (paths, the block's buffer) stays out.
  state(){
    const s=this.servo,block=this.block,present=S.servoPresent(s),carried=s.viaBoot&&this.carried&&S.modelByCode(this.carried.code)?.family===s.family?this.carried:null,name=block?S.blockName(block):carried?.name||null,guess=s.viaBoot&&!carried&&s.family==='v1'&&this.prog?.kind==='v2'?this.bootGuess:null,model=name?S.modelByName(name):guess?S.modelByCode(guess.code):null,editable=S.servoEditable(s);
    let settings=null;
    if(block&&editable&&present){const schema=S.schemaFor(s.family,s.mode),values=schema.decode(block.data),factory=model?schema.decode(S.factoryBlock(model,s.mode)):null;
      settings={schema:S.schemaView(schema),values,factory};}
    return {only:this.only,supported:this.transport.supported!==false,running:!!this.running,programmer:this.programmer,telemetry:this.telemetry,
      servo:{...s,present,editable,key:S.servoKey(s),model:model?S.modelView(model):null,name,carried:carried?{from:carried.from,...(carried.restored?{restored:true}:{})}:null,guessed:guess?{amps:guess.amps}:null,epoch:s.viaBoot?this.bootEpoch||0:0,made:block?S.blockMade(block):null,validLen:block?.validLen??0,raw:block?S.hex(block.data,block.data.length):null,
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
    await this.drop();this.forget();for(const job of this.jobs.splice(0))job.fail(Error('The Axon programmer page closed.'));
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
    // The pins read empty while a servo is shown: ask its bootloader now, with one short wait. The pins also read empty for a moment
    // while a servo restarts, so an answer means it is still there; after three such answers in a row Torque stops asking early until
    // the pins change. (It used to ask early once only, at the second empty report: after an Identify that one early ask was spent
    // while the servo was still in, and pulling it then took 5 seconds to show, 2026-11-10.)
    if(t&&!S.servoPresent(s)){const empty=pinsEmpty(t.pins),full=t.pins===PINS_SERVO;if(!empty)this.quickHits=0;
      if(this.bootServo&&empty&&(this.quickHits||0)<3&&Date.now()-(this.quickAt||0)>=500){this.quickAt=Date.now();this.bootProbeAt=0;this.bootQuick=true;}else if(!this.bootServo&&full&&this.pinsWere==='empty')this.bootProbeAt=0;
      if(empty||full)this.pinsWere=empty?'empty':'full';}
    // A V1 servo that stops answering is restarted once (no unplugging): one missed poll is allowed first. With nothing plugged in,
    // the restart finds no bootloader and Torque waits; a servo plugged in later answers by itself.
    // Two missed polls and the page is told the servo is gone at once (under a second); the restart, which takes about three seconds
    // with nothing there, comes on the poll after, and a servo that had only stopped answering shows up again from it.
    if(v1&&!S.servoPresent(s)){if(this.lastKey&&++this.v1Misses<2)return;if(this.lastKey&&!this.v1Gone)this.v1Gone=true;else if(!this.v1Restarted){this.v1Restarted=true;s=await this.prog.restartV1();}}
    if(v1&&S.servoPresent(s)){this.v1Misses=0;this.v1Restarted=false;this.v1Gone=false;}
    if(S.servoPresent(s)){this.bootServo=null;if(this.carried)this.setCarried(null);this.bootFirstAt=0;}else if(!v1||this.v1Restarted){const b=await this.bootCheck();if(b)s=this.carry(b);}
    this.servo=s;
    const present=S.servoPresent(s),key=present?S.servoKey(s):'';
    if(!v1)await this.guardV2(t,s,present);
    if(key!==this.lastKey){
      if(present){
        if(s.family==='unknown')this.say(`A servo answered with an ID Torque does not know (${s.firmware}).`,'warn');
        else if(s.viaBoot&&this.carried)this.say(`The ${S.modelByCode(this.carried.code).title} that was on the ${NAME[this.carried.from]} ${this.carried.restored?'earlier':'a moment ago'} is now on the ${NAME[this.prog.kind]}${s.mode==='unknown'?'':`, in ${s.mode==='cr'?'continuous rotation':'servo mode'}`}. Torque read its name (${this.carried.name}) there and takes this to be the same servo: here only its bootloader answers, so its settings still need the ${NAME[this.carried.from]}.`,'good');
        else if(s.viaBoot&&s.family==='v2')this.say('A MK2 servo is on the V1 programmer. Only its bootloader answers here, so Torque cannot read its model, mode or settings, and the V1 programmer cannot move it to tell. Its mode can be switched here; settings and tests need the V2 programmer.','good');
        else if(s.viaBoot&&this.bootGuess&&this.prog.kind==='v2')this.say(`A V1 servo is on the V2 programmer, in continuous rotation, and it looks like a ${S.modelByCode(this.bootGuess.code).title}: Torque nudged it slightly and it drew ${this.bootGuess.amps.toFixed(2)} A (a MAX+ draws about 0.16 A in that check, a MINI+ about 0.21 A). Its name cannot be read here, so that is a measurement. Its settings need the V1 programmer.`,'good');
        else if(s.viaBoot)this.say(s.mode==='unknown'?(s.modeHow==='unclear'?'A V1 servo is on the V2 programmer, but Torque could not tell its mode from how it turned. Its settings need the V1 programmer.':'A V1 servo is on the V2 programmer. This programmer cannot read which V1 servo it is or its mode: pick them, or let Torque identify it by moving it slightly. Its settings need the V1 programmer.'):`A V1 servo is on the V2 programmer, in ${s.mode==='cr'?'continuous rotation':'servo mode'}: Torque nudged it slightly to tell. Its settings need the V1 programmer.`,'good');
        else{this.say(`${s.family.toUpperCase()} servo found on the ${NAME[this.prog.kind]}, running ${s.mode==='cr'?'continuous rotation':'servo'} firmware ${s.firmware}.`,'good');if(s.family==='v1'&&this.prog.kind==='v2'&&!this.saidV1){this.saidV1=true;this.say('The V2 programmer can see this V1 servo.','good');}}
        this.readPending=S.servoEditable(s);this.readAttempts=0;this.block=null;
        if(!S.servoEditable(s)&&s.family==='v1'&&!s.viaBoot)this.say('This V1 variant has no settings layout in Axon\'s V1 app, so its settings cannot be edited.','warn');
      }else{if(this.lastKey)this.say('Servo removed.','warn');this.readPending=false;this.block=null;}
      this.lastKey=key;
    }
    this.publish();if(this.readPending)await this.readNow(s);this.noteKnown();
  }
  // ---- A servo carried from one programmer to the other. Neither programmer can read the name of the other generation's servo
  // (tried on real hardware, 2026-11-10: a V1 MAX's own program answers nothing on the V2 programmer, whatever is asked), so the
  // model is only ever read on the servo's own programmer. But a student moves a servo across to test it or switch it, and the app
  // runs one service per programmer in one process: the service that read a servo's name remembers it here (known), and when that
  // servo stops answering and a servo of the same generation shows up through its bootloader on the other programmer afterwards,
  // within HANDOVER_MS, that service takes it to be the same one. It is an inference, said as one, and a firmware write still asks.
  // A servo that was already on the other programmer while this one still answered is never taken for it.
  noteKnown(){
    const s=this.servo,name=this.block&&S.servoPresent(s)&&!s.viaBoot?S.blockName(this.block):null,model=name?S.modelByName(name):null;
    if(model&&model.family===this.prog?.kind){known[model.family]={code:model.code,name,mode:s.mode,owner:this,present:true,seenAt:Date.now()};this.knows=model.family;}
    else if(this.knows&&known[this.knows]?.owner===this&&(!S.servoPresent(s)||s.viaBoot))known[this.knows].present=false;
  }
  forget(){if(this.knows&&known[this.knows]?.owner===this)delete known[this.knows];this.knows=null;}
  // The programmer itself going away is the servo going away too: pulling a servo off the V1 programmer can drop the programmer off USB
  // for a moment (seen 2026-11-10, USB error 1167 as the servo left), and what was read must outlive that.
  gone(){if(this.knows&&known[this.knows]?.owner===this)known[this.knows].present=false;}
  // What was carried is kept beside the USB log, so the name is still there after the programmer drops off USB or Torque restarts.
  // It is dropped once the servo has been gone for BOOT_SAME_MS, or a servo answers here normally. Torque cannot see a swap made while
  // it was closed, which is one more reason a firmware write still asks.
  carriedSaved(){try{return JSON.parse(fs.readFileSync(this.carriedFile,'utf8'))||{};}catch{return {};}}
  setCarried(c){this.carried=c;this.carriedOld=false;if(!this.carriedFile)return;const all=this.carriedSaved(),key=this.only||'all';if(c)all[key]={code:c.code,name:c.name,mode:c.mode,from:c.from,at:new Date().toISOString()};else if(key in all)delete all[key];else return;try{fs.writeFileSync(this.carriedFile,JSON.stringify(all,null,2));}catch{}}
  restoreCarried(hw){if(!this.carriedFile)return;const c=this.carriedSaved()[this.only||'all'],model=c&&S.modelByCode(c.code);if(model&&model.family===(hw==='0822'?'v2':'v1')&&model.factoryName===c.name&&(c.from==='v1'||c.from==='v2'))this.carried={code:c.code,name:c.name,mode:c.mode,from:c.from,restored:true};}
  carry(b){
    const k=known[b.family];
    if((!this.carried||this.carriedOld)&&k&&k.owner!==this&&k.owner.running&&!k.present&&this.bootFirstAt>=k.seenAt&&this.bootFirstAt-k.seenAt<=HANDOVER_MS){this.setCarried({code:k.code,name:k.name,mode:k.mode,from:k.owner.only||k.owner.prog?.kind});delete known[b.family];this.lastKey='';}
    // The V1 programmer cannot move a servo to tell its mode, so the mode read on the V2 programmer comes along too.
    if(this.carried&&!this.bootMode&&(this.carried.mode==='servo'||this.carried.mode==='cr')){this.bootMode=this.carried.mode;this.bootModeHow='carried';b=this.bootServo=this.bootView(b.hardware,this.bootMode);}
    return b;
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
    // The V1 programmer has no pins reading to say a servo came or went, so there the bootloader is asked more often.
    // Only while nothing is shown, though: every ask restarts the servo, and a MK2 servo restarting every 2 seconds pulled the real
    // V1 programmer off USB again and again (errors 995 and 1167 a few seconds after each time it was found, 2026-11-10).
    const every=this.prog.kind==='v1'&&!this.bootServo?BOOT_PROBE_V1_MS:BOOT_PROBE_MS;
    if(this.bootServo&&Date.now()-this.bootProbeAt<every)return this.bootServo;if(Date.now()-this.bootProbeAt<every)return null;this.bootProbeAt=Date.now();
    // One missed answer is asked again at once before the servo counts as gone.
    const v1=this.prog.kind==='v1',quick=this.bootQuick;this.bootQuick=false;let hw=await this.bootProbe(this.prog,quick);if(!hw&&this.bootServo&&!quick)hw=await this.bootProbe(this.prog);if(hw)this.fullRetries=0;if(quick&&hw)this.quickHits=(this.quickHits||0)+1;
    // Something is on the pins but did not answer yet (a servo just plugged in is still starting): asked again in under a second, three times.
    // The pins went empty and the bootloader is gone: the servo really was unplugged, so whatever is plugged in next is another servo,
    // however quickly (a servo swapped in three seconds was taken for the one before it, 2026-11-10).
    if(quick&&!hw){this.bootLastAt=0;if(this.carried)this.setCarried(null);}
    if(!hw&&!v1&&this.telemetry?.pins===PINS_SERVO&&(this.fullRetries=(this.fullRetries||0)+1)<=3)this.bootProbeAt=Date.now()-BOOT_PROBE_MS+800;
    if(!hw||hw===(v1?'0801':'0822')){this.bootServo=null;if(this.carried&&this.bootLastAt&&Date.now()-this.bootLastAt>BOOT_SAME_MS)this.setCarried(null);return null;}
    // A bootloader with a hardware ID that is neither generation's (a model Torque has no evidence for): shown as it answered, never guessed at.
    if(hw!=='0801'&&hw!=='0822'){this.bootMode=null;this.bootGuess=null;return this.bootServo={family:'unknown',mode:'unknown',type:0,b6:0,b7:0,b8:0,firmware:`bootloader reply ${this.bootReply}`,hardware:hw};}
    // The same servo while it keeps answering. One found after a gap may be another one: it can take a name from the other programmer
    // (carry), and failing that keeps the name it had only if the gap was shorter than BOOT_SAME_MS (a missed check, not a swap).
    // The first one found after this programmer was opened takes back the name saved for it.
    {const now=Date.now();if(!this.bootFirstAt&&!this.carried)this.restoreCarried(hw);
      if(!this.bootFirstAt||!this.bootServo){const fresh=!this.bootFirstAt||now-this.bootLastAt>BOOT_SAME_MS;if(this.bootFirstAt&&this.carried){if(fresh)this.setCarried(null);else this.carriedOld=true;}
        // What was measured stays through a missed check: the servo is not turned again for it.
        // Whatever was learned by moving the last servo goes with it: any servo found after one was declared gone is asked about again.
        this.bootGuess=null;this.bootTried=false;if(this.bootModeHow!=='carried'||fresh)this.bootMode=null;
        // epoch: which servo this is, for the page (it asks about each newly plugged in servo once). The V1 programmer has no pins
        // reading, so there any servo found after one was declared gone counts as newly plugged in.
        this.bootEpoch=(this.bootEpoch||0)+1;this.bootFirstAt=now;}this.bootLastAt=now;}
    // A servo Torque already read on its own programmer is not turned at all: its mode came with its name. Only one it knows nothing
    // about is turned, for about two seconds, because how it moves and what it draws are all the V2 programmer can learn about it.
    {const was=this.carried;this.carry({family:hw==='0822'?'v2':'v1',hardware:hw});if(this.carried&&this.carried!==was&&this.bootModeHow!=='written'){const m=this.carried.mode;this.bootGuess=null;this.bootMode=m==='servo'||m==='cr'?m:null;this.bootModeHow='carried';}}
    if(!this.bootMode&&this.carried&&(this.carried.mode==='servo'||this.carried.mode==='cr')){this.bootMode=this.carried.mode;this.bootModeHow='carried';}
    // Torque never moves a servo by itself: something may be attached to it. A V1 servo it knows nothing about stays "mode and model
    // not known" until the student picks them, or asks for Identify (identify() below) after a pop-up that says the servo will move.
    // (Decided with the user, 2026-11-10, after trying a spin when found, no movement at all, and a smaller automatic nudge.)
    return this.bootServo=this.bootView(hw,this.bootMode);
  }
  // Its mode, from how it moves: with the pulse held a little off centre a continuous rotation servo keeps spinning and keeps drawing
  // current, while a servo in servo mode moves a few degrees and stops. Measured on a V1 MAX with nothing on its horn (2026-11-04):
  // about 0.21 A spinning against 0.03 A holding, 0.02 A idle. A load on the horn can blur this, so the page says to take it off.
  // The check that moves the servo as little as it can (2026-11-10: a mechanism may be on the horn, so the old one second spin each
  // way had to go). It only ever runs when the student asks for it (identify()), or just before a mode switch.
  // 1. The crawl points. The pulse steps outward from centre CREEP_STEP µs at a time. A continuous rotation servo does nothing inside
  //    its stop zone, and at the first step past its edge it starts to crawl and draws a small current: that step is its crawl
  //    point, and the pulse goes back to centre at once. Up, then down. A servo in servo mode follows each step by a fraction of a
  //    degree and settles, so no step keeps its current up: no crawl point either way by CREEP_END µs means servo mode.
  // 2. The nudges. From centre straight to CREEP_NUDGE µs past each crawl point for CREEP_HOLD ms, reading the current over the last
  //    100 ms, and back to centre. Up, then down, so it ends about where it began. This is what tells a MAX+ from a MINI+: at the
  //    crawl point itself they read the same.
  // Both crawl points are found before either nudge because a crawl point found just after a nudge comes out 5 to 20 µs late (seen
  // on both real servos), which moved the readings by different amounts for each. Readings are the programmer's raw current counts
  // (one is about 1.3 mA).
  async measureMode(p){
    const raw=async()=>{const x=await p.telemetry();return x?(x.ampsRaw??Math.round(x.amps*4096*.6/3.3)):null;},mean=a=>a.reduce((x,y)=>x+y,0)/a.length;let base=null;
    const edge=async dir=>{const floor=[];for(let i=0;i<6;i++){const v=await raw();if(v!==null)floor.push(v);}if(!floor.length)return null;base=mean(floor);
      for(let o=CREEP_STEP;o<=CREEP_END;o+=CREEP_STEP){await p.output(1500+dir*o);const seen=[];for(const end=Date.now()+CREEP_STEP_MS;Date.now()<end;){const v=await raw();if(v!==null)seen.push(v);}
        if(seen.length&&mean(seen.slice(-6))>=base+CREEP_RISE){await p.output(1500);await delay(250);return o;}}
      await p.output(1500);await delay(250);return 0;};
    const nudge=async us=>{await p.output(us);const late=[];for(const t0=Date.now();Date.now()-t0<CREEP_HOLD;){const v=await raw();if(v!==null&&Date.now()-t0>=CREEP_HOLD-100)late.push(v);}await p.output(1500);await delay(250);return late.length?+mean(late).toFixed(1):0;};
    try{await p.output(1500);await delay(300);this.creep=null;const eu=await edge(1),ed=eu===null?null:await edge(-1);
      if(eu===null||ed===null){this.trace('V1 servo mode check: the programmer gave no readings');return null;}
      if(!eu&&!ed){this.trace(`V1 servo mode check: no crawl up to ${CREEP_END} µs either way`);return 'servo';}
      if(!eu||!ed){this.trace(`V1 servo mode check: a crawl one way only (+${eu} / -${ed} µs)`);return null;}
      const up=await nudge(1500+eu+CREEP_NUDGE),down=await nudge(1500-ed-CREEP_NUDGE);this.trace(`V1 servo mode check: crawls from +${eu} and -${ed} µs; ${CREEP_NUDGE} µs past them it draws ${up} and ${down} counts`);
      if(up<base+CREEP_RISE||down<base+CREEP_RISE)return null;this.creep={up:{at:eu,raw:up},down:{at:-ed,raw:down}};return 'cr';}
    finally{await p.pulse(false).catch(()=>{});this.pulseOn=false;}
  }
  guessV1(){const c=this.creep;if(!c?.up?.at||!c?.down?.at)return null;const counts=+(c.up.raw+c.down.raw).toFixed(1),code=counts<=V1_CRAWL_MAX_BELOW?'max1':counts>=V1_CRAWL_MINI_ABOVE?'mini1':null;this.trace(`V1 model from that check: ${counts} counts both ways together, ${code||'not said'}`);return code?{code,amps:+(counts/2/4096*3.3/.6).toFixed(3),counts}:null;}
  // Identify: turns a V1 servo on the V2 programmer for about two seconds to tell its mode, and in continuous rotation its model.
  identify(){
    if(this.prog?.kind!=='v2'||!this.servo?.viaBoot||this.servo.family!=='v1')throw Error('Identify is for a V1 servo on the V2 programmer.');
    return this.job('identify','Moving the servo slightly to identify it.',async p=>{
      const mode=await this.measureMode(p);this.bootTried=true;this.bootMode=mode;this.bootModeHow='measured';this.bootGuess=mode==='cr'?this.guessV1():null;
      if(this.bootServo?.viaBoot){this.servo=this.bootServo=this.bootView(this.bootServo.hardware,mode);this.lastKey='';}
      // No answer from the movement can mean the servo was pulled out while it ran: its bootloader is asked at once, so a servo that
      // is gone is shown as gone and not as "mode unknown".
      if(!mode){this.bootProbeAt=0;this.bootQuick=true;this.quickHits=0;}
      return {ok:!!mode,mode,model:this.bootGuess?.code||null};});
  }
  bootView(hw,mode){return {family:hw==='0822'?'v2':'v1',mode:mode||'unknown',modeHow:mode?this.bootModeHow:this.bootTried?'unclear':null,type:0,b6:0,b7:hw==='0822'?0x22:1,b8:0,firmware:'',viaBoot:true,hardware:hw};}
  // The V1 programmer passes the bootloader through only in its update mode (04 90 00), as for its own servos.
  async bootProbe(p,quick=false){
    if(p.kind==='v1'){await p.v1UpdateMode(true);const info=await p.exchange(S.frame(0x80,4,1,2,3,4),r=>r[5]===0x56,450,1,false);if(info){this.bootReply=S.hex(info,11);await p.bootExit('v2');await p.bootExit('v1');}await p.v1UpdateMode(false);await p.status();await delay(300);
      return info?info[9].toString(16).padStart(2,'0')+info[10].toString(16).padStart(2,'0'):null;}
    if(this.pulseOn!==false){await p.pulse(false).catch(()=>{});this.pulseOn=false;}const info=await p.exchange(S.frame(0x80,4,1,2,3,4),r=>r[5]===0x56,quick?400:700,quick?1:2,false);if(!info)return null;this.bootReply=S.hex(info,11);await p.bootExit('v1');
    // The exit alone leaves a V1 servo in its bootloader until something asks it a normal question: one 0x8A starts its own program
    // again (seen 2026-11-04: without it the servo neither spun nor held for 20 s, even across a power cycle).
    await p.status();await delay(300);
    return info[9].toString(16).padStart(2,'0')+info[10].toString(16).padStart(2,'0');}
  async readNow(s){
    const {block,error}=await this.prog.readBlock(s.family);this.readAttempts++;
    if(!block){if(this.readAttempts>=3){this.readPending=false;this.say(`Could not read this servo's settings. ${error}`,'bad');}return false;}
    this.readPending=false;this.block=block;
    if(block.family==='v1'&&block.validLen<95)this.say('The programmer returned only the first 59 of 95 bytes. All the settings are there, but the servo\'s name is not.','warn');
    this.say('Read the servo\'s current settings.','good');
    // A name that is none of the four models Torque has evidence for (a MICRO+, say): said as it is, with the raw status bytes, never matched to a near one.
    const name=S.blockName(block);if(name&&!S.modelByName(name))this.say(`This ${s.family.toUpperCase()} servo calls itself "${name}", which is not a model Torque knows (${S.MODELS.map(m=>`${m.factoryName} is the ${m.title}`).join(', ')}). Its status reply was ${[s.type,s.b6,s.b7,s.b8].map(b=>b.toString(16).toUpperCase().padStart(2,'0')).join(' ')}. Torque will not switch its mode: it has no firmware for it.`,'warn');
    return true;
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
