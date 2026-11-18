package deck.sim;

import deck.pathing.DeckFollower;
import deck.pathing.DeckFollower.Pose;
import java.util.ArrayDeque;

/**
 * Built-in program: follow the planned route leg by leg. At each pin with a pause the robot
 * holds its position for the pause (the time a mechanism action takes), then continues.
 * Turning routes (tank drivetrains, or holonomic routes that turn to fit past an obstacle) stop
 * and turn in place before a leg whose heading differs. A pin can also turn the robot in place
 * after it arrives (before its pause), and an action path reports its action while it is driven.
 * If the robot stalls against something mid-leg it backs out to where it recently drove,
 * straightens up and resumes the leg. If it is stopped just short of a leg's end (game pieces trapped
 * against a wall, say), it stops pushing, reports it and carries on from where it is.
 */
public final class RouteAutonomous implements DeckAutonomous {
    private int leg, movingPath;
    private double arrived = -1, pathEnded = -1, movingStarted;
    private final boolean turning;
    private boolean turningNow, turnThenFollow, turnedAfter;
    private double turnStarted, turnTarget;
    private static final double SETTLE_SECONDS = .15;
    // The simulator answers one tick later, so a pin action waits this long before it can count as done. A pin with
    // several steps (Shoot, then Ramp down, then Intake...) runs as one action, so the limit is a whole autonomous period.
    private static final double MECHANISM_START = 0.05, MECHANISM_LIMIT = 30;
    private double settleStarted = -1, settleHeading;
    // Stall recovery: recent poses, the moment progress stopped, and the back-out target.
    private static final double STALL_SPEED = 1.5, STALL_SECONDS = .8, BACKOFF_SECONDS = 2.5;
    private static final int MAX_RECOVERIES = 3;
    private final ArrayDeque<double[]> history = new ArrayDeque<>();
    private double legStarted, slowSince = -1, backoffStarted = -1;
    private Pose backoff;
    private int recoveries;
    // Stopped short: within this distance of the leg's end and not moving for this long.
    private static final double SHORT_DISTANCE = 3, SHORT_SECONDS = 1;
    private double shortSince = -1;
    private boolean stoppedShort;
    public RouteAutonomous() { this(false); }
    public RouteAutonomous(boolean turning) { this.turning = turning; }
    private void beginLeg(SimRobot robot) {
        robot.telemetry("leg", (leg + 1) + " of " + robot.routeLegs().size());
        robot.applyLegPower(leg);
        if (robot.legPower(leg) == 0) { robot.follower().stop(); return; }
        Pose p = robot.follower().pose();
        double target = robot.legHeading(leg);
        recoveries = 0;
        turnedAfter = false;
        stoppedShort = false;
        double previousHeading=leg==0?robot.startPose().heading():!Double.isNaN(robot.turnAfter(leg-1))?robot.turnAfter(leg-1):robot.routeLegs().get(leg-1).endPose().heading();
        if (turning && Math.abs(Math.atan2(Math.sin(target - previousHeading), Math.cos(target - previousHeading))) > Math.toRadians(.5)) startTurn(robot, target, true);
        else startFollowing(robot);
    }
    private void startTurn(SimRobot robot, double target, boolean thenFollow) {
        Pose p = robot.follower().pose();
        robot.follower().hold(new Pose(p.x(), p.y(), target));
        turningNow = true;
        turnThenFollow = thenFollow;
        turnTarget = target;
        turnStarted = robot.time();
        settleStarted = -1;
    }
    private void startFollowing(SimRobot robot) {
        robot.follower().follow(robot.routeLegs().get(leg));
        legStarted = robot.time();
        slowSince = shortSince = -1;
        history.clear();
    }

    @Override
    public void init(SimRobot robot) {
        if (robot.routeLegs().isEmpty()) throw new IllegalStateException("Plan a route before running it.");
        robot.follower().setPose(robot.startPose());
        beginLeg(robot);
    }

