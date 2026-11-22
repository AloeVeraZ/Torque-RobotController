'use strict';
// The chassis TeleOp Calibrate writes (ui/sim-chassis-teleop.js): one OnBot Java file from what was checked on the robot,
// with the controller mapping the team picked. Where the simulator's JDK and FTC stand-ins are built, each kind is compiled.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const T=require('../ui/sim-chassis-teleop.js');
const pod=(drive,x,y,more={})=>({label:drive,drive,reversed:false,servo:drive+'S',encoder:drive+'E',x,y,zero:1.2,encoderSign:1,servoSign:-1,gain:40,leadP:.083,leadN:.071,creepP:.115,creepN:.085,creepSpeedP:30,creepSpeedN:45,slope:2000,top:480,pushP:110,pushN:65,zone:8,ease:1,still:12,lag:.14,volts:3.3,...more});
const kiwi={kind:'swerve',tolerance:.9,robot:{hubLogo:'up',hubUsb:'forward'},imu:{name:'imu',scale:1.00123},config:'swerve',date:'2026-11-10',pods:[pod('frontPod',8.5,0,{zero:3.214}),pod('leftPod',-8.5,8.5,{reversed:true}),pod('rightPod',-8.5,-8.5,{encoderSign:-1})]};
const mecanum={kind:'mecanum',robot:{},imu:{name:'imu',scale:1},motors:[{key:'frontLeft',name:'leftFront'},{key:'frontRight',name:'rightFront',reversed:true},{key:'backLeft',name:'leftBack'},{key:'backRight',name:'rightBack',reversed:true}]};
const tank={kind:'tank',robot:{},motors:[{key:'left',name:'left'},{key:'right',name:'right',reversed:true}]};

