'use strict';
// Calibrate → TeleOp (ui/sim-teleop-tab.js, the Java written by ui/sim-chassis-teleop.js): the chassis on the sticks the
// team picked, a swerve's pods taking the shortest way (turning, or staying and running their motors backwards), a
// mecanum moving any way, spin buttons and a wheel lock, each mechanism from Setup on buttons nothing else has, the file
// sent to the robot by itself when it changes, and everything Calibrate measured as one class that builds in OnBot Java. Where the simulator's JDK and FTC stand-ins are built,
// every kind of chassis is compiled with its mechanisms on either controller.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const T=require('../ui/sim-chassis-teleop.js'),R=require('../ui/sim-teleop-tab.js'),A=require('../ui/sim-auto-tab.js'),TU=require('../ui/sim-tune.js'),K=require('../ui/sim-chassis-cal.js'),C=require('../ui/sim-config.js');
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
  // On a second controller they have every button. The controls go round by how much each kind is used, whatever order
  // Setup lists them in: the intake on the triggers, the lift on the D-pad, the claw on a bumper, then what shoots and feeds.
  const second=T.mechMap(MECHS,{},{pad:'gamepad2'}),ctl=m=>Object.fromEntries(Object.entries(m).map(([k,x])=>[k.split(':').pop(),[x.a,x.b].filter(c=>c!=='none').join('/')]));
  assert.deepEqual(ctl(second),{roller:'right_trigger/left_trigger',flywheel:'left_bumper',lift:'dpad_up/dpad_down',claw:'right_bumper',feeder:'a',hood:'b'});assert.deepEqual(ctl(T.mechMap([...MECHS].reverse(),{},{pad:'gamepad2'})),ctl(second));
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
  // Until the team picks, the mechanisms share the driving's controller while they fit and start on a second one when they do not.
  kept=undefined;assert.equal(R.build(o).state.pad,'gamepad1');const crowd=Array.from({length:16},(_,i)=>({id:'c'+i,label:'C'+i,device:'c'+i,kind:'crservo',type:'spinner'}));
  assert.equal(R.build({...o,mechs:()=>crowd}).state.pad,'gamepad2');assert.ok(!R.build({...o,mechs:()=>crowd}).list.some(x=>x.full));kept={pad:'gamepad1'};assert.equal(R.build({...o,mechs:()=>crowd}).state.pad,'gamepad1','picked: it stays');kept={pad:'gamepad2',auto:true,mechs:{'kin:lift':{mode:'off'}}};
  // No chassis to write for: it says so rather than writing half a TeleOp.
  assert.match(R.build({...o,chassis:()=>null}).tele.error,/no chassis/);
  const ui=R.create(o),wait=ms=>new Promise(r=>setTimeout(r,ms));
  // The page opens on Driving, with the list beside it: the status of the send is on its tile, its words on its own page.
  ui.refresh();assert.match(o.box.innerHTML,/data-rt-view="drive" aria-pressed="true"/);assert.match(o.box.innerHTML,/<b>Send to robot<\/b><small>No robot connected<\/small>/);assert.doesNotMatch(o.box.innerHTML,/data-rt="send"/,'one thing at a time');
  ui.show('send');assert.match(o.box.innerHTML,/No robot connected: plug in the Control Hub and it is sent by itself/);await wait(1700);assert.equal(sent.length,0,'no robot: nothing is sent');
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

