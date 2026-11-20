'use strict';
// A swerve's autonomous (ui/sim-ftc.js, with the pods as Calibrate has them): the Java Torque writes is compiled and run
// here, the real route follower with the generated drive, against pods that behave like the real ones (a continuous servo
// that starts only past a little power, shows a command some milliseconds late and brakes when its power goes; a wheel
// that takes a moment to reach its speed). The robot's true path comes from where its wheels push it. It must drive the
// route, end on its last point, know where it is from its wheel encoders and pod angles, and turn the way it is told.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const C=require('../ui/sim-config.js'),P=require('../ui/sim-planner.js'),X=require('../ui/sim-export.js'),F=require('../ui/sim-ftc.js');
const root=path.join(__dirname,'..'),bin=n=>path.join(root,'sim-runtime/java/bin',process.platform==='win32'?n+'.exe':n),stubs=path.join(root,'tools/simulation/java');
// Three pods of a kiwi swerve, one motor mounted the other way round, servos and encoders that count either way.
const pod=(n,x,y,more={})=>({label:n,drive:n+'M',reversed:false,servo:n+'S',encoder:n+'E',x,y,zero:1.5,encoderSign:1,servoSign:-1,gain:40,leadP:.083,leadN:.075,creepP:.13,creepN:.1,creepSpeedP:78,creepSpeedN:74,slope:1700,top:475,pushP:150,pushN:140,zone:8,ease:1,still:12,lag:.14,volts:3.3,...more});
const swerve={kind:'swerve',tolerance:.9,pods:[pod('front',8,0,{zero:.4}),pod('left',-8,8,{encoderSign:-1,servoSign:1,zero:2.9}),pod('right',-8,-8,{reversed:true})],imu:{name:'imu',scale:1}};
const start={x:24,y:24,heading:0},layout={name:'Swerve',field:'empty',width:144,height:144,start,zones:[]};
const robot={...C.robot({drivetrain:'kiwiSwerve'},'ftc'),length:16,width:16};

