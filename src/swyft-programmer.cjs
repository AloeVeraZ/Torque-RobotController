'use strict';
// The SWYFT Programmer tab, in the main process: owns SWYFT's servo programmer (a COM port) on one loop so a serial timeout can
// never freeze the window, and only while the page asks (start and stop). The same shape as src/axon-programmer.cjs: it polls
// the programmer and servo, runs one job at a time, and tells the page what it sees with onState. The port itself is the small
// helper in src/swyft-serial, which is Windows only: Node has no serial port without a native module.
// What the bytes mean, and what a student may change, is src/swyft-servo.cjs.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const S=require('./swyft-servo.cjs');
// The servo is asked for its settings this often while nothing else is going on, which is how a servo plugged in or pulled out
// shows. A read takes about 200 ms of the servo's time.
const POLL_MS=1200,PORTS_MS=1500,RIVALS_MS=1000,MISSES=2,LOG_LINES=60,TRACE_LINES=400,delay=ms=>new Promise(r=>setTimeout(r,ms));
// SWYFT's programmer is a Silicon Labs CP210x. Other USB serial adapters are listed, never opened on their own: sending SWYFT
// frames to an unknown device (an Arduino, say) could do anything.
const SILABS=0x10C4,isProgrammer=p=>p.vid===SILABS;
// Every travel a servo can hold, in degrees: one side value is about 2.6°, so the page's slider steps through these.
const TRAVEL_STEPS=[...new Set(Array.from({length:256},(_,v)=>v).filter(v=>v>=S.degreesToSide(0)&&v<=S.degreesToSide(S.MAX_DEGREES)).map(S.sideToDegrees))];

// ---- the helper. One request a line, one answer a line, in order.
class SerialHelper{
  constructor(file=path.join(__dirname,'swyft-serial','SwyftSerial.exe')){this.file=file;this.next=1;this.waiting=new Map();this.child=null;}
  start(){if(this.child)return;const child=spawn(this.file,[],{windowsHide:true,stdio:['pipe','pipe','ignore']});this.child=child;let text='';
    const gone=why=>{if(this.child!==child)return;this.child=null;for(const w of this.waiting.values())w.fail(Error(why));this.waiting.clear();};
    child.on('error',e=>gone(e.code==='ENOENT'?'Torque\'s serial helper is missing.':`Torque's serial helper could not start: ${e.message}`));child.on('exit',()=>gone('Torque\'s serial helper stopped.'));child.stdin.on('error',()=>{});
    child.stdout.on('data',d=>{text+=d.toString('latin1');for(let at;(at=text.indexOf('\n'))>=0;text=text.slice(at+1)){const [id,kind,...rest]=text.slice(0,at).trim().split(' '),w=this.waiting.get(+id);if(!w)continue;this.waiting.delete(+id);const value=rest.join(' ');
      if(kind==='ok')w.done(value);else if(kind==='lost')w.fail(new S.DeviceLost(value));else w.fail(Object.assign(Error(value.replace(/^busy /,'')),value.startsWith('busy ')?{busy:true}:{}));}});}
  ask(...words){this.start();return new Promise((done,fail)=>{const id=this.next++;this.waiting.set(id,{done,fail});try{this.child.stdin.write(`${id} ${words.join(' ')}\n`);}catch(e){this.waiting.delete(id);fail(e);}});}
  stop(){const child=this.child;this.child=null;for(const w of this.waiting.values())w.fail(Error('Torque\'s serial helper stopped.'));this.waiting.clear();try{child?.stdin.end();}catch{}if(child)setTimeout(()=>{try{child.kill();}catch{}},1500).unref();}
}
// The transport the service uses: the helper, or a simulated programmer in tests.
function serialTransport(helper=new SerialHelper()){
  return {
    supported:process.platform==='win32',
    ports:async()=>JSON.parse(await helper.ask('ports')||'[]'),
    rivals:async()=>JSON.parse(await helper.ask('rivals')||'[]'),
    closeRivals:()=>helper.ask('close-rivals'),
    open:async info=>{await helper.ask('open',info.port,S.BAUD);return {
      write:async bytes=>{await helper.ask('write',Buffer.from(bytes).toString('hex'));},
      read:async timeoutMs=>{const r=await helper.ask('read',Math.max(1,Math.round(timeoutMs)));return r?Buffer.from(r,'hex'):null;},
      flush:()=>helper.ask('flush'),close:()=>helper.ask('close').catch(()=>{})};},
    stop:()=>helper.stop()};
}