    @Override
    public void loop(SimRobot robot) {
        if (robot.legPower(leg) == 0) { robot.follower().stop(); robot.telemetry("phase", "Zero motor power: stopped"); return; }
        DeckFollower follower = robot.follower();
        follower.update();
        robot.telemetry("leg", (leg + 1) + " of " + robot.routeLegs().size());
        if (turningNow) {
            double error = Math.atan2(Math.sin(turnTarget - follower.pose().heading()), Math.cos(turnTarget - follower.pose().heading()));
            robot.telemetry("phase", turnThenFollow ? "Turning chassis" : "Turning at pin");
            if (robot.time() - turnStarted > 30) throw new IllegalStateException("Chassis turn did not settle within 30 seconds. Check clearance, motor power, gearing and sensor calibration.");
            // The localizer's per-tick angular velocity carries sensor noise, so judge settling by the
            // average rotation rate over a window spent inside the heading tolerance.
            if (Math.abs(error) > Math.toRadians(1.5)) { settleStarted = -1; return; }
            if (settleStarted < 0) { settleStarted = robot.time(); settleHeading = follower.pose().heading(); return; }
            double window = robot.time() - settleStarted;
            if (window < SETTLE_SECONDS) return;
            double drift = Math.atan2(Math.sin(follower.pose().heading() - settleHeading), Math.cos(follower.pose().heading() - settleHeading));
            if (Math.abs(drift) / window > .08) { settleStarted = -1; return; }
            settleStarted = -1;
            turningNow = false;
            // A turn at a pin ends with the robot in place: its pause counts from here.
            if (turnThenFollow) startFollowing(robot);
            else arrived = robot.time();
            return;
        }
        if (backoff != null) {
            robot.telemetry("phase", "Backing out");
            if (!robot.near(backoff, 1, 5) && robot.time() - backoffStarted < BACKOFF_SECONDS) return;
            backoff = null;
            startFollowing(robot);
            return;
        }
        // An action path's action runs from the start of its path, for its set time or the whole path.
        String moving = robot.movingAction(leg);
        if (!moving.isEmpty() && robot.legPath(leg) != movingPath) { movingPath = robot.legPath(leg); movingStarted = robot.time(); }
        double movingFor = robot.movingSeconds(leg);
        boolean movingOn = !moving.isEmpty() && (Double.isNaN(movingFor) || robot.time() - movingStarted < movingFor);
        robot.telemetry("phase", movingOn ? "Action path: " + moving : "Driving leg");
        if (movingOn && follower.following()) robot.acting(leg, moving, true);
        boolean through=leg+1<robot.routeLegs().size()&&robot.stopWait(leg)==0&&robot.stopAction(leg).isEmpty()&&Double.isNaN(robot.turnAfter(leg))&&DeckFollower.continuous(robot.routeLegs().get(leg),robot.routeLegs().get(leg+1));
        if (through&&follower.remainingDistance()<1.5&&robot.near(robot.routeLegs().get(leg).endPose(),1.5,3)) {
            leg++;arrived=pathEnded=-1;beginLeg(robot);return;
        }
        if (follower.following()) {
            if (stoppedShort(robot, follower)) {
                // Pushing harder will not move what is in the way: hold here and let the route go on.
                Pose p = follower.pose(), end = robot.routeLegs().get(leg).endPose();
                stoppedShort = true;
                robot.telemetry("blocked", String.format("Leg %d stopped %.1f in short of its end point", leg + 1, p.distance(end)));
                follower.hold(new Pose(p.x(), p.y(), end.heading()));
                return;
            }
            if (stalled(robot, follower)) {
                if (++recoveries > MAX_RECOVERIES) {
                    Pose p = follower.pose();
                    throw new IllegalStateException(String.format("The robot is stuck near (%.0f, %.0f) in and backing out did not free it. A wall, a field part or game pieces against them are in the way: move the pins away from there or increase Space around zones.", p.x(), p.y()));
                }
                Pose p = follower.pose(), end = robot.routeLegs().get(leg).endPose();
                double[] back = history.peekFirst();
                if (back == null) {
                    double d = Math.max(1e-6, Math.hypot(end.x() - p.x(), end.y() - p.y()));
                    back = new double[] { 0, p.x() - 4 * (end.x() - p.x()) / d, p.y() - 4 * (end.y() - p.y()) / d };
                }
                backoff = new Pose(back[1], back[2], end.heading());
                history.clear();
                backoffStarted = robot.time();
                follower.hold(backoff);
            }
            return;
        }
        Pose end = robot.routeLegs().get(leg).endPose();
        if (turnedAfter) end = new Pose(end.x(), end.y(), robot.turnAfter(leg));
        // The controller finishing a leg does not guarantee a stationary chassis. Wait until the estimate
        // has actually settled (bounded at 3 s), then count the pause from the moment it stopped.
        // The follower ends a leg within 0.8 in of its end, so settling must not ask for less: at 0.75 a robot that
        // stopped 0.76 to 0.8 in away waited out both 3 s limits (6 s standing still) before going on.
        boolean settled = stoppedShort || robot.near(end, 0.9, 3) && follower.velocity().linSpeed() < .5;
        if (pathEnded < 0) pathEnded = robot.time();
        if (arrived < 0 && (settled || robot.time() - pathEnded > 3)) {
            double turnAfter = robot.turnAfter(leg);
            if (!turnedAfter && !Double.isNaN(turnAfter)) {
                turnedAfter = true;
                robot.moving();
                startTurn(robot, turnAfter, false);
                return;
            }
            arrived = robot.time();
        }
        double pause = robot.stopWait(leg);
        if (arrived < 0) { if (pause > 0) robot.waiting(leg, robot.stopAction(leg), pause); return; }
        double held = robot.time() - arrived;
        boolean last = leg == robot.routeLegs().size() - 1;
        String action = robot.stopAction(leg);
        // At a pin: pause first, then run the action for its set time (or until it finishes), then drive on.
        if (held < pause) { robot.waiting(leg, action, pause - held); robot.telemetry("phase", "Pause"); return; }
        double acted = held - pause, actFor = robot.actionSeconds(leg);
        boolean busy = !action.isEmpty() && (Double.isNaN(actFor)
            // Until it finishes, bounded so a jammed mechanism cannot hold the route forever.
            ? acted < MECHANISM_START || robot.mechanismBusy() && acted < MECHANISM_LIMIT
            : acted < actFor);
        if (busy) { robot.acting(leg, action, false); robot.telemetry("phase", "Action: " + action); }
        if (busy || (!settled && held < pause + 3)) return;
        robot.moving();
        if (last) {
            robot.finish();
            return;
        }
        leg++;
        arrived = -1;
        pathEnded = -1;
        beginLeg(robot);
    }