test('a swerve’s TeleOp carries each pod as calibrated, with no package so every Robot Controller loads it',()=>{
  const t=T.teleopOf(kiwi);assert.equal(t.file,'TorqueChassis.java');assert.equal(t.opMode,'Torque Chassis');const s=t.source;
  assert.doesNotMatch(s,/^package /m,'a packaged OnBot class crash-loops some Robot Controller builds');assert.match(s,/@TeleOp\(name = "Torque Chassis", group = "Torque"\)\npublic class TorqueChassis extends LinearOpMode \{/);
  assert.match(s,/DRIVE = \{"frontPod", "leftPod", "rightPod"\}, STEER = \{"frontPodS", "leftPodS", "rightPodS"\}, ENCODER = \{"frontPodE", "leftPodE", "rightPodE"\};/);
  assert.match(s,/DRIVE_REVERSED = \{false, true, false\};/);assert.match(s,/POD_X = \{8\.5, -8\.5, -8\.5\}, POD_Y = \{0\.0, 8\.5, -8\.5\};/);assert.match(s,/ZERO_VOLTS = \{3\.214, 1\.2, 1\.2\};/);
  assert.match(s,/ENCODER_SIGN = \{1, 1, -1\}, SERVO_SIGN = \{-1, -1, -1\};/);assert.match(s,/GAIN = \{40\.0, 40\.0, 40\.0\}, LEAD_P_SECONDS = \{0\.083, 0\.083, 0\.083\}, LEAD_N_SECONDS = \{0\.071, 0\.071, 0\.071\};/);
  assert.match(s,/CREEP_P = \{0\.115, 0\.115, 0\.115\}, CREEP_N = \{0\.085, 0\.085, 0\.085\}, CREEP_P_DEGREES_A_SECOND = \{30\.0, 30\.0, 30\.0\}, CREEP_N_DEGREES_A_SECOND = \{45\.0, 45\.0, 45\.0\};/);
  assert.match(s,/DEGREES_A_SECOND_PER_POWER = \{2000\.0, 2000\.0, 2000\.0\}, TOP_DEGREES_A_SECOND = \{480\.0, 480\.0, 480\.0\};/);assert.match(s,/PUSH_P_DEGREES_A_SECOND = \{110\.0, 110\.0, 110\.0\}, PUSH_N_DEGREES_A_SECOND = \{65\.0, 65\.0, 65\.0\}, ZONE_DEGREES = \{8\.0, 8\.0, 8\.0\}, EASE_DEGREES = \{1\.0, 1\.0, 1\.0\};/);
  // Each pod's own loop as it was tuned, given the servo's sign, stepped every loop with the time that really passed, on one bulk read a loop.
  assert.match(s,/static final class Steer \{/);assert.match(s,/loop\[i\] = new Steer\(SERVO_SIGN\[i\], GAIN\[i\], LEAD_P_SECONDS\[i\], LEAD_N_SECONDS\[i\], CREEP_P\[i\], CREEP_N\[i\], CREEP_P_DEGREES_A_SECOND\[i\], CREEP_N_DEGREES_A_SECOND\[i\], DEGREES_A_SECOND_PER_POWER\[i\], TOP_DEGREES_A_SECOND\[i\], PUSH_P_DEGREES_A_SECOND\[i\], PUSH_N_DEGREES_A_SECOND\[i\], ZONE_DEGREES\[i\], EASE_DEGREES\[i\], STILL_DEGREES_A_SECOND\[i\], PUSH_WAIT_SECONDS\[i\], TOLERANCE_DEGREES\);/);
  assert.match(s,/double power = steerPower\[i\] = loop\[i\]\.step\(error, angle, dt\);/);assert.match(s,/hub\.setBulkCachingMode\(LynxModule\.BulkCachingMode\.MANUAL\);/);assert.match(s,/for \(LynxModule hub : hubs\) hub\.clearBulkCache\(\);/);
  assert.match(s,/TOLERANCE_DEGREES = 0\.9, IMU_SCALE = 1\.00123;/);assert.match(s,/LogoFacingDirection\.UP, RevHubOrientationOnRobot\.UsbFacingDirection\.FORWARD/);
  // The short way round: past a quarter turn the wheel runs backwards instead (at a quarter turn, the way that leaves the pod forward or left).
  assert.match(s,/boolean flip = Math\.abs\(error\) > 95;/);assert.match(s,/if \(flip\) \{ error -= Math\.signum\(error\) \* 180; wheel = -wheel; \}/);
  assert.equal(s.split('{').length,s.split('}').length,'braces balance');
  assert.match(T.teleopOf({...kiwi,pods:[pod('frontPod',8,0,{zero:undefined})]}).error,/Set the wheels straight first.*frontPod/);
  assert.match(T.teleopOf({kind:'kiwi',motors:[{key:'front',name:'f'}]}).error,/needs 3 drive motors, but Setup has 1/);
  assert.match(T.teleopOf({kind:'diffSwerve',motors:[]}).error,/differential swerve needs its own calibration/);});

test('the controller is mapped the way the team picked',()=>{
  const d=T.teleopOf(mecanum).source;assert.match(d,/double forward = -gamepad1\.left_stick_y, left = -gamepad1\.left_stick_x, turn = -gamepad1\.right_stick_x;/);
  assert.match(d,/if \(gamepad1\.right_bumper\) \{ forward \*= 0\.4; left \*= 0\.4; turn \*= 0\.4; \}/);assert.match(d,/if \(gamepad1\.start\) imu\.resetYaw\(\);/);assert.match(d,/Field centric/);
  const m=T.teleopOf({...mecanum,map:{drive:'right',turn:'triggers',slow:'none',reset:'y',field:'no'}}).source;
  assert.match(m,/forward = -gamepad1\.right_stick_y, left = -gamepad1\.right_stick_x, turn = gamepad1\.left_trigger - gamepad1\.right_trigger;/);assert.doesNotMatch(m,/0\.4/);assert.match(m,/if \(gamepad1\.y\) imu\.resetYaw\(\);/);assert.doesNotMatch(m,/Field centric/);
  // Driving and turning cannot both be the same stick's left and right; a choice not on the list is the default.
  assert.deepEqual(T.mapOf({drive:'right',turn:'right',slow:'x'}),{drive:'right',turn:'left',spin:'none',lock:'none',slow:'right_bumper',reset:'start',field:'yes'});
  // Mecanum: forward, left and a turn to the left, wheel by wheel. Tank: a side each, never field centric.
  assert.match(d,/double\[\] power = \{forward - left - turn, forward \+ left \+ turn, forward \+ left - turn, forward - left \+ turn\};/);assert.match(d,/DRIVE_REVERSED = \{false, true, false, true\};/);
  const k=T.teleopOf(tank).source;assert.match(k,/double\[\] power = \{forward - turn, forward \+ turn\};/);assert.doesNotMatch(k,/Field centric/);});

test('each kind compiles against the FTC SDK stand-ins',t=>{
  const root=path.join(__dirname,'..'),javac=path.join(root,'sim-runtime/java/bin',process.platform==='win32'?'javac.exe':'javac'),stubs=path.join(root,'tools/simulation/java');
  if(!fs.existsSync(javac)||!fs.existsSync(stubs))return t.skip('the simulator’s JDK is not built here');
  const HM=require('../ui/sim-hub-mount.js'),tilted={code:'',...HM.javaOf({logo:'up',usb:'forward',off:30,quaternion:{w:.965926,x:.258819,y:0,z:0}})};
  assert.ok(T.teleopOf({...kiwi,imu:{name:'imu',scale:1,mount:tilted}}).source.includes('imu.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(new Quaternion(0.965926f, 0.258819f, 0f, 0f, 0))));'),'a hub that is not square is given as its exact angle');
  for(const [name,o] of [['swerve',kiwi],['swerve on a tilted hub',{...kiwi,imu:{name:'imu',scale:1,mount:tilted}}],['mecanum on a tilted hub',{...mecanum,imu:{name:'imu',scale:1,mount:tilted}}],['mecanum',mecanum],['mecanum mapped',{...mecanum,map:{drive:'right',turn:'triggers',slow:'left_bumper',reset:'dpad_up',field:'no'}}],['tank',tank]]){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'torque-chassis-')),file=path.join(dir,'TorqueChassis.java');fs.writeFileSync(file,T.teleopOf(o).source);
    try{execFileSync(javac,['-nowarn','-proc:none','-sourcepath',stubs,'-d',path.join(dir,'out'),file],{stdio:'pipe'});}catch(e){assert.fail(`${name} does not compile:\n${String(e.stderr||e.message).slice(0,1500)}`);}
    finally{fs.rmSync(dir,{recursive:true,force:true});}}});

