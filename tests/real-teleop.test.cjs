'use strict';
// Calibrate → Real run's TeleOp for the whole robot (ui/real-teleop.js, written by ui/sim-chassis-teleop.js): the chassis
// on the sticks the team picked, with spin buttons and a wheel lock, each mechanism from Setup on buttons nothing else
// has, and the file sent to the robot by itself when it changes. Where the simulator's JDK and FTC stand-ins are built,
// every kind of chassis is compiled with its mechanisms on either controller.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const T=require('../ui/sim-chassis-teleop.js'),R=require('../ui/real-teleop.js'),TU=require('../ui/sim-tune.js');
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

test('Real run writes the TeleOp from the choices kept, and sends it by itself only when it can',async()=>{
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
  busy='';visible=false;ui.refresh();await wait(1700);assert.equal(sent.length,0,'Real run is not showing: it waits');
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
