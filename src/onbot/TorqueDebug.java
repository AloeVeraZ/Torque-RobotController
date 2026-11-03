import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;
import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.hardware.lynx.LynxNackException;
import com.qualcomm.hardware.lynx.commands.core.LynxGetADCCommand;
import com.qualcomm.hardware.lynx.commands.core.LynxI2cReadSingleByteCommand;
import com.qualcomm.hardware.lynx.commands.core.LynxI2cReadStatusQueryCommand;
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
                for (int i = 0; i < motors.size(); i++) if (now - motorAt[i] > WATCHDOG_MS && !(loop != null && !loop.cr && loop.index == i)) motorPower[i] = 0;
                for (int i = 0; i < crservos.size(); i++) if (now - crAt[i] > WATCHDOG_MS && !(loop != null && loop.cr && loop.index == i)) crPower[i] = 0;
                runLoop();
                for (int i = 0; i < motors.size(); i++) motors.get(i).setPower(motorCut[i] ? 0 : motorPower[i]);
                for (int i = 0; i < crservos.size(); i++) if (crTold[i]) crservos.get(i).setPower(crPower[i]);
                for (int i = 0; i < servos.size(); i++) {
                    Servo s = servos.get(i);
                    if (servoOn[i] && !Double.isNaN(servoPos[i])) { if (s instanceof PwmControl && !((PwmControl) s).isPwmEnabled()) ((PwmControl) s).setPwmEnable(); s.setPosition(servoPos[i]); }
                    else if (s instanceof PwmControl && ((PwmControl) s).isPwmEnabled()) ((PwmControl) s).setPwmDisable();
                }
                for (int i = 0; i < lights.size(); i++) if (lightOn[i] != lightSent[i]) { setLight(i, lightOn[i]); lightSent[i] = lightOn[i]; }
                // One motor's current and one I2C sensor a loop, in turn.
                if (!motors.isEmpty()) { int m = turn % motors.size(); motorAmps[m] = motors.get(m).getCurrent(CurrentUnit.AMPS); stall(m, now); }
                if (!i2c.isEmpty()) { int k = turn % i2c.size(); i2cLast[k] = i2cOn[k] == 0 || i2cOn[k] == -1 ? null : readI2c(k); i2cAt[k] = now; }
                if (battery != null && turn % 25 == 0) volts12 = battery.getVoltage();
                turn++; loops++;
                long t = System.nanoTime();
                if (loops % 20 == 0) { loopMs = (t - loopStart) / 20e6; loopStart = t; }
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
    //   Q actuator sensor mode target kP kI kD kF kS kG tolerance wrap
    //                             run a loop here: actuator a motor or CR servo; sensor "enc:<motor>" or "ana:<analog>";
    //                             mode pos (target in ticks or volts) or vel (ticks a second); wrap > 0 takes the
    //                             shortest way round a circle of that many units; gains in power per raw unit
    //   T target                  move the running loop's target
    //   G name 0|1                a light off or on
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
                case "M": { int i = motorNames.indexOf(f[1]); if (i >= 0) { if (loop != null && !loop.cr && loop.index == i) loop = null; motorPower[i] = clamp(Double.parseDouble(f[2]), -1, 1); motorAt[i] = System.currentTimeMillis(); motorCut[i] = false; motorOverSince[i] = 0; } break; }
                case "C": { int i = crNames.indexOf(f[1]); if (i >= 0) { if (loop != null && loop.cr && loop.index == i) loop = null; crPower[i] = clamp(Double.parseDouble(f[2]), -1, 1); crAt[i] = System.currentTimeMillis(); crTold[i] = true; } break; }
                case "S": { int i = servoNames.indexOf(f[1]); if (i >= 0) { servoPos[i] = clamp(Double.parseDouble(f[2]), 0, 1); servoOn[i] = true; } break; }
                case "E": { int i = servoNames.indexOf(f[1]); if (i >= 0) servoOn[i] = "1".equals(f[2]) && !Double.isNaN(servoPos[i]); break; }
                case "L": { int i = servoNames.indexOf(f[1]); if (i >= 0) servoLatched[i] = "1".equals(f[2]); break; }
                case "R": { int i = motorNames.indexOf(f[1]); if (i >= 0) { DcMotorEx m = motors.get(i); m.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER); m.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER); } break; }
                case "G": { int i = lightNames.indexOf(f[1]); if (i >= 0) lightOn[i] = "1".equals(f[2]); break; }
                case "Q": startLoop(f); break;
                case "T": if (loop != null) { loop.target = Double.parseDouble(f[1]); loop.integral = 0; } break;
                case "X": stopOutputs(false); break;
                case "V": case "D": case "K": case "W": cameraCommands.add(f); break;
                default: break;
            }
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
        if (l.cr) crTold[l.index] = true; else { motorCut[l.index] = false; motorOverSince[l.index] = 0; }
        loop = l;
    }

    /** The loop Deck asked for, one step: PID on the sensor's raw reading, plus feedforward (kF for speed, kS against friction, kG against gravity). */
    void runLoop() {
        TorqueDebugLoop l = loop;
        if (l == null) return;
        boolean vel = "vel".equals(l.mode);
        double measured = l.analog ? analogs.get(l.sensorIndex).getVoltage() : vel ? motors.get(l.sensorIndex).getVelocity() : motors.get(l.sensorIndex).getCurrentPosition();
        double e = l.target - measured;
        if (l.wrap > 0) { e %= l.wrap; if (e > l.wrap / 2) e -= l.wrap; if (e < -l.wrap / 2) e += l.wrap; }
        double dt = FRAME_MS / 1000.0, d = Double.isNaN(l.last) ? 0 : (e - l.last) / dt;
        l.last = e;
        l.integral = clamp(l.integral + e * dt, -1e6, 1e6);
        double out = l.kP * e + l.kI * l.integral + l.kD * d + l.kG;
        if (vel) out += l.kF * l.target + l.kS * Math.signum(l.target);
        else if (Math.abs(e) > l.tol) out += l.kS * Math.signum(e);
        l.out = clamp(out, -1, 1); l.error = e;
        if (l.cr) crPower[l.index] = l.out; else motorPower[l.index] = l.out;
    }

    void stall(int m, long now) {
        if (Math.abs(motorPower[m]) > 0.05 && motorAmps[m] > STALL_AMPS) { if (motorOverSince[m] == 0) motorOverSince[m] = now; else if (now - motorOverSince[m] > STALL_MS) { motorCut[m] = true; if (loop != null && !loop.cr && loop.index == m) loop = null; } }
        else motorOverSince[m] = 0;
    }

    void stopOutputs(boolean all) {
        loop = null;
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

    String manifest() {
        StringBuilder b = new StringBuilder("{\"deck\":\"debug\",\"version\":1");
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
final class TorqueDebugLoop {
    String actuator, sensor, mode; boolean cr; int index, sensorIndex; boolean analog;
    double target, kP, kI, kD, kF, kS, kG, tol, wrap, integral, last = Double.NaN, out, error;
}
