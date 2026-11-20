'use strict';
// Calibrate → TeleOp (ui/sim-teleop-tab.js, the Java written by ui/sim-chassis-teleop.js): the chassis on the sticks the
// team picked, a swerve's pods taking the shortest way (turning, or staying and running their motors backwards), a
// mecanum moving any way, spin buttons and a wheel lock, each mechanism from Setup on buttons nothing else has, the file
// sent to the robot by itself when it changes, and everything Calibrate measured as one class that builds in OnBot Java. Where the simulator's JDK and FTC stand-ins are built,
// every kind of chassis is compiled with its mechanisms on either controller.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const T=require('../ui/sim-chassis-teleop.js'),R=require('../ui/sim-teleop-tab.js'),TU=require('../ui/sim-tune.js'),K=require('../ui/sim-chassis-cal.js'),C=require('../ui/sim-config.js');
const pod=(n,x,y)=>({label:n,drive:n+'M',reversed:false,servo:n+'S',encoder:n+'E',x,y,zero:1.5,encoderSign:1,servoSign:-1,gain:40,leadP:.083,leadN:.075,creepP:.13,creepN:.1,creepSpeedP:78,creepSpeedN:74,slope:1700,top:475,pushP:150,pushN:140,zone:8,ease:1,still:12,lag:.14,volts:3.3});
const KINDS={swerve:{kind:'swerve',tolerance:.9,pods:[pod('front',6,0),pod('left',-3,5),pod('right',-3,-5)]},mecanum:{kind:'mecanum',motors:[{key:'frontLeft',name:'lf'},{key:'frontRight',name:'rf',reversed:true},{key:'backLeft',name:'lb'},{key:'backRight',name:'rb',reversed:true}]},tank:{kind:'tank',motors:[{key:'left',name:'l'},{key:'right',name:'r'}]}};
const common={robot:{},imu:{name:'imu',scale:1},config:'c',date:'d'};
const MECHS=[{id:'intake:0:roller',label:'Intake 1 rollers',device:'intake',kind:'motor',type:'roller-intake',template:'T3',reversed:true},{id:'shooter:0:flywheel',label:'Shooter 1 flywheel',device:'fly',kind:'motor',type:'flywheel',template:'T3'},{id:'kin:lift',label:'Lift',device:'lift',kind:'motor',type:'lift',template:'T1'},
  {id:'kin:claw',label:'Claw',device:'claw',kind:'servo',type:'claw',template:'T4',posA:.2,posB:.8},{id:'shooter:0:feeder',label:'Feeder',device:'feed',kind:'crservo',type:'feeder'},{id:'shooter:0:hood',label:'Hood',device:'hood',kind:'servo',type:'hood'}];