const blank=()=>({ready:false,port:null,name:null,vid:null,pid:null,serial:null,others:[],rivals:[],held:false,silent:false,error:null});
class SwyftService{
  constructor({transport=serialTransport(),logFile=null,onState=()=>{},pollMs=POLL_MS}={}){
    Object.assign(this,{transport,logFile,onState,pollMs});this.running=null;this.stopping=false;this.jobs=[];this.link=null;this.prog=null;this.log=[];this.traceLines=[];this.resetView();
  }
  resetView(){this.programmer=blank();this.servo={present:false,settings:null,raw:null,readAt:0};this.busy=null;this.misses=0;this.silent=0;}
  say(text,tone='info'){if(this.log.at(-1)?.text===text)return;this.log.push({text,tone,at:Date.now()});if(this.log.length>LOG_LINES)this.log.shift();this.trace(`[${tone}] ${text}`);this.publish();}
  trace(line){const text=`${new Date().toISOString().slice(11,23)} ${line}`;this.traceLines.push(text);if(this.traceLines.length>TRACE_LINES)this.traceLines.shift();if(this.logFile){try{fs.appendFileSync(this.logFile,text+'\n');}catch{}}}
  // What the page draws: the settings as the servo reports them, and everything the page needs to describe them.
  state(){
    const s=this.servo.settings;
    return {supported:this.transport.supported!==false,running:!!this.running,programmer:this.programmer,
      servo:{present:this.servo.present,settings:s,raw:this.servo.raw,readAt:this.servo.readAt,continuous:s?S.isContinuous(s):false,degrees:s?S.travelDegrees(s):null},
      fields:S.FIELDS,switches:S.SWITCHES,basics:S.BASICS,defaults:{...S.DEFAULTS,degrees:S.travelDegrees(S.DEFAULTS),continuous:false},models:S.MODELS,travelSteps:TRAVEL_STEPS,
      busy:this.busy,log:this.log};
  }
  publish(){try{this.onState(this.state());}catch{}}
  start(){if(this.transport.supported===false)return this.state();if(this.running){this.stopping=false;return this.state();}this.stopping=false;this.rivalsAt=0;this.portsAt=0;this.resetView();
    if(this.logFile){try{if(fs.statSync(this.logFile).size>2e6)fs.truncateSync(this.logFile,0);}catch{}}this.trace(`SWYFT programmer started, ${new Date().toString()}`);
    this.running=this.loop().finally(()=>{this.running=null;if(!this.stopping)this.start();else this.publish();});return this.state();}
  async stop(){this.stopping=true;const ended=this.running;if(ended)await ended;}
  async dispose(){await this.stop();if(!this.running)this.transport.stop?.();}
  quit(){this.stopping=true;this.transport.stop?.();}
  async loop(){
    while(!this.stopping||(this.jobs.length&&this.prog)){
      try{await this.step();}
      catch(e){
        if(e instanceof S.DeviceLost||!this.prog){const had=!!this.prog,port=this.programmer.port;await this.drop();if(had)this.say(`The SWYFT programmer on ${port} disconnected.`,'warn');
          const waiting=this.jobs.splice(0);this.resetView();for(const job of waiting)job.fail(e);
          if(!(e instanceof S.DeviceLost))this.programmer={...blank(),error:e.message};this.publish();await delay(500);}
        else{this.say(`Internal error: ${e.message}`,'bad');await delay(500);}
      }
    }
    await this.drop();for(const job of this.jobs.splice(0))job.fail(Error('The SWYFT programmer page closed.'));
  }
  async drop(){this.prog=null;const link=this.link;this.link=null;if(link)await link.close?.();}
  async step(){
    // SWYFT's own app holds the port while it is open, and two apps on one port corrupt each other's traffic.
    if(this.transport.rivals&&Date.now()-this.rivalsAt>=RIVALS_MS){this.rivalsAt=Date.now();this.rivalsNow=await this.transport.rivals();}
    const rivals=this.rivalsNow||[];
    if(rivals.length&&!this.jobs.length&&!this.busy&&!this.stopping){if(this.link){await this.drop();this.say('SWYFT\'s own programmer app opened, so Torque let go of the programmer.','warn');}this.resetView();this.programmer={...blank(),rivals};this.publish();await delay(400);return;}
    if(!this.prog){await this.connect();if(!this.prog){await delay(700);return;}}
    // A programmer pulled out shows as its port going away: checked between polls, since a read of a missing port can hang a moment.
    if(!this.jobs.length&&Date.now()-this.portsAt>=PORTS_MS){this.portsAt=Date.now();const now=await this.transport.ports();if(!now.some(p=>p.port===this.programmer.port))throw new S.DeviceLost('Its port went away.');
      const others=now.filter(p=>p.port!==this.programmer.port).map(view);if(JSON.stringify(others)!==JSON.stringify(this.programmer.others)){this.programmer={...this.programmer,others};this.publish();}}
    const job=this.jobs.shift();
    if(job){try{job.done(await job.run(this.prog));}catch(e){job.fail(e);if(e instanceof S.DeviceLost)throw e;}this.lastPoll=Date.now();return;}
    if(Date.now()-(this.lastPoll||0)>=this.pollMs){this.lastPoll=Date.now();await this.poll();}else await delay(30);
  }
  async connect(){
    const ports=await this.transport.ports(),mine=ports.filter(isProgrammer).sort((a,b)=>portNumber(a)-portNumber(b)),others=ports.filter(p=>!isProgrammer(p)).map(view);
    if(!mine.length){const was=this.programmer;this.resetView();this.programmer={...blank(),others};if(JSON.stringify(was)!==JSON.stringify(this.programmer))this.publish();return;}
    const info=mine[0];let link;
    try{link=await this.transport.open(info);}
    catch(e){this.resetView();this.programmer={...blank(),...view(info),others,held:!!e.busy,error:e.busy?null:e.message};if(!this.saidHeld&&e.busy)this.say(`${info.port} is open in another program, so Torque cannot use the programmer until it closes.`,'warn');this.saidHeld=!!e.busy;this.publish();return;}
    this.saidHeld=false;this.link=link;this.prog=new S.Programmer(link,{trace:line=>this.trace(line)});this.misses=0;this.silent=0;this.lastPoll=0;this.portsAt=Date.now();
    this.programmer={...blank(),ready:true,...view(info),others};
    this.say(`Programmer connected on ${info.port}${mine.length>1?` (${mine.length} plugged in; Torque uses the first)`:''}.`,'good');
  }
  // Reads the servo. A servo that stops answering is shown as gone after MISSES reads in a row, so one bad read does not blink it.
  async poll(){
    const r=await this.prog.read();
    if(r.ok){this.silent=0;this.programmer.silent=false;this.misses=0;const was=this.servo;this.take(r);
      if(!was.present){this.trace(`servo: ${S.describe(r.settings)}`);this.say('SWYFT servo found and read.','good');}
      else if(!S.sameSettings(was.settings,r.settings))this.say('The servo\'s settings changed outside Torque. Showing what it holds now.','warn');
      this.publish();return;}
    if(!r.echo){if(++this.silent>=MISSES&&!this.programmer.silent){this.programmer={...this.programmer,silent:true};this.say('The programmer is not echoing what Torque sends. Unplug it and plug it back in.','bad');}}
    else{this.silent=0;if(this.programmer.silent){this.programmer={...this.programmer,silent:false};}}
    if(this.servo.present&&++this.misses>=MISSES){this.servo={present:false,settings:null,raw:null,readAt:0};this.say('Servo removed.','warn');}
    this.publish();
  }
  take(r){this.servo={present:true,settings:r.settings,raw:r.raw,readAt:Date.now()};}

