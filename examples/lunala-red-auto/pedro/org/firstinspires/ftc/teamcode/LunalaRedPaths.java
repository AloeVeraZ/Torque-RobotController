package org.firstinspires.ftc.teamcode;

import com.pedropathing.api.Paths;
import com.pedropathing.math.Pose;
import com.pedropathing.math.Vector2D;
import com.pedropathing.paths.Path;
import com.pedropathing.paths.interpolator.Interpolator;

/**
 * Route "BIOBUZZ red auto" (BIOBUZZ), planned in Torque, as
 * Pedro Pathing 3.0.2 paths. Generated file: change the route in Deck and export again.
 *
 * Field frame (the same as Pedro's): inches, origin at the bottom-left field corner, +X right, +Y up,
 * heading counterclockwise from +X. Headings below are written in degrees and converted to radians.
 * Robot footprint used for clearance: 8.25 in front, 8.25 in rear, 7.75 in each side; clearance 2 in.
 *
 * The route is split into legs: the robot stops after a leg when a pause, action or turn follows,
 * and a new leg starts where the motor power changes or an action path starts or ends.
 * For each leg i: turn in place to START_HEADING[i] if needed, follow leg(i) (running MOVING_ACTIONS[i]
 * while it drives), settle, turn to TURN_AFTER[i] (unless NaN), pause WAIT_SECONDS[i], then run
 * ACTIONS[i] for ACTION_SECONDS[i]. LunalaRedPedro.java does this.
 */
public final class LunalaRedPaths {
    private LunalaRedPaths() {}

    /** Place the robot here, facing this way, before INIT. */
    public static final Pose START = new Pose(9.1, 26, Math.toRadians(-90));

    public static final int LEGS = 4;

    /** Heading each leg starts with, radians. The robot turns in place first when it is not facing it. */
    public static final double[] START_HEADING = {Math.toRadians(-90), Math.toRadians(-90), Math.toRadians(-90), Math.toRadians(-180)};

    /** Heading to turn to in place after each leg, radians (NaN: no turn). */
    public static final double[] TURN_AFTER = {Double.NaN, Double.NaN, Double.NaN, Double.NaN};

    /** Pause at the end of each leg, before its action, in seconds. */
    public static final double[] WAIT_SECONDS = {0, 0, 0, 0};

    /** Action run at the end of each leg ("" for none), as named in Deck. See RouteActions.java. */
    public static final String[] ACTIONS = {"Shoot", "Intake", "Shoot", "Shoot"};

    /** How long each end-of-leg action runs, seconds (0: until it reports done). */
    public static final double[] ACTION_SECONDS = {0, 0.2, 0, 0};

    /** Hive cell each end-of-leg action aims at: 0 the cell up at the start, 1 the other cell. */
    public static final int[] ACTION_CELL = {0, 0, 1, 1};

    /** Action run WHILE driving each leg (action paths; "" for none). */
    public static final String[] MOVING_ACTIONS = {"Spin up", "Intake", "Spin up", "Intake"};

    /** How long each action path's action runs from the start of its path, seconds (0: the whole path). */
    public static final double[] MOVING_SECONDS = {0, 0, 0, 0};

    /** Hive cell each action path's action aims at. */
    public static final int[] MOVING_CELL = {0, 0, 0, 0};

    /** Which Deck path each leg belongs to (1 = the path from the start to the first end point). */
    public static final int[] PATH = {1, 2, 3, 4};

    /** The end point each leg finishes at (0: a turn point inside a path). */
    public static final int[] PIN = {1, 2, 3, 4};

    /**
     * Speed limit per leg as a fraction of the robot's top speed (Pedro's Foresight maxPathSpeed),
     * from Deck's motor power setting. 1 means no extra limit; 0 means the robot stays stopped.
     */
    public static final double[] MAX_PATH_SPEED = {1, 1, 1, 1};

    /** Legs the robot drives straight through into the next one without stopping. */
    public static final boolean[] THROUGH = {false, false, false, false};

    /** Leg 1: ACTION PATH "Spin up" to pin 1; Off the start, pollen flywheel spinning up; run "Shoot" until done; Shoot the 4 preloads into the up (south) cell: 3 tip the hive. */
    public static Path leg1() {
        return Paths.line(v(9.1, 26), v(9.3, 22)).constant(Math.toRadians(-90));
    }

    /** Leg 2: ACTION PATH "Intake" to pin 2; Straight into the red GARDEN corner; run "Intake" for 0.2 s; Front sweeper finishes the 4 garden pollen against the audience wall. */
    public static Path leg2() {
        return Paths.line(v(9.3, 22), v(9.3, 16)).constant(Math.toRadians(-90));
    }

    /** Leg 3: ACTION PATH "Spin up" to pin 3; the robot turns to -180° while driving; One custom curve from the garden up the left side, bowing away from the wall while turning to face it; run "Shoot" until done; Behind the hive: shoot the garden pollen into the other (north) cell. */
    public static Path leg3() {
        return Paths.curve(v(9.3, 16), v(25, 38), v(20, 80), v(24, 106)).heading(turn(-90, -180));
    }

    /** Leg 4: ACTION PATH "Intake" to pin 4; Front sweeper takes the 4 loading-zone pollen off the left wall; run "Shoot" until done; PARK in the red LOADING ZONE and shoot its 4 pollen into the other cell (second tip). */
    public static Path leg4() {
        return Paths.line(v(24, 106), v(16.2, 107.3)).constant(Math.toRadians(-180));
    }

    /** Every leg in driving order. */
    public static Path[] legs() {
        return new Path[] {leg1(), leg2(), leg3(), leg4()};
    }

    private static Vector2D v(double x, double y) {
        return Vector2D.cartesian(x, y);
    }

    /** Turns steadily from one heading to another along the curve (degrees; may be more than half a turn). */
    private static Interpolator turn(double fromDegrees, double toDegrees) {
        final double from = Math.toRadians(fromDegrees), by = Math.toRadians(toDegrees - fromDegrees);
        return Interpolator.geometric((curve, t) -> from + by * t);
    }
}
