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
  const LINE_UP_DEG=.3;
  // The turn check finishes by itself: the robot has turned (a whole turn or more, 300° to allow for the IMU's error) and
  // then stood still, within a third of a degree for a second and a half. samples: [[ms, degrees turned so far]].
  function atRest(samples,{turned=300,ms=1500,within=.3}={}){const n=samples?.length||0;if(n<2)return false;const [end,total]=samples[n-1];if(Math.abs(total)<turned||end-samples[0][0]<ms)return false;
    let lo=total,hi=total;for(let i=n-1;i>=0&&end-samples[i][0]<=ms;i--){lo=Math.min(lo,samples[i][1]);hi=Math.max(hi,samples[i][1]);}return hi-lo<=within;}
  function headingScale(measured,turns){const m=Math.abs(measured);turns=turns||Math.round(m/360);if(!(turns>=1)||!(m>360*turns*.5))return null;const actual=360*turns;
    return {turns,scale:actual/m,errorDeg:m-actual,errorPct:(m-actual)/actual*100,tolerancePct:Math.max(PASS.headingPct,LINE_UP_DEG/actual*100),backwards:measured<0};}
  // Pushed `actual` inches, a pod read `measured` inches (sign as it counts now): whether it counts backwards, and its scale.
  function push(measured,actual=PUSH_IN){if(!(Math.abs(measured)>actual*.25))return null;return {backwards:measured<0,scale:actual/Math.abs(measured),errorPct:(Math.abs(measured)-actual)/actual*100};}
  // Spun in place by `radians` (counterclockwise positive): where a pod sits, from how far it rolled (inches, sign as it counts now).
  const forwardPodY=(rolled,radians)=>-rolled/radians,strafePodX=(rolled,radians)=>rolled/radians;
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const api={TURNS,PUSH_IN,PASS,wrap,unwrapper,drift,headingScale,atRest,push,forwardPodY,strafePodX};
  if(typeof module==='object'&&module.exports){module.exports=api;return;}

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const f=(v,d=2)=>Number.isFinite(v)?(+v).toFixed(d):'—';
  // opts: box, debug (DeckLiveDebug), project(), save(), odometry() (DeckSimConfig.odometryOf the robot), podTicks (per inch), podTypes (ticks per mm by Pinpoint pod).
  function create(opts){
    const {box,debug}=opts;let test=null,results={},mounting=null,mountOff=null,mountSaid='',mountTried=false,driftOff=null,driftAt=0,driftTurn=null,driftFor=null;const C=()=>globalThis.DeckSimConfig;
    const saved=()=>{const c=p().calibration||(p().calibration={}),ch=c.chassis||(c.chassis={});return ch;};
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
      const seen=[];test={kind,at:performance.now(),start:snapshot(),turn:u,off:debug.listen((_f,vals)=>{if(h)u.add(vals[h.key]);
        // The turn check ends itself once the robot has turned and is still again, flat against the wall.
        if(kind==='turns'){const now=performance.now();seen.push([now,u.total]);while(seen.length>2&&now-seen[0][0]>2500)seen.shift();if(atRest(seen))return finish();}
        if(kind==='still'&&performance.now()-test.at>=30000)finish();else paintTest();})};paint();}
    // Drift, in the background: whenever live readings come, the heading is followed; 30 s in which it moved less than 3°
    // (the robot was not turned; pods spinning on blocks do not turn it) is the result, kept with the setup. A real turn
    // starts the 30 s again. It runs alongside every other check, and nothing is pressed.
    const DRIFT_MS=30000,DRIFT_TURNED=3;
    function driftWatch(){const h=headingSource();if(!h||!live()||!debug?.listen||driftOff||saved().drift?.key===h.key)return;driftFor=h.key;
      const restart=()=>{driftTurn=unwrapper();driftAt=performance.now();};restart();
      driftOff=debug.listen((_f,vals)=>{const y=vals[h.key];if(!Number.isFinite(y))return;driftTurn.add(y);if(Math.abs(driftTurn.total)>DRIFT_TURNED)return restart();
        const ms=performance.now()-driftAt;if(ms>=DRIFT_MS){saved().drift={key:h.key,perMin:drift(driftTurn.total,ms),what:h.what,at:new Date().toISOString()};driftOff?.();driftOff=null;opts.save();return paint();}
        const el=box?.querySelector('[data-sense-drift]');if(el)el.textContent=`Measuring in the background: ${Math.floor(ms/1000)} of 30 s`;});}
    function cancel(){test?.off?.();test=null;paint();}
    function finish(){if(!test)return;const t=test;t.off?.();test=null;const ms=performance.now()-t.at,end=snapshot(),turned=t.turn.total,rad=turned*Math.PI/180,d=k=>(end[k]??NaN)-(t.start[k]??NaN),h=headingSource();
      if(t.kind==='still')results.still={perMin:drift(turned,ms),what:h?.what};
      if(t.kind==='turns'){const s=headingScale(turned);results.turns=s?{...s,what:h?.what,kind:h?.kind}:{problem:`It read only ${f(turned,0)}°. Press Start, spin it at least one whole turn, either way round, and push it flat against the wall again.`};}
      if(t.kind==='forward'||t.kind==='left'){const along=t.kind==='forward'?'forward':'strafe',out=[];
        for(const pd of pods()){if(pd.axis!==along)continue;const r=push(podInches(pd.key,d(pd.key)));out.push({key:pd.key,name:pd.name,...(r||{problem:`“${pd.name}” hardly counted. Check that its encoder cable is in the motor port named “${pd.name}”.`})});}
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
    function resultHtml(kind){const r=kind==='still'?saved().drift||results.still:results[kind];if(!r)return '';if(r.problem)return `<p class="cal-sense-note bad">${esc(r.problem)}</p>`;
      const used=r.used?'<p class="hint">Saved to this setup. Send your code to the robot again to use it there.</p>':'';
      if(kind==='still')return `<p class="cal-sense-result">${pass(Math.abs(r.perMin)<=PASS.driftPerMin)} Drifts <b>${f(Math.abs(r.perMin))}°</b> a minute while still. ${Math.abs(r.perMin)<=PASS.driftPerMin?'Over a 30 s autonomous that is nothing to correct.':'Keep the robot completely still while the op mode initializes; if it stays above 0.5° a minute, the hub may be mounted where it vibrates.'}</p>`;
      if(kind==='turns'){const ok=Math.abs(r.errorPct)<=(r.tolerancePct??PASS.headingPct),n=r.turns||TURNS;const fix=r.kind==='pinpoint'?(r.scale<.95||r.scale>1.05?'goBILDA tunes every Pinpoint at the factory; this far off, contact goBILDA.':'goBILDA tunes the Pinpoint at the factory, so Torque leaves it.'):r.kind==='otos'?`Use sets the OTOS’s angular scalar to ${f(clamp((opts.odometry().otos.angularScalar||1)*r.scale,.872,1.127),4)}.`:`Use makes the robot’s code multiply the IMU’s heading by ${f((opts.odometry().imu?.scale||1)*r.scale,5)}.`;
        return `<p class="cal-sense-result">${pass(ok)} ${n===1?'One turn':`${n} turns`} ${r.backwards?'clockwise':'counterclockwise'} read <b>${f(360*n+r.errorDeg,1)}°</b>: ${f(Math.abs(r.errorDeg),1)}° ${r.errorDeg>0?'too many':'too few'} (${f(Math.abs(r.errorPct),2)}%).If you spun it the other way, the hub’s mounting in Setup is wrong. ${ok?`That is as close as squaring it against a wall can tell${n<3?'; spin it more times for a finer check':''}.`:esc(fix)}</p>${!ok&&r.kind!=='pinpoint'&&!r.used?`<button type="button" class="primary" data-sense-use="turns">Use</button>`:''}${used}`;}
      if(kind==='forward'||kind==='left'){const rows=r.map(x=>x.problem?`<li class="bad">${esc(x.problem)}</li>`:`<li>${pass(!x.backwards&&Math.abs(x.errorPct)<=PASS.distancePct)} <b>${esc(x.name)}</b>: ${x.backwards?'counts backwards (Use flips it), ':''}${f(Math.abs(x.errorPct),2)}% ${x.errorPct>0?'long':'short'}${x.key.startsWith('pinpoint-')?' (the Pinpoint’s pod size is fixed, so a few percent off means a worn wheel or the wrong pod type in Setup)':''}</li>`).join('');
        const any=r.some(x=>!x.problem&&(x.backwards||!x.key.startsWith('pinpoint-')&&Math.abs(x.errorPct)>PASS.distancePct));
        return `<ul class="cal-sense-rows">${rows}</ul>${any&&!r.used?`<button type="button" class="primary" data-sense-use="${kind}">Use</button>`:''}${used}`;}
      if(kind==='spin'){const now=opts.odometry(),was=x=>x.key==='xOffset'||x.key==='yOffset'?now.pinpoint[x.key]:now.pods[x.key]?.[x.axis==='forward'?'y':'x'];
        const rows=r.rows.map(x=>{const off=Math.abs(x.at-was(x))>PASS.offsetIn;return `<li>${pass(!off)} <b>${esc(x.name)}</b>: ${f(Math.abs(x.at))} in ${x.axis==='forward'?(x.at>=0?'left':'right'):(x.at>=0?'forward':'behind')} of centre (Setup has ${f(was(x))})</li>`;}).join('');
        return `<p class="hint">Turned ${f(r.turned/360,2)} times.</p><ul class="cal-sense-rows">${rows}</ul>${r.rows.some(x=>Math.abs(x.at-was(x))>PASS.offsetIn)&&!r.used?'<button type="button" class="primary" data-sense-use="spin">Use</button>':''}${used}`;}
      return '';}
    const STEPS={still:['Hold still','Leave the robot untouched on the floor for 30 s: how far its heading wanders on its own.','Start'],
      turns:['Spin it off a wall','Push one side of the robot flat against a wall and press Start. Pull it out, spin it one whole turn or more, either way round and any way you like, and push the same side flat against the wall again. Torque counts the turns and finishes by itself once it is still.','Start'],
      forward:['Push it forward',`Line the back of the robot up with a tile seam, press Start, push it straight forward ${PUSH_IN} in (two tiles), then press Done.`,'Start'],
      left:['Push it left',`Line one side up with a tile seam, press Start, push it straight left ${PUSH_IN} in (two tiles) without turning, then press Done.`,'Start'],
      spin:['Spin it in place','Press Start, turn it on the spot counterclockwise a few whole turns (5 is plenty), keeping its centre where it was, then press Done.','Start']};
    function stepHtml(kind){if(kind==='still'){const d=saved().drift,h=headingSource(),have=d&&d.key===h?.key;
        return `<li class="cal-sense-step" data-sense-step="still"><div><h4>Drift</h4><p class="hint">How far the heading wanders on its own. Measured in the background whenever live readings run, alongside the other checks: 30 s in which the robot is not turned.</p>${have?resultHtml('still'):`<p class="cal-live" role="status" data-sense-drift>${live()?'Measuring in the background…':'Starts with live readings.'}</p>`}</div></li>`;}
      const [title,how,go]=STEPS[kind],on=test?.kind===kind;
      return `<li class="cal-sense-step" data-sense-step="${kind}"><div><h4>${esc(title)}</h4><p class="hint">${esc(how)}</p><div class="button-row">${on?`${kind==='still'?'':`<button type="button" class="primary" data-sense-done>Done</button>`}<button type="button" class="secondary" data-sense-cancel>Cancel</button><span class="hint" data-sense-live></span>`:`<button type="button" class="secondary" data-sense-go="${kind}"${!live()||test?' disabled':''}>${go}</button>`}</div>${on?'':resultHtml(kind)}</div></li>`;}
    // ---- how each hub is mounted, from its own IMU, with no button: level and still, then the front lifted and held.
    // Every IMU in the robot's configuration is read at once (the Control Hub's, an Expansion Hub's). It runs by itself
    // while this shows and nothing is kept for one of them yet, and again when asked.
    const HM=()=>globalThis.DeckHubMount,imus=()=>{const main=dev('imu')||'imu',all=(opts.imus?.()||[]).filter(Boolean);return [...new Set([main,...all])];};
    const mounts=()=>{const c=p().calibration||(p().calibration={}),ch=c.chassis||(c.chassis={});return ch.mount||(ch.mount={});};
    const mountLine=()=>{const el=box?.querySelector('[data-sense-mount-live]');if(el&&el.textContent!==mountSaid)el.textContent=mountSaid;};
    function mountStop(){mountOff?.();mountOff=null;mounting=null;}
    // Gravity alone, with the robot sitting still: which way is up through each hub. That fixes where its logo (and USB
    // end) points up or down, and Setup's mounting is checked against it; it cannot tell which way round the hub faces about
    // the vertical, so where gravity and Setup disagree, the mountings that fit gravity are offered to pick from.
    // Nothing is lifted or moved. choices: {imu: [{logo, usb, off}]} waiting for a pick.
    let choices={};
    const SQUARE=['up','down','forward','backward','left','right'],axisOf=d=>Math.floor(SQUARE.indexOf(d)/2),FIT_DEG=12;
    const squares=()=>SQUARE.flatMap(logo=>SQUARE.filter(usb=>axisOf(usb)!==axisOf(logo)).map(usb=>({logo,usb})));
    const upIn=(logo,usb)=>{const m=HM().squareMatrix(logo,usb);return [m[2][0],m[2][1],m[2][2]];};
    const keep=(n,logo,usb,off)=>{const m=mounts();m[n]={logo,usb,off:+off.toFixed(1),quaternion:HM().quat(HM().squareMatrix(logo,usb)),how:'gravity',at:new Date().toISOString()};if(n===(dev('imu')||'imu'))opts.setMount?.(n,m[n]);};
    function mountStart(){if(mounting||!HM()||!live()||!debug?.listen)return;const names=imus(),t0=performance.now();mounting=Object.fromEntries(names.map(n=>[n,HM().start()]));choices={};mountSaid='Reading which way is up through the hub: leave the robot still a second…';
      mountOff=debug.listen((_f,vals)=>{if(!mounting)return;const ms=performance.now()-t0;let read=0;
        for(const n of names){const up=HM().upOf(vals[`i:${n}:pitch`],vals[`i:${n}:roll`]);if(!up)continue;read++;if(mounting[n].phase==='flat')mounting[n]=HM().step(mounting[n],{ms,up});}
        if(!read){mountSaid='This IMU is not giving its pitch and roll yet…';return mountLine();}
        const reading=names.filter(n=>mounting[n].flat||mounting[n].hold.length);if(!reading.length||reading.some(n=>!mounting[n].flat)){mountSaid='Reading which way is up through the hub: leave the robot still a second…';return mountLine();}
        const setup=globalThis.DeckSimConfig?.hubMounting?.(p().robot||{})||{hubLogo:'up',hubUsb:'forward'},main=dev('imu')||'imu';
        for(const n of reading){const flat=mounting[n].flat,fits=squares().map(x=>({...x,off:HM().angle(upIn(x.logo,x.usb),flat)})).filter(x=>x.off<FIT_DEG).sort((x,y)=>x.off-y.off);
          const said=n===main?fits.find(x=>x.logo===setup.hubLogo&&x.usb===setup.hubUsb):null,known=mounts()[n],same=known&&fits.find(x=>x.logo===known.logo&&x.usb===known.usb);
          if(said)keep(n,said.logo,said.usb,said.off);else if(same)keep(n,same.logo,same.usb,same.off);else if(fits.length===1)keep(n,fits[0].logo,fits[0].usb,fits[0].off);
          else choices[n]=fits.length?fits:[{problem:`No square mounting matches gravity: this hub is tilted ${f(Math.min(...squares().map(x=>HM().angle(upIn(x.logo,x.usb),flat))),0)}° from square. Set its mounting in Setup → Robot.`}];}
        mountStop();mountSaid='';opts.save();return paint();});}
    function mountHtml(){if(!HM())return '';const m=mounts(),names=imus(),have=names.filter(n=>m[n]&&!choices[n]),setup=globalThis.DeckSimConfig?.hubMounting?.(p().robot||{});
      const rows=have.map(n=>`<li><span class="rs-pill ok">${m[n].how==='gravity'?'Checked':'Read'}</span> <b>${esc(n)}</b>: ${esc(HM().words(m[n]))}${m[n].how==='gravity'?(setup&&m[n].logo===setup.hubLogo&&m[n].usb===setup.hubUsb?' · matches Setup':' · picked'):''}</li>`).join('');
      const pick=Object.entries(choices).map(([n,list])=>list[0]?.problem?`<p class="cal-sense-note bad">${esc(list[0].problem)}</p>`:`<p class="cal-sense-note bad"><b>${esc(n)}</b>: gravity says the hub’s logo faces ${esc(list[0].logo)}, which ${setup?`is not Setup’s “Logo ${esc(setup.hubLogo)}, USB ${esc(setup.hubUsb)}”`:'Setup does not say'}. Which way does its USB end point?</p><div class="button-row">${list.map(x=>`<button type="button" class="secondary" data-sense-mount-pick="${esc(n)}|${x.logo}|${x.usb}">Logo ${esc(x.logo)}, USB ${esc(x.usb)}</button>`).join('')}</div>`).join('');
      const how=mounting?'':'Read from gravity with the robot sitting still, and checked against the mounting in Setup → Robot. Nothing to lift or move.';
      return `<li class="cal-sense-step" data-sense-step="mount"><div><h4>How the hub is mounted</h4><p class="hint">${esc(how)}</p>${mounting?`<p class="cal-live" role="status" data-sense-mount-live>${esc(mountSaid)}</p>`:`${rows?`<ul class="cal-sense-rows">${rows}</ul>`:''}${pick}<div class="button-row"><button type="button" class="secondary" data-sense-mount${live()?'':' disabled'}>${have.length?'Check it again':'Check it'}</button></div>`}</div></li>`;}
    function paint(){if(!box)return;const h=headingSource(),odo=!!PODS[loc()]||loc()==='fused'||loc()==='optical';
      const need=!live()?`<section class="cal-card cal-sense-live"><div><h2>Live readings</h2><p class="hint">Each step below reads the robot through Torque Debug while you move it.</p></div><button type="button" class="primary" data-sense-start>Start live readings</button></section>`:'';
      const heading=h?`<section class="cal-card"><h2>Heading · ${esc(h.what)}</h2><p class="hint">Every turn and position the robot works out goes through its heading. ${h.kind==='hub'?'Torque checks how the hub is mounted and how much the heading drifts, with the robot sitting still.':h.kind==='pinpoint'?'goBILDA tunes the Pinpoint’s at the factory; this checks it.':'Its angular scalar corrects it.'}</p><ol class="cal-sense-steps">${h.kind==='hub'?mountHtml():''}${stepHtml('still')}</ol><p class="hint">Its turn scale is taken as 1.0: the IMU is calibrated at the factory, and the FTC SDK takes it the same way. Nothing to spin.</p></section>`:'';
      if(h?.kind==='hub'&&HM()&&live()&&!mounting&&!test&&!mounts()[dev('imu')||'imu']&&!mountTried){mountTried=true;mountStart();return paint();}
      if(live())driftWatch();else if(driftOff){driftOff();driftOff=null;}
      const position=odo?`<section class="cal-card"><h2>Position · ${esc(loc()==='fused'?'Pinpoint pods':loc()==='optical'?'OTOS':`${pods().length} odometry pods`)}</h2><p class="hint">Push the robot straight forward, then straight left, to check which way ${loc()==='optical'?'the OTOS':'each pod'} counts and how far. ${loc()==='optical'?'Where the OTOS sits on the robot comes from Setup.':'Then spin it in place to find where each pod sits. Do IMU tuning first, because the spin uses the heading.'}</p><ol class="cal-sense-steps">${stepHtml('forward')}${stepHtml('left')}${loc()==='optical'?'':stepHtml('spin')}</ol></section>`:
        `<section class="cal-card"><h2>Position</h2><p class="hint">${loc()==='encoders'?'This robot works out its position from its drive motors’ encoders, which need no calibration beyond the heading.':'Nothing on this robot measures its position, so there is nothing to calibrate here.'}</p></section>`;
      // The heading is tuned and checked in the chassis's IMU tuning: its section is not shown here. The hub's mounting is still read from gravity (above).
      const html=(odo?need:'')+position;if(box.dataset.html!==html){box.dataset.html=html;box.innerHTML=html;}paintTest();}
    function paintTest(){const s=box?.querySelector('[data-sense-live]');if(!s||!test)return;const secs=(performance.now()-test.at)/1000;s.textContent=test.kind==='still'?`${Math.max(0,30-secs).toFixed(0)} s left · ${f(test.turn.total)}°`:test.kind==='turns'?`Turned ${f(test.turn.total,0)}° · push it flat against the wall and leave it; it finishes by itself`:`Turned ${f(test.turn.total,1)}°`;}
    box?.addEventListener('click',e=>{const t=e.target.closest('button');if(!t)return;
      if(t.hasAttribute('data-sense-mount')){mountStop();mountStart();return paint();}if(t.dataset.senseMountPick){const [n,logo,usb]=t.dataset.senseMountPick.split('|');delete choices[n];keep(n,logo,usb,0);opts.save();return paint();}
      if(t.dataset.senseGo){mountStop();begin(t.dataset.senseGo);}else if(t.hasAttribute('data-sense-done'))finish();else if(t.hasAttribute('data-sense-cancel'))cancel();else if(t.dataset.senseUse)use(t.dataset.senseUse);else if(t.hasAttribute('data-sense-start'))void debug?.start?.();});
    return {refresh:paint,stop:cancel};}
  root.DeckSensorCal={...api,create};
})(typeof globalThis==='object'?globalThis:this);
