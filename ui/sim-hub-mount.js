'use strict';
// How a hub is mounted on the robot, worked out from its own IMU with nothing typed in. Gravity says which way is up
// through the hub; lifting the front of the robot once says which way is forward. Any mounting comes out of that: square
// (logo up, USB forward and the other 23), upside down, or tilted at any angle in between, as a team's hub on a 15° or
// 60° bracket is. The same for every IMU the robot has: the Control Hub's, and an Expansion Hub's.
// Torque Debug reads each IMU as if its hub lay flat, logo up and USB forward, so its pitch and roll are the hub's own
// tilt against gravity. Frames: the hub's X is to its right, Y out of its USB end, Z out of its logo; the robot's X is to
// its right, Y forward, Z up (the FTC SDK's).
(function(root){
  const rad=d=>d*Math.PI/180,deg=r=>r*180/Math.PI,dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const len=a=>Math.hypot(a[0],a[1],a[2]),unit=a=>{const n=len(a)||1;return [a[0]/n,a[1]/n,a[2]/n];},angle=(a,b)=>deg(Math.acos(Math.max(-1,Math.min(1,dot(unit(a),unit(b))))));
  // Up, through the hub: the third row of yaw·pitch·roll (Z, then X, then Y, as the SDK's angles are), which the yaw
  // does not touch. It holds at any tilt, a hub standing on its end (pitch 90°) included.
  function upOf(pitch,roll){const p=rad(pitch),r=rad(roll);if(!Number.isFinite(p)||!Number.isFinite(r))return null;return [-Math.cos(p)*Math.sin(r),Math.sin(p),Math.cos(p)*Math.cos(r)];}
  const DIRS=[['right',[1,0,0]],['left',[-1,0,0]],['forward',[0,1,0]],['backward',[0,-1,0]],['up',[0,0,1]],['down',[0,0,-1]]];
  const nearest=v=>DIRS.reduce((best,d)=>dot(v,d[1])>dot(v,best[1])?d:best);
  // A rotation matrix (rows) to a unit quaternion {w, x, y, z}, w not negative.
  function quat(m){const t=m[0][0]+m[1][1]+m[2][2];let w,x,y,z;
    if(t>0){const s=Math.sqrt(t+1)*2;w=s/4;x=(m[2][1]-m[1][2])/s;y=(m[0][2]-m[2][0])/s;z=(m[1][0]-m[0][1])/s;}
    else if(m[0][0]>m[1][1]&&m[0][0]>m[2][2]){const s=Math.sqrt(1+m[0][0]-m[1][1]-m[2][2])*2;w=(m[2][1]-m[1][2])/s;x=s/4;y=(m[0][1]+m[1][0])/s;z=(m[0][2]+m[2][0])/s;}
    else if(m[1][1]>m[2][2]){const s=Math.sqrt(1+m[1][1]-m[0][0]-m[2][2])*2;w=(m[0][2]-m[2][0])/s;x=(m[0][1]+m[1][0])/s;y=s/4;z=(m[1][2]+m[2][1])/s;}
    else{const s=Math.sqrt(1+m[2][2]-m[0][0]-m[1][1])*2;w=(m[1][0]-m[0][1])/s;x=(m[0][2]+m[2][0])/s;y=(m[1][2]+m[2][1])/s;z=s/4;}
    const k=w<0?-1:1,r=v=>+(v*k).toFixed(6);return {w:r(w),x:r(x),y:r(y),z:r(z)};}
  // The robot-from-hub rotation for a square mounting named the SDK's way: where the logo and the USB end face.
  function squareMatrix(logo,usb){const z=DIRS.find(d=>d[0]===logo)[1],y=DIRS.find(d=>d[0]===usb)[1],x=cross(y,z);return [[x[0],y[0],z[0]],[x[1],y[1],z[1]],[x[2],y[2],z[2]]];}
  // flat, nose: up through the hub (upOf) with the robot level, and with its front lifted. The lift tips "up" towards the
  // robot's front, so the part of nose that is not along flat points forward through the hub.
  // Returns {logo, usb, off, quaternion, tilt} or {problem}. logo, usb: the nearest square mounting; off: how many degrees
  // the hub really is from it; quaternion: the exact mounting (robot from hub), for a hub that is not square.
  function mountOf(flat,nose){
    if(!flat||!nose)return {problem:'This IMU gave no pitch and roll to read.'};const up=unit(flat),tilt=angle(flat,nose);
    if(tilt<6)return {problem:'The front was not lifted far enough to tell which way is forward. Lift it a hand’s height.'};
    const along=dot(nose,up),fwd=unit([nose[0]-along*up[0],nose[1]-along*up[1],nose[2]-along*up[2]]),right=cross(fwd,up);
    // Rows: the robot's right, forward and up, each as it lies in the hub. That matrix turns a hub vector into a robot one.
    const m=[right,fwd,up],logoAt=[m[0][2],m[1][2],m[2][2]],usbAt=[m[0][1],m[1][1],m[2][1]],logo=nearest(logoAt)[0];
    // The USB end's nearest direction that is not along the logo's (they cannot share an axis).
    const axis=n=>Math.floor(DIRS.findIndex(d=>d[0]===n)/2),usb=DIRS.filter(d=>axis(d[0])!==axis(logo)).reduce((best,d)=>dot(usbAt,d[1])>dot(usbAt,best[1])?d:best)[0];
    // How far the real mounting is from that square one: the angle of the turn between them.
    const sq=squareMatrix(logo,usb),tr=m[0][0]*sq[0][0]+m[0][1]*sq[0][1]+m[0][2]*sq[0][2]+m[1][0]*sq[1][0]+m[1][1]*sq[1][1]+m[1][2]*sq[1][2]+m[2][0]*sq[2][0]+m[2][1]*sq[2][1]+m[2][2]*sq[2][2];
    return {logo,usb,off:+deg(Math.acos(Math.max(-1,Math.min(1,(tr-1)/2)))).toFixed(1),quaternion:quat(m),tilt:+tilt.toFixed(1)};}
  // Anything within this of square is square: a hub's screws and the floor are not truer than that.
  const SQUARE_DEG=2;
  // ---- reading it without a button ----
  // The robot is watched: once it has sat still for a second that is "flat"; once it is then tipped at least 8° and held
  // still for most of a second that is "nose". It starts again by itself if the robot is set back down before it was held.
  // state: {phase:'flat'|'lift'|'done', flat, nose, hold:[[ms, up]]}; sample: {ms, up}. Returns the next state.
  const STILL_DEG=1,FLAT_MS=1000,HOLD_MS=700,LIFT_DEG=8;
  const start=()=>({phase:'flat',flat:null,nose:null,hold:[]});
  const mean=h=>unit(h.reduce((a,x)=>[a[0]+x[1][0],a[1]+x[1][1],a[2]+x[1][2]],[0,0,0]));
  function step(state,sample){if(state.phase==='done'||!sample?.up)return state;const s={...state,hold:[...state.hold,[sample.ms,sample.up]]},need=s.phase==='flat'?FLAT_MS:HOLD_MS;
    // Still: every reading of the last stretch within a degree of the newest.
    while(s.hold.length&&sample.ms-s.hold[0][0]>need+200)s.hold.shift();
    const moved=s.hold.some(h=>angle(h[1],sample.up)>STILL_DEG);if(moved){s.hold=[[sample.ms,sample.up]];return s;}
    if(sample.ms-s.hold[0][0]<need)return s;
    if(s.phase==='flat'){s.flat=mean(s.hold);s.phase='lift';s.hold=[];return s;}
    if(angle(s.flat,sample.up)<LIFT_DEG)return s;
    s.nose=mean(s.hold);s.phase='done';s.hold=[];return s;}
  // The words for a mounting: "Logo up, USB forward", and how far off square it really is.
  const WORD={up:'up',down:'down',forward:'forward',backward:'backward',left:'left',right:'right'};
  const words=m=>m?.problem?m.problem:`Logo ${WORD[m.logo]}, USB ${WORD[m.usb]}${m.off>SQUARE_DEG?`, tilted ${m.off}° from square`:''}`;
  // The SDK's line for it: the named square mounting, or the exact one for a hub that is not square.
  const E=n=>n.toUpperCase(),num=v=>{const t=String(+(+v).toFixed(6));return /[.e]/.test(t)?t+'f':t+'f';};
  function javaOf(m){const square=`new RevHubOrientationOnRobot(RevHubOrientationOnRobot.LogoFacingDirection.${E(m?.logo||'up')}, RevHubOrientationOnRobot.UsbFacingDirection.${E(m?.usb||'forward')})`;
    if(!m?.quaternion||!(m.off>SQUARE_DEG))return {code:square,imports:[]};const q=m.quaternion;
    return {code:`new RevHubOrientationOnRobot(new Quaternion(${num(q.w)}, ${num(q.x)}, ${num(q.y)}, ${num(q.z)}, 0))`,imports:['org.firstinspires.ftc.robotcore.external.navigation.Quaternion'],note:`tilted ${m.off}° from logo ${m.logo}, USB ${m.usb}: measured by Torque`};}
  const api={upOf,mountOf,squareMatrix,quat,start,step,words,javaOf,angle,SQUARE_DEG,LIFT_DEG};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.DeckHubMount=api;
})(typeof globalThis==='object'?globalThis:this);
