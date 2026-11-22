package deck.sim.hub;

import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;
import com.qualcomm.hardware.sparkfun.SparkFunOTOS;
import com.qualcomm.robotcore.hardware.IMU;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.AngularVelocity;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.Pose2D;
import org.firstinspires.ftc.robotcore.external.navigation.UnnormalizedAngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.YawPitchRollAngles;

/**
 * Virtual sensors on the Control Hub, fed each tick from the simulator's sensor model (its
 * odometry deltas carry the configured noise/scale error; its heading carries gyro drift).
 */
final class SimSensors {
    private SimSensors() {}

    /** The Control Hub's built-in IMU: yaw from the simulated gyro, zeroed by resetYaw(). */
    static final class Imu implements IMU {
        double heading, rate, zero;
        @Override public boolean initialize(Parameters parameters) { return true; }
        @Override public void resetYaw() { zero = heading; }
        @Override public YawPitchRollAngles getRobotYawPitchRollAngles() {
            return new YawPitchRollAngles(AngleUnit.RADIANS, AngleUnit.normalizeRadians(heading - zero), 0, 0, deck.sim.SimClock.nanoTime());
        }
        @Override public AngularVelocity getRobotAngularVelocity(AngleUnit unit) {
            return new AngularVelocity(unit, 0, 0, (float) unit.getUnnormalized().fromRadians(rate), deck.sim.SimClock.nanoTime());
        }
    }

    private static double num(com.google.gson.JsonObject o, String key, double fallback) { return o != null && o.has(key) && o.get(key).isJsonPrimitive() ? o.get(key).getAsDouble() : fallback; }
    private static boolean flag(com.google.gson.JsonObject o, String key) { return o != null && o.has(key) && o.get(key).isJsonPrimitive() && o.get(key).getAsBoolean(); }

    /**
     * goBILDA Pinpoint: two pods and its own IMU. The pods are mounted as the setup says (the truth: the forward X pod's
     * inches left of centre, the strafe Y pod's inches forward of it, which way each counts and its ticks per inch). The
     * chip turns their counts into a pose with what the code configured (setOffsets, setEncoderDirections,
     * setEncoderResolution), as the real one does: configured as mounted, it tracks the robot's centre; configured otherwise,
     * it is off the way the real one would be. A chip the code never configures has offsets 0, both pods forward and 4-bar pods.
     * A Pinpoint alone (pods false: no pods plugged in) is only an IMU: its heading turns with the robot, its pod counts and
     * position stay at what they were, and it reports that it finds no pods (FAULT_NO_PODS_DETECTED, its LED purple), never
     * READY, as goBILDA's driver does.
     */
    static final class Pinpoint extends GoBildaPinpointDriver {
        private static final double FOUR_BAR = 19.894367218017578 * 25.4, SWINGARM = 13.262911796569824 * 25.4;
        private final double podLeft, podForward, ticksPerInch;
        private final int signX, signY;
        private final boolean pods;
        private double xOffset, yOffset, resolution = FOUR_BAR, rawX, rawY, x, y, heading, vx, vy, omega;
        private int dirX = 1, dirY = 1;
        Pinpoint(com.google.gson.JsonObject mount) { this(mount, true); }
        Pinpoint(com.google.gson.JsonObject mount, boolean pods) {
            podLeft = num(mount, "xOffset", 0); podForward = num(mount, "yOffset", 0); ticksPerInch = num(mount, "ticksPerMm", 19.894367218017578) * 25.4;
            signX = flag(mount, "xReversed") ? -1 : 1; signY = flag(mount, "yReversed") ? -1 : 1; this.pods = pods;
        }
        /** One tick: the robot moved dx forward and dy left (inches, its own frame) and turned by turn radians. */
        void advance(double dx, double dy, double turn, double dt) {
            if (!pods) { heading = AngleUnit.normalizeRadians(heading + turn); omega = dt > 0 ? turn / dt : 0; return; }
            double countX = signX * (dx - podLeft * turn) * ticksPerInch, countY = signY * (dy + podForward * turn) * ticksPerInch;
            rawX += countX; rawY += countY;
            // The chip: each pod's travel as configured, less what turning moves a pod at the configured offset.
            double fx = dirX * countX / resolution + xOffset * turn, fy = dirY * countY / resolution - yOffset * turn, mid = heading + turn / 2;
            double wx = fx * Math.cos(mid) - fy * Math.sin(mid), wy = fx * Math.sin(mid) + fy * Math.cos(mid);
            x += wx; y += wy; heading = AngleUnit.normalizeRadians(heading + turn);
            vx = dt > 0 ? wx / dt : 0; vy = dt > 0 ? wy / dt : 0; omega = dt > 0 ? turn / dt : 0;
        }
        @Override public void update() {}
        @Override public void setOffsets(double xOffset, double yOffset, DistanceUnit distanceUnit) { this.xOffset = distanceUnit.toInches(xOffset); this.yOffset = distanceUnit.toInches(yOffset); }
        @Override public void setEncoderResolution(GoBildaOdometryPods pods) { resolution = pods == GoBildaOdometryPods.goBILDA_SWINGARM_POD ? SWINGARM : FOUR_BAR; }
        @Override public void setEncoderResolution(double ticksPerUnit, DistanceUnit distanceUnit) { resolution = ticksPerUnit / distanceUnit.toInches(1); }
        @Override public void setEncoderDirections(EncoderDirection xEncoder, EncoderDirection yEncoder) { dirX = xEncoder == EncoderDirection.REVERSED ? -1 : 1; dirY = yEncoder == EncoderDirection.REVERSED ? -1 : 1; }
        @Override public void resetPosAndIMU() { x = 0; y = 0; heading = 0; }
        @Override public void recalibrateIMU() {}
        @Override public void setPosition(Pose2D pos) { x = pos.getX(DistanceUnit.INCH); y = pos.getY(DistanceUnit.INCH); heading = pos.getHeading(AngleUnit.RADIANS); }
        /** The pods' own counts (Deck's check measures with both pods set forward). */
        @Override public int getEncoderX() { return (int) Math.round(rawX); }
        @Override public int getEncoderY() { return (int) Math.round(rawY); }
        @Override public double getPosX(DistanceUnit unit) { return unit.fromInches(x); }
        @Override public double getPosY(DistanceUnit unit) { return unit.fromInches(y); }
        @Override public double getHeading(AngleUnit unit) { return unit.fromRadians(heading); }
        @Override public double getVelX(DistanceUnit unit) { return unit.fromInches(vx); }
        @Override public double getVelY(DistanceUnit unit) { return unit.fromInches(vy); }
        @Override public double getHeadingVelocity(UnnormalizedAngleUnit unit) { return unit.fromRadians(omega); }
        @Override public DeviceStatus getDeviceStatus() { return pods ? DeviceStatus.READY : DeviceStatus.FAULT_NO_PODS_DETECTED; }
    }

