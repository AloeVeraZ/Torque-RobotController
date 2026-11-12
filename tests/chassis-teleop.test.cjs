'use strict';
// The chassis TeleOp Calibrate writes (ui/sim-chassis-teleop.js): one OnBot Java file from what was checked on the robot,
// with the controller mapping the team picked. Where the simulator's JDK and FTC stand-ins are built, each kind is compiled.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const T=require('../ui/sim-chassis-teleop.js');
const pod=(drive,x,y,more={})=>({label:drive,drive,reversed:false,servo:drive+'S',encoder:drive+'E',x,y,zero:1.2,encoderSign:1,servoSign:-1,kP:.004,kI:0,kD:.0001,kS:.05,volts:3.3,...more});
const kiwi={kind:'swerve',tolerance:.9,robot:{hubLogo:'up',hubUsb:'forward'},imu:{name:'imu',scale:1.00123},config:'swerve',date:'2026-11-10',pods:[pod('frontPod',8.5,0,{zero:3.214}),pod('leftPod',-8.5,8.5,{reversed:true}),pod('rightPod',-8.5,-8.5,{encoderSign:-1})]};
const mecanum={kind:'mecanum',robot:{},imu:{name:'imu',scale:1},motors:[{key:'frontLeft',name:'leftFront'},{key:'frontRight',name:'rightFront',reversed:true},{key:'backLeft',name:'leftBack'},{key:'backRight',name:'rightBack',reversed:true}]};
const tank={kind:'tank',robot:{},motors:[{key:'left',name:'left'},{key:'right',name:'right',reversed:true}]};

test('a swerve’s TeleOp carries each pod as calibrated, with no package so every Robot Controller loads it',()=>{
  const t=T.teleopOf(kiwi);assert.equal(t.file,'TorqueChassis.java');assert.equal(t.opMode,'Torque Chassis');const s=t.source;
  assert.doesNotMatch(s,/^package /m,'a packaged OnBot class crash-loops some Robot Controller builds');assert.match(s,/@TeleOp\(name = "Torque Chassis", group = "Torque"\)\npublic class TorqueChassis extends LinearOpMode \{/);
  assert.match(s,/DRIVE = \{"frontPod", "leftPod", "rightPod"\}, STEER = \{"frontPodS", "leftPodS", "rightPodS"\}, ENCODER = \{"frontPodE", "leftPodE", "rightPodE"\};/);
  assert.match(s,/DRIVE_REVERSED = \{false, true, false\};/);assert.match(s,/POD_X = \{8\.5, -8\.5, -8\.5\}, POD_Y = \{0\.0, 8\.5, -8\.5\};/);assert.match(s,/ZERO_VOLTS = \{3\.214, 1\.2, 1\.2\};/);
  assert.match(s,/ENCODER_SIGN = \{1, 1, -1\}, SERVO_SIGN = \{-1, -1, -1\};/);assert.match(s,/KP = \{0\.004, 0\.004, 0\.004\}, KI = \{0\.0, 0\.0, 0\.0\}, KD = \{0\.0001, 0\.0001, 0\.0001\}, KS = \{0\.05, 0\.05, 0\.05\};/);
  assert.match(s,/TOLERANCE_DEGREES = 0\.9, IMU_SCALE = 1\.00123;/);assert.match(s,/LogoFacingDirection\.UP, RevHubOrientationOnRobot\.UsbFacingDirection\.FORWARD/);
  // The short way round: past a quarter turn the wheel runs backwards instead.
  assert.match(s,/if \(Math\.abs\(error\) > 90\) \{ error -= Math\.signum\(error\) \* 180; wheel = -wheel; \}/);
  assert.equal(s.split('{').length,s.split('}').length,'braces balance');
  assert.match(T.teleopOf({...kiwi,pods:[pod('frontPod',8,0,{zero:undefined})]}).error,/Set the wheels straight first.*frontPod/);
  assert.match(T.teleopOf({kind:'kiwi',motors:[{key:'front',name:'f'}]}).error,/swerve, mecanum and tank/);});

test('the controller is mapped the way the team picked',()=>{
  const d=T.teleopOf(mecanum).source;assert.match(d,/double forward = -gamepad1\.left_stick_y, left = -gamepad1\.left_stick_x, turn = -gamepad1\.right_stick_x;/);
  assert.match(d,/if \(gamepad1\.right_bumper\) \{ forward \*= 0\.4; left \*= 0\.4; turn \*= 0\.4; \}/);assert.match(d,/if \(gamepad1\.start\) imu\.resetYaw\(\);/);assert.match(d,/Field centric/);
  const m=T.teleopOf({...mecanum,map:{drive:'right',turn:'triggers',slow:'none',reset:'y',field:'no'}}).source;
  assert.match(m,/forward = -gamepad1\.right_stick_y, left = -gamepad1\.right_stick_x, turn = gamepad1\.left_trigger - gamepad1\.right_trigger;/);assert.doesNotMatch(m,/0\.4/);assert.match(m,/if \(gamepad1\.y\) imu\.resetYaw\(\);/);assert.doesNotMatch(m,/Field centric/);
  // Driving and turning cannot both be the same stick's left and right; a choice not on the list is the default.
  assert.deepEqual(T.mapOf({drive:'right',turn:'right',slow:'x'}),{drive:'right',turn:'left',slow:'right_bumper',reset:'start',field:'yes'});
  // Mecanum: forward, left and a turn to the left, wheel by wheel. Tank: a side each, never field centric.
  assert.match(d,/double\[\] power = \{forward - left - turn, forward \+ left \+ turn, forward \+ left - turn, forward - left \+ turn\};/);assert.match(d,/DRIVE_REVERSED = \{false, true, false, true\};/);
  const k=T.teleopOf(tank).source;assert.match(k,/double\[\] power = \{forward - turn, forward \+ turn\};/);assert.doesNotMatch(k,/Field centric/);});

test('each kind compiles against the FTC SDK stand-ins',t=>{
  const root=path.join(__dirname,'..'),javac=path.join(root,'sim-runtime/java/bin',process.platform==='win32'?'javac.exe':'javac'),stubs=path.join(root,'tools/simulation/java');
  if(!fs.existsSync(javac)||!fs.existsSync(stubs))return t.skip('the simulator’s JDK is not built here');
  for(const [name,o] of [['swerve',kiwi],['mecanum',mecanum],['mecanum mapped',{...mecanum,map:{drive:'right',turn:'triggers',slow:'left_bumper',reset:'dpad_up',field:'no'}}],['tank',tank]]){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'torque-chassis-')),file=path.join(dir,'TorqueChassis.java');fs.writeFileSync(file,T.teleopOf(o).source);
    try{execFileSync(javac,['-nowarn','-proc:none','-sourcepath',stubs,'-d',path.join(dir,'out'),file],{stdio:'pipe'});}catch(e){assert.fail(`${name} does not compile:\n${String(e.stderr||e.message).slice(0,1500)}`);}
    finally{fs.rmSync(dir,{recursive:true,force:true});}}});
