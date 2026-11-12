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
  const driveKeys=type=>DRIVE_OF[type]||['frontLeft','frontRight','backLeft','backRight'];
  // Everything the chassis needs, from the setup: names as the robot's configuration calls them.
  // project: the setup; C: DeckSimConfig; cpr: drive encoder counts a motor turn.
  function chassisOf(project,C,{cpr=537.7}={}){
    const r=project.robot||{},dev=k=>r.devices?.[k]?.name||k,type=r.drivetrain||'mecanum',drive=C?.drives?.[type]||{name:type},loc=project.sensors?.localization||'encoders',odo=C?.odometryOf?C.odometryOf(r):{pods:{},pinpoint:{},otos:{},imu:{scale:1}};
    const motors=driveKeys(type).map(k=>({key:k,name:dev(k),reversed:!!r.devices?.[k]?.reversed}));
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
  const steerLoop=(st,target,g,span,pid=STEER,tolDeg=TOL_DEG)=>['Q',st.servo,'ana:'+st.name,'pos',target.toFixed(4),(pid.kP*g).toFixed(3),((pid.kI||0)*g).toFixed(3),(pid.kD*g).toFixed(4),0,(pid.kS*g).toFixed(3),0,(tolDeg*.6/360*span).toFixed(4),span].join('\t');
  // How far off a turn may stop, set by the team: plus is past the target, minus short of it, the way the wheel was turning.
  const TOLS=[.5,1,1.5,2,3,5],tolOf=rec=>{const t=rec?.tol||{},ok=v=>TOLS.includes(v)?v:TOL_DEG;return {plus:ok(t.plus),minus:ok(t.minus)};},bandOf=rec=>{const t=tolOf(rec);return Math.min(t.plus,t.minus);};
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
  // moving, added whenever it is outside the tolerance, so it does not stop short.
  function gainsOf({Kv,L,breakaway=0,span=3.3}){const kP=Math.max(.1,Math.min(.6/(span/4),.3/(Kv*L)));return {kP:+kP.toFixed(3),kD:+(kP*L*.25).toFixed(4),kS:+Math.max(0,breakaway*.6).toFixed(3)};}
  // One test turn: how far past the target it swung, how many times it crossed it, and when it stayed inside the tolerance.
  // trace: [[seconds, degrees from the target]].
  function stepStats(trace,tol=TOL_DEG){if(!trace?.length)return null;const from=Math.sign(trace[0][1])||1;let over=0,crossings=0,side=from,settle=null;
    for(const [t,e] of trace){if(-from*e>over)over=-from*e;const now=Math.abs(e)>tol/3?Math.sign(e):side;if(now!==side){crossings++;side=now;}if(Math.abs(e)<=tol){if(settle===null)settle=t;}else settle=null;}
    // After it arrived: how long it stayed inside the tolerance (held), how far it still moved there (swing), and how many
    // times it turned back on itself (hunt). A wheel that keeps reversing by a quarter of a degree or more is hunting, even
    // inside the tolerance: gains like that buzz the servo and wear the pod.
    let hunt=0,swing=0,held=0;if(settle!==null){const after=trace.filter(([t])=>t>=settle).map(x=>x[1]),step=Math.max(.25,tol*.2);held=trace.at(-1)[0]-settle;
      if(after.length>2){const late=after.slice(Math.floor(after.length/2));swing=Math.max(...late)-Math.min(...late);let dir=0,ref=after[0];for(const e of after){const d=e-ref;if(Math.abs(d)>=step){const now=Math.sign(d);if(dir&&now!==dir)hunt++;dir=now;ref=e;}}}}
    return {overshoot:+over.toFixed(2),crossings,settle:settle===null?null:+settle.toFixed(2),held:+held.toFixed(2),hunt,swing:+swing.toFixed(2)};}
  // Oscillating: it crossed the target more than twice on the way in, or it is hunting where it stopped.
  const oscillates=x=>!!x&&(x.crossings>2||(x.hunt||0)>=3&&(x.swing||0)>.6);
  // Steady: it arrived, stayed there for as long as it was watched (hold seconds), did not swing far past, and is not oscillating.
  const steady=(x,hold=.25)=>!!x&&x.settle!==null&&(x.held??hold)>=hold&&x.overshoot<=3&&!oscillates(x);
  // The search for the quickest gains that stay accurate. tries: [{pid, stats}] of quarter turns so far, each steady or
  // not. From the measured gains it goes up a third at a time until a turn swings past or hunts, and stops there; if the
  // first was already too much it comes down instead. null when there is nothing more to try. The quickest steady one wins.
  const KP_MAX=4;
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
        // Tuned on this pod: power = KP * error + KD * error's speed, plus KS towards the target while outside the tolerance. Error in degrees.
        if(x.pid){const per=(m.volts||3.3)/360;out.push(line('double',constant(m.servo)+'_KP',+(x.pid.kP*per).toFixed(5),'power per degree'),line('double',constant(m.servo)+'_KI',+((x.pid.kI||0)*per).toFixed(6),'power per degree-second'),line('double',constant(m.servo)+'_KD',+(x.pid.kD*per).toFixed(6),'power per degree a second'),line('double',constant(m.servo)+'_KS',x.pid.kS,'power, towards the target'));}}}
    if(steer.length)out.push('',`    public static final double STEER_TOLERANCE_DEGREES = ${bandOf(rec)};`,'',
      '    // The steering loop as tuned here: the servo power that turns a wheel to targetDegrees (left positive).','    // Call it every loop of your teleop or autonomous with that pod\'s own numbers from above.',
      '    public static double steerPower(double volts, double targetDegrees, double zeroVolts, int encoderSign, int servoSign, double kP, double kS) {',
      '        double angle = encoderSign * (volts - zeroVolts) / STEER_VOLTS_PER_TURN * 360.0;','        double error = targetDegrees - angle;','        error -= 360.0 * Math.round(error / 360.0); // the short way round',
      '        if (Math.abs(error) <= STEER_TOLERANCE_DEGREES) return 0;','        return servoSign * (kP * error + kS * Math.signum(error));','    }');
    out.push('}');return out.join('\n');}
  const api={chassisOf,missing,measures,tracker,spotError,driveKeys,wheelSlots,rolls,rollOf,codeOf,podsOf,steerTarget,steerAngle,steerLoop,plantOf,gainsOf,stepStats,steady,oscillates,nextTry,bestTry,costOf,searchStart,searchStep,tolOf,TOLS,TOL_DEG,PASS_IN,PUSH_IN,DRIVE_KEYS};
  if(typeof module==='object'&&module.exports){module.exports=api;return;}

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const f=(v,d=1)=>Number.isFinite(v)?(+v).toFixed(d):'—';
  // opts: box, debug (running, start, values, listen, send), project(), save(), C (DeckSimConfig), devices() (DeckLinks.devices), cpr(), toElectronics(), toSimulate(),
  // steerEncoders() (each steering servo's absolute encoder), setSteerZero(zero), setReversed(driveKey, on), config()
  function create(opts){
    const {box,debug}=opts,p=()=>opts.project(),rec=()=>{const c=p().calibration||(p().calibration={});return c.chassis||(c.chassis={});};
    let track=null,trail=[],pose=null,off=null,queued=false,rollFrom=null,ready='',run=null,timer=null,told='',tap=null,sending=false,sent='';
    const ch=()=>chassisOf(p(),opts.C,{cpr:opts.cpr?.()||537.7});
    const live=()=>!!debug?.running?.();
    const links=()=>(p().calibration?.links||[]);
    const steerOf=c=>c.swerve?(opts.steerEncoders?.()||[]):[];
    const send=line=>debug?.send?.(line),podRec=key=>{const r=rec();r.pods??={};return r.pods[key]??={};};
    // Which way the servo moves its encoder's reading: Electronics' checked link, else taken as rising.
    const gOf=st=>{const l=links().find(x=>x.result?.state==='pass'&&x.effect?.key==='a:'+st.name&&x.causes?.some(c=>c.name===st.servo));return l&&l.effect.dir<0?-1:1;};
    // Every step in order, each locked until the one before it passes. A swerve: straight, then a step a pod. Anything
    // else: its wheels. Distance and the field map only on a robot that measures where it is.
    function states(c,devs){const r=rec(),gone=missing(c,devs),steer=steerOf(c),pods=podsOf(c,steer),pr=r.pods||{},podOk=q=>{const x=pr[q.key]||{};return !!x.drive&&(!q.steer||(!!x.pid&&!!x.left&&!!x.right));};
      const list=gone.length?[['gone',false]]:[...(steer.length?[['steer',!!r.steer],...pods.map(q=>['pod:'+q.key,podOk(q)])]:[['wheels',pods.every(podOk)]]),...(rolls(c)?[['roll',!!r.roll?.ok]]:[]),...(measures(c)==='position'?[['field',!!r.placed]]:[])];
      let open=true,podsOpen=true;const s=list.map(([id,ok])=>{const pod=id.startsWith('pod:'),state=!(pod?podsOpen:open)?'locked':ok?'pass':'todo';if(!ok){open=false;if(!pod)podsOpen=false;}return {id,state};});return {gone,s,steer,pods};}
    const pill=s=>`<span class="rs-pill ${s==='pass'?'ok':s==='locked'?'':'warn'}">${s==='pass'?'Done':s==='locked'?'Locked':'To do'}</span>`;
    function field(){const P=pose,W=144,trailPts=trail.map(q=>`${f(-q.y,2)},${f(-q.x,2)}`).join(' ');
      const grid=Array.from({length:7},(_,i)=>-72+i*24).map(g=>`<line x1="${g}" y1="-72" x2="${g}" y2="72"/><line x1="-72" y1="${g}" x2="72" y2="${g}"/>`).join('');
      const bot=P&&Number.isFinite(P.x)?`<g transform="translate(${f(-P.y,2)} ${f(-P.x,2)}) rotate(${f(-P.h,2)})"><rect x="-9" y="-9" width="18" height="18" rx="2" class="cal-fieldmap-bot"/><path d="M0 -9L-5 -1H5z" class="cal-fieldmap-nose"/></g>`:'';
      return `<svg class="cal-fieldmap" viewBox="${-W/2-2} ${-W/2-2} ${W+4} ${W+4}" role="img" aria-label="The field from the zero point: robot ${P?`${f(P.x)} in forward, ${f(P.y)} in left, heading ${f(P.h)}°`:'not zeroed'}"><g class="cal-fieldmap-grid">${grid}</g><circle r="2" class="cal-fieldmap-zero"/>${trail.length>1?`<polyline points="${trailPts}" class="cal-fieldmap-trail"/>`:''}${bot}</svg>`;}
    function paint(){if(!box)return;const c=ch(),devs=opts.devices(),{gone,s,steer,pods}=states(c,devs),r=rec(),what=measures(c),moving=!!track?.zeroed,now=debug?.values?.()||{};if(live())follow();
      const step=(n,title,state,body)=>`<li class="cal-chassis-step" data-chassis-step="${n}" data-state="${state}"><div class="cal-hub-head"><h4>${n} · ${esc(title)}</h4>${pill(state)}</div>${state==='locked'?'<p class="hint">Finish the step before it first.</p>':body}</li>`;
      const bGone=`<p class="cal-sense-note bad">Not on the robot: ${gone.map(esc).join(', ')}. Simulate says this is a ${esc(c.name)} with ${esc(c.locName)}. In Simulate → Setup, pick the drivetrain, position sensing and names this robot really has, or read the Control Hub again.</p><div class="button-row"><button type="button" class="primary" data-chassis="to-sim">Change it in Simulate</button><button type="button" class="secondary" data-chassis="to-elec">Open Electronics</button></div>`;
      // One check on one pod or wheel: Torque moves it, then asks what it did. order: the check before it has passed.
      const check=(q,kind,title,how,go,order)=>{const x=(r.pods||{})[q.key]||{},done=kind==='tune'?!!x.pid:!!x[kind],on=run&&run.pod===q.key&&run.kind===kind,other=kind==='left'?'right':'left',can=live()&&!run&&order;
        const body=on&&run.phase==='moving'?`<div class="button-row"><span class="hint" data-chassis-doing>${esc(run.note||'Moving…')}</span><button type="button" class="secondary" data-chassis="stop">Stop</button></div>`
          :on&&kind==='drive'?`<p>${Number.isFinite(run.ticks)?`Its encoder counted ${run.ticks>=0?'up':'down'}. `:''}Did the wheel roll forward?</p><div class="button-row"><button type="button" class="primary" data-chassis="yes">Yes, forward</button><button type="button" class="secondary" data-chassis="no">No, backwards</button></div>`
          :on&&run.reached?`<p><span class="rs-pill ok">${f(Math.abs(run.off),1)}° off</span> Its encoder says a quarter turn. Is the wheel pointing to the robot’s ${kind}?</p><div class="button-row"><button type="button" class="primary" data-chassis="yes">Yes, ${kind}</button><button type="button" class="secondary" data-chassis="no">No, it went ${other}</button></div>`
          :on?`<p class="cal-sense-note bad">It stopped ${f(Math.abs(run.off),1)}° ${run.off>0?'past':'short of'} a quarter turn; ${f(run.off>0?tolOf(r).plus:tolOf(r).minus,1)}° is allowed that way. Try it again, tune this pod again, or allow more above.</p><div class="button-row"><button type="button" class="primary" data-chassis="go" data-pod="${esc(q.key)}" data-kind="${kind}">Try again</button><button type="button" class="secondary" data-chassis="stop">Stop</button></div>`
          :`<div class="button-row"><button type="button" class="${done?'secondary':'primary'}" data-chassis="go" data-pod="${esc(q.key)}" data-kind="${kind}"${can?'':' disabled'}>${done?'Again':go}</button>${kind==='tune'?`<button type="button" class="secondary" data-chassis="go" data-pod="${esc(q.key)}" data-kind="deep"${can?'':' disabled'}>Tune it hard · 2 min</button>`:''}</div>`;
        return `<li class="cal-pod-check" data-state="${done?'pass':'todo'}"><b>${done?'<i class="cal-elec-tick" aria-label="done">✓</i> ':''}${esc(title)}</b><p class="hint">${esc(how)}</p>${body}</li>`;};
      const tl=tolOf(r),tolPick=(which,label)=>`<div class="cal-field"><label for="cal-tol-${which}">${label}</label><select id="cal-tol-${which}" data-chassis-tol="${which}">${TOLS.map(v=>`<option value="${v}"${v===tl[which]?' selected':''}>${v}°</option>`).join('')}</select></div>`;
      const allowed=`<div class="cal-fields cal-pod-tol">${tolPick('plus','Allowed past the target')}${tolPick('minus','Allowed short of it')}</div>`;
      const blocks=`<p class="cal-note">Put the robot on blocks, wheels off the floor: these checks move it.</p>${live()?'':'<div class="button-row"><button type="button" class="primary" data-chassis="live">Start live readings</button></div>'}${told?`<p class="hint" role="status">${esc(told)}</p>`:''}`;
      const bPod=q=>{const x=(r.pods||{})[q.key]||{};return `${blocks}${q.steer?allowed:''}<ul class="cal-pod-checks">${q.steer?check(q,'tune','Tune the steering',x.pid?`As fast as this pod stays accurate: a quarter turn in ${f(x.pid.settle,2)} s, ${f(x.pid.overshoot,1)}° past${x.pid.long?', tuned hard':''}. Held still for 2 s with no oscillation${x.pid.backed?` after the gains came down ${x.pid.backed} time${x.pid.backed>1?'s':''}`:''}. Tune it hard spends two minutes trying all three gains up and down for a quicker one.`:'Start with the wheel straight. Torque measures this pod’s servo, then makes quarter turns faster and faster until one swings past or hunts, and keeps the quickest that stays accurate.','Tune it',true)+check(q,'left','Turn left','Torque turns this wheel a quarter turn to the robot’s left and holds it there.','Turn it left',!!x.pid)+check(q,'right','Turn right','Then a quarter turn to the right of straight.','Turn it right',!!x.pid&&!!x.left):'<li class="cal-pod-check"><p class="hint">This pod has no absolute encoder in Simulate, so its steering cannot be checked.</p></li>'}${check(q,'drive','Drive forward','The wheel goes back to straight and spins for a second.','Spin the wheel',!q.steer||!!x.right)}</ul>`;};
      const bWheels=`<p class="hint">Each drive motor spins for a second. A wheel that rolls backwards is reversed here, so forward means forward on every wheel.</p>${blocks}<ul class="cal-pod-checks">${pods.map(q=>check(q,'drive',`${q.label} · ${q.motor.name}`,q.motor.reversed?'Reversed.':'','Spin it',true)).join('')}</ul>`;
      const spots=r.spots||[],lastSpot=spots.at(-1);
      const b3=what==='nothing'?'<p class="hint">Nothing on this robot measures where it is: add odometry pods, a Pinpoint or an OTOS in Simulate → Setup.</p>':
        `<p class="hint">Put the robot on the field, lined up with a tile seam, and press Set zero here: that spot is (0, 0) facing 0°. Then drive or push it around: the map follows it from its sensors (${esc(c.locName)}).${what==='heading'?' This robot only measures its heading.':''}</p>
        ${live()?'':'<div class="button-row"><button type="button" class="primary" data-chassis="live">Start live readings</button></div>'}
        <div class="cal-chassis-map">${field()}<div class="cal-chassis-now"><dl class="cal-stats"><div><dt>Forward</dt><dd data-chassis-now="x">${f(pose?.x)} in</dd></div><div><dt>Left</dt><dd data-chassis-now="y">${f(pose?.y)} in</dd></div><div><dt>Heading</dt><dd data-chassis-now="h">${f(pose?.h)}°</dd></div></dl>
          <div class="button-row"><button type="button" class="secondary" data-chassis="zero"${live()?'':' disabled'}>${moving?'Set zero again':'Set zero here'}</button>${trail.length>1?'<button type="button" class="secondary" data-chassis="clear">Clear the trail</button>':''}</div>
          ${what==='position'?`<p class="hint">Drive it to a spot you can measure from the zero, then type where it really is.</p><div class="cal-fields"><div class="cal-field"><label for="cal-spot-x">Really forward · in</label><input id="cal-spot-x" type="number" step="0.5" data-slider="off" value="${esc(r.draftX??'')}"></div><div class="cal-field"><label for="cal-spot-y">Really left · in</label><input id="cal-spot-y" type="number" step="0.5" data-slider="off" value="${esc(r.draftY??'')}"></div></div>
          <div class="button-row"><button type="button" class="secondary" data-chassis="spot"${moving?'':' disabled'}>Compare</button></div>`:''}
          ${lastSpot?`<p class="${spotError(lastSpot.real,lastSpot.read)<=PASS_IN?'hint':'cal-sense-note bad'}">It read ${f(lastSpot.read.x)}, ${f(lastSpot.read.y)} for ${f(lastSpot.real.x)}, ${f(lastSpot.real.y)}: ${f(spotError(lastSpot.real,lastSpot.read),2)} in off.${spotError(lastSpot.real,lastSpot.read)<=PASS_IN?'':' More than an inch: calibrate the heading and pods in Electronics, or check the wheel size in Simulate.'}</p>`:''}
          <div class="button-row">${r.placed?'':`<button type="button" class="primary" data-chassis="placed"${what==='position'?(lastSpot&&spotError(lastSpot.real,lastSpot.read)<=PASS_IN?'':' disabled'):moving?'':' disabled'}>Where it is looks right</button>`}</div></div></div>`;
      const start=live()?'':'<div class="button-row"><button type="button" class="primary" data-chassis="live">Start live readings</button></div>',volts=m=>now['a:'+m.name];
      const bSteer=`<p class="hint">Turn every pod by hand until its wheel points straight ahead, each the same way round (its gear on the same side), then press the button. That reading is each pod’s zero.</p>${start}
        <ul class="cal-sense-rows">${steer.map(m=>`<li><b>${esc(m.label)}</b> <code>${esc(m.name)}</code>: now <span data-chassis-volts="${esc(m.name)}">${f(volts(m),3)}</span> V${Number.isFinite(r.steer?.zero?.[m.name])?` · zero kept at ${f(r.steer.zero[m.name],3)} V`:''}</li>`).join('')}</ul>
        <div class="button-row"><button type="button" class="${r.steer?'secondary':'primary'}" data-chassis="steer"${live()&&steer.every(m=>Number.isFinite(volts(m)))?'':' disabled'}>${r.steer?'Set straight again':'They all point straight'}</button></div>`;
      const rr=r.roll,rollRows=rr?.rows?`<ul class="cal-sense-rows">${rr.rows.map(x=>`<li>${x.weak||x.backwards?'<span class="rs-pill warn">Fix it</span>':'<span class="rs-pill ok">Good</span>'} <b>${esc(x.name)}</b>: ${x.ticks} ticks${x.weak?'. It hardly counted: check its encoder cable.':x.backwards?'. It counts backwards: reverse this motor in Simulate → Setup, or in your code.':''}</li>`).join('')}</ul>
        <p class="cal-sense-result"><b>${f(rr.ticksPerIn,2)}</b> ticks an inch. The motor and wheel size say ${f(rr.expected,2)}: ${f(Math.abs(rr.errorPct),1)}% ${rr.errorPct>=0?'more':'fewer'}${Math.abs(rr.errorPct)>15?'. That far apart, check the drive motor and wheel size in Simulate → Setup':''}.</p>`:rr?.problem?`<p class="cal-sense-note bad">${esc(rr.problem)}</p>`:'';
      const bRoll=`<p class="hint">Put the robot on the floor${c.swerve?' with its wheels pointing straight ahead':''}, its back on a tile seam. Press Start, push it straight forward ${PUSH_IN} in (two tiles), then press Done. Torque counts the encoder ticks in an inch of floor, which is what makes a distance in autonomous come out right.</p>${start}
        <div class="button-row">${rollFrom?`<button type="button" class="primary" data-chassis="roll-done">Done</button><button type="button" class="secondary" data-chassis="roll-cancel">Cancel</button><span class="hint">Counted about <span data-chassis-rolled>0.0</span> in</span>`:`<button type="button" class="${rr?.ok?'secondary':'primary'}" data-chassis="roll-start"${live()?'':' disabled'}>${rr?'Measure again':'Start'}</button>`}</div>${rollFrom?'':rollRows}`;
      const code=codeOf({ch:c,rec:r,links:links(),steer,config:opts.config?.()||'',date:new Date().toLocaleDateString('en-CA')});
      const bCode=`<li class="cal-chassis-step" data-chassis-step="code" data-state="info"><div class="cal-hub-head"><h4>Use it in your code</h4></div><p class="hint">Everything checked here, as one class for your robot’s own code. A number not checked yet says so beside it.</p><pre class="cal-cam-code cal-chassis-code" data-chassis-code>${esc(code)}</pre><div class="button-row"><button type="button" class="primary" data-chassis="copy">Copy</button></div></li>`;
      const T=globalThis.DeckChassisTeleop,tele=T?teleop(c,steer):null,map=T?T.mapOf(r.map):{},pickMap=(k,label)=>`<div class="cal-field"><label for="cal-map-${k}">${label}</label><select id="cal-map-${k}" data-chassis-map="${k}">${Object.entries(T.MAP[k]).map(([v,t])=>`<option value="${v}"${map[k]===v?' selected':''}>${esc(t)}</option>`).join('')}</select></div>`;
      const bDrive=!T?'':`<li class="cal-chassis-step" data-chassis-step="drive" data-state="info"><div class="cal-hub-head"><h4>Drive it</h4></div><p class="hint">A TeleOp for this chassis, written from everything checked here. Send puts it on the robot; it shows in Drive as “${esc(T.OP_MODE)}”. Pick what the controller does first.</p>
        <div class="cal-fields cal-drive-map">${pickMap('drive','Drive with')}${pickMap('turn','Turn with')}${pickMap('field','Forward means')}${pickMap('slow','Slow button')}${pickMap('reset','Set heading to 0')}</div>
        ${tele.error?`<p class="cal-sense-note bad">${esc(tele.error)}</p>`:s.every(x=>x.state==='pass')?'':'<p class="cal-note">Some checks above are not done yet: what they would set is left as Torque guessed it.</p>'}
        <div class="button-row"><button type="button" class="primary" data-chassis="send"${tele.error||sending?' disabled':''}>${sending?'Sending…':'Send to the robot'}</button>${sent?`<span class="hint" role="status">${esc(sent)}</span>`:''}</div>
        ${tele.source?`<details class="usb-facts"><summary>See the code</summary><pre class="cal-cam-code cal-chassis-code">${esc(tele.source)}</pre></details>`:''}</li>`;
      const podOf=id=>pods.find(q=>'pod:'+q.key===id),title=id=>({gone:'Simulate and the robot disagree',steer:'Point the wheels straight',wheels:'Wheels roll forward',roll:'How far it rolls',field:'Where it is on the field'})[id]||`${podOf(id).label} pod`,body=id=>({gone:bGone,steer:bSteer,wheels:bWheels,roll:bRoll,field:b3})[id]??bPod(podOf(id));
      const html=`<section class="cal-card cal-chassis"><div class="cal-hub-head"><h2>Chassis</h2>${s.every(x=>x.state==='pass')?'<span class="rs-pill ok">Calibrated</span>':''}</div><ol class="cal-chassis-steps">${s.map((x,i)=>step(i+1,title(x.id),x.state,x.state==='locked'?'':body(x.id))).join('')}${gone.length?'':bCode+bDrive}</ol></section>`;
      if(box.dataset.html===html)return;const focus=document.activeElement?.id;box.dataset.html=html;box.innerHTML=html;if(focus)document.getElementById(focus)?.focus();}
    // Live: the pose follows every reading; the map redraws once a frame at most.
    function follow(){if(off||!debug?.listen)return;off=debug.listen((_f,v)=>{
      tap?.(v);
      for(const el of box.querySelectorAll('[data-chassis-volts]'))el.textContent=f(v['a:'+el.dataset.chassisVolts],3);
      if(rollFrom){const el=box.querySelector('[data-chassis-rolled]'),x=rollOf(ch(),rollFrom,v);if(el)el.textContent=f(Number.isFinite(x.ticksPerIn)?x.ticksPerIn*PUSH_IN/ch().nominalTicksPerIn:0);}
      // A pod on its way to a quarter turn: there once its encoder has stayed within the tolerance, or not after 6 s.
      if(run?.phase==='moving'&&run.kind!=='drive'&&run.kind!=='tune'){const d=steerAngle(v['a:'+run.name],run.target,run.span,run.sense)*(run.kind==='right'?-1:1),t=tolOf(rec());/* d: past the target (+) or short of it (-), the way it was turning */run.hits=d<=t.plus&&d>=-t.minus?run.hits+1:0;
        if(run.hits>=10||performance.now()-run.at>6000){run={...run,phase:'ask',reached:run.hits>=10,off:d};if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;paint();});}}}
      const was=ready;ready=steerOf(ch()).map(m=>Number.isFinite(v['a:'+m.name])?1:0).join('');if(ready!==was&&!queued){queued=true;requestAnimationFrame(()=>{queued=false;paint();});}
      if(!track?.zeroed)return;const q=track.update(v);if(!q)return;pose=q;const last=trail.at(-1);if(Number.isFinite(q.x)&&(!last||Math.hypot(q.x-last.x,q.y-last.y)>.5)){trail.push({x:q.x,y:q.y});if(trail.length>600)trail.shift();}
      if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;paint();});}});}
    const save=()=>{opts.save();paint();};
    // The chassis as the TeleOp needs it: each pod with what was checked on it, or each drive motor.
    function teleop(c,steer){const r=rec(),T=globalThis.DeckChassisTeleop,robot=p().robot||{},L=robot.length||17,W=robot.width||17,at=k=>({x:/front/i.test(k)?L/2:/back/i.test(k)?-L/2:0,y:/left/i.test(k)?W/2:/right/i.test(k)?-W/2:0});
      const common={robot,imu:{name:c.imu,scale:c.odo?.imu?.scale||1},map:r.map,config:opts.config?.()||'',date:new Date().toLocaleDateString('en-CA')};
      if(steer.length)return T.teleopOf({...common,kind:'swerve',tolerance:+(bandOf(r)*.6).toFixed(2),pods:podsOf(c,steer).map(q=>{const st=q.steer,x=(r.pods||{})[q.key]||{},pid=x.pid||STEER,per=(st?.volts||3.3)/360,sense=x.sense||1;
        return {label:q.label,drive:q.motor.name,reversed:q.motor.reversed,servo:st?.servo,encoder:st?.name,...at(q.key),zero:r.steer?.zero?.[st?.name],encoderSign:sense,servoSign:(pid.g??(st?gOf(st):1))*sense,kP:pid.kP*per,kI:(pid.kI||0)*per,kD:pid.kD*per,kS:pid.kS,volts:st?.volts||3.3};})});
      return T.teleopOf({...common,kind:c.type==='mecanum'?'mecanum':['tank','tank2'].includes(c.type)?'tank':c.type,motors:c.motors});}
    // Holds a pod's wheel at an angle from straight (left positive) with Torque Debug's loop; null with no encoder or no zero.
    function hold(q,deg,pid){const st=q.steer,z=rec().steer?.zero?.[st?.name];if(!st||!Number.isFinite(z))return null;const x=podRec(q.key),span=st.volts||3.3,target=steerTarget(z,deg,span,x.sense||1);pid=pid||x.pid;send(steerLoop(st,target,pid?.g??gOf(st),span,pid||STEER,bandOf(rec())));return {target,span,name:st.name,sense:x.sense||1};}
    // A pod tunes itself: the least power that moves it and which way (a few degrees), its speed at a steady power, gains
    // from those, then test turns of 45° that are slowed down until one neither swings past nor hunts.
    async function tune(q,long=false){const st=q.steer,span=st.volts||3.3,key='a:'+st.name,mine={pod:q.key,kind:'tune',phase:'moving',note:'Finding the power that moves it…'};run=mine;told='';follow();paint();
      const alive=()=>run===mine,sleep=ms=>new Promise(r=>setTimeout(r,ms)),short=(a,b)=>{let t=(b-a)/span;t-=Math.round(t);return t*span;},say=t=>{mine.note=t;const el=box.querySelector('[data-chassis-doing]');if(el)el.textContent=t;};
      const fail=text=>{if(!alive())return;send(`C\t${st.servo}\t0`);tap=null;run=null;told=text;paint();};
      // Volts travelled, the short way round each reading, with when each reading came.
      const watch=()=>{const out=[],t0=performance.now();let last=debug.values()[key],sum=0;tap=v=>{const now=v[key];if(!Number.isFinite(now))return;if(Number.isFinite(last))sum+=short(last,now);last=now;out.push([(performance.now()-t0)/1000,sum,now]);};return out;};
      const drive=async(power,ms)=>{for(const end=performance.now()+ms;alive()&&performance.now()<end;){send(`C\t${st.servo}\t${power.toFixed(3)}`);await sleep(40);}};
      let breakaway=0;for(let u=.04;u<=.5&&alive();u+=.04){const seen=watch();await drive(u,140);if(seen.length&&Math.abs(seen.at(-1)[1])>.03){breakaway=u;break;}}
      send(`C\t${st.servo}\t0`);if(!alive())return;if(!breakaway)return fail(`${st.servo} did not move ${st.name} at half power. Check them in Electronics.`);
      await sleep(200);say('Measuring how fast it turns…');const power=Math.min(.5,breakaway+.2),seen=watch();await drive(power,400);send(`C\t${st.servo}\t0`);tap=null;if(!alive())return;
      const plant=plantOf(seen.map(x=>[x[0],x[1]]),power);if(!plant)return fail('Its encoder gave too few readings to tune from. Try it again.');
      const base={...gainsOf({...plant,breakaway,span}),g:plant.g},band=bandOf(rec()),tries=[];
      // Quarter turns, 45° right of straight to 45° left and back, each quicker than the last, until one swings past or hunts.
      hold(q,-45,base);await sleep(900);let n=0;
      // One quarter turn with these gains, 45° one side of straight to 45° the other: over once it has stayed inside the band for 0.3 s, 1.6 s at most.
      const turn=async(pid,watch=.3)=>{const h=hold(q,n++%2?-45:45,pid),trace=[],t0=performance.now();tap=v=>{if(Number.isFinite(v[key]))trace.push([(performance.now()-t0)/1000,steerAngle(v[key],h.target,span)]);};
        for(;alive()&&performance.now()-t0<1600+watch*1000;await sleep(40)){const now=stepStats(trace,band);if(now&&now.settle!==null&&now.held>watch)break;}
        tap=null;return stepStats(trace,band);};
      for(let pid=base;pid&&alive();pid=nextTry(tries)){const sofar=bestTry(tries);say(`Quarter turn ${tries.length+1}${sofar?`: quickest so far ${f(sofar.stats.settle,2)} s`:''}…`);const stats=await turn(pid);if(!alive())return;tries.push({pid,stats});}
      if(!alive())return;let best=bestTry(tries);const last=tries.at(-1)?.stats;
      if(!best){hold(q,0,base);return fail(`It would not settle within ${band}°: the last turn swung ${f(last?.overshoot,1)}° past and crossed ${last?.crossings??0} times. Check that this pod turns freely and its encoder is tight on the shaft, or allow more above, then tune it again.`);}
      // The long tune: two minutes of quarter turns, each of the three gains tried up and down in turn, keeping what is quicker.
      if(long){const from=best.pid,until=performance.now()+120000,pair=async pid=>{const a=await turn(pid,.7),b=alive()?await turn(pid,.7):null;return {a,b,cost:(costOf(a)+costOf(b))/2};};
        let search=searchStart([from.kP,from.kI||0,from.kD],[from.kP*.25,from.kP*.5,Math.max(from.kD,.003)*.5]),top={pid:from,stats:best.stats,cost:Infinity};
        while(alive()&&performance.now()<until){const [kP,kI,kD]=search.p,pid={...from,kP:+Math.min(KP_MAX,Math.max(.02,kP)).toFixed(4),kI:+Math.max(0,kI).toFixed(4),kD:+Math.max(0,kD).toFixed(5)};
          say(`Tuning hard, ${Math.ceil((until-performance.now())/1000)} s left: quickest so far ${f(top.stats.settle,2)} s`);const r=await pair(pid);if(!alive())return;
          if(r.cost<top.cost&&steady(r.a,.6)&&steady(r.b,.6))top={pid,stats:r.a.settle>r.b.settle?r.a:r.b,cost:r.cost};search=searchStep(search,r.cost);}
        if(!alive())return;if(Number.isFinite(top.cost))best={pid:top.pid,stats:top.stats};}
      // The last word: a quarter turn each way with the chosen gains, each watched for two seconds after it arrives. If it
      // hunts or drifts out, the gains come down a fifth and it is checked again; gains that never hold still are not kept.
      let calm=null,backed=0;for(let pid=best.pid;alive()&&backed<=4;backed++,pid={...pid,kP:+(pid.kP*.8).toFixed(4),kI:+((pid.kI||0)*.5).toFixed(4),kD:+(pid.kD*.9).toFixed(5)}){
        say(`Checking it holds still${backed?`, gains down ${backed} time${backed>1?'s':''}`:''}…`);const a=await turn(pid,2),b=alive()?await turn(pid,2):null;if(!alive())return;
        if(steady(a,1.8)&&steady(b,1.8)){calm={pid,stats:a.settle>b.settle?a:b};break;}}
      if(!alive())return;if(!calm){hold(q,0,base);return fail('It kept oscillating after it arrived, even with the gains brought down. Check for play in this pod (a loose encoder, a slipping gear or belt), then tune it again.');}
      best=calm;
      const x=podRec(q.key);x.pid={...best.pid,settle:best.stats.settle,overshoot:best.stats.overshoot,Kv:+plant.Kv.toFixed(3),L:+plant.L.toFixed(3),turns:n,hunt:best.stats.hunt,swing:best.stats.swing,...(backed?{backed}:{}),...(long?{long:true}:{})};delete x.left;delete x.right;hold(q,0);run=null;save();}
    const stop=()=>{clearInterval(timer);timer=null;run=null;tap=null;send('X');};
    function go(q,kind){told='';clearInterval(timer);if(kind==='tune'||kind==='deep')return void tune(q,kind==='deep');
      if(kind!=='drive'){const h=hold(q,kind==='left'?90:-90);if(!h)return;run={pod:q.key,kind,phase:'moving',hits:0,at:performance.now(),...h};follow();return paint();}
      // The wheel, straight, at a third of its power for about a second; the power is sent again before the robot's watchdog lets go.
      hold(q,0);const m=q.motor,dir=m.reversed?-1:1,key=`m:${m.name}:pos`,from=debug.values()[key];let n=0;run={pod:q.key,kind,phase:'moving'};
      timer=setInterval(()=>{if(!run||run.kind!=='drive'){clearInterval(timer);return;}if(++n<=8)return void send(`M\t${m.name}\t${(.3*dir).toFixed(2)}`);
        clearInterval(timer);send(`M\t${m.name}\t0`);run={...run,phase:'ask',ticks:(debug.values()[key]-from)*dir};paint();},120);paint();}
    function answer(yes){const c=ch(),q=podsOf(c,steerOf(c)).find(x=>x.key===run?.pod);if(!q)return;const x=podRec(q.key),kind=run.kind;
      if(kind==='drive'){if(yes){x.drive=true;x.enc=Number.isFinite(run.ticks)&&run.ticks<0?-1:1;}else{delete x.drive;opts.setReversed?.(q.motor.key,!q.motor.reversed);told=`${q.motor.name} is reversed now. Spin it again to check.`;}}
      // Turned the other way: Torque had this pod's left and right swapped. Its sense is turned round and both turns are checked again.
      else if(yes)x[kind]=true;else{x.sense=-(x.sense||1);delete x.left;delete x.right;told='Left and right were swapped for this pod: corrected. Turn it left again to check.';}
      run=null;if(kind!=='drive')hold(q,0);else send('X');save();}
    box?.addEventListener('change',e=>{const k=e.target.dataset?.chassisMap;if(k){const r=rec();r.map=globalThis.DeckChassisTeleop.mapOf({...r.map,[k]:e.target.value});sent='';return save();}
      const which=e.target.dataset?.chassisTol;if(!which)return;const r=rec();r.tol={...tolOf(r),[which]:+e.target.value};for(const x of Object.values(r.pods||{})){delete x.left;delete x.right;}save();});
    box?.addEventListener('input',e=>{const r=rec();if(e.target.id==='cal-spot-x')r.draftX=e.target.value;if(e.target.id==='cal-spot-y')r.draftY=e.target.value;});
    box?.addEventListener('click',e=>{const b=e.target.closest('[data-chassis]');if(!b)return;const r=rec(),a=b.dataset.chassis;
      if(a==='go'){const c=ch(),q=podsOf(c,steerOf(c)).find(x=>x.key===b.dataset.pod);return q?go(q,b.dataset.kind):undefined;}
      if(a==='yes'||a==='no')return answer(a==='yes');if(a==='stop'){stop();return paint();}
      if(a==='send'){const c=ch(),t=teleop(c,steerOf(c));if(t.error||sending)return;stop();sending=true;sent='';paint();
        return void Promise.resolve(opts.sendTeleop?.(t)).then(text=>{sent=text||'Sent.';},e=>{sent=`It did not get there: ${e?.message||e}`;}).finally(()=>{sending=false;paint();});}
      if(a==='to-sim')return opts.toSimulate?.();if(a==='to-elec')return opts.toElectronics?.();if(a==='live')return void debug?.start?.();
      if(a==='zero'){track=tracker(ch());if(!track.zero(debug.values()))return void(b.textContent='No readings yet: try again');pose={x:0,y:0,h:0};trail=[{x:0,y:0}];delete r.placed;follow();return save();}
      if(a==='clear'){trail=pose&&Number.isFinite(pose.x)?[{x:pose.x,y:pose.y}]:[];return paint();}
      if(a==='spot'){const x=+r.draftX,y=+r.draftY;if(!pose||!Number.isFinite(x)||!Number.isFinite(y))return;r.spots=[...(r.spots||[]),{real:{x,y},read:{x:+pose.x.toFixed(2),y:+pose.y.toFixed(2),h:+pose.h.toFixed(1)},at:new Date().toISOString()}].slice(-10);return save();}
      if(a==='placed'){r.placed=new Date().toISOString();return save();}
      if(a==='steer'){const v=debug.values(),zero={};for(const m of steerOf(ch())){if(!Number.isFinite(v['a:'+m.name]))return void(b.textContent='No readings yet: try again');zero[m.name]=+v['a:'+m.name].toFixed(4);}
        r.steer={at:new Date().toISOString(),zero};for(const x of Object.values(r.pods||{})){delete x.left;delete x.right;}opts.setSteerZero?.(zero);return save();}
      if(a==='roll-start'){rollFrom={...debug.values()};follow();return paint();}
      if(a==='roll-cancel'){rollFrom=null;return paint();}
      if(a==='roll-done'){const c=chassisOf({...p(),calibration:{}},opts.C,{cpr:opts.cpr?.()||537.7});r.roll={...rollOf(c,rollFrom,debug.values()),at:new Date().toISOString()};rollFrom=null;return save();}
      if(a==='copy'){const t=box.querySelector('[data-chassis-code]')?.textContent||'';return void navigator.clipboard?.writeText(t).then(()=>{b.textContent='Copied';},()=>{b.textContent='Select it and copy';});}});
    const checked=()=>{const r=rec();return !!(r.steer||r.roll?.ok||Object.values(r.pods||{}).some(x=>x.drive||x.pid));};
    return {refresh:paint,code:()=>{if(!checked())return null;const c=ch();return codeOf({ch:c,rec:rec(),links:links(),steer:steerOf(c),config:opts.config?.()||'',date:new Date().toLocaleDateString('en-CA')});}};}
  root.DeckChassisCal={...api,create};
})(typeof globalThis==='object'?globalThis:this);
