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
  const imu=o=>['        IMU imu = hardwareMap.get(IMU.class, '+str(o.imu?.name||'imu')+');',`        imu.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(RevHubOrientationOnRobot.LogoFacingDirection.${FACE[o.robot?.hubLogo]||'UP'}, RevHubOrientationOnRobot.UsbFacingDirection.${FACE[o.robot?.hubUsb]||'FORWARD'})));`];
  const COMMON=['com.qualcomm.hardware.rev.RevHubOrientationOnRobot','com.qualcomm.robotcore.eventloop.opmode.LinearOpMode','com.qualcomm.robotcore.eventloop.opmode.TeleOp','com.qualcomm.robotcore.hardware.DcMotor','com.qualcomm.robotcore.hardware.DcMotorSimple','com.qualcomm.robotcore.hardware.IMU','org.firstinspires.ftc.robotcore.external.navigation.AngleUnit'];
  // pods: [{drive, reversed, servo, encoder, x, y (inches from the middle), zero (volts), encoderSign, servoSign,
  //         kP, kI, kD, kS (power a degree), volts (one turn)}]
  function swerve(o,m){const p=o.pods,col=(f,fn=dbl)=>list(p.map(x=>fn(x[f])));
    return [...head(o,[...COMMON,'com.qualcomm.robotcore.hardware.AnalogInput','com.qualcomm.robotcore.hardware.CRServo']),
      `    static final String[] DRIVE = ${col('drive',str)}, STEER = ${col('servo',str)}, ENCODER = ${col('encoder',str)};`,
      `    static final boolean[] DRIVE_REVERSED = ${col('reversed',v=>String(!!v))};`,
      `    // Where each pod is from the middle of the robot, inches: forward, then left.`,`    static final double[] POD_X = ${col('x')}, POD_Y = ${col('y')};`,
      `    // Each pod's steering as calibrated: its encoder's reading with the wheel straight, which way the reading and the`,`    // servo go for a turn to the left, and its own tuned loop (power a degree of error).`,
      `    static final double[] ZERO_VOLTS = ${col('zero')};`,`    static final int[] ENCODER_SIGN = ${col('encoderSign',v=>String(v<0?-1:1))}, SERVO_SIGN = ${col('servoSign',v=>String(v<0?-1:1))};`,
      `    static final double[] KP = ${col('kP')}, KI = ${col('kI')}, KD = ${col('kD')}, KS = ${col('kS')};`,
      `    static final double VOLTS_PER_TURN = ${dbl(p[0]?.volts||3.3)}, TOLERANCE_DEGREES = ${dbl(o.tolerance||.9)}, IMU_SCALE = ${dbl(o.imu?.scale||1)};`,'',
      '    @Override public void runOpMode() {','        int n = DRIVE.length;','        DcMotor[] drive = new DcMotor[n];','        CRServo[] steer = new CRServo[n];','        AnalogInput[] encoder = new AnalogInput[n];','        double radius = 1e-6;',
      '        for (int i = 0; i < n; i++) {','            drive[i] = hardwareMap.get(DcMotor.class, DRIVE[i]);','            drive[i].setDirection(DRIVE_REVERSED[i] ? DcMotorSimple.Direction.REVERSE : DcMotorSimple.Direction.FORWARD);','            drive[i].setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);',
      '            steer[i] = hardwareMap.get(CRServo.class, STEER[i]);','            encoder[i] = hardwareMap.get(AnalogInput.class, ENCODER[i]);','            radius = Math.max(radius, Math.hypot(POD_X[i], POD_Y[i]));','        }',...imu(o),
      '        double[] target = new double[n], lastError = new double[n], integral = new double[n], speed = new double[n];','        waitForStart();','        imu.resetYaw();','        long last = System.nanoTime();',
      '        while (opModeIsActive()) {','            long now = System.nanoTime();','            double dt = Math.max(1e-3, (now - last) / 1e9);','            last = now;',...sticks(m),
      '            boolean moving = Math.hypot(forward, left) > 0.05 || Math.abs(turn) > 0.05;','            double top = 1;',
      '            // Each pod goes the way the robot is moving there: the drive, plus the turn about the middle.',
      '            for (int i = 0; i < n; i++) {','                double vx = forward - turn * POD_Y[i] / radius, vy = left + turn * POD_X[i] / radius;','                speed[i] = Math.hypot(vx, vy);','                if (moving) target[i] = Math.toDegrees(Math.atan2(vy, vx));','                top = Math.max(top, speed[i]);','            }',
      '            for (int i = 0; i < n; i++) {','                double angle = ENCODER_SIGN[i] * (encoder[i].getVoltage() - ZERO_VOLTS[i]) / VOLTS_PER_TURN * 360.0;','                double error = target[i] - angle;','                error -= 360.0 * Math.round(error / 360.0);','                double wheel = moving ? speed[i] / top : 0;',
      '                // More than a quarter turn away: the wheel runs backwards instead, and the pod turns the short way.','                if (Math.abs(error) > 90) { error -= Math.signum(error) * 180; wheel = -wheel; }',
      '                double power = 0;','                if (Math.abs(error) > TOLERANCE_DEGREES) {','                    integral[i] += error * dt;','                    power = SERVO_SIGN[i] * (KP[i] * error + KI[i] * integral[i] + KD[i] * (error - lastError[i]) / dt + KS[i] * Math.signum(error));','                } else integral[i] = 0;','                lastError[i] = error;',
      '                steer[i].setPower(Math.max(-1, Math.min(1, power)));','                // A wheel still turning to its angle pushes less, so it does not drag the robot sideways.','                drive[i].setPower(wheel * Math.cos(Math.toRadians(error)));','            }',
      '            telemetry.addData("Heading", "%.1f", Math.toDegrees(heading));','            telemetry.update();','        }','    }','}',''].join('\n');}
  // motors: [{key, name, reversed}] by Deck's keys. A mecanum's four; a tank's by side.
  function wheels(o,m,tank){const ms=o.motors,side=k=>/right/i.test(k)?'right':'left',front=k=>/front/i.test(k);
    const mix=x=>tank?(side(x.key)==='left'?'forward - turn':'forward + turn'):({'left front':'forward - left - turn','right front':'forward + left + turn','left back':'forward + left - turn','right back':'forward - left + turn'})[`${side(x.key)} ${front(x.key)?'front':'back'}`];
    return [...head(o,COMMON),`    static final String[] DRIVE = ${list(ms.map(x=>str(x.name)))};`,`    static final boolean[] DRIVE_REVERSED = ${list(ms.map(x=>String(!!x.reversed)))};`,`    static final double IMU_SCALE = ${dbl(o.imu?.scale||1)};`,'',
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
  const api={teleopOf,mapOf,MAP,DEFAULT,NAME,OP_MODE};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.DeckChassisTeleop=api;
})(typeof globalThis==='object'?globalThis:this);
