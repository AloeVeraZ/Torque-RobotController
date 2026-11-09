'use strict';
// Route actions that move the robot's own parts ("Arm up", "Lift up") and the wiring-driven export: the same route in the
// simulator and as exported OnBot Java on the virtual Control Hub moves each part the same way, and waits at a pin until
// it is there (an Axon's feedback wire for the arm, RUN_TO_POSITION for the lift). Also the generated code itself: the
// hood servo, a ramp closed on its sensor, bulk caching, the robot's configuration and old RobotActions stubs.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const F=require('../ui/sim-ftc.js'),C=require('../ui/sim-config.js'),M=require('../ui/sim-mechanisms.js'),K=require('../ui/sim-kinematics.js');
const root=path.resolve(__dirname,'..'),fixture=path.join(__dirname,'fixtures/route-parts.json'),setup=JSON.parse(fs.readFileSync(fixture,'utf8'));
const built=fs.existsSync(path.join(root,'sim-runtime/driver/classes/deck/sim/hub/SimAnalog.class')),skip=built?false:'run node tools/simulation/build.cjs first';
const kin=K.sanitize(setup.kinematics),robot=C.robot(setup.robot,'ftc');

function run(code){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'deck-route-parts-')),frames=path.join(dir,'frames.json');
  const r=spawnSync(process.execPath,[path.join(root,'tools/deck-sim.cjs'),'test',fixture,'--frames',frames,...(code?['--code',code]:[])],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',timeout:300000});
  assert.equal(r.status,0,r.stderr||r.stdout);const d=JSON.parse(fs.readFileSync(frames,'utf8'));fs.rmSync(dir,{recursive:true,force:true});return {out:r.stdout,frames:Array.isArray(d)?d:d.frames};}
const seconds=out=>+/3 pins in ([\d.]+) s/.exec(out)[1];

test('"Arm up", "Lift up" and "Arm down" move the parts the same in the simulator and in the exported code on the virtual hub',{skip,timeout:600000},()=>{
  const sim=run(null),hub=run('onbot');
  for(const [name,r] of [['simulator',sim],['virtual hub',hub]]){const end=r.frames.at(-1).joints,top=Math.max(...r.frames.map(f=>f.joints.arm));
    assert.ok(top>=89&&top<=90.01,`${name}: the arm reaches up (${top}°)`);assert.ok(Math.abs(end.lift-12)<.05,`${name}: the lift ends up (${end.lift} in)`);assert.ok(Math.abs(end.arm)<.5,`${name}: the arm ends down`);
    // The robot leaves the first pin only once the arm is up: it waits for the part, not a set time.
    const left=r.frames.find(f=>f.truth.x>49.5);assert.ok(left&&left.joints.arm>=87,`${name}: left pin 1 with the arm at ${left?.joints.arm}°`);}
  assert.ok(Math.abs(seconds(hub.out)-seconds(sim.out))<.75,`${seconds(sim.out)} s simulated, ${seconds(hub.out)} s on the virtual hub`);
});

