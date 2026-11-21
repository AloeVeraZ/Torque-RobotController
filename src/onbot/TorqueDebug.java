import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;
import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.hardware.lynx.LynxNackException;
import com.qualcomm.hardware.lynx.commands.core.LynxGetADCCommand;
import com.qualcomm.hardware.lynx.commands.core.LynxI2cReadSingleByteCommand;
import com.qualcomm.hardware.lynx.commands.core.LynxI2cReadStatusQueryCommand;
import com.qualcomm.hardware.lynx.commands.core.LynxSetServoConfigurationCommand;
import com.qualcomm.hardware.lynx.commands.core.LynxSetServoEnableCommand;
import com.qualcomm.hardware.lynx.commands.core.LynxSetServoPulseWidthCommand;
import com.qualcomm.hardware.lynx.commands.standard.LynxNack;
import com.qualcomm.hardware.rev.RevBlinkinLedDriver;
import com.qualcomm.hardware.rev.RevHubOrientationOnRobot;
import com.qualcomm.hardware.sparkfun.SparkFunOTOS;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.exception.RobotCoreException;
import com.qualcomm.robotcore.hardware.AnalogInput;
import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DigitalChannel;
import com.qualcomm.robotcore.hardware.DistanceSensor;
import com.qualcomm.robotcore.hardware.HardwareDevice;
import com.qualcomm.robotcore.hardware.I2cAddr;
import com.qualcomm.robotcore.hardware.I2cDeviceSynchDevice;
import com.qualcomm.robotcore.hardware.IMU;
import com.qualcomm.robotcore.hardware.LED;
import com.qualcomm.robotcore.hardware.NormalizedColorSensor;
import com.qualcomm.robotcore.hardware.NormalizedRGBA;
import com.qualcomm.robotcore.hardware.PwmControl;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.hardware.TouchSensor;
import com.qualcomm.robotcore.hardware.VoltageSensor;

