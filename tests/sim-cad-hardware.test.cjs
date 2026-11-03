'use strict';
// What a robot's CAD says about its hardware, from a real student robot's STEP names (goBILDA, REV, Axon, SWYFT parts):
// an assembly named only for its piece ("POLLEN V2") that holds a hood and a 6000 rpm motor on 72 mm wheels is a shooter,
// not an intake; its motors and servos go to the devices that use them; its Pinpoint, Expansion Hub and Servo Hub are read;
// and the Control Hub's names match the shooter for the pieces it takes.
const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../ui/sim-mechanisms.js'),H=require('../ui/sim-hardware.js'),HS=require('../ui/sim-hub-setup.js'),RC=require('../ui/ftc/robot-config.js'),C=require('../ui/sim-config.js'),T=require('../ui/sim-test-robot.js');

const POLLEN=['GEAR','3614 Series Rhino Wheel (14mm Bore, 72mm Diameter, 30A Durometer) 3614-0014-0072','shaft','6000rpm Motor - Bare REX (GB)',
  'Intake Roller Wheel (8mm REX®, 16mm Diameter, 16mm Width, 30A Durometer) 3618-40','Belt','HOOD','Servo - Speed (SWYFT)','Servo Hub (GB)'];
test('an assembly named for its piece, holding a hood and a flywheel motor, is that piece’s shooter whatever its feeder wheel is called',()=>{
  assert.deepEqual([M.partRole('POLLEN V2 <1>',POLLEN).role,M.partRole('POLLEN V2 <1>',POLLEN).pieces],['shooter','pollen']);
  // No hood: a fast bare motor beside wheels 60 mm or bigger is a flywheel.
  assert.equal(M.partRole('NECTAR V2 <1>',POLLEN.filter(n=>n!=='HOOD')).role,'shooter');
  // Gecko wheels on an arm, named an intake, stay an intake; small wheels and a slow motor are not a shooter.
  assert.equal(M.partRole('intake v4 <1>',['48mm Gecko Wheel - 15A (GB)','Max Servo - 25t spline (AXON)','ARM']).role,'intake');
  assert.equal(M.partRole('Collector',['48mm Gecko Wheel - 15A (GB)','312rpm Motor (GB)']).role,'intake');
});

test('motors and servos by the names their vendors give them',()=>{
  const of=n=>H.fromCadName(n);
  assert.deepEqual(of('6000rpm Motor - Bare REX (GB)'),{kind:'dcmotor',model:'gobilda-5203-6000'});
  assert.deepEqual(of('312rpm Motor (GB)'),{kind:'dcmotor',model:'gobilda-5203-312'});
  assert.deepEqual(of('Max Servo - 25t spline (AXON)'),{kind:'servo',model:'axon-max'});
  assert.deepEqual(of('Mini Servo - 25t spline (AXON)'),{kind:'servo',model:'axon-mini'});
  assert.deepEqual(of('Servo - Speed (SWYFT)'),{kind:'servo',model:'swyft-speed'});
  // Parts that go with a servo or a motor are not one.
  for(const n of ['40t Servo Gear - 25t Spline (GB)','Servo Hub (GB)','Servo Hub Shaft - 16mm (GB)','Motor Mount (GB)'])assert.equal(of(n),null,n);
});

