'use strict';
// Calibrate → Electronics (ui/sim-links.js): devices from any robot's configuration and Torque Debug, what follows a move,
// whether it matches the configuration, game pieces, judging a check, what is checked off, the chassis, and that links
// survive the calibration's sanitize. Nothing here reads Simulate.
const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../ui/sim-links.js'),T=require('../ui/sim-tune.js');

// A drivetrain-only robot as Setup reads it from a Control Hub: four motors and the hub's IMU, nothing else.
const READOUT=[{name:'leftFront',kind:'motor',tag:'goBILDA5202SeriesMotor',hub:'control',port:0},{name:'leftBack',kind:'motor',hub:'control',port:1},
  {name:'rightFront',kind:'motor',hub:'control',port:2},{name:'rightBack',kind:'motor',hub:'control',port:3},{name:'imu',kind:'imu',hub:'control',bus:0}];
const still={'m:leftFront:pos':0,'m:leftBack:pos':0,'m:rightFront:pos':0,'m:rightBack:pos':0,'i:imu:yaw':179.5};

test('a drivetrain read from the hub gives its motors, their encoders and the IMU, and nothing of Lunala',()=>{
  const d=L.devices(READOUT,null);
  assert.deepEqual(d.actuators.map(a=>a.name),['leftFront','leftBack','rightFront','rightBack']);
  assert.deepEqual(d.sensors.map(s=>s.key),['m:leftFront:pos','m:leftBack:pos','m:rightFront:pos','m:rightBack:pos','i:imu:yaw']);
  assert.ok(!d.sensors.some(s=>/intake|shooter|turret|pinpoint/i.test(s.key)));});

test('Torque Debug adds what the configuration did not list, and each name is kept once',()=>{
  const d=L.devices(READOUT,{motors:['leftFront','par'],servos:['claw'],crservos:['spin'],analog:[{n:'clawPot'}],touch:['home'],digital:['beam'],i2c:[{n:'pinpoint',k:'pinpoint'},{n:'imu',k:'imu'}]});
  assert.deepEqual(d.actuators.map(a=>`${a.name}:${a.kind}`),['leftFront:motor','par:motor','spin:crservo','claw:servo','leftBack:motor','rightFront:motor','rightBack:motor']);
  for(const k of ['m:par:pos','a:clawPot','d:home','d:beam','i:pinpoint:ex','i:pinpoint:ey','i:pinpoint:h','i:imu:yaw'])assert.ok(d.sensors.some(s=>s.key===k),k);
  assert.equal(d.sensors.filter(s=>s.key==='i:imu:yaw').length,1);
  assert.equal(L.wordsOf(d.sensors.find(s=>s.key==='d:home'),-1),'is pressed');});

test('what followed a move, and whether it matches the configuration',()=>{
  const d=L.devices(READOUT,null),before=[still,{...still,'m:leftFront:pos':1}];
  const seen=L.changes(d,before,[{...still,'m:leftFront:pos':120,'i:imu:yaw':175}]);
  assert.deepEqual(seen.map(x=>[x.key,x.dir]),[['m:leftFront:pos',1],['i:imu:yaw',-1]],'its encoder up, and the heading through 180° down by 4.5°');
  const c={name:'leftFront',kind:'motor',dir:1};
  assert.equal(L.configured(c,'m:leftFront:pos'),'own');assert.equal(L.configured(c,'m:leftBack:pos'),'other','another port’s encoder');
  assert.equal(L.configured(c,'i:imu:yaw'),null,'a configuration says nothing about what an IMU is on');assert.equal(L.configured({name:'claw',kind:'servo',dir:1},'a:clawPot'),null);
  assert.deepEqual(L.changes(d,before,[{...still,'m:leftFront:pos':3}]),[],'under the noise floor');});

