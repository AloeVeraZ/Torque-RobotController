(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckSimFtc=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // The FTC Control Hub side of an export: the robot wiring (motor names, directions, encoder
  // resolution, pod placement) and the team files built from it. The simulator's virtual Control
  // Hub is wired from the same description, so exported code and the virtual robot cannot disagree.
  // Field frame: inches, +X right, +Y up, heading CCW. Robot frame: +x forward, +y left.
  const WHEEL_MM=104,POD_TICKS_PER_INCH=2000/(Math.PI*32/25.4);
  // goBILDA Yellow Jacket style motors report 28 counts per motor revolution; the gearbox sets the rest.
  const ticksPerRev=rpm=>28*6000/rpm;
  const MOTORS={frontLeft:{name:'front_left',mount:-1},frontRight:{name:'front_right',mount:1},backLeft:{name:'back_left',mount:-1},backRight:{name:'back_right',mount:1}};
  // Tank, 6- and 8-wheel and tracked robots: the same four motor names, two per side; a two-wheel
  // differential robot has one motor per side.
  const TANK=new Set(['tank','tank2']),DIFF={left:{name:'left_drive',mount:-1},right:{name:'right_drive',mount:1}};
  const sides=motors=>Object.entries(motors).reduce((o,[k,m])=>{o[/left/i.test(k)?'left':'right'].push(m.name);return o;},{left:[],right:[]});
  const PODS={
    odometry:[{name:'par',axis:'forward',x:0,y:4},{name:'perp',axis:'strafe',x:-3,y:0}],
    odometry3:[{name:'par_left',axis:'forward',x:0,y:6},{name:'par_right',axis:'forward',x:0,y:-6},{name:'perp',axis:'strafe',x:-3,y:0}]
  };
  const SUPPORTED={encoders:'drive encoders + IMU',odometry:'two odometry pods + IMU',odometry3:'three odometry pods + IMU',fused:'goBILDA Pinpoint',optical:'SparkFun OTOS'};
  // Wiring of the virtual Control Hub for a robot and sensing setup.
  function hardware(robot,localization){
    if(!SUPPORTED[localization])throw Error('Autonomous on a Control Hub needs position sensing: drive encoders, odometry pods, Pinpoint or OTOS. IMU-only setups export timed commands.');
    const drivetrain=robot.drivetrain||'mecanum',tank=TANK.has(drivetrain);
    if(!tank&&drivetrain!=='mecanum')throw Error('Autonomous on a Control Hub is exported for mecanum and tank drivetrains. Swerve, X-drive, Kiwi and butterfly export timed commands or route geometry for your own drivetrain code.');
    const rpm=robot.driveRpm||312,inches=Math.PI*(robot.wheelDiameterMm||WHEEL_MM)/25.4;
    const mount=(globalThis.DeckSimConfig||require('./sim-config.js')).hubMounting(robot);
    // The robot's own names for these devices (Setup → Robot controller, or picked from its configuration), and drive
    // motors set to turn the other way. mount is the physical truth the virtual Control Hub drives: -1 is REVERSE.
    const own=robot.devices||{},named=(key,fallback)=>own[key]?.name||fallback;
    const motors=Object.fromEntries(Object.entries(drivetrain==='tank2'?DIFF:MOTORS).map(([key,m])=>[key,{name:named(key,m.name),mount:typeof own[key]?.reversed==='boolean'?(own[key].reversed?-1:1):m.mount}]));
    // Odometry as mounted (Setup → Robot controller → Odometry): pod positions and directions, the Pinpoint's pod
    // offsets, directions and pod type, and the OTOS's position, rotation and scalars.
    const C=globalThis.DeckSimConfig||require('./sim-config.js'),odo=C.odometryOf(robot);
    return {localization,imu:named('imu','imu'),hub:{logo:mount.hubLogo.toUpperCase(),usb:mount.hubUsb.toUpperCase()},drive:{kind:tank?'tank':'mecanum',ticksPerInch:ticksPerRev(rpm)/inches,ticksPerRev:ticksPerRev(rpm),halfLength:robot.length/2,halfWidth:robot.width/2,motors},
      pods:(PODS[localization]||[]).map(p=>{const m=odo.pods[p.name];return {...p,key:p.name,x:m.x,y:m.y,name:named(p.name,p.name),ticksPerInch:POD_TICKS_PER_INCH,...(m.reversed?{reversed:true}:{})};}),
      ...(localization==='fused'?{pinpoint:named('pinpoint','pinpoint'),pinpointMount:{...odo.pinpoint,ticksPerMm:C.POD_TYPES[odo.pinpoint.pods].ticksPerMm}}:{}),...(localization==='optical'?{otos:named('otos','sensor_otos'),otosMount:odo.otos}:{})};
  }
  // Deck's own name for each drive and sensor device a robot of this kind uses, keyed as robot.devices keys them, with
  // what it is (for the robot configuration check and the Robot controller step).
  function deviceSlots(robot,localization){
    let h;try{h=hardware(robot,localization);}catch{return [];}
    const labels={frontLeft:'Front left drive motor',frontRight:'Front right drive motor',backLeft:'Back left drive motor',backRight:'Back right drive motor',left:'Left drive motor',right:'Right drive motor'};
    return [...Object.entries(h.drive.motors).map(([key,m])=>({key,label:labels[key],name:m.name,kind:'motor',reversed:m.mount<0})),{key:'imu',label:'IMU',name:h.imu,kind:'imu'},
      ...h.pods.map((p,i)=>({key:PODS[localization][i].name,label:`Odometry pod (${p.axis==='forward'?'forward':'sideways'}${p.y>0?', left':p.y<0?', right':''}): plugged into a motor port's encoder`,name:p.name,kind:'motor'})),
      ...(h.pinpoint?[{key:'pinpoint',label:'goBILDA Pinpoint',name:h.pinpoint,kind:'pinpoint'}]:[]),...(h.otos?[{key:'otos',label:'SparkFun OTOS',name:h.otos,kind:'otos'}]:[])];
  }
  // The hardware description for drivetrains the Control Hub exports support, or null (a swerve robot's Pedro export
  // then comes without starter constants).
  function hardwareIfSupported(robot,localization){try{return hardware(robot,localization);}catch{return null;}}
  // Every device name a Control Hub export looks up, what the robot configuration must have under it, and the setting that
  // holds the name: the list Send to robot checks against the robot's own configuration. motorOrCr: the code uses
  // DcMotorSimple there, so a motor or a continuous servo both work. device: what the settings say it is, for adding it
  // to a configuration.
  function robotNeeds(robot,localization,mechanisms){
    const slots=deviceSlots(robot,localization).map(s=>({name:s.name,need:s.kind,device:s.kind,label:s.label,setting:{robot:s.key}}));
    const mech=mechanisms?.enabled?mechanismDevices(mechanisms,robot).map(x=>({name:x.name,need:x.device==='servo'?'servo':(x.role==='turret'||x.role==='turret2')&&x.device==='crservo'?'crservo':x.role==='flywheel'||x.role==='turret'||x.role==='turret2'?'motor':'motorOrCr',device:x.device,label:x.label,setting:x.setting})):[];
    return [...slots,...mech];
  }
  // Java double literals: Java numeric literals retain a decimal point for generated calibration constants.
  const n=v=>{const s=String(Number(Number(v).toPrecision(6)));return /[.eE]/.test(s)?s:s+'.0';};
  const comment=s=>String(s||'').replace(/\*\//g,'* /').replace(/\\(?=u)/g,'\\ ').replace(/[\r\n]+/g,' ').trim();
  const javaString=s=>'"'+String(s).replace(/[\\"]/g,c=>'\\'+c).replace(/[\u0000-\u001f]/g,'')+'"';
  const names=list=>`new String[] {${list.map(javaString).join(', ')}}`;
  // The same application-owned controller is exported to the robot. Only this adapter
  // depends on the FTC SDK: hardware names, encoder geometry, sensor frames and motor mixing.
  // Tuning the simulator has not measured falls back to the Deck controller's own Config defaults, so no NaN
  // reaches the Java.
  const DEFAULT_TUNING={maxForward:60,maxStrafe:50,maxTurn:5,translationalP:.09/.35,translationalD:.01,headingP:2/.7,headingD:.12};
  function constants(h,raw,options){const t={...raw};for(const [k,v] of Object.entries(DEFAULT_TUNING))if(!Number.isFinite(t[k]))t[k]=v;return `package ${options.packageName}.drive;
import deck.pathing.DeckFollower;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.util.ElapsedTime;
public final class Constants {
    private static RobotDrive hardware;
    private static DeckFollower.Config config;
    public static DeckFollower create(HardwareMap map) {
        hardware = new RobotDrive(map);
        config = new DeckFollower.Config();
        config.maxForward=${n(t.maxForward)}; config.maxStrafe=${n(t.maxStrafe)}; config.maxTurn=${n(t.maxTurn??5)};
        config.positionP=${n(t.translationalP*.35)}; config.positionD=${n(t.translationalD)};
        config.headingP=${n(t.headingP*.7)}; config.headingD=${n(Math.max(.08,t.headingD))};
        config.acceleration=${n(Math.max(20,Math.min(t.maxForward*3,(t.maxAcceleration??t.maxForward*2)*.65)))}; config.tank=${h.drive.kind==='tank'};
        config.maxPathSpeed=${n(t.maxPathSpeed??.8)};
        ElapsedTime clock = new ElapsedTime();
        return new DeckFollower(hardware, hardware, config, () -> clock.nanoseconds());
    }
    public static void motorPower(double p) { config.maxPathSpeed=p; hardware.limit=p; }
}
`;}
  function robotDrive(h,options){const motors=Object.entries(h.drive.motors),pods=h.pods,kind=h.drive.kind,pp=h.pinpointMount,ot=h.otosMount;
    const PODS_ENUM={'4bar':'goBILDA_4_BAR_POD',swingarm:'goBILDA_SWINGARM_POD'},direction=r=>`GoBildaPinpointDriver.EncoderDirection.${r?'REVERSED':'FORWARD'}`;
    return `package ${options.packageName}.drive;
import deck.pathing.DeckFollower;
import deck.pathing.DeckFollower.*;
import com.qualcomm.robotcore.hardware.*;
import com.qualcomm.hardware.rev.RevHubOrientationOnRobot;
import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;
import com.qualcomm.hardware.sparkfun.SparkFunOTOS;
import com.qualcomm.robotcore.util.ElapsedTime;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.Pose2D;
/** Motor names and directions, wheel gearing, the Control Hub's mounting and the odometry come from Deck's settings
 * (Setup → Robot controller); the guided check TeleOp finds the directions and odometry offsets on the robot.
 * Gains measured in simulation are starting values; calibrate distances and turns on the field. */
public final class RobotDrive implements Drivetrain, Localizer {
    private final DcMotorEx[] motors = new DcMotorEx[${motors.length}], pods = new DcMotorEx[${pods.length}];
${pods.length?`    /** Each odometry pod's count direction: -1 for a pod that counts backward as the robot drives its way. */
    private static final int[] POD_SIGN = {${pods.map(p=>p.reversed?-1:1).join(', ')}};
`:''}    private final IMU imu;
    private final GoBildaPinpointDriver pinpoint;
    private final SparkFunOTOS otos;
    private final ElapsedTime clock = new ElapsedTime();
    private final int[] before = new int[${motors.length}], podBefore = new int[${pods.length}];
    private double oldImu, lastTime;
    double limit=${n(.6)};
    private MotionState state=MotionState.ofVelocity(Pose.zero(),Velocity.zero());
    public RobotDrive(HardwareMap map) {
${motors.map(([key,m],i)=>`        motors[${i}]=map.get(DcMotorEx.class, ${javaString(m.name)}); motors[${i}].setDirection(DcMotorSimple.Direction.${m.mount<0?'REVERSE':'FORWARD'});`).join('\n')}
        for(DcMotorEx m:motors){m.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER);m.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);}
${pods.map((p,i)=>`        pods[${i}]=map.get(DcMotorEx.class,${javaString(p.name)});`).join('\n')}
        imu=map.get(IMU.class,${javaString(h.imu)});
        // How the Control Hub is mounted (Deck: Setup → Robot controller). If this is wrong, every turn and heading is wrong.
        imu.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(RevHubOrientationOnRobot.LogoFacingDirection.${h.hub.logo},RevHubOrientationOnRobot.UsbFacingDirection.${h.hub.usb})));
        pinpoint=${h.localization==='fused'?`map.get(GoBildaPinpointDriver.class,${javaString(h.pinpoint)})`:'null'};${pp?`
        // The Pinpoint's pods: X is the forward pod (its offset: inches left of the robot's centre), Y the strafe pod (inches
        // forward of it). Resetting also calibrates its IMU, so the robot must be still at INIT. The reset takes about 0.25 s
        // and a position set before it ends is lost, so wait for it (Pedro's PinpointLocalizer waits 0.5 s too).
        pinpoint.setOffsets(${n(pp.xOffset)},${n(pp.yOffset)},DistanceUnit.INCH);
        pinpoint.setEncoderResolution(GoBildaPinpointDriver.GoBildaOdometryPods.${PODS_ENUM[pp.pods]});
        pinpoint.setEncoderDirections(${direction(pp.xReversed)},${direction(pp.yReversed)});
        pinpoint.resetPosAndIMU();
        try{Thread.sleep(500);}catch(InterruptedException e){Thread.currentThread().interrupt();}`:''}
        otos=${h.localization==='optical'?`map.get(SparkFunOTOS.class,${javaString(h.otos)})`:'null'};${ot?`
        // Where the OTOS sits (inches forward and left of the robot's centre) and where its X axis points (counterclockwise
        // from the robot's front), as SparkFun's offset takes them; then its scalars, and its IMU calibrated at INIT.
        otos.setLinearUnit(DistanceUnit.INCH);otos.setAngularUnit(AngleUnit.RADIANS);
        otos.setOffset(new SparkFunOTOS.Pose2D(${n(ot.x)},${n(ot.y)},Math.toRadians(${n(ot.heading)})));
        otos.setLinearScalar(${n(ot.linearScalar)});otos.setAngularScalar(${n(ot.angularScalar)});
        otos.calibrateImu();otos.resetTracking();`:''}
        setPose(Pose.zero());
    }
    public MotionState state(){return state;}
    public java.util.Map<String,Object> debug(){return java.util.Collections.emptyMap();}
    public void setPose(Pose p){
        for(int i=0;i<motors.length;i++)before[i]=motors[i].getCurrentPosition();
        for(int i=0;i<pods.length;i++)podBefore[i]=pods[i].getCurrentPosition();
        oldImu=imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.RADIANS);lastTime=clock.seconds();
        if(pinpoint!=null)pinpoint.setPosition(new Pose2D(DistanceUnit.INCH,p.x(),p.y(),AngleUnit.RADIANS,p.heading()));
        if(otos!=null)otos.setPosition(new SparkFunOTOS.Pose2D(p.x(),p.y(),p.heading()));
        state=MotionState.ofVelocity(p,Velocity.zero());
    }
    public void update(){
        double now=clock.seconds(),dt=now-lastTime;if(dt<=0)return;lastTime=now;Pose p=state.pose(),next;
        double yaw=imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.RADIANS),dh=DeckFollower.angle(yaw-oldImu);oldImu=yaw;
        // The Pinpoint turns with its own IMU; while it does not answer (a loose cable), the Control Hub's IMU carries the heading.
        if(pinpoint!=null){pinpoint.update();next=pinpoint.getDeviceStatus()==GoBildaPinpointDriver.DeviceStatus.READY?new Pose(pinpoint.getPosX(DistanceUnit.INCH),pinpoint.getPosY(DistanceUnit.INCH),pinpoint.getHeading(AngleUnit.RADIANS)):new Pose(p.x(),p.y(),p.heading()+dh);}
        else if(otos!=null){SparkFunOTOS.Pose2D q=otos.getPosition();next=new Pose(q.x,q.y,q.h);}
        else {
            double[] d=new double[motors.length];for(int i=0;i<d.length;i++){int ticks=motors[i].getCurrentPosition();d[i]=(ticks-before[i])*${n(1/h.drive.ticksPerInch)};before[i]=ticks;}
            double forward=${kind==='tank'?'('+motors.map((_,i)=>`d[${i}]`).join('+')+')/'+motors.length:'(d[0]+d[1]+d[2]+d[3])/4'},left=${kind==='tank'?'0':'(-d[0]+d[1]+d[2]-d[3])/4'};
${pods.length?`            double[] pod=new double[pods.length];for(int i=0;i<pods.length;i++){int ticks=pods[i].getCurrentPosition();pod[i]=(ticks-podBefore[i])*POD_SIGN[i];podBefore[i]=ticks;}
            forward=(${pods.map((p,i)=>p.axis==='forward'?`pod[${i}]*${n(1/p.ticksPerInch)}+${n(p.y)}*dh`:null).filter(Boolean).map(t=>'('+t+')').join('+')})/${pods.filter(p=>p.axis==='forward').length};
            left=${pods.map((p,i)=>p.axis==='strafe'?`pod[${i}]*${n(1/p.ticksPerInch)}-(${n(p.x)})*dh`:null).filter(Boolean).join('+')};`:''}
            double mid=p.heading()+dh/2;next=new Pose(p.x()+forward*Math.cos(mid)-left*Math.sin(mid),p.y()+forward*Math.sin(mid)+left*Math.cos(mid),p.heading()+dh);
        }
        state=MotionState.ofVelocity(next,new Velocity((next.x()-p.x())/dt,(next.y()-p.y())/dt,DeckFollower.angle(next.heading()-p.heading())/dt));
    }
    public void drive(DrivePowers p,boolean manual){
        double[] powers=new double[]{${kind==='tank'?motors.map(([key])=>`p.forward()${/left/i.test(key)?'-':'+'}p.turn()`).join(','):'p.forward()-p.strafe()-p.turn(),p.forward()+p.strafe()+p.turn(),p.forward()+p.strafe()-p.turn(),p.forward()-p.strafe()+p.turn()'}};
        double scale=1;for(double w:powers)scale=Math.max(scale,Math.abs(w)/Math.max(.000001,limit));
        for(int i=0;i<motors.length;i++)motors[i].setPower(limit<=0?0:powers[i]/scale);
    }
    public void stop(){for(DcMotorEx m:motors)m.setPower(0);}
}
`;}
  function opMode(options){const R=options.className;return `package ${options.packageName};

import deck.pathing.DeckFollower;
import deck.pathing.DeckFollower.Pose;
import deck.pathing.DeckFollower.Path;
import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.util.ElapsedTime;
import ${options.packageName}.drive.Constants;

/**
 * Autonomous generated by Torque for "${comment(options.layoutName||'route')}". Follows ${R}
 * leg by leg: turns in place first when a leg needs a new heading, follows it (running the action of
 * an action path while it drives), waits for the robot to settle, turns if the pin asks for it, then
 * runs the pin's action and pause. Mechanism code goes in RobotActions.java; the driving comes from
 * the simulator. Paste ${R}.java, RouteActions.java, RobotActions.java, this file and drive/ with pathing/ into TeamCode.
 */
@Autonomous(name = ${javaString(`${options.layoutName||'Planned route'} (Deck)`)}, group = "Torque")
public class ${options.opModeName} extends LinearOpMode {
    private DeckFollower follower;
    private RouteActions actions;
    private final RouteActions.Step step = new RouteActions.Step();

    @Override
    public void runOpMode() throws InterruptedException {
        follower = Constants.create(hardwareMap);
        follower.setPose(${R}.START);
        actions = new RobotActions();
        actions.init(hardwareMap, telemetry);
        // Each hub reads all its inputs in one go per loop (bulk caching), so sensors and encoders cost no extra time.
        for (LynxModule hub : hardwareMap.getAll(LynxModule.class)) hub.setBulkCachingMode(LynxModule.BulkCachingMode.AUTO);
        Path[] legs = ${R}.legs();
        telemetry.addData("Route", legs.length + " legs");
        telemetry.update();
        waitForStart();
        try {
            ElapsedTime timer = new ElapsedTime(), movingTimer = new ElapsedTime();
            double plannedHeading = ${R}.START.heading();
            int movingPath = 0;
            boolean movingDone = true, movingFirst = false;
            for (int i = 0; i < legs.length && opModeIsActive(); i++) {
                Constants.motorPower(${R}.MOTOR_POWER[i]);
                if (${R}.MOTOR_POWER[i] == 0) {
                    follower.stop();
                    while (opModeIsActive()) { report(i, legs.length, "Zero motor power: stopped"); idle(); }
                    break;
                }
                // Turn only where the plan changes heading (turning routes), not to chase small drift.
                if (Math.abs(angle(${R}.START_HEADING[i] - plannedHeading)) > Math.toRadians(0.5)) turnTo(${R}.START_HEADING[i], i, legs.length);
                // An action path's action starts with the path and may span several legs of it.
                String moving = ${R}.MOVING_ACTIONS[i];
                if (!moving.isEmpty() && ${R}.PATH[i] != movingPath) {
                    movingPath = ${R}.PATH[i];
                    movingDone = false;
                    movingFirst = true;
                    movingTimer.reset();
                }
                follower.follow(legs[i]);
                step.wait = 0;
                boolean through = i + 1 < legs.length && ${R}.WAIT_SECONDS[i] == 0 && ${R}.ACTIONS[i].isEmpty() && Double.isNaN(${R}.TURN_AFTER[i]) && DeckFollower.continuous(legs[i],legs[i+1]);
                while (opModeIsActive() && follower.following()) {
                    follower.update();
                    if (!moving.isEmpty() && !movingDone) {
                        // A set time runs the action from the start of its path; the last call stops it.
                        double t = movingTimer.seconds();
                        boolean over = ${R}.MOVING_SECONDS[i] > 0 && t >= ${R}.MOVING_SECONDS[i];
                        step.duration = ${R}.MOVING_SECONDS[i];
                        step.cell = ${R}.MOVING_CELL[i];
                        movingDone = act(moving, t, movingFirst, over, true, ${R}.PIN[i]) || over;
                        movingFirst = false;
                    }
                    report(i, legs.length, moving.isEmpty() ? "Driving" : "Action path");
                    if (through && follower.remainingDistance() < 1.5 && near(legs[i].endPose(),1.5)) break;
                }
                boolean pathEnds = i == legs.length - 1 || ${R}.PATH[i + 1] != movingPath || ${R}.MOVING_ACTIONS[i + 1].isEmpty();
                if (!moving.isEmpty() && pathEnds) {
                    // The path is over: one last call so the action can stop its mechanisms.
                    if (!movingDone) { step.duration = ${R}.MOVING_SECONDS[i]; act(moving, movingTimer.seconds(), movingFirst, true, true, ${R}.PIN[i]); }
                    movingDone = true;
                    movingPath = 0;
                }
                Pose end = legs[i].endPose();
                plannedHeading = end.heading();
                if (through) continue;
                timer.reset();
                while (opModeIsActive() && timer.seconds() < 3 && !(near(end, 0.75) && follower.velocity().linSpeed() < .5)) {
                    follower.update();
                    report(i, legs.length, "Settling");
                }
                if (!Double.isNaN(${R}.TURN_AFTER[i])) {
                    turnTo(${R}.TURN_AFTER[i], i, legs.length);
                    plannedHeading = ${R}.TURN_AFTER[i];
                }
                // At the pin: pause, then run the action for its set time (or until it reports done), then drive on.
                timer.reset();
                while (opModeIsActive() && timer.seconds() < ${R}.WAIT_SECONDS[i]) {
                    follower.update();
                    report(i, legs.length, "Pause");
                }
                String action = ${R}.ACTIONS[i];
                step.wait = ${R}.WAIT_SECONDS[i];
                step.duration = ${R}.ACTION_SECONDS[i];
                step.cell = ${R}.ACTION_CELL[i];
                boolean done = action.isEmpty(), first = true;
                timer.reset();
                while (opModeIsActive() && !done) {
                    follower.update();
                    double t = timer.seconds();
                    boolean over = ${R}.ACTION_SECONDS[i] > 0 && t >= ${R}.ACTION_SECONDS[i];
                    done = act(action, t, first, over, false, ${R}.PIN[i]) || over;
                    first = false;
                    report(i, legs.length, "Action");
                }
            }
            while (opModeIsActive()) {
                follower.update();
                report(legs.length - 1, legs.length, "Done");
            }
        } finally {
            // Stop the drive first: an error in a mechanism's stop code must not leave the wheels turning.
            try {
                follower.stop();
            } finally {
                actions.stop();
            }
        }
    }

    /** Turn in place: done when the heading has stayed within 1.5 degrees for 0.15 s (at most 5 s). */
    private void turnTo(double heading, int leg, int legs) {
        Pose here = follower.pose();
        follower.hold(new Pose(here.x(), here.y(), heading));
        ElapsedTime timer = new ElapsedTime();
        double settledSince = -1;
        while (opModeIsActive() && timer.seconds() < 5) {
            follower.update();
            report(leg, legs, "Turning");
            boolean on = Math.abs(angle(heading - follower.pose().heading())) < Math.toRadians(1.5);
            if (!on) settledSince = -1;
            else if (settledSince < 0) settledSince = timer.seconds();
            else if (timer.seconds() - settledSince > 0.15) break;
        }
    }

    private boolean act(String name, double elapsed, boolean first, boolean last, boolean moving, int pin) {
        step.elapsed = elapsed;
        step.first = first;
        step.last = last;
        step.moving = moving;
        step.pin = pin;
        step.pose = follower.pose();
        telemetry.addData("Action", name);
        return actions.run(name, step);
    }

    private boolean near(Pose target, double inches) {
        Pose p = follower.pose();
        return Math.hypot(p.x() - target.x(), p.y() - target.y()) < inches;
    }

    private static double angle(double radians) {
        return Math.atan2(Math.sin(radians), Math.cos(radians));
    }

    private void report(int leg, int legs, String phase) {
        actions.update();
        Pose p = follower.pose();
        telemetry.addData("Leg", (leg + 1) + " of " + legs);
        telemetry.addData("Phase", phase);
        telemetry.addData("x", "%.1f", p.x());
        telemetry.addData("y", "%.1f", p.y());
        telemetry.addData("heading", "%.1f", Math.toDegrees(p.heading()));
        telemetry.update();
    }
}
`;}
  // The action slots: one method per action named in the simulator, regenerated on every export.
  function routeActions(options,list){const Ex=options.exporter,mech=options.mechanisms?.enabled?options.mechanisms:null,seqs=options.sequences||[];return `package ${options.packageName};

import ${options.poseImport||'deck.pathing.DeckFollower.Pose'};
import com.qualcomm.robotcore.hardware.HardwareMap;
import org.firstinspires.ftc.robotcore.external.Telemetry;

/**
 * Action slots for "${comment(options.layoutName||'route')}", generated by Torque. Export rewrites
 * this file: write your mechanism code in RobotActions.java, which extends it.
 *
 * Each action named in the simulator is one method here. It is called every loop while it runs and
 * returns true once it has finished.
 *  - At a pin the robot is stopped. It leaves once the action has finished AND the pin's pause is over,
 *    so set the pause in the simulator to how long the action takes on the real robot.
 *  - On an action path the robot keeps driving. The action is called until it returns true or the
 *    path ends; if the path ends first it gets one final call with step.last = true.
 * The same name at several pins or paths runs the same method. A pin or path with several steps runs each
 * step's method in turn (at a pin) or together (while driving); see Steps below.
 *
 * Actions in this route:
${list.length?list.map(a=>` *   ${a.slot}(): "${comment(a.name)}", ${a.uses.map(u=>Ex.where(u)+(u.note?` (${comment(u.note)})`:'')).join('; ')}`).join('\n'):' *   (none yet: name an action on a pin or an action path in the simulator)'}
 */
public abstract class RouteActions {
    /** What a running action can see. */
    public static final class Step {
        /** Seconds since this action started. */
        public double elapsed;
        /** True on the first call. */
        public boolean first;
        /** True on the final call of an action path (the path has ended): stop moving parts now. */
        public boolean last;
        /** True on an action path (the robot is driving), false at a pin (the robot is stopped). */
        public boolean moving;
        /** The pin the robot is at, or the pin the action path leads to. */
        public int pin;
        /** Estimated field pose, in inches and radians counterclockwise from +X. */
        public Pose pose;
        /** At a pin: its pause in seconds, already over when the action starts (0 on an action path). */
        public double wait;
        /** How long this action runs, in seconds: the route calls it with last = true when the time is up.
         *  0 at a pin: run until you return true. 0 on an action path: the whole path. */
        public double duration;
        /** The hive cell to aim at: 0 the cell up at the start, 1 the other cell (up after the first tip). */
        public int cell;
    }

    protected HardwareMap hardwareMap;
    protected Telemetry telemetry;
${mech?`    /** The intake, indexer and shooter set up in the simulator (Mechanisms.java). */
    protected final Mechanisms mech = new Mechanisms();
`:''}${options.parts?.list?.length?`    /** The robot's own moving parts set up in the simulator (Parts.java): "Lift up" and the like. */
    protected final Parts parts = new Parts();
`:''}
    /** Called once during init, before START. Look up your mechanism hardware here. */
    public void init(HardwareMap hardwareMap, Telemetry telemetry) {
        this.hardwareMap = hardwareMap;
        this.telemetry = telemetry;
${mech?'        mech.init(hardwareMap);\n':''}${options.parts?.list?.length?'        parts.init(hardwareMap);\n':''}    }
${list.map(a=>`
    /** "${comment(a.name)}": ${a.uses.map(u=>Ex.where(u)).join('; ')}. Return true when finished. */
    public boolean ${a.slot}(Step step) {
        ${mechanismAction(a.name,mech,options.parts)||`return notWritten(${javaString(a.name)});`}
    }
`).join('')}
    /** Called every loop by the autonomous: moving parts finish their moves on their own. */
    public void update() {
${options.parts?.list?.length?'        parts.update();\n':''}    }

    /** Called when the autonomous ends or is stopped: stop every mechanism. */
    public void stop() {
${mech?'        mech.stop();\n':''}${options.parts?.list?.length?'        parts.stop();\n':''}    }

    /** Runs the action with this simulator name. Names this file does not know count as finished. */
    public final boolean run(String name, Step step) {
        switch (name) {
${list.flatMap(a=>(a.names||[a.name]).map(name=>`            case ${javaString(name)}: return ${a.slot}(step);\n`)).join('')}${seqs.map((q,k)=>`            case ${javaString(q.name)}: return steps(steps${k + 1}, step);\n`).join('')}            default: return true;
        }
    }
${seqs.length?`
    // ---- Pins and paths with several steps. At a pin they run one after another; while driving, together from the
    // start of the path. Each runs for its set time (0: until its method returns true; the whole path while driving).
${seqs.map((q,k)=>`    private final Steps steps${k + 1} = new Steps(${q.together}, new String[] {${q.steps.map(x=>javaString(x.action)).join(', ')}},
        new double[] {${q.steps.map(x=>javaNumber(x.seconds||0)).join(', ')}}, new int[] {${q.steps.map(x=>x.cell?1:0).join(', ')}});`).join('\n')}

    private static final class Steps {
        final boolean together;
        final String[] names;
        final double[] seconds;
        final int[] cells;
        final double[] started;
        final boolean[] done;
        final Step step = new Step();
        int at;

        Steps(boolean together, String[] names, double[] seconds, int[] cells) {
            this.together = together;
            this.names = names;
            this.seconds = seconds;
            this.cells = cells;
            started = new double[names.length];
            done = new boolean[names.length];
        }
    }

    /** One call of a list of steps: true once every step is done. */
    private boolean steps(Steps s, Step step) {
        if (step.first) {
            s.at = 0;
            java.util.Arrays.fill(s.started, -1);
            java.util.Arrays.fill(s.done, false);
        }
        if (s.together) {
            boolean all = true;
            for (int i = 0; i < s.names.length; i++) {
                if (!s.done[i]) s.done[i] = runStep(s, i, step, step.elapsed, step.first);
                all &= s.done[i];
            }
            return all;
        }
        while (s.at < s.names.length) {
            int i = s.at;
            boolean first = s.started[i] < 0;
            if (first) s.started[i] = step.elapsed;
            if (!runStep(s, i, step, step.elapsed - s.started[i], first)) return false;
            s.at++;
        }
        return true;
    }

    /** Step i, t seconds after it started: true once its time is up or its method says it is done. */
    private boolean runStep(Steps s, int i, Step step, double t, boolean first) {
        Step sub = s.step;
        boolean over = s.seconds[i] > 0 && t >= s.seconds[i];
        sub.elapsed = t;
        sub.first = first;
        sub.last = over || step.last;
        sub.moving = step.moving;
        sub.pin = step.pin;
        sub.pose = step.pose;
        sub.wait = step.wait;
        sub.duration = s.seconds[i];
        sub.cell = s.cells[i];
        return run(s.names[i], sub) || over;
    }
`:''}
    private boolean notWritten(String name) {
        if (telemetry != null) telemetry.addData("Action", name + ": no code yet (write it in RobotActions.java)");
        return true;
    }
}
`;}
  // The team's own file: created once with a method for each action, never overwritten afterwards.
  function robotActions(options,list){const Ex=options.exporter,mech=options.mechanisms?.enabled?options.mechanisms:null;list=list.filter(a=>!mechanismAction(a.name,mech,options.parts));return `package ${options.packageName};

import com.qualcomm.robotcore.hardware.HardwareMap;
import org.firstinspires.ftc.robotcore.external.Telemetry;

/**
 * YOUR mechanism code for the autonomous actions (intake, shooter, arm...). Torque
 * created this file once and never overwrites it. The simulator plans the driving; this file does
 * the rest. Each method is called every loop while its action runs and returns true when finished
 * (RouteActions.java has the rules and the current list of actions).
 *
 * After you add or rename an action in the simulator and export again, its method appears in
 * RouteActions.java: copy it here (keep @Override) and write the code. Delete methods for actions
 * you removed.
 */
public class RobotActions extends RouteActions {
${mech?`    // Deck's Intake, Spin up, Aim and Shoot already run the mechanisms set up in Deck (Mechanisms.java, as
    // mech). To do one of them your own way, override it here. For example, to shoot with your own code:
    //     @Override
    //     public boolean shoot(Step step) {
    //         // Called every loop until it returns true. Never sleep() here: the robot stops following its path.
    //         return mech.shoot(0, step); // Deck's version: start from it, or replace it
    //     }

`:''}    // Example: private DcMotorEx intake;

    @Override
    public void init(HardwareMap hardwareMap, Telemetry telemetry) {
        super.init(hardwareMap, telemetry);
        // Example: intake = hardwareMap.get(DcMotorEx.class, "intake");
    }
${list.map(a=>`
    /** "${comment(a.name)}": ${a.uses.map(u=>Ex.where(u)).join('; ')}. */
    @Override
    public boolean ${a.slot}(Step step) {
        // TODO: ${comment(a.name)}${a.uses.find(u=>u.note)?` (${comment(a.uses.find(u=>u.note).note)})`:''}.
        // ${a.uses.some(u=>u.moving)?'Example: if (step.first) intake.setPower(1); if (step.last) intake.setPower(0); return step.last;':'Example: if (step.first) shooter.setPower(1); if (step.elapsed < 1.5) return false; shooter.setPower(0); return true;'}
        return true;
    }
`).join('')}
    @Override
    public void stop() {
        super.stop();
        // Stop every mechanism you added here.
    }
}
`;}
  // ---------------------------------------------------------------- mechanisms
  // The simulator's built-in actions as they run on the robot. "Shoot" feeds once per storage slot.
  function mechanismAction(name,mech,parts){
    // Wait takes its set time (the route ends it) and nothing else.
    if(/^\s*wait\s*$/i.test(String(name||'')))return 'return step.last || step.duration <= 0;';
    if(!mech)return partAction(name,parts);const a=(globalThis.DeckMechanisms||require('./sim-mechanisms.js')).action(name),shooter=mech.shooter.type!=='none';
    if(a.kind==='intake'&&mech.intake.enabled)return 'boolean done = step.last || (!step.moving && step.duration <= 0);\n        mech.intake(!done);\n        return done;';
    if(a.kind==='spin'&&shooter)return 'mech.spin(true);\n        return true;';
    if(a.kind==='aim'&&shooter)return 'mech.aim(step.pose, step.cell);\n        return step.moving ? step.last : mech.aimed();';
    if(a.kind==='shoot'&&shooter)return `return mech.shoot(${a.count}, step);`;
    // A ramp stays where it is sent: at a pin the route waits until it has had its time to get there.
    if(a.kind==='ramp'&&mech.intakes.some(i=>i.kind==='ramp'))return `mech.ramp(${a.down});\n        return step.moving || mech.rampsAt(${a.down}, step.elapsed);`;
    if(a.kind==='turret'&&mech.shooters.some(s=>s.type==='turret'))return `${a.turret===null?`mech.turnTurrets(${javaNumber(a.degrees)})`:`mech.turnTurret(${a.turret}, ${javaNumber(a.degrees)})`};\n        return step.moving || mech.aimed();`;
    return partAction(name,parts);
  }
  const javaNumber=v=>{const t=String(+Number(v).toFixed(3));return t.includes('.')?t:t+'.0';};
  // Every mechanism device the export drives, with the Java field and constant it gets. Mechanisms.java, the
  // mechanism check, the robot configuration check and the virtual Control Hub are all built from this one list.
  // device: what it is in the robot configuration (motor, crservo or servo).
  function mechanismDevices(m,robot={},kin=null){
    const Mech=globalThis.DeckMechanisms||require('./sim-mechanisms.js'),out=[];
    m.intakes.forEach((i,k)=>{const no=k+1,base={part:'intake',index:k};
      if(i.kind!=='kicker'){const device=i.device==='crservo'?'crservo':'motor';
        out.push({...base,role:'roller',field:`intake${no}`,constant:`INTAKE_${no}`,name:i.motor,device,reversed:!!i.reversed,power:i.power,label:`Intake ${no} roller`,setting:{list:'intakes',index:k,field:'motor'}});
        if(i.motor2)out.push({...base,role:'roller',field:`intake${no}b`,constant:`INTAKE_${no}B`,name:i.motor2,device,reversed:!!i.reversed2,power:i.power,label:`Intake ${no} second roller`,setting:{list:'intakes',index:k,field:'motor2'}});}
      if(Mech.deploys(i.kind))out.push({...base,role:i.kind,field:`${i.kind}${no}`,constant:`${i.kind.toUpperCase()}_${no}`,name:i.servo,device:i.rampKind==='dcmotor'?'motor':i.rampKind==='crservo'?'crservo':'servo',down:i.downPos,up:i.upPos,label:`Intake ${no} ${i.kind}`,setting:{list:'intakes',index:k,field:'servo'}});
    });
    m.shooters.forEach((s,k)=>{const no=k+1,base={part:'shooter',index:k};
      out.push({...base,role:'flywheel',field:`flywheel${no}`,constant:`FLYWHEEL_${no}`,name:s.motor,device:'motor',reversed:!!s.reversed,label:`Shooter ${no} flywheel`,setting:{list:'shooters',index:k,field:'motor'}});
      if(s.motor2)out.push({...base,role:'flywheel',field:`flywheel${no}b`,constant:`FLYWHEEL_${no}B`,name:s.motor2,device:'motor',reversed:!!s.reversed2,label:`Shooter ${no} second flywheel motor`,setting:{list:'shooters',index:k,field:'motor2'}});
      const kind=s.indexerKind;
      out.push({...base,role:'feeder',field:`feeder${no}`,constant:`FEEDER_${no}`,name:s.indexer,device:kind==='motor'||kind==='crservo'?kind:'servo',feeder:kind,reversed:!!s.indexerReversed,feed:s.feedPos,rest:s.restPos,label:`Shooter ${no} feeder`,setting:{list:'shooters',index:k,field:'indexer'}});
      if(s.type==='turret'&&!s.sharesTurret)out.push({...base,role:'turret',field:`turret${no}`,constant:`TURRET_${no}`,name:s.turretMotor,device:m.turret.kind==='servo'||m.turret.kind==='crservo'?m.turret.kind:'motor',reversed:!!s.turretReversed,offset:Mech.mountOffset(s.mount,robot),label:`Shooter ${no} turret`,setting:{list:'shooters',index:k,field:'turretMotor'}});
      if(s.type==='turret'&&!s.sharesTurret&&s.turretMotor2)out.push({...base,role:'turret2',field:`turret${no}b`,constant:`TURRET_${no}B`,name:s.turretMotor2,device:m.turret.kind==='servo'||m.turret.kind==='crservo'?m.turret.kind:'motor',reversed:!!s.turretReversed,label:`Shooter ${no} turret, second ${m.turret.kind==='motor'?'motor':'servo'}`,setting:{list:'shooters',index:k,field:'turretMotor2'}});
      if(s.hood)out.push({...base,role:'hood',field:`hood${no}`,constant:`HOOD_${no}`,name:s.hood,device:'servo',...hoodPositions(m,k,robot,kin),label:`Shooter ${no} hood`,setting:{list:'shooters',index:k,field:'hood'}});
    });
    return out;
  }
  // A hood servo's positions: REST holds the hood where the CAD has it (the servo's center), SHOOT tilts it from there to
  // the shooting angle (the hood angle set in Mechanisms less the launch angle the CAD shows), within the joint's limits.
  function hoodPositions(m,k,robot,kin){
    const A=Act(),j=(kin?.joints||[]).find(x=>x.drive?.signal==='hood'&&x.drive.of==='shooter:'+k),model=robot?.wiring?.devices?.[`shooters.${k}.hood`]?.model,a={kind:'servo',...(model?{model}:{}),servo:{}};
    const lo=Number.isFinite(j?.lower)?j.lower:-Infinity,hi=Number.isFinite(j?.upper)?j.upper:Infinity,rest=j?.states?.rest??0,tilt=Number.isFinite(j?.launch)?Math.max(lo,Math.min(hi,m.shooter.hood-j.launch)):j?.states?.shoot??rest;
    return {shoot:+A.position(a,tilt).toFixed(4),rest:+A.position(a,rest).toFixed(4)};}
  // The virtual Control Hub's mechanism ports for these settings. mount is the physical truth from the settings (-1: the
  // device is mounted to turn the other way), so robot code has to set the same direction for a piece to go in.
  function mechanismHardware(m){
    const d=mechanismDevices(m),Mech=globalThis.DeckMechanisms||require('./sim-mechanisms.js'),out={},mount=x=>x.reversed?-1:1;
    const rollers=d.filter(x=>x.role==='roller');if(rollers.length)out.intakes=rollers.map(x=>({name:x.name,kind:x.device,mount:mount(x),part:x.index}));
    for(const role of ['kicker','ramp']){const list=d.filter(x=>x.role===role);if(list.length)out[role+'s']=list.map(x=>({name:x.name,down:x.down,up:x.up}));}
    if(m.shooters.length)out.shooters=m.shooters.map((s,k)=>{const mine=d.filter(x=>x.part==='shooter'&&x.index===k),f=mine.find(x=>x.role==='feeder'),t=mine.find(x=>x.role==='turret'),hd=mine.find(x=>x.role==='hood');
      return {...(hd?{hood:{name:hd.name}}:{}),flywheels:mine.filter(x=>x.role==='flywheel').map(x=>({name:x.name,mount:mount(x)})),ticksPerSecond:m.shooter.rpm*m.shooter.ticksPerRev/60,
        indexer:{name:f.name,kind:f.feeder,mount:mount(f),...(Mech.servoFeeder(f.feeder)?{feed:f.feed,rest:f.rest}:{})},
        ...(t?{turret:t.device==='servo'?{name:t.name,kind:'servo',center:m.turret.servoCenter,degrees:m.turret.servoDegrees,mount:mount(t)}:{name:t.name,kind:'motor',ticksPerDegree:m.turret.ticksPerDegree,mount:mount(t)}}:{})};});
    return out;
  }
  // ---------------------------------------------------------------- wiring, sensors and the robot's own moving parts
  const Hw=()=>globalThis.DeckHardware||(typeof require==='function'?require('./sim-hardware.js'):null);
  const Kin=()=>globalThis.DeckKinematics||require('./sim-kinematics.js'),Act=()=>globalThis.DeckActuators||require('./sim-actuators.js');
  // Every device and sensor as Setup wires it (DeckHardware rows, with the ports Deck planned for the rest).
  function wiredRows(robot,localization,mechanisms,kinematics){const H=Hw();if(!H)return [];
    try{return H.placed(H.rows({robot,mechanisms,kinematics,sensors:{localization}},robotNeeds(robot,localization,mechanisms)),robot?.wiring);}catch{return [];}}
  // A wired sensor as the code and the virtual hub read it: its configuration name (one on an encoder input is read
  // through the motor on that port), what it gives (analog volts, a switch, encoder counts, a distance or colour) and its
  // calibration. An analog sensor not calibrated yet reads its model's span, mid-span where the CAD has the part.
  const SENSOR_TYPES={axonFeedback:'analog',potentiometer:'analog',analogAbs:'analog',touch:'touch',magnetic:'digital',limit:'digital',color:'color',distance:'distance',throughBore:'encoder'};
  function sensorSpecs(rows,robot){const H=Hw(),stored=new Map((robot?.wiring?.sensors||[]).map(s=>[s.id,s]));if(!H)return [];
    return rows.filter(r=>r.role==='sensor'&&SENSOR_TYPES[r.kind]).map(r=>{const s=stored.get(r.id)||{},md=H.SENSOR_MODELS[r.model]||{},type=r.kind==='magnetic'&&md.xmlType==='RevTouchSensor'?'touch':SENSOR_TYPES[r.kind],span=md.voltage>0?md.voltage:3.3;
      return {id:r.id,name:r.via||r.name,type,kind:r.kind,use:r.use,for:r.for,...(Number.isInteger(r.port)?{port:r.port}:{}),inverted:!!s.inverted,
        ...(type==='analog'?{zeroVolts:Number.isFinite(s.zeroVolts)?s.zeroVolts:span/2,voltsPerUnit:Number.isFinite(s.voltsPerUnit)?s.voltsPerUnit:span/(md.degrees||360)}:{}),
        ...(type==='encoder'?{countsPerUnit:Number.isFinite(s.countsPerUnit)?s.countsPerUnit:(md.cpr||8192)/360,cpr:md.cpr||8192}:{})};});}
  // The sensor that tells where a device is (an Axon's feedback wire, a potentiometer, an analog encoder), or null.
  const positionSensor=(specs,key)=>(specs||[]).find(s=>s.for===key&&s.use==='position'&&s.type==='analog')||null;
  // The virtual Control Hub's sensors (src/sim-engine.cjs hub.sensors), with the names and calibration the export reads.
  function sensorHardware(robot,kin,mechanisms,localization='encoders'){
    const joints=kin?.joints||[],actuators=new Set((kin?.actuators||[]).map(a=>a.id)),specs=sensorSpecs(wiredRows(robot,localization,mechanisms,kin),robot);
    const joint=(signal,of)=>{const j=joints.find(x=>x.drive?.signal===signal&&(x.drive.of===of||signal==='feeder'&&x.drive.of==='any'));return j?{joint:j.id}:null;};
    return specs.map(s=>{const [list,index,field]=String(s.for).split('.'),n=+index||0;
      const source=list==='kin'?(actuators.has(index)?{actuator:index}:{joint:index}):s.use==='piece'&&(list==='intakes'||list==='shooters')?{piece:list==='intakes'?'intake':'shooter',index:n}
        :list==='shooters'&&field==='turretMotor'?{turret:n}:list==='shooters'&&field==='hood'?joint('hood','shooter:'+n):list==='intakes'&&field==='servo'?joint('deploy','intake:'+n):list==='shooters'&&field==='indexer'?joint('feeder','shooter:'+n):null;
      if(!source)return null;const {id:_i,kind:_k,use:_u,for:_f,...hub}=s;return {...hub,source};}).filter(Boolean);}
  // The robot's own moving parts that route actions move ("Lift up", "Claw to 30°"): each FTC motor or servo on a part
  // that route actions drive (game parts run with their intake or shooter), with what the code needs to move it.
  const PART_KINDS={servo:'servo',linear:'servo',crservo:'crservo',dcmotor:'motor'};
  function partDevices(kin){
    if(!kin?.actuators?.length)return [];const K=Kin(),A=Act(),out=[],used=new Set();
    for(const a of kin.actuators){if(!PART_KINDS[a.kind])continue;const j=(kin.joints||[]).find(x=>x.id===a.joint);if(!j||j.drive&&j.drive.signal!=='action')continue;
      let method=A.camel(a.name);while(used.has(method))method+='2';used.add(method);const Name=method[0].toUpperCase()+method.slice(1);
      const [lo,hi]=K.limitsOf(j)[a.index||0]||[-Infinity,Infinity],home=Number.isFinite(a.home)?a.home:Number.isFinite(j.home)?j.home:0;
      const p={id:a.id,joint:j.id,role:'part',label:a.name,method,Name,constant:'PART_'+method.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toUpperCase(),name:a.device||A.camel(a.name),device:PART_KINDS[a.kind],kind:a.kind,
        model:a.model||null,reversed:!!a.reversed,unit:K.dofOf(j)[a.index||0]==='in'?'in':'degrees',states:a.states||j.states||{},home,min:Number.isFinite(lo)?lo:null,max:Number.isFinite(hi)?hi:null,
        speed:a.speed||90,accel:a.accel||0,power:Number.isFinite(a.power)?Math.min(1,a.power):1,setting:{kin:a.id},...(a.device2?{name2:a.device2,reversed2:!!a.reversed2}:{})};
      if(a.kind==='servo'||a.kind==='linear'){const v=A.servo(a);Object.assign(p,{center:v.center,servoMin:v.min,servoMax:v.max,perUnit:1/A.valueAt(a,v.center+1),pwm:v.pwm});}
      if(a.kind==='dcmotor')p.countsPerUnit=A.countsPer(a);
      out.push(p);}
    return out;}
  // The virtual hub's parts (src/sim-engine.cjs hub.kinematics), as the engine lists them, except that a part read through
  // a Through Bore on its own motor port counts that encoder, as the export does.
  function kinematicsHardware(kin,robot){const A=Act(),specs=sensorSpecs(wiredRows(robot,'encoders',null,kin),robot);
    return (kin?.actuators||[]).filter(a=>PART_KINDS[a.kind]).map(a=>{const type=PART_KINDS[a.kind],v=A.servo(a),name=a.device||A.camel(a.name),port=robot?.wiring?.devices?.['kin.'+a.id]?.port;
      const bore=type==='motor'&&specs.find(s=>s.for==='kin.'+a.id&&s.type==='encoder'&&s.name===name&&s.use==='position');
      return {id:a.id,name,type,reversed:!!a.reversed,countsPerUnit:bore?bore.countsPerUnit:A.countsPer(a),...(type==='servo'?{servo:{center:v.center,perUnit:A.perUnit(a),sign:a.reversed?-1:1,ratio:Number.isFinite(a.ratio)&&a.ratio?a.ratio:1,pwm:v.pwm}}:{}),...(Number.isInteger(port)?{port}:{})};});}
  // A route action that moves one of them: "<part> <named position>" or "<part> to N", as the simulator reads it.
  function partAction(name,parts){
    if(!parts?.list?.length||!parts.kinematics)return '';let r=null;try{r=Kin().resolveAction(parts.kinematics,name);}catch{}
    const p=r?.kind==='move'&&r.actuator?parts.list.find(x=>x.id===r.actuator):null;if(!p)return '';
    return `if (step.first) parts.${p.method}(${javaNumber(r.value)});\n        return step.moving || parts.${p.method}Done();`;}
  // Parts.java: each moving part on its motor or servo. The CAD is every part's zero: a motor's encoder is reset where the
  // robot starts (posed as in the CAD), and a servo's center holds the part where the CAD has it. A part with a position
  // sensor is there once the sensor says so (or after its time plus SENSOR_TIMEOUT_SECONDS); one without is there after
  // the time the simulator gives the move, or (a motor) once RUN_TO_POSITION is done.
  function partsSource(options,parts,specs){
    const q=s=>`"${comment(s)}"`,C=[],fields=[],init=[],methods=[],updates=[],stops=[];
    for(const p of parts){const c=p.constant,f=p.method,sensor=positionSensor(specs,'kin.'+p.id),home=(specs||[]).find(s=>s.for==='kin.'+p.id&&s.use==='home'&&['touch','digital'].includes(s.type)),
      // A Through Bore (or other quadrature encoder) on the part's own motor port: RUN_TO_POSITION counts it, not the motor.
      bore=p.device==='motor'&&(specs||[]).find(s=>s.for==='kin.'+p.id&&s.type==='encoder'&&s.name===p.name&&s.use==='position'),states=Object.entries(p.states).map(([k,v])=>`${k} ${+Number(v).toFixed(3)}`).join(', ');
      C.push(`    // ---- ${comment(p.label)}: a ${p.kind==='dcmotor'?'motor':p.kind==='crservo'?'continuous servo':p.kind==='linear'?'linear servo':'servo'} ${q(p.name)}${p.model?` (${comment(p.model)})`:''}, in ${p.unit} from where the CAD has it${states?`; named positions ${comment(states)}`:''}.`,
        `    public static final String ${c} = ${javaString(p.name)};`,`    public static final double ${c}_HOME = ${n(p.home)}, ${c}_SPEED = ${n(p.speed)}, ${c}_ACCEL = ${n(p.accel)}${p.min!==null?`, ${c}_MIN = ${n(p.min)}`:''}${p.max!==null?`, ${c}_MAX = ${n(p.max)}`:''};`);
      if(p.device==='servo')C.push(`    /** The servo position that holds it where the CAD has it, and the change in position per ${p.unit==='in'?'inch':'degree'}${p.reversed?' (it turns the other way)':''}. */`,`    public static final double ${c}_CENTER = ${n(p.center)}, ${c}_POSITION_PER_UNIT = ${p.perUnit.toPrecision(6)}, ${c}_SERVO_MIN = ${n(p.servoMin)}, ${c}_SERVO_MAX = ${n(p.servoMax)};`);
      else if(p.device==='motor')C.push(bore?`    /** ${comment(bore.name)}'s encoder port reads a ${bore.cpr}-count encoder on the part itself: counts per ${p.unit==='in'?'inch':'degree'} of the part, and its power for RUN_TO_POSITION. */`:`    /** Encoder counts per ${p.unit==='in'?'inch':'degree'} of the part, and its power for RUN_TO_POSITION. */`,`    public static final double ${c}_COUNTS_PER_UNIT = ${(bore?bore.countsPerUnit:p.countsPerUnit).toPrecision(6)}, ${c}_POWER = ${n(p.power)};`,`    public static final boolean ${c}_REVERSED = ${p.reversed};`);
      else C.push(`    /** Its power while it moves, and which way positive power turns it. */`,`    public static final double ${c}_POWER = ${n(p.power)};`,`    public static final boolean ${c}_REVERSED = ${p.reversed};`);
      if(p.name2)C.push(`    /** A second ${p.device==='motor'?'motor':'servo'} on the same part, driven with the first${p.reversed2?' (mounted mirrored)':''}. */`,`    public static final String ${c}_2 = ${javaString(p.name2)};`);
      if(home)C.push(`    /** ${comment(home.name)} closes where the CAD has the part: sent there, it re-zeroes the encoder on the switch. */`,`    public static final String ${c}_HOME_SWITCH = ${javaString(home.name)};`);
      if(sensor)C.push(`    /** ${comment(sensor.name)} tells where it is: volts where the CAD has it, and volts per ${p.unit==='in'?'inch':'degree'} (the guided check measures both). */`,`    public static final String ${c}_SENSOR = ${javaString(sensor.name)};`,`    public static final double ${c}_ZERO_VOLTS = ${n(sensor.zeroVolts)}, ${c}_VOLTS_PER_UNIT = ${sensor.voltsPerUnit.toPrecision(6)};`);
      C.push('');
      const type=p.device==='servo'?'Servo':p.device==='crservo'?'CRServo':'DcMotorEx';fields.push(`    private ${type} ${f};${p.name2?`\n    private ${type} ${f}2;`:''}${sensor?`\n    private AnalogInput ${f}Sensor;`:''}${home?`\n    private ${home.type==='touch'?'TouchSensor':'DigitalChannel'} ${f}Home;`:''}`,`    private double ${f}Target = ${c}_HOME, ${f}From = ${c}_HOME, ${f}Start = -1;`);
      if(p.device==='servo')init.push(`        ${f} = map.get(Servo.class, ${c});`,...(p.pwm&&(p.pwm[0]!==600||p.pwm[1]!==2400)?[`        if (${f} instanceof ServoImplEx) ((ServoImplEx) ${f}).setPwmRange(new PwmControl.PwmRange(${p.pwm[0]}, ${p.pwm[1]}));`]:[]),`        ${f}.setPosition(${f}Position(${c}_HOME));`);
      else if(p.device==='motor')init.push(`        ${f} = map.get(DcMotorEx.class, ${c});`,`        ${f}.setDirection(${c}_REVERSED ? DcMotorSimple.Direction.REVERSE : DcMotorSimple.Direction.FORWARD);`,`        ${f}.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);`,`        // Zero is where the robot starts, posed as in the CAD.`,`        ${f}.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);`,`        ${f}.setTargetPosition((int) Math.round(${c}_HOME * ${c}_COUNTS_PER_UNIT));`,`        ${f}.setMode(DcMotor.RunMode.RUN_TO_POSITION);`);
      else init.push(`        ${f} = map.get(CRServo.class, ${c});`,`        ${f}.setDirection(${c}_REVERSED ? DcMotorSimple.Direction.REVERSE : DcMotorSimple.Direction.FORWARD);`);
      if(sensor)init.push(`        ${f}Sensor = map.get(AnalogInput.class, ${c}_SENSOR);`);
      if(home)init.push(home.type==='touch'?`        ${f}Home = map.get(TouchSensor.class, ${c}_HOME_SWITCH);`:`        ${f}Home = map.get(DigitalChannel.class, ${c}_HOME_SWITCH);\n        ${f}Home.setMode(DigitalChannel.Mode.INPUT);`);
      // The second one is looked up by tryGet: a robot without it still runs.
      if(p.name2)init.push(`        ${f}2 = map.tryGet(${type}.class, ${c}_2);`,...(p.device==='motor'?[`        if (${f}2 != null) {`,`            ${f}2.setDirection(${c}_REVERSED != ${p.reversed2} ? DcMotorSimple.Direction.REVERSE : DcMotorSimple.Direction.FORWARD);`,`            ${f}2.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);`,`            ${f}2.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);`,`            ${f}2.setTargetPosition((int) Math.round(${c}_HOME * ${c}_COUNTS_PER_UNIT));`,`            ${f}2.setMode(DcMotor.RunMode.RUN_TO_POSITION);`,`        }`]:p.device==='crservo'?[`        if (${f}2 != null) ${f}2.setDirection(${c}_REVERSED != ${p.reversed2} ? DcMotorSimple.Direction.REVERSE : DcMotorSimple.Direction.FORWARD);`]:[`        if (${f}2 != null) ${f}2.setPosition(${f}Position2(${c}_HOME));`]));
      const clampValue=p.min!==null||p.max!==null?`        value = Math.max(${p.min!==null?`${c}_MIN`:'-Double.MAX_VALUE'}, Math.min(${p.max!==null?`${c}_MAX`:'Double.MAX_VALUE'}, value));\n`:'';
      const at=sensor?`Math.abs(${f}Measured() - ${f}Target) <= TOLERANCE_${p.unit==='in'?'INCHES':'DEGREES'}`:null,time=`moveSeconds(Math.abs(${f}Target - ${f}From), ${c}_SPEED${p.device==='crservo'?` * ${c}_POWER`:''}, ${c}_ACCEL)`;
      const done=p.device==='motor'?`!${f}.isBusy() || t >= ${time} * 2 + SENSOR_TIMEOUT_SECONDS`:at?`${at} || t >= ${time} + SENSOR_TIMEOUT_SECONDS`:`t >= ${time}`;
      methods.push(`
    /** ${comment(p.label)} to a value: ${p.unit} from where the CAD has it. Route actions: "${comment(p.label)} <named position>" or "${comment(p.label)} to N". */
    public void ${f}(double value) {
${clampValue}        ${f}From = ${f}Target;
        ${f}Target = value;
        ${f}Start = clock.seconds();
${p.device==='servo'?`        ${f}.setPosition(${f}Position(value));${p.name2?`\n        if (${f}2 != null) ${f}2.setPosition(${f}Position2(value));`:''}`:p.device==='motor'?`        ${f}.setTargetPosition((int) Math.round(value * ${c}_COUNTS_PER_UNIT));\n        ${f}.setMode(DcMotor.RunMode.RUN_TO_POSITION);\n        ${f}.setPower(${c}_POWER);${p.name2?`\n        if (${f}2 != null) {\n            ${f}2.setTargetPosition((int) Math.round(value * ${c}_COUNTS_PER_UNIT));\n            ${f}2.setMode(DcMotor.RunMode.RUN_TO_POSITION);\n            ${f}2.setPower(${c}_POWER);\n        }`:''}`:`        ${f}.setPower(Math.signum(value - ${f}From) * ${c}_POWER);${p.name2?`\n        if (${f}2 != null) ${f}2.setPower(Math.signum(value - ${f}From) * ${c}_POWER);`:''}`}
    }

    /** True once ${comment(p.label)} has got there${at?' (its sensor says so)':p.device==='motor'?' (RUN_TO_POSITION is done)':''}. */
    public boolean ${f}Done() {
        if (${f}Start < 0) return true;
        double t = clock.seconds() - ${f}Start;
        boolean done = ${done};${p.device==='crservo'?`
        if (done) { ${f}.setPower(0);${p.name2?` if (${f}2 != null) ${f}2.setPower(0);`:''} }`:''}
        return done;
    }
${p.device==='servo'?`
    private static double ${f}Position(double value) {
        return Math.max(${c}_SERVO_MIN, Math.min(${c}_SERVO_MAX, ${c}_CENTER + value * ${c}_POSITION_PER_UNIT));
    }
${p.name2?`
    /** The second servo's position: the same, or mirrored about the center when it is mounted mirrored. */
    private static double ${f}Position2(double value) {
        return ${p.reversed2?`Math.max(0, Math.min(1, 2 * ${c}_CENTER - ${f}Position(value)))`:`${f}Position(value)`};
    }
`:''}`:''}${home?`
    /** True while ${comment(home.name)} is closed (REV switches pull the line low). */
    public boolean ${f}AtHome() {
        return ${home.type==='touch'?`${f}Home.isPressed()`:`${home.inverted?'':'!'}${f}Home.getState()`};
    }
`:''}${sensor?`
    /** Where ${comment(p.label)} is by its sensor, ${p.unit} from where the CAD has it. */
    public double ${f}Measured() {
        return (${f}Sensor.getVoltage() - ${c}_ZERO_VOLTS) / ${c}_VOLTS_PER_UNIT;
    }
`:''}`);
      if(p.device==='crservo')updates.push(`        ${f}Done();`);
      // Sent home with its switch closed: the encoder counts from here again (relative encoders drift between runs).
      if(p.device==='motor'&&home)updates.push(`        if (${f}AtHome() && Math.abs(${f}Target - ${c}_HOME) < 1e-6 && ${f}.getCurrentPosition() != (int) Math.round(${c}_HOME * ${c}_COUNTS_PER_UNIT)) {`,`            ${f}.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);`,`            ${f}.setTargetPosition((int) Math.round(${c}_HOME * ${c}_COUNTS_PER_UNIT));`,`            ${f}.setMode(DcMotor.RunMode.RUN_TO_POSITION);`,...(p.name2?[`            if (${f}2 != null) {`,`                ${f}2.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);`,`                ${f}2.setTargetPosition((int) Math.round(${c}_HOME * ${c}_COUNTS_PER_UNIT));`,`                ${f}2.setMode(DcMotor.RunMode.RUN_TO_POSITION);`,`            }`]:[]),`        }`);
      stops.push(p.device==='servo'?null:`        ${f}.setPower(0);${p.name2?`\n        if (${f}2 != null) ${f}2.setPower(0);`:''}`);}
    const sensed=parts.some(p=>positionSensor(specs,'kin.'+p.id));
    return `package ${options.packageName};

import com.qualcomm.robotcore.hardware.AnalogInput;
import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.DigitalChannel;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.PwmControl;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.hardware.ServoImplEx;
import com.qualcomm.robotcore.hardware.TouchSensor;
import com.qualcomm.robotcore.util.ElapsedTime;

/**
 * The robot's own moving parts of "${comment(options.layoutName||'route')}", generated by Torque from Setup → Mechanisms.
 * Export rewrites this file. Route actions such as "Lift up" call these methods; they never wait, so the robot keeps
 * following its path (or holding its pin) while a part moves. The CAD is every part's zero: start the robot posed as
 * in the CAD, with each motor's encoder counting from there.
 */
public class Parts {
${C.join('\n').replace(/\n+$/,'')}

    /** How close a part with a position sensor counts as there, and how much longer than its move it may take. */
    public static final double TOLERANCE_DEGREES = 2.0, TOLERANCE_INCHES = 0.1, SENSOR_TIMEOUT_SECONDS = ${sensed?'0.5':'0.5'};

${fields.join('\n')}
    private final ElapsedTime clock = new ElapsedTime();

    public void init(HardwareMap map) {
${init.join('\n')}
    }
${methods.join('')}
    /** Called every loop: a continuous servo stops once it is there. */
    public void update() {
${updates.join('\n')}
    }

    public void stop() {
${stops.filter(Boolean).join('\n')}
    }

    /** Seconds a move of d takes at speed (units a second), speeding up and slowing down at accel (0: at once). */
    private static double moveSeconds(double d, double speed, double accel) {
        if (d <= 0) return 0;
        if (speed <= 0) return Double.MAX_VALUE;
        if (accel <= 0) return d / speed;
        return d >= speed * speed / accel ? d / speed + speed / accel : 2 * Math.sqrt(d / accel);
    }
}
`.replace(/\n\n\n+/g,'\n\n');}
  // An old RobotActions.java (the team's own file, never overwritten) still holding Deck's empty "return true" method for
  // an action Deck now runs itself would override it and nothing would move. Those untouched methods are taken out; any
  // method the team wrote stays. Returns {text, removed: slot names}.
  function retireStubs(text,slots){
    let out=String(text||'').replace(/\r\n/g,'\n');const removed=[];
    for(const slot of slots||[]){if(!/^\w+$/.test(slot))continue;
      const stub=new RegExp(`\\n[ \\t]*/\\*\\*[^\\n]*\\*/[ \\t]*\\n[ \\t]*@Override[ \\t]*\\n[ \\t]*public boolean ${slot}\\(Step step\\) \\{[ \\t]*\\n(?:[ \\t]*//[^\\n]*\\n)*[ \\t]*return true;[ \\t]*\\n[ \\t]*\\}[ \\t]*\\n`);
      if(stub.test(out)){out=out.replace(stub,'\n');removed.push(slot);}}
    return {text:removed.length?out:String(text||''),removed};}
  function mechanismsSource(options,m,target,robot={}){
    const Mech=globalThis.DeckMechanisms||require('./sim-mechanisms.js'),d=mechanismDevices(m,robot,options.kinematics),specs=options.sensorSpecs||[],of=role=>d.filter(x=>x.role===role),velocity=m.shooter.control!=='power';
    const rollers=of('roller'),swings=d.filter(x=>x.role==='kicker'||x.role==='ramp'),flywheels=of('flywheel'),feeders=of('feeder'),turrets=of('turret');
    if(swings.some(x=>x.device!=='servo'))throw Error('Exported code runs a ramp or kicker on a servo. Set its Runs on to a servo to export this robot.');
    if(of('turret2').some(x=>x.device!=='servo'))throw Error('Exported code runs a second turret device only when the turret is on set-position servos.');
    const motorTurrets=turrets.filter(x=>x.device==='motor'),servoTurrets=turrets.filter(x=>x.device==='servo'),crTurrets=turrets.filter(x=>x.device==='crservo').map(x=>({x,s:positionSensor(specs,`shooters.${x.index}.turretMotor`)})),pushers=feeders.filter(x=>x.feeder==='pusher'),hoods=of('hood');
    // A ramp with a position sensor (an Axon's feedback wire, a potentiometer) is down or up once the sensor says so.
    const deployJoint=k=>(options.kinematics?.joints||[]).find(j=>j.drive?.signal==='deploy'&&j.drive.of==='intake:'+k);
    const sensed=swings.filter(x=>x.role==='ramp').map(x=>{const s=positionSensor(specs,`intakes.${x.index}.servo`),j=deployJoint(x.index);return s&&j?{x,s,down:j.states?.lowered??j.upper??90,up:j.states?.raised??0}:null;}).filter(Boolean);
    const q=s=>`"${comment(s)}"`,turns=x=>x.reversed?' (turns the other way)':'',where=mount=>Mech.MOUNTS[mount].toLowerCase(),list=values=>`{${values.join(', ')}}`;
    const FEEDERS={motor:'motor',crservo:'continuous servo',pusher:'servo pusher',gate:'servo gate'};
    const intakeText=(i,k)=>{const mine=d.filter(x=>x.part==='intake'&&x.index===k);
      return ` *  - Intake ${k+1} (${i.sides.join(' + ')} ${Mech.INTAKES[i.kind].toLowerCase()}): ${mine.map(x=>x.role==='roller'?`${x.device==='crservo'?'continuous servo':'motor'} ${q(x.name)}${turns(x)}`:`${x.role} servo ${q(x.name)}`).join(', ')}.`;};
    const shooterText=(s,k)=>{const mine=d.filter(x=>x.part==='shooter'&&x.index===k),f=mine.find(x=>x.role==='feeder'),t=mine.find(x=>x.role==='turret'),fw=mine.filter(x=>x.role==='flywheel');
      const kind=s.sharesTurret?`on shooter 1's turret`:s.type==='turret'?`turret at the ${where(s.mount)}`:`fixed at the ${where(s.mount)}, firing toward the ${s.facing}`;
      return ` *  - Shooter ${k+1} (${Mech.PIECES[s.pieces].toLowerCase()}): ${kind}; flywheel motor${fw.length>1?'s':''} ${fw.map(x=>q(x.name)+turns(x)).join(' and ')}, feeder ${FEEDERS[f.feeder]} ${q(f.name)}${Mech.servoFeeder(f.feeder)?'':turns(f)}${t?`, turret ${t.device==='crservo'?'continuous servo':t.device} ${q(t.name)}${turns(t)}`:''}.`;};
    // Constants, one block per part, then the shared timing.
    const C=[];
    m.intakes.forEach((i,k)=>{const mine=d.filter(x=>x.part==='intake'&&x.index===k);C.push(`    // ---- Intake ${k+1}: ${i.sides.join(' + ')} ${Mech.INTAKES[i.kind].toLowerCase()}.`);
      for(const x of mine){if(x.role==='roller')C.push(`    /** ${x.label}: a ${x.device==='crservo'?'continuous servo':'DC motor'} that runs at its power while an Intake action runs. */`,`    public static final String ${x.constant} = ${javaString(x.name)};`,`    public static final boolean ${x.constant}_REVERSED = ${x.reversed};`,`    public static final double ${x.constant}_POWER = ${n(x.power)};`);
        else C.push(x.role==='kicker'?`    /** ${x.label}: its position down (scooping) while an Intake action runs, and up otherwise. */`:`    /** ${x.label}: its position down (Ramp down: it reaches into flowers) and up (Ramp up). It stays where it was sent. */`,`    public static final String ${x.constant} = ${javaString(x.name)};`,`    public static final double ${x.constant}_DOWN = ${n(x.down)}, ${x.constant}_UP = ${n(x.up)};`);}
      C.push('');});
    const ramps=m.intakes.filter(i=>i.kind==='ramp');
    if(ramps.length)C.push(`    /** Seconds a ramp takes to fold down and back up: Ramp down and Ramp up at a pin wait this long${sensed.length?' (a ramp with a sensor waits for it instead, at most SENSOR_TIMEOUT_SECONDS longer)':''}. */`,`    public static final double RAMP_DOWN_SECONDS = ${n(Math.max(...ramps.map(i=>i.down)))}, RAMP_UP_SECONDS = ${n(Math.max(...ramps.map(i=>i.up)))};`,'');
    for(const {x,s,down,up} of sensed)C.push(`    /** ${comment(s.name)} tells where intake ${x.index+1}'s ramp is: volts where the CAD has it, volts per degree, and the ramp's angle down and up. */`,`    public static final String ${x.constant}_SENSOR = ${javaString(s.name)};`,`    public static final double ${x.constant}_ZERO_VOLTS = ${n(s.zeroVolts)}, ${x.constant}_VOLTS_PER_DEGREE = ${s.voltsPerUnit.toPrecision(6)}, ${x.constant}_DOWN_DEGREES = ${n(down)}, ${x.constant}_UP_DEGREES = ${n(up)};`);
    if(sensed.length)C.push('    /** A part with a sensor is there within SWING_TOLERANCE_DEGREES; one that never gets there carries on SENSOR_TIMEOUT_SECONDS after its time. */','    public static final double SWING_TOLERANCE_DEGREES = 3.0, SENSOR_TIMEOUT_SECONDS = 0.5;','');
    m.shooters.forEach((s,k)=>{const mine=d.filter(x=>x.part==='shooter'&&x.index===k);C.push(`    // ---- Shooter ${k+1}: ${Mech.PIECES[s.pieces].toLowerCase()}.`);
      const fw=mine.filter(x=>x.role==='flywheel');C.push(`    /** Flywheel motor${fw.length>1?'s (both spin the flywheel; set each one\'s direction so they push the same way)':''}. */`,`    public static final String ${fw.map(x=>`${x.constant} = ${javaString(x.name)}`).join(', ')};`,`    public static final boolean ${fw.map(x=>`${x.constant}_REVERSED = ${x.reversed}`).join(', ')};`);
      const f=mine.find(x=>x.role==='feeder');
      if(Mech.servoFeeder(f.feeder))C.push(`    /** Feeder: a ${FEEDERS[f.feeder]}. ${f.feeder==='pusher'?'FEED pushes a piece into the flywheel; REST lets the next one drop in.':'FEED is open (pieces pass); REST is closed.'} */`,`    public static final String ${f.constant} = ${javaString(f.name)};`,`    public static final double ${f.constant}_FEED = ${n(f.feed)}, ${f.constant}_REST = ${n(f.rest)};`);
      else C.push(`    /** Feeder: a ${FEEDERS[f.feeder]} that runs at FEEDER_POWER while shooting. */`,`    public static final String ${f.constant} = ${javaString(f.name)};`,`    public static final boolean ${f.constant}_REVERSED = ${f.reversed};`);
      const t=mine.find(x=>x.role==='turret');
      const hd=mine.find(x=>x.role==='hood');
      if(hd)C.push(`    /** Hood servo: SHOOT tilts it to the shooting angle for Spin up and Shoot; REST holds it where the CAD has it. */`,`    public static final String ${hd.constant} = ${javaString(hd.name)};`,`    public static final double ${hd.constant}_SHOOT = ${n(hd.shoot)}, ${hd.constant}_REST = ${n(hd.rest)};`);
      for(const b of mine.filter(x=>x.role==='turret2'))C.push(`    /** Second turret servo, on the same gear train: it goes where the first goes. */`,`    public static final String ${b.constant} = ${javaString(b.name)};`);
      if(t)C.push(`    /** Turret: a ${{servo:'servo',crservo:'continuous servo, steered by its feedback wire'}[t.device]||'motor with an encoder'}. It aims from where it turns on the robot, inches forward and left of the center. */`,`    public static final String ${t.constant} = ${javaString(t.name)};`,`    public static final boolean ${t.constant}_REVERSED = ${t.reversed};`,`    public static final double ${t.constant}_X = ${n(t.offset[0])}, ${t.constant}_Y = ${n(t.offset[1])};`);
      C.push('');});
    if(m.shooters.length){
      C.push('    // ---- Flywheels (every shooter).');
      if(velocity)C.push(`    /** Shooting speed in encoder ticks per second: ${+m.shooter.rpm.toPrecision(6)} RPM x ${+m.shooter.ticksPerRev.toPrecision(6)} ticks per revolution / 60. */`,`    public static final double FLYWHEEL_TICKS_PER_SECOND = ${n(m.shooter.rpm*m.shooter.ticksPerRev/60)};`,
        '    /** A flywheel is at speed within this fraction of FLYWHEEL_TICKS_PER_SECOND. */',`    public static final double AT_SPEED_TOLERANCE = ${n(m.shooter.tolerance)};`,
        '    /** Seconds to reach speed. A flywheel still short of it SPIN_UP_SECONDS + 0.5 s after starting shoots anyway. */',`    public static final double SPIN_UP_SECONDS = ${n(m.shooter.spinUp)};`,
        ...(m.shooter.pidf?['    /** Velocity PIDF for the flywheel motors (REV: F = 32767 / top speed, P = 0.1 F, I = 0.1 P, D = 0). */',`    public static final double FLYWHEEL_P = ${n(m.shooter.pidf.p)}, FLYWHEEL_I = ${n(m.shooter.pidf.i)}, FLYWHEEL_D = ${n(m.shooter.pidf.d)}, FLYWHEEL_F = ${n(m.shooter.pidf.f)};`]:[]));
      else C.push('    /** No encoder: the flywheels run at FLYWHEEL_POWER and count as at speed SPIN_UP_SECONDS after they start. */',`    public static final double FLYWHEEL_POWER = ${n(m.shooter.power)}, SPIN_UP_SECONDS = ${n(m.shooter.spinUp)};`);
      C.push('','    // ---- Feeding (every shooter), timed: there is no piece sensor.',
        '    /** From a piece touching an intake to sitting in the shooter; how long a kicker takes to swing back up after an intake. */',`    public static final double TRANSFER_SECONDS = ${n(m.transfer.seconds)}, KICKER_UP_SECONDS = ${n(Mech.liftSeconds(m))};`,
        `    /** For the next piece to move up into the shooter after a shot.${pushers.length?' A pusher pushes for PUSH_SECONDS at the start of every FEED_CYCLE_SECONDS.':''} */`,`    public static final double INDEX_SECONDS = ${n(m.indexer.seconds)}${pushers.length?`, PUSH_SECONDS = ${n(m.indexer.pushSeconds)}`:''};`,
        `    /** A volley of N shots feeds for (N - 1) x FEED_CYCLE_SECONDS + LAST_SHOT_SECONDS. */`,`    public static final double FEED_CYCLE_SECONDS = ${n(pushers.length?Math.max(m.indexer.seconds,2*m.indexer.pushSeconds):m.indexer.seconds)}, LAST_SHOT_SECONDS = ${n(Mech.shootSeconds(m,1))};`,
        ...(feeders.some(x=>!Mech.servoFeeder(x.feeder))?[`    public static final double FEEDER_POWER = ${n(m.indexer.power)};`]:[]),
        `    /** Pieces the robot can hold: ${m.capacity.pollen} pollen${m.capacity.nectar?` and ${m.capacity.nectar} nectar`:''}. "Shoot" with no number shoots this many. */`,`    public static final int STORAGE = ${m.storage};`,
        '    /** The field points shots aim at, in inches: the hive cell up at the start, and the other cell. */',`    public static final double TARGET_X = ${n(target.x)}, TARGET_Y = ${n(target.y)}, OTHER_TARGET_X = ${n(target.x)}, OTHER_TARGET_Y = ${n(144-target.y)};`);
      if(turrets.length)C.push('','    // ---- Turrets: 0 degrees faces the robot\'s front, positive turns counterclockwise (to the robot\'s left).',`    public static final double TURRET_MIN_DEGREES = ${n(m.turret.min)}, TURRET_MAX_DEGREES = ${n(m.turret.max)};`,
        ...(motorTurrets.length?['    /** Encoder ticks per turret degree and the motor power for RUN_TO_POSITION. Zero is where the turret is at INIT. */',`    public static final double TURRET_TICKS_PER_DEGREE = ${n(m.turret.ticksPerDegree)}, TURRET_POWER = 1.0;`]:[]),
        ...(servoTurrets.length?['    /** Servo position facing the front, and turret degrees from servo position 0 to 1. A servo has no feedback, so its angle', '     *  is tracked as it turns at TURRET_DEGREES_PER_SECOND, and it counts as aimed within AIMED_DEGREES of its target. */',`    public static final double TURRET_SERVO_CENTER = ${n(m.turret.servoCenter)}, TURRET_SERVO_DEGREES = ${n(m.turret.servoDegrees)}, TURRET_DEGREES_PER_SECOND = ${n(m.turret.speed)}, AIMED_DEGREES = 2.0;`]:[]),
        ...(crTurrets.length?['    /** A continuous-servo turret steers by its servo\'s feedback wire: volts per turret degree (negative when the voltage falls as',
          '     *  the turret turns left; the guided check measures it), counting each wrap past 0 or 3.3 V as one more servo turn. Zero is where',
          '     *  the turret is at INIT. Power is TURRET_GAIN per degree off, at most TURRET_CR_POWER; aimed within TURRET_CR_AIMED_DEGREES.',
          '     *  Through gears the servo turns more than the turret: multiply by the servo turns per turret turn. A reading that runs',
          '     *  past the turret\'s whole range (the sign is wrong) stops it. */',
          `    public static final double TURRET_GAIN = 0.02, TURRET_CR_POWER = 1.0, TURRET_CR_AIMED_DEGREES = 2.0, FEEDBACK_VOLTS = 3.3;`,
          ...crTurrets.map(({x,s:sensor})=>`    public static final String ${x.constant}_SENSOR = ${javaString(sensor?.name||x.name+'Position')};\n    public static final double ${x.constant}_VOLTS_PER_DEGREE = ${(sensor?.voltsPerUnit||-3.3/360).toPrecision(6)};`)]:[]));
    }
    // Device fields and setup.
    const type=x=>x.device==='servo'?'Servo':x.device==='crservo'&&(x.role==='turret'||x.role==='turret2')?'CRServo':x.role==='flywheel'||x.role==='turret'||x.role==='turret2'?'DcMotorEx':'DcMotorSimple';
    const fields=[...d.map(x=>`    private ${type(x)} ${x.field};`),...sensed.map(({x})=>`    private AnalogInput ${x.field}Sensor;`),...crTurrets.map(({x})=>`    private AnalogInput ${x.field}Sensor;\n    private double ${x.field}Degrees = 0, ${x.field}Volts = 0, ${x.field}Zero = 0, ${x.field}Wraps = 0;`)];
    const init=[];
    for(const x of d){
      if(x.role==='roller')init.push(`        ${x.field} = map.get(DcMotorSimple.class, ${x.constant});`,`        ${x.field}.setDirection(direction(${x.constant}_REVERSED));`,`        if (${x.field} instanceof DcMotor) ((DcMotor) ${x.field}).setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.FLOAT);`);
      else if(x.role==='kicker'||x.role==='ramp')init.push(`        ${x.field} = map.get(Servo.class, ${x.constant});`,`        ${x.field}.setPosition(${x.constant}_UP);`);
      else if(x.role==='flywheel')init.push(`        ${x.field} = flywheel(map, ${x.constant}, ${x.constant}_REVERSED);`);
      else if(x.role==='feeder')init.push(...(Mech.servoFeeder(x.feeder)?[`        ${x.field} = map.get(Servo.class, ${x.constant});`,`        ${x.field}.setPosition(${x.constant}_REST);`]:[`        ${x.field} = map.get(DcMotorSimple.class, ${x.constant});`,`        ${x.field}.setDirection(direction(${x.constant}_REVERSED));`]));
      else if(x.role==='hood')init.push(`        ${x.field} = map.get(Servo.class, ${x.constant});`,`        ${x.field}.setPosition(${x.constant}_REST);`);
      else if(x.role==='turret2')init.push(`        ${x.field} = map.get(Servo.class, ${x.constant});`,`        ${x.field}.setPosition(TURRET_SERVO_CENTER);`);
      else if(x.role==='turret')init.push(...(x.device==='servo'?[`        ${x.field} = map.get(Servo.class, ${x.constant});`,`        ${x.field}.setPosition(TURRET_SERVO_CENTER);`]:x.device==='crservo'?[`        ${x.field} = map.get(CRServo.class, ${x.constant});`,`        ${x.field}Sensor = map.get(AnalogInput.class, ${x.constant}_SENSOR);`,`        ${x.field}Zero = ${x.field}Volts = ${x.field}Sensor.getVoltage();`]:[`        ${x.field} = turretMotor(map, ${x.constant}, ${x.constant}_REVERSED);`]));
    }
    for(const {x} of sensed)init.push(`        ${x.field}Sensor = map.get(AnalogInput.class, ${x.constant}_SENSOR);`);
    const rampSwings=swings.filter(x=>x.role==='ramp'),rampLines=rampSwings.map(x=>`        ${x.field}.setPosition(down ? ${x.constant}_DOWN : ${x.constant}_UP);`);
    const intakeLines=[...rollers.map(x=>`        ${x.field}.setPower(on ? ${x.constant}_POWER : 0);`),...swings.filter(x=>x.role==='kicker').map(x=>`        ${x.field}.setPosition(on ? ${x.constant}_DOWN : ${x.constant}_UP);`)];
    const spinLines=[...!flywheels.length?[]:velocity?['        double speed = on ? FLYWHEEL_TICKS_PER_SECOND : 0;',...flywheels.map(x=>`        ${x.field}.setVelocity(speed);`)]:['        double power = on ? FLYWHEEL_POWER : 0;',...flywheels.map(x=>`        ${x.field}.setPower(power);`)],...hoods.map(x=>`        ${x.field}.setPosition(on ? ${x.constant}_SHOOT : ${x.constant}_REST);`)];
    const feedLines=feeders.map(x=>x.feeder==='pusher'?`        ${x.field}.setPosition(push ? ${x.constant}_FEED : ${x.constant}_REST);`:x.feeder==='gate'?`        ${x.field}.setPosition(feeding ? ${x.constant}_FEED : ${x.constant}_REST);`:`        ${x.field}.setPower(feeding ? FEEDER_POWER : 0);`);
    const turnLines=turrets.map(x=>`        turn${x.field[0].toUpperCase()+x.field.slice(1)}(degrees);`),aimLines=turrets.map(x=>`        turn${x.field[0].toUpperCase()+x.field.slice(1)}(bearing(pose, ${x.constant}_X, ${x.constant}_Y, x, y));`);
    const turnMethods=turrets.map(x=>{const name='turn'+x.field[0].toUpperCase()+x.field.slice(1);
      if(x.device==='crservo')return `
    /** Turret ${x.index+1} to an angle (degrees from the robot's front, counterclockwise), within its range: aimed() steers it there. */
    private void ${name}(double degrees) {
        ${x.field}Degrees = Math.max(TURRET_MIN_DEGREES, Math.min(TURRET_MAX_DEGREES, degrees));
        steerTurrets();
    }`;
      return x.device==='servo'?`
    /** Turret ${x.index+1} to an angle (degrees from the robot's front, counterclockwise), within its range. */
    private void ${name}(double degrees) {
        degrees = Math.max(TURRET_MIN_DEGREES, Math.min(TURRET_MAX_DEGREES, degrees));
        trackServoTurrets();
        ${x.field}Degrees = degrees;
        double position = TURRET_SERVO_CENTER + (${x.constant}_REVERSED ? -degrees : degrees) / TURRET_SERVO_DEGREES;
        ${x.field}.setPosition(Math.max(0, Math.min(1, position)));${of('turret2').filter(y=>y.index===x.index).map(y=>`
        ${y.field}.setPosition(Math.max(0, Math.min(1, position)));`).join('')}
    }`:`
    /** Turret ${x.index+1} to an angle (degrees from the robot's front, counterclockwise), within its range. */
    private void ${name}(double degrees) {
        degrees = Math.max(TURRET_MIN_DEGREES, Math.min(TURRET_MAX_DEGREES, degrees));
        ${x.field}.setTargetPosition((int) Math.round(degrees * TURRET_TICKS_PER_DEGREE));
        ${x.field}.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        ${x.field}.setPower(TURRET_POWER);
    }`;}).join('\n');
    const aimed=[...motorTurrets.map(x=>`!${x.field}.isBusy()`),...servoTurrets.map(x=>`Math.abs(${x.field}At - ${x.field}Degrees) <= AIMED_DEGREES`),...crTurrets.map(({x})=>`Math.abs(turretAngle${x.index}() - ${x.field}Degrees) <= TURRET_CR_AIMED_DEGREES`)];
    const servos=d.filter(x=>x.device==='servo');
    const shooter=m.shooters.length>0;
    return `package ${options.packageName};

${sensed.length||crTurrets.length?'import com.qualcomm.robotcore.hardware.AnalogInput;\n':''}${crTurrets.length?'import com.qualcomm.robotcore.hardware.CRServo;\n':''}import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.util.ElapsedTime;
import ${options.poseImport||'deck.pathing.DeckFollower.Pose'};

/**
 * The mechanisms of "${comment(options.layoutName||'route')}", generated by Torque from Setup → Mechanisms.
 * Export rewrites this file: change the settings in Deck, or edit the constants below to match your robot.
 *
 * The route's actions call these methods every loop. None of them waits, so the robot keeps following
 * its path (or holding its pin) while they run:
 *  - Intake: intake(true) runs the rollers at their power and lowers kickers; intake(false)
 *    stops the rollers and raises kickers again.${rampSwings.length?`
 *  - Ramp down / Ramp up: ramp(true) folds the ramps down (they reach into flowers) and ramp(false)
 *    folds them up. A ramp stays where it was sent; Intake does not move it.`:''}${shooter?`
 *  - Spin up: spin(true) starts the flywheels toward their speed${velocity?' (velocity control on the hub: RUN_USING_ENCODER)':' (a set power: no encoder)'}.
 *  - Aim: aim(pose, cell) turns each turret toward the hive cell from the robot's estimated pose.
 *  - Shoot: shoot(n, step) spins up and aims. Once ready() and aimed(), and pieces from the last intake
 *    have had TRANSFER_SECONDS to move up, the feeders run for n shots: the first piece is already in the
 *    shooter, and each next one needs FEED_CYCLE_SECONDS. Then the feeders and flywheels stop.`:`
 *  - No shooter.`}
 * To replace one of these with your own code, override that action in RobotActions.
 *
 * Hardware. Names must match the Control Hub configuration exactly, and "turns the other way" is set
 * in Deck (each device's direction is applied in init):
${[...m.intakes.map(intakeText),...m.shooters.map(shooterText)].join('\n')||' *  - No mechanisms.'}
 * Test every device with the mechanism check TeleOp before running the autonomous.
 */
public class Mechanisms {
${C.join('\n').replace(/\n+$/,'')}

${fields.join('\n')}
    private final ElapsedTime clock = new ElapsedTime();
    private double feedStart = -1, spinStart = -1, lastIntake = -1e9${servoTurrets.length?`, trackedAt = 0${servoTurrets.map(x=>`, ${x.field}Degrees = 0, ${x.field}At = 0`).join('')}`:''};
    private boolean spinning, shot;

    public void init(HardwareMap map) {
${init.join('\n')}
    }

    private static DcMotorSimple.Direction direction(boolean reversed) {
        return reversed ? DcMotorSimple.Direction.REVERSE : DcMotorSimple.Direction.FORWARD;
    }
${flywheels.length?`
    private static DcMotorEx flywheel(HardwareMap map, String name, boolean reversed) {
        DcMotorEx motor = map.get(DcMotorEx.class, name);
        motor.setDirection(direction(reversed));
        motor.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.FLOAT);
        motor.setMode(DcMotor.RunMode.${velocity?'RUN_USING_ENCODER':'RUN_WITHOUT_ENCODER'});${velocity&&m.shooter.pidf?`
        motor.setVelocityPIDFCoefficients(FLYWHEEL_P, FLYWHEEL_I, FLYWHEEL_D, FLYWHEEL_F);`:velocity?`
        // Velocity control uses the SDK's default PIDF. For a heavy flywheel, measure its top speed with the
        // mechanism check (Y) and enter the PIDF it prints in Deck.`:''}
        return motor;
    }
`:''}${motorTurrets.length?`
    private static DcMotorEx turretMotor(HardwareMap map, String name, boolean reversed) {
        DcMotorEx motor = map.get(DcMotorEx.class, name);
        motor.setDirection(direction(reversed));
        motor.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
        // Zero is wherever the turret is now: start the robot with the turret facing forward.
        motor.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
        motor.setTargetPosition(0);
        motor.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        return motor;
    }
`:''}
    /** Intake on or off: rollers run at their power; kickers go down, and back up when it stops. */
    public void intake(boolean on) {
        if (on) lastIntake = clock.seconds();
${intakeLines.join('\n')}
    }
${rampLines.length?`
    /** Ramps down (true) or up (false). They stay there until the next Ramp down or Ramp up. */
    public void ramp(boolean down) {
${rampLines.join('\n')}
    }

    /** True once every ramp has got down (or up): ${[sensed.length?'a ramp with a sensor once it reads within SWING_TOLERANCE_DEGREES (or RAMP_..._SECONDS + SENSOR_TIMEOUT_SECONDS have passed)':'',sensed.length<rampSwings.length?'a ramp without one once it has had RAMP_DOWN_SECONDS or RAMP_UP_SECONDS':''].filter(Boolean).join(', ')}. */
    public boolean rampsAt(boolean down, double elapsed) {
        double timed = down ? RAMP_DOWN_SECONDS : RAMP_UP_SECONDS;${sensed.length?`
        if (elapsed >= timed + SENSOR_TIMEOUT_SECONDS) return true;
        boolean at = ${sensed.map(({x})=>`Math.abs(degrees(${x.field}Sensor, ${x.constant}_ZERO_VOLTS, ${x.constant}_VOLTS_PER_DEGREE) - (down ? ${x.constant}_DOWN_DEGREES : ${x.constant}_UP_DEGREES)) <= SWING_TOLERANCE_DEGREES`).join('\n            && ')};
        return at${sensed.length<rampSwings.length?' && elapsed >= timed':''};`:`
        return elapsed >= timed;`}
    }
${sensed.length?`
    /** Degrees from where the CAD has a part, from its analog sensor. */
    private static double degrees(AnalogInput sensor, double zeroVolts, double voltsPerDegree) {
        return (sensor.getVoltage() - zeroVolts) / voltsPerDegree;
    }
`:''}`:''}
    /** Flywheels on (toward their speed) or off. */
    public void spin(boolean on) {
        if (on && !spinning) spinStart = clock.seconds();
        spinning = on;
${spinLines.join('\n')}
    }

    /** ${velocity?'True once every flywheel is within AT_SPEED_TOLERANCE of its speed (or SPIN_UP_SECONDS + 0.5 s have passed).':'True once the flywheels have had SPIN_UP_SECONDS.'} */
    public boolean ready() {
        if (!spinning) return false;${!flywheels.length?`
        return true;`:velocity?`
        if (clock.seconds() - spinStart > SPIN_UP_SECONDS + 0.5) return true;
        return ${flywheels.map(x=>`atSpeed(${x.field})`).join(' && ')};`:`
        return clock.seconds() - spinStart >= SPIN_UP_SECONDS;`}
    }
${velocity&&flywheels.length?`
    private static boolean atSpeed(DcMotorEx flywheel) {
        return Math.abs(flywheel.getVelocity() - FLYWHEEL_TICKS_PER_SECOND) < AT_SPEED_TOLERANCE * FLYWHEEL_TICKS_PER_SECOND;
    }
`:''}
    /** Point every turret at a hive cell (0 TARGET, 1 OTHER_TARGET) from this pose. Fixed shooters are aimed by the route. */
    public void aim(Pose pose, int cell) {${turrets.length?`
        double x = cell == 1 ? OTHER_TARGET_X : TARGET_X, y = cell == 1 ? OTHER_TARGET_Y : TARGET_Y;
${aimLines.join('\n')}`:''}
    }

    /** Every turret to this angle, degrees from the robot's front (counterclockwise). The mechanism check uses it. */
    public void turnTurrets(double degrees) {
${turnLines.join('\n')}
    }
${turrets.length?`
    /** The turret of shooter n (0 the first) to this angle, degrees from the robot's front (counterclockwise). */
    public void turnTurret(int shooter, double degrees) {
${turrets.map(x=>`        if (shooter == ${x.index}) turn${x.field[0].toUpperCase()+x.field.slice(1)}(degrees);`).join('\n')}
    }
`:''}${turrets.length?`
    /** Degrees from the robot's front (counterclockwise) to (x, y), from a turret at (dx, dy) on the robot. */
    private static double bearing(Pose pose, double dx, double dy, double x, double y) {
        double c = Math.cos(pose.heading()), s = Math.sin(pose.heading());
        double tx = pose.x() + dx * c - dy * s, ty = pose.y() + dx * s + dy * c;
        double degrees = Math.toDegrees(Math.atan2(y - ty, x - tx) - pose.heading());
        return ((degrees % 360) + 540) % 360 - 180;
    }
${turnMethods}
`:''}
${crTurrets.length?`    /** Steers each continuous-servo turret toward its angle: proportional power, stopped once it is there. */
    private void steerTurrets() {
${crTurrets.map(({x})=>`        {
            double off = ${x.field}Degrees - turretAngle${x.index}();
            ${x.field}.setPower(Math.abs(off) <= TURRET_CR_AIMED_DEGREES || Math.abs(off) > TURRET_MAX_DEGREES - TURRET_MIN_DEGREES + 30 ? 0 : Math.max(-TURRET_CR_POWER, Math.min(TURRET_CR_POWER, off * TURRET_GAIN * (${x.constant}_REVERSED ? -1 : 1))));
        }`).join('\n')}
    }
${crTurrets.map(({x})=>`
    /** Turret ${x.index+1}'s angle from its feedback wire: each jump of more than half the range is the servo wrapping past a full turn. */
    private double turretAngle${x.index}() {
        double volts = ${x.field}Sensor.getVoltage();
        if (volts - ${x.field}Volts > FEEDBACK_VOLTS / 2) ${x.field}Wraps -= 1;
        else if (${x.field}Volts - volts > FEEDBACK_VOLTS / 2) ${x.field}Wraps += 1;
        ${x.field}Volts = volts;
        return (volts + ${x.field}Wraps * FEEDBACK_VOLTS - ${x.field}Zero) / ${x.constant}_VOLTS_PER_DEGREE;
    }`).join('\n')}

`:''}${servoTurrets.length?`    /** Where the servo turrets are by now: each turns toward its target at TURRET_DEGREES_PER_SECOND. */
    private void trackServoTurrets() {
        double now = clock.seconds(), step = (now - trackedAt) * TURRET_DEGREES_PER_SECOND;
        trackedAt = now;
${servoTurrets.map(x=>`        ${x.field}At += Math.max(-step, Math.min(step, ${x.field}Degrees - ${x.field}At));`).join('\n')}
    }

`:''}    /** True once every turret has reached its angle. */
    public boolean aimed() {${servoTurrets.length?`
        trackServoTurrets();`:''}${crTurrets.length?`
        steerTurrets();`:''}
        return ${aimed.join(' && ')||'true'};
    }

    /** Feeders on or off, for the mechanism check: rollers run, gates open, pushers push. */
    public void feed(boolean on) {
        feeders(on, 0);
    }

    /** The feeders t seconds into a volley: rollers run and gates stay open while feeding${pushers.length?'; a pusher pushes for\n     *  PUSH_SECONDS at the start of every FEED_CYCLE_SECONDS and is back at rest in between, so the next piece can drop in':''}. */
    private void feeders(boolean feeding, double t) {${pushers.length?`
        boolean push = feeding && t % FEED_CYCLE_SECONDS < PUSH_SECONDS;`:''}
${feedLines.join('\n')}
    }

    /** One call of "Shoot N" (count 0: every storage slot). Returns true once all N shots have had time. */
    public boolean shoot(int count, RouteActions.Step step) {${shooter?`
        int want = count > 0 ? count : STORAGE;
        if (step.first) { feedStart = -1; shot = false; }
        if (shot) return true;
        spin(true);
        aim(step.pose, step.cell);
        double now = clock.seconds();
        // Start once spun up and on target, and pieces from the last intake have moved up.
        if (feedStart < 0 && ready() && aimed() && now - lastIntake >= TRANSFER_SECONDS + KICKER_UP_SECONDS) feedStart = now;
        // Shooting for a set time keeps feeding until the route's last call; otherwise long enough for N shots.
        double window = step.duration > 0 ? Double.MAX_VALUE : (want - 1) * FEED_CYCLE_SECONDS + LAST_SHOT_SECONDS;
        boolean feeding = feedStart >= 0 && now - feedStart < window;
        feeders(feeding && !step.last, feedStart >= 0 ? now - feedStart : 0);
        if (feedStart >= 0 && !feeding) shot = true;
        boolean done = shot || step.last;
        if (done) { feeders(false, 0); spin(false); }
        return done;`:`
        return true;`}
    }

    /** Measured flywheel speeds in encoder ticks per second, in the order of flywheels(). */
    public double[] flywheelSpeeds() {
        return new double[] ${list(flywheels.map(x=>`${x.field}.getVelocity()`))};
    }

    /** The flywheel motors and their names, for the mechanism check. */
    public DcMotorEx[] flywheels() {
        return new DcMotorEx[] ${list(flywheels.map(x=>x.field))};
    }

    public static final String[] FLYWHEEL_NAMES = ${list(flywheels.map(x=>x.constant))};

    /** Every servo (kickers, ramps, servo feeders, servo turrets) and its name, for finding positions with the mechanism check. */
    public Servo[] servos() {
        return new Servo[] ${list(servos.map(x=>x.field))};
    }

    public static final String[] SERVO_NAMES = ${list(servos.map(x=>x.constant))};

    public void stop() {
        intake(false);
        feeders(false, 0);
        spin(false);
${[...motorTurrets,...crTurrets.map(({x})=>x)].map(x=>`        ${x.field}.setPower(0);`).join('\n')}
    }
}
`.replace(/\n\n\n+/g,'\n\n');
  }
  // The check TeleOp: a guided check of every device the autonomous uses, one at a time. Each step turns a device or
  // moves a servo and asks on gamepad 1 what happened; the answers become Deck settings, listed on the "Deck results"
  // telemetry line (CHECK_RESULTS reads them back). Deck's Send to robot can run it and press the buttons; on any Driver
  // Station a gamepad answers. mechType is Mechanisms, or Outer.Mechanisms for the single OnBot Java file.
  const DRIVE_LABELS={frontLeft:'front left wheel',frontRight:'front right wheel',backLeft:'back left wheel',backRight:'back right wheel',left:'left wheels',right:'right wheels'};
  // The setting a device's direction answer sets, by the field that holds its name.
  const REVERSED_FIELD={motor:'reversed',motor2:'reversed2',indexer:'indexerReversed',turretMotor:'turretReversed'};
  function checkOpMode(options,h,m,mechType='Mechanisms'){
    // h is null for a drivetrain Deck exports no drive code for (a Pedro swerve robot): the check then has no drive or IMU steps.
    const name=options.checkName,motors=h?.drive?Object.entries(h.drive.motors):[],velocity=!!m&&m.shooter.control!=='power',d=m?mechanismDevices(m):[],M=mechType;
    const of=role=>d.filter(x=>x.role===role),say=javaString,steps=[],gets=[];
    const key=x=>`${x.setting.list}.${x.setting.index}.${REVERSED_FIELD[x.setting.field]}`,named=x=>`${x.label.toLowerCase()} ("${x.name}")`;
    const step=(title,body)=>steps.push(`        next(${say(title)});\n${body}`);
    if(h){
      gets.push(`        IMU imu = hardwareMap.tryGet(IMU.class, ${say(h.imu)});`,`        if (imu != null) imu.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(RevHubOrientationOnRobot.LogoFacingDirection.${h.hub.logo}, RevHubOrientationOnRobot.UsbFacingDirection.${h.hub.usb})));`);
      step(`IMU ("${h.imu}")`,`        if (imu == null) result("imu", "?missing");
        else {
            YawPitchRollAngles level = imu.getRobotYawPitchRollAngles();
            boolean tilted = Math.abs(level.getPitch(AngleUnit.DEGREES)) > 15 || Math.abs(level.getRoll(AngleUnit.DEGREES)) > 15;
            result("imu.level", tilted ? "?tilted" : "ok");
            double before = level.getYaw(AngleUnit.DEGREES);
            if (ask(String.format(Locale.US, "The IMU reads pitch %.0f and roll %.0f degrees%s. Turn the robot a quarter turn LEFT (counterclockwise, seen from above), then press A.", level.getPitch(AngleUnit.DEGREES), level.getRoll(AngleUnit.DEGREES), tilted ? ": tilted, so the Control Hub mounting in Deck is wrong" : ""), "A: turned it | B: skip") == YES) {
                double turned = AngleUnit.normalizeDegrees(imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES) - before);
                result("imu.turn", turned > 45 ? "ok" : turned < -45 ? "?backward" : "?none");
            }
        }`);
      gets.push(`        DcMotorEx[] drive = new DcMotorEx[DRIVE.length];`,`        for (int i = 0; i < DRIVE.length; i++) {`,`            drive[i] = hardwareMap.tryGet(DcMotorEx.class, DRIVE[i]);`,
        `            if (drive[i] != null) { drive[i].setDirection(direction(DRIVE_REVERSED[i])); drive[i].setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER); }`,`        }`);
      motors.forEach(([k,x],i)=>step(`${DRIVE_LABELS[k]} ("${x.name}")`,`        if (drive[${i}] == null) result("robot.${k}.reversed", "?missing");
        else {
            int answer = turn(drive[${i}], 0.3, TURN_SECONDS, ${say(`Did the ${DRIVE_LABELS[k]} turn so the robot would drive FORWARD?`)});
            direction("robot.${k}.reversed", DRIVE_REVERSED[${i}], answer);
            // The odometry steps turn the robot with its wheels, so a wheel found backward is turned the right way now.
            if (answer == NO) drive[${i}].setDirection(direction(!DRIVE_REVERSED[${i}]));
        }`));
    }
    // A device by its Mechanisms constant, with the direction the code sets for it.
    const device=(x,type,setup='')=>{gets.push(`        ${type} ${x.field} = hardwareMap.tryGet(${type}.class, ${M}.${x.constant});`,...(setup?[`        if (${x.field} != null) ${setup}`]:[]));};
    for(const x of of('roller')){device(x,'DcMotorSimple',`${x.field}.setDirection(direction(${M}.${x.constant}_REVERSED));`);
      step(named(x),`        if (${x.field} == null) result("${key(x)}", "?missing");
        else direction("${key(x)}", ${M}.${x.constant}_REVERSED, turn(${x.field}, ${M}.${x.constant}_POWER, TURN_SECONDS, ${say(`Did the ${x.label.toLowerCase()} pull pieces IN?`)}));`);}
    for(const x of d.filter(x=>x.role==='kicker'||x.role==='ramp')){device(x,'Servo');const at=`intakes.${x.index}`;
      step(named(x),`        if (${x.field} == null) result("${at}.downPos", "?missing");
        else {
            double down = position(${x.field}, ${M}.${x.constant}_DOWN, ${say(`Move the ${x.role} DOWN, to where it ${x.role==='kicker'?'scoops pieces in':'picks pieces up'}.`)});
            if (!Double.isNaN(down)) result("${at}.downPos", number(down));
            double up = position(${x.field}, ${M}.${x.constant}_UP, ${say(`Now move it UP, to where it waits while the robot drives.`)});
            if (!Double.isNaN(up)) result("${at}.upPos", number(up));
        }`);}
    const flywheels=of('flywheel');
    for(const x of flywheels){device(x,'DcMotorEx',`${x.field}.setDirection(direction(${M}.${x.constant}_REVERSED));`);
      step(named(x),`        if (${x.field} == null) result("${key(x)}", "?missing");
        else {
            ${x.field}.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER);
            int answer = turn(${x.field}, 0.3, TURN_SECONDS, ${say(`Did the ${x.label.toLowerCase()} spin ${x.setting.field==='motor2'?'the flywheel ':''}the way that shoots pieces OUT?`)});
            direction("${key(x)}", ${M}.${x.constant}_REVERSED, answer);
            // The top speed is measured with every motor turning the flywheel the right way.
            if (answer == NO) ${x.field}.setDirection(direction(!${M}.${x.constant}_REVERSED));
        }`);}
    if(velocity&&flywheels.length)step('flywheel top speed',`        if (ask("Next the flywheels run at full power for 3 s, to measure their top speed. Stand clear of the shooter.", "A: run them | B: skip") == YES) {
            double top = topSpeed(new DcMotorEx[] {${flywheels.map(x=>x.field).join(', ')}});
            if (top <= 0) result("shooter.topSpeed", "?none");
            else {
                // REV's velocity PIDF from the top speed: F = 32767 / top, P = 0.1 F, I = 0.1 P, D = 0.
                double f = 32767 / top, p = 0.1 * f, i = 0.1 * p;
                result("shooter.topSpeed", String.format(Locale.US, "%.0f", top));
                result("shooter.pidf", String.format(Locale.US, "%.4f,%.4f,0,%.4f", p, i, f));
                if (top < 0.98 * ${M}.FLYWHEEL_TICKS_PER_SECOND) result("shooter.rpm", "?high");
            }
        }`);
    for(const x of of('feeder')){const at=`shooters.${x.index}`;
      if(x.feeder==='pusher'||x.feeder==='gate'){device(x,'Servo');step(named(x),`        if (${x.field} == null) result("${at}.restPos", "?missing");
        else {
            double rest = position(${x.field}, ${M}.${x.constant}_REST, ${say(x.feeder==='pusher'?'Move the pusher to REST, back where the next piece can drop in front of it.':'Move the gate to REST: closed, holding the pieces back.')});
            if (!Double.isNaN(rest)) result("${at}.restPos", number(rest));
            double feed = position(${x.field}, ${M}.${x.constant}_FEED, ${say(x.feeder==='pusher'?'Now move it to FEED, where it has pushed a piece into the flywheel.':'Now move it to FEED: open, letting pieces through to the flywheel.')});
            if (!Double.isNaN(feed)) result("${at}.feedPos", number(feed));
        }`);}
      else{device(x,'DcMotorSimple',`${x.field}.setDirection(direction(${M}.${x.constant}_REVERSED));`);step(named(x),`        if (${x.field} == null) result("${key(x)}", "?missing");
        else direction("${key(x)}", ${M}.${x.constant}_REVERSED, turn(${x.field}, ${M}.FEEDER_POWER, TURN_SECONDS, ${say(`Did the ${x.label.toLowerCase()} move pieces toward the flywheel?`)}));`);}}
    of('turret').forEach((x,i)=>{
      if(x.device==='crservo'){device(x,'DcMotorSimple');step(named(x),`        if (${x.field} == null) result("${key(x)}", "?missing");
        else direction("${key(x)}", ${M}.${x.constant}_REVERSED, turn(${x.field}, ${M}.${x.constant}_REVERSED ? -0.3 : 0.3, TURN_SECONDS, ${say('Did the turret turn LEFT (counterclockwise, seen from above)?')}));`);return;}
      if(x.device==='servo'){device(x,'Servo');step(named(x),`        if (${x.field} == null) result("${key(x)}", "?missing");
        else {
            double center = position(${x.field}, ${M}.TURRET_SERVO_CENTER, "Point the turret straight ahead, toward the front of the robot.");${i?'':`
            if (!Double.isNaN(center)) result("turret.servoCenter", number(center));`}
            double from = Double.isNaN(center) ? ${M}.TURRET_SERVO_CENTER : center;
            double left = position(${x.field}, clamp(from + (${M}.${x.constant}_REVERSED ? -90 : 90) / ${M}.TURRET_SERVO_DEGREES), "Now point it a quarter turn LEFT (90 degrees counterclockwise, seen from above).");
            if (!Double.isNaN(left) && Math.abs(left - from) > 0.005) {
                result("${key(x)}", String.valueOf(left < from));${i?'':`
                result("turret.servoDegrees", String.format(Locale.US, "%.1f", 90 / Math.abs(left - from)));`}
            }
            ${x.field}.setPosition(from);
        }`);return;}
      device(x,'DcMotorEx');
      step(named(x),`        if (${x.field} == null) result("${key(x)}", "?missing");
        else {
            ${x.field}.setDirection(direction(${M}.${x.constant}_REVERSED));
            ${x.field}.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
            int answer = turnTo(${x.field}, 20 * ${M}.TURRET_TICKS_PER_DEGREE, "Did the turret turn LEFT (counterclockwise, seen from above)?");
            direction("${key(x)}", ${M}.${x.constant}_REVERSED, answer);
            // The rest of the check turns it the right way.
            if (answer == NO) ${x.field}.setDirection(direction(!${M}.${x.constant}_REVERSED));${i?'':`
            if (answer == YES || answer == NO) {
                double ahead = aim(${x.field}, "Point the turret straight ahead, toward the front of the robot.");
                double left = Double.isNaN(ahead) ? Double.NaN : aim(${x.field}, "Now point it a quarter turn LEFT (90 degrees counterclockwise, seen from above).");
                if (!Double.isNaN(left) && Math.abs(left - ahead) > 9) result("turret.ticksPerDegree", String.format(Locale.US, "%.3f", Math.abs(left - ahead) / 90));
                if (!Double.isNaN(ahead)) turnTo(${x.field}, ahead, "");
            }`}
            ${x.field}.setPower(0);
        }`);});
    // ---- Odometry, last, with the robot on the floor: two pushes by hand find which way the pods count (and a measured
    // 48 in push their pod type or the OTOS's linear scalar), and one turn on the spot finds where they sit.
    const loc=h?.localization,odo=['fused','optical','odometry','odometry3'].includes(loc)&&motors.length?loc:null,helpers=[],consts=[];
    const floor='Put the robot on the floor with room around it. Push it straight FORWARD by hand, exactly 48 inches (two field tiles) if you can measure it, then press A.';
    const leftPush='Now push it straight to its LEFT by hand, about 24 inches (one tile), then press A.',spinAsk='Next the robot turns on the spot by itself, one full turn counterclockwise, to find where the odometry sits. Keep clear of it.';
    if(odo){
      consts.push(`    /** Which drive motors are on the left (they turn backward to spin the robot counterclockwise). */`,`    private static final boolean[] DRIVE_LEFT = {${motors.map(([k])=>String(/left/i.test(k))).join(', ')}};`,
        '    private static final double SPIN_POWER = 0.3;','    private static final String PUSHED = "A: pushed it 48 in | X: pushed it another distance | B: skip";');
      helpers.push(`
    /** The drive turning the robot on the spot: left wheels backward, right wheels forward (counterclockwise). */
    private static void spin(DcMotorEx[] drive, double power) {
        for (int i = 0; i < drive.length; i++) if (drive[i] != null) drive[i].setPower(DRIVE_LEFT[i] ? -power : power);
    }`);
    }
    // One turn on the spot. Each loop adds the turn (radians, from heading) and every reading's change; sums[0] is the
    // turn so far, sums[1] the sum of squared turns and sums[2 + i] each reading's change times the turn, so reading i
    // changes sums[2 + i] / sums[1] per radian. extra: Java run every loop with the turn d (radians) and the change of
    // each reading in delta[].
    const spinLoop=(read,heading,extra='')=>`        double[] last = ${read}, sums = new double[2 + last.length];
        double heading = ${heading};
        ElapsedTime time = new ElapsedTime(), coast = new ElapsedTime();
        boolean braking = false;
        spin(drive, SPIN_POWER);
        while (opModeIsActive() && time.seconds() < 15 && !(braking && coast.seconds() > 1)) {
            if (!braking && Math.abs(sums[0]) >= 2 * Math.PI) { spin(drive, 0); braking = true; coast.reset(); }
            double[] now = ${read};
            double h = ${heading}, d = AngleUnit.normalizeRadians(h - heading);
            double[] delta = new double[now.length];
            for (int i = 0; i < now.length; i++) { delta[i] = now[i] - last[i]; sums[2 + i] += d * delta[i]; }
            sums[0] += d; sums[1] += d * d;${extra}
            heading = h; last = now;
            show(String.format(Locale.US, "Turning on the spot: %.0f of 360 degrees.", Math.toDegrees(Math.abs(sums[0]))), "");
        }
        spin(drive, 0);`;
    if(odo==='fused'){const pp=h.pinpointMount,ENUM={'4bar':'goBILDA_4_BAR_POD',swingarm:'goBILDA_SWINGARM_POD'};
      gets.push(`        GoBildaPinpointDriver pinpoint = hardwareMap.tryGet(GoBildaPinpointDriver.class, ${say(h.pinpoint)});`,
        '        // Measured with both pods counting forward: what the check sees is how the pods are mounted.',
        `        if (pinpoint != null) { pinpoint.setEncoderDirections(GoBildaPinpointDriver.EncoderDirection.FORWARD, GoBildaPinpointDriver.EncoderDirection.FORWARD); pinpoint.setEncoderResolution(GoBildaPinpointDriver.GoBildaOdometryPods.${ENUM[pp.pods]}); pinpoint.resetPosAndIMU(); }`);
      consts.push(`    /** The Pinpoint's pods as set up in Deck (${pp.pods==='swingarm'?'goBILDA swingarm':'goBILDA 4-bar'} pods), and their directions until the pushes measure them. */`,
        `    private static final double PINPOINT_TICKS_PER_MM = ${pp.ticksPerMm}, PINPOINT_TICKS_PER_INCH = PINPOINT_TICKS_PER_MM * 25.4;`,`    private static final boolean PINPOINT_X_REVERSED = ${!!pp.xReversed}, PINPOINT_Y_REVERSED = ${!!pp.yReversed};`);
      helpers.push(`
    private static double[] counts(GoBildaPinpointDriver pinpoint) {
        pinpoint.update();
        return new double[] {pinpoint.getEncoderX(), pinpoint.getEncoderY()};
    }

    /** The pod type that reads a 48 in push as 48 in, and its ticks per inch (the setting's when neither type does). */
    private double podType(double inches) {
        double pods = inches / 48 * PINPOINT_TICKS_PER_MM;
        if (Math.abs(pods / 19.894367218017578 - 1) < 0.08) { result("pinpoint.pods", "4bar"); return 19.894367218017578 * 25.4; }
        if (Math.abs(pods / 13.262911796569824 - 1) < 0.08) { result("pinpoint.pods", "swingarm"); return 13.262911796569824 * 25.4; }
        result("pinpoint.distance", "?" + Math.round(inches));
        return PINPOINT_TICKS_PER_INCH;
    }`);
      step(`Pinpoint ("${h.pinpoint}")`,`        if (pinpoint == null) result("pinpoint", "?missing");
        else {
            int signX = PINPOINT_X_REVERSED ? -1 : 1, signY = PINPOINT_Y_REVERSED ? -1 : 1;
            double tpi = PINPOINT_TICKS_PER_INCH;
            double[] from = counts(pinpoint);
            int pushed = ask(${say(floor)}, PUSHED);
            double[] to = counts(pinpoint);
            double fx = (to[0] - from[0]) / tpi, fy = (to[1] - from[1]) / tpi;
            if (pushed == YES || pushed == NOTHING) {
                if (Math.abs(fx) < 2 && Math.abs(fy) >= 2) result("pinpoint.pods", "?swapped");
                else if (Math.abs(fx) < 2) result("pinpoint.xReversed", "?none");
                else {
                    signX = fx > 0 ? 1 : -1;
                    result("pinpoint.xReversed", String.valueOf(fx < 0));
                    if (pushed == YES) tpi = podType(Math.abs(fx));
                }
            }
            from = counts(pinpoint);
            pushed = ask(${say(leftPush)}, "A: pushed it | B: skip");
            to = counts(pinpoint);
            fy = (to[1] - from[1]) / tpi;
            if (pushed == YES) {
                if (Math.abs(fy) < 2) result("pinpoint.yReversed", "?none");
                else { signY = fy > 0 ? 1 : -1; result("pinpoint.yReversed", String.valueOf(fy < 0)); }
            }
            if (ask(${say(spinAsk)}, "A: turn it | B: skip") == YES) {
${spinLoop('counts(pinpoint)','pinpoint.getHeading(AngleUnit.RADIANS)').replace(/^/gm,'        ')}
                if (Math.abs(sums[0]) < Math.PI) result("pinpoint.xOffset", "?none");
                else {
                    // A pod counts the turn times how far it sits from the centre, across its direction of travel.
                    result("pinpoint.xOffset", number(-sums[2] / sums[1] / (signX * tpi)));
                    result("pinpoint.yOffset", number(sums[3] / sums[1] / (signY * tpi)));
                }
            }
        }`);}
    if(odo==='odometry'||odo==='odometry3'){const pods=h.pods;
      gets.push(`        DcMotorEx[] pods = new DcMotorEx[POD_NAMES.length];`,`        for (int i = 0; i < pods.length; i++) pods[i] = hardwareMap.tryGet(DcMotorEx.class, POD_NAMES[i]);`);
      consts.push('    /** The odometry pods, which are forward pods (the others measure sideways), and their directions as set up in Deck. */',
        `    private static final String[] POD_NAMES = ${names(pods.map(p=>p.name))}, POD_KEYS = ${names(pods.map(p=>p.key))};`,
        `    private static final boolean[] POD_FORWARD = {${pods.map(p=>String(p.axis==='forward')).join(', ')}}, POD_REVERSED = {${pods.map(p=>String(!!p.reversed)).join(', ')}};`,`    private static final double POD_TICKS_PER_INCH = ${n(pods[0].ticksPerInch)};`);
      helpers.push(`
    private static double[] counts(DcMotorEx[] pods) {
        double[] c = new double[pods.length];
        for (int i = 0; i < pods.length; i++) c[i] = pods[i] == null ? 0 : pods[i].getCurrentPosition();
        return c;
    }`);
      step('odometry pods',`        boolean missing = false;
        for (int i = 0; i < pods.length; i++) if (pods[i] == null) { result("pods." + POD_KEYS[i] + ".reversed", "?missing"); missing = true; }
        if (!missing && imu != null) {
            int[] sign = new int[pods.length];
            for (int i = 0; i < pods.length; i++) sign[i] = POD_REVERSED[i] ? -1 : 1;
            double[] from = counts(pods);
            int pushed = ask(${say(floor)}, PUSHED);
            double[] to = counts(pods);
            if (pushed == YES || pushed == NOTHING) {
                double travel = 0;
                for (int i = 0; i < pods.length; i++) {
                    if (!POD_FORWARD[i]) continue;
                    double inches = (to[i] - from[i]) / POD_TICKS_PER_INCH;
                    if (Math.abs(inches) < 2) { result("pods." + POD_KEYS[i] + ".reversed", "?none"); continue; }
                    sign[i] = inches > 0 ? 1 : -1;
                    result("pods." + POD_KEYS[i] + ".reversed", String.valueOf(inches < 0));
                    travel = Math.max(travel, Math.abs(inches));
                }
                if (pushed == YES && travel > 0 && Math.abs(travel / 48 - 1) > 0.08) result("pods.distance", "?" + Math.round(travel));
            }
            from = counts(pods);
            pushed = ask(${say(leftPush)}, "A: pushed it | B: skip");
            to = counts(pods);
            if (pushed == YES) for (int i = 0; i < pods.length; i++) {
                if (POD_FORWARD[i]) continue;
                double inches = (to[i] - from[i]) / POD_TICKS_PER_INCH;
                if (Math.abs(inches) < 2) result("pods." + POD_KEYS[i] + ".reversed", "?none");
                else { sign[i] = inches > 0 ? 1 : -1; result("pods." + POD_KEYS[i] + ".reversed", String.valueOf(inches < 0)); }
            }
            if (ask(${say(spinAsk)}, "A: turn it | B: skip") == YES) {
${spinLoop('counts(pods)','imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.RADIANS)').replace(/^/gm,'        ')}
                if (Math.abs(sums[0]) >= Math.PI) for (int i = 0; i < pods.length; i++) {
                    // A forward pod counts minus the turn times how far left it sits; a sideways pod plus how far forward.
                    double perRadian = sums[2 + i] / sums[1] / (sign[i] * POD_TICKS_PER_INCH);
                    result("pods." + POD_KEYS[i] + (POD_FORWARD[i] ? ".y" : ".x"), number(POD_FORWARD[i] ? -perRadian : perRadian));
                }
                else result("pods.turn", "?none");
            }
        }`);}
    if(odo==='optical'){
      gets.push(`        SparkFunOTOS otos = hardwareMap.tryGet(SparkFunOTOS.class, ${say(h.otos)});`,
        '        // Measured with no offset and no scalars: what the check sees is how the chip is mounted.',
        '        if (otos != null) { otos.setLinearUnit(DistanceUnit.INCH); otos.setAngularUnit(AngleUnit.RADIANS); otos.setOffset(new SparkFunOTOS.Pose2D(0, 0, 0)); otos.setLinearScalar(1.0); otos.setAngularScalar(1.0); otos.calibrateImu(); otos.resetTracking(); }');
      consts.push(`    /** Where the OTOS's X axis points as set up in Deck, until the push measures it (degrees counterclockwise from the robot's front). */`,`    private static final double OTOS_HEADING = ${n(h.otosMount.heading)};`);
      helpers.push(`
    private static double[] reading(SparkFunOTOS otos) {
        SparkFunOTOS.Pose2D p = otos.getPosition();
        return new double[] {p.x, p.y};
    }

    /** Which way the OTOS moved, in its own axes at the heading it had, in radians. */
    private static double bearing(double[] from, double[] to, double heading) {
        double dx = to[0] - from[0], dy = to[1] - from[1];
        return Math.atan2(-dx * Math.sin(heading) + dy * Math.cos(heading), dx * Math.cos(heading) + dy * Math.sin(heading));
    }`);
      step(`OTOS ("${h.otos}")`,`        if (otos == null) result("otos", "?missing");
        else {
            double mounted = Math.toRadians(OTOS_HEADING), forward = Double.NaN, linear = 1;
            double[] from = reading(otos);
            double start = otos.getPosition().h;
            int pushed = ask(${say(floor)}, PUSHED);
            double[] to = reading(otos);
            double moved = Math.hypot(to[0] - from[0], to[1] - from[1]);
            if (pushed == YES || pushed == NOTHING) {
                if (moved < 2) result("otos.heading", "?none");
                else {
                    // With no offset the OTOS reports its own motion, in its own axes: the robot's front is minus where it moved.
                    forward = bearing(from, to, start);
                    mounted = -forward;
                    result("otos.heading", String.format(Locale.US, "%.1f", Math.toDegrees(mounted)));
                    if (pushed == YES) {
                        double scalar = 48 / moved;
                        boolean fits = scalar >= SparkFunOTOS.MIN_SCALAR && scalar <= SparkFunOTOS.MAX_SCALAR;
                        if (fits) linear = scalar;
                        result("otos.linearScalar", fits ? String.format(Locale.US, "%.4f", scalar) : "?" + Math.round(moved));
                    }
                }
            }
            from = reading(otos);
            start = otos.getPosition().h;
            pushed = ask(${say(leftPush)}, "A: pushed it | B: skip");
            to = reading(otos);
            if (pushed == YES && !Double.isNaN(forward) && Math.hypot(to[0] - from[0], to[1] - from[1]) >= 2) {
                // Its left is a quarter turn counterclockwise from its front, unless it sees the floor mirrored.
                double left = AngleUnit.normalizeRadians(bearing(from, to, start) - forward);
                if (left < 0) result("otos.mirror", "?mirrored");
            }
            if (ask(${say(spinAsk)}, "A: turn it | B: skip") == YES) {
                double imuStart = imu == null ? Double.NaN : imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.RADIANS), imuTurn = 0, imuLast = imuStart, rx = 0, ry = 0;
${spinLoop('reading(otos)','otos.getPosition().h',`
                double mid = heading + d / 2;
                // The move in the OTOS's own axes at that heading.
                rx += d * (delta[0] * Math.cos(mid) + delta[1] * Math.sin(mid));
                ry += d * (-delta[0] * Math.sin(mid) + delta[1] * Math.cos(mid));
                if (imu != null) { double y = imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.RADIANS); imuTurn += AngleUnit.normalizeRadians(y - imuLast); imuLast = y; }`).replace(/^/gm,'        ')}
                if (Math.abs(sums[0]) < Math.PI) result("otos.x", "?none");
                else {
                    // The hub's IMU measures the turn the OTOS should have seen: their ratio is its angular scalar.
                    double angular = 1;
                    if (imu != null && Math.abs(imuTurn) > Math.PI) {
                        double scalar = imuTurn / sums[0];
                        if (scalar >= SparkFunOTOS.MIN_SCALAR && scalar <= SparkFunOTOS.MAX_SCALAR) { angular = scalar; result("otos.angularScalar", String.format(Locale.US, "%.4f", scalar)); }
                    }
                    // Turning moves the chip around the robot's centre: back in the robot's frame (its distances and turn
                    // corrected by the scalars), that is where it sits.
                    double sx = rx / sums[1] * linear / angular, sy = ry / sums[1] * linear / angular, c = Math.cos(mounted), s = Math.sin(mounted);
                    result("otos.x", number(s * sx + c * sy));
                    result("otos.y", number(-(c * sx - s * sy)));
                }
            }
        }`);}
    const stops=[...motors.length?['        for (DcMotorEx motor : drive) if (motor != null) motor.setPower(0);']:[],...d.filter(x=>x.device!=='servo').map(x=>`        if (${x.field} != null) ${x.field}.setPower(0);`)];
    return `package ${options.packageName};

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DcMotorSimple;${h?`
import com.qualcomm.hardware.rev.RevHubOrientationOnRobot;
import com.qualcomm.robotcore.hardware.IMU;`:''}${odo==='fused'?`
import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;`:odo==='optical'?`
import com.qualcomm.hardware.sparkfun.SparkFunOTOS;`:''}
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.util.ElapsedTime;
import java.util.Locale;${h?`
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;${odo==='optical'?`
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;`:''}
import org.firstinspires.ftc.robotcore.external.navigation.YawPitchRollAngles;`:''}

/**
 * A guided check of the hardware the "${comment(options.layoutName||'route')}" autonomous uses, generated by Torque
 * with it. Run it before the autonomous, with the robot on blocks: the wheels and mechanisms move.${odo?`
 * The last steps check the odometry with the robot on the floor: two pushes by hand, then one turn on the spot.`:''}
 *
 * Each step turns one device or moves one servo, then asks on the Driver Station. Answer on gamepad 1:
 *  - a device that turned: A yes, B no (it turned the other way), X nothing moved, Y run it again;
 *  - a servo: the D-pad moves it (up and down a little, right and left more), A saves where it is, B keeps the setting.
 * The answers are Deck settings, listed on the "Deck results" line. Deck applies them when it runs this check
 * (Send to robot, Guided check); otherwise enter them in Deck. Then export (or send) again.${m?`
 * After the last step: right bumper runs the intake, left trigger the flywheels, right trigger the feeders.`:''}
 */
@TeleOp(name = ${javaString((options.layoutName||'Planned route')+' check (Deck)')}, group = "Torque")
public class ${name} extends LinearOpMode {
    /** The drive motors, and which are reversed (as the autonomous sets them). */
    private static final String[] DRIVE = ${names(motors.map(([,x])=>x.name))};
    private static final boolean[] DRIVE_REVERSED = {${motors.map(([,x])=>String(x.mount<0)).join(', ')}};
    private static final int STEPS = ${steps.length};
    private static final double TURN_SECONDS = 1.5;
    private static final int STOPPED = 0, YES = 1, NO = 2, NOTHING = 3, AGAIN = 4;
    private static final String TURNED = "A: yes | B: no, the other way | X: nothing moved | Y: again";
${consts.length?consts.join('\n')+'\n':''}    /** The answers as Deck settings: "v1", then key=value for each (a value starting with ? is a problem). */
    private final StringBuilder results = new StringBuilder("v1");
    private int step;
    private String title = "";

    @Override
    public void runOpMode() {
${gets.join('\n')}
        show("Deck's guided check: " + STEPS + " steps. Put the robot on blocks with its wheels off the floor, then press START.", "");
        waitForStart();
${steps.join('\n')}
${stops.join('\n')}
        // Done: the results stay on the screen, and the mechanisms can be tried with the settings in the code.
        title = "Done";${m?`
        ${M} mech = new ${M}();
        try {
            mech.init(hardwareMap);
        } catch (IllegalArgumentException e) {
            mech = null;
        }
        boolean intaking = false, spinning = false, feeding = false;`:''}
        while (opModeIsActive()) {${m?`
            if (mech != null) {
                if (gamepad1.right_bumper != intaking) { intaking = gamepad1.right_bumper; mech.intake(intaking); }
                boolean spin = gamepad1.left_trigger > 0.5, feed = gamepad1.right_trigger > 0.5;
                if (spin != spinning) { spinning = spin; mech.spin(spinning); }
                if (feed != feeding) { feeding = feed; mech.feed(feeding); }
            }`:''}
            telemetry.addData("Step", "Done");
            telemetry.addLine("Every step is done. Send to robot again from Deck to use the results.${m?' To try the mechanisms with the settings in this code: right bumper intake, left trigger flywheels, right trigger feeders.':''}");
            telemetry.addData("Deck results", results.toString());
            telemetry.update();
        }${m?`
        if (mech != null) mech.stop();`:''}
    }

    private static DcMotorSimple.Direction direction(boolean reversed) {
        return reversed ? DcMotorSimple.Direction.REVERSE : DcMotorSimple.Direction.FORWARD;
    }

    private static double clamp(double position) {
        return Math.max(0, Math.min(1, position));
    }

    private static String number(double value) {
        return String.format(Locale.US, "%.3f", value);
    }

    private void next(String what) {
        step++;
        title = what;
    }

    private void result(String key, String value) {
        results.append(' ').append(key).append('=').append(value);
    }

    /** The screen: the step, what to do, the answers on gamepad 1 and the results so far. */
    private void show(String what, String answers) {
        telemetry.addData("Step", step == 0 ? "Ready" : String.format(Locale.US, "%d of %d: %s", step, STEPS, title));
        telemetry.addLine(what);
        if (!answers.isEmpty()) telemetry.addData("Answer", answers);
        telemetry.addData("Deck results", results.toString());
        telemetry.update();
    }

    private boolean pressed() {
        return gamepad1.a || gamepad1.b || gamepad1.x || gamepad1.y || gamepad1.dpad_up || gamepad1.dpad_down || gamepad1.dpad_left || gamepad1.dpad_right;
    }

    private void release(String what, String answers) {
        while (opModeIsActive() && pressed()) show(what, answers);
    }

    /** Waits for A, B, X or Y, pressed and let go. STOPPED when the op mode is stopped first. */
    private int ask(String what, String answers) {
        release(what, answers);
        while (opModeIsActive()) {
            int answer = gamepad1.a ? YES : gamepad1.b ? NO : gamepad1.x ? NOTHING : gamepad1.y ? AGAIN : STOPPED;
            show(what, answers);
            if (answer != STOPPED) {
                release(what, answers);
                return answer;
            }
        }
        return STOPPED;
    }

    /** Runs a motor or continuous servo at a power for some seconds, then asks; Y runs it again. */
    private int turn(DcMotorSimple device, double power, double seconds, String question) {
        for (;;) {
            ElapsedTime time = new ElapsedTime();
            device.setPower(power);
            while (opModeIsActive() && time.seconds() < seconds) show("Watch it: it turns now.", "");
            device.setPower(0);
            int answer = ask(question, TURNED);
            if (answer != AGAIN) return answer;
        }
    }

    /** The "turns the other way" setting that makes a device turn as asked, from the answer. */
    private void direction(String key, boolean reversed, int answer) {
        if (answer == YES) result(key, String.valueOf(reversed));
        else if (answer == NO) result(key, String.valueOf(!reversed));
        else if (answer == NOTHING) result(key, "?none");
    }

    /** Moves a servo with the D-pad, starting from its setting. Returns where A saved it, or NaN for B (the setting stays). */
    private double position(Servo servo, double setting, String what) {
        double p = clamp(setting);
        servo.setPosition(p);
        String answers = "D-pad up/down: move | D-pad right/left: move more | A: save | B: keep " + number(setting);
        ElapsedTime held = new ElapsedTime();
        boolean holding = false;
        int repeats = 0;
        release(what, answers);
        while (opModeIsActive()) {
            double move = gamepad1.dpad_up ? 0.01 : gamepad1.dpad_down ? -0.01 : gamepad1.dpad_right ? 0.05 : gamepad1.dpad_left ? -0.05 : 0;
            // One step per press; held, it repeats after 0.4 s, every 0.1 s.
            if (move != 0 && (!holding || held.seconds() >= (repeats == 0 ? 0.4 : 0.1))) {
                repeats = holding ? repeats + 1 : 0;
                p = clamp(Math.round((p + move) * 1000) / 1000.0);
                servo.setPosition(p);
                held.reset();
            }
            holding = move != 0;
            if (gamepad1.a || gamepad1.b) {
                boolean save = gamepad1.a;
                release(what, answers);
                if (!save) servo.setPosition(clamp(setting));
                return save ? p : Double.NaN;
            }
            show(what + " Now at " + number(p) + ".", answers);
        }
        return Double.NaN;
    }
${flywheels.length&&velocity?`
    /** Every flywheel motor at full power without velocity control for 3 s: the highest speed seen, in ticks per second. */
    private double topSpeed(DcMotorEx[] motors) {
        for (DcMotorEx motor : motors) if (motor != null) { motor.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER); motor.setPower(1); }
        ElapsedTime time = new ElapsedTime();
        double top = 0;
        while (opModeIsActive() && time.seconds() < 3) {
            for (DcMotorEx motor : motors) if (motor != null) top = Math.max(top, Math.abs(motor.getVelocity()));
            show(String.format(Locale.US, "Full power: %.0f ticks/s so far.", top), "");
        }
        for (DcMotorEx motor : motors) if (motor != null) { motor.setPower(0); motor.setMode(DcMotor.RunMode.RUN_USING_ENCODER); }
        return top;
    }
`:''}${of('turret').some(x=>x.device==='motor')?`
    /** Turns a turret motor to an encoder position and, with a question, asks it (Y turns it there again). */
    private int turnTo(DcMotorEx motor, double ticks, String question) {
        for (;;) {
            motor.setTargetPosition((int) Math.round(ticks));
            motor.setMode(DcMotor.RunMode.RUN_TO_POSITION);
            motor.setPower(0.3);
            ElapsedTime time = new ElapsedTime();
            while (opModeIsActive() && time.seconds() < TURN_SECONDS) show(question.isEmpty() ? "Turning back." : "Watch it: it turns now.", "");
            if (question.isEmpty()) return STOPPED;
            int answer = ask(question, TURNED);
            motor.setTargetPosition(0);
            time.reset();
            while (opModeIsActive() && motor.isBusy() && time.seconds() < TURN_SECONDS) show("Turning back.", "");
            if (answer != AGAIN) return answer;
        }
    }

    /** Points a turret motor with the D-pad (left and right a degree, up and down ten). Returns its encoder position at A, or NaN for B. */
    private double aim(DcMotorEx motor, String what) {
        String answers = "D-pad left/right: turn 1 degree | D-pad up/down: turn 10 degrees | A: it points there | B: skip";
        double target = motor.getCurrentPosition();
        boolean holding = false;
        release(what, answers);
        while (opModeIsActive()) {
            double degrees = gamepad1.dpad_left ? 1 : gamepad1.dpad_right ? -1 : gamepad1.dpad_up ? 10 : gamepad1.dpad_down ? -10 : 0;
            if (degrees != 0 && !holding) {
                target += degrees * ${M}.TURRET_TICKS_PER_DEGREE;
                motor.setTargetPosition((int) Math.round(target));
                motor.setMode(DcMotor.RunMode.RUN_TO_POSITION);
                motor.setPower(0.3);
            }
            holding = degrees != 0;
            if (gamepad1.a || gamepad1.b) {
                boolean save = gamepad1.a;
                release(what, answers);
                return save ? motor.getCurrentPosition() : Double.NaN;
            }
            show(what, answers);
        }
        return Double.NaN;
    }
`:''}${helpers.join('\n')}${helpers.length?'\n':''}}
`.replace(/\n\n\n+/g,'\n\n');}
  // The guided check's "Deck results" line read back ("v1 key=value ..."; a value starting with ? is a problem), or
  // null when the text is not one.
  function checkResults(line){
    const text=String(line||'').trim().replace(/^Deck results\s*:\s*/,'');if(!/^v1(\s|$)/.test(text))return null;
    const values={};for(const item of text.split(/\s+/).slice(1)){const at=item.indexOf('=');if(at>0)values[item.slice(0,at)]=item.slice(at+1);}
    return values;
  }
  // The check's results applied to the setup the code was exported from: the robot settings (drive directions) and the
  // mechanisms (directions, servo positions, turret calibration, flywheel PIDF), with each change and each problem to fix
  // on the robot in plain words. Only values that differ count as changes. The caller sanitizes the returned settings.
  function applyCheck(values,{robot,mechanisms,localization}){
    const r=structuredClone(robot||{}),m=structuredClone(mechanisms||{}),changes=[],problems=[],devices={...(r.devices||{})};
    let h=null;try{h=hardware(robot,localization);}catch{}
    const d=m?.enabled?mechanismDevices(m,robot):[],cap=s=>s[0].toUpperCase()+s.slice(1),num=v=>+Number(v).toFixed(3);
    const deviceFor=(list,index,field)=>d.find(x=>x.setting.list===list&&x.setting.index===index&&(REVERSED_FIELD[x.setting.field]===field||x.setting.field===field));
    const POSITIONS={downPos:['servo','down'],upPos:['servo','up'],restPos:['indexer','rest'],feedPos:['indexer','feed']};
    const labelOf=key=>{let k;
      if((k=/^robot\.(\w+)\./.exec(key)))return cap(DRIVE_LABELS[k[1]]||k[1]);
      if((k=/^(intakes|shooters)\.(\d+)\.(\w+)$/.exec(key))){const x=deviceFor(k[1],+k[2],POSITIONS[k[3]]?.[0]||k[3]);return x?x.label:`${k[1]==='intakes'?'Intake':'Shooter'} ${+k[2]+1}`;}
      return {imu:'IMU','imu.level':'IMU','imu.turn':'IMU','shooter.topSpeed':'Flywheel','shooter.rpm':'Flywheel'}[key]||key;};
    const PROBLEMS={'imu.level':'reads the robot tilted: the Control Hub mounting in Deck (Setup → Robot controller) does not match the robot.',
      'imu.turn':{'?backward':'read the quarter turn left as a turn right: the Control Hub mounting in Deck (Setup → Robot controller) is wrong.','?none':'did not see the quarter turn. Check the IMU name and the Control Hub mounting.'},
      'shooter.topSpeed':'encoder read no speed at full power: check the flywheel motor\'s encoder cable.','shooter.rpm':'top speed is below the shooting speed: lower the shooter RPM in Mechanisms.'};
    // Odometry: the Pinpoint's pods, the OTOS's mounting and scalars, each pod's position and direction.
    const Cfg=globalThis.DeckSimConfig||require('./sim-config.js'),odo=Cfg.odometryOf(r),before=JSON.stringify(odo);
    const POD_LABELS={par:'Forward odometry pod',perp:'Sideways odometry pod',par_left:'Left odometry pod',par_right:'Right odometry pod'},inch=v=>`${num(v)} in`;
    const ODO_PROBLEMS={'pinpoint.pods:?swapped':'The Pinpoint\'s pods look swapped: its Y (strafe) pod counted when the robot went forward. Swap the two pod cables at the Pinpoint.',
      'pinpoint.xReversed:?none':'The Pinpoint\'s X (forward) pod did not count: check its cable, and that its wheel touches the floor.','pinpoint.yReversed:?none':'The Pinpoint\'s Y (strafe) pod did not count: check its cable, and that its wheel touches the floor.',
      'pinpoint.xOffset:?none':'The robot did not turn on the spot, so the Pinpoint\'s pod offsets were not measured: check the drive motors.','otos.heading:?none':'The OTOS did not see the robot move: check that it faces the floor, about 10 mm above it.',
      'otos.mirror:?mirrored':'The OTOS sees the floor mirrored, as if it were mounted upside down.','otos.x:?none':'The robot did not turn on the spot, so the OTOS\'s position was not measured: check the drive motors.',
      'pods.turn:?none':'The robot did not turn on the spot, so the pod positions were not measured: check the drive motors.'};
    const odoProblem=(key,value)=>{if(ODO_PROBLEMS[`${key}:${value}`])return ODO_PROBLEMS[`${key}:${value}`];const n=value.slice(1);
      if(key==='pinpoint.distance')return `The Pinpoint's pods read ${n} in for the 48 in push: check the pod type, and that the robot moved exactly 48 in.`;
      if(key==='otos.linearScalar')return `The OTOS read ${n} in for the 48 in push, more than its scalar can correct: check its height above the floor.`;
      if(key==='pods.distance')return `The pods read ${n} in for the 48 in push: check the pod wheel size (Deck assumes goBILDA 32 mm wheels, 2000 counts a turn).`;
      const p=/^pods\.(\w+)\./.exec(key);if(p&&value==='?none')return `${POD_LABELS[p[1]]||p[1]} did not count: check its cable, and that its wheel touches the floor.`;
      if(p&&value==='?missing')return `${POD_LABELS[p[1]]||p[1]} is not on the robot: its name is not in the robot configuration.`;
      if((key==='pinpoint'||key==='otos')&&value==='?missing')return `The ${key==='otos'?'OTOS':'Pinpoint'} is not on the robot: its name is not in the robot configuration, or it is another kind of device there.`;
      return null;};
    for(const [key,value] of Object.entries(values||{})){
      if(value.startsWith('?')){const own=PROBLEMS[key],text=typeof own==='string'?own:own?.[value],odoText=odoProblem(key,value);
        problems.push(odoText||`${labelOf(key)} ${text||(value==='?missing'?'is not on the robot: its name is not in the robot configuration, or it is another kind of device there.':'did not move. Check its cable and port, and that the robot configuration has it on that port.')}`);continue;}
      let k;const flag=value==='true'?true:value==='false'?false:null,n=Number(value);
      if((k=/^pinpoint\.(xReversed|yReversed)$/.exec(key))&&flag!==null){if(odo.pinpoint[k[1]]!==flag){odo.pinpoint[k[1]]=flag;changes.push(`Pinpoint ${k[1][0]==='x'?'X (forward)':'Y (strafe)'} pod: counts backward ${flag?'on':'off'}.`);}continue;}
      if(key==='pinpoint.pods'){if(Cfg.POD_TYPES[value]&&odo.pinpoint.pods!==value){changes.push(`Pinpoint pods: ${Cfg.POD_TYPES[odo.pinpoint.pods].name} → ${Cfg.POD_TYPES[value].name}.`);odo.pinpoint.pods=value;}continue;}
      if((k=/^pinpoint\.(xOffset|yOffset)$/.exec(key))&&Number.isFinite(n)&&Math.abs(n)<=36){if(Math.abs(odo.pinpoint[k[1]]-n)>.1){changes.push(k[1]==='xOffset'?`Pinpoint X (forward) pod: ${inch(odo.pinpoint.xOffset)} → ${inch(n)} left of centre.`:`Pinpoint Y (strafe) pod: ${inch(odo.pinpoint.yOffset)} → ${inch(n)} forward of centre.`);odo.pinpoint[k[1]]=num(n);}continue;}
      if((k=/^otos\.(heading|x|y|linearScalar|angularScalar)$/.exec(key))&&Number.isFinite(n)){const o=odo.otos,f=k[1];
        if(f==='heading'){const h=((((n+180)%360)+360)%360)-180,diff=Math.abs(((((h-o.heading)+180)%360)+360)%360-180);if(diff>.5){changes.push(`OTOS X axis: ${+o.heading.toFixed(1)}° → ${+h.toFixed(1)}° (counterclockwise from the robot's front).`);o.heading=+h.toFixed(1);}}
        else if(f==='x'||f==='y'){if(Math.abs(n)<=36&&Math.abs(o[f]-n)>.1){changes.push(`OTOS position: ${inch(o[f])} → ${inch(n)} ${f==='x'?'forward':'left'} of centre.`);o[f]=num(n);}}
        else if(n>=Cfg.OTOS_SCALARS[0]&&n<=Cfg.OTOS_SCALARS[1]&&Math.abs(o[f]-n)>.002){changes.push(`OTOS ${f==='linearScalar'?'linear':'angular'} scalar: ${+o[f].toFixed(4)} → ${+n.toFixed(4)}.`);o[f]=+n.toFixed(4);}
        continue;}
      if((k=/^pods\.(\w+)\.(reversed|x|y)$/.exec(key))&&odo.pods[k[1]]){const p=odo.pods[k[1]],label=POD_LABELS[k[1]]||k[1];
        if(k[2]==='reversed'){if(flag!==null&&p.reversed!==flag){p.reversed=flag;changes.push(`${label}: counts backward ${flag?'on':'off'}.`);}}
        else if(Number.isFinite(n)&&Math.abs(n)<=36&&Math.abs(p[k[2]]-n)>.1){changes.push(`${label}: ${inch(p[k[2]])} → ${inch(n)} ${k[2]==='x'?'forward':'left'} of centre.`);p[k[2]]=num(n);}
        continue;}
      if((k=/^robot\.(\w+)\.reversed$/.exec(key))&&h?.drive.motors[k[1]]&&flag!==null){
        if((h.drive.motors[k[1]].mount<0)!==flag){devices[k[1]]={...devices[k[1]],reversed:flag};changes.push(`${labelOf(key)}: turns the other way ${flag?'on':'off'}.`);}}
      // Only for a device the setup has: a position for its kicker, ramp or servo feeder, a direction for its motor or roller.
      else if((k=/^(intakes|shooters)\.(\d+)\.(\w+)$/.exec(key))){const part=m[k[1]]?.[+k[2]],x=deviceFor(k[1],+k[2],POSITIONS[k[3]]?.[0]||k[3]);if(!part||!x||POSITIONS[k[3]]&&x.device!=='servo')continue;
        if(Object.values(REVERSED_FIELD).includes(k[3])){if(flag!==null&&!!part[k[3]]!==flag){part[k[3]]=flag;changes.push(`${labelOf(key)}: turns the other way ${flag?'on':'off'}.`);}}
        else if(POSITIONS[k[3]]&&Number.isFinite(n)&&n>=0&&n<=1&&Math.abs((part[k[3]]??-1)-n)>5e-4){changes.push(`${labelOf(key)} ${POSITIONS[k[3]][1]} position: ${num(part[k[3]])} → ${num(n)}.`);part[k[3]]=num(n);}}
      else if(key==='shooter.pidf'&&m.shooter){const [p,i,dd,f]=value.split(',').map(Number);if([p,i,dd,f].every(Number.isFinite)&&f>0){m.shooter.pidf={p:num(p),i:+i.toFixed(4),d:num(dd),f:num(f)};changes.push(`Flywheel velocity PIDF: P ${num(p)}, I ${+i.toFixed(4)}, D ${num(dd)}, F ${num(f)}${values['shooter.topSpeed']?` (top speed ${values['shooter.topSpeed']} ticks/s)`:''}.`);}}
      else if(m.turret&&Number.isFinite(n)&&n>0){
        if(key==='turret.servoCenter'&&n<=1&&Math.abs(m.turret.servoCenter-n)>5e-4){changes.push(`Turret servo facing the front: ${num(m.turret.servoCenter)} → ${num(n)}.`);m.turret.servoCenter=num(n);}
        else if(key==='turret.servoDegrees'&&Math.abs(m.turret.servoDegrees-n)>.5){changes.push(`Turret servo range: ${+m.turret.servoDegrees.toFixed(1)} → ${+n.toFixed(1)} degrees.`);m.turret.servoDegrees=+n.toFixed(1);}
        else if(key==='turret.ticksPerDegree'&&Math.abs(m.turret.ticksPerDegree-n)>.005){changes.push(`Turret encoder: ${num(m.turret.ticksPerDegree)} → ${num(n)} ticks per degree.`);m.turret.ticksPerDegree=num(n);}}
    }
    r.devices=devices;if(JSON.stringify(odo)!==before)r.odometry=odo;return {robot:r,mechanisms:m,changes,problems};
  }
  // Every TeamCode file for the Control Hub, keyed by path under TeamCode/src/main/java. RobotActions
  // is listed in keep: it is written only when it does not exist yet.
  function files({route,layout,tuning,robot,localization,setupName,packageName='org.firstinspires.ftc.teamcode',className='PlannedRoute',routeJava,mechanisms=null,kinematics=null,target=null,exporter=globalThis.DeckSimExport||require('./sim-export.js')}){
    const h=hardware(robot,localization),dir=packageName.replace(/\./g,'/'),opModeName=className+'Auto',mech=mechanisms?.enabled?mechanisms:null,list=exporter.actions(route),{parts,sensorSpecs}=exportParts({robot,localization,mechanisms,kinematics});
    const options={packageName,className,opModeName,layoutName:layout.name,setupName,exporter,mechanisms:mech,kinematics,parts,sensorSpecs,sequences:exporter.sequences?.(route)||[]};
    if(mech)h.mechanisms=mechanismHardware(mech);
    // Older callers export geometry before passing the measured robot tuning. Resolve inherited
    // power here as well, so generated code and the virtual follower use the same default.
    const powers=exporter.legs(route).map(l=>n(l.power??route.defaultPower??tuning.maxPathSpeed??.8)).join(', ');
    routeJava=routeJava.replace(/public static final double\[\] MOTOR_POWER = \{[^}]*\}/,`public static final double[] MOTOR_POWER = {${powers}}`);
    const core=(globalThis.DeckFollowerSource||(typeof require==='function'?require('./sim-follower-source.js'):''));if(!core)throw Error('The bundled Deck controller source is missing.');
    const out={[`${dir}/${className}.java`]:routeJava,[`${dir}/${opModeName}.java`]:opMode(options),[`${dir}/RouteActions.java`]:routeActions(options,list),[`${dir}/RobotActions.java`]:robotActions(options,list),[`${dir}/drive/Constants.java`]:constants(h,tuning,options),[`${dir}/drive/RobotDrive.java`]:robotDrive(h,options),['deck/pathing/DeckFollower.java']:core};
    if(mech)out[`${dir}/Mechanisms.java`]=mechanismsSource(options,mech,target||{x:72,y:72},{length:robot?.length,width:robot?.width,wiring:robot?.wiring});
    if(parts.list.length)out[`${dir}/Parts.java`]=partsSource(options,parts.list,sensorSpecs);
    // The check TeleOp tests the drive motors and every mechanism device on the robot before the autonomous runs.
    const checkName=className+'Check',check=`${dir}/${checkName}.java`;out[check]=checkOpMode({...options,checkName},h,mech);
    // Deck runs these actions itself: an old RobotActions.java's untouched empty methods for them are taken out (retireStubs).
    const retire={[`${dir}/RobotActions.java`]:list.filter(a=>mechanismAction(a.name,mech,parts)).map(a=>a.slot)};
    return {files:out,keep:[`${dir}/RobotActions.java`],retire,opMode:`${packageName}.${opModeName}`,check:{path:check,opMode:`${packageName}.${checkName}`},hardware:h,actions:list};
  }
  // One SDK-only .java file for OnBot Java: controller, route, wiring and action slots
  // are nested in its OpMode. No external library upload or Android Studio project is needed.
  function onBotJava(options){
    options={...options,packageName:options.packageName||'org.firstinspires.ftc.teamcode'};
    const out=files(options),packageName=options.packageName,name=out.opMode.split('.').at(-1),imports=new Set(),nested=[];let outer='';
    for(const [file,source]of Object.entries(out.files)){
      if(file===out.check.path)continue;
      for(const m of source.matchAll(/^import\s+([^;]+);/gm))if(!m[1].startsWith('deck.pathing.')&&!m[1].startsWith(packageName+'.'))imports.add(m[1]);
      const declaration=/\bpublic\s+((?:(?:abstract|final)\s+)*)class\s+(\w+)([^\{]*)\{/.exec(source);if(!declaration)throw Error('Cannot combine '+file);
      const className=declaration[2],body=source.slice(declaration.index+declaration[0].length,source.lastIndexOf('}'));
      // Qualify Java type tokens, preserving action names, notes and other string literals.
      const qualify=text=>text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\/|\b(Pose|Point|Path|Paths|Interpolator|Config|Drivetrain|Localizer|MotionState|Velocity|DrivePowers)\b/g,(token,type)=>type?'DeckFollower.'+type:token).replace(/DeckFollower\.DeckFollower\./g,'DeckFollower.');
      if(className===name){const annotation=source.slice(source.indexOf('@Autonomous'),declaration.index);outer=annotation+`public class ${name}${declaration[3]}{`+qualify(body);}
      else nested.push(`    public static ${declaration[1]}class ${className}${className==='DeckFollower'?declaration[3]:qualify(declaration[3])}{\n${className==='DeckFollower'?body:qualify(body)}\n    }`);
    }
    const source=`package ${packageName};\n\n${[...imports].sort().map(i=>'import '+i+';').join('\n')}\n\n/** Upload this file to OnBot Java, match the robot hardware names and IMU mounting,\n * then Build Everything. Select this autonomous on the Driver Station and INIT/START.\n * All driving code is included. The intake and shooter set up in Deck run in Mechanisms;\n * write anything else (or your own version of an action) in RobotActions.\n * Calibrate wheel travel, pod offsets and control gains on the actual robot.\n */\n${outer}\n${nested.join('\n\n')}\n}\n`;
    // The check TeleOp is its own file (an OpMode cannot be nested) and uses this file's Mechanisms.
    const dir=packageName.replace(/\./g,'/'),checkName=out.check.opMode.split('.').at(-1),mech=options.mechanisms?.enabled?options.mechanisms:null;
    const check={name:checkName+'.java',source:checkOpMode({packageName,layoutName:options.layout.name,setupName:options.setupName,checkName},out.hardware,mech,name+'.Mechanisms'),opMode:out.check.opMode};
    return {name:name+'.java',source,opMode:out.opMode,check,files:{[dir+'/'+name+'.java']:source,[dir+'/'+check.name]:check.source},hardware:out.hardware};
  }
  // The robot's own moving parts and the sensors the code reads, for one export.
  function exportParts({robot,localization,mechanisms,kinematics}){const list=partDevices(kinematics),rows=wiredRows(robot,localization,mechanisms?.enabled?mechanisms:null,kinematics);
    return {parts:{list,kinematics:kinematics||null},sensorSpecs:sensorSpecs(rows,robot),rows};}
  // The robot's configuration as Setup wires it (hubs, every device and sensor on its port), written without a scan.
  function robotConfiguration({robot,localization,mechanisms,kinematics}){const R=globalThis.DeckRobotConfig||require('./ftc/robot-config.js'),H=Hw();
    return R.configurationFor(wiredRows(robot,localization,mechanisms?.enabled?mechanisms:null,kinematics).filter(r=>r.kind!=='motorEncoder'),H.wiringOf(robot),{});}
  // What a Control Hub export proves and what the team still has to do (shown with the export).
  function checklist({mechanisms=null,actions=[]}={}){
    return [
      {status:'verified',label:'Compiles',detail:'Deck’s export check compiles OnBot Java and TeamCode output against FTC SDK 12.0.0 (tools/simulation/check-ftc-sdk.cjs).'},
      {status:'verified',label:'Runs in simulation',detail:'Run & review → Program → OnBot Java export runs this exact file on the virtual Control Hub with simulated motors, sensors and physics.'},
      {status:'team',label:'Hardware names',detail:'Motor, IMU and sensor names, motor directions and IMU mounting must match your Control Hub configuration. Send to robot checks the names against it.'},
      {status:'calibration',label:'Calibration',detail:'Wheel travel, pod offsets and the generated gains are starting values. Check them on your robot.'},
      {status:'team',label:'Actions',detail:actions.length?(mechanisms?'Mechanisms.java drives the intake and shooter set up in Deck. Run the check TeleOp first: it tests every device, its direction, servo positions and flywheel speed. Other actions need code in RobotActions.java.':'Write the code for each action in RobotActions.java; until then they finish at once.'):'No actions in this route.'},
      {status:'physical',label:'Real-world test',detail:'Drive it on a practice field at low power first. Simulation and compilation do not prove the robot will follow the path.'}
    ];
  }
  return {checklist,hardware,hardwareIfSupported,deviceSlots,robotNeeds,files,onBotJava,mechanismDevices,mechanismHardware,mechanismAction,sensorHardware,kinematicsHardware,sensorSpecs,wiredRows,partDevices,partAction,partsSource,exportParts,robotConfiguration,retireStubs,hoodPositions,routeActions,robotActions,mechanismsSource,checkOpMode,checkResults,applyCheck,SUPPORTED,MOTORS,TANK,ticksPerRev};
});
