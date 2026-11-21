(function(root,factory){const model=factory();if(typeof module==='object'&&module.exports)module.exports=model;else root.DeckSimPedro=model;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Pedro Pathing 3 export: the planned route as Android Studio TeamCode for a project built from the
  // Pedro Pathing Quickstart (com.pedropathing:revhub 3.0.2 on FTC SDK 12.0.0). The team's own
  // pedro/Constants.java builds the Follower (drivetrain, localizer and tuned Foresight gains); these
  // files only add the route, the autonomous OpMode and the action slots.
  //
  // Coordinates need no conversion: Pedro and the planner share one frame (inches, origin at the
  // bottom-left field corner, +X right, +Y up, heading counterclockwise from +X).
  //
  // Only Pedro 3.0 API that exists in that release is used: com.pedropathing.api.Paths line/curve/path,
  // Path.constant/linear/facingPoint/heading/with, Interpolator.geometric, Vector2D.cartesian, Pose,
  // Follower.follow/hold/update/stop/setPose/pose/velocity/following/algorithm, Foresight.config.maxPathSpeed.at.
  const PEDRO_VERSION='3.0.2',SDK_VERSION='12.0.0',QUICKSTART_CONSTANTS='org.firstinspires.ftc.teamcode.pedro.Constants';
  const n=v=>{if(!Number.isFinite(Number(v)))throw Error('The route has a coordinate or heading that is not a number. Re-plan it before exporting.');return Number(v).toFixed(3).replace(/\.?0+$/,'').replace(/^-0$/,'0')||'0';};
  // A Java double literal: ConfigVar<Double>.set needs 4.0, not 4 (an int does not box to Double).
  const dbl=v=>{const t=n(v);return /[.eE]/.test(t)?t:t+'.0';};
  const finite=Number.isFinite,norm=d=>((d%360)+540)%360-180,rad=d=>`Math.toRadians(${n(d)})`;
  const javaString=s=>'"'+String(s).replace(/[\\"]/g,c=>'\\'+c).replace(/[\u0000-\u001f]/g,'')+'"';
  const comment=s=>String(s||'').replace(/\*\//g,'* /').replace(/\\(?=u)/g,'\\ ').replace(/[\r\n]+/g,' ').trim();
  const endOf=s=>finite(s.endHeading)?s.endHeading:s.heading;
  const JAVA_WORDS=new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield'.split(' '));
  // Type names the generated files import or declare.
  const TAKEN=new Set(['Follower','Pose','Path','Paths','Vector2D','Interpolator','Foresight','Constants','Angle','RouteActions','RobotActions','Mechanisms','LinearOpMode','ElapsedTime','Autonomous','HardwareMap','Telemetry']);
  function names(className,packageName){
    if(!/^[A-Z][A-Za-z0-9_]{0,55}$/.test(className))throw Error('Class name must start with a capital letter and use letters, digits or _.');
    if(TAKEN.has(className)||TAKEN.has(className+'Paths')||TAKEN.has(className+'Pedro'))throw Error('Class name conflicts with a Pedro Pathing or generated type. Choose a route name such as PlannedRoute.');
    if(!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(packageName))throw Error('Package must look like org.firstinspires.ftc.teamcode.');
    if(packageName.split('.').some(p=>JAVA_WORDS.has(p)))throw Error('Package names cannot contain Java reserved words.');
    return {paths:className+'Paths',opMode:className+'Pedro'};
  }
  const len=s=>{let total=0,prev=null;for(let j=0;j<=32;j++){const p=bez(s.points,j/32);if(prev)total+=Math.hypot(p.x-prev.x,p.y-prev.y);prev=p;}return total;};
  function bez(points,t){let p=points.map(q=>({x:q.x,y:q.y}));while(p.length>1)p=p.slice(1).map((q,i)=>({x:p[i].x+(q.x-p[i].x)*t,y:p[i].y+(q.y-p[i].y)*t}));return p[0];}
  // Direction of travel at the start or end of a segment (first/last distinct control point).
  function tangent(s,atEnd){const p=s.points,a=atEnd?[...p].reverse():p,q=a.find(r=>Math.hypot(r.x-a[0].x,r.y-a[0].y)>1e-6);if(!q)return null;const dx=atEnd?a[0].x-q.x:q.x-a[0].x,dy=atEnd?a[0].y-q.y:q.y-a[0].y,l=Math.hypot(dx,dy);return {x:dx/l,y:dy/l};}
  const bearing=(p,t)=>Math.atan2(t.y-p.y,t.x-p.x)*180/Math.PI;
  const startHeading=(s,fallback)=>s.tangent&&finite(s.heading)?s.heading:s.target?bearing(s.points[0],s.target):finite(s.heading)?s.heading:fallback;
  const finalHeading=(s,fallback)=>s.tangent&&finite(s.endHeading)?s.endHeading:s.target?bearing(s.points.at(-1),s.target):finite(endOf(s))?endOf(s):fallback;
  // One planner segment as a Pedro path expression with its heading interpolation.
  function segment(s,fallback){
    for(const p of s.points)if(!finite(p.x)||!finite(p.y))throw Error('The route has a point that is not a number. Re-plan it before exporting.');
    const v=p=>`v(${n(p.x)}, ${n(p.y)})`,line=s.type==='line'||s.points.length===2;
    const geometry=line?`Paths.line(${v(s.points[0])}, ${v(s.points.at(-1))})`:`Paths.curve(${s.points.map(v).join(', ')})`;
    if(s.tangent)return `${geometry}.${s.reverse?'reverseTangent':'tangent'}()`;
    if(s.target)return `${geometry}.facingPoint(${v(s.target)})`;
    const h0=finite(s.heading)?s.heading:fallback,h1=finite(s.endHeading)?s.endHeading:h0;
    if(Math.abs(h1-h0)<1e-6)return `${geometry}.constant(${rad(h0)})`;
    // Pedro's linear() takes the short way round and spreads the turn by distance travelled. On a
    // straight line under half a turn that is exactly the planned turn; otherwise the planned turn
    // (by curve parameter, possibly whole spins) is kept with a geometric interpolator.
    if(line&&Math.abs(h1-h0)<179.9)return `${geometry}.linear(${rad(h0)}, ${rad(h0+norm(h1-h0))})`;
    return `${geometry}.heading(turn(${n(h0)}, ${n(h1)}))`;
  }
  function legsOf(route,exporter){
    for(const s of route.segments)for(const p of [...s.points,...(s.target?[s.target]:[])])if(!finite(p?.x)||!finite(p?.y))throw Error('The route has a point that is not a number. Re-plan it before exporting.');
    const all=exporter.legs(route);
    for(const l of all){l.segments=l.segments.filter(s=>len(s)>1e-4);if(!l.segments.length)throw Error(`Leg to pin ${l.pin||'?'} has no length. Move that pin away from the point before it.`);}
    return all;
  }
  // Legs the robot drives straight through: nothing happens at the junction, and both the direction
  // of travel and the heading carry on (only a motor power or action-path boundary splits them).
  function throughs(legs,startH){
    let heading=startH;
    return legs.map((l,i)=>{const end=finalHeading(l.segments.at(-1),heading);heading=end;const next=legs[i+1];if(!next||l.wait>0||l.action||l.turn!==null)return false;
      const a=tangent(l.segments.at(-1),true),b=tangent(next.segments[0],false);if(!a||!b||a.x*b.x+a.y*b.y<.95)return false;
      return Math.abs(norm(end-startHeading(next.segments[0],end)))<.6;});
  }
  function pathsFile(o){
    const {route,layout,legs,P,through}=o,start=layout.start,startH=finite(start.heading)?start.heading:route.heading||0;
    let heading=startH;
    const legHeadings=legs.map(l=>{const h=startHeading(l.segments[0],heading);l.segments.forEach(s=>{heading=finalHeading(s,heading);});if(l.turn!==null)heading=l.turn;return h;});
    heading=startH;
    const methods=legs.map((l,i)=>{const exprs=l.segments.map(s=>{const e=segment(s,heading);heading=finalHeading(s,heading);return e;});if(l.turn!==null)heading=l.turn;
      const body=exprs.length===1?exprs[0]:`Paths.path(\n                ${exprs.join(',\n                ')})`;
      return `    /** ${comment(o.exporter.describe(l,i))} */\n    public static Path leg${i+1}() {\n        return ${body};\n    }`;}).join('\n\n');
    const speeds=legs.map(l=>n(Math.max(0,Math.min(1,l.power??route.defaultPower??o.defaultPower??.8))));
    return `package ${o.packageName};

import com.pedropathing.api.Paths;
import com.pedropathing.math.Pose;
import com.pedropathing.math.Vector2D;
import com.pedropathing.paths.Path;
import com.pedropathing.paths.interpolator.Interpolator;

/**
 * Route "${comment(layout.name||'route')}" (${comment(layout.fieldName||layout.field||'field')}), planned in Deck Driver Station, as
 * Pedro Pathing ${PEDRO_VERSION} paths. Generated file: change the route in Deck and export again.
 *
 * Field frame (the same as Pedro's): inches, origin at the bottom-left field corner, +X right, +Y up,
 * heading counterclockwise from +X. Headings below are written in degrees and converted to radians.
 * Robot footprint used for clearance: ${n(route.footprint.front)} in front, ${n(route.footprint.rear)} in rear, ${n(route.footprint.half)} in each side; clearance ${n(route.clearance)} in.
 *
 * The route is split into legs: the robot stops after a leg when a pause, action or turn follows,
 * and a new leg starts where the motor power changes or an action path starts or ends.
 * For each leg i: turn in place to START_HEADING[i] if needed, follow leg(i) (running MOVING_ACTIONS[i]
 * while it drives), settle, turn to TURN_AFTER[i] (unless NaN), pause WAIT_SECONDS[i], then run
 * ACTIONS[i] for ACTION_SECONDS[i]. ${o.opMode}.java does this.
 */
public final class ${o.paths} {
    private ${o.paths}() {}

    /** Place the robot here, facing this way, before INIT. */
    public static final Pose START = new Pose(${n(start.x)}, ${n(start.y)}, ${rad(startH)});

    public static final int LEGS = ${legs.length};

    /** Heading each leg starts with, radians. The robot turns in place first when it is not facing it. */
    public static final double[] START_HEADING = {${legHeadings.map(rad).join(', ')}};

    /** Heading to turn to in place after each leg, radians (NaN: no turn). */
    public static final double[] TURN_AFTER = {${legs.map(l=>l.turn===null?'Double.NaN':rad(l.turn)).join(', ')}};

    /** Pause at the end of each leg, before its action, in seconds. */
    public static final double[] WAIT_SECONDS = {${legs.map(l=>n(l.wait)).join(', ')}};

    /** Action run at the end of each leg ("" for none), as named in Deck. See RouteActions.java. */
    public static final String[] ACTIONS = {${legs.map(l=>javaString(l.action)).join(', ')}};

    /** How long each end-of-leg action runs, seconds (0: until it reports done). */
    public static final double[] ACTION_SECONDS = {${legs.map(l=>n(l.actionSeconds||0)).join(', ')}};

    /** Hive cell each end-of-leg action aims at: 0 the cell up at the start, 1 the other cell. */
    public static final int[] ACTION_CELL = {${legs.map(l=>l.cell||0).join(', ')}};

    /** Action run WHILE driving each leg (action paths; "" for none). */
    public static final String[] MOVING_ACTIONS = {${legs.map(l=>javaString(l.moving?.action||'')).join(', ')}};

    /** How long each action path's action runs from the start of its path, seconds (0: the whole path). */
    public static final double[] MOVING_SECONDS = {${legs.map(l=>n(l.moving?.seconds||0)).join(', ')}};

    /** Hive cell each action path's action aims at. */
    public static final int[] MOVING_CELL = {${legs.map(l=>l.moving?.cell||0).join(', ')}};

    /** Which Deck path each leg belongs to (1 = the path from the start to the first end point). */
    public static final int[] PATH = {${legs.map(l=>l.path).join(', ')}};

    /** The end point each leg finishes at (0: a turn point inside a path). */
    public static final int[] PIN = {${legs.map(l=>l.pin).join(', ')}};

    /**
     * Speed limit per leg as a fraction of the robot's top speed (Pedro's Foresight maxPathSpeed),
     * from Deck's motor power setting. 1 means no extra limit; 0 means the robot stays stopped.
     */
    public static final double[] MAX_PATH_SPEED = {${speeds.join(', ')}};

    /** Legs the robot drives straight through into the next one without stopping. */
    public static final boolean[] THROUGH = {${through.join(', ')}};

${methods}

    /** Every leg in driving order. */
    public static Path[] legs() {
        return new Path[] {${legs.map((_,i)=>`leg${i+1}()`).join(', ')}};
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
`;
  }
  function opModeFile(o){
    const R=o.paths,checklist=o.checklist.map(c=>` *  [${c.status==='verified'?'x':' '}] ${c.label}: ${comment(c.detail)}`).join('\n');
    return `package ${o.packageName};

import com.pedropathing.algorithm.Foresight;
import com.pedropathing.follower.Follower;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;
import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.util.ElapsedTime;
import ${o.constants};

/**
 * Autonomous for "${comment(o.layout.name||'route')}", generated by Deck Driver Station for Pedro Pathing ${PEDRO_VERSION}
 * (com.pedropathing:revhub:${PEDRO_VERSION}, FTC SDK ${SDK_VERSION}). Needs a TeamCode built from the Pedro Pathing
 * Quickstart: its pedro/Constants.java must return your tuned Follower from Constants.create(hardwareMap).
 *
 * Files: ${R}.java (the paths), this OpMode, RouteActions.java (action slots, regenerated)${o.mechanisms?', Mechanisms.java (your intake/shooter from Deck)':''}
 * and RobotActions.java (YOUR action code; created once, keep your edits).
 *
 * Robot readiness:
${checklist}
 */
@Autonomous(name = ${javaString(`${o.layout.name||'Planned route'} (Pedro)`)}, group = "Deck Driver Station")
public class ${o.opMode} extends LinearOpMode {
    /** Seconds without moving half an inch, away from the end of a leg, before everything is stopped. */
    private static final double STUCK_SECONDS = 2.0;
    private Follower follower;
    private RouteActions actions;
    private final RouteActions.Step step = new RouteActions.Step();

    @Override
    public void runOpMode() throws InterruptedException {
        follower = Constants.create(hardwareMap);
        if (follower == null) {
            // The Quickstart's Constants.create returns null until Pedro Pathing is set up and tuned.
            telemetry.addLine("Pedro Pathing is not set up: Constants.create(hardwareMap) returned null.");
            telemetry.addLine("Fill in pedro/Constants.java (drivetrain, localizer, Foresight) and tune it first.");
            telemetry.update();
            waitForStart();
            return;
        }
        actions = new RobotActions();
        actions.init(hardwareMap, telemetry);
        // Each hub reads all its inputs in one go per loop (bulk caching), so sensors and encoders cost no extra time.
        for (LynxModule hub : hardwareMap.getAll(LynxModule.class)) hub.setBulkCachingMode(LynxModule.BulkCachingMode.AUTO);
        Path[] legs = ${R}.legs();
        follower.setPose(${R}.START);
        while (opModeInInit()) {
            follower.update();
            Pose p = follower.pose();
            telemetry.addData("Route", legs.length + " legs");
            telemetry.addData("Place robot at", "x %.1f  y %.1f  heading %.0f", ${R}.START.x(), ${R}.START.y(), Math.toDegrees(${R}.START.heading()));
            telemetry.addData("Localizer", "x %.1f  y %.1f  heading %.0f", p.x(), p.y(), Math.toDegrees(p.heading()));
            if (!(follower.algorithm() instanceof Foresight)) telemetry.addLine("Speed limits per path need the Foresight algorithm; driving at full path speed.");
            telemetry.update();
        }
        if (isStopRequested()) {
            actions.stop();
            return;
        }
        // The robot sits at the starting pose at START: forget any drift picked up during INIT.
        follower.setPose(${R}.START);
        try {
            ElapsedTime timer = new ElapsedTime(), movingTimer = new ElapsedTime();
            double plannedHeading = ${R}.START.heading();
            int movingPath = 0;
            boolean movingDone = true, movingFirst = false;
            for (int i = 0; i < legs.length && opModeIsActive(); i++) {
                if (${R}.MAX_PATH_SPEED[i] <= 0) {
                    // Zero motor power in Deck: stay stopped until the end of autonomous.
                    stopDriving();
                    while (opModeIsActive()) { report(i, legs.length, "Zero motor power: stopped"); idle(); }
                    break;
                }
                // Turn only where the plan changes heading, not to chase small drift.
                if (Math.abs(angle(${R}.START_HEADING[i] - plannedHeading)) > Math.toRadians(0.5)) turnTo(${R}.START_HEADING[i], i, legs.length);
                // An action path's action starts with the path and may span several legs of it.
                String moving = ${R}.MOVING_ACTIONS[i];
                if (!moving.isEmpty() && ${R}.PATH[i] != movingPath) {
                    movingPath = ${R}.PATH[i];
                    movingDone = false;
                    movingFirst = true;
                    movingTimer.reset();
                }
                Pose end = legs[i].endPose();
                follower.follow(limited(legs[i], ${R}.MAX_PATH_SPEED[i]));
                step.wait = 0;
                // A robot that stops getting anywhere is stopped, not driven on: blocked, or its localizer no longer changing
                // because a sensor stopped answering (an odometry cable out). Within 1.5 in of the end it is only settling, and moves on.
                Pose mark = follower.pose();
                ElapsedTime progress = new ElapsedTime();
                boolean stuck = false;
                while (opModeIsActive() && follower.following()) {
                    follower.update();
                    if (!near(mark, 0.5)) { mark = follower.pose(); progress.reset(); }
                    else if (progress.seconds() > (near(end, 1.5) ? 3 : STUCK_SECONDS)) { stuck = !near(end, 1.5); break; }
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
                    if (${R}.THROUGH[i] && near(end, 1.5) && follower.completion() > 0.9) break;
                }
                if (stuck) {
                    // Everything stops and stays stopped: the drive, then the mechanisms. Nothing more of the route runs.
                    try { stopDriving(); } finally { actions.stop(); }
                    while (opModeIsActive()) {
                        telemetry.addData("Leg", (i + 1) + " of " + legs.length);
                        telemetry.addData("Phase", "Stopped: no progress for " + STUCK_SECONDS + " s");
                        telemetry.addLine("The robot stopped moving along its path: it is blocked, or the localizer stopped answering (check the odometry cables). Everything is off.");
                        telemetry.update();
                        idle();
                    }
                    break;
                }
                boolean pathEnds = i == legs.length - 1 || ${R}.PATH[i + 1] != movingPath || ${R}.MOVING_ACTIONS[i + 1].isEmpty();
                if (!moving.isEmpty() && pathEnds) {
                    // The path is over: one last call so the action can stop its mechanisms.
                    if (!movingDone) { step.duration = ${R}.MOVING_SECONDS[i]; act(moving, movingTimer.seconds(), movingFirst, true, true, ${R}.PIN[i]); }
                    movingDone = true;
                    movingPath = 0;
                }
                plannedHeading = end.heading();
                if (${R}.THROUGH[i]) continue;
                // Pedro holds the end pose once the path is done; wait (at most 3 s) for the robot to settle on it.
                timer.reset();
                while (opModeIsActive() && timer.seconds() < 3 && !(near(end, 0.75) && follower.velocity().linSpeed() < 0.5)) {
                    follower.update();
                    report(i, legs.length, "Settling");
                }
                if (!Double.isNaN(${R}.TURN_AFTER[i])) {
                    turnTo(${R}.TURN_AFTER[i], i, legs.length);
                    plannedHeading = ${R}.TURN_AFTER[i];
                }
                // At the end point: pause, then run the action for its set time (or until it reports done), then drive on.
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
            // Route finished: hold the last pose until the autonomous period ends. Never restarts a leg.
            while (opModeIsActive()) {
                follower.update();
                report(legs.length - 1, legs.length, "Done");
            }
        } finally {
            // Stop the drive first: an error in a mechanism's stop code must not leave the wheels turning.
            try {
                stopDriving();
            } finally {
                actions.stop();
            }
        }
    }

    /** Applies the leg's speed limit through Foresight's maxPathSpeed, for this path only. */
    private Path limited(Path path, double speed) {
        if (speed >= 1 || !(follower.algorithm() instanceof Foresight)) return path;
        return path.with(((Foresight) follower.algorithm()).config.maxPathSpeed.at(speed));
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

    /** Stops the drive at once (Follower.stop alone zeroes the motors on its next update). */
    private void stopDriving() {
        follower.stop();
        follower.drivetrain.stop();
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
`;
  }
  // What an export can and cannot promise. "verified" items are checked by Deck's own pipeline.
  function checklist({mechanisms,actions,drivetrain='mecanum'}){
    return [
      {status:'verified',label:'Compiles',detail:`Deck's export check compiles this generator's output against FTC SDK ${SDK_VERSION} and Pedro Pathing ${PEDRO_VERSION} (tools/simulation/check-ftc-sdk.cjs).`},
      drivetrain==='mecanum'?{status:'verified',label:'Runs with Pedro’s Follower',detail:`Deck’s development tests run this generator’s output with Pedro Pathing ${PEDRO_VERSION}’s own Follower, Mecanum drivetrain and Pinpoint, OTOS and odometry-pod localizers on the virtual Control Hub (tests/sim-pedro-runtime.test.cjs).`}
        :{status:'physical',label:'Runs with Pedro’s Follower',detail:`Deck’s tests run this output with Pedro’s Follower on mecanum robots only, not with ${drivetrain}. Check the first runs on your robot at low speed.`},
      {status:'verified',label:'Path geometry',detail:'Coordinates, curves and headings are the ones the planner checked for clearance; unit tests compare them.'},
      {status:'team',label:'Pedro setup',detail:'pedro/Constants.java must build your Follower: drive motor names and directions, localizer and its offsets. DeckStarterConstants.java (written beside it for mecanum robots with odometry pods, a Pinpoint or an OTOS) holds estimated starting values: return DeckStarterConstants.create(h) from Constants.create while you tune.'},
      {status:'calibration',label:'Tuning',detail:'Run the Quickstart tuners (localizer, drivetrain, Foresight) on your robot. Deck cannot tune a real robot.'},
      {status:'team',label:'Starting pose',detail:'Place the robot exactly at START before INIT; the localizer is set to it at START.'},
      {status:'team',label:'Actions',detail:actions.length?(mechanisms?'Mechanisms.java drives the intake/shooter set up in Deck; check device names and directions. Other actions need code in RobotActions.java.':'Write the code for each action in RobotActions.java; until then they finish at once.'):'No actions in this route.'},
      {status:'physical',label:'Real-world test',detail:'Drive it on a practice field at low speed first. Simulation and compilation do not prove the robot will follow the path.'}
    ];
  }
  function files({route,layout,setupName,packageName='org.firstinspires.ftc.teamcode',className='PlannedRoute',mechanisms=null,kinematics=null,localization='encoders',target=null,robot={},defaultPower,constants=QUICKSTART_CONSTANTS,hardware=null,tuning=null,exporter=globalThis.DeckSimExport||require('./sim-export.js'),ftc=globalThis.DeckSimFtc||require('./sim-ftc.js')}){
    if(!route?.segments?.length)throw Error('Plan a route first.');
    if(route.nonholonomic)throw Error('Pedro Pathing 3 drives mecanum and swerve robots. Use the OnBot Java or TeamCode export for this drivetrain.');
    if(!layout?.start)throw Error('Set a starting pose first.');
    const nm=names(className,packageName),mech=mechanisms?.enabled?mechanisms:null,legs=legsOf(route,exporter),list=exporter.actions(route),dir=packageName.replace(/\./g,'/');
    const startH=finite(layout.start.heading)?layout.start.heading:route.heading||0,through=throughs(legs,startH),check=checklist({mechanisms:mech,actions:list,drivetrain:robot?.drivetrain||'mecanum'});
    const o={route,layout,legs,through,exporter,packageName,className,paths:nm.paths,opMode:nm.opMode,mechanisms:mech,constants,checklist:check,defaultPower};
    const {parts,sensorSpecs}=ftc.exportParts?ftc.exportParts({robot,localization,mechanisms,kinematics}):{parts:{list:[]},sensorSpecs:[]};
    const shared={packageName,className,layoutName:layout.name,setupName,exporter,mechanisms:mech,kinematics,parts,sensorSpecs,sequences:exporter.sequences?.(route)||[],poseImport:'com.pedropathing.math.Pose'};
    const out={[`${dir}/${nm.paths}.java`]:pathsFile(o),[`${dir}/${nm.opMode}.java`]:opModeFile(o),[`${dir}/RouteActions.java`]:ftc.routeActions(shared,list),[`${dir}/RobotActions.java`]:ftc.robotActions(shared,list)};
    if(mech)out[`${dir}/Mechanisms.java`]=ftc.mechanismsSource(shared,mech,target||{x:72,y:72},{length:robot?.length,width:robot?.width,wiring:robot?.wiring});
    if(parts.list.length)out[`${dir}/Parts.java`]=ftc.partsSource(shared,parts.list,sensorSpecs);
    // The check TeleOp tests the drive motors Deck knows (none for swerve) and every mechanism device on the robot.
    out[`${dir}/${className}Check.java`]=ftc.checkOpMode({...shared,checkName:className+'Check'},hardware,mech);
    // Starting values for the team's pedro/Constants.java, next to it in the Quickstart's pedro package.
    let starter=null;if(hardware&&tuning&&constants===QUICKSTART_CONSTANTS){try{starter=starterConstants({hardware,tuning});}catch{}}
    if(starter)out['org/firstinspires/ftc/teamcode/pedro/DeckStarterConstants.java']=starter;
    return {files:out,keep:[`${dir}/RobotActions.java`],retire:{[`${dir}/RobotActions.java`]:list.filter(a=>ftc.mechanismAction(a.name,mech,parts)).map(a=>a.slot)},opMode:`${packageName}.${nm.opMode}`,checklist:check,legs:legs.length,actions:list,starter:!!starter};
  }
  // A Pedro Pathing Follower for the robot set up in Deck: Pedro's own REV hub Mecanum drivetrain and
  // Pinpoint or OTOS localizer, and a Foresight config filled from the simulated robot's measured
  // speeds, decelerations, braking distances and gains (the same quantities the Quickstart's Foresight
  // tuner measures on a real robot). The simulator runs Pedro exports with it; teams can start from it,
  // but every number is an estimate until the Quickstart tuners have been run on the real robot.
  const STARTER_LOCALIZERS={fused:'goBILDA Pinpoint',optical:'SparkFun OTOS',odometry:'two odometry pods + IMU',odometry3:'three odometry pods + IMU'};
  function starterConstants({hardware,tuning,packageName='org.firstinspires.ftc.teamcode.pedro',className='DeckStarterConstants'}){
    if(!STARTER_LOCALIZERS[hardware?.localization])throw Error(`Pedro starter constants support ${Object.values(STARTER_LOCALIZERS).join(', ')} localization.`);
    if(hardware.drive?.kind!=='mecanum')throw Error('Pedro starter constants support mecanum drivetrains.');
    for(const k of ['maxForward','maxStrafe','forwardDeceleration','strafeDeceleration','linearBrakeForward','linearBrakeStrafe','quadraticBrakeForward','quadraticBrakeStrafe','headingBrakeLinear','headingBrakeQuadratic','headingP','translationalP','translationalSmall'])if(!(finite(tuning?.[k])&&tuning[k]>=0))throw Error(`The simulated robot has no ${k}; load the simulation first.`);
    const m=hardware.drive.motors,dir=x=>`DcMotorSimple.Direction.${x.mount<0?'REVERSE':'FORWARD'}`,loc=hardware.localization,pinpoint=loc==='fused',t=tuning;
    // Pods: Pedro's two-pod maths takes the forward pod's offset as minus its distance to the left of centre, and the
    // strafe pod's as its distance in front of centre; ticks per inch from the pod wheels Deck assumes (goBILDA 32 mm, 2000 counts).
    const pods=hardware.pods||[],fwd=pods.filter(p=>p.axis==='forward'),side=pods.find(p=>p.axis==='strafe'),ticks=p=>(1/(p?.ticksPerInch||1)).toPrecision(6),hub=hardware.hub||{logo:'UP',usb:'FORWARD'},imuLine=`new RevHubIMU(new RevHubOrientationOnRobot(RevHubOrientationOnRobot.LogoFacingDirection.${hub.logo}, RevHubOrientationOnRobot.UsbFacingDirection.${hub.usb}))`;
    if(loc==='odometry'&&(fwd.length!==1||!side))throw Error('Two-pod odometry needs one forward and one strafe pod.');if(loc==='odometry3'&&(fwd.length!==2||!side))throw Error('Three-pod odometry needs two forward pods and one strafe pod.');
    const left=fwd.slice().sort((a,b)=>b.y-a.y)[0],right=fwd.slice().sort((a,b)=>a.y-b.y)[0],encoder=p=>`Encoder.${p?.reversed?'REVERSE':'FORWARD'}`;
    const podLocalizer=loc!=='odometry'&&loc!=='odometry3'?'':loc==='odometry'?`    /** Two odometry pods ("${comment(fwd[0].name)}" forward, "${comment(side.name)}" sideways) and the hub IMU "${comment(hardware.imu)}": their offsets and directions as set up in Deck (the guided check TeleOp measures them). */
    public static TwoWheelConfig localizer() {
        return new TwoWheelConfig(c -> {
            c.xPodName.set(${javaString(fwd[0].name)});
            c.yPodName.set(${javaString(side.name)});
            c.imuName.set(${javaString(hardware.imu)});
            // How the IMU is mounted (Torque: Setup → Mechanisms → Chassis). If this is wrong, every heading is wrong.
            // ${comment(hardware.imuPlace?.said||'Control Hub IMU')}.
            c.imu.set(${imuLine});
            c.xPodOffset.set(${dbl(-fwd[0].y)});
            c.yPodOffset.set(${dbl(side.x)});
            c.forwardTicksToInches.set(${ticks(fwd[0])});
            c.strafeTicksToInches.set(${ticks(side)});
            c.xPodDirection.set(${encoder(fwd[0])});
            c.yPodDirection.set(${encoder(side)});
        });
    }`:`    /** Three odometry pods ("${comment(left.name)}" and "${comment(right.name)}" forward, "${comment(side.name)}" sideways) and the hub IMU "${comment(hardware.imu)}": their offsets and directions as set up in Deck (the guided check TeleOp measures them). */
    public static ThreeWheelIMUConfig localizer() {
        return new ThreeWheelIMUConfig(c -> {
            c.leftEncoderName.set(${javaString(left.name)});
            c.rightEncoderName.set(${javaString(right.name)});
            c.strafeEncoderName.set(${javaString(side.name)});
            c.imuName.set(${javaString(hardware.imu)});
            // How the IMU is mounted (Torque: Setup → Mechanisms → Chassis). If this is wrong, every heading is wrong.
            // ${comment(hardware.imuPlace?.said||'Control Hub IMU')}.
            c.imu.set(${imuLine});
            c.leftPodY.set(${dbl(left.y)});
            c.rightPodY.set(${dbl(right.y)});
            c.strafePodX.set(${dbl(side.x)});
            c.forwardTicksToInches.set(${ticks(left)});
            c.strafeTicksToInches.set(${ticks(side)});
            c.turnTicksToRadians.set(${ticks(left)});
            c.leftEncoderDirection.set(${encoder(left)});
            c.rightEncoderDirection.set(${encoder(right)});
            c.strafeEncoderDirection.set(${encoder(side)});
        });
    }`;
    // The Pinpoint takes goBILDA's offsets as they are: the forward (X) pod's inches left of centre, the strafe (Y)
    // pod's inches forward of it. Pedro's OTOS localizer turns the offset (and every pose) by 90° itself, so SparkFun's
    // offset (x forward, y left, the sensor's X axis heading) goes in as (y, -x, heading - 180°).
    const pp=hardware.pinpointMount||{pods:'4bar',xOffset:0,yOffset:0},ot=hardware.otosMount||{x:0,y:0,heading:-90,linearScalar:1,angularScalar:1};
    const localizer=loc==='odometry'||loc==='odometry3'?podLocalizer:pinpoint?`    /** ${STARTER_LOCALIZERS.fused} "${comment(hardware.pinpoint)}": its pods as set up in Deck (the guided check TeleOp measures them). */
    public static PinpointConfig localizer() {
        return new PinpointConfig(c -> {
            c.name.set(${javaString(hardware.pinpoint)});
            c.offsetUnits.set(DistanceUnit.INCH);
            c.xPodOffset.set(${dbl(pp.xOffset)});
            c.yPodOffset.set(${dbl(pp.yOffset)});
            c.podType.set(GoBildaPinpointDriver.GoBildaOdometryPods.${pp.pods==='swingarm'?'goBILDA_SWINGARM_POD':'goBILDA_4_BAR_POD'});
            c.xPodDirection.set(GoBildaPinpointDriver.EncoderDirection.${pp.xReversed?'REVERSED':'FORWARD'});
            c.yPodDirection.set(GoBildaPinpointDriver.EncoderDirection.${pp.yReversed?'REVERSED':'FORWARD'});
        });
    }`:`    /** ${STARTER_LOCALIZERS.optical} "${comment(hardware.otos)}": where it sits and its scalars as set up in Deck (the guided check TeleOp measures them). */
    public static OTOSConfig localizer() {
        return new OTOSConfig(c -> {
            c.name.set(${javaString(hardware.otos)});
            c.linearUnit.set(DistanceUnit.INCH);
            c.offset.set(new Pose(${dbl(ot.y)}, ${dbl(-ot.x)}, Math.toRadians(${dbl(ot.heading-180)})));
            c.linearScalar.set(${dbl(ot.linearScalar)});
            c.angularScalar.set(${dbl(ot.angularScalar)});
        });
    }`;
    return `package ${packageName};

import com.pedropathing.algorithm.Foresight;
import com.pedropathing.algorithm.ForesightConfig;
import com.pedropathing.controllers.Controller;
import com.pedropathing.follower.Follower;
import com.pedropathing.math.Matrix;
${loc==='optical'?'import com.pedropathing.math.Pose;\n':''}import com.pedropathing.math.Vector2D;
import com.pedropathing.revhub.drivetrains.Mecanum;
import com.pedropathing.revhub.drivetrains.MecanumConfig;
${loc==='odometry'?'import com.pedropathing.revhub.localizers.Encoder;\nimport com.pedropathing.revhub.localizers.RevHubIMU;\nimport com.pedropathing.revhub.localizers.TwoWheelConfig;\nimport com.pedropathing.revhub.localizers.TwoWheelLocalizer;\nimport com.qualcomm.hardware.rev.RevHubOrientationOnRobot;':loc==='odometry3'?'import com.pedropathing.revhub.localizers.Encoder;\nimport com.pedropathing.revhub.localizers.RevHubIMU;\nimport com.pedropathing.revhub.localizers.ThreeWheelIMUConfig;\nimport com.pedropathing.revhub.localizers.ThreeWheelIMULocalizer;\nimport com.qualcomm.hardware.rev.RevHubOrientationOnRobot;':pinpoint?'import com.pedropathing.revhub.localizers.PinpointConfig;\nimport com.pedropathing.revhub.localizers.PinpointLocalizer;\nimport com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;':'import com.pedropathing.revhub.localizers.OTOSConfig;\nimport com.pedropathing.revhub.localizers.OTOSLocalizer;'}
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.HardwareMap;${pinpoint||loc==='optical'?'\nimport org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;':''}

/**
 * STARTING VALUES for Pedro Pathing ${PEDRO_VERSION}, estimated by Deck Driver Station from the robot set up in its
 * simulator (mecanum, ${STARTER_LOCALIZERS[loc]}). They are not measurements of your robot.
 * Before driving fast: run Deck's guided check (it finds the motor directions and where the odometry sits)
 * and export again, then run the Pedro Quickstart tuners and replace the Foresight numbers with what they measure.
 * To use it: in pedro/Constants.java, return ${className}.create(h);
 */
public class ${className} {
    /** Drive motors as configured in Deck. Left motors are reversed for a standard mecanum chassis. */
    public static MecanumConfig drivetrain() {
        return new MecanumConfig(c -> {
            c.frontLeftName.set(${javaString(m.frontLeft.name)});
            c.frontRightName.set(${javaString(m.frontRight.name)});
            c.backLeftName.set(${javaString(m.backLeft.name)});
            c.backRightName.set(${javaString(m.backRight.name)});
            c.frontLeftDirection.set(${dir(m.frontLeft)});
            c.frontRightDirection.set(${dir(m.frontRight)});
            c.backLeftDirection.set(${dir(m.backLeft)});
            c.backRightDirection.set(${dir(m.backRight)});
        });
    }

${localizer}

    /** Foresight from the simulated robot: speeds in in/s, decelerations in in/s², gains in power per inch or radian. */
    public static ForesightConfig foresight() {
        return new ForesightConfig(c -> {
            c.forwardTranslational.set(Controller.piecewise(Controller.proportional(${n(t.translationalSmall)})).put(2.5, Controller.proportional(${n(t.translationalP)})));
            c.strafeTranslational.set(Controller.piecewise(Controller.proportional(${n(t.translationalSmall)})).put(2.5, Controller.proportional(${n(t.translationalP)})));
            c.coast.set(Controller.proportionalFeedforward(${(1/t.maxForward).toPrecision(4)}));
            c.brake.set(Controller.proportionalFeedforward(${(.85/t.maxForward).toPrecision(4)}));
            c.headingFeedback.set(Controller.proportional(${n(t.headingP)}));
            c.headingBrakeCoefficients.set(Vector2D.cartesian(${t.headingBrakeLinear.toPrecision(4)}, ${t.headingBrakeQuadratic.toPrecision(4)}));
            c.linearBrakeCoefficients.set(Matrix.diag(${t.linearBrakeForward.toPrecision(4)}, ${t.linearBrakeStrafe.toPrecision(4)}));
            c.quadraticBrakeCoefficients.set(Matrix.diag(${t.quadraticBrakeForward.toPrecision(4)}, ${t.quadraticBrakeStrafe.toPrecision(4)}));
            c.maxAchievableForwardVelocity.set(${dbl(t.maxForward)});
            c.maxAchievableStrafeVelocity.set(${dbl(t.maxStrafe)});
            c.naturalForwardDeceleration.set(${dbl(t.forwardDeceleration)});
            c.naturalStrafeDeceleration.set(${dbl(t.strafeDeceleration)});
        });
    }

    public static Follower create(HardwareMap h) {
        return new Follower(new ${{fused:'Pinpoint',optical:'OTOS',odometry:'TwoWheel',odometry3:'ThreeWheelIMU'}[loc]}Localizer(h, localizer()), new Mecanum(h, drivetrain()), new Foresight(foresight()));
    }
}
`;
  }
  // A Quickstart pedro/Constants.java that uses DeckStarterConstants (the simulator runs exports with it).
  const QUICKSTART_USING_STARTER=`package org.firstinspires.ftc.teamcode.pedro;

import com.pedropathing.follower.Follower;
import com.qualcomm.robotcore.hardware.HardwareMap;

public class Constants {
    public static Follower create(HardwareMap h) {
        return DeckStarterConstants.create(h);
    }
}
`;
  return {files,checklist,starterConstants,STARTER_LOCALIZERS,PEDRO_VERSION,SDK_VERSION,QUICKSTART_CONSTANTS,QUICKSTART_USING_STARTER};
});
