'use strict';
// Calibrate → Mechanisms starts with the chassis: the drivetrain Simulate describes, checked on the real robot. Electronics
// already checks what is plugged in where and which way each encoder counts, so nothing here repeats it. The checks are
// the drivetrain's own:
//   a swerve: Point the wheels straight (each module's absolute encoder reading with its wheel straight ahead is its
//     zero), then each pod by itself: Torque turns it a quarter turn left, then right, and spins its wheel, and the student
//     says whether it went that way. A pod that went the other way has its sense, or its motor, turned round;
//   any other drivetrain: Wheels roll forward, each drive motor spun and reversed if it rolled backwards;
//   then, only on a robot that measures where it is (not heading alone): How far it rolls (the encoder ticks in an inch of
//     floor) and Where it is on the field (a live map from a zero the student sets).
// What they measure is written out as a class of constants for the team's own robot code (codeOf).
// Kept in project.calibration.chassis: {steer:{at, zero:{name: volts}}, pods:{key:{left, right, drive, sense, enc}},
// roll:{at, ticksPerIn, rows}, zero?, spots:[{real:{x,y}, read:{x,y,h}}], placed}.
// Frame (Road Runner, Pedro, Deck): x forward, y left, inches; heading degrees counterclockwise.
(function(root){
  const MM=25.4,wrap=d=>((d+180)%360+360)%360-180,rad=d=>d*Math.PI/180;
  const DRIVE_KEYS=['frontLeft','frontRight','backLeft','backRight','left','right'];
  // What the drivetrain runs on, by its kind: the keys of robot.devices it uses.
  const DRIVE_OF={tank2:['left','right'],tank:['frontLeft','backLeft','frontRight','backRight'],kiwi:['frontLeft','frontRight','backLeft'],kiwiSwerve:['front','backLeft','backRight']};
  // Setup's slots for the drivetrain (DeckHardware.DRIVE_SLOTS, what Setup names and the exports use), steering left out:
  // a kiwi's front, back left and back right, a differential swerve's two motors a module. DRIVE_OF only without it.
  const HW=()=>globalThis.DeckHardware||(typeof require==='function'?require('./sim-hardware.js'):null);
  const driveKeys=type=>{const s=HW()?.DRIVE_SLOTS?.[type];return s?s.map(x=>x[0]).filter(k=>!/^steer/.test(k)):DRIVE_OF[type]||['frontLeft','frontRight','backLeft','backRight'];};
  // Everything the chassis needs, from the setup: names as the robot's configuration calls them.
  // project: the setup; C: DeckSimConfig; cpr: drive encoder counts a motor turn.
  function chassisOf(project,C,{cpr=537.7}={}){
    const r=project.robot||{},dev=k=>r.devices?.[k]?.name||k,type=r.drivetrain||'mecanum',drive=C?.drives?.[type]||{name:type},loc=project.sensors?.localization||'encoders',odo=C?.odometryOf?C.odometryOf(r):{pods:{},pinpoint:{},otos:{},imu:{scale:1}};
    // A motor with no direction set yet turns as the exports and the simulated hub turn it: a mecanum or tank robot's left
    // side reversed (ui/sim-ftc.js), anything else forward.
    const sided=type==='mecanum'||type==='tank'||type==='tank2',motors=driveKeys(type).map(k=>({key:k,name:dev(k),reversed:typeof r.devices?.[k]?.reversed==='boolean'?r.devices[k].reversed:sided&&/left/i.test(k)}));
    const pods=({odometry:['par','perp'],odometry3:['par_left','par_right','perp']}[loc]||[]).map(k=>({key:k,name:dev(k),...odo.pods[k]}));
    const wheelIn=(r.wheelDiameterMm||104)/MM;
    return {type,name:drive.name,holonomic:!!drive.holonomic,swerve:drive.engine==='swerve',loc,locName:C?.sensors?.[loc]?.name||loc,motors,pods,imu:dev('imu'),pinpoint:dev('pinpoint'),otos:dev('otos'),odo,
      nominalTicksPerIn:cpr/(Math.PI*wheelIn),driveTicksPerIn:project.calibration?.chassis?.roll?.ticksPerIn||cpr/(Math.PI*wheelIn),podTicksPerIn:2000/(Math.PI*32/MM)};}
  // The robot's devices the chassis names that Electronics does not see on the robot.
  function missing(ch,devs){const has=n=>devs.actuators.some(a=>a.name===n)||devs.sensors.some(s=>s.name===n);const out=ch.motors.filter(m=>!has(m.name)).map(m=>m.name);
    if(ch.loc==='fused'&&!has(ch.pinpoint))out.push(ch.pinpoint);if(ch.loc==='optical'&&!has(ch.otos))out.push(ch.otos);for(const p of ch.pods)if(!has(p.name))out.push(p.name);
    if(['odometry','odometry3','encoders','gyro'].includes(ch.loc)&&!has(ch.imu))out.push(ch.imu);return [...new Set(out)];}
  // What it can say about where it is: x, y and heading, or heading only.
  const measures=ch=>ch.swerve&&ch.loc==='encoders'?'heading':['fused','optical','odometry','odometry3','encoders'].includes(ch.loc)?'position':ch.loc==='gyro'?'heading':'nothing';
  // ---- where it is, from Torque Debug's readings (v: {key: value}) ----
  // tracker(ch).zero(v) sets here as (0, 0) facing 0°; update(v) returns {x, y, h} from there.
  function tracker(ch){
    let z=null,pose={x:0,y:0,h:0},last=null;
    const imuH=v=>{const y=v[`i:${ch.imu}:yaw`];return Number.isFinite(y)?y*(ch.odo.imu?.scale||1):NaN;};
    // An absolute sensor (Pinpoint, OTOS): its own x, y, h, made relative to the zero.
    const absolute=v=>{if(ch.loc==='fused'){const n=ch.pinpoint,x=v[`i:${n}:x`],y=v[`i:${n}:y`];return {x:x/MM,y:y/MM,h:v[`i:${n}:h`]};}const n=ch.otos;return {x:v[`i:${n}:x`],y:v[`i:${n}:y`],h:v[`i:${n}:h`]};};
    // A counting one (pods or drive encoders, with the IMU's heading): how far it went forward and sideways since last time.
    function counts(v){const t=k=>v[`m:${k}:pos`];
      if(ch.loc==='odometry'||ch.loc==='odometry3'){const val=p=>t(p.name)*(p.reversed?-1:1)*(p.scale||1)/ch.podTicksPerIn,par=ch.pods.filter(p=>p.key!=='perp'),perp=ch.pods.find(p=>p.key==='perp');
        return {f:par.reduce((a,p)=>a+val(p),0)/par.length,fy:par.reduce((a,p)=>a+(p.y||0),0)/par.length,s:perp?val(perp):0,sx:perp?.x||0};}
      const m=Object.fromEntries(ch.motors.map(x=>[x.key,t(x.name)*(x.reversed?-1:1)/ch.driveTicksPerIn]));
      if(['tank','tank2'].includes(ch.type)){const l=[m.left??m.frontLeft,m.backLeft].filter(Number.isFinite),r=[m.right??m.frontRight,m.backRight].filter(Number.isFinite);return {f:(l.reduce((a,b)=>a+b,0)/l.length+r.reduce((a,b)=>a+b,0)/r.length)/2,s:0,fy:0,sx:0};}
      return {f:(m.frontLeft+m.frontRight+m.backLeft+m.backRight)/4,s:(-m.frontLeft+m.frontRight+m.backLeft-m.backRight)/4,fy:0,sx:0};}
    function read(v){
      if(ch.loc==='fused'||ch.loc==='optical'){const a=absolute(v);if(![a.x,a.y,a.h].every(Number.isFinite))return null;return {abs:a};}
      const h=imuH(v);if(!Number.isFinite(h))return null;if(measures(ch)!=='position')return {h};const c=counts(v);return Number.isFinite(c.f)&&Number.isFinite(c.s)?{h,c}:null;}
    return {
      zero(v){const r=read(v);if(!r)return false;z=r;last=r;pose={x:0,y:0,h:0};return true;},
      get zeroed(){return !!z;},
      update(v){const r=read(v);if(!r||!z)return null;
        if(r.abs){const dx=r.abs.x-z.abs.x,dy=r.abs.y-z.abs.y,c=Math.cos(rad(-z.abs.h)),s=Math.sin(rad(-z.abs.h));pose={x:dx*c-dy*s,y:dx*s+dy*c,h:wrap(r.abs.h-z.abs.h)};return pose;}
        const h=wrap(r.h-z.h);if(!r.c){pose={x:NaN,y:NaN,h};return pose;}
        // A turn rolls a forward pod left of centre backwards (−y·Δθ) and a strafe pod ahead of centre left (+x·Δθ): taken out, the rest is travel.
        const dth=rad(wrap(h-pose.h)),f=r.c.f-last.c.f+r.c.fy*dth,sw=r.c.s-last.c.s-r.c.sx*dth,mid=rad(pose.h)+dth/2;
        pose={x:pose.x+f*Math.cos(mid)-sw*Math.sin(mid),y:pose.y+f*Math.sin(mid)+sw*Math.cos(mid),h};last=r;return pose;}};}
  // ---- the wheels in the CAD ----
  // Each drive wheel the CAD's moving parts found (joints driven by 'wheel', not odometry pods), given to the drivetrain's
  // wheel or module it points at from the robot's centre: front +x, back -x, left +y, right -y from the slot's key. Several
  // wheels on one side (a six-wheel tank) give their middle. slots: [{key}]; joints: kinematics joints, their origins in the CAD's frame;
  // toRobot: CAD point to robot inches (DeckJointsPanel's), else the origins are taken as robot inches already.
  // Returns {key: {x, y, wheels}}.
  function wheelSlots(slots,joints,{toRobot=null}={}){const dirOf=k=>{const w=k.replace(/B$/,'').replace(/([A-Z])/g,' $1').toLowerCase();const x=/front/.test(w)?1:/back/.test(w)?-1:0,y=/left/.test(w)?1:/right/.test(w)?-1:0,n=Math.hypot(x,y)||1;return [x/n,y/n];};
    const wheels=(joints||[]).filter(j=>j?.drive?.signal==='wheel'&&j.kind!=='odometry-pod'&&!/odometry|dead ?wheel/i.test(j.name||'')&&Array.isArray(j.origin)&&Number.isFinite(j.origin[0])&&Number.isFinite(j.origin[1]));
    const out={},list=slots.filter(s=>!/B$/.test(s.key)).map(s=>({key:s.key,d:dirOf(s.key)}));if(!list.length||!wheels.length)return out;
    for(const w of wheels){const [x,y]=toRobot?toRobot(w.origin):w.origin,n=Math.hypot(x,y)||1;let best=null,score=-Infinity;for(const s of list){const v=(x*s.d[0]+y*s.d[1])/n;if(v>score){score=v;best=s;}}(out[best.key]??={xs:[],ys:[],wheels:[]});out[best.key].xs.push(x);out[best.key].ys.push(y);out[best.key].wheels.push(w.id);}
    for(const [k,v] of Object.entries(out))out[k]={x:+(v.xs.reduce((a,b)=>a+b,0)/v.xs.length).toFixed(3),y:+(v.ys.reduce((a,b)=>a+b,0)/v.ys.length).toFixed(3),wheels:v.wheels};return out;}
  // A spot the robot was driven to and measured with a tape: how far off the reading is.
  const spotError=(real,read)=>Math.hypot(read.x-real.x,read.y-real.y);
  const PASS_IN=1,PUSH_IN=48;
  // Wheels that roll the whole distance of a straight push forward: not omni wheels set at an angle to it.
  const rolls=ch=>measures(ch)==='position'&&ch.loc==='encoders'&&!['kiwi','xdrive'].includes(ch.type);
  // ---- a swerve's pods ----
  // Each drive motor with its steering servo and absolute encoder. steer: [{key:'robot.steerFront', servo, name, volts}].
  const podName=key=>key.replace(/([A-Z])/g,' $1').toLowerCase().replace(/^./,c=>c.toUpperCase());
  const podsOf=(ch,steer)=>ch.motors.map(m=>({key:m.key,label:podName(m.key),motor:m,steer:(steer||[]).find(x=>x.key==='robot.steer'+m.key[0].toUpperCase()+m.key.slice(1))||null}));
  // An absolute encoder reads 0 to span volts over one turn. sense: +1 when the reading rises as the wheel turns left
  // (counterclockwise from above). The reading for a wheel angle, and the angle (-180 to 180) for a reading.
  const steerTarget=(zero,deg,span,sense=1)=>(((zero+sense*deg/360*span)%span)+span)%span;
  const steerAngle=(volts,zero,span,sense=1)=>{let t=(volts-zero)/span;t-=Math.round(t);return sense*t*360;};
  // Torque Debug's own loop (Q) holds the pod there: power per volt of error, the short way round the turn.
  // g: +1 when positive servo power raises the reading (Electronics' link says), -1 when it lowers it.
  const TOL_DEG=1.5,STEER={kP:.3,kD:.01,kS:.03};
  // A pod not tuned yet, for the TeleOp: gentle numbers (volts of a 3.3 V encoder) that turn most pods without bouncing.
  const STEER_DEFAULT={kP:8,leadP:.1,leadN:.1,cP:.12,cN:.12,vP:40/360*3.3,vN:40/360*3.3,slope:1500/360*3.3,vmax:400/360*3.3,rP:80/360*3.3,rN:80/360*3.3,zone:8/360*3.3,ease:1/360*3.3,still:12/360*3.3,lag:.14};
  const steerLoop=(st,target,g,span,pid=STEER,tolDeg=TOL_DEG)=>{const tol=(tolDeg*.6/360*span).toFixed(4);
    // Gains from the tuner run the steering law (the "S" fields); a pod not tuned yet gets the plain loop.
    if(pid.leadP>0&&pid.cP>0&&pid.rP>0)return ['Q',st.servo,'ana:'+st.name,'pos',target.toFixed(4),(pid.kP*g).toFixed(3),0,0,0,0,0,tol,span,0,'S',pid.leadP.toFixed(4),pid.leadN.toFixed(4),pid.cP.toFixed(3),pid.cN.toFixed(3),pid.vP.toFixed(4),pid.vN.toFixed(4),pid.slope.toFixed(3),pid.vmax.toFixed(3),pid.zone.toFixed(4),pid.rP.toFixed(4),pid.rN.toFixed(4),(pid.still||0).toFixed(4),(pid.lag||.14).toFixed(3),(pid.ease||0).toFixed(4)].join('\t');
    return ['Q',st.servo,'ana:'+st.name,'pos',target.toFixed(4),(pid.kP*g).toFixed(4),((pid.kI||0)*g).toFixed(3),(pid.kD*g).toFixed(5),0,(pid.kS*g).toFixed(3),0,tol,span,(IZONE_DEG/360*span).toFixed(4)].join('\t');};
  // How far off a turn may stop, set by the team: plus is past the target, minus short of it, the way the wheel was turning.
  const TOLS=[.5,1,1.5,2,3,5],tolOf=rec=>{const t=rec?.tol||{},ok=v=>TOLS.includes(v)?v:TOL_DEG;return {plus:ok(t.plus),minus:ok(t.minus)};},bandOf=rec=>{const t=tolOf(rec);return Math.min(t.plus,t.minus);};
  // ---- the steering law ----
  // One step of the loop that turns a pod to an angle (TorqueDebug.java's steer and the generated TeleOp's Steer run the
  // same steps; this one is the reference they are checked against). It is built on what a real pod measured:
  //   A continuous servo is a speed, not a force. It turns only past a start power, and that power differs each way
  //   (11% one way and 8% the other on the pod this was measured on); from there its speed climbs with the power to a top
  //   speed (465°/s by 40% power), and it does what it is told about 60 ms later, so a wheel at full speed is 25° further
  //   on by the time a stop takes hold. Its smallest step is about a degree.
  //   The encoder's voltage is pushed up while any servo draws current (1.5° at full power, more for an instant as a motor
  //   starts), on every pod at once: a reading taken under power is a little off, and one wild reading means nothing.
  //   It slows down only when its power goes to nothing (it brakes, and stops in the time above); given less power it
  //   just runs on. Easing the power down on the way in does not slow it: it sails past.
  //   From a standstill a pod does not creep, it lurches: a 70 ms push at the creep power moved this one 6°, three times
  //   what its steady speed says. Small corrections cannot be planned from the steady speeds.
  // So:
  //   Approach: from outside the zone. The speed asked for only ever goes up: K times the distance left once the commands
  //         still on their way have played out, full power when far. Then the power is cut, at the point from which the
  //         wheel stops a little short of the target (ease), and that is the approach's one run in. Stopping short is
  //         cheap; going past means coming back.
  //   Push: stopped outside the tolerance but inside the zone, the creep power for a time: the distance over the speed a
  //         push from rest really gives (rP, rN, measured). Then off until the wheel has moved and stopped (or lag passes
  //         with nothing), then again. What each push did corrects the next, each way: nothing moved (a sticky spot),
  //         more power and a little longer; further or less far than aimed, shorter or longer in proportion.
  //   Rest: inside the tolerance the power is off; once it has stayed there, stopped, for 80 ms it is at rest, and stays
  //         off until the reading is 1.6 tolerances out. Stopped within 1.35 tolerances counts too: the tolerance is 0.6
  //         of what the team allows, and a push from there would as likely knock it out as bring it in.
  //   A wheel that gets nowhere for longer than a command takes to show gets more creep power that way (friction is not the
  //   same all the way round), and gives it back as it moves on.
  // e: target minus reading; measured: the reading; dt: seconds since the last step (the real time: loops are not even).
  // k: {kP: K a second, its sign which way power moves the reading; leadP, leadN: seconds a command takes to show when the
  // power is positive, negative; cP, cN: the creep power each way; vP, vN: the steady speed each gives; slope: speed gained
  // per unit of power; vmax; rP, rN: the speed a push from rest gives; tol; zone; ease; still: a speed the noise alone
  // cannot reach; lag: seconds to wait for a push to show; wrap}. Distances in the sensor's units, speeds in those a
  // second. s: the state (steerState()), kept between steps. Returns the power, -1 to 1.
  const steerState=()=>({t:0,raw:[],h:[],pipe:[],rest:false,speed:0,wait:0,lagLeft:0,moved:false,fire:0,firePow:0,fireDir:0,from:NaN,aim:0,gainP:1,gainN:1,boostP:0,boostN:0,tryT:0,tryM:NaN,cmdV:0,cmdLead:0,inT:0,run:false,vm:0,runT:0,runDir:0,pend:0,pendFull:false,stops:0,stopErr:0,stopWay:0,stopFull:false});
  function steerStep(s,e,measured,dt,k){const g=k.kP<0?-1:1,K=Math.abs(k.kP),wrapOf=x=>k.wrap>0?x-k.wrap*Math.round(x/k.wrap):x;
  dt=Math.max(.002,Math.min(.1,dt));s.t+=dt;
  // The middle of the last three readings: one wild reading (a motor starting disturbs the encoder's voltage) is dropped.
  s.raw.push(measured);if(s.raw.length>3)s.raw.shift();let off=0;if(s.raw.length===3){const a=wrapOf(s.raw[0]-measured),b=wrapOf(s.raw[1]-measured);off=Math.max(Math.min(a,b),Math.min(Math.max(a,b),0));}
  const m=measured+off,ef=wrapOf(e-off),a=Math.abs(ef),dir=ef<0?-1:1;
  s.h.push([s.t,m]);if(s.h.length>5)s.h.shift();s.speed=s.h.length<3?0:Math.abs(wrapOf(m-s.h[0][1]))/(s.t-s.h[0][0]);
  // What the commands still on their way will add. A command shows lead seconds after it is given and lasts until the next
  // step, so the last one goes on the list now, with the time it really lasted: [when it starts to show, when it has all
  // shown, how far it carries the wheel].
  if(s.cmdV){s.pipe.push([s.t-dt+s.cmdLead,s.t+s.cmdLead,s.cmdV*dt]);s.cmdV=0;}
  while(s.pipe.length&&s.pipe[0][1]<=s.t)s.pipe.shift();let trav=0,coming=0;for(const p of s.pipe)if(p[1]>s.t){trav+=p[2]*Math.min(1,(p[1]-s.t)/(p[1]-p[0]));coming++;}
  const idle=!coming&&s.speed<=k.still;
  // Where an approach's braking stop left the wheel: short of the target (+) or past it (-). The tuner sets lead by it.
  if(s.pend&&idle){s.stops++;s.stopErr=dir===s.pend?a:-a;s.stopWay=g*s.pend;s.stopFull=s.pendFull;s.pend=0;}
  // At rest it stays off until it is clearly out again: the reading moves a little whenever any servo draws current.
  if(s.rest){if(a<=k.tol*1.6)return 0;s.rest=false;}
  // Inside the tolerance the power is off. It is at rest once it has stayed there, stopped, for 80 ms: a push that only
  // springs the pod (it comes back) or shifts the reading does not count as arriving.
  if(a<=k.tol){s.fire=0;s.tryT=0;s.tryM=NaN;s.inT+=dt;if(idle&&s.inT>=.08){s.rest=true;s.wait=0;s.from=NaN;}return 0;}
  // Stopped a little outside the tolerance but well inside what is allowed (the tolerance is 0.6 of that): left alone. A
  // push from a standstill is a lurch, and would as likely knock it out as bring it in.
  if(a<=k.tol*1.35&&idle&&s.fire<=0&&s.wait<=0){s.tryT=0;s.tryM=NaN;s.inT+=dt;if(s.inT>=.08){s.rest=true;s.from=NaN;}return 0;}
  s.inT=0;
  // Outside the zone it is an approach. An approach gets one run in: once it has cut its power near the target, what is
  // left is done with pushes from a standstill.
  if(a>k.zone){s.wait=0;s.fire=0;s.from=NaN;if(!s.run){s.vm=0;s.runT=0;}s.run=true;}
  // A push under way: the rest of it, then power off until the wheel has moved and stopped (or lag passes with nothing).
  if(s.fire>0){s.fire-=dt;return g*s.fireDir*s.firePow;}
  if(s.wait>0){s.wait-=dt;s.lagLeft-=dt;if(s.speed>k.still)s.moved=true;if(s.wait>0&&(s.moved?s.speed>k.still:s.lagLeft>0))return 0;s.wait=0;}
  if(idle&&a<=k.zone){const od=g*dir;
    // Stopped a little off: a push. From a standstill a pod does not creep, it lurches, further than its steady speed
    // says, so the push is the creep power for a time: the distance over the speed a push from rest really gives (rP,
    // rN, measured). What the last push did corrects that for next time, each way: nothing moved (a sticky spot), more
    // power and a little longer; it moved, half of that extra power back, and further or less far than aimed makes the
    // next one shorter or longer in proportion.
    if(!Number.isNaN(s.from)){const went=s.fireDir*wrapOf(m-s.from),wasP=g*s.fireDir>0,key=wasP?'gainP':'gainN',bk=wasP?'boostP':'boostN';
      if(went<k.tol*.25){s[bk]=Math.min(.25,s[bk]+.025);s[key]=Math.max(.25,s[key]*.8);}
      else{s[bk]*=.5;s[key]=Math.max(.25,Math.min(4,s[key]*Math.pow(Math.max(.5,Math.min(2,went/s.aim)),.7)));}}
    const want=(a-k.tol*.3)/((od>0?k.rP*s.gainP:k.rN*s.gainN)),time=Math.max(.006,Math.min(.12,want));
    s.tryT=0;s.tryM=NaN;s.from=m;s.aim=a-k.tol*.3;s.fireDir=dir;s.firePow=Math.min(1,od>0?k.cP+s.boostP:k.cN+s.boostN);s.fire=time-dt;s.wait=k.lag+.4;s.lagLeft=k.lag;s.moved=false;return g*dir*s.firePow;}
  // The approach. A continuous servo slows down only when its power goes to nothing (it brakes); given less power it just
  // runs on. So the speed asked for only ever goes up (K times the distance left once the commands on their way have
  // played out, full power when far), and then the power is cut, at the point from which the wheel stops a little short
  // of the target (ease): a push finishes it. Stopping short is cheap; going past means coming back.
  s.from=NaN;const ap=ef-trav,A=Math.abs(ap),D=ap<0?-1:1,od=g*D,lead=od>0?k.leadP:k.leadN;
  // Trying for longer than a command takes to show with nothing to show for it: this spot takes more power than was
  // measured, so the creep gets more, that way only, until the wheel moves on; each tolerance of progress takes some back.
  if(Number.isNaN(s.tryM)||Math.abs(wrapOf(m-s.tryM))>k.tol){if(!Number.isNaN(s.tryM)){s.boostP*=.85;s.boostN*=.85;}s.tryM=m;s.tryT=0;}
  s.tryT+=dt;
  if(!s.run)return 0;
  if(A<=k.ease||D!==dir){if(s.runDir){s.pend=s.runDir;s.pendFull=s.vm>=k.vmax*.97;}s.run=false;s.vm=0;s.runDir=0;return 0;}
  if(s.tryT>lead+.08){if(od>0)s.boostP=Math.min(.25,s.boostP+.4*dt);else s.boostN=Math.min(.25,s.boostN+.4*dt);}
  const c=od>0?k.cP:k.cN,vc=od>0?k.vP:k.vN;s.vm=Math.max(s.vm,Math.min(k.vmax,Math.max(vc,K*(A-k.ease))));const full=s.vm>=k.vmax*.97,u=full?1:Math.min(1,c+(od>0?s.boostP:s.boostN)+(s.vm-vc)/k.slope);
  // A crawling wheel stops almost where it is when the power goes; from a sixth of top speed up it runs on for the whole lead.
  s.runDir=D;s.runT+=dt;s.cmdV=D*(full?k.vmax:s.vm);s.cmdLead=lead*Math.max(.3,Math.min(1,s.vm/(k.vmax*.17)));return g*D*u;}
  // The numbers the law starts from, out of what the tuner measured on the robot (volts, volts a second): each way, the
  // creep power with the speed it gave and the seconds the wheel took to stop from top speed (its coast over that speed);
  // the speed gained per unit of power; the top speed. lead is that stop time plus 30 ms (the law reads the middle of three
  // readings, and in a loop the wheel runs on a little longer than after a clean cut); the tune then corrects it from where the braking stops really land.
  const LEAD=[.03,.18];
  function steerGains({cP,cN,vP,vN,slope,vmax,stopP,stopN,rP,rN,noise=0,span=3.3}){const perDeg=span/360,lead=t=>+Math.max(LEAD[0],Math.min(LEAD[1],(Number.isFinite(t)&&t>0?t:.06)+.03)).toFixed(4),vp=Math.max(8*perDeg,vP),vn=Math.max(8*perDeg,vN),rest=(r,v)=>+Math.max(v,Math.min(vmax*.6,Number.isFinite(r)&&r>0?r:v*2)).toFixed(4);
    return {kP:40,leadP:lead(stopP),leadN:lead(stopN),cP:+cP.toFixed(3),cN:+cN.toFixed(3),vP:+vp.toFixed(4),vN:+vn.toFixed(4),slope:+Math.max(100*perDeg,slope).toFixed(3),vmax:+vmax.toFixed(3),rP:rest(rP,vp),rN:rest(rN,vn),
      zone:+(8*perDeg).toFixed(4),ease:+(1*perDeg).toFixed(4),still:+(Math.max(12,noise/perDeg*25)*perDeg).toFixed(4),lag:.14};}
  // ---- tuning a pod's steering by itself ----
  // A steering servo turns at a speed set by its power, after a short wait: the reading's speed is Kv times the power
  // (volts a second at full power), starting L seconds late. Both are read off one short run at a steady power.
  // samples: [[seconds since the power went on, volts travelled since then, the short way round each step]].
  // g is which way positive power moves the reading: measured here over a few degrees, where the reading cannot have
  // come round past its end, which a longer burst's start and end readings can.
  function plantOf(samples,power){const n=samples.length;if(n<4||!power)return null;const end=samples[n-1],mid=samples[Math.floor(n/2)],v=(end[1]-mid[1])/(end[0]-mid[0]);if(!(Math.abs(v)>1e-3))return null;
    return {g:Math.sign(v*power)||1,Kv:Math.abs(v/power),L:Math.min(.3,Math.max(.02,end[0]-end[1]/v))};}
  // Gains for that servo: proportional as high as its wait allows without swinging past (a third of the 1/(Kv·L) where it
  // would), never more than 60% power for a quarter turn; a little derivative; and most of the power it took to start
  // keeping it moving (kS, measured both ways), added in full whenever it is outside the tolerance; and an integral that, 3° off,
  // adds the rest it takes to start (static friction) within 0.3 s. The robot's loop only builds the integral within IZONE_DEG of the target and
  // clears it inside the tolerance or when the wheel crosses the target, so a long turn does not wind it up. Together they
  // close the last few degrees that proportional alone leaves, where friction holds the pod.
  const IZONE_DEG=15;
  // breakaway: the power that starts it turning; keep: the least that keeps it turning (0.8 of breakaway when not measured).
  const FULL_DEG=30;
  function gainsOf({Kv,L,breakaway=0,keep,span=3.3}){const kP=Math.max(.1,Math.min(1/(FULL_DEG/360*span),.5/(Kv*L))),kS=Math.max(0,Number.isFinite(keep)&&keep>0?Math.min(keep,breakaway):breakaway*.8),stick=Math.max(.02,breakaway-kS);
    return {kP:+kP.toFixed(3),kI:+(stick/((3/360*span)*.3)).toFixed(3),kD:+(kP*L*.25).toFixed(4),kS:+kS.toFixed(3)};}
  // One test turn: how far past the target it swung, how many times it crossed it, and when it stayed inside the tolerance.
  // trace: [[seconds, degrees from the target]].
  // noise: how far the reading wanders with the wheel still (degrees, peak to peak). A Control Hub's analog port reads an
  // absolute encoder a few tenths of a degree either way at rest, so smaller wiggles are not the wheel moving: crossing
  // the target and turning back only count beyond it.
  function stepStats(trace,tol=TOL_DEG,noise=0){if(!trace?.length)return null;const hyst=Math.max(tol/3,noise);const from=Math.sign(trace[0][1])||1;let over=0,crossings=0,side=from,settle=null;
    for(const [t,e] of trace){if(-from*e>over)over=-from*e;const now=Math.abs(e)>hyst?Math.sign(e):side;if(now!==side){crossings++;side=now;}if(Math.abs(e)<=tol){if(settle===null)settle=t;}else settle=null;}
    // After it arrived: how long it stayed inside the tolerance (held), how far it still moved there (swing), and how many
    // times it turned back on itself (hunt). A wheel that keeps reversing by a quarter of a degree or more is hunting, even
    // inside the tolerance: gains like that buzz the servo and wear the pod.
    let hunt=0,swing=0,held=0;if(settle!==null){const after=trace.filter(([t])=>t>=settle).map(x=>x[1]),step=Math.max(.25,tol*.2,noise*1.5);held=trace.at(-1)[0]-settle;
      if(after.length>2){const late=after.slice(Math.floor(after.length/2));swing=Math.max(...late)-Math.min(...late);let dir=0,ref=after[0];for(const e of after){const d=e-ref;if(Math.abs(d)>=step){const now=Math.sign(d);if(dir&&now!==dir)hunt++;dir=now;ref=e;}}}}
    return {overshoot:+over.toFixed(2),crossings,settle:settle===null?null:+settle.toFixed(2),held:+held.toFixed(2),hunt,swing:+swing.toFixed(2),...(noise?{noise:+noise.toFixed(2)}:{})};}
  // Oscillating: it crossed the target more than twice on the way in, or it is hunting where it stopped.
  const oscillates=x=>!!x&&(x.crossings>2||(x.hunt||0)>=3&&(x.swing||0)>Math.max(.6,2*(x.noise||0)));
  // Steady: it arrived, stayed there for as long as it was watched (hold seconds), did not swing far past, and is not oscillating.
  const steady=(x,hold=.25)=>!!x&&x.settle!==null&&(x.held??hold)>=hold&&x.overshoot<=3&&!oscillates(x);
  // The search for the quickest gains that stay accurate. tries: [{pid, stats}] of quarter turns so far, each steady or
  // not. From the measured gains it goes up a third at a time until a turn swings past or hunts, and stops there; if the
  // first was already too much it comes down instead. null when there is nothing more to try. The quickest steady one wins.
  const KP_MAX=15;
  // The tuner's version: gains saved by an older one (before friction was measured both ways and the integral zone) are
  // tuned again before Turn it left / right use them, or they stop short where friction holds the pod.
  const PID_V=6,tuned=x=>!!x?.pid&&x.pid.v===PID_V;
  function nextTry(tries,max=9){const last=tries.at(-1);if(!last||tries.length>=max)return null;const scale=k=>({...last.pid,kP:+(last.pid.kP*k).toFixed(3),kD:+(last.pid.kD*k).toFixed(4)});
    if(steady(last.stats))return tries.some(t=>!steady(t.stats))||last.pid.kP>=KP_MAX?null:scale(1.35);
    if(tries.some(t=>steady(t.stats)))return null;
    return last.stats&&last.stats.settle===null&&last.stats.crossings<=1&&last.stats.overshoot<1?{...last.pid,kS:+(last.pid.kS+.02).toFixed(3)}:scale(.6);}
  // ---- the long tune: every gain tried up and down, again and again, keeping whatever made the turn better ----
  // What a quarter turn cost: the seconds it took to settle, more for swinging past and for each time it crossed the
  // target; one that never settled costs more than any that did.
  const costOf=x=>!x?9:x.settle===null||oscillates(x)?5+x.overshoot*.1+x.crossings*.2+(x.hunt||0)*.2:x.settle+x.overshoot*.1+x.crossings*.05+(x.hunt||0)*.08+(x.swing||0)*.1;
  // Coordinate search ("twiddle"): p the gains, dp how far each is moved. One gain at a time goes up by its step; if the
  // turn got no better it goes down instead; if neither helped it goes back and its step shrinks, and a step that helped
  // grows. search.p is what to try next; searchStep takes what that cost.
  const searchStart=(p,dp)=>({p:[...p],dp:[...dp],best:null,bestP:[...p],i:0,phase:'base'});
  function searchStep(state,cost){const s={...state,p:[...state.p],dp:[...state.dp],bestP:[...state.bestP]},n=s.p.length,i=s.i,next=()=>{s.i=s.phase==='base'?0:(i+1)%n;s.p=[...s.bestP];s.p[s.i]+=s.dp[s.i];s.phase='up';};
    if(s.phase==='base'){s.best=cost;next();return s;}
    if(cost<s.best){s.best=cost;s.bestP=[...s.p];s.dp[i]*=1.3;next();return s;}
    if(s.phase==='up'&&s.bestP[i]-s.dp[i]>=0){s.p=[...s.bestP];s.p[i]-=s.dp[i];s.phase='down';return s;}
    s.dp[i]*=.6;next();return s;}
  const bestTry=tries=>tries.filter(t=>steady(t.stats)).sort((a,b)=>a.stats.settle-b.stats.settle)[0]||null;
  // A straight push forward of a measured distance: how many encoder ticks an inch of floor is, and each motor's count.
  // v0, v1: Torque Debug's readings at Start and at Done. A motor that counts backwards, or hardly at all, is named.
  function rollOf(ch,v0,v1,inches=PUSH_IN){
    const rows=ch.motors.map(m=>({name:m.name,ticks:((v1||{})[`m:${m.name}:pos`]-(v0||{})[`m:${m.name}:pos`])*(m.reversed?-1:1)}));
    const none=rows.filter(r=>!Number.isFinite(r.ticks)).map(r=>r.name);if(none.length)return {problem:`No encoder reading came back for ${none.join(', ')}. Check its encoder cable, and that Electronics has it ticked.`};
    const mean=rows.reduce((a,r)=>a+Math.abs(r.ticks),0)/rows.length;if(mean<inches*2)return {problem:'The encoders hardly counted. Press Start, then push the robot the whole distance before pressing Done.'};
    for(const r of rows){r.ticks=Math.round(r.ticks);r.weak=Math.abs(r.ticks)<mean*.5;r.backwards=!r.weak&&r.ticks<0;}
    const good=rows.filter(r=>!r.weak),ticksPerIn=good.reduce((a,r)=>a+Math.abs(r.ticks),0)/good.length/inches;
    return {ticksPerIn:+ticksPerIn.toFixed(3),inches,rows,expected:+ch.nominalTicksPerIn.toFixed(3),errorPct:+((ticksPerIn/ch.nominalTicksPerIn-1)*100).toFixed(2),ok:!rows.some(r=>r.weak||r.backwards)};}
  // What was measured, as a Java class for the team's own robot code. steer: [{name, servo, volts}] (each steering module's
  // absolute encoder); links: Electronics' checked links (which way each encoder counts); rec: calibration.chassis.
  const constant=name=>String(name).replace(/([a-z0-9])([A-Z])/g,'$1_$2').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_+|_+$/g,'').toUpperCase()||'DEVICE';
  function codeOf({ch,rec={},links=[],steer=[],config='',date=''}){
    const link=(cause,key)=>{const l=links.find(x=>x.result?.state==='pass'&&x.effect?.key===key&&x.causes?.some(c=>c.name===cause));return l?(l.effect.dir<0?-1:1):null;};
    const line=(type,name,value,note)=>`    public static final ${type} ${name} = ${value};${note?' // '+note:''}`,scale=ch.odo?.imu?.scale||1,pods=rec.pods||{},out=[];
    out.push(`// Measured on the real robot by Torque (Calibrate)${date?', '+date:''}.${config?` Configuration: "${config}".`:''}`,'// Copy this class into TeamCode and read these numbers from your drive code.','public final class TorqueCalibration {','    private TorqueCalibration() {}','',
      '    // Heading. Multiply the IMU\'s yaw by this before you use it.',line('double','IMU_HEADING_SCALE',(+scale.toFixed(6)).toString()+(Number.isInteger(scale)?'.0':''),scale===1?'not corrected: Heading, Spin it off a wall measures it':'measured by turning it'));
    if(ch.motors.length){out.push('','    // Drive motors. REVERSED: set that motor\'s direction to REVERSE so positive power rolls its wheel forward.','    // ENCODER_SIGN: +1 when its encoder counts up as the wheel rolls forward, -1 when it counts down.');
      for(const m of ch.motors){const x=pods[m.key]||{},g=x.drive?(x.enc||1):link(m.name,`m:${m.name}:pos`);out.push(line('boolean',constant(m.name)+'_REVERSED',String(!!m.reversed),x.drive?'':'not checked yet'),line('int',constant(m.name)+'_ENCODER_SIGN',g??1,g===null?'not checked yet':''));}
      if(measures(ch)==='position'&&ch.loc==='encoders')out.push('    // Inches travelled = ticks / DRIVE_TICKS_PER_INCH.',line('double','DRIVE_TICKS_PER_INCH',(rec.roll?.ticksPerIn||+ch.nominalTicksPerIn.toFixed(3)).toString(),rec.roll?.ticksPerIn?`measured by pushing ${rec.roll.inches||PUSH_IN} in`:'from the motor and wheel size: not measured yet'));}
    if(steer.length){out.push('','    // Swerve steering. ZERO_VOLTS: what each absolute encoder reads with its wheel pointing straight ahead.','    // ENCODER_SIGN: +1 when the reading rises as the wheel turns left (counterclockwise from above), -1 when it falls.','    // SERVO_SIGN: +1 when positive servo power turns the wheel left, -1 when it turns it right.','    // Wheel angle in degrees, left positive = ENCODER_SIGN * (volts - ZERO_VOLTS) / STEER_VOLTS_PER_TURN * 360',line('double','STEER_VOLTS_PER_TURN',(steer[0].volts||3.3).toString()));
      for(const q of podsOf(ch,steer)){const m=q.steer;if(!m)continue;const z=rec.steer?.zero?.[m.name],x=pods[q.key]||{},checked=!!x.left&&!!x.right,sense=x.sense||1,g=link(m.servo,`a:${m.name}`);
        out.push(line('double',constant(m.name)+'_ZERO_VOLTS',Number.isFinite(z)?z.toFixed(4):'0.0',Number.isFinite(z)?'':'not set: Point the wheels straight sets it'),line('int',constant(m.name)+'_ENCODER_SIGN',sense,checked?'':'not checked yet'),line('int',constant(m.servo)+'_SERVO_SIGN',(x.pid?.g??g??1)*sense,checked&&(x.pid||g!==null)?'':'not checked yet'));
        // Tuned on this pod, measured on the robot: how hard it comes in, how long a command takes to show, the creep power and its speed, each way (P: positive power, N: negative).
        if(tuned(x)&&x.pid.leadP>0&&x.pid.rP>0){const per=(m.volts||3.3)/360,S=constant(m.servo),k=x.pid;out.push(line('double',S+'_GAIN',k.kP,'degrees a second wanted per degree left'),line('double',S+'_LEAD_P_SECONDS',k.leadP,'a command takes this long to show'),line('double',S+'_LEAD_N_SECONDS',k.leadN),
          line('double',S+'_CREEP_P',k.cP,'the least power that keeps it turning'),line('double',S+'_CREEP_N',k.cN),line('double',S+'_CREEP_P_DEGREES_A_SECOND',+(k.vP/per).toFixed(1)),line('double',S+'_CREEP_N_DEGREES_A_SECOND',+(k.vN/per).toFixed(1)),
          line('double',S+'_DEGREES_A_SECOND_PER_POWER',+(k.slope/per).toFixed(1)),line('double',S+'_TOP_DEGREES_A_SECOND',+(k.vmax/per).toFixed(1)),line('double',S+'_PUSH_P_DEGREES_A_SECOND',+(k.rP/per).toFixed(1),'what a push from rest gives'),line('double',S+'_PUSH_N_DEGREES_A_SECOND',+(k.rN/per).toFixed(1)),
          line('double',S+'_ZONE_DEGREES',+(k.zone/per).toFixed(2),'pushes inside this'),line('double',S+'_EASE_DEGREES',+((k.ease||0)/per).toFixed(2),'at the creep by this far out'),line('double',S+'_STILL_DEGREES_A_SECOND',+(k.still/per).toFixed(1),'slower than this is stopped'),line('double',S+'_PUSH_WAIT_SECONDS',k.lag||.14,'a push takes this long to show'));}}}
    if(steer.length)out.push('',`    public static final double STEER_TOLERANCE_DEGREES = ${bandOf(rec)};`,'',
      '    // The steering loop as tuned here. Make one Steer for each pod with SERVO_SIGN, its numbers from above in that order and','    // STEER_TOLERANCE_DEGREES * 0.6, then every loop (with the hubs\' bulk reads on, about 70 times a second):','    //   double angle = ENCODER_SIGN * (encoder.getVoltage() - ZERO_VOLTS) / STEER_VOLTS_PER_TURN * 360.0;','    //   double error = Steer.wrap(targetDegrees - angle);','    //   servo.setPower(steer.step(error, angle, secondsSinceTheLastStep));','    // Call steer.retarget() when the target jumps. The TeleOp Torque sends (Drive it) runs exactly this.',
      ...((globalThis.DeckChassisTeleop||(typeof require==='function'?require('./sim-chassis-teleop.js'):null))?.steerClass?.()||[]).map(l=>l.replace('    static final class Steer','    public static final class Steer')));
    out.push('}');return out.join('\n');}
  const api={chassisOf,missing,measures,tracker,spotError,driveKeys,wheelSlots,rolls,rollOf,codeOf,podsOf,steerTarget,steerAngle,steerLoop,steerStep,steerState,steerGains,plantOf,gainsOf,stepStats,steady,oscillates,nextTry,bestTry,costOf,searchStart,searchStep,tolOf,TOLS,TOL_DEG,PASS_IN,PUSH_IN,DRIVE_KEYS};
  if(typeof module==='object'&&module.exports){module.exports=api;return;}

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const f=(v,d=1)=>Number.isFinite(v)?(+v).toFixed(d):'—';
  // opts: box, debug (running, start, values, listen, send), project(), save(), C (DeckSimConfig), devices() (DeckLinks.devices), cpr(), toElectronics(), toSimulate(),
  // steerEncoders() (each steering servo's absolute encoder), setSteerZero(zero), setReversed(driveKey, on), config()
  function create(opts){
    const {box,debug}=opts,p=()=>opts.project(),rec=()=>{const c=p().calibration||(p().calibration={});return c.chassis||(c.chassis={});};
    let seenAt=0,track=null,trail=[],pose=null,off=null,queued=false,rollFrom=null,ready='',runs=new Map(),taps=new Map(),told='',sending=false,sent='',spotSaid='';
    const ch=()=>chassisOf(p(),opts.C,{cpr:opts.cpr?.()||537.7});
    const mapNow=()=>({...(rec().map||{}),field:p().robot?.driveStyle==='field'?'yes':'no'});
    const live=()=>!!debug?.running?.();
    const links=()=>(p().calibration?.links||[]);
    const steerOf=c=>c.swerve?(opts.steerEncoders?.()||[]):[];
    const send=line=>debug?.send?.(line),podRec=key=>{const r=rec();r.pods??={};return r.pods[key]??={};};
    // Which way the servo moves its encoder's reading: Electronics' checked link, else taken as rising.
    const gOf=st=>{const l=links().find(x=>x.result?.state==='pass'&&x.effect?.key==='a:'+st.name&&x.causes?.some(c=>c.name===st.servo));return l&&l.effect.dir<0?-1:1;};
    // Every step in order, each locked until the one before it passes. A swerve: straight, then a step a pod. Anything
    // else: its wheels. Distance and the field map only on a robot that measures where it is.
    function states(c,devs){const r=rec(),gone=missing(c,devs),steer=steerOf(c),pods=podsOf(c,steer),pr=r.pods||{},podOk=q=>{const x=pr[q.key]||{};return !!x.drive&&(!q.steer||(tuned(x)&&!!x.left&&!!x.right));};
      const list=gone.length?[['gone',false]]:[...(steer.length?[['steer',!!r.steer],...pods.map(q=>['pod:'+q.key,podOk(q)])]:[['wheels',pods.every(podOk)]]),...(rolls(c)?[['roll',!!r.roll?.ok]]:[]),...(measures(c)==='position'?[['field',!!r.placed]]:[])];
      let open=true,podsOpen=true;const s=list.map(([id,ok])=>{const pod=id.startsWith('pod:'),state=!(pod?podsOpen:open)?'locked':ok?'pass':'todo';if(!ok){open=false;if(!pod)podsOpen=false;}return {id,state};});return {gone,s,steer,pods};}
    const pill=s=>`<span class="rs-pill ${s==='pass'?'ok':s==='locked'?'':'warn'}">${s==='pass'?'Done':s==='locked'?'Locked':'To do'}</span>`;
    function field(){const P=pose,W=144,trailPts=trail.map(q=>`${f(-q.y,2)},${f(-q.x,2)}`).join(' ');
      const grid=Array.from({length:7},(_,i)=>-72+i*24).map(g=>`<line x1="${g}" y1="-72" x2="${g}" y2="72"/><line x1="-72" y1="${g}" x2="72" y2="${g}"/>`).join('');
      const bot=P&&Number.isFinite(P.x)?`<g transform="translate(${f(-P.y,2)} ${f(-P.x,2)}) rotate(${f(-P.h,2)})"><rect x="-9" y="-9" width="18" height="18" rx="2" class="cal-fieldmap-bot"/><path d="M0 -9L-5 -1H5z" class="cal-fieldmap-nose"/></g>`:'';
      return `<svg class="cal-fieldmap" viewBox="${-W/2-2} ${-W/2-2} ${W+4} ${W+4}" role="img" aria-label="The field from the zero point: robot ${P?`${f(P.x)} in forward, ${f(P.y)} in left, heading ${f(P.h)}°`:'not zeroed'}"><g class="cal-fieldmap-grid">${grid}</g><circle r="2" class="cal-fieldmap-zero"/>${trail.length>1?`<polyline points="${trailPts}" class="cal-fieldmap-trail"/>`:''}${bot}</svg>`;}
    function paint(){if(!box)return;const c=ch(),devs=opts.devices(),{gone,s,steer,pods}=states(c,devs),r=rec(),what=measures(c),moving=!!track?.zeroed,now=debug?.values?.()||{};if(live())follow();
      const step=(n,title,state,body)=>`<li class="cal-chassis-step" data-chassis-step="${n}" data-state="${state}"><div class="cal-hub-head"><h4>${n} · ${esc(title)}</h4>${pill(state)}</div>${state==='locked'?'<p class="hint">Finish the step before it first.</p>':body}</li>`;
      // Which part of the robot each missing name is, in words, so the fix is plain: a drive module, the IMU, a pod.
      const role=n=>{const m=c.motors.find(x=>x.name===n);if(m)return c.swerve?`${podName(m.key)} module’s drive motor`:`${podName(m.key)} wheel’s motor`;const q=c.pods.find(x=>x.name===n);if(q)return `${podName(q.key).replace(/^Par/,'Parallel').replace(/^Perp/,'Perpendicular')} odometry pod`;return n===c.imu?'IMU':n===c.pinpoint?'Pinpoint':n===c.otos?'OTOS':'Device';};
      const bGone=`<p class="cal-sense-note bad">Setup calls these by names the Control Hub’s configuration does not have, so Torque cannot drive or read them:</p><ul class="cal-gone-list">${gone.map(n=>`<li><b>${esc(role(n))}</b>: Setup says <code>${esc(n)}</code>, which is not on the hub.</li>`).join('')}</ul><p class="hint">Fix it in Calibrate → Electronics → Setup: pick which real motor, servo and encoder each part is, and Setup takes those names. Or change the drivetrain or position sensing in Setup if this robot is not a ${esc(c.name.split(' · ')[0])} with ${esc(c.locName)}.</p><div class="button-row"><button type="button" class="primary" data-chassis="to-elec">Match them in Electronics</button><button type="button" class="secondary" data-chassis="to-sim">Change it in Setup</button></div>`;
      // One check on one pod or wheel: Torque moves it, then asks what it did. order: the check before it has passed.
      const check=(q,kind,title,how,go,order)=>{const x=(r.pods||{})[q.key]||{},run=runs.get(q.key),done=kind==='tune'?tuned(x):!!x[kind],on=run&&run.kind===kind,other=kind==='left'?'right':'left',can=live()&&!run&&order;
        const body=on&&run.phase==='moving'?`<div class="button-row"><span class="hint" data-chassis-doing data-pod="${esc(q.key)}">${esc(run.note||'Moving…')}</span><button type="button" class="secondary" data-chassis="stop" data-pod="${esc(q.key)}">Stop</button></div>`
          :on&&kind==='drive'?`<p>${Number.isFinite(run.ticks)?`Its encoder counted ${run.ticks>=0?'up':'down'}. `:''}Did the wheel roll forward?</p><div class="button-row"><button type="button" class="primary" data-chassis="yes" data-pod="${esc(q.key)}">Yes, forward</button><button type="button" class="secondary" data-chassis="no" data-pod="${esc(q.key)}">No, backwards</button></div>`
          :on&&run.reached?`<p><span class="rs-pill ok">${f(Math.abs(run.off),1)}° off</span> Its encoder says a quarter turn. Is the wheel pointing to the robot’s ${kind}?</p><div class="button-row"><button type="button" class="primary" data-chassis="yes" data-pod="${esc(q.key)}">Yes, ${kind}</button><button type="button" class="secondary" data-chassis="no" data-pod="${esc(q.key)}">No, it went ${other}</button></div>`
          :on?`<p class="cal-sense-note bad">It stopped ${f(Math.abs(run.off),1)}° ${run.off>0?'past':'short of'} a quarter turn; ${f(run.off>0?tolOf(r).plus:tolOf(r).minus,1)}° is allowed that way. Try it again, tune this pod again, or allow more above.</p><div class="button-row"><button type="button" class="primary" data-chassis="go" data-pod="${esc(q.key)}" data-kind="${kind}">Try again</button><button type="button" class="secondary" data-chassis="stop" data-pod="${esc(q.key)}">Stop</button></div>`
          :`<div class="button-row"><button type="button" class="${done?'secondary':'primary'}" data-chassis="go" data-pod="${esc(q.key)}" data-kind="${kind==='tune'?'deep':kind}"${can?'':' disabled'}>${kind==='tune'?(done?'Tune it again · 2 min':'Tune it · 2 min'):done?'Again':go}</button></div>`;
        return `<li class="cal-pod-check" data-state="${done?'pass':'todo'}"><b>${done?'<i class="cal-elec-tick" aria-label="done">✓</i> ':''}${esc(title)}</b><p class="hint">${esc(how)}</p>${body}</li>`;};
      const tl=tolOf(r),tolPick=(which,label)=>`<div class="cal-field"><label for="cal-tol-${which}">${label}</label><select id="cal-tol-${which}" data-chassis-tol="${which}">${TOLS.map(v=>`<option value="${v}"${v===tl[which]?' selected':''}>${v}°</option>`).join('')}</select></div>`;
      const allowed=`<div class="cal-fields cal-pod-tol">${tolPick('plus','Allowed past the target')}${tolPick('minus','Allowed short of it')}</div>`;
      // Live readings: what they are doing right now, here where they are needed, not only in the Debug tab.
      const ds=debug?.state?.()||{},busy=!live()&&(ds.starting||ds.installing),liveSaid=ds.installing?'Putting Torque Debug on the robot: about a minute, once after Torque updates…':busy?(ds.text||'Starting live readings…'):!live()&&ds.kind==='error'&&ds.text?ds.text:'';
      if(busy&&!paint.waiting){paint.waiting=setTimeout(()=>{paint.waiting=0;paint();},600);}
      const blocks=`<p class="cal-note">Put the robot on blocks, wheels off the floor: these checks move it.</p>${live()?'':`<div class="button-row"><button type="button" class="primary" data-chassis="live"${busy?' disabled':''}>${busy?'Starting…':'Start live readings'}</button></div>${liveSaid?`<p class="hint${ds.kind==='error'&&!busy?' cal-sense-note bad':''}" role="status" data-chassis-live>${esc(liveSaid)}</p>`:''}`}${told?`<p class="hint" role="status">${esc(told)}</p>`:''}`;
      const bPod=q=>{const x=(r.pods||{})[q.key]||{};return `${blocks}${q.steer?allowed:''}<ul class="cal-pod-checks">${q.steer?check(q,'tune','Tune the steering',x.pid&&!tuned(x)?'Tuned with an older Torque, whose loop bounced or stopped short on a quick servo: tune it again.':x.pid?(x.pid.quick?'Tuned enough to use (the tune was cut short): a quarter turn in '+f(x.pid.settle,2)+' s. Tune it again for the full two minutes.':`Tuned and checked both ways: 90° in ${f(x.pid.settle,2)} s${Number.isFinite(x.pid.settle45)?`, 45° in ${f(x.pid.settle45,2)} s`:''}${Number.isFinite(x.pid.settle30)?`, 30° in ${f(x.pid.settle30,2)} s`:''}, each inside ${bandOf(r)}° and holding${x.pid.backed?` (gains eased ${x.pid.backed} time${x.pid.backed>1?'s':''} to hold)`:''}. This pod is good to go.`):'Start with the wheel straight. In about two minutes Torque measures this pod’s friction and speed, then snaps it to 90°, 45° and 30° each way, quicker each time, and keeps the quickest gains that land inside the band and stay. When it finishes the pod is good to go.','Tune it',true)+check(q,'left','Turn left','Passed by the tune. To see it: Torque turns this wheel a quarter turn to the robot’s left and holds it. If it goes right instead, answer No and Torque swaps them.','Turn it left',tuned(x))+check(q,'right','Turn right','Then a quarter turn to the right of straight.','Turn it right',tuned(x)):'<li class="cal-pod-check"><p class="hint">This pod has no absolute encoder in Simulate, so its steering cannot be checked.</p></li>'}${check(q,'drive','Drive forward','The wheel goes back to straight and spins for a second.','Spin the wheel',true)}</ul>`;};
      const bWheels=`<p class="hint">Each drive motor spins for a second. A wheel that rolls backwards is reversed here, so forward means forward on every wheel.</p>${blocks}<ul class="cal-pod-checks">${pods.map(q=>check(q,'drive',`${q.label} · ${q.motor.name}`,q.motor.reversed?'Reversed.':'','Spin it',true)).join('')}</ul>`;
      const spots=r.spots||[],lastSpot=spots.at(-1);
      const b3=what==='nothing'?'<p class="hint">Nothing on this robot measures where it is: add odometry pods, a Pinpoint or an OTOS in Setup → Mechanisms.</p>':
        `<p class="hint">Put the robot on the field, lined up with a tile seam, and press Set zero here: that spot is (0, 0) facing 0°. Then drive or push it around: the map follows it from its sensors (${esc(c.locName)}).${what==='heading'?' This robot only measures its heading.':''}</p>
        ${live()?'':'<div class="button-row"><button type="button" class="primary" data-chassis="live">Start live readings</button></div>'}
        <div class="cal-chassis-map"><div class="cal-fieldmap-box" data-chassis-fieldmap></div><div class="cal-chassis-now"><dl class="cal-stats"><div><dt>Forward</dt><dd data-chassis-now="x"></dd></div><div><dt>Left</dt><dd data-chassis-now="y"></dd></div><div><dt>Heading</dt><dd data-chassis-now="h"></dd></div></dl>
          <div class="button-row"><button type="button" class="secondary" data-chassis="zero"${live()?'':' disabled'}>${moving?'Set zero again':'Set zero here'}</button>${trail.length>1?'<button type="button" class="secondary" data-chassis="clear">Clear the trail</button>':''}</div>
          ${what==='position'?`<p class="hint">Drive it to a spot you can measure from the zero, then type where it really is.</p><div class="cal-fields"><div class="cal-field"><label for="cal-spot-x">Really forward · in</label><input id="cal-spot-x" type="number" step="0.5" data-slider="off" value="${esc(r.draftX??'')}"></div><div class="cal-field"><label for="cal-spot-y">Really left · in</label><input id="cal-spot-y" type="number" step="0.5" data-slider="off" value="${esc(r.draftY??'')}"></div></div>
          <div class="button-row"><button type="button" class="secondary" data-chassis="spot"${moving?'':' disabled'}>Compare</button></div>${spotSaid?`<p class="cal-sense-note bad" role="status">${esc(spotSaid)}</p>`:''}`:''}
          ${lastSpot?`<p class="${spotError(lastSpot.real,lastSpot.read)<=PASS_IN?'hint':'cal-sense-note bad'}">It read ${f(lastSpot.read.x)}, ${f(lastSpot.read.y)} for ${f(lastSpot.real.x)}, ${f(lastSpot.real.y)}: ${f(spotError(lastSpot.real,lastSpot.read),2)} in off.${spotError(lastSpot.real,lastSpot.read)<=PASS_IN?'':' More than an inch: calibrate the heading and pods in Electronics, or check the wheel size in Simulate.'}</p>`:''}
          <div class="button-row">${r.placed?'':`<button type="button" class="primary" data-chassis="placed"${what==='position'?(lastSpot&&spotError(lastSpot.real,lastSpot.read)<=PASS_IN?'':' disabled'):moving?'':' disabled'}>Where it is looks right</button>`}</div></div></div>`;
      const start=live()?'':'<div class="button-row"><button type="button" class="primary" data-chassis="live">Start live readings</button></div>',volts=m=>now['a:'+m.name];
      const bSteer=`<p class="hint">Turn every pod by hand until its wheel points straight ahead, each the same way round (its gear on the same side), then press the button. That reading is each pod’s zero.</p>${start}
        <ul class="cal-sense-rows">${steer.map(m=>`<li><b>${esc(m.label)}</b> <code>${esc(m.name)}</code>: now <span data-chassis-volts="${esc(m.name)}"></span> V${Number.isFinite(r.steer?.zero?.[m.name])?` · zero kept at ${f(r.steer.zero[m.name],3)} V`:''}</li>`).join('')}</ul>
        <div class="button-row"><button type="button" class="${r.steer?'secondary':'primary'}" data-chassis="steer"${live()&&steer.every(m=>Number.isFinite(volts(m)))?'':' disabled'}>${r.steer?'Set straight again':'They all point straight'}</button></div>`;
      const rr=r.roll,rollRows=rr?.rows?`<ul class="cal-sense-rows">${rr.rows.map(x=>`<li>${x.weak||x.backwards?'<span class="rs-pill warn">Fix it</span>':'<span class="rs-pill ok">Good</span>'} <b>${esc(x.name)}</b>: ${x.ticks} ticks${x.weak?'. It hardly counted: check its encoder cable.':x.backwards?'. It counts backwards: reverse this motor in Setup → Mechanisms, or in your code.':''}</li>`).join('')}</ul>
        <p class="cal-sense-result"><b>${f(rr.ticksPerIn,2)}</b> ticks an inch. The motor and wheel size say ${f(rr.expected,2)}: ${f(Math.abs(rr.errorPct),1)}% ${rr.errorPct>=0?'more':'fewer'}${Math.abs(rr.errorPct)>15?'. That far apart, check the drive motor and wheel size in Setup → Mechanisms':''}.</p>`:rr?.problem?`<p class="cal-sense-note bad">${esc(rr.problem)}</p>`:'';
      const bRoll=`<p class="hint">Put the robot on the floor${c.swerve?' with its wheels pointing straight ahead':''}, its back on a tile seam. Press Start, push it straight forward ${PUSH_IN} in (two tiles), then press Done. Torque counts the encoder ticks in an inch of floor, which is what makes a distance in autonomous come out right.</p>${start}
        <div class="button-row">${rollFrom?`<button type="button" class="primary" data-chassis="roll-done">Done</button><button type="button" class="secondary" data-chassis="roll-cancel">Cancel</button><span class="hint">Counted about <span data-chassis-rolled>0.0</span> in</span>`:`<button type="button" class="${rr?.ok?'secondary':'primary'}" data-chassis="roll-start"${live()?'':' disabled'}>${rr?'Measure again':'Start'}</button>`}</div>${rollFrom?'':rollRows}`;
      const code=codeOf({ch:c,rec:r,links:links(),steer,config:opts.config?.()||'',date:new Date().toLocaleDateString('en-CA')});
      const bCode=`<li class="cal-chassis-step" data-chassis-step="code" data-state="info"><div class="cal-hub-head"><h4>Use it in your code</h4></div><p class="hint">Everything checked here, as one class for your robot’s own code. A number not checked yet says so beside it.</p><pre class="cal-cam-code cal-chassis-code" data-chassis-code>${esc(code)}</pre><div class="button-row"><button type="button" class="primary" data-chassis="copy">Copy</button>${opts.saveFile?'<button type="button" class="secondary" data-chassis="save-code">Save as a file…</button>':''}<span class="hint" role="status" data-chassis-saved></span></div></li>`;
      const T=globalThis.DeckChassisTeleop,tele=T?teleop(c,steer):null,map=T?T.mapOf(mapNow()):{},pickMap=(k,label)=>`<div class="cal-field"><label for="cal-map-${k}">${label}</label><select id="cal-map-${k}" data-chassis-map="${k}">${Object.entries(T.MAP[k]).map(([v,t])=>`<option value="${v}"${map[k]===v?' selected':''}>${esc(t)}</option>`).join('')}</select></div>`;
      const bDrive=!T?'':`<li class="cal-chassis-step" data-chassis-step="drive" data-state="info"><div class="cal-hub-head"><h4>Drive it</h4></div><p class="hint">A TeleOp for this chassis alone, written from everything checked here. Send puts it on the robot; it shows in Drive as “${esc(T.OP_MODE)}”. Pick what the controller does first. (Real run writes the whole robot’s, with its mechanisms.)</p>
        <div class="cal-fields cal-drive-map">${pickMap('drive','Drive with')}${pickMap('turn','Turn with')}${pickMap('field','Forward means')}${pickMap('spin','Spin on the spot')}${c.swerve?pickMap('lock','Lock the wheels'):''}${pickMap('slow','Slow button')}${pickMap('reset','Set heading to 0')}</div>
        ${tele.error?`<p class="cal-sense-note bad">${esc(tele.error)}</p>`:s.every(x=>x.state==='pass')?'':'<p class="cal-note">Some checks above are not done yet: what they would set is left as Torque guessed it.</p>'}
        <div class="button-row"><button type="button" class="primary" data-chassis="send"${tele.error||sending?' disabled':''}>${sending?'Sending…':'Send to the robot'}</button>${sent?`<span class="hint" role="status">${esc(sent)}</span>`:''}</div>
        ${tele.source?`<details class="usb-facts"><summary>See the code</summary><pre class="cal-cam-code cal-chassis-code">${esc(tele.source)}</pre></details>`:''}</li>`;
      const podOf=id=>pods.find(q=>'pod:'+q.key===id),title=id=>({gone:'A name in Setup is not on the Control Hub',steer:'Point the wheels straight',wheels:'Wheels roll forward',roll:'How far it rolls',field:'Where it is on the field'})[id]||`${podOf(id).label} pod`,body=id=>({gone:bGone,steer:bSteer,wheels:bWheels,roll:bRoll,field:b3})[id]??bPod(podOf(id));
      const html=`<section class="cal-card cal-chassis"><div class="cal-hub-head"><h2>Chassis</h2>${s.every(x=>x.state==='pass')?'<span class="rs-pill ok">Calibrated</span>':''}</div><ol class="cal-chassis-steps">${s.map((x,i)=>step(i+1,title(x.id),x.state,x.state==='locked'?'':body(x.id))).join('')}${gone.length?'':bCode+bDrive}</ol></section>`;
      if(box.dataset.html!==html){const focus=document.activeElement?.id;box.dataset.html=html;box.innerHTML=html;if(focus)document.getElementById(focus)?.focus();}
      livePaint();}
    // What moves with every reading (the map, where it is, the steering encoders' volts), drawn into its place. The steps
    // around it are rebuilt only when something else changes, so a box being typed in keeps its caret and Calibrate's list
    // keeps one step showing.
    function livePaint(){if(!box)return;const map=box.querySelector('[data-chassis-fieldmap]');if(map){const svg=field();if(map._svg!==svg){map._svg=svg;map.innerHTML=svg;}}
      for(const [k,unit] of [['x',' in'],['y',' in'],['h','°']]){const el=box.querySelector(`[data-chassis-now="${k}"]`);if(el){const t=`${f(pose?.[k])}${unit}`;if(el.textContent!==t)el.textContent=t;}}
      const now=debug?.values?.()||{};for(const el of box.querySelectorAll('[data-chassis-volts]')){const t=f(now['a:'+el.dataset.chassisVolts],3);if(el.textContent!==t)el.textContent=t;}}
    // Live: the pose follows every reading; the map redraws once a frame at most.
    function follow(){if(off||!debug?.listen)return;off=debug.listen((_f,v)=>{
      seenAt=performance.now();for(const fn of taps.values())fn(v,_f);
      for(const el of box.querySelectorAll('[data-chassis-volts]'))el.textContent=f(v['a:'+el.dataset.chassisVolts],3);
      if(rollFrom){const el=box.querySelector('[data-chassis-rolled]'),x=rollOf(ch(),rollFrom,v);if(el)el.textContent=f(Number.isFinite(x.ticksPerIn)?x.ticksPerIn*PUSH_IN/ch().nominalTicksPerIn:0);}
      // A pod on its way to a quarter turn: there once its encoder has stayed within the tolerance, or not after 6 s.
      for(const [podKey,run] of runs){if(run.phase!=='moving'||run.kind==='drive'||run.kind==='tune')continue;const d=steerAngle(v['a:'+run.name],run.target,run.span,run.sense)*(run.kind==='right'?-1:1),t=tolOf(rec());/* d: past the target (+) or short of it (-), the way it was turning */run.hits=d<=t.plus&&d>=-t.minus?run.hits+1:0;
        if(run.hits>=10||performance.now()-run.at>6000){runs.set(podKey,{...run,phase:'ask',reached:run.hits>=10,off:d});if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;paint();});}}}
      const was=ready;ready=steerOf(ch()).map(m=>Number.isFinite(v['a:'+m.name])?1:0).join('');if(ready!==was&&!queued){queued=true;requestAnimationFrame(()=>{queued=false;paint();});}
      if(!track?.zeroed)return;const q=track.update(v);if(!q)return;pose=q;const last=trail.at(-1);if(Number.isFinite(q.x)&&(!last||Math.hypot(q.x-last.x,q.y-last.y)>.5)){trail.push({x:q.x,y:q.y});if(trail.length>600)trail.shift();}
      if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;paint();});}});}
    const save=()=>{opts.save();paint();};
    // The chassis as the TeleOp needs it: each pod with what was checked on it, or each drive motor.
    // What the chassis TeleOp is written from (DeckChassisTeleop.teleopOf's input): Real run adds the mechanisms to it.
    function teleopIn(c,steer){const r=rec(),robot=p().robot||{},L=robot.length||17,W=robot.width||17,at=k=>({x:/front/i.test(k)?L/2:/back/i.test(k)?-L/2:0,y:/left/i.test(k)?W/2:/right/i.test(k)?-W/2:0});
      const measured=r.mount?.[c.imu],setup=opts.C?.hubMounting?.(p().robot||{}),found=measured&&(!setup||measured.logo===setup.hubLogo&&measured.usb===setup.hubUsb)?measured:null,common={robot,imu:{name:c.imu,scale:c.odo?.imu?.scale||1,...(found&&globalThis.DeckHubMount?{mount:globalThis.DeckHubMount.javaOf(found)}:{})},map:mapNow(),config:opts.config?.()||'',date:new Date().toLocaleDateString('en-CA')};
      if(steer.length)return ({...common,kind:'swerve',tolerance:+(bandOf(r)*.6).toFixed(2),pods:podsOf(c,steer).map(q=>{const st=q.steer,x=(r.pods||{})[q.key]||{},per=(st?.volts||3.3)/360,k0=STEER_DEFAULT,pid=tuned(x)&&x.pid.leadP>0&&x.pid.rP>0?x.pid:{...k0,g:x.pid?.g,vP:k0.vP/3.3*(st?.volts||3.3),vN:k0.vN/3.3*(st?.volts||3.3),slope:k0.slope/3.3*(st?.volts||3.3),vmax:k0.vmax/3.3*(st?.volts||3.3),rP:80*per,rN:80*per,zone:8*per,ease:1*per,still:12*per},sense=x.sense||1;
        return {label:q.label,drive:q.motor.name,reversed:q.motor.reversed,servo:st?.servo,encoder:st?.name,...at(q.key),zero:r.steer?.zero?.[st?.name],encoderSign:sense,servoSign:(pid.g??(st?gOf(st):1))*sense,gain:pid.kP,leadP:pid.leadP,leadN:pid.leadN,creepP:pid.cP,creepN:pid.cN,creepSpeedP:+(pid.vP/per).toFixed(1),creepSpeedN:+(pid.vN/per).toFixed(1),
          slope:+(pid.slope/per).toFixed(1),top:+(pid.vmax/per).toFixed(1),pushP:+(pid.rP/per).toFixed(1),pushN:+(pid.rN/per).toFixed(1),zone:+(pid.zone/per).toFixed(2),ease:+((pid.ease||0)/per).toFixed(2),still:+(pid.still/per).toFixed(1),lag:pid.lag||.14,volts:st?.volts||3.3};})});
      return ({...common,kind:c.type==='mecanum'?'mecanum':['tank','tank2'].includes(c.type)?'tank':c.type,motors:c.motors});}
    const teleop=(c,steer)=>globalThis.DeckChassisTeleop.teleopOf(teleopIn(c,steer));
    // One choice of the controller mapping: kept with the chassis's calibration (which way is forward lives in Setup).
    const setMap=(k,v)=>{const r=rec();if(k==='field'){const robot=p().robot;if(robot)robot.driveStyle=v==='yes'?'field':'robot';}else r.map=globalThis.DeckChassisTeleop.mapOf({...r.map,[k]:v});sent='';save();};
    // Holds a pod's wheel at an angle from straight (left positive) with Torque Debug's loop; null with no encoder or no zero.
    function hold(q,deg,pid){const st=q.steer,z=rec().steer?.zero?.[st?.name];if(!st||!Number.isFinite(z))return null;const x=podRec(q.key),span=st.volts||3.3,target=steerTarget(z,deg,span,x.sense||1);pid=pid||(tuned(x)?x.pid:null);send(steerLoop(st,target,pid?.g??gOf(st),span,pid||STEER,bandOf(rec())));return {target,span,name:st.name,sense:x.sense||1};}
    // A pod tunes itself: the least power that moves it and which way (a few degrees), its speed at a steady power, gains
    // from those, then test turns of 45° that are slowed down until one neither swings past nor hunts.
    // A tune never ends silently: if the robot's live readings stop for 3 s, or anything goes wrong, it stops the servo,
    // says why and frees the other checks. The quick search's gains are kept as soon as they are found, so a long tune cut
    // short still leaves the pod tuned (and Turn it left / right open).
    const NO_READINGS='NO_READINGS',noReadings=()=>{if(!live()||performance.now()-seenAt>3000)throw Error(NO_READINGS);};
    // Readings that stop in a tune's first seconds usually mean the robot's program was restarted under it (Torque puts a
    // newer Torque Debug on the robot by itself): the tune waits for them to come back, steadily, and starts again.
    const flowing=async run=>{let since=0;for(const t0=performance.now();performance.now()-t0<75000;){await new Promise(r=>setTimeout(r,150));if(runs.get(run.pod)!==run)return false;
      if(live()&&performance.now()-seenAt<500){since||=performance.now();if(performance.now()-since>2500)return true;}else since=0;}return false;};
    async function tune(q,long=false){for(let attempt=0;;attempt++){const t0=performance.now();try{await tuneBody(q,long);return;}catch(e){const run=runs.get(q.key);if(!run||run.kind!=='tune')return;const st=q.steer;if(st)send(`C\t${st.servo}\t0`);freeFloor(q.key);taps.delete(q.key);
      if(e?.message===NO_READINGS&&attempt<2&&performance.now()-t0<25000){run.note='Waiting for the robot’s readings to come back…';paint();if(await flowing(run))continue;if(runs.get(q.key)!==run)return;}
      runs.delete(q.key);
      const kept=!!podRec(q.key).pid;told=q.label+': '+(e?.message===NO_READINGS?`The robot stopped sending readings partway, so tuning stopped${kept?' (the gains found so far are kept)':''}. Press Start live readings if it shows, then Tune it again.`:`Tuning stopped: ${e?.message||e}.${kept?' The gains found so far are kept.':''} Tune it again.`);paint();return;}}}
    // One pod at a time has the floor. A servo drawing current pushes every pod's encoder voltage up (1.5° at full power,
    // more for an instant), so a pod is measured and judged only while the others are still: pods tuned together take
    // turns, move by move, and each one's two minutes count only its own.
    const floor=[],freeFloor=key=>{const i=floor.indexOf(key);if(i>=0)floor.splice(i,1);};
    const takeFloor=async(key,alive)=>{floor.push(key);const t0=performance.now();for(;;){while(floor.length&&floor[0]!==key&&!runs.has(floor[0]))floor.shift();if(floor[0]===key||!alive())break;await new Promise(r=>setTimeout(r,25));}return performance.now()-t0;};
    let burstId=Math.floor(performance.now())%100000;
    async function tuneBody(q,long=false){const st=q.steer,span=st.volts||3.3,per=span/360,key='a:'+st.name,mine={pod:q.key,kind:'tune',phase:'moving',note:'Reading the encoder at rest…'};runs.set(q.key,mine);const T={},began=performance.now();let waited=0;taps.set(q.key,(v,fr)=>T.tap?.(v,fr));told='';follow();paint();
      const alive=()=>runs.get(q.key)===mine,sleep=ms=>new Promise(r=>setTimeout(r,ms)),short=(a,b)=>{let t=(b-a)/span;t-=Math.round(t);return t*span;},say=t=>{mine.note=t;const el=box.querySelector(`[data-chassis-doing][data-pod="${CSS.escape(q.key)}"]`);if(el)el.textContent=t;};
      const fail=text=>{if(!alive())return;send(`C\t${st.servo}\t0`);freeFloor(q.key);taps.delete(q.key);runs.delete(q.key);told=q.label+': '+text;paint();};
      // Right after Torque Debug is put on the robot again (an update does it) the readings take a few seconds to start.
      if(performance.now()-seenAt>1000){say('Waiting for the robot’s readings to start…');for(const t0=performance.now();alive()&&performance.now()-seenAt>1000&&performance.now()-t0<45000;)await sleep(100);if(!alive())return;
        if(performance.now()-seenAt>1000)return fail('The robot is not sending readings. Press Start live readings if it shows (or check the cable), then tune it again.');await sleep(600);}
      if(floor.length)say('Waiting for the other pod to finish its measuring…');waited+=await takeFloor(q.key,alive);if(!alive())return freeFloor(q.key);
      // First the encoder at rest (servo off): wiggles that small are the encoder, not the wheel.
      say('Reading the encoder at rest…');const still=[];T.tap=v=>{if(Number.isFinite(v[key]))still.push(v[key]);};await sleep(700);T.tap=null;if(!alive())return;
      const noise=still.length>3?Math.min(3,(Math.max(...still.map(x=>short(still[0],x)))-Math.min(...still.map(x=>short(still[0],x))))/per):0,moveV=Math.max(1,noise*2)*per;
      // Then the pod itself, measured on the robot (a burst: one power for a set time, then off), where the timing is exact;
      // through the cable the readings come tens of ms late. v: the reading's speed as the power went off; c: how far it
      // went on after; t: how far in all.
      const burst=async(power,secs)=>{const id=++burstId;let got=null;T.tap=(_v,fr)=>{const b=fr?.bu?.find?.(x=>x.n===id&&x.a===st.servo);if(b?.done)got=b;};
        send(['B',st.servo,'ana:'+st.name,power.toFixed(3),secs,moveV.toFixed(5),span,id].join('\t'));for(const t0=performance.now();alive()&&!got&&performance.now()-t0<secs*1000+1800;await sleep(20))noReadings();T.tap=null;return got;};
      const noBurst='The robot did not answer a test burst. Put Torque Debug on the robot again (Calibrate → Camera and Debug), then tune it again.';
      // The power that starts it, each way: short bursts, 1.5% more each time, until one turns the wheel.
      const startOf=async sign=>{for(let u=.03;u<=.5&&alive();u+=.015){const b=await burst(sign*u,.15);if(!b)return null;if(Math.abs(b.t)>moveV)return {u:+u.toFixed(3),dir:Math.sign(b.t)};}return {u:0,dir:0};};
      say('Finding the power that starts it turning…');const sP=await startOf(1);if(!alive())return;if(!sP)return fail(noBurst);const sN=await startOf(-1);if(!alive())return;if(!sN)return fail(noBurst);
      if(!sP.u&&!sN.u)return fail(`${st.servo} did not move ${st.name} at half power. Check them in Electronics.`);
      const g=sP.u?sP.dir:-sN.dir;
      // The creep: 1% over that, for half a second from rest. It has to keep the wheel turning (20°/s or more), or it gets
      // more. It is kept low: the nudges use it, and a gentle push makes the smallest step.
      const creepOf=async(sign,from)=>{let c=from+.01;for(let i=0;i<5&&alive();i++,c+=.015){const b=await burst(sign*c,.45);if(!b)return null;if(Math.abs(b.v)>=20*per)return {c:+c.toFixed(3),v:Math.abs(b.v)};}return {c:+Math.min(.6,c).toFixed(3),v:20*per};};
      say('Measuring its slowest turn…');const cP=await creepOf(1,sP.u||sN.u);if(!alive())return;if(!cP)return fail(noBurst);const cN=await creepOf(-1,sN.u||sP.u);if(!alive())return;if(!cN)return fail(noBurst);
      // Its speed a tenth of power over the creep (how much speed power buys), then flat out three times each way: the top speed,
      // and how long it takes to stop from it (how far it went on after the power went off, over that speed).
      say('Measuring how fast it turns and stops…');const mids=[];for(const [sign,x] of [[1,cP],[-1,cN]]){const b=await burst(sign*Math.min(1,x.c+.1),.3);if(!alive())return;if(!b)return fail(noBurst);mids.push((Math.abs(b.v)-x.v)/.1);}
      const tops=[],stops={1:[],[-1]:[]};for(const sign of [1,-1,1,-1,1,-1]){const b=await burst(sign,.22);if(!alive())return;if(!b)return fail(noBurst);const v=Math.abs(b.v);if(v>40*per){tops.push(v);stops[sign].push(Math.abs(b.c)/v);}}
      if(!tops.length)return fail(`${st.name} barely moved at full power. Check that the encoder turns with the wheel, then tune it again.`);
      // A push from rest: the creep power for 60 ms, twice each way, turn about. How far the wheel went in all, over that time.
      say('Measuring a push from rest…');const rests={1:[],[-1]:[]};for(const sign of [1,-1,1,-1]){const c=sign>0?cP.c:cN.c;let b=await burst(sign*c,.06),t=.06;if(!alive())return;if(b&&Math.abs(b.t)<=moveV){b=await burst(sign*c,.12);t=.12;if(!alive())return;}if(!b)return fail(noBurst);if(Math.abs(b.t)>moveV)rests[sign].push(Math.abs(b.t)/t);}
      const avg=a=>a.reduce((t,x)=>t+x,0)/a.length,mid=a=>a.length?[...a].sort((x,y)=>x-y)[a.length>>1]:NaN,vmax=avg(tops),slopes=mids.filter(x=>x>50*per),slope=slopes.length?avg(slopes):Math.max(100*per,(vmax-Math.max(cP.v,cN.v))/.3);
      const band=bandOf(rec()),lead0={},base={...steerGains({cP:cP.c,cN:cN.c,vP:Math.min(cP.v,vmax*.5),vN:Math.min(cN.v,vmax*.5),slope,vmax,stopP:mid(stops[1]),stopN:mid(stops[-1]),rP:rests[1].length?avg(rests[1]):NaN,rN:rests[-1].length?avg(rests[-1]):NaN,noise:noise*per,span}),g,trimP:0,trimN:0};lead0.P=base.leadP;lead0.N=base.leadN;
      freeFloor(q.key);
      // Snap tests: the pod is sent straight to each angle at once, as the stick sends it, and has to get there inside the
      // band and stay. One move: over once it has stayed inside the band for watch seconds, 1.6 s more at most. It is judged
      // on the middle of each three readings, while it has the floor.
      let n=0;const med3=(a,b,c)=>Math.max(Math.min(a,b),Math.min(Math.max(a,b),c));
      const turn=async(pid,watch=.3,deg=0)=>{waited+=await takeFloor(q.key,alive);if(!alive()){freeFloor(q.key);return null;}
        const h=hold(q,deg,pid);n++;const raw=[],trace=[],t0=performance.now();let stop=null;T.tap=(v,fr)=>{const x=fr?.ql?.find?.(k=>k.a===st.servo)?.x;if(x&&x[0]>=1&&!stop&&performance.now()-t0>80)stop={err:x[1]/per,way:x[2]>0?'P':'N',full:!!x[3]};if(!Number.isFinite(v[key]))return;raw.push(steerAngle(v[key],h.target,span));const k=raw.length;trace.push([(performance.now()-t0)/1000,k<3?raw[k-1]:med3(raw[k-3],raw[k-2],raw[k-1])]);};
        seenAt=Math.max(seenAt,t0);try{for(;alive()&&performance.now()-t0<1600+watch*1000;await sleep(40)){noReadings();const now=stepStats(trace,band,noise);if(now&&now.settle!==null&&now.held>watch)break;}}finally{T.tap=null;freeFloor(q.key);}
        const stats=stepStats(trace,band,noise);return stats&&{...stats,stop};};
      // A set of moves with one set of gains, counted by its worst move (the slowest to settle, the furthest past, the most
      // crossings): a pod is as quick as its slowest turn, big or small, left or right.
      const worstOf=list=>!list||list.some(x=>!x)?null:{overshoot:Math.max(...list.map(x=>x.overshoot)),crossings:Math.max(...list.map(x=>x.crossings)),settle:list.some(x=>x.settle===null)?null:Math.max(...list.map(x=>x.settle)),held:Math.min(...list.map(x=>x.held)),hunt:Math.max(...list.map(x=>x.hunt||0)),swing:Math.max(...list.map(x=>x.swing||0)),...(noise?{noise:+noise.toFixed(2)}:{})};
      const moves=async(pid,list,watch=.3)=>{const out=[];for(const d of list){if(!alive())return null;const far=Math.abs(d-at0)>=80,way=wayOf(d),x=await turn(pid,watch,d);if(!x)return null;out.push({...x,way,far});}return out;};
      // A move landed when it got inside the band and stayed for as long as it was watched, without swinging far past or
      // going back and forth. Coming back from a little past still counts: what matters is how soon it is there for good.
      // (This pod's smallest step is about a degree, so a landing is sometimes one nudge long.)
      const far=Math.max(6,band*3),landed=(x,hold)=>!!x&&x.settle!==null&&(x.held??hold)>=hold&&x.overshoot<=far&&x.crossings<=4&&!((x.hunt||0)>=4&&(x.swing||0)>Math.max(.6,2*(x.noise||0)));
      const cost1=(x,hold)=>!x?9:!landed(x,hold)?5+x.overshoot*.1+x.crossings*.2:x.settle+Math.max(0,x.overshoot-band)*.04;
      const good=(list,watch)=>!!list&&list.length>0&&list.every(x=>landed(x,watch*.8)),costSet=(list,watch)=>!list?9:!list.length?0:(good(list,watch)?0:5)+Math.max(...list.map(x=>cost1(x,watch*.8)))*.5+list.reduce((t,x)=>t+cost1(x,watch*.8),0)/list.length*.5,costWay=(list,watch,way)=>costSet(list.filter(x=>x.way===way),watch);
      // What the search moves: a trim on each way's stop time (a longer one brakes sooner). Which way a move needs the
      // servo's power is known from its angles, so each set of moves scores the two trims separately.
      const S90=[90,0,-90,0],S45=[45,0,-45,0],S30=[30,0,-30,0],TRIM=[-.03,.06],sense=podRec(q.key).sense||1;
      const gains=(pid,tP,tN)=>{const c=t=>+Math.max(TRIM[0],Math.min(TRIM[1],t)).toFixed(4),lead=x=>+Math.max(LEAD[0],Math.min(LEAD[1],x)).toFixed(4);tP=c(tP);tN=c(tN);return {...pid,trimP:tP,trimN:tN,leadP:lead(lead0.P+tP),leadN:lead(lead0.N+tN)};};
      let at0=0;const wayOf=deg=>{const w=g*sense*Math.sign(deg-at0)>=0?'P':'N';at0=deg;return w;};
      const log=(what,pid,stats)=>{(globalThis.__torqueTuneLog??=[]).push({pod:q.key,t:+((performance.now()-began)/1000).toFixed(1),what,pid:pid&&{K:pid.kP,trim:`${pid.trimP}/${pid.trimN}`,leadP:pid.leadP,leadN:pid.leadN},stats});};log('measured',base,{sP,sN,cP,cN,rests,mids:mids.map(x=>+(x/per).toFixed(0)),tops:tops.map(x=>+(x/per).toFixed(0)),stops,noise,base});
      await turn(base,.2,0);if(!alive())return;
      // The stop times are corrected straight from where the braking stops land (the robot reports each one): a full-speed
      // approach should leave the wheel a degree short, where one small push or none finishes it. Each way's stop time
      // moves by the miss over the top speed, part of the way each time, so one odd stop does not throw it.
      const AIM=1,fix=(pid,list,part)=>{const t={P:pid.trimP,N:pid.trimN};for(const w of ['P','N']){const errs=list.filter(x=>x.stop&&x.stop.full&&x.stop.way===w).map(x=>x.stop.err);if(errs.length)t[w]+=Math.max(-.012,Math.min(.012,part*(AIM-avg(errs))*per/vmax));}return gains(pid,t.P,t.N);};
      // First, numbers that land the quarter turns at all, correcting as it goes.
      let first=null,lastSet=null;
      for(let pid=base,i=0;i<7&&alive();i++){say(`Quarter turns, try ${i+1}…`);const list=await moves(pid,S90,.3);if(!alive()||!list)return;lastSet=worstOf(list);log('first '+(i+1),pid,{stops:list.filter(x=>x.stop?.full).map(x=>x.stop.way+f(x.stop.err,1)).join(' '),set:list});
        if(good(list,.3)){first={pid,stats:lastSet,cost:costSet(list,.3),list};break;}
        pid=fix(pid,list,.8);}
      if(!alive())return;
      if(!first){hold(q,0,base);return fail(`It could not stop inside ${band}° and stay: the last turn went ${f(lastSet?.overshoot,1)}° past and crossed ${lastSet?.crossings??0} times. This pod’s smallest step looks bigger than ${band}°: allow more above (try ${Math.min(5,band*2)}°), or check that it turns freely and its encoder is tight, then tune it again.`);}
      // Kept at once, and the pod is good to go from here: it has just turned a quarter turn each way, landed inside the
      // band and stayed, which is what Turn left and Turn right check. A tune cut short after this still leaves it working.
      const keep=(pid,more)=>{const {trimP,trimN,...k}=pid;return {...k,v:PID_V,vmaxDeg:Math.round(vmax/per),turns:n,noise:+noise.toFixed(2),...more};};
      {const x=podRec(q.key);x.pid=keep(first.pid,{settle:first.stats.settle,overshoot:first.stats.overshoot,quick:true});x.left=true;x.right=true;opts.save();}
      // Then three stages inside the two minutes: quarter turns, then 45°, then 30° (each with a quarter turn in every
      // test), the stop times corrected after every set, by less each stage as they close in.
      const at=()=>(performance.now()-began-waited)/1000,left=()=>Math.max(0,Math.ceil(120-at()));
      let top={pid:fix(first.pid,first.list,.6),stats:first.stats,cost:first.cost};
      for(const [name,list,until,part] of [['90°',S90,44,.5],['45°',[...S45,90,0],66,.35],['30°',[...S30,-90,0],88,.25]]){if(!alive())return;
        while(alive()&&at()<until){say(`Snapping to ${name} and back · ${left()} s left · slowest move ${f(top.stats.settle,2)} s`);
          const set=await moves(top.pid,list,.25);if(!alive()||!set)return;log('stage '+name,top.pid,{cost:costSet(set,.25).toFixed(2),stops:set.filter(x=>x.stop?.full).map(x=>x.stop.way+f(x.stop.err,1)).join(' '),set});
          top={pid:fix(top.pid,set,part),stats:worstOf(set),cost:costSet(set,.25)};}}
      if(!alive())return;
      // The last word: every move again with the chosen numbers, each watched for a good half second after it arrives. If
      // any does not land and stay, the stop times are corrected once more and it is checked again; the set that did best is kept.
      const ALL=[...S90,...S45,...S30],CHECK=[...S90,...S30];let done=null,backed=0,tried=[];
      for(let pid=top.pid;alive()&&backed<=2;backed++){
        say(`Checking every move holds${backed?`, again`:''}…`);const set=await moves(pid,backed?CHECK:ALL,.7);if(!alive()||!set)return;log('check '+backed,pid,set);
        const missed=set.filter(x=>!landed(x,.5)).length;tried.push({pid,set,missed,cost:costSet(set,.7),full:!backed});if(!missed)break;
        pid=fix(pid,set,.5);}
      if(!alive())return;
      done=tried.sort((a,b)=>a.missed-b.missed||a.cost-b.cost)[0];backed=tried.indexOf(done);const slowOnes=done.set.filter(x=>!landed(x,.5));
      // Done: the pod is good to go (it has been since the quarter turns first landed). When a move was still slow to
      // settle in the last check, the pod is tuned all the same, and it says so, so the team can look at that spot.
      const settled=list=>list.filter(x=>x.settle!==null),slow=list=>settled(list).length?Math.max(...settled(list).map(x=>x.settle)):null,st90=slow(done.set.slice(0,4)),st45=done.full?slow(done.set.slice(4,8)):null,st30=slow(done.set.slice(done.full?8:4)),all=worstOf(done.set);
      const x=podRec(q.key);x.pid=keep(done.pid,{...(st90!==null?{settle:+st90.toFixed(2)}:{}),...(st45!==null?{settle45:+st45.toFixed(2)}:{}),...(st30!==null?{settle30:+st30.toFixed(2)}:{}),overshoot:all.overshoot,hunt:all.hunt,swing:all.swing,...(backed?{backed}:{}),...(slowOnes.length?{slow:slowOnes.length}:{}),secs:Math.round(at())});
      x.left=true;x.right=true;hold(q,0);freeFloor(q.key);taps.delete(q.key);runs.delete(q.key);
      if(slowOnes.length)told=`${q.label}: tuned and good to go. ${slowOnes.length} of the last ${done.set.length} test moves took longer than usual to settle inside ${band}° (a tight spot in the pod’s turn does that): tune it again, or allow more above, if it should be quicker.`;
      save();}
    // Stopping one pod stops only its servo and motor; with no pod, everything (the TeleOp send, leaving the page).
    const stop=key=>{if(key){const r=runs.get(key);if(!r)return;clearInterval(r.timer);runs.delete(key);taps.delete(key);freeFloor(key);const c=ch(),q=podsOf(c,steerOf(c)).find(x=>x.key===key);if(q?.steer)send(`C\t${q.steer.servo}\t0`);if(q)send(`M\t${q.motor.name}\t0`);return;}
      for(const r of runs.values())clearInterval(r.timer);runs.clear();taps.clear();floor.length=0;send('X');};
    // Each pod's checks run on their own: several pods can be tuned, turned or spun at once.
    function go(q,kind){told='';if(runs.has(q.key))return;if(kind==='tune'||kind==='deep')return void tune(q,kind==='deep');
      if(kind!=='drive'){const h=hold(q,kind==='left'?90:-90);if(!h)return;runs.set(q.key,{pod:q.key,kind,phase:'moving',hits:0,at:performance.now(),...h});follow();return paint();}
      // The wheel, straight, at a third of its power for about a second; the power is sent again before the robot's watchdog lets go.
      hold(q,0);const m=q.motor,dir=m.reversed?-1:1,key=`m:${m.name}:pos`,from=debug.values()[key];let n=0;const mine={pod:q.key,kind,phase:'moving'};runs.set(q.key,mine);
      mine.timer=setInterval(()=>{if(runs.get(q.key)!==mine){clearInterval(mine.timer);return;}if(++n<=8)return void send(`M\t${m.name}\t${(.3*dir).toFixed(2)}`);
        clearInterval(mine.timer);send(`M\t${m.name}\t0`);runs.set(q.key,{...mine,phase:'ask',ticks:(debug.values()[key]-from)*dir});paint();},120);paint();}
    function answer(yes,key){const run=runs.get(key),c=ch(),q=podsOf(c,steerOf(c)).find(x=>x.key===key);if(!q||!run)return;const x=podRec(q.key),kind=run.kind;
      if(kind==='drive'){if(yes){x.drive=true;x.enc=Number.isFinite(run.ticks)&&run.ticks<0?-1:1;opts.setReversed?.(q.motor.key,!!q.motor.reversed);}else{delete x.drive;opts.setReversed?.(q.motor.key,!q.motor.reversed);told=`${q.label}: ${q.motor.name} is reversed now. Spin it again to check.`;}}
      // Turned the other way: Torque had this pod's left and right swapped. Its sense is turned round and both turns are checked again.
      else if(yes)x[kind]=true;else{x.sense=-(x.sense||1);delete x.left;delete x.right;told=`${q.label}: left and right were swapped for this pod: corrected. Turn it left again to check.`;}
      runs.delete(key);if(kind!=='drive')hold(q,0);else send(`M\t${q.motor.name}\t0`);save();}
    box?.addEventListener('change',e=>{const k=e.target.dataset?.chassisMap;if(k)return setMap(k,e.target.value);
      const which=e.target.dataset?.chassisTol;if(!which)return;const r=rec();r.tol={...tolOf(r),[which]:+e.target.value};for(const x of Object.values(r.pods||{})){delete x.left;delete x.right;}save();});
    box?.addEventListener('input',e=>{const r=rec();if(e.target.id==='cal-spot-x')r.draftX=e.target.value;if(e.target.id==='cal-spot-y')r.draftY=e.target.value;});
    box?.addEventListener('click',e=>{const b=e.target.closest('[data-chassis]');if(!b)return;const r=rec(),a=b.dataset.chassis;
      if(a==='go'){const c=ch(),q=podsOf(c,steerOf(c)).find(x=>x.key===b.dataset.pod);return q?go(q,b.dataset.kind):undefined;}
      if(a==='yes'||a==='no')return answer(a==='yes',b.dataset.pod);if(a==='stop'){stop(b.dataset.pod);return paint();}
      if(a==='send'){const c=ch(),t=teleop(c,steerOf(c));if(t.error||sending)return;stop();sending=true;sent='';paint();
        return void Promise.resolve(opts.sendTeleop?.(t)).then(text=>{sent=text||'Sent.';},e=>{sent=`It did not get there: ${e?.message||e}`;}).finally(()=>{sending=false;paint();});}
      if(a==='to-sim')return opts.toSimulate?.();if(a==='to-elec')return opts.toElectronics?.();if(a==='live')return void debug?.start?.();
      if(a==='zero'){spotSaid='';track=tracker(ch());if(!track.zero(debug.values()))return void(b.textContent='No readings yet: try again');pose={x:0,y:0,h:0};trail=[{x:0,y:0}];delete r.placed;follow();return save();}
      if(a==='clear'){trail=pose&&Number.isFinite(pose.x)?[{x:pose.x,y:pose.y}]:[];return paint();}
      if(a==='spot'){const blank=v=>v===undefined||v===null||String(v).trim()==='',bx=blank(r.draftX),by=blank(r.draftY);
        if(!pose||!Number.isFinite(pose.x)){spotSaid='Set zero first, then drive it to the spot.';return paint();}
        if(bx&&by){spotSaid='Type how far forward (and left) it really is first.';paint();return void box.querySelector('#cal-spot-x')?.focus();}
        const x=bx?0:+r.draftX,y=by?0:+r.draftY;if(!Number.isFinite(x)||!Number.isFinite(y)){spotSaid='Type the distances in inches, as numbers.';return paint();}spotSaid='';r.spots=[...(r.spots||[]),{real:{x,y},read:{x:+pose.x.toFixed(2),y:+pose.y.toFixed(2),h:+pose.h.toFixed(1)},at:new Date().toISOString()}].slice(-10);return save();}
      if(a==='placed'){r.placed=new Date().toISOString();return save();}
      if(a==='steer'){const v=debug.values(),zero={};for(const m of steerOf(ch())){if(!Number.isFinite(v['a:'+m.name]))return void(b.textContent='No readings yet: try again');zero[m.name]=+v['a:'+m.name].toFixed(4);}
        r.steer={at:new Date().toISOString(),zero};for(const x of Object.values(r.pods||{})){delete x.left;delete x.right;}opts.setSteerZero?.(zero);return save();}
      if(a==='roll-start'){rollFrom={...debug.values()};follow();return paint();}
      if(a==='roll-cancel'){rollFrom=null;return paint();}
      if(a==='roll-done'){const c=chassisOf({...p(),calibration:{}},opts.C,{cpr:opts.cpr?.()||537.7});r.roll={...rollOf(c,rollFrom,debug.values()),at:new Date().toISOString()};rollFrom=null;return save();}
      if(a==='save-code'){const t=box.querySelector('[data-chassis-code]')?.textContent||'',note=box.querySelector('[data-chassis-saved]');return void Promise.resolve(opts.saveFile('TorqueCalibration.java',t)).then(f=>{if(note)note.textContent=f?`Saved to ${f}`:'';},e=>{if(note)note.textContent=`It was not saved: ${e?.message||e}`;});}
      if(a==='copy'){const t=box.querySelector('[data-chassis-code]')?.textContent||'';return void navigator.clipboard?.writeText(t).then(()=>{b.textContent='Copied';},()=>{b.textContent='Select it and copy';});}});
    const checked=()=>{const r=rec();return !!(r.steer||r.roll?.ok||Object.values(r.pods||{}).some(x=>x.drive||x.pid));};
    return {refresh:paint,code:()=>{if(!checked())return null;const c=ch();return codeOf({ch:c,rec:rec(),links:links(),steer:steerOf(c),config:opts.config?.()||'',date:new Date().toLocaleDateString('en-CA')});},
      // For Real run's TeleOp: what the chassis part is written from, its controller mapping, and whether it steers its wheels.
      teleopInput:()=>{const c=ch();return c?teleopIn(c,steerOf(c)):null;},map:()=>globalThis.DeckChassisTeleop.mapOf(mapNow()),setMap,swerve:()=>!!ch()?.swerve,values:()=>JSON.parse(JSON.stringify(rec())),busy:()=>runs.size>0};}
  root.DeckChassisCal={...api,create};
})(typeof globalThis==='object'?globalThis:this);
