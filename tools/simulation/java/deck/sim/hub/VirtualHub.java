package deck.sim.hub;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.HardwareDevice;
import com.qualcomm.robotcore.hardware.HardwareMap;
import java.io.File;
import java.io.StringWriter;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.DoubleSupplier;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

/**
 * A virtual REV Control Hub for exported autonomous code. The team files (OpMode, Constants,
 * route, Deck controller and hardware adapter) are compiled against FTC SDK stand-ins,
 * then run in lockstep with the simulation: the drive motors with encoders (four
 * mecanum, or two or four tank), odometry pods, Pinpoint/OTOS and the built-in IMU are fed from the
 * simulated sensors, and the motor powers the OpMode sets are turned back into chassis motion
 * through mecanum or tank kinematics. The robot's own moving parts (hub.kinematics: servos, continuous servos and motors
 * that drive its joints) and sensors (hub.sensors: analog inputs, switches, distance and color sensors, extra encoders)
 * are fed from the simulated joints each tick, and what the code commands them moves those joints.
 */
public final class VirtualHub {
    /** A problem in the team code, reported with the stage it happened in. */
    public static final class HubException extends RuntimeException {
        public final String stage;
        public final List<String> details;
        HubException(String stage, String message, List<String> details, Throwable cause) {
            super(message, cause);
            this.stage = stage;
            this.details = details;
        }
    }

    private static final class Pod {
        final SimMotor port;
        final double x, y, ticksPerInch;
        final boolean forward;
        Pod(SimMotor port, double x, double y, double ticksPerInch, boolean forward) {
            this.port = port; this.x = x; this.y = y; this.ticksPerInch = ticksPerInch; this.forward = forward;
        }
    }

    private final HardwareMap map = new HardwareMap() {};
    private final Map<String, SimMotor> drive = new LinkedHashMap<>();
    private final List<Pod> pods = new ArrayList<>();
    private final SimTelemetry telemetry = new SimTelemetry();
    private final SimSensors.Imu imu = new SimSensors.Imu();
    private SimSensors.Pinpoint pinpoint;
    private SimSensors.Otos otos;
    private final double wheelTicksPerInch, turnArm;
    private final boolean tank;
    private final String className;
    private double gyro;
    // Mechanisms named by the export: intake rollers (motors or continuous servos), kicker and ramp servos, and
    // shooters (flywheel motors, a feeder and a turret when it has one). Any may be absent. Each device's mount
    // is the physical truth from the setup (-1: mounted to turn the other way), so the code has to set the
    // same direction for a roller to pull pieces in or a flywheel to spin forward.
    /** Intake rollers: each one's pull-in command (mount x applied power), grouped by the intake they belong to. */
    private final Map<Integer, List<DoubleSupplier>> rollers = new LinkedHashMap<>();
    /** Kicker servos with their down and up positions: a kicker sent down counts as the intake running. */
    private final List<SimServo> kickers = new ArrayList<>();
    private final List<double[]> kickerPositions = new ArrayList<>();
    /** Ramp servos with their down and up positions: a ramp sent down folds down (its rollers are intake rollers). */
    private final List<SimServo> ramps = new ArrayList<>();
    private final List<double[]> rampPositions = new ArrayList<>();
    private final List<Shooter> shooters = new ArrayList<>();
    /** What each named device does on the robot this tick, as someone watching it would see it: a drive wheel's forward
     * command, a roller's pull-in, a flywheel's shooting spin, a feeder's feed (each mount x applied power), a servo's
     * position, a turret's commanded angle in degrees (NaN when it is not being turned). The guided check is tested with it. */
    private final Map<String, DoubleSupplier> devices = new LinkedHashMap<>();
    /** The robot's own moving parts (hub.kinematics), each driving one joint of the simulated robot. */
    private final List<Part> parts = new ArrayList<>();
    /** What each sensor (hub.sensors) is told each tick, by its name: volts, a switch closed, millimetres, a color, counts. */
    private final Map<String, Consumer<JsonElement>> sensors = new LinkedHashMap<>();
    private OpMode opMode;

    /**
     * An actuator of the robot's own design: {id, name, type servo|crservo|motor, reversed, countsPerUnit, port?,
     * servo: {center, perUnit, sign, ratio?, pwm?, defaultPwm?}}. Joint values are degrees or inches from where the CAD
     * has the part. A servo's joint value is (position - center) x perUnit / (sign x ratio), its position read from the
     * pulse it sends against the pulses perUnit assumes (pwm, default 600-2400 us), so code that leaves out the setPwmRange
     * the settings need sends the part elsewhere, as on a robot. A motor counts mount x value x countsPerUnit raw ticks
     * (reversed: mounted to turn the other way, so the code sets REVERSE); RUN_TO_POSITION sends its target as a value, else
     * its power (or velocity) moves the joint. A continuous servo's mount x power moves it.
     */
    private static final class Part {
        final String id, type;
        final int mount;
        final double countsPerUnit, center, perUnit, sign, ratio;
        final double[] pwm, defaultPwm;
        SimServo servo;
        SimCRServo crservo;
        SimMotor motor;

