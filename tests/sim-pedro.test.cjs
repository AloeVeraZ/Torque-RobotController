'use strict';
// The Pedro Pathing 3 export. tools/simulation/check-ftc-sdk.cjs compiles this output against the real
// FTC SDK 12.0.0 and Pedro Pathing 3.0.2 (it needs network access); these tests pin what it generates.
const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('../ui/sim-planner.js'),Pedro=require('../ui/sim-pedro.js');
const fp={front:8.5,rear:8.5,half:8.5},layoutOf=(start,zones=[])=>({name:'Test route',field:'empty',fieldName:'Empty field',width:144,height:144,start,zones});
const out=(route,layout,extra={})=>Pedro.files({route,layout,setupName:'Test',...extra});
const source=(o,name)=>Object.entries(o.files).find(([k])=>k.endsWith('/'+name))[1];

test('Pedro export: Paths, OpMode and action files for the Quickstart, in the chosen package',()=>{
  const start={x:20,y:24,heading:0},layout=layoutOf(start),route=P.plan({start,zones:[],pins:[{x:60,y:24,wait:.5,action:'Score'},{x:100,y:60}],style:'spline',clearance:2,defaultPower:.8},fp);
  const o=out(route,layout,{packageName:'org.firstinspires.ftc.teamcode.auto',className:'RedAuto'});
  assert.deepEqual(Object.keys(o.files).sort(),['RedAutoCheck.java','RedAutoPaths.java','RedAutoPedro.java','RobotActions.java','RouteActions.java'].map(f=>'org/firstinspires/ftc/teamcode/auto/'+f));
  assert.deepEqual(o.keep,['org/firstinspires/ftc/teamcode/auto/RobotActions.java']);assert.equal(o.opMode,'org.firstinspires.ftc.teamcode.auto.RedAutoPedro');
  const paths=source(o,'RedAutoPaths.java'),op=source(o,'RedAutoPedro.java'),actions=source(o,'RouteActions.java');
  assert.match(paths,/^package org\.firstinspires\.ftc\.teamcode\.auto;/);assert.match(paths,/import com\.pedropathing\.api\.Paths;/);
  assert.match(paths,/public static final Pose START = new Pose\(20, 24, Math\.toRadians\(0\)\);/);
  assert.match(paths,/WAIT_SECONDS = \{0\.5, 0\}/);assert.match(paths,/ACTIONS = \{"Score", ""\}/);assert.match(paths,/MAX_PATH_SPEED = \{0\.8, 0\.8\}/);
  // The Quickstart's Follower factory, with a null check: its Constants.create returns null until set up.
  assert.match(op,/import org\.firstinspires\.ftc\.teamcode\.pedro\.Constants;/);assert.match(op,/follower = Constants\.create\(hardwareMap\);\n\s+if \(follower == null\)/);
  assert.match(op,/@Autonomous\(name = "Test route \(Pedro\)"/);assert.match(op,/extends LinearOpMode/);
  // Action slots use Pedro's Pose, not the Deck controller's.
  assert.match(actions,/import com\.pedropathing\.math\.Pose;/);assert.doesNotMatch(Object.values(o.files).join('\n'),/deck\.pathing/);
});

test('Pedro export: lines, curves and headings map to Pedro 3 interpolators',()=>{
  const start={x:24,y:24,heading:0},layout=layoutOf(start);
  // A straight leg with a turn under half a revolution uses Pedro's linear(); a constant heading uses constant().
  const turn=P.plan({start,zones:[],pins:[{x:96,y:24,path:{rotate:'turn',heading:90}},{x:96,y:96}],style:'sharp',clearance:2},fp);
  const t=source(out(turn,layout),'PlannedRoutePaths.java');
  assert.match(t,/Paths\.line\(v\(24, 24\), v\(96, 24\)\)\.linear\(Math\.toRadians\(0\), Math\.toRadians\(90\)\)/);
  assert.match(t,/Paths\.line\(v\(96, 24\), v\(96, 96\)\)\.constant\(Math\.toRadians\(90\)\)/);
  // A whole spin cannot be Pedro's short-way linear(): it keeps the planned turn with a geometric interpolator.
  const spin=P.plan({start,zones:[],pins:[{x:110,y:24,path:{rotate:'spin',spins:1}}],style:'sharp',clearance:2},fp);
  const s=source(out(spin,layout),'PlannedRoutePaths.java');assert.match(s,/\.heading\(turn\(0, 360\)\)/);assert.match(s,/Interpolator\.geometric\(\(curve, t\) -> from \+ by \* t\)/);
  // Tracking a target: Pedro's facingPoint on the actual curve.
  const track=P.plan({start,zones:[],pins:[{x:100,y:60,path:{rotate:'track',target:{x:72,y:130}}}],style:'sharp',clearance:2},fp);
  assert.match(source(out(track,layout),'PlannedRoutePaths.java'),/\.facingPoint\(v\(72, 130\)\)/);
  // Smooth routes become Bezier curves with their control points.
  const curve=P.plan({start,zones:[],pins:[{x:72,y:60},{x:120,y:30}],style:'spline',clearance:2},fp);
  assert.match(source(out(curve,layout),'PlannedRoutePaths.java'),/Paths\.curve\(v\(24, 24\), v\([\d.]+, [\d.]+\), v\([\d.]+, [\d.]+\), v\(72, 60\)\)/);
});

test('Pedro export: legs stop for pauses, actions and turns and drive straight through otherwise',()=>{
  const start={x:20,y:24,heading:0},layout=layoutOf(start);
  // Different powers split the straight run into legs without a stop; the pause ends the route there.
  const route=P.plan({start,zones:[],pins:[{x:50,y:24,path:{power:.5}},{x:80,y:24},{x:110,y:24,wait:1},{x:110,y:80,turn:90}],style:'sharp',clearance:2,defaultPower:1},fp);
  const p=source(out(route,layout),'PlannedRoutePaths.java'),through=/THROUGH = \{([^}]*)\}/.exec(p)[1].split(', ');
  assert.equal(through[0],'true');assert.equal(through.at(-1),'false');assert.ok(through.includes('false'));
  assert.match(p,/MAX_PATH_SPEED = \{0\.5, 1/);assert.match(p,/TURN_AFTER = \{[^}]*Math\.toRadians\(90\)\}/);
});

