(function(root){
  'use strict';
  // Setup → Mechanisms → Moving parts. The joints of the team's CAD (DeckKinematics), found by DeckDiscovery and
  // checked here on the 3D preview: each one shows where it pivots (an axis and a ring through the model), which parts
  // move (they glow), how sure the finder is, and the few settings it needs (a ramp's up and down angles, a hood's
  // shooting tilt, which way a turret faces in the CAD). Pivots can be picked on the model: click a round part, a hole
  // or a round edge and its circle is measured, as a slicer measures one; or click two points along the axis.
  // simulation.js gives the panel its host and an api; the panel never touches the project directly.
  const K=()=>root.DeckKinematics,D=()=>root.DeckDiscovery,R=()=>root.DeckRobotModel,TY=()=>root.DeckMechanismTypes;
  const esc=s=>String(s??'').replace(/[&<>"]/g,c=>`&#${c.charCodeAt(0)};`),finite=Number.isFinite,fix=(v,d=1)=>+(+v).toFixed(d);
  const COLORS={turret:0x8e4ec6,hood:0xf29d38,flywheel:0x2fa84f,roller:0x12a5c9,deploy:0xe5484d,float:0x3fbf9f,feeder:0xd4a72c,wheel:0x7a8594,steer:0x7a8594,action:0x4ea1ff};
  // A part moved by route actions takes its mechanism group's colour (lifts blue, claws teal, hangs red...).
  const GROUP_COLORS={intake:0x12a5c9,inside:0xd4a72c,lift:0x4ea1ff,arm:0x6c63ff,score:0xf29d38,endgame:0xe5484d,drive:0x7a8594,sense:0x2fa84f,robot:0xc2418f,custom:0x4ea1ff};
  const hex=c=>'#'+c.toString(16).padStart(6,'0'),colorOf=j=>(j.drive?.signal==='action'||!j.drive)&&GROUP_COLORS[TY()?.of(j)?.group]!==undefined?GROUP_COLORS[TY().of(j).group]:COLORS[j.drive?.signal]??0x4ea1ff;
  // The finder's three levels of certainty, as the team sees them, and a mechanism it could not find in the CAD.
  function level(j){
    if(j.source==='metadata')return ['sure','From the file'];if(j.source==='user')return j.matched?['likely','Found in your CAD']:j.parts?.length?['user','Set by you']:['stand','Not in your CAD yet'];if(j.source==='standin')return ['stand','Not in your CAD yet'];
    return (j.confidence??0)>=.7?['likely','Found · likely right']:['check','Found · please check'];
  }
  // A saved finding older than this finder is looked at again (parts the team set stay): 2 links game mechanisms to
  // CAD assemblies by themselves, finds the gears that drive them and each hood's launch angle; 3 looks for a hinge in
  // every intake (a sweeper whose CAD swings a plate down is a ramp or kicker) and finds rollers on swing arms.
  const FINDER=3;
  // How far a hood tilts to shoot: to the game's launch angle when its CAD launch angle is known, else as set.
  const shootTilt=(j,launch)=>finite(j.launch)&&finite(launch)?Math.max(j.lower??-180,Math.min(j.upper??180,launch-j.launch)):j.states?.shoot??0;
  const ctxCache=new WeakMap();
  function create({host,api}){
    let open=null,mode=null,demo=0,values={},lastKey='',followers=false;const opened=new Set();
    const status=t=>{const el=host.querySelector('.sim-joints-status');if(el)el.textContent=t||'';};
    // ---- the model: CAD arrays for the finder, the placement for showing CAD points in robot inches
    const model=()=>api.model(),meta=()=>api.meta(),preview=()=>api.preview(),kin=()=>api.kinematics();
    function arrays(){
      const g=model()?.geometry;if(!g||g.isObject3D||!g.attributes?._part||!g.userData?.parts)return null;
      const plain=a=>a&&!a.isInterleavedBufferAttribute?a.array:a?Float32Array.from({length:a.count*a.itemSize},(_,i)=>a.getComponent(Math.floor(i/a.itemSize),i%a.itemSize)):null;
      return {positions:plain(g.attributes.position),part:plain(g.attributes._part),index:g.index?g.index.array:null,tree:g.userData.parts};
    }
    function ctx(){const g=model()?.geometry;if(!g)return null;let c=ctxCache.get(g);if(!c){const a=arrays();if(!a)return null;c=D().prepare(a);ctxCache.set(g,c);}return c;}
    const rows=()=>R().rows(meta()||{}),unit=()=>R().UNITS[meta()?.units]||1,up=()=>rows()[2];
    const P=()=>preview()?.body?.()?.userData?.kin?.P||null,math=()=>K().math;
    const toRobot=p=>{const m=P();return m?math().apply(m,p):p;},dirToRobot=a=>{const m=P();return m?math().unit(math().applyDir(m,a)):a;};
    const fromRobot=p=>{const m=P();return m?math().apply(math().invert(m),p):p;},dirFromRobot=a=>{const m=P();return m?math().unit(math().applyDir(math().invert(m),a)):a;};
    const leavesOf=j=>{const c=ctx();return c?c.parts.expand(j.parts||[]):new Set();};
    const joints=()=>kin().joints;
    // ---- changes
    function motorChange(jointId,fn){const next=structuredClone(kin()),a=next.actuators.find(x=>x.joint===jointId);if(!a)return;fn(a,next);api.commit(next);}
    function change(id,fn,{note}={}){const next=structuredClone(kin()),j=next.joints.find(x=>x.id===id);if(!j)return;fn(j,next);if(['inferred','metadata','standin'].includes(j.source))j.source='user';api.commit(next,note);}
    // Finds the joints of this CAD. Joints the team set stay; found ones replace the old finds.
    // The finder and the clearance sweep run in a worker (sim-discovery-worker.js) so a big CAD does not stall the page;
    // the body's arrays go to it once per CAD. Without workers they run here.
    let worker=null,jobs=0,sent=null;const waiting=new Map();
    function ask(op,options){
      const a=arrays(),key=meta()?.id||'';if(worker===null){try{worker=new Worker('sim-discovery-worker.js');worker.onmessage=e=>{const w=waiting.get(e.data.id);waiting.delete(e.data.id);w?.(e.data);};worker.onerror=()=>{worker=false;sent=null;for(const w of waiting.values())w({ok:false,error:'the worker stopped'});waiting.clear();};}catch{worker=false;}}
      if(!worker)return new Promise(resolve=>setTimeout(()=>{try{const t=performance.now(),c=ctx();if(op==='motion')resolve({ok:true,...root.DeckCollide.job(c,K().sanitize(options.model),options),ms:performance.now()-t});else if(op==='sweep'){const r=root.DeckCollide.sweep(c,K().sanitize(options.model),options.joint,options);resolve({ok:true,free:r.free,hits:r.hits.map(h=>({...h,names:[...new Set(h.parts.flatMap(([x,y])=>[c.parts.name(x),c.parts.name(y)]))].slice(0,4)})),ms:performance.now()-t});}
        else resolve({ok:true,...D().discover(c,options),ms:performance.now()-t});}catch(e){resolve({ok:false,error:e.message});}},30));
      const id=++jobs,fresh=sent!==key;sent=key;return new Promise(resolve=>{waiting.set(id,resolve);worker.postMessage({id,op,key,arrays:fresh?a:undefined,options});});
    }
    const find=options=>ask('discover',options);
    // Sweeps a part through its range (the other parts as the preview has them) for contacts with anything else.
    const clearance={};
    async function check(j){
      const lin=j.type==='prismatic',range=lin?[j.lower??0,j.upper??12]:j.type==='revolute'?[j.lower??-180,j.upper??180]:[-180,180],from=K().valuesOf(j,values[j.id]??j.home??0)[0];
      status(`Turning ${j.name} through its range to see what it meets…`);clearance[j.id]={busy:true};lastKey='';render();
      const r=await ask('sweep',{model:kin(),joint:j.id,from:Math.max(range[0],Math.min(range[1],from)),lower:range[0],upper:range[1],step:lin?.25:3,values});
      clearance[j.id]=r.ok?{free:r.free,hits:r.hits,unit:lin?'in':'°'}:{error:r.error};lastKey='';status(r.ok?`Checked in ${Math.round(r.ms)} ms.`:`Could not check: ${r.error}`);render();
    }
    function clearanceBits(j){
      const c=clearance[j.id];if(K().dofOf(j).length!==1||j.type==='fixed')return '';
      const button=`<button type="button" class="secondary" data-j="clear"${c?.busy?' disabled':''}>${c?.busy?'Checking…':'Check clearance'}</button>`;
      if(!c||c.busy||c.error)return `<div class="sim-joint-buttons">${button}</div>${c?.error?`<p class="hint">${esc(c.error)}</p>`:''}`;
      const u=c.unit,hits=c.hits.map((h,i)=>`<li>At ${fix(h.at,1)}${u}: ${h.names.map(n=>`“${esc(n)}”`).join(' and ')} <button type="button" class="text-button" data-j="hit" data-v="${i}">Show it</button></li>`).join('');
      return `<div class="sim-joint-buttons">${button}${c.hits.length&&(j.type==='revolute'||j.type==='prismatic')?'<button type="button" class="secondary" data-j="limits">Use as limits</button>':''}</div>
        <p class="hint">${c.hits.length?`Moves freely from ${fix(c.free[0],1)}${u} to ${fix(c.free[1],1)}${u}.`:`Moves its whole range (${fix(c.free[0],1)}${u} to ${fix(c.free[1],1)}${u}) without meeting anything.`} Checked with boxes around each part, so a contact is worth a look on the model, not certain; parts already touching in the CAD do not count.</p>${hits?`<ul class="sim-joint-alts">${hits}</ul>`:''}`;
    }
    // fromCad: the team asked for the robot to be set up from its CAD, so what the CAD shows an intake to be (a plate
    // swinging down on a servo makes a sweeper a ramp or a kicker) is set; so it is on a CAD's first finding. Otherwise
    // that intake's ramp or kicker offers it.
    async function discover({quiet=false,fromCad=false}={}){
      const m=meta();if(!arrays()||!m?.id){if(!quiet)status('Moving parts are found in an imported STEP robot with named assemblies.');return false;}
      status('Looking for pivots, axles and moving parts in your CAD…');
      // The mechanisms the team added that have no CAD parts yet are looked for by name (Configure from CAD); after a new
      // CAD every one of them is looked for again (its old parts were in the old CAD).
      const before=kin(),moved=!!before.model&&before.model!==m.id,mine=j=>isMechanism(j)&&j.source==='user';
      const want=before.joints.filter(j=>mine(j)&&(moved||!j.parts?.length)).map(j=>({id:j.id,kind:j.kind,name:j.name}));
      const found=await find({rows:rows(),unit:unit(),meta:m,mechanisms:api.mechanisms(),want});
      if(!found.ok){status('Could not look through the CAD: '+found.error);return false;}if(meta()?.id!==m.id)return false;
      const now=kin(),same=now.model===m.id||!now.model;
      const keptRaw=same?now.joints.filter(j=>j.source==='user'||j.source==='metadata'):now.joints.filter(mine).map(j=>{const {matched:_m,note:_n,radius:_r,...rest}=j;return {...rest,parts:[],parent:null};});
      // What was found for an added mechanism becomes that mechanism: its CAD parts, pivot and travel; its name, type, motor
      // and the positions the team set stay. Found joints that ride on it, or follow it, now name it.
      const {kept,merged,renamed,unmatched}=adopt(keptRaw,found.joints,want);
      // A game signal the team's parts already follow is not given to a found one too (route actions are not a signal).
      const bound=new Set(kept.filter(j=>j.drive&&j.drive.signal!=='action').map(j=>j.drive.signal+':'+(j.drive.of||''))),ids=new Set(kept.map(j=>j.id));
      const fresh=found.joints.filter(j=>!merged.has(j)&&!ids.has(j.id)&&!(j.drive&&j.drive.signal!=='wheel'&&bound.has(j.drive.signal+':'+(j.drive.of||'')))).map(j=>{const {for:_,...rest}=j;return rest;});
      for(const j of fresh)if(renamed.has(j.parent))j.parent=renamed.get(j.parent);
      // The team's couplings stay; found ones (gears following a turret or hood) come with the joints found again.
      const all=new Set([...kept,...fresh].map(j=>j.id)),freshIds=new Set(fresh.map(j=>j.id)),mapped=c=>({...c,from:renamed.get(c.from)||c.from,to:renamed.get(c.to)||c.to});
      const couplings=[...(same?now.couplings.filter(c=>ids.has(c.to)):[]),...(found.couplings||[]).map(mapped).filter(c=>(freshIds.has(c.to)||[...renamed.values()].includes(c.to)||/gear[0-9]*$/.test(c.to))&&all.has(c.from)&&all.has(c.to)&&!(same&&now.couplings.some(o=>o.to===c.to&&ids.has(o.to))))];
      const keptIds=new Set(kept.map(j=>j.id));
      api.commit({...now,model:m.id,unit:unit(),discovered:true,finder:FINDER,joints:[...kept,...fresh],couplings,loops:same?now.loops:[],actuators:same?now.actuators:now.actuators.filter(a=>keptIds.has(a.joint)),actions:same||keptIds.size?now.actions:[]});
      lastFound={matched:[...merged.values()].map(x=>({id:x.id,name:x.name,cad:x.matched})),unmatched};
      const lost=unmatched.length?`Not found by name: ${unmatched.join(', ')} (name its assembly in your CAD like it, or choose its parts on the model).`:'';
      // What each of the game's intakes and shooters is in the CAD ("Shooter 2 is “Turret <2>” in your CAD: a turret on…").
      const n=kept.length+fresh.length,missing=fresh.filter(j=>j.source==='standin'),cad=found.report.filter(r=>/^(Shooter|Intake) \d+ is /.test(r));
      const intakes=api.mechanisms().intakes,kinds=(found.intakes||[]).filter(x=>intakes[x.intake]&&!['ramp','kicker'].includes(intakes[x.intake].kind)&&fresh.some(j=>j.id===x.joint)),set=fromCad||!same;
      for(const x of set?kinds:[])api.setIntake(x.intake,{kind:x.kind});
      const told=kinds.map(x=>`Intake ${x.intake+1} ${set?'is now':'looks like'} a ${x.kind==='ramp'?'deployable ramp':'kicker'}: ${x.why}${set?'':'. Open its '+(x.kind==='ramp'?'ramp':'kicker')+' below to set it up that way'}.`);
      // One short line: what each one is in the CAD goes to Mechanisms' "What was found"; only what needs the team stays here.
      status(n?`${n} moving part${n>1?'s':''} found. ${lost} ${missing.length?`Not in your CAD yet: ${missing.map(j=>j.name).join(', ')}; open each to choose its parts.`:''} Check each one on the model.`.replace(/\s+/g,' '):'No moving parts were found. Add your mechanisms with + Add mechanism.');
      return {moving:n,matched:lastFound.matched,unmatched,told:[...told,...cad,...found.report.filter(r=>/swing arm/i.test(r))]};
    }
    // A mechanism the team sees in its list: a part of a mechanism type moved by route actions (not a drive wheel, and
    // not one a game signal moves: those belong to the game's intakes and shooters).
    const isMechanism=j=>!!TY()?.TYPES[j?.kind]&&TY().TYPES[j.kind].signal!=='wheel'&&(!j.drive||j.drive.signal==='action');
    let lastFound=null;
    // What the finder found for each added mechanism (`for`, by its CAD name), else a part it found by its own name of the
    // same type (or family), most like it. Returns the kept joints with their CAD geometry, which found joint became which
    // mechanism (merged, renamed: found id → the mechanism's id) and the mechanisms still not found.
    function adopt(kept,foundJoints,want){
      const T=TY(),merged=new Map(),renamed=new Map(),unmatched=[],wanted=new Set(want.map(w=>w.id)),taken=new Set();
      const out=kept.map(u=>{if(!wanted.has(u.id))return u;let f=foundJoints.find(x=>x.for===u.id&&!taken.has(x));
        if(!f&&T){const t=T.TYPES[u.kind];f=foundJoints.filter(x=>!x.for&&!taken.has(x)&&x.source!=='standin'&&x.parts?.length&&isMechanism(x)&&(x.kind===u.kind||T.TYPES[x.kind]?.family===t?.family))
          .map(x=>({x,s:(x.kind===u.kind?1:0)+T.likeness({kind:u.kind,name:u.name},x.name)})).sort((a,b)=>b.s-a.s)[0]?.x;}
        if(!f){unmatched.push(u.name);return u;}
        taken.add(f);const next=takeGeometry(u,f);merged.set(f,next);renamed.set(f.id,u.id);return next;});
      for(const j of out)if(j.parent&&renamed.has(j.parent))j.parent=renamed.get(j.parent);
      return {kept:out,merged,renamed,unmatched};
    }
    // An added mechanism takes what was found in the CAD for it: its parts, pivot or rails, and the parent it rides on;
    // its positions and limits too while they are still its type's own (a slide's travel from its rails, a drop-down
    // intake's floor angle). Its name, type, speed and motor stay.
    function takeGeometry(u,f){
      const T=TY(),base=T?.TYPES[u.kind]?T.settings(u.kind):{},same=k=>JSON.stringify(u[k]??null)===JSON.stringify(base[k]??null),out={...u};
      Object.assign(out,{parts:f.parts,origin:f.origin,axis:f.axis,type:f.type||u.type,note:f.note,matched:f.matched||f.name,...(finite(f.confidence)?{confidence:f.confidence}:{})});
      if(f.radius)out.radius=f.radius;else delete out.radius;if(!u.parent&&f.parent)out.parent=f.parent;
      // (Positions the CAD could not tell apart, a hood's rest and shoot both at 0°, say nothing.)
      const told=k=>k!=='states'||new Set(Object.values(f.states||{})).size>1;
      for(const k of ['states','lower','upper'])if(f[k]!==undefined&&same(k)&&told(k))out[k]=f[k];
      out.source='user';return out;
    }
    // ---- what each part is (DeckMechanismTypes): a claw, a lift, a turret... The finder reads it from the CAD's names;
    // the team picks one with + Add or changes it here, which sets how it moves, its positions and speed.
    // Spinning parts follow the game's signal while its mechanisms are on (rollers while intaking), else route actions.
    const bindFor=t=>{const m=api.mechanisms();if(!m?.enabled||!t?.signal||t.signal==='wheel')return null;
      return t.signal==='roller'?(m.intakes.length?{signal:'roller',of:'intake:0'}:null):t.signal==='flywheel'?(m.shooters.length?{signal:'flywheel',of:'shooter:0'}:null):{signal:'feeder',of:'any'};};
    const motorWords=t=>{const m=t.motor,model=root.DeckActuators?.MODELS[m.model],name=model?model.short+(model.kind==='dcmotor'?' motor':model.kind!=='crservo'&&!/servo$/i.test(model.short)?' servo':''):(K().ACTUATORS[m.kind]||'motor').replace(/\s*\(.*\)$/,'').toLowerCase().replace(/^dc /,'DC ');
      const via=(m.transmission||[]).map(s=>({gearbox:`a ${fix(s.ratio,1)}:1 gearbox`,belt:'a belt',spool:'a spool',rack:'a rack',screw:'a lead screw'})[s.kind]).filter(Boolean);
      return `${/^[aeiou]/i.test(name)?'an':'a'} ${name}${via.length?' through '+via.join(' and '):''}`;};
    function kindPick(j){const T=TY();if(!T)return '';const t=T.of(j);
      return `<label class="sim-joint-kind-pick">Mechanism<select data-f="kind">${t?'':'<option value="" selected>Choose what it is…</option>'}${T.grouped().map(g=>`<optgroup label="${esc(g.name)}">${g.types.map(x=>`<option value="${x.id}"${x===t?' selected':''}>${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>
        ${t?`<p class="hint">${esc(t.blurb)}${t.motor?` Usually driven by ${motorWords(t)}.`:''}</p>`:''}`;}
    // ---- drawing the panel (a number box gets a slider only when it has a lower bound: angles may be negative)
    const driveOptions=j=>{const m=api.mechanisms(),out=[['none','Nothing: it follows other joints'],['action','Route actions (named positions)']];
      (m.enabled?m.shooters:[]).forEach((s,n)=>{if(s.type==='turret'&&!s.sharesTurret)out.push([`turret:shooter:${n}`,`Turret (turning) of shooter ${n+1}`]);out.push([`hood:shooter:${n}`,`Hood (pitch) of shooter ${n+1}`],[`flywheel:shooter:${n}`,`Flywheel of shooter ${n+1}`]);});
      (m.enabled?m.intakes:[]).forEach((i,n)=>{out.push([`roller:intake:${n}`,`Rollers of intake ${n+1}`]);if(i.kind==='ramp'||i.kind==='kicker'||j.drive?.signal==='deploy'&&j.drive.of==='intake:'+n)out.push([`deploy:intake:${n}`,`${i.kind==='kicker'?'Kicker':'Ramp'} of intake ${n+1}`]);
        if(i.kind!=='kicker')out.push([`float:intake:${n}`,`Roller arm of intake ${n+1} (rides over pieces)`]);});
      out.push(['feeder:any','Feeder (while shooting)'],['wheel','Drive wheel (rolls with the robot)']);return out;};
    const driveKey=j=>j.drive?j.drive.signal+(j.drive.of?':'+j.drive.of:''):'none';
    const where=j=>{const o=toRobot(j.origin),a=dirToRobot(j.axis),names=[['forward','back'],['left','right'],['up','down']],part=(v,i)=>`${fix(Math.abs(v),1)} in ${v>=0?names[i][0]:names[i][1]}`;
      // Along an axis the position means nothing, so a level or upright axis leaves that coordinate out.
      const big=a.map(Math.abs),k=big.indexOf(Math.max(...big)),straight=big[k]>.97,along=straight?['front–back','left–right','up–down'][k]:`(${a.map(v=>fix(v,2)).join(', ')})`;
      return `Pivot ${o.map(part).filter((_,i)=>!straight||i!==k).join(', ')} of the robot’s centre · axis ${along}`;};
    const num=(f,v,{min='',max='',step='any',label,unit:u='',slider=true}={})=>`<div><label>${label}${u?' · '+u:''}<input type="number"${slider&&min!==''?'':' data-slider="off"'} data-f="${f}" value="${esc(finite(v)?fix(v,2):'')}" min="${min}" max="${max}" step="${step}"></label></div>`;
    // Gears and drive wheels follow something else: there is nothing to decide on them unless the finder got them wrong.
    const follows=j=>j.drive?.signal==='wheel'||/gear[0-9]*$/.test(j.id);
    const more=(id,title,html)=>`<details class="sim-mech-code sim-joints-more" data-more="${esc(id)}"${opened.has(id)?' open':''}><summary>${title}</summary>${html}</details>`;
    function body(j){
      const d=j.drive?.signal,n=+String(j.drive?.of||'').split(':')[1]||0,m=api.mechanisms(),intake=d==='deploy'?m.intakes[n]:null,[lv]=level(j),parts=leavesOf(j).size;
      const others=joints().filter(x=>x.id!==j.id);let roleBits='',needs='';
      if(d==='turret')roleBits=`<div class="start-xy">${num('zero',j.zero||0,{label:'Faces in your CAD',unit:'° from the front',min:-180,max:180})}<div class="sim-joint-buttons"><button type="button" class="secondary" data-j="zero" data-v="-90">−90°</button><button type="button" class="secondary" data-j="zero" data-v="90">+90°</button><button type="button" class="secondary" data-j="zero" data-v="180">180°</button></div></div><p class="hint">The arrow shows which way it fires as your CAD has it; a turret angle of 0° faces the robot’s front. It turns ${m.turret?.min??-170}° to ${m.turret?.max??170}° at ${m.turret?.speed??240}°/s (Turret card).</p>`;
      else if(d==='deploy'){const a=j.states?.raised??0,b=j.states?.lowered??0,kind=/^kicker/i.test(j.name)?'kicker':'ramp';
        // Found in the CAD of an intake set up as something that does not swing: it would never go down.
        const still=intake&&intake.kind!=='ramp'&&intake.kind!=='kicker'?`<p class="hint sim-joint-needs">Intake ${n+1} is set up as ${{sweeper:'a sweeper roller',siderollers:'side rollers'}[intake.kind]||esc(intake.kind)}, so this stays up in runs. In your CAD it swings down on a hinge: make intake ${n+1} a ${kind==='ramp'?'deployable ramp':'kicker'} to have it go down while intaking.</p>
          <div class="sim-joint-buttons"><button type="button" class="primary" data-j="intake-kind" data-v="${kind}">Make intake ${n+1} a ${kind==='ramp'?'deployable ramp':'kicker'}</button><button type="button" class="secondary" data-j="intake-kind" data-v="${kind==='ramp'?'kicker':'ramp'}">A ${kind==='ramp'?'kicker':'deployable ramp'} instead</button></div>`:'';
        needs=still;roleBits=`<div class="start-xy">${num('state:raised',a,{label:'Up',unit:'°'})}${num('state:lowered',b,{label:'Down',unit:'°'})}</div><div class="sim-joint-buttons"><button type="button" class="secondary" data-j="show" data-v="raised">Show up</button><button type="button" class="secondary" data-j="show" data-v="lowered">Show down</button><button type="button" class="secondary" data-j="floor">Down to the floor</button></div>
        ${intake?`<div class="start-xy">${num('intake:down',intake.down,{label:'Goes down in',unit:'s',min:0,max:3})}${num('intake:up',intake.up,{label:'Goes up in',unit:'s',min:0,max:3})}</div>`:''}<p class="hint">It goes down while an Intake action runs and back up after; it picks up only once it is all the way down.</p>
        ${intake&&parts?`<div class="sim-joint-buttons"><button type="button" class="secondary" data-j="pickup">Pickup box from the ${j.name.split(' · ')[0].toLowerCase()}</button></div><p class="hint">Sets the intake’s box (the green one: where it picks up) to what the ${j.name.split(' · ')[0].toLowerCase()}’s parts reach when down: ${fix(intake.reach,2)} in out, ${intake.width?fix(intake.width,2)+' in wide':'the whole edge wide'}, ${fix(intake.height,2)} in high now.</p>`:''}`;}
      else if(d==='hood'){const a=j.states?.rest??0,b=j.states?.shoot??0,game=m.shooter?.hood??75;
        roleBits=finite(j.launch)?`<div class="start-xy">${num('shooter:hood',game,{label:'Launch angle',unit:'° above level',min:70,max:85})}${num('launch',j.launch,{label:'Launches in your CAD at',unit:'°',min:0,max:90})}</div>
          <div class="start-xy">${num('state:rest',a,{label:'Resting',unit:'°'})}${num('speed',j.speed??120,{label:'Moves at',unit:'°/s',min:1,max:3600})}</div>
          <div class="start-xy">${num('lower',j.lower,{label:'Tilts down to',unit:'°',slider:false})}${num('upper',j.upper,{label:'Tilts up to',unit:'°',slider:false})}</div>
          <div class="sim-joint-buttons"><button type="button" class="secondary" data-j="show" data-v="rest">Show resting</button><button type="button" class="secondary" data-j="show" data-v="shoot">Show shooting</button><button type="button" class="secondary" data-j="unlaunch">Set the tilt myself</button></div>
          ${(()=>{const want=game-j.launch,tilt=shootTilt(j,game),held=Math.abs(tilt-want)>.05;
            return `<p class="hint${held?' sim-joint-needs':''}">${held?`To shoot at ${fix(game,1)}° it would tilt ${fix(want,1)}°, past its limit, so it stops at ${fix(tilt,1)}° (shots leave at ${fix(j.launch+tilt,1)}° in the picture; the game physics still uses ${fix(game,1)}°). Widen the limits if your hood really goes further, or set the tilt yourself.`:`Its gears turn it ${fix(tilt,1)}° from how your CAD has it, so shots leave at the launch angle, while the shooter spins up and aims; it rests at its resting tilt.`} Positive tilts raise the shot; empty limits mean none.</p>`;})()}`
          :`<div class="start-xy">${num('state:rest',a,{label:'Resting',unit:'°'})}${num('state:shoot',b,{label:'Shooting',unit:'°'})}</div><div class="start-xy">${num('speed',j.speed??120,{label:'Moves at',unit:'°/s',min:1,max:3600})}<div class="sim-joint-buttons"><button type="button" class="secondary" data-j="show" data-v="rest">Show resting</button><button type="button" class="secondary" data-j="show" data-v="shoot">Show shooting</button></div></div>
        ${a===b?'<p class="hint sim-joint-needs">Set how far it tilts to shoot; until then it stays still.</p>':'<p class="hint">It tilts to its shooting angle while the shooter spins up or aims. Shots leave at the launch angle the game physics uses either way.</p>'}`;}
      else if(d==='float'){const top=j.states?.up??0;
        roleBits=`<div class="start-xy">${num('state:rest',j.states?.rest??0,{label:'Rests at',unit:'°'})}${num('state:up',top,{label:'Rides up to',unit:'°'})}</div><div class="sim-joint-buttons"><button type="button" class="secondary" data-j="show" data-v="rest">Show resting</button><button type="button" class="secondary" data-j="show" data-v="up">Show up</button></div>
          <p class="hint">It rests where your CAD has it and rides up over each piece the intake takes in, then settles back${finite(j.upper)?`. Its frame lets it go ${fix(j.upper,1)}° up`:''}. Nothing drives it: it floats.</p>`;}
      else if(d==='flywheel')roleBits=`<p class="hint">Spins at the flywheel speed (${m.shooter?.rpm??3000} rpm, set under Shooter timing), drawn slower so it can be seen.</p>`;
      else if(d==='roller'||d==='feeder')roleBits=`<div class="start-xy">${num('rpm',j.rpm??(d==='roller'?300:200),{label:'Spins at',unit:'rpm',min:1,max:60000})}</div>`;
      else if(d==='wheel')roleBits='<p class="hint">Turns as the robot drives, rolling on the floor.</p>';
      else if(!d&&kin().couplings.some(c=>c.to===j.id)){const c=kin().couplings.find(x=>x.to===j.id),from=joints().find(x=>x.id===c.from);
        roleBits=`<p class="hint">${linkText(c,from)} (set under Linked to other parts).</p>`;}
      else if(d==='action'||!d){const st=Object.entries(j.states||{});
        roleBits=`<span class="sim-mech-label">Named positions</span>${st.map(([k,v])=>`<div class="sim-joint-state"><input aria-label="Position name" data-state-name="${esc(k)}" value="${esc(k)}"><input type="number" data-slider="off" aria-label="${esc(k)} value" data-state-value="${esc(k)}" value="${fix(v,2)}" step="any"><button type="button" class="secondary" data-j="show" data-v="${esc(k)}">Show</button><button type="button" class="icon-button" data-j="unstate" data-v="${esc(k)}" aria-label="Remove ${esc(k)}">×</button></div>`).join('')}
          <button type="button" class="secondary" data-j="state">+ Position</button>${j.type==='revolute'||j.type==='prismatic'?`<div class="start-xy">${num('lower',j.lower,{label:'Lowest',unit:j.type==='prismatic'?'in':'°'})}${num('upper',j.upper,{label:'Highest',unit:j.type==='prismatic'?'in':'°'})}</div>`:''}
          ${kin().actuators.some(a=>a.joint===j.id)?'':num('speed',j.speed??90,{label:'Moves at',unit:j.type==='prismatic'?'in/s':'°/s',min:.01})}<p class="hint">A route action with this joint’s name and a position (for example “${esc(j.name)} ${esc(st[0]?.[0]||'up')}”) moves it there.</p>`;}
      const range=j.type==='prismatic'?[j.lower??-6,j.upper??6]:j.type==='revolute'?[j.lower??-180,j.upper??180]:[-180,180],dof=K().dofOf(j).length;
      const alt=(j.alternatives||[]).map((a,i)=>`<li>${esc(a.note||'Another pivot')} <button type="button" class="secondary" data-j="alt" data-v="${i}">Use it</button></li>`).join('');
      const tools=`${j.note?`<p class="hint">${esc(j.note)}</p>`:''}
        ${kindPick(j)}
        <div class="start-xy"><div><label>Moves by<select data-f="type">${Object.entries(K().TYPES).map(([k,t])=>`<option value="${k}"${k===j.type?' selected':''}>${esc(t.name)}</option>`).join('')}</select></label></div>
          <div><label>Driven by<select data-f="drive">${driveOptions(j).map(([k,t])=>`<option value="${k}"${k===driveKey(j)?' selected':''}>${esc(t)}</option>`).join('')}</select></label></div></div>
        <span class="sim-mech-label">Pivot</span><p class="sim-joint-where">${esc(where(j))}${j.radius?` · ${fix(2*j.radius*unit(),2)} in across`:''}</p>
        <div class="sim-joint-buttons"><button type="button" class="secondary" data-j="circle" aria-pressed="${mode?.kind==='circle'&&mode.joint===j.id}">${mode?.kind==='circle'&&mode.joint===j.id?'Click a round part, hole or edge…':'Pick a circle'}</button>
          <button type="button" class="secondary" data-j="points" aria-pressed="${mode?.kind==='points'&&mode.joint===j.id}">${mode?.kind==='points'&&mode.joint===j.id?(mode.first?'Click a second point on the axis…':'Click a point on the axis…'):'Two points'}</button></div>
        ${alt?`<ul class="sim-joint-alts">${alt}</ul>`:''}
        ${roleBits}
        ${motorBits(j)}
        ${clearanceBits(j)}
        <label class="sim-joint-parent">Rides on<select data-f="parent"><option value="">The robot</option>${others.map(x=>`<option value="${esc(x.id)}"${x.id===j.parent?' selected':''}>${esc(x.name)}</option>`).join('')}</select></label>
        ${links(j)}
        <details class="sim-mech-code"><summary>Exact pivot</summary><p class="hint">Robot inches: x forward, y left, z up from the robot’s centre on the floor.</p>
          <div class="sim-grid3">${toRobot(j.origin).map((v,i)=>num('origin:'+i,v,{label:'Pivot '+'xyz'[i],unit:'in',slider:false})).join('')}</div>
          <div class="sim-grid3">${dirToRobot(j.axis).map((v,i)=>num('axis:'+i,v,{label:'Axis '+'xyz'[i],step:'any',slider:false})).join('')}</div>
          <label>Name<input data-f="name" maxlength="80" value="${esc(j.name)}"></label></details>`;
      return `<div class="sim-joint-body">
        ${parts?'':`<p class="hint sim-joint-needs">No CAD parts move for it yet. Press Choose parts and click them on the model.</p>`}${needs}
        ${dof===1?`<label class="sim-joint-try">Try it<input type="range" data-try min="${range[0]}" max="${range[1]}" step="0.5" value="${fix(K().valuesOf(j,values[j.id]??j.home??0)[0],1)}"></label>`:''}
        <div class="sim-joint-buttons"><button type="button" class="secondary" data-j="flip">Flip direction</button><button type="button" class="secondary" data-j="parts" aria-pressed="${mode?.kind==='parts'&&mode.joint===j.id}">${mode?.kind==='parts'&&mode.joint===j.id?'Click parts to add or remove · Done':`Choose parts (${parts})`}</button><button type="button" class="secondary" data-j="reset-one" title="Put this part back where your CAD has it">Reset</button><button type="button" class="secondary sim-joint-remove" data-j="remove">Remove</button></div>
        ${more('joint:'+j.id,'More',tools)}
      </div>`;
    }
    // Moving with other parts: following one by a ratio (gears, belts, a mirrored finger, a cascade stage), or pinned to
    // one at a shared pin, closing a loop (a four-bar's coupler and rocker), the free joints being solved to keep it shut.
    const linkText=(c,from)=>{const name=`“${esc(from?.name||c.from)}”`,also=(c.plus||[]).map(t=>`“${esc(joints().find(x=>x.id===t.from)?.name||t.from)}”`);
      if(c.curve)return `Follows ${name} through a table of ${c.curve.length} points${c.period?`, repeating every ${fix(c.period,1)}`:''} (a cam, a linkage or stages that move one after another)${also.length?`, plus ${also.join(' and ')}`:''}`;
      return `Turns with ${name}, ${fix(Math.abs(c.ratio),3)}× as far${c.ratio<0?' the other way':''}${c.poly?' (and more at larger angles)':''}${also.length?`, plus ${also.join(' and ')} (a differential, a planetary set or a tendon)`:''}`;};
    function links(j){
      const k=kin(),one=K().dofOf(j).length===1,others=joints().filter(x=>x.id!==j.id&&K().dofOf(x).length===1),c=k.couplings.find(x=>x.to===j.id),loops=k.loops.map((l,i)=>({l,i})).filter(({l})=>l.a.joint===j.id||l.b.joint===j.id),open=c||loops.length;
      const pin=mode?.kind==='loop'&&mode.joint===j.id;
      return `<details class="sim-mech-code"${open?' open':''}><summary>Linked to other parts</summary>
        ${one?`<div class="start-xy"><div><label>Follows<select data-link="from"><option value="">Nothing</option>${others.map(x=>`<option value="${esc(x.id)}"${c?.from===x.id?' selected':''}>${esc(x.name)}</option>`).join('')}</select></label></div>${c&&!c.curve?num('link:ratio',c.ratio,{label:'Times',slider:false})+num('link:offset',c.offset,{label:'Plus',slider:false}):''}${c&&(c.curve||c.plus||c.poly)?`<p class="hint">${linkText(c,joints().find(x=>x.id===c.from))}. Choosing another part here replaces it with a plain ratio.</p>`:''}</div>
        <p class="hint">Its ${j.type==='prismatic'?'travel':'angle'} is the other part’s times this: −1 mirrors it, a gear pair is minus the tooth ratio, a belt plus the pulley ratio, a cascade stage 1.</p>`:''}
        ${loops.map(({l,i})=>{const other=l.a.joint===j.id?l.b.joint:l.a.joint;return `<p class="hint">Pinned to ${esc(other?joints().find(x=>x.id===other)?.name||other:'the robot')} at a shared pin. <button type="button" class="text-button" data-j="unloop" data-v="${i}">Remove</button></p>`;}).join('')}
        <div class="sim-joint-buttons"><label class="sim-joint-parent">Pin it to<select data-loop-other><option value="">The robot</option>${joints().filter(x=>x.id!==j.id).map(x=>`<option value="${esc(x.id)}"${pin&&mode.other===x.id?' selected':''}>${esc(x.name)}</option>`).join('')}</select></label>
          <button type="button" class="secondary" data-j="loop" aria-pressed="${pin}">${pin?'Click the shared pin on the model…':'Pick the shared pin'}</button></div>
        ${loops.length?'<p class="hint">Set Driven by to Nothing on the parts the loop moves; they are worked out to keep it closed.</p>':''}</details>`;
    }
    // A part's motor: what kind, its gearing (stages from the motor to the joint) and how it moves: at its set speed, as
    // a DC motor against a load (free speed and stall torque from its datasheet, through the gearing), or as a pneumatic
    // cylinder that rests at its ends. What the joint gets is worked out and shown.
    const fld=(attr,v,{label,unit:u='',min='',step='any'}={})=>`<div><label>${label}${u?' · '+u:''}<input type="number" data-slider="off" ${attr} value="${finite(v)?+(+v).toPrecision(6):''}" min="${min}" step="${step}"></label></div>`;
    function motorBits(j){
      // Not for a part set by others: one that follows a coupling, one a game signal drives, or one a closed loop solves.
      const k=kin(),a=k.actuators.find(x=>x.joint===j.id),dof=K().dofOf(j);if(!dof.length||j.type==='fixed'||k.couplings.some(c=>c.to===j.id)||(j.drive&&j.drive.signal!=='action')||(!a&&K().pose(k,{}).solved.includes(j.id)))return '';
      if(!a)return '';
      const u=dof[a.index||0]==='in'?'in':'°',au=K().actuatorUnit(a,j),force=u==='in'?'N':'N·m',mm=a.motor,response=a.response||'ideal',stages=a.transmission||[];
      const stage=(st,i)=>`<div class="sim-joint-line" data-stage="${i}"><select aria-label="Stage ${i+1}" data-stage-f="kind">${Object.entries(K().STAGES).map(([v,t])=>`<option value="${v}"${v===st.kind?' selected':''}>${esc(t)}</option>`).join('')}</select>${
        st.kind==='gearbox'?`<label>Ratio<input type="number" data-slider="off" data-stage-f="ratio" value="${fix(st.ratio,3)}" min="0.01" step="any"> : 1</label>`:
        st.kind==='belt'?`<label>Teeth<input type="number" data-slider="off" data-stage-f="driver" value="${fix(st.driver,0)}" min="1" step="1"> to <input type="number" data-slider="off" aria-label="Driven teeth" data-stage-f="driven" value="${fix(st.driven,0)}" min="1" step="1"></label>`:
        st.kind==='screw'?`<label>Lead<input type="number" data-slider="off" data-stage-f="lead" value="${fix(st.lead,4)}" min="0.001" step="any"> in a turn</label>`:
        `<label>${st.kind==='rack'?'Pinion':'Spool'} across<input type="number" data-slider="off" data-stage-f="diameter" value="${fix(st.diameter,3)}" min="0.01" step="any"> in</label>`}<button type="button" class="icon-button" data-j="stage-remove" data-v="${i}" aria-label="Remove stage ${i+1}">×</button></div>`;
      let reach='';
      if(response==='motor'&&mm){const at=K().motorAtJoint(a,j),load=mm.load||0,loaded=at.free*Math.max(0,1-load/at.stall);
        reach=`<p class="hint">At the joint: up to ${fix(at.free,1)} ${u}/s with no load and ${fix(at.stall,2)} ${force} before it stalls${load?`; holding its ${fix(load,2)} ${force} load, ${load>=at.stall?'<strong>it cannot hold it</strong>':`${fix(loaded,1)} ${u}/s`}`:''}.</p>`;}
      return `<details class="sim-mech-code" open><summary>Motor and gearing</summary>
        <div class="start-xy"><div><label>Motor<select data-motor="kind">${Object.entries(K().ACTUATORS).filter(([v])=>v!=='none'&&(api.ftc?.()===false||['servo','crservo','dcmotor','linear'].includes(v)||v===a.kind)).map(([v,t])=>`<option value="${v}"${v===a.kind?' selected':''}>${esc(t)}</option>`).join('')}</select></label></div>
          <div><label>Moves<select data-motor="response">${Object.entries(K().RESPONSES).map(([v,t])=>`<option value="${v}"${v===response?' selected':''}>${esc(t)}</option>`).join('')}</select></label></div></div>
        <span class="sim-mech-label">Gearing, motor to ${esc(j.name)}</span>${stages.map(stage).join('')}<button type="button" class="secondary" data-j="stage-add">+ Stage</button>
        <p class="hint">${stages.length?`The motor turns ${fix(Math.abs(a.ratio),3)}${au==='deg'&&u==='in'?'°':'×'} for each ${u==='in'?'inch':'degree'} the part moves${a.ratio<0?', the other way':''}.`:'Straight onto the joint (no gearing).'}</p>
        ${response==='motor'?`<div class="start-xy">${fld('data-motor="free"',mm?(au==='deg'?mm.free/6:mm.free):NaN,{label:'Free speed',unit:au==='deg'?'rpm':'in/s',min:0})}${fld('data-motor="stall"',mm?.stall,{label:'Stall torque',unit:au==='deg'?'N·m':'N',min:0})}</div>
          <div class="start-xy">${fld('data-motor="count"',mm?.count??1,{label:'Motors',min:1,step:1})}${fld('data-motor="load"',mm?.load??0,{label:'Load it holds',unit:force+' at the joint'})}</div>
          ${fld('data-motor="inertia"',mm?.inertia,{label:'What it moves (inertia, optional)',unit:u==='in'?'kg':'kg·m²',min:0})}${reach}
          <p class="hint">Simulated as a DC motor (torque falls from stall to nothing at free speed): it slows under its load and stalls past it. The load is what you enter, such as gravity on the part; the CAD’s weight is not known.</p>`
        :`<div class="start-xy">${fld('data-motor="speed"',a.speed,{label:'Moves at',unit:`${u}/s`,min:.01})}${fld('data-motor="accel"',a.accel||0,{label:'Speeds up at',unit:`${u}/s² (0: at once)`,min:0})}</div>
          ${response==='pneumatic'?'<p class="hint">It goes all the way out or all the way in, never stopping between (its named positions, else its limits, are the ends).</p>':''}`}
        <div class="sim-joint-buttons"><button type="button" class="secondary" data-j="motor-remove">Remove the motor</button></div></details>`;
    }
    // What actions move: parts moved by route actions without a motor of their own, and motors (with their part's
    // named positions when they have none).
    function moverList(){const k=kin();return [...k.joints.filter(j=>j.drive?.signal==='action'&&K().dofOf(j).length===1&&!k.actuators.some(a=>a.joint===j.id)).map(j=>({id:j.id,name:j.name,states:Object.keys(j.states||{})})),
      ...k.actuators.map(a=>({id:a.id,name:a.name,states:Object.keys(a.states||k.joints.find(x=>x.id===a.joint)?.states||{})}))];}
    // A mover's value in the preview, and setting it.
    function moverValue(id){const k=kin(),a=k.actuators.find(x=>x.id===id),j=k.joints.find(x=>x.id===(a?a.joint:id));if(!j)return NaN;return K().valuesOf(j,values[j.id]??j.home??0)[a?a.index||0:0];}
    function setMover(id,x){const k=kin(),a=k.actuators.find(y=>y.id===id),j=k.joints.find(y=>y.id===(a?a.joint:id));if(!j)return;const q=K().valuesOf(j,values[j.id]??j.home??0);q[a?a.index||0:0]=x;values={...values,[j.id]:q.length===1?q[0]:q};}
    // A new step of a kind, or null (with a reason) when there is nothing to make it from yet.
    function newStep(kind,self){const k=kin(),movers=moverList(),sensors=k.sensors||[],poses=k.poses||[],others=k.actions.filter(a=>a.name!==self);
      if(kind==='move')return movers[0]?{actuator:movers[0].id,command:{state:movers[0].states[0]||''}}:null;
      if(kind==='pose'){if(!poses.length){status('Save a pose first (Poses, below).');return null;}return {pose:poses[0].name};}
      if(kind==='wait'){if(!sensors.length){status('Add a sensor first (Sensors, below).');return null;}return {wait:{sensor:sensors[0].id,is:true},timeout:10};}
      if(kind==='pause')return {wait:{},timeout:1};
      if(kind==='action'){if(!others.length){status('Make another action first.');return null;}return {action:others[0].name};}
      return null;}
    // Saved actions: steps that move parts together, one after another or after a wait; go to a pose; wait for a sensor;
    // run another action. A route action with the name runs it, and it can repeat (a cycle, a gait).
    function actionsSection(){
      const k=kin(),movers=moverList(),sensors=k.sensors||[],poses=k.poses||[];
      if(!movers.length)return '';
      const kindOf=st=>st.pose!==undefined?'pose':st.reach!==undefined?'reach':st.action!==undefined?'action':st.wait!==undefined?(st.wait.sensor?'wait':'pause'):'move';
      const KINDS={move:'Move a part',pose:'Go to a pose',wait:'Wait for a sensor',pause:'Wait',action:'Run an action'};
      const opt=(v,t,on)=>`<option value="${esc(v)}"${on?' selected':''}>${esc(t)}</option>`;
      const stepBits=(a,st)=>{const kind=kindOf(st);
        if(kind==='move'){const mv=movers.find(x=>x.id===st.actuator);return `<select aria-label="Part" data-step-f="actuator">${movers.map(x=>opt(x.id,x.name,x.id===st.actuator)).join('')}</select><select aria-label="Position" data-step-f="state">${(mv?.states||[]).map(x=>opt(x,x,x===st.command.state)).join('')}</select>`;}
        if(kind==='pose')return `<select aria-label="Pose" data-step-f="pose">${poses.map(p=>opt(p.name,p.name,p.name.toLowerCase()===st.pose.toLowerCase())).join('')}</select>`;
        if(kind==='action')return `<select aria-label="Action" data-step-f="run">${k.actions.filter(x=>x!==a).map(x=>opt(x.name,x.name,x.name.toLowerCase()===st.action.toLowerCase())).join('')}</select>`;
        if(kind==='reach')return `<span class="hint">to a point (from the file)</span>`;
        if(kind==='pause')return `<label>for<input type="number" data-slider="off" aria-label="Seconds" data-step-f="timeout" min="0" step="any" value="${fix(st.timeout??0,2)}"> s</label>`;
        const w=st.wait,cond=w.is===true?'is':w.is===false?'not':'above' in w?'above':'below';
        return `<select aria-label="Sensor" data-step-f="sensor">${sensors.map(x=>opt(x.id,x.name,x.id===w.sensor)).join('')}</select><select aria-label="Until it" data-step-f="cond">${opt('is','closes',cond==='is')}${opt('not','opens',cond==='not')}${opt('above','reads at least',cond==='above')}${opt('below','reads at most',cond==='below')}</select>
          ${cond==='above'||cond==='below'?`<input type="number" data-slider="off" aria-label="Reading" data-step-f="value" step="any" value="${fix(w.above??w.below,2)}">`:''}<label>at most<input type="number" data-slider="off" aria-label="Give up after, seconds" data-step-f="timeout" min="0" step="any" value="${fix(st.timeout??10,1)}"> s</label>`;};
      return `<div class="sim-joint-actions"><div class="sim-joints-head"><h4>Actions</h4><button type="button" class="secondary" data-j="action-add">+ Action</button></div>
        <p class="hint">Steps that move parts together, one after another or after a wait. A route action with the action’s name runs it; at a pin the robot waits until it is done.</p>
        ${k.actions.map((a,i)=>`<section class="sim-joint-action" data-action="${i}"><div class="sim-joint-action-head"><input aria-label="Action name" data-act="name" maxlength="40" value="${esc(a.name)}"><label>Repeat<input type="number" data-slider="off" data-act="repeat" min="1" max="100" step="1" value="${a.repeat||1}">×</label><button type="button" class="secondary" data-j="action-play">Play</button><button type="button" class="icon-button" data-j="action-remove" aria-label="Remove ${esc(a.name)}">×</button></div>
          <ol>${a.steps.map((st,n)=>`<li data-step="${n}"><select aria-label="Step ${n+1}" data-step-f="kind">${Object.entries(KINDS).map(([v,t])=>opt(v,t,v===kindOf(st))).join('')}${kindOf(st)==='reach'?opt('reach','Reach (from the file)',true):''}</select>${stepBits(a,st)}
            <select aria-label="Starts" data-step-f="after"><option value="">at the start</option>${a.steps.slice(0,n).map((_,m)=>`<option value="${m}"${st.after===m?' selected':''}>after step ${m+1}</option>`).join('')}</select>
            <label>+<input type="number" data-slider="off" aria-label="Wait first, seconds" data-step-f="delay" min="0" max="60" step="any" value="${fix(st.delay,2)}"> s</label><button type="button" class="icon-button" data-j="step-remove" aria-label="Remove step ${n+1}">×</button></li>`).join('')}</ol>
          <button type="button" class="secondary" data-j="step-add">+ Step</button></section>`).join('')}</div>`;
    }
    // Poses: where several parts are at once ("Home", "Over the bin"), saved from the preview. A step going to one moves
    // every part in it so all arrive together.
    function posesSection(){
      const k=kin();if(!moverList().length)return '';
      return `<div class="sim-joint-actions"><div class="sim-joints-head"><h4>Poses</h4><button type="button" class="secondary" data-j="pose-save">+ Pose from the preview</button></div>
        <p class="hint">Put the parts where you want them with Try it or Show, then save the pose. Going to a pose moves every part in it so they all arrive at the same time.</p>
        ${(k.poses||[]).map((p,i)=>`<div class="sim-joint-line" data-pose="${i}"><input aria-label="Pose name" data-pose-f="name" maxlength="40" value="${esc(p.name)}"><span class="hint">${Object.keys(p.values).length} part${Object.keys(p.values).length===1?'':'s'}</span><button type="button" class="secondary" data-j="pose-show" data-v="${i}">Show</button><button type="button" class="icon-button" data-j="pose-remove" data-v="${i}" aria-label="Remove ${esc(p.name)}">×</button></div>`).join('')}</div>`;
    }
    // Sensors read the simulated motion, not the command: an encoder counts turns, a limit switch closes at a position,
    // an angle or distance sensor reads it, a speed sensor reads a motor's speed. An action step can wait for one.
    function sensorsSection(){
      const k=kin(),on=[...k.actuators.map(a=>({id:'a:'+a.id,name:a.name+' (motor)'})),...k.joints.filter(j=>K().dofOf(j).length&&j.type!=='fixed').map(j=>({id:'j:'+j.id,name:j.name}))];if(!on.length)return '';
      return `<div class="sim-joint-actions"><div class="sim-joints-head"><h4>Sensors</h4><button type="button" class="secondary" data-j="sensor-add">+ Sensor</button></div>
        <p class="hint">They read how the robot actually moves in the simulation, not what it was told. An action step can wait for one.</p>
        ${(k.sensors||[]).map((x,i)=>{const at=x.actuator?'a:'+x.actuator:'j:'+x.joint,kinds=Object.entries(K().SENSORS).filter(([v])=>v!=='velocity'||x.actuator);
          return `<div class="sim-joint-line" data-sensor="${i}"><input aria-label="Sensor name" data-sensor-f="name" maxlength="80" value="${esc(x.name)}"><select aria-label="Kind" data-sensor-f="kind">${kinds.map(([v,t])=>`<option value="${v}"${v===x.kind?' selected':''}>${esc(t)}</option>`).join('')}</select>
            <select aria-label="On" data-sensor-f="on">${on.map(o=>`<option value="${esc(o.id)}"${o.id===at?' selected':''}>${esc(o.name)}</option>`).join('')}</select>
            ${x.kind==='encoder'?`<label>Counts a turn<input type="number" data-slider="off" data-sensor-f="cpr" min="1" step="any" value="${fix(x.cpr,1)}"></label>`:x.kind==='limit'?`<label>Closes at<input type="number" data-slider="off" data-sensor-f="at" step="any" value="${fix(x.at,2)}"></label><label>within<input type="number" data-slider="off" data-sensor-f="band" min="0" step="any" value="${fix(x.band,2)}"></label>`:''}
            <button type="button" class="icon-button" data-j="sensor-remove" data-v="${i}" aria-label="Remove ${esc(x.name)}">×</button></div>`;}).join('')}</div>`;
    }
    function render(){
      const k=kin(),m=meta(),cadOk=!!arrays()&&!!m?.id,list=k.model===m?.id?k.joints:[];
      const typing=host.contains(document.activeElement)&&document.activeElement.matches('input:not([type=range]),select');
      const key=JSON.stringify([k,open,mode,cadOk,api.mechanisms(),!!api.hitboxes?.(),followers]);if(typing||key===lastKey){gizmos();return;}lastKey=key;
      host.hidden=!cadOk&&!list.length;
      host.innerHTML=`<div class="sim-joints-head"><h3>Moving parts</h3><div class="sim-joint-buttons"><button type="button" class="secondary" data-j="find">${list.length?'Find again':'Find moving parts'}</button>${list.length?`<button type="button" class="secondary" data-j="demo" aria-pressed="${!!demo}">${demo?'Stop':'Play'}</button><button type="button" class="secondary" data-j="hitboxes" aria-pressed="${!!api.hitboxes?.()}" title="A box round each moving part's CAD parts, moving with it">Hitboxes</button><button type="button" class="secondary" data-j="reset" title="Put every moving part back where your CAD has it">Reset</button>`:''}</div></div>
        <p class="hint sim-joints-status" role="status"></p>
        ${list.length?`<ol class="sim-joint-list">${list.filter(j=>followers||open===j.id||!follows(j)).map(j=>{const [lv,text]=level(j),on=open===j.id,t=TY()?.of(j),kind=t&&!TY().says(t,j.name)?t.name:'';return `<li class="sim-joint" data-id="${esc(j.id)}"><button type="button" class="sim-joint-row" data-j="toggle" aria-expanded="${on}"><i data-color="${hex(colorOf(j))}"></i><span>${esc(j.name)}${kind?`<em class="sim-joint-kind">${esc(kind)}</em>`:''}</span>${lv==='check'||lv==='stand'?`<small class="sim-joint-badge" data-level="${lv}">${lv==='check'?'Check this':esc(text)}</small>`:''}</button>${on?body(j):''}</li>`;}).join('')}</ol>${list.some(follows)?`<button type="button" class="text-button sim-joint-followers" data-j="followers">${followers?'Hide':'Show'} gears and wheels (${list.filter(follows).length})</button>`:''}`:`<p class="hint">${cadOk?'Find the pivots, axles and moving parts in your CAD, then check each one on the model.':'Import your robot as a STEP assembly to find its moving parts.'}</p>`}${list.length?more('extras','Actions, poses and sensors',actionsSection()+posesSection()+sensorsSection()):''}`;
      // Colours go in through the style object (the page allows no inline style attributes).
      for(const dot of host.querySelectorAll("[data-color]"))dot.style.background=dot.dataset.color;
      highlight();gizmos();
    }
    function highlight(){const p=preview();if(!p)return;const j=joints().find(x=>x.id===open);if(!j&&api.glow)return api.glow();p.highlight(j?leavesOf(j):null,j?colorOf(j):undefined);}
    // Pivot marks on the preview, posed with the joints' current preview values.
    function gizmos(){
      const p=preview(),body=p?.body?.(),kmod=body?.userData?.kin?.model;if(!p||!kmod){p?.gizmos([]);return;}
      const pose=K().pose(kmod,values),stand=new Set(body.userData.kin.standIns),M=math(),Pm=P();
      const list=kmod.joints.filter(j=>open?j.id===open:followers||!follows(j)).map(j=>{const W=j.parent?pose.W.get(j.parent):M.I4(),o=M.apply(W,j.origin),a=M.applyDir(W,j.axis),ro=stand.has(j.id)||!Pm?o:M.apply(Pm,o),ra=stand.has(j.id)||!Pm?M.unit(a):M.unit(M.applyDir(Pm,a));
        let arrow=null;if(j.drive?.signal==='turret'){const q=(K().valuesOf(j,pose.q[j.id])[0]||0)+(j.zero||0),t=q*Math.PI/180;arrow=[Math.cos(t),Math.sin(t),0];}
        return {origin:ro,axis:ra,radius:j.radius?j.radius*(stand.has(j.id)?1:unit()):1,color:colorOf(j),dim:!open,arrow,lift:arrow?2:0};});
      p.gizmos(list);
    }
    function showPose(){const p=preview();if(!p)return;p.posed(values);gizmos();}
    // ---- picking on the model
    function picker(){
      if(!mode)return null;
      return hit=>{if(!hit)return;const j=joints().find(x=>x.id===mode.joint);if(!j){mode=null;render();return;}
        if(mode.kind==='circle'){const c=ctx();if(!c||!Number.isFinite(hit.part))return status('Click a part of the model.');const fit=D().fitAt(c,{leaf:Math.round(hit.part),point:hit.local,face:hit.face});
          if(fit.error)return status(fit.error);const id=j.id;mode=null;
          change(id,x=>{x.origin=fit.origin;x.axis=orient(x,fit.axis,fit.origin);x.radius=fit.radius;x.note=`Pivot measured on “${fit.name}” (${fit.kind==='hole'?'a hole':fit.kind==='edge'?'a round edge':fit.kind==='part'?'a round part':'a curved surface'}, ${fix(2*fit.radius*unit(),2)} in across).`;delete x.alternatives;});
          status(`Pivot set on “${fit.name}”.`);}
        else if(mode.kind==='points'){const p=fromRobot([hit.x,hit.y,hit.z]);if(!mode.first){mode.first=p;status('Now click a second point along the same axis.');render();return;}
          const a=math().sub(p,mode.first);if(math().len(a)<1e-3)return status('Pick a point further from the first.');const first=mode.first,id=j.id;mode=null;
          change(id,x=>{x.origin=first;x.axis=orient(x,math().unit(a),first);x.note='Pivot set from two points on the model.';delete x.alternatives;});status('Pivot set through the two points.');}
        else if(mode.kind==='loop'){const p=fromRobot([hit.x,hit.y,hit.z]),other=mode.other||null,id=j.id;mode=null;const next=structuredClone(kin());next.loops.push({a:{joint:id,point:p},b:{joint:other,point:p}});api.commit(next);
          status(`Pinned at that point. ${joints().find(x=>x.id===other)?.name||'The robot'} and ${j.name} now stay joined there.`);}
        else if(mode.kind==='parts'){const c=ctx();if(!c||!Number.isFinite(hit.part))return;const leaf=Math.round(hit.part),set=leavesOf(j),name=c.parts.name(leaf);
          // Shift-click takes the whole assembly the part sits in.
          const group=hit.shift?[...c.parts.leavesUnder(c.parts.nodes[c.tree.leaf[leaf]])]:[leaf],adding=!set.has(leaf);for(const k of group)adding?set.add(k):set.delete(k);
          change(j.id,x=>{x.parts=c.parts.compress(set);});status(`${adding?'Added':'Removed'} “${name}”${group.length>1?` and the ${group.length-1} other parts with it`:''}.`);}
      };
    }
    // A turret's axis points up; a ramp's turns so positive angles lower it; others stay as measured.
    function orient(j,axis,origin){const M=math(),u=up();
      if(j.drive?.signal==='turret')return M.dot(axis,u)>=0?axis:M.scale(axis,-1);
      if(j.drive?.signal==='deploy'){const c=centroid(j);if(c){const t=M.apply(M.about(origin,axis,10),c);if(M.dot(t,u)>M.dot(c,u))return M.scale(axis,-1);}}
      return axis;}
    // The intake's pickup box from where a ramp's or kicker's parts reach when it is down: how far past the chassis edge,
    // how wide along it and how high (robot inches).
    function pickupBox(j){
      const c=ctx(),Pm=P(),n=+String(j.drive?.of||'').split(':')[1]||0,intake=api.mechanisms().intakes[n],f=api.footprint?.();if(!c||!Pm||!intake||!f)return;
      const W=math().mul(Pm,K().motion(j,j.states?.lowered??0,unit())),[dx,dy]={front:[1,0],back:[-1,0],left:[0,1],right:[0,-1]}[intake.sides[0]]||[1,0],edge=dx>0?f.front:dx<0?f.rear:f.half;
      let out=-Infinity,side=0,top=0;for(const k of leavesOf(j)){const v=c.vertsOf(k),step=Math.max(1,Math.floor(v.length/2000));for(let i=0;i<v.length;i+=step){const p=math().apply(W,c.P(v[i]));out=Math.max(out,dx*p[0]+dy*p[1]);side=Math.max(side,Math.abs(-dy*p[0]+dx*p[1]));top=Math.max(top,p[2]);}}
      if(!finite(out))return status('It has no parts to measure.');const box={reach:+Math.max(0,out-edge).toFixed(2),width:+Math.max(1,2*side).toFixed(2),height:+Math.max(1,Math.min(24,top)).toFixed(2)};
      api.setIntake(n,box);status(`Intake ${n+1}’s pickup box: ${box.reach} in out, ${box.width} in wide, ${box.height} in high, as the ${j.name.split(' · ')[0].toLowerCase()} reaches when down.`);
    }
    // An intake's box from its outermost point: every part of it where the CAD has it, and whatever swings, where it ends up
    // when it is down. Says which part reaches furthest, and what that part is.
    function fitIntake(n){const c=ctx(),Pm=P(),m=api.mechanisms(),intake=m.intakes?.[n],f=api.footprint?.(),Mech=root.DeckMechanisms;if(!c||!Pm||!intake||!f)return null;
      const [dx,dy]={front:[1,0],back:[-1,0],left:[0,1],right:[0,-1]}[intake.sides[0]]||[1,0],edge=dx>0?f.front:dx<0?f.rear:f.half,mine=joints().filter(j=>j.drive?.of==='intake:'+n),named=(intake.parts||[]).map(x=>(api.meta()?.parts||[]).find(p=>p.name===x)?.key).filter(Boolean);
      let out=-Infinity,side=0,top=0,far=null;const take=(leaves,W)=>{for(const k of leaves){const v=c.vertsOf(k),step=Math.max(1,Math.floor(v.length/2000));for(let i=0;i<v.length;i+=step){const p=math().apply(W,c.P(v[i])),o=dx*p[0]+dy*p[1];if(o>out){out=o;far=k;}side=Math.max(side,Math.abs(-dy*p[0]+dx*p[1]));top=Math.max(top,p[2]);}}};
      take(c.parts.expand(named),Pm);for(const j of mine){take(leavesOf(j),Pm);if(j.drive.signal==='deploy')take(leavesOf(j),math().mul(Pm,K().motion(j,j.states?.lowered??0,unit())));}
      if(!finite(out))return null;const up=v=>Math.ceil(v*4-1e-6)/4;api.setIntake(n,{reach:Math.min(18,up(Math.max(0,out-edge))),width:Math.min(48,Math.max(1,up(2*side))),height:Math.min(24,Math.max(1,up(top)))});
      const name=c.parts.nodes?.find(x=>x.leaves?.includes(far))?.name||'',spins=mine.some(j=>['roller','feeder'].includes(j.drive.signal)&&leavesOf(j).has(far));return {name:name.replace(/\s*<\d+>$/,''),kind:spins?'wheel':Mech?.partKindOf?Mech.partKindOf(name):'body'};}
    function centroid(j){const c=ctx();if(!c)return null;let A=0;const s=[0,0,0];for(const k of leavesOf(j)){const f=D().feature(c,k);if(!f)continue;A+=f.area;for(let i=0;i<3;i++)s[i]+=f.area*f.center[i];}return A?s.map(v=>v/A):null;}
    // Plays a saved action on the preview, along its timeline.
    function playAction(i){
      const k=kin(),a=k.actions[i];if(!a)return;if(demo){cancelAnimationFrame(demo);demo=0;}const tl=K().timeline(k,a),t0=performance.now();
      const step=now=>{const t=(now-t0)/1000,v=K().sampleTimeline(k,tl,Math.min(t,tl.duration)),out={...values};for(const [id,x] of Object.entries(v)){const act=k.actuators.find(y=>y.id===id);if(!act){out[id]=x;continue;}const jj=k.joints.find(y=>y.id===act.joint),q=K().valuesOf(jj,out[act.joint]??jj?.home??0);q[act.index||0]=x;out[act.joint]=q.length===1?q[0]:q;}
        values=out;showPose();if(t<tl.duration+.4)demo=requestAnimationFrame(step);else demo=0;};demo=requestAnimationFrame(step);status(`Playing “${a.name}” (${fix(tl.duration,2)} s).`);
    }
    // ---- the demo: every joint through its motion in a loop
    function play(){
      if(demo){cancelAnimationFrame(demo);demo=0;values={};showPose();render();return;}
      const solved=new Set(K().pose(kin(),{}).solved),t0=performance.now(),step=now=>{const t=(now-t0)/1000,ph=(Math.sin(t*1.4)+1)/2,v={};
        for(const j of joints()){const d=j.drive?.signal;if(solved.has(j.id))continue;
          if(d==='turret')v[j.id]=60*Math.sin(t*.9);else if(d==='deploy'){const a=j.states?.raised??0,b=j.states?.lowered??0;v[j.id]=a+(b-a)*ph;}
          else if(d==='float'){const a=j.states?.rest??0,b=j.states?.up??a;v[j.id]=a+(b-a)*ph;}
          // A hood with limits shows its whole pitch range; else it goes between resting and shooting.
          else if(d==='hood'){const lim=finite(j.lower)&&finite(j.upper)&&j.upper-j.lower>1,a=lim?j.lower:j.states?.rest??0,b=lim?j.upper:shootTilt(j,api.mechanisms().shooter?.hood);v[j.id]=a+(b-a)*ph;}else if(d==='wheel')v[j.id]=(t*240)%360;else if(['flywheel','roller','feeder'].includes(d)){const s=api.mechanisms().shooter;v[j.id]=t*K().shownRate(d==='flywheel'?Math.min(s?.rpm||3000,j.rpm||Infinity):j.rpm||(d==='roller'?300:200));}
          else if(j.type==='revolute'){const a=j.lower??-30,b=j.upper??30;v[j.id]=a+(b-a)*ph;}else if(j.type==='prismatic'){const a=j.lower??0,b=j.upper??4;v[j.id]=a+(b-a)*ph;}else if(j.type==='continuous')v[j.id]=(t*90)%360;}
        values=v;showPose();demo=requestAnimationFrame(step);};demo=requestAnimationFrame(step);render();
    }
    // ---- events
    // What is unfolded stays unfolded when the panel redraws.
    host.addEventListener('toggle',e=>{const id=e.target.dataset?.more;if(id===undefined)return;if(e.target.open)opened.add(id);else opened.delete(id);},true);
    host.addEventListener('click',e=>{
      const b=e.target.closest('[data-j]');if(!b)return;const what=b.dataset.j,li=b.closest('[data-id]'),id=li?.dataset.id,j=joints().find(x=>x.id===id);
      // Back to the CAD's own pose: nothing is saved by moving a part here, so this only clears what was moved.
      if(what==='reset'){if(demo)play();values={};showPose();for(const r of host.querySelectorAll('[data-try]')){const x=joints().find(q=>q.id===r.closest('[data-id]')?.dataset.id);r.value=K().valuesOf(x,x?.home??0)[0];}status('Everything is back where your CAD has it.');return;}
      if(what==='reset-one'&&j){if(demo)play();const rest={...values};delete rest[id];values=rest;showPose();const r=li.querySelector('[data-try]');if(r)r.value=K().valuesOf(j,j.home??0)[0];return;}
      if(what==='followers'){followers=!followers;lastKey='';render();return;}
      if(what==='find'){discover();return;}
      const ai=+b.closest('[data-action]')?.dataset.action;
      if(what==='action-add'){const next=structuredClone(kin()),first=next.joints.find(x=>x.drive?.signal==='action'&&Object.keys(x.states||{}).length)||next.actuators[0];if(!first)return;
        let name='Action '+(next.actions.length+1);next.actions.push({name,steps:[{actuator:first.id,command:{state:Object.keys(first.states||{})[0]||''}}]});api.commit(next);return;}
      if(what==='action-remove'){const next=structuredClone(kin());next.actions.splice(ai,1);api.commit(next);return;}
      if(what==='action-play'){playAction(ai);return;}
      if(what==='pose-save'){const next=structuredClone(kin()),vals={};for(const mv of moverList()){const x=moverValue(mv.id);if(finite(x))vals[mv.id]=+x.toFixed(3);}
        let name='Pose '+((next.poses||[]).length+1);next.poses=[...(next.poses||[]),{name,values:vals}];api.commit(next);status(`Saved “${name}”: where ${Object.keys(vals).length} part${Object.keys(vals).length===1?' is':'s are'} in the preview now.`);return;}
      if(what==='pose-show'){const p=kin().poses?.[+b.dataset.v];if(!p)return;for(const [id2,x] of Object.entries(p.values))setMover(id2,x);showPose();return;}
      if(what==='pose-remove'){const next=structuredClone(kin());next.poses.splice(+b.dataset.v,1);api.commit(next);return;}
      if(what==='sensor-add'){const next=structuredClone(kin()),on=next.actuators[0]?{actuator:next.actuators[0].id}:{joint:moverList()[0]?.id||next.joints[0]?.id};let n=(next.sensors||[]).length+1,sid='sensor'+n;while([...next.joints,...next.actuators,...(next.sensors||[])].some(x=>x.id===sid))sid+='b';
        next.sensors=[...(next.sensors||[]),{id:sid,name:'Sensor '+n,kind:on.actuator?'encoder':'limit',...on,...(on.actuator?{cpr:537.7}:{at:0,band:.5})}];api.commit(next);return;}
      if(what==='sensor-remove'){const next=structuredClone(kin());next.sensors.splice(+b.dataset.v,1);api.commit(next);return;}
      if(what==='step-add'){const next=structuredClone(kin()),a=next.actions[ai],last=a.steps.at(-1);a.steps.push({...structuredClone(last),after:a.steps.length-1,delay:0});api.commit(next);return;}
      if(what==='step-remove'){const next=structuredClone(kin()),a=next.actions[ai],n=+b.closest('[data-step]').dataset.step;a.steps.splice(n,1);for(const st of a.steps)if(st.after!==null&&st.after>=n)st.after=st.after>n?st.after-1:null;if(!a.steps.length)next.actions.splice(ai,1);api.commit(next);return;}
      if(what==='demo'){play();return;}
      if(what==='hitboxes'){api.setHitboxes?.(!api.hitboxes?.());lastKey='';render();return;}
      if(what==='toggle'){open=open===id?null:id;mode=null;if(demo)play();values={};showPose();render();return;}
      if(!j)return;
      if(what==='circle'||what==='points'||what==='parts'){mode=mode?.kind===what&&mode.joint===id?null:{kind:what,joint:id};
        status(mode?{circle:'Click a round part (gear, bearing, shaft, wheel), a hole or a round edge on the model.',points:'Click a point on the pivot axis, then another along it.',parts:'Click parts to add or remove them (Shift-click: the whole assembly). Click Done when finished.'}[what]:'');api.refreshPicker();render();return;}
      if(what==='flip'){change(id,x=>{x.axis=x.axis.map(v=>-v);if(x.drive?.signal==='turret')x.zero=((x.zero||0)+360)%360-180;});return;}
      if(what==='zero'){change(id,x=>{x.zero=((((x.zero||0)+ +b.dataset.v)%360)+540)%360-180;});return;}
      if(what==='show'){const v=j.drive?.signal==='hood'&&b.dataset.v==='shoot'?shootTilt(j,api.mechanisms().shooter?.hood):j.states?.[b.dataset.v];if(finite(v)){values={...values,[id]:v};showPose();const r=li.querySelector('[data-try]');if(r)r.value=v;}return;}
      if(what==='unlaunch'){change(id,x=>{x.states={...x.states,shoot:+shootTilt(x,api.mechanisms().shooter?.hood).toFixed(2)};delete x.launch;});return;}
      if(what==='pickup'){pickupBox(j);return;}
      if(what==='intake-kind'){const n=+String(j.drive?.of||'').split(':')[1]||0,kind=b.dataset.v==='kicker'?'kicker':'ramp';api.setIntake(n,{kind});
        if(!j.name.toLowerCase().startsWith(kind)){const next=structuredClone(kin()),x=next.joints.find(y=>y.id===id);x.name=x.name.replace(/^(Ramp|Kicker)\b/,kind==='kicker'?'Kicker':'Ramp');api.commit(next);}
        lastKey='';render();status(`Intake ${n+1} is a ${kind==='ramp'?'deployable ramp':'kicker'} now: ${j.name.split(' · ')[0].toLowerCase()} goes down while it intakes. Its servo and timing are under Intakes.`);return;}
      if(what==='motor-add'){const next=structuredClone(kin()),mid=motorId(next,j.id);
        // The motor its type is usually driven by (a servo for a claw, a geared DC motor and spool for a lift), as the FTC
        // part it usually is (DeckActuators): its speed, torque and encoder counts.
        next.actuators.push(actuatorFor(j,mid));
        // Steps that moved the part now move its motor.
        for(const a of next.actions)for(const st of a.steps)if(st.actuator===j.id)st.actuator=mid;for(const p of next.poses||[])if(j.id in p.values){p.values[mid]=p.values[j.id];delete p.values[j.id];}
        api.commit(next);status('Motor added. Set its gearing, and its free speed and stall torque from its datasheet to see what it can do.');return;}
      if(what==='motor-remove'){const next=structuredClone(kin()),a=next.actuators.find(x=>x.joint===id);if(!a)return;next.actuators=next.actuators.filter(x=>x!==a);
        for(const ac of next.actions)for(const st of ac.steps)if(st.actuator===a.id)st.actuator=id;for(const p of next.poses||[])if(a.id in p.values){p.values[id]=p.values[a.id];delete p.values[a.id];}next.sensors=(next.sensors||[]).filter(x=>x.actuator!==a.id);api.commit(next);return;}
      if(what==='stage-add'){motorChange(id,a=>{a.transmission=[...(a.transmission||[]),{kind:'gearbox',ratio:20}];});return;}
      if(what==='stage-remove'){motorChange(id,a=>{a.transmission.splice(+b.dataset.v,1);if(!a.transmission.length){delete a.transmission;a.ratio=1;}});return;}
      if(what==='floor'){const c=ctx();if(!c)return;const u=up();let floor=Infinity;for(const x of [c.lo[0],c.hi[0]])for(const y of [c.lo[1],c.hi[1]])for(const z of [c.lo[2],c.hi[2]])floor=Math.min(floor,x*u[0]+y*u[1]+z*u[2]);
        const a=D().swingToFloor(c,[...leavesOf(j)],j.origin,j.axis,{up:u,floor,clearance:.02/unit()});if(a===null)return status('It does not reach the floor within 150°; type how far it goes down.');
        change(id,x=>{x.states={...x.states,lowered:a};});values={...values,[id]:a};status(`Down set to ${a}°, where it touches the floor.`);return;}
      if(what==='alt'){const a=j.alternatives?.[+b.dataset.v];if(a)change(id,x=>{x.origin=a.origin;x.axis=a.axis;x.note=a.note;x.alternatives=(j.alternatives||[]).filter((_,i)=>i!==+b.dataset.v).concat([{origin:j.origin,axis:j.axis,note:'The pivot it had before'}]);});return;}
      if(what==='state'){change(id,x=>{const s=x.states||{};let name='position '+(Object.keys(s).length+1);s[name]=0;x.states=s;});return;}
      if(what==='unstate'){change(id,x=>{delete x.states[b.dataset.v];});return;}
      if(what==='clear'){void check(j);return;}
      if(what==='hit'){const h=clearance[id]?.hits?.[+b.dataset.v];if(!h)return;values={...values,[id]:h.at};showPose();const p=preview();p?.highlight(new Set(h.parts.flat()),0xe5484d);const r=li.querySelector('[data-try]');if(r)r.value=h.at;return;}
      if(what==='limits'){const c=clearance[id];if(!c)return;change(id,x=>{x.lower=c.free[0];x.upper=c.free[1];});return;}
      if(what==='loop'){const other=li.querySelector('[data-loop-other]')?.value||'';mode=mode?.kind==='loop'&&mode.joint===id?null:{kind:'loop',joint:id,other};status(mode?'Click the pin the two parts share on the model.':'');api.refreshPicker();render();return;}
      if(what==='unloop'){const next=structuredClone(kin());next.loops.splice(+b.dataset.v,1);api.commit(next);return;}
      if(what==='remove'){const next=structuredClone(kin());next.joints=next.joints.filter(x=>x.id!==id);for(const x of next.joints)if(x.parent===id)x.parent=null;open=null;mode=null;api.commit(next);return;}
    });
    host.addEventListener('change',e=>{
      const el=e.target,act=el.closest('[data-action]');
      if(act&&!el.closest('[data-id]')){const i=+act.dataset.action,next=structuredClone(kin()),a=next.actions[i];if(!a)return;
        if(el.dataset.act==='name'){const name=el.value.trim();if(name)a.name=name;}
        else if(el.dataset.act==='repeat'){const n=Math.round(el.valueAsNumber);if(n>1)a.repeat=Math.min(100,n);else delete a.repeat;}
        else{const n=+el.closest('[data-step]').dataset.step,st=a.steps[n],f2=el.dataset.stepF,v=el.value,num2=el.valueAsNumber;
          if(f2==='kind'){const fresh=newStep(v,a.name);if(!fresh)return;a.steps[n]={...fresh,after:st.after,delay:st.delay};}
          else if(f2==='actuator'){st.actuator=v;const mv=moverList().find(x=>x.id===v);st.command={state:mv?.states[0]||''};}
          else if(f2==='state')st.command={state:v};else if(f2==='pose')st.pose=v;else if(f2==='run')st.action=v;else if(f2==='sensor')st.wait.sensor=v;
          else if(f2==='cond'){const keep=st.wait.above??st.wait.below??0;st.wait={sensor:st.wait.sensor,...(v==='is'?{is:true}:v==='not'?{is:false}:{[v]:keep})};}
          else if(f2==='value'&&finite(num2)){if('above' in st.wait)st.wait.above=num2;else if('below' in st.wait)st.wait.below=num2;}
          else if(f2==='timeout'&&finite(num2))st.timeout=Math.max(0,num2);else if(f2==='after')st.after=v===''?null:+v;else if(f2==='delay'&&finite(num2))st.delay=num2;}
        api.commit(next);return;}
      const pose=el.closest('[data-pose]');if(pose&&el.dataset.poseF==='name'){const next=structuredClone(kin()),p=next.poses[+pose.dataset.pose],name=el.value.trim();if(p&&name){p.name=name;api.commit(next);}return;}
      const sensor=el.closest('[data-sensor]');if(sensor){const next=structuredClone(kin()),x=next.sensors[+sensor.dataset.sensor],f3=el.dataset.sensorF;if(!x)return;
        if(f3==='name'){const name=el.value.trim();if(name)x.name=name;}else if(f3==='kind'){x.kind=el.value;if(x.kind==='encoder')x.cpr??=537.7;if(x.kind==='limit'){x.at??=0;x.band??=.5;}}
        else if(f3==='on'){const [t,ref]=[el.value.slice(0,1),el.value.slice(2)];delete x.actuator;delete x.joint;delete x.index;x[t==='a'?'actuator':'joint']=ref;}
        else if(finite(el.valueAsNumber))x[f3]=el.valueAsNumber;api.commit(next);return;}
      const li=el.closest('[data-id]'),id=li?.dataset.id,j=joints().find(x=>x.id===id);if(!j)return;const f=el.dataset.f;
      if(el.dataset.motor){const f4=el.dataset.motor,v=el.type==='number'?el.valueAsNumber:el.value;if(el.type==='number'&&!finite(v)&&el.value.trim()!=='')return;
        motorChange(id,a=>{if(f4==='kind')a.kind=v;else if(f4==='response'){a.response=v;if(v==='motor')a.motor=a.motor||{free:(a.speed||90)*Math.abs(a.ratio||1),stall:1};}
          else if(f4==='speed'||f4==='accel'){if(finite(v))a[f4]=v;}else{a.motor=a.motor||{free:600,stall:1};if(el.value.trim()==='')delete a.motor[f4];else a.motor[f4]=f4==='free'&&K().actuatorUnit(a,j)==='deg'?v*6:v;}});return;}
      const stage=el.closest('[data-stage]');if(stage){const i=+stage.dataset.stage,f5=el.dataset.stageF;motorChange(id,a=>{const st=a.transmission[i];if(!st)return;
        if(f5==='kind'){a.transmission[i]={kind:el.value,...{gearbox:{ratio:20},belt:{driver:20,driven:40},spool:{diameter:1.5},rack:{diameter:1},screw:{lead:.315}}[el.value]};}else if(finite(el.valueAsNumber)&&el.valueAsNumber>0)st[f5]=el.valueAsNumber;});return;}
      if(el.dataset.link==='from'){const next=structuredClone(kin());next.couplings=next.couplings.filter(c=>c.to!==id);if(el.value)next.couplings.push({kind:'mimic',from:el.value,to:id,ratio:1,offset:0});api.commit(next);return;}
      if(el.matches('[data-loop-other]')){if(mode?.kind==='loop'&&mode.joint===id)mode.other=el.value;return;}
      if(el.dataset.stateName!==undefined){const old=el.dataset.stateName,name=el.value.trim().slice(0,24);if(!name||name===old)return;change(id,x=>{const v=x.states[old];delete x.states[old];x.states[name]=v;});return;}
      if(el.dataset.stateValue!==undefined){if(finite(el.valueAsNumber))change(id,x=>{x.states[el.dataset.stateValue]=el.valueAsNumber;});return;}
      if(!f)return;const v=el.type==='number'?el.valueAsNumber:el.value;
      // An empty limit box takes the limit away.
      if((f==='lower'||f==='upper')&&el.value.trim()==='')return change(id,x=>{delete x[f];});
      if(f==='type')return change(id,x=>{x.type=v;});
      // Another mechanism type: its parts and pivot stay; how it moves, its positions and speed come from the type.
      if(f==='kind'){const t=TY()?.TYPES[v];if(!t)return;return change(id,x=>{const r=TY().retype(x,v,{rows:rows(),bind:bindFor(t)});for(const k of Object.keys(x))delete x[k];Object.assign(x,r);});}
      if(f==='name')return change(id,x=>{x.name=String(v).trim()||x.name;});
      if(f==='parent')return change(id,x=>{x.parent=v||null;});
      if(f==='drive')return change(id,x=>{if(v==='none')delete x.drive;else{const [signal,...of]=v.split(':');x.drive={signal,...(of.length?{of:of.join(':')}:{})};}if(x.drive?.signal==='turret')x.axis=orient(x,x.axis,x.origin);});
      if(!finite(v))return;
      if(f.startsWith('state:'))return change(id,x=>{x.states={...x.states,[f.slice(6)]:v};});
      if(f.startsWith('link:')){const next=structuredClone(kin()),c=next.couplings.find(x=>x.to===id);if(c){c[f.slice(5)]=v;api.commit(next);}return;}
      if(f.startsWith('intake:')){const n=+String(j.drive?.of||'').split(':')[1]||0;api.setIntake(n,{[f.slice(7)]:v});return;}
      if(f==='shooter:hood'){api.setShooting?.({hood:v});return;}
      if(f==='launch')return change(id,x=>{x.launch=Math.max(0,Math.min(90,v));});
      if(f.startsWith('origin:')){const o=toRobot(j.origin);o[+f.slice(7)]=v;return change(id,x=>{x.origin=fromRobot(o);});}
      if(f.startsWith('axis:')){const a=dirToRobot(j.axis);a[+f.slice(5)]=v;if(math().len(a)<1e-6)return;return change(id,x=>{x.axis=dirFromRobot(math().unit(a));});}
      if(['zero','speed','rpm','lower','upper'].includes(f))return change(id,x=>{x[f]=v;});
    });
    // A new mechanism of a type (+ Add mechanism): named for it ("Lift", "Claw 2"), with the FTC motor or servo it usually
    // has, and no CAD parts yet: Configure from CAD finds them by name, or the team chooses them on the model.
    // A motor's id: its part's with "_motor" (ids are 32 characters at most), unique.
    function motorId(model,jid){let mid=jid.slice(0,24)+'_motor',n=2;while(model.actuators.some(x=>x.id===mid)||model.joints.some(x=>x.id===mid))mid=jid.slice(0,22)+'_motor'+n++;return mid;}
    function actuatorFor(j,id){const A=root.DeckActuators,spec=TY()?.motorFor(TY().of(j)?.id)||{kind:'dcmotor'};
      return A?A.create({id,joint:j.id,name:j.name,spec,speed:j.speed??90,travel:A.travelOf(j),states:j.states}):{id,name:j.name,joint:j.id,...spec,mode:'position',speed:j.speed??90};}
    function add(typeId,{name:wanted}={}){const T=TY(),t=T?.TYPES[typeId]||T?.TYPES['custom-pivot'],next=structuredClone(kin()),m=meta(),n=next.joints.length+1;if(!t)return null;
      let id2=t.id,k=2;while(next.joints.some(x=>x.id===id2)||next.actuators.some(x=>x.id===id2))id2=t.id.slice(0,24)+'-'+k++;
      const base=wanted||(t.group==='custom'?`Moving part ${n}`:T.short(t));let name=base;for(let i=2;next.joints.some(x=>x.name.toLowerCase()===name.toLowerCase());i++)name=`${base} ${i}`;
      const c=ctx(),center=c?[(c.lo[0]+c.hi[0])/2,(c.lo[1]+c.hi[1])/2,(c.lo[2]+c.hi[2])/2]:[0,0,0];
      const j=T.joint(t.id,{id:id2,name,origin:center,rows:rows(),bind:bindFor(t)});
      if(m?.id&&arrays())next.model=m.id;next.unit=unit();next.joints.push(j);
      if(j.drive?.signal==='action'&&t.motor)next.actuators.push(actuatorFor(j,motorId(next,id2)));
      api.commit(next);lastKey='';render();return id2;}
    host.addEventListener('input',e=>{const el=e.target;if(!el.matches('[data-try]'))return;const id=el.closest('[data-id]')?.dataset.id;if(!id)return;if(demo){cancelAnimationFrame(demo);demo=0;}values={...values,[id]:el.valueAsNumber};showPose();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mode){mode=null;status('');api.refreshPicker();render();}});
    return {render,picker,discover,add,isMechanism,fitIntake,found:()=>lastFound,opened:()=>open,pose(id,value){values={...values,[id]:value};showPose();},
      // For the range of motion test (sim-motion-test.js): a piece of it in the worker, and showing a pose on the model.
      motion:{ask:options=>ask('motion',options),canShow:()=>!!preview(),show(v){if(demo){cancelAnimationFrame(demo);demo=0;}values=v;showPose();},mark(a,b){const p=preview();if(!p)return;if(a===undefined)return highlight();p.highlight(new Set([a,b]),0xe5484d);}},
      // Shows a part at a value on the preview (a named position, from the Mechanisms list).
      pose(id,value){if(!finite(value))return;if(demo){cancelAnimationFrame(demo);demo=0;}values={...values,[id]:value};showPose();const r=host.querySelector(`[data-id="${CSS.escape(id)}"] [data-try]`);if(r)r.value=value;},
      // Opens a part here (from the Mechanisms list), choosing its parts on the model when asked.
      open(id,{choose=false}={}){if(!joints().some(j=>j.id===id))return;open=id;mode=choose?{kind:'parts',joint:id}:null;values={};lastKey='';render();showPose();api.refreshPicker();
        if(choose)status('Click the parts that move together on the model (Shift-click takes a whole assembly), then pick its pivot.');host.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'});},
      // Called when the Mechanisms page opens: a CAD the finder has not looked at yet is looked at now, and a finding made
      // by an older finder is made again, keeping what the team set.
      shown(){const m=meta(),k=kin();if(m?.id&&(k.model!==m.id||k.discovered&&(k.finder||1)<FINDER)&&arrays())discover({quiet:true});else render();},
      hide(){if(demo){cancelAnimationFrame(demo);demo=0;}mode=null;}};
  }
  root.DeckJointsPanel={create};
})(typeof globalThis==='object'?globalThis:this);