import org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName;
import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.ExposureControl;
import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.GainControl;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.AngularVelocity;
import org.firstinspires.ftc.robotcore.external.navigation.AxesOrder;
import org.firstinspires.ftc.robotcore.external.navigation.AxesReference;
import org.firstinspires.ftc.robotcore.external.navigation.CurrentUnit;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.UnnormalizedAngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.YawPitchRollAngles;
import org.firstinspires.ftc.vision.VisionPortal;
import org.firstinspires.ftc.vision.apriltag.AprilTagDetection;
import org.firstinspires.ftc.vision.apriltag.AprilTagProcessor;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Torque's live hardware debug (Calibrate → Camera and Debug). Deck installs this file with OnBot Java; it is
 * the same for every robot: it finds every motor, servo, continuous servo, digital and analog input and I2C sensor in
 * the active configuration, and while it runs it streams their readings to Deck and drives the outputs Deck asks for.
 *
 * It listens on TCP port 20886 (Deck reaches it through ADB on the USB cable, or at the hub's address on its Wi-Fi).
 * Robot to Deck: one JSON line describing the devices, then one JSON line of readings each loop (at most 50 a second),
 * stamped with this hub's clock. Deck to robot: one tab-separated command a line (see apply()). Outputs are written
 * only by this op mode's loop, and only while Deck keeps talking: a motor or continuous servo power lasts WATCHDOG_MS
 * unless Deck sends it again (Deck repeats it while its slider is held), and with nothing heard for WATCHDOG_MS, or the
 * connection closed, every motor and continuous servo stops and servos that are not latched go limp. STOP on the Driver Station
 * stops everything too. Hub reads follow gm0: one bulk read per hub per loop; motor current and I2C sensors, which each
 * cost a transaction of their own, one device a loop in turn.
 *
 * A sensor's own read hands back zeros when nothing is plugged in, so being able to read one says nothing. watchHub asks each
 * hub directly what answers on its I2C buses and what its analog ports read, and that goes out with the readings.
 *
 * No package: Sinister, in some Robot Controller builds, crashes the app on any OnBot Java class in one, by asking for it by a name with slashes
 * ("Invalid name: org/firstinspires/ftc/teamcode/TorqueDebug", seen on FTC SDK 12.0).
 */
@TeleOp(name = "TorqueDebug", group = "Torque")
public class TorqueDebug extends LinearOpMode {
    public static final int PORT = 20886;
    static final long WATCHDOG_MS = 300, FRAME_MS = 20;
    /** A motor drawing more than this for STALL_MS is cut until it is commanded again (a 312 RPM goBILDA stalls at 9.2 A). */
    static final double STALL_AMPS = 7.0;
    static final long STALL_MS = 400;
    /** How the SDK describes where an I2C device is: "...; module 173; bus 1; addr7=0x29". */
    static final Pattern I2C_PLACE = Pattern.compile("module (\\d+); bus (\\d+); addr7=0x([0-9a-fA-F]+)");
    /** Every usable I2C address is tried once, then a few a turn: a sensor nobody configured shows within half a minute. What is configured or was found is asked every turn. */
    static final int I2C_BUSES = 4, I2C_FIRST = 0x08, I2C_LAST = 0x77, I2C_SWEEP_EACH = 4, ANALOG_PORTS = 4, ANALOG_EVERY = 5;
    static final long WATCH_MS = 200;

    // ---- devices, in the order the manifest lists them
    final List<String> motorNames = new ArrayList<>(), servoNames = new ArrayList<>(), crNames = new ArrayList<>(), digitalNames = new ArrayList<>(), touchNames = new ArrayList<>(), analogNames = new ArrayList<>(), i2cNames = new ArrayList<>(), i2cKinds = new ArrayList<>();
    final List<DcMotorEx> motors = new ArrayList<>();
    final List<Servo> servos = new ArrayList<>();
    final List<CRServo> crservos = new ArrayList<>();
    final List<DigitalChannel> digitals = new ArrayList<>();
    final List<TouchSensor> touches = new ArrayList<>();
    final List<AnalogInput> analogs = new ArrayList<>();
    /** An LED on a digital port or a Blinkin on a servo port: on or off. */
    final List<HardwareDevice> lights = new ArrayList<>();
    final List<String> lightNames = new ArrayList<>();
    final List<HardwareDevice> i2c = new ArrayList<>();
    List<LynxModule> hubs = new ArrayList<>();
    VoltageSensor battery;

    // ---- what Deck has asked for
    double[] motorPower, motorAmps, crPower, servoPos;
    boolean[] servoOn, servoLatched, motorCut, crTold, lightOn, lightSent;
    long[] motorOverSince, motorAt, crAt;
    String[] i2cLast;
    long[] i2cAt;
    /** Each I2C device's hub (its place in hubs), bus and address, or null if the SDK does not say. */
    int[][] i2cPlace;
    /** Whether each I2C device answered last: 1 yes, 0 no, -1 not asked yet, -2 the SDK does not say where it is, so it cannot be asked. */
    volatile int[] i2cOn;
    /** What watchHub found, ready to go into a frame. */
    volatile String hubWatch = "";
    /** A loop Deck runs on the robot (a step test): one actuator, one sensor, gains in the sensor's raw units. */
    TorqueDebugLoop loop;
    /** Every loop running, one an actuator: several swerve pods are held (and tuned) at once. loop is the newest, for T and q. */
    final java.util.concurrent.CopyOnWriteArrayList<TorqueDebugLoop> loops = new java.util.concurrent.CopyOnWriteArrayList<>();
    TorqueDebugLoop loopOn(boolean cr, int index) { for (TorqueDebugLoop l : loops) if (l.cr == cr && l.index == index) return l; return null; }
    /** The nudge pulse each actuator has learned in this run (its scale), kept when its loop is replaced or ended. */
    /**
     * A burst (B): one CR servo at one power for a set time, then off, measured here where the timing is exact (Torque sees the
     * readings a few tens of ms late, and unevenly). It reports how fast the reading was moving as the power went off, how far
     * it went on after that, and how long after the power came on it first moved. The servo's signal stays on throughout, as in a loop.
     */
    final java.util.concurrent.CopyOnWriteArrayList<TorqueDebugBurst> bursts = new java.util.concurrent.CopyOnWriteArrayList<>();
    TorqueDebugBurst burstOn(int index) { for (TorqueDebugBurst b : bursts) if (b.index == index) return b; return null; }
    void endBurst(int index) { for (TorqueDebugBurst b : bursts) if (b.index == index) bursts.remove(b); }
    void startBurst(String[] f) {
        TorqueDebugBurst b = new TorqueDebugBurst();
        b.actuator = f[1]; b.index = crNames.indexOf(f[1]); if (b.index < 0 || !f[2].startsWith("ana:")) return;
        b.sensorIndex = analogNames.indexOf(f[2].substring(4)); if (b.sensorIndex < 0) return;
        b.power = clamp(Double.parseDouble(f[3]), -1, 1); double secs = clamp(Double.parseDouble(f[4]), .02, 2); b.moveBy = Math.abs(Double.parseDouble(f[5])); b.wrap = Double.parseDouble(f[6]); b.id = (int) Double.parseDouble(f[7]);
        endLoop(true, b.index); endBurst(b.index);
        b.startNanos = System.nanoTime(); b.endNanos = b.startNanos + (long) (secs * 1e9); b.last = analogs.get(b.sensorIndex).getVoltage();
        crTold[b.index] = true; crPower[b.index] = b.power; bursts.add(b);
    }
    void runBursts() {
        long t = System.nanoTime();
        for (TorqueDebugBurst b : bursts) {
            if (b.phase == 2) continue;
            double r = analogs.get(b.sensorIndex).getVoltage(), secs = (t - b.startNanos) / 1e9; b.travel += wrapOf(r - b.last, b.wrap); b.last = r;
            if (b.phase == 0) {
                if (b.delay < 0 && Math.abs(b.travel) > b.moveBy) b.delay = secs;
                int k = b.n % b.ht.length; b.ht[k] = secs; b.hx[k] = b.travel; b.n++;
                if (t < b.endNanos) { crPower[b.index] = b.power; continue; }
                // The power goes off now: the speed over the last 60 ms of it (two readings back at least).
                int j = b.n - 1; while (j > 0 && b.n - j < b.ht.length && (b.n - 1 - j < 2 || secs - b.ht[j % b.ht.length] < .06)) j--;
                double span = secs - b.ht[j % b.ht.length]; b.speed = span > 0 ? (b.travel - b.hx[j % b.ht.length]) / span : 0;
                b.cutTravel = b.travel; b.cutSecs = secs; b.mark = b.travel; b.quiet = 0; b.phase = 1; crPower[b.index] = 0;
            } else {
                // Coasting: over once the reading has stayed put for eight turns of the loop, or after 0.7 s.
                if (Math.abs(b.travel - b.mark) > b.moveBy * .5) { b.mark = b.travel; b.quiet = 0; b.stopSecs = secs; } else b.quiet++;
                if (b.quiet >= 8 || secs - b.cutSecs > .7) { b.coast = b.mark - b.cutTravel; b.phase = 2; }
            }
        }
    }

    /** What a steering loop learned about its pod in this run (how far a push really goes, each way), kept from one target to the next. */
    final java.util.HashMap<String, double[]> steerLearned = new java.util.HashMap<>();
    void endLoop(boolean cr, int index) { for (TorqueDebugLoop l : loops) if (l.cr == cr && l.index == index) { if (l.steer) steerLearned.put(l.actuator, new double[] { l.gainP, l.gainN }); loops.remove(l); } loop = loops.isEmpty() ? null : loops.get(loops.size() - 1); }

    /** IMU turning running here (the U command), or the last one, until another starts or Torque stops everything. */
    volatile TorqueDebugTurn imuTurn;
    TorqueDebugTurn turnRunning() { TorqueDebugTurn t = imuTurn; return t != null && !t.finished && !t.stopped ? t : null; }
    volatile double loopMsNow = 20;

    // ---- one webcam of the configuration's at a time, the first until told otherwise (W): its picture goes to the Driver Station's Camera Stream
    final List<WebcamName> webcams = new ArrayList<>();
    final List<String> webcamNames = new ArrayList<>();
    final ConcurrentLinkedQueue<String[]> cameraCommands = new ConcurrentLinkedQueue<>();
    volatile VisionPortal portal;
    final Object portalLock = new Object();
    VisionPortal closedPortal;
    volatile AprilTagProcessor aprilTag;
    volatile String cameraError, cameraRange = "null", camLast;
    volatile double camExposure = Double.NaN, camGain = Double.NaN, camDecimation = 3, camExposureRead = Double.NaN;
    /** The exposure modes this camera says it has, as JSON. A real one had only Manual. */
    volatile String camModes = "null";
    /** The lens numbers Torque sent: fx, fy, cx, cy. Null: the SDK's own for this camera, or its guess. */
    volatile double[] camLens;
    volatile boolean camOpening;
    /** Which webcam is open. */
    volatile int camIndex;
    long camAt;

    final ConcurrentLinkedQueue<String> commands = new ConcurrentLinkedQueue<>();
    final AtomicReference<String> latest = new AtomicReference<>();
    volatile long heard;
    volatile boolean connected, running = true;
    volatile String manifest = "";
    ServerSocket server;
    Socket client;
    final Object wake = new Object();

    @Override
    public void runOpMode() throws InterruptedException {
        hubs = hardwareMap.getAll(LynxModule.class);
        for (LynxModule hub : hubs) hub.setBulkCachingMode(LynxModule.BulkCachingMode.MANUAL);
        for (DcMotorEx m : hardwareMap.getAll(DcMotorEx.class)) { motors.add(m); motorNames.add(nameOf(m)); }
        for (Servo s : hardwareMap.getAll(Servo.class)) { servos.add(s); servoNames.add(nameOf(s)); }
        for (CRServo s : hardwareMap.getAll(CRServo.class)) { crservos.add(s); crNames.add(nameOf(s)); }
        for (DigitalChannel d : hardwareMap.getAll(DigitalChannel.class)) { d.setMode(DigitalChannel.Mode.INPUT); digitals.add(d); digitalNames.add(nameOf(d)); }
        for (TouchSensor t : hardwareMap.getAll(TouchSensor.class)) { touches.add(t); touchNames.add(nameOf(t)); }
        for (AnalogInput a : hardwareMap.getAll(AnalogInput.class)) { analogs.add(a); analogNames.add(nameOf(a)); }
        for (LED l : hardwareMap.getAll(LED.class)) { lights.add(l); lightNames.add(nameOf(l)); }
        for (RevBlinkinLedDriver l : hardwareMap.getAll(RevBlinkinLedDriver.class)) { lights.add(l); lightNames.add(nameOf(l)); }
        for (IMU imu : hardwareMap.getAll(IMU.class)) {
            // Deck reads yaw, pitch and roll as the hub lies flat, logo up and USB forward; the robot's own code sets the real mounting.
            try { imu.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(RevHubOrientationOnRobot.LogoFacingDirection.UP, RevHubOrientationOnRobot.UsbFacingDirection.FORWARD))); } catch (RuntimeException ignored) { }
            addI2c(imu, "imu");
        }
        for (GoBildaPinpointDriver p : hardwareMap.getAll(GoBildaPinpointDriver.class)) addI2c(p, "pinpoint");
        for (SparkFunOTOS o : hardwareMap.getAll(SparkFunOTOS.class)) addI2c(o, "otos");
        for (NormalizedColorSensor c : hardwareMap.getAll(NormalizedColorSensor.class)) addI2c(c, "color");
        // A colour sensor is a distance sensor too: it is one device, read once.
        for (DistanceSensor d : hardwareMap.getAll(DistanceSensor.class)) if (!(d instanceof NormalizedColorSensor)) addI2c(d, "distance");
        // Anything else on an I2C bus has no reading here, but can still say whether it is there.
        for (HardwareDevice d : hardwareMap) if (placeOf(d) != null && !i2cNames.contains(nameOf(d))) addI2c(d, "other");
        for (HardwareDevice d : hardwareMap) if ("SparkFunLEDStick".equals(d.getClass().getSimpleName()) && !lights.contains(d)) { lights.add(d); lightNames.add(nameOf(d)); }
        for (WebcamName w : hardwareMap.getAll(WebcamName.class)) { webcams.add(w); webcamNames.add(nameOf(w)); }
        List<VoltageSensor> volts = hardwareMap.getAll(VoltageSensor.class);
        battery = volts.isEmpty() ? null : volts.get(0);

        motorPower = new double[motors.size()]; motorAmps = new double[motors.size()]; motorCut = new boolean[motors.size()]; motorOverSince = new long[motors.size()]; motorAt = new long[motors.size()]; crAt = new long[crservos.size()];
        crPower = new double[crservos.size()]; crTold = new boolean[crservos.size()]; servoPos = new double[servos.size()]; servoOn = new boolean[servos.size()]; servoLatched = new boolean[servos.size()];
        lightOn = new boolean[lights.size()]; lightSent = new boolean[lights.size()];
        i2cLast = new String[i2c.size()]; i2cAt = new long[i2c.size()]; i2cPlace = new int[i2c.size()][]; i2cOn = new int[i2c.size()]; Arrays.fill(i2cOn, -2);
        for (int k = 0; k < i2c.size(); k++) {
            Matcher p = placeOf(i2c.get(k));
            if (p == null) continue;
            for (int h = 0; h < hubs.size(); h++) if (hubs.get(h).getModuleAddress() == Integer.parseInt(p.group(1))) { i2cPlace[k] = new int[]{h, Integer.parseInt(p.group(2)), Integer.parseInt(p.group(3), 16)}; i2cOn[k] = -1; }
        }
        for (int i = 0; i < motors.size(); i++) { motorAmps[i] = Double.NaN; motors.get(i).setPower(0); }
        for (int i = 0; i < servos.size(); i++) { servoPos[i] = Double.NaN; if (servos.get(i) instanceof PwmControl) ((PwmControl) servos.get(i)).setPwmDisable(); }
        keepServoPower();
        manifest = manifest();

        // The port first: a camera can take a while to open, and Torque is waiting on the port.
        Thread serve = new Thread(this::serve, "Torque Debug server"), send = new Thread(this::send, "Torque Debug sender");
        serve.setDaemon(true); send.setDaemon(true); serve.start(); send.start();
        startCamera();
        telemetry.addLine("Torque Debug: press START, then open Calibrate → Debug in Torque.");
        telemetry.addData("Devices", "%d motors, %d servos, %d CR servos, %d digital, %d analog, %d I2C", motors.size(), servos.size(), crservos.size(), digitals.size() + touches.size(), analogs.size(), i2c.size());
        telemetry.update();
        waitForStart();
        Thread watch = new Thread(this::watchHub, "Torque Debug hub watch");
        watch.setDaemon(true); watch.start();
        long start = System.nanoTime(), lastFrame = 0, loops = 0, loopStart = System.nanoTime();
        double loopMs = 0, volts12 = Double.NaN;
        int turn = 0;
        try {
            while (opModeIsActive()) {
                for (LynxModule hub : hubs) hub.clearBulkCache();
                long now = System.currentTimeMillis();
                for (String line; (line = commands.poll()) != null; ) apply(line);
                // The watchdog: Deck went quiet or hung up.
                if (!connected || now - heard > WATCHDOG_MS) stopOutputs(false);
                // A power Deck stopped repeating has expired (a slider let go without its 0 arriving).
                for (int i = 0; i < motors.size(); i++) if (now - motorAt[i] > WATCHDOG_MS && loopOn(false, i) == null) motorPower[i] = 0;
                for (int i = 0; i < crservos.size(); i++) if (now - crAt[i] > WATCHDOG_MS && loopOn(true, i) == null && burstOn(i) == null) crPower[i] = 0;
                runLoop(); runBursts();
                TorqueDebugTurn tt = turnRunning();
                if (tt != null) for (int j = 0; j < tt.motors.length; j++) { int i = tt.motors[j]; motorPower[i] = clamp(tt.powers[j] * tt.powerNow, -1, 1); motorAt[i] = now; }
                for (int i = 0; i < motors.size(); i++) motors.get(i).setPower(motorCut[i] ? 0 : motorPower[i]);
                for (int i = 0; i < crservos.size(); i++) {
                    CRServo c = crservos.get(i);
                    boolean driven = crPower[i] != 0 || loopOn(true, i) != null || burstOn(i) != null;
                    if (c instanceof PwmControl) { PwmControl p = (PwmControl) c; if (driven && !p.isPwmEnabled()) p.setPwmEnable(); else if (!driven && p.isPwmEnabled()) p.setPwmDisable(); }
                    if (crTold[i] && driven) c.setPower(crPower[i]);
                }
                for (int i = 0; i < servos.size(); i++) {
                    Servo s = servos.get(i);
                    if (servoOn[i] && !Double.isNaN(servoPos[i])) { if (s instanceof PwmControl && !((PwmControl) s).isPwmEnabled()) ((PwmControl) s).setPwmEnable(); s.setPosition(servoPos[i]); }
                    else if (s instanceof PwmControl && ((PwmControl) s).isPwmEnabled()) ((PwmControl) s).setPwmDisable();
                }
                for (int i = 0; i < lights.size(); i++) if (lightOn[i] != lightSent[i]) { setLight(i, lightOn[i]); lightSent[i] = lightOn[i]; }
                // One motor's current and one I2C sensor a loop, in turn.
                if (!motors.isEmpty()) { int m = turn % motors.size(); motorAmps[m] = motors.get(m).getCurrent(CurrentUnit.AMPS); stall(m, now); }
                // The sensor an IMU turning reads is its own while it runs: it reads it far more often than this would.
                if (!i2c.isEmpty()) { int k = turn % i2c.size(); if (tt == null || k != tt.i2cIndex) { i2cLast[k] = i2cOn[k] == 0 || i2cOn[k] == -1 ? null : readI2c(k); i2cAt[k] = now; } }
                if (battery != null && turn % 25 == 0) volts12 = battery.getVoltage();
                turn++; loops++;
                long t = System.nanoTime();
                if (loops % 20 == 0) { loopMs = (t - loopStart) / 20e6; loopStart = t; loopMsNow = loopMs; }
                if (connected && now - lastFrame >= FRAME_MS) { lastFrame = now; latest.set(frame((t - start) / 1e6, loopMs, volts12, now)); synchronized (wake) { wake.notifyAll(); } }
                if (turn % 10 == 0) { telemetry.addData("Torque Debug", connected ? "Torque connected" : "Waiting for Torque on port " + PORT); telemetry.addData("Loop", "%.1f ms", loopMs); telemetry.update(); }
            }
        } finally {
            running = false; stopOutputs(true);
            for (int i = 0; i < motors.size(); i++) motors.get(i).setPower(0);
            for (int i = 0; i < crservos.size(); i++) if (crTold[i]) crservos.get(i).setPower(0);
            for (int i = 0; i < lights.size(); i++) if (lightSent[i]) setLight(i, false);
            closePortal();
            close();
        }
    }

    // ---- commands from Deck: a letter, then tab-separated fields
    //   P                         still here (feeds the watchdog)
    //   M name power              motor power, -1..1, for WATCHDOG_MS unless sent again (cancels a loop on it)
    //   C name power              continuous servo power, -1..1, the same
    //   S name position           servo position, 0..1 (turns its pulses on)
    //   E name 0|1                servo pulses off or on
    //   L name 0|1                latch: the servo keeps its position when the watchdog fires
    //   R name                    reset the motor's encoder to 0
    //   Q actuator sensor mode target kP kI kD kF kS kG tolerance wrap [izone zone pulse still lag scale]
    //                             run a loop here: actuator a motor or CR servo; sensor "enc:<motor>" or "ana:<analog>";
    //                             mode pos (target in ticks or volts) or vel (ticks a second); wrap > 0 takes the
    //                             shortest way round a circle of that many units; gains in power per raw unit
    //   T target                  move the running loop's target
    //   G name 0|1                a light off or on
    //   U job id tolerance top least slowFrom brake lag heading mount scale (motor power)...
    //                             IMU turning, run here (TorqueDebugTurn): job standard | aggressive (a tuning) or check (four
    //                             quarter turns by top..lag); heading imu:<name> or pin:<name>; mount L:<logo>:<usb> or
    //                             Q:w:x:y:z (how the hub sits, for the IMU); scale the heading's factor; then each drive motor
    //                             and its power for a turn to the left. Its state goes out in each frame as "tt".
    //   X                         stop: every output off, loops ended, servos limp unless latched
    //   V auto | V ms gain        the camera's exposure: automatic, or manual with a gain
    //   D decimation              how far the AprilTag processor reads against how fast
    //   K fx fy cx cy | K off     the lens numbers AprilTag uses, or the SDK's own: the camera opens again to take them
    //   W name                    open this webcam instead: only one is ever open
    void apply(String line) {
        String[] f = line.split("\t", -1);
        if (f.length == 0 || f[0].isEmpty()) return;
        try {
            switch (f[0]) {
                case "P": break;
                case "M": { int i = motorNames.indexOf(f[1]); if (i >= 0) { TorqueDebugTurn t = turnRunning(); if (t != null) for (int j : t.motors) if (j == i) t.stop(); endLoop(false, i); motorPower[i] = clamp(Double.parseDouble(f[2]), -1, 1); motorAt[i] = System.currentTimeMillis(); motorCut[i] = false; motorOverSince[i] = 0; } break; }
                case "B": startBurst(f); break;
                case "C": { int i = crNames.indexOf(f[1]); if (i >= 0) { endLoop(true, i); endBurst(i); crPower[i] = clamp(Double.parseDouble(f[2]), -1, 1); crAt[i] = System.currentTimeMillis(); crTold[i] = true; } break; }
                case "S": { int i = servoNames.indexOf(f[1]); if (i >= 0) { servoPos[i] = clamp(Double.parseDouble(f[2]), 0, 1); servoOn[i] = true; } break; }
                case "E": { int i = servoNames.indexOf(f[1]); if (i >= 0) servoOn[i] = "1".equals(f[2]) && !Double.isNaN(servoPos[i]); break; }
                case "L": { int i = servoNames.indexOf(f[1]); if (i >= 0) servoLatched[i] = "1".equals(f[2]); break; }
                case "R": { int i = motorNames.indexOf(f[1]); if (i >= 0) { DcMotorEx m = motors.get(i); m.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER); m.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER); } break; }
                case "G": { int i = lightNames.indexOf(f[1]); if (i >= 0) lightOn[i] = "1".equals(f[2]); break; }
                case "Q": startLoop(f); break;
                case "U": startTurn(f); break;
                case "T": if (loop != null) { loop.target = Double.parseDouble(f[1]); loop.integral = 0; loop.from = Double.NaN; loop.wait = 0; loop.fire = 0; loop.rest = false; } break;
                case "X": stopOutputs(false); break;
                case "V": case "D": case "K": case "W": cameraCommands.add(f); break;
                default: break;
            }
        } catch (RuntimeException ignored) { }
    }

    /** The U command: an IMU turning, on its own thread. One that cannot start says why in its state. */
    void startTurn(String[] f) {
        TorqueDebugTurn old = imuTurn; if (old != null) old.stop();
        String job = f[1]; int id = (int) Double.parseDouble(f[2]); double tol = clamp(Double.parseDouble(f[3]), 0.5, 10);
        String source = f[9], mount = f[10]; final double scale = Double.parseDouble(f[11]);
        final boolean pin = source.startsWith("pin:"); final String sensor = source.substring(4);
        int k = -1; for (int i = 0; i < i2c.size(); i++) if (i2cNames.get(i).equals(sensor) && i2cKinds.get(i).equals(pin ? "pinpoint" : "imu")) k = i;
        final HardwareDevice device = k < 0 ? null : i2c.get(k);
        final List<Integer> drive = new ArrayList<>(); final List<Double> powers = new ArrayList<>(); String missing = "";
        for (int i = 12; i + 1 < f.length; i += 2) { int m = motorNames.indexOf(f[i]); if (m < 0) missing = f[i]; else { drive.add(m); powers.add(clamp(Double.parseDouble(f[i + 1]), -1, 1)); } }
        final String[] mnt = mount.split(":");
        TorqueDebugTurnHub robot = new TorqueDebugTurnHub(this, device, pin, drive, mnt);
        TorqueDebugTurn t = new TorqueDebugTurn(robot, job, id, tol);
        t.top = clamp(Double.parseDouble(f[4]), 0.1, 1); t.least = clamp(Double.parseDouble(f[5]), 0.02, 0.3); t.slowFrom = clamp(Double.parseDouble(f[6]), 10, 180);
        t.brake = clamp(Double.parseDouble(f[7]), 0, 0.02); t.lag = clamp(Double.parseDouble(f[8]), 0, 0.3); t.scale = scale == 0 || Double.isNaN(scale) ? 1 : scale;
        t.i2cIndex = k; t.motors = new int[drive.size()]; t.powers = new double[drive.size()];
        for (int j = 0; j < drive.size(); j++) { t.motors[j] = drive.get(j); t.powers[j] = powers.get(j); }
        imuTurn = t;
        if (device == null || !missing.isEmpty() || drive.isEmpty()) { t.state = "problem: " + (device == null ? "No " + (pin ? "Pinpoint" : "IMU") + " called " + sensor + " in this configuration." : drive.isEmpty() ? "No drive motors were given." : "No motor called " + missing + " in this configuration."); t.finished = true; return; }
        Thread run = new Thread(t, "Torque IMU turning"); run.setDaemon(true); run.start();
    }
    /** Tells the IMU how the hub sits on the robot: L:<logo>:<usb> (the hub square to the robot) or Q:w:x:y:z (tilted, as Torque measured it). */
    static void mountImu(IMU imu, String[] m) {
        try {
            if (m.length >= 5 && "Q".equals(m[0])) imu.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(new org.firstinspires.ftc.robotcore.external.navigation.Quaternion(Float.parseFloat(m[1]), Float.parseFloat(m[2]), Float.parseFloat(m[3]), Float.parseFloat(m[4]), 0))));
            else imu.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(RevHubOrientationOnRobot.LogoFacingDirection.valueOf(m.length > 1 ? m[1] : "UP"), RevHubOrientationOnRobot.UsbFacingDirection.valueOf(m.length > 2 ? m[2] : "FORWARD"))));
        } catch (RuntimeException ignored) { }
    }

    void startLoop(String[] f) {
        TorqueDebugLoop l = new TorqueDebugLoop();
        l.actuator = f[1]; l.sensor = f[2]; l.mode = f[3];
        l.index = motorNames.indexOf(f[1]);
        if (l.index < 0) { l.index = crNames.indexOf(f[1]); l.cr = true; }
        if (l.index < 0) return;
        if (f[2].startsWith("ana:")) { l.analog = true; l.sensorIndex = analogNames.indexOf(f[2].substring(4)); }
        else l.sensorIndex = motorNames.indexOf(f[2].startsWith("enc:") ? f[2].substring(4) : f[1]);
        if (l.sensorIndex < 0) return;
        l.target = Double.parseDouble(f[4]); l.kP = Double.parseDouble(f[5]); l.kI = Double.parseDouble(f[6]); l.kD = Double.parseDouble(f[7]);
        l.kF = Double.parseDouble(f[8]); l.kS = Double.parseDouble(f[9]); l.kG = Double.parseDouble(f[10]); l.tol = Math.abs(Double.parseDouble(f[11])); l.wrap = Double.parseDouble(f[12]);
        l.izone = f.length > 13 ? Math.abs(Double.parseDouble(f[13])) : 0;
        // Swerve steering ("S" after the integral zone): each way (positive power, then negative) the seconds a command takes
        // to show, the creep power and its speed; then the speed gained per unit of power, top speed, the zone for pushes, the
        // speed a push from rest gives each way, the speed that counts as still, the seconds to wait for a push to show, and how
        // far out it eases to the creep. Speeds in sensor units a second.
        if (f.length > 28 && "S".equals(f[14])) {
            l.steer = true; l.leadP = clamp(Math.abs(Double.parseDouble(f[15])), .01, .25); l.leadN = clamp(Math.abs(Double.parseDouble(f[16])), .01, .25); l.cP = Math.abs(Double.parseDouble(f[17])); l.cN = Math.abs(Double.parseDouble(f[18]));
            l.vP = Math.abs(Double.parseDouble(f[19])); l.vN = Math.abs(Double.parseDouble(f[20])); l.slope = Math.max(1e-6, Math.abs(Double.parseDouble(f[21]))); l.vmax = Math.abs(Double.parseDouble(f[22]));
            l.zone = Math.abs(Double.parseDouble(f[23])); l.rP = Math.max(1e-6, Math.abs(Double.parseDouble(f[24]))); l.rN = Math.max(1e-6, Math.abs(Double.parseDouble(f[25]))); l.still = Math.abs(Double.parseDouble(f[26])); l.lag = Math.abs(Double.parseDouble(f[27])); l.ease = Math.abs(Double.parseDouble(f[28]));
        }
        if (l.cr) { crTold[l.index] = true; endBurst(l.index); } else { motorCut[l.index] = false; motorOverSince[l.index] = 0; }
        endLoop(l.cr, l.index);
        double[] learned = l.steer ? steerLearned.get(l.actuator) : null;
        if (learned != null) { l.gainP = learned[0]; l.gainN = learned[1]; }
        loops.add(l); loop = l;
    }

    /** The loop Deck asked for, one step: PID on the sensor's raw reading, plus feedforward (kF for speed, kS against friction, kG against gravity). */
    void runLoop() { for (TorqueDebugLoop l : loops) stepLoop(l); }
    void stepLoop(TorqueDebugLoop l) {
        boolean vel = "vel".equals(l.mode);
        double measured = l.analog ? analogs.get(l.sensorIndex).getVoltage() : vel ? motors.get(l.sensorIndex).getVelocity() : motors.get(l.sensorIndex).getCurrentPosition();
        double e = l.target - measured;
        if (l.wrap > 0) { e %= l.wrap; if (e > l.wrap / 2) e -= l.wrap; if (e < -l.wrap / 2) e += l.wrap; }
        if (l.steer && !vel) {
            // The loop runs as fast as the hub answers (about 13 ms a turn, not a fixed step): the law is given the time that really passed.
            long now = System.nanoTime(); double step = l.lastNanos == 0 ? FRAME_MS / 1000.0 : (now - l.lastNanos) / 1e9; l.lastNanos = now;
            l.out = steer(l, e, measured, step); l.error = e; if (l.cr) crPower[l.index] = l.out; else motorPower[l.index] = l.out; return;
        }
        double dt = FRAME_MS / 1000.0, d = Double.isNaN(l.last) ? 0 : (e - l.last) / dt;
        l.last = e;
        // With an integral zone (izone > 0, a position loop): the integral only builds within it, so a long turn does not wind it
        // up, and it starts again from 0 inside the tolerance or once the reading crosses the target. Without one, as before.
        if (l.izone > 0 && !vel) {
            if (Math.abs(e) <= l.tol || (!Double.isNaN(l.lastE) && Math.signum(e) != Math.signum(l.lastE))) l.integral = 0;
            else if (Math.abs(e) < l.izone) l.integral = clamp(l.integral + e * dt, -1e6, 1e6);
        } else l.integral = clamp(l.integral + e * dt, -1e6, 1e6);
        l.lastE = e;
        double out = l.kP * e + l.kI * l.integral + l.kD * d + l.kG;
        if (vel) out += l.kF * l.target + l.kS * Math.signum(l.target);
        else if (Math.abs(e) > l.tol) out += l.kS * Math.signum(e);
        l.out = clamp(out, -1, 1); l.error = e;
        if (l.cr) crPower[l.index] = l.out; else motorPower[l.index] = l.out;
    }

    static double wrapOf(double x, double wrap) { if (!(wrap > 0)) return x; x %= wrap; if (x > wrap / 2) x -= wrap; if (x < -wrap / 2) x += wrap; return x; }
    /**
     * One step of turning a swerve pod to its angle (ui/sim-chassis-cal.js steerStep is the reference, step for step).
     * A continuous servo is a speed, not a force: it turns only past a start power that differs each way, tops out at a speed,
     * and does what it is told about lead seconds later (a different time each way); it slows only when its power goes to
     * nothing (it brakes), and from a standstill it lurches rather than creeps. So, from outside the zone, an approach: the speed
     * asked for only ever goes up (K times the distance left once the commands still on their way have played out, full power
     * when far), then the power is cut at the point from which the wheel stops a little short of the target. What is left is
     * done with pushes: the creep power for the distance over the speed a push from rest really gives, then off until the wheel
     * has moved and stopped; what each push did corrects the next. Inside the tolerance the power is off, and once at rest it
     * stays off until the reading is clearly out again. A wheel that gets nowhere gets more creep power that way until it moves
     * on, and gives it back as it does.
     */
    static final int PIPE = 128;
    double steer(TorqueDebugLoop l, double e, double measured, double dt) {
        double g = l.kP < 0 ? -1 : 1, K = Math.abs(l.kP);
        dt = clamp(dt, .002, .1); l.st += dt;
        // The middle of the last three readings: one wild reading (a motor starting disturbs the encoder's voltage) is dropped.
        if (l.rawN < 3) l.raw[l.rawN++] = measured; else { l.raw[0] = l.raw[1]; l.raw[1] = l.raw[2]; l.raw[2] = measured; }
        double off = 0;
        if (l.rawN == 3) { double a0 = wrapOf(l.raw[0] - measured, l.wrap), b0 = wrapOf(l.raw[1] - measured, l.wrap); off = Math.max(Math.min(a0, b0), Math.min(Math.max(a0, b0), 0)); }
        double m = measured + off, ef = wrapOf(e - off, l.wrap), a = Math.abs(ef), dir = ef < 0 ? -1 : 1;
        if (l.hN < 5) { l.hT[l.hN] = l.st; l.hM[l.hN++] = m; } else { for (int i = 0; i < 4; i++) { l.hT[i] = l.hT[i + 1]; l.hM[i] = l.hM[i + 1]; } l.hT[4] = l.st; l.hM[4] = m; }
        l.speed = l.hN < 3 ? 0 : Math.abs(wrapOf(m - l.hM[0], l.wrap)) / (l.st - l.hT[0]);
        // What the commands still on their way will add. A command shows lead seconds after it is given and lasts until the next
        // step, so the last one goes on the list now, with the time it really lasted: when it starts to show, when it has all
        // shown, how far it carries the wheel.
        if (l.cmdV != 0) {
            if (l.pipeN == PIPE) { l.pipeHead = (l.pipeHead + 1) % PIPE; l.pipeN--; }
            int at = (l.pipeHead + l.pipeN) % PIPE; l.pipeFrom[at] = l.st - dt + l.cmdLead; l.pipeAt[at] = l.st + l.cmdLead; l.pipeV[at] = l.cmdV * dt; l.pipeN++; l.cmdV = 0;
        }
        while (l.pipeN > 0 && l.pipeAt[l.pipeHead] <= l.st) { l.pipeHead = (l.pipeHead + 1) % PIPE; l.pipeN--; }
        double trav = 0; int coming = 0;
        for (int i = 0; i < l.pipeN; i++) { int j = (l.pipeHead + i) % PIPE; if (l.pipeAt[j] > l.st) { trav += l.pipeV[j] * Math.min(1, (l.pipeAt[j] - l.st) / (l.pipeAt[j] - l.pipeFrom[j])); coming++; } }
        boolean idle = coming == 0 && l.speed <= l.still;
        // Where an approach's braking stop left the wheel: short of the target (+) or past it (-). The tuner sets lead by it.
        if (l.pend != 0 && idle) { l.stops++; l.stopErr = dir == l.pend ? a : -a; l.stopWay = g * l.pend; l.stopFull = l.pendFull; l.pend = 0; }
        if (l.rest) { if (a <= l.tol * 1.6) return 0; l.rest = false; }
        // Inside the tolerance the power is off. It is at rest once it has stayed there, stopped, for 80 ms: a push that only
        // springs the pod (it comes back) or shifts the reading does not count as arriving.
        if (a <= l.tol) { l.fire = 0; l.tryT = 0; l.tryM = Double.NaN; l.inT += dt; if (idle && l.inT >= .08) { l.rest = true; l.wait = 0; l.from = Double.NaN; } return 0; }
        // Stopped a little outside the tolerance but well inside what is allowed (the tolerance is 0.6 of that): left alone. A
        // push from a standstill is a lurch, and would as likely knock it out as bring it in.
        if (a <= l.tol * 1.35 && idle && l.fire <= 0 && l.wait <= 0) { l.tryT = 0; l.tryM = Double.NaN; l.inT += dt; if (l.inT >= .08) { l.rest = true; l.from = Double.NaN; } return 0; }
        l.inT = 0;
        // Outside the zone it is an approach. An approach gets one run in: once it has cut its power near the target, what is
        // left is done with pushes from a standstill.
        if (a > l.zone) { l.wait = 0; l.fire = 0; l.from = Double.NaN; if (!l.run) { l.vm = 0; l.runT = 0; } l.run = true; }
        // A push under way: the rest of it, then power off until the wheel has moved and stopped (or lag passes with nothing).
        if (l.fire > 0) { l.fire -= dt; return g * l.fireDir * l.firePow; }
        if (l.wait > 0) { l.wait -= dt; l.lagLeft -= dt; if (l.speed > l.still) l.moved = true; if (l.wait > 0 && (l.moved ? l.speed > l.still : l.lagLeft > 0)) return 0; l.wait = 0; }
        if (idle && a <= l.zone) {
            // Stopped a little off: a push. From a standstill a pod does not creep, it lurches, further than its steady speed
            // says, so the push is the creep power for a time: the distance over the speed a push from rest really gives. What
            // the last push did corrects that for next time, each way.
            boolean pos = g * dir > 0;
            if (!Double.isNaN(l.from)) {
                double went = l.fireDir * wrapOf(m - l.from, l.wrap); boolean wasPos = g * l.fireDir > 0; double gain = wasPos ? l.gainP : l.gainN;
                // Nothing moved (a sticky spot): more power and a little longer. It moved: half of that extra power back, and
                // further or less far than aimed makes the next one shorter or longer in proportion.
                if (went < l.tol * .25) { if (wasPos) l.boostP = Math.min(.25, l.boostP + .025); else l.boostN = Math.min(.25, l.boostN + .025); gain = Math.max(.25, gain * .8); }
                else { if (wasPos) l.boostP *= .5; else l.boostN *= .5; gain = Math.max(.25, Math.min(4, gain * Math.pow(Math.max(.5, Math.min(2, went / l.aim)), .7))); }
                if (wasPos) l.gainP = gain; else l.gainN = gain;
            }
            double want = (a - l.tol * .3) / (pos ? l.rP * l.gainP : l.rN * l.gainN), time = Math.max(.006, Math.min(.12, want));
            l.tryT = 0; l.tryM = Double.NaN; l.from = m; l.aim = a - l.tol * .3; l.fireDir = dir; l.firePow = Math.min(1, pos ? l.cP + l.boostP : l.cN + l.boostN); l.fire = time - dt; l.wait = l.lag + .4; l.lagLeft = l.lag; l.moved = false;
            return g * dir * l.firePow;
        }
        // The approach. A continuous servo slows down only when its power goes to nothing (it brakes); given less power it just
        // runs on. So the speed asked for only ever goes up (K times the distance left once the commands on their way have
        // played out, full power when far), and then the power is cut, at the point from which the wheel stops a little short
        // of the target (ease): a push finishes it. Stopping short is cheap; going past means coming back.
        l.from = Double.NaN; double ap = ef - trav, A = Math.abs(ap), D = ap < 0 ? -1 : 1; boolean pos = g * D > 0; double lead = pos ? l.leadP : l.leadN;
        // Trying for longer than a command takes to show with nothing to show for it: this spot takes more power than was
        // measured, so the creep gets more, that way only, until the wheel moves on; each tolerance of progress takes some back.
        if (Double.isNaN(l.tryM) || Math.abs(wrapOf(m - l.tryM, l.wrap)) > l.tol) { if (!Double.isNaN(l.tryM)) { l.boostP *= .85; l.boostN *= .85; } l.tryM = m; l.tryT = 0; }
        l.tryT += dt;
        if (!l.run) return 0;
        if (A <= l.ease || D != dir) { if (l.runDir != 0) { l.pend = l.runDir; l.pendFull = l.vm >= l.vmax * .97; } l.run = false; l.vm = 0; l.runDir = 0; return 0; }
        if (l.tryT > lead + .08) { if (pos) l.boostP = Math.min(.25, l.boostP + .4 * dt); else l.boostN = Math.min(.25, l.boostN + .4 * dt); }
        double c = pos ? l.cP : l.cN, vc = pos ? l.vP : l.vN; l.vm = Math.max(l.vm, Math.min(l.vmax, Math.max(vc, K * (A - l.ease)))); boolean full = l.vm >= l.vmax * .97;
        double u = full ? 1 : Math.min(1, c + (pos ? l.boostP : l.boostN) + (l.vm - vc) / l.slope);
        // A crawling wheel stops almost where it is when the power goes; from a sixth of top speed up it runs on for the whole lead.
        l.runDir = D; l.runT += dt; l.cmdV = D * (full ? l.vmax : l.vm); l.cmdLead = lead * Math.max(.3, Math.min(1, l.vm / (l.vmax * .17)));
        return g * D * u;
    }

    void stall(int m, long now) {
        if (Math.abs(motorPower[m]) > 0.05 && motorAmps[m] > STALL_AMPS) { if (motorOverSince[m] == 0) motorOverSince[m] = now; else if (now - motorOverSince[m] > STALL_MS) { motorCut[m] = true; endLoop(false, m); } }
        else motorOverSince[m] = 0;
    }

    void stopOutputs(boolean all) {
        loop = null; loops.clear(); bursts.clear();
        TorqueDebugTurn t = imuTurn; if (t != null) t.stop();
        java.util.Arrays.fill(motorPower, 0);
        java.util.Arrays.fill(crPower, 0);
        java.util.Arrays.fill(lightOn, false);
        for (int i = 0; i < servos.size(); i++) if (all || !servoLatched[i]) servoOn[i] = false;
    }

    void setLight(int i, boolean on) {
        HardwareDevice d = lights.get(i);
        try { if (d instanceof LED) ((LED) d).enable(on); else if (d instanceof RevBlinkinLedDriver) ((RevBlinkinLedDriver) d).setPattern(on ? RevBlinkinLedDriver.BlinkinPattern.WHITE : RevBlinkinLedDriver.BlinkinPattern.BLACK); else if (on) call(d, "setColor", 0xFFFFFFFF); else call(d, "turnAllOff"); } catch (RuntimeException ignored) { }
    }

    // ---- what is really plugged in
    static Matcher placeOf(HardwareDevice d) {
        try { Matcher m = I2C_PLACE.matcher(String.valueOf(d.getConnectionInfo())); return m.find() ? m : null; } catch (RuntimeException e) { return null; }
    }

    static boolean busy(LynxNackException e) {
        LynxNack.StandardReasonCode why = e.getNack().getNackReasonCodeAsEnum();
        return why == LynxNack.StandardReasonCode.I2C_MASTER_BUSY || why == LynxNack.StandardReasonCode.I2C_OPERATION_IN_PROGRESS;
    }

    /** The hub reads one byte from the address: only a device that is there can acknowledge it. */
    boolean answers(LynxModule hub, int bus, int address) throws InterruptedException {
        I2cAddr at = I2cAddr.create7bit(address);
        try {
            return hub.acquireI2cLockWhile(() -> {
                for (;;) { try { new LynxI2cReadSingleByteCommand(hub, bus, at).send(); break; } catch (LynxNackException e) { if (!busy(e)) throw e; } }
                for (;;) { try { return new LynxI2cReadStatusQueryCommand(hub, bus, 1).sendReceive().getBytes().length == 1; } catch (LynxNackException e) { if (!busy(e)) return false; } }
            });
        } catch (LynxNackException | RobotCoreException | RuntimeException e) { return false; }
    }

    double portVolts(LynxModule hub, int port) throws InterruptedException {
        try { return new LynxGetADCCommand(hub, LynxGetADCCommand.Channel.user(port), LynxGetADCCommand.Mode.ENGINEERING).sendReceive().getValue() / 1000.0; } catch (LynxNackException | RuntimeException e) { return Double.NaN; }
    }

    void watchHub() {
        int count = I2C_LAST - I2C_FIRST + 1, total = hubs.size() * I2C_BUSES * count, next = 0, beat = 0;
        boolean[][][] wanted = new boolean[hubs.size()][I2C_BUSES][128], found = new boolean[hubs.size()][I2C_BUSES][128];
        double[][] volts = new double[hubs.size()][ANALOG_PORTS];
        for (double[] v : volts) Arrays.fill(v, Double.NaN);
        for (int[] p : i2cPlace) if (p != null && p[1] < I2C_BUSES) wanted[p[0]][p[1]][p[2]] = true;
        boolean swept = false;
        try {
            while (running) {
                for (int h = 0; h < hubs.size(); h++) for (int bus = 0; bus < I2C_BUSES; bus++) for (int a = 0; a < 128; a++) if (wanted[h][bus][a] || found[h][bus][a]) found[h][bus][a] = answers(hubs.get(h), bus, a);
                if (beat++ % ANALOG_EVERY == 0) for (int h = 0; h < hubs.size(); h++) for (int port = 0; port < ANALOG_PORTS; port++) volts[h][port] = portVolts(hubs.get(h), port);
                int[] on = i2cOn.clone();
                for (int k = 0; k < on.length; k++) {
                    int[] p = i2cPlace[k];
                    if (p == null || p[1] >= I2C_BUSES) continue;
                    int now = found[p[0]][p[1]][p[2]] ? 1 : 0;
                    // Plugged in after the robot started: the SDK tried to set it up then, and could not.
                    if (on[k] == 0 && now == 1 && i2c.get(k) instanceof I2cDeviceSynchDevice && !"imu".equals(i2cKinds.get(k))) { try { ((I2cDeviceSynchDevice<?>) i2c.get(k)).initialize(); } catch (RuntimeException ignored) { } }
                    on[k] = now;
                }
                i2cOn = on;
                hubWatch = hubWatchJson(on, found, volts, swept);
                for (int n = swept ? I2C_SWEEP_EACH : total; n > 0 && running; n--, next = (next + 1) % total) {
                    int a = next % count, bus = next / count % I2C_BUSES, h = next / count / I2C_BUSES;
                    found[h][bus][I2C_FIRST + a] = answers(hubs.get(h), bus, I2C_FIRST + a);
                }
                if (!swept) { swept = true; hubWatch = hubWatchJson(on, found, volts, true); }
                Thread.sleep(WATCH_MS);
            }
        } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }

    String hubWatchJson(int[] on, boolean[][][] found, double[][] volts, boolean swept) {
        StringBuilder b = new StringBuilder(",\"on\":[");
        for (int k = 0; k < on.length; k++) { if (k > 0) b.append(','); b.append(on[k] == -2 ? "null" : String.valueOf(on[k])); }
        b.append("],\"b\":[");
        for (int h = 0; h < hubs.size(); h++) {
            if (h > 0) b.append(',');
            b.append("{\"h\":").append(hubs.get(h).getModuleAddress()).append(",\"swept\":").append(swept).append(",\"found\":[");
            for (int bus = 0; bus < I2C_BUSES; bus++) { if (bus > 0) b.append(','); b.append('['); boolean first = true; for (int a = 0; a < 128; a++) if (found[h][bus][a]) { if (!first) b.append(','); first = false; b.append(a); } b.append(']'); }
            b.append("],\"a\":[");
            for (int port = 0; port < ANALOG_PORTS; port++) { if (port > 0) b.append(','); b.append(num(volts[h][port])); }
            b.append("]}");
        }
        return b.append(']').toString();
    }

    // ---- readings
    String readI2c(int k) {
        HardwareDevice d = i2c.get(k);
        try {
            StringBuilder b = new StringBuilder("{");
            switch (i2cKinds.get(k)) {
                case "imu": {
                    IMU imu = (IMU) d; YawPitchRollAngles a = imu.getRobotYawPitchRollAngles(); AngularVelocity w = imu.getRobotAngularVelocity(AngleUnit.DEGREES);
                    put(b, "yaw", a.getYaw(AngleUnit.DEGREES)); put(b, "pitch", a.getPitch(AngleUnit.DEGREES)); put(b, "roll", a.getRoll(AngleUnit.DEGREES)); put(b, "wx", w.xRotationRate); put(b, "wy", w.yRotationRate); put(b, "wz", w.zRotationRate);
                    break;
                }
                case "pinpoint": {
                    GoBildaPinpointDriver p = (GoBildaPinpointDriver) d; p.update();
                    put(b, "x", p.getPosX(DistanceUnit.MM)); put(b, "y", p.getPosY(DistanceUnit.MM)); put(b, "h", p.getHeading(AngleUnit.DEGREES)); put(b, "ex", p.getEncoderX()); put(b, "ey", p.getEncoderY()); put(b, "status", String.valueOf(p.getDeviceStatus()));
                    put(b, "vx", call(p, "getVelX", DistanceUnit.MM)); put(b, "vy", call(p, "getVelY", DistanceUnit.MM)); put(b, "vh", call(p, "getHeadingVelocity", UnnormalizedAngleUnit.DEGREES)); put(b, "rate", call(p, "getFrequency"));
                    break;
                }
                case "otos": {
                    SparkFunOTOS o = (SparkFunOTOS) d; SparkFunOTOS.Pose2D p = o.getPosition();
                    put(b, "x", p.x); put(b, "y", p.y); put(b, "h", p.h);
                    Object v = call(o, "getVelocity"), c = call(o, "getAcceleration");
                    put(b, "vx", field(v, "x")); put(b, "vy", field(v, "y")); put(b, "vh", field(v, "h")); put(b, "ax", field(c, "x")); put(b, "ay", field(c, "y")); put(b, "ah", field(c, "h"));
                    break;
                }
                case "color": {
                    NormalizedRGBA c = ((NormalizedColorSensor) d).getNormalizedColors();
                    put(b, "r", c.red); put(b, "g", c.green); put(b, "b", c.blue); put(b, "a", c.alpha);
                    if (d instanceof DistanceSensor) put(b, "d", ((DistanceSensor) d).getDistance(DistanceUnit.CM));
                    break;
                }
                case "distance": put(b, "d", ((DistanceSensor) d).getDistance(DistanceUnit.CM)); break;
                default: readOther(b, d); break;
            }
            return b.append('}').toString();
        } catch (RuntimeException e) { return "{\"error\":" + str(e.getClass().getSimpleName()) + "}"; }
    }

    /** Every other I2C driver in the SDK, by what it can do: docs/I2C-DEVICES.md lists them. By name, since which of them a robot has depends on its SDK, and one missing must not stop this file building. */
    void readOther(StringBuilder b, HardwareDevice d) {
        Object turned = call(d, "getAngularOrientation", AxesReference.INTRINSIC, AxesOrder.ZYX, AngleUnit.DEGREES), rate = call(d, "getAngularVelocity", AngleUnit.DEGREES), push = call(d, "getAcceleration");
        put(b, "yaw", field(turned, "firstAngle")); put(b, "pitch", field(turned, "secondAngle")); put(b, "roll", field(turned, "thirdAngle")); put(b, "wx", field(rate, "xRotationRate")); put(b, "wy", field(rate, "yRotationRate")); put(b, "wz", field(rate, "zRotationRate"));
        put(b, "gx", field(push, "xAccel")); put(b, "gy", field(push, "yAccel")); put(b, "gz", field(push, "zAccel"));
        put(b, "dir", call(d, "getDirection")); put(b, "angle", call(d, "getAngle")); put(b, "strength", call(d, "getStrength")); put(b, "signal", call(d, "signalDetected"));
        put(b, "light", call(d, "getLightDetected")); put(b, "d", call(d, "getDistanceAsync", DistanceUnit.CM));
        Object seen = call(d, "blocks"), arrows = call(d, "arrows"), encoders = call(d, "readAllEncoderData");
        if (seen instanceof Object[]) { Object[] list = (Object[]) seen; put(b, "blocks", list.length); if (list.length > 0) { put(b, "id", field(list[0], "id")); put(b, "x", field(list[0], "x")); put(b, "y", field(list[0], "y")); put(b, "w", field(list[0], "width")); put(b, "t", field(list[0], "height")); } }
        if (arrows instanceof Object[]) put(b, "arrows", ((Object[]) arrows).length);
        Object at = field(encoders, "positions"), speed = field(encoders, "velocities");
        if (at instanceof int[]) { int[] list = (int[]) at; for (int i = 0; i < list.length; i++) put(b, "e" + i, list[i]); }
        if (speed instanceof short[]) { short[] list = (short[]) speed; for (int i = 0; i < list.length; i++) put(b, "s" + i, list[i]); }
    }

    static final Map<String, Method> METHODS = new HashMap<>();
    /** What a device answers when asked by name, or null when it has no such thing or the asking fails. */
    static Object call(Object o, String name, Object... args) {
        if (o == null) return null;
        String key = o.getClass().getName() + "." + name + "/" + args.length;
        try {
            if (!METHODS.containsKey(key)) {
                Method found = null;
                for (Method m : o.getClass().getMethods()) {
                    if (!m.getName().equals(name) || m.getParameterTypes().length != args.length) continue;
                    boolean fits = true;
                    for (int i = 0; i < args.length; i++) if (!m.getParameterTypes()[i].isPrimitive() && !m.getParameterTypes()[i].isInstance(args[i])) fits = false;
                    if (fits) { found = m; break; }
                }
                METHODS.put(key, found);
            }
            Method m = METHODS.get(key);
            return m == null ? null : m.invoke(o, args);
        } catch (ReflectiveOperationException | RuntimeException e) { return null; }
    }

    static void put(StringBuilder b, String key, Object v) {
        if (v == null) return;
        if (b.length() > 1) b.append(',');
        b.append(str(key)).append(':');
        if (v instanceof Number) b.append(num(((Number) v).doubleValue())); else if (v instanceof Boolean) b.append(v); else b.append(str(String.valueOf(v)));
    }

    String frame(double t, double loopMs, double volts, long now) {
        StringBuilder b = new StringBuilder(512);
        b.append("{\"t\":").append(num(t)).append(",\"loop\":").append(num(loopMs)).append(",\"v\":").append(num(volts)).append(",\"m\":[");
        for (int i = 0; i < motors.size(); i++) { DcMotorEx m = motors.get(i); if (i > 0) b.append(','); b.append('[').append(m.getCurrentPosition()).append(',').append(num(m.getVelocity())).append(',').append(num(motorCut[i] ? 0 : motorPower[i])).append(',').append(num(motorAmps[i])).append(',').append(motorCut[i] ? 1 : 0).append(']'); }
        b.append("],\"s\":[");
        for (int i = 0; i < servos.size(); i++) { if (i > 0) b.append(','); b.append('[').append(num(servoPos[i])).append(',').append(servoOn[i] ? 1 : 0).append(',').append(servoLatched[i] ? 1 : 0).append(']'); }
        b.append("],\"c\":[");
        for (int i = 0; i < crservos.size(); i++) { if (i > 0) b.append(','); b.append(num(crPower[i])); }
        b.append("],\"d\":[");
        for (int i = 0; i < digitals.size(); i++) { if (i > 0) b.append(','); b.append(digitals.get(i).getState() ? 1 : 0); }
        b.append("],\"touch\":[");
        for (int i = 0; i < touches.size(); i++) { if (i > 0) b.append(','); b.append(touches.get(i).isPressed() ? 1 : 0); }
        b.append("],\"l\":[");
        for (int i = 0; i < lights.size(); i++) { if (i > 0) b.append(','); b.append(lightOn[i] ? 1 : 0); }
        b.append("],\"a\":[");
        for (int i = 0; i < analogs.size(); i++) { if (i > 0) b.append(','); b.append(num(analogs.get(i).getVoltage())); }
        b.append("],\"i\":[");
        for (int i = 0; i < i2c.size(); i++) { if (i > 0) b.append(','); b.append("{\"age\":").append(i2cLast[i] == null ? "null" : String.valueOf(now - i2cAt[i])).append(",\"v\":").append(i2cLast[i] == null ? "null" : i2cLast[i]).append('}'); }
        b.append(']').append(hubWatch);
        TorqueDebugLoop l = loop;
        if (l != null) b.append(",\"q\":{\"actuator\":").append(str(l.actuator)).append(",\"target\":").append(num(l.target)).append(",\"error\":").append(num(l.error)).append(",\"out\":").append(num(l.out)).append('}');
        if (!bursts.isEmpty()) { b.append(",\"bu\":["); boolean first = true; for (TorqueDebugBurst x : bursts) { if (!first) b.append(','); first = false; b.append("{\"a\":").append(str(x.actuator)).append(",\"n\":").append(x.id).append(",\"done\":").append(x.phase == 2 ? 1 : 0).append(",\"v\":").append(num(x.speed)).append(",\"c\":").append(num(x.coast)).append(",\"d\":").append(num(x.delay)).append(",\"t\":").append(num(x.travel)).append('}'); } b.append(']'); }
        if (!loops.isEmpty()) { b.append(",\"ql\":["); boolean first = true; for (TorqueDebugLoop x : loops) { if (!first) b.append(','); first = false; b.append("{\"a\":").append(str(x.actuator)).append(",\"e\":").append(num(x.error)).append(",\"o\":").append(num(x.out)).append(",\"s\":").append(num(x.speed)); if (x.steer) b.append(",\"b\":[").append(num(x.boostP)).append(',').append(num(x.boostN)).append(',').append(num(x.gainP)).append(',').append(num(x.gainN)).append("],\"x\":[").append(x.stops).append(',').append(num(x.stopErr)).append(',').append(num(x.stopWay)).append(',').append(x.stopFull ? 1 : 0).append(']'); b.append('}'); } b.append(']'); }
        TorqueDebugTurn tt = imuTurn;
        if (tt != null) b.append(",\"tt\":").append(tt.json());
        if (!webcams.isEmpty()) { if (camLast == null || now - camAt >= 100) { camLast = cameraJson(); camAt = now; } b.append(",\"cam\":").append(camLast); }
        return b.append('}').toString();
    }

    // ---- the camera. Its controls can take a moment and need a streaming camera, so a thread of its own sets them.
    void startCamera() {
        if (webcams.isEmpty()) return;
        tryOpenCamera();
        Thread t = new Thread(this::cameraThread, "Torque Debug camera"); t.setDaemon(true); t.start();
    }
    void tryOpenCamera() {
        try { openCamera(); }
        catch (RuntimeException e) { cameraError = String.valueOf(e.getMessage()); portal = null; aprilTag = null; }
    }
    // AprilTag takes its lens numbers only as it is built.
    void openCamera() {
        cameraError = null;
        double[] lens = camLens;
        AprilTagProcessor.Builder tags = new AprilTagProcessor.Builder();
        if (lens != null) tags.setLensIntrinsics(lens[0], lens[1], lens[2], lens[3]);
        aprilTag = tags.build();
        VisionPortal.Builder builder = new VisionPortal.Builder().setCamera(webcams.get(camIndex)).addProcessor(aprilTag);
        // Otherwise the SDK writes its version and frame rate across the picture. By name, so that an SDK without it still builds this file.
        try { VisionPortal.Builder.class.getMethod("setShowStatsOverlay", boolean.class).invoke(builder, false); } catch (ReflectiveOperationException | RuntimeException ignored) { }
        portal = builder.build();
    }
    // Stopping can come while the camera thread opens a new portal. Whichever thread is last closes whichever portal is current, so none keeps the camera after the op mode ends.
    void closePortal() {
        synchronized (portalLock) {
            VisionPortal open = portal;
            if (open == null || open == closedPortal) return;
            closedPortal = open;
            open.close();
        }
    }
    // Many cheap cameras have no gain control: their exposure still works, and the range says so with 0,0.
    String gainRange(GainControl gain) { try { return gain.getMinGain() + "," + gain.getMaxGain(); } catch (RuntimeException e) { return "0,0"; } }
    void setGain(GainControl gain, int g) { try { gain.setGain(g); camGain = g; } catch (RuntimeException ignored) { } }
    /** What the camera itself says now: asking for an exposure does not prove it took. */
    void exposureRead(ExposureControl exposure) { try { camExposureRead = exposure.getExposure(TimeUnit.MILLISECONDS); } catch (RuntimeException e) { camExposureRead = Double.NaN; } }
    static String exposureModes(ExposureControl exposure) {
        StringBuilder b = new StringBuilder("[");
        for (ExposureControl.Mode m : ExposureControl.Mode.values()) if (m != ExposureControl.Mode.Unknown && exposure.isModeSupported(m)) { if (b.length() > 1) b.append(','); b.append(str(m.name())); }
        return b.append(']').toString();
    }
    /** Many webcams call their automatic exposure aperture priority. Null: this one has none. */
    static ExposureControl.Mode automatic(ExposureControl exposure) {
        for (ExposureControl.Mode m : new ExposureControl.Mode[] { ExposureControl.Mode.ContinuousAuto, ExposureControl.Mode.Auto, ExposureControl.Mode.AperturePriority }) if (exposure.isModeSupported(m)) return m;
        return null;
    }
    boolean streaming() { VisionPortal open = portal; return open != null && open.getCameraState() == VisionPortal.CameraState.STREAMING; }
    /** A lens or a camera: what opens the camera again. False: this line is neither, or changes nothing. */
    boolean takeReopen(String[] f) {
        if ("K".equals(f[0])) camLens = "off".equals(f[1]) ? null : new double[] { Double.parseDouble(f[1]), Double.parseDouble(f[2]), Double.parseDouble(f[3]), Double.parseDouble(f[4]) };
        else if ("W".equals(f[0])) {
            int i = webcamNames.indexOf(f[1]);
            if (i < 0) { cameraError = "The configuration has no webcam named " + f[1]; return false; }
            if (i == camIndex && portal != null) return false;
            camIndex = i;
        }
        else return false;
        return true;
    }
    /** While a camera is not streaming, one that cannot open (its cable, say) must not stop another being asked for. */
    boolean reopenAsked() {
        for (Iterator<String[]> it = cameraCommands.iterator(); it.hasNext(); ) {
            String[] f = it.next();
            if (!"K".equals(f[0]) && !"W".equals(f[0])) continue;
            it.remove();
            try { if (takeReopen(f)) return true; } catch (RuntimeException e) { cameraError = String.valueOf(e.getMessage()); }
        }
        return false;
    }
    void cameraThread() {
        try {
            boolean reopened = false;
            while (running) {
                boolean reopen = false;
                while (running && !reopen && !streaming()) { reopen = reopenAsked(); if (!reopen) Thread.sleep(50); }
                if (!running) return;
                if (!reopen) {
                    ExposureControl exposure = portal.getCameraControl(ExposureControl.class);
                    GainControl gain = portal.getCameraControl(GainControl.class);
                    cameraRange = "[" + exposure.getMinExposure(TimeUnit.MILLISECONDS) + "," + exposure.getMaxExposure(TimeUnit.MILLISECONDS) + "," + gainRange(gain) + "]";
                    camModes = exposureModes(exposure);
                    exposureRead(exposure);
                    if (reopened) {
                        try {
                            aprilTag.setDecimation((float) camDecimation);
                            if (!Double.isNaN(camExposure)) { exposure.setMode(ExposureControl.Mode.Manual); Thread.sleep(50); exposure.setExposure((long) camExposure, TimeUnit.MILLISECONDS); Thread.sleep(20); setGain(gain, (int) camGain); }
                        } catch (RuntimeException e) { cameraError = String.valueOf(e.getMessage()); }
                    }
                    camOpening = false;
                    while (running && !reopen) {
                        String[] f = cameraCommands.poll();
                        if (f == null) { Thread.sleep(20); continue; }
                        try {
                            if ("K".equals(f[0]) || "W".equals(f[0])) reopen = takeReopen(f);
                            else if ("D".equals(f[0])) { camDecimation = Double.parseDouble(f[1]); aprilTag.setDecimation((float) camDecimation); }
                            else if ("auto".equals(f[1])) { ExposureControl.Mode auto = automatic(exposure); boolean took = auto != null && exposure.setMode(auto); camExposure = Double.NaN; camGain = Double.NaN; cameraError = took ? null : "This camera has no automatic exposure."; Thread.sleep(50); exposureRead(exposure); }
                            else {
                                boolean manual = exposure.getMode() == ExposureControl.Mode.Manual;
                                if (!manual) { manual = exposure.setMode(ExposureControl.Mode.Manual); Thread.sleep(50); }
                                long ms = Long.parseLong(f[1]); int g = Integer.parseInt(f[2]);
                                boolean took = exposure.setExposure(ms, TimeUnit.MILLISECONDS); Thread.sleep(20); setGain(gain, g); camExposure = ms;
                                cameraError = manual && took ? null : "This camera did not take a manual exposure of " + ms + " ms.";
                                exposureRead(exposure);
                            }
                        } catch (RuntimeException e) { cameraError = String.valueOf(e.getMessage()); }
                    }
                }
                if (!running) return;
                camOpening = true;
                closePortal();
                Thread.sleep(500);
                if (!running) return;
                tryOpenCamera();
                if (!running) { closePortal(); return; }
                reopened = true;
            }
        } catch (InterruptedException ignored) {
        } catch (RuntimeException e) { cameraError = String.valueOf(e.getMessage()); camOpening = false; }
    }
    /** SDK 12.0 moved id, decisionMargin and metadata from AprilTagDetection down to its subclasses; older SDKs have them on it. By name, this one file builds on both. Null: this kind of detection has none. */
    static Object field(Object from, String name) {
        if (from == null) return null;
        try { return from.getClass().getField(name).get(from); }
        catch (ReflectiveOperationException | RuntimeException e) { return null; }
    }
    String cameraJson() {
        StringBuilder b = new StringBuilder("{\"state\":");
        VisionPortal open = portal;
        AprilTagProcessor tags = aprilTag;
        boolean opening = camOpening;
        if (open == null) b.append("\"ERROR\"");
        else if (opening) b.append("\"OPENING\"");
        else {
            // The camera can close under this a moment after camOpening was read.
            try { b.append(str(String.valueOf(open.getCameraState()))).append(",\"fps\":").append(num(open.getFps())); }
            catch (RuntimeException e) { opening = true; b.append("\"OPENING\""); }
        }
        b.append(",\"open\":").append(str(webcamNames.get(camIndex))).append(",\"range\":").append(cameraRange).append(",\"exp\":").append(num(camExposure)).append(",\"gain\":").append(num(camGain)).append(",\"dec\":").append(num(camDecimation)).append(",\"seen\":").append(num(camExposureRead)).append(",\"modes\":").append(camModes);
        double[] lens = camLens;
        b.append(",\"lens\":");
        if (lens == null) b.append("null"); else b.append('[').append(num(lens[0])).append(',').append(num(lens[1])).append(',').append(num(lens[2])).append(',').append(num(lens[3])).append(']');
        if (cameraError != null) b.append(",\"error\":").append(str(cameraError));
        b.append(",\"tags\":[");
        if (tags != null && !opening) { boolean first = true; for (AprilTagDetection d : tags.getDetections()) {
            if (!first) b.append(','); first = false;
            Object id = field(d, "id"), margin = field(d, "decisionMargin"), name = field(field(d, "metadata"), "name");
            b.append("{\"id\":").append(id instanceof Number ? String.valueOf(((Number) id).intValue()) : "null").append(",\"m\":").append(margin instanceof Number ? num(((Number) margin).doubleValue()) : "null");
            if (name != null) b.append(",\"name\":").append(str(String.valueOf(name)));
            if (d.ftcPose != null) b.append(",\"r\":").append(num(d.ftcPose.range)).append(",\"b\":").append(num(d.ftcPose.bearing)).append(",\"y\":").append(num(d.ftcPose.yaw)).append(",\"p\":").append(num(d.ftcPose.pitch));
            b.append('}');
        } }
        return b.append("]}").toString();
    }

    /** The hubs (module addresses) whose servo power Torque Debug keeps on with a port of their own. */
    final List<Integer> railKept = new ArrayList<>();

    /**
     * A Control or Expansion Hub switches the 5 V of all six servo ports together, and turns it off once no servo port has PWM on.
     * An Axon's analog position comes from the servo's own board, so with that power off its analog wire reads nothing. Every servo
     * here is let go (no PWM) when nothing drives it, so each hub with a servo keeps PWM on one port no servo is configured on: a
     * 1500 µs pulse to an empty port, which keeps the power on. An Axon whose Lose PPM is Release then turns by hand and still reads.
     */
    void keepServoPower() throws InterruptedException {
        Map<LynxModule, boolean[]> used = new HashMap<>();
        List<HardwareDevice> all = new ArrayList<>(servos); all.addAll(crservos);
        for (HardwareDevice d : all) {
            Object controller = d instanceof Servo ? ((Servo) d).getController() : ((CRServo) d).getController();
            int port = d instanceof Servo ? ((Servo) d).getPortNumber() : ((CRServo) d).getPortNumber();
            LynxModule hub = moduleOf(controller);
            if (hub == null || port < 0 || port > 5) continue;
            if (!used.containsKey(hub)) used.put(hub, new boolean[6]);
            used.get(hub)[port] = true;
        }
        for (Map.Entry<LynxModule, boolean[]> e : used.entrySet()) {
            for (int ch = 5; ch >= 0; ch--) {
                if (e.getValue()[ch]) continue;
                try {
                    new LynxSetServoConfigurationCommand(e.getKey(), ch, 20000).send();
                    new LynxSetServoPulseWidthCommand(e.getKey(), ch, 1500).send();
                    new LynxSetServoEnableCommand(e.getKey(), ch, true).send();
                    railKept.add(e.getKey().getModuleAddress());
                } catch (LynxNackException | RuntimeException ignored) { }
                break;
            }
        }
    }

    int servoHubs() {
        List<LynxModule> seen = new ArrayList<>();
        List<HardwareDevice> all = new ArrayList<>(servos); all.addAll(crservos);
        for (HardwareDevice d : all) { LynxModule h = moduleOf(d instanceof Servo ? ((Servo) d).getController() : ((CRServo) d).getController()); if (h != null && !seen.contains(h)) seen.add(h); }
        return seen.size();
    }

    /** The hub a servo controller talks to. The SDK keeps it in a field of the controller, so it is found by type, not by name. */
    static LynxModule moduleOf(Object controller) {
        for (Class<?> k = controller == null ? null : controller.getClass(); k != null; k = k.getSuperclass()) {
            for (java.lang.reflect.Field f : k.getDeclaredFields()) {
                try { f.setAccessible(true); Object v = f.get(controller); if (v instanceof LynxModule) return (LynxModule) v; } catch (Exception | LinkageError ignored) { }
            }
        }
        return null;
    }

    String manifest() {
        StringBuilder b = new StringBuilder("{\"deck\":\"debug\",\"version\":1");
        b.append(",\"railKept\":").append(railKept.size()).append(",\"servoHubs\":").append(servoHubs());
        list(b, "motors", motorNames); list(b, "servos", servoNames); list(b, "crservos", crNames); list(b, "digital", digitalNames); list(b, "touch", touchNames); list(b, "cameras", webcamNames);
        b.append(",\"lights\":[");
        for (int i = 0; i < lights.size(); i++) { if (i > 0) b.append(','); b.append("{\"n\":").append(str(lightNames.get(i))).append(",\"k\":").append(str(lights.get(i) instanceof LED ? "led" : lights.get(i) instanceof RevBlinkinLedDriver ? "blinkin" : "stick")).append('}'); }
        b.append("],\"analog\":[");
        for (int i = 0; i < analogs.size(); i++) { if (i > 0) b.append(','); b.append("{\"n\":").append(str(analogNames.get(i))).append(",\"max\":").append(num(analogs.get(i).getMaxVoltage())).append('}'); }
        b.append("],\"i2c\":[");
        for (int i = 0; i < i2c.size(); i++) { if (i > 0) b.append(','); b.append("{\"n\":").append(str(i2cNames.get(i))).append(",\"k\":").append(str(i2cKinds.get(i))); int[] p = i2cPlace[i]; if (p != null) b.append(",\"h\":").append(hubs.get(p[0]).getModuleAddress()).append(",\"b\":").append(p[1]).append(",\"a\":").append(p[2]); b.append('}'); }
        b.append("],\"hubs\":[");
        for (int i = 0; i < hubs.size(); i++) { LynxModule h = hubs.get(i); if (i > 0) b.append(','); b.append("{\"n\":").append(str(nameOf(h))).append(",\"address\":").append(h.getModuleAddress()).append(",\"parent\":").append(h.isParent()).append('}'); }
        return b.append("]}").toString();
    }

    void addI2c(HardwareDevice d, String kind) { for (HardwareDevice x : i2c) if (x == d) return; i2c.add(d); i2cNames.add(nameOf(d)); i2cKinds.add(kind); }
    String nameOf(HardwareDevice d) { Iterator<String> names = hardwareMap.getNamesOf(d).iterator(); return names.hasNext() ? names.next() : d.getDeviceName(); }
    static void list(StringBuilder b, String key, List<String> names) { b.append(",\"").append(key).append("\":["); for (int i = 0; i < names.size(); i++) { if (i > 0) b.append(','); b.append(str(names.get(i))); } b.append(']'); }
    static double clamp(double v, double lo, double hi) { return Math.max(lo, Math.min(hi, v)); }
    static String num(double v) { return Double.isNaN(v) || Double.isInfinite(v) ? "null" : String.valueOf(Math.round(v * 10000) / 10000.0); }
    static String str(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) { if (c == '"' || c == '\\') b.append('\\').append(c); else if (c < 0x20) b.append(' '); else b.append(c); }
        return b.append('"').toString();
    }

    // ---- the connection: one Deck at a time; a newer one takes over
    void serve() {
        try {
            server = new ServerSocket(); server.setReuseAddress(true); server.bind(new InetSocketAddress(PORT));
            while (running) {
                Socket s = server.accept();
                s.setTcpNoDelay(true);
                synchronized (this) { closeClient(); client = s; }
                heard = System.currentTimeMillis(); connected = true; latest.set(null);
                synchronized (wake) { wake.notifyAll(); }
                Thread read = new Thread(() -> read(s), "Torque Debug reader"); read.setDaemon(true); read.start();
            }
        } catch (IOException ignored) { }
    }
    void read(Socket s) {
        try (BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8))) {
            for (String line; running && (line = in.readLine()) != null; ) { heard = System.currentTimeMillis(); if (commands.size() < 256) commands.add(line); }
        } catch (IOException ignored) { }
        synchronized (this) { if (client == s) { connected = false; closeClient(); } }
    }
    void send() {
        Socket sentTo = null;
        while (running) {
            try {
                Socket s; synchronized (this) { s = client; }
                if (s == null) { synchronized (wake) { wake.wait(200); } continue; }
                OutputStream out = s.getOutputStream();
                if (s != sentTo) { out.write((manifest + "\n").getBytes(StandardCharsets.UTF_8)); out.flush(); sentTo = s; }
                String f = latest.getAndSet(null);
                if (f == null) { synchronized (wake) { wake.wait(100); } continue; }
                out.write((f + "\n").getBytes(StandardCharsets.UTF_8)); out.flush();
            } catch (IOException e) { synchronized (this) { connected = false; closeClient(); } sentTo = null; }
            catch (InterruptedException e) { return; }
        }
    }
    synchronized void closeClient() { if (client != null) { try { client.close(); } catch (IOException ignored) { } client = null; } }
    void close() { synchronized (this) { closeClient(); } try { if (server != null) server.close(); } catch (IOException ignored) { } }
}