test('a game piece: the cause of a sensor nothing turns',()=>{
  const d=L.devices([{name:'beam',kind:'digital'}],null),link={causes:[{name:L.PIECE,kind:'piece',dir:1}],effect:{key:'d:beam',dir:-1}};
  assert.equal(L.sentence(link,d),'If a game piece goes in, then beam · digital goes LOW.');assert.deepEqual(L.missing(link,d),[]);
  assert.equal(L.judge(link,d,[{'d:beam':1}],[{'d:beam':1},{'d:beam':0}]).state,'pass');
  const r=L.judge(link,d,[{'d:beam':1}],[{'d:beam':1}]);assert.equal(r.state,'none');assert.match(L.resultText(r,link,d),/Put the game piece/);
  });

test('judging a check: right way, backwards, a swapped cable, and staying the same',()=>{
  const d=L.devices(READOUT,null),before=[still],link={causes:[{name:'leftFront',kind:'motor',dir:1}],effect:{key:'m:leftFront:pos',dir:1}};
  assert.equal(L.judge(link,d,before,[{...still,'m:leftFront:pos':120}]).state,'pass');
  const back=L.judge(link,d,before,[{...still,'m:leftFront:pos':-120}]);assert.equal(back.state,'backwards');assert.match(L.resultText(back,link,d),/opposite of the link/);
  const r=L.judge(link,d,before,[{...still,'m:leftBack:pos':90}]);assert.equal(r.state,'other');assert.match(L.resultText(r,link,d),/leftBack · encoder did/);
  const spin={causes:[{name:'leftFront',kind:'motor',dir:1}],effect:{key:'i:imu:yaw',dir:0}};
  assert.equal(L.judge(spin,d,[still],[{...still,'i:imu:yaw':179.9}]).state,'pass');assert.equal(L.judge(spin,d,[still],[{...still,'i:imu:yaw':170}]).state,'moved');
  assert.equal(L.judge({...link,effect:{key:'a:gone',dir:1}},d,before,before).unread,true);});

test('checked off: a motor once it moves a sensor or is said to move none, a sensor once something moves it',()=>{
  const d=L.devices(READOUT,null),ok={state:'pass'};
  const links=[{id:'a',causes:[{name:'leftFront',kind:'motor',dir:1}],effect:{key:'m:leftFront:pos',dir:1},result:ok},{id:'b',causes:[{name:'leftBack',kind:'motor',dir:1}],effect:{key:'i:imu:yaw',dir:-1},result:{state:'backwards'}}];
  const p=L.progress(links,d,{none:['rightBack']});
  assert.deepEqual(p.acts.filter(a=>a.done).map(a=>a.name),['leftFront','rightBack'],'a backwards link checks nothing off');
  assert.deepEqual(p.sens.filter(s=>s.done).map(s=>s.key),['m:leftFront:pos']);assert.equal(p.done,3);assert.equal(p.total,9);});

test('a link to a device the robot no longer has is marked',()=>{
  const d=L.devices(READOUT,null),links=[{id:'a',causes:[{name:'leftFront',kind:'motor',dir:1}],effect:{key:'i:imu:yaw',dir:1}},{id:'b',causes:[{name:'lift',kind:'motor',dir:1}],effect:{key:'m:leftBack:pos',dir:1}}];
  assert.deepEqual(L.missing(links[1],d),['lift']);assert.deepEqual(L.missing(links[0],d),[]);});