test('Pedro export: safe stopping, single pass through the legs and no drive after a zero-power path',()=>{
  const start={x:20,y:24,heading:0},layout=layoutOf(start),route=P.plan({start,zones:[],pins:[{x:60,y:24},{x:90,y:24,path:{power:0}}],style:'sharp',clearance:2,defaultPower:.8},fp);
  const o=out(route,layout),op=source(o,'PlannedRoutePedro.java'),paths=source(o,'PlannedRoutePaths.java');
  assert.match(paths,/MAX_PATH_SPEED = \{0\.8, 0\}/);
  assert.match(op,/if \(PlannedRoutePaths\.MAX_PATH_SPEED\[i\] <= 0\) \{\n\s+\/\/[^\n]*\n\s+stopDriving\(\);/);
  // Every loop checks opModeIsActive; the drive and mechanisms stop in finally; Stop during INIT moves nothing.
  for(const loop of op.match(/while \([^)]*\)/g).filter(w=>!/opModeInInit/.test(w)))assert.match(loop,/opModeIsActive\(\)/,loop);
  assert.match(op,/\} finally \{\n\s+\/\/[^\n]*\n\s+try \{\n\s+stopDriving\(\);\n\s+\} finally \{\n\s+actions\.stop\(\);/);assert.match(op,/if \(isStopRequested\(\)\) \{\n\s+actions\.stop\(\);\n\s+return;/);
  assert.match(op,/follower\.drivetrain\.stop\(\);/);assert.equal((op.match(/for \(int i = 0; i < legs\.length/g)||[]).length,1);
  // Speed limits use Foresight's maxPathSpeed for one path only.
  assert.match(op,/path\.with\(\(\(Foresight\) follower\.algorithm\(\)\)\.config\.maxPathSpeed\.at\(speed\)\)/);
  assert.equal(o.checklist.filter(c=>c.status==='verified').length,3);assert.ok(o.checklist.some(c=>c.status==='physical'));
});

test('Pedro export: refuses what it cannot represent, with an explanation',()=>{
  const start={x:20,y:24,heading:0},layout=layoutOf(start),route=P.plan({start,zones:[],pins:[{x:60,y:24}],style:'sharp',clearance:2},fp);
  assert.throws(()=>out(route,layout,{className:'bad name'}),/Class name/);assert.throws(()=>out(route,layout,{className:'Follower'}),/conflicts/);
  assert.throws(()=>out(route,layout,{packageName:'org.class.teamcode'}),/reserved/);
  assert.throws(()=>out({...route,nonholonomic:true},layout),/mecanum and swerve/);assert.throws(()=>out(null,layout),/Plan a route/);
  const broken={...route,segments:route.segments.map(s=>({...s,points:s.points.map((p,i)=>i?{x:NaN,y:p.y}:p)}))};assert.throws(()=>out(broken,layout),/not a number/);
});

test('Pedro export: mechanisms from Deck come along with Pedro poses',()=>{
  const M=require('../ui/sim-mechanisms.js'),mech=M.sanitize({enabled:true,intakes:[{sides:['front']}],shooters:[{type:'turret'}]});
  const start={x:20,y:24,heading:0},layout=layoutOf(start),route=P.plan({start,zones:[],pins:[{x:60,y:24,action:'Shoot'}],style:'sharp',clearance:2},fp);
  const o=out(route,layout,{mechanisms:mech,target:{x:72,y:120},robot:{length:17,width:17}}),m=source(o,'Mechanisms.java');
  assert.match(m,/import com\.pedropathing\.math\.Pose;/);assert.match(source(o,'RouteActions.java'),/return mech\.shoot\(/);
});

test('Pedro starter constants: Pedro\'s Mecanum and Pinpoint/OTOS with Foresight from the simulated robot',()=>{
  const F=require('../ui/sim-ftc.js'),robot={drivetrain:'mecanum',length:17,width:17,driveRpm:500};
  const tuning={maxForward:86.6,maxStrafe:69.3,forwardDeceleration:83.8,strafeDeceleration:68.9,linearBrakeForward:.0941,linearBrakeStrafe:.0403,quadraticBrakeForward:.00176,quadraticBrakeStrafe:.00237,headingBrakeLinear:.0601,headingBrakeQuadratic:.00486,headingP:3.95,translationalP:.304,translationalSmall:.101};
  const pinpoint=Pedro.starterConstants({hardware:F.hardware(robot,'fused'),tuning});
  assert.match(pinpoint,/^package org\.firstinspires\.ftc\.teamcode\.pedro;/);assert.match(pinpoint,/public class DeckStarterConstants/);
  assert.match(pinpoint,/return new Follower\(new PinpointLocalizer\(h, localizer\(\)\), new Mecanum\(h, drivetrain\(\)\), new Foresight\(foresight\(\)\)\);/);
  assert.match(pinpoint,/c\.frontLeftName\.set\("front_left"\);/);assert.match(pinpoint,/c\.frontLeftDirection\.set\(DcMotorSimple\.Direction\.REVERSE\);/);assert.match(pinpoint,/c\.frontRightDirection\.set\(DcMotorSimple\.Direction\.FORWARD\);/);
  assert.match(pinpoint,/c\.maxAchievableForwardVelocity\.set\(86\.6\);/);assert.match(pinpoint,/c\.quadraticBrakeCoefficients\.set\(Matrix\.diag\(0\.001760, 0\.002370\)\);/);assert.match(pinpoint,/STARTING VALUES/);
  const otos=Pedro.starterConstants({hardware:F.hardware(robot,'optical'),tuning});assert.match(otos,/new OTOSLocalizer\(h, localizer\(\)\)/);assert.match(otos,/c\.name\.set\("sensor_otos"\);/);
  assert.throws(()=>Pedro.starterConstants({hardware:F.hardware(robot,'encoders'),tuning}),/^Error: Pedro Pathing needs odometry to know where the robot is: a goBILDA Pinpoint with its two pods, a SparkFun OTOS, or two or three odometry pods\. Add one in Setup → Mechanisms → \+ Add to Chassis → Odometry & IMU\.$/);
  assert.throws(()=>Pedro.starterConstants({hardware:F.hardware(robot,'fused'),tuning:{}}),/load the simulation/);
  // The export writes it beside the Quickstart's Constants.java when it can describe the robot.
  const start={x:20,y:24,heading:0},route=P.plan({start,zones:[],pins:[{x:60,y:24}],style:'sharp',clearance:2},fp),o=out(route,layoutOf(start),{hardware:F.hardware(robot,'fused'),tuning});
  assert.ok(o.starter);assert.ok(o.files['org/firstinspires/ftc/teamcode/pedro/DeckStarterConstants.java']);assert.equal(out(route,layoutOf(start)).starter,false);
  assert.match(o.checklist.find(c=>c.label==='Pedro setup').detail,/DeckStarterConstants\.java \(written beside it for mecanum robots with odometry pods, a Pinpoint with its two pods, or an OTOS\)/);
});

// A Pinpoint alone (no pods) is the robot's IMU. Pedro's PinpointLocalizer reads the Pinpoint's pods, so it gets no starter
// constants, as with the drive encoders, and the refusal says what to add and where instead of listing the Pinpoint it has.
test('Pedro and a Pinpoint alone: no starter constants, and the export says plainly that Pedro needs its two pods',()=>{
  const F=require('../ui/sim-ftc.js'),robot={drivetrain:'mecanum',length:17,width:17,driveRpm:500,pinpointImu:true};
  const tuning={maxForward:86.6,maxStrafe:69.3,forwardDeceleration:83.8,strafeDeceleration:68.9,linearBrakeForward:.0941,linearBrakeStrafe:.0403,quadraticBrakeForward:.00176,quadraticBrakeStrafe:.00237,headingBrakeLinear:.0601,headingBrakeQuadratic:.00486,headingP:3.95,translationalP:.304,translationalSmall:.101};
  const said='This robot’s Pinpoint has no pods, and Pedro Pathing’s Pinpoint localizer needs its two odometry pods. To use Pedro, pick Pinpoint + 2 odometry pods (or an OTOS, or odometry pods) in Setup → Mechanisms → + Add to Chassis → Odometry & IMU.';
  for(const localization of ['encoders','gyro']){const hardware=F.hardware(robot,localization);assert.equal(hardware.pinpointImu,true);
    assert.throws(()=>Pedro.starterConstants({hardware,tuning}),e=>e.message===said,localization);assert.equal(Pedro.starterNeeds(hardware),said);}
  assert.equal(Pedro.starterNeeds(F.hardware({...robot,pinpointImu:false},'fused')),'','with its pods it has Pedro’s Pinpoint localizer');
  // The export goes ahead without DeckStarterConstants.java, and what it lists for the team says why, where they read it.
  const start={x:20,y:24,heading:0},route=P.plan({start,zones:[],pins:[{x:60,y:24}],style:'sharp',clearance:2},fp),o=out(route,layoutOf(start),{robot,localization:'encoders',hardware:F.hardware(robot,'encoders'),tuning});
  assert.equal(o.starter,false);assert.equal(o.files['org/firstinspires/ftc/teamcode/pedro/DeckStarterConstants.java'],undefined);
  const setup=o.checklist.find(c=>c.label==='Pedro setup').detail;assert.ok(setup.endsWith(`Torque wrote no DeckStarterConstants.java for this robot. ${said}`),setup);assert.doesNotMatch(setup,/written beside it/);
  assert.ok(Object.values(o.files).some(s=>s.includes('Torque wrote no DeckStarterConstants.java for this robot.')),'the OpMode’s own checklist says it too');
});

test('Pedro starter constants for two and three odometry pods with the hub IMU',()=>{
  const F=require('../ui/sim-ftc.js'),robot={drivetrain:'mecanum',length:17,width:17,driveRpm:500};
  const tuning={maxForward:86.6,maxStrafe:69.3,forwardDeceleration:83.8,strafeDeceleration:68.9,linearBrakeForward:.0941,linearBrakeStrafe:.0403,quadraticBrakeForward:.00176,quadraticBrakeStrafe:.00237,headingBrakeLinear:.0601,headingBrakeQuadratic:.00486,headingP:3.95,translationalP:.304,translationalSmall:.101};
  const two=Pedro.starterConstants({hardware:F.hardware(robot,'odometry'),tuning});
  assert.match(two,/new TwoWheelLocalizer\(h, localizer\(\)\)/);assert.match(two,/c\.xPodName\.set\("par"\);/);assert.match(two,/c\.yPodName\.set\("perp"\);/);
  // Pedro's sign: the forward pod 4 in left of centre gives xPodOffset -4; the strafe pod 3 in behind gives yPodOffset -3.
  assert.match(two,/c\.xPodOffset\.set\(-4\.0\);/);assert.match(two,/c\.yPodOffset\.set\(-3\.0\);/);assert.match(two,/c\.forwardTicksToInches\.set\(0\.00197896\);/);
  assert.match(two,/new RevHubIMU\(new RevHubOrientationOnRobot\(RevHubOrientationOnRobot\.LogoFacingDirection\.UP, RevHubOrientationOnRobot\.UsbFacingDirection\.FORWARD\)\)/);
  const three=Pedro.starterConstants({hardware:F.hardware(robot,'odometry3'),tuning});
  assert.match(three,/new ThreeWheelIMULocalizer\(h, localizer\(\)\)/);assert.match(three,/c\.leftEncoderName\.set\("par_left"\);/);assert.match(three,/c\.rightEncoderName\.set\("par_right"\);/);
  assert.match(three,/c\.leftPodY\.set\(6\.0\);/);assert.match(three,/c\.rightPodY\.set\(-6\.0\);/);assert.match(three,/c\.strafePodX\.set\(-3\.0\);/);assert.doesNotMatch(three,/PinpointConfig|OTOSConfig/);
});

test('names with Java unicode escapes or comment ends stay inside comments and strings',()=>{
  const X=require('../ui/sim-export.js'),F=require('../ui/sim-ftc.js');
  const name='Red \\u002a/ "auto" */ \\\\u000a end',start={x:20,y:24,heading:0},layout={...layoutOf(start),name};
  const route=P.plan({start,zones:[],pins:[{x:60,y:24,action:name,wait:.2}],style:'sharp',clearance:2,defaultPower:.8},fp);
  const routeJava=X.java(route,layout,{polygon:P.polygon});
  const all=[...Object.values(out(route,layout,{setupName:name}).files),...Object.values(F.files({route,layout,tuning:{},robot:{rpm:500,length:17,width:17},localization:'odometry',setupName:name,routeJava}).files),routeJava];
  for(const src of all){
    // Outside string literals, a backslash before u would be decoded by javac.
    const code=src.replace(/"(?:[^"\\\n]|\\.)*"/g,'""');
    assert.doesNotMatch(code,/(^|[^\\])(\\\\)*\\u/,src.slice(0,200));
    assert.equal((code.match(/\/\*/g)||[]).length,(code.match(/\*\//g)||[]).length,'every comment that opens is closed once');
  }
});

test('Pedro export for a swerve robot: no starter constants, and no claim that the Follower run was checked',()=>{
  const F=require('../ui/sim-ftc.js'),start={x:24,y:24,heading:0},layout=layoutOf(start),route=P.plan({start,zones:[],pins:[{x:90,y:40,path:{rotate:'tangent'}}],style:'sharp',clearance:2},fp);
  const robot={drivetrain:'swerve',length:17,width:17,driveRpm:500};assert.equal(F.hardwareIfSupported(robot,'fused'),null);assert.ok(F.hardwareIfSupported({...robot,drivetrain:'mecanum'},'fused'));
  const o=out(route,layout,{robot,hardware:F.hardwareIfSupported(robot,'fused'),tuning:{maxForward:80}});
  assert.ok(!Object.keys(o.files).some(k=>k.endsWith('DeckStarterConstants.java')));assert.match(source(o,'PlannedRoutePaths.java'),/\.tangent\(\)/);
  assert.equal(o.checklist.find(c=>/Follower/.test(c.label)).status,'physical');assert.equal(o.checklist.filter(c=>c.status==='verified').length,2);
  assert.match(source(o,'PlannedRoutePedro.java'),/\[ \] Runs with Pedro’s Follower: Deck’s tests run this output with Pedro’s Follower on mecanum robots only, not with swerve/);
});
