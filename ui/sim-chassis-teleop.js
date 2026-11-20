'use strict';
// A TeleOp written from what Calibrate checked on the real robot: which way each motor rolls its wheel, each swerve pod's
// zero, directions and tuned steering loop, the heading correction, and the controller mapping the team picked. The
// chassis is on the sticks; each mechanism from Setup (o.mechanisms) is on buttons. It is one OnBot Java file with no
// package (a packaged class crash-loops some Robot Controller builds), so Send puts it on the robot as it is and it
// shows in Drive's op mode list: "Torque Chassis" for the chassis alone (Calibrate → Mechanisms → Drive it), "Torque
// TeleOp" for the whole robot (Calibrate → Real run).
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
  // What a mechanism does in the TeleOp, by what drives it. A motor or a continuous servo: runs while a button is held
  // (and backwards on another), is switched on and off by a button, or goes up and down on two buttons (a motor, braked
  // when let go). A servo: a button for each of two positions, or one button that flips between them.
  const BUTTONS={right_trigger:'Right trigger',left_trigger:'Left trigger',right_bumper:'Right bumper',left_bumper:'Left bumper',a:'A / Cross',b:'B / Circle',x:'X / Square',y:'Y / Triangle',dpad_up:'D-pad up',dpad_down:'D-pad down',dpad_left:'D-pad left',dpad_right:'D-pad right',left_stick_button:'Left stick click',right_stick_button:'Right stick click',back:'Back / Share'};
  const MODES={hold:'Runs while a button is held',toggle:'One button switches it on and off',updown:'Up and down on two buttons',positions:'A button for each of two positions',flip:'One button flips between two positions',off:'Not in this TeleOp'};
  const modesFor=kind=>kind==='servo'?['flip','positions','off']:kind==='crservo'?['hold','toggle','off']:['hold','toggle','updown','off'];
  // Which buttons a mode uses: [what the first does, what the second does (or nothing)].
  const USES={hold:['Runs it','Runs it backwards'],toggle:['On and off','Backwards while held'],updown:['Up','Down'],positions:['First position','Second position'],flip:['Flips it',null],off:[null,null]};
  const SPIN=/flywheel|roller|feeder|conveyor|spinner|spindle|spin|propeller/;
  // A mechanism's choices, whole: {mode, a, b, power, posA, posB}. free: the buttons nothing else has, in order; the ones
  // it takes are removed from it. What it is decides how it starts: a flywheel is switched on and off, an intake runs
  // while held (and backwards), a lift or an arm goes up and down, a servo flips between two positions.
  function mechOf(m,raw,free){const kind=m.kind==='servo'?'servo':m.kind==='crservo'?'crservo':'motor',modes=modesFor(kind),r=raw&&typeof raw==='object'?raw:{},num=(v,d,lo,hi)=>Number.isFinite(+v)&&v!==''&&v!==null&&v!==undefined?Math.max(lo,Math.min(hi,+v)):d;
    const spins=SPIN.test(String(m.type||''))||m.template==='T3'||kind==='crservo',start=kind==='servo'?'flip':/flywheel/.test(m.type||'')?'toggle':spins?'hold':'updown';
    const mode=modes.includes(r.mode)?r.mode:start,out={mode,a:'none',b:'none',power:+num(r.power,1,.05,1).toFixed(2),posA:+num(r.posA,num(m.posA,.5,0,1),0,1).toFixed(3),posB:+num(r.posB,num(m.posB,.5,0,1),0,1).toFixed(3)};
    if(mode==='off')return out;
    const has=b=>!!b&&b!=='none'&&free.includes(b),take=b=>{free.splice(free.indexOf(b),1);return b;},next=()=>free.length?free.shift():'none';
    const needB=mode==='updown'||mode==='positions',wantsB=needB||has(r.b)||r.b===undefined&&mode==='hold'&&/intake|roller/.test(m.type||'');
    // Up and down starts on a pair that reads as up and down.
    const pair=mode==='updown'&&!has(r.a)&&!has(r.b)?[['dpad_up','dpad_down'],['y','a'],['right_trigger','left_trigger'],['right_bumper','left_bumper'],['dpad_right','dpad_left']].find(q=>q.every(b=>free.includes(b))):null;
    if(pair){out.a=take(pair[0]);out.b=take(pair[1]);return out;}
    const bPick=has(r.b)?take(r.b):null;out.a=has(r.a)?take(r.a):next();if(wantsB)out.b=bPick||next();else if(bPick)free.unshift(bPick);
    // No button left for it: it is left out, and says so.
    if(out.a==='none'||needB&&out.b==='none'){for(const b of [out.b,out.a])if(b!=='none')free.unshift(b);return {...out,mode:'off',a:'none',b:'none',full:true};}
    return out;}
  // Every mechanism's choices at once, in the list's order. pad: 'gamepad1' shares the controller with the chassis (its
  // buttons are taken first), 'gamepad2' has a controller to itself. A button the team picked stays with the mechanism
  // it was picked for (the first, if two picked it); the others take what is left, in order.
  function mechMap(list,raw,{pad='gamepad1',map,swerve=true}={}){const taken=pad==='gamepad1'?chassisButtons(map,swerve):[],free=Object.keys(BUTTONS).filter(b=>!taken.includes(b)),out={},claimed=new Set(),picked={};
    for(const m of list){const r=raw?.[m.id];if(!r||r.mode==='off')continue;const mine={};for(const k of ['a','b']){const b=r[k];if(b&&b!=='none'&&free.includes(b)&&!claimed.has(b)){claimed.add(b);mine[k]=b;}}picked[m.id]=mine;}
    const pool=free.filter(b=>!claimed.has(b));
    for(const m of list){const r=raw?.[m.id],mine=picked[m.id]||{},local=[...Object.values(mine),...pool],before=new Set(local);
      out[m.id]=mechOf(m,r?{...r,a:mine.a||(r.a==='none'?'none':undefined),b:mine.b||(r.b==='none'?'none':undefined)}:r,local);
      for(const b of before)if(!local.includes(b)&&pool.includes(b))pool.splice(pool.indexOf(b),1);for(const b of Object.values(mine))if(local.includes(b)&&!pool.includes(b))pool.unshift(b);}
    return out;}
  const pressed=(pad,b)=>/_trigger$/.test(b)?`${pad}.${b} > 0.5`:`${pad}.${b}`;
  const RESERVED=new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null n drive steer encoder radius imu target steered steerPower speed loop hubs hub last now dt forward left turn spin heading f moving top lock power p i vx vy angle error wheel telemetry gamepad1 gamepad2 hardwareMap'.split(' '));
  // The Java for the mechanisms: {imports, init (before waitForStart), loop (every loop), notes (a comment line each)}.
  // list: [{label, device (its name in the robot configuration), kind: 'motor'|'crservo'|'servo', reversed, mode, a, b, power, posA, posB}].
  function mechCode(list,pad='gamepad1'){const imports=[],init=[],loop=[],names=new Set(),say=b=>BUTTONS[b]||b;
    const ident=(label,i)=>{const w=String(label||'').replace(/[^A-Za-z0-9]+/g,' ').trim().split(' ').filter(Boolean);let id=w.map((x,k)=>k?x[0].toUpperCase()+x.slice(1).toLowerCase():x.toLowerCase()).join('');if(!id||/^[0-9]/.test(id)||RESERVED.has(id))id='mech'+(i+1);while(names.has(id))id+='B';names.add(id);return id;};
    (list||[]).forEach((m,i)=>{if(!m||m.mode==='off'||!MODES[m.mode]||!m.device||!m.a||m.a==='none')return;const v=ident(m.label,i),servo=m.kind==='servo',cls=servo?'Servo':m.kind==='crservo'?'CRServo':'DcMotor',pw=dbl(Math.max(.05,Math.min(1,+m.power||1))),A=pressed(pad,m.a),hasB=m.b&&m.b!=='none',B=hasB?pressed(pad,m.b):null;
      if(servo!==(m.mode==='positions'||m.mode==='flip'))return;if((m.mode==='updown'||m.mode==='positions')&&!hasB)return;if(m.mode==='updown'&&m.kind!=='motor')return;
      imports.push('com.qualcomm.robotcore.hardware.'+cls);
      const what={hold:`hold ${say(m.a)} to run it${hasB?`, ${say(m.b)} to run it backwards`:''}`,toggle:`${say(m.a)} switches it on and off${hasB?`; ${say(m.b)} runs it backwards while held`:''}`,updown:`${say(m.a)} moves it up, ${say(m.b)} down; it brakes when let go`,positions:`${say(m.a)} sends it to ${dbl(m.posA)}, ${say(m.b)} to ${dbl(m.posB)}`,flip:`${say(m.a)} flips it between ${dbl(m.posA)} and ${dbl(m.posB)}`}[m.mode];
      init.push(`        // ${String(m.label||m.device).replace(/[\r\n]+/g,' ')}: ${what}.`,`        ${cls} ${v} = hardwareMap.get(${cls}.class, ${str(m.device)});`);
      if(!servo&&m.reversed)init.push(`        ${v}.setDirection(DcMotorSimple.Direction.REVERSE);`);
      if(m.mode==='updown')init.push(`        ${v}.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);`);
      if(m.mode==='toggle'||m.mode==='flip')init.push(`        boolean ${v}On = false, ${v}Was = false;`);
      if(m.mode==='hold'||m.mode==='updown')loop.push(`            ${v}.setPower(${A} ? ${pw} : ${hasB?`${B} ? -${pw} : `:''}0);`);
      else if(m.mode==='toggle')loop.push(`            boolean ${v}Now = ${A};`,`            if (${v}Now && !${v}Was) ${v}On = !${v}On;`,`            ${v}Was = ${v}Now;`,`            ${v}.setPower(${hasB?`${B} ? -${pw} : `:''}${v}On ? ${pw} : 0);`);
      else if(m.mode==='positions')loop.push(`            if (${A}) ${v}.setPosition(${dbl(m.posA)}); else if (${B}) ${v}.setPosition(${dbl(m.posB)});`);
      else loop.push(`            boolean ${v}Now = ${A};`,`            if (${v}Now && !${v}Was) { ${v}On = !${v}On; ${v}.setPosition(${v}On ? ${dbl(m.posB)} : ${dbl(m.posA)}); }`,`            ${v}Was = ${v}Now;`);});
    return {imports:[...new Set(imports)],init,loop};}
  // A control doing two jobs on one controller: [{button, uses: [what]}]. The chassis's own are on controller 1.
  function clashes(list,{pad='gamepad1',map,swerve=true}={}){const by=new Map(),put=(b,t)=>{if(!b||b==='none')return;if(!by.has(b))by.set(b,[]);by.get(b).push(t);};
    if(pad==='gamepad1')for(const b of chassisButtons(map,swerve))put(b,'the chassis');for(const m of list||[]){if(!m||m.mode==='off')continue;put(m.a,m.label);if(USES[m.mode]?.[1]!==null)put(m.b,m.label);}
    return [...by].filter(([,u])=>u.length>1).map(([button,uses])=>({button,name:BUTTONS[button]||button,uses}));}
  // The mechanisms written into a chassis TeleOp's source: their devices before waitForStart, their buttons every loop.
  function withMechanisms(source,o){const c=mechCode(o.mechanisms,o.pad==='gamepad2'?'gamepad2':'gamepad1');if(!c.init.length)return source;const lines=source.split('\n'),at=t=>lines.findIndex(l=>l===t),w=at('        waitForStart();'),missing=c.imports.filter(i=>!lines.includes(`import ${i};`));
    if(w<0)return source;lines.splice(w,0,'        // The mechanisms, as Setup has them and Real run mapped them.',...c.init);
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
  function swerve(o,m){const p=o.pods,col=(f,fn=dbl)=>list(p.map(x=>fn(x[f]))),lock=m.lock!=='none';
    return [...head(o,[...COMMON,...(o.imu?.mount?.imports||[]),'com.qualcomm.hardware.lynx.LynxModule','com.qualcomm.robotcore.hardware.AnalogInput','com.qualcomm.robotcore.hardware.CRServo']),
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
      `    static final double VOLTS_PER_TURN = ${dbl(p[0]?.volts||3.3)}, TOLERANCE_DEGREES = ${dbl(o.tolerance||.9)}, IMU_SCALE = ${dbl(o.imu?.scale||1)};`,
      '',
      ...STEER_CLASS,'',
      '    @Override public void runOpMode() {','        int n = DRIVE.length;','        DcMotor[] drive = new DcMotor[n];','        CRServo[] steer = new CRServo[n];','        AnalogInput[] encoder = new AnalogInput[n];','        double radius = 1e-6;',
      '        for (int i = 0; i < n; i++) {','            drive[i] = hardwareMap.get(DcMotor.class, DRIVE[i]);','            drive[i].setDirection(DRIVE_REVERSED[i] ? DcMotorSimple.Direction.REVERSE : DcMotorSimple.Direction.FORWARD);','            drive[i].setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);',
      '            steer[i] = hardwareMap.get(CRServo.class, STEER[i]);','            encoder[i] = hardwareMap.get(AnalogInput.class, ENCODER[i]);','            radius = Math.max(radius, Math.hypot(POD_X[i], POD_Y[i]));','        }',...imu(o),
      '        double[] target = new double[n], steered = new double[n], steerPower = new double[n], speed = new double[n];','        Steer[] loop = new Steer[n];','        for (int i = 0; i < n; i++) loop[i] = new Steer(SERVO_SIGN[i], GAIN[i], LEAD_P_SECONDS[i], LEAD_N_SECONDS[i], CREEP_P[i], CREEP_N[i], CREEP_P_DEGREES_A_SECOND[i], CREEP_N_DEGREES_A_SECOND[i], DEGREES_A_SECOND_PER_POWER[i], TOP_DEGREES_A_SECOND[i], PUSH_P_DEGREES_A_SECOND[i], PUSH_N_DEGREES_A_SECOND[i], ZONE_DEGREES[i], EASE_DEGREES[i], STILL_DEGREES_A_SECOND[i], PUSH_WAIT_SECONDS[i], TOLERANCE_DEGREES);','        // One read of each hub a loop: every encoder and motor from the same instant, and a quicker loop (as it was tuned).','        java.util.List<LynxModule> hubs = hardwareMap.getAll(LynxModule.class);','        for (LynxModule hub : hubs) hub.setBulkCachingMode(LynxModule.BulkCachingMode.MANUAL);','        waitForStart();','        imu.resetYaw();','        long last = System.nanoTime();',
      '        while (opModeIsActive()) {','            for (LynxModule hub : hubs) hub.clearBulkCache();','            long now = System.nanoTime();','            double dt = Math.max(1e-3, (now - last) / 1e9);','            last = now;',...sticks(m),
      '            boolean moving = Math.hypot(forward, left) > 0.05 || Math.abs(turn) > 0.05;','            double top = 1;',...(lock?[`            boolean lock = gamepad1.${m.lock};`]:[]),
      '            // Each pod goes the way the robot is moving there: the drive, plus the turn about the middle.',
      '            for (int i = 0; i < n; i++) {','                double vx = forward - turn * POD_Y[i] / radius, vy = left + turn * POD_X[i] / radius;','                speed[i] = Math.hypot(vx, vy);','                if (moving) target[i] = Math.toDegrees(Math.atan2(vy, vx));','                top = Math.max(top, speed[i]);','            }',
      ...(lock?['            // Lock: every wheel turned to point at the middle of the robot and stopped, so it cannot be pushed off its spot.','            if (lock) for (int i = 0; i < n; i++) target[i] = Math.toDegrees(Math.atan2(POD_Y[i], POD_X[i]));']:[]),
      '            for (int i = 0; i < n; i++) {','                double angle = ENCODER_SIGN[i] * (encoder[i].getVoltage() - ZERO_VOLTS[i]) / VOLTS_PER_TURN * 360.0;','                double error = target[i] - angle;','                error -= 360.0 * Math.round(error / 360.0);',`                double wheel = moving${lock?' && !lock':''} ? speed[i] / top : 0;`,
      '                // More than a quarter turn away: the wheel runs backwards instead, and the pod turns the short way.','                if (Math.abs(error) > 90) { error -= Math.signum(error) * 180; wheel = -wheel; }',
      '                // The steering loop takes a step every loop, with the time that really passed.',
      '                if (Math.abs(target[i] - steered[i]) > 1) { loop[i].retarget(); steered[i] = target[i]; }','                double power = steerPower[i] = loop[i].step(error, angle, dt);',
      '                steer[i].setPower(Math.max(-1, Math.min(1, power)));','                // A wheel still turning to its angle pushes less, so it does not drag the robot sideways.','                drive[i].setPower(wheel * Math.cos(Math.toRadians(error)));','            }',
      '            telemetry.addData("Heading", "%.1f", Math.toDegrees(heading));','            telemetry.update();','        }','    }','}',''].join('\n');}
  // motors: [{key, name, reversed}] by Deck's keys. A mecanum's four; a tank's by side.
  function wheels(o,m,tank){const ms=o.motors,side=k=>/right/i.test(k)?'right':'left',front=k=>/front/i.test(k);
    const mix=x=>tank?(side(x.key)==='left'?'forward - turn':'forward + turn'):({'left front':'forward - left - turn','right front':'forward + left + turn','left back':'forward + left - turn','right back':'forward - left + turn'})[`${side(x.key)} ${front(x.key)?'front':'back'}`];
    return [...head(o,[...COMMON,...(o.imu?.mount?.imports||[])]),`    static final String[] DRIVE = ${list(ms.map(x=>str(x.name)))};`,`    static final boolean[] DRIVE_REVERSED = ${list(ms.map(x=>String(!!x.reversed)))};`,`    static final double IMU_SCALE = ${dbl(o.imu?.scale||1)};`,'',
      '    @Override public void runOpMode() {','        int n = DRIVE.length;','        DcMotor[] drive = new DcMotor[n];','        for (int i = 0; i < n; i++) {','            drive[i] = hardwareMap.get(DcMotor.class, DRIVE[i]);','            drive[i].setDirection(DRIVE_REVERSED[i] ? DcMotorSimple.Direction.REVERSE : DcMotorSimple.Direction.FORWARD);','            drive[i].setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);','        }',...imu(o),
      '        waitForStart();','        imu.resetYaw();','        while (opModeIsActive()) {',...sticks(tank?{...m,field:'no'}:m),
      `            double[] power = ${list(ms.map(mix))};`,'            double top = 1;','            for (double p : power) top = Math.max(top, Math.abs(p));','            for (int i = 0; i < n; i++) drive[i].setPower(power[i] / top);',
      '            telemetry.addData("Heading", "%.1f", Math.toDegrees(heading));','            telemetry.update();','        }','    }','}',''].join('\n');}
  // o: {kind:'swerve'|'mecanum'|'tank', pods|motors, robot:{hubLogo, hubUsb}, imu:{name, scale}, tolerance, map, config, date}.
  // Returns {file, opMode, source}, or {error} saying what is not calibrated yet or not written for.
  //   className, opMode: for the whole robot's TeleOp ("TorqueTeleOp", "Torque TeleOp"); the chassis alone keeps its own.
  //   mechanisms: [{label, device, kind, reversed, mode, a, b, power, posA, posB}] (mechCode), pad: 'gamepad1' | 'gamepad2'.
  // Returns {file, opMode, source}, or {error} saying what is not calibrated yet or not written for.
  function teleopOf(o){const m=mapOf(o.map),done=source=>({file:(o.className||NAME)+'.java',opMode:o.opMode||OP_MODE,source:withMechanisms(source,o)});
    if(o.kind==='swerve'){const p=o.pods||[];if(!p.length)return {error:'This chassis has no pods to drive.'};const bare=p.filter(x=>!x.servo||!x.encoder||!Number.isFinite(x.zero)).map(x=>x.label||x.drive);
      if(bare.length)return {error:`Set the wheels straight first, with an absolute encoder on every pod: ${bare.join(', ')}.`};return done(swerve(o,m));}
    if(o.kind==='mecanum'||o.kind==='tank'){if(!(o.motors||[]).length)return {error:'This chassis has no drive motors.'};return done(wheels(o,{...m,lock:'none'},o.kind==='tank'));}
    return {error:'Torque writes this TeleOp for swerve, mecanum and tank chassis so far.'};}
  const api={teleopOf,mapOf,MAP,DEFAULT,NAME,OP_MODE,FULL_NAME:'TorqueTeleOp',FULL_OP_MODE:'Torque TeleOp',BUTTONS,MODES,USES,modesFor,mechOf,mechMap,mechCode,clashes,chassisButtons,steerClass:()=>STEER_CLASS.slice()};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.DeckChassisTeleop=api;
})(typeof globalThis==='object'?globalThis:this);