    // Stopped short: barely moving for a while with the leg's end close but out of reach. (Farther from the
    // end it is a stall, which backs out and tries again.)
    private boolean stoppedShort(SimRobot robot, DeckFollower follower) {
        double now = robot.time();
        if (now - legStarted < .5 || follower.remainingDistance() >= SHORT_DISTANCE || follower.velocity().linSpeed() > STALL_SPEED) { shortSince = -1; return false; }
        if (shortSince < 0) shortSince = now;
        return now - shortSince > SHORT_SECONDS;
    }

    // Stalled: barely moving for a while with the leg's end still well ahead. History keeps the last
    // ~1.2 seconds of poses where the robot was moving, so the back-out target is a spot it recently
    // drove through (and was therefore clear), however long it has been stuck.
    private boolean stalled(SimRobot robot, DeckFollower follower) {
        Pose p = follower.pose();
        double now = robot.time();
        if (now - legStarted < .5 || follower.remainingDistance() < 3 || follower.velocity().linSpeed() > STALL_SPEED) {
            history.addLast(new double[] { now, p.x(), p.y() });
            while (history.size() > 1 && now - history.peekFirst()[0] > 1.2) history.removeFirst();
            slowSince = -1;
            return false;
        }
        if (slowSince < 0) slowSince = now;
        return now - slowSince > STALL_SECONDS;
    }
}