test('the IMU turn test: an autonomous on the heading alone, the IMU the way round Calibrate found, slowing into each angle',t=>{
  const o={...mecanum,imu:{name:'imu',scale:-1.02},config:'robot',date:'2026-11-20'},out=T.turnTestOf(o);
  assert.equal(out.file,'org/firstinspires/ftc/teamcode/TorqueTurnTest.java');assert.equal(out.opMode,'Torque IMU turn test');assert.match(out.source,/@Autonomous\(name = "Torque IMU turn test", group = "Torque"\)/);
  assert.match(out.source,/static final double IMU_SCALE = -1\.02;/,'the way round and the scale Calibrate measured');assert.match(out.source,/static final double\[\] ANGLES = \{90\.0, 0\.0, -90\.0, 0\.0, 180\.0, 0\.0\};/);
  assert.match(out.source,/lastYaw = imu\.getRobotYawPitchRollAngles\(\)\.getYaw\(AngleUnit\.DEGREES\);\n\s+heading = 0;/,'where it stands at START is 0°');assert.match(out.source,/heading \+= wrap\(yaw - lastYaw\) \* IMU_SCALE;/);
  assert.match(out.source,/Turn turn = new Turn\(TOP_TURN, LEAST_TURN, SLOW_FROM_DEGREES, BRAKE, DONE_DEGREES, LAG_SECONDS\);/,'every turn by the one turn law');assert.match(out.source,/static final class Turn \{/);assert.match(out.source,/power = turn\.step\(target, now, t\)/);assert.match(out.source,/LAG_SECONDS = 0\.02;/);assert.doesNotMatch(out.source,/gamepad|getCurrentPosition|Pinpoint/,'nothing but the IMU');
  assert.deepEqual(T.turnTestOf({...o,angles:[45,'x',-45]}).source.match(/ANGLES = \{([^}]*)\}/)[1],'45.0, -45.0');assert.match(T.turnTestOf(kiwi).error,/do not steer/);assert.match(T.turnTestOf(null).error,/do not steer/);
  // What the follower on the robot does too: its turn feedback is held under a power that falls with what is left to turn.
  assert.match(require('../ui/sim-follower-source.js'),/double turnCap=Math\.max\(\.08,Math\.min\(1,\.05\+\.4\*Math\.sqrt\(Math\.abs\(headingError\)\)\)\);turn=clamp\(turn,-turnCap,turnCap\);/);
  const root=path.join(__dirname,'..'),javac=path.join(root,'sim-runtime/java/bin',process.platform==='win32'?'javac.exe':'javac'),stubs=path.join(root,'tools/simulation/java');
  if(!fs.existsSync(javac)||!fs.existsSync(stubs))return t.skip('the simulator’s JDK is not built here');
  for(const [name,x] of [['mecanum',o],['tank',{...o,kind:'tank'}],['kiwi wheels',{...o,kind:'kiwi',motors:[{key:'front',name:'f'},{key:'backLeft',name:'bl'},{key:'backRight',name:'br'}]}]]){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'torque-turn-')),file=path.join(dir,'TorqueTurnTest.java');fs.writeFileSync(file,T.turnTestOf(x).source);
    try{execFileSync(javac,['-nowarn','-proc:none','-sourcepath',stubs,'-d',path.join(dir,'out'),file],{stdio:'pipe'});}catch(e){assert.fail(`${name} does not compile:\n${String(e.stderr||e.message).slice(0,1500)}`);}
    finally{fs.rmSync(dir,{recursive:true,force:true});}}});