/** A closed loop on one actuator (the Q command). */
final class TorqueDebugBurst {
    String actuator; int index, sensorIndex, id, phase, n, quiet; double power, moveBy, wrap, last, travel, speed, coast, delay = -1, cutTravel, cutSecs, stopSecs, mark; long startNanos, endNanos;
    final double[] ht = new double[96], hx = new double[96];
}
final class TorqueDebugLoop {
    String actuator, sensor, mode; boolean cr; int index, sensorIndex; boolean analog;
    double target, kP, kI, kD, kF, kS, kG, tol, wrap, izone, integral, last = Double.NaN, lastE = Double.NaN, out, error;
    // Swerve steering (steer): what the pod measured, then the law's state.
    boolean steer, rest, moved, run; double leadP, leadN, cP, cN, vP, vN, slope, vmax, zone, rP, rN, still, lag, ease;
    double st, speed, wait, lagLeft, fire, firePow, fireDir, from = Double.NaN, aim, gainP = 1, gainN = 1, boostP, boostN, tryT, tryM = Double.NaN, cmdV, cmdLead, inT, vm, runT, runDir, pend, stopErr, stopWay; int stops; boolean pendFull, stopFull; long lastNanos;
    final double[] raw = new double[3], hT = new double[5], hM = new double[5], pipeFrom = new double[TorqueDebug.PIPE], pipeAt = new double[TorqueDebug.PIPE], pipeV = new double[TorqueDebug.PIPE]; int rawN, hN, pipeHead, pipeN;
}