test('the chassis: each wheel guessed from the configuration’s names, and its links planned',()=>{
  const d=L.devices(READOUT,null),c=L.guessChassis('mecanum',d);
  assert.deepEqual(Object.fromEntries(Object.entries(c.slots).map(([k,s])=>[k,s.motor])),{frontLeft:'leftFront',frontRight:'rightFront',backLeft:'leftBack',backRight:'rightBack'});
  const planned=L.chassisLinks(c,d,n=>n==='rightBack'?false:undefined);assert.deepEqual(planned.map(l=>l.effect.key),['m:leftFront:pos','m:rightFront:pos','m:leftBack:pos'],'no encoder, no link');assert.ok(planned.every(l=>l.planned));
  // A three-pod swerve whose pods are named front, right and left: drive motor, steering servo and its analog encoder.
  const q=L.devices([{name:'frontPod',kind:'motor',hub:'control',port:0},{name:'rightPod',kind:'motor',hub:'control',port:1},{name:'leftPod',kind:'motor',hub:'control',port:2},{name:'frontPodS',kind:'crservo',hub:'control',port:0},{name:'rightPodS',kind:'crservo',hub:'control',port:1},{name:'leftPodS',kind:'crservo',hub:'control',port:2},{name:'frontPodE',kind:'analog',hub:'control',port:0},{name:'rightPodE',kind:'analog',hub:'control',port:1},{name:'leftPodE',kind:'analog',hub:'control',port:2}],null),k=L.guessChassis('kiwiSwerve',q);
  assert.deepEqual(k.slots,{front:{motor:'frontPod',servo:'frontPodS',encoder:'frontPodE'},backLeft:{motor:'leftPod',servo:'leftPodS',encoder:'leftPodE'},backRight:{motor:'rightPod',servo:'rightPodS',encoder:'rightPodE'}},'by Simulate’s keys');
  assert.deepEqual(L.simDevices(k),{front:'frontPod',steerFront:'frontPodS',backLeft:'leftPod',steerBackLeft:'leftPodS',backRight:'rightPod',steerBackRight:'rightPodS'},'what Simulate gets');
  const ql=L.chassisLinks(k,q);assert.deepEqual(ql.map(l=>`${l.causes[0].name}>${l.effect.key}`),['frontPod>m:frontPod:pos','frontPodS>a:frontPodE','leftPod>m:leftPod:pos','leftPodS>a:leftPodE','rightPod>m:rightPod:pos','rightPodS>a:rightPodE']);
  const once=L.plan([],ql);assert.equal(L.plan(once,ql).length,6,'planned once');
  assert.deepEqual(L.wordsIn('front_left-Drive2'),['front','left','drive2']);assert.deepEqual(L.slotsOf('tank2').map(s=>s.key),['left','right']);});

test('a planned link passes on any change and learns which way; Debug’s finds come in once',()=>{
  const d=L.devices(READOUT,null),link={causes:[{name:'leftFront',kind:'motor',dir:1}],effect:{key:'m:leftFront:pos',dir:1},planned:true};
  const r=L.judge(link,d,[still],[{...still,'m:leftFront:pos':-80}]);assert.equal(r.state,'pass');assert.equal(r.dir,-1);
  assert.equal(L.judge(link,d,[still],[still]).state,'none');
  const found=[{name:'leftFront',kind:'motor',key:'m:leftFront:pos',dir:1},{name:'leftBack',kind:'motor',key:'i:imu:yaw',dir:0},{name:'gone',kind:'motor',key:'m:gone:pos',dir:1}];
  const a=L.fromDebug([],found,d);assert.equal(a.added,2);assert.equal(a.links[0].result.state,'pass');assert.equal(a.links[1].planned,true,'which way is not known');
  assert.equal(L.fromDebug(a.links,found,d).added,0,'nothing twice');});

test('a motor Configure says has no encoder is done once seen to turn',()=>{
  const d=L.devices(READOUT,null),enc=n=>n==='rightBack'?false:undefined;
  assert.equal(L.progress([],d,{},enc).acts.find(a=>a.name==='rightBack').done,false);
  const p=L.progress([],d,{spins:['rightBack']},enc);assert.equal(p.acts.find(a=>a.name==='rightBack').done,true);assert.equal(p.acts.find(a=>a.name==='rightBack').noEncoder,true);
  assert.equal(L.progress([{causes:[{name:'leftFront',kind:'motor',dir:1}],effect:{key:'m:leftFront:pos',dir:1},planned:true,result:{state:'pass'}}],d).acts[0].done,false,'a planned link checks nothing off');});

