'use strict';
// Servo Test: its own op mode (src/onbot/TorqueServoTest.java), separate from Torque Debug, and the plan Torque writes for it.
const {test}=require('node:test'),assert=require('node:assert/strict');
const L=require('../src/robot-link.cjs'),{onBotCompile}=require('../tools/ftc-sim.cjs');

test('the Servo Test op mode compiles on SDK 12.0, has no package and shares nothing with Torque Debug',t=>{
  const src=L.servoTestSource();
  assert.doesNotMatch(src,/^\s*package\s/m,'no package: Sinister crashes on OnBot classes in one');
  assert.match(src,/@TeleOp\(name = "TorqueServoTest"/);assert.doesNotMatch(src,/TorqueDebug|ServerSocket|Socket\b/,'no network port, nothing of Torque Debug');
  assert.doesNotMatch(L.debugSource(),/LynxGetServo|"H"/,'Torque Debug has no servo-test command');
  const compile=onBotCompile();if(!compile){t.skip('the simulator’s Java is not built');return;}
  assert.deepEqual(compile({'/src/TorqueServoTest.java':src}),[]);
  assert.deepEqual(compile({'/src/TorqueServoTest.java':src,'/src/TorqueDebug.java':L.debugSource()}),[],'both build together');
});
test('the plan is numbers only, checked before it goes to the robot',()=>{
  assert.equal(L.servoPlanText({port:0,enable:true,steps:[{us:1500,ms:1500},{us:500,ms:2000},{us:2500,ms:2000}]}),'hub 0\nport 0\nenable 1\n1500 1500\n500 2000\n2500 2000\n');
  assert.equal(L.servoPlanText({port:3,enable:false,steps:[{us:1700,ms:500}]}),'hub 0\nport 3\nenable 0\n1700 500\n','write-only: the port stays off');
  assert.throws(()=>L.servoPlanText({steps:[{us:3000,ms:100}]}),/500 to 2500 µs/);assert.throws(()=>L.servoPlanText({steps:[{us:1500,ms:20000}]}),/0\.02 to 10 s/);
  assert.throws(()=>L.servoPlanText({port:6,steps:[{us:1500,ms:100}]}),/port must be 0 to 5/);assert.throws(()=>L.servoPlanText({steps:[]}),/1 to 12 steps/);
  assert.throws(()=>L.servoPlanText({steps:[{us:'1500; rm -rf /',ms:100}]}),/500 to 2500/,'nothing but numbers reaches the shell');
  assert.throws(()=>L.servoPlanText({hub:'2; reboot',live:true,us:1500,seq:1}),/Which hub/);
});
test('the plan is written to the robot over USB, where the op mode reads it',async()=>{
  const calls=[],run=(file,args,opts,cb)=>{calls.push(args);const out=args[0]==='devices'?'List of devices attached\nABC123\tdevice product:ch_v1_box model:Control_Hub_v1_0\n':'';cb(null,out,'');};
  const text=await L.servoPlan({port:0,steps:[{us:1500,ms:100}]},{run}).catch(e=>e);
  const shell=calls.find(a=>a.includes('shell')&&a.some(x=>/servo-test\.txt/.test(x)));
  if(text instanceof Error){assert.ok(shell,`it reached the shell before: ${text.message}`);return;}
  assert.ok(shell,'an adb shell writes it');
  assert.ok(shell.at(-1).endsWith(`> ${L.SERVO_PLAN}.tmp && mv -f ${L.SERVO_PLAN}.tmp ${L.SERVO_PLAN}`),'written beside it, then renamed over it: never seen half written');
  assert.ok(shell.at(-1).includes(String.raw`printf 'hub 0\nport 0\nenable 1\n1500 100\n'`));
});
test('live: the hub, the pulse now and a count the op mode watches, 0 to 2500 µs',()=>{
  assert.equal(L.servoPlanText({port:0,live:true,us:1500,seq:4}),'hub 0\nport 0\nenable 1\nlive 1\nseq 4\nus 1500\n');
  assert.equal(L.servoPlanText({live:true,us:0,seq:1}),'hub 0\nport 0\nenable 1\nlive 1\nseq 1\nus 0\n','0 is no pulse');
  assert.equal(L.servoPlanText({hub:2,port:1,live:true,us:1500,seq:1}),'hub 2\nport 1\nenable 1\nlive 1\nseq 1\nus 1500\n','an Expansion Hub by its address');
  assert.throws(()=>L.servoPlanText({live:true,us:2600,seq:1}),/0 to 2500 µs/);
  const src=L.servoTestSource();
  assert.match(src,/TORQUE_GONE_MS = 3000/,'the op mode turns the port off when Torque goes quiet');
  assert.match(src,/next\.live && !next\.seq\.isEmpty\(\) && next\.hasUs/,'a plan caught half written is skipped');
  assert.match(src,/h\.getModuleAddress\(\) == plan\.hub/,'it finds an Expansion Hub by its address');
});