/**
 * IMU turning, run here (the U command): Calibrate → Mechanisms tunes how hard the robot can turn and still land on its angle,
 * and checks the numbers it found, inside this op mode, so nothing is sent to the robot and the live readings keep coming.
 * It runs on a thread of its own, where it can wait for the robot as an op mode would; it reads the heading itself as often as
 * the sensor answers, and the op mode's loop puts its turn power on the drive motors. It stops the moment Torque stops talking
 * (the watchdog), STOP is pressed, or a motor is driven by hand.
 *
 * Every turn uses the turn law (step; ui/sim-chassis-teleop.js turnStep is the reference, step for step).
 * Jobs: standard (50% to 75%) and aggressive (75% to 100%) tunings, as the IMU tuning op modes did before, and check: four
 * quarter turns with the numbers given. The result is one JSON line, as turnResultOf reads it.
 */
final class TorqueDebugTurn implements Runnable {
    /** What it turns: the robot as TorqueDebug gives it (a test gives a simulated one). heading(): degrees, left positive, as the sensor counts it (wrapping at ±180 is fine). */

    static final double RAMP = 0.25, STILL = 10, WINDOW = 0.05;
    static final double[] STANDARD = {0.5, 0.55, 0.6, 0.65, 0.7, 0.75}, AGGRESSIVE = {0.75, 0.8, 0.85, 0.9, 0.95, 1};
    static final int REPEATS = 3;

