package deck.pathing;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.function.LongSupplier;

/** Deck's sensor-driven route controller. No robot SDK or external pathing dependency.
 * Uses arc-length samples of the exact Bezier geometry, velocity feedforward, always-on
 * square-root position feedback and heading PD, with correction taking priority over path
 * speed when the wheels saturate. Coordinates are inches, +X right, +Y up; angles are radians.
 */
public final class DeckFollower {
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
        // Braking is planned at .35 of the acceleration figure: a light, fast robot speeds up far harder
        // than it can slow down, and planned at twice this it reached bends at three times the planned
        // speed (a swerve then swung 2.6 in wide while its modules turned).
        int n=samples.size();limits=new double[n];Arrays.fill(limits,Double.POSITIVE_INFINITY);double inX=0,inY=0,inLength=0;
        for(int i=1;i<n;i++){Pose a=samples.get(i-1).pose,b=samples.get(i).pose;double dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(length<1e-9)continue;
            if(inLength>0){double bend=Math.abs(angle(Math.atan2(dy,dx)-Math.atan2(inY,inX)));if(bend>1e-4)limits[i-1]=Math.max(3,Math.sqrt(.5*config.acceleration*(length+inLength)/2/bend));}
            inX=dx;inY=dy;inLength=length;}
        for(int i=n-2;i>=0;i--)limits[i]=Math.min(limits[i],Math.sqrt(limits[i+1]*limits[i+1]+.7*config.acceleration*(samples.get(i+1).s-samples.get(i).s)));
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
            // Leave braking headroom for wheel saturation, heading corrections and sensor delay
            // (.25 of the acceleration figure: at .35 a fast robot ran an inch past the end and came back).
            double wanted=Math.min(cruise,Math.sqrt(Math.max(0,.5*config.acceleration*remaining)));
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