test('either stick drives and the other turns, the robot can be spun on the spot, and a swerve’s wheels can be locked',()=>{
  // Swapped sticks; the turn never lands on the stick that drives.
  assert.deepEqual([T.mapOf({drive:'right'}).drive,T.mapOf({drive:'right'}).turn],['right','left']);assert.equal(T.mapOf({drive:'left',turn:'left'}).turn,'right');
  const s=T.teleopOf({...KINDS.swerve,...common,map:{drive:'right',turn:'left',spin:'bumpers',lock:'x'}}).source;
  assert.match(s,/double forward = -gamepad1\.right_stick_y, left = -gamepad1\.right_stick_x, turn = -gamepad1\.left_stick_x;/);
  // Spin: a bumper turns it at full rate whatever the turn stick says; the left one spins it left (counterclockwise is positive).
  assert.match(s,/double spin = \(gamepad1\.left_bumper \? 1 : 0\) - \(gamepad1\.right_bumper \? 1 : 0\);\n\s+if \(Math\.abs\(spin\) > 0\.05\) turn = spin;/);
  // The slow button was on a bumper: it moves to a stick click rather than share one.
  assert.equal(T.mapOf({spin:'bumpers'}).slow,'left_stick_button');assert.match(s,/if \(gamepad1\.left_stick_button\) \{ forward \*= 0\.4;/);
  // Lock: every wheel points at the middle of the robot and stops.
  assert.match(s,/boolean lock = gamepad1\.x;/);assert.match(s,/if \(lock\) for \(int i = 0; i < n; i\+\+\) target\[i\] = Math\.toDegrees\(Math\.atan2\(POD_Y\[i\], POD_X\[i\]\)\);/);assert.match(s,/double wheel = moving && !lock \? speed\[i\] \/ top : 0;/);
  // Spin buttons that already turn it are dropped; a lock on the slow button's stick click takes the other one; a mecanum has no lock.
  assert.equal(T.mapOf({turn:'triggers',spin:'triggers'}).spin,'none');assert.equal(T.mapOf({slow:'left_stick_button',lock:'left_stick_button'}).lock,'right_stick_button');
  assert.doesNotMatch(T.teleopOf({...KINDS.mecanum,...common,map:{lock:'x',spin:'dpad'}}).source,/lock/);assert.match(T.teleopOf({...KINDS.mecanum,...common,map:{spin:'dpad'}}).source,/double spin = \(gamepad1\.dpad_left \? 1 : 0\) - \(gamepad1\.dpad_right \? 1 : 0\);/);
  // Nothing new unless it is picked: the chassis TeleOp of before has no spin and no lock.
  const plain=T.teleopOf({...KINDS.swerve,...common}).source;assert.doesNotMatch(plain,/spin|lock/);
  assert.deepEqual(T.chassisButtons({spin:'triggers',lock:'b'}).sort(),['b','left_trigger','right_bumper','right_trigger','start']);
});

test('a swerve’s pods take the shortest way: they turn, or stay and run their motors backwards',()=>{
  // Three pods that turn at 400°/s, driven as the TeleOp drives them, each stick position held for a second.
  const pods=KINDS.swerve.pods,angles=pods.map(()=>0),targets=pods.map(()=>0);let last;
  const hold=(pad,secs=1)=>{for(let t=0;t<secs;t+=.02){last=T.swerveDrive(pods,angles,targets,T.command({field:'no'},pad));last.forEach((x,i)=>{angles[i]+=Math.sign(x.error)*Math.min(Math.abs(x.error),400*.02);});}return {pods:angles.map(a=>Math.round(T.wrapDeg(a))),motors:last.map(x=>+x.power.toFixed(2))};};
  // Stick up: every pod points forward and the motors run forwards. Stick back: the pods stay, the motors run backwards.
  assert.deepEqual(hold({ly:-1}),{pods:[0,0,0],motors:[1,1,1]});assert.deepEqual(hold({ly:1}),{pods:[0,0,0],motors:[-1,-1,-1]});
  // Stick left: the pods turn left, motors forwards. Stick right: the pods stay left, motors backwards.
  assert.deepEqual(hold({lx:-1}),{pods:[90,90,90],motors:[1,1,1]});assert.deepEqual(hold({lx:1}),{pods:[90,90,90],motors:[-1,-1,-1]});
  // From forward, right is as far either way: the pods go left and the motors run backwards, the same as from left.
  hold({ly:-1});assert.deepEqual(hold({lx:1}),{pods:[90,90,90],motors:[-1,-1,-1]});
  // A diagonal: 45° is nearer than 135°, so forward-left turns the pods and back-right only reverses the motors.
  const d=hold({lx:-.7,ly:-.7});assert.deepEqual(d.pods,[45,45,45]);assert.ok(d.motors.every(v=>v>.95));const e=hold({lx:.7,ly:.7});assert.deepEqual(e.pods,[45,45,45]);assert.ok(e.motors.every(v=>v<-.95));
  // A wheel still turning to its angle pushes less (none at a quarter turn off), so it does not drag the robot sideways.
  const cold=T.swerveDrive(pods,[0,0,0],[0,0,0],T.command({field:'no'},{lx:-1,ly:-1}));assert.ok(cold.every(x=>Math.abs(x.error-45)<1e-6&&Math.abs(x.power-Math.cos(Math.PI/4))<.01));
  // Let go of the sticks: the pods stay where they were and the motors stop. Turning on the spot points each pod round the middle.
  assert.deepEqual(hold({}),{pods:[45,45,45],motors:[-0,-0,-0].map(()=>0)});const spin=hold({rx:-1});assert.equal(spin.pods[0],90,'the front pod points across');assert.ok(spin.motors.every(v=>Math.abs(v)>.9));
  // The lock: every pod points at the middle of the robot and nothing drives.
  const lock=T.swerveDrive(pods,[0,0,0],[0,0,0],{forward:1,left:0,turn:0,lock:true});assert.ok(lock.every(x=>x.power===0));assert.equal(Math.round(lock[1].target),Math.round(Math.atan2(5,-3)*180/Math.PI));
  // The Java the robot runs has the same rule.
  const java=T.teleopOf({...KINDS.swerve,...common}).source;assert.match(java,/boolean flip = Math\.abs\(error\) > 95;/);assert.match(java,/if \(!flip && Math\.abs\(error\) >= 85\) \{ double end = target\[i\] - 360\.0 \* Math\.round\(target\[i\] \/ 360\.0\); flip = end <= -90 \|\| end > 90; \}/);
  assert.match(java,/if \(flip\) \{ error -= Math\.signum\(error\) \* 180; wheel = -wheel; \}/);assert.match(java,/drive\[i\]\.setPower\(wheel \* Math\.cos\(Math\.toRadians\(error\)\)\);/);
});

test('a mecanum goes any way: forward and back, strafing left and right, and the diagonals between',()=>{
  const m=KINDS.mecanum.motors,go=pad=>T.wheelPowers(m,T.command({field:'no'},pad)).map(v=>+v.toFixed(2));
  // In the order front left, front right, back left, back right.
  assert.deepEqual(go({ly:-1}),[1,1,1,1]);assert.deepEqual(go({ly:1}),[-1,-1,-1,-1]);
  assert.deepEqual(go({lx:-1}),[-1,1,1,-1],'strafing left: the front left and back right run backwards');assert.deepEqual(go({lx:1}),[1,-1,-1,1]);
  assert.deepEqual(go({lx:1,ly:-1}),[1,0,0,1],'forward and right: only one diagonal pair drives');assert.deepEqual(go({lx:-1,ly:-1}),[0,1,1,0]);
  assert.deepEqual(go({rx:-1}),[-1,1,-1,1],'turning left: the left side backwards, the right side forwards');
  // Driving and turning at once never asks a motor for more than full power: all four are scaled together.
  const both=go({ly:-1,rx:-1});assert.equal(Math.max(...both.map(Math.abs)),1);assert.deepEqual(both,[0,1,0,1]);
  assert.deepEqual(T.wheelPowers(KINDS.tank.motors,T.command({},{ly:-1,lx:-1,rx:1}),true).map(v=>+v.toFixed(2)),[1,0],'a tank ignores sideways');
  // Field centric: with the robot facing left, a stick pushed away from the driver is the robot's right.
  const c=T.command({field:'yes'},{ly:-1},{heading:Math.PI/2});assert.ok(Math.abs(c.forward)<1e-9&&Math.abs(c.left+1)<1e-9);
  // The slow button, and a spin button over the turn stick.
  assert.equal(T.command({},{ly:-1,right_bumper:true}).forward,.4);assert.equal(T.command({spin:'bumpers'},{rx:1,left_bumper:true}).turn,1);
});

test('the controller is read as the drive arithmetic takes it, and the chassis is drawn with a wheel and an arrow for each motor',()=>{
  const pad=R.padOf({axes:[.05,-1,.5,0],buttons:[{value:1},0,0,0,0,{value:1},{value:.7},.1,0,0,0,0,1]});
  assert.deepEqual([pad.lx,pad.ly,pad.rx,pad.lt,pad.rt],[0,-1,.5,.7,.1],'a stick barely off centre reads as centred');assert.deepEqual([pad.a,pad.b,pad.right_bumper,pad.dpad_up,pad.left_trigger,pad.right_trigger],[true,false,true,true,true,false]);assert.deepEqual(R.padOf(null).lx,0);
  const sw=R.chassisArt({...KINDS.swerve});assert.equal(sw.split('data-rt-pod=').length-1,3);assert.equal(sw.split('data-rt-arrow=').length-1,3);
  const me=R.chassisArt({...KINDS.mecanum});assert.equal(me.split('data-rt-arrow=').length-1,4);assert.equal(me.split('class="rt-roller"').length-1,4,'a mecanum wheel shows its rollers');assert.equal(R.chassisArt({...KINDS.tank}).split('class="rt-roller"').length-1,0);assert.equal(R.chassisArt(null),'');
});

test('everything Calibrate measured is one class that builds as it is: the chassis, the mechanisms and the cameras',t=>{
  const kiwi={robot:{drivetrain:'kiwiSwerve',devices:{front:{name:'frontPod'},backLeft:{name:'leftPod'},backRight:{name:'rightPod'}}},sensors:{localization:'encoders'}};
  const more=TU.constantLines([{name:'Lift',template:'T1',rec:{transform:{cpr:537.7,ratio:1,unit:'mm',sign:1,offset:0},range:{lo:0,hi:600},ff:{kS:.05,kG:.1,kV:.002},pid:{kP:.01,kI:0,kD:.0005,tolerance:5}}},{name:'Claw',template:'T5',rec:{gates:{}}}],{lens:{'Webcam 1':{'640x480':{fx:600,fy:601,cx:320,cy:240}},sim:{'640x480':{fx:1,fy:1,cx:1,cy:1}}}});
  assert.match(more.mechs,/LIFT_KP = 0\.01, LIFT_KI = 0, LIFT_KD = 0\.0005, LIFT_TOLERANCE = 5;/);assert.doesNotMatch(more.mechs,/Claw/,'a mechanism with nothing measured is left out');assert.match(more.lens,/LENS_WEBCAM_1_640X480_FY = 601/);assert.doesNotMatch(more.lens,/SIM/);
  const pid={v:6,kP:40,leadP:.083,leadN:.071,cP:.115,cN:.085,vP:.3,vN:.4,slope:19,vmax:4.4,rP:1.1,rN:.65,zone:.0733,ease:.0092,still:.11,lag:.14,g:-1};
  const code=K.codeOf({ch:K.chassisOf(kiwi,C),rec:{steer:{zero:{leftPodE:.743}},pods:{backLeft:{left:true,right:true,sense:1,pid}}},steer:[{key:'robot.steerBackLeft',name:'leftPodE',servo:'leftPodS',volts:3.3}],more});
  assert.match(code,/^public final class TorqueCalibration \{$/m);assert.doesNotMatch(code,/^package /m,'no package, so OnBot Java builds it as it is');assert.doesNotMatch(code,/^import /m,'nothing but plain Java');
  for(const part of [/LEFT_POD_S_GAIN = 40;/,/---- Mechanisms/,/LIFT_MIN = 0, LIFT_MAX = 600;/,/---- Cameras ----/,/LENS_WEBCAM_1_640X480_FX = 600/,/public static final class Steer \{/])assert.match(code,part);
  assert.ok(code.indexOf('---- Mechanisms')<code.lastIndexOf('}')&&code.trim().endsWith('}'));assert.equal(code.split('{').length,code.split('}').length,'braces balance');
  // With no mechanisms and no camera measured, it is the chassis alone, as before.
  assert.doesNotMatch(K.codeOf({ch:K.chassisOf(kiwi,C),rec:{},steer:[]}),/Mechanisms|Cameras/);assert.deepEqual(TU.constantLines([],{}),{mechs:'',lens:''});
  const root=path.join(__dirname,'..'),javac=path.join(root,'sim-runtime/java/bin',process.platform==='win32'?'javac.exe':'javac');if(!fs.existsSync(javac))return t.diagnostic('the simulator’s JDK is not built here: not compiled');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'torque-cal-'));try{fs.writeFileSync(path.join(dir,'TorqueCalibration.java'),code);try{execFileSync(javac,['-nowarn','-proc:none','-d',path.join(dir,'out'),path.join(dir,'TorqueCalibration.java')],{stdio:'pipe'});}catch(e){assert.fail('it does not compile: '+String(e.stderr||e.message).slice(0,500));}}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('each mechanism in Setup gets buttons nothing else has, starting as what it is',()=>{
  const m=T.mechMap(MECHS,{},{pad:'gamepad1',map:{spin:'bumpers',lock:'x'},swerve:true});
  // An intake runs while held, and backwards; a flywheel is switched on and off; a lift goes up and down; a servo flips.
  assert.deepEqual([m['intake:0:roller'].mode,m['shooter:0:flywheel'].mode,m['kin:lift'].mode,m['kin:claw'].mode,m['shooter:0:feeder'].mode],['hold','toggle','updown','flip','hold']);
  assert.deepEqual([m['kin:lift'].a,m['kin:lift'].b],['dpad_up','dpad_down']);assert.notEqual(m['intake:0:roller'].b,'none');assert.deepEqual([m['kin:claw'].posA,m['kin:claw'].posB],[.2,.8],'a servo’s two positions come from Setup when it has them');
  const used=Object.values(m).flatMap(x=>[x.a,x.b]).filter(b=>b!=='none');assert.equal(new Set(used).size,used.length,'no button twice');
  for(const b of T.chassisButtons({spin:'bumpers',lock:'x'}))assert.ok(!used.includes(b),`${b} is the chassis’s`);
  assert.deepEqual(T.clashes(MECHS.map(x=>({...x,...m[x.id]})),{map:{spin:'bumpers',lock:'x'}}),[]);
  // On a second controller they have every button.
  assert.equal(T.mechMap(MECHS,{},{pad:'gamepad2'})['shooter:0:flywheel'].a,'right_bumper');
  // What the team picked stays; what it displaced takes another; a mechanism turned off takes none.
  const picked=T.mechMap(MECHS,{'kin:claw':{mode:'positions',a:'right_trigger',b:'left_trigger'},'kin:lift':{mode:'off'}},{pad:'gamepad2'});
  assert.deepEqual([picked['kin:claw'].mode,picked['kin:claw'].a,picked['kin:claw'].b],['positions','right_trigger','left_trigger']);assert.ok(!['right_trigger','left_trigger'].includes(picked['intake:0:roller'].a));assert.deepEqual([picked['kin:lift'].mode,picked['kin:lift'].a],['off','none']);
  // A mode a device cannot do falls back to its own; with no button left it is left out, and says so.
  assert.equal(T.mechMap([MECHS[3]],{'kin:claw':{mode:'hold'}},{})['kin:claw'].mode,'flip');
  const many=Array.from({length:20},(_,i)=>({id:'m'+String(i).padStart(2,'0'),label:'M'+i,device:'d'+i,kind:'crservo',type:'spinner'})),full=T.mechMap(many,{},{pad:'gamepad2'});assert.equal(Object.values(full).filter(x=>x.full).length,20-Object.keys(T.BUTTONS).length);
  // Two things on one button are named.
  const clash=T.clashes([{label:'A',mode:'hold',a:'y',b:'none'},{label:'B',mode:'flip',a:'y'}],{pad:'gamepad2'});assert.equal(clash.length,1);assert.deepEqual(clash[0].uses,['A','B']);
});

test('the mechanisms are written into the TeleOp as their own devices and buttons',()=>{
  const map={spin:'bumpers'},m=T.mechMap(MECHS,{'shooter:0:hood':{mode:'positions',posA:.3,posB:.6},'kin:lift':{power:.6}},{map}),list=MECHS.map(x=>({...x,...m[x.id]}));
  const t=T.teleopOf({...KINDS.mecanum,...common,map,className:T.FULL_NAME,opMode:T.FULL_OP_MODE,mechanisms:list});assert.equal(t.file,'TorqueTeleOp.java');assert.equal(t.opMode,'Torque TeleOp');const s=t.source;
  assert.match(s,/@TeleOp\(name = "Torque TeleOp", group = "Torque"\)\npublic class TorqueTeleOp extends LinearOpMode \{/);assert.doesNotMatch(s,/^package /m);
  assert.match(s,/DcMotor intake1Rollers = hardwareMap\.get\(DcMotor\.class, "intake"\);\n\s+intake1Rollers\.setDirection\(DcMotorSimple\.Direction\.REVERSE\);/);
  assert.match(s,/intake1Rollers\.setPower\(gamepad1\.right_trigger > 0\.5 \? 1\.0 : gamepad1\.left_trigger > 0\.5 \? -1\.0 : 0\);/);
  assert.match(s,/if \(shooter1FlywheelNow && !shooter1FlywheelWas\) shooter1FlywheelOn = !shooter1FlywheelOn;/);
  assert.match(s,/lift\.setZeroPowerBehavior\(DcMotor\.ZeroPowerBehavior\.BRAKE\);/);assert.match(s,/lift\.setPower\(gamepad1\.dpad_up \? 0\.6 : gamepad1\.dpad_down \? -0\.6 : 0\);/);
  assert.match(s,/claw\.setPosition\(clawOn \? 0\.8 : 0\.2\);/);assert.match(s,/hood\.setPosition\(0\.3\); else if \(gamepad1\.\w+\) hood\.setPosition\(0\.6\);/);
  for(const i of ['com.qualcomm.robotcore.hardware.Servo','com.qualcomm.robotcore.hardware.CRServo'])assert.ok(s.includes(`import ${i};`));
  assert.ok(s.indexOf('DcMotor intake1Rollers')<s.indexOf('waitForStart();'),'the devices are found before start');assert.ok(s.indexOf('intake1Rollers.setPower')>s.indexOf('while (opModeIsActive())'));assert.equal(s.split('{').length,s.split('}').length,'braces balance');
  // The chassis alone keeps its own name and nothing of the mechanisms.
  const alone=T.teleopOf({...KINDS.mecanum,...common});assert.equal(alone.file,'TorqueChassis.java');assert.doesNotMatch(alone.source,/Mechanisms/);
  // A name that is not a Java name, or one the TeleOp uses itself, gets a plain one; a device with no name is left out.
  const odd=T.mechCode([{label:'drive',device:'x',kind:'crservo',mode:'hold',a:'y'},{label:'2nd arm!',device:'y',kind:'motor',mode:'hold',a:'x'},{label:'No name',device:'',kind:'motor',mode:'hold',a:'a'}]);
  assert.match(odd.init.join('\n'),/CRServo mech1 = /);assert.match(odd.init.join('\n'),/DcMotor mech2 = /);assert.doesNotMatch(odd.init.join('\n'),/No name/);
});

test('the TeleOp is written from the choices kept, and sent by itself only when it can be',async()=>{
  let kept,sentNote=null,connected=false,busy='',visible=true;const sent=[],map={drive:'left',turn:'right'};
  const o={box:{innerHTML:'',addEventListener(){},querySelector(){return null;}},T,chassis:()=>({...KINDS.swerve,...common}),map:()=>T.mapOf(map),setMap:(k,v)=>{map[k]=v;},swerve:()=>true,mechs:()=>MECHS,
    store:{get:()=>kept,set:v=>{kept=v;}},sent:{get:()=>sentNote,set:v=>{sentNote=v;}},send:async t=>{sent.push(t);return 'ok';},connected:()=>connected,busy:()=>busy,visible:()=>visible,saveFile:async()=>null,copy:async()=>{},values:()=>null};
  // What is kept is only what the lists allow.
  assert.deepEqual(R.clean({pad:'gamepad9',auto:0,mechs:{a:{mode:'fly',a:'nose',b:'none',power:'x',posA:.25}}},T),{pad:'gamepad1',auto:true,mechs:{a:{b:'none',posA:.25}}});assert.equal(R.clean({auto:false},T).auto,false);
  const b=R.build(o);assert.equal(b.tele.file,'TorqueTeleOp.java');assert.equal(b.list.length,MECHS.length);assert.match(b.tele.source,/intake1Rollers\.setPower\(gamepad1\./);
  kept={pad:'gamepad2',auto:true,mechs:{'kin:lift':{mode:'off'}}};const b2=R.build(o);assert.match(b2.tele.source,/intake1Rollers\.setPower\(gamepad2\./);assert.doesNotMatch(b2.tele.source,/DcMotor lift/);
  // No chassis to write for: it says so rather than writing half a TeleOp.
  assert.match(R.build({...o,chassis:()=>null}).tele.error,/no chassis/);
  const ui=R.create(o),wait=ms=>new Promise(r=>setTimeout(r,ms));
  ui.refresh();assert.match(o.box.innerHTML,/No robot connected: plug in the Control Hub and it is sent by itself/);await wait(1700);assert.equal(sent.length,0,'no robot: nothing is sent');
  connected=true;busy='A check or a tune is running in Mechanisms.';ui.refresh();assert.match(o.box.innerHTML,/A check or a tune is running in Mechanisms\. It is sent when that is done/);await wait(1700);assert.equal(sent.length,0,'the robot is in use: it waits');
  busy='';visible=false;ui.refresh();await wait(1700);assert.equal(sent.length,0,'the TeleOp tab is not showing: it waits');
  visible=true;ui.refresh();await wait(1800);assert.equal(sent.length,1,'then it goes by itself');assert.equal(sent[0].file,'TorqueTeleOp.java');assert.match(o.box.innerHTML,/On the robot as “Torque TeleOp”/);
  ui.refresh();await wait(1700);assert.equal(sent.length,1,'what is on the robot already is not sent again');
  map.spin='bumpers';ui.refresh();assert.match(o.box.innerHTML,/Changed since it was last sent/);await wait(1800);assert.equal(sent.length,2,'a change goes by itself too');assert.match(sent[1].source,/double spin = /);
  kept={...kept,auto:false};map.lock='x';ui.refresh();await wait(1700);assert.equal(sent.length,2,'not when the team turned that off');
});

test('the TeleOp’s choices are kept with the calibration',()=>{
  const c=TU.sanitize({mechs:{},teleop:{pad:'gamepad2',auto:false,mechs:{x:{mode:'hold',a:'y'}}},junk:1});assert.deepEqual(c.teleop,{pad:'gamepad2',auto:false,mechs:{x:{mode:'hold',a:'y'}}});assert.equal(c.junk,undefined);assert.equal(TU.sanitize({teleop:[1]}).teleop,undefined);
});

test('the whole robot’s TeleOp compiles for every chassis, mapping and controller',t=>{
  const root=path.join(__dirname,'..'),javac=path.join(root,'sim-runtime/java/bin',process.platform==='win32'?'javac.exe':'javac'),stubs=path.join(root,'tools/simulation/java');
  if(!fs.existsSync(javac)||!fs.existsSync(stubs))return t.skip('the simulator’s JDK is not built here');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'torque-teleop-'));let k=0;
  try{for(const [name,base] of Object.entries(KINDS))for(const map of [{},{turn:'bumpers',spin:'triggers',lock:'a'},{drive:'right',turn:'left',spin:'dpad',lock:'left_stick_button',slow:'none',reset:'none',field:'no'}])for(const pad of ['gamepad1','gamepad2']){
      const raw={'shooter:0:hood':{mode:'positions'},'shooter:0:flywheel':{mode:'toggle',b:'back'}},m=T.mechMap(MECHS,raw,{pad,map,swerve:name==='swerve'}),list=MECHS.map(x=>({...x,...m[x.id]}));assert.deepEqual(T.clashes(list,{pad,map,swerve:name==='swerve'}),[]);
      const tele=T.teleopOf({...base,...common,map,className:T.FULL_NAME,opMode:T.FULL_OP_MODE,mechanisms:list,pad}),d=path.join(dir,String(k++));fs.mkdirSync(d);fs.writeFileSync(path.join(d,tele.file),tele.source);
      try{execFileSync(javac,['-nowarn','-proc:none','-sourcepath',stubs,'-d',path.join(d,'out'),path.join(d,tele.file)],{stdio:'pipe'});}catch(e){assert.fail(`${name} with ${JSON.stringify(map)} on ${pad} does not compile: ${String(e.stderr||e.message).slice(0,500)}`);}}
    assert.equal(k,18);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