    // The law: the numbers it turns by, and its state for one turn.
    double top = 0.25, least = 0.07, slowFrom = 60, brake = 0.002, done = 2, lag = 0.02;
    double at = Double.NaN, h0, rate, last = Double.NaN, sent, push, way;
    boolean there;

    final TorqueDebugTurnRobot robot;
    final String job;
    final int id;
    final double tolerance;
    /** Each drive motor (its place in TorqueDebug's motors) and its power for a turn to the left. */
    int[] motors = new int[0];
    double[] powers = new double[0];
    /** Which I2C device the heading comes from, so the op mode's own round of reads leaves it alone. */
    int i2cIndex = -1;
    volatile boolean stopped, finished;
    volatile String state = "starting", result;
    volatile double headingNow, powerNow;
    final java.util.concurrent.CopyOnWriteArrayList<String> rows = new java.util.concurrent.CopyOnWriteArrayList<>();
    final List<String> json = new ArrayList<>();
    double heading, lastRaw, sign = 1, readMs;
    /** The heading's factor: its scale, and -1 when Calibrate found it counts a turn to the left as one to the right. */
    double scale = 1;
    int reads;

    TorqueDebugTurn(TorqueDebugTurnRobot robot, String job, int id, double tolerance) { this.robot = robot; this.job = job; this.id = id; this.tolerance = tolerance; done = tolerance; }