const CLOCK=`package deck.sim;
public final class BenchClock { private BenchClock() {} public static void set(double seconds) { SimClock.setSeconds(seconds); } }
`;
// The bench: the hub's devices are the simulator's own stand-ins; the pods and the robot are moved here.
const BENCH=o=>`package deck.sim.hub;
import com.qualcomm.robotcore.hardware.*;
import org.firstinspires.ftc.robotcore.external.navigation.*;
import deck.pathing.DeckFollower;
import deck.pathing.DeckFollower.*;
import org.firstinspires.ftc.teamcode.PlannedRoute;
import org.firstinspires.ftc.teamcode.drive.Constants;
public final class SwerveBench {
    static final class Hub extends HardwareMap { Hub() { super(); } }
    static final class Imu implements IMU { double yaw;
        public boolean initialize(Parameters p) { return true; } public void resetYaw() {}
        public YawPitchRollAngles getRobotYawPitchRollAngles() { return new YawPitchRollAngles(AngleUnit.RADIANS, yaw, 0, 0, 0); }
        public AngularVelocity getRobotAngularVelocity(AngleUnit unit) { return new AngularVelocity(); } }
    static final String[] NAME = {${o.pods.map(p=>JSON.stringify(p.label)).join(', ')}};
    static final double[] PX = {${o.pods.map(p=>p.x).join(', ')}}, PY = {${o.pods.map(p=>p.y).join(', ')}}, ZERO = {${o.pods.map(p=>p.zero).join(', ')}};
    static final int[] ENC = {${o.pods.map(p=>p.encoderSign).join(', ')}}, SERVO = {${o.pods.map(p=>p.servoSign).join(', ')}}, MOUNT = {${o.pods.map(p=>p.reversed?-1:1).join(', ')}};
    static final double DT = 0.013, TICKS_PER_INCH = ${o.ticksPerInch}, TOP_INCHES = 60, VOLTS = 3.3;
    static final int N = NAME.length, LATE = 4;
    static SimMotor[] motor = new SimMotor[N]; static SimCRServo[] servo = new SimCRServo[N]; static SimAnalog[] enc = new SimAnalog[N]; static Imu imu = new Imu();
    static double[] angle = new double[N], turning = new double[N], wheel = new double[N]; static double[][] late = new double[N][LATE];
    static double x, y, h, t, worst, flips;
    static DeckFollower follower;
    static void sense() { for (int i = 0; i < N; i++) { double v = ZERO[i] + ENC[i] * angle[i] / 360.0 * VOLTS; v = ((v % VOLTS) + VOLTS) % VOLTS; enc[i].volts = v; } imu.yaw = Math.atan2(Math.sin(h), Math.cos(h)); }
    // One loop of the robot: the servos turn the pods, the wheels push the robot.
    static void physics() {
        double sx = 0, sy = 0, cx = 0, cy = 0; double[] wx = new double[N], wy = new double[N];
        for (int i = 0; i < N; i++) {
            // A continuous servo: a command shows about 50 ms late, nothing under a tenth of power, then about 1700 degrees a
            // second per unit of power up to 475, and it is a speed that follows quickly, so power off brakes it.
            double u = late[i][0]; System.arraycopy(late[i], 1, late[i], 0, LATE - 1); late[i][LATE - 1] = servo[i].output();
            double a = Math.abs(u), want = a < 0.09 ? 0 : Math.signum(u) * SERVO[i] * Math.min(475, 78 + (a - 0.1) * 1700);
            turning[i] += (want - turning[i]) * Math.min(1, DT / 0.02); angle[i] += turning[i] * DT;
            // A drive motor reaches its speed in about a tenth of a second.
            wheel[i] += (motor[i].wheelCommand() * TOP_INCHES - wheel[i]) * Math.min(1, DT / 0.1);
            motor[i].advance(wheel[i] * DT * TICKS_PER_INCH, DT);
            double r = Math.toRadians(angle[i]); wx[i] = wheel[i] * Math.cos(r); wy[i] = wheel[i] * Math.sin(r); sx += wx[i]; sy += wy[i]; cx += PX[i]; cy += PY[i];
        }
        // Where the wheels disagree they slip: the robot moves as the rigid body that fits them best.
        sx /= N; sy /= N; cx /= N; cy /= N; double num = 0, den = 0;
        for (int i = 0; i < N; i++) { double rx = PX[i] - cx, ry = PY[i] - cy; num += rx * (wy[i] - sy) - ry * (wx[i] - sx); den += rx * rx + ry * ry; }
        double w = num / den, tx = sx + w * cy, ty = sy - w * cx, c = Math.cos(h), s = Math.sin(h);
        x += (tx * c - ty * s) * DT; y += (tx * s + ty * c) * DT; h += w * DT; t += DT; deck.sim.BenchClock.set(t);
    }
    static void step() { sense(); follower.update(); physics(); }
    static double off(Pose p) { return Math.hypot(p.x() - x, p.y() - y); }
    public static void main(String[] args) {
        Hub map = new Hub();
        for (int i = 0; i < N; i++) { map.put(NAME[i] + "M", motor[i] = new SimMotor(i, MOUNT[i])); map.put(NAME[i] + "S", servo[i] = new SimCRServo(i)); map.put(NAME[i] + "E", enc[i] = new SimAnalog(i)); angle[i] = ${o.podStart}[i]; }
        map.put("imu", imu); x = PlannedRoute.START.x(); y = PlannedRoute.START.y(); h = PlannedRoute.START.heading(); sense();
        follower = Constants.create(map); follower.setPose(PlannedRoute.START);
        Path[] legs = PlannedRoute.legs(); double lost = 0;
        for (int i = 0; i < legs.length; i++) {
            Constants.motorPower(PlannedRoute.MOTOR_POWER[i]); follower.follow(legs[i]); double from = t;
            while (follower.following() && t - from < 20) { step(); Pose on = follower.closestPose(); worst = Math.max(worst, off(on)); lost = Math.max(lost, off(follower.pose())); }
            System.out.println("LEG " + i + " seconds " + (t - from) + " following " + follower.following());
            for (int k = 0; k < 80; k++) step();
            Pose end = legs[i].endPose();
            System.out.println("END " + i + " off " + off(end) + " heading " + Math.toDegrees(DeckFollower.angle(h - end.heading())));
        }
        System.out.println("TRACK worst " + worst + " lost " + lost + " seconds " + t);
        // Holding still, the pods must not hunt: their servos are left alone.
        double moved = 0; double[] was = angle.clone(); for (int k = 0; k < 150; k++) { step(); for (int i = 0; i < N; i++) moved = Math.max(moved, Math.abs(angle[i] - was[i])); }
        System.out.println("HOLD pods moved " + moved);
        // A quarter turn to the left, on the spot.
        Pose here = follower.pose(); double goal = here.heading() + Math.PI / 2, x0 = x, y0 = y; follower.hold(new Pose(here.x(), here.y(), goal));
        for (int k = 0; k < 400; k++) step();
        System.out.println("TURN heading off " + Math.toDegrees(DeckFollower.angle(h - goal)) + " moved " + Math.hypot(x - x0, y - y0) + " believed " + Math.toDegrees(DeckFollower.angle(follower.pose().heading() - h)));
        follower.stop(); double left = 0; for (int i = 0; i < N; i++) left = Math.max(left, Math.max(Math.abs(servo[i].output()), Math.abs(motor[i].wheelCommand())));
        System.out.println("STOP power left " + left);
    }
}
`;
function run(t,pins,podStart='new double[] {0, 0, 0}'){
  if(!fs.existsSync(bin('javac'))||!fs.existsSync(bin('java'))||!fs.existsSync(stubs)){t.skip('the simulator’s JDK is not built here');return null;}
  const route=P.plan({start,zones:[],pins,style:'sharp',clearance:1},{front:8,rear:8,half:8}),out=F.files({route,layout,tuning:{},robot,localization:'encoders',routeJava:X.java(route,layout,{polygon:P.polygon}),swerve});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'torque-swerve-auto-')),list=[];
  try{const put=(f,src)=>{const at=path.join(dir,'src',f);fs.mkdirSync(path.dirname(at),{recursive:true});fs.writeFileSync(at,src);list.push(at);};
    for(const [f,src] of Object.entries(out.files))if(!f.startsWith('deck/'))put(f,src);put('deck/sim/BenchClock.java',CLOCK);put('deck/sim/hub/SwerveBench.java',BENCH({pods:swerve.pods,ticksPerInch:out.hardware.drive.ticksPerInch,podStart}));
    try{execFileSync(bin('javac'),['-nowarn','-proc:none','-sourcepath',stubs,'-d',path.join(dir,'out'),...list],{stdio:'pipe'});}catch(e){assert.fail('it does not compile: '+String(e.stderr||e.message).slice(0,1500));}
    const said=execFileSync(bin('java'),['-cp',path.join(dir,'out'),'deck.sim.hub.SwerveBench'],{encoding:'utf8',timeout:120000}),num=(line,word)=>{const m=new RegExp(`^${line}\\b.*?\\b${word} (-?[\\d.eE+-]+)`,'m').exec(said);assert.ok(m,`${line} ${word} in:\n${said}`);return +m[1];};
    return {said,num,legs:(said.match(/^LEG /gm)||[]).length};}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
}