        Part(JsonObject k) {
            id = k.get("id").getAsString();
            type = k.has("type") ? k.get("type").getAsString() : "servo";
            mount = k.has("reversed") && k.get("reversed").getAsBoolean() ? -1 : 1;
            countsPerUnit = nonzero(num(k, "countsPerUnit", 1));
            JsonObject s = k.has("servo") && k.get("servo").isJsonObject() ? k.getAsJsonObject("servo") : new JsonObject();
            center = num(s, "center", .5); perUnit = num(s, "perUnit", 300); sign = nonzero(num(s, "sign", 1)); ratio = nonzero(num(s, "ratio", 1));
            pwm = pair(s, "pwm", new double[] {600, 2400}); defaultPwm = pair(s, "defaultPwm", null);
        }

        /** What the code commands: {value} (a joint value; a motor's RUN_TO_POSITION also its power), {power} or
         * {velocity} (units a second); null for a servo with no pulse yet. */
        JsonObject command() {
            JsonObject c = new JsonObject();
            if (servo != null) {
                double us = servo.pulse();
                if (Double.isNaN(us)) return null;
                c.addProperty("value", ((us - pwm[0]) / (pwm[1] - pwm[0]) - center) * perUnit / (sign * ratio));
            } else if (crservo != null) c.addProperty("power", mount * crservo.output());
            else {
                double target = motor.targetTicks(), velocity = motor.targetVelocity();
                if (!Double.isNaN(target)) { c.addProperty("value", mount * target / countsPerUnit); c.addProperty("power", Math.min(1, Math.abs(motor.getPower()))); }
                else if (!Double.isNaN(velocity)) c.addProperty("velocity", mount * velocity / countsPerUnit);
                else c.addProperty("power", mount * motor.commanded(1));
            }
            return c;
        }

        /** Its effect for devices(): a servo's position, else the joint value a motor heads for or the power it gets. */
        double effect() {
            if (servo != null) return servo.output();
            if (crservo != null) return mount * crservo.output();
            double target = motor.targetTicks();
            return Double.isNaN(target) ? mount * motor.commanded(1) : mount * target / countsPerUnit;
        }

        private static double num(JsonObject o, String key, double fallback) { return o.has(key) && o.get(key).isJsonPrimitive() && Double.isFinite(o.get(key).getAsDouble()) ? o.get(key).getAsDouble() : fallback; }
        private static double nonzero(double v) { return v == 0 ? 1 : v; }
        private static double[] pair(JsonObject o, String key, double[] fallback) {
            if (!o.has(key) || !o.get(key).isJsonArray() || o.getAsJsonArray(key).size() != 2) return fallback;
            double lo = o.getAsJsonArray(key).get(0).getAsDouble(), hi = o.getAsJsonArray(key).get(1).getAsDouble();
            return hi > lo ? new double[] {lo, hi} : fallback;
        }
    }

    private static final class Shooter {
        final List<SimMotor> flywheels = new ArrayList<>();
        final List<Integer> flywheelMounts = new ArrayList<>();
        /** The feeder's command: a motor or continuous servo's mount x power, or 1 while a servo feeder sits nearer its feed position. */
        DoubleSupplier feeder = () -> 0;
        SimMotor turret;
        SimServo turretServo;
        int turretMount = 1;
        double full = 1, turretTicksPerDegree = 1, turretCenter = .5, turretDegrees = 300;

        /** Every motor of the flywheel has to spin it forward: the weakest one counts (a fraction of full speed). */
        double flywheel() {
            double weakest = Double.NaN;
            for (int i = 0; i < flywheels.size(); i++) {
                double v = flywheelMounts.get(i) * flywheels.get(i).commanded(full);
                weakest = Double.isNaN(weakest) ? v : Math.min(weakest, v);
            }
            return Double.isNaN(weakest) ? 0 : weakest;
        }

