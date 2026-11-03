(function(root,factory){const value=factory(root);if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckMotionTest=value;})(typeof globalThis==='object'?globalThis:this,root=>{
  'use strict';
  // Setup → Mechanisms → Range of motion test. The imported CAD is the robot with everything at zero; the team sets how
  // far each mechanism goes from there (limits in degrees or inches, all the way round, or a cap such as 500° for a
  // turret on a wire wrap). The test then moves each one through its whole range on the model, says what that range is,
  // and looks for anything it runs into inside the robot (DeckCollide, in the worker). It also runs mechanisms that can
  // reach each other together, since two turrets may each be clear alone and still meet.
  const K=()=>root.DeckKinematics||(typeof require==='function'?require('./sim-kinematics.js'):null);
  const finite=Number.isFinite,fix=(v,d=1)=>+(+v).toFixed(d),esc=s=>String(s??'').replace(/[&<>"]/g,c=>`&#${c.charCodeAt(0)};`);
  const SPINNING=new Set(['flywheel','roller','feeder','wheel']);
  // How far a joint goes, and where that comes from. kind: free (all the way round), limits (set), positions (only
  // between its named positions), aim (a game turret's aiming range), or something the test cannot sweep: unset (needs a
  // range), follows (another part moves it), none (no CAD parts), multi (more than one value).
  function rangeOf(j,{model,mechanisms}={}){
    const dof=K().dofOf(j),lin=dof[0]==='in',unit=lin?'in':'°',base={unit,linear:lin};
    if(!j.parts?.length)return {...base,kind:'none'};
    const c=model?.couplings?.find(x=>x.to===j.id);if(c)return {...base,kind:'follows',from:c.from};
    if(dof.length!==1)return {...base,kind:'multi'};
    if(finite(j.lower)&&finite(j.upper)&&(j.type==='revolute'||j.type==='prismatic'))return {...base,kind:'limits',lower:Math.min(j.lower,j.upper),upper:Math.max(j.lower,j.upper)};
    if(j.drive?.signal==='turret'&&!j.free){const t=mechanisms?.turret;if(t&&finite(t.min)&&finite(t.max))return {...base,kind:'aim',lower:t.min,upper:t.max};}
    if(j.type==='continuous'||SPINNING.has(j.drive?.signal))return {...base,kind:'free',lower:-180,upper:180,spins:SPINNING.has(j.drive?.signal)};
    const st=Object.values(j.states||{}).filter(finite);
    if(new Set(st).size>1)return {...base,kind:'positions',lower:Math.min(0,...st),upper:Math.max(0,...st)};
    return {...base,kind:'unset'};
  }
  const canSweep=r=>['free','limits','positions','aim'].includes(r.kind);
  // The range set on a joint: all the way round, or between two limits (a cap past a full turn is fine).
  function setRange(j,{free,lower,upper}){
    if(free){if(j.type!=='prismatic'){j.type='continuous';j.free=true;delete j.lower;delete j.upper;}return j;}
    delete j.free;if(j.type==='continuous')j.type='revolute';
    if(finite(lower))j.lower=lower;if(finite(upper))j.upper=upper;return j;
  }
  const signed=(v,u)=>`${v>0?'+':v<0?'−':''}${fix(Math.abs(v),2)}${u==='in'?' in':'°'}`;
  // What the mechanism's range is, in words.
  function describe(j,r,{parts=0,names=[]}={}){
    const u=r.unit,ride=names.length?` It carries ${names.join(', ')}.`:'';
    if(r.kind==='none')return 'No CAD parts are chosen for it, so there is nothing to test. Choose its parts under Moving parts.';
    if(r.kind==='follows')return 'It moves with another part (gears, a belt or a link), so it is tested when that part moves.';
    if(r.kind==='multi')return 'It moves in more than one way at once. The test does not sweep this kind of joint yet.';
    if(r.kind==='unset')return 'Its range is not set. Set how far it goes from zero, or choose all the way round.';
    if(r.kind==='free')return `${r.spins?'It spins':'It turns'} all the way round with no end stop.${ride}`;
    const span=r.upper-r.lower,turns=u==='°'&&span>360?` That is ${fix(span/360,2)} turns, so it stops at the cap rather than going round for ever.`:'';
    const how=u==='in'?'slides':'turns',src=r.kind==='aim'?' (its aiming range, from Shooter timing)':r.kind==='positions'?' (between its named positions; set limits if it can go further)':'';
    return `From zero in your CAD it ${how} ${signed(r.lower,u)} one way and ${signed(r.upper,u)} the other: ${fix(span,2)}${u==='in'?' in':'°'} in all${src}.${turns}${ride}`;
  }
  // What is wrong with the setup before anything moves.
  function setupIssues(j,r,{mechanisms}={}){
    const out=[],u=r.unit;
    if(r.kind==='unset')out.push({level:'block',text:'Its range is not set.'});
    if(!canSweep(r))return out;
    if(r.lower>0||r.upper<0)out.push({level:'warn',text:`Zero is outside its range (${signed(r.lower,u)} to ${signed(r.upper,u)}). The CAD should show it at a position it can really reach: re-export it zeroed, or change the range.`});
    for(const [name,v] of Object.entries(j.states||{}))if(finite(v)&&r.kind==='limits'&&(v<r.lower-1e-6||v>r.upper+1e-6))out.push({level:'warn',text:`Its position “${name}” (${signed(v,u)}) is outside its range.`});
    const t=mechanisms?.turret;if(j.drive?.signal==='turret'&&r.kind==='limits'&&t&&(t.min<r.lower||t.max>r.upper))out.push({level:'warn',text:`Shooter timing lets it aim ${signed(t.min,u)} to ${signed(t.max,u)}, past this range, so it will stop short while aiming.`});
    return out;
  }
  // The rows of the test: every joint that moves, a part riding on another under it.
  function rows(model,{mechanisms}={}){
    const out=[],seen=new Set(),visit=(j,d)=>{if(seen.has(j.id))return;seen.add(j.id);const r=rangeOf(j,{model,mechanisms});out.push({joint:j,range:r,depth:d,issues:setupIssues(j,r,{mechanisms})});for(const c of model.joints.filter(x=>x.parent===j.id))visit(c,d+1);};
    const moving=model.joints.filter(j=>j.type!=='fixed'),ids=new Set(moving.map(j=>j.id));for(const j of moving)if(!j.parent||!ids.has(j.parent))visit(j,0);for(const j of moving)visit(j,0);return out;
  }
  const units=(v,u)=>`${v<0?'−':''}${fix(Math.abs(v),1)}${u==='in'?' in':'°'}`;
  // One mechanism's contacts in words, grouped by what it runs into.
  function hitLines(res,r){
    const by=new Map();for(const h of res.hits||[]){const key=h.names[1];let g=by.get(key);if(!g){g={other:key,mine:new Set(),first:h.first,last:h.last,hits:[]};by.set(key,g);}g.mine.add(h.names[0]);g.hits.push(h);if(Math.abs(h.first)<Math.abs(g.first))g.first=h.first;}
    return [...by.values()].map(g=>({...g,mine:[...g.mine],text:`“${[...g.mine].slice(0,2).join('”, “')}”${g.mine.size>2?` and ${g.mine.size-2} more`:''} hits “${g.other}” at ${units(g.first,r.unit)}.`}));
  }
  // Running into the bearings or shaft it should turn on means the pivot, not the robot, is probably what is off.
  const pivotSuspect=res=>(res?.hits||[]).some(h=>h.names.some(n=>/bearing|bushing|shaft|axle|spacer/i.test(n)));
  const verdict=(res,r)=>{if(!res)return null;if(res.error)return {level:'warn',text:`Could not test it: ${res.error}`};if(res.spins)return {level:'ok',text:'Clear: every part turns in its own space, so it cannot run into anything.'};
    if(!res.hits.length)return {level:'ok',text:`Clear through its whole range${r.kind==='free'?' (all the way round)':''}.`};
    return {level:'hit',text:`Clear only from ${units(res.free[0],r.unit)} to ${units(res.free[1],r.unit)}.`};};
  // What a whole run found, for the headline.
  function summary(list,combos){
    let hits=0,warns=0,blocked=0;for(const x of list){if(x.result?.hits?.length)hits++;if(x.result?.error)warns++;for(const i of x.issues){if(i.level==='block')blocked++;else warns++;}}
    const together=combos.reduce((n,c)=>n+(c.hits?.length?1:0),0),bad=hits+together;
    return {hits,together,warns,blocked,clear:!bad&&!warns&&!blocked,text:bad?`${bad} problem${bad>1?'s':''} found: ${hits?`${hits} mechanism${hits>1?'s':''} run into something`:''}${hits&&together?', and ':''}${together?`${together} pair${together>1?'s':''} of mechanisms meet when moved together`:''}.`:blocked?`${blocked} mechanism${blocked>1?'s still need':' still needs'} a range before the test can cover ${blocked>1?'them':'it'}.`:warns?`No collisions, but ${warns} thing${warns>1?'s':''} to check.`:'No collisions: everything clears through its full range.'};
  }
  function create({host,api}){
    let running=false,stopped=false,caption='',results={},combos=[],ranKey='',lastKey='',done=false,left=null,playing=0;
    const kin=()=>api.kinematics(),mech=()=>api.mechanisms(),panel=()=>api.joints();
    const keyOf=()=>JSON.stringify([kin().joints.filter(j=>!api.keep||api.keep(j)).map(j=>[j.id,j.type,j.lower,j.upper,j.origin,j.axis,j.parts,j.parent]),kin().couplings,mech()?.turret]);
    const zeroed=()=>{const m=api.meta();return !!m?.id&&kin().zeroed===m.id;};
    // Parts that only follow another, and spinning parts with nothing to report (wheels, rollers), are tested but not listed.
    const keep=x=>!api.keep||api.keep(x.joint);
    const everything=()=>rows(kin(),{mechanisms:mech()}).filter(keep).map(x=>({...x,result:results[x.joint.id]}));
    const list=()=>everything().filter(x=>x.range.kind!=='follows'&&(!x.range.spins||x.result?.hits?.length||x.result?.error));
    const riders=j=>kin().joints.filter(x=>x.parent===j.id&&x.parts?.length).map(x=>x.name);
    function row(x){
      const j=x.joint,r=x.range,v=verdict(x.result,r),edit=!['none','follows','multi'].includes(r.kind)&&!r.spins,rev=j.type!=='prismatic',free=r.kind==='free',lines=x.result?hitLines(x.result,r):[];
      // The sliders reach a full turn each way (a foot and a half for a slide), and further when a cap already does.
      const reach=rev?360:36,num=(f,val,label)=>`<label>${label}<input type="number" data-mt-f="${f}" value="${finite(val)?fix(val,2):''}" step="any" data-slider-min="${Math.min(rev?-reach:-6,finite(val)?val:0)}" data-slider-max="${Math.max(reach,finite(val)?val:0)}" data-slider-step="${rev?1:.25}"></label>`;
      return `<li class="sim-motion-row" data-mt-id="${esc(j.id)}" data-depth="${Math.min(x.depth,3)}"><div class="sim-motion-head"><strong>${esc(j.name)}</strong>${v?`<small class="sim-motion-chip" data-level="${v.level}">${v.level==='ok'?'Clear':v.level==='hit'?`${lines.length} problem${lines.length===1?'':'s'}`:'Check'}</small>`:''}</div>
        ${edit?`<div class="sim-motion-range">${rev?`<label>Range<select data-mt-f="kind"><option value="limits"${free?'':' selected'}>Set limits or a cap</option><option value="free"${free?' selected':''}>All the way round</option></select></label>`:''}${free?'':`${num('lower',r.lower,`From · ${r.unit}`)}${num('upper',r.upper,`To · ${r.unit}`)}`}</div>`:''}
        <p class="hint">${esc(describe(j,r,{names:riders(j)}))}</p>
        ${x.issues.map(i=>`<p class="hint sim-joint-needs">${esc(i.text)}</p>`).join('')}
        ${v?`<p class="hint sim-motion-result" data-level="${v.level}">${esc(v.text)}</p>`:''}
        ${lines.length?`<ul class="sim-joint-alts">${lines.slice(0,8).map((g,n)=>`<li>${esc(g.text)} <button type="button" class="text-button" data-mt="show" data-v="${n}">Show it</button></li>`).join('')}${lines.length>8?`<li>And ${lines.length-8} more.</li>`:''}</ul>`:''}
        ${pivotSuspect(x.result)?'<p class="hint">It meets a bearing, shaft or spacer. If that is what it turns on, its pivot may be slightly off: open it under Moving parts and use Pick a circle on the axle.</p>':''}
        ${canSweep(r)||lines.length?`<div class="sim-joint-buttons">${canSweep(r)?'<button type="button" class="secondary" data-mt="play">Move it through its range</button>':''}${lines.length&&(r.kind==='limits'||r.kind==='aim'||r.kind==='free'||r.kind==='positions')&&rev?'<button type="button" class="secondary" data-mt="limits">Use the clear range as its limits</button>':''}</div>`:''}</li>`;
    }
    function render(){
      const typing=host.contains(document.activeElement)&&document.activeElement.matches('input[type=number],select');
      const cad=api.cad(),k=kin(),all=cad?list():[],key=JSON.stringify([keyOf(),cad,zeroed(),running,caption,done,Object.keys(results).length,combos.length,all.length]);
      if(typing||key===lastKey)return;lastKey=key;host.hidden=!cad||!all.length;if(host.hidden)return;
      const stale=done&&ranKey!==keyOf(),testable=all.filter(x=>canSweep(x.range)),sum=done?summary(all,combos):null,comboHits=combos.filter(c=>c.hits?.length);
      host.innerHTML=`<div class="sim-joints-head"><h3>Range of motion test</h3></div>
        <p class="hint">Run this once every mechanism is set up. Your CAD is the robot at zero: each range below is how far that mechanism goes from where the CAD has it. On a big robot the test can take a few minutes.</p>
        <label class="check"><input type="checkbox" data-mt-f="zeroed"${zeroed()?' checked':''}> Every mechanism in my CAD is at its zero (arms down, lifts in, turrets facing front)</label>
        <ol class="sim-motion-list">${all.map(row).join('')}</ol>
        <div class="sim-joint-buttons"><button type="button" class="primary" data-mt="${running?'stop':'run'}"${!running&&(!zeroed()||!testable.length)?' disabled':''}>${running?'Stop':done?'Run the test again':'Run the range of motion test'}</button></div>
        ${(n=>n?`<p class="hint">Also tested, with nothing to set: ${n} part${n>1?'s':''} that spin or follow another (wheels, rollers, gears).</p>`:'')(everything().length-all.length)}
        ${!zeroed()?'<p class="hint sim-joint-needs">Zero your CAD and tick the box to run the test: the ranges are measured from how the CAD has each mechanism.</p>':''}
        <p class="hint sim-motion-caption" role="status">${esc(caption)}</p>
        ${sum&&!running?`<div class="sim-motion-summary" data-level="${sum.clear?'ok':sum.hits||sum.together?'hit':'warn'}"><strong>${esc(sum.text)}</strong>${stale?'<p class="hint">Something changed since this run. Run it again to check the new settings.</p>':''}</div>`:''}
        ${comboHits.length&&!running?`<span class="sim-mech-label">When moved together</span><ul class="sim-joint-alts">${comboHits.map(c=>{const a=k.joints.find(j=>j.id===c.a)?.name||c.a,b=k.joints.find(j=>j.id===c.b)?.name||c.b,h=c.hits[0];return `<li>${esc(a)} at ${fix(h.at[c.a],0)} with ${esc(b)} at ${fix(h.at[c.b],0)}: “${esc(h.names[0])}” hits “${esc(h.names[1])}”. <button type="button" class="text-button" data-mt="together" data-v="${esc(c.a+'|'+c.b)}">Show it</button></li>`;}).join('')}</ul>`:''}
        ${done&&!running?`<p class="hint">Checked on your CAD’s real surfaces, one mechanism at a time and then in pairs that can reach each other, not every mechanism at once. Left out: belts, chains and cables (they bend), gears and anything they touch at zero, and other parts that already touch at zero unless one is pushed into the other. A contact is worth a look on the model; the real robot’s tolerances and flex are not known.</p>`:''}`;
    }
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    // Moves a joint through its range on the model: out one way, back, out the other, back to zero.
    function animate(j,r,ms=1800){
      const P=panel();if(!P?.motion?.canShow?.())return Promise.resolve();const hi=r.kind==='free'?360:r.upper,lo=r.kind==='free'?0:r.lower,from=Math.max(lo,Math.min(hi,0)),legs=[from,hi,lo,from],t0=performance.now();
      const id=++playing;return new Promise(resolve=>{const step=now=>{if(stopped||id!==playing){resolve();return;}const t=Math.min(1,(now-t0)/ms),n=t*(legs.length-1),i=Math.min(legs.length-2,Math.floor(n)),q=legs[i]+(legs[i+1]-legs[i])*(n-i);P.motion.show({[j.id]:q});if(t<1)requestAnimationFrame(step);else resolve();};requestAnimationFrame(step);});
    }
    const say=t=>{caption=t;render();};
    async function run(){
      const P=panel();if(running||!P?.motion)return;running=true;stopped=false;done=false;results={};combos=[];
      const model=structuredClone(kin()),all=rows(model,{mechanisms:mech()}).filter(keep),items=all.filter(x=>canSweep(x.range)),sweepable=[];
      for(let i=0;i<items.length&&!stopped;i++){const {joint:j,range:r}=items[i];say(`${i+1} of ${items.length}: ${j.name}. ${describe(j,r)}`);
        const [res]=await Promise.all([P.motion.ask({job:'range',model,joint:j.id,lower:r.lower,upper:r.upper,linear:r.linear}),r.spins?null:animate(j,r)]);
        results[j.id]=res.ok?res:{error:res.error};if(res.ok&&!res.spins&&!r.spins)sweepable.push({joint:j.id,lower:r.lower,upper:r.upper,linear:r.linear});
        if(res.ok&&res.hits.length){P.motion.show({[j.id]:res.hits[0].first});P.motion.mark(res.hits[0].a,res.hits[0].b);await wait(700);P.motion.mark();}}
      if(!stopped&&sweepable.length>1){const plan=await P.motion.ask({job:'combos',model,items:sweepable}),pairs=plan.ok?plan.pairs:[],ignore=Object.values(results).flatMap(r=>(r.hits||[]).map(h=>h.a+':'+h.b));
        for(let i=0;i<pairs.length&&!stopped;i++){const [x,y]=pairs[i],a=sweepable.find(s=>s.joint===x),b=sweepable.find(s=>s.joint===y),name=id=>model.joints.find(j=>j.id===id)?.name||id;say(`Moving mechanisms together, ${i+1} of ${pairs.length}: ${name(x)} with ${name(y)}.`);
          const res=await P.motion.ask({job:'pair',model,a,b,ignore});if(res.ok)combos.push({a:x,b:y,hits:res.hits});}}
      running=false;playing++;P.motion.show({});P.motion.mark();ranKey=keyOf();done=!stopped;caption=stopped?'Stopped.':'';lastKey='';render();
    }
    host.addEventListener('click',e=>{
      const b=e.target.closest('[data-mt]');if(!b)return;const what=b.dataset.mt,P=panel();
      if(what==='run'){void run();return;}if(what==='stop'){stopped=true;caption='Stopping…';lastKey='';render();return;}
      if(what==='together'){const [x,y]=b.dataset.v.split('|'),c=combos.find(q=>q.a===x&&q.b===y),h=c?.hits[0];if(h){playing++;P?.motion?.show(h.at);P?.motion?.mark(h.a,h.b);}return;}
      const id=b.closest('[data-mt-id]')?.dataset.mtId,j=kin().joints.find(x=>x.id===id);if(!j)return;const r=rangeOf(j,{model:kin(),mechanisms:mech()}),res=results[id];
      if(what==='play'){stopped=false;void animate(j,r,3600).then(()=>{if(!running){P?.motion?.show({});}});return;}
      if(what==='show'){const g=hitLines(res,r)[+b.dataset.v];if(!g)return;playing++;P?.motion?.show({[id]:g.first});P?.motion?.mark(g.hits[0].a,g.hits[0].b);return;}
      if(what==='limits'&&res?.free){const next=structuredClone(kin()),x=next.joints.find(q=>q.id===id);setRange(x,{lower:res.free[0],upper:res.free[1]});if(x.type==='continuous')x.type='revolute';api.commit(next);}
    });
    host.addEventListener('change',e=>{
      const el=e.target,f=el.dataset.mtF;if(!f)return;
      if(f==='zeroed'){const next=structuredClone(kin());if(el.checked)next.zeroed=api.meta()?.id;else delete next.zeroed;api.commit(next);lastKey='';render();return;}
      const id=el.closest('[data-mt-id]')?.dataset.mtId,next=structuredClone(kin()),j=next.joints.find(x=>x.id===id);if(!j)return;
      if(f==='kind'){if(el.value==='free')setRange(j,{free:true});else{const r=rangeOf(kin().joints.find(x=>x.id===id),{model:kin(),mechanisms:mech()}),span=r.kind==='free';setRange(j,{lower:span?-180:r.lower??0,upper:span?180:r.upper??0});j.type=j.type==='continuous'?'revolute':j.type;}}
      else{if(!finite(el.valueAsNumber))return;const r=rangeOf(kin().joints.find(x=>x.id===id),{model:kin(),mechanisms:mech()}),lo=f==='lower'?el.valueAsNumber:r.lower??Math.min(0,el.valueAsNumber),hi=f==='upper'?el.valueAsNumber:r.upper??Math.max(0,el.valueAsNumber);setRange(j,{lower:lo,upper:hi});}
      el.blur();api.commit(next);lastKey='';render();
    });
    return {render,running:()=>running,stop(){stopped=true;}};
  }
  return {rangeOf,canSweep,setRange,describe,setupIssues,rows,hitLines,pivotSuspect,verdict,summary,create};
});