  // ---- jobs, one at a time on the loop
  job(kind,text,run){
    if(!this.running)throw Error('Open the SWYFT programmer first.');if(this.busy)throw Error('The programmer is busy with something else.');
    return new Promise((done,fail)=>{this.busy={kind,text};this.publish();
      const finish=fn=>value=>{this.busy=null;this.publish();fn(value);};this.jobs.push({run,done:finish(done),fail:finish(fail)});});
  }
  read(){return this.job('read','Reading the servo...',async p=>{
    const r=await p.read();if(!r.ok){this.say(r.echo?'The servo did not answer. Check it is plugged in the right way round: its gray wire to the programmer\'s white wire.':'The programmer did not answer. Unplug it and plug it back in.','bad');return {ok:false};}
    const was=this.servo.present;this.take(r);this.misses=0;this.trace(`servo: ${S.describe(r.settings)}`);this.say(was?'Read the servo again.':'SWYFT servo found and read.','good');return {ok:true,settings:r.settings};});}
  // Read, change, write, read back. Only keys the student changed differ from what the servo held a moment before, and the
  // answer says what the servo holds now.
  write(changes){return this.job('write','Writing to the servo...',async p=>{
    let wanted;try{wanted=checkChanges(changes);}catch(e){return {ok:false,message:`${e.message} Nothing was written.`};}
    const fresh=await p.read();if(!fresh.ok)return {ok:false,message:'Could not read the servo first, so nothing was written. Check it is plugged in.'};this.take(fresh);
    const basis=fresh.settings,next=target(basis,wanted),bad=S.problems(next);if(bad.length)return {ok:false,message:`${bad.join(' ')} Nothing was written.`};
    if(S.sameSettings(basis,next)){this.publish();return {ok:true,message:'The servo already has these settings.',confirmed:[]};}
    this.trace(`write ${S.describe(next)}`);const sent=await p.write(next);
    if(!sent.ok)return {ok:false,message:sent.echo?'The servo did not acknowledge the new settings. Read it to see what it holds.':'The programmer did not answer, so the write may not have reached the servo. Read it to see what it holds.'};
    await delay(100);const back=await p.read();if(!back.ok)return {ok:false,message:'The servo acknowledged the write, but could not be read back to confirm it.'};this.take(back);
    const holds=back.settings,confirmed=Object.keys(next).filter(k=>k!=='left'&&k!=='right'&&next[k]!==basis[k]).map(key=>({key,asked:next[key],was:basis[key],now:holds[key],took:holds[key]===next[key]}));
    if(next.left!==basis.left||next.right!==basis.right)confirmed.unshift({key:'travel',asked:travelText(next),was:travelText(basis),now:travelText(holds),took:holds.left===next.left&&holds.right===next.right});
    const missed=confirmed.filter(c=>!c.took);this.trace(`servo: ${S.describe(holds)}`);this.say(missed.length?`The servo did not keep ${missed.length} of ${confirmed.length} changes.`:`${confirmed.length} ${confirmed.length===1?'change':'changes'} written and confirmed.`,missed.length?'bad':'good');
    return missed.length?{ok:false,message:`The servo did not keep ${missed.map(c=>c.key).join(', ')}.`,confirmed}:{ok:true,message:'Written, read back and confirmed.',confirmed};});}
  closeRivals(){this.rivalsAt=0;return this.transport.closeRivals?.();}
}
const view=p=>({port:p.port,name:p.name||null,vid:p.vid,pid:p.pid,serial:p.serial||null});
const portNumber=p=>Number(String(p.port).replace(/\D/g,''))||0;
// Travel as SWYFT's app shows it: a total in degrees split evenly, or continuous rotation.
const travelText=s=>S.isContinuous(s)?'Continuous rotation':`${S.travelDegrees(s)}°`;
// What the servo should hold: what it holds now with the changes on top. The page sends travel as degrees and continuous (one
// total, as SWYFT's app does), never as the servo's two side values: those are worked out here, with SWYFT's own formula.
function target(basis,wanted){
  const {degrees,continuous,...plain}=wanted,next={...basis,...plain};if(degrees===undefined&&continuous===undefined)return next;
  const cr=continuous??S.isContinuous(basis),deg=degrees??(S.isContinuous(basis)?270:S.travelDegrees(basis));
  return S.withTravel(next,{continuous:cr,degrees:deg});
}
// Only settings the servo has, of the right kind. Numbers are checked against their limits once merged with what the servo holds.
const PSEUDO={degrees:0,continuous:false};
function checkChanges(changes){
  if(!changes||typeof changes!=='object')throw Error('No changes were given.');const out={};
  for(const [key,value] of Object.entries(changes)){
    if(key==='left'||key==='right'||!(key in S.DEFAULTS||key in PSEUDO))throw Error(`Torque does not know the setting "${key}".`);
    if(key==='degrees'&&Number.isInteger(value)&&(value<0||value>S.MAX_DEGREES))throw Error(`Travel must be 0–${S.MAX_DEGREES}°.`);
    const flag=typeof({...S.DEFAULTS,...PSEUDO})[key]==='boolean';
    if(flag?typeof value!=='boolean':!Number.isInteger(value))throw Error(`${key} has the wrong kind of value.`);out[key]=value;
  }
  if(!Object.keys(out).length)throw Error('No changes were given.');return out;
}
// Tests replace the transport through here.
const overrides={};
module.exports={SwyftService,SerialHelper,serialTransport,checkChanges,target,overrides,POLL_MS};