        /** The angle the turret was sent to, degrees from the robot's front (NaN when it is not positioning). */
        double turretTarget() {
            if (turret != null) { double t = turret.targetTicks(); return Double.isNaN(t) ? t : turretMount * t / turretTicksPerDegree; }
            if (turretServo != null) { double p = turretServo.output(); return Double.isNaN(p) ? p : turretMount * (p - turretCenter) * turretDegrees; }
            return Double.NaN;
        }
    }
    private VirtualHub(JsonObject hub, double heading) {
        JsonObject d = hub.getAsJsonObject("drive");
        wheelTicksPerInch = d.get("ticksPerInch").getAsDouble();
        tank = d.has("kind") && "tank".equals(d.get("kind").getAsString());
        // Mecanum wheels turn on the sum of half-length and half-width; tank wheels on the half-track.
        turnArm = tank ? d.get("halfWidth").getAsDouble() : d.get("halfLength").getAsDouble() + d.get("halfWidth").getAsDouble();
        int port = 0, servoPort = 0, analogPort = 0, digitalPort = 0;
        for (Map.Entry<String, JsonElement> e : d.getAsJsonObject("motors").entrySet()) {
            JsonObject m = e.getValue().getAsJsonObject();
            SimMotor motor = new SimMotor(port++, m.get("mount").getAsInt());
            drive.put(e.getKey(), motor);
            map.put(m.get("name").getAsString(), motor);
            devices.put(m.get("name").getAsString(), motor::wheelCommand);
        }
        if (hub.has("pods")) for (JsonElement e : hub.getAsJsonArray("pods")) {
            JsonObject p = e.getAsJsonObject();
            // A pod that counts backward as the robot drives its way is mounted reversed.
            SimMotor encoder = new SimMotor(port++, p.has("reversed") && p.get("reversed").getAsBoolean() ? -1 : 1);
            pods.add(new Pod(encoder, p.get("x").getAsDouble(), p.get("y").getAsDouble(), p.get("ticksPerInch").getAsDouble(), "forward".equals(p.get("axis").getAsString())));
            map.put(p.get("name").getAsString(), encoder);
        }
        gyro = heading;
        imu.heading = heading;
        map.put(hub.has("imu") ? hub.get("imu").getAsString() : "imu", imu);
        // The Pinpoint and OTOS mounted as the setup says (pinpointMount, otosMount); older exports carry only their names.
        // A Pinpoint alone (pinpointImu) has no pods plugged in: it is the IMU.
        if (hub.has("pinpoint")) { boolean alone = hub.has("pinpointImu") && hub.get("pinpointImu").getAsBoolean(); pinpoint = new SimSensors.Pinpoint(hub.has("pinpointMount") ? hub.getAsJsonObject("pinpointMount") : null, !alone); map.put(hub.get("pinpoint").getAsString(), pinpoint); }
        if (hub.has("otos")) { otos = new SimSensors.Otos(hub.has("otosMount") ? hub.getAsJsonObject("otosMount") : null); map.put(hub.get("otos").getAsString(), otos); }
        // The hubs under their configuration names (LynxModule for bulk caching, and each one's battery voltage):
        // hub.modules [{name, address, parent}], else the Control Hub alone.
        if (hub.has("modules")) for (JsonElement e : hub.getAsJsonArray("modules")) {
            JsonObject h = e.getAsJsonObject();
            map.put(h.get("name").getAsString(), new SimModule(h.has("address") ? h.get("address").getAsInt() : 173, h.has("parent") && h.get("parent").getAsBoolean()));
        }
        else map.put("Control Hub", new SimModule(173, true));
        if (hub.has("mechanisms")) {
            JsonObject mech = hub.getAsJsonObject("mechanisms");
            if (mech.has("intakes")) for (JsonElement e : mech.getAsJsonArray("intakes")) {
                // A roller: {name, kind motor|crservo, mount, part}; older exports list motor names only.
                JsonObject r = e.isJsonObject() ? e.getAsJsonObject() : new JsonObject();
                String name = e.isJsonObject() ? r.get("name").getAsString() : e.getAsString();
                int mount = mount(r), part = r.has("part") ? r.get("part").getAsInt() : rollers.size();
                DoubleSupplier pull;
                if (r.has("kind") && "crservo".equals(r.get("kind").getAsString())) { SimCRServo servo = new SimCRServo(servoPort++); map.put(name, servo); pull = () -> mount * servo.output(); }
                else { SimMotor motor = new SimMotor(port++, 1); map.put(name, motor); pull = () -> mount * motor.commanded(1); }
                rollers.computeIfAbsent(part, k -> new ArrayList<>()).add(pull);
                devices.put(name, pull);
            }
            if (mech.has("kickers")) for (JsonElement e : mech.getAsJsonArray("kickers")) {
                JsonObject k = e.getAsJsonObject();
                SimServo servo = new SimServo(servoPort++);
                kickers.add(servo);
                kickerPositions.add(new double[] { k.get("down").getAsDouble(), k.get("up").getAsDouble() });
                map.put(k.get("name").getAsString(), servo);
                devices.put(k.get("name").getAsString(), servo::output);
            }
            if (mech.has("ramps")) for (JsonElement e : mech.getAsJsonArray("ramps")) {
                JsonObject k = e.getAsJsonObject();
                SimServo servo = new SimServo(servoPort++);
                ramps.add(servo);
                rampPositions.add(new double[] { k.get("down").getAsDouble(), k.get("up").getAsDouble() });
                map.put(k.get("name").getAsString(), servo);
                devices.put(k.get("name").getAsString(), servo::output);
            }
            if (mech.has("shooters")) for (JsonElement e : mech.getAsJsonArray("shooters")) {
                JsonObject s = e.getAsJsonObject();
                Shooter shooter = new Shooter();
                // Flywheel motors: {flywheels: [{name, mount}], ticksPerSecond}; older exports have one flywheel {name, ticksPerSecond}.
                if (s.has("flywheels")) {
                    shooter.full = s.get("ticksPerSecond").getAsDouble();
                    for (JsonElement f : s.getAsJsonArray("flywheels")) {
                        SimMotor motor = new SimMotor(port++, 1);
                        int flywheelMount = mount(f.getAsJsonObject());
                        map.put(f.getAsJsonObject().get("name").getAsString(), motor);
                        shooter.flywheels.add(motor);
                        shooter.flywheelMounts.add(flywheelMount);
                        devices.put(f.getAsJsonObject().get("name").getAsString(), () -> flywheelMount * motor.commanded(shooter.full));
                    }
                } else {
                    JsonObject f = s.getAsJsonObject("flywheel");
                    SimMotor motor = new SimMotor(port++, 1);
                    map.put(f.get("name").getAsString(), motor);
                    shooter.flywheels.add(motor);
                    shooter.flywheelMounts.add(1);
                    devices.put(f.get("name").getAsString(), () -> motor.commanded(shooter.full));
                    shooter.full = f.get("ticksPerSecond").getAsDouble();
                }
                // The feeder: a motor or continuous servo (mount x power), or a servo pusher or gate (at its feed position or not).
                JsonObject x = s.getAsJsonObject("indexer");
                String kind = x.get("kind").getAsString(), feederName = x.get("name").getAsString();
                int feederMount = mount(x);
                if ("crservo".equals(kind)) { SimCRServo servo = new SimCRServo(servoPort++); map.put(feederName, servo); shooter.feeder = () -> feederMount * servo.output(); }
                else if ("pusher".equals(kind) || "gate".equals(kind)) {
                    SimServo servo = new SimServo(servoPort++);
                    double feed = x.get("feed").getAsDouble(), rest = x.get("rest").getAsDouble();
                    map.put(feederName, servo);
                    shooter.feeder = () -> { double p = servo.output(); return !Double.isNaN(p) && Math.abs(p - feed) < Math.abs(p - rest) ? 1 : 0; };
                    devices.put(feederName, servo::output);
                } else { SimMotor motor = new SimMotor(port++, 1); map.put(feederName, motor); shooter.feeder = () -> feederMount * motor.commanded(1); }
                if (!devices.containsKey(feederName)) devices.put(feederName, shooter.feeder);
                if (s.has("turret")) {
                    JsonObject t = s.getAsJsonObject("turret");
                    shooter.turretMount = mount(t);
                    if (t.has("kind") && "servo".equals(t.get("kind").getAsString())) {
                        map.put(t.get("name").getAsString(), shooter.turretServo = new SimServo(servoPort++));
                        shooter.turretCenter = t.get("center").getAsDouble();
                        shooter.turretDegrees = t.get("degrees").getAsDouble();
                    } else {
                        map.put(t.get("name").getAsString(), shooter.turret = new SimMotor(port++, 1));
                        shooter.turretTicksPerDegree = t.get("ticksPerDegree").getAsDouble();
                    }
                    devices.put(t.get("name").getAsString(), shooter::turretTarget);
                }
                // A hood servo ({name} or its name): the code sets its shooting and rest positions; the simulator tilts
                // the hood with the shooter's own commands.
                if (s.has("hood")) {
                    String hood = s.get("hood").isJsonObject() ? s.getAsJsonObject("hood").get("name").getAsString() : s.get("hood").getAsString();
                    SimServo servo = new SimServo(servoPort++);
                    map.put(hood, servo);
                    devices.put(hood, servo::output);
                }
                shooters.add(shooter);
            }
        }
        // The robot's own parts; a name the drive or a game mechanism already uses stays theirs.
        if (hub.has("kinematics")) for (JsonElement e : hub.getAsJsonArray("kinematics")) {
            JsonObject k = e.getAsJsonObject();
            Part part = new Part(k);
            String name = k.get("name").getAsString();
            if (map.tryGet(HardwareDevice.class, name) != null) continue;
            int at = k.has("port") ? k.get("port").getAsInt() : -1;
            if ("motor".equals(part.type)) map.put(name, part.motor = new SimMotor(at >= 0 ? at : port++, 1));
            else if ("crservo".equals(part.type)) map.put(name, part.crservo = new SimCRServo(at >= 0 ? at : servoPort++));
            else map.put(name, part.servo = new SimServo(at >= 0 ? at : servoPort++, part.defaultPwm));
            parts.add(part);
            devices.put(name, part::effect);
        }
        // Sensors: {name, type analog|digital|touch|distance|color|encoder, port?, inverted?}. The simulator works out each
        // reading from what the sensor measures; an encoder named like a motor reads into that motor's encoder input.
        if (hub.has("sensors")) for (JsonElement e : hub.getAsJsonArray("sensors")) {
            JsonObject s = e.getAsJsonObject();
            String name = s.get("name").getAsString(), type = s.has("type") ? s.get("type").getAsString() : "analog";
            int at = s.has("port") && s.get("port").isJsonPrimitive() ? s.get("port").getAsInt() : -1;
            boolean inverted = s.has("inverted") && s.get("inverted").getAsBoolean();
            if (!"encoder".equals(type) && map.tryGet(HardwareDevice.class, name) != null) continue;
            switch (type) {
                case "digital": case "touch": {
                    SimDigital pin = new SimDigital(inverted);
                    int p = at >= 0 ? at : digitalPort++;
                    map.put(name, "touch".equals(type) ? pin.new Touch(p) : pin.new Channel(p));
                    sensors.put(name, v -> pin.closed(v.isJsonPrimitive() && v.getAsBoolean()));
                    devices.put(name, () -> pin.closed() ? 1 : 0);
                    break;
                }
                case "distance": {
                    SimRange.Distance r = new SimRange.Distance();
                    map.put(name, r);
                    sensors.put(name, v -> r.mm = millimetres(v));
                    devices.put(name, () -> Double.isInfinite(r.mm) ? Double.NaN : r.mm);
                    break;
                }
                case "color": {
                    SimRange.Color c = new SimRange.Color();
                    map.put(name, c);
                    sensors.put(name, v -> {
                        JsonObject o = v.isJsonObject() ? v.getAsJsonObject() : new JsonObject();
                        c.mm = millimetres(o.get("mm"));
                        c.red = channel(o, "r"); c.green = channel(o, "g"); c.blue = channel(o, "b"); c.alpha = channel(o, "a");
                    });
                    devices.put(name, () -> Double.isInfinite(c.mm) ? Double.NaN : c.mm);
                    break;
                }
                case "encoder": {
                    HardwareDevice own = map.tryGet(HardwareDevice.class, name);
                    SimMotor m = own instanceof SimMotor ? (SimMotor) own : new SimMotor(at >= 0 ? at : port++, 1);
                    if (m != own) map.put(name, m);
                    // [counts, counts a second] as the encoder turns (its own direction already in the counts).
                    sensors.put(name, v -> { if (v.isJsonArray() && v.getAsJsonArray().size() == 2) m.encoder(v.getAsJsonArray().get(0).getAsDouble(), v.getAsJsonArray().get(1).getAsDouble()); });
                    break;
                }
                default: {
                    SimAnalog a = new SimAnalog(at >= 0 ? at : analogPort++);
                    map.put(name, a);
                    sensors.put(name, v -> { if (v.isJsonPrimitive()) a.volts = Math.max(0, Math.min(a.getMaxVoltage(), v.getAsDouble())); });
                    devices.put(name, a::getVoltage);
                }
            }
        }
        // Where the parts and sensors are as the program starts, so init() reads them (and zeroes encoders there).
        if (hub.has("state") && hub.get("state").isJsonObject()) {
            JsonObject state = hub.getAsJsonObject("state");
            kinematicsState(state.has("kin") && state.get("kin").isJsonObject() ? state.getAsJsonObject("kin") : null);
            sensorState(state.has("sensors") && state.get("sensors").isJsonObject() ? state.getAsJsonObject("sensors") : null);
        }
        className = hub.get("opmode").getAsString();
    }

