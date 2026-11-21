'use strict';
// A TeleOp written from what Calibrate checked on the real robot: which way each motor rolls its wheel, each swerve pod's
// zero, directions and tuned steering loop, the heading correction, and the controller mapping the team picked. The
// chassis is on the sticks; each mechanism from Setup (o.mechanisms) is on buttons. It is one OnBot Java file with no
// package (a packaged class crash-loops some Robot Controller builds), so Send puts it on the robot as it is and it
// shows in Drive's op mode list: "Torque Chassis" for the chassis alone (Calibrate → Mechanisms → Drive it), "Torque
// TeleOp" for the whole robot (Calibrate → TeleOp).
// Frame: forward and left are positive, turning counterclockwise is positive, as everywhere in Deck.
(function(root){
  const NAME='TorqueChassis',OP_MODE='Torque Chassis';
  // What the team may pick. drive: the stick that moves it; turn: what turns it; slow, reset: a button or none.
  // spin: buttons that spin the robot on the spot at full rate; lock (swerve): a button that turns every wheel to point
  // at the middle of the robot, so it cannot be pushed off its spot.
  const MAP={drive:{left:'Left stick',right:'Right stick'},turn:{right:'Right stick, left and right',left:'Left stick, left and right',triggers:'Triggers',bumpers:'Bumpers'},
    spin:{none:'No spin buttons',bumpers:'Bumpers: hold one to spin that way',triggers:'Triggers: squeeze one to spin that way',dpad:'D-pad left and right'},
    lock:{none:'No lock button',x:'X / Square',b:'B / Circle',a:'A / Cross',left_stick_button:'Left stick click',right_stick_button:'Right stick click'},
    slow:{right_bumper:'Right bumper',left_bumper:'Left bumper',left_stick_button:'Left stick click',right_stick_button:'Right stick click',none:'No slow button'},reset:{start:'Start / Options',y:'Y / Triangle',dpad_up:'D-pad up',none:'No button'},field:{yes:'The field: forward is away from the driver',no:'The robot: forward is the robot’s front'}};
  const DEFAULT={drive:'left',turn:'right',spin:'none',lock:'none',slow:'right_bumper',reset:'start',field:'yes'};
  // A mapping with only choices from the lists, and no control doing two jobs: a turn on the stick that already drives
  // moves to the other stick; spin buttons that already turn are dropped; a slow button on a bumper the turn or the spin
  // uses moves to a stick click; a lock on the slow button's stick click takes the other one.
  function mapOf(raw){const m={...DEFAULT};for(const k of Object.keys(MAP))if(raw&&Object.hasOwn(MAP[k],raw[k]))m[k]=raw[k];if(m.turn===m.drive)m.turn=m.drive==='left'?'right':'left';
    if(m.spin===m.turn)m.spin='none';if((m.turn==='bumpers'||m.spin==='bumpers')&&/bumper/.test(m.slow))m.slow='left_stick_button';
    if(m.lock!=='none'&&m.lock===m.slow)m.lock=m.slow==='left_stick_button'?'right_stick_button':'left_stick_button';return m;}
  // The buttons of controller 1 the chassis has taken (the sticks are its own): for giving the mechanisms the rest.
  function chassisButtons(raw,swerve=true){const m=mapOf(raw),out=[],two=k=>({bumpers:['left_bumper','right_bumper'],triggers:['left_trigger','right_trigger'],dpad:['dpad_left','dpad_right']}[k]||[]);
    out.push(...two(m.turn),...two(m.spin));for(const k of ['slow','reset'])if(m[k]!=='none')out.push(m[k]);if(swerve&&m.lock!=='none')out.push(m.lock);return [...new Set(out)];}
  // Every part of controller 1 the chassis uses: those buttons, the whole stick that drives it, and the side-to-side of the
  // stick that turns it (that stick's up and down is free for a mechanism).
  function chassisParts(raw,swerve=true){const m=mapOf(raw),out=[`${m.drive}_stick_x`,`${m.drive}_stick_y`];if(m.turn==='left'||m.turn==='right')out.push(`${m.turn}_stick_x`);return [...out,...chassisButtons(raw,swerve)];}
  const n=(v,d=5)=>Number.isFinite(+v)?String(+(+v).toFixed(d)):'0',list=a=>`{${a.join(', ')}}`,str=s=>`"${String(s).replace(/[\\"]/g,'\\$&')}"`;
  const dbl=v=>{const t=n(v);return /[.e]/.test(t)?t:t+'.0';};
  const FACE={up:'UP',down:'DOWN',forward:'FORWARD',backward:'BACKWARD',left:'LEFT',right:'RIGHT'};
  // The lines every drivetrain shares: the sticks as forward, left and turn, the slow button, the heading and its reset.
  function sticks(m){const s=m.drive,pair={triggers:'gamepad1.left_trigger - gamepad1.right_trigger',bumpers:'(gamepad1.left_bumper ? 1 : 0) - (gamepad1.right_bumper ? 1 : 0)',dpad:'(gamepad1.dpad_left ? 1 : 0) - (gamepad1.dpad_right ? 1 : 0)'},t=pair[m.turn]||`-gamepad1.${m.turn}_stick_x`,spin=pair[m.spin];
    return [`            double forward = -gamepad1.${s}_stick_y, left = -gamepad1.${s}_stick_x, turn = ${t};`,
      ...(spin?['            // Spin on the spot: a spin button turns the robot at full rate, whatever the turn stick says (the drive stick still moves it).',`            double spin = ${spin};`,'            if (Math.abs(spin) > 0.05) turn = spin;']:[]),
      ...(m.slow==='none'?[]:[`            if (gamepad1.${m.slow}) { forward *= 0.4; left *= 0.4; turn *= 0.4; }`]),
      ...(m.reset==='none'?[]:[`            if (gamepad1.${m.reset}) imu.resetYaw();`]),
      '            double heading = imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.RADIANS) * IMU_SCALE;',
      ...(m.field==='yes'?['            // Field centric: the stick is turned back by the robot\'s heading, so forward stays away from the driver.','            double f = forward * Math.cos(heading) + left * Math.sin(heading);','            left = -forward * Math.sin(heading) + left * Math.cos(heading);','            forward = f;']:[])];}
  const head=(o,imports)=>[...[...new Set(imports)].sort().map(i=>`import ${i};`),'',`// Written by Torque (Calibrate)${o.date?', '+o.date:''}${o.config?`, from the "${o.config}" configuration`:''}.`,'// Everything in capitals was checked or measured on the real robot. Send it again after calibrating again.',`@TeleOp(name = ${str(o.opMode||OP_MODE)}, group = "Torque")`,`public class ${o.className||NAME} extends LinearOpMode {`];
  // ---- mechanisms -------------------------------------------------------------------------------------------------------
  // What a mechanism does in the TeleOp, by what drives it, on any part of the controller.
  //   A motor or a continuous servo: runs while a button is held (and backwards on another), is switched on and off by a
  //   button, goes one way and the other on two buttons (a motor, braked when let go), or follows a stick or the triggers.
  //   A servo: a button for each of two or three positions, one button that flips between two, over while a button is
  //   held and back when it is let go, or wherever a trigger or a stick puts it between two positions.
  // How each starts comes from what it is (ui/sim-mechanism-types.js: an intake, a claw, a lift, a turret...), the way
  // teams usually drive that kind; the team changes any of it.
  const BUTTONS={right_trigger:'Right trigger',left_trigger:'Left trigger',right_bumper:'Right bumper',left_bumper:'Left bumper',a:'A / Cross',b:'B / Circle',x:'X / Square',y:'Y / Triangle',dpad_up:'D-pad up',dpad_down:'D-pad down',dpad_left:'D-pad left',dpad_right:'D-pad right',left_stick_button:'Left stick click',right_stick_button:'Right stick click',back:'Back / Share',start:'Start / Options'};
  // What a stick or a trigger can be followed by: up and right are positive, the right trigger one way and the left the other.
  const AXES={right_stick_y:'Right stick, up and down',right_stick_x:'Right stick, left and right',left_stick_y:'Left stick, up and down',left_stick_x:'Left stick, left and right',triggers:'Both triggers: right one way, left the other',right_trigger:'Right trigger',left_trigger:'Left trigger'};
  const MODES={hold:'Runs while a button is held',toggle:'One button switches it on and off',updown:'Two buttons, one each way',axis:'Follows a stick or the triggers',positions:'A button for each position',flip:'One button flips between two positions',momentary:'Over while a button is held, back when let go',follow:'Follows a trigger or a stick',off:'Not in this TeleOp'};
  const ANALOG=new Set(['axis','follow']);
  const modesFor=kind=>kind==='servo'?['flip','positions','momentary','follow','off']:kind==='crservo'?['hold','toggle','axis','off']:['hold','toggle','updown','axis','off'];
  // The parts of the controller a control uses (both triggers are two), so that nothing is given two jobs.
  const partsOf=c=>c==='triggers'?['left_trigger','right_trigger']:c&&c!=='none'?[c]:[];
  const PARTS=[...Object.keys(BUTTONS),'left_stick_x','left_stick_y','right_stick_x','right_stick_y'];
  const cap=t=>{const w=String(t||'').replace(/([a-z])([0-9])/g,'$1 $2');return w?w[0].toUpperCase()+w.slice(1):'';};
  // What each control of a mode does, in the mechanism's own words when it has them (its states in Setup: open and
  // closed, down and up, front, left and right): [first, second, third], null where the mode has none.
  function usesOf(mode,states){const n=(states||[]).map(cap),three=n.length>=3,one=n[n.length>=2?1:0],other=three?n[2]:n[0];
    return {hold:['Runs it','Runs it backwards',null],toggle:['On and off','Backwards while held',null],updown:[one||'Up',n.length>=2?other:'Down',null],axis:['Follows',null,null],
      positions:[n[0]||'First position',n[1]||'Second position',three?n[2]:null],flip:[n.length>=2?`Flips ${n[0].toLowerCase()} and ${n[1].toLowerCase()}`:'Flips it',null,null],momentary:[n.length>=2?`${n[1]} while held`:'Over while held',null,null],follow:['Follows',null,null],off:[null,null,null]}[mode]||[null,null,null];}
  const USES=Object.fromEntries(Object.keys(MODES).map(m=>[m,usesOf(m,[])]));
  const SPIN=/flywheel|roller|feeder|conveyor|spinner|spindle|spin|propeller|spindexer|geneva/,SIDEWAYS=/turret|base-yaw|neck|steering/;
  // How a kind of mechanism starts out, as teams usually drive it.
  function startOf(m,kind){const t=String(m.type||''),n=(m.states||[]).length;
    if(kind==='servo')return /kicker|gate|button-pusher|finger|knocker/.test(t)?'momentary':n>=3?'positions':'flip';
    if(/flywheel|spinner|spindle|propeller/.test(t))return 'toggle';
    return SPIN.test(t)&&!/winch/.test(t)||m.template==='T3'||kind==='crservo'?'hold':'updown';}
  // A mechanism's choices, whole: {mode, a, b, c, power, posA, posB, posC}. free: the parts of the controller nothing else
  // has, in order; the ones it takes are removed from it.
  function mechOf(m,raw,free){const kind=m.kind==='servo'?'servo':m.kind==='crservo'?'crservo':'motor',modes=modesFor(kind),r=raw&&typeof raw==='object'?raw:{},num=(v,d,lo,hi)=>Number.isFinite(+v)&&v!==''&&v!==null&&v!==undefined?Math.max(lo,Math.min(hi,+v)):d;
    const mode=modes.includes(r.mode)?r.mode:startOf(m,kind),pA=num(m.posA,.5,0,1),pB=num(m.posB,.5,0,1);
    const out={mode,a:'none',b:'none',c:'none',power:+num(r.power,1,.05,1).toFixed(2),posA:+num(r.posA,pA,0,1).toFixed(3),posB:+num(r.posB,pB,0,1).toFixed(3),posC:+num(r.posC,num(m.posC,+((pA+pB)/2).toFixed(3),0,1),0,1).toFixed(3)};
    if(mode==='off')return out;
    const has=c=>!!c&&c!=='none'&&partsOf(c).every(p=>free.includes(p)),take=c=>{for(const p of partsOf(c))free.splice(free.indexOf(p),1);return c;},give=c=>{for(const p of partsOf(c).reverse())if(!free.includes(p))free.unshift(p);};
    if(ANALOG.has(mode)){const pick=Object.hasOwn(AXES,r.a)&&has(r.a)?r.a:Object.keys(AXES).filter(c=>kind!=='servo'||mode!=='follow'||true).find(has);if(!pick)return {...out,mode:'off',full:true};out.a=take(pick);return out;}
    const next=()=>{const b=Object.keys(BUTTONS).find(has);return b?take(b):'none';},ok=c=>Object.hasOwn(BUTTONS,c)&&has(c);
    const three=mode==='positions'&&(m.states||[]).length>=3,needB=mode==='updown'||mode==='positions',wantsB=needB||ok(r.b)||r.b===undefined&&mode==='hold'&&/intake|roller|conveyor/.test(m.type||'');
    // Two buttons, one each way, start on a pair that reads that way: left and right for what turns sideways, up and down otherwise.
    const pairs=SIDEWAYS.test(m.type||'')?[['dpad_left','dpad_right'],['left_bumper','right_bumper'],['x','b']]:[['dpad_up','dpad_down'],['y','a'],['right_trigger','left_trigger'],['right_bumper','left_bumper'],['dpad_right','dpad_left']];
    const pair=mode==='updown'&&!ok(r.a)&&!ok(r.b)?pairs.find(q=>q.every(has)):null;
    if(pair){out.a=take(pair[0]);out.b=take(pair[1]);return out;}
    const bPick=ok(r.b)?take(r.b):null,cPick=three&&ok(r.c)?take(r.c):null;out.a=ok(r.a)?take(r.a):next();if(wantsB)out.b=bPick||next();else if(bPick)give(bPick);if(three)out.c=cPick||next();else if(cPick)give(cPick);
    // No control left for it: it is left out, and says so.
    if(out.a==='none'||needB&&out.b==='none'){for(const c of [out.c,out.b,out.a])give(c);return {...out,mode:'off',a:'none',b:'none',c:'none',full:true};}
    return out;}
  // Every mechanism's choices at once, in the list's order. pad: 'gamepad1' shares the controller with the chassis (what
  // it uses is taken first: its sticks too), 'gamepad2' has a controller to itself. A control the team picked stays with
  // the mechanism it was picked for (the first, if two picked it); the others take what is left, in order.
  // The controls go round by how much a kind of mechanism is used in a match, so the intake gets the triggers and a hood
  // or a ramp gets what is left: the intake, what lifts, what grabs, what shoots, what feeds it, what aims, then the rest.
  const RANK=[/intake|roller(?!-claw)/,/lift|slide|elevator|arm|climb|winch|hang/,/claw|gripper|grab/,/flywheel|shooter|launcher|catapult/,/feeder|kicker|gate|indexer|transfer|conveyor/,/turret|wrist|pivot/];
  const rankOf=m=>{const t=String(m.type||''),i=RANK.findIndex(r=>r.test(t));return /deploy|ramp|hood/.test(t)?RANK.length+1:i<0?RANK.length:i;};
  function mechMap(list,raw,{pad='gamepad1',map,swerve=true}={}){const taken=pad==='gamepad1'?chassisParts(map,swerve):[],free=PARTS.filter(b=>!taken.includes(b)),out={},claimed=new Set(),picked={};
    for(const m of list){const r=raw?.[m.id];if(!r||r.mode==='off')continue;const mine={};for(const k of ['a','b','c']){const c=r[k],parts=partsOf(c);if(parts.length&&parts.every(p=>free.includes(p)&&!claimed.has(p))){for(const p of parts)claimed.add(p);mine[k]=c;}}picked[m.id]=mine;}
    const pool=free.filter(b=>!claimed.has(b));
    for(const m of list.map((m,i)=>[rankOf(m),i,m]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]).map(x=>x[2])){const r=raw?.[m.id],mine=picked[m.id]||{},own=Object.values(mine).flatMap(partsOf),local=[...own,...pool],before=new Set(local),keep=k=>mine[k]||(r[k]==='none'?'none':undefined);
      out[m.id]=mechOf(m,r?{...r,a:keep('a'),b:keep('b'),c:keep('c')}:r,local);
      for(const b of before)if(!local.includes(b)&&pool.includes(b))pool.splice(pool.indexOf(b),1);for(const b of own)if(local.includes(b)&&!pool.includes(b))pool.unshift(b);}
    return out;}
  const pressed=(pad,b)=>/_trigger$/.test(b)?`${pad}.${b} > 0.5`:`${pad}.${b}`;
  // A stick or the triggers as a number: up and right are positive, the right trigger one way and the left the other.
  const axisOf=(pad,c)=>c==='triggers'?`${pad}.right_trigger - ${pad}.left_trigger`:/_stick_y$/.test(c)?`-${pad}.${c}`:`${pad}.${c}`;
  const RESERVED=new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null n drive steer encoder radius imu target steered steerPower speed loop hubs hub last now dt forward left turn spin heading f moving top lock power p i vx vy angle error wheel flip end telemetry gamepad1 gamepad2 hardwareMap'.split(' '));
  // The Java for the mechanisms: {imports, init (before waitForStart), loop (every loop)}.
  // list: [{label, device (its name in the robot configuration), kind: 'motor'|'crservo'|'servo', reversed, states, mode, a, b, c, power, posA, posB, posC}].
  function mechCode(list,pad='gamepad1'){const imports=[],init=[],loop=[],names=new Set(),say=b=>BUTTONS[b]||AXES[b]||b,low=t=>String(t||'').toLowerCase();
    const ident=(label,i)=>{const w=String(label||'').replace(/[^A-Za-z0-9]+/g,' ').trim().split(' ').filter(Boolean);let id=w.map((x,k)=>k?x[0].toUpperCase()+x.slice(1).toLowerCase():x.toLowerCase()).join('');if(!id||/^[0-9]/.test(id)||RESERVED.has(id))id='mech'+(i+1);while(names.has(id))id+='B';names.add(id);return id;};
    (list||[]).forEach((m,i)=>{if(!m||m.mode==='off'||!MODES[m.mode]||!m.device||!m.a||m.a==='none')return;const servo=m.kind==='servo',cls=servo?'Servo':m.kind==='crservo'?'CRServo':'DcMotor',pw=dbl(Math.max(.05,Math.min(1,+m.power||1))),analog=ANALOG.has(m.mode);
      if(!modesFor(servo?'servo':m.kind==='crservo'?'crservo':'motor').includes(m.mode))return;if(analog?!Object.hasOwn(AXES,m.a):!Object.hasOwn(BUTTONS,m.a))return;
      const hasB=!analog&&m.b&&m.b!=='none',hasC=m.mode==='positions'&&m.c&&m.c!=='none',u=usesOf(m.mode,m.states);if((m.mode==='updown'||m.mode==='positions')&&!hasB)return;
      const v=ident(m.label,i),A=analog?axisOf(pad,m.a):pressed(pad,m.a),B=hasB?pressed(pad,m.b):null,C=hasC?pressed(pad,m.c):null,pA=dbl(m.posA),pB=dbl(m.posB),pC=dbl(m.posC);
      imports.push('com.qualcomm.robotcore.hardware.'+cls);
      const what={hold:`hold ${say(m.a)} to run it${hasB?`, ${say(m.b)} to run it backwards`:''}`,toggle:`${say(m.a)} switches it on and off${hasB?`; ${say(m.b)} runs it backwards while held`:''}`,updown:`${say(m.a)} moves it ${low(u[0])}, ${say(m.b)} ${low(u[1])}; it brakes when let go`,
        axis:`it follows ${low(say(m.a))}`,positions:`${say(m.a)} sends it to ${low(u[0])} (${pA}), ${say(m.b)} to ${low(u[1])} (${pB})${hasC?`, ${say(m.c)} to ${low(u[2])} (${pC})`:''}`,flip:`${say(m.a)} flips it between ${pA} and ${pB}`,momentary:`at ${pB} while ${say(m.a)} is held, at ${pA} when it is let go`,follow:`${low(say(m.a))} puts it anywhere between ${pA} and ${pB}`}[m.mode];
      init.push(`        // ${String(m.label||m.device).replace(/[\r\n]+/g,' ')}: ${what}.`,`        ${cls} ${v} = hardwareMap.get(${cls}.class, ${str(m.device)});`);
      if(!servo&&m.reversed)init.push(`        ${v}.setDirection(DcMotorSimple.Direction.REVERSE);`);
      if(m.mode==='updown'||m.mode==='axis'&&m.kind==='motor')init.push(`        ${v}.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);`);
      if(m.mode==='toggle'||m.mode==='flip')init.push(`        boolean ${v}On = false, ${v}Was = false;`);
      if(m.mode==='hold'||m.mode==='updown')loop.push(`            ${v}.setPower(${A} ? ${pw} : ${hasB?`${B} ? -${pw} : `:''}0);`);
      else if(m.mode==='toggle')loop.push(`            boolean ${v}Now = ${A};`,`            if (${v}Now && !${v}Was) ${v}On = !${v}On;`,`            ${v}Was = ${v}Now;`,`            ${v}.setPower(${hasB?`${B} ? -${pw} : `:''}${v}On ? ${pw} : 0);`);
      else if(m.mode==='axis')loop.push(`            double ${v}Go = ${A};`,`            ${v}.setPower(Math.abs(${v}Go) < 0.05 ? 0 : ${v}Go * ${pw});`);
      else if(m.mode==='positions')loop.push(`            if (${A}) ${v}.setPosition(${pA}); else if (${B}) ${v}.setPosition(${pB});${hasC?` else if (${C}) ${v}.setPosition(${pC});`:''}`);
      else if(m.mode==='momentary')loop.push(`            ${v}.setPosition(${A} ? ${pB} : ${pA});`);
      else if(m.mode==='follow')loop.push(`            ${v}.setPosition(${pA} + (${pB} - ${pA}) * Math.max(0, Math.min(1, ${/trigger$/.test(m.a)?A:`(${A} + 1) / 2`})));`);
      else loop.push(`            boolean ${v}Now = ${A};`,`            if (${v}Now && !${v}Was) { ${v}On = !${v}On; ${v}.setPosition(${v}On ? ${pB} : ${pA}); }`,`            ${v}Was = ${v}Now;`);});
    return {imports:[...new Set(imports)],init,loop};}
  // The same, in JavaScript, one loop: what the mechanism is told with the controller as it is. st: its own memory (kept
  // between loops). Returns {power} for a motor or a continuous servo, {position, at (which of its positions, or null)} for a servo.
  function mechStep(m,st,pad){const p=pad||{},on=b=>held(p,b),ax=c=>c==='triggers'?(p.rt||0)-(p.lt||0):c==='right_trigger'?p.rt||0:c==='left_trigger'?p.lt||0:c==='left_stick_y'?-(p.ly||0):c==='left_stick_x'?p.lx||0:c==='right_stick_y'?-(p.ry||0):c==='right_stick_x'?p.rx||0:0,pw=Math.max(.05,Math.min(1,+m.power||1)),hasB=m.b&&m.b!=='none';
    if(m.kind!=='servo'){if(m.mode==='hold'||m.mode==='updown')return {power:on(m.a)?pw:hasB&&on(m.b)?-pw:0};
      if(m.mode==='toggle'){const now=on(m.a);if(now&&!st.was)st.on=!st.on;st.was=now;return {power:hasB&&on(m.b)?-pw:st.on?pw:0};}
      if(m.mode==='axis'){const v=ax(m.a);return {power:Math.abs(v)<.05?0:v*pw};}return {power:0};}
    if(st.position===undefined){st.position=null;st.at=null;}const set=(v,at)=>{st.position=v;st.at=at;};
    if(m.mode==='positions'){if(on(m.a))set(m.posA,0);else if(on(m.b))set(m.posB,1);else if(m.c&&m.c!=='none'&&on(m.c))set(m.posC,2);}
    else if(m.mode==='flip'){const now=on(m.a);if(now&&!st.was){st.on=!st.on;set(st.on?m.posB:m.posA,st.on?1:0);}st.was=now;}
    else if(m.mode==='momentary')set(on(m.a)?m.posB:m.posA,on(m.a)?1:0);
    else if(m.mode==='follow'){const v=ax(m.a),t=Math.max(0,Math.min(1,/trigger$/.test(m.a)?v:(v+1)/2));set(m.posA+(m.posB-m.posA)*t,null);}
    return {position:st.position,at:st.at};}
  // A part of the controller doing two jobs: [{button, name, uses: [what]}]. The chassis's own are on controller 1.
  function clashes(list,{pad='gamepad1',map,swerve=true}={}){const by=new Map(),put=(c,t)=>{for(const b of partsOf(c)){if(!by.has(b))by.set(b,[]);if(!by.get(b).includes(t))by.get(b).push(t);}},NAME={...BUTTONS,left_stick_x:'Left stick, left and right',left_stick_y:'Left stick, up and down',right_stick_x:'Right stick, left and right',right_stick_y:'Right stick, up and down'};
    if(pad==='gamepad1')for(const b of chassisParts(map,swerve))put(b,'the chassis');for(const m of list||[]){if(!m||m.mode==='off')continue;const u=usesOf(m.mode,m.states);put(m.a,m.label);if(u[1]!==null)put(m.b,m.label);if(u[2]!==null)put(m.c,m.label);}
    return [...by].filter(([,u])=>u.length>1).map(([button,uses])=>({button,name:NAME[button]||button,uses}));}
  // The mechanisms written into a chassis TeleOp's source: their devices before waitForStart, their buttons every loop.
  function withMechanisms(source,o){const c=mechCode(o.mechanisms,o.pad==='gamepad2'?'gamepad2':'gamepad1');if(!c.init.length)return source;const lines=source.split('\n'),at=t=>lines.findIndex(l=>l===t),w=at('        waitForStart();'),missing=c.imports.filter(i=>!lines.includes(`import ${i};`));
    if(w<0)return source;lines.splice(w,0,'        // The mechanisms, as Setup has them and the TeleOp tab mapped them.',...c.init);
    const t=lines.findIndex(l=>/^            telemetry\.addData\("Heading"/.test(l));lines.splice(t<0?lines.length:t,0,'            // Mechanisms.',...c.loop);
    if(missing.length){const first=lines.findIndex(l=>/^import /.test(l)),lastI=lines.reduce((k,l,i)=>/^import /.test(l)?i:k,-1),all=[...lines.slice(first,lastI+1),...missing.map(i=>`import ${i};`)].sort();lines.splice(first,lastI-first+1,...all);}
    return lines.join('\n');}
  // The hub as Calibrate found it mounted (o.imu.mount: {code, imports, note} from DeckHubMount.javaOf), else as Setup has it.
  const imu=o=>['        IMU imu = hardwareMap.get(IMU.class, '+str(o.imu?.name||'imu')+');',...(o.imu?.mount?.note?[`        // The hub is ${o.imu.mount.note}.`]:[]),`        imu.initialize(new IMU.Parameters(${o.imu?.mount?.code||`new RevHubOrientationOnRobot(RevHubOrientationOnRobot.LogoFacingDirection.${FACE[o.robot?.hubLogo]||'UP'}, RevHubOrientationOnRobot.UsbFacingDirection.${FACE[o.robot?.hubUsb]||'FORWARD'})`}));`];
  const COMMON=['com.qualcomm.hardware.rev.RevHubOrientationOnRobot','com.qualcomm.robotcore.eventloop.opmode.LinearOpMode','com.qualcomm.robotcore.eventloop.opmode.TeleOp','com.qualcomm.robotcore.hardware.DcMotor','com.qualcomm.robotcore.hardware.DcMotorSimple','com.qualcomm.robotcore.hardware.IMU','org.firstinspires.ftc.robotcore.external.navigation.AngleUnit'];
  // pods: [{drive, reversed, servo, encoder, x, y (inches from the middle), zero (volts), encoderSign, servoSign,
  //         gain (a second), leadP, leadN (seconds), creepP, creepN (power), creepSpeedP, creepSpeedN, slope (degrees a
  //         second per power), top, pushP, pushN (degrees a second), zone, ease (degrees), still (degrees a second), lag
  //         (seconds), volts (one turn)}]: the steering loop as Calibrate tuned it (ui/sim-chassis-cal.js steerStep).
  // One pod's steering loop in Java, the same steps as ui/sim-chassis-cal.js steerStep and TorqueDebug.java's steer: in the
  // TeleOp, and in the calibration class teams copy into their own code.
  const STEER_CLASS=[
      '    /**','     * One pod\'s steering, as Torque tuned it on the robot. A continuous servo is a speed: it turns only past a start power',
      '     * (different each way), tops out, does what it is told a little later, and slows only when its power goes to nothing. So',
      '     * it goes in at full power, cuts the power where the wheel will stop just short of the angle, then pushes it the rest of the',
      '     * way from a standstill; power off inside the tolerance. Error and angle in degrees, left positive; P is positive servo power.','     */',
      '    static final class Steer {','        final double sign, gain, leadP, leadN, creepP, creepN, creepSpeedP, creepSpeedN, slope, top, pushP, pushN, zone, ease, still, lag, tol;',
      '        double t, speed, wait, lagLeft, fire, firePower, fireDir, from = Double.NaN, aim, learnedP = 1, learnedN = 1, boostP, boostN, tryT, tryM = Double.NaN, lastGo, lastLead, inT, asked; boolean rest, moved, run;',
      '        final double[] raw = new double[3], ht = new double[5], hm = new double[5], pipeFrom = new double[128], pipeAt = new double[128], pipeGo = new double[128]; int rawN, hn, head, count;',
      '        /** sign: SERVO_SIGN (+1 when positive power turns the wheel left). Then the numbers Calibrate measured, and the tolerance. */',
      '        Steer(double sign, double gain, double leadP, double leadN, double creepP, double creepN, double creepSpeedP, double creepSpeedN, double slope, double top, double pushP, double pushN, double zone, double ease, double still, double lag, double tol) {',
      '            this.sign = sign < 0 ? -1 : 1; this.gain = gain; this.leadP = leadP; this.leadN = leadN; this.creepP = creepP; this.creepN = creepN; this.creepSpeedP = creepSpeedP; this.creepSpeedN = creepSpeedN;',
      '            this.slope = Math.max(1e-6, slope); this.top = top; this.pushP = Math.max(1e-6, pushP); this.pushN = Math.max(1e-6, pushN); this.zone = zone; this.ease = ease; this.still = still; this.lag = lag; this.tol = tol;','        }',
      '        static double wrap(double x) { return x - 360.0 * Math.round(x / 360.0); }',
      '        /** The target jumped: a push under way is dropped (what it learned about its pushes is kept). */','        void retarget() { from = Double.NaN; wait = 0; fire = 0; rest = false; }',
      '        /** The servo\'s power for this step. error: target minus angle; dt: seconds since the last step (the real time). */',
      '        double step(double error, double angle, double dt) {','            double g = sign;','            dt = Math.max(0.002, Math.min(0.1, dt)); t += dt;',
      '            // The middle of the last three readings: one wild reading (a motor starting disturbs the encoder\'s voltage) is dropped.',
      '            if (rawN < 3) raw[rawN++] = angle; else { raw[0] = raw[1]; raw[1] = raw[2]; raw[2] = angle; }','            double off = 0;',
      '            if (rawN == 3) { double a0 = wrap(raw[0] - angle), b0 = wrap(raw[1] - angle); off = Math.max(Math.min(a0, b0), Math.min(Math.max(a0, b0), 0)); }',
      '            double m = angle + off, ef = wrap(error - off), a = Math.abs(ef), dir = ef < 0 ? -1 : 1;',
      '            if (hn < 5) { ht[hn] = t; hm[hn++] = m; } else { for (int i = 0; i < 4; i++) { ht[i] = ht[i + 1]; hm[i] = hm[i + 1]; } ht[4] = t; hm[4] = m; }',
      '            speed = hn < 3 ? 0 : Math.abs(wrap(m - hm[0])) / (t - ht[0]);',
      '            // What the commands still on their way will add. A command shows lead seconds after it is given and lasts until the',
      '            // next step, so the last one goes on the list now, with the time it really lasted.',
      '            if (lastGo != 0) {','                if (count == pipeAt.length) { head = (head + 1) % pipeAt.length; count--; }',
      '                int at = (head + count) % pipeAt.length; pipeFrom[at] = t - dt + lastLead; pipeAt[at] = t + lastLead; pipeGo[at] = lastGo * dt; count++; lastGo = 0;','            }',
      '            while (count > 0 && pipeAt[head] <= t) { head = (head + 1) % pipeAt.length; count--; }','            double coming = 0; int waiting = 0;',
      '            for (int i = 0; i < count; i++) { int j = (head + i) % pipeAt.length; if (pipeAt[j] > t) { coming += pipeGo[j] * Math.min(1, (pipeAt[j] - t) / (pipeAt[j] - pipeFrom[j])); waiting++; } }',
      '            boolean idle = waiting == 0 && speed <= still;',
      '            // At rest it stays off until it is clearly out again.','            if (rest) { if (a <= tol * 1.6) return 0; rest = false; }',
      '            // Inside the tolerance the power is off. It is at rest once it has stayed there, stopped, for 80 ms.',
      '            if (a <= tol) { fire = 0; tryT = 0; tryM = Double.NaN; inT += dt; if (idle && inT >= 0.08) { rest = true; wait = 0; from = Double.NaN; } return 0; }',
      '            // Stopped a little outside the tolerance but well inside what is allowed (the tolerance is 0.6 of that): left alone.',
      '            if (a <= tol * 1.35 && idle && fire <= 0 && wait <= 0) { tryT = 0; tryM = Double.NaN; inT += dt; if (inT >= 0.08) { rest = true; from = Double.NaN; } return 0; }','            inT = 0;',
      '            // Outside the zone it is an approach. An approach gets one run in: once it has cut its power near the target, what',
      '            // is left is done with pushes from a standstill.','            if (a > zone) { wait = 0; fire = 0; from = Double.NaN; if (!run) asked = 0; run = true; }',
      '            // A push under way: the rest of it, then power off until the wheel has moved and stopped (or lag passes with nothing).',
      '            if (fire > 0) { fire -= dt; return g * fireDir * firePower; }',
      '            if (wait > 0) { wait -= dt; lagLeft -= dt; if (speed > still) moved = true; if (wait > 0 && (moved ? speed > still : lagLeft > 0)) return 0; wait = 0; }',
      '            if (idle && a <= zone) {','                // Stopped a little off: a push. From a standstill a pod lurches rather than creeps, so the push is the creep power',
      '                // for the distance over the speed a push from rest really gives. What the last push did corrects the next, each way.',
      '                boolean pos = g * dir > 0;','                if (!Double.isNaN(from)) {',
      '                    double went = fireDir * wrap(m - from); boolean wasPos = g * fireDir > 0; double learned = wasPos ? learnedP : learnedN;',
      '                    // Nothing moved (a sticky spot): more power and a little longer. It moved: half of that extra power back, and',
      '                    // further or less far than aimed makes the next one shorter or longer in proportion.',
      '                    if (went < tol * 0.25) { if (wasPos) boostP = Math.min(0.25, boostP + 0.025); else boostN = Math.min(0.25, boostN + 0.025); learned = Math.max(0.25, learned * 0.8); }',
      '                    else { if (wasPos) boostP *= 0.5; else boostN *= 0.5; learned = Math.max(0.25, Math.min(4, learned * Math.pow(Math.max(0.5, Math.min(2, went / aim)), 0.7))); }',
      '                    if (wasPos) learnedP = learned; else learnedN = learned;','                }',
      '                double want = (a - tol * 0.3) / (pos ? pushP * learnedP : pushN * learnedN), time = Math.max(0.006, Math.min(0.12, want));',
      '                tryT = 0; tryM = Double.NaN; from = m; aim = a - tol * 0.3; fireDir = dir; firePower = Math.min(1, pos ? creepP + boostP : creepN + boostN); fire = time - dt; wait = lag + 0.4; lagLeft = lag; moved = false;',
      '                return g * dir * firePower;','            }',
      '            // The approach. A continuous servo slows down only when its power goes to nothing (it brakes); given less power it',
      '            // just runs on. So the speed asked for only ever goes up (gain times the distance left once the commands on their',
      '            // way have played out, full power when far), and then the power is cut, at the point from which the wheel stops',
      '            // a little short of the target (ease): a push finishes it. Stopping short is cheap; going past means coming back.',
      '            from = Double.NaN; double ap = ef - coming, A = Math.abs(ap), D = ap < 0 ? -1 : 1; boolean pos = g * D > 0; double lead = pos ? leadP : leadN;',
      '            // Trying for longer than a command takes to show with nothing to show for it: this spot takes more power than was',
      '            // measured, so the creep gets more, that way only, until the wheel moves on; each tolerance of progress takes some back.',
      '            if (Double.isNaN(tryM) || Math.abs(wrap(m - tryM)) > tol) { if (!Double.isNaN(tryM)) { boostP *= 0.85; boostN *= 0.85; } tryM = m; tryT = 0; }',
      '            tryT += dt;','            if (!run) return 0;','            if (A <= ease || D != dir) { run = false; asked = 0; return 0; }',
      '            if (tryT > lead + 0.08) { if (pos) boostP = Math.min(0.25, boostP + 0.4 * dt); else boostN = Math.min(0.25, boostN + 0.4 * dt); }',
      '            double c = pos ? creepP : creepN, vc = pos ? creepSpeedP : creepSpeedN; asked = Math.max(asked, Math.min(top, Math.max(vc, gain * (A - ease)))); boolean full = asked >= top * 0.97;',
      '            double u = full ? 1 : Math.min(1, c + (pos ? boostP : boostN) + (asked - vc) / slope);',
      '            // A crawling wheel stops almost where it is when the power goes; from a sixth of top speed up it runs on for the whole lead.',
      '            lastGo = D * (full ? top : asked); lastLead = lead * Math.max(0.3, Math.min(1, asked / (top * 0.17)));','            return g * D * u;','        }','    }'];
  // What every program that drives these pods starts from: their devices, where they are, and each one's steering as
  // Calibrate measured it. The TeleOp has them, and so does the autonomous Simulate writes (ui/sim-ftc.js).
  function swerveConstants(o){const p=o.pods,col=(f,fn=dbl)=>list(p.map(x=>fn(x[f])));
    return [
      `    static final String[] DRIVE = ${col('drive',str)}, STEER = ${col('servo',str)}, ENCODER = ${col('encoder',str)};`,
      `    static final boolean[] DRIVE_REVERSED = ${col('reversed',v=>String(!!v))};`,
      `    // Where each pod is from the middle of the robot, inches: forward, then left.`,`    static final double[] POD_X = ${col('x')}, POD_Y = ${col('y')};`,
      `    // Each pod's steering as calibrated: its encoder's reading with the wheel straight, which way the reading and the`,`    // servo go for a turn to the left, and its own loop as measured on the robot (P: positive servo power, N: negative).`,
      `    static final double[] ZERO_VOLTS = ${col('zero')};`,`    static final int[] ENCODER_SIGN = ${col('encoderSign',v=>String(v<0?-1:1))}, SERVO_SIGN = ${col('servoSign',v=>String(v<0?-1:1))};`,
      `    // GAIN: degrees a second wanted per degree left. LEAD: seconds a command takes to show. CREEP: the least power that`,`    // keeps the wheel turning, and the speed it gives. Then the speed a unit of power buys, and the top speed.`,
      `    static final double[] GAIN = ${col('gain')}, LEAD_P_SECONDS = ${col('leadP')}, LEAD_N_SECONDS = ${col('leadN')};`,
      `    static final double[] CREEP_P = ${col('creepP')}, CREEP_N = ${col('creepN')}, CREEP_P_DEGREES_A_SECOND = ${col('creepSpeedP')}, CREEP_N_DEGREES_A_SECOND = ${col('creepSpeedN')};`,
      `    static final double[] DEGREES_A_SECOND_PER_POWER = ${col('slope')}, TOP_DEGREES_A_SECOND = ${col('top')};`,
      `    // Stopped inside ZONE_DEGREES of the target the servo gets pushes: the creep power for the distance over PUSH (what a push from rest gives). It eases to the`,`    // creep EASE_DEGREES out; STILL_DEGREES_A_SECOND counts as stopped; a push takes PUSH_WAIT_SECONDS to show.`,
      `    static final double[] PUSH_P_DEGREES_A_SECOND = ${col('pushP')}, PUSH_N_DEGREES_A_SECOND = ${col('pushN')}, ZONE_DEGREES = ${col('zone')}, EASE_DEGREES = ${col('ease')};`,
      `    static final double[] STILL_DEGREES_A_SECOND = ${col('still')}, PUSH_WAIT_SECONDS = ${col('lag')};`,
      `    static final double VOLTS_PER_TURN = ${dbl(p[0]?.volts||3.3)}, TOLERANCE_DEGREES = ${dbl(o.tolerance||.9)}, IMU_SCALE = ${dbl(o.imu?.scale||1)};`];}
  const NEW_STEER='new Steer(SERVO_SIGN[i], GAIN[i], LEAD_P_SECONDS[i], LEAD_N_SECONDS[i], CREEP_P[i], CREEP_N[i], CREEP_P_DEGREES_A_SECOND[i], CREEP_N_DEGREES_A_SECOND[i], DEGREES_A_SECOND_PER_POWER[i], TOP_DEGREES_A_SECOND[i], PUSH_P_DEGREES_A_SECOND[i], PUSH_N_DEGREES_A_SECOND[i], ZONE_DEGREES[i], EASE_DEGREES[i], STILL_DEGREES_A_SECOND[i], PUSH_WAIT_SECONDS[i], TOLERANCE_DEGREES)';
  // What a swerve still needs before anything is written for it: '' when it is ready.
  function swerveMissing(o){const p=o?.pods||[];if(!p.length)return 'This chassis has no pods to drive.';const bare=p.filter(x=>!x.servo||!x.encoder||!Number.isFinite(x.zero)).map(x=>x.label||x.drive);
    return bare.length?`Set the wheels straight first, with an absolute encoder on every pod: ${bare.join(', ')}.`:'';}
  // The pieces another program needs to drive the same pods: {error} or {constants (lines), steer (the Steer class, lines),
  // newSteer (the expression that makes pod i's loop), imports}.
  function swerveParts(o){const error=swerveMissing(o);return error?{error}:{constants:swerveConstants(o),steer:STEER_CLASS.slice(),newSteer:NEW_STEER,imports:['com.qualcomm.hardware.lynx.LynxModule','com.qualcomm.robotcore.hardware.AnalogInput','com.qualcomm.robotcore.hardware.CRServo']};}
  function swerve(o,m){const lock=m.lock!=='none';
    return [...head(o,[...COMMON,...(o.imu?.mount?.imports||[]),'com.qualcomm.hardware.lynx.LynxModule','com.qualcomm.robotcore.hardware.AnalogInput','com.qualcomm.robotcore.hardware.CRServo']),
      ...swerveConstants(o),
      '',
      ...STEER_CLASS,'',
      '    @Override public void runOpMode() {','        int n = DRIVE.length;','        DcMotor[] drive = new DcMotor[n];','        CRServo[] steer = new CRServo[n];','        AnalogInput[] encoder = new AnalogInput[n];','        double radius = 1e-6;',
      '        for (int i = 0; i < n; i++) {','            drive[i] = hardwareMap.get(DcMotor.class, DRIVE[i]);','            drive[i].setDirection(DRIVE_REVERSED[i] ? DcMotorSimple.Direction.REVERSE : DcMotorSimple.Direction.FORWARD);','            drive[i].setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);',
      '            steer[i] = hardwareMap.get(CRServo.class, STEER[i]);','            encoder[i] = hardwareMap.get(AnalogInput.class, ENCODER[i]);','            radius = Math.max(radius, Math.hypot(POD_X[i], POD_Y[i]));','        }',...imu(o),
      '        double[] target = new double[n], steered = new double[n], steerPower = new double[n], speed = new double[n];','        Steer[] loop = new Steer[n];',`        for (int i = 0; i < n; i++) loop[i] = ${NEW_STEER};`,'        // One read of each hub a loop: every encoder and motor from the same instant, and a quicker loop (as it was tuned).','        java.util.List<LynxModule> hubs = hardwareMap.getAll(LynxModule.class);','        for (LynxModule hub : hubs) hub.setBulkCachingMode(LynxModule.BulkCachingMode.MANUAL);','        waitForStart();','        imu.resetYaw();','        long last = System.nanoTime();',
      '        while (opModeIsActive()) {','            for (LynxModule hub : hubs) hub.clearBulkCache();','            long now = System.nanoTime();','            double dt = Math.max(1e-3, (now - last) / 1e9);','            last = now;',...sticks(m),
      '            boolean moving = Math.hypot(forward, left) > 0.05 || Math.abs(turn) > 0.05;','            double top = 1;',...(lock?[`            boolean lock = gamepad1.${m.lock};`]:[]),
      '            // Each pod goes the way the robot is moving there: the drive, plus the turn about the middle.',
      '            for (int i = 0; i < n; i++) {','                double vx = forward - turn * POD_Y[i] / radius, vy = left + turn * POD_X[i] / radius;','                speed[i] = Math.hypot(vx, vy);','                if (moving) target[i] = Math.toDegrees(Math.atan2(vy, vx));','                top = Math.max(top, speed[i]);','            }',
      ...(lock?['            // Lock: every wheel turned to point at the middle of the robot and stopped, so it cannot be pushed off its spot.','            if (lock) for (int i = 0; i < n; i++) target[i] = Math.toDegrees(Math.atan2(POD_Y[i], POD_X[i]));']:[]),
      '            for (int i = 0; i < n; i++) {','                double angle = ENCODER_SIGN[i] * (encoder[i].getVoltage() - ZERO_VOLTS[i]) / VOLTS_PER_TURN * 360.0;','                double error = target[i] - angle;','                error -= 360.0 * Math.round(error / 360.0);',`                double wheel = moving${lock?' && !lock':''} ? speed[i] / top : 0;`,
      '                // The shortest way to get the wheel pushing where it should. More than a quarter turn away, the motor runs',
      '                // backwards instead and the pod turns the short way (stick back: the pods stay forward and the motors reverse).',
      '                // At a quarter turn both are as far: the one that leaves the pod facing forward or left is taken, so right is',
      '                // "pods left, motors backwards", as left is "pods left, motors forwards".',
      '                boolean flip = Math.abs(error) > 95;',
      '                if (!flip && Math.abs(error) >= 85) { double end = target[i] - 360.0 * Math.round(target[i] / 360.0); flip = end <= -90 || end > 90; }',
      '                if (flip) { error -= Math.signum(error) * 180; wheel = -wheel; }',
      '                // The steering loop takes a step every loop, with the time that really passed.',
      '                if (Math.abs(target[i] - steered[i]) > 1) { loop[i].retarget(); steered[i] = target[i]; }','                double power = steerPower[i] = loop[i].step(error, angle, dt);',
      '                steer[i].setPower(Math.max(-1, Math.min(1, power)));','                // A wheel still turning to its angle pushes less, so it does not drag the robot sideways.','                drive[i].setPower(wheel * Math.cos(Math.toRadians(error)));','            }',
      '            telemetry.addData("Heading", "%.1f", Math.toDegrees(heading));','            telemetry.update();','        }','    }','}',''].join('\n');}
  // motors: [{key, name, reversed}] by Deck's keys. A mecanum's four; a tank's by side.
  // A chassis whose wheels do not steer. o.kind: 'mecanum', 'xdrive' and 'butterfly' (four wheels that between them push
  // any way: one mix for all three, as their rollers or their angles work out the same), 'kiwi' (three omni wheels, each
  // across its corner), 'tank' (two sides; no sideways).
  const KIWI=.866025;
  function wheelMix(key,kind){const side=/right/i.test(key)?'right':'left',front=/front/i.test(key);
    if(kind==='tank')return side==='left'?'forward - turn':'forward + turn';
    if(kind==='kiwi')return front&&!/left|right/i.test(key)?'left + turn':side==='left'?`-${KIWI} * forward - 0.5 * left + turn`:`${KIWI} * forward - 0.5 * left + turn`;
    return ({'left front':'forward - left - turn','right front':'forward + left + turn','left back':'forward + left - turn','right back':'forward - left + turn'})[`${side} ${front?'front':'back'}`];}
  const WHEELED={mecanum:'A mecanum drive: forward and back, sideways on its rollers, any diagonal between, and turning, all at once.',xdrive:'An X-drive: four omni wheels at 45°, so it goes any way like a mecanum (the same mix).',butterfly:'A butterfly drive on its mecanum wheels: any way at once. Its shift to the traction wheels is a mechanism of its own.',
    kiwi:'A kiwi drive: three omni wheels, each across its corner. Positive power on a wheel turns the robot to the left (counterclockwise from above).',tank:'A tank drive: both sides together drive it, one against the other turns it. It cannot go sideways.'};
  function wheels(o,m){const ms=o.motors,kind=o.kind,tank=kind==='tank';
    return [...head(o,[...COMMON,...(o.imu?.mount?.imports||[])]),`    static final String[] DRIVE = ${list(ms.map(x=>str(x.name)))};`,`    static final boolean[] DRIVE_REVERSED = ${list(ms.map(x=>String(!!x.reversed)))};`,`    static final double IMU_SCALE = ${dbl(o.imu?.scale||1)};`,'',
      '    @Override public void runOpMode() {','        int n = DRIVE.length;','        DcMotor[] drive = new DcMotor[n];','        for (int i = 0; i < n; i++) {','            drive[i] = hardwareMap.get(DcMotor.class, DRIVE[i]);','            drive[i].setDirection(DRIVE_REVERSED[i] ? DcMotorSimple.Direction.REVERSE : DcMotorSimple.Direction.FORWARD);','            drive[i].setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);','        }',...imu(o),
      '        waitForStart();','        imu.resetYaw();','        while (opModeIsActive()) {',...sticks(tank?{...m,field:'no'}:m),
      `            // ${WHEELED[kind]||WHEELED.mecanum} Every motor is scaled together, so none is asked for more than full power.`,
      `            double[] power = ${list(ms.map(x=>wheelMix(x.key,kind)))};`,'            double top = 1;','            for (double p : power) top = Math.max(top, Math.abs(p));','            for (int i = 0; i < n; i++) drive[i].setPower(power[i] / top);',
      '            telemetry.addData("Heading", "%.1f", Math.toDegrees(heading));','            telemetry.update();','        }','    }','}',''].join('\n');}
  // ---- a test of the heading alone -------------------------------------------------------------------------------------
  // An autonomous that uses nothing but the Control Hub's IMU: a short push forward by time, then a turn to each angle in
  // turn, slowing as it nears each one. Where the robot stands at START is 0°, whatever the IMU reads then, and the IMU's
  // yaw is taken the way round and by the scale Calibrate measured (o.imu.scale, negative when it counts backwards). It
  // shows whether the heading the robot's code turns by is right before a whole route depends on it.
  // o: as teleopOf takes (kind, motors, robot, imu, config, date), angles: degrees from the start, left positive.
  const TURN_TEST={className:'TorqueTurnTest',opMode:'Torque IMU turn test',angles:[90,0,-90,0,180,0]};
  function turnTestOf(o){if(!o||o.kind==='swerve'||!Array.isArray(o.motors)||!o.motors.length)return {error:'The IMU turn test is written for a chassis whose wheels do not steer (mecanum, X-drive, tank, kiwi).'};
    const tn={top:.25,least:.07,slowFrom:60,brake:.002,done:1.5,lag:.02,...(o.turn||{})},ms=o.motors,kind=o.kind,angles=(Array.isArray(o.angles)&&o.angles.length?o.angles:TURN_TEST.angles).map(Number).filter(Number.isFinite).slice(0,12),name=o.className||TURN_TEST.className,opMode=o.opMode||TURN_TEST.opMode;
    const imports=[...COMMON.filter(i=>!/\.TeleOp$/.test(i)),'com.qualcomm.robotcore.eventloop.opmode.Autonomous','com.qualcomm.robotcore.util.ElapsedTime',...(o.imu?.mount?.imports||[])];
    const source=[...[...new Set(imports)].sort().map(i=>`import ${i};`),'',`// Written by Torque (Calibrate)${o.date?', '+o.date:''}${o.config?`, from the "${o.config}" configuration`:''}.`,
      '// A test of the heading alone: it uses only the IMU. Put the robot down facing the way that is 0° and press START:','// it rolls forward a little, then turns to each angle below, slowing as it nears each one. Left is positive.',
      `@Autonomous(name = ${str(opMode)}, group = "Torque")`,`public class ${name} extends LinearOpMode {`,
      `    static final String[] DRIVE = ${list(ms.map(x=>str(x.name)))};`,`    static final boolean[] DRIVE_REVERSED = ${list(ms.map(x=>String(!!x.reversed)))};`,
      '    // The IMU\'s yaw is multiplied by this: its scale, and -1 when Calibrate found it counts a turn to the left as a turn to the right.',`    static final double IMU_SCALE = ${dbl(o.imu?.scale||1)};`,
      '    // The angles it turns to, in order: degrees from where it stood at START, left positive.',`    static final double[] ANGLES = ${list(angles.map(dbl))};`,
      '    // Turning: the most power, the least that still moves it, how far out it starts to slow, how close counts as there,','    // and how hard it brakes against its own speed (power for each degree a second).',
      `    // ${tn.measured?'Measured on this robot by Calibrate (Tune the turning).':'The gentle defaults: Calibrate → Mechanisms → Tune the turning measures this robot.'}`,`    static final double TOP_TURN = ${dbl(tn.top)}, LEAST_TURN = ${dbl(tn.least)}, SLOW_FROM_DEGREES = ${dbl(tn.slowFrom)}, DONE_DEGREES = ${dbl(tn.done)}, BRAKE = ${dbl(tn.brake)};`,'    // How old the heading is by the time the power reaches the wheels: the IMU read (over I2C on a Control Hub) and half a loop.',`    static final double LAG_SECONDS = ${dbl(+(tn.lag).toFixed(4))};`,'    static final double FORWARD_POWER = 0.25, FORWARD_SECONDS = 0.6;','',
      '    DcMotor[] drive;','    IMU imu;','    double lastYaw, heading;','',
      '    static double wrap(double degrees) { return degrees - 360.0 * Math.round(degrees / 360.0); }','',
      '    /** The heading in degrees since START, left positive: each change in the IMU\'s yaw, the right way round, added up. */',
      '    double read() {','        double yaw = imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES);','        heading += wrap(yaw - lastYaw) * IMU_SCALE;','        lastYaw = yaw;','        return heading;','    }','',
      '    void set(double forward, double left, double turn) {',`        double[] power = ${list(ms.map(x=>wheelMix(x.key,kind)))};`,'        double top = 1;','        for (double p : power) top = Math.max(top, Math.abs(p));','        for (int i = 0; i < drive.length; i++) drive[i].setPower(power[i] / top);','    }','',
      ...TURN_JAVA,'',
      '    /** Turns to an angle and stops there (the Turn law above), and waits a moment to see it stay. */',
      '    void turnTo(double target) {','        Turn turn = new Turn(TOP_TURN, LEAST_TURN, SLOW_FROM_DEGREES, BRAKE, DONE_DEGREES, LAG_SECONDS);','        ElapsedTime time = new ElapsedTime();','        double thereAt = -1;',
      '        while (opModeIsActive() && time.seconds() < 6) {','            double now = read(), t = time.seconds(), power = turn.step(target, now, t);','            set(0, 0, power);',
      '            if (turn.there) { if (thereAt < 0) thereAt = t; else if (t - thereAt >= 0.3) break; } else thereAt = -1;',
      '            telemetry.addData("Turning to", "%.0f", target);','            telemetry.addData("Heading", "%.1f", now);','            telemetry.addData("Left to turn", "%.1f", target - now);','            telemetry.addData("Turn power", "%.2f", power);','            telemetry.update();','            sleep(10);','        }',
      '        set(0, 0, 0);','        sleep(400);','    }','',
      '    @Override public void runOpMode() {','        drive = new DcMotor[DRIVE.length];','        for (int i = 0; i < drive.length; i++) {','            drive[i] = hardwareMap.get(DcMotor.class, DRIVE[i]);','            drive[i].setDirection(DRIVE_REVERSED[i] ? DcMotorSimple.Direction.REVERSE : DcMotorSimple.Direction.FORWARD);','            drive[i].setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);','        }',
      ...imu(o).map(l=>l.replace('        IMU imu = ','        imu = ')),
      '        waitForStart();','        // Where it stands now is 0°, whatever the IMU says.','        lastYaw = imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES);','        heading = 0;',
      '        ElapsedTime time = new ElapsedTime();','        while (opModeIsActive() && time.seconds() < FORWARD_SECONDS) { read(); set(FORWARD_POWER, 0, 0); sleep(10); }','        set(0, 0, 0);','        sleep(300);',
      '        for (double angle : ANGLES) { if (!opModeIsActive()) break; turnTo(angle); }',
      '        while (opModeIsActive()) { telemetry.addData("Done. Heading", "%.1f", read()); telemetry.update(); sleep(50); }','    }','}',''].join('\n');
    return {file:`org/firstinspires/ftc/teamcode/${name}.java`,opMode,source};}
  // ---- turning to an angle: the one law every turn on the spot uses ------------------------------------------------------
  // TorqueDebug.java's TorqueDebugTurn.step and the IMU turn test's Turn class are this, step for step (tests/turn-law.test.cjs).
  // The heading a Control Hub IMU gives is a few ms old and often the same twice running (the IMU had nothing new), so a speed
  // taken from one loop to the next jumps between nothing and double: the brake and the look-ahead then flip the power back and
  // forth, and the robot jitters. Here the speed is taken over at least WINDOW seconds. The least power that turns the robot is
  // only given from rest, and built up from half of it, so a robot near its angle eases off its stop instead of being kicked past
  // it and back. Once it is inside `done` and still, it is there: the power stays off until it is pushed out by twice that.
  // k: {top, least, slowFrom (degrees), brake (power for each degree a second), done (degrees), lag (seconds)}.
  // s: turnState(), one for each turn. h: degrees, left positive; t: seconds. Returns the turn power, -top to top.
  const TURN_LAW={ramp:.25,still:10,window:.05};
  const turnState=()=>({at:NaN,h0:0,rate:0,last:NaN,sent:0,push:0,way:0,there:false});
  function turnStep(s,target,h,t,k){
    if(Number.isNaN(s.at)){s.h0=h;s.at=t;s.last=t;}
    const dt=Math.max(0,t-s.last);s.last=t;
    if(t-s.at>=TURN_LAW.window){s.rate=(h-s.h0)/(t-s.at);s.h0=h;s.at=t;}
    const r=s.rate,err=target-h,ahead=target-(h+r*k.lag),slow=Math.abs(r)<TURN_LAW.still;
    if(s.there){if(Math.abs(err)>2*k.done)s.there=false;}else if(Math.abs(err)<=k.done&&slow)s.there=true;
    let want=0;
    if(!s.there&&Math.abs(ahead)>.5*k.done){let mag=k.top*Math.min(1,Math.abs(ahead)/k.slowFrom);
      if(Math.sign(ahead)!==s.way){s.way=Math.sign(ahead);s.push=0;}
      s.push=slow?Math.min(1.5*k.least,Math.max(s.push,.5*k.least)+dt*2*k.least):Math.max(.5*k.least,s.push-dt*3*k.least);mag=Math.max(mag,s.push);
      want=Math.max(-k.top,Math.min(k.top,Math.sign(ahead)*mag-k.brake*r));}
    else s.push=0;
    const sent=s.sent,step=dt/TURN_LAW.ramp;
    s.sent=Math.abs(want)<Math.abs(sent)||want*sent<0?want:sent+Math.max(-step,Math.min(step,want-sent));
    return s.sent;}
  // The same, in Java, as a class the generated op modes carry.
  const TURN_JAVA=['    /** Turning to an angle (Torque\'s turn law: ui/sim-chassis-teleop.js turnStep). One for each turn. */',
    '    static final class Turn {',
    '        static final double RAMP = 0.25, STILL = 10, WINDOW = 0.05;',
    '        final double top, least, slowFrom, brake, done, lag;',
    '        double at = Double.NaN, h0, rate, last = Double.NaN, sent, push, way;',
    '        boolean there;',
    '        Turn(double top, double least, double slowFrom, double brake, double done, double lag) { this.top = top; this.least = least; this.slowFrom = slowFrom; this.brake = brake; this.done = done; this.lag = lag; }',
    '        double step(double target, double h, double t) {',
    '            if (Double.isNaN(at)) { h0 = h; at = t; last = t; }',
    '            double dt = Math.max(0, t - last); last = t;',
    '            if (t - at >= WINDOW) { rate = (h - h0) / (t - at); h0 = h; at = t; }',
    '            double r = rate, err = target - h, ahead = target - (h + r * lag); boolean slow = Math.abs(r) < STILL;',
    '            if (there) { if (Math.abs(err) > 2 * done) there = false; } else if (Math.abs(err) <= done && slow) there = true;',
    '            double want = 0;',
    '            if (!there && Math.abs(ahead) > 0.5 * done) {',
    '                double mag = top * Math.min(1, Math.abs(ahead) / slowFrom);',
    '                if (Math.signum(ahead) != way) { way = Math.signum(ahead); push = 0; }',
    '                push = slow ? Math.min(1.5 * least, Math.max(push, 0.5 * least) + dt * 2 * least) : Math.max(0.5 * least, push - dt * 3 * least); mag = Math.max(mag, push);',
    '                want = Math.max(-top, Math.min(top, Math.signum(ahead) * mag - brake * r));',
    '            } else push = 0;',
    '            double step = dt / RAMP;',
    '            sent = Math.abs(want) < Math.abs(sent) || want * sent < 0 ? want : sent + Math.max(-step, Math.min(step, want - sent));',
    '            return sent;',
    '        }',
    '    }'];
  // ---- the IMU tuned on the robot ----------------------------------------------------------------------------------------
  // IMU tuning runs inside Torque Debug (src/onbot/TorqueDebug.java, TorqueDebugTurn), the op mode Electronics already runs: Torque
  // sends one U line and the robot does the rest where the turn loop really runs, and says how it goes in each frame's "tt". Nothing
  // is written to the robot. Each tuning first checks which way the heading counts (it turns left a little) and the least power that
  // turns the robot. Then, at each turn power: a spin to see how fast it turns and how far it rolls on once the power is cut (which
  // sets where it starts to slow and how hard it brakes at that power), then four quarter turns (left, back, right, back) three times
  // over. A power is good only if every one of those turns ends inside the tolerance without swinging far past. One tuning tries every
  // power (one that misses does not stop it) and keeps the quickest that lands. check: four quarter turns with the numbers the code turns by.
  const TURN_TUNE={powers:[.5,.6,.7,.75,.8,.85,.9,.95,1],repeats:3};
  // The U line. o: {job: 'tune' | 'check', id, tolerance, turn (turnOf's numbers, for check), heading: {kind: 'hub' | 'pinpoint',
  // name}, mount: {logo, usb} or {quaternion: {w, x, y, z}}, scale (the yaw's factor: its scale, -1 when it counts backwards), motors:
  // [{name, power}] (each drive motor's power for a turn to the left, its direction in it)}. Returns the line, or {error}.
  function turnLineOf(o){if(!o||!Array.isArray(o.motors)||!o.motors.length)return {error:'IMU tuning is written for a chassis whose wheels do not steer (mecanum, X-drive, tank, kiwi).'};
    const job=o.job==='check'?'check':'tune',tol=Math.min(10,Math.max(.5,Number.isFinite(+o.tolerance)?+o.tolerance:2)),k={top:.25,least:.07,slowFrom:60,brake:.002,lag:.02,...(o.turn||{})};
    const fx=(v,d=4)=>String(+(+v||0).toFixed(d)),m=o.mount?.quaternion?`Q:${['w','x','y','z'].map(a=>fx(o.mount.quaternion[a],6)).join(':')}`:`L:${FACE[o.mount?.logo]||'UP'}:${FACE[o.mount?.usb]||'FORWARD'}`;
    const src=o.heading?.kind==='pinpoint'?`pin:${o.heading.name||'pinpoint'}`:`imu:${o.heading?.name||'imu'}`;
    if(o.motors.some(x=>/[\t\n]/.test(x.name||'')))return {error:'A drive motor’s name has a tab in it.'};
    return {line:['U',job,String(Math.round(+o.id||0)),fx(tol,2),fx(k.top,3),fx(k.least,3),fx(k.slowFrom,1),fx(k.brake,5),fx(k.lag,4),src,m,fx(o.scale??1,6),...o.motors.flatMap(x=>[x.name,fx(x.power,3)])].join('\t'),job,tolerance:tol};}
  // What the robot found (the torque.result line), as Torque uses it: {mode, backwards, least, tolerance, repeats, problem, rounds:
  // [{power, rate, coast, slowFrom, brake, worst, over, seconds, ok}], best: the round to turn by (standard: the quickest of the good
  // ones; aggressive: the most power that was good), or null}. null when it is not a result.
  function turnResultOf(text){let raw=String(text??'').trim();const m=/JSON = "((?:\\.|[^"\\])*)";/.exec(raw);if(m)raw=m[1].replace(/\\(.)/g,'$1');let v;try{v=JSON.parse(raw);}catch{return null;}
    if(!v||!Array.isArray(v.rounds))return null;const num=x=>Number.isFinite(+x)?+x:NaN,rounds=v.rounds.map(r=>({power:num(r.power),rate:num(r.rate),coast:num(r.coast),slowFrom:num(r.slowFrom),brake:num(r.brake),worst:num(r.worst),over:num(r.over),seconds:num(r.seconds),ok:r.ok===true})).filter(r=>r.power>0);
    const mode=v.mode==='aggressive'?'aggressive':'standard',good=rounds.filter(r=>r.ok),best=good.length?mode==='aggressive'?good.reduce((a,b)=>b.power>a.power?b:a):good.reduce((a,b)=>b.seconds<a.seconds-.02||(Math.abs(b.seconds-a.seconds)<=.02&&b.worst<a.worst)?b:a):null;
    return {mode,backwards:v.backwards===true,least:num(v.least),tolerance:num(v.tolerance),repeats:num(v.repeats),readMs:num(v.readMs),problem:typeof v.problem==='string'?v.problem:'',rounds,best};}
  // ---- the same drive, in JavaScript ---------------------------------------------------------------------------------
  // What the TeleOp does with the controller each loop, for the TeleOp tab's live picture and for the tests: the Java
  // above is these steps. pad: {lx, ly, rx, ry (sticks, as the Gamepad API gives them: up and left are negative), lt, rt
  // (0 to 1), and each button by its FTC name}.
  const wrapDeg=x=>x-360*Math.round(x/360),held=(pad,b)=>!!b&&b!=='none'&&(/_trigger$/.test(b)?(pad[b==='left_trigger'?'lt':'rt']||0)>.5:!!pad[b]);
  function command(raw,pad,{swerve=true,heading=0}={}){const m=mapOf(raw),p=pad||{},st=k=>k==='left'?[p.lx||0,p.ly||0]:[p.rx||0,p.ry||0],[dx,dy]=st(m.drive);
    const pair={triggers:(p.lt||0)-(p.rt||0),bumpers:(p.left_bumper?1:0)-(p.right_bumper?1:0),dpad:(p.dpad_left?1:0)-(p.dpad_right?1:0)};
    let forward=-dy,left=-dx,turn=m.turn in pair?pair[m.turn]:-st(m.turn)[0];const spin=m.spin in pair?pair[m.spin]:0;if(Math.abs(spin)>.05)turn=spin;
    const slow=held(p,m.slow);if(slow){forward*=.4;left*=.4;turn*=.4;}
    if(m.field==='yes'){const f=forward*Math.cos(heading)+left*Math.sin(heading);left=-forward*Math.sin(heading)+left*Math.cos(heading);forward=f;}
    return {forward,left,turn,slow,lock:swerve&&held(p,m.lock),reset:held(p,m.reset)};}
  // A swerve, one loop: pods [{x, y}] (inches from the middle: forward, left), angles (degrees, where each pod points now:
  // 0 forward, 90 left), targets (where each was last asked to point: kept while the sticks are let go). Returns each pod's
  // {target, error (how far its servo still has to turn, the short way), power (the motor: negative is backwards), flipped}.
  function swerveDrive(pods,angles,targets,cmd){const n=pods.length,radius=Math.max(1e-6,...pods.map(p=>Math.hypot(p.x,p.y))),moving=Math.hypot(cmd.forward,cmd.left)>.05||Math.abs(cmd.turn)>.05,speed=[],out=[];let top=1;
    for(let i=0;i<n;i++){const vx=cmd.forward-cmd.turn*pods[i].y/radius,vy=cmd.left+cmd.turn*pods[i].x/radius;speed[i]=Math.hypot(vx,vy);if(moving)targets[i]=Math.atan2(vy,vx)*180/Math.PI;top=Math.max(top,speed[i]);}
    if(cmd.lock)for(let i=0;i<n;i++)targets[i]=Math.atan2(pods[i].y,pods[i].x)*180/Math.PI;
    for(let i=0;i<n;i++){let error=wrapDeg((targets[i]||0)-(angles[i]||0)),wheel=moving&&!cmd.lock?speed[i]/top:0,flip=Math.abs(error)>95;
      if(!flip&&Math.abs(error)>=85){const end=wrapDeg(targets[i]||0);flip=end<=-90||end>90;}
      if(flip){error-=Math.sign(error)*180;wheel=-wheel;}
      out.push({target:targets[i]||0,error,power:wheel*Math.cos(error*Math.PI/180),flipped:flip});}
    return out;}
  // A chassis whose wheels do not steer, one loop: each motor's power, in the order given. motors: [{key}] by Deck's keys;
  // kind as wheels takes it (true, for a tank, still works).
  function wheelPowers(motors,cmd,kind='mecanum'){if(kind===true)kind='tank';if(kind===false)kind='mecanum';const side=k=>/right/i.test(k)?'right':'left',front=k=>/front/i.test(k),f=cmd.forward,l=kind==='tank'?0:cmd.left,t=cmd.turn;
    const power=motors.map(x=>kind==='tank'?(side(x.key)==='left'?f-t:f+t):kind==='kiwi'?(front(x.key)&&!/left|right/i.test(x.key)?l+t:side(x.key)==='left'?-KIWI*f-.5*l+t:KIWI*f-.5*l+t):({'left front':f-l-t,'right front':f+l+t,'left back':f+l-t,'right back':f-l+t})[`${side(x.key)} ${front(x.key)?'front':'back'}`]),top=Math.max(1,...power.map(Math.abs));return power.map(v=>v/top);}
  // o: {kind:'swerve'|'mecanum'|'xdrive'|'butterfly'|'kiwi'|'tank', pods|motors, robot:{hubLogo, hubUsb}, imu:{name, scale}, tolerance, map, config, date}.
  // Returns {file, opMode, source}, or {error} saying what is not calibrated yet or not written for.
  //   className, opMode: for the whole robot's TeleOp ("TorqueTeleOp", "Torque TeleOp"); the chassis alone keeps its own.
  //   mechanisms: [{label, device, kind, reversed, mode, a, b, power, posA, posB}] (mechCode), pad: 'gamepad1' | 'gamepad2'.
  // Returns {file, opMode, source}, or {error} saying what is not calibrated yet or not written for.
  function teleopOf(o){const m=mapOf(o.map),done=source=>({file:(o.className||NAME)+'.java',opMode:o.opMode||OP_MODE,source:withMechanisms(source,o)});
    if(o.kind==='swerve'){const error=swerveMissing(o);return error?{error}:done(swerve(o,m));}
    if(Object.hasOwn(WHEELED,o.kind)){const need=o.kind==='kiwi'?3:o.kind==='tank'?2:4;if((o.motors||[]).length<need)return {error:`This chassis needs ${need} drive motors: Setup has ${(o.motors||[]).length}.`};return done(wheels(o,{...m,lock:'none'}));}
    if(/^diffSwerve/.test(o.kind||''))return {error:'A differential swerve needs its own calibration (each module’s angle from its two motors) before Torque can write its TeleOp: that is not built yet.'};
    return {error:'Torque writes this TeleOp for swerve, mecanum, X-drive, butterfly, kiwi and tank chassis.'};}
  const api={teleopOf,turnTestOf,TURN_TEST,turnLineOf,turnResultOf,TURN_TUNE,turnStep,turnState,TURN_LAW,TURN_JAVA,mapOf,MAP,DEFAULT,NAME,OP_MODE,FULL_NAME:'TorqueTeleOp',FULL_OP_MODE:'Torque TeleOp',BUTTONS,AXES,MODES,USES,usesOf,modesFor,mechOf,mechMap,mechCode,mechStep,clashes,chassisButtons,chassisParts,partsOf,command,swerveDrive,swerveParts,wheelPowers,wrapDeg,WHEELED,steerClass:()=>STEER_CLASS.slice()};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.DeckChassisTeleop=api;
})(typeof globalThis==='object'?globalThis:this);