test('links and the electronics record are kept with the setup through the calibration sanitize; broken ones are dropped',()=>{
  const good={id:'a',causes:[{name:'leftFront',kind:'motor',dir:1}],effect:{key:'m:leftFront:pos',dir:1},result:{state:'pass',text:'ok',at:'2026-11-04T00:00:00.000Z',others:['m:leftBack:pos']}};
  const piece={id:'p',causes:[{name:'game piece',kind:'piece',dir:1}],effect:{key:'d:beam',dir:-1}};
  const c=T.sanitize({mechs:{},electronics:{zeroedAt:'2026-11-04T00:00:00.000Z',none:['rightBack']},links:[good,piece,{id:'b',causes:[{name:'x',kind:'laser',dir:1}],effect:{key:'k',dir:1}},{id:'c',causes:[],effect:{key:'k',dir:2}}]});
  assert.deepEqual(c.links,[good,piece]);assert.deepEqual(c.electronics.none,['rightBack']);assert.equal(T.sanitize({mechs:{}}).links,undefined);});

test('an IMU, Pinpoint or OTOS is moved by hand: each reading before and after, and what it needs to pass',()=>{
  const v=(o)=>Object.fromEntries(Object.entries(o).map(([k,x])=>[`i:imu:${k}`,x]));
  const rest=[v({yaw:10,pitch:0,roll:0}),v({yaw:10.2,pitch:.1,roll:0}),v({yaw:9.9,pitch:0,roll:-.1})];
  const turned=L.handCheck('imu','imu',rest,[v({yaw:40,pitch:0,roll:0}),v({yaw:95,pitch:.2,roll:0})]);
  assert.equal(turned.ok,true);const yaw=turned.rows.find(r=>r.k==='yaw');assert.ok(yaw.moved);assert.equal(yaw.after,95);assert.ok(Math.abs(yaw.before-10.033)<.01);assert.equal(turned.rows.find(r=>r.k==='pitch').moved,false);
  assert.equal(L.handCheck('imu','imu',rest,rest).ok,false,'resting is not moving');
  assert.equal(L.handCheck('imu','imu',[v({yaw:178})],[v({yaw:-178})]).ok,true,'heading wraps: 178° to -178° turned 4°');
  const p=(ex,ey)=>({'i:pp:ex':ex,'i:pp:ey':ey,'i:pp:x':0,'i:pp:y':0,'i:pp:h':0});
  const onlyX=L.handCheck('pinpoint','pp',[p(0,0),p(0,0)],[p(400,0)]);assert.equal(onlyX.ok,false);assert.deepEqual(onlyX.missing,['Y pod'],'both pods must roll');
  assert.equal(L.handCheck('pinpoint','pp',[p(0,0)],[p(400,0),p(400,-250)]).ok,true);
  assert.equal(L.handCheck('imu','gone',rest,rest).unread,true);assert.equal(L.handCheck('motor','m',[],[]),null);
  assert.match(L.statusWords('FAULT_NO_PODS_DETECTED'),/X and Y ports/);assert.equal(L.statusWords('READY'),'');});

test('a skipped device, and one moved by hand, are checked off',()=>{
  const devs=L.devices([{name:'imu',kind:'imu'},{name:'lift',kind:'motor'},{name:'pp',kind:'pinpoint'}]);
  let pr=L.progress([],devs,{});assert.equal(pr.done,0);
  pr=L.progress([],devs,{skipped:['lift','pp'],moved:{imu:{ok:true}}});
  assert.ok(pr.acts.find(a=>a.name==='lift').done);assert.ok(pr.sens.filter(s=>s.name==='pp').every(s=>s.done&&s.skipped));assert.ok(pr.sens.find(s=>s.name==='imu').done);
  assert.equal(L.progress([],devs,{moved:{imu:{ok:false}}}).sens.find(s=>s.name==='imu').done,false,'a failed watch does not count');});
