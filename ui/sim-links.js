'use strict';
// Calibrate → Electronics. Step 4 after Setup, Configure and Debug, and it needs nothing from Simulate: it ties each thing
// that turns to the sensors it moves, on the real robot. Laid out like Simulate's robot: the chassis and every device in
// the robot's configuration as tiles on the left, the picked one on the right, and under them a board that joins each
// motor or servo to what it moves, as lines a student taps to draw.
//  - The chassis comes first: its drivetrain (the same setting as Simulate's) and which motor, steering servo and steering
//    encoder is each wheel. Its links are planned from that: a drive motor counts on its own encoder port (unless
//    Configure says its encoder cable is out), a steering servo moves its steering encoder.
//  - Each motor or servo is moved in a burst at its own speed, direction and length (a continuous servo gets a short
//    wake-up pulse first; a positional servo is enabled first), while every encoder, digital, analog and I2C reading is
//    watched. A motor's own encoder counting is checked off by itself; anything else that followed is linked with a tap.
//  - A sensor nothing turns, a game piece may: the student puts one in by hand while Torque watches.
//  - What Debug's checks found moving together can be taken in.
// This only chains a cause to an electrical component. Grouping them into mechanisms is Mechanisms' (physical calibration).
// Links are kept with the setup in project.calibration.links:
//   {id, causes:[{name, kind:'motor'|'crservo'|'servo'|'piece', dir:1|-1}], effect:{key, dir:1|-1|0}, planned?, result?}
//   planned: drawn on the board or from the chassis, not yet seen: any change in its sensor passes it, and sets which way.
// result: {state:'pass'|'backwards'|'none'|'moved'|'other', text, at, others?}
// project.calibration.electronics: {zeroedAt, none:[moved, and moved no sensor], spins:[motors with no encoder seen to turn],
//   skipped:[devices the student chose not to check], moved:{name:{ok, at, rows:[{label, unit, before, after, moved}], status?}}
//   (an IMU, Pinpoint or OTOS moved by hand: what each reading was before and after),
//   settings:{name:{dir, speed, secs} or {from, to, secs}}, chassis:{slots:{key:{motor, servo, encoder}}}}.
(function(root){
  // ---- devices ----
  // What each kind of sensor reads (Torque Debug's value keys) and the words for each way it can go.
  const UPDOWN=['counts up','counts down'],MORELESS=['reads more','reads less'],TURN=['turns left (heading goes up)','turns right (heading goes down)'];
  const I2C={imu:[['yaw','heading',TURN,1.5]],pinpoint:[['ex','X pod',UPDOWN,5],['ey','Y pod',UPDOWN,5],['h','heading',TURN,1.5]],
    otos:[['x','X',MORELESS,.2],['y','Y',MORELESS,.2],['h','heading',TURN,1.5]],color:[['a','brightness',MORELESS,8],['d','distance',MORELESS,1]],distance:[['d','distance',MORELESS,1]],
    octoquad:Array.from({length:8},(_,i)=>[`e${i}`,`encoder ${i}`,UPDOWN,5])};
  const ACT=new Set(['motor','crservo','servo']),PIECE='game piece';
  // readout: DeckHubSetup.readout of the active configuration ([{name, kind}]); manifest: what Torque Debug reported
  // ({motors, servos, crservos, digital, touch, analog:[{n}], i2c:[{n,k}]}). Either may be missing.
  function devices(readout,manifest){
    const seen=new Map(),add=(name,kind)=>{if(typeof name==='string'&&name&&kind&&!seen.has(name))seen.set(name,kind);};
    const m=manifest||{};
    for(const n of m.motors||[])add(n,'motor');for(const n of m.crservos||[])add(n,'crservo');for(const n of m.servos||[])add(n,'servo');
    for(const n of m.touch||[])add(n,'touch');for(const n of m.digital||[])add(n,'digital');for(const a of m.analog||[])add(a?.n,'analog');for(const d of m.i2c||[])add(d?.n,d?.k);
    for(const d of readout||[])add(d?.name,d?.kind==='touch'?'touch':d?.kind);
    const actuators=[],sensors=[];
    for(const [name,kind] of seen){
      if(ACT.has(kind))actuators.push({name,kind});
      if(kind==='motor')sensors.push({key:`m:${name}:pos`,name,label:`${name} · encoder`,kind,words:UPDOWN,min:5});
      else if(kind==='analog')sensors.push({key:`a:${name}`,name,label:`${name} · analog`,kind,words:MORELESS,min:.05});
      else if(kind==='digital')sensors.push({key:`d:${name}`,name,label:`${name} · digital`,kind,words:['goes HIGH','goes LOW'],min:.5});
      // Torque Debug reads a pressed touch sensor as LOW.
      else if(kind==='touch')sensors.push({key:`d:${name}`,name,label:`${name} · touch`,kind,words:['is released','is pressed'],min:.5});
      else for(const [k,what,words,min] of I2C[kind]||[])sensors.push({key:`i:${name}:${k}`,name,label:`${name} · ${what}`,kind,words,min,angle:k==='yaw'||k==='h'});}
    return {actuators,sensors};}
  const wordsOf=(s,dir)=>dir===0?'stays the same':s?.words?.[dir>0?0:1]||(dir>0?'goes up':'goes down');
  const dirWords=(kind,dir)=>kind==='piece'?'goes in':kind==='servo'?(dir>0?'moves positive (toward 1)':'moves negative (toward 0)'):(dir>0?'turns positive':'turns negative');
  const causeWords=c=>dirWords(c.kind,c.dir);
  const causeName=c=>c.kind==='piece'?'a game piece':c.name;
  function sentence(link,devs){const s=devs.sensors.find(x=>x.key===link.effect?.key);const who=(link.causes||[]).map(c=>link.planned&&c.kind!=='piece'?c.name+' moves':`${causeName(c)} ${causeWords(c)}`);
    return `If ${who.length?who.join(' and '):'nothing'}, then ${s?s.label:link.effect?.key||'nothing'} ${link.planned?'changes':wordsOf(s,link.effect?.dir)}.`;}
  let seq=0;const newId=()=>`l${Date.now().toString(36)}${(seq++).toString(36)}`;
  // What the configuration says about a reading moved by a cause: a motor's encoder is on its own port, so a motor
  // counting on its own encoder matches it ('own'), and counting on another motor's means a swapped cable ('other').
  // Nothing in a configuration says what an analog, digital or I2C sensor is on (null).
  function configured(cause,key){const m=/^m:(.+):pos$/.exec(key||'');if(!m||cause?.kind!=='motor')return null;return m[1]===cause.name?'own':'other';}
  // A link names devices by name: one the robot no longer has is marked, never dropped (a cable out is not a link gone).
  const missing=(link,devs)=>[...(link.causes||[]).filter(c=>c.kind!=='piece'&&!devs.actuators.some(a=>a.name===c.name)).map(c=>c.name),...(devs.sensors.some(s=>s.key===link.effect?.key)?[]:[link.effect?.key])].filter(Boolean);
  // ---- what changed ----
  const wrap=d=>((d+180)%360+360)%360-180;
  // How far a reading went from where it rested (before) to the furthest it got (during), or 0 inside its noise, or null unread.
  function change(s,before,during){const pre=before.map(v=>v[s.key]).filter(Number.isFinite),post=during.map(v=>v[s.key]).filter(Number.isFinite);if(!pre.length||!post.length)return null;
    const base=pre.reduce((a,b)=>a+b,0)/pre.length,d=x=>s.angle?wrap(x-base):x-base,noise=Math.max(0,...pre.map(x=>Math.abs(d(x))));
    const peak=post.reduce((a,x)=>Math.abs(d(x))>Math.abs(a)?d(x):a,0);return Math.abs(peak)>Math.max(s.min,noise*3)?peak:0;}
  // Every reading that followed a move: [{key, label, delta, dir}].
  const changes=(devs,before,during)=>devs.sensors.map(s=>({key:s.key,label:s.label,delta:change(s,before,during)})).filter(x=>x.delta).map(x=>({...x,dir:Math.sign(x.delta)}));
  // Judging a link's check: pass, backwards, none (nothing answered), other (another reading answered and this one did not),
  // moved (it should have stayed the same). A planned link passes on any change: the check says which way.
  function judge(link,devs,before,during){
    const target=devs.sensors.find(s=>s.key===link.effect?.key);if(!target)return {state:'none',delta:null,others:[],unread:true};
    const delta=change(target,before,during),self=new Set((link.causes||[]).map(c=>`m:${c.name}:pos`));
    const others=changes(devs,before,during).filter(x=>x.key!==target.key&&!self.has(x.key));
    if(delta===null)return {state:'none',delta:null,others,unread:true};
    if(link.planned)return delta?{state:'pass',delta,dir:Math.sign(delta),others}:{state:others.length?'other':'none',delta,others};
    const want=link.effect.dir;
    if(want===0)return {state:delta?'moved':'pass',delta,others};
    if(!delta)return {state:others.length?'other':'none',delta,others};
    return {state:Math.sign(delta)===want?'pass':'backwards',delta,others};}
  const fix2=v=>Math.abs(v)>=10?Math.round(v):(+v).toFixed(2);
  function resultText(r,link,devs){const s=devs.sensors.find(x=>x.key===link.effect?.key),name=s?.label||link.effect?.key,also=r.others?.length?` Also moved: ${r.others.map(o=>o.label).join(', ')}.`:'',piece=link.causes?.some(c=>c.kind==='piece');
    if(r.unread)return `Torque Debug has no reading for ${name}: is it in the active configuration, and plugged in?`;
    if(r.state==='pass')return link.effect.dir===0&&!link.planned?`It stayed the same, as the link says.${also}`:`It ${wordsOf(s,r.dir||link.effect.dir)} (${fix2(r.delta)}).${also}`;
    if(r.state==='moved')return `It changed by ${fix2(r.delta)}, but the link says it stays the same.${also}`;
    if(r.state==='backwards')return `It ${wordsOf(s,-link.effect.dir)} (${fix2(r.delta)}): the opposite of the link. If the link is right, the motor or the sensor is reversed: reverse it in the robot's code (setDirection), or swap the motor's power wires. If the robot is right, press Match the robot.${also}`;
    if(r.state==='other')return `${name} did not change, but ${r.others.map(o=>o.label).join(' and ')} did: its cable may be in the other's port. Check the ports in Configure.`;
    if(piece)return `${name} did not change while Torque watched. Put the game piece right where the sensor should see it, and check its cable.`;
    return `Nothing changed. Did the ${link.causes.length>1?'motors and servos':link.causes[0]?.kind==='servo'?'servo':'motor'} move? Try more speed or a longer burst. If it moved, check ${name}'s cable.`;}
  // ---- moved by hand ----
  // An IMU, a goBILDA Pinpoint or an OTOS has nothing on the robot that turns it by itself, so the student moves it: picks
  // the robot up and turns or tilts it (an IMU), rolls each odometry pod or pushes the robot (a Pinpoint). Torque reads it
  // at rest, watches, and says what each reading was before and after. need: 'any' reading moving passes, or these keys all must.
  // Each reading: [key, label, unit, least change that counts, an angle (wraps at 180°)].
  const BY_HAND={imu:{need:'any',list:[['yaw','Heading (yaw)','°',1.5,1],['pitch','Pitch','°',1.5,1],['roll','Roll','°',1.5,1]]},
    pinpoint:{need:['ex','ey'],list:[['ex','X pod','counts',5],['ey','Y pod','counts',5],['x','X','mm',2],['y','Y','mm',2],['h','Heading','°',1.5,1]]},
    otos:{need:'any',list:[['x','X','in',.2],['y','Y','in',.2],['h','Heading','°',1.5,1]]}};
  const byHand=kind=>Object.hasOwn(BY_HAND,kind);
  // What moving it did, from readings at rest (before) and while it was moved (during): {rows:[{k, key, label, unit, before,
  // after, peak, moved} or {..., unread}], ok, missing:[labels of needed readings that did not change], unread: none read at all}.
  function handCheck(kind,name,before,during){const spec=BY_HAND[kind];if(!spec)return null;
    const rows=spec.list.map(([k,label,unit,min,angle])=>{const key=`i:${name}:${k}`,pre=before.map(v=>v[key]).filter(Number.isFinite),post=during.map(v=>v[key]).filter(Number.isFinite);
      if(!pre.length&&!post.length)return {k,key,label,unit,unread:true};
      const base=pre.length?pre.reduce((a,b)=>a+b,0)/pre.length:post[0],d=x=>angle?wrap(x-base):x-base,noise=Math.max(0,...pre.map(x=>Math.abs(d(x)))),peak=post.reduce((a,x)=>Math.abs(d(x))>Math.abs(a)?d(x):a,0);
      return {k,key,label,unit,before:base,after:post.length?post[post.length-1]:base,peak,moved:Math.abs(peak)>Math.max(min,noise*3)};});
    const read=rows.filter(r=>!r.unread),needed=spec.need==='any'?null:rows.filter(r=>spec.need.includes(r.k));
    return {rows,ok:needed?needed.every(r=>r.moved):read.some(r=>r.moved),missing:needed?needed.filter(r=>!r.moved).map(r=>r.label):[],unread:!read.length};}
  // A Pinpoint's own status (getDeviceStatus), in words, when it says something is wrong.
  const PINPOINT_STATUS={NOT_READY:'It is still starting up.',CALIBRATING:'It is calibrating its IMU: keep the robot still for a moment.',FAULT_NO_PODS_DETECTED:'It sees no odometry pods: plug them into its X and Y ports.',FAULT_X_POD_NOT_DETECTED:'It sees no X pod: plug the forward pod into its X port.',FAULT_Y_POD_NOT_DETECTED:'It sees no Y pod: plug the strafe pod into its Y port.',FAULT_IMU_RUNAWAY:'Its IMU is drifting: power it off and on with the robot still.',FAULT_BAD_READ:'The Control Hub got a bad reading from it: check its I2C cable.'};
  const statusWords=s=>PINPOINT_STATUS[String(s||'').toUpperCase()]||'';
  // ---- the chassis ----
  // Each wheel (or swerve module) of a drivetrain, as Simulate keys it (DeckHardware.DRIVE_SLOTS): its drive motor's key,
  // the key of its steering (a swerve module), what it is called, and the words of its key a configuration name may use.
  const HW=()=>globalThis.DeckHardware||(typeof require==='function'?require('./sim-hardware.js'):null);
  const keyWords=k=>k.replace(/B$/,'').replace(/([A-Z])/g,' $1').toLowerCase().split(' ').filter(Boolean);
  function slotsOf(type){const list=HW()?.DRIVE_SLOTS?.[type]||HW()?.DRIVE_SLOTS?.mecanum||[],out=[];
    for(const [key,label] of list){if(/^steer/.test(key)){const last=out[out.length-1];if(last)last.steerKey=key;continue;}
      out.push({key,label:String(label).replace(/ drive motor$/,'').replace(/,? motor (\d)$/,' $1'),words:keyWords(key)});}
    return out.map(x=>({...x,steer:!!x.steerKey}));}
  // The words of a configuration name: "frontLeftDrive" and "front_left_drive" both give front, left, drive; "rear" reads "back".
  const ABBR={fl:['front','left'],fr:['front','right'],bl:['back','left'],br:['back','right'],lf:['front','left'],rf:['front','right'],lb:['back','left'],rb:['back','right']};
  const wordsIn=name=>String(name).replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_\-.]+/g,' ').toLowerCase().split(/\s+/).filter(Boolean).flatMap(w=>ABBR[w]||[w==='rear'?'back':w]);
  // How well a name fits a wheel: how many of the wheel's words it has, less what it has of another side (0: not this wheel).
  const OPP={left:'right',right:'left',front:'back',back:'front'};
  const fit=(name,slot)=>{const w=wordsIn(name),hits=slot.words.filter(x=>w.includes(x)).length,clash=slot.words.some(x=>OPP[x]&&w.includes(OPP[x])&&!slot.words.includes(OPP[x]));return hits&&!clash?hits:0;};
  // Which device is each wheel, from the configuration's names: a drive motor, and for swerve its steering servo and the
  // analog encoder on it. The best fits are taken first, so "leftFront" goes to Front left, not Back left.
  function guessChassis(type,devs){const slots=slotsOf(type),out=Object.fromEntries(slots.map(x=>[x.key,{motor:''}]));
    const assign=(field,list,prefer=()=>0)=>{const pairs=[];for(const sl of slots){if(field!=='motor'&&!sl.steer)continue;for(const d of list){const f=fit(d.name,sl);if(f)pairs.push([f+prefer(d)*.5,sl,d]);}}
      pairs.sort((x,y)=>y[0]-x[0]);const used=new Set(),done=new Set();for(const [,sl,d] of pairs){if(used.has(d.name)||done.has(sl.key))continue;used.add(d.name);done.add(sl.key);out[sl.key][field]=d.name;}
      if(field!=='motor')for(const sl of slots)if(sl.steer&&!out[sl.key][field])out[sl.key][field]='';};
    assign('motor',devs.actuators.filter(a=>a.kind==='motor'));
    // No name says which wheel it is (motors called 1, 2, 3, 4): a guess all the same, in their numbers' order or else the configuration's, for the check at the end to prove or correct.
    if(!slots.some(sl=>out[sl.key].motor)){const ms=devs.actuators.filter(a=>a.kind==='motor'),num=a=>/^\D*(\d+)\D*$/.exec(a.name)?.[1],order=ms.length&&ms.every(num)?[...ms].sort((a,b)=>num(a)-num(b)):ms;slots.forEach((sl,i)=>{if(order[i])out[sl.key].motor=order[i].name;});}
    assign('servo',devs.actuators.filter(a=>a.kind!=='motor'),d=>/s(ervo)?$|steer|turn/i.test(d.name)?1:0);
    assign('encoder',devs.sensors.filter(x=>x.kind==='analog'),d=>/e(nc(oder)?)?$|abs|pos/i.test(d.name)?1:0);
    return {type,slots:out};}
  // The chassis as Simulate's devices: {key: configuration name}, drive motors and steering.
  function simDevices(chassis){const out={},slots=slotsOf(chassis?.type);for(const sl of slots){const s=chassis.slots?.[sl.key]||{};if(s.motor)out[sl.key]=s.motor;if(sl.steerKey&&s.servo)out[sl.steerKey]=s.servo;}return out;}
  // What a chassis plans: each drive motor counting on its own encoder (unless Configure says its encoder cable is out),
  // and each steering servo moving its steering encoder. encoderOf(name): false when Configure says there is none.
  function chassisLinks(chassis,devs,encoderOf=()=>undefined){const out=[];
    for(const [,s] of Object.entries(chassis?.slots||{})){const m=devs.actuators.find(a=>a.name===s.motor&&a.kind==='motor');if(m&&encoderOf(m.name)!==false)out.push({causes:[{name:m.name,kind:'motor',dir:1}],effect:{key:`m:${m.name}:pos`,dir:1},planned:true});
      const sv=devs.actuators.find(a=>a.name===s.servo&&a.kind!=='motor'),en=devs.sensors.find(x=>x.key===`a:${s.encoder}`);if(sv&&en)out.push({causes:[{name:sv.name,kind:sv.kind,dir:1}],effect:{key:en.key,dir:1},planned:true});}
    return out;}
  // A link between this cause and this sensor already, whichever way.
  const joined=(links,name,key)=>links.find(l=>l.effect?.key===key&&l.causes?.length===1&&l.causes[0].name===name);
  // Planned links added for what has none yet; returns the new list.
  function plan(links,wanted){const out=[...links];for(const w of wanted)if(!joined(out,w.causes[0].name,w.effect.key))out.push({id:newId(),...w});return out;}
  // What Debug's checks found ([{name, kind, key, dir}]) as links: one seen counting a way passes, one whose way is not known is planned.
  function fromDebug(links,found,devs){const out=[...links];let added=0;
    for(const f of found||[]){const a=devs.actuators.find(x=>x.name===f.name),s=devs.sensors.find(x=>x.key===f.key);if(!a||!s||joined(out,a.name,s.key))continue;added++;
      out.push(f.dir?{id:newId(),causes:[{name:a.name,kind:a.kind,dir:1}],effect:{key:s.key,dir:f.dir},result:{state:'pass',text:`Debug’s check saw it ${wordsOf(s,f.dir)} when ${a.name} ${dirWords(a.kind,1)}.`,at:new Date().toISOString()}}:{id:newId(),causes:[{name:a.name,kind:a.kind,dir:1}],effect:{key:s.key,dir:1},planned:true});}
    return {links:out,added};}
  // What is checked off: a motor once its encoder counts (or, with no encoder, once seen to turn), anything else once it
  // moves a sensor or is said to move none; a sensor once something moves it.
  function progress(links,devs,e={},encoderOf=()=>undefined){const ok=links.filter(l=>l.result?.state==='pass'&&!l.planned),none=e.none||[],spins=e.spins||[],skipped=new Set(e.skipped||[]),moved=e.moved||{};
    const acts=devs.actuators.map(a=>{const mine=ok.filter(l=>l.causes.some(c=>c.name===a.name&&c.kind!=='piece')),noEnc=a.kind==='motor'&&encoderOf(a.name)===false;
      return {...a,links:mine,none:none.includes(a.name),noEncoder:noEnc,spins:spins.includes(a.name),skipped:skipped.has(a.name),done:mine.length>0||none.includes(a.name)||noEnc&&spins.includes(a.name)||skipped.has(a.name)};});
    // A sensor is done once something moves it, once it was moved by hand (an IMU, Pinpoint or OTOS: all its readings), or skipped.
    const sens=devs.sensors.map(s=>({...s,links:ok.filter(l=>l.effect.key===s.key),hand:byHand(s.kind)&&!!moved[s.name]?.ok,skipped:skipped.has(s.name)})).map(s=>({...s,done:s.links.length>0||s.hand||s.skipped}));
    return {acts,sens,done:acts.filter(a=>a.done).length+sens.filter(s=>s.done).length,total:acts.length+sens.length};}
  const api={devices,sentence,judge,changes,configured,resultText,missing,wordsOf,newId,progress,slotsOf,guessChassis,chassisLinks,plan,fromDebug,wordsIn,simDevices,byHand,handCheck,statusWords,BY_HAND,PIECE};
  if(typeof module==='object'&&module.exports){module.exports=api;return;}

  // ---- the panel ----
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const SPEEDS=[10,20,30,40,50,60,70,80,90,100],BURSTS=[.2,.3,.5,.75,1,1.5,2],POSITIONS=Array.from({length:21},(_,i)=>+(i*.05).toFixed(2));
  const DEFAULTS={motor:{dir:1,speed:50,secs:.5},crservo:{dir:1,speed:50,secs:.5},servo:{from:.2,to:.8,secs:.75}};
  const settingsOf=(kind,raw)=>{const d=DEFAULTS[kind]||{},r=raw&&typeof raw==='object'?raw:{},pick=(v,list,def)=>list.includes(+v)?+v:def;
    return kind==='servo'?{from:pick(r.from,POSITIONS,d.from),to:pick(r.to,POSITIONS,d.to),secs:pick(r.secs,BURSTS,d.secs)}:{dir:r.dir===-1?-1:1,speed:pick(r.speed,SPEEDS,d.speed),secs:pick(r.secs,BURSTS,d.secs)};};
  const KIND_WORD={motor:'Motor',crservo:'Continuous servo',servo:'Servo',analog:'Analog',digital:'Digital',touch:'Touch sensor',imu:'IMU',pinpoint:'Pinpoint',otos:'OTOS',color:'Color sensor',distance:'Distance sensor',octoquad:'OctoQuad'};
  const GROUPS=[['Motors',d=>d.kind==='motor'],['Servos',d=>d.kind==='servo'||d.kind==='crservo'],['Digital',d=>d.kind==='digital'||d.kind==='touch'],['Analog',d=>d.kind==='analog'],['I2C',d=>d.bus!==undefined||['imu','pinpoint','otos','color','distance','octoquad'].includes(d.kind)]];
  const CHASSIS='@setup';
  // opts: box, debug (DeckLiveDebug: running, start, send, listen, latest, found), project(), save(), readout(), config(),
  // encoder(name) (Configure's "Encoder cable plugged in": false when out), drives ({type: name}), setChassis({type, names}), toConfigure()
  function create(opts){
    const {box,debug}=opts,p=()=>opts.project(),cal=()=>p().calibration||(p().calibration={}),el=()=>cal().electronics||(cal().electronics={});
    // zeroed: said this session (it is physical); picked: the tile on the right; seen: what followed its last move;
    // enabled: servos powered now; tapped: the cause picked on the board, waiting for what it moves.
    let zeroed=false,checking=null,busy=null,picked='',seen=null,stopWatch=null,ready=false,tapped='',pressing=false,pending=false;const enabled=new Set();
    const read=()=>opts.readout?.()||[];
    // Only what the configuration has: what Torque Debug found besides is Debug's to show.
    const devs=()=>{const r=read();return devices(r,r.length?null:debug?.latest?.()?.manifest||null);};
    const links=()=>Array.isArray(cal().links)?cal().links:[];
    const encoderOf=name=>opts.encoder?.(name);
    const live=()=>!!debug?.running?.();
    // What Torque Debug is doing while it gets going by itself.
    const debugGoing=()=>{const s=debug?.state?.()||{};return s.installing?'Putting Torque Debug on the robot: the first build takes about a minute…':s.starting?'Starting Torque Debug on the robot…':'';};
    const undo=[],redo=[],snap=()=>JSON.stringify({links:links(),electronics:el()});
    const edit=fn=>{const was=snap();fn();if(snap()!==was){undo.push(was);if(undo.length>100)undo.shift();redo.length=0;}opts.save();paint();};
    const restore=(from,to)=>{if(!from.length)return false;to.push(snap());const v=JSON.parse(from.pop());cal().links=v.links;cal().electronics=v.electronics;seen=null;opts.save();paint();return true;};
    const set=(name,kind)=>settingsOf(kind,el().settings?.[name]);
    const setSet=(name,kind,change)=>{el().settings={...el().settings,[name]:{...set(name,kind),...change}};opts.save();};
    const opt=(v,t,on)=>`<option value="${esc(v)}"${on?' selected':''}>${esc(t)}</option>`;
    const pill=(state,text)=>`<span class="rs-pill ${state==='pass'?'ok':state?'warn':''}">${esc(text)}</span>`;
    const stateWords={pass:'Works',backwards:'Backwards',none:'No answer',other:'Wrong port?',moved:'Changed'};
    const place=d=>{const hub=d.hub==='control'?'Control Hub':d.hub?`Expansion Hub${/\d/.test(d.hub)?' '+d.hub.replace(/\D/g,''):''}`:d.hubName||'Hub';return d.bus!==undefined?`${hub} · I2C ${d.bus}`:Number.isInteger(d.port)?`${hub} · port ${d.port}`:hub;};
    const chassis=()=>{const c=el().chassis,type=p().robot?.drivetrain||'mecanum';return c?.type===type&&c.slots&&Object.values(c.slots).some(x=>x?.motor)?c:guessChassis(type,devs());};
    // By default the chassis is the guess from the names, put on the board as planned links with nothing pressed: once for a configuration and drivetrain, so a link taken
    // off stays off. Nothing is trusted yet: each planned link still has to be moved and seen, which is the check a person does at the end.
    let autoQueued=false;
    function autoChassis(d){const c=chassis(),mark=`${opts.config?.()||''}|${c.type}`;if(autoQueued||el().chassisAuto===mark||!Object.values(c.slots).some(x=>x?.motor))return;const wanted=chassisLinks(c,d,encoderOf);if(!wanted.length)return;
      autoQueued=true;setTimeout(()=>{autoQueued=false;if(el().chassisAuto===mark)return;const now=devs(),use=chassis();opts.setChassis?.({devices:simDevices(use)});edit(()=>{el().chassisAuto=mark;el().chassis=use;cal().links=plan(links(),chassisLinks(use,now,encoderOf));});},0);}
    // The configuration's devices as rows: each actuator, and each sensor with its readings.
    function rows(d,pr){const r=read(),list=r.length?r:[...d.actuators.map(a=>({name:a.name,kind:a.kind})),...[...new Set(d.sensors.filter(s=>s.kind!=='motor').map(s=>s.name))].map(n=>({name:n,kind:d.sensors.find(s=>s.name===n).kind}))];
      return list.filter(x=>ACT.has(x.kind)||d.sensors.some(s=>s.name===x.name)).map(x=>{const act=pr.acts.find(a=>a.name===x.name),sens=pr.sens.filter(s=>s.name===x.name&&!(x.kind==='motor'&&s.key===`m:${x.name}:pos`));
        const skip=(el().skipped||[]).includes(x.name),hand=byHand(x.kind)&&el().moved?.[x.name];
        const done=act?act.done:sens.length>0&&sens.every(s=>s.done),what=skip?'skipped':hand?.ok?'moved by hand':act?(act.links.length?`→ ${act.links.map(l=>d.sensors.find(s=>s.key===l.effect.key)?.label||l.effect.key).join(', ')}`:act.none?'no sensor on it':act.noEncoder?(act.spins?'turns · no encoder':'no encoder'):''):sens.filter(s=>s.done).map(s=>`← ${s.links.map(l=>l.causes.map(causeName).join(' and ')).join(', ')}`).join(' ');
        return {...x,act:!!act,done,what};});}
    const badge=x=>x.bus!==undefined?`I2C ${x.bus}`:Number.isInteger(x.port)?`${{motor:'M',servo:'S',crservo:'S',digital:'D',touch:'D',analog:'A'}[x.kind]||''}${x.port}`:'—';
    const tile=(x,extra='')=>`<button type="button" class="sim-tile cal-elec-tile${x.done?' done':''}" data-elec-pick="${esc(x.name)}" aria-pressed="${x.name===picked}"><span class="cal-elec-badge" aria-hidden="true">${esc(x.badge??badge(x))}</span><span class="sim-tile-text"><b>${x.done?'<i class="cal-elec-tick" aria-label="done">✓</i> ':''}${esc(x.title||x.name)}</b><small>${esc(x.sub??(KIND_WORD[x.kind]||x.kind))}${x.what?` · ${esc(x.what)}`:x.done?'':' · to do'}</small></span>${extra}</button>`;
    function chassisDone(d){const c=chassis(),wanted=chassisLinks(c,d,encoderOf);return Object.values(c.slots).some(s=>s.motor)&&wanted.every(w=>{const l=joined(links(),w.causes[0].name,w.effect.key);return l?.result?.state==='pass'&&!l.planned;})&&wanted.length>0;}
    function listHtml(d,pr){const all=rows(d,pr),drive=opts.drives?.[p().robot?.drivetrain]||p().robot?.drivetrain||'';
      return `<h3>Setup</h3><div class="sim-garage-rail">${tile({name:CHASSIS,title:'Setup',badge:'⛭',sub:drive.split(' · ')[0],done:chassisDone(d),what:''})}</div>`+GROUPS.map(([title,test])=>{const g=all.filter(test);if(!g.length)return '';return `<h3>${title}</h3><div class="sim-garage-rail">${g.map(x=>tile(x)).join('')}</div>`;}).join('');}
    function linkHtml(l,d){const gone=missing(l,d),r=l.result,on=checking===l.id,c=l.causes[0],conf=configured(c,l.effect.key),pieceNow=on&&c?.kind==='piece';
      return `<li class="cal-link" data-link="${esc(l.id)}"><div class="cal-link-head">${on?pill('','Checking…'):l.planned?pill('','Planned'):r?pill(r.state,stateWords[r.state]||r.state):pill('','Not checked')}<span>${esc(sentence(l,d))}</span>${conf==='own'?'<span class="rs-pill ok" title="A motor’s encoder is on its own port in the configuration">Matches Configure</span>':''}</div>
        ${gone.length?`<p class="cal-sense-note bad">Not on the robot now: ${esc(gone.join(', '))}.</p>`:''}${pieceNow?`<p class="hint" role="status" data-elec-ready="${ready?1:0}">${ready?'Put the game piece in now (up to 30 s).':'Hold still: reading it at rest…'}</p>`:''}${r&&!on&&r.state!=='pass'?`<p class="cal-sense-note bad">${esc(r.text)}</p>`:''}
        <div class="button-row"><button type="button" class="secondary" data-link-check${!live()||!zeroed||checking||busy||gone.length?' disabled':''}>${c?.kind==='piece'?'Check with a game piece':l.planned?'Check':'Check again'}</button>${r?.state==='backwards'?'<button type="button" class="secondary" data-link-match>Match the robot</button>':''}<button type="button" class="secondary" data-link-delete>Delete</button></div></li>`;}
    function seenHtml(d){if(!seen)return '';const c=seen.cause,who=causeName(c);
      if(seen.error)return `<p class="cal-sense-note bad">${esc(seen.error)}</p>`;
      const enc=c.kind==='motor'?encoderOf(c.name):undefined;
      if(!seen.changes.length)return `<div class="cal-seen" data-seen><p class="cal-sense-note">${c.kind==='piece'?'Nothing changed while Torque watched for a game piece.':`Nothing changed when ${esc(who)} ${esc(causeWords(c))}.${c.kind==='motor'?(enc===false?' Configure says it has no encoder, so nothing should count: if it turned, it’s good.':' Configure says its encoder cable is plugged in. If the motor turned, is the encoder cable in this motor’s port, and does it have an encoder at all? If it didn’t turn, try more speed or a longer burst.'):' Try more speed or a longer burst. If it moved and still nothing changed, it has no sensor on it.'}`}</p>
        ${c.kind==='piece'?'':c.kind==='motor'&&enc===false?'<div class="button-row"><button type="button" class="primary" data-elec-spins>It turned: done</button></div>':`<div class="button-row"><button type="button" class="secondary" data-seen-none>It has no sensor</button></div>`}</div>`;
      const has=key=>{const l=joined(links(),c.name,key);return l&&!l.planned&&l.result?.state==='pass';};
      return `<div class="cal-seen" data-seen><p class="hint">When ${esc(who)} ${esc(causeWords(c))}, these followed it. Link what is really on it:</p><ul class="cal-seen-list">${seen.changes.map(x=>{const conf=configured(c,x.key),s=d.sensors.find(y=>y.key===x.key);
        return `<li data-seen-key="${esc(x.key)}"><span><b>${esc(x.label)}</b> ${esc(wordsOf(s,x.dir))} (${fix2(x.delta)})</span>${conf==='own'?' <span class="rs-pill ok">Matches Configure: its own port</span>':conf==='other'?` <span class="rs-pill warn">Configure has this encoder on ${esc(x.key.split(':')[1])}’s port</span>`:''}
          ${has(x.key)?'<span class="rs-pill ok">Linked</span>':`<button type="button" class="primary" data-seen-link="${esc(x.key)}">Link it</button>`}</li>`;}).join('')}</ul>
        ${seen.changes.some(x=>configured(c,x.key)==='other')&&!seen.changes.some(x=>configured(c,x.key)==='own')?'<p class="cal-sense-note bad">Its own encoder did not count, another port’s did: the encoder cables may be swapped. Check the ports in Configure.</p>':''}</div>`;}
    const lockText=()=>!live()?'Start live readings first.':!zeroed?'Say everything is at zero first (above).':'';
    // The picked device: its controls, what followed its last move, and its links.
    function deviceHtml(d,pr){const a=d.actuators.find(x=>x.name===picked),sensorsHere=d.sensors.filter(s=>s.name===picked&&!(a?.kind==='motor'&&s.key===`m:${picked}:pos`)),dev=read().find(x=>x.name===picked)||{name:picked,kind:a?.kind||sensorsHere[0]?.kind},act=a&&pr.acts.find(x=>x.name===a.name);
      const lock=!a&&byHand(dev.kind)?(live()?"":"Start live readings first."):lockText(),done=a?act?.done:sensorsHere.length&&sensorsHere.every(s=>pr.sens.find(x=>x.key===s.key)?.done);
      const skipped=(el().skipped||[]).includes(picked);
      const head=`<div class="cal-hub-head"><div><h3>${esc(picked)}</h3><small class="hint">${esc(KIND_WORD[dev.kind]||dev.kind||'')}${dev.port!==undefined||dev.bus!==undefined?` · ${esc(place(dev))}`:''}</small></div><div class="cal-elec-skip">${skipped?'<span class="rs-pill">Skipped</span><button type="button" class="text-button" data-elec-skip="off">Check it after all</button>':`${done?'<span class="rs-pill ok">Done</span>':''}<button type="button" class="secondary" data-elec-skip="on" title="Leave this one unchecked for now and count it as done">Skip this check</button>`}</div></div>`;
      let controls='';
      if(a&&a.kind!=='servo'){const s=set(a.name,a.kind),enc=a.kind==='motor'?encoderOf(a.name):undefined;
        controls=`${a.kind==='motor'?`<p class="cal-elec-enc">Encoder cable: <b>${enc===false?'not plugged in':'plugged in'}</b>, as Configure says. ${enc===false?'It only has to turn: move it, then say it turned.':'Move it: its own encoder should count, and that checks it off.'} <button type="button" class="text-button" data-elec-configure>Change in Configure</button></p>`:''}
          <div class="cal-elec-controls"><label>Direction<select data-elec-set="dir">${opt(1,'Positive',s.dir>0)}${opt(-1,'Negative',s.dir<0)}</select></label><label>Speed<select data-elec-set="speed">${SPEEDS.map(v=>opt(v,`${v}%`,v===s.speed)).join('')}</select></label><label>Burst<select data-elec-set="secs">${BURSTS.map(v=>opt(v,`${v} s`,v===s.secs)).join('')}</select></label>
          <button type="button" class="primary" data-elec-go${lock||busy||checking?' disabled':''}>${busy==='move'?'Moving…':'Move it'}</button>${a.kind==='motor'&&enc===false&&!act?.spins?`<button type="button" class="secondary" data-elec-spins${lock?' disabled':''}>It turns: done</button>`:''}</div>${s.speed>70?'<p class="cal-debug-warn">Over 70%: check nothing can hit a hard stop.</p>':''}${a.kind==='crservo'?'<p class="hint">A short pulse wakes it up first, then the burst.</p>':''}`;}
      else if(a){const s=set(a.name,'servo'),on=enabled.has(a.name);
        controls=`<div class="cal-elec-controls"><label class="check cal-elec-enable"><input type="checkbox" data-elec-enable${lock?' disabled':''}${on?' checked':''}> Enabled</label><label>From<select data-elec-set="from">${POSITIONS.map(v=>opt(v,v.toFixed(2),v===s.from)).join('')}</select></label><label>To<select data-elec-set="to">${POSITIONS.map(v=>opt(v,v.toFixed(2),v===s.to)).join('')}</select></label><label>Hold<select data-elec-set="secs">${BURSTS.map(v=>opt(v,`${v} s`,v===s.secs)).join('')}</select></label>
          <button type="button" class="primary" data-elec-go${lock||!on||busy||checking||s.from===s.to?' disabled':''}>${busy==='move'?'Moving…':'Move it'}</button></div><p class="hint">${on?`Enabled: it holds ${s.from.toFixed(2)}. Move it goes to ${s.to.toFixed(2)} and back.`:'Enable it first: it goes to From and holds there.'}</p>`;}
      else if(byHand(dev.kind))controls=handHtml(dev,lock);
      else controls=`<p class="hint">Nothing on the robot turns this by itself? A game piece may: put one in by hand while Torque watches.</p><div class="cal-elec-controls"><button type="button" class="primary" data-elec-piece${lock||busy||checking?' disabled':''}>Watch for a game piece</button></div>`;
      const watching=busy==='watch'?`<div class="cal-elec-controls"><p class="hint" role="status" data-elec-ready="${ready?1:0}">${ready?'Watching every sensor: put the game piece in now (up to 30 s).':'Hold still: reading every sensor at rest…'}</p><button type="button" class="secondary" data-elec-stop>Stop watching</button></div>`:'';
      const mine=links().filter(l=>l.causes.some(c=>c.name===picked)||sensorsHere.some(s=>s.key===l.effect.key));
      return `<section class="cal-elec-device" data-elec-device="${esc(picked)}">${head}${lock?`<p class="hint">${esc(lock)}</p>`:''}${controls}${watching}${seen&&(seen.cause.name===picked||seen.cause.kind==='piece')?seenHtml(d):''}${mine.length?`<h4 class="cal-group-title">Its links</h4><ol class="cal-link-list">${mine.map(l=>linkHtml(l,d)).join('')}</ol>`:''}
        ${rows(d,pr).some(x=>!x.done)?'<div class="button-row"><button type="button" class="secondary" data-elec-next>Next to do</button></div>':''}</section>`;}
    // An IMU, Pinpoint or OTOS: move it by hand while Torque watches, then every reading before and after.
    const HAND_SAY={imu:'Nothing on the robot turns its IMU, so move it yourself: press Watch, hold still a moment, then pick the robot up and turn it, and tilt it forward and to the side.',
      pinpoint:'Its odometry pods only count when they roll: press Watch, hold still a moment, then roll the X (forward) pod and the Y (strafe) pod by hand, or push the robot forward and then sideways.',
      otos:'It watches the floor: press Watch, hold still a moment, then slide the robot a little forward and sideways over the floor.'};
    const num=(v,u)=>Number.isFinite(v)?`${Math.abs(v)>=100?Math.round(v):(+v).toFixed(1)}${u==='°'?'°':` ${u}`}`:'—';
    function handTable(rows){return `<table class="cal-elec-slots cal-hand-table"><thead><tr><th scope="col">Reading</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Change</th><th scope="col"></th></tr></thead><tbody>${rows.map(r=>r.unread?`<tr><th scope="row">${esc(r.label)}</th><td colspan="4" class="hint">No reading</td></tr>`:`<tr data-hand-row="${esc(r.k||r.label)}"><th scope="row">${esc(r.label)}</th><td>${num(r.before,r.unit)}</td><td>${num(r.after,r.unit)}</td><td>${num(r.after-r.before,r.unit)}</td><td>${r.moved?'<span class="rs-pill ok">Moved</span>':'<span class="rs-pill">Still</span>'}</td></tr>`).join('')}</tbody></table>`;}
    function handHtml(dev,lock){const m=el().moved?.[dev.name],watching=busy==='hand';
      const now=watching?`<div class="cal-elec-controls"><p class="hint" role="status" data-elec-ready="${ready?1:0}">${ready?(dev.kind==='pinpoint'?'Now roll the X pod and the Y pod (up to 30 s).':'Now move it: turn the robot, and tilt it (up to 30 s).'):'Hold still: reading it at rest…'}</p><button type="button" class="secondary" data-elec-stop>Stop watching</button></div>`:'';
      const result=m&&!watching?`<h4 class="cal-group-title">Last time it was moved by hand</h4>${handTable(m.rows||[])}<p class="${m.ok?'hint':'cal-sense-note bad'}">${m.ok?`It answered when moved${m.at?` (${esc(new Date(m.at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))})`:''}.`:esc(m.text||'It did not answer.')}</p>`:'';
      return `<p class="hint">${esc(HAND_SAY[dev.kind])}</p>${watching?'':`<div class="cal-elec-controls"><button type="button" class="primary" data-elec-hand${lock||busy||checking?' disabled':''}>${m?'Watch again':'Watch while I move it'}</button></div>`}${now}${result}`;}
    // Simulate's Encoder tick on a drive motor, against Configure's encoder cable: where they differ, one of them is wrong.
    const simSays=name=>{const s=opts.simEncoder?.(name);if(s===undefined)return '';const c=encoderOf(name)!==false;return s===c?'':` <span class="rs-pill warn" data-elec-sim-encoder="${esc(name)}" title="Simulate → Mechanisms → its wheel says ${s?'it has an encoder':'it has no encoder'}; Configure says ${c?'its encoder cable is plugged in':'it has none'}.">Simulate: ${s?'encoder':'no encoder'}</span>`;};
    // Simulate's mechanisms as planned links (opts.simLinks): only those whose motor or servo and sensor this configuration
    // has, each cause as the configuration has it; the student can still change or delete each one.
    function simWanted(d){return (opts.simLinks?.()||[]).map(w=>{const a=d.actuators.find(x=>x.name===w.causes[0].name);return a&&d.sensors.some(s=>s.key===w.effect.key)?{...w,causes:[{name:a.name,kind:a.kind,dir:1}]}:null;}).filter(Boolean).filter(w=>!joined(links(),w.causes[0].name,w.effect.key));}
    // The chassis: its drivetrain (Simulate's own setting) and which device is each wheel; its links are planned from them.
    function chassisHtml(d){const c=chassis(),type=p().robot?.drivetrain||'mecanum',slots=slotsOf(type),motors=d.actuators.filter(a=>a.kind==='motor'),servos=d.actuators.filter(a=>a.kind!=='motor'),analogs=d.sensors.filter(s=>s.kind==='analog');
      const sel=(slot,field,list,label)=>`<select data-elec-slot="${slot.key}" data-elec-field="${field}" aria-label="${esc(slot.label)}: ${esc(label)}">${opt('','Not on this robot',!c.slots[slot.key]?.[field])}${list.map(x=>opt(x.name,x.name,x.name===c.slots[slot.key]?.[field])).join('')}</select>`;
      const wanted=chassisLinks(c,d,encoderOf),have=wanted.filter(w=>joined(links(),w.causes[0].name,w.effect.key)).length,passed=wanted.filter(w=>{const l=joined(links(),w.causes[0].name,w.effect.key);return l?.result?.state==='pass'&&!l.planned;}).length;
      return `<section class="cal-elec-device" data-elec-device="${CHASSIS}"><div class="cal-hub-head"><div><h3>Setup</h3><small class="hint">Pick your chassis, then join each motor and servo to what it moves. It saves by itself: Ctrl+Z undoes, Ctrl+Shift+Z redoes, Esc lets go.</small></div>${chassisDone(d)?'<span class="rs-pill ok">Chassis done</span>':''}</div>
        <h4 class="cal-group-title">Chassis</h4><p class="hint">The same drivetrain as Simulate: change it here and Simulate follows.</p>
        <div class="cal-elec-controls"><label>Drivetrain<select data-elec-drive>${Object.entries(opts.drives||{}).map(([k,n])=>opt(k,n,k===type)).join('')}</select></label></div>
        <table class="cal-elec-slots"><thead><tr><th scope="col">Wheel</th><th scope="col">Drive motor</th>${slots[0]?.steer?'<th scope="col">Steering servo</th><th scope="col">Steering encoder</th>':''}<th scope="col">Encoder</th></tr></thead><tbody>
        ${slots.map(s=>{const m=c.slots[s.key]?.motor;return `<tr><th scope="row">${esc(s.label)}</th><td>${sel(s,'motor',motors,'drive motor')}</td>${s.steer?`<td>${sel(s,'servo',servos,'steering servo')}</td><td>${sel(s,'encoder',analogs,'steering encoder')}</td>`:''}<td>${m?(encoderOf(m)===false?'<span class="rs-pill warn">No encoder</span>':'<span class="rs-pill ok">Built-in port</span>'):''}${m?simSays(m):''}</td></tr>`;}).join('')}</tbody></table>
        <p class="hint">${wanted.length?`That makes ${wanted.length} link${wanted.length===1?'':'s'}: each drive motor counting on its own encoder port${slots[0]?.steer?', and each steering servo moving its steering encoder':''}. ${have<wanted.length?'Press Use these to put them on the board.':passed<wanted.length?`Torque guessed these from the names and put them on the board. Nothing is trusted until you have seen it move: ${passed} of ${wanted.length} checked, so finish setting up, then move each one to check it.`:`All ${wanted.length} checked.`}`:'No motor’s name says which wheel it is. Pick which motor is each wheel.'}</p>
        <div class="button-row"><button type="button" class="primary" data-elec-chassis-use${wanted.length&&have<wanted.length?'':' disabled'}>Use these</button><button type="button" class="secondary" data-elec-chassis-guess>Guess from the names again</button></div>${(n=>n?`<div class="cal-elec-sim" data-elec-sim-plan><p class="hint">Simulate’s mechanisms say what ${n===1?'one more link is':`${n} more links are`}: a motor’s encoder, or a sensor a mechanism carries.</p><div class="button-row"><button type="button" class="primary" data-elec-sim-use>Use Simulate’s mechanisms (${n})</button></div></div>`:'')(simWanted(d).length)}${boardHtml(d)}</section>`;}
    // The board: every cause on the left, every reading on the right, and a line for each link. Tap a cause, then what it moves.
    function boardHtml(d){const list=links(),found=(debug?.found?.()||[]),fromD=fromDebug(list,found,d).added;
      const causes=[...d.actuators.map(a=>({name:a.name,label:a.name,kind:KIND_WORD[a.kind]})),{name:PIECE,label:'A game piece',kind:'by hand'}];
      const count=key=>list.filter(l=>l.effect.key===key).length,from=name=>list.filter(l=>l.causes.some(c=>c.name===name)).length;
      return `<div class="cal-board-card"><div class="cal-hub-head"><h4 class="cal-group-title">Connect them</h4>${fromD?`<button type="button" class="secondary" data-board-import>Take in what Debug found (${fromD})</button>`:''}</div>
        <p class="hint">${tapped?`Now tap what <b>${esc(tapped===PIECE?'a game piece':tapped)}</b> moves (tap it again to undo), or tap ${esc(tapped===PIECE?'it':tapped)} to put it down.`:'Tap a motor or servo on the left, then each thing it moves on the right. One can move many, and many can move one.'}</p>
        <div class="cal-board" data-board><div class="cal-board-col">${causes.map(c=>`<button type="button" class="cal-board-node cause${tapped===c.name?' on':''}" data-board-cause="${esc(c.name)}" aria-pressed="${tapped===c.name}"><b>${esc(c.label)}</b><small>${esc(c.kind)}${from(c.name)?` · ${from(c.name)}`:''}</small></button>`).join('')}</div><svg class="cal-board-lines" aria-hidden="true"></svg>
          <div class="cal-board-col">${d.sensors.map(s=>`<button type="button" class="cal-board-node effect${tapped?' target':''}${tapped&&joined(list,tapped,s.key)?' joined':''}" data-board-effect="${esc(s.key)}"${tapped?'':' disabled'}><b>${esc(s.label)}</b>${count(s.key)?`<small>${count(s.key)} linked</small>`:''}</button>`).join('')}</div></div>
        <p class="cal-board-key hint"><span class="k planned"></span> planned <span class="k pass"></span> checked <span class="k bad"></span> check failed</p></div>`;}
    // The board's lines, drawn once its nodes are laid out.
    function drawBoard(){const g=box?.querySelector('[data-board]'),svg=g?.querySelector('.cal-board-lines');if(!svg)return;const r=g.getBoundingClientRect();svg.setAttribute('viewBox',`0 0 ${r.width} ${r.height}`);
      const at=(sel,side)=>{const n=g.querySelector(sel);if(!n)return null;const b=n.getBoundingClientRect();return {x:(side?b.left:b.right)-r.left,y:b.top+b.height/2-r.top};};
      svg.innerHTML=links().map(l=>{const b=at(`[data-board-effect="${CSS.escape(l.effect.key)}"]`,1);if(!b)return '';return l.causes.map(c=>{const a=at(`[data-board-cause="${CSS.escape(c.kind==='piece'?PIECE:c.name)}"]`,0);if(!a)return '';const mx=(a.x+b.x)/2,st=l.planned?'planned':l.result?.state==='pass'?'pass':l.result?'bad':'planned';
        return `<path class="cal-board-line ${st}" d="M${a.x} ${a.y} C${mx} ${a.y} ${mx} ${b.y} ${b.x-6} ${b.y}"/><circle class="cal-board-dot ${st}" cx="${b.x-4}" cy="${b.y}" r="4"/>`;}).join('');}).join('');}
    function paint(){if(!box)return;if(pressing){pending=true;return;}const d=devs(),list=links(),e=el(),pr=progress(list,d,e,encoderOf);
      let html;
      if(d.actuators.length)autoChassis(d);
      if(!d.actuators.length&&!d.sensors.length)html=`<section class="cal-card"><h2>Electronics calibration</h2><p class="hint">Nothing to calibrate yet. Read the robot’s configuration in Setup and every motor, servo and sensor on it shows here.</p></section>`;
      else{const all=rows(d,pr);if(picked!==CHASSIS&&!all.some(x=>x.name===picked))picked=chassisDone(d)?(all.find(x=>!x.done)||all[0])?.name||CHASSIS:CHASSIS;
        const at=e.zeroedAt&&zeroed?new Date(e.zeroedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'',doneTiles=all.filter(x=>x.done).length;
        html=`<div class="cal-elec2"><aside class="sim-garage cal-elec-list" aria-label="The robot’s configuration"><div class="cal-elec-listhead"><b>${esc(opts.config?.()||'Configuration')}</b><span class="rs-pill${doneTiles===all.length?' ok':''}">${doneTiles} of ${all.length} done</span></div><p class="hint cal-elec-saved">Saves by itself.</p>${listHtml(d,pr)}</aside>
          <div class="cal-elec-main"><section class="cal-card cal-links"><div class="cal-elec-zero"><div><b>${zeroed?'Everything is at zero':'Is everything at zero?'}</b><small class="hint">${zeroed?`Encoders zeroed at ${esc(at)}.`:'Every moving part back where it starts, and the robot on blocks.'}</small></div>
            ${live()?`<button type="button" class="${zeroed?'secondary':'primary'}" data-elec-zero${busy||checking?' disabled':''}>${zeroed?'Zero again':'Yes, zero everything'}</button>`:debugGoing()?`<span class="hint" role="status" data-elec-starting>${esc(debugGoing())}</span>`:'<button type="button" class="primary" data-link-live>Start live readings</button>'}</div>${!live()&&debug?.state?.()?.problem?`<p class="cal-sense-note bad">${esc(debug.state().problem)}</p>`:''}
            ${picked===CHASSIS?chassisHtml(d):picked?deviceHtml(d,pr):''}</section></div></div>`;}
      if(box.dataset.html===html){drawBoard();return;}const focus=document.activeElement,fset=focus?.dataset?.elecSet,fpick=focus?.dataset?.elecPick;box.dataset.html=html;box.innerHTML=html;
      if(fset)box.querySelector(`[data-elec-set="${CSS.escape(fset)}"]`)?.focus();else if(fpick)box.querySelector(`[data-elec-pick="${CSS.escape(fpick)}"]`)?.focus();
      drawBoard();}
    // Keys while Electronics shows: Ctrl+Z undoes, Ctrl+Shift+Z (or Ctrl+Y) redoes, Esc lets go of what is picked on the board
    // (and stops a watch), Enter moves the picked device when nothing else has the key.
    addEventListener('keydown',e=>{if(!box?.offsetParent)return;const t=e.target,typing=t?.closest?.('input,textarea,[contenteditable=true]');
      if((e.ctrlKey||e.metaKey)&&!e.altKey&&!typing){const k=e.key.toLowerCase();if(k==='z'||k==='y'){const back=k==='z'&&!e.shiftKey;if(back?restore(undo,redo):restore(redo,undo))e.preventDefault();return;}}
      if(e.key==='Escape'){if(tapped||stopWatch||seen){tapped='';stopWatch?.();seen=null;paint();e.preventDefault();}return;}
      if(e.key==='Enter'&&!typing&&!t?.closest?.('button,select,a')){const go=box.querySelector('[data-elec-go]:not([disabled]),[data-elec-piece]:not([disabled])');if(go){e.preventDefault();go.click();}}});
    // A redraw between a button's press and release would swallow its click: wait for the release.
    box?.addEventListener('pointerdown',()=>{pressing=true;});
    addEventListener('pointerup',()=>{if(!pressing)return;pressing=false;if(pending){pending=false;setTimeout(paint,0);}},true);
    addEventListener('pointercancel',()=>{pressing=false;if(pending){pending=false;setTimeout(paint,0);}},true);
    if(typeof ResizeObserver==='function'&&box)new ResizeObserver(()=>drawBoard()).observe(box);
    const byId=id=>links().find(l=>l.id===id);
    // ---- moving and watching
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    function recorder(){const got=[],off=debug.listen((_f,v)=>got.push(v));return {take:()=>got.splice(0),get count(){return got.length;},stop:off};}
    // At least 0.4 s and three readings at rest (a slow link sends fewer), or 2 s at most.
    async function rest(rec){const began=performance.now();while((performance.now()-began<400||rec.count<3)&&performance.now()-began<2000)await wait(50);return rec.take();}
    const send=line=>debug.send(line);
    const powerLine=(c,power)=>`${c.kind==='crservo'?'C':'M'}\t${c.name}\t${power.toFixed(3)}`;
    // A burst at each device's own speed and length, the way the cause says (a servo: to the far end, held, then back to
    // From), while every reading is recorded: {before, during}. A continuous servo first gets a short pulse to wake it.
    async function pulse(causes){const moving=causes.filter(c=>c.kind!=='piece'),spun=moving.filter(c=>c.kind!=='servo'),servos=moving.filter(c=>c.kind==='servo');
      try{for(const c of servos){const s=set(c.name,'servo');void send(`S\t${c.name}\t${(c.dir>0?Math.min(s.from,s.to):Math.max(s.from,s.to)).toFixed(3)}`);enabled.add(c.name);}
        const wake=spun.filter(c=>c.kind==='crservo');if(wake.length){for(const c of wake)void send(powerLine(c,set(c.name,c.kind).speed/100*c.dir));await wait(120);for(const c of wake)void send(powerLine(c,0));}
        if(servos.length||wake.length)await wait(servos.length?700:300);
        const rec=recorder();const before=await rest(rec);
        const lines=spun.map(c=>powerLine(c,set(c.name,c.kind).speed/100*c.dir));
        for(const c of servos){const s=set(c.name,'servo');void send(`S\t${c.name}\t${(c.dir>0?Math.max(s.from,s.to):Math.min(s.from,s.to)).toFixed(3)}`);}
        for(const x of lines)void send(x);const keep=setInterval(()=>{for(const x of lines)void send(x);},100);
        await wait(1000*Math.max(...moving.map(c=>set(c.name,c.kind).secs),.2));clearInterval(keep);for(const c of spun)void send(powerLine(c,0));await wait(500);const during=rec.take();rec.stop();
        for(const c of servos)void send(`S\t${c.name}\t${set(c.name,'servo').from.toFixed(3)}`);
        return {before,during};}
      finally{for(const c of spun)void send(powerLine(c,0));}}
    // Watches until `done(before, during)` says so, or 30 s pass, or Stop: {before, during, stopped}.
    function watch(done){return new Promise(resolve=>{const rec=recorder();let before=null,during=[],timer=null;const end=stopped=>{clearInterval(timer);rec.stop();stopWatch=null;resolve({before:before||[],during,stopped});};stopWatch=()=>end(true);
      ready=false;paint();void rest(rec).then(got=>{before=got;ready=true;paint();const began=performance.now();timer=setInterval(()=>{during.push(...rec.take());if(done(before,during))end(false);else if(performance.now()-began>30000)end(false);},100);});});}
    // The cause the picked device's settings describe (a servo: the way From to To goes).
    function causeOf(a){if(a.kind==='servo'){const s=set(a.name,'servo');return {name:a.name,kind:'servo',dir:s.to>=s.from?1:-1};}return {name:a.name,kind:a.kind,dir:set(a.name,a.kind).dir};}
    // A passing link from what was seen: it replaces a planned or failed one between the same two.
    function linkSeen(c,x,d){const s=d.sensors.find(y=>y.key===x.key),dir=x.dir*(c.kind==='piece'?1:c.dir);
      cal().links=[...links().filter(k=>!(k.effect.key===x.key&&k.causes.length===1&&k.causes[0].name===c.name)),{id:newId(),causes:[{...c,dir:c.kind==='piece'?1:1}],effect:{key:x.key,dir:c.kind==='piece'?x.dir:dir},result:{state:'pass',text:`It ${wordsOf(s,x.dir)} (${fix2(x.delta)}) when ${causeName(c)} ${causeWords(c)}.${configured(c,x.key)==='own'?' Matches Configure: its encoder is on its own port.':''}`,at:new Date().toISOString(),delta:x.delta}}];
      el().none=(el().none||[]).filter(n=>n!==c.name);}
    async function move(piece){const d=devs();if(!live()||busy||!zeroed)return;const a=d.actuators.find(x=>x.name===picked);
      const cause=piece?{name:PIECE,kind:'piece',dir:1}:a?causeOf(a):null;if(!cause)return;
      busy=piece?'watch':'move';seen=null;paint();
      try{const r=piece?await watch((b,du)=>changes(d,b,du).length>0):await pulse([cause]);seen={cause,changes:changes(d,r.before,r.during)};
        // A motor's own encoder counting, or a planned link's sensor changing, checks itself off.
        const auto=seen.changes.filter(x=>configured(cause,x.key)==='own'||joined(links(),cause.name,x.key)?.planned);if(auto.length){for(const x of auto)linkSeen(cause,x,d);opts.save();}}
      catch(e){seen={cause,changes:[],error:`The move stopped: ${e.message}`};}
      finally{busy=null;}paint();}
    // Moved by hand: reads it at rest, then watches until what it needs moved has (and a second more, to see where it ends
    // up), or 30 s pass, or Stop. Kept in electronics.moved, before and after for each reading.
    async function handMove(){const d=devs(),dev=read().find(x=>x.name===picked)||{name:picked,kind:d.sensors.find(s=>s.name===picked)?.kind};if(!live()||busy||!byHand(dev.kind))return;
      busy='hand';seen=null;paint();let okAt=0;
      try{const r=await watch((b,du)=>{const c=handCheck(dev.kind,dev.name,b,du);if(c.ok&&!okAt)okAt=performance.now();return okAt&&performance.now()-okAt>1000;});
        const c=handCheck(dev.kind,dev.name,r.before,r.during),last=[...r.during].reverse().find(v=>v[`i:${dev.name}:status`]!==undefined)?.[`i:${dev.name}:status`],said=dev.kind==='pinpoint'?statusWords(last):'';
        const text=c.unread?`Torque Debug has no reading for ${dev.name}: is it in the active configuration, and plugged into an I2C port?`:c.ok?'':dev.kind==='pinpoint'&&c.missing.length?`${c.missing.join(' and ')} did not count.${said?' '+said:' Is that pod plugged into the Pinpoint, and did it roll?'}`:`Nothing changed while Torque watched.${r.stopped?'':' Did it move?'} Check its cable.`;
        edit(()=>{el().moved={...el().moved,[dev.name]:{ok:c.ok,at:new Date().toISOString(),rows:c.rows.map(x=>x.unread?{k:x.k,label:x.label,unread:true}:{k:x.k,label:x.label,unit:x.unit,before:+x.before.toFixed(3),after:+x.after.toFixed(3),moved:x.moved}),...(text?{text}:{}),...(last!==undefined?{status:String(last)}:{})}};});}
      catch(e){edit(()=>{el().moved={...el().moved,[dev.name]:{ok:false,at:new Date().toISOString(),rows:[],text:`The watch stopped: ${e.message}`}};});}
      finally{busy=null;}paint();}
    async function check(l){const d=devs();if(!live()||!zeroed||checking||busy||missing(l,d).length)return;checking=l.id;paint();let r;
      const causes=l.planned?l.causes.map(c=>{const a=d.actuators.find(x=>x.name===c.name);return a?causeOf(a):c;}):l.causes;
      try{const piece=l.causes.some(c=>c.kind==='piece');const got=piece?await watch((b,du)=>{const s=d.sensors.find(x=>x.key===l.effect.key);return s&&!!change(s,b,du);}):await pulse(causes);r=judge(l,d,got.before,got.during);}
      catch(e){r={state:'none',others:[],error:e.message};}
      finally{checking=null;}
      const now=byId(l.id);if(now){if(now.planned&&r.state==='pass'){const c=causes[0];now.planned=false;now.causes=[{...now.causes[0],dir:1}];now.effect={...now.effect,dir:c.kind==='piece'?r.dir:r.dir*(c.dir||1)};}
        now.result={state:r.state,text:r.error?`The check stopped: ${r.error}`:resultText(r,now,d),at:new Date().toISOString(),...(Number.isFinite(r.delta)?{delta:r.delta}:{}),...(r.others?.length?{others:r.others.map(o=>o.key)}:{})};}
      opts.save();paint();}
    box?.addEventListener('change',e=>{const t=e.target,d=devs(),a=d.actuators.find(x=>x.name===picked);
      if(t.hasAttribute('data-elec-drive')){opts.setChassis?.({type:t.value});const c=guessChassis(t.value,d);edit(()=>{el().chassis=c;});return;}
      if(t.dataset.elecSlot){const c=chassis(),slot=t.dataset.elecSlot,field=t.dataset.elecField;return edit(()=>{el().chassis={type:c.type,slots:{...c.slots,[slot]:{...c.slots[slot],[field]:t.value}}};});}
      if(t.dataset.elecSet&&a){const k=t.dataset.elecSet,v=+t.value;setSet(a.name,a.kind,{[k]:k==='dir'?(v>0?1:-1):v});seen=null;
        if(a.kind==='servo'&&k==='from'&&enabled.has(a.name))void send(`S\t${a.name}\t${v.toFixed(3)}`);return paint();}
      if(t.hasAttribute('data-elec-enable')&&a){if(t.checked){enabled.add(a.name);void send(`S\t${a.name}\t${set(a.name,'servo').from.toFixed(3)}`);}else{enabled.delete(a.name);void send(`E\t${a.name}\t0`);}return paint();}});
    box?.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const li=b.closest('[data-link]'),l=li&&byId(li.dataset.link),d=devs();
      if(b.dataset.elecPick!==undefined){if(b.dataset.elecPick!==picked){picked=b.dataset.elecPick;seen=null;}return paint();}
      if(b.hasAttribute('data-elec-next')){const all=rows(d,progress(links(),d,el(),encoderOf));picked=(all.find(x=>!x.done&&x.name!==picked)||all.find(x=>!x.done))?.name||picked;seen=null;return paint();}
      if(b.hasAttribute('data-link-live'))return void debug?.start?.();
      if(b.hasAttribute('data-elec-configure'))return opts.toConfigure?.();
      if(b.hasAttribute('data-elec-zero')){for(const a of d.actuators)if(a.kind==='motor')void send(`R\t${a.name}`);zeroed=true;seen=null;return edit(()=>{el().zeroedAt=new Date().toISOString();});}
      if(b.hasAttribute('data-elec-go'))return void move(false);
      if(b.hasAttribute('data-elec-piece'))return void move(true);
      if(b.hasAttribute('data-elec-hand'))return void handMove();
      if(b.dataset.elecSkip)return edit(()=>{const now=new Set(el().skipped||[]);if(b.dataset.elecSkip==='on')now.add(picked);else now.delete(picked);el().skipped=[...now];seen=null;});
      if(b.hasAttribute('data-elec-stop'))return void stopWatch?.();
      if(b.hasAttribute('data-elec-spins'))return edit(()=>{el().spins=[...new Set([...(el().spins||[]),picked])];seen=null;});
      if(b.hasAttribute('data-elec-chassis-guess'))return edit(()=>{el().chassis=guessChassis(p().robot?.drivetrain||'mecanum',d);});
      if(b.hasAttribute('data-elec-chassis-use')){const c=chassis();opts.setChassis?.({devices:simDevices(c)});return edit(()=>{el().chassis=c;cal().links=plan(links(),chassisLinks(c,d,encoderOf));});}
      if(b.hasAttribute('data-elec-sim-use'))return edit(()=>{cal().links=plan(links(),simWanted(d));});
      if(b.hasAttribute('data-board-import'))return edit(()=>{cal().links=fromDebug(links(),debug?.found?.()||[],d).links;});
      if(b.dataset.boardCause!==undefined){tapped=tapped===b.dataset.boardCause?'':b.dataset.boardCause;return paint();}
      if(b.dataset.boardEffect!==undefined&&tapped){const key=b.dataset.boardEffect,have=joined(links(),tapped,key);
        return edit(()=>{if(have)cal().links=links().filter(x=>x!==have);else{const a=d.actuators.find(x=>x.name===tapped);cal().links=[...links(),{id:newId(),causes:[tapped===PIECE?{name:PIECE,kind:'piece',dir:1}:{name:a.name,kind:a.kind,dir:1}],effect:{key,dir:1},planned:true}];}});}
      if(b.dataset.seenLink&&seen){const x=seen.changes.find(y=>y.key===b.dataset.seenLink);if(!x)return;return edit(()=>linkSeen(seen.cause,x,d));}
      if(b.hasAttribute('data-seen-none')&&seen)return edit(()=>{el().none=[...new Set([...(el().none||[]),seen.cause.name])];seen=null;});
      if(!l)return;
      if(b.hasAttribute('data-link-delete'))return edit(()=>{cal().links=links().filter(x=>x!==l);});
      if(b.hasAttribute('data-link-match'))return edit(()=>{l.effect={...l.effect,dir:-l.effect.dir};l.result={...l.result,state:'pass',text:'Changed to match the robot: the sensor goes the way the check saw.'};});
      if(b.hasAttribute('data-link-check'))void check(l);});
    return {refresh:paint,check:id=>{const l=byId(id);return l?check(l):Promise.resolve();}};}
  root.DeckLinks={...api,create,settingsOf};
})(typeof globalThis==='object'?globalThis:this);