    static double wrap(double degrees) { return degrees - 360.0 * Math.round(degrees / 360.0); }

    /** A new turn: the law starts again. */
    void begin() { at = Double.NaN; last = Double.NaN; rate = 0; sent = 0; push = 0; way = 0; there = false; }

    /** One step of the turn law towards target (degrees), with the heading h now and t seconds. Returns the turn power. */
    double step(double target, double h, double t) {
        if (Double.isNaN(at)) { h0 = h; at = t; last = t; }
        double dt = Math.max(0, t - last); last = t;
        if (t - at >= WINDOW) { rate = (h - h0) / (t - at); h0 = h; at = t; }
        double r = rate, err = target - h, ahead = target - (h + r * lag); boolean slow = Math.abs(r) < STILL;
        if (there) { if (Math.abs(err) > 2 * done) there = false; } else if (Math.abs(err) <= done && slow) there = true;
        double want = 0;
        if (!there && Math.abs(ahead) > 0.5 * done) {
            double mag = top * Math.min(1, Math.abs(ahead) / slowFrom);
            if (Math.signum(ahead) != way) { way = Math.signum(ahead); push = 0; }
            push = slow ? Math.min(1.5 * least, Math.max(push, 0.5 * least) + dt * 2 * least) : Math.max(0.5 * least, push - dt * 3 * least); mag = Math.max(mag, push);
            want = Math.max(-top, Math.min(top, Math.signum(ahead) * mag - brake * r));
        } else push = 0;
        double step = dt / RAMP;
        sent = Math.abs(want) < Math.abs(sent) || want * sent < 0 ? want : sent + Math.max(-step, Math.min(step, want - sent));
        return sent;
    }