test('every wheeled chassis has its own arithmetic, the same in the picture and in the Java',t=>{
  const four=KINDS.mecanum.motors,three=[{key:'front',name:'f'},{key:'backLeft',name:'bl'},{key:'backRight',name:'br',reversed:true}],go=(kind,motors,pad)=>T.wheelPowers(motors,T.command({field:'no'},pad),kind).map(v=>+v.toFixed(2));
  // A kiwi: driving ahead the front wheel only rolls sideways and the back two push; sideways the front one leads; turning, all three run the same way.
  assert.deepEqual(go('kiwi',three,{ly:-1}),[0,-.87,.87]);assert.deepEqual(go('kiwi',three,{lx:-1}),[1,-.5,-.5]);assert.deepEqual(go('kiwi',three,{rx:-1}),[1,1,1]);assert.equal(Math.max(...go('kiwi',three,{ly:-1,rx:-1}).map(Math.abs)),1,'scaled together, never past full power');
  // An X-drive and a butterfly move any way, as a mecanum does; a tank of two motors or four does not strafe.
  for(const kind of ['xdrive','butterfly']){assert.deepEqual(go(kind,four,{lx:-1}),[-1,1,1,-1]);assert.deepEqual(go(kind,four,{lx:1,ly:-1}),[1,0,0,1]);}
  assert.deepEqual(go('tank',KINDS.tank.motors,{ly:-1,lx:1}),[1,1]);assert.deepEqual(go('tank',four,{rx:-1}),[-1,1,-1,1]);
  const src=kind=>T.teleopOf({kind,motors:kind==='kiwi'?three:four,...common}).source;
  assert.match(src('kiwi'),/double\[\] power = \{left \+ turn, -0\.866025 \* forward - 0\.5 \* left \+ turn, 0\.866025 \* forward - 0\.5 \* left \+ turn\};/);assert.match(src('kiwi'),/A kiwi drive/);assert.match(src('xdrive'),/An X-drive/);assert.match(src('butterfly'),/butterfly/);
  assert.match(src('xdrive'),/double\[\] power = \{forward - left - turn, forward \+ left \+ turn, forward \+ left - turn, forward - left \+ turn\};/);
  // The picture has a wheel for each motor: a kiwi's three round the robot, an X-drive's four turned 45°.
  assert.equal(R.chassisArt({kind:'kiwi',motors:three}).split('data-rt-arrow=').length-1,3);assert.match(R.chassisArt({kind:'kiwi',motors:three}),/rotate\(-90\)/);assert.equal(R.chassisArt({kind:'xdrive',motors:four}).split('rotate(45)').length-1,2);assert.doesNotMatch(R.chassisArt({kind:'xdrive',motors:four}),/rt-roller/);
  const root=path.join(__dirname,'..'),javac=path.join(root,'sim-runtime/java/bin',process.platform==='win32'?'javac.exe':'javac'),stubs=path.join(root,'tools/simulation/java');if(!fs.existsSync(javac)||!fs.existsSync(stubs))return t.diagnostic('the simulator’s JDK is not built here: not compiled');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'torque-kinds-'));
  try{for(const kind of ['mecanum','xdrive','butterfly','kiwi','tank']){const tele=T.teleopOf({kind,motors:kind==='kiwi'?three:four,...common,map:{spin:'bumpers',turn:'triggers'}}),d=path.join(dir,kind);fs.mkdirSync(d);fs.writeFileSync(path.join(d,tele.file),tele.source);
      try{execFileSync(javac,['-nowarn','-proc:none','-sourcepath',stubs,'-d',path.join(d,'out'),path.join(d,tele.file)],{stdio:'pipe'});}catch(e){assert.fail(`${kind} does not compile: ${String(e.stderr||e.message).slice(0,500)}`);}}}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});

const WHOLE=[{id:'lift',label:'Lift',device:'lift',kind:'motor',type:'lift',template:'T1',states:['down','up']},{id:'tur',label:'Turret',device:'tur',kind:'motor',type:'turret',template:'T2',states:['front','left','right']},
  {id:'kick',label:'Kicker',device:'kick',kind:'servo',type:'kicker',states:['back','out'],posA:.1,posB:.6},{id:'mini',label:'Mini turret',device:'mini',kind:'servo',type:'mini-turret',states:['front','left','right'],posA:.5,posB:.2},
  {id:'claw',label:'Claw',device:'claw',kind:'servo',type:'claw',states:['open','closed'],posA:.2,posB:.8},{id:'arm',label:'Arm',device:'arm',kind:'motor',type:'arm',template:'T2',states:['down','up']}];