test('IMU tuning: one line to Torque Debug, which runs it on the robot, and the result it sends back',()=>{
  const motors=[{name:'fl',power:-1},{name:'fr',power:1},{name:'bl',power:-1},{name:'br',power:1}];
  const std=T.turnLineOf({job:'tune',id:7,tolerance:2,heading:{kind:'hub',name:'imu'},mount:{logo:'up',usb:'forward'},scale:-1,motors});
  assert.equal(std.line,['U','tune','7','2','0.25','0.07','60','0.002','0.02','imu:imu','L:UP:FORWARD','-1','fl','-1','fr','1','bl','-1','br','1'].join('\t'));
  const chk=T.turnLineOf({job:'check',id:8,tolerance:1.5,turn:{top:.6,least:.08,slowFrom:70,brake:.0017,lag:.012},heading:{kind:'pinpoint',name:'GBPP'},mount:{quaternion:{w:.7071068,x:0,y:.7071068,z:0}},motors});
  assert.equal(chk.line.split('\t').slice(0,12).join(' '),'U check 8 1.5 0.6 0.08 70 0.0017 0.012 pin:GBPP Q:0.707107:0:0.707107:0 1');
  assert.equal(T.turnLineOf({motors,tolerance:99}).tolerance,10);assert.equal(T.turnLineOf({motors,job:'nonsense'}).job,'tune');assert.match(T.turnLineOf({motors:[]}).error,/do not steer/);
  // What it sends back: the standard one keeps the quickest of the good powers, the aggressive one the most power that was good.
  const round=(power,seconds,ok,worst=1)=>({power,rate:200,coast:12,slowFrom:80,brake:.0017,worst,over:2,seconds,ok}),res=(mode,rounds)=>JSON.stringify({v:2,mode,backwards:false,least:.07,tolerance:2,repeats:3,problem:'',rounds});
  assert.equal(T.turnResultOf(res('standard',[round(.5,2.2,true),round(.55,1.9,true),round(.6,1.95,true),round(.65,1.8,false)])).best.power,.55);
  assert.equal(T.turnResultOf(res('standard',[round(.5,2,true,1.5),round(.55,2.01,true,.9)])).best.power,.55,'as quick within 0.02 s, the more accurate');
  assert.equal(T.turnResultOf(res('aggressive',[round(.75,1.5,true),round(.8,1.4,true),round(.85,1.45,false),round(.9,1.3,true)])).best.power,.9);
  assert.equal(T.turnResultOf(res('aggressive',[round(.75,1.5,false)])).best,null);assert.equal(T.turnResultOf('not json'),null);assert.equal(T.turnResultOf(null),null);});

// Names come from the team's own robot configuration and mechanism list: whatever they typed, the file must still build.
test('names with a line break, a backslash-u or two mechanisms that read alike still give a TeleOp that compiles',t=>{
  const mechanisms=[{label:'Claw',kind:'servo',device:'claw',mode:'flip',a:'a',posA:.2,posB:.8},{label:'Claw on',kind:'motor',device:'claw\\up "2"',mode:'toggle',a:'b',power:1},{label:'lift\\up\nand down',kind:'motor',device:'lift',mode:'hold',a:'x',b:'y',power:.5}];
  const o={...mecanum,config:'comp\\ubot\n"final" */',mechanisms},s=T.teleopOf(o).source;
  assert.doesNotMatch(s,/(?<!\\)\\u(?![0-9a-fA-F]{4})/,'no backslash-u the compiler would read as a broken character');
  assert.match(s,/boolean clawOn = false, clawWas = false;/);assert.match(s,/boolean clawOnBOn = false, clawOnBWas = false;/,'the second is renamed: its own name was the first one’s variable');
  assert.ok(s.includes('hardwareMap.get(DcMotor.class, "claw\\\\up \\"2\\"")'),'the device name reaches the robot as it was typed');
  const root=path.join(__dirname,'..'),javac=path.join(root,'sim-runtime/java/bin',process.platform==='win32'?'javac.exe':'javac'),stubs=path.join(root,'tools/simulation/java');
  if(!fs.existsSync(javac)||!fs.existsSync(stubs))return t.skip('the simulator’s JDK is not built here');
  for(const [name,x] of [['TeleOp',T.teleopOf(o)],['turn test',T.turnTestOf({...o,turn:{top:.3}})]]){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'torque-chassis-')),file=path.join(dir,path.basename(x.file));fs.writeFileSync(file,x.source);
    try{execFileSync(javac,['-nowarn','-proc:none','-sourcepath',stubs,'-d',path.join(dir,'out'),file],{stdio:'pipe'});}catch(e){assert.fail(`${name} does not compile:\n${String(e.stderr||e.message).slice(0,1500)}`);}
    finally{fs.rmSync(dir,{recursive:true,force:true});}}});
