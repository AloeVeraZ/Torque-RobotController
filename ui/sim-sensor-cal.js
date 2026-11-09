'use strict';
// Calibrate → Electronics: the robot's position sensing, measured on the floor and corrected. Torque Debug streams the
// readings (the hub IMU's yaw, the Pinpoint's raw pod counts and heading, the OTOS's pose, a pod's encoder on its motor
// port); the team pushes or turns the robot by hand against the tile seams; this works out the error and the setting
// that cancels it, and keeps it only when they press Use.
// Frame (Road Runner, Pedro, Deck): x forward, y left, heading counterclockwise. A spin in place moves a forward pod at
// y (left of centre) by -y·Δθ and a strafe pod at x (forward of centre) by +x·Δθ, so y = -Δd/Δθ and x = +Δd/Δθ.
(function(root){
  // ---- the maths, pure (tests/sensor-cal.test.cjs) ----
  const TURNS=10,PUSH_IN=48,MM=25.4;
  // Pass marks. No maker publishes these; they are what keeps a 30 s autonomous within about an inch and a degree.
  const PASS={driftPerMin:.5,headingPct:.1,distancePct:1,offsetIn:.25};
  const wrap=d=>((d+180)%360+360)%360-180;
  // Follows a heading through every wrap at ±180°: the total turned, in degrees.
  function unwrapper(){let last=null,total=0;return {add(h){if(!Number.isFinite(h))return total;if(last!==null)total+=wrap(h-last);last=h;return total;},get total(){return total;}};}
  // Held still: how far the heading wandered, in degrees a minute.
  const drift=(turned,ms)=>ms>0?turned/(ms/60000):NaN;
  // Turned `turns` whole turns counterclockwise, it read `measured` degrees: what to multiply its heading by.
  function headingScale(measured,turns=TURNS){const actual=360*turns;if(!(Math.abs(measured)>actual*.5))return null;return {scale:actual/Math.abs(measured),errorDeg:Math.abs(measured)-actual,errorPct:(Math.abs(measured)-actual)/actual*100,backwards:measured<0};}
  // Pushed `actual` inches, a pod read `measured` inches (sign as it counts now): whether it counts backwards, and its scale.
  function push(measured,actual=PUSH_IN){if(!(Math.abs(measured)>actual*.25))return null;return {backwards:measured<0,scale:actual/Math.abs(measured),errorPct:(Math.abs(measured)-actual)/actual*100};}
  // Spun in place by `radians` (counterclockwise positive): where a pod sits, from how far it rolled (inches, sign as it counts now).
  const forwardPodY=(rolled,radians)=>-rolled/radians,strafePodX=(rolled,radians)=>rolled/radians;
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const api={TURNS,PUSH_IN,PASS,wrap,unwrapper,drift,headingScale,push,forwardPodY,strafePodX};
  if(typeof module==='object'&&module.exports){module.exports=api;return;}

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const f=(v,d=2)=>Number.isFinite(v)?(+v).toFixed(d):'—';
  // opts: box, debug (DeckLiveDebug), project(), save(), odometry() (DeckSimConfig.odometryOf the robot), podTicks (per inch), podTypes (ticks per mm by Pinpoint pod).
  function create(opts){
    const {box,debug}=opts;let test=null,results={};const C=()=>globalThis.DeckSimConfig;
    const p=()=>opts.project(),loc=()=>p().sensors?.localization,dev=k=>p().robot?.devices?.[k]?.name;
    // The heading the robot's own code steers by: the Pinpoint's or the OTOS's own IMU, or the Control Hub's.
    const headingSource=()=>loc()==='fused'?{key:`i:${dev('pinpoint')||'pinpoint'}:h`,what:'the Pinpoint’s IMU',kind:'pinpoint'}:loc()==='optical'?{key:`i:${dev('otos')||'sensor_otos'}:h`,what:'the OTOS’s IMU',kind:'otos'}:C()?.sensors?.[loc()]?.imu===false?null:{key:`i:${dev('imu')||'imu'}:yaw`,what:'the Control Hub’s IMU',kind:'hub'};
    const PODS={odometry:[['par','forward'],['perp','strafe']],odometry3:[['par_left','forward'],['par_right','forward'],['perp','strafe']]};
    const pods=()=>(PODS[loc()]||[]).map(([key,axis])=>({key,axis,name:dev(key)||key}));
    const v=()=>debug?.values?.()||{};
    const live=()=>!!debug?.running?.();
    // What a pod has rolled, in inches as the robot's code would count it now (its direction and scale as set).
    const podInches=(key,ticks)=>{const o=opts.odometry().pods[key]||{};return ticks*(o.reversed?-1:1)/opts.podTicks*(o.scale||1);};
    const ppInches=(axis,ticks)=>{const o=opts.odometry().pinpoint;return ticks*(o[axis==='x'?'xReversed':'yReversed']?-1:1)/opts.podTypes[o.pods]/MM;};
    function snapshot(){const r=v(),out={};for(const d of pods())out[d.key]=r[`m:${d.name}:pos`];if(loc()==='fused'){const n=dev('pinpoint')||'pinpoint';out.ex=r[`i:${n}:ex`];out.ey=r[`i:${n}:ey`];}if(loc()==='optical'){const n=dev('otos')||'sensor_otos';out.ox=r[`i:${n}:x`];out.oy=r[`i:${n}:y`];}return out;}
    // ---- the tests: each records from Start to Done, following the heading through every reading
    function begin(kind){const h=headingSource();if(!live())return;const u=unwrapper();const first=v()[h?.key];if(h)u.add(first);
      test={kind,at:performance.now(),start:snapshot(),turn:u,off:debug.listen((_f,vals)=>{if(h)u.add(vals[h.key]);if(kind==='still'&&performance.now()-test.at>=30000)finish();else paintTest();})};paint();}
    function cancel(){test?.off?.();test=null;paint();}
    function finish(){if(!test)return;const t=test;t.off?.();test=null;const ms=performance.now()-t.at,end=snapshot(),turned=t.turn.total,rad=turned*Math.PI/180,d=k=>(end[k]??NaN)-(t.start[k]??NaN),h=headingSource();
      if(t.kind==='still')results.still={perMin:drift(turned,ms),what:h?.what};
      if(t.kind==='turns'){const s=headingScale(turned);results.turns=s?{...s,what:h?.what,kind:h?.kind}:{problem:`It read ${f(turned,0)}°, far from ${TURNS} turns. Press Start, turn it ${TURNS} times counterclockwise, then press Done.`};}
      if(t.kind==='forward'||t.kind==='left'){const along=t.kind==='forward'?'forward':'strafe',out=[];
        for(const pd of pods()){if(pd.axis!==along)continue;const r=push(podInches(pd.key,d(pd.key)));out.push({key:pd.key,name:pd.name,...(r||{problem:`“${pd.name}” hardly counted. Is its encoder cable in the motor port named “${pd.name}”?`})});}
        if(loc()==='fused'){const axis=t.kind==='forward'?'x':'y',r=push(ppInches(axis,d(axis==='x'?'ex':'ey')));out.push({key:'pinpoint-'+axis,name:`Pinpoint ${axis.toUpperCase()} pod`,axis,...(r||{problem:`The Pinpoint’s ${axis.toUpperCase()} pod hardly counted. Check its cable in the Pinpoint’s ${axis.toUpperCase()} port.`})});}
        if(loc()==='optical'){const r=push(Math.hypot(d('ox'),d('oy')));out.push({key:'otos',name:'OTOS',...(r||{problem:'The OTOS hardly moved. It needs to sit 10 to 27 mm above the tiles.'})});}
        results[t.kind]=out;}
      if(t.kind==='spin'){if(Math.abs(turned)<300){results.spin={problem:'Spin it at least one whole turn in place, counterclockwise.'};}
        else{const out=[];for(const pd of pods()){const rolled=podInches(pd.key,d(pd.key));out.push({key:pd.key,name:pd.name,axis:pd.axis,at:pd.axis==='forward'?forwardPodY(rolled,rad):strafePodX(rolled,rad)});}
          if(loc()==='fused'){out.push({key:'xOffset',name:'Pinpoint X (forward) pod',axis:'forward',at:forwardPodY(ppInches('x',d('ex')),rad)},{key:'yOffset',name:'Pinpoint Y (strafe) pod',axis:'strafe',at:strafePodX(ppInches('y',d('ey')),rad)});}
          results.spin={turned,rows:out};}}
      paint();}
    // ---- what Use writes into the setup: only into the robot's odometry, where Simulate and every export read it
    function use(kind){const o=JSON.parse(JSON.stringify(p().robot.odometry||{})),r=results[kind];if(!r)return;
      if(kind==='turns'&&r.scale){if(r.kind==='otos'){o.otos={...o.otos,angularScalar:clamp((opts.odometry().otos.angularScalar||1)*r.scale,.872,1.127)};}else if(r.kind==='hub'){o.imu={...o.imu,scale:(opts.odometry().imu?.scale||1)*r.scale};}}
      if(kind==='forward'||kind==='left')for(const x of r){if(x.problem)continue;
        if(x.key==='otos'){o.otos={...o.otos,linearScalar:clamp((opts.odometry().otos.linearScalar||1)*x.scale,.872,1.127)};continue;}
        if(x.key.startsWith('pinpoint-')){const k=x.axis==='x'?'xReversed':'yReversed';if(x.backwards)o.pinpoint={...o.pinpoint,[k]:!opts.odometry().pinpoint[k]};continue;}
        const now=opts.odometry().pods[x.key]||{};o.pods={...o.pods,[x.key]:{...o.pods?.[x.key],...(x.backwards?{reversed:!now.reversed}:{}),scale:(now.scale||1)*x.scale}};}
      if(kind==='spin'&&r.rows)for(const x of r.rows){const at=+x.at.toFixed(3);
        if(x.key==='xOffset'||x.key==='yOffset'){o.pinpoint={...o.pinpoint,[x.key]:at};continue;}
        o.pods={...o.pods,[x.key]:{...o.pods?.[x.key],[x.axis==='forward'?'y':'x']:at}};}
      p().robot.odometry=o;opts.save();results[kind]={...r,used:true};paint();}
    // ---- drawing
    const pass=ok=>`<span class="rs-pill ${ok?'ok':'warn'}">${ok?'Good':'Correct it'}</span>`;
    function resultHtml(kind){const r=results[kind];if(!r)return '';if(r.problem)return `<p class="cal-sense-note bad">${esc(r.problem)}</p>`;
      const used=r.used?'<p class="hint">Used: saved to this setup. Send the code to the robot again to put it on.</p>':'';
      if(kind==='still')return `<p class="cal-sense-result">${pass(Math.abs(r.perMin)<=PASS.driftPerMin)} Drifts <b>${f(Math.abs(r.perMin))}°</b> a minute while still. ${Math.abs(r.perMin)<=PASS.driftPerMin?'Over a 30 s autonomous that is nothing to correct.':'Keep the robot completely still while the op mode initializes; if it stays above 0.5° a minute, the hub may be mounted where it vibrates.'}</p>`;
      if(kind==='turns'){const ok=Math.abs(r.errorPct)<=PASS.headingPct;const fix=r.kind==='pinpoint'?(r.scale<.95||r.scale>1.05?'goBILDA tunes every Pinpoint at the factory; this far off, contact goBILDA.':'goBILDA tunes the Pinpoint at the factory, so Torque leaves it.'):r.kind==='otos'?`Use sets the OTOS’s angular scalar to ${f(clamp((opts.odometry().otos.angularScalar||1)*r.scale,.872,1.127),4)}.`:`Use makes the robot’s code multiply the IMU’s heading by ${f((opts.odometry().imu?.scale||1)*r.scale,5)}.`;
        return `<p class="cal-sense-result">${pass(ok)} ${TURNS} turns read <b>${f(360*TURNS+r.errorDeg,1)}°</b>: ${f(Math.abs(r.errorDeg),1)}° ${r.errorDeg>0?'too many':'too few'} (${f(Math.abs(r.errorPct),3)}%).${r.backwards?' It counted clockwise: check how the hub is mounted in Setup.':''} ${esc(fix)}</p>${!ok&&r.kind!=='pinpoint'&&!r.used?`<button type="button" class="primary" data-sense-use="turns">Use</button>`:''}${used}`;}
      if(kind==='forward'||kind==='left'){const rows=r.map(x=>x.problem?`<li class="bad">${esc(x.problem)}</li>`:`<li>${pass(!x.backwards&&Math.abs(x.errorPct)<=PASS.distancePct)} <b>${esc(x.name)}</b>: ${x.backwards?'counts backwards (Use flips it), ':''}${f(Math.abs(x.errorPct),2)}% ${x.errorPct>0?'long':'short'}${x.key.startsWith('pinpoint-')?' (the Pinpoint’s pod size is fixed; a few % means a worn wheel or the wrong pod type in Setup)':''}</li>`).join('');
        const any=r.some(x=>!x.problem&&(x.backwards||!x.key.startsWith('pinpoint-')&&Math.abs(x.errorPct)>PASS.distancePct));
        return `<ul class="cal-sense-rows">${rows}</ul>${any&&!r.used?`<button type="button" class="primary" data-sense-use="${kind}">Use</button>`:''}${used}`;}
      if(kind==='spin'){const now=opts.odometry(),was=x=>x.key==='xOffset'||x.key==='yOffset'?now.pinpoint[x.key]:now.pods[x.key]?.[x.axis==='forward'?'y':'x'];
        const rows=r.rows.map(x=>{const off=Math.abs(x.at-was(x))>PASS.offsetIn;return `<li>${pass(!off)} <b>${esc(x.name)}</b>: ${f(Math.abs(x.at))} in ${x.axis==='forward'?(x.at>=0?'left':'right'):(x.at>=0?'forward':'behind')} of centre (Setup has ${f(was(x))})</li>`;}).join('');
        return `<p class="hint">Turned ${f(r.turned/360,2)} times.</p><ul class="cal-sense-rows">${rows}</ul>${r.rows.some(x=>Math.abs(x.at-was(x))>PASS.offsetIn)&&!r.used?'<button type="button" class="primary" data-sense-use="spin">Use</button>':''}${used}`;}
      return '';}
    const STEPS={still:['Hold still','Leave the robot untouched on the floor for 30 s: how far its heading wanders on its own.','Start'],
      turns:[`Turn it ${TURNS} times`,`Line a side of the robot up with a tile seam, press Start, turn it by hand ${TURNS} whole turns counterclockwise, line it up with the same seam, then press Done.`,'Start'],
      forward:['Push it forward',`Line the back of the robot up with a tile seam, press Start, push it straight forward ${PUSH_IN} in (two tiles), then press Done.`,'Start'],
      left:['Push it left',`Line a side up with a tile seam, press Start, push it straight left ${PUSH_IN} in (two tiles) without turning, then press Done.`,'Start'],
      spin:['Spin it in place','Press Start, turn it on the spot counterclockwise a few whole turns (5 is plenty), keeping its centre where it was, then press Done.','Start']};
    function stepHtml(kind){const [title,how,go]=STEPS[kind],on=test?.kind===kind;
      return `<li class="cal-sense-step" data-sense-step="${kind}"><div><h4>${esc(title)}</h4><p class="hint">${esc(how)}</p><div class="button-row">${on?`${kind==='still'?'':`<button type="button" class="primary" data-sense-done>Done</button>`}<button type="button" class="secondary" data-sense-cancel>Cancel</button><span class="hint" data-sense-live></span>`:`<button type="button" class="secondary" data-sense-go="${kind}"${!live()||test?' disabled':''}>${go}</button>`}</div>${on?'':resultHtml(kind)}</div></li>`;}
    function paint(){if(!box)return;const h=headingSource(),odo=!!PODS[loc()]||loc()==='fused'||loc()==='optical';
      const need=!live()?`<section class="cal-card cal-sense-live"><div><h2>Live readings</h2><p class="hint">Every step below reads the robot as you move it, through Torque Debug.</p></div><button type="button" class="primary" data-sense-start>Start live readings</button></section>`:'';
      const heading=h?`<section class="cal-card"><h2>Heading · ${esc(h.what)}</h2><p class="hint">Every turn and position the robot works out goes through its heading. ${h.kind==='hub'?'The Control Hub’s IMU has no calibration of its own, so its error is measured here and the robot’s code corrects it.':h.kind==='pinpoint'?'goBILDA tunes the Pinpoint’s at the factory; this checks it.':'Its angular scalar corrects it.'}</p><ol class="cal-sense-steps">${stepHtml('still')}${stepHtml('turns')}</ol></section>`:'';
      const position=odo?`<section class="cal-card"><h2>Position · ${esc(loc()==='fused'?'Pinpoint pods':loc()==='optical'?'OTOS':`${pods().length} odometry pods`)}</h2><p class="hint">Direction and distance from straight pushes, then ${loc()==='optical'?'nothing more: the OTOS’s place comes from Setup':'where each pod sits, from a spin in place'}. Do Heading first: the spin uses it.</p><ol class="cal-sense-steps">${stepHtml('forward')}${stepHtml('left')}${loc()==='optical'?'':stepHtml('spin')}</ol></section>`:
        `<section class="cal-card"><h2>Position</h2><p class="hint">${loc()==='encoders'?'This robot counts its position with its drive motors’ encoders: they need no calibration beyond the heading.':'This robot has nothing measuring its position to calibrate.'}</p></section>`;
      const html=need+heading+position;if(box.dataset.html!==html){box.dataset.html=html;box.innerHTML=html;}paintTest();}
    function paintTest(){const s=box?.querySelector('[data-sense-live]');if(!s||!test)return;const secs=(performance.now()-test.at)/1000;s.textContent=test.kind==='still'?`${Math.max(0,30-secs).toFixed(0)} s left · ${f(test.turn.total)}°`:`Turned ${f(test.turn.total,1)}°`;}
    box?.addEventListener('click',e=>{const t=e.target.closest('button');if(!t)return;
      if(t.dataset.senseGo)begin(t.dataset.senseGo);else if(t.hasAttribute('data-sense-done'))finish();else if(t.hasAttribute('data-sense-cancel'))cancel();else if(t.dataset.senseUse)use(t.dataset.senseUse);else if(t.hasAttribute('data-sense-start'))void debug?.start?.();});
    return {refresh:paint,stop:cancel};}
  root.DeckSensorCal={...api,create};
})(typeof globalThis==='object'?globalThis:this);
