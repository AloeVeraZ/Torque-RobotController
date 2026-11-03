package org.firstinspires.ftc.teamcode;

import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;
import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.hardware.rev.RevHubOrientationOnRobot;
import com.qualcomm.hardware.sparkfun.SparkFunOTOS;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.*;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.util.ElapsedTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.function.LongSupplier;
import org.firstinspires.ftc.robotcore.external.Telemetry;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.Pose2D;

/** Upload this file to OnBot Java, match the robot hardware names and IMU mounting,
 * then Build Everything. Select this autonomous on the Driver Station and INIT/START.
 * All driving code is included. The intake and shooter set up in Deck run in Mechanisms;
 * write anything else (or your own version of an action) in RobotActions.
 * Calibrate wheel travel, pod offsets and control gains on the actual robot.
 */
@Autonomous(name = "BIOBUZZ red auto (Deck)", group = "Torque")
public class BiobuzzRedAuto extends LinearOpMode {
    private DeckFollower follower;
    private RouteActions actions;
    private final RouteActions.Step step = new RouteActions.Step();

    @Override
    public void runOpMode() throws InterruptedException {
        follower = Constants.create(hardwareMap);
        follower.setPose(BiobuzzRed.START);
        actions = new RobotActions();
        actions.init(hardwareMap, telemetry);
        // Each hub reads all its inputs in one go per loop (bulk caching), so sensors and encoders cost no extra time.
        for (LynxModule hub : hardwareMap.getAll(LynxModule.class)) hub.setBulkCachingMode(LynxModule.BulkCachingMode.AUTO);
        DeckFollower.Path[] legs = BiobuzzRed.legs();
        telemetry.addData("Route", legs.length + " legs");
        telemetry.update();
        waitForStart();
        try {
            ElapsedTime timer = new ElapsedTime(), movingTimer = new ElapsedTime();
            double plannedHeading = BiobuzzRed.START.heading();
            int movingPath = 0;
            boolean movingDone = true, movingFirst = false;
            for (int i = 0; i < legs.length && opModeIsActive(); i++) {
                Constants.motorPower(BiobuzzRed.MOTOR_POWER[i]);
                if (BiobuzzRed.MOTOR_POWER[i] == 0) {
                    follower.stop();
                    while (opModeIsActive()) { report(i, legs.length, "Zero motor power: stopped"); idle(); }
                    break;
                }
                // Turn only where the plan changes heading (turning routes), not to chase small drift.
                if (Math.abs(angle(BiobuzzRed.START_HEADING[i] - plannedHeading)) > Math.toRadians(0.5)) turnTo(BiobuzzRed.START_HEADING[i], i, legs.length);
                // An action path's action starts with the path and may span several legs of it.
                String moving = BiobuzzRed.MOVING_ACTIONS[i];
                if (!moving.isEmpty() && BiobuzzRed.PATH[i] != movingPath) {
                    movingPath = BiobuzzRed.PATH[i];
                    movingDone = false;
                    movingFirst = true;
                    movingTimer.reset();
                }
                follower.follow(legs[i]);
                step.wait = 0;
                boolean through = i + 1 < legs.length && BiobuzzRed.WAIT_SECONDS[i] == 0 && BiobuzzRed.ACTIONS[i].isEmpty() && Double.isNaN(BiobuzzRed.TURN_AFTER[i]) && DeckFollower.continuous(legs[i],legs[i+1]);
                while (opModeIsActive() && follower.following()) {
                    follower.update();
                    if (!moving.isEmpty() && !movingDone) {
                        // A set time runs the action from the start of its path; the last call stops it.
                        double t = movingTimer.seconds();
                        boolean over = BiobuzzRed.MOVING_SECONDS[i] > 0 && t >= BiobuzzRed.MOVING_SECONDS[i];
                        step.duration = BiobuzzRed.MOVING_SECONDS[i];
                        step.cell = BiobuzzRed.MOVING_CELL[i];
                        movingDone = act(moving, t, movingFirst, over, true, BiobuzzRed.PIN[i]) || over;
                        movingFirst = false;
                    }
                    report(i, legs.length, moving.isEmpty() ? "Driving" : "Action path");
                    if (through && follower.remainingDistance() < 1.5 && near(legs[i].endPose(),1.5)) break;
                }
                boolean pathEnds = i == legs.length - 1 || BiobuzzRed.PATH[i + 1] != movingPath || BiobuzzRed.MOVING_ACTIONS[i + 1].isEmpty();
                if (!moving.isEmpty() && pathEnds) {
                    // The path is over: one last call so the action can stop its mechanisms.
                    if (!movingDone) { step.duration = BiobuzzRed.MOVING_SECONDS[i]; act(moving, movingTimer.seconds(), movingFirst, true, true, BiobuzzRed.PIN[i]); }
                    movingDone = true;
                    movingPath = 0;
                }
                DeckFollower.Pose end = legs[i].endPose();
                plannedHeading = end.heading();
                if (through) continue;
                timer.reset();
                while (opModeIsActive() && timer.seconds() < 3 && !(near(end, 0.75) && follower.velocity().linSpeed() < .5)) {
                    follower.update();
                    report(i, legs.length, "Settling");
                }
                if (!Double.isNaN(BiobuzzRed.TURN_AFTER[i])) {
                    turnTo(BiobuzzRed.TURN_AFTER[i], i, legs.length);
                    plannedHeading = BiobuzzRed.TURN_AFTER[i];
                }
                // At the pin: pause, then run the action for its set time (or until it reports done), then drive on.
                timer.reset();
                while (opModeIsActive() && timer.seconds() < BiobuzzRed.WAIT_SECONDS[i]) {
                    follower.update();
                    report(i, legs.length, "Pause");
                }
                String action = BiobuzzRed.ACTIONS[i];
                step.wait = BiobuzzRed.WAIT_SECONDS[i];
                step.duration = BiobuzzRed.ACTION_SECONDS[i];
                step.cell = BiobuzzRed.ACTION_CELL[i];
                boolean done = action.isEmpty(), first = true;
                timer.reset();
                while (opModeIsActive() && !done) {
                    follower.update();
                    double t = timer.seconds();
                    boolean over = BiobuzzRed.ACTION_SECONDS[i] > 0 && t >= BiobuzzRed.ACTION_SECONDS[i];
                    done = act(action, t, first, over, false, BiobuzzRed.PIN[i]) || over;
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
        DeckFollower.Pose here = follower.pose();
        follower.hold(new DeckFollower.Pose(here.x(), here.y(), heading));
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

    private boolean near(DeckFollower.Pose target, double inches) {
        DeckFollower.Pose p = follower.pose();
        return Math.hypot(p.x() - target.x(), p.y() - target.y()) < inches;
    }

    private static double angle(double radians) {
        return Math.atan2(Math.sin(radians), Math.cos(radians));
    }

    private void report(int leg, int legs, String phase) {
        actions.update();
        DeckFollower.Pose p = follower.pose();
        telemetry.addData("Leg", (leg + 1) + " of " + legs);
        telemetry.addData("Phase", phase);
        telemetry.addData("x", "%.1f", p.x());
        telemetry.addData("y", "%.1f", p.y());
        telemetry.addData("heading", "%.1f", Math.toDegrees(p.heading()));
        telemetry.update();
    }

    public static final class BiobuzzRed {

    private BiobuzzRed() {}

    public static final DeckFollower.Pose START = new DeckFollower.Pose(9.83, 27, Math.toRadians(0));
    public static final double HEADING = Math.toRadians(0);

    /** Actual field dimensions, inches (custom fields are not rescaled). */
    public static final double FIELD_WIDTH = 144;
    public static final double FIELD_HEIGHT = 144;

    /** Pause at the pin after each leg, before its action, in seconds. */
    public static final double[] WAIT_SECONDS = {0, 0, 0, 0, 0, 0};

    /** Motor power ceiling per leg, including setup defaults (0 disables that leg). */
    public static final double[] MOTOR_POWER = {1.0, 1.0, 1.0, 1.0, 1.0, 1.0};

    /** The action run at the pin after each leg, as named in the simulator ("" for none). */
    public static final String[] ACTIONS = {"Shoot", "", "Intake", "", "Shoot", ""};

    /** Which hive cell each pin action aims at: 0 the cell up at the start, 1 the other cell. */
    public static final int[] ACTION_CELL = {0, 0, 0, 0, 0, 0};

    /** How long each pin action runs, in seconds (0: until it reports done). */
    public static final double[] ACTION_SECONDS = {0, 0, 0.6, 0, 0, 0};

    /** The action run WHILE driving each leg: action paths ("" for regular paths). */
    public static final String[] MOVING_ACTIONS = {"Spin up", "", "Intake", "", "Spin up", ""};

    /** Which hive cell each action path's action aims at (0 start cell, 1 the other cell). */
    public static final int[] MOVING_CELL = {0, 0, 0, 0, 0, 0};

    /** How long each action path's action runs from the start of its path, in seconds (0: the whole path). */
    public static final double[] MOVING_SECONDS = {0, 0, 0, 0, 0, 0};

    /** Which pin's path each leg drives (1 = the path from the start to pin 1). */
    public static final int[] PATH = {1, 2, 3, 4, 5, 6};

    /** The pin each leg ends at (0 = a turn point between pins). */
    public static final int[] PIN = {1, 2, 3, 4, 5, 6};

    /** Heading to face before each leg, radians. */
    public static final double[] START_HEADING = {Math.toRadians(0), Math.toRadians(0), Math.toRadians(-90), Math.toRadians(-90), Math.toRadians(-90), Math.toRadians(-90)};

    /** Heading to turn to in place after each leg, radians (NaN = no turn). */
    public static final double[] TURN_AFTER = {Double.NaN, Double.NaN, Double.NaN, Double.NaN, Double.NaN, Double.NaN};

    /** The route split into legs (see above). Leg i ends at pin 1, 2, 3, 4, 5, 6. */
    public static DeckFollower.Path[] legs() {
        return new DeckFollower.Path[] {
            DeckFollower.Paths.line(v(9.83, 27), v(24, 30)).heading(turn(0, 0)),
            DeckFollower.Paths.curve(v(24, 30), v(23.333, 26.667), v(22.998, 22.184), v(22, 20)).heading(turn(0, -90)),
            DeckFollower.Paths.line(v(22, 20), v(16, 12.5)).heading(turn(-90, -90)),
            DeckFollower.Paths.line(v(16, 12.5), v(24, 24)).heading(turn(-90, -90)),
            DeckFollower.Paths.curve(v(24, 24), v(26.5, 25.937), v(32, 26.667), v(36, 28)).heading(turn(-90, -90)),
            DeckFollower.Paths.line(v(36, 28), v(16, 107)).heading(turn(-90, 0))
        };
    }

    /** No-go zones the route keeps clear of, as polygons {x, y} in inches. */
    public static final double[][][] NO_GO_ZONES = {};

    private static DeckFollower.Point v(double x, double y) {
        return DeckFollower.Point.cartesian(x, y);
    }

    /** Face a fixed field target at every point of the actual curve. */
    private static DeckFollower.Interpolator face(double x, double y) {
        return (curve, t) -> { DeckFollower.Point p = curve.get(t); return Math.atan2(y - p.y(), x - p.x()); };
    }

    /** Face along the path (backwards: reverse), from the curve's direction at each point. */
    private static DeckFollower.Interpolator tangent(boolean reverse) {
        return (curve, t) -> { DeckFollower.Point a = curve.get(Math.max(0, t - 1e-4)), b = curve.get(Math.min(1, t + 1e-4)); return Math.atan2(b.y() - a.y(), b.x() - a.x()) + (reverse ? Math.PI : 0); };
    }

    /** Heading that turns steadily from one angle to another (degrees; may span whole spins) along a path. */
    private static DeckFollower.Interpolator turn(double fromDegrees, double toDegrees) {
        double from = Math.toRadians(fromDegrees), by = Math.toRadians(toDegrees - fromDegrees), full = 2 * Math.PI;
        return (curve, t) -> ((from + by * t) % full + full) % full;
    }

    }

    public static abstract class RouteActions {

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
        public DeckFollower.Pose pose;
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
    /** The intake, indexer and shooter set up in the simulator (Mechanisms.java). */
    protected final Mechanisms mech = new Mechanisms();

    /** Called once during init, before START. Look up your mechanism hardware here. */
    public void init(HardwareMap hardwareMap, Telemetry telemetry) {
        this.hardwareMap = hardwareMap;
        this.telemetry = telemetry;
        mech.init(hardwareMap);
    }

    /** "Spin up": while driving the path to pin 1; while driving the path to pin 5. Return true when finished. */
    public boolean spinUp(Step step) {
        mech.spin(true);
        return true;
    }

    /** "Shoot": stopped at pin 1; stopped at pin 5. Return true when finished. */
    public boolean shoot(Step step) {
        return mech.shoot(0, step);
    }

    /** "Intake": while driving the path to pin 3; stopped at pin 3. Return true when finished. */
    public boolean intake(Step step) {
        boolean done = step.last || (!step.moving && step.duration <= 0);
        mech.intake(!done);
        return done;
    }

    /** Called every loop by the autonomous: moving parts finish their moves on their own. */
    public void update() {
    }

    /** Called when the autonomous ends or is stopped: stop every mechanism. */
    public void stop() {
        mech.stop();
    }

    /** Runs the action with this simulator name. Names this file does not know count as finished. */
    public final boolean run(String name, Step step) {
        switch (name) {
            case "Spin up": return spinUp(step);
            case "Shoot": return shoot(step);
            case "Intake": return intake(step);
            default: return true;
        }
    }

    private boolean notWritten(String name) {
        if (telemetry != null) telemetry.addData("Action", name + ": no code yet (write it in RobotActions.java)");
        return true;
    }

    }

    public static class RobotActions extends RouteActions {

    // Deck's Intake, Spin up, Aim and Shoot already run the mechanisms set up in Deck (Mechanisms.java, as
    // mech). To do one of them your own way, override it here. For example, to shoot with your own code:
    //     @Override
    //     public boolean shoot(Step step) {
    //         // Called every loop until it returns true. Never sleep() here: the robot stops following its path.
    //         return mech.shoot(0, step); // Deck's version: start from it, or replace it
    //     }

    // Example: private DcMotorEx intake;

    @Override
    public void init(HardwareMap hardwareMap, Telemetry telemetry) {
        super.init(hardwareMap, telemetry);
        // Example: intake = hardwareMap.get(DcMotorEx.class, "intake");
    }

    @Override
    public void stop() {
        super.stop();
        // Stop every mechanism you added here.
    }

    }

    public static final class Constants {

    private static RobotDrive hardware;
    private static DeckFollower.Config config;
    public static DeckFollower create(HardwareMap map) {
        hardware = new RobotDrive(map);
        config = new DeckFollower.Config();
        config.maxForward=55.3753; config.maxStrafe=44.3003; config.maxTurn=4.60733;
        config.positionP=0.166273; config.positionD=0.0126685;
        config.headingP=4.43295; config.headingD=0.08;
        config.acceleration=166.126; config.tank=false;
        config.maxPathSpeed=1.0;
        ElapsedTime clock = new ElapsedTime();
        return new DeckFollower(hardware, hardware, config, () -> clock.nanoseconds());
    }
    public static void motorPower(double p) { config.maxPathSpeed=p; hardware.limit=p; }

    }

    public static final class RobotDrive implements DeckFollower.Drivetrain, DeckFollower.Localizer {

    private final DcMotorEx[] motors = new DcMotorEx[4], pods = new DcMotorEx[0];
    private final IMU imu;
    private final GoBildaPinpointDriver pinpoint;
    private final SparkFunOTOS otos;
    private final ElapsedTime clock = new ElapsedTime();
    private final int[] before = new int[4], podBefore = new int[0];
    private double oldImu, lastTime;
    double limit=0.6;
    private DeckFollower.MotionState state=DeckFollower.MotionState.ofVelocity(DeckFollower.Pose.zero(),DeckFollower.Velocity.zero());
    public RobotDrive(HardwareMap map) {
        motors[0]=map.get(DcMotorEx.class, "front_left"); motors[0].setDirection(DcMotorSimple.Direction.REVERSE);
        motors[1]=map.get(DcMotorEx.class, "front_right"); motors[1].setDirection(DcMotorSimple.Direction.FORWARD);
        motors[2]=map.get(DcMotorEx.class, "back_left"); motors[2].setDirection(DcMotorSimple.Direction.REVERSE);
        motors[3]=map.get(DcMotorEx.class, "back_right"); motors[3].setDirection(DcMotorSimple.Direction.FORWARD);
        for(DcMotorEx m:motors){m.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER);m.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);}

        imu=map.get(IMU.class,"imu");
        // How the Control Hub is mounted (Deck: Setup → Robot controller). If this is wrong, every turn and heading is wrong.
        imu.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(RevHubOrientationOnRobot.LogoFacingDirection.UP,RevHubOrientationOnRobot.UsbFacingDirection.FORWARD)));
        pinpoint=map.get(GoBildaPinpointDriver.class,"pinpoint");
        // The Pinpoint's pods: X is the forward pod (its offset: inches left of the robot's centre), Y the strafe pod (inches
        // forward of it). Resetting also calibrates its IMU, so the robot must be still at INIT. The reset takes about 0.25 s
        // and a position set before it ends is lost, so wait for it (Pedro's PinpointLocalizer waits 0.5 s too).
        pinpoint.setOffsets(4.0,-3.0,DistanceUnit.INCH);
        pinpoint.setEncoderResolution(GoBildaPinpointDriver.GoBildaOdometryPods.goBILDA_4_BAR_POD);
        pinpoint.setEncoderDirections(GoBildaPinpointDriver.EncoderDirection.FORWARD,GoBildaPinpointDriver.EncoderDirection.FORWARD);
        pinpoint.resetPosAndIMU();
        try{Thread.sleep(500);}catch(InterruptedException e){Thread.currentThread().interrupt();}
        otos=null;
        setPose(DeckFollower.Pose.zero());
    }
    public DeckFollower.MotionState state(){return state;}
    public java.util.Map<String,Object> debug(){return java.util.Collections.emptyMap();}
    public void setPose(DeckFollower.Pose p){
        for(int i=0;i<motors.length;i++)before[i]=motors[i].getCurrentPosition();
        for(int i=0;i<pods.length;i++)podBefore[i]=pods[i].getCurrentPosition();
        oldImu=imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.RADIANS);lastTime=clock.seconds();
        if(pinpoint!=null)pinpoint.setPosition(new Pose2D(DistanceUnit.INCH,p.x(),p.y(),AngleUnit.RADIANS,p.heading()));
        if(otos!=null)otos.setPosition(new SparkFunOTOS.Pose2D(p.x(),p.y(),p.heading()));
        state=DeckFollower.MotionState.ofVelocity(p,DeckFollower.Velocity.zero());
    }
    public void update(){
        double now=clock.seconds(),dt=now-lastTime;if(dt<=0)return;lastTime=now;DeckFollower.Pose p=state.pose(),next;
        double yaw=imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.RADIANS),dh=DeckFollower.angle(yaw-oldImu);oldImu=yaw;
        if(pinpoint!=null){pinpoint.update();next=new DeckFollower.Pose(pinpoint.getPosX(DistanceUnit.INCH),pinpoint.getPosY(DistanceUnit.INCH),pinpoint.getHeading(AngleUnit.RADIANS));}
        else if(otos!=null){SparkFunOTOS.Pose2D q=otos.getPosition();next=new DeckFollower.Pose(q.x,q.y,q.h);}
        else {
            double[] d=new double[motors.length];for(int i=0;i<d.length;i++){int ticks=motors[i].getCurrentPosition();d[i]=(ticks-before[i])*0.0238888;before[i]=ticks;}
            double forward=(d[0]+d[1]+d[2]+d[3])/4,left=(-d[0]+d[1]+d[2]-d[3])/4;

            double mid=p.heading()+dh/2;next=new DeckFollower.Pose(p.x()+forward*Math.cos(mid)-left*Math.sin(mid),p.y()+forward*Math.sin(mid)+left*Math.cos(mid),p.heading()+dh);
        }
        state=DeckFollower.MotionState.ofVelocity(next,new DeckFollower.Velocity((next.x()-p.x())/dt,(next.y()-p.y())/dt,DeckFollower.angle(next.heading()-p.heading())/dt));
    }
    public void drive(DeckFollower.DrivePowers p,boolean manual){
        double[] powers=new double[]{p.forward()-p.strafe()-p.turn(),p.forward()+p.strafe()+p.turn(),p.forward()+p.strafe()-p.turn(),p.forward()-p.strafe()+p.turn()};
        double scale=1;for(double w:powers)scale=Math.max(scale,Math.abs(w)/Math.max(.000001,limit));
        for(int i=0;i<motors.length;i++)motors[i].setPower(limit<=0?0:powers[i]/scale);
    }
    public void stop(){for(DcMotorEx m:motors)m.setPower(0);}

    }

    public static final class DeckFollower {

    public static double angle(double v) { return Math.atan2(Math.sin(v), Math.cos(v)); }
    public static double clamp(double v, double lo, double hi) { return Math.max(lo, Math.min(hi, v)); }
    public static final class Point {
        private final double x;
        private final double y;
        public Point(double x, double y) { this.x=x;this.y=y; }
        public double x() { return x; }
        public double y() { return y; }

        public static Point cartesian(double x, double y) { return new Point(x, y); }
    }
    public static final class Pose {
        private final double x;
        private final double y;
        private final double heading;
        public Pose(double x, double y, double heading) { this.x=x;this.y=y;this.heading=heading; }
        public double x() { return x; }
        public double y() { return y; }
        public double heading() { return heading; }

        public static Pose zero() { return new Pose(0, 0, 0); }
        public double distance(Pose p) { return Math.hypot(x-p.x, y-p.y); }
    }
    public static final class Velocity {
        private final double x;
        private final double y;
        private final double heading;
        public Velocity(double x, double y, double heading) { this.x=x;this.y=y;this.heading=heading; }
        public double x() { return x; }
        public double y() { return y; }
        public double heading() { return heading; }

        public static Velocity zero() { return new Velocity(0, 0, 0); }
        public double linSpeed() { return Math.hypot(x, y); }
    }
    public static final class MotionState {
        private final Pose pose;
        private final Velocity velocity;
        public MotionState(Pose pose, Velocity velocity) { this.pose=pose;this.velocity=velocity; }
        public Pose pose() { return pose; }
        public Velocity velocity() { return velocity; }

        public static MotionState ofVelocity(Pose p, Velocity v) { return new MotionState(p, v); }
    }
    public interface Localizer {
        void update(); void setPose(Pose p); MotionState state();
        default void reset() { setPose(Pose.zero()); }
        default Map<String,Object> debug() { return java.util.Collections.emptyMap(); }
    }
    public static final class DrivePowers {
        private final double forward;
        private final double strafe;
        private final double turn;
        public DrivePowers(double forward, double strafe, double turn) { this.forward=forward;this.strafe=strafe;this.turn=turn; }
        public double forward() { return forward; }
        public double strafe() { return strafe; }
        public double turn() { return turn; }
    }
    public interface Drivetrain {
        void drive(DrivePowers p, boolean manual); void stop();
        default void stop(boolean brake) { stop(); }
        default double maxScaling(DrivePowers a, DrivePowers b) { return 1; }
        default double interpolateVelocity(double x, double y, double theta) { return 1/(Math.abs(Math.cos(theta))/x+Math.abs(Math.sin(theta))/y); }
        default Map<String,Object> debug() { return java.util.Collections.emptyMap(); }
    }
    public static final class Config {
        public double maxForward=60, maxStrafe=50, maxTurn=5, maxPathSpeed=.6, acceleration=70;
        public double positionP=.09, positionD=.01, headingP=2, headingD=.12;
        public boolean tank;
    }
    public interface Curve { Point get(double t); }
    public interface Interpolator { double interpolate(Curve curve, double t); }
    public static final class Path implements Curve {
        private final Point[] points;
        private final List<Path> parts;
        private Interpolator heading=(curve,t)->0;
        Path(Point... p) { if(p.length<2)throw new IllegalArgumentException("A path needs two points.");points=p.clone();parts=null; }
        Path(List<Path> p) { if(p.isEmpty())throw new IllegalArgumentException("Empty path.");points=null;parts=new ArrayList<>(p); }
        public Path heading(Interpolator i) { if(parts!=null)parts.forEach(p->p.heading(i));else heading=i;return this; }
        public Path constant(double h) { return heading((curve,t)->h); }
        public Point get(double t) {
            if(parts!=null){double q=clamp(t,0,1)*parts.size();return parts.get(Math.min(parts.size()-1,(int)q)).get(t==1?1:q-Math.floor(q));}
            Point[] q=points.clone();for(int n=q.length;n>1;n--)for(int i=0;i<n-1;i++)q[i]=new Point(q[i].x+(q[i+1].x-q[i].x)*t,q[i].y+(q[i+1].y-q[i].y)*t);return q[0];
        }
        public Pose endPose() { if(parts!=null)return parts.get(parts.size()-1).endPose();Point p=get(1);return new Pose(p.x,p.y,heading.interpolate(this,1)); }
        private void flatten(List<Path> out) { if(parts==null)out.add(this);else parts.forEach(p->p.flatten(out)); }
    }
    public static final class Paths {
        public static Path line(Point a, Point b) { return new Path(a,b); }
        public static Path line(Pose a, Pose b) { return line(new Point(a.x,a.y),new Point(b.x,b.y)); }
        public static Path curve(Point... p) { return new Path(p); }
        public static Path path(Path... p) { return new Path(Arrays.asList(p)); }
    }
    public enum Mode { IDLE, FOLLOWING, HOLDING }
    /** Continuous modifiers may change at a tangent boundary without a needless full stop. */
    public static boolean continuous(Path a,Path b) {
        Pose end=a.endPose();Point start=b.get(0),before=a.get(.99),after=b.get(.01);
        double ax=end.x-before.x,ay=end.y-before.y,bx=after.x-start.x,by=after.y-start.y;
        double lengths=Math.hypot(ax,ay)*Math.hypot(bx,by);
        List<Path> next=new ArrayList<>();b.flatten(next);
        return Math.hypot(end.x-start.x,end.y-start.y)<.01&&lengths>1e-6&&(ax*bx+ay*by)/lengths>.95&&Math.abs(angle(end.heading-next.get(0).heading.interpolate(next.get(0),0)))<.01;
    }
    private static final class Sample {
        private final double s;
        private final Pose pose;
        private final int part;
        public Sample(double s, Pose pose, int part) { this.s=s;this.pose=pose;this.part=part; }
        public double s() { return s; }
        public Pose pose() { return pose; }
        public int part() { return part; }
    }
    private final Localizer localizer;
    private final Drivetrain drive;
    private final Config config;
    private final LongSupplier clock;
    private final List<Sample> samples=new ArrayList<>();
    private double[] limits=new double[0];
    private Mode mode=Mode.IDLE;
    private Pose target=Pose.zero();
    private double progress, total, reference, speed, lastTime=-1, settled;
    private int nearest;
    public DeckFollower(Localizer l, Drivetrain d, Config c, LongSupplier nanos) { localizer=l;drive=d;config=c;clock=nanos; }
    public Pose pose() { return localizer.state().pose(); }
    public Velocity velocity() { return localizer.state().velocity(); }
    public void setPose(Pose p) { localizer.setPose(p);lastTime=-1; }
    public Config config() { return config; }
    public Mode mode() { return mode; }
    public boolean following() { return mode==Mode.FOLLOWING; }
    public boolean isBusy() { return following(); }
    public double completion() { return total>0?progress/total:1; }
    public double remainingDistance() { return Math.max(0,total-progress); }
    public int pathIndex() { return samples.isEmpty()?0:samples.get(nearest).part; }
    public Pose closestPose() { return samples.isEmpty()?target:sample(progress); }
    public void follow(Path path) {
        samples.clear();List<Path> parts=new ArrayList<>();path.flatten(parts);double arc=0;Point previous=null;
        for(int k=0;k<parts.size();k++){Path p=parts.get(k);double polygon=0;for(int i=1;i<p.points.length;i++)polygon+=Math.hypot(p.points[i].x-p.points[i-1].x,p.points[i].y-p.points[i-1].y);
            int count=Math.max(32,(int)Math.ceil(polygon*4));for(int i=0;i<=count;i++){double t=(double)i/count;Point q=p.get(t);if(previous!=null)arc+=Math.hypot(q.x-previous.x,q.y-previous.y);samples.add(new Sample(arc,new Pose(q.x,q.y,p.heading.interpolate(p,t)),k));previous=q;}}
        // Where the path bends (a curve, or a sharp corner at a pin it drives through) the robot cannot
        // change direction at full speed: it slows to sqrt(acceleration/2 * radius) there, and brakes in
        // time for each bend ahead, so it drives through the bend instead of sweeping wide of it.
        int n=samples.size();limits=new double[n];Arrays.fill(limits,Double.POSITIVE_INFINITY);double inX=0,inY=0,inLength=0;
        for(int i=1;i<n;i++){Pose a=samples.get(i-1).pose,b=samples.get(i).pose;double dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(length<1e-9)continue;
            if(inLength>0){double bend=Math.abs(angle(Math.atan2(dy,dx)-Math.atan2(inY,inX)));if(bend>1e-4)limits[i-1]=Math.max(3,Math.sqrt(.5*config.acceleration*(length+inLength)/2/bend));}
            inX=dx;inY=dy;inLength=length;}
        for(int i=n-2;i>=0;i--)limits[i]=Math.min(limits[i],Math.sqrt(limits[i+1]*limits[i+1]+2*.7*config.acceleration*(samples.get(i+1).s-samples.get(i).s)));
        target=path.endPose();total=arc;progress=reference=settled=0;speed=velocity().linSpeed();nearest=0;lastTime=-1;mode=Mode.FOLLOWING;
    }
    public void hold(Pose p) { target=p;mode=Mode.HOLDING;speed=0;settled=0; }
    public void stop() { mode=Mode.IDLE;speed=0;drive.stop(); }
    private Pose sample(double s) {
        int lo=0,hi=samples.size()-1;while(lo<hi){int m=(lo+hi)/2;if(samples.get(m).s<s)lo=m+1;else hi=m;}
        if(lo==0)return samples.get(0).pose;Sample a=samples.get(lo-1),b=samples.get(lo);double t=clamp((s-a.s)/Math.max(1e-9,b.s-a.s),0,1);return new Pose(a.pose.x+(b.pose.x-a.pose.x)*t,a.pose.y+(b.pose.y-a.pose.y)*t,a.pose.heading+angle(b.pose.heading-a.pose.heading)*t);
    }
    public void update() {
        localizer.update();double now=clock.getAsLong()*1e-9,dt=lastTime<0?1.0/60:clamp(now-lastTime,.00001,.1);lastTime=now;
        if(mode==Mode.IDLE||config.maxPathSpeed<=0){drive.stop();return;}
        Pose p=pose();Velocity v=velocity();double vx=0,vy=0,omega=0;Pose aim=target;
        if(following()){
            double best=Double.POSITIVE_INFINITY;int index=nearest;
            for(int j=Math.max(0,nearest-4);j<samples.size()&&samples.get(j).s<=progress+20;j++){double d=p.distance(samples.get(j).pose);if(d<best){best=d;index=j;}}
            nearest=Math.max(nearest,index);progress=Math.max(progress,samples.get(nearest).s);
            double remaining=total-reference,cruise=config.maxForward*config.maxPathSpeed;
            // Leave braking headroom for wheel saturation, heading corrections and sensor delay.
            double wanted=Math.min(cruise,Math.sqrt(Math.max(0,.7*config.acceleration*remaining)));
            Pose here=sample(reference),look=sample(Math.min(total,reference+.5));
            double angularPerInch=Math.abs(angle(look.heading-here.heading))/Math.max(.001,Math.min(.5,total-reference));
            if(angularPerInch>1e-6)wanted=Math.min(wanted,config.maxTurn*config.maxPathSpeed*.65/angularPerInch);
            // The slowest bend between the robot and its reference point (the robot may trail it).
            for(int j=nearest;j<samples.size()&&samples.get(j).s<=Math.max(progress,reference)+.5;j++)wanted=Math.min(wanted,limits[j]);
            speed+=clamp(wanted-speed,-config.acceleration*dt,config.acceleration*dt);
            reference=Math.min(total,Math.min(reference+speed*dt,progress+Math.max(2,speed*.12)));
            aim=sample(reference);Pose ahead=sample(Math.min(total,reference+.25));double dx=ahead.x-aim.x,dy=ahead.y-aim.y,len=Math.hypot(dx,dy);
            if(len>1e-8&&reference<total){vx=dx/len*speed;vy=dy/len*speed;omega=angle(ahead.heading-aim.heading)/len*speed;}
            if(total-progress<.6&&p.distance(target)<.8){settled+=dt;if(settled>.1){mode=Mode.HOLDING;aim=target;vx=vy=omega=0;}}else settled=0;
        }
        double ex=aim.x-p.x,ey=aim.y-p.y,c=Math.cos(p.heading),s=Math.sin(p.heading);
        // Position error becomes a correction speed: proportional near the path, square-root beyond
        // it, so a large error is closed as fast as the robot can still brake for it instead of
        // saturating the motors and overshooting. Continuous where the two meet.
        double error=Math.hypot(ex,ey),k=config.positionP*config.maxForward,a=Math.max(1,config.acceleration),knee=a/Math.max(1e-6,k*k);
        double correction=error<=knee?k*error:Math.sqrt(2*a*(error-knee/2)),cx=error>1e-9?ex/error*correction:0,cy=error>1e-9?ey/error*correction:0;
        double ffForward=(vx*c+vy*s)/config.maxForward,ffStrafe=(-vx*s+vy*c)/config.maxStrafe,ffTurn=omega/config.maxTurn;
        double forward=(cx*c+cy*s)/config.maxForward-config.positionD*((v.x-vx)*c+(v.y-vy)*s);
        double strafe=(-cx*s+cy*c)/config.maxStrafe-config.positionD*(-(v.x-vx)*s+(v.y-vy)*c);
        double desiredHeading=aim.heading;
        if(config.tank&&following()&&Math.abs(forward+ffForward)>.02)desiredHeading+=Math.signum(forward+ffForward)*clamp(Math.atan2(-ex*s+ey*c,4),-.35,.35);
        double headingError=angle(desiredHeading-p.heading);
        double turn=config.headingP*headingError-config.headingD*(v.heading-omega);
        // Overcome the motor deadband at a nearly stationary heading error. Without this,
        // a light/fast drivetrain can stop just outside the turn-settling tolerance.
        if(Math.abs(headingError)>.015&&Math.abs(v.heading)<.1&&Math.abs(turn+ffTurn)<.045)turn=Math.copySign(.045,headingError)-ffTurn;
        if(config.tank){strafe=0;ffStrafe=0;}
        // Correction has priority over path speed: when the wheels saturate, the robot slows down
        // along the path rather than drifting off it. Feedback alone is capped at the power limit.
        double limit=Math.max(.000001,config.maxPathSpeed),feedback=Math.abs(forward)+Math.abs(strafe)+Math.abs(turn);
        if(feedback>limit){forward*=limit/feedback;strafe*=limit/feedback;turn*=limit/feedback;}
        double keep=1;
        if(Math.abs(forward+ffForward)+Math.abs(strafe+ffStrafe)+Math.abs(turn+ffTurn)>limit){
            // The mixed total is convex in the feedforward share; bisect for the largest share that fits.
            double lo=0,hi=1;for(int i=0;i<20;i++){double m=(lo+hi)/2;if(Math.abs(forward+m*ffForward)+Math.abs(strafe+m*ffStrafe)+Math.abs(turn+m*ffTurn)>limit)hi=m;else lo=m;}keep=lo;
        }
        drive.drive(new DrivePowers(forward+keep*ffForward,strafe+keep*ffStrafe,turn+keep*ffTurn),true);
    }

    }

    public static class Mechanisms {

    // ---- Intake 1: front sweeper roller.
    /** Intake 1 roller: a DC motor that runs at its power while an Intake action runs. */
    public static final String INTAKE_1 = "intake";
    public static final boolean INTAKE_1_REVERSED = false;
    public static final double INTAKE_1_POWER = 1.0;

    // ---- Shooter 1: pollen.
    /** Flywheel motor. */
    public static final String FLYWHEEL_1 = "shooter";
    public static final boolean FLYWHEEL_1_REVERSED = false;
    /** Feeder: a motor that runs at FEEDER_POWER while shooting. */
    public static final String FEEDER_1 = "indexer";
    public static final boolean FEEDER_1_REVERSED = false;
    /** Turret: a motor with an encoder. It aims from where it turns on the robot, inches forward and left of the center. */
    public static final String TURRET_1 = "turret";
    public static final boolean TURRET_1_REVERSED = false;
    public static final double TURRET_1_X = 0.0, TURRET_1_Y = 0.0;

    // ---- Flywheels (every shooter).
    /** Shooting speed in encoder ticks per second: 3000 RPM x 28 ticks per revolution / 60. */
    public static final double FLYWHEEL_TICKS_PER_SECOND = 1400.0;
    /** A flywheel is at speed within this fraction of FLYWHEEL_TICKS_PER_SECOND. */
    public static final double AT_SPEED_TOLERANCE = 0.05;
    /** Seconds to reach speed. A flywheel still short of it SPIN_UP_SECONDS + 0.5 s after starting shoots anyway. */
    public static final double SPIN_UP_SECONDS = 0.8;

    // ---- Feeding (every shooter), timed: there is no piece sensor.
    /** From a piece touching an intake to sitting in the shooter; how long a kicker takes to swing back up after an intake. */
    public static final double TRANSFER_SECONDS = 1.0, KICKER_UP_SECONDS = 0.0;
    /** For the next piece to move up into the shooter after a shot. */
    public static final double INDEX_SECONDS = 0.35;
    /** A volley of N shots feeds for (N - 1) x FEED_CYCLE_SECONDS + LAST_SHOT_SECONDS. */
    public static final double FEED_CYCLE_SECONDS = 0.35, LAST_SHOT_SECONDS = 0.15;
    public static final double FEEDER_POWER = 1.0;
    /** Pieces the robot can hold: 4 pollen. "Shoot" with no number shoots this many. */
    public static final int STORAGE = 4;
    /** The field points shots aim at, in inches: the hive cell up at the start, and the other cell. */
    public static final double TARGET_X = 59.25, TARGET_Y = 58.5602, OTHER_TARGET_X = 59.25, OTHER_TARGET_Y = 85.4398;

    // ---- Turrets: 0 degrees faces the robot's front, positive turns counterclockwise (to the robot's left).
    public static final double TURRET_MIN_DEGREES = -170.0, TURRET_MAX_DEGREES = 170.0;
    /** Encoder ticks per turret degree and the motor power for RUN_TO_POSITION. Zero is where the turret is at INIT. */
    public static final double TURRET_TICKS_PER_DEGREE = 4.6, TURRET_POWER = 1.0;

    private DcMotorSimple intake1;
    private DcMotorEx flywheel1;
    private DcMotorSimple feeder1;
    private DcMotorEx turret1;
    private final ElapsedTime clock = new ElapsedTime();
    private double feedStart = -1, spinStart = -1, lastIntake = -1e9;
    private boolean spinning, shot;

    public void init(HardwareMap map) {
        intake1 = map.get(DcMotorSimple.class, INTAKE_1);
        intake1.setDirection(direction(INTAKE_1_REVERSED));
        if (intake1 instanceof DcMotor) ((DcMotor) intake1).setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.FLOAT);
        flywheel1 = flywheel(map, FLYWHEEL_1, FLYWHEEL_1_REVERSED);
        feeder1 = map.get(DcMotorSimple.class, FEEDER_1);
        feeder1.setDirection(direction(FEEDER_1_REVERSED));
        turret1 = turretMotor(map, TURRET_1, TURRET_1_REVERSED);
    }

    private static DcMotorSimple.Direction direction(boolean reversed) {
        return reversed ? DcMotorSimple.Direction.REVERSE : DcMotorSimple.Direction.FORWARD;
    }

    private static DcMotorEx flywheel(HardwareMap map, String name, boolean reversed) {
        DcMotorEx motor = map.get(DcMotorEx.class, name);
        motor.setDirection(direction(reversed));
        motor.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.FLOAT);
        motor.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
        // Velocity control uses the SDK's default PIDF. For a heavy flywheel, measure its top speed with the
        // mechanism check (Y) and enter the PIDF it prints in Deck.
        return motor;
    }

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

    /** Intake on or off: rollers run at their power; kickers go down, and back up when it stops. */
    public void intake(boolean on) {
        if (on) lastIntake = clock.seconds();
        intake1.setPower(on ? INTAKE_1_POWER : 0);
    }

    /** Flywheels on (toward their speed) or off. */
    public void spin(boolean on) {
        if (on && !spinning) spinStart = clock.seconds();
        spinning = on;
        double speed = on ? FLYWHEEL_TICKS_PER_SECOND : 0;
        flywheel1.setVelocity(speed);
    }

    /** True once every flywheel is within AT_SPEED_TOLERANCE of its speed (or SPIN_UP_SECONDS + 0.5 s have passed). */
    public boolean ready() {
        if (!spinning) return false;
        if (clock.seconds() - spinStart > SPIN_UP_SECONDS + 0.5) return true;
        return atSpeed(flywheel1);
    }

    private static boolean atSpeed(DcMotorEx flywheel) {
        return Math.abs(flywheel.getVelocity() - FLYWHEEL_TICKS_PER_SECOND) < AT_SPEED_TOLERANCE * FLYWHEEL_TICKS_PER_SECOND;
    }

    /** Point every turret at a hive cell (0 TARGET, 1 OTHER_TARGET) from this pose. Fixed shooters are aimed by the route. */
    public void aim(DeckFollower.Pose pose, int cell) {
        double x = cell == 1 ? OTHER_TARGET_X : TARGET_X, y = cell == 1 ? OTHER_TARGET_Y : TARGET_Y;
        turnTurret1(bearing(pose, TURRET_1_X, TURRET_1_Y, x, y));
    }

    /** Every turret to this angle, degrees from the robot's front (counterclockwise). The mechanism check uses it. */
    public void turnTurrets(double degrees) {
        turnTurret1(degrees);
    }

    /** The turret of shooter n (0 the first) to this angle, degrees from the robot's front (counterclockwise). */
    public void turnTurret(int shooter, double degrees) {
        if (shooter == 0) turnTurret1(degrees);
    }

    /** Degrees from the robot's front (counterclockwise) to (x, y), from a turret at (dx, dy) on the robot. */
    private static double bearing(DeckFollower.Pose pose, double dx, double dy, double x, double y) {
        double c = Math.cos(pose.heading()), s = Math.sin(pose.heading());
        double tx = pose.x() + dx * c - dy * s, ty = pose.y() + dx * s + dy * c;
        double degrees = Math.toDegrees(Math.atan2(y - ty, x - tx) - pose.heading());
        return ((degrees % 360) + 540) % 360 - 180;
    }

    /** Turret 1 to an angle (degrees from the robot's front, counterclockwise), within its range. */
    private void turnTurret1(double degrees) {
        degrees = Math.max(TURRET_MIN_DEGREES, Math.min(TURRET_MAX_DEGREES, degrees));
        turret1.setTargetPosition((int) Math.round(degrees * TURRET_TICKS_PER_DEGREE));
        turret1.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        turret1.setPower(TURRET_POWER);
    }

    /** True once every turret has reached its angle. */
    public boolean aimed() {
        return !turret1.isBusy();
    }

    /** Feeders on or off, for the mechanism check: rollers run, gates open, pushers push. */
    public void feed(boolean on) {
        feeders(on, 0);
    }

    /** The feeders t seconds into a volley: rollers run and gates stay open while feeding. */
    private void feeders(boolean feeding, double t) {
        feeder1.setPower(feeding ? FEEDER_POWER : 0);
    }

    /** One call of "Shoot N" (count 0: every storage slot). Returns true once all N shots have had time. */
    public boolean shoot(int count, RouteActions.Step step) {
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
        return done;
    }

    /** Measured flywheel speeds in encoder ticks per second, in the order of flywheels(). */
    public double[] flywheelSpeeds() {
        return new double[] {flywheel1.getVelocity()};
    }

    /** The flywheel motors and their names, for the mechanism check. */
    public DcMotorEx[] flywheels() {
        return new DcMotorEx[] {flywheel1};
    }

    public static final String[] FLYWHEEL_NAMES = {FLYWHEEL_1};

    /** Every servo (kickers, ramps, servo feeders, servo turrets) and its name, for finding positions with the mechanism check. */
    public Servo[] servos() {
        return new Servo[] {};
    }

    public static final String[] SERVO_NAMES = {};

    public void stop() {
        intake(false);
        feeders(false, 0);
        spin(false);
        turret1.setPower(0);
    }

    }
}
