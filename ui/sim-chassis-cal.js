'use strict';
// Calibrate → Mechanisms starts with the chassis: the drivetrain Simulate describes (its kind, its drive motors and what
// measures where it is), checked on the real robot in three steps:
//   1. This is the chassis: Simulate's drivetrain and position sensing, against what the robot really has (Electronics);
//   2. Wiring and directions: Electronics' "if this, then this" links on the drive motors and the position sensors, checked;
//   3. Where it is: a live map of the field from a zero the student sets, while they drive or push the robot around, and a
//      known spot to compare against.
// Kept in project.calibration.chassis: {confirmed, zero?, spots:[{real:{x,y}, read:{x,y,h}}], placed}.
// Frame (Road Runner, Pedro, Deck): x forward, y left, inches; heading degrees counterclockwise.
(function(root){
  const MM=25.4,wrap=d=>((d+180)%360+360)%360-180,rad=d=>d*Math.PI/180;
  const DRIVE_KEYS=['frontLeft','frontRight','backLeft','backRight','left','right'];
  // What the drivetrain runs on, by its kind: the keys of robot.devices it uses.
  const DRIVE_OF={tank2:['left','right'],tank:['frontLeft','backLeft','frontRight','backRight'],kiwi:['frontLeft','frontRight','backLeft']};
  const driveKeys=type=>DRIVE_OF[type]||['frontLeft','frontRight','backLeft','backRight'];
  // Everything the chassis needs, from the setup: names as the robot's configuration calls them.
  // project: the setup; C: DeckSimConfig; cpr: drive encoder counts a motor turn.
  function chassisOf(project,C,{cpr=537.7}={}){
    const r=project.robot||{},dev=k=>r.devices?.[k]?.name||k,type=r.drivetrain||'mecanum',drive=C?.drives?.[type]||{name:type},loc=project.sensors?.localization||'encoders',odo=C?.odometryOf?C.odometryOf(r):{pods:{},pinpoint:{},otos:{},imu:{scale:1}};
    const motors=driveKeys(type).map(k=>({key:k,name:dev(k),reversed:!!r.devices?.[k]?.reversed}));
    const pods=({odometry:['par','perp'],odometry3:['par_left','par_right','perp']}[loc]||[]).map(k=>({key:k,name:dev(k),...odo.pods[k]}));
    const wheelIn=(r.wheelDiameterMm||104)/MM;
    return {type,name:drive.name,holonomic:!!drive.holonomic,swerve:drive.engine==='swerve',loc,locName:C?.sensors?.[loc]?.name||loc,motors,pods,imu:dev('imu'),pinpoint:dev('pinpoint'),otos:dev('otos'),odo,
      driveTicksPerIn:cpr/(Math.PI*wheelIn),podTicksPerIn:2000/(Math.PI*32/MM)};}
  // The robot's devices the chassis names that Electronics does not see on the robot.
  function missing(ch,devs){const has=n=>devs.actuators.some(a=>a.name===n)||devs.sensors.some(s=>s.name===n);const out=ch.motors.filter(m=>!has(m.name)).map(m=>m.name);
    if(ch.loc==='fused'&&!has(ch.pinpoint))out.push(ch.pinpoint);if(ch.loc==='optical'&&!has(ch.otos))out.push(ch.otos);for(const p of ch.pods)if(!has(p.name))out.push(p.name);
    if(['odometry','odometry3','encoders','gyro'].includes(ch.loc)&&!has(ch.imu))out.push(ch.imu);return [...new Set(out)];}
  // What it can say about where it is: x, y and heading, or heading only.
  const measures=ch=>ch.swerve&&ch.loc==='encoders'?'heading':['fused','optical','odometry','odometry3','encoders'].includes(ch.loc)?'position':ch.loc==='gyro'?'heading':'nothing';
  // ---- where it is, from Torque Debug's readings (v: {key: value}) ----
  // tracker(ch).zero(v) sets here as (0, 0) facing 0°; update(v) returns {x, y, h} from there.
  function tracker(ch){
    let z=null,pose={x:0,y:0,h:0},last=null;
    const imuH=v=>{const y=v[`i:${ch.imu}:yaw`];return Number.isFinite(y)?y*(ch.odo.imu?.scale||1):NaN;};
    // An absolute sensor (Pinpoint, OTOS): its own x, y, h, made relative to the zero.
    const absolute=v=>{if(ch.loc==='fused'){const n=ch.pinpoint,x=v[`i:${n}:x`],y=v[`i:${n}:y`];return {x:x/MM,y:y/MM,h:v[`i:${n}:h`]};}const n=ch.otos;return {x:v[`i:${n}:x`],y:v[`i:${n}:y`],h:v[`i:${n}:h`]};};
    // A counting one (pods or drive encoders, with the IMU's heading): how far it went forward and sideways since last time.
    function counts(v){const t=k=>v[`m:${k}:pos`];
      if(ch.loc==='odometry'||ch.loc==='odometry3'){const val=p=>t(p.name)*(p.reversed?-1:1)*(p.scale||1)/ch.podTicksPerIn,par=ch.pods.filter(p=>p.key!=='perp'),perp=ch.pods.find(p=>p.key==='perp');
        return {f:par.reduce((a,p)=>a+val(p),0)/par.length,fy:par.reduce((a,p)=>a+(p.y||0),0)/par.length,s:perp?val(perp):0,sx:perp?.x||0};}
      const m=Object.fromEntries(ch.motors.map(x=>[x.key,t(x.name)*(x.reversed?-1:1)/ch.driveTicksPerIn]));
      if(['tank','tank2'].includes(ch.type)){const l=[m.left??m.frontLeft,m.backLeft].filter(Number.isFinite),r=[m.right??m.frontRight,m.backRight].filter(Number.isFinite);return {f:(l.reduce((a,b)=>a+b,0)/l.length+r.reduce((a,b)=>a+b,0)/r.length)/2,s:0,fy:0,sx:0};}
      return {f:(m.frontLeft+m.frontRight+m.backLeft+m.backRight)/4,s:(-m.frontLeft+m.frontRight+m.backLeft-m.backRight)/4,fy:0,sx:0};}
    function read(v){
      if(ch.loc==='fused'||ch.loc==='optical'){const a=absolute(v);if(![a.x,a.y,a.h].every(Number.isFinite))return null;return {abs:a};}
      const h=imuH(v);if(!Number.isFinite(h))return null;if(measures(ch)!=='position')return {h};const c=counts(v);return Number.isFinite(c.f)&&Number.isFinite(c.s)?{h,c}:null;}
    return {
      zero(v){const r=read(v);if(!r)return false;z=r;last=r;pose={x:0,y:0,h:0};return true;},
      get zeroed(){return !!z;},
      update(v){const r=read(v);if(!r||!z)return null;
        if(r.abs){const dx=r.abs.x-z.abs.x,dy=r.abs.y-z.abs.y,c=Math.cos(rad(-z.abs.h)),s=Math.sin(rad(-z.abs.h));pose={x:dx*c-dy*s,y:dx*s+dy*c,h:wrap(r.abs.h-z.abs.h)};return pose;}
        const h=wrap(r.h-z.h);if(!r.c){pose={x:NaN,y:NaN,h};return pose;}
        // A turn rolls a forward pod left of centre backwards (−y·Δθ) and a strafe pod ahead of centre left (+x·Δθ): taken out, the rest is travel.
        const dth=rad(wrap(h-pose.h)),f=r.c.f-last.c.f+r.c.fy*dth,sw=r.c.s-last.c.s-r.c.sx*dth,mid=rad(pose.h)+dth/2;
        pose={x:pose.x+f*Math.cos(mid)-sw*Math.sin(mid),y:pose.y+f*Math.sin(mid)+sw*Math.cos(mid),h};last=r;return pose;}};}
  // ---- the wheels in the CAD ----
  // Each drive wheel the CAD's moving parts found (joints driven by 'wheel', not odometry pods), given to the drivetrain's
  // wheel or module it points at from the robot's centre: front +x, back -x, left +y, right -y from the slot's key. Several
  // wheels on one side (a six-wheel tank) give their middle. slots: [{key}]; joints: kinematics joints, their origins in the CAD's frame;
  // toRobot: CAD point to robot inches (DeckJointsPanel's), else the origins are taken as robot inches already.
  // Returns {key: {x, y, wheels}}.
  function wheelSlots(slots,joints,{toRobot=null}={}){const dirOf=k=>{const w=k.replace(/B$/,'').replace(/([A-Z])/g,' $1').toLowerCase();const x=/front/.test(w)?1:/back/.test(w)?-1:0,y=/left/.test(w)?1:/right/.test(w)?-1:0,n=Math.hypot(x,y)||1;return [x/n,y/n];};
    const wheels=(joints||[]).filter(j=>j?.drive?.signal==='wheel'&&j.kind!=='odometry-pod'&&!/odometry|dead ?wheel/i.test(j.name||'')&&Array.isArray(j.origin)&&Number.isFinite(j.origin[0])&&Number.isFinite(j.origin[1]));
    const out={},list=slots.filter(s=>!/B$/.test(s.key)).map(s=>({key:s.key,d:dirOf(s.key)}));if(!list.length||!wheels.length)return out;
    for(const w of wheels){const [x,y]=toRobot?toRobot(w.origin):w.origin,n=Math.hypot(x,y)||1;let best=null,score=-Infinity;for(const s of list){const v=(x*s.d[0]+y*s.d[1])/n;if(v>score){score=v;best=s;}}(out[best.key]??={xs:[],ys:[],wheels:[]});out[best.key].xs.push(x);out[best.key].ys.push(y);out[best.key].wheels.push(w.id);}
    for(const [k,v] of Object.entries(out))out[k]={x:+(v.xs.reduce((a,b)=>a+b,0)/v.xs.length).toFixed(3),y:+(v.ys.reduce((a,b)=>a+b,0)/v.ys.length).toFixed(3),wheels:v.wheels};return out;}
  // A spot the robot was driven to and measured with a tape: how far off the reading is.
  const spotError=(real,read)=>Math.hypot(read.x-real.x,read.y-real.y);
  const PASS_IN=1;
  const api={chassisOf,missing,measures,tracker,spotError,driveKeys,wheelSlots,PASS_IN,DRIVE_KEYS};
  if(typeof module==='object'&&module.exports){module.exports=api;return;}

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const f=(v,d=1)=>Number.isFinite(v)?(+v).toFixed(d):'—';
  // opts: box, debug (running, start, values, listen), project(), save(), C (DeckSimConfig), devices() (DeckLinks.devices), cpr(), toElectronics(), toSimulate()
  function create(opts){
    const {box,debug}=opts,p=()=>opts.project(),rec=()=>{const c=p().calibration||(p().calibration={});return c.chassis||(c.chassis={});};
    let track=null,trail=[],pose=null,off=null,queued=false;
    const ch=()=>chassisOf(p(),opts.C,{cpr:opts.cpr?.()||537.7});
    const live=()=>!!debug?.running?.();
    const links=()=>(p().calibration?.links||[]);
    // The links that touch the chassis: a drive motor moving something, or a position sensor moved.
    function chassisLinks(c){const motors=new Set(c.motors.map(m=>m.name)),sensors=new Set([c.imu,c.pinpoint,c.otos,...c.pods.map(x=>x.name)]);
      return links().filter(l=>l.causes?.some(x=>motors.has(x.name))||sensors.has(String(l.effect?.key||'').split(':')[1]));}
    function states(c,devs){const r=rec(),gone=missing(c,devs),ls=chassisLinks(c),wired=ls.length>0&&ls.every(l=>l.result?.state==='pass');
      const s1=r.confirmed?'pass':'todo',s2=s1!=='pass'?'locked':wired?'pass':'todo',s3=s2!=='pass'?'locked':r.placed?'pass':'todo';return {gone,ls,s:[s1,s2,s3]};}
    const pill=s=>`<span class="rs-pill ${s==='pass'?'ok':s==='locked'?'':'warn'}">${s==='pass'?'Done':s==='locked'?'Locked':'To do'}</span>`;
    function field(){const P=pose,W=144,trailPts=trail.map(q=>`${f(-q.y,2)},${f(-q.x,2)}`).join(' ');
      const grid=Array.from({length:7},(_,i)=>-72+i*24).map(g=>`<line x1="${g}" y1="-72" x2="${g}" y2="72"/><line x1="-72" y1="${g}" x2="72" y2="${g}"/>`).join('');
      const bot=P&&Number.isFinite(P.x)?`<g transform="translate(${f(-P.y,2)} ${f(-P.x,2)}) rotate(${f(-P.h,2)})"><rect x="-9" y="-9" width="18" height="18" rx="2" class="cal-fieldmap-bot"/><path d="M0 -9L-5 -1H5z" class="cal-fieldmap-nose"/></g>`:'';
      return `<svg class="cal-fieldmap" viewBox="${-W/2-2} ${-W/2-2} ${W+4} ${W+4}" role="img" aria-label="The field from the zero point: robot ${P?`${f(P.x)} in forward, ${f(P.y)} in left, heading ${f(P.h)}°`:'not zeroed'}"><g class="cal-fieldmap-grid">${grid}</g><circle r="2" class="cal-fieldmap-zero"/>${trail.length>1?`<polyline points="${trailPts}" class="cal-fieldmap-trail"/>`:''}${bot}</svg>`;}
    function paint(){if(!box)return;const c=ch(),devs=opts.devices(),{gone,ls,s}=states(c,devs),r=rec(),what=measures(c),moving=!!track?.zeroed;
      const step=(n,title,state,body)=>`<li class="cal-chassis-step" data-chassis-step="${n}" data-state="${state}"><div class="cal-hub-head"><h4>${n} · ${esc(title)}</h4>${pill(state)}</div>${state==='locked'?'<p class="hint">Finish the step before it first.</p>':body}</li>`;
      const b1=`<p>Simulate says a <b>${esc(c.name)}</b> on ${c.motors.map(m=>`<code>${esc(m.name)}</code>`).join(', ')}, with <b>${esc(c.locName)}</b> to know where it is.</p>
        ${gone.length?`<p class="cal-sense-note bad">Not on the robot: ${gone.map(esc).join(', ')}. In Simulate → Setup, pick the drivetrain, position sensing and names this robot really has, or Set up from the Control Hub in Electronics.</p>`:devs.actuators.length?'<p class="hint">Every one of them is on the robot.</p>':'<p class="hint">Read the Control Hub in Electronics to see these on the robot.</p>'}
        <div class="button-row">${r.confirmed?'':`<button type="button" class="primary" data-chassis="confirm"${gone.length||!devs.actuators.length?' disabled':''}>Yes, that's the chassis</button>`}<button type="button" class="secondary" data-chassis="to-sim">Change it in Simulate</button></div>`;
      const b2=`<p class="hint">Electronics checks which way each drive motor turns its encoder${c.loc==='encoders'?'':' and what each position sensor reads when the robot moves'}. ${ls.length?`${ls.filter(l=>l.result?.state==='pass').length} of ${ls.length} chassis link${ls.length===1?'':'s'} work.`:'There are no links on the chassis yet.'}</p>
        <ul class="cal-sense-rows">${ls.map(l=>`<li>${l.result?.state==='pass'?'<span class="rs-pill ok">Works</span>':`<span class="rs-pill warn">${l.result?'Fix it':'Not checked'}</span>`} ${esc(window.DeckLinks?.sentence(l,devs)||l.id)}</li>`).join('')}</ul>
        <div class="button-row"><button type="button" class="primary" data-chassis="to-elec">Check them in Electronics</button></div>`;
      const spots=r.spots||[],lastSpot=spots.at(-1);
      const b3=what==='nothing'?'<p class="hint">Nothing on this robot measures where it is: add odometry pods, a Pinpoint or an OTOS in Simulate → Setup.</p>':
        `<p class="hint">Put the robot on the field, lined up with a tile seam, and press Set zero here: that spot is (0, 0) facing 0°. Then drive or push it around: the map follows it from its sensors (${esc(c.locName)}).${what==='heading'?' This robot only measures its heading.':''}</p>
        ${live()?'':'<div class="button-row"><button type="button" class="primary" data-chassis="live">Start live readings</button></div>'}
        <div class="cal-chassis-map">${field()}<div class="cal-chassis-now"><dl class="cal-stats"><div><dt>Forward</dt><dd data-chassis-now="x">${f(pose?.x)} in</dd></div><div><dt>Left</dt><dd data-chassis-now="y">${f(pose?.y)} in</dd></div><div><dt>Heading</dt><dd data-chassis-now="h">${f(pose?.h)}°</dd></div></dl>
          <div class="button-row"><button type="button" class="secondary" data-chassis="zero"${live()?'':' disabled'}>${moving?'Set zero again':'Set zero here'}</button>${trail.length>1?'<button type="button" class="secondary" data-chassis="clear">Clear the trail</button>':''}</div>
          ${what==='position'?`<p class="hint">Drive it to a spot you can measure from the zero, then type where it really is.</p><div class="cal-fields"><div class="cal-field"><label for="cal-spot-x">Really forward · in</label><input id="cal-spot-x" type="number" step="0.5" data-slider="off" value="${esc(r.draftX??'')}"></div><div class="cal-field"><label for="cal-spot-y">Really left · in</label><input id="cal-spot-y" type="number" step="0.5" data-slider="off" value="${esc(r.draftY??'')}"></div></div>
          <div class="button-row"><button type="button" class="secondary" data-chassis="spot"${moving?'':' disabled'}>Compare</button></div>`:''}
          ${lastSpot?`<p class="${spotError(lastSpot.real,lastSpot.read)<=PASS_IN?'hint':'cal-sense-note bad'}">It read ${f(lastSpot.read.x)}, ${f(lastSpot.read.y)} for ${f(lastSpot.real.x)}, ${f(lastSpot.real.y)}: ${f(spotError(lastSpot.real,lastSpot.read),2)} in off.${spotError(lastSpot.real,lastSpot.read)<=PASS_IN?'':' More than an inch: calibrate the heading and pods in Electronics, or check the wheel size in Simulate.'}</p>`:''}
          <div class="button-row">${r.placed?'':`<button type="button" class="primary" data-chassis="placed"${what==='position'?(lastSpot&&spotError(lastSpot.real,lastSpot.read)<=PASS_IN?'':' disabled'):moving?'':' disabled'}>Where it is looks right</button>`}</div></div></div>`;
      const html=`<section class="cal-card cal-chassis"><div class="cal-hub-head"><h2>Chassis</h2>${s.every(x=>x==='pass')?'<span class="rs-pill ok">Calibrated</span>':''}</div><p class="hint">The chassis comes first, from what Simulate says it is, calibrated with the real robot’s electronics and sensors.</p><ol class="cal-chassis-steps">${step(1,'This is the chassis',s[0],b1)}${step(2,'Wiring and directions',s[1],b2)}${step(3,'Where it is on the field',s[2],b3)}</ol></section>`;
      if(box.dataset.html===html)return;const focus=document.activeElement?.id;box.dataset.html=html;box.innerHTML=html;if(focus)document.getElementById(focus)?.focus();}
    // Live: the pose follows every reading; the map redraws once a frame at most.
    function follow(){if(off||!debug?.listen)return;off=debug.listen((_f,v)=>{if(!track?.zeroed)return;const q=track.update(v);if(!q)return;pose=q;const last=trail.at(-1);if(Number.isFinite(q.x)&&(!last||Math.hypot(q.x-last.x,q.y-last.y)>.5)){trail.push({x:q.x,y:q.y});if(trail.length>600)trail.shift();}
      if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;paint();});}});}
    const save=()=>{opts.save();paint();};
    box?.addEventListener('input',e=>{const r=rec();if(e.target.id==='cal-spot-x')r.draftX=e.target.value;if(e.target.id==='cal-spot-y')r.draftY=e.target.value;});
    box?.addEventListener('click',e=>{const b=e.target.closest('[data-chassis]');if(!b)return;const r=rec(),a=b.dataset.chassis;
      if(a==='confirm'){r.confirmed=new Date().toISOString();return save();}
      if(a==='to-sim')return opts.toSimulate?.();if(a==='to-elec')return opts.toElectronics?.();if(a==='live')return void debug?.start?.();
      if(a==='zero'){track=tracker(ch());if(!track.zero(debug.values()))return void(b.textContent='No readings yet: try again');pose={x:0,y:0,h:0};trail=[{x:0,y:0}];delete r.placed;follow();return save();}
      if(a==='clear'){trail=pose&&Number.isFinite(pose.x)?[{x:pose.x,y:pose.y}]:[];return paint();}
      if(a==='spot'){const x=+r.draftX,y=+r.draftY;if(!pose||!Number.isFinite(x)||!Number.isFinite(y))return;r.spots=[...(r.spots||[]),{real:{x,y},read:{x:+pose.x.toFixed(2),y:+pose.y.toFixed(2),h:+pose.h.toFixed(1)},at:new Date().toISOString()}].slice(-10);return save();}
      if(a==='placed'){r.placed=new Date().toISOString();return save();}});
    return {refresh:paint};}
  root.DeckChassisCal={...api,create};
})(typeof globalThis==='object'?globalThis:this);