test('Parts.java: each part on its motor or servo, closed on its sensor, and the route actions that call it',()=>{
  const ex=F.exportParts({robot,localization:'fused',mechanisms:null,kinematics:kin}),src=F.partsSource({packageName:'p',layoutName:'Parts route'},ex.parts.list,ex.sensorSpecs);
  assert.deepEqual(ex.parts.list.map(p=>[p.method,p.device,p.name]),[['armServo','servo','armServo'],['liftMotor','motor','liftMotor']]);
  assert.match(src,/public static final String PART_ARM_SERVO_SENSOR = "armAngle";/);assert.match(src,/Math\.abs\(armServoMeasured\(\) - armServoTarget\) <= TOLERANCE_DEGREES/);
  assert.match(src,/liftMotor\.setMode\(DcMotor\.RunMode\.STOP_AND_RESET_ENCODER\);/,'the CAD pose is the encoder zero');assert.match(src,/!liftMotor\.isBusy\(\)/);
  // The lift's second motor (mirrored) runs to the same target, and the home switch re-zeroes the encoders when sent home.
  assert.match(src,/liftMotor2 = map\.tryGet\(DcMotorEx\.class, PART_LIFT_MOTOR_2\);/);assert.match(src,/liftMotor2\.setTargetPosition\(\(int\) Math\.round\(value \* PART_LIFT_MOTOR_COUNTS_PER_UNIT\)\);/);
  assert.match(src,/public boolean liftMotorAtHome\(\) \{\n\s+return liftMotorHome\.isPressed\(\);/);assert.match(src,/if \(liftMotorAtHome\(\) && Math\.abs\(liftMotorTarget - PART_LIFT_MOTOR_HOME\) < 1e-6/);
  const H=require('../ui/sim-hardware.js'),rows=H.rows({robot,kinematics:kin,sensors:{localization:'fused'}});assert.deepEqual(rows.filter(r=>/^kin\./.test(r.key)).map(r=>[r.key,r.name]),[['kin.armServo','armServo'],['kin.liftMotor','liftMotor'],['kin.liftMotor-2','liftMotor2']],'the second motor is in the configuration');
  assert.equal(F.mechanismAction('Arm up',null,ex.parts),'if (step.first) parts.armServo(90.0);\n        return step.moving || parts.armServoDone();');
  assert.equal(F.mechanismAction('Lift to 5',null,ex.parts),'if (step.first) parts.liftMotor(5.0);\n        return step.moving || parts.liftMotorDone();');
  assert.equal(F.mechanismAction('Claw open',null,ex.parts),'','a name no part has stays the team\'s to write');
});

test('the Test setup export: hood servo, ramp closed on its Axon, bulk caching, the configuration from the wiring',()=>{
  const s=require('../examples/test-setup.json'),r=C.robot(s.robot,'ftc'),m=M.sanitize(s.mechanisms),k=K.sanitize(s.kinematics);
  const hood=F.mechanismDevices(m,r,k).find(x=>x.role==='hood');assert.deepEqual([hood.name,hood.rest],['hood',.5]);assert.ok(hood.shoot>hood.rest,'Spin up tilts the hood from where the CAD has it');
  assert.deepEqual(F.mechanismHardware(m).shooters[0].hood,{name:'hood'},'the virtual hub has the hood servo');
  assert.deepEqual(F.sensorHardware(r,k,m,'fused'),[{name:'rampPosition',type:'analog',port:0,inverted:false,zeroVolts:1.65,voltsPerUnit:3.3/360,source:{joint:'ramp'}}]);
  const ex=F.exportParts({robot:r,localization:'fused',mechanisms:m,kinematics:k}),src=F.mechanismsSource({packageName:'p',kinematics:k,sensorSpecs:ex.sensorSpecs},m,{x:72,y:72},{length:17,width:17,wiring:r.wiring});
  assert.match(src,/RAMP_1_DOWN_DEGREES = 118\.75/);assert.match(src,/public boolean rampsAt\(boolean down, double elapsed\)/);assert.match(src,/hood1\.setPosition\(on \? HOOD_1_SHOOT : HOOD_1_REST\);/);
  assert.equal(F.mechanismAction('Ramp down',m),'mech.ramp(true);\n        return step.moving || mech.rampsAt(true, step.elapsed);');
  const xml=F.robotConfiguration({robot:r,localization:'fused',mechanisms:m,kinematics:k}).xml;
  for(const line of ['<goBILDA5202SeriesMotor name="front_left" port="0" />','<Servo name="hood" port="2" />','<AnalogInput name="rampPosition" port="0" />','<goBILDAPinpoint name="pinpoint" port="0" bus="1" />','<LynxModule name="Expansion Hub 2" port="2">'])assert.ok(xml.includes(line),line);
});

test('an old RobotActions.java: Deck\'s untouched empty methods for actions it now runs come out, the team\'s own code stays',()=>{
  const old=`public class RobotActions extends RouteActions {
    @Override
    public void init(HardwareMap hardwareMap, Telemetry telemetry) {
        super.init(hardwareMap, telemetry);
    }

    /** "Lift up": pin 2. */
    @Override
    public boolean liftUp(Step step) {
        // TODO: Lift up.
        // Example: if (step.first) shooter.setPower(1); if (step.elapsed < 1.5) return false; shooter.setPower(0); return true;
        return true;
    }

    /** "Claw open": pin 3. */
    @Override
    public boolean clawOpen(Step step) {
        claw.setPosition(1);
        return true;
    }
}
`;
  const r=F.retireStubs(old.replace(/\n/g,'\r\n'),['liftUp','clawOpen']);assert.deepEqual(r.removed,['liftUp']);assert.ok(!r.text.includes('liftUp'));assert.ok(r.text.includes('claw.setPosition(1);'));
  assert.deepEqual(F.retireStubs(old,['armDown']),{text:old,removed:[]});
});

test('a part on more than two motors: each one named, in the configuration and run to the same target',()=>{
  const more=structuredClone(kin),lift=more.actuators.find(a=>a.id==='liftMotor');lift.more=[{device:'liftMotor3',reversed:true},{device:'liftMotor4'},{device:'bad name!'}];
  const k2=K.sanitize(more);assert.deepEqual(k2.actuators.find(a=>a.id==='liftMotor').more,[{device:'liftMotor3',reversed:true},{device:'liftMotor4'}],'kept when saved; a bad name is dropped');
  const ex=F.exportParts({robot,localization:'fused',mechanisms:null,kinematics:k2}),src=F.partsSource({packageName:'p',layoutName:'Parts route'},ex.parts.list,ex.sensorSpecs);
  for(const n of [2,3,4])assert.ok(src.includes(`liftMotor${n}.setTargetPosition((int) Math.round(value * PART_LIFT_MOTOR_COUNTS_PER_UNIT));`),"motor "+n);
  assert.match(src,/PART_LIFT_MOTOR_3 = "liftMotor3";/);assert.match(src,/liftMotor3\.setDirection\(PART_LIFT_MOTOR_REVERSED != true/);
  const H=require('../ui/sim-hardware.js'),rows=H.rows({robot,kinematics:k2,sensors:{localization:'fused'}});
  assert.deepEqual(rows.filter(r=>/^kin\.liftMotor/.test(r.key)).map(r=>[r.key,r.name,r.label]),[['kin.liftMotor','liftMotor','Lift motor'],['kin.liftMotor-2','liftMotor2','Lift motor (second)'],['kin.liftMotor-3','liftMotor3','Lift motor (third)'],['kin.liftMotor-4','liftMotor4','Lift motor (fourth)']]);
  assert.equal(K.deviceAt(k2.actuators,'kin.liftMotor-4'.slice(4)).n,4);
});