    /**
     * SparkFun OTOS: an optical chip that measures how it moves, in its own X and Y axes, and turns. It reports the
     * robot's pose through the offset the code sets, as SparkFun defines it: where the chip sits on the robot (x forward,
     * y left) and where its X axis points (counterclockwise from the robot's front). Its mounting and the scalars it needs
     * (it reads distance and turns 1/scalar short) are the truth from the setup.
     */
    static final class Otos extends SparkFunOTOS {
        private final double mountX, mountY, mountHeading, needLinear, needAngular;
        private DistanceUnit linear = DistanceUnit.INCH;
        private AngleUnit angular = AngleUnit.DEGREES;
        private Pose2D offset = new Pose2D();
        private double ox, oy, oh, linearScalar = 1, angularScalar = 1, sx, sy, sh, vx, vy, omega;
        Otos(com.google.gson.JsonObject mount) {
            mountX = num(mount, "x", 0); mountY = num(mount, "y", 0); mountHeading = Math.toRadians(num(mount, "heading", 0));
            needLinear = num(mount, "linearScalar", 1); needAngular = num(mount, "angularScalar", 1);
        }
        void advance(double dx, double dy, double turn, double dt) {
            // How the chip itself moved, in the robot's frame, then in its own axes, as it reads it.
            double cx = dx - mountY * turn, cy = dy + mountX * turn, c = Math.cos(mountHeading), s = Math.sin(mountHeading);
            double mx = (cx * c + cy * s) / needLinear * linearScalar, my = (-cx * s + cy * c) / needLinear * linearScalar, t = turn / needAngular * angularScalar, mid = sh + t / 2;
            double[] before = robot();
            sx += mx * Math.cos(mid) - my * Math.sin(mid); sy += mx * Math.sin(mid) + my * Math.cos(mid); sh = AngleUnit.normalizeRadians(sh + t);
            double[] after = robot();
            vx = dt > 0 ? (after[0] - before[0]) / dt : 0; vy = dt > 0 ? (after[1] - before[1]) / dt : 0; omega = dt > 0 ? t / dt : 0;
        }
        /** The robot's pose from the chip's: its heading less the offset's, its position less the offset turned with it. */
        private double[] robot() {
            double h = sh - oh, c = Math.cos(h), s = Math.sin(h);
            return new double[] {sx - (ox * c - oy * s), sy - (ox * s + oy * c), AngleUnit.normalizeRadians(h)};
        }
        private void place(double x, double y, double h) { double c = Math.cos(h), s = Math.sin(h); sh = h + oh; sx = x + ox * c - oy * s; sy = y + ox * s + oy * c; }
        @Override public DistanceUnit getLinearUnit() { return linear; }
        @Override public void setLinearUnit(DistanceUnit unit) { linear = unit; }
        @Override public AngleUnit getAngularUnit() { return angular; }
        @Override public void setAngularUnit(AngleUnit unit) { angular = unit; }
        @Override public boolean calibrateImu() { return true; }
        @Override public void resetTracking() { place(0, 0, 0); }
        @Override public Pose2D getOffset() { return new Pose2D(offset.x, offset.y, offset.h); }
        @Override public void setOffset(Pose2D pose) { offset = new Pose2D(pose.x, pose.y, pose.h); ox = linear.toInches(pose.x); oy = linear.toInches(pose.y); oh = angular.toRadians(pose.h); }
        @Override public boolean setLinearScalar(double scalar) { if (scalar < MIN_SCALAR || scalar > MAX_SCALAR) return false; linearScalar = scalar; return true; }
        @Override public boolean setAngularScalar(double scalar) { if (scalar < MIN_SCALAR || scalar > MAX_SCALAR) return false; angularScalar = scalar; return true; }
        @Override public double getLinearScalar() { return linearScalar; }
        @Override public double getAngularScalar() { return angularScalar; }
        @Override public Pose2D getPosition() { double[] r = robot(); return new Pose2D(linear.fromInches(r[0]), linear.fromInches(r[1]), angular.fromRadians(r[2])); }
        @Override public void setPosition(Pose2D pose) { place(linear.toInches(pose.x), linear.toInches(pose.y), angular.toRadians(pose.h)); }
        @Override public Pose2D getVelocity() { return new Pose2D(linear.fromInches(vx), linear.fromInches(vy), angular.getUnnormalized().fromRadians(omega)); }
    }
}