test('a swerve’s autonomous drives its route on pods like the real ones, and knows where it is',t=>{
  const r=run(t,[{x:90,y:24},{x:90,y:80},{x:40,y:96}]);if(!r)return;t.diagnostic(r.said.trim().split('\n').join(' | '));
  assert.ok(r.legs>=1);assert.doesNotMatch(r.said,/following true/,'every leg finishes');
  for(const m of r.said.matchAll(/^END \d+ off ([\d.eE+-]+) heading (-?[\d.eE+-]+)/gm)){assert.ok(+m[1]<1,`ends on its point: ${m[1]} in off`);assert.ok(Math.abs(+m[2])<3,`facing the way planned: ${m[2]}° off`);}
  assert.ok(r.num('TRACK','worst')<4,'it stays near its path');assert.ok(r.num('TRACK','lost')<1.5,'its wheel encoders and pod angles say where it is');
  // Holding still, no pod hunts; told to turn a quarter turn left, it turns left, on the spot, and knows it did.
  assert.ok(r.num('HOLD','moved')<3,'the pods rest while it holds');
  assert.ok(Math.abs(r.num('TURN','off'))<3,'a quarter turn to the left ends a quarter turn to the left');assert.ok(r.num('TURN','moved')<2.5,'turning on the spot stays on the spot');assert.ok(Math.abs(r.num('TURN','believed'))<1);
  assert.equal(r.num('STOP','left'),0,'stopping takes the power off the wheels and the steering');
});

