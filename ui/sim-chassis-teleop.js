'use strict';
// A TeleOp for the chassis alone, written from what Calibrate checked on the real robot: which way each motor rolls its
// wheel, each swerve pod's zero, directions and tuned steering loop, the heading correction, and the controller mapping the
// team picked. It is one OnBot Java file with no package (a packaged class crash-loops some Robot Controller builds), so
// Send puts it on the robot as it is and it shows in Drive's op mode list as "Torque Chassis".
// Frame: forward and left are positive, turning counterclockwise is positive, as everywhere in Deck.
(function(root){
  const NAME='TorqueChassis',OP_MODE='Torque Chassis';
  // What the team may pick. drive: the stick that moves it; turn: what turns it; slow, reset: a button or none.
  const MAP={drive:{left:'Left stick',right:'Right stick'},turn:{right:'Right stick, left and right',left:'Left stick, left and right',triggers:'Triggers'},
    slow:{right_bumper:'Right bumper',left_bumper:'Left bumper',none:'No slow button'},reset:{start:'Start / Options',y:'Y / Triangle',dpad_up:'D-pad up',none:'No button'},field:{yes:'The field: forward is away from the driver',no:'The robot: forward is the robot’s front'}};
  const DEFAULT={drive:'left',turn:'right',slow:'right_bumper',reset:'start',field:'yes'};
  // A mapping with only choices from the lists; a turn on the stick that already drives moves to the other stick.
  function mapOf(raw){const m={...DEFAULT};for(const k of Object.keys(MAP))if(raw&&Object.hasOwn(MAP[k],raw[k]))m[k]=raw[k];if(m.turn===m.drive)m.turn=m.drive==='left'?'right':'left';return m;}
  const n=(v,d=5)=>Number.isFinite(+v)?String(+(+v).toFixed(d)):'0',list=a=>`{${a.join(', ')}}`,str=s=>`"${String(s).replace(/[\\"]/g,'\\$&')}"`;
  const dbl=v=>{const t=n(v);return /[.e]/.test(t)?t:t+'.0';};
  const FACE={up:'UP',down:'DOWN',forward:'FORWARD',backward:'BACKWARD',left:'LEFT',right:'RIGHT'};
  // The lines every drivetrain shares: the sticks as forward, left and turn, the slow button, the heading and its reset.
  function sticks(m){const s=m.drive,t=m.turn==='triggers'?'gamepad1.left_trigger - gamepad1.right_trigger':`-gamepad1.${m.turn}_stick_x`;
    return [`            double forward = -gamepad1.${s}_stick_y, left = -gamepad1.${s}_stick_x, turn = ${t};`,
      ...(m.slow==='none'?[]:[`            if (gamepad1.${m.slow}) { forward *= 0.4; left *= 0.4; turn *= 0.4; }`]),
      ...(m.reset==='none'?[]:[`            if (gamepad1.${m.reset}) imu.resetYaw();`]),
      '            double heading = imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.RADIANS) * IMU_SCALE;',
      ...(m.field==='yes'?['            // Field centric: the stick is turned back by the robot\'s heading, so forward stays away from the driver.','            double f = forward * Math.cos(heading) + left * Math.sin(heading);','            left = -forward * Math.sin(heading) + left * Math.cos(heading);','            forward = f;']:[])];}
  const head=(o,imports)=>[...imports.sort().map(i=>`import ${i};`),'',`// Written by Torque (Calibrate)${o.date?', '+o.date:''}${o.config?`, from the "${o.config}" configuration`:''}.`,'// Everything in capitals was checked or measured on the real robot. Send it again after calibrating again.',`@TeleOp(name = ${str(OP_MODE)}, group = "Torque")`,`public class ${NAME} extends LinearOpMode {`];
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
  function swerve(o,m){const p=o.pods,col=(f,fn=dbl)=>list(p.map(x=>fn(x[f])));
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
      '            boolean moving = Math.hypot(forward, left) > 0.05 || Math.abs(turn) > 0.05;','            double top = 1;',
      '            // Each pod goes the way the robot is moving there: the drive, plus the turn about the middle.',
      '            for (int i = 0; i < n; i++) {','                double vx = forward - turn * POD_Y[i] / radius, vy = left + turn * POD_X[i] / radius;','                speed[i] = Math.hypot(vx, vy);','                if (moving) target[i] = Math.toDegrees(Math.atan2(vy, vx));','                top = Math.max(top, speed[i]);','            }',
      '            for (int i = 0; i < n; i++) {','                double angle = ENCODER_SIGN[i] * (encoder[i].getVoltage() - ZERO_VOLTS[i]) / VOLTS_PER_TURN * 360.0;','                double error = target[i] - angle;','                error -= 360.0 * Math.round(error / 360.0);','                double wheel = moving ? speed[i] / top : 0;',
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
  function teleopOf(o){const m=mapOf(o.map);
    if(o.kind==='swerve'){const p=o.pods||[];if(!p.length)return {error:'This chassis has no pods to drive.'};const bare=p.filter(x=>!x.servo||!x.encoder||!Number.isFinite(x.zero)).map(x=>x.label||x.drive);
      if(bare.length)return {error:`Set the wheels straight first, with an absolute encoder on every pod: ${bare.join(', ')}.`};return {file:NAME+'.java',opMode:OP_MODE,source:swerve(o,m)};}
    if(o.kind==='mecanum'||o.kind==='tank'){if(!(o.motors||[]).length)return {error:'This chassis has no drive motors.'};return {file:NAME+'.java',opMode:OP_MODE,source:wheels(o,m,o.kind==='tank')};}
    return {error:'Torque writes this TeleOp for swerve, mecanum and tank chassis so far.'};}
  const api={teleopOf,mapOf,MAP,DEFAULT,NAME,OP_MODE,steerClass:()=>STEER_CLASS.slice()};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.DeckChassisTeleop=api;
})(typeof globalThis==='object'?globalThis:this);
