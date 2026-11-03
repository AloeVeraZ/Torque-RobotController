(function(root){
  'use strict';
  // Setup → Mechanisms: the robot's mechanisms as one list. + Add mechanism picks what each one is from the kinds FTC
  // robots of every season, FRC robots and robots in general use (DeckMechanismTypes). Each card says what drives it (a
  // servo to set positions, a continuous servo, a DC motor with an encoder or a linear servo, as the FTC part it is:
  // DeckActuators), its name in the robot configuration, and its named positions both as the part moves (degrees,
  // inches) and as the robot code sends them (a servo position from 0 to 1, a motor's encoder count). Configure from
  // CAD (simulation.js) finds each one in the CAD by name.
  // The game's intakes and shooters (BIOBUZZ) are cards of their own that simulation.js draws in the same list; this
  // module draws the moving mechanisms (DeckKinematics joints) and the picker. It never touches the project directly.
  const K=()=>root.DeckKinematics,TY=()=>root.DeckMechanismTypes,A=()=>root.DeckActuators;
  const esc=s=>String(s??'').replace(/[&<>"]/g,c=>`&#${c.charCodeAt(0)};`),finite=Number.isFinite,fix=(v,d=2)=>+(+v).toFixed(d);
  // The BIOBUZZ game's own mechanisms: the game physics picks up and shoots pieces with them.
  const GAME=[
    {id:'game:intake:sweeper',name:'Intake · sweeper roller',blurb:'A roller across an edge sweeps pieces off the floor into the robot.'},
    {id:'game:intake:siderollers',name:'Intake · side rollers',blurb:'Two rollers grip pieces from the sides; reaches into flowers.'},
    {id:'game:intake:ramp',name:'Intake · deployable ramp',blurb:'A servo folds a ramp with rollers down in front of the robot; reaches into flowers.'},
    {id:'game:intake:kicker',name:'Intake · kicker',blurb:'A servo arm swings down, scoops pieces and swings them in.'},
    {id:'game:shooter:turret',name:'Shooter · turret',blurb:'A flywheel on a turntable that turns to aim by itself.'},
    {id:'game:shooter:fixed',name:'Shooter · fixed',blurb:'A flywheel fixed to the frame; the robot turns to aim.'}];
  // On BIOBUZZ these types are the game's own intake or shooter (the physics picks up and shoots with them).
  const AS_GAME={'roller-intake':['intake','sweeper'],'deploy-intake':['intake','ramp'],flywheel:['shooter','fixed'],turret:['shooter','turret']};
  // What drives a part: FTC's four, then other robots' actuators.
  const FTC_KINDS=['servo','crservo','dcmotor','linear'],SERVO_KINDS=[['servo','Set position'],['crservo','Continuous'],['linear','Linear']];
  function create({host,picker,api}){
    let picking=false,lastKey='';
    const kin=()=>api.kinematics(),status=t=>api.status?.(t||'');
    // The mechanisms listed: parts of a mechanism type moved by route actions, a part riding on another under it.
    // Parts that only follow another (a claw's second finger) and the game's own parts (under its intakes and shooters)
    // are not listed; the Moving parts panel shows every one.
    function listed(){
      const k=kin(),follows=new Set(k.couplings.map(c=>c.to)),mech=k.joints.filter(j=>api.isMechanism(j)&&!follows.has(j.id)),ids=new Set(mech.map(j=>j.id)),out=[];
      const visit=(j,d)=>{out.push([j,d]);for(const c of mech.filter(x=>x.parent===j.id))visit(c,d+1);};
      for(const j of mech)if(!j.parent||!ids.has(j.parent))visit(j,0);return out;}
    const unitOf=j=>j.type==='prismatic'?'in':'°';
    const opt=(v,t,on)=>`<option value="${esc(v)}"${on?' selected':''}>${esc(t)}</option>`;
    const num=(attr,v,{label,min='',max='',step='any',hint=''}={})=>`<div><label>${label}<input type="number" data-slider="off" ${attr} value="${finite(v)?+(+v).toPrecision(6):''}" min="${min}" max="${max}" step="${step}"${hint?` title="${esc(hint)}"`:''}></label></div>`;
    function badge(j){if(j.source==='metadata')return ['sure','From the file'];if(j.matched||j.source==='inferred'&&j.parts?.length)return [(j.confidence??.7)>=.7||j.matched?'likely':'check',j.matched?'Found in your CAD':'Found · please check'];
      if(j.parts?.length)return ['user','Parts chosen'];return ['stand','Not in your CAD yet'];}
    // Named positions: as the part moves, and as the robot code sends them.
    function positions(j,a){
      const st=Object.entries(j.states||{}),u=unitOf(j),servoLike=a&&(a.kind==='servo'||a.kind==='linear')&&A(),motor=a?.kind==='dcmotor'&&A();
      const rows=st.map(([k,v])=>`<div class="sim-mech-pos" data-state="${esc(k)}"><input aria-label="Position name" data-m-state-name value="${esc(k)}" maxlength="24">
        <label>${u}<input type="number" data-slider="off" aria-label="${esc(k)}, ${u==='in'?'inches':'degrees'} from where the CAD has it" data-m-state-value value="${fix(v,2)}" step="any"></label>
        ${servoLike?`<label>Servo<input type="number" data-slider="off" aria-label="${esc(k)}, servo position" data-m-state-pos value="${fix(A().position(a,v),3)}" min="0" max="1" step="0.005"></label>`:motor?`<span class="sim-mech-ticks" title="RUN_TO_POSITION target">${A().ticks(a,v)} counts</span>`:''}
        <button type="button" class="secondary" data-m="state-show" data-v="${esc(k)}">Show</button><button type="button" class="icon-button" data-m="unstate" data-v="${esc(k)}" aria-label="Remove ${esc(k)}">×</button></div>`).join('');
      return `<span class="sim-mech-label">Named positions</span>${rows}<button type="button" class="secondary" data-m="state">+ Position</button>
        <p class="hint">${st.length?`A route action named “${esc(j.name)} ${esc(st[0][0])}” moves it there. `:''}${u==='in'?'Inches':'Degrees'} are from where your CAD has it${servoLike?'; the servo column is the position the code sends (Servo.setPosition)':motor?'; counts are the encoder targets the code sends (RUN_TO_POSITION)':''}.</p>`;}
    // What drives it, and the numbers the robot code needs.
    function actuator(j,a){
      const kinds=K().ACTUATORS,kind=a?.kind||'none',u=unitOf(j),Ax=A();
      // Motor or servo first; a servo then says which kind. An FTC robot is offered only what a Control Hub can run.
      const ftc=api.ftc?.()!==false,isServo=SERVO_KINDS.some(([k])=>k===kind),others=Object.keys(kinds).filter(k=>!FTC_KINDS.includes(k)&&k!=='none'&&(!ftc||k===kind));
      const kindSelect=`<select data-m-f="actuator" aria-label="Driven by">${opt('dcmotor','DC motor',kind==='dcmotor')}${opt(isServo?kind:'servo','Servo',isServo)}${others.map(k=>opt(k,ftc?`${kinds[k]} (not legal on an FTC robot)`:kinds[k],k===kind)).join('')}${opt('none','Nothing: it moves at its own speed',kind==='none')}</select>`;
      const servoSelect=isServo?`<div><label>Servo type<select data-m-f="actuator" aria-label="Servo type">${SERVO_KINDS.map(([k,t])=>opt(k,t,k===kind)).join('')}</select></label></div>`:'';
      let body='';
      if(!a)body=`<div class="start-xy">${num('data-m-f="speed"',j.speed??90,{label:`Moves at · ${u}/s`,min:.01})}</div><p class="hint">Without a motor or servo it moves to each named position at this speed.</p>`;
      else{
        const models=Ax?Ax.of(a.kind):[],model=models.length?`<div><label>Model<select data-m-f="model">${opt('','Another one (set its numbers)',!a.model)}${models.map(md=>opt(md.id,md.name,md.id===a.model)).join('')}</select></label></div>`:'';
        const rev=a.kind==='servo'||a.kind==='linear'?'Higher positions move it the other way':'Turns the other way (REVERSE)';
        body=`<div class="start-xy">${model}<div><label>Name in the robot configuration<input data-m-f="device" maxlength="40" autocomplete="off" spellcheck="false" value="${esc(a.device||Ax?.camel(a.name)||'')}"></label></div></div>
          <label class="check sim-mech-reverse"><input type="checkbox" data-m-f="reversed"${a.reversed?' checked':''}> ${rev}</label>
          ${['dcmotor','servo','crservo','linear'].includes(a.kind)?`<div class="start-xy"><div><label>Second ${a.kind==='dcmotor'?'motor':'servo'} on this part (optional)<input data-m-f="device2" maxlength="40" autocomplete="off" spellcheck="false" placeholder="None" value="${esc(a.device2||'')}"></label></div>${a.device2?`<label class="check sim-mech-reverse"><input type="checkbox" data-m-f="reversed2"${a.reversed2?' checked':''}> It is mounted mirrored (turns the other way)</label>`:''}</div><p class="hint">A lift on two motors (left and right) or a wrist on two servos: both get the same commands.</p>`:''}`;
        if((a.kind==='servo'||a.kind==='linear')&&Ax){const s=Ax.servo(a),lim=Ax.limits(a),per=Ax.perUnit(a),lu=a.kind==='linear'?'in':'°';
          body+=`<span class="sim-mech-label">Servo positions · 0–1</span><div class="sim-grid3">${num('data-m-servo="min"',s.min,{label:'Lowest it may go',min:0,max:1,step:.01})}${num('data-m-servo="center"',s.center,{label:'Where your CAD has it',min:0,max:1,step:.01})}${num('data-m-servo="max"',s.max,{label:'Highest it may go',min:0,max:1,step:.01})}</div>
            <div class="start-xy">${num('data-m-servo="range"',s.range,{label:`Turns across its rated pulses · ${lu}`,min:1})}<div><label>Pulses for 0 and 1<select data-m-servo="pwm">${opt('standard','600–2400 µs (FTC default)',s.pwm.join()==='600,2400')}${opt('full','500–2500 µs (setPwmRange)',s.pwm.join()==='500,2500')}${!['600,2400','500,2500'].includes(s.pwm.join())?opt('custom',`${s.pwm[0]}–${s.pwm[1]} µs`,true):''}</select></label></div></div>
            <p class="hint">${esc(Ax.describe(a,u))} From ${fix(s.min,2)} to ${fix(s.max,2)} it moves the part from ${fix(lim[0],1)} to ${fix(lim[1],1)} ${u==='in'?'in':'°'}. ${per*(1)>0?`Position ${fix(s.center,2)} holds it where your CAD has it. `:''}Find each position on the robot by stepping the servo 0.05 at a time from ${fix(s.center,2)}.</p>`;}
        else if(a.kind==='dcmotor'&&Ax){const stages=a.transmission||[];
          body+=`<div class="start-xy">${num('data-m-f="cpr"',finite(a.cpr)?a.cpr:Ax.MODELS[a.model]?.cpr,{label:'Encoder counts per turn of its output',min:.01})}${num('data-m-f="power"',a.power??1,{label:'Power · 0–1',min:.05,max:1,step:.05})}</div>
            <p class="hint">${esc(Ax.describe(a,u))} ${stages.length?`Gearing after the motor: ${stages.map(st=>({gearbox:`${fix(st.ratio,2)}:1 gearbox`,belt:`${st.driver}:${st.driven} belt or gears`,spool:`${fix(st.diameter,2)} in spool`,rack:`${fix(st.diameter,2)} in pinion on a rack`,screw:`${fix(st.lead,3)} in lead screw`})[st.kind]).join(', then ')}.`:'Straight onto the part (no gearing after the motor).'}
            <button type="button" class="text-button" data-m="gearing">Edit gearing</button></p>`;}
        else if(a.kind==='crservo'&&Ax)body+=`<div class="start-xy">${num('data-m-f="power"',a.power??1,{label:'Power while it runs · 0–1',min:.05,max:1,step:.05})}</div><p class="hint">${esc(Ax.describe(a,u))} CRServo.setPower: positive one way, negative the other.</p>`;
        else body+=`<div class="start-xy">${num('data-m-f="speed"',a.speed,{label:`Moves at · ${u}/s`,min:.01})}</div><p class="hint">Not an FTC part: it moves at this speed.</p>`;}
      return `<span class="sim-mech-label">Driven by</span><div class="start-xy"><div><label>Driven by${kindSelect}</label></div>${servoSelect}</div>${body}`;}
    function card(j,depth){
      const T=TY(),t=T.TYPES[j.kind],k=kin(),a=k.actuators.find(x=>x.joint===j.id),[lv,said]=badge(j),parent=depth?k.joints.find(x=>x.id===j.parent):null,cad=api.cad();
      const where=j.matched?`In your CAD: “${esc(j.matched)}”.`:j.parts?.length?'Its parts are chosen on the model.':cad?'Configure from CAD finds it by its name in your CAD, or choose its parts on the model.':'Import your robot’s CAD (step 2) to see it move.';
      return `<section class="sim-mech-part sim-mech-moving" data-mech="${esc(j.id)}" data-depth="${Math.min(depth,3)}"><div class="sim-mech-head"><h4>${esc(j.name)}<em class="sim-joint-kind">${esc(t.name)}${parent?` · on ${esc(parent.name)}`:''}</em></h4><small class="sim-joint-badge" data-level="${lv}">${said}</small><button type="button" class="icon-button" data-m="remove" aria-label="Remove ${esc(j.name)}" title="Remove">×</button></div>
        <p class="hint">${esc(t.blurb)} ${where}</p>
        ${cad?`<div class="sim-joint-buttons"><button type="button" class="secondary" data-m="show">Show on model</button><button type="button" class="secondary" data-m="choose">${j.parts?.length?'Change its parts':'Choose its parts'}</button></div>`:''}
        <div class="start-xy"><div><label>Name<input data-m-f="name" maxlength="40" autocomplete="off" value="${esc(j.name)}"></label></div><div><label>Mechanism<select data-m-f="kind">${T.grouped().map(g=>`<optgroup label="${esc(g.name)}">${g.types.map(x=>opt(x.id,x.name,x.id===j.kind)).join('')}</optgroup>`).join('')}</select></label></div></div>
        ${positions(j,a)}${actuator(j,a)}<div class="sim-wire-block" data-wire-for="kin:${esc(j.id)}"></div></section>`;}
    // + Add mechanism: every type, grouped, with a search over names, what each does and the words CADs use for it.
    function pickerHtml(){
      const T=TY(),game=api.game(),words=t=>(t.name+' '+t.blurb+' '+String(t.words||'').replace(/\\[a-z]/gi,' ').replace(/[^a-z0-9]+/gi,' ')).toLowerCase();
      const tile=(id,name,blurb,find,note='')=>`<button type="button" class="sim-mech-type" data-m="add" data-v="${esc(id)}" data-find="${esc(find)}" title="${esc(blurb)}"><strong>${esc(name)}</strong><small>${esc(blurb)}</small>${note?`<em>${esc(note)}</em>`:''}</button>`;
      const groups=[...(game?[{name:'BIOBUZZ: picks up and shoots game pieces',tiles:GAME.map(g=>tile(g.id,g.name,g.blurb,(g.name+' '+g.blurb+' intake shooter game').toLowerCase()))}]:[]),
        ...T.grouped().map(g=>({name:g.name,tiles:g.types.filter(t=>api.ftc?.()===false||!t.motor||FTC_KINDS.includes(t.motor.kind)).map(t=>tile(t.id,t.name,t.blurb,words(t),game&&AS_GAME[t.id]?`BIOBUZZ ${AS_GAME[t.id][0]}`:''))})).filter(g=>g.tiles.length)];
      return `<div class="sim-mech-types" role="group" aria-label="Add a mechanism"><div class="sim-mech-types-head"><input type="search" data-types-search aria-label="Search mechanisms" placeholder="Search: claw, lift, extendo, turret, hang…"><button type="button" class="secondary" data-m="close">Close</button></div>
        <p class="hint">${api.ftc?.()===false?'Mechanisms from every FTC season, FRC and other robots.':'Mechanisms from every FTC season, with parts legal on an FTC robot.'} Each comes with the motor or servo it usually has; change it on its card.</p>
        ${groups.map(g=>`<div class="sim-mech-type-group"><span class="sim-mech-label">${esc(g.name)}</span><div class="sim-mech-type-grid">${g.tiles.join('')}</div></div>`).join('')}
        <p class="hint sim-mech-types-none" hidden>Nothing matches. Try another word, or use Something that pivots, slides or spins under Your own.</p></div>`;}
    function render(){
      const typing=(host.contains(document.activeElement)||picker.contains(document.activeElement))&&document.activeElement.matches('input:not([type=checkbox]),select');
      const k=kin(),key=JSON.stringify([k.joints,k.actuators,k.couplings,api.cad(),api.game()]);
      if(!typing&&key!==lastKey){lastKey=key;const open=new Set([...host.querySelectorAll('details[open]')].map(d=>d.closest('[data-mech]')?.dataset.mech));
        host.innerHTML=listed().map(([j,d])=>card(j,d)).join('');for(const d of host.querySelectorAll('details'))d.open=open.has(d.closest('[data-mech]')?.dataset.mech);}
      picker.hidden=!picking;if(picking&&!picker.firstChild)picker.innerHTML=pickerHtml();
      api.counted?.(listed().length);api.decorate?.(host);
    }
    function setPicking(on){picking=on;picker.innerHTML='';render();api.adding?.(on);if(on)picker.querySelector('[data-types-search]')?.focus();}
    // Changes go through a copy of the model, committed at once.
    function change(fn){const next=structuredClone(kin());if(fn(next)===false)return;api.commit(next);}
    const jointOf=(next,id)=>next.joints.find(x=>x.id===id),actOf=(next,id)=>next.actuators.find(x=>x.joint===id);
    // A motor's id: its part's with "_motor" (ids are 32 characters at most), unique.
    function motorId(next,jid){let mid=jid.slice(0,24)+'_motor',n=2;while(next.actuators.some(x=>x.id===mid)||next.joints.some(x=>x.id===mid))mid=jid.slice(0,22)+'_motor'+n++;return mid;}
    function add(id){
      if(id.startsWith('game:')){const [,what,kind]=id.split(':');const label=api.addGame(what,kind);setPicking(false);status(label?`${label} added. Configure from CAD finds it in your CAD by name.`:`The robot already has as many ${what}s as BIOBUZZ allows.`);return;}
      if(api.game()&&AS_GAME[id]){const label=api.addGame(...AS_GAME[id]);if(label){setPicking(false);status(`${label} added: on BIOBUZZ it is the game’s own ${AS_GAME[id][0]}. Configure from CAD finds it in your CAD by name.`);return;}}
      const jid=api.joints().add(id);setPicking(false);if(!jid)return;const j=kin().joints.find(x=>x.id===jid);
      status(`${j?.name||'Mechanism'} added. ${api.cad()?'Press Configure from CAD to find it in your CAD by name, or choose its parts on the model.':'Import your robot’s CAD to see it move.'}`);
      requestAnimationFrame(()=>host.querySelector(`[data-mech="${CSS.escape(jid)}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'}));}
    // Positions kept as the code sends them while a servo's center moves (the team found them on the robot); the part's
    // limits follow its servo's lowest and highest positions.
    function servoChange(next,j,a,patch){const before=Object.fromEntries(Object.entries(j.states||{}).map(([k,v])=>[k,A().position(a,v)]));
      a.servo={...A().servo(a),...patch};if('center' in patch)for(const [k,p] of Object.entries(before))j.states[k]=+A().valueAt(a,p).toFixed(3);
      fitLimits(j,a);}
    function fitLimits(j,a){if(!(a.kind==='servo'||a.kind==='linear')||!A()||!(j.type==='revolute'||j.type==='prismatic'))return;const [lo,hi]=A().limits(a);j.lower=+lo.toFixed(3);j.upper=+hi.toFixed(3);
      for(const k of Object.keys(j.states||{}))j.states[k]=Math.max(j.lower,Math.min(j.upper,j.states[k]));}
    host.addEventListener('click',e=>{
      const b=e.target.closest('[data-m]');if(!b)return;const id=b.closest('[data-mech]')?.dataset.mech,what=b.dataset.m;
      if(what==='remove'){change(next=>{next.joints=next.joints.filter(x=>x.id!==id);for(const x of next.joints)if(x.parent===id)x.parent=null;next.couplings=next.couplings.filter(c=>c.from!==id&&c.to!==id);});status('Removed.');return;}
      if(what==='show'){api.joints().open(id);return;}
      if(what==='choose'||what==='gearing'){api.joints().open(id,{choose:what==='choose'});return;}
      if(what==='state'){change(next=>{const j=jointOf(next,id),s=j.states||{};let n=Object.keys(s).length+1,name='position '+n;while(name in s)name='position '+ ++n;s[name]=0;j.states=s;});return;}
      if(what==='unstate'){change(next=>{const j=jointOf(next,id);delete j.states[b.dataset.v];});return;}
      if(what==='state-show'){const j=kin().joints.find(x=>x.id===id),v=j?.states?.[b.dataset.v];if(finite(v))api.joints().pose?.(id,v);return;}});
    picker.addEventListener('click',e=>{const b=e.target.closest('[data-m]');if(!b)return;if(b.dataset.m==='close')setPicking(false);else if(b.dataset.m==='add')add(b.dataset.v);});
    picker.addEventListener('input',e=>{const el=e.target;if(!el.matches('[data-types-search]'))return;const words=el.value.trim().toLowerCase().split(/\s+/).filter(Boolean);let any=false;
      for(const g of picker.querySelectorAll('.sim-mech-type-group')){let n=0;for(const b of g.querySelectorAll('[data-find]')){const on=words.every(w=>b.dataset.find.includes(w));b.hidden=!on;if(on)n++;}g.hidden=!n;any||=n>0;}
      const none=picker.querySelector('.sim-mech-types-none');if(none)none.hidden=any;});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&picking&&picker.isConnected)setPicking(false);});
    host.addEventListener('change',e=>{
      const el=e.target,id=el.closest('[data-mech]')?.dataset.mech;if(!id)return;const v=el.type==='number'?el.valueAsNumber:el.type==='checkbox'?el.checked:el.value;
      const row=el.closest('[data-state]')?.dataset.state;
      if(el.matches('[data-m-state-name]')){const name=String(v).trim().slice(0,24);if(!name||name===row)return;change(next=>{const j=jointOf(next,id);if(name in j.states)return false;j.states=Object.fromEntries(Object.entries(j.states).map(([k,x])=>[k===row?name:k,x]));});return;}
      if(el.matches('[data-m-state-value]')){if(!finite(v))return;change(next=>{const j=jointOf(next,id);j.states[row]=v;});return;}
      if(el.matches('[data-m-state-pos]')){if(!finite(v))return;change(next=>{const j=jointOf(next,id),a=actOf(next,id);if(!a)return false;j.states[row]=+A().valueAt(a,Math.max(0,Math.min(1,v))).toFixed(3);});return;}
      if(el.dataset.mServo){const f=el.dataset.mServo;change(next=>{const j=jointOf(next,id),a=actOf(next,id);if(!a)return false;
        if(f==='pwm'){if(v==='custom')return false;servoChange(next,j,a,{pwm:A().PWM[v]});return;}if(!finite(v))return false;
        servoChange(next,j,a,{[f]:f==='range'?Math.max(1,v):Math.max(0,Math.min(1,v))});});return;}
      const f=el.dataset.mF;if(!f)return;
      if(f==='name'){const name=String(v).trim().slice(0,40);if(!name)return;change(next=>{if(next.joints.some(x=>x.id!==id&&x.name.toLowerCase()===name.toLowerCase())){status(`Another part is already called “${name}”; route actions find parts by name.`);return false;}
        const j=jointOf(next,id),a=actOf(next,id);j.name=name;if(a){a.name=name;}});return;}
      if(f==='kind'){const t=TY().TYPES[v];if(!t)return;change(next=>{const j=jointOf(next,id),r=TY().retype(j,v,{rows:api.rows?.()});for(const k of Object.keys(j))delete j[k];Object.assign(j,r);
        const a=actOf(next,id),spec=TY().motorFor(v);if(!a||a.kind!==spec.kind){next.actuators=next.actuators.filter(x=>x.joint!==id);if(j.drive?.signal==='action'&&t.motor)next.actuators.push({...A().create({id:a?.id||motorId(next,id),joint:id,name:j.name,spec,speed:j.speed??90,travel:A().travelOf(j),states:j.states}),...(a?.device?{device:a.device}:{})});}
        else fitLimits(j,a);});return;}
      if(f==='actuator'){change(next=>{const j=jointOf(next,id),a=actOf(next,id);next.actuators=next.actuators.filter(x=>x.joint!==id);if(v==='none')return;
        const usual=TY().motorFor(j.kind),spec=usual.kind===v?usual:{kind:v,...(a?.transmission&&(v==='dcmotor'||v==='stepper'||v==='bldc')?{transmission:a.transmission}:{})};
        const fresh=A()&&FTC_KINDS.includes(v)?A().create({id:a?.id||motorId(next,id),joint:id,name:j.name,spec,speed:j.speed??90,travel:A().travelOf(j),states:j.states}):{id:a?.id||motorId(next,id),name:j.name,joint:id,kind:v,mode:'position',speed:j.speed??90,...(v==='pneumatic'?{response:'pneumatic'}:{})};
        if(a?.device)fresh.device=a.device;if(a?.reversed)fresh.reversed=true;next.actuators.push(fresh);fitLimits(j,fresh);});return;}
      if(f==='model'){change(next=>{const j=jointOf(next,id),i=next.actuators.findIndex(x=>x.joint===id);if(i<0)return false;next.actuators[i]=A().withModel(next.actuators[i],v);fitLimits(j,next.actuators[i]);});return;}
      if(f==='device'){const name=String(v).trim();if(!/^[A-Za-z][\w .-]{0,39}$/.test(name)){status('A configuration name starts with a letter and uses letters, digits, spaces, _ . or -.');return;}change(next=>{actOf(next,id).device=name;});return;}
      if(f==='device2'){const name=String(v).trim();if(name&&!/^[A-Za-z][\w .-]{0,39}$/.test(name)){status('A configuration name starts with a letter and uses letters, digits, spaces, _ . or -.');return;}change(next=>{const a=actOf(next,id);if(!a)return false;if(name)a.device2=name;else{delete a.device2;delete a.reversed2;}});return;}
      if(f==='reversed2'){change(next=>{const a=actOf(next,id);if(v)a.reversed2=true;else delete a.reversed2;});return;}
      if(f==='reversed'){change(next=>{const a=actOf(next,id);if(v)a.reversed=true;else delete a.reversed;fitLimits(jointOf(next,id),a);});return;}
      if(['cpr','power'].includes(f)){if(!finite(v)||v<=0)return;change(next=>{actOf(next,id)[f]=f==='power'?Math.min(1,v):v;});return;}
      if(f==='speed'){if(!finite(v)||v<=0)return;change(next=>{const a=actOf(next,id);if(a)a.speed=v;else jointOf(next,id).speed=v;});return;}
    });
    return {render,open:()=>setPicking(!picking),close:()=>setPicking(false),listed};
  }
  root.DeckMechanismList={create,GAME,AS_GAME};
})(typeof globalThis==='object'?globalThis:this);