    private static double millimetres(JsonElement v) { return v != null && v.isJsonPrimitive() && Double.isFinite(v.getAsDouble()) ? Math.max(0, v.getAsDouble()) : Double.POSITIVE_INFINITY; }
    private static float channel(JsonObject o, String key) { return o.has(key) && o.get(key).isJsonPrimitive() ? (float) Math.max(0, Math.min(1, o.get(key).getAsDouble())) : 0; }

    /** Compiles the team files, runs the OpMode's init and returns once it waits for start. */
    public static VirtualHub start(JsonObject hub, double heading, File workDir) throws Exception {
        VirtualHub v = new VirtualHub(hub, heading);
        Class<?> type = compile(hub.getAsJsonObject("files"), v.className, workDir);
        OpMode opMode;
        try {
            opMode = (OpMode) type.getDeclaredConstructor().newInstance();
        } catch (ClassCastException e) {
            throw new HubException("compile", v.className + " must extend OpMode or LinearOpMode.", List.of(), e);
        }
        opMode.hardwareMap = v.map;
        opMode.telemetry = v.telemetry;
        v.opMode = opMode;
        Runnable body = opMode instanceof LinearOpMode ? () -> {
            try {
                ((LinearOpMode) opMode).runOpMode();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        } : () -> {
            opMode.init();
            while (!OpModeHost.started() && !OpModeHost.stopRequested()) { opMode.init_loop(); OpModeHost.sync(); }
            if (OpModeHost.stopRequested()) return;
            opMode.start();
            while (!OpModeHost.stopRequested()) { opMode.loop(); OpModeHost.sync(); }
            opMode.stop();
        };
        if (!OpModeHost.launch(body, 20000)) throw new HubException("init", "init took longer than 20 s without reaching waitForStart().", List.of(), null);
        v.check("init");
        return v;
    }

    private static Class<?> compile(JsonObject files, String className, File workDir) throws Exception {
        File src = new File(workDir, "teamcode"), out = new File(workDir, "teamcode-classes");
        out.mkdirs();
        List<File> sources = new ArrayList<>();
        for (Map.Entry<String, JsonElement> e : files.entrySet()) {
            String rel = e.getKey();
            if (!rel.matches("[A-Za-z0-9_/]+\\.java") || rel.contains("..")) throw new HubException("compile", "Invalid team file name " + rel, List.of(), null);
            File file = new File(src, rel);
            file.getParentFile().mkdirs();
            Files.write(file.toPath(), e.getValue().getAsString().getBytes(StandardCharsets.UTF_8));
            sources.add(file);
        }
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new HubException("compile", "The bundled Java runtime has no compiler.", List.of(), null);
        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
        boolean ok;
        try (StandardJavaFileManager fm = compiler.getStandardFileManager(diagnostics, Locale.ROOT, StandardCharsets.UTF_8)) {
            List<String> options = List.of("-classpath", System.getProperty("java.class.path"), "-d", out.getAbsolutePath(), "-proc:none", "-Xlint:none", "--release", "17");
            ok = compiler.getTask(new StringWriter(), fm, diagnostics, options, null, fm.getJavaFileObjectsFromFiles(sources)).call();
        }
        if (!ok) {
            List<String> lines = new ArrayList<>();
            for (Diagnostic<? extends JavaFileObject> d : diagnostics.getDiagnostics())
                if (d.getKind() == Diagnostic.Kind.ERROR && lines.size() < 20)
                    lines.add((d.getSource() == null ? "" : new File(d.getSource().toUri()).getName()) + ":" + d.getLineNumber() + ": " + d.getMessage(Locale.ROOT));
            throw new HubException("compile", lines.isEmpty() ? "Compilation failed." : lines.get(0), lines, null);
        }
        URLClassLoader loader = new URLClassLoader(new URL[] {out.toURI().toURL()}, VirtualHub.class.getClassLoader());
        try {
            return Class.forName(className, true, loader);
        } catch (ClassNotFoundException e) {
            throw new HubException("compile", "No OpMode class " + className + " in the exported files.", List.of(), e);
        }
    }

    private void check(String stage) {
        Throwable failure = OpModeHost.failure();
        if (failure == null) return;
        List<String> frames = new ArrayList<>();
        for (StackTraceElement f : failure.getStackTrace()) if (frames.size() < 12) frames.add(f.toString());
        String message = failure.getMessage();
        throw new HubException(stage, failure.getClass().getSimpleName() + (message == null ? "" : ": " + message), frames, failure);
    }

    /**
     * One physics tick: robot-frame odometry deltas (dx forward, dy left, inches) and the gyro
     * heading feed every virtual sensor, then the OpMode runs until its next sync point.
     */
    public void tick(double dx, double dy, double heading, double dt) throws InterruptedException {
        double turn = AngleUnit_normalize(heading - gyro);
        gyro = heading;
        imu.heading = heading;
        imu.rate = dt > 0 ? turn / dt : 0;
        double k = turnArm * turn;
        if (tank) {
            // Tank wheel travel: each side rolls forward, plus or minus the turn at the half-track.
            for (Map.Entry<String, SimMotor> e : drive.entrySet()) e.getValue().advance((left(e.getKey()) ? dx - k : dx + k) * wheelTicksPerInch, dt);
        } else {
            // Mecanum wheel travel (forward-positive) for dx, dy, turn: standard mecanum wheel mixing.
            double[] travel = {dx - dy - k, dx + dy + k, dx + dy - k, dx - dy + k};
            String[] corners = {"frontLeft", "frontRight", "backLeft", "backRight"};
            for (int i = 0; i < 4; i++) { SimMotor m = drive.get(corners[i]); if (m != null) m.advance(travel[i] * wheelTicksPerInch, dt); }
        }
        for (Pod p : pods) p.port.advance((p.forward ? dx - p.y * turn : dy + p.x * turn) * p.ticksPerInch, dt);
        if (pinpoint != null) pinpoint.advance(dx, dy, turn, dt);
        if (otos != null) otos.advance(dx, dy, turn, dt);
        if (!OpModeHost.step(2000)) throw new HubException("loop", "The OpMode ran for more than 2 s without calling opModeIsActive(), idle() or sleep().", List.of(), null);
        check("loop");
    }

    private static double AngleUnit_normalize(double radians) {
        return org.firstinspires.ftc.robotcore.external.navigation.AngleUnit.normalizeRadians(radians);
    }

    /** Chassis command (forward, strafe left, turn CCW, float) from the wheel commands. */
    public double[] command() {
        boolean coast = true;
        for (SimMotor m : drive.values()) coast &= m.getZeroPowerBehavior() == DcMotor.ZeroPowerBehavior.FLOAT;
        if (tank) {
            double l = 0, r = 0;
            int nl = 0, nr = 0;
            for (Map.Entry<String, SimMotor> e : drive.entrySet()) {
                if (left(e.getKey())) { l += e.getValue().wheelCommand(); nl++; } else { r += e.getValue().wheelCommand(); nr++; }
            }
            l /= Math.max(1, nl);
            r /= Math.max(1, nr);
            return new double[] {(l + r) / 2, 0, (r - l) / 2, coast ? 1 : 0};
        }
        double fl = wheel("frontLeft"), fr = wheel("frontRight"), bl = wheel("backLeft"), br = wheel("backRight");
        return new double[] {(fl + fr + bl + br) / 4, (-fl + fr + bl - br) / 4, (-fl + fr - bl + br) / 4, coast ? 1 : 0};
    }

    private static boolean left(String key) {
        return key.toLowerCase(Locale.ROOT).contains("left");
    }

    private double wheel(String corner) {
        SimMotor m = drive.get(corner);
        return m == null ? 0 : m.wheelCommand();
    }

    /** How a mechanism device is mounted: -1 when it turns the other way (the setup says so), else 1. */
    private static int mount(JsonObject device) { return device.has("mount") && device.get("mount").getAsInt() < 0 ? -1 : 1; }

    /** The simulator's flywheel speed (a fraction of full) and turret angle, read by the OpMode through the encoders. */
    public void mechanismState(JsonObject state) {
        if (state == null) return;
        for (int i = 0; i < shooters.size(); i++) {
            Shooter s = shooters.get(i);
            // Every flywheel motor reports the shared flywheel speed, as its own encoder sees it.
            if (state.has("flywheel")) for (int k = 0; k < s.flywheels.size(); k++) s.flywheels.get(k).encoder(0, s.flywheelMounts.get(k) * state.get("flywheel").getAsDouble() * s.full);
            // Each turret reads its own angle; older states carry one shared angle.
            boolean own = state.has("turrets") && state.getAsJsonArray("turrets").size() > i;
            if (s.turret != null && (own || state.has("turret"))) s.turret.encoder(s.turretMount * (own ? state.getAsJsonArray("turrets").get(i).getAsDouble() : state.get("turret").getAsDouble()) * s.turretTicksPerDegree, 0);
        }
    }

    /** What the OpMode commands its mechanisms to do this tick. The simulator runs intakes and shooters together, so it
     * reads whether any intake pulls pieces in (every roller of an intake has to pull in), the strongest forward feed
     * and flywheel command (0 when nothing runs forward), and each turret's angle. */
    public JsonObject mechanismOutputs() {
        JsonObject out = new JsonObject();
        if (!rollers.isEmpty() || !kickers.isEmpty()) {
            double intake = 0;
            for (List<DoubleSupplier> part : rollers.values()) {
                double weakest = Double.POSITIVE_INFINITY;
                for (DoubleSupplier r : part) weakest = Math.min(weakest, r.getAsDouble());
                intake = Math.max(intake, weakest);
            }
            for (int i = 0; i < kickers.size(); i++) {
                double p = kickers.get(i).output(), down = kickerPositions.get(i)[0], up = kickerPositions.get(i)[1];
                if (!Double.isNaN(p) && Math.abs(p - down) < Math.abs(p - up)) intake = 1;
            }
            out.addProperty("intake", intake);
        }
        if (!ramps.isEmpty()) {
            // 1 while any ramp servo sits nearer its down position than its up one.
            double ramp = 0;
            for (int i = 0; i < ramps.size(); i++) {
                double p = ramps.get(i).output(), down = rampPositions.get(i)[0], up = rampPositions.get(i)[1];
                if (!Double.isNaN(p) && Math.abs(p - down) < Math.abs(p - up)) ramp = 1;
            }
            out.addProperty("ramp", ramp);
        }
        if (!shooters.isEmpty()) {
            double indexer = 0, flywheel = 0;
            com.google.gson.JsonArray degrees = new com.google.gson.JsonArray();
            for (Shooter s : shooters) {
                indexer = Math.max(indexer, s.feeder.getAsDouble());
                flywheel = Math.max(flywheel, s.flywheel());
                // Each turret's own commanded angle (null for a fixed shooter or one not yet positioned).
                double target = s.turretTarget();
                if (!Double.isNaN(target) && !out.has("turretDeg")) out.addProperty("turretDeg", target);
                if (Double.isNaN(target)) degrees.add(com.google.gson.JsonNull.INSTANCE); else degrees.add(target);
            }
            out.addProperty("indexer", indexer);
            out.addProperty("flywheel", flywheel);
            out.add("turretDegs", degrees);
        }
        return out;
    }
    /** Where each motor-driven part is ({id: [value, value a second]}), read by the code through its motor's encoder. */
    public void kinematicsState(JsonObject state) {
        if (state == null) return;
        for (Part p : parts) {
            if (p.motor == null || !state.has(p.id) || !state.get(p.id).isJsonArray()) continue;
            com.google.gson.JsonArray q = state.getAsJsonArray(p.id);
            if (q.size() < 2) continue;
            p.motor.encoder(p.mount * q.get(0).getAsDouble() * p.countsPerUnit, p.mount * q.get(1).getAsDouble() * p.countsPerUnit);
        }
    }

    /** Each sensor's reading this tick ({name: reading}); a sensor not mentioned keeps its last reading. */
    public void sensorState(JsonObject state) {
        if (state == null) return;
        sensors.forEach((name, feed) -> { if (state.has(name)) feed.accept(state.get(name)); });
    }

    /** What the code commands each part to do this tick ({id: {value} | {value, power} | {power} | {velocity}}). */
    public JsonObject kinematicsOutputs() {
        JsonObject out = new JsonObject();
        for (Part p : parts) { JsonObject c = p.command(); if (c != null) out.add(p.id, c); }
        return out;
    }
    public boolean hasKinematics() { return !parts.isEmpty(); }
    public Map<String, String> telemetry() { return telemetry.shown(); }

    /** Gamepad 1 or 2 as the Driver Station sends it: sticks and triggers, then buttons. */
    public void gamepad(int user, JsonObject g) {
        if (opMode == null || g == null) return;
        com.qualcomm.robotcore.hardware.Gamepad pad = user == 2 ? opMode.gamepad2 : opMode.gamepad1;
        pad.left_stick_x = axis(g, "left_stick_x"); pad.left_stick_y = axis(g, "left_stick_y");
        pad.right_stick_x = axis(g, "right_stick_x"); pad.right_stick_y = axis(g, "right_stick_y");
        pad.left_trigger = axis(g, "left_trigger"); pad.right_trigger = axis(g, "right_trigger");
        pad.dpad_up = button(g, "dpad_up"); pad.dpad_down = button(g, "dpad_down"); pad.dpad_left = button(g, "dpad_left"); pad.dpad_right = button(g, "dpad_right");
        pad.a = button(g, "a"); pad.b = button(g, "b"); pad.x = button(g, "x"); pad.y = button(g, "y");
        pad.guide = button(g, "guide"); pad.start = button(g, "start"); pad.back = button(g, "back");
        pad.left_bumper = button(g, "left_bumper"); pad.right_bumper = button(g, "right_bumper");
        pad.left_stick_button = button(g, "left_stick_button"); pad.right_stick_button = button(g, "right_stick_button");
    }

    private static float axis(JsonObject g, String name) {
        if (!g.has(name) || !g.get(name).isJsonPrimitive()) return 0;
        double v = g.get(name).getAsDouble();
        return Double.isFinite(v) ? (float) Math.max(-1, Math.min(1, v)) : 0;
    }

    private static boolean button(JsonObject g, String name) { return g.has(name) && g.get(name).isJsonPrimitive() && g.get(name).getAsBoolean(); }

    /** Each named device's effect this tick (see devices); null where it has none. */
    public JsonObject devices() {
        JsonObject out = new JsonObject();
        devices.forEach((name, effect) -> { double v = effect.getAsDouble(); if (Double.isNaN(v)) out.add(name, com.google.gson.JsonNull.INSTANCE); else out.addProperty(name, v); });
        return out;
    }
    public boolean done() { return OpModeHost.finished(); }
    public String opMode() { return className; }
    public void stop() { OpModeHost.stop(); }
}