test('it starts right whichever way the pods were left: backwards, sideways, anywhere',t=>{
  const r=run(t,[{x:90,y:24}],'new double[] {180, -90, 47}');if(!r)return;t.diagnostic(r.said.trim().split('\n').join(' | '));
  assert.doesNotMatch(r.said,/following true/);for(const m of r.said.matchAll(/^END \d+ off ([\d.eE+-]+)/gm))assert.ok(+m[1]<1,`ends on its point: ${m[1]} in off`);
  assert.ok(r.num('TRACK','worst')<4);assert.ok(r.num('TRACK','lost')<1.5);
});

test('a swerve gets an autonomous only once Calibrate has its pods, and the others keep theirs',()=>{
  assert.throws(()=>F.hardware(robot,'encoders'),/for a swerve once Calibrate has set its wheels straight/);
  assert.throws(()=>F.hardware(robot,'encoders',{kind:'swerve',pods:[{...swerve.pods[0],zero:undefined}]}),/Set the wheels straight first/);
  const h=F.hardware(robot,'encoders',swerve);assert.equal(h.drive.kind,'swerve');assert.deepEqual(Object.values(h.drive.motors).map(m=>[m.name,m.mount]),[['frontM',1],['leftM',1],['rightM',-1]]);
  // A mecanum is written as before, with or without a swerve's description beside it.
  const mec={...C.robot({},'ftc'),length:16,width:16};assert.equal(F.hardware(mec,'encoders').drive.kind,'mecanum');assert.throws(()=>F.hardware({...mec,drivetrain:'xdrive'},'encoders'),/X-drive, Kiwi and butterfly/);
  const route=P.plan({start,zones:[],pins:[{x:90,y:24}],style:'sharp',clearance:1},{front:8,rear:8,half:8}),routeJava=X.java(route,layout,{polygon:P.polygon});
  const out=F.onBotJava({route,layout,tuning:{},robot,localization:'encoders',routeJava,swerve,autoName:'Left side'}),s=out.source;
  assert.match(s,/@Autonomous\(name = "Left side", group = "Torque"\)/);assert.match(s,/public static final class RobotDrive implements DeckFollower\.Drivetrain, DeckFollower\.Localizer/);
  for(const part of [/static final String\[\] DRIVE = \{"frontM", "leftM", "rightM"\}, STEER = \{"frontS", "leftS", "rightS"\}, ENCODER = \{"frontE", "leftE", "rightE"\};/,/static final class Steer \{/,/steer\[i\] = map\.get\(CRServo\.class, STEER\[i\]\); encoder\[i\] = map\.get\(AnalogInput\.class, ENCODER\[i\]\);/,
    /forward\+=d\*Math\.cos\(a\)\+POD_Y\[i\]\*dh;left\+=d\*Math\.sin\(a\)-POD_X\[i\]\*dh;/,/boolean flip=Math\.abs\(error\)>95;/,/for\(CRServo s:steer\)s\.setPower\(0\);/,/config\.tank=false;/])assert.match(s,part);
  assert.equal(s.split('{').length,s.split('}').length,'braces balance');
  // Its check TeleOp has the mechanisms only: Calibrate checked the pods.
  assert.doesNotMatch(out.check.source,/Did the .* turn so the robot would drive FORWARD/);
  const plain=F.onBotJava({route,layout,tuning:{},robot:mec,localization:'encoders',routeJava}).source;assert.doesNotMatch(plain,/class Steer|CRServo\[\] steer/);assert.match(plain,/p\.forward\(\)-p\.strafe\(\)-p\.turn\(\)/);
});
