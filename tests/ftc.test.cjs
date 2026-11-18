'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../ui/ftc/robocol.js');const {SimController,startUdpRobot}=require('../tools/ftc-sim.cjs');const {FtcSocket,probeFtc}=require('../src/ftc.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=3000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await wait(10);}assert.fail('condition was not met in time');}
// Driver Station and simulated robot connected through memory, with optional packet loss.
function pair(options={},drop=()=>false){let ds;const sim=new SimController({...options,send:b=>{if(!drop('rc',b))setImmediate(()=>ds.receive(b));}});ds=new R.DriverStation({send:b=>{if(!drop('ds',b))setImmediate(()=>sim.receive(b));}});sim.start();return {ds,sim,stop(){ds.stop();sim.stop();}};}

test('wire layouts match the Robocol formats used by FTC SDK 11',()=>{
  const d=R.encodePeerDiscovery({seq:0x1234,version:124,peerType:1,month:9,year:2025,major:11,minor:0});
  assert.deepEqual([...d],[3,0,10,124,1,0x12,0x34,9,0x07,0xe9,11,0,0]);
  const h=R.encodeHeartbeat({seq:7,timestamp:5n,robotState:2,t0:1,t1:2,t2:3,timeZone:'UTC'});
  assert.equal(h.length,5+8+1+24+1+3);assert.deepEqual([...h.subarray(0,5)],[1,0,h.length-5,0,7]);
  const g=R.encodeGamepad({seq:9,id:3,user:1,timestamp:10,left_stick_y:-1,a:true,right_bumper:true,start:true,gamepadType:R.GamepadType.XBOX_360});
  assert.equal(g.length,65);assert.equal(g[5],5);
  const buttons=new DataView(g.buffer).getInt32(5+1+4+8+24);assert.equal(buttons,0x100|0x8|0x1);assert.equal(g[5+1+4+8+24+4],1);assert.equal(g[5+1+4+8+24+5],2);
  const back=R.decode(g);assert.equal(back.left_stick_y,-1);assert.equal(back.a,true);assert.equal(back.b,false);assert.equal(back.user,1);
  const ack=R.decode(R.encodeCommand({seq:2,timestamp:99n,acknowledged:true,name:'CMD_INIT_OP_MODE',extra:'ignored'}));
  assert.deepEqual([ack.name,ack.acknowledged,ack.extra,ack.timestamp],['CMD_INIT_OP_MODE',true,'',99n]);
  const t=R.decode(R.encodeTelemetry({tag:'',robotState:1,strings:[['\0ƀ','Heading : 90']],numbers:[['speed',0.5]]}));
  assert.deepEqual([t.robotState,t.strings,t.numbers],[1,[['\0ƀ','Heading : 90']],[['speed',0.5]]]);
});

// FTC SDK 12.0's SoftwareVersionWarningSource reads only the first discovery: the Driver Station is obsolete when its
// build month is before August of the current season, or its FTC season (starting in September) is before the robot's.
test('the first discovery passes an SDK 12.0 Robot Controller\'s obsolete-app check',()=>{
  const sent=[];const ds=new R.DriverStation({send:b=>sent.push(b)});ds.start();ds.stop();
  const p=R.decode(sent[0]),season=(y,m)=>m>=9?y:y-1,obsolete=(y,m,nowY,nowM)=>y*12+m<(nowM>=10?nowY:nowY-1)*12+8;
  assert.deepEqual([p.version,p.major,p.minor,p.year,p.month],[124,12,0,2026,9]);
  assert.equal(obsolete(p.year,p.month,2026,10),false);assert.equal(season(p.year,p.month),season(2026,9));
});

test('station connects, lists op modes, and runs INIT, START, and STOP through the robot',async t=>{
  const {ds,sim,stop}=pair();t.after(stop);ds.start();
  await until(()=>ds.state.connection==='connected'&&ds.state.opModes.length===4&&ds.state.activeConfig);
  assert.equal(ds.state.activeConfig.name,'competition');assert.ok(!ds.state.opModes.some(m=>m.flavor==='SYSTEM'));
  await until(()=>ds.state.ping!==null&&ds.state.battery?.volts===12.84);
  ds.initOpMode('Field Centric TeleOp');await until(()=>ds.state.opModeState==='init');assert.equal(sim.opMode,'Field Centric TeleOp');
  ds.setGamepad(1,{id:7,timestamp:Date.now(),gamepadType:R.GamepadType.XBOX_360,left_stick_y:-0.75,a:true});
  await until(()=>sim.gamepads[1]?.left_stick_y===-0.75&&sim.gamepads[1].a);
  ds.startOpMode('Field Centric TeleOp');await until(()=>ds.state.opModeState==='running'&&ds.state.robotState==='RUNNING');
  await until(()=>ds.state.telemetry.lines.includes('Gamepad 1 left_stick_y : -0.75'));
  ds.setGamepad(1,null);await until(()=>sim.gamepads[1]?.id===-2&&!sim.gamepads[1].a);
  ds.stopOpMode();await until(()=>ds.state.opModeState==='stopped'&&sim.opState==='stopped');
});

test('commands are retried until acknowledged and executed once',async t=>{
  let dropped=0;const {ds,sim,stop}=pair({},(from,b)=>from==='ds'&&b[0]===R.Msg.COMMAND&&R.decode(b).name==='CMD_INIT_OP_MODE'&&dropped<2&&++dropped>0);t.after(stop);ds.start();
  await until(()=>ds.state.connection==='connected');ds.initOpMode('Red Auto');
  await until(()=>ds.state.opModeState==='init',4000);assert.equal(dropped,2);assert.equal(sim.commands.filter(c=>c.name==='CMD_INIT_OP_MODE').length,1);
  await until(()=>!ds.pending.some(c=>c.name==='CMD_INIT_OP_MODE'));
});

test('autonomous with autoTransition reports its end, and lost robots return to searching',async t=>{
  let cut=false;const {ds,sim,stop}=pair({},()=>cut);t.after(stop);ds.start();const ended=[];ds.on('op-mode-ended',m=>ended.push(m));
  await until(()=>ds.state.opModes.length===4);ds.startOpMode('Blue Auto');await until(()=>ds.state.opModeState==='running');
  ds.stopOpMode();await until(()=>ended.length===1);assert.equal(ended[0].autoTransition,'Field Centric TeleOp');
  cut=true;await until(()=>ds.state.connection==='searching',3500);assert.equal(ds.state.robotState,'UNKNOWN');
  cut=false;await until(()=>ds.state.connection==='connected',3000);
});

test('a robot with another station connected rejects this one; older robocol versions are matched',async t=>{
  const a=pair({reject:true});t.after(a.stop);a.ds.start();await until(()=>a.ds.state.connection==='rejected');
  const b=pair({version:123});t.after(b.stop);b.ds.start();await until(()=>b.ds.state.connection==='connected');assert.equal(b.ds.identity.version,123);assert.equal(b.ds.state.adaptedVersion,true);
});

test('robot camera frames, toasts, and telemetry format commands reach the station',async t=>{
  const {ds,sim,stop}=pair();t.after(stop);ds.start();const frames=[],toasts=[];ds.on('frame',f=>frames.push(f));ds.on('toast',m=>toasts.push(m.message));
  await until(()=>ds.state.connection==='connected');ds.requestFrame();await until(()=>frames.length===1);assert.deepEqual([frames[0][0],frames[0][1]],[0xff,0xd8]);
  sim.command('CMD_SET_TELEM_DISPL_FORMAT','HTML');sim.command('CMD_SHOW_TOAST',JSON.stringify({message:'Hello driver',duration:1}));
  await until(()=>ds.state.telemetry.format==='HTML'&&toasts.includes('Hello driver'));
});

test('UDP transport detects and drives a Robot Controller on port 20884',async t=>{
  let robot;try{robot=await startUdpRobot({address:'127.0.0.2'});}catch(e){t.skip('127.0.0.2 loopback is unavailable: '+e.message);return;}
  t.after(()=>robot.close());
  assert.equal((await probeFtc('127.0.0.2')).ftc,true);
  const socket=await new FtcSocket('127.0.0.2').open();t.after(()=>socket.close());
  const ds=new R.DriverStation({send:b=>socket.send(b)});socket.onPacket(b=>ds.receive(b));ds.start();t.after(()=>ds.stop());
  await until(()=>ds.state.connection==='connected'&&ds.state.opModes.length===4);ds.initOpMode('Servo Tuner');await until(()=>robot.sim.opState==='init');
  await assert.rejects(new FtcSocket('127.0.0.2').open(),/in use/);
});

test('website robots are not mistaken for FTC robots',async()=>{assert.equal((await probeFtc('127.0.0.3',{timeout:300})).ftc,false);});

test('a robot is found at the fixed FTC addresses without typing an IP',async t=>{
  const {findFtc,FTC_ADDRESSES}=require('../src/ftc.cjs');assert.deepEqual(FTC_ADDRESSES,['192.168.43.1','192.168.49.1']);
  let robot;try{robot=await startUdpRobot({address:'127.0.0.2'});}catch(e){t.skip('127.0.0.2 loopback is unavailable: '+e.message);return;}t.after(()=>robot.close());
  assert.equal(await findFtc(['127.0.0.3','127.0.0.2']),'127.0.0.2');assert.equal(await findFtc(['127.0.0.3'],{timeout:300}),null);
});

test('Configure Robot and Self Inspect from the Driver Station: delete a configuration, read the inspection report',async t=>{
  const {ds,sim,stop}=pair({configurations:[{name:'competition',xml:'<Robot type="FirstInspires-FTC" />'},{name:'practice',xml:'<Robot type="FirstInspires-FTC" />'}]});t.after(stop);ds.start();
  const answers=[];ds.on('command',c=>answers.push(c));
  await until(()=>ds.state.connection==='connected'&&ds.state.activeConfig?.name==='competition');
  ds.command('CMD_DELETE_CONFIGURATION',JSON.stringify({name:'practice',resourceId:0,location:'LOCAL_STORAGE',isDirty:false}));
  await until(()=>sim.configurations.length===1);assert.equal(ds.state.activeConfig.name,'competition');
  // Deleting the active one leaves the robot with none.
  ds.command('CMD_DELETE_CONFIGURATION',JSON.stringify({name:'competition',resourceId:0,location:'LOCAL_STORAGE',isDirty:false}));
  await until(()=>ds.state.activeConfig?.name==='No Config Set');assert.equal(sim.configurations.length,0);
  ds.command('CMD_REQUEST_INSPECTION_REPORT');await until(()=>answers.some(c=>c.name==='CMD_REQUEST_INSPECTION_REPORT_RESP'));
  const report=JSON.parse(answers.find(c=>c.name==='CMD_REQUEST_INSPECTION_REPORT_RESP').extra);assert.equal(report.name,'9999-C-RC');assert.equal(report.bt,false);assert.equal(report.chOs,'1.1.6');
});
