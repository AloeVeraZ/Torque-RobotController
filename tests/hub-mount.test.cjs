'use strict';
// A hub's mounting from its own IMU (ui/sim-hub-mount.js): gravity with the robot level, then with its front lifted.
// Each case builds what the SDK would report for a hub really mounted that way, and expects the mounting back.
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../ui/sim-hub-mount.js');
const near=(a,b,tol,what='')=>assert.ok(Math.abs(a-b)<=tol,`${what} ${a} ≈ ${b}`);
const mul=(m,v)=>m.map(r=>r[0]*v[0]+r[1]*v[1]+r[2]*v[2]),T=m=>[0,1,2].map(i=>[0,1,2].map(j=>m[j][i])),mm=(a,b)=>a.map(r=>[0,1,2].map(j=>r[0]*b[0][j]+r[1]*b[1][j]+r[2]*b[2][j]));
const rot=(axis,d)=>{const c=Math.cos(d*Math.PI/180),s=Math.sin(d*Math.PI/180);return axis==='x'?[[1,0,0],[0,c,-s],[0,s,c]]:axis==='y'?[[c,0,s],[0,1,0],[-s,0,c]]:[[c,-s,0],[s,c,0],[0,0,1]];};
// What the IMU reads for a hub mounted by `mount` (robot from hub) on a robot whose front is lifted by `lift` degrees: the
// world's up, seen through the hub, as the pitch and roll the SDK would give for it.
function reading(mount,lift=0){const upRobot=[0,Math.sin(lift*Math.PI/180),Math.cos(lift*Math.PI/180)],u=mul(T(mount),upRobot);
  const pitch=Math.asin(Math.max(-1,Math.min(1,u[1])))*180/Math.PI,roll=Math.atan2(-u[0],u[2])*180/Math.PI;return M.upOf(pitch,roll);}
const found=(mount,lift=20)=>M.mountOf(reading(mount),reading(mount,lift));

test('every square mounting is found by name, upside down and on its end included',()=>{
  const dirs=['up','down','forward','backward','left','right'],axis=n=>Math.floor(dirs.indexOf(n)/2);let n=0;
  for(const logo of dirs)for(const usb of dirs){if(axis(logo)===axis(usb))continue;n++;const r=found(M.squareMatrix(logo,usb));
    assert.deepEqual([r.logo,r.usb],[logo,usb],`logo ${logo}, USB ${usb}`);near(r.off,0,.2,`${logo}/${usb} is square`);}
  assert.equal(n,24);});

test('a hub tilted anywhere from 2° to 89° is found as it is, not rounded to square',()=>{
  for(const tilt of [2,7,15,30,45,60,75,89]){
    // Logo up, USB forward, then leaned back about the robot's left-right axis, as a hub on an angled bracket is.
    const mount=mm(rot('x',tilt),M.squareMatrix('up','forward')),r=found(mount);near(r.off,Math.min(tilt,90-tilt),.3,`${tilt}° is ${r.off}° off square`);
    // The exact mounting comes back: the quaternion turns the hub's axes to where they really point on the robot.
    const q=r.quaternion,back=M.quat(mount);for(const k of ['w','x','y','z'])near(q[k],back[k],2e-3,`${tilt}° ${k}`);}
  // Leaned and turned at once, a hub on a corner gusset: 25° back, then 40° round.
  const odd=mm(rot('z',40),mm(rot('x',25),M.squareMatrix('up','forward'))),r=found(odd),q=M.quat(odd);for(const k of ['w','x','y','z'])near(r.quaternion[k],q[k],2e-3,k);assert.ok(r.off>25);
  // Close enough to square is square: the code names the mounting; further off it carries the exact one.
  assert.match(M.javaOf(found(mm(rot('x',1),M.squareMatrix('up','forward')))).code,/LogoFacingDirection\.UP, RevHubOrientationOnRobot\.UsbFacingDirection\.FORWARD\)$/);
  const j=M.javaOf(found(mm(rot('x',30),M.squareMatrix('up','forward'))));assert.match(j.code,/^new RevHubOrientationOnRobot\(new Quaternion\(0\.9659\d*f, 0\.2588\d*f, 0f, 0f, 0\)\)$/);assert.deepEqual(j.imports,['org.firstinspires.ftc.robotcore.external.navigation.Quaternion']);
  assert.match(M.words(found(mm(rot('x',30),M.squareMatrix('up','forward')))),/^Logo up, USB forward, tilted 30° from square$/);assert.equal(M.words(found(M.squareMatrix('left','up'))),'Logo left, USB up');});

test('what cannot be read says so',()=>{
  const sq=M.squareMatrix('up','forward');assert.match(M.mountOf(reading(sq),reading(sq,3)).problem,/not lifted far enough/);assert.match(M.mountOf(null,null).problem,/no pitch and roll/);assert.equal(M.upOf(NaN,0),null);
  // How far it was lifted does not change the answer.
  for(const lift of [8,20,45])assert.deepEqual([found(sq,lift).logo,found(sq,lift).usb,found(sq,lift).off],['up','forward',0]);});

test('it is read with no button: still and level, then lifted and held',()=>{
  const mount=mm(rot('x',20),M.squareMatrix('up','left'));let s=M.start(),ms=0;const feed=(lift,forMs,jitter=0)=>{for(const end=ms+forMs;ms<end;ms+=40)s=M.step(s,{ms,up:reading(mount,lift+(jitter?Math.sin(ms/50)*jitter:0))});};
  feed(0,400,3);assert.equal(s.phase,'flat','not while it is being put down');feed(0,1300);assert.equal(s.phase,'lift','level and still for a second');
  feed(4,1200);assert.equal(s.phase,'lift','a small bump is not the lift');feed(15,300);assert.equal(s.phase,'lift','lifted, not yet held');feed(22,300,4);assert.equal(s.phase,'lift','still moving');
  feed(22,1000);assert.equal(s.phase,'done');const r=M.mountOf(s.flat,s.nose);assert.deepEqual([r.logo,r.usb],['up','left']);near(r.off,20,.5,'tilt');
  assert.equal(M.step(s,{ms:ms+40,up:reading(mount,0)}),s,'done stays done');assert.equal(M.step(M.start(),{ms:0,up:null}).phase,'flat','no reading, nothing happens');});