test('a mechanism can be on any part of the controller: a button, a trigger, a stick, in its own words',t=>{
  const raw={arm:{mode:'axis'},claw:{mode:'follow',a:'right_trigger'}},m=T.mechMap(WHOLE,raw,{pad:'gamepad1',map:{},swerve:true}),list=WHOLE.map(x=>({...x,...m[x.id]}));
  // How each starts comes from what it is: a lift on up and down, a turret on left and right, a kicker over while held, three positions on three buttons.
  assert.deepEqual([m.lift.mode,m.lift.a,m.lift.b],['updown','dpad_up','dpad_down']);assert.deepEqual([m.tur.mode,m.tur.a,m.tur.b],['updown','dpad_left','dpad_right']);assert.equal(m.kick.mode,'momentary');
  assert.equal(m.mini.mode,'positions');assert.ok(![m.mini.a,m.mini.b,m.mini.c].includes('none'),'a button for each of its three positions');assert.equal(new Set([m.mini.a,m.mini.b,m.mini.c]).size,3);
  // Its controls are named by its own positions.
  assert.deepEqual(T.usesOf('updown',['down','up']),['Up','Down',null]);assert.deepEqual(T.usesOf('updown',['front','left','right']),['Left','Right',null]);assert.deepEqual(T.usesOf('positions',['front','left','right']),['Front','Left','Right']);assert.deepEqual(T.usesOf('flip',['open','closed']),['Flips open and closed',null,null]);assert.equal(T.usesOf('positions',[])[2],null);
  assert.equal(R.says(T,list[0]),'Up: D-pad up · down: D-pad down');assert.equal(R.says(T,list[2]),`Out while ${T.BUTTONS[m.kick.a]} is held`);assert.equal(R.says(T,list[5]),'Follows right stick, up and down');
  // A stick the chassis does not drive or turn with is free for a mechanism; one it does use is not offered.
  assert.equal(m.arm.a,'right_stick_y','the driving has the left stick and the right stick’s left and right');assert.equal(m.claw.a,'right_trigger');
  assert.deepEqual(T.chassisParts({},true).slice(0,3),['left_stick_x','left_stick_y','right_stick_x']);assert.equal(T.mechMap([WHOLE[5]],{arm:{mode:'axis',a:'left_stick_y'}},{pad:'gamepad1',map:{}}).arm.a,'right_stick_y','a stick the chassis has is not taken');
  assert.equal(T.mechMap([WHOLE[5]],{arm:{mode:'axis',a:'left_stick_y'}},{pad:'gamepad2'}).arm.a,'left_stick_y','a second controller has both sticks');
  // Both triggers as one control take both: nothing else gets either.
  const trig=T.mechMap(WHOLE,{arm:{mode:'axis',a:'triggers'}},{pad:'gamepad2'});assert.equal(trig.arm.a,'triggers');for(const [id,x] of Object.entries(trig))if(id!=='arm')for(const k of ['a','b','c'])assert.ok(!/_trigger$/.test(x[k]),`${id} is not on a trigger`);
  assert.deepEqual(T.clashes(list,{pad:'gamepad1',map:{}}),[]);
  assert.deepEqual(T.clashes([{label:'A',kind:'motor',mode:'axis',a:'left_stick_y'}],{pad:'gamepad1',map:{}}),[{button:'left_stick_y',name:'Left stick, up and down',uses:['the chassis','A']}]);
  assert.equal(T.clashes([{label:'A',kind:'motor',mode:'axis',a:'triggers'},{label:'B',kind:'servo',mode:'flip',a:'left_trigger'}],{pad:'gamepad2'})[0].button,'left_trigger');
  // The Java: a stick as a number (up is positive), a trigger from 0 to 1, a servo over while held, three positions.
  const code=T.mechCode(list),loop=code.loop.join('\n');
  assert.match(loop,/double armGo = -gamepad1\.right_stick_y;\n\s+arm\.setPower\(Math\.abs\(armGo\) < 0\.05 \? 0 : armGo \* 1\.0\);/);assert.match(loop,/claw\.setPosition\(0\.2 \+ \(0\.8 - 0\.2\) \* Math\.max\(0, Math\.min\(1, gamepad1\.right_trigger\)\)\);/);
  assert.match(loop,/kicker\.setPosition\(gamepad1\.\w+(?: > 0\.5)? \? 0\.6 : 0\.1\);/);assert.match(loop,/if \(gamepad1\.\w+\) miniTurret\.setPosition\(0\.5\); else if \(gamepad1\.\w+\) miniTurret\.setPosition\(0\.2\); else if \(gamepad1\.\w+\) miniTurret\.setPosition\(0\.35\);/);
  assert.match(code.init.join('\n'),/\/\/ Turret: D-pad left moves it left, D-pad right right; it brakes when let go\./);assert.match(code.init.join('\n'),/arm\.setZeroPowerBehavior\(DcMotor\.ZeroPowerBehavior\.BRAKE\);/);
  // The same steps in the page's meter: what the controller is telling it right now.
  const step=(x,pads)=>{const st={};let r;for(const p of pads)r=T.mechStep(x,st,p);return r;};
  assert.deepEqual(step(list[0],[{dpad_up:true}]),{power:1});assert.deepEqual(step(list[0],[{dpad_down:true}]),{power:-1});assert.deepEqual(step(list[0],[{}]),{power:0});
  assert.equal(step(list[5],[{ry:-.5}]).power,.5,'a stick pushed up is positive');assert.equal(step(list[5],[{ry:.02}]).power,0);
  assert.deepEqual(step(list[2],[{[m.kick.a]:true,lt:1,rt:1}]),{position:.6,at:1});assert.deepEqual(step(list[2],[{}]),{position:.1,at:0});
  assert.deepEqual(step(list[3],[{}]),{position:null,at:null},'a servo is not moved until its control is used');assert.deepEqual(step(list[3],[{[m.mini.c]:true}]),{position:.35,at:2});
  assert.ok(Math.abs(step(list[4],[{rt:.5}]).position-.5)<1e-9);
  const flip={...WHOLE[4],...T.mechMap([WHOLE[4]],{},{pad:'gamepad2'}).claw};assert.deepEqual(step(flip,[{[flip.a]:true,rt:1},{},{[flip.a]:true,rt:1}]),{position:.2,at:0},'pressed twice, it is back where it started');
  const root=path.join(__dirname,'..'),javac=path.join(root,'sim-runtime/java/bin',process.platform==='win32'?'javac.exe':'javac'),stubs=path.join(root,'tools/simulation/java');if(!fs.existsSync(javac)||!fs.existsSync(stubs))return t.diagnostic('the simulator’s JDK is not built here: not compiled');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'torque-whole-'));
  try{let k=0;for(const pad of ['gamepad1','gamepad2'])for(const pick of [raw,{arm:{mode:'axis',a:'triggers'},claw:{mode:'momentary'},kick:{mode:'follow',a:'right_stick_y'},mini:{mode:'flip'},lift:{mode:'toggle'},tur:{mode:'hold'}}]){
      const mm=T.mechMap(WHOLE,pick,{pad,map:{},swerve:false}),tele=T.teleopOf({...KINDS.mecanum,...common,className:T.FULL_NAME,opMode:T.FULL_OP_MODE,mechanisms:WHOLE.map(x=>({...x,...mm[x.id]})),pad}),d=path.join(dir,String(k++));fs.mkdirSync(d);fs.writeFileSync(path.join(d,tele.file),tele.source);
      try{execFileSync(javac,['-nowarn','-proc:none','-sourcepath',stubs,'-d',path.join(d,'out'),path.join(d,tele.file)],{stdio:'pipe'});}catch(e){assert.fail(`mechanisms on ${pad} do not compile: ${String(e.stderr||e.message).slice(0,500)}`);}}}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('the TeleOp tab is a list with one thing showing at a time: driving, a mechanism, sending, the calibration code',()=>{
  let kept;const map={};
  const o={box:{innerHTML:'',addEventListener(){},querySelector(){return null;}},T,chassis:()=>({...KINDS.mecanum,...common}),map:()=>T.mapOf(map),setMap:(k,v)=>{map[k]=v;},swerve:()=>false,mechs:()=>WHOLE,
    store:{get:()=>kept,set:v=>{kept=v;}},sent:{get:()=>null,set(){}},send:async()=>'ok',connected:()=>false,busy:()=>'',visible:()=>false,saveFile:async()=>null,copy:async()=>{},values:()=>({java:'public final class TorqueCalibration {}',json:'{}',jsonName:'x.json'})};
  const ui=R.create(o),html=()=>o.box.innerHTML,count=re=>(html().match(re)||[]).length;ui.refresh();
  // The list: Driving, every mechanism, Send to robot, Calibration code.
  assert.equal(count(/data-rt-view="/g),1+WHOLE.length+2);assert.match(html(),/<b>Driving<\/b><small>Mecanum · left stick drives<\/small>/);assert.match(html(),/<b>Lift<\/b><small>Up: D-pad up · down: D-pad down<\/small>/);
  assert.equal(count(/<section class="cal-card rt-card">/g),1,'one page at a time');assert.match(html(),/<h2>Driving<\/h2>/);assert.match(html(),/What the controller does/);assert.doesNotMatch(html(),/Lock the wheels/,'only a swerve locks its wheels');
  // A mechanism's page: what it does, its controls by its own words, any stick or trigger, and a meter.
  ui.show('mech:tur');assert.match(html(),/<h2>Turret<\/h2>/);assert.match(html(),/<label for="rt-a">Left<\/label>/);assert.match(html(),/<label for="rt-b">Right<\/label>/);assert.match(html(),/data-rt-meter/);assert.doesNotMatch(html(),/What the controller does/);
  assert.doesNotMatch(html().split('id="rt-a"')[1].split('</select>')[0],/value="right_bumper"/,'a button the chassis has is not offered');
  kept={mechs:{arm:{mode:'axis'}}};ui.show('mech:arm');assert.match(html(),/<label for="rt-a">Follows<\/label>/);assert.match(html(),/<option value="right_stick_y" selected>Right stick, up and down<\/option>/);assert.match(html(),/<option value="triggers">Both triggers/);assert.doesNotMatch(html().split('id="rt-a"')[1].split('</select>')[0],/value="left_stick_y"/);
  ui.show('mech:mini');assert.match(html(),/<label for="rt-c">Right<\/label>/);assert.match(html(),/Front \(0 to 1\)/);assert.match(html(),/Right \(0 to 1\)/);
  // Sending and the calibration code each have their own page.
  ui.show('send');assert.match(html(),/<h2>Send to robot<\/h2>/);assert.match(html(),/data-rt="send"/);assert.match(html(),/See the code/);ui.show('code');assert.match(html(),/<h2>Calibration code<\/h2>/);assert.match(html(),/Put it on the robot \(OnBot Java\)/);
  // With no mechanisms in Setup the list says so, and where to add them.
  const none=R.create({...o,box:{innerHTML:'',addEventListener(){},querySelector(){return null;}},mechs:()=>[]});none.refresh();none.show('nomech');
});

test('Autonomous sends what Simulate has, under the name the team gives it',async()=>{
  assert.equal(A.cleanName('  Red "left"\n side \\ 2  '),'Red left side 2');assert.equal(A.cleanName('x'.repeat(90)).length,60);assert.equal(A.defaultName({name:'Qualifier'}),'Qualifier (Deck)');assert.equal(A.facts({paths:3,actions:1,seconds:12.34}),'3 paths · 1 action · about 12.3 s');assert.equal(A.facts({paths:1,actions:0,seconds:null}),'1 path');
  let name='',route={name:'Qualifier',paths:3,actions:2,seconds:14.2,stamp:1,problem:'',report:null},why='',sentNote=null,connected=true,made=0;const sent=[];
  const box={innerHTML:'',addEventListener(){},querySelector(){return null;}},wait=()=>new Promise(r=>setTimeout(r,20));
  const ui=A.create({box,route:()=>route,supported:()=>why,name:{get:()=>name,set:v=>{name=v;}},code:async()=>{made++;return {files:{'a/QualifierAuto.java':'x'},name:'QualifierAuto.java',source:`@Autonomous(name = "${name||'Qualifier (Deck)'}")`,opMode:name||'Qualifier (Deck)'};},
    send:async out=>{sent.push(out);return 'Built.';},sent:{get:()=>sentNote,set:v=>{sentNote=v;}},connected:()=>connected,busy:()=>'',toRun(){},saveFile:async()=>null,copy:async()=>{}});
  ui.refresh();await wait();
  assert.match(box.innerHTML,/<b>Qualifier<\/b><span>3 paths · 2 actions · about 14\.2 s<\/span>/);assert.match(box.innerHTML,/Not run in Run &amp; review yet/);assert.match(box.innerHTML,/Shows on the Driver Station as “Qualifier \(Deck\)”/);assert.match(box.innerHTML,/Not on the robot yet\./);
  assert.match(box.innerHTML,/<dialog class="at-name"/,'Send to robot asks for the name in a pop-up');assert.match(box.innerHTML,/data-at="send">Send to robot/);assert.equal(ui.name(),'Qualifier (Deck)');
  // The same route is not written again; a changed one, or a new name, is.
  ui.refresh();await wait();assert.equal(made,1);route={...route,stamp:2,report:{title:'Finished in 13.9 s',level:'ok'}};ui.refresh();await wait();assert.equal(made,2);assert.match(box.innerHTML,/class="at-run ok">Run &amp; review: Finished in 13\.9 s/);
  name='Red left';ui.refresh();await wait();assert.equal(made,3);assert.match(box.innerHTML,/Shows on the Driver Station as “Red left”/);assert.match(box.innerHTML,/@Autonomous\(name = &quot;Red left&quot;\)/);
  // A route that cannot be sent, or a robot Torque writes no autonomous for, says why and sends nothing.
  route={...route,problem:'Add a path first: click the field in Path planning.'};ui.refresh();assert.match(box.innerHTML,/Add a path first/);assert.match(box.innerHTML,/data-at="send" disabled/);
  route={...route,problem:''};why='Autonomous on a Control Hub is exported for mecanum and tank drivetrains.';ui.refresh();assert.match(box.innerHTML,/exported for mecanum and tank drivetrains/);assert.match(box.innerHTML,/data-at="send" disabled/);assert.equal(sent.length,0);
});

test('the name goes into the autonomous the Driver Station lists',()=>{
  const P=require('../ui/sim-planner.js'),X=require('../ui/sim-export.js'),F=require('../ui/sim-ftc.js');
  const start={x:24,y:24,heading:0},layout={name:'Hub',field:'empty',width:144,height:144,start,zones:[]},route=P.plan({start,zones:[],pins:[{x:90,y:24}],style:'sharp',clearance:1},{front:8,rear:8,half:8}),robot={...C.robot({},'ftc'),length:16,width:16},routeJava=X.java(route,layout,{polygon:P.polygon});
  const plain=F.onBotJava({route,layout,tuning:{},robot,localization:'encoders',routeJava}),named=F.onBotJava({route,layout,tuning:{},robot,localization:'encoders',routeJava,autoName:'Red left "2"\n'});
  assert.match(plain.source,/@Autonomous\(name = "Hub \(Deck\)", group = "Torque"\)/);assert.match(named.source,/@Autonomous\(name = "Red left 2", group = "Torque"\)/);assert.match(named.check.source,/@TeleOp\(name = "Hub check \(Deck\)"/,'its check TeleOp keeps the route’s name');
  assert.equal(named.name,plain.name,'the file keeps its name: only what the Driver Station shows changes');
  // A swerve has no Control Hub autonomous yet, and says so.
  assert.throws(()=>F.hardware({...robot,drivetrain:'kiwiSwerve'},'encoders'),/mecanum and tank drivetrains/);
});

test('how a robot can follow its route comes from what Calibrate checked, never from Debug',()=>{
  const L=require('../ui/sim-links.js'),drive=['frontLeft','frontRight','backLeft','backRight'].map(k=>({key:k,name:k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())}));
  const link=(n,state,more={})=>({id:n,causes:[{name:n,kind:'motor',dir:1}],effect:{key:`m:${n}:pos`,dir:1},result:{state,at:'t'},...more});
  // Nothing checked: every choice stays open, and says where to check it.
  assert.deepEqual(L.sensingOf({},drive),{encoders:undefined,fused:undefined,wheels:false,noPinpoint:false});assert.deepEqual(L.sensingOf(null,[]),{encoders:undefined,fused:undefined,wheels:false,noPinpoint:false});
  // Electronics moved every drive motor and saw its encoder count: encoders can be used. One still only planned is not checked yet.
  const all=drive.map(d=>link(d.name,'pass'));assert.equal(L.sensingOf({links:all},drive).encoders,true);assert.equal(L.sensingOf({links:[...all.slice(0,3),link('back_right','pass',{planned:true})]},drive).encoders,undefined);
  assert.equal(L.sensingOf({links:[...all.slice(0,3),link('back_right','backwards')]},drive).encoders,true,'an encoder that counts the other way still counts');
  // A motor that moved with nothing counting rules encoders out: by its link, or as Electronics noted it.
  assert.equal(L.sensingOf({links:[...all.slice(0,3),link('back_right','none')]},drive).encoders,false);assert.equal(L.sensingOf({links:all.slice(0,3),electronics:{none:['back_right']}},drive).encoders,false);assert.equal(L.sensingOf({links:all.slice(0,3),electronics:{spins:['back_right']}},drive).encoders,false);
  assert.equal(L.sensingOf({links:[...all.slice(0,3),{...link('back_right','none'),result:{state:'none',unread:true}}]},drive).encoders,undefined,'no reading at all is not a check');
  // A Pinpoint: seen answering when its pods were rolled; ruled out when the robot's configuration has none, or it did not answer.
  assert.equal(L.sensingOf({electronics:{moved:{pinpoint:{ok:true}}}},drive).fused,true);assert.equal(L.sensingOf({electronics:{moved:{pinpoint:{ok:false}}}},drive).fused,false);
  assert.deepEqual([L.sensingOf({hub:{readout:[{name:'imu',kind:'imu'}]}},drive).fused,L.sensingOf({hub:{readout:[{name:'imu',kind:'imu'}]}},drive).noPinpoint],[false,true]);
  assert.equal(L.sensingOf({hub:{readout:[{name:'odo',kind:'pinpoint'}]},electronics:{moved:{odo:{ok:true}}}},drive,'pinpoint').fused,true,'by the robot’s own name for it');assert.equal(L.sensingOf({hub:{readout:[{name:'odo',kind:'pinpoint'}]}},drive).fused,undefined);
  // Mechanisms: every wheel seen to roll forward.
  assert.equal(L.sensingOf({chassis:{pods:Object.fromEntries(drive.map(d=>[d.key,{drive:true}]))}},drive).wheels,true);assert.equal(L.sensingOf({chassis:{pods:{frontLeft:{drive:true}}}},drive).wheels,false);
  // Nothing in the app's pages reads Debug's findings to decide this any more.
  const page=fs.readFileSync(path.join(__dirname,'../ui/simulation.js'),'utf8');assert.doesNotMatch(page,/liveDebug\?\.sensing|Debug saw|Debug found (?:the|no)|Debug ruled|seen in Debug/);assert.match(page,/Not checked yet: move each drive motor in Calibrate → Electronics\./);
});

test('a chassis is good to use once its wheels are checked: measuring distance and the field map are extras',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../ui/sim-chassis-cal.js'),'utf8');
  assert.match(src,/\['roll',!!r\.roll\?\.ok,true\]/);assert.match(src,/\['field',!!r\.placed,true\]/);assert.match(src,/ok\?'pass':extra\?'optional':'todo';if\(!ok&&!extra\)\{open=false;/,'an extra not done holds nothing up');
  assert.match(src,/s\.filter\(x=>!x\.extra\)\.every\(x=>x\.state==='pass'\)\?`<span class="rs-pill ok">\$\{s\.every\(x=>x\.state==='pass'\)\?'Calibrated':'Good to use'\}<\/span>`/);
  assert.match(fs.readFileSync(path.join(__dirname,'../ui/simulation.js'),'utf8'),/counts:st!=='info'&&st!=='optional'/,'an extra is not counted as left to do');
});