    boolean alive() { return !stopped && robot.alive(); }
    void stop() { stopped = true; }
    void power(double p) { powerNow = p; robot.power(p); }
    void pause(long ms) throws InterruptedException { robot.pause(ms); }

    /** The heading since the job began, left positive, timed: a Control Hub IMU read goes over I2C and can take several ms. */
    double read() {
        long t0 = System.nanoTime(); double raw = robot.heading(); double ms = (System.nanoTime() - t0) / 1e6;
        readMs = reads++ == 0 ? ms : 0.95 * readMs + 0.05 * ms;
        if (reads == 1) lastRaw = raw;
        heading += wrap(raw - lastRaw) * sign * scale; lastRaw = raw; headingNow = heading;
        return heading;
    }
    /** How old a heading is by the time the power it decides reaches the wheels, here: the read, and the op mode's loop. */
    double lagHere() { return (readMs + 0.5 * robot.loopMs() + 5) / 1000.0; }

    void say(String now) { state = now; }

    /** Waits until it has stopped turning (or two seconds). */
    void rest() throws InterruptedException {
        power(0);
        double t0 = robot.seconds(), before = read(), from = t0;
        int still = 0;
        while (alive() && robot.seconds() - t0 < 2 && still < 6) {
            pause(20);
            double now = read(), t = robot.seconds();
            if (t - from >= 0.04) { still = Math.abs((now - before) / (t - from)) < 4 ? still + 1 : 0; before = now; from = t; }
        }
    }