test('hubs and sensors in the CAD: a Pinpoint is the position sensor, REV-11-1855 the Servo Hub, goBILDA’s servo hub is not',()=>{
  const at=(name,...path)=>({name,path:['main assembly',...path]});
  const r=H.cadSensors([at('Control Hub','drivetrain <1>'),at('Expansion Hub','drivetrain <1>'),at('REV-11-1855','drivetrain <1>'),at('GB Pinpoint Computer','drivetrain <1>'),
    at('IR Break Beam Sensor - 5mm LEDs v3','indexer final <1>'),at('Absolute Encoder (ELC)','turret final <1>'),at('Servo Hub (GB)','POLLEN V2 <1>')]);
  assert.deepEqual([r.expansion,r.servoHub,r.localization],[true,true,'fused']);
  assert.deepEqual(r.sensors.map(s=>[s.what,s.model]),[['Break-beam sensor',null],['Absolute encoder','analog-absolute']]);
  assert.deepEqual(H.cadSensors([{name:'Servo Hub (GB)',path:[]}]),{expansion:false,servoHub:false,localization:null,sensors:[]});
  assert.equal(H.cadSensors([{name:'goBILDA Swingarm Odometry Pod',path:[]}]).localization,'odometry');
});

test('a turret carries its flywheel’s motor: the 6000 rpm motor spins the flywheel and the turret takes the servo under it, on both turrets',()=>{
  const parts=[{name:'6000rpm Motor - Bare REX (GB)',key:'r/POLLEN V2 <1>/m',path:['r','POLLEN V2 <1>'],kind:'dcmotor',model:'gobilda-5203-6000'},
    {name:'6000rpm Motor - Bare REX (GB)',key:'r/NECTAR V2 <1>/m',path:['r','NECTAR V2 <1>'],kind:'dcmotor',model:'gobilda-5203-6000'},
    {name:'Mini Servo - 25t spline (AXON)',key:'r/turret final <1>/s',path:['r','turret final <1>'],kind:'servo',model:'axon-mini'},
    {name:'Servo - Speed (SWYFT)',key:'r/NECTAR V2 <1>/h',path:['r','NECTAR V2 <1>'],kind:'servo',model:'swyft-speed'}];
  // The turret moves everything on it (its own parts), so without the speed rule its motor looked like the turret's.
  const shooter=n=>({scope:[`r/${n?'NECTAR':'POLLEN'} V2 <1>`,'r/turret final <1>'],own:[`r/${n?'NECTAR':'POLLEN'} V2 <1>`]});
  const devices=[0,1].flatMap(n=>[{key:`shooters.${n}.motor`,role:'flywheel',family:'motor',...shooter(n)},{key:`shooters.${n}.turretMotor`,role:'turret',family:'motor',...shooter(n),own:[`r/${n?'NECTAR':'POLLEN'} V2 <1>`,'r/turret final <1>']}]);
  const got=Object.fromEntries(H.assignCad(parts,devices).map(f=>[f.key,f.model]));
  assert.deepEqual(got,{'shooters.0.motor':'gobilda-5203-6000','shooters.1.motor':'gobilda-5203-6000','shooters.0.turretMotor':'axon-mini','shooters.1.turretMotor':'axon-mini'});
});

test('Configure from Control Hub: pollenFlywheel goes to the pollen shooter and nectarFlywheel to the nectar one, by what each takes',()=>{
  const s=T.setup(),p={...s,robot:C.robot(s.robot,'ftc')};
  p.mechanisms=M.sanitize({...s.mechanisms,enabled:true,shooters:[{type:'turret',pieces:'nectar',mount:'front',motor:'shooterA',parts:['NECTAR V2 <1>']},{type:'turret',pieces:'pollen',mount:'back',motor:'shooterB',parts:['POLLEN V2 <1>']}]});
  const cfg=RC.parse(`<?xml version='1.0'?><Robot type="FirstInspires-FTC"><LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173"><LynxModule name="Control Hub" port="173"><goBILDA5202SeriesMotor name="pollenFlywheel" port="0" /><goBILDA5202SeriesMotor name="nectarFlywheel" port="1" /><ControlHubImuBHI260AP name="imu" port="0" bus="0" /></LynxModule></LynxUsbDevice></Robot>`);
  const r=HS.plan(p,cfg),by=k=>r.assign.find(a=>a.key===k)?.name;
  assert.deepEqual([by('shooters.0.motor'),by('shooters.1.motor')],['nectarFlywheel','pollenFlywheel']);
});