    /** One turn to an angle by the law, from rest. Returns {how far off it ended, how far past it went, seconds to get there}. */
    double[] turnTo(double target) throws InterruptedException {
        begin(); lag = lagHere();
        double t0 = robot.seconds(), start = read(), dir = Math.signum(target - start), far = 0, arrive = -1, thereAt = -1, t = 0;
        while (alive() && t < 5) {
            double h = read(); t = robot.seconds() - t0;
            far = Math.max(far, (h - target) * dir);
            if (arrive < 0 && Math.abs(target - h) <= tolerance) arrive = t;
            power(step(target, h, t));
            if (there) { if (thereAt < 0) thereAt = t; else if (t - thereAt >= 0.25) break; } else thereAt = -1;
            pause(10);
        }
        power(0);
        double seconds = arrive < 0 ? t : arrive;
        rest();
        return new double[]{Math.abs(target - read()), far, seconds};
    }

    @Override public void run() {
        try { robot.setUp(); if ("check".equals(job)) check(); else tune("aggressive".equals(job)); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        catch (RuntimeException e) { if (result == null) finish(false, 0, "It stopped: " + e.getClass().getSimpleName()); }
        finally { power(0); try { robot.tearDown(); } catch (RuntimeException ignored) { } if (result == null && !state.startsWith("problem:")) state = stopped ? "stopped" : "ended"; finished = true; }
    }

    /** Four quarter turns with the numbers it was given: what a team sees its code do. */
    void check() throws InterruptedException {
        pause(300); read(); heading = 0;
        double base = 0; StringBuilder turns = new StringBuilder();
        String[] names = {"Left 90°", "Back to 0°", "Right 90°", "Back to 0°"};
        double[] offsets = {90, 0, -90, 0};
        for (int i = 0; i < offsets.length && alive(); i++) {
            say(names[i]);
            double[] r = turnTo(base + offsets[i]);
            rows.add(String.format(java.util.Locale.US, "%s: %.1f° off, %.1f° past, %.2f s", names[i], r[0], r[1], r[2]));
            if (turns.length() > 0) turns.append(',');
            turns.append(String.format(java.util.Locale.US, "{\"target\":%.0f,\"off\":%.2f,\"over\":%.2f,\"seconds\":%.2f}", offsets[i], r[0], r[1], r[2]));
        }
        if (!alive()) return;
        result = String.format(java.util.Locale.US, "{\"v\":2,\"check\":true,\"tolerance\":%s,\"readMs\":%.2f,\"turns\":[%s]}", tolerance, readMs, turns);
        state = "done";
    }

    void tune(boolean aggressive) throws InterruptedException {
        double[] list = aggressive ? AGGRESSIVE : STANDARD;
        pause(300); read(); heading = 0;

        // Which way the heading counts: a turn to the left has to count up.
        say("Which way the heading counts");
        double t0 = robot.seconds();
        while (alive() && robot.seconds() - t0 < 0.8 && Math.abs(read()) < 10) { power(0.3); pause(10); }
        rest();
        if (!alive()) return;
        if (Math.abs(heading) < 3) { finish(false, 0, "It did not turn at 30% power: is it on the floor, with its wheels free?"); return; }
        boolean backwards = heading < 0;
        if (backwards) { sign = -1; heading = -heading; }

        // The least power that turns it.
        say("The least power that turns it");
        double least = 0.2;
        for (double p = 0.04; alive() && p <= 0.3; p += 0.01) {
            double from = read(); t0 = robot.seconds();
            while (alive() && robot.seconds() - t0 < 0.12) { power(p); pause(10); }
            if (Math.abs(read() - from) / 0.12 > 12) { least = Math.min(0.2, Math.max(0.04, 1.2 * p)); break; }
        }
        rest();

        int fails = 0;
        for (double power : list) {
            if (!alive()) return;
            say(String.format(java.util.Locale.US, "%.0f%%: how fast it turns", power * 100));
            // A spin: ramped up, held, then cut; its speed over the last of it.
            double before = read(), from = robot.seconds(), spin = 0, sentNow = 0, lastT = from;
            t0 = from;
            while (alive() && robot.seconds() - t0 < 0.6) {
                double t = robot.seconds(); sentNow = Math.min(power, sentNow + (t - lastT) / RAMP); lastT = t; power(sentNow); pause(10);
                double now = read(); t = robot.seconds();
                if (t - from >= 0.05) { spin = (now - before) / (t - from); before = now; from = t; }
            }
            double cutAt = read();
            rest();
            double coast = Math.abs(read() - cutAt), speed = Math.abs(spin);
            if (speed < 20) { rows.add(String.format(java.util.Locale.US, "%.0f%% too slow to measure", power * 100)); continue; }
            // Where it starts to slow: what it rolls on once cut, with room to spare, and a little turning for the readings to catch up.
            // Aggressive leaves it later, so it comes in faster and stops harder; the rounds show whether it still lands.
            top = power; this.least = least;
            slowFrom = Math.min(150, Math.max(aggressive ? 20 : 30, aggressive ? 1.6 * coast + 0.12 * speed : 2.5 * coast + 0.25 * speed));
            brake = 0.45 * power / speed;
            double worst = 0, over = 0, seconds = 0;
            int turns = 0;
            for (int round = 1; round <= REPEATS && alive(); round++) {
                say(String.format(java.util.Locale.US, "%.0f%%: round %d of %d", power * 100, round, REPEATS));
                double base = read();
                for (double offset : new double[]{90, 0, -90, 0}) {
                    if (!alive()) break;
                    double[] r = turnTo(base + offset);
                    worst = Math.max(worst, r[0]); over = Math.max(over, r[1]); seconds += r[2]; turns++;
                }
                if (over > 45) break;
            }
            if (!alive()) return;
            boolean ok = turns == 4 * REPEATS && worst <= tolerance && over <= Math.max(3 * tolerance, 6);
            double each = turns > 0 ? seconds / turns : 0;
            rows.add(String.format(java.util.Locale.US, "%.0f%% %s: %.1f° off, %.1f° past, %.2f s a turn", power * 100, ok ? "good" : "no", worst, over, each));
            json.add(String.format(java.util.Locale.US, "{\"power\":%.2f,\"rate\":%.1f,\"coast\":%.1f,\"slowFrom\":%.0f,\"brake\":%.5f,\"worst\":%.2f,\"over\":%.2f,\"seconds\":%.2f,\"ok\":%s}", power, speed, coast, slowFrom, brake, worst, over, each, ok));
            // More power only swings further: two in a row that do not land, or one that swings far past, ends it.
            fails = ok ? 0 : fails + 1;
            if (over > 45 || (aggressive && fails >= 2)) break;
        }
        finish(backwards, least, "");
    }

    void finish(boolean backwards, double least, String problem) {
        power(0);
        result = "{\"v\":2,\"mode\":\"" + ("aggressive".equals(job) ? "aggressive" : "standard") + "\",\"backwards\":" + backwards + ",\"least\":" + String.format(java.util.Locale.US, "%.3f", least)
            + ",\"tolerance\":" + tolerance + ",\"repeats\":" + REPEATS + ",\"readMs\":" + String.format(java.util.Locale.US, "%.2f", readMs)
            + ",\"problem\":" + TorqueDebug.str(problem) + ",\"rounds\":[" + String.join(",", json) + "]}";
        state = "done";
    }

    /** What goes in each frame: the job, where it is, the heading and power now, each power done so far, and the result once there is one. */
    String json() {
        StringBuilder b = new StringBuilder("{\"job\":").append(TorqueDebug.str(job)).append(",\"id\":").append(id).append(",\"state\":").append(TorqueDebug.str(state))
            .append(",\"h\":").append(TorqueDebug.num(headingNow)).append(",\"p\":").append(TorqueDebug.num(powerNow)).append(",\"fin\":").append(finished ? 1 : 0).append(",\"rows\":[");
        boolean first = true; for (String r : rows) { if (!first) b.append(','); first = false; b.append(TorqueDebug.str(r)); }
        b.append("],\"result\":").append(result == null ? "null" : TorqueDebug.str(result));
        return b.append('}').toString();
    }
}

/** What an IMU turning turns: the robot as TorqueDebug gives it (TorqueDebugTurnHub), or a simulated one in a test. heading(): degrees, left positive, as the sensor counts it (wrapping at ±180 is fine). */
interface TorqueDebugTurnRobot { double heading(); void power(double turn); boolean alive(); void pause(long ms) throws InterruptedException; double seconds(); double loopMs(); void setUp(); void tearDown(); }

/** The real robot for an IMU turning: its heading sensor, read here; the op mode's loop puts the turn power on the drive motors. */
final class TorqueDebugTurnHub implements TorqueDebugTurnRobot {
    final TorqueDebug debug; final HardwareDevice device; final boolean pin; final List<Integer> drive; final String[] mount;
    final DcMotor.ZeroPowerBehavior[] before;
    TorqueDebugTurnHub(TorqueDebug debug, HardwareDevice device, boolean pin, List<Integer> drive, String[] mount) { this.debug = debug; this.device = device; this.pin = pin; this.drive = drive; this.mount = mount; before = new DcMotor.ZeroPowerBehavior[drive.size()]; }
    public double heading() {
        if (pin) { GoBildaPinpointDriver p = (GoBildaPinpointDriver) device; p.update(); return p.getHeading(AngleUnit.DEGREES); }
        return ((IMU) device).getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES);
    }
    public void power(double turn) { }
    public boolean alive() { return debug.running && debug.connected && !debug.isStopRequested(); }
    public void pause(long ms) throws InterruptedException { Thread.sleep(ms); }
    public double seconds() { return System.nanoTime() / 1e9; }
    public double loopMs() { return debug.loopMsNow; }
    public void setUp() {
        // It turns the way the robot's own code does: braking at zero power, the IMU told how the hub really sits.
        for (int j = 0; j < drive.size(); j++) { DcMotorEx m = debug.motors.get(drive.get(j)); before[j] = m.getZeroPowerBehavior(); m.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE); }
        if (!pin) TorqueDebug.mountImu((IMU) device, mount);
    }
    public void tearDown() {
        for (int j = 0; j < drive.size(); j++) if (before[j] != null) debug.motors.get(drive.get(j)).setZeroPowerBehavior(before[j]);
        if (!pin) TorqueDebug.mountImu((IMU) device, new String[]{"L", "UP", "FORWARD"});
    }
}
